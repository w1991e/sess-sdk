# Releasing @sess.si/openclaw

Maintainer notes. Preparing this workflow does not authorize a release: every step below that
changes an external system is a separate owner action.

## Prerequisites (owner actions, in order)

1. **SDK publication.** `@sess.si/sdk` at the exact version in `package.json` (currently
   `0.1.0-rc.3`) must be published on the public npm registry with the same bytes the lockfile pins
   (`package-lock.json` integrity). Until then the release guard refuses to run: candidate SDK
   installs are development evidence only.
2. **GitHub environment `npm-openclaw-release`.** Create it with required reviewers and a deployment
   tag rule restricted to `openclaw-v*`. It is the only job with `id-token: write`.
3. **npm trusted publisher.** On npmjs.com, for package `@sess.si/openclaw`, add a GitHub Actions
   trusted publisher bound to repository `w1991e/sess-sdk`, workflow `openclaw-release.yml` and
   environment `npm-openclaw-release`. If the first publication must precede trusted-publisher
   setup, that bootstrap is a separate, explicitly authorized maintainer action with MFA.
4. **Name availability.** Confirm `@sess.si/openclaw` is available to the `sess.si` npm
   organization.

## Release steps

1. Merge the release commit to `master` after independent review and green CI. `package.json`
   `version` is a prerelease (`X.Y.Z-rc.N`); stable versions are refused (promotion to `latest` is a
   separate owner decision).
2. Push the tag `openclaw-v<version>` on that `master` commit (owner action).
3. The `prepare` job (read-only token) checks the tag, package name and path, `master`
   reachability, a clean tree and that the registry serves the locked SDK bytes. It then installs,
   builds, typechecks, tests, self-tests the guard, runs the packed-artifact checks against the
   real registry and a real OpenClaw host, and uploads the exact tarball with its SHA-256.
4. A required reviewer approves the `publish` job. It downloads that artifact by ID, verifies the
   digest, does not rebuild, and runs
   `npm publish <tarball> --ignore-scripts --provenance --access public --tag next`.
5. The job reads the registry back: version, integrity, `next` dist-tag (never `latest`),
   repository and directory, dependencies and peer dependencies, and provenance attestations.
6. After publication, run a clean native install from the registry
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
