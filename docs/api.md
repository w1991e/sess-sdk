# API reference

Import `Sess`, `SessError`, public request/response types and `isInteractiveSession` from `@sess/sdk`.
Use `@sess/sdk/receipts` for `verifyDecisionReceipt` and verification types, and `@sess/sdk/webhooks`
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

Durations are positive integer milliseconds no greater than 2,147,483,647. Every network helper
uses the configured transport. Keys come only from the configured API origin's public receipt-key
path and never receive owner credentials; a receipt's issuer or header URL cannot select a host.
High-level receipt verification shares one total operation budget across all its network reads.

`RequestOptions` permits `signal`, attempt/operation timeouts, retry count and response-byte bound.
These options cannot make an unsafe write retryable, change the origin or override headers.
Human waiting has its own total `timeoutMs`; see [Integration](integration.md).

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
in-process retries only. Explicit keys must be primitive strings containing 1–128 visible ASCII characters; null, undefined, boxed strings, arrays, objects and accessors are rejected before credential resolution or dispatch. Completion has no request body. Register/verify/rotate/redeliver are
explicit operations and never run automatically.

`sessions.waitForResponse(id, {revision, timeoutMs?, intervalMs?, ...options})` returns
`{session, response, meta}`. It is a read-only helper with exact-revision and historical-answer
behavior. `receipts.verifyResponse({sessionId, response, expectedWorkspaceId?}, options?)`
returns deeply readonly, runtime-protected `{claims, response, surface}` after full verification.
See [Security](security.md) for offline verifier inputs and trust requirements.

## Safe retries and errors

Authorized/public-key GETs and keyed publish/complete can retry transport failures and HTTP
408/429/500/502/503/504. Exponential backoff includes jitter and respects delta-seconds or HTTP-date
Retry-After. If the delay cannot fit, the operation ends with timing metadata instead of sending
early. Invalid success schemas, 409/412 and other authoritative client errors are not retried.

`SessError.kind` is `configuration`, `api`, `transport`, `timeout`, `aborted`, `protocol`,
`unknown_outcome`, `receipt_verification` or `wait_ended`. Inspect fields rather than parsing messages.
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
