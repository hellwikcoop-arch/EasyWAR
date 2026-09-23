# EasyWAR XLSX import boundary

## Scope

Desktop 0.5 includes a local, in-memory reader for the existing EasyWAR
workbook contract. It accepts workbook bytes, reads the `Зведена` sheet and
returns a typed import batch. It does not upload, copy, modify or export the
source workbook.

The adapter uses Calamine `0.26.1`, pinned because it supports the repository's
Rust `1.77.2` baseline. The current Calamine release requires a newer compiler.

## Required sheet contract

The first row must contain these headers. Whitespace and letter case are
normalized only while matching headers; additional columns are allowed.
If a required header appears more than once after this normalization, import
fails rather than choosing one column silently. Unrelated extra columns remain
allowed.

1. `№`
2. `Дата`
3. `Час ураження`
4. `№ цілі (TS/KS)`
5. `В інтересах`
6. `Район / н.п.`
7. `DPI / Координати MGRS`
8. `Тип цілі`
9. `Місяць`
10. `Тип ЛА`
11. `Тип боєприпасу`
12. `К-сть боєприпасів`
13. `Результат ураження`
14. `Причина`
15. `Уточнення результату`

## Output and provenance

`import_easywar_xlsx` returns:

- the SHA-256 identity of the source workbook bytes;
- the resolved sheet name;
- the original worksheet row number;
- `raw_values`, preserving each required cell before field normalization;
- ordered `source_cells` with the interpreted value and original header for
  every worksheet column, including additional columns;
- a typed `EasyWarRecord`. Its Rust member names are descriptive, while its
  serialized field names match the existing CORE record contract exactly.

The five names that differ inside Rust are `number` → `num`, `target_ids` →
`targets`, `coordinates` → `dpi`, `target_type` → `type`, and
`munition_count` → `count`. The other ten names are unchanged. Neither the
serialized parsed record nor its date normalization replaces `raw_values`.

Only the date field is normalized at this boundary. ISO dates, Ukrainian
`дд.мм.рррр` / `дд/мм/рррр` text and recognized Excel date serials become `рррр-мм-дд`,
matching the legacy frontend behavior. Unknown date text is preserved so a
later review layer can surface it instead of silently discarding it.
Like the legacy CORE, a numeric Excel serial is converted only when it has
five digits and falls strictly between `36526` and `73051`; other numeric
values remain unchanged. Fractional serials in that range use the whole day.

## Current boundary

The Desktop entry screen now offers a separate **read-only compatibility
check**. A native file picker accepts a user-selected `.xlsx` up to 64 MiB.
The Rust importer validates `Зведена` in memory and returns only the sheet
name, row count and workbook SHA-256; the interface displays the first two
items, not workbook rows or a file path. Cancel, invalid files and read errors
leave the source and local database unchanged. This check is separate from the
legacy “Відкрити таблицю” workflow, which can edit an XLSX after user actions.

The desktop now exposes a separate, explicit **Імпортувати в локальну базу**
action. A native picker reads the selected file again, applies the same 64 MiB
limit and `Зведена` validation, and passes the parsed batch to the repository.
The repository stages that batch in one local
SQLite transaction. Each row gets an immutable interpreted-cell snapshot,
workbook SHA-256 and worksheet row identity, a separate parsed version, and
matching capture/parse audit events. No correction or approval is created;
the derived status is `PARSED`. Retrying identical workbook bytes is
idempotent. A conflicting identity or incomplete prior history fails and
rolls back the whole new batch. The interface reports newly staged and already
present row counts, states that imported records are `PARSED` rather than
approved, and never changes the selected XLSX. It also reports exact duplicate
rows. Duplicate detection compares the deterministic parsed JSON payload, not
the workbook bytes or free-form similarity. A row matching an already stored
XLSX parsed payload gets an immutable SHA-256 fingerprint, a link to the first
previously stored match and a `DUPLICATE_DETECTED` audit event. The new raw
snapshot, report and parser version remain present and `PARSED`; nothing is
merged, hidden, removed or approved. Repeating the same import adds neither a
new link nor a new audit event. The store retains cell values, not the original
XLSX bytes, XML, formulas or formatting: keep the source workbook separately
for full source-file provenance. Fuzzy or domain-specific matching is outside
this boundary.

It deliberately does not:

- approve imported records or create review decisions;
- implement fuzzy duplicate detection.

Those compatibility and persistence steps remain tracked under milestone 0.7.
Tests generate minimal synthetic workbooks entirely in memory and do not use or
commit real `.xlsx` files. The test suite also loads the unchanged legacy CORE
script from `src/index.html` and checks its 15-field output against an
in-memory synthetic `Зведена` workbook. A separate Rust test checks all 15
serialized field names and values with the matching synthetic row. These are
contract checks, not yet a full cross-runtime comparison for varied workbook
styles, formulas or reference sheets. Both readers now consume one shared
synthetic case list for nine date forms, including numeric serials,
out-of-range numbers, mixed text separators and ambiguous text. This is not
yet evidence that every real-world workbook variant behaves identically.

## Compatible export

The desktop entry screen also exposes an explicit **Експортувати схвалені
записи** action. It reads only the latest revision whose current local review
state is `APPROVED`. Records in `NEW`, `PARSED`, `NEEDS_REVIEW` or `REJECTED`
state are not exported. Raw source content, parsed versions and manual
correction history remain unchanged in SQLite.

The export creates a new `.xlsx` with one `Зведена` sheet and the exact 15
legacy headers in their established order. Signal record arrays are flattened
with the existing CORE mapping: `types` use `, `, `cause` uses `; `, and a
missing month is derived from an ISO date. A missing row number is assigned
sequentially. The source workbook used by an earlier import is never opened or
modified.

The destination is written through a temporary file in the chosen directory
and published with a no-clobber rename. An existing destination is never
overwritten; the user must choose a new name. Cancellation creates nothing.
Tests use only synthetic approved snapshots and verify all 15 fields by
reopening both the in-memory and persisted export with the same Rust XLSX
reader used for import. A separate test proves that an existing file remains
byte-for-byte unchanged. This proves the current generated `Зведена` contract;
it does not prove arbitrary workbook-style compatibility or full cross-runtime
regression against every legacy workbook.

## Export using a reference workbook

The separate **Експортувати за зразком** action asks the user to select a
compatible reference `.xlsx` and then to choose a different output path. The
reference bytes are read only and are never rewritten or used as the output
destination. The resulting file still uses the no-clobber atomic writer, so an
existing output file is never replaced.

The exporter resolves the workbook relationships, finds `Зведена`, validates
the same 15 required headers, and appends only the latest locally `APPROVED`
records after the last worksheet row. It continues numbering after the highest
existing numeric `№`, copies the latest available style for each mapped column,
and writes ISO dates as Excel serials when the reference date column has a
style. Existing rows and cells are not normalized or rewritten.

All ZIP parts are carried into the new workbook in their original order and
compression mode. Only the `Зведена` worksheet XML and its related table XML
parts are changed. The exporter extends worksheet dimensions, filters,
conditional-formatting/data-validation ranges and table ranges when their prior
end row matches the existing data or styled tail. Other worksheets, shared
strings, styles, formulas, relationships and unrelated package parts keep their
original bytes inside the new package.

Before returning the generated bytes, Rust reopens the new workbook through the
same import boundary and checks the total row count and every appended parsed
record. Unsupported ZIP compression, duplicate package parts, missing
relationships, malformed XML, missing/duplicate headers or a failed self-check
stop the export without publishing a destination.

Synthetic tests prove that the reference byte buffer is unchanged, unrelated
OOXML parts remain byte-for-byte identical, the linked table range grows, date
styling is reused, a styled blank tail is handled, and all appended fields
reopen correctly. Acceptance with representative real reference workbooks and
full cross-runtime comparison against the legacy parser remain unverified.
