//! Колективи на вузлі (E8, C3b, перший зріз): ключ учасника профілю і захищений колектив,
//! який створює власник. Відкриті частини — у базі (міграція 0019), секрети — лише у сховищі
//! секретів профілю під паролем (`collective::secret_store`, варіант Ф). Мережі немає; назовні
//! (у JS) ідуть тільки відбитки, назви й лічильники — жодного секрету чи сирого ключа.
//!
//! Журнал складу кожного колективу зберігається як суцільний префікс підписаних записів і при
//! кожному читанні заново перевіряється через [`InMemoryMembership::apply`]: підмінений у базі
//! рядок не дає ні учасника, ні прав.

use std::collections::HashSet;
use std::path::{Path, PathBuf};

use serde::Serialize;
use sqlx::{Row, SqlitePool};
use zeroize::Zeroizing;

use crate::collective::epoch::{CollectiveId, EpochKey};
use crate::collective::identity::{DeviceIdentity, MemberIdentity};
use crate::collective::replay::{InMemoryMembership, MembershipRecord, MembershipView};
use crate::collective::secret_store::{SecretStore, StoreError, StoreStatus, UnlockedStore};
use crate::collective::{random_array, sha256, ID_LEN, KEY_LEN};
use crate::office_library::KdfParams;

/// Скільки захищених колективів може створити один профіль на цьому етапі.
pub const MAX_COLLECTIVES: i64 = 20;
/// Межі пароля сховища ключів у байтах UTF-8.
pub const MIN_PASSWORD_BYTES: usize = 8;
pub const MAX_PASSWORD_BYTES: usize = 1024;

const SECRET_MEMBER_SIGN: &str = "member-sign";
const SECRET_MEMBER_EXCHANGE: &str = "member-exchange";
const SECRET_DEVICE_SIGN: &str = "device-sign";
const FINGERPRINT_LABEL: &[u8] = b"easywar/collective/v1/fingerprint";

#[derive(Debug, thiserror::Error)]
pub enum CollectiveStoreError {
    #[error("пароль сховища ключів: від 8 до 1024 байтів")]
    PasswordLength,
    #[error("ключ учасника для цього профілю вже створено")]
    IdentityExists,
    #[error("спершу створіть ключ учасника")]
    IdentityMissing,
    #[error("пароль не підходить")]
    WrongPassword,
    #[error("сховище ключів пошкоджене або не відповідає профілю")]
    StoreDamaged,
    #[error("назва колективу: від 1 до 80 символів без керівних знаків")]
    InvalidName,
    #[error("гранична кількість захищених колективів — 20")]
    TooManyCollectives,
    #[error("колектив не знайдено в цьому профілі")]
    CollectiveNotFound,
    #[error("таблицю колективу не знайдено")]
    TableNotFound,
    #[error("клас і призначення таблиці змінює лише її власник")]
    NotTableOwner,
    #[error("цей профіль не є учасником колективу")]
    NotAMember,
    #[error("ви вже учасник цього колективу")]
    AlreadyJoined,
    #[error("текст пошкоджений або не того типу")]
    InvalidText,
    #[error("назва таблиці: від 1 до 80 символів без керівних знаків")]
    InvalidTitle,
    #[error("невідомий клас, призначення чи транспорт")]
    InvalidChoice,
    #[error("строк запрошення: від 1 до 168 годин")]
    InvalidInvitationHours,
    #[error("операція порожня або більша за 64 КіБ")]
    OperationSize,
    #[error("ключ епохи відсутній: колектив створено попередньою версією, створіть його знову")]
    EpochKeyMissing,
    #[error("відмова: {0}")]
    Rejected(&'static str),
    #[error("помилка сховища ключів: {0}")]
    Io(String),
    #[error("помилка локальної бази колективів: {0}")]
    Database(#[from] sqlx::Error),
}

impl From<StoreError> for CollectiveStoreError {
    fn from(error: StoreError) -> Self {
        match error {
            StoreError::WrongPassword => CollectiveStoreError::WrongPassword,
            StoreError::Io(error) => CollectiveStoreError::Io(error.to_string()),
            StoreError::Corrupt | StoreError::InvalidKdf => CollectiveStoreError::StoreDamaged,
        }
    }
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct IdentitySummary {
    /// Перші 10 символів base32 від `member_id` (ADR, 2.2), групами по п'ять.
    pub fingerprint: String,
    pub device_fingerprint: String,
    pub created_at: String,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CollectiveSummary {
    pub fingerprint: String,
    pub name: String,
    pub created_at: String,
    /// Учасники, не відкликані на перевіреному журналі.
    pub members: usize,
    /// Суцільний застосований префікс журналу складу.
    pub latest_seq: u64,
    /// Збережені рядки журналу, які не пройшли перевірку (0 — журнал цілий).
    pub rejected_records: usize,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CollectiveStatus {
    /// `absent`, `locked` або `damaged` — без подробиць.
    pub key_store: &'static str,
    pub identity: Option<IdentitySummary>,
    pub collectives: Vec<CollectiveSummary>,
}

/// Результат створення ключа: ключ відновлення показується один раз і ніде не зберігається
/// у відкритому вигляді.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CreatedIdentity {
    pub identity: IdentitySummary,
    pub recovery_key: String,
}

pub struct CollectiveStore {
    pub(crate) pool: SqlitePool,
    pub(crate) secrets_dir: PathBuf,
    pub(crate) params: KdfParams,
    pub(crate) intents: crate::collective_sync::IntentStore,
}

impl CollectiveStore {
    pub fn new(pool: SqlitePool, secrets_dir: PathBuf) -> Self {
        Self {
            pool,
            secrets_dir,
            params: KdfParams::PRODUCTION,
            intents: Default::default(),
        }
    }

    #[cfg(test)]
    pub(crate) fn for_tests(pool: SqlitePool, secrets_dir: PathBuf) -> Self {
        Self {
            pool,
            secrets_dir,
            params: KdfParams::FOR_TESTS,
            intents: Default::default(),
        }
    }

    /// Колективи профілю за базою; `None`, якщо читання не вдалося (див.
    /// [`orphan_epoch_purposes`]).
    pub(crate) async fn known_collective_ids(
        &self,
        profile_id: &str,
    ) -> Option<HashSet<CollectiveId>> {
        let rows: Vec<Vec<u8>> =
            sqlx::query_scalar("SELECT collective_id FROM collectives WHERE profile_id = ?")
                .bind(profile_id)
                .fetch_all(&self.pool)
                .await
                .ok()?;
        rows.into_iter()
            .map(|row| CollectiveId::try_from(row.as_slice()).ok())
            .collect()
    }

    pub(crate) fn secret_store(&self, profile_id: &str) -> SecretStore {
        SecretStore::new(secret_store_path(&self.secrets_dir, profile_id), profile_id)
    }

    pub async fn status(&self, profile_id: &str) -> Result<CollectiveStatus, CollectiveStoreError> {
        let key_store = match self.secret_store(profile_id).status() {
            StoreStatus::Absent => "absent",
            StoreStatus::Locked => "locked",
            StoreStatus::Corrupt => "damaged",
        };
        let identity = sqlx::query(
            "SELECT member_id, device_pub, created_at FROM collective_identities WHERE profile_id = ?",
        )
        .bind(profile_id)
        .fetch_optional(&self.pool)
        .await?
        .map(|row| IdentitySummary {
            fingerprint: fingerprint(&row.get::<Vec<u8>, _>(0)),
            device_fingerprint: fingerprint(&sha256(&[FINGERPRINT_LABEL, &row.get::<Vec<u8>, _>(1)])),
            created_at: row.get(2),
        });
        let rows = sqlx::query(
            "SELECT collective_id, name, created_at FROM collectives WHERE profile_id = ?
             ORDER BY created_at, collective_id",
        )
        .bind(profile_id)
        .fetch_all(&self.pool)
        .await?;
        let mut collectives = Vec::with_capacity(rows.len());
        for row in rows {
            let id: Vec<u8> = row.get(0);
            let Ok(collective_id) = <CollectiveId>::try_from(id.as_slice()) else {
                continue;
            };
            let (membership, rejected_records) =
                self.load_journal(profile_id, &collective_id).await?;
            collectives.push(CollectiveSummary {
                fingerprint: fingerprint(&collective_id),
                name: row.get(1),
                created_at: row.get(2),
                members: membership.active_members(),
                latest_seq: membership.latest_seq(),
                rejected_records,
            });
        }
        Ok(CollectiveStatus {
            key_store,
            identity,
            collectives,
        })
    }

    /// Журнал складу з бази, заново перевірений: записи застосовуються по `seq`, недійсний
    /// зупиняє префікс і лічиться як відхилений.
    pub(crate) async fn load_journal(
        &self,
        profile_id: &str,
        collective_id: &CollectiveId,
    ) -> Result<(InMemoryMembership, usize), CollectiveStoreError> {
        let rows = sqlx::query(
            "SELECT seq, record FROM collective_membership_log
             WHERE profile_id = ? AND collective_id = ? ORDER BY seq",
        )
        .bind(profile_id)
        .bind(collective_id.as_slice())
        .fetch_all(&self.pool)
        .await?;
        let mut membership = InMemoryMembership::new(*collective_id);
        let total = rows.len();
        for row in rows {
            let seq: i64 = row.get(0);
            let bytes: Vec<u8> = row.get(1);
            let applied = u64::try_from(seq).ok().and_then(|seq| {
                let record = MembershipRecord::from_bytes(&bytes).ok()?;
                membership
                    .apply(seq, record)
                    .ok()
                    .filter(|latest| *latest == seq)
            });
            if applied.is_none() {
                break;
            }
        }
        let rejected = total - membership.latest_seq() as usize;
        Ok((membership, rejected))
    }

    /// Новий ключ учасника й пристрою для профілю: секрети — у новому сховищі під паролем,
    /// відкриті ключі — у базі. Наявне сховище чи ключ не перезаписуються.
    pub async fn create_identity(
        &self,
        profile_id: &str,
        password: Zeroizing<String>,
        now: &str,
    ) -> Result<CreatedIdentity, CollectiveStoreError> {
        check_password(&password)?;
        if self.has_identity(profile_id).await? {
            return Err(CollectiveStoreError::IdentityExists);
        }
        let store = self.secret_store(profile_id);
        if store.status() != StoreStatus::Absent {
            return Err(CollectiveStoreError::IdentityExists);
        }
        let params = self.params;
        let (member_public, device_public, recovery) = tokio::task::spawn_blocking(move || {
            if let Some(dir) = store.path().parent() {
                std::fs::create_dir_all(dir)
                    .map_err(|error| CollectiveStoreError::Io(error.to_string()))?;
            }
            let (mut unlocked, recovery) = store.create(password.as_bytes(), params)?;
            let member = MemberIdentity::generate();
            let device = DeviceIdentity::generate();
            let (sign_seed, exchange_secret) = member.secrets();
            unlocked.write(SECRET_MEMBER_SIGN, sign_seed.as_slice())?;
            unlocked.write(SECRET_MEMBER_EXCHANGE, exchange_secret.as_slice())?;
            unlocked.write(SECRET_DEVICE_SIGN, device.secret().as_slice())?;
            Ok::<_, CollectiveStoreError>((
                member.public(),
                device.public(),
                recovery_text(recovery.as_bytes()),
            ))
        })
        .await
        .map_err(|error| CollectiveStoreError::Io(error.to_string()))??;
        let member_id = member_public.member_id();
        let inserted = sqlx::query(
            "INSERT INTO collective_identities
                 (profile_id, member_id, sign_pub, exchange_pub, device_pub, created_at)
             VALUES (?, ?, ?, ?, ?, ?)",
        )
        .bind(profile_id)
        .bind(member_id.as_slice())
        .bind(member_public.sign.as_slice())
        .bind(member_public.exchange.as_slice())
        .bind(device_public.0.as_slice())
        .bind(now)
        .execute(&self.pool)
        .await;
        if let Err(error) = inserted {
            // Без запису в базі сховище нічого не означає: не лишаємо сиріт.
            let _ = std::fs::remove_file(secret_store_path(&self.secrets_dir, profile_id));
            return Err(error.into());
        }
        Ok(CreatedIdentity {
            identity: IdentitySummary {
                fingerprint: fingerprint(&member_id),
                device_fingerprint: fingerprint(&sha256(&[FINGERPRINT_LABEL, &device_public.0])),
                created_at: now.to_owned(),
            },
            recovery_key: recovery,
        })
    }

    async fn has_identity(&self, profile_id: &str) -> Result<bool, CollectiveStoreError> {
        Ok(
            sqlx::query("SELECT 1 FROM collective_identities WHERE profile_id = ?")
                .bind(profile_id)
                .fetch_optional(&self.pool)
                .await?
                .is_some(),
        )
    }

    /// Новий захищений колектив: випадковий ідентифікатор, власник вступає з підписаним
    /// зв'язуванням ключа обміну (seq 1) і підтверджує свій пристрій (seq 2).
    pub async fn create_collective(
        &self,
        profile_id: &str,
        password: Zeroizing<String>,
        name: &str,
        now: &str,
        now_unix: i64,
    ) -> Result<CollectiveSummary, CollectiveStoreError> {
        check_password(&password)?;
        let retry = password.clone();
        let name = collective_name(name)?;
        let row = sqlx::query(
            "SELECT sign_pub, exchange_pub, device_pub FROM collective_identities WHERE profile_id = ?",
        )
        .bind(profile_id)
        .fetch_optional(&self.pool)
        .await?
        .ok_or(CollectiveStoreError::IdentityMissing)?;
        let expected: (Vec<u8>, Vec<u8>, Vec<u8>) = (row.get(0), row.get(1), row.get(2));
        let count: i64 =
            sqlx::query_scalar("SELECT count(*) FROM collectives WHERE profile_id = ?")
                .bind(profile_id)
                .fetch_one(&self.pool)
                .await?;
        if count >= MAX_COLLECTIVES {
            return Err(CollectiveStoreError::TooManyCollectives);
        }
        let store = self.secret_store(profile_id);
        let known = self.known_collective_ids(profile_id).await;
        let records = tokio::task::spawn_blocking(move || {
            let mut unlocked = store.unlock(password.as_bytes())?;
            let (member, device) = identities(&unlocked)?;
            let public = member.public();
            if public.sign.as_slice() != expected.0
                || public.exchange.as_slice() != expected.1
                || device.public().0.as_slice() != expected.2
            {
                return Err(CollectiveStoreError::StoreDamaged);
            }
            let collective_id: CollectiveId = random_array();
            let mut membership = InMemoryMembership::new(collective_id);
            membership
                .join(&member.bind_exchange(collective_id, now_unix))
                .map_err(|_| CollectiveStoreError::StoreDamaged)?;
            membership
                .add_device(&member.issue_device(&device.public(), now_unix))
                .map_err(|_| CollectiveStoreError::StoreDamaged)?;
            // Після автентифікації прибрати осиротілі ключі цього профілю (SEC-004); помилка
            // прибирання не зупиняє створення.
            let orphans = orphan_epoch_purposes(unlocked.purposes(), known.as_ref());
            let _ = unlocked.delete_many(&orphans);
            // Ключ епохи 0 — лише у сховищі секретів; без нього колектив не запечатає жодного
            // конверта й не впустить нового учасника.
            unlocked.write(
                &epoch_purpose(&collective_id, 0),
                EpochKey::generate().as_bytes(),
            )?;
            Ok::<_, CollectiveStoreError>((collective_id, membership.records().to_vec()))
        })
        .await
        .map_err(|error| CollectiveStoreError::Io(error.to_string()))??;
        let (collective_id, records) = records;
        // Ключ епохи 0 уже в сховищі; якщо SQL не вдався, він прибирається (E8-SEC-001).
        let stored = async {
            let mut tx = self.pool.begin().await?;
            sqlx::query(
                "INSERT INTO collectives (profile_id, collective_id, name, created_at) VALUES (?, ?, ?, ?)",
            )
            .bind(profile_id)
            .bind(collective_id.as_slice())
            .bind(&name)
            .bind(now)
            .execute(&mut *tx)
            .await?;
            for (index, record) in records.iter().enumerate() {
                sqlx::query(
                    "INSERT INTO collective_membership_log
                         (profile_id, collective_id, seq, record, recorded_at)
                     VALUES (?, ?, ?, ?, ?)",
                )
                .bind(profile_id)
                .bind(collective_id.as_slice())
                .bind(index as i64 + 1)
                .bind(record.to_bytes())
                .bind(now)
                .execute(&mut *tx)
                .await?;
            }
            tx.commit().await?;
            Ok::<_, CollectiveStoreError>(())
        }
        .await;
        if let Err(error) = stored {
            self.forget_secrets(profile_id, retry, vec![epoch_purpose(&collective_id, 0)])
                .await;
            return Err(error);
        }
        Ok(CollectiveSummary {
            fingerprint: fingerprint(&collective_id),
            name,
            created_at: now.to_owned(),
            members: 1,
            latest_seq: records.len() as u64,
            rejected_records: 0,
        })
    }
}

pub(crate) fn identities(
    unlocked: &UnlockedStore,
) -> Result<(MemberIdentity, DeviceIdentity), CollectiveStoreError> {
    let secret = |purpose: &str| -> Result<[u8; KEY_LEN], CollectiveStoreError> {
        let bytes = unlocked
            .read(purpose)?
            .ok_or(CollectiveStoreError::StoreDamaged)?;
        <[u8; KEY_LEN]>::try_from(bytes.as_slice()).map_err(|_| CollectiveStoreError::StoreDamaged)
    };
    let sign = Zeroizing::new(secret(SECRET_MEMBER_SIGN)?);
    let exchange = Zeroizing::new(secret(SECRET_MEMBER_EXCHANGE)?);
    let device = Zeroizing::new(secret(SECRET_DEVICE_SIGN)?);
    Ok((
        MemberIdentity::from_secrets(&sign, &exchange),
        DeviceIdentity::from_secret(&device),
    ))
}

pub(crate) fn check_password(password: &str) -> Result<(), CollectiveStoreError> {
    if (MIN_PASSWORD_BYTES..=MAX_PASSWORD_BYTES).contains(&password.len()) {
        Ok(())
    } else {
        Err(CollectiveStoreError::PasswordLength)
    }
}

pub(crate) fn collective_name(name: &str) -> Result<String, CollectiveStoreError> {
    let name = name.split_whitespace().collect::<Vec<_>>().join(" ");
    let chars = name.chars().count();
    if chars == 0 || chars > 80 || name.chars().any(is_control_or_format) {
        return Err(CollectiveStoreError::InvalidName);
    }
    Ok(name)
}

/// Керівні знаки (Cc) і знаки форматування (Cf), зокрема перемикачі напрямку тексту.
fn is_control_or_format(c: char) -> bool {
    c.is_control()
        || matches!(c, '\u{00AD}' | '\u{061C}' | '\u{180E}' | '\u{FEFF}')
        || ('\u{200B}'..='\u{200F}').contains(&c)
        || ('\u{202A}'..='\u{202E}').contains(&c)
        || ('\u{2060}'..='\u{2064}').contains(&c)
        || ('\u{2066}'..='\u{206F}').contains(&c)
}

/// Мітка ключа епохи у сховищі секретів профілю: `collective/epoch/<id>/<n>`.
/// Ключі епох у сховищі профілю, для яких у базі цього профілю немає колективу
/// (залишок аварії між записом ключів і `commit`, SEC-004). `known == None` — читання бази
/// не вдалося: тоді не прибирається нічого, щоб не зачепити ключі чинних колективів.
pub(crate) fn orphan_epoch_purposes<'a>(
    purposes: impl IntoIterator<Item = &'a str>,
    known: Option<&HashSet<CollectiveId>>,
) -> Vec<String> {
    let Some(known) = known else {
        return Vec::new();
    };
    let keep: HashSet<String> = known
        .iter()
        .map(|id| id.iter().map(|b| format!("{b:02x}")).collect())
        .collect();
    purposes
        .into_iter()
        .filter(|purpose| {
            purpose
                .strip_prefix("collective/epoch/")
                .and_then(|rest| rest.split('/').next())
                .is_some_and(|id| !keep.contains(id))
        })
        .map(str::to_owned)
        .collect()
}

pub(crate) fn epoch_purpose(collective_id: &CollectiveId, epoch: u32) -> String {
    let id: String = collective_id.iter().map(|b| format!("{b:02x}")).collect();
    format!("collective/epoch/{id}/{epoch}")
}

/// Файл сховища ключів профілю. Ідентифікатор профілю входить у назву лише як hex від
/// SHA-256, тож у шляху немає довільного тексту.
pub fn secret_store_path(dir: &Path, profile_id: &str) -> PathBuf {
    let digest = sha256(&[b"easywar/collective/v1/store-file", profile_id.as_bytes()]);
    let name: String = digest[..16].iter().map(|b| format!("{b:02x}")).collect();
    dir.join(format!("{name}.ewkeys"))
}

const BASE32: &[u8; 32] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

pub(crate) fn base32(bytes: &[u8]) -> String {
    let mut out = String::with_capacity(bytes.len().div_ceil(5) * 8);
    let mut buffer: u32 = 0;
    let mut bits = 0;
    for &byte in bytes {
        buffer = (buffer << 8) | u32::from(byte);
        bits += 8;
        while bits >= 5 {
            bits -= 5;
            out.push(BASE32[((buffer >> bits) & 31) as usize] as char);
        }
    }
    if bits > 0 {
        out.push(BASE32[((buffer << (5 - bits)) & 31) as usize] as char);
    }
    out
}

/// Відбиток для інтерфейсу: перші 10 символів base32, `ABCDE-FGHIJ`.
pub fn fingerprint(bytes: &[u8]) -> String {
    let text = base32(bytes);
    format!("{}-{}", &text[..5], &text[5..10])
}

/// Ключ відновлення для показу: base32 групами по чотири.
fn recovery_text(bytes: &[u8; KEY_LEN]) -> String {
    let text = base32(bytes);
    text.as_bytes()
        .chunks(4)
        .map(|chunk| std::str::from_utf8(chunk).expect("base32 — ASCII"))
        .collect::<Vec<_>>()
        .join("-")
}

#[allow(dead_code)]
const _ID_LEN_IS_SIXTEEN: () = assert!(ID_LEN == 16);

#[cfg(test)]
mod tests {
    use super::*;
    use crate::database::{COLLECTIVES_SQL, LOCAL_PROFILES_SQL};
    use sqlx::sqlite::SqlitePoolOptions;

    const PROFILE: &str = "profile-111111111111111111111111";
    const OTHER: &str = "profile-222222222222222222222222";
    const T1: &str = "2026-10-29T20:00:00Z";
    const UNIX: i64 = 1_761_768_000;

    fn password(text: &str) -> Zeroizing<String> {
        Zeroizing::new(text.to_owned())
    }

    async fn store() -> (CollectiveStore, tempfile::TempDir) {
        let pool = SqlitePoolOptions::new()
            .max_connections(1)
            .connect("sqlite::memory:")
            .await
            .unwrap();
        for sql in [LOCAL_PROFILES_SQL, COLLECTIVES_SQL] {
            sqlx::raw_sql(sql).execute(&pool).await.unwrap();
        }
        for (id, name) in [(PROFILE, "Перший"), (OTHER, "Другий")] {
            sqlx::query(
                "INSERT INTO local_profiles (id, display_name, name_key, created_at, updated_at)
                 VALUES (?, ?, ?, ?, ?)",
            )
            .bind(id)
            .bind(name)
            .bind(name.to_lowercase())
            .bind(T1)
            .bind(T1)
            .execute(&pool)
            .await
            .unwrap();
        }
        let dir = tempfile::tempdir().unwrap();
        (
            CollectiveStore::for_tests(pool, dir.path().join("collective-keys")),
            dir,
        )
    }

    #[test]
    fn base32_and_fingerprint_match_rfc4648() {
        // RFC 4648, розділ 10.
        assert_eq!(base32(b""), "");
        assert_eq!(base32(b"f"), "MY");
        assert_eq!(base32(b"foobar"), "MZXW6YTBOI");
        assert_eq!(fingerprint(b"foobar"), "MZXW6-YTBOI");
        let recovery = recovery_text(&[0u8; KEY_LEN]);
        assert_eq!(recovery.len(), 52 + 12);
        assert!(recovery.starts_with("AAAA-AAAA-"));
    }

    #[test]
    fn store_file_name_does_not_contain_the_profile_text() {
        let path = secret_store_path(Path::new("/keys"), "../../etc/passwd");
        let name = path.file_name().unwrap().to_str().unwrap();
        assert!(name.ends_with(".ewkeys"));
        assert_eq!(name.len(), 32 + ".ewkeys".len());
        assert_eq!(path.parent(), Some(Path::new("/keys")));
    }

    #[test]
    fn names_and_passwords_are_validated() {
        assert_eq!(
            collective_name("  Навчальна   група ").unwrap(),
            "Навчальна група"
        );
        for bad in ["", "   ", "А\u{202e}Б", "x\u{0007}", &"я".repeat(81)] {
            assert!(collective_name(bad).is_err(), "{bad:?}");
        }
        assert!(check_password("1234567").is_err());
        assert!(check_password("12345678").is_ok());
        assert!(check_password(&"a".repeat(1025)).is_err());
    }

    #[tokio::test]
    async fn identity_is_created_once_and_secrets_stay_out_of_the_database() {
        let (store, _dir) = store().await;
        let empty = store.status(PROFILE).await.unwrap();
        assert_eq!(empty.key_store, "absent");
        assert!(empty.identity.is_none());

        let created = store
            .create_identity(PROFILE, password("синтетичний-пароль"), T1)
            .await
            .unwrap();
        assert_eq!(created.identity.fingerprint.len(), 11);
        assert_eq!(created.recovery_key.len(), 64);
        let status = store.status(PROFILE).await.unwrap();
        assert_eq!(status.key_store, "locked");
        assert_eq!(status.identity, Some(created.identity.clone()));

        assert!(matches!(
            store
                .create_identity(PROFILE, password("синтетичний-пароль"), T1)
                .await,
            Err(CollectiveStoreError::IdentityExists)
        ));
        // В іншого профілю — свій ключ.
        assert!(store.status(OTHER).await.unwrap().identity.is_none());

        // У базі лише відкриті ключі по 32 байти; секретів у рядку немає.
        let row =
            sqlx::query("SELECT sign_pub, exchange_pub, device_pub FROM collective_identities")
                .fetch_one(&store.pool)
                .await
                .unwrap();
        let unlocked = store
            .secret_store(PROFILE)
            .unlock("синтетичний-пароль".as_bytes())
            .unwrap();
        let (member, device) = identities(&unlocked).unwrap();
        assert_eq!(row.get::<Vec<u8>, _>(0), member.public().sign.to_vec());
        assert_eq!(row.get::<Vec<u8>, _>(1), member.public().exchange.to_vec());
        assert_eq!(row.get::<Vec<u8>, _>(2), device.public().0.to_vec());
        let file = std::fs::read(store.secret_store(PROFILE).path()).unwrap();
        let (seed, exchange) = member.secrets();
        for secret in [
            seed.as_slice(),
            exchange.as_slice(),
            device.secret().as_slice(),
        ] {
            assert!(
                !file.windows(KEY_LEN).any(|window| window == secret),
                "секрет у файлі відкритим текстом"
            );
        }
    }

    #[tokio::test]
    async fn short_password_is_rejected_before_anything_is_written() {
        let (store, _dir) = store().await;
        assert!(matches!(
            store.create_identity(PROFILE, password("short"), T1).await,
            Err(CollectiveStoreError::PasswordLength)
        ));
        assert_eq!(store.status(PROFILE).await.unwrap().key_store, "absent");
    }

    #[tokio::test]
    async fn owner_creates_a_collective_with_a_verified_two_record_journal() {
        let (store, _dir) = store().await;
        assert!(matches!(
            store
                .create_collective(PROFILE, password("синтетичний-пароль"), "Група", T1, UNIX)
                .await,
            Err(CollectiveStoreError::IdentityMissing)
        ));
        store
            .create_identity(PROFILE, password("синтетичний-пароль"), T1)
            .await
            .unwrap();
        assert!(matches!(
            store
                .create_collective(PROFILE, password("не-той-пароль"), "Група", T1, UNIX)
                .await,
            Err(CollectiveStoreError::WrongPassword)
        ));
        let created = store
            .create_collective(
                PROFILE,
                password("синтетичний-пароль"),
                " Навчальна  група ",
                T1,
                UNIX,
            )
            .await
            .unwrap();
        assert_eq!(created.name, "Навчальна група");
        assert_eq!((created.members, created.latest_seq), (1, 2));

        let status = store.status(PROFILE).await.unwrap();
        assert_eq!(status.collectives, vec![created.clone()]);
        assert!(store.status(OTHER).await.unwrap().collectives.is_empty());

        // Журнал у базі — підписані записи: вступ власника і його пристрій.
        let records: Vec<Vec<u8>> =
            sqlx::query_scalar("SELECT record FROM collective_membership_log ORDER BY seq")
                .fetch_all(&store.pool)
                .await
                .unwrap();
        assert_eq!(records.len(), 2);
        assert!(matches!(
            MembershipRecord::from_bytes(&records[0]).unwrap(),
            MembershipRecord::Join(_)
        ));
        assert!(matches!(
            MembershipRecord::from_bytes(&records[1]).unwrap(),
            MembershipRecord::AddDevice(_)
        ));
    }

    #[tokio::test]
    async fn tampered_journal_row_gives_no_member() {
        let (store, _dir) = store().await;
        store
            .create_identity(PROFILE, password("синтетичний-пароль"), T1)
            .await
            .unwrap();
        store
            .create_collective(PROFILE, password("синтетичний-пароль"), "Група", T1, UNIX)
            .await
            .unwrap();
        let mut join: Vec<u8> =
            sqlx::query_scalar("SELECT record FROM collective_membership_log WHERE seq = 1")
                .fetch_one(&store.pool)
                .await
                .unwrap();
        // Підміна ключа обміну в записі вступу ламає підпис зв'язування.
        join[1 + KEY_LEN] ^= 1;
        sqlx::query("UPDATE collective_membership_log SET record = ? WHERE seq = 1")
            .bind(join)
            .execute(&store.pool)
            .await
            .unwrap();
        let status = store.status(PROFILE).await.unwrap();
        let summary = &status.collectives[0];
        assert_eq!(
            (
                summary.members,
                summary.latest_seq,
                summary.rejected_records
            ),
            (0, 0, 2)
        );
    }

    #[tokio::test]
    async fn collectives_per_profile_are_limited() {
        let (store, _dir) = store().await;
        store
            .create_identity(PROFILE, password("синтетичний-пароль"), T1)
            .await
            .unwrap();
        for index in 0..MAX_COLLECTIVES {
            sqlx::query(
                "INSERT INTO collectives (profile_id, collective_id, name, created_at) VALUES (?, ?, ?, ?)",
            )
            .bind(PROFILE)
            .bind([index as u8; ID_LEN].as_slice())
            .bind("Синтетичний")
            .bind(T1)
            .execute(&store.pool)
            .await
            .unwrap();
        }
        assert!(matches!(
            store
                .create_collective(PROFILE, password("синтетичний-пароль"), "Ще один", T1, UNIX)
                .await,
            Err(CollectiveStoreError::TooManyCollectives)
        ));
    }

    #[tokio::test]
    async fn deleting_the_profile_removes_its_collective_rows() {
        let (store, _dir) = store().await;
        sqlx::raw_sql("PRAGMA foreign_keys = ON")
            .execute(&store.pool)
            .await
            .unwrap();
        store
            .create_identity(PROFILE, password("синтетичний-пароль"), T1)
            .await
            .unwrap();
        store
            .create_collective(PROFILE, password("синтетичний-пароль"), "Група", T1, UNIX)
            .await
            .unwrap();
        sqlx::query("DELETE FROM local_profiles WHERE id = ?")
            .bind(PROFILE)
            .execute(&store.pool)
            .await
            .unwrap();
        for table in [
            "collective_identities",
            "collectives",
            "collective_membership_log",
        ] {
            let count: i64 = sqlx::query_scalar(&format!("SELECT count(*) FROM {table}"))
                .fetch_one(&store.pool)
                .await
                .unwrap();
            assert_eq!(count, 0, "{table}");
        }
    }
}
