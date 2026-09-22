# Signal intake boundary

This document records the defensive boundary for the EasyWAR Signal adapter. The desktop can now make an explicit, read-only discovery request to an already running local `signal-cli` HTTP daemon. It does not start `signal-cli`, subscribe to messages, parse chats, or write Signal content to the database.

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

The same dialog has separate, user-triggered discovery buttons. They use the saved, validated HTTP loopback endpoint to call `listAccounts` and then `listGroups` for a chosen local account. The daemon must be running in multi-account mode so these calls have a defined account identity. Discovery sends no `subscribeReceive`, `startLink`, `finishLink`, or `send` request. The adapter disables HTTP redirects and proxies, caps each response at 1 MiB, and uses a request timeout. Returned account and group identifiers are shown locally only; discovery does not add them to the allowlist or persist them. UNIX and raw TCP transports remain configuration-only and return an explicit unsupported-transport error for discovery.

## Linked-device setup

The user can explicitly start a linked-device flow against the same validated HTTP loopback daemon. EasyWAR calls `startLink`, validates the returned `sgnl://linkdevice` URI, renders it locally as a QR code from a bundled dependency, and immediately calls `finishLink` with a locally entered device name. The finish request waits for the primary phone for at most two minutes. The setup window cannot be dismissed while that wait is active, so it does not imply that a request was cancelled when it was not.

The link URI is kept only in the live JavaScript/Rust request path. It is never written to SQLite, application settings, logs, documentation, fixtures, or Git, and the canvas plus in-memory reference are cleared after success, error, timeout, or dialog close. The returned account identity is shown for the current dialog session only. Linking does not enable intake, change the allowlist, subscribe to messages, or approve any record. Synthetic tests exercise `startLink`/`finishLink` against a temporary loopback server; acceptance with an installed real `signal-cli` remains unverified.

The toolbar and settings dialog say that EasyWAR is not continuously connected
and receives no Signal messages. A successful explicit discovery is a one-shot
daemon check, not an active intake connection. A saved configuration with
`intake_enabled: true` still cannot make the desktop connector receive messages.

## Event-stream foundation

The Rust adapter has a bounded decoder for the official HTTP
`/api/v1/events` Server-Sent Events framing. It accepts only JSON-RPC
`receive` notifications in the manual-subscription shape: a numeric
subscription identifier, an explicit local account, and an object-valued raw
envelope. Automatic-mode notifications, malformed JSON-RPC messages, invalid
accounts, and events larger than 1 MiB are rejected.

This decoder currently has no network loop and is not registered as a Tauri
command. It does not open the event endpoint, call `subscribeReceive`, consume
messages, apply the allowlist, or persist content. Tests feed fragmented and
multi-event synthetic SSE byte streams directly into the decoder. A managed
connection must open the SSE stream before subscribing, guarantee
unsubscribe/cleanup, and preserve raw input before the live connector can be
marked complete.

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
- a persistent RPC or event-stream receive connection;
- subscribe/unsubscribe lifecycle management;
- account/group discovery over UNIX or raw TCP;
- enabling or connecting a Signal account;
- message ingestion and parsing;
- Signal Inbox persistence or a UI for real messages.

All tests use synthetic configuration values only, including the disconnected
UI-state regression tests.
