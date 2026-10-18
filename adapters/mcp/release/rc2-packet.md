# Release packet: `@sess.si/mcp@0.1.0-rc.2`

Maintainer document; not packed. Preparing this candidate publishes nothing. The tag, the
`npm-mcp-release` environment approval and the npm 2FA stage approval are a maintainer's actions.

## What rc.2 contains

- Tool schema `sess-mcp-tools/3`: Advanced `expires_in` on `sess_ask` and `sess_request`, and the link's
  expiry reported through `sess_response` (S-09, sess-sdk #60). The happy-path tools are unchanged.
- One runtime SDK dependency, exact: `@sess.si/sdk@0.1.0-rc.7` (published on `next`), resolved from the
  registry (`compatibility.json` records it as published, with sha256 `6a5c8e74…50e5`).
- "Sess" and "Sess link" in tool descriptions and output (#56, #62); package keywords and homepage (#58);
  `server.json` for the MCP Registry listing (#57).

The full list of changes is in [CHANGELOG.md](../CHANGELOG.md) (the rc.2 entry).

## Expected tarball

Computed by the package's own packed-consumer check (`npm run check`, step `check:package`, which
runs the same `npm pack` the release workflow records in `.artifacts/package-result.json`) on
Node 24.21.0 and npm 11.19.0, the versions the workflow pins.

| Field     | Value                                                                                             |
| --------- | ------------------------------------------------------------------------------------------------- |
| Filename  | `sess.si-mcp-0.1.0-rc.2.tgz`                                                                      |
| SHA-256   | `e9dede5176974ec0ab20d6f39033cac8ac01e57d90d6490532870879046f2d88`                                |
| Integrity | `sha512-Q75jW27FwOxjvDMzLC16fll2q7krZqh/vejLlYPjO4BBMk2F+wqgGqHl9CZrK8RUr858ptJaoL+tu5qBJMu+ow==` |

The release workflow does not read this table; the prepare job's run summary is the record of the
bytes it tested. If another packed change (`dist/` sources, `README.md`, `CHANGELOG.md`, `LICENSE`,
`NOTICE`, `compatibility.json` or `package.json`) lands before the tag, re-run `npm run check` and
update this table in the same PR.

## Maintainer steps

1. Confirm the reviewed PR carrying this packet is merged and its CI is green on master. Note the
   merged master commit `<sha>` and check that it is still version `0.1.0-rc.2`:
   `git show <sha>:adapters/mcp/package.json | grep '"version"'`.
2. Tag that exact commit and push the tag:

   ```sh
   git tag mcp-v0.1.0-rc.2 <sha>
   git push origin mcp-v0.1.0-rc.2
   ```

3. The workflow **Publish approved MCP adapter release** (`.github/workflows/mcp-release.yml`)
   starts. Its prepare job runs the release guards, `npm run check` and `npm audit` at the tag,
   uploads the tested tarball and prints its SHA-256 in the run summary. That SHA-256 must equal
   the value above.
4. Approve the `npm-mcp-release` environment for the publish job. It stages exactly the tested
   tarball with provenance on dist-tag `next` (`npm stage publish`; nothing is installable yet).
5. Check and approve the stage with npm 2FA:

   ```sh
   npm stage list @sess.si/mcp --json
   npm stage download <stage-id>
   shasum -a 256 sess.si-mcp-0.1.0-rc.2.tgz   # must equal the SHA-256 above
   npm stage view <stage-id>                  # tag must be next
   npm stage approve <stage-id>               # npm 2FA
   ```

6. The readback job waits up to 60 minutes for the approval, then checks version, repository and
   directory, registry integrity, dist-tag, dependencies and provenance. If it timed out, re-run
   the failed jobs after approving.
7. Read back yourself:

   ```sh
   npm view @sess.si/mcp@0.1.0-rc.2 version dist.integrity dist.attestations --json
   npm view @sess.si/mcp dist-tags --json     # next: 0.1.0-rc.2; latest stays 0.0.0-stage
   ```

   `dist.integrity` must equal the integrity above and `dist.attestations.provenance` must be
   present. `latest` must not point at a prerelease.

## After publication

A separate reviewed PR records the published version, integrity, dist-tag and provenance link in
`compatibility.json`, and qualifies the registry install (`npx -y @sess.si/mcp@0.1.0-rc.2`) before
any document calls it tested. Submitting `server.json` to the MCP registry is a separate owner
action with `mcp-publisher` ([LISTINGS.md](../LISTINGS.md)).
