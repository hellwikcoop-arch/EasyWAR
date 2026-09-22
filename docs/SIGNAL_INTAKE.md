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

## Inbox review model

The current in-memory model supports `NEW`, `PARSED`, `NEEDS_REVIEW`, `APPROVED`, and `REJECTED`. A new item can be marked parsed or sent directly for review. Approval and rejection are possible only from `NEEDS_REVIEW` and require a nonblank reviewer identifier. Final states cannot be reopened by this model. Each accepted action returns a transition record for a future transactional audit write; no message content is stored by this module. The model does not authenticate a reviewer or provide an approval UI; those checks belong to a later integration step.

## Not implemented in this step

- daemon process management;
- a live RPC or event-stream connection;
- linked-account setup;
- account or group discovery;
- local allowlist management and persistence;
- message ingestion and parsing;
- Signal Inbox persistence or UI.

All tests use synthetic configuration values only.
