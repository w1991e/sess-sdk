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
