//! Обмін у колективі на вузлі (E8, C3b, другий зріз; рішення JE 29.10.2026 23:19Z «Так:
//! команди і 0020»). Поверх `CollectiveStore` (#205) і бібліотеки `collective::`:
//!
//! - таблиці колективу з класом і призначенням, підтвердженими власником (міграція 0020); з
//!   них `send_gate` рахує чинний клас;
//! - вступ за запрошенням без мережі: талон, відповідь і пакет ключів передаються як текст
//!   (`EWINV1.` / `EWJOIN1.` / `EWKEYS1.`), який люди пересилають самі;
//! - «Доповісти»: операція підписується пристроєм, проходить `authorize_send` з
//!   `GatePolicy::CURRENT` і кладеться в **локальну** чергу відправки (`OfflineMailbox`).
//!   Транспорту немає: черга нікуди не передається до окремого рішення власника.
//!
//! Назовні (у JS) — лише відбитки, назви, лічильники, коди відмов і тексти для пересилання;
//! жодного секрету чи ключа епохи у відкритому вигляді.

use std::path::PathBuf;

use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use base64::Engine;
use serde::Serialize;
use sqlx::{Row, Sqlite, Transaction};
use zeroize::Zeroizing;

use crate::collective::codec::{Reader, Writer};
use crate::collective::envelope::Payload;
use crate::collective::epoch::{CollectiveId, EpochKey, EpochWrap};
use crate::collective::identity::{DeviceIdentity, MemberId, MemberIdentity};
use crate::collective::invite::{self, Invitation, InvitationLedger, JoinRequest};
use crate::collective::relay::OfflineMailbox;
use crate::collective::relay_auth::COLLECTIVE_SCOPE;
use crate::collective::replay::{InMemoryMembership, MembershipRecord, MembershipView};
use crate::collective::secret_store::UnlockedStore;
use crate::collective::send_gate::{
    authorize_send, GatePolicy, OutboundPolicy, SendRequest, TableAttestation, TableClass,
    TablePurpose, Transport,
};
use crate::collective::{random_array, sha256, ID_LEN, KEY_LEN};
use crate::collective_store::{
    check_password, collective_name, epoch_purpose, fingerprint, identities, CollectiveStore,
    CollectiveStoreError, CollectiveSummary, MAX_COLLECTIVES,
};

const INVITE_PREFIX: &str = "EWINV1.";
const JOIN_PREFIX: &str = "EWJOIN1.";
const KEYS_PREFIX: &str = "EWKEYS1.";
/// Найбільший текст для вставки (пакет ключів з журналом складу).
const MAX_TEXT_BYTES: usize = 256 * 1024;
/// Найбільша операція «Доповісти».
pub const MAX_OPERATION_BYTES: usize = 64 * 1024;
/// Скільки зберігається конверт у локальній черзі відправки.
pub const OUTBOX_TTL_SECONDS: i64 = 24 * 60 * 60;
/// Квота локальної черги відправки одного колективу.
const OUTBOX_CAPACITY_BYTES: usize = 16 * 1024 * 1024;
const OUTBOX_FILE_LABEL: &[u8] = b"easywar/collective/v1/outbox-file";

type Result<T> = std::result::Result<T, CollectiveStoreError>;

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TableSummary {
    pub fingerprint: String,
    pub title: String,
    /// Чинний клас (непідтверджене власником або планове — D).
    pub class: char,
    /// Клас, який вказав власник.
    pub declared_class: char,
    pub purpose: &'static str,
    /// Таблиця цього профілю: лише власник змінює клас і призначення.
    pub mine: bool,
    /// Цей профіль має право запису за журналом складу.
    pub can_write: bool,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CollectiveDetail {
    pub fingerprint: String,
    pub name: String,
    pub epoch: u32,
    pub latest_seq: u64,
    pub members: Vec<String>,
    pub tables: Vec<TableSummary>,
    /// Конверти в локальній черзі відправки.
    pub outbox: usize,
    /// Чинна політика транспортів: обидва `false`, доки власник не прийме транспорт.
    pub wan_accepted: bool,
    pub base44_accepted: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InvitationText {
    pub text: String,
    pub expires_at: i64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct JoinRequestText {
    pub text: String,
    pub collective_fingerprint: String,
    /// Відбиток запрошувача: звірте його голосом чи особисто.
    pub inviter_fingerprint: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AdmissionText {
    pub member_fingerprint: String,
    /// Пакет ключів для запрошеного; відкритих ключів у ньому немає.
    pub text: String,
    pub latest_seq: u64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct JoinedCollective {
    pub collective: CollectiveSummary,
    /// Відбитки учасників за перевіреним журналом: звірте із запрошувачем.
    pub members: Vec<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ReportOutcome {
    pub allowed: bool,
    pub code: &'static str,
    pub message: &'static str,
    pub outbox: usize,
}

struct Me {
    member_id: MemberId,
    device_pub: [u8; KEY_LEN],
}

struct StoredTable {
    title: String,
    attestation: TableAttestation,
}

impl CollectiveStore {
    async fn me(&self, profile_id: &str) -> Result<Me> {
        let row = sqlx::query(
            "SELECT member_id, device_pub FROM collective_identities WHERE profile_id = ?",
        )
        .bind(profile_id)
        .fetch_optional(&self.pool)
        .await?
        .ok_or(CollectiveStoreError::IdentityMissing)?;
        Ok(Me {
            member_id: blob(row.get(0))?,
            device_pub: blob(row.get(1))?,
        })
    }

    /// Колектив за відбитком (як його бачить людина на екрані).
    async fn find_collective(
        &self,
        profile_id: &str,
        wanted: &str,
    ) -> Result<(CollectiveId, String)> {
        let rows = sqlx::query("SELECT collective_id, name FROM collectives WHERE profile_id = ?")
            .bind(profile_id)
            .fetch_all(&self.pool)
            .await?;
        for row in rows {
            let Ok(id) = blob::<ID_LEN>(row.get(0)) else {
                continue;
            };
            if fingerprint(&id) == wanted {
                return Ok((id, row.get(1)));
            }
        }
        Err(CollectiveStoreError::CollectiveNotFound)
    }

    async fn tables(
        &self,
        profile_id: &str,
        collective_id: &CollectiveId,
    ) -> Result<Vec<StoredTable>> {
        let rows = sqlx::query(
            "SELECT table_id, title, owner, class, class_confirmed_by, purpose, purpose_confirmed_by
             FROM collective_tables WHERE profile_id = ? AND collective_id = ?
             ORDER BY updated_at, table_id",
        )
        .bind(profile_id)
        .bind(collective_id.as_slice())
        .fetch_all(&self.pool)
        .await?;
        rows.into_iter()
            .map(|row| {
                let class: String = row.get(3);
                let purpose: String = row.get(5);
                Ok(StoredTable {
                    title: row.get(1),
                    attestation: TableAttestation {
                        table_id: blob(row.get(0))?,
                        owner: blob(row.get(2))?,
                        class: parse_class(&class)?,
                        class_confirmed_by: optional_blob(row.get(4))?,
                        purpose: parse_purpose(&purpose)?,
                        purpose_confirmed_by: optional_blob(row.get(6))?,
                    },
                })
            })
            .collect()
    }

    /// Секрети учасника під паролем, звірені з відкритими ключами в базі.
    async fn with_secrets<T, F>(
        &self,
        profile_id: &str,
        password: Zeroizing<String>,
        work: F,
    ) -> Result<T>
    where
        T: Send + 'static,
        F: FnOnce(&mut UnlockedStore, &MemberIdentity, &DeviceIdentity) -> Result<T>
            + Send
            + 'static,
    {
        check_password(&password)?;
        let row = sqlx::query(
            "SELECT sign_pub, exchange_pub, device_pub FROM collective_identities WHERE profile_id = ?",
        )
        .bind(profile_id)
        .fetch_optional(&self.pool)
        .await?
        .ok_or(CollectiveStoreError::IdentityMissing)?;
        let expected: (Vec<u8>, Vec<u8>, Vec<u8>) = (row.get(0), row.get(1), row.get(2));
        let store = self.secret_store(profile_id);
        tokio::task::spawn_blocking(move || {
            let mut unlocked = store.unlock(password.as_bytes())?;
            let (member, device) = identities(&unlocked)?;
            let public = member.public();
            if public.sign.as_slice() != expected.0
                || public.exchange.as_slice() != expected.1
                || device.public().0.as_slice() != expected.2
            {
                return Err(CollectiveStoreError::StoreDamaged);
            }
            work(&mut unlocked, &member, &device)
        })
        .await
        .map_err(|error| CollectiveStoreError::Io(error.to_string()))?
    }

    fn outbox_path(&self, profile_id: &str, collective_id: &CollectiveId) -> PathBuf {
        let digest = sha256(&[OUTBOX_FILE_LABEL, profile_id.as_bytes(), collective_id]);
        let name: String = digest[..16].iter().map(|b| format!("{b:02x}")).collect();
        self.secrets_dir
            .with_file_name("collective-outbox")
            .join(format!("{name}.queue"))
    }

    async fn outbox_len(
        &self,
        profile_id: &str,
        collective_id: &CollectiveId,
        now: i64,
    ) -> Result<usize> {
        let path = self.outbox_path(profile_id, collective_id);
        tokio::task::spawn_blocking(move || {
            if !path.exists() {
                return Ok(0);
            }
            let mailbox = OfflineMailbox::open(&path, OUTBOX_CAPACITY_BYTES)
                .map_err(|error| CollectiveStoreError::Io(error.to_string()))?;
            Ok(count_scope(&mailbox, now))
        })
        .await
        .map_err(|error| CollectiveStoreError::Io(error.to_string()))?
    }

    /// Склад, таблиці й черга відправки одного колективу.
    pub async fn detail(
        &self,
        profile_id: &str,
        collective_fp: &str,
        now: i64,
    ) -> Result<CollectiveDetail> {
        let (collective_id, name) = self.find_collective(profile_id, collective_fp).await?;
        let me = self.me(profile_id).await?;
        let (membership, _) = self.load_journal(profile_id, &collective_id).await?;
        let latest = membership.latest_seq();
        let mut members: Vec<String> = membership
            .records()
            .iter()
            .filter_map(|record| match record {
                MembershipRecord::Join(binding) => binding.verify(&collective_id).ok(),
                _ => None,
            })
            .filter(|bound| membership.revoked_at(&bound.member_id()).is_none())
            .map(|bound| fingerprint(&bound.member_id()))
            .collect();
        members.dedup();
        let tables = self
            .tables(profile_id, &collective_id)
            .await?
            .into_iter()
            .map(|table| summary(&table, &me, &membership, latest))
            .collect();
        Ok(CollectiveDetail {
            fingerprint: fingerprint(&collective_id),
            name,
            epoch: membership.current_epoch(),
            latest_seq: latest,
            members,
            tables,
            outbox: self.outbox_len(profile_id, &collective_id, now).await?,
            wan_accepted: GatePolicy::CURRENT.wan_transport_accepted,
            base44_accepted: GatePolicy::CURRENT.base44_accepted,
        })
    }

    /// Нова таблиця колективу (власник — цей профіль, право запису — записом журналу) або
    /// зміна класу, призначення й назви своєї таблиці. Клас і призначення підтверджує той, хто
    /// їх ставить, тобто власник.
    #[allow(clippy::too_many_arguments)]
    pub async fn set_table(
        &self,
        profile_id: &str,
        collective_fp: &str,
        table_fp: Option<&str>,
        title: &str,
        class: &str,
        purpose: &str,
        now: &str,
    ) -> Result<TableSummary> {
        let title = collective_name(title).map_err(|_| CollectiveStoreError::InvalidTitle)?;
        let class = parse_class(class)?;
        let purpose = parse_purpose(purpose)?;
        let (collective_id, _) = self.find_collective(profile_id, collective_fp).await?;
        let me = self.me(profile_id).await?;
        let (mut membership, _) = self.load_journal(profile_id, &collective_id).await?;
        if membership.bound_member(&me.member_id).is_none() {
            return Err(CollectiveStoreError::NotAMember);
        }
        // Пошук своєї таблиці — до транзакції: вона тримає з'єднання.
        let existing = match table_fp {
            None => None,
            Some(wanted) => {
                let table = self
                    .tables(profile_id, &collective_id)
                    .await?
                    .into_iter()
                    .find(|table| fingerprint(&table.attestation.table_id) == wanted)
                    .ok_or(CollectiveStoreError::TableNotFound)?;
                if table.attestation.owner != me.member_id {
                    return Err(CollectiveStoreError::NotTableOwner);
                }
                Some(table)
            }
        };
        let mut tx = self.pool.begin().await?;
        let attestation = match existing {
            None => {
                let table_id: [u8; ID_LEN] = random_array();
                let seq = membership.grant_table(&me.member_id, table_id);
                append_records(
                    &mut tx,
                    profile_id,
                    &collective_id,
                    &membership,
                    seq,
                    seq,
                    now,
                )
                .await?;
                sqlx::query(
                    "INSERT INTO collective_tables (profile_id, collective_id, table_id, title, owner,
                         class, class_confirmed_by, purpose, purpose_confirmed_by, updated_at)
                     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                )
                .bind(profile_id)
                .bind(collective_id.as_slice())
                .bind(table_id.as_slice())
                .bind(&title)
                .bind(me.member_id.as_slice())
                .bind(class_text(class))
                .bind(me.member_id.as_slice())
                .bind(purpose_text(purpose))
                .bind(me.member_id.as_slice())
                .bind(now)
                .execute(&mut *tx)
                .await?;
                TableAttestation {
                    table_id,
                    owner: me.member_id,
                    class,
                    class_confirmed_by: Some(me.member_id),
                    purpose,
                    purpose_confirmed_by: Some(me.member_id),
                }
            }
            Some(table) => {
                sqlx::query(
                    "UPDATE collective_tables SET title = ?, class = ?, class_confirmed_by = ?,
                         purpose = ?, purpose_confirmed_by = ?, updated_at = ?
                     WHERE profile_id = ? AND collective_id = ? AND table_id = ?",
                )
                .bind(&title)
                .bind(class_text(class))
                .bind(me.member_id.as_slice())
                .bind(purpose_text(purpose))
                .bind(me.member_id.as_slice())
                .bind(now)
                .bind(profile_id)
                .bind(collective_id.as_slice())
                .bind(table.attestation.table_id.as_slice())
                .execute(&mut *tx)
                .await?;
                TableAttestation {
                    class,
                    class_confirmed_by: Some(me.member_id),
                    purpose,
                    purpose_confirmed_by: Some(me.member_id),
                    ..table.attestation
                }
            }
        };
        tx.commit().await?;
        let table = StoredTable { title, attestation };
        Ok(summary(&table, &me, &membership, membership.latest_seq()))
    }

    /// Одноразовий талон запрошення від учасника цього профілю.
    pub async fn create_invitation(
        &self,
        profile_id: &str,
        password: Zeroizing<String>,
        collective_fp: &str,
        hours: i64,
        now_unix: i64,
    ) -> Result<InvitationText> {
        if !(1..=168).contains(&hours) {
            return Err(CollectiveStoreError::InvalidInvitationHours);
        }
        let (collective_id, _) = self.find_collective(profile_id, collective_fp).await?;
        let (membership, _) = self.load_journal(profile_id, &collective_id).await?;
        self.with_secrets(profile_id, password, move |_, member, _| {
            let invitation =
                Invitation::issue(member, collective_id, now_unix, now_unix + hours * 3600)
                    .map_err(rejected)?;
            invitation.verify(&membership, now_unix).map_err(rejected)?;
            Ok(InvitationText {
                text: encode(INVITE_PREFIX, &invitation.to_bytes()),
                expires_at: invitation.expires_at,
            })
        })
        .await
    }

    /// Запрошений: відповідь на талон (зв'язування ключа обміну й перший пристрій).
    pub async fn join_request(
        &self,
        profile_id: &str,
        password: Zeroizing<String>,
        invitation_text: &str,
        now_unix: i64,
    ) -> Result<JoinRequestText> {
        let invitation = Invitation::from_bytes(&decode(INVITE_PREFIX, invitation_text)?)
            .map_err(|_| CollectiveStoreError::InvalidText)?;
        if self
            .find_collective(profile_id, &fingerprint(&invitation.collective_id))
            .await
            .is_ok()
        {
            return Err(CollectiveStoreError::AlreadyJoined);
        }
        self.with_secrets(profile_id, password, move |_, member, device| {
            let request = JoinRequest::build(invitation, member, &device.public(), now_unix);
            Ok(JoinRequestText {
                text: encode(JOIN_PREFIX, &request.to_bytes()),
                collective_fingerprint: fingerprint(&invitation.collective_id),
                inviter_fingerprint: fingerprint(&invitation.inviter),
            })
        })
        .await
    }

    /// Вузол із журналом впускає запрошеного й повертає пакет ключів для нього.
    pub async fn admit(
        &self,
        profile_id: &str,
        password: Zeroizing<String>,
        collective_fp: &str,
        request_text: &str,
        now: &str,
        now_unix: i64,
    ) -> Result<AdmissionText> {
        let request = JoinRequest::from_bytes(&decode(JOIN_PREFIX, request_text)?)
            .map_err(|_| CollectiveStoreError::InvalidText)?;
        let (collective_id, name) = self.find_collective(profile_id, collective_fp).await?;
        let me = self.me(profile_id).await?;
        let (membership, _) = self.load_journal(profile_id, &collective_id).await?;
        if membership.bound_member(&me.member_id).is_none() {
            return Err(CollectiveStoreError::NotAMember);
        }
        let used: Vec<[u8; ID_LEN]> = sqlx::query_scalar::<_, Vec<u8>>(
            "SELECT nonce FROM collective_invitations_used WHERE profile_id = ? AND collective_id = ?",
        )
        .bind(profile_id)
        .bind(collective_id.as_slice())
        .fetch_all(&self.pool)
        .await?
        .into_iter()
        .filter_map(|nonce| blob(nonce).ok())
        .collect();
        let (membership, admission) = self
            .with_secrets(profile_id, password, move |unlocked, _, _| {
                let mut membership = membership;
                let keys = epoch_keys(unlocked, &collective_id, membership.current_epoch())?;
                let mut ledger = InvitationLedger::from_used(used);
                let admission =
                    invite::admit(&mut membership, &mut ledger, &keys, &request, now_unix)
                        .map_err(rejected)?;
                Ok((membership, admission))
            })
            .await?;
        let mut tx = self.pool.begin().await?;
        append_records(
            &mut tx,
            profile_id,
            &collective_id,
            &membership,
            admission.join_seq,
            admission.device_seq,
            now,
        )
        .await?;
        sqlx::query(
            "INSERT INTO collective_invitations_used (profile_id, collective_id, nonce, used_at)
             VALUES (?, ?, ?, ?)",
        )
        .bind(profile_id)
        .bind(collective_id.as_slice())
        .bind(request.invitation.nonce.as_slice())
        .bind(now)
        .execute(&mut *tx)
        .await?;
        tx.commit().await?;
        Ok(AdmissionText {
            member_fingerprint: fingerprint(&admission.member),
            text: encode(
                KEYS_PREFIX,
                &bundle(&collective_id, &name, &membership, &admission.wraps),
            ),
            latest_seq: membership.latest_seq(),
        })
    }

    /// Запрошений приймає пакет ключів: журнал складу перевіряється повністю, профіль має бути
    /// в ньому з цим пристроєм, ключі всіх епох мають розгорнутися його ключем обміну.
    pub async fn join_accept(
        &self,
        profile_id: &str,
        password: Zeroizing<String>,
        keys_text: &str,
        now: &str,
    ) -> Result<JoinedCollective> {
        let (collective_id, name, records, wraps) = unbundle(&decode(KEYS_PREFIX, keys_text)?)?;
        let name = collective_name(&name).map_err(|_| CollectiveStoreError::InvalidText)?;
        if self
            .find_collective(profile_id, &fingerprint(&collective_id))
            .await
            .is_ok()
        {
            return Err(CollectiveStoreError::AlreadyJoined);
        }
        let count: i64 =
            sqlx::query_scalar("SELECT count(*) FROM collectives WHERE profile_id = ?")
                .bind(profile_id)
                .fetch_one(&self.pool)
                .await?;
        if count >= MAX_COLLECTIVES {
            return Err(CollectiveStoreError::TooManyCollectives);
        }
        let mut membership = InMemoryMembership::new(collective_id);
        for (index, record) in records.iter().enumerate() {
            let seq = index as u64 + 1;
            if membership.apply(seq, record.clone()) != Ok(seq) {
                return Err(CollectiveStoreError::Rejected(
                    "журнал складу не пройшов перевірку",
                ));
            }
        }
        let me = self.me(profile_id).await?;
        let latest = membership.latest_seq();
        if membership.bound_member(&me.member_id).is_none()
            || !membership.device_valid_at(latest, &me.member_id, &me.device_pub)
        {
            return Err(CollectiveStoreError::NotAMember);
        }
        if wraps.len() != membership.current_epoch() as usize + 1
            || wraps.iter().any(|wrap| wrap.collective_id != collective_id)
        {
            return Err(CollectiveStoreError::Rejected(
                "ключі епох не відповідають журналу",
            ));
        }
        let members: Vec<String> = membership
            .records()
            .iter()
            .filter_map(|record| match record {
                MembershipRecord::Join(binding) => binding
                    .verify(&collective_id)
                    .ok()
                    .map(|bound| fingerprint(&bound.member_id())),
                _ => None,
            })
            .collect();
        self.with_secrets(profile_id, password, move |unlocked, member, _| {
            let keys = invite::accept(member, &wraps).map_err(rejected)?;
            for (epoch, key) in keys.iter().enumerate() {
                unlocked.write(&epoch_purpose(&collective_id, epoch as u32), key.as_bytes())?;
            }
            Ok(())
        })
        .await?;
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
        append_records(
            &mut tx,
            profile_id,
            &collective_id,
            &membership,
            1,
            latest,
            now,
        )
        .await?;
        tx.commit().await?;
        Ok(JoinedCollective {
            collective: CollectiveSummary {
                fingerprint: fingerprint(&collective_id),
                name,
                created_at: now.to_owned(),
                members: membership.active_members(),
                latest_seq: latest,
                rejected_records: 0,
            },
            members,
        })
    }

    /// «Доповісти»: операція підписується пристроєм профілю, проходить авторитетний допуск і
    /// лише тоді кладеться в локальну чергу відправки. Відмова — звичайна відповідь з кодом,
    /// не помилка.
    #[allow(clippy::too_many_arguments)]
    pub async fn report(
        &self,
        profile_id: &str,
        password: Zeroizing<String>,
        collective_fp: &str,
        table_fp: &str,
        transport: &str,
        explicit_wan: bool,
        reviewed: bool,
        operation: &str,
        now_unix: i64,
    ) -> Result<ReportOutcome> {
        if operation.is_empty() || operation.len() > MAX_OPERATION_BYTES {
            return Err(CollectiveStoreError::OperationSize);
        }
        let transport = parse_transport(transport)?;
        let (collective_id, _) = self.find_collective(profile_id, collective_fp).await?;
        let me = self.me(profile_id).await?;
        let (membership, _) = self.load_journal(profile_id, &collective_id).await?;
        let table = self
            .tables(profile_id, &collective_id)
            .await?
            .into_iter()
            .find(|table| fingerprint(&table.attestation.table_id) == table_fp)
            .ok_or(CollectiveStoreError::TableNotFound)?;
        let outbox = self.outbox_path(profile_id, &collective_id);
        let operation = operation.as_bytes().to_vec();
        let author = me.member_id;
        self.with_secrets(profile_id, password, move |unlocked, _, device| {
            let epoch = membership.current_epoch();
            let key = epoch_keys(unlocked, &collective_id, epoch)?
                .pop()
                .ok_or(CollectiveStoreError::EpochKeyMissing)?;
            let signed = Payload {
                op: operation,
                author_member_id: author,
                device_pub: device.public().0,
                client_time: now_unix,
                class: table.attestation.effective_class().code(),
                table_id: table.attestation.table_id,
                op_id: random_array(),
                membership_seq: membership.latest_seq(),
                expiry: None,
            }
            .sign(device);
            let request = SendRequest {
                table: &table.attestation,
                transport,
                outbound_policy: OutboundPolicy::ReviewEachReport,
                reviewed_by_human: reviewed,
                explicit_user_choice: explicit_wan,
                signed: &signed,
                recipient_scope: COLLECTIVE_SCOPE,
                now: now_unix,
            };
            let mut permit = match authorize_send(
                &GatePolicy::CURRENT,
                &membership,
                &collective_id,
                &key,
                &request,
            ) {
                Ok(permit) => permit,
                Err(denied) => {
                    return Ok(ReportOutcome {
                        allowed: false,
                        code: denied.code(),
                        message: denied.message(),
                        outbox: 0,
                    })
                }
            };
            let bytes = permit
                .take(now_unix)
                .ok_or(CollectiveStoreError::Rejected("допуск прострочено"))?;
            if let Some(dir) = outbox.parent() {
                std::fs::create_dir_all(dir).map_err(|error| CollectiveStoreError::Io(error.to_string()))?;
            }
            let mut mailbox = OfflineMailbox::open(&outbox, OUTBOX_CAPACITY_BYTES)
                .map_err(|error| CollectiveStoreError::Io(error.to_string()))?;
            mailbox
                .put(&bytes, now_unix + OUTBOX_TTL_SECONDS, now_unix)
                .map_err(|error| CollectiveStoreError::Io(error.to_string()))?;
            Ok(ReportOutcome {
                allowed: true,
                code: "queued",
                message: "Конверт у локальній черзі відправки; мережі немає, передача — після окремого рішення власника",
                outbox: count_scope(&mailbox, now_unix),
            })
        })
        .await
    }
}

fn summary(
    table: &StoredTable,
    me: &Me,
    membership: &InMemoryMembership,
    latest: u64,
) -> TableSummary {
    let a = &table.attestation;
    TableSummary {
        fingerprint: fingerprint(&a.table_id),
        title: table.title.clone(),
        class: a.effective_class().code() as char,
        declared_class: a.class.code() as char,
        purpose: purpose_text(a.purpose),
        mine: a.owner == me.member_id,
        can_write: membership.can_write_at(latest, &me.member_id, &a.table_id),
    }
}

fn count_scope(mailbox: &OfflineMailbox, now: i64) -> usize {
    let mut cursor = 0;
    let mut total = 0;
    loop {
        let page = mailbox.fetch(COLLECTIVE_SCOPE, cursor, 100, now);
        total += page.envelopes.len();
        if !page.has_more {
            return total;
        }
        cursor = page.next_cursor;
    }
}

/// Записи журналу `first..=last` (з уже застосованого префікса) — у базу.
async fn append_records(
    tx: &mut Transaction<'_, Sqlite>,
    profile_id: &str,
    collective_id: &CollectiveId,
    membership: &InMemoryMembership,
    first: u64,
    last: u64,
    now: &str,
) -> Result<()> {
    for seq in first..=last {
        let record = &membership.records()[(seq - 1) as usize];
        sqlx::query(
            "INSERT INTO collective_membership_log (profile_id, collective_id, seq, record, recorded_at)
             VALUES (?, ?, ?, ?, ?)",
        )
        .bind(profile_id)
        .bind(collective_id.as_slice())
        .bind(seq as i64)
        .bind(record.to_bytes())
        .bind(now)
        .execute(&mut **tx)
        .await?;
    }
    Ok(())
}

fn epoch_keys(
    unlocked: &UnlockedStore,
    collective_id: &CollectiveId,
    current: u32,
) -> Result<Vec<EpochKey>> {
    (0..=current)
        .map(|epoch| {
            let bytes = unlocked
                .read(&epoch_purpose(collective_id, epoch))?
                .ok_or(CollectiveStoreError::EpochKeyMissing)?;
            let key: [u8; KEY_LEN] = bytes
                .as_slice()
                .try_into()
                .map_err(|_| CollectiveStoreError::StoreDamaged)?;
            Ok(EpochKey::from_bytes(key))
        })
        .collect()
}

/// Пакет ключів: `collective_id ‖ var(назва) ‖ u32 n ‖ n×var(запис журналу) ‖ u32 m ‖ m×var(обгортка)`.
fn bundle(
    collective_id: &CollectiveId,
    name: &str,
    membership: &InMemoryMembership,
    wraps: &[EpochWrap],
) -> Vec<u8> {
    let mut w = Writer::with_capacity(4096);
    w.fixed(collective_id).var(name.as_bytes());
    w.u32(membership.records().len() as u32);
    for record in membership.records() {
        w.var(&record.to_bytes());
    }
    w.u32(wraps.len() as u32);
    for wrap in wraps {
        w.var(&wrap.to_bytes());
    }
    w.finish()
}

type Bundle = (CollectiveId, String, Vec<MembershipRecord>, Vec<EpochWrap>);

fn unbundle(bytes: &[u8]) -> Result<Bundle> {
    let invalid = |_| CollectiveStoreError::InvalidText;
    let mut r = Reader::new(bytes);
    let collective_id: CollectiveId = r.fixed().map_err(invalid)?;
    let name = String::from_utf8(r.var().map_err(invalid)?.to_vec())
        .map_err(|_| CollectiveStoreError::InvalidText)?;
    let count = r.u32().map_err(invalid)? as usize;
    if count == 0 || count > 10_000 {
        return Err(CollectiveStoreError::InvalidText);
    }
    let records = (0..count)
        .map(|_| MembershipRecord::from_bytes(r.var().map_err(invalid)?).map_err(invalid))
        .collect::<Result<Vec<_>>>()?;
    let wraps_count = r.u32().map_err(invalid)? as usize;
    if wraps_count == 0 || wraps_count > 10_000 {
        return Err(CollectiveStoreError::InvalidText);
    }
    let wraps = (0..wraps_count)
        .map(|_| EpochWrap::from_bytes(r.var().map_err(invalid)?).map_err(invalid))
        .collect::<Result<Vec<_>>>()?;
    r.finish().map_err(invalid)?;
    Ok((collective_id, name, records, wraps))
}

fn encode(prefix: &str, bytes: &[u8]) -> String {
    format!("{prefix}{}", URL_SAFE_NO_PAD.encode(bytes))
}

/// Текст для вставки: пробіли й переноси ігноруються; інший префікс — відмова.
fn decode(prefix: &str, text: &str) -> Result<Vec<u8>> {
    if text.len() > MAX_TEXT_BYTES {
        return Err(CollectiveStoreError::InvalidText);
    }
    let compact: String = text.split_whitespace().collect();
    let body = compact
        .strip_prefix(prefix)
        .ok_or(CollectiveStoreError::InvalidText)?;
    URL_SAFE_NO_PAD
        .decode(body)
        .map_err(|_| CollectiveStoreError::InvalidText)
}

fn rejected(reason: crate::collective::Reason) -> CollectiveStoreError {
    CollectiveStoreError::Rejected(reason.message())
}

fn blob<const N: usize>(bytes: Vec<u8>) -> Result<[u8; N]> {
    bytes
        .as_slice()
        .try_into()
        .map_err(|_| CollectiveStoreError::StoreDamaged)
}

fn optional_blob<const N: usize>(bytes: Option<Vec<u8>>) -> Result<Option<[u8; N]>> {
    bytes.map(blob).transpose()
}

fn parse_class(text: &str) -> Result<TableClass> {
    match text {
        "A" => Ok(TableClass::A),
        "B" => Ok(TableClass::B),
        "C" => Ok(TableClass::C),
        "D" => Ok(TableClass::D),
        _ => Err(CollectiveStoreError::InvalidChoice),
    }
}

fn class_text(class: TableClass) -> &'static str {
    match class {
        TableClass::A => "A",
        TableClass::B => "B",
        TableClass::C => "C",
        TableClass::D => "D",
    }
}

fn parse_purpose(text: &str) -> Result<TablePurpose> {
    match text {
        "after-fact" => Ok(TablePurpose::AfterFact),
        "planned" => Ok(TablePurpose::Planned),
        _ => Err(CollectiveStoreError::InvalidChoice),
    }
}

fn purpose_text(purpose: TablePurpose) -> &'static str {
    match purpose {
        TablePurpose::AfterFact => "after-fact",
        TablePurpose::Planned => "planned",
    }
}

fn parse_transport(text: &str) -> Result<Transport> {
    match text {
        "lan" => Ok(Transport::Lan),
        "peer_wan" => Ok(Transport::PeerWan),
        "base44" => Ok(Transport::Base44),
        _ => Err(CollectiveStoreError::InvalidChoice),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::database::{COLLECTIVES_SQL, COLLECTIVE_SYNC_SQL, LOCAL_PROFILES_SQL};
    use sqlx::sqlite::SqlitePoolOptions;

    const OWNER: &str = "profile-aaaaaaaaaaaaaaaaaaaaaaaa";
    const GUEST: &str = "profile-bbbbbbbbbbbbbbbbbbbbbbbb";
    const T1: &str = "2026-10-29T23:30:00Z";
    const UNIX: i64 = 1_761_780_600;
    const PASSWORD: &str = "синтетичний-пароль";

    fn password() -> Zeroizing<String> {
        Zeroizing::new(PASSWORD.to_owned())
    }

    /// Два профілі на двох «вузлах» (окремі бази й теки ключів).
    async fn node(profile: &str) -> (CollectiveStore, tempfile::TempDir) {
        let pool = SqlitePoolOptions::new()
            .max_connections(1)
            .connect("sqlite::memory:")
            .await
            .unwrap();
        for sql in [LOCAL_PROFILES_SQL, COLLECTIVES_SQL, COLLECTIVE_SYNC_SQL] {
            sqlx::raw_sql(sql).execute(&pool).await.unwrap();
        }
        sqlx::query(
            "INSERT INTO local_profiles (id, display_name, name_key, created_at, updated_at)
             VALUES (?, 'Синтетичний', 'синтетичний', ?, ?)",
        )
        .bind(profile)
        .bind(T1)
        .bind(T1)
        .execute(&pool)
        .await
        .unwrap();
        let dir = tempfile::tempdir().unwrap();
        let store = CollectiveStore::for_tests(pool, dir.path().join("collective-keys"));
        store
            .create_identity(profile, password(), T1)
            .await
            .unwrap();
        (store, dir)
    }

    async fn owner_with_collective() -> (CollectiveStore, tempfile::TempDir, String) {
        let (store, dir) = node(OWNER).await;
        let created = store
            .create_collective(OWNER, password(), "Навчальна група", T1, UNIX)
            .await
            .unwrap();
        (store, dir, created.fingerprint)
    }

    #[tokio::test]
    async fn owner_table_class_is_confirmed_and_report_goes_to_the_local_outbox() {
        let (store, _dir, collective) = owner_with_collective().await;
        let table = store
            .set_table(
                OWNER,
                &collective,
                None,
                "Облік після факту",
                "B",
                "after-fact",
                T1,
            )
            .await
            .unwrap();
        assert_eq!((table.class, table.declared_class), ('B', 'B'));
        assert!(table.mine && table.can_write);
        let detail = store.detail(OWNER, &collective, UNIX).await.unwrap();
        assert_eq!(detail.latest_seq, 3, "вступ, пристрій, право на таблицю");
        assert_eq!(detail.tables, vec![table.clone()]);
        assert_eq!(detail.outbox, 0);
        assert!(!detail.wan_accepted && !detail.base44_accepted);

        let outcome = store
            .report(
                OWNER,
                password(),
                &collective,
                &table.fingerprint,
                "lan",
                false,
                true,
                "{\"row\":\"synthetic\"}",
                UNIX,
            )
            .await
            .unwrap();
        assert!(outcome.allowed, "{}", outcome.message);
        assert_eq!((outcome.code, outcome.outbox), ("queued", 1));
        assert_eq!(
            store.detail(OWNER, &collective, UNIX).await.unwrap().outbox,
            1
        );
        // Конверт у черзі — шифротекст: синтетичного рядка відкритим текстом немає.
        let (collective_id, _) = store.find_collective(OWNER, &collective).await.unwrap();
        let path = store.outbox_path(OWNER, &collective_id);
        assert!(!std::fs::read(path)
            .unwrap()
            .windows(b"synthetic".len())
            .any(|part| part == b"synthetic"));
    }

    #[tokio::test]
    async fn report_denials_come_back_as_codes_and_nothing_is_queued() {
        let (store, _dir, collective) = owner_with_collective().await;
        let table = store
            .set_table(OWNER, &collective, None, "Облік", "C", "after-fact", T1)
            .await
            .unwrap();
        let cases = [
            ("peer_wan", true, true, "wan-not-ready"),
            ("peer_wan", false, true, "wan-needs-user-choice"),
            ("base44", false, true, "base44-not-ready"),
            ("lan", false, false, "needs-report-review"),
        ];
        for (transport, explicit, reviewed, code) in cases {
            let outcome = store
                .report(
                    OWNER,
                    password(),
                    &collective,
                    &table.fingerprint,
                    transport,
                    explicit,
                    reviewed,
                    "{}",
                    UNIX,
                )
                .await
                .unwrap();
            assert_eq!(
                (outcome.allowed, outcome.code),
                (false, code),
                "{transport}"
            );
        }
        // Планова таблиця — клас D: ні WAN, ні хмари.
        let planned = store
            .set_table(
                OWNER,
                &collective,
                Some(&table.fingerprint),
                "Облік",
                "C",
                "planned",
                T1,
            )
            .await
            .unwrap();
        assert_eq!(planned.class, 'D');
        let outcome = store
            .report(
                OWNER,
                password(),
                &collective,
                &table.fingerprint,
                "peer_wan",
                true,
                true,
                "{}",
                UNIX,
            )
            .await
            .unwrap();
        assert_eq!(outcome.code, "class-d-wan");
        assert_eq!(
            store.detail(OWNER, &collective, UNIX).await.unwrap().outbox,
            0
        );
        assert!(matches!(
            store
                .report(
                    OWNER,
                    password(),
                    &collective,
                    &table.fingerprint,
                    "ftp",
                    false,
                    true,
                    "{}",
                    UNIX
                )
                .await,
            Err(CollectiveStoreError::InvalidChoice)
        ));
        assert!(matches!(
            store
                .report(
                    OWNER,
                    password(),
                    &collective,
                    &table.fingerprint,
                    "lan",
                    false,
                    true,
                    "",
                    UNIX
                )
                .await,
            Err(CollectiveStoreError::OperationSize)
        ));
        assert!(matches!(
            store
                .report(
                    OWNER,
                    Zeroizing::new("не-той-пароль".into()),
                    &collective,
                    &table.fingerprint,
                    "lan",
                    false,
                    true,
                    "{}",
                    UNIX
                )
                .await,
            Err(CollectiveStoreError::WrongPassword)
        ));
    }

    #[tokio::test]
    async fn invitation_round_trip_between_two_nodes() {
        let (owner, _a, collective) = owner_with_collective().await;
        let (guest, _b) = node(GUEST).await;
        let invitation = owner
            .create_invitation(OWNER, password(), &collective, 24, UNIX)
            .await
            .unwrap();
        assert!(invitation.text.starts_with(INVITE_PREFIX));
        let request = guest
            .join_request(
                GUEST,
                password(),
                &format!(" {}\n", invitation.text),
                UNIX + 10,
            )
            .await
            .unwrap();
        assert_eq!(request.collective_fingerprint, collective);
        let owner_fp = owner
            .status(OWNER)
            .await
            .unwrap()
            .identity
            .unwrap()
            .fingerprint;
        assert_eq!(request.inviter_fingerprint, owner_fp);

        let admission = owner
            .admit(OWNER, password(), &collective, &request.text, T1, UNIX + 20)
            .await
            .unwrap();
        assert_eq!(admission.latest_seq, 4);
        let guest_fp = guest
            .status(GUEST)
            .await
            .unwrap()
            .identity
            .unwrap()
            .fingerprint;
        assert_eq!(admission.member_fingerprint, guest_fp);
        // Той самий талон удруге не впускає.
        assert!(matches!(
            owner
                .admit(OWNER, password(), &collective, &request.text, T1, UNIX + 21)
                .await,
            Err(CollectiveStoreError::Rejected(_))
        ));

        let joined = guest
            .join_accept(GUEST, password(), &admission.text, T1)
            .await
            .unwrap();
        assert_eq!(joined.collective.fingerprint, collective);
        assert_eq!(joined.collective.members, 2);
        assert_eq!(joined.members, vec![owner_fp.clone(), guest_fp.clone()]);
        let detail = guest.detail(GUEST, &collective, UNIX).await.unwrap();
        assert_eq!(detail.members, vec![owner_fp, guest_fp]);
        assert_eq!(detail.latest_seq, 4);
        assert!(matches!(
            guest
                .join_accept(GUEST, password(), &admission.text, T1)
                .await,
            Err(CollectiveStoreError::AlreadyJoined)
        ));
        // Учасник має ключ епохи: може створити свою таблицю й доповісти в чергу.
        let table = guest
            .set_table(
                GUEST,
                &collective,
                None,
                "Таблиця гостя",
                "A",
                "after-fact",
                T1,
            )
            .await
            .unwrap();
        let outcome = guest
            .report(
                GUEST,
                password(),
                &collective,
                &table.fingerprint,
                "lan",
                false,
                true,
                "{}",
                UNIX,
            )
            .await
            .unwrap();
        assert!(outcome.allowed, "{}", outcome.message);
        // Чужу таблицю власник не перекласифікує.
        let owner_detail = owner.detail(OWNER, &collective, UNIX).await.unwrap();
        assert!(
            owner_detail.tables.is_empty(),
            "таблиці гостя — на вузлі гостя"
        );
    }

    #[tokio::test]
    async fn tampered_texts_and_foreign_profiles_are_rejected() {
        let (owner, _a, collective) = owner_with_collective().await;
        let (guest, _b) = node(GUEST).await;
        let (stranger, _c) = node(GUEST).await;
        assert!(matches!(
            guest
                .join_request(GUEST, password(), "EWJOIN1.AAAA", UNIX)
                .await,
            Err(CollectiveStoreError::InvalidText)
        ));
        let invitation = owner
            .create_invitation(OWNER, password(), &collective, 1, UNIX)
            .await
            .unwrap();
        let request = guest
            .join_request(GUEST, password(), &invitation.text, UNIX)
            .await
            .unwrap();
        // Прострочений талон.
        assert!(matches!(
            owner
                .admit(
                    OWNER,
                    password(),
                    &collective,
                    &request.text,
                    T1,
                    UNIX + 3600
                )
                .await,
            Err(CollectiveStoreError::Rejected(_))
        ));
        let admission = owner
            .admit(OWNER, password(), &collective, &request.text, T1, UNIX + 1)
            .await
            .unwrap();
        // Пакет ключів, адресований гостю, не приймає інший профіль.
        assert!(matches!(
            stranger
                .join_accept(GUEST, password(), &admission.text, T1)
                .await,
            Err(CollectiveStoreError::NotAMember)
        ));
        // Підмінений пакет не розбирається або не проходить перевірку журналу.
        let mut bytes = decode(KEYS_PREFIX, &admission.text).unwrap();
        let middle = bytes.len() / 2;
        bytes[middle] ^= 1;
        let tampered = encode(KEYS_PREFIX, &bytes);
        assert!(guest
            .join_accept(GUEST, password(), &tampered, T1)
            .await
            .is_err());
        assert!(guest.status(GUEST).await.unwrap().collectives.is_empty());
        assert!(matches!(
            owner
                .create_invitation(OWNER, password(), &collective, 169, UNIX)
                .await,
            Err(CollectiveStoreError::InvalidInvitationHours)
        ));
    }

    #[tokio::test]
    async fn only_the_owner_changes_a_table_and_choices_are_validated() {
        let (store, _dir, collective) = owner_with_collective().await;
        for (title, class, purpose) in [
            ("", "A", "after-fact"),
            ("Т", "E", "after-fact"),
            ("Т", "A", "draft"),
        ] {
            assert!(store
                .set_table(OWNER, &collective, None, title, class, purpose, T1)
                .await
                .is_err());
        }
        assert!(matches!(
            store
                .set_table(
                    OWNER,
                    &collective,
                    Some("AAAAA-AAAAA"),
                    "Т",
                    "A",
                    "after-fact",
                    T1
                )
                .await,
            Err(CollectiveStoreError::TableNotFound)
        ));
        assert!(matches!(
            store.detail(OWNER, "ZZZZZ-ZZZZZ", UNIX).await,
            Err(CollectiveStoreError::CollectiveNotFound)
        ));
    }
}
