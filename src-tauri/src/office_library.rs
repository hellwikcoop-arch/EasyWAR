//! Захищена бібліотека «Офісу»: ядро без команд Tauri.
//!
//! Що тут є (проєкт — `plans/ofis-realizatsiia.md`, захист — `plans/ofis-biblioteka-zakhyst.md`):
//! - **ключі**: ключ даних бібліотеки (LDK, 32 випадкові байти) загорнуто
//!   XChaCha20-Poly1305 ключем, виведеним Argon2id із пароля профілю (параметри
//!   зберігаються в обгортці), і за бажанням — другим ключем із коду відновлення
//!   (HKDF). З LDK через HKDF виводяться підключі вмісту, назв, ідентифікатора вмісту
//!   й відбитків джерел. Усі ключі — у [`Zeroizing`];
//! - **сховище** [`LibraryStore`]: документи, незмінні версії, зашифрований вміст
//!   у SQLite (відхилення В-1: не окремі файли), події аудиту, зміна пароля й
//!   відновлення кодом у транзакції викликача, криптознищення, архів, зв'язки з
//!   джерелами;
//! - **сесія** [`LibrarySession`]: щонайбільше одна розблокована бібліотека в пам'яті,
//!   автоблокування після 30 хвилин бездіяльності;
//! - **тимчасовий індекс** [`SearchIndex`]: окрема база `sqlite::memory:` з FTS5, що
//!   зникає разом із блокуванням;
//! - **витяг тексту** з DOCX, PPTX, XLSX, CSV і TXT з межами проти ZIP-бомб.
//!
//! Таблиці й тригери — міграції `0012_office_library.sql` і `0013_document_links.sql`.
//! Пароль входу перевіряє викликач (`LocalProfileStore::verify_password` з
//! обмежувачем спроб); тут пароль лише виводить ключ обгортки.

use std::{
    collections::HashSet,
    fmt,
    io::{Cursor, Write},
    str::FromStr,
    sync::{Arc, Mutex, MutexGuard},
    time::{Duration, Instant},
};

use argon2::{
    password_hash::rand_core::{OsRng, RngCore},
    Algorithm, Argon2, Params, Version,
};
use calamine::{Data, Reader, Xlsx};
use chacha20poly1305::{
    aead::{Aead, KeyInit, Payload},
    Key, XChaCha20Poly1305, XNonce,
};
use hkdf::Hkdf;
use hmac::{Hmac, Mac};
use quick_xml::events::Event;
use serde::Serialize;
use sha2::{Digest, Sha256};
use sqlx::{
    sqlite::{SqliteConnectOptions, SqlitePoolOptions, SqliteRow},
    Row, Sqlite, SqlitePool, Transaction,
};
use zeroize::{Zeroize, Zeroizing};

use crate::xlsx_import::{ZipBudget, ZipLimits, ZipPartError};

/// Точний текст помилки заблокованої бібліотеки (контракт IPC; JS звіряє початок
/// «бібліотека заблокована»).
pub const LOCKED_MESSAGE: &str = "бібліотека заблокована: розблокуйте її паролем профілю";
/// Текст, яким `BEFORE DELETE ON local_profiles` відмовляє видалити профіль з
/// активною бібліотекою (див. [`profile_delete_blocked`]).
pub const PROFILE_DELETE_BLOCKED_MARKER: &str = "local_profiles: profile has an active library";
/// Автоблокування після бездіяльності (рішення JE від 19.10.2026).
pub const IDLE_LOCK_MINUTES: u64 = 30;
pub const IDLE_LOCK_TIMEOUT: Duration = Duration::from_secs(IDLE_LOCK_MINUTES * 60);
/// Найбільший документ, який бібліотека приймає (як ліміт імпорту в контракті).
pub const MAX_DOCUMENT_BYTES: usize = 256 * 1024 * 1024;
/// Довжина назви документа після очистки.
pub const MAX_NAME_CHARS: usize = 120;
/// Розширення, які бібліотека зберігає.
pub const SUPPORTED_EXTENSIONS: [&str; 5] = ["xlsx", "csv", "docx", "txt", "pptx"];
/// Розширення шаблонів і згенерованих документів.
pub const TEMPLATE_EXTENSIONS: [&str; 3] = ["docx", "pptx", "xlsx"];

const KEY_LEN: usize = 32;
const NONCE_LEN: usize = 24;
const SALT_LEN: usize = 16;
const TAG_LEN: usize = 16;
const FORMAT: u8 = 1;
const BLOB_MAGIC: &[u8; 4] = b"EWLB";
const BLOB_HEADER_LEN: usize = BLOB_MAGIC.len() + 1 + NONCE_LEN;
const MAX_PARAMS_JSON: usize = 4096;
const SEARCH_RESULTS: usize = 100;
const MAX_QUERY_TOKENS: usize = 16;

const LABEL_FILE: &[u8] = b"easywar/library/v1/file";
const LABEL_META: &[u8] = b"easywar/library/v1/meta";
const LABEL_CONTENT_ID: &[u8] = b"easywar/library/v1/content-id";
const LABEL_FINGERPRINT: &[u8] = b"easywar/library/v1/fingerprint";
const LABEL_RECOVERY_KEK: &[u8] = b"easywar/library/v1/recovery-kek";

#[derive(Debug, thiserror::Error)]
pub enum LibraryError {
    #[error("не вдалося прочитати або зберегти бібліотеку")]
    Storage(#[from] sqlx::Error),
    #[error("бібліотека заблокована: розблокуйте її паролем профілю")]
    Locked,
    #[error("неправильний пароль профілю")]
    WrongPassword,
    #[error("бібліотека доступна лише для профілю з паролем")]
    ProfileWithoutPassword,
    #[error("локальний профіль не знайдено")]
    ProfileNotFound,
    #[error("бібліотеку для цього профілю вже створено")]
    AlreadyExists,
    #[error("бібліотеку для цього профілю ще не створено")]
    NotCreated,
    #[error("бібліотеку цього профілю очищено: її вміст більше не прочитати")]
    Shredded,
    #[error("документ не знайдено в бібліотеці цього профілю")]
    ItemNotFound,
    #[error("версію документа не знайдено в бібліотеці цього профілю")]
    VersionNotFound,
    #[error("вміст документа пошкоджено або не розшифровується")]
    Damaged,
    #[error("назва документа має містити від 1 до 120 символів")]
    InvalidName,
    #[error("формат «{0}» не підтримується бібліотекою: дозволено xlsx, csv, docx, txt, pptx")]
    UnsupportedFormat(String),
    #[error("формат «{0}» не підходить до цього документа")]
    FormatMismatch(String),
    #[error("файл завеликий для бібліотеки: понад 256 МБ")]
    TooLarge,
    #[error("нову версію можна зберегти лише як ручну правку або збереження з редактора")]
    InvalidOrigin,
    #[error("ключ бібліотеки змінився під час операції; повторіть дію")]
    KeyringChanged,
    #[error("параметри ключа бібліотеки пошкоджено")]
    InvalidKdf,
    #[error("помилка шифрування бібліотеки")]
    Crypto,
    #[error("код відновлення має 55 символів (11 груп по 5): латинські літери й цифри 2–7")]
    InvalidRecoveryCode,
    #[error(
        "код відновлення введено з помилкою: контрольна сума не збігається, перевірте символи"
    )]
    RecoveryChecksum,
    #[error("код відновлення не підходить до бібліотеки цього профілю")]
    RecoveryMismatch,
    #[error("для бібліотеки цього профілю немає коду відновлення")]
    RecoveryNotSet,
    #[error("документ не пов'язаний з джерелом даних")]
    LinkNotFound,
    #[error("некоректний зв'язок з джерелом даних: {0}")]
    InvalidLink(&'static str),
    #[error("у профілю є захищена бібліотека; видаліть профіль разом з бібліотекою окремою дією")]
    ProfileDeleteBlocked,
    #[error("текст документа не прочитано: {0}")]
    Extraction(&'static str),
    #[error("документ перевищує межі безпечного розбору: {0}")]
    ExtractionLimit(String),
    #[error("не вдалося зібрати архів бібліотеки")]
    Archive,
}

/// Чи відмовив тригер `local_profiles_library_guard` видалити профіль з активною
/// бібліотекою. Викликач (`delete_local_profile`) перетворює це на
/// [`LibraryError::ProfileDeleteBlocked`] — текст із контракту.
pub fn is_profile_delete_blocked(error: &sqlx::Error) -> bool {
    error
        .as_database_error()
        .is_some_and(|database| database.message().contains(PROFILE_DELETE_BLOCKED_MARKER))
}

/// [`LibraryError::ProfileDeleteBlocked`], якщо помилка — відмова тригера видалення
/// профілю; інакше `None` (помилку слід показати як є).
pub fn profile_delete_blocked(error: &sqlx::Error) -> Option<LibraryError> {
    is_profile_delete_blocked(error).then_some(LibraryError::ProfileDeleteBlocked)
}

// ---------------------------------------------------------------------------
// Ключі
// ---------------------------------------------------------------------------

/// Параметри Argon2id для ключа обгортки. Зберігаються в обгортці, тож розблокування
/// завжди бере параметри, з якими бібліотеку створено.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct KdfParams {
    /// Пам'ять, КіБ.
    pub m_kib: u32,
    /// Кількість проходів.
    pub t: u32,
    /// Паралелізм.
    pub p: u32,
}

impl KdfParams {
    /// Робочі параметри: 64 МіБ, 3 проходи, 1 потік.
    pub const PRODUCTION: KdfParams = KdfParams {
        m_kib: 65536,
        t: 3,
        p: 1,
    };
    /// Мінімальні параметри лише для тестів: 64 МіБ Argon2 у кожному тесті зробили б
    /// набір повільним, а властивості шифрування від параметрів не залежать.
    #[cfg(test)]
    pub(crate) const FOR_TESTS: KdfParams = KdfParams {
        m_kib: 8,
        t: 1,
        p: 1,
    };

    fn argon2(self) -> Result<Argon2<'static>, LibraryError> {
        // Межі ті самі, що в CHECK таблиці: підроблена база не змусить виділити
        // гігабайти пам'яті.
        if !(8..=1_048_576).contains(&self.m_kib)
            || !(1..=16).contains(&self.t)
            || !(1..=8).contains(&self.p)
            || self.m_kib < 8 * self.p
        {
            return Err(LibraryError::InvalidKdf);
        }
        let params = Params::new(self.m_kib, self.t, self.p, Some(KEY_LEN))
            .map_err(|_| LibraryError::InvalidKdf)?;
        Ok(Argon2::new(Algorithm::Argon2id, Version::V0x13, params))
    }

    fn from_row(m: i64, t: i64, p: i64) -> Result<Self, LibraryError> {
        let convert = |value: i64| u32::try_from(value).map_err(|_| LibraryError::InvalidKdf);
        Ok(Self {
            m_kib: convert(m)?,
            t: convert(t)?,
            p: convert(p)?,
        })
    }
}

/// Слот обгортки LDK.
#[derive(Clone, Copy)]
enum Slot {
    Password,
    Recovery,
}

fn keyring_aad(profile_id: &str, slot: Slot) -> Vec<u8> {
    let slot = match slot {
        Slot::Password => "password",
        Slot::Recovery => "recovery",
    };
    format!("easywar/library/v1/keyring\0{profile_id}\0format={FORMAT}\0slot={slot}").into_bytes()
}

fn blob_aad(profile_id: &str, content_id: &str) -> Vec<u8> {
    let mut aad = format!("easywar/library/v1/blob\0{profile_id}\0{content_id}\0").into_bytes();
    aad.push(FORMAT);
    aad
}

fn name_aad(profile_id: &str, item_id: &str) -> Vec<u8> {
    format!("easywar/library/v1/name\0{profile_id}\0{item_id}").into_bytes()
}

fn random_array<const N: usize>() -> [u8; N] {
    let mut bytes = [0u8; N];
    OsRng.fill_bytes(&mut bytes);
    bytes
}

fn random_key() -> Zeroizing<[u8; KEY_LEN]> {
    let mut key = Zeroizing::new([0u8; KEY_LEN]);
    OsRng.fill_bytes(&mut key[..]);
    key
}

fn to_hex(bytes: &[u8]) -> String {
    const DIGITS: &[u8; 16] = b"0123456789abcdef";
    let mut out = String::with_capacity(bytes.len() * 2);
    for byte in bytes {
        out.push(DIGITS[usize::from(byte >> 4)] as char);
        out.push(DIGITS[usize::from(byte & 0x0f)] as char);
    }
    out
}

/// `doc-<24 hex>` чи `ver-<24 hex>` з ОС-генератора.
fn random_id(prefix: &str) -> String {
    format!("{prefix}-{}", to_hex(&random_array::<12>()))
}

fn valid_profile_id(id: &str) -> bool {
    id.len() == 32 && id.starts_with("profile-") && is_lower_hex(&id[8..])
}

fn is_lower_hex(text: &str) -> bool {
    !text.is_empty()
        && text
            .bytes()
            .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
}

fn derive_kek(
    password: &[u8],
    salt: &[u8],
    params: KdfParams,
) -> Result<Zeroizing<[u8; KEY_LEN]>, LibraryError> {
    let argon2 = params.argon2()?;
    let mut kek = Zeroizing::new([0u8; KEY_LEN]);
    argon2
        .hash_password_into(password, salt, &mut kek[..])
        .map_err(|_| LibraryError::InvalidKdf)?;
    Ok(kek)
}

/// Argon2id з робочими параметрами триває до секунди, тож він іде в пул блокувальних
/// задач, а не займає потік асинхронного виконавця.
async fn derive_kek_blocking(
    password: &str,
    salt: &[u8],
    params: KdfParams,
) -> Result<Zeroizing<[u8; KEY_LEN]>, LibraryError> {
    let password = Zeroizing::new(password.as_bytes().to_vec());
    let salt = salt.to_vec();
    tokio::task::spawn_blocking(move || derive_kek(&password, &salt, params))
        .await
        .map_err(|_| LibraryError::Crypto)?
}

fn seal(
    key: &[u8; KEY_LEN],
    nonce: &[u8; NONCE_LEN],
    plaintext: &[u8],
    aad: &[u8],
) -> Result<Vec<u8>, LibraryError> {
    XChaCha20Poly1305::new(Key::from_slice(key))
        .encrypt(
            XNonce::from_slice(nonce),
            Payload {
                msg: plaintext,
                aad,
            },
        )
        .map_err(|_| LibraryError::Crypto)
}

fn open(
    key: &[u8; KEY_LEN],
    nonce: &[u8],
    ciphertext: &[u8],
    aad: &[u8],
) -> Option<Zeroizing<Vec<u8>>> {
    if nonce.len() != NONCE_LEN {
        return None;
    }
    XChaCha20Poly1305::new(Key::from_slice(key))
        .decrypt(
            XNonce::from_slice(nonce),
            Payload {
                msg: ciphertext,
                aad,
            },
        )
        .ok()
        .map(Zeroizing::new)
}

fn wrap_ldk(
    kek: &[u8; KEY_LEN],
    ldk: &[u8; KEY_LEN],
    aad: &[u8],
) -> Result<([u8; NONCE_LEN], Vec<u8>), LibraryError> {
    let nonce = random_array::<NONCE_LEN>();
    let wrapped = seal(kek, &nonce, ldk, aad)?;
    Ok((nonce, wrapped))
}

fn unwrap_ldk(
    kek: &[u8; KEY_LEN],
    nonce: &[u8],
    wrapped: &[u8],
    aad: &[u8],
) -> Option<Zeroizing<[u8; KEY_LEN]>> {
    let plain = open(kek, nonce, wrapped, aad)?;
    if plain.len() != KEY_LEN {
        return None;
    }
    let mut ldk = Zeroizing::new([0u8; KEY_LEN]);
    ldk.copy_from_slice(&plain);
    Some(ldk)
}

fn hkdf_key(ikm: &[u8], salt: Option<&[u8]>, label: &[u8]) -> Zeroizing<[u8; KEY_LEN]> {
    let mut okm = Zeroizing::new([0u8; KEY_LEN]);
    Hkdf::<Sha256>::new(salt, ikm)
        .expand(label, &mut okm[..])
        .expect("32 байти — допустима довжина виходу HKDF-SHA256");
    okm
}

fn hmac_hex(key: &[u8; KEY_LEN], bytes: &[u8]) -> String {
    let mut mac = <Hmac<Sha256> as Mac>::new_from_slice(key)
        .expect("HMAC-SHA256 приймає ключ будь-якої довжини");
    mac.update(bytes);
    to_hex(&mac.finalize().into_bytes())
}

/// Підключі розблокованої бібліотеки одного профілю. LDK тут не зберігається:
/// переобгортка (зміна пароля, код відновлення) щоразу розгортає його заново.
pub struct LibraryKeys {
    profile_id: String,
    file: Zeroizing<[u8; KEY_LEN]>,
    meta: Zeroizing<[u8; KEY_LEN]>,
    content_id: Zeroizing<[u8; KEY_LEN]>,
    fingerprint: Zeroizing<[u8; KEY_LEN]>,
}

impl fmt::Debug for LibraryKeys {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter
            .debug_struct("LibraryKeys")
            .field("profile_id", &self.profile_id)
            .finish_non_exhaustive()
    }
}

impl LibraryKeys {
    fn derive(profile_id: &str, ldk: &[u8; KEY_LEN]) -> Self {
        Self {
            profile_id: profile_id.to_owned(),
            file: hkdf_key(ldk, None, LABEL_FILE),
            meta: hkdf_key(ldk, None, LABEL_META),
            content_id: hkdf_key(ldk, None, LABEL_CONTENT_ID),
            fingerprint: hkdf_key(ldk, None, LABEL_FINGERPRINT),
        }
    }

    pub fn profile_id(&self) -> &str {
        &self.profile_id
    }

    /// `content_id = hex(HMAC-SHA256(content-id-ключ, відкриті байти))`.
    pub fn content_id(&self, bytes: &[u8]) -> String {
        hmac_hex(&self.content_id, bytes)
    }

    /// Відбиток довільних байтів ключем відбитків цієї бібліотеки.
    pub fn fingerprint(&self, bytes: &[u8]) -> String {
        hmac_hex(&self.fingerprint, bytes)
    }

    /// `EWLB` · формат · nonce · шифротекст із тегом.
    fn encrypt_blob(&self, content_id: &str, plaintext: &[u8]) -> Result<Vec<u8>, LibraryError> {
        let nonce = random_array::<NONCE_LEN>();
        let ciphertext = seal(
            &self.file,
            &nonce,
            plaintext,
            &blob_aad(&self.profile_id, content_id),
        )?;
        let mut data = Vec::with_capacity(BLOB_HEADER_LEN + ciphertext.len());
        data.extend_from_slice(BLOB_MAGIC);
        data.push(FORMAT);
        data.extend_from_slice(&nonce);
        data.extend_from_slice(&ciphertext);
        Ok(data)
    }

    /// Розшифровує вміст і перевіряє, що HMAC відкритих байтів збігається з
    /// `content_id`: підмінений рядок іншого вмісту не пройде.
    fn decrypt_blob(
        &self,
        content_id: &str,
        data: &[u8],
    ) -> Result<Zeroizing<Vec<u8>>, LibraryError> {
        if data.len() < BLOB_HEADER_LEN + TAG_LEN
            || &data[..BLOB_MAGIC.len()] != BLOB_MAGIC
            || data[BLOB_MAGIC.len()] != FORMAT
        {
            return Err(LibraryError::Damaged);
        }
        let nonce = &data[BLOB_MAGIC.len() + 1..BLOB_HEADER_LEN];
        let plain = open(
            &self.file,
            nonce,
            &data[BLOB_HEADER_LEN..],
            &blob_aad(&self.profile_id, content_id),
        )
        .ok_or(LibraryError::Damaged)?;
        if self.content_id(&plain) != content_id {
            return Err(LibraryError::Damaged);
        }
        Ok(plain)
    }

    /// Назва: `nonce ‖ шифротекст`, AAD прив'язує її до профілю й документа.
    fn encrypt_name(&self, item_id: &str, name: &str) -> Result<Vec<u8>, LibraryError> {
        let nonce = random_array::<NONCE_LEN>();
        let ciphertext = seal(
            &self.meta,
            &nonce,
            name.as_bytes(),
            &name_aad(&self.profile_id, item_id),
        )?;
        let mut stored = Vec::with_capacity(NONCE_LEN + ciphertext.len());
        stored.extend_from_slice(&nonce);
        stored.extend_from_slice(&ciphertext);
        Ok(stored)
    }

    fn decrypt_name(
        &self,
        item_id: &str,
        stored: &[u8],
    ) -> Result<Zeroizing<String>, LibraryError> {
        if stored.len() < NONCE_LEN + TAG_LEN {
            return Err(LibraryError::Damaged);
        }
        let plain = open(
            &self.meta,
            &stored[..NONCE_LEN],
            &stored[NONCE_LEN..],
            &name_aad(&self.profile_id, item_id),
        )
        .ok_or(LibraryError::Damaged)?;
        let text = std::str::from_utf8(&plain).map_err(|_| LibraryError::Damaged)?;
        Ok(Zeroizing::new(text.to_owned()))
    }
}

/// `hex(HMAC-SHA256(fingerprint-ключ, байти))`.
pub fn fingerprint(keys: &LibraryKeys, bytes: &[u8]) -> String {
    keys.fingerprint(bytes)
}

/// Відбиток даних джерела: HMAC канонічного JSON (ключі об'єктів відсортовано, без
/// пробілів), тож порядок вставки полів не змінює відбиток.
pub fn source_fingerprint(keys: &LibraryKeys, data: &serde_json::Value) -> String {
    keys.fingerprint(&canonical_json(data))
}

/// Канонічний JSON: ключі об'єктів відсортовано рекурсивно, без зайвих пробілів.
pub fn canonical_json(value: &serde_json::Value) -> Vec<u8> {
    fn write(value: &serde_json::Value, out: &mut Vec<u8>) {
        match value {
            serde_json::Value::Object(map) => {
                let mut keys: Vec<&String> = map.keys().collect();
                keys.sort();
                out.push(b'{');
                for (index, key) in keys.into_iter().enumerate() {
                    if index > 0 {
                        out.push(b',');
                    }
                    out.extend_from_slice(
                        serde_json::to_string(key)
                            .expect("рядок завжди серіалізується")
                            .as_bytes(),
                    );
                    out.push(b':');
                    write(&map[key], out);
                }
                out.push(b'}');
            }
            serde_json::Value::Array(items) => {
                out.push(b'[');
                for (index, item) in items.iter().enumerate() {
                    if index > 0 {
                        out.push(b',');
                    }
                    write(item, out);
                }
                out.push(b']');
            }
            scalar => out.extend_from_slice(
                serde_json::to_string(scalar)
                    .expect("скалярне значення JSON завжди серіалізується")
                    .as_bytes(),
            ),
        }
    }
    let mut out = Vec::new();
    write(value, &mut out);
    out
}

// ---------------------------------------------------------------------------
// Код відновлення
// ---------------------------------------------------------------------------

const BASE32_ALPHABET: &[u8; 32] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
/// 32 байти секрету + 2 байти контрольної суми = 272 біти → 55 символів Base32.
const RECOVERY_SYMBOLS: usize = 55;
const RECOVERY_GROUP: usize = 5;

/// Код відновлення для показу користувачу один раз. Ніде не зберігається відкрито.
pub struct RecoveryCode(Zeroizing<String>);

impl RecoveryCode {
    pub fn as_str(&self) -> &str {
        &self.0
    }
}

impl fmt::Debug for RecoveryCode {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str("RecoveryCode(..)")
    }
}

fn base32_encode(bytes: &[u8]) -> Zeroizing<String> {
    let mut out = Zeroizing::new(String::with_capacity((bytes.len() * 8).div_ceil(5)));
    let mut buffer: u32 = 0;
    let mut bits = 0u32;
    for &byte in bytes {
        buffer = (buffer << 8) | u32::from(byte);
        bits += 8;
        while bits >= 5 {
            bits -= 5;
            out.push(BASE32_ALPHABET[((buffer >> bits) & 31) as usize] as char);
        }
        buffer &= (1 << bits) - 1;
    }
    if bits > 0 {
        out.push(BASE32_ALPHABET[((buffer << (5 - bits)) & 31) as usize] as char);
    }
    buffer.zeroize();
    out
}

fn base32_decode(symbols: &[u8]) -> Option<Zeroizing<Vec<u8>>> {
    let mut out = Zeroizing::new(Vec::with_capacity(symbols.len() * 5 / 8));
    let mut buffer: u32 = 0;
    let mut bits = 0u32;
    for &symbol in symbols {
        let value = BASE32_ALPHABET.iter().position(|&known| known == symbol)? as u32;
        buffer = (buffer << 5) | value;
        bits += 5;
        if bits >= 8 {
            bits -= 8;
            out.push((buffer >> bits) as u8);
            buffer &= (1 << bits) - 1;
        }
    }
    // Канонічне кодування: залишкові біти — нулі.
    let canonical = buffer == 0;
    buffer.zeroize();
    canonical.then_some(out)
}

/// Новий код: 32 випадкові байти + 2 перші байти SHA-256 від них, Base32 без
/// вирівнювання, групи по 5 символів через дефіс.
pub fn generate_recovery_code() -> (RecoveryCode, Zeroizing<[u8; KEY_LEN]>) {
    let secret = random_key();
    let mut raw = Zeroizing::new([0u8; KEY_LEN + 2]);
    raw[..KEY_LEN].copy_from_slice(&secret[..]);
    raw[KEY_LEN..].copy_from_slice(&Sha256::digest(&secret[..])[..2]);
    let encoded = base32_encode(&raw[..]);
    let mut grouped = Zeroizing::new(String::with_capacity(RECOVERY_SYMBOLS + 10));
    for (index, symbol) in encoded.chars().enumerate() {
        if index > 0 && index % RECOVERY_GROUP == 0 {
            grouped.push('-');
        }
        grouped.push(symbol);
    }
    (RecoveryCode(grouped), secret)
}

/// Розбирає введений код: регістр, пробіли й дефіси не мають значення; цифри 0, 1
/// і 8, яких немає в абетці Base32, читаються як O, I і B.
pub fn parse_recovery_code(input: &str) -> Result<Zeroizing<[u8; KEY_LEN]>, LibraryError> {
    let mut symbols = Zeroizing::new(Vec::with_capacity(RECOVERY_SYMBOLS));
    for character in input.chars() {
        if character.is_whitespace() || matches!(character, '-' | '–' | '—') {
            continue;
        }
        let symbol = match character.to_ascii_uppercase() {
            '0' => 'O',
            '1' => 'I',
            '8' => 'B',
            other => other,
        };
        if !symbol.is_ascii() || symbols.len() == RECOVERY_SYMBOLS {
            return Err(LibraryError::InvalidRecoveryCode);
        }
        symbols.push(symbol as u8);
    }
    if symbols.len() != RECOVERY_SYMBOLS {
        return Err(LibraryError::InvalidRecoveryCode);
    }
    let raw = base32_decode(&symbols).ok_or(LibraryError::InvalidRecoveryCode)?;
    if raw.len() != KEY_LEN + 2 {
        return Err(LibraryError::InvalidRecoveryCode);
    }
    if Sha256::digest(&raw[..KEY_LEN])[..2] != raw[KEY_LEN..] {
        return Err(LibraryError::RecoveryChecksum);
    }
    let mut secret = Zeroizing::new([0u8; KEY_LEN]);
    secret.copy_from_slice(&raw[..KEY_LEN]);
    Ok(secret)
}

/// KEK відновлення = HKDF-SHA256(код, `recovery_salt`, мітка): ентропія коду вже
/// 256 біт, тож повільний Argon2id тут не потрібен.
fn recovery_kek(secret: &[u8; KEY_LEN], salt: &[u8]) -> Zeroizing<[u8; KEY_LEN]> {
    hkdf_key(secret, Some(salt), LABEL_RECOVERY_KEK)
}

// ---------------------------------------------------------------------------
// Типи даних
// ---------------------------------------------------------------------------

/// Походження версії.
#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum Origin {
    Imported,
    Generated,
    Edited,
    Saved,
}

impl Origin {
    pub fn as_str(self) -> &'static str {
        match self {
            Origin::Imported => "imported",
            Origin::Generated => "generated",
            Origin::Edited => "edited",
            Origin::Saved => "saved",
        }
    }

    fn parse(value: &str) -> Result<Self, LibraryError> {
        match value {
            "imported" => Ok(Origin::Imported),
            "generated" => Ok(Origin::Generated),
            "edited" => Ok(Origin::Edited),
            "saved" => Ok(Origin::Saved),
            _ => Err(LibraryError::Damaged),
        }
    }
}

/// Вид джерела даних зв'язаного документа.
#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, serde::Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum SourceKind {
    ApprovedRevisions,
    DashboardModule,
    LibraryTable,
}

impl SourceKind {
    pub fn as_str(self) -> &'static str {
        match self {
            SourceKind::ApprovedRevisions => "approved_revisions",
            SourceKind::DashboardModule => "dashboard_module",
            SourceKind::LibraryTable => "library_table",
        }
    }

    pub fn parse(value: &str) -> Option<Self> {
        match value {
            "approved_revisions" => Some(SourceKind::ApprovedRevisions),
            "dashboard_module" => Some(SourceKind::DashboardModule),
            "library_table" => Some(SourceKind::LibraryTable),
            _ => None,
        }
    }
}

/// Вид події аудиту (`library_events.event`).
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum LibraryEventKind {
    Created,
    Unlocked,
    Imported,
    VersionSaved,
    Generated,
    CurrentChanged,
    Renamed,
    Hidden,
    Shown,
    Exported,
    ArchiveExported,
    PasswordRewrapped,
    Recovered,
    RecoveryReissued,
    Purged,
}

impl LibraryEventKind {
    pub fn as_str(self) -> &'static str {
        match self {
            LibraryEventKind::Created => "created",
            LibraryEventKind::Unlocked => "unlocked",
            LibraryEventKind::Imported => "imported",
            LibraryEventKind::VersionSaved => "version_saved",
            LibraryEventKind::Generated => "generated",
            LibraryEventKind::CurrentChanged => "current_changed",
            LibraryEventKind::Renamed => "renamed",
            LibraryEventKind::Hidden => "hidden",
            LibraryEventKind::Shown => "shown",
            LibraryEventKind::Exported => "exported",
            LibraryEventKind::ArchiveExported => "archive_exported",
            LibraryEventKind::PasswordRewrapped => "password_rewrapped",
            LibraryEventKind::Recovered => "recovered",
            LibraryEventKind::RecoveryReissued => "recovery_reissued",
            LibraryEventKind::Purged => "purged",
        }
    }
}

/// Розширення в нижньому регістрі без крапки, якщо бібліотека його підтримує.
pub fn normalize_ext(ext: &str) -> Result<&'static str, LibraryError> {
    let lowered = ext.trim().trim_start_matches('.').to_lowercase();
    SUPPORTED_EXTENSIONS
        .iter()
        .copied()
        .find(|known| *known == lowered)
        .ok_or_else(|| LibraryError::UnsupportedFormat(ext.chars().take(16).collect()))
}

/// Вид документа за розширенням; шаблоном стає лише DOCX, PPTX чи XLSX.
pub fn kind_for(ext: &str, as_template: bool) -> &'static str {
    if as_template && TEMPLATE_EXTENSIONS.contains(&ext) {
        return "template";
    }
    match ext {
        "xlsx" | "csv" => "table",
        "pptx" => "slides",
        _ => "document",
    }
}

/// Редактор для розширення: xlsx/csv → EasyGreen, docx/txt → EasyDoc, pptx → EasySlide.
pub fn app_for_ext(ext: &str) -> &'static str {
    match ext {
        "xlsx" | "csv" => "easygreen",
        "pptx" => "easyslide",
        _ => "easydoc",
    }
}

/// Очищена назва документа: без керівних символів і крайніх пробілів, 1–120 символів.
pub fn clean_name(name: &str) -> Result<String, LibraryError> {
    let cleaned: String = name.chars().filter(|c| !c.is_control()).collect();
    let cleaned = cleaned.trim();
    let count = cleaned.chars().count();
    if count == 0 || count > MAX_NAME_CHARS {
        return Err(LibraryError::InvalidName);
    }
    Ok(cleaned.to_owned())
}

/// Назва документа з імені файлу: без каталогів і розширення, обрізана до 120
/// символів; порожня → «Документ».
pub fn document_name_from_file(file_name: &str) -> String {
    let base = file_name.rsplit(['/', '\\']).next().unwrap_or_default();
    let stem = match base.rsplit_once('.') {
        Some((stem, _)) if !stem.trim().is_empty() => stem,
        _ => base,
    };
    let cleaned: String = stem
        .chars()
        .filter(|c| !c.is_control())
        .take(MAX_NAME_CHARS)
        .collect();
    let cleaned = cleaned.trim();
    if cleaned.is_empty() {
        "Документ".to_owned()
    } else {
        cleaned.to_owned()
    }
}

#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LinkSummary {
    pub source_kind: SourceKind,
    pub params: serde_json::Value,
    pub template_version_id: String,
    pub last_generated_version_id: Option<String>,
}

/// Документ бібліотеки (контракт `LibraryItem`).
#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LibraryItem {
    pub id: String,
    pub kind: String,
    pub name: String,
    pub ext: String,
    pub app: String,
    pub current_version_id: Option<String>,
    pub current_origin: Option<Origin>,
    pub version_count: i64,
    pub hidden: bool,
    pub profile_table_copy: bool,
    pub created_at: String,
    pub updated_at: String,
    pub link: Option<LinkSummary>,
}

/// Версія документа (контракт `LibraryVersion`).
#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LibraryVersion {
    pub id: String,
    pub item_id: String,
    pub version_no: i64,
    pub origin: Origin,
    pub parent_version_id: Option<String>,
    pub ext: String,
    pub size: i64,
    pub created_at: String,
    pub current: bool,
    pub source_fingerprint: Option<String>,
}

/// Повний рядок зв'язку з джерелом.
#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DocumentLink {
    pub item_id: String,
    pub template_version_id: String,
    pub source_kind: SourceKind,
    pub params: serde_json::Value,
    pub last_generated_version_id: Option<String>,
    pub source_fingerprint: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

/// Рядок журналу подій (без відкритого вмісту).
#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LibraryEventRecord {
    pub id: i64,
    pub event: String,
    pub item_id: Option<String>,
    pub version_id: Option<String>,
    pub created_at: String,
}

/// Стан обгортки ключа профілю.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum KeyringStatus {
    Missing,
    Active { has_recovery: bool, generation: i64 },
    Shredded,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum LibraryState {
    NoProfile,
    NoPassword,
    #[serde(rename = "none")]
    Missing,
    Locked,
    Unlocked,
}

/// Стан бібліотеки для інтерфейсу (контракт `LibraryStatus`).
#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LibraryStatus {
    pub state: LibraryState,
    pub profile_id: Option<String>,
    pub has_recovery: bool,
    pub indexing: bool,
    pub index_ready: bool,
    pub damaged: Vec<String>,
    pub idle_lock_minutes: u64,
}

impl LibraryStatus {
    fn plain(state: LibraryState, profile_id: Option<&str>) -> Self {
        Self {
            state,
            profile_id: profile_id.map(str::to_owned),
            has_recovery: false,
            indexing: false,
            index_ready: false,
            damaged: Vec::new(),
            idle_lock_minutes: IDLE_LOCK_MINUTES,
        }
    }
}

/// Новий документ з диска.
#[derive(Clone, Copy, Debug)]
pub struct NewDocument<'a> {
    pub name: &'a str,
    pub ext: &'a str,
    pub as_template: bool,
    pub profile_table_copy: bool,
    pub bytes: &'a [u8],
}

/// Нова версія наявного документа (збереження з редактора).
#[derive(Clone, Copy, Debug)]
pub struct NewVersion<'a> {
    pub ext: &'a str,
    pub bytes: &'a [u8],
    pub origin: Origin,
    pub parent_version_id: Option<&'a str>,
    pub source_fingerprint: Option<&'a str>,
    pub make_current: bool,
}

/// Документ, згенерований із шаблону за даними джерела.
#[derive(Clone, Copy, Debug)]
pub struct GeneratedDocument<'a> {
    /// `None` — новий документ (і новий зв'язок), інакше — пов'язаний документ.
    pub item_id: Option<&'a str>,
    /// Назва нового документа (для наявного не потрібна).
    pub name: Option<&'a str>,
    pub template_version_id: &'a str,
    pub source_kind: SourceKind,
    pub params: &'a serde_json::Value,
    pub fingerprint: &'a str,
    pub ext: &'a str,
    pub bytes: &'a [u8],
    pub make_current: bool,
}

#[derive(Clone, Debug, PartialEq)]
pub struct GeneratedSave {
    pub item: LibraryItem,
    pub version: LibraryVersion,
    /// `false` — вміст збігся з останньою згенерованою версією, нової не створено.
    pub created: bool,
}

/// Новостворена бібліотека: ключі для сесії й код відновлення (якщо просили).
#[derive(Debug)]
pub struct CreatedLibrary {
    pub keys: LibraryKeys,
    pub recovery_code: Option<RecoveryCode>,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PurgeSummary {
    pub items: i64,
    pub versions: i64,
}

/// Архів поточних версій.
pub struct ArchiveExport {
    pub bytes: Zeroizing<Vec<u8>>,
    /// Імена файлів в архіві в порядку додавання.
    pub entries: Vec<String>,
    /// Документи, поточна версія яких не розшифрувалась (до архіву не потрапили).
    pub damaged: Vec<String>,
}

impl fmt::Debug for ArchiveExport {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter
            .debug_struct("ArchiveExport")
            .field("bytes", &self.bytes.len())
            .field("entries", &self.entries)
            .field("damaged", &self.damaged)
            .finish()
    }
}

/// Результат пошуку для інтерфейсу.
#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchHit {
    pub item_id: String,
    pub name: String,
    pub snippet: Option<String>,
    pub by_name: bool,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchResponse {
    pub index_ready: bool,
    pub results: Vec<SearchHit>,
}

// ---------------------------------------------------------------------------
// Сховище
// ---------------------------------------------------------------------------

struct KeyringRow {
    kdf: KdfParams,
    kdf_salt: Vec<u8>,
    wrap_nonce: Option<Vec<u8>>,
    wrapped_ldk: Option<Vec<u8>>,
    recovery_salt: Option<Vec<u8>>,
    recovery_nonce: Option<Vec<u8>>,
    recovery_wrapped_ldk: Option<Vec<u8>>,
    shredded: bool,
    generation: i64,
}

/// Зашифрований вміст, перевірений до вставки.
struct SealedContent {
    content_id: String,
    plain_size: i64,
    data: Vec<u8>,
}

fn seal_content(keys: &LibraryKeys, bytes: &[u8]) -> Result<SealedContent, LibraryError> {
    if bytes.len() > MAX_DOCUMENT_BYTES {
        return Err(LibraryError::TooLarge);
    }
    let content_id = keys.content_id(bytes);
    let data = keys.encrypt_blob(&content_id, bytes)?;
    // Шифротекст має розшифруватися в ті самі байти ще до вставки: інакше версія
    // посилалася б на вміст, якого вже не прочитати.
    let check = keys
        .decrypt_blob(&content_id, &data)
        .map_err(|_| LibraryError::Crypto)?;
    if check.as_slice() != bytes {
        return Err(LibraryError::Crypto);
    }
    Ok(SealedContent {
        content_id,
        plain_size: i64::try_from(bytes.len()).map_err(|_| LibraryError::TooLarge)?,
        data,
    })
}

async fn insert_event<'e, E>(
    executor: E,
    profile_id: &str,
    event: LibraryEventKind,
    item_id: Option<&str>,
    version_id: Option<&str>,
    now: &str,
) -> Result<(), sqlx::Error>
where
    E: sqlx::Executor<'e, Database = Sqlite>,
{
    sqlx::query(
        "INSERT INTO library_events (profile_id, event, item_id, version_id, created_at)
         VALUES (?, ?, ?, ?, ?)",
    )
    .bind(profile_id)
    .bind(event.as_str())
    .bind(item_id)
    .bind(version_id)
    .bind(now)
    .execute(executor)
    .await?;
    Ok(())
}

/// Вставляє вміст, якщо такого ще немає. Наявний рядок того самого вмісту мусить
/// розшифровуватися: нова версія не посилатиметься на пошкоджений вміст.
async fn store_content(
    transaction: &mut Transaction<'_, Sqlite>,
    keys: &LibraryKeys,
    sealed: &SealedContent,
    now: &str,
) -> Result<(), LibraryError> {
    let existing: Option<Option<Vec<u8>>> = sqlx::query_scalar(
        "SELECT data FROM library_blobs WHERE profile_id = ? AND content_id = ?",
    )
    .bind(keys.profile_id())
    .bind(&sealed.content_id)
    .fetch_optional(&mut **transaction)
    .await?;
    match existing {
        Some(Some(data)) => keys.decrypt_blob(&sealed.content_id, &data).map(|_| ()),
        Some(None) => Err(LibraryError::Damaged),
        None => {
            sqlx::query(
                "INSERT INTO library_blobs (profile_id, content_id, plain_size, data, created_at)
                 VALUES (?, ?, ?, ?, ?)",
            )
            .bind(keys.profile_id())
            .bind(&sealed.content_id)
            .bind(sealed.plain_size)
            .bind(&sealed.data)
            .bind(now)
            .execute(&mut **transaction)
            .await?;
            Ok(())
        }
    }
}

#[allow(clippy::too_many_arguments)]
async fn insert_version(
    transaction: &mut Transaction<'_, Sqlite>,
    keys: &LibraryKeys,
    item_id: &str,
    sealed: &SealedContent,
    ext: &str,
    origin: Origin,
    parent_version_id: Option<&str>,
    source_fingerprint: Option<&str>,
    now: &str,
) -> Result<LibraryVersion, LibraryError> {
    let version_no: i64 = sqlx::query_scalar(
        "SELECT coalesce(max(version_no), 0) + 1 FROM library_versions WHERE item_id = ?",
    )
    .bind(item_id)
    .fetch_one(&mut **transaction)
    .await?;
    let id = random_id("ver");
    sqlx::query(
        "INSERT INTO library_versions
         (id, item_id, profile_id, version_no, content_id, ext, plain_size, origin,
          parent_version_id, source_fingerprint, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    )
    .bind(&id)
    .bind(item_id)
    .bind(keys.profile_id())
    .bind(version_no)
    .bind(&sealed.content_id)
    .bind(ext)
    .bind(sealed.plain_size)
    .bind(origin.as_str())
    .bind(parent_version_id)
    .bind(source_fingerprint)
    .bind(now)
    .execute(&mut **transaction)
    .await?;
    Ok(LibraryVersion {
        id,
        item_id: item_id.to_owned(),
        version_no,
        origin,
        parent_version_id: parent_version_id.map(str::to_owned),
        ext: ext.to_owned(),
        size: sealed.plain_size,
        created_at: now.to_owned(),
        current: false,
        source_fingerprint: source_fingerprint.map(str::to_owned),
    })
}

async fn set_current_in(
    transaction: &mut Transaction<'_, Sqlite>,
    keys: &LibraryKeys,
    item_id: &str,
    version_id: &str,
) -> Result<(), LibraryError> {
    sqlx::query("UPDATE library_items SET current_version_id = ? WHERE id = ? AND profile_id = ?")
        .bind(version_id)
        .bind(item_id)
        .bind(keys.profile_id())
        .execute(&mut **transaction)
        .await?;
    Ok(())
}

fn validate_fingerprint(value: &str) -> Result<(), LibraryError> {
    if value.len() == 64 && is_lower_hex(value) {
        Ok(())
    } else {
        Err(LibraryError::InvalidLink(
            "відбиток джерела має бути 64 шістнадцятковими цифрами",
        ))
    }
}

const ITEM_SELECT: &str = "SELECT i.id, i.kind, i.name_cipher, i.profile_table_copy,
        i.current_version_id, i.hidden_at, i.created_at,
        cv.ext AS current_ext, cv.origin AS current_origin,
        (SELECT count(*) FROM library_versions v WHERE v.item_id = i.id) AS version_count,
        (SELECT v.ext FROM library_versions v WHERE v.item_id = i.id
         ORDER BY v.version_no DESC LIMIT 1) AS newest_ext,
        (SELECT v.created_at FROM library_versions v WHERE v.item_id = i.id
         ORDER BY v.version_no DESC LIMIT 1) AS newest_at,
        l.source_kind, l.params_json, l.template_version_id, l.last_generated_version_id
     FROM library_items i
     LEFT JOIN library_versions cv ON cv.id = i.current_version_id
     LEFT JOIN document_links l ON l.item_id = i.id
     WHERE i.profile_id = ?";

const VERSION_SELECT: &str = "SELECT v.id, v.item_id, v.version_no, v.origin,
        v.parent_version_id, v.ext, v.plain_size, v.created_at, v.source_fingerprint,
        v.content_id, (i.current_version_id IS v.id) AS is_current
     FROM library_versions v
     JOIN library_items i ON i.id = v.item_id
     WHERE v.profile_id = ?";

const LINK_SELECT: &str = "SELECT item_id, template_version_id, source_kind, params_json,
        last_generated_version_id, source_fingerprint, created_at, updated_at
     FROM document_links WHERE profile_id = ?";

fn item_from_row(keys: &LibraryKeys, row: &SqliteRow) -> Result<LibraryItem, LibraryError> {
    let id: String = row.get("id");
    let name = keys
        .decrypt_name(&id, &row.get::<Vec<u8>, _>("name_cipher"))
        .map(|name| name.to_string())
        .unwrap_or_else(|_| "(назву пошкоджено)".to_owned());
    let ext: String = row
        .get::<Option<String>, _>("current_ext")
        .or_else(|| row.get::<Option<String>, _>("newest_ext"))
        .unwrap_or_default();
    let created_at: String = row.get("created_at");
    let link = match row.get::<Option<String>, _>("source_kind") {
        Some(kind) => Some(LinkSummary {
            source_kind: SourceKind::parse(&kind).ok_or(LibraryError::Damaged)?,
            params: serde_json::from_str(&row.get::<String, _>("params_json"))
                .map_err(|_| LibraryError::Damaged)?,
            template_version_id: row.get("template_version_id"),
            last_generated_version_id: row.get("last_generated_version_id"),
        }),
        None => None,
    };
    Ok(LibraryItem {
        kind: row.get("kind"),
        name,
        app: app_for_ext(&ext).to_owned(),
        ext,
        current_version_id: row.get("current_version_id"),
        current_origin: row
            .get::<Option<String>, _>("current_origin")
            .map(|origin| Origin::parse(&origin))
            .transpose()?,
        version_count: row.get("version_count"),
        hidden: row.get::<Option<String>, _>("hidden_at").is_some(),
        profile_table_copy: row.get::<i64, _>("profile_table_copy") != 0,
        updated_at: row
            .get::<Option<String>, _>("newest_at")
            .unwrap_or_else(|| created_at.clone()),
        created_at,
        link,
        id,
    })
}

fn version_from_row(row: &SqliteRow) -> Result<LibraryVersion, LibraryError> {
    Ok(LibraryVersion {
        id: row.get("id"),
        item_id: row.get("item_id"),
        version_no: row.get("version_no"),
        origin: Origin::parse(&row.get::<String, _>("origin"))?,
        parent_version_id: row.get("parent_version_id"),
        ext: row.get("ext"),
        size: row.get("plain_size"),
        created_at: row.get("created_at"),
        current: row.get::<i64, _>("is_current") != 0,
        source_fingerprint: row.get("source_fingerprint"),
    })
}

fn link_from_row(row: &SqliteRow) -> Result<DocumentLink, LibraryError> {
    Ok(DocumentLink {
        item_id: row.get("item_id"),
        template_version_id: row.get("template_version_id"),
        source_kind: SourceKind::parse(&row.get::<String, _>("source_kind"))
            .ok_or(LibraryError::Damaged)?,
        params: serde_json::from_str(&row.get::<String, _>("params_json"))
            .map_err(|_| LibraryError::Damaged)?,
        last_generated_version_id: row.get("last_generated_version_id"),
        source_fingerprint: row.get("source_fingerprint"),
        created_at: row.get("created_at"),
        updated_at: row.get("updated_at"),
    })
}

#[derive(Clone, Debug)]
pub struct LibraryStore {
    pool: SqlitePool,
    kdf: KdfParams,
}

impl LibraryStore {
    /// Сховище з робочими параметрами Argon2id для нових обгорток.
    pub fn new(pool: SqlitePool) -> Self {
        Self::with_kdf(pool, KdfParams::PRODUCTION)
    }

    /// Сховище з іншими параметрами для нових обгорток (тести).
    pub fn with_kdf(pool: SqlitePool, kdf: KdfParams) -> Self {
        Self { pool, kdf }
    }

    async fn keyring_row(&self, profile_id: &str) -> Result<Option<KeyringRow>, LibraryError> {
        let row = sqlx::query(
            "SELECT kdf_m, kdf_t, kdf_p, kdf_salt, wrap_nonce, wrapped_ldk, recovery_salt,
                    recovery_nonce, recovery_wrapped_ldk, state, generation
             FROM library_keyrings WHERE profile_id = ?",
        )
        .bind(profile_id)
        .fetch_optional(&self.pool)
        .await?;
        row.map(|row| {
            Ok(KeyringRow {
                kdf: KdfParams::from_row(row.get("kdf_m"), row.get("kdf_t"), row.get("kdf_p"))?,
                kdf_salt: row.get("kdf_salt"),
                wrap_nonce: row.get("wrap_nonce"),
                wrapped_ldk: row.get("wrapped_ldk"),
                recovery_salt: row.get("recovery_salt"),
                recovery_nonce: row.get("recovery_nonce"),
                recovery_wrapped_ldk: row.get("recovery_wrapped_ldk"),
                shredded: row.get::<String, _>("state") == "shredded",
                generation: row.get("generation"),
            })
        })
        .transpose()
    }

    /// Активна обгортка профілю або пояснення, чому її немає.
    async fn active_keyring(&self, profile_id: &str) -> Result<KeyringRow, LibraryError> {
        match self.keyring_row(profile_id).await? {
            None => Err(LibraryError::NotCreated),
            Some(row) if row.shredded => Err(LibraryError::Shredded),
            Some(row) => Ok(row),
        }
    }

    /// `None` — профілю немає; інакше — чи має він пароль.
    async fn profile_has_password(&self, profile_id: &str) -> Result<Option<bool>, LibraryError> {
        Ok(sqlx::query_scalar(
            "SELECT d.password_hash IS NOT NULL
             FROM local_profiles p
             LEFT JOIN local_profile_details d ON d.profile_id = p.id
             WHERE p.id = ?",
        )
        .bind(profile_id)
        .fetch_optional(&self.pool)
        .await?)
    }

    async fn ensure_password_profile(&self, profile_id: &str) -> Result<(), LibraryError> {
        match self.profile_has_password(profile_id).await? {
            None => Err(LibraryError::ProfileNotFound),
            Some(false) => Err(LibraryError::ProfileWithoutPassword),
            Some(true) => Ok(()),
        }
    }

    /// Розгортає LDK паролем; неправильний пароль (або пошкоджена обгортка) — помилка.
    async fn unwrap_with_password(
        &self,
        profile_id: &str,
        row: &KeyringRow,
        password: &str,
    ) -> Result<Zeroizing<[u8; KEY_LEN]>, LibraryError> {
        let (Some(nonce), Some(wrapped)) = (&row.wrap_nonce, &row.wrapped_ldk) else {
            return Err(LibraryError::Shredded);
        };
        let kek = derive_kek_blocking(password, &row.kdf_salt, row.kdf).await?;
        unwrap_ldk(
            &kek,
            nonce,
            wrapped,
            &keyring_aad(profile_id, Slot::Password),
        )
        .ok_or(LibraryError::WrongPassword)
    }

    pub async fn keyring_status(&self, profile_id: &str) -> Result<KeyringStatus, LibraryError> {
        Ok(match self.keyring_row(profile_id).await? {
            None => KeyringStatus::Missing,
            Some(row) if row.shredded => KeyringStatus::Shredded,
            Some(row) => KeyringStatus::Active {
                has_recovery: row.recovery_wrapped_ldk.is_some(),
                generation: row.generation,
            },
        })
    }

    pub async fn has_active_keyring(&self, profile_id: &str) -> Result<bool, LibraryError> {
        Ok(matches!(
            self.keyring_status(profile_id).await?,
            KeyringStatus::Active { .. }
        ))
    }

    /// Стан для інтерфейсу. `profile_id` — профіль, у який увійшли в цьому запуску.
    pub async fn status(
        &self,
        profile_id: Option<&str>,
        session: &LibrarySession,
    ) -> Result<LibraryStatus, LibraryError> {
        session.lock_if_idle(IDLE_LOCK_TIMEOUT);
        let Some(profile_id) = profile_id else {
            return Ok(LibraryStatus::plain(LibraryState::NoProfile, None));
        };
        match self.profile_has_password(profile_id).await? {
            None => return Ok(LibraryStatus::plain(LibraryState::NoProfile, None)),
            Some(false) => {
                return Ok(LibraryStatus::plain(
                    LibraryState::NoPassword,
                    Some(profile_id),
                ))
            }
            Some(true) => {}
        }
        let KeyringStatus::Active { has_recovery, .. } = self.keyring_status(profile_id).await?
        else {
            return Ok(LibraryStatus::plain(
                LibraryState::Missing,
                Some(profile_id),
            ));
        };
        let mut status = LibraryStatus::plain(LibraryState::Locked, Some(profile_id));
        status.has_recovery = has_recovery;
        if let Some(index) = session.index_status(profile_id) {
            status.state = LibraryState::Unlocked;
            status.indexing = index.indexing;
            status.index_ready = index.ready;
            status.damaged = index.damaged;
        }
        Ok(status)
    }

    /// Створює бібліотеку профілю з паролем (пароль перевірено викликачем) і,
    /// якщо `with_recovery`, слот коду відновлення. Повертає ключі для сесії.
    pub async fn create(
        &self,
        profile_id: &str,
        password: &str,
        with_recovery: bool,
        now: &str,
    ) -> Result<CreatedLibrary, LibraryError> {
        if !valid_profile_id(profile_id) {
            return Err(LibraryError::ProfileNotFound);
        }
        self.ensure_password_profile(profile_id).await?;
        match self.keyring_status(profile_id).await? {
            KeyringStatus::Missing => {}
            KeyringStatus::Active { .. } => return Err(LibraryError::AlreadyExists),
            KeyringStatus::Shredded => return Err(LibraryError::Shredded),
        }
        let ldk = random_key();
        let kdf_salt = random_array::<SALT_LEN>();
        let kek = derive_kek_blocking(password, &kdf_salt, self.kdf).await?;
        let (wrap_nonce, wrapped_ldk) =
            wrap_ldk(&kek, &ldk, &keyring_aad(profile_id, Slot::Password))?;
        let recovery = if with_recovery {
            let (code, secret) = generate_recovery_code();
            let salt = random_array::<SALT_LEN>();
            let (nonce, wrapped) = wrap_ldk(
                &recovery_kek(&secret, &salt),
                &ldk,
                &keyring_aad(profile_id, Slot::Recovery),
            )?;
            Some((code, salt, nonce, wrapped))
        } else {
            None
        };

        let mut transaction = self.pool.begin().await?;
        sqlx::query(
            "INSERT INTO library_keyrings
             (profile_id, format, kdf, kdf_m, kdf_t, kdf_p, kdf_salt, wrap_alg, wrap_nonce,
              wrapped_ldk, recovery_salt, recovery_nonce, recovery_wrapped_ldk, state,
              generation, created_at, updated_at)
             VALUES (?, 1, 'argon2id', ?, ?, ?, ?, 'xchacha20poly1305', ?, ?, ?, ?, ?,
                     'active', 1, ?, ?)",
        )
        .bind(profile_id)
        .bind(i64::from(self.kdf.m_kib))
        .bind(i64::from(self.kdf.t))
        .bind(i64::from(self.kdf.p))
        .bind(&kdf_salt[..])
        .bind(&wrap_nonce[..])
        .bind(&wrapped_ldk)
        .bind(recovery.as_ref().map(|(_, salt, _, _)| salt.to_vec()))
        .bind(recovery.as_ref().map(|(_, _, nonce, _)| nonce.to_vec()))
        .bind(recovery.as_ref().map(|(_, _, _, wrapped)| wrapped.clone()))
        .bind(now)
        .bind(now)
        .execute(&mut *transaction)
        .await
        .map_err(|error| {
            if error
                .as_database_error()
                .is_some_and(|database| database.message().contains("already exists"))
            {
                LibraryError::AlreadyExists
            } else {
                LibraryError::Storage(error)
            }
        })?;
        insert_event(
            &mut *transaction,
            profile_id,
            LibraryEventKind::Created,
            None,
            None,
            now,
        )
        .await?;
        transaction.commit().await?;
        Ok(CreatedLibrary {
            keys: LibraryKeys::derive(profile_id, &ldk),
            recovery_code: recovery.map(|(code, _, _, _)| code),
        })
    }

    /// Розгортає LDK паролем профілю і записує подію `unlocked`. Пароль входу
    /// (з обмежувачем спроб) викликач перевіряє окремо й раніше.
    pub async fn unlock(
        &self,
        profile_id: &str,
        password: &str,
        now: &str,
    ) -> Result<LibraryKeys, LibraryError> {
        self.ensure_password_profile(profile_id).await?;
        let row = self.active_keyring(profile_id).await?;
        let ldk = self
            .unwrap_with_password(profile_id, &row, password)
            .await?;
        insert_event(
            &self.pool,
            profile_id,
            LibraryEventKind::Unlocked,
            None,
            None,
            now,
        )
        .await?;
        Ok(LibraryKeys::derive(profile_id, &ldk))
    }

    /// Документи профілю з розшифрованими назвами, за назвою без урахування регістру.
    pub async fn list_items(
        &self,
        keys: &LibraryKeys,
        include_hidden: bool,
    ) -> Result<Vec<LibraryItem>, LibraryError> {
        let rows = sqlx::query(&format!("{ITEM_SELECT} AND (? OR i.hidden_at IS NULL)"))
            .bind(keys.profile_id())
            .bind(include_hidden)
            .fetch_all(&self.pool)
            .await?;
        let mut items = rows
            .iter()
            .map(|row| item_from_row(keys, row))
            .collect::<Result<Vec<_>, _>>()?;
        items.sort_by_cached_key(|item| (item.name.to_lowercase(), item.id.clone()));
        Ok(items)
    }

    pub async fn item(
        &self,
        keys: &LibraryKeys,
        item_id: &str,
    ) -> Result<LibraryItem, LibraryError> {
        let row = sqlx::query(&format!("{ITEM_SELECT} AND i.id = ?"))
            .bind(keys.profile_id())
            .bind(item_id)
            .fetch_optional(&self.pool)
            .await?
            .ok_or(LibraryError::ItemNotFound)?;
        item_from_row(keys, &row)
    }

    /// Версії документа, новіші першими.
    pub async fn versions(
        &self,
        keys: &LibraryKeys,
        item_id: &str,
    ) -> Result<Vec<LibraryVersion>, LibraryError> {
        let exists: Option<i64> =
            sqlx::query_scalar("SELECT 1 FROM library_items WHERE id = ? AND profile_id = ?")
                .bind(item_id)
                .bind(keys.profile_id())
                .fetch_optional(&self.pool)
                .await?;
        if exists.is_none() {
            return Err(LibraryError::ItemNotFound);
        }
        sqlx::query(&format!(
            "{VERSION_SELECT} AND v.item_id = ? ORDER BY v.version_no DESC"
        ))
        .bind(keys.profile_id())
        .bind(item_id)
        .fetch_all(&self.pool)
        .await?
        .iter()
        .map(version_from_row)
        .collect()
    }

    pub async fn version(
        &self,
        keys: &LibraryKeys,
        version_id: &str,
    ) -> Result<LibraryVersion, LibraryError> {
        let row = sqlx::query(&format!("{VERSION_SELECT} AND v.id = ?"))
            .bind(keys.profile_id())
            .bind(version_id)
            .fetch_optional(&self.pool)
            .await?
            .ok_or(LibraryError::VersionNotFound)?;
        version_from_row(&row)
    }

    /// Розшифровані байти версії. Буфер затирається, коли викликач його відпускає.
    pub async fn read_version(
        &self,
        keys: &LibraryKeys,
        version_id: &str,
    ) -> Result<(LibraryVersion, Zeroizing<Vec<u8>>), LibraryError> {
        let row = sqlx::query(&format!(
            "SELECT * FROM ({VERSION_SELECT} AND v.id = ?) AS selected
             LEFT JOIN library_blobs b
               ON b.profile_id = ? AND b.content_id = selected.content_id"
        ))
        .bind(keys.profile_id())
        .bind(version_id)
        .bind(keys.profile_id())
        .fetch_optional(&self.pool)
        .await?
        .ok_or(LibraryError::VersionNotFound)?;
        let version = version_from_row(&row)?;
        let content_id: String = row.get("content_id");
        let data: Option<Vec<u8>> = row.get("data");
        let plain = keys.decrypt_blob(&content_id, &data.ok_or(LibraryError::Damaged)?)?;
        if i64::try_from(plain.len()).ok() != Some(version.size) {
            return Err(LibraryError::Damaged);
        }
        Ok((version, plain))
    }

    /// Новий документ: рядок документа, вміст і версія 1 (`imported`) в одній транзакції.
    pub async fn import(
        &self,
        keys: &LibraryKeys,
        document: NewDocument<'_>,
        now: &str,
    ) -> Result<(LibraryItem, LibraryVersion), LibraryError> {
        let ext = normalize_ext(document.ext)?;
        let name = clean_name(document.name)?;
        let kind = kind_for(ext, document.as_template);
        let sealed = seal_content(keys, document.bytes)?;
        let item_id = random_id("doc");
        let name_cipher = keys.encrypt_name(&item_id, &name)?;

        let mut transaction = self.pool.begin().await?;
        sqlx::query(
            "INSERT INTO library_items (id, profile_id, kind, name_cipher, profile_table_copy, created_at)
             VALUES (?, ?, ?, ?, ?, ?)",
        )
        .bind(&item_id)
        .bind(keys.profile_id())
        .bind(kind)
        .bind(&name_cipher)
        .bind(i64::from(document.profile_table_copy))
        .bind(now)
        .execute(&mut *transaction)
        .await?;
        store_content(&mut transaction, keys, &sealed, now).await?;
        let mut version = insert_version(
            &mut transaction,
            keys,
            &item_id,
            &sealed,
            ext,
            Origin::Imported,
            None,
            None,
            now,
        )
        .await?;
        set_current_in(&mut transaction, keys, &item_id, &version.id).await?;
        insert_event(
            &mut *transaction,
            keys.profile_id(),
            LibraryEventKind::Imported,
            Some(&item_id),
            Some(&version.id),
            now,
        )
        .await?;
        transaction.commit().await?;
        version.current = true;
        Ok((self.item(keys, &item_id).await?, version))
    }

    /// Нова версія з редактора. Якщо вміст збігається з батьківською або поточною
    /// версією — нічого не записується й повертається `None`. Інакше вміст (якщо
    /// новий), версія, за потреби поточна версія й подія — в одній транзакції.
    pub async fn save_version(
        &self,
        keys: &LibraryKeys,
        item_id: &str,
        new: NewVersion<'_>,
        now: &str,
    ) -> Result<Option<LibraryVersion>, LibraryError> {
        if !matches!(new.origin, Origin::Edited | Origin::Saved) {
            return Err(LibraryError::InvalidOrigin);
        }
        let ext = normalize_ext(new.ext)?;
        if let Some(value) = new.source_fingerprint {
            validate_fingerprint(value)?;
        }
        let sealed = seal_content(keys, new.bytes)?;

        let mut transaction = self.pool.begin().await?;
        let item = sqlx::query(
            "SELECT cv.content_id AS current_content,
                    coalesce(cv.ext, (SELECT v.ext FROM library_versions v WHERE v.item_id = i.id
                                      ORDER BY v.version_no DESC LIMIT 1)) AS item_ext
             FROM library_items i
             LEFT JOIN library_versions cv ON cv.id = i.current_version_id
             WHERE i.id = ? AND i.profile_id = ?",
        )
        .bind(item_id)
        .bind(keys.profile_id())
        .fetch_optional(&mut *transaction)
        .await?
        .ok_or(LibraryError::ItemNotFound)?;
        let current_content: Option<String> = item.get("current_content");
        let item_ext: Option<String> = item.get("item_ext");
        if item_ext.is_some_and(|known| app_for_ext(&known) != app_for_ext(ext)) {
            return Err(LibraryError::FormatMismatch(ext.to_owned()));
        }
        let parent_content = match new.parent_version_id {
            Some(parent) => Some(
                sqlx::query_scalar::<_, String>(
                    "SELECT content_id FROM library_versions
                     WHERE id = ? AND item_id = ? AND profile_id = ?",
                )
                .bind(parent)
                .bind(item_id)
                .bind(keys.profile_id())
                .fetch_optional(&mut *transaction)
                .await?
                .ok_or(LibraryError::VersionNotFound)?,
            ),
            None => None,
        };
        if current_content.as_deref() == Some(sealed.content_id.as_str())
            || parent_content.as_deref() == Some(sealed.content_id.as_str())
        {
            return Ok(None);
        }
        store_content(&mut transaction, keys, &sealed, now).await?;
        let mut version = insert_version(
            &mut transaction,
            keys,
            item_id,
            &sealed,
            ext,
            new.origin,
            new.parent_version_id,
            new.source_fingerprint,
            now,
        )
        .await?;
        if new.make_current {
            set_current_in(&mut transaction, keys, item_id, &version.id).await?;
            version.current = true;
        }
        insert_event(
            &mut *transaction,
            keys.profile_id(),
            LibraryEventKind::VersionSaved,
            Some(item_id),
            Some(&version.id),
            now,
        )
        .await?;
        transaction.commit().await?;
        Ok(Some(version))
    }

    pub async fn rename(
        &self,
        keys: &LibraryKeys,
        item_id: &str,
        name: &str,
        now: &str,
    ) -> Result<LibraryItem, LibraryError> {
        let name = clean_name(name)?;
        let name_cipher = keys.encrypt_name(item_id, &name)?;
        let mut transaction = self.pool.begin().await?;
        let updated =
            sqlx::query("UPDATE library_items SET name_cipher = ? WHERE id = ? AND profile_id = ?")
                .bind(&name_cipher)
                .bind(item_id)
                .bind(keys.profile_id())
                .execute(&mut *transaction)
                .await?;
        if updated.rows_affected() != 1 {
            return Err(LibraryError::ItemNotFound);
        }
        insert_event(
            &mut *transaction,
            keys.profile_id(),
            LibraryEventKind::Renamed,
            Some(item_id),
            None,
            now,
        )
        .await?;
        transaction.commit().await?;
        self.item(keys, item_id).await
    }

    pub async fn set_hidden(
        &self,
        keys: &LibraryKeys,
        item_id: &str,
        hidden: bool,
        now: &str,
    ) -> Result<LibraryItem, LibraryError> {
        let mut transaction = self.pool.begin().await?;
        let hidden_at: Option<Option<String>> = sqlx::query_scalar(
            "SELECT hidden_at FROM library_items WHERE id = ? AND profile_id = ?",
        )
        .bind(item_id)
        .bind(keys.profile_id())
        .fetch_optional(&mut *transaction)
        .await?;
        let Some(hidden_at) = hidden_at else {
            return Err(LibraryError::ItemNotFound);
        };
        if hidden_at.is_some() != hidden {
            sqlx::query("UPDATE library_items SET hidden_at = ? WHERE id = ? AND profile_id = ?")
                .bind(hidden.then_some(now))
                .bind(item_id)
                .bind(keys.profile_id())
                .execute(&mut *transaction)
                .await?;
            insert_event(
                &mut *transaction,
                keys.profile_id(),
                if hidden {
                    LibraryEventKind::Hidden
                } else {
                    LibraryEventKind::Shown
                },
                Some(item_id),
                None,
                now,
            )
            .await?;
        }
        transaction.commit().await?;
        self.item(keys, item_id).await
    }

    /// Робить поточною одну з версій цього ж документа.
    pub async fn set_current(
        &self,
        keys: &LibraryKeys,
        item_id: &str,
        version_id: &str,
        now: &str,
    ) -> Result<LibraryItem, LibraryError> {
        let mut transaction = self.pool.begin().await?;
        let item: Option<Option<String>> = sqlx::query_scalar(
            "SELECT current_version_id FROM library_items WHERE id = ? AND profile_id = ?",
        )
        .bind(item_id)
        .bind(keys.profile_id())
        .fetch_optional(&mut *transaction)
        .await?;
        let Some(current) = item else {
            return Err(LibraryError::ItemNotFound);
        };
        let owned: Option<i64> = sqlx::query_scalar(
            "SELECT 1 FROM library_versions WHERE id = ? AND item_id = ? AND profile_id = ?",
        )
        .bind(version_id)
        .bind(item_id)
        .bind(keys.profile_id())
        .fetch_optional(&mut *transaction)
        .await?;
        if owned.is_none() {
            return Err(LibraryError::VersionNotFound);
        }
        if current.as_deref() != Some(version_id) {
            set_current_in(&mut transaction, keys, item_id, version_id).await?;
            insert_event(
                &mut *transaction,
                keys.profile_id(),
                LibraryEventKind::CurrentChanged,
                Some(item_id),
                Some(version_id),
                now,
            )
            .await?;
        }
        transaction.commit().await?;
        self.item(keys, item_id).await
    }

    /// Подія, яку записує викликач (`exported`, `archive_exported`).
    pub async fn record_event(
        &self,
        keys: &LibraryKeys,
        event: LibraryEventKind,
        item_id: Option<&str>,
        version_id: Option<&str>,
        now: &str,
    ) -> Result<(), LibraryError> {
        insert_event(
            &self.pool,
            keys.profile_id(),
            event,
            item_id,
            version_id,
            now,
        )
        .await?;
        Ok(())
    }

    /// Журнал подій профілю в порядку запису.
    pub async fn events(&self, profile_id: &str) -> Result<Vec<LibraryEventRecord>, LibraryError> {
        let rows = sqlx::query(
            "SELECT id, event, item_id, version_id, created_at FROM library_events
             WHERE profile_id = ? ORDER BY id",
        )
        .bind(profile_id)
        .fetch_all(&self.pool)
        .await?;
        Ok(rows
            .iter()
            .map(|row| LibraryEventRecord {
                id: row.get("id"),
                event: row.get("event"),
                item_id: row.get("item_id"),
                version_id: row.get("version_id"),
                created_at: row.get("created_at"),
            })
            .collect())
    }

    /// Документи, поточна версія яких не розшифровується.
    pub async fn damaged_items(&self, keys: &LibraryKeys) -> Result<Vec<String>, LibraryError> {
        let mut damaged = Vec::new();
        for (item_id, version_id) in self.current_versions(keys).await? {
            match self.read_version(keys, &version_id).await {
                Ok(_) => {}
                Err(LibraryError::Damaged) => damaged.push(item_id),
                Err(error) => return Err(error),
            }
        }
        Ok(damaged)
    }

    /// (документ, поточна версія) усіх документів профілю, разом із прихованими.
    async fn current_versions(
        &self,
        keys: &LibraryKeys,
    ) -> Result<Vec<(String, String)>, LibraryError> {
        Ok(sqlx::query_as(
            "SELECT id, current_version_id FROM library_items
             WHERE profile_id = ? AND current_version_id IS NOT NULL
             ORDER BY created_at, id",
        )
        .bind(keys.profile_id())
        .fetch_all(&self.pool)
        .await?)
    }

    // --- Зміна пароля ------------------------------------------------------

    /// Крок до транзакції: розгортає LDK старим паролем і загортає новим ключем з
    /// новою сіллю. `None` — у профілю немає активної бібліотеки (переобгортати нічого).
    pub async fn prepare_password_rewrap(
        &self,
        profile_id: &str,
        old_password: &str,
        new_password: &str,
    ) -> Result<Option<PreparedRewrap>, LibraryError> {
        let row = match self.keyring_row(profile_id).await? {
            Some(row) if !row.shredded => row,
            _ => return Ok(None),
        };
        let ldk = self
            .unwrap_with_password(profile_id, &row, old_password)
            .await?;
        Ok(Some(
            self.password_slot(profile_id, row.generation, &ldk, new_password)
                .await?,
        ))
    }

    async fn password_slot(
        &self,
        profile_id: &str,
        generation: i64,
        ldk: &[u8; KEY_LEN],
        password: &str,
    ) -> Result<PreparedRewrap, LibraryError> {
        let kdf_salt = random_array::<SALT_LEN>();
        let kek = derive_kek_blocking(password, &kdf_salt, self.kdf).await?;
        let (wrap_nonce, wrapped_ldk) =
            wrap_ldk(&kek, ldk, &keyring_aad(profile_id, Slot::Password))?;
        Ok(PreparedRewrap {
            profile_id: profile_id.to_owned(),
            generation,
            kdf: self.kdf,
            kdf_salt,
            wrap_nonce,
            wrapped_ldk,
        })
    }

    // --- Код відновлення ---------------------------------------------------

    /// Крок до транзакції для «Забув пароль»: перевіряє код, розгортає LDK слотом
    /// відновлення, готує основний слот з новим паролем і **новий** код відновлення
    /// (старий після застосування недійсний).
    pub async fn prepare_recovery(
        &self,
        profile_id: &str,
        code: &str,
        new_password: &str,
    ) -> Result<PreparedRecovery, LibraryError> {
        let secret = parse_recovery_code(code)?;
        let row = self.active_keyring(profile_id).await?;
        let (Some(salt), Some(nonce), Some(wrapped)) = (
            &row.recovery_salt,
            &row.recovery_nonce,
            &row.recovery_wrapped_ldk,
        ) else {
            return Err(LibraryError::RecoveryNotSet);
        };
        let ldk = unwrap_ldk(
            &recovery_kek(&secret, salt),
            nonce,
            wrapped,
            &keyring_aad(profile_id, Slot::Recovery),
        )
        .ok_or(LibraryError::RecoveryMismatch)?;
        let password = self
            .password_slot(profile_id, row.generation, &ldk, new_password)
            .await?;
        let recovery = RecoverySlot::new(profile_id, &ldk)?;
        Ok(PreparedRecovery {
            password,
            recovery,
            keys: LibraryKeys::derive(profile_id, &ldk),
        })
    }

    /// Новий код відновлення з розблокованої бібліотеки за паролем (пароль входу
    /// перевіряє викликач). Старий слот замінюється в одній транзакції.
    pub async fn reissue_recovery(
        &self,
        profile_id: &str,
        password: &str,
        now: &str,
    ) -> Result<RecoveryCode, LibraryError> {
        let row = self.active_keyring(profile_id).await?;
        let ldk = self
            .unwrap_with_password(profile_id, &row, password)
            .await?;
        let slot = RecoverySlot::new(profile_id, &ldk)?;
        let mut transaction = self.pool.begin().await?;
        let updated = sqlx::query(
            "UPDATE library_keyrings
             SET recovery_salt = ?, recovery_nonce = ?, recovery_wrapped_ldk = ?,
                 generation = generation + 1, updated_at = ?
             WHERE profile_id = ? AND state = 'active' AND generation = ?",
        )
        .bind(&slot.salt[..])
        .bind(&slot.nonce[..])
        .bind(&slot.wrapped)
        .bind(now)
        .bind(profile_id)
        .bind(row.generation)
        .execute(&mut *transaction)
        .await?;
        if updated.rows_affected() != 1 {
            return Err(LibraryError::KeyringChanged);
        }
        insert_event(
            &mut *transaction,
            profile_id,
            LibraryEventKind::RecoveryReissued,
            None,
            None,
            now,
        )
        .await?;
        transaction.commit().await?;
        Ok(slot.code)
    }

    // --- Очистка -----------------------------------------------------------

    /// Криптознищення бібліотеки профілю в транзакції викликача, яка далі видаляє
    /// сам профіль: обгортка → `shredded` без жодного слота, шифротекст вмісту →
    /// NULL (з `secure_delete`, щоб звільнені сторінки затерлися), зв'язки
    /// прибираються, записуються подія `purged` і рядок `library_purges`. Документи
    /// й версії лишаються незмінними «надгробками», яких без ключа не прочитати.
    pub async fn purge_in_transaction(
        transaction: &mut Transaction<'_, Sqlite>,
        profile_id: &str,
        now: &str,
    ) -> Result<PurgeSummary, LibraryError> {
        sqlx::query("PRAGMA secure_delete = ON")
            .execute(&mut **transaction)
            .await?;
        let shredded = sqlx::query(
            "UPDATE library_keyrings
             SET state = 'shredded', wrap_nonce = NULL, wrapped_ldk = NULL,
                 recovery_salt = NULL, recovery_nonce = NULL, recovery_wrapped_ldk = NULL,
                 generation = generation + 1, updated_at = ?
             WHERE profile_id = ? AND state = 'active'",
        )
        .bind(now)
        .bind(profile_id)
        .execute(&mut **transaction)
        .await?;
        if shredded.rows_affected() != 1 {
            return Err(LibraryError::NotCreated);
        }
        let (items, versions): (i64, i64) = sqlx::query_as(
            "SELECT (SELECT count(*) FROM library_items WHERE profile_id = ?1),
                    (SELECT count(*) FROM library_versions WHERE profile_id = ?1)",
        )
        .bind(profile_id)
        .fetch_one(&mut **transaction)
        .await?;
        sqlx::query("DELETE FROM document_links WHERE profile_id = ?")
            .bind(profile_id)
            .execute(&mut **transaction)
            .await?;
        sqlx::query(
            "UPDATE library_blobs SET data = NULL WHERE profile_id = ? AND data IS NOT NULL",
        )
        .bind(profile_id)
        .execute(&mut **transaction)
        .await?;
        insert_event(
            &mut **transaction,
            profile_id,
            LibraryEventKind::Purged,
            None,
            None,
            now,
        )
        .await?;
        sqlx::query(
            "INSERT INTO library_purges (profile_id, items, versions, created_at) VALUES (?, ?, ?, ?)",
        )
        .bind(profile_id)
        .bind(items)
        .bind(versions)
        .bind(now)
        .execute(&mut **transaction)
        .await?;
        Ok(PurgeSummary { items, versions })
    }

    // --- Архів -------------------------------------------------------------

    /// ZIP у пам'яті з поточними версіями всіх документів (і прихованих), імена
    /// `<назва>.<розширення>` без повторів. Пошкоджені документи пропускаються й
    /// перелічуються в `damaged`.
    pub async fn export_archive(&self, keys: &LibraryKeys) -> Result<ArchiveExport, LibraryError> {
        let items = self.list_items(keys, true).await?;
        let mut writer = zip::ZipWriter::new(Cursor::new(Vec::new()));
        let options = zip::write::SimpleFileOptions::default()
            .compression_method(zip::CompressionMethod::Deflated);
        let mut used = HashSet::new();
        let mut entries = Vec::new();
        let mut damaged = Vec::new();
        for item in &items {
            let Some(version_id) = &item.current_version_id else {
                continue;
            };
            let bytes = match self.read_version(keys, version_id).await {
                Ok((_, bytes)) => bytes,
                Err(LibraryError::Damaged) => {
                    damaged.push(item.id.clone());
                    continue;
                }
                Err(error) => return Err(error),
            };
            let entry = archive_entry_name(&item.name, &item.ext, &mut used);
            writer
                .start_file(entry.as_str(), options)
                .map_err(|_| LibraryError::Archive)?;
            writer
                .write_all(&bytes)
                .map_err(|_| LibraryError::Archive)?;
            entries.push(entry);
        }
        let bytes = writer
            .finish()
            .map_err(|_| LibraryError::Archive)?
            .into_inner();
        Ok(ArchiveExport {
            bytes: Zeroizing::new(bytes),
            entries,
            damaged,
        })
    }

    // --- Зв'язки з джерелами -----------------------------------------------

    /// Зберігає згенерований документ: новий документ із зв'язком або нову версію
    /// пов'язаного документа з оновленням зв'язку — в одній транзакції. Відбиток
    /// перевіряє (перераховує) викликач. Вміст, що збігається з останньою
    /// згенерованою версією, нової версії не створює.
    pub async fn save_generated(
        &self,
        keys: &LibraryKeys,
        generated: GeneratedDocument<'_>,
        now: &str,
    ) -> Result<GeneratedSave, LibraryError> {
        let ext = normalize_ext(generated.ext)?;
        if !TEMPLATE_EXTENSIONS.contains(&ext) {
            return Err(LibraryError::FormatMismatch(ext.to_owned()));
        }
        validate_fingerprint(generated.fingerprint)?;
        let params_json = String::from_utf8(canonical_json(generated.params))
            .map_err(|_| LibraryError::InvalidLink("параметри джерела мають бути JSON"))?;
        if params_json.len() > MAX_PARAMS_JSON {
            return Err(LibraryError::InvalidLink("параметри джерела завеликі"));
        }
        let sealed = seal_content(keys, generated.bytes)?;

        let mut transaction = self.pool.begin().await?;
        let template_owned: Option<i64> =
            sqlx::query_scalar("SELECT 1 FROM library_versions WHERE id = ? AND profile_id = ?")
                .bind(generated.template_version_id)
                .bind(keys.profile_id())
                .fetch_optional(&mut *transaction)
                .await?;
        if template_owned.is_none() {
            return Err(LibraryError::VersionNotFound);
        }

        let (item_id, version, created) = match generated.item_id {
            None => {
                let name = clean_name(generated.name.unwrap_or_default())?;
                let item_id = random_id("doc");
                let name_cipher = keys.encrypt_name(&item_id, &name)?;
                sqlx::query(
                    "INSERT INTO library_items (id, profile_id, kind, name_cipher, created_at)
                     VALUES (?, ?, ?, ?, ?)",
                )
                .bind(&item_id)
                .bind(keys.profile_id())
                .bind(kind_for(ext, false))
                .bind(&name_cipher)
                .bind(now)
                .execute(&mut *transaction)
                .await?;
                store_content(&mut transaction, keys, &sealed, now).await?;
                let mut version = insert_version(
                    &mut transaction,
                    keys,
                    &item_id,
                    &sealed,
                    ext,
                    Origin::Generated,
                    None,
                    Some(generated.fingerprint),
                    now,
                )
                .await?;
                set_current_in(&mut transaction, keys, &item_id, &version.id).await?;
                version.current = true;
                sqlx::query(
                    "INSERT INTO document_links
                     (item_id, profile_id, template_version_id, source_kind, params_json,
                      last_generated_version_id, source_fingerprint, created_at, updated_at)
                     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
                )
                .bind(&item_id)
                .bind(keys.profile_id())
                .bind(generated.template_version_id)
                .bind(generated.source_kind.as_str())
                .bind(&params_json)
                .bind(&version.id)
                .bind(generated.fingerprint)
                .bind(now)
                .bind(now)
                .execute(&mut *transaction)
                .await?;
                (item_id, version, true)
            }
            Some(item_id) => {
                let link = sqlx::query(
                    "SELECT l.template_version_id, l.source_kind, l.params_json,
                            l.last_generated_version_id, lv.content_id AS last_content,
                            i.current_version_id,
                            coalesce(cv.ext, (SELECT v.ext FROM library_versions v
                                              WHERE v.item_id = i.id
                                              ORDER BY v.version_no DESC LIMIT 1)) AS item_ext
                     FROM library_items i
                     LEFT JOIN document_links l ON l.item_id = i.id
                     LEFT JOIN library_versions lv ON lv.id = l.last_generated_version_id
                     LEFT JOIN library_versions cv ON cv.id = i.current_version_id
                     WHERE i.id = ? AND i.profile_id = ?",
                )
                .bind(item_id)
                .bind(keys.profile_id())
                .fetch_optional(&mut *transaction)
                .await?
                .ok_or(LibraryError::ItemNotFound)?;
                let Some(template) = link.get::<Option<String>, _>("template_version_id") else {
                    return Err(LibraryError::LinkNotFound);
                };
                if link
                    .get::<Option<String>, _>("item_ext")
                    .is_some_and(|known| app_for_ext(&known) != app_for_ext(ext))
                {
                    return Err(LibraryError::FormatMismatch(ext.to_owned()));
                }
                let last_generated: Option<String> = link.get("last_generated_version_id");
                let current: Option<String> = link.get("current_version_id");
                let same_source = template == generated.template_version_id
                    && link.get::<Option<String>, _>("source_kind").as_deref()
                        == Some(generated.source_kind.as_str())
                    && link.get::<Option<String>, _>("params_json").as_deref()
                        == Some(params_json.as_str());
                let reused = match (
                    &last_generated,
                    link.get::<Option<String>, _>("last_content"),
                ) {
                    (Some(last), Some(content)) if content == sealed.content_id => {
                        Some(last.clone())
                    }
                    _ => None,
                };
                let (version_id, created) = match reused {
                    Some(version_id) => (version_id, false),
                    None => {
                        store_content(&mut transaction, keys, &sealed, now).await?;
                        // Батьківська версія згенерованої — попередня згенерована: так
                        // видно лінію генерацій окремо від ручних правок.
                        let version = insert_version(
                            &mut transaction,
                            keys,
                            item_id,
                            &sealed,
                            ext,
                            Origin::Generated,
                            last_generated.as_deref(),
                            Some(generated.fingerprint),
                            now,
                        )
                        .await?;
                        (version.id, true)
                    }
                };
                if generated.make_current && current.as_deref() != Some(version_id.as_str()) {
                    set_current_in(&mut transaction, keys, item_id, &version_id).await?;
                }
                if same_source {
                    sqlx::query(
                        "UPDATE document_links
                         SET last_generated_version_id = ?, source_fingerprint = ?, updated_at = ?
                         WHERE item_id = ? AND profile_id = ?",
                    )
                    .bind(&version_id)
                    .bind(generated.fingerprint)
                    .bind(now)
                    .bind(item_id)
                    .bind(keys.profile_id())
                    .execute(&mut *transaction)
                    .await?;
                } else {
                    // Інший шаблон чи параметри — це новий зв'язок (у рядку зв'язку
                    // ці поля незмінні).
                    sqlx::query("DELETE FROM document_links WHERE item_id = ? AND profile_id = ?")
                        .bind(item_id)
                        .bind(keys.profile_id())
                        .execute(&mut *transaction)
                        .await?;
                    sqlx::query(
                        "INSERT INTO document_links
                         (item_id, profile_id, template_version_id, source_kind, params_json,
                          last_generated_version_id, source_fingerprint, created_at, updated_at)
                         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
                    )
                    .bind(item_id)
                    .bind(keys.profile_id())
                    .bind(generated.template_version_id)
                    .bind(generated.source_kind.as_str())
                    .bind(&params_json)
                    .bind(&version_id)
                    .bind(generated.fingerprint)
                    .bind(now)
                    .bind(now)
                    .execute(&mut *transaction)
                    .await?;
                }
                let version = sqlx::query(&format!("{VERSION_SELECT} AND v.id = ?"))
                    .bind(keys.profile_id())
                    .bind(&version_id)
                    .fetch_one(&mut *transaction)
                    .await?;
                (item_id.to_owned(), version_from_row(&version)?, created)
            }
        };
        if created {
            insert_event(
                &mut *transaction,
                keys.profile_id(),
                LibraryEventKind::Generated,
                Some(&item_id),
                Some(&version.id),
                now,
            )
            .await?;
        }
        transaction.commit().await?;
        Ok(GeneratedSave {
            item: self.item(keys, &item_id).await?,
            version,
            created,
        })
    }

    pub async fn link(
        &self,
        keys: &LibraryKeys,
        item_id: &str,
    ) -> Result<Option<DocumentLink>, LibraryError> {
        sqlx::query(&format!("{LINK_SELECT} AND item_id = ?"))
            .bind(keys.profile_id())
            .bind(item_id)
            .fetch_optional(&self.pool)
            .await?
            .as_ref()
            .map(link_from_row)
            .transpose()
    }

    pub async fn links(&self, keys: &LibraryKeys) -> Result<Vec<DocumentLink>, LibraryError> {
        sqlx::query(&format!("{LINK_SELECT} ORDER BY item_id"))
            .bind(keys.profile_id())
            .fetch_all(&self.pool)
            .await?
            .iter()
            .map(link_from_row)
            .collect()
    }

    /// «Відв'язати від джерела»: прибирає лише рядок зв'язку.
    pub async fn unlink(
        &self,
        keys: &LibraryKeys,
        item_id: &str,
    ) -> Result<LibraryItem, LibraryError> {
        let removed =
            sqlx::query("DELETE FROM document_links WHERE item_id = ? AND profile_id = ?")
                .bind(item_id)
                .bind(keys.profile_id())
                .execute(&self.pool)
                .await?;
        if removed.rows_affected() != 1 {
            return Err(LibraryError::LinkNotFound);
        }
        self.item(keys, item_id).await
    }

    // --- Індекс і пошук ----------------------------------------------------

    /// Будує тимчасовий індекс: розшифровує поточну версію кожного документа,
    /// витягує текст (у пулі блокувальних задач, з межами) і додає в FTS5. Між
    /// документами питає `still_wanted`; якщо бібліотеку вже заблоковано, індекс
    /// закривається й повертається `None`.
    pub async fn build_index<F>(
        &self,
        keys: &LibraryKeys,
        limits: IndexLimits,
        extract: ExtractLimits,
        still_wanted: F,
    ) -> Result<Option<(SearchIndex, IndexReport)>, LibraryError>
    where
        F: Fn() -> bool + Send + Sync,
    {
        let index = SearchIndex::open().await?;
        let mut builder = IndexBuilder::new(limits);
        for (item_id, version_id) in self.current_versions(keys).await? {
            if !still_wanted() {
                index.shutdown();
                return Ok(None);
            }
            let (version, bytes) = match self.read_version(keys, &version_id).await {
                Ok(read) => read,
                Err(LibraryError::Damaged) => {
                    builder.report.damaged.push(item_id);
                    continue;
                }
                Err(error) => {
                    index.shutdown();
                    return Err(error);
                }
            };
            let ext = version.ext;
            let extracted =
                tokio::task::spawn_blocking(move || extract_text_with(&ext, &bytes, extract))
                    .await
                    .map_err(|_| LibraryError::Extraction("розбір документа перервано"))?;
            match extracted {
                Ok(extracted) => builder.add(&index, &item_id, &extracted).await?,
                Err(_) => builder.report.skipped.push(item_id),
            }
        }
        if !still_wanted() {
            index.shutdown();
            return Ok(None);
        }
        Ok(Some((index, builder.report)))
    }

    /// Будує індекс для сесії й встановлює його, якщо за цей час бібліотеку не
    /// заблоковано і не розблоковано наново. `true` — індекс встановлено.
    pub async fn run_index_build(
        &self,
        session: &LibrarySession,
        profile_id: &str,
    ) -> Result<bool, LibraryError> {
        let Some((epoch, keys)) = session.begin_index(profile_id) else {
            return Ok(false);
        };
        let built = self
            .build_index(&keys, IndexLimits::DEFAULT, ExtractLimits::DEFAULT, || {
                session.is_current(epoch)
            })
            .await;
        drop(keys);
        match built {
            Ok(Some((index, report))) => Ok(session.finish_index(epoch, index, report)),
            Ok(None) => Ok(false),
            Err(error) => {
                session.fail_index(epoch);
                Err(error)
            }
        }
    }

    /// Пошук за назвами (завжди) і за вмістом (коли індекс готовий).
    pub async fn search(
        &self,
        session: &LibrarySession,
        keys: &LibraryKeys,
        query: &str,
        include_hidden: bool,
    ) -> Result<SearchResponse, LibraryError> {
        let items = self.list_items(keys, include_hidden).await?;
        let index = session.search_index(keys.profile_id())?;
        let index_ready = index.is_some();
        let content = match index {
            Some(index) => index.search(query, SEARCH_RESULTS).await?,
            None => Vec::new(),
        };
        Ok(SearchResponse {
            index_ready,
            results: combine_hits(&items, query, content),
        })
    }
}

/// Слот відновлення, готовий до запису, і код для показу.
struct RecoverySlot {
    salt: [u8; SALT_LEN],
    nonce: [u8; NONCE_LEN],
    wrapped: Vec<u8>,
    code: RecoveryCode,
}

impl RecoverySlot {
    fn new(profile_id: &str, ldk: &[u8; KEY_LEN]) -> Result<Self, LibraryError> {
        let (code, secret) = generate_recovery_code();
        let salt = random_array::<SALT_LEN>();
        let (nonce, wrapped) = wrap_ldk(
            &recovery_kek(&secret, &salt),
            ldk,
            &keyring_aad(profile_id, Slot::Recovery),
        )?;
        Ok(Self {
            salt,
            nonce,
            wrapped,
            code,
        })
    }
}

/// Нова основна обгортка, підготовлена поза транзакцією (Argon2id не тримає базу).
pub struct PreparedRewrap {
    profile_id: String,
    generation: i64,
    kdf: KdfParams,
    kdf_salt: [u8; SALT_LEN],
    wrap_nonce: [u8; NONCE_LEN],
    wrapped_ldk: Vec<u8>,
}

impl fmt::Debug for PreparedRewrap {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter
            .debug_struct("PreparedRewrap")
            .field("profile_id", &self.profile_id)
            .field("generation", &self.generation)
            .finish_non_exhaustive()
    }
}

impl PreparedRewrap {
    pub fn profile_id(&self) -> &str {
        &self.profile_id
    }

    /// Записує нову обгортку в транзакції викликача (там само — новий хеш входу).
    /// `WHERE generation = старе`: якщо обгортку тим часом змінили, нічого не
    /// записується й повертається [`LibraryError::KeyringChanged`].
    pub async fn apply(
        &self,
        transaction: &mut Transaction<'_, Sqlite>,
        now: &str,
    ) -> Result<(), LibraryError> {
        self.apply_slot(transaction, now).await?;
        insert_event(
            &mut **transaction,
            &self.profile_id,
            LibraryEventKind::PasswordRewrapped,
            None,
            None,
            now,
        )
        .await?;
        Ok(())
    }

    async fn apply_slot(
        &self,
        transaction: &mut Transaction<'_, Sqlite>,
        now: &str,
    ) -> Result<(), LibraryError> {
        let updated = sqlx::query(
            "UPDATE library_keyrings
             SET kdf_m = ?, kdf_t = ?, kdf_p = ?, kdf_salt = ?, wrap_nonce = ?, wrapped_ldk = ?,
                 generation = generation + 1, updated_at = ?
             WHERE profile_id = ? AND state = 'active' AND generation = ?",
        )
        .bind(i64::from(self.kdf.m_kib))
        .bind(i64::from(self.kdf.t))
        .bind(i64::from(self.kdf.p))
        .bind(&self.kdf_salt[..])
        .bind(&self.wrap_nonce[..])
        .bind(&self.wrapped_ldk)
        .bind(now)
        .bind(&self.profile_id)
        .bind(self.generation)
        .execute(&mut **transaction)
        .await?;
        if updated.rows_affected() != 1 {
            return Err(LibraryError::KeyringChanged);
        }
        Ok(())
    }
}

/// Відновлення кодом, підготовлене поза транзакцією: нова основна обгортка, новий
/// слот відновлення й ключі для сесії.
pub struct PreparedRecovery {
    password: PreparedRewrap,
    recovery: RecoverySlot,
    keys: LibraryKeys,
}

impl fmt::Debug for PreparedRecovery {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter
            .debug_struct("PreparedRecovery")
            .field("password", &self.password)
            .finish_non_exhaustive()
    }
}

impl PreparedRecovery {
    /// Записує обидва слоти в транзакції викликача (там само — новий хеш входу).
    pub async fn apply(
        &self,
        transaction: &mut Transaction<'_, Sqlite>,
        now: &str,
    ) -> Result<(), LibraryError> {
        let profile_id = &self.password.profile_id;
        let updated = sqlx::query(
            "UPDATE library_keyrings
             SET kdf_m = ?, kdf_t = ?, kdf_p = ?, kdf_salt = ?, wrap_nonce = ?, wrapped_ldk = ?,
                 recovery_salt = ?, recovery_nonce = ?, recovery_wrapped_ldk = ?,
                 generation = generation + 1, updated_at = ?
             WHERE profile_id = ? AND state = 'active' AND generation = ?",
        )
        .bind(i64::from(self.password.kdf.m_kib))
        .bind(i64::from(self.password.kdf.t))
        .bind(i64::from(self.password.kdf.p))
        .bind(&self.password.kdf_salt[..])
        .bind(&self.password.wrap_nonce[..])
        .bind(&self.password.wrapped_ldk)
        .bind(&self.recovery.salt[..])
        .bind(&self.recovery.nonce[..])
        .bind(&self.recovery.wrapped)
        .bind(now)
        .bind(profile_id)
        .bind(self.password.generation)
        .execute(&mut **transaction)
        .await?;
        if updated.rows_affected() != 1 {
            return Err(LibraryError::KeyringChanged);
        }
        insert_event(
            &mut **transaction,
            profile_id,
            LibraryEventKind::Recovered,
            None,
            None,
            now,
        )
        .await?;
        Ok(())
    }

    pub fn profile_id(&self) -> &str {
        &self.password.profile_id
    }

    /// Після коміту: ключі для сесії й новий код для показу.
    pub fn into_parts(self) -> (LibraryKeys, RecoveryCode) {
        (self.keys, self.recovery.code)
    }
}

/// Безпечне ім'я файлу в архіві: без каталогів і заборонених у Windows символів,
/// без повторів (без урахування регістру) — «Назва (2).docx».
fn archive_entry_name(name: &str, ext: &str, used: &mut HashSet<String>) -> String {
    let cleaned: String = name
        .chars()
        .map(|c| {
            if c.is_control() || matches!(c, '/' | '\\' | ':' | '*' | '?' | '"' | '<' | '>' | '|') {
                '_'
            } else {
                c
            }
        })
        .collect();
    let cleaned = cleaned.trim().trim_matches('.').trim();
    let base = if cleaned.is_empty() {
        "Документ"
    } else {
        cleaned
    };
    let ext = if ext.is_empty() { "bin" } else { ext };
    let mut candidate = format!("{base}.{ext}");
    let mut counter = 2;
    while !used.insert(candidate.to_lowercase()) {
        candidate = format!("{base} ({counter}).{ext}");
        counter += 1;
    }
    candidate
}

// ---------------------------------------------------------------------------
// Сесія
// ---------------------------------------------------------------------------

enum IndexState {
    Pending,
    Building,
    Ready(SearchIndex),
    Failed,
}

struct UnlockedLibrary {
    keys: Arc<LibraryKeys>,
    last_activity: Instant,
    index: IndexState,
    damaged: Vec<String>,
}

impl UnlockedLibrary {
    /// Закриває індекс; ключі затираються, щойно зникне останнє посилання на них
    /// (команда, що саме виконується, тримає своє до кінця).
    fn shutdown(self) {
        if let IndexState::Ready(index) = self.index {
            index.shutdown();
        }
    }
}

#[derive(Default)]
struct SessionState {
    /// Зростає з кожним розблокуванням і блокуванням: побудова індексу, почата
    /// до блокування, після нього вже нічого не встановить.
    epoch: u64,
    unlocked: Option<UnlockedLibrary>,
}

/// Стан індексу розблокованої бібліотеки.
#[derive(Clone, Debug, Default, Eq, PartialEq)]
pub struct IndexStatus {
    pub indexing: bool,
    pub ready: bool,
    pub damaged: Vec<String>,
}

/// Розблокована бібліотека в пам'яті (стан Tauri): щонайбільше одного профілю.
#[derive(Default)]
pub struct LibrarySession(Mutex<SessionState>);

impl LibrarySession {
    fn guard(&self) -> MutexGuard<'_, SessionState> {
        self.0
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
    }

    /// Встановлює ключі профілю (попередня бібліотека, якщо була, блокується).
    /// Повертає нову епоху.
    pub fn unlock(&self, keys: LibraryKeys) -> u64 {
        let (previous, epoch) = {
            let mut state = self.guard();
            state.epoch += 1;
            let previous = state.unlocked.replace(UnlockedLibrary {
                keys: Arc::new(keys),
                last_activity: Instant::now(),
                index: IndexState::Pending,
                damaged: Vec::new(),
            });
            (previous, state.epoch)
        };
        if let Some(previous) = previous {
            previous.shutdown();
        }
        epoch
    }

    /// Блокує бібліотеку: ключі й індекс знищуються. `true` — було що блокувати.
    pub fn lock(&self) -> bool {
        let previous = {
            let mut state = self.guard();
            state.epoch += 1;
            state.unlocked.take()
        };
        match previous {
            Some(previous) => {
                previous.shutdown();
                true
            }
            None => false,
        }
    }

    /// Блокує, якщо з останньої дії минуло щонайменше `timeout`.
    pub fn lock_if_idle(&self, timeout: Duration) -> bool {
        let idle = self
            .guard()
            .unlocked
            .as_ref()
            .is_some_and(|unlocked| unlocked.last_activity.elapsed() >= timeout);
        idle && self.lock()
    }

    /// Профіль розблокованої бібліотеки.
    pub fn unlocked_profile(&self) -> Option<String> {
        self.guard()
            .unlocked
            .as_ref()
            .map(|unlocked| unlocked.keys.profile_id().to_owned())
    }

    /// Ключі для команди профілю `profile_id`: спершу автоблокування за
    /// бездіяльністю, потім — заблоковано чи інший профіль → [`LibraryError::Locked`].
    /// Успіх оновлює час останньої дії.
    pub fn keys(&self, profile_id: &str) -> Result<Arc<LibraryKeys>, LibraryError> {
        self.lock_if_idle(IDLE_LOCK_TIMEOUT);
        let mut state = self.guard();
        match state.unlocked.as_mut() {
            Some(unlocked) if unlocked.keys.profile_id() == profile_id => {
                unlocked.last_activity = Instant::now();
                Ok(Arc::clone(&unlocked.keys))
            }
            _ => Err(LibraryError::Locked),
        }
    }

    /// Оновлює час останньої дії.
    pub fn touch(&self) {
        if let Some(unlocked) = self.guard().unlocked.as_mut() {
            unlocked.last_activity = Instant::now();
        }
    }

    /// Стан індексу, якщо бібліотеку `profile_id` розблоковано.
    pub fn index_status(&self, profile_id: &str) -> Option<IndexStatus> {
        let state = self.guard();
        let unlocked = state
            .unlocked
            .as_ref()
            .filter(|unlocked| unlocked.keys.profile_id() == profile_id)?;
        Some(IndexStatus {
            indexing: matches!(unlocked.index, IndexState::Pending | IndexState::Building),
            ready: matches!(unlocked.index, IndexState::Ready(_)),
            damaged: unlocked.damaged.clone(),
        })
    }

    /// Чи епоха досі чинна (бібліотеку не блокували й не розблоковували наново).
    pub fn is_current(&self, epoch: u64) -> bool {
        let state = self.guard();
        state.epoch == epoch && state.unlocked.is_some()
    }

    /// Починає побудову індексу: епоха й ключі, або `None`, якщо бібліотеку не
    /// розблоковано для цього профілю чи індекс уже будується або готовий.
    pub fn begin_index(&self, profile_id: &str) -> Option<(u64, Arc<LibraryKeys>)> {
        let mut state = self.guard();
        let epoch = state.epoch;
        let unlocked = state
            .unlocked
            .as_mut()
            .filter(|unlocked| unlocked.keys.profile_id() == profile_id)?;
        if !matches!(unlocked.index, IndexState::Pending | IndexState::Failed) {
            return None;
        }
        unlocked.index = IndexState::Building;
        Some((epoch, Arc::clone(&unlocked.keys)))
    }

    /// Встановлює готовий індекс, лише якщо епоха досі чинна; інакше закриває його.
    pub fn finish_index(&self, epoch: u64, index: SearchIndex, report: IndexReport) -> bool {
        let mut state = self.guard();
        if state.epoch == epoch {
            if let Some(unlocked) = state.unlocked.as_mut() {
                unlocked.index = IndexState::Ready(index);
                unlocked.damaged = report.damaged;
                return true;
            }
        }
        drop(state);
        index.shutdown();
        false
    }

    /// Позначає невдалу побудову (пошук лишається за назвами; можна повторити).
    pub fn fail_index(&self, epoch: u64) {
        let mut state = self.guard();
        if state.epoch == epoch {
            if let Some(unlocked) = state.unlocked.as_mut() {
                unlocked.index = IndexState::Failed;
            }
        }
    }

    /// Готовий індекс бібліотеки `profile_id` (дескриптор пулу) або `None`, поки він
    /// будується. Заблоковано чи інший профіль → [`LibraryError::Locked`].
    pub fn search_index(&self, profile_id: &str) -> Result<Option<SearchIndex>, LibraryError> {
        let state = self.guard();
        match state.unlocked.as_ref() {
            Some(unlocked) if unlocked.keys.profile_id() == profile_id => {
                Ok(match &unlocked.index {
                    IndexState::Ready(index) => Some(index.clone()),
                    _ => None,
                })
            }
            _ => Err(LibraryError::Locked),
        }
    }
}

// ---------------------------------------------------------------------------
// Тимчасовий індекс
// ---------------------------------------------------------------------------

/// Межі тексту в індексі.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct IndexLimits {
    /// Найбільше тексту одного документа, байт.
    pub per_document: usize,
    /// Найбільше тексту всього індексу, байт.
    pub total: usize,
}

impl IndexLimits {
    pub const DEFAULT: IndexLimits = IndexLimits {
        per_document: 1024 * 1024,
        total: 64 * 1024 * 1024,
    };
}

/// Що потрапило до індексу.
#[derive(Clone, Debug, Default, Eq, PartialEq)]
pub struct IndexReport {
    pub indexed: Vec<String>,
    /// Проіндексовано не повністю (ліміт тексту документа чи індексу).
    pub truncated: Vec<String>,
    /// Текст не прочитано (межі розбору, пошкоджений архів) — лише пошук за назвою.
    pub skipped: Vec<String>,
    /// Поточна версія не розшифровується.
    pub damaged: Vec<String>,
    pub total_bytes: usize,
}

struct IndexBuilder {
    limits: IndexLimits,
    report: IndexReport,
}

impl IndexBuilder {
    fn new(limits: IndexLimits) -> Self {
        Self {
            limits,
            report: IndexReport::default(),
        }
    }

    async fn add(
        &mut self,
        index: &SearchIndex,
        item_id: &str,
        extracted: &ExtractedText,
    ) -> Result<(), LibraryError> {
        let remaining = self.limits.total.saturating_sub(self.report.total_bytes);
        let allowed = self.limits.per_document.min(remaining);
        let text = truncate_at_char_boundary(&extracted.text, allowed);
        if text.len() < extracted.text.len() || extracted.truncated {
            self.report.truncated.push(item_id.to_owned());
        }
        if text.is_empty() {
            if extracted.text.is_empty() {
                self.report.indexed.push(item_id.to_owned());
            }
            return Ok(());
        }
        index.add(item_id, text).await?;
        self.report.total_bytes += text.len();
        self.report.indexed.push(item_id.to_owned());
        Ok(())
    }
}

fn truncate_at_char_boundary(text: &str, max: usize) -> &str {
    if text.len() <= max {
        return text;
    }
    let mut end = max;
    while !text.is_char_boundary(end) {
        end -= 1;
    }
    &text[..end]
}

/// Вміст, знайдений у тексті документа.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ContentHit {
    pub item_id: String,
    pub snippet: Option<String>,
}

/// Окрема база `sqlite::memory:` з FTS5. Живе лише в пам'яті процесу й зникає,
/// щойно закривається її пул (блокування бібліотеки).
#[derive(Clone)]
pub struct SearchIndex {
    pool: SqlitePool,
}

impl SearchIndex {
    pub async fn open() -> Result<Self, LibraryError> {
        let options =
            SqliteConnectOptions::from_str("sqlite::memory:")?.pragma("temp_store", "MEMORY");
        // Одне з'єднання без тайм-аутів простою: закрите з'єднання забрало б з
        // собою базу в пам'яті.
        let pool = SqlitePoolOptions::new()
            .max_connections(1)
            .min_connections(1)
            .idle_timeout(None)
            .max_lifetime(None)
            .connect_with(options)
            .await?;
        sqlx::query(
            "CREATE VIRTUAL TABLE library_text USING fts5(
                item_id UNINDEXED,
                body,
                tokenize = 'unicode61 remove_diacritics 2'
            )",
        )
        .execute(&pool)
        .await?;
        Ok(Self { pool })
    }

    /// Індекс із готових пар (документ, текст) з межами — для тестів і простих
    /// випадків без бази бібліотеки.
    pub async fn build(
        entries: &[(String, ExtractedText)],
        limits: IndexLimits,
    ) -> Result<(Self, IndexReport), LibraryError> {
        let index = Self::open().await?;
        let mut builder = IndexBuilder::new(limits);
        for (item_id, extracted) in entries {
            builder.add(&index, item_id, extracted).await?;
        }
        Ok((index, builder.report))
    }

    async fn add(&self, item_id: &str, text: &str) -> Result<(), LibraryError> {
        sqlx::query("INSERT INTO library_text (item_id, body) VALUES (?, ?)")
            .bind(item_id)
            .bind(text)
            .execute(&self.pool)
            .await?;
        Ok(())
    }

    /// Пошук за всіма словами запиту (кожне — префікс). Порожній запит — порожньо.
    pub async fn search(&self, query: &str, limit: usize) -> Result<Vec<ContentHit>, LibraryError> {
        let Some(expression) = fts_query(query) else {
            return Ok(Vec::new());
        };
        let rows: Vec<(String, Option<String>)> = sqlx::query_as(
            "SELECT item_id, snippet(library_text, 1, '', '', '…', 12)
             FROM library_text WHERE library_text MATCH ? ORDER BY rank LIMIT ?",
        )
        .bind(expression)
        .bind(i64::try_from(limit).unwrap_or(i64::MAX))
        .fetch_all(&self.pool)
        .await?;
        Ok(rows
            .into_iter()
            .map(|(item_id, snippet)| ContentHit {
                item_id,
                snippet: snippet.filter(|text| !text.trim().is_empty()),
            })
            .collect())
    }

    /// Закриває пул без очікування: `close()` позначає пул закритим одразу (нові
    /// запити відмовляють), а з'єднання — і з ним база в пам'яті — закривається,
    /// щойно зникає останній дескриптор пулу.
    fn shutdown(self) {
        let _closing = self.pool.close();
    }

    /// Закриває пул і чекає закриття з'єднання.
    pub async fn close(self) {
        self.pool.close().await;
    }

    #[cfg(test)]
    fn pool_handle(&self) -> SqlitePool {
        self.pool.clone()
    }
}

/// Безпечний вираз FTS5: кожне слово в лапках (лапки всередині подвоєно) з `*` —
/// жоден символ запиту не стає оператором FTS.
pub fn fts_query(input: &str) -> Option<String> {
    let terms: Vec<String> = input
        .split_whitespace()
        .filter(|token| token.chars().any(char::is_alphanumeric))
        .take(MAX_QUERY_TOKENS)
        .map(|token| format!("\"{}\"*", token.replace('"', "\"\"")))
        .collect();
    (!terms.is_empty()).then(|| terms.join(" "))
}

/// Пошук за назвою в пам'яті: кожне слово запиту входить у назву (без регістру).
pub fn name_matches(name: &str, query: &str) -> bool {
    let name = name.to_lowercase();
    let mut tokens = query.split_whitespace().peekable();
    tokens.peek().is_some() && tokens.all(|token| name.contains(&token.to_lowercase()))
}

/// Збіги за назвою (за порядком переліку) і далі збіги лише за вмістом (за рангом).
fn combine_hits(items: &[LibraryItem], query: &str, content: Vec<ContentHit>) -> Vec<SearchHit> {
    let mut results: Vec<SearchHit> = items
        .iter()
        .filter(|item| name_matches(&item.name, query))
        .map(|item| SearchHit {
            item_id: item.id.clone(),
            name: item.name.clone(),
            snippet: None,
            by_name: true,
        })
        .collect();
    for hit in content {
        if let Some(existing) = results
            .iter_mut()
            .find(|result| result.item_id == hit.item_id)
        {
            if existing.snippet.is_none() {
                existing.snippet = hit.snippet;
            }
            continue;
        }
        // Лише документи з переліку: прихований документ не з'являється через вміст.
        if let Some(item) = items.iter().find(|item| item.id == hit.item_id) {
            results.push(SearchHit {
                item_id: item.id.clone(),
                name: item.name.clone(),
                snippet: hit.snippet,
                by_name: false,
            });
        }
    }
    results.truncate(SEARCH_RESULTS);
    results
}

// ---------------------------------------------------------------------------
// Витяг тексту
// ---------------------------------------------------------------------------

/// Межі розбору одного документа.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct ExtractLimits {
    /// Найбільше записів в архіві.
    pub max_entries: usize,
    /// Найбільше розпакованого XML на документ, байт (міряються реальні байти).
    pub max_xml_bytes: u64,
    /// Найбільше витягнутого тексту, байт (далі текст обрізається).
    pub max_text_bytes: usize,
    /// Ліміт часу на документ.
    pub time_limit: Duration,
}

impl ExtractLimits {
    pub const DEFAULT: ExtractLimits = ExtractLimits {
        max_entries: 2000,
        max_xml_bytes: 32 * 1024 * 1024,
        max_text_bytes: 1024 * 1024,
        time_limit: Duration::from_secs(10),
    };
}

/// Витягнутий текст документа.
pub struct ExtractedText {
    pub text: Zeroizing<String>,
    /// Текст обрізано лімітом.
    pub truncated: bool,
}

impl fmt::Debug for ExtractedText {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter
            .debug_struct("ExtractedText")
            .field("bytes", &self.text.len())
            .field("truncated", &self.truncated)
            .finish()
    }
}

struct TextSink {
    text: Zeroizing<String>,
    max: usize,
    truncated: bool,
}

impl TextSink {
    fn new(max: usize) -> Self {
        Self {
            text: Zeroizing::new(String::new()),
            max,
            truncated: false,
        }
    }

    fn push_str(&mut self, value: &str) {
        if self.truncated {
            return;
        }
        let room = self.max - self.text.len();
        if value.len() > room {
            self.text.push_str(truncate_at_char_boundary(value, room));
            self.truncated = true;
        } else {
            self.text.push_str(value);
        }
    }

    fn push_char(&mut self, value: char) {
        let mut buffer = [0u8; 4];
        self.push_str(value.encode_utf8(&mut buffer));
    }

    fn finish(self) -> ExtractedText {
        ExtractedText {
            text: self.text,
            truncated: self.truncated,
        }
    }
}

fn limit_error(detail: impl Into<String>) -> LibraryError {
    LibraryError::ExtractionLimit(detail.into())
}

fn check_deadline(deadline: Instant) -> Result<(), LibraryError> {
    if Instant::now() >= deadline {
        Err(limit_error("розбір триває задовго"))
    } else {
        Ok(())
    }
}

/// Текст документа з межами за замовчуванням.
pub fn extract_text(ext: &str, bytes: &[u8]) -> Result<ExtractedText, LibraryError> {
    extract_text_with(ext, bytes, ExtractLimits::DEFAULT)
}

/// Текст документа: DOCX (`word/document.xml`, колонтитули), PPTX (слайди), XLSX
/// (calamine після перевірки архіву), CSV/TXT (UTF-8 із заміною хибних байтів).
pub fn extract_text_with(
    ext: &str,
    bytes: &[u8],
    limits: ExtractLimits,
) -> Result<ExtractedText, LibraryError> {
    let deadline = Instant::now() + limits.time_limit;
    match normalize_ext(ext)? {
        "txt" | "csv" => {
            let mut sink = TextSink::new(limits.max_text_bytes);
            let bytes = bytes.strip_prefix(b"\xEF\xBB\xBF").unwrap_or(bytes);
            let text = Zeroizing::new(String::from_utf8_lossy(bytes).into_owned());
            sink.push_str(&text);
            Ok(sink.finish())
        }
        "docx" => office_xml_text(bytes, limits, deadline, docx_part_order),
        "pptx" => office_xml_text(bytes, limits, deadline, pptx_part_order),
        _ => xlsx_text(bytes, limits, deadline),
    }
}

/// Перевірка структури ZIP до `ZipArchive::new`: кількість заголовків центрального
/// каталогу обмежує, скільки записів zip-бібліотека взагалі може розібрати, а
/// архіви zip64 (з покажчиком zip64 перед кінцем каталогу) відхиляються — для
/// документів до 256 МБ вони не потрібні, а кількість записів zip64 не обмежена.
fn precheck_zip(bytes: &[u8], max_entries: usize) -> Result<(), LibraryError> {
    const CENTRAL_HEADER: &[u8; 4] = b"PK\x01\x02";
    const END_OF_DIRECTORY: &[u8; 4] = b"PK\x05\x06";
    const ZIP64_LOCATOR: &[u8; 4] = b"PK\x06\x07";
    let mut headers = 0usize;
    let mut has_end = false;
    let mut position = 0usize;
    while position + 4 <= bytes.len() {
        let Some(offset) = bytes[position..bytes.len() - 3]
            .iter()
            .position(|&byte| byte == b'P')
        else {
            break;
        };
        position += offset;
        let window = &bytes[position..position + 4];
        if window == CENTRAL_HEADER {
            headers += 1;
            if headers > max_entries {
                return Err(limit_error(format!("в архіві понад {max_entries} записів")));
            }
        } else if window == END_OF_DIRECTORY && position + 22 <= bytes.len() {
            has_end = true;
            let field =
                |at: usize| u16::from_le_bytes([bytes[position + at], bytes[position + at + 1]]);
            let field32 = |at: usize| {
                u32::from_le_bytes([
                    bytes[position + at],
                    bytes[position + at + 1],
                    bytes[position + at + 2],
                    bytes[position + at + 3],
                ])
            };
            let may_be_zip64 = [4, 6, 8, 10].into_iter().any(|at| field(at) == u16::MAX)
                || field32(12) == u32::MAX
                || field32(16) == u32::MAX;
            if may_be_zip64
                && position >= 20
                && &bytes[position - 20..position - 16] == ZIP64_LOCATOR
            {
                return Err(limit_error("архів zip64 не підтримується"));
            }
        }
        position += 1;
    }
    if has_end {
        Ok(())
    } else {
        Err(LibraryError::Extraction("файл не є архівом Office"))
    }
}

fn open_archive(
    bytes: &[u8],
    limits: ExtractLimits,
) -> Result<zip::ZipArchive<Cursor<&[u8]>>, LibraryError> {
    precheck_zip(bytes, limits.max_entries)?;
    let archive = zip::ZipArchive::new(Cursor::new(bytes))
        .map_err(|_| LibraryError::Extraction("архів документа пошкоджено"))?;
    if archive.len() > limits.max_entries {
        return Err(limit_error(format!(
            "в архіві понад {} записів",
            limits.max_entries
        )));
    }
    Ok(archive)
}

fn read_limited(
    budget: &mut ZipBudget,
    name: &str,
    reader: impl std::io::Read,
    keep: Option<&mut Vec<u8>>,
) -> Result<(), LibraryError> {
    match budget.read_part(name, reader, keep) {
        Ok(_) => Ok(()),
        Err(ZipPartError::Limit(exceeded)) => Err(limit_error(exceeded.to_string())),
        Err(ZipPartError::Io(_)) => Err(LibraryError::Extraction("архів документа пошкоджено")),
    }
}

fn numbered_part(name: &str, prefix: &str) -> Option<u32> {
    name.strip_prefix(prefix)?
        .strip_suffix(".xml")?
        .parse()
        .ok()
}

/// Частини DOCX: спершу текст документа, далі верхні й нижні колонтитули.
fn docx_part_order(name: &str) -> Option<(u8, u32)> {
    if name == "word/document.xml" {
        return Some((0, 0));
    }
    if let Some(number) = numbered_part(name, "word/header") {
        return Some((1, number));
    }
    numbered_part(name, "word/footer").map(|number| (2, number))
}

/// Частини PPTX: слайди за номером.
fn pptx_part_order(name: &str) -> Option<(u8, u32)> {
    numbered_part(name, "ppt/slides/slide").map(|number| (0, number))
}

fn office_xml_text(
    bytes: &[u8],
    limits: ExtractLimits,
    deadline: Instant,
    order: fn(&str) -> Option<(u8, u32)>,
) -> Result<ExtractedText, LibraryError> {
    let mut archive = open_archive(bytes, limits)?;
    let mut parts: Vec<((u8, u32), String)> = archive
        .file_names()
        .filter_map(|name| order(name).map(|key| (key, name.to_owned())))
        .collect();
    parts.sort();
    let mut budget = ZipBudget::new(ZipLimits {
        per_entry: limits.max_xml_bytes,
        total: limits.max_xml_bytes,
    });
    let mut sink = TextSink::new(limits.max_text_bytes);
    for (_, name) in parts {
        check_deadline(deadline)?;
        let mut xml = Zeroizing::new(Vec::new());
        {
            let file = archive
                .by_name(&name)
                .map_err(|_| LibraryError::Extraction("архів документа пошкоджено"))?;
            read_limited(&mut budget, &name, file, Some(&mut xml))?;
        }
        collect_xml_text(&xml, &mut sink, deadline)?;
        if sink.truncated {
            break;
        }
    }
    Ok(sink.finish())
}

/// Текст елементів `*:t` (WordprocessingML і DrawingML); кінець абзацу `*:p` —
/// новий рядок, `*:tab` — табуляція, `*:br` — новий рядок.
fn collect_xml_text(
    xml: &[u8],
    sink: &mut TextSink,
    deadline: Instant,
) -> Result<(), LibraryError> {
    let mut reader = quick_xml::Reader::from_reader(xml);
    let mut inside_text = 0usize;
    let mut events = 0u32;
    loop {
        events = events.wrapping_add(1);
        if events.is_multiple_of(4096) {
            check_deadline(deadline)?;
        }
        match reader.read_event() {
            Ok(Event::Start(element)) => {
                if element.local_name().as_ref() == b"t" {
                    inside_text += 1;
                }
            }
            Ok(Event::End(element)) => match element.local_name().as_ref() {
                b"t" => inside_text = inside_text.saturating_sub(1),
                b"p" => sink.push_char('\n'),
                _ => {}
            },
            Ok(Event::Empty(element)) => match element.local_name().as_ref() {
                b"tab" => sink.push_char('\t'),
                b"br" | b"cr" => sink.push_char('\n'),
                _ => {}
            },
            Ok(Event::Text(text)) if inside_text > 0 => {
                let value = text
                    .unescape()
                    .map_err(|_| LibraryError::Extraction("XML документа пошкоджено"))?;
                sink.push_str(&value);
            }
            Ok(Event::CData(data)) if inside_text > 0 => {
                sink.push_str(&String::from_utf8_lossy(&data));
            }
            Ok(Event::Eof) => break,
            Err(_) => return Err(LibraryError::Extraction("XML документа пошкоджено")),
            Ok(_) => {}
        }
        if sink.truncated {
            break;
        }
    }
    Ok(())
}

fn xlsx_text(
    bytes: &[u8],
    limits: ExtractLimits,
    deadline: Instant,
) -> Result<ExtractedText, LibraryError> {
    // calamine розпаковує частини без власних меж, тож спершу всі XML-частини
    // розпаковуються «в нікуди» з реальним підрахунком байтів.
    {
        let mut archive = open_archive(bytes, limits)?;
        let mut budget = ZipBudget::new(ZipLimits {
            per_entry: limits.max_xml_bytes,
            total: limits.max_xml_bytes,
        });
        for index in 0..archive.len() {
            check_deadline(deadline)?;
            let file = archive
                .by_index(index)
                .map_err(|_| LibraryError::Extraction("архів документа пошкоджено"))?;
            let name = file.name().to_owned();
            if file.is_dir() || !(name.ends_with(".xml") || name.ends_with(".rels")) {
                continue;
            }
            read_limited(&mut budget, &name, file, None)?;
        }
    }
    let mut workbook = Xlsx::new(Cursor::new(bytes))
        .map_err(|_| LibraryError::Extraction("книгу XLSX пошкоджено"))?;
    let mut sink = TextSink::new(limits.max_text_bytes);
    for sheet in workbook.sheet_names() {
        check_deadline(deadline)?;
        let range = workbook
            .worksheet_range(&sheet)
            .map_err(|_| LibraryError::Extraction("аркуш XLSX пошкоджено"))?;
        sink.push_str(&sheet);
        sink.push_char('\n');
        for row in range.rows() {
            let mut first = true;
            for cell in row {
                if matches!(cell, Data::Empty) {
                    continue;
                }
                if !first {
                    sink.push_char('\t');
                }
                first = false;
                sink.push_str(&cell.to_string());
            }
            sink.push_char('\n');
            if sink.truncated {
                return Ok(sink.finish());
            }
        }
    }
    Ok(sink.finish())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::database::{create_migrated_database, embedded_migrator};
    use serde_json::json;
    use std::io::Read;

    const NOW: &str = "2026-10-20T08:00:00Z";
    const LATER: &str = "2026-10-20T09:00:00Z";
    const PROFILE: &str = "profile-0123456789abcdef01234567";
    const OTHER: &str = "profile-fedcba9876543210fedcba98";
    const NO_PASSWORD: &str = "profile-00000000000000000000aaaa";
    const PASSWORD: &str = "синтетичний пароль 1";
    const NEW_PASSWORD: &str = "синтетичний пароль 2";
    const HASH: &str = "$argon2id$v=19$m=8,t=1,p=1$c3ludGhldGljc2FsdA$c3ludGhldGljaGFzaA";
    const NEW_HASH: &str = "$argon2id$v=19$m=8,t=1,p=1$bmV3c3ludGhldGlj$bmV3c3ludGhldGljaGFzaA";
    const MISSING_ITEM: &str = "doc-000000000000000000000000";
    const MISSING_VERSION: &str = "ver-000000000000000000000000";

    async fn memory_pool() -> SqlitePool {
        let pool = SqlitePoolOptions::new()
            .max_connections(1)
            .connect("sqlite::memory:")
            .await
            .expect("синтетична база в пам'яті має відкритися");
        embedded_migrator()
            .run(&pool)
            .await
            .expect("міграції мають застосуватися");
        pool
    }

    async fn add_profile(pool: &SqlitePool, id: &str, name: &str, password_hash: Option<&str>) {
        sqlx::query(
            "INSERT INTO local_profiles (id, display_name, name_key, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?)",
        )
        .bind(id)
        .bind(name)
        .bind(name.to_lowercase())
        .bind(NOW)
        .bind(NOW)
        .execute(pool)
        .await
        .unwrap();
        sqlx::query(
            "INSERT INTO local_profile_details (profile_id, password_hash, updated_at)
             VALUES (?, ?, ?)",
        )
        .bind(id)
        .bind(password_hash)
        .bind(NOW)
        .execute(pool)
        .await
        .unwrap();
    }

    /// Сховище в пам'яті з профілем `PROFILE` (з паролем) і створеною бібліотекою.
    async fn library(with_recovery: bool) -> (LibraryStore, CreatedLibrary) {
        let pool = memory_pool().await;
        add_profile(&pool, PROFILE, "Синтетичний", Some(HASH)).await;
        let store = LibraryStore::with_kdf(pool, KdfParams::FOR_TESTS);
        let created = store
            .create(PROFILE, PASSWORD, with_recovery, NOW)
            .await
            .unwrap();
        (store, created)
    }

    fn text_document<'a>(name: &'a str, bytes: &'a [u8]) -> NewDocument<'a> {
        NewDocument {
            name,
            ext: "txt",
            as_template: false,
            profile_table_copy: false,
            bytes,
        }
    }

    fn office_document<'a>(name: &'a str, ext: &'a str, bytes: &'a [u8]) -> NewDocument<'a> {
        NewDocument {
            ext,
            ..text_document(name, bytes)
        }
    }

    fn edit<'a>(bytes: &'a [u8], parent: Option<&'a str>) -> NewVersion<'a> {
        NewVersion {
            ext: "txt",
            bytes,
            origin: Origin::Edited,
            parent_version_id: parent,
            source_fingerprint: None,
            make_current: true,
        }
    }

    async fn event_names(store: &LibraryStore, profile_id: &str) -> Vec<String> {
        store
            .events(profile_id)
            .await
            .unwrap()
            .into_iter()
            .map(|event| event.event)
            .collect()
    }

    async fn login_hash(pool: &SqlitePool) -> String {
        sqlx::query_scalar("SELECT password_hash FROM local_profile_details WHERE profile_id = ?")
            .bind(PROFILE)
            .fetch_one(pool)
            .await
            .unwrap()
    }

    async fn set_login_hash(transaction: &mut Transaction<'_, Sqlite>, hash: &str) {
        sqlx::query("UPDATE local_profile_details SET password_hash = ? WHERE profile_id = ?")
            .bind(hash)
            .bind(PROFILE)
            .execute(&mut **transaction)
            .await
            .unwrap();
    }

    fn zip_parts(parts: &[(&str, &[u8])]) -> Vec<u8> {
        let mut writer = zip::ZipWriter::new(Cursor::new(Vec::new()));
        let options = zip::write::SimpleFileOptions::default()
            .compression_method(zip::CompressionMethod::Deflated);
        for (name, bytes) in parts {
            writer.start_file(*name, options).unwrap();
            writer.write_all(bytes).unwrap();
        }
        writer.finish().unwrap().into_inner()
    }

    fn docx(paragraphs: &[&str]) -> Vec<u8> {
        let body: String = paragraphs
            .iter()
            .map(|text| format!("<w:p><w:r><w:t>{text}</w:t></w:r></w:p>"))
            .collect();
        let xml = format!(
            r#"<?xml version="1.0" encoding="UTF-8"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>{body}</w:body></w:document>"#
        );
        zip_parts(&[
            ("[Content_Types].xml", b"<Types/>"),
            ("word/document.xml", xml.as_bytes()),
        ])
    }

    fn slide_xml(text: &str) -> String {
        format!(
            r#"<?xml version="1.0" encoding="UTF-8"?><p:sld xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><p:cSld><p:spTree><p:sp><p:txBody><a:p><a:r><a:t>{text}</a:t></a:r></a:p></p:txBody></p:sp></p:spTree></p:cSld></p:sld>"#
        )
    }

    fn pptx(slides: &[(u32, &str)]) -> Vec<u8> {
        let parts: Vec<(String, String)> = slides
            .iter()
            .map(|(number, text)| (format!("ppt/slides/slide{number}.xml"), slide_xml(text)))
            .collect();
        let borrowed: Vec<(&str, &[u8])> = parts
            .iter()
            .map(|(name, xml)| (name.as_str(), xml.as_bytes()))
            .collect();
        zip_parts(&borrowed)
    }

    /// Книга з одним аркушем і готовим XML рядків (`<row>…</row>`).
    fn xlsx(sheet_name: &str, rows: &str) -> Vec<u8> {
        let workbook = format!(
            r#"<?xml version="1.0" encoding="UTF-8"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="{sheet_name}" sheetId="1" r:id="rId1"/></sheets></workbook>"#
        );
        let sheet = format!(
            r#"<?xml version="1.0" encoding="UTF-8"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>{rows}</sheetData></worksheet>"#
        );
        zip_parts(&[
            (
                "[Content_Types].xml",
                br#"<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>"#,
            ),
            (
                "_rels/.rels",
                br#"<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>"#,
            ),
            ("xl/workbook.xml", workbook.as_bytes()),
            (
                "xl/_rels/workbook.xml.rels",
                br#"<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>"#,
            ),
            ("xl/worksheets/sheet1.xml", sheet.as_bytes()),
        ])
    }

    fn extracted(text: &str) -> ExtractedText {
        ExtractedText {
            text: Zeroizing::new(text.to_owned()),
            truncated: false,
        }
    }

    fn contains(haystack: &[u8], needle: &[u8]) -> bool {
        haystack
            .windows(needle.len())
            .any(|window| window == needle)
    }

    /// Усі файли каталогу бази (сама база й журнали, якщо лишилися).
    fn directory_bytes(directory: &std::path::Path) -> Vec<u8> {
        let mut all = Vec::new();
        for entry in std::fs::read_dir(directory).unwrap() {
            let path = entry.unwrap().path();
            if path.is_file() {
                all.extend(std::fs::read(path).unwrap());
            }
        }
        all
    }

    // --- Ключі -------------------------------------------------------------

    #[tokio::test]
    async fn create_unlock_and_reject_wrong_passwords() {
        let (store, created) = library(true).await;
        assert!(created.recovery_code.is_some());
        assert_eq!(
            store.keyring_status(PROFILE).await.unwrap(),
            KeyringStatus::Active {
                has_recovery: true,
                generation: 1
            }
        );
        // Параметри KDF лежать в обгортці; тести беруть мінімальні.
        let stored: (i64, i64, i64, String, String) = sqlx::query_as(
            "SELECT kdf_m, kdf_t, kdf_p, kdf, wrap_alg FROM library_keyrings WHERE profile_id = ?",
        )
        .bind(PROFILE)
        .fetch_one(&store.pool)
        .await
        .unwrap();
        assert_eq!(
            stored,
            (
                8,
                1,
                1,
                "argon2id".to_owned(),
                "xchacha20poly1305".to_owned()
            )
        );
        assert_eq!(
            KdfParams::PRODUCTION,
            KdfParams {
                m_kib: 65536,
                t: 3,
                p: 1
            }
        );

        let unlocked = store.unlock(PROFILE, PASSWORD, LATER).await.unwrap();
        assert_eq!(unlocked.profile_id(), PROFILE);
        assert_eq!(
            unlocked.content_id(b"synthetic"),
            created.keys.content_id(b"synthetic")
        );
        assert!(matches!(
            store.unlock(PROFILE, "інший пароль", LATER).await,
            Err(LibraryError::WrongPassword)
        ));
        assert!(matches!(
            store.create(PROFILE, PASSWORD, false, LATER).await,
            Err(LibraryError::AlreadyExists)
        ));

        add_profile(&store.pool, NO_PASSWORD, "Без пароля", None).await;
        assert!(matches!(
            store.create(NO_PASSWORD, PASSWORD, false, NOW).await,
            Err(LibraryError::ProfileWithoutPassword)
        ));
        assert!(matches!(
            store.create(OTHER, PASSWORD, false, NOW).await,
            Err(LibraryError::ProfileNotFound)
        ));
        assert!(matches!(
            store.create("profile-не-той", PASSWORD, false, NOW).await,
            Err(LibraryError::ProfileNotFound)
        ));
        add_profile(&store.pool, OTHER, "Другий", Some(HASH)).await;
        assert_eq!(
            store.keyring_status(OTHER).await.unwrap(),
            KeyringStatus::Missing
        );
        assert!(!store.has_active_keyring(OTHER).await.unwrap());
        assert!(store.has_active_keyring(PROFILE).await.unwrap());
        assert!(matches!(
            store.unlock(OTHER, PASSWORD, NOW).await,
            Err(LibraryError::NotCreated)
        ));

        assert_eq!(event_names(&store, PROFILE).await, ["created", "unlocked"]);
        // Налагоджувальний вивід не розкриває ні ключів, ні коду.
        let debug = format!("{created:?}");
        assert!(!debug.contains(created.recovery_code.as_ref().unwrap().as_str()));
        assert!(debug.contains("RecoveryCode(..)"));
    }

    #[tokio::test]
    async fn status_follows_profile_keyring_and_session() {
        let pool = memory_pool().await;
        add_profile(&pool, PROFILE, "Синтетичний", Some(HASH)).await;
        add_profile(&pool, NO_PASSWORD, "Без пароля", None).await;
        let store = LibraryStore::with_kdf(pool, KdfParams::FOR_TESTS);
        let session = LibrarySession::default();
        assert_eq!(
            store.status(None, &session).await.unwrap().state,
            LibraryState::NoProfile
        );
        assert_eq!(
            store.status(Some(OTHER), &session).await.unwrap().state,
            LibraryState::NoProfile
        );
        assert_eq!(
            store
                .status(Some(NO_PASSWORD), &session)
                .await
                .unwrap()
                .state,
            LibraryState::NoPassword
        );
        let missing = store.status(Some(PROFILE), &session).await.unwrap();
        assert_eq!(missing.state, LibraryState::Missing);
        assert_eq!(serde_json::to_value(&missing).unwrap()["state"], "none");

        let created = store.create(PROFILE, PASSWORD, false, NOW).await.unwrap();
        let locked = store.status(Some(PROFILE), &session).await.unwrap();
        assert_eq!(
            (locked.state, locked.has_recovery),
            (LibraryState::Locked, false)
        );
        session.unlock(created.keys);
        let unlocked = store.status(Some(PROFILE), &session).await.unwrap();
        assert_eq!(unlocked.state, LibraryState::Unlocked);
        assert!(unlocked.indexing && !unlocked.index_ready);
        let json = serde_json::to_value(&unlocked).unwrap();
        assert_eq!(json["state"], "unlocked");
        assert_eq!(json["profileId"], PROFILE);
        assert_eq!(json["idleLockMinutes"], 30);
        assert_eq!(json["indexReady"], false);
        session.lock();
        assert_eq!(
            store.status(Some(PROFILE), &session).await.unwrap().state,
            LibraryState::Locked
        );
    }

    #[test]
    fn ciphertext_is_bound_to_profile_content_and_name() {
        let ldk = [7u8; KEY_LEN];
        let keys = LibraryKeys::derive(PROFILE, &ldk);
        let content_id = keys.content_id(b"synthetic");
        assert_eq!(content_id.len(), 64);
        assert!(is_lower_hex(&content_id));
        let data = keys.encrypt_blob(&content_id, b"synthetic").unwrap();
        assert_eq!(&data[..5], b"EWLB\x01");
        assert_eq!(data.len(), b"synthetic".len() + 45);
        assert_eq!(
            keys.decrypt_blob(&content_id, &data).unwrap().as_slice(),
            b"synthetic"
        );
        // Інший content_id (AAD і перевірка HMAC), підмінений байт, інший профіль
        // з тим самим LDK, інша бібліотека — не розшифрують.
        let other_id = keys.content_id(b"other");
        assert!(matches!(
            keys.decrypt_blob(&other_id, &data),
            Err(LibraryError::Damaged)
        ));
        let mut tampered = data.clone();
        *tampered.last_mut().unwrap() ^= 1;
        assert!(matches!(
            keys.decrypt_blob(&content_id, &tampered),
            Err(LibraryError::Damaged)
        ));
        let moved = LibraryKeys::derive(OTHER, &ldk);
        assert!(moved.decrypt_blob(&content_id, &data).is_err());
        let stranger = LibraryKeys::derive(PROFILE, &random_key());
        assert!(stranger.decrypt_blob(&content_id, &data).is_err());
        assert_ne!(stranger.content_id(b"synthetic"), content_id);
        // Однакові байти — щоразу інший шифротекст (новий nonce).
        assert_ne!(keys.encrypt_blob(&content_id, b"synthetic").unwrap(), data);

        let item_id = "doc-0000000000000000000000a1";
        let name = keys.encrypt_name(item_id, "Назва").unwrap();
        assert_eq!(keys.decrypt_name(item_id, &name).unwrap().as_str(), "Назва");
        assert!(keys
            .decrypt_name("doc-0000000000000000000000a2", &name)
            .is_err());
        assert!(moved.decrypt_name(item_id, &name).is_err());

        // Обгортку не перенести в інший профіль чи слот: AAD містить обидва.
        let kek = [9u8; KEY_LEN];
        let (nonce, wrapped) = wrap_ldk(&kek, &ldk, &keyring_aad(PROFILE, Slot::Password)).unwrap();
        assert_eq!(wrapped.len(), 48);
        assert_eq!(
            *unwrap_ldk(
                &kek,
                &nonce,
                &wrapped,
                &keyring_aad(PROFILE, Slot::Password)
            )
            .unwrap(),
            ldk
        );
        assert!(unwrap_ldk(&kek, &nonce, &wrapped, &keyring_aad(OTHER, Slot::Password)).is_none());
        assert!(unwrap_ldk(
            &kek,
            &nonce,
            &wrapped,
            &keyring_aad(PROFILE, Slot::Recovery)
        )
        .is_none());

        // Підключі різні між собою.
        assert_ne!(keys.content_id(b"x"), keys.fingerprint(b"x"));
        assert_eq!(
            format!("{keys:?}"),
            format!("LibraryKeys {{ profile_id: {PROFILE:?}, .. }}")
        );

        let first = random_id("doc");
        let second = random_id("ver");
        assert_eq!((first.len(), second.len()), (28, 28));
        assert!(first.starts_with("doc-") && is_lower_hex(&first[4..]));
        assert!(second.starts_with("ver-") && is_lower_hex(&second[4..]));
        assert_ne!(random_id("doc"), first);
    }

    #[tokio::test]
    async fn fingerprints_are_stable_per_library_and_ignore_key_order() {
        let (store, created) = library(false).await;
        let unlocked = store.unlock(PROFILE, PASSWORD, NOW).await.unwrap();
        let first = json!({
            "to": "2026-10-07",
            "from": "2026-10-01",
            "modules": [{"id": "m2", "branch": "air"}]
        });
        let second = json!({
            "modules": [{"branch": "air", "id": "m2"}],
            "from": "2026-10-01",
            "to": "2026-10-07"
        });
        assert_eq!(
            canonical_json(&first),
            br#"{"from":"2026-10-01","modules":[{"branch":"air","id":"m2"}],"to":"2026-10-07"}"#
        );
        assert_eq!(
            source_fingerprint(&created.keys, &first),
            source_fingerprint(&unlocked, &second)
        );
        let value = fingerprint(&created.keys, b"bytes");
        assert_eq!(value, fingerprint(&unlocked, b"bytes"));
        assert_eq!(value.len(), 64);
        assert!(is_lower_hex(&value));
        assert_ne!(value, fingerprint(&created.keys, b"bytes!"));
        assert_ne!(value, created.keys.content_id(b"bytes"));

        add_profile(&store.pool, OTHER, "Другий", Some(HASH)).await;
        let other = store
            .create(OTHER, PASSWORD, false, NOW)
            .await
            .unwrap()
            .keys;
        assert_ne!(fingerprint(&other, b"bytes"), value);
    }

    // --- Код відновлення ---------------------------------------------------

    fn code_for(secret: &[u8; KEY_LEN]) -> String {
        let mut raw = secret.to_vec();
        raw.extend_from_slice(&Sha256::digest(secret)[..2]);
        let encoded = base32_encode(&raw);
        encoded
            .as_bytes()
            .chunks(RECOVERY_GROUP)
            .map(|group| std::str::from_utf8(group).unwrap())
            .collect::<Vec<_>>()
            .join("-")
    }

    #[test]
    fn recovery_codes_round_trip_and_reject_typos() {
        let (code, secret) = generate_recovery_code();
        let text = code.as_str();
        assert_eq!(text.len(), 65);
        let groups: Vec<&str> = text.split('-').collect();
        assert_eq!(groups.len(), 11);
        assert!(groups
            .iter()
            .all(|group| group.len() == 5 && group.bytes().all(|b| BASE32_ALPHABET.contains(&b))));
        assert_eq!(*parse_recovery_code(text).unwrap(), *secret);
        let relaxed = format!("  {}\n", text.to_lowercase().replace('-', " "));
        assert_eq!(*parse_recovery_code(&relaxed).unwrap(), *secret);
        let digits = text.replace('O', "0").replace('I', "1").replace('B', "8");
        assert_eq!(*parse_recovery_code(&digits).unwrap(), *secret);
        assert_eq!(format!("{code:?}"), "RecoveryCode(..)");

        // Фіксований секрет — однозначна перевірка контрольної суми.
        let fixed = [0x5a_u8; KEY_LEN];
        let fixed_code = code_for(&fixed);
        assert_eq!(*parse_recovery_code(&fixed_code).unwrap(), fixed);
        let mut typo = fixed_code.clone().into_bytes();
        typo[0] = if typo[0] == b'A' { b'C' } else { b'A' };
        let error = parse_recovery_code(&String::from_utf8(typo).unwrap()).unwrap_err();
        assert!(matches!(error, LibraryError::RecoveryChecksum));
        assert_eq!(
            error.to_string(),
            "код відновлення введено з помилкою: контрольна сума не збігається, перевірте символи"
        );

        for wrong in [
            String::new(),
            fixed_code[..60].to_owned(),
            format!("{fixed_code}A"),
            fixed_code.replacen('-', "Ж", 1),
            // Залишкові біти останнього символу мають бути нулями.
            format!("{}7", &fixed_code[..fixed_code.len() - 1]),
        ] {
            assert!(
                matches!(
                    parse_recovery_code(&wrong),
                    Err(LibraryError::InvalidRecoveryCode)
                ),
                "{wrong}"
            );
        }
    }

    #[tokio::test]
    async fn recovery_code_resets_the_password_and_rotates_itself() {
        let (store, created) = library(true).await;
        let code = created.recovery_code.unwrap();
        let (_, version) = store
            .import(&created.keys, text_document("Звіт", b"payload"), NOW)
            .await
            .unwrap();
        assert!(matches!(
            store.prepare_recovery(PROFILE, "AAAAA", NEW_PASSWORD).await,
            Err(LibraryError::InvalidRecoveryCode)
        ));
        let foreign = generate_recovery_code().0;
        assert!(matches!(
            store
                .prepare_recovery(PROFILE, foreign.as_str(), NEW_PASSWORD)
                .await,
            Err(LibraryError::RecoveryMismatch)
        ));

        let prepared = store
            .prepare_recovery(PROFILE, code.as_str(), NEW_PASSWORD)
            .await
            .unwrap();
        assert_eq!(prepared.profile_id(), PROFILE);
        let mut transaction = store.pool.begin().await.unwrap();
        set_login_hash(&mut transaction, NEW_HASH).await;
        prepared.apply(&mut transaction, LATER).await.unwrap();
        transaction.commit().await.unwrap();
        let (keys, new_code) = prepared.into_parts();
        assert_ne!(new_code.as_str(), code.as_str());
        assert_eq!(login_hash(&store.pool).await, NEW_HASH);
        assert_eq!(
            store
                .read_version(&keys, &version.id)
                .await
                .unwrap()
                .1
                .as_slice(),
            b"payload"
        );
        assert!(store.unlock(PROFILE, NEW_PASSWORD, LATER).await.is_ok());
        assert!(matches!(
            store.unlock(PROFILE, PASSWORD, LATER).await,
            Err(LibraryError::WrongPassword)
        ));
        assert!(matches!(
            store
                .prepare_recovery(PROFILE, code.as_str(), NEW_PASSWORD)
                .await,
            Err(LibraryError::RecoveryMismatch)
        ));
        assert!(store
            .prepare_recovery(PROFILE, new_code.as_str(), PASSWORD)
            .await
            .is_ok());
        assert_eq!(
            store.keyring_status(PROFILE).await.unwrap(),
            KeyringStatus::Active {
                has_recovery: true,
                generation: 2
            }
        );
        assert!(event_names(&store, PROFILE)
            .await
            .contains(&"recovered".to_owned()));

        add_profile(&store.pool, OTHER, "Другий", Some(HASH)).await;
        store.create(OTHER, PASSWORD, false, NOW).await.unwrap();
        assert!(matches!(
            store
                .prepare_recovery(OTHER, new_code.as_str(), NEW_PASSWORD)
                .await,
            Err(LibraryError::RecoveryNotSet)
        ));
    }

    #[tokio::test]
    async fn reissued_recovery_code_replaces_the_old_one() {
        let (store, _created) = library(false).await;
        assert_eq!(
            store.keyring_status(PROFILE).await.unwrap(),
            KeyringStatus::Active {
                has_recovery: false,
                generation: 1
            }
        );
        assert!(matches!(
            store.reissue_recovery(PROFILE, "не той", NOW).await,
            Err(LibraryError::WrongPassword)
        ));
        let first = store
            .reissue_recovery(PROFILE, PASSWORD, NOW)
            .await
            .unwrap();
        assert_eq!(
            store.keyring_status(PROFILE).await.unwrap(),
            KeyringStatus::Active {
                has_recovery: true,
                generation: 2
            }
        );
        let second = store
            .reissue_recovery(PROFILE, PASSWORD, LATER)
            .await
            .unwrap();
        assert!(matches!(
            store
                .prepare_recovery(PROFILE, first.as_str(), NEW_PASSWORD)
                .await,
            Err(LibraryError::RecoveryMismatch)
        ));
        assert!(store
            .prepare_recovery(PROFILE, second.as_str(), NEW_PASSWORD)
            .await
            .is_ok());
        // Пароль не змінився.
        assert!(store.unlock(PROFILE, PASSWORD, LATER).await.is_ok());
        let reissued = event_names(&store, PROFILE)
            .await
            .into_iter()
            .filter(|event| event == "recovery_reissued")
            .count();
        assert_eq!(reissued, 2);
    }

    // --- Зміна пароля ------------------------------------------------------

    #[tokio::test]
    async fn password_rewrap_commits_together_with_the_login_hash() {
        let (store, created) = library(true).await;
        let (_, version) = store
            .import(&created.keys, text_document("Звіт", b"payload"), NOW)
            .await
            .unwrap();
        assert!(matches!(
            store
                .prepare_password_rewrap(PROFILE, "не той", NEW_PASSWORD)
                .await,
            Err(LibraryError::WrongPassword)
        ));
        let prepared = store
            .prepare_password_rewrap(PROFILE, PASSWORD, NEW_PASSWORD)
            .await
            .unwrap()
            .unwrap();
        assert_eq!(prepared.profile_id(), PROFILE);

        // Відкат транзакції викликача: не змінюється ні хеш входу, ні обгортка.
        let mut transaction = store.pool.begin().await.unwrap();
        set_login_hash(&mut transaction, NEW_HASH).await;
        prepared.apply(&mut transaction, LATER).await.unwrap();
        transaction.rollback().await.unwrap();
        assert_eq!(login_hash(&store.pool).await, HASH);
        assert!(store.unlock(PROFILE, PASSWORD, LATER).await.is_ok());
        assert!(matches!(
            store.unlock(PROFILE, NEW_PASSWORD, LATER).await,
            Err(LibraryError::WrongPassword)
        ));

        // Коміт: змінюються обидва разом.
        let mut transaction = store.pool.begin().await.unwrap();
        set_login_hash(&mut transaction, NEW_HASH).await;
        prepared.apply(&mut transaction, LATER).await.unwrap();
        transaction.commit().await.unwrap();
        assert_eq!(login_hash(&store.pool).await, NEW_HASH);
        assert!(matches!(
            store.unlock(PROFILE, PASSWORD, LATER).await,
            Err(LibraryError::WrongPassword)
        ));
        let reopened = store.unlock(PROFILE, NEW_PASSWORD, LATER).await.unwrap();
        assert_eq!(
            store
                .read_version(&reopened, &version.id)
                .await
                .unwrap()
                .1
                .as_slice(),
            b"payload"
        );
        assert_eq!(
            store.keyring_status(PROFILE).await.unwrap(),
            KeyringStatus::Active {
                has_recovery: true,
                generation: 2
            }
        );

        // Підготовка для старого покоління нічого не запише.
        let mut transaction = store.pool.begin().await.unwrap();
        assert!(matches!(
            prepared.apply(&mut transaction, LATER).await,
            Err(LibraryError::KeyringChanged)
        ));
        transaction.rollback().await.unwrap();
        let rewrapped = event_names(&store, PROFILE)
            .await
            .into_iter()
            .filter(|event| event == "password_rewrapped")
            .count();
        assert_eq!(rewrapped, 1);

        // Профіль без бібліотеки: переобгортати нічого.
        add_profile(&store.pool, OTHER, "Другий", Some(HASH)).await;
        assert!(store
            .prepare_password_rewrap(OTHER, PASSWORD, NEW_PASSWORD)
            .await
            .unwrap()
            .is_none());
    }

    // --- Документи й версії ------------------------------------------------

    #[test]
    fn names_extensions_and_kinds() {
        assert_eq!(normalize_ext(".XLSX").unwrap(), "xlsx");
        assert!(matches!(
            normalize_ext("pdf"),
            Err(LibraryError::UnsupportedFormat(ext)) if ext == "pdf"
        ));
        assert_eq!(kind_for("docx", true), "template");
        assert_eq!(kind_for("txt", true), "document");
        assert_eq!(kind_for("csv", false), "table");
        assert_eq!(kind_for("pptx", false), "slides");
        assert_eq!(app_for_ext("csv"), "easygreen");
        assert_eq!(app_for_ext("txt"), "easydoc");
        assert_eq!(app_for_ext("pptx"), "easyslide");
        assert_eq!(clean_name("  Звіт\u{7}  ").unwrap(), "Звіт");
        assert!(clean_name(&"я".repeat(120)).is_ok());
        assert!(matches!(
            clean_name(&"я".repeat(121)),
            Err(LibraryError::InvalidName)
        ));
        assert!(matches!(clean_name(" \n "), Err(LibraryError::InvalidName)));
        assert_eq!(
            document_name_from_file("C:\\Звіти\\Доповідь.v2.docx"),
            "Доповідь.v2"
        );
        assert_eq!(document_name_from_file("/tmp/план.xlsx"), "план");
        assert_eq!(document_name_from_file(""), "Документ");

        let mut used = HashSet::new();
        assert_eq!(archive_entry_name("Звіт", "txt", &mut used), "Звіт.txt");
        assert_eq!(archive_entry_name("ЗВІТ", "txt", &mut used), "ЗВІТ (2).txt");
        assert_eq!(archive_entry_name("звіт", "txt", &mut used), "звіт (3).txt");
        assert_eq!(archive_entry_name("Звіт", "docx", &mut used), "Звіт.docx");
        assert_eq!(archive_entry_name("..", "", &mut used), "Документ.bin");
        assert_eq!(
            archive_entry_name("План: 1/2 <\"х\">", "csv", &mut used),
            "План_ 1_2 __х__.csv"
        );
        assert_eq!(truncate_at_char_boundary("абв", 3), "а");
    }

    #[tokio::test]
    async fn save_version_dedupes_and_records_origin() {
        let (store, created) = library(false).await;
        let keys = created.keys;
        let (item, v1) = store
            .import(&keys, text_document("Журнал", b"first"), NOW)
            .await
            .unwrap();
        assert_eq!(
            (v1.version_no, v1.origin, v1.current),
            (1, Origin::Imported, true)
        );
        assert_eq!(
            (item.kind.as_str(), item.app.as_str(), item.ext.as_str()),
            ("document", "easydoc", "txt")
        );
        assert_eq!(
            (item.version_count, item.current_origin),
            (1, Some(Origin::Imported))
        );

        // Той самий вміст, що й поточний, — нової версії немає.
        assert_eq!(
            store
                .save_version(&keys, &item.id, edit(b"first", Some(&v1.id)), NOW)
                .await
                .unwrap(),
            None
        );
        let v2 = store
            .save_version(&keys, &item.id, edit(b"second", Some(&v1.id)), LATER)
            .await
            .unwrap()
            .unwrap();
        assert_eq!(
            (
                v2.version_no,
                v2.origin,
                v2.parent_version_id.as_deref(),
                v2.current
            ),
            (2, Origin::Edited, Some(v1.id.as_str()), true)
        );
        // Збіг із батьківською версією — теж без нової версії.
        assert_eq!(
            store
                .save_version(&keys, &item.id, edit(b"first", Some(&v1.id)), LATER)
                .await
                .unwrap(),
            None
        );
        // Повернення до старого вмісту без батька — нова версія, вміст не дублюється.
        let v3 = store
            .save_version(
                &keys,
                &item.id,
                NewVersion {
                    origin: Origin::Saved,
                    make_current: false,
                    ..edit(b"first", None)
                },
                LATER,
            )
            .await
            .unwrap()
            .unwrap();
        assert!(!v3.current);
        let blobs: i64 =
            sqlx::query_scalar("SELECT count(*) FROM library_blobs WHERE profile_id = ?")
                .bind(PROFILE)
                .fetch_one(&store.pool)
                .await
                .unwrap();
        assert_eq!(blobs, 2);
        let item = store.item(&keys, &item.id).await.unwrap();
        assert_eq!(item.current_version_id.as_deref(), Some(v2.id.as_str()));
        assert_eq!(
            (item.current_origin, item.version_count),
            (Some(Origin::Edited), 3)
        );
        assert_eq!(item.updated_at, LATER);
        let versions = store.versions(&keys, &item.id).await.unwrap();
        assert_eq!(
            versions
                .iter()
                .map(|version| version.version_no)
                .collect::<Vec<_>>(),
            [3, 2, 1]
        );
        assert_eq!(versions.iter().filter(|version| version.current).count(), 1);
        let (read, bytes) = store.read_version(&keys, &v3.id).await.unwrap();
        assert_eq!(
            (read.origin, bytes.as_slice()),
            (Origin::Saved, &b"first"[..])
        );
        assert_eq!(store.version(&keys, &v2.id).await.unwrap(), {
            let mut current = v2.clone();
            current.current = true;
            current
        });

        for origin in [Origin::Imported, Origin::Generated] {
            assert!(matches!(
                store
                    .save_version(
                        &keys,
                        &item.id,
                        NewVersion {
                            origin,
                            ..edit(b"x", None)
                        },
                        NOW
                    )
                    .await,
                Err(LibraryError::InvalidOrigin)
            ));
        }
        assert!(matches!(
            store
                .save_version(
                    &keys,
                    &item.id,
                    NewVersion {
                        ext: "xlsx",
                        ..edit(b"x", None)
                    },
                    NOW
                )
                .await,
            Err(LibraryError::FormatMismatch(_))
        ));
        assert!(matches!(
            store
                .save_version(
                    &keys,
                    &item.id,
                    NewVersion {
                        ext: "pdf",
                        ..edit(b"x", None)
                    },
                    NOW
                )
                .await,
            Err(LibraryError::UnsupportedFormat(_))
        ));
        assert!(matches!(
            store
                .save_version(
                    &keys,
                    &item.id,
                    NewVersion {
                        source_fingerprint: Some("не відбиток"),
                        ..edit(b"x", None)
                    },
                    NOW
                )
                .await,
            Err(LibraryError::InvalidLink(_))
        ));
        assert!(matches!(
            store
                .save_version(&keys, MISSING_ITEM, edit(b"x", None), NOW)
                .await,
            Err(LibraryError::ItemNotFound)
        ));
        let (_, foreign_v1) = store
            .import(&keys, text_document("Інший", b"other"), NOW)
            .await
            .unwrap();
        assert!(matches!(
            store
                .save_version(&keys, &item.id, edit(b"y", Some(&foreign_v1.id)), NOW)
                .await,
            Err(LibraryError::VersionNotFound)
        ));
        assert!(matches!(
            store.versions(&keys, MISSING_ITEM).await,
            Err(LibraryError::ItemNotFound)
        ));
        assert!(matches!(
            store.read_version(&keys, MISSING_VERSION).await,
            Err(LibraryError::VersionNotFound)
        ));
        let saved = event_names(&store, PROFILE)
            .await
            .into_iter()
            .filter(|event| event == "version_saved")
            .count();
        assert_eq!(saved, 2);
    }

    #[tokio::test]
    async fn import_rejects_bad_names_formats_and_sizes() {
        let (store, created) = library(false).await;
        let keys = created.keys;
        assert!(matches!(
            store.import(&keys, text_document("  ", b"x"), NOW).await,
            Err(LibraryError::InvalidName)
        ));
        assert!(matches!(
            store
                .import(&keys, office_document("Скан", "pdf", b"x"), NOW)
                .await,
            Err(LibraryError::UnsupportedFormat(_))
        ));
        let template = store
            .import(
                &keys,
                NewDocument {
                    as_template: true,
                    profile_table_copy: true,
                    ..office_document("Шаблон", "xlsx", &xlsx("Аркуш", ""))
                },
                NOW,
            )
            .await
            .unwrap()
            .0;
        assert_eq!(
            (
                template.kind.as_str(),
                template.app.as_str(),
                template.profile_table_copy
            ),
            ("template", "easygreen", true)
        );
        let empty = store
            .import(&keys, text_document("Порожній", b""), NOW)
            .await
            .unwrap()
            .1;
        assert_eq!(empty.size, 0);
        assert!(store
            .read_version(&keys, &empty.id)
            .await
            .unwrap()
            .1
            .is_empty());
        assert!(matches!(
            seal_content(&keys, &vec![0u8; MAX_DOCUMENT_BYTES + 1]),
            Err(LibraryError::TooLarge)
        ));
    }

    #[tokio::test]
    async fn set_current_accepts_only_versions_of_the_same_item() {
        let (store, created) = library(false).await;
        let keys = created.keys;
        let (first, first_v1) = store
            .import(&keys, text_document("Перший", b"one"), NOW)
            .await
            .unwrap();
        let first_v2 = store
            .save_version(&keys, &first.id, edit(b"two", Some(&first_v1.id)), NOW)
            .await
            .unwrap()
            .unwrap();
        let (_, second_v1) = store
            .import(&keys, text_document("Другий", b"three"), NOW)
            .await
            .unwrap();
        assert!(matches!(
            store
                .set_current(&keys, &first.id, &second_v1.id, NOW)
                .await,
            Err(LibraryError::VersionNotFound)
        ));
        assert!(matches!(
            store
                .set_current(&keys, MISSING_ITEM, &first_v1.id, NOW)
                .await,
            Err(LibraryError::ItemNotFound)
        ));
        let item = store
            .set_current(&keys, &first.id, &first_v1.id, LATER)
            .await
            .unwrap();
        assert_eq!(
            item.current_version_id.as_deref(),
            Some(first_v1.id.as_str())
        );
        // Повтор тієї самої поточної версії подію не пише.
        store
            .set_current(&keys, &first.id, &first_v1.id, LATER)
            .await
            .unwrap();
        let changed = event_names(&store, PROFILE)
            .await
            .into_iter()
            .filter(|event| event == "current_changed")
            .count();
        assert_eq!(changed, 1);
        // Тригер не пускає чужу версію й повз сховище.
        let error = sqlx::query("UPDATE library_items SET current_version_id = ? WHERE id = ?")
            .bind(&second_v1.id)
            .bind(&first.id)
            .execute(&store.pool)
            .await
            .unwrap_err();
        assert!(error
            .to_string()
            .contains("current version must belong to the same item"));

        // Ключі бібліотеки іншого профілю не бачать документів цього профілю.
        add_profile(&store.pool, OTHER, "Другий", Some(HASH)).await;
        let stranger = store
            .create(OTHER, PASSWORD, false, NOW)
            .await
            .unwrap()
            .keys;
        assert!(store.list_items(&stranger, true).await.unwrap().is_empty());
        assert!(matches!(
            store.item(&stranger, &first.id).await,
            Err(LibraryError::ItemNotFound)
        ));
        assert!(matches!(
            store.read_version(&stranger, &first_v2.id).await,
            Err(LibraryError::VersionNotFound)
        ));
        assert!(matches!(
            store
                .set_current(&stranger, &first.id, &first_v2.id, NOW)
                .await,
            Err(LibraryError::ItemNotFound)
        ));
        assert!(matches!(
            store.rename(&stranger, &first.id, "Чуже", NOW).await,
            Err(LibraryError::ItemNotFound)
        ));
    }

    #[tokio::test]
    async fn rename_hide_and_list_items() {
        let (store, created) = library(false).await;
        let keys = created.keys;
        let (beta, _) = store
            .import(&keys, text_document("бета", b"b"), NOW)
            .await
            .unwrap();
        let (alpha, _) = store
            .import(&keys, text_document("Альфа", b"a"), NOW)
            .await
            .unwrap();
        let names =
            |items: Vec<LibraryItem>| items.into_iter().map(|item| item.name).collect::<Vec<_>>();
        assert_eq!(
            names(store.list_items(&keys, false).await.unwrap()),
            ["Альфа", "бета"]
        );

        let renamed = store
            .rename(&keys, &beta.id, "  Гама\u{7}  ", NOW)
            .await
            .unwrap();
        assert_eq!(renamed.name, "Гама");
        assert!(matches!(
            store.rename(&keys, &beta.id, "   ", NOW).await,
            Err(LibraryError::InvalidName)
        ));
        let hidden = store.set_hidden(&keys, &alpha.id, true, NOW).await.unwrap();
        assert!(hidden.hidden);
        // Повторне приховування нічого не змінює й подію не пише.
        store.set_hidden(&keys, &alpha.id, true, NOW).await.unwrap();
        assert_eq!(
            names(store.list_items(&keys, false).await.unwrap()),
            ["Гама"]
        );
        assert_eq!(
            names(store.list_items(&keys, true).await.unwrap()),
            ["Альфа", "Гама"]
        );
        let shown = store
            .set_hidden(&keys, &alpha.id, false, LATER)
            .await
            .unwrap();
        assert!(!shown.hidden);
        assert!(matches!(
            store.set_hidden(&keys, MISSING_ITEM, true, NOW).await,
            Err(LibraryError::ItemNotFound)
        ));
        assert_eq!(
            event_names(&store, PROFILE).await,
            ["created", "imported", "imported", "renamed", "hidden", "shown"]
        );
        store
            .record_event(
                &keys,
                LibraryEventKind::Exported,
                Some(&alpha.id),
                alpha.current_version_id.as_deref(),
                LATER,
            )
            .await
            .unwrap();
        let last = store.events(PROFILE).await.unwrap().pop().unwrap();
        assert_eq!(
            (last.event.as_str(), last.item_id.as_deref()),
            ("exported", Some(alpha.id.as_str()))
        );
    }

    #[tokio::test]
    async fn names_and_contents_are_never_stored_in_plaintext() {
        const NAME_MARKER: &str = "Синтетична-назва-ЖЖ7";
        const BODY_MARKER: &str = "СИНТЕТИЧНИЙ-ВМІСТ-ЖЖ9";
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("library.sqlite3");
        let pool = create_migrated_database(&path).await.unwrap();
        add_profile(&pool, PROFILE, "Синтетичний", Some(HASH)).await;
        let store = LibraryStore::with_kdf(pool.clone(), KdfParams::FOR_TESTS);
        let keys = store
            .create(PROFILE, PASSWORD, true, NOW)
            .await
            .unwrap()
            .keys;
        let body = format!("{BODY_MARKER}\n").repeat(4);
        let (item, version) = store
            .import(&keys, text_document(NAME_MARKER, body.as_bytes()), NOW)
            .await
            .unwrap();
        let edited = format!("{body}{BODY_MARKER}-2");
        store
            .save_version(
                &keys,
                &item.id,
                edit(edited.as_bytes(), Some(&version.id)),
                NOW,
            )
            .await
            .unwrap()
            .unwrap();
        store
            .rename(&keys, &item.id, &format!("{NAME_MARKER} нова"), NOW)
            .await
            .unwrap();
        let fragments: Vec<Vec<u8>> = sqlx::query_scalar(
            "SELECT substr(data, 30, 32) FROM library_blobs ORDER BY content_id",
        )
        .fetch_all(&pool)
        .await
        .unwrap();
        assert_eq!(fragments.len(), 2);
        pool.close().await;

        let stored = directory_bytes(directory.path());
        for fragment in &fragments {
            assert!(
                contains(&stored, fragment),
                "шифротекст лежить у файлі бази"
            );
        }
        for marker in [NAME_MARKER, BODY_MARKER, PASSWORD] {
            assert!(
                !contains(&stored, marker.as_bytes()),
                "відкритий текст «{marker}» не має потрапити у файл"
            );
        }

        // Очистка: ключ знищено, шифротекст затерто (secure_delete), профіль видалено.
        let pool = create_migrated_database(&path).await.unwrap();
        let mut transaction = pool.begin().await.unwrap();
        let summary = LibraryStore::purge_in_transaction(&mut transaction, PROFILE, LATER)
            .await
            .unwrap();
        assert_eq!(
            summary,
            PurgeSummary {
                items: 1,
                versions: 2
            }
        );
        sqlx::query("DELETE FROM local_profiles WHERE id = ?")
            .bind(PROFILE)
            .execute(&mut *transaction)
            .await
            .unwrap();
        transaction.commit().await.unwrap();
        let store = LibraryStore::with_kdf(pool.clone(), KdfParams::FOR_TESTS);
        assert!(matches!(
            store.read_version(&keys, &version.id).await,
            Err(LibraryError::Damaged)
        ));
        pool.close().await;
        let stored = directory_bytes(directory.path());
        for fragment in &fragments {
            assert!(
                !contains(&stored, fragment),
                "після очистки шифротексту у файлі немає"
            );
        }
        for marker in [NAME_MARKER, BODY_MARKER] {
            assert!(!contains(&stored, marker.as_bytes()));
        }
    }

    #[tokio::test]
    async fn profile_delete_is_blocked_until_the_library_is_purged() {
        let (store, created) = library(true).await;
        let keys = created.keys;
        let (_, template_v1) = store
            .import(
                &keys,
                NewDocument {
                    as_template: true,
                    ..office_document("Шаблон", "docx", &docx(&["{{period}}"]))
                },
                NOW,
            )
            .await
            .unwrap();
        let params = json!({"from": "2026-10-01"});
        let fingerprint = source_fingerprint(&keys, &params);
        store
            .save_generated(
                &keys,
                GeneratedDocument {
                    item_id: None,
                    name: Some("Доповідь"),
                    template_version_id: &template_v1.id,
                    source_kind: SourceKind::ApprovedRevisions,
                    params: &params,
                    fingerprint: &fingerprint,
                    ext: "docx",
                    bytes: &docx(&["Згенеровано"]),
                    make_current: true,
                },
                NOW,
            )
            .await
            .unwrap();

        let error = sqlx::query("DELETE FROM local_profiles WHERE id = ?")
            .bind(PROFILE)
            .execute(&store.pool)
            .await
            .unwrap_err();
        assert!(is_profile_delete_blocked(&error));
        assert_eq!(
            profile_delete_blocked(&error).unwrap().to_string(),
            "у профілю є захищена бібліотека; видаліть профіль разом з бібліотекою окремою дією"
        );
        assert!(profile_delete_blocked(&sqlx::Error::RowNotFound).is_none());

        let mut transaction = store.pool.begin().await.unwrap();
        let summary = LibraryStore::purge_in_transaction(&mut transaction, PROFILE, LATER)
            .await
            .unwrap();
        assert_eq!(
            summary,
            PurgeSummary {
                items: 2,
                versions: 2
            }
        );
        sqlx::query("DELETE FROM local_profiles WHERE id = ?")
            .bind(PROFILE)
            .execute(&mut *transaction)
            .await
            .unwrap();
        transaction.commit().await.unwrap();

        assert_eq!(
            store.keyring_status(PROFILE).await.unwrap(),
            KeyringStatus::Shredded
        );
        let left: (i64, i64, i64, i64) = sqlx::query_as(
            "SELECT (SELECT count(*) FROM library_blobs WHERE data IS NOT NULL),
                    (SELECT count(*) FROM document_links),
                    (SELECT count(*) FROM library_purges WHERE profile_id = ?1),
                    (SELECT count(*) FROM library_items WHERE profile_id = ?1)",
        )
        .bind(PROFILE)
        .fetch_one(&store.pool)
        .await
        .unwrap();
        assert_eq!(
            left,
            (0, 0, 1, 2),
            "документи лишаються нечитабельними надгробками"
        );
        let slots: (Option<Vec<u8>>, Option<Vec<u8>>, String, i64) = sqlx::query_as(
            "SELECT wrapped_ldk, recovery_wrapped_ldk, state, generation
             FROM library_keyrings WHERE profile_id = ?",
        )
        .bind(PROFILE)
        .fetch_one(&store.pool)
        .await
        .unwrap();
        assert_eq!(slots, (None, None, "shredded".to_owned(), 2));
        assert!(matches!(
            store.read_version(&keys, &template_v1.id).await,
            Err(LibraryError::Damaged)
        ));
        let archive = store.export_archive(&keys).await.unwrap();
        assert!(archive.entries.is_empty());
        assert_eq!(archive.damaged.len(), 2);
        assert_eq!(
            event_names(&store, PROFILE)
                .await
                .last()
                .map(String::as_str),
            Some("purged")
        );
        // Старі ключі в пам'яті вже нічого не запишуть.
        assert!(matches!(
            store
                .import(&keys, text_document("Новий", b"x"), LATER)
                .await,
            Err(LibraryError::Storage(_))
        ));
        let mut transaction = store.pool.begin().await.unwrap();
        assert!(matches!(
            LibraryStore::purge_in_transaction(&mut transaction, PROFILE, LATER).await,
            Err(LibraryError::NotCreated)
        ));
        transaction.rollback().await.unwrap();
        // Той самий ідентифікатор профілю бібліотеку вже не отримає.
        add_profile(&store.pool, PROFILE, "Синтетичний", Some(HASH)).await;
        assert!(matches!(
            store.create(PROFILE, PASSWORD, false, LATER).await,
            Err(LibraryError::Shredded)
        ));
        assert!(matches!(
            store.unlock(PROFILE, PASSWORD, LATER).await,
            Err(LibraryError::Shredded)
        ));
    }

    #[tokio::test]
    async fn archive_holds_current_versions_under_unique_names() {
        let (store, created) = library(false).await;
        let keys = created.keys;
        let (first, first_v1) = store
            .import(&keys, text_document("Звіт", b"first report"), NOW)
            .await
            .unwrap();
        store
            .save_version(
                &keys,
                &first.id,
                edit(b"first report v2", Some(&first_v1.id)),
                NOW,
            )
            .await
            .unwrap()
            .unwrap();
        store
            .import(&keys, text_document("Звіт", b"second report"), NOW)
            .await
            .unwrap();
        let (plan, _) = store
            .import(&keys, office_document("План: 1/2", "csv", b"a;b"), NOW)
            .await
            .unwrap();
        store.set_hidden(&keys, &plan.id, true, NOW).await.unwrap();

        let archive = store.export_archive(&keys).await.unwrap();
        assert!(archive.damaged.is_empty());
        let mut entries = archive.entries.clone();
        entries.sort();
        assert_eq!(entries, ["Звіт (2).txt", "Звіт.txt", "План_ 1_2.csv"]);
        let mut zip = zip::ZipArchive::new(Cursor::new(archive.bytes.to_vec())).unwrap();
        let mut contents = Vec::new();
        for name in &entries {
            let mut text = String::new();
            zip.by_name(name)
                .unwrap()
                .read_to_string(&mut text)
                .unwrap();
            contents.push(text);
        }
        contents.sort();
        assert_eq!(contents, ["a;b", "first report v2", "second report"]);
        assert!(!format!("{archive:?}").contains("first report"));
    }

    #[tokio::test]
    async fn damaged_content_is_reported_without_failing_the_library() {
        let (store, created) = library(false).await;
        let keys = created.keys;
        let (good, _) = store
            .import(&keys, text_document("Цілий", b"intact"), NOW)
            .await
            .unwrap();
        // Рядки з правильною формою, але чужим шифротекстом і назвою.
        let forged = random_id("doc");
        let forged_version = random_id("ver");
        let content_id = "ab".repeat(32);
        let mut data = b"EWLB\x01".to_vec();
        data.extend([0u8; NONCE_LEN + 5 + TAG_LEN]);
        sqlx::query(
            "INSERT INTO library_blobs (profile_id, content_id, plain_size, data, created_at)
             VALUES (?, ?, 5, ?, ?)",
        )
        .bind(PROFILE)
        .bind(&content_id)
        .bind(&data)
        .bind(NOW)
        .execute(&store.pool)
        .await
        .unwrap();
        sqlx::query(
            "INSERT INTO library_items (id, profile_id, kind, name_cipher, created_at)
             VALUES (?, ?, 'document', ?, ?)",
        )
        .bind(&forged)
        .bind(PROFILE)
        .bind(vec![1u8; 41])
        .bind(NOW)
        .execute(&store.pool)
        .await
        .unwrap();
        sqlx::query(
            "INSERT INTO library_versions
             (id, item_id, profile_id, version_no, content_id, ext, plain_size, origin, created_at)
             VALUES (?, ?, ?, 1, ?, 'txt', 5, 'imported', ?)",
        )
        .bind(&forged_version)
        .bind(&forged)
        .bind(PROFILE)
        .bind(&content_id)
        .bind(NOW)
        .execute(&store.pool)
        .await
        .unwrap();
        sqlx::query("UPDATE library_items SET current_version_id = ? WHERE id = ?")
            .bind(&forged_version)
            .bind(&forged)
            .execute(&store.pool)
            .await
            .unwrap();

        let items = store.list_items(&keys, true).await.unwrap();
        let shown = items.iter().find(|item| item.id == forged).unwrap();
        assert_eq!(shown.name, "(назву пошкоджено)");
        assert!(matches!(
            store.read_version(&keys, &forged_version).await,
            Err(LibraryError::Damaged)
        ));
        assert_eq!(store.damaged_items(&keys).await.unwrap(), [forged.as_str()]);
        let archive = store.export_archive(&keys).await.unwrap();
        assert_eq!(archive.damaged, [forged.as_str()]);
        assert_eq!(archive.entries, ["Цілий.txt"]);
        let (index, report) = store
            .build_index(&keys, IndexLimits::DEFAULT, ExtractLimits::DEFAULT, || true)
            .await
            .unwrap()
            .unwrap();
        assert_eq!(report.damaged, [forged.as_str()]);
        assert_eq!(report.indexed, [good.id.as_str()]);
        index.close().await;
        assert!(store
            .build_index(&keys, IndexLimits::DEFAULT, ExtractLimits::DEFAULT, || {
                false
            })
            .await
            .unwrap()
            .is_none());
    }

    // --- Зв'язки з джерелами -----------------------------------------------

    fn generated<'a>(
        item_id: Option<&'a str>,
        template: &'a str,
        params: &'a serde_json::Value,
        fingerprint: &'a str,
        bytes: &'a [u8],
    ) -> GeneratedDocument<'a> {
        GeneratedDocument {
            item_id,
            name: Some("Доповідь за тиждень"),
            template_version_id: template,
            source_kind: SourceKind::ApprovedRevisions,
            params,
            fingerprint,
            ext: "docx",
            bytes,
            make_current: true,
        }
    }

    #[tokio::test]
    async fn generated_documents_keep_their_link_and_lineage() {
        let (store, created) = library(false).await;
        let keys = created.keys;
        let (template, template_v1) = store
            .import(
                &keys,
                NewDocument {
                    as_template: true,
                    ..office_document("Шаблон", "docx", &docx(&["{{period}}"]))
                },
                NOW,
            )
            .await
            .unwrap();
        assert_eq!(template.kind, "template");
        let week = json!({"from": "2026-10-01", "to": "2026-10-07"});
        let fp1 = source_fingerprint(&keys, &json!({"rows": 1}));
        let fp2 = source_fingerprint(&keys, &json!({"rows": 2}));
        let first_bytes = docx(&["Тиждень 1"]);

        let first = store
            .save_generated(
                &keys,
                generated(None, &template_v1.id, &week, &fp1, &first_bytes),
                NOW,
            )
            .await
            .unwrap();
        assert!(first.created);
        assert_eq!(
            (
                first.version.version_no,
                first.version.origin,
                first.version.current
            ),
            (1, Origin::Generated, true)
        );
        assert_eq!(
            first.version.source_fingerprint.as_deref(),
            Some(fp1.as_str())
        );
        assert_eq!(
            (first.item.kind.as_str(), first.item.name.as_str()),
            ("document", "Доповідь за тиждень")
        );
        let summary = first.item.link.clone().unwrap();
        assert_eq!(
            (
                summary.source_kind,
                summary.template_version_id.as_str(),
                summary.last_generated_version_id.as_deref()
            ),
            (
                SourceKind::ApprovedRevisions,
                template_v1.id.as_str(),
                Some(first.version.id.as_str())
            )
        );
        assert_eq!(summary.params, week);
        let item_id = first.item.id.clone();

        // Той самий вміст — без нової версії.
        let same = store
            .save_generated(
                &keys,
                generated(Some(&item_id), &template_v1.id, &week, &fp1, &first_bytes),
                LATER,
            )
            .await
            .unwrap();
        assert!(!same.created);
        assert_eq!(same.version.id, first.version.id);

        // Нові дані — нова версія, батько — попередня згенерована.
        let second = store
            .save_generated(
                &keys,
                generated(
                    Some(&item_id),
                    &template_v1.id,
                    &week,
                    &fp2,
                    &docx(&["Тиждень 2"]),
                ),
                LATER,
            )
            .await
            .unwrap();
        assert!(second.created);
        assert_eq!(
            (
                second.version.version_no,
                second.version.parent_version_id.as_deref()
            ),
            (2, Some(first.version.id.as_str()))
        );
        let link = store.link(&keys, &item_id).await.unwrap().unwrap();
        assert_eq!(
            (
                link.last_generated_version_id.as_deref(),
                link.source_fingerprint.as_deref()
            ),
            (Some(second.version.id.as_str()), Some(fp2.as_str()))
        );
        assert_eq!(
            (link.created_at.as_str(), link.updated_at.as_str()),
            (NOW, LATER)
        );

        // Ручна правка, а лінія генерацій далі йде від останньої згенерованої.
        let edited_bytes = docx(&["Правка"]);
        let edited = store
            .save_version(
                &keys,
                &item_id,
                NewVersion {
                    ext: "docx",
                    bytes: &edited_bytes,
                    origin: Origin::Edited,
                    parent_version_id: Some(&second.version.id),
                    source_fingerprint: Some(&fp2),
                    make_current: true,
                },
                LATER,
            )
            .await
            .unwrap()
            .unwrap();
        let third = store
            .save_generated(
                &keys,
                GeneratedDocument {
                    make_current: false,
                    ..generated(
                        Some(&item_id),
                        &template_v1.id,
                        &week,
                        &fp1,
                        &docx(&["Тиждень 3"]),
                    )
                },
                LATER,
            )
            .await
            .unwrap();
        assert_eq!(
            third.version.parent_version_id.as_deref(),
            Some(second.version.id.as_str())
        );
        assert!(!third.version.current);
        assert_eq!(
            store
                .item(&keys, &item_id)
                .await
                .unwrap()
                .current_version_id
                .as_deref(),
            Some(edited.id.as_str())
        );

        // Інші параметри — новий рядок зв'язку.
        let month = json!({"from": "2026-10-01", "to": "2026-10-31"});
        let fourth = store
            .save_generated(
                &keys,
                generated(
                    Some(&item_id),
                    &template_v1.id,
                    &month,
                    &fp1,
                    &docx(&["Місяць"]),
                ),
                "2026-10-21T08:00:00Z",
            )
            .await
            .unwrap();
        let link = store.link(&keys, &item_id).await.unwrap().unwrap();
        assert_eq!(link.params, month);
        assert_eq!(link.created_at, "2026-10-21T08:00:00Z");
        assert_eq!(
            link.last_generated_version_id,
            Some(fourth.version.id.clone())
        );
        assert_eq!(store.links(&keys).await.unwrap(), [link]);

        // Хибні запити.
        assert!(matches!(
            store
                .save_generated(
                    &keys,
                    generated(None, &template_v1.id, &week, "abc", &first_bytes),
                    NOW
                )
                .await,
            Err(LibraryError::InvalidLink(_))
        ));
        assert!(matches!(
            store
                .save_generated(
                    &keys,
                    GeneratedDocument {
                        ext: "txt",
                        ..generated(None, &template_v1.id, &week, &fp1, b"text")
                    },
                    NOW
                )
                .await,
            Err(LibraryError::FormatMismatch(_))
        ));
        assert!(matches!(
            store
                .save_generated(
                    &keys,
                    GeneratedDocument {
                        ext: "xlsx",
                        ..generated(Some(&item_id), &template_v1.id, &week, &fp1, &xlsx("А", ""))
                    },
                    NOW
                )
                .await,
            Err(LibraryError::FormatMismatch(_))
        ));
        assert!(matches!(
            store
                .save_generated(
                    &keys,
                    generated(None, MISSING_VERSION, &week, &fp1, &first_bytes),
                    NOW
                )
                .await,
            Err(LibraryError::VersionNotFound)
        ));
        let huge = json!({"note": "я".repeat(3000)});
        assert!(matches!(
            store
                .save_generated(
                    &keys,
                    generated(None, &template_v1.id, &huge, &fp1, &first_bytes),
                    NOW
                )
                .await,
            Err(LibraryError::InvalidLink(_))
        ));
        assert!(matches!(
            store
                .save_generated(
                    &keys,
                    generated(
                        Some(&template.id),
                        &template_v1.id,
                        &week,
                        &fp1,
                        &first_bytes
                    ),
                    NOW
                )
                .await,
            Err(LibraryError::LinkNotFound)
        ));
        add_profile(&store.pool, OTHER, "Другий", Some(HASH)).await;
        let stranger = store
            .create(OTHER, PASSWORD, false, NOW)
            .await
            .unwrap()
            .keys;
        assert!(matches!(
            store
                .save_generated(
                    &stranger,
                    generated(None, &template_v1.id, &week, &fp1, &first_bytes),
                    NOW
                )
                .await,
            Err(LibraryError::VersionNotFound)
        ));

        // «Відв'язати»: зв'язок зникає, документ і версії лишаються.
        let unlinked = store.unlink(&keys, &item_id).await.unwrap();
        assert!(unlinked.link.is_none());
        assert_eq!(unlinked.version_count, 5);
        assert!(store.link(&keys, &item_id).await.unwrap().is_none());
        assert!(matches!(
            store.unlink(&keys, &item_id).await,
            Err(LibraryError::LinkNotFound)
        ));
        assert!(matches!(
            store
                .save_generated(
                    &keys,
                    generated(Some(&item_id), &template_v1.id, &week, &fp1, &first_bytes),
                    NOW
                )
                .await,
            Err(LibraryError::LinkNotFound)
        ));
        let generated_events = event_names(&store, PROFILE)
            .await
            .into_iter()
            .filter(|event| event == "generated")
            .count();
        assert_eq!(generated_events, 4);
    }

    // --- Сесія й індекс ----------------------------------------------------

    #[test]
    fn session_locks_on_demand_on_idle_and_for_other_profiles() {
        fn assert_send_sync<T: Send + Sync>() {}
        assert_send_sync::<LibrarySession>();
        assert_send_sync::<LibraryKeys>();
        assert_send_sync::<SearchIndex>();

        let session = LibrarySession::default();
        let error = session.keys(PROFILE).unwrap_err();
        assert_eq!(error.to_string(), LOCKED_MESSAGE);
        assert!(LOCKED_MESSAGE.starts_with("бібліотека заблокована"));
        assert_eq!(IDLE_LOCK_TIMEOUT, Duration::from_secs(30 * 60));

        let epoch = session.unlock(LibraryKeys::derive(PROFILE, &[3u8; KEY_LEN]));
        assert!(session.is_current(epoch));
        assert_eq!(session.unlocked_profile().as_deref(), Some(PROFILE));
        assert_eq!(session.keys(PROFILE).unwrap().profile_id(), PROFILE);
        assert!(matches!(session.keys(OTHER), Err(LibraryError::Locked)));
        assert!(matches!(
            session.search_index(OTHER),
            Err(LibraryError::Locked)
        ));
        assert!(session.index_status(OTHER).is_none());
        assert!(session.search_index(PROFILE).unwrap().is_none());
        assert!(!session.lock_if_idle(Duration::from_secs(3600)));
        session.touch();
        assert!(session.lock_if_idle(Duration::ZERO));
        assert!(!session.is_current(epoch));
        assert!(session.unlocked_profile().is_none());
        assert!(matches!(session.keys(PROFILE), Err(LibraryError::Locked)));
        assert!(!session.lock());

        // Розблокування іншого профілю блокує попередню бібліотеку.
        session.unlock(LibraryKeys::derive(PROFILE, &[3u8; KEY_LEN]));
        session.unlock(LibraryKeys::derive(OTHER, &[4u8; KEY_LEN]));
        assert_eq!(session.unlocked_profile().as_deref(), Some(OTHER));
        assert!(matches!(session.keys(PROFILE), Err(LibraryError::Locked)));
        assert!(session.lock());
    }

    #[tokio::test]
    async fn index_built_for_an_old_epoch_is_closed_not_installed() {
        let session = LibrarySession::default();
        session.unlock(LibraryKeys::derive(PROFILE, &[3u8; KEY_LEN]));
        let (epoch, keys) = session.begin_index(PROFILE).unwrap();
        assert_eq!(keys.profile_id(), PROFILE);
        assert!(
            session.begin_index(PROFILE).is_none(),
            "індекс уже будується"
        );
        assert!(session.begin_index(OTHER).is_none());
        assert!(session.index_status(PROFILE).unwrap().indexing);
        session.lock();
        session.unlock(LibraryKeys::derive(PROFILE, &[3u8; KEY_LEN]));
        assert!(!session.is_current(epoch));
        let (index, report) = SearchIndex::build(
            &[("doc-a".to_owned(), extracted("старий текст"))],
            IndexLimits::DEFAULT,
        )
        .await
        .unwrap();
        let pool = index.pool_handle();
        assert!(!session.finish_index(epoch, index, report));
        assert!(pool.is_closed(), "застарілий індекс закрито");
        assert!(session.search_index(PROFILE).unwrap().is_none());
        drop(keys);

        // Невдала побудова дозволяє повторити; чинна епоха встановлює індекс.
        let (epoch, _) = session.begin_index(PROFILE).unwrap();
        session.fail_index(epoch);
        let status = session.index_status(PROFILE).unwrap();
        assert!(!status.indexing && !status.ready);
        let (epoch, _) = session.begin_index(PROFILE).unwrap();
        let (index, report) = SearchIndex::build(&[], IndexLimits::DEFAULT).await.unwrap();
        assert!(session.finish_index(epoch, index, report));
        assert!(session.index_status(PROFILE).unwrap().ready);
        assert!(session.search_index(PROFILE).unwrap().is_some());
        assert!(session.begin_index(PROFILE).is_none(), "індекс уже готовий");
    }

    #[tokio::test]
    async fn index_finds_content_and_disappears_on_lock() {
        let (store, created) = library(false).await;
        let session = LibrarySession::default();
        let keys = created.keys;
        let report_bytes = docx(&["Синтетичний ракетний звіт", "друга частина"]);
        let (report, _) = store
            .import(
                &keys,
                office_document("Доповідь", "docx", &report_bytes),
                NOW,
            )
            .await
            .unwrap();
        let slides_bytes = pptx(&[(1, "слайд про мости")]);
        let (slides, _) = store
            .import(
                &keys,
                office_document("Брифінг", "pptx", &slides_bytes),
                NOW,
            )
            .await
            .unwrap();
        let table_bytes = xlsx(
            "Аркуш",
            r#"<row r="1"><c r="A1" t="inlineStr"><is><t>клітинкамаркер</t></is></c></row>"#,
        );
        let (table, _) = store
            .import(&keys, office_document("Облік", "xlsx", &table_bytes), NOW)
            .await
            .unwrap();
        let (hidden, _) = store
            .import(
                &keys,
                text_document("Чернетка", "синтетичний прихований текст".as_bytes()),
                NOW,
            )
            .await
            .unwrap();
        store
            .set_hidden(&keys, &hidden.id, true, NOW)
            .await
            .unwrap();
        session.unlock(keys);

        // Поки індексу немає — пошук лише за назвами.
        let keys = session.keys(PROFILE).unwrap();
        let early = store
            .search(&session, &keys, "брифінг", false)
            .await
            .unwrap();
        assert!(!early.index_ready);
        assert_eq!(early.results.len(), 1);
        assert!(early.results[0].by_name);

        assert!(store.run_index_build(&session, PROFILE).await.unwrap());
        assert!(!store.run_index_build(&session, PROFILE).await.unwrap());
        let status = store.status(Some(PROFILE), &session).await.unwrap();
        assert!(status.index_ready && !status.indexing && status.damaged.is_empty());

        let found = store
            .search(&session, &keys, "синтетичн", false)
            .await
            .unwrap();
        assert!(found.index_ready);
        assert_eq!(
            found
                .results
                .iter()
                .map(|hit| hit.item_id.as_str())
                .collect::<Vec<_>>(),
            [report.id.as_str()],
            "прихований документ не з'являється через вміст"
        );
        assert!(!found.results[0].by_name);
        assert!(found.results[0]
            .snippet
            .as_deref()
            .unwrap()
            .contains("Синтетичний"));
        let with_hidden = store
            .search(&session, &keys, "синтетичн", true)
            .await
            .unwrap();
        assert_eq!(with_hidden.results.len(), 2);
        let hit = |query: &'static str| {
            let store = store.clone();
            let keys = Arc::clone(&keys);
            let session = &session;
            async move {
                store
                    .search(session, &keys, query, false)
                    .await
                    .unwrap()
                    .results
                    .into_iter()
                    .map(|hit| hit.item_id)
                    .collect::<Vec<_>>()
            }
        };
        assert_eq!(hit("мости").await, [slides.id.as_str()]);
        assert_eq!(hit("КЛІТИНКАМАРКЕР").await, [table.id.as_str()]);
        // Оператори FTS у запиті не ламають пошук.
        for query in [
            "\"",
            "звіт OR",
            "NEAR(звіт",
            "body:звіт",
            "-звіт",
            "звіт*",
            "^звіт",
            "",
            "   ",
        ] {
            store.search(&session, &keys, query, true).await.unwrap();
        }

        let index = session.search_index(PROFILE).unwrap().unwrap();
        let pool = index.pool_handle();
        drop(index);
        assert!(session.lock());
        assert!(pool.is_closed(), "індекс закрито разом із блокуванням");
        assert!(sqlx::query("SELECT count(*) FROM library_text")
            .fetch_one(&pool)
            .await
            .is_err());
        assert!(matches!(
            store.search(&session, &keys, "синтетичний", false).await,
            Err(LibraryError::Locked)
        ));
        assert!(matches!(session.keys(PROFILE), Err(LibraryError::Locked)));
        assert!(!store.run_index_build(&session, PROFILE).await.unwrap());
    }

    #[tokio::test]
    async fn index_limits_cap_each_document_and_the_whole_index() {
        let long = format!("start {}endmarker", "word ".repeat(400));
        let entries = vec![
            ("doc-a".to_owned(), extracted(&long)),
            ("doc-b".to_owned(), extracted(&"second ".repeat(200))),
            ("doc-c".to_owned(), extracted("third document")),
            ("doc-d".to_owned(), extracted("")),
        ];
        let (index, report) = SearchIndex::build(
            &entries,
            IndexLimits {
                per_document: 1000,
                total: 1500,
            },
        )
        .await
        .unwrap();
        assert_eq!(report.total_bytes, 1500);
        assert_eq!(report.indexed, ["doc-a", "doc-b", "doc-d"]);
        assert_eq!(report.truncated, ["doc-a", "doc-b", "doc-c"]);
        assert_eq!(index.search("start", 10).await.unwrap().len(), 1);
        assert!(index.search("endmarker", 10).await.unwrap().is_empty());
        assert_eq!(index.search("second", 10).await.unwrap().len(), 1);
        assert!(index.search("third", 10).await.unwrap().is_empty());
        index.close().await;
        assert_eq!(
            IndexLimits::DEFAULT,
            IndexLimits {
                per_document: 1024 * 1024,
                total: 64 * 1024 * 1024
            }
        );
    }

    #[tokio::test]
    async fn fts_queries_quote_every_term() {
        assert_eq!(
            fts_query("звіт OR ракета").as_deref(),
            Some("\"звіт\"* \"OR\"* \"ракета\"*")
        );
        assert_eq!(fts_query("ab\"c").as_deref(), Some("\"ab\"\"c\"*"));
        assert_eq!(fts_query("  - * \" ( ) "), None);
        assert_eq!(fts_query(""), None);
        assert_eq!(
            fts_query(&"слово ".repeat(40))
                .unwrap()
                .matches('*')
                .count(),
            16
        );
        assert!(name_matches("Доповідь за жовтень", "ДОПОВІДЬ жовт"));
        assert!(!name_matches("Доповідь", "доповідь листопад"));
        assert!(!name_matches("Доповідь", "   "));

        let (index, _) = SearchIndex::build(
            &[("doc-a".to_owned(), extracted("Ракетний звіт за жовтень"))],
            IndexLimits::DEFAULT,
        )
        .await
        .unwrap();
        assert_eq!(index.search("РАКЕТН жовт", 10).await.unwrap().len(), 1);
        assert!(index
            .search("звіт OR листопад", 10)
            .await
            .unwrap()
            .is_empty());
        for query in [
            "\"",
            "NEAR(звіт",
            "body:звіт",
            "{item_id}: звіт",
            "звіт)",
            "\u{345}",
        ] {
            index.search(query, 10).await.unwrap();
        }
        index.close().await;
    }

    // --- Витяг тексту ------------------------------------------------------

    #[test]
    fn extracts_text_from_office_formats() {
        let document = r#"<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>Перший абзац</w:t></w:r></w:p><w:p><w:r><w:t xml:space="preserve">Друге &amp; третє</w:t><w:tab/><w:t>після</w:t><w:br/><w:t>рядок</w:t></w:r></w:p></w:body></w:document>"#;
        let header = r#"<w:hdr xmlns:w="w"><w:p><w:r><w:t>Колонтитул</w:t></w:r></w:p></w:hdr>"#;
        let bytes = zip_parts(&[
            ("word/header1.xml", header.as_bytes()),
            ("word/document.xml", document.as_bytes()),
            (
                "word/styles.xml",
                "<w:styles xmlns:w=\"w\"><w:t>не текст</w:t></w:styles>".as_bytes(),
            ),
        ]);
        let text = extract_text("docx", &bytes).unwrap();
        assert_eq!(
            text.text.as_str(),
            "Перший абзац\nДруге & третє\tпісля\nрядок\nКолонтитул\n"
        );
        assert!(!text.truncated);
        assert!(!format!("{text:?}").contains("абзац"));

        let slides = pptx(&[(10, "десятий"), (2, "другий")]);
        assert_eq!(
            extract_text("pptx", &slides).unwrap().text.as_str(),
            "другий\nдесятий\n"
        );

        let table = xlsx(
            "Аркуш",
            r#"<row r="1"><c r="A1" t="inlineStr"><is><t>клітинка</t></is></c><c r="B1"><v>42</v></c></row>"#,
        );
        assert_eq!(
            extract_text("xlsx", &table).unwrap().text.as_str(),
            "Аркуш\nклітинка\t42\n"
        );

        let plain = extract_text(
            "txt",
            b"\xEF\xBB\xBF\xd1\x80\xd1\x8f\xd0\xb4\xd0\xbe\xd0\xba\xFF",
        )
        .unwrap();
        assert_eq!(plain.text.as_str(), "рядок\u{FFFD}");
        assert_eq!(
            extract_text("CSV", b"a;b\n1;2").unwrap().text.as_str(),
            "a;b\n1;2"
        );
        let short = ExtractLimits {
            max_text_bytes: 5,
            ..ExtractLimits::DEFAULT
        };
        let cut = extract_text_with("txt", "абвгд".as_bytes(), short).unwrap();
        assert_eq!((cut.text.as_str(), cut.truncated), ("аб", true));
        let cut = extract_text_with("docx", &docx(&["абвгд"]), short).unwrap();
        assert_eq!((cut.text.as_str(), cut.truncated), ("аб", true));
        assert!(matches!(
            extract_text("pdf", b"%PDF"),
            Err(LibraryError::UnsupportedFormat(_))
        ));
    }

    #[test]
    fn extraction_rejects_zip_bombs() {
        // Забагато записів: межа рахується до розбору центрального каталогу.
        let names: Vec<String> = (0..2001).map(|n| format!("word/media/{n}.bin")).collect();
        let crowded: Vec<(&str, &[u8])> =
            names.iter().map(|name| (name.as_str(), &b""[..])).collect();
        let error = extract_text("docx", &zip_parts(&crowded)).unwrap_err();
        assert!(matches!(error, LibraryError::ExtractionLimit(_)), "{error}");
        assert!(error.to_string().contains("2000"));
        let mut allowed = crowded[..1999].to_vec();
        allowed.push(("word/document.xml", b"<w:document xmlns:w=\"w\"/>"));
        assert!(extract_text("docx", &zip_parts(&allowed)).is_ok());

        // Одна величезна частина: 4 МіБ пробілів стискаються до кількох КіБ.
        let filler = " ".repeat(4 * 1024 * 1024);
        let small = ExtractLimits {
            max_xml_bytes: 1024 * 1024,
            ..ExtractLimits::DEFAULT
        };
        let document = format!("<w:document xmlns:w=\"w\"><w:body>{filler}</w:body></w:document>");
        let bomb = zip_parts(&[("word/document.xml", document.as_bytes())]);
        assert!(bomb.len() < 64 * 1024);
        assert!(matches!(
            extract_text_with("docx", &bomb, small),
            Err(LibraryError::ExtractionLimit(_))
        ));
        let slide = format!("<p:sld xmlns:p=\"p\">{filler}</p:sld>");
        let slides = zip_parts(&[("ppt/slides/slide1.xml", slide.as_bytes())]);
        assert!(matches!(
            extract_text_with("pptx", &slides, small),
            Err(LibraryError::ExtractionLimit(_))
        ));
        // XLSX: та сама межа ще до calamine.
        let sheet = xlsx("Аркуш", &filler);
        assert!(matches!(
            extract_text_with("xlsx", &sheet, small),
            Err(LibraryError::ExtractionLimit(_))
        ));

        // Не архів, zip64 і межа часу.
        assert!(matches!(
            extract_text("docx", b"not a zip"),
            Err(LibraryError::Extraction(_))
        ));
        let mut zip64 = b"PK\x06\x07".to_vec();
        zip64.extend([0u8; 16]);
        zip64.extend(b"PK\x05\x06");
        zip64.extend([0xff_u8; 18]);
        assert!(matches!(
            extract_text("docx", &zip64),
            Err(LibraryError::ExtractionLimit(_))
        ));
        let instant = ExtractLimits {
            time_limit: Duration::ZERO,
            ..ExtractLimits::DEFAULT
        };
        assert!(matches!(
            extract_text_with("docx", &docx(&["текст"]), instant),
            Err(LibraryError::ExtractionLimit(_))
        ));
        assert_eq!(ExtractLimits::DEFAULT.max_entries, 2000);
        assert_eq!(ExtractLimits::DEFAULT.max_xml_bytes, 32 * 1024 * 1024);
    }
}
