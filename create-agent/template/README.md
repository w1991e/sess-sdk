# Your first Sess agent

This agent asks you two questions on your phone and plans your weekend on the real forecast, with a
signed receipt for each answer.

**Install:** `npm install --ignore-scripts`

**Run** (with `SESS_API_KEY` and `SESS_DEMO_CONTACT` set in your environment): `npm start`

**What you'll see:** a Sess link to open on your phone; answer its two questions and your plan
prints here, ending with `verified ✓`.

## Details

### Settings

| Variable            | What it is                                                                                                            |
| ------------------- | --------------------------------------------------------------------------------------------------------------------- |
| `SESS_API_KEY`      | Your Sess API key, from [app.sess.si](https://app.sess.si). Keep it on your machine or server.                        |
| `SESS_DEMO_CONTACT` | A project URL or team email. It goes in the `User-Agent` the weather services ask for. Do not use a personal address. |

Set the key without echoing it or saving it in your shell history:

```sh
read -rs SESS_API_KEY && export SESS_API_KEY   # run this line by itself, then paste your key from https://app.sess.si

export SESS_DEMO_CONTACT=https://example.com/your-project
```

The agent reads both from its environment only. It never asks for them and never writes them to
disk. [.env.example](.env.example) lists them; the agent does not read that file.

### What the agent does

The flow is in [agent.mjs](agent.mjs); the weather, the plan rule and their attribution are in
[weather.mjs](weather.mjs).

1. Creates a Sess Session asking where (a city from a short list) and which day (Saturday or Sunday).
2. Prints the Sess link. Anyone holding it can answer, so keep it to yourself.
3. Waits for your answer and verifies its signed receipt.
4. Reads the forecast for that city from MET Norway and, for US cities, active alerts from the US
   National Weather Service.
5. Publishes question 2 on the same link: three plans that fit the forecast. Pick one, or change its
   time. The plans come from a fixed rule, not an AI model. Nothing is booked.
6. Verifies that answer, completes the Session and prints your plan and the receipt summary.

### Change a question

Each question is a `form(...)` in [agent.mjs](agent.mjs): a title, a line under it, its fields and
one button. Keep what the person reads short; Sess never cuts it:

- the title: a question or a task, about 40 characters (at most 80);
- the button: a verb, 1–3 words (at most 24);
- field labels and choices: short (at most 60);
- help under a field: one hint (at most 160).

Sess refuses anything longer and creates nothing; shorten it and run again.

### Weather data

Forecasts come from [MET Norway](https://api.met.no) under
[CC BY 4.0](https://creativecommons.org/licenses/by/4.0/). The agent summarizes them into time
slots and shows that attribution with every forecast. US alerts come from
[api.weather.gov](https://www.weather.gov/documentation/services-web-api).

The agent follows the services' terms. It sends an identifying `User-Agent` with your contact,
truncates coordinates to 4 decimals, caches each answer in `.weather-cache.json` until it expires
and then revalidates it, and retries at most 3 times, waiting when asked to slow down. If a service
cannot be reached, the agent says so and plans without a forecast. It never makes up weather.

### Receipts

Each answer comes with a receipt signed by Sess. The agent checks it with
[`@sess.si/sdk`](https://www.npmjs.com/package/@sess.si/sdk) before it continues. To learn how to
check a receipt yourself, visit [sess.si/verify](https://sess.si/verify).

### Requirements

Node.js 22.14 or later. `@sess.si/sdk` is pinned to an exact version in [package.json](package.json).

[Apache-2.0](LICENSE)
