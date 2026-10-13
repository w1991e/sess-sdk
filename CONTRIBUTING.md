# Contributing

Use maintained Node 24, or a supported maintained Node 22 patch. Install locked tools explicitly:

```sh
npm ci --ignore-scripts
npm run check
```

Checks cover contract/type drift, formatting, compilation, semantic/security tests, README code and
links, package secret boundaries, and the actual packed consumer. No production key is required.
Package smoke installs dependencies offline from the cache populated by `npm ci`.

To update the public contract, first inspect the runtime change, replace the reviewed snapshot and
provenance lock together, and run `npm run generate`. Do not download schemas on import or installation.
Use `npx --no-install prettier --write .` only after the locked dependency installation.

`npm run check:package` writes `.artifacts/sess-sdk-0.1.0-rc.2.tgz` and a digest/size result. Consumers
can explicitly install that tarball for development; it is not a registry release. The package has
no install, prepare, prepack or publish lifecycle hook and no private runtime dependency.

Keep fixes focused. Add tests for behavior and meaningful failure modes. One independent review
and relevant green CI are the ordinary path. Never use actual credentials, private links or customer
data in tests, issues, artifacts or examples. Follow [Security reporting](SECURITY.md) for vulnerabilities.
