//! C2p preflight: a candidate's signed public-key proof for one collective.
//!
//! This is NOT an invitation, owner approval, member admission, permission, or
//! LAN handshake. A verified proof may only be presented to an explicit
//! authorization flow. Never apply a membership event from this proof alone.
//! No private keys, profile names, or operational data enter this structure.

use super::codec::{Reader, Writer};
use super::epoch::CollectiveId;
use super::identity::{DeviceIdentity, DeviceRecord, ExchangeBinding, MemberId, MemberIdentity};
use super::{Reason, KEY_LEN, PROTOCOL_VERSION, SIGNATURE_LEN, SUITE};

const DEVICE_RECORD_LEN: usize = 2 * KEY_LEN + 8 + SIGNATURE_LEN;

/// Canonical length-prefixed-by-version, fixed-size candidate proof.
/// Only two existing separately domain-separated Ed25519 signed records.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct CandidateProof {
    pub binding: ExchangeBinding,
    pub device: DeviceRecord,
}

impl CandidateProof {
    /// Two u16 protocol fields, exchange binding and device proof.
    pub const LEN: usize = 2 + 2 + ExchangeBinding::LEN + DEVICE_RECORD_LEN;

    /// Created inside Rust from the candidate's local secret store.
    /// Caller MUST NOT treat this as membership or an invitation.
    pub fn create(
        member: &MemberIdentity,
        device: &DeviceIdentity,
        collective_id: CollectiveId,
        issued_at: i64,
    ) -> Self {
        Self {
            binding: member.bind_exchange(collective_id, issued_at),
            device: member.issue_device(&device.public(), issued_at),
        }
    }

    pub fn member_id(&self) -> Result<MemberId, Reason> {
        Ok(self
            .binding
            .verify(&self.binding.collective_id)?
            .member_id())
    }

    /// Strict signed-key consistency, bound to the *expected* collective.
    /// The current time and one-use invitation nonce must be enforced by the
    /// future owner-authorized admission path, NOT by this standalone proof.
    pub fn verify(&self, expected_collective: &CollectiveId) -> Result<MemberId, Reason> {
        let bound = self.binding.verify(expected_collective)?;
        self.device.verify(bound.public())?;
        if self.binding.issued_at != self.device.issued_at {
            return Err(Reason::Malformed);
        }
        Ok(bound.member_id())
    }

    pub fn to_bytes(&self) -> Vec<u8> {
        let mut writer = Writer::with_capacity(Self::LEN);
        writer
            .u16(PROTOCOL_VERSION)
            .u16(SUITE)
            .fixed(&self.binding.to_bytes())
            .fixed(&self.device.to_bytes());
        writer.finish()
    }

    /// Fail-closed decoding: exact length, version, suite, canonical fields,
    /// two valid signatures, one member and one collective. Never adds a member.
    pub fn from_bytes(bytes: &[u8], expected_collective: &CollectiveId) -> Result<Self, Reason> {
        if bytes.len() != Self::LEN {
            return Err(Reason::Malformed);
        }
        let mut reader = Reader::new(bytes);
        if reader.u16()? != PROTOCOL_VERSION || reader.u16()? != SUITE {
            return Err(Reason::UnsupportedVersion);
        }
        let binding_bytes: [u8; ExchangeBinding::LEN] = reader.fixed()?;
        let device_bytes: [u8; DEVICE_RECORD_LEN] = reader.fixed()?;
        reader.finish()?;
        let proof = Self {
            binding: ExchangeBinding::from_bytes(&binding_bytes)?,
            device: DeviceRecord::from_bytes(&device_bytes)?,
        };
        proof.verify(expected_collective)?;
        Ok(proof)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const GROUP: CollectiveId = [7; 16];
    const OTHER_GROUP: CollectiveId = [8; 16];
    const WHEN: i64 = 1_761_768_000;

    #[test]
    fn candidate_can_prove_ownership_of_member_and_device_keys() {
        let alice = MemberIdentity::generate();
        let device = DeviceIdentity::generate();
        let proof = CandidateProof::create(&alice, &device, GROUP, WHEN);
        let bytes = proof.to_bytes();
        assert_eq!(bytes.len(), CandidateProof::LEN);
        assert_eq!(CandidateProof::from_bytes(&bytes, &GROUP).unwrap(), proof);
        assert_eq!(proof.verify(&GROUP).unwrap(), alice.member_id());
        assert_eq!(proof.member_id().unwrap(), alice.member_id());
        assert_eq!(proof.device.member_id, alice.member_id());
    }

    #[test]
    fn different_collective_or_foreign_device_is_never_accepted() {
        let alice = MemberIdentity::generate();
        let bob = MemberIdentity::generate();
        let a = DeviceIdentity::generate();
        let b = DeviceIdentity::generate();
        let proof = CandidateProof::create(&alice, &a, GROUP, WHEN);
        assert_eq!(proof.verify(&OTHER_GROUP), Err(Reason::ExchangeNotBound));
        assert_eq!(
            CandidateProof::from_bytes(&proof.to_bytes(), &OTHER_GROUP),
            Err(Reason::ExchangeNotBound)
        );
        let mut mixed = proof;
        mixed.device = bob.issue_device(&b.public(), WHEN);
        assert_eq!(mixed.verify(&GROUP), Err(Reason::DeviceNotValid));
        // Even a valid device grant by Alice at another time is not this proof.
        mixed.device = alice.issue_device(&b.public(), WHEN + 1);
        assert_eq!(mixed.verify(&GROUP), Err(Reason::Malformed));
    }

    #[test]
    fn malformed_version_truncation_extension_and_tampering_fail_closed() {
        let member = MemberIdentity::generate();
        let device = DeviceIdentity::generate();
        let bytes = CandidateProof::create(&member, &device, GROUP, WHEN).to_bytes();
        for invalid in [
            Vec::new(),
            bytes[..bytes.len() - 1].to_vec(),
            [bytes.as_slice(), &[0u8]].concat(),
        ] {
            assert_eq!(
                CandidateProof::from_bytes(&invalid, &GROUP),
                Err(Reason::Malformed)
            );
        }
        let mut version = bytes.clone();
        version[1] = 2;
        assert_eq!(
            CandidateProof::from_bytes(&version, &GROUP),
            Err(Reason::UnsupportedVersion)
        );
        let mut suite = bytes.clone();
        suite[3] = 2;
        assert_eq!(
            CandidateProof::from_bytes(&suite, &GROUP),
            Err(Reason::UnsupportedVersion)
        );
        let mut changed_key = bytes.clone();
        changed_key[4 + KEY_LEN] ^= 1;
        assert_eq!(
            CandidateProof::from_bytes(&changed_key, &GROUP),
            Err(Reason::ExchangeNotBound)
        );
        let mut changed_signature = bytes.clone();
        changed_signature[bytes.len() - 1] ^= 1;
        assert_eq!(
            CandidateProof::from_bytes(&changed_signature, &GROUP),
            Err(Reason::DeviceNotValid)
        );
    }
}
