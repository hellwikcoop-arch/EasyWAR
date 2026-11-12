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
- Collective sync (owner decisions 2026-10-30 00:21Z, 09:30Z, 09:47Z, 10:28Z, 10:32Z): sealed
  collective records may be exchanged between authorised members of the same collective, and
  only by an action of the user in the interface («Доповісти», «Оновити таблицю», joining by a
  code); this is not one of the two automatic transfers above and does not make any transfer
  automatic or background.
  - Channels: LAN; a direct port opened by the application only while the user's action runs and
    closed right after it; a member's own node in the RELAY role, enabled by that member's
    separate consent and visible in the interface; the rendezvous server for joining by a code.
    No hidden persistent service; no UPnP or firewall changes without a separate owner decision.
  - Payload: only `EnvelopeV1` records encrypted end to end with the collective's epoch keys,
    signed by a device of a current member; a relay or rendezvous node never holds epoch keys and
    sees only addresses, sizes, times and the encrypted pairing messages (the first two digits of
    the join code are the slot number; the other four never leave the two applications).
    Records of every data class may travel; sensitive current data keeps the explicit
    confirmation before each transfer and the Rust send gate; unclassified data stays blocked.
  - Gate: `GatePolicy::CURRENT` keeps WAN and Base44 off in code. Turning WAN on is a separate
    change that needs an accepted independent security review (including the `spake2` crate and
    the roles matrix SEC-005) and a new owner decision recorded in `docs/adr/collective-pairing.md`; until
    then the code exists but cannot send.
  - Documentation: the user guide states what is sent, to whom and when; the interface shows the
    chosen relay address and the delivery status.
  - Tests use synthetic data only.
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
