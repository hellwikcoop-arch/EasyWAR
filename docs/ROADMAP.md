# EasyWAR roadmap

## 0.5 — Desktop foundation

**Goal:** establish the canonical desktop application.

- [x] Tauri 2 project scaffold
- [x] preserve current HTML/CSS/JS UI as first frontend
- [x] Rust application core scaffold
- [x] SQLite plugin / schema / migrations
- [x] repository layer
- [x] settings store
- [x] audit log
- [x] import path for current EasyWAR/XLSX workflow
- [x] macOS build/run path
- [x] Windows-ready project structure
- [x] synthetic desktop-shell smoke test

**Exit condition:** application opens as a desktop app, local database initializes, existing intake logic can be exercised without real data.

## 0.6 — Signal intake

- [ ] signal-cli local adapter
  - [x] local-only daemon endpoint and deny-by-default policy
  - [x] explicit read-only HTTP loopback discovery of local accounts and groups
  - [ ] live daemon connector
    - [x] bounded SSE framing and manual-receive notification decoder (synthetic only)
    - [x] bounded event-stream connection and subscribe/unsubscribe lifecycle (synthetic loopback)
    - [x] fail-closed allowlist-gated provenance capture bridge (synthetic only)
    - [x] desktop-managed bounded receive session with explicit Start/Stop (synthetic loopback)
    - [ ] acceptance of the receive session with an installed real signal-cli
- [ ] linked-account setup UX
  - [x] short-lived local QR workflow with synthetic `startLink` / `finishLink` coverage
  - [ ] acceptance with an installed real signal-cli and primary phone
- [ ] account/group discovery
  - [x] user-triggered HTTP multi-account discovery (no receive or persistence)
- [ ] allowlist
  - [x] exact sender and group match policy; deny by default
  - [x] validated local settings persistence
  - [x] local allowlist management UI (intake remains disabled)
- [x] explicit disconnected/no-intake state in desktop UI
- [ ] Signal Inbox
  - [x] synthetic status transitions with a reviewer identifier
  - [x] clearly labelled synthetic-only UI preview (no persistence)
  - [x] read-only provenance-backed local list and Ukrainian empty state (synthetic tests only)
  - [x] explicit persisted-message bridge to the legacy parser for manual review without auto-append
  - [x] persist parser output and explicit `PARSED` → `NEEDS_REVIEW` transition
  - [x] persist explicit reviewer-bound `APPROVED` / `REJECTED` decisions
  - [ ] persist manual corrections and corrected revision snapshots
- [x] status model: NEW / PARSED / NEEDS_REVIEW / APPROVED / REJECTED
- [x] import message into intake parser
- [ ] commands: /help, /status, /ping, /queue, /last
- [x] no automatic approval by default

## 0.7 — XLSX compatibility

- [x] reject ambiguous duplicate required headers (synthetic regression)
- [ ] import current `Зведена`
  - [x] user-selected, read-only desktop compatibility preflight
  - [x] synthetic-tested atomic SQLite staging primitive (not yet wired to UI)
- [ ] export compatible XLSX
- [ ] preserve legacy field mapping
  - [x] verify all 15 serialized names against legacy CORE with synthetic records
- [ ] duplicate detection
- [ ] reference workbook support
- [ ] regression comparison against legacy parser
  - [x] match nine synthetic XLSX date cases across legacy CORE and Rust

## 0.8 — Analytics

- [ ] dashboard model from SQLite
- [ ] period filters
- [ ] effectiveness calculations
- [ ] aircraft / munitions / unit breakdowns
- [ ] data-quality view
- [ ] map abstraction
- [ ] export views

## 0.9 — Roles and templates

- [ ] local profiles
- [ ] role-based workspace templates
- [ ] position-specific empty database/template generation
- [ ] backup / restore
  - [x] user-selected, non-overwriting local SQLite backup with integrity check
  - [x] read-only compatibility preflight for a selected backup
  - [x] non-overwriting, revalidated staging primitive (not exposed in UI)
  - [x] synthetic-tested offline swap and interrupted-swap rollback primitive (not wired)
  - [ ] in-app restore with preflight and controlled restart
- [ ] update/migration UX

## 1.0 — Production release

- [ ] stable migration path
- [ ] signed macOS build
- [ ] notarization
- [ ] Windows installer
- [ ] release checklist
- [ ] recovery/backup guide
- [ ] user documentation
