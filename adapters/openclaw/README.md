# SESS for OpenClaw

SESS for OpenClaw, maintained by SESS. It is not an official OpenClaw plugin.

An OpenClaw agent asks a person for a structured decision. SESS hosts the form behind a private
link, the person answers on any device, and the agent receives the answer only after the SDK has
verified its signed receipt for that exact revision.

> **Status: release candidate in qualification.** `0.1.0-rc.1` is not published. It depends on
> the pinned `@sess.si/sdk` candidate (exact version in [package.json](package.json)), which is also not
> published yet. Qualified host: OpenClaw `2026.10.3`
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
openclaw sess setup          # preview only: prints exactly what would change
openclaw sess setup --yes    # apply the previewed change
openclaw sess doctor
```

`openclaw sess setup` is additive and consent-driven. Without `--yes` it writes nothing. With
`--yes` it enables the plugin, appends the four tools to `tools.alsoAllow` (keeping every existing
entry) and sets `plugins.entries.sess.config`; all other config, including secret references, is
left unchanged, and a re-run makes no change. It never asks for or stores the API key: put the key
in the Gateway's own environment under the configured variable name (default `SESS_API_KEY`, for
example in `$OPENCLAW_STATE_DIR/.env`). A key exported in a terminal is not inherited by an
already-running Gateway service. Setup never restarts the Gateway; it prints the command
(`openclaw gateway restart`) for you to run when ready. It does not change a restrictive
`tools.allow` or `plugins.allow`; it warns instead. Options: `--base-url`, `--api-key-env`,
`--wait-budget-ms`.

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

`openclaw sess doctor` checks configuration, the host version and host capability without
contacting SESS and without printing secrets.

## Support status

| Profile                                                     | Status                                                      |
| ----------------------------------------------------------- | ----------------------------------------------------------- |
| Direct invoke (Gateway `POST /tools/invoke`, deterministic) | Qualified on OpenClaw 2026.10.3, Node 24.21.0 (and 24.16.0) |
| Agent turn in a dashboard conversation (Control UI)         | Partially qualified (OC-18 fails, see below)                |
| Agent turn on messaging channels (Telegram, Slack, ...)     | Not qualified                                               |
| Shared or group conversations                               | Not supported                                               |

Agent-turn qualification (OpenClaw 2026.10.3, `anthropic/claude-sonnet-5-5`, Code Mode, 2026-10-14):
the private link was observed in the conversation (via `chat.history`) while the wait was still
blocking, a verified answer came back both during a live wait and in a later normal chat turn, `openclaw sess setup` exposed the tools to
the model through `tools.alsoAllow`, and two simultaneous conversations stayed isolated. These turns
used `sess_request` and `sess_response` only; `sess_publish` and `sess_complete` are qualified on
direct invoke, not in a model-driven turn.
**Limitation:** on this host `/new` keeps the conversation's session ID, so a reset does **not**
make an earlier SESS handle unusable in that conversation (OC-18 fails). Treat a reset as the same
conversation for SESS purposes. In Code Mode the model awaits a long `sess_response` with the host
`wait` tool, which adds small model calls during a wait; the plugin itself never polls. Full record
in [compatibility.json](compatibility.json).

Only OpenClaw 2026.10.3 is qualified. The package metadata can only express a minimum host version,
so `openclaw sess doctor` warns on any other host version. Node 22 is not supported because the
qualified host itself requires Node 24.16 or later.

The package exports no TypeScript declarations: its only export is the plugin entry that OpenClaw
loads, and it has no programmatic API.

## First interaction

**Qualification status.** See [Support status](#support-status): the whole flow is qualified for
direct invoke. In model-driven turns in a dashboard (Control UI) conversation, only steps 1 and 2
are qualified (request, a live wait, and continuation in a later turn); the link was observed via
`chat.history` while the same turn was still waiting. Steps 3 (`sess_publish`, `sess_complete`)
were not exercised in a model-driven turn, and reset isolation fails (OC-18). It is not qualified
on messaging channels.

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
  IDs. Rejection after a session reset (OC-18) **fails** on OpenClaw 2026.10.3: `/new` and
  `sessions.reset` keep the session ID even for a conversation with a transcript (only a
  lifecycle revision that tools cannot see changes), and the old handle was still accepted after
  `/new`. A reset does not isolate pending SESS work; treat it as the same conversation.
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

`openclaw sess doctor` prints redacted counts per namespace and state. `openclaw sess prune` refuses
to run until the upgrade has finished. `openclaw sess prune` is a
dry run by default; `openclaw sess prune --apply` removes only the retained human link from
completed or blocked records. Claims, identities and every non-terminal record are never changed,
and a redelivered terminal call still reports its terminal result.

## Known limitations (planned for the next increment)

- One outstanding request per conversation is not enforced; each new `sess_request` call may
  create a new Session. Repeated delivery of the same host tool call is deduplicated.
- Abandoned interactions that never finish (`waiting`, `needs_resume`, `answered`,
  `create_unknown`, pending publish/complete) stay in the active namespace and are never evicted.
  About 1,100 of them fill it, after which new requests fail with `STORE_FULL`. Remedy:
  `openclaw sess retire --older-than-days <n>` lists idle `waiting`/`needs_resume`/`answered`
  interactions (dry run); `--apply` marks them blocked (`operator_retired`), drops their link and
  archives them with their claim, so a redelivered call still reports blocked and never creates
  again. Retiring an `answered` interaction discards a verified answer that the agent has not
  used yet: it can no longer be published on or completed through the plugin. `create_unknown` and pending publish/complete records are never retired automatically;
  they need individual operator resolution.
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
