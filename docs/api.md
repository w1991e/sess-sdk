# API reference

Import `Sess`, `SessError`, public request/response types and `isInteractiveSession` from `@sess.si/sdk`.
Use `@sess.si/sdk/receipts` for `verifyDecisionReceipt` and verification types, and `@sess.si/sdk/webhooks`
for `verifyWebhook` and incoming-message types. No wildcard/deep imports are supported.

## Client configuration

`new Sess(options)` is synchronous and performs no network requests.

| Option                   | Default / meaning                                                              |
| ------------------------ | ------------------------------------------------------------------------------ |
| `apiKey`                 | Required visible-ASCII string or async provider; no whitespace trimming        |
| `baseUrl`                | `https://api.sess.si`; trusted origin only, no path/query/fragment/user-info   |
| `fetch`                  | Native fetch; injected fetch must preserve redirect/TLS/credential obligations |
| `timeoutMs`              | 12,000 ms per attempt, including streamed body                                 |
| `operationTimeoutMs`     | 30,000 ms total, including provider/retries/backoff                            |
| `maxRetries`             | 2 extra attempts, only for eligible operations; 0–10                           |
| `maxResponseBytes`       | 16 MiB decoded body; configurable from 1 byte to 256 MiB                       |
| `receiptIssuer`          | Configured API origin; explicit trusted identity for custom deployment         |
| `expectedWorkspaceId`    | Optional independent trusted expected receipt audience                         |
| `allowInsecureLocalhost` | `false`; explicit HTTP loopback development only                               |
| `onRequestEvent`         | Optional redacted outcome callback; exceptions are isolated                    |
| `userAgent`              | Optional product tokens (`my-app/1.2.0`) sent before the SDK's own User-Agent  |

Every request carries `User-Agent: sess-sdk/<version> node/<version>`, with `userAgent`'s tokens
first when set (`my-app/1.2.0 sess-sdk/<version> node/<version>`).

Durations are positive integer milliseconds no greater than 2,147,483,647. Every network helper
uses the configured transport. Keys come only from the configured API origin's public receipt-key
path and never receive owner credentials; a receipt's issuer or header URL cannot select a host.
High-level receipt verification shares one total operation budget across all its network reads.

`RequestOptions` permits `signal`, attempt/operation timeouts, retry count and response-byte bound.
These options cannot make an unsafe write retryable, change the origin or override headers.
Human waiting has its own total `timeoutMs`; see [Integration](integration.md).
Each poll's logical operation inherits the client's `operationTimeoutMs` unless a valid per-wait
override is supplied, and is bounded by the remaining human-wait time. The client's per-attempt
`timeoutMs` still applies to each attempt, including its response stream. Credential lookup,
retries and backoff share that poll's logical-operation budget. Invalid overrides fail before
credential resolution or fetch; values are never coerced or clamped into valid durations.

## Owner resources

All methods return `{data, meta}`. Metadata contains HTTP `status`, `attempts`, and optional
`requestId`, `etag`, `workspaceId` and `idempotencyKey`. Create/retrieve/publish/complete validate
and require strong quoted ETags. ETags are opaque; preserve their quotes and original value.

| Method                                             | HTTP                                                       | Successful data                                        |
| -------------------------------------------------- | ---------------------------------------------------------- | ------------------------------------------------------ |
| `sessions.create(body, options?)`                  | POST `/v1/sessions` → 201                                  | `CreateSessionResponse`                                |
| `sessions.retrieve(id, options?)`                  | GET `/v1/sessions/{id}` → 200                              | `Session` display/interactive union                    |
| `sessions.publish(id, body, options)`              | PATCH `/v1/sessions/{id}` → 200                            | Active `InteractiveSession`                            |
| `sessions.complete(id, options)`                   | POST `/v1/sessions/{id}/complete` → 200                    | Completed `InteractiveSession`                         |
| `sessions.listEvents(id, options?)`                | GET `/v1/sessions/{id}/events` → 200                       | `SessionEvents`; current full unpaginated history      |
| `sessions.retrieveSurface(id, revision, options?)` | GET `/v1/sessions/{id}/surfaces/{revision}` → 200          | Exact immutable display/interactive `SurfaceRevision`  |
| `sessions.listDeliveries(id, options?)`            | GET `/v1/sessions/{id}/deliveries` → 200                   | `Deliveries` diagnostics                               |
| `sessions.redeliverEvent(id, eventId, options?)`   | POST `/v1/sessions/{id}/events/{event_id}/redeliver` → 202 | `RedeliverResponse` containing `delivery`              |
| `webhooks.register({url}, options?)`               | PUT `/v1/webhook` → 201                                    | `WebhookRegisterResponse`; secret may be returned once |
| `webhooks.retrieve(options?)`                      | GET `/v1/webhook` → 200                                    | `WebhookResponse`                                      |
| `webhooks.verifyEndpoint(options?)`                | POST `/v1/webhook/verify` → 200                            | `WebhookVerifyResponse` containing `endpoint`          |
| `webhooks.rotateSecret(options?)`                  | POST `/v1/webhook/secrets/rotate` → 201                    | `WebhookRotateResponse`; once-returned secret          |

Publish is a complete next interaction, not JSON merge patch. Publish/complete options require
`ifMatch` and accept `idempotencyKey`. An omitted key is generated once and returned, providing
in-process retries only. Explicit keys must be primitive strings matching
`^[A-Za-z0-9_.:-]{1,128}$`: letters, digits, underscore, period, colon and hyphen only. Whitespace,
controls, other punctuation, overlength values, null, explicit undefined, boxed strings, arrays,
objects and accessors are rejected before credential resolution or dispatch. Valid key bytes
are preserved exactly. Completion has no request body. Register/verify/rotate/redeliver are
explicit operations and never run automatically.

`sessions.waitForResponse(id, {revision, timeoutMs?, intervalMs?, ...options})` returns
`{session, response, meta}`. It is a read-only helper with exact-revision and historical-answer
behavior. `receipts.verifyResponse({sessionId, response, expectedWorkspaceId?}, options?)`
returns deeply readonly, runtime-protected `{claims, response, surface}` after full verification.
See [Security](security.md) for offline verifier inputs and trust requirements.

## Ask one question

`sess.ask({ question, fields, details?, submit_label? }, options?)` takes the question-plus-fields
shape of the MCP `sess_ask` tool and resolves to a handle `{ link, sessionId, revision, answer() }`.
It is a convenience over the operations below for one question; it adds no endpoint.

| Field `type`   | Answer value                                   | Extra properties                 |
| -------------- | ---------------------------------------------- | -------------------------------- |
| `text`         | String, up to 4,000 characters                 | `multiline`                      |
| `number`       | Finite number                                  | `minimum`, `maximum` (inclusive) |
| `integer`      | Integer                                        | `minimum`, `maximum` (inclusive) |
| `boolean`      | Boolean, always present (unchecked is `false`) | none                             |
| `choice`       | One of `options`                               | `options`: 1–100 unique strings  |
| `multi_choice` | Unique list of `options`, always present       | `options`: 1–100 unique strings  |

Every field has a unique `name` (`^[a-z][a-z0-9_]{0,63}$`, the key in the answer), a `label`
(short, 1–60 characters), optional `required` (default `true`, `false` for `boolean`) and optional
`default`, a proposal that must itself be a valid value. Each option is 1–60 characters. A question
has 1–12 fields, a `question` (the page title: a question or a task, about 40 characters, at most
80), optional `details` (1–4,000 characters of plain text above the fields) and an optional
`submit_label` (the button: a verb of 1–3 words, at most 24 characters; default `Send`). It
compiles to one interactive Surface: a text component for `details`, one field component per field
with its runtime schema, and one `submit` action. Invalid input fails with `SessError` kind
`configuration`, code `INVALID_QUESTION`, outcome `not_sent`, before credential lookup or network
access; messages name the path, never your values.

### Length limits

Sess counts lengths in Unicode code points and never truncates. The limits of an interactive
Surface:

| Value                                              | Style                          | At most  |
| -------------------------------------------------- | ------------------------------ | -------- |
| `title`                                            | A question or a task, about 40 | 80       |
| `description` (under the title)                    | One or two sentences           | 280      |
| `heading` component `text`                         | Short                          | 60       |
| Field `label`, `option_labels` value, `ask` option | Short                          | 60       |
| Field `description` (help)                         | One hint                       | 160      |
| Action `label` (`ask`: `submit_label`)             | A verb, 1–3 words              | 24       |
| `record` `label` (caption)                         | A few words                    | 200      |
| `record` key / string value                        | As written                     | 40 / 200 |
| `text` component                                   | Plain text                     | 4,000    |

At most 5 actions. A display Session's title is also at most 80 (the same title message); its
description stays at most 4,000. A choice without an `option_labels` entry shows its enum ID, so
that ID is held to 60 too; a long ID with a short label is fine (IDs may have up to 200). Over 60,
Sess names the enum entry (`/interaction/source/components/2/schema/enum/1`, or
`.../schema/items/enum/1`) and says: "{field} is {length} characters and has no option label, so it
is shown as its label; the limit is {limit}. Give it an option label of at most {limit}
characters, or shorten it."
A value over its limit fails without creating or changing anything. `sess.ask()` checks its own
values first (`INVALID_QUESTION`, outcome `not_sent`); Sess checks every request (`api`, status
400, code `INVALID_SCHEMA`, outcome `rejected`). Either way the `SessError` carries `field`, a
JSON pointer to the value (`/question`, `/fields/0/label`, `/interaction/title`; for a record key,
the pointer ends with that key), `limit` and `length`. The message is Sess's: "The title can be
at most 80 characters. Keep it to a short heading, about 40." for the title, otherwise
"{field} is {length} characters; the limit is {limit}. Shorten it to at most {limit}
characters." Shorten that value and send the request again. Other errors leave these three
fields unset. Reads of Surfaces stored before these limits keep working.

The answer type is inferred from literal field definitions: required fields are properties,
optional ones may be absent, `choice` values are the option literals. The values are checked against
the definitions at runtime before they are returned; the type is never an unchecked cast.

`options` accepts the request options of the single create plus `expectedWorkspaceId`, the trusted
receipt audience for this question. Creation is attempted once; an uncertain create fails with
`unknown_outcome` and is never retried (see [Errors and retries](../README.md#errors-and-retries)).

`answer({ timeoutMs?, intervalMs?, signal? })`, in order:

1. waits for the accepted response to exactly `revision`, as `sessions.waitForResponse` does;
2. verifies it with `receipts.verifyResponse` (trusted workspace context; exact Session, revision,
   event, action and input) and requires the verified immutable Surface to be the compiled question;
3. checks the values against the fields (`protocol`, code `INVALID_RESPONSE`, if they do not match);
4. reads the Session again and continues only if it is still at that revision, retains that event
   and is `responded`, or already `completed` there;
5. completes the Session with the If-Match from that read and a generated Idempotency-Key, both kept
   by the handle and replayed after any uncertain outcome. Success requires the completed Session
   at that revision with that event; a `409 SESSION_COMPLETED` is confirmed only by reading it back;
6. returns frozen typed values. Later calls return the same result without network access.

| Error                                                         | Meaning                                    |
| ------------------------------------------------------------- | ------------------------------------------ |
| `wait_ended` `WAIT_TIMEOUT`, or `aborted`                     | Local wait ended; call `answer()` again    |
| `wait_ended` `REVISION_SUPERSEDED`, `CLOSED_WITHOUT_RESPONSE` | The question is no longer the current step |
| `wait_ended` `LINK_EXPIRED`                                   | The link closed with no answer; final      |
| `receipt_verification`                                        | Not accepted; nothing was completed        |
| `api` 401, 403 or 404                                         | Access revoked, or the Session is gone     |
| `api` with `outcome: "rejected"`                              | The completion was refused                 |
| Any error with `outcome: "unknown"`                           | Completion not confirmed; call again       |

**Advanced: link lifetime.** `sess.ask()` and `sessions.create()` take an optional `expires_in`, in
whole seconds from creation: from 30 up to your plan's link lifetime (Sess checks the ceiling;
below 30 or not whole is refused before sending). The create response's `action_expires_at` (the
handle's `expiresAt`) is the link's deadline for answers. On an interactive link of 20 hours or less
the person may ask for more time, up to ten times, never past a fixed horizon. Every Session read
reports `link_state`: `live` (takes answers), `lapsed` (past the deadline but still extendable: the
Session is still open) or `expired` (never takes an answer), with `action_expires_horizon`,
`extensions_used` and the `extensions` history; the Session log lists the same records as
`link_extensions`. Every wait keeps waiting while the link is live or lapsed. It ends with
`wait_ended` `LINK_EXPIRED` only once a read shows the link expired: one made two seconds past the
link's end on the runtime clock (the response's HTTP `Date`, else this machine's), or, when the end
cannot be placed (a revocation), a read at least that grace after the first expired read. A short
`intervalMs` reads again sooner but never ends the wait inside the grace. An answer accepted before
the end is returned. A runtime without link timing
reports no `link_state`; its deadline is then final, as before. Nothing is completed for you.

Concurrent calls on one handle share one verification and one completion. A timeout or abort ends
only that caller’s local wait; it never cancels the Session or the shared completion. The handle is
in memory only; see [Integration](integration.md#one-question-with-sessask) for recovery.

## Commerce

Sess takes no payment. A bill is an ordinary interactive Surface with one `items` component; there
is no invoice endpoint. The builders are pure functions: no credential, network or clock.

| Function                  | Returns                                                     |
| ------------------------- | ----------------------------------------------------------- |
| `money(amount, currency)` | `{ amount, currency }`, checked; never rounded or converted |
| `items(input)`            | One `items` component with its totals computed              |
| `invoice(input)`          | An `interaction`: Decline, Approve                          |
| `receipt(input)`          | An `interaction`: Continue                                  |
| `quote(input)`            | An `interaction`: Decline, Accept                           |
| `refund(input)`           | An `interaction`: Decline, Approve; positive amounts only   |
| `purchaseOrder(input)`    | An `interaction`: Decline, Request changes, Approve         |
| `lintText(text)`          | The Markdown pipe tables in a text, each with what to send  |

`items()` takes `currency` (an ISO 4217 code with known minor units), `rows` (1–100:
`{ name, detail?, reference?, amount, quantity? }`, `amount` in minor units, a `money()` in the same
currency, or `null`), optional `lines` (`{ label, amount, role, included? }` with role `tax`,
`discount`, `shipping`, `fee`, `tip`, `adjustment` or `other`), `payments` (`{ label, amount }`,
negative), `labels` (`subtotal`, `total`, `due`), `label` (the caption), `select` (`one` or
`many`), `name` and `totals: false`. It states `Subtotal` (when there are lines), the lines and
`Total`, then the payments and `Amount due`: the subtotal is the sum of the rows, the total adds
every line not `included`, and the amount due adds the payments to the total, computed exactly as
Sess checks them. A discount and a payment must be negative. A `reference` is appended to the
row's detail. A row `quantity` (`{ value, unit?, min?, max? }`, integers 0–1,000,000) makes the
quantity editable and needs `name`; Sess never recomputes the amount, so a changed quantity
arrives as a change request and your agent answers with a new revision.

The builders take the same input plus `title`, `description`, `locale` (Advanced: the amounts'
BCP 47 formatting locale), `reference` (shown in a record under `Invoice`, `Receipt`, `Quote`,
`Refund` or `Purchase order`), `record` (other facts beside the bill, such as `Valid until`) and
`actions` (replaces the buttons). A bill with an editable quantity needs an action with intent
`request_change`; the builders add `Request changes`, and replaced actions without one are
refused. `refund()` refuses a negative row, a negative total and payments; a deduction is a
negative line. A description containing a Markdown table is refused.

The limits are Sess's (`ITEMS_LIMITS`): row name 80, detail 160 (with the reference), totals label
40, caption 200, quantity unit 16, rows 100, totals lines 8, every amount and every sum within
±10^15. Over a limit, the builders throw `SessError` kind `configuration`, code `INVALID_SCHEMA`,
outcome `not_sent`, with `field` (a JSON pointer: within the component for `items()`, within the
request for the builders), `limit` and `length`, and Sess's sentence, such as "/rows has 101 rows;
the limit is 100. Send at most 100, in more than one items component if you need more." Other
refusals name the pointer and the fix; your values never enter the message.

## Safe retries and errors

Authorized/public-key GETs and keyed publish/complete can retry transport failures and HTTP
408/429/500/502/503/504. Exponential backoff includes jitter and respects delta-seconds or HTTP-date
Retry-After. If the delay cannot fit, the operation ends with timing metadata instead of sending
early. Invalid success schemas, 409/412 and other authoritative client errors are not retried.

A 429 with code `PLAN_LIMIT_REACHED` is not a rate limit: Sess refused the create under the
workspace's plan and created nothing. It is `outcome: 'rejected'`, never retried, with `reason`
(`monthly_allowance` or `active_sessions`) and, for `monthly_allowance`, `retryAfterMs` until the
period resets. Any other 429 is transient as above.

`SessError.kind` is `configuration`, `api`, `transport`, `timeout`, `aborted`, `protocol`,
`unknown_outcome`, `receipt_verification` or `wait_ended`. Inspect fields rather than parsing messages.
A 400 `INVALID_SCHEMA` for a value over its length limit also keeps `field`, `limit` and `length`
([Length limits](#length-limits)).
Nested `error.code`, `error.request_id` and `error.reason` survive only as bounded safe identifiers;
arbitrary server message text and payloads are discarded. Hook metadata is restricted to operation,
status/code, duration, attempt and request ID.

For writes, `outcome` is `not_sent`, `rejected` or `unknown`. A gateway response or malformed
success is not proof of rejection. Explicit `getRecoveryResult()` may return a protected valid
creation body; it is omitted from error inspection/JSON. Wait errors expose `sessionId` and
`revision` for resumption but omit those IDs from default serialized diagnostics.

Request serialization copies ordinary JSON before awaiting the credential provider. Cycles,
nonfinite numbers, negative zero, BigInt, accessors, special objects, array holes/undefined and
other coercive values fail locally. Optional undefined object properties are omitted. The 256 KiB
request envelope limit is checked before sending; normalized Surface/schema limits remain server-owned.

## Intentionally absent

No cancellation/deletion API, general Session listing/pagination, human-form submit wrapper,
account login client, trial-management client, front-door invocation, appearance fields, renderer,
or framework adapter is exported. Claimed trial Sessions remain read-only under owner credentials;
the runtime's 403 is returned without a workaround.
