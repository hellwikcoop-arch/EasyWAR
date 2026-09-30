//! Автономний HTML-файл дашборда для телефона або планшета.
//!
//! Файли `standalone/EasyWAR-*.html` збирає `script/build_standalone.mjs` під час
//! `tauri build` (`npm run build:app`) і кладе у фронтенд, який вбудовується в
//! застосунок. Тут вони лише віддаються з вбудованих ресурсів і зберігаються
//! туди, куди вкаже користувач. Жодних даних користувача в файл не потрапляє:
//! таблицю `.xlsx` на телефоні обирають окремо.

use std::{
    fs, io,
    path::{Path, PathBuf},
};

use serde::Deserialize;

/// Позначка, яку `build_standalone.mjs` ставить на початку кожного файлу. Без неї
/// вбудований ресурс не вважається автономним файлом: запасний `index.html`, який
/// Tauri віддає замість відсутнього ресурсу, не можна зберегти як дашборд.
const STANDALONE_MARKER: &[u8] = b" standalone:";
const MARKER_SCAN_LIMIT: usize = 512;

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

    pub fn file_name(self) -> &'static str {
        match self {
            PhoneDashboard::Pvk => "EasyWAR-PVK.html",
            PhoneDashboard::Dshv => "EasyWAR-UDSHV.html",
        }
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
}
