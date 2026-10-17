# Release packet: `@sess.si/mcp@0.1.0-rc.1`

Maintainer document; not packed. Preparing this candidate publishes nothing. The tag, the
`npm-mcp-release` environment approval and the npm 2FA stage approval are a maintainer's actions.

## What rc.1 contains

- The first candidate of the local stdio MCP server for SESS: five tools with closed, versioned
  schemas (`sess-mcp-tools/2`): `sess_ask`, `sess_request`, `sess_response`, `sess_publish` and
  `sess_complete`. The private link is returned before any wait; an answer is released only after
  full receipt verification and a fresh current-revision read.
- The `sess-mcp` bin (stdio) and the library export `@sess.si/mcp/http`
  (`createSessMcpHttpHandler`, stateless Streamable HTTP; no server, bin flag or deployment).
- `compatibility.json` (status `candidate`) and the MCP registry name `io.github.w1991e/sess`
  (`package.json` `mcpName`, equal to `server.json`). `server.json` is not submitted.
- Runtime dependencies, exact: `@sess.si/sdk@0.1.0-rc.5` (the published pin in
  [`release/sdk-candidate.json`](../../../release/sdk-candidate.json), dist-tag `next`),
  `@modelcontextprotocol/server@2.3.1` and `@modelcontextprotocol/node@2.1.1`.
  `package-lock.json` resolves the SDK from `https://registry.npmjs.org/@sess.si/sdk/-/sdk-0.1.0-rc.5.tgz`
  with the pinned integrity; `npm run sdk:verify` (`verify --require-registry`) re-reads the
  registry tarball and compares both digests with the pin.
- Person-facing text says "Sess" (README, package description, tool titles, server instructions,
  tool messages, listing artifacts); environment variables, error codes and tool names are unchanged.

The full list of changes is in [CHANGELOG.md](../CHANGELOG.md).

## Expected tarball

Computed by the package's own packed-consumer check (`npm run check`, step `check:package`, which
runs the same `npm pack` the release workflow records in `.artifacts/package-result.json`) on
Node 24.21.0 and npm 11.19.0, the versions the workflow pins.

| Field     | Value                                                                                             |
| --------- | ------------------------------------------------------------------------------------------------- |
| Filename  | `sess.si-mcp-0.1.0-rc.1.tgz`                                                                      |
| SHA-256   | `189907304cf1275892e9be8ba93bf80517b14f92303c8a33a9f7684306123180`                                |
| Integrity | `sha512-X6i8Ws44XlL2Ki9RupQd57e7yGuSh0z94GboziPKFUzKahLEVWi/7phWoudzQ1hto1Qb9tT5U6a4DRAvd0aNCw==` |

The release workflow does not read this table; the prepare job's run summary is the record of the
bytes it tested. If another packed change (`dist/` sources, `README.md`, `CHANGELOG.md`, `LICENSE`,
`NOTICE`, `compatibility.json` or `package.json`) lands before the tag, re-run `npm run check` and
update this table in the same PR.

## One-time setup (before the first tag)

1. Deprecate the public placeholder:
   `npm deprecate @sess.si/mcp@0.0.0-stage "Placeholder, not a release. Install @sess.si/mcp@next."`
2. On npmjs.com, add a **stage-only** GitHub Actions trusted publisher for `@sess.si/mcp`:
   repository `w1991e/sess-sdk`, workflow `mcp-release.yml`, environment `npm-mcp-release`,
   direct publishing not permitted.
3. Reject the never-approved bootstrap stage (`npm stage list @sess.si/mcp --json`, then reject it).
4. Check that the GitHub environment `npm-mcp-release` still has its required reviewer and the
   `mcp-v*` tag rule. Do not push an `mcp-v*` tag before steps 1 to 4 are done.

## Maintainer steps

1. Confirm the reviewed PR carrying this packet is merged and its CI is green on master. Note the
   merged master commit `<sha>` and check that it is still version `0.1.0-rc.1`:
   `git show <sha>:adapters/mcp/package.json | grep '"version"'`.
2. Tag that exact commit and push the tag:

   ```sh
   git tag mcp-v0.1.0-rc.1 <sha>
   git push origin mcp-v0.1.0-rc.1
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
   shasum -a 256 sess.si-mcp-0.1.0-rc.1.tgz   # must equal the SHA-256 above
   npm stage view <stage-id>                  # tag must be next
   npm stage approve <stage-id>               # npm 2FA
   ```

6. The readback job waits up to 60 minutes for the approval, then checks version, repository and
   directory, registry integrity, dist-tag, dependencies and provenance. If it timed out, re-run
   the failed jobs after approving.
7. Read back yourself:

   ```sh
   npm view @sess.si/mcp@0.1.0-rc.1 version dist.integrity dist.attestations --json
   npm view @sess.si/mcp dist-tags --json     # next: 0.1.0-rc.1; latest stays 0.0.0-stage
   ```

   `dist.integrity` must equal the integrity above and `dist.attestations.provenance` must be
   present. `latest` must not point at a prerelease.

## After publication

A separate reviewed PR records the published version, integrity, dist-tag and provenance link in
`compatibility.json`, and qualifies the registry install (`npx -y @sess.si/mcp@0.1.0-rc.1`) before
any document calls it tested. Submitting `server.json` to the MCP registry is a separate owner
action with `mcp-publisher` ([LISTINGS.md](../LISTINGS.md)).
