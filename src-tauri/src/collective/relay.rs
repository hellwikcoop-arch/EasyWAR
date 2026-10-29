//! Локальна лабораторна черга `EnvelopeV1`. Жодного IPC, сокета чи дозволу WAN.
//! Клас операції захований у ciphertext: цю чергу не можна використовувати як
//! доказ дозволу маршруту. Rust-перевірка класу, членства й права потрібна до send.

use std::collections::HashSet;
use std::ffi::OsString;
use std::fs::{self, File, OpenOptions};
use std::io::{self, Write};
use std::path::{Path, PathBuf};

use fs2::FileExt;

use super::codec::{Reader, Writer};
use super::envelope::Envelope;
use super::{sha256, ID_LEN, KEY_LEN};

const MAGIC: &[u8; 8] = b"EWRELAY1";
pub const MAX_TTL_SECONDS: i64 = 24 * 60 * 60;
pub const MAX_ENVELOPE_BYTES: usize = 1024 * 1024;
pub const MAX_CAPACITY_BYTES: usize = 100 * 1024 * 1024;
const MAX_RECORDS: usize = 10_000;
const MAX_FILE_BYTES: u64 = (MAX_CAPACITY_BYTES + MAX_RECORDS * 20 + 20) as u64;

#[derive(Debug, thiserror::Error)]
pub enum MailboxError {
    #[error("локальна черга пошкоджена")]
    Corrupt,
    #[error("недійсний зашифрований конверт")]
    InvalidEnvelope,
    #[error("недійсний строк зберігання")]
    InvalidExpiry,
    #[error("конверт або черга перевищує квоту")]
    Capacity,
    #[error("ідентифікатор конверта вже має інший вміст")]
    ConflictingEnvelope,
    #[error("локальна черга вже відкрита іншим процесом")]
    Busy,
    #[error("помилка локальної черги: {0}")]
    Io(#[from] io::Error),
}

#[derive(Clone, Debug, Eq, PartialEq)]
struct Entry {
    seq: u64,
    expires_at: i64,
    scope: [u8; ID_LEN],
    id: [u8; ID_LEN],
    digest: [u8; KEY_LEN],
    bytes: Vec<u8>,
}

/// Локальний результат запису. Він не є підписаною квитанцією relay чи `APPLIED`.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum PutResult {
    Stored,
    AlreadyStored,
}

/// Результат видалення за підтвердженням.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum RemoveResult {
    Removed,
    /// Немає такого пакета (уже видалено або минув TTL): повторне підтвердження безпечне.
    NotFound,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Page {
    pub envelopes: Vec<Vec<u8>>,
    pub next_cursor: u64,
    pub has_more: bool,
}

/// Один власник файлу одночасно. Доступ до мережі та автентифікація одержувача
/// навмисно відсутні; викликач має забезпечити їх до будь-якого транспорту.
pub struct OfflineMailbox {
    path: PathBuf,
    _lock_file: File,
    capacity_bytes: usize,
    next_seq: u64,
    entries: Vec<Entry>,
}

impl OfflineMailbox {
    pub fn open(path: impl AsRef<Path>, capacity_bytes: usize) -> Result<Self, MailboxError> {
        if capacity_bytes == 0 || capacity_bytes > MAX_CAPACITY_BYTES {
            return Err(MailboxError::Capacity);
        }
        let path = path.as_ref().to_path_buf();
        let mut lock_name: OsString = path.as_os_str().to_os_string();
        lock_name.push(".lock");
        let lock_file = OpenOptions::new()
            .read(true)
            .write(true)
            .create(true)
            .truncate(false)
            .open(PathBuf::from(lock_name))?;
        match FileExt::try_lock_exclusive(&lock_file) {
            Ok(()) => {}
            Err(error) if error.kind() == io::ErrorKind::WouldBlock => {
                return Err(MailboxError::Busy);
            }
            Err(error) => return Err(error.into()),
        }
        let mut mailbox = Self {
            path,
            _lock_file: lock_file,
            capacity_bytes,
            next_seq: 1,
            entries: Vec::new(),
        };
        match fs::metadata(&mailbox.path) {
            Ok(metadata) => {
                if metadata.len() > MAX_FILE_BYTES {
                    return Err(MailboxError::Corrupt);
                }
                mailbox.read_snapshot(&fs::read(&mailbox.path)?)?;
            }
            Err(error) if error.kind() == io::ErrorKind::NotFound => {}
            Err(error) => return Err(error.into()),
        }
        Ok(mailbox)
    }

    fn read_snapshot(&mut self, bytes: &[u8]) -> Result<(), MailboxError> {
        let mut reader = Reader::new(bytes);
        if reader.fixed::<8>().map_err(|_| MailboxError::Corrupt)? != *MAGIC {
            return Err(MailboxError::Corrupt);
        }
        let next_seq = reader.u64().map_err(|_| MailboxError::Corrupt)?;
        let count = reader.u32().map_err(|_| MailboxError::Corrupt)? as usize;
        if count > MAX_RECORDS || next_seq == 0 {
            return Err(MailboxError::Corrupt);
        }
        let mut entries = Vec::with_capacity(count);
        let mut seen = HashSet::with_capacity(count);
        let mut total = 0usize;
        let mut last_seq = 0;
        for _ in 0..count {
            let seq = reader.u64().map_err(|_| MailboxError::Corrupt)?;
            let expires_at = reader.i64().map_err(|_| MailboxError::Corrupt)?;
            let raw = reader.var().map_err(|_| MailboxError::Corrupt)?;
            if seq <= last_seq || seq >= next_seq || raw.len() > MAX_ENVELOPE_BYTES {
                return Err(MailboxError::Corrupt);
            }
            total = total.checked_add(raw.len()).ok_or(MailboxError::Corrupt)?;
            if total > self.capacity_bytes {
                return Err(MailboxError::Corrupt);
            }
            let envelope = Envelope::from_bytes(raw).map_err(|_| MailboxError::Corrupt)?;
            if !seen.insert((envelope.header.recipient_scope, envelope.header.envelope_id)) {
                return Err(MailboxError::Corrupt);
            }
            entries.push(Entry {
                seq,
                expires_at,
                scope: envelope.header.recipient_scope,
                id: envelope.header.envelope_id,
                digest: sha256(&[raw]),
                bytes: raw.to_vec(),
            });
            last_seq = seq;
        }
        reader.finish().map_err(|_| MailboxError::Corrupt)?;
        self.next_seq = next_seq;
        self.entries = entries;
        Ok(())
    }

    /// Приймає тільки синтаксично коректний `EnvelopeV1`; ciphertext не розкриває.
    /// Пакет одержувача лишається в черзі до TTL: неперевірений ACK його не видаляє.
    pub fn put(
        &mut self,
        bytes: &[u8],
        expires_at: i64,
        now: i64,
    ) -> Result<PutResult, MailboxError> {
        if !matches!(expires_at.checked_sub(now), Some(1..=MAX_TTL_SECONDS)) {
            return Err(MailboxError::InvalidExpiry);
        }
        if bytes.len() > MAX_ENVELOPE_BYTES {
            return Err(MailboxError::Capacity);
        }
        let envelope = Envelope::from_bytes(bytes).map_err(|_| MailboxError::InvalidEnvelope)?;
        let digest = sha256(&[bytes]);
        let scope = envelope.header.recipient_scope;
        let id = envelope.header.envelope_id;
        if let Some(old) = self
            .entries
            .iter()
            .find(|entry| entry.expires_at > now && entry.scope == scope && entry.id == id)
        {
            return if old.digest == digest {
                Ok(PutResult::AlreadyStored)
            } else {
                Err(MailboxError::ConflictingEnvelope)
            };
        }
        let mut entries: Vec<Entry> = self
            .entries
            .iter()
            .filter(|entry| entry.expires_at > now)
            .cloned()
            .collect();
        let used: usize = entries.iter().map(|entry| entry.bytes.len()).sum();
        if entries.len() >= MAX_RECORDS || bytes.len() > self.capacity_bytes.saturating_sub(used) {
            return Err(MailboxError::Capacity);
        }
        let next_seq = self.next_seq.checked_add(1).ok_or(MailboxError::Capacity)?;
        entries.push(Entry {
            seq: self.next_seq,
            expires_at,
            scope,
            id,
            digest,
            bytes: bytes.to_vec(),
        });
        self.write_snapshot(next_seq, &entries)?;
        self.next_seq = next_seq;
        self.entries = entries;
        Ok(PutResult::Stored)
    }

    /// Видаляє конверт за перевіреним підтвердженням одержувача (ADR store-forward, `ack`).
    /// Інший digest — відмова без видалення: чужий чи підмінений пакет не зникає.
    pub fn remove(
        &mut self,
        scope: [u8; ID_LEN],
        id: [u8; ID_LEN],
        digest: &[u8; KEY_LEN],
        now: i64,
    ) -> Result<RemoveResult, MailboxError> {
        let Some(position) = self
            .entries
            .iter()
            .position(|entry| entry.expires_at > now && entry.scope == scope && entry.id == id)
        else {
            return Ok(RemoveResult::NotFound);
        };
        if &self.entries[position].digest != digest {
            return Err(MailboxError::ConflictingEnvelope);
        }
        let entries: Vec<Entry> = self
            .entries
            .iter()
            .enumerate()
            .filter(|(index, entry)| *index != position && entry.expires_at > now)
            .map(|(_, entry)| entry.clone())
            .collect();
        self.write_snapshot(self.next_seq, &entries)?;
        self.entries = entries;
        Ok(RemoveResult::Removed)
    }

    /// Cursor — локальний монотонний номер. Повторне читання без ACK є безпечним;
    /// лише одержувач із ключем епохи може перевірити й застосувати пакет.
    pub fn fetch(&self, scope: [u8; ID_LEN], cursor: u64, limit: usize, now: i64) -> Page {
        let limit = limit.min(100);
        let mut page = Page {
            envelopes: Vec::new(),
            next_cursor: cursor,
            has_more: false,
        };
        for entry in self
            .entries
            .iter()
            .filter(|entry| entry.scope == scope && entry.seq > cursor && entry.expires_at > now)
        {
            if page.envelopes.len() == limit {
                page.has_more = true;
                break;
            }
            page.next_cursor = entry.seq;
            page.envelopes.push(entry.bytes.clone());
        }
        page
    }

    fn write_snapshot(&self, next_seq: u64, entries: &[Entry]) -> Result<(), MailboxError> {
        let size = 20
            + entries
                .iter()
                .map(|entry| 20 + entry.bytes.len())
                .sum::<usize>();
        let mut writer = Writer::with_capacity(size);
        writer.fixed(MAGIC).u64(next_seq).u32(entries.len() as u32);
        for entry in entries {
            writer
                .u64(entry.seq)
                .i64(entry.expires_at)
                .var(&entry.bytes);
        }
        let parent = self.path.parent().ok_or(MailboxError::Corrupt)?;
        let mut temp = tempfile::NamedTempFile::new_in(parent)?;
        temp.write_all(&writer.finish())?;
        temp.as_file_mut().sync_all()?;
        temp.persist(&self.path)
            .map_err(|error| MailboxError::Io(error.error))?;
        #[cfg(unix)]
        File::open(parent)?.sync_all()?;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::collective::envelope::{open, sample_payload, seal, EnvelopeHeader};
    use crate::collective::epoch::EpochKey;
    use crate::collective::identity::{DeviceIdentity, MemberIdentity};

    fn sealed(key: &EpochKey, scope: [u8; ID_LEN], class: u8) -> Vec<u8> {
        let member = MemberIdentity::generate();
        let device = DeviceIdentity::generate();
        let mut payload = sample_payload(&device, member.member_id(), 1);
        payload.class = class;
        seal(
            key,
            EnvelopeHeader::new([1; ID_LEN], 1, scope),
            &payload.sign(&device),
        )
        .to_bytes()
    }

    #[test]
    fn offline_store_fetch_restart_and_end_to_end_open() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("relay.queue");
        let key = EpochKey::generate();
        let scope = [2; ID_LEN];
        let bytes = sealed(&key, scope, b'C');
        let mut mailbox = OfflineMailbox::open(&path, 4096).unwrap();
        assert_eq!(mailbox.put(&bytes, 1000, 1).unwrap(), PutResult::Stored);
        assert_eq!(
            mailbox.put(&bytes, 1000, 1).unwrap(),
            PutResult::AlreadyStored
        );
        drop(mailbox);
        let mailbox = OfflineMailbox::open(&path, 4096).unwrap();
        assert!(mailbox.fetch([3; ID_LEN], 0, 10, 2).envelopes.is_empty());
        let page = mailbox.fetch(scope, 0, 10, 2);
        assert_eq!(page.envelopes, vec![bytes]);
        assert!(!page.has_more);
        assert!(mailbox
            .fetch(scope, page.next_cursor, 10, 2)
            .envelopes
            .is_empty());
        let parsed = Envelope::from_bytes(&page.envelopes[0]).unwrap();
        assert_eq!(open(&key, &parsed).unwrap().payload.class, b'C');
        assert!(mailbox.fetch(scope, 0, 10, 1000).envelopes.is_empty());
        assert!(!fs::read(path)
            .unwrap()
            .windows(b"synthetic".len())
            .any(|part| part == b"synthetic"));
    }

    #[test]
    fn quota_ttl_conflict_and_invalid_wire_fail_closed() {
        let dir = tempfile::tempdir().unwrap();
        let key = EpochKey::generate();
        let scope = [4; ID_LEN];
        let bytes = sealed(&key, scope, b'C');
        let mut mailbox = OfflineMailbox::open(dir.path().join("queue"), bytes.len()).unwrap();
        assert!(matches!(
            mailbox.put(&bytes, 1, 1),
            Err(MailboxError::InvalidExpiry)
        ));
        assert!(matches!(
            mailbox.put(&bytes, MAX_TTL_SECONDS + 2, 1),
            Err(MailboxError::InvalidExpiry)
        ));
        assert!(matches!(
            mailbox.put(b"plaintext", 100, 1),
            Err(MailboxError::InvalidEnvelope)
        ));
        mailbox.put(&bytes, 100, 1).unwrap();
        let another = sealed(&key, scope, b'C');
        assert!(matches!(
            mailbox.put(&another, 100, 1),
            Err(MailboxError::Capacity)
        ));
        let mut conflicting = bytes.clone();
        *conflicting.last_mut().unwrap() ^= 1;
        assert!(matches!(
            mailbox.put(&conflicting, 100, 1),
            Err(MailboxError::ConflictingEnvelope)
        ));
        assert!(mailbox.fetch(scope, 0, 1, 2).envelopes[0] == bytes);
        assert_eq!(mailbox.put(&another, 200, 100).unwrap(), PutResult::Stored);
    }

    #[test]
    fn remove_needs_the_same_digest_and_survives_restart() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("queue");
        let key = EpochKey::generate();
        let scope = [5; ID_LEN];
        let bytes = sealed(&key, scope, b'C');
        let envelope = Envelope::from_bytes(&bytes).unwrap();
        let id = envelope.header.envelope_id;
        let mut mailbox = OfflineMailbox::open(&path, 4096).unwrap();
        mailbox.put(&bytes, 100, 1).unwrap();
        assert!(matches!(
            mailbox.remove(scope, id, &[0; KEY_LEN], 2),
            Err(MailboxError::ConflictingEnvelope)
        ));
        assert_eq!(
            mailbox.fetch(scope, 0, 10, 2).envelopes,
            vec![bytes.clone()]
        );
        let digest = sha256(&[&bytes]);
        assert_eq!(
            mailbox.remove(scope, id, &digest, 2).unwrap(),
            RemoveResult::Removed
        );
        assert_eq!(
            mailbox.remove(scope, id, &digest, 2).unwrap(),
            RemoveResult::NotFound
        );
        drop(mailbox);
        let mailbox = OfflineMailbox::open(&path, 4096).unwrap();
        assert!(mailbox.fetch(scope, 0, 10, 2).envelopes.is_empty());
    }

    #[test]
    fn damaged_snapshot_is_rejected_without_overwrite() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("queue");
        fs::write(&path, b"broken").unwrap();
        assert!(matches!(
            OfflineMailbox::open(&path, 1024),
            Err(MailboxError::Corrupt)
        ));
        assert_eq!(fs::read(path).unwrap(), b"broken");
    }

    #[test]
    fn cursor_pages_only_the_requested_recipient() {
        let dir = tempfile::tempdir().unwrap();
        let key = EpochKey::generate();
        let first = [6; ID_LEN];
        let other = [7; ID_LEN];
        let mut mailbox = OfflineMailbox::open(dir.path().join("queue"), 4096).unwrap();
        let a = sealed(&key, first, b'C');
        let b = sealed(&key, other, b'C');
        let c = sealed(&key, first, b'C');
        mailbox.put(&a, 100, 1).unwrap();
        mailbox.put(&b, 100, 1).unwrap();
        mailbox.put(&c, 100, 1).unwrap();
        let page = mailbox.fetch(first, 0, 1, 2);
        assert_eq!(page.envelopes, vec![a]);
        assert!(page.has_more);
        let next = mailbox.fetch(first, page.next_cursor, 1, 2);
        assert_eq!(next.envelopes, vec![c]);
        assert!(!next.has_more);
        assert_eq!(mailbox.fetch(other, 0, 1, 2).envelopes, vec![b]);
    }

    #[test]
    fn concurrent_open_is_rejected_then_restart_keeps_the_first_write() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("queue");
        let key = EpochKey::generate();
        let scope = [9; ID_LEN];
        let bytes = sealed(&key, scope, b'C');
        let mut first = OfflineMailbox::open(&path, 4096).unwrap();
        assert!(matches!(
            OfflineMailbox::open(&path, 4096),
            Err(MailboxError::Busy)
        ));
        first.put(&bytes, 100, 1).unwrap();
        drop(first);
        let second = OfflineMailbox::open(&path, 4096).unwrap();
        assert_eq!(second.fetch(scope, 0, 1, 2).envelopes, vec![bytes]);
    }
}
