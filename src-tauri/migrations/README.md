# SQLite migrations

This directory is the canonical home for versioned SQLite migration SQL.

Issue #1 registers the official Tauri SQL plugin and an empty migration list.
It deliberately creates no product tables and contains no real data. Add a
numbered migration only when the repository's database issue defines and tests
the schema and provenance invariants.
