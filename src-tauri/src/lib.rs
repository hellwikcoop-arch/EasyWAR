pub mod analytics;
mod app_update;
pub mod backup;
pub mod base_tables;
pub mod dashboard_modules;
mod database;
mod desktop_shell;
pub mod easyslide;
pub mod local_model;
pub mod local_profiles;
mod migration_startup;
pub mod model_install;
pub mod module_source;
pub mod phone_export;
pub mod position_templates;
pub mod profile_table;
pub mod repository;
pub mod restore;
pub mod signal_commands;
pub mod signal_daemon;
pub mod signal_inbox;
pub mod signal_ingest;
pub mod signal_policy;
pub mod signal_session;
pub mod signal_settings;
mod startup_recovery;
pub mod update_settings;
pub mod workspace_templates;
pub mod xlsx_export;
pub mod xlsx_import;

use app_update::{AppUpdateStatus, PendingUpdate};
use backup::BackupStore;
use base_tables::BaseTable;
use chrono::{SecondsFormat, Utc};
use dashboard_modules::{
    DashboardModule, DashboardModuleData, DashboardModuleStore, DashboardModuleTemplate,
    NewImportCorrection,
};
use database::{DatabaseStatus, DatabaseStatusStore};
use local_model::{
    GenerationRequest, LocalModelRuntime, LocalModelSettings, LocalModelStatus, LocalModelStore,
    ModelEvent,
};
use local_profiles::{Branch, LocalProfileStore, LocalProfilesState};
use model_install::{Finalized, InstallController, InstallEvent, InstallInfo};
use phone_export::PhoneDashboard;
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
fn get_dashboard_module_catalog() -> Vec<DashboardModuleTemplate> {
    dashboard_modules::catalog()
}

fn active_profile_id(session: &ProfileSession) -> Result<String, String> {
    session
        .get()
        .ok_or_else(|| dashboard_modules::DashboardModuleError::ProfileRequired.to_string())
}

#[tauri::command]
async fn list_dashboard_modules(
    modules: tauri::State<'_, DashboardModuleStore>,
    session: tauri::State<'_, ProfileSession>,
    branch: String,
) -> Result<Vec<DashboardModule>, String> {
    modules
        .list(&active_profile_id(&session)?, &branch)
        .await
        .map_err(|error| error.to_string())
}

/// `rows` — дані, підтягнуті з таблиці користувача: модуль створюється разом із ними
/// однією транзакцією. Без `rows` таблиця модуля порожня.
#[tauri::command]
async fn create_dashboard_module(
    modules: tauri::State<'_, DashboardModuleStore>,
    session: tauri::State<'_, ProfileSession>,
    branch: String,
    template_id: String,
    title: Option<String>,
    rows: Option<Vec<serde_json::Map<String, Value>>>,
    corrections: Option<Vec<NewImportCorrection>>,
) -> Result<DashboardModule, String> {
    let now = Utc::now().to_rfc3339_opts(SecondsFormat::Nanos, true);
    modules
        .create_with_import(
            &active_profile_id(&session)?,
            &branch,
            &template_id,
            title.as_deref(),
            rows.unwrap_or_default(),
            corrections.unwrap_or_default(),
            &now,
        )
        .await
        .map_err(|error| error.to_string())
}

/// Файл, який користувач сам обрав у вікні вибору, щоб підтягнути з нього дані в
/// модуль. Шлях береться лише з вікна вибору: від інтерфейсу шлях не приймається.
#[derive(Default)]
struct ModuleSourceSelection(std::sync::Mutex<Option<PathBuf>>);

impl ModuleSourceSelection {
    fn get(&self) -> Option<PathBuf> {
        self.0.lock().map(|guard| guard.clone()).unwrap_or(None)
    }

    fn set(&self, value: Option<PathBuf>) {
        if let Ok(mut guard) = self.0.lock() {
            *guard = value;
        }
    }
}

fn dashboard_branch(branch: &str) -> Result<Branch, String> {
    match Branch::parse(branch) {
        Ok(parsed @ (Branch::Air | Branch::Rocket | Branch::Pvk | Branch::Dshv)) => Ok(parsed),
        _ => Err(dashboard_modules::DashboardModuleError::InvalidBranch.to_string()),
    }
}

fn inspect_source_file(path: &Path, origin: &str) -> Result<module_source::SourceWorkbook, String> {
    let bytes = read_selected_xlsx(path)?;
    let name = path
        .file_name()
        .map(|name| name.to_string_lossy().into_owned())
        .unwrap_or_default();
    module_source::inspect_bytes(&bytes, &name, origin).map_err(|error| error.to_string())
}

/// Аркуші таблиці, прив'язаної до активного профілю для цього дашборда. З неї модуль
/// під час створення підтягує дані. Лише читання; `None`, якщо таблицю не прив'язано.
#[tauri::command]
async fn inspect_linked_module_source(
    profiles: tauri::State<'_, LocalProfileStore>,
    session: tauri::State<'_, ProfileSession>,
    branch: String,
) -> Result<Option<module_source::SourceWorkbook>, String> {
    let branch = dashboard_branch(&branch)?;
    let profile_id = active_profile_id(&session)?;
    let Some(path) = profiles
        .table_path(&profile_id, branch)
        .await
        .map_err(|error| error.to_string())?
        .map(PathBuf::from)
    else {
        return Ok(None);
    };
    tauri::async_runtime::spawn_blocking(move || inspect_source_file(&path, "linked"))
        .await
        .map_err(|error| error.to_string())?
        .map(Some)
}

/// Вікно вибору файла .xlsx, з якого модуль підтягне дані. Файл не прив'язується до
/// профілю й не змінюється; його шлях лишається лише в пам'яті на час створення.
#[tauri::command]
async fn pick_module_source(
    app: tauri::AppHandle,
    session: tauri::State<'_, ProfileSession>,
    selection: tauri::State<'_, ModuleSourceSelection>,
) -> Result<Option<module_source::SourceWorkbook>, String> {
    active_profile_id(&session)?;
    let selected = tauri::async_runtime::spawn_blocking(move || {
        app.dialog()
            .file()
            .set_title("Оберіть таблицю XLSX з даними для модуля")
            .add_filter("Таблиця XLSX", &["xlsx"])
            .blocking_pick_file()
    })
    .await
    .map_err(|error| error.to_string())?;
    let Some(selected) = selected else {
        return Ok(None);
    };
    let path = selected.into_path().map_err(|error| error.to_string())?;
    let inspected = {
        let path = path.clone();
        tauri::async_runtime::spawn_blocking(move || inspect_source_file(&path, "picked"))
            .await
            .map_err(|error| error.to_string())??
    };
    selection.set(Some(path));
    Ok(Some(inspected))
}

/// Усі непорожні рядки одного аркуша таблиці для підтягування в модуль. `origin` —
/// `linked` (прив'язана таблиця профілю) або `picked` (файл, обраний у вікні вибору).
#[tauri::command]
async fn read_module_source_sheet(
    profiles: tauri::State<'_, LocalProfileStore>,
    session: tauri::State<'_, ProfileSession>,
    selection: tauri::State<'_, ModuleSourceSelection>,
    origin: String,
    branch: String,
    sheet: String,
) -> Result<module_source::SourceSheetRows, String> {
    let profile_id = active_profile_id(&session)?;
    let path = match origin.as_str() {
        "linked" => profiles
            .table_path(&profile_id, dashboard_branch(&branch)?)
            .await
            .map_err(|error| error.to_string())?
            .map(PathBuf::from)
            .ok_or_else(|| "До профілю не прив'язано таблицю".to_owned())?,
        "picked" => selection
            .get()
            .ok_or_else(|| "Файл таблиці не обрано".to_owned())?,
        _ => return Err("Невідоме джерело таблиці".to_owned()),
    };
    tauri::async_runtime::spawn_blocking(move || {
        let bytes = read_selected_xlsx(&path)?;
        module_source::read_sheet_bytes(&bytes, &sheet).map_err(|error| error.to_string())
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
async fn get_dashboard_module_data(
    modules: tauri::State<'_, DashboardModuleStore>,
    session: tauri::State<'_, ProfileSession>,
    module_id: String,
) -> Result<DashboardModuleData, String> {
    modules
        .get_data(&active_profile_id(&session)?, &module_id)
        .await
        .map_err(|error| error.to_string())
}

#[tauri::command]
async fn replace_dashboard_module_rows(
    modules: tauri::State<'_, DashboardModuleStore>,
    session: tauri::State<'_, ProfileSession>,
    module_id: String,
    rows: Vec<serde_json::Map<String, Value>>,
    expected_updated_at: Option<String>,
) -> Result<DashboardModuleData, String> {
    let now = Utc::now().to_rfc3339_opts(SecondsFormat::Nanos, true);
    modules
        .replace_rows(
            &active_profile_id(&session)?,
            &module_id,
            rows,
            expected_updated_at.as_deref(),
            &now,
        )
        .await
        .map_err(|error| error.to_string())
}

#[tauri::command]
async fn get_local_profiles(
    profiles: tauri::State<'_, LocalProfileStore>,
) -> Result<LocalProfilesState, String> {
    profiles.list().await.map_err(|error| error.to_string())
}

/// Реєстрація користувача: профіль, обов'язковий пароль, посада, фото й обрані модулі
/// створюються одним кроком, а новий користувач одразу входить у свій профіль.
/// Профілю без пароля цей шлях не створює.
#[tauri::command]
async fn register_local_profile(
    profiles: tauri::State<'_, LocalProfileStore>,
    session: tauri::State<'_, ProfileSession>,
    display_name: String,
    password: String,
    position: Option<String>,
    avatar_data_url: Option<String>,
    modules: Vec<String>,
) -> Result<LocalProfilesState, String> {
    let now = Utc::now().to_rfc3339_opts(SecondsFormat::Nanos, true);
    let profile_id = local_profiles::generate_profile_id(&display_name, &now);
    let state = profiles
        .register(
            local_profiles::NewProfile {
                id: &profile_id,
                display_name: &display_name,
                password: &password,
                position: position.as_deref().unwrap_or(""),
                avatar_data_url: avatar_data_url.as_deref(),
                modules: &modules,
            },
            &now,
        )
        .await
        .map_err(|error| error.to_string())?;
    session.set(Some(profile_id));
    Ok(state)
}

#[tauri::command]
async fn set_local_profile_modules(
    profiles: tauri::State<'_, LocalProfileStore>,
    session: tauri::State<'_, ProfileSession>,
    profile_id: String,
    modules: Vec<String>,
) -> Result<LocalProfilesState, String> {
    ensure_profile_unlocked(&profiles, &session, &profile_id).await?;
    let now = Utc::now().to_rfc3339_opts(SecondsFormat::Nanos, true);
    profiles
        .set_modules(&profile_id, &modules, &now)
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

/// Вхід у профіль: для захищеного профілю потрібен пароль. Після п'яти неправильних
/// паролів поспіль вхід у цей профіль зупиняється на 30 с, далі пауза подвоюється (до
/// 10 хв); перший правильний пароль скидає лічильник. Лічильник лише в пам'яті процесу
/// і спільний із підтвердженням чинного пароля в `set_local_profile_password`.
/// Профіль без пароля, як і раніше, приймає будь-який пароль.
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
fn lock_local_profile(
    session: tauri::State<'_, ProfileSession>,
    model: tauri::State<'_, LocalModelRuntime>,
    installer: tauri::State<'_, InstallController>,
) {
    session.set(None);
    // A locked profile never leaves a model answering or holding memory,
    // and never keeps downloading in the background.
    model.stop();
    installer.cancel();
}

fn local_model_signed_in(session: &ProfileSession) -> Result<(), String> {
    if session.get().is_none() {
        return Err("Спершу увійдіть у профіль".to_owned());
    }
    Ok(())
}

async fn local_model_status_now(
    store: &LocalModelStore,
    runtime: &LocalModelRuntime,
) -> Result<LocalModelStatus, String> {
    let settings = store.load().await.map_err(|error| error.to_string())?;
    let mut status = local_model::quick_status(&settings);
    status.loaded = runtime.is_loaded();
    status.busy = runtime.is_busy();
    Ok(status)
}

/// Стан необов'язкової локальної мовної моделі. Нічого не завантажує й не запускає.
#[tauri::command]
async fn get_local_model_status(
    store: tauri::State<'_, LocalModelStore>,
    runtime: tauri::State<'_, LocalModelRuntime>,
) -> Result<LocalModelStatus, String> {
    local_model_status_now(&store, &runtime).await
}

/// Користувач сам обирає папку пакета моделі; перевіряються маніфест і SHA-256 файлів.
/// Після успішної перевірки модель одразу вмикається (`enabled: true`); вимкнути її можна
/// окремо командою `set_local_model_enabled`.
#[tauri::command]
async fn choose_local_model_package(
    app: tauri::AppHandle,
    store: tauri::State<'_, LocalModelStore>,
    runtime: tauri::State<'_, LocalModelRuntime>,
    session: tauri::State<'_, ProfileSession>,
) -> Result<Option<LocalModelStatus>, String> {
    local_model_signed_in(&session)?;
    let selected = tauri::async_runtime::spawn_blocking(move || {
        app.dialog()
            .file()
            .set_title("Оберіть папку пакета локальної моделі")
            .blocking_pick_folder()
    })
    .await
    .map_err(|error| error.to_string())?;
    let Some(selected) = selected else {
        return Ok(None);
    };
    let path = selected.into_path().map_err(|error| error.to_string())?;
    let package = tauri::async_runtime::spawn_blocking(move || local_model::verify_package(&path))
        .await
        .map_err(|error| error.to_string())?
        .map_err(|error| error.to_string())?;
    runtime.stop();
    store
        .save(&local_model_settings_for(&package), Utc::now())
        .await
        .map_err(|error| error.to_string())?;
    local_model_status_now(&store, &runtime).await.map(Some)
}

#[tauri::command]
async fn set_local_model_enabled(
    store: tauri::State<'_, LocalModelStore>,
    runtime: tauri::State<'_, LocalModelRuntime>,
    session: tauri::State<'_, ProfileSession>,
    enabled: bool,
) -> Result<LocalModelStatus, String> {
    local_model_signed_in(&session)?;
    let mut settings = store.load().await.map_err(|error| error.to_string())?;
    if enabled {
        if settings.package_dir.is_none() {
            return Err("Спершу оберіть пакет моделі".to_owned());
        }
        settings.enabled = true;
        let status = local_model::quick_status(&settings);
        if let Some(message) = status.message {
            return Err(message);
        }
    } else {
        settings.enabled = false;
        runtime.stop();
    }
    store
        .save(&settings, Utc::now())
        .await
        .map_err(|error| error.to_string())?;
    local_model_status_now(&store, &runtime).await
}

#[tauri::command]
async fn forget_local_model_package(
    store: tauri::State<'_, LocalModelStore>,
    runtime: tauri::State<'_, LocalModelRuntime>,
    session: tauri::State<'_, ProfileSession>,
) -> Result<LocalModelStatus, String> {
    local_model_signed_in(&session)?;
    runtime.stop();
    store
        .save(&LocalModelSettings::default(), Utc::now())
        .await
        .map_err(|error| error.to_string())?;
    local_model_status_now(&store, &runtime).await
}

fn local_model_settings_for(package: &local_model::VerifiedPackage) -> LocalModelSettings {
    LocalModelSettings {
        package_dir: Some(package.dir.to_string_lossy().into_owned()),
        enabled: true,
        manifest_sha256: Some(package.manifest_sha256.clone()),
        model_size: package.model_size,
        model_modified: package.model_modified,
    }
}

/// The folder the application itself creates for the model. It lives in the
/// local (non-roaming) data directory because the file is gigabytes in size.
fn local_model_install_dir(
    app: &tauri::AppHandle,
    source: &model_install::ModelSource,
) -> Result<std::path::PathBuf, String> {
    app.path()
        .app_local_data_dir()
        .map(|dir| dir.join("local-models").join(&source.id))
        .map_err(|error| error.to_string())
}

/// Що буде завантажено й що вже лежить на диску. Мережі не торкається.
#[tauri::command]
fn get_local_model_install_info(
    app: tauri::AppHandle,
    installer: tauri::State<'_, InstallController>,
) -> Result<InstallInfo, String> {
    let source = model_install::qwen3_4b_q4km();
    let dir = local_model_install_dir(&app, &source)?;
    Ok(model_install::info(
        &source,
        &dir,
        installer.is_busy(),
        model_install::bundled_runner().is_some(),
    ))
}

#[derive(Debug, serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct InstallResult {
    /// `ready` — пакет підключено; `modelOnly` — модель є, бракує рушія;
    /// `cancelled` — завантажену частину збережено.
    outcome: &'static str,
    status: LocalModelStatus,
    message: Option<String>,
}

/// Явне встановлення моделі: завантаження, перевірка SHA-256, а за наявності
/// рушія поруч — запис маніфесту й повна перевірка пакета. Починається лише з цієї команди.
/// Підтвердження в інтерфейсі сторінки не є захистом (його може оминути будь-який скрипт
/// вікна), тому перед першим мережевим запитом, зокрема й при поновленні завантаження,
/// Rust сам показує нативне вікно «Так/Ні». Відмова повертає `outcome: "cancelled"`.
#[tauri::command]
async fn install_local_model(
    app: tauri::AppHandle,
    store: tauri::State<'_, LocalModelStore>,
    runtime: tauri::State<'_, LocalModelRuntime>,
    installer: tauri::State<'_, InstallController>,
    session: tauri::State<'_, ProfileSession>,
    on_event: tauri::ipc::Channel<InstallEvent>,
) -> Result<InstallResult, String> {
    local_model_signed_in(&session)?;
    let guard = installer.begin().map_err(|error| error.to_string())?;
    let source = model_install::qwen3_4b_q4km();
    let dir = local_model_install_dir(&app, &source)?;
    let emit: model_install::Emit = std::sync::Arc::new(move |event| {
        let _ = on_event.send(event);
    });
    match model_install::install_model(&source, &dir, &guard, emit, model_install::native_consent())
        .await
    {
        Ok(_) => {}
        Err(
            error
            @ (model_install::InstallError::Cancelled | model_install::InstallError::Declined),
        ) => {
            return Ok(InstallResult {
                outcome: "cancelled",
                status: local_model_status_now(&store, &runtime).await?,
                message: Some(error.to_string()),
            });
        }
        Err(error) => return Err(error.to_string()),
    }
    let finalize_source = source.clone();
    let finalize_dir = dir.clone();
    // Windows cannot replace a program that is running: stop the old runner before the copy.
    runtime.stop();
    let finalized = tauri::async_runtime::spawn_blocking(move || {
        let bundled = model_install::bundled_runner();
        model_install::finalize_package(&finalize_source, &finalize_dir, bundled.as_deref())
    })
    .await
    .map_err(|error| error.to_string())?
    .map_err(|error| error.to_string())?;
    match finalized {
        Finalized::Ready(package) => {
            runtime.stop();
            store
                .save(&local_model_settings_for(&package), Utc::now())
                .await
                .map_err(|error| error.to_string())?;
            Ok(InstallResult {
                outcome: "ready",
                status: local_model_status_now(&store, &runtime).await?,
                message: None,
            })
        }
        Finalized::NeedsRunner => Ok(InstallResult {
            outcome: "modelOnly",
            status: local_model_status_now(&store, &runtime).await?,
            message: Some(format!(
                "Модель завантажено й перевірено, але ця збірка застосунку не містить програми-рушія. Встановіть випуск з рушієм або покладіть файл рушія (runner.exe) у папку {} і натисніть «Підключити встановлену модель». Поки його немає, КОМБАТ відповідає за довідкою.",
                dir.display()
            )),
        }),
    }
}

/// Зупиняє встановлення; завантажена частина лишається для повтору.
#[tauri::command]
fn cancel_local_model_install(installer: tauri::State<'_, InstallController>) {
    installer.cancel();
}

/// Видаляє файли моделі, які застосунок сам завантажив, і забуває пакет, якщо він був звідти.
#[tauri::command]
async fn remove_local_model_files(
    app: tauri::AppHandle,
    store: tauri::State<'_, LocalModelStore>,
    runtime: tauri::State<'_, LocalModelRuntime>,
    installer: tauri::State<'_, InstallController>,
    session: tauri::State<'_, ProfileSession>,
) -> Result<LocalModelStatus, String> {
    local_model_signed_in(&session)?;
    if installer.is_busy() {
        return Err("Спершу скасуйте встановлення моделі".to_owned());
    }
    let source = model_install::qwen3_4b_q4km();
    let dir = local_model_install_dir(&app, &source)?;
    runtime.stop();
    let settings = store.load().await.map_err(|error| error.to_string())?;
    let own_package = settings.package_dir.as_deref().is_some_and(|saved| {
        std::path::Path::new(saved) == dir
            || std::fs::canonicalize(&dir).is_ok_and(|real| std::path::Path::new(saved) == real)
    });
    let removal_dir = dir.clone();
    tauri::async_runtime::spawn_blocking(move || model_install::remove_files(&removal_dir))
        .await
        .map_err(|error| error.to_string())?
        .map_err(|_| "Не вдалося видалити файли моделі".to_owned())?;
    if own_package {
        store
            .save(&LocalModelSettings::default(), Utc::now())
            .await
            .map_err(|error| error.to_string())?;
    }
    local_model_status_now(&store, &runtime).await
}

/// Єдиний вхід до моделі: короткий підготовлений запит із фактами. Токени йдуть
/// у `on_event`; модель не бачить жодної іншої команди застосунку.
#[tauri::command]
async fn generate_local_answer(
    store: tauri::State<'_, LocalModelStore>,
    runtime: tauri::State<'_, LocalModelRuntime>,
    session: tauri::State<'_, ProfileSession>,
    request: GenerationRequest,
    on_event: tauri::ipc::Channel<ModelEvent>,
) -> Result<String, String> {
    local_model_signed_in(&session)?;
    request.validate().map_err(|error| error.to_string())?;
    let settings = store.load().await.map_err(|error| error.to_string())?;
    if !settings.enabled {
        return Err(local_model::ModelError::Disabled.to_string());
    }
    let runtime = runtime.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        let package = if runtime.is_loaded() {
            None
        } else {
            Some(local_model::package_for_start(&settings)?)
        };
        runtime.generate(package.as_ref(), &request, &mut |event| {
            let _ = on_event.send(event);
        })
    })
    .await
    .map_err(|error| error.to_string())?
    .map_err(|error| error.to_string())
}

#[tauri::command]
fn cancel_local_answer(runtime: tauri::State<'_, LocalModelRuntime>) {
    runtime.cancel();
}

#[tauri::command]
fn stop_local_model(runtime: tauri::State<'_, LocalModelRuntime>) {
    runtime.stop();
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

/// Встановлює або змінює пароль профілю. Профіль із паролем: лише з сесії цього профілю
/// і з чинним паролем. Профіль без пароля (з версій до обов'язкового пароля): з власної
/// сесії або поки ніхто не ввійшов, бо саме так екран входу просить встановити пароль
/// перед першим входом (`local_profiles::authorize_password_change`).
#[tauri::command]
async fn set_local_profile_password(
    profiles: tauri::State<'_, LocalProfileStore>,
    session: tauri::State<'_, ProfileSession>,
    profile_id: String,
    current_password: Option<String>,
    new_password: Option<String>,
) -> Result<LocalProfilesState, String> {
    // Пароль обов'язковий: його можна встановити або змінити, але не зняти.
    if new_password.is_none() {
        return Err(local_profiles::LocalProfileError::PasswordRequired.to_string());
    }
    let has_password = profiles
        .has_password(&profile_id)
        .await
        .map_err(|error| error.to_string())?;
    local_profiles::authorize_password_change(has_password, session.get().as_deref(), &profile_id)
        .map_err(|error| error.to_string())?;
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

/// Зберігає готову презентацію (.pptx або .pdf) у файл, який обирає користувач. Дані не
/// залишають пристрій. Запис іде через тимчасовий файл; якщо розширення дописали ми
/// («report» → «report.pptx») і такий файл уже є, він не затирається, а команда повертає
/// помилку: вікно збереження про заміну саме не питало. Заміну, підтверджену самим вікном
/// (обрано вже наявний «report.pptx»), виконано.
#[tauri::command]
async fn save_presentation(
    app: tauri::AppHandle,
    file_name: String,
    bytes: Vec<u8>,
    kind: Option<String>,
) -> Result<Option<String>, String> {
    if bytes.is_empty() {
        return Err("презентація порожня".to_owned());
    }
    let pdf = kind.as_deref() == Some("pdf");
    let extension = if pdf { "pdf" } else { "pptx" };
    let selected = tauri::async_runtime::spawn_blocking(move || {
        let dialog = app
            .dialog()
            .file()
            .set_title("Зберегти презентацію")
            .set_file_name(file_name);
        if pdf {
            dialog
                .add_filter("Документ PDF", &["pdf"])
                .blocking_save_file()
        } else {
            dialog
                .add_filter("Презентація PPTX", &["pptx"])
                .blocking_save_file()
        }
    })
    .await
    .map_err(|error| error.to_string())?;
    let Some(selected) = selected else {
        return Ok(None);
    };
    let target = phone_export::save_target(
        selected.into_path().map_err(|error| error.to_string())?,
        &[extension],
        extension,
    );
    let path = target.path.clone();
    tauri::async_runtime::spawn_blocking(move || phone_export::save_file(&target, &bytes))
        .await
        .map_err(|error| error.to_string())?
        .map_err(|error| error.to_string())?;
    Ok(Some(path.to_string_lossy().into_owned()))
}

#[derive(serde::Serialize)]
struct EasySlideFile {
    name: String,
    bytes: Vec<u8>,
}

/// EasySlide (прототип): системне вікно відкриття файлу для редактора презентацій. Повертає ім'я
/// й вміст або `None`, якщо користувач скасував. Файл лише читається; нічого не надсилається.
#[tauri::command]
async fn open_easyslide_file(
    app: tauri::AppHandle,
    purpose: String,
) -> Result<Option<EasySlideFile>, String> {
    let (label, extensions) = easyslide::open_filter(&purpose);
    let selected = tauri::async_runtime::spawn_blocking(move || {
        app.dialog()
            .file()
            .set_title("Відкрити в EasySlide")
            .add_filter(label, extensions)
            .blocking_pick_file()
    })
    .await
    .map_err(|error| error.to_string())?;
    let Some(selected) = selected else {
        return Ok(None);
    };
    let path = selected.into_path().map_err(|error| error.to_string())?;
    let name = path
        .file_name()
        .map(|name| name.to_string_lossy().into_owned())
        .unwrap_or_else(|| "презентація".to_owned());
    let bytes = tauri::async_runtime::spawn_blocking(move || {
        easyslide::read_limited(&path, easyslide::MAX_OPEN_BYTES)
    })
    .await
    .map_err(|error| error.to_string())??;
    Ok(Some(EasySlideFile { name, bytes }))
}

/// EasySlide (прототип): зберігає файл редактора (PPTX, PDF, зображення) у місце, яке обирає
/// користувач, так само атомарно, як `save_presentation`. Невідомі формати не записуються.
#[tauri::command]
async fn save_easyslide_file(
    app: tauri::AppHandle,
    file_name: String,
    bytes: Vec<u8>,
) -> Result<Option<String>, String> {
    if bytes.is_empty() {
        return Err("файл порожній".to_owned());
    }
    let (label, extension) = easyslide::save_format(&file_name)
        .ok_or_else(|| format!("EasySlide не зберігає файли такого типу: {file_name}"))?;
    let selected = tauri::async_runtime::spawn_blocking(move || {
        app.dialog()
            .file()
            .set_title("Зберегти з EasySlide")
            .set_file_name(file_name)
            .add_filter(label, &[extension])
            .blocking_save_file()
    })
    .await
    .map_err(|error| error.to_string())?;
    let Some(selected) = selected else {
        return Ok(None);
    };
    let target = phone_export::save_target(
        selected.into_path().map_err(|error| error.to_string())?,
        &[extension],
        extension,
    );
    let path = target.path.clone();
    tauri::async_runtime::spawn_blocking(move || phone_export::save_file(&target, &bytes))
        .await
        .map_err(|error| error.to_string())?
        .map_err(|error| error.to_string())?;
    Ok(Some(path.to_string_lossy().into_owned()))
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

/// Результат збереження файлу для телефона.
#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct PhoneExportResult {
    /// Куди збережено файл.
    path: String,
    /// Назва вбудованої таблиці, якщо вона є у файлі.
    table: Option<String>,
}

/// Зберігає автономний HTML-файл дашборда для телефона або планшета. Файл уже зібраний
/// разом із застосунком (`script/build_standalone.mjs`), тут його лише віддають зі
/// вбудованих ресурсів у місце, яке обрав користувач. З `with_table` у файл кладеться
/// копія таблиці, прив'язаної до плитки активного профілю (профіль із паролем має бути
/// розблокований); без нього даних у файлі немає. Повертає `None`, якщо вікно вибору
/// закрито. Наявний файл не затирається, якщо розширення `.html` дописали ми
/// (див. `save_presentation`).
#[tauri::command]
async fn export_phone_file(
    app: tauri::AppHandle,
    profiles: tauri::State<'_, LocalProfileStore>,
    session: tauri::State<'_, ProfileSession>,
    dashboard: PhoneDashboard,
    with_table: Option<bool>,
) -> Result<Option<PhoneExportResult>, String> {
    let mut bytes = app
        .asset_resolver()
        .get(dashboard.asset_path().to_string())
        .map(|asset| asset.bytes)
        .filter(|bytes| phone_export::is_standalone_html(bytes))
        .ok_or_else(|| {
            "Файл для телефона є лише у зібраній версії застосунку (у режимі розробки його немає)."
                .to_string()
        })?;
    let now = chrono::Local::now();
    let mut default_name = dashboard.file_name().to_string();
    let mut table_name = None;
    if with_table.unwrap_or(false) {
        // Таблицю читаємо до вікна збереження: немає прив'язки або профіль заблоковано —
        // користувач одразу бачить причину, а не порожній файл.
        let profile_id = profiles
            .list()
            .await
            .map_err(|error| error.to_string())?
            .active_profile_id
            .ok_or_else(|| "Оберіть профіль, до якого прив'язано таблицю.".to_string())?;
        let path =
            bound_database_path(&profiles, &session, &profile_id, dashboard.branch()).await?;
        let name = path
            .file_name()
            .map(|name| name.to_string_lossy().into_owned())
            .unwrap_or_else(|| "table.xlsx".to_string());
        let xlsx = tauri::async_runtime::spawn_blocking(move || read_selected_xlsx(&path))
            .await
            .map_err(|error| error.to_string())??;
        bytes = phone_export::embed_table(
            &bytes,
            &name,
            &xlsx,
            &now.to_rfc3339_opts(SecondsFormat::Secs, false),
        )?;
        default_name = dashboard.file_name_with_table(&now.format("%Y-%m-%d").to_string());
        table_name = Some(name);
    }
    let selected = tauri::async_runtime::spawn_blocking(move || {
        app.dialog()
            .file()
            .set_title(dashboard.dialog_title())
            .set_file_name(default_name)
            .add_filter("Сторінка HTML", &["html"])
            .blocking_save_file()
    })
    .await
    .map_err(|error| error.to_string())?;
    let Some(selected) = selected else {
        return Ok(None);
    };
    let target =
        phone_export::html_save_target(selected.into_path().map_err(|error| error.to_string())?);
    let path = target.path.clone();
    tauri::async_runtime::spawn_blocking(move || phone_export::save_file(&target, &bytes))
        .await
        .map_err(|error| error.to_string())?
        .map_err(|error| format!("Не вдалося зберегти файл: {error}"))?;
    Ok(Some(PhoneExportResult {
        path: path.to_string_lossy().into_owned(),
        table: table_name,
    }))
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
/// Байти перевіряються як книга, а попередній стан зберігається поруч у
/// `<назва>.easywar-prev.xlsx` (див. `profile_table`).
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
    tauri::async_runtime::spawn_blocking(move || {
        profile_table::save(&path, branch, &bytes)
            .map(|_| ())
            .map_err(|error| error.to_string())
    })
    .await
    .map_err(|error| error.to_string())?
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
    let dialogs = startup_recovery::NativeDialogs;
    let context = tauri::generate_context!();
    let database_name = database::DATABASE_URL
        .strip_prefix("sqlite:")
        .unwrap_or_else(|| {
            startup_recovery::exit_with(&dialogs, "локальна база має використовувати SQLite.")
        });
    let config_directory = dirs::config_dir().unwrap_or_else(|| {
        startup_recovery::exit_with(
            &dialogs,
            "не вдалося визначити локальну директорію конфігурації.",
        )
    });
    let database_file = config_directory
        .join(&context.config().identifier)
        .join(database_name);
    let instance_lock = startup_recovery::or_exit(
        &dialogs,
        restore::acquire_application_instance_lock(&database_file),
        "Інший екземпляр EasyWAR уже працює або файл блокування недоступний",
    );
    startup_recovery::or_exit(
        &dialogs,
        tauri::async_runtime::block_on(restore::recover_live_sidecars(
            &database_file,
            &instance_lock,
        )),
        "Не вдалося безпечно завершити відновлення SQLite після попереднього запуску",
    );
    let restore_startup_report = startup_recovery::or_exit(
        &dialogs,
        tauri::async_runtime::block_on(restore::process_requested_restore(&database_file)),
        "Не вдалося безпечно обробити підготовлене відновлення",
    );
    if startup_recovery::run_guarded_step(&database_file, &dialogs, || {
        tauri::async_runtime::block_on(migration_startup::prepare_database(&database_file))
            .map_err(|error| startup_recovery::Failure::from_startup(&error))
    })
    .is_err()
    {
        std::process::exit(1);
    }
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
            // `setup` виконується вже в циклі подій, і Tauri відповідає на його помилку панікою,
            // якої без консолі (Windows) не видно: тут помилку показує нативне вікно, далі вихід
            // (на Linux лише stderr, бо вікно в заблокованому `setup` не з'явилося б).
            let dialogs = startup_recovery::SetupDialogs;
            let resolved_database_file = startup_recovery::or_exit(
                &dialogs,
                app.path().app_config_dir(),
                "Не вдалося визначити директорію конфігурації EasyWAR",
            )
            .join(database_name);
            if resolved_database_file != setup_database_file {
                startup_recovery::exit_with(
                    &dialogs,
                    "шлях локальної бази не збігається з перевіреним startup-шляхом.",
                );
            }
            let options = SqliteConnectOptions::new()
                .filename(&setup_database_file)
                .foreign_keys(true)
                .busy_timeout(Duration::from_secs(5));
            let pool = startup_recovery::or_exit(
                &dialogs,
                tauri::async_runtime::block_on(
                    SqlitePoolOptions::new()
                        .max_connections(1)
                        .connect_with(options),
                ),
                "Не вдалося підключитися до локальної бази",
            );
            app.manage(SignalSettingsStore::new(SettingsStore::new(pool.clone())));
            app.manage(AutoUpdateStore::new(SettingsStore::new(pool.clone())));
            app.manage(Repository::new(pool.clone()));
            app.manage(LocalProfileStore::new(pool.clone()));
            app.manage(ProfileSession::default());
            app.manage(LocalModelStore::new(SettingsStore::new(pool.clone())));
            app.manage(LocalModelRuntime::default());
            app.manage(InstallController::default());
            app.manage(WorkspaceTemplateStore::new(pool.clone()));
            app.manage(SignalReceiveController::default());
            app.manage(DatabaseStatusStore::new(pool.clone()));
            app.manage(DashboardModuleStore::new(pool.clone()));
            app.manage(ModuleSourceSelection::default());
            app.manage(BackupStore::new(pool));
            app.manage(LiveDatabasePath(setup_database_file));
            app.manage(instance_lock);
            app.manage(restore_startup_report);
            app.manage(PendingUpdate::default());
            startup_recovery::or_exit(
                &dialogs,
                desktop_shell::create_main_window(app),
                "Не вдалося створити головне вікно",
            );
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            get_database_status,
            get_dashboard_model,
            get_dashboard_module_catalog,
            list_dashboard_modules,
            create_dashboard_module,
            inspect_linked_module_source,
            pick_module_source,
            read_module_source_sheet,
            get_dashboard_module_data,
            replace_dashboard_module_rows,
            get_local_profiles,
            register_local_profile,
            set_local_profile_modules,
            rename_local_profile,
            activate_local_profile,
            delete_local_profile,
            get_profile_session,
            lock_local_profile,
            get_local_model_status,
            choose_local_model_package,
            set_local_model_enabled,
            forget_local_model_package,
            generate_local_answer,
            cancel_local_answer,
            stop_local_model,
            get_local_model_install_info,
            install_local_model,
            cancel_local_model_install,
            remove_local_model_files,
            update_local_profile_details,
            set_local_profile_password,
            choose_profile_database,
            create_profile_base_table,
            export_phone_file,
            save_presentation,
            open_easyslide_file,
            save_easyslide_file,
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
        .build(context)
        .unwrap_or_else(|error| {
            startup_recovery::exit_with(&dialogs, &format!("помилка запуску EasyWAR: {error}."))
        })
        .run(|app, event| {
            // Рушій локальної моделі — дочірній процес: при виході із застосунку його зупиняють явно.
            if matches!(event, tauri::RunEvent::Exit) {
                app.state::<LocalModelRuntime>().stop();
            }
        });
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
