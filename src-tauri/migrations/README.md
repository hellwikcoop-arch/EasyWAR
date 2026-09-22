# SQLite migrations

This directory is the canonical home for versioned SQLite migration SQL.

`0001_provenance_schema.sql` establishes the first local-only schema. It keeps
raw sources, parser output, manual corrections, review decisions, revision
snapshots and audit events separate. Immutable layers are protected by SQLite
triggers, and the migration is exercised only with synthetic in-memory data.

New migrations must be append-only, registered in `src/database.rs`, and
covered by a migration test. Never put operational fixtures in this directory.
