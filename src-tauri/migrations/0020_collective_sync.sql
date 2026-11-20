PRAGMA foreign_keys = ON;

-- Обмін у колективі (E8, C3b, другий зріз): таблиці колективу з класом і призначенням,
-- підтвердженими власником таблиці, і використані талони запрошень.
--
-- Клас і призначення зберігає Rust, а не JS: з цих рядків допуск відправки (`send_gate`)
-- рахує чинний клас. Непідтверджене власником або планове — клас D (лише LAN). Ключі епох
-- і секрети учасника лежать у сховищі секретів профілю, не тут. Мережі немає: черга
-- відправки — локальний файл, рядки нікуди не передаються.
CREATE TABLE collective_tables (
    profile_id TEXT NOT NULL,
    collective_id BLOB NOT NULL,
    table_id BLOB NOT NULL CHECK (length(table_id) = 16),
    title TEXT NOT NULL CHECK (length(title) BETWEEN 1 AND 80),
    owner BLOB NOT NULL CHECK (length(owner) = 32),
    class TEXT NOT NULL CHECK (class IN ('A', 'B', 'C', 'D')),
    class_confirmed_by BLOB CHECK (class_confirmed_by IS NULL OR length(class_confirmed_by) = 32),
    purpose TEXT NOT NULL CHECK (purpose IN ('after-fact', 'planned')),
    purpose_confirmed_by BLOB CHECK (purpose_confirmed_by IS NULL OR length(purpose_confirmed_by) = 32),
    updated_at TEXT NOT NULL,
    PRIMARY KEY (profile_id, collective_id, table_id),
    FOREIGN KEY (profile_id, collective_id)
        REFERENCES collectives(profile_id, collective_id) ON DELETE CASCADE
);

-- Кожен талон впускає рівно одного учасника (`collective::invite`).
CREATE TABLE collective_invitations_used (
    profile_id TEXT NOT NULL,
    collective_id BLOB NOT NULL,
    nonce BLOB NOT NULL CHECK (length(nonce) = 16),
    used_at TEXT NOT NULL,
    PRIMARY KEY (profile_id, collective_id, nonce),
    FOREIGN KEY (profile_id, collective_id)
        REFERENCES collectives(profile_id, collective_id) ON DELETE CASCADE
);
