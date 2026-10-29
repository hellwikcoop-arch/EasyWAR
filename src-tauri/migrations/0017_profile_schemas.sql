PRAGMA foreign_keys = ON;

-- Схема профілю (етап E3 дорожньої карти модулів): рішення користувача про його таблиці —
-- які стовпці джерела виконують які смислові ролі, у яких одиницях, у якому порядку й під
-- якими підписами. Це окрема від шаблонів модулів схема: `dashboard_module_fields`
-- перебудовується з вбудованого каталогу при кожному читанні, тому вибір користувача
-- там жити не може.
--
-- Один рядок на профіль. Сам документ — JSON формату `easywar.profile-schema`, який
-- перевіряє і складає JS-ядро (`src/profile-schema-core.js`); Rust перевіряє лише
-- конверт: формат, версію, належність профілю, розмір і послідовність ревізій.
-- `revision` зростає з кожною зміною і працює як позначка версії: запис із застарілою
-- ревізією відхиляється, тож два вікна не затирають рішень одне одного.
-- Таблиця нічого не знає про дані модулів: сирі рядки XLSX і значення не зберігаються.
-- Видалення профілю видаляє і його схему.
CREATE TABLE profile_schemas (
    profile_id TEXT PRIMARY KEY,
    format_version INTEGER NOT NULL CHECK (format_version >= 1),
    revision INTEGER NOT NULL CHECK (revision >= 1),
    schema_json TEXT NOT NULL CHECK (length(schema_json) BETWEEN 2 AND 1048576),
    updated_at TEXT NOT NULL,
    FOREIGN KEY (profile_id) REFERENCES local_profiles(id) ON DELETE CASCADE
);
