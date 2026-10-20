use crate::{
    database::{self, DatabaseBootstrapError},
    restore::{self, BackupInspection, RestoreInspectionError},
};
use sqlx::migrate::Migrator;
use std::{
    ffi::OsString,
    fs::{self, File, OpenOptions},
    io::{self, BufReader, Read},
    path::{Path, PathBuf},
};
use tempfile::{NamedTempFile, TempPath};

#[derive(Debug, thiserror::Error)]
pub enum StartupMigrationError {
    #[error("шлях локальної SQLite-бази має бути абсолютним")]
    InvalidTarget,
    #[error("локальна SQLite-база або службовий файл міграції має некоректний тип")]
    InvalidFileType,
    #[error("у збірці EasyWAR немає вбудованих міграцій")]
    MissingEmbeddedMigrations,
    #[error("наявна передміграційна копія не збігається з поточною базою")]
    BackupConflict,
    #[error("виявлено неоднозначний стан перерваного перемикання міграції")]
    InterruptedSwapConflict,
    #[error("після міграції очікувалась схема {expected}, але отримано {actual}")]
    UnexpectedSchemaVersion { expected: i64, actual: i64 },
    #[error("помилка файлової системи під час startup-міграції: {0}")]
    Io(#[from] io::Error),
    #[error("перевірка SQLite перед startup-міграцією не пройшла: {0}")]
    Inspection(#[from] RestoreInspectionError),
    #[error("вбудована startup-міграція SQLite не пройшла: {0}")]
    Bootstrap(#[from] DatabaseBootstrapError),
    #[error("не вдалося встановити мігровану базу ({install}) і повернути попередню ({rollback})")]
    SwapRollbackFailed {
        install: io::Error,
        rollback: io::Error,
    },
    #[error("мігрована база не пройшла фінальну перевірку: {validation}")]
    PostInstallValidation { validation: String },
}

/// Bring the app-local database to the current schema before Tauri or the SQL
/// plugin opens it. Every schema change is executed by the same embedded SQLx
/// migrator used for standalone template databases; no schema dump is copied.
pub async fn prepare_database(live_database: &Path) -> Result<(), StartupMigrationError> {
    prepare_database_with_migrator(live_database, database::embedded_migrator()).await
}

async fn prepare_database_with_migrator(
    live_database: &Path,
    migrator: &Migrator,
) -> Result<(), StartupMigrationError> {
    validate_target(live_database)?;
    let target_version = database::latest_schema_version()
        .ok_or(StartupMigrationError::MissingEmbeddedMigrations)?;

    recover_interrupted_swap(live_database, target_version).await?;
    if !path_exists(live_database)? {
        create_current_database(live_database, migrator, target_version).await?;
        return Ok(());
    }
    require_regular_file(live_database)?;

    let current = restore::inspect_backup(live_database).await?;
    if current.schema_version == target_version {
        return Ok(());
    }
    if current.schema_version > target_version {
        return Err(StartupMigrationError::UnexpectedSchemaVersion {
            expected: target_version,
            actual: current.schema_version,
        });
    }

    let backup =
        ensure_verified_backup(live_database, live_database, &current, target_version).await?;
    let parent = live_database
        .parent()
        .ok_or(StartupMigrationError::InvalidTarget)?;
    let candidate = copy_to_temporary(&backup, parent)?;
    let pool = database::migrate_database_file_with(&candidate, migrator).await?;
    pool.close().await;

    let migrated = restore::inspect_backup(&candidate).await?;
    if migrated.schema_version != target_version {
        return Err(StartupMigrationError::UnexpectedSchemaVersion {
            expected: target_version,
            actual: migrated.schema_version,
        });
    }
    if restore::inspect_backup(live_database).await? != current
        || !files_have_same_bytes(live_database, &backup)?
    {
        return Err(StartupMigrationError::BackupConflict);
    }
    install_verified_candidate(live_database, candidate, target_version).await
}

fn validate_target(path: &Path) -> Result<(), StartupMigrationError> {
    if !path.is_absolute() || path.file_name().is_none() {
        return Err(StartupMigrationError::InvalidTarget);
    }
    let parent = path.parent().ok_or(StartupMigrationError::InvalidTarget)?;
    fs::create_dir_all(parent)?;
    Ok(())
}

async fn create_current_database(
    live_database: &Path,
    migrator: &Migrator,
    target_version: i64,
) -> Result<(), StartupMigrationError> {
    let parent = live_database
        .parent()
        .ok_or(StartupMigrationError::InvalidTarget)?;
    let candidate = NamedTempFile::new_in(parent)?.into_temp_path();
    let pool = database::migrate_database_file_with(&candidate, migrator).await?;
    pool.close().await;
    let inspection = restore::inspect_backup(&candidate).await?;
    if inspection.schema_version != target_version {
        return Err(StartupMigrationError::UnexpectedSchemaVersion {
            expected: target_version,
            actual: inspection.schema_version,
        });
    }
    candidate
        .persist_noclobber(live_database)
        .map_err(|error| StartupMigrationError::Io(error.error))?;
    sync_parent(live_database)?;
    Ok(())
}

async fn ensure_verified_backup(
    source: &Path,
    live_database: &Path,
    current: &BackupInspection,
    target_version: i64,
) -> Result<PathBuf, StartupMigrationError> {
    const MAX_BACKUP_SLOTS: usize = 1024;
    for slot in 0..MAX_BACKUP_SLOTS {
        let backup = numbered_pre_migration_backup_path(
            live_database,
            current.schema_version,
            target_version,
            slot,
        )?;
        if path_exists(&backup)? {
            require_regular_file(&backup)?;
            if restore::inspect_backup(&backup).await.ok().as_ref() == Some(current)
                && files_have_same_bytes(source, &backup)?
            {
                return Ok(backup);
            }
            continue;
        }

        let parent = live_database
            .parent()
            .ok_or(StartupMigrationError::InvalidTarget)?;
        let temporary = copy_to_temporary(source, parent)?;
        if restore::inspect_backup(&temporary).await? != *current
            || !files_have_same_bytes(source, &temporary)?
        {
            return Err(StartupMigrationError::BackupConflict);
        }
        match temporary.persist_noclobber(&backup) {
            Ok(()) => {}
            Err(error) if error.error.kind() == io::ErrorKind::AlreadyExists => continue,
            Err(error) => return Err(StartupMigrationError::Io(error.error)),
        }
        sync_parent(&backup)?;

        if restore::inspect_backup(&backup).await? != *current
            || !files_have_same_bytes(source, &backup)?
        {
            return Err(StartupMigrationError::BackupConflict);
        }
        return Ok(backup);
    }
    Err(StartupMigrationError::BackupConflict)
}

async fn install_verified_candidate(
    live_database: &Path,
    candidate: TempPath,
    target_version: i64,
) -> Result<(), StartupMigrationError> {
    let previous = migration_swap_previous_path(live_database)?;
    if path_exists(&previous)? {
        return Err(StartupMigrationError::InterruptedSwapConflict);
    }

    fs::rename(live_database, &previous)?;
    if let Err(error) = sync_parent(live_database) {
        return rollback_swap_gap(live_database, &previous, error);
    }
    if let Err(error) = candidate.persist_noclobber(live_database) {
        return rollback_swap_gap(live_database, &previous, error.error);
    }
    if let Err(error) = sync_parent(live_database) {
        return rollback_installed_candidate(live_database, &previous, error.to_string());
    }

    match restore::inspect_backup(live_database).await {
        Ok(inspection) if inspection.schema_version == target_version => {}
        Ok(inspection) => {
            return rollback_installed_candidate(
                live_database,
                &previous,
                format!(
                    "очікувалась схема {target_version}, отримано {}",
                    inspection.schema_version
                ),
            )
        }
        Err(error) => {
            return rollback_installed_candidate(live_database, &previous, error.to_string())
        }
    }

    fs::remove_file(&previous)?;
    sync_parent(&previous)?;
    Ok(())
}

async fn recover_interrupted_swap(
    live_database: &Path,
    target_version: i64,
) -> Result<(), StartupMigrationError> {
    let previous = migration_swap_previous_path(live_database)?;
    if !path_exists(&previous)? {
        return Ok(());
    }
    require_regular_file(&previous)?;

    if !path_exists(live_database)? {
        fs::rename(&previous, live_database)?;
        sync_parent(live_database)?;
        restore::inspect_backup(live_database).await?;
        remove_invalid_candidate_if_present(live_database)?;
        return Ok(());
    }
    require_regular_file(live_database)?;

    match restore::inspect_backup(live_database).await {
        Ok(live) if live.schema_version == target_version => {
            let previous_inspection = restore::inspect_backup(&previous).await?;
            ensure_verified_backup(
                &previous,
                live_database,
                &previous_inspection,
                target_version,
            )
            .await?;
            fs::remove_file(&previous)?;
            sync_parent(&previous)?;
            remove_invalid_candidate_if_present(live_database)?;
            Ok(())
        }
        Ok(_) => Err(StartupMigrationError::InterruptedSwapConflict),
        Err(_) => rollback_invalid_live_database(live_database, &previous).await,
    }
}

async fn rollback_invalid_live_database(
    live_database: &Path,
    previous: &Path,
) -> Result<(), StartupMigrationError> {
    let invalid = migration_invalid_candidate_path(live_database)?;
    if path_exists(&invalid)? {
        return Err(StartupMigrationError::InterruptedSwapConflict);
    }
    fs::rename(live_database, &invalid)?;
    if let Err(install) = fs::rename(previous, live_database) {
        return match fs::rename(&invalid, live_database) {
            Ok(()) => Err(StartupMigrationError::Io(install)),
            Err(rollback) => Err(StartupMigrationError::SwapRollbackFailed { install, rollback }),
        };
    }
    sync_parent(live_database)?;
    restore::inspect_backup(live_database).await?;
    fs::remove_file(&invalid)?;
    sync_parent(&invalid)?;
    Ok(())
}

fn rollback_swap_gap<T>(
    live_database: &Path,
    previous: &Path,
    install: io::Error,
) -> Result<T, StartupMigrationError> {
    match fs::rename(previous, live_database) {
        Ok(()) => {
            sync_parent(live_database)?;
            Err(StartupMigrationError::Io(install))
        }
        Err(rollback) => Err(StartupMigrationError::SwapRollbackFailed { install, rollback }),
    }
}

fn rollback_installed_candidate<T>(
    live_database: &Path,
    previous: &Path,
    validation: String,
) -> Result<T, StartupMigrationError> {
    let invalid = migration_invalid_candidate_path(live_database)?;
    if path_exists(&invalid)? {
        return Err(StartupMigrationError::InterruptedSwapConflict);
    }
    fs::rename(live_database, &invalid)?;
    if let Err(install) = fs::rename(previous, live_database) {
        return match fs::rename(&invalid, live_database) {
            Ok(()) => Err(StartupMigrationError::Io(install)),
            Err(rollback) => Err(StartupMigrationError::SwapRollbackFailed { install, rollback }),
        };
    }
    sync_parent(live_database)?;
    fs::remove_file(&invalid)?;
    sync_parent(&invalid)?;
    Err(StartupMigrationError::PostInstallValidation { validation })
}

fn remove_invalid_candidate_if_present(live_database: &Path) -> Result<(), StartupMigrationError> {
    let invalid = migration_invalid_candidate_path(live_database)?;
    if !path_exists(&invalid)? {
        return Ok(());
    }
    require_regular_file(&invalid)?;
    fs::remove_file(&invalid)?;
    sync_parent(&invalid)?;
    Ok(())
}

#[cfg(test)]
fn pre_migration_backup_path(
    live_database: &Path,
    from_version: i64,
    to_version: i64,
) -> Result<PathBuf, StartupMigrationError> {
    numbered_pre_migration_backup_path(live_database, from_version, to_version, 0)
}

fn numbered_pre_migration_backup_path(
    live_database: &Path,
    from_version: i64,
    to_version: i64,
    slot: usize,
) -> Result<PathBuf, StartupMigrationError> {
    let suffix = if slot == 0 {
        format!(".pre-migration-v{from_version}-to-v{to_version}.sqlite3")
    } else {
        format!(".pre-migration-v{from_version}-to-v{to_version}-{slot}.sqlite3")
    };
    sibling_path(live_database, &suffix)
}

fn migration_swap_previous_path(live_database: &Path) -> Result<PathBuf, StartupMigrationError> {
    sibling_path(live_database, ".migration-swap-previous")
}

fn migration_invalid_candidate_path(
    live_database: &Path,
) -> Result<PathBuf, StartupMigrationError> {
    sibling_path(live_database, ".migration-invalid")
}

fn sibling_path(path: &Path, suffix: &str) -> Result<PathBuf, StartupMigrationError> {
    if !path.is_absolute() || path.file_name().is_none() {
        return Err(StartupMigrationError::InvalidTarget);
    }
    let mut name: OsString = path.file_name().unwrap().to_owned();
    name.push(suffix);
    Ok(path.with_file_name(name))
}

fn copy_to_temporary(source: &Path, parent: &Path) -> Result<TempPath, io::Error> {
    let temporary = NamedTempFile::new_in(parent)?.into_temp_path();
    fs::copy(source, &temporary)?;
    OpenOptions::new()
        .read(true)
        .write(true)
        .open(&temporary)?
        .sync_all()?;
    Ok(temporary)
}

fn files_have_same_bytes(left: &Path, right: &Path) -> Result<bool, io::Error> {
    if fs::metadata(left)?.len() != fs::metadata(right)?.len() {
        return Ok(false);
    }
    let mut left = BufReader::new(File::open(left)?);
    let mut right = BufReader::new(File::open(right)?);
    let mut left_buffer = [0_u8; 64 * 1024];
    let mut right_buffer = [0_u8; 64 * 1024];
    loop {
        let left_count = left.read(&mut left_buffer)?;
        let right_count = right.read(&mut right_buffer)?;
        if left_count != right_count || left_buffer[..left_count] != right_buffer[..right_count] {
            return Ok(false);
        }
        if left_count == 0 {
            return Ok(true);
        }
    }
}

fn require_regular_file(path: &Path) -> Result<(), StartupMigrationError> {
    if !fs::symlink_metadata(path)?.file_type().is_file() {
        return Err(StartupMigrationError::InvalidFileType);
    }
    Ok(())
}

fn path_exists(path: &Path) -> Result<bool, io::Error> {
    match fs::symlink_metadata(path) {
        Ok(_) => Ok(true),
        Err(error) if error.kind() == io::ErrorKind::NotFound => Ok(false),
        Err(error) => Err(error),
    }
}

fn sync_parent(path: &Path) -> Result<(), io::Error> {
    #[cfg(unix)]
    File::open(path.parent().ok_or(io::Error::other("missing parent"))?)?.sync_all()?;
    #[cfg(not(unix))]
    let _ = path;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use sha2::{Digest, Sha384};
    use sqlx::{
        migrate::{Migration, MigrationType},
        sqlite::{SqliteConnectOptions, SqlitePoolOptions},
        Row,
    };
    use std::borrow::Cow;

    async fn create_v3_database(path: &Path) -> sqlx::SqlitePool {
        let pool = SqlitePoolOptions::new()
            .max_connections(1)
            .connect_with(
                SqliteConnectOptions::new()
                    .filename(path)
                    .create_if_missing(true)
                    .foreign_keys(true),
            )
            .await
            .unwrap();
        sqlx::query(
            "CREATE TABLE _sqlx_migrations (
                version BIGINT PRIMARY KEY,
                description TEXT NOT NULL,
                installed_on TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
                success BOOLEAN NOT NULL,
                checksum BLOB NOT NULL,
                execution_time BIGINT NOT NULL
            )",
        )
        .execute(&pool)
        .await
        .unwrap();
        for migration in database::migrations().into_iter().take(3) {
            sqlx::raw_sql(migration.sql).execute(&pool).await.unwrap();
            sqlx::query(
                "INSERT INTO _sqlx_migrations
                 (version, description, success, checksum, execution_time)
                 VALUES (?, ?, 1, ?, 0)",
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

    async fn insert_complete_provenance_chain(pool: &sqlx::SqlitePool) {
        let now = "2026-01-01T00:00:00Z";
        sqlx::query(
            "INSERT INTO raw_sources
             (id, source_type, captured_at, content_type, raw_text, raw_sha256, created_at)
             VALUES ('source-migration', 'PASTE', ?, 'text/plain', ?, ?, ?)",
        )
        .bind(now)
        .bind("Синтетичний текст для перевірки міграції")
        .bind("a".repeat(64))
        .bind(now)
        .execute(pool)
        .await
        .unwrap();
        sqlx::query(
            "INSERT INTO reports (id, raw_source_id, source_item_key, created_at)
             VALUES ('report-migration', 'source-migration', 'item-1', ?)",
        )
        .bind(now)
        .execute(pool)
        .await
        .unwrap();
        sqlx::query(
            "INSERT INTO parsed_report_versions
             (id, report_id, version, parser_name, parser_version, parsed_payload_json, parsed_at)
             VALUES ('parse-migration', 'report-migration', 1, 'synthetic', '1', ?, ?)",
        )
        .bind(r#"{"synthetic":true,"result":"UNKNOWN"}"#)
        .bind(now)
        .execute(pool)
        .await
        .unwrap();
        sqlx::query(
            "INSERT INTO manual_corrections
             (id, report_id, correction_number, parsed_version_id, field_path,
              prior_value_json, corrected_value_json, reason, created_by, created_at)
             VALUES ('correction-migration', 'report-migration', 1, 'parse-migration',
                     '$.result', '\"UNKNOWN\"', '\"REVIEWED\"', 'synthetic', 'tester', ?)",
        )
        .bind(now)
        .execute(pool)
        .await
        .unwrap();
        sqlx::query(
            "INSERT INTO review_decisions
             (id, report_id, decision_number, parsed_version_id, decision,
              decided_by, rationale, decided_at)
             VALUES ('decision-migration', 'report-migration', 1, 'parse-migration',
                     'APPROVED', 'tester', 'synthetic', ?)",
        )
        .bind(now)
        .execute(pool)
        .await
        .unwrap();
        sqlx::query(
            "INSERT INTO revision_history
             (id, report_id, revision_number, parsed_version_id, review_decision_id,
              snapshot_json, change_summary, created_by, created_at)
             VALUES ('revision-migration', 'report-migration', 1, 'parse-migration',
                     'decision-migration', ?, 'synthetic', 'tester', ?)",
        )
        .bind(r#"{"synthetic":true,"result":"REVIEWED"}"#)
        .bind(now)
        .execute(pool)
        .await
        .unwrap();
        sqlx::query(
            "INSERT INTO audit_log
             (id, report_id, entity_type, entity_id, action, actor_type,
              actor_label, details_json, occurred_at)
             VALUES ('audit-migration', 'report-migration', 'report', 'report-migration',
                     'APPROVED', 'USER', 'tester', '{\"synthetic\":true}', ?)",
        )
        .bind(now)
        .execute(pool)
        .await
        .unwrap();
        sqlx::query(
            "INSERT INTO local_profiles
             (id, display_name, name_key, created_at, updated_at)
             VALUES ('profile-aaaaaaaaaaaaaaaaaaaaaaaa', 'Тест', 'тест', ?, ?)",
        )
        .bind(now)
        .bind(now)
        .execute(pool)
        .await
        .unwrap();
    }

    #[tokio::test]
    async fn creates_clean_database_with_authoritative_embedded_migrations() {
        let directory = tempfile::tempdir().unwrap();
        let live = directory.path().join("easywar.db");

        prepare_database(&live).await.unwrap();

        assert_eq!(
            restore::inspect_backup(&live).await.unwrap(),
            BackupInspection { schema_version: 14 }
        );
        let pool = SqlitePoolOptions::new()
            .max_connections(1)
            .connect_with(
                SqliteConnectOptions::new()
                    .filename(&live)
                    .read_only(true)
                    .immutable(true),
            )
            .await
            .unwrap();
        let count: i64 = sqlx::query_scalar("SELECT count(*) FROM _sqlx_migrations")
            .fetch_one(&pool)
            .await
            .unwrap();
        pool.close().await;
        assert_eq!(count, database::migrations().len() as i64);
    }

    #[tokio::test]
    async fn migrates_v3_without_losing_provenance_and_is_idempotent() {
        let directory = tempfile::tempdir().unwrap();
        let live = directory.path().join("easywar.db");
        let pool = create_v3_database(&live).await;
        insert_complete_provenance_chain(&pool).await;
        pool.close().await;
        let original = fs::read(&live).unwrap();
        let backup = pre_migration_backup_path(&live, 3, 14).unwrap();

        prepare_database(&live).await.unwrap();

        assert_eq!(fs::read(&backup).unwrap(), original);
        assert_eq!(
            restore::inspect_backup(&backup).await.unwrap(),
            BackupInspection { schema_version: 3 }
        );
        assert_eq!(
            restore::inspect_backup(&live).await.unwrap(),
            BackupInspection { schema_version: 14 }
        );
        let pool = SqlitePoolOptions::new()
            .max_connections(1)
            .connect_with(
                SqliteConnectOptions::new()
                    .filename(&live)
                    .read_only(true)
                    .immutable(true),
            )
            .await
            .unwrap();
        let values = sqlx::query(
            "SELECT raw_sources.raw_text, parsed_report_versions.parsed_payload_json,
                    manual_corrections.corrected_value_json, review_decisions.decision,
                    revision_history.snapshot_json, audit_log.action
             FROM reports
             JOIN raw_sources ON raw_sources.id = reports.raw_source_id
             JOIN parsed_report_versions ON parsed_report_versions.report_id = reports.id
             JOIN manual_corrections ON manual_corrections.report_id = reports.id
             JOIN review_decisions ON review_decisions.report_id = reports.id
             JOIN revision_history ON revision_history.report_id = reports.id
             JOIN audit_log ON audit_log.report_id = reports.id
             WHERE reports.id = 'report-migration'",
        )
        .fetch_one(&pool)
        .await
        .unwrap();
        assert_eq!(
            values.get::<String, _>("raw_text"),
            "Синтетичний текст для перевірки міграції"
        );
        assert_eq!(
            values.get::<String, _>("parsed_payload_json"),
            r#"{"synthetic":true,"result":"UNKNOWN"}"#
        );
        assert_eq!(
            values.get::<String, _>("corrected_value_json"),
            r#""REVIEWED""#
        );
        assert_eq!(values.get::<String, _>("decision"), "APPROVED");
        assert_eq!(
            values.get::<String, _>("snapshot_json"),
            r#"{"synthetic":true,"result":"REVIEWED"}"#
        );
        assert_eq!(values.get::<String, _>("action"), "APPROVED");
        let migration_count: i64 = sqlx::query_scalar("SELECT count(*) FROM _sqlx_migrations")
            .fetch_one(&pool)
            .await
            .unwrap();
        pool.close().await;
        assert_eq!(migration_count, 14);

        let migrated_once = fs::read(&live).unwrap();
        let backup_once = fs::read(&backup).unwrap();
        prepare_database(&live).await.unwrap();
        assert_eq!(fs::read(&live).unwrap(), migrated_once);
        assert_eq!(fs::read(&backup).unwrap(), backup_once);
    }

    #[tokio::test]
    async fn failed_candidate_migration_keeps_live_database_and_verified_backup() {
        let directory = tempfile::tempdir().unwrap();
        let live = directory.path().join("easywar.db");
        let pool = create_v3_database(&live).await;
        insert_complete_provenance_chain(&pool).await;
        pool.close().await;
        let original = fs::read(&live).unwrap();

        let mut migrations = database::embedded_migrator()
            .iter()
            .cloned()
            .collect::<Vec<_>>();
        migrations.push(Migration::new(
            5,
            Cow::Borrowed("synthetic failure"),
            MigrationType::Simple,
            Cow::Borrowed("THIS IS NOT VALID SQLITE"),
            false,
        ));
        let failing = Migrator {
            migrations: Cow::Owned(migrations),
            ..Migrator::DEFAULT
        };

        assert!(prepare_database_with_migrator(&live, &failing)
            .await
            .is_err());
        assert_eq!(fs::read(&live).unwrap(), original);
        let backup = pre_migration_backup_path(&live, 3, 14).unwrap();
        assert_eq!(fs::read(&backup).unwrap(), original);
        assert_eq!(
            restore::inspect_backup(&backup).await.unwrap(),
            BackupInspection { schema_version: 3 }
        );
        assert!(!migration_swap_previous_path(&live).unwrap().exists());
    }

    #[tokio::test]
    async fn a_distinct_restored_v3_database_gets_a_non_overwriting_backup() {
        let directory = tempfile::tempdir().unwrap();
        let live = directory.path().join("easywar.db");
        let first_pool = create_v3_database(&live).await;
        insert_complete_provenance_chain(&first_pool).await;
        first_pool.close().await;
        let first_original = fs::read(&live).unwrap();
        prepare_database(&live).await.unwrap();
        let first_backup = pre_migration_backup_path(&live, 3, 14).unwrap();
        assert_eq!(fs::read(&first_backup).unwrap(), first_original);

        let restored = directory.path().join("restored-v3.sqlite3");
        let restored_pool = create_v3_database(&restored).await;
        insert_complete_provenance_chain(&restored_pool).await;
        sqlx::query(
            "INSERT INTO settings (key, value_json, updated_at)
             VALUES ('restored.synthetic', '{\"value\":2}', '2026-01-02T00:00:00Z')",
        )
        .execute(&restored_pool)
        .await
        .unwrap();
        restored_pool.close().await;
        let restored_original = fs::read(&restored).unwrap();
        fs::remove_file(&live).unwrap();
        fs::rename(&restored, &live).unwrap();

        prepare_database(&live).await.unwrap();

        let second_backup = numbered_pre_migration_backup_path(&live, 3, 14, 1).unwrap();
        assert_eq!(fs::read(&first_backup).unwrap(), first_original);
        assert_eq!(fs::read(&second_backup).unwrap(), restored_original);
        assert_eq!(
            restore::inspect_backup(&live).await.unwrap(),
            BackupInspection { schema_version: 14 }
        );
    }

    #[tokio::test]
    async fn interrupted_swap_gap_restores_previous_database_before_retry() {
        let directory = tempfile::tempdir().unwrap();
        let live = directory.path().join("easywar.db");
        let pool = create_v3_database(&live).await;
        insert_complete_provenance_chain(&pool).await;
        pool.close().await;
        let previous = migration_swap_previous_path(&live).unwrap();
        fs::rename(&live, &previous).unwrap();

        prepare_database(&live).await.unwrap();

        assert_eq!(
            restore::inspect_backup(&live).await.unwrap(),
            BackupInspection { schema_version: 14 }
        );
        assert!(!previous.exists());
        assert_eq!(
            restore::inspect_backup(&pre_migration_backup_path(&live, 3, 14).unwrap())
                .await
                .unwrap(),
            BackupInspection { schema_version: 3 }
        );
    }
}
