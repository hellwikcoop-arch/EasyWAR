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
│   └── coordination/
│       └── project.yaml
├── docs/
│   ├── ARCHITECTURE.md
│   ├── ROADMAP.md
│   └── PROJECT_CONTEXT.md
└── README.md
```

The application source will be migrated into this repository in controlled stages rather than rewritten wholesale.

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

See [docs/ROADMAP.md](docs/ROADMAP.md).
