//! Автономний HTML-файл дашборда для телефона або планшета.
//!
//! Файли `standalone/EasyWAR-*.html` збирає `script/build_standalone.mjs` під час
//! `tauri build` (`npm run build:app`) і кладе у фронтенд, який вбудовується в
//! застосунок. Тут вони віддаються з вбудованих ресурсів і зберігаються туди, куди
//! вкаже користувач. За замовчуванням даних користувача у файлі немає: таблицю
//! `.xlsx` на телефоні обирають окремо. Лише на явну вимогу в порожній тег
//! [`EMBED_PLACEHOLDER`] кладеться копія таблиці, прив'язаної до плитки, і файл
//! відкривається з даними одразу.
//!
//! Тут же лежить безпечний запис файлу після вікна збереження ([`save_file`]): ним
//! користується й `save_presentation`, щоб назва без розширення не затирала наявний файл.

use std::{
    io::{self, Write},
    path::{Path, PathBuf},
};

use base64::{engine::general_purpose::STANDARD, Engine as _};
use serde::{Deserialize, Serialize};
use tempfile::NamedTempFile;

use crate::local_profiles::Branch;

/// Позначка, яку `build_standalone.mjs` ставить на початку кожного файлу. Без неї
/// вбудований ресурс не вважається автономним файлом: запасний `index.html`, який
/// Tauri віддає замість відсутнього ресурсу, не можна зберегти як дашборд.
const STANDALONE_MARKER: &[u8] = b" standalone:";
const MARKER_SCAN_LIMIT: usize = 512;

/// Порожній тег, який `build_standalone.mjs` лишає в кінці сторінки; сценарій на сторінці
/// (`script/standalone-embedded-table.js`) читає з нього вбудовану таблицю.
pub const EMBED_PLACEHOLDER: &str =
    r#"<script type="application/x-easywar-table" id="easywar-embedded-table"></script>"#;
/// Більшу таблицю до файлу не кладемо: base64 роздуває її на третину, а телефон має відкрити
/// сторінку цілком.
pub const MAX_EMBEDDED_TABLE_BYTES: usize = 30 * 1024 * 1024;
const EMBED_OPEN_TAG: &str =
    r#"<script type="application/x-easywar-table" id="easywar-embedded-table">"#;

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum PhoneDashboard {
    /// Повітряне командування (ПВК).
    Pvk,
    /// Командування ДШВ (УДШВ).
    Dshv,
}

impl PhoneDashboard {
    /// Шлях ресурсу у вбудованому фронтенді.
    pub fn asset_path(self) -> &'static str {
        match self {
            PhoneDashboard::Pvk => "standalone/EasyWAR-PVK.html",
            PhoneDashboard::Dshv => "standalone/EasyWAR-UDSHV.html",
        }
    }

    /// Рід військ, до якого прив'язано таблицю цього командування.
    pub fn branch(self) -> Branch {
        match self {
            PhoneDashboard::Pvk => Branch::Pvk,
            PhoneDashboard::Dshv => Branch::Dshv,
        }
    }

    pub fn file_name(self) -> &'static str {
        match self {
            PhoneDashboard::Pvk => "EasyWAR-PVK.html",
            PhoneDashboard::Dshv => "EasyWAR-UDSHV.html",
        }
    }

    /// Назва файлу зі вбудованою таблицею: з датою, щоб було видно, що це знімок на той день.
    pub fn file_name_with_table(self, date: &str) -> String {
        let stem = self.file_name().trim_end_matches(".html");
        format!("{stem}-{date}.html")
    }

    pub fn dialog_title(self) -> &'static str {
        match self {
            PhoneDashboard::Pvk => "Зберегти файл ПВК для телефона або планшета",
            PhoneDashboard::Dshv => "Зберегти файл УДШВ для телефона або планшета",
        }
    }
}

/// Перевіряє, що вбудований ресурс справді є автономним файлом, зібраним `build_standalone.mjs`.
pub fn is_standalone_html(bytes: &[u8]) -> bool {
    let head = &bytes[..bytes.len().min(MARKER_SCAN_LIMIT)];
    head.windows(STANDALONE_MARKER.len())
        .any(|window| window == STANDALONE_MARKER)
}

/// Вміст вбудованої таблиці, який читає сторінка. Версія `v` дозволяє змінити формат пізніше.
#[derive(Serialize)]
struct EmbeddedTable<'a> {
    v: u8,
    name: &'a str,
    #[serde(rename = "exportedAt")]
    exported_at: &'a str,
    data: String,
}

/// Кладе копію таблиці в сторінку. Дані йдуть у JSON із base64, а `<` у назві екранується,
/// щоб текст не міг закрити тег `<script>`. Помилка, якщо в сторінці немає рівно одного
/// порожнього тега для таблиці (стара збірка або вже заповнений файл).
pub fn embed_table(
    html: &[u8],
    table_name: &str,
    xlsx: &[u8],
    exported_at: &str,
) -> Result<Vec<u8>, String> {
    let page = std::str::from_utf8(html)
        .map_err(|_| "Файл для телефона має неочікуваний формат.".to_string())?;
    if xlsx.len() > MAX_EMBEDDED_TABLE_BYTES {
        return Err(format!(
            "Таблиця завелика для файлу на телефон ({} МБ; до {} МБ). Збережіть файл без таблиці й оберіть її на телефоні.",
            xlsx.len().div_ceil(1024 * 1024),
            MAX_EMBEDDED_TABLE_BYTES / (1024 * 1024),
        ));
    }
    if page.matches(EMBED_PLACEHOLDER).count() != 1 {
        return Err("У цій збірці файл для телефона не вміє приймати таблицю.".to_string());
    }
    let payload = serde_json::to_string(&EmbeddedTable {
        v: 1,
        name: table_name,
        exported_at,
        data: STANDARD.encode(xlsx),
    })
    .map_err(|error| error.to_string())?
    .replace('<', "\\u003c");
    Ok(page
        .replacen(
            EMBED_PLACEHOLDER,
            &format!("{EMBED_OPEN_TAG}{payload}</script>"),
            1,
        )
        .into_bytes())
}

/// Куди зберегти файл після системного вікна збереження.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct SaveTarget {
    pub path: PathBuf,
    /// `true`, якщо вікно повернуло шлях уже з потрібним розширенням: якщо там є файл, вікно
    /// саме спитало користувача про заміну, і підтверджену заміну можна виконати. `false`,
    /// якщо розширення дописали ми: вікно перевіряло інше ім'я («report»), тож файл з
    /// остаточним ім'ям («report.pptx») воно могло й не показати, і затирати його не можна.
    pub replace_confirmed: bool,
}

/// Дописує `appended` як розширення, якщо користувач прибрав його у вікні збереження
/// (`accepted` — розширення, які вважаються правильними, без урахування регістру).
pub fn save_target(selected: PathBuf, accepted: &[&str], appended: &str) -> SaveTarget {
    let has_extension = selected.extension().is_some_and(|extension| {
        accepted
            .iter()
            .any(|accepted| extension.eq_ignore_ascii_case(accepted))
    });
    if has_extension {
        return SaveTarget {
            path: selected,
            replace_confirmed: true,
        };
    }
    let mut path = selected;
    path.as_mut_os_string().push(format!(".{appended}"));
    SaveTarget {
        path,
        replace_confirmed: false,
    }
}

/// [`save_target`] для сторінки `.html` (`.htm` теж приймається).
pub fn html_save_target(selected: PathBuf) -> SaveTarget {
    save_target(selected, &["html", "htm"], "html")
}

#[derive(Debug, thiserror::Error)]
pub enum SaveFileError {
    #[error("«{0}» уже існує; оберіть іншу назву, щоб не затерти наявний файл")]
    AlreadyExists(String),
    #[error("{0}")]
    Io(#[from] io::Error),
}

/// Записує файл через тимчасовий сусідній файл (запис, `sync_all`, потім перейменування),
/// щоб обрив посередині не лишив половину файлу. Наявний файл заміняється лише якщо
/// заміну підтвердило вікно збереження ([`SaveTarget::replace_confirmed`]); інакше
/// файл з остаточним ім'ям не чіпається, а результат — `AlreadyExists`. Тимчасовий файл
/// у разі помилки видаляється.
pub fn save_file(target: &SaveTarget, bytes: &[u8]) -> Result<(), SaveFileError> {
    let path = target.path.as_path();
    let directory = path
        .parent()
        .filter(|parent| !parent.as_os_str().is_empty())
        .unwrap_or(Path::new("."));
    let mut temporary = NamedTempFile::new_in(directory)?;
    temporary.write_all(bytes)?;
    temporary.as_file().sync_all()?;
    if target.replace_confirmed {
        temporary
            .persist(path)
            .map_err(|error| SaveFileError::Io(error.error))?;
    } else {
        temporary.persist_noclobber(path).map_err(|error| {
            if error.error.kind() == io::ErrorKind::AlreadyExists {
                SaveFileError::AlreadyExists(
                    path.file_name()
                        .map(|name| name.to_string_lossy().into_owned())
                        .unwrap_or_default(),
                )
            } else {
                SaveFileError::Io(error.error)
            }
        })?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    #[test]
    fn dashboards_map_to_their_own_assets_and_names() {
        assert_eq!(
            PhoneDashboard::Dshv.asset_path(),
            "standalone/EasyWAR-UDSHV.html"
        );
        assert_eq!(
            PhoneDashboard::Pvk.asset_path(),
            "standalone/EasyWAR-PVK.html"
        );
        assert_eq!(PhoneDashboard::Dshv.branch(), Branch::Dshv);
        assert_eq!(PhoneDashboard::Pvk.branch(), Branch::Pvk);
        assert_eq!(PhoneDashboard::Dshv.file_name(), "EasyWAR-UDSHV.html");
        assert_eq!(PhoneDashboard::Pvk.file_name(), "EasyWAR-PVK.html");
    }

    #[test]
    fn dashboard_is_read_from_the_frontend_command_name() {
        assert_eq!(
            serde_json::from_str::<PhoneDashboard>("\"dshv\"").unwrap(),
            PhoneDashboard::Dshv
        );
        assert_eq!(
            serde_json::from_str::<PhoneDashboard>("\"pvk\"").unwrap(),
            PhoneDashboard::Pvk
        );
        assert!(serde_json::from_str::<PhoneDashboard>("\"air\"").is_err());
    }

    #[test]
    fn only_files_built_by_the_standalone_script_are_accepted() {
        let built = "<!doctype html>\n<!-- EasyWAR 0.9.6 standalone: автономний файл -->\n<html>"
            .as_bytes();
        assert!(is_standalone_html(built));
        assert!(!is_standalone_html(
            b"<!doctype html><html><head><title>launcher</title></head>"
        ));
        assert!(!is_standalone_html(b""));
        // Позначка далеко від початку не рахується.
        let mut late = vec![b' '; MARKER_SCAN_LIMIT + 10];
        late.extend_from_slice(b" standalone:");
        assert!(!is_standalone_html(&late));
    }

    fn confirmed(path: &Path) -> SaveTarget {
        SaveTarget {
            path: path.to_path_buf(),
            replace_confirmed: true,
        }
    }

    fn unconfirmed(path: &Path) -> SaveTarget {
        SaveTarget {
            path: path.to_path_buf(),
            replace_confirmed: false,
        }
    }

    fn names_in(dir: &Path) -> Vec<String> {
        let mut names = fs::read_dir(dir)
            .unwrap()
            .map(|entry| entry.unwrap().file_name().to_string_lossy().into_owned())
            .collect::<Vec<_>>();
        names.sort();
        names
    }

    #[test]
    fn html_extension_is_added_only_when_missing() {
        let appended = |path: &str| html_save_target(PathBuf::from(path));
        assert_eq!(
            appended("/tmp/a"),
            SaveTarget {
                path: PathBuf::from("/tmp/a.html"),
                replace_confirmed: false
            }
        );
        assert_eq!(
            appended("/tmp/a.txt"),
            SaveTarget {
                path: PathBuf::from("/tmp/a.txt.html"),
                replace_confirmed: false
            }
        );
        // Розширення вже є: шлях лишається таким, як його повернуло вікно, а заміну
        // (якщо файл є) підтвердило саме вікно.
        for kept in ["/tmp/a.html", "/tmp/a.HTML", "/tmp/a.htm"] {
            assert_eq!(
                appended(kept),
                SaveTarget {
                    path: PathBuf::from(kept),
                    replace_confirmed: true
                }
            );
        }
    }

    #[test]
    fn other_extensions_are_appended_the_same_way() {
        let target = save_target(PathBuf::from("/tmp/report"), &["pptx"], "pptx");
        assert_eq!(target, unconfirmed(Path::new("/tmp/report.pptx")));
        let target = save_target(PathBuf::from("/tmp/report.PPTX"), &["pptx"], "pptx");
        assert_eq!(target, confirmed(Path::new("/tmp/report.PPTX")));
        // PDF-діалог не вважає «.pptx» своїм розширенням.
        let target = save_target(PathBuf::from("/tmp/report.pptx"), &["pdf"], "pdf");
        assert_eq!(target, unconfirmed(Path::new("/tmp/report.pptx.pdf")));
    }

    #[test]
    fn confirmed_save_replaces_the_target_and_leaves_no_temporary_file() {
        let dir = tempfile::tempdir().unwrap();
        let target = dir.path().join("EasyWAR-UDSHV.html");
        fs::write(&target, b"old").unwrap();
        save_file(&confirmed(&target), b"new content").unwrap();
        assert_eq!(fs::read(&target).unwrap(), b"new content");
        assert_eq!(names_in(dir.path()), ["EasyWAR-UDSHV.html"]);
    }

    #[test]
    fn unconfirmed_save_creates_a_new_file_and_leaves_no_temporary_file() {
        let dir = tempfile::tempdir().unwrap();
        let target = dir.path().join("report.pptx");
        save_file(&unconfirmed(&target), b"fresh").unwrap();
        assert_eq!(fs::read(&target).unwrap(), b"fresh");
        assert_eq!(names_in(dir.path()), ["report.pptx"]);
    }

    #[test]
    fn unconfirmed_save_never_replaces_an_existing_file() {
        let dir = tempfile::tempdir().unwrap();
        let target = dir.path().join("report.pptx");
        fs::write(&target, b"precious").unwrap();
        let error = save_file(&unconfirmed(&target), b"new").unwrap_err();
        assert!(matches!(error, SaveFileError::AlreadyExists(_)), "{error}");
        let text = error.to_string();
        assert!(text.contains("«report.pptx» уже існує"), "{text}");
        assert!(text.contains("оберіть іншу назву"), "{text}");
        assert_eq!(fs::read(&target).unwrap(), b"precious");
        assert_eq!(names_in(dir.path()), ["report.pptx"]);
    }

    #[test]
    fn typing_a_name_without_extension_does_not_overwrite_the_file_with_it() {
        // Користувач ввів у вікні «report», а «report.pptx» уже є: вікно про заміну не питало.
        let dir = tempfile::tempdir().unwrap();
        fs::write(dir.path().join("report.pptx"), b"precious").unwrap();
        let target = save_target(dir.path().join("report"), &["pptx"], "pptx");
        assert_eq!(target.path, dir.path().join("report.pptx"));
        assert!(matches!(
            save_file(&target, b"new"),
            Err(SaveFileError::AlreadyExists(_))
        ));
        assert_eq!(
            fs::read(dir.path().join("report.pptx")).unwrap(),
            b"precious"
        );
        assert_eq!(names_in(dir.path()), ["report.pptx"]);
    }

    #[test]
    fn save_into_a_missing_folder_fails_without_leaving_files() {
        let dir = tempfile::tempdir().unwrap();
        let missing = dir.path().join("missing").join("a.html");
        for target in [confirmed(&missing), unconfirmed(&missing)] {
            let error = save_file(&target, b"x").unwrap_err();
            assert!(matches!(error, SaveFileError::Io(_)), "{error}");
        }
        assert!(!missing.exists());
        assert!(names_in(dir.path()).is_empty());
    }

    #[test]
    fn file_with_a_table_gets_a_dated_name() {
        assert_eq!(
            PhoneDashboard::Dshv.file_name_with_table("2026-10-01"),
            "EasyWAR-UDSHV-2026-10-01.html"
        );
        assert_eq!(
            PhoneDashboard::Pvk.file_name_with_table("2026-10-01"),
            "EasyWAR-PVK-2026-10-01.html"
        );
    }

    fn page_with_slot() -> Vec<u8> {
        format!(
            "<!doctype html>\n<!-- EasyWAR 0.9.6 standalone: x -->\n<html><body>{EMBED_PLACEHOLDER}<script>boot()</script></body></html>"
        )
        .into_bytes()
    }

    #[test]
    fn table_is_embedded_once_as_base64_json_and_the_marker_survives() {
        let xlsx = b"PK\x03\x04 binary \x00\xff table";
        let out = embed_table(
            &page_with_slot(),
            "УДШВ 2026.xlsx",
            xlsx,
            "2026-10-01T09:15:00+03:00",
        )
        .unwrap();
        assert!(is_standalone_html(&out));
        let page = String::from_utf8(out).unwrap();
        assert!(!page.contains(EMBED_PLACEHOLDER));
        let start = page.find(EMBED_OPEN_TAG).unwrap() + EMBED_OPEN_TAG.len();
        let end = start + page[start..].find("</script>").unwrap();
        let payload: serde_json::Value = serde_json::from_str(&page[start..end]).unwrap();
        assert_eq!(payload["v"], 1);
        assert_eq!(payload["name"], "УДШВ 2026.xlsx");
        assert_eq!(payload["exportedAt"], "2026-10-01T09:15:00+03:00");
        assert_eq!(
            STANDARD.decode(payload["data"].as_str().unwrap()).unwrap(),
            xlsx
        );
        // Решта сторінки не зачеплена.
        assert!(page.ends_with("<script>boot()</script></body></html>"));
    }

    #[test]
    fn a_hostile_table_name_cannot_close_the_script_tag() {
        let out = embed_table(
            &page_with_slot(),
            "</script><script>alert(1)</script>.xlsx",
            b"x",
            "now",
        )
        .unwrap();
        let page = String::from_utf8(out).unwrap();
        let start = page.find(EMBED_OPEN_TAG).unwrap() + EMBED_OPEN_TAG.len();
        let end = start + page[start..].find("</script>").unwrap();
        let payload: serde_json::Value = serde_json::from_str(&page[start..end]).unwrap();
        assert_eq!(payload["name"], "</script><script>alert(1)</script>.xlsx");
        assert_eq!(page.matches("</script>").count(), 2);
    }

    #[test]
    fn pages_without_exactly_one_slot_are_refused() {
        assert!(embed_table(b"<html></html>", "a.xlsx", b"x", "now").is_err());
        let twice = format!("{EMBED_PLACEHOLDER}{EMBED_PLACEHOLDER}");
        assert!(embed_table(twice.as_bytes(), "a.xlsx", b"x", "now").is_err());
        // Вже заповнений файл вдруге не заповнюється.
        let once = embed_table(&page_with_slot(), "a.xlsx", b"x", "now").unwrap();
        assert!(embed_table(&once, "b.xlsx", b"y", "now").is_err());
        assert!(embed_table(&[0xff, 0xfe], "a.xlsx", b"x", "now").is_err());
    }

    #[test]
    fn an_oversized_table_is_refused_with_a_readable_reason() {
        let big = vec![0u8; MAX_EMBEDDED_TABLE_BYTES + 1];
        let error = embed_table(&page_with_slot(), "a.xlsx", &big, "now").unwrap_err();
        assert!(error.contains("завелика"), "{error}");
        assert!(error.contains("до 30 МБ"), "{error}");
        let limit = vec![0u8; MAX_EMBEDDED_TABLE_BYTES];
        assert!(embed_table(&page_with_slot(), "a.xlsx", &limit, "now").is_ok());
    }
}
