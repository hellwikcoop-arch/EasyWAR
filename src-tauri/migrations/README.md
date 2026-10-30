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

`0012_dashboard_module_style.sql` adds `dashboard_modules.style`, the look picked
in the module creation window: `standard` (the default, so existing modules keep
their look), `branch` (colours of the dashboard's service branch) or
`heightwell` («Пункт керування»). A `CHECK` limits it to these three names; the
colour comes from the module's `branch`, never from stored text.

`0013_office_library.sql` adds the encrypted document library of the «Офіс»
section. `library_keyrings` holds one row per profile: the library data key
wrapped with XChaCha20-Poly1305 under a key that Argon2id derives from the
profile password (the KDF parameters are stored with the wrap) and, optionally,
a second wrap under a recovery code. `library_items` (documents with encrypted
names), `library_blobs` (encrypted content keyed by an HMAC `content_id`, stored
once per profile), `library_versions` (immutable versions), `library_events`
(an append-only audit without content) and `library_purges` (the purge log)
store no plaintext document text or name. Unconditional `BEFORE` triggers keep
versions, events and purges append-only, refuse `INSERT OR REPLACE`, `REPLACE`
and UPSERT over an existing key, allow a keyring change only with
`generation + 1`, and allow erasing content (`data` to `NULL`) only after the
keyring is shredded. The tables have no foreign key to `local_profiles`;
`local_profiles_library_guard` refuses to delete a profile with an active
library, so the caller crypto-shreds the library in the same transaction first.

`0014_document_links.sql` adds `document_links`: for a library document
generated from a template, the immutable template version, the kind of data
source (`approved_revisions`, `dashboard_module`, `library_table`), its
parameters as bounded JSON (identifiers and dates only), the last generated
version and an HMAC fingerprint of the source data. Only the generation state
(last generated version, fingerprint, update time) can change, and only while
the profile's keyring is active. Deleting the row is «Відв'язати від джерела»;
the document and its versions stay intact.

`0015_library_blob_repair.sql` rewrites `library_blobs_update_guard` so that a
damaged blob can be repaired. `content_id` is an HMAC of the plaintext, so the
same content of a profile always maps to the same row; before this migration a
row whose ciphertext no longer decrypted could never be replaced, and importing
or saving the same bytes again failed forever. Now, while the profile's keyring
is active, `data` may be replaced by another ciphertext that passes the table's
CHECK (header and length for the same `plain_size`); the application does this
only when the stored row fails to decrypt and the new ciphertext has just been
sealed with the library key. The row identity (rowid, profile, `content_id`,
`plain_size`, `created_at`) stays immutable, erasing (`data` to `NULL`) is still
allowed only after the keyring is shredded, and erased content never comes back.

`0016_dashboard_module_correction_status.sql` adds `stored_value` (canonical
value written after an import correction, JSON) and `superseded_at` (when a hand
edit changed that field) to `dashboard_module_corrections`. Existing corrections
keep all their columns and get NULL in both: they are shown as «поточність не
підтверджена» until their field is edited.

`0017_profile_schemas.sql` adds `profile_schemas` (one row per profile, deleted
with it): the versioned profile schema of E3 — the user's decisions about which
columns of their tables play which semantic roles — as one JSON document plus
`format_version`, `revision` (compare-and-swap mark, grows with every change) and
`updated_at`. It stores no module rows and no raw XLSX values and is independent
of `dashboard_module_fields`, which is rewritten from the template on every read.

`0018_dashboard_layouts.sql` adds `dashboard_layouts` (one row per profile and
dashboard, deleted with the profile): the E4 layout of «Мій дашборд» — module
cards, their own period and style, and grid placement — as one JSON document of
format `easywar.dashboard-layout` plus `format_version`, `revision` (the same
compare-and-swap mark) and `updated_at`. It holds no module rows and no raw XLSX
values; cards only refer to sources of the profile schema. The number 0018 was
free on main when taken (the collectives plan reserved it provisionally: the first
merged migration takes the number, E8 uses the next free one).

`0019_collectives.sql` adds the first E8 (C3b) tables, all keyed by profile and
deleted with it: `collective_identities` (public member and device keys of the
profile; secrets stay in the secret-store file under the profile password),
`collectives` (collectives created by the profile) and
`collective_membership_log` (the applied contiguous prefix of the signed
membership journal, one canonical record blob per `seq`, re-verified on read).
Commands `collective_*` are allowed only to the editor window where the
«Колективи» screen runs; there is no network.

`0020_collective_sync.sql` (owner decision 2026-10-29 23:19Z) adds
`collective_tables` (title, owner, class and purpose with who confirmed each — the
input of the Rust send gate; unconfirmed or planned means class D) and
`collective_invitations_used` (single-use invitation nonces). Both are keyed by
`(profile_id, collective_id)` and cascade with the collective. Number 0020 was the
next free one on main.

`0024_collective_table_data.sql` (owner decision 2026-10-30, «Так, починай») adds
`collective_tables.columns` (JSON array of column names, `[]` by default) and
`collective_table_ops` (one sealed envelope per «Доповісти», keyed by
`envelope_id`, cascading with the table). Row values are never stored in clear;
Rust rebuilds the table by opening and re-verifying the envelopes. Numbers
0021–0023 are taken by open module branches; this file does not depend on them,
and the registration test checks the version list, not a contiguous count.

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
