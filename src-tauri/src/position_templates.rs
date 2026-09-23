use crate::{
    database,
    local_profiles::{generate_profile_id, LocalProfileError, LocalProfileStore},
    restore::{self, RestoreInspectionError},
    workspace_templates::{workspace_template, WorkspaceTemplateError, WorkspaceTemplateStore},
};
use serde::Serialize;
use std::{io, path::Path};
use tempfile::NamedTempFile;

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PositionDatabaseTemplate {
    pub path: String,
    pub template_key: String,
    pub role_label: String,
    pub profile_display_name: String,
    pub schema_version: i64,
}

#[derive(Debug, thiserror::Error)]
pub(crate) enum PositionTemplateError {
    #[error("оберіть абсолютний шлях для нової порожньої бази")]
    InvalidTarget,
    #[error("файл уже існує; оберіть нове ім'я, щоб не перезаписати дані")]
    AlreadyExists,
    #[error("невідомий шаблон робочого простору")]
    UnknownTemplate,
    #[error("не вдалося створити порожню базу: {0}")]
    Io(#[from] io::Error),
    #[error(transparent)]
    Bootstrap(#[from] database::DatabaseBootstrapError),
    #[error(transparent)]
    Profile(#[from] LocalProfileError),
    #[error(transparent)]
    Workspace(#[from] WorkspaceTemplateError),
    #[error("створена база не пройшла перевірку: {0}")]
    Verification(#[from] RestoreInspectionError),
}

pub(crate) async fn create_position_database_template(
    destination: &Path,
    template_key: &str,
    created_at: &str,
) -> Result<PositionDatabaseTemplate, PositionTemplateError> {
    if !destination.is_absolute() || destination.file_name().is_none() {
        return Err(PositionTemplateError::InvalidTarget);
    }
    if destination.exists() || destination.symlink_metadata().is_ok() {
        return Err(PositionTemplateError::AlreadyExists);
    }
    let template =
        workspace_template(template_key).ok_or(PositionTemplateError::UnknownTemplate)?;
    let profile_display_name = format!("Робоче місце — {}", template.role_label);
    let profile_id = generate_profile_id(&profile_display_name, created_at);
    let parent = destination
        .parent()
        .ok_or(PositionTemplateError::InvalidTarget)?;
    let temporary = NamedTempFile::new_in(parent)?.into_temp_path();

    let pool = database::create_migrated_database(temporary.as_ref()).await?;
    let profiles = LocalProfileStore::new(pool.clone());
    profiles
        .create(&profile_id, &profile_display_name, created_at)
        .await?;
    WorkspaceTemplateStore::new(pool.clone())
        .assign(&profile_id, template.key, created_at)
        .await?;
    pool.close().await;

    let inspection = restore::inspect_backup(temporary.as_ref()).await?;
    match temporary.persist_noclobber(destination) {
        Ok(()) => Ok(PositionDatabaseTemplate {
            path: destination.to_string_lossy().into_owned(),
            template_key: template.key.to_owned(),
            role_label: template.role_label.to_owned(),
            profile_display_name,
            schema_version: inspection.schema_version,
        }),
        Err(error) if error.error.kind() == io::ErrorKind::AlreadyExists => {
            Err(PositionTemplateError::AlreadyExists)
        }
        Err(error) => Err(PositionTemplateError::Io(error.error)),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use sqlx::sqlite::{SqliteConnectOptions, SqlitePoolOptions};

    const NOW: &str = "2026-01-01T00:00:00Z";
    const TEMPLATE_KEYS: [&str; 5] = ["overview", "analysis", "quality", "registry", "entry"];

    async fn open_read_only(path: &Path) -> sqlx::SqlitePool {
        SqlitePoolOptions::new()
            .max_connections(1)
            .connect_with(SqliteConnectOptions::new().filename(path).read_only(true))
            .await
            .unwrap()
    }

    #[tokio::test]
    async fn creates_each_position_as_a_current_empty_easywar_database() {
        let directory = tempfile::tempdir().unwrap();

        for key in TEMPLATE_KEYS {
            let destination = directory.path().join(format!("{key}.sqlite3"));
            let created = create_position_database_template(&destination, key, NOW)
                .await
                .unwrap();
            assert_eq!(created.path, destination.to_string_lossy());
            assert_eq!(created.template_key, key);
            assert_eq!(created.schema_version, database::migrations().len() as i64);
            assert!(created.profile_display_name.starts_with("Робоче місце — "));
            assert_eq!(
                restore::inspect_backup(&destination)
                    .await
                    .unwrap()
                    .schema_version,
                created.schema_version
            );

            let pool = open_read_only(&destination).await;
            for table in [
                "raw_sources",
                "reports",
                "parsed_report_versions",
                "manual_corrections",
                "review_decisions",
                "revision_history",
                "audit_log",
                "settings",
                "xlsx_row_fingerprints",
            ] {
                let count: i64 = sqlx::query_scalar(&format!("SELECT count(*) FROM {table}"))
                    .fetch_one(&pool)
                    .await
                    .unwrap();
                assert_eq!(count, 0, "{table} must stay empty");
            }
            let profile: (String, String) =
                sqlx::query_as("SELECT id, display_name FROM local_profiles")
                    .fetch_one(&pool)
                    .await
                    .unwrap();
            let active: Option<String> = sqlx::query_scalar(
                "SELECT active_profile_id FROM local_profile_state WHERE singleton = 1",
            )
            .fetch_one(&pool)
            .await
            .unwrap();
            let assignment: (String, String) = sqlx::query_as(
                "SELECT profile_id, template_key FROM local_profile_workspace_templates",
            )
            .fetch_one(&pool)
            .await
            .unwrap();
            assert_eq!(profile.1, created.profile_display_name);
            assert_eq!(active.as_deref(), Some(profile.0.as_str()));
            assert_eq!(assignment, (profile.0, key.to_owned()));
            pool.close().await;
        }
    }

    #[tokio::test]
    async fn rejects_unknown_templates_without_creating_a_file() {
        let directory = tempfile::tempdir().unwrap();
        let destination = directory.path().join("unknown.sqlite3");
        assert!(matches!(
            create_position_database_template(&destination, "unknown", NOW).await,
            Err(PositionTemplateError::UnknownTemplate)
        ));
        assert!(!destination.exists());
    }

    #[tokio::test]
    async fn never_overwrites_an_existing_destination() {
        let directory = tempfile::tempdir().unwrap();
        let destination = directory.path().join("keep.sqlite3");
        std::fs::write(&destination, b"keep existing bytes").unwrap();
        assert!(matches!(
            create_position_database_template(&destination, "analysis", NOW).await,
            Err(PositionTemplateError::AlreadyExists)
        ));
        assert_eq!(std::fs::read(&destination).unwrap(), b"keep existing bytes");
    }
}
