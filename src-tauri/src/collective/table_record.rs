//! Підписаний запис таблиці колективу (рішення власника 30.10.2026: змінювати таблицю
//! можуть усі учасники). Власник підписує ключем учасника назву, стовпці, клас, призначення
//! і перелік тих, хто може писати; порожній перелік — усі учасники колективу. Новіший
//! `issued_at` того самого власника замінює попередній; власника змінити не можна.
//!
//! Підписані байти: `"easywar/collective/v1/table" ‖ collective_id ‖ table_id ‖ owner ‖
//! var(назва) ‖ u32 n ‖ n×var(стовпець) ‖ u8 клас ‖ u8 призначення ‖ u32 m ‖ m×owner ‖
//! i64 issued_at`.

use super::codec::{Reader, Writer};
use super::identity::{verify, MemberId, MemberIdentity, MemberPublic};
use super::replay::{InMemoryMembership, MembershipView};
use super::{labels, Reason, ID_LEN, KEY_LEN, SIGNATURE_LEN};

pub const MAX_TITLE_CHARS: usize = 80;
pub const MAX_COLUMNS: usize = 32;
pub const MAX_COLUMN_CHARS: usize = 40;
/// Найбільше явно названих учасників з правом запису.
pub const MAX_WRITERS: usize = 256;

/// Код призначення: 0 — облік після факту, 1 — планові дані.
pub const PURPOSE_AFTER_FACT: u8 = 0;
pub const PURPOSE_PLANNED: u8 = 1;

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct TableRecord {
    pub collective_id: [u8; ID_LEN],
    pub table_id: [u8; ID_LEN],
    pub owner: MemberId,
    pub title: String,
    pub columns: Vec<String>,
    /// Байт класу `send_gate::TableClass::code` (`b'A'`–`b'D'`).
    pub class: u8,
    pub purpose: u8,
    /// Хто може писати; порожньо — усі учасники колективу.
    pub writers: Vec<MemberId>,
    pub issued_at: i64,
    pub signature: [u8; SIGNATURE_LEN],
}

/// Назва таблиці: 1–80 символів без керівних знаків.
pub fn valid_title(title: &str) -> bool {
    let chars = title.chars().count();
    (1..=MAX_TITLE_CHARS).contains(&chars)
        && title.trim() == title
        && !title.chars().any(char::is_control)
}

/// Стовпці: до 32 різних назв по 1–40 символів без керівних знаків і крайніх пробілів.
pub fn valid_columns(columns: &[String]) -> bool {
    columns.len() <= MAX_COLUMNS
        && columns.iter().enumerate().all(|(i, column)| {
            let chars = column.chars().count();
            (1..=MAX_COLUMN_CHARS).contains(&chars)
                && column.trim() == column
                && !column.chars().any(char::is_control)
                && !columns[..i].contains(column)
        })
}

impl TableRecord {
    fn body(&self, w: &mut Writer) {
        w.fixed(&self.collective_id)
            .fixed(&self.table_id)
            .fixed(&self.owner)
            .var(self.title.as_bytes())
            .u32(self.columns.len() as u32);
        for column in &self.columns {
            w.var(column.as_bytes());
        }
        w.u8(self.class)
            .u8(self.purpose)
            .u32(self.writers.len() as u32);
        for writer in &self.writers {
            w.fixed(writer);
        }
        w.i64(self.issued_at);
    }

    fn signed_bytes(&self) -> Vec<u8> {
        let mut w = Writer::with_capacity(256);
        w.fixed(labels::TABLE_RECORD);
        self.body(&mut w);
        w.finish()
    }

    fn well_formed(&self) -> bool {
        valid_title(&self.title)
            && valid_columns(&self.columns)
            && (b'A'..=b'D').contains(&self.class)
            && matches!(self.purpose, PURPOSE_AFTER_FACT | PURPOSE_PLANNED)
            && self.writers.len() <= MAX_WRITERS
    }

    /// Запис підписаний власником таблиці для цього колективу.
    pub fn verify(&self, owner: &MemberPublic, collective_id: &[u8; ID_LEN]) -> Result<(), Reason> {
        if self.owner != owner.member_id() || &self.collective_id != collective_id {
            return Err(Reason::ExchangeNotBound);
        }
        if !self.well_formed() {
            return Err(Reason::Malformed);
        }
        verify(&owner.sign, &self.signed_bytes(), &self.signature).map_err(|_| Reason::BadSignature)
    }

    /// Чи може учасник писати в таблицю за цим записом.
    pub fn allows(&self, member: &MemberId) -> bool {
        self.writers.is_empty() || self.writers.contains(member) || &self.owner == member
    }

    pub fn to_bytes(&self) -> Vec<u8> {
        let mut w = Writer::with_capacity(256);
        self.body(&mut w);
        w.fixed(&self.signature);
        w.finish()
    }

    pub fn from_bytes(bytes: &[u8]) -> Result<Self, Reason> {
        let mut r = Reader::new(bytes);
        let collective_id = r.fixed()?;
        let table_id = r.fixed()?;
        let owner = r.fixed()?;
        let title = String::from_utf8(r.var()?.to_vec()).map_err(|_| Reason::Malformed)?;
        let n = r.u32()? as usize;
        if n > MAX_COLUMNS {
            return Err(Reason::Malformed);
        }
        let mut columns = Vec::with_capacity(n);
        for _ in 0..n {
            columns.push(String::from_utf8(r.var()?.to_vec()).map_err(|_| Reason::Malformed)?);
        }
        let class = r.u8()?;
        let purpose = r.u8()?;
        let m = r.u32()? as usize;
        if m > MAX_WRITERS {
            return Err(Reason::Malformed);
        }
        let mut writers = Vec::with_capacity(m);
        for _ in 0..m {
            writers.push(r.fixed::<KEY_LEN>()?);
        }
        let issued_at = r.i64()?;
        let signature = r.fixed()?;
        r.finish()?;
        let record = Self {
            collective_id,
            table_id,
            owner,
            title,
            columns,
            class,
            purpose,
            writers,
            issued_at,
            signature,
        };
        if !record.well_formed() {
            return Err(Reason::Malformed);
        }
        Ok(record)
    }
}

impl MemberIdentity {
    /// Власник підписує запис своєї таблиці.
    #[allow(clippy::too_many_arguments)]
    pub fn table_record(
        &self,
        collective_id: [u8; ID_LEN],
        table_id: [u8; ID_LEN],
        title: &str,
        columns: &[String],
        class: u8,
        purpose: u8,
        writers: &[MemberId],
        issued_at: i64,
    ) -> Result<TableRecord, Reason> {
        let mut record = TableRecord {
            collective_id,
            table_id,
            owner: self.member_id(),
            title: title.to_owned(),
            columns: columns.to_vec(),
            class,
            purpose,
            writers: writers.to_vec(),
            issued_at,
            signature: [0u8; SIGNATURE_LEN],
        };
        if !record.well_formed() {
            return Err(Reason::Malformed);
        }
        record.signature = self.sign(&record.signed_bytes());
        Ok(record)
    }
}

/// Право запису за записами таблиць (рішення власника 30.10.2026), а не за `GrantTable`
/// журналу: учасник, чинний на `seq`, пише в таблицю, якщо вона відома й запис таблиці його
/// допускає. Решта перевірок — як у журналі складу.
pub struct TableRights<'a> {
    pub membership: &'a InMemoryMembership,
    /// `(table_id, власник, перелік тих, хто пише; порожньо — усі)`.
    pub tables: &'a [([u8; ID_LEN], MemberId, Vec<MemberId>)],
}

impl MembershipView for TableRights<'_> {
    fn latest_seq(&self) -> u64 {
        self.membership.latest_seq()
    }

    fn device_valid_at(&self, seq: u64, member: &MemberId, device_pub: &[u8; KEY_LEN]) -> bool {
        self.membership.device_valid_at(seq, member, device_pub)
    }

    fn can_write_at(&self, seq: u64, member: &MemberId, table_id: &[u8; ID_LEN]) -> bool {
        self.membership.member_active_at(seq, member)
            && self.tables.iter().any(|(id, owner, writers)| {
                id == table_id
                    && (writers.is_empty() || owner == member || writers.contains(member))
            })
    }

    fn epoch_held_at(&self, seq: u64, member: &MemberId, epoch: u32) -> bool {
        self.membership.epoch_held_at(seq, member, epoch)
    }

    fn revoked_at(&self, member: &MemberId) -> Option<u64> {
        self.membership.revoked_at(member)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn columns() -> Vec<String> {
        vec!["Підрозділ".to_owned(), "Стан".to_owned()]
    }

    #[test]
    fn table_record_round_trips_and_binds_owner_and_collective() {
        let owner = MemberIdentity::generate();
        let other = MemberIdentity::generate();
        let collective = [3u8; ID_LEN];
        let record = owner
            .table_record(
                collective,
                [4u8; ID_LEN],
                "Облік",
                &columns(),
                b'C',
                PURPOSE_AFTER_FACT,
                &[],
                10,
            )
            .unwrap();
        let parsed = TableRecord::from_bytes(&record.to_bytes()).unwrap();
        assert_eq!(parsed, record);
        assert_eq!(parsed.verify(&owner.public(), &collective), Ok(()));
        assert_eq!(
            parsed.verify(&other.public(), &collective),
            Err(Reason::ExchangeNotBound)
        );
        assert_eq!(
            parsed.verify(&owner.public(), &[9u8; ID_LEN]),
            Err(Reason::ExchangeNotBound)
        );
        assert!(
            parsed.allows(&other.member_id()),
            "порожній перелік — усі учасники"
        );

        // Підміна будь-якого поля ламає підпис.
        let mut forged = parsed.clone();
        forged.columns.push("Таємний".to_owned());
        assert_eq!(
            forged.verify(&owner.public(), &collective),
            Err(Reason::BadSignature)
        );
        let mut forged = parsed.clone();
        forged.writers = vec![owner.member_id()];
        assert_eq!(
            forged.verify(&owner.public(), &collective),
            Err(Reason::BadSignature)
        );
        assert!(!forged.allows(&other.member_id()));

        let mut bytes = record.to_bytes();
        bytes.push(0);
        assert_eq!(TableRecord::from_bytes(&bytes), Err(Reason::Malformed));
    }

    #[test]
    fn malformed_table_records_are_not_signed() {
        let owner = MemberIdentity::generate();
        let c = [3u8; ID_LEN];
        let t = [4u8; ID_LEN];
        let dup = vec!["Стан".to_owned(), "Стан".to_owned()];
        assert!(owner
            .table_record(c, t, "", &columns(), b'C', 0, &[], 1)
            .is_err());
        assert!(owner
            .table_record(c, t, "Облік", &dup, b'C', 0, &[], 1)
            .is_err());
        assert!(owner
            .table_record(c, t, "Облік", &columns(), b'E', 0, &[], 1)
            .is_err());
        assert!(owner
            .table_record(c, t, "Облік", &columns(), b'C', 2, &[], 1)
            .is_err());
        assert!(owner
            .table_record(c, t, " Облік", &columns(), b'C', 0, &[], 1)
            .is_err());
    }
}
