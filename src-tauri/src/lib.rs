pub mod analytics;
mod app_update;
pub mod backup;
pub mod base_tables;
mod database;
mod desktop_shell;
pub mod local_profiles;
mod migration_startup;
pub mod position_templates;
pub mod repository;
pub mod restore;
pub mod signal_commands;
pub mod signal_daemon;
pub mod signal_inbox;
pub mod signal_ingest;
pub mod signal_policy;
pub mod signal_session;
pub mod signal_settings;
pub mod update_settings;
pub mod workspace_templates;
pub mod xlsx_export;
pub mod xlsx_import;

use app_update::{AppUpdateStatus, PendingUpdate};
use backup::BackupStore;
use base_tables::BaseTable;
use chrono::{SecondsFormat, Utc};
use database::{DatabaseStatus, DatabaseStatusStore};
use local_profiles::{Branch, LocalProfileStore, LocalProfilesState};
use position_templates::PositionDatabaseTemplate;
use repository::{
    Repository, ReviewDecision, SettingsStore, SignalInboxItem, SignalParsePersistence,
    SignalReviewPersistence, SignalReviewSnapshot, XlsxStageResult,
};
use restore::{BackupInspection, RestoreStartupReport};
use serde_json::Value;
use signal_daemon::{SignalAccountSummary, SignalGroupSummary, SignalLinkStart};
use signal_policy::SignalAdapterConfig;
use signal_session::{SignalReceiveController, SignalSessionStatus, SignalSessionSummary};
use signal_settings::SignalSettingsStore;
use sqlx::sqlite::{SqliteConnectOptions, SqlitePoolOptions};
use std::{
    io::Read,
    path::{Path, PathBuf},
    time::Duration,
};
use tauri::Manager;
use tauri_plugin_dialog::DialogExt;
use update_settings::{AutoUpdateSettings, AutoUpdateStore};
use workspace_templates::{WorkspaceTemplateStore, WorkspaceTemplatesState};
use xlsx_export::XlsxExportResult;

struct LiveDatabasePath(PathBuf);

/// Профіль, у який увійшли паролем у цьому запуску. Лише в пам'яті:
/// після перезапуску захищений профіль знову потребує пароля.
#[derive(Default)]
struct ProfileSession(std::sync::Mutex<Option<String>>);

impl ProfileSession {
    fn get(&self) -> Option<String> {
        self.0.lock().map(|guard| guard.clone()).unwrap_or(None)
    }

    fn set(&self, value: Option<String>) {
        if let Ok(mut guard) = self.0.lock() {
            *guard = value;
        }
    }
}

async fn ensure_profile_unlocked(
    profiles: &LocalProfileStore,
    session: &ProfileSession,
    profile_id: &str,
) -> Result<(), String> {
    if profiles
        .has_password(profile_id)
        .await
        .map_err(|error| error.to_string())?
        && session.get().as_deref() != Some(profile_id)
    {
        return Err("Профіль захищено паролем: спершу увійдіть у нього".to_owned());
    }
    Ok(())
}

/// The updater plugin builds reqwest with rustls but leaves the crypto
/// provider unset until its own first check. Any reqwest client created
/// before that (the loopback Signal daemon client) panics without one.
pub(crate) fn install_tls_provider() {
    if rustls::crypto::CryptoProvider::get_default().is_none() {
        let _ = rustls::crypto::ring::default_provider().install_default();
    }
}

#[tauri::command]
async fn get_database_status(
    status: tauri::State<'_, DatabaseStatusStore>,
) -> Result<DatabaseStatus, String> {
    status.load().await.map_err(|error| error.to_string())
}

#[tauri::command]
async fn get_dashboard_model(
    repository: tauri::State<'_, Repository>,
    from: Option<String>,
    to: Option<String>,
) -> Result<analytics::DashboardModel, String> {
    analytics::load_dashboard_model(&repository, from.as_deref(), to.as_deref())
        .await
        .map_err(|error| error.to_string())
}

#[tauri::command]
async fn get_local_profiles(
    profiles: tauri::State<'_, LocalProfileStore>,
) -> Result<LocalProfilesState, String> {
    profiles.list().await.map_err(|error| error.to_string())
}

#[tauri::command]
async fn create_local_profile(
    profiles: tauri::State<'_, LocalProfileStore>,
    display_name: String,
) -> Result<LocalProfilesState, String> {
    let now = Utc::now().to_rfc3339_opts(SecondsFormat::Nanos, true);
    let profile_id = local_profiles::generate_profile_id(&display_name, &now);
    profiles
        .create(&profile_id, &display_name, &now)
        .await
        .map_err(|error| error.to_string())
}

#[tauri::command]
async fn rename_local_profile(
    profiles: tauri::State<'_, LocalProfileStore>,
    session: tauri::State<'_, ProfileSession>,
    profile_id: String,
    display_name: String,
) -> Result<LocalProfilesState, String> {
    ensure_profile_unlocked(&profiles, &session, &profile_id).await?;
    let now = Utc::now().to_rfc3339_opts(SecondsFormat::Nanos, true);
    profiles
        .rename(&profile_id, &display_name, &now)
        .await
        .map_err(|error| error.to_string())
}

/// Вхід у профіль: для захищеного профілю потрібен пароль.
#[tauri::command]
async fn activate_local_profile(
    profiles: tauri::State<'_, LocalProfileStore>,
    session: tauri::State<'_, ProfileSession>,
    profile_id: String,
    password: Option<String>,
) -> Result<LocalProfilesState, String> {
    if !profiles
        .verify_password(&profile_id, password.as_deref().unwrap_or(""))
        .await
        .map_err(|error| error.to_string())?
    {
        return Err(local_profiles::LocalProfileError::WrongPassword.to_string());
    }
    let now = Utc::now().to_rfc3339_opts(SecondsFormat::Nanos, true);
    let state = profiles
        .activate(&profile_id, &now)
        .await
        .map_err(|error| error.to_string())?;
    session.set(Some(profile_id));
    Ok(state)
}

/// Профіль, у який увійшли в цьому запуску.
#[tauri::command]
fn get_profile_session(session: tauri::State<'_, ProfileSession>) -> Option<String> {
    session.get()
}

#[tauri::command]
fn lock_local_profile(session: tauri::State<'_, ProfileSession>) {
    session.set(None);
}

#[tauri::command]
async fn update_local_profile_details(
    profiles: tauri::State<'_, LocalProfileStore>,
    session: tauri::State<'_, ProfileSession>,
    profile_id: String,
    position: String,
    avatar_data_url: Option<String>,
) -> Result<LocalProfilesState, String> {
    ensure_profile_unlocked(&profiles, &session, &profile_id).await?;
    let now = Utc::now().to_rfc3339_opts(SecondsFormat::Nanos, true);
    profiles
        .update_details(&profile_id, &position, avatar_data_url.as_deref(), &now)
        .await
        .map_err(|error| error.to_string())
}

#[tauri::command]
async fn set_local_profile_password(
    profiles: tauri::State<'_, LocalProfileStore>,
    session: tauri::State<'_, ProfileSession>,
    profile_id: String,
    current_password: Option<String>,
    new_password: Option<String>,
) -> Result<LocalProfilesState, String> {
    let now = Utc::now().to_rfc3339_opts(SecondsFormat::Nanos, true);
    let state = profiles
        .set_password(
            &profile_id,
            current_password.as_deref(),
            new_password.as_deref(),
            &now,
        )
        .await
        .map_err(|error| error.to_string())?;
    // Пароль до активного профілю лишає користувача в ньому; пароль до іншого
    // профілю не змінює поточну сесію.
    if state.active_profile_id.as_deref() == Some(profile_id.as_str()) {
        session.set(Some(profile_id));
    }
    Ok(state)
}

#[tauri::command]
async fn choose_profile_database(
    app: tauri::AppHandle,
    profiles: tauri::State<'_, LocalProfileStore>,
    session: tauri::State<'_, ProfileSession>,
    profile_id: String,
    branch: Branch,
) -> Result<Option<LocalProfilesState>, String> {
    ensure_profile_unlocked(&profiles, &session, &profile_id).await?;
    let selected = tauri::async_runtime::spawn_blocking(move || {
        app.dialog()
            .file()
            .set_title(format!(
                "Прив'язати таблицю {} до профілю",
                branch.genitive()
            ))
            .add_filter("Таблиця XLSX", &["xlsx"])
            .blocking_pick_file()
    })
    .await
    .map_err(|error| error.to_string())?;
    let Some(selected) = selected else {
        return Ok(None);
    };
    let path = selected.into_path().map_err(|error| error.to_string())?;
    read_selected_xlsx(&path)?;
    let now = Utc::now().to_rfc3339_opts(SecondsFormat::Nanos, true);
    profiles
        .set_table_path(&profile_id, branch, Some(&path.to_string_lossy()), &now)
        .await
        .map(Some)
        .map_err(|error| error.to_string())
}

#[tauri::command]
async fn clear_profile_database(
    profiles: tauri::State<'_, LocalProfileStore>,
    session: tauri::State<'_, ProfileSession>,
    profile_id: String,
    branch: Branch,
) -> Result<LocalProfilesState, String> {
    ensure_profile_unlocked(&profiles, &session, &profile_id).await?;
    let now = Utc::now().to_rfc3339_opts(SecondsFormat::Nanos, true);
    profiles
        .set_table_path(&profile_id, branch, None, &now)
        .await
        .map_err(|error| error.to_string())
}

#[derive(serde::Serialize)]
struct CreatedBaseTable {
    state: LocalProfilesState,
    path: String,
}

/// Зберігає порожню базову таблицю в новий файл і прив'язує її до профілю
/// для того роду військ, чий модуль її відкриває.
#[tauri::command]
async fn create_profile_base_table(
    app: tauri::AppHandle,
    profiles: tauri::State<'_, LocalProfileStore>,
    session: tauri::State<'_, ProfileSession>,
    profile_id: String,
    table: BaseTable,
) -> Result<Option<CreatedBaseTable>, String> {
    ensure_profile_unlocked(&profiles, &session, &profile_id).await?;
    let selected = tauri::async_runtime::spawn_blocking(move || {
        app.dialog()
            .file()
            .set_title(format!("Зберегти порожню базову таблицю {}", table.title()))
            .set_file_name(table.file_name())
            .add_filter("Таблиця XLSX", &["xlsx"])
            .blocking_save_file()
    })
    .await
    .map_err(|error| error.to_string())?;
    let Some(selected) = selected else {
        return Ok(None);
    };
    let mut path = selected.into_path().map_err(|error| error.to_string())?;
    if !path
        .extension()
        .is_some_and(|extension| extension.eq_ignore_ascii_case("xlsx"))
    {
        path.as_mut_os_string().push(".xlsx");
    }
    let target = path.clone();
    tauri::async_runtime::spawn_blocking(move || base_tables::write_new(&target, table))
        .await
        .map_err(|error| error.to_string())?
        .map_err(|error| error.to_string())?;
    let path = path.to_string_lossy().into_owned();
    let now = Utc::now().to_rfc3339_opts(SecondsFormat::Nanos, true);
    let state = profiles
        .set_table_path(&profile_id, table.branch(), Some(&path), &now)
        .await
        .map_err(|error| error.to_string())?;
    Ok(Some(CreatedBaseTable { state, path }))
}

async fn bound_database_path(
    profiles: &LocalProfileStore,
    session: &ProfileSession,
    profile_id: &str,
    branch: Branch,
) -> Result<PathBuf, String> {
    ensure_profile_unlocked(profiles, session, profile_id).await?;
    profiles
        .table_path(profile_id, branch)
        .await
        .map_err(|error| error.to_string())?
        .map(PathBuf::from)
        .ok_or_else(|| format!("До профілю не прив'язано таблицю {}", branch.genitive()))
}

/// Сирі байти прив'язаної таблиці (без JSON, щоб не роздувати великі файли).
#[tauri::command]
async fn read_profile_database(
    profiles: tauri::State<'_, LocalProfileStore>,
    session: tauri::State<'_, ProfileSession>,
    profile_id: String,
    branch: Branch,
) -> Result<tauri::ipc::Response, String> {
    let path = bound_database_path(&profiles, &session, &profile_id, branch).await?;
    let bytes = tauri::async_runtime::spawn_blocking(move || read_selected_xlsx(&path))
        .await
        .map_err(|error| error.to_string())??;
    Ok(tauri::ipc::Response::new(bytes))
}

/// Записує таблицю назад у прив'язаний файл. Тіло запиту — сирі байти XLSX,
/// профіль і рід військ — у заголовках `x-easywar-profile` і `x-easywar-branch`.
#[tauri::command]
async fn write_profile_database(
    request: tauri::ipc::Request<'_>,
    profiles: tauri::State<'_, LocalProfileStore>,
    session: tauri::State<'_, ProfileSession>,
) -> Result<(), String> {
    let header = |name: &str| {
        request
            .headers()
            .get(name)
            .and_then(|value| value.to_str().ok())
            .map(str::to_owned)
    };
    let profile_id = header("x-easywar-profile").ok_or_else(|| "Не вказано профіль".to_owned())?;
    let branch = header("x-easywar-branch")
        .ok_or_else(|| "Не вказано рід військ".to_owned())
        .and_then(|value| Branch::parse(&value).map_err(|error| error.to_string()))?;
    let tauri::ipc::InvokeBody::Raw(bytes) = request.body() else {
        return Err("Очікувано байти XLSX".to_owned());
    };
    if bytes.len() as u64 > MAX_XLSX_BYTES || !bytes.starts_with(b"PK") {
        return Err("Некоректний файл XLSX".to_owned());
    }
    let bytes = bytes.clone();
    let path = bound_database_path(&profiles, &session, &profile_id, branch).await?;
    tauri::async_runtime::spawn_blocking(move || write_file_atomically(&path, &bytes))
        .await
        .map_err(|error| error.to_string())?
}

fn write_file_atomically(path: &Path, bytes: &[u8]) -> Result<(), String> {
    use std::io::Write;
    let directory = path
        .parent()
        .ok_or_else(|| "Некоректний шлях до таблиці".to_owned())?;
    let mut temporary = tempfile::NamedTempFile::new_in(directory)
        .map_err(|error| format!("Не вдалося записати таблицю: {error}"))?;
    temporary
        .write_all(bytes)
        .and_then(|_| temporary.as_file().sync_all())
        .map_err(|error| format!("Не вдалося записати таблицю: {error}"))?;
    temporary
        .persist(path)
        .map_err(|error| format!("Не вдалося замінити таблицю: {}", error.error))?;
    Ok(())
}

#[tauri::command]
async fn delete_local_profile(
    profiles: tauri::State<'_, LocalProfileStore>,
    session: tauri::State<'_, ProfileSession>,
    profile_id: String,
) -> Result<LocalProfilesState, String> {
    ensure_profile_unlocked(&profiles, &session, &profile_id).await?;
    let now = Utc::now().to_rfc3339_opts(SecondsFormat::Nanos, true);
    profiles
        .delete(&profile_id, &now)
        .await
        .map_err(|error| error.to_string())
}

#[tauri::command]
async fn get_workspace_templates(
    templates: tauri::State<'_, WorkspaceTemplateStore>,
) -> Result<WorkspaceTemplatesState, String> {
    templates.list().await.map_err(|error| error.to_string())
}

#[tauri::command]
async fn set_profile_workspace_template(
    templates: tauri::State<'_, WorkspaceTemplateStore>,
    profile_id: String,
    template_key: String,
) -> Result<WorkspaceTemplatesState, String> {
    let now = Utc::now().to_rfc3339_opts(SecondsFormat::Nanos, true);
    templates
        .assign(&profile_id, &template_key, &now)
        .await
        .map_err(|error| error.to_string())
}

#[tauri::command]
async fn create_position_database_template(
    app: tauri::AppHandle,
    template_key: String,
) -> Result<Option<PositionDatabaseTemplate>, String> {
    let template = workspace_templates::workspace_template(&template_key)
        .ok_or_else(|| "невідомий шаблон робочого простору".to_owned())?;
    let suggested_name = format!("EasyWAR-порожня-база-{}.sqlite3", template.key);
    let selected = tauri::async_runtime::spawn_blocking(move || {
        app.dialog()
            .file()
            .set_title("Створити порожню базу EasyWAR для позиції")
            .set_file_name(&suggested_name)
            .add_filter("База SQLite", &["sqlite3"])
            .blocking_save_file()
    })
    .await
    .map_err(|error| error.to_string())?;
    let Some(selected) = selected else {
        return Ok(None);
    };
    let destination = selected.into_path().map_err(|error| error.to_string())?;
    position_templates::create_position_database_template(
        &destination,
        &template_key,
        &Utc::now().to_rfc3339_opts(SecondsFormat::Nanos, true),
    )
    .await
    .map(Some)
    .map_err(|error| error.to_string())
}

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

#[tauri::command]
async fn stage_local_restore(
    app: tauri::AppHandle,
    live_database: tauri::State<'_, LiveDatabasePath>,
) -> Result<Option<BackupInspection>, String> {
    let selected = tauri::async_runtime::spawn_blocking(move || {
        app.dialog()
            .file()
            .set_title("Обрати резервну копію для відновлення EasyWAR")
            .add_filter("База SQLite", &["sqlite3"])
            .blocking_pick_file()
    })
    .await
    .map_err(|error| error.to_string())?;
    let Some(selected) = selected else {
        return Ok(None);
    };
    let source = selected.into_path().map_err(|error| error.to_string())?;
    restore::stage_backup(&source, &live_database.0)
        .await
        .map(Some)
        .map_err(|error| error.to_string())
}

#[tauri::command]
fn cancel_staged_restore(live_database: tauri::State<'_, LiveDatabasePath>) -> Result<(), String> {
    restore::cancel_staged_restore(&live_database.0).map_err(|error| error.to_string())
}

#[tauri::command]
async fn apply_staged_restore_and_restart(
    app: tauri::AppHandle,
    live_database: tauri::State<'_, LiveDatabasePath>,
) -> Result<(), String> {
    restore::request_staged_restore(&live_database.0)
        .await
        .map_err(|error| error.to_string())?;
    app.request_restart();
    Ok(())
}

#[tauri::command]
async fn check_for_app_update(
    app: tauri::AppHandle,
    pending: tauri::State<'_, PendingUpdate>,
) -> Result<AppUpdateStatus, String> {
    app_update::check(&app, &pending)
        .await
        .map_err(|error| error.to_string())
}

#[tauri::command]
async fn get_app_update_settings(
    store: tauri::State<'_, AutoUpdateStore>,
) -> Result<AutoUpdateSettings, String> {
    store.load().await.map_err(|error| error.to_string())
}

#[tauri::command]
async fn set_app_update_auto_check(
    store: tauri::State<'_, AutoUpdateStore>,
    enabled: bool,
) -> Result<AutoUpdateSettings, String> {
    store
        .set_enabled(enabled, Utc::now())
        .await
        .map_err(|error| error.to_string())
}

/// Runs the optional automatic check when the user turned it on and a day has
/// passed since the last one; otherwise returns None without any network access.
#[tauri::command]
async fn auto_check_for_app_update(
    app: tauri::AppHandle,
    pending: tauri::State<'_, PendingUpdate>,
    store: tauri::State<'_, AutoUpdateStore>,
) -> Result<Option<AppUpdateStatus>, String> {
    if !store
        .claim_due_check(Utc::now())
        .await
        .map_err(|error| error.to_string())?
    {
        return Ok(None);
    }
    app_update::check(&app, &pending)
        .await
        .map(Some)
        .map_err(|error| error.to_string())
}

#[tauri::command]
async fn install_app_update(
    app: tauri::AppHandle,
    pending: tauri::State<'_, PendingUpdate>,
    backup: tauri::State<'_, BackupStore>,
    live_database: tauri::State<'_, LiveDatabasePath>,
) -> Result<String, String> {
    let backups_dir = live_database
        .0
        .parent()
        .ok_or("не вдалося визначити папку локальної бази")?
        .join("backups");
    let snapshot = app_update::install(&pending, &backup, &backups_dir)
        .await
        .map_err(|error| error.to_string())?;
    app.request_restart();
    Ok(snapshot.to_string_lossy().into_owned())
}

#[tauri::command]
fn get_restore_startup_report(
    report: tauri::State<'_, RestoreStartupReport>,
) -> RestoreStartupReport {
    report.inner().clone()
}

#[tauri::command]
async fn finalize_local_restore(
    live_database: tauri::State<'_, LiveDatabasePath>,
) -> Result<(), String> {
    restore::finalize_previous_backup(&live_database.0)
        .await
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
    let context = tauri::generate_context!();
    let database_name = database::DATABASE_URL
        .strip_prefix("sqlite:")
        .expect("локальна база має використовувати SQLite");
    let database_file = dirs::config_dir()
        .expect("не вдалося визначити локальну директорію конфігурації")
        .join(&context.config().identifier)
        .join(database_name);
    let instance_lock = restore::acquire_application_instance_lock(&database_file)
        .expect("інший екземпляр EasyWAR уже працює або lock недоступний");
    tauri::async_runtime::block_on(restore::recover_live_sidecars(
        &database_file,
        &instance_lock,
    ))
    .expect("не вдалося безпечно завершити відновлення SQLite після попереднього запуску");
    let restore_startup_report =
        tauri::async_runtime::block_on(restore::process_requested_restore(&database_file))
            .expect("не вдалося безпечно обробити підготовлене відновлення");
    tauri::async_runtime::block_on(migration_startup::prepare_database(&database_file))
        .expect("не вдалося безпечно підготувати або оновити локальну SQLite-базу");
    let setup_database_file = database_file.clone();

    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(
            tauri_plugin_sql::Builder::default()
                .add_migrations(database::DATABASE_URL, database::migrations())
                .build(),
        )
        .setup(move |app| {
            let resolved_database_file = app.path().app_config_dir()?.join(database_name);
            if resolved_database_file != setup_database_file {
                return Err(
                    "шлях локальної бази не збігається з перевіреним startup-шляхом".into(),
                );
            }
            let options = SqliteConnectOptions::new()
                .filename(&setup_database_file)
                .foreign_keys(true)
                .busy_timeout(Duration::from_secs(5));
            let pool = tauri::async_runtime::block_on(
                SqlitePoolOptions::new()
                    .max_connections(1)
                    .connect_with(options),
            )?;
            app.manage(SignalSettingsStore::new(SettingsStore::new(pool.clone())));
            app.manage(AutoUpdateStore::new(SettingsStore::new(pool.clone())));
            app.manage(Repository::new(pool.clone()));
            app.manage(LocalProfileStore::new(pool.clone()));
            app.manage(ProfileSession::default());
            app.manage(WorkspaceTemplateStore::new(pool.clone()));
            app.manage(SignalReceiveController::default());
            app.manage(DatabaseStatusStore::new(pool.clone()));
            app.manage(BackupStore::new(pool));
            app.manage(LiveDatabasePath(setup_database_file));
            app.manage(instance_lock);
            app.manage(restore_startup_report);
            app.manage(PendingUpdate::default());
            desktop_shell::create_main_window(app)?;
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            get_database_status,
            get_dashboard_model,
            get_local_profiles,
            create_local_profile,
            rename_local_profile,
            activate_local_profile,
            delete_local_profile,
            get_profile_session,
            lock_local_profile,
            update_local_profile_details,
            set_local_profile_password,
            choose_profile_database,
            create_profile_base_table,
            clear_profile_database,
            read_profile_database,
            write_profile_database,
            get_workspace_templates,
            set_profile_workspace_template,
            create_position_database_template,
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
            stage_local_restore,
            cancel_staged_restore,
            apply_staged_restore_and_restart,
            get_restore_startup_report,
            finalize_local_restore,
            check_for_app_update,
            auto_check_for_app_update,
            get_app_update_settings,
            set_app_update_auto_check,
            install_app_update,
            inspect_local_xlsx,
            stage_local_xlsx,
            export_approved_xlsx,
            export_approved_xlsx_from_reference
        ])
        .run(context)
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
