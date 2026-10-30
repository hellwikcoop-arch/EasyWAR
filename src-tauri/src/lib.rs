pub mod analytics;
mod app_update;
pub mod backup;
pub mod base_tables;
pub mod collective;
pub mod collective_store;
pub mod collective_sync;
use collective_store::CollectiveStore;
pub mod dashboard_layout;
pub mod dashboard_modules;
mod database;
mod desktop_shell;
pub mod local_model;
pub mod local_profiles;
mod migration_startup;
pub mod model_install;
pub mod module_source;
pub mod module_source_selection;
pub mod network_policy;
pub mod office_files;
pub mod office_library;
pub mod office_sources;
pub mod phone_export;
pub mod position_templates;
pub mod profile_schema;
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
pub mod weather_online;
pub mod workspace_files;
pub mod workspace_tables;
pub mod workspace_templates;
pub mod xlsx_export;
pub mod xlsx_import;

use app_update::{AppUpdateStatus, PendingUpdate};
use backup::BackupStore;
use base_tables::BaseTable;
use chrono::{SecondsFormat, Utc};
use dashboard_layout::{DashboardLayoutRecord, DashboardLayoutStore};
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
use office_library::{
    LibraryError, LibraryItem, LibraryKeys, LibrarySession, LibraryState, LibraryStatus,
    LibraryStore, LibraryVersion,
};
use office_sources::{SourceRequest, Sources};
use phone_export::PhoneDashboard;
use position_templates::PositionDatabaseTemplate;
use profile_schema::{ProfileSchemaRecord, ProfileSchemaStore};
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
use sqlx::sqlite::SqlitePoolOptions;
use std::{
    io::Read,
    path::{Path, PathBuf},
    sync::Arc,
    time::Duration,
};
use tauri::{Emitter, Manager};
use tauri_plugin_dialog::DialogExt;
use update_settings::{AutoUpdateSettings, AutoUpdateStore};
use workspace_tables::TableRef;
use workspace_templates::{WorkspaceTemplateStore, WorkspaceTemplatesState};
use xlsx_export::XlsxExportResult;

struct LiveDatabasePath(PathBuf);

/// Профіль, у який увійшли паролем у цьому запуску. Лише в пам'яті:
/// після перезапуску захищений профіль знову потребує пароля.
#[derive(Default)]
struct ProfileSession(std::sync::Mutex<(Option<String>, u64)>);

impl ProfileSession {
    fn get(&self) -> Option<String> {
        self.0.lock().map(|guard| guard.0.clone()).unwrap_or(None)
    }

    /// Профіль і номер сеансу входу: номер зростає з кожним входом, зміною профілю чи
    /// виходом, тож дані, прив'язані до попереднього сеансу, вже не збігаються.
    fn current(&self) -> Option<(String, u64)> {
        self.0
            .lock()
            .ok()
            .and_then(|guard| guard.0.clone().map(|profile| (profile, guard.1)))
    }

    fn set(&self, value: Option<String>) {
        if let Ok(mut guard) = self.0.lock() {
            guard.0 = value;
            guard.1 += 1;
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
/// однією транзакцією. Без `rows` таблиця модуля порожня. `style` — стиль оформлення,
/// обраний у вікні створення (без нього — звичайний). `custom_fields` — лише для службового шаблону
/// `merged-table` (об'єднана таблиця з довільними стовпцями): `rows` ключуються службовими `c1`, `c2`, …
#[tauri::command]
#[allow(clippy::too_many_arguments)]
async fn create_dashboard_module(
    modules: tauri::State<'_, DashboardModuleStore>,
    session: tauri::State<'_, ProfileSession>,
    branch: String,
    template_id: String,
    title: Option<String>,
    style: Option<String>,
    rows: Option<Vec<serde_json::Map<String, Value>>>,
    corrections: Option<Vec<NewImportCorrection>>,
    custom_fields: Option<Vec<dashboard_modules::NewCustomField>>,
) -> Result<DashboardModule, String> {
    let now = Utc::now().to_rfc3339_opts(SecondsFormat::Nanos, true);
    // Об'єднана таблиця: стовпці задає виклик (`custom_fields`), шаблон — службовий `merged-table`;
    // для шаблонних модулів `custom_fields` не допускається.
    let merged = template_id == dashboard_modules::MERGED_TEMPLATE_ID;
    if merged != custom_fields.is_some()
        || (merged && corrections.as_ref().is_some_and(|items| !items.is_empty()))
    {
        return Err(dashboard_modules::DashboardModuleError::InvalidCustomFields.to_string());
    }
    if let Some(fields) = custom_fields {
        return modules
            .create_custom(
                &active_profile_id(&session)?,
                &branch,
                title.as_deref(),
                style.as_deref(),
                fields,
                rows.unwrap_or_default(),
                &now,
            )
            .await
            .map_err(|error| error.to_string());
    }
    modules
        .create_styled(
            &active_profile_id(&session)?,
            &branch,
            &template_id,
            title.as_deref(),
            style.as_deref(),
            rows.unwrap_or_default(),
            corrections.unwrap_or_default(),
            &now,
        )
        .await
        .map_err(|error| error.to_string())
}

/// Слот таблиці профілю, з якого модуль дашборда гілки `branch` може підтягнути дані.
/// «Власний модуль» (`custom`) таблиці профілю не має: `Ok(None)`.
fn dashboard_branch(branch: &str) -> Result<Option<Branch>, String> {
    if branch == "custom" {
        return Ok(None);
    }
    match Branch::parse(branch) {
        Ok(parsed @ (Branch::Air | Branch::Rocket | Branch::Pvk | Branch::Dshv)) => {
            Ok(Some(parsed))
        }
        _ => Err(dashboard_modules::DashboardModuleError::InvalidBranch.to_string()),
    }
}

/// Читає таблицю й повертає її байти та назву файла (без шляху).
fn read_source_file(path: &Path) -> Result<(Vec<u8>, String), String> {
    let bytes = read_selected_xlsx(path)?;
    let name = path
        .file_name()
        .map(|name| name.to_string_lossy().into_owned())
        .unwrap_or_default();
    Ok((bytes, name))
}

/// Джерело таблиці для модуля: файл на диску або зашифрована таблиця дашборда зі сховища
/// профілю (тоді `path` — шлях блоба, а читання розшифровує його ключами бібліотеки).
struct ResolvedSource {
    path: PathBuf,
    name: String,
    store: Option<(PathBuf, String, Arc<LibraryKeys>)>,
}

impl ResolvedSource {
    fn disk(path: PathBuf) -> Self {
        Self {
            name: office_files::file_name(&path),
            path,
            store: None,
        }
    }

    fn read(&self) -> Result<(Vec<u8>, String), String> {
        match &self.store {
            None => read_source_file(&self.path),
            Some((dir, id, keys)) => workspace_tables::read(dir, keys, id)
                .map(|(_, bytes)| (bytes.to_vec(), self.name.clone()))
                .map_err(|error| error.to_string()),
        }
    }
}

/// Прив'язана таблиця профілю як джерело для модуля.
fn resolve_source(
    app: &tauri::AppHandle,
    session: &ProfileSession,
    library: &LibrarySession,
    profile_id: &str,
    table: TableRef,
) -> Result<ResolvedSource, String> {
    match table {
        TableRef::Disk(path) => Ok(ResolvedSource::disk(path)),
        TableRef::Store { id, name } => {
            let (dir, keys) = store_table_access(app, session, library, profile_id)?;
            Ok(ResolvedSource {
                path: workspace_tables::blob_path(&dir, &id),
                name,
                store: Some((dir, id, keys)),
            })
        }
    }
}

/// Огляд таблиці: аркуші для інтерфейсу та запис огляду (шлях, вікно, профіль, сеанс і
/// відбиток вмісту) у пам'яті Rust. Інтерфейс отримує лише непрозорий ідентифікатор.
async fn inspect_and_register(
    selections: &module_source_selection::SourceSelections,
    source: ResolvedSource,
    origin: module_source_selection::SelectionOrigin,
    owner: module_source_selection::SelectionOwner,
) -> Result<module_source::SourceWorkbook, String> {
    let label = origin.as_str();
    let (inspected, digest, path) = tauri::async_runtime::spawn_blocking(move || {
        let (bytes, name) = source.read()?;
        let inspected = module_source::inspect_bytes(&bytes, &name, label)
            .map_err(|error| error.to_string())?;
        Ok::<_, String>((
            inspected,
            module_source_selection::digest(&bytes),
            source.path,
        ))
    })
    .await
    .map_err(|error| error.to_string())??;
    let selection = selections.register(module_source_selection::SourceSelection::new(
        path, origin, owner, digest,
    ));
    Ok(module_source::SourceWorkbook {
        selection,
        ..inspected
    })
}

/// Хто звертається: вікно, активний профіль і номер сеансу входу.
fn selection_owner(
    window: &tauri::Window,
    session: &ProfileSession,
) -> Result<module_source_selection::SelectionOwner, String> {
    let (profile_id, session_epoch) = session
        .current()
        .ok_or_else(|| dashboard_modules::DashboardModuleError::ProfileRequired.to_string())?;
    Ok(module_source_selection::SelectionOwner {
        window: window.label().to_owned(),
        profile_id,
        session_epoch,
    })
}

/// Аркуші таблиці, прив'язаної до активного профілю для цього дашборда. З неї модуль
/// під час створення підтягує дані. Лише читання; `None`, якщо таблицю не прив'язано.
#[tauri::command]
async fn inspect_linked_module_source(
    app: tauri::AppHandle,
    window: tauri::Window,
    profiles: tauri::State<'_, LocalProfileStore>,
    session: tauri::State<'_, ProfileSession>,
    library: tauri::State<'_, LibrarySession>,
    selections: tauri::State<'_, module_source_selection::SourceSelections>,
    branch: String,
) -> Result<Option<module_source::SourceWorkbook>, String> {
    let Some(parsed) = dashboard_branch(&branch)? else {
        return Ok(None);
    };
    let owner = selection_owner(&window, &session)?;
    let Some(table) = profiles
        .table_path(&owner.profile_id, parsed)
        .await
        .map_err(|error| error.to_string())?
        .map(|path| workspace_tables::parse_ref(&path))
    else {
        return Ok(None);
    };
    let source = resolve_source(&app, &session, &library, &owner.profile_id, table)?;
    let origin = module_source_selection::SelectionOrigin::Linked { branch };
    inspect_and_register(&selections, source, origin, owner)
        .await
        .map(Some)
}

/// Вікно вибору файла .xlsx, з якого модуль підтягне дані. Файл не прив'язується до
/// профілю й не змінюється; його шлях лишається лише в пам'яті Rust на час створення.
#[tauri::command]
async fn pick_module_source(
    app: tauri::AppHandle,
    window: tauri::Window,
    session: tauri::State<'_, ProfileSession>,
    selections: tauri::State<'_, module_source_selection::SourceSelections>,
) -> Result<Option<module_source::SourceWorkbook>, String> {
    selection_owner(&window, &session)?;
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
    // Профіль і сеанс беруться після вікна вибору: за цей час користувач міг вийти з профілю.
    let owner = selection_owner(&window, &session)?;
    let origin = module_source_selection::SelectionOrigin::Picked;
    inspect_and_register(&selections, ResolvedSource::disk(path), origin, owner)
        .await
        .map(Some)
}

/// Усі непорожні рядки одного аркуша оглянутої таблиці. `selection` — ідентифікатор з
/// `inspect_linked_module_source` або `pick_module_source`; шлях від інтерфейсу не
/// приймається. Читати може лише те саме вікно в тому самому профілі й сеансі входу, і
/// лише якщо вміст файла (а для таблиці профілю — і прив'язка) не змінився після огляду.
/// `release: true` без аркуша забуває огляд після закриття форми й повертає `None`.
#[tauri::command]
#[allow(clippy::too_many_arguments)]
async fn read_module_source_sheet(
    app: tauri::AppHandle,
    window: tauri::Window,
    profiles: tauri::State<'_, LocalProfileStore>,
    session: tauri::State<'_, ProfileSession>,
    library: tauri::State<'_, LibrarySession>,
    selections: tauri::State<'_, module_source_selection::SourceSelections>,
    selection: String,
    sheet: Option<String>,
    release: Option<bool>,
) -> Result<Option<module_source::SourceSheetRows>, String> {
    if release == Some(true) {
        selections.release(&selection, window.label());
        return Ok(None);
    }
    let sheet = sheet.ok_or_else(|| "Не вказано аркуш таблиці".to_owned())?;
    let owner = selection_owner(&window, &session)?;
    let chosen = selections
        .resolve(&selection, &owner)
        .map_err(|error| error.to_string())?;
    let source = match &chosen.origin {
        module_source_selection::SelectionOrigin::Linked { branch } => {
            let Some(slot) = dashboard_branch(branch)? else {
                return Err(module_source_selection::SelectionError::Rebound.to_string());
            };
            let bound = profiles
                .table_path(&owner.profile_id, slot)
                .await
                .map_err(|error| error.to_string())?
                .map(|path| workspace_tables::parse_ref(&path))
                .map(|table| resolve_source(&app, &session, &library, &owner.profile_id, table))
                .transpose()?;
            match bound {
                Some(source) if source.path == chosen.path => source,
                _ => return Err(module_source_selection::SelectionError::Rebound.to_string()),
            }
        }
        _ => ResolvedSource::disk(chosen.path.clone()),
    };
    tauri::async_runtime::spawn_blocking(move || {
        let (bytes, _) = source.read()?;
        if module_source_selection::digest(&bytes) != chosen.digest {
            return Err(module_source_selection::SelectionError::Changed.to_string());
        }
        module_source::read_sheet_bytes(&bytes, &sheet)
            .map(Some)
            .map_err(|error| error.to_string())
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

/// Стиль оформлення вже створеного модуля (`standard`, `branch`, `heightwell`); дані не змінюються.
#[tauri::command]
async fn set_dashboard_module_style(
    modules: tauri::State<'_, DashboardModuleStore>,
    session: tauri::State<'_, ProfileSession>,
    module_id: String,
    style: String,
) -> Result<DashboardModule, String> {
    modules
        .set_style(&active_profile_id(&session)?, &module_id, &style)
        .await
        .map_err(|error| error.to_string())
}

#[tauri::command]
async fn replace_dashboard_module_rows(
    modules: tauri::State<'_, DashboardModuleStore>,
    session: tauri::State<'_, ProfileSession>,
    module_id: String,
    rows: Vec<serde_json::Map<String, Value>>,
    expected_updated_at: String,
) -> Result<DashboardModuleData, String> {
    let now = Utc::now().to_rfc3339_opts(SecondsFormat::Nanos, true);
    modules
        .replace_rows(
            &active_profile_id(&session)?,
            &module_id,
            rows,
            &expected_updated_at,
            &now,
        )
        .await
        .map_err(|error| error.to_string())
}

/// Видаляє модуль активного профілю, його таблицю даних і виправлення. Без позначки версії
/// (`expected_updated_at`) або з застарілою нічого не видаляє.
#[tauri::command]
async fn delete_dashboard_module(
    modules: tauri::State<'_, DashboardModuleStore>,
    session: tauri::State<'_, ProfileSession>,
    module_id: String,
    expected_updated_at: Option<String>,
) -> Result<(), String> {
    modules
        .delete(
            &active_profile_id(&session)?,
            &module_id,
            expected_updated_at.as_deref(),
        )
        .await
        .map_err(|error| error.to_string())
}

/// Схема профілю активного профілю: рішення про стовпці його таблиць (етап E3). Профіль
/// береться з сеансу, а не від клієнта. Без збереженої схеми повертає `schema: null`, ревізію 0.
#[tauri::command]
async fn get_profile_schema(
    schemas: tauri::State<'_, ProfileSchemaStore>,
    session: tauri::State<'_, ProfileSession>,
) -> Result<ProfileSchemaRecord, String> {
    schemas
        .get(&active_profile_id(&session)?)
        .await
        .map_err(|error| error.to_string())
}

/// Зберігає схему активного профілю. `expected_revision` — ревізія, яку клієнт прочитав
/// (0, якщо схеми ще не було); якщо збережена вже інша, нічого не змінюється.
#[tauri::command]
async fn save_profile_schema(
    schemas: tauri::State<'_, ProfileSchemaStore>,
    session: tauri::State<'_, ProfileSession>,
    schema: Value,
    expected_revision: i64,
) -> Result<ProfileSchemaRecord, String> {
    let now = Utc::now().to_rfc3339_opts(SecondsFormat::Nanos, true);
    schemas
        .save(
            &active_profile_id(&session)?,
            &schema,
            expected_revision,
            &now,
        )
        .await
        .map_err(|error| error.to_string())
}

/// Стирає схему активного профілю (рішення про стовпці). Таблиці модулів і їхні дані не чіпає.
#[tauri::command]
async fn reset_profile_schema(
    schemas: tauri::State<'_, ProfileSchemaStore>,
    session: tauri::State<'_, ProfileSession>,
    expected_revision: i64,
) -> Result<(), String> {
    schemas
        .reset(&active_profile_id(&session)?, expected_revision)
        .await
        .map_err(|error| error.to_string())
}

/// Розкладка дашборда активного профілю: картки модулів, їхні період, стиль і місце (етап E4).
/// Профіль береться з сеансу. Без збереженої розкладки повертає `layout: null`, ревізію 0.
#[tauri::command]
async fn get_dashboard_layout(
    layouts: tauri::State<'_, DashboardLayoutStore>,
    session: tauri::State<'_, ProfileSession>,
    dashboard_id: String,
) -> Result<DashboardLayoutRecord, String> {
    layouts
        .get(&active_profile_id(&session)?, &dashboard_id)
        .await
        .map_err(|error| error.to_string())
}

/// Зберігає розкладку активного профілю (дашборд береться з документа). `expected_revision` —
/// ревізія, яку клієнт прочитав (0, якщо розкладки ще не було); якщо збережена вже інша,
/// нічого не змінюється.
#[tauri::command]
async fn save_dashboard_layout(
    layouts: tauri::State<'_, DashboardLayoutStore>,
    session: tauri::State<'_, ProfileSession>,
    layout: Value,
    expected_revision: i64,
) -> Result<DashboardLayoutRecord, String> {
    let now = Utc::now().to_rfc3339_opts(SecondsFormat::Nanos, true);
    layouts
        .save(
            &active_profile_id(&session)?,
            &layout,
            expected_revision,
            &now,
        )
        .await
        .map_err(|error| error.to_string())
}

/// Стирає розкладку дашборда активного профілю. Таблиці модулів, їхні дані й схему профілю не чіпає.
#[tauri::command]
async fn reset_dashboard_layout(
    layouts: tauri::State<'_, DashboardLayoutStore>,
    session: tauri::State<'_, ProfileSession>,
    dashboard_id: String,
    expected_revision: i64,
) -> Result<(), String> {
    layouts
        .reset(
            &active_profile_id(&session)?,
            &dashboard_id,
            expected_revision,
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
#[allow(clippy::too_many_arguments)]
async fn register_local_profile(
    app: tauri::AppHandle,
    profiles: tauri::State<'_, LocalProfileStore>,
    session: tauri::State<'_, ProfileSession>,
    library: tauri::State<'_, LibrarySession>,
    handles: tauri::State<'_, office_files::OfficeFileHandles>,
    display_name: String,
    password: String,
    position: Option<String>,
    avatar_data_url: Option<String>,
    modules: Vec<String>,
) -> Result<LocalProfilesState, String> {
    // Новий користувач одразу входить у свій профіль: вікно редактора з документом
    // попереднього профілю спершу треба закрити.
    ensure_editor_closed(&app, &handles)?;
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
    // Новий користувач не успадковує розблоковану бібліотеку попереднього.
    lock_library(&library, &handles);
    session.set(Some(profile_id));
    notify_library_state(&app);
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
/// Поки відкрите вікно редактора, перейти в інший профіль не можна: у вікні може бути
/// розшифрований документ бібліотеки поточного.
#[tauri::command]
#[allow(clippy::too_many_arguments)]
async fn activate_local_profile(
    app: tauri::AppHandle,
    profiles: tauri::State<'_, LocalProfileStore>,
    store: tauri::State<'_, LibraryStore>,
    session: tauri::State<'_, ProfileSession>,
    library: tauri::State<'_, LibrarySession>,
    handles: tauri::State<'_, office_files::OfficeFileHandles>,
    profile_id: String,
    password: Option<String>,
) -> Result<LocalProfilesState, String> {
    let password = zeroize::Zeroizing::new(password.unwrap_or_default());
    if session.get().as_deref() != Some(profile_id.as_str()) {
        ensure_editor_closed(&app, &handles)?;
    }
    if !profiles
        .verify_password(&profile_id, &password)
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
    // Перехід в інший профіль блокує бібліотеку попереднього.
    let library_unlocked = library.unlocked_profile().as_deref() == Some(profile_id.as_str());
    if !library_unlocked {
        lock_library(&library, &handles);
    }
    session.set(Some(profile_id.clone()));
    // Вхід паролем розблоковує й бібліотеку профілю (рішення власника 29.10.2026): таблиці
    // дашбордів у зашифрованому сховищі мають відкриватися без окремого розблокування.
    if !library_unlocked && !password.is_empty() {
        unlock_library_at_sign_in(
            &app,
            &store,
            &library,
            &handles,
            &session,
            &profile_id,
            &password,
        )
        .await;
    }
    notify_library_state(&app);
    Ok(state)
}

/// Розблоковує бібліотеку профілю щойно перевіреним паролем входу, якщо бібліотеку
/// створено. Невдача (бібліотека пошкоджена, базу не прочитати) вхід не скасовує:
/// бібліотека лишається заблокованою, і її можна розблокувати на вкладці «Бібліотека».
async fn unlock_library_at_sign_in(
    app: &tauri::AppHandle,
    store: &LibraryStore,
    library: &LibrarySession,
    handles: &office_files::OfficeFileHandles,
    session: &ProfileSession,
    profile_id: &str,
    password: &str,
) {
    match store.has_active_keyring(profile_id).await {
        Ok(true) => {}
        Ok(false) => return,
        Err(error) => {
            eprintln!("EasyWAR: не вдалося перевірити бібліотеку профілю при вході: {error}");
            return;
        }
    }
    let epoch = library.epoch();
    match store.unlock(profile_id, password, &library_now()).await {
        Ok(keys) => {
            install_library_keys(app, library, handles, session, epoch, keys);
        }
        Err(error) => {
            eprintln!("EasyWAR: бібліотеку профілю не розблоковано при вході: {error}");
        }
    }
}

/// Профіль, у який увійшли в цьому запуску.
#[tauri::command]
fn get_profile_session(session: tauri::State<'_, ProfileSession>) -> Option<String> {
    session.get()
}

/// Вихід із профілю. Поки відкрите вікно редактора (у ньому може бути розшифрований
/// документ бібліотеки), вийти не можна: спершу його треба закрити.
#[tauri::command]
fn lock_local_profile(
    app: tauri::AppHandle,
    session: tauri::State<'_, ProfileSession>,
    selections: tauri::State<'_, module_source_selection::SourceSelections>,
    model: tauri::State<'_, LocalModelRuntime>,
    installer: tauri::State<'_, InstallController>,
    library: tauri::State<'_, LibrarySession>,
    handles: tauri::State<'_, office_files::OfficeFileHandles>,
) -> Result<(), String> {
    ensure_editor_closed(&app, &handles)?;
    session.set(None);
    // Вихід із профілю блокує його бібліотеку: ключі й індекс знищуються.
    lock_library(&library, &handles);
    notify_library_state(&app);
    // Огляди таблиць для модулів належать сеансу: після виходу їх не прочитати.
    selections.clear();
    // A locked profile never leaves a model answering or holding memory,
    // and never keeps downloading in the background.
    model.stop();
    installer.cancel();
    Ok(())
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
    library: tauri::State<'_, LibraryStore>,
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
    // Ключ захищеної бібліотеки загорнуто паролем профілю: новий пароль загортає його
    // заново (повільний KDF — до транзакції), а запис іде разом із новим хешем входу.
    let rewrap = match (
        library
            .has_active_keyring(&profile_id)
            .await
            .map_err(|error| error.to_string())?,
        new_password.as_deref(),
    ) {
        (true, Some(new)) => {
            let current = current_password.as_deref().ok_or_else(|| {
                local_profiles::LocalProfileError::LibraryNeedsCurrentPassword.to_string()
            })?;
            local_profiles::validate_password(new).map_err(|error| error.to_string())?;
            if !profiles
                .verify_password(&profile_id, current)
                .await
                .map_err(|error| error.to_string())?
            {
                return Err(local_profiles::LocalProfileError::WrongPassword.to_string());
            }
            library
                .prepare_password_rewrap(&profile_id, current, new)
                .await
                .map_err(|error| error.to_string())?
        }
        _ => None,
    };
    let now = Utc::now().to_rfc3339_opts(SecondsFormat::Nanos, true);
    let state = profiles
        .set_password(
            &profile_id,
            current_password.as_deref(),
            new_password.as_deref(),
            rewrap.as_ref(),
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

/// Файл, який застосунок розділу «Офіс» відкрив через EasyWAR: шлях лишається в Rust.
#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct OfficeOpenedFile {
    handle: String,
    name: String,
    bytes: Vec<u8>,
}

/// Параметри вікна вибору чи збереження файла (`extensions` — без крапки, перше —
/// типове для «Зберегти як…»).
#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct OfficeFileDialog {
    extensions: Vec<String>,
    title: Option<String>,
    filter_name: Option<String>,
    suggested_name: Option<String>,
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct OfficeSavedFile {
    handle: String,
    name: String,
}

/// Таблиці, прив'язані до будь-якого профілю: застосунки «Офісу» їх не перезаписують.
async fn office_bound_tables(profiles: &LocalProfileStore) -> Result<Vec<PathBuf>, String> {
    Ok(profiles
        .all_table_paths()
        .await
        .map_err(|error| error.to_string())?
        .into_iter()
        .filter_map(|path| match workspace_tables::parse_ref(&path) {
            TableRef::Disk(path) => Some(path),
            // Таблиці сховища лежать у підтеці `tables/`, якої редактори не бачать.
            TableRef::Store { .. } => None,
        })
        .collect())
}

/// Вікно вибору файла для застосунку «Офісу» (EasyGreen, EasyDoc, EasySlide). Повертає
/// номер, назву й байти; `None` — користувач закрив вікно. Потрібен активний профіль.
/// Якщо головне вікно передало цьому застосунку документ бібліотеки (`library_open_in_editor`),
/// перший виклик віддає його без вікна вибору; номер такого файлу пише нові версії.
#[tauri::command]
async fn office_open_file(
    app: tauri::AppHandle,
    webview: tauri::Webview,
    session: tauri::State<'_, ProfileSession>,
    handles: tauri::State<'_, office_files::OfficeFileHandles>,
    store: tauri::State<'_, LibraryStore>,
    library: tauri::State<'_, LibrarySession>,
    options: OfficeFileDialog,
) -> Result<Option<OfficeOpenedFile>, String> {
    office_files::ensure_editor_window(webview.label()).map_err(|error| error.to_string())?;
    let profile_id = active_profile_id(&session)?;
    let extensions = office_files::normalize_extensions(&options.extensions)
        .map_err(|error| error.to_string())?;
    let pending = handles
        .editor_window_app()
        .and_then(|app_id| handles.take_pending(&profile_id, app_id, &extensions));
    if let Some(pending) = pending {
        let version_id = match pending.source {
            office_files::PendingSource::Library { version_id } => version_id,
            office_files::PendingSource::Store { dir, id } => {
                // Зашифрований файл сховища «Робочого середовища»: ключ бібліотеки без
                // продовження часу до автоблокування; номер запечатує «Зберегти» назад у блоб.
                let keys = library
                    .keys_quiet(&profile_id)
                    .map_err(|_| office_files::OfficeFileError::LibraryLocked.to_string())?;
                let read_keys = Arc::clone(&keys);
                let read_dir = dir.clone();
                let read_id = id.clone();
                let (item, mut bytes) = tauri::async_runtime::spawn_blocking(move || {
                    workspace_files::read(&read_dir, &read_keys, &read_id)
                })
                .await
                .map_err(|error| error.to_string())?
                .map_err(|error| error.to_string())?;
                let handle = handles.remember_store(
                    &profile_id,
                    webview.label(),
                    office_files::StoreTarget {
                        dir,
                        id,
                        name: item.name.clone(),
                        library_tag: keys.handle_tag(),
                    },
                );
                return Ok(Some(OfficeOpenedFile {
                    handle,
                    name: item.name,
                    bytes: std::mem::take(&mut *bytes),
                }));
            }
        };
        // Відкриття у вікні редактора не продовжує час до автоблокування.
        let keys = library
            .keys_quiet(&profile_id)
            .map_err(|error| error.to_string())?;
        let (version, mut bytes) = store
            .read_version(&keys, &version_id)
            .await
            .map_err(|error| error.to_string())?;
        let handle = handles.remember_library(
            &profile_id,
            webview.label(),
            office_files::LibraryTarget {
                item_id: version.item_id,
                base_version_id: version.id,
                ext: version.ext,
                name: pending.name.clone(),
                library_tag: keys.handle_tag(),
            },
        );
        return Ok(Some(OfficeOpenedFile {
            handle,
            name: pending.name,
            bytes: std::mem::take(&mut *bytes),
        }));
    }
    let title = office_files::clean_label(options.title.as_deref(), "Відкрити файл");
    let filter_name = office_files::clean_label(options.filter_name.as_deref(), "Документи");
    let selected = tauri::async_runtime::spawn_blocking(move || {
        let filter: Vec<&str> = extensions.iter().map(String::as_str).collect();
        app.dialog()
            .file()
            .set_title(title)
            .add_filter(filter_name, &filter)
            .blocking_pick_file()
    })
    .await
    .map_err(|error| error.to_string())?;
    let Some(selected) = selected else {
        return Ok(None);
    };
    let path = selected.into_path().map_err(|error| error.to_string())?;
    let bytes = {
        let path = path.clone();
        tauri::async_runtime::spawn_blocking(move || {
            office_files::read_regular_file(
                &path,
                office_files::MAX_FILE_BYTES,
                &office_files::OfficeFileError::TooLarge.to_string(),
            )
        })
        .await
        .map_err(|error| error.to_string())??
    };
    let name = office_files::file_name(&path);
    let handle = handles.remember(&profile_id, webview.label(), path);
    Ok(Some(OfficeOpenedFile {
        handle,
        name,
        bytes,
    }))
}

/// «Зберегти»: записує байти у файл, раніше відкритий або збережений за цим номером.
/// Таблицю, прив'язану до профілю, так не перезаписати: лише «Зберегти як…» в інший файл.
/// Номер документа бібліотеки додає нову поточну версію (`edited` після згенерованої
/// чи вже правленої, інакше `saved`); той самий вміст нової версії не створює. Поки
/// бібліотека заблокована, збереження відмовляє, а номер лишається: після нового
/// розблокування тієї самої бібліотеки «Зберегти» спрацює. Лише нова версія продовжує
/// час до автоблокування.
#[tauri::command]
#[allow(clippy::too_many_arguments)]
async fn office_save_file(
    app: tauri::AppHandle,
    webview: tauri::Webview,
    profiles: tauri::State<'_, LocalProfileStore>,
    session: tauri::State<'_, ProfileSession>,
    handles: tauri::State<'_, office_files::OfficeFileHandles>,
    store: tauri::State<'_, LibraryStore>,
    library: tauri::State<'_, LibrarySession>,
    handle: String,
    bytes: Vec<u8>,
) -> Result<OfficeSavedFile, String> {
    office_files::ensure_editor_window(webview.label()).map_err(|error| error.to_string())?;
    let profile_id = active_profile_id(&session)?;
    office_files::check_size(&bytes).map_err(|error| error.to_string())?;
    let path = match handles
        .target(&profile_id, webview.label(), &handle)
        .map_err(|error| error.to_string())?
    {
        office_files::HandleTarget::Disk(path) => path,
        office_files::HandleTarget::Store(target) => {
            let keys = library
                .keys_quiet(&profile_id)
                .map_err(|_| office_files::OfficeFileError::LibraryLocked.to_string())?;
            if keys.handle_tag() != target.library_tag {
                return Err(office_files::OfficeFileError::UnknownHandle.to_string());
            }
            let name = target.name.clone();
            tauri::async_runtime::spawn_blocking(move || {
                workspace_files::overwrite(&target.dir, &keys, &target.id, &bytes)
            })
            .await
            .map_err(|error| error.to_string())?
            .map_err(|error| error.to_string())?;
            library.touch();
            return Ok(OfficeSavedFile { handle, name });
        }
        office_files::HandleTarget::Library(target) => {
            office_files::ensure_library_format(&target.ext, &bytes)
                .map_err(|error| error.to_string())?;
            let keys = library
                .keys_quiet(&profile_id)
                .map_err(|_| office_files::OfficeFileError::LibraryLocked.to_string())?;
            // Номер прив'язаний до ключа бібліотеки, з якої відкрито документ.
            if keys.handle_tag() != target.library_tag {
                return Err(office_files::OfficeFileError::UnknownHandle.to_string());
            }
            let base = store
                .version(&keys, &target.base_version_id)
                .await
                .map_err(|error| error.to_string())?;
            // Правка згенерованого документа лишається прив'язаною до тих самих даних джерела.
            let (origin, fingerprint) = match base.origin {
                office_library::Origin::Generated | office_library::Origin::Edited => (
                    office_library::Origin::Edited,
                    base.source_fingerprint.clone(),
                ),
                _ => (office_library::Origin::Saved, None),
            };
            let now = Utc::now().to_rfc3339_opts(SecondsFormat::Nanos, true);
            let saved = store
                .save_version(
                    &keys,
                    &target.item_id,
                    office_library::NewVersion {
                        ext: &target.ext,
                        bytes: &bytes,
                        origin,
                        parent_version_id: Some(&base.id),
                        source_fingerprint: fingerprint.as_deref(),
                        make_current: true,
                    },
                    &now,
                )
                .await
                .map_err(|error| error.to_string())?;
            if let Some(version) = saved {
                library.touch();
                library.clear_damaged(&profile_id, &target.item_id);
                refresh_library_item(&app, &profile_id, &target.item_id);
                handles
                    .set_library_base(&profile_id, webview.label(), &handle, &version.id)
                    .map_err(|error| error.to_string())?;
            }
            return Ok(OfficeSavedFile {
                handle,
                name: target.name,
            });
        }
    };
    office_files::ensure_not_protected(&path, &office_bound_tables(&profiles).await?)
        .map_err(|error| error.to_string())?;
    let name = office_files::file_name(&path);
    let target = phone_export::SaveTarget {
        path,
        replace_confirmed: true,
    };
    tauri::async_runtime::spawn_blocking(move || phone_export::save_file(&target, &bytes))
        .await
        .map_err(|error| error.to_string())?
        .map_err(|error| error.to_string())?;
    Ok(OfficeSavedFile { handle, name })
}

/// «Зберегти як…»: вікно збереження й запис; повертає новий номер. `None` — вікно закрили.
/// Перше розширення зі списку дописується, якщо користувач його прибрав.
#[tauri::command]
async fn office_save_file_as(
    app: tauri::AppHandle,
    webview: tauri::Webview,
    profiles: tauri::State<'_, LocalProfileStore>,
    session: tauri::State<'_, ProfileSession>,
    handles: tauri::State<'_, office_files::OfficeFileHandles>,
    bytes: Vec<u8>,
    options: OfficeFileDialog,
) -> Result<Option<OfficeSavedFile>, String> {
    office_files::ensure_editor_window(webview.label()).map_err(|error| error.to_string())?;
    let profile_id = active_profile_id(&session)?;
    office_files::check_size(&bytes).map_err(|error| error.to_string())?;
    let extensions = office_files::normalize_extensions(&options.extensions)
        .map_err(|error| error.to_string())?;
    let title = office_files::clean_label(options.title.as_deref(), "Зберегти файл");
    let filter_name = office_files::clean_label(options.filter_name.as_deref(), "Документи");
    let file_name =
        office_files::suggested_file_name(options.suggested_name.as_deref(), "Документ");
    let dialog_extensions = extensions.clone();
    let selected = tauri::async_runtime::spawn_blocking(move || {
        let filter: Vec<&str> = dialog_extensions.iter().map(String::as_str).collect();
        app.dialog()
            .file()
            .set_title(title)
            .set_file_name(file_name)
            .add_filter(filter_name, &filter)
            .blocking_save_file()
    })
    .await
    .map_err(|error| error.to_string())?;
    let Some(selected) = selected else {
        return Ok(None);
    };
    let accepted: Vec<&str> = extensions.iter().map(String::as_str).collect();
    let target = phone_export::save_target(
        selected.into_path().map_err(|error| error.to_string())?,
        &accepted,
        &extensions[0],
    );
    office_files::ensure_not_protected(&target.path, &office_bound_tables(&profiles).await?)
        .map_err(|error| error.to_string())?;
    let path = target.path.clone();
    tauri::async_runtime::spawn_blocking(move || phone_export::save_file(&target, &bytes))
        .await
        .map_err(|error| error.to_string())?
        .map_err(|error| error.to_string())?;
    let name = office_files::file_name(&path);
    let handle = handles.remember(&profile_id, webview.label(), path);
    Ok(Some(OfficeSavedFile { handle, name }))
}

/// Застосунок закрив файл: номер більше не приймається.
#[tauri::command]
fn office_close_file(
    webview: tauri::Webview,
    session: tauri::State<'_, ProfileSession>,
    handles: tauri::State<'_, office_files::OfficeFileHandles>,
    handle: String,
) -> Result<(), String> {
    office_files::ensure_editor_window(webview.label()).map_err(|error| error.to_string())?;
    let profile_id = active_profile_id(&session)?;
    handles.forget(&profile_id, webview.label(), &handle);
    Ok(())
}

/// Застосунок «Погода»: поточні умови в пункті з Open-Meteo. Назовні йдуть лише
/// координати, округлені до 0,01°. Викликається тільки після явного ввімкнення онлайн-оновлення.
#[tauri::command]
async fn weather_online_fetch(
    latitude: f64,
    longitude: f64,
) -> Result<weather_online::WeatherObservation, String> {
    let url =
        weather_online::forecast_url(latitude, longitude).map_err(|error| error.to_string())?;
    let body = weather_online::fetch_json(url).await?;
    weather_online::parse_forecast(&body).map_err(|error| error.to_string())
}

/// Застосунок «Погода»: пошук населеного пункту за назвою (Open-Meteo, лише Україна).
#[tauri::command]
async fn weather_online_search(name: String) -> Result<Vec<weather_online::WeatherPlace>, String> {
    let url = weather_online::geocode_url(&name).map_err(|error| error.to_string())?;
    let body = weather_online::fetch_json(url).await?;
    weather_online::parse_places(&body).map_err(|error| error.to_string())
}

/// Головне вікно відкриває застосунок «Офісу» в окремому вікні редактора (F-01): код
/// редактора не бачить команд EasyWAR, крім `office_*`. Відкрите вікно лише виводиться наперед.
/// Асинхронна команда: нове вікно не створюють із синхронної (на Windows це блокує цикл подій).
#[tauri::command]
async fn workspace_open_editor(
    app: tauri::AppHandle,
    window: tauri::WebviewWindow,
    app_id: String,
) -> Result<(), String> {
    if window.label() != desktop_shell::MAIN_WINDOW_LABEL {
        return Err("редактор відкривається лише з головного вікна".to_owned());
    }
    let app_id = office_files::editor_app(&app_id).map_err(|error| error.to_string())?;
    desktop_shell::open_office_editor(&app, &window, app_id, None)
        .map_err(|error| error.to_string())
}

/// Вікно редактора закриває саме себе (після підтвердження незбережених змін в оболонці).
#[tauri::command]
fn office_editor_close(window: tauri::WebviewWindow) -> Result<(), String> {
    office_files::ensure_editor_window(window.label()).map_err(|error| error.to_string())?;
    window.destroy().map_err(|error| error.to_string())
}

// --- Колективи (E8, C3b, перший зріз: ключ учасника й захищений колектив) ----------------
//
// Команди лише для вікна редактора, де працює екран «Колективи» (capability
// `office-editor.json`). Пароль — пароль профілю через той самий обмежувач спроб, що й
// бібліотека; у JS не повертається жоден секрет, лише відбитки й лічильники. Мережі немає.

#[tauri::command]
async fn collective_status(
    webview: tauri::Webview,
    session: tauri::State<'_, ProfileSession>,
    collectives: tauri::State<'_, CollectiveStore>,
) -> Result<collective_store::CollectiveStatus, String> {
    office_files::ensure_editor_window(webview.label()).map_err(|error| error.to_string())?;
    let profile_id = active_profile_id(&session)?;
    collectives
        .status(&profile_id)
        .await
        .map_err(|error| error.to_string())
}

/// Створює ключ учасника профілю; ключ відновлення сховища показується один раз.
#[tauri::command]
async fn collective_create_identity(
    webview: tauri::Webview,
    profiles: tauri::State<'_, LocalProfileStore>,
    session: tauri::State<'_, ProfileSession>,
    collectives: tauri::State<'_, CollectiveStore>,
    password: String,
) -> Result<collective_store::CreatedIdentity, String> {
    office_files::ensure_editor_window(webview.label()).map_err(|error| error.to_string())?;
    let password = zeroize::Zeroizing::new(password);
    let profile_id = active_profile_id(&session)?;
    if !profiles
        .has_password(&profile_id)
        .await
        .map_err(|error| error.to_string())?
    {
        return Err(LibraryError::ProfileWithoutPassword.to_string());
    }
    verify_library_password(&profiles, &profile_id, &password).await?;
    collectives
        .create_identity(&profile_id, password, &library_now())
        .await
        .map_err(|error| error.to_string())
}

/// Створює захищений колектив, де власник — учасник цього профілю.
#[tauri::command]
async fn collective_create(
    webview: tauri::Webview,
    profiles: tauri::State<'_, LocalProfileStore>,
    session: tauri::State<'_, ProfileSession>,
    collectives: tauri::State<'_, CollectiveStore>,
    password: String,
    name: String,
) -> Result<collective_store::CollectiveSummary, String> {
    office_files::ensure_editor_window(webview.label()).map_err(|error| error.to_string())?;
    let password = zeroize::Zeroizing::new(password);
    let profile_id = active_profile_id(&session)?;
    verify_library_password(&profiles, &profile_id, &password).await?;
    collectives
        .create_collective(
            &profile_id,
            password,
            &name,
            &library_now(),
            Utc::now().timestamp(),
        )
        .await
        .map_err(|error| error.to_string())
}

// --- Колективи: обмін (E8, C3b, другий зріз; рішення JE 29.10.2026 «Так: команди і 0020») ---
//
// Ті самі межі: лише вікно редактора, пароль профілю через обмежувач спроб. Тексти запрошень
// і ключів люди пересилають самі; «Доповісти» кладе конверт лише в локальну чергу. Мережі немає.

/// Пароль профілю для операцій із секретами колективу (як у `collective_create_identity`).
async fn collective_password(
    profiles: &LocalProfileStore,
    profile_id: &str,
    password: String,
) -> Result<zeroize::Zeroizing<String>, String> {
    let password = zeroize::Zeroizing::new(password);
    if !profiles
        .has_password(profile_id)
        .await
        .map_err(|error| error.to_string())?
    {
        return Err(LibraryError::ProfileWithoutPassword.to_string());
    }
    verify_library_password(profiles, profile_id, &password).await?;
    Ok(password)
}

#[tauri::command]
async fn collective_detail(
    webview: tauri::Webview,
    session: tauri::State<'_, ProfileSession>,
    collectives: tauri::State<'_, CollectiveStore>,
    collective: String,
) -> Result<collective_sync::CollectiveDetail, String> {
    office_files::ensure_editor_window(webview.label()).map_err(|error| error.to_string())?;
    let profile_id = active_profile_id(&session)?;
    collectives
        .detail(&profile_id, &collective, Utc::now().timestamp())
        .await
        .map_err(|error| error.to_string())
}

/// Нова таблиця колективу або зміна класу й призначення своєї таблиці.
#[tauri::command]
#[allow(clippy::too_many_arguments)]
async fn collective_table_set(
    webview: tauri::Webview,
    session: tauri::State<'_, ProfileSession>,
    collectives: tauri::State<'_, CollectiveStore>,
    collective: String,
    table: Option<String>,
    title: String,
    class: String,
    purpose: String,
) -> Result<collective_sync::TableSummary, String> {
    office_files::ensure_editor_window(webview.label()).map_err(|error| error.to_string())?;
    let profile_id = active_profile_id(&session)?;
    collectives
        .set_table(
            &profile_id,
            &collective,
            table.as_deref(),
            &title,
            &class,
            &purpose,
            &library_now(),
        )
        .await
        .map_err(|error| error.to_string())
}

#[tauri::command]
async fn collective_invite_create(
    webview: tauri::Webview,
    profiles: tauri::State<'_, LocalProfileStore>,
    session: tauri::State<'_, ProfileSession>,
    collectives: tauri::State<'_, CollectiveStore>,
    password: String,
    collective: String,
    hours: i64,
) -> Result<collective_sync::InvitationText, String> {
    office_files::ensure_editor_window(webview.label()).map_err(|error| error.to_string())?;
    let profile_id = active_profile_id(&session)?;
    let password = collective_password(&profiles, &profile_id, password).await?;
    collectives
        .create_invitation(
            &profile_id,
            password,
            &collective,
            hours,
            Utc::now().timestamp(),
        )
        .await
        .map_err(|error| error.to_string())
}

#[tauri::command]
async fn collective_join_request(
    webview: tauri::Webview,
    profiles: tauri::State<'_, LocalProfileStore>,
    session: tauri::State<'_, ProfileSession>,
    collectives: tauri::State<'_, CollectiveStore>,
    password: String,
    invitation: String,
) -> Result<collective_sync::JoinRequestText, String> {
    office_files::ensure_editor_window(webview.label()).map_err(|error| error.to_string())?;
    let profile_id = active_profile_id(&session)?;
    let password = collective_password(&profiles, &profile_id, password).await?;
    collectives
        .join_request(&profile_id, password, &invitation, Utc::now().timestamp())
        .await
        .map_err(|error| error.to_string())
}

#[tauri::command]
async fn collective_invite_admit(
    webview: tauri::Webview,
    profiles: tauri::State<'_, LocalProfileStore>,
    session: tauri::State<'_, ProfileSession>,
    collectives: tauri::State<'_, CollectiveStore>,
    password: String,
    collective: String,
    request: String,
) -> Result<collective_sync::AdmissionText, String> {
    office_files::ensure_editor_window(webview.label()).map_err(|error| error.to_string())?;
    let profile_id = active_profile_id(&session)?;
    let password = collective_password(&profiles, &profile_id, password).await?;
    collectives
        .admit(
            &profile_id,
            password,
            &collective,
            &request,
            &library_now(),
            Utc::now().timestamp(),
        )
        .await
        .map_err(|error| error.to_string())
}

#[tauri::command]
async fn collective_join_accept(
    webview: tauri::Webview,
    profiles: tauri::State<'_, LocalProfileStore>,
    session: tauri::State<'_, ProfileSession>,
    collectives: tauri::State<'_, CollectiveStore>,
    password: String,
    keys: String,
) -> Result<collective_sync::JoinedCollective, String> {
    office_files::ensure_editor_window(webview.label()).map_err(|error| error.to_string())?;
    let profile_id = active_profile_id(&session)?;
    let password = collective_password(&profiles, &profile_id, password).await?;
    collectives
        .join_accept(&profile_id, password, &keys, &library_now())
        .await
        .map_err(|error| error.to_string())
}

/// «Підготувати» (SEC-003): Rust перевіряє маршрут і права й тримає намір у себе; JS
/// отримує лише ідентифікатор і підсумок. Пароль не потрібен.
#[tauri::command]
#[allow(clippy::too_many_arguments)]
async fn collective_report_prepare(
    webview: tauri::Webview,
    session: tauri::State<'_, ProfileSession>,
    collectives: tauri::State<'_, CollectiveStore>,
    collective: String,
    table: String,
    transport: String,
    explicit_wan: bool,
    operation: String,
) -> Result<collective_sync::PrepareOutcome, String> {
    office_files::ensure_editor_window(webview.label()).map_err(|error| error.to_string())?;
    let profile_id = active_profile_id(&session)?;
    collectives
        .report_prepare(
            &profile_id,
            &collective,
            &table,
            &transport,
            explicit_wan,
            &operation,
            Utc::now().timestamp(),
        )
        .await
        .map_err(|error| error.to_string())
}

/// «Доповісти» (SEC-003): одноразовий намір, перевірка стану заново, допуск `send_gate` і
/// локальна черга. Прапорця «переглянуто» від викликача немає. Відмова — відповідь з кодом.
#[tauri::command]
async fn collective_report_confirm(
    webview: tauri::Webview,
    profiles: tauri::State<'_, LocalProfileStore>,
    session: tauri::State<'_, ProfileSession>,
    collectives: tauri::State<'_, CollectiveStore>,
    password: String,
    intent: String,
) -> Result<collective_sync::ReportOutcome, String> {
    office_files::ensure_editor_window(webview.label()).map_err(|error| error.to_string())?;
    let profile_id = active_profile_id(&session)?;
    let password = collective_password(&profiles, &profile_id, password).await?;
    collectives
        .report_confirm(&profile_id, password, &intent, Utc::now().timestamp())
        .await
        .map_err(|error| error.to_string())
}

// --- Захищена бібліотека «Офісу» (office_library, контракт library_*) -------------------
//
// Усі команди — лише з головного вікна (capability `default.json`). Крім стану, створення,
// розблокування й відновлення, кожна потребує бібліотеки, розблокованої для профілю сесії;
// інакше — помилка «бібліотека заблокована…». Паролі перевіряються тим самим обмежувачем
// спроб, що й вхід у профіль, і лише потім іде повільний KDF бібліотеки.

/// Блокує бібліотеку й прибирає документ, що чекав на вікно редактора. Відкрите вікно
/// редактора лишається: його документ збережеться після нового розблокування.
fn lock_library(library: &LibrarySession, handles: &office_files::OfficeFileHandles) {
    library.lock();
    handles.clear_pending();
}

/// Відмова змінити профіль сесії, поки відкрите вікно редактора.
const EDITOR_OPEN_MESSAGE: &str = "спершу закрийте вікно редактора";

/// Чи відкрите (або ще закривається) вікно редактора «Офісу».
fn editor_open(app: &tauri::AppHandle, handles: &office_files::OfficeFileHandles) -> bool {
    app.get_webview_window(office_files::EDITOR_WINDOW_LABEL)
        .is_some()
        || handles.editor_window_app().is_some()
}

/// Вихід із профілю, перехід в інший, реєстрація й видалення профілю чекають, поки
/// закриють вікно редактора: у ньому може бути розшифрований документ бібліотеки
/// поточного профілю.
fn ensure_editor_closed(
    app: &tauri::AppHandle,
    handles: &office_files::OfficeFileHandles,
) -> Result<(), String> {
    if editor_open(app, handles) {
        Err(EDITOR_OPEN_MESSAGE.to_owned())
    } else {
        Ok(())
    }
}

/// Подія для головного вікна з новим станом бібліотеки (той самий JSON, що й `library_status`).
const LIBRARY_STATE_EVENT: &str = "library-state";
/// Повтор невдалої побудови індексу вмісту — не раніше ніж за хвилину.
const LIBRARY_INDEX_RETRY: Duration = Duration::from_secs(60);

/// Черга подій `library-state`: кожна обчислює стан у момент надсилання, тож остання
/// подія завжди показує найсвіжіший стан.
#[derive(Default)]
struct LibraryStateEvents(tokio::sync::Mutex<()>);

/// Надсилає головному вікну `library-state` (у фоні: можна викликати з будь-якого місця).
fn notify_library_state(app: &tauri::AppHandle) {
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        let Some(events) = app.try_state::<LibraryStateEvents>() else {
            return;
        };
        let _turn = events.0.lock().await;
        let store = app.state::<LibraryStore>();
        let session = app.state::<ProfileSession>();
        let library = app.state::<LibrarySession>();
        match library_status_now(&store, &session, &library).await {
            Ok(status) => {
                if let Err(error) = app.emit_to(
                    desktop_shell::MAIN_WINDOW_LABEL,
                    LIBRARY_STATE_EVENT,
                    status,
                ) {
                    eprintln!("EasyWAR: не вдалося надіслати стан бібліотеки: {error}");
                }
            }
            Err(error) => eprintln!("EasyWAR: не вдалося прочитати стан бібліотеки: {error}"),
        }
    });
}

/// Профіль сесії й ключі його розблокованої бібліотеки.
fn library_keys(
    session: &ProfileSession,
    library: &LibrarySession,
) -> Result<(String, Arc<LibraryKeys>), String> {
    let profile_id = session
        .get()
        .ok_or_else(|| LibraryError::Locked.to_string())?;
    let keys = library
        .keys(&profile_id)
        .map_err(|error| error.to_string())?;
    Ok((profile_id, keys))
}

async fn library_status_now(
    store: &LibraryStore,
    session: &ProfileSession,
    library: &LibrarySession,
) -> Result<LibraryStatus, String> {
    store
        .status(session.get().as_deref(), library)
        .await
        .map_err(|error| error.to_string())
}

/// Пароль профілю сесії через обмежувач спроб входу (до KDF бібліотеки).
async fn verify_library_password(
    profiles: &LocalProfileStore,
    profile_id: &str,
    password: &str,
) -> Result<(), String> {
    if profiles
        .verify_password(profile_id, password)
        .await
        .map_err(|error| error.to_string())?
    {
        Ok(())
    } else {
        Err(LibraryError::WrongPassword.to_string())
    }
}

/// Тимчасовий індекс вмісту будується у фоні; блокування бібліотеки його зупиняє.
fn start_library_index(app: &tauri::AppHandle, profile_id: String) {
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        let store = app.state::<LibraryStore>();
        let session = app.state::<LibrarySession>();
        if let Err(error) = store.run_index_build(&session, &profile_id).await {
            eprintln!("EasyWAR: не вдалося побудувати пошуковий індекс бібліотеки: {error}");
        }
    });
}

/// Розблоковує бібліотеку ключами, отриманими після повільного KDF, і починає індекс,
/// лише якщо з епохи `epoch` (запам'ятованої до KDF) бібліотеку не блокували й у профіль
/// ключів досі ввійдено: блокування, вихід із профілю чи перехід в інший під час KDF
/// мають силу (тоді ключі знищуються). `true` — розблоковано.
fn install_library_keys(
    app: &tauri::AppHandle,
    library: &LibrarySession,
    handles: &office_files::OfficeFileHandles,
    session: &ProfileSession,
    epoch: u64,
    keys: LibraryKeys,
) -> bool {
    let profile_id = keys.profile_id().to_owned();
    let installed = library
        .unlock_if(epoch, keys, || {
            session.get().as_deref() == Some(profile_id.as_str())
        })
        .is_some();
    if installed {
        handles.clear_pending();
        start_library_index(app, profile_id);
    }
    installed
}

/// Після зміни поточної версії документа у фоні оновлює його текст в індексі вмісту
/// й перелік пошкоджених (тоді ж перевіряються й інші пошкоджені: той самий вміст,
/// збережений наново, відновлює їх). Блокування бібліотеки зупиняє оновлення.
fn refresh_library_item(app: &tauri::AppHandle, profile_id: &str, item_id: &str) {
    let app = app.clone();
    let profile_id = profile_id.to_owned();
    let item_id = item_id.to_owned();
    tauri::async_runtime::spawn(async move {
        let store = app.state::<LibraryStore>();
        let session = app.state::<LibrarySession>();
        let mut items = vec![item_id.clone()];
        if let Some(index) = session.index_status(&profile_id) {
            items.extend(index.damaged.into_iter().filter(|id| *id != item_id));
        }
        for item in items {
            if let Err(error) = store.refresh_item(&session, &profile_id, &item).await {
                if session.unlocked_profile().as_deref() == Some(profile_id.as_str()) {
                    eprintln!("EasyWAR: не вдалося оновити документ в індексі бібліотеки: {error}");
                }
                return;
            }
        }
    });
}

/// Стан після дії, яка вже записана в базу (створення, відновлення): якщо його не
/// вдалося прочитати, команда все одно повертає код відновлення зі спрощеним станом.
async fn library_status_after_commit(
    store: &LibraryStore,
    session: &ProfileSession,
    library: &LibrarySession,
    profile_id: &str,
    has_recovery: bool,
) -> LibraryStatus {
    // Відновлення з екрана входу під чужим сеансом (інший профіль увійшов під час Argon2):
    // відповідь стосується профілю, чий код прийнято, а не поточного сеансу.
    if session.get().as_deref() != Some(profile_id) {
        let mut status = LibraryStatus::plain(LibraryState::Locked, Some(profile_id));
        status.has_recovery = has_recovery;
        return status;
    }
    match library_status_now(store, session, library).await {
        Ok(status) => status,
        Err(error) => {
            eprintln!("EasyWAR: не вдалося прочитати стан бібліотеки: {error}");
            let state = if library.unlocked_profile().as_deref() == Some(profile_id) {
                LibraryState::Unlocked
            } else {
                LibraryState::Locked
            };
            let mut status = LibraryStatus::plain(state, Some(profile_id));
            status.has_recovery = has_recovery;
            status
        }
    }
}

fn library_now() -> String {
    Utc::now().to_rfc3339_opts(SecondsFormat::Nanos, true)
}

/// Розширення файлів, які можна додати до бібліотеки.
const LIBRARY_IMPORT_EXTENSIONS: [&str; 5] = ["xlsx", "csv", "docx", "txt", "pptx"];

/// Читає звичайний файл лише для читання, не більше 256 МБ.
fn read_library_file(path: &Path) -> Result<Vec<u8>, String> {
    let bytes = office_files::read_regular_file(
        path,
        office_library::MAX_DOCUMENT_BYTES,
        &LibraryError::TooLarge.to_string(),
    )?;
    if bytes.is_empty() {
        return Err(office_files::OfficeFileError::Empty.to_string());
    }
    Ok(bytes)
}

/// Вікно збереження копії з бібліотеки: шлях без перезапису наявного файла. `None` — закрили.
async fn library_save_dialog(
    app: tauri::AppHandle,
    profiles: &LocalProfileStore,
    title: &'static str,
    suggested_name: String,
    ext: String,
) -> Result<Option<phone_export::SaveTarget>, String> {
    let dialog_ext = ext.clone();
    let selected = tauri::async_runtime::spawn_blocking(move || {
        app.dialog()
            .file()
            .set_title(title)
            .set_file_name(suggested_name)
            .add_filter(format!(".{dialog_ext}"), &[dialog_ext.as_str()])
            .blocking_save_file()
    })
    .await
    .map_err(|error| error.to_string())?;
    let Some(selected) = selected else {
        return Ok(None);
    };
    let mut target = phone_export::save_target(
        selected.into_path().map_err(|error| error.to_string())?,
        &[ext.as_str()],
        &ext,
    );
    // Копія з бібліотеки ніколи не затирає наявний файл (і таблицю профілю).
    target.replace_confirmed = false;
    office_files::ensure_not_protected(&target.path, &office_bound_tables(profiles).await?)
        .map_err(|error| error.to_string())?;
    Ok(Some(target))
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct LibraryCreated {
    recovery_code: Option<String>,
    status: LibraryStatus,
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct LibraryRecovered {
    recovery_code: String,
    status: LibraryStatus,
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct LibraryRecoveryCode {
    recovery_code: String,
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct LibrarySourceData {
    fingerprint: String,
    source_kind: office_library::SourceKind,
    data: Value,
    profile: office_sources::SourceProfile,
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct LibraryGenerated {
    item: LibraryItem,
    version: LibraryVersion,
    /// `false` — той самий вміст і той самий відбиток джерела, що й в останній
    /// згенерованій версії: нової не створено.
    created: bool,
}

/// Стан бібліотеки. Індекс вмісту, побудова якого не вдалася щонайменше хвилину тому,
/// починає будуватися наново (наступний стан — `indexing`).
#[tauri::command]
async fn library_status(
    app: tauri::AppHandle,
    store: tauri::State<'_, LibraryStore>,
    session: tauri::State<'_, ProfileSession>,
    library: tauri::State<'_, LibrarySession>,
) -> Result<LibraryStatus, String> {
    if let Some(profile_id) = session.get() {
        if library.index_retry_due(&profile_id, LIBRARY_INDEX_RETRY) {
            start_library_index(&app, profile_id);
        }
    }
    library_status_now(&store, &session, &library).await
}

/// Створює бібліотеку профілю сесії (лише профілю з паролем) і одразу розблоковує її.
#[tauri::command]
#[allow(clippy::too_many_arguments)]
async fn library_create(
    app: tauri::AppHandle,
    profiles: tauri::State<'_, LocalProfileStore>,
    store: tauri::State<'_, LibraryStore>,
    session: tauri::State<'_, ProfileSession>,
    library: tauri::State<'_, LibrarySession>,
    handles: tauri::State<'_, office_files::OfficeFileHandles>,
    password: String,
    with_recovery: bool,
) -> Result<LibraryCreated, String> {
    let password = zeroize::Zeroizing::new(password);
    let profile_id = active_profile_id(&session)?;
    if !profiles
        .has_password(&profile_id)
        .await
        .map_err(|error| error.to_string())?
    {
        return Err(LibraryError::ProfileWithoutPassword.to_string());
    }
    let epoch = library.epoch();
    verify_library_password(&profiles, &profile_id, &password).await?;
    let created = store
        .create(&profile_id, &password, with_recovery, &library_now())
        .await
        .map_err(|error| error.to_string())?;
    // Бібліотеку вже записано: код відновлення повертається за будь-якого стану після.
    let recovery_code = created
        .recovery_code
        .as_ref()
        .map(|code| code.as_str().to_owned());
    install_library_keys(&app, &library, &handles, &session, epoch, created.keys);
    notify_library_state(&app);
    Ok(LibraryCreated {
        status: library_status_after_commit(
            &store,
            &session,
            &library,
            &profile_id,
            recovery_code.is_some(),
        )
        .await,
        recovery_code,
    })
}

#[tauri::command]
async fn library_unlock(
    app: tauri::AppHandle,
    profiles: tauri::State<'_, LocalProfileStore>,
    store: tauri::State<'_, LibraryStore>,
    session: tauri::State<'_, ProfileSession>,
    library: tauri::State<'_, LibrarySession>,
    handles: tauri::State<'_, office_files::OfficeFileHandles>,
    password: String,
) -> Result<LibraryStatus, String> {
    let password = zeroize::Zeroizing::new(password);
    let profile_id = active_profile_id(&session)?;
    let epoch = library.epoch();
    verify_library_password(&profiles, &profile_id, &password).await?;
    let keys = store
        .unlock(&profile_id, &password, &library_now())
        .await
        .map_err(|error| error.to_string())?;
    if !install_library_keys(&app, &library, &handles, &session, epoch, keys) {
        // Під час KDF бібліотеку заблокували або вийшли з профілю: це має силу. Та сама
        // бібліотека, яку тим часом розблокував інший виклик, — не помилка.
        let same_session = session.get().as_deref() == Some(profile_id.as_str());
        if !same_session || library.unlocked_profile().as_deref() != Some(profile_id.as_str()) {
            return Err(LibraryError::Locked.to_string());
        }
    }
    library_status_now(&store, &session, &library).await
}

#[tauri::command]
async fn library_lock(
    store: tauri::State<'_, LibraryStore>,
    session: tauri::State<'_, ProfileSession>,
    library: tauri::State<'_, LibrarySession>,
    handles: tauri::State<'_, office_files::OfficeFileHandles>,
) -> Result<LibraryStatus, String> {
    lock_library(&library, &handles);
    library_status_now(&store, &session, &library).await
}

#[tauri::command]
async fn library_list(
    store: tauri::State<'_, LibraryStore>,
    session: tauri::State<'_, ProfileSession>,
    library: tauri::State<'_, LibrarySession>,
    include_hidden: Option<bool>,
) -> Result<Vec<LibraryItem>, String> {
    let (_, keys) = library_keys(&session, &library)?;
    store
        .list_items(&keys, include_hidden.unwrap_or(false))
        .await
        .map_err(|error| error.to_string())
}

#[tauri::command]
async fn library_versions(
    store: tauri::State<'_, LibraryStore>,
    session: tauri::State<'_, ProfileSession>,
    library: tauri::State<'_, LibrarySession>,
    item_id: String,
) -> Result<Vec<LibraryVersion>, String> {
    let (_, keys) = library_keys(&session, &library)?;
    store
        .versions(&keys, &item_id)
        .await
        .map_err(|error| error.to_string())
}

/// Додає файл з диска до бібліотеки: вікно вибору, читання без змін у файлі (до 256 МБ).
/// Таблиця, прив'язана до цього профілю (або її `.easywar-prev`), позначається як копія.
/// `None` — вікно закрили.
#[tauri::command]
async fn library_import(
    app: tauri::AppHandle,
    profiles: tauri::State<'_, LocalProfileStore>,
    store: tauri::State<'_, LibraryStore>,
    session: tauri::State<'_, ProfileSession>,
    library: tauri::State<'_, LibrarySession>,
    as_template: Option<bool>,
) -> Result<Option<LibraryItem>, String> {
    let (profile_id, keys) = library_keys(&session, &library)?;
    drop(keys);
    let dialog_app = app.clone();
    let selected = tauri::async_runtime::spawn_blocking(move || {
        dialog_app
            .dialog()
            .file()
            .set_title("Додати файл до бібліотеки")
            .add_filter(
                "Таблиці, документи й презентації",
                &LIBRARY_IMPORT_EXTENSIONS,
            )
            .blocking_pick_file()
    })
    .await
    .map_err(|error| error.to_string())?;
    let Some(selected) = selected else {
        return Ok(None);
    };
    let path = selected.into_path().map_err(|error| error.to_string())?;
    let ext = path
        .extension()
        .map(|ext| ext.to_string_lossy().into_owned())
        .unwrap_or_default();
    let ext = office_library::normalize_ext(&ext).map_err(|error| error.to_string())?;
    let file_name = office_files::file_name(&path);
    let own_tables: Vec<PathBuf> = profiles
        .profile_table_paths(&profile_id)
        .await
        .map_err(|error| error.to_string())?
        .into_iter()
        .map(PathBuf::from)
        .collect();
    let (bytes, profile_table_copy) = tauri::async_runtime::spawn_blocking(move || {
        let copy = office_files::is_protected_table(&path, &own_tables);
        read_library_file(&path).map(|bytes| (bytes, copy))
    })
    .await
    .map_err(|error| error.to_string())??;
    let keys = library
        .keys(&profile_id)
        .map_err(|error| error.to_string())?;
    let (item, _) = store
        .import(
            &keys,
            office_library::NewDocument {
                name: &office_library::document_name_from_file(&file_name),
                ext,
                as_template: as_template.unwrap_or(false),
                profile_table_copy,
                bytes: &bytes,
            },
            &library_now(),
        )
        .await
        .map_err(|error| error.to_string())?;
    refresh_library_item(&app, &profile_id, &item.id);
    Ok(Some(item))
}

#[tauri::command]
async fn library_rename(
    store: tauri::State<'_, LibraryStore>,
    session: tauri::State<'_, ProfileSession>,
    library: tauri::State<'_, LibrarySession>,
    item_id: String,
    name: String,
) -> Result<LibraryItem, String> {
    let (_, keys) = library_keys(&session, &library)?;
    store
        .rename(&keys, &item_id, &name, &library_now())
        .await
        .map_err(|error| error.to_string())
}

#[tauri::command]
async fn library_set_hidden(
    store: tauri::State<'_, LibraryStore>,
    session: tauri::State<'_, ProfileSession>,
    library: tauri::State<'_, LibrarySession>,
    item_id: String,
    hidden: bool,
) -> Result<LibraryItem, String> {
    let (_, keys) = library_keys(&session, &library)?;
    store
        .set_hidden(&keys, &item_id, hidden, &library_now())
        .await
        .map_err(|error| error.to_string())
}

#[tauri::command]
async fn library_set_current(
    app: tauri::AppHandle,
    store: tauri::State<'_, LibraryStore>,
    session: tauri::State<'_, ProfileSession>,
    library: tauri::State<'_, LibrarySession>,
    item_id: String,
    version_id: String,
) -> Result<LibraryItem, String> {
    let (profile_id, keys) = library_keys(&session, &library)?;
    let item = store
        .set_current(&keys, &item_id, &version_id, &library_now())
        .await
        .map_err(|error| error.to_string())?;
    library.clear_damaged(&profile_id, &item.id);
    refresh_library_item(&app, &profile_id, &item.id);
    Ok(item)
}

/// Зберігає копію версії на диск (вікно збереження, без перезапису наявного файла
/// й таблиць профілів). Повертає шлях; `None` — вікно закрили.
#[tauri::command]
async fn library_export_copy(
    app: tauri::AppHandle,
    profiles: tauri::State<'_, LocalProfileStore>,
    store: tauri::State<'_, LibraryStore>,
    session: tauri::State<'_, ProfileSession>,
    library: tauri::State<'_, LibrarySession>,
    version_id: String,
) -> Result<Option<String>, String> {
    let (profile_id, keys) = library_keys(&session, &library)?;
    let version = store
        .version(&keys, &version_id)
        .await
        .map_err(|error| error.to_string())?;
    let item = store
        .item(&keys, &version.item_id)
        .await
        .map_err(|error| error.to_string())?;
    drop(keys);
    let suggested = office_files::suggested_file_name(
        Some(&format!("{}.{}", item.name, version.ext)),
        "Документ",
    );
    let Some(target) = library_save_dialog(
        app,
        &profiles,
        "Зберегти копію з бібліотеки",
        suggested,
        version.ext.clone(),
    )
    .await?
    else {
        return Ok(None);
    };
    let keys = library
        .keys(&profile_id)
        .map_err(|error| error.to_string())?;
    let (_, bytes) = store
        .read_version(&keys, &version.id)
        .await
        .map_err(|error| error.to_string())?;
    let path = target.path.clone();
    tauri::async_runtime::spawn_blocking(move || phone_export::save_file(&target, &bytes))
        .await
        .map_err(|error| error.to_string())?
        .map_err(|error| error.to_string())?;
    // Копію вже збережено: невдалий запис події аудиту її не скасовує.
    store
        .record_event_best_effort(
            keys.profile_id(),
            office_library::LibraryEventKind::Exported,
            Some(&item.id),
            Some(&version.id),
            &library_now(),
        )
        .await;
    Ok(Some(path.display().to_string()))
}

/// Збережений архів бібліотеки: шлях і назви пошкоджених документів, яких у ньому немає.
#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct LibraryArchiveExport {
    path: String,
    skipped: Vec<String>,
}

/// Переносить готовий тимчасовий архів на місце, не затираючи наявний файл.
fn persist_archive(file: tempfile::NamedTempFile, destination: &Path) -> Result<(), String> {
    file.as_file()
        .sync_all()
        .map_err(|error| error.to_string())?;
    file.persist_noclobber(destination).map_err(|error| {
        if error.error.kind() == std::io::ErrorKind::AlreadyExists {
            phone_export::SaveFileError::AlreadyExists(office_files::file_name(destination))
                .to_string()
        } else {
            error.error.to_string()
        }
    })?;
    Ok(())
}

/// ZIP з поточними версіями всіх документів (і прихованих). Архів пишеться потоком у
/// тимчасовий файл поруч із цільовим (у пам'яті щонайбільше один документ) і лише потім
/// переноситься на місце без перезапису. Пошкоджені документи пропускаються й
/// перелічуються в `skipped`. `None` — вікно закрили.
#[tauri::command]
async fn library_export_archive(
    app: tauri::AppHandle,
    profiles: tauri::State<'_, LocalProfileStore>,
    store: tauri::State<'_, LibraryStore>,
    session: tauri::State<'_, ProfileSession>,
    library: tauri::State<'_, LibrarySession>,
) -> Result<Option<LibraryArchiveExport>, String> {
    let (profile_id, keys) = library_keys(&session, &library)?;
    drop(keys);
    let suggested = format!("Бібліотека EasyWAR {}.zip", Utc::now().format("%Y-%m-%d"));
    let Some(target) = library_save_dialog(
        app,
        &profiles,
        "Зберегти архів бібліотеки",
        suggested,
        "zip".to_owned(),
    )
    .await?
    else {
        return Ok(None);
    };
    let keys = library
        .keys(&profile_id)
        .map_err(|error| error.to_string())?;
    let directory = target
        .path
        .parent()
        .filter(|parent| !parent.as_os_str().is_empty())
        .map_or_else(|| PathBuf::from("."), Path::to_path_buf);
    let file = tauri::async_runtime::spawn_blocking(move || {
        tempfile::Builder::new()
            .prefix(".easywar-archive-")
            .suffix(".part")
            .tempfile_in(directory)
    })
    .await
    .map_err(|error| error.to_string())?
    .map_err(|error| error.to_string())?;
    let (file, summary) = store
        .export_archive_to(&keys, file)
        .await
        .map_err(|error| error.to_string())?;
    let path = target.path.clone();
    tauri::async_runtime::spawn_blocking(move || persist_archive(file, &target.path))
        .await
        .map_err(|error| error.to_string())??;
    // Архів уже збережено: невдалий запис події аудиту його не скасовує.
    store
        .record_event_best_effort(
            keys.profile_id(),
            office_library::LibraryEventKind::ArchiveExported,
            None,
            None,
            &library_now(),
        )
        .await;
    Ok(Some(LibraryArchiveExport {
        path: path.display().to_string(),
        skipped: summary.skipped,
    }))
}

/// Відкриває версію документа у вікні редактора її застосунку: документ чекає на перший
/// `office_open_file` цього застосунку (без вікна вибору). Відкрите вікно редактора
/// спершу треба закрити.
#[tauri::command]
async fn library_open_in_editor(
    app: tauri::AppHandle,
    window: tauri::WebviewWindow,
    store: tauri::State<'_, LibraryStore>,
    session: tauri::State<'_, ProfileSession>,
    library: tauri::State<'_, LibrarySession>,
    handles: tauri::State<'_, office_files::OfficeFileHandles>,
    version_id: String,
) -> Result<(), String> {
    if window.label() != desktop_shell::MAIN_WINDOW_LABEL {
        return Err("редактор відкривається лише з головного вікна".to_owned());
    }
    let (profile_id, keys) = library_keys(&session, &library)?;
    let version = store
        .version(&keys, &version_id)
        .await
        .map_err(|error| error.to_string())?;
    let item = store
        .item(&keys, &version.item_id)
        .await
        .map_err(|error| error.to_string())?;
    let app_id = office_files::editor_app(office_library::app_for_ext(&version.ext))
        .map_err(|error| error.to_string())?;
    if editor_open(&app, &handles) {
        return Err(EDITOR_OPEN_MESSAGE.to_owned());
    }
    let name = format!("{}.{}", item.name, version.ext);
    handles.set_pending(office_files::PendingFile {
        profile_id,
        app: app_id,
        source: office_files::PendingSource::Library {
            version_id: version.id,
        },
        ext: version.ext,
        name: name.clone(),
    });
    desktop_shell::open_office_editor(&app, &window, app_id, Some(&name)).map_err(|error| {
        handles.clear_pending();
        error.to_string()
    })
}

/// Розшифровані байти версії сирими (без JSON).
#[tauri::command]
async fn library_read_version(
    store: tauri::State<'_, LibraryStore>,
    session: tauri::State<'_, ProfileSession>,
    library: tauri::State<'_, LibrarySession>,
    version_id: String,
) -> Result<tauri::ipc::Response, String> {
    let (_, keys) = library_keys(&session, &library)?;
    let (_, mut bytes) = store
        .read_version(&keys, &version_id)
        .await
        .map_err(|error| error.to_string())?;
    Ok(tauri::ipc::Response::new(std::mem::take(&mut *bytes)))
}

/// Пошук за назвами й (коли індекс готовий) за вмістом.
#[tauri::command]
async fn library_search(
    store: tauri::State<'_, LibraryStore>,
    session: tauri::State<'_, ProfileSession>,
    library: tauri::State<'_, LibrarySession>,
    query: String,
    include_hidden: Option<bool>,
) -> Result<office_library::SearchResponse, String> {
    let (_, keys) = library_keys(&session, &library)?;
    store
        .search(&library, &keys, &query, include_hidden.unwrap_or(false))
        .await
        .map_err(|error| error.to_string())
}

/// Дані джерела для шаблону та їхній відбиток (див. `office_sources`).
#[tauri::command]
#[allow(clippy::too_many_arguments)]
async fn library_source_data(
    profiles: tauri::State<'_, LocalProfileStore>,
    templates: tauri::State<'_, WorkspaceTemplateStore>,
    repository: tauri::State<'_, Repository>,
    modules: tauri::State<'_, DashboardModuleStore>,
    store: tauri::State<'_, LibraryStore>,
    session: tauri::State<'_, ProfileSession>,
    library: tauri::State<'_, LibrarySession>,
    source_kind: String,
    params: Option<Value>,
) -> Result<LibrarySourceData, String> {
    let (profile_id, keys) = library_keys(&session, &library)?;
    let kind = SourceRequest::parse_kind(&source_kind).map_err(|error| error.to_string())?;
    let request = SourceRequest::parse(kind, &params.unwrap_or(Value::Null))
        .map_err(|error| error.to_string())?;
    let sources = Sources {
        repository: &repository,
        modules: &modules,
        library: &store,
        keys: &keys,
    };
    let (fingerprint, data) = sources
        .fingerprinted(&request)
        .await
        .map_err(|error| error.to_string())?;
    let profile = office_sources::source_profile(&profiles, &templates, &profile_id)
        .await
        .map_err(|error| error.to_string())?;
    Ok(LibrarySourceData {
        fingerprint,
        source_kind: kind,
        data,
        profile,
    })
}

/// Зберігає документ, згенерований із шаблону: відбиток джерела перераховується, і
/// якщо дані встигли змінитися, документ не зберігається. Нова версія наявного документа
/// (`item_id`) зберігається, лише якщо його поточна версія досі `expected_current_version_id`
/// (та, яку бачив користувач; `None` — документ без поточної версії).
#[tauri::command]
#[allow(clippy::too_many_arguments)]
async fn library_save_generated(
    app: tauri::AppHandle,
    repository: tauri::State<'_, Repository>,
    modules: tauri::State<'_, DashboardModuleStore>,
    store: tauri::State<'_, LibraryStore>,
    session: tauri::State<'_, ProfileSession>,
    library: tauri::State<'_, LibrarySession>,
    item_id: Option<String>,
    expected_current_version_id: Option<String>,
    name: Option<String>,
    template_version_id: String,
    source_kind: String,
    params: Option<Value>,
    fingerprint: String,
    ext: String,
    bytes: Vec<u8>,
    make_current: bool,
) -> Result<LibraryGenerated, String> {
    let (profile_id, keys) = library_keys(&session, &library)?;
    office_files::check_size(&bytes).map_err(|error| error.to_string())?;
    let kind = SourceRequest::parse_kind(&source_kind).map_err(|error| error.to_string())?;
    let request = SourceRequest::parse(kind, &params.unwrap_or(Value::Null))
        .map_err(|error| error.to_string())?;
    let sources = Sources {
        repository: &repository,
        modules: &modules,
        library: &store,
        keys: &keys,
    };
    let saved = sources
        .save_generated(
            &request,
            &fingerprint,
            office_sources::GeneratedInput {
                item_id: item_id.as_deref(),
                expected_current: item_id
                    .as_ref()
                    .map(|_| expected_current_version_id.as_deref()),
                name: name.as_deref(),
                template_version_id: &template_version_id,
                ext: &ext,
                bytes: &bytes,
                make_current,
            },
            &library_now(),
        )
        .await
        .map_err(|error| error.to_string())?;
    if saved.item.current_version_id.as_deref() == Some(saved.version.id.as_str()) {
        library.clear_damaged(&profile_id, &saved.item.id);
        refresh_library_item(&app, &profile_id, &saved.item.id);
    }
    Ok(LibraryGenerated {
        item: saved.item,
        version: saved.version,
        created: saved.created,
    })
}

/// Стан кожного документа, пов'язаного з джерелом.
#[tauri::command]
async fn library_link_statuses(
    repository: tauri::State<'_, Repository>,
    modules: tauri::State<'_, DashboardModuleStore>,
    store: tauri::State<'_, LibraryStore>,
    session: tauri::State<'_, ProfileSession>,
    library: tauri::State<'_, LibrarySession>,
) -> Result<Vec<office_sources::LinkStatus>, String> {
    let (_, keys) = library_keys(&session, &library)?;
    Sources {
        repository: &repository,
        modules: &modules,
        library: &store,
        keys: &keys,
    }
    .link_statuses()
    .await
    .map_err(|error| error.to_string())
}

#[tauri::command]
async fn library_unlink(
    store: tauri::State<'_, LibraryStore>,
    session: tauri::State<'_, ProfileSession>,
    library: tauri::State<'_, LibrarySession>,
    item_id: String,
) -> Result<LibraryItem, String> {
    let (_, keys) = library_keys(&session, &library)?;
    store
        .unlink(&keys, &item_id)
        .await
        .map_err(|error| error.to_string())
}

/// «Забули пароль»: код відновлення бібліотеки задає новий пароль профілю, видає новий код
/// і входить у профіль (він стає й активним у базі). Профіль — той, у який увійшли; без
/// входу — `profile_id` з екрана входу, а без нього — `active_profile_id` бази. Новий код
/// повертається завжди, щойно новий пароль записано; якщо під час KDF бібліотеку
/// заблокували чи профіль сесії змінився, вона лишається заблокованою.
#[tauri::command]
#[allow(clippy::too_many_arguments)]
async fn library_recover(
    app: tauri::AppHandle,
    profiles: tauri::State<'_, LocalProfileStore>,
    store: tauri::State<'_, LibraryStore>,
    session: tauri::State<'_, ProfileSession>,
    library: tauri::State<'_, LibrarySession>,
    handles: tauri::State<'_, office_files::OfficeFileHandles>,
    code: String,
    new_password: String,
    profile_id: Option<String>,
) -> Result<LibraryRecovered, String> {
    let code = zeroize::Zeroizing::new(code);
    let new_password = zeroize::Zeroizing::new(new_password);
    let signed_in = session.get();
    let profile_id = match (signed_in.as_deref(), profile_id) {
        (Some(current), Some(requested)) if requested != current => {
            return Err("відновити пароль іншого профілю можна лише з екрана входу".to_owned());
        }
        (Some(current), _) => current.to_owned(),
        (None, Some(requested)) => requested,
        (None, None) => profiles
            .list()
            .await
            .map_err(|error| error.to_string())?
            .active_profile_id
            .ok_or_else(|| local_profiles::LocalProfileError::ProfileNotFound.to_string())?,
    };
    if signed_in.is_none() {
        ensure_editor_closed(&app, &handles)?;
    }
    if !profiles
        .has_password(&profile_id)
        .await
        .map_err(|error| error.to_string())?
        || !store
            .has_active_keyring(&profile_id)
            .await
            .map_err(|error| error.to_string())?
    {
        return Err(LibraryError::NoLibrary.to_string());
    }
    local_profiles::validate_password(&new_password).map_err(|error| error.to_string())?;
    let epoch = library.epoch();
    let prepared = store
        .prepare_recovery(&profile_id, &code, &new_password)
        .await
        .map_err(|error| error.to_string())?;
    profiles
        .recover_password(&profile_id, &new_password, &prepared, &library_now())
        .await
        .map_err(|error| error.to_string())?;
    // Новий пароль і новий код уже записано: далі ніщо не скасовує повернення коду.
    let (keys, recovery_code) = prepared.into_parts();
    let recovery_code = recovery_code.as_str().to_owned();
    let unchanged = session.get() == signed_in;
    if unchanged && signed_in.is_none() && !editor_open(&app, &handles) {
        session.set(Some(profile_id.clone()));
        if let Err(error) = profiles.activate(&profile_id, &library_now()).await {
            eprintln!("EasyWAR: профіль після відновлення пароля не став активним: {error}");
        }
    }
    install_library_keys(&app, &library, &handles, &session, epoch, keys);
    notify_library_state(&app);
    Ok(LibraryRecovered {
        recovery_code,
        status: library_status_after_commit(&store, &session, &library, &profile_id, true).await,
    })
}

/// Новий код відновлення (старий стає недійсним); потрібен пароль профілю.
#[tauri::command]
async fn library_reissue_recovery(
    profiles: tauri::State<'_, LocalProfileStore>,
    store: tauri::State<'_, LibraryStore>,
    session: tauri::State<'_, ProfileSession>,
    library: tauri::State<'_, LibrarySession>,
    password: String,
) -> Result<LibraryRecoveryCode, String> {
    let password = zeroize::Zeroizing::new(password);
    let (profile_id, keys) = library_keys(&session, &library)?;
    drop(keys);
    verify_library_password(&profiles, &profile_id, &password).await?;
    let code = store
        .reissue_recovery(&profile_id, &password, &library_now())
        .await
        .map_err(|error| error.to_string())?;
    Ok(LibraryRecoveryCode {
        recovery_code: code.as_str().to_owned(),
    })
}

// --- Сховище файлів «Робочого середовища» (зашифровані блоби в теці, workspace_files.rs) ---

/// Тека сховища активного профілю: `<app_local_data>/workspace-files/<profile_id>`.
fn workspace_files_dir(
    app: &tauri::AppHandle,
    session: &ProfileSession,
) -> Result<(String, PathBuf), String> {
    let profile_id = active_profile_id(session)?;
    let base = app
        .path()
        .app_local_data_dir()
        .map_err(|error| error.to_string())?;
    Ok((
        profile_id.clone(),
        workspace_files::root_dir(&base, &profile_id),
    ))
}

/// Тека й ключі бібліотеки профілю сесії (сховище зашифроване її ключем: заблокована
/// бібліотека → та сама помилка «бібліотека заблокована…», що й у команд `library_*`).
fn workspace_files_keys(
    app: &tauri::AppHandle,
    session: &ProfileSession,
    library: &LibrarySession,
) -> Result<(String, PathBuf, Arc<office_library::LibraryKeys>), String> {
    let (profile_id, dir) = workspace_files_dir(app, session)?;
    let keys = library
        .keys(&profile_id)
        .map_err(|error| error.to_string())?;
    Ok((profile_id, dir, keys))
}

/// Файли сховища профілю за назвою і шлях теки.
#[tauri::command]
async fn workspace_files_list(
    app: tauri::AppHandle,
    session: tauri::State<'_, ProfileSession>,
    library: tauri::State<'_, LibrarySession>,
) -> Result<workspace_files::Listing, String> {
    let (_, dir, keys) = workspace_files_keys(&app, &session, &library)?;
    let root = dir.to_string_lossy().into_owned();
    let items = tauri::async_runtime::spawn_blocking(move || workspace_files::list(&dir, &keys))
        .await
        .map_err(|error| error.to_string())?
        .map_err(|error| error.to_string())?;
    Ok(workspace_files::Listing { root, items })
}

/// «Додати файли…»: вікно вибору (кілька файлів будь-якого типу), зашифрована копія кожного
/// в теці сховища. Файли на диску не змінюються. `None` — вікно закрили.
#[tauri::command]
async fn workspace_files_add(
    app: tauri::AppHandle,
    session: tauri::State<'_, ProfileSession>,
    library: tauri::State<'_, LibrarySession>,
) -> Result<Option<workspace_files::AddResult>, String> {
    let (profile_id, dir, keys) = workspace_files_keys(&app, &session, &library)?;
    drop(keys);
    let dialog_app = app.clone();
    let selected = tauri::async_runtime::spawn_blocking(move || {
        dialog_app
            .dialog()
            .file()
            .set_title("Додати файли до сховища")
            .blocking_pick_files()
    })
    .await
    .map_err(|error| error.to_string())?;
    let Some(selected) = selected else {
        return Ok(None);
    };
    let mut paths = Vec::with_capacity(selected.len());
    for file in selected
        .into_iter()
        .take(workspace_files::MAX_FILES_PER_ADD)
    {
        paths.push(file.into_path().map_err(|error| error.to_string())?);
    }
    // Ключі беруться після вікна вибору: поки воно було відкрите, бібліотеку могли заблокувати.
    let keys = library
        .keys(&profile_id)
        .map_err(|error| error.to_string())?;
    let result = tauri::async_runtime::spawn_blocking(move || {
        let mut result = workspace_files::AddResult::default();
        for path in paths {
            match workspace_files::add(&dir, &keys, &path) {
                Ok(item) => result.added.push(item),
                Err(error) => result.skipped.push(workspace_files::SkippedFile {
                    name: office_files::file_name(&path),
                    reason: error.to_string(),
                }),
            }
        }
        result
    })
    .await
    .map_err(|error| error.to_string())?;
    Ok(Some(result))
}

/// Видаляє блоб сховища назавжди (і пошкоджений теж).
#[tauri::command]
async fn workspace_files_delete(
    app: tauri::AppHandle,
    session: tauri::State<'_, ProfileSession>,
    library: tauri::State<'_, LibrarySession>,
    id: String,
) -> Result<String, String> {
    let (_, dir, keys) = workspace_files_keys(&app, &session, &library)?;
    drop(keys);
    tauri::async_runtime::spawn_blocking(move || workspace_files::delete(&dir, &id))
        .await
        .map_err(|error| error.to_string())?
        .map_err(|error| error.to_string())
}

/// «Зберегти копію…»: розшифрована копія файлу сховища в місце, яке обере користувач
/// (наявний файл і таблиці профілів не перезаписуються). `None` — вікно закрили.
#[tauri::command]
async fn workspace_files_export(
    app: tauri::AppHandle,
    profiles: tauri::State<'_, LocalProfileStore>,
    session: tauri::State<'_, ProfileSession>,
    library: tauri::State<'_, LibrarySession>,
    id: String,
) -> Result<Option<String>, String> {
    let (profile_id, dir, keys) = workspace_files_keys(&app, &session, &library)?;
    let (item, _) = workspace_files::stat(&dir, &keys, &id).map_err(|error| error.to_string())?;
    drop(keys);
    let ext = if item.ext.is_empty() {
        "bin".to_owned()
    } else {
        item.ext.clone()
    };
    let Some(target) = library_save_dialog(
        app,
        &profiles,
        "Зберегти копію зі сховища",
        item.name.clone(),
        ext,
    )
    .await?
    else {
        return Ok(None);
    };
    let keys = library
        .keys(&profile_id)
        .map_err(|error| error.to_string())?;
    let path = target.path.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let (_, bytes) =
            workspace_files::read(&dir, &keys, &item.id).map_err(|error| error.to_string())?;
        phone_export::save_file(&target, &bytes).map_err(|error| error.to_string())
    })
    .await
    .map_err(|error| error.to_string())??;
    Ok(Some(path.to_string_lossy().into_owned()))
}

/// Відкриває файл сховища у вікні редактора його застосунку (як `library_open_in_editor`):
/// файл чекає на перший `office_open_file` цього застосунку, а «Зберегти» в редакторі
/// запечатує байти назад у той самий блоб.
#[tauri::command]
async fn workspace_files_open(
    app: tauri::AppHandle,
    window: tauri::WebviewWindow,
    session: tauri::State<'_, ProfileSession>,
    library: tauri::State<'_, LibrarySession>,
    handles: tauri::State<'_, office_files::OfficeFileHandles>,
    id: String,
) -> Result<(), String> {
    if window.label() != desktop_shell::MAIN_WINDOW_LABEL {
        return Err("редактор відкривається лише з головного вікна".to_owned());
    }
    let (profile_id, dir, keys) = workspace_files_keys(&app, &session, &library)?;
    let (item, _) = workspace_files::stat(&dir, &keys, &id).map_err(|error| error.to_string())?;
    drop(keys);
    let app_id = item.app.ok_or_else(|| {
        workspace_files::WorkspaceFilesError::NoEditor(item.name.clone()).to_string()
    })?;
    let app_id = office_files::editor_app(app_id).map_err(|error| error.to_string())?;
    if editor_open(&app, &handles) {
        return Err(EDITOR_OPEN_MESSAGE.to_owned());
    }
    handles.set_pending(office_files::PendingFile {
        profile_id,
        app: app_id,
        source: office_files::PendingSource::Store { dir, id: item.id },
        ext: item.ext,
        name: item.name.clone(),
    });
    desktop_shell::open_office_editor(&app, &window, app_id, Some(&item.name)).map_err(|error| {
        handles.clear_pending();
        error.to_string()
    })
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
    library: tauri::State<'_, LibrarySession>,
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
        let table = bound_table(&profiles, &session, &profile_id, dashboard.branch()).await?;
        let (xlsx, name) = read_bound_table(&app, &session, &library, &profile_id, table).await?;
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

/// Прив'язана таблиця профілю: файл на диску або таблиця зашифрованого сховища
/// (`ewstore:<id>:<назва>`, див. `workspace_tables`).
async fn bound_table(
    profiles: &LocalProfileStore,
    session: &ProfileSession,
    profile_id: &str,
    branch: Branch,
) -> Result<TableRef, String> {
    ensure_profile_unlocked(profiles, session, profile_id).await?;
    profiles
        .table_path(profile_id, branch)
        .await
        .map_err(|error| error.to_string())?
        .map(|path| workspace_tables::parse_ref(&path))
        .ok_or_else(|| format!("До профілю не прив'язано таблицю {}", branch.genitive()))
}

/// Пояснення для дашборда, чия таблиця лежить у сховищі, коли бібліотеку заблоковано.
const STORE_LOCKED_MESSAGE: &str = "Таблицю зашифровано у сховищі профілю, а бібліотеку профілю заблоковано (30 хвилин без дій або вихід із профілю). Увійдіть у профіль ще раз паролем або розблокуйте бібліотеку в «Робочому середовищі».";

/// Підтека таблиць сховища профілю `profile_id` і ключі його бібліотеки. Ключі є лише в
/// профілю сесії; заблокована бібліотека → [`STORE_LOCKED_MESSAGE`].
fn store_table_access(
    app: &tauri::AppHandle,
    session: &ProfileSession,
    library: &LibrarySession,
    profile_id: &str,
) -> Result<(PathBuf, Arc<LibraryKeys>), String> {
    if session.get().as_deref() != Some(profile_id) {
        return Err("Таблиця зі сховища відкривається лише в профілі, у який увійшли".to_owned());
    }
    let base = app
        .path()
        .app_local_data_dir()
        .map_err(|error| error.to_string())?;
    let dir = workspace_tables::tables_dir(&workspace_files::root_dir(&base, profile_id));
    let keys = library.keys(profile_id).map_err(|error| match error {
        LibraryError::Locked => STORE_LOCKED_MESSAGE.to_owned(),
        other => other.to_string(),
    })?;
    Ok((dir, keys))
}

/// Байти прив'язаної таблиці та її назва: файл з диска або розшифрований блоб сховища.
async fn read_bound_table(
    app: &tauri::AppHandle,
    session: &ProfileSession,
    library: &LibrarySession,
    profile_id: &str,
    table: TableRef,
) -> Result<(Vec<u8>, String), String> {
    let source = resolve_source(app, session, library, profile_id, table)?;
    tauri::async_runtime::spawn_blocking(move || source.read())
        .await
        .map_err(|error| error.to_string())?
}

/// Сирі байти прив'язаної таблиці (без JSON, щоб не роздувати великі файли). Таблиця
/// зі сховища розшифровується ключами бібліотеки профілю.
#[tauri::command]
async fn read_profile_database(
    app: tauri::AppHandle,
    profiles: tauri::State<'_, LocalProfileStore>,
    session: tauri::State<'_, ProfileSession>,
    library: tauri::State<'_, LibrarySession>,
    profile_id: String,
    branch: Branch,
) -> Result<tauri::ipc::Response, String> {
    let table = bound_table(&profiles, &session, &profile_id, branch).await?;
    let (bytes, _) = read_bound_table(&app, &session, &library, &profile_id, table).await?;
    Ok(tauri::ipc::Response::new(bytes))
}

/// Записує таблицю назад у прив'язаний файл. Тіло запиту — сирі байти XLSX,
/// профіль і рід військ — у заголовках `x-easywar-profile` і `x-easywar-branch`.
/// Байти перевіряються як книга, а попередній стан зберігається поруч у
/// `<назва>.easywar-prev.xlsx` (див. `profile_table`). Таблиця зі сховища запечатується
/// назад у свій блоб, попередній стан — у `<id>.prev.ewf` (див. `workspace_tables`).
#[tauri::command]
async fn write_profile_database(
    app: tauri::AppHandle,
    request: tauri::ipc::Request<'_>,
    profiles: tauri::State<'_, LocalProfileStore>,
    session: tauri::State<'_, ProfileSession>,
    library: tauri::State<'_, LibrarySession>,
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
    match bound_table(&profiles, &session, &profile_id, branch).await? {
        TableRef::Disk(path) => tauri::async_runtime::spawn_blocking(move || {
            profile_table::save(&path, branch, &bytes)
                .map(|_| ())
                .map_err(|error| error.to_string())
        })
        .await
        .map_err(|error| error.to_string())?,
        TableRef::Store { id, .. } => {
            let (dir, keys) = store_table_access(&app, &session, &library, &profile_id)?;
            tauri::async_runtime::spawn_blocking(move || {
                workspace_tables::save(&dir, &keys, &id, branch, &bytes)
                    .map(|_| ())
                    .map_err(|error| error.to_string())
            })
            .await
            .map_err(|error| error.to_string())?
        }
    }
}

/// «Перенести у сховище»: прив'язана таблиця з диска стає зашифрованою таблицею сховища
/// профілю (новий блоб у `tables/`), а прив'язка — посиланням `ewstore:…`. Файл на диску
/// не змінюється й не видаляється. Потрібна розблокована бібліотека профілю сесії.
#[tauri::command]
async fn move_profile_database_to_store(
    app: tauri::AppHandle,
    profiles: tauri::State<'_, LocalProfileStore>,
    session: tauri::State<'_, ProfileSession>,
    library: tauri::State<'_, LibrarySession>,
    profile_id: String,
    branch: Branch,
) -> Result<LocalProfilesState, String> {
    let TableRef::Disk(path) = bound_table(&profiles, &session, &profile_id, branch).await? else {
        return Err("Ця таблиця вже у сховищі".to_owned());
    };
    let (dir, keys) = store_table_access(&app, &session, &library, &profile_id)?;
    let stored = tauri::async_runtime::spawn_blocking(move || {
        let (bytes, name) = read_source_file(&path)?;
        workspace_tables::write_new(&dir, &keys, &name, branch, &bytes)
            .map_err(|error| error.to_string())
    })
    .await
    .map_err(|error| error.to_string())??;
    let reference = workspace_tables::store_ref(&stored.id, &stored.name);
    let now = Utc::now().to_rfc3339_opts(SecondsFormat::Nanos, true);
    profiles
        .set_table_path(&profile_id, branch, Some(&reference), &now)
        .await
        .map_err(|error| error.to_string())
}

/// Порожня базова таблиця одразу в зашифрованому сховищі профілю (без вікна збереження)
/// з прив'язкою до свого роду військ. `path` у відповіді — назва таблиці у сховищі.
#[tauri::command]
async fn create_profile_base_table_in_store(
    app: tauri::AppHandle,
    profiles: tauri::State<'_, LocalProfileStore>,
    session: tauri::State<'_, ProfileSession>,
    library: tauri::State<'_, LibrarySession>,
    profile_id: String,
    table: BaseTable,
) -> Result<CreatedBaseTable, String> {
    ensure_profile_unlocked(&profiles, &session, &profile_id).await?;
    let (dir, keys) = store_table_access(&app, &session, &library, &profile_id)?;
    let stored = tauri::async_runtime::spawn_blocking(move || {
        workspace_tables::write_new(
            &dir,
            &keys,
            table.file_name(),
            table.branch(),
            table.bytes(),
        )
        .map_err(|error| error.to_string())
    })
    .await
    .map_err(|error| error.to_string())??;
    let reference = workspace_tables::store_ref(&stored.id, &stored.name);
    let now = Utc::now().to_rfc3339_opts(SecondsFormat::Nanos, true);
    let state = profiles
        .set_table_path(&profile_id, table.branch(), Some(&reference), &now)
        .await
        .map_err(|error| error.to_string())?;
    Ok(CreatedBaseTable {
        state,
        path: stored.name,
    })
}

/// Таблиці дашбордів у сховищі профілю сесії (розділ «Таблиці дашбордів» вкладки «Файли»);
/// `bound` — прив'язана до якогось профілю.
#[tauri::command]
async fn workspace_files_list_tables(
    app: tauri::AppHandle,
    profiles: tauri::State<'_, LocalProfileStore>,
    session: tauri::State<'_, ProfileSession>,
    library: tauri::State<'_, LibrarySession>,
) -> Result<Vec<workspace_tables::StoredTable>, String> {
    let (_, dir, keys) = workspace_files_keys(&app, &session, &library)?;
    let dir = workspace_tables::tables_dir(&dir);
    let bound = workspace_tables::bound_ids(
        profiles
            .all_table_paths()
            .await
            .map_err(|error| error.to_string())?
            .iter()
            .map(String::as_str),
    );
    let mut items =
        tauri::async_runtime::spawn_blocking(move || workspace_tables::list(&dir, &keys))
            .await
            .map_err(|error| error.to_string())?
            .map_err(|error| error.to_string())?;
    for item in &mut items {
        item.bound = bound.contains(&item.id);
    }
    Ok(items)
}

/// «Зберегти копію…» таблиці дашборда зі сховища: розшифрована книга XLSX у місце, яке
/// обере користувач. `None` — вікно закрили.
#[tauri::command]
async fn workspace_files_export_table(
    app: tauri::AppHandle,
    profiles: tauri::State<'_, LocalProfileStore>,
    session: tauri::State<'_, ProfileSession>,
    library: tauri::State<'_, LibrarySession>,
    id: String,
) -> Result<Option<String>, String> {
    let (profile_id, dir, keys) = workspace_files_keys(&app, &session, &library)?;
    let dir = workspace_tables::tables_dir(&dir);
    let (item, _) = {
        let dir = dir.clone();
        tauri::async_runtime::spawn_blocking(move || workspace_tables::read(&dir, &keys, &id))
            .await
            .map_err(|error| error.to_string())?
            .map_err(|error| error.to_string())?
    };
    let Some(target) = library_save_dialog(
        app,
        &profiles,
        "Зберегти копію таблиці зі сховища",
        item.name.clone(),
        "xlsx".to_owned(),
    )
    .await?
    else {
        return Ok(None);
    };
    let keys = library
        .keys(&profile_id)
        .map_err(|error| error.to_string())?;
    let path = target.path.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let (_, bytes) =
            workspace_tables::read(&dir, &keys, &item.id).map_err(|error| error.to_string())?;
        phone_export::save_file(&target, &bytes).map_err(|error| error.to_string())
    })
    .await
    .map_err(|error| error.to_string())??;
    Ok(Some(path.to_string_lossy().into_owned()))
}

/// Видаляє таблицю дашборда зі сховища назавжди (разом із попередньою копією). Таблицю,
/// прив'язану до будь-якого профілю, видалити не можна: спершу її відв'язують у «Профілях».
#[tauri::command]
async fn workspace_files_delete_table(
    app: tauri::AppHandle,
    profiles: tauri::State<'_, LocalProfileStore>,
    session: tauri::State<'_, ProfileSession>,
    library: tauri::State<'_, LibrarySession>,
    id: String,
) -> Result<String, String> {
    let (_, dir, keys) = workspace_files_keys(&app, &session, &library)?;
    drop(keys);
    let dir = workspace_tables::tables_dir(&dir);
    let bound = workspace_tables::bound_ids(
        profiles
            .all_table_paths()
            .await
            .map_err(|error| error.to_string())?
            .iter()
            .map(String::as_str),
    );
    if bound.contains(&id) {
        return Err(
            "Таблиця прив'язана до профілю: спершу відв'яжіть її у вікні «Профілі»".to_owned(),
        );
    }
    tauri::async_runtime::spawn_blocking(move || workspace_tables::delete(&dir, &id))
        .await
        .map_err(|error| error.to_string())?
        .map_err(|error| error.to_string())
}

/// Видаляє профіль. Профіль із захищеною бібліотекою так не видалити: для нього є
/// окрема дія `delete_local_profile_with_library`. Поки відкрите вікно редактора, профілі
/// не видаляються.
#[tauri::command]
async fn delete_local_profile(
    app: tauri::AppHandle,
    profiles: tauri::State<'_, LocalProfileStore>,
    session: tauri::State<'_, ProfileSession>,
    library: tauri::State<'_, LibrarySession>,
    handles: tauri::State<'_, office_files::OfficeFileHandles>,
    profile_id: String,
) -> Result<LocalProfilesState, String> {
    ensure_editor_closed(&app, &handles)?;
    ensure_profile_unlocked(&profiles, &session, &profile_id).await?;
    let now = Utc::now().to_rfc3339_opts(SecondsFormat::Nanos, true);
    let state = profiles
        .delete(&profile_id, &now)
        .await
        .map_err(|error| error.to_string())?;
    lock_library_of_deleted(&session, &library, &handles, &profile_id);
    notify_library_state(&app);
    Ok(state)
}

/// Видаляє профіль разом із захищеною бібліотекою: криптознищення бібліотеки й
/// видалення профілю — однією транзакцією (`LocalProfileStore::delete_with_library`).
#[tauri::command]
async fn delete_local_profile_with_library(
    app: tauri::AppHandle,
    profiles: tauri::State<'_, LocalProfileStore>,
    session: tauri::State<'_, ProfileSession>,
    library: tauri::State<'_, LibrarySession>,
    handles: tauri::State<'_, office_files::OfficeFileHandles>,
    profile_id: String,
) -> Result<LocalProfilesState, String> {
    ensure_editor_closed(&app, &handles)?;
    ensure_profile_unlocked(&profiles, &session, &profile_id).await?;
    let now = Utc::now().to_rfc3339_opts(SecondsFormat::Nanos, true);
    let state = profiles
        .delete_with_library(&profile_id, &now)
        .await
        .map_err(|error| error.to_string())?;
    lock_library_of_deleted(&session, &library, &handles, &profile_id);
    notify_library_state(&app);
    Ok(state)
}

/// Після видалення профілю його бібліотека (якщо розблокована) блокується.
fn lock_library_of_deleted(
    session: &ProfileSession,
    library: &LibrarySession,
    handles: &office_files::OfficeFileHandles,
    profile_id: &str,
) {
    if session.get().as_deref() == Some(profile_id)
        || library.unlocked_profile().as_deref() == Some(profile_id)
    {
        lock_library(library, handles);
    }
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
            // `secure_delete`: видалені й переписані сторінки (зокрема старі обгортки ключа
            // бібліотеки) затираються нулями, а не лишаються у файлі бази.
            let options = database::live_connect_options(&setup_database_file);
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
            app.manage(ProfileSchemaStore::new(pool.clone()));
            app.manage(DashboardLayoutStore::new(pool.clone()));
            app.manage(module_source_selection::SourceSelections::default());
            app.manage(office_files::OfficeFileHandles::default());
            let collective_keys_dir = startup_recovery::or_exit(
                &dialogs,
                app.path().app_local_data_dir(),
                "Не вдалося визначити директорію даних EasyWAR",
            )
            .join("collective-keys");
            app.manage(CollectiveStore::new(pool.clone(), collective_keys_dir));
            app.manage(LibraryStore::new(pool.clone()));
            app.manage(LibrarySession::default());
            app.manage(LibraryStateEvents::default());
            let notify_app = app.handle().clone();
            app.state::<LibrarySession>()
                .set_notifier(move || notify_library_state(&notify_app));
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
            // Автоблокування бібліотеки після 30 хв без дій: перевірка щохвилини, разом із
            // ключами зникає й документ, що чекав на вікно редактора.
            let idle_app = app.handle().clone();
            tauri::async_runtime::spawn(async move {
                let mut interval = tokio::time::interval(Duration::from_secs(60));
                loop {
                    interval.tick().await;
                    let library = idle_app.state::<LibrarySession>();
                    library.lock_if_idle(office_library::IDLE_LOCK_TIMEOUT);
                    if library.unlocked_profile().is_none() {
                        idle_app
                            .state::<office_files::OfficeFileHandles>()
                            .clear_pending();
                    }
                }
            });
            Ok(())
        })
        .on_window_event(|window, event| {
            desktop_shell::on_window_event(window, event);
            if matches!(event, tauri::WindowEvent::Destroyed) {
                if let Some(selections) =
                    window.try_state::<module_source_selection::SourceSelections>()
                {
                    selections.forget_window(window.label());
                }
            }
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
            delete_dashboard_module,
            set_dashboard_module_style,
            get_profile_schema,
            save_profile_schema,
            reset_profile_schema,
            get_dashboard_layout,
            save_dashboard_layout,
            reset_dashboard_layout,
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
            office_open_file,
            office_save_file,
            office_save_file_as,
            office_close_file,
            weather_online_fetch,
            weather_online_search,
            office_editor_close,
            workspace_open_editor,
            collective_status,
            collective_create_identity,
            collective_create,
            collective_detail,
            collective_table_set,
            collective_invite_create,
            collective_join_request,
            collective_invite_admit,
            collective_join_accept,
            collective_report_prepare,
            collective_report_confirm,
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
            export_approved_xlsx_from_reference,
            delete_local_profile_with_library,
            library_status,
            library_create,
            library_unlock,
            library_lock,
            library_list,
            library_versions,
            library_import,
            library_rename,
            library_set_hidden,
            library_set_current,
            library_export_copy,
            library_export_archive,
            library_open_in_editor,
            library_read_version,
            library_search,
            library_source_data,
            library_save_generated,
            library_link_statuses,
            library_unlink,
            library_recover,
            library_reissue_recovery,
            workspace_files_list,
            workspace_files_add,
            workspace_files_delete,
            workspace_files_export,
            workspace_files_open,
            workspace_files_list_tables,
            workspace_files_export_table,
            workspace_files_delete_table,
            move_profile_database_to_store,
            create_profile_base_table_in_store
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
