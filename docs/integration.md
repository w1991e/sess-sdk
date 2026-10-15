# Integrating a human interaction

A Session is the durable runtime resource and its private human URL. A Surface revision is the
immutable interaction presented for that step. An accepted response is a typed answer bound to
one revision and event. Your application owns what happens before and after the interaction.

## Design the human interaction

Use ordinary typed objects, as in [quickstart.ts](../examples/quickstart.ts). Display the relevant
context in heading, text and read-only record components. Ask for changes using labeled fields;
an existing value in a field is a proposal that the person can correct, not an accepted response.
Keep action labels explicit about what submitting means.
The runnable [installed-package quickstart](../examples/quickstart-node/README.md) shows the whole flow.

The [form-controls example](../examples/form-controls.ts) covers the supported controls with an
ordinary public interaction type and `satisfies CreateSessionRequest`. `name: 'category'` is the stable
submitted data key; `label: 'Expense category'` is the human-facing text. Similarly, `action_id`
contains the action's ID, not its button label. A record supplies display context and produces no
submitted field. `required: true` requires a field value; it does not turn a boolean schema into
a requirement to choose `true`. The application must enforce any such business rule after verification.
Optional notes use `required: false`; a supplied proposal still must satisfy its schema.

| Authoring control   | Supported configuration                                             |
| ------------------- | ------------------------------------------------------------------- |
| Heading / paragraph | Plain `text`; no Markdown or HTML                                   |
| Read-only record    | Optional label and primitive key/value `fields`                     |
| String input        | `minLength`, `maxLength`, optional `multiline`                      |
| Selection           | String `enum`, optional human-readable `option_labels`              |
| Number / integer    | Minimum/maximum and exclusive bounds                                |
| Boolean             | Checkbox with a clear label                                         |
| Multiple selection  | Array of string-enum IDs, item counts, optional `uniqueItems: true` |
| Action              | ID, human label, optional supported intent                          |

Field schemas additionally permit title and description. Unsupported JSON Schema features do not
become supported because a generic validation library understands them. Generated raw request
types are available for advanced callers; ergonomic `InteractiveInteraction` narrows component
and field-schema authoring. The server still validates every request.

`previewForm(sess)` sends `formRequest` through `sessions.create`. Direct HTTP takes the same
envelope: write `JSON.stringify(formRequest)` to `form-request.json`, then use:

```sh
curl --request POST https://api.sess.si/v1/sessions \
  --header "Authorization: Bearer $SESS_API_KEY" \
  --header 'Content-Type: application/json' \
  --data-binary @form-request.json
```

Both paths create a real test Session. Use synthetic data in an approved environment, protect the
returned human capability, and inspect the actual hosted renderer. Existing retention rules apply;
there is no SDK delete operation or unlimited preview sandbox. The authoring example is tested for
the same wire envelope through SDK and direct HTTP; it does not claim a new hosted browser preview.

The application supplies its business text. SESS supplies renderer system messages. Localization
is a future contract: there is no `locale` option or promised automatic translation. Format currency
for display in semantic text or records while keeping submitted numeric values unchanged; never
round or rewrite accepted input before checking its receipt hash.

The SDK sends semantic content. SESS owns rendering, CSS, accessibility, waiting pages and defaults.
Appearance is a separately authorized future runtime feature. No appearance parameter, arbitrary
CSS, renderer, theme global, form-builder DSL or frontend dependency is exported here. Omission
uses the deployed renderer's default; no hidden configuration is injected into creation.

## Validate, verify, then continue

Raw `AcceptedResponse.data` contains unknown business values. Receipt verification checks SESS's
accepted record; your application must still validate and authorize the business operation.
There is no `waitForResponse<MyType>()` that claims network input is a trusted application type.

`waitForResponse` needs an exact positive revision. It reads immediately, then polls every 1,500 ms
plus small positive jitter, with a ten-minute default total wait. The minimum helper interval is
1,000 ms. It never submits, consumes, publishes or completes anything. Repeated calls can return
the same accepted event. A 404 does not distinguish missing, inaccessible and purged resources.

Historical accepted input remains readable after later revisions and completion. The accompanying
ETag always belongs to the current Session snapshot. Before deriving a new mutation, check the
saved expected step, matching Session/revision, `status === 'responded'`, and the unprocessed event.
The tested [multi-round example](../examples/multi-round.ts) performs those checks before domain
calculation. A later receipt-context read never supplies a replacement write ETag.

## Durable workflow integration

A pending JavaScript promise is not durable suspension. Persist the Session ID, private human URL,
expected step, processed event IDs and any attempted mutation. Before publishing or completing,
commit `{operation, sessionId, body, ifMatch, idempotencyKey}` to your store. Replay that exact intent
after an uncertain outcome. Do not regenerate it from historical input with a newer ETag.
Persisted keys must be primitive strings matching `^[A-Za-z0-9_.:-]{1,128}$`; an invalid or
missing saved key stops recovery before credential lookup or network access. Only a new
in-process mutation may omit its key for automatic generation. Never replace a saved identity.

The multi-round example provides a small file-backed checkpoint adapter for a single worker;
its caller must hold an exclusive worker lease. It flushes file contents, uses atomic rename and
syncs the parent directory on POSIX before returning. Windows crash durability requires a suitable store.
Choose a transactional database/store and platform-appropriate permissions for a production app;
on Windows, Unix file modes do not establish a complete ACL. Local checkpoints contain a bearer link.

Pass an application-owned credential slot/version label as the fifth argument to `runMultiRound`,
for example `owner-key-v1`. This is a stable label for the exact owner credential, never the key
itself; change it when the credential changes. New version-2 checkpoints persist the label and
original replay identity. A resumed mutation requires the same label. Every loaded checkpoint,
including an injected store's result, is decoded before network dispatch. Malformed records stay
on disk and stop execution; no key or ETag is regenerated. Version-1 records did not record scope:
they remain readable for completed verification or read-only inspection of already-applied intent,
and require manual reconciliation before further writes. Do not guess a missing old scope.

Creation has no replay key. Save a pre-create intent and stop on restart if no confirmed resource
was saved; creating again can orphan a Session whose private URL cannot be recovered. If the SDK
received a valid creation body but defective headers, `SessError.getRecoveryResult()` exposes it
only through explicit access so the app can protect and reconcile it. Do not dump the error object
to discover secrets.

Credential providers resolve once per logical HTTP operation. The result is fixed across internal
retries. Rotating credentials between independently initiated retries changes the runtime's
idempotency scope, so saved keys alone cannot promise recovery across credential rotation.

An application transaction/outbox or destination idempotency contract governs external side effects.
The SDK does not supply exactly-once business execution. Polling and webhooks should consult the
same durable workspace/event ledger. A local `Set` cannot provide restart-safe deduplication.

## Choose polling or webhooks

Polling is convenient for a few long-running server processes. In a short-lived serverless function,
retrieve once and reschedule, or use a signed webhook and an application-owned durable inbox.
Avoid thousands of pending promises in functions that can be suspended or terminated. See
[Webhooks](webhooks.md) for the raw-body receiver and acceptance boundary.

Aborting a request ends the local request only. It neither cancels the Session nor undoes a write.
Write outcomes distinguish local `not_sent`, authoritative `rejected`, and conservative `unknown`.

## Hosting and adapters

The runtime manages lifecycle, state, routing and authorization. An integration adapter translates
a specific external framework or protocol where needed. The SDK exposes supported SESS operations;
it is not a universal conversion engine or an agent framework. The publisher owns execution and
durable storage.

Browser continuity is runtime work. Keep manual-refresh instructions until a deployed waiting-page
implementation is verified. SDK owner polling cannot update the human's browser or relax its CSP.
