# Release packet: `@sess.si/openclaw@0.1.0-rc.1`

Maintainer document; not packed. Preparing this candidate publishes nothing. The tag, the
`npm-openclaw-release` environment approval and the npm 2FA stage approval are a maintainer's
actions.

## What rc.1 contains

- The native OpenClaw plugin `sess` with four optional tools (`sess_request`, `sess_response`,
  `sess_publish`, `sess_complete`; tool schema version 1), host binding to agent, session key and
  session incarnation, durable interaction records in OpenClaw plugin state, full SDK receipt
  verification and a fresh current-revision read before any answer is released.
- `openclaw sess setup` (preview by default; `--yes` applies an additive change),
  `openclaw sess doctor` and `openclaw sess prune`, and the bundled `sess` skill.
- Qualified host: OpenClaw `2026.10.3` on Node 24 (`compatibility.json`).
- One runtime dependency, exact: `@sess.si/sdk@0.1.0-rc.5`, the published pin in
  [`release/sdk-candidate.json`](../../../release/sdk-candidate.json) (dist-tag `next`).
  `package-lock.json` locks it with the pinned integrity, and `scripts/registry-sdk.mjs --registry`
  checks pin, lock, installed tree and the registry. `openclaw` `2026.10.3` is a peer dependency.
- Person-facing text says "Sess" (README, package and plugin descriptions, CLI help and messages).

The full list of changes is in [CHANGELOG.md](../CHANGELOG.md).

## Expected tarball

Computed by `node scripts/check-package.mjs --registry --host`, the release workflow's packed
check, which records `.artifacts/package-result.json`. Run at a clean tree on Node 24.21.0 and
npm 11.19.0, the versions the workflow pins. A rebuild reproduced the same integrity.

| Field     | Value                                                                                             |
| --------- | ------------------------------------------------------------------------------------------------- |
| Filename  | `sess.si-openclaw-0.1.0-rc.1.tgz`                                                                 |
| SHA-256   | `a46d57d5486637c1965801cdeb865b3a132000a112f59128fc00191d54602b22`                                |
| Integrity | `sha512-OQlchoIk+4f6AKqHQNOJ4YqBngmdqtJKq2EQRE0kZVYukI9em7h9d/OJt3GdDA/QMRqC/mOJ3nhMqCCI0JrU4A==` |

The release workflow does not read this table; the prepare job's run summary is the record of the
bytes it tested. If another packed change (`dist/` sources, `openclaw.plugin.json`, `skills/`,
`compatibility.json`, `README.md`, `CHANGELOG.md`, `LICENSE`, `NOTICE` or `package.json`) lands
before the tag, re-run the packed check and update this table in the same PR.

## One-time setup (before the first tag)

1. **The npm package must exist.** Check with `npm view @sess.si/openclaw dist-tags --json`. If it does not
   exist, a maintainer stages a never-approved bootstrap version locally (`npm stage publish` of a
   placeholder) so that a trusted publisher can be configured. **Do not reject this bootstrap
   stage now** (see maintainer step 6).
2. Only once a public `0.0.0-stage` placeholder exists (npm publishes one with the bootstrap stage),
   and if `latest` lands on it, deprecate it with a pointer to `@next`:
   `npm deprecate @sess.si/openclaw@0.0.0-stage "Placeholder, not a release. Install @sess.si/openclaw@next."`
3. On npmjs.com, add a **stage-only** GitHub Actions trusted publisher for `@sess.si/openclaw`:
   repository `w1991e/sess-sdk`, workflow `openclaw-release.yml`, environment `npm-openclaw-release`,
   direct publishing not permitted.
4. Check that the GitHub environment `npm-openclaw-release` has its required reviewer and the
   `openclaw-v*` tag rule. Do not push an `openclaw-v*` tag before steps 1 to 4 are done.

## Maintainer steps

1. Confirm the reviewed PR carrying this packet is merged and its CI is green on master. Note the
   merged master commit `<sha>` and check that it is still version `0.1.0-rc.1`:
   `git show <sha>:adapters/openclaw/package.json | grep '"version"'`.
2. Tag that exact commit and push the tag:

   ```sh
   git tag openclaw-v0.1.0-rc.1 <sha>
   git push origin openclaw-v0.1.0-rc.1
   ```

3. The workflow **Publish approved OpenClaw adapter release**
   (`.github/workflows/openclaw-release.yml`) starts. Its prepare job runs the guards and their
   self-test, `npm ci`, build, typecheck, tests, the packed check against the registry SDK and a
   real OpenClaw host, and `npm audit`. It uploads the tested tarball and prints its SHA-256 in the
   run summary. That SHA-256 must equal the value above.
4. Approve the `npm-openclaw-release` environment for the publish job. It stages exactly the tested
   tarball with provenance on dist-tag `next` (`npm stage publish`; nothing is installable yet).
5. Check and approve the stage with npm 2FA:

   ```sh
   npm stage list @sess.si/openclaw --json
   npm stage download <stage-id>
   shasum -a 256 sess.si-openclaw-0.1.0-rc.1.tgz   # must equal the SHA-256 above
   npm stage view <stage-id>                       # tag must be next
   npm stage approve <stage-id>                    # npm 2FA
   ```

6. **First release only: now reject the bootstrap stage.** After this release's stage is approved,
   run `npm stage list @sess.si/openclaw --json` and reject the never-approved bootstrap stage. Never reject
   it before: rejecting the bootstrap stage before the first release is approved deletes the npm
   package and its trusted publisher.
7. The readback job waits for the approval, then checks version, integrity, the `next` dist-tag,
   repository and directory, dependencies and peer dependencies, and provenance. If it timed out,
   re-run the failed jobs after approving.
8. Read back yourself:

   ```sh
   npm view @sess.si/openclaw@0.1.0-rc.1 version dist.integrity dist.attestations --json
   npm view @sess.si/openclaw dist-tags --json     # next: 0.1.0-rc.1; latest stays 0.0.0-stage
   ```

   `dist.integrity` must equal the integrity above and `dist.attestations.provenance` must be
   present. `latest` must not point at a prerelease.

## After publication

Run a clean native install from the registry on the qualified host
(`openclaw plugins install npm:@sess.si/openclaw@0.1.0-rc.1`) and record it in a separate reviewed
PR. ClawHub listing is a separate, separately authorized action (see [RELEASING.md](../RELEASING.md)).
