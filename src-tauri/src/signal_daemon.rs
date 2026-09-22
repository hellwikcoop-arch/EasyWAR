use crate::signal_policy::{SignalDaemonEndpoint, SIGNAL_HTTP_RPC_PATH};
use reqwest::{redirect::Policy, Client};
use serde::Serialize;
use serde_json::{json, Value};
use std::{
    sync::atomic::{AtomicU64, Ordering},
    time::Duration,
};

const MAX_RPC_BYTES: usize = 1024 * 1024;
const DISCOVERY_TIMEOUT: Duration = Duration::from_secs(8);
const LINK_TIMEOUT: Duration = Duration::from_secs(120);
const MAX_LINK_URI_BYTES: usize = 2048;
const MAX_DEVICE_NAME_CHARS: usize = 64;
static REQUEST_ID: AtomicU64 = AtomicU64::new(1);

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
pub struct SignalAccountSummary {
    pub id: String,
    pub number: Option<String>,
    pub aci: Option<String>,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
pub struct SignalGroupSummary {
    pub id: String,
    pub name: String,
    pub is_member: bool,
    pub is_blocked: bool,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
pub struct SignalLinkStart {
    pub device_link_uri: String,
}

#[derive(Debug, thiserror::Error)]
pub enum SignalDaemonError {
    #[error("для перевірки signal-cli наразі підтримується лише локальний HTTP-інтерфейс")]
    UnsupportedTransport,
    #[error("не вдалося підключитися до локального signal-cli")]
    Connection,
    #[error("signal-cli повернув некоректну відповідь")]
    InvalidResponse,
    #[error("signal-cli відхилив запит: {0}")]
    Rpc(String),
    #[error("запит до signal-cli перевищив обмеження розміру")]
    OversizedResponse,
    #[error("обліковий запис Signal не вибрано")]
    MissingAccount,
    #[error("signal-cli повернув некоректне короткочасне посилання прив’язки")]
    InvalidLinkUri,
    #[error("назва пов’язаного пристрою має містити 1–64 видимі символи")]
    InvalidDeviceName,
}

fn rpc_url(endpoint: &SignalDaemonEndpoint) -> Result<String, SignalDaemonError> {
    match endpoint {
        SignalDaemonEndpoint::Http { address } if address.ip().is_loopback() => {
            Ok(format!("http://{address}{SIGNAL_HTTP_RPC_PATH}"))
        }
        _ => Err(SignalDaemonError::UnsupportedTransport),
    }
}

async fn rpc(
    endpoint: &SignalDaemonEndpoint,
    method: &str,
    params: Option<Value>,
) -> Result<Value, SignalDaemonError> {
    rpc_with_timeout(endpoint, method, params, DISCOVERY_TIMEOUT).await
}

async fn rpc_with_timeout(
    endpoint: &SignalDaemonEndpoint,
    method: &str,
    params: Option<Value>,
    timeout: Duration,
) -> Result<Value, SignalDaemonError> {
    let url = rpc_url(endpoint)?;
    let client = Client::builder()
        .timeout(timeout)
        .redirect(Policy::none())
        .no_proxy()
        .build()
        .map_err(|_| SignalDaemonError::Connection)?;
    let id = REQUEST_ID.fetch_add(1, Ordering::Relaxed).to_string();
    let mut request = json!({ "jsonrpc": "2.0", "id": &id, "method": method });
    if let Some(params) = params {
        request["params"] = params;
    }
    let mut response = client
        .post(url)
        .json(&request)
        .send()
        .await
        .map_err(|_| SignalDaemonError::Connection)?;
    if !response.status().is_success() {
        return Err(SignalDaemonError::Connection);
    }
    if response
        .content_length()
        .is_some_and(|length| length > MAX_RPC_BYTES as u64)
    {
        return Err(SignalDaemonError::OversizedResponse);
    }
    let mut bytes = Vec::new();
    while let Some(chunk) = response
        .chunk()
        .await
        .map_err(|_| SignalDaemonError::Connection)?
    {
        if bytes.len().saturating_add(chunk.len()) > MAX_RPC_BYTES {
            return Err(SignalDaemonError::OversizedResponse);
        }
        bytes.extend_from_slice(&chunk);
    }
    let body: Value =
        serde_json::from_slice(&bytes).map_err(|_| SignalDaemonError::InvalidResponse)?;
    parse_rpc_result(&body, &id)
}

fn parse_rpc_result(body: &Value, expected_id: &str) -> Result<Value, SignalDaemonError> {
    if body.get("jsonrpc").and_then(Value::as_str) != Some("2.0")
        || body.get("id").and_then(Value::as_str) != Some(expected_id)
    {
        return Err(SignalDaemonError::InvalidResponse);
    }
    if let Some(error) = body.get("error") {
        let message = error
            .get("message")
            .and_then(Value::as_str)
            .unwrap_or("невідома помилка");
        // Never echo arbitrary daemon text into the desktop UI.
        let safe_message = if message.contains("Unknown account") {
            "обліковий запис не знайдено"
        } else {
            "перевірте локальний демон і його режим роботи"
        };
        return Err(SignalDaemonError::Rpc(safe_message.to_owned()));
    }
    body.get("result")
        .cloned()
        .ok_or(SignalDaemonError::InvalidResponse)
}

fn parse_accounts(result: Value) -> Result<Vec<SignalAccountSummary>, SignalDaemonError> {
    let accounts = result
        .as_array()
        .ok_or(SignalDaemonError::InvalidResponse)?;
    accounts
        .iter()
        .map(|account| {
            let number = account
                .get("number")
                .and_then(Value::as_str)
                .map(str::to_owned);
            let aci = account
                .get("aci")
                .and_then(Value::as_str)
                .map(str::to_owned);
            let id = number.as_ref().or(aci.as_ref()).filter(|id| !id.is_empty());
            Ok(SignalAccountSummary {
                id: id.ok_or(SignalDaemonError::InvalidResponse)?.clone(),
                number,
                aci,
            })
        })
        .collect()
}

fn parse_groups(result: Value) -> Result<Vec<SignalGroupSummary>, SignalDaemonError> {
    let groups = result
        .as_array()
        .ok_or(SignalDaemonError::InvalidResponse)?;
    groups
        .iter()
        .map(|group| {
            let id = group
                .get("id")
                .and_then(Value::as_str)
                .filter(|id| !id.is_empty())
                .ok_or(SignalDaemonError::InvalidResponse)?;
            let is_member = group
                .get("isMember")
                .and_then(Value::as_bool)
                .ok_or(SignalDaemonError::InvalidResponse)?;
            let is_blocked = group
                .get("isBlocked")
                .and_then(Value::as_bool)
                .ok_or(SignalDaemonError::InvalidResponse)?;
            Ok(SignalGroupSummary {
                id: id.to_owned(),
                name: group
                    .get("name")
                    .and_then(Value::as_str)
                    .unwrap_or("")
                    .to_owned(),
                is_member,
                is_blocked,
            })
        })
        .collect()
}

fn valid_link_uri(uri: &str) -> bool {
    uri.len() <= MAX_LINK_URI_BYTES
        && uri.starts_with("sgnl://linkdevice?")
        && uri.trim() == uri
        && !uri.chars().any(char::is_control)
}

fn valid_device_name(name: &str) -> bool {
    !name.is_empty()
        && name.trim() == name
        && name.chars().count() <= MAX_DEVICE_NAME_CHARS
        && !name.chars().any(char::is_control)
}

fn parse_link_start(result: Value) -> Result<SignalLinkStart, SignalDaemonError> {
    let uri = result
        .get("deviceLinkUri")
        .and_then(Value::as_str)
        .filter(|uri| valid_link_uri(uri))
        .ok_or(SignalDaemonError::InvalidLinkUri)?;
    Ok(SignalLinkStart {
        device_link_uri: uri.to_owned(),
    })
}

fn parse_linked_account(result: Value) -> Result<SignalAccountSummary, SignalDaemonError> {
    let number = result
        .get("number")
        .and_then(Value::as_str)
        .map(str::to_owned);
    let aci = result.get("aci").and_then(Value::as_str).map(str::to_owned);
    let id = number
        .as_ref()
        .or(aci.as_ref())
        .filter(|id| !id.is_empty())
        .ok_or(SignalDaemonError::InvalidResponse)?
        .clone();
    Ok(SignalAccountSummary { id, number, aci })
}

pub async fn discover_accounts(
    endpoint: &SignalDaemonEndpoint,
) -> Result<Vec<SignalAccountSummary>, SignalDaemonError> {
    parse_accounts(rpc(endpoint, "listAccounts", None).await?)
}

pub async fn discover_groups(
    endpoint: &SignalDaemonEndpoint,
    account: &str,
) -> Result<Vec<SignalGroupSummary>, SignalDaemonError> {
    if account.is_empty() || account.trim() != account || account.chars().any(char::is_control) {
        return Err(SignalDaemonError::MissingAccount);
    }
    parse_groups(rpc(endpoint, "listGroups", Some(json!({ "account": account }))).await?)
}

pub async fn start_link(
    endpoint: &SignalDaemonEndpoint,
) -> Result<SignalLinkStart, SignalDaemonError> {
    parse_link_start(rpc(endpoint, "startLink", None).await?)
}

pub async fn finish_link(
    endpoint: &SignalDaemonEndpoint,
    device_link_uri: &str,
    device_name: &str,
) -> Result<SignalAccountSummary, SignalDaemonError> {
    if !valid_link_uri(device_link_uri) {
        return Err(SignalDaemonError::InvalidLinkUri);
    }
    if !valid_device_name(device_name) {
        return Err(SignalDaemonError::InvalidDeviceName);
    }
    let result = rpc_with_timeout(
        endpoint,
        "finishLink",
        Some(json!({
            "deviceLinkUri": device_link_uri,
            "deviceName": device_name
        })),
        LINK_TIMEOUT,
    )
    .await?;
    parse_linked_account(result)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::{
        io::{Read, Write},
        net::{IpAddr, Ipv4Addr, SocketAddr, TcpListener},
        thread::JoinHandle,
    };

    fn synthetic_http_daemon(
        expected_method: &'static str,
        expected_account: Option<&'static str>,
        result: Value,
    ) -> (SignalDaemonEndpoint, JoinHandle<()>) {
        let listener = TcpListener::bind((Ipv4Addr::LOCALHOST, 0))
            .expect("synthetic loopback listener must bind");
        let address = listener.local_addr().expect("synthetic listener address");
        let handle = std::thread::spawn(move || {
            let (mut stream, _) = listener.accept().expect("synthetic request must arrive");
            stream
                .set_read_timeout(Some(Duration::from_secs(5)))
                .expect("synthetic read timeout");
            let mut bytes = Vec::new();
            let body_start;
            let content_length;
            loop {
                let mut chunk = [0_u8; 4096];
                let count = stream.read(&mut chunk).expect("synthetic request read");
                assert!(count > 0, "synthetic request ended before its body");
                bytes.extend_from_slice(&chunk[..count]);
                if let Some(header_end) = bytes.windows(4).position(|part| part == b"\r\n\r\n") {
                    let header = std::str::from_utf8(&bytes[..header_end])
                        .expect("synthetic HTTP header must be UTF-8");
                    let length = header
                        .lines()
                        .find_map(|line| {
                            line.split_once(':').and_then(|(key, value)| {
                                key.eq_ignore_ascii_case("content-length")
                                    .then(|| value.trim().parse::<usize>().ok())
                                    .flatten()
                            })
                        })
                        .expect("synthetic content length");
                    if bytes.len() >= header_end + 4 + length {
                        body_start = header_end + 4;
                        content_length = length;
                        break;
                    }
                }
            }
            let request: Value =
                serde_json::from_slice(&bytes[body_start..body_start + content_length])
                    .expect("synthetic request JSON");
            assert_eq!(request["jsonrpc"], "2.0");
            assert_eq!(request["method"], expected_method);
            if let Some(account) = expected_account {
                assert_eq!(request["params"]["account"], account);
            }
            let reply = json!({"jsonrpc":"2.0", "id":request["id"], "result":result}).to_string();
            let response = format!(
                "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
                reply.len(), reply
            );
            stream
                .write_all(response.as_bytes())
                .expect("synthetic HTTP reply");
        });
        (SignalDaemonEndpoint::Http { address }, handle)
    }

    #[test]
    fn accepts_only_http_loopback_for_discovery() {
        let local = SignalDaemonEndpoint::Http {
            address: SocketAddr::new(IpAddr::V4(Ipv4Addr::LOCALHOST), 8080),
        };
        assert_eq!(rpc_url(&local).unwrap(), "http://127.0.0.1:8080/api/v1/rpc");
        let remote = SignalDaemonEndpoint::Http {
            address: SocketAddr::new(IpAddr::V4(Ipv4Addr::new(192, 0, 2, 1)), 8080),
        };
        assert!(matches!(
            rpc_url(&remote),
            Err(SignalDaemonError::UnsupportedTransport)
        ));
    }

    #[test]
    fn parses_synthetic_account_and_group_results_without_side_effects() {
        let account_result = parse_rpc_result(
            &json!({
                "jsonrpc": "2.0", "id": "synthetic-request",
                "result": [{"number": null, "aci": "synthetic-aci"},
                           {"number": "+10000000000", "aci": "synthetic-other"}]
            }),
            "synthetic-request",
        )
        .unwrap();
        let accounts = parse_accounts(account_result).unwrap();
        assert_eq!(accounts[0].id, "synthetic-aci");
        assert_eq!(accounts[1].id, "+10000000000");

        let groups = parse_groups(json!([{
            "id": "synthetic-group", "name": "Навчальна група",
            "isMember": true, "isBlocked": false
        }]))
        .unwrap();
        assert_eq!(groups[0].id, "synthetic-group");
        assert!(groups[0].is_member);
    }

    #[test]
    fn rejects_mismatched_rpc_id_and_malformed_synthetic_data() {
        assert!(matches!(
            parse_rpc_result(
                &json!({"jsonrpc":"2.0", "id":"another", "result":[]}),
                "synthetic-request"
            ),
            Err(SignalDaemonError::InvalidResponse)
        ));
        assert!(matches!(
            parse_accounts(json!([{"number":null}])),
            Err(SignalDaemonError::InvalidResponse)
        ));
        assert!(matches!(
            parse_groups(json!([{"name":"no id"}])),
            Err(SignalDaemonError::InvalidResponse)
        ));
        assert!(matches!(
            parse_groups(json!([{"id":"synthetic-group", "isMember":true}])),
            Err(SignalDaemonError::InvalidResponse)
        ));
        assert!(matches!(
            parse_rpc_result(
                &json!({"jsonrpc":"2.0", "id":"synthetic-request", "error":{"message":"private synthetic data"}}),
                "synthetic-request"
            ),
            Err(SignalDaemonError::Rpc(message)) if !message.contains("private")
        ));
        assert!(matches!(
            parse_link_start(json!({"deviceLinkUri":"https://example.invalid/link"})),
            Err(SignalDaemonError::InvalidLinkUri)
        ));
        assert!(matches!(
            parse_linked_account(json!({"number":null, "aci":null})),
            Err(SignalDaemonError::InvalidResponse)
        ));
    }

    #[tokio::test]
    async fn explicit_http_discovery_uses_only_synthetic_loopback_rpc() {
        let (endpoint, server) = synthetic_http_daemon(
            "listAccounts",
            None,
            json!([{"number":null, "aci":"synthetic-account"}]),
        );
        let accounts = discover_accounts(&endpoint)
            .await
            .expect("synthetic account discovery");
        server.join().expect("synthetic account server");
        assert_eq!(accounts[0].id, "synthetic-account");

        let (endpoint, server) = synthetic_http_daemon(
            "listGroups",
            Some("synthetic-account"),
            json!([{"id":"synthetic-group", "name":"Навчальна група", "isMember":true, "isBlocked":false}]),
        );
        let groups = discover_groups(&endpoint, "synthetic-account")
            .await
            .expect("synthetic group discovery");
        server.join().expect("synthetic group server");
        assert_eq!(groups[0].name, "Навчальна група");
    }

    #[tokio::test]
    async fn linked_device_flow_uses_short_lived_uri_without_persisting_it() {
        let synthetic_uri = "sgnl://linkdevice?uuid=synthetic&pub_key=synthetic";
        let (endpoint, server) =
            synthetic_http_daemon("startLink", None, json!({"deviceLinkUri": synthetic_uri}));
        let link = start_link(&endpoint).await.expect("synthetic link start");
        server.join().expect("synthetic link start server");
        assert_eq!(link.device_link_uri, synthetic_uri);

        let listener = TcpListener::bind((Ipv4Addr::LOCALHOST, 0))
            .expect("synthetic finish listener must bind");
        let address = listener.local_addr().expect("synthetic finish address");
        let server = std::thread::spawn(move || {
            let (mut stream, _) = listener.accept().expect("synthetic finish request");
            stream
                .set_read_timeout(Some(Duration::from_secs(5)))
                .expect("synthetic finish timeout");
            let mut bytes = Vec::new();
            let request = loop {
                let mut chunk = [0_u8; 4096];
                let count = stream.read(&mut chunk).expect("synthetic finish read");
                assert!(count > 0, "synthetic finish request ended early");
                bytes.extend_from_slice(&chunk[..count]);
                if let Some(header_end) = bytes.windows(4).position(|part| part == b"\r\n\r\n") {
                    let header =
                        std::str::from_utf8(&bytes[..header_end]).expect("synthetic finish header");
                    let content_length = header
                        .lines()
                        .find_map(|line| {
                            line.split_once(':').and_then(|(key, value)| {
                                key.eq_ignore_ascii_case("content-length")
                                    .then(|| value.trim().parse::<usize>().ok())
                                    .flatten()
                            })
                        })
                        .expect("synthetic finish content length");
                    let body_start = header_end + 4;
                    if bytes.len() >= body_start + content_length {
                        break serde_json::from_slice::<Value>(
                            &bytes[body_start..body_start + content_length],
                        )
                        .expect("synthetic finish JSON");
                    }
                }
            };
            assert_eq!(request["method"], "finishLink");
            assert_eq!(request["params"]["deviceLinkUri"], synthetic_uri);
            assert_eq!(request["params"]["deviceName"], "EasyWAR синтетичний");
            let reply = json!({
                "jsonrpc":"2.0",
                "id":request["id"],
                "result":{"number":null, "aci":"synthetic-linked-account"}
            })
            .to_string();
            let response = format!(
                "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
                reply.len(), reply
            );
            stream
                .write_all(response.as_bytes())
                .expect("synthetic finish reply");
        });
        let endpoint = SignalDaemonEndpoint::Http { address };
        let account = finish_link(&endpoint, synthetic_uri, "EasyWAR синтетичний")
            .await
            .expect("synthetic link finish");
        server.join().expect("synthetic link finish server");
        assert_eq!(account.id, "synthetic-linked-account");
    }

    #[tokio::test]
    async fn linked_device_flow_rejects_untrusted_input_before_network() {
        let endpoint = SignalDaemonEndpoint::Http {
            address: SocketAddr::new(IpAddr::V4(Ipv4Addr::LOCALHOST), 9),
        };
        assert!(matches!(
            finish_link(&endpoint, "https://example.invalid/link", "EasyWAR").await,
            Err(SignalDaemonError::InvalidLinkUri)
        ));
        assert!(matches!(
            finish_link(
                &endpoint,
                "sgnl://linkdevice?uuid=synthetic&pub_key=synthetic",
                " "
            )
            .await,
            Err(SignalDaemonError::InvalidDeviceName)
        ));
    }
}
