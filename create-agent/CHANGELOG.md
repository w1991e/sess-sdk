# Changelog

## Unreleased

Prepared, not released; the version is not yet chosen.

- Sess's 2026-11-07 Surface text limits (an option label is at most 30, was 60). **Proposed copy
  change, for the founder's look:** question 2's plan options read the idea alone, such as
  "A picnic in the park" (they read "A picnic in the park — Afternoon, 12:00–17:00"), and each
  plan's time is in a new record, "Suggested times", before the choice, as on Sess's own demo.
  The template README states the new limits: title 60, button 16, field label 40, choice 30,
  help 120.

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
