PRAGMA foreign_keys = ON;

CREATE TABLE xlsx_row_fingerprints (
    report_id TEXT PRIMARY KEY NOT NULL,
    fingerprint_sha256 TEXT NOT NULL CHECK (
        length(fingerprint_sha256) = 64
        AND fingerprint_sha256 NOT GLOB '*[^0-9a-f]*'
    ),
    duplicate_of_report_id TEXT,
    recorded_at TEXT NOT NULL,
    FOREIGN KEY (report_id) REFERENCES reports(id),
    FOREIGN KEY (duplicate_of_report_id) REFERENCES reports(id),
    CHECK (
        duplicate_of_report_id IS NULL
        OR duplicate_of_report_id <> report_id
    )
);

CREATE INDEX idx_xlsx_row_fingerprints_hash
ON xlsx_row_fingerprints(fingerprint_sha256, report_id);

CREATE INDEX idx_xlsx_row_fingerprints_duplicate
ON xlsx_row_fingerprints(duplicate_of_report_id)
WHERE duplicate_of_report_id IS NOT NULL;

CREATE TRIGGER xlsx_row_fingerprints_no_update
BEFORE UPDATE ON xlsx_row_fingerprints
BEGIN
    SELECT RAISE(ABORT, 'xlsx_row_fingerprints are immutable');
END;

CREATE TRIGGER xlsx_row_fingerprints_no_delete
BEFORE DELETE ON xlsx_row_fingerprints
BEGIN
    SELECT RAISE(ABORT, 'xlsx_row_fingerprints are immutable');
END;
