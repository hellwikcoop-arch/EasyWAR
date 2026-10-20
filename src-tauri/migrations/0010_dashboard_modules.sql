PRAGMA foreign_keys = ON;

-- Користувацькі модулі дашборда зберігаються окремо для кожного локального
-- профілю та гілки застосунку. Самі дані кожного модуля лежать у власній
-- таблиці `dashboard_data_<id>`, яку Rust створює транзакційно лише за
-- перевіреним шаблоном із вбудованого каталогу.
CREATE TABLE dashboard_modules (
    id TEXT PRIMARY KEY CHECK (length(id) BETWEEN 16 AND 64),
    profile_id TEXT NOT NULL,
    branch TEXT NOT NULL CHECK (branch IN ('air', 'rocket', 'pvk', 'dshv')),
    template_id TEXT NOT NULL CHECK (length(template_id) BETWEEN 1 AND 64),
    visual_kind TEXT NOT NULL CHECK (length(visual_kind) BETWEEN 1 AND 48),
    title TEXT NOT NULL CHECK (length(title) BETWEEN 1 AND 80),
    storage_table TEXT NOT NULL UNIQUE CHECK (length(storage_table) BETWEEN 24 AND 64),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    FOREIGN KEY (profile_id) REFERENCES local_profiles(id) ON DELETE CASCADE
);

CREATE INDEX idx_dashboard_modules_profile_branch
    ON dashboard_modules(profile_id, branch, created_at, id);

-- Назви фізичних колонок не беруться з довільного тексту користувача: вони
-- копіюються з перевіреного каталогу. Український підпис зберігається окремо.
CREATE TABLE dashboard_module_fields (
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
    FOREIGN KEY (module_id) REFERENCES dashboard_modules(id) ON DELETE CASCADE
);
