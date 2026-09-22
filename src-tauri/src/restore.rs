use crate::database;
use serde::Serialize;
use sha2::{Digest, Sha384};
use sqlx::{sqlite::SqliteConnectOptions, sqlite::SqlitePoolOptions};
use std::{ffi::OsString, io, path::Path};

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
pub struct BackupInspection {
    pub schema_version: i64,
}

#[derive(Debug, thiserror::Error)]
pub enum RestoreInspectionError {
    #[error("оберіть файл резервної копії SQLite")]
    InvalidFile,
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

/// Inspect an offline, standalone backup without writing to the source file.
/// This is a preflight only: it never stages or applies a restore.
pub async fn inspect_backup(path: &Path) -> Result<BackupInspection, RestoreInspectionError> {
    if !path.is_absolute() || !std::fs::metadata(path).is_ok_and(|metadata| metadata.is_file()) {
        return Err(RestoreInspectionError::InvalidFile);
    }
    let path = std::fs::canonicalize(path)?;
    for suffix in ["-wal", "-shm", "-journal"] {
        let mut sidecar: OsString = path.as_os_str().to_owned();
        sidecar.push(suffix);
        if Path::new(&sidecar).exists() {
            return Err(RestoreInspectionError::SidecarsPresent);
        }
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

    Ok(BackupInspection {
        schema_version: applied.last().unwrap().0,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{backup::BackupStore, database::INITIAL_SCHEMA_SQL};
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
        sqlx::raw_sql(INITIAL_SCHEMA_SQL)
            .execute(&pool)
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
        sqlx::query(
            "INSERT INTO _sqlx_migrations (version, description, success, checksum, execution_time)
             VALUES ($1, $2, 1, $3, 0)",
        )
        .bind(1_i64)
        .bind("create_provenance_schema")
        .bind(Sha384::digest(INITIAL_SCHEMA_SQL.as_bytes()).to_vec())
        .execute(&pool)
        .await
        .unwrap();
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
            BackupInspection { schema_version: 1 }
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
}
