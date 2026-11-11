//! Мережева обгортка сервера зустрічі (E8, обмін між містами; рішення JE від 30.10.2026
//! 09:30Z): HTTP-сервер навколо [`Rendezvous`] і клієнт для вузла EasyWAR.
//!
//! - **Сервер** запускається лише явно, окремим режимом застосунку
//!   (`easywar --relay-server <адреса:порт>`, див. `main.rs`): вікна, бази й профілів у цьому
//!   режимі немає, стан тримається в пам'яті. TLS — на зворотному проксі перед сервером
//!   (Caddy, nginx); сам сервер слухає звичайний HTTP.
//! - **Клієнт** ([`PairServer`]) ходить лише на `https://` (на `http://` — тільки loopback, для
//!   тестів) і лише коли `GatePolicy` дозволяє WAN. Зараз `GatePolicy::CURRENT` WAN не
//!   дозволяє, тож клієнт у застосунку не створюється, доки не пройде незалежний огляд безпеки.
//!
//! Протокол — `POST /v1/pair/<дія>`, тіло двійкове (`application/octet-stream`):
//!
//! | дія   | тіло запиту                     | відповідь 200                  |
//! |-------|---------------------------------|--------------------------------|
//! | open  | порожнє                         | скринька (1 байт) ‖ ключ (16)  |
//! | join  | скринька (1)                    | ключ (16)                      |
//! | post  | скринька ‖ ключ ‖ повідомлення  | порожнє                        |
//! | take  | скринька ‖ ключ                 | список повідомлень (var)       |
//! | close | скринька ‖ ключ                 | порожнє                        |
//!
//! Помилка — статус 4xx/5xx і короткий код у тілі (`rate-limited`, `no-such-slot`…).
//! Сервер не розбирає повідомлення: PAKE, теги й кадри для нього — непрозорі байти.
//!
//! **EasyWAR Relay** (етап 2б) вмикається лише з `--data <тека>` і хоча б одним
//! `--collective <відбиток колективу>/<відбиток засновника>`; стан — [`RelayNode`]. Протокол —
//! `POST /v1/relay/<дія>`, тіло — `колектив (16) ‖ підписаний запит`:
//!
//! | дія     | запит                 | відповідь 200                         |
//! |---------|-----------------------|---------------------------------------|
//! | node    | порожнє (без колективу) | відкритий ключ вузла (32)           |
//! | journal | `JournalRequest`      | номер останнього запису журналу (u64) |
//! | put     | `PutRequest`          | підписана квитанція `StoredReceipt`   |
//! | fetch   | `FetchRequest`        | сторінка `Page`                       |
//! | ack     | `AckRequest`          | `AckStatus` (1 байт)                  |
//!
//! Вміст пакетів вузол не читає: ключів епох у нього немає.

use std::net::SocketAddr;
use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use std::time::Duration;

use http_body_util::{BodyExt, Full, Limited};
use hyper::body::{Bytes, Incoming};
use hyper::server::conn::http1;
use hyper::service::service_fn;
use hyper::{Method, Request, Response, StatusCode};
use hyper_util::rt::TokioIo;
use tokio::net::TcpListener;

use crate::collective::codec::{Reader, Writer};
use crate::collective::epoch::CollectiveId;
use crate::collective::relay::{Page, MAX_CAPACITY_BYTES, MAX_ENVELOPE_BYTES};
use crate::collective::relay_auth::{
    AckRequest, AckStatus, FetchRequest, JournalRequest, PutRequest, StoredReceipt,
};
use crate::collective::relay_node::{HostedCollective, NodeDenied, RelayNode};
use crate::collective::rendezvous::{
    Rendezvous, RendezvousDenied, SlotToken, MAX_MESSAGE, MAX_QUEUED,
};
use crate::collective::send_gate::GatePolicy;
use crate::collective::{ID_LEN, KEY_LEN};

/// Найбільше тіло запиту: повідомлення плюс скринька й ключ.
pub const MAX_REQUEST_BODY: usize = MAX_MESSAGE + 1 + ID_LEN + 16;
/// Найбільше тіло запиту до Relay: конверт (чи журнал) плюс колектив і підпис.
pub const MAX_RELAY_BODY: usize = MAX_ENVELOPE_BYTES + 1024;
/// Скільки чекати тіло запиту.
const BODY_TIMEOUT: Duration = Duration::from_secs(20);
/// Час запиту клієнта.
const CLIENT_TIMEOUT: Duration = Duration::from_secs(20);
const USER_AGENT: &str = "EasyWAR";

fn now_unix() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|elapsed| elapsed.as_secs() as i64)
        .unwrap_or(0)
}

fn denied_code(denied: RendezvousDenied) -> &'static str {
    match denied {
        RendezvousDenied::Full => "full",
        RendezvousDenied::RateLimited => "rate-limited",
        RendezvousDenied::NoSuchSlot => "no-such-slot",
        RendezvousDenied::AlreadyJoined => "already-joined",
        RendezvousDenied::BadToken => "bad-token",
        RendezvousDenied::TooLarge => "too-large",
        RendezvousDenied::QueueFull => "queue-full",
    }
}

fn denied_from_code(code: &str) -> Option<RendezvousDenied> {
    [
        RendezvousDenied::Full,
        RendezvousDenied::RateLimited,
        RendezvousDenied::NoSuchSlot,
        RendezvousDenied::AlreadyJoined,
        RendezvousDenied::BadToken,
        RendezvousDenied::TooLarge,
        RendezvousDenied::QueueFull,
    ]
    .into_iter()
    .find(|denied| denied_code(*denied) == code)
}

fn denied_status(denied: RendezvousDenied) -> StatusCode {
    match denied {
        RendezvousDenied::Full | RendezvousDenied::QueueFull => StatusCode::SERVICE_UNAVAILABLE,
        RendezvousDenied::RateLimited => StatusCode::TOO_MANY_REQUESTS,
        RendezvousDenied::NoSuchSlot => StatusCode::NOT_FOUND,
        RendezvousDenied::AlreadyJoined => StatusCode::CONFLICT,
        RendezvousDenied::BadToken => StatusCode::FORBIDDEN,
        RendezvousDenied::TooLarge => StatusCode::PAYLOAD_TOO_LARGE,
    }
}

fn reply(status: StatusCode, body: Vec<u8>) -> Response<Full<Bytes>> {
    let mut response = Response::new(Full::new(Bytes::from(body)));
    *response.status_mut() = status;
    response
}

/// Обробити один запит на стані сервера (без мережі — для тестів і `serve`).
pub fn handle(
    state: &Mutex<Rendezvous>,
    action: &str,
    body: &[u8],
    now: i64,
) -> (StatusCode, Vec<u8>) {
    let result = (|| -> Result<Result<Vec<u8>, RendezvousDenied>, ()> {
        let mut server = state.lock().map_err(|_| ())?;
        let mut r = Reader::new(body);
        let outcome = match action {
            "open" => {
                r.finish().map_err(|_| ())?;
                server.open(now).map(|(slot, token)| {
                    let mut w = Writer::with_capacity(1 + ID_LEN);
                    w.u8(slot).fixed(&token);
                    w.finish()
                })
            }
            "join" => {
                let slot = r.u8().map_err(|_| ())?;
                r.finish().map_err(|_| ())?;
                server.join(slot, now).map(|token| token.to_vec())
            }
            "post" | "take" | "close" => {
                let slot = r.u8().map_err(|_| ())?;
                let token: SlotToken = r.fixed().map_err(|_| ())?;
                match action {
                    "post" => server.post(slot, &token, r.rest(), now).map(|_| Vec::new()),
                    "take" => {
                        r.finish().map_err(|_| ())?;
                        server.take(slot, &token, now).map(|messages| {
                            let mut w = Writer::with_capacity(
                                messages.iter().map(|m| m.len() + 4).sum::<usize>() + 4,
                            );
                            w.u32(messages.len() as u32);
                            for message in &messages {
                                w.var(message);
                            }
                            w.finish()
                        })
                    }
                    _ => {
                        r.finish().map_err(|_| ())?;
                        server.close(slot, &token, now).map(|_| Vec::new())
                    }
                }
            }
            _ => return Err(()),
        };
        Ok(outcome)
    })();
    match result {
        Ok(Ok(body)) => (StatusCode::OK, body),
        Ok(Err(denied)) => (
            denied_status(denied),
            denied_code(denied).as_bytes().to_vec(),
        ),
        Err(()) => (StatusCode::BAD_REQUEST, b"bad-request".to_vec()),
    }
}

fn node_status(denied: NodeDenied) -> StatusCode {
    use crate::collective::relay_auth::RelayDenied;
    match denied {
        NodeDenied::NotHosted => StatusCode::NOT_FOUND,
        NodeDenied::Malformed | NodeDenied::JournalInvalid => StatusCode::BAD_REQUEST,
        NodeDenied::JournalDiverged | NodeDenied::ConflictingEnvelope => StatusCode::CONFLICT,
        NodeDenied::Capacity => StatusCode::INSUFFICIENT_STORAGE,
        NodeDenied::InvalidExpiry => StatusCode::BAD_REQUEST,
        NodeDenied::Storage => StatusCode::INTERNAL_SERVER_ERROR,
        NodeDenied::Relay(RelayDenied::Busy) => StatusCode::SERVICE_UNAVAILABLE,
        NodeDenied::Relay(RelayDenied::InvalidEnvelope | RelayDenied::BadLimit) => {
            StatusCode::BAD_REQUEST
        }
        NodeDenied::NotFounder | NodeDenied::Relay(_) => StatusCode::FORBIDDEN,
    }
}

/// Обробити запит до Relay (без мережі — для тестів і `serve`).
pub fn handle_relay(
    node: &Mutex<RelayNode>,
    action: &str,
    body: &[u8],
    now: i64,
) -> (StatusCode, Vec<u8>) {
    let Ok(mut node) = node.lock() else {
        return (StatusCode::INTERNAL_SERVER_ERROR, b"storage".to_vec());
    };
    match node.handle(action, body, now) {
        Ok(body) => (StatusCode::OK, body),
        Err(denied) => (node_status(denied), denied.code().as_bytes().to_vec()),
    }
}

/// Стан сервера: зустріч завжди, Relay — лише якщо оператор його налаштував.
struct Hub {
    pair: Mutex<Rendezvous>,
    relay: Option<Arc<Mutex<RelayNode>>>,
}

async fn respond(
    hub: Arc<Hub>,
    request: Request<Incoming>,
) -> Result<Response<Full<Bytes>>, std::convert::Infallible> {
    let path = request.uri().path().to_owned();
    let route = match (
        path.strip_prefix("/v1/pair/"),
        path.strip_prefix("/v1/relay/"),
    ) {
        (Some(action), _) => Some((false, action.to_owned(), MAX_REQUEST_BODY)),
        (_, Some(action)) if hub.relay.is_some() => Some((true, action.to_owned(), MAX_RELAY_BODY)),
        _ => None,
    };
    let (Some((relay, action, limit)), true) = (route, request.method() == Method::POST) else {
        return Ok(reply(StatusCode::NOT_FOUND, b"not-found".to_vec()));
    };
    let body = Limited::new(request.into_body(), limit);
    let body = match tokio::time::timeout(BODY_TIMEOUT, body.collect()).await {
        Ok(Ok(collected)) => collected.to_bytes(),
        Ok(Err(_)) => return Ok(reply(StatusCode::PAYLOAD_TOO_LARGE, b"too-large".to_vec())),
        Err(_) => return Ok(reply(StatusCode::REQUEST_TIMEOUT, b"timeout".to_vec())),
    };
    let (status, body) = match (relay, hub.relay.clone()) {
        // Черга пише знімок на диск: не тримати потік рушія.
        (true, Some(node)) => {
            tokio::task::spawn_blocking(move || handle_relay(&node, &action, &body, now_unix()))
                .await
                .unwrap_or((StatusCode::INTERNAL_SERVER_ERROR, b"storage".to_vec()))
        }
        _ => handle(&hub.pair, &action, &body, now_unix()),
    };
    Ok(reply(status, body))
}

/// Слухати `listener` і обслуговувати сервер зустрічі (і Relay, якщо `relay` задано), доки не
/// завершиться `shutdown`.
pub async fn serve(
    listener: TcpListener,
    relay: Option<RelayNode>,
    shutdown: impl std::future::Future<Output = ()>,
) -> std::io::Result<()> {
    let state = Arc::new(Hub {
        pair: Mutex::new(Rendezvous::new()),
        relay: relay.map(|node| Arc::new(Mutex::new(node))),
    });
    tokio::pin!(shutdown);
    loop {
        let (stream, _) = tokio::select! {
            accepted = listener.accept() => accepted?,
            () = &mut shutdown => return Ok(()),
        };
        let state = state.clone();
        tokio::spawn(async move {
            let service = service_fn(move |request| respond(state.clone(), request));
            let _ = http1::Builder::new()
                .serve_connection(TokioIo::new(stream), service)
                .await;
        });
    }
}

/// Параметри режиму сервера з командного рядка.
#[derive(Debug, Default, Eq, PartialEq)]
pub struct ServerOptions {
    pub address: String,
    pub data_dir: Option<PathBuf>,
    pub collectives: Vec<HostedCollective>,
}

impl ServerOptions {
    /// `[адреса:порт] [--data <тека>] [--collective <XXXXX-XXXXX/YYYYY-YYYYY>]…`
    pub fn parse(args: &[String]) -> Result<Self, String> {
        let mut options = Self {
            address: "127.0.0.1:7443".to_owned(),
            ..Self::default()
        };
        let mut args = args.iter();
        let mut first = true;
        while let Some(arg) = args.next() {
            match arg.as_str() {
                "--data" => {
                    let dir = args.next().ok_or("після --data потрібна тека")?;
                    options.data_dir = Some(PathBuf::from(dir));
                }
                "--collective" => {
                    let text = args.next().ok_or("після --collective потрібні відбитки")?;
                    options.collectives.push(HostedCollective::parse(text)?);
                }
                other if first && !other.starts_with("--") => options.address = other.to_owned(),
                other => return Err(format!("невідомий параметр «{other}»")),
            }
            first = false;
        }
        if options.collectives.is_empty() != options.data_dir.is_none() {
            return Err("для Relay потрібні разом --data і хоча б один --collective".to_owned());
        }
        Ok(options)
    }
}

/// Режим `easywar --relay-server …`: окремий процес без вікна.
pub fn run_server_blocking(options: ServerOptions) -> Result<(), String> {
    let address = options.address.as_str();
    let address: SocketAddr = address
        .parse()
        .map_err(|_| format!("адреса «{address}» не розбирається, приклад: 127.0.0.1:7443"))?;
    let relay = match &options.data_dir {
        Some(dir) => {
            let capacity = MAX_CAPACITY_BYTES / options.collectives.len();
            Some(RelayNode::open(dir, options.collectives.clone(), capacity)?)
        }
        None => None,
    };
    if let Some(node) = &relay {
        eprintln!(
            "EasyWAR Relay: колективів у списку {}, відбиток ключа вузла {}",
            options.collectives.len(),
            crate::collective_store::fingerprint(&node.node_public())
        );
    }
    let runtime = tokio::runtime::Builder::new_current_thread()
        .enable_all()
        .build()
        .map_err(|error| error.to_string())?;
    runtime.block_on(async move {
        let listener = TcpListener::bind(address)
            .await
            .map_err(|error| format!("не вдалося слухати {address}: {error}"))?;
        eprintln!(
            "EasyWAR: сервер зустрічі слухає http://{address} (TLS — на зворотному проксі); Ctrl+C — зупинити"
        );
        serve(listener, relay, async {
            let _ = tokio::signal::ctrl_c().await;
        })
        .await
        .map_err(|error| error.to_string())
    })
}

/// Помилка клієнта сервера зустрічі.
#[derive(Debug, Eq, PartialEq)]
pub enum PairClientError {
    /// WAN не дозволений `GatePolicy`.
    WanDisabled,
    /// Адреса не `https://` (або не loopback для `http://`).
    InsecureAddress,
    /// Немає зв'язку або сервер не відповів.
    Unreachable,
    /// Сервер відмовив.
    Denied(RendezvousDenied),
    /// Відповідь не розбирається.
    BadResponse,
}

impl PairClientError {
    pub fn message(&self) -> &'static str {
        match self {
            PairClientError::WanDisabled => "обмін через інтернет вимкнено",
            PairClientError::InsecureAddress => "дозволено лише захищене з'єднання (https)",
            PairClientError::Unreachable => "немає зв'язку із сервером зустрічі",
            PairClientError::Denied(denied) => denied.message(),
            PairClientError::BadResponse => "сервер зустрічі відповів незрозуміло",
        }
    }
}

/// Спільна перевірка адреси й дозволу WAN для клієнтів сервера зустрічі й Relay.
fn http_client(
    base: &str,
    policy: &GatePolicy,
) -> Result<(reqwest::Url, reqwest::Client), PairClientError> {
    if !policy.wan_transport_accepted {
        return Err(PairClientError::WanDisabled);
    }
    let base = reqwest::Url::parse(base).map_err(|_| PairClientError::InsecureAddress)?;
    let loopback = matches!(base.host_str(), Some("127.0.0.1" | "localhost" | "[::1]"));
    match base.scheme() {
        "https" => {}
        "http" if loopback => {}
        _ => return Err(PairClientError::InsecureAddress),
    }
    crate::install_tls_provider();
    let client = reqwest::Client::builder()
        .timeout(CLIENT_TIMEOUT)
        .user_agent(USER_AGENT)
        .redirect(reqwest::redirect::Policy::none())
        .build()
        .map_err(|_| PairClientError::Unreachable)?;
    Ok((base, client))
}

/// Клієнт сервера зустрічі.
pub struct PairServer {
    base: reqwest::Url,
    client: reqwest::Client,
}

impl PairServer {
    /// Клієнт для `base` (`https://…/`). Без дозволу WAN у `policy` — [`PairClientError::WanDisabled`].
    pub fn new(base: &str, policy: &GatePolicy) -> Result<Self, PairClientError> {
        let (base, client) = http_client(base, policy)?;
        Ok(Self { base, client })
    }

    async fn call(&self, action: &str, body: Vec<u8>) -> Result<Vec<u8>, PairClientError> {
        let url = self
            .base
            .join(&format!("v1/pair/{action}"))
            .map_err(|_| PairClientError::InsecureAddress)?;
        let response = self
            .client
            .post(url)
            .header("content-type", "application/octet-stream")
            .body(body)
            .send()
            .await
            .map_err(|_| PairClientError::Unreachable)?;
        let status = response.status();
        let bytes = response
            .bytes()
            .await
            .map_err(|_| PairClientError::Unreachable)?;
        if bytes.len() > MAX_QUEUED * (MAX_MESSAGE + 4) + 4 {
            return Err(PairClientError::BadResponse);
        }
        if status.is_success() {
            return Ok(bytes.to_vec());
        }
        let code = std::str::from_utf8(&bytes).unwrap_or_default();
        Err(denied_from_code(code)
            .map(PairClientError::Denied)
            .unwrap_or(PairClientError::BadResponse))
    }

    pub async fn open(&self) -> Result<(u8, SlotToken), PairClientError> {
        let body = self.call("open", Vec::new()).await?;
        let mut r = Reader::new(&body);
        let slot = r.u8().map_err(|_| PairClientError::BadResponse)?;
        let token = r.fixed().map_err(|_| PairClientError::BadResponse)?;
        r.finish().map_err(|_| PairClientError::BadResponse)?;
        Ok((slot, token))
    }

    pub async fn join(&self, slot: u8) -> Result<SlotToken, PairClientError> {
        let body = self.call("join", vec![slot]).await?;
        body.as_slice()
            .try_into()
            .map_err(|_| PairClientError::BadResponse)
    }

    fn addressed(slot: u8, token: &SlotToken, rest: &[u8]) -> Vec<u8> {
        let mut w = Writer::with_capacity(1 + ID_LEN + rest.len());
        w.u8(slot).fixed(token).fixed(rest);
        w.finish()
    }

    pub async fn post(
        &self,
        slot: u8,
        token: &SlotToken,
        message: &[u8],
    ) -> Result<(), PairClientError> {
        self.call("post", Self::addressed(slot, token, message))
            .await
            .map(|_| ())
    }

    pub async fn take(&self, slot: u8, token: &SlotToken) -> Result<Vec<Vec<u8>>, PairClientError> {
        let body = self.call("take", Self::addressed(slot, token, &[])).await?;
        let mut r = Reader::new(&body);
        let count = r.u32().map_err(|_| PairClientError::BadResponse)? as usize;
        if count > MAX_QUEUED {
            return Err(PairClientError::BadResponse);
        }
        let mut messages = Vec::with_capacity(count);
        for _ in 0..count {
            messages.push(r.var().map_err(|_| PairClientError::BadResponse)?.to_vec());
        }
        r.finish().map_err(|_| PairClientError::BadResponse)?;
        Ok(messages)
    }

    pub async fn close(&self, slot: u8, token: &SlotToken) -> Result<(), PairClientError> {
        self.call("close", Self::addressed(slot, token, &[]))
            .await
            .map(|_| ())
    }

    /// Чекати наступне повідомлення (опитування раз на `interval`), не довше за `deadline`.
    pub async fn next(
        &self,
        slot: u8,
        token: &SlotToken,
        inbox: &mut std::collections::VecDeque<Vec<u8>>,
        interval: Duration,
        deadline: tokio::time::Instant,
    ) -> Result<Vec<u8>, PairClientError> {
        loop {
            if let Some(message) = inbox.pop_front() {
                return Ok(message);
            }
            inbox.extend(self.take(slot, token).await?);
            if !inbox.is_empty() {
                continue;
            }
            if tokio::time::Instant::now() + interval > deadline {
                return Err(PairClientError::Denied(RendezvousDenied::NoSuchSlot));
            }
            tokio::time::sleep(interval).await;
        }
    }
}

/// Помилка клієнта Relay.
#[derive(Debug, Eq, PartialEq)]
pub enum RelayClientError {
    /// Адреса, дозвіл WAN або зв'язок — як у сервера зустрічі.
    Connection(PairClientError),
    /// Вузол відмовив.
    Denied(NodeDenied),
}

impl RelayClientError {
    pub fn message(&self) -> &'static str {
        match self {
            RelayClientError::Connection(PairClientError::Unreachable) => {
                "немає зв'язку з EasyWAR Relay"
            }
            RelayClientError::Connection(PairClientError::BadResponse) => {
                "EasyWAR Relay відповів незрозуміло"
            }
            RelayClientError::Connection(error) => error.message(),
            RelayClientError::Denied(denied) => denied.message(),
        }
    }
}

impl From<PairClientError> for RelayClientError {
    fn from(error: PairClientError) -> Self {
        RelayClientError::Connection(error)
    }
}

const BAD_RESPONSE: RelayClientError = RelayClientError::Connection(PairClientError::BadResponse);

/// Клієнт EasyWAR Relay для одного колективу. Квитанцію `STORED` перевіряє викликач ключем
/// вузла, якому довіряє ([`StoredReceipt::verify`]); ключ, який вузол називає сам
/// ([`RelayClient::node_key`]), треба звірити з оператором, а не приймати на віру.
pub struct RelayClient {
    base: reqwest::Url,
    client: reqwest::Client,
    collective_id: CollectiveId,
}

impl RelayClient {
    pub fn new(
        base: &str,
        policy: &GatePolicy,
        collective_id: CollectiveId,
    ) -> Result<Self, RelayClientError> {
        let (base, client) = http_client(base, policy)?;
        Ok(Self {
            base,
            client,
            collective_id,
        })
    }

    async fn call(
        &self,
        action: &str,
        request: Option<Vec<u8>>,
    ) -> Result<Vec<u8>, RelayClientError> {
        let url = self
            .base
            .join(&format!("v1/relay/{action}"))
            .map_err(|_| PairClientError::InsecureAddress)?;
        let body = match request {
            Some(request) => [self.collective_id.as_slice(), &request].concat(),
            None => Vec::new(),
        };
        let response = self
            .client
            .post(url)
            .header("content-type", "application/octet-stream")
            .body(body)
            .send()
            .await
            .map_err(|_| PairClientError::Unreachable)?;
        let status = response.status();
        let bytes = response
            .bytes()
            .await
            .map_err(|_| PairClientError::Unreachable)?;
        if bytes.len() > 101 * (MAX_ENVELOPE_BYTES + 4) {
            return Err(BAD_RESPONSE);
        }
        if status.is_success() {
            return Ok(bytes.to_vec());
        }
        let code = std::str::from_utf8(&bytes).unwrap_or_default();
        Err(NodeDenied::from_code(code)
            .map(RelayClientError::Denied)
            .unwrap_or(BAD_RESPONSE))
    }

    /// Ключ, яким вузол підписує квитанції (звірити відбиток з оператором).
    pub async fn node_key(&self) -> Result<[u8; KEY_LEN], RelayClientError> {
        let body = self.call("node", None).await?;
        body.as_slice().try_into().map_err(|_| BAD_RESPONSE)
    }

    /// Передати журнал складу; відповідь — останній запис, відомий вузлу.
    pub async fn journal(&self, request: &JournalRequest) -> Result<u64, RelayClientError> {
        let body = self.call("journal", Some(request.to_bytes())).await?;
        let bytes: [u8; 8] = body.as_slice().try_into().map_err(|_| BAD_RESPONSE)?;
        Ok(u64::from_be_bytes(bytes))
    }

    pub async fn put(&self, request: &PutRequest) -> Result<StoredReceipt, RelayClientError> {
        let body = self.call("put", Some(request.to_bytes())).await?;
        StoredReceipt::from_bytes(&body).map_err(|_| BAD_RESPONSE)
    }

    pub async fn fetch(&self, request: &FetchRequest) -> Result<Page, RelayClientError> {
        let body = self.call("fetch", Some(request.to_bytes())).await?;
        Page::from_bytes(&body).map_err(|_| BAD_RESPONSE)
    }

    pub async fn ack(&self, request: &AckRequest) -> Result<AckStatus, RelayClientError> {
        let body = self.call("ack", Some(request.to_bytes())).await?;
        match body.as_slice() {
            [code] => AckStatus::from_code(*code).ok_or(BAD_RESPONSE),
            _ => Err(BAD_RESPONSE),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::collective::pairing::{PairCode, PairStart, Role};
    use std::collections::VecDeque;

    const OPEN: GatePolicy = GatePolicy {
        wan_transport_accepted: true,
        base44_accepted: false,
    };

    #[test]
    fn client_refuses_without_wan_permission_or_tls() {
        assert_eq!(
            PairServer::new("https://relay.example/", &GatePolicy::CURRENT).err(),
            Some(PairClientError::WanDisabled)
        );
        assert_eq!(
            PairServer::new("http://relay.example/", &OPEN).err(),
            Some(PairClientError::InsecureAddress)
        );
        assert!(PairServer::new("https://relay.example/", &OPEN).is_ok());
        assert!(PairServer::new("http://127.0.0.1:7443/", &OPEN).is_ok());
    }

    fn args(text: &str) -> Vec<String> {
        text.split_whitespace().map(str::to_owned).collect()
    }

    #[test]
    fn server_options_need_data_and_collectives_together() {
        let options = ServerOptions::parse(&args("0.0.0.0:9000")).unwrap();
        assert_eq!(options.address, "0.0.0.0:9000");
        assert!(options.data_dir.is_none() && options.collectives.is_empty());
        let options = ServerOptions::parse(&args(
            "--data /srv/relay --collective MZXW6-YTBOI/MZXW6-YTBOJ --collective mzxw6-ytboa/mzxw6-ytbob",
        ))
        .unwrap();
        assert_eq!(options.address, "127.0.0.1:7443");
        assert_eq!(options.data_dir, Some(PathBuf::from("/srv/relay")));
        assert_eq!(options.collectives.len(), 2);
        for bad in [
            "--data /srv/relay",
            "--collective MZXW6-YTBOI/MZXW6-YTBOJ",
            "--data",
            "--collective bad --data /x",
            "--port 1",
            "127.0.0.1:1 127.0.0.1:2",
        ] {
            assert!(ServerOptions::parse(&args(bad)).is_err(), "{bad}");
        }
    }

    #[test]
    fn handler_rejects_garbage_and_unknown_actions() {
        let state = Mutex::new(Rendezvous::new());
        assert_eq!(handle(&state, "open", b"x", 0).0, StatusCode::BAD_REQUEST);
        assert_eq!(handle(&state, "join", b"", 0).0, StatusCode::BAD_REQUEST);
        assert_eq!(handle(&state, "drop", b"", 0).0, StatusCode::BAD_REQUEST);
        assert_eq!(
            handle(&state, "post", &[1, 2, 3], 0).0,
            StatusCode::BAD_REQUEST
        );
        let (status, body) = handle(&state, "join", &[7], 0);
        assert_eq!(
            (status, body.as_slice()),
            (StatusCode::NOT_FOUND, b"no-such-slot".as_slice())
        );
        for denied in [
            RendezvousDenied::Full,
            RendezvousDenied::RateLimited,
            RendezvousDenied::NoSuchSlot,
            RendezvousDenied::AlreadyJoined,
            RendezvousDenied::BadToken,
            RendezvousDenied::TooLarge,
            RendezvousDenied::QueueFull,
        ] {
            assert_eq!(denied_from_code(denied_code(denied)), Some(denied));
        }
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn two_nodes_pair_over_http_on_loopback() {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let base = format!("http://{}/", listener.local_addr().unwrap());
        let (stop, stopped) = tokio::sync::oneshot::channel::<()>();
        let server = tokio::spawn(serve(listener, None, async {
            let _ = stopped.await;
        }));
        let host_api = PairServer::new(&base, &OPEN).unwrap();
        let guest_api = PairServer::new(&base, &OPEN).unwrap();
        let tick = Duration::from_millis(20);
        let deadline = tokio::time::Instant::now() + Duration::from_secs(10);

        let (slot, host_token) = host_api.open().await.unwrap();
        let code = PairCode::generate(slot).unwrap();
        let dictated = PairCode::parse(&code.display()).unwrap();

        let host_side = async {
            let mut inbox = VecDeque::new();
            let (start, message) = PairStart::begin(Role::Host, &code);
            host_api.post(slot, &host_token, &message).await.unwrap();
            let peer = host_api
                .next(slot, &host_token, &mut inbox, tick, deadline)
                .await
                .unwrap();
            let keys = start.finish(&peer).unwrap();
            host_api
                .post(slot, &host_token, &keys.confirmation())
                .await
                .unwrap();
            let tag = host_api
                .next(slot, &host_token, &mut inbox, tick, deadline)
                .await
                .unwrap();
            let mut channel = keys.verify(&tag).unwrap();
            let frame = channel.seal(b"EWINV1 synthetic").unwrap();
            host_api.post(slot, &host_token, &frame).await.unwrap();
            let frame = host_api
                .next(slot, &host_token, &mut inbox, tick, deadline)
                .await
                .unwrap();
            let reply = channel.open(&frame).unwrap();
            host_api.close(slot, &host_token).await.unwrap();
            reply
        };
        let guest_side = async {
            let token = guest_api.join(dictated.slot()).await.unwrap();
            let mut inbox = VecDeque::new();
            let (start, message) = PairStart::begin(Role::Guest, &dictated);
            guest_api
                .post(dictated.slot(), &token, &message)
                .await
                .unwrap();
            let peer = guest_api
                .next(dictated.slot(), &token, &mut inbox, tick, deadline)
                .await
                .unwrap();
            let keys = start.finish(&peer).unwrap();
            guest_api
                .post(dictated.slot(), &token, &keys.confirmation())
                .await
                .unwrap();
            let tag = guest_api
                .next(dictated.slot(), &token, &mut inbox, tick, deadline)
                .await
                .unwrap();
            let mut channel = keys.verify(&tag).unwrap();
            let frame = guest_api
                .next(dictated.slot(), &token, &mut inbox, tick, deadline)
                .await
                .unwrap();
            let invitation = channel.open(&frame).unwrap();
            let reply = channel.seal(b"EWJOIN1 synthetic").unwrap();
            guest_api
                .post(dictated.slot(), &token, &reply)
                .await
                .unwrap();
            invitation
        };
        let (host_got, guest_got) = tokio::join!(host_side, guest_side);
        assert_eq!(guest_got, b"EWINV1 synthetic");
        assert_eq!(host_got, b"EWJOIN1 synthetic");
        // Скриньку закрито: другий вступ за тим самим кодом неможливий.
        assert_eq!(
            guest_api.join(slot).await.err(),
            Some(PairClientError::Denied(RendezvousDenied::NoSuchSlot))
        );
        let _ = stop.send(());
        server.await.unwrap().unwrap();
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn two_members_exchange_a_sealed_package_through_the_relay_on_loopback() {
        use crate::collective::envelope::{sample_payload, seal, EnvelopeHeader};
        use crate::collective::epoch::EpochKey;
        use crate::collective::identity::{DeviceIdentity, MemberIdentity};
        use crate::collective::random_array;
        use crate::collective::relay_auth::member_scope;
        use crate::collective::replay::{InMemoryMembership, MembershipRecord, MembershipView};
        use crate::collective_store::fingerprint;

        let now = now_unix();
        let collective: CollectiveId = random_array();
        let mut membership = InMemoryMembership::new(collective);
        let founder = (MemberIdentity::generate(), DeviceIdentity::generate());
        let colleague = (MemberIdentity::generate(), DeviceIdentity::generate());
        for (member, device) in [&founder, &colleague] {
            membership
                .join(&member.bind_exchange(collective, now - 60))
                .unwrap();
            membership
                .add_device(&member.issue_device(&device.public(), now - 60))
                .unwrap();
        }
        let records: Vec<_> = membership
            .records()
            .iter()
            .map(MembershipRecord::to_bytes)
            .collect();

        let dir = tempfile::tempdir().unwrap();
        let hosted = HostedCollective {
            collective: fingerprint(&collective),
            founder: fingerprint(&founder.0.member_id()),
        };
        let node = RelayNode::open(dir.path(), vec![hosted], 1 << 20).unwrap();
        let trusted = node.node_public();
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let base = format!("http://{}/", listener.local_addr().unwrap());
        let (stop, stopped) = tokio::sync::oneshot::channel::<()>();
        let server = tokio::spawn(serve(listener, Some(node), async {
            let _ = stopped.await;
        }));

        let api = RelayClient::new(&base, &OPEN, collective).unwrap();
        assert!(RelayClient::new(&base, &GatePolicy::CURRENT, collective).is_err());
        assert_eq!(api.node_key().await.unwrap(), trusted);
        // «Вінниця»: засновник приносить журнал і кладе пакет для колеги.
        let journal =
            JournalRequest::sign(&collective, founder.0.member_id(), &founder.1, records, now);
        assert_eq!(
            api.journal(&journal).await.unwrap(),
            membership.latest_seq()
        );
        let scope = member_scope(&collective, &colleague.0.member_id());
        let mut payload =
            sample_payload(&founder.1, founder.0.member_id(), membership.latest_seq());
        payload.op_id = random_array();
        let envelope = seal(
            &EpochKey::generate(),
            EnvelopeHeader::new(collective, 0, scope),
            &payload.sign(&founder.1),
        )
        .to_bytes();
        let put = PutRequest::sign(
            &collective,
            founder.0.member_id(),
            &founder.1,
            envelope.clone(),
            now + 3600,
            now,
        );
        let receipt = api.put(&put).await.unwrap();
        receipt.verify(&trusted, &envelope).unwrap();
        // Повтор того самого запиту відхиляється.
        assert_eq!(
            api.put(&put).await.err(),
            Some(RelayClientError::Denied(NodeDenied::Relay(
                crate::collective::relay_auth::RelayDenied::Replay
            )))
        );

        // «Дніпро»: колега забирає пакет і підтверджує.
        let fetch = FetchRequest::sign(
            &collective,
            colleague.0.member_id(),
            &colleague.1,
            scope,
            0,
            10,
            now,
        );
        let page = api.fetch(&fetch).await.unwrap();
        assert_eq!(page.envelopes, vec![envelope.clone()]);
        let ack = AckRequest::sign(
            &collective,
            colleague.0.member_id(),
            &colleague.1,
            &envelope,
            now,
        )
        .unwrap();
        assert_eq!(api.ack(&ack).await.unwrap(), AckStatus::Removed);

        // Колектив поза списком.
        let other = RelayClient::new(&base, &OPEN, random_array()).unwrap();
        let fetch = FetchRequest::sign(
            &collective,
            colleague.0.member_id(),
            &colleague.1,
            scope,
            0,
            10,
            now,
        );
        assert_eq!(
            other.fetch(&fetch).await.err(),
            Some(RelayClientError::Denied(NodeDenied::NotHosted))
        );
        let _ = stop.send(());
        server.await.unwrap().unwrap();
    }

    #[test]
    fn relay_routes_are_absent_without_configuration() {
        let runtime = tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .unwrap();
        runtime.block_on(async {
            let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
            let base = format!("http://{}/", listener.local_addr().unwrap());
            let (stop, stopped) = tokio::sync::oneshot::channel::<()>();
            let server = tokio::spawn(serve(listener, None, async {
                let _ = stopped.await;
            }));
            let api = RelayClient::new(&base, &OPEN, [1; ID_LEN]).unwrap();
            assert_eq!(api.node_key().await.err(), Some(BAD_RESPONSE));
            let _ = stop.send(());
            server.await.unwrap().unwrap();
        });
    }
}
