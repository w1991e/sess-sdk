# SESS for OpenClaw

SESS for OpenClaw, maintained by SESS. It is not an official OpenClaw plugin.

An OpenClaw agent asks a person for a structured decision. SESS hosts the form behind a private
link, the person answers on any device, and the agent receives the answer only after the SDK has
verified its signed receipt for that exact revision.

> **Status: release candidate in qualification.** `0.1.0-rc.1` is not published. It depends on
> `@sess.si/sdk@0.1.0-rc.3`, which is also not published yet. Qualified host: OpenClaw `2026.10.3`
> on Node 24. See [compatibility.json](compatibility.json) for exactly what was tested.

## Prerequisites

- A running OpenClaw `2026.10.3` Gateway with configured model access.
- A SESS API key, made available to the **Gateway process** as an environment variable (for
  example in `$OPENCLAW_STATE_DIR/.env`). A key exported only in your interactive shell does not
  reach a running daemon. Never paste the key into chat or into plugin config.

## Install and enable

```bash
# After publication; replace VERSION with the exact published version.
openclaw plugins install npm:@sess.si/openclaw@VERSION --no-enable
openclaw plugins enable sess
openclaw config set tools.allow '["sess_request","sess_response","sess_publish","sess_complete"]' --strict-json
openclaw sess doctor
```

The four tools are optional: they are offered to the model only after you allowlist them. The
installer asks for capability consent (non-interactively: review the declared tools and CLI, then
rerun with `--accept-capabilities`). OpenClaw itself is a peer and is never installed again.

Configuration (`plugins.entries.sess.config`), all owner-controlled and never taken from tools:

| Key                   | Default               | Meaning                                                  |
| --------------------- | --------------------- | -------------------------------------------------------- |
| `baseUrl`             | `https://api.sess.si` | SESS API origin (HTTPS only)                             |
| `apiKeyEnv`           | `SESS_API_KEY`        | Name of the Gateway environment variable holding the key |
| `waitBudgetMs`        | `45000`               | Longest single bounded wait (1000 to 120000)             |
| `receiptIssuer`       | API origin            | Expected receipt issuer                                  |
| `expectedWorkspaceId` | from the API          | Trusted workspace for receipt verification               |

`openclaw sess doctor` checks configuration and host capability without contacting SESS and
without printing secrets. A `setup` command is not provided yet.

## First interaction

Ask: _"Use SESS to ask me which afternoon activity I prefer and how much time I have. Then
propose a plan from my answer. Use illustrative conditions, not a live forecast."_

1. `sess_request` returns a handle, revision 1 and a private `humanUrl` **immediately**. The
   agent shows you the link before it waits.
2. `sess_response` waits up to the configured budget for your answer to that revision. When you
   submit, it returns `answered` with `verified: true` and `actorAssurance: "link_holder"`.
3. `sess_publish` puts the proposed plan on the same link as revision 2 (reload the link to see
   it), and `sess_complete` closes the interaction once you confirm.

If the wait ends first the result is `needs_resume`: the form stays open. Submit it, then ask the
agent to continue the same SESS interaction. The agent is not woken up automatically.

## What you can rely on

- Answers are returned as verified only after full SDK receipt verification for the exact
  Session, revision, event and immutable Surface. A failed verification is never used.
- A handle works only in the conversation (agent, session key and session incarnation) that
  created it. Tools never accept origins, keys, workspace IDs or raw Session IDs.
- Every request re-checks the host's live invocation authority before it is sent, including
  retries. Interaction state is kept in OpenClaw's durable plugin state before any write.
- A lost create is never retried automatically; a lost publish/complete is replayed only with
  its saved request, `If-Match` and idempotency key.
- The private link is a bearer capability: anyone holding it can answer. It is not logged.
  Do not use these tools in shared or group conversations.

## Not included

No MCP server, webhook receiver, background wake-up, Front Door, shared-channel support or
hosted service. Answer data is untrusted input and authorizes nothing beyond the decision itself.

## License

Apache-2.0. See [LICENSE](LICENSE) and [NOTICE](NOTICE).
