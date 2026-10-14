# Installed-package quickstart (Node)

A runnable program that uses the installed `@sess.si/sdk` package. It creates one interactive
Session, prints its private human link, waits a bounded time for the person's answer, verifies the
decision receipt, validates the business data, and completes the Session. It is plain Node ESM
JavaScript ([index.mjs](index.mjs)); there is no build step. This directory is not part of the
published package.

## Prerequisites

- Node.js 22.14.0 or later (checked on 22.14.0 and 24.21.0).
- A SESS API key for the workspace you want to use. That is the only setting the ordinary path
  needs: the workspace is taken from the API's authenticated responses. Use synthetic data; this
  example pays and sends nothing.

## Install

Copy this directory somewhere outside the SDK repository. [package.json](package.json) declares the
exact SDK version, the one pinned with its digests in the SDK repository's
[release/sdk-candidate.json](../../release/sdk-candidate.json). No lockfile is shipped.

### Release candidate (before publication)

If that exact version is not on the registry yet (`npm view @sess.si/sdk versions`), `npm install`
alone cannot resolve it. Install the candidate tarball explicitly, and only after checking that its
SHA-256 equals the pinned digest:

```sh
# In the SDK repository: pack the current root; the script accepts only the pinned bytes
# (or use the tarball you were given).
node scripts/sdk-pin.mjs pack --build --out /tmp/sess-candidate

# Verify the digest. It must print exactly the "sha256" value in release/sdk-candidate.json:
sha256sum /tmp/sess-candidate/sess.si-sdk-*.tgz      # Linux
shasum -a 256 /tmp/sess-candidate/sess.si-sdk-*.tgz   # macOS

# In your copy of this directory: install the verified tarball without lifecycle scripts.
npm install --ignore-scripts /tmp/sess-candidate/sess.si-sdk-*.tgz
```

The digest identifies the candidate tarball as distributed. Packing reproduced it with npm 10.9.2
(Node 22.14.0) and npm 11.19.0 (Node 24.21.0); another toolchain may produce different bytes — in that
case use the tarball you were given. Do not install a tarball whose digest differs. Installing a
tarball records a local `file:` dependency in your copy's package.json; that is expected for the
candidate.

### Published release (after publication)

Once the declared version is published to npm, the dependency resolves normally:

```sh
npm install --ignore-scripts
```

## Run

Enter the key without echoing it and without putting it in your shell history or on a command line,
then start the program:

```sh
read -rs SESS_API_KEY && export SESS_API_KEY   # paste the key, then press Enter
npm start
unset SESS_API_KEY                             # when you are done
```

You can also load `SESS_API_KEY` from your secret manager. Never pass it as an argument.

The program prints the human URL **before** it starts waiting. That URL is a bearer link: anyone
who holds it can respond, so open it yourself or deliver it privately to the intended person. Do not
paste it into logs, tickets or chat channels.

Optional environment (not needed for the ordinary path):

| Variable                        | Meaning                                                                   |
| ------------------------------- | ------------------------------------------------------------------------- |
| `SESS_API_URL`                  | Non-default API origin. HTTPS only.                                       |
| `SESS_ALLOW_INSECURE_LOCALHOST` | `1` permits `http://localhost` for local runtime tests only.              |
| `SESS_EXPECTED_WORKSPACE_ID`    | Pin an expected workspace for receipt verification instead of the header. |
| `SESS_WAIT_SECONDS`             | Total wait, 5 to 900 seconds. Default 180.                                |
| `SESS_SESSION_ID`               | Resume waiting on an existing Session instead of creating a new one.      |

## What the person sees

A hosted SESS page titled "Confirm a synthetic amount" with a short instruction, a labeled amount
field prefilled with 120, and a "Submit amount" button. After submitting, the page confirms the
response. SESS renders the page; the example sends only typed data.

## What the program prints

- The Session ID and the human URL (once, at creation, before waiting).
- `Still waiting` and a resume command if the wait ends without a response (exit code 3), or a
  resume command after Ctrl+C (exit code 130). Neither creates another Session; resuming with
  `SESS_SESSION_ID=ses_... npm start` waits on the same Session and revision.
- After the response: its event ID and the verified, validated amount.
- The completed Session status as confirmed by the API.

It never prints the API key or receipt contents. An uncertain create or complete outcome is
reported as uncertain, never as success, and creation is never retried automatically.

## Clean install check (maintainers and CI)

[scripts/clean-install-check.mjs](scripts/clean-install-check.mjs) copies this directory to a fresh
temporary directory outside the repository (no `node_modules` in any ancestor), packs the
candidate with `scripts/sdk-pin.mjs pack --build` (or takes `--tarball <path>` /
`SESS_SDK_CANDIDATE_TGZ`) and accepts the tarball only if its SHA-256 is the pinned digest, installs it with `--ignore-scripts`, then runs `index.mjs`
against a deterministic fake SESS API on loopback. The fake serves create, retrieve, the immutable
Surface, complete, and a genuinely Ed25519-signed receipt with its key set. The program's
environment holds only `SESS_API_KEY` plus the loopback API URL and opt-in, so the check proves the
key alone suffices, the human URL is printed before waiting, the response verifies and the Session
completes. No SESS traffic leaves loopback; `npm install` fetches the SDK's pinned public
dependencies from the configured npm registry or cache. Run it from the SDK repository:

```sh
node examples/quickstart-node/scripts/clean-install-check.mjs
```

CI runs it on Node 22.14.0 and 24.21.0 (`.github/workflows/quickstart-ci.yml`).

## Local smoke (maintainers)

[scripts/smoke.mjs](scripts/smoke.mjs) drives this program against an isolated loopback SESS runtime
with synthetic credentials, submitting the human form with plain HTTP. It is opt-in
(`SESS_QUICKSTART_SMOKE=1`), refuses non-loopback origins and is not run by public CI.
