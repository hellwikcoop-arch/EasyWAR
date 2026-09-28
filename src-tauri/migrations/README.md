# SQLite migrations

This directory is the canonical home for versioned SQLite migration SQL.

`0001_provenance_schema.sql` establishes the first local-only schema. It keeps
raw sources, parser output, manual corrections, review decisions, revision
snapshots and audit events separate. Immutable layers are protected by SQLite
triggers, and the migration is exercised only with synthetic in-memory data.

`0002_xlsx_duplicate_links.sql` adds immutable SHA-256 fingerprints for staged
XLSX rows and an optional link to the first previously stored exact parsed
payload. It does not delete, merge, hide or approve either report.

New migrations must be append-only, registered in `src/database.rs`, and
covered by a migration test. Never put operational fixtures in this directory.

`0005_profile_details.sql` adds optional per-profile details in a separate
table: position, a small avatar image (data URL), an Argon2id password hash and
the path of the XLSX table that opens after sign-in. The password gates sign-in
on this device only; it does not encrypt the database or the bound table.

`0006_profile_branch_tables.sql` lets one profile bind a separate table for each
branch module: `local_profile_tables` holds one path per `(profile_id, branch)`,
where `branch` is `air` (Повітряні Сили) or `rocket` (Ракетні війська і
артилерія). A table bound before this migration becomes the Air Force table,
because that was the only module that opened it, and the old
`local_profile_details.database_path` column is dropped. Unbinding or deleting a
profile never touches the file on disk.
