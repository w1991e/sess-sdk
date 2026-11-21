# Changelog

## 0.3.0

Prepared, not yet published.

- Sess's tighter text limits: title 60, description 200, heading 40, field label 40, field help
  120, option label 30, record key 24, button 16; every other limit is unchanged. Each plan is
  now "idea, part of day", such as `Picnic in the park, afternoon`.
- The agent names itself to Sess as User-Agent `sess-create-agent/0.3.0`.

## 0.2.0 — 2026-11-19

- The agent it writes depends exactly on `@sess.si/sdk` `0.4.0` (0.1.0 wrote `0.1.0`). It
  verifies the receipts Sess issues. The SDK's [changelog](../CHANGELOG.md) lists everything from
  0.1.1 to 0.4.0.
- The agent names itself to Sess as User-Agent `sess-create-agent/0.2.0`.
- Otherwise the same as `0.1.0`: the same files, prompts, link line and next steps.

## 0.1.0 — 2026-11-01

- The first stable release, published to the `latest` dist-tag. Create and run with
  `npm create @sess.si/agent@latest my-agent`; the README, `--help` and the usage line name
  `@latest` (they named `@next`). `next` stays at `0.1.0-rc.6`.
- The agent it writes depends exactly on `@sess.si/sdk` `0.1.0` (rc.6 wrote `0.1.0-rc.8`). From
  the SDK: a key Sess does not accept now stops the agent with "Sess did not accept your API key.
  Check SESS_API_KEY and the portal you made it on." instead of a generic API error. The SDK's
  [changelog](../CHANGELOG.md) lists everything from rc.9 to 0.1.0.
- The agent names itself to Sess as User-Agent `sess-create-agent/0.1.0`.
- Otherwise the same as `0.1.0-rc.6`: the same files, prompts, link line and next steps.

Earlier versions: the release packets in [release/](release/).
