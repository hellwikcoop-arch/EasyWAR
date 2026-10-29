//! Конверт операції `EnvelopeV1` (ADR, 2.4). Відкриті поля — лише `v`, `suite`,
//! `collective_id`, `envelope_id`, `epoch`, `nonce`, `recipient_scope`; AAD = канонічне
//! кодування всіх відкритих полів. Усе інше — всередині шифротексту разом із підписом
//! пристрою над канонічним payload з префіксом `easywar/collective/v1/op`.

use chacha20poly1305::aead::{Aead, KeyInit, Payload as AeadPayload};
use chacha20poly1305::{Key, XChaCha20Poly1305, XNonce};
use zeroize::Zeroizing;

use super::codec::{Reader, Writer};
use super::epoch::{CollectiveId, EpochKey};
use super::identity::{self, DeviceIdentity, MemberId};
use super::{
    labels, random_array, sha256, Reason, ID_LEN, KEY_LEN, NONCE_LEN, PROTOCOL_VERSION,
    SIGNATURE_LEN, SUITE,
};

/// Клас операції перевіряється одержувачем усередині payload (C06); значення — з
/// `src/sensitivity-core.js` (A–D), тут лише непрозорий байт.
pub type OperationClass = u8;

/// Відкриті поля конверта. Довжина заголовка стала: 2 + 2 + 16 + 16 + 4 + 24 + 16 = 80 байтів.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct EnvelopeHeader {
    pub v: u16,
    pub suite: u16,
    pub collective_id: CollectiveId,
    pub envelope_id: [u8; ID_LEN],
    pub epoch: u32,
    pub nonce: [u8; NONCE_LEN],
    /// Непрозорий випадковий ID одержувачів або нулі для всього колективу.
    pub recipient_scope: [u8; ID_LEN],
}

pub const HEADER_LEN: usize = 2 + 2 + ID_LEN + ID_LEN + 4 + NONCE_LEN + ID_LEN;

impl EnvelopeHeader {
    pub fn new(collective_id: CollectiveId, epoch: u32, recipient_scope: [u8; ID_LEN]) -> Self {
        Self {
            v: PROTOCOL_VERSION,
            suite: SUITE,
            collective_id,
            envelope_id: random_array(),
            epoch,
            nonce: random_array(),
            recipient_scope,
        }
    }

    /// AAD: усі відкриті поля в сталому порядку (ADR, розділ 3).
    pub fn aad(&self) -> [u8; HEADER_LEN] {
        let mut w = Writer::with_capacity(HEADER_LEN);
        w.u16(self.v)
            .u16(self.suite)
            .fixed(&self.collective_id)
            .fixed(&self.envelope_id)
            .u32(self.epoch)
            .fixed(&self.nonce)
            .fixed(&self.recipient_scope);
        w.finish().try_into().expect("довжина заголовка стала")
    }

    fn read(r: &mut Reader<'_>) -> Result<Self, Reason> {
        let header = Self {
            v: r.u16()?,
            suite: r.u16()?,
            collective_id: r.fixed()?,
            envelope_id: r.fixed()?,
            epoch: r.u32()?,
            nonce: r.fixed()?,
            recipient_scope: r.fixed()?,
        };
        if header.v != PROTOCOL_VERSION || header.suite != SUITE {
            return Err(Reason::UnsupportedVersion);
        }
        Ok(header)
    }
}

/// Зміст конверта до підпису. `op` — повний рядок операції C1b у канонічному вигляді
/// (непрозорі байти для цього модуля); `client_time` — довідкове поле, не критерій
/// авторизації; `membership_seq` — останній запис журналу складу, який бачив автор.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Payload {
    pub op: Vec<u8>,
    pub author_member_id: MemberId,
    pub device_pub: [u8; KEY_LEN],
    pub client_time: i64,
    pub class: OperationClass,
    pub table_id: [u8; ID_LEN],
    pub op_id: [u8; ID_LEN],
    pub membership_seq: u64,
    /// JE-16 варіант (а): термін лише всередині шифротексту.
    pub expiry: Option<i64>,
}

impl Payload {
    /// Канонічне кодування без підпису — вхід для підпису й для `op_digest`.
    pub fn canonical(&self) -> Vec<u8> {
        let mut w = Writer::with_capacity(self.op.len() + 128);
        w.var(&self.op)
            .fixed(&self.author_member_id)
            .fixed(&self.device_pub)
            .i64(self.client_time)
            .u8(self.class)
            .fixed(&self.table_id)
            .fixed(&self.op_id)
            .u64(self.membership_seq)
            .option_i64(self.expiry);
        w.finish()
    }

    fn read(r: &mut Reader<'_>) -> Result<Self, Reason> {
        Ok(Self {
            op: r.var()?.to_vec(),
            author_member_id: r.fixed()?,
            device_pub: r.fixed()?,
            client_time: r.i64()?,
            class: r.u8()?,
            table_id: r.fixed()?,
            op_id: r.fixed()?,
            membership_seq: r.u64()?,
            expiry: r.option_i64()?,
        })
    }

    /// `op_digest = SHA-256(канонічне кодування підписаного payload без підпису)`: не
    /// залежить від nonce, епохи й шляху доставки (ADR, 2.4, рівень 2).
    pub fn op_digest(&self) -> [u8; KEY_LEN] {
        sha256(&[&self.canonical()])
    }

    fn signed_message(canonical: &[u8]) -> Vec<u8> {
        let mut message = Vec::with_capacity(labels::OPERATION.len() + canonical.len());
        message.extend_from_slice(labels::OPERATION);
        message.extend_from_slice(canonical);
        message
    }

    /// Підпис пристрою над `"easywar/collective/v1/op" ‖ canonical`.
    pub fn sign(self, device: &DeviceIdentity) -> SignedPayload {
        let canonical = self.canonical();
        let signature = device.sign(&Self::signed_message(&canonical));
        SignedPayload {
            payload: self,
            signature,
        }
    }
}

/// Payload із підписом пристрою.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct SignedPayload {
    pub payload: Payload,
    pub signature: [u8; SIGNATURE_LEN],
}

impl SignedPayload {
    pub fn to_bytes(&self) -> Vec<u8> {
        let mut bytes = self.payload.canonical();
        bytes.extend_from_slice(&self.signature);
        bytes
    }

    pub fn from_bytes(bytes: &[u8]) -> Result<Self, Reason> {
        let mut r = Reader::new(bytes);
        let payload = Payload::read(&mut r)?;
        let signature = r.fixed()?;
        r.finish()?;
        Ok(Self { payload, signature })
    }

    /// Перевірка підпису ключем пристрою, зазначеним у payload. Відповідність пристрою
    /// учасникові й журналу складу перевіряє `replay::receive`.
    pub fn verify_signature(&self) -> Result<(), Reason> {
        let message = Payload::signed_message(&self.payload.canonical());
        identity::verify(&self.payload.device_pub, &message, &self.signature)
    }
}

/// Готовий конверт: заголовок + шифротекст із тегом.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Envelope {
    pub header: EnvelopeHeader,
    pub ciphertext: Vec<u8>,
}

impl Envelope {
    pub fn to_bytes(&self) -> Vec<u8> {
        let mut bytes = Vec::with_capacity(HEADER_LEN + self.ciphertext.len());
        bytes.extend_from_slice(&self.header.aad());
        bytes.extend_from_slice(&self.ciphertext);
        bytes
    }

    /// Розбір відкритих полів без розшифрування; інша версія → відмова одразу.
    pub fn from_bytes(bytes: &[u8]) -> Result<Self, Reason> {
        let mut r = Reader::new(bytes);
        let header = EnvelopeHeader::read(&mut r)?;
        let ciphertext = r.rest().to_vec();
        if ciphertext.len() < super::TAG_LEN {
            return Err(Reason::Malformed);
        }
        Ok(Self { header, ciphertext })
    }
}

/// Шифрує підписаний payload ключем епохи під заданим заголовком (nonce і `envelope_id` —
/// із заголовка, тож повторне шифрування тієї самої операції дає інший конверт).
pub fn seal(key: &EpochKey, header: EnvelopeHeader, signed: &SignedPayload) -> Envelope {
    let ciphertext = XChaCha20Poly1305::new(&Key::from(*key.as_bytes()))
        .encrypt(
            &XNonce::from(header.nonce),
            AeadPayload {
                msg: &signed.to_bytes(),
                aad: &header.aad(),
            },
        )
        .expect("XChaCha20-Poly1305 не відмовляє на довільній довжині");
    Envelope { header, ciphertext }
}

/// Розшифровує конверт і перевіряє підпис пристрою. Ключ епохи добирає той, хто викликає
/// (невідома епоха → [`Reason::UnknownEpoch`] ще до виклику).
pub fn open(key: &EpochKey, envelope: &Envelope) -> Result<SignedPayload, Reason> {
    if envelope.header.v != PROTOCOL_VERSION || envelope.header.suite != SUITE {
        return Err(Reason::UnsupportedVersion);
    }
    let plain = XChaCha20Poly1305::new(&Key::from(*key.as_bytes()))
        .decrypt(
            &XNonce::from(envelope.header.nonce),
            AeadPayload {
                msg: &envelope.ciphertext,
                aad: &envelope.header.aad(),
            },
        )
        .map_err(|_| Reason::AuthenticationFailed)?;
    let plain = Zeroizing::new(plain);
    let signed = SignedPayload::from_bytes(&plain)?;
    signed.verify_signature()?;
    Ok(signed)
}

#[cfg(test)]
pub(crate) fn sample_payload(device: &DeviceIdentity, member_id: MemberId, seq: u64) -> Payload {
    Payload {
        op: b"{\"row\":\"synthetic\",\"value\":1}".to_vec(),
        author_member_id: member_id,
        device_pub: device.public().0,
        client_time: 1_761_700_000,
        class: b'B',
        table_id: [7; ID_LEN],
        op_id: [8; ID_LEN],
        membership_seq: seq,
        expiry: None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::collective::identity::MemberIdentity;

    fn fixture() -> (EpochKey, EnvelopeHeader, SignedPayload) {
        let member = MemberIdentity::generate();
        let device = DeviceIdentity::generate();
        let key = EpochKey::generate();
        let header = EnvelopeHeader::new([1; ID_LEN], 0, [0; ID_LEN]);
        let signed = sample_payload(&device, member.member_id(), 5).sign(&device);
        (key, header, signed)
    }

    #[test]
    fn seal_open_round_trip_and_wire_format() {
        let (key, header, signed) = fixture();
        let envelope = seal(&key, header, &signed);
        let bytes = envelope.to_bytes();
        assert_eq!(&bytes[..HEADER_LEN], &header.aad());
        let parsed = Envelope::from_bytes(&bytes).unwrap();
        assert_eq!(parsed, envelope);
        let opened = open(&key, &parsed).unwrap();
        assert_eq!(opened, signed);
        assert_eq!(opened.payload.op_digest(), signed.payload.op_digest());
    }

    #[test]
    fn every_open_field_is_authenticated() {
        let (key, header, signed) = fixture();
        let envelope = seal(&key, header, &signed);
        let mutate = |f: &dyn Fn(&mut Envelope)| {
            let mut e = envelope.clone();
            f(&mut e);
            open(&key, &e).unwrap_err()
        };
        assert_eq!(
            mutate(&|e| e.header.collective_id[0] ^= 1),
            Reason::AuthenticationFailed
        );
        assert_eq!(
            mutate(&|e| e.header.envelope_id[0] ^= 1),
            Reason::AuthenticationFailed
        );
        assert_eq!(
            mutate(&|e| e.header.epoch += 1),
            Reason::AuthenticationFailed
        );
        assert_eq!(
            mutate(&|e| e.header.recipient_scope[3] ^= 1),
            Reason::AuthenticationFailed
        );
        assert_eq!(
            mutate(&|e| e.header.nonce[0] ^= 1),
            Reason::AuthenticationFailed
        );
        assert_eq!(
            mutate(&|e| e.ciphertext[0] ^= 1),
            Reason::AuthenticationFailed
        );
        assert_eq!(mutate(&|e| e.header.v = 2), Reason::UnsupportedVersion);
        assert_eq!(mutate(&|e| e.header.suite = 2), Reason::UnsupportedVersion);
        let other = EpochKey::generate();
        assert_eq!(
            open(&other, &envelope).unwrap_err(),
            Reason::AuthenticationFailed
        );
    }

    #[test]
    fn version_mismatch_is_rejected_before_decryption() {
        let (key, header, signed) = fixture();
        let bytes = seal(&key, header, &signed).to_bytes();
        let mut other_version = bytes.clone();
        other_version[1] = 2;
        assert_eq!(
            Envelope::from_bytes(&other_version).unwrap_err(),
            Reason::UnsupportedVersion
        );
        assert_eq!(
            Envelope::from_bytes(&bytes[..HEADER_LEN + 3]).unwrap_err(),
            Reason::Malformed
        );
    }

    #[test]
    fn signature_binds_payload_to_device() {
        let (key, header, signed) = fixture();
        let other_device = DeviceIdentity::generate();
        let mut tampered = signed.clone();
        tampered.payload.op = b"{\"row\":\"synthetic\",\"value\":2}".to_vec();
        let envelope = seal(&key, header, &tampered);
        assert_eq!(open(&key, &envelope).unwrap_err(), Reason::BadSignature);
        let mut swapped = signed.clone();
        swapped.payload.device_pub = other_device.public().0;
        let envelope = seal(&key, header, &swapped);
        assert_eq!(open(&key, &envelope).unwrap_err(), Reason::BadSignature);
        let bytes = signed.to_bytes();
        assert_eq!(SignedPayload::from_bytes(&bytes).unwrap(), signed);
        assert_eq!(
            SignedPayload::from_bytes(&bytes[..bytes.len() - 1]).unwrap_err(),
            Reason::Malformed
        );
    }

    #[test]
    fn reencryption_changes_ciphertext_but_not_op_digest() {
        let (key, header, signed) = fixture();
        let first = seal(&key, header, &signed);
        let second = seal(
            &key,
            EnvelopeHeader::new(header.collective_id, 0, header.recipient_scope),
            &signed,
        );
        assert_ne!(first.header.envelope_id, second.header.envelope_id);
        assert_ne!(first.ciphertext, second.ciphertext);
        assert_eq!(
            open(&key, &first).unwrap().payload.op_digest(),
            open(&key, &second).unwrap().payload.op_digest()
        );
    }
}
