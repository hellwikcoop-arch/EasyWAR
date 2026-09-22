use sqlx::{sqlite::SqliteConnectOptions, sqlite::SqlitePoolOptions, SqlitePool};
use std::{io, path::Path};
use tempfile::NamedTempFile;

#[derive(Clone, Debug)]
pub struct BackupStore {
    pool: SqlitePool,
}

#[derive(Debug, thiserror::Error)]
pub enum BackupError {
    #[error("оберіть абсолютний шлях до файлу резервної копії")]
    InvalidTarget,
    #[error("файл уже існує; оберіть нове ім'я, щоб не перезаписати дані")]
    AlreadyExists,
    #[error("не вдалося створити резервну копію: {0}")]
    Io(#[from] io::Error),
    #[error("помилка локальної бази під час резервного копіювання: {0}")]
    Database(#[from] sqlx::Error),
    #[error("перевірка цілісності резервної копії не пройшла")]
    IntegrityCheckFailed,
}

impl BackupStore {
    pub fn new(pool: SqlitePool) -> Self {
        Self { pool }
    }

    /// Create a self-contained SQLite snapshot without replacing an existing file.
    /// A temporary file in the selected directory is removed on any failure.
    pub async fn create_at(&self, destination: &Path) -> Result<(), BackupError> {
        if !destination.is_absolute() || destination.file_name().is_none() {
            return Err(BackupError::InvalidTarget);
        }
        if destination.exists() || destination.symlink_metadata().is_ok() {
            return Err(BackupError::AlreadyExists);
        }

        let parent = destination.parent().ok_or(BackupError::InvalidTarget)?;
        let temporary = NamedTempFile::new_in(parent)?.into_temp_path();
        let temporary_name = temporary
            .to_str()
            .ok_or(BackupError::InvalidTarget)?
            .to_owned();

        sqlx::query("VACUUM INTO $1")
            .bind(&temporary_name)
            .execute(&self.pool)
            .await?;

        let temporary_path: &Path = temporary.as_ref();
        let check_pool = SqlitePoolOptions::new()
            .max_connections(1)
            .connect_with(
                SqliteConnectOptions::new()
                    .filename(temporary_path)
                    .read_only(true),
            )
            .await?;
        let check: Vec<String> = sqlx::query_scalar("PRAGMA integrity_check")
            .fetch_all(&check_pool)
            .await?;
        check_pool.close().await;
        if check != ["ok"] {
            return Err(BackupError::IntegrityCheckFailed);
        }

        match temporary.persist_noclobber(destination) {
            Ok(()) => Ok(()),
            Err(error) if error.error.kind() == io::ErrorKind::AlreadyExists => {
                Err(BackupError::AlreadyExists)
            }
            Err(error) => Err(BackupError::Io(error.error)),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::database::INITIAL_SCHEMA_SQL;
    use sqlx::Row;

    async fn synthetic_store(dir: &Path) -> BackupStore {
        let pool = SqlitePoolOptions::new()
            .max_connections(1)
            .connect_with(
                SqliteConnectOptions::new()
                    .filename(dir.join("source.sqlite3"))
                    .create_if_missing(true),
            )
            .await
            .unwrap();
        sqlx::raw_sql(INITIAL_SCHEMA_SQL)
            .execute(&pool)
            .await
            .unwrap();
        sqlx::query("INSERT INTO settings (key, value_json, updated_at) VALUES ($1, $2, $3)")
            .bind("backup.synthetic")
            .bind(r#"{"value":"synthetic only"}"#)
            .bind("2026-01-01T00:00:00Z")
            .execute(&pool)
            .await
            .unwrap();
        BackupStore::new(pool)
    }

    #[tokio::test]
    async fn creates_consistent_backup_from_synthetic_sqlite() {
        let dir = tempfile::tempdir().unwrap();
        let store = synthetic_store(dir.path()).await;
        let backup = dir.path().join("backup.sqlite3");

        store.create_at(&backup).await.unwrap();

        let copy = SqlitePoolOptions::new()
            .max_connections(1)
            .connect_with(
                SqliteConnectOptions::new()
                    .filename(&backup)
                    .read_only(true),
            )
            .await
            .unwrap();
        let row = sqlx::query("SELECT value_json FROM settings WHERE key = $1")
            .bind("backup.synthetic")
            .fetch_one(&copy)
            .await
            .unwrap();
        assert_eq!(
            row.get::<String, _>("value_json"),
            r#"{"value":"synthetic only"}"#
        );
        copy.close().await;
    }

    #[tokio::test]
    async fn existing_destination_is_never_overwritten() {
        let dir = tempfile::tempdir().unwrap();
        let store = synthetic_store(dir.path()).await;
        let backup = dir.path().join("backup.sqlite3");
        std::fs::write(&backup, b"keep this file").unwrap();

        assert!(matches!(
            store.create_at(&backup).await,
            Err(BackupError::AlreadyExists)
        ));
        assert_eq!(std::fs::read(&backup).unwrap(), b"keep this file");
    }
}
