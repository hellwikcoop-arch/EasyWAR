//! Ключ епохи та обгортки для учасників (ADR, 2.3, варіант Б):
//! `shared = X25519(eph_priv, member_pub)`, `kek = HKDF-SHA256(shared, salt = collective_id ‖ epoch,
//! info = "easywar/collective/v1/epoch-wrap")`, `wrapped = XChaCha20-Poly1305(kek, nonce, epoch_key,
//! aad = заголовок обгортки)`.

use argon2::password_hash::rand_core::OsRng;
use chacha20poly1305::aead::{Aead, KeyInit, Payload};
use chacha20poly1305::{Key, XChaCha20Poly1305, XNonce};
use x25519_dalek::{EphemeralSecret, PublicKey, StaticSecret};
use zeroize::Zeroizing;

use super::codec::{Reader, Writer};
use super::identity::{MemberId, MemberIdentity};
use super::{hkdf, labels, random_array, Reason, ID_LEN, KEY_LEN, NONCE_LEN, TAG_LEN};

/// Ідентифікатор колективу: 16 випадкових байтів.
pub type CollectiveId = [u8; ID_LEN];

/// Ключ епохи: 32 байти з ОС-генератора; затирається при знищенні.
pub struct EpochKey(Zeroizing<[u8; KEY_LEN]>);

impl EpochKey {
    pub fn generate() -> Self {
        Self(Zeroizing::new(random_array()))
    }

    pub fn from_bytes(bytes: [u8; KEY_LEN]) -> Self {
        Self(Zeroizing::new(bytes))
    }

    pub fn as_bytes(&self) -> &[u8; KEY_LEN] {
        &self.0
    }
}

impl std::fmt::Debug for EpochKey {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("EpochKey(<прихований>)")
    }
}

/// Обгортка ключа епохи для одного учасника. Відкриті поля — `eph_pub`, `epoch`,
/// `collective_id`, `member_id`, `nonce`; усі вони входять в AAD.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct EpochWrap {
    pub collective_id: CollectiveId,
    pub epoch: u32,
    pub member_id: MemberId,
    pub eph_pub: [u8; KEY_LEN],
    pub nonce: [u8; NONCE_LEN],
    pub wrapped: Vec<u8>,
}

impl EpochWrap {
    fn header_bytes(&self) -> Vec<u8> {
        let mut w = Writer::with_capacity(ID_LEN + 4 + 2 * KEY_LEN + NONCE_LEN);
        w.fixed(&self.collective_id)
            .u32(self.epoch)
            .fixed(&self.member_id)
            .fixed(&self.eph_pub)
            .fixed(&self.nonce);
        w.finish()
    }

    pub fn to_bytes(&self) -> Vec<u8> {
        let mut bytes = self.header_bytes();
        bytes.extend_from_slice(&self.wrapped);
        bytes
    }

    pub fn from_bytes(bytes: &[u8]) -> Result<Self, Reason> {
        let mut r = Reader::new(bytes);
        let wrap = Self {
            collective_id: r.fixed()?,
            epoch: r.u32()?,
            member_id: r.fixed()?,
            eph_pub: r.fixed()?,
            nonce: r.fixed()?,
            wrapped: r.rest().to_vec(),
        };
        if wrap.wrapped.len() != KEY_LEN + TAG_LEN {
            return Err(Reason::Malformed);
        }
        Ok(wrap)
    }
}

fn kek(
    shared: &[u8; KEY_LEN],
    collective_id: &CollectiveId,
    epoch: u32,
) -> Zeroizing<[u8; KEY_LEN]> {
    let mut salt = Vec::with_capacity(ID_LEN + 4);
    salt.extend_from_slice(collective_id);
    salt.extend_from_slice(&epoch.to_be_bytes());
    hkdf(shared, &salt, labels::EPOCH_WRAP)
}

/// Обгортає ключ епохи для учасника з ефемерним ключем X25519 (одноразовий, затирається).
pub fn wrap_epoch_key(
    key: &EpochKey,
    collective_id: CollectiveId,
    epoch: u32,
    member_id: MemberId,
    member_exchange_pub: &[u8; KEY_LEN],
) -> EpochWrap {
    let eph = EphemeralSecret::random_from_rng(OsRng);
    let eph_pub = PublicKey::from(&eph).to_bytes();
    let shared = eph.diffie_hellman(&PublicKey::from(*member_exchange_pub));
    wrap_with(
        key,
        collective_id,
        epoch,
        member_id,
        eph_pub,
        shared.as_bytes(),
        random_array(),
    )
}

fn wrap_with(
    key: &EpochKey,
    collective_id: CollectiveId,
    epoch: u32,
    member_id: MemberId,
    eph_pub: [u8; KEY_LEN],
    shared: &[u8; KEY_LEN],
    nonce: [u8; NONCE_LEN],
) -> EpochWrap {
    let mut wrap = EpochWrap {
        collective_id,
        epoch,
        member_id,
        eph_pub,
        nonce,
        wrapped: Vec::new(),
    };
    let kek = kek(shared, &collective_id, epoch);
    wrap.wrapped = XChaCha20Poly1305::new(&Key::from(*kek))
        .encrypt(
            &XNonce::from(nonce),
            Payload {
                msg: key.as_bytes(),
                aad: &wrap.header_bytes(),
            },
        )
        .expect("XChaCha20-Poly1305 не відмовляє на 32 байтах");
    wrap
}

/// Розгортає ключ епохи секретом X25519 учасника. Чужа обгортка → [`Reason::WrongRecipient`].
pub fn unwrap_epoch_key(wrap: &EpochWrap, member: &MemberIdentity) -> Result<EpochKey, Reason> {
    if wrap.member_id != member.member_id() {
        return Err(Reason::WrongRecipient);
    }
    unwrap_with(wrap, member.exchange_secret())
}

fn unwrap_with(wrap: &EpochWrap, secret: &StaticSecret) -> Result<EpochKey, Reason> {
    let shared = secret.diffie_hellman(&PublicKey::from(wrap.eph_pub));
    let kek = kek(shared.as_bytes(), &wrap.collective_id, wrap.epoch);
    let plain = XChaCha20Poly1305::new(&Key::from(*kek))
        .decrypt(
            &XNonce::from(wrap.nonce),
            Payload {
                msg: &wrap.wrapped,
                aad: &wrap.header_bytes(),
            },
        )
        .map_err(|_| Reason::AuthenticationFailed)?;
    let plain = Zeroizing::new(plain);
    let bytes: [u8; KEY_LEN] = plain.as_slice().try_into().map_err(|_| Reason::Malformed)?;
    Ok(EpochKey::from_bytes(bytes))
}

/// Детерміноване обгортання для тестових векторів (ефемерний секрет і nonce задані).
#[cfg(test)]
pub(crate) fn wrap_deterministic(
    key: &EpochKey,
    collective_id: CollectiveId,
    epoch: u32,
    member_id: MemberId,
    member_exchange_pub: &[u8; KEY_LEN],
    eph_secret: [u8; KEY_LEN],
    nonce: [u8; NONCE_LEN],
) -> EpochWrap {
    let eph = StaticSecret::from(eph_secret);
    let eph_pub = PublicKey::from(&eph).to_bytes();
    let shared = eph.diffie_hellman(&PublicKey::from(*member_exchange_pub));
    wrap_with(
        key,
        collective_id,
        epoch,
        member_id,
        eph_pub,
        shared.as_bytes(),
        nonce,
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn member_unwraps_own_wrap_only() {
        let alice = MemberIdentity::generate();
        let bob = MemberIdentity::generate();
        let key = EpochKey::generate();
        let collective = random_array();
        let wrap = wrap_epoch_key(
            &key,
            collective,
            3,
            alice.member_id(),
            &alice.public().exchange,
        );
        assert_eq!(
            unwrap_epoch_key(&wrap, &alice).unwrap().as_bytes(),
            key.as_bytes()
        );
        assert_eq!(
            unwrap_epoch_key(&wrap, &bob).unwrap_err(),
            Reason::WrongRecipient
        );
        let mut forged = wrap.clone();
        forged.member_id = bob.member_id();
        assert_eq!(
            unwrap_epoch_key(&forged, &bob).unwrap_err(),
            Reason::AuthenticationFailed
        );
    }

    #[test]
    fn any_open_field_change_breaks_the_tag() {
        let alice = MemberIdentity::generate();
        let key = EpochKey::generate();
        let wrap = wrap_epoch_key(
            &key,
            [1; ID_LEN],
            0,
            alice.member_id(),
            &alice.public().exchange,
        );
        let mut epoch = wrap.clone();
        epoch.epoch = 1;
        assert_eq!(
            unwrap_epoch_key(&epoch, &alice).unwrap_err(),
            Reason::AuthenticationFailed
        );
        let mut collective = wrap.clone();
        collective.collective_id[0] ^= 1;
        assert_eq!(
            unwrap_epoch_key(&collective, &alice).unwrap_err(),
            Reason::AuthenticationFailed
        );
        let mut wrapped = wrap.clone();
        wrapped.wrapped[0] ^= 1;
        assert_eq!(
            unwrap_epoch_key(&wrapped, &alice).unwrap_err(),
            Reason::AuthenticationFailed
        );
        let parsed = EpochWrap::from_bytes(&wrap.to_bytes()).unwrap();
        assert_eq!(parsed, wrap);
        assert_eq!(
            EpochWrap::from_bytes(&wrap.to_bytes()[..40]).unwrap_err(),
            Reason::Malformed
        );
    }

    #[test]
    fn fresh_ephemeral_and_nonce_per_wrap() {
        let alice = MemberIdentity::generate();
        let key = EpochKey::generate();
        let a = wrap_epoch_key(
            &key,
            [2; ID_LEN],
            0,
            alice.member_id(),
            &alice.public().exchange,
        );
        let b = wrap_epoch_key(
            &key,
            [2; ID_LEN],
            0,
            alice.member_id(),
            &alice.public().exchange,
        );
        assert_ne!(a.eph_pub, b.eph_pub);
        assert_ne!(a.nonce, b.nonce);
        assert_ne!(a.wrapped, b.wrapped);
    }
}
