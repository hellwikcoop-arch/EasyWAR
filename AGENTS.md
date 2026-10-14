# EasyWAR repository instructions

## Communication
- User-facing language: Ukrainian.
- Keep status reports short and concrete: what changed, what was verified, what remains unverified.

## Product constraints
- EasyWAR is local-first.
- Do not move operational data to cloud services by default.
- Never commit real operational XLSX/CSV/SQLite files, Signal data, credentials, tokens, secrets, or private attachments.
- External integrations must be optional and explicit.
- Ukrainian UI only.

## Source-of-truth rule
Preserve the separation:
1. raw source
2. parsed values
3. manual corrections
4. approved record

Never silently rewrite the raw source.

## Migration rule
The legacy EasyWAR HTML/JavaScript application is a working source system. Migrate incrementally and preserve verified behavior. Do not rewrite the entire application merely to change architecture.

## Legacy HTML editing
When editing the legacy single-file application:
- create a backup first;
- generate a base64-stripped reading copy;
- inspect only bounded code fragments;
- make narrow anchored patches;
- never write the stripped copy back;
- run syntax checks on every inline script after changes;
- use synthetic test data for verification.

## Desktop target
Primary architecture:
- Tauri 2
- existing HTML/CSS/JavaScript frontend initially
- Rust application core
- SQLite with migrations
- macOS + Windows

Use Swift/macOS-specific implementation only when it is genuinely platform-specific; do not make the core macOS-only.

## Verification
Do not claim completion without tests appropriate to the changed layer.
Minimum expectations:
- JS syntax checks for legacy scripts
- unit/regression tests for parser/core changes
- database migration tests for schema changes
- build/run verification for desktop shell when toolchain is available
- no real operational data in tests

## Codex task-boundary board
- This repository uses the opt-in Codex task-boundary board in `.codex/coordination/project.yaml`.
- Before substantial writes, load the installed `codex-coordinator` skill, list active claims from the primary worktree, and publish only this task's bounded claim.
- Native Codex tasks remain the execution, messaging, and transcript authority; an explicitly requested goal Coordinator is on demand, with no heartbeat or mandatory pull-request workflow.
- Reject cross-project notices and never store transcripts, reasoning, prompts, or tool output in Coordinator state.

## 3D models
Index of all 3D model files, loaders and tests: [`docs/3D_MODELS.md`](docs/3D_MODELS.md). Read it first; do not search the whole project for models. Files live in `src/models/*.glb`, procedural munitions in `src/munition-3d.js`, the reference viewer in `src/ref-viewer.js`. Interactive 3D guides (six pages and a hub, opened by the «3D-довідники» button) live in `src/guides/`; their model credits are kept only in `src/guides/credits.js` (regenerate the section in `src/models/CREDITS.md` with `node script/guides-credits.mjs`); details are in the last section of `docs/3D_MODELS.md`.
