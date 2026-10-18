# Webhook integration

Use webhooks when a durable receiver and worker fit your deployment better than a
long-lived polling promise. The SDK supplies owner management calls and a standalone
incoming verifier. Your application supplies endpoint hosting, workspace routing,
durable inbox storage, worker scheduling, business authorization, and side effects.

## Endpoint management is an explicit workspace operation

| SDK method                                         | Meaning                                          |
| -------------------------------------------------- | ------------------------------------------------ |
| `sess.webhooks.register({ url })`                  | Register or replace the workspace endpoint       |
| `sess.webhooks.retrieve()`                         | Inspect endpoint and signing-secret metadata     |
| `sess.webhooks.verifyEndpoint()`                   | Ask Sess to send a signed verification challenge |
| `sess.webhooks.rotateSecret()`                     | Rotate the workspace signing secret              |
| `sess.sessions.listDeliveries(sessionId)`          | Inspect delivery state and attempts              |
| `sess.sessions.redeliverEvent(sessionId, eventId)` | Explicitly request another delivery              |

Registration can replace an existing endpoint and is never automatic. Registration
or rotation may return a secret only once; store it immediately in your secret manager.
Neither log the secret nor put it in a URL. These management writes are not retried
automatically. Successful endpoint verification returns `{endpoint}` with the verified endpoint; event redelivery returns `{delivery}` for the new or existing pending delivery. Both bodies are validated and returned in `data`.

The verification challenge must be answered before normal delivery starts. Endpoint
verification has a runtime-managed expiry; inspect the returned `verification_expires_at`
metadata and renew explicitly. The SDK does not start renewal or delivery timers.

## Authenticate the exact raw body

`verifyWebhook(rawBody, headers, options)` from `@sess.si/sdk/webhooks` accepts a `Uint8Array`
(including Node `Buffer`) or the exact original UTF-8 string. Supply either
`{ secret }` or `{ secrets: [oldSecret, newSecret] }` from your trusted workspace
configuration. `headers` can be a Web `Headers` object or a case-insensitive record
whose authentication-header values are single strings. Duplicate scalar headers,
arrays of header values, malformed values and comma-merged repeated lines are refused.

The verifier uses the maintained `standardwebhooks` implementation with JSON parsing
disabled until authentication succeeds. It validates UTF-8 without replacing bytes,
then verifies the signed body. Whitespace, property order, and encoding are part of
the signature. Passing an already parsed object, or serializing it back to JSON,
does not preserve the original signed payload.

The headers are:

| Header                 | Purpose                                                    |
| ---------------------- | ---------------------------------------------------------- |
| `webhook-id`           | Stable accepted Event ID for response deliveries           |
| `webhook-timestamp`    | Integer send-time seconds since the Unix epoch             |
| `webhook-signature`    | Space-separated Standard Webhooks `v1,<base64>` signatures |
| `sess-webhook-key-ids` | Informational key labels; never an authorization source    |

The default freshness tolerance is 300 seconds in either direction. Set
`toleranceSeconds` from 0 through 300 to tighten it; the SDK does not disable replay
checks. Requests within this window can still repeat. The default body ceiling is
1 MiB and can be tightened with `maxBodyBytes`. Authentication headers, signature count,
and trusted rotation-secret count are also bounded. Reject excessive request bodies
while streaming, before calling the verifier.

For Express, Fastify, Next.js, or a serverless platform, obtain the raw body before its
JSON middleware/parser runs. Use the framework's documented raw-body mechanism. No
framework dependency is required by the SDK. Do not decompress or rewrite a body in a
way that changes the signed bytes before verification.

## Two message types, with separate handling

After authentication and schema checks, the verifier returns a deeply readonly,
runtime-frozen discriminated union:

- `type: 'sess.webhook.verification'`: echo the bounded `challenge` exactly in a JSON
  object. Do not enqueue a challenge as accepted user input.
- `type: 'response.accepted'`: a stable `event_id`, `session_id`, `sequence`, `revision`,
  `action_id`, typed `data`, `accepted_at`, and `receipt`. Its event ID must equal the
  transport's `webhook-id`.

A challenge is a management handshake, and `verifyWebhook()` is the incoming verifier.
The similarly named `sess.webhooks.verifyEndpoint()` sends the outbound management
request that starts that handshake.

The payload does not provide independently trusted workspace context. Associate your
receiver route and signing secrets with an expected workspace in server configuration.
Do not choose a workspace or secret by trusting the receipt's decoded audience.

## Durable receiver boundary

The [Node HTTP receiver example](../examples/webhook-receiver.ts) exposes:

```ts
import type { DeepReadonly } from '@sess.si/sdk/receipts';
import type { WebhookEvent } from '@sess.si/sdk/webhooks';

interface DurableInbox {
  accept(message: {
    workspaceId: string;
    event: DeepReadonly<WebhookEvent>;
  }): Promise<'inserted' | 'duplicate'>;
}
```

Implement this interface using your own database/queue transaction, with a unique key
for `(workspace_id, event_id)`. Resolve its promise only once the event is durably
accepted. The compiling example includes `acceptWebhookDelivery` for the tested
authentication/challenge/inbox boundary and `createWebhookReceiver` as a Node HTTP
listener. It does not open a port on import or pretend an in-memory `Set` is durable.
Its caller supplies normal hosting/TLS and finite HTTP request/header timeouts.

The receiver sequence is:

1. Bound the request, authenticate raw bytes, validate the message, and establish
   workspace context from trusted server routing configuration.
2. Echo an authenticated challenge, or commit a response event into the durable inbox.
3. Return 2xx after the commit. Duplicate delivery receives the same accepted outcome.
4. A worker retrieves the matching accepted response and calls
   `sess.receipts.verifyResponse({ sessionId, response, expectedWorkspaceId })` before
   applying it to business logic. An alternative is full receipt verification before
   enqueueing when your receiver's latency budget permits.
5. Commit processing state with your application's transaction/outbox or downstream
   idempotency policy. Polling and webhook paths consult the same event ledger.

The webhook's accepted-event payload omits the owner representation's `actor` field.
Retrieve the authorized Session and select its response by `event_id` when constructing
input for the full high-level receipt helper. Do not cast the webhook payload into a
fully verified owner response or infer actor assurance from an unverified JWT.

If durable storage fails, return a non-2xx response so the delivery can be retried. Do
not return success and enqueue asynchronously afterward. The example executes no
external business operation; your worker must independently authorize any consequential
action. A 2xx means the endpoint accepted delivery, not that the agent resumed or the
business operation completed.

## Rotation, repeated delivery, and expiry

During runtime-supported secret overlap, a delivery can contain multiple signatures.
The helper accepts a matching supported signature from either configured trusted
secret. Keep both until the overlap closes and your rollout is complete; then remove
the retired secret. Informational key IDs do not substitute for signature verification.

Accepted events and their receipts retain the same identity across automatic retries
and explicit redelivery. Authentication timestamps describe delivery time, while
`accepted_at` describes the original accepted action. Re-verification or redelivery
does not refresh a decision receipt's expiry. A legacy null receipt can authenticate
as a transport payload but cannot pass full receipt verification.

The runtime controls its at-least-once delivery window, attempt history, endpoint
verification validity, rotation overlap, retention, and purge. Query management and
delivery metadata for state. A local timer in the SDK would not provide authoritative
delivery status. Missing/inaccessible/purged resources may all appear as 404.

See [security and trust context](security.md) and [the Standard Webhooks specification](https://github.com/standard-webhooks/standard-webhooks/blob/main/spec/standard-webhooks.md).
