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
    /// A text message that cannot be stored because its envelope is malformed. Only an
    /// allowed source can cause it; it is a genuine protocol error and stays fatal.
    #[error("подія Signal не відповідає дозволеному формату повідомлення")]
    InvalidEnvelope,
    /// A well-formed envelope without `dataMessage.message` (delivery receipt, typing,
    /// sync, reaction, attachment without caption, ...). It is not an error of the
    /// session: the receive loop counts it as ignored.
    #[error("подія Signal не містить текстового повідомлення")]
    NotTextMessage,
    #[error("джерело Signal не дозволене локальною політикою")]
    SourceDenied,
    /// The same envelope is already stored (unique identity of the raw source). The
    /// receive loop counts it as ignored.
    #[error("подію Signal уже збережено раніше")]
    Duplicate,
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

    let captured = repository
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
        .await;
    match captured {
        Ok(()) => {}
        Err(error) if is_unique_violation(&error) => return Err(SignalIngestError::Duplicate),
        Err(error) => return Err(error.into()),
    }

    Ok(SignalCaptureResult {
        report_id,
        raw_sha256,
    })
}

/// Only the unique identity of the raw source (its hash-derived primary key) can collide
/// when an envelope is stored a second time; every other database failure is a real one.
fn is_unique_violation(error: &RepositoryError) -> bool {
    matches!(
        error,
        RepositoryError::Database(sqlx::Error::Database(database_error))
            if database_error.is_unique_violation()
    )
}

/// Decides whether `notification` is a text message from an allowed source.
///
/// The order is deny-by-default: the sender decision comes first and looks at nothing but
/// the sender fields (and, in "bot in a group" mode, the group id when it is a valid
/// string), so a source outside the allowlist is `SourceDenied` whatever its
/// body contains (a malformed body from it can never end a session). Only then the body
/// is classified: an envelope without `dataMessage.message` is `NotTextMessage`, and only
/// a text message from an allowed sender can still be `InvalidEnvelope`.
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

    // `permits_source(_, None)` applies the sender allowlist only; the group is checked
    // once the text message has been recognised. In "bot in a group" mode a sender who is
    // not listed passes this gate only when the envelope names a group whose members are
    // all allowed; the lookup never fails, so a malformed body stays `SourceDenied`.
    let senders = sender_candidates(envelope);
    let open_group =
        peek_group_id(envelope).is_some_and(|group| config.permits_group_members(group));
    if !open_group
        && !senders
            .iter()
            .any(|sender| config.permits_source(sender, None))
    {
        return Err(SignalIngestError::SourceDenied);
    }

    let data_message = envelope.get("dataMessage").and_then(Value::as_object);
    let message = data_message
        .and_then(|data_message| data_message.get("message"))
        .and_then(Value::as_str)
        .filter(|message| !message.trim().is_empty());
    let (Some(data_message), Some(message)) = (data_message, message) else {
        return Err(SignalIngestError::NotTextMessage);
    };

    let timestamp = envelope
        .get("timestamp")
        .and_then(Value::as_u64)
        .ok_or(SignalIngestError::InvalidEnvelope)?;
    let group = extract_group(data_message)?;
    let sender = senders
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

fn peek_group_id(envelope: &Map<String, Value>) -> Option<&str> {
    envelope
        .get("dataMessage")?
        .get("groupInfo")?
        .get("groupId")?
        .as_str()
        .filter(|group| valid_identifier(group))
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

    async fn row_counts(pool: &SqlitePool) -> (i64, i64, i64) {
        sqlx::query_as(
            "SELECT (SELECT count(*) FROM raw_sources),
                    (SELECT count(*) FROM reports),
                    (SELECT count(*) FROM audit_log)",
        )
        .fetch_one(pool)
        .await
        .expect("synthetic counts must query")
    }

    #[tokio::test]
    async fn malformed_text_envelopes_from_allowed_sources_fail_closed() {
        let (repository, pool) = repository().await;
        let malformed = [
            // Text message without a timestamp.
            json!({
                "sourceUuid": "synthetic-sender",
                "dataMessage": { "message": "Синтетична доповідь" },
            }),
            // Text message with a group reference that has no usable group id.
            json!({
                "sourceUuid": "synthetic-sender",
                "timestamp": 1_767_225_600_000_u64,
                "dataMessage": { "message": "Синтетична доповідь", "groupInfo": {} },
            }),
        ];
        for envelope in malformed {
            let notification = SignalReceiveNotification {
                subscription: 7,
                account: "synthetic-account".to_owned(),
                envelope,
            };
            assert!(matches!(
                persist_allowed_notification(
                    &repository,
                    &enabled_config(),
                    &notification,
                    "synthetic-account",
                    NOW,
                )
                .await,
                Err(SignalIngestError::InvalidEnvelope)
            ));
        }
        // An envelope that is not even an object is a protocol error as well.
        let not_an_object = SignalReceiveNotification {
            subscription: 7,
            account: "synthetic-account".to_owned(),
            envelope: json!("synthetic"),
        };
        assert!(matches!(
            inspect_allowed_notification(&enabled_config(), &not_an_object, "synthetic-account"),
            Err(SignalIngestError::InvalidEnvelope)
        ));
        // An unusable capture time is rejected before anything is written.
        assert!(matches!(
            persist_allowed_notification(
                &repository,
                &enabled_config(),
                &notification("synthetic-sender", None),
                "synthetic-account",
                "",
            )
            .await,
            Err(SignalIngestError::InvalidEnvelope)
        ));
        assert_eq!(row_counts(&pool).await, (0, 0, 0));
    }

    #[tokio::test]
    async fn duplicate_envelope_is_typed_and_writes_nothing() {
        let (repository, pool) = repository().await;
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
        for captured_at in [NOW, "2026-01-02T00:00:00Z"] {
            assert!(matches!(
                persist_allowed_notification(
                    &repository,
                    &enabled_config(),
                    &valid,
                    "synthetic-account",
                    captured_at,
                )
                .await,
                Err(SignalIngestError::Duplicate)
            ));
        }
        assert_eq!(row_counts(&pool).await, (1, 1, 1));
    }

    #[tokio::test]
    async fn other_database_failures_are_not_reported_as_duplicates() {
        let (repository, pool) = repository().await;
        sqlx::query("DROP TABLE audit_log")
            .execute(&pool)
            .await
            .expect("synthetic audit table must drop");
        let result = persist_allowed_notification(
            &repository,
            &enabled_config(),
            &notification("synthetic-sender", None),
            "synthetic-account",
            NOW,
        )
        .await;
        assert!(matches!(
            result,
            Err(SignalIngestError::Repository(RepositoryError::Database(_)))
        ));
        // The capture is one transaction: the failed audit insert leaves no partial rows.
        let raw_sources: i64 = sqlx::query_scalar("SELECT count(*) FROM raw_sources")
            .fetch_one(&pool)
            .await
            .expect("synthetic row count must query");
        assert_eq!(raw_sources, 0);

        pool.close().await;
        assert!(matches!(
            persist_allowed_notification(
                &repository,
                &enabled_config(),
                &notification("synthetic-sender", None),
                "synthetic-account",
                NOW,
            )
            .await,
            Err(SignalIngestError::Repository(RepositoryError::Database(_)))
        ));
    }

    fn no_text_envelopes(sender: &str) -> Vec<(&'static str, Value)> {
        let timestamp = 1_767_225_600_000_u64;
        vec![
            (
                "delivery receipt",
                json!({
                    "sourceUuid": sender,
                    "timestamp": timestamp,
                    "receiptMessage": { "when": timestamp, "isDelivery": true, "timestamps": [timestamp] },
                }),
            ),
            (
                "typing indicator",
                json!({
                    "sourceUuid": sender,
                    "timestamp": timestamp,
                    "typingMessage": { "action": "STARTED", "timestamp": timestamp },
                }),
            ),
            (
                "sync message",
                json!({
                    "sourceUuid": sender,
                    "timestamp": timestamp,
                    "syncMessage": { "readMessages": [{ "sender": sender, "timestamp": timestamp }] },
                }),
            ),
            (
                "reaction",
                json!({
                    "sourceUuid": sender,
                    "timestamp": timestamp,
                    "dataMessage": {
                        "timestamp": timestamp,
                        "reaction": { "emoji": "+", "targetAuthorUuid": sender, "targetSentTimestamp": timestamp },
                    },
                }),
            ),
            (
                "attachment without caption",
                json!({
                    "sourceUuid": sender,
                    "timestamp": timestamp,
                    "dataMessage": {
                        "timestamp": timestamp,
                        "attachments": [{ "contentType": "image/jpeg", "size": 1 }],
                    },
                }),
            ),
            (
                "null message",
                json!({
                    "sourceUuid": sender,
                    "timestamp": timestamp,
                    "dataMessage": { "message": null },
                }),
            ),
            (
                "blank message",
                json!({
                    "sourceUuid": sender,
                    "timestamp": timestamp,
                    "dataMessage": { "message": " \n\t " },
                }),
            ),
            (
                "data message that is not an object",
                json!({
                    "sourceUuid": sender,
                    "timestamp": timestamp,
                    "dataMessage": "synthetic",
                }),
            ),
            ("bare envelope", json!({ "sourceUuid": sender })),
        ]
    }

    #[tokio::test]
    async fn envelopes_without_text_are_never_stored_for_any_source() {
        let (repository, pool) = repository().await;
        for (sender, allowed) in [("synthetic-sender", true), ("synthetic-denied", false)] {
            for (label, envelope) in no_text_envelopes(sender) {
                let notification = SignalReceiveNotification {
                    subscription: 7,
                    account: "synthetic-account".to_owned(),
                    envelope,
                };
                let inspected = inspect_allowed_notification(
                    &enabled_config(),
                    &notification,
                    "synthetic-account",
                );
                if allowed {
                    assert!(
                        matches!(inspected, Err(SignalIngestError::NotTextMessage)),
                        "{label} from an allowed source must be a non-text envelope"
                    );
                } else {
                    assert!(
                        matches!(inspected, Err(SignalIngestError::SourceDenied)),
                        "{label} from a denied source must be denied"
                    );
                }
                let persisted = persist_allowed_notification(
                    &repository,
                    &enabled_config(),
                    &notification,
                    "synthetic-account",
                    NOW,
                )
                .await;
                assert!(
                    matches!(
                        persisted,
                        Err(SignalIngestError::NotTextMessage | SignalIngestError::SourceDenied)
                    ),
                    "{label} must never be persisted"
                );
            }
        }
        assert_eq!(row_counts(&pool).await, (0, 0, 0));
    }

    #[test]
    fn denied_source_is_decided_before_the_body_is_inspected() {
        let secret = "Синтетичний секретний текст";
        let timestamp = 1_767_225_600_000_u64;
        let denied = [
            // Text message with a malformed group reference.
            json!({
                "sourceUuid": "synthetic-denied",
                "timestamp": timestamp,
                "dataMessage": { "message": secret, "groupInfo": "synthetic" },
            }),
            // Text message without a timestamp.
            json!({
                "sourceUuid": "synthetic-denied",
                "dataMessage": { "message": secret },
            }),
            // Text message without any sender field.
            json!({
                "timestamp": timestamp,
                "dataMessage": { "message": secret },
            }),
            // A sender field that is not a valid identifier never matches the allowlist.
            json!({
                "sourceUuid": " synthetic-sender",
                "timestamp": timestamp,
                "dataMessage": { "message": secret },
            }),
        ];
        for envelope in denied {
            let notification = SignalReceiveNotification {
                subscription: 7,
                account: "synthetic-account".to_owned(),
                envelope,
            };
            let error =
                inspect_allowed_notification(&enabled_config(), &notification, "synthetic-account")
                    .expect_err("a denied source must never be inspected as a message");
            assert!(matches!(error, SignalIngestError::SourceDenied));
            assert!(!error.to_string().contains(secret));
            assert!(!format!("{error:?}").contains(secret));
        }

        // The same malformed body from an allowed sender is a protocol error, and its
        // text still does not leak into the error.
        let malformed = SignalReceiveNotification {
            subscription: 7,
            account: "synthetic-account".to_owned(),
            envelope: json!({
                "sourceUuid": "synthetic-sender",
                "timestamp": timestamp,
                "dataMessage": { "message": secret, "groupInfo": "synthetic" },
            }),
        };
        let error =
            inspect_allowed_notification(&enabled_config(), &malformed, "synthetic-account")
                .expect_err("a malformed group reference must be rejected");
        assert!(matches!(error, SignalIngestError::InvalidEnvelope));
        assert!(!error.to_string().contains(secret));
        assert!(!format!("{error:?}").contains(secret));
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

    fn group_member_config() -> ValidatedSignalAdapterConfig {
        SignalAdapterConfig {
            intake_enabled: true,
            allowlist: SignalAllowlist::new(Vec::new(), ["synthetic-group".to_owned()])
                .expect("synthetic allowlist must validate")
                .with_group_members(true),
            ..SignalAdapterConfig::default()
        }
        .validate()
        .expect("synthetic group-member config must validate")
    }

    #[tokio::test]
    async fn group_member_mode_persists_any_member_of_an_allowed_group() {
        let (repository, _pool) = repository().await;
        let config = group_member_config();
        let inspected = inspect_allowed_notification(
            &config,
            &notification("synthetic-member", Some("synthetic-group")),
            "synthetic-account",
        )
        .expect("a member of an allowed group must pass");
        assert_eq!(inspected.sender, "synthetic-member");
        assert_eq!(inspected.group.as_deref(), Some("synthetic-group"));

        persist_allowed_notification(
            &repository,
            &config,
            &notification("synthetic-member", Some("synthetic-group")),
            "synthetic-account",
            NOW,
        )
        .await
        .expect("a group-member message must persist");
        let inbox = repository
            .list_signal_inbox(100)
            .await
            .expect("synthetic Inbox must query");
        assert_eq!(inbox.len(), 1);
        assert_eq!(inbox[0].current_status, "NEW");
    }

    #[test]
    fn group_member_mode_still_denies_direct_and_other_group_messages() {
        let config = group_member_config();
        for group in [None, Some("synthetic-other-group")] {
            let result = inspect_allowed_notification(
                &config,
                &notification("synthetic-member", group),
                "synthetic-account",
            );
            assert!(matches!(result, Err(SignalIngestError::SourceDenied)));
        }
    }

    #[test]
    fn group_member_mode_treats_service_events_as_not_text() {
        let receipt = SignalReceiveNotification {
            subscription: 7,
            account: "synthetic-account".to_owned(),
            envelope: json!({
                "sourceUuid": "synthetic-member",
                "timestamp": 1_767_225_600_000_u64,
                "dataMessage": { "groupInfo": { "groupId": "synthetic-group" } },
            }),
        };
        let result =
            inspect_allowed_notification(&group_member_config(), &receipt, "synthetic-account");
        assert!(matches!(result, Err(SignalIngestError::NotTextMessage)));
    }
}
