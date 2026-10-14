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
    let inspected = match inspect_allowed_notification(config, notification, account) {
        Ok(message) => message,
        Err(SignalIngestError::SourceDenied) => return Ok(NotificationOutcome::Ignored),
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
    persist_allowed_notification(repository, config, notification, account, &captured_at).await?;
    Ok(NotificationOutcome::Captured)
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
}
