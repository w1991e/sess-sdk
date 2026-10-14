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
openclaw sess doctor
```

Then add `sess_request`, `sess_response`, `sess_publish` and `sess_complete` to `tools.alsoAllow`
in your Gateway config. `alsoAllow` adds tools on top of the active tool profile; keep any entries
you already have (check with `openclaw config get tools.alsoAllow`). Do not replace
`tools.allow`: that switches the Gateway to a restrictive allowlist of only these tools.

The four tools are optional: they are offered to the model only after you allow them. The
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

**Qualification status.** The tested profile is deterministic tool invocation through the
Gateway's `POST /tools/invoke` endpoint ("return-link-first"): `sess_request` returns the link,
and a separate `sess_response` call waits. Use from a model-driven agent turn (Control UI or a
chat channel) is **not yet qualified**: it has not been shown that the person sees the link while
the same turn is still waiting. The flow below describes the intended agent behavior.

Ask: _"Use SESS to ask me which afternoon activity I prefer and how much time I have. Then
propose a plan from my answer. Use illustrative conditions, not a live forecast."_

1. `sess_request` returns a handle, revision 1 and a private `humanUrl` **immediately**. The
   agent presents the link. It should start a bounded wait only when the link has visibly
   reached you; otherwise it ends its turn and you ask it to continue after submitting.
2. `sess_response` reads, or waits up to the configured budget for, your answer to that
   revision. Once you have submitted, it returns `answered` with `verified: true` and
   `actorAssurance: "link_holder"`.
3. `sess_publish` puts the proposed plan on the same link as revision 2 (reload the link to see
   it), and `sess_complete` closes the interaction once you confirm.

If the wait ends first the result is `needs_resume`: the form stays open. Submit it, then ask the
agent to continue the same SESS interaction. The agent is not woken up automatically.

## What you can rely on

- Answers are returned as verified only after full SDK receipt verification for the exact
  Session, revision, event and immutable Surface. A failed verification is never used.
- A handle works only in the conversation that created it: the host-provided agent, session key
  and session ID must all match. Tools never accept origins, keys, workspace IDs or raw Session
  IDs. Rejection after a session reset (OC-18) is **not yet qualified** on OpenClaw 2026.10.3:
  a reset of a session without a transcript kept its session ID in testing, so the old handle
  stayed usable in that conversation.
- Every request re-checks the host's live invocation authority before it is sent, including
  retries. Interaction state is kept in OpenClaw's durable plugin state before any write.
- A lost create is never retried automatically; a lost publish/complete is replayed only with
  its saved request, `If-Match` and idempotency key.
- The private link is a bearer capability: anyone holding it can answer. It is not logged.
  Do not use these tools in shared or group conversations.

## Errors

Failures use OpenClaw's tool-error contract. Each message starts with a code; the code maps to
one class of the shared adapter contract:

| Code                       | Class                 | Meaning                                                                |
| -------------------------- | --------------------- | ---------------------------------------------------------------------- |
| `INVALID_ARGUMENTS`        | `invalid_arguments`   | Arguments failed validation; nothing was sent                          |
| `NOT_FOUND`                | `not_found`           | No interaction with this handle belongs to this conversation           |
| `STATE_CONFLICT`           | `conflict`            | Wrong revision/answer, a pending or different mutation, or a lost race |
| `CREATE_REJECTED`          | `create_rejected`     | No Session was created; do not retry unchanged                         |
| `CREATE_OUTCOME_UNKNOWN`   | `create_unknown`      | A Session may exist; never created again automatically                 |
| `CREATED_NOT_SAVED`        | `created_not_saved`   | A Session was created but not saved locally; do not repeat the request |
| `MUTATION_OUTCOME_UNKNOWN` | `outcome_unknown`     | Retryable: repeat the same call to replay the saved request            |
| `MUTATION_REJECTED`        | `mutation_rejected`   | SESS rejected the saved publish/complete; the interaction is blocked   |
| `VERIFICATION_FAILED`      | `verification_failed` | The answer failed receipt verification; the interaction is blocked     |
| `RECOVERY_BLOCKED`         | `blocked`             | Needs explicit operator resolution                                     |
| `UNAVAILABLE`              | `unavailable`         | Retryable: SESS or receipt keys unreachable; nothing changed           |
| `CANCELLED`                | `unavailable`         | The local wait was cancelled; nothing was cancelled in SESS            |
| `AUTHORITY_REVOKED`        | `unavailable`         | The host revoked this invocation; see the note below                   |
| `PROTOCOL_ERROR`           | `configuration`       | SESS returned an invalid response; not retryable, nothing changed      |
| `CONFIGURATION`            | `configuration`       | Plugin configuration is invalid or incomplete                          |
| `CREDENTIAL_MISSING`       | `configuration`       | The API key variable is not set in the Gateway process                 |
| `HOST_CAPABILITY_MISSING`  | `configuration`       | The OpenClaw host lacks a required capability                          |
| `HOST_BINDING_UNAVAILABLE` | `configuration`       | No admitted agent conversation identity was supplied                   |
| `STORE_FULL`               | `store`               | The bounded interaction store is full; nothing was dropped             |
| `STORE_UNAVAILABLE`        | `store`               | Durable plugin state failed; nothing further was sent                  |

`AUTHORITY_REVOKED` from `sess_request` after its Session was created and saved means: redeliver
the **original** host call to read the link. Starting a new `sess_request` would create a second
Session. For the other tools, retry in a new admitted call.

## Stored state, capacity and upgrade

Interaction state lives in OpenClaw's plugin state, in three namespaces:

- `active-v2` (bounded, 2,200 entries, never evicting): interactions that can still change and
  their create claims. When it is full, new requests are refused; nothing is dropped.
- `archive-v2` (retained): completed and blocked interactions and their create claims. A claim is
  the replay tombstone of one host tool call and is never deleted, so a late redelivery of that call
  returns its stored result instead of creating another Session. Archived entries do not count
  against active admission.
- `interactions-v1`: the layout of earlier builds. The first tool call after upgrading migrates it
  in place (claims and records keep their generations and exact replay identities; unrecognized
  values are left untouched) and replaces each migrated key with a marker. It then fills the
  remaining legacy capacity with fence rows, so an older plugin version installed afterwards stops
  (`STORE_FULL` / `RECOVERY_BLOCKED`) instead of acting on the new layout.

`openclaw sess doctor` prints redacted counts per namespace and state. `openclaw sess prune` is a
dry run by default; `openclaw sess prune --apply` removes only the retained human link from
completed or blocked records. Claims, identities and every non-terminal record are never changed,
and a redelivered terminal call still reports its terminal result.

## Known limitations (planned for the next increment)

- One outstanding request per conversation is not enforced; each new `sess_request` call may
  create a new Session. Repeated delivery of the same host tool call is deduplicated.
- The retained archive grows with every completed or blocked interaction (claims are replay
  tombstones and are never deleted). `prune --apply` compacts their payload only.
- Uninstall/reinstall effects on stored interactions are not qualified.
- A receipt signed with a key the SDK cannot find (`UNKNOWN_KEY_ID`) fails closed: during a
  signing-key rotation inside the SDK's key-refresh cooldown, a valid answer can block and needs
  operator review.

## Not included

No MCP server, webhook receiver, background wake-up, Front Door, shared-channel support or
hosted service. Answer data is untrusted input and authorizes nothing beyond the decision itself.

## License

Apache-2.0. See [LICENSE](LICENSE) and [NOTICE](NOTICE).
