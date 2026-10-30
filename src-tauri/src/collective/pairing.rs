//! Вступ за кодом із 6 цифр (E8, обмін між містами; рішення JE від 30.10.2026 09:30Z «Так, код
//! у draft PR»): власник диктує код телефоном, і дві копії EasyWAR будують із нього
//! захищений канал, яким ідуть наявні [`Invitation`](super::invite::Invitation),
//! [`JoinRequest`](super::invite::JoinRequest) і пакет ключів. Сам формат вступу не змінюється;
//! змінюється лише доставка: замість трьох текстів, які люди пересилають самі, — один код.
//!
//! Код короткий, тож ключем він бути не може: перехоплений обмін дав би підібрати його офлайн.
//! Тому з коду ключ виводить PAKE (SPAKE2 на Ed25519, крейт `spake2`): підбір можливий лише
//! в живому обміні, по одній спробі на код. Код складається з двох частин:
//!
//! - **номер скриньки** — дві перші цифри. Його бачить сервер зустрічі, щоб звести двох
//!   учасників, і він у пароль PAKE не рахується як секрет;
//! - **секрет** — чотири останні цифри; сервер їх не бачить.
//!
//! Отже, той, хто вклинився в обмін (зокрема сам сервер), вгадує з імовірністю 1/10 000 і
//! лише один раз: невдала спроба зупиняє обидві сторони ([`PairKeys::verify`] споживає ключі,
//! [`PairStart::finish`] споживає стан), і код більше не діє. Новий код — нова спроба.
//! Строк коду — [`CODE_TTL_SECONDS`]; стежать за ним вузол і сервер (наступний зріз).
//!
//! Після PAKE обидві сторони обмінюються тегами підтвердження (HMAC-SHA256 над стенограмою),
//! а далі — кадрами [`PairChannel`]: XChaCha20-Poly1305, окремий ключ на кожен напрям,
//! номер кадру в AAD і в nonce, кадри лише по порядку.
//!
//! Модуль — чиста логіка без мережі, IPC і сховищ. Мережевий транспорт і сервер зустрічі —
//! окремий зріз за `GatePolicy`; WAN вимкнений до незалежного огляду безпеки.

use chacha20poly1305::aead::{Aead, KeyInit, Payload};
use chacha20poly1305::{Key, XChaCha20Poly1305, XNonce};
use hmac::{Hmac, Mac};
use sha2::Sha256;
use spake2::{Ed25519Group, Identity, Password, Spake2};
use zeroize::Zeroizing;

use super::codec::{Reader, Writer};
use super::identity::MemberId;
use super::{hkdf, labels, random_array, sha256, Reason, KEY_LEN, NONCE_LEN};

/// Цифр у коді.
pub const CODE_DIGITS: usize = 6;
/// Скільки діє код від видачі (10 хв).
pub const CODE_TTL_SECONDS: i64 = 10 * 60;
/// Найбільший відкритий текст одного кадру (1 MiB, як конверт у черзі).
pub const MAX_FRAME_PLAINTEXT: usize = 1024 * 1024;

const SLOTS: u16 = 100;
const SECRETS: u16 = 10_000;
const SEQ_LEN: usize = 8;

/// Код із 6 цифр: номер скриньки (дві перші) і секрет (чотири останні).
#[derive(Clone, Copy, Eq, PartialEq)]
pub struct PairCode {
    slot: u8,
    secret: u16,
}

impl std::fmt::Debug for PairCode {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "PairCode({:02}xxxx)", self.slot)
    }
}

impl PairCode {
    /// Новий код для скриньки `slot` (0–99), яку видав сервер зустрічі. Секрет — з ОС,
    /// рівномірно на 0–9999.
    pub fn generate(slot: u8) -> Result<Self, Reason> {
        if u16::from(slot) >= SLOTS {
            return Err(Reason::Malformed);
        }
        // Відкидання вибірки: 65 536 не ділиться на 10 000, тож верхній хвіст відкидається.
        let limit = u16::MAX - (u16::MAX % SECRETS);
        loop {
            let candidate = u16::from_le_bytes(random_array::<2>());
            if candidate < limit {
                return Ok(Self {
                    slot,
                    secret: candidate % SECRETS,
                });
            }
        }
    }

    /// Код, набраний людиною: цифри з пробілами чи дефісами, рівно шість цифр.
    pub fn parse(text: &str) -> Result<Self, Reason> {
        let mut digits = Vec::with_capacity(CODE_DIGITS);
        for c in text.chars() {
            match c {
                '0'..='9' => digits.push(c as u8 - b'0'),
                ' ' | '-' | '\u{a0}' => {}
                _ => return Err(Reason::Malformed),
            }
        }
        if digits.len() != CODE_DIGITS {
            return Err(Reason::Malformed);
        }
        let number = |range: std::ops::Range<usize>| {
            digits[range]
                .iter()
                .fold(0u16, |acc, d| acc * 10 + u16::from(*d))
        };
        Ok(Self {
            slot: number(0..2) as u8,
            secret: number(2..6),
        })
    }

    /// Номер скриньки — єдине, що з коду бачить сервер зустрічі.
    pub fn slot(&self) -> u8 {
        self.slot
    }

    /// Для показу й диктування: «482 731».
    pub fn display(&self) -> String {
        let all = format!("{:02}{:04}", self.slot, self.secret);
        format!("{} {}", &all[..3], &all[3..])
    }

    /// Чи минув строк коду, виданого о `issued_at`.
    pub fn expired(issued_at: i64, now: i64) -> bool {
        now < issued_at || now - issued_at >= CODE_TTL_SECONDS
    }

    fn password(&self) -> Password {
        let digits = format!("{:02}{:04}", self.slot, self.secret);
        let mut bytes = labels::PAIR_CODE.to_vec();
        bytes.extend_from_slice(digits.as_bytes());
        Password::new(bytes)
    }
}

/// Хто з двох сторін: власник коду (видав запрошення) чи новий учасник.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum Role {
    Host,
    Guest,
}

impl Role {
    fn byte(self) -> u8 {
        match self {
            Role::Host => 1,
            Role::Guest => 2,
        }
    }
}

/// Перший крок PAKE. [`PairStart::finish`] споживає стан: на один код — одна спроба.
pub struct PairStart {
    role: Role,
    slot: u8,
    outbound: Vec<u8>,
    state: Spake2<Ed25519Group>,
}

impl PairStart {
    /// Почати обмін; друге значення — повідомлення для іншої сторони.
    pub fn begin(role: Role, code: &PairCode) -> (Self, Vec<u8>) {
        let host = Identity::new(labels::PAIR_HOST);
        let guest = Identity::new(labels::PAIR_GUEST);
        let (state, outbound) = match role {
            Role::Host => Spake2::<Ed25519Group>::start_a(&code.password(), &host, &guest),
            Role::Guest => Spake2::<Ed25519Group>::start_b(&code.password(), &host, &guest),
        };
        (
            Self {
                role,
                slot: code.slot,
                outbound: outbound.clone(),
                state,
            },
            outbound,
        )
    }

    /// Завершити PAKE повідомленням іншої сторони. Неправильний код тут ще не видно: його
    /// виявляє [`PairKeys::verify`].
    pub fn finish(self, inbound: &[u8]) -> Result<PairKeys, Reason> {
        let shared = Zeroizing::new(self.state.finish(inbound).map_err(|_| Reason::Malformed)?);
        let (host_msg, guest_msg) = match self.role {
            Role::Host => (self.outbound.as_slice(), inbound),
            Role::Guest => (inbound, self.outbound.as_slice()),
        };
        let mut w = Writer::with_capacity(8 + host_msg.len() + guest_msg.len());
        w.fixed(&[self.slot]).var(host_msg).var(guest_msg);
        let transcript = sha256(&[labels::PAIR_TRANSCRIPT, &w.finish()]);
        let derive = |info: &[u8]| hkdf(shared.as_slice(), &transcript, info);
        Ok(PairKeys {
            role: self.role,
            transcript,
            confirm_host: derive(labels::PAIR_CONFIRM_HOST),
            confirm_guest: derive(labels::PAIR_CONFIRM_GUEST),
            host_to_guest: derive(labels::PAIR_HOST_TO_GUEST),
            guest_to_host: derive(labels::PAIR_GUEST_TO_HOST),
        })
    }
}

/// Ключі після PAKE, ще не підтверджені іншою стороною.
pub struct PairKeys {
    role: Role,
    transcript: [u8; KEY_LEN],
    confirm_host: Zeroizing<[u8; KEY_LEN]>,
    confirm_guest: Zeroizing<[u8; KEY_LEN]>,
    host_to_guest: Zeroizing<[u8; KEY_LEN]>,
    guest_to_host: Zeroizing<[u8; KEY_LEN]>,
}

impl PairKeys {
    fn mac(key: &[u8; KEY_LEN], role: Role, transcript: &[u8; KEY_LEN]) -> Hmac<Sha256> {
        let mut mac = <Hmac<Sha256> as Mac>::new_from_slice(key)
            .expect("HMAC приймає ключ будь-якої довжини");
        mac.update(&[role.byte()]);
        mac.update(transcript);
        mac
    }

    fn own_key(&self, role: Role) -> &[u8; KEY_LEN] {
        match role {
            Role::Host => &self.confirm_host,
            Role::Guest => &self.confirm_guest,
        }
    }

    /// Тег підтвердження цієї сторони для іншої.
    pub fn confirmation(&self) -> [u8; KEY_LEN] {
        Self::mac(self.own_key(self.role), self.role, &self.transcript)
            .finalize()
            .into_bytes()
            .into()
    }

    /// Перевірити тег іншої сторони (у сталому часі) і відкрити канал. Не той тег —
    /// неправильний код або втручання: ключі знищуються, код більше не діє.
    pub fn verify(self, peer: &[u8]) -> Result<PairChannel, Reason> {
        let peer_role = match self.role {
            Role::Host => Role::Guest,
            Role::Guest => Role::Host,
        };
        Self::mac(self.own_key(peer_role), peer_role, &self.transcript)
            .verify_slice(peer)
            .map_err(|_| Reason::AuthenticationFailed)?;
        let (send, recv) = match self.role {
            Role::Host => (self.host_to_guest, self.guest_to_host),
            Role::Guest => (self.guest_to_host, self.host_to_guest),
        };
        Ok(PairChannel {
            role: self.role,
            transcript: self.transcript,
            send,
            recv,
            send_seq: 0,
            recv_seq: 0,
        })
    }
}

/// Підтверджений канал між двома сторонами: кадри шифруються окремим ключем на напрям і
/// приймаються строго по порядку (повтор, пропуск чи переставлений кадр — відмова).
pub struct PairChannel {
    role: Role,
    transcript: [u8; KEY_LEN],
    send: Zeroizing<[u8; KEY_LEN]>,
    recv: Zeroizing<[u8; KEY_LEN]>,
    send_seq: u64,
    recv_seq: u64,
}

impl PairChannel {
    fn nonce(direction: Role, seq: u64) -> [u8; NONCE_LEN] {
        let mut nonce = [0u8; NONCE_LEN];
        nonce[0] = direction.byte();
        nonce[NONCE_LEN - SEQ_LEN..].copy_from_slice(&seq.to_be_bytes());
        nonce
    }

    fn aad(&self, direction: Role, seq: u64) -> Vec<u8> {
        let mut w = Writer::with_capacity(labels::PAIR_FRAME.len() + 48);
        w.fixed(labels::PAIR_FRAME)
            .fixed(&self.transcript)
            .fixed(&[direction.byte()])
            .u64(seq);
        w.finish()
    }

    fn peer(&self) -> Role {
        match self.role {
            Role::Host => Role::Guest,
            Role::Guest => Role::Host,
        }
    }

    /// Контрольний номер для перевірки ідентичності сторін (критичні колективи): 8 цифр
    /// з каналу і ключів обох учасників. Люди звіряють його телефоном; однаковий номер
    /// означає, що між ними немає посередника і кожен бачить саме того учасника, з ким
    /// говорить. `host` і `guest` — `member_id` власника і нового учасника.
    pub fn safety_number(&self, host: &MemberId, guest: &MemberId) -> String {
        let digest = sha256(&[labels::PAIR_SAFETY, &self.transcript, host, guest]);
        let value = u64::from_be_bytes(digest[..8].try_into().expect("8 байтів")) % 100_000_000;
        let digits = format!("{value:08}");
        format!("{} {}", &digits[..4], &digits[4..])
    }

    /// Зашифрувати наступний кадр для іншої сторони.
    pub fn seal(&mut self, plaintext: &[u8]) -> Result<Vec<u8>, Reason> {
        if plaintext.len() > MAX_FRAME_PLAINTEXT {
            return Err(Reason::Malformed);
        }
        let seq = self.send_seq;
        let aad = self.aad(self.role, seq);
        let cipher = XChaCha20Poly1305::new(&Key::from(*self.send));
        let ciphertext = cipher
            .encrypt(
                &XNonce::from(Self::nonce(self.role, seq)),
                Payload {
                    msg: plaintext,
                    aad: &aad,
                },
            )
            .map_err(|_| Reason::Malformed)?;
        self.send_seq = seq.checked_add(1).ok_or(Reason::Malformed)?;
        let mut w = Writer::with_capacity(SEQ_LEN + ciphertext.len());
        w.u64(seq).fixed(&ciphertext);
        Ok(w.finish())
    }

    /// Розшифрувати наступний кадр від іншої сторони.
    pub fn open(&mut self, frame: &[u8]) -> Result<Vec<u8>, Reason> {
        let mut r = Reader::new(frame);
        let seq = r.u64()?;
        let ciphertext = r.rest();
        if seq != self.recv_seq {
            return Err(Reason::AuthenticationFailed);
        }
        let peer = self.peer();
        let aad = self.aad(peer, seq);
        let cipher = XChaCha20Poly1305::new(&Key::from(*self.recv));
        let plaintext = cipher
            .decrypt(
                &XNonce::from(Self::nonce(peer, seq)),
                Payload {
                    msg: ciphertext,
                    aad: &aad,
                },
            )
            .map_err(|_| Reason::AuthenticationFailed)?;
        if plaintext.len() > MAX_FRAME_PLAINTEXT {
            return Err(Reason::Malformed);
        }
        self.recv_seq = seq.checked_add(1).ok_or(Reason::Malformed)?;
        Ok(plaintext)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::collective::epoch::EpochKey;
    use crate::collective::identity::{DeviceIdentity, MemberIdentity};
    use crate::collective::invite::{self, Invitation, InvitationLedger, JoinRequest};
    use crate::collective::replay::InMemoryMembership;
    use crate::collective::ID_LEN;

    const T0: i64 = 1_761_800_000;

    /// Обидві сторони проходять PAKE і підтвердження з кодами `host_code` і `guest_code`.
    fn pair(
        host_code: &PairCode,
        guest_code: &PairCode,
    ) -> (Result<PairChannel, Reason>, Result<PairChannel, Reason>) {
        let (host, to_guest) = PairStart::begin(Role::Host, host_code);
        let (guest, to_host) = PairStart::begin(Role::Guest, guest_code);
        let host = host.finish(&to_host).unwrap();
        let guest = guest.finish(&to_guest).unwrap();
        let (host_tag, guest_tag) = (host.confirmation(), guest.confirmation());
        (host.verify(&guest_tag), guest.verify(&host_tag))
    }

    #[test]
    fn code_parses_from_dictation_and_shows_in_two_groups() {
        let code = PairCode::parse("482 731").unwrap();
        assert_eq!(code.slot(), 48);
        assert_eq!(code.display(), "482 731");
        assert_eq!(PairCode::parse("48-27-31").unwrap(), code);
        assert_eq!(PairCode::parse("482731").unwrap(), code);
        assert_eq!(PairCode::parse("007 001").unwrap().display(), "007 001");
        for bad in ["48273", "4827311", "48a731", "", "482 73١"] {
            assert_eq!(PairCode::parse(bad), Err(Reason::Malformed), "{bad:?}");
        }
        // У налагоджувальному виводі секрету немає.
        assert_eq!(format!("{code:?}"), "PairCode(48xxxx)");
    }

    #[test]
    fn generated_code_keeps_the_slot_and_draws_a_fresh_secret() {
        let codes: Vec<PairCode> = (0..32).map(|_| PairCode::generate(7).unwrap()).collect();
        assert!(codes.iter().all(|code| code.slot() == 7));
        assert!(codes.iter().all(|code| code.secret < SECRETS));
        assert!(codes.iter().any(|code| code.secret != codes[0].secret));
        assert_eq!(
            PairCode::parse(&codes[0].display()).unwrap(),
            codes[0],
            "показаний код набирається назад тим самим"
        );
        assert_eq!(PairCode::generate(100).err(), Some(Reason::Malformed));
    }

    #[test]
    fn code_lives_ten_minutes() {
        assert!(!PairCode::expired(T0, T0));
        assert!(!PairCode::expired(T0, T0 + CODE_TTL_SECONDS - 1));
        assert!(PairCode::expired(T0, T0 + CODE_TTL_SECONDS));
        assert!(PairCode::expired(T0, T0 - 1), "годинник назад — код не діє");
    }

    #[test]
    fn same_code_opens_a_channel_both_ways_in_order() {
        let code = PairCode::generate(48).unwrap();
        let (host, guest) = pair(&code, &code);
        let (mut host, mut guest) = (host.unwrap(), guest.unwrap());
        for round in 0..3u8 {
            let frame = host.seal(&[round; 40]).unwrap();
            assert_eq!(guest.open(&frame).unwrap(), vec![round; 40]);
            let frame = guest.seal(b"answer").unwrap();
            assert_eq!(host.open(&frame).unwrap(), b"answer");
        }
    }

    #[test]
    fn wrong_code_stops_both_sides() {
        let code = PairCode::parse("482 731").unwrap();
        let guess = PairCode::parse("482 732").unwrap();
        let (host, guest) = pair(&code, &guess);
        assert_eq!(host.err(), Some(Reason::AuthenticationFailed));
        assert_eq!(guest.err(), Some(Reason::AuthenticationFailed));
    }

    #[test]
    fn server_that_knows_the_slot_cannot_sit_in_the_middle() {
        // Сервер зустрічі знає номер скриньки (48) і пробує вклинитися, вгадавши секрет:
        // він веде окремий PAKE з кожною стороною. Обидві сторони відмовляють.
        let code = PairCode::parse("482 731").unwrap();
        let mitm = PairCode::parse("480 000").unwrap();
        let (host, guest) = pair(&code, &mitm);
        assert!(host.is_err() && guest.is_err());
        let (host, guest) = pair(&mitm, &code);
        assert!(host.is_err() && guest.is_err());
    }

    #[test]
    fn tampered_pake_message_or_tag_fails() {
        let code = PairCode::generate(5).unwrap();
        let (host, to_guest) = PairStart::begin(Role::Host, &code);
        let (guest, mut to_host) = PairStart::begin(Role::Guest, &code);
        to_host[5] ^= 1;
        match host.finish(&to_host) {
            // Зіпсована точка кривої або інший спільний секрет — канал не відкривається.
            Err(reason) => assert_eq!(reason, Reason::Malformed),
            Ok(host) => {
                let guest = guest.finish(&to_guest).unwrap();
                assert!(host.verify(&guest.confirmation()).is_err());
            }
        }
        let (host, to_guest) = PairStart::begin(Role::Host, &code);
        let (guest, to_host) = PairStart::begin(Role::Guest, &code);
        let (host, guest) = (
            host.finish(&to_host).unwrap(),
            guest.finish(&to_guest).unwrap(),
        );
        let mut tag = guest.confirmation();
        tag[0] ^= 1;
        assert_eq!(host.verify(&tag).err(), Some(Reason::AuthenticationFailed));
        assert_eq!(
            guest.verify(&[0u8; 5]).err(),
            Some(Reason::AuthenticationFailed)
        );
    }

    #[test]
    fn own_tag_reflected_back_is_rejected() {
        let code = PairCode::generate(5).unwrap();
        let (host, _) = PairStart::begin(Role::Host, &code);
        let (_, to_host) = PairStart::begin(Role::Guest, &code);
        let host = host.finish(&to_host).unwrap();
        let own = host.confirmation();
        assert_eq!(host.verify(&own).err(), Some(Reason::AuthenticationFailed));
    }

    #[test]
    fn replayed_reordered_or_altered_frames_are_rejected() {
        let code = PairCode::generate(1).unwrap();
        let (host, guest) = pair(&code, &code);
        let (mut host, mut guest) = (host.unwrap(), guest.unwrap());
        let first = host.seal(b"one").unwrap();
        let second = host.seal(b"two").unwrap();
        assert_eq!(
            guest.open(&second).err(),
            Some(Reason::AuthenticationFailed),
            "пропуск кадру"
        );
        assert_eq!(guest.open(&first).unwrap(), b"one");
        assert_eq!(
            guest.open(&first).err(),
            Some(Reason::AuthenticationFailed),
            "повтор кадру"
        );
        let mut altered = second.clone();
        let last = altered.len() - 1;
        altered[last] ^= 1;
        assert_eq!(
            guest.open(&altered).err(),
            Some(Reason::AuthenticationFailed)
        );
        assert_eq!(guest.open(&second).unwrap(), b"two");
        // Кадр не можна повернути відправнику: інший ключ напряму.
        let echo = host.seal(b"three").unwrap();
        assert!(host.open(&echo).is_err());
        assert_eq!(guest.open(&echo).unwrap(), b"three");
        assert_eq!(guest.open(&[1, 2, 3]).err(), Some(Reason::Malformed));
    }

    #[test]
    fn frame_size_is_capped() {
        let code = PairCode::generate(1).unwrap();
        let (host, _) = pair(&code, &code);
        let mut host = host.unwrap();
        assert_eq!(
            host.seal(&vec![0u8; MAX_FRAME_PLAINTEXT + 1]).err(),
            Some(Reason::Malformed)
        );
        assert!(host.seal(&vec![0u8; MAX_FRAME_PLAINTEXT]).is_ok());
    }

    #[test]
    fn two_sessions_with_the_same_code_use_different_keys() {
        let code = PairCode::generate(9).unwrap();
        let (a, _) = pair(&code, &code);
        let (_, b) = pair(&code, &code);
        let frame = a.unwrap().seal(b"x").unwrap();
        assert!(b.unwrap().open(&frame).is_err());
    }

    #[test]
    fn whole_join_goes_through_the_code_channel() {
        // Синтетичний колектив: Аліса — власник, Боб вступає за кодом.
        let collective = [4u8; ID_LEN];
        let alice = MemberIdentity::generate();
        let mut membership = InMemoryMembership::new(collective);
        membership
            .join(&alice.bind_exchange(collective, T0))
            .unwrap();
        let keys = vec![EpochKey::generate()];
        let mut ledger = InvitationLedger::new();
        let bob = MemberIdentity::generate();
        let bob_device = DeviceIdentity::generate();

        let code = PairCode::generate(48).unwrap();
        let dictated = PairCode::parse(&code.display()).unwrap();
        let (host, guest) = pair(&code, &dictated);
        let (mut host, mut guest) = (host.unwrap(), guest.unwrap());

        // 1. Власник → новий учасник: запрошення.
        let invitation = Invitation::issue(&alice, collective, T0, T0 + 600).unwrap();
        let frame = host.seal(&invitation.to_bytes()).unwrap();
        let invitation = Invitation::from_bytes(&guest.open(&frame).unwrap()).unwrap();
        // 2. Новий учасник → власник: відповідь.
        let request = JoinRequest::build(invitation, &bob, &bob_device.public(), T0 + 5);
        let frame = guest.seal(&request.to_bytes()).unwrap();
        let request = JoinRequest::from_bytes(&host.open(&frame).unwrap()).unwrap();
        // Взаємне підтвердження (у вікні): власник бачить відбиток нового учасника.
        assert_eq!(
            request.binding.verify(&collective).unwrap().member_id(),
            bob.member_id()
        );
        // 3. Власник впускає і надсилає обгортки ключів.
        let admission =
            invite::admit(&mut membership, &mut ledger, &keys, &request, T0 + 10).unwrap();
        let wraps: Vec<u8> = admission
            .wraps
            .iter()
            .flat_map(|wrap| wrap.to_bytes())
            .collect();
        let frame = host.seal(&wraps).unwrap();
        let received =
            crate::collective::epoch::EpochWrap::from_bytes(&guest.open(&frame).unwrap()).unwrap();
        let opened = invite::accept(&bob, &[received]).unwrap();
        assert_eq!(opened[0].as_bytes(), keys[0].as_bytes());
        assert_eq!(membership.active_members(), 2);
        // Перевірка ідентичності: обидві сторони показують той самий контрольний номер.
        let number = host.safety_number(&alice.member_id(), &bob.member_id());
        assert_eq!(
            number,
            guest.safety_number(&alice.member_id(), &bob.member_id())
        );
        assert_eq!(number.len(), 9);
        let eve = MemberIdentity::generate();
        assert_ne!(
            number,
            guest.safety_number(&alice.member_id(), &eve.member_id())
        );
    }
}
