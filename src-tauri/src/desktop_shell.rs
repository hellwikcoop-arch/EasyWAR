//! Main window wiring for the unified desktop shell.
//!
//! The launcher (`index.html`) opens the Air Force and Rocket Forces modules in
//! same-origin iframes. Browser behaviours those modules rely on are provided
//! here: saving `<a download>` files, opening external links in the system
//! browser instead of replacing the application, and (on macOS) native
//! `alert()` / `confirm()` panels, which WKWebView does not show by itself.

use std::{
    collections::HashMap,
    path::PathBuf,
    sync::{Arc, Mutex},
};

use tauri::{
    webview::{DownloadEvent, NewWindowResponse},
    App, Url, WebviewWindowBuilder,
};
use tauri_plugin_dialog::{DialogExt, MessageDialogKind};

pub const MAIN_WINDOW_LABEL: &str = "main";

/// Returns `true` for URLs that belong to the application itself and may be
/// loaded inside the webview (launcher, modules, IPC, blobs, dev server).
pub fn is_app_url(url: &Url) -> bool {
    match url.scheme() {
        "tauri" | "asset" | "ipc" | "about" | "data" | "blob" => true,
        "http" | "https" => matches!(
            url.host_str(),
            Some("tauri.localhost" | "ipc.localhost" | "asset.localhost" | "localhost" | "127.0.0.1")
        ),
        _ => false,
    }
}

/// Only web links are handed to the operating system; everything else stays blocked.
pub fn is_external_link(url: &Url) -> bool {
    matches!(url.scheme(), "http" | "https") && !is_app_url(url)
}

fn open_external(url: &Url) {
    if !is_external_link(url) {
        return;
    }
    let url = url.as_str();
    #[cfg(target_os = "macos")]
    let result = std::process::Command::new("open").arg(url).spawn();
    #[cfg(target_os = "windows")]
    let result = std::process::Command::new("rundll32")
        .args(["url.dll,FileProtocolHandler", url])
        .spawn();
    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    let result = std::process::Command::new("xdg-open").arg(url).spawn();
    if let Err(error) = result {
        eprintln!("EasyWAR: не вдалося відкрити зовнішнє посилання: {error}");
    }
}

/// Creates the main window from `tauri.conf.json` (where it has `create: false`)
/// and attaches the desktop handlers.
pub fn create_main_window(app: &App) -> tauri::Result<()> {
    let config = app
        .config()
        .app
        .windows
        .iter()
        .find(|window| window.label == MAIN_WINDOW_LABEL)
        .cloned()
        .ok_or(tauri::Error::WindowNotFound)?;

    // macOS reports no path when a download finishes, so remember where it went.
    let destinations: Arc<Mutex<HashMap<String, PathBuf>>> = Arc::default();

    let window = WebviewWindowBuilder::from_config(app.handle(), &config)?
        .on_navigation(|url| {
            if is_app_url(url) {
                true
            } else {
                open_external(url);
                false
            }
        })
        .on_new_window(|url, _features| {
            open_external(&url);
            NewWindowResponse::Deny
        })
        .on_download(move |webview, event| {
            match event {
                DownloadEvent::Requested { url, destination } => {
                    // Keep the platform default: the user's Downloads folder with a unique name.
                    if let Ok(mut map) = destinations.lock() {
                        map.insert(url.to_string(), destination.clone());
                    }
                }
                DownloadEvent::Finished { url, path, success } => {
                    let remembered = destinations
                        .lock()
                        .ok()
                        .and_then(|mut map| map.remove(url.as_str()));
                    let saved = path.filter(|path| !path.as_os_str().is_empty()).or(remembered);
                    let (text, kind) = match (success, saved) {
                        (true, Some(path)) => (
                            format!("Файл збережено:\n{}", path.display()),
                            MessageDialogKind::Info,
                        ),
                        (true, None) => (
                            "Файл збережено в папку «Завантаження».".to_owned(),
                            MessageDialogKind::Info,
                        ),
                        (false, _) => (
                            "Не вдалося зберегти файл.".to_owned(),
                            MessageDialogKind::Error,
                        ),
                    };
                    webview
                        .dialog()
                        .message(text)
                        .title("EasyWAR")
                        .kind(kind)
                        .show(|_| {});
                }
                _ => {}
            }
            true
        })
        .build()?;

    #[cfg(target_os = "macos")]
    window.with_webview(|webview| {
        // SAFETY: on macOS `inner()` is the live WKWebView of this window and the
        // closure runs on the main thread.
        unsafe { macos_dialogs::install(webview.inner()) };
    })?;
    #[cfg(not(target_os = "macos"))]
    let _ = window;

    Ok(())
}

#[cfg(target_os = "macos")]
mod macos_dialogs {
    //! wry's WKUIDelegate implements no JavaScript panels, so WKWebView answers
    //! `confirm()` with `false` and drops `alert()`. The modules use synchronous
    //! `confirm()` before destructive actions, so add native NSAlert panels to
    //! the delegate class and re-assign the delegate so WebKit notices them.

    use std::ffi::{c_void, CStr};

    use block2::Block;
    use objc2::{
        class, ffi, msg_send,
        rc::Retained,
        runtime::{AnyClass, AnyObject, Bool, Imp, Sel},
        sel,
    };
    use objc2_foundation::NSString;

    const ALERT_FIRST_BUTTON_RETURN: isize = 1000;
    const PANEL_TYPES: &CStr = c"v@:@@@@?";

    type AlertPanel = unsafe extern "C-unwind" fn(
        *mut AnyObject,
        Sel,
        *mut AnyObject,
        *mut NSString,
        *mut AnyObject,
        *mut Block<dyn Fn()>,
    );
    type ConfirmPanel = unsafe extern "C-unwind" fn(
        *mut AnyObject,
        Sel,
        *mut AnyObject,
        *mut NSString,
        *mut AnyObject,
        *mut Block<dyn Fn(Bool)>,
    );

    unsafe fn run_panel(message: *mut NSString, with_cancel: bool) -> bool {
        let alert: Retained<AnyObject> = msg_send![class!(NSAlert), new];
        let text = match message.as_ref() {
            Some(message) => message.to_string(),
            None => String::new(),
        };
        let text = NSString::from_str(&text);
        let _: () = msg_send![&*alert, setMessageText: &*text];
        let ok = NSString::from_str("OK");
        let _: *mut AnyObject = msg_send![&*alert, addButtonWithTitle: &*ok];
        if with_cancel {
            let cancel = NSString::from_str("Скасувати");
            let _: *mut AnyObject = msg_send![&*alert, addButtonWithTitle: &*cancel];
        }
        let response: isize = msg_send![&*alert, runModal];
        response == ALERT_FIRST_BUTTON_RETURN
    }

    unsafe extern "C-unwind" fn alert_panel(
        _this: *mut AnyObject,
        _cmd: Sel,
        _webview: *mut AnyObject,
        message: *mut NSString,
        _frame: *mut AnyObject,
        completion: *mut Block<dyn Fn()>,
    ) {
        run_panel(message, false);
        if let Some(completion) = completion.as_ref() {
            completion.call(());
        }
    }

    unsafe extern "C-unwind" fn confirm_panel(
        _this: *mut AnyObject,
        _cmd: Sel,
        _webview: *mut AnyObject,
        message: *mut NSString,
        _frame: *mut AnyObject,
        completion: *mut Block<dyn Fn(Bool)>,
    ) {
        let accepted = run_panel(message, true);
        if let Some(completion) = completion.as_ref() {
            completion.call((Bool::new(accepted),));
        }
    }

    pub unsafe fn install(webview: *mut c_void) {
        let Some(webview) = (webview as *mut AnyObject).as_ref() else {
            return;
        };
        let delegate: *mut AnyObject = msg_send![webview, UIDelegate];
        let Some(delegate_ref) = delegate.as_ref() else {
            return;
        };
        let class = delegate_ref.class() as *const AnyClass as *mut AnyClass;
        // `class_addMethod` leaves an existing implementation untouched.
        ffi::class_addMethod(
            class,
            sel!(webView:runJavaScriptAlertPanelWithMessage:initiatedByFrame:completionHandler:),
            std::mem::transmute::<AlertPanel, Imp>(alert_panel),
            PANEL_TYPES.as_ptr(),
        );
        ffi::class_addMethod(
            class,
            sel!(webView:runJavaScriptConfirmPanelWithMessage:initiatedByFrame:completionHandler:),
            std::mem::transmute::<ConfirmPanel, Imp>(confirm_panel),
            PANEL_TYPES.as_ptr(),
        );
        // WebKit caches which delegate methods exist when the delegate is assigned.
        let _: () = msg_send![webview, setUIDelegate: delegate];
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn url(value: &str) -> Url {
        Url::parse(value).expect("valid test URL")
    }

    #[test]
    fn keeps_application_pages_inside_the_webview() {
        for value in [
            "tauri://localhost/index.html",
            "tauri://localhost/air.html",
            "http://tauri.localhost/rocket.html",
            "https://tauri.localhost/air.html",
            "http://localhost:5173/air.html",
            "about:srcdoc",
            "about:blank",
            "blob:tauri://localhost/5f0c",
            "ipc://localhost/get_database_status",
        ] {
            assert!(is_app_url(&url(value)), "{value}");
            assert!(!is_external_link(&url(value)), "{value}");
        }
    }

    #[test]
    fn sends_only_web_links_to_the_system_browser() {
        for value in ["https://signal.me/#eu/abc", "https://dimap.live/?x=1", "http://example.org/"] {
            assert!(!is_app_url(&url(value)), "{value}");
            assert!(is_external_link(&url(value)), "{value}");
        }
        for value in ["file:///etc/passwd", "javascript:alert(1)", "mailto:a@b.c", "smb://host/share"] {
            assert!(!is_app_url(&url(value)), "{value}");
            assert!(!is_external_link(&url(value)), "{value}");
        }
    }
}
