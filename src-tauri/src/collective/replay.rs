//! Приймання конверта: дворівневий захист від повторів (ADR, 2.4) і авторизація лише за
//! автентифікованим журналом складу й епохою, без довіри до `client_time`
//! (зауваження J5 C2a-01/02). Сховище журналів тут — у пам'яті; збереження в SQLite — C3b.

use std::collections::{HashMap, HashSet};

use super::envelope::{self, Envelope, SignedPayload};
use super::epoch::{CollectiveId, EpochKey};
use super::identity::{BoundMember, DeviceRecord, ExchangeBinding, MemberId};
use super::{Reason, ID_LEN, KEY_LEN};

/// Правило для операцій, створених до відкликання й доставлених після (підпитання JE-16):
/// (б) відхиляти — робоче припущення J3; (а) карантин із ручним рішенням адміністратора.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum RevokedPolicy {
    Reject,
    Quarantine,
}

/// Результат приймання. Назовні всі `Rejected` — один код «пакет відхилено».
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum Decision {
    /// Операцію перевірено, можна застосовувати.
    Apply(SignedPayload),
    /// Той самий `envelope_id` вдруге — повторна доставка, мовчки пропускається.
    SkipDuplicateEnvelope,
    /// Той самий `op_id` з тим самим `op_digest` — уже застосовано.
    Idempotent,
    /// `membership_seq` з майбутнього журналу — відкласти до отримання журналу.
    Deferred(SignedPayload),
    /// Від відкликаного учасника, створено до відкликання — лише за політикою (а).
    Quarantine(SignedPayload),
    Rejected(Reason),
}

/// Журнали конвертів і операцій одного вузла.
#[derive(Default)]
pub struct Journals {
    envelopes: HashSet<(CollectiveId, [u8; ID_LEN])>,
    ops: HashMap<(CollectiveId, [u8; ID_LEN]), [u8; KEY_LEN]>,
}

impl Journals {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn known_op(
        &self,
        collective: &CollectiveId,
        op_id: &[u8; ID_LEN],
    ) -> Option<&[u8; KEY_LEN]> {
        self.ops.get(&(*collective, *op_id))
    }
}

/// Погляд на автентифікований журнал складу (C1c). Усі перевірки — за станом на заданий
/// `seq`, а не за часом автора.
pub trait MembershipView {
    /// Останній відомий вузлу запис журналу.
    fn latest_seq(&self) -> u64;
    /// Запис пристрою підписаний ключем учасника й не відкликаний на `seq`.
    fn device_valid_at(&self, seq: u64, member: &MemberId, device_pub: &[u8; KEY_LEN]) -> bool;
    /// Учасник має право запису на таблицю за станом журналу на `seq`.
    fn can_write_at(&self, seq: u64, member: &MemberId, table_id: &[u8; ID_LEN]) -> bool;
    /// Учасник законно володів цією епохою на `seq`.
    fn epoch_held_at(&self, seq: u64, member: &MemberId, epoch: u32) -> bool;
    /// Номер запису відкликання учасника, якщо є.
    fn revoked_at(&self, member: &MemberId) -> Option<u64>;
}

/// Приймання одного конверта. `epoch_key` добирає ключ за номером епохи; невідома епоха
/// відхиляється без спроби розшифрування.
pub fn receive(
    journals: &mut Journals,
    membership: &dyn MembershipView,
    policy: RevokedPolicy,
    epoch_key: impl Fn(u32) -> Option<EpochKey>,
    bytes: &[u8],
) -> Decision {
    match receive_inner(journals, membership, policy, epoch_key, bytes) {
        Ok(decision) => decision,
        Err(reason) => Decision::Rejected(reason),
    }
}

fn receive_inner(
    journals: &mut Journals,
    membership: &dyn MembershipView,
    policy: RevokedPolicy,
    epoch_key: impl Fn(u32) -> Option<EpochKey>,
    bytes: &[u8],
) -> Result<Decision, Reason> {
    let envelope = Envelope::from_bytes(bytes)?;
    let header = envelope.header;
    let envelope_key = (header.collective_id, header.envelope_id);
    if journals.envelopes.contains(&envelope_key) {
        return Ok(Decision::SkipDuplicateEnvelope);
    }
    let key = epoch_key(header.epoch).ok_or(Reason::UnknownEpoch)?;
    let signed = envelope::open(&key, &envelope)?;
    let payload = &signed.payload;
    let seq = payload.membership_seq;
    // Журнал складу ще не дійшов до membership_seq операції: рішення не остаточне, тому
    // envelope_id у журнал НЕ потрапляє — повторна доставка тих самих байтів після
    // надолуження журналу пройде повну перевірку й застосується рівно один раз
    // (G12, зауваження 2; у C3b відкладені конверти зберігаються й доставляються повторно).
    if seq > membership.latest_seq() {
        return Ok(Decision::Deferred(signed));
    }
    // Конверт автентифіковано й рішення буде остаточним — лише тепер його ідентифікатор
    // потрапляє в журнал, щоб неавтентифіковане сміття не могло «зайняти» чужий envelope_id.
    journals.envelopes.insert(envelope_key);
    let member = &payload.author_member_id;
    if let Some(revoked_at) = membership.revoked_at(member) {
        if seq >= revoked_at {
            return Err(Reason::MemberRevoked);
        }
    }
    if !membership.device_valid_at(seq, member, &payload.device_pub) {
        return Err(Reason::DeviceNotValid);
    }
    if !membership.can_write_at(seq, member, &payload.table_id) {
        return Err(Reason::NoWriteRight);
    }
    if !membership.epoch_held_at(seq, member, header.epoch) {
        return Err(Reason::EpochNotHeld);
    }
    if membership.revoked_at(member).is_some() {
        // Умови 1–4 виконані, але на поточному журналі автор уже відкликаний.
        return match policy {
            RevokedPolicy::Reject => Err(Reason::MemberRevoked),
            RevokedPolicy::Quarantine => Ok(Decision::Quarantine(signed)),
        };
    }
    let digest = payload.op_digest();
    let op_key = (header.collective_id, payload.op_id);
    match journals.ops.get(&op_key) {
        Some(known) if *known == digest => Ok(Decision::Idempotent),
        Some(_) => Err(Reason::IntegrityViolation),
        None => {
            journals.ops.insert(op_key, digest);
            Ok(Decision::Apply(signed))
        }
    }
}

/// Еталонна реалізація журналу складу в пам'яті (синтетична; для тестів і як зразок для
/// C1c/C3b). Вступ і ротація ключа обміну — лише з підписаним зв'язуванням для цього
/// колективу (G12, U2); запис пристрою — лише з дійсним підписом учасника.
pub struct InMemoryMembership {
    collective_id: CollectiveId,
    latest: u64,
    members: HashMap<MemberId, MemberState>,
    epochs: Vec<u64>,
}

struct MemberState {
    bound: BoundMember,
    joined_at: u64,
    revoked_at: Option<u64>,
    tables: Vec<([u8; ID_LEN], u64)>,
    devices: Vec<([u8; KEY_LEN], u64)>,
}

impl InMemoryMembership {
    /// Колектив створено: епоха 0 з запису 0.
    pub fn new(collective_id: CollectiveId) -> Self {
        Self {
            collective_id,
            latest: 0,
            members: HashMap::new(),
            epochs: vec![0],
        }
    }

    fn next(&mut self) -> u64 {
        self.latest += 1;
        self.latest
    }

    /// Вступ лише з перевіреним зв'язуванням ключа обміну для цього колективу. Наявного
    /// учасника `join` не перезаписує: новий ключ обміну — тільки [`Self::rotate_exchange`].
    pub fn join(&mut self, binding: &ExchangeBinding) -> Result<u64, Reason> {
        let bound = binding.verify(&self.collective_id)?;
        if self.members.contains_key(&bound.member_id()) {
            return Err(Reason::BindingNotNewer);
        }
        let seq = self.next();
        self.members.insert(
            bound.member_id(),
            MemberState {
                bound,
                joined_at: seq,
                revoked_at: None,
                tables: Vec::new(),
                devices: Vec::new(),
            },
        );
        Ok(seq)
    }

    /// Ротація ключа обміну — окремий запис журналу з новішим підписаним зв'язуванням того
    /// самого учасника; відкликаний учасник ключ не змінює.
    pub fn rotate_exchange(&mut self, binding: &ExchangeBinding) -> Result<u64, Reason> {
        let bound = binding.verify(&self.collective_id)?;
        let state = self
            .members
            .get(&bound.member_id())
            .ok_or(Reason::ExchangeNotBound)?;
        if state.revoked_at.is_some() {
            return Err(Reason::MemberRevoked);
        }
        if bound.issued_at() <= state.bound.issued_at() {
            return Err(Reason::BindingNotNewer);
        }
        let seq = self.next();
        if let Some(state) = self.members.get_mut(&bound.member_id()) {
            state.bound = bound;
        }
        Ok(seq)
    }

    /// Чинне перевірене зв'язування учасника — вхід для [`super::epoch::wrap_epoch_key`].
    /// Відкликаний учасник обгорток не отримує (ADR, 2.3).
    pub fn bound_member(&self, member: &MemberId) -> Option<BoundMember> {
        self.members
            .get(member)
            .filter(|state| state.revoked_at.is_none())
            .map(|state| state.bound)
    }

    pub fn grant_table(&mut self, member: &MemberId, table_id: [u8; ID_LEN]) -> u64 {
        let seq = self.next();
        if let Some(state) = self.members.get_mut(member) {
            state.tables.push((table_id, seq));
        }
        seq
    }

    /// Запис пристрою входить у журнал лише з дійсним підписом учасника.
    pub fn add_device(&mut self, record: &DeviceRecord) -> Result<u64, Reason> {
        let state = self
            .members
            .get(&record.member_id)
            .ok_or(Reason::DeviceNotValid)?;
        record.verify(state.bound.public())?;
        let seq = self.next();
        if let Some(state) = self.members.get_mut(&record.member_id) {
            state.devices.push((record.device_pub, seq));
        }
        Ok(seq)
    }

    /// Відкликання: новий запис і нова епоха (ADR, 2.3).
    pub fn revoke(&mut self, member: &MemberId) -> (u64, u32) {
        let seq = self.next();
        if let Some(state) = self.members.get_mut(member) {
            state.revoked_at = Some(seq);
        }
        self.epochs.push(seq);
        (seq, (self.epochs.len() - 1) as u32)
    }

    pub fn current_epoch(&self) -> u32 {
        (self.epochs.len() - 1) as u32
    }

    fn active_at(state: &MemberState, seq: u64) -> bool {
        state.joined_at <= seq && state.revoked_at.is_none_or(|r| r > seq)
    }
}

impl MembershipView for InMemoryMembership {
    fn latest_seq(&self) -> u64 {
        self.latest
    }

    fn device_valid_at(&self, seq: u64, member: &MemberId, device_pub: &[u8; KEY_LEN]) -> bool {
        self.members.get(member).is_some_and(|state| {
            Self::active_at(state, seq)
                && state
                    .devices
                    .iter()
                    .any(|(d, at)| d == device_pub && *at <= seq)
        })
    }

    fn can_write_at(&self, seq: u64, member: &MemberId, table_id: &[u8; ID_LEN]) -> bool {
        self.members.get(member).is_some_and(|state| {
            Self::active_at(state, seq)
                && state
                    .tables
                    .iter()
                    .any(|(t, at)| t == table_id && *at <= seq)
        })
    }

    fn epoch_held_at(&self, seq: u64, member: &MemberId, epoch: u32) -> bool {
        let Some(rotated_at) = self.epochs.get(epoch as usize) else {
            return false;
        };
        self.members.get(member).is_some_and(|state| {
            *rotated_at <= seq
                && state.joined_at <= seq
                && state.revoked_at.is_none_or(|r| r > *rotated_at)
        })
    }

    fn revoked_at(&self, member: &MemberId) -> Option<u64> {
        self.members.get(member).and_then(|state| state.revoked_at)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::collective::envelope::{sample_payload, seal, EnvelopeHeader};
    use crate::collective::identity::{DeviceIdentity, MemberIdentity};

    struct World {
        collective: CollectiveId,
        membership: InMemoryMembership,
        keys: Vec<[u8; KEY_LEN]>,
        alice: MemberIdentity,
        device: DeviceIdentity,
        table: [u8; ID_LEN],
    }

    impl World {
        fn new() -> Self {
            let alice = MemberIdentity::generate();
            let device = DeviceIdentity::generate();
            let collective = [1; ID_LEN];
            let mut membership = InMemoryMembership::new(collective);
            membership
                .join(&alice.bind_exchange(collective, 1_761_000_000))
                .unwrap(); // seq 1
            let table = [7; ID_LEN];
            membership.grant_table(&alice.member_id(), table); // seq 2
            membership
                .add_device(&alice.issue_device(&device.public(), 1_761_000_000))
                .unwrap(); // seq 3
            Self {
                collective,
                membership,
                keys: vec![*EpochKey::generate().as_bytes()],
                alice,
                device,
                table,
            }
        }

        fn key(&self, epoch: u32) -> Option<EpochKey> {
            self.keys
                .get(epoch as usize)
                .map(|k| EpochKey::from_bytes(*k))
        }

        fn envelope(&self, epoch: u32, seq: u64, op_id: u8, value: u8) -> Vec<u8> {
            let mut payload = sample_payload(&self.device, self.alice.member_id(), seq);
            payload.op_id = [op_id; ID_LEN];
            payload.op = vec![value];
            payload.table_id = self.table;
            let signed = payload.sign(&self.device);
            let header = EnvelopeHeader::new(self.collective, epoch, [0; ID_LEN]);
            seal(&self.key(epoch).unwrap(), header, &signed).to_bytes()
        }

        fn receive(
            &self,
            journals: &mut Journals,
            policy: RevokedPolicy,
            bytes: &[u8],
        ) -> Decision {
            receive(journals, &self.membership, policy, |e| self.key(e), bytes)
        }
    }

    #[test]
    fn apply_then_duplicate_envelope_then_reencryption_is_idempotent() {
        let w = World::new();
        let mut j = Journals::new();
        let first = w.envelope(0, 3, 1, 1);
        assert!(matches!(
            w.receive(&mut j, RevokedPolicy::Reject, &first),
            Decision::Apply(_)
        ));
        assert_eq!(
            w.receive(&mut j, RevokedPolicy::Reject, &first),
            Decision::SkipDuplicateEnvelope
        );
        let again = w.envelope(0, 3, 1, 1);
        assert_ne!(again, first);
        assert_eq!(
            w.receive(&mut j, RevokedPolicy::Reject, &again),
            Decision::Idempotent
        );
        let conflicting = w.envelope(0, 3, 1, 2);
        assert_eq!(
            w.receive(&mut j, RevokedPolicy::Reject, &conflicting),
            Decision::Rejected(Reason::IntegrityViolation)
        );
    }

    #[test]
    fn unknown_epoch_and_garbage_do_not_poison_the_envelope_journal() {
        let w = World::new();
        let mut j = Journals::new();
        let bytes = w.envelope(0, 3, 2, 1);
        let mut unknown = bytes.clone();
        unknown[36..40].copy_from_slice(&9u32.to_be_bytes());
        assert_eq!(
            w.receive(&mut j, RevokedPolicy::Reject, &unknown),
            Decision::Rejected(Reason::UnknownEpoch)
        );
        let mut flipped = bytes.clone();
        *flipped.last_mut().unwrap() ^= 1;
        assert_eq!(
            w.receive(&mut j, RevokedPolicy::Reject, &flipped),
            Decision::Rejected(Reason::AuthenticationFailed)
        );
        assert_eq!(
            w.receive(&mut j, RevokedPolicy::Reject, &bytes[..10]),
            Decision::Rejected(Reason::Malformed)
        );
        assert!(matches!(
            w.receive(&mut j, RevokedPolicy::Reject, &bytes),
            Decision::Apply(_)
        ));
    }

    #[test]
    fn membership_seq_from_the_future_is_deferred_not_applied() {
        let w = World::new();
        let mut j = Journals::new();
        let bytes = w.envelope(0, 12, 3, 1);
        assert!(matches!(
            w.receive(&mut j, RevokedPolicy::Reject, &bytes),
            Decision::Deferred(_)
        ));
        assert!(j.known_op(&w.collective, &[3; ID_LEN]).is_none());
        // Відкладений конверт не «зайняв» envelope_id: повтор до надолуження — знову Deferred.
        assert!(matches!(
            w.receive(&mut j, RevokedPolicy::Reject, &bytes),
            Decision::Deferred(_)
        ));
    }

    /// G12, зауваження 2: після надолуження журналу складу той самий конверт застосовується
    /// рівно один раз, а наступний повтор — уже дублікат.
    #[test]
    fn deferred_envelope_applies_exactly_once_after_membership_catch_up() {
        let mut w = World::new();
        let mut j = Journals::new();
        let bytes = w.envelope(0, 12, 3, 1);
        assert!(matches!(
            w.receive(&mut j, RevokedPolicy::Reject, &bytes),
            Decision::Deferred(_)
        ));
        // Журнал складу доходить до seq 12 (ще 9 подій без змін прав).
        while w.membership.latest_seq() < 12 {
            w.membership.grant_table(&w.alice.member_id(), w.table);
        }
        assert!(matches!(
            w.receive(&mut j, RevokedPolicy::Reject, &bytes),
            Decision::Apply(_)
        ));
        assert!(j.known_op(&w.collective, &[3; ID_LEN]).is_some());
        assert_eq!(
            w.receive(&mut j, RevokedPolicy::Reject, &bytes),
            Decision::SkipDuplicateEnvelope
        );
    }

    #[test]
    fn rights_and_devices_are_checked_at_membership_seq_not_client_time() {
        let w = World::new();
        let mut j = Journals::new();
        // seq 1: учасник є, але пристрій і право на таблицю з'являються лише в 2–3.
        assert_eq!(
            w.receive(&mut j, RevokedPolicy::Reject, &w.envelope(0, 1, 4, 1)),
            Decision::Rejected(Reason::DeviceNotValid)
        );
        let stranger = DeviceIdentity::generate();
        let mut payload = sample_payload(&stranger, w.alice.member_id(), 3);
        payload.table_id = w.table;
        let signed = payload.sign(&stranger);
        let bytes = seal(
            &w.key(0).unwrap(),
            EnvelopeHeader::new(w.collective, 0, [0; ID_LEN]),
            &signed,
        )
        .to_bytes();
        assert_eq!(
            w.receive(&mut j, RevokedPolicy::Reject, &bytes),
            Decision::Rejected(Reason::DeviceNotValid)
        );
        let mut other_table = sample_payload(&w.device, w.alice.member_id(), 3);
        other_table.table_id = [9; ID_LEN];
        let signed = other_table.sign(&w.device);
        let bytes = seal(
            &w.key(0).unwrap(),
            EnvelopeHeader::new(w.collective, 0, [0; ID_LEN]),
            &signed,
        )
        .to_bytes();
        assert_eq!(
            w.receive(&mut j, RevokedPolicy::Reject, &bytes),
            Decision::Rejected(Reason::NoWriteRight)
        );
    }

    #[test]
    fn revocation_rules_backdated_old_envelope_and_policy() {
        let mut w = World::new();
        let (revoked_seq, new_epoch) = w.membership.revoke(&w.alice.member_id()); // seq 4, epoch 1
        assert_eq!((revoked_seq, new_epoch), (4, 1));
        w.keys.push(*EpochKey::generate().as_bytes());
        w.membership.next(); // seq 5 — журнал пішов далі
                             // backdated signed operation: client_time до відкликання, membership_seq після.
        let backdated = w.envelope(0, 5, 5, 1);
        assert_eq!(
            w.receive(&mut Journals::new(), RevokedPolicy::Reject, &backdated),
            Decision::Rejected(Reason::MemberRevoked)
        );
        // Нова епоха від відкликаного: ключа він не має, але навіть із ключем — відмова.
        let new_epoch_env = w.envelope(1, 3, 6, 1);
        assert_eq!(
            w.receive(
                &mut Journals::new(),
                RevokedPolicy::Quarantine,
                &new_epoch_env
            ),
            Decision::Rejected(Reason::EpochNotHeld)
        );
        // Старий конверт після відкликання: створено на seq 3, доставлено на seq 5.
        let old = w.envelope(0, 3, 7, 1);
        assert_eq!(
            w.receive(&mut Journals::new(), RevokedPolicy::Reject, &old),
            Decision::Rejected(Reason::MemberRevoked)
        );
        assert!(matches!(
            w.receive(&mut Journals::new(), RevokedPolicy::Quarantine, &old),
            Decision::Quarantine(_)
        ));
    }

    #[test]
    fn device_record_without_valid_member_signature_is_not_journaled() {
        let collective = [5; ID_LEN];
        let mut membership = InMemoryMembership::new(collective);
        let alice = MemberIdentity::generate();
        let mallory = MemberIdentity::generate();
        membership
            .join(&alice.bind_exchange(collective, 1))
            .unwrap();
        let device = DeviceIdentity::generate();
        let forged = mallory.issue_device(&device.public(), 1);
        assert_eq!(
            membership.add_device(&forged).unwrap_err(),
            Reason::DeviceNotValid
        );
        let mut record = alice.issue_device(&device.public(), 1);
        record.member_id = alice.member_id();
        membership.add_device(&record).unwrap();
    }

    /// G12, U2: вступ лише з підписаним зв'язуванням для цього колективу; `join` не
    /// перезаписує ключ обміну; ротація — лише новішим записом того самого учасника.
    #[test]
    fn join_requires_binding_and_never_overwrites_exchange() {
        let collective = [6; ID_LEN];
        let mut membership = InMemoryMembership::new(collective);
        let alice = MemberIdentity::generate();
        let mallory = MemberIdentity::generate();

        // Чужий колектив і підмінений ключ обміну — у журнал не потрапляють.
        assert_eq!(
            membership
                .join(&alice.bind_exchange([9; ID_LEN], 1))
                .unwrap_err(),
            Reason::ExchangeNotBound
        );
        let mut swapped = alice.bind_exchange(collective, 1);
        swapped.exchange_pub = mallory.public().exchange;
        assert_eq!(
            membership.join(&swapped).unwrap_err(),
            Reason::ExchangeNotBound
        );
        assert_eq!(membership.latest_seq(), 0, "відхилене не займає seq");

        assert_eq!(membership.join(&alice.bind_exchange(collective, 10)), Ok(1));
        let bound = membership.bound_member(&alice.member_id()).unwrap();
        assert_eq!(bound.public(), &alice.public());

        // Повторний join навіть з новішим записом не змінює ключ обміну.
        let rotated = MemberIdentity::from_secrets(
            &alice.secrets().0,
            &MemberIdentity::generate().secrets().1,
        );
        assert_eq!(
            membership
                .join(&rotated.bind_exchange(collective, 20))
                .unwrap_err(),
            Reason::BindingNotNewer
        );
        assert_eq!(
            membership
                .bound_member(&alice.member_id())
                .unwrap()
                .public(),
            &alice.public()
        );

        // Ротація: не новіший запис відхиляється, новіший — окремий запис журналу.
        assert_eq!(
            membership
                .rotate_exchange(&rotated.bind_exchange(collective, 10))
                .unwrap_err(),
            Reason::BindingNotNewer
        );
        assert_eq!(
            membership.rotate_exchange(&rotated.bind_exchange(collective, 20)),
            Ok(2)
        );
        assert_eq!(
            membership
                .bound_member(&alice.member_id())
                .unwrap()
                .public(),
            &rotated.public()
        );
        assert_eq!(
            membership
                .rotate_exchange(&mallory.bind_exchange(collective, 30))
                .unwrap_err(),
            Reason::ExchangeNotBound,
            "ротація лише для наявного учасника"
        );

        // Відкликаний учасник не отримує обгорток і не змінює ключ.
        membership.revoke(&alice.member_id());
        assert!(membership.bound_member(&alice.member_id()).is_none());
        assert_eq!(
            membership
                .rotate_exchange(&rotated.bind_exchange(collective, 40))
                .unwrap_err(),
            Reason::MemberRevoked
        );
    }

    /// G12, U2: обгортка епохи створюється лише для учасника з журналу складу — через
    /// перевірене зв'язування, і розгортається саме його ключем обміну.
    #[test]
    fn epoch_wraps_go_only_to_bound_members() {
        use crate::collective::epoch::{unwrap_epoch_key, wrap_epoch_key};
        let collective = [8; ID_LEN];
        let mut membership = InMemoryMembership::new(collective);
        let alice = MemberIdentity::generate();
        membership
            .join(&alice.bind_exchange(collective, 1))
            .unwrap();
        let key = EpochKey::generate();
        let recipient = membership.bound_member(&alice.member_id()).unwrap();
        let wrap = wrap_epoch_key(&key, membership.current_epoch(), &recipient).unwrap();
        assert_eq!(wrap.collective_id, collective);
        assert_eq!(
            unwrap_epoch_key(&wrap, &alice).unwrap().as_bytes(),
            key.as_bytes()
        );
        assert!(membership
            .bound_member(&MemberIdentity::generate().member_id())
            .is_none());
    }
}
