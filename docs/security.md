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
| Decision receipt        | Signed evidence of Sess's accepted semantic record and its bindings                |

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

- Receipt format `sess_receipt: 1` with protected type `sess-receipt+jwt`
  ([receipt-v1](spec/receipt-v1.md)), or `sess_receipt: 2` with `sess-receipt-2+jwt`
  ([receipt-v2](spec/receipt-v2.md)); algorithm `EdDSA`, and an explicitly named trusted Ed25519
  key. Other protected header fields, a type that does not match its format version, private JWK
  material, incompatible key uses, and ambiguous duplicate key IDs fail.
- Receipt v2 only: the revision envelope it commits to. `verifyResponse()` uses the response's
  own `revision_envelope`; `verifyDecisionReceipt` takes it as `revisionEnvelope`. It must be the
  `sess_revision: 2` envelope exactly: its ten common members, then exactly one of `titles` (the
  full form) or `titles_digest` (the compact form), with a canonical `published_at`, each ID of
  its own kind, and each title one line of plain text of 1 to 60 code points under the shared
  title rule. `surface.revision_hash` is the RFC 8785 SHA-256 of the compact form (a full form's
  `titles` replaced by their digest), and the envelope's Session, revision, Surface hash and
  renderer identity must be the receipt's. Otherwise, or when it is missing, verification fails
  with `REVISION_ENVELOPE_MISMATCH`; the never-issued nine-member `sess_revision: 1` envelope is
  refused the same way. There is no signature-only path for a receipt v2. A receipt v1 has no
  envelope and none is read for it. The titles and `agent_target.name` are words the asker chose,
  signed as published, never a verified identity; the envelope carries no key label.
- Receipt v2 only: an `action.label` of at most 24 code points (`INVALID_CLAIMS` beyond).
- A receipt newer than this release, a later Sess receipt type (`sess-<name>+jwt`, checked before
  anything else in the receipt) or an envelope of a later `sess_revision`, is refused with kind
  `receipt_newer` and code `RECEIPT_NEWER`: never a verification failure, and nothing is
  returned. Update the SDK to check it. Unsigned members this release does not know, beside a
  receipt in an API response, are ignored.
- Expected issuer and resource workspace; `aud`, `workspace_id`, and the return
  recipient must all match that trusted workspace.
- Exact Session, event/JTI, `rev_<revision>` step, revision, accepted time, and actor
  binding. The supported subject is `<workspace>:human_link:<session>` and assurance
  remains `link_holder`.
- SHA-256 over RFC 8785 JCS of the **complete normalized immutable interaction** and
  accepted typed input. Descriptions, labels, Unicode, and numeric values stay intact.
- Action ID, label, and summary, where the summary is the stored action's `intent`
  or an empty string. The current return channel is `null`.
- The renderer identity (`surface.renderer_version`, Decision 0009 Amendment 13): one this
  release bundles (`sess-html-form-1`, `sess-html-form-2`), or one on the issuer's renderer list
  whose signature verifies under the same trusted keys and issuer
  (`/.well-known/sess-renderer-identities.json`; `verifyRendererIdentities`). `verifyResponse()`
  and `sess.ask()` fetch that list from the API origin only for an identity this release does
  not bundle; `verifyDecisionReceipt` takes it as `rendererIdentities`, and `sess verify` as
  `--renderers <file>`. A list is never trusted because it came beside a receipt. Lists are
  ordered by their signed edition `seq`, with containment as the cross-check
  (`newerRendererList`); a list that disagrees with the bundled edition, or with another of the
  same `seq`, is refused. An older list proves only the identities it holds.
- Canonical signed claims and required structure, valid acceptance timestamps,
  issued-time correspondence, bounded future issuance, and expiry at verification time.

Unknown receipt versions and security-critical semantics fail explicitly. Retrieval
alone leaves data unverified. A legacy `receipt: null` produces
`LEGACY_RECEIPT_UNAVAILABLE`; another key fetch cannot repair a missing receipt.

`sess.ask()` uses this verifier unchanged. Before returning data, `answer()` also requires the
verified Surface to be exactly the compiled question, checks the values against its fields, and
reads the Session again so that a historically valid but superseded answer is never used to
progress. It completes only with the replay identity it saved before the first attempt.

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

<!-- Proposed wording for this section, not yet signed. -->

## Closing receipt

When a Session ends with at least one accepted answer, Sess signs one closing receipt
([closing-receipt-v1](spec/closing-receipt-v1.md)): how the Session ended and every accepted
answer's receipt, in order. It is not a receipt for any one answer. `sess.sessions.listEvents(id)`
returns it as `closing`, beside `events`: `{ typ, closure_id, cause, terminal_event_id,
accepted_rounds, receipt }`. It is never an Event. It is absent while the Session is open, when it
ended with no accepted answer, and until its receipt is signed. Webhooks do not carry it.

`sess.receipts.verifyClosing({ sessionId, closing, expectedWorkspaceId? })` returns deeply
readonly `{ claims, closing }`. It reads the Session's Event log again and requires the supplied
`closing` to be the one served. It verifies the receipt with the published keys
(`/.well-known/sess-receipt-keys.json`). It requires the cause, terminal Event, closure and count to
be the ones signed, and the commitment to match exactly the served answers' receipts, in order.
Each answer's own receipt is still verified with `verifyResponse`. Offline, `verifyClosingReceipt`
from `@sess.si/sdk/receipts` takes the receipt, the trusted issuer and workspace, exactly one of
`keys` or `keyResolver`, and optionally `expected: { sessionId, closureId }` and the round
receipts as `rounds`.

It checks, in order: `alg` `EdDSA` (`UNSUPPORTED_ALGORITHM`); a trusted `kid`
(`UNKNOWN_KEY_ID`); `typ` exactly `sess-closing-receipt+jwt` (`UNSUPPORTED_TYPE`, so a round
receipt is refused here); a header of exactly `alg`, `kid` and `typ`; the signature
(`INVALID_SIGNATURE`); issuer and workspace (`ISSUER_MISMATCH`, `AUDIENCE_MISMATCH`); format
version 1 (`UNSUPPORTED_RECEIPT_VERSION`); the strict claims, with no `exp` (`INVALID_CLAIMS`);
RFC 8785 canonical JSON (`NON_CANONICAL_PAYLOAD`); then the Session and closure
(`RECORD_BINDING_MISMATCH`) and the round set (`CLOSING_ROUNDS_MISMATCH`). A higher format version,
or a commitment scope this release does not know, is newer: kind `receipt_newer`, code
`RECEIPT_NEWER`, and nothing is returned. `verifyDecisionReceipt` and `verifyResponse()` refuse a
closing receipt the same way. The SDK reaches the same result as Sess on every vector of the
shared closing-receipt-v1 conformance corpus.

## Decision bundles

A [bundle-v1](spec/bundle-v1.md) decision bundle is a deliberate disclosure of one accepted
decision: the [receipt-v1](spec/receipt-v1.md) receipt, the complete accepted Surface and input,
and the issuer's public keys. A [bundle-v2](spec/bundle-v2.md) bundle carries a
[receipt-v2](spec/receipt-v2.md) receipt and the revision envelope it commits to as well; without
that envelope, with another, or with its compact form (a QR code's, never a file's), it is invalid
with reason `revision`. A later bundle version, receipt type or envelope `sess_revision` is
`unsupported_version`: newer, never a damaged file, and nothing in it is released (`sess verify`
says so and exits 3). `verifyDecisionBundle` from
`@sess.si/sdk/receipts` verifies both versions offline with the same checks, order, bounds,
reasons and result object as every other Sess verification face, proven against the shared
bundle-v1 and bundle-v2 conformance corpora. It is separate from `verifyDecisionReceipt`.

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

### The `sess verify` command

`sess verify <file>` runs these verifiers on a decision bundle, a closing receipt (a file holding
its compact JWS) or a kept file (keep-v1 to keep-v4). It adds no verification of its own:

- **A kept file** is read structurally: its own members, each round's receipt, the round's
  bundle when the file holds its content (it must carry that round's receipt byte for byte, and
  for a receipt v2 the same revision envelope), and keep-v4's `closing_receipt`. Each bundle is
  checked with `verifyDecisionBundle`; the closing receipt with `verifyClosingReceipt`, given the
  file's round receipts in file order, so the signed count and commitment must be exactly those
  receipts; and every answer checked must name the closing receipt's issuer, workspace and
  Session. An answer the file holds no content for is reported `not_checked` and the file is
  never reported verified (exit 5). The inventory, snapshot, archival or person envelopes, holder
  proofs and witness evidence are not checked. Kept files are read up to 80 MiB.
- **Keys.** With `--keys <file>`, nothing is fetched. Without it, the command makes one `GET` of
  `<issuer>/.well-known/sess-receipt-keys.json` (the issuer defaults to `https://api.sess.si` and
  is never read from the file; it must be an `https` origin): no credential, cookie or referrer,
  no redirect, a 5-second deadline and the 256 KiB key-set bound, then `validateKeySet`. Nothing
  else is sent. If the keys cannot be fetched or are not a valid key set, nothing is checked
  (exit 4).
- **Time.** Each answer is judged at the time Sess says it signed its receipt (its signed `iat`),
  as Sess's own closing set check does, unless `--now` is given. So an answer past its `exp`
  still verifies; its `exp` is shown, not judged. A closing receipt has no `exp`.
- **Workspace.** Without `--audience` or `--workspace`, a closing receipt is checked against its
  own signed `aud` and the context is reported unchecked, as for a bundle.
- **Key changes.** An answer signed under an older key verifies only while that key is in the
  key set used; otherwise it is `unknown_kid`. The published set carries no key dates.
- **Not read.** PDFs, QR receipt codes and a round receipt on its own (without its content) are
  refused with exit 2.

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
Sess must retain the public key for an unexpired receipt; the client cannot invent or
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
