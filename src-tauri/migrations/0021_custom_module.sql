PRAGMA foreign_keys = ON;

-- «Власний модуль» (custom): модуль профілю без прив'язки до роду військ. Користувач
-- наповнює його сторінку (custom.html) модулями каталогу і «Моїм дашбордом» на свій розсуд.
-- Для цього переліки дозволених значень розширено на `custom` у двох таблицях. SQLite не
-- вміє змінити CHECK на місці, тому таблиці перебудовано; наявні рядки переносяться без змін.
-- Таблиць профілю (`local_profile_tables`) це не стосується: власний модуль таблиці XLSX не має.

-- 1. Модулі профілю (0009): листова таблиця, перебудова як у 0007/0008.
CREATE TABLE local_profile_modules_new (
    profile_id TEXT NOT NULL,
    module TEXT NOT NULL CHECK (module IN ('air', 'rocket', 'artillery', 'pvk', 'dshv', 'custom')),
    PRIMARY KEY (profile_id, module),
    FOREIGN KEY (profile_id) REFERENCES local_profiles(id) ON DELETE CASCADE
);

INSERT INTO local_profile_modules_new (profile_id, module)
SELECT profile_id, module FROM local_profile_modules;

DROP TABLE local_profile_modules;
ALTER TABLE local_profile_modules_new RENAME TO local_profile_modules;

-- Профілі, створені до цієї версії, одразу бачать картку «Власний модуль»; вимкнути її можна
-- у «Профілях», як і будь-який інший модуль.
INSERT INTO local_profile_modules (profile_id, module)
SELECT id, 'custom' FROM local_profiles;

-- 2. Модулі дашборда (0010, стовпець `style` з 0012) і їхні дочірні таблиці. Зовнішні ключі
-- увімкнено, а DROP TABLE батьківської таблиці виконує неявний DELETE з каскадом, тому спершу
-- створюються нові копії дочірніх таблиць, що посилаються на нову батьківську, і лише потім
-- старі таблиці видаляються (дочірні — першими, щоб каскаду не було з чого спрацювати).
-- Перейменування нової батьківської таблиці переписує посилання в нових дочірніх
-- (`legacy_alter_table` вимкнено). Рядки `dashboard_data_<id>` не зачіпаються.
CREATE TABLE dashboard_modules_new (
    id TEXT PRIMARY KEY CHECK (length(id) BETWEEN 16 AND 64),
    profile_id TEXT NOT NULL,
    branch TEXT NOT NULL CHECK (branch IN ('air', 'rocket', 'pvk', 'dshv', 'custom')),
    template_id TEXT NOT NULL CHECK (length(template_id) BETWEEN 1 AND 64),
    visual_kind TEXT NOT NULL CHECK (length(visual_kind) BETWEEN 1 AND 48),
    title TEXT NOT NULL CHECK (length(title) BETWEEN 1 AND 80),
    storage_table TEXT NOT NULL UNIQUE CHECK (length(storage_table) BETWEEN 24 AND 64),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    style TEXT NOT NULL DEFAULT 'standard' CHECK (style IN ('standard', 'branch', 'heightwell')),
    FOREIGN KEY (profile_id) REFERENCES local_profiles(id) ON DELETE CASCADE
);

INSERT INTO dashboard_modules_new (id, profile_id, branch, template_id, visual_kind, title, storage_table, created_at, updated_at, style)
SELECT id, profile_id, branch, template_id, visual_kind, title, storage_table, created_at, updated_at, style
FROM dashboard_modules;

CREATE TABLE dashboard_module_fields_new (
    module_id TEXT NOT NULL,
    field_key TEXT NOT NULL CHECK (length(field_key) BETWEEN 1 AND 48),
    label TEXT NOT NULL CHECK (length(label) BETWEEN 1 AND 80),
    data_type TEXT NOT NULL CHECK (data_type IN ('text', 'integer', 'real', 'date', 'datetime', 'boolean')),
    field_role TEXT NOT NULL CHECK (field_role IN ('dimension', 'metric', 'label', 'series', 'status', 'latitude', 'longitude', 'order', 'note')),
    aggregation TEXT NOT NULL CHECK (aggregation IN ('none', 'sum', 'average', 'count', 'minimum', 'maximum')),
    required INTEGER NOT NULL DEFAULT 0 CHECK (required IN (0, 1)),
    position INTEGER NOT NULL CHECK (position BETWEEN 0 AND 63),
    PRIMARY KEY (module_id, field_key),
    UNIQUE (module_id, position),
    FOREIGN KEY (module_id) REFERENCES dashboard_modules_new(id) ON DELETE CASCADE
);

INSERT INTO dashboard_module_fields_new (module_id, field_key, label, data_type, field_role, aggregation, required, position)
SELECT module_id, field_key, label, data_type, field_role, aggregation, required, position
FROM dashboard_module_fields;

CREATE TABLE dashboard_module_corrections_new (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    module_id TEXT NOT NULL,
    row_id INTEGER NOT NULL CHECK (row_id >= 1),
    field_key TEXT NOT NULL CHECK (length(field_key) BETWEEN 1 AND 48),
    source_file TEXT NOT NULL CHECK (length(source_file) <= 255),
    source_sheet TEXT NOT NULL CHECK (length(source_sheet) <= 255),
    source_row INTEGER NOT NULL CHECK (source_row >= 1),
    source_column TEXT NOT NULL CHECK (length(source_column) <= 255),
    raw_text TEXT NOT NULL CHECK (length(raw_text) <= 4096),
    corrected_text TEXT NOT NULL CHECK (length(trim(corrected_text)) BETWEEN 1 AND 4096),
    reason TEXT NOT NULL CHECK (length(reason) <= 500),
    created_at TEXT NOT NULL,
    stored_value TEXT CHECK (stored_value IS NULL OR length(stored_value) <= 8192),
    superseded_at TEXT,
    UNIQUE (module_id, row_id, field_key),
    FOREIGN KEY (module_id) REFERENCES dashboard_modules_new(id) ON DELETE CASCADE
);

INSERT INTO dashboard_module_corrections_new (id, module_id, row_id, field_key, source_file, source_sheet, source_row, source_column, raw_text, corrected_text, reason, created_at, stored_value, superseded_at)
SELECT id, module_id, row_id, field_key, source_file, source_sheet, source_row, source_column, raw_text, corrected_text, reason, created_at, stored_value, superseded_at
FROM dashboard_module_corrections;

DROP TABLE dashboard_module_corrections;
DROP TABLE dashboard_module_fields;
DROP TABLE dashboard_modules;

ALTER TABLE dashboard_modules_new RENAME TO dashboard_modules;
ALTER TABLE dashboard_module_fields_new RENAME TO dashboard_module_fields;
ALTER TABLE dashboard_module_corrections_new RENAME TO dashboard_module_corrections;

CREATE INDEX idx_dashboard_modules_profile_branch
    ON dashboard_modules(profile_id, branch, created_at, id);
CREATE INDEX idx_dashboard_module_corrections_module
    ON dashboard_module_corrections(module_id, row_id);
