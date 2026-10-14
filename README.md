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
├── .github/workflows/desktop-build.yml
├── script/build_and_run.sh
├── script/import_unified_html.mjs
├── src/
│   ├── index.html   # launcher: вибір роду військ
│   ├── air.html     # Повітряні Сили + desktop-інтеграції
│   ├── rocket.html  # Ракетні Війська
│   └── aircraft-viewer.html  # інтерактивні літаки у вкладці «Довідник» ПС (кадр, без мережі)
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

The frontend is the unified EasyWAR v3.1 application split into three
same-origin pages: the launcher (`src/index.html`) and the two branch modules
it opens in iframes (`src/air.html`, `src/rocket.html`). The Rocket Forces
module is byte-for-byte from the single-file HTML; the Air Force module keeps
the desktop integrations (Signal, SQLite, XLSX, backup, profiles). See
[`docs/UNIFIED_FRONTEND.md`](docs/UNIFIED_FRONTEND.md). SQLite is registered with a versioned provenance schema; see
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

Technical macOS (universal DMG, ad-hoc signed) and Windows (MSI + NSIS,
unsigned) installers are built by the `Desktop build` GitHub Actions workflow
and published as workflow artifacts. To save Actions minutes, pull requests and
`main` run only the Linux checks. The installers are built for `vX.Y.Z` release
tags (see `docs/UPDATES.md`) and on demand via **Actions → Desktop build → Run
workflow**.

Application icons are generated from the vector sources in
`src-tauri/icons/source/` with `./script/generate_icons.sh` (full logo for large
sizes, trident-only for 16–48 px, Apple grid variant for macOS).

The Codex `Run` action calls the same script. Use
`./script/build_and_run.sh --verify` for a debug build plus a process check.
On Windows, use `npm run tauri dev` from a supported developer shell.

## Current state

Version 2.0.0. Technical (unsigned / ad-hoc signed) releases are published to the
public `easywar-releases` repository and installed copies update themselves
(see [docs/UPDATES.md](docs/UPDATES.md)). Production distribution remains
**NO-GO** until every mandatory gate in
[docs/RELEASE_CHECKLIST.md](docs/RELEASE_CHECKLIST.md) has direct evidence.

Start here:

- [docs/PROJECT_CONTEXT.md](docs/PROJECT_CONTEXT.md) — what the project is, modules,
  glossary, documentation index (Ukrainian);
- [docs/WORKFLOW.md](docs/WORKFLOW.md) — how to write tasks and how work is done
  (branches, commits, checks, releases);
- [docs/BACKLOG.md](docs/BACKLOG.md) — prioritised work queue;
- [docs/AUDIT_2026-10-13.md](docs/AUDIT_2026-10-13.md) — repository audit;
- [docs/ROADMAP.md](docs/ROADMAP.md) — milestones.

Agent instructions live in `AGENTS.md` (Codex) and `CLAUDE.md` (Claude Code).
