PRAGMA foreign_keys = ON;

-- «Сили спеціальних операцій» (sso): модуль стартового екрана в розробці. Поки що це лише картка
-- «У розробці», яку профіль вмикає або вимикає, як і інші модулі; таблиці профілю й модулів
-- дашборда в нього немає. Тому перелік дозволених значень розширено лише в модулях профілю (0022).
-- SQLite не вміє змінити CHECK на місці, тому таблицю перебудовано; вона листова, рядки переносяться без змін.
CREATE TABLE local_profile_modules_new (
    profile_id TEXT NOT NULL,
    module TEXT NOT NULL CHECK (module IN ('air', 'rocket', 'artillery', 'army', 'sso', 'pvk', 'dshv', 'custom')),
    PRIMARY KEY (profile_id, module),
    FOREIGN KEY (profile_id) REFERENCES local_profiles(id) ON DELETE CASCADE
);

INSERT INTO local_profile_modules_new (profile_id, module)
SELECT profile_id, module FROM local_profile_modules;

DROP TABLE local_profile_modules;
ALTER TABLE local_profile_modules_new RENAME TO local_profile_modules;

-- Модуль `sso` наявним профілям не додається: стартовий екран показує лише вибрані модулі.
