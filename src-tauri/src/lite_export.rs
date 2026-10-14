//! Lite-версія EasyWAR: один автономний HTML-файл для будь-якого пристрою.
//!
//! Файл `standalone/EasyWAR-Lite.html` збирає `script/build_lite.mjs` під час `tauri build`
//! (`npm run build:app`) і кладе у фронтенд, який вбудовується в застосунок. У ньому той самий
//! головний екран і ті самі модулі, але без довідників із моделями, 3D-карти й засобів
//! застосунку (профілі, резервна копія, Signal). Даних користувача у файлі немає. Тут файл
//! віддається з вбудованих ресурсів і зберігається туди, куди вкаже користувач; спільні
//! помічники (запис через тимчасовий файл, розширення `.html`) — у [`crate::phone_export`].

use crate::phone_export::is_standalone_html;

/// Шлях ресурсу у вбудованому фронтенді.
pub const ASSET_PATH: &str = "standalone/EasyWAR-Lite.html";
/// Назва файлу, яку пропонує вікно збереження.
pub const FILE_NAME: &str = "EasyWAR-Lite.html";
pub const DIALOG_TITLE: &str = "Зберегти lite-версію EasyWAR (HTML для будь-якого пристрою)";
pub const UNAVAILABLE: &str =
    "Lite-версія є лише у зібраній версії застосунку (у режимі розробки її немає).";

/// Позначка, яку `build_lite.mjs` ставить після `standalone:`. Файл дашборда ПВК чи УДШВ
/// теж має `standalone:`, але не є lite-версією й не повинен зберігатися під її назвою.
const LITE_MARKER: &[u8] = b" standalone: lite";
const MARKER_SCAN_LIMIT: usize = 512;

/// Перевіряє, що вбудований ресурс справді є lite-файлом, зібраним `build_lite.mjs`.
pub fn is_lite_html(bytes: &[u8]) -> bool {
    let head = &bytes[..bytes.len().min(MARKER_SCAN_LIMIT)];
    is_standalone_html(bytes)
        && head
            .windows(LITE_MARKER.len())
            .any(|window| window == LITE_MARKER)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn lite_asset_has_its_own_path_and_name() {
        assert_eq!(ASSET_PATH, "standalone/EasyWAR-Lite.html");
        assert_eq!(FILE_NAME, "EasyWAR-Lite.html");
        assert!(ASSET_PATH.ends_with(FILE_NAME));
    }

    #[test]
    fn only_the_lite_build_is_accepted() {
        let lite =
            "<!DOCTYPE html>\n<!-- EasyWAR 1.0.7 standalone: lite-версія, один файл -->\n<html>"
                .as_bytes();
        assert!(is_lite_html(lite));
        // Файл дашборда зібрано тим самим скриптом-родичем, але це не lite.
        let dashboard =
            "<!doctype html>\n<!-- EasyWAR 1.0.7 standalone: автономний файл -->\n<html>"
                .as_bytes();
        assert!(is_standalone_html(dashboard));
        assert!(!is_lite_html(dashboard));
        // Запасний index.html замість відсутнього ресурсу.
        assert!(!is_lite_html(
            b"<!doctype html><html><head><title>launcher</title></head>"
        ));
        assert!(!is_lite_html(b""));
        // Позначка далеко від початку не рахується.
        let mut late = vec![b' '; MARKER_SCAN_LIMIT + 10];
        late.extend_from_slice(b" standalone: lite");
        assert!(!is_lite_html(&late));
    }
}
