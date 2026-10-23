# Release packet: `@sess.si/create-agent@0.1.0-rc.4`

Maintainer document; not packed. Preparing this candidate publishes nothing. The tag, the
`npm-create-agent-release` environment approval and the npm 2FA stage approval are a maintainer's
actions.

## What rc.4 contains

- The template pins `@sess.si/sdk@0.1.0-rc.8` (published on `next`), from rc.7. The published rc.3
  scaffolds an agent on rc.7, whose receipt verifier rejects `sess-html-form-2`; an agent created
  from rc.4 verifies form-2 receipts (`tests/create-agent/agent.test.ts`, Decision 0009 Amendment 13).
  The pinned SDK, checked by the release guard against the registry:

  | Field     | Value                                                                                             |
  | --------- | ------------------------------------------------------------------------------------------------- |
  | Tarball   | `https://registry.npmjs.org/@sess.si/sdk/-/sdk-0.1.0-rc.8.tgz`                                    |
  | SHA-256   | `b533935b98020354010ca4e1a14901e8bc5218ca4b129422a8f8a6fa97684c95`                                |
  | Integrity | `sha512-TlON9nYHkuFl6Al0TeGl9GUiPx65QpvpOBOHGdIp/ukt+3xXM5b2+4//pMN5RB0lsf031GoSZQFsXvkFScuykA==` |

- Sess's length limits in the template (#75): the README's "Change a question" section, plan
  option labels under 60 characters, and a weather alert headline longer than 200 characters gives
  way to its short event name.
- The initializer's behaviour and prompts are unchanged from rc.3. The template's byte parity with
  the public starter (`w1991e/sess-agent-starter`) is checked by `create-agent/scripts/check-parity.mjs`
  given a checkout of it; the starter is updated separately.

## Expected tarball

Computed by the workflow's own pack step, `node create-agent/scripts/release-guard.mjs pack`
(`npm pack --json --ignore-scripts`, recorded in `create-agent/.artifacts/package-result.json`). It ran
at clean commit `58bbe8f` on Node 24.21.0 and npm 11.19.0, the versions the workflow pins. Then
`clean-install-check.mjs --tarball` exercised exactly these bytes (registry SDK rc.8 with the pinned
integrity, both rounds against the offline fake world), and `release-guard.mjs exercised` bound them.

| Field     | Value                                                                                             |
| --------- | ------------------------------------------------------------------------------------------------- |
| Filename  | `sess.si-create-agent-0.1.0-rc.4.tgz`                                                             |
| SHA-256   | `3838860af9ceb87b04d6ea1e9dbd9be5bc11b1c2304b3a2416ba74a74e9f69c2`                                |
| Integrity | `sha512-jxFBguYF5QqJ8fffOtsjL5zGg+EH72vs4vzHjKVScs+uHtq+nt37Rftl7562i9EBFomXSdRB4IyJeUIYNMwh3Q==` |

The release workflow does not read this table. The prepare job's run summary (SHA-256 and integrity)
is the record of the bytes it tested. If another packed change (`index.mjs`, `template/`,
`README.md`, `LICENSE` or `package.json`) lands before the tag, re-run the pack step and update this
table in the same PR.

## Setup state

The one-time setup is done. The package exists, and `0.1.0-rc.3` is on `next`. The `0.0.0-stage`
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
   merged master commit `<sha>` and check that it is still version `0.1.0-rc.4`:
   `git show <sha>:create-agent/package.json | grep '"version"'`.
2. Tag that exact commit and push the tag:

   ```sh
   git tag create-agent-v0.1.0-rc.4 <sha>
   git push origin create-agent-v0.1.0-rc.4
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
   shasum -a 256 sess.si-create-agent-0.1.0-rc.4.tgz   # must equal the SHA-256 above
   npm stage view <stage-id>                           # tag must be next
   npm stage approve <stage-id>                        # npm 2FA
   ```

6. The readback job waits up to 60 minutes for the approval, then checks registry integrity,
   dist-tag, dependencies and provenance. If it timed out, re-run the failed jobs after approving.
7. Read back yourself, then run the initializer from the registry in an empty directory:

   ```sh
   npm view @sess.si/create-agent@0.1.0-rc.4 version dist.integrity dist.attestations --json
   npm view @sess.si/create-agent dist-tags --json   # next: 0.1.0-rc.4; latest never a prerelease
   npm create @sess.si/agent@next my-agent
   grep '"@sess.si/sdk"' my-agent/package.json      # must be "0.1.0-rc.8"
   ```

   `dist.integrity` must equal the integrity above and `dist.attestations.provenance` must be
   present. The initializer has no dependencies; the SDK pin is in the scaffolded `package.json`.
