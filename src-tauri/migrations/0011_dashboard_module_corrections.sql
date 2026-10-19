PRAGMA foreign_keys = ON;

-- Виправлення значень, внесені на екрані «Перевірка» перед підтягуванням даних із
-- таблиці користувача у новий модуль дашборда. Сире значення клітинки (`raw_text`)
-- і текст, який увів користувач (`corrected_text`), зберігаються тут окремо від
-- запису: сам запис лежить у `dashboard_data_<id>` уже з виправленим значенням, а
-- в динамічні колонки цієї таблиці виправлення не потрапляють. Файл таблиці
-- користувача не змінюється, шлях до нього не зберігається — лише назва файла,
-- аркуш, номер рядка й заголовок колонки, щоб виправлення можна було звірити.
CREATE TABLE dashboard_module_corrections (
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
    UNIQUE (module_id, row_id, field_key),
    FOREIGN KEY (module_id) REFERENCES dashboard_modules(id) ON DELETE CASCADE
);

CREATE INDEX idx_dashboard_module_corrections_module
    ON dashboard_module_corrections(module_id, row_id);
