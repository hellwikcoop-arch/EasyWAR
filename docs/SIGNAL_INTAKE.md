# Signal intake boundary

This document records the defensive boundary for the future EasyWAR Signal adapter. The current implementation validates configuration only. It does not start `signal-cli`, connect to a daemon, read chats, parse messages, or write Signal content to the database.

## Supported local daemon interfaces

The official `signal-cli` daemon supports three local interfaces:

- UNIX socket (default: `$XDG_RUNTIME_DIR/signal-cli/socket`);
- TCP socket (default: `localhost:7583`);
- HTTP (default: `localhost:8080`).

The HTTP interface exposes:

- JSON-RPC: `/api/v1/rpc`;
- event stream: `/api/v1/events`;
- health check: `/api/v1/check`.

References:

- <https://github.com/AsamK/signal-cli/blob/master/man/signal-cli.1.adoc>
- <https://github.com/AsamK/signal-cli/blob/master/man/signal-cli-jsonrpc.5.adoc>

## EasyWAR defaults

- The adapter is disabled by default.
- TCP and HTTP endpoints must resolve to an IP loopback address.
- A UNIX socket must use an absolute path without parent traversal.
- `signal-cli` receive mode must be `manual`.
- Intake cannot be enabled without at least one explicitly listed sender. Group messages require both a listed sender and a listed group. Matches are exact; empty IDs and wildcards are rejected.
- Records received through Signal can never be approved automatically.
- Credentials, account storage, message content, attachments, and real identifiers must never enter Git.

## Local configuration storage

The Rust settings store saves a versioned `signal.adapter.v1` JSON setting in the application-local SQLite database. Tauri commands expose validated read and write operations to the desktop window; the window has no direct SQL plugin permission. With no saved setting, intake remains disabled. Saving validates the endpoint, receive mode, allowlist, and approval policy; loading validates them again. Invalid or unknown-version settings fail closed. Real allowlist identifiers are local application data and must not be committed or copied into test fixtures.

The desktop window offers a Ukrainian allowlist form. It reads the local setting and saves sender/group IDs through the validated Rust command. The command itself rejects any attempt to enable intake, even if a caller bypasses the form and supplies an otherwise valid allowlist. Saving from this form keeps intake disabled and never contacts Signal. The same form reports validation or storage errors without silently changing the setting.

The toolbar and settings dialog explicitly say that EasyWAR is not connected
and receives no Signal messages. This is a statement about the current app
implementation, not a live health check of `signal-cli`. A saved configuration
with `intake_enabled: true` still cannot make the desktop connector active.

## Inbox review model

The current in-memory model supports `NEW`, `PARSED`, `NEEDS_REVIEW`, `APPROVED`, and `REJECTED`. A new item can be marked parsed or sent directly for review. Approval and rejection are possible only from `NEEDS_REVIEW` and require a nonblank reviewer identifier. Final states cannot be reopened by this model. Each accepted action returns a transition record for a future transactional audit write; no message content is stored by this module. The model does not authenticate a reviewer or provide an approval UI; those checks belong to a later integration step.

The settings dialog includes a separately labelled synthetic Inbox preview. It
starts with two fabricated items, uses an explicit synthetic reviewer for manual
decisions, and resets on reopening. It does not read Signal, persist messages,
or constitute an operational approval UI. The preview's JavaScript transition
rules are regression-tested separately; the Rust review model remains the
source contract for a future persistent implementation.

## Not implemented in this step

- daemon process management;
- a live RPC or event-stream connection;
- linked-account setup;
- account or group discovery;
- enabling or connecting a Signal account;
- message ingestion and parsing;
- Signal Inbox persistence or a UI for real messages.

All tests use synthetic configuration values only, including the disconnected
UI-state regression tests.
