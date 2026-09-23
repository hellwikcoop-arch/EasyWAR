use crate::database;
use serde::Serialize;
use sha2::{Digest, Sha384};
use sqlx::{sqlite::SqliteConnectOptions, sqlite::SqlitePoolOptions};
use std::{
    ffi::OsString,
    fs::{self, File},
    io,
    path::{Path, PathBuf},
};
use tempfile::NamedTempFile;

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
pub struct BackupInspection {
    pub schema_version: i64,
}

#[derive(Debug, thiserror::Error)]
pub enum RestoreInspectionError {
    #[error("оберіть файл резервної копії SQLite")]
    InvalidFile,
    #[error("шлях локальної бази EasyWAR має бути абсолютним")]
    InvalidTarget,
    #[error("підготовлена копія вже існує; спочатку заверште або скасуйте попереднє відновлення")]
    PendingAlreadyExists,
    #[error("поточна база відсутня або не є звичайним файлом")]
    InvalidLiveDatabase,
    #[error("попередня база вже збережена; нове відновлення заблоковано")]
    PreviousBackupExists,
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
    #[error("у копії бракує обов'язкових таблиць або подань EasyWAR")]
    MissingSchemaObjects,
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

fn sibling_path(live_database: &Path, suffix: &str) -> Result<PathBuf, RestoreInspectionError> {
    if !live_database.is_absolute() || live_database.file_name().is_none() {
        return Err(RestoreInspectionError::InvalidTarget);
    }
    let mut name: OsString = live_database.file_name().unwrap().to_owned();
    name.push(suffix);
    Ok(live_database.with_file_name(name))
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
/// an exclusive lock. The desktop does NOT call this yet. Both renames are in
/// the same directory; a previous database is retained for manual recovery.
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

fn has_sidecars(path: &Path) -> Result<bool, io::Error> {
    for suffix in ["-wal", "-shm", "-journal"] {
        let mut sidecar: OsString = path.as_os_str().to_owned();
        sidecar.push(suffix);
        if path_exists(Path::new(&sidecar))? {
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

    for (kind, name) in [
        ("table", "raw_sources"),
        ("table", "reports"),
        ("table", "parsed_report_versions"),
        ("table", "manual_corrections"),
        ("table", "review_decisions"),
        ("table", "revision_history"),
        ("table", "audit_log"),
        ("table", "settings"),
        ("view", "report_current_state"),
    ] {
        let found: i64 =
            sqlx::query_scalar("SELECT count(*) FROM sqlite_master WHERE type = $1 AND name = $2")
                .bind(kind)
                .bind(name)
                .fetch_one(pool)
                .await?;
        if found != 1 {
            return Err(RestoreInspectionError::MissingSchemaObjects);
        }
    }

    if applied.last().unwrap().0 >= 2 {
        let found: i64 = sqlx::query_scalar(
            "SELECT count(*) FROM sqlite_master
             WHERE type = 'table' AND name = 'xlsx_row_fingerprints'",
        )
        .fetch_one(pool)
        .await?;
        if found != 1 {
            return Err(RestoreInspectionError::MissingSchemaObjects);
        }
    }

    Ok(BackupInspection {
        schema_version: applied.last().unwrap().0,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{backup::BackupStore, database};
    use sqlx::SqlitePool;

    async fn synthetic_database(path: &Path) -> SqlitePool {
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
        for migration in database::migrations() {
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
            BackupInspection { schema_version: 2 }
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
            Err(RestoreInspectionError::MissingSchemaObjects)
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
            Err(RestoreInspectionError::MissingSchemaObjects)
        ));
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
            BackupInspection { schema_version: 2 }
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
            BackupInspection { schema_version: 2 }
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
}
