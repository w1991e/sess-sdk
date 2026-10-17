# Release packet: `@sess.si/sdk@0.1.0-rc.6`

Maintainer document; not packed. Preparing this candidate publishes nothing. The tag, the
`npm-release` environment approval and the npm 2FA stage approval are a maintainer's actions.

## What rc.6 contains

- `sess.ask({ question, fields })`: one question with simple typed fields, the private link before
  waiting, and `answer()` returning the verified, current answer typed from the fields after
  completing the Session. New types `AskInput`, `AskField`, `AskAnswer`, `AskHandle`, `AskOptions`
  and `AskAnswerOptions`.
- The README opens with `sess.ask()`; the full Surface API is under "Advanced", unchanged.
- Wording: the README's guide list and closing note, and the `0.1.0-rc.3` changelog entry.
- Wording sweep (sess-sdk #55): the README, the package `description` and four error messages say
  "Sess" in plain sentences; the stale manual-refresh caveat is dropped and the workspace audience
  note says Sess supplies it. Error `kind`, `code` and every other field are unchanged.
- **Contract snapshot refreshed** to the OpenAPI document production serves at
  `91ae382e828f14e5b07abbd1fda0e88c2988341b` (`contract/contract-lock.json`). The generated
  `components`, `paths` and `operations` types change with it: they gain the operations that
  document lists, and the Session schemas carry the now-required `action_expires_at`, the stored
  expiry of the Session's human link. The SDK's runtime code is unchanged.

No other packed file changed on master since the `v0.1.0-rc.5` tag. Runtime dependencies are
unchanged (`canonicalize` 5.1.0, `jose` 6.2.12, `standardwebhooks` 1.1.1).

## Expected tarball

Recorded in [`sdk-next-candidate.json`](sdk-next-candidate.json) by `node scripts/sdk-pin.mjs prepare`
(Node 24.21.0, npm 11.19.0). `npm run check` (its `check:pin` step) fails if the packed root differs.

| Field     | Value                                                                                             |
| --------- | ------------------------------------------------------------------------------------------------- |
| Filename  | `sess.si-sdk-0.1.0-rc.6.tgz`                                                                      |
| SHA-256   | `aa3309c62c1f016eb9ca4b6b434478b5ba2191c8d5b5bd3653347bb3c5dedc01`                                |
| Integrity | `sha512-VJhpf9v9d2NCwWUt2CCh9oyijW+PTehb52rLhiqkxE37X6qDE0vcv9xdIB2qJS7A3sOqfsBZvwWnuplvLhRpsA==` |

If another packed change lands before the tag, it re-runs `node scripts/sdk-pin.mjs prepare` and
updates this table in the same PR.

## Maintainer steps

1. Confirm the reviewed PR carrying this packet is merged and its CI is green on master. Note the
   merged master commit `<sha>` and check that it still records the digest above:
   `git show <sha>:release/sdk-next-candidate.json`.
2. Tag that exact commit and push the tag:

   ```sh
   git tag v0.1.0-rc.6 <sha>
   git push origin v0.1.0-rc.6
   ```

3. The workflow **Publish approved SDK release** (`.github/workflows/release.yml`) starts. Its
   validate job runs `npm run check` at the tag (including `check:pin`), uploads the tested tarball
   and prints its SHA-256 in the run summary. That SHA-256 must equal the value above.
4. Approve the `npm-release` environment for the publish job. It stages exactly the tested tarball
   with provenance on dist-tag `next` (`npm stage publish`; nothing is installable yet).
5. Check and approve the stage with npm 2FA:

   ```sh
   npm stage list @sess.si/sdk --json
   npm stage download <stage-id>
   shasum -a 256 sess.si-sdk-0.1.0-rc.6.tgz   # must equal the SHA-256 above
   npm stage view <stage-id>                  # tag must be next
   npm stage approve <stage-id>               # npm 2FA
   ```

6. The readback job waits up to 60 minutes for the approval, then checks registry integrity,
   dist-tag and provenance. If it timed out, re-run the failed jobs after approving.
7. Read back yourself:

   ```sh
   npm view @sess.si/sdk@0.1.0-rc.6 version dist.integrity dist.attestations --json
   npm view @sess.si/sdk dist-tags --json     # next: 0.1.0-rc.6; latest stays 0.0.0-stage
   ```

   `dist.integrity` must equal the integrity above and `dist.attestations.provenance` must be
   present. `latest` must not point at a prerelease; it stays on `0.0.0-stage` until stable `0.1.0`.

## Registry transition (after publication and readback)

A separate reviewed PR, opened only after step 7 succeeds. Until then every consumer stays on the
published `0.1.0-rc.5`, pinned in [`sdk-candidate.json`](sdk-candidate.json).

1. Root: `npm ci --ignore-scripts`, then `npm run pin:update`. It refuses unless the root still
   packs exactly the prepared bytes, then repins `release/sdk-candidate.json` to rc.6, removes
   `release/sdk-next-candidate.json`, and updates the dependency in `adapters/mcp`,
   `adapters/openclaw`, `examples/quickstart-node` and `create-agent/template`, the two adapter
   lockfile entries and `adapters/mcp/compatibility.json`. Then `npm run check`.
2. MCP adapter (`adapters/mcp`): `pin:update` leaves the lock in candidate mode. Run
   `npm run sdk:switch-to-registry` (dry run), then `npm run sdk:switch-to-registry -- --apply`,
   then `npm run setup && npm run check`.
3. OpenClaw adapter (`adapters/openclaw`): `npm ci` from the registry and its checks.
4. Quickstart: `node examples/quickstart-node/scripts/clean-install-check.mjs`; move the
   `0.1.0-rc.5` mentions in `examples/quickstart-node/README.md` to rc.6.
5. create-agent starter: `node create-agent/scripts/clean-install-check.mjs`; the template parity
   check runs in `npm test`. The public starter template repository needs the same SDK version so
   that byte parity holds.
6. Docs: `docs/compatibility.md` and `docs/migration.md` record rc.6 as published; the adapters'
   README, RELEASING and CHANGELOG mentions of rc.5 move to rc.6.
7. Record the published version, registry integrity and readback.
