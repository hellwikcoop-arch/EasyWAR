-- E3-П / ПРОЄКТ, НЕ ВИКОНУВАТИ В РОБОЧІЙ БАЗІ.
-- Кандидат на src-tauri/migrations/0017_data_source_profile_schema.sql.
-- На перевіреному origin/main 3f0809b остання міграція 0016; номер повторно
-- звірити безпосередньо перед реалізацією. SQL нижче не додано до Migrator.
-- Лише нові таблиці/індекси/тригери; жодного ALTER/DROP на чинних об'єктах.
PRAGMA foreign_keys = ON;

CREATE TABLE e3_data_sources (
    id TEXT PRIMARY KEY NOT NULL CHECK (
        length(id) = 35 AND substr(id, 1, 3) = 'ds-'
        AND substr(id, 4) NOT GLOB '*[^0-9a-f]*'
    ),
    profile_id TEXT NOT NULL,
    kind TEXT NOT NULL CHECK (kind IN ('linked_xlsx', 'module_sqlite')),
    linked_branch TEXT CHECK (linked_branch IN
        ('air', 'rocket', 'pvk', 'dshv', 'pvk_losses', 'dshv_losses')),
    module_id TEXT,
    -- SHA-256 канонічного локатора; шлях лишається у local_profile_tables.
    locator_sha256 TEXT CHECK (locator_sha256 IS NULL OR
        (length(locator_sha256) = 64 AND locator_sha256 NOT GLOB '*[^0-9a-f]*')),
    state TEXT NOT NULL CHECK (state IN ('complete', 'partial', 'unavailable', 'stale')),
    current_data_version INTEGER NOT NULL DEFAULT 0 CHECK (current_data_version >= 0),
    current_schema_version INTEGER NOT NULL DEFAULT 0 CHECK (current_schema_version >= 0),
    last_error_code TEXT CHECK (last_error_code IS NULL OR length(last_error_code) <= 64),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    UNIQUE (profile_id, id),
    CHECK ((kind = 'linked_xlsx' AND linked_branch IS NOT NULL AND module_id IS NULL)
        OR (kind = 'module_sqlite' AND linked_branch IS NULL)),
    FOREIGN KEY (profile_id) REFERENCES local_profiles(id) ON DELETE CASCADE,
    -- Видалення старого модуля не блокується: історія E3 лишається, а Rust
    -- повертає effective state = unavailable, коли module_id став NULL.
    FOREIGN KEY (module_id) REFERENCES dashboard_modules(id) ON DELETE SET NULL
);

CREATE INDEX idx_e3_sources_profile_state
    ON e3_data_sources(profile_id, state, id);
CREATE INDEX idx_e3_sources_module ON e3_data_sources(module_id)
    WHERE module_id IS NOT NULL;

CREATE TABLE e3_source_versions (
    source_id TEXT NOT NULL,
    profile_id TEXT NOT NULL,
    data_version INTEGER NOT NULL CHECK (data_version > 0),
    content_sha256 TEXT NOT NULL CHECK (
        length(content_sha256) = 64 AND content_sha256 NOT GLOB '*[^0-9a-f]*'),
    -- Історичний слот/ID і відбиток локатора, не повний шлях до XLSX.
    source_ref_key TEXT NOT NULL CHECK (length(source_ref_key) BETWEEN 1 AND 80),
    locator_sha256 TEXT NOT NULL CHECK (
        length(locator_sha256) = 64 AND locator_sha256 NOT GLOB '*[^0-9a-f]*'),
    physical_fingerprint TEXT CHECK (physical_fingerprint IS NULL OR
        (length(physical_fingerprint) = 64 AND physical_fingerprint NOT GLOB '*[^0-9a-f]*')),
    completeness TEXT NOT NULL CHECK (completeness IN ('complete', 'partial')),
    row_count INTEGER CHECK (row_count IS NULL OR row_count >= 0),
    truncated INTEGER NOT NULL CHECK (truncated IN (0, 1)),
    observed_at TEXT NOT NULL,
    PRIMARY KEY (source_id, data_version),
    CHECK ((completeness = 'partial' AND row_count IS NULL)
        OR (completeness = 'complete' AND row_count IS NOT NULL AND truncated = 0)),
    FOREIGN KEY (profile_id, source_id)
        REFERENCES e3_data_sources(profile_id, id) ON DELETE CASCADE
);

CREATE TABLE e3_profile_schema_versions (
    source_id TEXT NOT NULL,
    profile_id TEXT NOT NULL,
    schema_version INTEGER NOT NULL CHECK (schema_version > 0),
    parent_schema_version INTEGER CHECK (parent_schema_version IS NULL OR
        parent_schema_version > 0),
    based_on_data_version INTEGER NOT NULL CHECK (based_on_data_version > 0),
    physical_fingerprint TEXT NOT NULL CHECK (
        length(physical_fingerprint) = 64 AND physical_fingerprint NOT GLOB '*[^0-9a-f]*'),
    sheet_index INTEGER NOT NULL CHECK (sheet_index BETWEEN 0 AND 63),
    sheet_name TEXT NOT NULL CHECK (length(sheet_name) BETWEEN 1 AND 255),
    region_start_row INTEGER NOT NULL CHECK (region_start_row >= 1),
    region_end_row INTEGER CHECK (region_end_row IS NULL OR
        region_end_row >= region_start_row),
    header_row INTEGER NOT NULL CHECK (header_row >= region_start_row AND
        (region_end_row IS NULL OR header_row <= region_end_row)),
    header_confirmed INTEGER NOT NULL CHECK (header_confirmed IN (0, 1)),
    boundaries_confirmed INTEGER NOT NULL CHECK (boundaries_confirmed IN (0, 1)),
    -- Лише рішення split/join та координати; не зберігати рядки/значення XLSX.
    boundary_decisions_json TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(boundary_decisions_json)),
    registry_version INTEGER NOT NULL CHECK (registry_version > 0),
    created_at TEXT NOT NULL,
    PRIMARY KEY (source_id, schema_version),
    FOREIGN KEY (profile_id, source_id)
        REFERENCES e3_data_sources(profile_id, id) ON DELETE CASCADE,
    FOREIGN KEY (source_id, based_on_data_version)
        REFERENCES e3_source_versions(source_id, data_version) ON DELETE CASCADE,
    FOREIGN KEY (source_id, parent_schema_version)
        REFERENCES e3_profile_schema_versions(source_id, schema_version) ON DELETE CASCADE
);

CREATE INDEX idx_e3_schema_source_created
    ON e3_profile_schema_versions(source_id, schema_version DESC);

CREATE TABLE e3_schema_columns (
    source_id TEXT NOT NULL,
    schema_version INTEGER NOT NULL,
    column_id TEXT NOT NULL CHECK (length(column_id) BETWEEN 2 AND 8),
    physical_index INTEGER NOT NULL CHECK (physical_index BETWEEN 0 AND 199),
    original_header TEXT NOT NULL CHECK (length(original_header) BETWEEN 1 AND 255),
    display_label TEXT NOT NULL CHECK (length(trim(display_label)) BETWEEN 1 AND 80),
    display_position INTEGER NOT NULL CHECK (display_position BETWEEN 0 AND 199),
    observed_type TEXT NOT NULL CHECK (observed_type IN
        ('number', 'date', 'datetime', 'duration', 'text', 'boolean', 'mixed', 'unknown')),
    unit_hint TEXT CHECK (unit_hint IS NULL OR length(unit_hint) BETWEEN 1 AND 64),
    PRIMARY KEY (source_id, schema_version, column_id),
    UNIQUE (source_id, schema_version, physical_index),
    UNIQUE (source_id, schema_version, display_position),
    FOREIGN KEY (source_id, schema_version)
        REFERENCES e3_profile_schema_versions(source_id, schema_version) ON DELETE CASCADE
);

CREATE TABLE e3_column_bindings (
    source_id TEXT NOT NULL,
    schema_version INTEGER NOT NULL,
    definition_id TEXT NOT NULL CHECK (length(definition_id) BETWEEN 1 AND 128),
    field_key TEXT NOT NULL CHECK (length(field_key) BETWEEN 1 AND 64),
    column_id TEXT NOT NULL,
    role TEXT NOT NULL CHECK (length(role) BETWEEN 1 AND 64),
    data_type TEXT NOT NULL CHECK (data_type IN
        ('number', 'date', 'datetime', 'duration', 'text', 'boolean')),
    unit TEXT CHECK (unit IS NULL OR length(unit) BETWEEN 1 AND 64),
    aggregation TEXT NOT NULL CHECK (aggregation IN
        ('none', 'sum', 'average', 'count', 'minimum', 'maximum')),
    null_rule TEXT NOT NULL CHECK (null_rule IN ('skip', 'zero', 'error', 'keep_null')),
    definition_signature_sha256 TEXT NOT NULL CHECK (
        length(definition_signature_sha256) = 64
        AND definition_signature_sha256 NOT GLOB '*[^0-9a-f]*'),
    confirmation_state TEXT NOT NULL CHECK (confirmation_state IN
        ('confirmed', 'needs_reconfirmation')),
    confirmed_by_profile_id TEXT NOT NULL,
    confirmed_at TEXT NOT NULL,
    PRIMARY KEY (source_id, schema_version, definition_id, field_key),
    FOREIGN KEY (source_id, schema_version, column_id)
        REFERENCES e3_schema_columns(source_id, schema_version, column_id) ON DELETE CASCADE,
    FOREIGN KEY (confirmed_by_profile_id) REFERENCES local_profiles(id) ON DELETE CASCADE
);

CREATE INDEX idx_e3_binding_column
    ON e3_column_bindings(source_id, schema_version, column_id);

CREATE TABLE e3_schema_events (
    event_id TEXT PRIMARY KEY NOT NULL CHECK (length(event_id) BETWEEN 16 AND 64),
    source_id TEXT NOT NULL,
    schema_version INTEGER NOT NULL,
    action TEXT NOT NULL CHECK (action IN
        ('create', 'confirm_header', 'confirm_boundary', 'confirm_binding',
         'revoke_binding', 'change_label', 'change_order', 'change_source',
         'mark_reconfirmation')),
    actor_profile_id TEXT NOT NULL,
    -- Лише ID/версії/причини; не зберігати клітинки, шлях або повний workbook.
    details_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(details_json)),
    occurred_at TEXT NOT NULL,
    FOREIGN KEY (source_id, schema_version)
        REFERENCES e3_profile_schema_versions(source_id, schema_version) ON DELETE CASCADE,
    FOREIGN KEY (actor_profile_id) REFERENCES local_profiles(id) ON DELETE CASCADE
);

CREATE INDEX idx_e3_events_source_version
    ON e3_schema_events(source_id, schema_version, occurred_at, event_id);

-- Мінімальна квитанція для безпечного повтору після невідомого результату commit.
-- Не містить рядків, шляхів, клітинок чи текстів підтвердження.
CREATE TABLE e3_operation_receipts (
    profile_id TEXT NOT NULL,
    request_id TEXT NOT NULL CHECK (length(request_id) BETWEEN 16 AND 64),
    payload_sha256 TEXT NOT NULL CHECK (
        length(payload_sha256) = 64 AND payload_sha256 NOT GLOB '*[^0-9a-f]*'),
    source_id TEXT NOT NULL,
    result_data_version INTEGER NOT NULL CHECK (result_data_version >= 0),
    result_schema_version INTEGER NOT NULL CHECK (result_schema_version >= 0),
    committed_at TEXT NOT NULL,
    PRIMARY KEY (profile_id, request_id),
    FOREIGN KEY (profile_id, source_id)
        REFERENCES e3_data_sources(profile_id, id) ON DELETE CASCADE
);

CREATE INDEX idx_e3_receipts_source ON e3_operation_receipts(source_id, committed_at);

-- Дозволити лише нові знімки; cascade DELETE профілю залишається можливим.
CREATE TRIGGER e3_source_versions_no_update BEFORE UPDATE ON e3_source_versions
BEGIN SELECT RAISE(ABORT, 'E3 source versions are immutable'); END;
CREATE TRIGGER e3_profile_schema_versions_no_update BEFORE UPDATE ON e3_profile_schema_versions
BEGIN SELECT RAISE(ABORT, 'E3 schema versions are immutable'); END;
CREATE TRIGGER e3_schema_columns_no_update BEFORE UPDATE ON e3_schema_columns
BEGIN SELECT RAISE(ABORT, 'E3 schema columns are immutable'); END;
CREATE TRIGGER e3_column_bindings_no_update BEFORE UPDATE ON e3_column_bindings
BEGIN SELECT RAISE(ABORT, 'E3 bindings are immutable'); END;
CREATE TRIGGER e3_schema_events_no_update BEFORE UPDATE ON e3_schema_events
BEGIN SELECT RAISE(ABORT, 'E3 schema events are immutable'); END;
CREATE TRIGGER e3_operation_receipts_no_update BEFORE UPDATE ON e3_operation_receipts
BEGIN SELECT RAISE(ABORT, 'E3 operation receipts are immutable'); END;

-- SQLite FK module_id -> id сам по собі не гарантує спільного власника.
CREATE TRIGGER e3_sources_module_owner_insert BEFORE INSERT ON e3_data_sources
WHEN NEW.kind = 'module_sqlite' AND NEW.module_id IS NOT NULL
 AND NOT EXISTS (SELECT 1 FROM dashboard_modules
                 WHERE id = NEW.module_id AND profile_id = NEW.profile_id)
BEGIN SELECT RAISE(ABORT, 'E3 module owner mismatch'); END;
CREATE TRIGGER e3_sources_module_owner_update BEFORE UPDATE OF module_id, profile_id, kind
ON e3_data_sources
WHEN NEW.kind = 'module_sqlite' AND NEW.module_id IS NOT NULL
 AND NOT EXISTS (SELECT 1 FROM dashboard_modules
                 WHERE id = NEW.module_id AND profile_id = NEW.profile_id)
BEGIN SELECT RAISE(ABORT, 'E3 module owner mismatch'); END;

CREATE TRIGGER e3_bindings_owner_insert BEFORE INSERT ON e3_column_bindings
WHEN NOT EXISTS (SELECT 1 FROM e3_data_sources
                 WHERE id = NEW.source_id AND profile_id = NEW.confirmed_by_profile_id)
BEGIN SELECT RAISE(ABORT, 'E3 binding owner mismatch'); END;
CREATE TRIGGER e3_events_owner_insert BEFORE INSERT ON e3_schema_events
WHEN NOT EXISTS (SELECT 1 FROM e3_data_sources
                 WHERE id = NEW.source_id AND profile_id = NEW.actor_profile_id)
BEGIN SELECT RAISE(ABORT, 'E3 event owner mismatch'); END;

-- Інваріанти, які має перевірити Rust у тій самій транзакції:
-- 1) module_sqlite.module_id належить тому самому profile_id; тригер дублюється
--    перевіркою Rust, а після видалення модуля NULL означає unavailable.
-- 2) confirmed_by_profile_id/actor_profile_id = власнику source_id; тригери
--    дублюються перевіркою сесії Rust.
-- 3) current_*_version існують і послідовно зростають; 0 означає нове джерело.
-- 4) schema physical_fingerprint = fingerprint відповідного спостереження.
-- 5) role/field_key/definition_id існують у чинному E1/Rust каталозі; тип,
--    одиниця, агрегація й null_rule сумісні та явно підтверджені.
-- 6) кожен details_json має сувору типізовану схему; JSON CHECK перевіряє лише синтаксис.
