# Release packet: `@sess.si/openclaw@0.1.0-rc.3`

Maintainer document; not packed. Preparing this candidate publishes nothing. The tag, the
`npm-openclaw-release` environment approval and the npm 2FA stage approval are a maintainer's
actions.

## What rc.3 contains

- One runtime dependency, exact: `@sess.si/sdk@0.1.0-rc.8` (published on `next`), from rc.7.
  `package-lock.json` resolves it from the registry, and `scripts/registry-sdk.mjs --registry`
  checks the pin, lock, installed tree and registry. `openclaw` `2026.10.3` stays a peer dependency.

  | Field     | Value                                                                                             |
  | --------- | ------------------------------------------------------------------------------------------------- |
  | Tarball   | `https://registry.npmjs.org/@sess.si/sdk/-/sdk-0.1.0-rc.8.tgz`                                    |
  | SHA-256   | `b533935b98020354010ca4e1a14901e8bc5218ca4b129422a8f8a6fa97684c95`                                |
  | Integrity | `sha512-TlON9nYHkuFl6Al0TeGl9GUiPx65QpvpOBOHGdIp/ukt+3xXM5b2+4//pMN5RB0lsf031GoSZQFsXvkFScuykA==` |

- Form-2 receipts verify. rc.8 bundles the renderer identities `sess-html-form-1` and
  `sess-html-form-2`, so `sess_response`, and the re-verification before `sess_publish` and
  `sess_complete`, accept an answer given on Sess's form-2 renderer and verify it offline. The
  published rc.2 depends on rc.7, which rejects every form-2 receipt.
  `tests/unit/tools.test.ts` ("renderer identities") signs a form-2 receipt and runs it through the
  real SDK verifier, then publishes the next round.
- Sess's length limits in the tool schemas, with `field`, `limit` and `length` on a length error (#75).
- The four tools, tool schema version 1, the setup/doctor/prune CLI and the bundled skill are
  otherwise unchanged from rc.2. Qualified host: OpenClaw `2026.10.3` on Node 24.

The full list of changes is in [CHANGELOG.md](../CHANGELOG.md).

## Expected tarball

Computed by `node scripts/check-package.mjs --registry --host`, the release workflow's packed
check, which records `.artifacts/package-result.json`. Run at clean commit `58bbe8f` on Node
24.21.0 and npm 11.19.0, the versions the workflow pins; the real-host install passed on OpenClaw
`2026.10.3`. A rebuild reproduced the same integrity.

| Field     | Value                                                                                             |
| --------- | ------------------------------------------------------------------------------------------------- |
| Filename  | `sess.si-openclaw-0.1.0-rc.3.tgz`                                                                 |
| SHA-256   | `8563755bc02f9d4e55cd04f4c0b19ab16984add1bca432aab3346f22f0a60c26`                                |
| Integrity | `sha512-lJXZujmNYBswOPHO3cBp8zSXm+5Y14xqZCHf195FnfK/NCp9hTBB/OmSvhJQK5wGDcx5xJIeEvNH22M+mBHXsg==` |

The release workflow does not read this table; the prepare job's run summary is the record of the
bytes it tested. If another packed change (`dist/` sources, `openclaw.plugin.json`, `skills/`,
`compatibility.json`, `README.md`, `CHANGELOG.md`, `LICENSE`, `NOTICE` or `package.json`) lands
before the tag, re-run the packed check and update this table in the same PR.

## Maintainer steps

1. Confirm the reviewed PR carrying this packet is merged and its CI is green on master. Note the
   merged master commit `<sha>` and check that it is still version `0.1.0-rc.3`:
   `git show <sha>:adapters/openclaw/package.json | grep '"version"'`.
2. Tag that exact commit and push the tag:

   ```sh
   git tag openclaw-v0.1.0-rc.3 <sha>
   git push origin openclaw-v0.1.0-rc.3
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
   shasum -a 256 sess.si-openclaw-0.1.0-rc.3.tgz   # must equal the SHA-256 above
   npm stage view <stage-id>                       # tag must be next
   npm stage approve <stage-id>                    # npm 2FA
   ```

6. The readback job waits for the approval, then checks version, integrity, the `next` dist-tag,
   repository and directory, dependencies and peer dependencies, and provenance. If it timed out,
   re-run the failed jobs after approving.
7. Read back yourself:

   ```sh
   npm view @sess.si/openclaw@0.1.0-rc.3 version dependencies dist.integrity dist.attestations --json
   npm view @sess.si/openclaw dist-tags --json     # next: 0.1.0-rc.3; latest stays 0.0.0-stage
   ```

   `dist.integrity` must equal the integrity above, `dependencies` must name
   `"@sess.si/sdk": "0.1.0-rc.8"`, and `dist.attestations.provenance` must be present. `latest`
   must not point at a prerelease.

## After publication

Run a clean native install from the registry on the qualified host
(`openclaw plugins install npm:@sess.si/openclaw@0.1.0-rc.3`) and record it in a separate reviewed
PR. ClawHub listing is a separate, separately authorized action (see [RELEASING.md](../RELEASING.md)).
