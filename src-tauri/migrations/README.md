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

`0007_command_tables.sql` widens `local_profile_tables.branch` to `pvk` and
`dshv`: the dashboards of the Air Command (ПВК) and the Airborne Assault Forces
Command (УДШВ) bind their own tables, apart from the tables of the Air Force
and Rocket Forces modules. SQLite cannot change a CHECK in place, so the table
is rebuilt and existing bindings are copied unchanged. A PVK table that was
bound to `air` earlier stays there and still opens in the Air Force module.

`0008_own_losses_tables.sql` widens `local_profile_tables.branch` to
`pvk_losses` and `dshv_losses`: the «НАШІ ВТРАТИ» table (the journal of own
losses) is bound to each command tile apart from the tile's main table. The
table is rebuilt because SQLite cannot change a CHECK in place; existing
bindings are copied unchanged.

`0009_profile_modules.sql` adds `local_profile_modules`: the modules a user chose
at registration (`air`, `rocket`, `artillery`, `pvk`, `dshv`), one row per
`(profile_id, module)`. It only decides which cards the start screen shows for
that profile; data access is still decided by the password and the bound tables.
Profiles that exist before this migration keep all five modules.
