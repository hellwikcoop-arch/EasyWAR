PRAGMA foreign_keys = ON;

CREATE TABLE raw_sources (
    id TEXT PRIMARY KEY NOT NULL,
    source_type TEXT NOT NULL CHECK (
        source_type IN ('PASTE', 'XLSX', 'SIGNAL', 'IMPORT', 'OTHER')
    ),
    source_timestamp TEXT,
    captured_at TEXT NOT NULL,
    content_type TEXT NOT NULL,
    raw_text TEXT,
    raw_payload_json TEXT,
    raw_sha256 TEXT NOT NULL CHECK (
        length(raw_sha256) = 64
        AND raw_sha256 NOT GLOB '*[^0-9a-f]*'
    ),
    metadata_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(metadata_json)),
    created_at TEXT NOT NULL,
    CHECK (raw_text IS NOT NULL OR raw_payload_json IS NOT NULL),
    CHECK (raw_payload_json IS NULL OR json_valid(raw_payload_json))
);

CREATE TABLE reports (
    id TEXT PRIMARY KEY NOT NULL,
    raw_source_id TEXT NOT NULL,
    source_item_key TEXT NOT NULL,
    created_at TEXT NOT NULL,
    FOREIGN KEY (raw_source_id) REFERENCES raw_sources(id),
    UNIQUE (raw_source_id, source_item_key)
);

CREATE TABLE parsed_report_versions (
    id TEXT PRIMARY KEY NOT NULL,
    report_id TEXT NOT NULL,
    version INTEGER NOT NULL CHECK (version > 0),
    parser_name TEXT NOT NULL,
    parser_version TEXT NOT NULL,
    parsed_payload_json TEXT NOT NULL CHECK (json_valid(parsed_payload_json)),
    parsed_at TEXT NOT NULL,
    FOREIGN KEY (report_id) REFERENCES reports(id),
    UNIQUE (report_id, version),
    UNIQUE (id, report_id)
);

CREATE TABLE manual_corrections (
    id TEXT PRIMARY KEY NOT NULL,
    report_id TEXT NOT NULL,
    correction_number INTEGER NOT NULL CHECK (correction_number > 0),
    parsed_version_id TEXT NOT NULL,
    field_path TEXT NOT NULL,
    prior_value_json TEXT CHECK (
        prior_value_json IS NULL OR json_valid(prior_value_json)
    ),
    corrected_value_json TEXT NOT NULL CHECK (json_valid(corrected_value_json)),
    reason TEXT,
    created_by TEXT NOT NULL,
    created_at TEXT NOT NULL,
    supersedes_correction_id TEXT,
    FOREIGN KEY (report_id) REFERENCES reports(id),
    FOREIGN KEY (parsed_version_id, report_id)
        REFERENCES parsed_report_versions(id, report_id),
    FOREIGN KEY (supersedes_correction_id, report_id)
        REFERENCES manual_corrections(id, report_id),
    UNIQUE (report_id, correction_number),
    UNIQUE (id, report_id)
);

CREATE TABLE review_decisions (
    id TEXT PRIMARY KEY NOT NULL,
    report_id TEXT NOT NULL,
    decision_number INTEGER NOT NULL CHECK (decision_number > 0),
    parsed_version_id TEXT,
    decision TEXT NOT NULL CHECK (
        decision IN ('NEEDS_REVIEW', 'APPROVED', 'REJECTED')
    ),
    decided_by TEXT NOT NULL,
    rationale TEXT,
    decided_at TEXT NOT NULL,
    FOREIGN KEY (report_id) REFERENCES reports(id),
    FOREIGN KEY (parsed_version_id, report_id)
        REFERENCES parsed_report_versions(id, report_id),
    UNIQUE (report_id, decision_number),
    UNIQUE (id, report_id)
);

CREATE TABLE revision_history (
    id TEXT PRIMARY KEY NOT NULL,
    report_id TEXT NOT NULL,
    revision_number INTEGER NOT NULL CHECK (revision_number > 0),
    parsed_version_id TEXT NOT NULL,
    review_decision_id TEXT,
    snapshot_json TEXT NOT NULL CHECK (json_valid(snapshot_json)),
    change_summary TEXT,
    created_by TEXT NOT NULL,
    created_at TEXT NOT NULL,
    FOREIGN KEY (report_id) REFERENCES reports(id),
    FOREIGN KEY (parsed_version_id, report_id)
        REFERENCES parsed_report_versions(id, report_id),
    FOREIGN KEY (review_decision_id, report_id)
        REFERENCES review_decisions(id, report_id),
    UNIQUE (report_id, revision_number)
);

CREATE TABLE audit_log (
    id TEXT PRIMARY KEY NOT NULL,
    report_id TEXT,
    entity_type TEXT NOT NULL,
    entity_id TEXT NOT NULL,
    action TEXT NOT NULL,
    actor_type TEXT NOT NULL CHECK (actor_type IN ('SYSTEM', 'USER')),
    actor_label TEXT,
    details_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(details_json)),
    occurred_at TEXT NOT NULL,
    FOREIGN KEY (report_id) REFERENCES reports(id)
);

CREATE TABLE settings (
    key TEXT PRIMARY KEY NOT NULL,
    value_json TEXT NOT NULL CHECK (json_valid(value_json)),
    updated_at TEXT NOT NULL
);

CREATE INDEX idx_reports_raw_source ON reports(raw_source_id);
CREATE INDEX idx_parsed_versions_report ON parsed_report_versions(report_id, version);
CREATE INDEX idx_corrections_report ON manual_corrections(report_id, correction_number);
CREATE INDEX idx_review_decisions_report ON review_decisions(report_id, decision_number);
CREATE INDEX idx_revision_history_report ON revision_history(report_id, revision_number);
CREATE INDEX idx_audit_log_report_time ON audit_log(report_id, occurred_at);
CREATE INDEX idx_audit_log_entity ON audit_log(entity_type, entity_id, occurred_at);

CREATE VIEW report_current_state AS
SELECT
    reports.id AS report_id,
    CASE
        WHEN EXISTS (
            SELECT 1
            FROM review_decisions
            WHERE review_decisions.report_id = reports.id
        ) THEN (
            SELECT review_decisions.decision
            FROM review_decisions
            WHERE review_decisions.report_id = reports.id
            ORDER BY review_decisions.decision_number DESC
            LIMIT 1
        )
        WHEN EXISTS (
            SELECT 1
            FROM parsed_report_versions
            WHERE parsed_report_versions.report_id = reports.id
        ) THEN 'PARSED'
        ELSE 'NEW'
    END AS current_status
FROM reports;

CREATE TRIGGER raw_sources_no_update
BEFORE UPDATE ON raw_sources
BEGIN
    SELECT RAISE(ABORT, 'raw_sources are immutable');
END;

CREATE TRIGGER raw_sources_no_delete
BEFORE DELETE ON raw_sources
BEGIN
    SELECT RAISE(ABORT, 'raw_sources are immutable');
END;

CREATE TRIGGER reports_no_update
BEFORE UPDATE ON reports
BEGIN
    SELECT RAISE(ABORT, 'reports are immutable');
END;

CREATE TRIGGER reports_no_delete
BEFORE DELETE ON reports
BEGIN
    SELECT RAISE(ABORT, 'reports are immutable');
END;

CREATE TRIGGER parsed_versions_no_update
BEFORE UPDATE ON parsed_report_versions
BEGIN
    SELECT RAISE(ABORT, 'parsed_report_versions are immutable');
END;

CREATE TRIGGER parsed_versions_no_delete
BEFORE DELETE ON parsed_report_versions
BEGIN
    SELECT RAISE(ABORT, 'parsed_report_versions are immutable');
END;

CREATE TRIGGER corrections_no_update
BEFORE UPDATE ON manual_corrections
BEGIN
    SELECT RAISE(ABORT, 'manual_corrections are immutable');
END;

CREATE TRIGGER corrections_no_delete
BEFORE DELETE ON manual_corrections
BEGIN
    SELECT RAISE(ABORT, 'manual_corrections are immutable');
END;

CREATE TRIGGER review_decisions_no_update
BEFORE UPDATE ON review_decisions
BEGIN
    SELECT RAISE(ABORT, 'review_decisions are immutable');
END;

CREATE TRIGGER review_decisions_no_delete
BEFORE DELETE ON review_decisions
BEGIN
    SELECT RAISE(ABORT, 'review_decisions are immutable');
END;

CREATE TRIGGER revision_history_no_update
BEFORE UPDATE ON revision_history
BEGIN
    SELECT RAISE(ABORT, 'revision_history is immutable');
END;

CREATE TRIGGER revision_history_no_delete
BEFORE DELETE ON revision_history
BEGIN
    SELECT RAISE(ABORT, 'revision_history is immutable');
END;

CREATE TRIGGER audit_log_no_update
BEFORE UPDATE ON audit_log
BEGIN
    SELECT RAISE(ABORT, 'audit_log is append-only');
END;

CREATE TRIGGER audit_log_no_delete
BEFORE DELETE ON audit_log
BEGIN
    SELECT RAISE(ABORT, 'audit_log is append-only');
END;
