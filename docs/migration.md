# Migrating to the registry package

Install the exact published version from npm (for example `npm install --save-exact @sess.si/sdk@0.1.0-rc.9`) and commit the npm-generated lockfile; remove any local tarball, `file:` path, `npm link` or Git dependency.
Owner API operations and receipt verification go through `@sess.si/sdk`; keep your own checkpoints, startup lock and application logic, and verify every accepted round before using its data.
See [Integration](integration.md) for checkpoints and recovery, and [Compatibility](compatibility.md) for supported runtimes.
