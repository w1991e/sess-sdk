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
create_intent    -> waiting                 confirmed create or validated recovery body
create_intent    -> create_unknown          dispatched; outcome not confirmed
create_intent    -> (removed) | blocked     definitive non-create (reason create_not_created)
waiting          -> waiting | needs_resume | answered | blocked
needs_resume     -> waiting | needs_resume | answered | blocked
answered         -> answered | publish_pending | complete_pending | blocked
publish_pending  -> publish_pending | waiting (revision + 1) | blocked
complete_pending -> complete_pending | completed | blocked
```

No tool operation leaves `create_unknown`, `blocked` or `completed`; leaving `create_unknown` or
`blocked` is an explicit operator action. A block is reported only after it is persisted; a stale
observation reports a conflict.

## Invariants

- Create is never retried automatically; `create_unknown` is left only by explicit operator
  resolution.
- Publish and complete replay only the saved resource, body, `If-Match`, idempotency key and
  credential scope.
- `verified: true` only after `client.receipts.verifyResponse` for the exact Session, revision,
  event and immutable Surface. Actor assurance is `link_holder`.
- The human URL is a bearer capability: never logged, traced or placed in diagnostics.
- A wait is a bounded read. No unbounded wait, no model polling loop, no claim that an agent
  wakes up after its run has ended.
- No Front Door, hosted service, webhook receiver or private host API.

## Create outcomes

- SDK outcome `not_sent` or `rejected`, or a host refusal before dispatch, means no Session exists.
  Return a non-retryable create-rejected error with no handle and no URL. The adapter deletes the
  intent, or keeps it `blocked` when it must remember a host call identity; a redelivery of that
  call reports the same class and sends nothing.
- Any other failure is `create_unknown`, unless the original create call's error yields a validated
  `SessError.getRecoveryResult()` body, which is a confirmed create (the adapter still reports the
  protocol defect). A later call cannot resolve `create_unknown`.
- If a confirmed or recovered create cannot be saved locally, return a non-retryable error saying a
  Session was created and the request must not be repeated.

## Response outcomes

- `revision` different from the handle's current revision → conflict, with no network call and no
  state change.
- `wait_ms: 0` is a single authenticated read (`sessions.retrieve`; `waitForResponse` requires a
  positive timeout). No answer while the Session is open at that revision → `waiting`.
  `WAIT_TIMEOUT` → `needs_resume`.
- Local cancellation persists `needs_resume` where possible and cancels nothing remotely.
- For a read at the handle's current revision: `NOT_INTERACTIVE`, `CLOSED_WITHOUT_RESPONSE`,
  `REVISION_SUPERSEDED` (wait or read-once path), or an answer whose Session has moved past that
  revision → `blocked`, before any answer data is released.
- `receipt_verification` with `KEY_RESOLUTION_FAILED` or `KEY_FETCH_COOLDOWN` → retryable
  unavailable. `VERIFICATION_CONTEXT_MISSING` → configuration error naming the expected-workspace
  setting. Neither records anything nor changes state.
- Every other `receipt_verification` code → `blocked` with a verification-failed error. This
  includes `UNKNOWN_KEY_ID`, which fails closed: during a signing-key rotation inside the SDK's key
  refresh cooldown a valid answer can block and needs operator review (documented limitation).
- Other SDK errors during the read, wait or verification (`api`, `transport`, `timeout`,
  `unknown_outcome`) → retryable unavailable, no state change. `aborted` → local cancellation
  above. `protocol` and `configuration` → non-retryable error, no state change.
- While a publish or complete is pending, `response` returns a conflict telling the caller to
  repeat the pending call.

## Mutation outcomes

- `SessError.outcome === 'rejected'` (a definitive coded 4xx from the SDK rejection table with no
  possible earlier write) → `blocked`, not retryable.
- Exception: `SESSION_COMPLETED` on complete. Read the Session; if it is completed at
  `expected_revision`, record and report `completed`; if the read fails, keep the mutation pending
  (retryable); otherwise block.
- A `not_sent` failure caused by the SDK's own deterministic input or configuration checks (kind
  `configuration`, for example a corrupt saved `If-Match`) → `blocked`, because an identical replay
  can never succeed.
- Every other failure (`not_sent`, `unknown`, 408/429/5xx, transport, timeout, abort, host
  revocation) keeps the mutation pending and is reported as a retryable unknown outcome.
- A confirmed result with an unexpected Session, revision or status → `blocked`.

## Replay

- Saved identity, persisted before dispatch and never regenerated: operation, Session ID,
  `If-Match`, idempotency key, credential generation, `expected_revision`, `response_event_id` and
  the publish body. A changed credential or origin refuses replay.
- While pending, a call with the same operation, `expected_revision`, `response_event_id` and a
  canonical-JSON-equal body replays the saved identity; any other call is a conflict and sends
  nothing.
- After confirmation the adapter keeps `{operation, expected_revision, response_event_id}` plus,
  for publish only, `sha256(canonical body)` (complete has no body). An exact repeat returns the
  confirmed result without a network call only while it is still true: publish → `waiting` at
  `expected_revision + 1` only while the handle is `waiting` or `needs_resume` at exactly that
  revision; complete → `completed`. Any other repeat, including an exact publish repeat after the
  handle has advanced, is a conflict and sends nothing.
- Canonical JSON: object keys sorted by UTF-16 code units, no whitespace, `JSON.stringify` for
  primitives, finite numbers only.

## Duplicate request delivery

A host with a durable tool-call identity claims it atomically with the create intent; a redelivery
never creates again and reports, by stored state:

- `waiting` with `humanUrl` while `waiting` and still admitted;
- `completed` (no URL);
- a conflict while a mutation is pending;
- create-outcome-unknown for `create_intent` or `create_unknown`;
- create-rejected for a `blocked` record with reason `create_not_created`;
- the blocked error for any other `blocked` record;
- `needs_resume` without a URL only for `answered` or `needs_resume` (meaning: read again with
  `response`).

A host without a durable call identity treats every call as new, and its tool description tells the
model not to repeat `request`.

## Human URL release

Returned only in the `request` result (confirmed or recovered create, or redelivery of that same
host call while `waiting`). Never returned by `response`, `publish` or `complete`, never placed in
errors, notes, diagnostics or telemetry, and removed from local state on `completed`.

## Error classes

Each adapter documents how its codes map to: `invalid_arguments`, `not_found`, `conflict`,
`create_rejected`, `create_unknown`, `created_not_saved`, `outcome_unknown` (retryable),
`mutation_rejected` (blocked), `verification_failed` (blocked), `blocked`, `unavailable`
(retryable), `configuration`, `store`.

## Validation

Interaction ≤ 32 KiB serialized; arguments ≤ 40 KiB. Reject C0 controls except tab, LF and CR, DEL,
C1 controls and bidi overrides (U+202A–U+202E, U+2066–U+2069) in every string. Reject the object
keys `__proto__`, `constructor` and `prototype` at every depth (including record and
`option_labels` keys); field names `constructor` and `prototype` are therefore reserved. 1–5 actions, 1–64 components, ≤ 24 fields, ≤ 50
record entries, ≤ 100 enum values. Field-schema rules converge on one shared validator.

## Shared fixtures

`fixtures/plan-afternoon/` holds synthetic test data both adapters use: a first interaction, an
accepted answer for it and the next revision. Weather values are illustrative. Fixtures are test
inputs only and are not shipped in either package.

## Convergence (recorded after both G1s)

Both G1s landed (sess-sdk #6, #8). Decisions:

- Extract now, as shared pure logic: canonical JSON with its body digest, and verification-error
  classification (`transient | configuration | genuine | other`).
- Extract later, after the rules above are aligned: interaction validation and its limits.
- Never share: host binding/authority, storage, tool schemas and result packaging, diagnostics.
  These are host contracts; drift is caught by tests against this document instead.

Shared pure logic ships as a byte-identical vendored file inside each package; a test proves
equality with the canonical source; no package imports a sibling at runtime.
