PRAGMA foreign_keys = ON;

-- C3a: місце для підтверджених даних колективу та непрозорих зашифрованих конвертів.
-- ЖОДНИХ назв, позначень учасників, таблиць, ключів рядків, значень і ключів доступу
-- відкритим текстом. Локальний .ewcoll із «Робочого середовища» не є джерелом членства.
-- Ця міграція НЕ дає прав на читання/запис і НЕ вмикає Tauri IPC, криптографію чи мережу.
-- Лише майбутній Rust C3b може вставляти дані після перевірки підписів, прав та епох.

CREATE TABLE collective_local_instances (
    profile_id TEXT NOT NULL,
    collective_id BLOB NOT NULL CHECK (typeof(collective_id) = 'blob' AND length(collective_id) = 16),
    member_id BLOB CHECK (member_id IS NULL OR (typeof(member_id) = 'blob' AND length(member_id) = 32)),
    created_at TEXT NOT NULL,
    PRIMARY KEY (profile_id, collective_id),
    FOREIGN KEY (profile_id) REFERENCES local_profiles(id) ON DELETE RESTRICT
) WITHOUT ROWID;

-- Збережений підписаний журнал складу: події зберігаються в зашифрованому вигляді.
-- Порядок seq незмінний і послідовний (A3); криптографічне доведення префікса — в C3b.
CREATE TABLE collective_membership_events (
    profile_id TEXT NOT NULL,
    collective_id BLOB NOT NULL CHECK (typeof(collective_id) = 'blob' AND length(collective_id) = 16),
    event_seq INTEGER NOT NULL CHECK (event_seq >= 1),
    event_id BLOB NOT NULL CHECK (typeof(event_id) = 'blob' AND length(event_id) = 16),
    event_cipher BLOB NOT NULL CHECK (typeof(event_cipher) = 'blob' AND length(event_cipher) BETWEEN 40 AND 2097152),
    stored_at TEXT NOT NULL,
    PRIMARY KEY (profile_id, collective_id, event_seq),
    UNIQUE (profile_id, collective_id, event_id),
    FOREIGN KEY (profile_id, collective_id)
        REFERENCES collective_local_instances(profile_id, collective_id) ON DELETE RESTRICT
) WITHOUT ROWID;

CREATE TRIGGER collective_membership_append_only
BEFORE INSERT ON collective_membership_events
BEGIN
    SELECT CASE WHEN NEW.event_seq <> 1 + COALESCE(
        (SELECT MAX(event_seq) FROM collective_membership_events
         WHERE profile_id = NEW.profile_id AND collective_id = NEW.collective_id), 0
    ) THEN RAISE(ABORT, 'membership sequence must be contiguous') END;
END;
CREATE TRIGGER collective_membership_no_update
BEFORE UPDATE ON collective_membership_events
BEGIN SELECT RAISE(ABORT, 'membership events are immutable'); END;
CREATE TRIGGER collective_membership_no_delete
BEFORE DELETE ON collective_membership_events
BEGIN SELECT RAISE(ABORT, 'membership events are immutable'); END;

-- Схема зберігається лише як зашифрований документ, включно з назвами стовпців.
CREATE TABLE collective_shared_tables (
    profile_id TEXT NOT NULL,
    collective_id BLOB NOT NULL CHECK (typeof(collective_id) = 'blob' AND length(collective_id) = 16),
    table_id BLOB NOT NULL CHECK (typeof(table_id) = 'blob' AND length(table_id) = 16),
    schema_version INTEGER NOT NULL CHECK (schema_version >= 1),
    schema_cipher BLOB NOT NULL CHECK (typeof(schema_cipher) = 'blob' AND length(schema_cipher) BETWEEN 40 AND 1048576),
    updated_at TEXT NOT NULL,
    PRIMARY KEY (profile_id, collective_id, table_id),
    FOREIGN KEY (profile_id, collective_id)
        REFERENCES collective_local_instances(profile_id, collective_id) ON DELETE RESTRICT
) WITHOUT ROWID;

-- Операція — лише конверт C2, не JSON із рядком. У відкритих полях немає
-- author_member_id, table_id, row_key, класу або тексту доповіді (К4).
CREATE TABLE collective_envelopes (
    profile_id TEXT NOT NULL,
    collective_id BLOB NOT NULL CHECK (typeof(collective_id) = 'blob' AND length(collective_id) = 16),
    envelope_id BLOB NOT NULL CHECK (typeof(envelope_id) = 'blob' AND length(envelope_id) = 16),
    direction TEXT NOT NULL CHECK (direction IN ('inbound', 'outbound')),
    epoch INTEGER NOT NULL CHECK (epoch BETWEEN 0 AND 4294967295),
    envelope_cipher BLOB NOT NULL CHECK (typeof(envelope_cipher) = 'blob' AND length(envelope_cipher) BETWEEN 64 AND 2097152),
    stored_at TEXT NOT NULL,
    PRIMARY KEY (profile_id, collective_id, envelope_id),
    FOREIGN KEY (profile_id, collective_id)
        REFERENCES collective_local_instances(profile_id, collective_id) ON DELETE RESTRICT
) WITHOUT ROWID;
CREATE INDEX idx_collective_envelopes_direction ON collective_envelopes(profile_id, collective_id, direction, stored_at);

-- Статуси доставки відокремлені від незмінних байтів конверта.
-- Значення статусів — не криптографічний доказ; C3b завжди перевіряє конверт заново.
CREATE TABLE collective_envelope_receipts (
    profile_id TEXT NOT NULL,
    collective_id BLOB NOT NULL,
    envelope_id BLOB NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('pending', 'verified', 'applied', 'rejected', 'sent')),
    changed_at TEXT NOT NULL,
    PRIMARY KEY (profile_id, collective_id, envelope_id),
    FOREIGN KEY (profile_id, collective_id, envelope_id)
        REFERENCES collective_envelopes(profile_id, collective_id, envelope_id) ON DELETE RESTRICT
) WITHOUT ROWID;

-- Ключ рядка — HMAC-ідентифікатор, вміст і tombstone шифруються; це кеш,
-- не джерело прав чи членства.
CREATE TABLE collective_row_cache (
    profile_id TEXT NOT NULL,
    collective_id BLOB NOT NULL,
    table_id BLOB NOT NULL,
    row_key_hmac BLOB NOT NULL CHECK (typeof(row_key_hmac) = 'blob' AND length(row_key_hmac) = 32),
    row_version INTEGER NOT NULL CHECK (row_version >= 1),
    row_cipher BLOB NOT NULL CHECK (typeof(row_cipher) = 'blob' AND length(row_cipher) BETWEEN 40 AND 2097152),
    updated_at TEXT NOT NULL,
    PRIMARY KEY (profile_id, collective_id, table_id, row_key_hmac),
    FOREIGN KEY (profile_id, collective_id, table_id)
        REFERENCES collective_shared_tables(profile_id, collective_id, table_id) ON DELETE RESTRICT
) WITHOUT ROWID;

-- Лише курсор звірки, без адрес LAN, вмісту таблиць чи заголовків операцій.
CREATE TABLE collective_sync_cursors (
    profile_id TEXT NOT NULL,
    collective_id BLOB NOT NULL,
    peer_id BLOB NOT NULL CHECK (typeof(peer_id) = 'blob' AND length(peer_id) = 32),
    received_through_seq INTEGER NOT NULL DEFAULT 0 CHECK (received_through_seq >= 0),
    last_checked_at TEXT,
    PRIMARY KEY (profile_id, collective_id, peer_id),
    FOREIGN KEY (profile_id, collective_id)
        REFERENCES collective_local_instances(profile_id, collective_id) ON DELETE RESTRICT
) WITHOUT ROWID;
