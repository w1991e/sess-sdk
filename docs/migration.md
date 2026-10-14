# Reference-agent migration

The [reference testbed](https://github.com/w1991e/sess-agent-testbed) retains synthetic domain logic,
Surface mapping, checkpoints, startup locking, terminal output, scenario selection and the one-command
demo. Its small adapter delegates owner API operations and receipt verification to `@sess.si/sdk`.
The displaced production HTTP/verifier implementation is removed; raw HTTP remains in a test-only lane.

During candidate development, install the exact tested npm tarball into a disposable consumer.
Do not commit a `file:../sess-sdk`, private Git dependency, `npm link`, or hidden install hook.
`0.1.0-rc.4` is now published on npm under `next`. Consumers move from the digest-pinned test-only
tarball to the exact registry version with an npm-generated lockfile (the testbed in
sess-agent-testbed #8); no nonexistent registry integrity is fabricated.

The public launch flow after that transition is `npm ci`, then `npm run demo`. Installation is now
an explicit prerequisite; the previous dependency-free demo's no-install claim no longer applies.
The demo asks privately for an API key if absent, gives one private link, continues automatically on
the owner side, and distinguishes completed/verifying/passed/stopped/failed. Browser refresh remains
explicit while the deployed renderer requires it.

Recovery must retain the startup lock through run selection and creation, pre-create intent, and
completed-but-unverified resume. Every accepted round is fully verified before application input is
used. Mutation checkpoints now preserve original operation/session/body/ETag/key and credential scope.
Older state is read or reconciled where safe; a missing old ETag is never replaced merely to force
replay. Retained historical input cannot generate a new write against a later revision.

The independent native-fetch HTTP suite uses no SDK transport, decoder, verifier or derived expected
results. It exercises the actual human form endpoint under an isolated fixture; the owner API has
no hidden human-answer shortcut. Existing runtime security/acceptance suites remain in place.
