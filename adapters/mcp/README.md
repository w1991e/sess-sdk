# SESS MCP server (`@sess.si/mcp`)

A local stdio [MCP](https://modelcontextprotocol.io) server that lets an agent ask a person through
a hosted SESS form and receive a receipt-verified answer. The agent gets the private link
immediately, the person answers on any device, and the agent continues on the same Session.

**Candidate status:** `0.1.0-rc.1` is unpublished, and so is its dependency `@sess.si/sdk@0.1.0-rc.3`.
`npm install @sess.si/mcp` and `npx @sess.si/mcp` do **not** work yet. Everything below marked
_tested_ was run from a packed, installed tarball; everything marked _untested_ is the intended
form after publication. See [compatibility.json](compatibility.json) for the exact tuple.

## From Claude Code or Cursor in 60 seconds

You need Node 24 (qualified on 24.21.0) and a SESS developer API key from
[the SESS developer portal](https://app.sess.si). Keep the key in your environment or your client's
private MCP configuration. Never paste it into a chat or a tool argument.

### Claude Code

_Tested_ (Claude Code 2.1.299 on Linux, Node 24.21.0, `claude mcp add --scope local`, then
`claude mcp list` shows `✔ Connected` and four tools; no model call was made). The tested command
started the installed package's bin, through a byte-forwarding recording proxy, because the
package is not on the registry yet:

```sh
export SESS_API_KEY=...   # in the shell that starts Claude Code
claude mcp add --scope local sess -- node /path/to/node_modules/@sess.si/mcp/dist/bin.js
claude mcp list
```

_Untested_, after publication:

```sh
claude mcp add --scope local sess -- npx -y @sess.si/mcp@0.1.0-rc.1
```

Not yet tested: that a key exported in your shell reaches the server in a real Claude Code
session, and an end-to-end model-driven round through Claude Code. Enterprise-managed Claude Code
installations may forbid adding MCP servers (`enterprise MCP configuration is active`).

### Cursor

_Untested._ Cursor reads `.cursor/mcp.json` (project) or `~/.cursor/mcp.json`:

```json
{
  "mcpServers": {
    "sess": {
      "command": "npx",
      "args": ["-y", "@sess.si/mcp@0.1.0-rc.1"],
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

## Tools (`sess-mcp-tools/1`)

| Tool            | Input                                                             | Result `interaction.state`                         |
| --------------- | ----------------------------------------------------------------- | -------------------------------------------------- |
| `sess_request`  | `interaction`                                                     | `waiting`, with `humanUrl`                         |
| `sess_response` | `handle`, `revision`, optional `wait_ms` (0–45000)                | `waiting`, `needs_resume`, `answered`, `completed` |
| `sess_publish`  | `handle`, `expected_revision`, `response_event_id`, `interaction` | `waiting` at the next revision                     |
| `sess_complete` | `handle`, `expected_revision`, `response_event_id`                | `completed`                                        |

Input schemas are closed: unknown properties, unsafe keys (`__proto__`, `constructor`,
`prototype`), more than 8 levels of nesting, an interaction over 32 KiB, more than 24 fields or 5
actions are rejected, never truncated. `interaction` is the SESS interactive Surface used by
`@sess.si/sdk` (`heading`, `text`, `record` and `field` components). Tools never accept an API
origin, key, workspace, Session ID or callback URL.

Every result is `{ "interaction": { handle, revision, state, humanUrl?, response? } }`, returned as
`structuredContent` and as JSON text. `answered` is returned only after
`client.receipts.verifyResponse` verified the receipt for that exact Session, revision, event and
immutable Surface; `response.verified` is `true` and `response.actorAssurance` is `link_holder`.
Answer data is untrusted human input: validate it before acting on it.

`needs_resume` means the local wait ended (timeout, MCP cancellation or host disconnect) without
any server-side cancellation. A later `sess_response` on the same handle resumes it; it never
creates another Session. Errors are MCP tool errors (`isError: true`) with a stable `code`, for
example `INVALID_ARGUMENTS`, `HANDLE_NOT_FOUND`, `BINDING_MISMATCH`, `CREATE_OUTCOME_UNKNOWN`,
`VERIFICATION_FAILED`, `OUTCOME_UNKNOWN` or `RECOVERY_BLOCKED`.

## Configuration (environment of the server process only)

| Variable                                 | Meaning                                                                                                                |
| ---------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| `SESS_API_KEY`                           | Required. Read on the first tool call, never at startup or from arguments.                                             |
| `SESS_API_ORIGIN`                        | Default `https://api.sess.si`. Another origin must be HTTPS without path, query or credentials.                        |
| `SESS_MCP_PROFILE`                       | Profile name, default `default`.                                                                                       |
| `SESS_MCP_STATE_DIR`                     | Absolute state directory. Default `$XDG_STATE_HOME/sess-mcp`, `~/.local/state/sess-mcp`, or `%LOCALAPPDATA%\sess-mcp`. |
| `SESS_MCP_MAX_WAIT_MS`                   | Lower the 45 000 ms wait ceiling.                                                                                      |
| `SESS_RECEIPT_ISSUER`                    | Receipt issuer if it differs from the API origin.                                                                      |
| `SESS_EXPECTED_WORKSPACE_ID`             | Trusted workspace for a runtime that does not return `Sess-Workspace-Id`.                                              |
| `SESS_MCP_TEST_ALLOW_INSECURE_LOCALHOST` | Testing only: `1` allows `http://localhost`/`127.0.0.1` origins.                                                       |

## Security and support boundary

- **Owner-private, single profile.** stdio carries no authenticated conversation identity, so this
  server does not invent one. Anyone who can call its tools acts for the configured key. Run it only
  for your own private client. Handles are bound to the profile, API origin and a credential
  generation (a keyed digest stored per profile; the key itself is never written). A handle from
  another profile, origin or key is rejected.
- **The human link is a bearer capability.** It is returned only by `sess_request`, to your private
  client. It is never written to stderr diagnostics, which carry only fixed event names and codes.
  Anyone with the link can answer as `link_holder`.
- **Durable local records.** Each handle has a file (mode 0600) written by temp file, fsync, rename
  and directory fsync. The create intent is saved before the create request, and the exact
  publish/complete request (body, `If-Match`, idempotency key) before dispatch. A lost create
  outcome is never retried (`CREATE_OUTCOME_UNKNOWN`); a lost publish/complete outcome is
  reconciled by repeating the identical call, which replays the saved request. `blocked` records
  need owner review; the server never leaves that state on its own. After completion the link
  and answer data are removed from the record. At most 100 unfinished interactions are kept per
  profile.
- **No wake-up.** A wait is one bounded read of at most 45 seconds. The server cannot wake an agent
  after its turn ends; the person asks the agent to continue.
- **Not included:** remote or HTTP transport, a hosted server, MCP Tasks, Apps, elicitation,
  resources or prompts. One server process per profile is supported; concurrent processes on the
  same profile are not coordinated. Rotating the key makes earlier handles unusable
  (`BINDING_MISMATCH`). The browser may still need a manual refresh between rounds.

## Development

The adapter is an independent package with its own lockfile. While `@sess.si/sdk` is unpublished,
`package.json` declares the exact future dependency `0.1.0-rc.3`, and `package-lock.json` resolves it
to a local, gitignored **candidate** tarball `.candidate/sess.si-sdk-0.1.0-rc.3.tgz`. npm does not
enforce lock integrity for `file:` tarballs, so `scripts/sdk-candidate.mjs` accepts the tarball only
if its SHA-256 equals the pinned reviewed candidate (`b4d29d8f…a0502`), which `npm pack` of the SDK
root reproduces. Before release, the genuine registry dependency and lockfile replace this.

```sh
# at the repository root
npm ci --ignore-scripts && npm run build
# in adapters/mcp
npm run candidate:prepare
npm ci --ignore-scripts
npm run check        # candidate digest, build, typecheck, unit tests, packed-consumer check
```

`npm run runtime-round` (opt-in, `SESS_MCP_RUNTIME_ROUND=1`) drives the packed, installed server
through one request → answer → complete round against a local isolated SESS runtime. It is not run
in public CI because the runtime is private. `npm run qualify:claude-code` checks that Claude Code
connects and lists the tools without any model call, using a temporary config directory.

[Apache-2.0](LICENSE)
