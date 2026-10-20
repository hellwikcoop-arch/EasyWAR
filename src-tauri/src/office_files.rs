//! Відкриття й збереження файлів застосунків розділу «Офіс» (модуль «Робоче середовище»).
//!
//! Застосунок не бачить шляхів: після вікна вибору чи збереження Rust запам'ятовує шлях
//! під непрозорим номером (`handle`) разом з профілем, який його відкрив, а інтерфейс
//! отримує лише номер, назву файлу й байти. «Зберегти» пише за номером у той самий файл;
//! номер з іншого профілю не приймається. Номери живуть лише в пам'яті процесу.
//! Запис — атомарний ([`crate::phone_export::save_file`]). Таблиці, прив'язані до профілів,
//! і їхні ротовані копії не перезаписуються (сире джерело змінюється лише штатним записом
//! таблиці профілю): [`is_protected_table`], перенесено з прототипу EasyGreen.
//!
//! Ізоляція (F-01, T-Office-06): код сторонніх редакторів працює лише в окремому вікні
//! [`EDITOR_WINDOW_LABEL`], чия capability дозволяє тільки команди `office_*`. Кожна з них
//! додатково перевіряє мітку webview, яку дає Tauri (не JavaScript), а номер файлу
//! прив'язаний і до профілю, і до цієї мітки.

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::Mutex;

/// Мітка вікна, у якому працюють редактори «Офісу» (див. `capabilities/office-editor.json`).
pub const EDITOR_WINDOW_LABEL: &str = "office-editor";
/// Застосунки «Офісу», які можна відкрити у вікні редактора.
pub const EDITOR_APPS: [&str; 4] = ["easygreen", "easydoc", "easyslide", "easyfly"];

/// Найбільший файл, який застосунок може відкрити або зберегти.
pub const MAX_FILE_BYTES: usize = 256 * 1024 * 1024;
/// Найбільше розширень в одному фільтрі вікна.
pub const MAX_EXTENSIONS: usize = 8;
const MAX_EXTENSION_LEN: usize = 10;
const MAX_LABEL_CHARS: usize = 80;

#[derive(Debug, thiserror::Error, PartialEq, Eq)]
pub enum OfficeFileError {
    #[error("недопустиме розширення файлу «{0}»")]
    InvalidExtension(String),
    #[error("потрібне щонайменше одне розширення файлу")]
    NoExtensions,
    #[error("забагато розширень файлу (не більше {MAX_EXTENSIONS})")]
    TooManyExtensions,
    #[error("файл більший за {} МБ", MAX_FILE_BYTES / (1024 * 1024))]
    TooLarge,
    #[error("файл порожній")]
    Empty,
    #[error("файл більше не відкритий у цьому профілі; збережіть його через «Зберегти як…»")]
    UnknownHandle,
    #[error("«{0}» — таблиця, прив'язана до профілю EasyWAR; збережіть під іншою назвою")]
    ProtectedTable(String),
    #[error("файли «Офісу» відкриваються лише у вікні редактора")]
    NotEditorWindow,
    #[error("невідомий застосунок «Офісу»")]
    UnknownApp,
}

/// Команди `office_*` приймаються лише з вікна редактора. Мітку дає Tauri.
pub fn ensure_editor_window(label: &str) -> Result<(), OfficeFileError> {
    if label == EDITOR_WINDOW_LABEL {
        Ok(())
    } else {
        Err(OfficeFileError::NotEditorWindow)
    }
}

/// Перевірений ідентифікатор застосунку для вікна редактора.
pub fn editor_app(id: &str) -> Result<&'static str, OfficeFileError> {
    EDITOR_APPS
        .iter()
        .copied()
        .find(|app| *app == id)
        .ok_or(OfficeFileError::UnknownApp)
}

/// Скрипт ініціалізації вікна редактора: каже оболонці, який застосунок відкрити.
pub fn editor_init_script(app: &'static str) -> String {
    format!(
        "Object.defineProperty(window, '__EW_EDITOR_APP', {{ value: '{app}', writable: false, configurable: false }});"
    )
}

/// Чи є `target` таблицею, прив'язаною до профілю, або її ротованою копією
/// (`<назва>.easywar-prev.xlsx`). Шляхи порівнюються після розкриття посилань.
pub fn is_protected_table(target: &Path, bound_tables: &[PathBuf]) -> bool {
    let target = normalized(target);
    bound_tables.iter().any(|table| {
        let table = normalized(table);
        target == table || target == normalized(&previous_copy(&table))
    })
}

/// Помилка [`OfficeFileError::ProtectedTable`], якщо запис у `target` заборонено.
pub fn ensure_not_protected(
    target: &Path,
    bound_tables: &[PathBuf],
) -> Result<(), OfficeFileError> {
    if is_protected_table(target, bound_tables) {
        return Err(OfficeFileError::ProtectedTable(file_name(target)));
    }
    Ok(())
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

/// Перевіряє й нормалізує розширення (без крапки, малими літерами, лише латиниця й цифри).
pub fn normalize_extensions(extensions: &[String]) -> Result<Vec<String>, OfficeFileError> {
    if extensions.is_empty() {
        return Err(OfficeFileError::NoExtensions);
    }
    if extensions.len() > MAX_EXTENSIONS {
        return Err(OfficeFileError::TooManyExtensions);
    }
    let mut normalized: Vec<String> = Vec::with_capacity(extensions.len());
    for raw in extensions {
        let extension = raw.trim().trim_start_matches('.').to_ascii_lowercase();
        let valid = !extension.is_empty()
            && extension.len() <= MAX_EXTENSION_LEN
            && extension.chars().all(|c| c.is_ascii_alphanumeric());
        if !valid {
            return Err(OfficeFileError::InvalidExtension(raw.clone()));
        }
        if !normalized.contains(&extension) {
            normalized.push(extension);
        }
    }
    Ok(normalized)
}

/// Підпис вікна або фільтра: без керівних символів і не довший за 80 знаків.
pub fn clean_label(label: Option<&str>, fallback: &str) -> String {
    let cleaned: String = label
        .unwrap_or_default()
        .chars()
        .filter(|c| !c.is_control())
        .take(MAX_LABEL_CHARS)
        .collect();
    let cleaned = cleaned.trim();
    if cleaned.is_empty() {
        fallback.to_owned()
    } else {
        cleaned.to_owned()
    }
}

/// Запропонована назва файлу без каталогів (лише остання частина шляху).
pub fn suggested_file_name(name: Option<&str>, fallback: &str) -> String {
    let base = name
        .unwrap_or_default()
        .rsplit(['/', '\\'])
        .next()
        .unwrap_or_default();
    clean_label(Some(base), fallback)
}

pub fn check_size(bytes: &[u8]) -> Result<(), OfficeFileError> {
    if bytes.is_empty() {
        return Err(OfficeFileError::Empty);
    }
    if bytes.len() > MAX_FILE_BYTES {
        return Err(OfficeFileError::TooLarge);
    }
    Ok(())
}

pub fn file_name(path: &Path) -> String {
    path.file_name()
        .map(|name| name.to_string_lossy().into_owned())
        .unwrap_or_default()
}

#[derive(Debug, Default)]
struct HandleTable {
    next: u64,
    entries: HashMap<String, HandleEntry>,
}

#[derive(Debug)]
struct HandleEntry {
    profile_id: String,
    webview: String,
    path: PathBuf,
}

impl HandleEntry {
    fn owned_by(&self, profile_id: &str, webview: &str) -> bool {
        self.profile_id == profile_id && self.webview == webview
    }
}

/// Відкриті застосунками файли: номер → (профіль, мітка webview, шлях).
#[derive(Debug, Default)]
pub struct OfficeFileHandles(Mutex<HandleTable>);

impl OfficeFileHandles {
    /// Запам'ятовує шлях для профілю й webview і повертає новий номер.
    pub fn remember(&self, profile_id: &str, webview: &str, path: PathBuf) -> String {
        let mut table = self
            .0
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        table.next += 1;
        let handle = format!("f{}", table.next);
        table.entries.insert(
            handle.clone(),
            HandleEntry {
                profile_id: profile_id.to_owned(),
                webview: webview.to_owned(),
                path,
            },
        );
        handle
    }

    /// Шлях за номером, лише якщо його відкрили той самий профіль і той самий webview.
    pub fn path(
        &self,
        profile_id: &str,
        webview: &str,
        handle: &str,
    ) -> Result<PathBuf, OfficeFileError> {
        let table = self
            .0
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        match table.entries.get(handle) {
            Some(entry) if entry.owned_by(profile_id, webview) => Ok(entry.path.clone()),
            _ => Err(OfficeFileError::UnknownHandle),
        }
    }

    /// Забуває номер (застосунок закрив файл). Чужий номер не чіпається.
    pub fn forget(&self, profile_id: &str, webview: &str, handle: &str) {
        let mut table = self
            .0
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        if table
            .entries
            .get(handle)
            .is_some_and(|entry| entry.owned_by(profile_id, webview))
        {
            table.entries.remove(handle);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn strings(values: &[&str]) -> Vec<String> {
        values.iter().map(|value| (*value).to_owned()).collect()
    }

    #[test]
    fn extensions_are_normalized_and_deduplicated() {
        assert_eq!(
            normalize_extensions(&strings(&[".XLSX", "csv", "xlsx"])).unwrap(),
            ["xlsx", "csv"]
        );
    }

    #[test]
    fn bad_extensions_are_rejected() {
        assert_eq!(
            normalize_extensions(&[]),
            Err(OfficeFileError::NoExtensions)
        );
        assert!(matches!(
            normalize_extensions(&strings(&["../x"])),
            Err(OfficeFileError::InvalidExtension(_))
        ));
        assert!(matches!(
            normalize_extensions(&strings(&["docx;rm"])),
            Err(OfficeFileError::InvalidExtension(_))
        ));
        assert_eq!(
            normalize_extensions(&strings(&["a", "b", "c", "d", "e", "f", "g", "h", "i"])),
            Err(OfficeFileError::TooManyExtensions)
        );
    }

    #[test]
    fn labels_and_names_drop_paths_and_control_characters() {
        assert_eq!(clean_label(Some("  \u{7}Звіт\n "), "x"), "Звіт");
        assert_eq!(clean_label(None, "Типово"), "Типово");
        assert_eq!(
            suggested_file_name(Some("../../etc/звіт.docx"), "x"),
            "звіт.docx"
        );
        assert_eq!(suggested_file_name(Some("C:\\a\\b.xlsx"), "x"), "b.xlsx");
        assert_eq!(suggested_file_name(Some(""), "Документ"), "Документ");
    }

    #[test]
    fn size_limits_apply() {
        assert_eq!(check_size(&[]), Err(OfficeFileError::Empty));
        assert!(check_size(b"x").is_ok());
        assert_eq!(
            check_size(&vec![0; MAX_FILE_BYTES + 1]),
            Err(OfficeFileError::TooLarge)
        );
    }

    #[test]
    fn handles_belong_to_the_profile_that_opened_the_file() {
        let handles = OfficeFileHandles::default();
        let editor = EDITOR_WINDOW_LABEL;
        let first = handles.remember("p1", editor, PathBuf::from("/tmp/a.xlsx"));
        let second = handles.remember("p1", editor, PathBuf::from("/tmp/b.xlsx"));
        assert_ne!(first, second);
        assert_eq!(
            handles.path("p1", editor, &first).unwrap(),
            PathBuf::from("/tmp/a.xlsx")
        );
        assert_eq!(
            handles.path("p2", editor, &first),
            Err(OfficeFileError::UnknownHandle)
        );
        handles.forget("p2", editor, &first);
        assert!(handles.path("p1", editor, &first).is_ok());
        handles.forget("p1", editor, &first);
        assert_eq!(
            handles.path("p1", editor, &first),
            Err(OfficeFileError::UnknownHandle)
        );
        assert_eq!(file_name(Path::new("/tmp/b.xlsx")), "b.xlsx");
    }

    #[test]
    fn handles_belong_to_the_webview_that_opened_the_file() {
        let handles = OfficeFileHandles::default();
        let handle = handles.remember("p1", EDITOR_WINDOW_LABEL, PathBuf::from("/tmp/a.docx"));
        assert_eq!(
            handles.path("p1", "main", &handle),
            Err(OfficeFileError::UnknownHandle)
        );
        handles.forget("p1", "main", &handle);
        assert!(handles.path("p1", EDITOR_WINDOW_LABEL, &handle).is_ok());
    }

    #[test]
    fn office_commands_accept_only_the_editor_window() {
        assert_eq!(ensure_editor_window(EDITOR_WINDOW_LABEL), Ok(()));
        for label in [
            "main",
            "",
            "office-editor-2",
            "Office-Editor",
            "office-editor ",
        ] {
            assert_eq!(
                ensure_editor_window(label),
                Err(OfficeFileError::NotEditorWindow),
                "{label:?}"
            );
        }
    }

    #[test]
    fn editor_opens_only_known_apps() {
        for app in EDITOR_APPS {
            assert_eq!(editor_app(app), Ok(app));
            assert!(editor_init_script(editor_app(app).unwrap()).contains(&format!("'{app}'")));
        }
        for id in [
            "",
            "EasyDoc",
            "easydoc'",
            "../easydoc",
            "easydoc');alert(1);//",
        ] {
            assert_eq!(editor_app(id), Err(OfficeFileError::UnknownApp), "{id:?}");
        }
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
        assert_eq!(
            ensure_not_protected(&table, &bound),
            Err(OfficeFileError::ProtectedTable("air.xlsx".to_owned()))
        );
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
