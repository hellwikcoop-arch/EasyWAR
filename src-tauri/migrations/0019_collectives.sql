PRAGMA foreign_keys = ON;

-- Колективи на вузлі (E8, етап C3b, перший зріз): ключ учасника профілю, колективи, створені
-- цим профілем, і застосований префікс підписаного журналу складу кожного колективу.
--
-- Тут лише відкриті частини: ключі підпису й обміну учасника, ключ пристрою, ідентифікатори й
-- підписані записи журналу. Секрети (seed підпису, секрет X25519, ключ пристрою) зберігаються
-- окремо — у сховищі секретів профілю під паролем (Argon2id, `collective::secret_store`) і в
-- базу не потрапляють. Мережі на цьому етапі немає: жоден рядок не передається назовні.
-- Видалення профілю видаляє і його колективи (ON DELETE CASCADE).
CREATE TABLE collective_identities (
    profile_id TEXT PRIMARY KEY,
    member_id BLOB NOT NULL CHECK (length(member_id) = 32),
    sign_pub BLOB NOT NULL CHECK (length(sign_pub) = 32),
    exchange_pub BLOB NOT NULL CHECK (length(exchange_pub) = 32),
    device_pub BLOB NOT NULL CHECK (length(device_pub) = 32),
    created_at TEXT NOT NULL,
    FOREIGN KEY (profile_id) REFERENCES local_profiles(id) ON DELETE CASCADE
);

CREATE TABLE collectives (
    profile_id TEXT NOT NULL,
    collective_id BLOB NOT NULL CHECK (length(collective_id) = 16),
    name TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND 80),
    created_at TEXT NOT NULL,
    PRIMARY KEY (profile_id, collective_id),
    FOREIGN KEY (profile_id) REFERENCES local_profiles(id) ON DELETE CASCADE
);

-- Записи журналу складу в канонічному кодуванні `MembershipRecord` (підписи всередині).
-- Зберігається лише суцільний застосований префікс: seq 1..N без розривів; при читанні
-- журнал заново перевіряється й застосовується, тож підмінений рядок не дає прав.
CREATE TABLE collective_membership_log (
    profile_id TEXT NOT NULL,
    collective_id BLOB NOT NULL,
    seq INTEGER NOT NULL CHECK (seq >= 1),
    record BLOB NOT NULL CHECK (length(record) BETWEEN 1 AND 4096),
    recorded_at TEXT NOT NULL,
    PRIMARY KEY (profile_id, collective_id, seq),
    FOREIGN KEY (profile_id, collective_id)
        REFERENCES collectives(profile_id, collective_id) ON DELETE CASCADE
);
