//! Авторитетний допуск відправки безпосередньо перед передачею (E8, C3b, пункт 1 списку JE
//! від 29.10.2026). Чиста функція без мережі, IPC, годинника й сховищ: усе, що вона знає, —
//! підтверджений власником стан таблиці, журнал складу, підписана операція і ключ епохи.
//!
//! Порядок перевірки той самий, що в ADR `collective-sync-policies.md`, п. 3, і в JS-ядрі
//! `src/sensitivity-core.js`/`src/sync-policy-core.js`: маршрут → політика → членство й право
//! запису → підтвердження людиною. JS-відповідь — лише підказка для екрана; ця функція
//! повторює всі перевірки з Rust-стану і не приймає жодного прапорця «вже перевірено».
//!
//! Результат — [`SendPermit`]: запечатаний конверт з коротким строком дії, який можна
//! забрати рівно один раз ([`SendPermit::take`]). Перевірка тому не може «відстати» від
//! журналу складу: черга бере байти лише з чинного допуску.

use super::envelope::{self, Envelope, EnvelopeHeader, SignedPayload};
use super::epoch::{CollectiveId, EpochKey};
use super::identity::MemberId;
use super::replay::MembershipView;
use super::{sha256, Reason, ID_LEN, KEY_LEN};

/// Скільки секунд живе допуск між перевіркою і постановкою в чергу.
pub const PERMIT_TTL_SECONDS: i64 = 60;

/// Клас чутливості таблиці (`docs/COLLECTIVES_PLAN.md`, 5.2): A — найменш чутливий, D —
/// лише локальна мережа.
#[derive(Clone, Copy, Debug, Eq, PartialEq, PartialOrd, Ord)]
pub enum TableClass {
    A,
    B,
    C,
    D,
}

impl TableClass {
    /// Байт класу в `Payload::class`.
    pub fn code(self) -> u8 {
        match self {
            TableClass::A => b'A',
            TableClass::B => b'B',
            TableClass::C => b'C',
            TableClass::D => b'D',
        }
    }

    pub fn from_code(code: u8) -> Option<Self> {
        match code {
            b'A' => Some(TableClass::A),
            b'B' => Some(TableClass::B),
            b'C' => Some(TableClass::C),
            b'D' => Some(TableClass::D),
            _ => None,
        }
    }
}

/// Призначення таблиці: облік після факту чи планова/попередня (клас D без винятків).
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum TablePurpose {
    AfterFact,
    Planned,
}

/// Стан таблиці, як його зберігає Rust (не JS): хто власник, що він підтвердив. Усе, чого
/// власник не підтвердив особисто, рахується класом D (`sensitivity-core.js`,
/// `effectiveColumnClass`).
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct TableAttestation {
    pub table_id: [u8; ID_LEN],
    pub owner: MemberId,
    /// Клас, який власник присвоїв таблиці (найвищий серед стовпців).
    pub class: TableClass,
    /// Хто підтвердив клас; лише власник рахується.
    pub class_confirmed_by: Option<MemberId>,
    pub purpose: TablePurpose,
    /// Хто підтвердив призначення; лише власник рахується.
    pub purpose_confirmed_by: Option<MemberId>,
}

impl TableAttestation {
    /// Призначення, підтверджене власником; інакше `None`.
    pub fn confirmed_purpose(&self) -> Option<TablePurpose> {
        (self.purpose_confirmed_by == Some(self.owner)).then_some(self.purpose)
    }

    /// Чинний клас: непідтверджене власником або планове — D.
    pub fn effective_class(&self) -> TableClass {
        if self.class_confirmed_by != Some(self.owner) {
            return TableClass::D;
        }
        match self.confirmed_purpose() {
            Some(TablePurpose::AfterFact) => self.class,
            _ => TableClass::D,
        }
    }
}

/// Транспорт, який обрав користувач для цієї відправки.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum Transport {
    /// Локальна мережа (C6a).
    Lan,
    /// Проміжний EasyWAR або relay в Інтернеті (C8).
    PeerWan,
    /// Проєкт Base44 власника (C4).
    Base44,
}

/// Політика відправки таблиці (`sync-policy-core.js`, `OUTBOUND_POLICIES`). Активний лише
/// режим «Доповісти» з показом перед відправкою; решта чекає окремих рішень власника.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum OutboundPolicy {
    AutoAfterLocalApproval,
    ReviewEachReport,
    Disabled,
}

/// Рішення власника, які дозволяють транспортам працювати. Чинне значення —
/// [`GatePolicy::CURRENT`]; тести будують своє. Жоден прапорець з JS сюди не потрапляє.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct GatePolicy {
    /// WAN-транспорт пройшов незалежне безпекове приймання (C8, окреме «так» JE).
    pub wan_transport_accepted: bool,
    /// Транспорт Base44 відкритий (C4, G01–G05).
    pub base44_accepted: bool,
}

impl GatePolicy {
    /// Стан на 29.10.2026: жоден віддалений транспорт не прийнятий.
    pub const CURRENT: GatePolicy = GatePolicy {
        wan_transport_accepted: false,
        base44_accepted: false,
    };
}

/// Усе, що потрібно для одного допуску. `reviewed_by_human` і `explicit_user_choice` —
/// факти з цього самого екрана («Доповісти» натиснуто; WAN обрано вручну), не з JS-ядра.
pub struct SendRequest<'a> {
    pub table: &'a TableAttestation,
    pub transport: Transport,
    pub outbound_policy: OutboundPolicy,
    pub reviewed_by_human: bool,
    pub explicit_user_choice: bool,
    pub signed: &'a SignedPayload,
    pub recipient_scope: [u8; ID_LEN],
    pub now: i64,
}

/// Причина відмови. Коди збігаються з JS-ядром там, де воно має такий самий крок, щоб
/// пояснення на екрані й у журналі були однакові.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum SendDenied {
    /// Клас D не йде в хмару.
    ClassDCloud,
    /// Користувач не обрав WAN явно.
    WanNeedsUserChoice,
    /// WAN-транспорт не пройшов безпекове приймання.
    WanNotReady,
    /// Транспорт Base44 не відкритий.
    Base44NotReady,
    /// Режим відправки не активний: потрібне рішення власника.
    OwnerDecisionRequired,
    /// Відправку з цієї таблиці вимкнено.
    OutboundDisabled,
    /// Операція не для цієї таблиці або клас у payload не збігається з чинним класом.
    TableMismatch,
    /// Підпис пристрою недійсний.
    BadSignature,
    /// Автор не бачив поточного журналу складу: `membership_seq` не дорівнює `latest_seq`.
    MembershipStale,
    /// Автора відкликано.
    MemberRevoked,
    /// Пристрій не підтверджений учасником.
    DeviceNotValid,
    /// Немає права запису на таблицю.
    NoWriteRight,
    /// Автор не володіє поточною епохою.
    EpochNotHeld,
    /// Людина не підтвердила «Доповісти».
    NeedsReportReview,
}

impl SendDenied {
    /// Код, як у `sensitivity-core.js`/`sync-policy-core.js`, де є відповідник.
    pub fn code(self) -> &'static str {
        match self {
            SendDenied::ClassDCloud => "class-d-cloud",
            SendDenied::WanNeedsUserChoice => "wan-needs-user-choice",
            SendDenied::WanNotReady => "wan-not-ready",
            SendDenied::Base44NotReady => "base44-not-ready",
            SendDenied::OwnerDecisionRequired => "OwnerDecisionRequired",
            SendDenied::OutboundDisabled => "outbound-disabled",
            SendDenied::TableMismatch => "table-mismatch",
            SendDenied::BadSignature => "bad-signature",
            SendDenied::MembershipStale => "membership-stale",
            SendDenied::MemberRevoked => "member-revoked",
            SendDenied::DeviceNotValid => "device-not-valid",
            SendDenied::NoWriteRight => "no-write-right",
            SendDenied::EpochNotHeld => "epoch-not-held",
            SendDenied::NeedsReportReview => "needs-report-review",
        }
    }

    /// Пояснення українською для людини; без даних таблиці.
    pub fn message(self) -> &'static str {
        match self {
            SendDenied::ClassDCloud => "Клас D не передається через хмару",
            SendDenied::WanNeedsUserChoice => "Користувач має явно вибрати передачу через інтернет",
            SendDenied::WanNotReady => "WAN-транспорт не пройшов безпекове приймання",
            SendDenied::Base44NotReady => "Транспорт Base44 ще не відкритий власником",
            SendDenied::OwnerDecisionRequired => {
                "Режим відправки не активний: потрібне окреме рішення власника"
            }
            SendDenied::OutboundDisabled => "Відправку з цієї таблиці вимкнено",
            SendDenied::TableMismatch => "Операція не відповідає таблиці або її класу",
            SendDenied::BadSignature => "Підпис пристрою недійсний",
            SendDenied::MembershipStale => "Журнал складу змінився: перевірте й доповідайте знову",
            SendDenied::MemberRevoked => "Учасника відкликано",
            SendDenied::DeviceNotValid => "Пристрій не підтверджений учасником",
            SendDenied::NoWriteRight => "Немає права запису на таблицю",
            SendDenied::EpochNotHeld => "Автор не володіє поточною епохою",
            SendDenied::NeedsReportReview => "Потрібно переглянути зміни й натиснути «Доповісти»",
        }
    }
}

/// Запечатаний конверт, дозволений до відправки. Байти віддаються один раз і лише до
/// `deadline`; після цього потрібен новий допуск.
pub struct SendPermit {
    bytes: Option<Vec<u8>>,
    digest: [u8; KEY_LEN],
    collective_id: CollectiveId,
    envelope_id: [u8; ID_LEN],
    recipient_scope: [u8; ID_LEN],
    membership_seq: u64,
    class: TableClass,
    transport: Transport,
    deadline: i64,
}

impl SendPermit {
    pub fn digest(&self) -> &[u8; KEY_LEN] {
        &self.digest
    }

    pub fn collective_id(&self) -> &CollectiveId {
        &self.collective_id
    }

    pub fn envelope_id(&self) -> &[u8; ID_LEN] {
        &self.envelope_id
    }

    pub fn recipient_scope(&self) -> &[u8; ID_LEN] {
        &self.recipient_scope
    }

    /// Запис журналу складу, на якому видано допуск.
    pub fn membership_seq(&self) -> u64 {
        self.membership_seq
    }

    pub fn class(&self) -> TableClass {
        self.class
    }

    pub fn transport(&self) -> Transport {
        self.transport
    }

    pub fn deadline(&self) -> i64 {
        self.deadline
    }

    /// Байти конверта для черги — рівно один раз і лише до строку. `None` означає, що
    /// допуск уже використано або прострочено: потрібно пройти перевірку знову.
    pub fn take(&mut self, now: i64) -> Option<Vec<u8>> {
        if now >= self.deadline {
            self.bytes = None;
            return None;
        }
        self.bytes.take()
    }
}

/// Допуск і запечатування. Кожна умова перевіряється з Rust-стану; порядок — за ADR.
pub fn authorize_send(
    policy: &GatePolicy,
    membership: &dyn MembershipView,
    collective_id: &CollectiveId,
    epoch_key: &EpochKey,
    request: &SendRequest<'_>,
) -> Result<SendPermit, SendDenied> {
    let class = request.table.effective_class();
    route(
        policy,
        class,
        request.transport,
        request.explicit_user_choice,
    )?;
    match request.outbound_policy {
        OutboundPolicy::ReviewEachReport => {}
        OutboundPolicy::AutoAfterLocalApproval => return Err(SendDenied::OwnerDecisionRequired),
        OutboundPolicy::Disabled => return Err(SendDenied::OutboundDisabled),
    }
    let payload = &request.signed.payload;
    if payload.table_id != request.table.table_id || payload.class != class.code() {
        return Err(SendDenied::TableMismatch);
    }
    request
        .signed
        .verify_signature()
        .map_err(|_| SendDenied::BadSignature)?;
    let latest = membership.latest_seq();
    if payload.membership_seq != latest {
        return Err(SendDenied::MembershipStale);
    }
    let author = &payload.author_member_id;
    if membership.revoked_at(author).is_some() {
        return Err(SendDenied::MemberRevoked);
    }
    if !membership.device_valid_at(latest, author, &payload.device_pub) {
        return Err(SendDenied::DeviceNotValid);
    }
    if !membership.can_write_at(latest, author, &payload.table_id) {
        return Err(SendDenied::NoWriteRight);
    }
    let epoch = current_epoch(membership, latest, author).ok_or(SendDenied::EpochNotHeld)?;
    if !request.reviewed_by_human {
        return Err(SendDenied::NeedsReportReview);
    }
    let header = EnvelopeHeader::new(*collective_id, epoch, request.recipient_scope);
    let envelope: Envelope = envelope::seal(epoch_key, header, request.signed);
    let bytes = envelope.to_bytes();
    Ok(SendPermit {
        digest: sha256(&[&bytes]),
        collective_id: *collective_id,
        envelope_id: envelope.header.envelope_id,
        recipient_scope: request.recipient_scope,
        membership_seq: latest,
        class,
        transport: request.transport,
        deadline: request.now.saturating_add(PERMIT_TTL_SECONDS),
        bytes: Some(bytes),
    })
}

/// Попередня перевірка для кроку «Підготувати» (SEC-003): ті самі маршрут, режим відправки,
/// відкликання, пристрій, право запису й епоха, що й у [`authorize_send`], на поточному
/// журналі, але без підпису й без підтвердження. Позитивна відповідь нічого не дозволяє:
/// крок «Доповісти» проходить повний [`authorize_send`] заново.
#[allow(clippy::too_many_arguments)]
pub fn preflight(
    policy: &GatePolicy,
    membership: &dyn MembershipView,
    table: &TableAttestation,
    transport: Transport,
    outbound_policy: OutboundPolicy,
    explicit_user_choice: bool,
    author: &MemberId,
    device_pub: &[u8; KEY_LEN],
) -> Result<(), SendDenied> {
    route(
        policy,
        table.effective_class(),
        transport,
        explicit_user_choice,
    )?;
    match outbound_policy {
        OutboundPolicy::ReviewEachReport => {}
        OutboundPolicy::AutoAfterLocalApproval => return Err(SendDenied::OwnerDecisionRequired),
        OutboundPolicy::Disabled => return Err(SendDenied::OutboundDisabled),
    }
    let latest = membership.latest_seq();
    if membership.revoked_at(author).is_some() {
        return Err(SendDenied::MemberRevoked);
    }
    if !membership.device_valid_at(latest, author, device_pub) {
        return Err(SendDenied::DeviceNotValid);
    }
    if !membership.can_write_at(latest, author, &table.table_id) {
        return Err(SendDenied::NoWriteRight);
    }
    current_epoch(membership, latest, author).ok_or(SendDenied::EpochNotHeld)?;
    Ok(())
}

/// Маршрут за класом і транспортом (`routeFor` у `sensitivity-core.js`), але без прапорців:
/// наскрізне шифрування тут завжди (конверт запечатується нижче), relay бачить лише
/// шифротекст за побудовою, а приймання транспорту — [`GatePolicy`].
fn route(
    policy: &GatePolicy,
    class: TableClass,
    transport: Transport,
    explicit_user_choice: bool,
) -> Result<(), SendDenied> {
    match transport {
        Transport::Lan => Ok(()),
        Transport::Base44 => {
            if class == TableClass::D {
                return Err(SendDenied::ClassDCloud);
            }
            if !policy.base44_accepted {
                return Err(SendDenied::Base44NotReady);
            }
            Ok(())
        }
        // Рішення JE 30.10.2026 (SEC-005): клас не блокує синхронізацію між авторизованими
        // учасниками. Через WAN усе вирішують явний вибір, прийнятий захищений транспорт і
        // ті самі перевірки членства, прав, пристрою, підпису й адресатів нижче.
        Transport::PeerWan => {
            if !explicit_user_choice {
                return Err(SendDenied::WanNeedsUserChoice);
            }
            if !policy.wan_transport_accepted {
                return Err(SendDenied::WanNotReady);
            }
            Ok(())
        }
    }
}

/// Найновіша епоха, якою автор володіє на `seq`. Епохи йдуть підряд від 0, тому перша,
/// якою автор не володіє, — межа; `None` — автор не володіє жодною.
fn current_epoch(membership: &dyn MembershipView, seq: u64, author: &MemberId) -> Option<u32> {
    let mut held = None;
    let mut epoch = 0u32;
    while membership.epoch_held_at(seq, author, epoch) {
        held = Some(epoch);
        epoch = epoch.checked_add(1)?;
    }
    held
}

/// Відмова в термінах [`Reason`] для спільних журналів: лише для випадків, що мають прямий
/// відповідник.
impl SendDenied {
    pub fn as_reason(self) -> Option<Reason> {
        match self {
            SendDenied::BadSignature => Some(Reason::BadSignature),
            SendDenied::MemberRevoked => Some(Reason::MemberRevoked),
            SendDenied::DeviceNotValid => Some(Reason::DeviceNotValid),
            SendDenied::NoWriteRight => Some(Reason::NoWriteRight),
            SendDenied::EpochNotHeld => Some(Reason::EpochNotHeld),
            _ => None,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::collective::envelope::{open, sample_payload, Payload};
    use crate::collective::identity::{DeviceIdentity, MemberIdentity};
    use crate::collective::replay::{
        receive, Decision, InMemoryMembership, Journals, RevokedPolicy,
    };

    struct World {
        collective: CollectiveId,
        membership: InMemoryMembership,
        key: EpochKey,
        alice: MemberIdentity,
        device: DeviceIdentity,
        table: TableAttestation,
    }

    impl World {
        fn new() -> Self {
            let alice = MemberIdentity::generate();
            let device = DeviceIdentity::generate();
            let collective = [1; ID_LEN];
            let mut membership = InMemoryMembership::new(collective);
            membership
                .join(&alice.bind_exchange(collective, 1_761_000_000))
                .unwrap();
            let table_id = [7; ID_LEN];
            membership.grant_table(&alice.member_id(), table_id);
            membership
                .add_device(&alice.issue_device(&device.public(), 1_761_000_001))
                .unwrap();
            let owner = alice.member_id();
            Self {
                collective,
                membership,
                key: EpochKey::generate(),
                table: TableAttestation {
                    table_id,
                    owner,
                    class: TableClass::B,
                    class_confirmed_by: Some(owner),
                    purpose: TablePurpose::AfterFact,
                    purpose_confirmed_by: Some(owner),
                },
                alice,
                device,
            }
        }

        fn payload(&self) -> Payload {
            let mut payload = sample_payload(
                &self.device,
                self.alice.member_id(),
                self.membership.latest_seq(),
            );
            payload.class = self.table.effective_class().code();
            payload.table_id = self.table.table_id;
            payload
        }

        fn signed(&self) -> SignedPayload {
            self.payload().sign(&self.device)
        }

        fn request<'a>(
            &'a self,
            signed: &'a SignedPayload,
            transport: Transport,
        ) -> SendRequest<'a> {
            SendRequest {
                table: &self.table,
                transport,
                outbound_policy: OutboundPolicy::ReviewEachReport,
                reviewed_by_human: true,
                explicit_user_choice: transport == Transport::PeerWan,
                signed,
                recipient_scope: [2; ID_LEN],
                now: 1_761_700_000,
            }
        }

        fn authorize(
            &self,
            policy: &GatePolicy,
            request: &SendRequest<'_>,
        ) -> Result<SendPermit, SendDenied> {
            authorize_send(
                policy,
                &self.membership,
                &self.collective,
                &self.key,
                request,
            )
        }
    }

    #[test]
    fn lan_permit_seals_once_and_receiver_applies_it() {
        let w = World::new();
        let signed = w.signed();
        let request = w.request(&signed, Transport::Lan);
        let mut permit = w.authorize(&GatePolicy::CURRENT, &request).unwrap();
        assert_eq!(permit.class(), TableClass::B);
        assert_eq!(permit.membership_seq(), 3);
        assert_eq!(permit.deadline(), request.now + PERMIT_TTL_SECONDS);
        let bytes = permit.take(request.now + 1).expect("перший раз байти є");
        assert_eq!(permit.digest(), &sha256(&[&bytes]));
        assert!(permit.take(request.now + 2).is_none(), "лише один раз");
        let envelope = Envelope::from_bytes(&bytes).unwrap();
        assert_eq!(&envelope.header.collective_id, permit.collective_id());
        assert_eq!(&envelope.header.recipient_scope, permit.recipient_scope());
        assert_eq!(open(&w.key, &envelope).unwrap(), signed);
        let mut journals = Journals::new();
        let key = w.key.as_bytes().to_owned();
        let decision = receive(
            &mut journals,
            &w.membership,
            RevokedPolicy::Reject,
            |epoch| (epoch == 0).then(|| EpochKey::from_bytes(key)),
            &bytes,
        );
        assert!(matches!(decision, Decision::Apply(_)), "{decision:?}");
    }

    #[test]
    fn permit_expires_without_being_taken() {
        let w = World::new();
        let signed = w.signed();
        let request = w.request(&signed, Transport::Lan);
        let mut permit = w.authorize(&GatePolicy::CURRENT, &request).unwrap();
        assert!(permit.take(request.now + PERMIT_TTL_SECONDS).is_none());
        assert!(permit.take(request.now).is_none(), "прострочений не оживає");
    }

    #[test]
    fn unconfirmed_table_is_class_d_kept_out_of_the_cloud_only() {
        let mut w = World::new();
        let stranger = MemberIdentity::generate().member_id();
        for (class_by, purpose, purpose_by) in [
            (Some(stranger), TablePurpose::AfterFact, Some(w.table.owner)),
            (None, TablePurpose::AfterFact, Some(w.table.owner)),
            (
                Some(w.table.owner),
                TablePurpose::Planned,
                Some(w.table.owner),
            ),
            (Some(w.table.owner), TablePurpose::AfterFact, None),
            (Some(w.table.owner), TablePurpose::AfterFact, Some(stranger)),
        ] {
            w.table.class_confirmed_by = class_by;
            w.table.purpose = purpose;
            w.table.purpose_confirmed_by = purpose_by;
            assert_eq!(w.table.effective_class(), TableClass::D);
            let signed = w.signed();
            let open = GatePolicy {
                wan_transport_accepted: true,
                base44_accepted: true,
            };
            // SEC-005: клас не блокує синхронізацію між учасниками; хмара — інша справа.
            assert!(w
                .authorize(&open, &w.request(&signed, Transport::PeerWan))
                .is_ok());
            assert_eq!(
                w.authorize(&open, &w.request(&signed, Transport::Base44))
                    .err(),
                Some(SendDenied::ClassDCloud)
            );
            assert!(w
                .authorize(&open, &w.request(&signed, Transport::Lan))
                .is_ok());
        }
    }

    #[test]
    fn wan_for_any_class_needs_user_choice_and_accepted_transport() {
        let mut w = World::new();
        let open = GatePolicy {
            wan_transport_accepted: true,
            base44_accepted: false,
        };
        for class in [TableClass::A, TableClass::B, TableClass::D] {
            w.table.class = class;
            let signed = w.signed();
            let request = w.request(&signed, Transport::PeerWan);
            assert!(w.authorize(&open, &request).is_ok(), "{class:?}");
            assert_eq!(
                w.authorize(&GatePolicy::CURRENT, &request).err(),
                Some(SendDenied::WanNotReady),
                "{class:?}"
            );
        }
        w.table.class = TableClass::C;
        let signed = w.signed();
        let mut request = w.request(&signed, Transport::PeerWan);
        request.explicit_user_choice = false;
        assert_eq!(
            w.authorize(&open, &request).err(),
            Some(SendDenied::WanNeedsUserChoice)
        );
        let request = w.request(&signed, Transport::PeerWan);
        assert_eq!(
            w.authorize(&GatePolicy::CURRENT, &request).err(),
            Some(SendDenied::WanNotReady),
            "чинна політика: WAN не прийнятий"
        );
        let permit = w.authorize(&open, &request).unwrap();
        assert_eq!(permit.transport(), Transport::PeerWan);
        assert_eq!(permit.class(), TableClass::C);
        assert_eq!(
            w.authorize(&GatePolicy::CURRENT, &w.request(&signed, Transport::Base44))
                .err(),
            Some(SendDenied::Base44NotReady)
        );
    }

    #[test]
    fn inactive_outbound_policies_need_owner_decision() {
        let w = World::new();
        let signed = w.signed();
        let mut request = w.request(&signed, Transport::Lan);
        request.outbound_policy = OutboundPolicy::AutoAfterLocalApproval;
        assert_eq!(
            w.authorize(&GatePolicy::CURRENT, &request).err(),
            Some(SendDenied::OwnerDecisionRequired)
        );
        request.outbound_policy = OutboundPolicy::Disabled;
        assert_eq!(
            w.authorize(&GatePolicy::CURRENT, &request).err(),
            Some(SendDenied::OutboundDisabled)
        );
        request.outbound_policy = OutboundPolicy::ReviewEachReport;
        request.reviewed_by_human = false;
        assert_eq!(
            w.authorize(&GatePolicy::CURRENT, &request).err(),
            Some(SendDenied::NeedsReportReview)
        );
    }

    #[test]
    fn payload_must_match_table_class_and_signature() {
        let w = World::new();
        let mut payload = w.payload();
        payload.class = b'A'; // JS чи інший шар «занизив» клас
        let signed = payload.sign(&w.device);
        assert_eq!(
            w.authorize(&GatePolicy::CURRENT, &w.request(&signed, Transport::Lan))
                .err(),
            Some(SendDenied::TableMismatch)
        );
        let mut payload = w.payload();
        payload.table_id = [9; ID_LEN];
        let signed = payload.sign(&w.device);
        assert_eq!(
            w.authorize(&GatePolicy::CURRENT, &w.request(&signed, Transport::Lan))
                .err(),
            Some(SendDenied::TableMismatch)
        );
        let mut signed = w.signed();
        signed.signature[0] ^= 1;
        assert_eq!(
            w.authorize(&GatePolicy::CURRENT, &w.request(&signed, Transport::Lan))
                .err(),
            Some(SendDenied::BadSignature)
        );
    }

    #[test]
    fn membership_is_rechecked_at_the_current_log() {
        let mut w = World::new();
        let mut payload = w.payload();
        payload.membership_seq = w.membership.latest_seq() - 1;
        let stale = payload.sign(&w.device);
        assert_eq!(
            w.authorize(&GatePolicy::CURRENT, &w.request(&stale, Transport::Lan))
                .err(),
            Some(SendDenied::MembershipStale)
        );
        let foreign = DeviceIdentity::generate();
        let mut payload = w.payload();
        payload.device_pub = foreign.public().0;
        let signed = payload.sign(&foreign);
        assert_eq!(
            w.authorize(&GatePolicy::CURRENT, &w.request(&signed, Transport::Lan))
                .err(),
            Some(SendDenied::DeviceNotValid)
        );
        w.table.table_id = [8; ID_LEN]; // таблиця без права запису
        let signed = w.signed();
        assert_eq!(
            w.authorize(&GatePolicy::CURRENT, &w.request(&signed, Transport::Lan))
                .err(),
            Some(SendDenied::NoWriteRight)
        );
        w.table.table_id = [7; ID_LEN];
        w.membership.revoke(&w.alice.member_id());
        let signed = w.signed();
        assert_eq!(
            w.authorize(&GatePolicy::CURRENT, &w.request(&signed, Transport::Lan))
                .err(),
            Some(SendDenied::MemberRevoked)
        );
    }

    #[test]
    fn permit_uses_the_current_epoch_after_a_rotation() {
        let mut w = World::new();
        let bob = MemberIdentity::generate();
        w.membership
            .join(&bob.bind_exchange(w.collective, 1_761_000_002))
            .unwrap();
        let (_, epoch) = w.membership.revoke(&bob.member_id());
        assert_eq!(epoch, 1);
        let signed = w.signed();
        let mut permit = w
            .authorize(&GatePolicy::CURRENT, &w.request(&signed, Transport::Lan))
            .unwrap();
        let bytes = permit.take(1_761_700_001).unwrap();
        assert_eq!(Envelope::from_bytes(&bytes).unwrap().header.epoch, 1);
    }

    #[test]
    fn preflight_checks_route_and_rights_without_a_signature() {
        let mut w = World::new();
        let author = w.alice.member_id();
        let device = w.device.public().0;
        let check = |w: &World, transport, explicit| {
            preflight(
                &GatePolicy::CURRENT,
                &w.membership,
                &w.table,
                transport,
                OutboundPolicy::ReviewEachReport,
                explicit,
                &author,
                &device,
            )
        };
        assert_eq!(check(&w, Transport::Lan, false), Ok(()));
        assert_eq!(
            check(&w, Transport::PeerWan, true),
            Err(SendDenied::WanNotReady)
        );
        assert_eq!(
            check(&w, Transport::PeerWan, false),
            Err(SendDenied::WanNeedsUserChoice)
        );
        let stranger = DeviceIdentity::generate().public().0;
        assert_eq!(
            preflight(
                &GatePolicy::CURRENT,
                &w.membership,
                &w.table,
                Transport::Lan,
                OutboundPolicy::ReviewEachReport,
                false,
                &author,
                &stranger,
            ),
            Err(SendDenied::DeviceNotValid)
        );
        w.table.table_id = [9; ID_LEN];
        assert_eq!(
            check(&w, Transport::Lan, false),
            Err(SendDenied::NoWriteRight)
        );
        w.membership.revoke(&author);
        assert_eq!(
            check(&w, Transport::Lan, false),
            Err(SendDenied::MemberRevoked)
        );
    }

    #[test]
    fn codes_and_messages_are_ukrainian_and_unique() {
        let all = [
            SendDenied::ClassDCloud,
            SendDenied::WanNeedsUserChoice,
            SendDenied::WanNotReady,
            SendDenied::Base44NotReady,
            SendDenied::OwnerDecisionRequired,
            SendDenied::OutboundDisabled,
            SendDenied::TableMismatch,
            SendDenied::BadSignature,
            SendDenied::MembershipStale,
            SendDenied::MemberRevoked,
            SendDenied::DeviceNotValid,
            SendDenied::NoWriteRight,
            SendDenied::EpochNotHeld,
            SendDenied::NeedsReportReview,
        ];
        let codes: std::collections::HashSet<_> = all.iter().map(|d| d.code()).collect();
        assert_eq!(codes.len(), all.len());
        for denied in all {
            assert!(
                denied.message().chars().any(|c| ('А'..='я').contains(&c)),
                "{}",
                denied.code()
            );
        }
        assert_eq!(
            SendDenied::NoWriteRight.as_reason(),
            Some(Reason::NoWriteRight)
        );
        assert_eq!(SendDenied::WanNotReady.as_reason(), None);
    }
}
