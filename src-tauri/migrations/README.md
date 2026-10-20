# SQLite migrations

This directory is the canonical home for versioned SQLite migration SQL.

`0001_provenance_schema.sql` establishes the first local-only schema. It keeps
raw sources, parser output, manual corrections, review decisions, revision
snapshots and audit events separate. Immutable layers are protected by SQLite
triggers, and the migration is exercised only with synthetic in-memory data.

`0002_xlsx_duplicate_links.sql` adds immutable SHA-256 fingerprints for staged
XLSX rows and an optional link to the first previously stored exact parsed
payload. It does not delete, merge, hide or approve either report.

`0003_local_profiles.sql` adds local profile identities: `local_profiles` (an
opaque `profile-<hex>` id, display name and a unique normalised `name_key`) and
the singleton `local_profile_state` that holds the active profile. Deleting the
active profile sets the selection to `NULL`; the Rust store then selects the
first remaining profile. A profile is a local label, not an account or a role.

`0004_workspace_templates.sql` adds `local_profile_workspace_templates`: an
optional assignment of one of five built-in presentation presets (`overview`,
`analysis`, `quality`, `registry`, `entry`) to a profile. The definitions live in
application code; the table stores only the key and the update time, grants no
permissions and is deleted together with its profile. A profile without a row
uses the overview preset, so the migration creates no rows.

`0005_profile_details.sql` adds optional per-profile details in a separate
table: position, a small avatar image (data URL), an Argon2id password hash and
the path of the XLSX table that opens after sign-in. The hash column is
nullable: profiles created before registration required a password have none.
The password gates sign-in on this device only; it does not encrypt the
database or the bound table.

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

`0010_dashboard_modules.sql` adds the profile- and branch-scoped registry for
custom dashboard modules and their verified field definitions. Creating a
module then creates its own `dashboard_data_<id>` table transactionally through
the Rust store. Physical column names come only from the built-in catalog; a
user-supplied title is stored as data and is never interpolated into SQL.

`0011_dashboard_module_corrections.sql` adds `dashboard_module_corrections`: the
values a user corrected on the «Перевірка» screen before rows from their own
XLSX were brought into a new dashboard module. Each row keeps the raw cell text,
the text the user typed, the reason the cell could not be used, and where the
cell was (file name only, sheet, row number, column header); the module record
itself holds the corrected value. Corrections reference the record by its
`row_id` in `dashboard_data_<id>` and never become dynamic columns of that table.
Deleting the module (or its profile) deletes them; a record removed from the
module table takes its corrections with it. The XLSX is never written.

`0012_query_indexes.sql` adds two indexes and changes no data. A partial index
on `parsed_report_versions(parsed_payload_json)` for XLSX parser version 1 serves
the duplicate-row lookup that runs for every imported XLSX row (without it, each
row read the whole table and imports slowed down quadratically). An index on
`raw_sources(source_type, captured_at)` serves the Signal inbox and the command
queue, which filter by source type and sort by capture time. The duplicate
lookup query must keep `version = 1 AND parser_name = 'easywar-xlsx'` literally
in its `WHERE`, or SQLite stops using the partial index; a test in
`database.rs` checks both query plans.

The `dashboard_data_<id>` tables of user-created dashboard modules are not
migration objects: Rust creates them at runtime from a validated catalog
template and adds columns that later appear in a template with `ALTER TABLE`,
without a migration (details in `docs/DATABASE.md`). Table and column names come
only from the catalog, never from user text, and a profile's module tables are
dropped in the same transaction that deletes the profile. The restore preflight
derives the objects it requires from the registered migrations, so these runtime
tables are allowed but not required.

New migrations must be append-only, registered in `src-tauri/src/database.rs`
(`database::migrations()`, which a test compares with the embedded migrator),
and covered by a migration test. Never put operational fixtures in this
directory. A migration that has shipped is never edited.
