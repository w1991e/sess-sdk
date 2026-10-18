# Release packet: `@sess.si/openclaw@0.1.0-rc.2`

Maintainer document; not packed. Preparing this candidate publishes nothing. The tag, the
`npm-openclaw-release` environment approval and the npm 2FA stage approval are a maintainer's
actions.

## What rc.2 contains

- One runtime dependency, exact: `@sess.si/sdk@0.1.0-rc.7` (published on `next`, integrity
  `sha512-isuZBhvH…K8MQ==`), from rc.5. `package-lock.json` resolves it from the registry, and
  `scripts/registry-sdk.mjs --registry` checks the pin, lock, installed tree and registry.
  `openclaw` `2026.10.3` stays a peer dependency.
- Person-facing text says "Sess" and "Sess link" in the plugin's tool and output strings (#56, #62).
- The package's keywords and homepage are set (#58), and the README opens with the first interaction (#54).
- The four tools, tool schema version 1, the setup/doctor/prune CLI and the bundled skill are unchanged
  from rc.1. Qualified host: OpenClaw `2026.10.3` on Node 24. The rc.1 publication and
  qualification records stay in `compatibility.json`.

The full list of changes is in [CHANGELOG.md](../CHANGELOG.md).

## Expected tarball

Computed by `node scripts/check-package.mjs --registry --host`, the release workflow's packed
check, which records `.artifacts/package-result.json`. Run at a clean tree on Node 24.21.0 and
npm 11.19.0, the versions the workflow pins. A rebuild reproduced the same integrity.

| Field     | Value                                                                                             |
| --------- | ------------------------------------------------------------------------------------------------- |
| Filename  | `sess.si-openclaw-0.1.0-rc.2.tgz`                                                                 |
| SHA-256   | `7c77cd1a80843646163e24af1a0469728074d7a14a5f778dd29b1f5bd7fe3710`                                |
| Integrity | `sha512-ysTmKH8R60n6UwIT7u0ydDqSUMSuXCCcjTALbCJ3joLBBnb3KIJPTyCMA+hI3WwH9jdxelaaHKrE/1Rn5IdPnQ==` |

The release workflow does not read this table; the prepare job's run summary is the record of the
bytes it tested. If another packed change (`dist/` sources, `openclaw.plugin.json`, `skills/`,
`compatibility.json`, `README.md`, `CHANGELOG.md`, `LICENSE`, `NOTICE` or `package.json`) lands
before the tag, re-run the packed check and update this table in the same PR.

## Maintainer steps

1. Confirm the reviewed PR carrying this packet is merged and its CI is green on master. Note the
   merged master commit `<sha>` and check that it is still version `0.1.0-rc.2`:
   `git show <sha>:adapters/openclaw/package.json | grep '"version"'`.
2. Tag that exact commit and push the tag:

   ```sh
   git tag openclaw-v0.1.0-rc.2 <sha>
   git push origin openclaw-v0.1.0-rc.2
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
   shasum -a 256 sess.si-openclaw-0.1.0-rc.2.tgz   # must equal the SHA-256 above
   npm stage view <stage-id>                       # tag must be next
   npm stage approve <stage-id>                    # npm 2FA
   ```

6. The readback job waits for the approval, then checks version, integrity, the `next` dist-tag,
   repository and directory, dependencies and peer dependencies, and provenance. If it timed out,
   re-run the failed jobs after approving.
7. Read back yourself:

   ```sh
   npm view @sess.si/openclaw@0.1.0-rc.2 version dist.integrity dist.attestations --json
   npm view @sess.si/openclaw dist-tags --json     # next: 0.1.0-rc.2; latest stays 0.0.0-stage
   ```

   `dist.integrity` must equal the integrity above and `dist.attestations.provenance` must be
   present. `latest` must not point at a prerelease.

## After publication

Run a clean native install from the registry on the qualified host
(`openclaw plugins install npm:@sess.si/openclaw@0.1.0-rc.2`) and record it in a separate reviewed
PR. ClawHub listing is a separate, separately authorized action (see [RELEASING.md](../RELEASING.md)).
