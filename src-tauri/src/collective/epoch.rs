//! Ключ епохи та обгортки для учасників (ADR, 2.3, варіант Б, формат після G12 U3):
//! `shared = X25519(eph_priv, member_pub)`, `kek = HKDF-SHA256(shared, salt = collective_id ‖ epoch,
//! info = "easywar/collective/v1/epoch-wrap" ‖ eph_pub ‖ member_pub)`,
//! `wrapped = XChaCha20-Poly1305(kek, nonce, epoch_key, aad = заголовок обгортки)`; заголовок
//! починається з `v ‖ suite`. Обгортка адресується лише учаснику з перевіреним зв'язуванням
//! ключа обміну ([`BoundMember`], G12 U2).

use argon2::password_hash::rand_core::OsRng;
use chacha20poly1305::aead::{Aead, KeyInit, Payload};
use chacha20poly1305::{Key, XChaCha20Poly1305, XNonce};
use x25519_dalek::{EphemeralSecret, PublicKey, SharedSecret, StaticSecret};
use zeroize::Zeroizing;

use super::codec::{Reader, Writer};
use super::identity::{BoundMember, MemberId, MemberIdentity};
use super::{
    hkdf, labels, random_array, Reason, ID_LEN, KEY_LEN, NONCE_LEN, PROTOCOL_VERSION, SUITE,
    TAG_LEN,
};

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

/// Обгортка ключа епохи для одного учасника. Відкриті поля — `v`, `suite`, `collective_id`,
/// `epoch`, `member_id`, `eph_pub`, `nonce`; усі вони входять в AAD.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct EpochWrap {
    pub v: u16,
    pub suite: u16,
    pub collective_id: CollectiveId,
    pub epoch: u32,
    pub member_id: MemberId,
    pub eph_pub: [u8; KEY_LEN],
    pub nonce: [u8; NONCE_LEN],
    pub wrapped: Vec<u8>,
}

impl EpochWrap {
    /// Довжина відкритого заголовка: `v ‖ suite ‖ collective_id ‖ epoch ‖ member_id ‖ eph_pub ‖ nonce`.
    pub const HEADER_LEN: usize = 2 + 2 + ID_LEN + 4 + 2 * KEY_LEN + NONCE_LEN;

    fn header_bytes(&self) -> Vec<u8> {
        let mut w = Writer::with_capacity(Self::HEADER_LEN);
        w.u16(self.v)
            .u16(self.suite)
            .fixed(&self.collective_id)
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

    /// Інша версія чи набір відхиляються до розбору решти полів (ADR, 2.1).
    pub fn from_bytes(bytes: &[u8]) -> Result<Self, Reason> {
        let mut r = Reader::new(bytes);
        let v = r.u16()?;
        let suite = r.u16()?;
        if v != PROTOCOL_VERSION || suite != SUITE {
            return Err(Reason::UnsupportedVersion);
        }
        let wrap = Self {
            v,
            suite,
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

/// KEK прив'язаний до обох відкритих ключів DH (`eph_pub ‖ member_pub`, G12 U3): інший
/// одержувач чи підмінений ефемерний ключ дають інший KEK навіть за однакового `shared`.
fn kek(
    shared: &[u8; KEY_LEN],
    collective_id: &CollectiveId,
    epoch: u32,
    eph_pub: &[u8; KEY_LEN],
    member_pub: &[u8; KEY_LEN],
) -> Zeroizing<[u8; KEY_LEN]> {
    let mut salt = Vec::with_capacity(ID_LEN + 4);
    salt.extend_from_slice(collective_id);
    salt.extend_from_slice(&epoch.to_be_bytes());
    let mut info = Vec::with_capacity(labels::EPOCH_WRAP.len() + 2 * KEY_LEN);
    info.extend_from_slice(labels::EPOCH_WRAP);
    info.extend_from_slice(eph_pub);
    info.extend_from_slice(member_pub);
    hkdf(shared, &salt, &info)
}

/// Обгортає ключ епохи для учасника з перевіреним зв'язуванням (колектив береться з нього)
/// ефемерним ключем X25519 (одноразовий, затирається). Ключ обміну учасника з малої підгрупи або нульовий дає неконтрибутивний спільний секрет
/// (RFC 7748, розділ 6.1) — тоді KEK відтворив би будь-хто з відкритого заголовка; така
/// обгортка не створюється: [`Reason::WeakExchangeKey`].
pub fn wrap_epoch_key(
    key: &EpochKey,
    epoch: u32,
    recipient: &BoundMember,
) -> Result<EpochWrap, Reason> {
    let eph = EphemeralSecret::random_from_rng(OsRng);
    let eph_pub = PublicKey::from(&eph).to_bytes();
    let member_pub = recipient.public().exchange;
    let shared = contributory(eph.diffie_hellman(&PublicKey::from(member_pub)))?;
    Ok(wrap_with(
        key,
        *recipient.collective_id(),
        epoch,
        recipient.member_id(),
        eph_pub,
        &member_pub,
        shared.as_bytes(),
        random_array(),
    ))
}

/// Fail-closed перевірка контрибутивності спільного секрету (`SharedSecret::was_contributory`).
fn contributory(shared: SharedSecret) -> Result<SharedSecret, Reason> {
    if shared.was_contributory() {
        Ok(shared)
    } else {
        Err(Reason::WeakExchangeKey)
    }
}

#[allow(clippy::too_many_arguments)]
fn wrap_with(
    key: &EpochKey,
    collective_id: CollectiveId,
    epoch: u32,
    member_id: MemberId,
    eph_pub: [u8; KEY_LEN],
    member_pub: &[u8; KEY_LEN],
    shared: &[u8; KEY_LEN],
    nonce: [u8; NONCE_LEN],
) -> EpochWrap {
    let mut wrap = EpochWrap {
        v: PROTOCOL_VERSION,
        suite: SUITE,
        collective_id,
        epoch,
        member_id,
        eph_pub,
        nonce,
        wrapped: Vec::new(),
    };
    let kek = kek(shared, &collective_id, epoch, &eph_pub, member_pub);
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
    if wrap.v != PROTOCOL_VERSION || wrap.suite != SUITE {
        return Err(Reason::UnsupportedVersion);
    }
    let shared = contributory(secret.diffie_hellman(&PublicKey::from(wrap.eph_pub)))?;
    let member_pub = PublicKey::from(secret).to_bytes();
    let kek = kek(
        shared.as_bytes(),
        &wrap.collective_id,
        wrap.epoch,
        &wrap.eph_pub,
        &member_pub,
    );
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
    epoch: u32,
    recipient: &BoundMember,
    eph_secret: [u8; KEY_LEN],
    nonce: [u8; NONCE_LEN],
) -> Result<EpochWrap, Reason> {
    let eph = StaticSecret::from(eph_secret);
    let eph_pub = PublicKey::from(&eph).to_bytes();
    let member_pub = recipient.public().exchange;
    let shared = contributory(eph.diffie_hellman(&PublicKey::from(member_pub)))?;
    Ok(wrap_with(
        key,
        *recipient.collective_id(),
        epoch,
        recipient.member_id(),
        eph_pub,
        &member_pub,
        shared.as_bytes(),
        nonce,
    ))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::collective::hex;

    fn bound(member: &MemberIdentity, collective: CollectiveId) -> BoundMember {
        member
            .bind_exchange(collective, 1)
            .verify(&collective)
            .unwrap()
    }

    #[test]
    fn member_unwraps_own_wrap_only() {
        let alice = MemberIdentity::generate();
        let bob = MemberIdentity::generate();
        let key = EpochKey::generate();
        let collective = random_array();
        let wrap = wrap_epoch_key(&key, 3, &bound(&alice, collective)).unwrap();
        assert_eq!(wrap.collective_id, collective);
        assert_eq!(wrap.member_id, alice.member_id());
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
        let wrap = wrap_epoch_key(&key, 0, &bound(&alice, [1; ID_LEN])).unwrap();
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
            wrap.to_bytes().len(),
            EpochWrap::HEADER_LEN + KEY_LEN + TAG_LEN
        );
        assert_eq!(
            EpochWrap::from_bytes(&wrap.to_bytes()[..40]).unwrap_err(),
            Reason::Malformed
        );
    }

    /// G12, U3: версія й набір — перші відкриті поля; інші значення відхиляються до розбору
    /// і до спроби розгортання.
    #[test]
    fn other_version_or_suite_is_rejected_before_unwrap() {
        let alice = MemberIdentity::generate();
        let key = EpochKey::generate();
        let wrap = wrap_epoch_key(&key, 0, &bound(&alice, [4; ID_LEN])).unwrap();
        let bytes = wrap.to_bytes();
        assert_eq!(&bytes[..4], &[0, 1, 0, 1], "v = 1, suite = 1");
        for position in [1usize, 3] {
            let mut other = bytes.clone();
            other[position] = 2;
            assert_eq!(
                EpochWrap::from_bytes(&other).unwrap_err(),
                Reason::UnsupportedVersion
            );
        }
        let mut v2 = wrap.clone();
        v2.v = 2;
        assert_eq!(
            unwrap_epoch_key(&v2, &alice).unwrap_err(),
            Reason::UnsupportedVersion
        );
    }

    /// G12, U3: KEK залежить від `eph_pub ‖ member_pub`, а не лише від спільного секрету.
    #[test]
    fn kek_binds_both_public_keys() {
        let shared = [9u8; KEY_LEN];
        let collective = [3u8; ID_LEN];
        let base = kek(&shared, &collective, 0, &[1; KEY_LEN], &[2; KEY_LEN]);
        assert_ne!(
            *base,
            *kek(&shared, &collective, 0, &[1; KEY_LEN], &[3; KEY_LEN])
        );
        assert_ne!(
            *base,
            *kek(&shared, &collective, 0, &[4; KEY_LEN], &[2; KEY_LEN])
        );
        assert_ne!(
            *base,
            *kek(&shared, &collective, 1, &[1; KEY_LEN], &[2; KEY_LEN])
        );
    }

    #[test]
    fn fresh_ephemeral_and_nonce_per_wrap() {
        let alice = MemberIdentity::generate();
        let key = EpochKey::generate();
        let recipient = bound(&alice, [2; ID_LEN]);
        let a = wrap_epoch_key(&key, 0, &recipient).unwrap();
        let b = wrap_epoch_key(&key, 0, &recipient).unwrap();
        assert_ne!(a.eph_pub, b.eph_pub);
        assert_ne!(a.nonce, b.nonce);
        assert_ne!(a.wrapped, b.wrapped);
    }

    /// G12, зауваження 1: ключ обміну з малої підгрупи (точка порядку 8, RFC 7748, 6.1) або
    /// нульовий дає неконтрибутивний спільний секрет — обгортка не створюється й не розгортається,
    /// навіть якщо учасник сам підписав зв'язування такого ключа.
    #[test]
    fn low_order_or_zero_exchange_key_is_rejected_fail_closed() {
        let alice = MemberIdentity::generate();
        let key = EpochKey::generate();
        let collective = [2; ID_LEN];
        let low_order = hex::array::<KEY_LEN>(
            "e0eb7a7c3b41b8ae1656e3faf19fc46ada098deb9c32b1fd866205165f49b800",
        );
        for weak in [[0u8; KEY_LEN], low_order] {
            let weak_member = alice
                .bind_foreign_exchange(weak, collective, 1)
                .verify(&collective)
                .unwrap();
            assert_eq!(
                wrap_epoch_key(&key, 0, &weak_member).unwrap_err(),
                Reason::WeakExchangeKey
            );
            assert_eq!(
                wrap_deterministic(&key, 0, &weak_member, [7; KEY_LEN], [8; NONCE_LEN])
                    .unwrap_err(),
                Reason::WeakExchangeKey
            );
            // Обгортка з підробленим ефемерним ключем з малої підгрупи не розгортається
            // (перевірка контрибутивності — до розшифрування).
            let mut forged = wrap_epoch_key(&key, 0, &bound(&alice, collective)).unwrap();
            forged.eph_pub = weak;
            assert_eq!(
                unwrap_epoch_key(&forged, &alice).unwrap_err(),
                Reason::WeakExchangeKey
            );
        }
        // Звичайний ключ обміну — контрибутивний.
        assert!(wrap_epoch_key(&key, 0, &bound(&alice, collective)).is_ok());
    }
}
