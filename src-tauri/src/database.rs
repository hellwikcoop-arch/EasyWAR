use tauri_plugin_sql::{Migration, MigrationKind};

/// The SQLite file is resolved by the Tauri SQL plugin inside the app-local
/// configuration directory. Runtime database files must never be committed.
pub const DATABASE_URL: &str = "sqlite:easywar.db";

const INITIAL_SCHEMA_SQL: &str = include_str!("../migrations/0001_provenance_schema.sql");

pub fn migrations() -> Vec<Migration> {
    vec![Migration {
        version: 1,
        description: "create_provenance_schema",
        sql: INITIAL_SCHEMA_SQL,
        kind: MigrationKind::Up,
    }]
}

#[cfg(test)]
mod tests {
    use super::{migrations, DATABASE_URL, INITIAL_SCHEMA_SQL};
    use sqlx::{sqlite::SqlitePoolOptions, Row};

    #[test]
    fn database_is_local_and_registers_one_versioned_migration() {
        assert_eq!(DATABASE_URL, "sqlite:easywar.db");
        assert!(include_str!("../tauri.conf.json").contains(DATABASE_URL));
        let registered = migrations();
        assert_eq!(registered.len(), 1);
        assert_eq!(registered[0].version, 1);
        assert_eq!(registered[0].description, "create_provenance_schema");
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

        pool
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
