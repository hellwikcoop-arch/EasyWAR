//! Підписана локальна квитанція `STORED` для одного `EnvelopeV1`. Підпис не
//! підтверджує доставку одержувачу, застосування операції чи дозвіл WAN.

use super::codec::{Reader, Writer};
use super::envelope::Envelope;
use super::identity::{self, DeviceIdentity, DevicePublic};
use super::{sha256, PacketRejected, ID_LEN, KEY_LEN, SIGNATURE_LEN};

const LABEL: &[u8] = b"easywar/collective/v1/stored-receipt";
const VERSION: u16 = 1;
pub const RECEIPT_LEN: usize = 2 + 3 * ID_LEN + 2 * KEY_LEN + 8 + SIGNATURE_LEN;

/// Квитанція конкретного relay, підписана його ключем пристрою. Відправник
/// мусить отримати очікуваний відкритий ключ relay із довіреного каналу.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct StoredReceipt {
    pub version: u16,
    pub collective_id: [u8; ID_LEN],
    pub recipient_scope: [u8; ID_LEN],
    pub envelope_id: [u8; ID_LEN],
    pub digest: [u8; KEY_LEN],
    pub expires_at: i64,
    pub relay_pub: [u8; KEY_LEN],
    pub signature: [u8; SIGNATURE_LEN],
}

impl StoredReceipt {
    pub(crate) fn sign(
        relay: &DeviceIdentity,
        envelope: &Envelope,
        digest: [u8; KEY_LEN],
        expires_at: i64,
    ) -> Self {
        let mut receipt = Self {
            version: VERSION,
            collective_id: envelope.header.collective_id,
            recipient_scope: envelope.header.recipient_scope,
            envelope_id: envelope.header.envelope_id,
            digest,
            expires_at,
            relay_pub: relay.public().0,
            signature: [0; SIGNATURE_LEN],
        };
        receipt.signature = relay.sign(&receipt.signed_message());
        receipt
    }

    fn unsigned_bytes(&self) -> Vec<u8> {
        let mut writer = Writer::with_capacity(RECEIPT_LEN - SIGNATURE_LEN);
        writer
            .u16(self.version)
            .fixed(&self.collective_id)
            .fixed(&self.recipient_scope)
            .fixed(&self.envelope_id)
            .fixed(&self.digest)
            .i64(self.expires_at)
            .fixed(&self.relay_pub);
        writer.finish()
    }

    fn signed_message(&self) -> Vec<u8> {
        let unsigned = self.unsigned_bytes();
        let mut message = Vec::with_capacity(LABEL.len() + unsigned.len());
        message.extend_from_slice(LABEL);
        message.extend_from_slice(&unsigned);
        message
    }

    pub fn to_bytes(&self) -> Vec<u8> {
        let mut bytes = self.unsigned_bytes();
        bytes.extend_from_slice(&self.signature);
        bytes
    }

    pub fn from_bytes(bytes: &[u8]) -> Result<Self, PacketRejected> {
        if bytes.len() != RECEIPT_LEN {
            return Err(PacketRejected);
        }
        let mut reader = Reader::new(bytes);
        let receipt = Self {
            version: reader.u16().map_err(PacketRejected::from)?,
            collective_id: reader.fixed().map_err(PacketRejected::from)?,
            recipient_scope: reader.fixed().map_err(PacketRejected::from)?,
            envelope_id: reader.fixed().map_err(PacketRejected::from)?,
            digest: reader.fixed().map_err(PacketRejected::from)?,
            expires_at: reader.i64().map_err(PacketRejected::from)?,
            relay_pub: reader.fixed().map_err(PacketRejected::from)?,
            signature: reader.fixed().map_err(PacketRejected::from)?,
        };
        reader.finish().map_err(PacketRejected::from)?;
        if receipt.version != VERSION {
            return Err(PacketRejected);
        }
        Ok(receipt)
    }

    /// Перевіряє підпис, зафіксований ключ relay, строк і точні байти конверта.
    /// Навіть успішна перевірка означає лише заяву relay про локальний запис.
    pub fn verify(
        &self,
        expected_relay: &DevicePublic,
        envelope_bytes: &[u8],
        now: i64,
    ) -> Result<(), PacketRejected> {
        let envelope = Envelope::from_bytes(envelope_bytes).map_err(PacketRejected::from)?;
        if self.version != VERSION
            || self.relay_pub != expected_relay.0
            || self.expires_at <= now
            || self.collective_id != envelope.header.collective_id
            || self.recipient_scope != envelope.header.recipient_scope
            || self.envelope_id != envelope.header.envelope_id
            || self.digest != sha256(&[envelope_bytes])
        {
            return Err(PacketRejected);
        }
        identity::verify(&expected_relay.0, &self.signed_message(), &self.signature)
            .map_err(PacketRejected::from)
    }
}
