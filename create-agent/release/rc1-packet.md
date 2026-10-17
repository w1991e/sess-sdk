# Release packet: `@sess.si/create-agent@0.1.0-rc.1`

Maintainer document; not packed. Preparing this candidate publishes nothing. Creating the GitHub
environment, the npm package and its trusted publisher, the tag, the `npm-create-agent-release`
environment approval and the npm 2FA stage approval are a maintainer's actions.

## What rc.1 contains

- The initializer behind `npm create @sess.si/agent@next <directory>`. It writes the starter agent
  into a new or empty directory inside the current one. It never overwrites a file, follows a symlink,
  asks for a secret or runs npm. It has no dependencies and no scripts.
- The starter template (`template/`): `agent.mjs`, `weather.mjs`, `package.json` (private, exact
  `@sess.si/sdk@0.1.0-rc.5`, the published pin in
  [`release/sdk-candidate.json`](../../release/sdk-candidate.json), dist-tag `next`), `README.md`,
  `LICENSE`, `.gitignore` and `.env.example`. The template is byte-identical to the public
  `sess-agent-starter` repository (`node create-agent/scripts/check-parity.mjs <starter checkout>`).
- The usage line, README and package description name `npm create @sess.si/agent@next`, because
  only the `next` dist-tag will exist.

## Expected tarball

Computed by the workflow's own pack step, `node create-agent/scripts/release-guard.mjs pack`
(`npm pack --json --ignore-scripts`, recorded in `create-agent/.artifacts/package-result.json`), at a
clean tree on Node 24.21.0 and npm 11.19.0, the versions the workflow pins. Then
`clean-install-check.mjs --tarball` exercised exactly these bytes, and
`release-guard.mjs exercised` bound them.

| Field     | Value                                                                                             |
| --------- | ------------------------------------------------------------------------------------------------- |
| Filename  | `sess.si-create-agent-0.1.0-rc.1.tgz`                                                             |
| SHA-256   | `1694b5f5dfd6536e38cbb6b0a7965dbc13111b9e612e2dbfcc709cf0c0a7f81c`                                |
| Integrity | `sha512-xuVVouCMN9IzUhibtyOfmoNC0s5XlP0/6s+D97jU9qIsA8spptzJbeDO/JAlOgFdfIrFBaT2TGAI63YAyWo0eQ==` |

The release workflow does not read this table; the prepare job's run summary (SHA-256 and integrity)
is the record of the bytes it tested. If another packed change (`index.mjs`, `template/`,
`README.md`, `LICENSE` or `package.json`) lands before the tag, re-run the pack step and update this
table in the same PR.

## One-time setup (before the first tag)

None of these exist yet. On 2026-10-16, `gh api repos/w1991e/sess-sdk/environments/npm-create-agent-release`
returned 404, and `npm view @sess.si/create-agent` returned 404.

1. **GitHub environment** `npm-create-agent-release` in `w1991e/sess-sdk`. It needs a required
   reviewer (the maintainer) and deployment refs restricted to tags matching `create-agent-v*`. It
   has no secrets.
2. **Bootstrap the npm package.** From a maintainer account, stage a never-approved bootstrap version
   (`npm stage publish` of a placeholder) so that `@sess.si/create-agent` exists. If npm publishes a
   public `0.0.0-stage` placeholder and `latest` lands on it, deprecate it:
   `npm deprecate @sess.si/create-agent@0.0.0-stage "Placeholder, not a release. Run npm create @sess.si/agent@next."`
3. **Stage-only trusted publisher** on npmjs.com for `@sess.si/create-agent`:
   - repository `w1991e/sess-sdk`;
   - workflow `create-agent-release.yml`;
   - environment `npm-create-agent-release`;
   - direct publishing not permitted.
4. Reject the bootstrap stage (`npm stage list @sess.si/create-agent --json`, then reject it).

Do not push a `create-agent-v*` tag before steps 1 to 4 are done. A tag pushed without the
environment would make GitHub create it automatically, without protection rules.

## Maintainer steps

1. Confirm the reviewed PR carrying this packet is merged and its CI is green on master. Note the
   merged master commit `<sha>` and check that it is still version `0.1.0-rc.1`:
   `git show <sha>:create-agent/package.json | grep '"version"'`.
2. Tag that exact commit and push the tag:

   ```sh
   git tag create-agent-v0.1.0-rc.1 <sha>
   git push origin create-agent-v0.1.0-rc.1
   ```

3. The workflow **Publish approved create-agent release**
   (`.github/workflows/create-agent-release.yml`) starts. Its prepare job runs:
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
   shasum -a 256 sess.si-create-agent-0.1.0-rc.1.tgz   # must equal the SHA-256 above
   npm stage view <stage-id>                           # tag must be next
   npm stage approve <stage-id>                        # npm 2FA
   ```

6. The readback job waits up to 60 minutes for the approval, then checks registry integrity,
   dist-tag, dependencies and provenance. If it timed out, re-run the failed jobs after approving.
7. Read back yourself, then run the initializer from the registry in an empty directory:

   ```sh
   npm view @sess.si/create-agent@0.1.0-rc.1 version dist.integrity dist.attestations --json
   npm view @sess.si/create-agent dist-tags --json   # next: 0.1.0-rc.1; latest never a prerelease
   npm create @sess.si/agent@next my-agent
   ```

   `dist.integrity` must equal the integrity above and `dist.attestations.provenance` must be
   present.
