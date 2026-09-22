pub mod backup;
mod database;
pub mod repository;
pub mod signal_inbox;
pub mod signal_policy;
pub mod signal_settings;
pub mod xlsx_import;

use backup::BackupStore;
use repository::SettingsStore;
use signal_policy::SignalAdapterConfig;
use signal_settings::SignalSettingsStore;
use sqlx::sqlite::{SqliteConnectOptions, SqlitePoolOptions};
use std::time::Duration;
use tauri::Manager;
use tauri_plugin_dialog::DialogExt;

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
            app.manage(BackupStore::new(pool));
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            get_signal_settings,
            save_signal_settings,
            create_local_backup
        ])
        .run(tauri::generate_context!())
        .expect("помилка запуску EasyWAR");
}
