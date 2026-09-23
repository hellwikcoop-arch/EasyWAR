# EasyWAR

Local-first desktop application for structured operational reporting, intake, validation and analytics.

> **Canonical repository:** this repository is the single source of truth for EasyWAR development.

## Product direction

- Desktop first: **macOS + Windows**
- Local-first data ownership
- Existing EasyWAR HTML/JavaScript logic is preserved and migrated incrementally
- Target desktop shell: **Tauri 2**
- Local persistence: **SQLite**
- Intake sources: pasted text, Signal, XLSX/Excel, later optional adapters
- Human review before a parsed report becomes an approved record
- Ukrainian user interface

## Core data rule

```text
RAW SOURCE
   ↓
PARSED
   ↓
MANUALLY REVIEWED
   ↓
APPROVED
```

The original source must remain auditable and must not be silently overwritten by parsed or corrected values.

## Security / privacy

- Do **not** commit operational databases, real XLSX files, Signal credentials, API keys, tokens or private attachments.
- GitHub is for **source code, tests, documentation and release metadata**.
- Working data stays local unless a user explicitly enables an integration.
- External AI/cloud integrations are optional and disabled by default for sensitive source data.

## Repository layout

```text
.
├── AGENTS.md
├── .codex/
│   ├── coordination/project.yaml
│   └── environments/environment.toml
├── docs/
│   ├── ARCHITECTURE.md
│   ├── BACKUP_AND_RECOVERY.md
│   ├── DATABASE.md
│   ├── MACOS_PACKAGING.md
│   ├── RELEASE_CHECKLIST.md
│   ├── ROADMAP.md
│   ├── USER_GUIDE.md
│   └── PROJECT_CONTEXT.md
├── script/build_and_run.sh
├── src/
│   └── index.html
├── src-tauri/
│   ├── capabilities/default.json
│   ├── migrations/README.md
│   ├── src/
│   ├── Cargo.toml
│   └── tauri.conf.json
├── package.json
├── vite.config.js
└── README.md
```

`src/index.html` is a byte-for-byte copy of the current single-file EasyWAR
frontend. It is embedded as the first Tauri frontend without a wholesale
rewrite. SQLite is registered with a versioned provenance schema; see
[`docs/DATABASE.md`](docs/DATABASE.md). No real data is stored in the repository.

The Tauri content security policy is temporarily unset because the preserved
legacy application relies on inline scripts and styles. CSP hardening must be
done alongside the incremental frontend migration, not by silently breaking
the existing application.

## User documentation

The Ukrainian end-user workflow, safety boundaries and troubleshooting guide
is available in [docs/USER_GUIDE.md](docs/USER_GUIDE.md).

## Local development

Prerequisites:

- Node.js and npm;
- Rust toolchain compatible with Tauri 2;
- the platform prerequisites from the Tauri documentation.

Install dependencies and run the desktop shell:

```text
npm ci
./script/build_and_run.sh
```

The Codex `Run` action calls the same script. Use
`./script/build_and_run.sh --verify` for a debug build plus a process check.
On Windows, use `npm run tauri dev` from a supported developer shell.

## Current milestone

**EasyWAR Desktop 0.5**

Goal:
- Tauri 2 shell
- SQLite schema + migrations
- existing Intake workflow
- Signal inbox integration boundary
- settings
- audit log
- macOS build path
- Windows-ready project structure

See [docs/ROADMAP.md](docs/ROADMAP.md). Production distribution remains
**NO-GO** until every mandatory gate in
[docs/RELEASE_CHECKLIST.md](docs/RELEASE_CHECKLIST.md) has direct evidence.
