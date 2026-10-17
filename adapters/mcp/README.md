# SESS MCP server (`@sess.si/mcp`)

A local stdio [MCP](https://modelcontextprotocol.io) server that lets an agent ask a person through
a hosted SESS form and receive a receipt-verified answer. The agent gets the private link
immediately, the person answers on any device, and the agent continues on the same Session.

**Candidate status:** `@sess.si/mcp@0.1.0-rc.1` is a release candidate. Release candidates are
published only under the npm dist-tag `next`, after a maintainer approves the publication with npm
2FA. Do not install the bare name: its `latest` dist-tag points at a `0.0.0-stage` placeholder,
not at a release. Its SDK dependency, `@sess.si/sdk@0.1.0-rc.5`, is published on npm (dist-tag
`next`) and installs from the registry. Everything below marked _tested_ was run from a packed,
installed tarball; everything marked _untested_ is the intended registry form. See
[compatibility.json](compatibility.json) for the exact tuple.

## Set up with Claude Code (connection tested) or Cursor (untested)

You need Node 22.14 or later on 22.x, or Node 24 (qualified on 22.14.0 and 24.21.0), and a SESS
developer API key from [the SESS developer portal](https://app.sess.si). Never paste the key into
a chat or a tool argument, and never commit it.

### Claude Code

Tested with Claude Code 2.1.299 on Linux (Node 24.21.0), using `claude mcp add --scope local`
and `claude mcp list`, which showed `✔ Connected`. No model call was made. Because the package was
not on the registry when tested, the tests ran from a project directory where the packed tarballs
were installed, so `npx --no-install sess-mcp` resolved the installed bin.

**Preferred: keep the key in your environment.** Export it in the shell that starts Claude Code.
In the test, a key exported this way reached the server process and was not written to Claude
Code's configuration.

```sh
export SESS_API_KEY=<your-key>        # e.g. from your password manager; not in shell history files you share
claude mcp add --scope local sess -- npx --no-install sess-mcp     # tested (installed package)
claude mcp list
```

**Alternative: pass it with `-e`.** The server name must come **before** `-e`; in 2.1.299 the form
`claude mcp add -e SESS_API_KEY=… sess -- …` fails with "Invalid environment variable format".
Claude Code stores `-e` values **in plain text** in its configuration (`.claude.json` in its config
directory), so prefer the environment form on shared machines.

```sh
claude mcp add --scope local sess -e SESS_API_KEY=<your-key> -- npx --no-install sess-mcp   # tested (installed package)
```

After publication, the intended form is _untested_:

```sh
claude mcp add --scope local sess -- npx -y @sess.si/mcp@<version>
```

Not yet tested: the registry `npx -y @sess.si/mcp@<version>` form,
environment inheritance when an interactive Claude Code session starts the server (it was observed
for the `claude mcp list` health check), and a model-driven round through Claude Code.
Enterprise-managed Claude Code installations may forbid adding MCP servers
(`enterprise MCP configuration is active`).

### Cursor

_Untested._ Cursor reads `.cursor/mcp.json` (project) or `~/.cursor/mcp.json`:

```json
{
  "mcpServers": {
    "sess": {
      "command": "npx",
      "args": ["-y", "@sess.si/mcp@<version>"],
      "env": { "SESS_API_KEY": "${env:SESS_API_KEY}" }
    }
  }
}
```

### First interaction

Ask your agent something like: "Use SESS to ask me what I want to do this afternoon." It calls
`sess_request`, shows you a private link, then calls `sess_response`. Open the link, submit the
form, and the agent receives your verified answer. If you are slower than its 45-second wait, it
tells you the form is still open; submit it and ask the agent to continue.

## Tools (`sess-mcp-tools/2`)

| Tool            | Input                                                             | Result `interaction.state`                         |
| --------------- | ----------------------------------------------------------------- | -------------------------------------------------- |
| `sess_request`  | `interaction`                                                     | `waiting`, with `humanUrl`                         |
| `sess_response` | `handle`, `revision`, optional `wait_ms` (0–45000)                | `waiting`, `needs_resume`, `answered`, `completed` |
| `sess_publish`  | `handle`, `expected_revision`, `response_event_id`, `interaction` | `waiting` at the next revision                     |
| `sess_complete` | `handle`, `expected_revision`, `response_event_id`                | `completed`                                        |
| `sess_ask`      | `question`, `fields` (1–12), optional `details`, `submit_label`   | `waiting`, with `humanUrl`                         |

`sess_ask` is a shortcut for `sess_request`: it turns a question and up to 12 simple fields
(`text`, `number`, `integer`, `boolean`, `choice`, `multi_choice`) into an ordinary interaction,
checks it with the same rules and limits, and runs the same request operation. It creates exactly
one Session, returns the link and handle at once, never waits and never returns an answer. Continue
with `sess_response`, `sess_publish` and `sess_complete` as usual.

Input schemas are closed: unknown properties, unsafe keys (`__proto__`, `constructor`,
`prototype`), more than 8 levels of nesting, an interaction over 32 KiB, more than 24 fields or 5
actions are rejected, never truncated. `interaction` is the SESS interactive Surface used by
`@sess.si/sdk` (`heading`, `text`, `record` and `field` components). Tools never accept an API
origin, key, workspace, Session ID or callback URL.

Every result is `{ "interaction": { handle, revision, state, humanUrl?, response? } }`, returned as
`structuredContent` and as JSON text. `answered` is returned only after
`client.receipts.verifyResponse` verified the receipt for that exact Session, revision, event and
immutable Surface; `response.verified` is `true` and `response.actorAssurance` is `link_holder`.
Receipt verification proves a retained historical answer, not that it is still the current step,
so after verification the server makes one more authenticated read and releases the answer only if
the Session is still at that revision with that answer (or completed at that same revision). A
saved `answered` result is re-confirmed the same way on every `sess_response`. If that read
fails, the call returns `SESS_UNAVAILABLE` and changes nothing; if the Session has moved on, the
interaction is blocked (`RECOVERY_BLOCKED`), or a conflict is reported when another local call
changed it first. A response that the SDK itself rejects while decoding (for example a lower
revision that still lists later answers, or an `active` Session that already has an answer at its
revision) is reported as `SESS_PROTOCOL_ERROR`: it fails closed, is not retryable and changes no
state, rather than blocking the interaction. No answer data is released in any of these cases.
This checks progress at the moment of release; it cannot make a later remote change impossible.
Answer data is untrusted human input: validate it before acting on it.

`needs_resume` means the local wait ended (timeout, MCP cancellation or host disconnect) without
any server-side cancellation. A later `sess_response` on the same handle resumes it; it never
creates another Session. Errors are MCP tool errors (`isError: true`) with a stable `code`, for
example `INVALID_ARGUMENTS`, `HANDLE_NOT_FOUND`, `BINDING_MISMATCH`, `CREATE_OUTCOME_UNKNOWN`,
`VERIFICATION_FAILED`, `OUTCOME_UNKNOWN` or `RECOVERY_BLOCKED`.

### Error classes

Codes map to the shared adapter error classes (`adapters/CONTRACT.md`, "Error classes"):

| Code                                                                                                      | Class                           | Retry?                                                                                                                                                |
| --------------------------------------------------------------------------------------------------------- | ------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| `INVALID_ARGUMENTS`                                                                                       | `invalid_arguments`             | Fix the arguments                                                                                                                                     |
| `HANDLE_NOT_FOUND`, `BINDING_MISMATCH`                                                                    | `not_found`                     | No (other profile, origin or key)                                                                                                                     |
| `REVISION_MISMATCH`, `RESPONSE_MISMATCH`, `PENDING_MUTATION_DIFFERS`, `MUTATION_PENDING`, `INVALID_STATE` | `conflict`                      | Follow the message; nothing was sent                                                                                                                  |
| `CREATE_REJECTED`                                                                                         | `create_rejected`               | No; no Session exists                                                                                                                                 |
| `CREATE_OUTCOME_UNKNOWN`                                                                                  | `create_unknown`                | No; owner resolution                                                                                                                                  |
| `CREATED_NOT_SAVED`                                                                                       | `created_not_saved`             | No; a Session exists                                                                                                                                  |
| `OUTCOME_UNKNOWN`                                                                                         | `outcome_unknown`               | Yes, repeat the identical call                                                                                                                        |
| `MUTATION_REJECTED`                                                                                       | `mutation_rejected` (blocked)   | No; owner resolution                                                                                                                                  |
| `VERIFICATION_FAILED`                                                                                     | `verification_failed` (blocked) | No; owner resolution                                                                                                                                  |
| `RECOVERY_BLOCKED`                                                                                        | `blocked`                       | No; owner resolution                                                                                                                                  |
| `SESS_UNAVAILABLE`                                                                                        | `unavailable`                   | Yes, later; nothing changed                                                                                                                           |
| `NOT_CONFIGURED`, `SESS_PROTOCOL_ERROR`                                                                   | `configuration`                 | After the owner fixes the configuration                                                                                                               |
| `STATE_STORE_ERROR`, `STATE_STORE_FULL`                                                                   | `store`                         | Only if `retryable` is true (a transient read/write failure); unreadable, inconsistent or unsupported-version records and a full store need the owner |

Receipt verification is classified by the shared core (`src/internal/shared.ts`, a byte-identical
copy of `adapters/shared/core.ts`): a key-set fetch failure or refresh cooldown is
`SESS_UNAVAILABLE`; a missing trusted workspace (`VERIFICATION_CONTEXT_MISSING`) is
`NOT_CONFIGURED` naming `SESS_EXPECTED_WORKSPACE_ID`. Neither records anything or changes state.
Every other verification failure blocks. Other SDK errors while reading, waiting or verifying
change nothing: `api`, `transport`, `timeout` and `unknown_outcome` are retryable
`SESS_UNAVAILABLE`; `aborted` ends the wait as `needs_resume`; `configuration` (`NOT_CONFIGURED`)
and `protocol` (`SESS_PROTOCOL_ERROR`) are not retryable. A saved publish/complete that the SDK
refuses to send because of its own deterministic checks (`not_sent` with kind `configuration`)
blocks like a definitive rejection.

## Configuration (environment of the server process only)

| Variable                                 | Meaning                                                                                                                                           |
| ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| `SESS_API_KEY`                           | Required. Read on the first tool call, never at startup or from arguments.                                                                        |
| `SESS_API_ORIGIN`                        | Default `https://api.sess.si`. Another origin must be HTTPS without path, query or credentials.                                                   |
| `SESS_MCP_PROFILE`                       | Profile name, default `default`.                                                                                                                  |
| `SESS_MCP_STATE_DIR`                     | Absolute state directory. Default `$XDG_STATE_HOME/sess-mcp`, `~/.local/state/sess-mcp`, or `%LOCALAPPDATA%\sess-mcp` (Windows is not qualified). |
| `SESS_MCP_MAX_WAIT_MS`                   | Lower the 45 000 ms wait ceiling.                                                                                                                 |
| `SESS_RECEIPT_ISSUER`                    | Receipt issuer if it differs from the API origin.                                                                                                 |
| `SESS_EXPECTED_WORKSPACE_ID`             | Trusted workspace for a runtime that does not return `Sess-Workspace-Id`.                                                                         |
| `SESS_MCP_TEST_ALLOW_INSECURE_LOCALHOST` | Testing only: `1` allows `http://localhost`, `127.0.0.1` or `[::1]` origins.                                                                      |

## Security and support boundary

- **Owner-private, single profile.** stdio carries no authenticated conversation identity, so this
  server does not invent one. Anyone who can call its tools acts for the configured key. Run it only
  for your own private client. Handles are bound to the profile, API origin and a credential
  generation (a keyed digest stored per profile; the key itself is never written). A handle from
  another profile, origin or key is rejected.
- **The human link is a bearer capability.** It is returned only by `sess_request` (or its shortcut `sess_ask`), to your private
  client. It is never written to stderr diagnostics, which carry only fixed event names and codes.
  Anyone with the link can answer as `link_holder`.
- **Durable local records.** Each handle has a file (mode 0600) written by temp file, fsync, rename
  and directory fsync. The create intent is saved before the create request, and the exact
  publish/complete request (body, `If-Match`, idempotency key) before dispatch. A lost create
  outcome is never retried (`CREATE_OUTCOME_UNKNOWN`); a lost publish/complete outcome is
  reconciled by repeating the identical call, which replays the saved request. A replay of an
  already confirmed publish or complete succeeds only with the identical expected revision and
  body; anything else is refused without a request. A deterministic rejection (for example a
  conflict or validation error) moves the record to `blocked`. `blocked` and `create_unknown`
  records need owner review; the server never leaves those states on its own (see below). If a
  confirmed create cannot be saved locally, `CREATED_NOT_SAVED` says not to repeat the request.
  After completion the link
  and answer data are removed from the record. At most 100 unfinished interactions are kept per
  profile.
- **No wake-up.** A wait is one bounded read of at most 45 seconds. The server cannot wake an agent
  after its turn ends; the person asks the agent to continue.
- **Not included:** an HTTP server or bin flag, a hosted server, OAuth, MCP Tasks, Apps,
  elicitation, resources or prompts (the HTTP composition below is a library for a hosting
  runtime, not a runnable server). One server process per profile is supported; concurrent processes on the
  same profile are not coordinated. Rotating the key makes earlier handles unusable
  (`BINDING_MISMATCH`). The browser may still need a manual refresh between rounds.
- **Receipt-key rotation window.** The SDK refreshes its cached receipt key set at most once per
  10 seconds. If SESS starts signing with a new key and an answer signed with it is verified
  within 10 seconds of this server's previous key-set fetch, the SDK reports `UNKNOWN_KEY_ID`, and
  the interaction is blocked (`VERIFICATION_FAILED`) even though the answer may be valid. Use the
  owner procedure below; fixing this needs an SDK change.

## HTTP composition (library for a hosting runtime; not a deployed endpoint)

`@sess.si/mcp/http` exports `createSessMcpHttpHandler(options)`, a stateless Streamable HTTP
handler for the same five tools. It is built on `createMcpHandler` from
`@modelcontextprotocol/server` with its default stateless legacy fallback, so one endpoint serves
2026-07-28 clients and 2025-era clients (`initialize` answers `2025-11-25`; no session ID). Each
request gets a fresh server and adapter. Nothing in this package starts a listener; the hosting
runtime mounts `handler.fetch` (web-standard) or `handler.node` (`node:http`).

The hosting runtime supplies the authority; this package never decides it:

- `authenticate(request)` (required) sees the method, URL and headers, verifies the request's
  credentials and returns a principal context: `workspaceId`, `principalId`, `clientId`,
  `grantId`, `grantGeneration`, `scopes` and a `credential()` provider for SESS API calls. If it
  returns nothing, the answer is `401` with `WWW-Authenticate: Bearer resource_metadata="…"`; a
  principal without every `requiredScopes` entry gets `403 insufficient_scope`. The handler
  never derives `authInfo` from headers and never sends the MCP bearer token to SESS or to a tool.
- `handleStore(binding, principal)` (required) returns a handle store bound to that authority.
  Handles are bound to origin, workspace, principal, client, grant and grant generation: another
  principal, host or workspace gets `HANDLE_NOT_FOUND`; a revoked or re-issued grant (new
  generation) gets `BINDING_MISMATCH`; a token refresh (same generation) keeps the handles. The
  operations re-check every loaded record, whatever the store does. The durable hosted store is
  not in this package.

In front of the SDK entry, in this order on both faces:

1. A header-only preflight before any body byte is read: the `Host` allowlist (required), an
   exact `Origin` allowlist (requests without `Origin`, as non-browser clients send them, are
   accepted), then exactly one `authenticate` call and the scope check. A rejection is answered
   at once, even while the client is still sending; the Node face then closes the connection.
2. A bounded body (default 256 KiB: a larger declared `Content-Length` or streamed body gets
   `413`; non-JSON gets `415` from the SDK) read under the request deadline.
3. The raw-body unsafe-key guard, answered in the request's protocol era.

The deadline (`requestTimeoutMs`, default 60 s) is absolute from the moment the request enters
the handler. A body that has not arrived by then gets `408` and reading stops (the Node face
closes the connection); an `authenticate` hook that has not answered gets `503`. During tool
execution the same deadline ends an in-flight `sess_response` wait as `needs_resume`; a create,
publish or complete already sent is never abandoned mid-flight. The timer is cleared when the
response completes or fails, or when the client disconnects. The human link is returned to the
agent in the tool result exactly as over stdio and never appears in diagnostics.

## Resolving a blocked or unconfirmed interaction (owner procedure)

The tool error names the state (`RECOVERY_BLOCKED` with a reason, `CREATE_OUTCOME_UNKNOWN` or
`CREATED_NOT_SAVED`). The server never repairs these records itself.

1. Find the record: `<state dir>/profiles/<profile>/handles/<handle>.json`. It can contain the
   private human link and answer data; do not paste it into chats or issues.
2. Check the Session in SESS (developer portal or an owner API read using `sessionId` from the
   record, when present). For `create_intent`/`create_unknown`/`CREATED_NOT_SAVED`, look for a
   Session created at that time before asking the agent to create another one.
3. Decide in SESS what should happen to the Session, then remove the local record file to retire
   the handle. Keep a private copy if you need the evidence. There is no command that resumes a
   blocked handle in this version; start a new interaction with `sess_request` if needed.

## Development

The adapter is an independent package with its own lockfile. `package.json` always declares the
exact SDK version from the repository's single pin, `release/sdk-candidate.json` (name, version,
filename, SHA-256, SHA-512). `package-lock.json` is a maintainer file only; npm never ships it to
consumers. The lock resolves the SDK to the genuine npm registry tarball
(`https://registry.npmjs.org/@sess.si/sdk/-/sdk-0.1.0-rc.5.tgz`, dist-tag `next`) with the pinned
integrity, so no local SDK build or pack is needed. `compatibility.json` mirrors the pin;
`npm run pin:update` at the root keeps both, the lockfile and the dependency in step after a
deliberate change, and the root `npm run check` fails on drift.

```sh
cd adapters/mcp
npm run setup    # npm ci from the registry; refuses a lock that is not the registry SDK
npm run check    # SDK identity and digests, build, typecheck, unit tests, packed-consumer check
```

`npm run check` starts with `npm run sdk:verify`: the lock and the installed SDK must be the
registry tarball with the pinned integrity, and the registry tarball is read again and its SHA-256
and SHA-512 compared with the pin. Packed and loopback installs of `@sess.si/mcp` itself are
candidate evidence; they do not qualify a public registry install of the adapter.

### A future, not yet published SDK pin

The digest-gated candidate path is kept only for a pin that is not on npm yet:
`npm run candidate:prepare` packs the repository root with `scripts/sdk-pin.mjs pack` and accepts
the tarball into the gitignored `.candidate/` only if its digests equal the pin (npm does not
enforce lock integrity for `file:` tarballs), and `npm run candidate:verify` accepts either mode.
`npm run setup`, `npm run check`, CI and releases refuse candidate mode. Once that pin is published:

```sh
npm run sdk:switch-to-registry            # dry run: confirms the registry integrity equals the pinned one
npm run sdk:switch-to-registry -- --apply # npm install --save-exact, lock check, re-download + SHA-256 check
npm run check
```

`--apply` runs `npm install --save-exact --ignore-scripts @sess.si/sdk@<pinned version>`, requires
the regenerated lock entry to be the registry tarball with the pinned integrity, downloads the
published tarball again and compares its SHA-256 with the pin, and records the published status in
`compatibility.json`. It refuses any other bytes. Review and commit the lockfile change.

`npm run runtime-round` (opt-in, `SESS_MCP_RUNTIME_ROUND=1`) drives the packed, installed server
through one request → answer → complete round against a local isolated SESS runtime. It is not run
in public CI because the runtime is private. `npm run qualify:claude-code` checks that Claude Code
connects and lists the tools without any model call, using a temporary config directory.

[Apache-2.0](LICENSE)
