# EasyWAR repository instructions

See also `docs/PROJECT_CONTEXT.md` (project brief, glossary), `docs/WORKFLOW.md`
(task format, branches, checks, release) and `docs/BACKLOG.md` (priorities).

## Communication
- User-facing language: Ukrainian.
- Keep status reports short and concrete: what changed, what was verified, what remains unverified.

## Product constraints
- EasyWAR is local-first.
- Do not move operational data to cloud services by default.
- Never commit real operational XLSX/CSV/SQLite files, Signal data, credentials, tokens, secrets, or private attachments.
- External integrations must be optional and explicit.
  - Owner exception (2026-10-21): exactly two automatic service transfers are allowed without a
    per-send prompt, and nothing else is:
    1. Installation counter (`docs/MODULES_ROADMAP.md`, Q13): random persistent `account_id`,
       `device_id`, `installation_id` and the time of the last report; no names, units or data.
    2. Structure of user-built modules (`docs/MODULES_ROADMAP.md`, Q12): column roles, view and
       settings; no column names, row values or files.
  - Conditions: never operational data, Signal data, credentials, tokens, tables or personal
    data; what is sent and where is stated in the user guide and shown in the interface; the
    destination is chosen by the owner and documented; the code is added only after a separate
    owner decision and is tested with synthetic data.
  - Any other automatic transfer needs a new owner decision and an edit here.
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

## Staff bridge (ADM / J4)
- The staff coordinator role is ADM; J4 Bridge is its software component. It lives in `easywar-staff/bridge/`, not in this repository, and is not part of the EasyWAR application.
- Messages routed through J4 carry only synthetic task material: never operational data, Signal data, credentials, tokens, tables or personal data from EasyWAR.
- J5 runs through the OpenAI Responses API via J4; Codex (C5.1) never acts as J5. Paid calls through J4 need a separate owner approval and stay within the owner-set monthly cap.
- A Codex run started by J4 as an independent reviewer (C5.1-R) uses the read-only sandbox, does not claim a task-boundary board slot for writing, and does not replace C3 without a separate owner decision.
- J4 does not hand tasks from J5 to Codex executors (C5.1) until the owner approves that route separately; Codex executor runs follow the task-boundary board rules above and write only to their own branch; merges stay with J3 under the staff contract.
- Do not store bridge prompts, transcripts or raw model replies in this repository.

## Dashboard module charts
A new chart kind for the module catalog touches: the builder in `BUILDERS` and the name in `chartSummary` (`src/dashboard-module-charts-core.js`), the renderer in `RENDERERS` (`src/dashboard-module-charts.js`), `VISUAL_KINDS` (`src/dashboard-module-catalog-core.js`), synthetic rows in `sampleRows` (`src/dashboard-module-catalog.js`), the Rust template in `catalog()` plus the template count in its Rust test and in `tests/dashboard-module-source.test.mjs`. `tests/dashboard-module-charts.test.mjs` also holds text contracts on import lines and CSS (no `stroke-dasharray`); update them with the code.

## 3D models
Index of all 3D model files, loaders and tests: [`docs/3D_MODELS.md`](docs/3D_MODELS.md). Read it first; do not search the whole project for models. Files live in `src/models/*.glb`, procedural munitions in `src/munition-3d.js`, the reference viewer in `src/ref-viewer.js`. Interactive 3D guides (six pages and a hub, opened by the «3D-довідники» button) live in `src/guides/`; their model credits are kept only in `src/guides/credits.js` (regenerate the section in `src/models/CREDITS.md` with `node script/guides-credits.mjs`); details are in the last section of `docs/3D_MODELS.md`.
