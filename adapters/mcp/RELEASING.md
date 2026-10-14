# Releasing `@sess.si/mcp`

Maintainer document; not shipped in the package. A release is the tag `mcp-v<version>` on a
reviewed master commit, published by `.github/workflows/mcp-release.yml`. Nothing is published
from a laptop. Preparing a release does not authorize publishing; the protected environment
approval does.

## Prerequisites (owner actions)

1. **Publish the SDK first.** `@sess.si/sdk@0.1.0-rc.3` must be genuinely published with the
   reviewed bytes (SHA-256 `b4d29d8f…a0502`). Then, in `adapters/mcp`, run
   `npm run sdk:switch-to-registry -- --apply` and `npm run check`, and merge the lockfile change
   through review. Until then the workflow refuses: a candidate-mode lock cannot be released.
2. **GitHub environment `npm-mcp-release`** in `w1991e/sess-sdk`:
   - required reviewers (maintainers who approve each publication), self-review disabled;
   - deployment rule restricted to tags matching `mcp-v*`;
   - no secrets: publishing uses npm trusted publishing (OIDC), not a token.
3. **npm trusted publisher for `@sess.si/mcp`**, bound to repository `w1991e/sess-sdk`, workflow
   `mcp-release.yml` and environment `npm-mcp-release`. The `@sess.si` scope must allow the package
   name. The package does not exist on npm yet; npm's flow for a first publish under trusted
   publishing needs to be confirmed by the owner when configuring it.
4. **MCP registry namespace** (only when submitting to the official registry, which is a separate
   later decision). `server.json` and `package.json` `mcpName` use `io.github.w1991e/sess`, which
   needs GitHub authentication as `w1991e` with `mcp-publisher`. A `si.sess/*` name would instead
   need DNS verification of `sess.si`. Decide before the first npm publish: the registry checks
   that the published package's `mcpName` equals the server name, so changing it later needs a
   new package version.

## Cutting a release

1. Bump `version` in `package.json`, `src/version.ts`, `compatibility.json` (`package.version`) and
   `server.json` (`version` and `packages[0].version`), update `CHANGELOG.md`, merge to master.
2. Tag the merged commit: `git tag mcp-v<version> <commit> && git push origin mcp-v<version>`.
3. Review the prepare job's summary (tested tarball link and SHA-256), then approve the
   `npm-mcp-release` deployment.

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
- `npm publish <tarball> --ignore-scripts --provenance --access public --tag <tag>`, where a
  `-rc.N` version always uses `next` (never `latest`);
- reads the registry back: version, repository and directory, integrity equal to the tested
  bytes, the dist-tag (and that an rc is not `latest`), dependencies, and provenance attestations.

Run the guard tests locally with `npm run release:self-test`; they refuse a wrong tag, version,
package name or path, the candidate SDK, an off-master commit, a dirty tree, changed bytes and a
mismatched readback. Nothing in them publishes.

## After publication

Record the published version, integrity, dist-tag and provenance link in `compatibility.json`, and
qualify the registry install (`npx -y @sess.si/mcp@<version>`) before documenting it as tested.
Submitting `server.json` to the MCP registry is a separate owner action with `mcp-publisher`.
