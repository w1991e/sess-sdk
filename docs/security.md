# Security and verification

The SDK is a server-side integration package. Keep developer API keys in your server's
secret store or environment, and use a trusted configured API origin. Importing the
package or constructing `Sess` performs no network request. The SDK does not own
business authorization, durable workflow state, or external side effects.

## Credentials have different purposes

| Material                | What it permits or establishes                                                     |
| ----------------------- | ---------------------------------------------------------------------------------- |
| Developer/owner API key | Authorized access to the supported owner API                                       |
| Human capability URL    | Access to the linked human interaction; possession conveys `link_holder` assurance |
| Webhook signing secret  | Authentication of delivery to a particular workspace receiver                      |
| Decision receipt        | Signed evidence of SESS's accepted semantic record and its bindings                |

A person's account sign-in, link possession, receipt verification, and permission to
execute a consequential business operation are separate decisions. A valid receipt
does not prove a verified real-world identity, comprehension, exact screen pixels, or
successful downstream execution. Applications decide which actions require stronger
identity and executor-side authorization.

Deliver `created.data.human_url` privately. Do not send it to analytics, tracing,
third-party URL shorteners, issue trackers, or public logs. The SDK does not follow
human URLs. The human-page origin can differ from the API origin and receipt issuer.

## Full decision-receipt verification

`sess.receipts.verifyResponse({ sessionId, response, expectedWorkspaceId? })` returns
`{ claims, response, surface }` after all required checks. These are deeply readonly,
runtime-frozen copies. The helper snapshots caller data before network work; it never
freezes or changes the application's objects. The returned Surface is the immutable
revision, and contains its complete stored `interaction`.

The helper reads the authorized Session, checks that the supplied accepted response
matches a retained event, retrieves the exact immutable Surface revision, and obtains
public verification keys through the same configured transport. It verifies:

- Receipt format `sess_receipt: 1`; protected type `sess-receipt+jwt`, algorithm
  `EdDSA`, and an explicitly named trusted Ed25519 key. Other protected header fields,
  private JWK material, incompatible key uses, and ambiguous duplicate key IDs fail.
- Expected issuer and resource workspace; `aud`, `workspace_id`, and the return
  recipient must all match that trusted workspace.
- Exact Session, event/JTI, `rev_<revision>` step, revision, accepted time, and actor
  binding. The supported subject is `<workspace>:human_link:<session>` and assurance
  remains `link_holder`.
- SHA-256 over RFC 8785 JCS of the **complete normalized immutable interaction** and
  accepted typed input. Descriptions, labels, Unicode, and numeric values stay intact.
- Action ID, label, and summary, where the summary is the stored action's `intent`
  or an empty string. The supported renderer is `sess-html-form-1`; the current return
  channel is `null`.
- Canonical signed claims and required structure, valid acceptance timestamps,
  issued-time correspondence, bounded future issuance, and expiry at verification time.

Unknown receipt versions and security-critical semantics fail explicitly. Retrieval
alone leaves data unverified. A legacy `receipt: null` produces
`LEGACY_RECEIPT_UNAVAILABLE`; another key fetch cannot repair a missing receipt.

### Establish trusted audience context

Configure `expectedWorkspaceId`, supply it to the verification call, or use a runtime
that returns the authenticated `Sess-Workspace-Id` header on owner Session retrieval.
The header identifies the **resource's actual workspace**, which can differ from the
credential's original workspace for a claimed trial Session. Configuration and any
authoritative header must agree. An absent context produces
`VERIFICATION_CONTEXT_MISSING`, never a partial successful result.

Do not decode a receipt, copy its `aud` into your expected workspace, and then describe
that as independent audience verification. Configure the trusted issuer separately
when a deployment's protocol identity differs from its API origin. The SDK never uses
a receipt's `iss`, `jku`, or `x5u` as a network-discovery instruction.

### Offline verification

Use `verifyDecisionReceipt` from `@sess.si/sdk/receipts` with the explicit trusted issuer,
audience, expected Session/event/revision/action/time, accepted data, full normalized
interaction, and a public JWK set. Exactly one of `keys` or an explicitly trusted
`keyResolver` is required. Explicit keys require no network and no API key.

See the compiling [receipt verification example](../examples/receipt-verification.ts).
The default future-issued tolerance is 60 seconds, configurable from 0 through 60.
Expiry receives **no grace period**. `now` is an explicit `Date` for deliberate
archival verification or deterministic tests; verifying at a historical instant does
not establish that a receipt is unexpired now. High-level client verification uses
the current time.

Offline callers supply the expected accepted record; the high-level helper additionally
checks it against the authorized Session's retained response. Application business
data still needs application validation before use. Verification does not infer your
domain schema or coerce a string into a number.

## Decision bundles

A [bundle-v1](spec/bundle-v1.md) decision bundle is a deliberate disclosure of one accepted
decision: the [receipt-v1](spec/receipt-v1.md) receipt, the complete accepted Surface and input,
and the issuer's public keys. `verifyDecisionBundle` from `@sess.si/sdk/receipts` (and the
`sess verify <file>` command) verifies it offline with the same checks, order, bounds, reasons
and result object as every other Sess verification face, proven against one shared conformance
corpus. It is separate from `verifyDecisionReceipt`, which is unchanged.

```ts
import { verifyDecisionBundle, type ReceiptKeySet } from '@sess.si/sdk/receipts';

declare const bundle: unknown; // parsed from the shared file
declare const trustedKeys: ReceiptKeySet; // the issuer's public keys you obtained yourself

const result = await verifyDecisionBundle(bundle, {
  issuer: 'https://api.sess.si',
  trustedKeys,
  expectedContext: { audience: 'wks_yours', sessionId: 'ses_expected' },
});
if (result.valid && result.application_purpose === 'matched_caller_context') {
  // This issuer accepted exactly this input on this revision, for the decision you expected.
}
```

- **Keys and context come only from you.** Keys inside a bundle are never trusted; a bundle
  whose disclosed keys carry any private JWK member is `malformed`. The expected audience,
  workspace, Session, Event, revision and action are compared only when you supply them.
- **Without an expected context** the receipt is checked against its own signed audience and the
  result reports `context.status: "unchecked"` and `application_purpose: "unchecked"`: the bundle
  is genuine, but whether it is the decision your application was waiting for is yours to check.
  `matched_caller_context` requires every supplied member, including `audience`, to match.
- **Current time.** Expiry is checked at the current time unless you pass `now`; there is no
  archival validity. A modified, partial or redacted Surface or input never verifies.
- **Results, not exceptions.** Every outcome about the bundle is a result with one `reason`;
  only invalid options throw a `TypeError`. A valid result shows link-holder assurance only. It
  does not name or verify a person and is not evidence that anything was authorized or executed.

## Keys, rotation, and resource limits

Each client has an isolated cache tied to its trusted issuer and configured key source.
No cache or workspace context is keyed only by `kid` or shared as mutable global state.
The public key endpoint is `/.well-known/sess-receipt-keys.json` on the configured API
origin, and requests to it never receive the owner API key.

Key sets are limited to 256 KiB and 64 public keys. Receipts are limited to 64 KiB.
JSON snapshots reject cycles, accessors, special objects, malformed Unicode, coercing
non-JSON values, nesting beyond 128 levels, and excessive node counts. Keys are cached
for five minutes. An unknown key may cause one shared refresh after a ten-second
cooldown. A cold miss performs one initial fetch; it does not immediately fetch again.
Failures also respect the cooldown. Each shared key fetch has a five-second deadline.
SESS must retain the public key for an unexpired receipt; the client cannot invent or
recover retired key material.

A high-level verification has one overall operation deadline (30 seconds by default).
Session and Surface reads receive its remaining budget. Key waiters keep individual
cancellation/deadlines while sharing bounded public-key work; cancelling one waiter
does not cancel a fetch still needed by another. Once the last waiter leaves, the
underlying key request is aborted. Custom fetch implementations must honor normal TLS,
redirect, and authentication boundaries; the SDK still bounds how long it waits.

## Writes, errors, and observability

Session creation is never retried automatically: an ambiguous write can create a
Session whose human capability URL cannot be recovered. Publish and complete retries
reuse the original body, strong `If-Match`, idempotency key, and resolved credential.
An application's persisted mutation intent is needed for restart recovery. Rotating
the API key changes the credential part of the runtime's idempotency scope.

`SessError.kind` and safe `code` fields support decisions without parsing text. Error
messages and request hooks omit bodies, keys, receipts, secrets, capability URLs, and
raw server error messages. A defective create response may have an explicitly accessed
`getRecoveryResult()`; that private capability is excluded from default serialization
and inspection. Do not add application logging that dumps it.

Cancelling a local request/wait does not cancel a Session or undo a possibly accepted
write. Historical accepted input remains readable and verifiable, but a newer current
ETag does not authorize deriving another mutation from that old input. See
[durable integration](integration.md) for the continuation and replay rules.

## Webhooks and retention

[Incoming webhook verification](webhooks.md) checks transport authentication over exact
raw bytes before JSON parsing. It does not verify the embedded decision receipt or
grant permission for downstream work. Delivery can repeat within the freshness window;
polling and webhook workers need the same durable workspace/event ledger.

Receipt expiry and API retention are distinct. The current public contract provides
a receipt validity interval of at least 720 hours after acceptance and extends some
owner receipts through their latest possible automatic purge. A retained legacy
record can outlive its receipt. Purged or inaccessible resources may both appear as
404; the SDK cannot distinguish them or reconstruct purged data. Receipts are issued
once and are not re-signed by redelivery or key rotation.

## Sources and vulnerability reports

- [RFC 8725: JWT best current practices](https://www.rfc-editor.org/rfc/rfc8725.html)
- [RFC 8785: JSON Canonicalization Scheme](https://www.rfc-editor.org/rfc/rfc8785.html)
- [jose](https://github.com/panva/jose)
- [Standard Webhooks specification and implementations](https://github.com/standard-webhooks/standard-webhooks)
- [Security reporting policy](../SECURITY.md)

Do not post real credentials, capability links, or user data in public vulnerability
reports. Verification is an engineering guarantee about the accepted record, not a
compliance certification or legal electronic-signature claim.
