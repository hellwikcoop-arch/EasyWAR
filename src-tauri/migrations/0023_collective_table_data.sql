PRAGMA foreign_keys = ON;

-- Дані таблиць колективу (E8, зріз «Змінити дані / Оновити таблицю» без мережі).
--
-- `columns` — назви стовпців таблиці колективу (JSON-масив рядків), їх задає власник.
-- Рядків тут немає: кожна зміна даних — підписаний пристроєм і запечатаний ключем епохи
-- конверт у `collective_table_ops`. Відкритий текст змін у базі не лежить; стан таблиці
-- Rust відновлює, відкриваючи конверти паролем учасника й перевіряючи журнал складу.
ALTER TABLE collective_tables
    ADD COLUMN columns TEXT NOT NULL DEFAULT '[]'
        CHECK (json_valid(columns) AND json_type(columns) = 'array');

-- Підписаний власником запис таблиці (`collective::table_record`): назва, стовпці, клас,
-- призначення і хто може писати. У своїх таблицях з'являється під час «Пакета оновлення»,
-- у чужих — з пакета; з ним таблицю бачать і перевіряють інші учасники.
ALTER TABLE collective_tables
    ADD COLUMN record BLOB CHECK (record IS NULL OR length(record) BETWEEN 1 AND 65536);

CREATE TABLE collective_table_ops (
    profile_id TEXT NOT NULL,
    collective_id BLOB NOT NULL,
    table_id BLOB NOT NULL CHECK (length(table_id) = 16),
    envelope_id BLOB NOT NULL CHECK (length(envelope_id) = 16),
    envelope BLOB NOT NULL CHECK (length(envelope) BETWEEN 1 AND 1048576),
    recorded_at TEXT NOT NULL,
    PRIMARY KEY (profile_id, collective_id, envelope_id),
    FOREIGN KEY (profile_id, collective_id, table_id)
        REFERENCES collective_tables(profile_id, collective_id, table_id) ON DELETE CASCADE
);

CREATE INDEX collective_table_ops_by_table
    ON collective_table_ops(profile_id, collective_id, table_id, recorded_at);
