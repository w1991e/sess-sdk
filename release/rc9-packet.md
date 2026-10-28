# Release packet: `@sess.si/sdk@0.1.0-rc.9`

This is a maintainer document and is not packed. Preparing this candidate publishes nothing. The tag,
the `npm-release` environment approval and the npm 2FA stage approval are a maintainer's actions.

The registry is at `0.1.0-rc.8` on `next`. rc.9 follows it.

## What rc.9 contains

The `0.1.0-rc.9` entry in [`CHANGELOG.md`](../CHANGELOG.md) covers it in full. It landed on master in this order:

- **#6, Commerce builders** (P2-22, Commerce B): `money()`, `items()`, `invoice()`, `receipt()`, `quote()`, `refund()`, `purchaseOrder()` and `lintText()`, the `ItemsComponent` types, and Session reads that accept an items component. ASTRA APPROVE at `6e148af9`; merged as `4b279ef3`.
- **The `User-Agent` header** (`sess-sdk/<version> node/<version>`) and the `userAgent` client option.
- **A plan limit is a refusal:** HTTP 429 `PLAN_LIMIT_REACHED` is `kind: 'api'`, `outcome: 'rejected'`, never retried.
- **Packaging hygiene:** compiled output only, with no source maps and no `src/` sources.

The archival verifier (#36) is **not** in rc.9. Runtime dependencies are unchanged (`canonicalize` 5.1.0, `jose` 6.2.12, `standardwebhooks` 1.1.1).

## Expected tarball

These values are recorded in [`sdk-next-candidate.json`](sdk-next-candidate.json) by this packet's PR. The CHANGELOG heading is dated in the same PR, so the digest is the one prepared after that edit. `npm run check` fails if the packed root differs: its `check:pin` step checks this.

| Field     | Value                                                                                             |
| --------- | ------------------------------------------------------------------------------------------------- |
| Filename  | `sess.si-sdk-0.1.0-rc.9.tgz`                                                                      |
| SHA-256   | `486cf8d98258699cd5d7b6571aa1ba57f2e521046c1da2ece05a64717835192b`                                |
| Integrity | `sha512-ovBUP086I2P/JSyVueOabkqzYd5E4C1kf3qPiQwDJp75E0WygUot0PDf8J392hirVgctp9TlO/K240b7qMbzTg==` |

This packet changes no packed file beyond the dated CHANGELOG heading. If a packed change lands before the tag, run `node scripts/sdk-pin.mjs prepare` again and update this table in the same PR.

## Maintainer steps

1. Note the master commit to tag and check it with `git show <sha>:release/sdk-next-candidate.json`. Use this packet's merge commit, or any later commit that records the same digest.
2. Tag that exact commit and push the tag:

   ```sh
   git tag v0.1.0-rc.9 <sha>
   git push origin v0.1.0-rc.9
   ```

3. The workflow **Publish approved SDK release** (`.github/workflows/release.yml`) starts. Its validate job runs `npm run check` at the tag (`check:pin` included), uploads the tested tarball and prints its SHA-256 in the run summary. That SHA-256 must equal the value above.
4. Approve the `npm-release` environment for the publish job. It stages exactly the tested tarball, with provenance, on dist-tag `next` (`npm stage publish`). Nothing is installable yet.
5. Check the stage, then approve it with npm 2FA:

   ```sh
   npm stage list @sess.si/sdk --json
   npm stage download <stage-id>
   shasum -a 256 sess.si-sdk-0.1.0-rc.9.tgz   # must equal the SHA-256 above
   npm stage view <stage-id>                  # tag must be next
   npm stage approve <stage-id>               # npm 2FA
   ```

6. The readback job waits up to 60 minutes for the approval, then checks registry integrity, dist-tag and provenance. If it timed out, approve the stage and then re-run the failed jobs.
7. Read back yourself:

   ```sh
   npm view @sess.si/sdk@0.1.0-rc.9 version dist.integrity dist.attestations --json
   npm view @sess.si/sdk dist-tags --json     # next: 0.1.0-rc.9; latest unchanged
   ```

## After publication (the registry transition)

`npm run pin:update` rewrites `sdk-candidate.json` to rc.9 and removes the successor record. It is followed by:

- the MCP `sdk:switch-to-registry`;
- the OpenClaw, quickstart and create-agent checks;
- the starter's rc.9 pin for template parity;
- the MCP, OpenClaw and create-agent next versions, each in its own release-prep PR.
