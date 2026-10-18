# Release packet: `@sess.si/create-agent@0.1.0-rc.3`

Maintainer document; not packed. Preparing this candidate publishes nothing. The tag, the
`npm-create-agent-release` environment approval and the npm 2FA stage approval are a maintainer's
actions.

## What rc.3 contains

- The template pins `@sess.si/sdk@0.1.0-rc.7` (published on `next`), from rc.5. Its byte parity with
  the public starter (`w1991e/sess-agent-starter`, PR #5) is checked by `create-agent/scripts/check-parity.mjs`.
- The template README's first screen (#63), with "Sess link" wording (#56).
- Package keywords and homepage `https://sess.si` (#58).
- The initializer's behaviour and prompts are unchanged from rc.2.

## Expected tarball

Computed by the workflow's own pack step, `node create-agent/scripts/release-guard.mjs pack`
(`npm pack --json --ignore-scripts`, recorded in `create-agent/.artifacts/package-result.json`). It ran
at clean commit `a830ddf` (this PR's head when prepared) on Node 24.21.0 and npm 11.19.0, the versions the workflow pins. Then
`clean-install-check.mjs --tarball` exercised exactly these bytes, and `release-guard.mjs exercised`
bound them.

| Field     | Value                                                                                             |
| --------- | ------------------------------------------------------------------------------------------------- |
| Filename  | `sess.si-create-agent-0.1.0-rc.3.tgz`                                                             |
| SHA-256   | `6fc040893812092a82ff5b198b1e7ccdaf32b04fb0abbfbb965f3298f3e99e68`                                |
| Integrity | `sha512-Lp/bK3GEqria21n3hrMPqPZfgYO4vjfmNHuqO7kGocqH/Wn9YJpeSv24ni1M7QocqUL/6g+dkTeka5xcnvkXVw==` |

The release workflow does not read this table. The prepare job's run summary (SHA-256 and integrity)
is the record of the bytes it tested. If another packed change (`index.mjs`, `template/`,
`README.md`, `LICENSE` or `package.json`) lands before the tag, re-run the pack step and update this
table in the same PR.

## Setup state

The one-time setup is done. The package exists, and `0.1.0-rc.2` is on `next`. The `0.0.0-stage`
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
   merged master commit `<sha>` and check that it is still version `0.1.0-rc.3`:
   `git show <sha>:create-agent/package.json | grep '"version"'`.
2. Tag that exact commit and push the tag:

   ```sh
   git tag create-agent-v0.1.0-rc.3 <sha>
   git push origin create-agent-v0.1.0-rc.3
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
   shasum -a 256 sess.si-create-agent-0.1.0-rc.3.tgz   # must equal the SHA-256 above
   npm stage view <stage-id>                           # tag must be next
   npm stage approve <stage-id>                        # npm 2FA
   ```

6. The readback job waits up to 60 minutes for the approval, then checks registry integrity,
   dist-tag, dependencies and provenance. If it timed out, re-run the failed jobs after approving.
7. Read back yourself, then run the initializer from the registry in an empty directory:

   ```sh
   npm view @sess.si/create-agent@0.1.0-rc.3 version dist.integrity dist.attestations --json
   npm view @sess.si/create-agent dist-tags --json   # next: 0.1.0-rc.3; latest never a prerelease
   npm create @sess.si/agent@next my-agent
   ```

   `dist.integrity` must equal the integrity above and `dist.attestations.provenance` must be
   present.
