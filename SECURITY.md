# Security reporting

Report a vulnerability privately through
[GitHub private vulnerability reporting](https://github.com/w1991e/sess-sdk/security/advisories/new)
for this repository. Do not open a public issue, discussion or pull request for a suspected
vulnerability, and do not publish an exploit before a fix and advisory are coordinated.

Never include API keys, private human links, webhook secrets, receipts or customer payloads in a
report or anywhere public. If a secret was exposed, rotate it at its source first: removing it from
code or a report does not revoke it.

Include the SDK version, the Node version, a minimal synthetic reproduction, the impact you expect,
and logs with private data removed. Maintainers reproduce against a pinned commit, prepare a reviewed
fix, and coordinate a GitHub security advisory and a corrected version.

Security fixes target the current 0.1 release line and preserve documented behavior where possible.
See [security boundaries](docs/security.md) and [release and rollback](docs/releasing.md).

## Dependency audit

CI and the SDK release run `node scripts/audit-dependencies.mjs`: `npm audit` over every
dependency, development dependencies included, failing on any advisory at moderate or above. Its
only exceptions are listed, with a reason and an expiry, in `.github/audit-exceptions.json`; the
script's header states its exact rules.

One advisory is excepted today: GHSA-fc5q-39xc-vjpf (picomatch, no fixed version published), until
24 November 2026 17:18 UTC, because picomatch is in the development and test toolchain only and the
globs it parses come from our own configuration. `tests/dependencies/dev-only-picomatch.test.ts`
checks that no published package's own dependencies or optionalDependencies reach picomatch by any
route. Under `@sess.si/openclaw`'s OpenClaw host peer it checks every route and allows one family
and nothing else: routes inside OpenClaw's own npm, entering through openclaw > npm and reaching
picomatch only through node-gyp > tinyglobby (optionally then fdir), to its one installed copy. The
user's OpenClaw brings that npm whether or not our plugin is installed, and our code never loads it.
The starter that `@sess.si/create-agent` writes ships no lockfile, so its graph is resolved when the
user installs it: the create-agent clean install walks the lockfile each real starter install
produced (`scripts/check-starter-graph.mjs`) and fails on any route to picomatch. On 23 November (day 6), if no fix has
shipped, renewal or another route goes to the founder that day. The day a fixed picomatch ships,
upgrade and delete the exception in the same change; the audit fails on an exception whose advisory
is no longer reported, and on one past its date.
