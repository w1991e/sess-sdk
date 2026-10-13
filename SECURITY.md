# Security reporting

Do not include API keys, private human links, webhook secrets, receipts or customer payloads in
public issues. Do not open a public exploit report before a private disclosure route is confirmed.

**Release prerequisite:** the owner must enable and verify GitHub private vulnerability reporting
for this repository before public release. No private reporting channel has yet been independently
confirmed for this unpublished candidate. The intended reporting page is
[GitHub private security advisories](https://github.com/w1991e/sess-sdk/security/advisories/new).
If that page is unavailable, contact a maintainer through an already established private channel;
do not assume a guessed email address is monitored.

Include the SDK version, supported Node version, minimal synthetic reproduction, impact and safe
logs without private data. Maintainers reproduce against a pinned commit, prepare a reviewed fix,
and coordinate an advisory and corrected version. Removing a leaked secret from source does not
revoke it; the affected operator must rotate it at its source.

The candidate supports the current 0.1 release line. Security fixes preserve documented behavior
where possible. See [security boundaries](docs/security.md) and [release/rollback](docs/releasing.md).
