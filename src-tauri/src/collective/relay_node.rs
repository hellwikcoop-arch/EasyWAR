//! Вузол EasyWAR Relay (E8, обмін між містами, етап 2б; рішення JE від 30.10.2026 09:30Z і
//! 09:47Z): стан сервера для кількох колективів без мережі. HTTP — у `pair_relay.rs`.
//!
//! - Вузол обслуговує лише колективи зі списку оператора: відбиток колективу й відбиток
//!   учасника-засновника (як у вікні «Колективи»: `XXXXX-XXXXX/YYYYY-YYYYY`). Сторонні не
//!   можуть зберігати на ньому пакети.
//! - Журнал складу вузлу приносить учасник. Вузол перевіряє кожен запис сам: перший журнал —
//!   лише від засновника, наступні — лише від чинного учасника з дійсним пристроєм і лише як
//!   продовження вже відомого журналу (розбіжність відхиляється, нічого не змінюючи).
//! - Пакети — запечатані конверти [`EnvelopeV1`](super::envelope). Ключів епох на вузлі немає,
//!   тож вміст він не читає; квитанцію `STORED` підписує ключ вузла, що зберігається в теці
//!   даних і переживає перезапуск.
//! - Квота й строк зберігання — з [`OfflineMailbox`]: ≤ 100 МБ, ≤ 24 год.

use std::collections::HashMap;
use std::fs::{self, File, OpenOptions};
use std::io::{Read, Write};
use std::path::{Path, PathBuf};

use super::codec::{Reader, Writer};
use super::epoch::CollectiveId;
use super::identity::{DeviceIdentity, MemberId};
use super::relay::{MailboxError, OfflineMailbox, MAX_ENVELOPE_BYTES};
use super::relay_auth::{
    AckRequest, AuthenticatedRelay, FetchRequest, JournalRequest, PutRequest, RelayDenied,
    RelayError,
};
use super::replay::{InMemoryMembership, MembershipRecord, MembershipView};
use super::{random_array, ID_LEN, KEY_LEN};
use crate::collective_store::fingerprint;

const JOURNAL_MAGIC: &[u8; 8] = b"EWRJRNL1";
const NODE_KEY_FILE: &str = "node.key";

/// Колектив, який оператор дозволив обслуговувати.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct HostedCollective {
    pub collective: String,
    pub founder: String,
}

impl HostedCollective {
    /// Розбір `XXXXX-XXXXX/YYYYY-YYYYY` (регістр не важливий).
    pub fn parse(text: &str) -> Result<Self, String> {
        let valid = |part: &str| {
            part.len() == 11
                && part.as_bytes()[5] == b'-'
                && part
                    .bytes()
                    .enumerate()
                    .all(|(i, b)| i == 5 || matches!(b, b'A'..=b'Z' | b'2'..=b'7'))
        };
        let upper = text.trim().to_ascii_uppercase();
        match upper.split_once('/') {
            Some((collective, founder)) if valid(collective) && valid(founder) => Ok(Self {
                collective: collective.to_owned(),
                founder: founder.to_owned(),
            }),
            _ => Err(format!(
                "«{text}» — очікується відбиток колективу й засновника: XXXXX-XXXXX/YYYYY-YYYYY"
            )),
        }
    }
}

/// Відмова вузла. Код іде в тілі відповіді, текст — для користувача.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum NodeDenied {
    /// Колективу немає в списку оператора або вузол ще не має його журналу.
    NotHosted,
    /// Запит не розбирається.
    Malformed,
    /// Перевірка запиту не пройдена.
    Relay(RelayDenied),
    /// Запис журналу недійсний.
    JournalInvalid,
    /// Журнал не продовжує відомий вузлу.
    JournalDiverged,
    /// Перший журнал приніс не засновник або засновник не той, що в списку оператора.
    NotFounder,
    /// Квота вузла вичерпана.
    Capacity,
    /// Строк зберігання поза межами.
    InvalidExpiry,
    /// Під тим самим номером уже інший пакет.
    ConflictingEnvelope,
    /// Помилка диска на вузлі.
    Storage,
}

const RELAY_CODES: [(RelayDenied, &str); 12] = [
    (RelayDenied::Stale, "stale"),
    (RelayDenied::BadSignature, "bad-signature"),
    (RelayDenied::Replay, "replay"),
    (RelayDenied::Busy, "busy"),
    (RelayDenied::MemberRevoked, "member-revoked"),
    (RelayDenied::DeviceNotValid, "device-not-valid"),
    (RelayDenied::ScopeForbidden, "scope-forbidden"),
    (RelayDenied::WrongCollective, "wrong-collective"),
    (RelayDenied::InvalidEnvelope, "invalid-envelope"),
    (RelayDenied::BadLimit, "bad-limit"),
    (RelayDenied::UntrustedRelay, "untrusted-relay"),
    (RelayDenied::ReceiptMismatch, "receipt-mismatch"),
];

const NODE_CODES: [(NodeDenied, &str); 9] = [
    (NodeDenied::NotHosted, "not-hosted"),
    (NodeDenied::Malformed, "bad-request"),
    (NodeDenied::JournalInvalid, "journal-invalid"),
    (NodeDenied::JournalDiverged, "journal-diverged"),
    (NodeDenied::NotFounder, "not-founder"),
    (NodeDenied::Capacity, "capacity"),
    (NodeDenied::InvalidExpiry, "invalid-expiry"),
    (NodeDenied::ConflictingEnvelope, "conflicting-envelope"),
    (NodeDenied::Storage, "storage"),
];

impl NodeDenied {
    pub fn code(self) -> &'static str {
        if let NodeDenied::Relay(denied) = self {
            return RELAY_CODES
                .iter()
                .find(|(known, _)| *known == denied)
                .map(|(_, code)| *code)
                .unwrap_or("bad-request");
        }
        NODE_CODES
            .iter()
            .find(|(known, _)| *known == self)
            .map(|(_, code)| *code)
            .unwrap_or("bad-request")
    }

    pub fn from_code(code: &str) -> Option<Self> {
        RELAY_CODES
            .iter()
            .find(|(_, known)| *known == code)
            .map(|(denied, _)| NodeDenied::Relay(*denied))
            .or_else(|| {
                NODE_CODES
                    .iter()
                    .find(|(_, known)| *known == code)
                    .map(|(denied, _)| *denied)
            })
    }

    pub fn message(self) -> &'static str {
        match self {
            NodeDenied::NotHosted => "вузол не обслуговує цей колектив",
            NodeDenied::Malformed => "вузол не зрозумів запит",
            NodeDenied::Relay(denied) => denied.message(),
            NodeDenied::JournalInvalid => "журнал складу містить недійсний запис",
            NodeDenied::JournalDiverged => "журнал складу розходиться з відомим вузлу",
            NodeDenied::NotFounder => "перший журнал може принести лише засновник колективу",
            NodeDenied::Capacity => "на вузлі закінчилось місце для пакетів",
            NodeDenied::InvalidExpiry => "недійсний строк зберігання пакета",
            NodeDenied::ConflictingEnvelope => "під цим номером на вузлі вже інший пакет",
            NodeDenied::Storage => "помилка диска на вузлі",
        }
    }
}

impl From<RelayDenied> for NodeDenied {
    fn from(denied: RelayDenied) -> Self {
        NodeDenied::Relay(denied)
    }
}

impl From<RelayError> for NodeDenied {
    fn from(error: RelayError) -> Self {
        match error {
            RelayError::Denied(denied) => NodeDenied::Relay(denied),
            RelayError::Mailbox(error) => mailbox_denied(error),
        }
    }
}

fn mailbox_denied(error: MailboxError) -> NodeDenied {
    match error {
        MailboxError::Capacity => NodeDenied::Capacity,
        MailboxError::InvalidExpiry => NodeDenied::InvalidExpiry,
        MailboxError::InvalidEnvelope => NodeDenied::Relay(RelayDenied::InvalidEnvelope),
        MailboxError::ConflictingEnvelope => NodeDenied::ConflictingEnvelope,
        MailboxError::Corrupt | MailboxError::Busy | MailboxError::Io(_) => NodeDenied::Storage,
    }
}

fn hex(bytes: &[u8]) -> String {
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}

fn unhex(text: &str) -> Option<CollectiveId> {
    if text.len() != 2 * ID_LEN {
        return None;
    }
    let mut id = [0; ID_LEN];
    for (i, byte) in id.iter_mut().enumerate() {
        *byte = u8::from_str_radix(text.get(2 * i..2 * i + 2)?, 16).ok()?;
    }
    Some(id)
}

/// Журнал із сирих записів: усі мають застосуватися суцільно від `seq = 1`.
fn rebuild(
    collective_id: CollectiveId,
    records: &[Vec<u8>],
) -> Result<InMemoryMembership, NodeDenied> {
    let mut membership = InMemoryMembership::new(collective_id);
    for (index, bytes) in records.iter().enumerate() {
        let seq = index as u64 + 1;
        let record = MembershipRecord::from_bytes(bytes).map_err(|_| NodeDenied::JournalInvalid)?;
        if membership.apply(seq, record) != Ok(seq) {
            return Err(NodeDenied::JournalInvalid);
        }
    }
    Ok(membership)
}

/// Засновник — учасник першого запису журналу.
fn founder(collective_id: &CollectiveId, membership: &InMemoryMembership) -> Option<MemberId> {
    match membership.records().first()? {
        MembershipRecord::Join(binding) => {
            binding.verify(collective_id).ok().map(|b| b.member_id())
        }
        _ => None,
    }
}

struct Hosted {
    records: Vec<Vec<u8>>,
    membership: InMemoryMembership,
    relay: AuthenticatedRelay,
}

/// Стан вузла: ключ, список оператора й колективи, чий журнал уже відомий.
pub struct RelayNode {
    dir: PathBuf,
    node_secret: [u8; KEY_LEN],
    allowed: Vec<HostedCollective>,
    capacity_bytes: usize,
    hosted: HashMap<CollectiveId, Hosted>,
}

impl RelayNode {
    /// Відкрити теку даних: ключ вузла (створюється один раз), журнали й черги колективів зі
    /// списку. Журнал колективу, якого вже немає в списку, не завантажується й не видаляється.
    pub fn open(
        dir: impl AsRef<Path>,
        allowed: Vec<HostedCollective>,
        capacity_bytes: usize,
    ) -> Result<Self, String> {
        let dir = dir.as_ref().to_path_buf();
        fs::create_dir_all(&dir).map_err(|error| format!("тека даних вузла: {error}"))?;
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let _ = fs::set_permissions(&dir, fs::Permissions::from_mode(0o700));
        }
        let node_secret = Self::node_secret(&dir.join(NODE_KEY_FILE))?;
        let mut node = Self {
            dir,
            node_secret,
            allowed,
            capacity_bytes,
            hosted: HashMap::new(),
        };
        let entries =
            fs::read_dir(&node.dir).map_err(|error| format!("тека даних вузла: {error}"))?;
        for entry in entries.flatten() {
            let name = entry.file_name().to_string_lossy().into_owned();
            let Some(collective_id) = name.strip_suffix(".journal").and_then(unhex) else {
                continue;
            };
            let records = Self::read_journal(&entry.path())
                .map_err(|_| format!("журнал {name} пошкоджений"))?;
            let membership =
                rebuild(collective_id, &records).map_err(|_| format!("журнал {name} недійсний"))?;
            if !node.is_allowed(&collective_id, &membership) {
                continue;
            }
            let relay = node
                .relay_for(&collective_id)
                .map_err(|denied| denied.message().to_owned())?;
            node.hosted.insert(
                collective_id,
                Hosted {
                    records,
                    membership,
                    relay,
                },
            );
        }
        Ok(node)
    }

    fn node_secret(path: &Path) -> Result<[u8; KEY_LEN], String> {
        let secret: [u8; KEY_LEN];
        match File::open(path) {
            Ok(mut file) => {
                let mut bytes = Vec::new();
                file.read_to_end(&mut bytes)
                    .map_err(|error| format!("ключ вузла: {error}"))?;
                secret = bytes
                    .as_slice()
                    .try_into()
                    .map_err(|_| "ключ вузла пошкоджений".to_owned())?;
            }
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
                secret = random_array();
                let mut options = OpenOptions::new();
                options.write(true).create_new(true);
                #[cfg(unix)]
                {
                    use std::os::unix::fs::OpenOptionsExt;
                    options.mode(0o600);
                }
                let mut file = options
                    .open(path)
                    .map_err(|error| format!("ключ вузла: {error}"))?;
                file.write_all(&secret)
                    .and_then(|()| file.sync_all())
                    .map_err(|error| format!("ключ вузла: {error}"))?;
            }
            Err(error) => return Err(format!("ключ вузла: {error}")),
        }
        Ok(secret)
    }

    /// Відкритий ключ вузла: учасники звіряють його відбиток з оператором і вносять у довірені.
    pub fn node_public(&self) -> [u8; KEY_LEN] {
        DeviceIdentity::from_secret(&self.node_secret).public().0
    }

    /// Скільки колективів вузол уже обслуговує.
    pub fn hosted_len(&self) -> usize {
        self.hosted.len()
    }

    fn is_allowed(&self, collective_id: &CollectiveId, membership: &InMemoryMembership) -> bool {
        let Some(founder) = founder(collective_id, membership) else {
            return false;
        };
        let (collective, founder) = (fingerprint(collective_id), fingerprint(&founder));
        self.allowed
            .iter()
            .any(|entry| entry.collective == collective && entry.founder == founder)
    }

    fn relay_for(&self, collective_id: &CollectiveId) -> Result<AuthenticatedRelay, NodeDenied> {
        let mailbox = OfflineMailbox::open(
            self.dir.join(format!("{}.mailbox", hex(collective_id))),
            self.capacity_bytes,
        )
        .map_err(mailbox_denied)?;
        Ok(AuthenticatedRelay::new(
            *collective_id,
            DeviceIdentity::from_secret(&self.node_secret),
            mailbox,
        ))
    }

    fn read_journal(path: &Path) -> Result<Vec<Vec<u8>>, ()> {
        let bytes = fs::read(path).map_err(|_| ())?;
        let mut r = Reader::new(&bytes);
        if &r.fixed::<8>().map_err(|_| ())? != JOURNAL_MAGIC {
            return Err(());
        }
        let count = r.u32().map_err(|_| ())? as usize;
        let mut records = Vec::with_capacity(count.min(4096));
        for _ in 0..count {
            records.push(r.var().map_err(|_| ())?.to_vec());
        }
        r.finish().map_err(|_| ())?;
        Ok(records)
    }

    fn write_journal(
        &self,
        collective_id: &CollectiveId,
        records: &[Vec<u8>],
    ) -> Result<(), NodeDenied> {
        let mut w = Writer::with_capacity(12 + records.iter().map(|r| r.len() + 4).sum::<usize>());
        w.fixed(JOURNAL_MAGIC).u32(records.len() as u32);
        for record in records {
            w.var(record);
        }
        let write = || -> std::io::Result<()> {
            let mut temp = tempfile::NamedTempFile::new_in(&self.dir)?;
            temp.write_all(&w.finish())?;
            temp.as_file_mut().sync_all()?;
            temp.persist(self.dir.join(format!("{}.journal", hex(collective_id))))
                .map_err(|error| error.error)?;
            #[cfg(unix)]
            File::open(&self.dir)?.sync_all()?;
            Ok(())
        };
        write().map_err(|_| NodeDenied::Storage)
    }

    /// Прийняти журнал складу. Повертає номер останнього запису, відомого вузлу.
    fn journal(
        &mut self,
        collective_id: CollectiveId,
        request: &JournalRequest,
        now: i64,
    ) -> Result<u64, NodeDenied> {
        let membership = rebuild(collective_id, &request.records)?;
        if !self.is_allowed(&collective_id, &membership) {
            // Колектив поза списком і чужий засновник — однакова відповідь: вузол не підказує,
            // які колективи він обслуговує.
            return Err(if self.hosted.contains_key(&collective_id) {
                NodeDenied::JournalDiverged
            } else {
                NodeDenied::NotHosted
            });
        }
        if let Some(hosted) = self.hosted.get_mut(&collective_id) {
            let common = hosted.records.len().min(request.records.len());
            if hosted.records[..common] != request.records[..common] {
                return Err(NodeDenied::JournalDiverged);
            }
            // Приносить лише той, хто вже є в журналі вузла.
            hosted.relay.journal(&hosted.membership, request, now)?;
            if request.records.len() <= hosted.records.len() {
                return Ok(hosted.membership.latest_seq());
            }
            self.write_journal(&collective_id, &request.records)?;
            let latest = membership.latest_seq();
            let hosted = self
                .hosted
                .get_mut(&collective_id)
                .expect("колектив щойно знайдено");
            hosted.records = request.records.clone();
            hosted.membership = membership;
            return Ok(latest);
        }
        if Some(request.auth.member_id) != founder(&collective_id, &membership) {
            return Err(NodeDenied::NotFounder);
        }
        let mut relay = self.relay_for(&collective_id)?;
        relay.journal(&membership, request, now)?;
        self.write_journal(&collective_id, &request.records)?;
        let latest = membership.latest_seq();
        self.hosted.insert(
            collective_id,
            Hosted {
                records: request.records.clone(),
                membership,
                relay,
            },
        );
        Ok(latest)
    }

    /// Обробити запит `дія` з тілом `колектив (16) ‖ запит`. `node` — без тіла.
    pub fn handle(&mut self, action: &str, body: &[u8], now: i64) -> Result<Vec<u8>, NodeDenied> {
        if action == "node" {
            return if body.is_empty() {
                Ok(self.node_public().to_vec())
            } else {
                Err(NodeDenied::Malformed)
            };
        }
        if body.len() < ID_LEN {
            return Err(NodeDenied::Malformed);
        }
        let (id, rest) = body.split_at(ID_LEN);
        let collective_id: CollectiveId = id.try_into().expect("довжина перевірена");
        if action == "journal" {
            let request = JournalRequest::from_bytes(rest).map_err(|_| NodeDenied::Malformed)?;
            return self
                .journal(collective_id, &request, now)
                .map(|latest| latest.to_be_bytes().to_vec());
        }
        let hosted = self
            .hosted
            .get_mut(&collective_id)
            .ok_or(NodeDenied::NotHosted)?;
        match action {
            "put" => {
                let request = PutRequest::from_bytes(rest).map_err(|_| NodeDenied::Malformed)?;
                if request.envelope.len() > MAX_ENVELOPE_BYTES {
                    return Err(NodeDenied::Capacity);
                }
                Ok(hosted
                    .relay
                    .put(&hosted.membership, &request, now)?
                    .to_bytes())
            }
            "fetch" => {
                let request = FetchRequest::from_bytes(rest).map_err(|_| NodeDenied::Malformed)?;
                Ok(hosted
                    .relay
                    .fetch(&hosted.membership, &request, now)?
                    .to_bytes())
            }
            "ack" => {
                let request = AckRequest::from_bytes(rest).map_err(|_| NodeDenied::Malformed)?;
                Ok(vec![hosted
                    .relay
                    .ack(&hosted.membership, &request, now)?
                    .code()])
            }
            _ => Err(NodeDenied::Malformed),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::collective::envelope::{sample_payload, seal, EnvelopeHeader};
    use crate::collective::epoch::EpochKey;
    use crate::collective::identity::MemberIdentity;
    use crate::collective::relay::Page;
    use crate::collective::relay_auth::{member_scope, AckStatus, StoredReceipt};

    const NOW: i64 = 1_761_900_000;

    struct Member {
        identity: MemberIdentity,
        device: DeviceIdentity,
    }

    impl Member {
        fn new() -> Self {
            Self {
                identity: MemberIdentity::generate(),
                device: DeviceIdentity::generate(),
            }
        }

        fn id(&self) -> MemberId {
            self.identity.member_id()
        }
    }

    struct World {
        collective: CollectiveId,
        membership: InMemoryMembership,
        founder: Member,
        bob: Member,
        key: EpochKey,
    }

    impl World {
        /// Засновник і один учасник (синтетичні ключі).
        fn new() -> Self {
            let collective: CollectiveId = random_array();
            let mut membership = InMemoryMembership::new(collective);
            let (founder, bob) = (Member::new(), Member::new());
            for (member, at) in [(&founder, NOW - 20), (&bob, NOW - 10)] {
                membership
                    .join(&member.identity.bind_exchange(collective, at))
                    .unwrap();
                membership
                    .add_device(&member.identity.issue_device(&member.device.public(), at))
                    .unwrap();
            }
            Self {
                collective,
                membership,
                founder,
                bob,
                key: EpochKey::generate(),
            }
        }

        fn allowed(&self) -> HostedCollective {
            HostedCollective {
                collective: fingerprint(&self.collective),
                founder: fingerprint(&self.founder.id()),
            }
        }

        fn records(&self, upto: usize) -> Vec<Vec<u8>> {
            self.membership.records()[..upto]
                .iter()
                .map(MembershipRecord::to_bytes)
                .collect()
        }

        fn body(&self, request: Vec<u8>) -> Vec<u8> {
            [self.collective.as_slice(), &request].concat()
        }

        fn journal(&self, by: &Member, upto: usize) -> Vec<u8> {
            self.body(
                JournalRequest::sign(
                    &self.collective,
                    by.id(),
                    &by.device,
                    self.records(upto),
                    NOW,
                )
                .to_bytes(),
            )
        }

        fn envelope(&self, author: &Member, scope: [u8; ID_LEN]) -> Vec<u8> {
            let mut payload =
                sample_payload(&author.device, author.id(), self.membership.latest_seq());
            payload.op_id = random_array();
            seal(
                &self.key,
                EnvelopeHeader::new(self.collective, 0, scope),
                &payload.sign(&author.device),
            )
            .to_bytes()
        }
    }

    fn node(dir: &Path, world: &World) -> RelayNode {
        RelayNode::open(dir, vec![world.allowed()], 1 << 20).unwrap()
    }

    #[test]
    fn hosted_collective_text_is_validated() {
        assert_eq!(
            HostedCollective::parse(" mzxw6-ytboi/MZXW6-YTBOJ ").unwrap(),
            HostedCollective {
                collective: "MZXW6-YTBOI".into(),
                founder: "MZXW6-YTBOJ".into(),
            }
        );
        for bad in [
            "",
            "MZXW6-YTBOI",
            "MZXW6YTBOI/MZXW6-YTBOJ",
            "MZXW6-YTBO1/MZXW6-YTBOJ",
        ] {
            assert!(HostedCollective::parse(bad).is_err(), "{bad}");
        }
    }

    #[test]
    fn founder_journal_then_put_fetch_ack_survive_restart() {
        let world = World::new();
        let dir = tempfile::tempdir().unwrap();
        let mut relay = node(dir.path(), &world);
        let node_pub = relay.node_public();
        // Поки журналу немає, пакети не приймаються.
        let scope = member_scope(&world.collective, &world.bob.id());
        let envelope = world.envelope(&world.founder, scope);
        let put = world.body(
            PutRequest::sign(
                &world.collective,
                world.founder.id(),
                &world.founder.device,
                envelope.clone(),
                NOW + 3600,
                NOW,
            )
            .to_bytes(),
        );
        assert_eq!(relay.handle("put", &put, NOW), Err(NodeDenied::NotHosted));

        let latest = relay
            .handle("journal", &world.journal(&world.founder, 4), NOW)
            .unwrap();
        assert_eq!(latest, 4u64.to_be_bytes());
        let receipt = StoredReceipt::from_bytes(&relay.handle("put", &put, NOW).unwrap()).unwrap();
        receipt.verify(&node_pub, &envelope).unwrap();
        assert!(!receipt.already_stored);
        drop(relay);

        // Перезапуск: той самий ключ вузла, журнал і пакет на місці.
        let mut relay = node(dir.path(), &world);
        assert_eq!(relay.node_public(), node_pub);
        assert_eq!(relay.hosted_len(), 1);
        assert_eq!(relay.handle("node", b"", NOW).unwrap(), node_pub.to_vec());
        let fetch = world.body(
            FetchRequest::sign(
                &world.collective,
                world.bob.id(),
                &world.bob.device,
                scope,
                0,
                10,
                NOW + 1,
            )
            .to_bytes(),
        );
        let page = Page::from_bytes(&relay.handle("fetch", &fetch, NOW + 1).unwrap()).unwrap();
        assert_eq!(page.envelopes, vec![envelope.clone()]);
        // Засновник чужу адресу не читає.
        let foreign = world.body(
            FetchRequest::sign(
                &world.collective,
                world.founder.id(),
                &world.founder.device,
                scope,
                0,
                10,
                NOW + 1,
            )
            .to_bytes(),
        );
        assert_eq!(
            relay.handle("fetch", &foreign, NOW + 1),
            Err(NodeDenied::Relay(RelayDenied::ScopeForbidden))
        );
        let ack = world.body(
            AckRequest::sign(
                &world.collective,
                world.bob.id(),
                &world.bob.device,
                &envelope,
                NOW + 2,
            )
            .unwrap()
            .to_bytes(),
        );
        let status = relay.handle("ack", &ack, NOW + 2).unwrap();
        assert_eq!(AckStatus::from_code(status[0]), Some(AckStatus::Removed));
        let fetch = world.body(
            FetchRequest::sign(
                &world.collective,
                world.bob.id(),
                &world.bob.device,
                scope,
                0,
                10,
                NOW + 3,
            )
            .to_bytes(),
        );
        let page = Page::from_bytes(&relay.handle("fetch", &fetch, NOW + 3).unwrap()).unwrap();
        assert!(page.envelopes.is_empty());
    }

    #[test]
    fn only_listed_collectives_and_the_founder_start_a_journal() {
        let world = World::new();
        let dir = tempfile::tempdir().unwrap();
        // Колектив поза списком.
        let other = World::new();
        let mut relay = RelayNode::open(dir.path(), vec![other.allowed()], 1 << 20).unwrap();
        assert_eq!(
            relay.handle("journal", &world.journal(&world.founder, 4), NOW),
            Err(NodeDenied::NotHosted)
        );
        // У списку той самий колектив, але інший засновник.
        let mut wrong = world.allowed();
        wrong.founder = fingerprint(&world.bob.id());
        let mut relay = RelayNode::open(dir.path(), vec![wrong], 1 << 20).unwrap();
        assert_eq!(
            relay.handle("journal", &world.journal(&world.founder, 4), NOW),
            Err(NodeDenied::NotHosted)
        );
        // Перший журнал приносить не засновник.
        let mut relay = node(dir.path(), &world);
        assert_eq!(
            relay.handle("journal", &world.journal(&world.bob, 4), NOW),
            Err(NodeDenied::NotFounder)
        );
        // Сторонній пристрій від імені засновника.
        let stranger = DeviceIdentity::generate();
        let forged = world.body(
            JournalRequest::sign(
                &world.collective,
                world.founder.id(),
                &stranger,
                world.records(4),
                NOW,
            )
            .to_bytes(),
        );
        assert_eq!(
            relay.handle("journal", &forged, NOW),
            Err(NodeDenied::Relay(RelayDenied::DeviceNotValid))
        );
        assert_eq!(relay.hosted_len(), 0);
        assert_eq!(
            relay.handle("journal", b"short", NOW),
            Err(NodeDenied::Malformed)
        );
    }

    #[test]
    fn journal_grows_only_from_members_and_never_diverges() {
        let world = World::new();
        let dir = tempfile::tempdir().unwrap();
        let mut relay = node(dir.path(), &world);
        // Засновник приносить лише себе (2 записи).
        assert_eq!(
            relay
                .handle("journal", &world.journal(&world.founder, 2), NOW)
                .unwrap(),
            2u64.to_be_bytes()
        );
        // Bob ще не в журналі вузла — сам себе не додасть.
        assert_eq!(
            relay.handle("journal", &world.journal(&world.bob, 4), NOW),
            Err(NodeDenied::Relay(RelayDenied::DeviceNotValid))
        );
        // Засновник продовжує журнал.
        assert_eq!(
            relay
                .handle("journal", &world.journal(&world.founder, 4), NOW)
                .unwrap(),
            4u64.to_be_bytes()
        );
        // Коротший журнал від учасника — без змін.
        assert_eq!(
            relay
                .handle("journal", &world.journal(&world.bob, 2), NOW)
                .unwrap(),
            4u64.to_be_bytes()
        );
        // Інша гілка журналу: третій запис — інший учасник.
        let mut fork = InMemoryMembership::new(world.collective);
        for record in &world.membership.records()[..2] {
            let seq = fork.latest_seq() + 1;
            fork.apply(seq, record.clone()).unwrap();
        }
        let carol = Member::new();
        fork.join(&carol.identity.bind_exchange(world.collective, NOW))
            .unwrap();
        let records: Vec<_> = fork
            .records()
            .iter()
            .map(MembershipRecord::to_bytes)
            .collect();
        let diverged = world.body(
            JournalRequest::sign(
                &world.collective,
                world.founder.id(),
                &world.founder.device,
                records,
                NOW,
            )
            .to_bytes(),
        );
        assert_eq!(
            relay.handle("journal", &diverged, NOW),
            Err(NodeDenied::JournalDiverged)
        );
        // Зіпсований запис.
        let mut broken = world.records(4);
        broken[3][5] ^= 1;
        let broken = world.body(
            JournalRequest::sign(
                &world.collective,
                world.founder.id(),
                &world.founder.device,
                broken,
                NOW,
            )
            .to_bytes(),
        );
        assert_eq!(
            relay.handle("journal", &broken, NOW),
            Err(NodeDenied::JournalInvalid)
        );
        drop(relay);
        assert_eq!(node(dir.path(), &world).hosted_len(), 1);
    }

    #[test]
    fn denial_codes_round_trip() {
        for (denied, _) in RELAY_CODES {
            let denied = NodeDenied::Relay(denied);
            assert_eq!(NodeDenied::from_code(denied.code()), Some(denied));
        }
        for (denied, _) in NODE_CODES {
            assert_eq!(NodeDenied::from_code(denied.code()), Some(denied));
        }
        assert_eq!(NodeDenied::from_code("nope"), None);
    }
}
