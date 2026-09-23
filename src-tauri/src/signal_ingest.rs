use crate::{
    repository::{
        ActorType, AuditContext, CaptureReportInput, Repository, RepositoryError, SourceType,
    },
    signal_daemon::SignalReceiveNotification,
    signal_policy::ValidatedSignalAdapterConfig,
};
use serde::Serialize;
use serde_json::{json, Map, Value};
use sha2::{Digest, Sha256};

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
pub struct SignalCaptureResult {
    pub report_id: String,
    pub raw_sha256: String,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct AllowedSignalMessage {
    pub timestamp: u64,
    pub message: String,
    pub sender: String,
    pub group: Option<String>,
}

#[derive(Debug, thiserror::Error)]
pub enum SignalIngestError {
    #[error("подія Signal не відповідає дозволеному формату повідомлення")]
    InvalidEnvelope,
    #[error("джерело Signal не дозволене локальною політикою")]
    SourceDenied,
    #[error("подія Signal надійшла для іншого локального акаунта")]
    AccountMismatch,
    #[error("не вдалося серіалізувати подію Signal")]
    Serialization(#[from] serde_json::Error),
    #[error(transparent)]
    Repository(#[from] RepositoryError),
}

pub async fn persist_allowed_notification(
    repository: &Repository,
    config: &ValidatedSignalAdapterConfig,
    notification: &SignalReceiveNotification,
    expected_account: &str,
    captured_at: &str,
) -> Result<SignalCaptureResult, SignalIngestError> {
    if captured_at.trim().is_empty() || captured_at.chars().any(char::is_control) {
        return Err(SignalIngestError::InvalidEnvelope);
    }
    let inspected = inspect_allowed_notification(config, notification, expected_account)?;

    let raw_payload = serde_json::to_vec(&notification.envelope)?;
    let raw_sha256 = format!("{:x}", Sha256::digest(&raw_payload));
    let report_id = format!("signal-report:{raw_sha256}");
    let source_item_key = format!("envelope-sha256:{raw_sha256}");

    repository
        .capture_report(&CaptureReportInput {
            raw_source_id: format!("signal-source:{raw_sha256}"),
            report_id: report_id.clone(),
            source_type: SourceType::Signal,
            source_timestamp: Some(inspected.timestamp.to_string()),
            captured_at: captured_at.to_owned(),
            content_type: "application/vnd.signal-cli.envelope+json".to_owned(),
            raw_text: Some(inspected.message),
            raw_payload_json: Some(notification.envelope.clone()),
            raw_sha256: raw_sha256.clone(),
            metadata_json: json!({
                "schema_version": 1,
                "account": notification.account,
                "sender": inspected.sender,
                "group": inspected.group,
                "subscription": notification.subscription,
                "envelope_timestamp_ms": inspected.timestamp,
            }),
            source_item_key,
            created_at: captured_at.to_owned(),
            audit: AuditContext {
                id: format!("signal-audit:capture:{raw_sha256}"),
                actor_type: ActorType::System,
                actor_label: Some("signal-cli-local".to_owned()),
                occurred_at: captured_at.to_owned(),
            },
        })
        .await?;

    Ok(SignalCaptureResult {
        report_id,
        raw_sha256,
    })
}

pub fn inspect_allowed_notification(
    config: &ValidatedSignalAdapterConfig,
    notification: &SignalReceiveNotification,
    expected_account: &str,
) -> Result<AllowedSignalMessage, SignalIngestError> {
    if !valid_identifier(expected_account) || notification.account != expected_account {
        return Err(SignalIngestError::AccountMismatch);
    }

    let envelope = notification
        .envelope
        .as_object()
        .ok_or(SignalIngestError::InvalidEnvelope)?;
    let timestamp = envelope
        .get("timestamp")
        .and_then(Value::as_u64)
        .ok_or(SignalIngestError::InvalidEnvelope)?;
    let data_message = envelope
        .get("dataMessage")
        .and_then(Value::as_object)
        .ok_or(SignalIngestError::InvalidEnvelope)?;
    let message = data_message
        .get("message")
        .and_then(Value::as_str)
        .filter(|message| !message.trim().is_empty())
        .ok_or(SignalIngestError::InvalidEnvelope)?;
    let group = extract_group(data_message)?;
    let sender = sender_candidates(envelope)
        .into_iter()
        .find(|sender| config.permits_source(sender, group))
        .ok_or(SignalIngestError::SourceDenied)?;
    Ok(AllowedSignalMessage {
        timestamp,
        message: message.to_owned(),
        sender: sender.to_owned(),
        group: group.map(str::to_owned),
    })
}

fn extract_group(data_message: &Map<String, Value>) -> Result<Option<&str>, SignalIngestError> {
    let Some(group_info) = data_message.get("groupInfo") else {
        return Ok(None);
    };
    let group = group_info
        .as_object()
        .and_then(|group| group.get("groupId"))
        .and_then(Value::as_str)
        .filter(|group| valid_identifier(group))
        .ok_or(SignalIngestError::InvalidEnvelope)?;
    Ok(Some(group))
}

fn sender_candidates(envelope: &Map<String, Value>) -> Vec<&str> {
    ["sourceUuid", "sourceNumber", "source"]
        .into_iter()
        .filter_map(|field| envelope.get(field).and_then(Value::as_str))
        .filter(|sender| valid_identifier(sender))
        .collect()
}

fn valid_identifier(value: &str) -> bool {
    !value.is_empty() && value.trim() == value && !value.chars().any(char::is_control)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{
        database::INITIAL_SCHEMA_SQL,
        signal_policy::{SignalAdapterConfig, SignalAllowlist},
    };
    use sqlx::{sqlite::SqlitePoolOptions, SqlitePool};

    const NOW: &str = "2026-01-01T00:00:00Z";

    async fn repository() -> (Repository, SqlitePool) {
        let pool = SqlitePoolOptions::new()
            .max_connections(1)
            .connect("sqlite::memory:")
            .await
            .expect("synthetic in-memory SQLite must open");
        sqlx::raw_sql(INITIAL_SCHEMA_SQL)
            .execute(&pool)
            .await
            .expect("initial migration must apply");
        (Repository::new(pool.clone()), pool)
    }

    fn enabled_config() -> ValidatedSignalAdapterConfig {
        SignalAdapterConfig {
            intake_enabled: true,
            allowlist: SignalAllowlist::new(
                ["synthetic-sender".to_owned()],
                ["synthetic-group".to_owned()],
            )
            .expect("synthetic allowlist must validate"),
            ..SignalAdapterConfig::default()
        }
        .validate()
        .expect("synthetic enabled config must validate")
    }

    fn notification(sender: &str, group: Option<&str>) -> SignalReceiveNotification {
        let mut data_message = json!({
            "message": "Синтетична доповідь без реальних даних"
        });
        if let Some(group) = group {
            data_message["groupInfo"] = json!({ "groupId": group });
        }
        SignalReceiveNotification {
            subscription: 7,
            account: "synthetic-account".to_owned(),
            envelope: json!({
                "sourceUuid": sender,
                "timestamp": 1_767_225_600_000_u64,
                "dataMessage": data_message,
            }),
        }
    }

    #[tokio::test]
    async fn persists_allowed_message_in_immutable_provenance_layers() {
        let (repository, pool) = repository().await;
        let result = persist_allowed_notification(
            &repository,
            &enabled_config(),
            &notification("synthetic-sender", Some("synthetic-group")),
            "synthetic-account",
            NOW,
        )
        .await
        .expect("allowed synthetic notification must persist");

        let inbox = repository
            .list_signal_inbox(100)
            .await
            .expect("synthetic Inbox must query");
        assert_eq!(inbox.len(), 1);
        assert_eq!(inbox[0].report_id, result.report_id);
        assert_eq!(inbox[0].current_status, "NEW");
        assert_eq!(inbox[0].raw_sha256, result.raw_sha256);

        let stored: (String, String, String, String) = sqlx::query_as(
            "SELECT raw_sources.raw_text, raw_sources.raw_payload_json,
                    raw_sources.source_timestamp, audit_log.action
             FROM raw_sources
             JOIN reports ON reports.raw_source_id = raw_sources.id
             JOIN audit_log ON audit_log.report_id = reports.id
             WHERE reports.id = ?",
        )
        .bind(&result.report_id)
        .fetch_one(&pool)
        .await
        .expect("synthetic provenance must query");
        assert_eq!(stored.0, "Синтетична доповідь без реальних даних");
        assert!(stored.1.contains("synthetic-sender"));
        assert_eq!(stored.2, "1767225600000");
        assert_eq!(stored.3, "CAPTURED");
    }

    #[tokio::test]
    async fn denied_or_disabled_sources_never_write_rows() {
        let (repository, pool) = repository().await;
        let denied = persist_allowed_notification(
            &repository,
            &enabled_config(),
            &notification("synthetic-denied", None),
            "synthetic-account",
            NOW,
        )
        .await;
        assert!(matches!(denied, Err(SignalIngestError::SourceDenied)));

        let disabled = SignalAdapterConfig {
            allowlist: SignalAllowlist::new(["synthetic-sender".to_owned()], Vec::new())
                .expect("synthetic allowlist must validate"),
            ..SignalAdapterConfig::default()
        }
        .validate()
        .expect("synthetic disabled config must validate");
        let disabled_result = persist_allowed_notification(
            &repository,
            &disabled,
            &notification("synthetic-sender", None),
            "synthetic-account",
            NOW,
        )
        .await;
        assert!(matches!(
            disabled_result,
            Err(SignalIngestError::SourceDenied)
        ));

        let row_count: i64 = sqlx::query_scalar("SELECT count(*) FROM raw_sources")
            .fetch_one(&pool)
            .await
            .expect("synthetic row count must query");
        assert_eq!(row_count, 0);
    }

    #[tokio::test]
    async fn group_messages_require_an_exact_allowed_group() {
        let (repository, pool) = repository().await;
        let result = persist_allowed_notification(
            &repository,
            &enabled_config(),
            &notification("synthetic-sender", Some("synthetic-other-group")),
            "synthetic-account",
            NOW,
        )
        .await;
        assert!(matches!(result, Err(SignalIngestError::SourceDenied)));
        let row_count: i64 = sqlx::query_scalar("SELECT count(*) FROM reports")
            .fetch_one(&pool)
            .await
            .expect("synthetic row count must query");
        assert_eq!(row_count, 0);
    }

    #[tokio::test]
    async fn malformed_or_duplicate_envelopes_fail_closed() {
        let (repository, pool) = repository().await;
        let malformed = SignalReceiveNotification {
            subscription: 7,
            account: "synthetic-account".to_owned(),
            envelope: json!({ "sourceUuid": "synthetic-sender" }),
        };
        assert!(matches!(
            persist_allowed_notification(
                &repository,
                &enabled_config(),
                &malformed,
                "synthetic-account",
                NOW,
            )
            .await,
            Err(SignalIngestError::InvalidEnvelope)
        ));

        let valid = notification("synthetic-sender", None);
        persist_allowed_notification(
            &repository,
            &enabled_config(),
            &valid,
            "synthetic-account",
            NOW,
        )
        .await
        .expect("first synthetic notification must persist");
        assert!(matches!(
            persist_allowed_notification(
                &repository,
                &enabled_config(),
                &valid,
                "synthetic-account",
                NOW,
            )
            .await,
            Err(SignalIngestError::Repository(RepositoryError::Database(_)))
        ));
        let counts: (i64, i64, i64) = sqlx::query_as(
            "SELECT (SELECT count(*) FROM raw_sources),
                    (SELECT count(*) FROM reports),
                    (SELECT count(*) FROM audit_log)",
        )
        .fetch_one(&pool)
        .await
        .expect("synthetic counts must query");
        assert_eq!(counts, (1, 1, 1));
    }

    #[tokio::test]
    async fn account_mismatch_never_writes_rows() {
        let (repository, pool) = repository().await;
        let result = persist_allowed_notification(
            &repository,
            &enabled_config(),
            &notification("synthetic-sender", None),
            "synthetic-other-account",
            NOW,
        )
        .await;
        assert!(matches!(result, Err(SignalIngestError::AccountMismatch)));
        let row_count: i64 = sqlx::query_scalar("SELECT count(*) FROM raw_sources")
            .fetch_one(&pool)
            .await
            .expect("synthetic row count must query");
        assert_eq!(row_count, 0);
    }
}
