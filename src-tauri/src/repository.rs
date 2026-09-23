use crate::xlsx_import::XlsxImportBatch;
use serde::Serialize;
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use sqlx::{Sqlite, SqlitePool, Transaction};
use std::collections::BTreeSet;

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

#[derive(Clone, Debug, PartialEq)]
pub struct SettingUpdate {
    pub key: String,
    pub value: Value,
    pub updated_at: String,
}

#[derive(Clone, Debug, PartialEq)]
pub struct StoredSetting {
    pub key: String,
    pub value: Value,
    pub updated_at: String,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
pub struct XlsxStageResult {
    pub staged_rows: usize,
    pub already_present_rows: usize,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
pub struct SignalInboxItem {
    pub report_id: String,
    pub source_item_key: String,
    pub source_timestamp: Option<String>,
    pub captured_at: String,
    pub current_status: String,
    pub raw_sha256: String,
}

type ExistingXlsxRow = (String, Option<String>, Option<String>, Option<String>);

#[derive(Debug, thiserror::Error)]
pub enum RepositoryError {
    #[error("database operation failed")]
    Database(#[from] sqlx::Error),
    #[error("stored setting contains invalid JSON")]
    InvalidStoredSettingJson(#[from] serde_json::Error),
    #[error("Некоректний пакет імпорту XLSX: {0}")]
    InvalidXlsxBatch(String),
    #[error("Наявний рядок XLSX має інший вміст або неповну історію: {0}")]
    XlsxIdentityConflict(String),
    #[error("Не вдалося серіалізувати розібраний рядок XLSX")]
    InvalidXlsxPayload(serde_json::Error),
    #[error("Ліміт локальної черги Signal має бути від 1 до 100")]
    InvalidSignalInboxLimit,
}

#[derive(Clone, Debug)]
pub struct Repository {
    pool: SqlitePool,
}

#[derive(Clone, Debug)]
pub struct SettingsStore {
    pool: SqlitePool,
}

impl SettingsStore {
    pub fn new(pool: SqlitePool) -> Self {
        Self { pool }
    }

    pub async fn get(&self, key: &str) -> Result<Option<StoredSetting>, RepositoryError> {
        let row = sqlx::query_as::<_, (String, String, String)>(
            "SELECT key, value_json, updated_at FROM settings WHERE key = ?",
        )
        .bind(key)
        .fetch_optional(&self.pool)
        .await?;

        row.map(parse_stored_setting).transpose()
    }

    pub async fn list(&self) -> Result<Vec<StoredSetting>, RepositoryError> {
        let rows = sqlx::query_as::<_, (String, String, String)>(
            "SELECT key, value_json, updated_at FROM settings ORDER BY key",
        )
        .fetch_all(&self.pool)
        .await?;

        rows.into_iter().map(parse_stored_setting).collect()
    }

    pub async fn upsert(&self, update: &SettingUpdate) -> Result<(), RepositoryError> {
        sqlx::query(
            "INSERT INTO settings (key, value_json, updated_at)
             VALUES (?, ?, ?)
             ON CONFLICT(key) DO UPDATE SET
                 value_json = excluded.value_json,
                 updated_at = excluded.updated_at",
        )
        .bind(&update.key)
        .bind(update.value.to_string())
        .bind(&update.updated_at)
        .execute(&self.pool)
        .await?;

        Ok(())
    }

    pub async fn delete(&self, key: &str) -> Result<bool, RepositoryError> {
        let result = sqlx::query("DELETE FROM settings WHERE key = ?")
            .bind(key)
            .execute(&self.pool)
            .await?;

        Ok(result.rows_affected() == 1)
    }
}

fn parse_stored_setting(
    (key, value_json, updated_at): (String, String, String),
) -> Result<StoredSetting, RepositoryError> {
    Ok(StoredSetting {
        key,
        value: serde_json::from_str(&value_json)?,
        updated_at,
    })
}

impl Repository {
    pub fn new(pool: SqlitePool) -> Self {
        Self { pool }
    }

    pub async fn stage_xlsx_batch(
        &self,
        batch: &XlsxImportBatch,
        captured_at: &str,
    ) -> Result<XlsxStageResult, RepositoryError> {
        let hash = &batch.workbook_sha256;
        if hash.len() != 64
            || !hash
                .bytes()
                .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
            || batch.sheet_name.trim().is_empty()
            || captured_at.trim().is_empty()
        {
            return Err(RepositoryError::InvalidXlsxBatch(
                "немає коректної ідентичності файлу, аркуша або часу".to_owned(),
            ));
        }
        let mut row_numbers = BTreeSet::new();
        for row in &batch.rows {
            if row.row_number < 2
                || !row_numbers.insert(row.row_number)
                || row.source_cells.is_empty()
            {
                return Err(RepositoryError::InvalidXlsxBatch(format!(
                    "неоднозначний або порожній рядок {}",
                    row.row_number
                )));
            }
        }

        let mut transaction = self.pool.begin().await?;
        let mut result = XlsxStageResult {
            staged_rows: 0,
            already_present_rows: 0,
        };
        for row in &batch.rows {
            let key = format!("{hash}:{}", row.row_number);
            let source_id = format!("xlsx-source:{key}");
            let report_id = format!("xlsx-report:{key}");
            let parse_id = format!("xlsx-parse:{key}:v1");
            let capture_audit_id = format!("xlsx-audit:capture:{key}");
            let parse_audit_id = format!("xlsx-audit:parse:{key}");
            let source_item_key = format!("row:{}", row.row_number);
            let raw_payload_json = json!({ "cells": &row.source_cells }).to_string();
            let raw_sha256 = format!("{:x}", Sha256::digest(raw_payload_json.as_bytes()));
            let parsed_payload_json =
                serde_json::to_string(&row.parsed).map_err(RepositoryError::InvalidXlsxPayload)?;

            let existing: Option<ExistingXlsxRow> = sqlx::query_as(
                    "SELECT raw_sources.raw_sha256, reports.id,
                            parsed_report_versions.id, parsed_report_versions.parsed_payload_json
                     FROM raw_sources
                     LEFT JOIN reports ON reports.raw_source_id = raw_sources.id AND reports.id = ?
                     LEFT JOIN parsed_report_versions ON parsed_report_versions.report_id = reports.id
                         AND parsed_report_versions.id = ?
                     WHERE raw_sources.id = ?",
                )
                .bind(&report_id)
                .bind(&parse_id)
                .bind(&source_id)
                .fetch_optional(&mut *transaction)
                .await?;
            if let Some((stored_hash, stored_report, stored_parse, stored_payload)) = existing {
                let audit_count: i64 = sqlx::query_scalar(
                    "SELECT count(*) FROM audit_log
                     WHERE (id = ? AND report_id = ? AND action = 'CAPTURED')
                        OR (id = ? AND report_id = ? AND action = 'PARSED')",
                )
                .bind(&capture_audit_id)
                .bind(&report_id)
                .bind(&parse_audit_id)
                .bind(&report_id)
                .fetch_one(&mut *transaction)
                .await?;
                if stored_hash != raw_sha256
                    || stored_report.as_deref() != Some(&report_id)
                    || stored_parse.as_deref() != Some(&parse_id)
                    || stored_payload.as_deref() != Some(&parsed_payload_json)
                    || audit_count != 2
                {
                    return Err(RepositoryError::XlsxIdentityConflict(key));
                }
                result.already_present_rows += 1;
                continue;
            }

            sqlx::query(
                "INSERT INTO raw_sources
                 (id, source_type, captured_at, content_type, raw_payload_json,
                  raw_sha256, metadata_json, created_at)
                 VALUES (?, 'XLSX', ?, 'application/json', ?, ?, ?, ?)",
            )
            .bind(&source_id)
            .bind(captured_at)
            .bind(&raw_payload_json)
            .bind(&raw_sha256)
            .bind(
                json!({
                    "workbook_sha256": hash,
                    "sheet_name": &batch.sheet_name,
                    "row_number": row.row_number,
                    "snapshot_kind": "interpreted_cell_values"
                })
                .to_string(),
            )
            .bind(captured_at)
            .execute(&mut *transaction)
            .await?;
            sqlx::query(
                "INSERT INTO reports (id, raw_source_id, source_item_key, created_at)
                 VALUES (?, ?, ?, ?)",
            )
            .bind(&report_id)
            .bind(&source_id)
            .bind(&source_item_key)
            .bind(captured_at)
            .execute(&mut *transaction)
            .await?;
            insert_audit(
                &mut transaction,
                &AuditContext {
                    id: capture_audit_id,
                    actor_type: ActorType::System,
                    actor_label: None,
                    occurred_at: captured_at.to_owned(),
                },
                Some(&report_id),
                "report",
                &report_id,
                "CAPTURED",
                json!({ "sourceType": "XLSX" }),
            )
            .await?;
            sqlx::query(
                "INSERT INTO parsed_report_versions
                 (id, report_id, version, parser_name, parser_version, parsed_payload_json, parsed_at)
                 VALUES (?, ?, 1, 'easywar-xlsx', '1', ?, ?)",
            )
            .bind(&parse_id)
            .bind(&report_id)
            .bind(&parsed_payload_json)
            .bind(captured_at)
            .execute(&mut *transaction)
            .await?;
            insert_audit(
                &mut transaction,
                &AuditContext {
                    id: parse_audit_id,
                    actor_type: ActorType::System,
                    actor_label: None,
                    occurred_at: captured_at.to_owned(),
                },
                Some(&report_id),
                "parsed_report_version",
                &parse_id,
                "PARSED",
                json!({ "version": 1 }),
            )
            .await?;
            result.staged_rows += 1;
        }

        transaction.commit().await?;
        Ok(result)
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

    pub async fn list_signal_inbox(
        &self,
        limit: u32,
    ) -> Result<Vec<SignalInboxItem>, RepositoryError> {
        if !(1..=100).contains(&limit) {
            return Err(RepositoryError::InvalidSignalInboxLimit);
        }

        let rows = sqlx::query_as::<_, (String, String, Option<String>, String, String, String)>(
            "SELECT reports.id, reports.source_item_key, raw_sources.source_timestamp,
                    raw_sources.captured_at, report_current_state.current_status,
                    raw_sources.raw_sha256
             FROM reports
             JOIN raw_sources ON raw_sources.id = reports.raw_source_id
             JOIN report_current_state ON report_current_state.report_id = reports.id
             WHERE raw_sources.source_type = 'SIGNAL'
             ORDER BY raw_sources.captured_at DESC, reports.id DESC
             LIMIT ?",
        )
        .bind(i64::from(limit))
        .fetch_all(&self.pool)
        .await?;

        Ok(rows
            .into_iter()
            .map(
                |(
                    report_id,
                    source_item_key,
                    source_timestamp,
                    captured_at,
                    current_status,
                    raw_sha256,
                )| SignalInboxItem {
                    report_id,
                    source_item_key,
                    source_timestamp,
                    captured_at,
                    current_status,
                    raw_sha256,
                },
            )
            .collect())
    }

    pub async fn signal_report_text(
        &self,
        report_id: &str,
    ) -> Result<Option<String>, RepositoryError> {
        let raw_text = sqlx::query_scalar(
            "SELECT raw_sources.raw_text
             FROM reports
             JOIN raw_sources ON raw_sources.id = reports.raw_source_id
             WHERE reports.id = ? AND raw_sources.source_type = 'SIGNAL'",
        )
        .bind(report_id)
        .fetch_optional(&self.pool)
        .await?
        .flatten();

        Ok(raw_text)
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
    use crate::xlsx_import::{EasyWarRecord, XlsxImportRow, XlsxSourceCell};
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
    async fn lists_only_signal_provenance_without_raw_content() {
        let repository = repository().await;
        let mut signal = capture("signal-source-1", "signal-report-1", "signal-audit-1");
        signal.source_type = SourceType::Signal;
        signal.source_timestamp = Some("2026-01-01T00:00:01Z".to_owned());
        signal.raw_text = Some("SECRET-SYNTHETIC-MESSAGE".to_owned());
        signal.raw_payload_json = Some(json!({ "message": "SECRET-SYNTHETIC-PAYLOAD" }));
        signal.raw_sha256 = "b".repeat(64);

        repository
            .capture_report(&signal)
            .await
            .expect("synthetic Signal report capture must succeed");
        repository
            .capture_report(&capture(
                "paste-source-1",
                "paste-report-1",
                "paste-audit-1",
            ))
            .await
            .expect("synthetic paste capture must succeed");

        let items = repository
            .list_signal_inbox(100)
            .await
            .expect("synthetic Signal Inbox must query");
        assert_eq!(items.len(), 1);
        assert_eq!(items[0].report_id, "signal-report-1");
        assert_eq!(items[0].current_status, "NEW");

        let serialized = serde_json::to_string(&items).expect("Inbox item must serialize");
        assert!(!serialized.contains("SECRET-SYNTHETIC-MESSAGE"));
        assert!(!serialized.contains("SECRET-SYNTHETIC-PAYLOAD"));
        assert!(!serialized.contains("raw_text"));
        assert!(!serialized.contains("raw_payload_json"));

        repository
            .store_parse(&parse(
                "signal-parse-1",
                "signal-report-1",
                "signal-audit-2",
            ))
            .await
            .expect("synthetic Signal parse must succeed");
        let parsed = repository
            .list_signal_inbox(1)
            .await
            .expect("parsed Signal Inbox must query");
        assert_eq!(parsed[0].current_status, "PARSED");
    }

    #[tokio::test]
    async fn rejects_signal_inbox_limits_outside_the_read_only_bound() {
        let repository = repository().await;
        assert!(matches!(
            repository.list_signal_inbox(0).await,
            Err(RepositoryError::InvalidSignalInboxLimit)
        ));
        assert!(matches!(
            repository.list_signal_inbox(101).await,
            Err(RepositoryError::InvalidSignalInboxLimit)
        ));
    }

    #[tokio::test]
    async fn returns_raw_text_only_for_an_exact_signal_report_id() {
        let repository = repository().await;
        let mut signal = capture("signal-source-2", "signal-report-2", "signal-audit-2");
        signal.source_type = SourceType::Signal;
        signal.raw_text = Some("Синтетичний текст Signal для ручної перевірки".to_owned());
        signal.raw_sha256 = "c".repeat(64);

        repository
            .capture_report(&signal)
            .await
            .expect("synthetic Signal report capture must succeed");
        repository
            .capture_report(&capture(
                "paste-source-2",
                "paste-report-2",
                "paste-audit-2",
            ))
            .await
            .expect("synthetic paste capture must succeed");

        assert_eq!(
            repository
                .signal_report_text("signal-report-2")
                .await
                .expect("exact Signal lookup must query"),
            Some("Синтетичний текст Signal для ручної перевірки".to_owned())
        );
        assert_eq!(
            repository
                .signal_report_text("paste-report-2")
                .await
                .expect("non-Signal lookup must query"),
            None
        );
        assert_eq!(
            repository
                .signal_report_text("missing-report")
                .await
                .expect("missing lookup must query"),
            None
        );
    }

    fn synthetic_xlsx_row(row_number: u32) -> XlsxImportRow {
        let number = (row_number - 1).to_string();
        let raw_date = if row_number == 2 {
            "01.01.2026"
        } else {
            "02.01.2026"
        };
        let parsed_date = if row_number == 2 {
            "2026-01-01"
        } else {
            "2026-01-02"
        };
        let headers = [
            "№",
            "Дата",
            "Час ураження",
            "№ цілі (TS/KS)",
            "В інтересах",
            "Район / н.п.",
            "DPI / Координати MGRS",
            "Тип цілі",
            "Місяць",
            "Тип ЛА",
            "Тип боєприпасу",
            "К-сть боєприпасів",
            "Результат ураження",
            "Причина",
            "Уточнення результату",
        ];
        let values = [
            number.as_str(),
            raw_date,
            "10:15",
            "SYN-ONLY",
            "Синтетичний підрозділ",
            "Тестовий район",
            "",
            "Навчальна ціль",
            "Січень",
            "Навчальний ЛА",
            "Навчальний БП",
            "1",
            "НЕВІДОМО",
            "",
            "Синтетичний запис",
        ];
        let raw_values = headers
            .iter()
            .zip(values)
            .map(|(header, value)| ((*header).to_owned(), value.to_owned()))
            .collect();
        let mut source_cells: Vec<XlsxSourceCell> = headers
            .iter()
            .zip(values)
            .enumerate()
            .map(|(index, (header, value))| XlsxSourceCell {
                column: index as u32 + 1,
                header: (*header).to_owned(),
                value: value.to_owned(),
            })
            .collect();
        source_cells.push(XlsxSourceCell {
            column: 16,
            header: "Додаткове поле".to_owned(),
            value: "Синтетичне значення".to_owned(),
        });
        XlsxImportRow {
            row_number,
            raw_values,
            source_cells,
            parsed: EasyWarRecord {
                number,
                date: parsed_date.to_owned(),
                time: "10:15".to_owned(),
                target_ids: "SYN-ONLY".to_owned(),
                unit: "Синтетичний підрозділ".to_owned(),
                district: "Тестовий район".to_owned(),
                coordinates: String::new(),
                target_type: "Навчальна ціль".to_owned(),
                month: "Січень".to_owned(),
                aircraft: "Навчальний ЛА".to_owned(),
                munition: "Навчальний БП".to_owned(),
                munition_count: "1".to_owned(),
                result: "НЕВІДОМО".to_owned(),
                cause: String::new(),
                note: "Синтетичний запис".to_owned(),
            },
        }
    }

    fn synthetic_xlsx_batch() -> XlsxImportBatch {
        XlsxImportBatch {
            workbook_sha256: format!("{:x}", Sha256::digest(b"synthetic-only-workbook")),
            sheet_name: "Зведена".to_owned(),
            rows: vec![synthetic_xlsx_row(2), synthetic_xlsx_row(3)],
        }
    }

    #[tokio::test]
    async fn stages_synthetic_xlsx_in_separate_provenance_layers_without_approval() {
        let repository = repository().await;
        let batch = synthetic_xlsx_batch();
        let first = repository
            .stage_xlsx_batch(&batch, NOW)
            .await
            .expect("synthetic rows must stage");
        assert_eq!(first.staged_rows, 2);
        assert_eq!(first.already_present_rows, 0);

        let counts: (i64, i64, i64, i64, i64, i64, i64) = sqlx::query_as(
            "SELECT (SELECT count(*) FROM raw_sources),
                    (SELECT count(*) FROM reports),
                    (SELECT count(*) FROM parsed_report_versions),
                    (SELECT count(*) FROM audit_log),
                    (SELECT count(*) FROM manual_corrections),
                    (SELECT count(*) FROM review_decisions),
                    (SELECT count(*) FROM revision_history)",
        )
        .fetch_one(&repository.pool)
        .await
        .expect("synthetic provenance counts must query");
        assert_eq!(counts, (2, 2, 2, 4, 0, 0, 0));
        let statuses: Vec<String> = sqlx::query_scalar(
            "SELECT current_status FROM report_current_state ORDER BY report_id",
        )
        .fetch_all(&repository.pool)
        .await
        .expect("synthetic statuses must query");
        assert_eq!(statuses, vec!["PARSED", "PARSED"]);
        let raw_payload: String =
            sqlx::query_scalar("SELECT raw_payload_json FROM raw_sources WHERE id = ?")
                .bind(format!("xlsx-source:{}:2", batch.workbook_sha256))
                .fetch_one(&repository.pool)
                .await
                .expect("synthetic raw payload must query");
        assert!(raw_payload.contains("Синтетичне значення"));
        assert!(raw_payload.contains("01.01.2026"));
        let parsed_payload: String = sqlx::query_scalar(
            "SELECT parsed_payload_json FROM parsed_report_versions WHERE report_id = ?",
        )
        .bind(format!("xlsx-report:{}:2", batch.workbook_sha256))
        .fetch_one(&repository.pool)
        .await
        .expect("synthetic parsed payload must query");
        assert_eq!(
            serde_json::from_str::<Value>(&parsed_payload)
                .expect("synthetic parsed JSON")
                .get("date"),
            Some(&json!("2026-01-01"))
        );

        let retry = repository
            .stage_xlsx_batch(&batch, NOW)
            .await
            .expect("exact synthetic retry must be idempotent");
        assert_eq!(retry.staged_rows, 0);
        assert_eq!(retry.already_present_rows, 2);
        let audit_count: i64 = sqlx::query_scalar("SELECT count(*) FROM audit_log")
            .fetch_one(&repository.pool)
            .await
            .expect("retry audit count must query");
        assert_eq!(audit_count, 4);

        let mut changed_parse = batch.clone();
        changed_parse.rows[0].parsed.note = "Інше синтетичне значення".to_owned();
        assert!(matches!(
            repository.stage_xlsx_batch(&changed_parse, NOW).await,
            Err(RepositoryError::XlsxIdentityConflict(_))
        ));
    }

    #[tokio::test]
    async fn duplicate_xlsx_row_numbers_are_rejected_before_any_write() {
        let repository = repository().await;
        let mut batch = synthetic_xlsx_batch();
        batch.rows[1].row_number = batch.rows[0].row_number;

        assert!(matches!(
            repository.stage_xlsx_batch(&batch, NOW).await,
            Err(RepositoryError::InvalidXlsxBatch(_))
        ));
        let count: i64 = sqlx::query_scalar("SELECT count(*) FROM raw_sources")
            .fetch_one(&repository.pool)
            .await
            .expect("empty synthetic database must query");
        assert_eq!(count, 0);
    }

    #[tokio::test]
    async fn xlsx_identity_conflict_rolls_back_the_entire_new_batch() {
        let repository = repository().await;
        let batch = synthetic_xlsx_batch();
        sqlx::query(
            "INSERT INTO raw_sources
             (id, source_type, captured_at, content_type, raw_text, raw_sha256, created_at)
             VALUES (?, 'XLSX', ?, 'text/plain', ?, ?, ?)",
        )
        .bind(format!("xlsx-source:{}:3", batch.workbook_sha256))
        .bind(NOW)
        .bind("синтетичний конфлікт")
        .bind("b".repeat(64))
        .bind(NOW)
        .execute(&repository.pool)
        .await
        .expect("synthetic conflict must seed");

        let error = repository
            .stage_xlsx_batch(&batch, NOW)
            .await
            .expect_err("conflicting identity must fail closed");
        assert!(matches!(error, RepositoryError::XlsxIdentityConflict(_)));
        let counts: (i64, i64, i64, i64) = sqlx::query_as(
            "SELECT (SELECT count(*) FROM raw_sources),
                    (SELECT count(*) FROM reports),
                    (SELECT count(*) FROM parsed_report_versions),
                    (SELECT count(*) FROM audit_log)",
        )
        .fetch_one(&repository.pool)
        .await
        .expect("rollback counts must query");
        assert_eq!(counts, (1, 0, 0, 0));
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

    #[tokio::test]
    async fn settings_store_round_trips_and_lists_local_json() {
        let repository = repository().await;
        let settings = SettingsStore::new(repository.pool.clone());

        settings
            .upsert(&SettingUpdate {
                key: "ui.theme".to_owned(),
                value: json!({ "mode": "dark", "synthetic": true }),
                updated_at: NOW.to_owned(),
            })
            .await
            .expect("synthetic theme setting must store");
        settings
            .upsert(&SettingUpdate {
                key: "ui.motion".to_owned(),
                value: json!({ "enabled": false, "synthetic": true }),
                updated_at: NOW.to_owned(),
            })
            .await
            .expect("synthetic motion setting must store");

        let theme = settings
            .get("ui.theme")
            .await
            .expect("synthetic theme setting must query")
            .expect("synthetic theme setting must exist");
        assert_eq!(theme.key, "ui.theme");
        assert_eq!(theme.value, json!({ "mode": "dark", "synthetic": true }));
        assert_eq!(theme.updated_at, NOW);

        let keys: Vec<String> = settings
            .list()
            .await
            .expect("synthetic settings must list")
            .into_iter()
            .map(|setting| setting.key)
            .collect();
        assert_eq!(keys, vec!["ui.motion", "ui.theme"]);

        let audit_count: i64 = sqlx::query_scalar("SELECT count(*) FROM audit_log")
            .fetch_one(&repository.pool)
            .await
            .expect("audit count must query");
        assert_eq!(audit_count, 0);
    }

    #[tokio::test]
    async fn settings_store_upserts_and_deletes_without_duplicates() {
        let repository = repository().await;
        let settings = SettingsStore::new(repository.pool.clone());
        let key = "intake.synthetic";

        settings
            .upsert(&SettingUpdate {
                key: key.to_owned(),
                value: json!({ "enabled": false }),
                updated_at: "2026-01-01T00:00:00Z".to_owned(),
            })
            .await
            .expect("first synthetic setting version must store");
        settings
            .upsert(&SettingUpdate {
                key: key.to_owned(),
                value: json!({ "enabled": true }),
                updated_at: "2026-01-02T00:00:00Z".to_owned(),
            })
            .await
            .expect("second synthetic setting version must replace the first");

        let row_count: i64 = sqlx::query_scalar("SELECT count(*) FROM settings WHERE key = ?")
            .bind(key)
            .fetch_one(&repository.pool)
            .await
            .expect("synthetic setting count must query");
        assert_eq!(row_count, 1);
        assert_eq!(
            settings
                .get(key)
                .await
                .expect("updated synthetic setting must query")
                .expect("updated synthetic setting must exist")
                .value,
            json!({ "enabled": true })
        );

        assert!(settings
            .delete(key)
            .await
            .expect("existing synthetic setting must delete"));
        assert!(!settings
            .delete(key)
            .await
            .expect("missing synthetic setting deletion must be idempotent"));
        assert_eq!(
            settings
                .get(key)
                .await
                .expect("deleted synthetic setting lookup must succeed"),
            None
        );
    }
}
