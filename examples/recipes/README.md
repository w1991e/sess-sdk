# Provider recipes

These recipes are the weekend planner, driven by a model through that provider's own tool calling. Each one asks a person two questions on one private Sess link and returns their plan.

The default starter (`npm create @sess.si/agent@next`) uses no model and needs only a Sess key. Start there. These recipes are for when you want a model in the loop.

Each recipe needs **two keys**: a Sess API key (`SESS_API_KEY`) and the provider's key. It also needs `SESS_DEMO_CONTACT`, a project URL or team email, because the weather services ask for one.

| Recipe                             | Provider surface                           | Key variable         |
| ---------------------------------- | ------------------------------------------ | -------------------- |
| [openai](openai/README.md)         | Responses API, function tools              | `OPENAI_API_KEY`     |
| [anthropic](anthropic/README.md)   | Messages API, tool use                     | `ANTHROPIC_API_KEY`  |
| [gemini](gemini/README.md)         | Gemini API, function calling               | `GEMINI_API_KEY`     |
| [xai](xai/README.md)               | Responses-compatible API, function calling | `XAI_API_KEY`        |
| [meta](meta/README.md)             | Meta Model API, Responses API tool calling | `META_API_KEY`       |
| [openrouter](openrouter/README.md) | OpenAI-compatible chat completions, tools  | `OPENROUTER_API_KEY` |

Run a recipe from a checkout of this repository. The recipes share the starter's weather helper, `create-agent/template/weather.mjs`.

```sh
cd examples/recipes && npm install --ignore-scripts
node openai/agent.mjs
```

The private link prints in your terminal. Open it on your phone and answer there. The link is never sent to the model provider.

## How they are built

- [workflow.mjs](workflow.mjs) is the job, written as five local tools:
  - `sess_ask`, `sess_response`, `sess_publish` and `sess_complete`, on `@sess.si/sdk@0.1.0-rc.8`;
  - `get_weather`: MET Norway, plus NWS alerts in the US, cached and with an identifying User-Agent.
- Each `agent.mjs` declares those tools in its provider's own format and runs its provider's own loop. Tool-call ids and reasoning context are kept exactly as that provider requires. There is no shared translation layer.
- The three plans come from the starter's fixed rule. The model writes the intros and the final sentence.
- [bounds.mjs](bounds.mjs) bounds every run on the client, whatever the provider's own spend controls are (the Meta Model API has no hard cap):
  - at most 10 model calls and 12 HTTP requests per run, every retry included;
  - 2,000 output tokens per request;
  - 80,000 input and 20,000 output tokens per run. Every attempt counts toward these caps, retried and failed ones too. An attempt whose usage the provider did not report counts at its ceiling: its request bytes plus 1,000 for input, and 2,000 for output. A request is sent only if its ceiling still fits the caps;
  - a 60 s timeout per request, and 2 retries on 429, 5xx or a network failure only, after 1 s and then 4 s;
  - 20 minutes in all.
- [models.json](models.json) holds each provider's default model and rates: the cheapest current model with tool calling, with the exceptions explained in its notes. The rates are dated, with source URLs:

  | Provider   | Default model                                                                                                     | USD per 1M tokens, input / output | Most a run can cost |
  | ---------- | ----------------------------------------------------------------------------------------------------------------- | --------------------------------- | ------------------- |
  | OpenAI     | `gpt-5.4-nano`; if the key is not offered it, `gpt-4.1-mini`                                                      | 0.20 / 1.25 (0.40 / 1.60)         | US$0.041 (US$0.064) |
  | Anthropic  | `claude-haiku-5-5`                                                                                                | 0.10 / 0.50                       | US$0.018            |
  | Gemini     | `gemini-3.8-flash` (the current Flash, founder 2026-10-19); if the key is not offered it, `gemini-3.5-flash-lite` | 0.75 / 3.75 (0.30 / 2.50)         | US$0.135 (US$0.074) |
  | xAI        | `grok-4.3`                                                                                                        | 1.25 / 2.50                       | US$0.150            |
  | Meta       | `muse-spark-1.3`, Standard mode                                                                                   | 1.25 / 4.25                       | US$0.185            |
  | OpenRouter | `anthropic/claude-haiku-5.5`                                                                                      | 0.10 / 0.50                       | US$0.018            |

  "Most a run can cost" is the run's token caps at these rates.

## Qualification runs

```sh
./with-keychain.sh openai -- node qualify.mjs openai --scenario happy_path
```

- **Keys.** [with-keychain.sh](with-keychain.sh) reads the keys from the macOS login Keychain into the child's environment only. If an item is missing, it stops and runs nothing.

  | Key                           | Keychain item                                         |
  | ----------------------------- | ----------------------------------------------------- |
  | Sess                          | `sess-qual-sess-api-key`                              |
  | OpenAI                        | `sess-test-openai-api-key` (the existing project key) |
  | Anthropic                     | `sess-test-anthropic-api-key` (the existing API key)  |
  | Gemini, xAI, Meta, OpenRouter | `sess-qual-<provider>-key`                            |

- **Spend guard.** `qualify.mjs` keeps a local ledger, `qualification/spend-ledger.json`.
  - Before a run, it reserves the run's maximum possible cost. That is the token caps at the dated rates, retries included, and for OpenAI the dearer of the default and its fallback. It refuses the run unless that amount fits both the **US$100 ceiling** and the lower operating target **`RECIPE_BUDGET_USD`** (default 15, never above 100).
  - After the run, it settles the reservation at the **estimate**: the usage the provider reported × the rates, plus every attempt that reported no usage at its ceiling. Ledger entries written before this split carry only `cost_usd`; they still count, at that cost, and new entries keep `cost_usd` as an alias of the estimate so earlier runners can still read the ledger.
  - A run that crashed keeps its reservation at the maximum.
  - The budget check and the reservation happen in one step, and so does each settlement. Each step holds `qualification/spend-ledger.lock`, which is created exclusively, and reloads the latest ledger. It changes only its own entry, then renames the new file into place. Two processes therefore never lose each other's entries.
  - Only one qualification run can happen at a time. A run holds `qualification/run.lock` from admission until settlement, and a second run started meanwhile is refused. Each lock holds a unique owner token, written whole to a private temporary file and then hard-linked into place, so the lock never exists without its token. If the process holding a lock has exited, the next run breaks it only while holding a separate `<lock>.break` file, and only if the lock still holds the very token it found stale; a replacement lock is never removed, and a release removes only its own token. An empty or unreadable lock, or a `.break` left by an exited process, stops the run and names the file to remove by hand.
  - It prints the budget left before and after each run.
  - A run with no rates in `models.json` or `RECIPE_RATES` is refused.
- **Records.** Each run writes `qualification/<provider>-<time>.json` (schema `sess.recipe-qualification/3`; version 3 split `cost_usd` into the fields below). It holds:
  - the provider, the model requested, and the model id or ids the API returned;
  - the resolved `@sess.si/sdk` version (null if it is not installed), the recipe's git SHA with a dirty flag (read on a branch or a detached HEAD alike; a real run whose SHA cannot be determined is refused), the runner version and the UTC time;
  - the scenario and outcome, the usage (reported and charged at ceiling), calls, requests and retries, the maximum cost, and the rates with their source and date;
  - **three spend figures** (founder, 2026-10-19):
    - the **estimate**, `usage_cost_usd`: reported usage × rates. It is null, printed as unknown, if no attempt reported usage.
    - the **conservative reservation**, `booked_usd`: `estimated_total_usd` (`usage_cost_usd` plus `ceiling_reserved_usd`, the attempts charged at their ceiling). This is the figure the cap and the ledger count, beside the run's `max_cost_usd` reserved before it.
    - the **provider-reported charge**, `billed_usd`, with `billed_source` and `billed_reconciliation`. No provider gives an ordinary key a charge attributable to one run. So `billed_usd` is null, printed as "unknown", never zero:
      - for OpenAI, Anthropic, Gemini, xAI and Meta, `billed_source` is "not available with this key (provider console)". xAI's billing needs a separate Management API key.
      - OpenRouter's `GET /api/v1/key` usage is a cumulative key counter. Delayed accounting, a decrease or other use of the key all move it, so its change during the run is kept as `key_usage_delta_usd`, a diagnostic only (unclamped), with `billed_reconciliation: unreconciled_key_counter_only`.

    The runner prints the three figures on separate lines (plus the key-counter diagnostic where there is one) and never prints a key.

  - **`proved`**, only the checks the tools observed, and **`not_proved`**, all the others. The checks are: tool call issued, Sess link created before the wait, answer received, receipt verified, continuation after the first answer, live weather used, second round published, second answer on the same link, second receipt verified, Session completed, final answer returned, wait resumed after a timeout, and correction applied.

  A record holds no key, no private link and no answers. The ledger and the records are both **gitignored** here. Commit a record as evidence elsewhere, deliberately.

- **The person.** The person answers on the link themselves. The runner never answers for them.
- **Scenarios.**
  - `happy_path`.
  - `correction`: change the plan's time in question 2.
  - `timeout_resume`: wait more than three minutes before answering, so the model resumes with `sess_response`.

To use another model, set `RECIPE_MODEL`. If it is not in `models.json`, also set `RECIPE_RATES=<input>,<output>` (USD per 1M tokens). The rates in `models.json` were read on 2026-10-18; confirm them before a paid run.

- **Retries after a lost reply.** Publishing question 2 and completing the Session each fix their whole request, meaning the body, `If-Match` and idempotency key, before the first send. If the reply is lost and the model calls the tool again, exactly that request is sent again, even if the model gives a different intro. After the first attempt the forecast can't change either. A create is never repeated.

## Free pre-flight: dry run

```sh
cd examples/recipes && npm install --ignore-scripts   # the published @sess.si/sdk@0.1.0-rc.8
node qualify.mjs --dry-run gemini                     # or any provider; --scenario happy_path|correction
```

A dry run uses the same scenario, limits, budget accounting and record as a real run, through the published SDK client. Everything outside the process is simulated:

- the model: a scripted reply in that provider's wire format;
- the Sess API: a synthetic server that signs receipts, checks `If-Match` and replays idempotent requests;
- the person: one simulated answer per question;
- the weather.

Nothing is sent and nothing is billed. The dry run sees only placeholder keys. It writes its own ledger and records to `qualification/dry-run/`, kept apart from the real ones. Its record says `dry_run: true` and lists what was simulated. It also keeps `proved` empty: what it observed goes in `proved_in_simulation`, where the fixed forecast appears as `weather_used (simulated)`, so it is never mistaken for a provider qualification.

The mocked tests, from a checkout of this repository:

```sh
npm ci --ignore-scripts && npm run build && npx vitest run tests/recipes
```

## Weekly cheapest-model check (after launch; prepared, not scheduled)

```sh
./with-keychain.sh all -- node qualify.mjs --weekly
```

- It runs the happy path once per provider, on that provider's cheapest listed model, one after another. The runs use the same per-run limits and the same spend guard, retries included.
- A provider without a key is skipped, and the check stops at the first budget refusal.
- Every run still needs a person to answer its link.
- At the rates above, one weekly round can cost at most about US$0.46.
- Nothing schedules it. Scheduling is a separate founder decision.
