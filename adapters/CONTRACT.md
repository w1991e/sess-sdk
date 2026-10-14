# Companion adapter contract

Internal maintainer contract for the companion packages in `adapters/`. It is not part of the
`@sess.si/sdk` package, its exports or its tarball.

| Directory           | Proposed package    | Host boundary                                      |
| ------------------- | ------------------- | -------------------------------------------------- |
| `adapters/mcp`      | `@sess.si/mcp`      | MCP stdio server for an owner-private local client |
| `adapters/openclaw` | `@sess.si/openclaw` | Native OpenClaw plugin                             |

Both packages depend directly on one exact tested `@sess.si/sdk` version. Neither depends on,
imports or activates the other. Each has its own manifest, lockfile, build, tests, file allowlist,
version and compatibility record. The root package's exports, dependencies and `files` stay
unchanged; nothing under `adapters/` enters the root tarball.

## Four logical operations

Host tool names and schemas are versioned in each adapter. The operations and their meaning are
shared.

| Operation  | Input                                                             | Behavior                                                                                                                                            |
| ---------- | ----------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| `request`  | `interaction`                                                     | Validate, persist create intent, create once, persist Session and human URL, then return or deliver the private URL and handle **before any wait**. |
| `response` | `handle`, `revision`, optional bounded `wait_ms`                  | Authorize the handle, read or perform one bounded wait for that exact revision, and fully verify an accepted answer before returning it.            |
| `publish`  | `handle`, `expected_revision`, `response_event_id`, `interaction` | Require the matching verified, unadvanced answer; persist the exact mutation; publish or reconcile with the saved replay identity.                  |
| `complete` | `handle`, `expected_revision`, `response_event_id`                | Require the matching verified answer; persist the exact mutation; complete or reconcile; confirm the terminal state.                                |

No operation accepts model-supplied API origins, credentials, workspace IDs, raw Session IDs,
callback URLs or receipt keys. A handle is opaque, adapter-issued and bound to its host scope.

## Result envelope

Domain state is nested under `interaction`:

```ts
type AdapterResult = {
  interaction: {
    handle: string;
    revision: number;
    state: 'waiting' | 'answered' | 'completed' | 'needs_resume';
    humanUrl?: string; // only to the admitted private audience
    response?: {
      eventId: string;
      actionId: string;
      data: Record<string, unknown>;
      verified: true;
      actorAssurance: 'link_holder';
    };
  };
};
```

`waiting`: no accepted answer yet for the revision. `answered`: an exact-revision answer passed
full SDK receipt verification. `completed`: the intended terminal state was confirmed remotely.
`needs_resume`: the local wait or process ended without server cancellation; a later authorized
call resumes the same handle. Blocked recovery, validation and authority failures use the host's
error contract, not a fifth success state.

## Recovery state names

`create_intent`, `create_unknown`, `waiting`, `answered`, `publish_pending`, `complete_pending`,
`completed`, `needs_resume`, `blocked`.

```text
create_intent -> waiting | create_unknown
waiting       -> answered | needs_resume
answered      -> publish_pending -> waiting
answered      -> complete_pending -> completed
any nonterminal -> blocked
```

## Invariants

- Create is never retried automatically; `create_unknown` needs explicit resolution or a
  validated `SessError.getRecoveryResult()` body.
- Publish and complete replay only the saved resource, body, `If-Match`, idempotency key and
  credential scope.
- `verified: true` only after `client.receipts.verifyResponse` for the exact Session, revision,
  event and immutable Surface. Actor assurance is `link_holder`.
- The human URL is a bearer capability: never logged, traced or placed in diagnostics.
- A wait is a bounded read. No unbounded wait, no model polling loop, no claim that an agent
  wakes up after its run has ended.
- No Front Door, hosted service, webhook receiver or private host API.

## Shared fixtures

`fixtures/plan-afternoon/` holds synthetic test data both adapters use: a first interaction, an
accepted answer for it and the next revision. Weather values are illustrative. Fixtures are test
inputs only and are not shipped in either package.

A shared internal helper is extracted only after both adapters reach G1 and demonstrate identical
pure logic. Until then each adapter owns its implementation.
