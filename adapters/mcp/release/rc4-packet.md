# Release packet: `@sess.si/mcp@0.1.0-rc.4`

Maintainer document; not packed. Preparing this candidate publishes nothing. The tag, the
`npm-mcp-release` environment approval and the npm 2FA stage approval are a maintainer's actions.

The registry is at `0.1.0-rc.3` (npm `next`, published 2026-10-23). rc.4 follows it.

## What rc.4 contains

- The same runtime SDK dependency as rc.3, exact: `@sess.si/sdk@0.1.0-rc.8` (published on `next`),
  resolved from the registry (`compatibility.json` `sessSdk`, checked by `npm run sdk:verify` and
  the release guard). No dependency changes.

  | Field     | Value                                                                                             |
  | --------- | ------------------------------------------------------------------------------------------------- |
  | Tarball   | `https://registry.npmjs.org/@sess.si/sdk/-/sdk-0.1.0-rc.8.tgz`                                    |
  | SHA-256   | `b533935b98020354010ca4e1a14901e8bc5218ca4b129422a8f8a6fa97684c95`                                |
  | Integrity | `sha512-TlON9nYHkuFl6Al0TeGl9GUiPx65QpvpOBOHGdIp/ukt+3xXM5b2+4//pMN5RB0lsf031GoSZQFsXvkFScuykA==` |

- `User-Agent: sess-mcp/<version>` on every request to Sess, from the stdio server and the hosted
  HTTP handler (#4). On SDK rc.8 that is the whole header.
- `sess_complete` is the rule after an answer, not an option: the server instructions and the
  `sess_response` and `sess_complete` descriptions say so (#5). Descriptions and instructions only;
  schemas, results and `sess-mcp-tools/4` are unchanged.
- A plan limit (HTTP 429 `PLAN_LIMIT_REACHED`) is a definite refusal, `PLAN_LIMIT_REACHED` with class
  `create_rejected`, not an unknown create outcome (#88).
- The MCP Registry entry `si.sess/sess`, remote-only (#87). `package.json` `mcpName` stays
  `io.github.w1991e/sess`, as in rc.3.
- The packed check also checks the tarball's hygiene (#82), and current files carry no
  internal-role references (#85).

Commits on master since `mcp-v0.1.0-rc.3` (`df4083b`) that change `adapters/mcp`:

| Commit    | Change                                                                          |
| --------- | ------------------------------------------------------------------------------- |
| `40c0aca` | packed-tarball hygiene guard (#82)                                              |
| `a1348cd` | remove internal-role references from current files (#85)                        |
| `842f6ed` | a plan limit (429 `PLAN_LIMIT_REACHED`) is a definite refusal (#88)             |
| `b98eee5` | listings: `si.sess/sess` registry name, OpenAI and Claude limits enforced (#87) |
| `6e31164` | User-Agent product tokens, including `sess-mcp/<version>` (#4)                  |
| `24be855` | `sess_complete` is the rule after an answer (#5)                                |

The full list of changes is in [CHANGELOG.md](../CHANGELOG.md) (the rc.4 entry).

## Expected tarball

Computed by the package's own packed-consumer check (`npm run check`, step `check:package`, which
runs the same `npm pack` the release workflow records in `.artifacts/package-result.json`) on
Node 24.21.0 and npm 11.19.0, the versions the workflow pins, at clean commit `f3b32b8` (registry
SDK mode, `sourceTreeDirty: false`). A second `npm run check` at the same commit reproduced the
same SHA-256 and integrity.

| Field     | Value                                                                                             |
| --------- | ------------------------------------------------------------------------------------------------- |
| Filename  | `sess.si-mcp-0.1.0-rc.4.tgz`                                                                      |
| SHA-256   | `f27a763492a7ea7c6ed5547b72ecd002212474798161ea437a0b102665c533d7`                                |
| Integrity | `sha512-+3EwdJWGtBd/8HdSm0alTOgXW7tm5HHgHisoIg0c0t6laQbXm/kQXarl3a6M70AxeYYZmbFDEvmdHQx1CRbKhQ==` |

The release workflow does not read this table; the prepare job's run summary is the record of the
bytes it tested. If another packed change (`dist/` sources, `README.md`, `CHANGELOG.md`, `LICENSE`,
`NOTICE`, `compatibility.json` or `package.json`) lands before the tag, re-run `npm run check` and
update this table in the same PR.

## Maintainer steps

1. Confirm the reviewed PR carrying this packet is merged and its CI is green on master. Note the
   merged master commit `<sha>` and check that it is still version `0.1.0-rc.4`:
   `git show <sha>:adapters/mcp/package.json | grep '"version"'`.
2. Tag that exact commit and push the tag:

   ```sh
   git tag mcp-v0.1.0-rc.4 <sha>
   git push origin mcp-v0.1.0-rc.4
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
   shasum -a 256 sess.si-mcp-0.1.0-rc.4.tgz   # must equal the SHA-256 above
   npm stage view <stage-id>                  # tag must be next
   npm stage approve <stage-id>               # npm 2FA
   ```

6. The readback job waits up to 60 minutes for the approval, then checks version, repository and
   directory, registry integrity, dist-tag, dependencies and provenance. If it timed out, re-run
   the failed jobs after approving.
7. Read back yourself:

   ```sh
   npm view @sess.si/mcp@0.1.0-rc.4 version dependencies dist.integrity dist.attestations --json
   npm view @sess.si/mcp dist-tags --json     # next: 0.1.0-rc.4; latest stays 0.0.0-stage
   ```

   `dist.integrity` must equal the integrity above, `dependencies` must name
   `"@sess.si/sdk": "0.1.0-rc.8"`, and `dist.attestations.provenance` must be present. `latest`
   must not point at a prerelease.

## After publication

A separate reviewed PR records the published version, integrity, dist-tag and provenance link in
`compatibility.json` (rc.3 moves to `earlier`), sets `listing.json` `stdio.status` back to
`published` and regenerates the listing artifacts, and qualifies the registry install
(`npx -y @sess.si/mcp@0.1.0-rc.4`) before any document calls it tested. Submitting `server.json`
to the MCP registry is a separate owner action with `mcp-publisher` ([LISTINGS.md](../LISTINGS.md)).
