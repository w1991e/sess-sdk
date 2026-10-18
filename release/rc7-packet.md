# Release packet: `@sess.si/sdk@0.1.0-rc.7`

This is a maintainer document and is not packed. Preparing this candidate publishes nothing. The tag,
the `npm-release` environment approval and the npm 2FA stage approval are a maintainer's actions.

`0.1.0-rc.6` was prepared ([`rc6-packet.md`](rc6-packet.md)) but never tagged or published. rc.7
includes everything in it, so the registry goes from `0.1.0-rc.5` to `0.1.0-rc.7`.

## What rc.7 contains

The `0.1.0-rc.7` and `0.1.0-rc.6` entries in [`CHANGELOG.md`](../CHANGELOG.md) cover it in full:

- **From rc.6:**
  - `sess.ask({ question, fields })`;
  - the README opening with it;
  - the "Sess" wording sweep;
  - the contract snapshot refresh.
- **New in rc.7:**
  - **Advanced `expires_in`:** on `sessions.create()` and `sess.ask()`, in whole seconds from 30 up
    to the plan's link lifetime.
  - **`action_expires_at` / `expiresAt`.**
  - **An expiry-aware `waitForResponse()` and `answer()`:** these end with `wait_ended` /
    `LINK_EXPIRED` after one final read, and never complete a Session on their own.
  - **`ResponseMeta.serverDate`.**
  - **The contract snapshot** from runtime commit `b48e8e7`.
  - **`@sess.si/sdk/qr`:** a local QR code for a Sess link (S-07), with no new dependency.

Every existing export is unchanged. Runtime dependencies are unchanged (`canonicalize` 5.1.0,
`jose` 6.2.12, `standardwebhooks` 1.1.1).

## Expected tarball

These values are recorded in [`sdk-next-candidate.json`](sdk-next-candidate.json) at master
`e8e36ceb1724e7532b6037744ac27b4e7a588b47` (#60). `npm run check` fails if the packed root differs:
its `check:pin` step checks this. At that commit, SDK CI, OpenClaw adapter CI, Quickstart clean
install and Create-agent clean install are green.

| Field     | Value                                                                                             |
| --------- | ------------------------------------------------------------------------------------------------- |
| Filename  | `sess.si-sdk-0.1.0-rc.7.tgz`                                                                      |
| SHA-256   | `6a5c8e744048538dc3ed126a07cfd26d3417557898b5a923488d1ad3005350e5`                                |
| Integrity | `sha512-isuZBhvHitFKh5XR7jYZcNtwhRKE9dknL6szfU+U4QHBe9PoGmMIWxe+QyPpbAWrJeZFuwJSDLcVOs2kyhK8MQ==` |

This packet changes no packed file. If a packed change lands before the tag, run
`node scripts/sdk-pin.mjs prepare` again and update this table in the same PR.

## Maintainer steps

1. Note the master commit to tag (`e8e36ceb1724e7532b6037744ac27b4e7a588b47`, or a later commit that
   records the same digest) and check it: `git show <sha>:release/sdk-next-candidate.json`.
2. Tag that exact commit and push the tag:

   ```sh
   git tag v0.1.0-rc.7 <sha>
   git push origin v0.1.0-rc.7
   ```

3. The workflow **Publish approved SDK release** (`.github/workflows/release.yml`) starts. Its
   validate job runs `npm run check` at the tag (`check:pin` included), uploads the tested tarball
   and prints its SHA-256 in the run summary. That SHA-256 must equal the value above.
4. Approve the `npm-release` environment for the publish job. It stages exactly the tested tarball,
   with provenance, on dist-tag `next` (`npm stage publish`). Nothing is installable yet.
5. Check the stage, then approve it with npm 2FA:

   ```sh
   npm stage list @sess.si/sdk --json
   npm stage download <stage-id>
   shasum -a 256 sess.si-sdk-0.1.0-rc.7.tgz   # must equal the SHA-256 above
   npm stage view <stage-id>                  # tag must be next
   npm stage approve <stage-id>               # npm 2FA
   ```

6. The readback job waits up to 60 minutes for the approval, then checks registry integrity,
   dist-tag and provenance. If it timed out, approve the stage and then re-run the failed jobs.
7. Read back yourself:

   ```sh
   npm view @sess.si/sdk@0.1.0-rc.7 version dist.integrity dist.attestations --json
   npm view @sess.si/sdk dist-tags --json     # next: 0.1.0-rc.7; latest stays 0.0.0-stage
   ```

   `dist.integrity` must equal the integrity above, and `dist.attestations.provenance` must be
   present. `latest` must not point at a prerelease: it stays on `0.0.0-stage` until stable `0.1.0`.

## Registry transition (after publication and readback)

The consumer half is prepared in #64 (`release/rc7-pins`). After step 7 succeeds:

1. On #64, run `npm ci --ignore-scripts && npm run pin:update`. It repins `release/sdk-candidate.json`
   to rc.7 and removes `release/sdk-next-candidate.json`. Then run `npm run check`.
2. In `adapters/mcp`, run `npm run sdk:switch-to-registry -- --apply`, then `npm run setup && npm run check`.
3. In `adapters/openclaw`, run `npm ci` from the registry and its checks.
4. Check the quickstart and create-agent clean installs. The public starter template
   (sess-agent-starter #5) moves to rc.7 in step with the template so that byte parity holds.
5. Record the published version, registry integrity and readback.

The adapters and the initializer need their own next versions (`@sess.si/mcp` rc.2,
`@sess.si/openclaw` rc.2, `@sess.si/create-agent` rc.3) in release-prep PRs, because rc.1 and rc.2
are already published with the rc.5 dependency.
