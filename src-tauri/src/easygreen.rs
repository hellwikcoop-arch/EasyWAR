//! EasyGreen — вбудовані електронні таблиці (прототип на веб-збірці GridCraft).
//!
//! Таблиця працює у вікні застосунку й не має доступу до файлової системи: усе, що вона
//! зберігає (книга `.xlsx`, експорт у PDF, CSV чи HTML), передається сюди байтами, а файл
//! обирає користувач у системному вікні збереження. Таблиці, прив'язані до профілів, і їхні
//! ротовані копії EasyGreen не перезаписує: сире джерело змінюється лише штатним записом
//! таблиці профілю, а з EasyGreen зберігаємо в інший файл.

use std::path::{Path, PathBuf};

/// Найбільший файл, який EasyGreen може зберегти (так само, як ліміт таблиць у застосунку).
pub const MAX_SAVE_BYTES: usize = 256 * 1024 * 1024;

/// Найдовша назва файлу, яку пропонуємо у вікні збереження.
const MAX_FILE_NAME_CHARS: usize = 180;

/// Розширення, які EasyGreen зберігає, з назвою фільтра у вікні збереження.
const KINDS: &[(&str, &str)] = &[
    ("xlsx", "Книга Excel (*.xlsx)"),
    ("pdf", "Документ PDF (*.pdf)"),
    ("csv", "Текст CSV (*.csv)"),
    ("html", "Вебсторінка (*.html)"),
];

/// Що саме зберігаємо: розширення і назва фільтра у вікні збереження.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct SaveKind {
    pub extension: &'static str,
    pub filter: &'static str,
}

#[derive(Debug, thiserror::Error, PartialEq, Eq)]
pub enum EasyGreenError {
    #[error("файл порожній")]
    Empty,
    #[error("файл завеликий для збереження (понад 256 МБ)")]
    TooLarge,
    #[error("EasyGreen зберігає лише .xlsx, .pdf, .csv і .html")]
    UnsupportedKind,
    #[error(
        "«{0}» — таблиця профілю EasyWAR або її резервна копія; EasyGreen її не перезаписує. \
         Збережіть під іншою назвою."
    )]
    ProtectedTable(String),
}

/// Розширення файлу, який передала таблиця, — лише з дозволеного переліку.
pub fn save_kind(file_name: &str) -> Result<SaveKind, EasyGreenError> {
    let extension = Path::new(file_name)
        .extension()
        .and_then(|extension| extension.to_str())
        .map(str::to_ascii_lowercase)
        .ok_or(EasyGreenError::UnsupportedKind)?;
    let extension = if extension == "htm" {
        "html".to_owned()
    } else {
        extension
    };
    KINDS
        .iter()
        .find(|(kind, _)| *kind == extension)
        .map(|(extension, filter)| SaveKind { extension, filter })
        .ok_or(EasyGreenError::UnsupportedKind)
}

/// Перевіряє байти перед відкриттям вікна збереження.
pub fn check_bytes(bytes: &[u8]) -> Result<(), EasyGreenError> {
    if bytes.is_empty() {
        return Err(EasyGreenError::Empty);
    }
    if bytes.len() > MAX_SAVE_BYTES {
        return Err(EasyGreenError::TooLarge);
    }
    Ok(())
}

/// Назва, яку пропонуємо у вікні збереження: лише ім'я файлу, без теки й керівних символів.
pub fn suggested_file_name(file_name: &str, kind: SaveKind) -> String {
    let base = file_name.rsplit(['/', '\\']).next().unwrap_or_default();
    let cleaned: String = base
        .chars()
        .filter(|character| !character.is_control())
        .take(MAX_FILE_NAME_CHARS)
        .collect();
    let cleaned = cleaned.trim().trim_start_matches('.').trim();
    if cleaned.is_empty() {
        format!("Книга.{}", kind.extension)
    } else {
        cleaned.to_owned()
    }
}

/// Чи вказує `target` на таблицю профілю або на її ротовану копію `<назва>.easywar-prev.xlsx`.
/// Шляхи порівнюються після розкриття символьних посилань, якщо файли існують.
pub fn is_protected_table(target: &Path, bound_tables: &[PathBuf]) -> bool {
    let target = normalized(target);
    bound_tables.iter().any(|table| {
        let table = normalized(table);
        target == table || target == normalized(&previous_copy(&table))
    })
}

fn previous_copy(table: &Path) -> PathBuf {
    let stem = table
        .file_stem()
        .map(|stem| stem.to_string_lossy().into_owned())
        .unwrap_or_default();
    table.with_file_name(format!("{stem}.easywar-prev.xlsx"))
}

fn normalized(path: &Path) -> PathBuf {
    if let Ok(canonical) = path.canonicalize() {
        return canonical;
    }
    // Файлу ще немає: розкриваємо теку, якщо вона є, і дописуємо ім'я.
    match (path.parent(), path.file_name()) {
        (Some(parent), Some(name)) if !parent.as_os_str().is_empty() => parent
            .canonicalize()
            .map(|parent| parent.join(name))
            .unwrap_or_else(|_| path.to_path_buf()),
        _ => path.to_path_buf(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_known_kinds_are_saved() {
        assert_eq!(save_kind("Звіт.xlsx").unwrap().extension, "xlsx");
        assert_eq!(save_kind("ЗВІТ.XLSX").unwrap().extension, "xlsx");
        assert_eq!(save_kind("аркуш.pdf").unwrap().extension, "pdf");
        assert_eq!(save_kind("аркуш.csv").unwrap().extension, "csv");
        assert_eq!(save_kind("сторінка.htm").unwrap().extension, "html");
        for name in ["скрипт.sh", "книга.xlsm", "без розширення", "", ".xlsx.exe"]
        {
            assert_eq!(
                save_kind(name),
                Err(EasyGreenError::UnsupportedKind),
                "{name}"
            );
        }
    }

    #[test]
    fn bytes_must_be_present_and_bounded() {
        assert_eq!(check_bytes(&[]), Err(EasyGreenError::Empty));
        assert_eq!(check_bytes(b"PK"), Ok(()));
        assert_eq!(
            check_bytes(&vec![0; MAX_SAVE_BYTES + 1]),
            Err(EasyGreenError::TooLarge)
        );
    }

    #[test]
    fn suggested_name_drops_folders_and_control_characters() {
        let xlsx = save_kind("a.xlsx").unwrap();
        assert_eq!(
            suggested_file_name("../../etc/Звіт.xlsx", xlsx),
            "Звіт.xlsx"
        );
        assert_eq!(
            suggested_file_name("C:\\Users\\x\\Звіт.xlsx", xlsx),
            "Звіт.xlsx"
        );
        assert_eq!(suggested_file_name("Зві\u{0}т\n.xlsx", xlsx), "Звіт.xlsx");
        assert_eq!(suggested_file_name("   ", xlsx), "Книга.xlsx");
        assert_eq!(suggested_file_name(".hidden", xlsx), "hidden");
        assert_eq!(
            suggested_file_name(&"а".repeat(500), xlsx).chars().count(),
            MAX_FILE_NAME_CHARS
        );
    }

    #[test]
    fn profile_tables_and_their_copies_are_protected() {
        let folder = tempfile::tempdir().unwrap();
        let table = folder.path().join("air.xlsx");
        std::fs::write(&table, b"synthetic").unwrap();
        let bound = vec![table.clone()];
        assert!(is_protected_table(&table, &bound));
        assert!(is_protected_table(
            &folder.path().join("air.easywar-prev.xlsx"),
            &bound
        ));
        assert!(is_protected_table(
            &folder.path().join(".").join("air.xlsx"),
            &bound
        ));
        assert!(!is_protected_table(
            &folder.path().join("air-копія.xlsx"),
            &bound
        ));
        assert!(!is_protected_table(&table, &[]));
    }

    #[cfg(unix)]
    #[test]
    fn a_symlink_to_a_profile_table_is_protected() {
        let folder = tempfile::tempdir().unwrap();
        let table = folder.path().join("pvk.xlsx");
        std::fs::write(&table, b"synthetic").unwrap();
        let link = folder.path().join("посилання.xlsx");
        std::os::unix::fs::symlink(&table, &link).unwrap();
        assert!(is_protected_table(&link, &[table]));
    }
}
