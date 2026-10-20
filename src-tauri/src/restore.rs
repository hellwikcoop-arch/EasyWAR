use crate::database;
use fs2::FileExt;
use serde::Serialize;
use sha2::{Digest, Sha384};
use sqlx::{sqlite::SqliteConnectOptions, sqlite::SqlitePoolOptions};
use std::{
    collections::BTreeSet,
    ffi::OsString,
    fs::{self, File, OpenOptions},
    io::{self, Write},
    path::{Path, PathBuf},
    thread,
    time::{Duration, Instant},
};
use tempfile::NamedTempFile;

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
pub struct BackupInspection {
    pub schema_version: i64,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum RestoreStartupOutcome {
    None,
    Applied,
    RolledBack,
    Failed,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RestoreStartupReport {
    pub outcome: RestoreStartupOutcome,
    pub schema_version: Option<i64>,
    pub pending_restore_available: bool,
    pub previous_backup_retained: bool,
    pub detail: Option<String>,
}

pub struct ApplicationInstanceLock {
    _file: File,
}

#[derive(Debug, thiserror::Error)]
pub enum RestoreInspectionError {
    #[error("оберіть файл резервної копії SQLite")]
    InvalidFile,
    #[error("шлях локальної бази EasyWAR має бути абсолютним")]
    InvalidTarget,
    #[error("підготовлена копія вже існує; спочатку заверште або скасуйте попереднє відновлення")]
    PendingAlreadyExists,
    #[error("підготовленої копії для відновлення немає")]
    PendingMissing,
    #[error("відновлення вже підтверджено й очікує перезапуску")]
    RestoreAlreadyRequested,
    #[error("службовий файл відновлення має некоректний тип")]
    InvalidRestoreControlFile,
    #[error("EasyWAR уже запущено; відновлення в іншому екземплярі заборонено")]
    AnotherInstanceRunning,
    #[error("поточна база відсутня або не є звичайним файлом")]
    InvalidLiveDatabase,
    #[error("попередня база вже збережена; нове відновлення заблоковано")]
    PreviousBackupExists,
    #[error("попередньої бази для завершення відновлення немає")]
    PreviousBackupMissing,
    #[error("поточна база має супровідні файли WAL/SHM/journal; заміна заборонена")]
    LiveSidecarsPresent,
    #[error("нова база не пройшла перевірку; попередню базу збережено: {0}")]
    RestoredDatabaseInvalid(String),
    #[error("не вдалося повернути попередню базу після помилки: заміна: {0}; відкат: {1}")]
    RollbackFailed(io::Error, io::Error),
    #[error("копія має супровідні файли WAL/SHM/journal і не є самодостатньою")]
    SidecarsPresent,
    #[error("файл SQLite не пройшов перевірку цілісності")]
    IntegrityCheckFailed,
    #[error("у копії порушено зв'язки між записами")]
    ForeignKeyViolation,
    #[error("це не резервна копія EasyWAR: відсутня історія міграцій")]
    MissingMigrationHistory,
    #[error("версія схеми копії не підтримується цим застосунком")]
    UnsupportedSchema,
    #[error("контрольна сума міграції не відповідає EasyWAR")]
    MigrationMismatch,
    #[error("у копії бракує обов'язкових об'єктів схеми EasyWAR (таблиць, подань або тригерів захисту історії): {0}")]
    MissingSchemaObjects(String),
    #[error("не вдалося прочитати файл копії: {0}")]
    Io(#[from] io::Error),
    #[error("не вдалося перевірити SQLite-копію: {0}")]
    Database(#[from] sqlx::Error),
}

/// Keep the candidate in the same directory/filesystem as the live database.
/// This is only a staging path; startup must never apply it implicitly.
pub fn staged_backup_path(live_database: &Path) -> Result<PathBuf, RestoreInspectionError> {
    sibling_path(live_database, ".restore-pending")
}

pub fn previous_backup_path(live_database: &Path) -> Result<PathBuf, RestoreInspectionError> {
    sibling_path(live_database, ".restore-previous")
}

pub fn restore_request_path(live_database: &Path) -> Result<PathBuf, RestoreInspectionError> {
    sibling_path(live_database, ".restore-requested")
}

fn instance_lock_path(live_database: &Path) -> Result<PathBuf, RestoreInspectionError> {
    sibling_path(live_database, ".instance-lock")
}

fn sibling_path(live_database: &Path, suffix: &str) -> Result<PathBuf, RestoreInspectionError> {
    if !live_database.is_absolute() || live_database.file_name().is_none() {
        return Err(RestoreInspectionError::InvalidTarget);
    }
    let mut name: OsString = live_database.file_name().unwrap().to_owned();
    name.push(suffix);
    Ok(live_database.with_file_name(name))
}

pub fn acquire_application_instance_lock(
    live_database: &Path,
) -> Result<ApplicationInstanceLock, RestoreInspectionError> {
    acquire_application_instance_lock_with_timeout(live_database, Duration::from_secs(5))
}

/// Let SQLite finish its own crash recovery for the live database before the
/// startup checks inspect it as a standalone file.
///
/// An EasyWAR process that quit or crashed in the middle of a write leaves an
/// `-journal` (or `-wal`/`-shm`) file next to the database. SQLite applies
/// that file when the database is next opened for writing: it rolls back an
/// unfinished transaction or folds committed WAL frames into the file. The
/// sidecar is then removed when the only connection closes.
///
/// The instance lock proves that no other EasyWAR process has the database
/// open. Sidecars without a live database are never applied to a new file.
pub async fn recover_live_sidecars(
    live_database: &Path,
    _instance: &ApplicationInstanceLock,
) -> Result<bool, RestoreInspectionError> {
    if !live_database.is_absolute() || live_database.file_name().is_none() {
        return Err(RestoreInspectionError::InvalidTarget);
    }
    if !has_sidecars(live_database)? {
        return Ok(false);
    }
    if !fs::symlink_metadata(live_database).is_ok_and(|metadata| metadata.file_type().is_file()) {
        return Err(RestoreInspectionError::LiveSidecarsPresent);
    }
    for sidecar in sidecar_paths(live_database) {
        if let Ok(metadata) = fs::symlink_metadata(&sidecar) {
            if !metadata.file_type().is_file() {
                return Err(RestoreInspectionError::InvalidRestoreControlFile);
            }
        }
    }

    let pool = SqlitePoolOptions::new()
        .max_connections(1)
        .connect_with(SqliteConnectOptions::new().filename(live_database))
        .await?;
    let recovered = async {
        // Reading the schema triggers hot-journal rollback / WAL recovery.
        sqlx::query_scalar::<_, i64>("SELECT count(*) FROM sqlite_master")
            .fetch_one(&pool)
            .await?;
        let journal_mode: String = sqlx::query_scalar("PRAGMA journal_mode")
            .fetch_one(&pool)
            .await?;
        if journal_mode.eq_ignore_ascii_case("wal") {
            sqlx::query("PRAGMA wal_checkpoint(TRUNCATE)")
                .execute(&pool)
                .await?;
        } else if has_sidecars(live_database)? {
            // A journal whose header was never synced is not "hot": the
            // database file was not written yet, so SQLite ignores it until
            // the next write transaction replaces and deletes it. Run a no-op
            // write (same user_version) so that happens now.
            let version: i64 = sqlx::query_scalar("PRAGMA user_version")
                .fetch_one(&pool)
                .await?;
            sqlx::query(&format!("PRAGMA user_version = {version}"))
                .execute(&pool)
                .await?;
        }
        Ok::<_, RestoreInspectionError>(())
    }
    .await;
    pool.close().await;
    recovered?;

    if has_sidecars(live_database)? {
        return Err(RestoreInspectionError::LiveSidecarsPresent);
    }
    Ok(true)
}

fn acquire_application_instance_lock_with_timeout(
    live_database: &Path,
    timeout: Duration,
) -> Result<ApplicationInstanceLock, RestoreInspectionError> {
    let parent = live_database
        .parent()
        .ok_or(RestoreInspectionError::InvalidTarget)?;
    fs::create_dir_all(parent)?;
    let lock_path = instance_lock_path(live_database)?;
    if let Ok(metadata) = fs::symlink_metadata(&lock_path) {
        if !metadata.file_type().is_file() {
            return Err(RestoreInspectionError::InvalidRestoreControlFile);
        }
    }
    let file = OpenOptions::new()
        .create(true)
        .truncate(false)
        .read(true)
        .write(true)
        .open(lock_path)?;
    let started = Instant::now();
    loop {
        match file.try_lock_exclusive() {
            Ok(()) => return Ok(ApplicationInstanceLock { _file: file }),
            Err(error) if error.kind() == io::ErrorKind::WouldBlock => {
                if started.elapsed() >= timeout {
                    return Err(RestoreInspectionError::AnotherInstanceRunning);
                }
                thread::sleep(Duration::from_millis(25));
            }
            Err(error) => return Err(RestoreInspectionError::Io(error)),
        }
    }
}

#[derive(Debug, Eq, PartialEq)]
pub enum OfflineRestoreState {
    NoInterruptedSwap,
    RolledBack,
    AppliedWithPreviousCopy,
}

/// Recover the rename gap before any SQLite pool opens. This does not retry a
/// pending restore: if the previous file exists and live is missing, it puts
/// the previous file back and leaves the staged candidate untouched.
/// Caller must hold an exclusive app-instance lock before using this in-app.
pub async fn recover_interrupted_swap(
    live_database: &Path,
) -> Result<OfflineRestoreState, RestoreInspectionError> {
    let previous = previous_backup_path(live_database)?;
    if !path_exists(&previous)? {
        return Ok(OfflineRestoreState::NoInterruptedSwap);
    }
    if !fs::symlink_metadata(&previous)?.file_type().is_file() {
        return Err(RestoreInspectionError::PreviousBackupExists);
    }
    if path_exists(live_database)? {
        inspect_backup(live_database)
            .await
            .map_err(|error| RestoreInspectionError::RestoredDatabaseInvalid(error.to_string()))?;
        return Ok(OfflineRestoreState::AppliedWithPreviousCopy);
    }
    fs::rename(&previous, live_database)?;
    sync_parent(live_database)?;
    Ok(OfflineRestoreState::RolledBack)
}

/// Swap only after every SQLite connection is closed and one app instance has
/// an exclusive lock. Desktop startup calls this only for an explicitly
/// requested restore, before Tauri or any SQLite pool starts. Both renames are
/// in the same directory; a previous database is retained for manual recovery.
pub async fn swap_staged_backup_offline(
    live_database: &Path,
) -> Result<BackupInspection, RestoreInspectionError> {
    let staged = staged_backup_path(live_database)?;
    let previous = previous_backup_path(live_database)?;
    if path_exists(&previous)? {
        return Err(RestoreInspectionError::PreviousBackupExists);
    }
    if !fs::symlink_metadata(live_database).is_ok_and(|metadata| metadata.file_type().is_file()) {
        return Err(RestoreInspectionError::InvalidLiveDatabase);
    }
    if has_sidecars(live_database)? {
        return Err(RestoreInspectionError::LiveSidecarsPresent);
    }
    let inspection = inspect_backup(&staged).await?;

    fs::rename(live_database, &previous)?;
    if let Err(error) = sync_parent(live_database) {
        return rollback_rename(live_database, &previous, error);
    }
    if let Err(error) = fs::rename(&staged, live_database) {
        return rollback_rename(live_database, &previous, error);
    }
    sync_parent(live_database)?;
    Ok(inspection)
}

pub async fn request_staged_restore(
    live_database: &Path,
) -> Result<BackupInspection, RestoreInspectionError> {
    let previous = previous_backup_path(live_database)?;
    if path_exists(&previous)? {
        return Err(RestoreInspectionError::PreviousBackupExists);
    }
    let staged = staged_backup_path(live_database)?;
    if !fs::symlink_metadata(&staged).is_ok_and(|metadata| metadata.file_type().is_file()) {
        return Err(RestoreInspectionError::PendingMissing);
    }
    let inspection = inspect_backup(&staged).await?;
    let request = restore_request_path(live_database)?;
    let parent = request
        .parent()
        .ok_or(RestoreInspectionError::InvalidTarget)?;
    let mut marker = NamedTempFile::new_in(parent)?;
    marker.write_all(b"easywar-restore-v1\n")?;
    marker.as_file_mut().sync_all()?;
    match marker.persist_noclobber(&request) {
        Ok(_) => sync_parent(&request)?,
        Err(error) if error.error.kind() == io::ErrorKind::AlreadyExists => {
            return Err(RestoreInspectionError::RestoreAlreadyRequested)
        }
        Err(error) => return Err(error.error.into()),
    }
    Ok(inspection)
}

pub fn cancel_staged_restore(live_database: &Path) -> Result<(), RestoreInspectionError> {
    if restore_requested(live_database)? {
        return Err(RestoreInspectionError::RestoreAlreadyRequested);
    }
    let staged = staged_backup_path(live_database)?;
    if !path_exists(&staged)? {
        return Err(RestoreInspectionError::PendingMissing);
    }
    if !fs::symlink_metadata(&staged)?.file_type().is_file() {
        return Err(RestoreInspectionError::InvalidRestoreControlFile);
    }
    fs::remove_file(&staged)?;
    sync_parent(&staged)?;
    Ok(())
}

pub async fn finalize_previous_backup(live_database: &Path) -> Result<(), RestoreInspectionError> {
    let previous = previous_backup_path(live_database)?;
    if !path_exists(&previous)? {
        return Err(RestoreInspectionError::PreviousBackupMissing);
    }
    if !fs::symlink_metadata(&previous)?.file_type().is_file() {
        return Err(RestoreInspectionError::InvalidRestoreControlFile);
    }
    inspect_backup(live_database).await?;
    inspect_backup(&previous).await?;
    fs::remove_file(&previous)?;
    sync_parent(&previous)?;
    Ok(())
}

pub async fn process_requested_restore(
    live_database: &Path,
) -> Result<RestoreStartupReport, RestoreInspectionError> {
    let recovery = recover_interrupted_swap(live_database).await?;
    if recovery == OfflineRestoreState::RolledBack {
        remove_restore_request(live_database)?;
        return Ok(RestoreStartupReport {
            outcome: RestoreStartupOutcome::RolledBack,
            schema_version: inspect_backup(live_database)
                .await
                .ok()
                .map(|inspection| inspection.schema_version),
            pending_restore_available: path_exists(&staged_backup_path(live_database)?)?,
            previous_backup_retained: false,
            detail: None,
        });
    }

    if !restore_requested(live_database)? {
        return Ok(RestoreStartupReport {
            outcome: if recovery == OfflineRestoreState::AppliedWithPreviousCopy {
                RestoreStartupOutcome::Applied
            } else {
                RestoreStartupOutcome::None
            },
            schema_version: if recovery == OfflineRestoreState::AppliedWithPreviousCopy {
                Some(inspect_backup(live_database).await?.schema_version)
            } else {
                None
            },
            pending_restore_available: path_exists(&staged_backup_path(live_database)?)?,
            previous_backup_retained: recovery == OfflineRestoreState::AppliedWithPreviousCopy,
            detail: None,
        });
    }

    if recovery == OfflineRestoreState::AppliedWithPreviousCopy {
        remove_restore_request(live_database)?;
        return Ok(RestoreStartupReport {
            outcome: RestoreStartupOutcome::Applied,
            schema_version: Some(inspect_backup(live_database).await?.schema_version),
            pending_restore_available: false,
            previous_backup_retained: true,
            detail: None,
        });
    }

    match swap_staged_backup_offline(live_database).await {
        Ok(inspection) => {
            remove_restore_request(live_database)?;
            Ok(RestoreStartupReport {
                outcome: RestoreStartupOutcome::Applied,
                schema_version: Some(inspection.schema_version),
                pending_restore_available: false,
                previous_backup_retained: true,
                detail: None,
            })
        }
        Err(error) => {
            remove_restore_request(live_database)?;
            if let Ok(inspection) = inspect_backup(live_database).await {
                Ok(RestoreStartupReport {
                    outcome: RestoreStartupOutcome::Failed,
                    schema_version: Some(inspection.schema_version),
                    pending_restore_available: path_exists(&staged_backup_path(live_database)?)?,
                    previous_backup_retained: path_exists(&previous_backup_path(live_database)?)?,
                    detail: Some(error.to_string()),
                })
            } else {
                Err(error)
            }
        }
    }
}

fn restore_requested(live_database: &Path) -> Result<bool, RestoreInspectionError> {
    let request = restore_request_path(live_database)?;
    if !path_exists(&request)? {
        return Ok(false);
    }
    if !fs::symlink_metadata(&request)?.file_type().is_file() {
        return Err(RestoreInspectionError::InvalidRestoreControlFile);
    }
    if fs::read(&request)? != b"easywar-restore-v1\n" {
        return Err(RestoreInspectionError::InvalidRestoreControlFile);
    }
    Ok(true)
}

fn remove_restore_request(live_database: &Path) -> Result<(), RestoreInspectionError> {
    let request = restore_request_path(live_database)?;
    if !path_exists(&request)? {
        return Ok(());
    }
    if !fs::symlink_metadata(&request)?.file_type().is_file() {
        return Err(RestoreInspectionError::InvalidRestoreControlFile);
    }
    fs::remove_file(&request)?;
    sync_parent(&request)?;
    Ok(())
}

fn rollback_rename<T>(
    live_database: &Path,
    previous: &Path,
    error: io::Error,
) -> Result<T, RestoreInspectionError> {
    match fs::rename(previous, live_database) {
        Ok(()) => {
            sync_parent(live_database)?;
            Err(RestoreInspectionError::Io(error))
        }
        Err(rollback_error) => Err(RestoreInspectionError::RollbackFailed(
            error,
            rollback_error,
        )),
    }
}

fn path_exists(path: &Path) -> Result<bool, io::Error> {
    match fs::symlink_metadata(path) {
        Ok(_) => Ok(true),
        Err(error) if error.kind() == io::ErrorKind::NotFound => Ok(false),
        Err(error) => Err(error),
    }
}

fn sidecar_paths(path: &Path) -> impl Iterator<Item = PathBuf> + '_ {
    ["-wal", "-shm", "-journal"].into_iter().map(move |suffix| {
        let mut sidecar: OsString = path.as_os_str().to_owned();
        sidecar.push(suffix);
        PathBuf::from(sidecar)
    })
}

fn has_sidecars(path: &Path) -> Result<bool, io::Error> {
    for sidecar in sidecar_paths(path) {
        if path_exists(&sidecar)? {
            return Ok(true);
        }
    }
    Ok(false)
}

fn sync_parent(path: &Path) -> Result<(), io::Error> {
    #[cfg(unix)]
    File::open(path.parent().ok_or(io::Error::other("missing parent"))?)?.sync_all()?;
    #[cfg(not(unix))]
    let _ = path;
    Ok(())
}

/// Make a separately validated, non-overwriting copy for a future offline
/// restore. Neither the live database nor the selected source is changed.
/// The caller must not interpret a staged file as authorization to apply it.
pub async fn stage_backup(
    source: &Path,
    live_database: &Path,
) -> Result<BackupInspection, RestoreInspectionError> {
    if path_exists(&previous_backup_path(live_database)?)? {
        return Err(RestoreInspectionError::PreviousBackupExists);
    }
    if restore_requested(live_database)? {
        return Err(RestoreInspectionError::RestoreAlreadyRequested);
    }
    let staged = staged_backup_path(live_database)?;
    if staged.symlink_metadata().is_ok() {
        return Err(RestoreInspectionError::PendingAlreadyExists);
    }
    let inspection = inspect_backup(source).await?;
    let parent = live_database
        .parent()
        .ok_or(RestoreInspectionError::InvalidTarget)?
        .to_owned();
    let source = source.to_owned();
    let temporary =
        tauri::async_runtime::spawn_blocking(move || -> Result<NamedTempFile, io::Error> {
            let mut input = File::open(source)?;
            let mut temporary = NamedTempFile::new_in(parent)?;
            io::copy(&mut input, temporary.as_file_mut())?;
            temporary.as_file_mut().sync_all()?;
            Ok(temporary)
        })
        .await
        .map_err(|error| io::Error::other(error.to_string()))??;

    // Verify the copied bytes too: the selected file may change mid-copy.
    let copied_inspection = inspect_backup(temporary.path()).await?;
    if copied_inspection != inspection {
        return Err(RestoreInspectionError::UnsupportedSchema);
    }
    match temporary.persist_noclobber(&staged) {
        Ok(_) => Ok(copied_inspection),
        Err(error) if error.error.kind() == io::ErrorKind::AlreadyExists => {
            Err(RestoreInspectionError::PendingAlreadyExists)
        }
        Err(error) => Err(RestoreInspectionError::Io(error.error)),
    }
}

/// Inspect an offline, standalone backup without writing to the source file.
/// This is a preflight only: it never stages or applies a restore.
pub async fn inspect_backup(path: &Path) -> Result<BackupInspection, RestoreInspectionError> {
    if !path.is_absolute() || !std::fs::metadata(path).is_ok_and(|metadata| metadata.is_file()) {
        return Err(RestoreInspectionError::InvalidFile);
    }
    let path = std::fs::canonicalize(path)?;
    if has_sidecars(&path)? {
        return Err(RestoreInspectionError::SidecarsPresent);
    }

    let pool = SqlitePoolOptions::new()
        .max_connections(1)
        .connect_with(
            SqliteConnectOptions::new()
                .filename(&path)
                .read_only(true)
                .immutable(true),
        )
        .await?;
    let result = inspect_pool(&pool).await;
    pool.close().await;
    result
}

async fn inspect_pool(pool: &sqlx::SqlitePool) -> Result<BackupInspection, RestoreInspectionError> {
    let integrity: Vec<String> = sqlx::query_scalar("PRAGMA integrity_check")
        .fetch_all(pool)
        .await?;
    if integrity != ["ok"] {
        return Err(RestoreInspectionError::IntegrityCheckFailed);
    }
    if sqlx::query("PRAGMA foreign_key_check")
        .fetch_optional(pool)
        .await?
        .is_some()
    {
        return Err(RestoreInspectionError::ForeignKeyViolation);
    }

    let history_exists: i64 = sqlx::query_scalar(
        "SELECT count(*) FROM sqlite_master WHERE type = 'table' AND name = '_sqlx_migrations'",
    )
    .fetch_one(pool)
    .await?;
    if history_exists != 1 {
        return Err(RestoreInspectionError::MissingMigrationHistory);
    }

    let applied: Vec<(i64, i64, Vec<u8>)> =
        sqlx::query_as("SELECT version, success, checksum FROM _sqlx_migrations ORDER BY version")
            .fetch_all(pool)
            .await?;
    let expected = database::migrations();
    if applied.is_empty() || applied.len() > expected.len() {
        return Err(RestoreInspectionError::UnsupportedSchema);
    }
    for (actual, known) in applied.iter().zip(expected.iter()) {
        if actual.0 != known.version || actual.1 != 1 {
            return Err(RestoreInspectionError::UnsupportedSchema);
        }
        if actual.2 != Sha384::digest(known.sql.as_bytes()).as_slice() {
            return Err(RestoreInspectionError::MigrationMismatch);
        }
    }

    // Версії міграцій збігаються з префіксом вбудованого списку (перевірено вище), тож
    // обов'язкові об'єкти — це те, що створюють рівно `applied.len()` перших міграцій.
    let required_sql: Vec<&'static str> = expected
        .iter()
        .take(applied.len())
        .map(|migration| migration.sql)
        .collect();
    let required = expected_schema_objects(required_sql).await?;
    let present = schema_objects(pool).await?;
    let missing: Vec<&SchemaObject> = required.difference(&present).collect();
    if !missing.is_empty() {
        return Err(RestoreInspectionError::MissingSchemaObjects(
            describe_missing(&missing),
        ));
    }

    Ok(BackupInspection {
        schema_version: applied.last().unwrap().0,
    })
}

/// Об'єкт схеми SQLite: `(тип, ім'я)` з `sqlite_master`; тип — `table`, `view` або `trigger`.
type SchemaObject = (String, String);

/// Скільки відсутніх об'єктів називає повідомлення про помилку.
const MISSING_OBJECTS_SHOWN: usize = 6;

/// Таблиці, подання й тригери, які створюють саме ці міграції: у тому числі тригери незмінності
/// провенансу (`*_no_update`/`*_no_delete` з 0001 і 0002). Міграції по черзі застосовуються до
/// порожньої бази в пам'яті (на диск нічого не пишеться), тож перелік завжди збігається з реальними
/// файлами `src-tauri/migrations` для версії схеми копії, а нова міграція не потребує ручного
/// оновлення. Порівнюються імена; індекси, стовпці й тіла тригерів не перевіряються.
async fn expected_schema_objects(
    migrations_sql: Vec<&'static str>,
) -> Result<BTreeSet<SchemaObject>, RestoreInspectionError> {
    let pool = SqlitePoolOptions::new()
        .max_connections(1)
        .connect("sqlite::memory:")
        .await?;
    let objects = reference_schema_objects(&pool, migrations_sql).await;
    pool.close().await;
    Ok(objects?)
}

async fn reference_schema_objects(
    pool: &sqlx::SqlitePool,
    migrations_sql: Vec<&'static str>,
) -> Result<BTreeSet<SchemaObject>, sqlx::Error> {
    for sql in migrations_sql {
        sqlx::raw_sql(sql).execute(pool).await?;
    }
    schema_objects(pool).await
}

/// Таблиці, подання й тригери бази без службових (`sqlite_*`).
async fn schema_objects(pool: &sqlx::SqlitePool) -> Result<BTreeSet<SchemaObject>, sqlx::Error> {
    let rows: Vec<SchemaObject> = sqlx::query_as(
        "SELECT type, name FROM sqlite_master
         WHERE type IN ('table', 'view', 'trigger') AND substr(name, 1, 7) != 'sqlite_'",
    )
    .fetch_all(pool)
    .await?;
    Ok(rows.into_iter().collect())
}

fn describe_missing(missing: &[&SchemaObject]) -> String {
    let mut parts: Vec<String> = missing
        .iter()
        .take(MISSING_OBJECTS_SHOWN)
        .map(|(kind, name)| {
            let label = match kind.as_str() {
                "table" => "таблиця",
                "view" => "подання",
                _ => "тригер",
            };
            format!("{label} {name}")
        })
        .collect();
    if missing.len() > MISSING_OBJECTS_SHOWN {
        parts.push(format!("та ще {}", missing.len() - MISSING_OBJECTS_SHOWN));
    }
    parts.join(", ")
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{backup::BackupStore, database};
    use sqlx::SqlitePool;

    async fn synthetic_database(path: &Path) -> SqlitePool {
        synthetic_database_at(path, database::migrations().len()).await
    }

    /// База, до якої застосовано лише перші `migration_count` міграцій (схема тієї версії).
    async fn synthetic_database_at(path: &Path, migration_count: usize) -> SqlitePool {
        let pool = SqlitePoolOptions::new()
            .max_connections(1)
            .connect_with(
                SqliteConnectOptions::new()
                    .filename(path)
                    .create_if_missing(true),
            )
            .await
            .unwrap();
        sqlx::query(
            "CREATE TABLE _sqlx_migrations (
                version BIGINT PRIMARY KEY, description TEXT NOT NULL,
                installed_on TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
                success BOOLEAN NOT NULL, checksum BLOB NOT NULL,
                execution_time BIGINT NOT NULL)",
        )
        .execute(&pool)
        .await
        .unwrap();
        for migration in database::migrations().into_iter().take(migration_count) {
            sqlx::raw_sql(migration.sql).execute(&pool).await.unwrap();
            sqlx::query(
                "INSERT INTO _sqlx_migrations
                 (version, description, success, checksum, execution_time)
                 VALUES ($1, $2, 1, $3, 0)",
            )
            .bind(migration.version)
            .bind(migration.description)
            .bind(Sha384::digest(migration.sql.as_bytes()).to_vec())
            .execute(&pool)
            .await
            .unwrap();
        }
        pool
    }

    #[tokio::test]
    async fn accepts_synthetic_app_backup_without_modifying_it() {
        let dir = tempfile::tempdir().unwrap();
        let source = dir.path().join("synthetic.sqlite3");
        let pool = synthetic_database(&source).await;
        let backup = dir.path().join("backup.sqlite3");
        BackupStore::new(pool.clone())
            .create_at(&backup)
            .await
            .unwrap();
        pool.close().await;
        let before = std::fs::read(&backup).unwrap();

        assert_eq!(
            inspect_backup(&backup).await.unwrap(),
            BackupInspection { schema_version: 12 }
        );
        assert_eq!(std::fs::read(&backup).unwrap(), before);
    }

    #[tokio::test]
    async fn rejects_changed_migration_checksum() {
        let dir = tempfile::tempdir().unwrap();
        let source = dir.path().join("synthetic.sqlite3");
        let pool = synthetic_database(&source).await;
        sqlx::query("UPDATE _sqlx_migrations SET checksum = $1 WHERE version = 1")
            .bind(vec![0_u8; 48])
            .execute(&pool)
            .await
            .unwrap();
        pool.close().await;

        assert!(matches!(
            inspect_backup(&source).await,
            Err(RestoreInspectionError::MigrationMismatch)
        ));
    }

    #[tokio::test]
    async fn rejects_unrelated_or_incomplete_sqlite() {
        let dir = tempfile::tempdir().unwrap();
        let unrelated = dir.path().join("unrelated.sqlite3");
        let pool = SqlitePoolOptions::new()
            .max_connections(1)
            .connect_with(
                SqliteConnectOptions::new()
                    .filename(&unrelated)
                    .create_if_missing(true),
            )
            .await
            .unwrap();
        sqlx::query("CREATE TABLE unrelated (id INTEGER)")
            .execute(&pool)
            .await
            .unwrap();
        pool.close().await;
        assert!(matches!(
            inspect_backup(&unrelated).await,
            Err(RestoreInspectionError::MissingMigrationHistory)
        ));
    }

    #[tokio::test]
    async fn rejects_backup_with_foreign_key_violation() {
        let dir = tempfile::tempdir().unwrap();
        let source = dir.path().join("synthetic.sqlite3");
        let pool = synthetic_database(&source).await;
        sqlx::query("PRAGMA foreign_keys = OFF")
            .execute(&pool)
            .await
            .unwrap();
        sqlx::query(
            "INSERT INTO reports (id, raw_source_id, source_item_key, created_at)
             VALUES ('report-synthetic', 'missing-source', 'item', '2026-01-01T00:00:00Z')",
        )
        .execute(&pool)
        .await
        .unwrap();
        pool.close().await;

        assert!(matches!(
            inspect_backup(&source).await,
            Err(RestoreInspectionError::ForeignKeyViolation)
        ));
    }

    #[tokio::test]
    async fn rejects_newer_migration_and_missing_required_table() {
        let dir = tempfile::tempdir().unwrap();
        let source = dir.path().join("synthetic.sqlite3");
        let pool = synthetic_database(&source).await;
        sqlx::query("UPDATE _sqlx_migrations SET version = 99 WHERE version = 1")
            .execute(&pool)
            .await
            .unwrap();
        pool.close().await;
        assert!(matches!(
            inspect_backup(&source).await,
            Err(RestoreInspectionError::UnsupportedSchema)
        ));

        let second = dir.path().join("missing-table.sqlite3");
        let pool = synthetic_database(&second).await;
        sqlx::query("DROP TABLE settings")
            .execute(&pool)
            .await
            .unwrap();
        pool.close().await;
        assert!(matches!(
            inspect_backup(&second).await,
            Err(RestoreInspectionError::MissingSchemaObjects(_))
        ));

        let third = dir.path().join("missing-v2-table.sqlite3");
        let pool = synthetic_database(&third).await;
        sqlx::query("DROP TABLE xlsx_row_fingerprints")
            .execute(&pool)
            .await
            .unwrap();
        pool.close().await;
        assert!(matches!(
            inspect_backup(&third).await,
            Err(RestoreInspectionError::MissingSchemaObjects(_))
        ));

        let fourth = dir.path().join("missing-v3-table.sqlite3");
        let pool = synthetic_database(&fourth).await;
        sqlx::query("DROP TABLE local_profile_state")
            .execute(&pool)
            .await
            .unwrap();
        pool.close().await;
        assert!(matches!(
            inspect_backup(&fourth).await,
            Err(RestoreInspectionError::MissingSchemaObjects(_))
        ));

        let fifth = dir.path().join("missing-v4-table.sqlite3");
        let pool = synthetic_database(&fifth).await;
        sqlx::query("DROP TABLE local_profile_workspace_templates")
            .execute(&pool)
            .await
            .unwrap();
        pool.close().await;
        assert!(matches!(
            inspect_backup(&fifth).await,
            Err(RestoreInspectionError::MissingSchemaObjects(_))
        ));
    }

    /// Створює базу схеми `migration_count`, застосовує до неї `damage` і повертає результат перевірки.
    async fn inspect_damaged(
        directory: &Path,
        name: &str,
        migration_count: usize,
        damage: &[impl AsRef<str>],
    ) -> Result<BackupInspection, RestoreInspectionError> {
        let path = directory.join(format!("{name}.sqlite3"));
        let pool = synthetic_database_at(&path, migration_count).await;
        // Без перевірки зовнішніх ключів `DROP` не залежить від порядку таблиць.
        sqlx::query("PRAGMA foreign_keys = OFF")
            .execute(&pool)
            .await
            .unwrap();
        for statement in damage {
            sqlx::query(statement.as_ref())
                .execute(&pool)
                .await
                .unwrap();
        }
        pool.close().await;
        inspect_backup(&path).await
    }

    fn missing_message(result: Result<BackupInspection, RestoreInspectionError>) -> String {
        match result {
            Err(error @ RestoreInspectionError::MissingSchemaObjects(_)) => error.to_string(),
            other => panic!("очікувалась відсутність об'єктів схеми, отримано {other:?}"),
        }
    }

    #[tokio::test]
    async fn accepts_a_complete_database_of_every_schema_version() {
        let dir = tempfile::tempdir().unwrap();
        for (index, migration) in database::migrations().iter().enumerate() {
            let path = dir.path().join(format!("v{}.sqlite3", migration.version));
            synthetic_database_at(&path, index + 1).await.close().await;
            assert_eq!(
                inspect_backup(&path).await.unwrap(),
                BackupInspection {
                    schema_version: migration.version
                },
                "схема v{}",
                migration.version
            );
        }
    }

    #[tokio::test]
    async fn rejects_a_current_database_that_lacks_a_table_added_after_schema_v4() {
        let dir = tempfile::tempdir().unwrap();
        let current = database::migrations().len();
        for table in [
            "local_profile_details",
            "local_profile_tables",
            "local_profile_modules",
            "dashboard_modules",
            "dashboard_module_fields",
            "dashboard_module_corrections",
        ] {
            let message = missing_message(
                inspect_damaged(
                    dir.path(),
                    table,
                    current,
                    &[&format!("DROP TABLE {table}")],
                )
                .await,
            );
            assert!(
                message.contains(&format!("таблиця {table}")),
                "{table}: {message}"
            );
        }
    }

    #[tokio::test]
    async fn rejects_a_database_that_lacks_a_table_of_its_own_older_version() {
        let dir = tempfile::tempdir().unwrap();
        for (table, migration_count) in [
            ("xlsx_row_fingerprints", 2),
            ("local_profile_state", 3),
            ("local_profile_workspace_templates", 4),
            ("local_profile_details", 5),
            ("local_profile_tables", 8),
            ("local_profile_modules", 9),
            ("dashboard_modules", 10),
        ] {
            let message = missing_message(
                inspect_damaged(
                    dir.path(),
                    &format!("{table}-v{migration_count}"),
                    migration_count,
                    &[&format!("DROP TABLE {table}")],
                )
                .await,
            );
            assert!(message.contains(table), "{table}: {message}");
        }
    }

    #[tokio::test]
    async fn rejects_a_database_without_a_provenance_protecting_trigger() {
        let dir = tempfile::tempdir().unwrap();
        let current = database::migrations().len();
        for trigger in [
            "raw_sources_no_update",
            "reports_no_delete",
            "parsed_versions_no_update",
            "corrections_no_delete",
            "review_decisions_no_update",
            "revision_history_no_delete",
            "audit_log_no_update",
            "xlsx_row_fingerprints_no_update",
            "xlsx_row_fingerprints_no_delete",
        ] {
            let message = missing_message(
                inspect_damaged(
                    dir.path(),
                    trigger,
                    current,
                    &[&format!("DROP TRIGGER {trigger}")],
                )
                .await,
            );
            assert!(
                message.contains(&format!("тригер {trigger}")),
                "{trigger}: {message}"
            );
        }
        // Тригери 0001 обов'язкові й для найстарішої схеми, тригери 0002 — від v2.
        assert!(matches!(
            inspect_damaged(
                dir.path(),
                "v1-trigger",
                1,
                &["DROP TRIGGER audit_log_no_delete"]
            )
            .await,
            Err(RestoreInspectionError::MissingSchemaObjects(_))
        ));
        assert!(matches!(
            inspect_damaged(
                dir.path(),
                "v2-trigger",
                2,
                &["DROP TRIGGER xlsx_row_fingerprints_no_delete"]
            )
            .await,
            Err(RestoreInspectionError::MissingSchemaObjects(_))
        ));
    }

    #[tokio::test]
    async fn names_the_first_missing_objects_and_counts_the_rest() {
        let dir = tempfile::tempdir().unwrap();
        // Три таблиці разом зі своїми шістьма тригерами: 9 відсутніх об'єктів, названо 6.
        let message = missing_message(
            inspect_damaged(
                dir.path(),
                "many-missing",
                database::migrations().len(),
                &[
                    "DROP TABLE raw_sources",
                    "DROP TABLE reports",
                    "DROP TABLE parsed_report_versions",
                ],
            )
            .await,
        );
        assert!(message.contains("таблиця raw_sources"), "{message}");
        assert!(message.contains("таблиця reports"), "{message}");
        assert!(
            message.contains("таблиця parsed_report_versions"),
            "{message}"
        );
        assert!(message.ends_with("та ще 3"), "{message}");
    }

    #[tokio::test]
    async fn a_newer_backup_is_still_rejected_and_extra_tables_are_still_accepted() {
        let dir = tempfile::tempdir().unwrap();
        let newer = database::migrations().len() as i64 + 1;
        let result = inspect_damaged(
            dir.path(),
            "newer",
            database::migrations().len(),
            &[&format!(
                "INSERT INTO _sqlx_migrations (version, description, success, checksum, execution_time)
                 VALUES ({newer}, 'synthetic future', 1, x'00', 0)"
            )],
        )
        .await;
        assert!(matches!(
            result,
            Err(RestoreInspectionError::UnsupportedSchema)
        ));

        // Таблиці, які застосунок створює під час роботи поза міграціями, не заважають.
        let result = inspect_damaged(
            dir.path(),
            "extra-table",
            database::migrations().len(),
            &["CREATE TABLE dashboard_data_deadbeef (id INTEGER PRIMARY KEY)"],
        )
        .await;
        assert_eq!(
            result.unwrap(),
            BackupInspection {
                schema_version: database::migrations().len() as i64
            }
        );
    }

    #[tokio::test]
    async fn required_objects_follow_the_real_migrations() {
        let dir = tempfile::tempdir().unwrap();
        let pool = database::create_migrated_database(&dir.path().join("fresh.sqlite3"))
            .await
            .unwrap();
        let mut created = schema_objects(&pool).await.unwrap();
        pool.close().await;
        assert!(created.remove(&("table".to_string(), "_sqlx_migrations".to_string())));

        let required = expected_schema_objects(
            database::migrations()
                .iter()
                .map(|migration| migration.sql)
                .collect(),
        )
        .await
        .unwrap();

        assert_eq!(
            required, created,
            "перелік обов'язкових об'єктів має збігатися з тим, що створює справжня міграція"
        );
        for trigger in [
            "raw_sources",
            "reports",
            "parsed_versions",
            "corrections",
            "review_decisions",
            "revision_history",
            "audit_log",
        ]
        .into_iter()
        .flat_map(|prefix| [format!("{prefix}_no_update"), format!("{prefix}_no_delete")])
        .chain([
            "xlsx_row_fingerprints_no_update".to_string(),
            "xlsx_row_fingerprints_no_delete".to_string(),
        ]) {
            assert!(
                required.contains(&("trigger".to_string(), trigger.clone())),
                "{trigger}"
            );
        }
        for table in [
            "local_profile_details",
            "local_profile_modules",
            "dashboard_modules",
        ] {
            assert!(required.contains(&("table".to_string(), table.to_string())));
        }
    }

    #[tokio::test]
    async fn rejects_candidate_with_a_sidecar_without_reading_it() {
        let dir = tempfile::tempdir().unwrap();
        let source = dir.path().join("synthetic.sqlite3");
        let pool = synthetic_database(&source).await;
        pool.close().await;
        let journal = dir.path().join("synthetic.sqlite3-journal");
        std::fs::write(&journal, b"synthetic sidecar").unwrap();

        assert!(matches!(
            inspect_backup(&source).await,
            Err(RestoreInspectionError::SidecarsPresent)
        ));
        assert_eq!(std::fs::read(&journal).unwrap(), b"synthetic sidecar");
    }

    #[tokio::test]
    async fn stages_valid_copy_without_changing_source_or_live_file() {
        let dir = tempfile::tempdir().unwrap();
        let source = dir.path().join("synthetic-backup.sqlite3");
        let pool = synthetic_database(&source).await;
        pool.close().await;
        let live = dir.path().join("easywar.db");
        std::fs::write(&live, b"synthetic current database placeholder").unwrap();
        let before = std::fs::read(&source).unwrap();

        assert_eq!(
            stage_backup(&source, &live).await.unwrap(),
            BackupInspection { schema_version: 12 }
        );
        assert_eq!(std::fs::read(&source).unwrap(), before);
        assert_eq!(
            std::fs::read(staged_backup_path(&live).unwrap()).unwrap(),
            before
        );
        assert_eq!(
            std::fs::read(&live).unwrap(),
            b"synthetic current database placeholder"
        );
    }

    #[tokio::test]
    async fn never_overwrites_an_existing_pending_copy() {
        let dir = tempfile::tempdir().unwrap();
        let source = dir.path().join("synthetic-backup.sqlite3");
        let pool = synthetic_database(&source).await;
        pool.close().await;
        let live = dir.path().join("easywar.db");
        let pending = staged_backup_path(&live).unwrap();
        std::fs::write(&pending, b"keep pending copy").unwrap();

        assert!(matches!(
            stage_backup(&source, &live).await,
            Err(RestoreInspectionError::PendingAlreadyExists)
        ));
        assert_eq!(std::fs::read(&pending).unwrap(), b"keep pending copy");
    }

    #[tokio::test]
    async fn rejects_invalid_source_without_publishing_pending_copy() {
        let dir = tempfile::tempdir().unwrap();
        let source = dir.path().join("not-easywar.sqlite3");
        std::fs::write(&source, b"synthetic invalid SQLite bytes").unwrap();
        let live = dir.path().join("easywar.db");

        assert!(stage_backup(&source, &live).await.is_err());
        assert!(!staged_backup_path(&live).unwrap().exists());
        assert_eq!(
            std::fs::read(&source).unwrap(),
            b"synthetic invalid SQLite bytes"
        );
    }

    #[tokio::test]
    async fn offline_swap_keeps_exact_previous_database() {
        let dir = tempfile::tempdir().unwrap();
        let source = dir.path().join("synthetic-backup.sqlite3");
        let source_pool = synthetic_database(&source).await;
        sqlx::query("INSERT INTO settings (key, value_json, updated_at) VALUES ('version', '2', '2026-01-01')")
            .execute(&source_pool)
            .await
            .unwrap();
        source_pool.close().await;
        let live = dir.path().join("easywar.db");
        let live_pool = synthetic_database(&live).await;
        sqlx::query("INSERT INTO settings (key, value_json, updated_at) VALUES ('version', '1', '2026-01-01')")
            .execute(&live_pool)
            .await
            .unwrap();
        live_pool.close().await;
        let old_bytes = fs::read(&live).unwrap();
        let new_bytes = fs::read(&source).unwrap();

        stage_backup(&source, &live).await.unwrap();
        assert_eq!(
            swap_staged_backup_offline(&live).await.unwrap(),
            BackupInspection { schema_version: 12 }
        );
        assert_eq!(fs::read(&live).unwrap(), new_bytes);
        assert_eq!(
            fs::read(previous_backup_path(&live).unwrap()).unwrap(),
            old_bytes
        );
        assert!(!staged_backup_path(&live).unwrap().exists());
        assert_eq!(
            recover_interrupted_swap(&live).await.unwrap(),
            OfflineRestoreState::AppliedWithPreviousCopy
        );
    }

    #[tokio::test]
    async fn interrupted_rename_gap_rolls_back_without_consuming_candidate() {
        let dir = tempfile::tempdir().unwrap();
        let source = dir.path().join("synthetic-backup.sqlite3");
        let pool = synthetic_database(&source).await;
        pool.close().await;
        let live = dir.path().join("easywar.db");
        let pool = synthetic_database(&live).await;
        pool.close().await;
        let old_bytes = fs::read(&live).unwrap();
        stage_backup(&source, &live).await.unwrap();
        let previous = previous_backup_path(&live).unwrap();
        fs::rename(&live, &previous).unwrap();

        assert_eq!(
            recover_interrupted_swap(&live).await.unwrap(),
            OfflineRestoreState::RolledBack
        );
        assert_eq!(fs::read(&live).unwrap(), old_bytes);
        assert!(staged_backup_path(&live).unwrap().exists());
        assert!(!previous.exists());
    }

    #[tokio::test]
    async fn offline_swap_rejects_sidecars_and_existing_previous_copy() {
        let dir = tempfile::tempdir().unwrap();
        let source = dir.path().join("synthetic-backup.sqlite3");
        let pool = synthetic_database(&source).await;
        pool.close().await;
        let live = dir.path().join("easywar.db");
        let pool = synthetic_database(&live).await;
        pool.close().await;
        stage_backup(&source, &live).await.unwrap();
        let old_bytes = fs::read(&live).unwrap();
        let wal = dir.path().join("easywar.db-wal");
        fs::write(&wal, b"synthetic WAL guard").unwrap();

        assert!(matches!(
            swap_staged_backup_offline(&live).await,
            Err(RestoreInspectionError::LiveSidecarsPresent)
        ));
        assert_eq!(fs::read(&live).unwrap(), old_bytes);
        fs::remove_file(&wal).unwrap();
        let previous = previous_backup_path(&live).unwrap();
        fs::write(&previous, b"keep previous copy").unwrap();
        assert!(matches!(
            swap_staged_backup_offline(&live).await,
            Err(RestoreInspectionError::PreviousBackupExists)
        ));
        assert_eq!(fs::read(&previous).unwrap(), b"keep previous copy");
        assert_eq!(fs::read(&live).unwrap(), old_bytes);
    }

    #[tokio::test]
    async fn staged_restore_requires_an_explicit_request_and_can_be_cancelled() {
        let dir = tempfile::tempdir().unwrap();
        let source = dir.path().join("synthetic-backup.sqlite3");
        let source_pool = synthetic_database(&source).await;
        source_pool.close().await;
        let live = dir.path().join("easywar.db");
        let live_pool = synthetic_database(&live).await;
        live_pool.close().await;
        let live_before = fs::read(&live).unwrap();

        stage_backup(&source, &live).await.unwrap();
        assert_eq!(
            process_requested_restore(&live).await.unwrap(),
            RestoreStartupReport {
                outcome: RestoreStartupOutcome::None,
                schema_version: None,
                pending_restore_available: true,
                previous_backup_retained: false,
                detail: None,
            }
        );
        assert_eq!(fs::read(&live).unwrap(), live_before);
        assert!(staged_backup_path(&live).unwrap().exists());
        assert!(!previous_backup_path(&live).unwrap().exists());

        cancel_staged_restore(&live).unwrap();
        assert!(!staged_backup_path(&live).unwrap().exists());
    }

    #[tokio::test]
    async fn requested_restore_applies_offline_and_keeps_previous_until_finalized() {
        let dir = tempfile::tempdir().unwrap();
        let source = dir.path().join("synthetic-backup.sqlite3");
        let source_pool = synthetic_database(&source).await;
        sqlx::query(
            "INSERT INTO settings (key, value_json, updated_at) VALUES ('version', '2', '2026-01-01')",
        )
        .execute(&source_pool)
        .await
        .unwrap();
        source_pool.close().await;
        let live = dir.path().join("easywar.db");
        let live_pool = synthetic_database(&live).await;
        sqlx::query(
            "INSERT INTO settings (key, value_json, updated_at) VALUES ('version', '1', '2026-01-01')",
        )
        .execute(&live_pool)
        .await
        .unwrap();
        live_pool.close().await;
        let source_bytes = fs::read(&source).unwrap();
        let live_bytes = fs::read(&live).unwrap();

        stage_backup(&source, &live).await.unwrap();
        assert_eq!(
            request_staged_restore(&live).await.unwrap(),
            BackupInspection { schema_version: 12 }
        );
        assert!(restore_request_path(&live).unwrap().exists());
        assert_eq!(
            process_requested_restore(&live).await.unwrap(),
            RestoreStartupReport {
                outcome: RestoreStartupOutcome::Applied,
                schema_version: Some(12),
                pending_restore_available: false,
                previous_backup_retained: true,
                detail: None,
            }
        );
        assert_eq!(fs::read(&live).unwrap(), source_bytes);
        assert_eq!(
            fs::read(previous_backup_path(&live).unwrap()).unwrap(),
            live_bytes
        );
        assert!(!restore_request_path(&live).unwrap().exists());

        finalize_previous_backup(&live).await.unwrap();
        assert!(!previous_backup_path(&live).unwrap().exists());
        assert_eq!(fs::read(&live).unwrap(), source_bytes);
    }

    #[tokio::test]
    async fn requested_restore_rolls_back_an_interrupted_rename_gap() {
        let dir = tempfile::tempdir().unwrap();
        let source = dir.path().join("synthetic-backup.sqlite3");
        let source_pool = synthetic_database(&source).await;
        source_pool.close().await;
        let live = dir.path().join("easywar.db");
        let live_pool = synthetic_database(&live).await;
        live_pool.close().await;
        let live_bytes = fs::read(&live).unwrap();

        stage_backup(&source, &live).await.unwrap();
        request_staged_restore(&live).await.unwrap();
        fs::rename(&live, previous_backup_path(&live).unwrap()).unwrap();

        assert_eq!(
            process_requested_restore(&live).await.unwrap(),
            RestoreStartupReport {
                outcome: RestoreStartupOutcome::RolledBack,
                schema_version: Some(12),
                pending_restore_available: true,
                previous_backup_retained: false,
                detail: None,
            }
        );
        assert_eq!(fs::read(&live).unwrap(), live_bytes);
        assert!(staged_backup_path(&live).unwrap().exists());
        assert!(!restore_request_path(&live).unwrap().exists());
        assert!(!previous_backup_path(&live).unwrap().exists());
    }

    #[tokio::test]
    async fn invalid_restore_marker_never_applies_the_staged_database() {
        let dir = tempfile::tempdir().unwrap();
        let source = dir.path().join("synthetic-backup.sqlite3");
        let source_pool = synthetic_database(&source).await;
        source_pool.close().await;
        let live = dir.path().join("easywar.db");
        let live_pool = synthetic_database(&live).await;
        live_pool.close().await;
        let live_bytes = fs::read(&live).unwrap();

        stage_backup(&source, &live).await.unwrap();
        fs::write(restore_request_path(&live).unwrap(), b"invalid marker").unwrap();
        assert!(matches!(
            process_requested_restore(&live).await,
            Err(RestoreInspectionError::InvalidRestoreControlFile)
        ));
        assert_eq!(fs::read(&live).unwrap(), live_bytes);
        assert!(staged_backup_path(&live).unwrap().exists());
    }

    #[test]
    fn application_instance_lock_is_exclusive() {
        let dir = tempfile::tempdir().unwrap();
        let live = dir.path().join("easywar.db");
        let first = acquire_application_instance_lock_with_timeout(&live, Duration::ZERO).unwrap();
        assert!(matches!(
            acquire_application_instance_lock_with_timeout(&live, Duration::ZERO),
            Err(RestoreInspectionError::AnotherInstanceRunning)
        ));
        drop(first);
        acquire_application_instance_lock_with_timeout(&live, Duration::ZERO).unwrap();
    }

    #[test]
    fn restarting_instance_waits_for_the_previous_process_lock() {
        let dir = tempfile::tempdir().unwrap();
        let live = dir.path().join("easywar.db");
        let first = acquire_application_instance_lock_with_timeout(&live, Duration::ZERO).unwrap();
        let waiting_live = live.clone();
        let waiter = thread::spawn(move || {
            acquire_application_instance_lock_with_timeout(&waiting_live, Duration::from_secs(1))
        });
        thread::sleep(Duration::from_millis(75));
        drop(first);
        assert!(waiter.join().unwrap().is_ok());
    }

    async fn fill_synthetic_rows(pool: &SqlitePool, rows: i64) {
        sqlx::query("CREATE TABLE synthetic_rows (id INTEGER PRIMARY KEY, payload TEXT NOT NULL)")
            .execute(pool)
            .await
            .unwrap();
        sqlx::query(
            "WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i + 1 FROM n WHERE i < $1)
             INSERT INTO synthetic_rows (id, payload) SELECT i, printf('%.300c', 'a') FROM n",
        )
        .bind(rows)
        .execute(pool)
        .await
        .unwrap();
    }

    fn copy_with_sidecars(from: &Path, to: &Path) {
        std::fs::copy(from, to).unwrap();
        for suffix in ["-wal", "-shm", "-journal"] {
            let mut source = from.as_os_str().to_owned();
            source.push(suffix);
            if Path::new(&source).exists() {
                let mut target = to.as_os_str().to_owned();
                target.push(suffix);
                std::fs::copy(&source, &target).unwrap();
            }
        }
    }

    async fn synthetic_payloads(path: &Path) -> (i64, i64) {
        let pool = SqlitePoolOptions::new()
            .max_connections(1)
            .connect_with(SqliteConnectOptions::new().filename(path).read_only(true))
            .await
            .unwrap();
        let counts = sqlx::query_as(
            "SELECT count(*), sum(payload = printf('%.300c', 'a')) FROM synthetic_rows",
        )
        .fetch_one(&pool)
        .await
        .unwrap();
        pool.close().await;
        counts
    }

    /// Snapshot the files mid-transaction, as a process killed during a write
    /// leaves them. `synchronous = OFF` makes SQLite write the journal header
    /// immediately, so the leftover journal is always "hot".
    async fn crash_during_write(running: &Path, crashed: &Path) {
        let pool = synthetic_database(running).await;
        fill_synthetic_rows(&pool, 1500).await;
        {
            let mut connection = pool.acquire().await.unwrap();
            for pragma in [
                "PRAGMA synchronous = OFF",
                "PRAGMA cache_size = 1",
                "BEGIN IMMEDIATE",
            ] {
                sqlx::query(pragma).execute(&mut *connection).await.unwrap();
            }
            sqlx::query("UPDATE synthetic_rows SET payload = printf('%.300c', 'b')")
                .execute(&mut *connection)
                .await
                .unwrap();
            copy_with_sidecars(running, crashed);
            sqlx::query("ROLLBACK")
                .execute(&mut *connection)
                .await
                .unwrap();
        }
        pool.close().await;
    }

    #[tokio::test]
    async fn rolls_back_a_write_interrupted_by_a_crash_before_startup_checks() {
        let dir = tempfile::tempdir().unwrap();
        let crashed = dir.path().join("easywar.db");
        crash_during_write(&dir.path().join("running.db"), &crashed).await;
        let journal = dir.path().join("easywar.db-journal");
        const JOURNAL_MAGIC: [u8; 8] = [0xd9, 0xd5, 0x05, 0xf9, 0x20, 0xa1, 0x63, 0xd7];
        assert_eq!(
            std::fs::read(&journal).unwrap()[..8],
            JOURNAL_MAGIC,
            "hot journal"
        );
        assert!(matches!(
            inspect_backup(&crashed).await,
            Err(RestoreInspectionError::SidecarsPresent)
        ));

        let lock = acquire_application_instance_lock(&crashed).unwrap();
        assert!(recover_live_sidecars(&crashed, &lock).await.unwrap());

        assert!(!journal.exists());
        assert_eq!(
            inspect_backup(&crashed).await.unwrap(),
            BackupInspection { schema_version: 12 }
        );
        assert_eq!(synthetic_payloads(&crashed).await, (1500, 1500));
    }

    #[tokio::test]
    async fn clears_a_journal_that_was_never_synced() {
        let dir = tempfile::tempdir().unwrap();
        let live = dir.path().join("easywar.db");
        let pool = synthetic_database(&live).await;
        fill_synthetic_rows(&pool, 20).await;
        pool.close().await;
        // A killed process can leave a journal whose header is still zeroed:
        // SQLite does not treat it as hot, and the database file is unchanged.
        let journal = dir.path().join("easywar.db-journal");
        let mut stale = vec![0_u8; 512];
        stale.extend_from_slice(&[0x5a; 4096]);
        std::fs::write(&journal, &stale).unwrap();

        let lock = acquire_application_instance_lock(&live).unwrap();
        assert!(recover_live_sidecars(&live, &lock).await.unwrap());

        assert!(!journal.exists());
        assert_eq!(
            inspect_backup(&live).await.unwrap(),
            BackupInspection { schema_version: 12 }
        );
        assert_eq!(synthetic_payloads(&live).await, (20, 20));
    }

    #[tokio::test]
    async fn keeps_committed_wal_frames_before_startup_checks() {
        let dir = tempfile::tempdir().unwrap();
        let running = dir.path().join("running.db");
        synthetic_database(&running).await.close().await;
        let pool = SqlitePoolOptions::new()
            .max_connections(1)
            .connect_with(
                SqliteConnectOptions::new()
                    .filename(&running)
                    .journal_mode(sqlx::sqlite::SqliteJournalMode::Wal),
            )
            .await
            .unwrap();
        sqlx::query("PRAGMA wal_autocheckpoint = 0")
            .execute(&pool)
            .await
            .unwrap();
        fill_synthetic_rows(&pool, 40).await;
        let crashed = dir.path().join("easywar.db");
        copy_with_sidecars(&running, &crashed);
        pool.close().await;
        assert!(dir.path().join("easywar.db-wal").exists());

        let lock = acquire_application_instance_lock(&crashed).unwrap();
        assert!(recover_live_sidecars(&crashed, &lock).await.unwrap());

        for suffix in ["-wal", "-shm", "-journal"] {
            assert!(
                !dir.path().join(format!("easywar.db{suffix}")).exists(),
                "{suffix}"
            );
        }
        assert_eq!(
            inspect_backup(&crashed).await.unwrap(),
            BackupInspection { schema_version: 12 }
        );
        assert_eq!(synthetic_payloads(&crashed).await, (40, 40));
    }

    #[tokio::test]
    async fn clean_live_database_needs_no_recovery() {
        let dir = tempfile::tempdir().unwrap();
        let live = dir.path().join("easywar.db");
        synthetic_database(&live).await.close().await;
        let before = std::fs::read(&live).unwrap();

        let lock = acquire_application_instance_lock(&live).unwrap();
        assert!(!recover_live_sidecars(&live, &lock).await.unwrap());
        assert_eq!(std::fs::read(&live).unwrap(), before);
    }

    #[tokio::test]
    async fn never_applies_sidecars_without_their_live_database() {
        let dir = tempfile::tempdir().unwrap();
        let live = dir.path().join("easywar.db");
        let journal = dir.path().join("easywar.db-journal");
        std::fs::write(&journal, b"synthetic orphaned journal").unwrap();

        let lock = acquire_application_instance_lock(&live).unwrap();
        assert!(matches!(
            recover_live_sidecars(&live, &lock).await,
            Err(RestoreInspectionError::LiveSidecarsPresent)
        ));
        assert!(!live.exists());
        assert_eq!(
            std::fs::read(&journal).unwrap(),
            b"synthetic orphaned journal"
        );
    }
}
