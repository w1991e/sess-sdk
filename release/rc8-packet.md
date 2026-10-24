# Release packet: `@sess.si/sdk@0.1.0-rc.8`

This is a maintainer document and is not packed. Preparing this candidate publishes nothing. The tag,
the `npm-release` environment approval and the npm 2FA stage approval are a maintainer's actions.

The registry is at `0.1.0-rc.7` (published 2026-10-18). rc.8 follows it.

## What rc.8 contains

The `0.1.0-rc.8` entry in [`CHANGELOG.md`](../CHANGELOG.md) covers it in full. It landed on master in this order:

- **#69, link timing** (Decision 0009 Amendment 10):
  - `link_state`, `action_expires_horizon`, `extensions_used` and `extensions` on Session reads, and `link_extensions` in the Session log;
  - lapsed-aware `waitForResponse()` and `answer()`;
  - the contract snapshot from Sess `2f8500e` (#431's merge commit), which also carries the interactive text limits, `progress`, the receipt `format` and the renderer identities list.
- **#73:** MCP. A read that shows a revoked link expired is final only after the grace.
- **#70, renderer identities on the issuer's signed list** (Decision 0009 Amendment 13):
  - list editions (`seq`, `iat`), `verifyRendererIdentities` and `newerRendererList`;
  - `sess verify --renderers`;
  - the receipt-v1 copy from Sess `a60ca69`.
- **#75:** Sess's interactive length limits in the types and in `sess.ask()`, with `field`, `limit` and `length` on `SessError`, plus the self-teaching tool schemas in MCP and OpenClaw.

The archival verifier (#36) is **not** in rc.8; the maintainer decides whether it ships in a later rc. Runtime dependencies are unchanged (`canonicalize` 5.1.0, `jose` 6.2.12, `standardwebhooks` 1.1.1).

## Expected tarball

These values are recorded in [`sdk-next-candidate.json`](sdk-next-candidate.json) at master `d1627f17313cf987e2a7edd9daae3bf00d982a7e` (#75). `npm run check` fails if the packed root differs: its `check:pin` step checks this.

| Field     | Value                                                                                             |
| --------- | ------------------------------------------------------------------------------------------------- |
| Filename  | `sess.si-sdk-0.1.0-rc.8.tgz`                                                                      |
| SHA-256   | `b533935b98020354010ca4e1a14901e8bc5218ca4b129422a8f8a6fa97684c95`                                |
| Integrity | `sha512-TlON9nYHkuFl6Al0TeGl9GUiPx65QpvpOBOHGdIp/ukt+3xXM5b2+4//pMN5RB0lsf031GoSZQFsXvkFScuykA==` |

This packet changes no packed file. If a packed change lands before the tag, run `node scripts/sdk-pin.mjs prepare` again and update this table in the same PR.

## Maintainer steps

1. Note the master commit to tag and check it with `git show <sha>:release/sdk-next-candidate.json`. Use this packet's merge commit, or `d1627f17313cf987e2a7edd9daae3bf00d982a7e` or any later commit that records the same digest.
2. Tag that exact commit and push the tag:

   ```sh
   git tag v0.1.0-rc.8 <sha>
   git push origin v0.1.0-rc.8
   ```

3. The workflow **Publish approved SDK release** (`.github/workflows/release.yml`) starts. Its validate job runs `npm run check` at the tag (`check:pin` included), uploads the tested tarball and prints its SHA-256 in the run summary. That SHA-256 must equal the value above.
4. Approve the `npm-release` environment for the publish job. It stages exactly the tested tarball, with provenance, on dist-tag `next` (`npm stage publish`). Nothing is installable yet.
5. Check the stage, then approve it with npm 2FA:

   ```sh
   npm stage list @sess.si/sdk --json
   npm stage download <stage-id>
   shasum -a 256 sess.si-sdk-0.1.0-rc.8.tgz   # must equal the SHA-256 above
   npm stage view <stage-id>                  # tag must be next
   npm stage approve <stage-id>               # npm 2FA
   ```

6. The readback job waits up to 60 minutes for the approval, then checks registry integrity, dist-tag and provenance. If it timed out, approve the stage and then re-run the failed jobs.
7. Read back yourself:

   ```sh
   npm view @sess.si/sdk@0.1.0-rc.8 version dist.integrity dist.attestations --json
   npm view @sess.si/sdk dist-tags --json     # next: 0.1.0-rc.8; latest unchanged
   ```

## After publication (the registry transition)

`npm run pin:update` rewrites `sdk-candidate.json` to rc.8 and removes the successor record. It is followed by:

- the MCP `sdk:switch-to-registry`;
- the OpenClaw, quickstart and create-agent checks;
- the starter's rc.8 pin for template parity;
- the MCP, OpenClaw and create-agent next versions, each in its own release-prep PR.
