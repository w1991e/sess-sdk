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
- User-Agent. Every request to Sess carries `User-Agent: sess-openclaw/0.1.0-rc.4`, the product
  token Sess classifies a creating client by. The plugin's guarded fetch sets it: the SDK rc.8
  accepts a `fetch` option but sends no User-Agent of its own and has no option to prepend one. An
  SDK that sends its own token keeps it after the plugin's. `tests/unit/user-agent.test.ts` asserts the exact header at a local HTTP server.
- The four tools, tool schema version 1, the setup/doctor/prune CLI and the bundled skill are
  otherwise unchanged from rc.3. Qualified host: OpenClaw `2026.10.3` on Node 24.

Commits on `master` since `openclaw-v0.1.0-rc.3` (`df4083b`) that change `adapters/openclaw`:

| Commit    | Change                                                                                                  |
| --------- | ------------------------------------------------------------------------------------------------------- |
| `40c0aca` | Packed-tarball hygiene guard in the packed check; internal references out of `compatibility.json` (#82) |
| `842f6ed` | A plan limit (429 `PLAN_LIMIT_REACHED`) is a definite refusal, not an unknown outcome (#88)             |
| `1ac4f2e` | Version 0.1.0-rc.4, changelog, compatibility record and this packet (#89)                               |
| `7aca9e7` | `User-Agent: sess-openclaw/0.1.0-rc.4` (branch `release/ua-tokens`; its squash commit once merged)      |

The other commits since that tag (`dec1103` #81, `dc6a997` #84, `a1348cd` #85, `82352fa` #83,
`10cf42a` #86, `b98eee5` #87, `0886c5a` #90) change CI pins, the SDK, MCP, create-agent, recipes or
docs, not this package's packed files. The full list of changes is in [CHANGELOG.md](../CHANGELOG.md).

## Expected tarball

Computed by `node scripts/check-package.mjs --registry --host`, the release workflow's packed
check, which records `.artifacts/package-result.json` (`sdkSource` `registry`,
`sourceTreeDirty` `false`). Re-prepared for the User-Agent change: run at clean commit `7aca9e7`
on Node 24.21.0 and npm 11.19.0, the versions the workflow pins, after the workflow's `npm ci`,
build, typecheck and tests (160 passed); the real-host install passed on OpenClaw `2026.10.3`. A
second build reproduced the same integrity. This packet is not in the tarball (`release/` is
outside `files`). It replaces the earlier rc.4 bytes (SHA-256 `32a15b68…b4af`), which were never
tagged or published.

| Field     | Value                                                                                             |
| --------- | ------------------------------------------------------------------------------------------------- |
| Filename  | `sess.si-openclaw-0.1.0-rc.4.tgz`                                                                 |
| SHA-256   | `fc8041f00fbc946a4e36bd878aaa12f27b200a244a5f19bd1c109d6d1d4f4553`                                |
| Integrity | `sha512-xCtfm5sw/85k6DDQve1py4jSNkTyN4ZYgcTOPSeEmZptAv3mHbIFHIkCjG6cPxFhN6LaZMptBLQ93XhiQP62Eg==` |

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
