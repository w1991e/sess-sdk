# Installed-package quickstart (Node)

A runnable program that uses the installed `@sess.si/sdk` package. It creates one interactive
Session, prints its private human link, waits a bounded time for the person's answer, verifies the
decision receipt, validates the business data, and completes the Session. It is plain Node ESM
JavaScript ([index.mjs](index.mjs)); there is no build step. This directory is not part of the
published package.

## Prerequisites

- Node.js 24 or later.
- A SESS API key for the workspace you want to use. Use synthetic data; this example pays and sends
  nothing.

## Install

Copy this directory somewhere outside the SDK repository, then install the SDK into it.

Today (release candidate, not yet published): install the candidate tarball you were given or
built with `npm pack` in the SDK repository. This is a local candidate, not a published release:

```sh
npm install --ignore-scripts /path/to/sess.si-sdk-0.1.0-rc.3.tgz
```

After publication:

```sh
npm install @sess.si/sdk@<version>
```

## Run

Provide the key through the environment, never as a command-line argument:

```sh
export SESS_API_KEY=...   # or load it from your secret manager
npm start
```

Optional environment:

| Variable                        | Meaning                                                                        |
| ------------------------------- | ------------------------------------------------------------------------------ |
| `SESS_API_URL`                  | Non-default API origin. HTTPS only.                                            |
| `SESS_ALLOW_INSECURE_LOCALHOST` | `1` permits `http://localhost` for local runtime tests only.                   |
| `SESS_EXPECTED_WORKSPACE_ID`    | Expected workspace for receipt verification. Normally supplied by the runtime. |
| `SESS_WAIT_SECONDS`             | Total wait, 5 to 900 seconds. Default 180.                                     |
| `SESS_SESSION_ID`               | Resume waiting on an existing Session instead of creating a new one.           |

The program prints the human URL before it starts waiting. That URL is a bearer link: anyone who
holds it can respond, so open it yourself or deliver it privately to the intended person. Do not
paste it into logs, tickets or chat channels.

## What the person sees

A hosted SESS page titled "Confirm a synthetic amount" with a short instruction, a labeled amount
field prefilled with 120, and a "Submit amount" button. After submitting, the page confirms the
response. SESS renders the page; the example sends only typed data.

## What the program prints

- The Session ID and the human URL (once, at creation).
- `Still waiting` and a resume command if the wait ends without a response (exit code 3), or a
  resume command after Ctrl+C (exit code 130). Neither creates another Session; resuming with
  `SESS_SESSION_ID=ses_... npm start` waits on the same Session and revision.
- After the response: its event ID and the verified, validated amount.
- The completed Session status as confirmed by the API.

It never prints the API key or receipt contents. An uncertain create or complete outcome is
reported as uncertain, never as success, and creation is never retried automatically.

## Local smoke (maintainers)

[scripts/smoke.mjs](scripts/smoke.mjs) drives this program against an isolated loopback SESS runtime
with synthetic credentials, submitting the human form with plain HTTP. It is opt-in
(`SESS_QUICKSTART_SMOKE=1`), refuses non-loopback origins and is not run by public CI.
