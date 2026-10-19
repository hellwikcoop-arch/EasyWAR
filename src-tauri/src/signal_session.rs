use crate::{
    repository::{Repository, RepositoryError},
    signal_commands::{parse_command, render_response},
    signal_daemon::{self, SignalDaemonError, SignalReceiveEnd},
    signal_ingest::{
        inspect_allowed_notification, persist_allowed_notification, SignalIngestError,
    },
    signal_policy::ValidatedSignalAdapterConfig,
};
use chrono::{SecondsFormat, Utc};
use serde::Serialize;
use std::{
    sync::{
        atomic::{AtomicU64, Ordering},
        Arc, Mutex,
    },
    time::Duration,
};
use tokio::sync::{mpsc, watch};

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
pub struct SignalSessionStatus {
    pub active: bool,
    pub account: Option<String>,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
pub struct SignalSessionSummary {
    pub captured: usize,
    /// Notifications that were neither stored nor answered and did not end the session:
    /// sources outside the allowlist, envelopes without a text message (receipts,
    /// typing, sync, reactions, attachments without a caption) and envelopes that are
    /// already stored.
    pub ignored: usize,
    pub commands: usize,
    pub end: SignalReceiveEnd,
}

#[derive(Debug, thiserror::Error)]
pub enum SignalSessionError {
    #[error("сеанс приймання Signal уже активний")]
    AlreadyActive,
    #[error(transparent)]
    Receive(#[from] SignalDaemonError),
    #[error(transparent)]
    Ingest(#[from] SignalIngestError),
    #[error(transparent)]
    Repository(#[from] RepositoryError),
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum NotificationOutcome {
    Captured,
    Ignored,
    CommandReplied,
}

async fn process_notification(
    repository: &Repository,
    config: &ValidatedSignalAdapterConfig,
    notification: &signal_daemon::SignalReceiveNotification,
    account: &str,
) -> Result<NotificationOutcome, SignalSessionError> {
    // Neither a denied source nor an envelope without text ends the session. Nothing about
    // the envelope body is logged or returned here.
    let inspected = match inspect_allowed_notification(config, notification, account) {
        Ok(message) => message,
        Err(SignalIngestError::SourceDenied | SignalIngestError::NotTextMessage) => {
            return Ok(NotificationOutcome::Ignored)
        }
        Err(error) => return Err(error.into()),
    };

    if let Some(command) = parse_command(&inspected.message) {
        let snapshot = if command.needs_queue_snapshot() {
            Some(repository.signal_command_queue_snapshot().await?)
        } else {
            None
        };
        let response = render_response(command, snapshot.as_ref());
        signal_daemon::send_direct_message(
            &config.as_config().endpoint,
            account,
            &inspected.sender,
            &response,
        )
        .await?;
        return Ok(NotificationOutcome::CommandReplied);
    }

    let captured_at = Utc::now().to_rfc3339_opts(SecondsFormat::Millis, true);
    match persist_allowed_notification(repository, config, notification, account, &captured_at)
        .await
    {
        Ok(_) => Ok(NotificationOutcome::Captured),
        // Already stored (earlier in this session or in a previous one): nothing to add.
        Err(SignalIngestError::Duplicate) => Ok(NotificationOutcome::Ignored),
        Err(error) => Err(error.into()),
    }
}

#[derive(Clone, Debug, Default)]
pub struct SignalReceiveController {
    state: Arc<Mutex<Option<ActiveSession>>>,
    next_id: Arc<AtomicU64>,
}

#[derive(Debug)]
struct ActiveSession {
    id: u64,
    account: String,
    stop: watch::Sender<bool>,
}

#[derive(Debug)]
struct SessionLease {
    state: Arc<Mutex<Option<ActiveSession>>>,
    id: u64,
    stop: watch::Sender<bool>,
}

impl Drop for SessionLease {
    fn drop(&mut self) {
        let mut state = self.state.lock().expect("Signal session state poisoned");
        if state.as_ref().is_some_and(|active| active.id == self.id) {
            state.take();
        }
    }
}

impl SessionLease {
    fn request_stop(&self) {
        let _ = self.stop.send(true);
    }
}

impl SignalReceiveController {
    pub fn status(&self) -> SignalSessionStatus {
        let state = self.state.lock().expect("Signal session state poisoned");
        SignalSessionStatus {
            active: state.is_some(),
            account: state.as_ref().map(|active| active.account.clone()),
        }
    }

    pub fn stop(&self) -> bool {
        let state = self.state.lock().expect("Signal session state poisoned");
        state
            .as_ref()
            .is_some_and(|active| active.stop.send(true).is_ok())
    }

    pub async fn run(
        &self,
        repository: &Repository,
        config: &ValidatedSignalAdapterConfig,
        account: &str,
        max_notifications: usize,
        wait_timeout: Duration,
    ) -> Result<SignalSessionSummary, SignalSessionError> {
        let (lease, stop_rx) = self.begin(account)?;
        let (sender, mut receiver) = mpsc::unbounded_channel();
        let mut receive = Box::pin(signal_daemon::receive_to_channel(
            &config.as_config().endpoint,
            account,
            max_notifications,
            wait_timeout,
            stop_rx,
            sender,
        ));
        let mut captured = 0_usize;
        let mut ignored = 0_usize;
        let mut commands = 0_usize;

        let end = loop {
            tokio::select! {
                biased;
                Some(notification) = receiver.recv() => {
                    match process_notification(repository, config, &notification, account).await {
                        Ok(NotificationOutcome::Captured) => captured += 1,
                        Ok(NotificationOutcome::Ignored) => ignored += 1,
                        Ok(NotificationOutcome::CommandReplied) => commands += 1,
                        Err(error) => {
                            lease.request_stop();
                            if let Err(cleanup_error) = receive.await {
                                return Err(SignalSessionError::Receive(cleanup_error));
                            }
                            return Err(error);
                        }
                    }
                }
                result = &mut receive => break result?,
            }
        };

        Ok(SignalSessionSummary {
            captured,
            ignored,
            commands,
            end,
        })
    }

    fn begin(
        &self,
        account: &str,
    ) -> Result<(SessionLease, watch::Receiver<bool>), SignalSessionError> {
        let mut state = self.state.lock().expect("Signal session state poisoned");
        if state.is_some() {
            return Err(SignalSessionError::AlreadyActive);
        }
        let id = self.next_id.fetch_add(1, Ordering::Relaxed) + 1;
        let (stop, stop_rx) = watch::channel(false);
        *state = Some(ActiveSession {
            id,
            account: account.to_owned(),
            stop: stop.clone(),
        });
        Ok((
            SessionLease {
                state: Arc::clone(&self.state),
                id,
                stop,
            },
            stop_rx,
        ))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{
        database::INITIAL_SCHEMA_SQL,
        signal_policy::{SignalAdapterConfig, SignalAllowlist, SignalDaemonEndpoint},
    };
    use serde_json::{json, Value};
    use sqlx::sqlite::SqlitePoolOptions;
    use std::{
        io::{Read, Write},
        net::{Ipv4Addr, TcpListener, TcpStream},
        thread::JoinHandle,
    };

    fn read_request(stream: &mut TcpStream) -> (String, Option<Value>) {
        let mut bytes = Vec::new();
        loop {
            let mut chunk = [0_u8; 4096];
            let count = stream.read(&mut chunk).expect("synthetic request read");
            assert!(count > 0, "synthetic request ended before headers");
            bytes.extend_from_slice(&chunk[..count]);
            let Some(header_end) = bytes.windows(4).position(|part| part == b"\r\n\r\n") else {
                continue;
            };
            let header = std::str::from_utf8(&bytes[..header_end]).expect("synthetic header");
            let length = header
                .lines()
                .find_map(|line| {
                    line.split_once(':').and_then(|(key, value)| {
                        key.eq_ignore_ascii_case("content-length")
                            .then(|| value.trim().parse::<usize>().ok())
                            .flatten()
                    })
                })
                .unwrap_or(0);
            let body_start = header_end + 4;
            if bytes.len() < body_start + length {
                continue;
            }
            let request_line = header.lines().next().unwrap_or_default().to_owned();
            let body = (length > 0).then(|| {
                serde_json::from_slice(&bytes[body_start..body_start + length])
                    .expect("synthetic request JSON")
            });
            return (request_line, body);
        }
    }

    fn write_rpc(stream: &mut TcpStream, request: &Value, result: Value) {
        let reply = json!({"jsonrpc":"2.0", "id":request["id"], "result":result}).to_string();
        write!(
            stream,
            "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
            reply.len(),
            reply
        )
        .expect("synthetic RPC reply");
    }

    /// Serves the RPCs a session issues once receiving has ended. The session sends the
    /// command reply and `unsubscribeReceive` concurrently and may open one connection
    /// before it writes the request on the other, so each connection is read on its own
    /// thread: a daemon that reads them in accept order would block on the connection
    /// whose request is still pending while the session waits for the other reply.
    /// `handle` gets every request's method and body, answers with the RPC result and
    /// records what it saw; the returned flags are checked after all connections closed.
    fn serve_cleanup(
        listener: &TcpListener,
        connections: usize,
        handle: impl Fn(&str, &Value) -> Value + Send + Sync + 'static,
    ) -> Vec<String> {
        let handle = std::sync::Arc::new(handle);
        let seen = std::sync::Arc::new(std::sync::Mutex::new(Vec::new()));
        let workers: Vec<JoinHandle<()>> = (0..connections)
            .map(|_| {
                let (mut stream, _) = listener.accept().expect("synthetic cleanup RPC");
                let handle = std::sync::Arc::clone(&handle);
                let seen = std::sync::Arc::clone(&seen);
                std::thread::spawn(move || {
                    let (_, request) = read_request(&mut stream);
                    let request = request.expect("synthetic cleanup JSON");
                    let method = request["method"]
                        .as_str()
                        .expect("synthetic cleanup method")
                        .to_owned();
                    let result = handle(&method, &request);
                    write_rpc(&mut stream, &request, result);
                    seen.lock().expect("synthetic cleanup log").push(method);
                })
            })
            .collect();
        for worker in workers {
            worker.join().expect("synthetic cleanup worker");
        }
        let mut seen = seen.lock().expect("synthetic cleanup log").clone();
        seen.sort();
        seen
    }

    fn synthetic_daemon() -> (SignalDaemonEndpoint, JoinHandle<()>) {
        let listener = TcpListener::bind((Ipv4Addr::LOCALHOST, 0)).expect("synthetic listener");
        let address = listener.local_addr().expect("synthetic address");
        let handle = std::thread::spawn(move || {
            let (mut events, _) = listener.accept().expect("synthetic SSE connection");
            let (request, _) = read_request(&mut events);
            assert_eq!(request, "GET /api/v1/events HTTP/1.1");
            events
                .write_all(b"HTTP/1.1 200 OK\r\nContent-Type: text/event-stream\r\nConnection: keep-alive\r\n\r\n")
                .expect("synthetic SSE headers");
            events.flush().expect("synthetic SSE flush");

            let (mut subscribe, _) = listener.accept().expect("synthetic subscribe");
            let (_, request) = read_request(&mut subscribe);
            let request = request.expect("synthetic subscribe JSON");
            assert_eq!(request["method"], "subscribeReceive");
            write_rpc(&mut subscribe, &request, json!(42));

            for (index, (sender, message)) in [
                ("synthetic-denied", "/help"),
                ("synthetic-sender", "/queue"),
                ("synthetic-sender", "Синтетична доповідь без реальних даних"),
            ]
            .into_iter()
            .enumerate()
            {
                let mut data_message = json!({"message": message});
                if message == "/queue" {
                    data_message["groupInfo"] = json!({"groupId":"synthetic-group"});
                }
                let event = json!({
                    "jsonrpc": "2.0",
                    "method": "receive",
                    "params": {
                        "subscription": 42,
                        "result": {
                            "account": "synthetic-account",
                            "envelope": {
                                "sourceUuid": sender,
                                "timestamp": 1_767_225_600_000_u64 + index as u64,
                                "dataMessage": data_message
                            }
                        }
                    }
                });
                write!(events, "data: {event}\n\n").expect("synthetic SSE event");
            }
            events.flush().expect("synthetic event flush");

            let seen = serve_cleanup(&listener, 2, |method, request| match method {
                "send" => {
                    assert_eq!(request["params"]["account"], "synthetic-account");
                    assert_eq!(request["params"]["recipients"], json!(["synthetic-sender"]));
                    let reply = request["params"]["message"]
                        .as_str()
                        .expect("synthetic command response text");
                    assert!(reply.contains("Черга Signal: усього 0"));
                    assert!(!reply.contains("synthetic-group"));
                    json!({"timestamp": 1_u64})
                }
                "unsubscribeReceive" => Value::Null,
                method => panic!("unexpected synthetic method: {method:?}"),
            });
            // Each of the two RPCs runs exactly once, whichever reached the daemon first.
            assert_eq!(seen, ["send", "unsubscribeReceive"]);
        });
        (SignalDaemonEndpoint::Http { address }, handle)
    }

    fn synthetic_failing_command_daemon() -> (SignalDaemonEndpoint, JoinHandle<()>) {
        let listener = TcpListener::bind((Ipv4Addr::LOCALHOST, 0)).expect("synthetic listener");
        let address = listener.local_addr().expect("synthetic address");
        let handle = std::thread::spawn(move || {
            let (mut events, _) = listener.accept().expect("synthetic SSE connection");
            let (request, _) = read_request(&mut events);
            assert_eq!(request, "GET /api/v1/events HTTP/1.1");
            events
                .write_all(b"HTTP/1.1 200 OK\r\nContent-Type: text/event-stream\r\nConnection: keep-alive\r\n\r\n")
                .unwrap();
            events.flush().unwrap();

            let (mut subscribe, _) = listener.accept().expect("synthetic subscribe");
            let (_, request) = read_request(&mut subscribe);
            let request = request.expect("synthetic subscribe JSON");
            write_rpc(&mut subscribe, &request, json!(42));

            let event = json!({
                "jsonrpc": "2.0",
                "method": "receive",
                "params": {
                    "subscription": 42,
                    "result": {
                        "account": "synthetic-account",
                        "envelope": {
                            "sourceUuid": "synthetic-sender",
                            "timestamp": 1_767_225_600_000_u64,
                            "dataMessage": {"message": "/ping"}
                        }
                    }
                }
            });
            write!(events, "data: {event}\n\n").unwrap();
            events.flush().unwrap();

            // `send` answers with `null` instead of a timestamp, which the session must treat
            // as a failed command reply; the unsubscribe still has to go through.
            let seen = serve_cleanup(&listener, 2, |method, _| match method {
                "send" | "unsubscribeReceive" => Value::Null,
                method => panic!("unexpected synthetic method: {method:?}"),
            });
            assert_eq!(seen, ["send", "unsubscribeReceive"]);
        });
        (SignalDaemonEndpoint::Http { address }, handle)
    }

    async fn repository() -> Repository {
        let pool = SqlitePoolOptions::new()
            .max_connections(1)
            .connect("sqlite::memory:")
            .await
            .expect("synthetic database");
        sqlx::raw_sql(INITIAL_SCHEMA_SQL)
            .execute(&pool)
            .await
            .expect("synthetic migration");
        Repository::new(pool)
    }

    #[test]
    fn controller_allows_only_one_session_and_stop_is_explicit() {
        let controller = SignalReceiveController::default();
        let (lease, stop_rx) = controller.begin("synthetic-account").unwrap();
        assert_eq!(
            controller.status(),
            SignalSessionStatus {
                active: true,
                account: Some("synthetic-account".to_owned()),
            }
        );
        assert!(matches!(
            controller.begin("synthetic-other"),
            Err(SignalSessionError::AlreadyActive)
        ));
        assert!(controller.stop());
        assert!(*stop_rx.borrow());
        drop(lease);
        assert_eq!(
            controller.status(),
            SignalSessionStatus {
                active: false,
                account: None,
            }
        );
        assert!(!controller.stop());
    }

    #[tokio::test]
    async fn bounded_session_persists_allowed_synthetic_notification() {
        let repository = repository().await;
        let (endpoint, server) = synthetic_daemon();
        let config = SignalAdapterConfig {
            endpoint,
            intake_enabled: true,
            allowlist: SignalAllowlist::new(
                ["synthetic-sender".to_owned()],
                ["synthetic-group".to_owned()],
            )
            .unwrap(),
            ..SignalAdapterConfig::default()
        }
        .validate()
        .unwrap();
        let controller = SignalReceiveController::default();

        let summary = controller
            .run(
                &repository,
                &config,
                "synthetic-account",
                3,
                Duration::from_secs(5),
            )
            .await
            .expect("synthetic session must succeed");
        server.join().expect("synthetic daemon must stop");
        assert_eq!(
            summary,
            SignalSessionSummary {
                captured: 1,
                ignored: 1,
                commands: 1,
                end: SignalReceiveEnd::LimitReached,
            }
        );
        assert!(!controller.status().active);
        let inbox = repository.list_signal_inbox(100).await.unwrap();
        assert_eq!(inbox.len(), 1);
        assert_eq!(inbox[0].current_status, "NEW");
    }

    #[tokio::test]
    async fn failed_command_reply_still_unsubscribes_and_stores_no_command() {
        let repository = repository().await;
        let (endpoint, server) = synthetic_failing_command_daemon();
        let config = SignalAdapterConfig {
            endpoint,
            intake_enabled: true,
            allowlist: SignalAllowlist::new(["synthetic-sender".to_owned()], Vec::new()).unwrap(),
            ..SignalAdapterConfig::default()
        }
        .validate()
        .unwrap();
        let controller = SignalReceiveController::default();

        let result = controller
            .run(
                &repository,
                &config,
                "synthetic-account",
                2,
                Duration::from_secs(5),
            )
            .await;
        server.join().expect("synthetic daemon must stop");
        assert!(matches!(
            result,
            Err(SignalSessionError::Receive(
                SignalDaemonError::InvalidResponse
            ))
        ));
        assert!(!controller.status().active);
        assert!(repository.list_signal_inbox(100).await.unwrap().is_empty());
    }

    const TEXT: &str = "Синтетична доповідь без реальних даних";
    const BASE_TIMESTAMP: u64 = 1_767_225_600_000;

    fn text_envelope(sender: &str, timestamp: u64, message: &str) -> Value {
        json!({
            "sourceUuid": sender,
            "timestamp": timestamp,
            "dataMessage": {"message": message}
        })
    }

    /// Envelopes signal-cli emits that carry no text message, as one source would send them.
    fn non_text_envelopes(sender: &str) -> Vec<Value> {
        let timestamp = BASE_TIMESTAMP;
        vec![
            json!({
                "sourceUuid": sender,
                "timestamp": timestamp,
                "receiptMessage": {"when": timestamp, "isDelivery": true, "timestamps": [timestamp]}
            }),
            json!({
                "sourceUuid": sender,
                "timestamp": timestamp,
                "typingMessage": {"action": "STARTED", "timestamp": timestamp}
            }),
            json!({
                "sourceUuid": sender,
                "timestamp": timestamp,
                "syncMessage": {"readMessages": [{"sender": sender, "timestamp": timestamp}]}
            }),
            json!({
                "sourceUuid": sender,
                "timestamp": timestamp,
                "dataMessage": {
                    "timestamp": timestamp,
                    "reaction": {"emoji": "+", "targetAuthorUuid": sender, "targetSentTimestamp": timestamp}
                }
            }),
            json!({
                "sourceUuid": sender,
                "timestamp": timestamp,
                "dataMessage": {
                    "timestamp": timestamp,
                    "attachments": [{"contentType": "image/jpeg", "size": 1}]
                }
            }),
            json!({
                "sourceUuid": sender,
                "timestamp": timestamp,
                "dataMessage": {"message": "  "}
            }),
        ]
    }

    /// A daemon that streams `envelopes` as receive events and then only expects the
    /// session's `unsubscribeReceive` (no command reply is ever sent).
    fn synthetic_envelope_daemon(envelopes: Vec<Value>) -> (SignalDaemonEndpoint, JoinHandle<()>) {
        let listener = TcpListener::bind((Ipv4Addr::LOCALHOST, 0)).expect("synthetic listener");
        let address = listener.local_addr().expect("synthetic address");
        let handle = std::thread::spawn(move || {
            let (mut events, _) = listener.accept().expect("synthetic SSE connection");
            let (request, _) = read_request(&mut events);
            assert_eq!(request, "GET /api/v1/events HTTP/1.1");
            events
                .write_all(b"HTTP/1.1 200 OK\r\nContent-Type: text/event-stream\r\nConnection: keep-alive\r\n\r\n")
                .expect("synthetic SSE headers");
            events.flush().expect("synthetic SSE flush");

            let (mut subscribe, _) = listener.accept().expect("synthetic subscribe");
            let (_, request) = read_request(&mut subscribe);
            let request = request.expect("synthetic subscribe JSON");
            assert_eq!(request["method"], "subscribeReceive");
            write_rpc(&mut subscribe, &request, json!(42));

            // One write for the whole stream: the client cannot close the connection
            // before it has received anything, so the write cannot race a failing session.
            let mut stream = String::new();
            for envelope in envelopes {
                let event = json!({
                    "jsonrpc": "2.0",
                    "method": "receive",
                    "params": {
                        "subscription": 42,
                        "result": {"account": "synthetic-account", "envelope": envelope}
                    }
                });
                stream.push_str(&format!("data: {event}\n\n"));
            }
            events
                .write_all(stream.as_bytes())
                .expect("synthetic SSE events");
            events.flush().expect("synthetic event flush");

            // Whether the session ends by the notification limit or stops after a failure,
            // it must unsubscribe exactly once and send nothing else.
            let seen = serve_cleanup(&listener, 1, |method, _| match method {
                "unsubscribeReceive" => Value::Null,
                method => panic!("unexpected synthetic method: {method:?}"),
            });
            assert_eq!(seen, ["unsubscribeReceive"]);
        });
        (SignalDaemonEndpoint::Http { address }, handle)
    }

    fn allowing_config(endpoint: SignalDaemonEndpoint) -> ValidatedSignalAdapterConfig {
        SignalAdapterConfig {
            endpoint,
            intake_enabled: true,
            allowlist: SignalAllowlist::new(
                ["synthetic-sender".to_owned()],
                ["synthetic-group".to_owned()],
            )
            .unwrap(),
            ..SignalAdapterConfig::default()
        }
        .validate()
        .unwrap()
    }

    async fn run_bounded_session(
        controller: &SignalReceiveController,
        repository: &Repository,
        config: &ValidatedSignalAdapterConfig,
        limit: usize,
    ) -> Result<SignalSessionSummary, SignalSessionError> {
        controller
            .run(
                repository,
                config,
                "synthetic-account",
                limit,
                Duration::from_secs(5),
            )
            .await
    }

    fn stored_timestamps(inbox: &[crate::repository::SignalInboxItem]) -> Vec<String> {
        let mut timestamps: Vec<String> = inbox
            .iter()
            .map(|item| item.source_timestamp.clone().unwrap_or_default())
            .collect();
        timestamps.sort();
        timestamps
    }

    #[tokio::test]
    async fn non_text_envelopes_from_any_source_do_not_end_the_session() {
        let repository = repository().await;
        let mut envelopes = Vec::new();
        for (allowed, denied) in non_text_envelopes("synthetic-sender")
            .into_iter()
            .zip(non_text_envelopes("synthetic-denied"))
        {
            envelopes.push(allowed);
            envelopes.push(denied);
        }
        // A denied source cannot end the session with a malformed body either.
        envelopes.push(json!({
            "sourceUuid": "synthetic-denied",
            "dataMessage": {"message": TEXT, "groupInfo": "synthetic"}
        }));
        envelopes.push(json!({"sourceUuid": "synthetic-denied"}));
        let ignored_before_text = envelopes.len();
        envelopes.push(text_envelope("synthetic-sender", BASE_TIMESTAMP + 1, TEXT));
        let (endpoint, server) = synthetic_envelope_daemon(envelopes);
        let config = allowing_config(endpoint);
        let controller = SignalReceiveController::default();

        let summary =
            run_bounded_session(&controller, &repository, &config, ignored_before_text + 1)
                .await
                .expect("non-text envelopes must not fail the session");
        server.join().expect("synthetic daemon must stop");

        assert_eq!(
            summary,
            SignalSessionSummary {
                captured: 1,
                ignored: ignored_before_text,
                commands: 0,
                end: SignalReceiveEnd::LimitReached,
            }
        );
        assert!(!controller.status().active);
        let inbox = repository.list_signal_inbox(100).await.unwrap();
        assert_eq!(inbox.len(), 1);
        assert_eq!(inbox[0].current_status, "NEW");
        assert_eq!(
            stored_timestamps(&inbox),
            [(BASE_TIMESTAMP + 1).to_string()]
        );
    }

    #[tokio::test]
    async fn stored_duplicates_are_ignored_and_later_messages_are_still_captured() {
        let repository = repository().await;
        let config = allowing_config(SignalDaemonEndpoint::Http {
            address: (Ipv4Addr::LOCALHOST, 9).into(),
        });
        // Stored by an earlier session.
        let earlier = signal_daemon::SignalReceiveNotification {
            subscription: 42,
            account: "synthetic-account".to_owned(),
            envelope: text_envelope("synthetic-sender", BASE_TIMESTAMP, TEXT),
        };
        persist_allowed_notification(
            &repository,
            &config,
            &earlier,
            "synthetic-account",
            "2026-01-01T00:00:00.000Z",
        )
        .await
        .expect("synthetic earlier capture");

        let (endpoint, server) = synthetic_envelope_daemon(vec![
            // Duplicate of the earlier session.
            text_envelope("synthetic-sender", BASE_TIMESTAMP, TEXT),
            text_envelope("synthetic-sender", BASE_TIMESTAMP + 1, TEXT),
            // Duplicate inside this session.
            text_envelope("synthetic-sender", BASE_TIMESTAMP + 1, TEXT),
            text_envelope("synthetic-sender", BASE_TIMESTAMP + 2, TEXT),
        ]);
        let config = allowing_config(endpoint);
        let controller = SignalReceiveController::default();

        let summary = run_bounded_session(&controller, &repository, &config, 4)
            .await
            .expect("duplicates must not fail the session");
        server.join().expect("synthetic daemon must stop");

        assert_eq!(
            summary,
            SignalSessionSummary {
                captured: 2,
                ignored: 2,
                commands: 0,
                end: SignalReceiveEnd::LimitReached,
            }
        );
        let inbox = repository.list_signal_inbox(100).await.unwrap();
        assert_eq!(
            stored_timestamps(&inbox),
            [
                BASE_TIMESTAMP.to_string(),
                (BASE_TIMESTAMP + 1).to_string(),
                (BASE_TIMESTAMP + 2).to_string(),
            ]
        );
    }

    #[tokio::test]
    async fn database_failure_after_ignored_envelopes_still_fails_the_session() {
        let pool = SqlitePoolOptions::new()
            .max_connections(1)
            .connect("sqlite::memory:")
            .await
            .expect("synthetic database");
        sqlx::raw_sql(INITIAL_SCHEMA_SQL)
            .execute(&pool)
            .await
            .expect("synthetic migration");
        let repository = Repository::new(pool.clone());
        // Ignored envelopes never touch the database, so only the text message can fail.
        pool.close().await;

        let mut envelopes = non_text_envelopes("synthetic-sender");
        envelopes.extend(non_text_envelopes("synthetic-denied"));
        envelopes.push(text_envelope("synthetic-sender", BASE_TIMESTAMP + 1, TEXT));
        let total = envelopes.len();
        let (endpoint, server) = synthetic_envelope_daemon(envelopes);
        let config = allowing_config(endpoint);
        let controller = SignalReceiveController::default();

        let result = run_bounded_session(&controller, &repository, &config, total).await;
        server
            .join()
            .expect("synthetic daemon must still unsubscribe");

        assert!(matches!(
            result,
            Err(SignalSessionError::Ingest(SignalIngestError::Repository(
                RepositoryError::Database(_)
            )))
        ));
        assert!(!controller.status().active);
    }

    #[tokio::test]
    async fn non_text_envelope_outcomes_are_decided_without_the_database() {
        let repository = repository().await;
        let config = allowing_config(SignalDaemonEndpoint::Http {
            address: (Ipv4Addr::LOCALHOST, 9).into(),
        });
        let notification = |envelope: Value| signal_daemon::SignalReceiveNotification {
            subscription: 42,
            account: "synthetic-account".to_owned(),
            envelope,
        };
        for sender in ["synthetic-sender", "synthetic-denied"] {
            for envelope in non_text_envelopes(sender) {
                let outcome = process_notification(
                    &repository,
                    &config,
                    &notification(envelope),
                    "synthetic-account",
                )
                .await
                .expect("a non-text envelope is never an error");
                assert_eq!(outcome, NotificationOutcome::Ignored);
            }
        }

        // A malformed text message from an allowed sender stays a protocol error.
        let malformed = process_notification(
            &repository,
            &config,
            &notification(json!({
                "sourceUuid": "synthetic-sender",
                "dataMessage": {"message": TEXT}
            })),
            "synthetic-account",
        )
        .await;
        assert!(matches!(
            malformed,
            Err(SignalSessionError::Ingest(
                SignalIngestError::InvalidEnvelope
            ))
        ));
        // A notification for another local account is a protocol error as well.
        let other_account = signal_daemon::SignalReceiveNotification {
            subscription: 42,
            account: "synthetic-other-account".to_owned(),
            envelope: text_envelope("synthetic-sender", BASE_TIMESTAMP, TEXT),
        };
        let mismatch =
            process_notification(&repository, &config, &other_account, "synthetic-account").await;
        assert!(matches!(
            mismatch,
            Err(SignalSessionError::Ingest(
                SignalIngestError::AccountMismatch
            ))
        ));
        assert!(repository.list_signal_inbox(100).await.unwrap().is_empty());
    }
}
