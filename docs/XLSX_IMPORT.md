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

A separate repository primitive can stage an already parsed batch in one local
SQLite transaction. Each row gets an immutable interpreted-cell snapshot,
workbook SHA-256 and worksheet row identity, a separate parsed version, and
matching capture/parse audit events. No correction or approval is created;
the derived status is `PARSED`. Retrying identical workbook bytes is
idempotent. A conflicting identity or incomplete prior history fails and
rolls back the whole new batch. This primitive is tested only with synthetic
data and is **not yet callable from the desktop UI**. It retains cell values,
not the original XLSX bytes, XML, formulas or formatting: keep the source
workbook separately for full source-file provenance. Similar rows in different
workbooks are not yet deduplicated.

It deliberately does not yet:

- let the desktop UI write imported rows into SQLite;
- approve imported records;
- implement duplicate detection, reference workbooks or XLSX export.

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
