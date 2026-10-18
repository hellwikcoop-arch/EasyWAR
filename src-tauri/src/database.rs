use serde::Serialize;
use sha2::{Digest, Sha384};
use sqlx::migrate::{MigrateError, Migrator};
use sqlx::{sqlite::SqliteConnectOptions, sqlite::SqlitePoolOptions, SqlitePool};
use std::path::Path;
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
pub(crate) const PROFILE_RECOVERY_SQL: &str =
    include_str!("../migrations/0010_profile_recovery_key.sql");

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
            description: "add_profile_recovery_key",
            sql: PROFILE_RECOVERY_SQL,
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

pub(crate) async fn migrate_database_file_with(
    path: &Path,
    migrator: &Migrator,
) -> Result<SqlitePool, DatabaseBootstrapError> {
    let pool = SqlitePoolOptions::new()
        .max_connections(1)
        .connect_with(
            SqliteConnectOptions::new()
                .filename(path)
                .create_if_missing(true)
                .foreign_keys(true),
        )
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
        DatabaseStatusStore, COMMAND_TABLES_SQL, DATABASE_URL, EMBEDDED_MIGRATOR,
        INITIAL_SCHEMA_SQL, LOCAL_PROFILES_SQL, OWN_LOSSES_TABLES_SQL, PROFILE_BRANCH_TABLES_SQL,
        PROFILE_DETAILS_SQL, PROFILE_MODULES_SQL, PROFILE_RECOVERY_SQL, WORKSPACE_TEMPLATES_SQL,
        XLSX_DUPLICATE_LINKS_SQL,
    };
    use sqlx::{sqlite::SqlitePoolOptions, Row};

    #[test]
    fn database_is_local_and_registers_versioned_migrations() {
        assert_eq!(DATABASE_URL, "sqlite:easywar.db");
        assert!(include_str!("../tauri.conf.json").contains(DATABASE_URL));
        let registered = migrations();
        assert_eq!(registered.len(), 10);
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
        assert_eq!(registered[9].description, "add_profile_recovery_key");
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
        assert_eq!(super::latest_schema_version(), Some(10));
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
                schema_version: 10,
                supported_schema_version: 10,
                migration_count: 10,
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
        sqlx::raw_sql(PROFILE_RECOVERY_SQL)
            .execute(&pool)
            .await
            .expect("profile recovery migration must apply");

        pool
    }

    #[tokio::test]
    async fn recovery_key_table_holds_only_argon2_hashes_and_follows_the_profile() {
        let pool = migrated_pool().await;
        sqlx::query("PRAGMA foreign_keys = ON")
            .execute(&pool)
            .await
            .unwrap();
        let profile = "profile-0123456789abcdef01234567";
        sqlx::query(
            "INSERT INTO local_profiles (id, display_name, name_key, created_at, updated_at)
             VALUES (?, 'Синтетичний', 'синтетичний', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z')",
        )
        .bind(profile)
        .execute(&pool)
        .await
        .unwrap();

        // Профіль без ключа — нормальний стан: таблиця порожня.
        let none: i64 = sqlx::query_scalar("SELECT count(*) FROM local_profile_recovery")
            .fetch_one(&pool)
            .await
            .unwrap();
        assert_eq!(none, 0);

        // Відкритий текст ключа в таблицю не потрапить: приймається лише хеш Argon2id.
        let plain = sqlx::query(
            "INSERT INTO local_profile_recovery (profile_id, key_hash, created_at)
             VALUES (?, 'ABCDE-FGHJK-MNPQR-STVWX-YZ012', '2026-01-01T00:00:00Z')",
        )
        .bind(profile)
        .execute(&pool)
        .await;
        assert!(plain.is_err());

        sqlx::query(
            "INSERT INTO local_profile_recovery (profile_id, key_hash, created_at)
             VALUES (?, '$argon2id$v=19$m=19456,t=2,p=1$c2FsdA$aGFzaA', '2026-01-01T00:00:00Z')",
        )
        .bind(profile)
        .execute(&pool)
        .await
        .unwrap();
        // Один ключ на профіль.
        let second = sqlx::query(
            "INSERT INTO local_profile_recovery (profile_id, key_hash, created_at)
             VALUES (?, '$argon2id$v=19$m=19456,t=2,p=1$c2FsdA$aGFzaA', '2026-01-02T00:00:00Z')",
        )
        .bind(profile)
        .execute(&pool)
        .await;
        assert!(second.is_err());
        // Ключ не може належати неіснуючому профілю.
        let orphan = sqlx::query(
            "INSERT INTO local_profile_recovery (profile_id, key_hash, created_at)
             VALUES ('profile-ffffffffffffffffffffffff', '$argon2id$v=19$m=19456,t=2,p=1$c2FsdA$aGFzaA', '2026-01-01T00:00:00Z')",
        )
        .execute(&pool)
        .await;
        assert!(orphan.is_err());

        sqlx::query("DELETE FROM local_profiles WHERE id = ?")
            .bind(profile)
            .execute(&pool)
            .await
            .unwrap();
        let left: i64 = sqlx::query_scalar("SELECT count(*) FROM local_profile_recovery")
            .fetch_one(&pool)
            .await
            .unwrap();
        assert_eq!(left, 0);
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
}
