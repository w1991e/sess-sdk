# Changelog

## 0.1.0-rc.1 (unreleased)

- Native OpenClaw plugin `sess` with four optional tools: `sess_request`, `sess_response`,
  `sess_publish`, `sess_complete` (tool schema version 1, closed schemas).
- Host binding to agent, session key and session incarnation; live invocation guard on every
  dispatch and durable state write.
- Durable interaction records in OpenClaw plugin state (bounded, non-evicting).
- Full SDK receipt verification before an answer is returned as verified.
- `openclaw sess doctor` (no network, no secrets). Bundled `sess` skill.
- Qualified against OpenClaw 2026.10.3 on Node 24 with the candidate `@sess.si/sdk@0.1.0-rc.3`.
  Release hold: the SDK must be published before this package can be.
