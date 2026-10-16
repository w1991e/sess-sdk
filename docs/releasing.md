# Releasing @sess.si/sdk

The initializer `@sess.si/create-agent` has its own workflow and runbook: [create-agent/RELEASING.md](../create-agent/RELEASING.md).

Release candidates `0.1.0-rc.N` are published under the `next` dist-tag with provenance; `latest`
never points at a prerelease. A green tarball check is not a release. Publication needs an
authorized maintainer's environment approval and npm 2FA stage approval.

## Candidate pin

The published candidate's exact bytes are pinned in
[`release/sdk-candidate.json`](../release/sdk-candidate.json): name, version,
tarball filename, SHA-256 and SHA-512. That file is the single source for every consumer. The MCP and
OpenClaw adapters and CI pack the current repository root with
`node scripts/sdk-pin.mjs pack [--build] [--out <dir>]`, which accepts the tarball only if its bytes
equal the pin. The Node quickstart check instead installs the published version from the npm registry
and accepts it only if npm's recorded integrity equals the pinned SHA-512. `npm run check` ends with `check:pin`. It fails if the packed root differs from the pin,
or if any consumer (adapter dependency, lockfile entry and integrity, MCP compatibility record,
quickstart dependency, `create-agent` starter template dependency) disagrees with it.

Changing a packed file (for example `NOTICE`, `LICENSE`, `README.md`, `CHANGELOG.md`, `package.json`
or `src/`) therefore requires a deliberate repin:

```sh
npm run pin:update   # build + pack the root, rewrite release/sdk-candidate.json and every consumer
npm run check        # root checks, including check:pin
# then: adapters/mcp `npm run setup && npm run check`; the OpenClaw checks; the quickstart check;
# node create-agent/scripts/clean-install-check.mjs
```

`pin:update` is the repin for a version consumers can already install. Since consumers install the
SDK from the npm registry, a new version that is not yet published is **prepared** instead:

```sh
node scripts/sdk-pin.mjs prepare   # build + pack the root, write release/sdk-next-candidate.json only
npm run check                      # check:pin: root bytes = the prepared record; consumers = the pin
```

While `release/sdk-next-candidate.json` exists, `check:pin` compares the packed root with it and
keeps every consumer on the published pin, so the release tag's `npm run check` passes without any
consumer naming an unpublished version. After the prepared version is published, the **registry
transition** is `npm run pin:update`: it refuses unless the root still packs exactly the prepared
bytes, then repins `release/sdk-candidate.json` and every consumer and removes the prepared record.

`pin:update` refuses if the SDK's runtime dependency set changed. That needs a real regeneration of
the adapter lockfiles. Review the resulting diff like any other change.

Publish a version only from a `v<version>` tag on the merged, reviewed master commit whose packed
bytes equal its record, after review and release authorization. The release workflow re-packs and tests
at that tag and publishes only those bytes.

## Prepared successor

A prepared, unpublished version is recorded in `release/sdk-next-candidate.json` while one
exists; consumers stay on the
published pin until the registry transition. Its maintainer steps and expected digests are in its
release packet under [`release/`](../release/).

## Selected publishing mode

Use one GitHub protected environment, **npm-release**, and an npm OIDC trusted publisher that is
**stage-only** (`--allow-stage-publish`; direct publish not permitted). CI runs `npm stage publish`;
nothing becomes installable until a maintainer runs `npm stage approve` with npm 2FA. Bind it to this repository, workflow `release.yml`
and environment `npm-release`. Require an authorized maintainer's environment approval; restrict
its deployment refs to release tags. Ordinary PR CI has only `contents: read` and no publishing token.

Consult the current [npm trusted-publisher guide](https://docs.npmjs.com/trusted-publishers/) at setup.
At preparation time it requires Node >=22.14 and npm >=11.5.1; new publishers allow staged publication
by default, while direct publish needs its own permission. A publisher must be activated with a first
successful publish within npm's current activation window. Match every OIDC identity field exactly.
The workflow pins Node 24.21.0 and npm 11.19.0 and grants `id-token: write` only to the protected release job.

The package must exist before a publisher can be configured. A maintainer creates it by staging a
never-approved bootstrap version locally (npm also publishes a public `0.0.0-stage` placeholder;
if `latest` lands on it, deprecate it with a pointer to `@next`; `latest` never points at a
prerelease), configures the stage-only publisher, then tags the release so CI stages the tested
tarball with provenance. The maintainer checks the staged digest, approves with 2FA and rejects
the bootstrap stage. If the publisher cannot be configured on the placeholder, the fallback is
staging the exact tarball locally (recorded honestly as without provenance). Do not install a
permanent automation token as a workaround.

## Exact artifact release procedure

1. Review the candidate commit, version, changelog, contract lock and interoperability evidence.
2. Merge through the normal review/CI path. The release workflow only accepts a `v<package.version>`
   tag whose commit is reachable from master, in this repository.
3. Create the approved release tag. A job with read-only permissions makes a clean locked install,
   checks generated types/format/source/security/docs, builds once, packs and tests the actual tarball.
   It uploads those bytes and their verification record for maintainer review before the protected
   publication job requests environment approval. No build cache substitutes an earlier output.
   Consumers install without lifecycle scripts or source build tools.
4. The protected job downloads that immutable artifact by ID and verifies its digest against the
   preparation job's output. Publish exactly the path and integrity recorded by `check:package`;
   do not rebuild or install project dependencies between testing and publication. Release candidates
   `0.1.0-rc.N` use `next`; approved stable `0.1.0` uses `latest`.
5. Verify package identity, version, repository, public access, dist-tag, dependency list, registry
   integrity and provenance. [npm provenance](https://docs.npmjs.com/generating-provenance-statements/)
   links an artifact to source/build identity; it is not a correctness or security certification.
6. Install that exact registry version in a clean consumer and run its full checks.
7. Record the SDK source, runtime SHA, contract digest, registry integrity and observed outcome.

The workflow verifies the registry integrity against the tested tarball and checks provenance metadata;
the registry install remains part of release completion.
First-party packed/unpacked size and runtime-dependency count are recorded by the package check for review.
The package record includes the actual Git checkout commit and whether its tree was modified. Release
requires a clean tree at the workflow's exact commit; local modified-tree records are development evidence.
The public tarball excludes contract/review plans, CI, tests, fixture private keys and local checkpoints.

## Versioning, rollback and repair

Before 1.0, breaking documented API changes increase the minor version; patches preserve that API.
Every release version has immutable bytes. Stop promotion for a defective release, then move the
approved dist-tag to a known-good version, deprecate the bad version if warranted, and publish a new
fixed version. Each is a maintainer action. Consumers pinned to the bad version need migration
instructions. Unpublish is not the routine rollback strategy. Revoke any leaked credential at its source.
