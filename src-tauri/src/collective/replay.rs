//! Приймання конверта: дворівневий захист від повторів (ADR, 2.4) і авторизація лише за
//! автентифікованим журналом складу й епохою, без довіри до `client_time`
//! (зауваження J5 C2a-01/02). Сховище журналів тут — у пам'яті; збереження в SQLite — C3b.
//!
//! Передумови C3b з G12: журнал складу рахує `latest_seq` лише як суцільний застосований
//! префікс (A3); журнал операцій розрізняє автора (A6); відкладені конверти мають горизонт,
//! обмежену чергу з TTL, а відкликаний на поточному журналі автор не відкладається (N1).

use std::collections::{BTreeMap, HashMap, HashSet};

use super::codec::{Reader, Writer};
use super::envelope::{self, Envelope, SignedPayload};
use super::epoch::{CollectiveId, EpochKey};
use super::identity::{BoundMember, DeviceRecord, ExchangeBinding, MemberId, NameRecord};
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

/// Найбільший відрив `membership_seq` конверта від `latest_seq`, за якого конверт ще
/// відкладається (N1). Далі — відмова: вузол не тримає обіцянок на необмежене майбутнє.
pub const DEFER_HORIZON: u64 = 1024;

/// Ключ журналу операцій: `(collective, author_member_id, op_id)` (A6) — однаковий `op_id`
/// від різних авторів не вважається ні дублікатом, ні порушенням цілісності.
type OpKey = (CollectiveId, MemberId, [u8; ID_LEN]);

/// Журнали конвертів і операцій одного вузла.
#[derive(Default)]
pub struct Journals {
    envelopes: HashSet<(CollectiveId, [u8; ID_LEN])>,
    ops: HashMap<OpKey, [u8; KEY_LEN]>,
}

impl Journals {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn known_op(
        &self,
        collective: &CollectiveId,
        author: &MemberId,
        op_id: &[u8; ID_LEN],
    ) -> Option<&[u8; KEY_LEN]> {
        self.ops.get(&(*collective, *author, *op_id))
    }
}

/// Погляд на автентифікований журнал складу (C1c). Усі перевірки — за станом на заданий
/// `seq`, а не за часом автора.
pub trait MembershipView {
    /// Суцільний застосований префікс журналу (A3): усі записи `1..=latest_seq` застосовано,
    /// записи після розриву не враховуються, навіть якщо вже отримані.
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
    let latest = membership.latest_seq();
    if seq > latest {
        // N1: відкликаний на поточному журналі автор не може мати права після відкликання,
        // тому такий конверт відхиляється одразу, а не чекає вічно; надто далеке майбутнє —
        // теж відмова. В обох випадках рішення остаточне, тож envelope_id іде в журнал.
        if membership.revoked_at(&payload.author_member_id).is_some() {
            journals.envelopes.insert(envelope_key);
            return Err(Reason::MemberRevoked);
        }
        if seq - latest > DEFER_HORIZON {
            // Обмеження ємності, а не вирок конверту: envelope_id не займається, ту саму
            // доставку після надолуження журналу буде перевірено повністю.
            return Err(Reason::DeferLimit);
        }
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
    let op_key = (
        header.collective_id,
        payload.author_member_id,
        payload.op_id,
    );
    match journals.ops.get(&op_key) {
        Some(known) if *known == digest => Ok(Decision::Idempotent),
        Some(_) => Err(Reason::IntegrityViolation),
        None => {
            journals.ops.insert(op_key, digest);
            Ok(Decision::Apply(signed))
        }
    }
}

/// Обмежена черга відкладених конвертів одного вузла (N1): зберігаються байти конверта,
/// бо після надолуження журналу його треба перевірити повністю ще раз. Ліміти — розмір
/// черги й TTL; горизонт `seq` перевіряє вже [`receive`].
pub struct DeferredQueue {
    capacity: usize,
    ttl_secs: i64,
    items: Vec<DeferredItem>,
}

struct DeferredItem {
    membership_seq: u64,
    received_at: i64,
    bytes: Vec<u8>,
}

impl DeferredQueue {
    /// Попередні ліміти до вимірювань C3b: 256 конвертів, 7 діб.
    pub const DEFAULT_CAPACITY: usize = 256;
    pub const DEFAULT_TTL_SECS: i64 = 7 * 24 * 60 * 60;

    pub fn new(capacity: usize, ttl_secs: i64) -> Self {
        Self {
            capacity,
            ttl_secs,
            items: Vec::new(),
        }
    }

    pub fn len(&self) -> usize {
        self.items.len()
    }

    pub fn is_empty(&self) -> bool {
        self.items.is_empty()
    }

    /// Ставить конверт у чергу після рішення [`Decision::Deferred`]. Повна черга — відмова
    /// (старі конверти не витісняються мовчки); ті самі байти вдруге не дублюються.
    pub fn offer(&mut self, membership_seq: u64, bytes: &[u8], now: i64) -> Result<(), Reason> {
        self.expire(now);
        if self.items.iter().any(|item| item.bytes == bytes) {
            return Ok(());
        }
        if self.items.len() >= self.capacity {
            return Err(Reason::DeferLimit);
        }
        self.items.push(DeferredItem {
            membership_seq,
            received_at: now,
            bytes: bytes.to_vec(),
        });
        Ok(())
    }

    /// Видаляє конверти, що пролежали довше TTL; повертає їх кількість для локального журналу.
    pub fn expire(&mut self, now: i64) -> usize {
        let before = self.items.len();
        let ttl = self.ttl_secs;
        self.items
            .retain(|item| now.saturating_sub(item.received_at) <= ttl);
        before - self.items.len()
    }

    /// Забирає конверти, для яких журнал складу вже дійшов до `membership_seq`, — їх треба
    /// знову подати в [`receive`]; решта лишається в черзі.
    pub fn take_ready(&mut self, latest_seq: u64, now: i64) -> Vec<Vec<u8>> {
        self.expire(now);
        let (ready, waiting): (Vec<_>, Vec<_>) = std::mem::take(&mut self.items)
            .into_iter()
            .partition(|item| item.membership_seq <= latest_seq);
        self.items = waiting;
        ready.into_iter().map(|item| item.bytes).collect()
    }
}

/// Запис журналу складу (синтетична модель C1c для перевірок C2/C3b).
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum MembershipRecord {
    Join(ExchangeBinding),
    RotateExchange(ExchangeBinding),
    GrantTable {
        member: MemberId,
        table_id: [u8; ID_LEN],
    },
    AddDevice(DeviceRecord),
    Revoke(MemberId),
    /// Ім'я учасника, підписане ним самим; новіше (більший `issued_at`) замінює попереднє.
    SetName(NameRecord),
}

impl MembershipRecord {
    const JOIN: u8 = 1;
    const ROTATE_EXCHANGE: u8 = 2;
    const GRANT_TABLE: u8 = 3;
    const ADD_DEVICE: u8 = 4;
    const REVOKE: u8 = 5;
    const SET_NAME: u8 = 6;

    /// Канонічне кодування для сховища (C3b): байт виду і поля фіксованої довжини.
    pub fn to_bytes(&self) -> Vec<u8> {
        let mut w = Writer::with_capacity(1 + ExchangeBinding::LEN);
        match self {
            MembershipRecord::Join(binding) => {
                w.u8(Self::JOIN).fixed(&binding.to_bytes());
            }
            MembershipRecord::RotateExchange(binding) => {
                w.u8(Self::ROTATE_EXCHANGE).fixed(&binding.to_bytes());
            }
            MembershipRecord::GrantTable { member, table_id } => {
                w.u8(Self::GRANT_TABLE).fixed(member).fixed(table_id);
            }
            MembershipRecord::AddDevice(record) => {
                w.u8(Self::ADD_DEVICE).fixed(&record.to_bytes());
            }
            MembershipRecord::Revoke(member) => {
                w.u8(Self::REVOKE).fixed(member);
            }
            MembershipRecord::SetName(record) => {
                w.u8(Self::SET_NAME).fixed(&record.to_bytes());
            }
        }
        w.finish()
    }

    /// Розбір без перевірки підписів: їх перевіряє застосування запису до журналу.
    pub fn from_bytes(bytes: &[u8]) -> Result<Self, Reason> {
        let (&kind, rest) = bytes.split_first().ok_or(Reason::Malformed)?;
        match kind {
            Self::JOIN => Ok(MembershipRecord::Join(ExchangeBinding::from_bytes(rest)?)),
            Self::ROTATE_EXCHANGE => Ok(MembershipRecord::RotateExchange(
                ExchangeBinding::from_bytes(rest)?,
            )),
            Self::GRANT_TABLE => {
                let mut r = Reader::new(rest);
                let record = MembershipRecord::GrantTable {
                    member: r.fixed()?,
                    table_id: r.fixed()?,
                };
                r.finish()?;
                Ok(record)
            }
            Self::ADD_DEVICE => Ok(MembershipRecord::AddDevice(DeviceRecord::from_bytes(rest)?)),
            Self::REVOKE => {
                let mut r = Reader::new(rest);
                let member = r.fixed()?;
                r.finish()?;
                Ok(MembershipRecord::Revoke(member))
            }
            Self::SET_NAME => Ok(MembershipRecord::SetName(NameRecord::from_bytes(rest)?)),
            _ => Err(Reason::Malformed),
        }
    }
}

/// Еталонна реалізація журналу складу в пам'яті (синтетична; для тестів і як зразок для
/// C1c/C3b). Вступ і ротація ключа обміну — лише з підписаним зв'язуванням для цього
/// колективу (G12, U2); запис пристрою — лише з дійсним підписом учасника. Записи з чужого
/// вузла можуть приходити не по черзі: застосовується лише суцільний префікс (A3).
pub struct InMemoryMembership {
    collective_id: CollectiveId,
    log: Vec<MembershipRecord>,
    pending: BTreeMap<u64, MembershipRecord>,
    members: HashMap<MemberId, MemberState>,
    epochs: Vec<u64>,
}

struct MemberState {
    bound: BoundMember,
    joined_at: u64,
    revoked_at: Option<u64>,
    tables: Vec<([u8; ID_LEN], u64)>,
    devices: Vec<([u8; KEY_LEN], u64)>,
    /// Чинне ім'я і його `issued_at`.
    name: Option<(String, i64)>,
}

impl InMemoryMembership {
    /// Найбільше записів після розриву, які вузол тримає до його заповнення.
    pub const MAX_PENDING: usize = 1024;

    /// Колектив створено: епоха 0 з запису 0.
    pub fn new(collective_id: CollectiveId) -> Self {
        Self {
            collective_id,
            log: Vec::new(),
            pending: BTreeMap::new(),
            members: HashMap::new(),
            epochs: vec![0],
        }
    }

    pub fn collective_id(&self) -> &CollectiveId {
        &self.collective_id
    }

    /// Застосований префікс журналу: запис `i` має `seq = i + 1`.
    pub fn records(&self) -> &[MembershipRecord] {
        &self.log
    }

    /// Учасники, не відкликані на поточному журналі.
    pub fn active_members(&self) -> usize {
        self.members
            .values()
            .filter(|state| state.revoked_at.is_none())
            .count()
    }

    /// Записи, отримані після розриву й ще не застосовані.
    pub fn pending_len(&self) -> usize {
        self.pending.len()
    }

    /// Запис журналу з номером `seq` від іншого вузла. Повтор застосованого запису —
    /// без змін (інший зміст під тим самим `seq` — [`Reason::IntegrityViolation`]); запис після
    /// розриву чекає, доки розрив не заповниться, і `latest_seq` його не враховує (A3). Коли
    /// розрив заповнено, черга застосовується по порядку; недійсний запис зупиняє префікс і
    /// відкидається. Повертає `latest_seq` після виклику.
    pub fn apply(&mut self, seq: u64, record: MembershipRecord) -> Result<u64, Reason> {
        let latest = self.latest_seq();
        if seq == 0 {
            return Err(Reason::Malformed);
        }
        if seq <= latest {
            return if self.log[(seq - 1) as usize] == record {
                Ok(latest)
            } else {
                Err(Reason::IntegrityViolation)
            };
        }
        if seq > latest + 1 {
            if let Some(known) = self.pending.get(&seq) {
                return if *known == record {
                    Ok(latest)
                } else {
                    Err(Reason::IntegrityViolation)
                };
            }
            if self.pending.len() >= Self::MAX_PENDING {
                return Err(Reason::DeferLimit);
            }
            self.pending.insert(seq, record);
            return Ok(latest);
        }
        self.append(record)?;
        while let Some(next) = self.pending.remove(&(self.latest_seq() + 1)) {
            if self.append(next).is_err() {
                break;
            }
        }
        Ok(self.latest_seq())
    }

    /// Перевіряє запис за станом на поточний префікс і дописує його наступним `seq`.
    fn append(&mut self, record: MembershipRecord) -> Result<u64, Reason> {
        let seq = self.latest_seq() + 1;
        match &record {
            MembershipRecord::Join(binding) => {
                let bound = binding.verify(&self.collective_id)?;
                if self.members.contains_key(&bound.member_id()) {
                    return Err(Reason::BindingNotNewer);
                }
                self.members.insert(
                    bound.member_id(),
                    MemberState {
                        bound,
                        joined_at: seq,
                        revoked_at: None,
                        tables: Vec::new(),
                        devices: Vec::new(),
                        name: None,
                    },
                );
            }
            MembershipRecord::RotateExchange(binding) => {
                let bound = binding.verify(&self.collective_id)?;
                let state = self
                    .members
                    .get_mut(&bound.member_id())
                    .ok_or(Reason::ExchangeNotBound)?;
                if state.revoked_at.is_some() {
                    return Err(Reason::MemberRevoked);
                }
                if bound.issued_at() <= state.bound.issued_at() {
                    return Err(Reason::BindingNotNewer);
                }
                state.bound = bound;
            }
            MembershipRecord::GrantTable { member, table_id } => {
                if let Some(state) = self.members.get_mut(member) {
                    state.tables.push((*table_id, seq));
                }
            }
            MembershipRecord::AddDevice(device) => {
                let state = self
                    .members
                    .get_mut(&device.member_id)
                    .ok_or(Reason::DeviceNotValid)?;
                device.verify(state.bound.public())?;
                state.devices.push((device.device_pub, seq));
            }
            MembershipRecord::Revoke(member) => {
                if let Some(state) = self.members.get_mut(member) {
                    state.revoked_at = Some(seq);
                }
                self.epochs.push(seq);
            }
            MembershipRecord::SetName(name) => {
                let state = self
                    .members
                    .get_mut(&name.member_id)
                    .ok_or(Reason::ExchangeNotBound)?;
                if state.revoked_at.is_some() {
                    return Err(Reason::MemberRevoked);
                }
                name.verify(state.bound.public(), &self.collective_id)?;
                if state
                    .name
                    .as_ref()
                    .is_some_and(|(_, at)| name.issued_at <= *at)
                {
                    return Err(Reason::BindingNotNewer);
                }
                state.name = Some((name.name.clone(), name.issued_at));
            }
        }
        self.log.push(record);
        Ok(seq)
    }

    /// Вступ лише з перевіреним зв'язуванням ключа обміну для цього колективу. Наявного
    /// учасника `join` не перезаписує: новий ключ обміну — тільки [`Self::rotate_exchange`].
    pub fn join(&mut self, binding: &ExchangeBinding) -> Result<u64, Reason> {
        self.append(MembershipRecord::Join(*binding))
    }

    /// Вступ разом із першим пристроєм — як одна операція: обидва записи або жоден
    /// (E8-SEC-002). Запис пристрою перевіряється до будь-якої зміни журналу; якщо він усе ж
    /// не пройде після `Join`, вступ відкочується.
    pub fn join_with_device(
        &mut self,
        binding: &ExchangeBinding,
        device: &DeviceRecord,
    ) -> Result<(u64, u64), Reason> {
        let bound = binding.verify(&self.collective_id)?;
        if self.members.contains_key(&bound.member_id()) {
            return Err(Reason::BindingNotNewer);
        }
        if device.member_id != bound.member_id() {
            return Err(Reason::DeviceNotValid);
        }
        device.verify(bound.public())?;
        let join_seq = self.join(binding)?;
        match self.add_device(device) {
            Ok(device_seq) => Ok((join_seq, device_seq)),
            Err(reason) => {
                self.members.remove(&bound.member_id());
                self.log.pop();
                Err(reason)
            }
        }
    }

    /// Ротація ключа обміну — окремий запис журналу з новішим підписаним зв'язуванням того
    /// самого учасника; відкликаний учасник ключ не змінює.
    pub fn rotate_exchange(&mut self, binding: &ExchangeBinding) -> Result<u64, Reason> {
        self.append(MembershipRecord::RotateExchange(*binding))
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
        self.append(MembershipRecord::GrantTable {
            member: *member,
            table_id,
        })
        .expect("запис права на таблицю не відхиляється")
    }

    /// Запис пристрою входить у журнал лише з дійсним підписом учасника.
    pub fn add_device(&mut self, record: &DeviceRecord) -> Result<u64, Reason> {
        self.append(MembershipRecord::AddDevice(*record))
    }

    /// Ім'я учасника входить у журнал лише з його власним підписом для цього колективу.
    pub fn set_name(&mut self, record: &NameRecord) -> Result<u64, Reason> {
        self.append(MembershipRecord::SetName(record.clone()))
    }

    /// Чинне ім'я учасника за журналом (ім'я вказав сам учасник).
    pub fn member_name(&self, member: &MemberId) -> Option<&str> {
        self.members
            .get(member)
            .and_then(|state| state.name.as_ref())
            .map(|(name, _)| name.as_str())
    }

    /// Відкликання: новий запис і нова епоха (ADR, 2.3).
    pub fn revoke(&mut self, member: &MemberId) -> (u64, u32) {
        let seq = self
            .append(MembershipRecord::Revoke(*member))
            .expect("запис відкликання не відхиляється");
        (seq, self.current_epoch())
    }

    /// Учасник у колективі на `seq`: вступив не пізніше й не відкликаний до `seq`.
    pub fn member_active_at(&self, seq: u64, member: &MemberId) -> bool {
        self.members
            .get(member)
            .is_some_and(|state| Self::active_at(state, seq))
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
        self.log.len() as u64
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
        assert!(j
            .known_op(&w.collective, &w.alice.member_id(), &[3; ID_LEN])
            .is_none());
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
        assert!(j
            .known_op(&w.collective, &w.alice.member_id(), &[3; ID_LEN])
            .is_some());
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
        w.membership.grant_table(&[0xaa; KEY_LEN], [0xee; ID_LEN]); // seq 5 — журнал пішов далі
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

    /// A3: запис після розриву не враховується в `latest_seq`, доки розрив не заповниться;
    /// конверт, що посилається на такий запис, лишається відкладеним.
    #[test]
    fn latest_seq_is_the_contiguous_applied_prefix() {
        let source = World::new(); // seq 1–3 на «авторському» вузлі
        let collective = source.collective;
        let mut replica = InMemoryMembership::new(collective);
        let join = MembershipRecord::Join(source.alice.bind_exchange(collective, 1_761_000_000));
        let grant = MembershipRecord::GrantTable {
            member: source.alice.member_id(),
            table_id: source.table,
        };
        let device = MembershipRecord::AddDevice(
            source
                .alice
                .issue_device(&source.device.public(), 1_761_000_000),
        );

        // Записи 3 і 2 приходять раніше за 1 — префікс порожній.
        assert_eq!(replica.apply(3, device.clone()), Ok(0));
        assert_eq!(replica.apply(2, grant.clone()), Ok(0));
        assert_eq!(replica.pending_len(), 2);
        let bytes = source.envelope(0, 3, 9, 1);
        let mut j = Journals::new();
        assert!(matches!(
            receive(
                &mut j,
                &replica,
                RevokedPolicy::Reject,
                |e| source.key(e),
                &bytes
            ),
            Decision::Deferred(_)
        ));

        // Запис 1 заповнює розрив — застосовуються всі три по порядку.
        assert_eq!(replica.apply(1, join.clone()), Ok(3));
        assert_eq!(replica.pending_len(), 0);
        assert!(matches!(
            receive(
                &mut j,
                &replica,
                RevokedPolicy::Reject,
                |e| source.key(e),
                &bytes
            ),
            Decision::Apply(_)
        ));

        // Повтор того самого запису — без змін; інший зміст під тим самим seq — відмова.
        assert_eq!(replica.apply(2, grant), Ok(3));
        assert_eq!(
            replica
                .apply(
                    2,
                    MembershipRecord::GrantTable {
                        member: source.alice.member_id(),
                        table_id: [0xee; ID_LEN],
                    },
                )
                .unwrap_err(),
            Reason::IntegrityViolation
        );
        assert_eq!(replica.apply(0, join).unwrap_err(), Reason::Malformed);
    }

    /// A3: недійсний запис зупиняє префікс — наступні за ним не застосовуються.
    #[test]
    fn invalid_record_stops_the_prefix() {
        let collective = [2; ID_LEN];
        let alice = MemberIdentity::generate();
        let mallory = MemberIdentity::generate();
        let mut replica = InMemoryMembership::new(collective);
        let forged_device = MembershipRecord::AddDevice(
            mallory.issue_device(&DeviceIdentity::generate().public(), 1),
        );
        assert_eq!(
            replica.apply(
                3,
                MembershipRecord::GrantTable {
                    member: alice.member_id(),
                    table_id: [1; ID_LEN],
                },
            ),
            Ok(0)
        );
        assert_eq!(replica.apply(2, forged_device), Ok(0));
        assert_eq!(
            replica.apply(
                1,
                MembershipRecord::Join(alice.bind_exchange(collective, 1))
            ),
            Ok(1),
            "запис 2 недійсний — префікс зупинився на 1"
        );
        assert_eq!(replica.latest_seq(), 1);
    }

    /// A3: черга записів після розриву обмежена.
    #[test]
    fn pending_records_are_bounded() {
        let mut replica = InMemoryMembership::new([3; ID_LEN]);
        let record = |n: u64| MembershipRecord::Revoke([n as u8; KEY_LEN]);
        for seq in 2..2 + InMemoryMembership::MAX_PENDING as u64 {
            assert_eq!(replica.apply(seq, record(seq)), Ok(0));
        }
        let next = 2 + InMemoryMembership::MAX_PENDING as u64;
        assert_eq!(
            replica.apply(next, record(next)).unwrap_err(),
            Reason::DeferLimit
        );
    }

    /// A6: однаковий `op_id` від двох авторів — дві різні операції, не дублікат і не
    /// порушення цілісності.
    #[test]
    fn op_journal_key_includes_the_author() {
        let mut w = World::new();
        let bob = MemberIdentity::generate();
        let bob_device = DeviceIdentity::generate();
        w.membership
            .join(&bob.bind_exchange(w.collective, 1_761_000_000))
            .unwrap(); // seq 4
        w.membership.grant_table(&bob.member_id(), w.table); // seq 5
        w.membership
            .add_device(&bob.issue_device(&bob_device.public(), 1_761_000_000))
            .unwrap(); // seq 6
        let mut j = Journals::new();
        let alice_op = w.envelope(0, 6, 4, 1);
        let mut payload = sample_payload(&bob_device, bob.member_id(), 6);
        payload.op_id = [4; ID_LEN];
        payload.op = vec![2];
        payload.table_id = w.table;
        let header = EnvelopeHeader::new(w.collective, 0, [0; ID_LEN]);
        let bob_op = seal(&w.key(0).unwrap(), header, &payload.sign(&bob_device)).to_bytes();
        assert!(matches!(
            w.receive(&mut j, RevokedPolicy::Reject, &alice_op),
            Decision::Apply(_)
        ));
        assert!(matches!(
            w.receive(&mut j, RevokedPolicy::Reject, &bob_op),
            Decision::Apply(_)
        ));
        assert!(j
            .known_op(&w.collective, &w.alice.member_id(), &[4; ID_LEN])
            .is_some());
        assert!(j
            .known_op(&w.collective, &bob.member_id(), &[4; ID_LEN])
            .is_some());
    }

    /// N1: автор, відкликаний на поточному журналі, не відкладається; конверт за горизонтом
    /// відхиляється, але envelope_id не займає.
    #[test]
    fn revoked_author_is_not_deferred_and_horizon_is_bounded() {
        let mut w = World::new();
        let mut j = Journals::new();
        let far = w.envelope(0, 3 + DEFER_HORIZON + 1, 6, 1);
        assert_eq!(
            w.receive(&mut j, RevokedPolicy::Reject, &far),
            Decision::Rejected(Reason::DeferLimit)
        );
        assert_eq!(
            w.receive(&mut j, RevokedPolicy::Reject, &far),
            Decision::Rejected(Reason::DeferLimit),
            "не дублікат: envelope_id не зайнято"
        );
        let at_horizon = w.envelope(0, 3 + DEFER_HORIZON, 7, 1);
        assert!(matches!(
            w.receive(&mut j, RevokedPolicy::Reject, &at_horizon),
            Decision::Deferred(_)
        ));

        w.membership.revoke(&w.alice.member_id()); // seq 4
        let future = w.envelope(0, 12, 8, 1);
        assert_eq!(
            w.receive(&mut j, RevokedPolicy::Quarantine, &future),
            Decision::Rejected(Reason::MemberRevoked)
        );
        assert_eq!(
            w.receive(&mut j, RevokedPolicy::Quarantine, &future),
            Decision::SkipDuplicateEnvelope,
            "рішення остаточне"
        );
    }

    /// N1: черга відкладених — обмежений розмір, TTL, повернення лише готових.
    #[test]
    fn deferred_queue_has_capacity_ttl_and_returns_only_ready() {
        let mut q = DeferredQueue::new(2, 100);
        assert!(q.is_empty());
        q.offer(5, b"a", 1_000).unwrap();
        q.offer(5, b"a", 1_001).unwrap(); // ті самі байти — без дубля
        q.offer(9, b"b", 1_002).unwrap();
        assert_eq!(q.len(), 2);
        assert_eq!(q.offer(7, b"c", 1_003).unwrap_err(), Reason::DeferLimit);

        assert_eq!(q.take_ready(6, 1_010), vec![b"a".to_vec()]);
        assert_eq!(q.len(), 1);
        q.offer(7, b"c", 1_011).unwrap();
        // «b» пролежав довше TTL — видаляється без повернення.
        assert_eq!(q.take_ready(9, 1_105), vec![b"c".to_vec()]);
        assert!(q.is_empty());
        assert_eq!(
            DeferredQueue::new(
                DeferredQueue::DEFAULT_CAPACITY,
                DeferredQueue::DEFAULT_TTL_SECS
            )
            .len(),
            0
        );
    }

    /// N1 разом з A3: конверт з черги після надолуження журналу застосовується рівно раз.
    #[test]
    fn deferred_queue_round_trip_with_membership_catch_up() {
        let mut w = World::new();
        let mut j = Journals::new();
        let mut q = DeferredQueue::new(8, 3_600);
        let bytes = w.envelope(0, 5, 9, 1);
        match w.receive(&mut j, RevokedPolicy::Reject, &bytes) {
            Decision::Deferred(signed) => {
                q.offer(signed.payload.membership_seq, &bytes, 10).unwrap()
            }
            other => panic!("очікувано Deferred, отримано {other:?}"),
        }
        assert!(q.take_ready(w.membership.latest_seq(), 20).is_empty());
        w.membership.grant_table(&w.alice.member_id(), w.table); // 4
        w.membership.grant_table(&w.alice.member_id(), w.table); // 5
        let ready = q.take_ready(w.membership.latest_seq(), 30);
        assert_eq!(ready.len(), 1);
        assert!(matches!(
            w.receive(&mut j, RevokedPolicy::Reject, &ready[0]),
            Decision::Apply(_)
        ));
        assert!(q.is_empty());
    }

    #[test]
    fn membership_records_round_trip_and_rebuild_the_same_journal() {
        let w = World::new();
        let records = w.membership.records().to_vec();
        assert_eq!(records.len(), 3);
        let mut rebuilt = InMemoryMembership::new(w.collective);
        for (index, record) in records.iter().enumerate() {
            let bytes = record.to_bytes();
            let parsed = MembershipRecord::from_bytes(&bytes).unwrap();
            assert_eq!(&parsed, record);
            rebuilt.apply(index as u64 + 1, parsed).unwrap();
        }
        assert_eq!(rebuilt.latest_seq(), 3);
        assert_eq!(rebuilt.active_members(), 1);
        for record in [
            MembershipRecord::GrantTable {
                member: [1; KEY_LEN],
                table_id: [2; ID_LEN],
            },
            MembershipRecord::Revoke([3; KEY_LEN]),
        ] {
            assert_eq!(
                MembershipRecord::from_bytes(&record.to_bytes()).unwrap(),
                record
            );
        }
        assert_eq!(
            MembershipRecord::from_bytes(&[]).unwrap_err(),
            Reason::Malformed
        );
        assert_eq!(
            MembershipRecord::from_bytes(&[9, 0]).unwrap_err(),
            Reason::Malformed
        );
        let mut extra = records[1].to_bytes();
        extra.push(0);
        assert_eq!(
            MembershipRecord::from_bytes(&extra).unwrap_err(),
            Reason::Malformed
        );
    }

    #[test]
    fn join_with_device_leaves_no_partial_join() {
        let mut world = World::new();
        let before = world.membership.latest_seq();
        let bob = MemberIdentity::generate();
        let mallory = MemberIdentity::generate();
        let device = DeviceIdentity::generate();
        let binding = bob.bind_exchange(world.collective, 1_761_000_100);
        // Пристрій підписано чужим ключем, але подано від імені bob.
        let mut forged = mallory.issue_device(&device.public(), 1_761_000_100);
        forged.member_id = bob.member_id();
        assert!(world
            .membership
            .join_with_device(&binding, &forged)
            .is_err());
        // Пристрій іншого учасника.
        let foreign = mallory.issue_device(&device.public(), 1_761_000_100);
        assert_eq!(
            world.membership.join_with_device(&binding, &foreign),
            Err(Reason::DeviceNotValid)
        );
        assert_eq!(world.membership.latest_seq(), before);
        assert!(world.membership.bound_member(&bob.member_id()).is_none());
        // Та сама пара після відмов проходить цілою.
        let good = bob.issue_device(&device.public(), 1_761_000_100);
        assert_eq!(
            world.membership.join_with_device(&binding, &good),
            Ok((before + 1, before + 2))
        );
        let latest = world.membership.latest_seq();
        assert!(world
            .membership
            .device_valid_at(latest, &bob.member_id(), &device.public().0));
        assert_eq!(
            world.membership.join_with_device(&binding, &good),
            Err(Reason::BindingNotNewer)
        );
        assert_eq!(world.membership.latest_seq(), latest);
    }
    #[test]
    fn member_name_is_self_signed_newer_wins_and_round_trips() {
        let mut w = World::new();
        let alice = w.alice.member_id();
        assert_eq!(w.membership.member_name(&alice), None);
        let first = w.alice.name_record(w.collective, "Синтетик А", 10).unwrap();
        let seq = w.membership.set_name(&first).unwrap();
        assert_eq!(w.membership.member_name(&alice), Some("Синтетик А"));
        let stored =
            MembershipRecord::from_bytes(&w.membership.records()[seq as usize - 1].to_bytes())
                .unwrap();
        assert_eq!(stored, MembershipRecord::SetName(first.clone()));
        // Старий запис повторно не застосовується.
        assert_eq!(w.membership.set_name(&first), Err(Reason::BindingNotNewer));
        let renamed = w.alice.name_record(w.collective, "Синтетик Б", 11).unwrap();
        w.membership.set_name(&renamed).unwrap();
        assert_eq!(w.membership.member_name(&alice), Some("Синтетик Б"));
        // Ім'я від чужого ключа, для іншого колективу чи для невідомого учасника — відмова.
        let mallory = MemberIdentity::generate();
        let mut forged = mallory.name_record(w.collective, "Синтетик В", 12).unwrap();
        assert_eq!(
            w.membership.set_name(&forged),
            Err(Reason::ExchangeNotBound)
        );
        forged.member_id = alice;
        assert_eq!(w.membership.set_name(&forged), Err(Reason::BadSignature));
        let foreign = w.alice.name_record([9; ID_LEN], "Синтетик Г", 13).unwrap();
        assert_eq!(
            w.membership.set_name(&foreign),
            Err(Reason::ExchangeNotBound)
        );
        // Відкликаний учасник ім'я не змінює.
        w.membership.revoke(&alice);
        let late = w.alice.name_record(w.collective, "Синтетик Д", 14).unwrap();
        assert_eq!(w.membership.set_name(&late), Err(Reason::MemberRevoked));
    }
}
