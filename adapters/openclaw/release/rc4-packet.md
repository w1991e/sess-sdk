# Release packet: `@sess.si/openclaw@0.1.0-rc.4`

Maintainer document; not packed. Preparing this candidate publishes nothing. The tag, the
`npm-openclaw-release` environment approval and the npm 2FA stage approval are a maintainer's
actions.

## What rc.4 contains

- One runtime dependency, exact and unchanged from rc.3: `@sess.si/sdk@0.1.0-rc.8` (published on
  `next`). `package-lock.json` resolves it from the registry, and `scripts/registry-sdk.mjs
--registry` checks the pin, lock, installed tree and registry. `openclaw` `2026.10.3` stays a
  peer dependency.

  | Field     | Value                                                                                             |
  | --------- | ------------------------------------------------------------------------------------------------- |
  | Tarball   | `https://registry.npmjs.org/@sess.si/sdk/-/sdk-0.1.0-rc.8.tgz`                                    |
  | SHA-256   | `b533935b98020354010ca4e1a14901e8bc5218ca4b129422a8f8a6fa97684c95`                                |
  | Integrity | `sha512-TlON9nYHkuFl6Al0TeGl9GUiPx65QpvpOBOHGdIp/ukt+3xXM5b2+4//pMN5RB0lsf031GoSZQFsXvkFScuykA==` |

- A plan refusal is definite (#88). A create that Sess refuses with HTTP 429 `PLAN_LIMIT_REACHED`
  makes `sess_request` fail with `PLAN_LIMIT_REACHED` (class `create_rejected`) and a fixed
  message; a redelivery of the same host call reports the same and sends nothing. In rc.3 it was
  `CREATE_OUTCOME_UNKNOWN` ("a Session may exist"), though nothing had been created. Sess's own
  message and its link are not relayed; a plain rate limit is still an unknown create outcome.
  `tests/unit/convergence.test.ts` covers it; the README Errors table lists the code.
- Packed hygiene (#82). The packed check also checks the exact tarball: no source maps, test
  fixtures, non-public hosts, credential-shaped strings or internal references
  (`scripts/check-packed-hygiene.mjs` at the repository root). `compatibility.json` no longer
  carries internal references.
- `compatibility.json` records the publication of rc.3 (2026-10-23, release run 39995130479;
  registry SHA-256 and integrity equal [rc3-packet.md](rc3-packet.md)); rc.2 and rc.1 move to
  `earlierPublications`.
- The four tools, tool schema version 1, the setup/doctor/prune CLI and the bundled skill are
  otherwise unchanged from rc.3. Qualified host: OpenClaw `2026.10.3` on Node 24.

Commits on `master` since `openclaw-v0.1.0-rc.3` (`ade8f83`) that change `adapters/openclaw`:

| Commit    | Change                                                                                                  |
| --------- | ------------------------------------------------------------------------------------------------------- |
| `3e9f4e2` | Packed-tarball hygiene guard in the packed check; internal references out of `compatibility.json` (#82) |
| `dcc2026` | A plan limit (429 `PLAN_LIMIT_REACHED`) is a definite refusal, not an unknown outcome (#88)             |

The other commits since that tag (`2ab260f` #81, `043802c` #84, `722810a` #85, `7fcf100` #83,
`0763daf` #86, `7bd8153` #87) change CI pins, the SDK, MCP, create-agent, recipes or docs, not
this package's packed files. The full list of changes is in [CHANGELOG.md](../CHANGELOG.md).

## Expected tarball

Computed by `node scripts/check-package.mjs --registry --host`, the release workflow's packed
check, which records `.artifacts/package-result.json` (`sdkSource` `registry`,
`sourceTreeDirty` `false`). Run at clean commit `b6fdaf4` on Node 24.21.0 and npm 11.19.0, the
versions the workflow pins, after the workflow's `npm ci`, build, typecheck and tests; the
real-host install passed on OpenClaw `2026.10.3`. A second build reproduced the same integrity.
This packet is not in the tarball (`release/` is outside `files`).

| Field     | Value                                                                                             |
| --------- | ------------------------------------------------------------------------------------------------- |
| Filename  | `sess.si-openclaw-0.1.0-rc.4.tgz`                                                                 |
| SHA-256   | `32a15b68dc53c62a34eaa51e8afce47e8ed61caa8bbf8e7efcad6da5dbf3b4af`                                |
| Integrity | `sha512-uUFVi9D35Id9GKjOAeMyysEivNj0zEnbkvOxNtmP0FwenYnv7Ite3ct+yE6NCZaNVdZNZD7DpICosdunJ+pC7Q==` |

The release workflow does not read this table; the prepare job's run summary is the record of the
bytes it tested. If another packed change (`dist/` sources, `openclaw.plugin.json`, `skills/`,
`compatibility.json`, `README.md`, `CHANGELOG.md`, `LICENSE`, `NOTICE` or `package.json`) lands
before the tag, re-run the packed check and update this table in the same PR.

## Maintainer steps

1. Confirm the reviewed PR carrying this packet is merged and its CI is green on master. Note the
   merged master commit `<sha>` and check that it is still version `0.1.0-rc.4`:
   `git show <sha>:adapters/openclaw/package.json | grep '"version"'`.
2. Tag that exact commit and push the tag:

   ```sh
   git tag openclaw-v0.1.0-rc.4 <sha>
   git push origin openclaw-v0.1.0-rc.4
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
   shasum -a 256 sess.si-openclaw-0.1.0-rc.4.tgz   # must equal the SHA-256 above
   npm stage view <stage-id>                       # tag must be next
   npm stage approve <stage-id>                    # npm 2FA
   ```

6. The readback job waits for the approval, then checks version, integrity, the `next` dist-tag,
   repository and directory, dependencies and peer dependencies, and provenance. If it timed out,
   re-run the failed jobs after approving.
7. Read back yourself:

   ```sh
   npm view @sess.si/openclaw@0.1.0-rc.4 version dependencies dist.integrity dist.attestations --json
   npm view @sess.si/openclaw dist-tags --json     # next: 0.1.0-rc.4; latest stays 0.0.0-stage
   ```

   `dist.integrity` must equal the integrity above, `dependencies` must name
   `"@sess.si/sdk": "0.1.0-rc.8"`, and `dist.attestations.provenance` must be present. `latest`
   must not point at a prerelease.

## After publication

Run a clean native install from the registry on the qualified host
(`openclaw plugins install npm:@sess.si/openclaw@0.1.0-rc.4`) and record it in a separate reviewed
PR. ClawHub listing is a separate, separately authorized action (see [RELEASING.md](../RELEASING.md)).
