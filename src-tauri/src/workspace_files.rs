//! Сховище файлів «Робочого середовища»: тека на диску в даних застосунку
//! (`<app_local_data>/workspace-files/<profile_id>/`), окрема для кожного профілю, з файлами
//! будь-якого типу, **зашифрованими ключем бібліотеки профілю** (рішення власника
//! 29.10.2026: «треба щоб було шифрування»). Кожен файл лежить як блоб `<id>.ewf`
//! ([`crate::office_library::LibraryKeys::seal_store_file`]): назва й розмір — у зашифрованих
//! метаданих, вміст — окремим шифротекстом; `id` — 32 випадкові шістнадцяткові знаки. Без бази
//! й без версій. Тека ніколи не містить підтек. Сховище працює лише з розблокованою
//! бібліотекою: ключі дає [`crate::office_library::LibrarySession`], і після блокування
//! (30 хвилин без дій, вихід із профілю) команди відмовляють як бібліотека.
//!
//! Команди `workspace_files_*` у `lib.rs` дозволені лише головному вікну
//! (`capabilities/default.json`); редактор відкриває файл сховища через той самий
//! механізм «очікуваного файлу», що й документ бібліотеки ([`crate::office_files::PendingFile`]),
//! а «Зберегти» в редакторі запечатує байти назад у той самий блоб.

use std::fs;
use std::path::{Path, PathBuf};

use argon2::password_hash::rand_core::{OsRng, RngCore};
use chrono::{DateTime, SecondsFormat, Utc};
use serde::Serialize;
use zeroize::Zeroizing;

use crate::office_files;
use crate::office_library::{LibraryError, LibraryKeys, StoreFileMeta};
use crate::phone_export::{save_file, SaveTarget};

/// Назва теки сховища всередині даних застосунку.
pub const ROOT_DIR_NAME: &str = "workspace-files";
/// Розширення блоба на диску.
pub const BLOB_EXT: &str = "ewf";
/// Найдовша назва файлу (у символах), яку сховище приймає.
pub const MAX_NAME_CHARS: usize = 200;
/// Найбільший файл сховища (як у командах `office_*`).
pub const MAX_FILE_BYTES: usize = office_files::MAX_FILE_BYTES;
/// Скільки файлів одна дія «Додати файли…» бере з вікна вибору.
pub const MAX_FILES_PER_ADD: usize = 50;
/// Накладні байти блоба на один файл (заголовок, два nonce, два теги, метадані до 4 КБ).
const BLOB_OVERHEAD: usize = 9 + 2 * 24 + 2 * 16 + 4096;

#[derive(Debug, thiserror::Error, PartialEq, Eq)]
pub enum WorkspaceFilesError {
    #[error("назва файлу має містити від 1 до 200 символів без шляхів і керівних символів")]
    InvalidName,
    #[error("файлу немає у сховищі")]
    NotFound,
    #[error("файл більший за 256 МБ")]
    TooLarge,
    #[error("файл порожній")]
    Empty,
    #[error("файл «{0}» не відкривається в редакторах «Робочого середовища»")]
    NoEditor(String),
    #[error("файл сховища пошкоджено або він зашифрований іншим ключем")]
    Damaged,
    #[error("{0}")]
    Library(String),
    #[error("не вдалося прочитати або записати теку сховища: {0}")]
    Io(String),
}

impl From<std::io::Error> for WorkspaceFilesError {
    fn from(error: std::io::Error) -> Self {
        WorkspaceFilesError::Io(error.to_string())
    }
}

impl From<LibraryError> for WorkspaceFilesError {
    fn from(error: LibraryError) -> Self {
        match error {
            LibraryError::Damaged => WorkspaceFilesError::Damaged,
            LibraryError::InvalidName => WorkspaceFilesError::InvalidName,
            other => WorkspaceFilesError::Library(other.to_string()),
        }
    }
}

/// Файл сховища (контракт `StoredFile` для вкладки «Файли»). Для пошкодженого блоба
/// `damaged = true`, `name` — назва блоба на диску, `size` — розмір блоба.
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StoredFile {
    /// Ідентифікатор блоба (назва на диску без `.ewf`).
    pub id: String,
    pub name: String,
    /// Розширення в нижньому регістрі без крапки (порожнє, якщо його немає).
    pub ext: String,
    pub size: u64,
    /// Час останньої зміни блоба (RFC 3339, UTC) або `None`, якщо файлова система його не дає.
    pub modified_at: Option<String>,
    /// Застосунок «Робочого середовища», який відкриває цей формат, або `None`.
    pub app: Option<&'static str>,
    pub damaged: bool,
}

/// Результат «Додати файли…»: що додано і що пропущено (назва й причина).
#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AddResult {
    pub added: Vec<StoredFile>,
    pub skipped: Vec<SkippedFile>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SkippedFile {
    pub name: String,
    pub reason: String,
}

/// Вміст сховища: шлях теки (щоб користувач знав, де лежать блоби) і файли за назвою.
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Listing {
    pub root: String,
    pub items: Vec<StoredFile>,
}

/// Тека сховища профілю: `<base>/workspace-files/<profile_id>`.
pub fn root_dir(base: &Path, profile_id: &str) -> PathBuf {
    base.join(ROOT_DIR_NAME).join(profile_id)
}

/// Застосунок для розширення: xlsx/csv → EasyGreen, docx/txt → EasyDoc, pptx → EasySlide,
/// easypay → easyPay, easyfly → EasyFLY, ewcoll → «Колективи»; інакше `None`.
pub fn app_for_ext(ext: &str) -> Option<&'static str> {
    match ext {
        "xlsx" | "csv" => Some("easygreen"),
        "docx" | "txt" => Some("easydoc"),
        "pptx" => Some("easyslide"),
        "easypay" => Some("easypay"),
        "easyfly" => Some("easyfly"),
        "ewcoll" => Some("collectives"),
        _ => None,
    }
}

/// Розширення файлу в нижньому регістрі без крапки; порожнє, якщо його немає.
pub fn extension_of(name: &str) -> String {
    match name.rsplit_once('.') {
        Some((stem, ext)) if !stem.is_empty() && !ext.is_empty() => ext.to_lowercase(),
        _ => String::new(),
    }
}

/// Перевірена назва файлу: без каталогів, керівних символів і крайніх пробілів,
/// не `.` чи `..`, 1–200 символів.
pub fn validate_name(name: &str) -> Result<String, WorkspaceFilesError> {
    let trimmed = name.trim();
    let count = trimmed.chars().count();
    if count == 0
        || count > MAX_NAME_CHARS
        || trimmed == "."
        || trimmed == ".."
        || trimmed
            .chars()
            .any(|c| c.is_control() || c == '/' || c == '\\')
    {
        return Err(WorkspaceFilesError::InvalidName);
    }
    Ok(trimmed.to_owned())
}

/// Ідентифікатор блоба: 32 шістнадцяткові знаки в нижньому регістрі.
pub fn validate_id(id: &str) -> Result<&str, WorkspaceFilesError> {
    if id.len() == 32 && id.bytes().all(|b| matches!(b, b'0'..=b'9' | b'a'..=b'f')) {
        Ok(id)
    } else {
        Err(WorkspaceFilesError::NotFound)
    }
}

fn new_id() -> String {
    let mut bytes = [0u8; 16];
    OsRng.fill_bytes(&mut bytes);
    bytes.iter().map(|byte| format!("{byte:02x}")).collect()
}

fn blob_path(dir: &Path, id: &str) -> PathBuf {
    dir.join(format!("{id}.{BLOB_EXT}"))
}

fn modified_at(metadata: &fs::Metadata) -> Option<String> {
    metadata
        .modified()
        .ok()
        .map(|time| DateTime::<Utc>::from(time).to_rfc3339_opts(SecondsFormat::Secs, true))
}

fn stored_file(id: &str, meta: &StoreFileMeta, metadata: &fs::Metadata) -> StoredFile {
    let ext = extension_of(&meta.name);
    StoredFile {
        id: id.to_owned(),
        app: app_for_ext(&ext),
        ext,
        size: meta.size,
        modified_at: modified_at(metadata),
        name: meta.name.clone(),
        damaged: false,
    }
}

fn damaged_file(id: &str, metadata: &fs::Metadata) -> StoredFile {
    StoredFile {
        id: id.to_owned(),
        name: format!("{id}.{BLOB_EXT}"),
        ext: String::new(),
        size: metadata.len(),
        modified_at: modified_at(metadata),
        app: None,
        damaged: true,
    }
}

fn read_blob(path: &Path) -> Result<Vec<u8>, WorkspaceFilesError> {
    office_files::read_regular_file(
        path,
        MAX_FILE_BYTES + BLOB_OVERHEAD,
        &WorkspaceFilesError::TooLarge.to_string(),
    )
    .map_err(WorkspaceFilesError::Io)
}

/// Файли теки за назвою (без урахування регістру): лише звичайні файли `<32 hex>.ewf`;
/// підтеки, посилання й сторонні файли пропускаються. Блоб, який не розшифровується цим
/// ключем, лишається в списку як пошкоджений. Теки, якої немає, — порожній список.
pub fn list(dir: &Path, keys: &LibraryKeys) -> Result<Vec<StoredFile>, WorkspaceFilesError> {
    let entries = match fs::read_dir(dir) {
        Ok(entries) => entries,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(Vec::new()),
        Err(error) => return Err(error.into()),
    };
    let mut items = Vec::new();
    for entry in entries {
        let entry = entry?;
        let Some(file_name) = entry.file_name().to_str().map(str::to_owned) else {
            continue;
        };
        let Some(id) = file_name
            .strip_suffix(&format!(".{BLOB_EXT}"))
            .and_then(|id| validate_id(id).ok())
        else {
            continue;
        };
        let metadata = entry.metadata()?;
        if !metadata.is_file() {
            continue;
        }
        let item = match read_blob(&entry.path()).and_then(|data| {
            keys.open_store_meta(id, &data)
                .map_err(WorkspaceFilesError::from)
        }) {
            Ok(meta) => stored_file(id, &meta, &metadata),
            Err(_) => damaged_file(id, &metadata),
        };
        items.push(item);
    }
    items.sort_by(|a, b| {
        a.name
            .to_lowercase()
            .cmp(&b.name.to_lowercase())
            .then_with(|| a.id.cmp(&b.id))
    });
    Ok(items)
}

/// Шлях до наявного блоба сховища за перевіреним ідентифікатором.
pub fn resolve(dir: &Path, id: &str) -> Result<(String, PathBuf), WorkspaceFilesError> {
    let id = validate_id(id)?;
    let path = blob_path(dir, id);
    let metadata = match fs::symlink_metadata(&path) {
        Ok(metadata) => metadata,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            return Err(WorkspaceFilesError::NotFound);
        }
        Err(error) => return Err(error.into()),
    };
    if !metadata.is_file() {
        return Err(WorkspaceFilesError::NotFound);
    }
    Ok((id.to_owned(), path))
}

/// Один файл сховища з метаданими (без вмісту).
pub fn stat(
    dir: &Path,
    keys: &LibraryKeys,
    id: &str,
) -> Result<(StoredFile, PathBuf), WorkspaceFilesError> {
    let (id, path) = resolve(dir, id)?;
    let metadata = fs::metadata(&path)?;
    let meta = keys.open_store_meta(&id, &read_blob(&path)?)?;
    Ok((stored_file(&id, &meta, &metadata), path))
}

/// Розшифрований вміст файлу сховища разом з метаданими.
pub fn read(
    dir: &Path,
    keys: &LibraryKeys,
    id: &str,
) -> Result<(StoredFile, Zeroizing<Vec<u8>>), WorkspaceFilesError> {
    let (id, path) = resolve(dir, id)?;
    let metadata = fs::metadata(&path)?;
    let (meta, bytes) = keys.open_store_file(&id, &read_blob(&path)?)?;
    Ok((stored_file(&id, &meta, &metadata), bytes))
}

/// Запечатує `bytes` під назвою `name` у новий блоб теки (новий випадковий ідентифікатор).
pub fn write_new(
    dir: &Path,
    keys: &LibraryKeys,
    name: &str,
    bytes: &[u8],
) -> Result<StoredFile, WorkspaceFilesError> {
    let name = validate_name(name)?;
    if bytes.is_empty() {
        return Err(WorkspaceFilesError::Empty);
    }
    if bytes.len() > MAX_FILE_BYTES {
        return Err(WorkspaceFilesError::TooLarge);
    }
    fs::create_dir_all(dir)?;
    let id = new_id();
    let meta = StoreFileMeta {
        name,
        size: bytes.len() as u64,
    };
    let data = keys.seal_store_file(&id, &meta, bytes)?;
    let target = SaveTarget {
        path: blob_path(dir, &id),
        replace_confirmed: false,
    };
    save_file(&target, &data).map_err(|error| WorkspaceFilesError::Io(error.to_string()))?;
    let metadata = fs::metadata(&target.path)?;
    Ok(stored_file(&id, &meta, &metadata))
}

/// Замінює вміст наявного блоба (та сама назва й ідентифікатор): «Зберегти» з редактора.
/// Запис атомарний: тимчасовий файл → перейменування поверх блоба.
pub fn overwrite(
    dir: &Path,
    keys: &LibraryKeys,
    id: &str,
    bytes: &[u8],
) -> Result<StoredFile, WorkspaceFilesError> {
    let (id, path) = resolve(dir, id)?;
    if bytes.is_empty() {
        return Err(WorkspaceFilesError::Empty);
    }
    if bytes.len() > MAX_FILE_BYTES {
        return Err(WorkspaceFilesError::TooLarge);
    }
    let previous = keys.open_store_meta(&id, &read_blob(&path)?)?;
    let meta = StoreFileMeta {
        name: previous.name,
        size: bytes.len() as u64,
    };
    let data = keys.seal_store_file(&id, &meta, bytes)?;
    let target = SaveTarget {
        path: path.clone(),
        replace_confirmed: true,
    };
    save_file(&target, &data).map_err(|error| WorkspaceFilesError::Io(error.to_string()))?;
    let metadata = fs::metadata(&path)?;
    Ok(stored_file(&id, &meta, &metadata))
}

/// Копіює звичайний файл `source` (до 256 МБ, не порожній) у теку сховища зашифрованим
/// блобом під його назвою. Файл на диску не змінюється.
pub fn add(
    dir: &Path,
    keys: &LibraryKeys,
    source: &Path,
) -> Result<StoredFile, WorkspaceFilesError> {
    let name = validate_name(&office_files::file_name(source))?;
    let bytes = office_files::read_regular_file(
        source,
        MAX_FILE_BYTES,
        &WorkspaceFilesError::TooLarge.to_string(),
    )
    .map_err(|error| {
        if error == WorkspaceFilesError::TooLarge.to_string() {
            WorkspaceFilesError::TooLarge
        } else {
            WorkspaceFilesError::Io(error)
        }
    })?;
    write_new(dir, keys, &name, &bytes)
}

/// Видаляє блоб сховища назавжди (без кошика); пошкоджений блоб теж.
pub fn delete(dir: &Path, id: &str) -> Result<String, WorkspaceFilesError> {
    let (id, path) = resolve(dir, id)?;
    fs::remove_file(&path)?;
    Ok(id)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;

    const PROFILE: &str = "profile-0123456789abcdef0123456789abcdef";

    fn keys() -> LibraryKeys {
        LibraryKeys::for_tests(PROFILE, &[7u8; 32])
    }

    fn temp_dir() -> tempfile::TempDir {
        tempfile::tempdir().unwrap()
    }

    fn write(path: &Path, bytes: &[u8]) {
        let mut file = fs::File::create(path).unwrap();
        file.write_all(bytes).unwrap();
    }

    #[test]
    fn names_and_ids_are_validated() {
        assert_eq!(validate_name("  Звіт №1.xlsx ").unwrap(), "Звіт №1.xlsx");
        for bad in [
            "",
            " ",
            ".",
            "..",
            "a/b.txt",
            "a\\b.txt",
            "x\u{0}.txt",
            &"a".repeat(201),
        ] {
            assert_eq!(
                validate_name(bad),
                Err(WorkspaceFilesError::InvalidName),
                "{bad:?}"
            );
        }
        assert_eq!(extension_of("Звіт.XLSX"), "xlsx");
        assert_eq!(extension_of(".bashrc"), "");
        assert_eq!(extension_of("README"), "");
        assert_eq!(extension_of("archive.tar.gz"), "gz");
        let id = new_id();
        assert_eq!(validate_id(&id), Ok(id.as_str()));
        for bad in ["", "abc", &"g".repeat(32), &"A".repeat(32), "../x"] {
            assert_eq!(
                validate_id(bad),
                Err(WorkspaceFilesError::NotFound),
                "{bad:?}"
            );
        }
    }

    #[test]
    fn editors_by_extension() {
        assert_eq!(app_for_ext("csv"), Some("easygreen"));
        assert_eq!(app_for_ext("txt"), Some("easydoc"));
        assert_eq!(app_for_ext("pptx"), Some("easyslide"));
        assert_eq!(app_for_ext("easyfly"), Some("easyfly"));
        assert_eq!(app_for_ext("easypay"), Some("easypay"));
        assert_eq!(app_for_ext("ewcoll"), Some("collectives"));
        assert_eq!(app_for_ext("pdf"), None);
        assert_eq!(app_for_ext(""), None);
        for ext in ["xlsx", "docx", "pptx", "easyfly", "easypay", "ewcoll"] {
            assert!(
                office_files::editor_app(app_for_ext(ext).unwrap()).is_ok(),
                "{ext}"
            );
        }
    }

    #[test]
    fn root_is_per_profile() {
        assert_eq!(
            root_dir(Path::new("/data"), "profile-abc"),
            PathBuf::from("/data/workspace-files/profile-abc")
        );
    }

    #[test]
    fn add_list_read_overwrite_delete_round_trip() {
        let keys = keys();
        let source_dir = temp_dir();
        let store = temp_dir();
        let dir = store.path().join("workspace-files").join(PROFILE);
        assert_eq!(
            list(&dir, &keys).unwrap(),
            Vec::new(),
            "теки ще немає — порожньо"
        );

        let source = source_dir.path().join("Таблиця.XLSX");
        write(&source, b"PK\x03\x04synthetic");
        let added = add(&dir, &keys, &source).unwrap();
        assert_eq!(added.name, "Таблиця.XLSX");
        assert_eq!(added.ext, "xlsx");
        assert_eq!(added.app, Some("easygreen"));
        assert_eq!(added.size, 13);
        assert!(!added.damaged);
        assert!(added.modified_at.is_some());
        assert_eq!(
            fs::read(&source).unwrap(),
            b"PK\x03\x04synthetic",
            "джерело не змінилося"
        );
        // На диску лише блоб без відкритого тексту й назви.
        let blob = fs::read(blob_path(&dir, &added.id)).unwrap();
        assert!(blob.starts_with(b"EWFS\x01"));
        assert!(!blob.windows(9).any(|w| w == b"synthetic"));
        assert!(!blob.windows(7).any(|w| w == "Таблиця".as_bytes()));

        // Та сама назва — другий блоб, обидва лишаються.
        write(&source, b"other");
        let second = add(&dir, &keys, &source).unwrap();
        assert_ne!(second.id, added.id);
        assert_eq!(second.name, "Таблиця.XLSX");

        let pdf = source_dir.path().join("Наказ.pdf");
        write(&pdf, b"%PDF-1.4 synthetic");
        let pdf_item = add(&dir, &keys, &pdf).unwrap();
        assert_eq!(pdf_item.app, None);
        assert_eq!(pdf_item.ext, "pdf");

        // Підтека, стороннє й блоб іншого ключа в списку: перші два пропускаються,
        // чужий блоб — «пошкоджено».
        fs::create_dir(dir.join("sub")).unwrap();
        write(&dir.join("notes.txt"), b"plain");
        let stranger = LibraryKeys::for_tests(PROFILE, &[9u8; 32]);
        let foreign = write_new(&dir, &stranger, "Чужий.txt", b"secret").unwrap();
        let listed = list(&dir, &keys).unwrap();
        let names: Vec<_> = listed.iter().map(|f| f.name.as_str()).collect();
        assert_eq!(
            names,
            vec![
                format!("{}.ewf", foreign.id).as_str(),
                "Наказ.pdf",
                "Таблиця.XLSX",
                "Таблиця.XLSX"
            ],
            "за назвою без урахування регістру; пошкоджений — під назвою блоба"
        );
        assert!(listed[0].damaged);
        assert_eq!(listed[0].id, foreign.id);
        assert_eq!(
            stat(&dir, &keys, &foreign.id).unwrap_err(),
            WorkspaceFilesError::Damaged
        );

        let (stat_item, path) = stat(&dir, &keys, &pdf_item.id).unwrap();
        assert_eq!(stat_item, pdf_item);
        assert_eq!(path, blob_path(&dir, &pdf_item.id));
        let (read_item, bytes) = read(&dir, &keys, &pdf_item.id).unwrap();
        assert_eq!(read_item, pdf_item);
        assert_eq!(&bytes[..], b"%PDF-1.4 synthetic");

        // «Зберегти» з редактора: той самий id і назва, новий вміст.
        let saved = overwrite(&dir, &keys, &added.id, b"PK\x03\x04edited!").unwrap();
        assert_eq!(saved.id, added.id);
        assert_eq!(saved.name, "Таблиця.XLSX");
        assert_eq!(saved.size, 11);
        assert_eq!(
            &read(&dir, &keys, &added.id).unwrap().1[..],
            b"PK\x03\x04edited!"
        );
        assert_eq!(
            overwrite(&dir, &keys, &added.id, b""),
            Err(WorkspaceFilesError::Empty)
        );
        assert_eq!(
            overwrite(&dir, &stranger, &added.id, b"x"),
            Err(WorkspaceFilesError::Damaged),
            "інший ключ не перезапише блоб"
        );

        assert_eq!(delete(&dir, &pdf_item.id).unwrap(), pdf_item.id);
        assert!(!blob_path(&dir, &pdf_item.id).exists());
        assert_eq!(
            delete(&dir, &pdf_item.id),
            Err(WorkspaceFilesError::NotFound)
        );
        assert_eq!(
            delete(&dir, &foreign.id).unwrap(),
            foreign.id,
            "пошкоджений теж видаляється"
        );
        assert_eq!(delete(&dir, "../x"), Err(WorkspaceFilesError::NotFound));
        assert!(
            dir.join("notes.txt").exists(),
            "стороннього файлу не чіпали"
        );
    }

    #[test]
    fn blob_is_bound_to_profile_and_id() {
        let keys = keys();
        let meta = StoreFileMeta {
            name: "a.txt".to_owned(),
            size: 3,
        };
        let id = new_id();
        let data = keys.seal_store_file(&id, &meta, b"abc").unwrap();
        assert_eq!(keys.open_store_file(&id, &data).unwrap().0, meta);
        assert!(keys.open_store_meta(&new_id(), &data).is_err(), "інший id");
        let other = LibraryKeys::for_tests("profile-fedcba9876543210fedcba9876543210", &[7u8; 32]);
        assert!(
            other.open_store_meta(&id, &data).is_err(),
            "інший профіль, той самий LDK"
        );
        let mut tampered = data.clone();
        let last = tampered.len() - 1;
        tampered[last] ^= 1;
        assert!(
            keys.open_store_meta(&id, &tampered).is_ok(),
            "метадані цілі"
        );
        assert!(
            keys.open_store_file(&id, &tampered).is_err(),
            "вміст зіпсовано"
        );
        assert!(keys.open_store_meta(&id, b"EWFS\x01\0\0\0\x05").is_err());
    }

    #[test]
    fn empty_and_missing_sources_are_refused() {
        let keys = keys();
        let source_dir = temp_dir();
        let store = temp_dir();
        let empty = source_dir.path().join("порожній.txt");
        write(&empty, b"");
        assert_eq!(
            add(store.path(), &keys, &empty),
            Err(WorkspaceFilesError::Empty)
        );
        assert!(matches!(
            add(store.path(), &keys, &source_dir.path().join("немає.txt")),
            Err(WorkspaceFilesError::Io(_))
        ));
        assert_eq!(list(store.path(), &keys).unwrap(), Vec::new());
    }
}
