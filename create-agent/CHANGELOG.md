# Changelog

## Unreleased

- The agent it writes depends exactly on `@sess.si/sdk` `0.2.0`.
- It also writes `ask.mjs`: one question for three people through one link. Each person answers
  on their own page, and each answer prints as it comes in, verified by its signed receipt. Run
  `node ask.mjs` with `SESS_API_KEY` set. The README's "Ask a group" section points to it.
- `npm start` and the weekend planner are unchanged.

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
