PRAGMA foreign_keys = ON;

-- Модулі, які користувач обрав під час реєстрації профілю: роди військ (ПС, РВ,
-- Артилерія) і дашборди командувань (ПВК, УДШВ). Лише видимість карток на
-- стартовому екрані цього профілю; доступ до даних визначає пароль і прив'язані таблиці.
CREATE TABLE local_profile_modules (
    profile_id TEXT NOT NULL,
    module TEXT NOT NULL CHECK (module IN ('air', 'rocket', 'artillery', 'pvk', 'dshv')),
    PRIMARY KEY (profile_id, module),
    FOREIGN KEY (profile_id) REFERENCES local_profiles(id) ON DELETE CASCADE
);

-- Профілі, створені до цієї версії, бачили всі модулі: лишаємо їм усі п'ять.
INSERT INTO local_profile_modules (profile_id, module)
SELECT p.id, m.module
FROM local_profiles p
CROSS JOIN (
    SELECT 'air' AS module
    UNION ALL SELECT 'rocket'
    UNION ALL SELECT 'artillery'
    UNION ALL SELECT 'pvk'
    UNION ALL SELECT 'dshv'
) m;
