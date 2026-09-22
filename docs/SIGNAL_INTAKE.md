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
- Intake cannot be enabled until an allowlist policy is explicitly configured.
- Records received through Signal can never be approved automatically.
- Credentials, account storage, message content, attachments, and identifiers must never enter Git.

## Not implemented in this step

- daemon process management;
- a live RPC or event-stream connection;
- linked-account setup;
- account or group discovery;
- allowlist contents;
- message ingestion and parsing;
- Signal Inbox persistence or UI.

All tests use synthetic configuration values only.
