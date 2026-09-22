# EasyWAR architecture

## 1. Objective

Turn the proven single-file EasyWAR application into a maintainable local-first desktop product without discarding its verified parsing and analytics behavior.

## 2. Target architecture

```text
                 ┌────────────────────┐
Signal ─────────▶│ Signal adapter      │
Paste ──────────▶│ Intake adapters     │
XLSX ───────────▶│                    │
                 └─────────┬──────────┘
                           ▼
                 ┌────────────────────┐
                 │ Intake / Parser     │
                 │ deterministic rules│
                 └─────────┬──────────┘
                           ▼
                 ┌────────────────────┐
                 │ Review workflow     │
                 │ NEW / PARSED /      │
                 │ NEEDS_REVIEW /      │
                 │ APPROVED / REJECTED │
                 └─────────┬──────────┘
                           ▼
┌──────────────────────────────────────────────────┐
│ Tauri 2 application core                        │
│ Rust commands · services · integration boundary │
└──────────────────────┬───────────────────────────┘
                       ▼
                 ┌──────────────┐
                 │ SQLite       │
                 │ migrations   │
                 │ audit trail  │
                 └──────┬───────┘
                        ▼
            ┌──────────────────────┐
            │ Existing Web UI      │
            │ HTML/CSS/JS initially│
            │ dashboard + intake   │
            └──────────────────────┘
```

## 3. Platform strategy

### Desktop
- Tauri 2 as the cross-platform shell.
- macOS and Windows are first-class targets.
- The current HTML/CSS/JavaScript UI is embedded first; framework migration is optional and must be justified by product need.

### macOS-specific work
Use native macOS/Swift tooling only for functionality that cannot be expressed cleanly through the shared desktop core.

## 4. Persistence

SQLite is the application store.

Initial logical domains:
- `reports`
- `targets`
- `platforms`
- `munitions`
- `units`
- `signal_messages`
- `attachments`
- `manual_reviews`
- `revision_history`
- `audit_log`
- `settings`

Schema details are versioned through migrations.

## 5. Data provenance

Every intake item carries provenance.

Required concepts:
- immutable raw source
- source type
- source timestamp
- parser version
- parsed payload
- manual overrides
- approval status
- audit timestamps

Do not merge raw, parsed and approved values into one destructive mutable blob.

## 6. Signal integration

Signal is an intake transport, not the database.

```text
Signal
  ↓
signal-cli daemon (localhost)
  ↓ JSON-RPC / event stream
EasyWAR Signal Adapter
  ↓
allowlist / group rules
  ↓
Signal Inbox
  ↓
Parser
  ↓
Human review
  ↓
Approved record
```

Default posture:
- localhost only;
- deny unless an allowed source/group is configured;
- no automatic approval of operational records;
- credentials and Signal storage never enter Git.

## 7. XLSX compatibility

XLSX remains an import/export and migration boundary because existing workflows depend on it.

The desktop database becomes the durable application model, but compatibility with the existing `Зведена` sheet must be preserved during transition.

## 8. Integration boundary

Optional adapters may include:
- Signal
- Google Drive backup/export
- OpenAI-assisted parsing or summarization
- other approved sources

Adapters are disabled by default when they can transmit source data outside the device.

## 9. Testing

Use synthetic fixtures only.

Required gates by layer:
- parser regression suite;
- schema/migration tests;
- adapter contract tests;
- desktop build verification;
- UI smoke tests;
- data-provenance invariants;
- no-network tests for local-only workflows.
