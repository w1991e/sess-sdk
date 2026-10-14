# Changelog

## 0.1.0-rc.1 (unreleased)

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
- Qualified against OpenClaw 2026.10.3 on Node 24 with the candidate `@sess.si/sdk@0.1.0-rc.3`.
  Release hold: the SDK must be published before this package can be.
