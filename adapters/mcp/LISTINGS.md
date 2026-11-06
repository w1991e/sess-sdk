# Listings (`listing.json`)

`listing.json` is the single source for every file a host or registry reads about this server.
Tool names, titles and annotations come from `src/tools.ts`, and the version and npm package from
`package.json`, so they cannot drift between providers.

**Generating a file is not submitting it, and submitting is not acceptance.** A generated
`server.json` or plugin bundle is never evidence of an accepted listing. Submissions are owner
actions; record "submitted" and "accepted" separately, with the provider's own confirmation. The
descriptions, categories and test cases in `listing.json`, and the Cline issue text generated from
it, were signed by the founder on 2026-11-04 at 20:45Z (`copy.status` is `approved`), with test-case
prompts 2–5 as he reworded them at 21:20Z, and the one-liner and the lead of the long description as
he signed them on 2026-11-05 at 00:50Z. His supporting line isn't in the Registry description: the
pinned schema caps it at 100 characters and the two sentences come to 154, so `server.json` carries
the one-liner alone. His rule of 2026-11-05 01:05Z: a single-line field (Registry, Docker, the
plugin's description, Smithery, Glama, Cline) carries the one-liner alone; a multi-sentence description
(Claude, mcp.so, OpenAI's long description) opens with the one-liner, then the supporting line, then the
rest of the signed description. For Claude's and OpenAI's long descriptions this rule is superseded by
the Cursor submission's signed copy of 2026-11-06 below. Signed words are not a run test: the claude.ai run is in
[Test cases on claude.ai](#test-cases-on-claudeai), and OpenAI's run has not happened.

Signed (founder 2026-11-06), the listing copy of the Cursor submission. It is `copy.long`, word for
word, and replaces the long description of 2026-11-04 wherever it is generated (the plugin
`README.md`, OpenAI's long description, Claude's description). It opens with the one-liner alone, not
the supporting line:

> Let your agent ask a person and continue with their answer. Your agent describes a form and gets a
> link at once. The person answers on any device, and your agent continues with a typed answer and a
> signed receipt.
>
> Anyone with the link can answer, so share it only with the person you mean. The receipt records
> what Sess accepted, not who answered. Check answers before your agent acts on them. You sign in
> with a Sess account. The person answering needs none.

With it, the plugin `README.md` lists `sess_ask` first, and its Connect bullet no longer says how
to sign in; the copy says it.

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
| MCP Registry | the pinned 2025-12-11 schema; the name in the `si.sess/*` namespace that DNS authentication of `sess.si` grants; exactly one `streamable-http` remote, the production URL; with the npm package listed, exactly one npm stdio package (this package, at `package.json`'s version) and the name equal to `mcpName` (were it set back to `deferred`, no packages)                                                                            |
| Icons        | every committed PNG in `icons.files` exists, is a square PNG of its stated size (read from its IHDR), at least 48x48, and has its recorded SHA-256; `icons.value` names the same icons, in order, as `image/png` with their `sizes`, at `https://sess.si/assets/icons/<icons.json version>/<file>`; `server.json`, `plugin.json` (`logo`, `composerIcon`), `claude-connector.json` (`icon`) and Docker's `about.icon` take them from there |
| Host status  | Claude's and Cursor's artifacts each carry their own `remoteStatus` from `listing.json`; `qualified` needs that host's `qualificationEvidence`; the Cursor remote link decodes to the production URL                                                                                                                                                                                                                                       |
| Packets      | the owner submission steps below quote listing.json's current short, registry and one-line descriptions, the remote URL, the repository, the support contact and the icon URLs                                                                                                                                                                                                                                                             |

Sources: https://developers.openai.com/apps-sdk/deploy/submission.md,
https://developers.openai.com/apps-sdk/app-submission-guidelines.md,
https://claude.com/docs/connectors/building/submission.md and
https://modelcontextprotocol.io/registry/authentication.

## Artifacts

| File                                    | For                                                       | Validated against                                                 |
| --------------------------------------- | --------------------------------------------------------- | ----------------------------------------------------------------- |
| `server.json`                           | MCP Registry (the remote and the npm stdio package)       | MCP Registry `server.schema.json` 2025-12-11                      |
| `listings/plugin/` (`plugin.json`, ...) | OpenAI (ChatGPT and Codex) and Cursor plugin bundle       | Agent Plugins 1.0.0 `plugin` and `mcp` schemas, plus rules        |
| `listings/cursor-install.json`          | Cursor install links (remote and stdio)                   | decodes to its config; no secret in it                            |
| `listings/claude-connector.json`        | Values for Anthropic's connector submission form          | documented requirements (no published schema)                     |
| `listings/docker/` (`server.yaml`, ...) | A pull request to docker/mcp-registry (`servers/sess/`)   | generated only; Docker's own CI checks it on the pull request     |
| `listings/cline-issue.md`               | The text of a submission issue in `cline/mcp-marketplace` | generated only; `OWNER:` lines mark what is not yet true or known |
| `listings/plugin/assets/` (the icons)   | Every store that takes an icon upload                     | PNG IHDR size and pinned SHA-256 (copied, not generated)          |

The plugin bundle holds `plugin.json`, Cursor's `.cursor-plugin/plugin.json` (see [Cursor](#cursor)),
`mcp.json` (exactly one server: the remote endpoint), a
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
`https://sess.si/assets/icons/24eb73d4a4d9/icon-192.png`. A GET of each returned 200 with
`image/png` on 2026-11-04, with the SHA-256s above, so `icons.status` is `live`.

Sizes the stores need: OpenAI and Claude take a square PNG of at least 48x48 (the 512 is the
primary icon, the 192 OpenAI's composer icon); the MCP Registry takes any size named in `sizes`;
Docker takes a URL. **Cline asks for 400x400, which is not deployed yet.** It is in w1991e/sess
PR #1019, not merged at this writing and not deployed until a founder window. `listing.json` names
no URL for it and this repository holds no copy of it until it is deployed. That change also moves the `icons.json` version, so recheck the
`24eb73d4a4d9` URLs after that deploy.

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

Annotations are hints for hosts, not part of the versioned `sess-mcp-tools/5` schemas. Each tool's `annotations.title` equals its `title`, because Anthropic's connector submission reads it from there (founder 2026-11-05 00:55Z).

`sess_complete` is marked destructive because it is terminal (founder's ruling on #43). Cursor's run approval isn't established to depend on this hint: its MCP and Run Modes pages (read 2026-11-05) say it asks for approval on MCP tools by default, and they name no annotation.

## Before any submission

`npm run check:listing` lists what is still open. Today:

- for Cursor: `https://mcp.sess.si/mcp` passed on claude.ai (see
  [Claude](#claude-connector-directory-review)) and in the founder's Cursor round (see
  [Cursor](#cursor)), so `remote.status` and `providers.cursorInstall.remoteStatus` are `qualified`.
  The reconnect defect C-3 is being fixed server-side in w1991e/sess, and the prompts, signed 2026-11-05
  05:50Z, are not yet run on any host;
- for OpenAI: the ChatGPT run exists (w1991e/sess
  `EXECUTION/evidence/host-runs-production-2026-10-28/chatgpt.md`, PASS at `66f5dc09`) but is not
  marked qualified, and Codex has no production run;
- for Docker: OAuth through Docker's Toolkit is untested; the founder tests it with
  `docker mcp oauth authorize sess` (see [Docker](#docker));
- for Cline only: the 400x400 PNG deployed (w1991e/sess PR #1019; see [Icon](#icon)), and watching
  Cline set the server up from the README alone (see [Cline](#cline));
- a demo recording URL (OpenAI), and a reviewer test account entered in each portal, never in the
  package. OpenAI requires one that signs in without email or SMS codes or magic links.

After any change to `listing.json`, run `npm run listing` and commit the result.

`compatibility.json` still has stale lines (it calls 0.1.1 "prepared" and "unpublished", and its
`registry` block calls the entry remote-only and not submitted; npm has 0.1.1 on `latest`, and the
Registry lists it). It ships in the package, so they are corrected at the next release.

## Owner submission steps

Every description quoted below is `listing.json`'s signed copy. `npm run check:listing` fails when these steps stop quoting listing.json's
current values.

### MCP Registry

Official registry only (`registry.modelcontextprotocol.io`), under the domain namespace
`si.sess/*`: the server is `si.sess/sess`. DNS authentication of `sess.si` grants `si.sess/*`
(the reverse-DNS form of the domain). It needs no GitHub account; it needs the TXT record on
`sess.si` (`v=MCPv1; k=ed25519; p=<public key>`, already in place) and its Ed25519 private key,
which the owner keeps in the macOS Keychain item `sess-mcp-registry-ed25519`. The key never goes
into this repository, a file, a log, a chat or an agent prompt.

**0.1.1 is published and listed** (founder 2026-11-06 02:50Z). The founder published it from
master's `server.json` at about 02:49Z (validate, DNS TXT, DNS login and publish all OK). The
Registry's public API read back `si.sess/sess` 0.1.1, status `active`, `publishedAt`
2026-11-06T02:49:36Z, `isLatest` true, with one remote, `https://mcp.sess.si/mcp`
(`streamable-http`), and one package, the npm stdio package `@sess.si/mcp` 0.1.1. The registry
checks a listed npm package's `mcpName` against the server name
(https://modelcontextprotocol.io/registry/package-types); `@sess.si/mcp@0.1.1`, on npm `latest`,
declares `si.sess/sess` (`providers.mcpRegistry.npmPackage.status` `listed`). 0.1.0 remains as a
prior version: remote-only, `active`, published 2026-11-05T00:33:45Z, not latest.

`server.json` names `package.json`'s exact version (and the listed npm package's), and
stays in step with it on every release candidate (2026-10-20): `npm run listing` writes
it, and `npm run check:listing`, the registry-metadata test and the release guard fail when they
differ. It never names a dist-tag. The registry does not verify the remote URL;
`https://mcp.sess.si/mcp` passed production host qualification on claude.ai (see
[Claude](#claude-connector-directory-review)). The entry also reaches hosts and indexes with no
production run of ours, such as VS Code, Zed and PulseMCP; publishing it qualifies none of them.
`server.json` `icons` lists the two icon URLs (`512x512` and `192x192`, `image/png`), which answer
(see [Icon](#icon)). `websiteUrl` is `https://sess.si`; `repository` names `https://github.com/w1991e/sess-sdk`.

`npm run check:listing` validates `server.json` against the pinned 2025-12-11 schema, and CI also
runs the registry's own validator (`mcp-publisher validate`, pinned v1.8.1 by SHA-256; no login,
no publish).

Owner commands, in the owner's own terminal:

1. Install the pinned publisher (macOS arm64 shown; other platforms from the same release):
   `curl -fsSLO https://github.com/modelcontextprotocol/registry/releases/download/v1.8.1/mcp-publisher_darwin_arm64.tar.gz`,
   check `shasum -a 256` is
   `e45e520892460732a4bdf37255576415d4a53ec171f8b913faf15bb1aef7cb77`, then
   `tar -xzf mcp-publisher_darwin_arm64.tar.gz mcp-publisher`.
2. From `adapters/mcp` at the commit that carries the signed copy (master, as for the 0.1.1
   publish): `../../mcp-publisher validate server.json` (or the path you extracted it to).
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

   `mcp-publisher` accepts the private key only as a command argument, so this login step exposes
   it briefly on the owner's machine (the process list while it runs, and shell history if the
   command is typed carelessly). The procedure is unchanged for now (founder 2026-11-06 02:50Z).

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

- Install links (`listings/cursor-install.json`) need no submission. The remote link decodes to
  `https://mcp.sess.si/mcp` and its status is `qualified`, from the founder's production round through
  the one-click install, 2026-11-05, on the drill account, with no outside user: authorization PASS in
  Chrome and Safari, exchange PASS (`sess_ask`, link, answer, `sess_response`, `sess_complete`,
  receipt). Recorded from his message, which names no deployed `git_sha`. The test cases weren't run
  (see [Requalification](#requalification-on-production)). This is not a submission to, or an
  acceptance by, Cursor's marketplace.
- A reconnect defect (C-3) is being fixed server-side in w1991e/sess.
- The stdio link names `@sess.si/mcp@0.1.1`, which is published on npm (`latest`). Its status stays `published`:
  the round used the remote link, and published is not qualified.
- These links belong on the setup page. Nothing here puts them there: that page is built in
  w1991e/sess from its own host matrix, whose Cursor entry has its own `qualified` field.
- On Cursor, a plain "Ask me…" prompt is answered by Cursor's own question panel (founder 2026-11-05,
  C-2). `copy.defaultPrompts` and test-case prompt 1 now name Sess, in his form "Use Sess to ask me …, then tell
  me what I chose." The exact sentences are signed (2026-11-05 05:50Z), and no host has run them. The plugin bundle is
  shared, so OpenAI's listing receives them too.
- Submitted 2026-11-06 (02:13Z), awaiting Cursor's review; not listed, not accepted. The founder
  submitted a publisher application at https://cursor.com/marketplace/publish: organization Sess,
  publisher handle `sess`, logo `https://sess.si/assets/icons/24eb73d4a4d9/icon-512.png`, website
  `https://sess.si`, and the public repository https://github.com/w1991e/sess-cursor-plugin, with
  the plugin at its root: `.cursor-plugin/plugin.json` plus this bundle at tag `mcp-v0.1.1`.
  The founder's requalification round on production passed (founder-reported, corrected 02:27Z). It started
  about 01:49Z on the production deployment then serving `@sess.si/mcp` 0.1.0, and completed about
  20 minutes later, after the deployment serving 0.1.1 read back at 01:57Z. Cursor kept polling
  across the deploy and completed with no continue step. This is not a claim that the round ran
  wholly on 0.1.1, and the per-case table under Requalification is unchanged.
- `listings/plugin/.cursor-plugin/plugin.json` is generated from `listing.json`
  (`providers.cursorPlugin`) and is the submitted file byte for byte; `check:listing` holds it to
  this server, `package.json`'s version, the bundle's `mcp.json` and the primary icon.
- The public repository is regenerated from this bundle (`listings/plugin/`, copied to its root),
  and the founder pushes it. Nothing here pushes it. Record acceptance or a listing only from
  Cursor's own confirmation.

### Claude (connector directory review)

Eligible for the remote endpoint with OAuth; Anthropic no longer accepts MCPB bundles there. Every
tool has a title and read-only/destructive hints. The five positive test cases passed on claude.ai (see
[Test cases on claude.ai](#test-cases-on-claudeai)). Submit at claude.ai/directory/manage (Submit new,
MCP connector) with the values in `listings/claude-connector.json`: name, one-liner, description,
categories, documentation and privacy policy URLs, support contact `ask@sess.si`, and the icon
`listings/plugin/assets/icon-512.png` (its `icon` field). Add the permanent slug (the owner's
choice), a test account with every step, the data-handling answers and the acknowledgements in the
portal.

The packet's status is `qualified` from two production rounds on claude.ai as a custom connector,
in w1991e/sess `EXECUTION/evidence/`: `host-runs-production-2026-10-28/claude-ai.md` (PASS on the
second prompt, recorded as a pass with one re-orientation) and
`host-runs-production-2026-11-01/claude-ai.md` (PASS, the hosted `/mcp` at `@sess.si/mcp` 0.1.0,
#947). That is not a submission to Anthropic's review, and nothing here has been accepted by it.

### Smithery

**Not available (closed 2026-10-31; curated directory).** Smithery closed self-service publishing on
2026-10-31 and is now a curated directory (founder 2026-11-06, about 02:55Z). No submission was
made, and Smithery is not a pending or next submission. The steps below are kept as history only;
they no longer work.

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
   `Let your agent ask a person and continue with their answer.`;
   homepage `https://sess.si`; icon
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
  `Let your agent ask a person and continue with their answer.`;
  server URL `https://mcp.sess.si/mcp`; support `ask@sess.si`.

### mcp.so

Sources: third-party guides only, **unverified**. The form at https://mcp.so/submit takes the
GitHub URL, a one- or two-sentence description, three to five tags and a category; mcp.so then
reads the README.

- GitHub URL: `https://github.com/w1991e/sess-sdk/tree/master/adapters/mcp`
- Description: `copy.long` from `listing.json`. It opens with
  `Let your agent ask a person and continue with their answer. Your agent describes a form and gets a link at once.`;
  if the form holds only that, paste that part.
- Tags: `human-in-the-loop`, `forms`, `approvals`, `receipts`, `mcp`
- Category: `Productivity` (the nearest of the form's categories, if it differs)
- Server URL, if asked: `https://mcp.sess.si/mcp`

### Cline

Source: https://github.com/cline/mcp-marketplace (README and the template
`.github/ISSUE_TEMPLATE/mcp-server-submission.yml`, read 2026-11-04). Submission is a new issue in
`cline/mcp-marketplace` with the "MCP Server Submission" template, not a pull request. The exact
text is `listings/cline-issue.md`; resolve its `OWNER:` lines.

1. Wait for the 400x400 PNG, w1991e/sess PR #1019, to be merged and deployed. **It is not merged at
   this writing and not deployed until a founder window** (see [Icon](#icon)); do not submit a
   resized copy. A GET of its URL must return 200 with
   `image/png`; put that URL in Logo Image.
2. Watch Cline set the server up from the README or `llms-install.md` alone. The submitter ticks
   that box only after doing so; that has not been done. The README's Cline section is the path to test.
3. Tick "The server is stable and ready for public use" only if you confirm it.
4. Open the issue from the owner's account:
   - GitHub Repository URL: `https://github.com/w1991e/sess-sdk/tree/master/adapters/mcp`
   - Additional Information opens with
     `Let your agent ask a person and continue with their answer.`

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

### Test cases on claude.ai

Founder run, claude.ai (web), 2026-11-04 20:48Z–21:18Z, on production `1a5f43a9`, as a custom connector at the
hosted endpoint on the qualification account. Recorded from the founder's message: **5 of 5 PASS** with
prompts 2–5 naming Sess. As first written, prompts 2 and 3 missed routing: the host answered in the
chat and called no tool, in two chats for prompt 2 and one for prompt 3. `listing.json` now holds the
prompts that passed, except prompt 1: as run it read "Ask me on my phone which time works for a call
tomorrow.", and it has since gained Sess's name (founder 2026-11-05, C-2). Case 5 was answered inside the wait, so the delayed path it describes was
exercised in the runs of prompts 2 and 4. This run does not count as OpenAI's, whose status stays as
`listing.json` gives it.

Findings:

- **F-LT-1, routing.** A prompt that only says "ask me" is answered in the chat on claude.ai. One that
  says "through Sess" or "on my phone" reaches the tools. The `sess_ask` and `sess_request`
  descriptions now name this case; not yet released or requalified.
- **F-LT-2, the 45-second wait.** When the person answers after the wait returns, the host says the form
  is still open and asks to be told to continue. The person's page keeps the waiting shape until the
  host completes. This is designed behaviour.
- **F-LT-3, two devices on one link.** The link was open on the desktop and answered on the phone. The
  desktop form didn't switch to the answered state by itself; a submit there was refused as already
  answered, which is correct. Medium.
- **F-LT-4, re-wait.** The wait returned before the answer in three of five runs. The host then stops
  until told "continue". A mitigation is to call `sess_response` again up to three times before asking.
  High. The server instructions, the `sess_response` description and its waiting result now ask for
  this; not yet released or requalified.

### Requalification on production

The founder runs this on production after `@sess.si/mcp` 0.1.1 is pinned and deployed, on claude.ai and
Cursor. Record pass or fail per host from his message, never from a generated file. Cases 1 to 5 are the
positive test cases in `listing.json`. The two negative cases check that the routing lines don't pull an
ordinary question into a form (founder 2026-11-04 22:50Z); the guard isn't tightened before they're measured.

| Case     | Prompt or kind                                                 | Expected                    | claude.ai | Cursor   |
| -------- | -------------------------------------------------------------- | --------------------------- | --------- | -------- |
| 1 to 5   | as in `listing.json`                                           | as in `listing.json`        | not run   | not run  |
| N1       | "What do you think I should name this file? Ask me if unsure." | stays in chat, no Sess tool | not run   | not run  |
| N2       | a plain clarifying question with no tool named                 | stays in chat, no Sess tool | not run   | not run  |
| Exchange | the qualifying round: `sess_ask` through to the receipt        | a receipt-checked answer    | not run   | PASS (a) |

(a) The founder's round of 2026-11-05, recorded from his message, before 0.1.1 exists on npm. It
qualifies the Cursor packet and is not the requalification above. His message marks no listed case, so
cases 1 to 5, N1 and N2 stay not run on Cursor.

### Docker

Source: https://github.com/docker/mcp-registry/blob/main/CONTRIBUTING.md (read 2026-10-28),
"Adding a Remote MCP Server". Submission is a pull request to `docker/mcp-registry` that adds
`servers/sess/` with the three generated files in `listings/docker/`, copied unchanged:
`server.yaml` (`name` `sess`, `type: remote`, `dynamic.tools: true`, `meta.category`
`productivity`, `meta.tags`, `about.title` `Sess`, `about.description` (the registry
description), `about.icon` `https://sess.si/assets/icons/24eb73d4a4d9/icon-512.png`, `remote`
`streamable-http` at `https://mcp.sess.si/mcp`, and `oauth`), `tools.json` (`[]`: tools are
discovered) and `readme.md` (the documentation link).

The pull request is open: docker/mcp-registry#6618. Submitted is not accepted. Its OAuth test is not
done; test it locally as the guide shows: `task catalog -- sess`, then `docker mcp catalog import`,
`docker mcp server enable sess` and `docker mcp oauth authorize sess`.

Its answer on test credentials is self-serve sign-in: any email address, an emailed code, the free
plan. No account is created or shared for Docker, and credentials never go into the pull request. If
Docker requires fixed credentials, that goes to the founder.

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
  Docker (on docker/mcp-registry#6618) or by the local `docker mcp oauth authorize` test.
