//! Автентифікований доступ до черги конвертів і перевірене підтвердження (E8, пункт 3 списку
//! JE від 29.10.2026). Контракт ADR `collective-store-forward.md`, п. 1–3:
//! `put → підписана квитанція STORED`, `fetch`, `ack`. Без сокетів і IPC: транспорт лише
//! передає ці структури, а вирішує тут.
//!
//! - Кожен запит підписаний ключем **пристрою** учасника: мітка запиту ‖ колектив ‖ учасник ‖
//!   пристрій ‖ час ‖ одноразовий номер ‖ тіло. Вузол приймає лише пристрій, підтверджений на
//!   поточному журналі складу, від невідкликаного учасника; час — у межах
//!   [`FRESHNESS_SECONDS`]; номер не повторюється (обмежений кеш).
//! - Адресат: [`COLLECTIVE_SCOPE`] (нулі) — увесь колектив, будь-який активний учасник читає;
//!   [`member_scope`] — один учасник, читає й підтверджує лише він.
//! - Квитанцію `STORED` підписує ключ вузла; вона означає лише «збережено», не «застосовано».
//! - Пакет видаляється тільки за перевіреним підтвердженням адресата з тим самим digest;
//!   пакет усього колективу підтвердженням не видаляється (решта ще не отримала) і лежить до TTL.
//!
//! Чого тут немає: шифрування каналу (TLS/Noise — разом із транспортом), вибору вузла, ролі
//! STORE_FORWARD зі згодою власника комп'ютера (JE-10/JE-19/JE-20).

use std::collections::HashMap;

use super::codec::Writer;
use super::envelope::Envelope;
use super::epoch::CollectiveId;
use super::identity::{self, DeviceIdentity, MemberId};
use super::relay::{MailboxError, OfflineMailbox, Page, PutResult, RemoveResult};
use super::replay::MembershipView;
use super::{labels, random_array, sha256, ID_LEN, KEY_LEN, SIGNATURE_LEN};

/// Допустиме розходження годинників запитувача й вузла.
pub const FRESHNESS_SECONDS: i64 = 300;
/// Скільки одноразових номерів вузол пам'ятає в межах вікна свіжості.
pub const MAX_SEEN_NONCES: usize = 4096;
/// Найбільша сторінка `fetch`.
pub const MAX_FETCH_LIMIT: u32 = 100;
/// Адресат «увесь колектив».
pub const COLLECTIVE_SCOPE: [u8; ID_LEN] = [0; ID_LEN];

/// Адресат одного учасника: перші 16 байтів SHA-256 від мітки, колективу й `member_id`.
/// Сторонній без `member_id` не пов'яже адресу з учасником.
pub fn member_scope(collective_id: &CollectiveId, member: &MemberId) -> [u8; ID_LEN] {
    let digest = sha256(&[labels::MEMBER_SCOPE, collective_id, member]);
    digest[..ID_LEN].try_into().expect("довжина адреси стала")
}

/// Хто й коли підписав запит.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct RequestAuth {
    pub member_id: MemberId,
    pub device_pub: [u8; KEY_LEN],
    pub issued_at: i64,
    pub nonce: [u8; ID_LEN],
    pub signature: [u8; SIGNATURE_LEN],
}

impl RequestAuth {
    fn message(
        label: &[u8],
        collective_id: &CollectiveId,
        member_id: &MemberId,
        device_pub: &[u8; KEY_LEN],
        issued_at: i64,
        nonce: &[u8; ID_LEN],
        body: &[u8],
    ) -> Vec<u8> {
        let mut w = Writer::with_capacity(label.len() + 128 + body.len());
        w.fixed(label)
            .fixed(collective_id)
            .fixed(member_id)
            .fixed(device_pub)
            .i64(issued_at)
            .fixed(nonce)
            .var(body);
        w.finish()
    }

    fn sign(
        label: &[u8],
        collective_id: &CollectiveId,
        member_id: MemberId,
        device: &DeviceIdentity,
        issued_at: i64,
        body: &[u8],
    ) -> Self {
        let device_pub = device.public().0;
        let nonce = random_array();
        let message = Self::message(
            label,
            collective_id,
            &member_id,
            &device_pub,
            issued_at,
            &nonce,
            body,
        );
        Self {
            member_id,
            device_pub,
            issued_at,
            nonce,
            signature: device.sign(&message),
        }
    }

    fn verify(&self, label: &[u8], collective_id: &CollectiveId, body: &[u8]) -> bool {
        let message = Self::message(
            label,
            collective_id,
            &self.member_id,
            &self.device_pub,
            self.issued_at,
            &self.nonce,
            body,
        );
        identity::verify(&self.device_pub, &message, &self.signature).is_ok()
    }
}

/// Покласти конверт у чергу.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct PutRequest {
    pub auth: RequestAuth,
    pub envelope: Vec<u8>,
    pub expires_at: i64,
}

impl PutRequest {
    fn body(envelope: &[u8], expires_at: i64) -> Vec<u8> {
        let mut w = Writer::with_capacity(KEY_LEN + 8);
        w.fixed(&sha256(&[envelope])).i64(expires_at);
        w.finish()
    }

    pub fn sign(
        collective_id: &CollectiveId,
        member_id: MemberId,
        device: &DeviceIdentity,
        envelope: Vec<u8>,
        expires_at: i64,
        now: i64,
    ) -> Self {
        let body = Self::body(&envelope, expires_at);
        Self {
            auth: RequestAuth::sign(
                labels::RELAY_PUT,
                collective_id,
                member_id,
                device,
                now,
                &body,
            ),
            envelope,
            expires_at,
        }
    }
}

/// Прочитати сторінку конвертів одного адресата.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct FetchRequest {
    pub auth: RequestAuth,
    pub scope: [u8; ID_LEN],
    pub cursor: u64,
    pub limit: u32,
}

impl FetchRequest {
    fn body(scope: &[u8; ID_LEN], cursor: u64, limit: u32) -> Vec<u8> {
        let mut w = Writer::with_capacity(ID_LEN + 12);
        w.fixed(scope).u64(cursor).u32(limit);
        w.finish()
    }

    pub fn sign(
        collective_id: &CollectiveId,
        member_id: MemberId,
        device: &DeviceIdentity,
        scope: [u8; ID_LEN],
        cursor: u64,
        limit: u32,
        now: i64,
    ) -> Self {
        let body = Self::body(&scope, cursor, limit);
        Self {
            auth: RequestAuth::sign(
                labels::RELAY_FETCH,
                collective_id,
                member_id,
                device,
                now,
                &body,
            ),
            scope,
            cursor,
            limit,
        }
    }
}

/// Підтвердження адресата: пакет перевірено й застосовано (`receive` дав `Apply` або
/// `Idempotent`). Лише воно видаляє пакет із черги.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct AckRequest {
    pub auth: RequestAuth,
    pub scope: [u8; ID_LEN],
    pub envelope_id: [u8; ID_LEN],
    pub digest: [u8; KEY_LEN],
}

impl AckRequest {
    fn body(scope: &[u8; ID_LEN], envelope_id: &[u8; ID_LEN], digest: &[u8; KEY_LEN]) -> Vec<u8> {
        let mut w = Writer::with_capacity(2 * ID_LEN + KEY_LEN);
        w.fixed(scope).fixed(envelope_id).fixed(digest);
        w.finish()
    }

    /// `envelope` — байти, отримані з `fetch` і щойно застосовані.
    pub fn sign(
        collective_id: &CollectiveId,
        member_id: MemberId,
        device: &DeviceIdentity,
        envelope: &[u8],
        now: i64,
    ) -> Result<Self, RelayDenied> {
        let parsed = Envelope::from_bytes(envelope).map_err(|_| RelayDenied::InvalidEnvelope)?;
        let scope = parsed.header.recipient_scope;
        let envelope_id = parsed.header.envelope_id;
        let digest = sha256(&[envelope]);
        let body = Self::body(&scope, &envelope_id, &digest);
        Ok(Self {
            auth: RequestAuth::sign(
                labels::RELAY_ACK,
                collective_id,
                member_id,
                device,
                now,
                &body,
            ),
            scope,
            envelope_id,
            digest,
        })
    }
}

/// Квитанція вузла «збережено». Не означає доставки чи застосування.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct StoredReceipt {
    pub relay_pub: [u8; KEY_LEN],
    pub collective_id: CollectiveId,
    pub scope: [u8; ID_LEN],
    pub envelope_id: [u8; ID_LEN],
    pub digest: [u8; KEY_LEN],
    pub expires_at: i64,
    pub stored_at: i64,
    /// Той самий пакет уже був у черзі.
    pub already_stored: bool,
    pub signature: [u8; SIGNATURE_LEN],
}

impl StoredReceipt {
    fn signed_bytes(&self) -> Vec<u8> {
        let mut w = Writer::with_capacity(labels::RELAY_STORED.len() + 160);
        w.fixed(labels::RELAY_STORED)
            .fixed(&self.relay_pub)
            .fixed(&self.collective_id)
            .fixed(&self.scope)
            .fixed(&self.envelope_id)
            .fixed(&self.digest)
            .i64(self.expires_at)
            .i64(self.stored_at)
            .u8(u8::from(self.already_stored));
        w.finish()
    }

    /// Відправник перевіряє квитанцію ключем вузла, якому довіряє, і що вона саме про його
    /// пакет. Невідома чи чужа квитанція — пакет у відправника не видаляється.
    pub fn verify(
        &self,
        trusted_relay: &[u8; KEY_LEN],
        envelope: &[u8],
    ) -> Result<(), RelayDenied> {
        if &self.relay_pub != trusted_relay {
            return Err(RelayDenied::UntrustedRelay);
        }
        if self.digest != sha256(&[envelope]) {
            return Err(RelayDenied::ReceiptMismatch);
        }
        identity::verify(&self.relay_pub, &self.signed_bytes(), &self.signature)
            .map_err(|_| RelayDenied::BadSignature)
    }
}

/// Відповідь на підтвердження.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum AckStatus {
    /// Пакет адресата видалено.
    Removed,
    /// Пакета вже немає (повтор підтвердження або TTL): безпечно.
    NotFound,
    /// Пакет для всього колективу лишається до TTL: інші учасники ще читають.
    Retained,
}

/// Відмова вузла.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum RelayDenied {
    /// Час запиту поза вікном свіжості.
    Stale,
    /// Підпис запиту чи квитанції недійсний.
    BadSignature,
    /// Одноразовий номер уже бачили: повтор запиту.
    Replay,
    /// Кеш номерів повний у межах вікна: спробуйте пізніше.
    Busy,
    /// Учасника відкликано.
    MemberRevoked,
    /// Пристрій не підтверджений учасником на поточному журналі.
    DeviceNotValid,
    /// Адресат належить іншому учаснику.
    ScopeForbidden,
    /// Конверт не цього колективу.
    WrongCollective,
    /// Байти не є конвертом.
    InvalidEnvelope,
    /// Сторінка більша за [`MAX_FETCH_LIMIT`] або нульова.
    BadLimit,
    /// Квитанція від вузла, якому відправник не довіряє.
    UntrustedRelay,
    /// Квитанція не про цей пакет.
    ReceiptMismatch,
}

impl RelayDenied {
    pub fn message(self) -> &'static str {
        match self {
            RelayDenied::Stale => "час запиту розходиться з вузлом",
            RelayDenied::BadSignature => "підпис недійсний",
            RelayDenied::Replay => "повторний запит",
            RelayDenied::Busy => "вузол зайнятий, спробуйте пізніше",
            RelayDenied::MemberRevoked => "учасника відкликано",
            RelayDenied::DeviceNotValid => "пристрій не підтверджений учасником",
            RelayDenied::ScopeForbidden => "ці пакети адресовані іншому учаснику",
            RelayDenied::WrongCollective => "пакет іншого колективу",
            RelayDenied::InvalidEnvelope => "недійсний зашифрований конверт",
            RelayDenied::BadLimit => "недійсний розмір сторінки",
            RelayDenied::UntrustedRelay => "квитанція від невідомого вузла",
            RelayDenied::ReceiptMismatch => "квитанція не про цей пакет",
        }
    }
}

#[derive(Debug, thiserror::Error)]
pub enum RelayError {
    #[error("{}", .0.message())]
    Denied(RelayDenied),
    #[error(transparent)]
    Mailbox(#[from] MailboxError),
}

impl From<RelayDenied> for RelayError {
    fn from(denied: RelayDenied) -> Self {
        RelayError::Denied(denied)
    }
}

/// Вузол черги одного колективу: перевіряє запити й підписує квитанції.
pub struct AuthenticatedRelay {
    collective_id: CollectiveId,
    node: DeviceIdentity,
    mailbox: OfflineMailbox,
    seen: HashMap<[u8; ID_LEN], i64>,
    nonce_capacity: usize,
}

impl AuthenticatedRelay {
    pub fn new(collective_id: CollectiveId, node: DeviceIdentity, mailbox: OfflineMailbox) -> Self {
        Self::with_nonce_capacity(collective_id, node, mailbox, MAX_SEEN_NONCES)
    }

    fn with_nonce_capacity(
        collective_id: CollectiveId,
        node: DeviceIdentity,
        mailbox: OfflineMailbox,
        nonce_capacity: usize,
    ) -> Self {
        Self {
            collective_id,
            node,
            mailbox,
            seen: HashMap::new(),
            nonce_capacity,
        }
    }

    /// Відкритий ключ вузла — його учасники вносять у довірені, щоб перевіряти квитанції.
    pub fn node_public(&self) -> [u8; KEY_LEN] {
        self.node.public().0
    }

    /// Перевірки однакові для всіх запитів. Номер запам'ятовується лише після перевірки
    /// підпису й членства, тож сторонні не можуть заповнити кеш.
    fn authenticate(
        &mut self,
        membership: &dyn MembershipView,
        label: &[u8],
        auth: &RequestAuth,
        body: &[u8],
        now: i64,
    ) -> Result<(), RelayDenied> {
        if auth.issued_at.abs_diff(now) > FRESHNESS_SECONDS as u64 {
            return Err(RelayDenied::Stale);
        }
        if !auth.verify(label, &self.collective_id, body) {
            return Err(RelayDenied::BadSignature);
        }
        if membership.revoked_at(&auth.member_id).is_some() {
            return Err(RelayDenied::MemberRevoked);
        }
        if !membership.device_valid_at(membership.latest_seq(), &auth.member_id, &auth.device_pub) {
            return Err(RelayDenied::DeviceNotValid);
        }
        self.seen.retain(|_, until| *until > now);
        if self.seen.contains_key(&auth.nonce) {
            return Err(RelayDenied::Replay);
        }
        if self.seen.len() >= self.nonce_capacity {
            return Err(RelayDenied::Busy);
        }
        self.seen.insert(
            auth.nonce,
            auth.issued_at.saturating_add(2 * FRESHNESS_SECONDS),
        );
        Ok(())
    }

    fn scope_allowed(&self, member: &MemberId, scope: &[u8; ID_LEN]) -> bool {
        *scope == COLLECTIVE_SCOPE || *scope == member_scope(&self.collective_id, member)
    }

    pub fn put(
        &mut self,
        membership: &dyn MembershipView,
        request: &PutRequest,
        now: i64,
    ) -> Result<StoredReceipt, RelayError> {
        let body = PutRequest::body(&request.envelope, request.expires_at);
        self.authenticate(membership, labels::RELAY_PUT, &request.auth, &body, now)?;
        let envelope =
            Envelope::from_bytes(&request.envelope).map_err(|_| RelayDenied::InvalidEnvelope)?;
        if envelope.header.collective_id != self.collective_id {
            return Err(RelayDenied::WrongCollective.into());
        }
        let result = self
            .mailbox
            .put(&request.envelope, request.expires_at, now)?;
        let mut receipt = StoredReceipt {
            relay_pub: self.node_public(),
            collective_id: self.collective_id,
            scope: envelope.header.recipient_scope,
            envelope_id: envelope.header.envelope_id,
            digest: sha256(&[&request.envelope]),
            expires_at: request.expires_at,
            stored_at: now,
            already_stored: result == PutResult::AlreadyStored,
            signature: [0; SIGNATURE_LEN],
        };
        receipt.signature = self.node.sign(&receipt.signed_bytes());
        Ok(receipt)
    }

    pub fn fetch(
        &mut self,
        membership: &dyn MembershipView,
        request: &FetchRequest,
        now: i64,
    ) -> Result<Page, RelayError> {
        let body = FetchRequest::body(&request.scope, request.cursor, request.limit);
        self.authenticate(membership, labels::RELAY_FETCH, &request.auth, &body, now)?;
        if request.limit == 0 || request.limit > MAX_FETCH_LIMIT {
            return Err(RelayDenied::BadLimit.into());
        }
        if !self.scope_allowed(&request.auth.member_id, &request.scope) {
            return Err(RelayDenied::ScopeForbidden.into());
        }
        Ok(self
            .mailbox
            .fetch(request.scope, request.cursor, request.limit as usize, now))
    }

    pub fn ack(
        &mut self,
        membership: &dyn MembershipView,
        request: &AckRequest,
        now: i64,
    ) -> Result<AckStatus, RelayError> {
        let body = AckRequest::body(&request.scope, &request.envelope_id, &request.digest);
        self.authenticate(membership, labels::RELAY_ACK, &request.auth, &body, now)?;
        if !self.scope_allowed(&request.auth.member_id, &request.scope) {
            return Err(RelayDenied::ScopeForbidden.into());
        }
        if request.scope == COLLECTIVE_SCOPE {
            return Ok(AckStatus::Retained);
        }
        Ok(
            match self
                .mailbox
                .remove(request.scope, request.envelope_id, &request.digest, now)?
            {
                RemoveResult::Removed => AckStatus::Removed,
                RemoveResult::NotFound => AckStatus::NotFound,
            },
        )
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::collective::envelope::{sample_payload, seal, EnvelopeHeader};
    use crate::collective::epoch::EpochKey;
    use crate::collective::identity::MemberIdentity;
    use crate::collective::replay::{
        receive, Decision, InMemoryMembership, Journals, RevokedPolicy,
    };

    const NOW: i64 = 1_761_900_000;

    struct Member {
        identity: MemberIdentity,
        device: DeviceIdentity,
    }

    impl Member {
        fn id(&self) -> MemberId {
            self.identity.member_id()
        }
    }

    struct World {
        collective: CollectiveId,
        membership: InMemoryMembership,
        key: EpochKey,
        table: [u8; ID_LEN],
        alice: Member,
        bob: Member,
        carol: Member,
        relay: AuthenticatedRelay,
        _dir: tempfile::TempDir,
    }

    impl World {
        fn new() -> Self {
            Self::with_capacity(MAX_SEEN_NONCES)
        }

        fn with_capacity(nonce_capacity: usize) -> Self {
            let collective = [4; ID_LEN];
            let table = [7; ID_LEN];
            let mut membership = InMemoryMembership::new(collective);
            let mut add = |at: i64| {
                let member = Member {
                    identity: MemberIdentity::generate(),
                    device: DeviceIdentity::generate(),
                };
                membership
                    .join(&member.identity.bind_exchange(collective, at))
                    .unwrap();
                membership
                    .add_device(&member.identity.issue_device(&member.device.public(), at))
                    .unwrap();
                membership.grant_table(&member.id(), table);
                member
            };
            let (alice, bob, carol) = (add(1), add(2), add(3));
            let dir = tempfile::tempdir().unwrap();
            let mailbox = OfflineMailbox::open(dir.path().join("relay.queue"), 1 << 20).unwrap();
            let relay = AuthenticatedRelay::with_nonce_capacity(
                collective,
                DeviceIdentity::generate(),
                mailbox,
                nonce_capacity,
            );
            Self {
                collective,
                membership,
                key: EpochKey::generate(),
                table,
                alice,
                bob,
                carol,
                relay,
                _dir: dir,
            }
        }

        fn envelope_from(&self, author: &Member, scope: [u8; ID_LEN]) -> Vec<u8> {
            let mut payload =
                sample_payload(&author.device, author.id(), self.membership.latest_seq());
            payload.table_id = self.table;
            payload.op_id = random_array();
            seal(
                &self.key,
                EnvelopeHeader::new(self.collective, 0, scope),
                &payload.sign(&author.device),
            )
            .to_bytes()
        }

        fn put(
            &mut self,
            author_index: usize,
            bytes: Vec<u8>,
        ) -> Result<StoredReceipt, RelayError> {
            let author = [&self.alice, &self.bob, &self.carol][author_index];
            let request = PutRequest::sign(
                &self.collective,
                author.id(),
                &author.device,
                bytes,
                NOW + 3600,
                NOW,
            );
            self.relay.put(&self.membership, &request, NOW)
        }

        fn fetch_as(&mut self, who: usize, scope: [u8; ID_LEN]) -> Result<Page, RelayError> {
            let member = [&self.alice, &self.bob, &self.carol][who];
            let request = FetchRequest::sign(
                &self.collective,
                member.id(),
                &member.device,
                scope,
                0,
                10,
                NOW,
            );
            self.relay.fetch(&self.membership, &request, NOW)
        }

        fn ack_as(&mut self, who: usize, bytes: &[u8]) -> Result<AckStatus, RelayError> {
            let member = [&self.alice, &self.bob, &self.carol][who];
            let request =
                AckRequest::sign(&self.collective, member.id(), &member.device, bytes, NOW)
                    .unwrap();
            self.relay.ack(&self.membership, &request, NOW)
        }
    }

    fn denied(result: Result<impl std::fmt::Debug, RelayError>) -> RelayDenied {
        match result {
            Err(RelayError::Denied(reason)) => reason,
            other => panic!("очікувалась відмова, отримано {other:?}"),
        }
    }

    const ALICE: usize = 0;
    const BOB: usize = 1;
    const CAROL: usize = 2;

    #[test]
    fn signed_store_fetch_apply_and_verified_ack_remove_the_packet() {
        let mut w = World::new();
        let bob_scope = member_scope(&w.collective, &w.bob.id());
        let bytes = w.envelope_from(&w.alice, bob_scope);
        let receipt = w.put(ALICE, bytes.clone()).unwrap();
        assert!(!receipt.already_stored);
        receipt.verify(&w.relay.node_public(), &bytes).unwrap();
        assert_eq!(
            receipt.verify(&[9; KEY_LEN], &bytes),
            Err(RelayDenied::UntrustedRelay)
        );
        let mut forged = receipt;
        forged.expires_at += 1;
        assert_eq!(
            forged.verify(&w.relay.node_public(), &bytes),
            Err(RelayDenied::BadSignature)
        );
        assert!(w.put(ALICE, bytes.clone()).unwrap().already_stored);

        let page = w.fetch_as(BOB, bob_scope).unwrap();
        assert_eq!(page.envelopes, vec![bytes.clone()]);
        let key = *w.key.as_bytes();
        let decision = receive(
            &mut Journals::new(),
            &w.membership,
            RevokedPolicy::Reject,
            |epoch| (epoch == 0).then(|| EpochKey::from_bytes(key)),
            &page.envelopes[0],
        );
        assert!(matches!(decision, Decision::Apply(_)), "{decision:?}");
        assert_eq!(w.ack_as(BOB, &bytes).unwrap(), AckStatus::Removed);
        assert!(w.fetch_as(BOB, bob_scope).unwrap().envelopes.is_empty());
        assert_eq!(w.ack_as(BOB, &bytes).unwrap(), AckStatus::NotFound);
    }

    #[test]
    fn member_scope_is_private_and_collective_scope_is_shared_until_ttl() {
        let mut w = World::new();
        let bob_scope = member_scope(&w.collective, &w.bob.id());
        let private = w.envelope_from(&w.alice, bob_scope);
        let shared = w.envelope_from(&w.alice, COLLECTIVE_SCOPE);
        w.put(ALICE, private.clone()).unwrap();
        w.put(ALICE, shared.clone()).unwrap();
        assert_eq!(
            denied(w.fetch_as(CAROL, bob_scope)),
            RelayDenied::ScopeForbidden
        );
        assert_eq!(
            denied(w.ack_as(CAROL, &private)),
            RelayDenied::ScopeForbidden
        );
        assert_eq!(w.fetch_as(BOB, bob_scope).unwrap().envelopes, vec![private]);
        for who in [ALICE, BOB, CAROL] {
            assert_eq!(
                w.fetch_as(who, COLLECTIVE_SCOPE).unwrap().envelopes,
                vec![shared.clone()]
            );
        }
        assert_eq!(w.ack_as(BOB, &shared).unwrap(), AckStatus::Retained);
        assert_eq!(
            w.fetch_as(CAROL, COLLECTIVE_SCOPE).unwrap().envelopes,
            vec![shared]
        );
    }

    #[test]
    fn outsiders_revoked_members_foreign_devices_and_bad_signatures_are_rejected() {
        let mut w = World::new();
        let bytes = w.envelope_from(&w.alice, COLLECTIVE_SCOPE);
        // Сторонній з власним ключем пристрою.
        let stranger = DeviceIdentity::generate();
        let request = PutRequest::sign(
            &w.collective,
            MemberIdentity::generate().member_id(),
            &stranger,
            bytes.clone(),
            NOW + 60,
            NOW,
        );
        assert_eq!(
            denied(w.relay.put(&w.membership, &request, NOW)),
            RelayDenied::DeviceNotValid
        );
        // Учасник Аліса, але пристрій не підтверджений нею.
        let request = PutRequest::sign(
            &w.collective,
            w.alice.id(),
            &stranger,
            bytes.clone(),
            NOW + 60,
            NOW,
        );
        assert_eq!(
            denied(w.relay.put(&w.membership, &request, NOW)),
            RelayDenied::DeviceNotValid
        );
        // Підмінений пакет під чужим підписом.
        let mut request = PutRequest::sign(
            &w.collective,
            w.alice.id(),
            &w.alice.device,
            bytes.clone(),
            NOW + 60,
            NOW,
        );
        request.envelope = w.envelope_from(&w.alice, COLLECTIVE_SCOPE);
        assert_eq!(
            denied(w.relay.put(&w.membership, &request, NOW)),
            RelayDenied::BadSignature
        );
        // Відкликаний учасник не читає.
        w.membership.revoke(&w.carol.id());
        assert_eq!(
            denied(w.fetch_as(CAROL, COLLECTIVE_SCOPE)),
            RelayDenied::MemberRevoked
        );
        assert!(w
            .fetch_as(BOB, COLLECTIVE_SCOPE)
            .unwrap()
            .envelopes
            .is_empty());
    }

    #[test]
    fn stale_and_replayed_requests_are_rejected_and_the_nonce_cache_is_bounded() {
        let mut w = World::with_capacity(2);
        let request = FetchRequest::sign(
            &w.collective,
            w.bob.id(),
            &w.bob.device,
            COLLECTIVE_SCOPE,
            0,
            10,
            NOW - FRESHNESS_SECONDS - 1,
        );
        assert_eq!(
            denied(w.relay.fetch(&w.membership, &request, NOW)),
            RelayDenied::Stale
        );
        let request = FetchRequest::sign(
            &w.collective,
            w.bob.id(),
            &w.bob.device,
            COLLECTIVE_SCOPE,
            0,
            10,
            NOW,
        );
        w.relay.fetch(&w.membership, &request, NOW).unwrap();
        assert_eq!(
            denied(w.relay.fetch(&w.membership, &request, NOW + 1)),
            RelayDenied::Replay
        );
        w.fetch_as(ALICE, COLLECTIVE_SCOPE).unwrap();
        assert_eq!(
            denied(w.fetch_as(CAROL, COLLECTIVE_SCOPE)),
            RelayDenied::Busy
        );
        // Після вікна свіжості старі номери забуваються, а старий запит уже прострочений.
        let later = NOW + 2 * FRESHNESS_SECONDS + 1;
        let fresh = FetchRequest::sign(
            &w.collective,
            w.carol.id(),
            &w.carol.device,
            COLLECTIVE_SCOPE,
            0,
            10,
            later,
        );
        w.relay.fetch(&w.membership, &fresh, later).unwrap();
        assert_eq!(
            denied(w.relay.fetch(&w.membership, &request, later)),
            RelayDenied::Stale
        );
    }

    #[test]
    fn ack_with_another_digest_or_unverified_signature_keeps_the_packet() {
        let mut w = World::new();
        let bob_scope = member_scope(&w.collective, &w.bob.id());
        let bytes = w.envelope_from(&w.alice, bob_scope);
        w.put(ALICE, bytes.clone()).unwrap();
        let mut request =
            AckRequest::sign(&w.collective, w.bob.id(), &w.bob.device, &bytes, NOW).unwrap();
        request.digest = [0; KEY_LEN];
        assert_eq!(
            denied(w.relay.ack(&w.membership, &request, NOW)),
            RelayDenied::BadSignature
        );
        // Підписане, але з іншим вмістом під тим самим envelope_id.
        let mut other = bytes.clone();
        *other.last_mut().unwrap() ^= 1;
        let request =
            AckRequest::sign(&w.collective, w.bob.id(), &w.bob.device, &other, NOW).unwrap();
        assert!(matches!(
            w.relay.ack(&w.membership, &request, NOW),
            Err(RelayError::Mailbox(MailboxError::ConflictingEnvelope))
        ));
        assert_eq!(w.fetch_as(BOB, bob_scope).unwrap().envelopes, vec![bytes]);
    }

    #[test]
    fn foreign_collective_envelopes_and_bad_limits_are_rejected() {
        let mut w = World::new();
        let mut payload = sample_payload(&w.alice.device, w.alice.id(), 1);
        payload.table_id = w.table;
        let foreign = seal(
            &w.key,
            EnvelopeHeader::new([5; ID_LEN], 0, COLLECTIVE_SCOPE),
            &payload.sign(&w.alice.device),
        )
        .to_bytes();
        assert_eq!(denied(w.put(ALICE, foreign)), RelayDenied::WrongCollective);
        assert_eq!(
            denied(w.put(ALICE, b"plaintext".to_vec())),
            RelayDenied::InvalidEnvelope
        );
        for limit in [0, MAX_FETCH_LIMIT + 1] {
            let request = FetchRequest::sign(
                &w.collective,
                w.bob.id(),
                &w.bob.device,
                COLLECTIVE_SCOPE,
                0,
                limit,
                NOW,
            );
            assert_eq!(
                denied(w.relay.fetch(&w.membership, &request, NOW)),
                RelayDenied::BadLimit
            );
        }
    }

    #[test]
    fn member_scopes_differ_by_member_and_collective() {
        let a = MemberIdentity::generate().member_id();
        let b = MemberIdentity::generate().member_id();
        assert_ne!(
            member_scope(&[1; ID_LEN], &a),
            member_scope(&[1; ID_LEN], &b)
        );
        assert_ne!(
            member_scope(&[1; ID_LEN], &a),
            member_scope(&[2; ID_LEN], &a)
        );
        assert_ne!(member_scope(&[1; ID_LEN], &a), COLLECTIVE_SCOPE);
    }
}
