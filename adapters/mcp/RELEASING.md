# Releasing `@sess.si/mcp`

Maintainer document; not shipped in the package. A release is the tag `mcp-v<version>` on a
reviewed master commit, published by `.github/workflows/mcp-release.yml`. Nothing is published
from a laptop. Preparing a release does not authorize publishing. The workflow stages the tested
tarball only after a maintainer approves the protected environment, and nothing is installable
until a maintainer approves the staged version with npm 2FA. Release candidates (`-rc.N`) go to
`next`, never to `latest`.

The current candidate, `0.1.0-rc.1`, has its contents, expected tarball digests and exact
maintainer steps in [release/rc1-packet.md](release/rc1-packet.md).

## Prerequisites (owner actions)

> **Do not push an `mcp-v*` tag until the stage-only npm trusted publisher for `@sess.si/mcp`
> (step 4) is configured.** The `npm-mcp-release` environment must keep its required reviewer and
> `mcp-v*` tag rule: a job that references a missing environment makes GitHub create it
> automatically, without protection rules, and the publish job would then run without maintainer
> approval.

1. **SDK published — done.** The pinned `@sess.si/sdk@0.1.0-rc.5` (`release/sdk-candidate.json`) is
   on npm under the dist-tag `next`, with provenance, and its registry tarball has exactly the
   pinned SHA-256 and integrity. `package-lock.json` resolves it from the registry (switched with
   `npm run sdk:switch-to-registry -- --apply`). `npm run setup`, `npm run check`, CI and the
   release workflow all refuse a candidate-mode lock. Never depend on the `latest` dist-tag of
   `@sess.si/sdk` (a deprecated placeholder). For a future SDK pin, publish it first, then repeat the
   switch and merge the reviewed lockfile change before releasing.
2. **GitHub environment `npm-mcp-release` — exists** in `w1991e/sess-sdk`:
   - a required reviewer: the maintainer who approves each publication run. Self-review is
     allowed, so a sole maintainer can approve a run they started; the release gate is the npm 2FA
     approval of the staged version;
   - deployment rule restricted to tags matching `mcp-v*`;
   - no secrets: publishing uses npm trusted publishing (OIDC), not a token.
3. **npm package — exists; no release version is published.** A never-approved bootstrap stage
   created `@sess.si/mcp` so that a trusted publisher can be configured. Only once a public
   `0.0.0-stage` placeholder exists (npm publishes one with the bootstrap stage), and if `latest`
   lands on it, deprecate it with a pointer to `@next` (`latest` never points at a prerelease). The
   package's presence on npm is not a release.
4. **Stage-only npm trusted publisher for `@sess.si/mcp`**, bound to repository `w1991e/sess-sdk`,
   workflow `mcp-release.yml` and environment `npm-mcp-release`, with direct publishing not
   permitted. Do not reject the bootstrap stage yet (see "Cutting a release", step 5).
   Consult the current [npm trusted-publisher guide](https://docs.npmjs.com/trusted-publishers/) when configuring it and
   match every OIDC identity field exactly. Do not install an automation token as a workaround.
5. **MCP registry namespace — approved.** The owner approved `io.github.w1991e/sess` on
   2026-10-14. `server.json` `name` and `package.json` `mcpName` both use it (a test keeps them
   equal). Submitting `server.json` to the official registry is still a separate owner action; it
   needs GitHub authentication as `w1991e` with `mcp-publisher`. The registry checks that the
   published package's `mcpName` equals the server name, so changing it later needs a new package
   version.

## Cutting a release

1. Bump `version` in `package.json`, `src/version.ts` and `compatibility.json` (`package.version`),
   run `npm run listing` to regenerate `server.json` and the other listing artifacts from
   `listing.json`, update `CHANGELOG.md`, merge to master.
2. Tag the merged commit: `git tag mcp-v<version> <commit> && git push origin mcp-v<version>`.
3. Review the prepare job's summary (tested tarball link and SHA-256), then approve the
   `npm-mcp-release` deployment. The publish job stages the tested tarball.
4. `npm stage list @sess.si/mcp --json`, `npm stage download <stage-id>`, check the SHA-256,
   `npm stage view <stage-id>` (tag `next` for a release candidate), then
   `npm stage approve <stage-id>` with 2FA. The readback job then verifies the registry.
5. First release only: after its stage is approved, reject the never-approved bootstrap stage
   (`npm stage list @sess.si/mcp --json`, then reject it). Never reject it before: rejecting the
   bootstrap stage before the first release is approved deletes the npm package and its trusted
   publisher.

Each candidate gets a release packet, `release/rc<N>-packet.md`, recording its contents, the
expected tarball filename, SHA-256 and integrity from `npm run check` (`.artifacts/package-result.json`)
and these steps; update it in the same PR as any packed change.

## What the workflow verifies

Prepare job (`contents: read`, no OIDC identity), Node 24.21.0 and npm 11.19.0:

- the tag is exactly `refs/tags/mcp-v<package.json version>` in `w1991e/sess-sdk`; the package is
  `@sess.si/mcp` at `adapters/mcp` in that repository, public, not private; `mcpName` equals the
  `server.json` name and `server.json` names the same npm package and version;
- the lock resolves `@sess.si/sdk` to the genuine registry tarball with the pinned integrity
  (`setup --require-registry`; the candidate mode is refused);
- the tagged commit is reachable from `origin/master`, and the tree is clean;
- full checks: build, typecheck, unit tests, release-guard self-test and the packed-consumer check
  (offline `--ignore-scripts` install, import-time side effects, installed bin over stdio with the
  official MCP client), plus `npm audit --omit=dev`;
- the tested tarball's SHA-256/SHA-512 and its source commit (clean tree, registry SDK) are
  recorded and uploaded as the exact artifact.

Publish job (environment `npm-mcp-release`; only this job has `id-token: write`):

- downloads that artifact by ID; the checkout supplies only `package.json` and the dependency-free
  guard script; nothing is installed or rebuilt;
- re-verifies name, version, filename, Node, registry SDK mode, source commit and both digests
  against the prepare job's outputs;
- `npm stage publish <tarball> --ignore-scripts --provenance --access public --tag <tag>`, where a
  `-rc.N` version always uses `next` (never `latest`). The trusted publisher is stage-only; a
  maintainer verifies the staged digest and runs `npm stage approve` with npm 2FA;
- a read-only `readback` job then waits for that approval and reads the registry back: version, repository and directory, integrity equal to the tested
  bytes, the dist-tag (and that an rc is not `latest`), dependencies, and provenance attestations.

Run the guard tests locally with `npm run release:self-test`; they refuse a wrong tag, version,
package name or path, the candidate SDK, an off-master commit, a dirty tree, changed bytes and a
mismatched readback. Nothing in them publishes.

## After publication

Record the published version, integrity, dist-tag and provenance link in `compatibility.json`, and
qualify the registry install (`npx -y @sess.si/mcp@<version>`) before documenting it as tested.
Submitting `server.json` to the MCP registry is a separate owner action with `mcp-publisher`; see
[LISTINGS.md](LISTINGS.md).
