PRAGMA foreign_keys = ON;

-- Ключ відновлення пароля локального профілю. Зберігається лише необоротний хеш
-- (Argon2id) випадкового ключа; сам ключ показується один раз — при реєстрації чи
-- створенні нового ключа — і ніде не лишається. Один ключ на профіль: новий ключ
-- замінює попередній. Профілі, створені до цієї міграції, ключа не мають, доки
-- користувач не створить його в налаштуваннях профілю.
CREATE TABLE local_profile_recovery (
    profile_id TEXT PRIMARY KEY NOT NULL,
    key_hash TEXT NOT NULL CHECK (key_hash GLOB '$argon2id$*'),
    created_at TEXT NOT NULL,
    FOREIGN KEY (profile_id) REFERENCES local_profiles(id) ON DELETE CASCADE
);
