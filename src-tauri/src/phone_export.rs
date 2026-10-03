//! Автономний HTML-файл дашборда для телефона або планшета.
//!
//! Файли `standalone/EasyWAR-*.html` збирає `script/build_standalone.mjs` під час
//! `tauri build` (`npm run build:app`) і кладе у фронтенд, який вбудовується в
//! застосунок. Тут вони віддаються з вбудованих ресурсів і зберігаються туди, куди
//! вкаже користувач. За замовчуванням даних користувача у файлі немає: таблицю
//! `.xlsx` на телефоні обирають окремо. Лише на явну вимогу в порожній тег
//! [`EMBED_PLACEHOLDER`] кладеться копія таблиці, прив'язаної до плитки, і файл
//! відкривається з даними одразу.

use std::{
    fs, io,
    path::{Path, PathBuf},
};

use base64::{engine::general_purpose::STANDARD, Engine as _};
use serde::{Deserialize, Serialize};

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

/// Додає `.html`, якщо користувач прибрав розширення у вікні збереження.
pub fn with_html_extension(mut path: PathBuf) -> PathBuf {
    let has_html = path.extension().is_some_and(|extension| {
        extension.eq_ignore_ascii_case("html") || extension.eq_ignore_ascii_case("htm")
    });
    if !has_html {
        path.as_mut_os_string().push(".html");
    }
    path
}

/// Записує файл через тимчасовий сусідній файл, щоб обрив посередині не лишив половину сторінки.
pub fn write_file(path: &Path, bytes: &[u8]) -> io::Result<()> {
    let mut temporary = path.as_os_str().to_owned();
    temporary.push(".part");
    let temporary = PathBuf::from(temporary);
    if let Err(error) = fs::write(&temporary, bytes) {
        let _ = fs::remove_file(&temporary);
        return Err(error);
    }
    if let Err(error) = fs::rename(&temporary, path) {
        let _ = fs::remove_file(&temporary);
        return Err(error);
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

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

    #[test]
    fn html_extension_is_added_only_when_missing() {
        assert_eq!(
            with_html_extension(PathBuf::from("/tmp/a")),
            PathBuf::from("/tmp/a.html")
        );
        assert_eq!(
            with_html_extension(PathBuf::from("/tmp/a.HTML")),
            PathBuf::from("/tmp/a.HTML")
        );
        assert_eq!(
            with_html_extension(PathBuf::from("/tmp/a.htm")),
            PathBuf::from("/tmp/a.htm")
        );
        assert_eq!(
            with_html_extension(PathBuf::from("/tmp/a.txt")),
            PathBuf::from("/tmp/a.txt.html")
        );
    }

    #[test]
    fn write_replaces_the_target_and_leaves_no_temporary_file() {
        let dir = std::env::temp_dir().join(format!("easywar-phone-export-{}", std::process::id()));
        fs::create_dir_all(&dir).unwrap();
        let target = dir.join("EasyWAR-UDSHV.html");
        fs::write(&target, b"old").unwrap();
        write_file(&target, b"new content").unwrap();
        assert_eq!(fs::read(&target).unwrap(), b"new content");
        assert!(!dir.join("EasyWAR-UDSHV.html.part").exists());
        fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn write_into_a_missing_folder_fails_without_leaving_files() {
        let missing = std::env::temp_dir()
            .join(format!("easywar-phone-missing-{}", std::process::id()))
            .join("a.html");
        assert!(write_file(&missing, b"x").is_err());
        assert!(!missing.exists());
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
