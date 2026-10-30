use serde::Serialize;
use sha2::{Digest, Sha384};
use sqlx::migrate::{MigrateError, Migrator};
use sqlx::{sqlite::SqliteConnectOptions, sqlite::SqlitePoolOptions, SqlitePool};
use std::{path::Path, time::Duration};
use tauri_plugin_sql::{Migration, MigrationKind};

static EMBEDDED_MIGRATOR: Migrator = sqlx::migrate!("./migrations");

#[derive(Clone)]
pub struct DatabaseStatusStore {
    pool: SqlitePool,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum DatabaseMigrationState {
    Current,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DatabaseStatus {
    pub app_version: String,
    pub schema_version: i64,
    pub supported_schema_version: i64,
    pub migration_count: usize,
    pub migration_state: DatabaseMigrationState,
}

#[derive(Debug, thiserror::Error)]
pub enum DatabaseStatusError {
    #[error("не вдалося прочитати стан локальної SQLite-бази: {0}")]
    Database(#[from] sqlx::Error),
    #[error("у локальній базі відсутня повна історія міграцій EasyWAR")]
    UnsupportedSchema,
    #[error("контрольна сума застосованої міграції не відповідає EasyWAR")]
    MigrationMismatch,
}

impl DatabaseStatusStore {
    pub fn new(pool: SqlitePool) -> Self {
        Self { pool }
    }

    pub async fn load(&self) -> Result<DatabaseStatus, DatabaseStatusError> {
        let expected = migrations();
        let applied: Vec<(i64, i64, Vec<u8>)> = sqlx::query_as(
            "SELECT version, success, checksum FROM _sqlx_migrations ORDER BY version",
        )
        .fetch_all(&self.pool)
        .await?;
        if applied.len() != expected.len() {
            return Err(DatabaseStatusError::UnsupportedSchema);
        }
        for (actual, known) in applied.iter().zip(&expected) {
            if actual.0 != known.version || actual.1 != 1 {
                return Err(DatabaseStatusError::UnsupportedSchema);
            }
            if actual.2 != Sha384::digest(known.sql.as_bytes()).as_slice() {
                return Err(DatabaseStatusError::MigrationMismatch);
            }
        }
        let supported_schema_version = expected
            .last()
            .map(|migration| migration.version)
            .ok_or(DatabaseStatusError::UnsupportedSchema)?;
        Ok(DatabaseStatus {
            app_version: env!("CARGO_PKG_VERSION").to_owned(),
            schema_version: supported_schema_version,
            supported_schema_version,
            migration_count: expected.len(),
            migration_state: DatabaseMigrationState::Current,
        })
    }
}

/// The SQLite file is resolved by the Tauri SQL plugin inside the app-local
/// configuration directory. Runtime database files must never be committed.
pub const DATABASE_URL: &str = "sqlite:easywar.db";

pub(crate) const INITIAL_SCHEMA_SQL: &str =
    include_str!("../migrations/0001_provenance_schema.sql");
pub(crate) const XLSX_DUPLICATE_LINKS_SQL: &str =
    include_str!("../migrations/0002_xlsx_duplicate_links.sql");
pub(crate) const LOCAL_PROFILES_SQL: &str = include_str!("../migrations/0003_local_profiles.sql");
pub(crate) const WORKSPACE_TEMPLATES_SQL: &str =
    include_str!("../migrations/0004_workspace_templates.sql");
pub(crate) const PROFILE_DETAILS_SQL: &str = include_str!("../migrations/0005_profile_details.sql");
pub(crate) const PROFILE_BRANCH_TABLES_SQL: &str =
    include_str!("../migrations/0006_profile_branch_tables.sql");
pub(crate) const COMMAND_TABLES_SQL: &str = include_str!("../migrations/0007_command_tables.sql");
pub(crate) const OWN_LOSSES_TABLES_SQL: &str =
    include_str!("../migrations/0008_own_losses_tables.sql");
pub(crate) const PROFILE_MODULES_SQL: &str = include_str!("../migrations/0009_profile_modules.sql");
pub(crate) const DASHBOARD_MODULES_SQL: &str =
    include_str!("../migrations/0010_dashboard_modules.sql");
pub(crate) const DASHBOARD_MODULE_CORRECTIONS_SQL: &str =
    include_str!("../migrations/0011_dashboard_module_corrections.sql");
pub(crate) const DASHBOARD_MODULE_STYLE_SQL: &str =
    include_str!("../migrations/0012_dashboard_module_style.sql");
pub(crate) const OFFICE_LIBRARY_SQL: &str = include_str!("../migrations/0013_office_library.sql");
pub(crate) const DOCUMENT_LINKS_SQL: &str = include_str!("../migrations/0014_document_links.sql");
pub(crate) const LIBRARY_BLOB_REPAIR_SQL: &str =
    include_str!("../migrations/0015_library_blob_repair.sql");
pub(crate) const DASHBOARD_MODULE_CORRECTION_STATUS_SQL: &str =
    include_str!("../migrations/0016_dashboard_module_correction_status.sql");
pub(crate) const PROFILE_SCHEMAS_SQL: &str = include_str!("../migrations/0017_profile_schemas.sql");
pub(crate) const DASHBOARD_LAYOUTS_SQL: &str =
    include_str!("../migrations/0018_dashboard_layouts.sql");
pub(crate) const COLLECTIVES_SQL: &str = include_str!("../migrations/0019_collectives.sql");
pub(crate) const COLLECTIVE_SYNC_SQL: &str = include_str!("../migrations/0020_collective_sync.sql");
pub(crate) const CUSTOM_MODULE_SQL: &str = include_str!("../migrations/0021_custom_module.sql");
pub(crate) const ARMY_AVIATION_SQL: &str = include_str!("../migrations/0022_army_aviation.sql");

pub fn migrations() -> Vec<Migration> {
    vec![
        Migration {
            version: 1,
            description: "create_provenance_schema",
            sql: INITIAL_SCHEMA_SQL,
            kind: MigrationKind::Up,
        },
        Migration {
            version: 2,
            description: "add_xlsx_duplicate_links",
            sql: XLSX_DUPLICATE_LINKS_SQL,
            kind: MigrationKind::Up,
        },
        Migration {
            version: 3,
            description: "add_local_profiles",
            sql: LOCAL_PROFILES_SQL,
            kind: MigrationKind::Up,
        },
        Migration {
            version: 4,
            description: "add_workspace_templates",
            sql: WORKSPACE_TEMPLATES_SQL,
            kind: MigrationKind::Up,
        },
        Migration {
            version: 5,
            description: "add_profile_details",
            sql: PROFILE_DETAILS_SQL,
            kind: MigrationKind::Up,
        },
        Migration {
            version: 6,
            description: "add_profile_branch_tables",
            sql: PROFILE_BRANCH_TABLES_SQL,
            kind: MigrationKind::Up,
        },
        Migration {
            version: 7,
            description: "add_command_tables",
            sql: COMMAND_TABLES_SQL,
            kind: MigrationKind::Up,
        },
        Migration {
            version: 8,
            description: "add_own_losses_tables",
            sql: OWN_LOSSES_TABLES_SQL,
            kind: MigrationKind::Up,
        },
        Migration {
            version: 9,
            description: "add_profile_modules",
            sql: PROFILE_MODULES_SQL,
            kind: MigrationKind::Up,
        },
        Migration {
            version: 10,
            description: "add_dashboard_modules",
            sql: DASHBOARD_MODULES_SQL,
            kind: MigrationKind::Up,
        },
        Migration {
            version: 11,
            description: "add_dashboard_module_corrections",
            sql: DASHBOARD_MODULE_CORRECTIONS_SQL,
            kind: MigrationKind::Up,
        },
        Migration {
            version: 12,
            description: "add_dashboard_module_style",
            sql: DASHBOARD_MODULE_STYLE_SQL,
            kind: MigrationKind::Up,
        },
        Migration {
            version: 13,
            description: "add_office_library",
            sql: OFFICE_LIBRARY_SQL,
            kind: MigrationKind::Up,
        },
        Migration {
            version: 14,
            description: "add_document_links",
            sql: DOCUMENT_LINKS_SQL,
            kind: MigrationKind::Up,
        },
        Migration {
            version: 15,
            description: "allow_library_blob_repair",
            sql: LIBRARY_BLOB_REPAIR_SQL,
            kind: MigrationKind::Up,
        },
        Migration {
            version: 16,
            description: "add_dashboard_module_correction_status",
            sql: DASHBOARD_MODULE_CORRECTION_STATUS_SQL,
            kind: MigrationKind::Up,
        },
        Migration {
            version: 17,
            description: "add_profile_schemas",
            sql: PROFILE_SCHEMAS_SQL,
            kind: MigrationKind::Up,
        },
        Migration {
            version: 18,
            description: "add_dashboard_layouts",
            sql: DASHBOARD_LAYOUTS_SQL,
            kind: MigrationKind::Up,
        },
        Migration {
            version: 19,
            description: "add_collectives",
            sql: COLLECTIVES_SQL,
            kind: MigrationKind::Up,
        },
        Migration {
            version: 20,
            description: "add_collective_sync",
            sql: COLLECTIVE_SYNC_SQL,
            kind: MigrationKind::Up,
        },
        Migration {
            version: 21,
            description: "add_custom_module",
            sql: CUSTOM_MODULE_SQL,
            kind: MigrationKind::Up,
        },
        Migration {
            version: 22,
            description: "add_army_aviation",
            sql: ARMY_AVIATION_SQL,
            kind: MigrationKind::Up,
        },
    ]
}

#[derive(Debug, thiserror::Error)]
pub(crate) enum DatabaseBootstrapError {
    #[error("не вдалося відкрити локальну SQLite-базу: {0}")]
    Database(#[from] sqlx::Error),
    #[error("не вдалося застосувати вбудовані міграції EasyWAR: {0}")]
    Migration(#[from] MigrateError),
}

pub(crate) fn embedded_migrator() -> &'static Migrator {
    &EMBEDDED_MIGRATOR
}

pub(crate) fn latest_schema_version() -> Option<i64> {
    EMBEDDED_MIGRATOR
        .iter()
        .last()
        .map(|migration| migration.version)
}

/// З'єднання, що пише в базу EasyWAR: `secure_delete` затирає нулями звільнені комірки
/// й сторінки, тож старі обгортки ключа бібліотеки (після зміни пароля, нового коду
/// відновлення, «Забули пароль?») і вміст після криптознищення не лишаються у вільному
/// місці файла. Діє на кожне з'єднання окремо, тому задається для кожного пулу, що пише.
pub(crate) fn writable_connect_options(path: &Path) -> SqliteConnectOptions {
    SqliteConnectOptions::new()
        .filename(path)
        .foreign_keys(true)
        .pragma("secure_delete", "ON")
}

/// Робоча база застосунку: як [`writable_connect_options`] і з очікуванням блокування.
pub(crate) fn live_connect_options(path: &Path) -> SqliteConnectOptions {
    writable_connect_options(path).busy_timeout(Duration::from_secs(5))
}

pub(crate) async fn migrate_database_file_with(
    path: &Path,
    migrator: &Migrator,
) -> Result<SqlitePool, DatabaseBootstrapError> {
    let pool = SqlitePoolOptions::new()
        .max_connections(1)
        .connect_with(writable_connect_options(path).create_if_missing(true))
        .await?;
    if let Err(error) = migrator.run(&pool).await {
        pool.close().await;
        return Err(error.into());
    }
    Ok(pool)
}

/// Create a standalone EasyWAR database by running the authoritative embedded
/// migration files. There is deliberately no copied schema or SQL dump here.
/// Callers publish the file only after closing and validating the database.
pub(crate) async fn create_migrated_database(
    path: &Path,
) -> Result<SqlitePool, DatabaseBootstrapError> {
    migrate_database_file_with(path, embedded_migrator()).await
}

#[cfg(test)]
mod tests {
    use super::{
        create_migrated_database, migrations, DatabaseMigrationState, DatabaseStatusError,
        DatabaseStatusStore, ARMY_AVIATION_SQL, COLLECTIVES_SQL, COLLECTIVE_SYNC_SQL,
        COMMAND_TABLES_SQL, CUSTOM_MODULE_SQL, DASHBOARD_LAYOUTS_SQL, DASHBOARD_MODULES_SQL,
        DASHBOARD_MODULE_CORRECTIONS_SQL, DASHBOARD_MODULE_CORRECTION_STATUS_SQL,
        DASHBOARD_MODULE_STYLE_SQL, DATABASE_URL, DOCUMENT_LINKS_SQL, EMBEDDED_MIGRATOR,
        INITIAL_SCHEMA_SQL, LIBRARY_BLOB_REPAIR_SQL, LOCAL_PROFILES_SQL, OFFICE_LIBRARY_SQL,
        OWN_LOSSES_TABLES_SQL, PROFILE_BRANCH_TABLES_SQL, PROFILE_DETAILS_SQL, PROFILE_MODULES_SQL,
        PROFILE_SCHEMAS_SQL, WORKSPACE_TEMPLATES_SQL, XLSX_DUPLICATE_LINKS_SQL,
    };
    use super::{live_connect_options, writable_connect_options};
    use sqlx::{sqlite::SqlitePoolOptions, Row};
    use std::path::Path;

    #[test]
    fn database_is_local_and_registers_versioned_migrations() {
        assert_eq!(DATABASE_URL, "sqlite:easywar.db");
        assert!(include_str!("../tauri.conf.json").contains(DATABASE_URL));
        let registered = migrations();
        assert_eq!(registered.len(), 22);
        assert_eq!(registered[0].version, 1);
        assert_eq!(registered[0].description, "create_provenance_schema");
        assert_eq!(registered[1].version, 2);
        assert_eq!(registered[1].description, "add_xlsx_duplicate_links");
        assert_eq!(registered[2].version, 3);
        assert_eq!(registered[2].description, "add_local_profiles");
        assert_eq!(registered[3].version, 4);
        assert_eq!(registered[3].description, "add_workspace_templates");
        assert_eq!(registered[4].version, 5);
        assert_eq!(registered[4].description, "add_profile_details");
        assert_eq!(registered[5].version, 6);
        assert_eq!(registered[5].description, "add_profile_branch_tables");
        assert_eq!(registered[6].version, 7);
        assert_eq!(registered[6].description, "add_command_tables");
        assert_eq!(registered[7].version, 8);
        assert_eq!(registered[7].description, "add_own_losses_tables");
        assert_eq!(registered[8].version, 9);
        assert_eq!(registered[8].description, "add_profile_modules");
        assert_eq!(registered[9].version, 10);
        assert_eq!(registered[9].description, "add_dashboard_modules");
        assert_eq!(registered[10].version, 11);
        assert_eq!(
            registered[10].description,
            "add_dashboard_module_corrections"
        );
        assert_eq!(registered[11].version, 12);
        assert_eq!(registered[11].description, "add_dashboard_module_style");
        assert_eq!(registered[12].version, 13);
        assert_eq!(registered[12].description, "add_office_library");
        assert_eq!(registered[13].version, 14);
        assert_eq!(registered[13].description, "add_document_links");
        assert_eq!(registered[14].version, 15);
        assert_eq!(registered[14].description, "allow_library_blob_repair");
        assert_eq!(registered[15].version, 16);
        assert_eq!(
            registered[15].description,
            "add_dashboard_module_correction_status"
        );
        assert_eq!(registered[16].version, 17);
        assert_eq!(registered[16].description, "add_profile_schemas");
        assert_eq!(registered[17].version, 18);
        assert_eq!(registered[17].description, "add_dashboard_layouts");
        assert_eq!(registered[18].version, 19);
        assert_eq!(registered[18].description, "add_collectives");
        assert_eq!(registered[19].version, 20);
        assert_eq!(registered[19].description, "add_collective_sync");
        assert_eq!(
            EMBEDDED_MIGRATOR
                .iter()
                .map(|migration| migration.version)
                .collect::<Vec<_>>(),
            registered
                .iter()
                .map(|migration| migration.version)
                .collect::<Vec<_>>()
        );
        assert_eq!(
            EMBEDDED_MIGRATOR
                .iter()
                .map(|migration| migration.sql.as_ref())
                .collect::<Vec<_>>(),
            registered
                .iter()
                .map(|migration| migration.sql)
                .collect::<Vec<_>>()
        );
        assert_eq!(super::latest_schema_version(), Some(22));
    }

    #[tokio::test]
    async fn database_status_reports_the_verified_runtime_migration_state() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("status.sqlite3");
        let pool = create_migrated_database(&path).await.unwrap();
        assert_eq!(
            DatabaseStatusStore::new(pool.clone()).load().await.unwrap(),
            super::DatabaseStatus {
                app_version: env!("CARGO_PKG_VERSION").to_owned(),
                schema_version: 22,
                supported_schema_version: 22,
                migration_count: 22,
                migration_state: DatabaseMigrationState::Current,
            }
        );

        sqlx::query("UPDATE _sqlx_migrations SET checksum = ? WHERE version = 1")
            .bind(vec![0_u8; 48])
            .execute(&pool)
            .await
            .unwrap();
        assert!(matches!(
            DatabaseStatusStore::new(pool.clone()).load().await,
            Err(DatabaseStatusError::MigrationMismatch)
        ));
        pool.close().await;
    }

    async fn migrated_pool() -> sqlx::SqlitePool {
        let pool = migrated_pool_before_custom_module().await;
        for migration in [CUSTOM_MODULE_SQL, ARMY_AVIATION_SQL] {
            sqlx::raw_sql(migration)
                .execute(&pool)
                .await
                .expect("custom module and army aviation migrations must apply");
        }
        pool
    }

    /// База до 0021: щоб тест міграції «Власного модуля» наповнив старі таблиці й застосував її сам.
    async fn migrated_pool_before_custom_module() -> sqlx::SqlitePool {
        let pool = SqlitePoolOptions::new()
            .max_connections(1)
            .connect("sqlite::memory:")
            .await
            .expect("synthetic in-memory SQLite must open");

        sqlx::raw_sql(INITIAL_SCHEMA_SQL)
            .execute(&pool)
            .await
            .expect("initial migration must apply");
        sqlx::raw_sql(XLSX_DUPLICATE_LINKS_SQL)
            .execute(&pool)
            .await
            .expect("XLSX duplicate migration must apply");
        sqlx::raw_sql(LOCAL_PROFILES_SQL)
            .execute(&pool)
            .await
            .expect("local profiles migration must apply");
        sqlx::raw_sql(WORKSPACE_TEMPLATES_SQL)
            .execute(&pool)
            .await
            .expect("workspace templates migration must apply");
        sqlx::raw_sql(PROFILE_DETAILS_SQL)
            .execute(&pool)
            .await
            .expect("profile details migration must apply");
        sqlx::raw_sql(PROFILE_BRANCH_TABLES_SQL)
            .execute(&pool)
            .await
            .expect("profile branch tables migration must apply");
        sqlx::raw_sql(COMMAND_TABLES_SQL)
            .execute(&pool)
            .await
            .expect("command tables migration must apply");
        sqlx::raw_sql(OWN_LOSSES_TABLES_SQL)
            .execute(&pool)
            .await
            .expect("own losses tables migration must apply");
        sqlx::raw_sql(PROFILE_MODULES_SQL)
            .execute(&pool)
            .await
            .expect("profile modules migration must apply");
        sqlx::raw_sql(DASHBOARD_MODULES_SQL)
            .execute(&pool)
            .await
            .expect("dashboard modules migration must apply");
        sqlx::raw_sql(DASHBOARD_MODULE_CORRECTIONS_SQL)
            .execute(&pool)
            .await
            .expect("dashboard module corrections migration must apply");
        sqlx::raw_sql(DASHBOARD_MODULE_STYLE_SQL)
            .execute(&pool)
            .await
            .expect("dashboard module style migration must apply");
        sqlx::raw_sql(OFFICE_LIBRARY_SQL)
            .execute(&pool)
            .await
            .expect("office library migration must apply");
        sqlx::raw_sql(DOCUMENT_LINKS_SQL)
            .execute(&pool)
            .await
            .expect("document links migration must apply");
        sqlx::raw_sql(LIBRARY_BLOB_REPAIR_SQL)
            .execute(&pool)
            .await
            .expect("library blob repair migration must apply");
        sqlx::raw_sql(DASHBOARD_MODULE_CORRECTION_STATUS_SQL)
            .execute(&pool)
            .await
            .expect("dashboard module correction status migration must apply");
        sqlx::raw_sql(PROFILE_SCHEMAS_SQL)
            .execute(&pool)
            .await
            .expect("profile schemas migration must apply");
        sqlx::raw_sql(DASHBOARD_LAYOUTS_SQL)
            .execute(&pool)
            .await
            .expect("dashboard layouts migration must apply");
        sqlx::raw_sql(COLLECTIVES_SQL)
            .execute(&pool)
            .await
            .expect("collectives migration must apply");
        sqlx::raw_sql(COLLECTIVE_SYNC_SQL)
            .execute(&pool)
            .await
            .expect("collective sync migration must apply");

        pool
    }

    #[tokio::test]
    async fn local_profile_migration_starts_empty_with_one_state_row() {
        let pool = migrated_pool().await;
        let profile_count: i64 = sqlx::query_scalar("SELECT count(*) FROM local_profiles")
            .fetch_one(&pool)
            .await
            .unwrap();
        let state: (i64, Option<String>) =
            sqlx::query_as("SELECT singleton, active_profile_id FROM local_profile_state")
                .fetch_one(&pool)
                .await
                .unwrap();
        assert_eq!(profile_count, 0);
        assert_eq!(state, (1, None));
        let template_count: i64 =
            sqlx::query_scalar("SELECT count(*) FROM local_profile_workspace_templates")
                .fetch_one(&pool)
                .await
                .unwrap();
        assert_eq!(template_count, 0);
    }

    #[tokio::test]
    async fn xlsx_fingerprints_are_immutable_and_cannot_self_link() {
        let pool = migrated_pool().await;
        let now = "2026-01-01T00:00:00Z";

        for suffix in ["a", "b"] {
            sqlx::query(
                "INSERT INTO raw_sources
                 (id, source_type, captured_at, content_type, raw_text, raw_sha256, created_at)
                 VALUES (?, 'XLSX', ?, 'text/plain', 'synthetic', ?, ?)",
            )
            .bind(format!("source-fingerprint-{suffix}"))
            .bind(now)
            .bind(if suffix == "a" { "a" } else { "b" }.repeat(64))
            .bind(now)
            .execute(&pool)
            .await
            .expect("synthetic source must insert");
            sqlx::query(
                "INSERT INTO reports (id, raw_source_id, source_item_key, created_at)
                 VALUES (?, ?, ?, ?)",
            )
            .bind(format!("report-fingerprint-{suffix}"))
            .bind(format!("source-fingerprint-{suffix}"))
            .bind(format!("row-{suffix}"))
            .bind(now)
            .execute(&pool)
            .await
            .expect("synthetic report must insert");
        }

        sqlx::query(
            "INSERT INTO xlsx_row_fingerprints
             (report_id, fingerprint_sha256, duplicate_of_report_id, recorded_at)
             VALUES ('report-fingerprint-b', ?, 'report-fingerprint-a', ?)",
        )
        .bind("c".repeat(64))
        .bind(now)
        .execute(&pool)
        .await
        .expect("synthetic duplicate link must insert");

        assert!(sqlx::query(
            "UPDATE xlsx_row_fingerprints SET duplicate_of_report_id = NULL
             WHERE report_id = 'report-fingerprint-b'",
        )
        .execute(&pool)
        .await
        .is_err());
        assert!(sqlx::query(
            "DELETE FROM xlsx_row_fingerprints
             WHERE report_id = 'report-fingerprint-b'",
        )
        .execute(&pool)
        .await
        .is_err());
        assert!(sqlx::query(
            "INSERT INTO xlsx_row_fingerprints
             (report_id, fingerprint_sha256, duplicate_of_report_id, recorded_at)
             VALUES ('report-fingerprint-a', ?, 'report-fingerprint-a', ?)",
        )
        .bind("d".repeat(64))
        .bind(now)
        .execute(&pool)
        .await
        .is_err());
    }

    #[tokio::test]
    async fn migration_preserves_provenance_layers_and_current_state() {
        let pool = migrated_pool().await;
        let now = "2026-01-01T00:00:00Z";

        sqlx::query(
            "INSERT INTO raw_sources
             (id, source_type, captured_at, content_type, raw_text, raw_sha256, created_at)
             VALUES (?, 'PASTE', ?, 'text/plain', ?, ?, ?)",
        )
        .bind("source-synthetic-1")
        .bind(now)
        .bind("Синтетична доповідь без реальних даних")
        .bind("0".repeat(64))
        .bind(now)
        .execute(&pool)
        .await
        .expect("synthetic raw source must insert");

        sqlx::query(
            "INSERT INTO reports (id, raw_source_id, source_item_key, created_at)
             VALUES (?, ?, ?, ?)",
        )
        .bind("report-synthetic-1")
        .bind("source-synthetic-1")
        .bind("item-1")
        .bind(now)
        .execute(&pool)
        .await
        .expect("synthetic report must insert");

        let initial_state: String =
            sqlx::query("SELECT current_status FROM report_current_state WHERE report_id = ?")
                .bind("report-synthetic-1")
                .fetch_one(&pool)
                .await
                .expect("new state must exist")
                .get("current_status");
        assert_eq!(initial_state, "NEW");

        sqlx::query(
            "INSERT INTO parsed_report_versions
             (id, report_id, version, parser_name, parser_version, parsed_payload_json, parsed_at)
             VALUES (?, ?, 1, 'synthetic-parser', 'test-1', ?, ?)",
        )
        .bind("parse-synthetic-1")
        .bind("report-synthetic-1")
        .bind(r#"{"synthetic":true,"result":"UNKNOWN"}"#)
        .bind(now)
        .execute(&pool)
        .await
        .expect("synthetic parse must insert");

        sqlx::query(
            "INSERT INTO manual_corrections
             (id, report_id, correction_number, parsed_version_id, field_path,
              prior_value_json, corrected_value_json, reason, created_by, created_at)
             VALUES (?, ?, 1, ?, '$.result', ?, ?, 'synthetic correction', 'tester', ?)",
        )
        .bind("correction-synthetic-1")
        .bind("report-synthetic-1")
        .bind("parse-synthetic-1")
        .bind(r#""UNKNOWN""#)
        .bind(r#""REVIEWED""#)
        .bind(now)
        .execute(&pool)
        .await
        .expect("synthetic correction must insert");

        sqlx::query(
            "INSERT INTO review_decisions
             (id, report_id, decision_number, parsed_version_id, decision,
              decided_by, rationale, decided_at)
             VALUES (?, ?, 1, ?, 'APPROVED', 'tester', 'synthetic approval', ?)",
        )
        .bind("decision-synthetic-1")
        .bind("report-synthetic-1")
        .bind("parse-synthetic-1")
        .bind(now)
        .execute(&pool)
        .await
        .expect("synthetic decision must insert");

        sqlx::query(
            "INSERT INTO revision_history
             (id, report_id, revision_number, parsed_version_id, review_decision_id,
              snapshot_json, change_summary, created_by, created_at)
             VALUES (?, ?, 1, ?, ?, ?, 'synthetic first revision', 'tester', ?)",
        )
        .bind("revision-synthetic-1")
        .bind("report-synthetic-1")
        .bind("parse-synthetic-1")
        .bind("decision-synthetic-1")
        .bind(r#"{"synthetic":true,"result":"REVIEWED"}"#)
        .bind(now)
        .execute(&pool)
        .await
        .expect("synthetic revision must insert");

        sqlx::query(
            "INSERT INTO audit_log
             (id, report_id, entity_type, entity_id, action, actor_type,
              actor_label, details_json, occurred_at)
             VALUES (?, ?, 'report', ?, 'APPROVED', 'USER', 'tester', ?, ?)",
        )
        .bind("audit-synthetic-1")
        .bind("report-synthetic-1")
        .bind("report-synthetic-1")
        .bind(r#"{"synthetic":true}"#)
        .bind(now)
        .execute(&pool)
        .await
        .expect("synthetic audit event must insert");

        sqlx::query("INSERT INTO settings (key, value_json, updated_at) VALUES (?, ?, ?)")
            .bind("ui.synthetic")
            .bind(r#"{"enabled":false}"#)
            .bind(now)
            .execute(&pool)
            .await
            .expect("synthetic setting must insert");

        let approved_state: String =
            sqlx::query("SELECT current_status FROM report_current_state WHERE report_id = ?")
                .bind("report-synthetic-1")
                .fetch_one(&pool)
                .await
                .expect("approved state must exist")
                .get("current_status");
        assert_eq!(approved_state, "APPROVED");

        let layer_counts: (i64, i64, i64, i64) = sqlx::query_as(
            "SELECT
                (SELECT count(*) FROM raw_sources),
                (SELECT count(*) FROM parsed_report_versions),
                (SELECT count(*) FROM manual_corrections),
                (SELECT count(*) FROM review_decisions)",
        )
        .fetch_one(&pool)
        .await
        .expect("provenance counts must query");
        assert_eq!(layer_counts, (1, 1, 1, 1));
    }

    #[tokio::test]
    async fn raw_sources_and_audit_events_are_immutable() {
        let pool = migrated_pool().await;
        let now = "2026-01-01T00:00:00Z";

        sqlx::query(
            "INSERT INTO raw_sources
             (id, source_type, captured_at, content_type, raw_text, raw_sha256, created_at)
             VALUES ('source-synthetic-2', 'OTHER', ?, 'text/plain', 'synthetic', ?, ?)",
        )
        .bind(now)
        .bind("1".repeat(64))
        .bind(now)
        .execute(&pool)
        .await
        .expect("synthetic raw source must insert");

        let raw_update = sqlx::query(
            "UPDATE raw_sources SET raw_text = 'changed' WHERE id = 'source-synthetic-2'",
        )
        .execute(&pool)
        .await;
        assert!(raw_update.is_err());

        sqlx::query(
            "INSERT INTO audit_log
             (id, entity_type, entity_id, action, actor_type, details_json, occurred_at)
             VALUES ('audit-synthetic-2', 'source', 'source-synthetic-2',
                     'CAPTURED', 'SYSTEM', '{\"synthetic\":true}', ?)",
        )
        .bind(now)
        .execute(&pool)
        .await
        .expect("synthetic audit event must insert");

        let audit_delete = sqlx::query("DELETE FROM audit_log WHERE id = 'audit-synthetic-2'")
            .execute(&pool)
            .await;
        assert!(audit_delete.is_err());
    }

    #[tokio::test]
    async fn corrections_cannot_reference_another_reports_parse() {
        let pool = migrated_pool().await;
        let now = "2026-01-01T00:00:00Z";

        sqlx::query(
            "INSERT INTO raw_sources
             (id, source_type, captured_at, content_type, raw_text, raw_sha256, created_at)
             VALUES ('source-synthetic-3', 'OTHER', ?, 'text/plain', 'synthetic', ?, ?)",
        )
        .bind(now)
        .bind("2".repeat(64))
        .bind(now)
        .execute(&pool)
        .await
        .expect("synthetic raw source must insert");

        for report_id in ["report-synthetic-3a", "report-synthetic-3b"] {
            sqlx::query(
                "INSERT INTO reports (id, raw_source_id, source_item_key, created_at)
                 VALUES (?, 'source-synthetic-3', ?, ?)",
            )
            .bind(report_id)
            .bind(report_id)
            .bind(now)
            .execute(&pool)
            .await
            .expect("synthetic report must insert");
        }

        sqlx::query(
            "INSERT INTO parsed_report_versions
             (id, report_id, version, parser_name, parser_version, parsed_payload_json, parsed_at)
             VALUES ('parse-synthetic-3a', 'report-synthetic-3a', 1,
                     'synthetic-parser', 'test-1', '{\"synthetic\":true}', ?)",
        )
        .bind(now)
        .execute(&pool)
        .await
        .expect("synthetic parse must insert");

        let cross_report_correction = sqlx::query(
            "INSERT INTO manual_corrections
             (id, report_id, correction_number, parsed_version_id, field_path,
              corrected_value_json, created_by, created_at)
             VALUES ('correction-synthetic-3b', 'report-synthetic-3b', 1,
                     'parse-synthetic-3a', '$.synthetic', 'false', 'tester', ?)",
        )
        .bind(now)
        .execute(&pool)
        .await;

        assert!(cross_report_correction.is_err());
    }

    /// Синтетичний модуль для перевірки таблиці виправлень: профіль, модуль і два записи
    /// виправлень. Таблиця даних модуля тут не потрібна — виправлення посилаються на неї лише
    /// номером запису.
    async fn module_with_corrections(pool: &sqlx::SqlitePool) {
        let now = "2026-01-01T00:00:00Z";
        sqlx::query(
            "INSERT INTO local_profiles (id, display_name, name_key, created_at, updated_at)
             VALUES ('profile-c0c0c0c0c0c0c0c0c0c0c0c0', 'Синтетичний', 'синтетичний', ?, ?)",
        )
        .bind(now)
        .bind(now)
        .execute(pool)
        .await
        .unwrap();
        sqlx::query(
            "INSERT INTO dashboard_modules
             (id, profile_id, branch, template_id, visual_kind, title, storage_table, created_at, updated_at)
             VALUES ('dashboard-corrections-01', 'profile-c0c0c0c0c0c0c0c0c0c0c0c0', 'air', 'flight-hours', 'horizontal-bar',
                     'Журнал', 'dashboard_data_000000000000000000000001', ?, ?)",
        )
        .bind(now)
        .bind(now)
        .execute(pool)
        .await
        .unwrap();
        for (row_id, field_key, raw, corrected) in [
            (1_i64, "takeoff_time", "25:00", "14:25"),
            (1_i64, "flight_altitude", "0,3", "300 м"),
        ] {
            sqlx::query(
                "INSERT INTO dashboard_module_corrections
                 (module_id, row_id, field_key, source_file, source_sheet, source_row, source_column,
                  raw_text, corrected_text, reason, created_at)
                 VALUES ('dashboard-corrections-01', ?, ?, 'Журнал_синтетичний.xlsx', 'Журнал', 8, 'Зліт', ?, ?, 'не розібрано', ?)",
            )
            .bind(row_id)
            .bind(field_key)
            .bind(raw)
            .bind(corrected)
            .bind(now)
            .execute(pool)
            .await
            .unwrap();
        }
    }

    #[tokio::test]
    async fn correction_status_migration_keeps_old_corrections_and_marks_them_unknown() {
        // База до міграції 0016 з виправленням: після міграції воно лишається як було,
        // а канонічного значення й позначки перекриття в нього немає.
        let pool = SqlitePoolOptions::new()
            .max_connections(1)
            .connect("sqlite::memory:")
            .await
            .unwrap();
        for sql in [
            INITIAL_SCHEMA_SQL,
            XLSX_DUPLICATE_LINKS_SQL,
            LOCAL_PROFILES_SQL,
            WORKSPACE_TEMPLATES_SQL,
            PROFILE_DETAILS_SQL,
            PROFILE_BRANCH_TABLES_SQL,
            COMMAND_TABLES_SQL,
            OWN_LOSSES_TABLES_SQL,
            PROFILE_MODULES_SQL,
            DASHBOARD_MODULES_SQL,
            DASHBOARD_MODULE_CORRECTIONS_SQL,
            DASHBOARD_MODULE_STYLE_SQL,
            OFFICE_LIBRARY_SQL,
            DOCUMENT_LINKS_SQL,
            LIBRARY_BLOB_REPAIR_SQL,
        ] {
            sqlx::raw_sql(sql).execute(&pool).await.unwrap();
        }
        module_with_corrections(&pool).await;
        sqlx::raw_sql(DASHBOARD_MODULE_CORRECTION_STATUS_SQL)
            .execute(&pool)
            .await
            .unwrap();
        let kept: Vec<(String, String, Option<String>, Option<String>)> = sqlx::query_as(
            "SELECT raw_text, corrected_text, stored_value, superseded_at
             FROM dashboard_module_corrections ORDER BY id",
        )
        .fetch_all(&pool)
        .await
        .unwrap();
        assert!(!kept.is_empty());
        for (raw, corrected, stored, superseded) in kept {
            assert!(!raw.is_empty() || !corrected.is_empty());
            assert_eq!(stored, None);
            assert_eq!(superseded, None);
        }
    }

    #[tokio::test]
    async fn dashboard_module_corrections_migration_keeps_raw_and_corrected_text_apart() {
        let pool = migrated_pool().await;
        let columns =
            sqlx::query("SELECT name FROM pragma_table_info('dashboard_module_corrections')")
                .fetch_all(&pool)
                .await
                .unwrap()
                .into_iter()
                .map(|row| row.get::<String, _>("name"))
                .collect::<Vec<_>>();
        assert_eq!(
            columns,
            [
                "id",
                "module_id",
                "row_id",
                "field_key",
                "source_file",
                "source_sheet",
                "source_row",
                "source_column",
                "raw_text",
                "corrected_text",
                "reason",
                "created_at",
                "stored_value",
                "superseded_at"
            ]
        );
        module_with_corrections(&pool).await;
        let stored: Vec<(String, String)> = sqlx::query_as(
            "SELECT raw_text, corrected_text FROM dashboard_module_corrections ORDER BY id",
        )
        .fetch_all(&pool)
        .await
        .unwrap();
        assert_eq!(
            stored,
            [
                ("25:00".to_owned(), "14:25".to_owned()),
                ("0,3".to_owned(), "300 м".to_owned())
            ]
        );

        // Одне поле запису — одне виправлення; порожній виправлений текст і неіснуючий модуль відхиляються.
        let insert = "INSERT INTO dashboard_module_corrections
             (module_id, row_id, field_key, source_file, source_sheet, source_row, source_column,
              raw_text, corrected_text, reason, created_at)
             VALUES (?, ?, ?, 'Журнал_синтетичний.xlsx', 'Журнал', 8, 'Зліт', '25:00', ?, '', '2026-01-01T00:00:00Z')";
        for (module_id, row_id, field_key, corrected) in [
            ("dashboard-corrections-01", 1_i64, "takeoff_time", "14:30"),
            ("dashboard-corrections-01", 2_i64, "takeoff_time", "   "),
            ("dashboard-corrections-01", 0_i64, "takeoff_time", "14:30"),
            ("dashboard-missing-module", 1_i64, "takeoff_time", "14:30"),
        ] {
            assert!(
                sqlx::query(insert)
                    .bind(module_id)
                    .bind(row_id)
                    .bind(field_key)
                    .bind(corrected)
                    .execute(&pool)
                    .await
                    .is_err(),
                "{module_id} {row_id} {field_key} «{corrected}» мало бути відхилено"
            );
        }

        // Видалення модуля (або профілю) забирає і його виправлення.
        sqlx::query("DELETE FROM dashboard_modules WHERE id = 'dashboard-corrections-01'")
            .execute(&pool)
            .await
            .unwrap();
        let left: i64 = sqlx::query_scalar("SELECT count(*) FROM dashboard_module_corrections")
            .fetch_one(&pool)
            .await
            .unwrap();
        assert_eq!(left, 0);
    }

    #[tokio::test]
    async fn dashboard_module_style_migration_defaults_existing_modules_to_standard() {
        let pool = migrated_pool().await;
        module_with_corrections(&pool).await;
        let style: String = sqlx::query_scalar(
            "SELECT style FROM dashboard_modules WHERE id = 'dashboard-corrections-01'",
        )
        .fetch_one(&pool)
        .await
        .unwrap();
        assert_eq!(style, "standard");
        for (value, accepted) in [
            ("branch", true),
            ("heightwell", true),
            ("neon", false),
            ("", false),
        ] {
            let result = sqlx::query(
                "UPDATE dashboard_modules SET style = ? WHERE id = 'dashboard-corrections-01'",
            )
            .bind(value)
            .execute(&pool)
            .await;
            assert_eq!(result.is_ok(), accepted, "стиль «{value}»");
        }
    }

    #[tokio::test]
    async fn custom_module_migration_keeps_modules_fields_and_corrections_and_admits_custom() {
        let pool = migrated_pool_before_custom_module().await;
        module_with_corrections(&pool).await;
        sqlx::query(
            "INSERT INTO dashboard_module_fields
             (module_id, field_key, label, data_type, field_role, aggregation, required, position)
             VALUES ('dashboard-corrections-01', 'takeoff_time', 'Зліт', 'datetime', 'dimension', 'none', 1, 0)",
        )
        .execute(&pool)
        .await
        .unwrap();
        sqlx::query(
            "UPDATE dashboard_modules SET style = 'heightwell' WHERE id = 'dashboard-corrections-01'",
        )
        .execute(&pool)
        .await
        .unwrap();
        for (table, column) in [
            ("local_profile_modules", "module"),
            ("dashboard_modules", "branch"),
        ] {
            let message = sqlx::query(&format!(
                "SELECT count(*) FROM {table} WHERE {column} = 'custom'"
            ))
            .execute(&pool)
            .await;
            assert!(message.is_ok(), "{table}: таблиця є до міграції");
        }
        assert!(
            sqlx::query("INSERT INTO local_profile_modules (profile_id, module) VALUES ('profile-c0c0c0c0c0c0c0c0c0c0c0c0', 'custom')")
                .execute(&pool)
                .await
                .is_err(),
            "до 0021 модуль custom не приймається"
        );

        sqlx::raw_sql(CUSTOM_MODULE_SQL)
            .execute(&pool)
            .await
            .expect("custom module migration must apply");

        // Наявні рядки на місці: модуль зі стилем, поле, обидва виправлення з їхніми номерами.
        let (style, branch): (String, String) = sqlx::query_as(
            "SELECT style, branch FROM dashboard_modules WHERE id = 'dashboard-corrections-01'",
        )
        .fetch_one(&pool)
        .await
        .unwrap();
        assert_eq!((style.as_str(), branch.as_str()), ("heightwell", "air"));
        let fields: i64 = sqlx::query_scalar(
            "SELECT count(*) FROM dashboard_module_fields WHERE module_id = 'dashboard-corrections-01'",
        )
        .fetch_one(&pool)
        .await
        .unwrap();
        assert_eq!(fields, 1);
        let corrections: Vec<(i64, String, Option<String>)> = sqlx::query_as(
            "SELECT id, corrected_text, stored_value FROM dashboard_module_corrections ORDER BY id",
        )
        .fetch_all(&pool)
        .await
        .unwrap();
        assert_eq!(
            corrections,
            vec![(1, "14:25".to_owned(), None), (2, "300 м".to_owned(), None)]
        );
        let violations: i64 = sqlx::query_scalar("SELECT count(*) FROM pragma_foreign_key_check")
            .fetch_one(&pool)
            .await
            .unwrap();
        assert_eq!(violations, 0, "зовнішні ключі переписано на нові таблиці");
        let (modules_index, corrections_index): (i64, i64) = (
            sqlx::query_scalar("SELECT count(*) FROM sqlite_master WHERE type = 'index' AND name = 'idx_dashboard_modules_profile_branch' AND tbl_name = 'dashboard_modules'")
                .fetch_one(&pool)
                .await
                .unwrap(),
            sqlx::query_scalar("SELECT count(*) FROM sqlite_master WHERE type = 'index' AND name = 'idx_dashboard_module_corrections_module' AND tbl_name = 'dashboard_module_corrections'")
                .fetch_one(&pool)
                .await
                .unwrap(),
        );
        assert_eq!((modules_index, corrections_index), (1, 1));
        let leftovers: i64 =
            sqlx::query_scalar("SELECT count(*) FROM sqlite_master WHERE name LIKE '%_new'")
                .fetch_one(&pool)
                .await
                .unwrap();
        assert_eq!(leftovers, 0);

        // Наявний профіль отримує власний модуль; невідоме значення, як і раніше, відхиляється.
        let custom_rows: i64 = sqlx::query_scalar(
            "SELECT count(*) FROM local_profile_modules
             WHERE profile_id = 'profile-c0c0c0c0c0c0c0c0c0c0c0c0' AND module = 'custom'",
        )
        .fetch_one(&pool)
        .await
        .unwrap();
        assert_eq!(custom_rows, 1, "профіль до 0021 отримує модуль custom");
        assert!(
            sqlx::query("INSERT INTO local_profile_modules (profile_id, module) VALUES ('profile-c0c0c0c0c0c0c0c0c0c0c0c0', 'navy')")
                .execute(&pool)
                .await
                .is_err()
        );
        sqlx::query(
            "INSERT INTO dashboard_modules
             (id, profile_id, branch, template_id, visual_kind, title, storage_table, created_at, updated_at)
             VALUES ('dashboard-custom-000001', 'profile-c0c0c0c0c0c0c0c0c0c0c0c0', 'custom', 'flight-hours', 'kpi',
                     'Власний', 'dashboard_data_000000000000000000000002', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z')",
        )
        .execute(&pool)
        .await
        .expect("custom is a dashboard branch after 0021");
        assert!(
            sqlx::query(
                "INSERT INTO dashboard_modules
                 (id, profile_id, branch, template_id, visual_kind, title, storage_table, created_at, updated_at)
                 VALUES ('dashboard-navy-00000001', 'profile-c0c0c0c0c0c0c0c0c0c0c0c0', 'navy', 'flight-hours', 'kpi',
                         'Флот', 'dashboard_data_000000000000000000000003', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z')",
            )
            .execute(&pool)
            .await
            .is_err()
        );
        // Автоінкремент виправлень продовжує нумерацію, а не починає з 1.
        sqlx::query(
            "INSERT INTO dashboard_module_corrections
             (module_id, row_id, field_key, source_file, source_sheet, source_row, source_column,
              raw_text, corrected_text, reason, created_at)
             VALUES ('dashboard-custom-000001', 1, 'value', 'x.xlsx', 'A', 1, 'B', '?', '1', '', '2026-01-01T00:00:00Z')",
        )
        .execute(&pool)
        .await
        .unwrap();
        let last: i64 = sqlx::query_scalar("SELECT max(id) FROM dashboard_module_corrections")
            .fetch_one(&pool)
            .await
            .unwrap();
        assert_eq!(last, 3);

        // Каскади живі: модуль забирає поля й виправлення, профіль — модулі.
        sqlx::query("DELETE FROM dashboard_modules WHERE id = 'dashboard-corrections-01'")
            .execute(&pool)
            .await
            .unwrap();
        let (fields, corrections): (i64, i64) = (
            sqlx::query_scalar("SELECT count(*) FROM dashboard_module_fields")
                .fetch_one(&pool)
                .await
                .unwrap(),
            sqlx::query_scalar("SELECT count(*) FROM dashboard_module_corrections")
                .fetch_one(&pool)
                .await
                .unwrap(),
        );
        assert_eq!((fields, corrections), (0, 1));
        sqlx::query("DELETE FROM local_profiles WHERE id = 'profile-c0c0c0c0c0c0c0c0c0c0c0c0'")
            .execute(&pool)
            .await
            .unwrap();
        let (modules, profile_modules): (i64, i64) = (
            sqlx::query_scalar("SELECT count(*) FROM dashboard_modules")
                .fetch_one(&pool)
                .await
                .unwrap(),
            sqlx::query_scalar("SELECT count(*) FROM local_profile_modules")
                .fetch_one(&pool)
                .await
                .unwrap(),
        );
        assert_eq!((modules, profile_modules), (0, 0));
    }

    #[tokio::test]
    async fn army_aviation_migration_admits_army_in_tables_modules_and_dashboards() {
        let pool = migrated_pool_before_custom_module().await;
        module_with_corrections(&pool).await;
        sqlx::query(
            "INSERT INTO local_profile_tables (profile_id, branch, path, updated_at)
             VALUES ('profile-c0c0c0c0c0c0c0c0c0c0c0c0', 'air', '/synthetic/air.xlsx', '2026-01-01T00:00:00Z')",
        )
        .execute(&pool)
        .await
        .unwrap();
        sqlx::raw_sql(CUSTOM_MODULE_SQL)
            .execute(&pool)
            .await
            .expect("custom module migration must apply");
        assert!(
            sqlx::query("INSERT INTO local_profile_tables (profile_id, branch, path, updated_at) VALUES ('profile-c0c0c0c0c0c0c0c0c0c0c0c0', 'army', '/synthetic/army.xlsx', '2026-01-01T00:00:00Z')")
                .execute(&pool)
                .await
                .is_err(),
            "до 0022 слот army не приймається"
        );

        sqlx::raw_sql(ARMY_AVIATION_SQL)
            .execute(&pool)
            .await
            .expect("army aviation migration must apply");

        // Наявні рядки на місці: прив'язка таблиці, модуль, поле, виправлення з їхніми номерами.
        let bound: Vec<(String, String)> =
            sqlx::query_as("SELECT branch, path FROM local_profile_tables ORDER BY branch")
                .fetch_all(&pool)
                .await
                .unwrap();
        assert_eq!(
            bound,
            vec![("air".to_owned(), "/synthetic/air.xlsx".to_owned())]
        );
        let corrections: Vec<i64> =
            sqlx::query_scalar("SELECT id FROM dashboard_module_corrections ORDER BY id")
                .fetch_all(&pool)
                .await
                .unwrap();
        assert_eq!(corrections, vec![1, 2]);
        let violations: i64 = sqlx::query_scalar("SELECT count(*) FROM pragma_foreign_key_check")
            .fetch_one(&pool)
            .await
            .unwrap();
        assert_eq!(violations, 0);
        let leftovers: i64 =
            sqlx::query_scalar("SELECT count(*) FROM sqlite_master WHERE name LIKE '%_new'")
                .fetch_one(&pool)
                .await
                .unwrap();
        assert_eq!(leftovers, 0);

        // Наявний профіль модуля army сам не отримує (лише вибрані модулі; custom лишається з 0021); army приймається всюди.
        let modules: Vec<String> = sqlx::query_scalar(
            "SELECT module FROM local_profile_modules WHERE profile_id = 'profile-c0c0c0c0c0c0c0c0c0c0c0c0' ORDER BY module",
        )
        .fetch_all(&pool)
        .await
        .unwrap();
        assert_eq!(modules, vec!["custom".to_owned()]);
        sqlx::query("INSERT INTO local_profile_tables (profile_id, branch, path, updated_at) VALUES ('profile-c0c0c0c0c0c0c0c0c0c0c0c0', 'army', '/synthetic/army.xlsx', '2026-01-01T00:00:00Z')")
            .execute(&pool)
            .await
            .expect("army is a profile table slot after 0022");
        sqlx::query(
            "INSERT INTO dashboard_modules
             (id, profile_id, branch, template_id, visual_kind, title, storage_table, created_at, updated_at)
             VALUES ('dashboard-army-00000001', 'profile-c0c0c0c0c0c0c0c0c0c0c0c0', 'army', 'flight-hours', 'kpi',
                     'АА', 'dashboard_data_0000000000000000000000aa', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z')",
        )
        .execute(&pool)
        .await
        .expect("army is a dashboard branch after 0022");
        for (table, column, value) in [
            ("local_profile_tables", "branch", "navy"),
            ("local_profile_modules", "module", "navy"),
        ] {
            let sql = if table == "local_profile_tables" {
                format!("INSERT INTO {table} (profile_id, {column}, path, updated_at) VALUES ('profile-c0c0c0c0c0c0c0c0c0c0c0c0', '{value}', '/x.xlsx', '2026-01-01T00:00:00Z')")
            } else {
                format!("INSERT INTO {table} (profile_id, {column}) VALUES ('profile-c0c0c0c0c0c0c0c0c0c0c0c0', '{value}')")
            };
            assert!(
                sqlx::query(&sql).execute(&pool).await.is_err(),
                "{table}: невідоме значення відхиляється"
            );
        }
        // Каскад профіль → таблиці, модулі й дашборди працює на перебудованих таблицях.
        sqlx::query("DELETE FROM local_profiles WHERE id = 'profile-c0c0c0c0c0c0c0c0c0c0c0c0'")
            .execute(&pool)
            .await
            .unwrap();
        for table in [
            "local_profile_tables",
            "local_profile_modules",
            "dashboard_modules",
            "dashboard_module_corrections",
        ] {
            let left: i64 = sqlx::query_scalar(&format!("SELECT count(*) FROM {table}"))
                .fetch_one(&pool)
                .await
                .unwrap();
            assert_eq!(left, 0, "{table}");
        }
        pool.close().await;
    }
    #[tokio::test]
    async fn all_embedded_migrations_apply_to_a_new_file_with_the_corrections_table() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("corrections.sqlite3");
        let pool = create_migrated_database(&path).await.unwrap();
        let exists: i64 = sqlx::query_scalar(
            "SELECT count(*) FROM sqlite_master WHERE type = 'table' AND name = 'dashboard_module_corrections'",
        )
        .fetch_one(&pool)
        .await
        .unwrap();
        assert_eq!(exists, 1);
        module_with_corrections(&pool).await;
        sqlx::query("DELETE FROM local_profiles WHERE id = 'profile-c0c0c0c0c0c0c0c0c0c0c0c0'")
            .execute(&pool)
            .await
            .unwrap();
        let left: i64 = sqlx::query_scalar("SELECT count(*) FROM dashboard_module_corrections")
            .fetch_one(&pool)
            .await
            .unwrap();
        assert_eq!(left, 0, "профіль видалено — модулі й виправлення теж");
        pool.close().await;
    }

    // --- Бібліотека «Офісу» (міграції 0013–0015) ---------------------------

    const LIBRARY_NOW: &str = "2026-10-20T08:00:00Z";
    const LIBRARY_PROFILE: &str = "profile-1b1b1b1b1b1b1b1b1b1b1b1b";
    const SECOND_PROFILE: &str = "profile-2c2c2c2c2c2c2c2c2c2c2c2c";
    const BARE_PROFILE: &str = "profile-3d3d3d3d3d3d3d3d3d3d3d3d";
    const LIBRARY_ITEM: &str = "doc-0000000000000000000000a1";
    const SECOND_ITEM: &str = "doc-0000000000000000000000a2";
    const LIBRARY_VERSION: &str = "ver-0000000000000000000000b1";

    fn library_content() -> String {
        "c1".repeat(32)
    }

    /// Шістнадцятковий літерал BLOB: `prefix` і далі нулі до `length` байтів.
    fn blob_literal(prefix: &str, length: usize) -> String {
        format!("X'{prefix}{}'", "00".repeat(length - prefix.len() / 2))
    }

    /// Вміст на 3 відкриті байти: 'EWLB' · формат · 24 байти nonce · 3 + 16 байтів.
    fn blob_data() -> String {
        blob_literal("45574C4201", 48)
    }

    async fn run(pool: &sqlx::SqlitePool, sql: &str) {
        sqlx::query(sql)
            .execute(pool)
            .await
            .unwrap_or_else(|error| panic!("{sql}: {error}"));
    }

    async fn rejects(pool: &sqlx::SqlitePool, sql: &str, reason: &str) {
        let error = sqlx::query(sql).execute(pool).await.expect_err(sql);
        assert!(error.to_string().contains(reason), "{sql}: {error}");
    }

    fn profile_insert(profile_id: &str, name: &str) -> String {
        format!(
            "INSERT INTO local_profiles (id, display_name, name_key, created_at, updated_at)
             VALUES ('{profile_id}', '{name}', '{name}', '{LIBRARY_NOW}', '{LIBRARY_NOW}')"
        )
    }

    fn keyring_insert(verb: &str, profile_id: &str, generation: i64, tail: &str) -> String {
        format!(
            "{verb} INTO library_keyrings
             (profile_id, format, kdf, kdf_m, kdf_t, kdf_p, kdf_salt, wrap_alg, wrap_nonce,
              wrapped_ldk, state, generation, created_at, updated_at)
             VALUES ('{profile_id}', 1, 'argon2id', 8, 1, 1, {}, 'xchacha20poly1305', {}, {},
                     'active', {generation}, '{LIBRARY_NOW}', '{LIBRARY_NOW}') {tail}",
            blob_literal("", 16),
            blob_literal("", 24),
            blob_literal("", 48)
        )
    }

    fn item_insert(verb: &str, item_id: &str, profile_id: &str, tail: &str) -> String {
        format!(
            "{verb} INTO library_items (id, profile_id, kind, name_cipher, created_at)
             VALUES ('{item_id}', '{profile_id}', 'document', {}, '{LIBRARY_NOW}') {tail}",
            blob_literal("", 41)
        )
    }

    fn blob_insert(verb: &str, profile_id: &str, content_id: &str, tail: &str) -> String {
        format!(
            "{verb} INTO library_blobs (profile_id, content_id, plain_size, data, created_at)
             VALUES ('{profile_id}', '{content_id}', 3, {}, '{LIBRARY_NOW}') {tail}",
            blob_data()
        )
    }

    #[allow(clippy::too_many_arguments)]
    fn version_insert(
        verb: &str,
        version_id: &str,
        item_id: &str,
        profile_id: &str,
        version_no: i64,
        plain_size: i64,
        parent: Option<&str>,
        tail: &str,
    ) -> String {
        let parent = parent.map_or("NULL".to_owned(), |parent| format!("'{parent}'"));
        format!(
            "{verb} INTO library_versions
             (id, item_id, profile_id, version_no, content_id, ext, plain_size, origin,
              parent_version_id, created_at)
             VALUES ('{version_id}', '{item_id}', '{profile_id}', {version_no}, '{}', 'txt',
                     {plain_size}, 'imported', {parent}, '{LIBRARY_NOW}') {tail}",
            library_content()
        )
    }

    fn first_version(verb: &str, version_id: &str, version_no: i64, tail: &str) -> String {
        version_insert(
            verb,
            version_id,
            LIBRARY_ITEM,
            LIBRARY_PROFILE,
            version_no,
            3,
            None,
            tail,
        )
    }

    fn event_insert(verb: &str, id: i64, tail: &str) -> String {
        format!(
            "{verb} INTO library_events (id, profile_id, event, created_at)
             VALUES ({id}, '{LIBRARY_PROFILE}', 'created', '{LIBRARY_NOW}') {tail}"
        )
    }

    fn purge_insert(verb: &str, id: i64) -> String {
        format!(
            "{verb} INTO library_purges (id, profile_id, items, versions, created_at)
             VALUES ({id}, '{LIBRARY_PROFILE}', 2, 1, '{LIBRARY_NOW}')"
        )
    }

    /// Профіль з активною обгорткою, документ, вміст, версія (поточна) і подія —
    /// синтетичні байти, без справжнього шифрування: тут перевіряються лише тригери.
    async fn library_rows(pool: &sqlx::SqlitePool) {
        run(pool, &profile_insert(LIBRARY_PROFILE, "бібліотека")).await;
        run(pool, &keyring_insert("INSERT", LIBRARY_PROFILE, 1, "")).await;
        run(
            pool,
            &item_insert("INSERT", LIBRARY_ITEM, LIBRARY_PROFILE, ""),
        )
        .await;
        run(
            pool,
            &blob_insert("INSERT", LIBRARY_PROFILE, &library_content(), ""),
        )
        .await;
        run(pool, &first_version("INSERT", LIBRARY_VERSION, 1, "")).await;
        run(
            pool,
            &format!(
                "UPDATE library_items SET current_version_id = '{LIBRARY_VERSION}'
                 WHERE id = '{LIBRARY_ITEM}'"
            ),
        )
        .await;
        run(pool, &event_insert("INSERT", 1, "")).await;
    }

    #[tokio::test]
    async fn office_library_migrations_create_tables_behind_a_closed_trigger_fence() {
        let pool = migrated_pool().await;
        for (table, expected) in [
            (
                "library_keyrings",
                &[
                    "profile_id",
                    "format",
                    "kdf",
                    "kdf_m",
                    "kdf_t",
                    "kdf_p",
                    "kdf_salt",
                    "wrap_alg",
                    "wrap_nonce",
                    "wrapped_ldk",
                    "recovery_salt",
                    "recovery_nonce",
                    "recovery_wrapped_ldk",
                    "state",
                    "generation",
                    "created_at",
                    "updated_at",
                ][..],
            ),
            (
                "library_items",
                &[
                    "id",
                    "profile_id",
                    "kind",
                    "name_cipher",
                    "profile_table_copy",
                    "current_version_id",
                    "hidden_at",
                    "created_at",
                ][..],
            ),
            (
                "library_blobs",
                &[
                    "profile_id",
                    "content_id",
                    "plain_size",
                    "data",
                    "created_at",
                ][..],
            ),
            (
                "library_versions",
                &[
                    "id",
                    "item_id",
                    "profile_id",
                    "version_no",
                    "content_id",
                    "ext",
                    "plain_size",
                    "origin",
                    "parent_version_id",
                    "source_fingerprint",
                    "created_at",
                ][..],
            ),
            (
                "library_events",
                &[
                    "id",
                    "profile_id",
                    "event",
                    "item_id",
                    "version_id",
                    "created_at",
                ][..],
            ),
            (
                "library_purges",
                &["id", "profile_id", "items", "versions", "created_at"][..],
            ),
            (
                "document_links",
                &[
                    "item_id",
                    "profile_id",
                    "template_version_id",
                    "source_kind",
                    "params_json",
                    "last_generated_version_id",
                    "source_fingerprint",
                    "created_at",
                    "updated_at",
                ][..],
            ),
        ] {
            let columns: Vec<String> = sqlx::query_scalar(&format!(
                "SELECT name FROM pragma_table_info('{table}') ORDER BY cid"
            ))
            .fetch_all(&pool)
            .await
            .unwrap();
            assert_eq!(columns, expected, "{table}");
            // Без зовнішніх ключів на профілі: каскадне видалення неможливе.
            let targets: Vec<String> = sqlx::query_scalar(&format!(
                "SELECT \"table\" FROM pragma_foreign_key_list('{table}')"
            ))
            .fetch_all(&pool)
            .await
            .unwrap();
            assert!(
                targets
                    .iter()
                    .all(|target| !target.starts_with("local_profile")),
                "{table}: {targets:?}"
            );
        }

        // Огорожа: точний перелік тригерів бібліотеки й профілю, усі безумовні.
        let triggers = sqlx::query(
            "SELECT name, sql FROM sqlite_master
             WHERE type = 'trigger'
               AND (tbl_name LIKE 'library!_%' ESCAPE '!'
                    OR tbl_name IN ('document_links', 'local_profiles', 'local_profile_details'))
             ORDER BY name",
        )
        .fetch_all(&pool)
        .await
        .unwrap();
        let names: Vec<String> = triggers.iter().map(|row| row.get("name")).collect();
        assert_eq!(
            names,
            [
                "document_links_insert_guard",
                "document_links_update_guard",
                "library_blobs_insert_guard",
                "library_blobs_no_delete",
                "library_blobs_update_guard",
                "library_events_insert_guard",
                "library_events_no_delete",
                "library_events_no_update",
                "library_items_insert_guard",
                "library_items_no_delete",
                "library_items_update_guard",
                "library_keyrings_insert_guard",
                "library_keyrings_no_delete",
                "library_keyrings_update_guard",
                "library_purges_insert_guard",
                "library_purges_no_delete",
                "library_purges_no_update",
                "library_versions_insert_guard",
                "library_versions_no_delete",
                "library_versions_no_update",
                "local_profiles_library_guard",
            ]
        );
        for row in &triggers {
            let name: String = row.get("name");
            let sql: String = row.get("sql");
            let header = &sql[..sql.find("BEGIN").expect("тіло тригера")];
            assert!(
                header.contains("BEFORE") && !header.contains("WHEN"),
                "{name}: тригер має бути безумовним BEFORE"
            );
            assert!(sql.contains("RAISE(ABORT"), "{name}");
        }
    }

    #[tokio::test]
    async fn office_library_rows_resist_update_delete_replace_and_upsert() {
        let pool = migrated_pool().await;
        library_rows(&pool).await;
        let other_version = "ver-0000000000000000000000b9";
        let other_content = "d2".repeat(32);
        for recursive in ["OFF", "ON"] {
            run(&pool, &format!("PRAGMA recursive_triggers = {recursive}")).await;

            rejects(
                &pool,
                "UPDATE library_versions SET ext = 'csv'",
                "library_versions are immutable",
            )
            .await;
            rejects(
                &pool,
                "DELETE FROM library_versions",
                "library_versions are immutable",
            )
            .await;
            for verb in ["INSERT OR REPLACE", "REPLACE", "INSERT OR IGNORE"] {
                rejects(
                    &pool,
                    &first_version(verb, LIBRARY_VERSION, 1, ""),
                    "version already exists",
                )
                .await;
                rejects(
                    &pool,
                    &first_version(verb, other_version, 1, ""),
                    "version already exists",
                )
                .await;
            }
            rejects(
                &pool,
                &first_version(
                    "INSERT",
                    LIBRARY_VERSION,
                    1,
                    "ON CONFLICT(id) DO UPDATE SET ext = 'csv'",
                ),
                "version already exists",
            )
            .await;
            rejects(
                &pool,
                &first_version(
                    "INSERT",
                    other_version,
                    1,
                    "ON CONFLICT(item_id, version_no) DO UPDATE SET ext = 'csv'",
                ),
                "version already exists",
            )
            .await;

            rejects(
                &pool,
                "UPDATE library_blobs SET data = NULL",
                "content can only be erased after the keyring is shredded",
            )
            .await;
            rejects(
                &pool,
                "UPDATE library_blobs SET created_at = 'змінено'",
                "content can only be erased after the keyring is shredded",
            )
            .await;
            rejects(
                &pool,
                "DELETE FROM library_blobs",
                "library_blobs cannot be deleted",
            )
            .await;
            for verb in ["INSERT OR REPLACE", "REPLACE"] {
                rejects(
                    &pool,
                    &blob_insert(verb, LIBRARY_PROFILE, &library_content(), ""),
                    "content already exists",
                )
                .await;
            }
            rejects(
                &pool,
                &format!(
                    "INSERT OR REPLACE INTO library_blobs
                     (rowid, profile_id, content_id, plain_size, data, created_at)
                     VALUES ((SELECT rowid FROM library_blobs), '{LIBRARY_PROFILE}',
                             '{other_content}', 3, {}, '{LIBRARY_NOW}')",
                    blob_data()
                ),
                "content already exists",
            )
            .await;
            rejects(
                &pool,
                &blob_insert(
                    "INSERT",
                    LIBRARY_PROFILE,
                    &library_content(),
                    "ON CONFLICT(profile_id, content_id) DO UPDATE SET data = NULL",
                ),
                "content already exists",
            )
            .await;

            rejects(
                &pool,
                "DELETE FROM library_items",
                "library_items cannot be deleted",
            )
            .await;
            rejects(
                &pool,
                "UPDATE library_items SET kind = 'table'",
                "only current_version_id, hidden_at and name_cipher can change",
            )
            .await;
            rejects(
                &pool,
                "UPDATE library_items SET current_version_id = NULL",
                "current version must belong to the same item",
            )
            .await;
            rejects(
                &pool,
                &format!("UPDATE library_items SET current_version_id = '{other_version}'"),
                "current version must belong to the same item",
            )
            .await;
            for verb in ["INSERT OR REPLACE", "REPLACE"] {
                rejects(
                    &pool,
                    &item_insert(verb, LIBRARY_ITEM, LIBRARY_PROFILE, ""),
                    "item already exists",
                )
                .await;
            }
            rejects(
                &pool,
                &item_insert(
                    "INSERT",
                    LIBRARY_ITEM,
                    LIBRARY_PROFILE,
                    "ON CONFLICT(id) DO UPDATE SET hidden_at = 'змінено'",
                ),
                "item already exists",
            )
            .await;

            rejects(
                &pool,
                "UPDATE library_events SET event = 'purged'",
                "library_events are append-only",
            )
            .await;
            rejects(
                &pool,
                "DELETE FROM library_events",
                "library_events are append-only",
            )
            .await;
            for verb in ["INSERT OR REPLACE", "REPLACE"] {
                rejects(&pool, &event_insert(verb, 1, ""), "event already exists").await;
            }
            rejects(
                &pool,
                &event_insert(
                    "INSERT",
                    1,
                    "ON CONFLICT(id) DO UPDATE SET event = 'purged'",
                ),
                "event already exists",
            )
            .await;

            rejects(
                &pool,
                "DELETE FROM library_keyrings",
                "library_keyrings cannot be deleted",
            )
            .await;
            for verb in ["INSERT OR REPLACE", "REPLACE"] {
                rejects(
                    &pool,
                    &keyring_insert(verb, LIBRARY_PROFILE, 1, ""),
                    "keyring already exists",
                )
                .await;
            }
            rejects(
                &pool,
                &keyring_insert(
                    "INSERT",
                    LIBRARY_PROFILE,
                    1,
                    "ON CONFLICT(profile_id) DO UPDATE SET generation = generation + 1",
                ),
                "keyring already exists",
            )
            .await;
            rejects(
                &pool,
                "UPDATE library_keyrings SET updated_at = 'змінено'",
                "every change must advance generation by one",
            )
            .await;
            rejects(
                &pool,
                "UPDATE library_keyrings SET generation = generation + 2",
                "every change must advance generation by one",
            )
            .await;
            rejects(
                &pool,
                "UPDATE library_keyrings SET created_at = 'змінено', generation = generation + 1",
                "identity fields are immutable",
            )
            .await;

            rejects(
                &pool,
                &format!("DELETE FROM local_profiles WHERE id = '{LIBRARY_PROFILE}'"),
                "local_profiles: profile has an active library",
            )
            .await;
        }
        run(&pool, "PRAGMA recursive_triggers = OFF").await;

        let counts: (i64, i64, i64, i64, i64, i64) = sqlx::query_as(
            "SELECT (SELECT count(*) FROM library_keyrings), (SELECT count(*) FROM library_items),
                    (SELECT count(*) FROM library_blobs WHERE data IS NOT NULL),
                    (SELECT count(*) FROM library_versions), (SELECT count(*) FROM library_events),
                    (SELECT count(*) FROM local_profiles)",
        )
        .fetch_one(&pool)
        .await
        .unwrap();
        assert_eq!(counts, (1, 1, 1, 1, 1, 1));
        let version: (String, String, i64) =
            sqlx::query_as("SELECT ext, origin, version_no FROM library_versions")
                .fetch_one(&pool)
                .await
                .unwrap();
        assert_eq!(version, ("txt".to_owned(), "imported".to_owned(), 1));
        let generation: i64 = sqlx::query_scalar("SELECT generation FROM library_keyrings")
            .fetch_one(&pool)
            .await
            .unwrap();
        assert_eq!(generation, 1);
    }

    #[tokio::test]
    async fn office_library_keyring_transitions_and_purge_rules() {
        let pool = migrated_pool().await;
        library_rows(&pool).await;
        run(&pool, &profile_insert(SECOND_PROFILE, "другий")).await;
        run(&pool, &keyring_insert("INSERT", SECOND_PROFILE, 1, "")).await;
        run(&pool, &profile_insert(BARE_PROFILE, "без бібліотеки")).await;

        // Без активної обгортки профілю нічого не вставити.
        rejects(
            &pool,
            &item_insert("INSERT", "doc-0000000000000000000000c1", BARE_PROFILE, ""),
            "library_items: library keyring is not active",
        )
        .await;
        rejects(
            &pool,
            &blob_insert("INSERT", BARE_PROFILE, &library_content(), ""),
            "library_blobs: library keyring is not active",
        )
        .await;
        rejects(
            &pool,
            &keyring_insert("INSERT", BARE_PROFILE, 2, ""),
            "a new keyring must be active with generation 1",
        )
        .await;
        rejects(
            &pool,
            &format!(
                "INSERT INTO library_items (id, profile_id, kind, name_cipher, current_version_id, created_at)
                 VALUES ('doc-0000000000000000000000c2', '{LIBRARY_PROFILE}', 'document', {},
                         '{LIBRARY_VERSION}', '{LIBRARY_NOW}')",
                blob_literal("", 41)
            ),
            "a new item has no current version",
        )
        .await;
        rejects(
            &pool,
            &blob_insert("INSERT", LIBRARY_PROFILE, &"e3".repeat(32), "")
                .replace(&blob_data(), &blob_literal("", 48)),
            "CHECK constraint failed",
        )
        .await;

        // Версії: наступний номер, батько з того ж документа, розмір вмісту, профіль.
        run(
            &pool,
            &item_insert("INSERT", SECOND_ITEM, LIBRARY_PROFILE, ""),
        )
        .await;
        rejects(
            &pool,
            &first_version("INSERT", "ver-0000000000000000000000b2", 3, ""),
            "version number must follow the latest one",
        )
        .await;
        rejects(
            &pool,
            &version_insert(
                "INSERT",
                "ver-0000000000000000000000b3",
                SECOND_ITEM,
                LIBRARY_PROFILE,
                1,
                3,
                Some(LIBRARY_VERSION),
                "",
            ),
            "parent version must belong to the same item",
        )
        .await;
        rejects(
            &pool,
            &version_insert(
                "INSERT",
                "ver-0000000000000000000000b4",
                LIBRARY_ITEM,
                LIBRARY_PROFILE,
                2,
                4,
                None,
                "",
            ),
            "size does not match the stored content",
        )
        .await;
        rejects(
            &pool,
            &version_insert(
                "INSERT",
                "ver-0000000000000000000000b5",
                LIBRARY_ITEM,
                SECOND_PROFILE,
                2,
                3,
                None,
                "",
            ),
            "item belongs to another profile",
        )
        .await;

        // Дозволено: переобгортка з generation + 1, назва, приховування.
        run(
            &pool,
            &format!(
                "UPDATE library_keyrings SET wrap_nonce = {}, generation = generation + 1,
                     updated_at = 'пізніше'
                 WHERE profile_id = '{LIBRARY_PROFILE}'",
                blob_literal("11", 24)
            ),
        )
        .await;
        run(
            &pool,
            &format!(
                "UPDATE library_items SET hidden_at = '{LIBRARY_NOW}', name_cipher = {}
                 WHERE id = '{LIBRARY_ITEM}'",
                blob_literal("22", 60)
            ),
        )
        .await;
        rejects(
            &pool,
            &purge_insert("INSERT", 1),
            "library_purges: keyring must be shredded first",
        )
        .await;
        // Знищена обгортка без жодного слота — інакше CHECK.
        rejects(
            &pool,
            &format!(
                "UPDATE library_keyrings SET state = 'shredded', generation = generation + 1
                 WHERE profile_id = '{LIBRARY_PROFILE}'"
            ),
            "CHECK constraint failed",
        )
        .await;
        run(
            &pool,
            &format!(
                "UPDATE library_keyrings
                 SET state = 'shredded', wrap_nonce = NULL, wrapped_ldk = NULL,
                     generation = generation + 1, updated_at = 'очищено'
                 WHERE profile_id = '{LIBRARY_PROFILE}'"
            ),
        )
        .await;

        // Після криптознищення: обгортка незмінна, нових рядків немає, вміст лише → NULL.
        rejects(
            &pool,
            &format!(
                "UPDATE library_keyrings SET state = 'active', wrap_nonce = {}, wrapped_ldk = {},
                     generation = generation + 1
                 WHERE profile_id = '{LIBRARY_PROFILE}'",
                blob_literal("", 24),
                blob_literal("", 48)
            ),
            "a shredded keyring is immutable",
        )
        .await;
        rejects(
            &pool,
            &format!(
                "UPDATE library_keyrings SET generation = generation + 1
                 WHERE profile_id = '{LIBRARY_PROFILE}'"
            ),
            "a shredded keyring is immutable",
        )
        .await;
        rejects(
            &pool,
            &item_insert(
                "INSERT",
                "doc-0000000000000000000000c3",
                LIBRARY_PROFILE,
                "",
            ),
            "library_items: library keyring is not active",
        )
        .await;
        rejects(
            &pool,
            &format!("UPDATE library_items SET hidden_at = NULL WHERE id = '{LIBRARY_ITEM}'"),
            "library_items: library keyring is not active",
        )
        .await;
        rejects(
            &pool,
            &blob_insert("INSERT", LIBRARY_PROFILE, &"e4".repeat(32), ""),
            "library_blobs: library keyring is not active",
        )
        .await;
        rejects(
            &pool,
            &first_version("INSERT", "ver-0000000000000000000000b6", 2, ""),
            "library_versions: library keyring is not active",
        )
        .await;
        rejects(
            &pool,
            "UPDATE library_blobs SET data = NULL, plain_size = 4",
            "content can only be erased after the keyring is shredded",
        )
        .await;
        run(&pool, "UPDATE library_blobs SET data = NULL").await;
        rejects(
            &pool,
            &format!("UPDATE library_blobs SET data = {}", blob_data()),
            "content can only be erased after the keyring is shredded",
        )
        .await;
        run(&pool, &purge_insert("INSERT", 1)).await;
        rejects(
            &pool,
            "UPDATE library_purges SET items = 5",
            "library_purges are append-only",
        )
        .await;
        rejects(
            &pool,
            "DELETE FROM library_purges",
            "library_purges are append-only",
        )
        .await;
        rejects(
            &pool,
            &purge_insert("REPLACE", 1),
            "library_purges: purge already exists",
        )
        .await;

        // Профіль тепер видаляється; рядки бібліотеки лишаються надгробками.
        run(
            &pool,
            &format!("DELETE FROM local_profiles WHERE id = '{LIBRARY_PROFILE}'"),
        )
        .await;
        rejects(
            &pool,
            &format!("DELETE FROM local_profiles WHERE id = '{SECOND_PROFILE}'"),
            "local_profiles: profile has an active library",
        )
        .await;
        run(
            &pool,
            &format!("DELETE FROM local_profiles WHERE id = '{BARE_PROFILE}'"),
        )
        .await;
        let left: (i64, i64, i64, i64) = sqlx::query_as(
            "SELECT (SELECT count(*) FROM library_items WHERE profile_id = ?1),
                    (SELECT count(*) FROM library_versions WHERE profile_id = ?1),
                    (SELECT count(*) FROM library_blobs WHERE profile_id = ?1 AND data IS NULL),
                    (SELECT count(*) FROM library_purges WHERE profile_id = ?1)",
        )
        .bind(LIBRARY_PROFILE)
        .fetch_one(&pool)
        .await
        .unwrap();
        assert_eq!(left, (2, 1, 1, 1));
        let integrity: String = sqlx::query_scalar("PRAGMA integrity_check")
            .fetch_one(&pool)
            .await
            .unwrap();
        assert_eq!(integrity, "ok");
        let foreign_key_problems = sqlx::query("PRAGMA foreign_key_check")
            .fetch_all(&pool)
            .await
            .unwrap();
        assert!(foreign_key_problems.is_empty());
    }

    #[tokio::test]
    async fn damaged_library_content_is_replaced_only_while_the_keyring_is_active() {
        let pool = migrated_pool().await;
        library_rows(&pool).await;
        // Інший шифротекст того самого розміру (ремонт пошкодженого рядка) — дозволено.
        let repaired = blob_literal("45574C4201FF", 48);
        run(
            &pool,
            &format!("UPDATE library_blobs SET data = {repaired}"),
        )
        .await;
        let data: Vec<u8> = sqlx::query_scalar("SELECT data FROM library_blobs")
            .fetch_one(&pool)
            .await
            .unwrap();
        assert_eq!((data.len(), data[5]), (48, 0xFF));
        // Ідентичність рядка незмінна й під час ремонту.
        for change in [
            "plain_size = 4".to_owned(),
            format!("content_id = '{}'", "e5".repeat(32)),
            format!("profile_id = '{SECOND_PROFILE}'"),
            "created_at = 'змінено'".to_owned(),
            "rowid = rowid + 1".to_owned(),
        ] {
            rejects(
                &pool,
                &format!("UPDATE library_blobs SET data = {repaired}, {change}"),
                "content can only be erased after the keyring is shredded",
            )
            .await;
        }
        // Форма шифротексту лишається під CHECK таблиці.
        rejects(
            &pool,
            &format!(
                "UPDATE library_blobs SET data = {}",
                blob_literal("45574C4201", 49)
            ),
            "CHECK constraint failed",
        )
        .await;
        rejects(
            &pool,
            &format!("UPDATE library_blobs SET data = {}", blob_literal("", 48)),
            "CHECK constraint failed",
        )
        .await;

        // Після криптознищення — лише стирання; стертий вміст не повертається.
        run(
            &pool,
            &format!(
                "UPDATE library_keyrings
                 SET state = 'shredded', wrap_nonce = NULL, wrapped_ldk = NULL,
                     generation = generation + 1, updated_at = 'очищено'
                 WHERE profile_id = '{LIBRARY_PROFILE}'"
            ),
        )
        .await;
        rejects(
            &pool,
            &format!("UPDATE library_blobs SET data = {}", blob_data()),
            "content can only be repaired while the keyring is active",
        )
        .await;
        run(&pool, "UPDATE library_blobs SET data = NULL").await;
        rejects(
            &pool,
            &format!("UPDATE library_blobs SET data = {}", blob_data()),
            "content can only be erased after the keyring is shredded",
        )
        .await;
    }

    #[tokio::test]
    async fn writable_connections_overwrite_deleted_content() {
        let directory = tempfile::tempdir().expect("synthetic temp directory");
        let path = directory.path().join("synthetic.db");
        let marker = "СИНТЕТИЧНА-СТАРА-ОБГОРТКА-КЛЮЧА".repeat(3);
        let contains_marker = |path: &Path| {
            let bytes = std::fs::read(path).expect("synthetic database file");
            bytes
                .windows(marker.len())
                .any(|window| window == marker.as_bytes())
        };

        let pool = SqlitePoolOptions::new()
            .max_connections(1)
            .connect_with(writable_connect_options(&path).create_if_missing(true))
            .await
            .unwrap();
        let secure_delete: i64 = sqlx::query_scalar("PRAGMA secure_delete")
            .fetch_one(&pool)
            .await
            .unwrap();
        assert_eq!(secure_delete, 1);
        run(
            &pool,
            "CREATE TABLE synthetic_wraps (id INTEGER PRIMARY KEY, data BLOB NOT NULL)",
        )
        .await;
        sqlx::query("INSERT INTO synthetic_wraps (data) VALUES (?)")
            .bind(marker.as_bytes())
            .execute(&pool)
            .await
            .unwrap();
        pool.close().await;
        assert!(contains_marker(&path), "запис справді потрапив у файл");

        // Видалений рядок (стара обгортка, слот коду відновлення) не лишає байтів у
        // вільному місці файла.
        let pool = SqlitePoolOptions::new()
            .max_connections(1)
            .connect_with(live_connect_options(&path))
            .await
            .unwrap();
        let secure_delete: i64 = sqlx::query_scalar("PRAGMA secure_delete")
            .fetch_one(&pool)
            .await
            .unwrap();
        assert_eq!(secure_delete, 1);
        run(&pool, "DELETE FROM synthetic_wraps").await;
        pool.close().await;
        assert!(!contains_marker(&path), "старі байти затерто");
    }

    #[tokio::test]
    async fn document_links_change_only_their_generation_state() {
        let pool = migrated_pool().await;
        library_rows(&pool).await;
        let generated_version = "ver-0000000000000000000000b2";
        let fingerprint = "e".repeat(64);
        run(
            &pool,
            &format!(
                "INSERT INTO library_versions
                 (id, item_id, profile_id, version_no, content_id, ext, plain_size, origin,
                  parent_version_id, source_fingerprint, created_at)
                 VALUES ('{generated_version}', '{LIBRARY_ITEM}', '{LIBRARY_PROFILE}', 2, '{}',
                         'txt', 3, 'generated', '{LIBRARY_VERSION}', '{fingerprint}', '{LIBRARY_NOW}')",
                library_content()
            ),
        )
        .await;
        rejects(
            &pool,
            &format!(
                "INSERT INTO library_versions
                 (id, item_id, profile_id, version_no, content_id, ext, plain_size, origin, created_at)
                 VALUES ('ver-0000000000000000000000b3', '{LIBRARY_ITEM}', '{LIBRARY_PROFILE}', 3,
                         '{}', 'txt', 3, 'generated', '{LIBRARY_NOW}')",
                library_content()
            ),
            "CHECK constraint failed",
        )
        .await;
        let link = |last: &str, params: &str| {
            format!(
                "INSERT INTO document_links
                 (item_id, profile_id, template_version_id, source_kind, params_json,
                  last_generated_version_id, source_fingerprint, created_at, updated_at)
                 VALUES ('{LIBRARY_ITEM}', '{LIBRARY_PROFILE}', '{LIBRARY_VERSION}',
                         'approved_revisions', '{params}', '{last}', '{fingerprint}',
                         '{LIBRARY_NOW}', '{LIBRARY_NOW}')"
            )
        };
        let params = r#"{"from":"2026-10-01"}"#;
        rejects(
            &pool,
            &link(LIBRARY_VERSION, params),
            "last generated version must be a generated version of the item",
        )
        .await;
        rejects(
            &pool,
            &link(generated_version, "{не json"),
            "CHECK constraint failed",
        )
        .await;
        run(&pool, &link(generated_version, params)).await;
        for change in [
            format!("template_version_id = '{generated_version}'"),
            "params_json = '{}'".to_owned(),
            "source_kind = 'library_table'".to_owned(),
            "created_at = 'змінено'".to_owned(),
        ] {
            rejects(
                &pool,
                &format!("UPDATE document_links SET {change}"),
                "document_links: only the generation state can change",
            )
            .await;
        }
        rejects(
            &pool,
            &format!("UPDATE document_links SET last_generated_version_id = '{LIBRARY_VERSION}'"),
            "last generated version must be a generated version of the item",
        )
        .await;
        run(
            &pool,
            &format!(
                "UPDATE document_links SET source_fingerprint = '{}', updated_at = 'пізніше'",
                "f".repeat(64)
            ),
        )
        .await;
        // «Відв'язати» — звичайне видалення рядка; документ і версії лишаються.
        run(&pool, "DELETE FROM document_links").await;
        let versions: i64 = sqlx::query_scalar("SELECT count(*) FROM library_versions")
            .fetch_one(&pool)
            .await
            .unwrap();
        assert_eq!(versions, 2);

        // Без активної обгортки зв'язок не створити.
        run(
            &pool,
            &format!(
                "UPDATE library_keyrings
                 SET state = 'shredded', wrap_nonce = NULL, wrapped_ldk = NULL,
                     generation = generation + 1
                 WHERE profile_id = '{LIBRARY_PROFILE}'"
            ),
        )
        .await;
        rejects(
            &pool,
            &link(generated_version, params),
            "document_links: library keyring is not active",
        )
        .await;
    }
}
