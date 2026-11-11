//! Сеанс вступу за кодом (E8, обмін між містами, етап 3а): послідовність «код → канал →
//! запрошення → заявка → контрольний номер → ключі» поверх сервера зустрічі. Без Tauri і бази:
//! дії з профілем виконують [`HostSide`] і [`GuestSide`], тож сеанс перевіряється на localhost.
//!
//! Після відкриття захищеного каналу (PAKE + підтвердження ключа) по ньому йдуть наявні тексти
//! `EWINV1` / `EWJOIN1` / `EWKEYS1` з `collective_sync.rs`; формат вступу не змінюється, лише
//! спосіб доставки. Кадри: тег (1 байт) ‖ UTF-8 текст.
//!
//! 1. запрошувач → гість: запрошення (1);
//! 2. гість → запрошувач: заявка (2);
//! 3. обидва бачать контрольний номер із ключів каналу й ідентифікаторів сторін; людина
//!    звіряє його голосом. Гість шле вердикт (3: так/ні), запрошувач — (5), якщо відмовляє;
//! 4. запрошувач впускає гостя й шле пакет ключів (4).
//!
//! Жодних ключів колективу до збігу номера й згоди запрошувача. Скриньку після успіху закриває гість, після відмови вона спливає
//! за строком коду (10 хв): сторона, що закрила б її першою, не дала б другій прочитати відмову.

use std::collections::VecDeque;
use std::time::Duration;

use crate::collective::identity::MemberId;
use crate::collective::pairing::{PairChannel, PairCode, PairStart, Role};
use crate::collective::rendezvous::{RendezvousDenied, SlotToken};
use crate::pair_relay::{PairClientError, PairServer};

const INVITATION: u8 = 1;
const REQUEST: u8 = 2;
const VERDICT: u8 = 3;
const KEYS: u8 = 4;
const REJECTED: u8 = 5;

/// Чим закінчився сеанс.
#[derive(Debug, Eq, PartialEq)]
pub enum PairSessionError {
    /// Сервер зустрічі недосяжний чи відмовив.
    Server(PairClientError),
    /// Код не збігся або кадр пошкоджено: канал не відкрито.
    Crypto,
    /// Інша сторона надіслала не те, що очікувалось.
    Protocol,
    /// Контрольний номер не підтверджено однією зі сторін.
    Rejected,
    /// Не дочекалися відповіді в межах строку коду.
    Timeout,
    /// Помилка дії з профілем (текст для користувача).
    Side(String),
}

impl PairSessionError {
    pub fn message(&self) -> String {
        match self {
            PairSessionError::Server(error) => error.message().to_owned(),
            PairSessionError::Crypto => "код не збігся або канал пошкоджено".to_owned(),
            PairSessionError::Protocol => "інша сторона надіслала несподіване".to_owned(),
            PairSessionError::Rejected => "контрольний номер не підтверджено".to_owned(),
            PairSessionError::Timeout => "час очікування вичерпано".to_owned(),
            PairSessionError::Side(text) => text.clone(),
        }
    }
}

impl From<PairClientError> for PairSessionError {
    fn from(error: PairClientError) -> Self {
        match error {
            // `next` повідомляє про вичерпання строку цією відмовою.
            PairClientError::Denied(RendezvousDenied::NoSuchSlot) => PairSessionError::Timeout,
            other => PairSessionError::Server(other),
        }
    }
}

/// Дії запрошувача над його профілем.
#[allow(async_fn_in_trait)]
pub trait HostSide {
    /// Текст запрошення (`EWINV1`), який піде гостю.
    fn invitation(&self) -> String;
    /// Розібрати заявку й повернути (запрошувач, гість) для контрольного номера.
    async fn review(&self, request: &str) -> Result<(MemberId, MemberId), String>;
    /// Показати номер людині; `true`, якщо вона підтвердила збіг.
    async fn confirm(&self, safety: &str) -> bool;
    /// Впустити гостя й повернути пакет ключів (`EWKEYS1`).
    async fn admit(&self, request: &str) -> Result<String, String>;
}

/// Дії гостя над його профілем.
#[allow(async_fn_in_trait)]
pub trait GuestSide {
    /// Заявка на вступ (`EWJOIN1`) та ідентифікатори (запрошувач, гість).
    async fn request(&self, invitation: &str) -> Result<(String, MemberId, MemberId), String>;
    async fn confirm(&self, safety: &str) -> bool;
    /// Прийняти пакет ключів.
    async fn accept(&self, keys: &str) -> Result<(), String>;
}

/// Як часто опитувати сервер і до якого моменту чекати.
#[derive(Clone, Copy)]
pub struct Pace {
    pub interval: Duration,
    pub deadline: tokio::time::Instant,
}

struct Link<'a> {
    api: &'a PairServer,
    slot: u8,
    token: SlotToken,
    inbox: VecDeque<Vec<u8>>,
    pace: Pace,
}

impl Link<'_> {
    async fn post(&self, message: &[u8]) -> Result<(), PairSessionError> {
        Ok(self.api.post(self.slot, &self.token, message).await?)
    }

    async fn next(&mut self) -> Result<Vec<u8>, PairSessionError> {
        Ok(self
            .api
            .next(
                self.slot,
                &self.token,
                &mut self.inbox,
                self.pace.interval,
                self.pace.deadline,
            )
            .await?)
    }

    /// PAKE, підтвердження ключа обома сторонами, захищений канал.
    async fn handshake(
        &mut self,
        role: Role,
        code: &PairCode,
    ) -> Result<PairChannel, PairSessionError> {
        let (start, message) = PairStart::begin(role, code);
        self.post(&message).await?;
        let peer = self.next().await?;
        let keys = start.finish(&peer).map_err(|_| PairSessionError::Crypto)?;
        self.post(&keys.confirmation()).await?;
        let tag = self.next().await?;
        keys.verify(&tag).map_err(|_| PairSessionError::Crypto)
    }

    async fn send(
        &self,
        channel: &mut PairChannel,
        tag: u8,
        body: &[u8],
    ) -> Result<(), PairSessionError> {
        let mut plain = Vec::with_capacity(1 + body.len());
        plain.push(tag);
        plain.extend_from_slice(body);
        let frame = channel
            .seal(&plain)
            .map_err(|_| PairSessionError::Protocol)?;
        self.post(&frame).await
    }

    /// Дочекатися кадру з одним із дозволених тегів.
    async fn receive(
        &mut self,
        channel: &mut PairChannel,
        allowed: &[u8],
    ) -> Result<(u8, Vec<u8>), PairSessionError> {
        let frame = self.next().await?;
        let plain = channel.open(&frame).map_err(|_| PairSessionError::Crypto)?;
        match plain.split_first() {
            Some((tag, body)) if allowed.contains(tag) => Ok((*tag, body.to_vec())),
            _ => Err(PairSessionError::Protocol),
        }
    }
}

fn text(body: Vec<u8>) -> Result<String, PairSessionError> {
    String::from_utf8(body).map_err(|_| PairSessionError::Protocol)
}

/// Запрошувач: скринька `slot` уже відкрита, `code` показано людині.
pub async fn host(
    api: &PairServer,
    slot: u8,
    token: SlotToken,
    code: &PairCode,
    side: &impl HostSide,
    pace: Pace,
) -> Result<(), PairSessionError> {
    let mut link = Link {
        api,
        slot,
        token,
        inbox: VecDeque::new(),
        pace,
    };
    // Скриньку не закриває той, хто надсилав останнім: співрозмовник ще не забрав кадр.
    // Її закриває гість після успіху, інакше вона спливає за строком коду.
    host_flow(&mut link, code, side).await
}

async fn host_flow(
    link: &mut Link<'_>,
    code: &PairCode,
    side: &impl HostSide,
) -> Result<(), PairSessionError> {
    let mut channel = link.handshake(Role::Host, code).await?;
    link.send(&mut channel, INVITATION, side.invitation().as_bytes())
        .await?;
    let (_, request) = link.receive(&mut channel, &[REQUEST]).await?;
    let request = text(request)?;
    let (inviter, guest) = side
        .review(&request)
        .await
        .map_err(PairSessionError::Side)?;
    let safety = channel.safety_number(&inviter, &guest);
    if !side.confirm(&safety).await {
        link.send(&mut channel, REJECTED, &[]).await?;
        return Err(PairSessionError::Rejected);
    }
    let (_, verdict) = link.receive(&mut channel, &[VERDICT]).await?;
    if verdict != [1] {
        return Err(PairSessionError::Rejected);
    }
    let keys = side.admit(&request).await.map_err(PairSessionError::Side)?;
    link.send(&mut channel, KEYS, keys.as_bytes()).await
}

/// Гість: приєднується до скриньки з номера в коді.
pub async fn guest(
    api: &PairServer,
    code: &PairCode,
    side: &impl GuestSide,
    pace: Pace,
) -> Result<(), PairSessionError> {
    let slot = code.slot();
    let token = api.join(slot).await?;
    let mut link = Link {
        api,
        slot,
        token,
        inbox: VecDeque::new(),
        pace,
    };
    let result = guest_flow(&mut link, code, side).await;
    if result.is_ok() {
        let _ = api.close(slot, &token).await;
    }
    result
}

async fn guest_flow(
    link: &mut Link<'_>,
    code: &PairCode,
    side: &impl GuestSide,
) -> Result<(), PairSessionError> {
    let mut channel = link.handshake(Role::Guest, code).await?;
    let (_, invitation) = link.receive(&mut channel, &[INVITATION]).await?;
    let (request, inviter, own) = side
        .request(&text(invitation)?)
        .await
        .map_err(PairSessionError::Side)?;
    link.send(&mut channel, REQUEST, request.as_bytes()).await?;
    let safety = channel.safety_number(&inviter, &own);
    let agreed = side.confirm(&safety).await;
    link.send(&mut channel, VERDICT, &[u8::from(agreed)])
        .await?;
    if !agreed {
        return Err(PairSessionError::Rejected);
    }
    match link.receive(&mut channel, &[KEYS, REJECTED]).await? {
        (KEYS, keys) => side
            .accept(&text(keys)?)
            .await
            .map_err(PairSessionError::Side),
        _ => Err(PairSessionError::Rejected),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::collective::send_gate::GatePolicy;
    use crate::pair_relay::serve;
    use std::sync::Mutex;
    use tokio::net::TcpListener;

    const OPEN: GatePolicy = GatePolicy {
        wan_transport_accepted: true,
        base44_accepted: false,
    };
    const HOST_ID: MemberId = [1; 32];
    const GUEST_ID: MemberId = [2; 32];

    struct FakeHost {
        agree: bool,
        seen: Mutex<Vec<String>>,
        admitted: Mutex<Vec<String>>,
    }

    impl HostSide for FakeHost {
        fn invitation(&self) -> String {
            "EWINV1.synthetic".to_owned()
        }
        async fn review(&self, request: &str) -> Result<(MemberId, MemberId), String> {
            assert_eq!(request, "EWJOIN1.synthetic");
            Ok((HOST_ID, GUEST_ID))
        }
        async fn confirm(&self, safety: &str) -> bool {
            self.seen.lock().unwrap().push(safety.to_owned());
            self.agree
        }
        async fn admit(&self, request: &str) -> Result<String, String> {
            self.admitted.lock().unwrap().push(request.to_owned());
            Ok("EWKEYS1.synthetic".to_owned())
        }
    }

    struct FakeGuest {
        agree: bool,
        seen: Mutex<Vec<String>>,
        keys: Mutex<Vec<String>>,
        guest_id: MemberId,
    }

    impl GuestSide for FakeGuest {
        async fn request(&self, invitation: &str) -> Result<(String, MemberId, MemberId), String> {
            assert_eq!(invitation, "EWINV1.synthetic");
            Ok(("EWJOIN1.synthetic".to_owned(), HOST_ID, self.guest_id))
        }
        async fn confirm(&self, safety: &str) -> bool {
            self.seen.lock().unwrap().push(safety.to_owned());
            self.agree
        }
        async fn accept(&self, keys: &str) -> Result<(), String> {
            self.keys.lock().unwrap().push(keys.to_owned());
            Ok(())
        }
    }

    fn fake_host(agree: bool) -> FakeHost {
        FakeHost {
            agree,
            seen: Mutex::default(),
            admitted: Mutex::default(),
        }
    }

    fn fake_guest(agree: bool) -> FakeGuest {
        FakeGuest {
            agree,
            seen: Mutex::default(),
            keys: Mutex::default(),
            guest_id: GUEST_ID,
        }
    }

    /// Запускає сервер зустрічі й повертає клієнтів та сигнал зупинки.
    async fn rig() -> (
        PairServer,
        PairServer,
        tokio::sync::oneshot::Sender<()>,
        tokio::task::JoinHandle<std::io::Result<()>>,
    ) {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let base = format!("http://{}/", listener.local_addr().unwrap());
        let (stop, stopped) = tokio::sync::oneshot::channel::<()>();
        let server = tokio::spawn(serve(listener, None, async {
            let _ = stopped.await;
        }));
        (
            PairServer::new(&base, &OPEN).unwrap(),
            PairServer::new(&base, &OPEN).unwrap(),
            stop,
            server,
        )
    }

    fn pace() -> Pace {
        Pace {
            interval: Duration::from_millis(15),
            deadline: tokio::time::Instant::now() + Duration::from_secs(10),
        }
    }

    async fn run(
        host_agrees: bool,
        guest_agrees: bool,
        dictated_secret_differs: bool,
    ) -> (
        Result<(), PairSessionError>,
        Result<(), PairSessionError>,
        FakeHost,
        FakeGuest,
    ) {
        let (host_api, guest_api, stop, server) = rig().await;
        let (slot, token) = host_api.open().await.unwrap();
        let code = PairCode::generate(slot).unwrap();
        let mut dictated = PairCode::parse(&code.display()).unwrap();
        if dictated_secret_differs {
            let wrong = if code.display().ends_with('0') {
                '1'
            } else {
                '0'
            };
            let mut text = code.display();
            text.pop();
            text.push(wrong);
            dictated = PairCode::parse(&text).unwrap();
        }
        let (host_side, guest_side) = (fake_host(host_agrees), fake_guest(guest_agrees));
        let (host_result, guest_result) = tokio::join!(
            host(&host_api, slot, token, &code, &host_side, pace()),
            guest(&guest_api, &dictated, &guest_side, pace()),
        );
        let _ = stop.send(());
        server.await.unwrap().unwrap();
        (host_result, guest_result, host_side, guest_side)
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn whole_join_runs_through_the_code_and_both_see_the_same_safety_number() {
        let (host_result, guest_result, host_side, guest_side) = run(true, true, false).await;
        assert_eq!(host_result, Ok(()));
        assert_eq!(guest_result, Ok(()));
        let (host_seen, guest_seen) = (
            host_side.seen.lock().unwrap().clone(),
            guest_side.seen.lock().unwrap().clone(),
        );
        assert_eq!(host_seen.len(), 1);
        assert_eq!(host_seen, guest_seen);
        assert_eq!(host_side.admitted.lock().unwrap().len(), 1);
        assert_eq!(
            guest_side.keys.lock().unwrap().as_slice(),
            ["EWKEYS1.synthetic"]
        );
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn wrong_code_opens_no_channel_and_admits_nobody() {
        let (host_result, guest_result, host_side, guest_side) = run(true, true, true).await;
        assert_eq!(host_result, Err(PairSessionError::Crypto));
        assert_eq!(guest_result, Err(PairSessionError::Crypto));
        assert!(host_side.admitted.lock().unwrap().is_empty());
        assert!(guest_side.keys.lock().unwrap().is_empty());
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn guest_refusing_the_number_admits_nobody() {
        let (host_result, guest_result, host_side, guest_side) = run(true, false, false).await;
        assert_eq!(guest_result, Err(PairSessionError::Rejected));
        assert_eq!(host_result, Err(PairSessionError::Rejected));
        assert!(host_side.admitted.lock().unwrap().is_empty());
        assert!(guest_side.keys.lock().unwrap().is_empty());
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn host_refusing_the_number_stops_the_guest_before_any_keys() {
        let (host_result, guest_result, host_side, guest_side) = run(false, true, false).await;
        assert_eq!(host_result, Err(PairSessionError::Rejected));
        assert_eq!(guest_result, Err(PairSessionError::Rejected));
        assert!(host_side.admitted.lock().unwrap().is_empty());
        assert!(guest_side.keys.lock().unwrap().is_empty());
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn a_different_guest_identity_gives_a_different_safety_number() {
        let (host_api, guest_api, stop, server) = rig().await;
        let (slot, token) = host_api.open().await.unwrap();
        let code = PairCode::generate(slot).unwrap();
        let (host_side, mut guest_side) = (fake_host(true), fake_guest(true));
        // Гість вважає себе іншим учасником, ніж бачить запрошувач (підміна в заявці).
        guest_side.guest_id = [9; 32];
        let (host_result, guest_result) = tokio::join!(
            host(&host_api, slot, token, &code, &host_side, pace()),
            guest(&guest_api, &code, &guest_side, pace()),
        );
        let _ = stop.send(());
        server.await.unwrap().unwrap();
        assert_ne!(
            host_side.seen.lock().unwrap().first(),
            guest_side.seen.lock().unwrap().first()
        );
        // Люди звіряють розбіжні номери й відмовляються; тут обидва «автоматично згодні»,
        // тож перевіряється лише те, що номери розійшлися.
        assert!(host_result.is_ok() && guest_result.is_ok());
    }
}
