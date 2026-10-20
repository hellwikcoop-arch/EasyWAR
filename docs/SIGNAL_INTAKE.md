# Signal intake boundary

This document records the defensive boundary for the EasyWAR Signal adapter. The desktop can make explicit discovery and linking requests and run a user-started bounded receive session against an already running local `signal-cli` HTTP daemon. It does not start `signal-cli`, run a continuous receive service, or approve received records automatically.

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

The Rust adapter also has a bounded receive operation (`receive_bounded`, and
`receive_to_channel`, which streams the same lifecycle to the receive session).
It opens the SSE stream before calling `subscribeReceive`, accepts 1–64 matching
notifications within a caller-supplied timeout, and then calls
`unsubscribeReceive`. The subscription is cancelled after success, timeout,
stream termination, or decoder failure; a failed cleanup is surfaced as a
separate error. Notifications from another subscription or account are not
returned.

The bounded operation is a library function and is not itself a Tauri command.
It does not run continuously, apply the allowlist, or persist content. The only
way to start it from the desktop UI is the explicit receive session described
below, which wraps it in the registered commands `run_signal_receive_session`,
`stop_signal_receive_session` and `get_signal_receive_status` and adds the
allowlist and persistence. Tests use a temporary loopback HTTP server that
verifies the order `events → subscribeReceive → receive → unsubscribeReceive`,
including cleanup after a malformed synthetic event. A production connector
still needs acceptance against an installed local `signal-cli`; the repository
currently proves the bounded lifecycle only against a synthetic loopback
daemon. The adapter does not send a `version` request before
`subscribeReceive`, so an incompatible daemon is detected only by a failing
subscription (backlog P2-4, L9).

## Provenance capture bridge

The Rust layer has a separate, non-command bridge that can accept one already
decoded manual-receive notification. It requires intake to be enabled in a
validated configuration and decides in this order, all before any database
write (`inspect_allowed_notification`):

1. the notification's account must equal the explicitly selected local account
   (`AccountMismatch`);
2. the envelope must be a JSON object (`InvalidEnvelope`);
3. the sender (`sourceUuid`, `sourceNumber` or `source`) must be on the
   allowlist, by exact match; the group is not examined yet. A sender outside
   the allowlist is always `SourceDenied`, even when the rest of the envelope
   is malformed (no timestamp, `groupInfo` that is not an object and so on);
4. only for an allowed sender: an envelope without `dataMessage.message` with
   non-blank text is `NotTextMessage` (delivery receipt, typing, sync,
   reaction, attachment without a caption, empty or whitespace message);
5. a text message needs a numeric `timestamp` and valid `groupInfo`, otherwise
   it is `InvalidEnvelope`;
6. a group message is matched against the group allowlist, otherwise
   `SourceDenied`.

A denied or disabled source writes no rows.

For an allowed synthetic notification, the bridge hashes the complete envelope
and transactionally stores an immutable `SIGNAL` raw source, one `NEW` report,
and its `CAPTURED` audit event. Deterministic hash-based identities make a
repeated identical envelope (the same SHA-256, in this session or an earlier
one) fail at the database uniqueness boundary; `persist_allowed_notification`
reports it as the typed `SignalIngestError::Duplicate`, the transaction rolls
back and the first provenance chain stays unchanged. The raw message and
envelope remain in the local provenance store but are not returned by the
read-only Inbox list. Synthetic tests cover allowed, denied, disabled,
wrong-group, malformed text, duplicate, and non-duplicate database failure
cases.

The bridge is not itself a Tauri command and does not enable the saved desktop
intake flag. It is used only by the explicit bounded session described below.

## Explicit desktop receive session

After discovery, the settings dialog lets the user select one local account and
press **Почати сеанс приймання**. This creates an in-memory, validated session
policy from the saved allowlist without changing the persisted
`intake_enabled: false` setting. Only one session can run at a time. It accepts
at most 64 matching-account notifications for at most five minutes and persists
each allowed notification immediately through the provenance bridge. Sources
outside the allowlist, envelopes without a text message (receipts, typing,
sync, reactions, attachments without a caption) and envelopes that are already
stored are counted as ignored, not stored, and do not terminate the session.
The session summary has one `ignored` counter for all three. Ignored envelopes
still count towards the 64-notification limit, so many service events can end a
session with `limit_reached` before 64 reports are stored. Database errors
(other than a duplicate envelope), a malformed text message from an allowed
sender (no numeric `timestamp`, broken `groupInfo`), an account mismatch and
daemon or protocol failures still end the session after unsubscribing.

The user can press **Зупинити й відписатися**. Stop is delivered to the receive
loop, which calls `unsubscribeReceive` before reporting completion. The same
cleanup is required for the notification limit, timeout, decoder failure, or
a fatal error from the list above. The dialog cannot be dismissed while its session is active and
shows an active receive state instead of the disconnected label. No session is
started on application launch, account discovery, settings save, or Inbox
refresh.

Synthetic tests verify single-session ownership, explicit Stop cleanup, bounded
timeout/limit behavior, ephemeral policy activation, allowlist-gated capture,
and the complete loopback path from SSE notification to a `NEW` SQLite Inbox
record, including a denied notification followed by an allowed one. The
non-fatal and fatal envelope cases are covered at the ingest level: a duplicate
envelope is the typed `Duplicate` and writes nothing, a malformed text message
from an allowed sender is rejected, and a database failure that is not a
duplicate is reported as such and rolled back. The UI and backend are built, but
real daemon/account acceptance remains unverified because `signal-cli` is not
installed in the current environment.

## Commands during an explicit session

An allowed sender can issue one of five exact slash commands while the explicit
bounded session is active: `/help`, `/status`, `/ping`, `/queue`, or `/last`.
Commands with arguments and unknown slash commands receive a one-line Ukrainian
unknown-command reply that points to `/help`. The same account, sender, and group allowlist checks run before a
command is recognized. A denied source receives no reply.

Known limit: the parser treats any message that, after trimming, starts with `/`
as a command. If it is longer than 64 characters, contains a control character
(including a line break) or is not a single word, the reply is that unknown-command line
and the message is not stored. So a report that starts with `/` (for example a
date such as `/12.10 …`) from an allowed sender is answered with the one-line
«Невідома команда EasyWAR. Надішліть /help для переліку команд.» and lost to the
queue; the sender sees the reply, but EasyWAR keeps the raw text
nowhere. If the reply cannot be sent, the session ends with an error. The
proposed rule (a command is a single ASCII token `^/[A-Za-z][A-Za-z0-9_]*$` of
up to 64 characters, everything else is stored as an ordinary report) awaits the
owner's decision (backlog P2-15).

The reply uses the local loopback JSON-RPC `send` method with the selected local
account, an exact single `recipients` entry, and a bounded text body. Even when
the command arrived through an allowed group, EasyWAR replies directly to the
allowed sender instead of posting queue metadata to the group. `/queue` returns
only counts for the five status values. `/last` returns only the capture time and
current status of the latest Signal record. Neither response includes message
content, report/source identifiers, account identifiers, hashes, or attachments.

Command envelopes are control input and are not stored as raw sources or Inbox
reports. A successful reply increments only the in-memory command counter shown
in the session summary. An RPC failure stops the session and still requires
`unsubscribeReceive` before the error is returned. Synthetic loopback tests
cover a denied command, a group-origin command with a direct sender reply, a
normal persisted message, and cleanup after a failed reply. Real-daemon command
acceptance remains unverified together with the receive-session acceptance.

## Inbox review model

The current in-memory model supports `NEW`, `PARSED`, `NEEDS_REVIEW`, `APPROVED`, and `REJECTED`. A new item can be marked parsed or sent directly for review. Approval and rejection are possible only from `NEEDS_REVIEW` and require a nonblank reviewer identifier. Final states cannot be reopened by this model. Each accepted action returns a transition record for a future transactional audit write; no message content is stored by this module. The model does not authenticate a reviewer or provide an approval UI; those checks belong to a later integration step.

The settings dialog includes a separately labelled synthetic Inbox preview. It
starts with two fabricated items, uses an explicit synthetic reviewer for manual
decisions, and resets on reopening. It does not read Signal, persist messages,
or constitute an operational approval UI. The preview's JavaScript transition
rules are regression-tested separately; the Rust review model remains the
source contract for a future persistent implementation.

The dialog also has a separate user-triggered local queue. Its list command
returns at most 100 existing `SIGNAL` provenance records from the application
SQLite database with the report identifier, source item key, source/capture
times, derived status, and stored SHA-256. The list never returns `raw_text` or
`raw_payload_json`; the UI renders metadata only.

Each persisted Inbox row has an explicit **Відкрити у внесенні** action. It is
available only after the user opens a workbook. The action requests raw text
for that exact report identifier through a separate command, and the
repository returns text only when the report is backed by a `SIGNAL` raw
source. Missing and non-Signal identifiers return no content. The UI then
switches to the existing intake tab and invokes a narrow legacy helper that
temporarily disables `S.auto`, runs the existing parser, and restores the prior
setting in `finally`. The helper returns a versioned parser payload with 1–64
records, excluding per-record `srcText` and UI-only `_own`, `_openCause`, `dup`,
and `include` fields. It can populate review cards but cannot automatically
append the Signal
record to the workbook. Raw text is not logged or added to the Inbox list
response.

For an exact `SIGNAL` report, the desktop stores that bounded payload as an
immutable `easywar-legacy-core` parser version and a matching audit event. An
identical latest payload is an idempotent retry; a changed parse is allowed only
while the report is `NEW` or `PARSED`. The raw source is never rewritten. Once
the derived state is `PARSED`, the Inbox exposes an explicit **На ручну
перевірку** action. It atomically appends `NEEDS_REVIEW`, a revision snapshot of
the latest parser payload and its audit event. Repeating the same request adds
no rows.

While a record is `NEEDS_REVIEW`, the Inbox requires a nonblank local reviewer
identifier before exposing an explicit **Схвалити** or **Відхилити** action.
The reviewer first opens that exact report in the existing editable cards. In
this Signal review mode, adding rows to XLSX is disabled. Finalization compares
the edited cards with the pending immutable snapshot, rejects changes to schema
metadata or record count, and accepts at most 256 changed values across the 14
editable/derived record fields. The backend then atomically appends one manual
correction and audit event per changed field, the `APPROVED` or `REJECTED`
decision, and a corrected immutable revision snapshot. An identical retry adds
no rows; an opposite decision or attempt to reopen a final state is rejected.
The reviewer identifier is local provenance and does not authenticate a person.

Synthetic repository tests verify source filtering, the `NEW` to `PARSED` to
`NEEDS_REVIEW` path, exact-retry idempotency, immutable raw text, fixed list
bounds, absence of raw content in the serialized list, and rejection of
non-Signal/missing identifiers and raw/UI fields. This bridge does not write
XLSX rows, capture messages, or prove that a live connector is running.

## Not implemented in this step

- daemon process management;
- a persistent RPC or event-stream receive connection;
- a long-running or automatically restarted receive service;
- account/group discovery over UNIX or raw TCP;
- enabling or connecting a Signal account;
- a `version` check of the daemon before `subscribeReceive` (backlog P2-4, L9);
- storing a report that starts with `/` (backlog P2-15, L8);
- a retention or cleanup path for stored envelopes (`raw_payload_json`, L11);
- live-daemon acceptance of Signal Inbox capture and parsing.

All tests use synthetic configuration values only, including the disconnected
UI-state regression tests.
