# Release packet: `@sess.si/create-agent@0.1.0-rc.6`

Maintainer document; not packed. Preparing this candidate publishes nothing. The tag, the
`npm-create-agent-release` environment approval and the npm 2FA stage approval are a maintainer's
actions.

## What rc.6 contains

From the founder's outsider dry run (2026-10-27, item 4). Both changed lines were signed by the
founder on 2026-10-27 (04:05Z, and 05:00Z for the comment).

- **The link line ends "Cmd-click to open."** `template/agent.mjs` prints
  `  https://app.sess.si/s/<capability>  Cmd-click to open.` under "Open this private link on your
  phone. Anyone with it can answer:". The URL stays its own token, so terminals keep it clickable.
- **The `read -rs` line stands alone.** In the "Next:" block (after `--no-run`, without a terminal,
  after "Stopped." and after a failed install) and in the template README, the line
  `read -rs SESS_API_KEY && export SESS_API_KEY` has a blank line before and after it and the
  comment `# run this line by itself, then paste your key from https://app.sess.si`. Pasting the
  whole block no longer feeds the next line into `read`.
- User-Agent `sess-create-agent/0.1.0-rc.6`. The template still pins `@sess.si/sdk@0.1.0-rc.8`
  (published on `next`, SHA-256 `b533935b98020354010ca4e1a14901e8bc5218ca4b129422a8f8a6fa97684c95`).
- The starter repository (`w1991e/sess-agent-starter`) receives the same template bytes in its own
  PR, merged after this one (its CI checks parity against sess-sdk master).

## Expected tarball

Computed by the workflow's own pack step, `node create-agent/scripts/release-guard.mjs pack`
(`npm pack --json --ignore-scripts`, recorded in `create-agent/.artifacts/package-result.json`), at
clean commit `dcde73c` on Node 24.21.0 and npm 11.19.0, the versions the workflow pins. Then
`clean-install-check.mjs --tarball` exercised exactly these bytes (registry SDK rc.8 with the pinned
integrity, both rounds against the offline fake world, through the one command), and
`release-guard.mjs exercised` bound them. These bytes replace an earlier rc.6 table (SHA-256
`415b803b…6b7c`, before the comment kept the portal link), which was never tagged or published.

| Field     | Value                                                                                             |
| --------- | ------------------------------------------------------------------------------------------------- |
| Filename  | `sess.si-create-agent-0.1.0-rc.6.tgz`                                                             |
| SHA-256   | `782f4b36d2bc1b34b09b71c5976f9587fc530b53e2ef7ddee007b76b9a129264`                                |
| Integrity | `sha512-smfr7ycyeK1R5L3dlhI1QxwYVvYSmPCv2fXDzk4jdISKAmU9El/iTpsyp0vEm0W5DIwQIl58QClTxF+PJlgoig==` |

The release workflow does not read this table. The prepare job's run summary (SHA-256 and integrity)
is the record of the bytes it tested. If another packed change (`index.mjs`, `template/`,
`README.md`, `LICENSE` or `package.json`) lands before the tag, re-run the pack step and update this
table in the same PR.

## Setup state

The one-time setup is done. The package exists, and `0.1.0-rc.5` is on `next`. The `0.0.0-stage`
placeholder on `latest` is deprecated. Its bootstrap stage was rejected after rc.1 was approved, so
there is no bootstrap stage to reject for this or any later release.

Before tagging, check that the GitHub environment `npm-create-agent-release` still has its required
reviewer and its `create-agent-v*` tag rule. Also check that the stage-only trusted publisher on
npmjs.com is still bound to:

- repository `w1991e/sess-sdk`;
- workflow `create-agent-release.yml`;
- environment `npm-create-agent-release`.

## Maintainer steps

1. Confirm the reviewed PR carrying this packet is merged and its CI is green on master. Note the
   merged master commit `<sha>` and check that it is still version `0.1.0-rc.6`:
   `git show <sha>:create-agent/package.json | grep '"version"'`.
2. Tag that exact commit and push the tag:

   ```sh
   git tag create-agent-v0.1.0-rc.6 <sha>
   git push origin create-agent-v0.1.0-rc.6
   ```

3. The workflow **Publish approved create-agent release**
   (`.github/workflows/create-agent-release.yml`) starts. Its prepare job runs, in order:
   - the guards, including that the template's exact SDK pin is published with the pinned
     integrity, and their self-test;
   - `npm ci --ignore-scripts` and template parity;
   - the build and the create-agent tests;
   - the pack;
   - the clean registry install of that exact tarball.

   It prints the SHA-256 and integrity in the run summary. Both must equal the values above.

4. Approve the `npm-create-agent-release` environment for the publish job. It stages exactly the
   tested tarball with provenance on dist-tag `next` (`npm stage publish`; nothing is installable
   yet).
5. Check and approve the stage with npm 2FA:

   ```sh
   npm stage list @sess.si/create-agent --json
   npm stage download <stage-id>
   shasum -a 256 sess.si-create-agent-0.1.0-rc.6.tgz   # must equal the SHA-256 above
   npm stage view <stage-id>                           # tag must be next
   npm stage approve <stage-id>                        # npm 2FA
   ```

6. The readback job waits up to 60 minutes for the approval, then checks registry integrity,
   dist-tag, dependencies and provenance. If it timed out, re-run the failed jobs after approving.
7. Read back yourself, then run the initializer from the registry in an empty directory:

   ```sh
   npm view @sess.si/create-agent@0.1.0-rc.6 version dist.integrity dist.attestations --json
   npm view @sess.si/create-agent dist-tags --json   # next: 0.1.0-rc.6; latest never a prerelease
   npm create @sess.si/agent@next my-agent -- --no-run
   grep '"@sess.si/sdk"' my-agent/package.json      # must be "0.1.0-rc.8"
   ```

   `dist.integrity` must equal the integrity above and `dist.attestations.provenance` must be
   present. The initializer has no dependencies; the SDK pin is in the scaffolded `package.json`.
