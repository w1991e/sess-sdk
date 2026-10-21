# Listings (`listing.json`)

`listing.json` is the single source for every file a host or registry reads about this server.
Tool names, titles and annotations come from `src/tools.ts`, and the version and npm package from
`package.json`, so they cannot drift between providers.

**Generating a file is not submitting it, and submitting is not acceptance.** A generated
`server.json` or plugin bundle is never evidence of an accepted listing. Submissions are owner
actions; record "submitted" and "accepted" separately, with the provider's own confirmation. The
descriptions and test cases in `listing.json` are proposed copy and wait for a maintainer's
line-by-line sign-off.

## Commands

- `npm run listing` builds the server and regenerates every artifact from `listing.json`.
- `npm run check:listing` (also part of `npm run check`) fails when an artifact is missing, stale or
  hand-edited, fails its pinned schema or the documented provider rules, or uses a forbidden word
  ("marketplace", "directory", "app store", "catalog") or an overclaim (guarantees, identity or
  proof claims). It then prints the open submission blockers; those never fail the check.

## Artifacts

| File                                    | For                                                 | Validated against                                          |
| --------------------------------------- | --------------------------------------------------- | ---------------------------------------------------------- |
| `server.json`                           | MCP Registry (npm stdio package and the remote)     | MCP Registry `server.schema.json` 2025-12-11               |
| `listings/plugin/` (`plugin.json`, ...) | OpenAI (ChatGPT and Codex) and Cursor plugin bundle | Agent Plugins 1.0.0 `plugin` and `mcp` schemas, plus rules |
| `listings/cursor-install.json`          | Cursor install links (remote and stdio)             | decodes to its config; no secret in it                     |
| `listings/claude-connector.json`        | Values for Anthropic's custom connector form        | documented requirements (no published schema)              |

The plugin bundle holds `plugin.json`, `mcp.json` (exactly one server: the remote endpoint), a
`README.md` and one skill stub, `skills/ask-a-person/SKILL.md`. No ZIP is checked in; build one
when submitting.

Vendored schemas in `listings/schemas/` are byte-identical to their sources and pinned by SHA-256
in `listing.json`; the check refuses a modified copy. Retrieved 2026-10-15:

| Schema                                                                       | SHA-256                                                            |
| ---------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| https://static.modelcontextprotocol.io/schemas/2025-12-11/server.schema.json | `3fba09590c99f61735d234822279f4223fab9e300c0a81e81c91ab62a4114de0` |
| https://agent-plugins.org/schemas/1.0.0/plugin.schema.json                   | `0a4aad95ce337878ad38802ebf0daa3fde76abe3f65400c86bcbb1ec0b3ab883` |
| https://agent-plugins.org/schemas/1.0.0/mcp.schema.json                      | `6539175bfcdf43085855183e86da40ea94b166547a72b47ae9a0a390516d3acb` |

OpenAI publishes no JSON schema for `extensions.com.openai`; `scripts/listing.mjs` encodes the
limits from https://developers.openai.com/plugins/deploy/submission.md (read 2026-10-15). Recheck
them, and the schema versions, before each submission.

## Tool annotations (audit, 2026-10-15)

| Tool            | read-only | destructive | idempotent | open world | Why                                                                                                  |
| --------------- | --------- | ----------- | ---------- | ---------- | ---------------------------------------------------------------------------------------------------- |
| `sess_request`  | no        | no          | no         | yes        | Creates a Session and a human link (additive); a repeat creates another one.                         |
| `sess_response` | yes       | no          | yes        | yes        | Reads or waits for the answer; changes nothing on Sess.                                              |
| `sess_publish`  | no        | no          | yes        | yes        | Appends the next immutable revision; the answered one stays. An identical replay is answered as one. |
| `sess_complete` | no        | **yes**     | yes        | yes        | Terminal: the link stops accepting answers and never reopens. Changed from `false`.                  |
| `sess_ask`      | no        | no          | no         | yes        | The same create as `sess_request`.                                                                   |

Annotations are hints for hosts, not part of the versioned `sess-mcp-tools/4` schemas.

## Before any submission

`npm run check:listing` lists what is still open. Today:

- a maintainer signs off the copy and the test cases in `listing.json`;
- `https://mcp.sess.si/mcp` is deployed and read back. Until then every remote entry
  describes an endpoint that does not answer;
- `@sess.si/mcp` is published on npm (`RELEASING.md`) for the stdio entries;
- privacy policy and terms of service pages exist; set `urls.privacy` and `urls.terms`;
- the setup page exists at `urls.docs`;
- an icon (square, at least 48x48) is committed under `listings/plugin/assets/` and referenced.

After any change to `listing.json`, run `npm run listing` and commit the result.

## Owner submission steps

### MCP Registry

Official registry only (`registry.modelcontextprotocol.io`), under the GitHub namespace of the
`w1991e` account: `io.github.w1991e/sess`. `w1991e` is a personal account, and GitHub
authentication always grants the personal namespace `io.github.<username>/*` (an organization
namespace would need org ownership). No other account is needed.

`server.json` names `package.json`'s exact version for the server and for the npm package, and
stays in step with it on every release candidate (founder, 2026-10-20): `npm run listing` writes
it, and `npm run check:listing`, the registry-metadata test and the release guard fail when they
differ. It never names a dist-tag. The registry checks the npm package's `mcpName` against the
server name, so that version must be on npm first. It also does not verify the remote URL, so
publish only after the `mcp.sess.si` readback.

`npm run check:listing` validates `server.json` against the pinned 2025-12-11 schema, and CI also
runs the registry's own validator (`mcp-publisher validate`, pinned v1.8.1 by SHA-256; no login,
no publish).

Owner commands, after `@sess.si/mcp` at the version `server.json` names is on npm and
`https://mcp.sess.si/mcp` answers:

1. Install the pinned publisher (macOS arm64 shown; other platforms from the same release):
   `curl -fsSLO https://github.com/modelcontextprotocol/registry/releases/download/v1.8.1/mcp-publisher_darwin_arm64.tar.gz`,
   check `shasum -a 256` is
   `e45e520892460732a4bdf37255576415d4a53ec171f8b913faf15bb1aef7cb77`, then
   `tar -xzf mcp-publisher_darwin_arm64.tar.gz mcp-publisher`.
2. From `adapters/mcp` at the released commit: `../../mcp-publisher validate server.json` (or the
   path you extracted it to).
3. `mcp-publisher login github`, and authorize as `w1991e` in the browser (device code).
4. `mcp-publisher publish`.
5. Read the entry back:
   `curl -s 'https://registry.modelcontextprotocol.io/v0/servers?search=io.github.w1991e/sess'`.
   Record its version and date as submitted, and as listed only after the readback shows it.

### OpenAI (ChatGPT and Codex)

Eligible for the remote endpoint with OAuth. The submission portal has no API-key connection flow,
so the stdio package is not eligible. Needs a verified developer identity in the OpenAI platform
organization and the Apps Management Write role.

1. Complete the blockers above, add `demoRecordingUrl`, and run the five positive and three
   negative test cases against a dedicated Sess test account.
2. Serve the portal's domain challenge token at `https://mcp.sess.si/.well-known/openai-apps-challenge`
   (a hosted-runtime change).
3. Build the ZIP from the bundle (from `adapters/mcp`):
   `mkdir -p .artifacts && (cd listings/plugin && zip -r -X ../../.artifacts/sess-plugin.zip .)`
4. Upload it at https://platform.openai.com/plugins, resolve findings, connect the MCP server
   (OAuth endpoints are discovered from the protected-resource metadata; Agent Plugins 1.0.0 allows
   no per-server `extensions`, so `mcp.json` declares none), and enter the reviewer credentials in
   Review details, never in the package.
5. Submit for review; publish only after approval.

### Cursor

- Install links (`listings/cursor-install.json`) need no submission; they belong on the setup page
  once their status is deployed or published.
- The plugin bundle is submitted as a public Git repository at https://cursor.com/marketplace/publish.
  Confirm that a subfolder (`adapters/mcp/listings/plugin`) is accepted; otherwise the owner decides
  whether to mirror it into its own repository.

### Claude (custom connector review)

Eligible for the remote endpoint with OAuth; Anthropic no longer accepts MCPB bundles there. Every
tool has a title and read-only/destructive hints. Use the values in
`listings/claude-connector.json` in Anthropic's submission form, add the privacy policy URL and a
test account, and submit.

### ClawHub

Not applicable to this server. ClawHub lists the native OpenClaw plugin; see
`adapters/openclaw/RELEASING.md`.
