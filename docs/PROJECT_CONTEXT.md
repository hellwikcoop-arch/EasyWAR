# Project context

## Canonical goal
Build EasyWAR as a local-first desktop analytics and reporting product for macOS and Windows while preserving the proven behavior of the existing EasyWAR single-file application.

## Required invariants
1. Ukrainian UI.
2. Local-first storage.
3. Raw source remains auditable.
4. Parsed data is not the same as approved data.
5. Human review is the default before approval.
6. No operational data, credentials or secrets in Git.
7. Existing working parser/analytics behavior is migrated incrementally.
8. macOS + Windows remain shared-core targets.
9. Signal is an intake adapter, not a source of truth.
10. External/cloud integrations are optional.

## Current architecture decision
- Tauri 2 desktop shell
- existing HTML/CSS/JS frontend first
- Rust application core
- SQLite persistence with migrations

## Current milestone
EasyWAR Desktop 0.5.

## Development helpers
- Context7: current library/API documentation
- CompText Context: bounded operational context
- Codex Coordinator: task boundaries for parallel work
- Context Handoff: continuity when context pressure grows
- Build macOS Apps: macOS build/debug/signing work
- GitHub: canonical version control and issue tracking
