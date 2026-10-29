//! Ідентичність (ADR, 2.2): ключ учасника (Ed25519 для підпису + окрема пара X25519 для
//! обгорток), підписане зв'язування ключа обміну з колективом (G12, U1) і ключ пристрою
//! (Ed25519), запис якого підписує учасник.

use argon2::password_hash::rand_core::OsRng;
use ed25519_dalek::{Signature, Signer, SigningKey, VerifyingKey};
use x25519_dalek::{PublicKey, StaticSecret};
use zeroize::Zeroizing;

use super::codec::{Reader, Writer};
use super::{labels, sha256, Reason, ID_LEN, KEY_LEN, SIGNATURE_LEN};

/// Ідентифікатор учасника: SHA-256(мітка ‖ публічний ключ підпису). Не виводиться з
/// апаратних номерів і не є ідентифікатором лічильника встановлень.
pub type MemberId = [u8; KEY_LEN];

/// Відкриті ключі учасника.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct MemberPublic {
    pub sign: [u8; KEY_LEN],
    pub exchange: [u8; KEY_LEN],
}

impl MemberPublic {
    pub fn member_id(&self) -> MemberId {
        sha256(&[labels::MEMBER_ID, &self.sign])
    }

    pub fn verifying_key(&self) -> Result<VerifyingKey, Reason> {
        VerifyingKey::from_bytes(&self.sign).map_err(|_| Reason::Malformed)
    }

    pub fn exchange_key(&self) -> PublicKey {
        PublicKey::from(self.exchange)
    }
}

/// Секретні ключі учасника; затираються при знищенні (`zeroize` у обох крейтах).
pub struct MemberIdentity {
    signing: SigningKey,
    exchange: StaticSecret,
}

impl MemberIdentity {
    /// Нова пара з ОС-генератора.
    pub fn generate() -> Self {
        Self {
            signing: SigningKey::generate(&mut OsRng),
            exchange: StaticSecret::random_from_rng(OsRng),
        }
    }

    /// Зі збережених секретів (сховище секретів, розділ 3 ADR меж).
    pub fn from_secrets(sign_seed: &[u8; KEY_LEN], exchange_secret: &[u8; KEY_LEN]) -> Self {
        Self {
            signing: SigningKey::from_bytes(sign_seed),
            exchange: StaticSecret::from(*exchange_secret),
        }
    }

    pub fn public(&self) -> MemberPublic {
        MemberPublic {
            sign: self.signing.verifying_key().to_bytes(),
            exchange: PublicKey::from(&self.exchange).to_bytes(),
        }
    }

    pub fn member_id(&self) -> MemberId {
        self.public().member_id()
    }

    /// Секрети для сховища (seed підпису, секрет X25519).
    pub fn secrets(&self) -> (Zeroizing<[u8; KEY_LEN]>, Zeroizing<[u8; KEY_LEN]>) {
        (
            Zeroizing::new(self.signing.to_bytes()),
            Zeroizing::new(self.exchange.to_bytes()),
        )
    }

    pub(crate) fn exchange_secret(&self) -> &StaticSecret {
        &self.exchange
    }

    /// Підпис учасника над довільним повідомленням модуля (запрошення, відповідь на вступ).
    pub(crate) fn sign(&self, message: &[u8]) -> [u8; SIGNATURE_LEN] {
        self.signing.sign(message).to_bytes()
    }

    /// Учасник підписує зв'язування свого ключа обміну з колективом (G12, U1):
    /// `member_id ‖ exchange_pub ‖ collective_id ‖ issued_at` під міткою
    /// `easywar/collective/v1/exchange-binding`. Новіший запис (більший `issued_at`) — ротація.
    pub fn bind_exchange(&self, collective_id: [u8; ID_LEN], issued_at: i64) -> ExchangeBinding {
        self.sign_binding(self.public().exchange, collective_id, issued_at)
    }

    fn sign_binding(
        &self,
        exchange_pub: [u8; KEY_LEN],
        collective_id: [u8; ID_LEN],
        issued_at: i64,
    ) -> ExchangeBinding {
        let mut binding = ExchangeBinding {
            sign_pub: self.signing.verifying_key().to_bytes(),
            exchange_pub,
            collective_id,
            issued_at,
            signature: [0u8; SIGNATURE_LEN],
        };
        binding.signature = self.signing.sign(&binding.signed_bytes()).to_bytes();
        binding
    }

    /// Зв'язування довільного ключа обміну — лише для тестів зловмисного учасника.
    #[cfg(test)]
    pub(crate) fn bind_foreign_exchange(
        &self,
        exchange_pub: [u8; KEY_LEN],
        collective_id: [u8; ID_LEN],
        issued_at: i64,
    ) -> ExchangeBinding {
        self.sign_binding(exchange_pub, collective_id, issued_at)
    }

    /// Учасник підтверджує пристрій (ADR, 2.2): `{device_pub, member_id, issued_at}` під
    /// підписом учасника.
    pub fn issue_device(&self, device: &DevicePublic, issued_at: i64) -> DeviceRecord {
        let mut record = DeviceRecord {
            device_pub: device.0,
            member_id: self.member_id(),
            issued_at,
            signature: [0u8; SIGNATURE_LEN],
        };
        record.signature = self.signing.sign(&record.signed_bytes()).to_bytes();
        record
    }
}

/// Підписане зв'язування ключа обміну учасника з колективом (G12, U1). Ключ підпису
/// передається разом із записом, бо `member_id` рахується саме з нього.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct ExchangeBinding {
    pub sign_pub: [u8; KEY_LEN],
    pub exchange_pub: [u8; KEY_LEN],
    pub collective_id: [u8; ID_LEN],
    pub issued_at: i64,
    pub signature: [u8; SIGNATURE_LEN],
}

impl ExchangeBinding {
    pub const LEN: usize = 2 * KEY_LEN + ID_LEN + 8 + SIGNATURE_LEN;

    fn member_id(&self) -> MemberId {
        sha256(&[labels::MEMBER_ID, &self.sign_pub])
    }

    fn signed_bytes(&self) -> Vec<u8> {
        let mut w =
            Writer::with_capacity(labels::EXCHANGE_BINDING.len() + 2 * KEY_LEN + ID_LEN + 8);
        w.fixed(labels::EXCHANGE_BINDING)
            .fixed(&self.member_id())
            .fixed(&self.exchange_pub)
            .fixed(&self.collective_id)
            .i64(self.issued_at);
        w.finish()
    }

    /// Перевірка підпису учасника і прив'язки до колективу (G12, U2). Лише перевірений
    /// запис дає [`BoundMember`] — без нього не можна ні вступити, ні отримати обгортку.
    pub fn verify(&self, collective_id: &[u8; ID_LEN]) -> Result<BoundMember, Reason> {
        if &self.collective_id != collective_id {
            return Err(Reason::ExchangeNotBound);
        }
        verify(&self.sign_pub, &self.signed_bytes(), &self.signature)
            .map_err(|_| Reason::ExchangeNotBound)?;
        Ok(BoundMember {
            public: MemberPublic {
                sign: self.sign_pub,
                exchange: self.exchange_pub,
            },
            collective_id: self.collective_id,
            issued_at: self.issued_at,
        })
    }

    pub fn to_bytes(&self) -> Vec<u8> {
        let mut w = Writer::with_capacity(Self::LEN);
        w.fixed(&self.sign_pub)
            .fixed(&self.exchange_pub)
            .fixed(&self.collective_id)
            .i64(self.issued_at)
            .fixed(&self.signature);
        w.finish()
    }

    pub fn from_bytes(bytes: &[u8]) -> Result<Self, Reason> {
        let mut r = Reader::new(bytes);
        let binding = Self {
            sign_pub: r.fixed()?,
            exchange_pub: r.fixed()?,
            collective_id: r.fixed()?,
            issued_at: r.i64()?,
            signature: r.fixed()?,
        };
        r.finish()?;
        Ok(binding)
    }
}

/// Учасник із перевіреним зв'язуванням ключа обміну. Створюється лише
/// [`ExchangeBinding::verify`], тому кожна обгортка епохи адресована підтвердженому ключу.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct BoundMember {
    public: MemberPublic,
    collective_id: [u8; ID_LEN],
    issued_at: i64,
}

impl BoundMember {
    pub fn public(&self) -> &MemberPublic {
        &self.public
    }

    pub fn member_id(&self) -> MemberId {
        self.public.member_id()
    }

    pub fn collective_id(&self) -> &[u8; ID_LEN] {
        &self.collective_id
    }

    pub fn issued_at(&self) -> i64 {
        self.issued_at
    }
}

/// Відкритий ключ пристрою (Ed25519).
#[derive(Clone, Copy, Debug, Eq, PartialEq, Hash)]
pub struct DevicePublic(pub [u8; KEY_LEN]);

/// Секретний ключ пристрою; операції підписує саме він.
pub struct DeviceIdentity {
    signing: SigningKey,
}

impl DeviceIdentity {
    pub fn generate() -> Self {
        Self {
            signing: SigningKey::generate(&mut OsRng),
        }
    }

    pub fn from_secret(seed: &[u8; KEY_LEN]) -> Self {
        Self {
            signing: SigningKey::from_bytes(seed),
        }
    }

    pub fn public(&self) -> DevicePublic {
        DevicePublic(self.signing.verifying_key().to_bytes())
    }

    pub fn secret(&self) -> Zeroizing<[u8; KEY_LEN]> {
        Zeroizing::new(self.signing.to_bytes())
    }

    pub(crate) fn sign(&self, message: &[u8]) -> [u8; SIGNATURE_LEN] {
        self.signing.sign(message).to_bytes()
    }
}

/// Перевірка підпису Ed25519 (strict-режим dalek: без слабких ключів і неканонічних S).
pub(crate) fn verify(
    public: &[u8; KEY_LEN],
    message: &[u8],
    signature: &[u8; SIGNATURE_LEN],
) -> Result<(), Reason> {
    let key = VerifyingKey::from_bytes(public).map_err(|_| Reason::Malformed)?;
    let signature = Signature::from_bytes(signature);
    key.verify_strict(message, &signature)
        .map_err(|_| Reason::BadSignature)
}

/// Запис пристрою, підписаний учасником.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct DeviceRecord {
    pub device_pub: [u8; KEY_LEN],
    pub member_id: MemberId,
    pub issued_at: i64,
    pub signature: [u8; SIGNATURE_LEN],
}

impl DeviceRecord {
    fn signed_bytes(&self) -> Vec<u8> {
        let mut w = Writer::with_capacity(labels::DEVICE_RECORD.len() + 2 * KEY_LEN + 8);
        w.fixed(labels::DEVICE_RECORD)
            .fixed(&self.device_pub)
            .fixed(&self.member_id)
            .i64(self.issued_at);
        w.finish()
    }

    /// Ланцюжок «пристрій → учасник»: запис підписаний саме цим учасником.
    pub fn verify(&self, member: &MemberPublic) -> Result<(), Reason> {
        if self.member_id != member.member_id() {
            return Err(Reason::DeviceNotValid);
        }
        verify(&member.sign, &self.signed_bytes(), &self.signature)
            .map_err(|_| Reason::DeviceNotValid)
    }

    pub fn to_bytes(&self) -> Vec<u8> {
        let mut w = Writer::with_capacity(2 * KEY_LEN + 8 + SIGNATURE_LEN);
        w.fixed(&self.device_pub)
            .fixed(&self.member_id)
            .i64(self.issued_at)
            .fixed(&self.signature);
        w.finish()
    }

    pub fn from_bytes(bytes: &[u8]) -> Result<Self, Reason> {
        let mut r = Reader::new(bytes);
        let record = Self {
            device_pub: r.fixed()?,
            member_id: r.fixed()?,
            issued_at: r.i64()?,
            signature: r.fixed()?,
        };
        r.finish()?;
        Ok(record)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn member_id_is_hash_of_label_and_signing_key() {
        let member = MemberIdentity::generate();
        let public = member.public();
        assert_eq!(
            member.member_id(),
            sha256(&[labels::MEMBER_ID, &public.sign])
        );
        assert_ne!(
            public.sign, public.exchange,
            "окрема пара X25519, не виведена з Ed25519"
        );
    }

    #[test]
    fn secrets_round_trip() {
        let member = MemberIdentity::generate();
        let (seed, exchange) = member.secrets();
        let restored = MemberIdentity::from_secrets(&seed, &exchange);
        assert_eq!(restored.public(), member.public());
        let device = DeviceIdentity::generate();
        assert_eq!(
            DeviceIdentity::from_secret(&device.secret()).public(),
            device.public()
        );
    }

    #[test]
    fn exchange_binding_is_signed_by_member_for_one_collective() {
        let member = MemberIdentity::generate();
        let other = MemberIdentity::generate();
        let collective = [7u8; ID_LEN];
        let binding = member.bind_exchange(collective, 1_700_000_000);
        let bound = binding.verify(&collective).unwrap();
        assert_eq!(bound.public(), &member.public());
        assert_eq!(bound.member_id(), member.member_id());
        assert_eq!(bound.issued_at(), 1_700_000_000);
        assert_eq!(
            ExchangeBinding::from_bytes(&binding.to_bytes()).unwrap(),
            binding
        );
        assert_eq!(binding.to_bytes().len(), ExchangeBinding::LEN);

        // Інший колектив, підмінений ключ обміну, час чи ключ підпису — запис недійсний.
        assert_eq!(
            binding.verify(&[8u8; ID_LEN]).unwrap_err(),
            Reason::ExchangeNotBound
        );
        let mut swapped = binding;
        swapped.exchange_pub = other.public().exchange;
        assert_eq!(
            swapped.verify(&collective).unwrap_err(),
            Reason::ExchangeNotBound
        );
        let mut later = binding;
        later.issued_at += 1;
        assert_eq!(
            later.verify(&collective).unwrap_err(),
            Reason::ExchangeNotBound
        );
        let mut stolen = binding;
        stolen.sign_pub = other.public().sign;
        assert_eq!(
            stolen.verify(&collective).unwrap_err(),
            Reason::ExchangeNotBound
        );
        assert_eq!(
            ExchangeBinding::from_bytes(&binding.to_bytes()[..ExchangeBinding::LEN - 1])
                .unwrap_err(),
            Reason::Malformed
        );
    }

    #[test]
    fn exchange_binding_label_differs_from_device_record() {
        // Підпис запису пристрою не можна видати за зв'язування й навпаки: різні мітки.
        assert_ne!(labels::EXCHANGE_BINDING, labels::DEVICE_RECORD);
        let member = MemberIdentity::generate();
        let binding = member.bind_exchange([1u8; ID_LEN], 5);
        assert!(binding.signed_bytes().starts_with(labels::EXCHANGE_BINDING));
    }

    #[test]
    fn device_record_verifies_only_for_issuing_member() {
        let member = MemberIdentity::generate();
        let other = MemberIdentity::generate();
        let device = DeviceIdentity::generate();
        let record = member.issue_device(&device.public(), 1_700_000_000);
        record.verify(&member.public()).unwrap();
        assert_eq!(
            record.verify(&other.public()).unwrap_err(),
            Reason::DeviceNotValid
        );
        let parsed = DeviceRecord::from_bytes(&record.to_bytes()).unwrap();
        assert_eq!(parsed, record);
        let mut forged = record;
        forged.issued_at += 1;
        assert_eq!(
            forged.verify(&member.public()).unwrap_err(),
            Reason::DeviceNotValid
        );
    }
}
