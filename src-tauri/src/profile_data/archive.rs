//! Резервна копія даних профілю: один файл `.ewpdb` (zip без стиснення) із тих самих зашифрованих
//! файлів, що лежать у теці профілю (`keyring.json` і `records/*.ewd`) та `manifest.json`.
//! Експорт нічого не розшифровує: копіюються вже зашифровані байти, тож файл захищений паролем
//! профілю на момент копії так само, як тека застосунку.
//!
//! Відновлення працює і на іншому комп'ютері, де профіль має інший id: записи розшифровуються
//! ключем **джерела** (пароль профілю на момент копії), після чого шифруються ключем поточного
//! профілю. Наявні записи не затираються, якщо вони новіші за ті, що в копії.

use std::io::{Read, Write};

use super::*;

/// Розширення файлу копії.
pub const ARCHIVE_EXT: &str = "ewpdb";
const ARCHIVE_KIND: &str = "easywar-profile-data-backup";
const ARCHIVE_FORMAT: u8 = 1;
const MANIFEST_NAME: &str = "manifest.json";
const RECORDS_PREFIX: &str = "records/";
/// Найбільший службовий файл (маніфест, keyring).
const MAX_META_BYTES: u64 = 64 * 1024;
/// Найбільший зашифрований запис: значення до 32 МБ, що в JSON може розрослися через екранування.
const MAX_ENTRY_BYTES: u64 = 200 * 1024 * 1024;

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ArchiveManifest {
    kind: String,
    format: u8,
    profile_id: String,
    created: String,
    records: usize,
}

/// Підсумок відновлення (контракт для інтерфейсу).
#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ArchiveReport {
    /// Записів у копії.
    pub total: usize,
    /// Записано в профіль (нових і замінених старішими версіями).
    pub restored: usize,
    /// Пропущено, бо в профілі вже є новіша версія.
    pub kept_newer: usize,
    /// Не відновлено: пошкоджені, з некоректним ключем або понад ліміт записів.
    pub skipped: usize,
}

fn zip_error(error: zip::result::ZipError) -> ProfileDataError {
    ProfileDataError::Io(error.to_string())
}

fn read_limited<R: Read>(reader: R, limit: u64) -> Result<Vec<u8>, ProfileDataError> {
    let mut data = Vec::new();
    reader.take(limit + 1).read_to_end(&mut data)?;
    if data.len() as u64 > limit {
        return Err(ProfileDataError::InvalidArchive);
    }
    Ok(data)
}

/// `records/<32 hex>.ewd` → назва файлу запису.
fn record_name(entry: &str) -> Option<&str> {
    let name = entry.strip_prefix(RECORDS_PREFIX)?;
    let stem = name.strip_suffix(&format!(".{RECORD_EXT}"))?;
    (stem.len() == 32
        && stem
            .bytes()
            .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b)))
    .then_some(name)
}

impl ProfileDataStore {
    /// Записує копію даних профілю в новий файл (наявного не перезаписує). → кількість записів.
    pub fn export_archive(
        &self,
        keys: &DataKeys,
        destination: &Path,
        created: &str,
    ) -> Result<usize, ProfileDataError> {
        if !destination.is_absolute() || destination.file_name().is_none() {
            return Err(ProfileDataError::Io(
                "оберіть абсолютний шлях до файлу копії".to_owned(),
            ));
        }
        if destination.symlink_metadata().is_ok() {
            return Err(ProfileDataError::AlreadyExists);
        }
        let parent = destination
            .parent()
            .ok_or(ProfileDataError::InvalidArchive)?;
        let dir = self.profile_dir(keys.profile_id())?;
        let keyring = match fs::read(dir.join(KEYRING_FILE)) {
            Ok(bytes) => bytes,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
                return Err(ProfileDataError::ProfileNotFound)
            }
            Err(error) => return Err(error.into()),
        };
        let mut files = self.record_files(&dir)?;
        files.sort();
        let manifest = serde_json::to_vec_pretty(&ArchiveManifest {
            kind: ARCHIVE_KIND.to_owned(),
            format: ARCHIVE_FORMAT,
            profile_id: keys.profile_id().to_owned(),
            created: created.to_owned(),
            records: files.len(),
        })
        .map_err(|_| ProfileDataError::InvalidArchive)?;

        let temporary = tempfile::NamedTempFile::new_in(parent)?;
        {
            let mut zip = zip::ZipWriter::new(temporary.as_file());
            let options = zip::write::SimpleFileOptions::default()
                .compression_method(zip::CompressionMethod::Stored);
            zip.start_file(MANIFEST_NAME, options).map_err(zip_error)?;
            zip.write_all(&manifest)?;
            zip.start_file(KEYRING_FILE, options).map_err(zip_error)?;
            zip.write_all(&keyring)?;
            for path in &files {
                let Some(name) = path.file_name().and_then(|n| n.to_str()) else {
                    continue;
                };
                zip.start_file(format!("{RECORDS_PREFIX}{name}"), options)
                    .map_err(zip_error)?;
                zip.write_all(&fs::read(path)?)?;
            }
            zip.finish().map_err(zip_error)?;
        }
        temporary.as_file().sync_all()?;
        match temporary.persist_noclobber(destination) {
            Ok(_) => Ok(files.len()),
            Err(error) if error.error.kind() == std::io::ErrorKind::AlreadyExists => {
                Err(ProfileDataError::AlreadyExists)
            }
            Err(error) => Err(error.error.into()),
        }
    }

    /// Відновлює записи з копії в профіль `target`. `password` — пароль профілю **на момент
    /// копії** (профіль без пароля — порожній). Блокує потік на час KDF: викликати з
    /// блокувальної задачі.
    pub fn import_archive(
        &self,
        archive: &Path,
        password: &[u8],
        target: &DataKeys,
    ) -> Result<ArchiveReport, ProfileDataError> {
        let file = fs::File::open(archive)?;
        let mut zip = zip::ZipArchive::new(file).map_err(|_| ProfileDataError::InvalidArchive)?;
        if zip.len() > MAX_RECORDS + 2 {
            return Err(ProfileDataError::InvalidArchive);
        }
        let manifest: ArchiveManifest = {
            let entry = zip
                .by_name(MANIFEST_NAME)
                .map_err(|_| ProfileDataError::InvalidArchive)?;
            serde_json::from_slice(&read_limited(entry, MAX_META_BYTES)?)
                .map_err(|_| ProfileDataError::InvalidArchive)?
        };
        if manifest.kind != ARCHIVE_KIND
            || manifest.format != ARCHIVE_FORMAT
            || !valid_profile_id(&manifest.profile_id)
        {
            return Err(ProfileDataError::InvalidArchive);
        }
        let keyring: Keyring = {
            let entry = zip
                .by_name(KEYRING_FILE)
                .map_err(|_| ProfileDataError::InvalidArchive)?;
            serde_json::from_slice(&read_limited(entry, MAX_META_BYTES)?)
                .map_err(|_| ProfileDataError::InvalidArchive)?
        };
        if keyring.format != FORMAT {
            return Err(ProfileDataError::InvalidArchive);
        }
        let salt = from_hex(&keyring.kdf.salt).ok_or(ProfileDataError::InvalidArchive)?;
        let kek = derive_kek(password, &salt, kdf_of(&keyring.kdf))
            .map_err(|_| ProfileDataError::InvalidArchive)?;
        let dek = unwrap(
            &kek,
            &keyring.password,
            &keyring_aad(&manifest.profile_id, "password"),
        )
        .ok_or(ProfileDataError::WrongKey)?;
        let source = DataKeys::derive(&manifest.profile_id, &dek);

        let names: Vec<String> = zip
            .file_names()
            .filter_map(|entry| record_name(entry).map(|_| entry.to_owned()))
            .collect();
        let mut report = ArchiveReport {
            total: names.len(),
            ..ArchiveReport::default()
        };
        for entry_name in names {
            let Some(name) = record_name(&entry_name) else {
                continue;
            };
            let data = {
                let entry = zip
                    .by_name(&entry_name)
                    .map_err(|_| ProfileDataError::InvalidArchive)?;
                read_limited(entry, MAX_ENTRY_BYTES)?
            };
            let Ok(record) = source.open_record(name, &data) else {
                report.skipped += 1;
                continue;
            };
            if validate_key(&record.key).is_err() || record.value.is_empty() {
                report.skipped += 1;
                continue;
            }
            if let Ok(Some(existing)) = self.get(target, &record.key) {
                if existing.modified >= record.modified {
                    report.kept_newer += 1;
                    continue;
                }
            }
            match self.set_at(target, &record.key, &record.value, &record.modified) {
                Ok(()) => report.restored += 1,
                Err(_) => report.skipped += 1,
            }
        }
        Ok(report)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const SOURCE: &str = "profile-0123456789abcdef01234567";
    const TARGET: &str = "profile-fedcba9876543210fedcba98";

    fn store(dir: &tempfile::TempDir) -> ProfileDataStore {
        ProfileDataStore::with_kdf(
            dir.path().join("profile-data"),
            KdfParams {
                m_kib: 8,
                t: 1,
                p: 1,
            },
        )
    }

    #[tokio::test]
    async fn archive_round_trips_into_another_profile_and_keeps_newer_records() {
        let dir = tempfile::tempdir().unwrap();
        let store = store(&dir);
        let source = store.unlock(SOURCE, "пароль-копії").await.unwrap();
        store.set(&source, "easyfly.main", r#"{"a":1}"#).unwrap();
        store.set(&source, "weather.state", r#"{"b":2}"#).unwrap();
        let file = dir.path().join("копія.ewpdb");
        assert_eq!(
            store
                .export_archive(&source, &file, "2026-10-30T00:00:00Z")
                .unwrap(),
            2
        );

        // Інший профіль (інший id, інший пароль): новіший запис не затирається.
        let target = store.unlock(TARGET, "інший-пароль").await.unwrap();
        store
            .set(&target, "weather.state", r#"{"новіше":true}"#)
            .unwrap();
        let report = store
            .import_archive(&file, "пароль-копії".as_bytes(), &target)
            .unwrap();
        assert_eq!(
            report,
            ArchiveReport {
                total: 2,
                restored: 1,
                kept_newer: 1,
                skipped: 0
            }
        );
        assert_eq!(
            store.get(&target, "easyfly.main").unwrap().unwrap().value,
            r#"{"a":1}"#
        );
        assert_eq!(
            store.get(&target, "weather.state").unwrap().unwrap().value,
            r#"{"новіше":true}"#
        );
    }

    #[tokio::test]
    async fn archive_holds_only_ciphertext_and_refuses_overwrite_and_wrong_password() {
        let dir = tempfile::tempdir().unwrap();
        let store = store(&dir);
        let source = store.unlock(SOURCE, "пароль").await.unwrap();
        store
            .set(&source, "easyfly.main", "ТАЄМНЕ-ЗНАЧЕННЯ")
            .unwrap();
        let file = dir.path().join("копія.ewpdb");
        store.export_archive(&source, &file, "t").unwrap();
        let bytes = fs::read(&file).unwrap();
        let text = String::from_utf8_lossy(&bytes);
        assert!(!text.contains("ТАЄМНЕ-ЗНАЧЕННЯ") && !text.contains("easyfly"));
        assert_eq!(
            store.export_archive(&source, &file, "t"),
            Err(ProfileDataError::AlreadyExists)
        );
        assert_eq!(fs::read(&file).unwrap(), bytes, "наявний файл не змінено");

        let target = store.unlock(TARGET, "x").await.unwrap();
        assert_eq!(
            store.import_archive(&file, "не-той".as_bytes(), &target),
            Err(ProfileDataError::WrongKey)
        );
        assert!(store.list(&target, "").unwrap().is_empty());
    }

    #[tokio::test]
    async fn damaged_entries_are_skipped_and_foreign_files_rejected() {
        let dir = tempfile::tempdir().unwrap();
        let store = store(&dir);
        let source = store.unlock(SOURCE, "пароль").await.unwrap();
        store.set(&source, "easyfly.main", "{}").unwrap();
        store.set(&source, "sun.state", "{}").unwrap();
        // Псуємо один запис на диску до експорту: копія його несе, відновлення пропускає.
        let victim = store
            .profile_dir(SOURCE)
            .unwrap()
            .join(source.file_name("sun.state"));
        let mut bytes = fs::read(&victim).unwrap();
        let last = bytes.len() - 1;
        bytes[last] ^= 0xff;
        fs::write(&victim, bytes).unwrap();
        let file = dir.path().join("копія.ewpdb");
        store.export_archive(&source, &file, "t").unwrap();
        let target = store.unlock(TARGET, "x").await.unwrap();
        let report = store
            .import_archive(&file, "пароль".as_bytes(), &target)
            .unwrap();
        assert_eq!((report.total, report.restored, report.skipped), (2, 1, 1));

        let other = dir.path().join("чуже.ewpdb");
        fs::write(&other, b"not a zip").unwrap();
        assert_eq!(
            store.import_archive(&other, b"x", &target),
            Err(ProfileDataError::InvalidArchive)
        );
    }

    #[test]
    fn only_well_formed_record_entries_are_read() {
        let ok = format!("records/{}.ewd", "0123456789abcdef0123456789abcdef");
        assert!(record_name(&ok).is_some());
        for bad in [
            "records/../evil.ewd",
            "records/short.ewd",
            "keyring.json",
            "records/0123456789ABCDEF0123456789ABCDEF.ewd",
            "records/0123456789abcdef0123456789abcdef.txt",
            "other/0123456789abcdef0123456789abcdef.ewd",
        ] {
            assert!(record_name(bad).is_none(), "{bad}");
        }
    }
}
