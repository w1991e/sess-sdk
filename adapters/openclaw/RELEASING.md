# Releasing @sess.si/openclaw

Maintainer notes. Preparing this workflow does not authorize a release: every step below that
changes an external system is a separate owner action. The workflow stages the tested tarball only
after a maintainer approves the protected environment, and nothing is installable until a
maintainer approves the staged version with npm 2FA. Release candidates (`-rc.N`) go to `next`,
never to `latest`; a stable version (`X.Y.Z`) goes to `latest`, the same rule as the SDK, the MCP
adapter and create-agent (owner decision 2026-10-31).

The current published candidate is `0.1.0-rc.5` (npm `next`, 2026-10-27; integrity and SHA-256 as
recorded in [release/rc5-packet.md](release/rc5-packet.md) and `compatibility.json`). No unpublished
candidate is pending. `0.1.0-rc.4` ([release/rc4-packet.md](release/rc4-packet.md)), `0.1.0-rc.3`
([release/rc3-packet.md](release/rc3-packet.md)), `0.1.0-rc.2`
([release/rc2-packet.md](release/rc2-packet.md)) and `0.1.0-rc.1`
([release/rc1-packet.md](release/rc1-packet.md)) are published as well. Each candidate gets such a
packet, `release/rc<N>-packet.md`, updated in the same PR as any packed change.

## Prerequisites (owner actions, in order)

> **Do not push an `openclaw-v*` tag until the stage-only npm trusted publisher for
> `@sess.si/openclaw` (step 4) is configured.** The `npm-openclaw-release` environment must keep its
> required reviewer and `openclaw-v*` tag rule: a job that references a missing environment makes
> GitHub create it automatically without protection rules, so the publish job would run without
> maintainer approval.

1. **SDK publication.** `@sess.si/sdk` at the exact version in `package.json` (the repository pin
   `release/sdk-candidate.json`) must be published on the public npm registry with the same bytes
   the lockfile pins (`package-lock.json` integrity); the release guard refuses otherwise.
   `@sess.si/sdk@0.1.0-rc.9` is published under the `next` dist-tag with those bytes. CI and
   `npm run check` install it from the registry and verify it against the pin
   (`scripts/registry-sdk.mjs`). A future SDK pin must be published before the adapter adopts it.
2. **GitHub environment `npm-openclaw-release` — exists.** It has a required reviewer (the
   maintainer who approves each publication run) and a deployment tag rule restricted to
   `openclaw-v*`; its `publish` job is the only job with `id-token: write`. Self-review is allowed,
   so a sole maintainer can approve a run they started; the release gate is the npm 2FA approval of
   the staged version. No secrets: publishing uses npm trusted publishing (OIDC), not a token.
3. **npm package — exists; no release version is published.** A never-approved bootstrap stage
   created `@sess.si/openclaw` in the `sess.si` scope so that a trusted publisher can be configured.
   Only once a public `0.0.0-stage` placeholder exists (npm publishes one with the bootstrap stage),
   and if `latest` lands on it, deprecate it with a pointer to `@next` (`latest` never points at a
   prerelease). The package's presence on npm is not a release.
4. **Stage-only npm trusted publisher.** On npmjs.com, for package `@sess.si/openclaw`, add a GitHub
   Actions trusted publisher bound to repository `w1991e/sess-sdk`, workflow `openclaw-release.yml`
   and environment `npm-openclaw-release`, with direct publishing not permitted. Do not reject the
   bootstrap stage yet (see "Release steps", step 6). Consult the current
   [npm trusted-publisher guide](https://docs.npmjs.com/trusted-publishers/) when configuring it and
   match every OIDC identity field exactly. Do not install an automation token as a workaround.

## Release steps

1. Merge the release commit to `master` after independent review and green CI. `package.json`
   `version` is a release candidate (`X.Y.Z-rc.N`, published to `next`) or a stable version
   (`X.Y.Z`, published to `latest`); any other shape, or a `license` other than `Apache-2.0`, is
   refused.
2. Push the tag `openclaw-v<version>` on that `master` commit (owner action).
3. The `prepare` job (read-only token) checks the tag, package name and path, `master`
   reachability, a clean tree and that the registry serves the locked SDK bytes. It then installs,
   builds, typechecks, tests, self-tests the guard, runs the packed-artifact checks against the
   real registry and a real OpenClaw host, and uploads the exact tarball with its SHA-256.
4. A required reviewer approves the `publish` job. It downloads that artifact by ID, verifies the
   digest, does not rebuild, and runs
   `npm stage publish <tarball> --ignore-scripts --provenance --access public --tag <next|latest>`,
   the tag the guard derived from the version.
   The trusted publisher is stage-only; nothing is installable yet.
5. A maintainer runs `npm stage list @sess.si/openclaw --json`, `npm stage download <stage-id>`,
   checks the SHA-256, confirms with `npm stage view <stage-id>` that the tag is the expected one
   (`next` for a candidate, `latest` for a stable version), then runs
   `npm stage approve <stage-id>` with npm 2FA.
6. First release only: after its stage is approved, reject the never-approved bootstrap stage
   (`npm stage list @sess.si/openclaw --json`, then reject it). Never reject it before: rejecting
   the bootstrap stage before the first release is approved deletes the npm package and its trusted
   publisher.
7. A read-only `readback` job waits for that approval, then reads the registry back: version, integrity, the dist-tag (`next` for a candidate, which `latest` must never point at; `latest` for a stable version),
   repository and directory, dependencies and peer dependencies, and provenance attestations.
8. After publication, run a clean native install from the registry
   (`openclaw plugins install npm:@sess.si/openclaw@<version>`) on the qualified host and record it.

Root SDK tags are `v*`; this workflow only reacts to `openclaw-v*`, so neither can publish the
other package.

## ClawHub

ClawHub listing is separate from npm and is not performed by this workflow. It needs its own
authorization: confirm the `sess.si` namespace and ownership on ClawHub, run the ClawHub validator
and a dry run against the exact published contents, then submit. Do not describe a pending listing
as an available installation channel, and do not call the plugin official or endorsed.

## Rollback

Do not unpublish or reuse a version. A release owner can deprecate a defective version and publish
a fixed prerelease. Recovery-record compatibility: a newer schema must stop older versions safely
(see README "Stored state, capacity and upgrade").
