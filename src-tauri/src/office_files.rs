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
//!
//! Документ захищеної бібліотеки ([`crate::office_library`]) редактор отримує тим самим
//! `office_open_file`: головне вікно лишає «очікуваний файл» ([`PendingFile`]) для профілю
//! й застосунку, вікно редактора забирає його один раз без вікна вибору. Номер такого файлу
//! вказує не на шлях, а на документ і версію, від якої почато правку ([`LibraryTarget`]);
//! «Зберегти» додає нову версію. Очікуваний файл зникає, щойно його забрали, коли вікно
//! редактора закрилося або бібліотеку заблоковано.

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::Mutex;

/// Мітка вікна, у якому працюють редактори «Офісу» (див. `capabilities/office-editor.json`).
pub const EDITOR_WINDOW_LABEL: &str = "office-editor";
/// Застосунки модуля «Робоче середовище» (розділи «Офіс», «Особисте» і «Авіація»), які можна відкрити у вікні
/// редактора. easyPay теж тут: його файл `.easypay` ходить лише через команди `office_*`, а вони
/// приймають тільки це вікно. Збіг зі списком підключених застосунків перевіряє
/// `tests/office-isolation.test.mjs`.
pub const EDITOR_APPS: [&str; 6] = [
    "easygreen",
    "easydoc",
    "easyslide",
    "easypay",
    "easyfly",
    "collectives",
];

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
    #[error("вміст не відповідає формату «.{0}»; збережіть документ через «Зберегти як…»")]
    LibraryFormat(String),
    #[error("це не звичайний файл")]
    NotRegularFile,
    #[error(
        "бібліотека заблокована: розблокуйте її в головному вікні й натисніть «Зберегти» ще раз"
    )]
    LibraryLocked,
}

/// Відкриває для читання лише звичайний файл: FIFO чи пристрій заблокували б читання
/// назавжди (або віддавали б байти без кінця), тека — не документ. Тип перевіряється
/// за шляхом (після символьних посилань) до відкриття й ще раз за відкритим дескриптором.
pub fn open_regular_file(path: &Path) -> Result<std::fs::File, String> {
    let regular = std::fs::metadata(path)
        .map_err(|error| error.to_string())?
        .is_file();
    if !regular {
        return Err(OfficeFileError::NotRegularFile.to_string());
    }
    let file = open_without_blocking(path).map_err(|error| error.to_string())?;
    if !file
        .metadata()
        .map_err(|error| error.to_string())?
        .is_file()
    {
        return Err(OfficeFileError::NotRegularFile.to_string());
    }
    Ok(file)
}

/// Відкриття без очікування співрозмовника: FIFO, підсунутий між перевіркою типу й
/// відкриттям, інакше заблокував би `open` назавжди. Звичайні файли прапорець не зачіпає.
#[cfg(unix)]
fn open_without_blocking(path: &Path) -> std::io::Result<std::fs::File> {
    use std::os::unix::fs::OpenOptionsExt;
    #[cfg(target_os = "linux")]
    const O_NONBLOCK: i32 = 0o4000;
    #[cfg(not(target_os = "linux"))]
    const O_NONBLOCK: i32 = 0x0004;
    std::fs::OpenOptions::new()
        .read(true)
        .custom_flags(O_NONBLOCK)
        .open(path)
}

#[cfg(not(unix))]
fn open_without_blocking(path: &Path) -> std::io::Result<std::fs::File> {
    std::fs::File::open(path)
}

/// Читає звичайний файл ([`open_regular_file`]), не більше `max` байтів; більший файл —
/// помилка з текстом `too_large`.
pub fn read_regular_file(path: &Path, max: usize, too_large: &str) -> Result<Vec<u8>, String> {
    use std::io::Read;
    let file = open_regular_file(path)?;
    let mut bytes = Vec::new();
    file.take(max as u64 + 1)
        .read_to_end(&mut bytes)
        .map_err(|error| error.to_string())?;
    if bytes.len() > max {
        return Err(too_large.to_owned());
    }
    Ok(bytes)
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

/// Скрипт ініціалізації вікна редактора: каже оболонці, який застосунок відкрити, і назву
/// документа бібліотеки, що чекає на відкриття (`__EW_PENDING_FILE`: рядок або `null`).
/// Назва вставляється як JSON-рядок, тож лапки й керівні символи не виходять за літерал.
pub fn editor_init_script(app: &'static str, pending: Option<&str>) -> String {
    let pending = serde_json::to_string(&pending)
        .unwrap_or_else(|_| "null".to_owned())
        .replace('\u{2028}', "\\u2028")
        .replace('\u{2029}', "\\u2029");
    format!(
        "Object.defineProperty(window, '__EW_EDITOR_APP', {{ value: '{app}', writable: false, configurable: false }});\
         Object.defineProperty(window, '__EW_PENDING_FILE', {{ value: {pending}, writable: false, configurable: false }});"
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

/// Документ бібліотеки, на який вказує номер файлу: правка почалася від `base_version_id`.
/// `name` — назва файлу для редактора (`<назва>.<розширення>`). `library_tag` —
/// [`crate::office_library::LibraryKeys::handle_tag`] бібліотеки, з якої документ
/// відкрито: номер пише лише в ту саму бібліотеку (після блокування й нового
/// розблокування — так, у створену наново чи в іншу — ні).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct LibraryTarget {
    pub item_id: String,
    pub base_version_id: String,
    pub ext: String,
    pub name: String,
    pub library_tag: String,
}

/// Нова версія документа бібліотеки має той самий формат, що й документ: книга, документ
/// і презентація — це ZIP (OOXML), а `.txt` і `.csv` — ні. Так редактор не підмінить
/// формат під тим самим розширенням.
pub fn ensure_library_format(ext: &str, bytes: &[u8]) -> Result<(), OfficeFileError> {
    let zip = bytes.starts_with(b"PK\x03\x04");
    let matches = match ext {
        "docx" | "xlsx" | "pptx" => zip,
        "txt" | "csv" => !zip,
        _ => false,
    };
    if matches {
        Ok(())
    } else {
        Err(OfficeFileError::LibraryFormat(ext.to_owned()))
    }
}

/// Куди пише номер файлу: у файл на диску або новою версією документа бібліотеки.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum HandleTarget {
    Disk(PathBuf),
    Library(LibraryTarget),
}

/// Звідки взяти очікуваний файл: версія документа бібліотеки або файл сховища
/// «Робочого середовища» на диску (`workspace_files`).
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum PendingSource {
    Library { version_id: String },
    Disk { path: PathBuf },
}

/// Документ бібліотеки чи файл сховища, який головне вікно передало редактору: його
/// забирає перший `office_open_file` того самого профілю й застосунку з відповідним
/// розширенням.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PendingFile {
    pub profile_id: String,
    pub app: &'static str,
    pub source: PendingSource,
    pub ext: String,
    pub name: String,
}

#[derive(Debug, Default)]
struct HandleTable {
    next: u64,
    entries: HashMap<String, HandleEntry>,
    pending: Option<PendingFile>,
    /// Застосунок, відкритий у вікні редактора зараз (`None` — вікна немає).
    editor_app: Option<&'static str>,
}

#[derive(Debug)]
struct HandleEntry {
    profile_id: String,
    webview: String,
    target: HandleTarget,
}

impl HandleEntry {
    fn owned_by(&self, profile_id: &str, webview: &str) -> bool {
        self.profile_id == profile_id && self.webview == webview
    }
}

/// Відкриті застосунками файли: номер → (профіль, мітка webview, шлях або документ
/// бібліотеки), а також очікуваний документ бібліотеки й застосунок вікна редактора.
#[derive(Debug, Default)]
pub struct OfficeFileHandles(Mutex<HandleTable>);

impl OfficeFileHandles {
    fn table(&self) -> std::sync::MutexGuard<'_, HandleTable> {
        self.0
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
    }

    fn insert(&self, profile_id: &str, webview: &str, target: HandleTarget) -> String {
        let mut table = self.table();
        table.next += 1;
        let handle = format!("f{}", table.next);
        table.entries.insert(
            handle.clone(),
            HandleEntry {
                profile_id: profile_id.to_owned(),
                webview: webview.to_owned(),
                target,
            },
        );
        handle
    }

    /// Запам'ятовує шлях для профілю й webview і повертає новий номер.
    pub fn remember(&self, profile_id: &str, webview: &str, path: PathBuf) -> String {
        self.insert(profile_id, webview, HandleTarget::Disk(path))
    }

    /// Запам'ятовує документ бібліотеки для профілю й webview і повертає новий номер.
    pub fn remember_library(
        &self,
        profile_id: &str,
        webview: &str,
        target: LibraryTarget,
    ) -> String {
        self.insert(profile_id, webview, HandleTarget::Library(target))
    }

    /// Ціль за номером, лише якщо його відкрили той самий профіль і той самий webview.
    pub fn target(
        &self,
        profile_id: &str,
        webview: &str,
        handle: &str,
    ) -> Result<HandleTarget, OfficeFileError> {
        match self.table().entries.get(handle) {
            Some(entry) if entry.owned_by(profile_id, webview) => Ok(entry.target.clone()),
            _ => Err(OfficeFileError::UnknownHandle),
        }
    }

    /// Шлях за номером, лише якщо його відкрили той самий профіль і той самий webview
    /// і номер вказує на файл на диску.
    pub fn path(
        &self,
        profile_id: &str,
        webview: &str,
        handle: &str,
    ) -> Result<PathBuf, OfficeFileError> {
        match self.target(profile_id, webview, handle)? {
            HandleTarget::Disk(path) => Ok(path),
            HandleTarget::Library(_) => Err(OfficeFileError::UnknownHandle),
        }
    }

    /// Після збереження нової версії наступна правка рахується від неї.
    pub fn set_library_base(
        &self,
        profile_id: &str,
        webview: &str,
        handle: &str,
        version_id: &str,
    ) -> Result<(), OfficeFileError> {
        let mut table = self.table();
        match table.entries.get_mut(handle) {
            Some(HandleEntry {
                profile_id: owner,
                webview: owner_webview,
                target: HandleTarget::Library(target),
            }) if owner == profile_id && owner_webview == webview => {
                target.base_version_id = version_id.to_owned();
                Ok(())
            }
            _ => Err(OfficeFileError::UnknownHandle),
        }
    }

    /// Забуває номер (застосунок закрив файл). Чужий номер не чіпається.
    pub fn forget(&self, profile_id: &str, webview: &str, handle: &str) {
        let mut table = self.table();
        if table
            .entries
            .get(handle)
            .is_some_and(|entry| entry.owned_by(profile_id, webview))
        {
            table.entries.remove(handle);
        }
    }

    /// Забуває всі номери webview: вікно закрилося, а новий застосунок у ньому
    /// не має писати у файли попереднього.
    pub fn forget_webview(&self, webview: &str) {
        self.table()
            .entries
            .retain(|_, entry| entry.webview != webview);
    }

    /// Лишає документ бібліотеки для наступного вікна редактора (попередній замінюється).
    pub fn set_pending(&self, pending: PendingFile) {
        self.table().pending = Some(pending);
    }

    /// Забирає очікуваний документ один раз, якщо він для цього профілю й застосунку
    /// і його розширення є серед запитаних. Інакше документ лишається чекати.
    pub fn take_pending(
        &self,
        profile_id: &str,
        app: &str,
        extensions: &[String],
    ) -> Option<PendingFile> {
        let mut table = self.table();
        let matches = table.pending.as_ref().is_some_and(|pending| {
            pending.profile_id == profile_id
                && pending.app == app
                && extensions.contains(&pending.ext)
        });
        if matches {
            table.pending.take()
        } else {
            None
        }
    }

    /// Чи чекає документ бібліотеки на вікно редактора.
    pub fn has_pending(&self) -> bool {
        self.table().pending.is_some()
    }

    /// Прибирає очікуваний документ (вікно закрилося, бібліотеку заблоковано).
    pub fn clear_pending(&self) {
        self.table().pending = None;
    }

    /// Записує, який застосунок відкрито у вікні редактора (`None` — вікно закрилося).
    pub fn set_editor_window_app(&self, app: Option<&'static str>) {
        self.table().editor_app = app;
    }

    /// Застосунок, відкритий у вікні редактора зараз.
    pub fn editor_window_app(&self) -> Option<&'static str> {
        self.table().editor_app
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
            let script = editor_init_script(editor_app(app).unwrap(), None);
            assert!(script.contains(&format!("'{app}'")));
            assert!(script.contains("'__EW_PENDING_FILE', { value: null, writable: false"));
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

    fn library_target(item: &str, version: &str) -> LibraryTarget {
        LibraryTarget {
            item_id: item.to_owned(),
            base_version_id: version.to_owned(),
            ext: "docx".to_owned(),
            name: "Довідка.docx".to_owned(),
            library_tag: "синтетична мітка".to_owned(),
        }
    }

    #[test]
    fn library_versions_keep_the_document_format() {
        assert_eq!(ensure_library_format("docx", b"PK\x03\x04rest"), Ok(()));
        assert_eq!(ensure_library_format("csv", "a;b".as_bytes()), Ok(()));
        assert_eq!(
            ensure_library_format("txt", b"PK\x03\x04rest"),
            Err(OfficeFileError::LibraryFormat("txt".to_owned()))
        );
        assert_eq!(
            ensure_library_format("pptx", b"plain text"),
            Err(OfficeFileError::LibraryFormat("pptx".to_owned()))
        );
        assert!(ensure_library_format("png", b"PK\x03\x04").is_err());
    }

    fn pending(profile: &str, app: &'static str, ext: &str) -> PendingFile {
        PendingFile {
            profile_id: profile.to_owned(),
            app,
            source: PendingSource::Library {
                version_id: "ver-1".to_owned(),
            },
            ext: ext.to_owned(),
            name: format!("Довідка.{ext}"),
        }
    }

    #[test]
    fn pending_file_name_is_a_json_literal() {
        let script = editor_init_script("easydoc", Some("Звіт \"№1\"\u{2028}');alert(1);//"));
        assert!(script.contains(
            "'__EW_PENDING_FILE', { value: \"Звіт \\\"№1\\\"\\u2028');alert(1);//\", writable: false, configurable: false }"
        ));
        assert!(!script.contains('\u{2028}'));
    }

    #[test]
    fn pending_file_is_taken_once_by_the_same_profile_and_app() {
        let handles = OfficeFileHandles::default();
        let docx = strings(&["docx", "txt"]);
        assert_eq!(handles.take_pending("p1", "easydoc", &docx), None);
        handles.set_pending(pending("p1", "easydoc", "docx"));
        assert!(handles.has_pending());
        assert_eq!(handles.take_pending("p2", "easydoc", &docx), None);
        assert_eq!(handles.take_pending("p1", "easygreen", &docx), None);
        // Запит зображення в EasySlide чи EasyDoc не забирає документ.
        assert_eq!(
            handles.take_pending("p1", "easydoc", &strings(&["png"])),
            None
        );
        let taken = handles.take_pending("p1", "easydoc", &docx).unwrap();
        assert_eq!(
            taken.source,
            PendingSource::Library {
                version_id: "ver-1".to_owned()
            }
        );
        assert_eq!(handles.take_pending("p1", "easydoc", &docx), None);
        assert!(!handles.has_pending());

        handles.set_pending(pending("p1", "easyslide", "pptx"));
        handles.clear_pending();
        assert_eq!(
            handles.take_pending("p1", "easyslide", &strings(&["pptx"])),
            None
        );
    }

    #[test]
    fn editor_window_app_is_recorded_and_cleared() {
        let handles = OfficeFileHandles::default();
        assert_eq!(handles.editor_window_app(), None);
        handles.set_editor_window_app(Some("easygreen"));
        assert_eq!(handles.editor_window_app(), Some("easygreen"));
        handles.set_editor_window_app(None);
        assert_eq!(handles.editor_window_app(), None);
    }

    #[test]
    fn library_handles_belong_to_their_profile_and_webview() {
        let handles = OfficeFileHandles::default();
        let editor = EDITOR_WINDOW_LABEL;
        let handle = handles.remember_library("p1", editor, library_target("doc-1", "ver-1"));
        assert_eq!(
            handles.target("p1", editor, &handle),
            Ok(HandleTarget::Library(library_target("doc-1", "ver-1")))
        );
        // Номер документа бібліотеки не дає шляху для запису на диск.
        assert_eq!(
            handles.path("p1", editor, &handle),
            Err(OfficeFileError::UnknownHandle)
        );
        assert_eq!(
            handles.target("p2", editor, &handle),
            Err(OfficeFileError::UnknownHandle)
        );
        assert_eq!(
            handles.target("p1", "main", &handle),
            Err(OfficeFileError::UnknownHandle)
        );
        assert_eq!(
            handles.set_library_base("p2", editor, &handle, "ver-2"),
            Err(OfficeFileError::UnknownHandle)
        );
        handles
            .set_library_base("p1", editor, &handle, "ver-2")
            .unwrap();
        assert_eq!(
            handles.target("p1", editor, &handle),
            Ok(HandleTarget::Library(library_target("doc-1", "ver-2")))
        );
        let disk = handles.remember("p1", editor, PathBuf::from("/tmp/a.docx"));
        assert_eq!(
            handles.set_library_base("p1", editor, &disk, "ver-3"),
            Err(OfficeFileError::UnknownHandle)
        );
        handles.forget("p1", editor, &handle);
        assert_eq!(
            handles.target("p1", editor, &handle),
            Err(OfficeFileError::UnknownHandle)
        );
        let other = handles.remember("p1", "main", PathBuf::from("/tmp/b.docx"));
        handles.forget_webview(editor);
        assert_eq!(
            handles.path("p1", editor, &disk),
            Err(OfficeFileError::UnknownHandle)
        );
        assert!(handles.path("p1", "main", &other).is_ok());
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

    #[test]
    fn only_regular_files_are_opened() {
        let folder = tempfile::tempdir().unwrap();
        let file = folder.path().join("документ.txt");
        std::fs::write(&file, "синтетичний вміст").unwrap();
        assert_eq!(
            read_regular_file(&file, 1024, "завеликий").unwrap(),
            "синтетичний вміст".as_bytes()
        );
        assert_eq!(
            read_regular_file(&file, 4, "завеликий").unwrap_err(),
            "завеликий"
        );
        assert_eq!(
            read_regular_file(folder.path(), 1024, "завеликий").unwrap_err(),
            OfficeFileError::NotRegularFile.to_string()
        );
        assert!(read_regular_file(&folder.path().join("немає.txt"), 1024, "завеликий").is_err());
    }

    /// FIFO заблокував би читання назавжди: його відхиляють, не відкриваючи.
    #[cfg(unix)]
    #[test]
    fn a_fifo_is_rejected_without_blocking() {
        let folder = tempfile::tempdir().unwrap();
        let fifo = folder.path().join("канал.txt");
        let created = std::process::Command::new("mkfifo")
            .arg(&fifo)
            .status()
            .is_ok_and(|status| status.success());
        if !created {
            eprintln!("mkfifo недоступний: перевірку FIFO пропущено");
            return;
        }
        assert_eq!(
            read_regular_file(&fifo, 1024, "завеликий").unwrap_err(),
            "це не звичайний файл"
        );
        let link = folder.path().join("посилання.txt");
        std::os::unix::fs::symlink(&fifo, &link).unwrap();
        assert_eq!(
            open_regular_file(&link).unwrap_err(),
            "це не звичайний файл"
        );
    }
}
