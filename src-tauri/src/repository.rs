use serde_json::{json, Value};
use sqlx::{Sqlite, SqlitePool, Transaction};

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum SourceType {
    Paste,
    Xlsx,
    Signal,
    Import,
    Other,
}

impl SourceType {
    fn as_str(self) -> &'static str {
        match self {
            Self::Paste => "PASTE",
            Self::Xlsx => "XLSX",
            Self::Signal => "SIGNAL",
            Self::Import => "IMPORT",
            Self::Other => "OTHER",
        }
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum ReviewDecision {
    NeedsReview,
    Approved,
    Rejected,
}

impl ReviewDecision {
    fn as_str(self) -> &'static str {
        match self {
            Self::NeedsReview => "NEEDS_REVIEW",
            Self::Approved => "APPROVED",
            Self::Rejected => "REJECTED",
        }
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum ActorType {
    System,
    User,
}

impl ActorType {
    fn as_str(self) -> &'static str {
        match self {
            Self::System => "SYSTEM",
            Self::User => "USER",
        }
    }
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct AuditContext {
    pub id: String,
    pub actor_type: ActorType,
    pub actor_label: Option<String>,
    pub occurred_at: String,
}

#[derive(Clone, Debug, PartialEq)]
pub struct CaptureReportInput {
    pub raw_source_id: String,
    pub report_id: String,
    pub source_type: SourceType,
    pub source_timestamp: Option<String>,
    pub captured_at: String,
    pub content_type: String,
    pub raw_text: Option<String>,
    pub raw_payload_json: Option<Value>,
    pub raw_sha256: String,
    pub metadata_json: Value,
    pub source_item_key: String,
    pub created_at: String,
    pub audit: AuditContext,
}

#[derive(Clone, Debug, PartialEq)]
pub struct StoreParseInput {
    pub id: String,
    pub report_id: String,
    pub version: i64,
    pub parser_name: String,
    pub parser_version: String,
    pub parsed_payload_json: Value,
    pub parsed_at: String,
    pub audit: AuditContext,
}

#[derive(Clone, Debug, PartialEq)]
pub struct RecordCorrectionInput {
    pub id: String,
    pub report_id: String,
    pub correction_number: i64,
    pub parsed_version_id: String,
    pub field_path: String,
    pub prior_value_json: Option<Value>,
    pub corrected_value_json: Value,
    pub reason: Option<String>,
    pub created_by: String,
    pub created_at: String,
    pub supersedes_correction_id: Option<String>,
    pub audit: AuditContext,
}

#[derive(Clone, Debug, PartialEq)]
pub struct ReviewAndReviseInput {
    pub decision_id: String,
    pub revision_id: String,
    pub report_id: String,
    pub decision_number: i64,
    pub revision_number: i64,
    pub parsed_version_id: String,
    pub decision: ReviewDecision,
    pub decided_by: String,
    pub rationale: Option<String>,
    pub decided_at: String,
    pub snapshot_json: Value,
    pub change_summary: Option<String>,
    pub audit: AuditContext,
}

#[derive(Debug, thiserror::Error)]
pub enum RepositoryError {
    #[error("database operation failed")]
    Database(#[from] sqlx::Error),
}

#[derive(Clone, Debug)]
pub struct Repository {
    pool: SqlitePool,
}

impl Repository {
    pub fn new(pool: SqlitePool) -> Self {
        Self { pool }
    }

    pub async fn capture_report(&self, input: &CaptureReportInput) -> Result<(), RepositoryError> {
        let mut transaction = self.pool.begin().await?;

        sqlx::query(
            "INSERT INTO raw_sources
             (id, source_type, source_timestamp, captured_at, content_type, raw_text,
              raw_payload_json, raw_sha256, metadata_json, created_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        )
        .bind(&input.raw_source_id)
        .bind(input.source_type.as_str())
        .bind(&input.source_timestamp)
        .bind(&input.captured_at)
        .bind(&input.content_type)
        .bind(&input.raw_text)
        .bind(input.raw_payload_json.as_ref().map(Value::to_string))
        .bind(&input.raw_sha256)
        .bind(input.metadata_json.to_string())
        .bind(&input.created_at)
        .execute(&mut *transaction)
        .await?;

        sqlx::query(
            "INSERT INTO reports (id, raw_source_id, source_item_key, created_at)
             VALUES (?, ?, ?, ?)",
        )
        .bind(&input.report_id)
        .bind(&input.raw_source_id)
        .bind(&input.source_item_key)
        .bind(&input.created_at)
        .execute(&mut *transaction)
        .await?;

        insert_audit(
            &mut transaction,
            &input.audit,
            Some(&input.report_id),
            "report",
            &input.report_id,
            "CAPTURED",
            json!({ "sourceType": input.source_type.as_str() }),
        )
        .await?;

        transaction.commit().await?;
        Ok(())
    }

    pub async fn store_parse(&self, input: &StoreParseInput) -> Result<(), RepositoryError> {
        let mut transaction = self.pool.begin().await?;

        sqlx::query(
            "INSERT INTO parsed_report_versions
             (id, report_id, version, parser_name, parser_version, parsed_payload_json, parsed_at)
             VALUES (?, ?, ?, ?, ?, ?, ?)",
        )
        .bind(&input.id)
        .bind(&input.report_id)
        .bind(input.version)
        .bind(&input.parser_name)
        .bind(&input.parser_version)
        .bind(input.parsed_payload_json.to_string())
        .bind(&input.parsed_at)
        .execute(&mut *transaction)
        .await?;

        insert_audit(
            &mut transaction,
            &input.audit,
            Some(&input.report_id),
            "parsed_report_version",
            &input.id,
            "PARSED",
            json!({ "version": input.version }),
        )
        .await?;

        transaction.commit().await?;
        Ok(())
    }

    pub async fn record_correction(
        &self,
        input: &RecordCorrectionInput,
    ) -> Result<(), RepositoryError> {
        let mut transaction = self.pool.begin().await?;

        sqlx::query(
            "INSERT INTO manual_corrections
             (id, report_id, correction_number, parsed_version_id, field_path,
              prior_value_json, corrected_value_json, reason, created_by, created_at,
              supersedes_correction_id)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        )
        .bind(&input.id)
        .bind(&input.report_id)
        .bind(input.correction_number)
        .bind(&input.parsed_version_id)
        .bind(&input.field_path)
        .bind(input.prior_value_json.as_ref().map(Value::to_string))
        .bind(input.corrected_value_json.to_string())
        .bind(&input.reason)
        .bind(&input.created_by)
        .bind(&input.created_at)
        .bind(&input.supersedes_correction_id)
        .execute(&mut *transaction)
        .await?;

        insert_audit(
            &mut transaction,
            &input.audit,
            Some(&input.report_id),
            "manual_correction",
            &input.id,
            "CORRECTED",
            json!({
                "correctionNumber": input.correction_number,
                "fieldPath": input.field_path,
            }),
        )
        .await?;

        transaction.commit().await?;
        Ok(())
    }

    pub async fn review_and_revise(
        &self,
        input: &ReviewAndReviseInput,
    ) -> Result<(), RepositoryError> {
        let mut transaction = self.pool.begin().await?;

        sqlx::query(
            "INSERT INTO review_decisions
             (id, report_id, decision_number, parsed_version_id, decision,
              decided_by, rationale, decided_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
        )
        .bind(&input.decision_id)
        .bind(&input.report_id)
        .bind(input.decision_number)
        .bind(&input.parsed_version_id)
        .bind(input.decision.as_str())
        .bind(&input.decided_by)
        .bind(&input.rationale)
        .bind(&input.decided_at)
        .execute(&mut *transaction)
        .await?;

        sqlx::query(
            "INSERT INTO revision_history
             (id, report_id, revision_number, parsed_version_id, review_decision_id,
              snapshot_json, change_summary, created_by, created_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
        )
        .bind(&input.revision_id)
        .bind(&input.report_id)
        .bind(input.revision_number)
        .bind(&input.parsed_version_id)
        .bind(&input.decision_id)
        .bind(input.snapshot_json.to_string())
        .bind(&input.change_summary)
        .bind(&input.decided_by)
        .bind(&input.decided_at)
        .execute(&mut *transaction)
        .await?;

        insert_audit(
            &mut transaction,
            &input.audit,
            Some(&input.report_id),
            "review_decision",
            &input.decision_id,
            input.decision.as_str(),
            json!({
                "decisionNumber": input.decision_number,
                "revisionId": input.revision_id,
                "revisionNumber": input.revision_number,
            }),
        )
        .await?;

        transaction.commit().await?;
        Ok(())
    }

    pub async fn current_status(&self, report_id: &str) -> Result<Option<String>, RepositoryError> {
        let status = sqlx::query_scalar(
            "SELECT current_status FROM report_current_state WHERE report_id = ?",
        )
        .bind(report_id)
        .fetch_optional(&self.pool)
        .await?;

        Ok(status)
    }
}

async fn insert_audit(
    transaction: &mut Transaction<'_, Sqlite>,
    audit: &AuditContext,
    report_id: Option<&str>,
    entity_type: &str,
    entity_id: &str,
    action: &str,
    details: Value,
) -> Result<(), sqlx::Error> {
    sqlx::query(
        "INSERT INTO audit_log
         (id, report_id, entity_type, entity_id, action, actor_type,
          actor_label, details_json, occurred_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
    )
    .bind(&audit.id)
    .bind(report_id)
    .bind(entity_type)
    .bind(entity_id)
    .bind(action)
    .bind(audit.actor_type.as_str())
    .bind(&audit.actor_label)
    .bind(details.to_string())
    .bind(&audit.occurred_at)
    .execute(&mut **transaction)
    .await?;

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::database::INITIAL_SCHEMA_SQL;
    use sqlx::sqlite::SqlitePoolOptions;

    const NOW: &str = "2026-01-01T00:00:00Z";

    async fn repository() -> Repository {
        let pool = SqlitePoolOptions::new()
            .max_connections(1)
            .connect("sqlite::memory:")
            .await
            .expect("synthetic in-memory SQLite must open");

        sqlx::raw_sql(INITIAL_SCHEMA_SQL)
            .execute(&pool)
            .await
            .expect("initial migration must apply");

        Repository::new(pool)
    }

    fn audit(id: &str) -> AuditContext {
        AuditContext {
            id: id.to_owned(),
            actor_type: ActorType::User,
            actor_label: Some("synthetic-tester".to_owned()),
            occurred_at: NOW.to_owned(),
        }
    }

    fn capture(source_id: &str, report_id: &str, audit_id: &str) -> CaptureReportInput {
        CaptureReportInput {
            raw_source_id: source_id.to_owned(),
            report_id: report_id.to_owned(),
            source_type: SourceType::Paste,
            source_timestamp: None,
            captured_at: NOW.to_owned(),
            content_type: "text/plain".to_owned(),
            raw_text: Some("Синтетична доповідь без реальних даних".to_owned()),
            raw_payload_json: None,
            raw_sha256: "a".repeat(64),
            metadata_json: json!({ "synthetic": true }),
            source_item_key: format!("item-{report_id}"),
            created_at: NOW.to_owned(),
            audit: audit(audit_id),
        }
    }

    fn parse(parse_id: &str, report_id: &str, audit_id: &str) -> StoreParseInput {
        StoreParseInput {
            id: parse_id.to_owned(),
            report_id: report_id.to_owned(),
            version: 1,
            parser_name: "synthetic-parser".to_owned(),
            parser_version: "test-1".to_owned(),
            parsed_payload_json: json!({ "synthetic": true, "result": "UNKNOWN" }),
            parsed_at: NOW.to_owned(),
            audit: audit(audit_id),
        }
    }

    #[tokio::test]
    async fn writes_provenance_and_matching_audit_events_atomically() {
        let repository = repository().await;

        repository
            .capture_report(&capture("source-1", "report-1", "audit-1"))
            .await
            .expect("synthetic report capture must succeed");
        repository
            .store_parse(&parse("parse-1", "report-1", "audit-2"))
            .await
            .expect("synthetic parse must succeed");
        repository
            .record_correction(&RecordCorrectionInput {
                id: "correction-1".to_owned(),
                report_id: "report-1".to_owned(),
                correction_number: 1,
                parsed_version_id: "parse-1".to_owned(),
                field_path: "$.result".to_owned(),
                prior_value_json: Some(json!("UNKNOWN")),
                corrected_value_json: json!("REVIEWED"),
                reason: Some("synthetic correction".to_owned()),
                created_by: "synthetic-tester".to_owned(),
                created_at: NOW.to_owned(),
                supersedes_correction_id: None,
                audit: audit("audit-3"),
            })
            .await
            .expect("synthetic correction must succeed");
        repository
            .review_and_revise(&ReviewAndReviseInput {
                decision_id: "decision-1".to_owned(),
                revision_id: "revision-1".to_owned(),
                report_id: "report-1".to_owned(),
                decision_number: 1,
                revision_number: 1,
                parsed_version_id: "parse-1".to_owned(),
                decision: ReviewDecision::Approved,
                decided_by: "synthetic-tester".to_owned(),
                rationale: Some("synthetic approval".to_owned()),
                decided_at: NOW.to_owned(),
                snapshot_json: json!({ "synthetic": true, "result": "REVIEWED" }),
                change_summary: Some("synthetic first revision".to_owned()),
                audit: audit("audit-4"),
            })
            .await
            .expect("synthetic review and revision must succeed");

        let audit_count: i64 =
            sqlx::query_scalar("SELECT count(*) FROM audit_log WHERE report_id = 'report-1'")
                .fetch_one(&repository.pool)
                .await
                .expect("audit count must query");
        assert_eq!(audit_count, 4);
        assert_eq!(
            repository
                .current_status("report-1")
                .await
                .expect("current status must query"),
            Some("APPROVED".to_owned())
        );
    }

    #[tokio::test]
    async fn failed_capture_rolls_back_raw_source_and_audit_event() {
        let repository = repository().await;
        repository
            .capture_report(&capture("source-1", "report-1", "audit-1"))
            .await
            .expect("first synthetic report capture must succeed");

        let result = repository
            .capture_report(&capture("source-2", "report-1", "audit-2"))
            .await;
        assert!(result.is_err());

        let leaked_rows: i64 = sqlx::query_scalar(
            "SELECT
                (SELECT count(*) FROM raw_sources WHERE id = 'source-2') +
                (SELECT count(*) FROM audit_log WHERE id = 'audit-2')",
        )
        .fetch_one(&repository.pool)
        .await
        .expect("rollback state must query");
        assert_eq!(leaked_rows, 0);
    }

    #[tokio::test]
    async fn failed_cross_report_review_rolls_back_decision_revision_and_audit() {
        let repository = repository().await;
        repository
            .capture_report(&capture("source-1", "report-1", "audit-1"))
            .await
            .expect("first synthetic report capture must succeed");
        repository
            .capture_report(&capture("source-2", "report-2", "audit-2"))
            .await
            .expect("second synthetic report capture must succeed");
        repository
            .store_parse(&parse("parse-1", "report-1", "audit-3"))
            .await
            .expect("synthetic parse must succeed");

        let result = repository
            .review_and_revise(&ReviewAndReviseInput {
                decision_id: "decision-invalid".to_owned(),
                revision_id: "revision-invalid".to_owned(),
                report_id: "report-2".to_owned(),
                decision_number: 1,
                revision_number: 1,
                parsed_version_id: "parse-1".to_owned(),
                decision: ReviewDecision::NeedsReview,
                decided_by: "synthetic-tester".to_owned(),
                rationale: None,
                decided_at: NOW.to_owned(),
                snapshot_json: json!({ "synthetic": true }),
                change_summary: None,
                audit: audit("audit-invalid"),
            })
            .await;
        assert!(result.is_err());

        let leaked_rows: i64 = sqlx::query_scalar(
            "SELECT
                (SELECT count(*) FROM review_decisions WHERE id = 'decision-invalid') +
                (SELECT count(*) FROM revision_history WHERE id = 'revision-invalid') +
                (SELECT count(*) FROM audit_log WHERE id = 'audit-invalid')",
        )
        .fetch_one(&repository.pool)
        .await
        .expect("rollback state must query");
        assert_eq!(leaked_rows, 0);
    }
}
