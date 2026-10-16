# Release packet: `@sess.si/sdk@0.1.0-rc.5`

Maintainer document; not packed. Preparing this candidate publishes nothing. The tag, the
`npm-release` environment approval and the npm 2FA stage approval are a maintainer's actions.

## What rc.5 contains

- `verifyDecisionBundle` and `BUNDLE_LIMITS` in `@sess.si/sdk/receipts` (bundle-v1, checked against
  the shared conformance corpus); `verifyDecisionReceipt` unchanged.
- The `sess` executable: `sess verify <file> --issuer <url> --keys <jwks.json>`, offline.
- The README's first screen installs from npm (`@sess.si/sdk@next`) instead of describing a candidate
  tarball.

No other packed file changed on master since the `v0.1.0-rc.4` tag. Runtime dependencies are
unchanged (`canonicalize` 5.1.0, `jose` 6.2.12, `standardwebhooks` 1.1.1).

## Expected tarball

Recorded in `sdk-next-candidate.json` (removed by the registry transition after publication) by `node scripts/sdk-pin.mjs prepare`
(Node 24.21.0, npm 11.19.0). `npm run check` (its `check:pin` step) fails if the packed root differs.

| Field     | Value                                                                                             |
| --------- | ------------------------------------------------------------------------------------------------- |
| Filename  | `sess.si-sdk-0.1.0-rc.5.tgz`                                                                      |
| SHA-256   | `20a7f6277755a943f789a0fc26658e51ea5c8a8a3b270200802dcd2a2e0e707e`                                |
| Integrity | `sha512-t/alGpesXns5ngtH4k07U8LR31+aPqq1yPtCatRrVKQhcWcDGOiVnSPUliLOmh802mH2mW5JhkB7IkpN9IVQtg==` |

## Maintainer steps

1. Confirm the reviewed PR carrying this packet is merged and its CI is green on master. Note the
   merged master commit `<sha>` and check that it still records the digest above:
   `git show <sha>:release/sdk-next-candidate.json`.
2. Tag that exact commit and push the tag:

   ```sh
   git tag v0.1.0-rc.5 <sha>
   git push origin v0.1.0-rc.5
   ```

3. The workflow **Publish approved SDK release** (`.github/workflows/release.yml`) starts. Its
   validate job runs `npm run check` at the tag (including `check:pin`), uploads the tested tarball
   and prints its SHA-256 in the run summary. That SHA-256 must equal the value above.
4. Approve the `npm-release` environment for the publish job. It stages exactly the tested tarball
   with provenance on dist-tag `next` (`npm stage publish`; nothing is installable yet).
5. Check and approve the stage with npm 2FA:

   ```sh
   npm stage list @sess.si/sdk --json
   npm stage download <stage-id>
   shasum -a 256 sess.si-sdk-0.1.0-rc.5.tgz   # must equal the SHA-256 above
   npm stage view <stage-id>                  # tag must be next
   npm stage approve <stage-id>               # npm 2FA
   ```

6. The readback job waits up to 60 minutes for the approval, then checks registry integrity,
   dist-tag and provenance. If it timed out, re-run the failed jobs after approving.
7. Read back yourself:

   ```sh
   npm view @sess.si/sdk@0.1.0-rc.5 version dist.integrity dist.attestations --json
   npm view @sess.si/sdk dist-tags --json     # next: 0.1.0-rc.5; latest stays 0.0.0-stage
   ```

   `dist.integrity` must equal the integrity above and `dist.attestations.provenance` must be
   present. `latest` must not point at a prerelease; it stays on `0.0.0-stage` until stable `0.1.0`.

## Registry transition (after publication and readback)

A separate reviewed PR, opened only after step 7 succeeds. Until then every consumer stays on the
published `0.1.0-rc.4`, pinned in [`sdk-candidate.json`](sdk-candidate.json).

1. Root: `npm ci --ignore-scripts`, then `npm run pin:update`. It refuses unless the root still
   packs exactly the prepared bytes, then repins `release/sdk-candidate.json` to rc.5, removes
   `release/sdk-next-candidate.json`, and updates the dependency in `adapters/mcp`,
   `adapters/openclaw`, `examples/quickstart-node` and `create-agent/template`, the two adapter
   lockfile entries and `adapters/mcp/compatibility.json`. Then `npm run check`.
2. MCP adapter (`adapters/mcp`): `pin:update` leaves the lock in candidate mode. Run
   `npm run sdk:switch-to-registry` (dry run), then `npm run sdk:switch-to-registry -- --apply`,
   then `npm run setup && npm run check`.
3. OpenClaw adapter (`adapters/openclaw`): `npm ci` from the registry and its checks
   (`scripts/registry-sdk.mjs` compares manifest, lock, installed tree and registry with the pin).
   Update the rc.4 evidence text in its `compatibility.json`.
4. Quickstart: `node examples/quickstart-node/scripts/clean-install-check.mjs`; replace the three
   `0.1.0-rc.4` mentions in `examples/quickstart-node/README.md`.
5. create-agent starter: `node create-agent/scripts/clean-install-check.mjs`; the template parity
   check runs in `npm test`. The public starter template repository needs the same SDK version so
   that byte parity holds.
6. Docs: `docs/releasing.md`, `docs/compatibility.md` and `docs/migration.md` record rc.5 as
   published; the adapters' README, RELEASING and CHANGELOG mentions of rc.4 move to rc.5.
7. Record the published version, registry integrity and readback.
