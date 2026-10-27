# Release packet: `@sess.si/openclaw@0.1.0-rc.5`

Maintainer document; not packed. Preparing this candidate publishes nothing. The tag, the
`npm-openclaw-release` environment approval and the npm 2FA stage approval are a maintainer's
actions.

## What rc.5 contains

From the outsider Demo 4 dry run on OpenClaw 2026.10.7 (2026-10-27). Every human-facing line
below was signed by the founder on 2026-10-27.

- One runtime dependency, exact and unchanged: `@sess.si/sdk@0.1.0-rc.8`.
- **Peer:** `openclaw` `2026.10.3 || 2026.10.7` (exact versions; `scripts/release-guard.mjs` now
  accepts exact peers joined by `||` and still refuses ranges). `minHostVersion` and
  `pluginApi` stay `>=2026.10.3`; the devDependency and the real-host check stay on 2026.10.3.
- **Lines the host masked:** doctor and setup no longer start a line with "credential:" (OpenClaw
  masks the word after it). Doctor: `API key source: SESS_API_KEY, set in this CLI process (the
running Gateway must also have it)` / `API key source: SESS_API_KEY is not set in this CLI
process; the running Gateway needs it in its own environment.` Setup's terminal line matches.
  Every line passes the host's own `redactSensitiveText` unchanged on 2026.10.3 and 2026.10.7.
- **Doctor's tools line** reads the authored config setup writes: allowed, partly allowed, not
  yet allowed, or not checked.
- **Doctor's host line:** 2026.10.3 qualified; 2026.10.7 "supported; production qualification
  pending"; any other version warns.
- **README:** the npm-source sentence ("OpenClaw warns that the package comes from npm, not
  ClawHub…"); the consent paragraph rewritten from reproduced first installs (with a Gateway
  running the npm question is the only prompt; without one, the capability list and a second
  question; without a terminal, `--force --accept-capabilities`); the qualified-host lines and the
  2026.10.7 preview rehearsal (agent-turn round trip, adapter rc.4; not qualification).
- **Skill:** "When you report the person's answer, say it is verified (Sess checked its signed
  receipt)."
- **`compatibility.json`:** the 2026.10.7 entry (label "preview rehearsal, agent-turn round trip,
  adapter rc.4"; Node 24.22.1 SHA-256 `89c682593d76cd44233fa53b1563264e7de9cbb189cad169135c5b4fadfbc0a7`),
  and `evidenceEnvironment` on the 2026.10.3 record (isolated local runtime and preview
  rehearsals; no production run yet).
- **CHANGELOG** headings are the bare version; the published rc.4 heading is corrected.
- User-Agent `sess-openclaw/0.1.0-rc.5`.

The commits are those of sess-sdk PR #12 (branch `openclaw/rc5-demo4`, squashed on merge). The
full list of changes is in [CHANGELOG.md](../CHANGELOG.md).

## Expected tarball

Computed by `node scripts/check-package.mjs --registry --host`, the release workflow's packed
check, which records `.artifacts/package-result.json` (`sdkSource` `registry`,
`sourceTreeDirty` `false`), at clean commit `b40abe0` on Node 24.21.0 and npm 11.19.0, the
versions the workflow pins, after `npm run check` (167 tests passed); the real-host install passed
on OpenClaw `2026.10.3`. A second run at the same commit reproduced the same SHA-256 and
integrity. This packet is not in the tarball (`release/` is outside `files`).

| Field     | Value                                                                                             |
| --------- | ------------------------------------------------------------------------------------------------- |
| Filename  | `sess.si-openclaw-0.1.0-rc.5.tgz`                                                                 |
| SHA-256   | `21d84a9b869f10cb321c1cbb11042445775c5e6f7bff30055b1b123f8d551300`                                |
| Integrity | `sha512-lUf5WD+lEr+tmxdi0p6ERx3SrFUQ5Q4IaUPq+62Xp+d9Xp3iuiL56H1FEVdkkSgfAe5ckowEX8R7ZlRpnzcYjw==` |

The release workflow does not read this table; the prepare job's run summary is the record of the
bytes it tested. If another packed change (`dist/` sources, `openclaw.plugin.json`, `skills/`,
`compatibility.json`, `README.md`, `CHANGELOG.md`, `LICENSE`, `NOTICE` or `package.json`) lands
before the tag, re-run the packed check and update this table in the same PR.

## Maintainer steps

1. Confirm the reviewed PR carrying this packet is merged and its CI is green on master. Note the
   merged master commit `<sha>` and check that it is still version `0.1.0-rc.5`:
   `git show <sha>:adapters/openclaw/package.json | grep '"version"'`.
2. Tag that exact commit and push the tag:

   ```sh
   git tag openclaw-v0.1.0-rc.5 <sha>
   git push origin openclaw-v0.1.0-rc.5
   ```

3. The workflow **Publish approved OpenClaw adapter release**
   (`.github/workflows/openclaw-release.yml`) starts. Its prepare job runs the guards and their
   self-test, `npm ci`, build, typecheck, tests, the packed check against the registry SDK and a
   real OpenClaw host, and `npm audit`. It uploads the tested tarball and prints its SHA-256 in the
   run summary. That SHA-256 must equal the value above.
4. Approve the `npm-openclaw-release` environment for the publish job. It stages exactly the tested
   tarball with provenance on dist-tag `next` (`npm stage publish`; nothing is installable yet).
5. Check and approve the stage with npm 2FA:

   ```sh
   npm stage list @sess.si/openclaw --json
   npm stage download <stage-id>
   shasum -a 256 sess.si-openclaw-0.1.0-rc.5.tgz   # must equal the SHA-256 above
   npm stage view <stage-id>                       # tag must be next
   npm stage approve <stage-id>                    # npm 2FA
   ```

6. The readback job waits for the approval, then checks version, integrity, the `next` dist-tag,
   repository and directory, dependencies and peer dependencies, and provenance. If it timed out,
   re-run the failed jobs after approving.
7. Read back yourself:

   ```sh
   npm view @sess.si/openclaw@0.1.0-rc.5 version dependencies peerDependencies dist.integrity dist.attestations --json
   npm view @sess.si/openclaw dist-tags --json     # next: 0.1.0-rc.5; latest stays 0.0.0-stage
   ```

   `dist.integrity` must equal the integrity above, `dependencies` must name
   `"@sess.si/sdk": "0.1.0-rc.8"`, `peerDependencies` must name `"openclaw": "2026.10.3 || 2026.10.7"`,
   and `dist.attestations.provenance` must be present. `latest` must not point at a prerelease.

## After publication

Run a clean native install from the registry on the qualified host
(`openclaw plugins install npm:@sess.si/openclaw@0.1.0-rc.5`) and record it in a separate reviewed
PR. ClawHub listing is a separate, separately authorized action (see [RELEASING.md](../RELEASING.md)).
