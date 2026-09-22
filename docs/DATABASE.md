# EasyWAR database contract

## Scope

EasyWAR uses a local SQLite database managed by the official Tauri SQL plugin.
The database file resolves inside the application-local configuration area and
must never be committed.

The Tauri configuration preloads `sqlite:easywar.db`, so registered migrations
run during application startup before the frontend requests a connection.

Migration `0001_provenance_schema.sql` creates the first provenance layer. It
does not import XLSX files, create Signal integration, or contain operational
fixtures.

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

If any statement fails, none of the transaction's domain or audit rows persist.
The repository exposes the derived current status as a read-only query. It does
not expose Tauri commands yet and does not open or populate a real database in
tests.

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
the validated Signal setting through dedicated Tauri commands, not the generic
settings store or direct SQL access.

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
files. It does not stage or replace the running database.

## Invariants

- Raw source, parsed payload, corrections and approval decisions are separate.
- Immutable provenance tables reject `UPDATE` and `DELETE`.
- JSON-bearing columns are validated with SQLite `json_valid`.
- Cross-table keys prevent a correction, decision or revision from referencing
  a parser version belonging to another report.
- Tests use a temporary in-memory database and synthetic values only.
- Application code must use the repository write boundary so domain records and
  matching audit events remain atomic.

## Migration workflow

1. Add a numbered SQL file under `src-tauri/migrations/`.
2. Register it in `src-tauri/src/database.rs` with the next integer version.
3. Add a synthetic test that applies all migrations to an empty in-memory DB.
4. Verify forward migration, constraints and provenance invariants.
5. Never edit a migration that has shipped; add a new migration instead.
