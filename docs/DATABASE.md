# EasyWAR database contract

## Scope

EasyWAR uses a local SQLite database managed by the official Tauri SQL plugin.
The database file resolves inside the application-local configuration area and
must never be committed.

The Tauri configuration preloads `sqlite:easywar.db`, so registered migrations
run during application startup before the frontend requests a connection.

Migration `0001_provenance_schema.sql` creates the first provenance layer.
Migration `0002_xlsx_duplicate_links.sql` adds immutable XLSX parsed-payload
fingerprints and optional links to prior exact matches. Migration
`0003_local_profiles.sql` adds local profile identities and the singleton active
profile selection. Migration `0004_workspace_templates.sql` adds an optional
local role-template assignment for each profile. Migration
`0005_profile_details.sql` adds a profile's position, avatar and optional
sign-in password hash. Migration `0006_profile_branch_tables.sql` binds a
separate XLSX table per branch module (`air`, `rocket`) to a profile and moves
an earlier single binding to the Air Force slot. Migration
`0009_profile_modules.sql` stores the modules (`air`, `rocket`, `artillery`,
`pvk`, `dshv`) a profile chose at registration and backfills all five for
profiles that already exist. Migration `0010_dashboard_modules.sql` adds the
metadata of user-created dashboard modules (`dashboard_modules`,
`dashboard_module_fields`); the rows of each module live in a separate
`dashboard_data_<24 hex>` table that Rust creates at runtime from a built-in
catalog template, not from the migration. Migrations contain no
operational fixtures and create no external integration.

## Provenance layers

| Layer | Table | Contract |
|---|---|---|
| Raw source | `raw_sources` | Original text or JSON payload; immutable after capture. |
| Report identity | `reports` | Stable link from a source item to one report. |
| Parsed values | `parsed_report_versions` | Immutable parser output with parser name and version. |
| Manual corrections | `manual_corrections` | Append-only field corrections linked to a parser version. |
| Review state | `review_decisions` | Append-only human decisions: `NEEDS_REVIEW`, `APPROVED`, or `REJECTED`. |
| Revisions | `revision_history` | Immutable materialized snapshots with monotonically increasing report revisions. |
| Audit | `audit_log` | Append-only system/user events. |
| Settings | `settings` | Local JSON settings managed by the typed settings store. |
| XLSX duplicate provenance | `xlsx_row_fingerprints` | Immutable SHA-256 fingerprint plus an optional link to a previously stored exact parsed-payload match. |
| Local profiles | `local_profiles` | Mutable local display names with stable opaque IDs; no credentials or roles. |
| Active local profile | `local_profile_state` | Singleton local selection used by future workspace features. |
| Workspace template assignments | `local_profile_workspace_templates` | Optional local presentation preset for a profile; no authorization semantics. |
| Profile details | `local_profile_details` | Position, small avatar and optional Argon2id sign-in hash; gates sign-in on this device only. |
| Profile modules | `local_profile_modules` | Modules a profile chose at registration (`air`, `rocket`, `artillery`, `pvk`, `dshv`); only shown on the start screen, not an access boundary. Cascades on profile delete. |
| Profile tables | `local_profile_tables` | One XLSX path per profile and branch module (`air`, `rocket`); the file itself is never stored or changed by binding. |
| Dashboard modules | `dashboard_modules` | One user-created dashboard module per row: owning profile, branch (`air`, `rocket`, `pvk`, `dshv`), built-in catalog template, visual kind, title and the name of its data table. Cascades on profile delete. |
| Dashboard module fields | `dashboard_module_fields` | The checked field list copied from the catalog template: key, Ukrainian label, data type, role, aggregation, required flag and position. Cascades with the module. |
| Dashboard module data | `dashboard_data_<24 hex>` | Created at runtime, one table per module: `row_id`, `created_at` and one column per catalog field. Table and column names come only from the validated catalog, never from user text. `row_id` is `INTEGER PRIMARY KEY AUTOINCREMENT`, so the number of a deleted row is never reused; a save keeps the `row_id` and `created_at` of every row that comes back with its `rowId`. `dashboard_modules.updated_at` is the version of the whole table: a save that carries `expected_updated_at` is applied only if it still matches (compare-and-swap in the first statement of the transaction), otherwise nothing changes and the caller gets a conflict. Deleting a profile drops its module tables in the same transaction as the metadata cascade, and only names that match the generated `dashboard_data_<24 hex>` pattern are ever dropped. In the built-in `flight-hours` template the unit-bearing `REAL` columns hold plain numbers and the unit is part of the field label: durations (`airborne_hours`, `total_hours`, `engine_test_time`, `time_in_clouds`, `hood_time`) are decimal hours (`0:32` is stored as `32/60` and shown as `год:хв`), `flight_altitude`, `cloud_base_upper` and `cloud_base_lower` are metres, `cloud_cover` is an integer 0–10, `visibility` is kilometres, `fuel_consumption` is litres and `cargo_kg` is kilograms; `passengers`, `rsp_approaches` and `rsp_landings` are counts. Fuel mass is not stored: the UI derives it at 0.8 kg/L. The crew columns (`crew_ke`, `crew_lsh`, `crew_bt`, `crew_other`) are `TEXT` with surnames, `crew_other` comma-separated. Value ranges (cloud cover 0–10, non-negative visibility, fuel, cargo, passengers and RSP counts, crew of at most 8, lower cloud base not above the upper one) are checked by the form only; the backend stores what it receives so that an old out-of-range row cannot block saving the table. Template fields appended later are added to existing tables by the runtime schema synchronisation, without a migration. |

The `report_current_state` view derives `NEW`, `PARSED`, or the latest review
decision without overwriting source or parser records.

## Repository layer

`src-tauri/src/repository.rs` is the typed Rust write boundary for provenance
data. It accepts caller-generated identifiers and timestamps so future import
adapters can preserve stable identities and retry safely without inventing
hidden database state.

Each write method uses one SQLite transaction:

- `capture_report` stores the raw source, report identity and `CAPTURED` audit event;
- `store_parse` stores one immutable parser version and its `PARSED` audit event;
- `record_correction` stores one append-only correction and its audit event;
- `review_and_revise` stores a review decision, matching revision snapshot and
  one decision audit event.
- `store_signal_parse` validates and stores a bounded legacy-parser payload for
  an exact `SIGNAL` report. An identical latest payload is an idempotent retry;
  a changed payload creates the next immutable parser version only while the
  report is `NEW` or `PARSED`.
- `request_signal_review` accepts only `PARSED`, then atomically appends a
  `NEEDS_REVIEW` decision, an immutable snapshot revision and its audit event.
  Repeating the request while the same report is already `NEEDS_REVIEW` returns
  the existing decision without adding rows.
- `finalize_signal_review` accepts only `NEEDS_REVIEW`, a nonblank bounded local
  reviewer identifier and an explicit `APPROVED` or `REJECTED` decision. It
  compares a corrected snapshot with the pending review snapshot, accepts only
  bounded editable record fields, and atomically appends one correction/audit
  pair per changed field plus the final decision, corrected immutable revision
  and decision audit event. An identical retry is idempotent; final states
  cannot be changed or reopened.
- `stage_xlsx_batch` writes all new XLSX rows in one transaction as immutable
  interpreted-cell snapshots plus separate parsed versions and audit events;
  it never approves rows and rejects conflicting exact-file retries. Every row
  receives a SHA-256 fingerprint of the deterministic parsed JSON. A matching
  parsed payload already stored from XLSX creates an immutable link and a
  `DUPLICATE_DETECTED` audit event; both reports and both source snapshots stay
  intact. An exact retry reuses the existing link and adds no audit row.

If any statement fails, none of the transaction's domain or audit rows persist.
The repository exposes the derived current status as a read-only query. The
desktop exposes XLSX staging only through an explicit native file picker: it
re-reads and validates the selected workbook in memory, then writes the entire
batch transactionally. Tests use only in-memory workbooks and temporary SQLite;
they do not open or populate a real user database.

The desktop Signal parse command generates timestamps in Rust and accepts a
strict versioned JSON shape with 1–64 parsed records and a 1 MiB serialized
limit. It rejects raw `srcText` and UI-only `_own`, `_openCause`, `dup`, and
`include` fields.
The original `raw_sources` row and parser version are never changed. The review
flow cannot change record count, schema metadata, raw text, or UI-only fields;
it accepts at most 256 changed values across the editable record fields. Each
manual correction preserves prior and corrected JSON values with a field path.
Final decisions require a local reviewer identifier written to corrections,
decision, revision and audit records; this is provenance, not authentication.

## Settings store

`SettingsStore` provides local JSON settings without mixing them into report
provenance. It supports:

- reading one setting by key;
- listing settings in deterministic key order;
- inserting or replacing one JSON value atomically;
- idempotent deletion with a result that reports whether a row existed.

Callers provide the `updated_at` timestamp, and reads return it with the parsed
JSON value. Setting changes do not create report audit events: the `audit_log`
remains reserved for provenance and review actions. The desktop exposes only
the validated Signal setting, the update settings and the optional local-model
setting (`app.local_model.v1`: package folder, enabled flag and file checks,
never questions or answers) through dedicated Tauri commands, not the generic
settings store or direct SQL access.

## Local profiles

`LocalProfileStore` provides a dedicated SQLite boundary for profiles that
exist only on the current device. A profile has a generated opaque ID,
normalized display name and creation/update timestamps. Names are unique after
whitespace and Unicode lowercase normalization; the store allows at most 32
profiles.

The first profile becomes active automatically. Selecting another profile is
an explicit local action. Deleting the active profile deterministically selects
the first remaining profile, or clears the selection when none remain. Create,
rename, select and delete operations return the complete sorted state so the UI
does not merge stale client copies.

Registration is one transaction (`register_local_profile`): identity, mandatory
password (6–128 characters, stored only as an Argon2id hash in
`local_profile_details`), optional position and avatar, and at least one module
are written together, the profile becomes active and the session is unlocked. A
failed registration leaves no partial rows. The old `create_local_profile`
command is removed, so a profile without a password cannot be created;
`set_local_profile_password` only sets or changes the password and rejects an
empty new password. `set_local_profile_modules` changes the chosen modules
(requires an unlocked profile; at least one module).

Profiles are not accounts in a service, roles or permissions. The sign-in screen
gates the UI and the unlock checks of data commands on this device only; it does
not encrypt table files and is not a boundary against someone who can modify the
installed application or read the disk. A forgotten password cannot be
recovered. Profiles contain no plaintext secrets and are not transmitted to a
service. Profile changes
do not rewrite immutable raw sources, parsed values, corrections, approved
revisions, reviewer labels or audit events. Role binding and workspace
templates are stored separately from profile identity.

## Role-based workspace templates

`WorkspaceTemplateStore` binds an existing local profile to one of five
built-in presentation presets: operational overview, analysis, data quality,
registry work or report entry. The definitions live in application code; the
database stores only the selected template key and update timestamp. A profile
without an explicit assignment uses the overview template, so migration does
not create rows or silently rewrite existing profiles.

The active profile's template selects only the initial top-level section and,
for dashboard templates, the initial dashboard focus. It does not hide data,
grant permissions, authenticate a person, alter a reviewer identity or limit
what the user can open afterward. Assignment replacement and cascade deletion
are transactional and create no report audit events.

The profile dialog can explicitly generate a separate empty SQLite database for
the selected position template. The new file is initialized by the embedded
SQLx migrator from the same authoritative files in `src-tauri/migrations` that
the main application registers with the Tauri SQL plugin; there is no separate
schema dump or copied set of `CREATE TABLE` statements. It receives the complete
current migration history, one active generic workstation profile and exactly
one workspace-template assignment. It contains no raw sources, parsed values,
corrections, decisions, approved revisions, settings or audit events, and it
never reads or copies records from the live database. The destination is chosen
by the user, an existing file is never overwritten, and the completed file must
pass the same integrity, foreign-key, schema-object and migration-checksum
inspection as a local backup before publication. Creating a template does not
switch the running application to that file and is not a restore operation.

## Local backup

The desktop's `create_local_backup` command uses a native save dialog so the
user explicitly chooses a destination. `VACUUM INTO` creates a consistent
SQLite snapshot in a temporary file beside that destination. The command opens
the snapshot read-only, requires `PRAGMA integrity_check` to return `ok`, and
publishes it without replacing an existing file. Failure removes the temporary
file. It does not modify the live database, contact a network service, encrypt
the copy, or restore from one. Tests use only temporary synthetic databases.

The read-only restore preflight checks SQLite integrity and foreign keys, then
matches applied `_sqlx_migrations` versions and SHA-384 checksums to the
registered EasyWAR migrations. It also requires the core tables and current
state view. A missing, altered, newer, or unrelated database is rejected.
Preflight also rejects SQLite files with companion WAL, SHM, or rollback-journal
files. The in-app restore flow copies a validated file to a temporary file next
to the live database, validates the copy again, and exposes separate cancel and
confirm actions. Selection and staging never replace the running database.

EasyWAR acquires an exclusive cross-process lock before Tauri or any SQLite pool
starts. After explicit confirmation it writes a small local restore-request
marker and asks Tauri for a controlled restart. On the next process start, while
the lock is held and before the SQL plugin opens the database, the app validates
the staged copy again, moves the current database to
`easywar.db.restore-previous`, and atomically renames the staged copy into place.
The request marker is never inferred from the presence of a staged file, so an
unconfirmed candidate cannot be applied automatically. WAL/SHM/journal
sidecars still block the swap.

A process that quits or crashes during a write leaves an `easywar.db-journal`
(or `-wal`/`-shm`) file next to the live database. Right after taking the
instance lock, and before any other startup check, EasyWAR opens the live
database once so SQLite performs its own crash recovery:
- a hot journal is rolled back;
- committed WAL frames are checkpointed;
- a journal that was never synced is replaced by a no-op write.

Startup continues only when no sidecar remains. Sidecars without a live
database are never applied to a new file and stop the start.

If the process was interrupted between the two renames, startup restores the
previous database, leaves the candidate staged, clears the one-shot request and
reports the rollback in the backup dialog. After a successful restart, the
previous database remains available and blocks another restore until the user
explicitly chooses **Видалити попередню базу**. That final action revalidates
both the active and previous databases before deleting the previous file. All
automated restore tests use temporary synthetic databases; acceptance of the
full restart flow in packaged macOS and Windows applications remains a release
gate.

## Invariants

- Raw source, parsed payload, corrections and approval decisions are separate.
- Immutable provenance tables reject `UPDATE` and `DELETE`.
- Duplicate detection records provenance; it never merges or discards a report.
- JSON-bearing columns are validated with SQLite `json_valid`.
- Cross-table keys prevent a correction, decision or revision from referencing
  a parser version belonging to another report.
- Tests use a temporary in-memory database and synthetic values only.
- Application code must use the repository write boundary so domain records and
  matching audit events remain atomic.

## Migration workflow

The backup dialog exposes a local **Оновлення та міграції** status. The
`get_database_status` command reads the active `_sqlx_migrations` table through
the existing native pool after startup migrations finish. It requires the exact
registered version sequence, successful flags and SHA-384 checksums, then shows
the application version, active schema version, latest supported schema version
and migration count. The frontend has no fallback that can label an unknown,
partial or checksum-mismatched state as current.

The same panel explicitly tells the user to create and verify a local backup
before installing a newer EasyWAR version. This is local migration UX, not a
network updater: release discovery, download, signature verification and
installation are not implemented. Cross-version data-preservation acceptance
remains part of the separate stable-migration release gate.

Before Tauri, the SQL plugin or any application pool opens `easywar.db`, the
desktop startup path already holds the exclusive application-instance lock and
runs the authoritative embedded SQLx migrator from `src-tauri/migrations`.
There is no manually maintained schema dump:

- if the database does not exist, all embedded migrations are applied to a
  temporary SQLite file, the result passes the normal backup inspection, and
  only then is it published as `easywar.db` without overwriting another file;
- if the database has an exact supported migration-history prefix, startup
  first creates and revalidates a byte-exact, non-overwriting sibling backup
  named like `easywar.db.pre-migration-v3-to-v4.sqlite3`;
- if that name already contains another valid older database, EasyWAR keeps it
  and uses a numbered sibling instead of replacing it;
- pending migrations run on a temporary copy of that verified backup. The live
  database remains unchanged until the migrated copy passes integrity,
  foreign-key, required-object, migration-version and checksum checks;
- the verified candidate is installed with a same-directory rename. A
  transient `easywar.db.migration-swap-previous` protects the rename gap; the
  next startup restores it if the process stopped before the candidate was
  installed, or finalizes a fully verified candidate after confirming that a
  separate pre-migration backup exists;
- a migration error removes only the temporary candidate and leaves the live
  database plus its verified backup intact. A repeated startup against the
  current schema is a no-op, and the Tauri SQL plugin subsequently sees the
  same complete migration history;
- a missing, altered, failed, newer or unrelated migration history fails
  closed before application repositories open the database.

Startup failures do not panic. `src-tauri/src/startup_recovery.rs` shows a
native message (the Windows build has no console) and classifies the failure:
only an unusable database (not SQLite, failed integrity/foreign-key/migration
checks, missing required objects) is offered for set-aside, and only after an
explicit Yes. Set-aside renames the database and its `-wal`/`-shm`/`-journal`
files to `<db>.damaged-<UTC stamp>` (numbered suffix when taken), never deletes
or overwrites, then lets the normal migrator create a fresh database. A
database from a newer schema, file-system errors, failed migrations, ambiguous
swap states and a second running instance are reported without touching any
file. Covered by synthetic tests (healthy start, consent, refusal, newer
schema, name collisions, second-attempt failure).

The pre-migration backup contains local data and is not encrypted. It remains
beside the app database for explicit recovery; EasyWAR never uploads it.
Synthetic regression tests cover clean creation, v3-to-v4 preservation of raw
source, parsed values, corrections, approved revision/decision and audit data,
idempotent repeat startup, candidate failure, non-overwriting backups and an
interrupted swap gap. Packaged macOS and Windows update acceptance remains a
separate release gate.

1. Add a numbered SQL file under `src-tauri/migrations/`.
2. Register it in `src-tauri/src/database.rs` with the next integer version.
3. Add a synthetic test that applies all migrations to an empty in-memory DB.
4. Verify forward migration, constraints and provenance invariants.
5. Never edit a migration that has shipped; add a new migration instead.
