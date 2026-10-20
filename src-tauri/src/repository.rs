use crate::xlsx_import::XlsxImportBatch;
use serde::Serialize;
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use sqlx::{Sqlite, SqlitePool, Transaction};
use std::collections::BTreeSet;

const SIGNAL_LEGACY_PARSER_NAME: &str = "easywar-legacy-core";
const SIGNAL_LEGACY_PARSER_VERSION: &str = "1";
const SIGNAL_PARSE_MAX_BYTES: usize = 1024 * 1024;
const SIGNAL_PARSE_MAX_RECORDS: usize = 64;
const SIGNAL_REVIEW_ACTOR: &str = "easywar-local-user";
const SIGNAL_CORRECTION_MAX_FIELDS: usize = 256;
const SIGNAL_CORRECTION_FIELDS: &[&str] = &[
    "date", "time", "targets", "unit", "district", "aircraft", "munition", "count", "result",
    "types", "cause", "dpi", "note", "month",
];

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
    pub duplicate_rows: usize,
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

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct SignalCommandLastItem {
    pub captured_at: String,
    pub current_status: String,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct SignalCommandQueueSnapshot {
    pub total: u64,
    pub new_count: u64,
    pub parsed_count: u64,
    pub needs_review_count: u64,
    pub approved_count: u64,
    pub rejected_count: u64,
    pub last: Option<SignalCommandLastItem>,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
pub struct SignalParsePersistence {
    pub report_id: String,
    pub parsed_version_id: String,
    pub version: i64,
    pub current_status: String,
    pub inserted: bool,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
pub struct SignalReviewPersistence {
    pub report_id: String,
    pub parsed_version_id: String,
    pub decision_id: String,
    pub revision_id: String,
    pub current_status: String,
    pub inserted: bool,
    pub correction_count: usize,
}

#[derive(Clone, Debug, PartialEq, Serialize)]
pub struct SignalReviewSnapshot {
    pub report_id: String,
    pub parsed_version_id: String,
    pub current_status: String,
    pub snapshot_json: Value,
}

type ExistingXlsxRow = (String, Option<String>, Option<String>, Option<String>);
type ExistingXlsxFingerprint = (String, Option<String>);

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
    #[error("Запис Signal не знайдено")]
    SignalReportNotFound,
    #[error("Некоректний результат парсера Signal: {0}")]
    InvalidSignalParsePayload(String),
    #[error("Запис Signal має неприпустимий стан для цієї дії: {0}")]
    InvalidSignalReportState(String),
    #[error("Потрібен коректний локальний ідентифікатор рецензента")]
    InvalidSignalReviewer,
    #[error("Некоректний набір ручних виправлень Signal: {0}")]
    InvalidSignalCorrections(String),
    #[error("Збережений схвалений знімок має некоректний JSON")]
    InvalidApprovedSnapshotJson,
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
            duplicate_rows: 0,
        };
        for row in &batch.rows {
            let key = format!("{hash}:{}", row.row_number);
            let source_id = format!("xlsx-source:{key}");
            let report_id = format!("xlsx-report:{key}");
            let parse_id = format!("xlsx-parse:{key}:v1");
            let capture_audit_id = format!("xlsx-audit:capture:{key}");
            let parse_audit_id = format!("xlsx-audit:parse:{key}");
            let duplicate_audit_id = format!("xlsx-audit:duplicate:{key}");
            let source_item_key = format!("row:{}", row.row_number);
            let raw_payload_json = json!({ "cells": &row.source_cells }).to_string();
            let raw_sha256 = format!("{:x}", Sha256::digest(raw_payload_json.as_bytes()));
            let parsed_payload_json =
                serde_json::to_string(&row.parsed).map_err(RepositoryError::InvalidXlsxPayload)?;
            let fingerprint_sha256 =
                format!("{:x}", Sha256::digest(parsed_payload_json.as_bytes()));

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
                let stored_fingerprint: Option<ExistingXlsxFingerprint> = sqlx::query_as(
                    "SELECT fingerprint_sha256, duplicate_of_report_id
                     FROM xlsx_row_fingerprints WHERE report_id = ?",
                )
                .bind(&report_id)
                .fetch_optional(&mut *transaction)
                .await?;
                let duplicate_of_report_id = match stored_fingerprint {
                    Some((stored_fingerprint, duplicate_of_report_id)) => {
                        if stored_fingerprint != fingerprint_sha256 {
                            return Err(RepositoryError::XlsxIdentityConflict(key));
                        }
                        let duplicate_audit_count: i64 = sqlx::query_scalar(
                            "SELECT count(*) FROM audit_log
                             WHERE id = ? AND report_id = ? AND action = 'DUPLICATE_DETECTED'",
                        )
                        .bind(&duplicate_audit_id)
                        .bind(&report_id)
                        .fetch_one(&mut *transaction)
                        .await?;
                        if duplicate_audit_count != i64::from(duplicate_of_report_id.is_some()) {
                            return Err(RepositoryError::XlsxIdentityConflict(key));
                        }
                        duplicate_of_report_id
                    }
                    None => {
                        let duplicate_of_report_id = find_prior_xlsx_duplicate(
                            &mut transaction,
                            &report_id,
                            &parsed_payload_json,
                        )
                        .await?;
                        insert_xlsx_fingerprint(
                            &mut transaction,
                            &report_id,
                            &fingerprint_sha256,
                            duplicate_of_report_id.as_deref(),
                            captured_at,
                            &duplicate_audit_id,
                        )
                        .await?;
                        duplicate_of_report_id
                    }
                };
                result.already_present_rows += 1;
                result.duplicate_rows += usize::from(duplicate_of_report_id.is_some());
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
            let duplicate_of_report_id =
                find_prior_xlsx_duplicate(&mut transaction, &report_id, &parsed_payload_json)
                    .await?;
            insert_xlsx_fingerprint(
                &mut transaction,
                &report_id,
                &fingerprint_sha256,
                duplicate_of_report_id.as_deref(),
                captured_at,
                &duplicate_audit_id,
            )
            .await?;
            result.staged_rows += 1;
            result.duplicate_rows += usize::from(duplicate_of_report_id.is_some());
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

    pub async fn approved_revision_snapshots(&self) -> Result<Vec<Value>, RepositoryError> {
        let snapshots = sqlx::query_scalar::<_, String>(
            "SELECT revision_history.snapshot_json
             FROM reports
             JOIN report_current_state ON report_current_state.report_id = reports.id
             JOIN review_decisions ON review_decisions.report_id = reports.id
               AND review_decisions.decision_number = (
                   SELECT MAX(latest_decision.decision_number)
                   FROM review_decisions AS latest_decision
                   WHERE latest_decision.report_id = reports.id
               )
             JOIN revision_history ON revision_history.report_id = reports.id
               AND revision_history.review_decision_id = review_decisions.id
               AND revision_history.revision_number = (
                   SELECT MAX(latest_revision.revision_number)
                   FROM revision_history AS latest_revision
                   WHERE latest_revision.report_id = reports.id
                     AND latest_revision.review_decision_id = review_decisions.id
               )
             WHERE report_current_state.current_status = 'APPROVED'
               AND review_decisions.decision = 'APPROVED'
             ORDER BY review_decisions.decided_at, reports.id",
        )
        .fetch_all(&self.pool)
        .await?;

        snapshots
            .into_iter()
            .map(|snapshot| {
                serde_json::from_str(&snapshot)
                    .map_err(|_| RepositoryError::InvalidApprovedSnapshotJson)
            })
            .collect()
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

    pub async fn signal_command_queue_snapshot(
        &self,
    ) -> Result<SignalCommandQueueSnapshot, RepositoryError> {
        let counts = sqlx::query_as::<_, (i64, i64, i64, i64, i64, i64)>(
            "SELECT COUNT(*),
                    COALESCE(SUM(CASE WHEN report_current_state.current_status = 'NEW' THEN 1 ELSE 0 END), 0),
                    COALESCE(SUM(CASE WHEN report_current_state.current_status = 'PARSED' THEN 1 ELSE 0 END), 0),
                    COALESCE(SUM(CASE WHEN report_current_state.current_status = 'NEEDS_REVIEW' THEN 1 ELSE 0 END), 0),
                    COALESCE(SUM(CASE WHEN report_current_state.current_status = 'APPROVED' THEN 1 ELSE 0 END), 0),
                    COALESCE(SUM(CASE WHEN report_current_state.current_status = 'REJECTED' THEN 1 ELSE 0 END), 0)
             FROM reports
             JOIN raw_sources ON raw_sources.id = reports.raw_source_id
             JOIN report_current_state ON report_current_state.report_id = reports.id
             WHERE raw_sources.source_type = 'SIGNAL'",
        )
        .fetch_one(&self.pool)
        .await?;
        let last = sqlx::query_as::<_, (String, String)>(
            "SELECT raw_sources.captured_at, report_current_state.current_status
             FROM reports
             JOIN raw_sources ON raw_sources.id = reports.raw_source_id
             JOIN report_current_state ON report_current_state.report_id = reports.id
             WHERE raw_sources.source_type = 'SIGNAL'
             ORDER BY raw_sources.captured_at DESC, reports.id DESC
             LIMIT 1",
        )
        .fetch_optional(&self.pool)
        .await?
        .map(|(captured_at, current_status)| SignalCommandLastItem {
            captured_at,
            current_status,
        });

        Ok(SignalCommandQueueSnapshot {
            total: counts.0 as u64,
            new_count: counts.1 as u64,
            parsed_count: counts.2 as u64,
            needs_review_count: counts.3 as u64,
            approved_count: counts.4 as u64,
            rejected_count: counts.5 as u64,
            last,
        })
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

    pub async fn store_signal_parse(
        &self,
        report_id: &str,
        parsed_payload_json: &Value,
        parsed_at: &str,
    ) -> Result<SignalParsePersistence, RepositoryError> {
        let payload = validate_signal_parse_payload(parsed_payload_json)?;
        if report_id.trim().is_empty() || parsed_at.trim().is_empty() {
            return Err(RepositoryError::InvalidSignalParsePayload(
                "немає ідентифікатора запису або часу розбору".to_owned(),
            ));
        }

        let mut transaction = self.pool.begin().await?;
        let source_type: Option<String> = sqlx::query_scalar(
            "SELECT raw_sources.source_type
             FROM reports
             JOIN raw_sources ON raw_sources.id = reports.raw_source_id
             WHERE reports.id = ?",
        )
        .bind(report_id)
        .fetch_optional(&mut *transaction)
        .await?;
        if source_type.as_deref() != Some("SIGNAL") {
            return Err(RepositoryError::SignalReportNotFound);
        }

        let current_status: String = sqlx::query_scalar(
            "SELECT current_status FROM report_current_state WHERE report_id = ?",
        )
        .bind(report_id)
        .fetch_one(&mut *transaction)
        .await?;
        let latest: Option<(String, i64, String, String, String)> = sqlx::query_as(
            "SELECT id, version, parser_name, parser_version, parsed_payload_json
             FROM parsed_report_versions
             WHERE report_id = ?
             ORDER BY version DESC
             LIMIT 1",
        )
        .bind(report_id)
        .fetch_optional(&mut *transaction)
        .await?;

        if let Some((id, version, parser_name, parser_version, stored_payload)) = &latest {
            if parser_name == SIGNAL_LEGACY_PARSER_NAME
                && parser_version == SIGNAL_LEGACY_PARSER_VERSION
                && stored_payload == &payload
            {
                return Ok(SignalParsePersistence {
                    report_id: report_id.to_owned(),
                    parsed_version_id: id.clone(),
                    version: *version,
                    current_status,
                    inserted: false,
                });
            }
        }

        if !matches!(current_status.as_str(), "NEW" | "PARSED") {
            return Err(RepositoryError::InvalidSignalReportState(current_status));
        }

        let version = latest.map_or(1, |(_, version, _, _, _)| version + 1);
        let version_text = version.to_string();
        let parsed_version_id = signal_identity(
            "signal-parse",
            &[
                report_id,
                &version_text,
                SIGNAL_LEGACY_PARSER_VERSION,
                &payload,
            ],
        );
        let audit_id = signal_identity("signal-audit-parse", &[&parsed_version_id]);
        sqlx::query(
            "INSERT INTO parsed_report_versions
             (id, report_id, version, parser_name, parser_version, parsed_payload_json, parsed_at)
             VALUES (?, ?, ?, ?, ?, ?, ?)",
        )
        .bind(&parsed_version_id)
        .bind(report_id)
        .bind(version)
        .bind(SIGNAL_LEGACY_PARSER_NAME)
        .bind(SIGNAL_LEGACY_PARSER_VERSION)
        .bind(&payload)
        .bind(parsed_at)
        .execute(&mut *transaction)
        .await?;
        insert_audit(
            &mut transaction,
            &AuditContext {
                id: audit_id,
                actor_type: ActorType::System,
                actor_label: Some(SIGNAL_LEGACY_PARSER_NAME.to_owned()),
                occurred_at: parsed_at.to_owned(),
            },
            Some(report_id),
            "parsed_report_version",
            &parsed_version_id,
            "PARSED",
            json!({ "version": version, "parserVersion": SIGNAL_LEGACY_PARSER_VERSION }),
        )
        .await?;
        transaction.commit().await?;

        Ok(SignalParsePersistence {
            report_id: report_id.to_owned(),
            parsed_version_id,
            version,
            current_status: "PARSED".to_owned(),
            inserted: true,
        })
    }

    pub async fn request_signal_review(
        &self,
        report_id: &str,
        decided_at: &str,
    ) -> Result<SignalReviewPersistence, RepositoryError> {
        if report_id.trim().is_empty() || decided_at.trim().is_empty() {
            return Err(RepositoryError::InvalidSignalReportState(
                "немає ідентифікатора запису або часу рішення".to_owned(),
            ));
        }

        let mut transaction = self.pool.begin().await?;
        let source_type: Option<String> = sqlx::query_scalar(
            "SELECT raw_sources.source_type
             FROM reports
             JOIN raw_sources ON raw_sources.id = reports.raw_source_id
             WHERE reports.id = ?",
        )
        .bind(report_id)
        .fetch_optional(&mut *transaction)
        .await?;
        if source_type.as_deref() != Some("SIGNAL") {
            return Err(RepositoryError::SignalReportNotFound);
        }

        let current_status: String = sqlx::query_scalar(
            "SELECT current_status FROM report_current_state WHERE report_id = ?",
        )
        .bind(report_id)
        .fetch_one(&mut *transaction)
        .await?;
        if current_status == "NEEDS_REVIEW" {
            let existing: Option<(String, String, String)> = sqlx::query_as(
                "SELECT review_decisions.id, review_decisions.parsed_version_id,
                        revision_history.id
                 FROM review_decisions
                 JOIN revision_history
                   ON revision_history.review_decision_id = review_decisions.id
                  AND revision_history.report_id = review_decisions.report_id
                 WHERE review_decisions.report_id = ?
                   AND review_decisions.decision = 'NEEDS_REVIEW'
                   AND review_decisions.parsed_version_id IS NOT NULL
                 ORDER BY review_decisions.decision_number DESC
                 LIMIT 1",
            )
            .bind(report_id)
            .fetch_optional(&mut *transaction)
            .await?;
            if let Some((decision_id, parsed_version_id, revision_id)) = existing {
                return Ok(SignalReviewPersistence {
                    report_id: report_id.to_owned(),
                    parsed_version_id,
                    decision_id,
                    revision_id,
                    current_status,
                    inserted: false,
                    correction_count: 0,
                });
            }
            return Err(RepositoryError::InvalidSignalReportState(current_status));
        }
        if current_status != "PARSED" {
            return Err(RepositoryError::InvalidSignalReportState(current_status));
        }

        let (parsed_version_id, snapshot_json): (String, String) = sqlx::query_as(
            "SELECT id, parsed_payload_json
             FROM parsed_report_versions
             WHERE report_id = ?
             ORDER BY version DESC
             LIMIT 1",
        )
        .bind(report_id)
        .fetch_one(&mut *transaction)
        .await?;
        let decision_number: i64 = sqlx::query_scalar(
            "SELECT COALESCE(MAX(decision_number), 0) + 1
             FROM review_decisions WHERE report_id = ?",
        )
        .bind(report_id)
        .fetch_one(&mut *transaction)
        .await?;
        let revision_number: i64 = sqlx::query_scalar(
            "SELECT COALESCE(MAX(revision_number), 0) + 1
             FROM revision_history WHERE report_id = ?",
        )
        .bind(report_id)
        .fetch_one(&mut *transaction)
        .await?;
        let decision_number_text = decision_number.to_string();
        let revision_number_text = revision_number.to_string();
        let decision_id = signal_identity(
            "signal-review",
            &[report_id, &parsed_version_id, &decision_number_text],
        );
        let revision_id = signal_identity(
            "signal-revision",
            &[report_id, &decision_id, &revision_number_text],
        );
        let audit_id = signal_identity("signal-audit-review", &[&decision_id]);

        sqlx::query(
            "INSERT INTO review_decisions
             (id, report_id, decision_number, parsed_version_id, decision,
              decided_by, rationale, decided_at)
             VALUES (?, ?, ?, ?, 'NEEDS_REVIEW', ?, ?, ?)",
        )
        .bind(&decision_id)
        .bind(report_id)
        .bind(decision_number)
        .bind(&parsed_version_id)
        .bind(SIGNAL_REVIEW_ACTOR)
        .bind("Передано з локальної черги Signal на ручну перевірку")
        .bind(decided_at)
        .execute(&mut *transaction)
        .await?;
        sqlx::query(
            "INSERT INTO revision_history
             (id, report_id, revision_number, parsed_version_id, review_decision_id,
              snapshot_json, change_summary, created_by, created_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
        )
        .bind(&revision_id)
        .bind(report_id)
        .bind(revision_number)
        .bind(&parsed_version_id)
        .bind(&decision_id)
        .bind(&snapshot_json)
        .bind("Початковий знімок для ручної перевірки")
        .bind(SIGNAL_REVIEW_ACTOR)
        .bind(decided_at)
        .execute(&mut *transaction)
        .await?;
        insert_audit(
            &mut transaction,
            &AuditContext {
                id: audit_id,
                actor_type: ActorType::User,
                actor_label: Some(SIGNAL_REVIEW_ACTOR.to_owned()),
                occurred_at: decided_at.to_owned(),
            },
            Some(report_id),
            "review_decision",
            &decision_id,
            "NEEDS_REVIEW",
            json!({
                "decisionNumber": decision_number,
                "revisionId": revision_id,
                "revisionNumber": revision_number,
            }),
        )
        .await?;
        transaction.commit().await?;

        Ok(SignalReviewPersistence {
            report_id: report_id.to_owned(),
            parsed_version_id,
            decision_id,
            revision_id,
            current_status: "NEEDS_REVIEW".to_owned(),
            inserted: true,
            correction_count: 0,
        })
    }

    pub async fn signal_review_snapshot(
        &self,
        report_id: &str,
    ) -> Result<SignalReviewSnapshot, RepositoryError> {
        let row: Option<(String, String, String)> = sqlx::query_as(
            "SELECT revision_history.parsed_version_id,
                    report_current_state.current_status,
                    revision_history.snapshot_json
             FROM reports
             JOIN raw_sources ON raw_sources.id = reports.raw_source_id
             JOIN report_current_state ON report_current_state.report_id = reports.id
             JOIN revision_history ON revision_history.report_id = reports.id
             WHERE reports.id = ? AND raw_sources.source_type = 'SIGNAL'
             ORDER BY revision_history.revision_number DESC
             LIMIT 1",
        )
        .bind(report_id)
        .fetch_optional(&self.pool)
        .await?;
        let Some((parsed_version_id, current_status, snapshot_json)) = row else {
            return Err(RepositoryError::SignalReportNotFound);
        };
        let snapshot_json = serde_json::from_str(&snapshot_json).map_err(|_| {
            RepositoryError::InvalidSignalCorrections(
                "збережений знімок перевірки пошкоджено".to_owned(),
            )
        })?;
        Ok(SignalReviewSnapshot {
            report_id: report_id.to_owned(),
            parsed_version_id,
            current_status,
            snapshot_json,
        })
    }

    pub async fn finalize_signal_review(
        &self,
        report_id: &str,
        decision: ReviewDecision,
        reviewer: &str,
        corrected_snapshot: &Value,
        decided_at: &str,
    ) -> Result<SignalReviewPersistence, RepositoryError> {
        validate_signal_parse_payload(corrected_snapshot)?;
        if !matches!(
            decision,
            ReviewDecision::Approved | ReviewDecision::Rejected
        ) {
            return Err(RepositoryError::InvalidSignalReportState(
                decision.as_str().to_owned(),
            ));
        }
        if report_id.trim().is_empty() || decided_at.trim().is_empty() {
            return Err(RepositoryError::InvalidSignalReportState(
                "немає ідентифікатора запису або часу рішення".to_owned(),
            ));
        }
        if reviewer.is_empty()
            || reviewer.trim() != reviewer
            || reviewer.chars().count() > 128
            || reviewer.chars().any(char::is_control)
        {
            return Err(RepositoryError::InvalidSignalReviewer);
        }

        let mut transaction = self.pool.begin().await?;
        let source_type: Option<String> = sqlx::query_scalar(
            "SELECT raw_sources.source_type
             FROM reports
             JOIN raw_sources ON raw_sources.id = reports.raw_source_id
             WHERE reports.id = ?",
        )
        .bind(report_id)
        .fetch_optional(&mut *transaction)
        .await?;
        if source_type.as_deref() != Some("SIGNAL") {
            return Err(RepositoryError::SignalReportNotFound);
        }

        let current_status: String = sqlx::query_scalar(
            "SELECT current_status FROM report_current_state WHERE report_id = ?",
        )
        .bind(report_id)
        .fetch_one(&mut *transaction)
        .await?;
        if matches!(current_status.as_str(), "APPROVED" | "REJECTED") {
            let existing: Option<(String, String, String, String, String, String, i64)> =
                sqlx::query_as(
                    "SELECT review_decisions.id, review_decisions.parsed_version_id,
                        review_decisions.decision, review_decisions.decided_by,
                        revision_history.id, revision_history.snapshot_json,
                        (SELECT count(*) FROM manual_corrections
                         WHERE manual_corrections.report_id = review_decisions.report_id)
                 FROM review_decisions
                 JOIN revision_history
                   ON revision_history.review_decision_id = review_decisions.id
                  AND revision_history.report_id = review_decisions.report_id
                 WHERE review_decisions.report_id = ?
                   AND review_decisions.parsed_version_id IS NOT NULL
                 ORDER BY review_decisions.decision_number DESC,
                          revision_history.revision_number DESC
                 LIMIT 1",
                )
                .bind(report_id)
                .fetch_optional(&mut *transaction)
                .await?;
            if let Some((
                decision_id,
                parsed_version_id,
                stored_decision,
                decided_by,
                revision_id,
                stored_snapshot,
                correction_count,
            )) = existing
            {
                let same_snapshot = build_signal_corrections(&stored_snapshot, corrected_snapshot)
                    .map(|(normalized, corrections)| {
                        normalized == stored_snapshot && corrections.is_empty()
                    })
                    .unwrap_or(false);
                if stored_decision == decision.as_str() && decided_by == reviewer && same_snapshot {
                    return Ok(SignalReviewPersistence {
                        report_id: report_id.to_owned(),
                        parsed_version_id,
                        decision_id,
                        revision_id,
                        current_status,
                        inserted: false,
                        correction_count: correction_count as usize,
                    });
                }
            }
            return Err(RepositoryError::InvalidSignalReportState(current_status));
        }
        if current_status != "NEEDS_REVIEW" {
            return Err(RepositoryError::InvalidSignalReportState(current_status));
        }

        let (parsed_version_id, snapshot_json): (String, String) = sqlx::query_as(
            "SELECT review_decisions.parsed_version_id, revision_history.snapshot_json
             FROM review_decisions
             JOIN revision_history
               ON revision_history.review_decision_id = review_decisions.id
              AND revision_history.report_id = review_decisions.report_id
             WHERE review_decisions.report_id = ?
               AND review_decisions.decision = 'NEEDS_REVIEW'
               AND review_decisions.parsed_version_id IS NOT NULL
             ORDER BY review_decisions.decision_number DESC,
                      revision_history.revision_number DESC
             LIMIT 1",
        )
        .bind(report_id)
        .fetch_one(&mut *transaction)
        .await?;
        let (corrected_snapshot_json, corrections) =
            build_signal_corrections(&snapshot_json, corrected_snapshot)?;
        let next_correction_number: i64 = sqlx::query_scalar(
            "SELECT COALESCE(MAX(correction_number), 0) + 1
             FROM manual_corrections WHERE report_id = ?",
        )
        .bind(report_id)
        .fetch_one(&mut *transaction)
        .await?;
        let decision_number: i64 = sqlx::query_scalar(
            "SELECT COALESCE(MAX(decision_number), 0) + 1
             FROM review_decisions WHERE report_id = ?",
        )
        .bind(report_id)
        .fetch_one(&mut *transaction)
        .await?;
        let revision_number: i64 = sqlx::query_scalar(
            "SELECT COALESCE(MAX(revision_number), 0) + 1
             FROM revision_history WHERE report_id = ?",
        )
        .bind(report_id)
        .fetch_one(&mut *transaction)
        .await?;
        let decision_number_text = decision_number.to_string();
        let revision_number_text = revision_number.to_string();
        let decision_id = signal_identity(
            "signal-review",
            &[
                report_id,
                &parsed_version_id,
                &decision_number_text,
                decision.as_str(),
                reviewer,
            ],
        );
        let revision_id = signal_identity(
            "signal-revision",
            &[report_id, &decision_id, &revision_number_text],
        );
        let audit_id = signal_identity("signal-audit-review", &[&decision_id]);
        let rationale = match decision {
            ReviewDecision::Approved => "Явно схвалено локальним рецензентом",
            ReviewDecision::Rejected => "Явно відхилено локальним рецензентом",
            ReviewDecision::NeedsReview => unreachable!("final decision checked above"),
        };

        for (offset, correction) in corrections.iter().enumerate() {
            let correction_number = next_correction_number + offset as i64;
            let correction_number_text = correction_number.to_string();
            let corrected_value = correction.corrected.to_string();
            let correction_id = signal_identity(
                "signal-correction",
                &[
                    report_id,
                    &parsed_version_id,
                    &correction_number_text,
                    &correction.field_path,
                    &corrected_value,
                ],
            );
            let correction_audit_id = signal_identity("signal-audit-correction", &[&correction_id]);
            sqlx::query(
                "INSERT INTO manual_corrections
                 (id, report_id, correction_number, parsed_version_id, field_path,
                  prior_value_json, corrected_value_json, reason, created_by, created_at,
                  supersedes_correction_id)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)",
            )
            .bind(&correction_id)
            .bind(report_id)
            .bind(correction_number)
            .bind(&parsed_version_id)
            .bind(&correction.field_path)
            .bind(correction.prior.to_string())
            .bind(&corrected_value)
            .bind("Виправлено під час ручної перевірки Signal")
            .bind(reviewer)
            .bind(decided_at)
            .execute(&mut *transaction)
            .await?;
            insert_audit(
                &mut transaction,
                &AuditContext {
                    id: correction_audit_id,
                    actor_type: ActorType::User,
                    actor_label: Some(reviewer.to_owned()),
                    occurred_at: decided_at.to_owned(),
                },
                Some(report_id),
                "manual_correction",
                &correction_id,
                "CORRECTED",
                json!({
                    "correctionNumber": correction_number,
                    "fieldPath": correction.field_path,
                }),
            )
            .await?;
        }

        sqlx::query(
            "INSERT INTO review_decisions
             (id, report_id, decision_number, parsed_version_id, decision,
              decided_by, rationale, decided_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
        )
        .bind(&decision_id)
        .bind(report_id)
        .bind(decision_number)
        .bind(&parsed_version_id)
        .bind(decision.as_str())
        .bind(reviewer)
        .bind(rationale)
        .bind(decided_at)
        .execute(&mut *transaction)
        .await?;
        sqlx::query(
            "INSERT INTO revision_history
             (id, report_id, revision_number, parsed_version_id, review_decision_id,
              snapshot_json, change_summary, created_by, created_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
        )
        .bind(&revision_id)
        .bind(report_id)
        .bind(revision_number)
        .bind(&parsed_version_id)
        .bind(&decision_id)
        .bind(&corrected_snapshot_json)
        .bind(if corrections.is_empty() {
            rationale.to_owned()
        } else {
            format!("{rationale}; ручних виправлень: {}", corrections.len())
        })
        .bind(reviewer)
        .bind(decided_at)
        .execute(&mut *transaction)
        .await?;
        insert_audit(
            &mut transaction,
            &AuditContext {
                id: audit_id,
                actor_type: ActorType::User,
                actor_label: Some(reviewer.to_owned()),
                occurred_at: decided_at.to_owned(),
            },
            Some(report_id),
            "review_decision",
            &decision_id,
            decision.as_str(),
            json!({
                "decisionNumber": decision_number,
                "revisionId": revision_id,
                "revisionNumber": revision_number,
            }),
        )
        .await?;
        transaction.commit().await?;

        Ok(SignalReviewPersistence {
            report_id: report_id.to_owned(),
            parsed_version_id,
            decision_id,
            revision_id,
            current_status: decision.as_str().to_owned(),
            inserted: true,
            correction_count: corrections.len(),
        })
    }
}

#[derive(Clone, Debug)]
struct SignalCorrection {
    field_path: String,
    prior: Value,
    corrected: Value,
}

fn build_signal_corrections(
    base_snapshot_json: &str,
    requested_snapshot: &Value,
) -> Result<(String, Vec<SignalCorrection>), RepositoryError> {
    validate_signal_parse_payload(requested_snapshot)?;
    let base_snapshot: Value = serde_json::from_str(base_snapshot_json).map_err(|_| {
        RepositoryError::InvalidSignalCorrections(
            "збережений початковий знімок пошкоджено".to_owned(),
        )
    })?;
    for key in ["schema_version", "header_only", "chat_date"] {
        if base_snapshot.get(key) != requested_snapshot.get(key) {
            return Err(RepositoryError::InvalidSignalCorrections(format!(
                "службове поле {key} не можна змінювати"
            )));
        }
    }
    let base_records = base_snapshot
        .get("records")
        .and_then(Value::as_array)
        .ok_or_else(|| {
            RepositoryError::InvalidSignalCorrections(
                "початковий знімок не містить records".to_owned(),
            )
        })?;
    let requested_records = requested_snapshot
        .get("records")
        .and_then(Value::as_array)
        .ok_or_else(|| {
            RepositoryError::InvalidSignalCorrections(
                "виправлений знімок не містить records".to_owned(),
            )
        })?;
    if base_records.len() != requested_records.len() {
        return Err(RepositoryError::InvalidSignalCorrections(
            "кількість записів не можна змінювати під час перевірки".to_owned(),
        ));
    }

    let mut final_snapshot = base_snapshot.clone();
    let final_records = final_snapshot
        .get_mut("records")
        .and_then(Value::as_array_mut)
        .expect("validated base records must remain an array");
    let mut corrections = Vec::new();
    for (record_index, ((base_record, requested_record), final_record)) in base_records
        .iter()
        .zip(requested_records)
        .zip(final_records)
        .enumerate()
    {
        let base_record = base_record.as_object().ok_or_else(|| {
            RepositoryError::InvalidSignalCorrections(
                "початковий запис не є JSON-об'єктом".to_owned(),
            )
        })?;
        let requested_record = requested_record.as_object().ok_or_else(|| {
            RepositoryError::InvalidSignalCorrections(
                "виправлений запис не є JSON-об'єктом".to_owned(),
            )
        })?;
        let final_record = final_record
            .as_object_mut()
            .expect("validated final record must remain an object");
        for field in SIGNAL_CORRECTION_FIELDS {
            if !base_record.contains_key(*field) && !requested_record.contains_key(*field) {
                continue;
            }
            let prior = base_record.get(*field).cloned().unwrap_or(Value::Null);
            let corrected = requested_record
                .get(*field)
                .cloned()
                .unwrap_or_else(|| prior.clone());
            let valid_type = if matches!(*field, "types" | "cause") {
                corrected
                    .as_array()
                    .map(|values| values.iter().all(Value::is_string))
                    .unwrap_or(false)
            } else {
                corrected.is_string()
            };
            if !valid_type {
                return Err(RepositoryError::InvalidSignalCorrections(format!(
                    "поле records[{record_index}].{field} має некоректний тип"
                )));
            }
            if corrected != prior {
                final_record.insert((*field).to_owned(), corrected.clone());
                corrections.push(SignalCorrection {
                    field_path: format!("$.records[{record_index}].{field}"),
                    prior,
                    corrected,
                });
            }
        }
    }
    if corrections.len() > SIGNAL_CORRECTION_MAX_FIELDS {
        return Err(RepositoryError::InvalidSignalCorrections(format!(
            "за одне рішення дозволено не більше {SIGNAL_CORRECTION_MAX_FIELDS} змінених полів"
        )));
    }
    Ok((final_snapshot.to_string(), corrections))
}

fn validate_signal_parse_payload(payload: &Value) -> Result<String, RepositoryError> {
    let object = payload.as_object().ok_or_else(|| {
        RepositoryError::InvalidSignalParsePayload("очікується JSON-об'єкт".to_owned())
    })?;
    let allowed_keys = ["schema_version", "header_only", "chat_date", "records"];
    if object.len() != allowed_keys.len()
        || object
            .keys()
            .any(|key| !allowed_keys.contains(&key.as_str()))
    {
        return Err(RepositoryError::InvalidSignalParsePayload(
            "структура верхнього рівня не відповідає схемі".to_owned(),
        ));
    }
    if object.get("schema_version").and_then(Value::as_u64) != Some(1) {
        return Err(RepositoryError::InvalidSignalParsePayload(
            "непідтримувана версія схеми".to_owned(),
        ));
    }
    if object.get("header_only").and_then(Value::as_bool).is_none() {
        return Err(RepositoryError::InvalidSignalParsePayload(
            "header_only має бути логічним значенням".to_owned(),
        ));
    }
    match object.get("chat_date") {
        Some(Value::Null | Value::String(_)) => {}
        _ => {
            return Err(RepositoryError::InvalidSignalParsePayload(
                "chat_date має бути рядком або null".to_owned(),
            ));
        }
    }
    let records = object
        .get("records")
        .and_then(Value::as_array)
        .ok_or_else(|| {
            RepositoryError::InvalidSignalParsePayload("records має бути масивом".to_owned())
        })?;
    if records.is_empty() || records.len() > SIGNAL_PARSE_MAX_RECORDS {
        return Err(RepositoryError::InvalidSignalParsePayload(format!(
            "кількість записів має бути від 1 до {SIGNAL_PARSE_MAX_RECORDS}"
        )));
    }
    if records.iter().any(|record| !record.is_object()) {
        return Err(RepositoryError::InvalidSignalParsePayload(
            "кожен запис має бути JSON-об'єктом".to_owned(),
        ));
    }

    let forbidden_keys = ["srcText", "_own", "_openCause", "dup", "include"];
    let mut pending = vec![payload];
    while let Some(value) = pending.pop() {
        match value {
            Value::Object(map) => {
                if map.keys().any(|key| forbidden_keys.contains(&key.as_str())) {
                    return Err(RepositoryError::InvalidSignalParsePayload(
                        "payload містить сирий текст або службові поля інтерфейсу".to_owned(),
                    ));
                }
                pending.extend(map.values());
            }
            Value::Array(values) => pending.extend(values),
            _ => {}
        }
    }

    let serialized = payload.to_string();
    if serialized.len() > SIGNAL_PARSE_MAX_BYTES {
        return Err(RepositoryError::InvalidSignalParsePayload(
            "payload перевищує 1 МіБ".to_owned(),
        ));
    }
    Ok(serialized)
}

fn signal_identity(prefix: &str, parts: &[&str]) -> String {
    let mut digest = Sha256::new();
    for part in parts {
        digest.update((part.len() as u64).to_be_bytes());
        digest.update(part.as_bytes());
    }
    format!("{prefix}:{:x}", digest.finalize())
}

/// The first earlier XLSX row with exactly the same parsed payload. Its
/// `version = 1` and `parser_name` terms must stay literal: they match the
/// partial index of migration 0012, without which every imported row scans all
/// parsed versions.
pub(crate) const XLSX_DUPLICATE_LOOKUP_SQL: &str = "SELECT reports.id
     FROM reports
     JOIN raw_sources ON raw_sources.id = reports.raw_source_id
     JOIN parsed_report_versions ON parsed_report_versions.report_id = reports.id
     WHERE raw_sources.source_type = 'XLSX'
       AND parsed_report_versions.version = 1
       AND parsed_report_versions.parser_name = 'easywar-xlsx'
       AND parsed_report_versions.parsed_payload_json = ?
     ORDER BY reports.created_at, reports.id
     LIMIT 1";

async fn find_prior_xlsx_duplicate(
    transaction: &mut Transaction<'_, Sqlite>,
    report_id: &str,
    parsed_payload_json: &str,
) -> Result<Option<String>, sqlx::Error> {
    let canonical: Option<String> = sqlx::query_scalar(XLSX_DUPLICATE_LOOKUP_SQL)
        .bind(parsed_payload_json)
        .fetch_optional(&mut **transaction)
        .await?;
    Ok(canonical.filter(|canonical_report_id| canonical_report_id != report_id))
}

async fn insert_xlsx_fingerprint(
    transaction: &mut Transaction<'_, Sqlite>,
    report_id: &str,
    fingerprint_sha256: &str,
    duplicate_of_report_id: Option<&str>,
    recorded_at: &str,
    duplicate_audit_id: &str,
) -> Result<(), sqlx::Error> {
    sqlx::query(
        "INSERT INTO xlsx_row_fingerprints
         (report_id, fingerprint_sha256, duplicate_of_report_id, recorded_at)
         VALUES (?, ?, ?, ?)",
    )
    .bind(report_id)
    .bind(fingerprint_sha256)
    .bind(duplicate_of_report_id)
    .bind(recorded_at)
    .execute(&mut **transaction)
    .await?;

    if let Some(duplicate_of_report_id) = duplicate_of_report_id {
        insert_audit(
            transaction,
            &AuditContext {
                id: duplicate_audit_id.to_owned(),
                actor_type: ActorType::System,
                actor_label: None,
                occurred_at: recorded_at.to_owned(),
            },
            Some(report_id),
            "xlsx_row_fingerprint",
            report_id,
            "DUPLICATE_DETECTED",
            json!({
                "duplicateOfReportId": duplicate_of_report_id,
                "fingerprintSha256": fingerprint_sha256,
                "matchKind": "exactParsedPayload"
            }),
        )
        .await?;
    }

    Ok(())
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
    use crate::database::{INITIAL_SCHEMA_SQL, XLSX_DUPLICATE_LINKS_SQL};
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
        sqlx::raw_sql(XLSX_DUPLICATE_LINKS_SQL)
            .execute(&pool)
            .await
            .expect("XLSX duplicate migration must apply");

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
    async fn command_snapshot_returns_only_aggregate_and_last_metadata() {
        let repository = repository().await;
        let empty = repository
            .signal_command_queue_snapshot()
            .await
            .expect("empty synthetic command snapshot must query");
        assert_eq!(empty.total, 0);
        assert_eq!(empty.last, None);

        let mut older = capture(
            "signal-source-command-1",
            "signal-report-command-1",
            "signal-audit-command-1",
        );
        older.source_type = SourceType::Signal;
        older.captured_at = "2026-01-01T00:00:00Z".to_owned();
        older.created_at = older.captured_at.clone();
        older.raw_text = Some("SECRET-SYNTHETIC-COMMAND-SOURCE".to_owned());
        older.raw_sha256 = "d".repeat(64);
        repository.capture_report(&older).await.unwrap();
        repository
            .store_parse(&parse(
                "signal-parse-command-1",
                "signal-report-command-1",
                "signal-audit-command-2",
            ))
            .await
            .unwrap();

        let mut newer = capture(
            "signal-source-command-2",
            "signal-report-command-2",
            "signal-audit-command-3",
        );
        newer.source_type = SourceType::Signal;
        newer.captured_at = "2026-01-02T00:00:00Z".to_owned();
        newer.created_at = newer.captured_at.clone();
        newer.raw_text = Some("SECRET-SYNTHETIC-LATEST-SOURCE".to_owned());
        newer.raw_sha256 = "e".repeat(64);
        repository.capture_report(&newer).await.unwrap();

        repository
            .capture_report(&capture(
                "paste-source-command",
                "paste-report-command",
                "paste-audit-command",
            ))
            .await
            .unwrap();

        let snapshot = repository
            .signal_command_queue_snapshot()
            .await
            .expect("synthetic command snapshot must query");
        assert_eq!(snapshot.total, 2);
        assert_eq!(snapshot.new_count, 1);
        assert_eq!(snapshot.parsed_count, 1);
        assert_eq!(snapshot.needs_review_count, 0);
        assert_eq!(
            snapshot.last,
            Some(SignalCommandLastItem {
                captured_at: "2026-01-02T00:00:00Z".to_owned(),
                current_status: "NEW".to_owned(),
            })
        );
        let debug = format!("{snapshot:?}");
        assert!(!debug.contains("SECRET-SYNTHETIC"));
        assert!(!debug.contains("signal-report"));
        assert!(!debug.contains(&"e".repeat(64)));
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

    fn signal_parse_payload(note: &str) -> Value {
        json!({
            "schema_version": 1,
            "header_only": false,
            "chat_date": "2026-01-01",
            "records": [{
                "date": "2026-01-01",
                "targetIds": "SYNTHETIC-ONLY",
                "note": note,
                "warn": {}
            }]
        })
    }

    #[test]
    fn signal_corrections_reject_schema_or_record_count_changes() {
        let base = signal_parse_payload("Початковий синтетичний запис");
        let base_json = base.to_string();
        let mut changed_date = base.clone();
        changed_date["chat_date"] = json!("2026-01-02");
        assert!(matches!(
            build_signal_corrections(&base_json, &changed_date),
            Err(RepositoryError::InvalidSignalCorrections(_))
        ));

        let mut extra_record = base.clone();
        extra_record["records"]
            .as_array_mut()
            .expect("synthetic records")
            .push(json!({ "date": "2026-01-02", "note": "зайвий запис" }));
        assert!(matches!(
            build_signal_corrections(&base_json, &extra_record),
            Err(RepositoryError::InvalidSignalCorrections(_))
        ));
    }

    #[tokio::test]
    async fn persists_signal_parse_and_review_transition_idempotently() {
        let repository = repository().await;
        let mut signal = capture(
            "signal-source-parse",
            "signal-report-parse",
            "signal-audit-capture",
        );
        signal.source_type = SourceType::Signal;
        signal.raw_text = Some("Синтетичний незмінний текст Signal".to_owned());
        signal.raw_sha256 = "d".repeat(64);
        repository
            .capture_report(&signal)
            .await
            .expect("synthetic Signal report capture must succeed");

        let payload = signal_parse_payload("Синтетичний результат");
        let first_parse = repository
            .store_signal_parse("signal-report-parse", &payload, NOW)
            .await
            .expect("synthetic Signal parse must persist");
        assert!(first_parse.inserted);
        assert_eq!(first_parse.version, 1);
        assert_eq!(first_parse.current_status, "PARSED");

        let retry_parse = repository
            .store_signal_parse("signal-report-parse", &payload, "2026-01-01T00:00:01Z")
            .await
            .expect("exact parse retry must be idempotent");
        assert!(!retry_parse.inserted);
        assert_eq!(retry_parse.parsed_version_id, first_parse.parsed_version_id);

        let first_review = repository
            .request_signal_review("signal-report-parse", "2026-01-01T00:00:02Z")
            .await
            .expect("parsed Signal report must enter review");
        assert!(first_review.inserted);
        assert_eq!(first_review.current_status, "NEEDS_REVIEW");
        assert_eq!(
            first_review.parsed_version_id,
            first_parse.parsed_version_id
        );

        let retry_review = repository
            .request_signal_review("signal-report-parse", "2026-01-01T00:00:03Z")
            .await
            .expect("review retry must be idempotent");
        assert!(!retry_review.inserted);
        assert_eq!(retry_review.decision_id, first_review.decision_id);
        assert_eq!(retry_review.revision_id, first_review.revision_id);
        let pending_snapshot = repository
            .signal_review_snapshot("signal-report-parse")
            .await
            .expect("pending review snapshot must query");
        assert_eq!(pending_snapshot.current_status, "NEEDS_REVIEW");
        assert_eq!(
            pending_snapshot.snapshot_json["records"][0]["note"],
            json!("Синтетичний результат")
        );

        let counts: (i64, i64, i64, i64) = sqlx::query_as(
            "SELECT (SELECT count(*) FROM parsed_report_versions),
                    (SELECT count(*) FROM review_decisions),
                    (SELECT count(*) FROM revision_history),
                    (SELECT count(*) FROM audit_log)",
        )
        .fetch_one(&repository.pool)
        .await
        .expect("synthetic Signal provenance counts must query");
        assert_eq!(counts, (1, 1, 1, 3));
        let raw_text: String =
            sqlx::query_scalar("SELECT raw_text FROM raw_sources WHERE id = 'signal-source-parse'")
                .fetch_one(&repository.pool)
                .await
                .expect("raw Signal source must remain available");
        assert_eq!(raw_text, "Синтетичний незмінний текст Signal");

        let corrected_payload = signal_parse_payload("Виправлений синтетичний результат");
        let approved = repository
            .finalize_signal_review(
                "signal-report-parse",
                ReviewDecision::Approved,
                "synthetic-reviewer",
                &corrected_payload,
                "2026-01-01T00:00:04Z",
            )
            .await
            .expect("corrected synthetic approval must persist");
        assert!(approved.inserted);
        assert_eq!(approved.current_status, "APPROVED");
        assert_eq!(approved.correction_count, 1);
        let retry_final = repository
            .finalize_signal_review(
                "signal-report-parse",
                ReviewDecision::Approved,
                "synthetic-reviewer",
                &corrected_payload,
                "2026-01-01T00:00:05Z",
            )
            .await
            .expect("identical final decision retry must be idempotent");
        assert!(!retry_final.inserted);
        assert!(matches!(
            repository
                .finalize_signal_review(
                    "signal-report-parse",
                    ReviewDecision::Rejected,
                    "synthetic-reviewer",
                    &corrected_payload,
                    "2026-01-01T00:00:06Z",
                )
                .await,
            Err(RepositoryError::InvalidSignalReportState(status)) if status == "APPROVED"
        ));
        let final_counts: (i64, i64, i64, i64) = sqlx::query_as(
            "SELECT (SELECT count(*) FROM review_decisions),
                    (SELECT count(*) FROM revision_history),
                    (SELECT count(*) FROM manual_corrections),
                    (SELECT count(*) FROM audit_log)",
        )
        .fetch_one(&repository.pool)
        .await
        .expect("final review provenance counts must query");
        assert_eq!(final_counts, (2, 2, 1, 5));
        let stored_correction: (String, String, String) = sqlx::query_as(
            "SELECT field_path, prior_value_json, corrected_value_json
             FROM manual_corrections WHERE report_id = ?",
        )
        .bind("signal-report-parse")
        .fetch_one(&repository.pool)
        .await
        .expect("stored Signal correction must query");
        assert_eq!(stored_correction.0, "$.records[0].note");
        assert_eq!(
            stored_correction.1,
            json!("Синтетичний результат").to_string()
        );
        assert_eq!(
            stored_correction.2,
            json!("Виправлений синтетичний результат").to_string()
        );
        let approved_snapshot = repository
            .signal_review_snapshot("signal-report-parse")
            .await
            .expect("approved corrected snapshot must query");
        assert_eq!(approved_snapshot.current_status, "APPROVED");
        assert_eq!(
            approved_snapshot.snapshot_json["records"][0]["note"],
            json!("Виправлений синтетичний результат")
        );
        let export_snapshots = repository
            .approved_revision_snapshots()
            .await
            .expect("approved snapshots must query for export");
        assert_eq!(export_snapshots, vec![corrected_payload.clone()]);

        assert!(matches!(
            repository
                .store_signal_parse(
                    "signal-report-parse",
                    &signal_parse_payload("Змінений результат після передачі"),
                    "2026-01-01T00:00:07Z",
                )
                .await,
            Err(RepositoryError::InvalidSignalReportState(status)) if status == "APPROVED"
        ));
    }

    #[tokio::test]
    async fn rejects_invalid_or_non_signal_parse_persistence() {
        let repository = repository().await;
        let mut new_signal = capture("signal-source-new", "signal-report-new", "signal-audit-new");
        new_signal.source_type = SourceType::Signal;
        new_signal.raw_sha256 = "e".repeat(64);
        repository
            .capture_report(&new_signal)
            .await
            .expect("synthetic new Signal report capture must succeed");
        repository
            .capture_report(&capture(
                "paste-source-parse",
                "paste-report-parse",
                "paste-audit-parse",
            ))
            .await
            .expect("synthetic paste capture must succeed");

        assert!(matches!(
            repository
                .store_signal_parse("paste-report-parse", &signal_parse_payload("x"), NOW)
                .await,
            Err(RepositoryError::SignalReportNotFound)
        ));
        assert!(matches!(
            repository
                .store_signal_parse("missing-report", &signal_parse_payload("x"), NOW)
                .await,
            Err(RepositoryError::SignalReportNotFound)
        ));

        let payload_with_raw_text = json!({
            "schema_version": 1,
            "header_only": false,
            "chat_date": null,
            "records": [{ "date": "2026-01-01", "srcText": "must not persist" }]
        });
        assert!(matches!(
            repository
                .store_signal_parse("missing-report", &payload_with_raw_text, NOW)
                .await,
            Err(RepositoryError::InvalidSignalParsePayload(_))
        ));
        assert!(matches!(
            repository
                .request_signal_review("paste-report-parse", NOW)
                .await,
            Err(RepositoryError::SignalReportNotFound)
        ));
        assert!(matches!(
            repository
                .request_signal_review("signal-report-new", NOW)
                .await,
            Err(RepositoryError::InvalidSignalReportState(status)) if status == "NEW"
        ));
        assert!(matches!(
            repository
                .finalize_signal_review(
                    "signal-report-new",
                    ReviewDecision::Approved,
                    "",
                    &signal_parse_payload("x"),
                    NOW,
                )
                .await,
            Err(RepositoryError::InvalidSignalReviewer)
        ));
    }

    #[tokio::test]
    async fn rejects_signal_review_with_an_explicit_reviewer() {
        let repository = repository().await;
        let mut signal = capture(
            "signal-source-rejected",
            "signal-report-rejected",
            "signal-audit-rejected",
        );
        signal.source_type = SourceType::Signal;
        signal.raw_sha256 = "f".repeat(64);
        repository
            .capture_report(&signal)
            .await
            .expect("synthetic rejected Signal report capture must succeed");
        repository
            .store_signal_parse(
                "signal-report-rejected",
                &signal_parse_payload("Синтетичний запис для відхилення"),
                NOW,
            )
            .await
            .expect("synthetic rejected Signal parse must persist");
        repository
            .request_signal_review("signal-report-rejected", NOW)
            .await
            .expect("synthetic rejected Signal report must enter review");

        let final_result = repository
            .finalize_signal_review(
                "signal-report-rejected",
                ReviewDecision::Rejected,
                "synthetic-reviewer-reject",
                &signal_parse_payload("Синтетичний запис для відхилення"),
                NOW,
            )
            .await
            .expect("explicit synthetic rejection must persist");
        assert!(final_result.inserted);
        assert_eq!(final_result.current_status, "REJECTED");
        assert_eq!(
            repository
                .current_status("signal-report-rejected")
                .await
                .expect("rejected status must query")
                .as_deref(),
            Some("REJECTED")
        );
        let audit_actor: String = sqlx::query_scalar(
            "SELECT actor_label FROM audit_log
             WHERE report_id = ? AND action = 'REJECTED'",
        )
        .bind("signal-report-rejected")
        .fetch_one(&repository.pool)
        .await
        .expect("rejection audit actor must query");
        assert_eq!(audit_actor, "synthetic-reviewer-reject");
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
        assert_eq!(first.duplicate_rows, 0);

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
        assert_eq!(retry.duplicate_rows, 0);
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
    async fn links_exact_cross_workbook_duplicates_without_dropping_provenance() {
        let repository = repository().await;
        let first_batch = synthetic_xlsx_batch();
        repository
            .stage_xlsx_batch(&first_batch, NOW)
            .await
            .expect("first synthetic workbook must stage");

        let mut second_batch = first_batch.clone();
        second_batch.workbook_sha256 =
            format!("{:x}", Sha256::digest(b"second-synthetic-only-workbook"));
        let second = repository
            .stage_xlsx_batch(&second_batch, "2026-01-02T00:00:00Z")
            .await
            .expect("second synthetic workbook must stage and link duplicates");
        assert_eq!(second.staged_rows, 2);
        assert_eq!(second.already_present_rows, 0);
        assert_eq!(second.duplicate_rows, 2);

        let counts: (i64, i64, i64, i64, i64) = sqlx::query_as(
            "SELECT (SELECT count(*) FROM raw_sources),
                    (SELECT count(*) FROM reports),
                    (SELECT count(*) FROM parsed_report_versions),
                    (SELECT count(*) FROM xlsx_row_fingerprints),
                    (SELECT count(*) FROM audit_log)",
        )
        .fetch_one(&repository.pool)
        .await
        .expect("duplicate provenance counts must query");
        assert_eq!(counts, (4, 4, 4, 4, 10));

        let links: Vec<(String, String)> = sqlx::query_as(
            "SELECT report_id, duplicate_of_report_id
             FROM xlsx_row_fingerprints
             WHERE duplicate_of_report_id IS NOT NULL
             ORDER BY report_id",
        )
        .fetch_all(&repository.pool)
        .await
        .expect("duplicate links must query");
        assert_eq!(links.len(), 2);
        assert!(links.iter().all(|(report_id, duplicate_of)| {
            report_id.starts_with(&format!("xlsx-report:{}:", second_batch.workbook_sha256))
                && duplicate_of
                    .starts_with(&format!("xlsx-report:{}:", first_batch.workbook_sha256))
        }));
        let statuses: Vec<String> = sqlx::query_scalar(
            "SELECT current_status FROM report_current_state ORDER BY report_id",
        )
        .fetch_all(&repository.pool)
        .await
        .expect("duplicate statuses must query");
        assert_eq!(statuses, vec!["PARSED", "PARSED", "PARSED", "PARSED"]);

        let retry = repository
            .stage_xlsx_batch(&second_batch, "2026-01-02T00:00:00Z")
            .await
            .expect("duplicate workbook retry must remain idempotent");
        assert_eq!(retry.staged_rows, 0);
        assert_eq!(retry.already_present_rows, 2);
        assert_eq!(retry.duplicate_rows, 2);
        let audit_count: i64 = sqlx::query_scalar("SELECT count(*) FROM audit_log")
            .fetch_one(&repository.pool)
            .await
            .expect("duplicate retry audit count must query");
        assert_eq!(audit_count, 10);
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
