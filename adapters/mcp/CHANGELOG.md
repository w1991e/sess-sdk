# Changelog

## Unreleased

- Every request to Sess, from the local stdio server and the hosted HTTP handler, carries
  `User-Agent: sess-mcp/<version>` (this package's version). On `@sess.si/sdk` 0.1.0-rc.8 that is
  the whole header; an SDK that sends its own token keeps it after this one.

- MCP Registry entry `si.sess/sess` (`server.json`), the `sess.si` domain namespace authenticated by
  DNS, replacing `io.github.w1991e/sess`. The entry is remote-only (`https://mcp.sess.si/mcp`): it
  lists no npm package, so `package.json` `mcpName` stays `io.github.w1991e/sess`, the published
  0.1.0-rc.3's. Listing metadata only; no runtime or package change.
- A create that Sess refuses under the workspace's plan (HTTP 429 `PLAN_LIMIT_REACHED`) is now a
  definite refusal: `sess_request` and `sess_ask` return the tool error `PLAN_LIMIT_REACHED`
  (class `create_rejected`, `retryable: false`) with a fixed message, and keep no record. Before,
  it was reported as `CREATE_OUTCOME_UNKNOWN` ("a Session may exist") and kept as
  `create_unknown`, though nothing had been created. Sess's own message and its link are not
  relayed. A plain rate limit (429 without that code) is still an unknown create outcome.

## 0.1.0-rc.3 (published 2026-10-23, npm dist-tag `next`)

Integrity `sha512-Gc/hUu0H…Ra+Cvw==`, SHA-256 `d6b5d3d7…6bc837`, as in `release/rc3-packet.md`.

- Depends on `@sess.si/sdk` 0.1.0-rc.8 (was 0.1.0-rc.7), resolved from the registry (sha256
  `b533935b…4c95`). Form-2 receipts verify: rc.8 bundles the renderer identities
  `sess-html-form-1` and `sess-html-form-2`, so `sess_response` and `sess_ask` accept an answer
  given on Sess's form-2 renderer and verify it offline. With rc.7 (in 0.1.0-rc.2) every such
  answer failed verification. Any other identity is checked against the issuer's signed renderer
  list (Decision 0009 Amendment 13); a list that cannot be read is a retryable `SESS_UNAVAILABLE`
  that records nothing, never a verified answer.
- Link timing (Decision 0009 Amendment 10). A lapsed link (past its deadline, but the person can
  still ask for more time until its horizon) is still open: `sess_response`, and so `sess_ask`,
  report `waiting`, never `expired`. `expired` is reported only once a read shows the link expired:
  past its end (its horizon while an extension is left, else its deadline) plus the two-second
  grace; or, when it expired before that end (revoked) or gives no end, once a read-once
  (`wait_ms` 0) at least the grace after the first such read still shows it, as in the SDK wait,
  so an answer accepted just before a revocation is never reported as `expired`. That first read is
  remembered in memory only: a restart, or a hosted server's per-request adapter, starts the grace
  again (a later read, or a waiting call, ends it). A wait that ends with `LINK_EXPIRED`
  is confirmed by one read, so an SDK that ends its wait at the deadline cannot report a lapsed
  link as expired. A runtime without link timing keeps the earlier rule.
- Tool schemas `sess-mcp-tools/4`: Sess's length limits for what a person reads, in Unicode code
  points (title 80, description 280, heading 60, field and option labels 60, field description
  160, button label 24, record caption 200, record key 40 and string value 200, text 4,000; at
  most 5 buttons), with Sess's own wording (SURFACE_TEXT_DOCS) and error sentences. Every
  such field carries a one-line purpose and style, `maxLength` and `examples` within the limit;
  `sess_ask`'s description carries one complete good call. Lengths were counted in UTF-16 units
  before; they are now code points, as Sess counts them.
- A value over its limit is refused before anything is sent or saved, never truncated, with
  `INVALID_ARGUMENTS` plus `field` (a JSON pointer into the arguments), `limit` and `length`, and a
  message ending in the fix. A Sess length refusal on create returns the same fields when the SDK
  reports them.
- `server.json` names `package.json`'s exact version and stays in step with it on every release
  candidate; the listing check, a test and the release guard fail when they differ.
- `compatibility.json` records the publication of `0.1.0-rc.2` on the npm dist-tag `next`
  (2026-10-19): registry SHA-256 and integrity, SLSA provenance and release run 39189334311.

## 0.1.0-rc.2 (published 2026-10-19)

- Tool schemas `sess-mcp-tools/3`. Advanced: `sess_request` and `sess_ask` take an optional
  `expires_in` (whole seconds from creation, from 30 up to the plan's link lifetime; the same name
  and range as the Sess API). Their result carries `expiresAt`, when the link stops taking answers.
- `sess_response` reports the final state `expired` when the link closed with no answer for the
  revision: from the SDK wait's `LINK_EXPIRED`, or from a read made two seconds past the expiry. An
  answer accepted before the expiry is still released as `answered`. Nothing is completed or
  written on Sess; the local record is kept as blocked with reason `LINK_EXPIRED` (the record
  schema is unchanged).
- Depends on `@sess.si/sdk` 0.1.0-rc.7 (was 0.1.0-rc.5), for the wait's `LINK_EXPIRED`.
- README "First interaction" now shows approving before acting: the agent asks you, on any device,
  to approve a commit (or a reply) before it acts, with the proposed message in a field you can
  edit, and continues only on the verified answer. It includes a synthetic, labelled sample
  interaction.
- README, package description and generated listing artifacts say "Sess" in prose and "Sess
  link"; package keywords and the Sess homepage.
- MCP Registry: `server.json` names the stable `0.1.0` release (not this candidate), and the
  official validator runs in CI. Nothing is submitted.
- `compatibility.json` records the publication of `0.1.0-rc.1` on the npm dist-tag `next`
  (2026-10-17): registry SHA-256 and integrity, SLSA provenance and release run 38990432638.

## 0.1.0-rc.1 (published 2026-10-17)

- First candidate of the local stdio MCP server for SESS.
- Four tools with closed, versioned schemas (`sess-mcp-tools/1`): `sess_request`, `sess_response`,
  `sess_publish`, `sess_complete`.
- `sess_request` returns the private human link and an opaque handle before any wait.
- `sess_response` performs one bounded wait (default and maximum 45 s), honours MCP request
  cancellation and returns `answered` only after full SESS receipt verification.
- Owner-private single-profile boundary: handles are bound to profile, API origin and a local
  credential-generation digest; the API key is never stored.
- Durable per-handle records (write-temp, fsync, rename, directory fsync).
- Depends on the pinned `@sess.si/sdk@0.1.0-rc.5` (published on npm, dist-tag `next`),
  `@modelcontextprotocol/server@2.3.1` and `@modelcontextprotocol/node@2.1.1`.
- Local records use format version 2. A confirmed publish/complete is remembered per answer
  event with its expected revision and publish body digest; only an identical replay is answered
  from it. Records of another format version stop before any request.
- Blocking is compare-and-apply; deterministic mutation rejections block with a stable code;
  a save failure after a confirmed create is `CREATED_NOT_SAVED` (do not repeat).
- A receipt-key fetch failure (`KEY_RESOLUTION_FAILED`, `KEY_FETCH_COOLDOWN`) is now a retryable
  `SESS_UNAVAILABLE` that records nothing and leaves the state unchanged; a later
  `sess_response` re-reads and fully verifies the answer. Only genuine verification failures
  block. Previously a one-off key-endpoint 5xx or timeout permanently blocked a valid answer.
- A save failure after an unknown create outcome is reported as non-retryable
  `CREATE_OUTCOME_UNKNOWN` instead of a retryable store error.
- Converged with the shared adapter contract: vendored `src/internal/shared.ts` (byte-identical
  to `adapters/shared/core.ts`) supplies canonical JSON, body digests and verification
  classification. `VERIFICATION_CONTEXT_MISSING` is now a non-retryable `NOT_CONFIGURED` naming
  `SESS_EXPECTED_WORKSPACE_ID` instead of a permanent block; it records nothing.
- `sess_response` while a publish or complete is pending returns `MUTATION_PENDING`, telling the
  caller to repeat the pending call, instead of the cached answer.
- `SESSION_COMPLETED` on complete is confirmed only when the Session completed at the expected
  revision; a confirmed complete must also report that revision. Otherwise the record blocks.
- Removed an unreachable branch: SDK `rejected` outcomes are always definitive and block.
- README documents the error-code → class mapping and the receipt-key rotation window.
- Re-vendored the hardened shared core (rejects sparse arrays, non-plain objects and cycles; all
  digested bodies are validated plain JSON or `JSON.parse` output).
- SDK `protocol`/`configuration` errors during read, wait or verification are non-retryable
  (`SESS_PROTOCOL_ERROR`/`NOT_CONFIGURED`) with no state change; `not_sent` with kind
  `configuration` on a saved publish/complete blocks; a failed `SESSION_COMPLETED` read-back keeps
  the completion pending and retryable.
- Packed check scans multi-line, side-effect and dynamic imports and rejects `require()`.
- R-01: an answer is released only after an authenticated current-revision read made after full
  receipt verification, including cached `answered` results. A failed read is retryable
  `SESS_UNAVAILABLE` with no change; progress blocks (or conflicts with a concurrent local change);
  no answer data is released in either case. Previously a revision check before verification, or
  a cached answer with no fresh read, could release an obsolete answer as current.
- `sess_ask` (tool schema `sess-mcp-tools/2`): a question plus up to 12 simple fields, expanded
  into an ordinary interaction and run through the same request operation; returns the link and
  handle at once, never waits. The four operations are unchanged.
- Node floor: qualified on Node 22.14.0 and 24.21.0; `engines` is now `>=22.14.0 <25`. CI adds a
  Node 22.14.0 job and uses the documented `npm run setup` path from a clean clone.
- Maintainer setup: `npm run setup` (SDK root build, digest-gated candidate, `npm ci`), and
  `npm run sdk:switch-to-registry [-- --apply]` for the genuine registry transition.
- README documents the tested Claude Code configurations (environment-inherited key, or `-e` after
  the server name, which Claude Code stores in plain text) and marks untested forms.
- R-01 follow-ups: `#settled` can no longer release a cached answer (every caller goes through the
  no-cached-answer path; cached data is released only after a fresh read); a cached answer with a
  revision mismatch is a conflict with zero SDK calls (tested); README notes that SDK-rejected
  decodes are `SESS_PROTOCOL_ERROR` (fail closed, no state change).
- Release preparation (nothing published): `.github/workflows/mcp-release.yml` for tags `mcp-v*`
  with guards in `scripts/release-guard.mjs` (tag = version, package identity and path, registry
  SDK only, master ancestry, clean tree, exact tested bytes, rc on `next`, registry readback with
  provenance) and a local self-test (`npm run release:self-test`, also part of `npm run check`).
  `npm run setup` skips the candidate in registry mode. `RELEASING.md` lists the owner actions.
- MCP registry metadata `server.json` (schema 2025-12-11) and `package.json` `mcpName`
  (`io.github.w1991e/sess`); not submitted.
- Packed check normalizes paths before the module-source allowance; README mentions `sess_ask` as
  the other source of the human link. Evidence refreshed against Claude Code 2.1.299 (five tools)
  and the runtime at sess 405418a.
- Release follow-ups: the release guard validates the artifact filename and path (exactly
  `.artifacts/sess.si-mcp-<version>.tgz`) before reading it; self-test negatives for bad
  filenames/paths and a wrong repository directory on readback. `server.json` declares every owner
  setting (adds `SESS_EXPECTED_WORKSPACE_ID`, `SESS_RECEIPT_ISSUER`, `SESS_MCP_MAX_WAIT_MS`).
  The release-hold wording matches the lock-switch procedure. `RELEASING.md` warns not to push an
  `mcp-v*` tag before the protected environment and trusted publisher exist.
- SDK dependency follows the repository's single pin (`release/sdk-candidate.json`), now
  `@sess.si/sdk@0.1.0-rc.4`; the candidate is packed from the repository root and accepted only with
  the pinned digests. MCP registry namespace `io.github.w1991e/sess` is owner-approved.
- The SDK dependency now installs from the npm registry: `@sess.si/sdk@0.1.0-rc.4` is published
  (dist-tag `next`, with provenance) with exactly the pinned bytes, and `package-lock.json` was
  switched with `npm run sdk:switch-to-registry -- --apply`. `npm run setup` is a plain registry
  `npm ci` and refuses candidate mode; `npm run check` starts with `npm run sdk:verify`, which
  requires the registry lock and install record and re-reads the registry tarball to compare both
  digests with the pin. CI no longer packs the repository root. The digest-gated candidate path
  remains only for a future unpublished pin. `@sess.si/mcp` itself is still unpublished.
- MCP library moved from `@modelcontextprotocol/sdk@1.32.1` (MIT) to the v2 packages
  `@modelcontextprotocol/server@2.3.1` and `@modelcontextprotocol/node@2.1.1` (Apache-2.0, exact
  pins; NOTICE updated). stdio is unchanged on the wire: the same five tools and
  `sess-mcp-tools/2` schemas, instructions, tool errors, unsafe-key and unknown-property
  rejections and the unknown-tool error are byte-identical, still negotiated up to `2025-11-25`.
  One SDK-level difference: a `tools/call` whose `arguments` is not an object is now `-32602`
  (was `-32603`). The 1.x library remains a devDependency for the legacy-client tests only.
- Operations/store seam: `HandleStore` is an interface injected through an explicit operation
  context (SESS client, store, wait bound). The local stdio composition keeps the environment
  credential and the per-profile file store (`ProfileHandleStore`, record format 2 unchanged).
  Hosted records bind to a `GrantBinding` (origin, workspace, principal, client, grant and grant
  generation); every loaded record is re-checked against the call's authority.
- `@sess.si/mcp/http`: `createSessMcpHttpHandler`, a stateless Streamable HTTP composition on
  `createMcpHandler` with its default stateless legacy fallback (2026-07-28 and 2025-era clients
  on one endpoint). Host/Origin validation, a required `authenticate` hook with RFC 6750
  challenges, a bounded body, the raw-body unsafe-key guard answered in the request's era, and a
  per-request deadline. Library only: no bin flag, OAuth server, hosted store or deployment.
  The package now ships type declarations.
- HTTP-01 (review of the HTTP composition): Host, Origin and `authenticate` now run on the
  headers before any body byte is read, on the Node face as well as the fetch face (the Node face
  no longer lets the SDK adapter buffer the body first), and `authenticate` runs exactly once per
  request. The request deadline starts at entry and bounds `authenticate` (`503`) and body
  ingestion (`408`; the Node face closes the connection); its timer is cleared on completion,
  error and disconnect. Tool-execution deadline semantics are unchanged.
- HTTP-01a: a peer disconnect (fetch `request.signal`, or a Node response closed before it
  finished, including a request already gone on entry) now cancels the request deadline instead of
  only clearing its timer, so a pending `authenticate` or body read settles at once and the
  handler promise resolves; a request already gone on entry never calls the hook. Normal
  completion still only clears the timer. Mutations already sent are never abandoned.
- Q-2 annotation audit: `sess_complete` now has `destructiveHint: true` (completion is terminal and
  never reopens; nothing is deleted on SESS). The other hints were already accurate. Input and
  output schemas and `sess-mcp-tools/2` are unchanged.
- `listing.json` is the single source for the listing artifacts, generated by `npm run listing`:
  `server.json` (now with the remote `https://mcp.sess.si/mcp` entry, not yet deployed), an Agent
  Plugins bundle for OpenAI and Cursor (`listings/plugin/`), Cursor install links and the values
  for Anthropic's connector form. Tool names, titles and annotations come from `src/tools.ts`.
  `npm run check` validates them against vendored, SHA-256-pinned schemas and documented rules and
  rejects stale files, forbidden words and overclaims. Nothing is submitted; see `LISTINGS.md`.
- Release preparation for `mcp-v0.1.0-rc.1`: the publication path is a stage-only npm trusted
  publisher. The release workflow stages the tested tarball on the dist-tag `next` (every `-rc.N`;
  never `latest`), and nothing is installable until a maintainer approves the staged version with
  npm 2FA. The `0.0.0-stage` placeholder is deprecated with a pointer to `@next` before the first
  release. Preparing the candidate publishes nothing.
- Person-facing text says "Sess": README prose, the package description, tool titles, the
  server instructions and tool messages, and the generated listing artifacts. Environment
  variables, error codes and tool names are unchanged. The README no longer says the browser may
  need a manual refresh between rounds.
