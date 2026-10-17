# Releasing @sess.si/create-agent

Releases run only from `.github/workflows/create-agent-release.yml`, on a tag `create-agent-v<version>`
whose commit is on reviewed `master`. The workflow tests and packs the initializer once, then stages
exactly those bytes with npm provenance. Nothing is installable until a maintainer approves the staged
version with npm 2FA. Release candidates (`-rc.N`) go to `next`, never to `latest`. The guards are
`create-agent/scripts/release-guard.mjs`, self-tested by
`node --test create-agent/scripts/test-release-guard.mjs`.

**Do not push a release tag before steps 1–3 exist.** A job that references a missing environment
makes GitHub create it automatically, without protection rules, and the publish job would then run
without maintainer approval.

The current candidate, `0.1.0-rc.1`, has its contents, expected tarball digests and exact maintainer
steps in [release/rc1-packet.md](release/rc1-packet.md). Each candidate gets such a packet,
`release/rc<N>-packet.md`, updated in the same PR as any packed change.

## One-time maintainer setup

1. **GitHub environment `npm-create-agent-release`** in this repository: add a required reviewer, and
   restrict its deployment refs to tags matching `create-agent-v*`.
2. **Create the npm package.** A trusted publisher can only be configured for a package that exists.
   Stage a never-approved bootstrap version locally (`npm stage publish` of a placeholder from a
   maintainer account). Only once a public `0.0.0-stage` placeholder exists (npm publishes one with
   the bootstrap stage), and if `latest` lands on it, deprecate it with a pointer to `@next`.
3. **Stage-only npm trusted publisher** for `@sess.si/create-agent`, bound to repository
   `w1991e/sess-sdk`, workflow `create-agent-release.yml` and environment `npm-create-agent-release`,
   with direct publishing not permitted. Do not reject the bootstrap stage yet (see "Each release",
   step 5).

## Each release

1. Merge the reviewed version bump. The template's `@sess.si/sdk` must be the published pin in
   `release/sdk-candidate.json`; the guard refuses an unpublished or ranged SDK.
2. Tag the merged master commit `create-agent-v<version>` and push the tag.
3. Approve the `npm-create-agent-release` environment on the run. The publish job stages the tested
   tarball; its summary shows the SHA-256.
4. `npm stage list @sess.si/create-agent --json`, `npm stage download <stage-id>`, check the SHA-256,
   `npm stage view <stage-id>` (tag `next` for a release candidate), then `npm stage approve <stage-id>`
   with 2FA.
5. First release only: after its stage is approved, reject the never-approved bootstrap stage
   (`npm stage list @sess.si/create-agent --json`, then reject it). Never reject it before: rejecting
   the bootstrap stage before the first release is approved deletes the npm package and its trusted
   publisher.
6. The readback job verifies the registry integrity, dist-tag and provenance. Then
   `npm create @sess.si/agent@next my-agent` installs it.
