# Release packet: `@sess.si/mcp@0.1.0-rc.3`

Maintainer document; not packed. Preparing this candidate publishes nothing. The tag, the
`npm-mcp-release` environment approval and the npm 2FA stage approval are a maintainer's actions.

## What rc.3 contains

- One runtime SDK dependency, exact: `@sess.si/sdk@0.1.0-rc.8` (published on `next`), resolved from the
  registry (`compatibility.json` `sessSdk`, checked by `npm run sdk:verify` and the release guard):

  | Field     | Value                                                                                             |
  | --------- | ------------------------------------------------------------------------------------------------- |
  | Tarball   | `https://registry.npmjs.org/@sess.si/sdk/-/sdk-0.1.0-rc.8.tgz`                                    |
  | SHA-256   | `b533935b98020354010ca4e1a14901e8bc5218ca4b129422a8f8a6fa97684c95`                                |
  | Integrity | `sha512-TlON9nYHkuFl6Al0TeGl9GUiPx65QpvpOBOHGdIp/ukt+3xXM5b2+4//pMN5RB0lsf031GoSZQFsXvkFScuykA==` |

- Form-2 receipts verify. rc.8 bundles the renderer identities `sess-html-form-1` and
  `sess-html-form-2`, so `sess_response` and `sess_ask` accept an answer given on Sess's form-2
  renderer and verify it offline. The published rc.2 depends on rc.7, which rejects every form-2
  receipt. `tests/convergence.test.ts` ("renderer identities") signs a form-2 receipt and runs it
  through the real SDK verifier.
- Link timing (#69, #73), tool schemas `sess-mcp-tools/4` with Sess's length limits (#75), and
  `server.json` naming this exact version.

The full list of changes is in [CHANGELOG.md](../CHANGELOG.md) (the rc.3 entry).

## Expected tarball

Computed by the package's own packed-consumer check (`npm run check`, step `check:package`, which
runs the same `npm pack` the release workflow records in `.artifacts/package-result.json`) on
Node 24.21.0 and npm 11.19.0, the versions the workflow pins, at clean commit `0220ea9` (registry
SDK mode, `sourceTreeDirty: false`).

| Field     | Value                                                                                             |
| --------- | ------------------------------------------------------------------------------------------------- |
| Filename  | `sess.si-mcp-0.1.0-rc.3.tgz`                                                                      |
| SHA-256   | `d6b5d3d71205c4fcf7884d317a6e0c74806907ac32c5beb9778c2aa1446bc837`                                |
| Integrity | `sha512-Gc/hUu0H+gDvp0PSnNytCsTojolfpJ6ZkNlkMu0JLYH0IIYXl4oFwFvGBoJwQRekEnnstrOX5rQ7SEOJRa+Cvw==` |

The release workflow does not read this table; the prepare job's run summary is the record of the
bytes it tested. If another packed change (`dist/` sources, `README.md`, `CHANGELOG.md`, `LICENSE`,
`NOTICE`, `compatibility.json` or `package.json`) lands before the tag, re-run `npm run check` and
update this table in the same PR.

## Maintainer steps

1. Confirm the reviewed PR carrying this packet is merged and its CI is green on master. Note the
   merged master commit `<sha>` and check that it is still version `0.1.0-rc.3`:
   `git show <sha>:adapters/mcp/package.json | grep '"version"'`.
2. Tag that exact commit and push the tag:

   ```sh
   git tag mcp-v0.1.0-rc.3 <sha>
   git push origin mcp-v0.1.0-rc.3
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
   shasum -a 256 sess.si-mcp-0.1.0-rc.3.tgz   # must equal the SHA-256 above
   npm stage view <stage-id>                  # tag must be next
   npm stage approve <stage-id>               # npm 2FA
   ```

6. The readback job waits up to 60 minutes for the approval, then checks version, repository and
   directory, registry integrity, dist-tag, dependencies and provenance. If it timed out, re-run
   the failed jobs after approving.
7. Read back yourself:

   ```sh
   npm view @sess.si/mcp@0.1.0-rc.3 version dependencies dist.integrity dist.attestations --json
   npm view @sess.si/mcp dist-tags --json     # next: 0.1.0-rc.3; latest stays 0.0.0-stage
   ```

   `dist.integrity` must equal the integrity above, `dependencies` must name
   `"@sess.si/sdk": "0.1.0-rc.8"`, and `dist.attestations.provenance` must be present. `latest`
   must not point at a prerelease.

## After publication

A separate reviewed PR records the published version, integrity, dist-tag and provenance link in
`compatibility.json`, and qualifies the registry install (`npx -y @sess.si/mcp@0.1.0-rc.3`) before
any document calls it tested. Submitting `server.json` to the MCP registry is a separate owner
action with `mcp-publisher` ([LISTINGS.md](../LISTINGS.md)).
