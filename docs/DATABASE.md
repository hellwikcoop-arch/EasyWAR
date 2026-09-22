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
| Settings | `settings` | Local JSON settings; mutable by the future repository layer. |

The `report_current_state` view derives `NEW`, `PARSED`, or the latest review
decision without overwriting source or parser records.

## Invariants

- Raw source, parsed payload, corrections and approval decisions are separate.
- Immutable provenance tables reject `UPDATE` and `DELETE`.
- JSON-bearing columns are validated with SQLite `json_valid`.
- Cross-table keys prevent a correction, decision or revision from referencing
  a parser version belonging to another report.
- Tests use a temporary in-memory database and synthetic values only.
- Application code must add a matching audit event when it changes mutable
  state; the repository layer is responsible for making those writes atomic.

## Migration workflow

1. Add a numbered SQL file under `src-tauri/migrations/`.
2. Register it in `src-tauri/src/database.rs` with the next integer version.
3. Add a synthetic test that applies all migrations to an empty in-memory DB.
4. Verify forward migration, constraints and provenance invariants.
5. Never edit a migration that has shipped; add a new migration instead.
