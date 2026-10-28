# Release packet: `@sess.si/sdk@0.1.0-rc.10`

This is a maintainer document and is not packed. Preparing this candidate publishes nothing. The tag, the `npm-release` environment approval and the npm 2FA stage approval are a maintainer's actions.

**Order.** rc.10 follows rc.9. `v0.1.0-rc.9` is tagged at `1b6c05464ee56ea5e39d00916e5e0781fc994f2a` (founder 2026-10-28 16:20Z item 2), and [`rc9-packet.md`](rc9-packet.md) stages it. Tag rc.10 only after `npm view @sess.si/sdk dist-tags --json` shows `next: 0.1.0-rc.9`. Otherwise rc.9 would later move `next` back below rc.10.

## What rc.10 contains

The `0.1.0-rc.10` entry in [`CHANGELOG.md`](../CHANGELOG.md) covers it in full. Two PRs landed on master after the rc.9 tag:

- **#10, a refused key says so.** HTTP 401 `UNAUTHORIZED` gives the message "Sess did not accept your API key. Check SESS_API_KEY and the portal you made it on." A `SessError` has an own property only for a field with a value. The README and the Node quickstart print the message first, then `Details:` with the code and request ID.
  - ASTRA APPROVE at `06f585ef`. A focused independent verification of the master update and the rc.10 successor approved `83a72d5c`.
  - Merged as `d06f6a0d`.
- **#19, short human links.** A request identifier holding a run of 22 or more base64url characters is withheld from `SessError.requestId` and from request events. That covers a `/n/` token of 22, a `/s/` token of 43, or either glued to more. Sess's own `req_<uuid>` ids are kept. The source and packed-file scans recognise `/n/{22}` beside `/s/{43}`.
  - ASTRA APPROVE at `9a3c9630`. A focused independent verification of the master update approved `9d96c750`.
  - Merged as `3a4f3d60`.

The redaction in the MCP adapter that came with #19 (`adapters/mcp/src/errors.ts`) is not part of this package. It ships in its own `@sess.si/mcp` release-prep. Sess's `sess.si/n/` links (sess #807) go live in production only after this SDK and that adapter carry the redaction (founder 2026-10-28 16:20Z item 3: #807 "merges after the runtime pins rc.10; deploys in Thursday's window").

Runtime dependencies are unchanged: `canonicalize` 5.1.0, `jose` 6.2.12, `standardwebhooks` 1.1.1.

## Expected tarball

This packet's PR records these values in [`sdk-next-candidate.json`](sdk-next-candidate.json). The same PR dates the CHANGELOG heading, so the digest is the one prepared after that edit. `npm run check` fails if the packed root differs; its `check:pin` step checks this.

| Field     | Value                                                                                             |
| --------- | ------------------------------------------------------------------------------------------------- |
| Filename  | `sess.si-sdk-0.1.0-rc.10.tgz`                                                                     |
| SHA-256   | `541e3d6aa871b7969c556f351734de71c07fa881204a612345dc7f15be93a472`                                |
| Integrity | `sha512-YTeo2aNTXtYuLB/soF9iomFTrUTAtsOoHZM2Oni2WpEHADH8+FEkv6Gqqx0CnZn99NCmv1n51/XK3vFxnw0B7A==` |

This packet changes no packed file beyond the dated CHANGELOG heading. If a packed change lands before the tag, run `node scripts/sdk-pin.mjs prepare` again and update this table in the same PR.

## Maintainer steps

1. Confirm rc.9 is on the registry: `npm view @sess.si/sdk dist-tags --json` shows `next: 0.1.0-rc.9`.
2. Note the master commit to tag and check it with `git show <sha>:release/sdk-next-candidate.json`. Use this packet's merge commit, or any later commit that records the same digest.
3. Tag that exact commit and push the tag:

   ```sh
   git tag v0.1.0-rc.10 <sha>
   git push origin v0.1.0-rc.10
   ```

4. The workflow **Publish approved SDK release** (`.github/workflows/release.yml`) starts. Its validate job runs `npm run check` at the tag, `check:pin` included. It uploads the tested tarball and prints its SHA-256 in the run summary. That SHA-256 must equal the value above.
5. Approve the `npm-release` environment for the publish job. The job stages exactly the tested tarball, with provenance, on dist-tag `next` (`npm stage publish`). Nothing is installable yet.
6. Check the stage, then approve it with npm 2FA:

   ```sh
   npm stage list @sess.si/sdk --json
   npm stage download <stage-id>              # writes and prints sess.si-sdk-0.1.0-rc.10-<stage-id>.tgz
   shasum -a 256 sess.si-sdk-0.1.0-rc.10-<stage-id>.tgz   # must equal the SHA-256 above
   npm stage view <stage-id>                  # tag must be next
   npm stage approve <stage-id>               # npm 2FA
   ```

7. The readback job waits up to 60 minutes for the approval. It then checks registry integrity, dist-tag and provenance. If it timed out, approve the stage, then re-run the failed jobs.
8. Read back yourself:

   ```sh
   npm view @sess.si/sdk@0.1.0-rc.10 version dist.integrity dist.attestations --json
   npm view @sess.si/sdk dist-tags --json     # next: 0.1.0-rc.10; latest unchanged
   ```

## After publication (the registry transitions)

`npm run pin:update` pins exactly the bytes the root packs, and it refuses if they are not the prepared successor's. Master now packs rc.10, so rc.9's transition is made at the tag and carried to master as a diff. Copying whole files instead would revert later consumer changes.

- **rc.9**, after its publication:
  - run `pin:update` in a worktree at `v0.1.0-rc.9`, then the MCP `sdk:switch-to-registry`, so the MCP lock stays in registry mode;
  - write the OpenClaw `sdk.evidence` for the rc.9 release run;
  - apply that diff on master, keeping `release/sdk-next-candidate.json` at rc.10, not its deletion.
- **rc.10**, after its publication: `npm run pin:update` on master, which removes the successor record, then the same consumer steps.
- Then:
  - the OpenClaw, quickstart and create-agent checks;
  - the starter's pin for template parity;
  - the MCP (with #19's adapter redaction), OpenClaw and create-agent next versions, each in its own release-prep PR.
  - The Sess runtime's adapter-compatibility pins move to rc.10. #807 merges after that.
