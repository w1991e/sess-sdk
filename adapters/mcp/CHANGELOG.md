# Changelog

## 0.1.0-rc.1 (candidate, unpublished)

- First candidate of the local stdio MCP server for SESS.
- Four tools with closed, versioned schemas (`sess-mcp-tools/1`): `sess_request`, `sess_response`,
  `sess_publish`, `sess_complete`.
- `sess_request` returns the private human link and an opaque handle before any wait.
- `sess_response` performs one bounded wait (default and maximum 45 s), honours MCP request
  cancellation and returns `answered` only after full SESS receipt verification.
- Owner-private single-profile boundary: handles are bound to profile, API origin and a local
  credential-generation digest; the API key is never stored.
- Durable per-handle records (write-temp, fsync, rename, directory fsync).
- Depends on `@sess.si/sdk@0.1.0-rc.3` (unpublished candidate) and `@modelcontextprotocol/sdk@1.32.1`.
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
- `sess_ask` (tool schema `sess-mcp-tools/2`): a question plus up to 12 simple fields, expanded
  into an ordinary interaction and run through the same request operation; returns the link and
  handle at once, never waits. The four operations are unchanged.
- Node floor: qualified on Node 22.14.0 and 24.21.0; `engines` is now `>=22.14.0 <25`. CI adds a
  Node 22.14.0 job and uses the documented `npm run setup` path from a clean clone.
- Maintainer setup: `npm run setup` (SDK root build, digest-gated candidate, `npm ci`), and
  `npm run sdk:switch-to-registry [-- --apply]` for the genuine registry transition.
- README documents the tested Claude Code configurations (environment-inherited key, or `-e` after
  the server name, which Claude Code stores in plain text) and marks untested forms.
