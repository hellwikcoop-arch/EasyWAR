PRAGMA foreign_keys = ON;

-- Розкладка дашборда профілю (етап E4 дорожньої карти модулів): які картки модулів стоять на
-- «Моєму дашборді», їхні власні період і стиль та місце на сітці. Це не дані звіту: рядків
-- таблиць тут немає, картка лише посилається на джерело зі схеми профілю (`profile_schemas`).
--
-- Один рядок на пару (профіль, дашборд); поки єдиний дашборд — `my`. Документ — JSON формату
-- `easywar.dashboard-layout`, який складає й перевіряє JS-ядро (`src/module-instance-core.js`);
-- Rust перевіряє лише конверт: формат, версію, належність профілю, розмір і послідовність
-- ревізій. `revision` працює як позначка версії: запис із застарілою ревізією відхиляється,
-- тож два вікна не затирають одне одного. Видалення профілю видаляє і його розкладки.
CREATE TABLE dashboard_layouts (
    profile_id TEXT NOT NULL,
    dashboard_id TEXT NOT NULL CHECK (length(dashboard_id) BETWEEN 1 AND 40),
    format_version INTEGER NOT NULL CHECK (format_version >= 1),
    revision INTEGER NOT NULL CHECK (revision >= 1),
    layout_json TEXT NOT NULL CHECK (length(layout_json) BETWEEN 2 AND 1048576),
    updated_at TEXT NOT NULL,
    PRIMARY KEY (profile_id, dashboard_id),
    FOREIGN KEY (profile_id) REFERENCES local_profiles(id) ON DELETE CASCADE
);
