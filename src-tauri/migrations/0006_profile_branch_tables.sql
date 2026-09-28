PRAGMA foreign_keys = ON;

-- Таблиці профілю за родами військ: таблиця Повітряних Сил і таблиця
-- Ракетних військ і артилерії прив'язуються окремо, кожна відкривається у
-- своєму модулі й записується у свій файл.
CREATE TABLE local_profile_tables (
    profile_id TEXT NOT NULL,
    branch TEXT NOT NULL CHECK (branch IN ('air', 'rocket')),
    path TEXT NOT NULL CHECK (length(path) BETWEEN 1 AND 4096),
    updated_at TEXT NOT NULL,
    PRIMARY KEY (profile_id, branch),
    FOREIGN KEY (profile_id) REFERENCES local_profiles(id) ON DELETE CASCADE
);

-- Досі профіль мав одну таблицю, і вона відкривалася в модулі Повітряних Сил.
INSERT INTO local_profile_tables (profile_id, branch, path, updated_at)
SELECT profile_id, 'air', database_path, updated_at
FROM local_profile_details
WHERE database_path IS NOT NULL;

ALTER TABLE local_profile_details DROP COLUMN database_path;
