# Compatibility (`@sess.si/mcp`)

What Sess has run, on which hosts and versions, and what has not been run yet. The
[README](README.md) gives only the setup steps. The exact tuple of dependencies, digests and protocol
versions is in [compatibility.json](compatibility.json); the [changelog](CHANGELOG.md) describes each
version.

## This release

- `@sess.si/mcp@0.2.0`, tool schema `sess-mcp-tools/5`, on `@sess.si/sdk@0.2.0`.
- On npm `latest` since 2026-11-07T20:30:24Z (registry read 2026-11-09 21:38Z). `next` stays at
  `0.1.0-rc.4`. `npm view @sess.si/mcp dist-tags` shows what the registry serves now.
- `compatibility.json` still records 0.2.0 as prepared and unpublished; its release entry changes
  when the release readback is recorded there.
- The README names `@sess.si/mcp@0.2.0` in every install line; the line is bumped on each release.

## Node

- `engines`: `>=22.14.0 <25`: Node 22.14 or later on 22.x, or Node 24. The local server needs it; the
  hosted server does not.
- Qualified on 22.14.0 and 24.21.0 (`npm run setup` and `npm run check` from a clean copy in
  `node:22.14.0-bookworm-slim` and `node:24.21.0-bookworm-slim`, plus macOS on 24.21.0).
- Windows is not qualified (the default state directory there is `%LOCALAPPDATA%\sess-mcp`).

## The hosted server (`https://mcp.sess.si/mcp`)

Streamable HTTP with OAuth sign-in to a Sess account. It runs the Sess runtime's own pin of this
package, so the runs below were made on the hosted server as deployed on their dates, not on 0.2.0
from npm.

| Host           | Run end to end                                                  | Date       |
| -------------- | --------------------------------------------------------------- | ---------- |
| Claude Code    | Claude Code 2.1.312, with token refresh and a fresh sign-in     | 2026-10-29 |
| claude.ai      | claude.ai on the web, custom connector                          | 2026-10-28 |
| ChatGPT        | ChatGPT on the web, custom MCP server (a)                       | 2026-10-28 |
| Cursor         | Cursor, hosted MCP; requalified on 2026-11-06 across a deploy   | 2026-11-05 |
| Grok Build     | Grok Build 1.0.77, hosted MCP, production (c)                   | 2026-11-10 |
| grok.com       | not run: the steps follow xAI's documentation (read 2026-11-08) |            |
| Cline          | not run: the README-alone install test has not been run (b)     |            |
| Your own agent | not run as a named host                                         |            |

(a) One production run passed. The Sess site lists ChatGPT as run end to end; the OpenAI listing
does not mark it qualified, and Codex has no run.

(b) Cline's remote setting names (`type: "streamableHttp"`) and its OAuth sign-in are unverified
until that run.

(c) One full round on production with model Grok 4.7: the link appeared in the reply, the person
answered on a phone, Grok read the answer back and completed the exchange. Sess was already set up
through Claude Code's `~/.claude.json`, which Grok Build also reads, so the add command was not typed
in that round; the add command was run once on its own in a clean home directory against the
preview server, where it registered the server.

## The local server (`npx -y @sess.si/mcp@0.2.0`)

The `sess-mcp` bin speaks stdio only. No host has been recorded running the registry form
`npx -y @sess.si/mcp@0.2.0`; the runs below used a packed, installed tarball
(`npx --no-install sess-mcp`) or an earlier release. Packed and loopback installs are candidate
evidence; they do not qualify a public registry install.

### Claude Code

- Connection test with Claude Code 2.1.299 on Linux (Node 24.21.0, `node:24.21.0-bookworm-slim`):
  `claude mcp add --scope local` and `claude mcp list` showed `✔ Connected`, and `tools/list` returned
  the five tools. No model call was made (`scripts/qualify-claude-code.mjs`, isolated
  `CLAUDE_CONFIG_DIR`). It ran from a project where the packed tarballs were installed, because the
  package was not on the registry then.
- Requested and negotiated protocol 2025-11-25, after a `server/discover` probe answered with
  method-not-found.
- A key exported in the shell that starts Claude Code reached the server during the `claude mcp list`
  health check and was not written to Claude Code's configuration.
- **The `-e` form.** `claude mcp add --scope local sess -e SESS_API_KEY=… -- npx …` also connected,
  but Claude Code stores `-e` values **in plain text** in its configuration (`.claude.json` in its
  config directory), so prefer the environment form on shared machines. The server name must come
  **before** `-e`: in 2.1.299 the form `claude mcp add -e SESS_API_KEY=… sess -- …` fails with
  "Invalid environment variable format".
- Not tested: the registry `npx -y @sess.si/mcp@0.2.0` form; environment inheritance when an
  interactive Claude Code session starts the server (it was observed for the `claude mcp list`
  health check); a model-driven round through Claude Code; a macOS host.
- Enterprise-managed Claude Code installations may forbid adding MCP servers
  (`enterprise MCP configuration is active`).

### Antigravity

Run end to end with Antigravity 1.4.9 on 2026-10-28, with an earlier release of this package
from npm. 0.2.0 has not been run on it.

### Cursor

The local entry is not tested. It relies on Cursor's `${env:…}` interpolation to read
`SESS_API_KEY` from the environment Cursor starts with.

### Cline

The local entry is not tested. Whether Cline passes your shell's `SESS_API_KEY` to a local server is
unverified, so the README's local entry carries the key in its `env`; Cline keeps that file in plain
text.

### OpenClaw

OpenClaw uses the plugin `@sess.si/openclaw`, not this package. It was run end to end with
OpenClaw 2026.10.7 and `@sess.si/openclaw` 0.1.0-rc.5 on 2026-10-29. The README's install line names
`@sess.si/openclaw@0.1.0`, on npm `latest` (read 2026-11-09), the release the Sess site's install line names.

### Other clients

- The official TypeScript MCP client (`@modelcontextprotocol/sdk` 1.32.1, protocol 2025-11-25):
  `initialize` and `tools/list` from the packed, installed bin; on 2026-10-14 a full round
  (`sess_request`, `sess_response` waiting, `needs_resume` and a verified answer, `sess_publish` with
  an identical and a differing replay, `sess_complete`) against an isolated local Sess runtime;
  cancellation of `sess_response`.
- Not tested: Claude Desktop, and any other MCP host.

## Transports and protocol

- stdio: the `sess-mcp` bin. Negotiates 2025-11-25, 2025-06-18, 2025-03-26, 2024-11-05 and
  2024-10-07.
- Streamable HTTP: only as the library export `@sess.si/mcp/http` (`createSessMcpHttpHandler`),
  stateless, for a hosting runtime. It serves 2026-07-28 and, through the stateless fallback, the
  2025-era revisions. Tested in unit tests only; no real host over HTTP, no deployed endpoint and no
  OAuth are covered by this package's own tests.
- Not supported: SSE, sessionful Streamable HTTP, an HTTP bin flag.
- Offered: the tools capability only. No Tasks, Apps, elicitation, sampling, resources or prompts.
