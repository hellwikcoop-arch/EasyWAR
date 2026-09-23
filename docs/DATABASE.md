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
profile selection. Migrations contain no operational fixtures and create no
external integration.

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
the validated Signal setting through dedicated Tauri commands, not the generic
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

Profiles are not accounts, authentication identities, roles or permissions.
They contain no secrets and are not transmitted to a service. Profile changes
do not rewrite immutable raw sources, parsed values, corrections, approved
revisions, reviewer labels or audit events. Role binding and workspace
templates are separate ROADMAP items.

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
files. The separate staging primitive copies a validated file to a temporary
file next to the live database, validates the copy again, and publishes it only
if no pending candidate exists. It is not exposed in the desktop UI yet and
does not replace or restart the running database. A future restore flow must
serialize app instances and close SQLite connections before enabling restore
in the UI. An offline-only swap primitive now rejects live WAL/SHM/journal
sidecars, validates the staged database again, and moves the prior database to
`easywar.db.restore-previous` before replacing the live file. If interrupted
between renames, a separate recovery primitive moves the prior file back and
leaves the staged candidate intact. After a completed swap, the prior file is
retained and blocks another swap until explicitly handled. These primitives
are tested only with temporary synthetic databases and are **not wired into
application startup or any desktop command**: instance locking, controlled
restart, recovery UX, and real-platform acceptance remain open.

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

1. Add a numbered SQL file under `src-tauri/migrations/`.
2. Register it in `src-tauri/src/database.rs` with the next integer version.
3. Add a synthetic test that applies all migrations to an empty in-memory DB.
4. Verify forward migration, constraints and provenance invariants.
5. Never edit a migration that has shipped; add a new migration instead.
