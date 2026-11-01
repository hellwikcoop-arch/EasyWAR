//! EasyFLY для iPhone: оболонка Tauri 2 без команд, плагінів, бази даних і мережі.
//! Уся логіка — у вебчастині (`src/mobile/easyfly/`, спільне ядро `src/workspace/easyfly/`);
//! дані профілю шифрує WebCrypto в IndexedDB WKWebView, файли .easyfly ходять через вибір
//! файлу й системне меню «Поділитися». Нативне збереження у «Файли» (плагін fs/dialog або
//! власна команда) не додається без окремого рішення власника.

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .run(tauri::generate_context!())
        .expect("не вдалося запустити EasyFLY");
}
