# Agent-turn qualification run details (2026-10-14)

Maintainer document; not packed. The shipped `compatibility.json` keeps the public facts of this
run (host, versions and integrity, model, date, outcomes, usage and cost). The run details below
were removed from the packed record so the package names no private repository, local machine or
pending owner step (`scripts/check-packed-hygiene.mjs` refuses them).

- Runtime: an isolated local SESS runtime from sess `e63d007485d225e9038b51452b4167de7921e6a0`
  on port 18082, with synthetic keys and a disposable Postgres 16.15.
- Model credential: the API key came from the macOS Keychain and was placed only in the throwaway
  gateway process environment; never printed or persisted.
- Known issue at the time of the run: fixed by sess-sdk #27 (setup preview reads the authored
  config snapshot the apply mutates; asserted by `check-package --host`).
- Provider-reported charges: to be read from the Anthropic console by the owner. The host-reported
  cost ($0.2583051) and the token-based estimate ($0.2583) are in `compatibility.json`.
- The shared adapter contract (`adapters/CONTRACT.md`) converged in sess-sdk PR #10.
