//! Сховище файлів «Робочого середовища»: звичайна тека на диску в даних застосунку
//! (`<app_local_data>/workspace-files/<profile_id>/`), окрема для кожного профілю.
//! Файли лежать як є, без шифрування й без бази: це відкрита зона модуля, а не
//! захищена бібліотека («Бібліотека» в `office_library.rs`). Тека ніколи не містить
//! підтек: назва файлу — лише остання частина шляху, без каталогів.
//!
//! Команди `workspace_files_*` у `lib.rs` дозволені лише головному вікну
//! (`capabilities/default.json`); редактор відкриває файл сховища через той самий
//! механізм «очікуваного файлу», що й документ бібліотеки ([`crate::office_files::PendingFile`]),
//! і «Зберегти» в редакторі пише назад у той самий файл теки.

use std::fs;
use std::path::{Path, PathBuf};

use chrono::{DateTime, SecondsFormat, Utc};
use serde::Serialize;

use crate::office_files;
use crate::phone_export::{save_file, SaveTarget};

/// Назва теки сховища всередині даних застосунку.
pub const ROOT_DIR_NAME: &str = "workspace-files";
/// Найдовша назва файлу (у символах), яку сховище приймає.
pub const MAX_NAME_CHARS: usize = 200;
/// Найбільший файл сховища (як у командах `office_*`).
pub const MAX_FILE_BYTES: usize = office_files::MAX_FILE_BYTES;
/// Скільки файлів одна дія «Додати файли…» бере з вікна вибору.
pub const MAX_FILES_PER_ADD: usize = 50;

#[derive(Debug, thiserror::Error, PartialEq, Eq)]
pub enum WorkspaceFilesError {
    #[error("назва файлу має містити від 1 до 200 символів без шляхів і керівних символів")]
    InvalidName,
    #[error("файлу «{0}» немає у сховищі")]
    NotFound(String),
    #[error("«{0}» — це не звичайний файл")]
    NotRegular(String),
    #[error("файл більший за 256 МБ")]
    TooLarge,
    #[error("файл порожній")]
    Empty,
    #[error("файл «{0}» не відкривається в редакторах «Робочого середовища»")]
    NoEditor(String),
    #[error("не вдалося прочитати або записати теку сховища: {0}")]
    Io(String),
}

impl From<std::io::Error> for WorkspaceFilesError {
    fn from(error: std::io::Error) -> Self {
        WorkspaceFilesError::Io(error.to_string())
    }
}

/// Файл сховища (контракт `StoredFile` для вкладки «Файли»).
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StoredFile {
    pub name: String,
    /// Розширення в нижньому регістрі без крапки (порожнє, якщо його немає).
    pub ext: String,
    pub size: u64,
    /// Час останньої зміни (RFC 3339, UTC) або `None`, якщо файлова система його не дає.
    pub modified_at: Option<String>,
    /// Застосунок «Робочого середовища», який відкриває цей формат, або `None`.
    pub app: Option<&'static str>,
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

/// Вміст сховища: шлях теки (щоб користувач знав, де лежать файли) і файли за назвою.
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

/// Назва, якої в теці ще немає: `назва.ext` → `назва (2).ext`, `назва (3).ext`, …
pub fn unique_name(dir: &Path, name: &str) -> String {
    if !dir.join(name).exists() {
        return name.to_owned();
    }
    let (stem, ext) = match name.rsplit_once('.') {
        Some((stem, ext)) if !stem.is_empty() && !ext.is_empty() => (stem, Some(ext)),
        _ => (name, None),
    };
    (2..)
        .map(|n| match ext {
            Some(ext) => format!("{stem} ({n}).{ext}"),
            None => format!("{stem} ({n})"),
        })
        .find(|candidate| !dir.join(candidate).exists())
        .unwrap_or_else(|| name.to_owned())
}

fn modified_at(metadata: &fs::Metadata) -> Option<String> {
    metadata
        .modified()
        .ok()
        .map(|time| DateTime::<Utc>::from(time).to_rfc3339_opts(SecondsFormat::Secs, true))
}

fn stored_file(name: String, metadata: &fs::Metadata) -> StoredFile {
    let ext = extension_of(&name);
    StoredFile {
        app: app_for_ext(&ext),
        ext,
        size: metadata.len(),
        modified_at: modified_at(metadata),
        name,
    }
}

/// Файли теки за назвою (без урахування регістру); підтеки, посилання й файли з
/// назвами, що не проходять [`validate_name`], пропускаються. Теки, якої немає, — порожній список.
pub fn list(dir: &Path) -> Result<Vec<StoredFile>, WorkspaceFilesError> {
    let entries = match fs::read_dir(dir) {
        Ok(entries) => entries,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(Vec::new()),
        Err(error) => return Err(error.into()),
    };
    let mut items = Vec::new();
    for entry in entries {
        let entry = entry?;
        let Some(name) = entry.file_name().to_str().map(str::to_owned) else {
            continue;
        };
        if validate_name(&name).is_err() {
            continue;
        }
        let metadata = entry.metadata()?;
        if !metadata.is_file() {
            continue;
        }
        items.push(stored_file(name, &metadata));
    }
    items.sort_by(|a, b| {
        a.name
            .to_lowercase()
            .cmp(&b.name.to_lowercase())
            .then_with(|| a.name.cmp(&b.name))
    });
    Ok(items)
}

/// Шлях до наявного звичайного файлу сховища за перевіреною назвою.
pub fn resolve(dir: &Path, name: &str) -> Result<(String, PathBuf), WorkspaceFilesError> {
    let name = validate_name(name)?;
    let path = dir.join(&name);
    let metadata = match fs::symlink_metadata(&path) {
        Ok(metadata) => metadata,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            return Err(WorkspaceFilesError::NotFound(name));
        }
        Err(error) => return Err(error.into()),
    };
    if !metadata.is_file() {
        return Err(WorkspaceFilesError::NotRegular(name));
    }
    Ok((name, path))
}

/// Один файл сховища з метаданими.
pub fn stat(dir: &Path, name: &str) -> Result<(StoredFile, PathBuf), WorkspaceFilesError> {
    let (name, path) = resolve(dir, name)?;
    let metadata = fs::metadata(&path)?;
    Ok((stored_file(name, &metadata), path))
}

/// Копіює звичайний файл `source` (до 256 МБ, не порожній) у теку сховища під його
/// назвою (або з суфіксом « (2)», якщо така назва вже є). Файл на диску не змінюється;
/// запис атомарний (тимчасовий файл → перейменування, без затирання наявного).
pub fn add(dir: &Path, source: &Path) -> Result<StoredFile, WorkspaceFilesError> {
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
    if bytes.is_empty() {
        return Err(WorkspaceFilesError::Empty);
    }
    fs::create_dir_all(dir)?;
    let name = unique_name(dir, &name);
    let target = SaveTarget {
        path: dir.join(&name),
        replace_confirmed: false,
    };
    save_file(&target, &bytes).map_err(|error| WorkspaceFilesError::Io(error.to_string()))?;
    let metadata = fs::metadata(&target.path)?;
    Ok(stored_file(name, &metadata))
}

/// Видаляє файл сховища назавжди (без кошика).
pub fn delete(dir: &Path, name: &str) -> Result<String, WorkspaceFilesError> {
    let (name, path) = resolve(dir, name)?;
    fs::remove_file(&path)?;
    Ok(name)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;

    fn temp_dir() -> tempfile::TempDir {
        tempfile::tempdir().unwrap()
    }

    fn write(path: &Path, bytes: &[u8]) {
        let mut file = fs::File::create(path).unwrap();
        file.write_all(bytes).unwrap();
    }

    #[test]
    fn names_are_validated() {
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
        // Кожен застосунок є у списку вікна редактора.
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
    fn add_list_delete_round_trip() {
        let source_dir = temp_dir();
        let store = temp_dir();
        let dir = store.path().join("workspace-files").join("profile-1");
        assert_eq!(list(&dir).unwrap(), Vec::new(), "теки ще немає — порожньо");

        let source = source_dir.path().join("Таблиця.XLSX");
        write(&source, b"PK\x03\x04synthetic");
        let added = add(&dir, &source).unwrap();
        assert_eq!(added.name, "Таблиця.XLSX");
        assert_eq!(added.ext, "xlsx");
        assert_eq!(added.app, Some("easygreen"));
        assert_eq!(added.size, 13);
        assert!(added.modified_at.is_some());
        assert_eq!(
            fs::read(&source).unwrap(),
            b"PK\x03\x04synthetic",
            "джерело не змінилося"
        );

        // Та сама назва — новий файл із суфіксом, старий не затирається.
        write(&source, b"other");
        let second = add(&dir, &source).unwrap();
        assert_eq!(second.name, "Таблиця (2).XLSX");
        assert_eq!(
            fs::read(dir.join("Таблиця.XLSX")).unwrap(),
            b"PK\x03\x04synthetic"
        );

        let pdf = source_dir.path().join("Наказ.pdf");
        write(&pdf, b"%PDF-1.4 synthetic");
        let pdf_item = add(&dir, &pdf).unwrap();
        assert_eq!(pdf_item.app, None);
        assert_eq!(pdf_item.ext, "pdf");

        // Підтека й посилання в списку не з'являються.
        fs::create_dir(dir.join("sub")).unwrap();
        let names: Vec<_> = list(&dir).unwrap().into_iter().map(|f| f.name).collect();
        assert_eq!(
            names,
            vec!["Наказ.pdf", "Таблиця (2).XLSX", "Таблиця.XLSX"],
            "за назвою без урахування регістру"
        );

        let (stat_item, path) = stat(&dir, "Наказ.pdf").unwrap();
        assert_eq!(stat_item, pdf_item);
        assert_eq!(path, dir.join("Наказ.pdf"));

        assert_eq!(delete(&dir, "Наказ.pdf").unwrap(), "Наказ.pdf");
        assert!(!dir.join("Наказ.pdf").exists());
        assert_eq!(
            delete(&dir, "Наказ.pdf"),
            Err(WorkspaceFilesError::NotFound("Наказ.pdf".to_owned()))
        );
        assert_eq!(
            delete(&dir, "sub"),
            Err(WorkspaceFilesError::NotRegular("sub".to_owned()))
        );
        assert_eq!(delete(&dir, "../x"), Err(WorkspaceFilesError::InvalidName));
        assert_eq!(
            resolve(&dir, "..").unwrap_err(),
            WorkspaceFilesError::InvalidName
        );
    }

    #[test]
    fn empty_and_missing_sources_are_refused() {
        let source_dir = temp_dir();
        let store = temp_dir();
        let empty = source_dir.path().join("порожній.txt");
        write(&empty, b"");
        assert_eq!(add(store.path(), &empty), Err(WorkspaceFilesError::Empty));
        assert!(matches!(
            add(store.path(), &source_dir.path().join("немає.txt")),
            Err(WorkspaceFilesError::Io(_))
        ));
        assert!(matches!(
            add(store.path(), source_dir.path()),
            Err(WorkspaceFilesError::InvalidName) | Err(WorkspaceFilesError::Io(_))
        ));
        assert_eq!(list(store.path()).unwrap(), Vec::new());
    }

    #[test]
    fn unique_name_without_extension() {
        let dir = temp_dir();
        write(&dir.path().join("README"), b"x");
        write(&dir.path().join("README (2)"), b"x");
        assert_eq!(unique_name(dir.path(), "README"), "README (3)");
        assert_eq!(unique_name(dir.path(), "new.txt"), "new.txt");
    }
}
