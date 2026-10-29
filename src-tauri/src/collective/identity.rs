//! Ідентичність (ADR, 2.2): ключ учасника (Ed25519 для підпису + окрема пара X25519 для
//! обгорток) і ключ пристрою (Ed25519), запис якого підписує учасник.

use argon2::password_hash::rand_core::OsRng;
use ed25519_dalek::{Signature, Signer, SigningKey, VerifyingKey};
use x25519_dalek::{PublicKey, StaticSecret};
use zeroize::Zeroizing;

use super::codec::{Reader, Writer};
use super::{labels, sha256, Reason, KEY_LEN, SIGNATURE_LEN};

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
