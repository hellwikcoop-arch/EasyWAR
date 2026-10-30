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

use std::net::SocketAddr;
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
use crate::collective::rendezvous::{
    Rendezvous, RendezvousDenied, SlotToken, MAX_MESSAGE, MAX_QUEUED,
};
use crate::collective::send_gate::GatePolicy;
use crate::collective::ID_LEN;

/// Найбільше тіло запиту: повідомлення плюс скринька й ключ.
pub const MAX_REQUEST_BODY: usize = MAX_MESSAGE + 1 + ID_LEN + 16;
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

async fn respond(
    state: Arc<Mutex<Rendezvous>>,
    request: Request<Incoming>,
) -> Result<Response<Full<Bytes>>, std::convert::Infallible> {
    let action = request
        .uri()
        .path()
        .strip_prefix("/v1/pair/")
        .map(str::to_owned);
    let (Some(action), true) = (action, request.method() == Method::POST) else {
        return Ok(reply(StatusCode::NOT_FOUND, b"not-found".to_vec()));
    };
    let body = Limited::new(request.into_body(), MAX_REQUEST_BODY);
    let body = match tokio::time::timeout(BODY_TIMEOUT, body.collect()).await {
        Ok(Ok(collected)) => collected.to_bytes(),
        Ok(Err(_)) => return Ok(reply(StatusCode::PAYLOAD_TOO_LARGE, b"too-large".to_vec())),
        Err(_) => return Ok(reply(StatusCode::REQUEST_TIMEOUT, b"timeout".to_vec())),
    };
    let (status, body) = handle(&state, &action, &body, now_unix());
    Ok(reply(status, body))
}

/// Слухати `listener` і обслуговувати сервер зустрічі, доки не завершиться `shutdown`.
pub async fn serve(
    listener: TcpListener,
    shutdown: impl std::future::Future<Output = ()>,
) -> std::io::Result<()> {
    let state = Arc::new(Mutex::new(Rendezvous::new()));
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

/// Режим `easywar --relay-server <адреса:порт>`: окремий процес без вікна.
pub fn run_server_blocking(address: &str) -> Result<(), String> {
    let address: SocketAddr = address
        .parse()
        .map_err(|_| format!("адреса «{address}» не розбирається, приклад: 127.0.0.1:7443"))?;
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
        serve(listener, async {
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

/// Клієнт сервера зустрічі.
pub struct PairServer {
    base: reqwest::Url,
    client: reqwest::Client,
}

impl PairServer {
    /// Клієнт для `base` (`https://…/`). Без дозволу WAN у `policy` — [`PairClientError::WanDisabled`].
    pub fn new(base: &str, policy: &GatePolicy) -> Result<Self, PairClientError> {
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
        let server = tokio::spawn(serve(listener, async {
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
}
