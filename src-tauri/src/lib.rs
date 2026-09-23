pub mod backup;
mod database;
pub mod repository;
pub mod restore;
pub mod signal_commands;
pub mod signal_daemon;
pub mod signal_inbox;
pub mod signal_ingest;
pub mod signal_policy;
pub mod signal_session;
pub mod signal_settings;
pub mod xlsx_export;
pub mod xlsx_import;

use backup::BackupStore;
use chrono::{SecondsFormat, Utc};
use repository::{
    Repository, ReviewDecision, SettingsStore, SignalInboxItem, SignalParsePersistence,
    SignalReviewPersistence, SignalReviewSnapshot, XlsxStageResult,
};
use restore::BackupInspection;
use serde_json::Value;
use signal_daemon::{SignalAccountSummary, SignalGroupSummary, SignalLinkStart};
use signal_policy::SignalAdapterConfig;
use signal_session::{SignalReceiveController, SignalSessionStatus, SignalSessionSummary};
use signal_settings::SignalSettingsStore;
use sqlx::sqlite::{SqliteConnectOptions, SqlitePoolOptions};
use std::{io::Read, path::Path, time::Duration};
use tauri::Manager;
use tauri_plugin_dialog::DialogExt;
use xlsx_export::XlsxExportResult;

const MAX_XLSX_BYTES: u64 = 64 * 1024 * 1024;
const SIGNAL_SESSION_MAX_NOTIFICATIONS: usize = 64;
const SIGNAL_SESSION_TIMEOUT: Duration = Duration::from_secs(5 * 60);

#[tauri::command]
async fn get_signal_settings(
    store: tauri::State<'_, SignalSettingsStore>,
) -> Result<SignalAdapterConfig, String> {
    store
        .load()
        .await
        .map(|validated| validated.as_config().clone())
        .map_err(|error| error.to_string())
}

#[tauri::command]
async fn save_signal_settings(
    store: tauri::State<'_, SignalSettingsStore>,
    config: SignalAdapterConfig,
    updated_at: String,
) -> Result<(), String> {
    store
        .save_from_desktop(config, &updated_at)
        .await
        .map_err(|error| error.to_string())
}

#[tauri::command]
async fn discover_signal_accounts(
    store: tauri::State<'_, SignalSettingsStore>,
) -> Result<Vec<SignalAccountSummary>, String> {
    let config = store.load().await.map_err(|error| error.to_string())?;
    signal_daemon::discover_accounts(&config.as_config().endpoint)
        .await
        .map_err(|error| error.to_string())
}

#[tauri::command]
async fn discover_signal_groups(
    store: tauri::State<'_, SignalSettingsStore>,
    account: String,
) -> Result<Vec<SignalGroupSummary>, String> {
    let config = store.load().await.map_err(|error| error.to_string())?;
    signal_daemon::discover_groups(&config.as_config().endpoint, &account)
        .await
        .map_err(|error| error.to_string())
}

#[tauri::command]
async fn start_signal_link(
    store: tauri::State<'_, SignalSettingsStore>,
) -> Result<SignalLinkStart, String> {
    let config = store.load().await.map_err(|error| error.to_string())?;
    signal_daemon::start_link(&config.as_config().endpoint)
        .await
        .map_err(|error| error.to_string())
}

#[tauri::command]
async fn finish_signal_link(
    store: tauri::State<'_, SignalSettingsStore>,
    device_link_uri: String,
    device_name: String,
) -> Result<SignalAccountSummary, String> {
    let config = store.load().await.map_err(|error| error.to_string())?;
    signal_daemon::finish_link(&config.as_config().endpoint, &device_link_uri, &device_name)
        .await
        .map_err(|error| error.to_string())
}

#[tauri::command]
async fn list_signal_inbox(
    repository: tauri::State<'_, Repository>,
) -> Result<Vec<SignalInboxItem>, String> {
    repository
        .list_signal_inbox(100)
        .await
        .map_err(|error| error.to_string())
}

#[tauri::command]
async fn get_signal_report_text(
    repository: tauri::State<'_, Repository>,
    report_id: String,
) -> Result<Option<String>, String> {
    repository
        .signal_report_text(&report_id)
        .await
        .map_err(|error| error.to_string())
}

#[tauri::command]
async fn store_signal_parse(
    repository: tauri::State<'_, Repository>,
    report_id: String,
    parsed_payload: Value,
) -> Result<SignalParsePersistence, String> {
    let parsed_at = Utc::now().to_rfc3339_opts(SecondsFormat::Secs, true);
    repository
        .store_signal_parse(&report_id, &parsed_payload, &parsed_at)
        .await
        .map_err(|error| error.to_string())
}

#[tauri::command]
async fn request_signal_review(
    repository: tauri::State<'_, Repository>,
    report_id: String,
) -> Result<SignalReviewPersistence, String> {
    let decided_at = Utc::now().to_rfc3339_opts(SecondsFormat::Secs, true);
    repository
        .request_signal_review(&report_id, &decided_at)
        .await
        .map_err(|error| error.to_string())
}

#[tauri::command]
async fn get_signal_review_snapshot(
    repository: tauri::State<'_, Repository>,
    report_id: String,
) -> Result<SignalReviewSnapshot, String> {
    repository
        .signal_review_snapshot(&report_id)
        .await
        .map_err(|error| error.to_string())
}

#[tauri::command]
async fn finalize_signal_review(
    repository: tauri::State<'_, Repository>,
    report_id: String,
    decision: String,
    reviewer: String,
    corrected_snapshot: Value,
) -> Result<SignalReviewPersistence, String> {
    let decision = match decision.as_str() {
        "APPROVED" => ReviewDecision::Approved,
        "REJECTED" => ReviewDecision::Rejected,
        _ => return Err("Фінальне рішення має бути APPROVED або REJECTED".to_owned()),
    };
    let decided_at = Utc::now().to_rfc3339_opts(SecondsFormat::Secs, true);
    repository
        .finalize_signal_review(
            &report_id,
            decision,
            &reviewer,
            &corrected_snapshot,
            &decided_at,
        )
        .await
        .map_err(|error| error.to_string())
}

#[tauri::command]
async fn run_signal_receive_session(
    controller: tauri::State<'_, SignalReceiveController>,
    settings: tauri::State<'_, SignalSettingsStore>,
    repository: tauri::State<'_, Repository>,
    account: String,
) -> Result<SignalSessionSummary, String> {
    let config = settings
        .load_for_explicit_session()
        .await
        .map_err(|error| error.to_string())?;
    controller
        .run(
            &repository,
            &config,
            &account,
            SIGNAL_SESSION_MAX_NOTIFICATIONS,
            SIGNAL_SESSION_TIMEOUT,
        )
        .await
        .map_err(|error| error.to_string())
}

#[tauri::command]
fn stop_signal_receive_session(controller: tauri::State<'_, SignalReceiveController>) -> bool {
    controller.stop()
}

#[tauri::command]
fn get_signal_receive_status(
    controller: tauri::State<'_, SignalReceiveController>,
) -> SignalSessionStatus {
    controller.status()
}

#[tauri::command]
async fn create_local_backup(
    app: tauri::AppHandle,
    store: tauri::State<'_, BackupStore>,
) -> Result<Option<String>, String> {
    let dialog_app = app.clone();
    let selected = tauri::async_runtime::spawn_blocking(move || {
        dialog_app
            .dialog()
            .file()
            .set_title("Зберегти резервну копію EasyWAR")
            .set_file_name("EasyWAR-backup.sqlite3")
            .add_filter("База SQLite", &["sqlite3"])
            .blocking_save_file()
    })
    .await
    .map_err(|error| error.to_string())?;

    let Some(selected) = selected else {
        return Ok(None);
    };
    let destination = selected.into_path().map_err(|error| error.to_string())?;
    store
        .create_at(&destination)
        .await
        .map_err(|error| error.to_string())?;
    Ok(Some(destination.to_string_lossy().into_owned()))
}

#[tauri::command]
async fn inspect_local_backup(app: tauri::AppHandle) -> Result<Option<BackupInspection>, String> {
    let selected = tauri::async_runtime::spawn_blocking(move || {
        app.dialog()
            .file()
            .set_title("Перевірити резервну копію EasyWAR")
            .add_filter("База SQLite", &["sqlite3"])
            .blocking_pick_file()
    })
    .await
    .map_err(|error| error.to_string())?;
    let Some(selected) = selected else {
        return Ok(None);
    };
    let file = selected.into_path().map_err(|error| error.to_string())?;
    restore::inspect_backup(&file)
        .await
        .map(Some)
        .map_err(|error| error.to_string())
}

fn read_selected_xlsx(path: &Path) -> Result<Vec<u8>, String> {
    if !path
        .extension()
        .is_some_and(|extension| extension.to_string_lossy().eq_ignore_ascii_case("xlsx"))
    {
        return Err("Оберіть файл із розширенням .xlsx".to_owned());
    }

    let file =
        std::fs::File::open(path).map_err(|error| format!("Не вдалося відкрити XLSX: {error}"))?;
    if file
        .metadata()
        .map_err(|error| format!("Не вдалося перевірити розмір XLSX: {error}"))?
        .len()
        > MAX_XLSX_BYTES
    {
        return Err("Файл XLSX перевищує обмеження 64 МБ".to_owned());
    }

    let mut bytes = Vec::new();
    file.take(MAX_XLSX_BYTES + 1)
        .read_to_end(&mut bytes)
        .map_err(|error| format!("Не вдалося прочитати XLSX: {error}"))?;
    if bytes.len() as u64 > MAX_XLSX_BYTES {
        return Err("Файл XLSX перевищує обмеження 64 МБ".to_owned());
    }
    Ok(bytes)
}

#[tauri::command]
async fn inspect_local_xlsx(
    app: tauri::AppHandle,
) -> Result<Option<xlsx_import::XlsxInspection>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let selected = app
            .dialog()
            .file()
            .set_title("Перевірити сумісність таблиці EasyWAR")
            .add_filter("Таблиця XLSX", &["xlsx"])
            .blocking_pick_file();
        let Some(selected) = selected else {
            return Ok(None);
        };
        let path = selected.into_path().map_err(|error| error.to_string())?;
        let bytes = read_selected_xlsx(&path)?;
        xlsx_import::inspect_easywar_xlsx(&bytes)
            .map(Some)
            .map_err(|error| error.to_string())
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
async fn stage_local_xlsx(
    app: tauri::AppHandle,
    repository: tauri::State<'_, Repository>,
) -> Result<Option<XlsxStageResult>, String> {
    let selected = tauri::async_runtime::spawn_blocking(move || {
        app.dialog()
            .file()
            .set_title("Імпортувати таблицю EasyWAR у локальну базу")
            .add_filter("Таблиця XLSX", &["xlsx"])
            .blocking_pick_file()
    })
    .await
    .map_err(|error| error.to_string())?;
    let Some(selected) = selected else {
        return Ok(None);
    };
    let path = selected.into_path().map_err(|error| error.to_string())?;
    let batch = tauri::async_runtime::spawn_blocking(move || {
        let bytes = read_selected_xlsx(&path)?;
        xlsx_import::import_easywar_xlsx(&bytes).map_err(|error| error.to_string())
    })
    .await
    .map_err(|error| error.to_string())??;
    let captured_at = Utc::now().to_rfc3339_opts(SecondsFormat::Secs, true);
    repository
        .stage_xlsx_batch(&batch, &captured_at)
        .await
        .map(Some)
        .map_err(|error| error.to_string())
}

#[tauri::command]
async fn export_approved_xlsx(
    app: tauri::AppHandle,
    repository: tauri::State<'_, Repository>,
) -> Result<Option<XlsxExportResult>, String> {
    let snapshots = repository
        .approved_revision_snapshots()
        .await
        .map_err(|error| error.to_string())?;
    let records = xlsx_export::records_from_approved_snapshots(&snapshots)
        .map_err(|error| error.to_string())?;
    let exported_rows = records.len();
    let bytes = tauri::async_runtime::spawn_blocking(move || {
        xlsx_export::build_compatible_xlsx(&records).map_err(|error| error.to_string())
    })
    .await
    .map_err(|error| error.to_string())??;
    let suggested_name = format!("EasyWAR-export-{}.xlsx", Utc::now().format("%Y-%m-%d"));
    let selected = tauri::async_runtime::spawn_blocking(move || {
        app.dialog()
            .file()
            .set_title("Експортувати схвалені записи EasyWAR")
            .set_file_name(&suggested_name)
            .add_filter("Таблиця XLSX", &["xlsx"])
            .blocking_save_file()
    })
    .await
    .map_err(|error| error.to_string())?;
    let Some(selected) = selected else {
        return Ok(None);
    };
    let destination = selected.into_path().map_err(|error| error.to_string())?;
    tauri::async_runtime::spawn_blocking(move || {
        xlsx_export::write_new_compatible_xlsx(&destination, &bytes)
            .map_err(|error| error.to_string())
    })
    .await
    .map_err(|error| error.to_string())??;
    Ok(Some(XlsxExportResult { exported_rows }))
}

#[tauri::command]
async fn export_approved_xlsx_from_reference(
    app: tauri::AppHandle,
    repository: tauri::State<'_, Repository>,
) -> Result<Option<XlsxExportResult>, String> {
    let snapshots = repository
        .approved_revision_snapshots()
        .await
        .map_err(|error| error.to_string())?;
    let records = xlsx_export::records_from_approved_snapshots(&snapshots)
        .map_err(|error| error.to_string())?;
    let exported_rows = records.len();
    let reference_app = app.clone();
    let selected_reference = tauri::async_runtime::spawn_blocking(move || {
        reference_app
            .dialog()
            .file()
            .set_title("Оберіть еталонний XLSX EasyWAR")
            .add_filter("Таблиця XLSX", &["xlsx"])
            .blocking_pick_file()
    })
    .await
    .map_err(|error| error.to_string())?;
    let Some(selected_reference) = selected_reference else {
        return Ok(None);
    };
    let reference_path = selected_reference
        .into_path()
        .map_err(|error| error.to_string())?;
    let bytes = tauri::async_runtime::spawn_blocking(move || {
        let reference_bytes = read_selected_xlsx(&reference_path)?;
        xlsx_export::build_compatible_xlsx_from_reference(&reference_bytes, &records)
            .map_err(|error| error.to_string())
    })
    .await
    .map_err(|error| error.to_string())??;
    let suggested_name = format!(
        "EasyWAR-export-за-зразком-{}.xlsx",
        Utc::now().format("%Y-%m-%d")
    );
    let selected_destination = tauri::async_runtime::spawn_blocking(move || {
        app.dialog()
            .file()
            .set_title("Зберегти новий XLSX за еталоном")
            .set_file_name(&suggested_name)
            .add_filter("Таблиця XLSX", &["xlsx"])
            .blocking_save_file()
    })
    .await
    .map_err(|error| error.to_string())?;
    let Some(selected_destination) = selected_destination else {
        return Ok(None);
    };
    let destination = selected_destination
        .into_path()
        .map_err(|error| error.to_string())?;
    tauri::async_runtime::spawn_blocking(move || {
        xlsx_export::write_new_compatible_xlsx(&destination, &bytes)
            .map_err(|error| error.to_string())
    })
    .await
    .map_err(|error| error.to_string())??;
    Ok(Some(XlsxExportResult { exported_rows }))
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(
            tauri_plugin_sql::Builder::default()
                .add_migrations(database::DATABASE_URL, database::migrations())
                .build(),
        )
        .setup(|app| {
            let database_name = database::DATABASE_URL
                .strip_prefix("sqlite:")
                .expect("локальна база має використовувати SQLite");
            let database_file = app.path().app_config_dir()?.join(database_name);
            let options = SqliteConnectOptions::new()
                .filename(database_file)
                .foreign_keys(true)
                .busy_timeout(Duration::from_secs(5));
            let pool = tauri::async_runtime::block_on(
                SqlitePoolOptions::new()
                    .max_connections(1)
                    .connect_with(options),
            )?;
            app.manage(SignalSettingsStore::new(SettingsStore::new(pool.clone())));
            app.manage(Repository::new(pool.clone()));
            app.manage(SignalReceiveController::default());
            app.manage(BackupStore::new(pool));
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            get_signal_settings,
            save_signal_settings,
            discover_signal_accounts,
            discover_signal_groups,
            start_signal_link,
            finish_signal_link,
            list_signal_inbox,
            get_signal_report_text,
            store_signal_parse,
            request_signal_review,
            get_signal_review_snapshot,
            finalize_signal_review,
            run_signal_receive_session,
            stop_signal_receive_session,
            get_signal_receive_status,
            create_local_backup,
            inspect_local_backup,
            inspect_local_xlsx,
            stage_local_xlsx,
            export_approved_xlsx,
            export_approved_xlsx_from_reference
        ])
        .run(tauri::generate_context!())
        .expect("помилка запуску EasyWAR");
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn selected_xlsx_reader_rejects_wrong_extension_and_oversize_file() {
        let directory = tempfile::tempdir().expect("synthetic temp directory");
        let wrong_extension = directory.path().join("synthetic.txt");
        std::fs::write(&wrong_extension, b"synthetic only").expect("write synthetic test file");
        assert!(read_selected_xlsx(&wrong_extension)
            .expect_err("wrong extension must fail")
            .contains(".xlsx"));

        let oversized = directory.path().join("synthetic.xlsx");
        std::fs::File::create(&oversized)
            .expect("create sparse synthetic test file")
            .set_len(MAX_XLSX_BYTES + 1)
            .expect("set synthetic size");
        assert!(read_selected_xlsx(&oversized)
            .expect_err("oversized file must fail")
            .contains("64 МБ"));
    }
}
