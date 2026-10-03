PRAGMA foreign_keys = ON;

-- Таблиця «НАШІ ВТРАТИ» (журнал власних втрат) має власну прив'язку до кожної
-- плитки командування: `pvk_losses` для дашборда ПВК і `dshv_losses` для
-- дашборда УДШВ. Це окремі слоти поряд з основними таблицями `pvk` і `dshv`.
-- SQLite не вміє змінити CHECK на місці, тому таблицю перебудовано з ширшим
-- переліком `branch`; наявні прив'язки переносяться без змін.
CREATE TABLE local_profile_tables_new (
    profile_id TEXT NOT NULL,
    branch TEXT NOT NULL CHECK (branch IN ('air', 'rocket', 'pvk', 'dshv', 'pvk_losses', 'dshv_losses')),
    path TEXT NOT NULL CHECK (length(path) BETWEEN 1 AND 4096),
    updated_at TEXT NOT NULL,
    PRIMARY KEY (profile_id, branch),
    FOREIGN KEY (profile_id) REFERENCES local_profiles(id) ON DELETE CASCADE
);

INSERT INTO local_profile_tables_new (profile_id, branch, path, updated_at)
SELECT profile_id, branch, path, updated_at FROM local_profile_tables;

DROP TABLE local_profile_tables;
ALTER TABLE local_profile_tables_new RENAME TO local_profile_tables;
