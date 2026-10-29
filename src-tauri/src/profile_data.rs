//! Дані профілю: зашифроване сховище пар «ключ → JSON-текст» у прихованій теці застосунку
//! (`<app_local_data>/profile-data/<profile_id>/`), окреме для кожного профілю.
//!
//! Рішення власника 29.10.2026: усі дані застосунків (EasyFLY, «Сонце і Місяць», пункти
//! «Погоди», «Колективи», easyPay, налаштування модулів) прив'язані до профілю й лежать у
//! прихованій теці; «відкрив, авторизувався — і все, всі дані доступні», без відкриття файлів
//! і без окремого розблокування бібліотеки.
//!
//! Ключі:
//! - ключ даних (DEK, 32 випадкові байти) загорнуто XChaCha20-Poly1305 ключем, виведеним
//!   Argon2id із пароля профілю (параметри зберігаються в `keyring.json`). Вхід у профіль
//!   сам розгортає DEK: пароль уже є в команді входу;
//! - профіль без пароля використовує порожній пароль: дані лежать зашифровані, але захисту
//!   від того, хто має доступ до теки застосунку, це не дає (так само, як і вхід без пароля);
//! - запасний слот: DEK, загорнутий ключем бібліотеки профілю
//!   ([`crate::office_library::LibraryKeys::profile_data_wrap_key`]). Він з'являється, коли
//!   бібліотека розблокована, і дозволяє зберегти дані після відновлення пароля кодом
//!   бібліотеки. Без бібліотеки забутий пароль означає втрачені дані профілю.
//!
//! Записи: файл `<hex>.ewd`, де `hex` — HMAC імені ключа (імена ключів на диску не видно);
//! вміст — JSON `{key, value, modified}` під XChaCha20-Poly1305, AAD прив'язує його до
//! профілю й назви файлу. Тека не містить підтек. Запис атомарний (тимчасовий файл → перейменування).
//!
//! Простір імен — частина ключа до першої крапки (`easyfly.main` → `easyfly`). Головне вікно
//! бачить усі, вікно редактора — лише простір імен застосунку, відкритого в ньому
//! (`lib.rs`, [`namespace_of`]).

use std::fs;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex, MutexGuard};

use chrono::{SecondsFormat, Utc};
use serde::{Deserialize, Serialize};
use zeroize::Zeroizing;

use crate::office_library::{
    derive_kek, hkdf_key, hmac_hex, open, random_array, random_key, seal, to_hex, valid_profile_id,
    KdfParams, KEY_LEN, NONCE_LEN, SALT_LEN,
};
use crate::phone_export::{save_file, SaveTarget};

mod archive;
pub use archive::{ArchiveReport, ARCHIVE_EXT};

/// Назва теки всередині даних застосунку.
pub const ROOT_DIR_NAME: &str = "profile-data";
/// Розширення файлу запису.
pub const RECORD_EXT: &str = "ewd";
const KEYRING_FILE: &str = "keyring.json";
const FORMAT: u8 = 1;
const RECORD_MAGIC: &[u8; 4] = b"EWPD";
const RECORD_HEADER_LEN: usize = RECORD_MAGIC.len() + 1 + NONCE_LEN;
/// Найдовше ім'я ключа.
pub const MAX_KEY_CHARS: usize = 80;
/// Найбільше значення одного запису (EasyFLY обмежує свій файл 5 МБ).
pub const MAX_VALUE_BYTES: usize = 32 * 1024 * 1024;
/// Простір імен копій таблиць профілю (`tables.<слот>`): книга XLSX до 64 МБ у base64.
pub const TABLE_NAMESPACE: &str = "tables";
/// Найбільше значення запису в просторі `tables`: 64 МБ книги у base64 з запасом на JSON.
pub const MAX_TABLE_VALUE_BYTES: usize = 96 * 1024 * 1024;

/// Найбільше значення для ключа: копії таблиць більші за звичайні записи застосунків.
pub fn max_value_bytes(key: &str) -> usize {
    if namespace_of(key) == TABLE_NAMESPACE {
        MAX_TABLE_VALUE_BYTES
    } else {
        MAX_VALUE_BYTES
    }
}
/// Скільки записів тека приймає (захист від безмежного росту).
pub const MAX_RECORDS: usize = 512;

const LABEL_RECORD: &[u8] = b"easywar/profile-data/v1/record";
const LABEL_NAME: &[u8] = b"easywar/profile-data/v1/name";

#[derive(Debug, thiserror::Error, PartialEq, Eq)]
pub enum ProfileDataError {
    #[error("дані профілю заблоковані: увійдіть у профіль")]
    Locked,
    #[error("дані профілю не розшифровуються цим паролем (їх зашифровано іншим)")]
    WrongKey,
    #[error("ключ даних має вигляд «простір.назва»: латиниця в нижньому регістрі, цифри, крапка, дефіс, підкреслення; до 80 знаків")]
    InvalidKey,
    #[error("значення порожнє або більше за 32 МБ")]
    InvalidValue,
    #[error("запис пошкоджено або він зашифрований іншим ключем")]
    Damaged,
    #[error("у сховищі профілю забагато записів")]
    TooManyRecords,
    #[error("цей застосунок не має доступу до цього ключа")]
    Forbidden,
    #[error("профіль не знайдено")]
    ProfileNotFound,
    #[error("параметри ключа даних пошкоджено")]
    InvalidKeyring,
    #[error("не вдалося прочитати або записати дані профілю: {0}")]
    Io(String),
    #[error("файл не є копією даних профілю EasyWAR або пошкоджений")]
    InvalidArchive,
    #[error("файл уже існує; оберіть нове ім'я, щоб не перезаписати дані")]
    AlreadyExists,
}

impl From<std::io::Error> for ProfileDataError {
    fn from(error: std::io::Error) -> Self {
        ProfileDataError::Io(error.to_string())
    }
}

/// Перевірений ключ: `простір.назва`, `[a-z0-9._-]`, починається з літери чи цифри, містить крапку.
pub fn validate_key(key: &str) -> Result<&str, ProfileDataError> {
    let valid_chars = key
        .bytes()
        .all(|b| matches!(b, b'a'..=b'z' | b'0'..=b'9' | b'.' | b'_' | b'-'));
    let starts_ok = key
        .bytes()
        .next()
        .is_some_and(|b| b.is_ascii_lowercase() || b.is_ascii_digit());
    let namespace = namespace_of(key);
    if key.len() > MAX_KEY_CHARS
        || !valid_chars
        || !starts_ok
        || namespace.is_empty()
        || key.len() <= namespace.len() + 1
        || !key.as_bytes()[namespace.len() + 1].is_ascii_alphanumeric()
    {
        return Err(ProfileDataError::InvalidKey);
    }
    Ok(key)
}

/// Простір імен ключа: частина до першої крапки.
pub fn namespace_of(key: &str) -> &str {
    key.split('.').next().unwrap_or("")
}

/// Префікс для списку: порожній або `простір.` (рівно один простір імен).
fn validate_prefix(prefix: &str) -> Result<(), ProfileDataError> {
    if prefix.is_empty() {
        return Ok(());
    }
    let namespace = prefix.strip_suffix('.').unwrap_or(prefix);
    if namespace.is_empty()
        || namespace.len() > MAX_KEY_CHARS
        || !namespace
            .bytes()
            .all(|b| matches!(b, b'a'..=b'z' | b'0'..=b'9' | b'_' | b'-'))
    {
        return Err(ProfileDataError::InvalidKey);
    }
    Ok(())
}

/// Запис, прочитаний зі сховища.
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Record {
    pub key: String,
    pub value: String,
    pub modified: String,
}

/// Рядок переліку: без значення.
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RecordInfo {
    pub key: String,
    pub modified: String,
    pub size: usize,
}

#[derive(Serialize, Deserialize)]
struct RecordBody {
    key: String,
    value: String,
    modified: String,
}

/// Ключі розблокованого сховища одного профілю.
pub struct DataKeys {
    profile_id: String,
    dek: Zeroizing<[u8; KEY_LEN]>,
    record: Zeroizing<[u8; KEY_LEN]>,
    name: Zeroizing<[u8; KEY_LEN]>,
}

impl std::fmt::Debug for DataKeys {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter
            .debug_struct("DataKeys")
            .field("profile_id", &self.profile_id)
            .finish_non_exhaustive()
    }
}

fn record_aad(profile_id: &str, file_name: &str) -> Vec<u8> {
    format!("easywar/profile-data/v1/record\0{profile_id}\0{file_name}\0format={FORMAT}")
        .into_bytes()
}

fn keyring_aad(profile_id: &str, slot: &str) -> Vec<u8> {
    format!("easywar/profile-data/v1/keyring\0{profile_id}\0format={FORMAT}\0slot={slot}")
        .into_bytes()
}

impl DataKeys {
    fn derive(profile_id: &str, dek: &[u8; KEY_LEN]) -> Self {
        Self {
            profile_id: profile_id.to_owned(),
            dek: Zeroizing::new(*dek),
            record: hkdf_key(dek, None, LABEL_RECORD),
            name: hkdf_key(dek, None, LABEL_NAME),
        }
    }

    pub fn profile_id(&self) -> &str {
        &self.profile_id
    }

    /// Назва файлу запису: перші 32 шістнадцяткові знаки HMAC імені ключа, `.ewd`.
    pub fn file_name(&self, key: &str) -> String {
        let tag = hmac_hex(&self.name, key.as_bytes());
        format!("{}.{RECORD_EXT}", &tag[..32])
    }

    fn seal_record(
        &self,
        key: &str,
        value: &str,
        modified: &str,
    ) -> Result<Vec<u8>, ProfileDataError> {
        let body = serde_json::to_vec(&RecordBody {
            key: key.to_owned(),
            value: value.to_owned(),
            modified: modified.to_owned(),
        })
        .map_err(|_| ProfileDataError::Damaged)?;
        let nonce = random_array::<NONCE_LEN>();
        let cipher = seal(
            &self.record,
            &nonce,
            &body,
            &record_aad(&self.profile_id, &self.file_name(key)),
        )
        .map_err(|_| ProfileDataError::Damaged)?;
        let mut data = Vec::with_capacity(RECORD_HEADER_LEN + cipher.len());
        data.extend_from_slice(RECORD_MAGIC);
        data.push(FORMAT);
        data.extend_from_slice(&nonce);
        data.extend_from_slice(&cipher);
        Ok(data)
    }

    fn open_record(&self, file_name: &str, data: &[u8]) -> Result<Record, ProfileDataError> {
        if data.len() < RECORD_HEADER_LEN
            || &data[..RECORD_MAGIC.len()] != RECORD_MAGIC
            || data[RECORD_MAGIC.len()] != FORMAT
        {
            return Err(ProfileDataError::Damaged);
        }
        let plain = open(
            &self.record,
            &data[RECORD_MAGIC.len() + 1..RECORD_HEADER_LEN],
            &data[RECORD_HEADER_LEN..],
            &record_aad(&self.profile_id, file_name),
        )
        .ok_or(ProfileDataError::Damaged)?;
        let body: RecordBody =
            serde_json::from_slice(&plain).map_err(|_| ProfileDataError::Damaged)?;
        // Файл мусить лежати під назвою, яку дає його ключ: інакше це чужий запис.
        if self.file_name(&body.key) != file_name {
            return Err(ProfileDataError::Damaged);
        }
        Ok(Record {
            key: body.key,
            value: body.value,
            modified: body.modified,
        })
    }
}

#[derive(Serialize, Deserialize)]
struct Wrapped {
    nonce: String,
    wrapped: String,
}

#[derive(Serialize, Deserialize)]
struct KdfRecord {
    m: u32,
    t: u32,
    p: u32,
    salt: String,
}

#[derive(Serialize, Deserialize)]
struct Keyring {
    format: u8,
    kdf: KdfRecord,
    password: Wrapped,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    library: Option<Wrapped>,
}

fn from_hex(text: &str) -> Option<Vec<u8>> {
    if !text.len().is_multiple_of(2) {
        return None;
    }
    (0..text.len())
        .step_by(2)
        .map(|i| u8::from_str_radix(text.get(i..i + 2)?, 16).ok())
        .collect()
}

fn wrap(kek: &[u8; KEY_LEN], dek: &[u8; KEY_LEN], aad: &[u8]) -> Result<Wrapped, ProfileDataError> {
    let nonce = random_array::<NONCE_LEN>();
    let wrapped = seal(kek, &nonce, dek, aad).map_err(|_| ProfileDataError::InvalidKeyring)?;
    Ok(Wrapped {
        nonce: to_hex(&nonce),
        wrapped: to_hex(&wrapped),
    })
}

fn unwrap(kek: &[u8; KEY_LEN], slot: &Wrapped, aad: &[u8]) -> Option<Zeroizing<[u8; KEY_LEN]>> {
    let nonce = from_hex(&slot.nonce)?;
    let wrapped = from_hex(&slot.wrapped)?;
    let plain = open(kek, &nonce, &wrapped, aad)?;
    if plain.len() != KEY_LEN {
        return None;
    }
    let mut dek = Zeroizing::new([0u8; KEY_LEN]);
    dek.copy_from_slice(&plain);
    Some(dek)
}

fn kdf_of(record: &KdfRecord) -> KdfParams {
    KdfParams {
        m_kib: record.m,
        t: record.t,
        p: record.p,
    }
}

/// Сховище даних профілів: корінь `<app_local_data>/profile-data` і параметри Argon2id.
#[derive(Clone, Debug)]
pub struct ProfileDataStore {
    root: PathBuf,
    kdf: KdfParams,
}

impl ProfileDataStore {
    pub fn new(root: PathBuf) -> Self {
        Self {
            root,
            kdf: KdfParams::PRODUCTION,
        }
    }

    #[cfg(test)]
    pub(crate) fn with_kdf(root: PathBuf, kdf: KdfParams) -> Self {
        Self { root, kdf }
    }

    /// Тека профілю: `<root>/<profile_id>`.
    pub fn profile_dir(&self, profile_id: &str) -> Result<PathBuf, ProfileDataError> {
        if !valid_profile_id(profile_id) {
            return Err(ProfileDataError::ProfileNotFound);
        }
        Ok(self.root.join(profile_id))
    }

    fn keyring_path(&self, profile_id: &str) -> Result<PathBuf, ProfileDataError> {
        Ok(self.profile_dir(profile_id)?.join(KEYRING_FILE))
    }

    fn read_keyring(&self, profile_id: &str) -> Result<Option<Keyring>, ProfileDataError> {
        let path = self.keyring_path(profile_id)?;
        let text = match fs::read_to_string(&path) {
            Ok(text) => text,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(None),
            Err(error) => return Err(error.into()),
        };
        let keyring: Keyring =
            serde_json::from_str(&text).map_err(|_| ProfileDataError::InvalidKeyring)?;
        if keyring.format != FORMAT {
            return Err(ProfileDataError::InvalidKeyring);
        }
        Ok(Some(keyring))
    }

    fn write_keyring(&self, profile_id: &str, keyring: &Keyring) -> Result<(), ProfileDataError> {
        let dir = self.profile_dir(profile_id)?;
        fs::create_dir_all(&dir)?;
        let text =
            serde_json::to_vec_pretty(keyring).map_err(|_| ProfileDataError::InvalidKeyring)?;
        let target = SaveTarget {
            path: dir.join(KEYRING_FILE),
            replace_confirmed: true,
        };
        save_file(&target, &text).map_err(|error| ProfileDataError::Io(error.to_string()))
    }

    /// Чи є вже ключі даних цього профілю.
    pub fn exists(&self, profile_id: &str) -> Result<bool, ProfileDataError> {
        Ok(self.read_keyring(profile_id)?.is_some())
    }

    /// Розгортає ключ даних паролем профілю (профіль без пароля — порожнім). Якщо ключів
    /// ще немає — створює їх. Наявні ключі, які не розгортаються, **ніколи** не замінюються:
    /// повертається [`ProfileDataError::WrongKey`], а дані лишаються недоторканими.
    /// Повільний KDF іде в пул блокувальних задач.
    pub async fn unlock(
        &self,
        profile_id: &str,
        password: &str,
    ) -> Result<DataKeys, ProfileDataError> {
        let store = self.clone();
        let profile_id = profile_id.to_owned();
        let password = Zeroizing::new(password.as_bytes().to_vec());
        tokio::task::spawn_blocking(move || store.unlock_blocking(&profile_id, &password))
            .await
            .map_err(|_| ProfileDataError::InvalidKeyring)?
    }

    fn unlock_blocking(
        &self,
        profile_id: &str,
        password: &[u8],
    ) -> Result<DataKeys, ProfileDataError> {
        match self.read_keyring(profile_id)? {
            Some(keyring) => {
                let salt = from_hex(&keyring.kdf.salt).ok_or(ProfileDataError::InvalidKeyring)?;
                let kek = derive_kek(password, &salt, kdf_of(&keyring.kdf))
                    .map_err(|_| ProfileDataError::InvalidKeyring)?;
                let dek = unwrap(
                    &kek,
                    &keyring.password,
                    &keyring_aad(profile_id, "password"),
                )
                .ok_or(ProfileDataError::WrongKey)?;
                Ok(DataKeys::derive(profile_id, &dek))
            }
            None => {
                let dek = random_key();
                self.write_password_slot(profile_id, password, &dek, None)?;
                Ok(DataKeys::derive(profile_id, &dek))
            }
        }
    }

    /// Записує keyring з новим слотом пароля (нова сіль) і, якщо задано, збереженим запасним.
    fn write_password_slot(
        &self,
        profile_id: &str,
        password: &[u8],
        dek: &[u8; KEY_LEN],
        library: Option<Wrapped>,
    ) -> Result<(), ProfileDataError> {
        let salt = random_array::<SALT_LEN>();
        let kek =
            derive_kek(password, &salt, self.kdf).map_err(|_| ProfileDataError::InvalidKeyring)?;
        let password_slot = wrap(&kek, dek, &keyring_aad(profile_id, "password"))?;
        self.write_keyring(
            profile_id,
            &Keyring {
                format: FORMAT,
                kdf: KdfRecord {
                    m: self.kdf.m_kib,
                    t: self.kdf.t,
                    p: self.kdf.p,
                    salt: to_hex(&salt),
                },
                password: password_slot,
                library,
            },
        )
    }

    /// Зміна пароля профілю: ключ даних загортається новим паролем (нова сіль); запасний
    /// слот лишається. Дані записів не чіпаються.
    pub async fn rewrap_password(
        &self,
        keys: &DataKeys,
        new_password: &str,
    ) -> Result<(), ProfileDataError> {
        let store = self.clone();
        let profile_id = keys.profile_id.clone();
        let dek = Zeroizing::new(*keys.dek);
        let password = Zeroizing::new(new_password.as_bytes().to_vec());
        tokio::task::spawn_blocking(move || {
            let library = store
                .read_keyring(&profile_id)?
                .and_then(|ring| ring.library);
            store.write_password_slot(&profile_id, &password, &dek, library)
        })
        .await
        .map_err(|_| ProfileDataError::InvalidKeyring)?
    }

    /// Запасний слот: ключ даних, загорнутий ключем бібліотеки. Викликається, коли
    /// бібліотека розблокована; повторний виклик замінює слот.
    pub fn attach_library_slot(
        &self,
        keys: &DataKeys,
        wrap_key: &[u8; KEY_LEN],
    ) -> Result<(), ProfileDataError> {
        let Some(mut keyring) = self.read_keyring(&keys.profile_id)? else {
            return Ok(());
        };
        keyring.library = Some(wrap(
            wrap_key,
            &keys.dek,
            &keyring_aad(&keys.profile_id, "library"),
        )?);
        self.write_keyring(&keys.profile_id, &keyring)
    }

    /// Відновлення після нового пароля, встановленого кодом бібліотеки: ключ даних
    /// розгортається запасним слотом і загортається новим паролем. `Ok(None)` — запасного
    /// слота немає (дані без бібліотеки відновити неможливо).
    pub async fn recover_with_library(
        &self,
        profile_id: &str,
        wrap_key: &[u8; KEY_LEN],
        new_password: &str,
    ) -> Result<Option<DataKeys>, ProfileDataError> {
        let store = self.clone();
        let profile_id = profile_id.to_owned();
        let wrap_key = Zeroizing::new(*wrap_key);
        let password = Zeroizing::new(new_password.as_bytes().to_vec());
        tokio::task::spawn_blocking(move || {
            let Some(keyring) = store.read_keyring(&profile_id)? else {
                return Ok(None);
            };
            let Some(slot) = keyring.library.as_ref() else {
                return Ok(None);
            };
            let Some(dek) = unwrap(&wrap_key, slot, &keyring_aad(&profile_id, "library")) else {
                return Ok(None);
            };
            let library = keyring.library;
            store.write_password_slot(&profile_id, &password, &dek, library)?;
            Ok(Some(DataKeys::derive(&profile_id, &dek)))
        })
        .await
        .map_err(|_| ProfileDataError::InvalidKeyring)?
    }

    fn record_path(&self, keys: &DataKeys, key: &str) -> Result<PathBuf, ProfileDataError> {
        Ok(self
            .profile_dir(&keys.profile_id)?
            .join(keys.file_name(key)))
    }

    /// Запис за ключем; `None` — його немає.
    pub fn get(&self, keys: &DataKeys, key: &str) -> Result<Option<Record>, ProfileDataError> {
        validate_key(key)?;
        let path = self.record_path(keys, key)?;
        let data = match fs::read(&path) {
            Ok(data) => data,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(None),
            Err(error) => return Err(error.into()),
        };
        let name = keys.file_name(key);
        let record = keys.open_record(&name, &data)?;
        if record.key != key {
            return Err(ProfileDataError::Damaged);
        }
        Ok(Some(record))
    }

    /// Записує значення (атомарно). → час запису (RFC 3339, UTC).
    pub fn set(&self, keys: &DataKeys, key: &str, value: &str) -> Result<String, ProfileDataError> {
        validate_key(key)?;
        if value.is_empty() || value.len() > max_value_bytes(key) {
            return Err(ProfileDataError::InvalidValue);
        }
        let dir = self.profile_dir(&keys.profile_id)?;
        fs::create_dir_all(&dir)?;
        let path = self.record_path(keys, key)?;
        if !path.exists() && self.count(&dir)? >= MAX_RECORDS {
            return Err(ProfileDataError::TooManyRecords);
        }
        let modified = Utc::now().to_rfc3339_opts(SecondsFormat::Millis, true);
        self.write_record(keys, key, value, &modified)?;
        Ok(modified)
    }

    /// Те саме, що [`set`](Self::set), але з готовим часом запису (відновлення з копії).
    fn set_at(
        &self,
        keys: &DataKeys,
        key: &str,
        value: &str,
        modified: &str,
    ) -> Result<(), ProfileDataError> {
        validate_key(key)?;
        if value.is_empty() || value.len() > max_value_bytes(key) {
            return Err(ProfileDataError::InvalidValue);
        }
        let dir = self.profile_dir(&keys.profile_id)?;
        fs::create_dir_all(&dir)?;
        let path = self.record_path(keys, key)?;
        if !path.exists() && self.count(&dir)? >= MAX_RECORDS {
            return Err(ProfileDataError::TooManyRecords);
        }
        self.write_record(keys, key, value, modified)
    }

    fn write_record(
        &self,
        keys: &DataKeys,
        key: &str,
        value: &str,
        modified: &str,
    ) -> Result<(), ProfileDataError> {
        let path = self.record_path(keys, key)?;
        let data = keys.seal_record(key, value, modified)?;
        let target = SaveTarget {
            path,
            replace_confirmed: true,
        };
        save_file(&target, &data).map_err(|error| ProfileDataError::Io(error.to_string()))
    }

    /// Видаляє запис. → `true`, якщо він був.
    pub fn remove(&self, keys: &DataKeys, key: &str) -> Result<bool, ProfileDataError> {
        validate_key(key)?;
        match fs::remove_file(self.record_path(keys, key)?) {
            Ok(()) => Ok(true),
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(false),
            Err(error) => Err(error.into()),
        }
    }

    fn count(&self, dir: &Path) -> Result<usize, ProfileDataError> {
        Ok(self.record_files(dir)?.len())
    }

    fn record_files(&self, dir: &Path) -> Result<Vec<PathBuf>, ProfileDataError> {
        let entries = match fs::read_dir(dir) {
            Ok(entries) => entries,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(Vec::new()),
            Err(error) => return Err(error.into()),
        };
        let mut files = Vec::new();
        for entry in entries {
            let path = entry?.path();
            let is_record = path.extension().and_then(|e| e.to_str()) == Some(RECORD_EXT)
                && fs::symlink_metadata(&path).is_ok_and(|m| m.is_file());
            if is_record {
                files.push(path);
            }
        }
        Ok(files)
    }

    /// Записи (без значень) із префіксом `prefix` (`""` — усі, `простір.` — один простір імен),
    /// за ключем. Пошкоджені файли пропускаються: список лишається корисним.
    pub fn list(&self, keys: &DataKeys, prefix: &str) -> Result<Vec<RecordInfo>, ProfileDataError> {
        validate_prefix(prefix)?;
        // «easyfly» без крапки не має захоплювати «easyflyx.*»: простір імен завжди з крапкою.
        let prefix = if prefix.is_empty() || prefix.ends_with('.') {
            prefix.to_owned()
        } else {
            format!("{prefix}.")
        };
        let dir = self.profile_dir(&keys.profile_id)?;
        let mut items = Vec::new();
        for path in self.record_files(&dir)? {
            let Some(name) = path.file_name().and_then(|n| n.to_str()) else {
                continue;
            };
            let Ok(data) = fs::read(&path) else { continue };
            let Ok(record) = keys.open_record(name, &data) else {
                continue;
            };
            if record.key.starts_with(&prefix) {
                items.push(RecordInfo {
                    size: record.value.len(),
                    key: record.key,
                    modified: record.modified,
                });
            }
        }
        items.sort_by(|a, b| a.key.cmp(&b.key));
        Ok(items)
    }

    /// Видаляє всі дані профілю (його теку) — під час видалення профілю.
    pub fn delete_profile(&self, profile_id: &str) -> Result<(), ProfileDataError> {
        let dir = self.profile_dir(profile_id)?;
        match fs::remove_dir_all(&dir) {
            Ok(()) => Ok(()),
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
            Err(error) => Err(error.into()),
        }
    }
}

/// Стан сеансу даних профілю.
#[derive(Default)]
struct SessionState {
    keys: Option<Arc<DataKeys>>,
    /// Чому ключі не розгорнуто під час входу (щоб показати користувачу).
    error: Option<String>,
}

/// Розгорнуті ключі даних поточного профілю (стан Tauri): щонайбільше одного профілю.
#[derive(Default)]
pub struct ProfileDataSession {
    state: Mutex<SessionState>,
}

impl ProfileDataSession {
    fn guard(&self) -> MutexGuard<'_, SessionState> {
        self.state
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
    }

    /// Ставить ключі профілю (попередні знищуються).
    pub fn set(&self, keys: DataKeys) {
        let mut state = self.guard();
        state.keys = Some(Arc::new(keys));
        state.error = None;
    }

    /// Вхід відбувся, але ключі не розгорнуто: запам'ятовує причину.
    pub fn fail(&self, error: &ProfileDataError) {
        let mut state = self.guard();
        state.keys = None;
        state.error = Some(error.to_string());
    }

    /// Вихід із профілю або перехід в інший: ключі знищуються.
    pub fn clear(&self) {
        let mut state = self.guard();
        state.keys = None;
        state.error = None;
    }

    pub fn unlocked_profile(&self) -> Option<String> {
        self.guard()
            .keys
            .as_ref()
            .map(|keys| keys.profile_id.clone())
    }

    pub fn error(&self) -> Option<String> {
        self.guard().error.clone()
    }

    /// Ключі профілю `profile_id`; інакше [`ProfileDataError::Locked`].
    pub fn keys(&self, profile_id: &str) -> Result<Arc<DataKeys>, ProfileDataError> {
        match self.guard().keys.as_ref() {
            Some(keys) if keys.profile_id == profile_id => Ok(Arc::clone(keys)),
            _ => Err(ProfileDataError::Locked),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const PROFILE: &str = "profile-0123456789abcdef01234567";
    const OTHER: &str = "profile-fedcba9876543210fedcba98";

    fn store(dir: &tempfile::TempDir) -> ProfileDataStore {
        ProfileDataStore::with_kdf(dir.path().join(ROOT_DIR_NAME), KdfParams::FOR_TESTS)
    }

    async fn unlocked(store: &ProfileDataStore, password: &str) -> DataKeys {
        store.unlock(PROFILE, password).await.unwrap()
    }

    #[test]
    fn keys_are_validated() {
        for good in [
            "easyfly.main",
            "workspace.sun",
            "rocket.firecrews",
            "a.b-c_d.e",
            "x.1",
        ] {
            assert_eq!(validate_key(good), Ok(good), "{good}");
        }
        for bad in [
            "",
            "easyfly",
            "easyfly.",
            ".main",
            "Easyfly.main",
            "easyfly main",
            "easyfly/main",
            "easyfly..",
            "-a.b",
            "easyfly.Головне",
            "../x.y",
        ] {
            assert_eq!(
                validate_key(bad),
                Err(ProfileDataError::InvalidKey),
                "{bad:?}"
            );
        }
        assert_eq!(
            validate_key(&format!("a.{}", "b".repeat(80))),
            Err(ProfileDataError::InvalidKey)
        );
        assert_eq!(namespace_of("easyfly.main.x"), "easyfly");
        assert!(validate_prefix("").is_ok());
        assert!(validate_prefix("easyfly.").is_ok());
        assert!(validate_prefix("easyfly").is_ok());
        assert!(validate_prefix("../").is_err());
        assert!(validate_prefix("A.").is_err());
    }

    #[tokio::test]
    async fn first_unlock_creates_keys_and_records_round_trip() {
        let temp = tempfile::tempdir().unwrap();
        let store = store(&temp);
        let keys = unlocked(&store, "секрет").await;
        assert!(store.exists(PROFILE).unwrap());
        assert_eq!(store.get(&keys, "easyfly.main").unwrap(), None);

        let value = r#"{"v":1,"pilots":[{"name":"Тестовий Пілот"}]}"#;
        let modified = store.set(&keys, "easyfly.main", value).unwrap();
        let record = store.get(&keys, "easyfly.main").unwrap().unwrap();
        assert_eq!(record.value, value);
        assert_eq!(record.key, "easyfly.main");
        assert_eq!(record.modified, modified);

        // нове входження тим самим паролем бачить ті самі дані
        let again = unlocked(&store, "секрет").await;
        assert_eq!(
            store.get(&again, "easyfly.main").unwrap().unwrap().value,
            value
        );
    }

    #[tokio::test]
    async fn files_on_disk_are_ciphertext_with_hidden_names() {
        let temp = tempfile::tempdir().unwrap();
        let store = store(&temp);
        let keys = unlocked(&store, "секрет").await;
        store
            .set(&keys, "easyfly.main", "ТАЄМНЕ-ЗНАЧЕННЯ-123")
            .unwrap();
        let dir = store.profile_dir(PROFILE).unwrap();
        let mut seen = 0;
        for entry in fs::read_dir(&dir).unwrap() {
            let entry = entry.unwrap();
            let name = entry.file_name().to_string_lossy().into_owned();
            let bytes = fs::read(entry.path()).unwrap();
            let text = String::from_utf8_lossy(&bytes);
            assert!(!text.contains("ТАЄМНЕ-ЗНАЧЕННЯ-123"), "{name}");
            assert!(!name.contains("easyfly"), "{name}");
            if name != KEYRING_FILE {
                seen += 1;
                assert!(name.ends_with(".ewd") && name.len() == 36, "{name}");
                assert!(
                    !text.contains("easyfly.main"),
                    "ім'я ключа не лежить у відкритому вигляді"
                );
            } else {
                assert!(!text.contains("секрет"));
            }
        }
        assert_eq!(seen, 1);
    }

    #[tokio::test]
    async fn wrong_password_never_replaces_existing_keys() {
        let temp = tempfile::tempdir().unwrap();
        let store = store(&temp);
        let keys = unlocked(&store, "правильний").await;
        store.set(&keys, "weather.places", "[1]").unwrap();
        let keyring_before = fs::read(store.keyring_path(PROFILE).unwrap()).unwrap();

        let error = store.unlock(PROFILE, "інший").await.unwrap_err();
        assert_eq!(error, ProfileDataError::WrongKey);
        assert_eq!(
            fs::read(store.keyring_path(PROFILE).unwrap()).unwrap(),
            keyring_before
        );
        let again = unlocked(&store, "правильний").await;
        assert_eq!(
            store.get(&again, "weather.places").unwrap().unwrap().value,
            "[1]"
        );
    }

    #[tokio::test]
    async fn profiles_are_isolated_and_records_do_not_move_between_them() {
        let temp = tempfile::tempdir().unwrap();
        let store = store(&temp);
        let first = unlocked(&store, "a").await;
        let second = store.unlock(OTHER, "a").await.unwrap();
        store.set(&first, "sun.state", "перший").unwrap();
        assert_eq!(store.get(&second, "sun.state").unwrap(), None);

        // файл першого профілю, підкладений у теку другого, не розшифровується
        let name = first.file_name("sun.state");
        let from = store.profile_dir(PROFILE).unwrap().join(&name);
        let to = store
            .profile_dir(OTHER)
            .unwrap()
            .join(second.file_name("sun.state"));
        fs::copy(&from, &to).unwrap();
        assert_eq!(
            store.get(&second, "sun.state"),
            Err(ProfileDataError::Damaged)
        );
        // і навіть під «правильною» назвою ключ другого профілю не прочитає чужий шифротекст
        fs::copy(&from, store.profile_dir(OTHER).unwrap().join(&name)).unwrap();
        assert!(store.list(&second, "").unwrap().is_empty());
    }

    #[tokio::test]
    async fn tampered_and_swapped_records_are_rejected() {
        let temp = tempfile::tempdir().unwrap();
        let store = store(&temp);
        let keys = unlocked(&store, "x").await;
        store.set(&keys, "a.one", "перше").unwrap();
        store.set(&keys, "a.two", "друге").unwrap();
        let dir = store.profile_dir(PROFILE).unwrap();
        let one = dir.join(keys.file_name("a.one"));
        let two = dir.join(keys.file_name("a.two"));

        // підміна запису іншим: AAD містить назву файлу
        fs::copy(&two, &one).unwrap();
        assert_eq!(store.get(&keys, "a.one"), Err(ProfileDataError::Damaged));

        // зіпсований байт
        store.set(&keys, "a.one", "перше").unwrap();
        let mut bytes = fs::read(&one).unwrap();
        let last = bytes.len() - 1;
        bytes[last] ^= 0x01;
        fs::write(&one, bytes).unwrap();
        assert_eq!(store.get(&keys, "a.one"), Err(ProfileDataError::Damaged));
        // список пропускає пошкоджене
        let list = store.list(&keys, "").unwrap();
        assert_eq!(
            list.iter().map(|i| i.key.as_str()).collect::<Vec<_>>(),
            ["a.two"]
        );
    }

    #[tokio::test]
    async fn list_filters_by_namespace_and_remove_deletes() {
        let temp = tempfile::tempdir().unwrap();
        let store = store(&temp);
        let keys = unlocked(&store, "x").await;
        store.set(&keys, "easyfly.main", "1").unwrap();
        store.set(&keys, "easyfly.settings", "2").unwrap();
        store.set(&keys, "sun.state", "3").unwrap();
        let all = store.list(&keys, "").unwrap();
        assert_eq!(all.len(), 3);
        let fly = store.list(&keys, "easyfly.").unwrap();
        assert_eq!(
            fly.iter().map(|i| i.key.as_str()).collect::<Vec<_>>(),
            ["easyfly.main", "easyfly.settings"]
        );
        assert_eq!(fly[0].size, 1);
        // префікс без крапки не захоплює сусідній простір імен
        store.set(&keys, "easyflyx.other", "4").unwrap();
        let fly_no_dot = store.list(&keys, "easyfly").unwrap();
        assert_eq!(fly_no_dot.len(), 2);
        assert!(store.remove(&keys, "easyfly.main").unwrap());
        assert!(!store.remove(&keys, "easyfly.main").unwrap());
        assert_eq!(store.get(&keys, "easyfly.main").unwrap(), None);
    }

    #[tokio::test]
    async fn rejects_empty_oversized_values_and_too_many_records() {
        let temp = tempfile::tempdir().unwrap();
        let store = store(&temp);
        let keys = unlocked(&store, "x").await;
        assert_eq!(
            store.set(&keys, "a.b", ""),
            Err(ProfileDataError::InvalidValue)
        );
        assert_eq!(
            store.set(&keys, "a.b", &"x".repeat(MAX_VALUE_BYTES + 1)),
            Err(ProfileDataError::InvalidValue)
        );
        for index in 0..MAX_RECORDS {
            store.set(&keys, &format!("a.k{index}"), "1").unwrap();
        }
        assert_eq!(
            store.set(&keys, "a.extra", "1"),
            Err(ProfileDataError::TooManyRecords)
        );
        // наявний запис можна перезаписати і на межі
        store.set(&keys, "a.k0", "2").unwrap();
    }

    #[tokio::test]
    async fn password_change_rewraps_without_touching_records() {
        let temp = tempfile::tempdir().unwrap();
        let store = store(&temp);
        let keys = unlocked(&store, "старий").await;
        store.set(&keys, "easyfly.main", "дані").unwrap();
        let record_path = store.record_path(&keys, "easyfly.main").unwrap();
        let record_before = fs::read(&record_path).unwrap();

        store.rewrap_password(&keys, "новий").await.unwrap();
        assert_eq!(fs::read(&record_path).unwrap(), record_before);
        assert_eq!(
            store.unlock(PROFILE, "старий").await.unwrap_err(),
            ProfileDataError::WrongKey
        );
        let fresh = unlocked(&store, "новий").await;
        assert_eq!(
            store.get(&fresh, "easyfly.main").unwrap().unwrap().value,
            "дані"
        );
    }

    #[tokio::test]
    async fn passwordless_profile_uses_empty_password_and_can_gain_one() {
        let temp = tempfile::tempdir().unwrap();
        let store = store(&temp);
        let keys = unlocked(&store, "").await;
        store.set(&keys, "sun.state", "S").unwrap();
        store.rewrap_password(&keys, "щойно-заданий").await.unwrap();
        assert_eq!(
            store.unlock(PROFILE, "").await.unwrap_err(),
            ProfileDataError::WrongKey
        );
        let with_password = unlocked(&store, "щойно-заданий").await;
        assert_eq!(
            store
                .get(&with_password, "sun.state")
                .unwrap()
                .unwrap()
                .value,
            "S"
        );
        // пароль знято — знову порожній
        store.rewrap_password(&with_password, "").await.unwrap();
        let empty = unlocked(&store, "").await;
        assert_eq!(store.get(&empty, "sun.state").unwrap().unwrap().value, "S");
    }

    #[tokio::test]
    async fn library_slot_recovers_data_after_forgotten_password() {
        let temp = tempfile::tempdir().unwrap();
        let store = store(&temp);
        let keys = unlocked(&store, "забутий").await;
        store.set(&keys, "easyfly.main", "льотні дані").unwrap();
        let library_key = [9u8; KEY_LEN];

        // без запасного слота відновити нічого
        assert!(store
            .recover_with_library(PROFILE, &library_key, "новий")
            .await
            .unwrap()
            .is_none());

        store.attach_library_slot(&keys, &library_key).unwrap();
        // слот переживає зміну пароля
        store.rewrap_password(&keys, "забутий-2").await.unwrap();
        // чужий ключ бібліотеки нічого не розгортає
        assert!(store
            .recover_with_library(PROFILE, &[1u8; KEY_LEN], "x")
            .await
            .unwrap()
            .is_none());
        assert_eq!(
            store.unlock(PROFILE, "x").await.unwrap_err(),
            ProfileDataError::WrongKey
        );

        let recovered = store
            .recover_with_library(PROFILE, &library_key, "після-відновлення")
            .await
            .unwrap()
            .unwrap();
        assert_eq!(
            store
                .get(&recovered, "easyfly.main")
                .unwrap()
                .unwrap()
                .value,
            "льотні дані"
        );
        assert_eq!(
            store.unlock(PROFILE, "забутий-2").await.unwrap_err(),
            ProfileDataError::WrongKey
        );
        let fresh = unlocked(&store, "після-відновлення").await;
        assert_eq!(
            store.get(&fresh, "easyfly.main").unwrap().unwrap().value,
            "льотні дані"
        );
    }

    #[tokio::test]
    async fn damaged_keyring_is_reported_not_replaced() {
        let temp = tempfile::tempdir().unwrap();
        let store = store(&temp);
        unlocked(&store, "x").await;
        let path = store.keyring_path(PROFILE).unwrap();
        fs::write(&path, b"{ not json").unwrap();
        assert_eq!(
            store.unlock(PROFILE, "x").await.unwrap_err(),
            ProfileDataError::InvalidKeyring
        );
        assert_eq!(fs::read(&path).unwrap(), b"{ not json");
    }

    #[tokio::test]
    async fn invalid_profile_ids_are_refused() {
        let temp = tempfile::tempdir().unwrap();
        let store = store(&temp);
        for bad in [
            "",
            "..",
            "../x",
            "profile-xyz",
            "profile-0123456789ABCDEF01234567",
        ] {
            assert_eq!(
                store.unlock(bad, "x").await.unwrap_err(),
                ProfileDataError::ProfileNotFound,
                "{bad:?}"
            );
        }
    }

    #[tokio::test]
    async fn delete_profile_removes_directory() {
        let temp = tempfile::tempdir().unwrap();
        let store = store(&temp);
        let keys = unlocked(&store, "x").await;
        store.set(&keys, "a.b", "1").unwrap();
        store.delete_profile(PROFILE).unwrap();
        assert!(!store.profile_dir(PROFILE).unwrap().exists());
        store.delete_profile(PROFILE).unwrap(); // повторне видалення — не помилка
    }

    #[test]
    fn session_holds_keys_for_one_profile_only() {
        let session = ProfileDataSession::default();
        assert_eq!(session.keys(PROFILE).unwrap_err(), ProfileDataError::Locked);
        session.set(DataKeys::derive(PROFILE, &[3u8; KEY_LEN]));
        assert_eq!(session.unlocked_profile().as_deref(), Some(PROFILE));
        assert!(session.keys(PROFILE).is_ok());
        assert_eq!(session.keys(OTHER).unwrap_err(), ProfileDataError::Locked);
        session.fail(&ProfileDataError::WrongKey);
        assert!(session.keys(PROFILE).is_err());
        assert!(session.error().unwrap().contains("іншим"));
        session.set(DataKeys::derive(OTHER, &[4u8; KEY_LEN]));
        assert_eq!(session.error(), None);
        session.clear();
        assert_eq!(session.unlocked_profile(), None);
    }
}
