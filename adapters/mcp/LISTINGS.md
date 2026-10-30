# Listings (`listing.json`)

`listing.json` is the single source for every file a host or registry reads about this server.
Tool names, titles and annotations come from `src/tools.ts`, and the version and npm package from
`package.json`, so they cannot drift between providers.

**Generating a file is not submitting it, and submitting is not acceptance.** A generated
`server.json` or plugin bundle is never evidence of an accepted listing. Submissions are owner
actions; record "submitted" and "accepted" separately, with the provider's own confirmation. The
descriptions, categories and test cases in `listing.json` are **proposed** copy and wait for the
founder's line-by-line sign-off (`copy.status` becomes `approved` only after it).

## Commands

- `npm run listing` builds the server and regenerates every artifact from `listing.json`.
- `npm run check:listing` (also part of `npm run check`) fails when an artifact is missing, stale or
  hand-edited, fails its pinned schema or the documented provider rules, or uses a forbidden word
  ("marketplace", "directory", "app store", "catalog"), an overclaim (guarantees, identity or
  proof claims) or pricing, plan, trial, discount, promotion or upgrade text. It then prints the
  open submission blockers; those never fail the check.

The provider rules it enforces (read 2026-10-23):

| Provider     | Enforced                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| OpenAI       | display name and subtitle 30, long description 4,000, at most 3 unique default prompts of 128 with no @mentions; no "MCP" or "Plugin" in the name; website, support, privacy and terms URLs all HTTPS; exactly 5 positive cases (description, prompt, tools, expected result) and 3 negative cases (why not to act, prompt, expected refusal); no credentials or reviewer instructions in the package                                      |
| Claude       | name 100, one-liner 200, description 2,000, 1-5 distinct categories, HTTPS documentation and privacy policy URLs, a support contact (email or HTTPS URL), OAuth over HTTPS, a title and hints on every tool                                                                                                                                                                                                                                |
| MCP Registry | the pinned 2025-12-11 schema; the name in the `si.sess/*` namespace that DNS authentication of `sess.si` grants; exactly one `streamable-http` remote, the production URL; while the npm package is deferred, no packages (remote-only); once listed, exactly one npm stdio package (this package, at `package.json`'s version) and the name equal to `mcpName`                                                                            |
| Icons        | every committed PNG in `icons.files` exists, is a square PNG of its stated size (read from its IHDR), at least 48x48, and has its recorded SHA-256; `icons.value` names the same icons, in order, as `image/png` with their `sizes`, at `https://sess.si/assets/icons/<icons.json version>/<file>`; `server.json`, `plugin.json` (`logo`, `composerIcon`), `claude-connector.json` (`icon`) and Docker's `about.icon` take them from there |
| Packets      | the owner submission steps below quote listing.json's current short, registry and one-line descriptions, the remote URL, the repository, the support contact and the icon URLs                                                                                                                                                                                                                                                             |

Sources: https://developers.openai.com/apps-sdk/deploy/submission.md,
https://developers.openai.com/apps-sdk/app-submission-guidelines.md,
https://claude.com/docs/connectors/building/submission.md and
https://modelcontextprotocol.io/registry/authentication.

## Artifacts

| File                                    | For                                                     | Validated against                                             |
| --------------------------------------- | ------------------------------------------------------- | ------------------------------------------------------------- |
| `server.json`                           | MCP Registry (the remote; remote-only for now)          | MCP Registry `server.schema.json` 2025-12-11                  |
| `listings/plugin/` (`plugin.json`, ...) | OpenAI (ChatGPT and Codex) and Cursor plugin bundle     | Agent Plugins 1.0.0 `plugin` and `mcp` schemas, plus rules    |
| `listings/cursor-install.json`          | Cursor install links (remote and stdio)                 | decodes to its config; no secret in it                        |
| `listings/claude-connector.json`        | Values for Anthropic's connector submission form        | documented requirements (no published schema)                 |
| `listings/docker/` (`server.yaml`, ...) | A pull request to docker/mcp-registry (`servers/sess/`) | generated only; Docker's own CI checks it on the pull request |
| `listings/plugin/assets/` (the icons)   | Every store that takes an icon upload                   | PNG IHDR size and pinned SHA-256 (copied, not generated)      |

The plugin bundle holds `plugin.json`, `mcp.json` (exactly one server: the remote endpoint), a
`README.md`, one skill stub, `skills/ask-a-person/SKILL.md`, and the icons in `assets/`. No ZIP is
checked in; build one when submitting.

## Icon

The icon is the Sess icon set's solid tile, generated by w1991e/sess
`packages/design-tokens/scripts/logos.ts` from the logo masters B (#776, commit
`43f169107f2b37a1e1b14ec69bc5ae446931445c`, `icons.json` version `24eb73d4a4d9`). Nothing is drawn
by hand. The two PNGs are that script's `icon-512.png` and `icon-192.png`, copied byte for byte.
On 2026-10-28, `logos.ts --check` reported every derived file equal to a fresh generation at
w1991e/sess `8dc6f040`, where the icon files are unchanged since `43f16910`.

| File                                  | Size    | SHA-256                                                            |
| ------------------------------------- | ------- | ------------------------------------------------------------------ |
| `listings/plugin/assets/icon-512.png` | 512x512 | `423a61419cf7988e51afb858e671a23bffea8593eb7529345cce854073d6ae90` |
| `listings/plugin/assets/icon-192.png` | 192x192 | `7c22cd45d39dd0b57d5dc61282952b77724f345614e763d08e74b34d57c1e862` |

Their HTTPS URLs, which the MCP Registry and Docker need, are
`https://sess.si/assets/icons/24eb73d4a4d9/icon-512.png` and
`https://sess.si/assets/icons/24eb73d4a4d9/icon-192.png`. **They answer only after the Wednesday
production deploy of #776** (both returned 404 on 2026-10-28), so `icons.status` is
`pending-deploy`; set it to `live` after a GET of each returns 200 with `image/png`.

Sizes the stores need: OpenAI and Claude take a square PNG of at least 48x48 (the 512 is the
primary icon, the 192 OpenAI's composer icon); the MCP Registry takes any size named in `sizes`;
Docker takes a URL. **Cline asks for 400x400, which the script does not generate yet.** Adding it
is a w1991e/sess change: one entry in `ICON_RASTERS` (`packages/design-tokens/src/icons.ts`),
`{ name: 'icon-400.png', size: 400, shape: 'tile', scale: MARK_SCALE, opaque: false }`, plus
`'icon-400.png'` in `ICON_FILES`, then `logos.ts` to regenerate. That changes the `icons.json`
version, and so the icon URLs above.

Vendored schemas in `listings/schemas/` are byte-identical to their sources and pinned by SHA-256
in `listing.json`; the check refuses a modified copy. Retrieved 2026-10-15; the registry schema was
rechecked on 2026-10-23 (still the version the registry pages name, same SHA-256):

| Schema                                                                       | SHA-256                                                            |
| ---------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| https://static.modelcontextprotocol.io/schemas/2025-12-11/server.schema.json | `3fba09590c99f61735d234822279f4223fab9e300c0a81e81c91ab62a4114de0` |
| https://agent-plugins.org/schemas/1.0.0/plugin.schema.json                   | `0a4aad95ce337878ad38802ebf0daa3fde76abe3f65400c86bcbb1ec0b3ab883` |
| https://agent-plugins.org/schemas/1.0.0/mcp.schema.json                      | `6539175bfcdf43085855183e86da40ea94b166547a72b47ae9a0a390516d3acb` |

OpenAI publishes no JSON schema for `extensions.com.openai`; `scripts/listing.mjs` encodes the
limits above. Recheck them, and the schema versions, before each submission.

## Tool annotations (audit 2026-10-15, rechecked 2026-10-23)

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

- the founder signs off the proposed copy, categories and test cases in `listing.json`;
- `https://mcp.sess.si/mcp` passes production host qualification (it is deployed: `/version` was
  read back on 2026-10-23); then set `remote.status` to `qualified`;
- to list the npm stdio package in the MCP Registry entry (today it is remote-only): a successor
  `@sess.si/mcp` candidate declaring `mcpName` `si.sess/sess` (the published 0.1.0-rc.4 declares
  `io.github.w1991e/sess`), after the re-pin freeze ends on 3 Nov; then set
  `providers.mcpRegistry.npmPackage.status` to `listed`;
- the icon URLs answer on production (the Wednesday deploy of #776); then set `icons.status` to
  `live`. The PNGs are committed (see [Icon](#icon));
- for Cline only: a 400x400 PNG from the logos script (see [Icon](#icon));
- a demo recording URL (OpenAI), and a reviewer test account entered in each portal, never in the
  package. OpenAI requires one that signs in without email or SMS codes or magic links.

After any change to `listing.json`, run `npm run listing` and commit the result.

## Owner submission steps

Every description quoted below is `listing.json`'s **proposed** copy; paste it only after the
founder signs it. `npm run check:listing` fails when these steps stop quoting listing.json's
current values.

### MCP Registry

Official registry only (`registry.modelcontextprotocol.io`), under the domain namespace
`si.sess/*`: the server is `si.sess/sess`. DNS authentication of `sess.si` grants `si.sess/*`
(the reverse-DNS form of the domain). It needs no GitHub account; it needs the TXT record on
`sess.si` (`v=MCPv1; k=ed25519; p=<public key>`, already in place) and its Ed25519 private key,
which the owner keeps in the macOS Keychain item `sess-mcp-registry-ed25519`. The key never goes
into this repository, a file, a log, a chat or an agent prompt.

**The entry is remote-only for now.** `server.json` lists the one `streamable-http` remote
`https://mcp.sess.si/mcp` and no `packages`. The registry checks a listed npm package's `mcpName`
against the server name, and the published `@sess.si/mcp@0.1.0-rc.4` declares
`io.github.w1991e/sess`; `package.json` keeps that value so the published package's identity is
unchanged. Listing the stdio package (`providers.mcpRegistry.npmPackage.status` `listed`) needs a
successor candidate declaring `mcpName` `si.sess/sess`; the checks and the release guard then
require the two to be equal again.

`server.json` names `package.json`'s exact version (and, once listed, the npm package's), and
stays in step with it on every release candidate (2026-10-20): `npm run listing` writes
it, and `npm run check:listing`, the registry-metadata test and the release guard fail when they
differ. It never names a dist-tag. The registry does not verify the remote URL, so publish only
after `https://mcp.sess.si/mcp` passes production host qualification. `server.json` `icons` lists
the two icon URLs (`512x512` and `192x192`, `image/png`); publish after they answer.

`npm run check:listing` validates `server.json` against the pinned 2025-12-11 schema, and CI also
runs the registry's own validator (`mcp-publisher validate`, pinned v1.8.1 by SHA-256; no login,
no publish).

Owner commands, in the owner's own terminal, after production host qualification has passed:

1. Install the pinned publisher (macOS arm64 shown; other platforms from the same release):
   `curl -fsSLO https://github.com/modelcontextprotocol/registry/releases/download/v1.8.1/mcp-publisher_darwin_arm64.tar.gz`,
   check `shasum -a 256` is
   `e45e520892460732a4bdf37255576415d4a53ec171f8b913faf15bb1aef7cb77`, then
   `tar -xzf mcp-publisher_darwin_arm64.tar.gz mcp-publisher`.
2. From `adapters/mcp` at the released commit: `../../mcp-publisher validate server.json` (or the
   path you extracted it to).
3. Check the TXT record is still served: `dig +short TXT sess.si` shows a `v=MCPv1; k=ed25519;`
   entry.
4. Log in with DNS authentication. The key is read from the Keychain into a shell variable and
   never printed (`mcp-publisher` takes the hex private key):

   ```sh
   PRIVATE_KEY="$(security find-generic-password -s sess-mcp-registry-ed25519 -w)"
   mcp-publisher login dns --domain sess.si --private-key "$PRIVATE_KEY"
   unset PRIVATE_KEY
   ```

   If the Keychain item holds the PEM key rather than the hex key, derive the hex form inside the
   same substitution, as the registry documents:
   `PRIVATE_KEY="$(security find-generic-password -s sess-mcp-registry-ed25519 -w | openssl pkey -noout -text | grep -A3 'priv:' | tail -n +2 | tr -d ' :\n')"`.

5. `mcp-publisher publish`.
6. Read the entry back:
   `curl -s 'https://registry.modelcontextprotocol.io/v0/servers?search=si.sess/sess'`.
   Record its version and date as submitted, and as listed only after the readback shows it.

### OpenAI (ChatGPT and Codex)

Eligible for the remote endpoint with OAuth. The submission portal has no API-key connection flow,
so the stdio package is not eligible. Needs a verified developer identity in the OpenAI platform
organization and the Apps Management Write role.

1. Complete the blockers above, add `demoRecordingUrl`, and run the five positive and three
   negative test cases against a dedicated Sess test account. OpenAI's reviewers must be able to
   sign in to it without MFA, email or SMS codes or magic links.
   The values the portal reads from `plugin.json` `extensions.com.openai.interface`: display name
   `Sess`, subtitle `Ask a person, get the answer`, developer `Sess`, category `Productivity`,
   website `https://sess.si`, support `https://docs.sess.si/support/`, privacy
   `https://sess.si/privacy/`, terms `https://sess.si/terms/`, primary icon (`logo`)
   `./assets/icon-512.png` and composer icon (`composerIcon`) `./assets/icon-192.png`. If the
   dashboard still asks for an app icon, upload `listings/plugin/assets/icon-512.png`.
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

### Claude (connector directory review)

Eligible for the remote endpoint with OAuth; Anthropic no longer accepts MCPB bundles there. Every
tool has a title and read-only/destructive hints. Submit at claude.ai/directory/manage (Submit new,
MCP connector) with the values in `listings/claude-connector.json`: name, one-liner, description,
categories, documentation and privacy policy URLs, support contact `ask@sess.si`, and the icon
`listings/plugin/assets/icon-512.png` (its `icon` field). Add the permanent slug (the owner's
choice), a test account with every step, the data-handling answers and the acknowledgements in the
portal.

### Smithery

Sources: https://smithery.ai/docs/build/publish and https://smithery.ai/docs/build/external (read
2026-10-28). Smithery lists a remote server by its URL; it needs Streamable HTTP and, for a server
that needs sign-in, OAuth that it discovers from an unauthenticated `401`. `mcp.sess.si` answers
an unauthenticated `POST /mcp` with `401` and
`www-authenticate: Bearer resource_metadata="https://mcp.sess.si/.well-known/oauth-protected-resource/mcp"`
(checked 2026-10-28). Smithery scans from Cloudflare Workers with the user agent `SmitheryBot`;
nothing in front of `mcp.sess.si` may block it, or answer it with `403`.

1. At https://smithery.ai/new, enter the server URL `https://mcp.sess.si/mcp` and complete the
   flow. Sign in with a Sess account when the scan asks, so it can list the tools.
2. Or with the CLI (from the brief, not yet confirmed against Smithery's docs):
   `smithery mcp publish "https://mcp.sess.si/mcp" -n @<org>/sess` (`<org>` is the owner's
   Smithery namespace).
3. Listing values: name `Sess`; description
   `Your agent sends a Sess link, a person answers on any device, and the agent gets a verified answer.`;
   homepage `https://sess.si`; repository `https://github.com/w1991e/sess-sdk`; icon
   `https://sess.si/assets/icons/24eb73d4a4d9/icon-512.png` (or upload
   `listings/plugin/assets/icon-512.png`).

If the scan cannot finish, Smithery reads a static server card at
`/.well-known/mcp/server-card.json`; that is a w1991e/sess runtime change and is not prepared here.

### Glama

Sources: https://glama.ai/blog/2025-07-08-what-is-glamajson (read 2026-10-28) and Glama's
connector page.

- **The GitHub repository.** Glama claims a server listing from its repository. `w1991e` is a
  personal account, so signing in to Glama with that GitHub account should claim it without a file.
  If it does not, add this `glama.json` at the repository root (prepared here only, not committed),
  then run Glama's Claim flow again:

  ```json
  {
    "$schema": "https://glama.ai/mcp/schemas/server.json",
    "maintainers": ["w1991e"]
  }
  ```

- **The remote connector.** Claiming `https://mcp.sess.si/mcp` as a connector uses
  `/.well-known/glama.json` on the server's domain, with a maintainer email (not confirmed from
  Glama's pages; from the brief). That is a w1991e/sess runtime change: **open question** below.
- Listing values: name `Sess`; description
  `Your agent sends a Sess link, a person answers on any device, and the agent continues with their typed, receipt-checked answer.`;
  server URL `https://mcp.sess.si/mcp`; support `ask@sess.si`.

### mcp.so

Sources: third-party guides only, **unverified**. The form at https://mcp.so/submit takes the
GitHub URL, a one- or two-sentence description, three to five tags and a category; mcp.so then
reads the README.

- GitHub URL: `https://github.com/w1991e/sess-sdk/tree/master/adapters/mcp`
- Description:
  `Your agent sends a Sess link, a person answers on any device, and the agent continues with their typed, receipt-checked answer.`
- Tags: `human-in-the-loop`, `forms`, `approvals`, `receipts`, `mcp`
- Category: `Productivity` (the nearest of the form's categories, if it differs)
- Server URL, if asked: `https://mcp.sess.si/mcp`

### Cline

Source: https://github.com/cline/mcp-marketplace (README, read 2026-10-28). Submission is a new
issue in `cline/mcp-marketplace` with the "MCP Server Submission" template.

- GitHub Repo URL: `https://github.com/w1991e/sess-sdk/tree/master/adapters/mcp`
- Logo Image: a 400x400 PNG. **Not available yet** (see [Icon](#icon)); do not submit a resized
  copy.
- Reason for Addition:
  `Your agent sends a Sess link, a person answers on any device, and the agent continues with their typed, receipt-checked answer.`
- Confirmation: Cline must be able to set the server up from the README or `llms-install.md`. The
  submitter confirms it only after watching Cline do so; that has not been done.

`llms-install.md` is optional. A draft, not committed (Cline's remote setting names and its OAuth
sign-in are unverified):

```md
# Install Sess for Cline

Sess lets you ask a person a question through a Sess link and continue with their answer.

1. Add this server to `cline_mcp_settings.json`:
   `{ "mcpServers": { "sess": { "type": "streamableHttp", "url": "https://mcp.sess.si/mcp" } } }`
2. When Cline connects, sign in with your Sess account in the browser. No key goes in the file.
3. Try it: "Ask me on my phone which time works for a call tomorrow." Cline shares a Sess link;
   answer it, and Cline reports your choice.
```

### Docker

Source: https://github.com/docker/mcp-registry/blob/main/CONTRIBUTING.md (read 2026-10-28),
"Adding a Remote MCP Server". Submission is a pull request to `docker/mcp-registry` that adds
`servers/sess/` with the three generated files in `listings/docker/`, copied unchanged:
`server.yaml` (`name` `sess`, `type: remote`, `dynamic.tools: true`, `meta.category`
`productivity`, `meta.tags`, `about.title` `Sess`, `about.description` (the registry
description), `about.icon` `https://sess.si/assets/icons/24eb73d4a4d9/icon-512.png`, `remote`
`streamable-http` at `https://mcp.sess.si/mcp`, and `oauth`), `tools.json` (`[]`: tools are
discovered) and `readme.md` (the documentation link).

Before the pull request, test it locally as the guide shows: `task catalog -- sess`, then
`docker mcp catalog import`, `docker mcp server enable sess` and `docker mcp oauth authorize sess`.
Test credentials go to Docker through its own form, never into the pull request.

The `oauth` entry (`provider` `sess`, `secret` `sess.personal_access_token`, `env`
`SESS_PERSONAL_ACCESS_TOKEN`) follows the remote wizard's convention. **Open question** below:
whether it fits Sess's OAuth.

### ClawHub

Not applicable to this server. ClawHub lists the native OpenClaw plugin; see
`adapters/openclaw/RELEASING.md`.

## Open questions

- **Glama connector claim.** Serving `/.well-known/glama.json` with a maintainer email on
  `mcp.sess.si` is a w1991e/sess runtime change, and the email is published. Is that wanted, or is
  the repository claim enough?
- **Docker OAuth.** Docker's remote entries name an OAuth `provider` and a stored `secret`, the
  pattern of a client registered with Docker in advance. Sess registers clients by client-ID
  metadata documents and dynamic client registration and has no pre-registered client secret.
  Whether Docker's broker supports either is not documented in CONTRIBUTING.md; confirm with
  Docker (an issue in `docker/mcp-registry`) or by the local `docker mcp oauth authorize` test
  before the pull request.
- **Cline 400x400.** Needs the one-entry change to the logos script described in [Icon](#icon).
