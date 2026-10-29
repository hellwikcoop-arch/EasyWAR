//! Криптографічне ядро колективів (E8, C2): ключі учасника й пристрою, ключ епохи з
//! обгортками, конверт операції `EnvelopeV1`, дворівневий захист від повторів і
//! сховище секретів профілю. Реалізує `docs/adr/collective-crypto.md` (suite 1, варіант Б)
//! і розділ 3 `docs/adr/network-and-secret-boundaries.md` (варіант Ф).
//!
//! Межі модуля (наказ T-0017): жодної мережі, жодних команд Tauri, жодних міграцій —
//! підключення до IPC і сховища бази даних — етап C3b. Усі дані в тестах синтетичні.
//! Назовні йде один код «пакет відхилено»; причина лишається в локальному журналі
//! ([`Reason`]), як у `network_policy.rs`.

pub mod codec;
pub mod envelope;
pub mod epoch;
pub mod identity;
pub mod replay;
pub mod secret_store;

#[cfg(test)]
mod vectors;

/// Версія протоколу: інша версія відхиляється без спроби розшифрування (ADR, 2.1).
pub const PROTOCOL_VERSION: u16 = 1;
/// Набір примітивів: Ed25519 + X25519 + HKDF-SHA256 + XChaCha20-Poly1305 + Argon2id.
pub const SUITE: u16 = 1;

pub const KEY_LEN: usize = 32;
pub const NONCE_LEN: usize = 24;
pub const ID_LEN: usize = 16;
pub const TAG_LEN: usize = 16;
pub const SIGNATURE_LEN: usize = 64;

/// Мітки HKDF і префікси підпису. Простір `easywar/collective/v1/*` не перетинається з
/// `easywar/library/v1/*` бібліотеки «Офісу» (ADR, 2.2).
pub mod labels {
    pub const MEMBER_ID: &[u8] = b"easywar/collective/v1/member-id";
    pub const DEVICE_RECORD: &[u8] = b"easywar/collective/v1/device";
    pub const EXCHANGE_BINDING: &[u8] = b"easywar/collective/v1/exchange-binding";
    pub const EPOCH_WRAP: &[u8] = b"easywar/collective/v1/epoch-wrap";
    pub const OPERATION: &[u8] = b"easywar/collective/v1/op";
    pub const SECRET_KEYRING: &[u8] = b"easywar/collective/v1/keyring";
    pub const SECRET_ENTRY: &[u8] = b"easywar/collective/v1/secret";
}

/// Причина відмови — лише для локального журналу. Назовні всі варіанти стають одним
/// кодом [`PacketRejected`] без байтів, адрес і подробиць.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum Reason {
    /// Інша версія протоколу чи набору.
    UnsupportedVersion,
    /// Кодування не розбирається (довжини, обрізаний пакет).
    Malformed,
    /// Епоха конверта невідома одержувачу.
    UnknownEpoch,
    /// Тег AEAD не збігся: підмінено відкрите поле чи шифротекст.
    AuthenticationFailed,
    /// Підпис пристрою не збігся з payload.
    BadSignature,
    /// Запис пристрою не підписаний ключем учасника або відкликаний.
    DeviceNotValid,
    /// Учасник не має права запису на таблицю за станом журналу складу.
    NoWriteRight,
    /// Автор не мав цієї епохи на `membership_seq`.
    EpochNotHeld,
    /// Автор відкликаний (правило (б) підпитання JE-16).
    MemberRevoked,
    /// Той самий `op_id` з іншим `op_digest` (правило C1b про дублікати).
    IntegrityViolation,
    /// Ключ обгортки не відповідає ключу учасника.
    WrongRecipient,
    /// Спільний секрет X25519 неконтрибутивний (ключ обміну з малої підгрупи або нульовий,
    /// RFC 7748, розділ 6.1): обгортка не створюється й не розгортається (G12, зауваження 1).
    WeakExchangeKey,
    /// Ключ обміну не зв'язаний підписом учасника з цим колективом (G12, U1/U2).
    ExchangeNotBound,
    /// Зв'язування не новіше за чинне: `join` не перезаписує ключ обміну, ротація — лише
    /// новішим підписаним записом (G12, U2).
    BindingNotNewer,
}

impl Reason {
    /// Текст для локального журналу українською; без даних пакета.
    pub fn message(self) -> &'static str {
        match self {
            Reason::UnsupportedVersion => "непідтримувана версія протоколу або набору",
            Reason::Malformed => "пакет не розбирається",
            Reason::UnknownEpoch => "невідома епоха",
            Reason::AuthenticationFailed => "перевірка цілісності не пройшла",
            Reason::BadSignature => "підпис пристрою недійсний",
            Reason::DeviceNotValid => "пристрій не підтверджений учасником або відкликаний",
            Reason::NoWriteRight => "немає права запису на таблицю",
            Reason::EpochNotHeld => "автор не мав цієї епохи",
            Reason::MemberRevoked => "учасника відкликано",
            Reason::IntegrityViolation => "той самий ідентифікатор операції з іншим змістом",
            Reason::WrongRecipient => "обгортка адресована іншому учаснику",
            Reason::WeakExchangeKey => "ключ обміну недійсний (мала підгрупа або нуль)",
            Reason::ExchangeNotBound => "ключ обміну не підтверджений підписом учасника",
            Reason::BindingNotNewer => "запис ключа обміну не новіший за чинний",
        }
    }
}

impl std::fmt::Display for Reason {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(self.message())
    }
}

/// Єдиний зовнішній код відмови (ADR, 2.4 «Помилки»).
#[derive(Clone, Copy, Debug, Default, Eq, PartialEq)]
pub struct PacketRejected;

impl std::fmt::Display for PacketRejected {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("пакет відхилено")
    }
}

impl std::error::Error for PacketRejected {}

impl From<Reason> for PacketRejected {
    fn from(_: Reason) -> Self {
        PacketRejected
    }
}

pub(crate) fn sha256(parts: &[&[u8]]) -> [u8; KEY_LEN] {
    use sha2::{Digest, Sha256};
    let mut hasher = Sha256::new();
    for part in parts {
        hasher.update(part);
    }
    hasher.finalize().into()
}

/// HKDF-SHA256 з явними `salt` і `info` (ADR, 2.3).
pub(crate) fn hkdf(ikm: &[u8], salt: &[u8], info: &[u8]) -> zeroize::Zeroizing<[u8; KEY_LEN]> {
    use hkdf::Hkdf;
    use sha2::Sha256;
    let mut okm = zeroize::Zeroizing::new([0u8; KEY_LEN]);
    Hkdf::<Sha256>::new(Some(salt), ikm)
        .expand(info, &mut okm[..])
        .expect("32 байти — допустима довжина виходу HKDF-SHA256");
    okm
}

pub(crate) fn random_array<const N: usize>() -> [u8; N] {
    use argon2::password_hash::rand_core::{OsRng, RngCore};
    let mut bytes = [0u8; N];
    OsRng.fill_bytes(&mut bytes);
    bytes
}

#[cfg(test)]
pub(crate) mod hex {
    pub fn encode(bytes: &[u8]) -> String {
        bytes.iter().map(|byte| format!("{byte:02x}")).collect()
    }

    pub fn decode(text: &str) -> Vec<u8> {
        let text: String = text.chars().filter(|c| !c.is_whitespace()).collect();
        assert!(text.len().is_multiple_of(2), "hex непарної довжини");
        (0..text.len())
            .step_by(2)
            .map(|i| u8::from_str_radix(&text[i..i + 2], 16).expect("hex"))
            .collect()
    }

    pub fn array<const N: usize>(text: &str) -> [u8; N] {
        let bytes = decode(text);
        bytes.as_slice().try_into().expect("довжина hex")
    }
}
