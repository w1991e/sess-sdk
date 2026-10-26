# Release packet: `@sess.si/create-agent@0.1.0-rc.5`

Maintainer document; not packed. Preparing this candidate publishes nothing. The tag, the
`npm-create-agent-release` environment approval and the npm 2FA stage approval are a maintainer's
actions. It ships in Monday 26 October's release with openclaw 0.1.0-rc.4.

## What rc.5 contains

- **One command finishes the job.** `npm create @sess.si/agent@next [dir]` (or
  `npx @sess.si/create-agent@next [dir]`) scaffolds the agent as before, asks only for what is missing
  — the Sess API key with hidden input (never an argument, never written to disk or printed, passed
  only to the agent's `npm start` environment) and a contact for the weather services — installs
  the agent (`npm install --ignore-scripts`), runs it once so the Sess link prints, and exits with the
  agent's exit code. Without a terminal and with values missing, or with `-- --no-run`, it scaffolds
  and prints the next steps as rc.4 did. Ctrl-C at a prompt leaves the files and stops.
- **User-Agent.** The agent's requests to Sess carry `User-Agent: sess-create-agent/0.1.0-rc.5`,
  the product token Sess classifies a creating client by. `template/agent.mjs` passes the SDK a
  small `fetch` (`withUserAgent`) that sets it: rc.8 accepts a `fetch` option but sends no
  User-Agent of its own and has no option to prepend one; an SDK that sends its own token keeps it
  after the agent's. The parity check requires the token to name the initializer's version; the
  clean-install check asserts the exact header on every Sess request with the registry rc.8, and
  `tests/create-agent/agent.test.ts` at a local HTTP server. This is the template's only change from
  rc.4.
- The template still pins `@sess.si/sdk@0.1.0-rc.8` (published on `next`):

  | Field     | Value                                                                                             |
  | --------- | ------------------------------------------------------------------------------------------------- |
  | Tarball   | `https://registry.npmjs.org/@sess.si/sdk/-/sdk-0.1.0-rc.8.tgz`                                    |
  | SHA-256   | `b533935b98020354010ca4e1a14901e8bc5218ca4b129422a8f8a6fa97684c95`                                |
  | Integrity | `sha512-TlON9nYHkuFl6Al0TeGl9GUiPx65QpvpOBOHGdIp/ukt+3xXM5b2+4//pMN5RB0lsf031GoSZQFsXvkFScuykA==` |

- The prompts, progress line and README first screen are new copy, signed by the founder before the
  tag. If a signed edit changes a packed file, re-run the pack step and update the table below in the
  same PR.

## Expected tarball

Computed by the workflow's own pack step, `node create-agent/scripts/release-guard.mjs pack`
(`npm pack --json --ignore-scripts`, recorded in `create-agent/.artifacts/package-result.json`).
Re-prepared for the User-Agent change, it ran at clean commit `7aca9e7` on Node 24.21.0 and npm
11.19.0, the versions the workflow pins. Then `clean-install-check.mjs --tarball` exercised exactly
these bytes (registry SDK rc.8 with the pinned integrity, both rounds against the offline fake world,
every Sess request with `User-Agent: sess-create-agent/0.1.0-rc.5`, through the one command with both values in its environment and no terminal), and `release-guard.mjs exercised` bound them. These
bytes replace the earlier rc.5 table (SHA-256 `a013ccd3…603c4347`), which was never tagged or
published.

| Field     | Value                                                                                             |
| --------- | ------------------------------------------------------------------------------------------------- |
| Filename  | `sess.si-create-agent-0.1.0-rc.5.tgz`                                                             |
| SHA-256   | `b08368648379bb428446aa36680e2ecc19a362f2291a87b3d19416967ef0409b`                                |
| Integrity | `sha512-GmfJDi0fPb8wACLVWv7c6pHZeQ05TK0AODrJrRF+42W5Wxiw7ojyzudfVKtqpAsMEkmbe6hWd5vP1ooGBNu7cg==` |

The release workflow does not read this table. The prepare job's run summary (SHA-256 and integrity)
is the record of the bytes it tested. If another packed change (`index.mjs`, `template/`,
`README.md`, `LICENSE` or `package.json`) lands before the tag, re-run the pack step and update this
table in the same PR.

## Setup state

The one-time setup is done. The package exists, and `0.1.0-rc.4` is on `next`. The `0.0.0-stage`
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
   merged master commit `<sha>` and check that it is still version `0.1.0-rc.5`:
   `git show <sha>:create-agent/package.json | grep '"version"'`.
2. Tag that exact commit and push the tag:

   ```sh
   git tag create-agent-v0.1.0-rc.5 <sha>
   git push origin create-agent-v0.1.0-rc.5
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
   shasum -a 256 sess.si-create-agent-0.1.0-rc.5.tgz   # must equal the SHA-256 above
   npm stage view <stage-id>                           # tag must be next
   npm stage approve <stage-id>                        # npm 2FA
   ```

6. The readback job waits up to 60 minutes for the approval, then checks registry integrity,
   dist-tag, dependencies and provenance. If it timed out, re-run the failed jobs after approving.
7. Read back yourself, then run the initializer from the registry in an empty directory:

   ```sh
   npm view @sess.si/create-agent@0.1.0-rc.5 version dist.integrity dist.attestations --json
   npm view @sess.si/create-agent dist-tags --json   # next: 0.1.0-rc.5; latest never a prerelease
   npm create @sess.si/agent@next my-agent -- --no-run
   grep '"@sess.si/sdk"' my-agent/package.json      # must be "0.1.0-rc.8"
   ```

   `dist.integrity` must equal the integrity above and `dist.attestations.provenance` must be
   present. The initializer has no dependencies; the SDK pin is in the scaffolded `package.json`.
