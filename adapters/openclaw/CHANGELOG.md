# Changelog

## 0.1.0-rc.4 (candidate, unpublished)

- Still depends on `@sess.si/sdk` 0.1.0-rc.8 (sha256 `b533935b…4c95`); no dependency changes.
- Every request to Sess carries `User-Agent: sess-openclaw/0.1.0-rc.4`, set by the plugin's
  guarded fetch (rc.8 sends no User-Agent of its own). An SDK that sends its own token keeps it
  after this one.
- A create that Sess refuses under the workspace's plan (HTTP 429 `PLAN_LIMIT_REACHED`) is now a
  definite refusal: `sess_request` fails with `PLAN_LIMIT_REACHED` (class `create_rejected`) and a
  fixed message, and a redelivery of the same host call reports the same and sends nothing. Before,
  it was `CREATE_OUTCOME_UNKNOWN` ("a Session may exist") and kept as `create_unknown`, though
  nothing had been created. Sess's own message and its link are not relayed. A plain rate limit
  (429 without that code) is still an unknown create outcome.
- The packed check also checks the exact tarball's hygiene (no source maps, test fixtures,
  non-public hosts, credential-shaped strings or internal references), and `compatibility.json`
  no longer carries internal references.
- `compatibility.json` records the publication of `0.1.0-rc.3` on the npm dist-tag `next`
  (2026-10-23): registry SHA-256 and integrity, SLSA provenance and release run 39995130479.
  Earlier publications are listed under `earlierPublications`.

## 0.1.0-rc.3 (published 2026-10-23)

- Depends on `@sess.si/sdk` 0.1.0-rc.8 (was 0.1.0-rc.7), resolved from the registry (sha256
  `b533935b…4c95`). Form-2 receipts verify: rc.8 bundles the renderer identities
  `sess-html-form-1` and `sess-html-form-2`, so `sess_response`, and the re-verification before
  `sess_publish` and `sess_complete`, accept an answer given on Sess's form-2 renderer and verify
  it offline. With rc.7 (in 0.1.0-rc.2) every such answer failed verification. Any other identity
  is checked against the issuer's signed renderer list (Decision 0009 Amendment 13); a list that
  cannot be read is a retryable `UNAVAILABLE`, never a verified answer.
- Sess's length limits for what a person reads, in Unicode code points (were UTF-16 units and
  200/1,000/4,000): title 80, description 280, heading 60, field and option labels 60, field
  description 160, action label 24, record caption 200, record key 40 and string value 200, text
  4,000, with Sess's own wording (SURFACE_TEXT_DOCS) and error sentences. Each such
  field in the tool schema has a one-line purpose and style, `maxLength` and `examples`; the
  interaction schema has one complete example and `sess_request`'s description the style lines.
- A value over its limit fails with `INVALID_ARGUMENTS` plus `field` (a JSON pointer), `limit` and
  `length`, and a message ending with the fix; nothing is truncated. A Sess length refusal on
  create carries the same fields when the SDK reports them.
- `compatibility.json` records the publication of `0.1.0-rc.2` on the npm dist-tag `next`
  (2026-10-19): registry SHA-256 and integrity, SLSA provenance and release run 39189334190.

## 0.1.0-rc.2 (published 2026-10-19)

- Depends on `@sess.si/sdk` 0.1.0-rc.7 (was 0.1.0-rc.5).
- Prose and printed strings say "Sess", not "SESS": tool descriptions, errors, notes, setup and
  doctor output. The link the person opens is the "Sess link" in tool notes and doctor output.
  Tool names, schemas (version 1) and environment variable names are unchanged.
- README and package description say "Sess" in prose and "Sess link"; package keywords and the
  Sess homepage.
- README "First interaction" now starts from a real message of your own: paste or forward it into
  your dashboard conversation, the agent drafts a reply, and you edit, approve or stop it through
  Sess before it goes anywhere. The plugin ships no sample message; a synthetic sample is shown for
  illustration only. The reset-isolation limitation is disclosed as before.
- `compatibility.json` records the publication of `0.1.0-rc.1` on the npm dist-tag `next`
  (2026-10-17): registry SHA-256 and integrity, SLSA provenance and release run 38990667691.

## 0.1.0-rc.1 (published 2026-10-17)

- Native OpenClaw plugin `sess` with four optional tools: `sess_request`, `sess_response`,
  `sess_publish`, `sess_complete` (tool schema version 1, closed schemas).
- Host binding to agent, session key and session incarnation; live invocation guard on every
  dispatch and durable state write.
- Durable interaction records in OpenClaw plugin state (bounded, non-evicting).
- Full SDK receipt verification before an answer is returned as verified.
- After verification, a fresh authenticated read must show the Session still at the requested
  revision (or completed at it) with the same accepted event before an answer is accepted or
  released; progress blocks, a failed read is retryable `UNAVAILABLE`, and a concurrent local
  change is a conflict. No answer data is released in any of these cases (review R-01).
- Every tool result is released only after re-asserting the live invocation authority, including
  terminal `completed` shortcuts (review R-02).
- Capacity: completed and blocked interactions and their create claims move atomically into a
  retained archive outside active admission; claims are never deleted, so late redelivery of an old
  host call never creates another Session. The first call after upgrade migrates the earlier
  single-namespace layout (resumable, idempotent, collision-checked) and fences older plugin
  versions. `openclaw sess doctor` shows redacted counts; `openclaw sess prune` (dry run by default)
  compacts only terminal human links.
- `AUTHORITY_REVOKED` after a created and saved request now says to redeliver the original call.
- Archival treats a destination compacted by a concurrent `prune --apply` as moved, so it never
  restores a stale pre-prune copy (with its human link) into active.
- `openclaw sess doctor` (no network, no secrets). Bundled `sess` skill.
- Real-host qualification on OpenClaw 2026.10.3 (Node 24) used the then-pinned
  `@sess.si/sdk` 0.1.0-rc.3 candidate (held; library source unchanged in rc.4). The package now
  depends on the pinned 0.1.0-rc.5 (`release/sdk-candidate.json`), published on npm under the
  `next` dist-tag; CI installs it from the registry, verifies name, version and integrity against
  the pin, and re-runs the packed-artifact and host-install checks. The loopback candidate-serving
  mode (`scripts/candidate-sdk.mjs`) is removed.
- Release preparation for `openclaw-v0.1.0-rc.1`: the publication path is a stage-only npm trusted
  publisher. The release workflow stages the tested tarball on the dist-tag `next` (every `-rc.N`;
  never `latest`), and nothing is installable until a maintainer approves the staged version with
  npm 2FA. The `0.0.0-stage` placeholder is deprecated with a pointer to `@next` before the first
  release. Preparing the candidate publishes nothing.
