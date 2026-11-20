//! Сховище секретів профілю (варіант Ф, JE-18): один зашифрований файл на профіль за зразком
//! бібліотеки «Офісу» — майстер-ключ під обгорткою Argon2id від пароля профілю (і окремою
//! обгорткою під ключем відновлення), записи під підключами HKDF з мітками
//! `easywar/collective/v1/*`. JS ніколи не бачить секрет — лише статус.
//!
//! Перевірки JE-18, закриті тестами нижче: зміна пароля (майстер-ключ і всі записи
//! перешифровуються — C05 бібліотеки тут не повторюється), відновлення ключем відновлення,
//! ізоляція профілів (ідентифікатор профілю в AAD і в HKDF-salt: файл іншого профілю не
//! відкривається), знищення (`zeroize` + видалення файла), аварія під час запису
//! (атомарний запис через тимчасовий файл + rename: старий файл лишається цілим).

use std::collections::BTreeMap;
use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};

use chacha20poly1305::aead::{Aead, KeyInit, Payload};
use chacha20poly1305::{Key, XChaCha20Poly1305, XNonce};
use zeroize::{Zeroize, Zeroizing};

use super::codec::{Reader, Writer};
use super::{hkdf, labels, random_array, Reason, KEY_LEN, NONCE_LEN, TAG_LEN};
use crate::office_library::KdfParams;

const MAGIC: &[u8; 4] = b"EWCS";
const FORMAT: u8 = 1;
const SALT_LEN: usize = 16;
const TMP_SUFFIX: &str = "tmp";

/// Помилки сховища; назовні (C3b) — лише статус, без подробиць.
#[derive(Debug)]
pub enum StoreError {
    Io(std::io::Error),
    /// Файл не розбирається або має інший формат.
    Corrupt,
    /// Пароль чи ключ відновлення не підходить, або файл належить іншому профілю.
    WrongPassword,
    InvalidKdf,
}

impl std::fmt::Display for StoreError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            StoreError::Io(error) => write!(f, "помилка файла сховища: {error}"),
            StoreError::Corrupt => f.write_str("файл сховища пошкоджений"),
            StoreError::WrongPassword => f.write_str("пароль або ключ відновлення не підходить"),
            StoreError::InvalidKdf => f.write_str("недопустимі параметри Argon2"),
        }
    }
}

impl std::error::Error for StoreError {}

impl From<std::io::Error> for StoreError {
    fn from(error: std::io::Error) -> Self {
        StoreError::Io(error)
    }
}

impl From<Reason> for StoreError {
    fn from(_: Reason) -> Self {
        StoreError::Corrupt
    }
}

/// Ключ відновлення: 32 байти, показуються власникові один раз при створенні чи ротації.
pub struct RecoveryKey(Zeroizing<[u8; KEY_LEN]>);

impl RecoveryKey {
    pub fn from_bytes(bytes: [u8; KEY_LEN]) -> Self {
        Self(Zeroizing::new(bytes))
    }

    pub fn as_bytes(&self) -> &[u8; KEY_LEN] {
        &self.0
    }
}

impl std::fmt::Debug for RecoveryKey {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("RecoveryKey(<прихований>)")
    }
}

/// Стан сховища для інтерфейсу (без секретів).
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum StoreStatus {
    /// Файла немає — колектив для профілю ще не створено.
    Absent,
    /// Файл є, потрібен пароль профілю.
    Locked,
    Corrupt,
}

#[derive(Clone)]
struct Slot {
    salt: [u8; SALT_LEN],
    nonce: [u8; NONCE_LEN],
    wrapped: [u8; KEY_LEN + TAG_LEN],
}

/// Шлях і профіль сховища; розблокування дає [`UnlockedStore`].
#[derive(Clone, Debug)]
pub struct SecretStore {
    path: PathBuf,
    profile_id: String,
}

/// Розблоковане сховище. Майстер-ключ затирається при знищенні.
pub struct UnlockedStore {
    store: SecretStore,
    params: KdfParams,
    master: Zeroizing<[u8; KEY_LEN]>,
    password_slot: Slot,
    recovery_slot: Option<Slot>,
    entries: BTreeMap<String, ([u8; NONCE_LEN], Vec<u8>)>,
}

impl SecretStore {
    pub fn new(path: impl Into<PathBuf>, profile_id: impl Into<String>) -> Self {
        Self {
            path: path.into(),
            profile_id: profile_id.into(),
        }
    }

    pub fn path(&self) -> &Path {
        &self.path
    }

    pub fn status(&self) -> StoreStatus {
        match fs::read(&self.path) {
            Err(_) => StoreStatus::Absent,
            Ok(bytes) => match parse(&bytes) {
                Ok(_) => StoreStatus::Locked,
                Err(_) => StoreStatus::Corrupt,
            },
        }
    }

    /// Нове сховище з випадковим майстер-ключем; повертає ключ відновлення (один раз).
    pub fn create(
        &self,
        password: &[u8],
        params: KdfParams,
    ) -> Result<(UnlockedStore, RecoveryKey), StoreError> {
        let master = Zeroizing::new(random_array::<KEY_LEN>());
        let recovery = RecoveryKey::from_bytes(random_array());
        let password_slot = password_slot(&master, password, &self.profile_id, params)?;
        let recovery_slot = recovery_slot(&master, &recovery, &self.profile_id, params)?;
        let unlocked = UnlockedStore {
            store: self.clone(),
            params,
            master,
            password_slot,
            recovery_slot: Some(recovery_slot),
            entries: BTreeMap::new(),
        };
        unlocked.persist()?;
        Ok((unlocked, recovery))
    }

    pub fn unlock(&self, password: &[u8]) -> Result<UnlockedStore, StoreError> {
        let file = parse(&fs::read(&self.path)?)?;
        let kek = derive_password_kek(password, file.params, &file.password_slot.salt)?;
        let master = unwrap_master(
            &file.password_slot,
            &kek,
            &self.profile_id,
            "password",
            file.params,
        )?;
        Ok(self.unlocked(file, master))
    }

    pub fn unlock_with_recovery(
        &self,
        recovery: &RecoveryKey,
    ) -> Result<UnlockedStore, StoreError> {
        let file = parse(&fs::read(&self.path)?)?;
        let slot = file
            .recovery_slot
            .clone()
            .ok_or(StoreError::WrongPassword)?;
        let kek = derive_recovery_kek(recovery, &slot.salt);
        let master = unwrap_master(&slot, &kek, &self.profile_id, "recovery", file.params)?;
        Ok(self.unlocked(file, master))
    }

    fn unlocked(&self, file: FileImage, master: Zeroizing<[u8; KEY_LEN]>) -> UnlockedStore {
        UnlockedStore {
            store: self.clone(),
            params: file.params,
            master,
            password_slot: file.password_slot,
            recovery_slot: file.recovery_slot,
            entries: file.entries,
        }
    }
}

impl UnlockedStore {
    pub fn purposes(&self) -> impl Iterator<Item = &str> {
        self.entries.keys().map(String::as_str)
    }

    /// Секрет за міткою призначення (`collective/member-sign`, `collective/epoch/<id>/<n>` …).
    pub fn read(&self, purpose: &str) -> Result<Option<Zeroizing<Vec<u8>>>, StoreError> {
        let Some((nonce, ciphertext)) = self.entries.get(purpose) else {
            return Ok(None);
        };
        let key = self.entry_key(purpose);
        let plain = XChaCha20Poly1305::new(&Key::from(*key))
            .decrypt(
                &XNonce::from(*nonce),
                Payload {
                    msg: ciphertext,
                    aad: &entry_aad(&self.store.profile_id, purpose),
                },
            )
            .map_err(|_| StoreError::Corrupt)?;
        Ok(Some(Zeroizing::new(plain)))
    }

    pub fn write(&mut self, purpose: &str, secret: &[u8]) -> Result<(), StoreError> {
        let entry = self.encrypt_entry(purpose, secret)?;
        self.entries.insert(purpose.to_string(), entry);
        self.persist()
    }

    fn encrypt_entry(
        &self,
        purpose: &str,
        secret: &[u8],
    ) -> Result<([u8; NONCE_LEN], Vec<u8>), StoreError> {
        let nonce = random_array::<NONCE_LEN>();
        let key = self.entry_key(purpose);
        let ciphertext = XChaCha20Poly1305::new(&Key::from(*key))
            .encrypt(
                &XNonce::from(nonce),
                Payload {
                    msg: secret,
                    aad: &entry_aad(&self.store.profile_id, purpose),
                },
            )
            .map_err(|_| StoreError::Corrupt)?;
        Ok((nonce, ciphertext))
    }

    /// Кілька записів одним збереженням файлу: або всі нові записи на диску, або жодного
    /// (файл замінюється атомарно, `persist`). Якщо шифрування будь-якого запису не вдалося,
    /// сховище в пам'яті лишається без змін.
    pub fn write_many(&mut self, entries: &[(String, &[u8])]) -> Result<(), StoreError> {
        let mut encrypted = Vec::with_capacity(entries.len());
        for (purpose, secret) in entries {
            encrypted.push((purpose.clone(), self.encrypt_entry(purpose, secret)?));
        }
        let previous: Vec<_> = encrypted
            .iter()
            .map(|(purpose, _)| (purpose.clone(), self.entries.get(purpose).cloned()))
            .collect();
        self.entries.extend(encrypted);
        if let Err(error) = self.persist() {
            for (purpose, entry) in previous {
                match entry {
                    Some(entry) => self.entries.insert(purpose, entry),
                    None => self.entries.remove(&purpose),
                };
            }
            return Err(error);
        }
        Ok(())
    }

    /// Видалення кількох записів одним збереженням файлу; повертає, скільки було видалено.
    pub fn delete_many(&mut self, purposes: &[String]) -> Result<usize, StoreError> {
        let removed: Vec<_> = purposes
            .iter()
            .filter_map(|purpose| {
                self.entries
                    .remove(purpose)
                    .map(|entry| (purpose.clone(), entry))
            })
            .collect();
        if removed.is_empty() {
            return Ok(0);
        }
        if let Err(error) = self.persist() {
            self.entries.extend(removed);
            return Err(error);
        }
        Ok(removed.len())
    }

    pub fn delete(&mut self, purpose: &str) -> Result<bool, StoreError> {
        let removed = self.entries.remove(purpose).is_some();
        if removed {
            self.persist()?;
        }
        Ok(removed)
    }

    /// Зміна пароля: новий майстер-ключ, усі записи перешифровано, обидві обгортки
    /// перевипущено. Старий пароль і старий ключ відновлення після цього не відкривають
    /// нічого (C05 бібліотеки тут не повторюється); новий ключ відновлення повертається
    /// один раз — його треба показати власникові.
    pub fn change_password(&mut self, new_password: &[u8]) -> Result<RecoveryKey, StoreError> {
        let plain: Vec<(String, Zeroizing<Vec<u8>>)> = self
            .entries
            .keys()
            .cloned()
            .map(|purpose| {
                let value = self.read(&purpose)?.ok_or(StoreError::Corrupt)?;
                Ok((purpose, value))
            })
            .collect::<Result<_, StoreError>>()?;
        self.master = Zeroizing::new(random_array());
        let recovery = RecoveryKey::from_bytes(random_array());
        self.password_slot = password_slot(
            &self.master,
            new_password,
            &self.store.profile_id,
            self.params,
        )?;
        self.recovery_slot = Some(recovery_slot(
            &self.master,
            &recovery,
            &self.store.profile_id,
            self.params,
        )?);
        self.entries.clear();
        for (purpose, value) in plain {
            self.entries
                .insert(purpose.clone(), self.encrypt_entry(&purpose, &value)?);
        }
        self.persist()?;
        Ok(recovery)
    }

    /// Новий ключ відновлення для поточного майстер-ключа (після зміни пароля — обов'язково).
    pub fn rotate_recovery(&mut self) -> Result<RecoveryKey, StoreError> {
        let recovery = RecoveryKey::from_bytes(random_array());
        self.recovery_slot = Some(recovery_slot(
            &self.master,
            &recovery,
            &self.store.profile_id,
            self.params,
        )?);
        self.persist()?;
        Ok(recovery)
    }

    pub fn has_recovery(&self) -> bool {
        self.recovery_slot.is_some()
    }

    /// Знищення: записи й майстер-ключ затираються в пам'яті, файл видаляється.
    pub fn destroy(mut self) -> Result<(), StoreError> {
        self.master.zeroize();
        self.entries.clear();
        let _ = fs::remove_file(tmp_path(&self.store.path));
        match fs::remove_file(&self.store.path) {
            Ok(()) => Ok(()),
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
            Err(error) => Err(error.into()),
        }
    }

    fn entry_key(&self, purpose: &str) -> Zeroizing<[u8; KEY_LEN]> {
        let mut info = Vec::with_capacity(labels::SECRET_ENTRY.len() + 1 + purpose.len());
        info.extend_from_slice(labels::SECRET_ENTRY);
        info.push(0);
        info.extend_from_slice(purpose.as_bytes());
        hkdf(&self.master[..], self.store.profile_id.as_bytes(), &info)
    }

    /// Атомарний запис: тимчасовий файл → fsync → rename. Аварія до rename лишає старий
    /// файл цілим; залишений тимчасовий файл ігнорується й перезаписується.
    fn persist(&self) -> Result<(), StoreError> {
        let bytes = self.encode();
        let tmp = tmp_path(&self.store.path);
        {
            let mut file = fs::File::create(&tmp)?;
            file.write_all(&bytes)?;
            file.sync_all()?;
        }
        fs::rename(&tmp, &self.store.path)?;
        Ok(())
    }

    fn encode(&self) -> Vec<u8> {
        let mut w = Writer::with_capacity(256);
        w.fixed(MAGIC)
            .u8(FORMAT)
            .u32(self.params.m_kib)
            .u32(self.params.t)
            .u32(self.params.p);
        write_slot(&mut w, &self.password_slot);
        match &self.recovery_slot {
            None => {
                w.u8(0);
            }
            Some(slot) => {
                w.u8(1);
                write_slot(&mut w, slot);
            }
        }
        w.u32(self.entries.len() as u32);
        for (purpose, (nonce, ciphertext)) in &self.entries {
            w.var(purpose.as_bytes()).fixed(nonce).var(ciphertext);
        }
        w.finish()
    }
}

impl std::fmt::Debug for UnlockedStore {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("UnlockedStore")
            .field("profile_id", &self.store.profile_id)
            .field("entries", &self.entries.len())
            .field("has_recovery", &self.recovery_slot.is_some())
            .finish_non_exhaustive()
    }
}

struct FileImage {
    params: KdfParams,
    password_slot: Slot,
    recovery_slot: Option<Slot>,
    entries: BTreeMap<String, ([u8; NONCE_LEN], Vec<u8>)>,
}

fn parse(bytes: &[u8]) -> Result<FileImage, StoreError> {
    let mut r = Reader::new(bytes);
    if r.fixed::<4>()? != *MAGIC || r.u8()? != FORMAT {
        return Err(StoreError::Corrupt);
    }
    let params = KdfParams {
        m_kib: r.u32()?,
        t: r.u32()?,
        p: r.u32()?,
    };
    let password_slot = read_slot(&mut r)?;
    let recovery_slot = match r.u8()? {
        0 => None,
        1 => Some(read_slot(&mut r)?),
        _ => return Err(StoreError::Corrupt),
    };
    let count = r.u32()?;
    let mut entries = BTreeMap::new();
    for _ in 0..count {
        let purpose = String::from_utf8(r.var()?.to_vec()).map_err(|_| StoreError::Corrupt)?;
        let nonce = r.fixed()?;
        let ciphertext = r.var()?.to_vec();
        if ciphertext.len() < TAG_LEN {
            return Err(StoreError::Corrupt);
        }
        entries.insert(purpose, (nonce, ciphertext));
    }
    r.finish()?;
    Ok(FileImage {
        params,
        password_slot,
        recovery_slot,
        entries,
    })
}

fn write_slot(w: &mut Writer, slot: &Slot) {
    w.fixed(&slot.salt).fixed(&slot.nonce).fixed(&slot.wrapped);
}

fn read_slot(r: &mut Reader<'_>) -> Result<Slot, StoreError> {
    Ok(Slot {
        salt: r.fixed()?,
        nonce: r.fixed()?,
        wrapped: r.fixed()?,
    })
}

pub(crate) fn tmp_path(path: &Path) -> PathBuf {
    let mut name = path
        .file_name()
        .map(|n| n.to_os_string())
        .unwrap_or_default();
    name.push(".");
    name.push(TMP_SUFFIX);
    path.with_file_name(name)
}

fn random_salt() -> [u8; SALT_LEN] {
    random_array()
}

fn keyring_aad(profile_id: &str, slot: &str, params: KdfParams) -> Vec<u8> {
    let mut aad = labels::SECRET_KEYRING.to_vec();
    aad.extend_from_slice(
        format!(
            "\0{profile_id}\0format={FORMAT}\0slot={slot}\0m={}\0t={}\0p={}",
            params.m_kib, params.t, params.p
        )
        .as_bytes(),
    );
    aad
}

fn entry_aad(profile_id: &str, purpose: &str) -> Vec<u8> {
    let mut aad = labels::SECRET_ENTRY.to_vec();
    aad.extend_from_slice(format!("\0{profile_id}\0{purpose}").as_bytes());
    aad
}

fn derive_password_kek(
    password: &[u8],
    params: KdfParams,
    salt: &[u8; SALT_LEN],
) -> Result<Zeroizing<[u8; KEY_LEN]>, StoreError> {
    let argon2 = params.argon2().map_err(|_| StoreError::InvalidKdf)?;
    let mut kek = Zeroizing::new([0u8; KEY_LEN]);
    argon2
        .hash_password_into(password, salt, &mut kek[..])
        .map_err(|_| StoreError::InvalidKdf)?;
    Ok(kek)
}

fn derive_recovery_kek(recovery: &RecoveryKey, salt: &[u8; SALT_LEN]) -> Zeroizing<[u8; KEY_LEN]> {
    let mut info = labels::SECRET_KEYRING.to_vec();
    info.extend_from_slice(b"/recovery");
    hkdf(recovery.as_bytes(), salt, &info)
}

fn password_slot(
    master: &[u8; KEY_LEN],
    password: &[u8],
    profile_id: &str,
    params: KdfParams,
) -> Result<Slot, StoreError> {
    let salt = random_salt();
    let kek = derive_password_kek(password, params, &salt)?;
    wrap_master(master, &kek, salt, profile_id, "password", params)
}

fn recovery_slot(
    master: &[u8; KEY_LEN],
    recovery: &RecoveryKey,
    profile_id: &str,
    params: KdfParams,
) -> Result<Slot, StoreError> {
    let salt = random_salt();
    let kek = derive_recovery_kek(recovery, &salt);
    wrap_master(master, &kek, salt, profile_id, "recovery", params)
}

fn wrap_master(
    master: &[u8; KEY_LEN],
    kek: &[u8; KEY_LEN],
    salt: [u8; SALT_LEN],
    profile_id: &str,
    slot_name: &str,
    params: KdfParams,
) -> Result<Slot, StoreError> {
    let nonce = random_array::<NONCE_LEN>();
    let wrapped = XChaCha20Poly1305::new(&Key::from(*kek))
        .encrypt(
            &XNonce::from(nonce),
            Payload {
                msg: master,
                aad: &keyring_aad(profile_id, slot_name, params),
            },
        )
        .map_err(|_| StoreError::Corrupt)?;
    Ok(Slot {
        salt,
        nonce,
        wrapped: wrapped
            .as_slice()
            .try_into()
            .map_err(|_| StoreError::Corrupt)?,
    })
}

fn unwrap_master(
    slot: &Slot,
    kek: &[u8; KEY_LEN],
    profile_id: &str,
    slot_name: &str,
    params: KdfParams,
) -> Result<Zeroizing<[u8; KEY_LEN]>, StoreError> {
    let plain = XChaCha20Poly1305::new(&Key::from(*kek))
        .decrypt(
            &XNonce::from(slot.nonce),
            Payload {
                msg: &slot.wrapped,
                aad: &keyring_aad(profile_id, slot_name, params),
            },
        )
        .map_err(|_| StoreError::WrongPassword)?;
    let plain = Zeroizing::new(plain);
    let master: [u8; KEY_LEN] = plain
        .as_slice()
        .try_into()
        .map_err(|_| StoreError::Corrupt)?;
    Ok(Zeroizing::new(master))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn store(dir: &tempfile::TempDir, profile: &str) -> SecretStore {
        SecretStore::new(dir.path().join(format!("{profile}.ewcs")), profile)
    }

    const P: KdfParams = KdfParams::FOR_TESTS;

    #[test]
    fn create_write_read_unlock_and_status() {
        let dir = tempfile::tempdir().unwrap();
        let store = store(&dir, "profile-a");
        assert_eq!(store.status(), StoreStatus::Absent);
        let (mut unlocked, _recovery) = store.create(b"pass-a", P).unwrap();
        unlocked.write("collective/member-sign", &[1; 32]).unwrap();
        unlocked.write("collective/epoch/abc/0", &[2; 32]).unwrap();
        drop(unlocked);
        assert_eq!(store.status(), StoreStatus::Locked);
        let again = store.unlock(b"pass-a").unwrap();
        assert_eq!(
            again
                .read("collective/member-sign")
                .unwrap()
                .unwrap()
                .as_slice(),
            &[1; 32]
        );
        assert_eq!(
            again
                .read("collective/epoch/abc/0")
                .unwrap()
                .unwrap()
                .as_slice(),
            &[2; 32]
        );
        assert!(again.read("collective/none").unwrap().is_none());
        assert_eq!(again.purposes().count(), 2);
        assert!(matches!(
            store.unlock(b"wrong").unwrap_err(),
            StoreError::WrongPassword
        ));
    }

    #[test]
    fn password_change_reencrypts_everything_and_reissues_recovery() {
        let dir = tempfile::tempdir().unwrap();
        let store = store(&dir, "profile-a");
        let (mut unlocked, old_recovery) = store.create(b"old", P).unwrap();
        unlocked
            .write("collective/member-x25519", &[3; 32])
            .unwrap();
        let before = fs::read(store.path()).unwrap();
        let new_recovery = unlocked.change_password(b"new").unwrap();
        let after = fs::read(store.path()).unwrap();
        assert_ne!(before, after);
        assert!(matches!(
            store.unlock(b"old").unwrap_err(),
            StoreError::WrongPassword
        ));
        assert!(matches!(
            store.unlock_with_recovery(&old_recovery).unwrap_err(),
            StoreError::WrongPassword
        ));
        let via_password = store.unlock(b"new").unwrap();
        assert_eq!(
            via_password
                .read("collective/member-x25519")
                .unwrap()
                .unwrap()
                .as_slice(),
            &[3; 32]
        );
        let via_recovery = store.unlock_with_recovery(&new_recovery).unwrap();
        assert_eq!(
            via_recovery
                .read("collective/member-x25519")
                .unwrap()
                .unwrap()
                .as_slice(),
            &[3; 32]
        );
        // Старий файл зі старим паролем більше не читається навіть як копія.
        fs::write(store.path(), &before).unwrap();
        assert!(matches!(
            store.unlock(b"new").unwrap_err(),
            StoreError::WrongPassword
        ));
    }

    #[test]
    fn recovery_key_opens_without_password_and_can_be_rotated() {
        let dir = tempfile::tempdir().unwrap();
        let store = store(&dir, "profile-a");
        let (mut unlocked, recovery) = store.create(b"pass", P).unwrap();
        unlocked.write("collective/device-sign", &[4; 32]).unwrap();
        let rotated = unlocked.rotate_recovery().unwrap();
        assert!(matches!(
            store.unlock_with_recovery(&recovery).unwrap_err(),
            StoreError::WrongPassword
        ));
        let mut via = store.unlock_with_recovery(&rotated).unwrap();
        assert_eq!(
            via.read("collective/device-sign")
                .unwrap()
                .unwrap()
                .as_slice(),
            &[4; 32]
        );
        assert!(via.has_recovery());
        via.change_password(b"reset").unwrap();
        assert!(store.unlock(b"reset").is_ok());
    }

    #[test]
    fn profiles_are_isolated_even_with_the_same_password() {
        let dir = tempfile::tempdir().unwrap();
        let a = store(&dir, "profile-a");
        let b = store(&dir, "profile-b");
        let (mut ua, _) = a.create(b"same", P).unwrap();
        ua.write("collective/member-sign", &[5; 32]).unwrap();
        let (ub, _) = b.create(b"same", P).unwrap();
        assert!(ub.read("collective/member-sign").unwrap().is_none());
        // Файл профілю А, підкладений під профіль Б: ідентифікатор профілю в AAD → відмова.
        let stolen = SecretStore::new(a.path(), "profile-b");
        assert!(matches!(
            stolen.unlock(b"same").unwrap_err(),
            StoreError::WrongPassword
        ));
    }

    #[test]
    fn destroy_removes_file_and_tmp() {
        let dir = tempfile::tempdir().unwrap();
        let store = store(&dir, "profile-a");
        let (mut unlocked, _) = store.create(b"pass", P).unwrap();
        unlocked.write("collective/member-sign", &[6; 32]).unwrap();
        fs::write(tmp_path(store.path()), b"leftover").unwrap();
        unlocked.destroy().unwrap();
        assert_eq!(store.status(), StoreStatus::Absent);
        assert!(!tmp_path(store.path()).exists());
        assert!(matches!(
            store.unlock(b"pass").unwrap_err(),
            StoreError::Io(_)
        ));
    }

    #[test]
    fn crash_during_write_keeps_the_previous_file_intact() {
        let dir = tempfile::tempdir().unwrap();
        let store = store(&dir, "profile-a");
        let (mut unlocked, _) = store.create(b"pass", P).unwrap();
        unlocked.write("collective/member-sign", &[7; 32]).unwrap();
        let good = fs::read(store.path()).unwrap();
        // Аварія до rename: тимчасовий файл лишився, основний — незмінний.
        fs::write(tmp_path(store.path()), b"half-written garbage").unwrap();
        assert_eq!(fs::read(store.path()).unwrap(), good);
        let mut reopened = store.unlock(b"pass").unwrap();
        assert_eq!(
            reopened
                .read("collective/member-sign")
                .unwrap()
                .unwrap()
                .as_slice(),
            &[7; 32]
        );
        reopened.write("collective/epoch/x/1", &[8; 32]).unwrap();
        assert!(
            !tmp_path(store.path()).exists(),
            "rename прибирає тимчасовий файл"
        );
        // Обрізаний основний файл: чіткий Corrupt, а не паніка чи «порожнє сховище».
        fs::write(store.path(), &good[..good.len() / 2]).unwrap();
        assert_eq!(store.status(), StoreStatus::Corrupt);
        assert!(matches!(
            store.unlock(b"pass").unwrap_err(),
            StoreError::Corrupt
        ));
        let mut flipped = good.clone();
        let last = flipped.len() - 1;
        flipped[last] ^= 1;
        fs::write(store.path(), &flipped).unwrap();
        let opened = store.unlock(b"pass").unwrap();
        assert!(matches!(
            opened.read("collective/member-sign").unwrap_err(),
            StoreError::Corrupt
        ));
    }

    #[test]
    fn invalid_kdf_params_are_rejected() {
        let dir = tempfile::tempdir().unwrap();
        let store = store(&dir, "profile-a");
        let bad = KdfParams {
            m_kib: 1,
            t: 0,
            p: 0,
        };
        assert!(matches!(
            store.create(b"pass", bad).unwrap_err(),
            StoreError::InvalidKdf
        ));
    }

    #[test]
    fn write_many_and_delete_many_persist_once_and_survive_reopen() {
        let dir = tempfile::tempdir().unwrap();
        let store = store(&dir, "profile-x");
        let (mut unlocked, _recovery) = store.create(b"pass-a", P).unwrap();
        unlocked.write("keep", b"k").unwrap();
        let entries = vec![
            ("e/0".to_string(), &b"a"[..]),
            ("e/1".to_string(), &b"b"[..]),
        ];
        unlocked.write_many(&entries).unwrap();
        let reopened = store.unlock(b"pass-a").unwrap();
        assert_eq!(reopened.read("e/1").unwrap().unwrap().as_slice(), b"b");
        let purposes = vec!["e/0".to_string(), "e/1".to_string(), "absent".to_string()];
        assert_eq!(unlocked.delete_many(&purposes).unwrap(), 2);
        assert_eq!(unlocked.delete_many(&purposes).unwrap(), 0);
        let reopened = store.unlock(b"pass-a").unwrap();
        assert!(reopened.read("e/0").unwrap().is_none());
        assert_eq!(reopened.read("keep").unwrap().unwrap().as_slice(), b"k");
    }
}
