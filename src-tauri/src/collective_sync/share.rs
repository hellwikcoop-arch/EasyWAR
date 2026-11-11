//! Пакет оновлення `EWSYNC1.` (рішення власника 30.10.2026: змінювати таблицю можуть усі
//! учасники; дві команди вікна «Колективи» — створити й прийняти пакет). Поки немає
//! передачі локальною мережею, текст пакета люди передають самі, як запрошення.
//!
//! Пакет зашифровано чинним ключем епохи колективу (XChaCha20-Poly1305), тож прочитати
//! його може лише учасник. Усередині — увесь журнал складу (записи самоперевірні), підписані
//! власниками записи таблиць і запечатані конверти пакетів змін. Під час приймання кожна
//! частина перевіряється так само, як власна: журнал — повним застосуванням, запис таблиці —
//! підписом власника, що є в журналі, конверт — `replay::receive` з правом запису за записом
//! таблиці. Що не пройшло — не зберігається й лише рахується.
//!
//! Відкрите: `collective_id ‖ u32 епоха ‖ nonce(24) ‖ шифротекст`; AAD =
//! `"easywar/collective/v1/sync-package" ‖ collective_id ‖ u32 епоха`. Зміст:
//! `collective_id ‖ u32 n ‖ n×var(запис журналу) ‖ u32 t ‖ t×var(запис таблиці) ‖
//! u32 e ‖ e×var(конверт)`.

use std::collections::HashSet;

use chacha20poly1305::aead::{Aead, KeyInit, Payload as AeadPayload};
use chacha20poly1305::{Key, XChaCha20Poly1305, XNonce};

use super::*;
use crate::collective::envelope::Envelope;
use crate::collective::labels;
use crate::collective::table_record::{PURPOSE_AFTER_FACT, PURPOSE_PLANNED};

const SYNC_PREFIX: &str = "EWSYNC1.";
/// Найбільший пакет (до кодування в текст).
pub const MAX_SYNC_BYTES: usize = 4 * 1024 * 1024;
const SYNC_NONCE_LEN: usize = 24;

/// «Пакет оновлення»: текст для передачі й що в ньому.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SyncText {
    pub text: String,
    pub records: usize,
    pub tables: usize,
    pub changes: usize,
}

/// Підсумок приймання пакета.
#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SyncOutcome {
    pub collective: String,
    /// Нові записи журналу складу (нові учасники, імена, пристрої).
    pub new_records: usize,
    /// Нові або оновлені таблиці.
    pub tables: usize,
    pub new_changes: usize,
    /// Пакети змін, які вже були на цьому комп'ютері.
    pub known_changes: usize,
    /// Частини, що не пройшли перевірку й не збережені.
    pub rejected: usize,
}

struct TableUpsert {
    record: TableRecord,
    bytes: Vec<u8>,
}

fn sync_aad(collective_id: &CollectiveId, epoch: u32) -> Vec<u8> {
    [
        labels::SYNC_PACKAGE,
        collective_id.as_slice(),
        &epoch.to_be_bytes(),
    ]
    .concat()
}

fn purpose_code(purpose: TablePurpose) -> u8 {
    match purpose {
        TablePurpose::AfterFact => PURPOSE_AFTER_FACT,
        TablePurpose::Planned => PURPOSE_PLANNED,
    }
}

fn purpose_from_code(code: u8) -> TablePurpose {
    if code == PURPOSE_PLANNED {
        TablePurpose::Planned
    } else {
        TablePurpose::AfterFact
    }
}

fn decode_sync(text: &str) -> Result<Vec<u8>> {
    if text.len() > MAX_SYNC_BYTES / 3 * 4 + 1024 {
        return Err(CollectiveStoreError::SyncTooLarge);
    }
    let compact: String = text.split_whitespace().collect();
    let body = compact
        .strip_prefix(SYNC_PREFIX)
        .ok_or(CollectiveStoreError::InvalidText)?;
    URL_SAFE_NO_PAD
        .decode(body)
        .map_err(|_| CollectiveStoreError::InvalidText)
}

fn read_list(r: &mut Reader<'_>, limit: usize) -> Result<Vec<Vec<u8>>> {
    let invalid = |_| CollectiveStoreError::InvalidText;
    let n = r.u32().map_err(invalid)? as usize;
    if n > limit {
        return Err(CollectiveStoreError::InvalidText);
    }
    (0..n)
        .map(|_| r.var().map(<[u8]>::to_vec).map_err(invalid))
        .collect()
}

impl CollectiveStore {
    /// «Пакет оновлення»: журнал складу, записи таблиць (свої — підписуються зараз, якщо ще
    /// не підписані або змінилися) і всі збережені пакети змін колективу.
    pub async fn sync_export(
        &self,
        profile_id: &str,
        password: Zeroizing<String>,
        collective_fp: &str,
        now_unix: i64,
    ) -> Result<SyncText> {
        let (collective_id, _) = self.find_collective(profile_id, collective_fp).await?;
        let me = self.me(profile_id).await?;
        let (membership, _) = self.load_journal(profile_id, &collective_id).await?;
        if membership.bound_member(&me.member_id).is_none() {
            return Err(CollectiveStoreError::NotAMember);
        }
        let tables = self.tables(profile_id, &collective_id).await?;
        let envelopes: Vec<Vec<u8>> = sqlx::query_scalar(
            "SELECT envelope FROM collective_table_ops
             WHERE profile_id = ? AND collective_id = ? ORDER BY recorded_at, rowid",
        )
        .bind(profile_id)
        .bind(collective_id.as_slice())
        .fetch_all(&self.pool)
        .await?;
        let records: Vec<Vec<u8>> = membership.records().iter().map(|r| r.to_bytes()).collect();
        let epoch = membership.current_epoch();
        let my_id = me.member_id;
        let summary = (records.len(), tables.len(), envelopes.len());
        let (bytes, signed) = self
            .with_secrets(profile_id, password, move |unlocked, member, _| {
                let mut signed = Vec::new();
                let mut table_bytes = Vec::with_capacity(tables.len());
                for table in &tables {
                    match &table.record {
                        Some(bytes) => table_bytes.push(bytes.clone()),
                        None if table.attestation.owner == my_id => {
                            let a = &table.attestation;
                            let record = member
                                .table_record(
                                    collective_id,
                                    a.table_id,
                                    &table.title,
                                    &table.columns,
                                    a.class.code(),
                                    purpose_code(a.purpose),
                                    &[],
                                    now_unix,
                                )
                                .map_err(rejected)?;
                            let bytes = record.to_bytes();
                            signed.push((a.table_id, bytes.clone()));
                            table_bytes.push(bytes);
                        }
                        // Чужа таблиця без запису — давня, лише з цього вузла: не передається.
                        None => {}
                    }
                }
                let mut w = Writer::with_capacity(4096);
                w.fixed(&collective_id).u32(records.len() as u32);
                for record in &records {
                    w.var(record);
                }
                w.u32(table_bytes.len() as u32);
                for bytes in &table_bytes {
                    w.var(bytes);
                }
                w.u32(envelopes.len() as u32);
                for bytes in &envelopes {
                    w.var(bytes);
                }
                let plain = Zeroizing::new(w.finish());
                if plain.len() > MAX_SYNC_BYTES {
                    return Err(CollectiveStoreError::SyncTooLarge);
                }
                let key = epoch_keys(unlocked, &collective_id, epoch)?
                    .pop()
                    .ok_or(CollectiveStoreError::EpochKeyMissing)?;
                let nonce: [u8; SYNC_NONCE_LEN] = random_array();
                let aad = sync_aad(&collective_id, epoch);
                let sealed = XChaCha20Poly1305::new(&Key::from(*key.as_bytes()))
                    .encrypt(
                        &XNonce::from(nonce),
                        AeadPayload {
                            msg: &plain,
                            aad: &aad,
                        },
                    )
                    .map_err(|_| CollectiveStoreError::Rejected("не вдалося зашифрувати пакет"))?;
                let mut out = Writer::with_capacity(sealed.len() + 64);
                out.fixed(&collective_id)
                    .u32(epoch)
                    .fixed(&nonce)
                    .fixed(&sealed);
                Ok((out.finish(), signed))
            })
            .await?;
        let updated = unix_text(now_unix);
        for (table_id, record) in &signed {
            sqlx::query(
                "UPDATE collective_tables SET record = ?, updated_at = ?
                 WHERE profile_id = ? AND collective_id = ? AND table_id = ? AND record IS NULL",
            )
            .bind(record.as_slice())
            .bind(&updated)
            .bind(profile_id)
            .bind(collective_id.as_slice())
            .bind(table_id.as_slice())
            .execute(&self.pool)
            .await?;
        }
        Ok(SyncText {
            text: format!("{SYNC_PREFIX}{}", URL_SAFE_NO_PAD.encode(&bytes)),
            records: summary.0,
            tables: summary.1,
            changes: summary.2,
        })
    }

    /// Приймання пакета оновлення. Нове дописується одним SQL-записом; що не пройшло
    /// перевірку — відкидається.
    pub async fn sync_import(
        &self,
        profile_id: &str,
        password: Zeroizing<String>,
        text: &str,
        now_unix: i64,
    ) -> Result<SyncOutcome> {
        let bytes = decode_sync(text)?;
        let invalid = |_| CollectiveStoreError::InvalidText;
        let mut r = Reader::new(&bytes);
        let collective_id: CollectiveId = r.fixed().map_err(invalid)?;
        let epoch = r.u32().map_err(invalid)?;
        let nonce: [u8; SYNC_NONCE_LEN] = r.fixed().map_err(invalid)?;
        let sealed = r.rest().to_vec();
        let (found, _) = self
            .find_collective(profile_id, &fingerprint(&collective_id))
            .await?;
        if found != collective_id {
            return Err(CollectiveStoreError::CollectiveNotFound);
        }
        let me = self.me(profile_id).await?;
        let (membership, _) = self.load_journal(profile_id, &collective_id).await?;
        if membership.bound_member(&me.member_id).is_none() {
            return Err(CollectiveStoreError::NotAMember);
        }
        let before = membership.latest_seq();
        let tables = self.tables(profile_id, &collective_id).await?;
        let known: Vec<Vec<u8>> = sqlx::query_scalar(
            "SELECT envelope_id FROM collective_table_ops WHERE profile_id = ? AND collective_id = ?",
        )
        .bind(profile_id)
        .bind(collective_id.as_slice())
        .fetch_all(&self.pool)
        .await?;
        let my_id = me.member_id;
        let (membership, upserts, fresh, known_changes, rejected_parts) = self
            .with_secrets(profile_id, password, move |unlocked, _, _| {
                let mut membership = membership;
                let keys = epoch_keys(unlocked, &collective_id, membership.current_epoch())?;
                let key = keys
                    .get(epoch as usize)
                    .ok_or(CollectiveStoreError::EpochKeyMissing)?;
                let plain = Zeroizing::new(
                    XChaCha20Poly1305::new(&Key::from(*key.as_bytes()))
                        .decrypt(
                            &XNonce::from(nonce),
                            AeadPayload {
                                msg: &sealed,
                                aad: &sync_aad(&collective_id, epoch),
                            },
                        )
                        .map_err(|_| CollectiveStoreError::InvalidText)?,
                );
                let mut r = Reader::new(&plain);
                let inner: CollectiveId = r.fixed().map_err(invalid)?;
                if inner != collective_id {
                    return Err(CollectiveStoreError::InvalidText);
                }
                let records = read_list(&mut r, 1 << 20)?;
                let table_list = read_list(&mut r, 4096)?;
                let envelope_list = read_list(&mut r, 1 << 20)?;
                r.finish().map_err(invalid)?;

                // Журнал складу: увесь префікс з першого запису; розбіжність — відмова цілком.
                for (i, bytes) in records.iter().enumerate() {
                    let record = MembershipRecord::from_bytes(bytes).map_err(rejected)?;
                    membership
                        .apply(i as u64 + 1, record)
                        .map_err(|reason| match reason {
                            crate::collective::Reason::IntegrityViolation => {
                                CollectiveStoreError::JournalDiverged
                            }
                            other => rejected(other),
                        })?;
                }

                let mut rejected_parts = 0usize;
                // Права й стовпці: відомі таблиці плюс прийняті записи.
                let mut rights: Vec<([u8; ID_LEN], MemberId, Vec<MemberId>)> =
                    tables.iter().map(|t| t.rights()[0].clone()).collect();
                let mut columns: Vec<([u8; ID_LEN], Vec<String>)> = tables
                    .iter()
                    .map(|t| (t.attestation.table_id, t.columns.clone()))
                    .collect();
                let mut upserts: Vec<TableUpsert> = Vec::new();
                for bytes in &table_list {
                    let Ok(record) = TableRecord::from_bytes(bytes) else {
                        rejected_parts += 1;
                        continue;
                    };
                    let verified = membership
                        .bound_member(&record.owner)
                        .map(|owner| record.verify(owner.public(), &collective_id));
                    if verified != Some(Ok(())) {
                        rejected_parts += 1;
                        continue;
                    }
                    let existing = tables
                        .iter()
                        .find(|t| t.attestation.table_id == record.table_id);
                    if let Some(table) = existing {
                        if table.attestation.owner != record.owner {
                            rejected_parts += 1;
                            continue;
                        }
                        // Свою таблицю вузол власника знає сам; старіший запис не замінює новіший.
                        let stored_at = table
                            .record
                            .as_deref()
                            .and_then(|b| TableRecord::from_bytes(b).ok())
                            .map(|known| known.issued_at);
                        if table.attestation.owner == my_id
                            || stored_at.is_some_and(|at| at >= record.issued_at)
                        {
                            continue;
                        }
                    }
                    rights.retain(|(id, _, _)| id != &record.table_id);
                    rights.push((record.table_id, record.owner, record.writers.clone()));
                    columns.retain(|(id, _)| id != &record.table_id);
                    columns.push((record.table_id, record.columns.clone()));
                    upserts.push(TableUpsert {
                        record,
                        bytes: bytes.clone(),
                    });
                }

                let known: HashSet<Vec<u8>> = known.into_iter().collect();
                let view = TableRights {
                    membership: &membership,
                    tables: &rights,
                };
                let mut journals = Journals::new();
                let mut fresh: Vec<([u8; ID_LEN], [u8; ID_LEN], Vec<u8>)> = Vec::new();
                let mut known_changes = 0usize;
                for bytes in &envelope_list {
                    let Ok(envelope) = Envelope::from_bytes(bytes) else {
                        rejected_parts += 1;
                        continue;
                    };
                    if envelope.header.collective_id != collective_id {
                        rejected_parts += 1;
                        continue;
                    }
                    if known.contains(envelope.header.envelope_id.as_slice()) {
                        known_changes += 1;
                        continue;
                    }
                    let decision = replay::receive(
                        &mut journals,
                        &view,
                        RevokedPolicy::Reject,
                        |epoch| {
                            keys.get(epoch as usize)
                                .map(|key| EpochKey::from_bytes(*key.as_bytes()))
                        },
                        bytes,
                    );
                    let Decision::Apply(signed) = decision else {
                        if !matches!(
                            decision,
                            Decision::SkipDuplicateEnvelope | Decision::Idempotent
                        ) {
                            rejected_parts += 1;
                        }
                        continue;
                    };
                    let table_id = signed.payload.table_id;
                    let valid = columns
                        .iter()
                        .find(|(id, _)| id == &table_id)
                        .is_some_and(|(_, cols)| parse_change(&signed.payload.op, cols).is_ok());
                    if !valid {
                        rejected_parts += 1;
                        continue;
                    }
                    fresh.push((envelope.header.envelope_id, table_id, bytes.clone()));
                }
                Ok((membership, upserts, fresh, known_changes, rejected_parts))
            })
            .await?;

        let now = unix_text(now_unix);
        let after = membership.latest_seq();
        let mut tx = self.pool.begin().await?;
        if after > before {
            append_records(
                &mut tx,
                profile_id,
                &collective_id,
                &membership,
                before + 1,
                after,
                &now,
            )
            .await?;
        }
        for upsert in &upserts {
            let record = &upsert.record;
            let class =
                TableClass::from_code(record.class).ok_or(CollectiveStoreError::InvalidChoice)?;
            sqlx::query(
                "INSERT INTO collective_tables (profile_id, collective_id, table_id, title, owner,
                     class, class_confirmed_by, purpose, purpose_confirmed_by, updated_at, columns,
                     record)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                 ON CONFLICT (profile_id, collective_id, table_id) DO UPDATE SET
                     title = excluded.title, class = excluded.class,
                     class_confirmed_by = excluded.class_confirmed_by, purpose = excluded.purpose,
                     purpose_confirmed_by = excluded.purpose_confirmed_by,
                     updated_at = excluded.updated_at, columns = excluded.columns,
                     record = excluded.record",
            )
            .bind(profile_id)
            .bind(collective_id.as_slice())
            .bind(record.table_id.as_slice())
            .bind(&record.title)
            .bind(record.owner.as_slice())
            .bind(class_text(class))
            .bind(record.owner.as_slice())
            .bind(purpose_text(purpose_from_code(record.purpose)))
            .bind(record.owner.as_slice())
            .bind(&now)
            .bind(columns_json(&record.columns))
            .bind(upsert.bytes.as_slice())
            .execute(&mut *tx)
            .await?;
        }
        for (envelope_id, table_id, bytes) in &fresh {
            sqlx::query(
                "INSERT OR IGNORE INTO collective_table_ops
                     (profile_id, collective_id, table_id, envelope_id, envelope, recorded_at)
                 VALUES (?, ?, ?, ?, ?, ?)",
            )
            .bind(profile_id)
            .bind(collective_id.as_slice())
            .bind(table_id.as_slice())
            .bind(envelope_id.as_slice())
            .bind(bytes.as_slice())
            .bind(&now)
            .execute(&mut *tx)
            .await?;
        }
        tx.commit().await?;
        Ok(SyncOutcome {
            collective: fingerprint(&collective_id),
            new_records: (after - before) as usize,
            tables: upserts.len(),
            new_changes: fresh.len(),
            known_changes,
            rejected: rejected_parts,
        })
    }
}
