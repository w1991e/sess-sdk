# Sess MCP server (`@sess.si/mcp`)

Let your agent ask a person and continue with their answer.

**Install:** add `https://mcp.sess.si/mcp` to your agent as an MCP server, and sign in to Sess when it asks.

**Run:** ask your agent "Ask me on my phone what time works for a call tomorrow, using Sess."

**You'll see** a Sess link in the reply: open it on your phone, answer, and your agent carries on with your answer.

## Claude Code

Run this in your terminal:

```sh
claude mcp add --transport http sess https://mcp.sess.si/mcp
```

Claude Code opens Sess in your browser. Sign in and choose Allow.

Or run it on your machine. Put your Sess API key in `SESS_API_KEY` (from your Sess account, under API
keys), run this, then start Claude Code from that same terminal. Never paste the key into a chat.

```sh
claude mcp add --scope local sess -- npx -y @sess.si/mcp@0.3.0
```

## claude.ai

In Claude, open Customize, then Connectors, choose Add custom connector and paste:

```text
https://mcp.sess.si/mcp
```

Claude opens Sess. Sign in and choose Allow.

## ChatGPT

In ChatGPT, open Plugins, choose Add custom MCP server and paste:

```text
https://mcp.sess.si/mcp
```

ChatGPT opens Sess. Sign in and choose Allow. Some ChatGPT plans allow only tools that read. Sess
creates a link for you, so your plan needs to allow tools that make changes.

## Grok

### Grok Build: remote MCP

Run this in your terminal:

```sh
grok mcp add --transport http sess https://mcp.sess.si/mcp
```

Sign in to Sess when Grok Build asks, and choose Allow.

_If it doesn't ask, type /mcps, select sess and press i._

Paste this into Grok Build:

```text
Ask me on my phone what time works for a call tomorrow, using Sess.
```

Grok Build asks before it uses each Sess tool. Choose Always allow.

### grok.com: Connectors

On grok.com/connectors, choose New Connector, then Custom, and enter:

```text
https://mcp.sess.si/mcp
```

Sign in to Sess when Grok asks, and choose Allow.

## Cursor

Paste this into Cursor's mcp.json (`.cursor/mcp.json` in a project, or `~/.cursor/mcp.json`):

```json
{
  "mcpServers": {
    "sess": { "url": "https://mcp.sess.si/mcp" }
  }
}
```

Cursor opens Sess in your browser. Sign in and choose Allow.

Or run it on your machine. Put your Sess API key in `SESS_API_KEY` (from your Sess account, under API
keys), then use this entry instead. Never paste the key into a chat.

```json
{
  "mcpServers": {
    "sess": {
      "command": "npx",
      "args": ["-y", "@sess.si/mcp@0.3.0"],
      "env": { "SESS_API_KEY": "${env:SESS_API_KEY}" }
    }
  }
}
```

## Antigravity

Put your Sess API key in `SESS_API_KEY` (from your Sess account, under API keys), then run this in
your terminal:

```sh
agy mcp add sess npx -y @sess.si/mcp@0.3.0
```

Antigravity asks before it uses a Sess tool, usually once or twice the first time. Choose Allow,
or Always allow if you'd rather not be asked again. Never paste the key into a chat. Sign in to
Antigravity with your Google account, or use a Gemini API key.

## OpenClaw

Sess asks you through your Claw. The agent gets four tools and uses them only when a decision is
yours. OpenClaw uses the Sess plugin, `@sess.si/openclaw`, rather than this server.

1. **Install.** OpenClaw warns that the package comes from npm, not ClawHub. That is expected: Sess
   is published on npm with a signed build. Answer `y`.

   ```sh
   openclaw plugins install npm:@sess.si/openclaw@0.1.0 --no-enable
   openclaw sess setup --yes
   ```

2. **Give the Gateway your key.** It reads the key from its own environment file. Sess never stores
   it. The first line waits for you to paste the key and press Enter; nothing shows on screen.

   ```sh
   read -rs K && printf 'SESS_API_KEY=%s\n' "$K" >> ~/.openclaw/.env && unset K && chmod 600 ~/.openclaw/.env
   openclaw gateway restart
   ```

3. **Ask.** In any chat, say something like: _Plan my weekend and check with me through Sess before
   you decide._ Your Claw sends you a Sess link. Answer it on any device, then tell the chat to
   continue. The answer it uses is verified.

**Check:** `openclaw sess doctor` shows the setup without contacting Sess or printing your key.

## Cline

In Cline, open **MCP Servers**, then **Configure MCP Servers**, and add this to
`cline_mcp_settings.json`:

```json
{
  "mcpServers": {
    "sess": {
      "type": "streamableHttp",
      "url": "https://mcp.sess.si/mcp"
    }
  }
}
```

When Cline connects, sign in to your Sess account in the browser. No key goes in the file.

Or run it on your machine with this entry instead. Type your Sess API key (from your Sess account,
under API keys) into the file yourself, in place of `your Sess API key`. Never paste the key into a
chat.

```json
{
  "mcpServers": {
    "sess": {
      "command": "npx",
      "args": ["-y", "@sess.si/mcp@0.3.0"],
      "env": { "SESS_API_KEY": "your Sess API key" }
    }
  }
}
```

## Your own agent

Connect your MCP client to the hosted server over Streamable HTTP. It signs in with your Sess
account.

```text
https://mcp.sess.si/mcp
```

Or add this as a local MCP server in your agent:

```sh
npx -y @sess.si/mcp@0.3.0
```

Your agent asks before it starts the server. The server reads your Sess API key from the
`SESS_API_KEY` environment variable; never paste it into a chat.

No MCP? [Add Sess to your agent](https://docs.sess.si/add-to-your-agent/) shows a tool and handler
on the Sess SDK for an agent you build on a model API.

## First interaction: approve before acting

Have your agent check with you before it commits a change or sends a reply. Ask it something like:

> "Before you commit, use Sess to show me what changed and the commit message. Wait for my
> approval and commit with the message I approve."

The agent calls `sess_request` and shows you a Sess link at once. Open it on your phone. You
see what changed, and the proposed message in a field you can edit. Change a line if you like, then
approve, or stop. The agent waits with `sess_response` and continues only on the verified answer:
it commits with the message you approved, or does nothing if you stopped. If you are slower than
its 45-second wait, it checks again for about two minutes, then tells you the form is still open;
answer it and say continue.

The same works for a reply: "Before you send this reply, use Sess to show me the draft so I can
edit and approve it."

A synthetic sample of what the agent sends (sample content, not from a real repository):

```json
{
  "mode": "interactive",
  "title": "Approve this commit?",
  "source": {
    "kind": "sess_surface",
    "components": [
      {
        "type": "record",
        "label": "What changed (sample)",
        "fields": {
          "src/greeting.js": "Greeting now uses the user's first name",
          "test/greeting.test.js": "One new test for the first-name greeting"
        }
      },
      {
        "type": "field",
        "name": "message",
        "label": "Commit message",
        "multiline": true,
        "schema": { "type": "string", "minLength": 1, "maxLength": 2000 },
        "value": "Greet users by first name\n\nAdds a test for the new greeting."
      }
    ]
  },
  "actions": [
    { "id": "approve", "label": "Approve and commit", "intent": "approve" },
    { "id": "stop", "label": "Stop", "intent": "reject" }
  ]
}
```

Text blocks are shown as plain paragraphs, so send a summary of the change rather than a raw diff;
line breaks are kept in multiline fields.

## Tools (`sess-mcp-tools/5`)

| Tool            | Input                                                                                                 | Result `interaction.state`                                                                      |
| --------------- | ----------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| `sess_request`  | `interaction`, optional `expires_in`                                                                  | `waiting`, with `humanUrl` and `expiresAt`                                                      |
| `sess_response` | `handle`, `revision`, optional `wait_ms` (0–45000)                                                    | `waiting`, `needs_resume`, `answered`, `completed`, `expired`; for an Ask `waiting` or `closed` |
| `sess_publish`  | `handle`, `expected_revision`, `response_event_id`, `interaction`                                     | `waiting` at the next revision                                                                  |
| `sess_complete` | `handle`, `expected_revision`, `response_event_id`                                                    | `completed`                                                                                     |
| `sess_ask`      | `question`, `fields` (1–12), optional `details`, `submit_label`, `expires_in`, Advanced `respondents` | `waiting`, with `humanUrl` and `expiresAt` (and `ask` with `respondents`)                       |

After an answer, `sess_complete` is the rule, not an option: when `sess_response` returns state
`answered` and the agent has no follow-up question for the person, it must call `sess_complete`
next, so the person's page shows that the agent has their answer. Until then the page keeps waiting
for the next step. Only to show a follow-up does the agent call `sess_publish` instead. The server
instructions and both tool descriptions say this.

While there is no answer yet, the host calls `sess_response` again, up to three times after its
first call (about two minutes more at the 45-second ceiling), then asks the person to say continue. The
server instructions, the `sess_response` description and the text of a `waiting` or `needs_resume`
result say this. The server keeps no count; the host does.

`sess_ask` is a shortcut for `sess_request`: it turns a question and up to 12 simple fields
(`text`, `number`, `integer`, `boolean`, `choice`, `multi_choice`, `rating`) into an ordinary interaction,
checks it with the same rules and limits, and runs the same request operation. It creates exactly
one Session, returns the link and handle at once, never waits and never returns an answer. Continue
with `sess_response`, `sess_publish` and `sess_complete` as usual.

Advanced: `expires_in` sets how long the link stays open, in whole seconds from creation: from 30
up to your plan's link lifetime (Sess checks the ceiling). The result's `expiresAt` is when the link
stops taking answers, as created; on a link of 20 hours or less the person may ask for more time, up
to a fixed horizon. While the link is lapsed (past that time but still extendable) `sess_response`
reports `waiting`. It reports `expired` once the link has closed for good with no answer: it is
final, and nothing was completed. An answer accepted before the end is still returned as `answered`.

Advanced: `respondents: { max }` on `sess_ask` asks many people through one link (a Sess Ask):
share the link with everyone who should answer; each person gets their own page. A respondent is a
browser, not a person. The cap is exact: it is checked when a person starts, so it cannot be
overshot. `respondents` also takes `name` (a required "Your name" field), `expires_in` (the one
deadline, instead of the top-level `expires_in`) and `respondent_expires_in`; each person's page
completes when their answer is accepted. The result carries `interaction.ask.id`. `sess_response`
on that handle reads once, without waiting, and returns `interaction.ask`: whether it is open, the
counts, and each person's verified answer so far. Its state is `waiting` while answers may still
come and `closed` once none can. `sess_publish` and `sess_complete` refuse an Ask's handle.

Input schemas are closed: unknown properties, unsafe keys (`__proto__`, `constructor`,
`prototype`), more than 8 levels of nesting, an interaction over 32 KiB, more than 24 fields or 5
actions are rejected, never truncated. `interaction` is the Sess interactive Surface used by
`@sess.si/sdk` (`heading`, `text`, `record` and `field` components). Tools never accept an API
origin, key, workspace, Session ID or callback URL.

### Keep it short

A person reads the form on a phone. Every field a person reads carries its purpose, style, limit
and examples in the tool schema, and `sess_ask`'s description carries one complete good call.
Lengths are Unicode code points:

| What                                         | Style                          | At most  |
| -------------------------------------------- | ------------------------------ | -------- |
| Title (`title`, `sess_ask` `question`)       | A question or a task, about 40 | 80       |
| Button (action `label`, `submit_label`)      | A verb, 1–3 words              | 24       |
| Field label, option label, `sess_ask` option | Short                          | 60       |
| Help (field `description`)                   | One hint                       | 160      |
| `description` under the title                | One or two sentences           | 280      |
| `heading`                                    | Short                          | 60       |
| `record` `label` (caption)                   | A few words                    | 200      |
| `record` key / string value                  | As written                     | 40 / 200 |
| `text`, `sess_ask` `details`                 | Plain text                     | 4,000    |

A choice without an `option_labels` entry shows its enum ID, so that ID is held to 60 too (named at
its enum entry, e.g. `/interaction/source/components/2/schema/enum/1`); a long ID with a short
label is fine.

A value over its limit is refused before anything is sent or saved, never truncated, with
`INVALID_ARGUMENTS` and the value's `field` (a JSON pointer into the arguments, such as
`/question` or `/interaction/actions/0/label`; for a record key it ends with that key), the
`limit` and its `length`. The message is Sess's own: the title has "The title can be at most 80
characters. Keep it to a short heading, about 40."; anything else names its pointer:

```json
{
  "error": {
    "code": "INVALID_ARGUMENTS",
    "message": "/fields/0/label is 72 characters; the limit is 60. Shorten it to at most 60 characters.",
    "retryable": false,
    "field": "/fields/0/label",
    "limit": 60,
    "length": 72
  }
}
```

Shorten that value and call the tool again. If Sess itself refuses a length (`CREATE_REJECTED`,
with an SDK that reports it), the same three fields come back.

Every result is `{ "interaction": { handle, revision, state, humanUrl?, response? } }`.
`structuredContent` always carries it; parse that, not the text. The text is the same object as JSON,
with two exceptions: a `sess_request` or `sess_ask` result begins with two lines for the agent,
`Show the person this link now: <humanUrl>` and `Then call sess_response.`, and a `sess_response`
result in state `waiting` or `needs_resume` begins with the re-wait line; each then has a blank line
and the same JSON. `answered` is returned only after
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
| `PLAN_LIMIT_REACHED`                                                                                      | `create_rejected`               | No; no Session exists. The workspace reached a limit of its plan                                                                                      |
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

| Variable                                 | Meaning                                                                                                                |
| ---------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| `SESS_API_KEY`                           | Required. Read on the first tool call, never at startup or from arguments.                                             |
| `SESS_API_ORIGIN`                        | Default `https://api.sess.si`. Another origin must be HTTPS without path, query or credentials.                        |
| `SESS_MCP_PROFILE`                       | Profile name, default `default`.                                                                                       |
| `SESS_MCP_STATE_DIR`                     | Absolute state directory. Default `$XDG_STATE_HOME/sess-mcp`, `~/.local/state/sess-mcp`, or `%LOCALAPPDATA%\sess-mcp`. |
| `SESS_MCP_MAX_WAIT_MS`                   | Lower the 45 000 ms wait ceiling.                                                                                      |
| `SESS_RECEIPT_ISSUER`                    | Receipt issuer if it differs from the API origin.                                                                      |
| `SESS_EXPECTED_WORKSPACE_ID`             | Trusted workspace for a runtime that does not return `Sess-Workspace-Id`.                                              |
| `SESS_MCP_TEST_ALLOW_INSECURE_LOCALHOST` | Testing only: `1` allows `http://localhost`, `127.0.0.1` or `[::1]` origins.                                           |

## Security and support boundary

- **Owner-private, single profile.** stdio carries no authenticated conversation identity, so this
  server does not invent one. Anyone who can call its tools acts for the configured key. Run it only
  for your own private client. Handles are bound to the profile, API origin and a credential
  generation (a keyed digest stored per profile; the key itself is never written). A handle from
  another profile, origin or key is rejected.
- **The Sess link is a bearer capability.** It is returned only by `sess_request` (or its shortcut `sess_ask`), to your private
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
  and answer data are removed from this server's own local record; that clears its copy only, and
  the hosted Session and receipt follow their own retention. At most 100 unfinished interactions are kept per
  profile.
- **No wake-up.** A wait is one bounded read of at most 45 seconds. The host is told to call again up
  to three times, then stop. The server cannot wake an agent after its turn ends; the person says
  continue.
- **Not in this package:** an HTTP server or bin flag, a hosted server, OAuth, MCP Tasks, Apps,
  elicitation, resources or prompts (the HTTP composition below is a library for a hosting
  runtime, not a runnable server). One server process per profile is supported; concurrent processes on the
  same profile are not coordinated. Rotating the key makes earlier handles unusable
  (`BINDING_MISMATCH`).
- **Receipt-key rotation window.** The SDK refreshes its cached receipt key set at most once per
  10 seconds. If Sess starts signing with a new key and an answer signed with it is verified
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
  `grantId`, `grantGeneration`, `scopes` and a `credential()` provider for Sess API calls. If it
  returns nothing, the answer is `401` with `WWW-Authenticate: Bearer resource_metadata="…"`; a
  principal without every `requiredScopes` entry gets `403 insufficient_scope`. The handler
  never derives `authInfo` from headers and never sends the MCP bearer token to Sess or to a tool.
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
response completes or fails, or when the client disconnects. The Sess link is returned to the
agent in the tool result exactly as over stdio and never appears in diagnostics.

## Resolving a blocked or unconfirmed interaction (owner procedure)

The tool error names the state (`RECOVERY_BLOCKED` with a reason, `CREATE_OUTCOME_UNKNOWN` or
`CREATED_NOT_SAVED`). The server never repairs these records itself.

1. Find the record: `<state dir>/profiles/<profile>/handles/<handle>.json`. It can contain the
   Sess link and answer data; do not paste it into chats or issues.
2. Check the Session in Sess (developer portal or an owner API read using `sessionId` from the
   record, when present). For `create_intent`/`create_unknown`/`CREATED_NOT_SAVED`, look for a
   Session created at that time before asking the agent to create another one.
3. Decide in Sess what should happen to the Session, then remove the local record file to retire
   the handle. Keep a private copy if you need the evidence. There is no command that resumes a
   blocked handle in this version; start a new interaction with `sess_request` if needed.

## Development

The adapter is an independent package with its own lockfile. `package.json` always declares the
exact SDK version from the repository's single pin, `release/sdk-candidate.json` (name, version,
filename, SHA-256, SHA-512). `package-lock.json` is a maintainer file only; npm never ships it to
consumers. The lock resolves the SDK to the genuine npm registry tarball
(`https://registry.npmjs.org/@sess.si/sdk/-/sdk-0.2.0.tgz`, dist-tag `latest`) with the pinned
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
and SHA-512 compared with the pin.

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
through one request → answer → complete round against a local isolated Sess runtime. It is not run
in public CI because the runtime is private. `npm run qualify:claude-code` checks that Claude Code
connects and lists the tools without any model call, using a temporary config directory.

Which hosts and versions Sess has run, and what is still untested: [COMPATIBILITY.md](COMPATIBILITY.md).

[Apache-2.0](LICENSE)
