# SESS SDK

Create a hosted human interaction from your application, receive the accepted input for the correct
Surface revision, verify its receipt, and continue on the same Session.

`@sess.si/sdk` is a server-side TypeScript and JavaScript library. Your application supplies the
interaction and business logic; SESS owns the hosted UI, state, routing and authorization.

**Start here:** the [plain-Node quickstart](examples/quickstart-node/README.md) is a runnable
program. It needs only `SESS_API_KEY`; it prints the private human link before it starts waiting,
then verifies the person's answer and completes the Session.

**Candidate status:** nothing is published yet. `0.1.0-rc.3` is the approved candidate that the
quickstart and adapters use; this source tree is the successor candidate `0.1.0-rc.4`, which is
under review. Until a version is published, install the digest-checked candidate tarball as the
quickstart explains (or see [Contributing](CONTRIBUTING.md)). After an authorized release, the
registry install command is:

```sh
npm install @sess.si/sdk@<published-version>
```

## Create and verify an interaction

Use a developer API key from [the SESS developer portal](https://app.sess.si). Keep it on the server.
The [hosted no-signup demo](https://sess.si) is a separate trial flow; a human link or trial credential
is not an owner API key. No LLM, agent framework, Docker or SESS source checkout is needed by consumers.

<!-- example:quickstart -->

```ts
import { Sess } from '@sess.si/sdk';

const sess = new Sess({ apiKey: process.env.SESS_API_KEY });
const created = await sess.sessions.create({
  interaction: {
    mode: 'interactive',
    title: 'Review a synthetic invoice',
    source: {
      kind: 'sess_surface',
      components: [
        { type: 'record', label: 'INV-001', fields: { amount: 120 } },
        {
          type: 'field',
          name: 'amount',
          label: 'Correct amount',
          required: true,
          schema: { type: 'number', minimum: 0 },
          value: 120,
        },
      ],
    },
    actions: [{ id: 'submit', label: 'Submit review', intent: 'submit' }],
  },
});

// Privately deliver created.data.human_url through your application's handoff.
// It is a bearer capability: do not put it in ordinary logs or analytics.
const answer = await sess.sessions.waitForResponse(created.data.id, {
  revision: created.data.revision,
});
const verified = await sess.receipts.verifyResponse({
  sessionId: created.data.id,
  response: answer.response,
});
const amount = verified.response.data.amount;
if (typeof amount !== 'number' || !Number.isFinite(amount)) {
  throw new Error('Expected an accepted numeric amount');
}
```

<!-- /example:quickstart -->

Full verification needs a trusted workspace audience. A runtime supporting the authenticated
`Sess-Workspace-Id` header supplies it. On an older runtime, configure `expectedWorkspaceId` from
trusted deployment settings. Otherwise verification fails with `VERIFICATION_CONTEXT_MISSING`;
the SDK never learns a trusted audience from the unverified receipt. The runtime companion change
is under review and is not a claim about the currently deployed service.

The [quickstart function](examples/quickstart.ts) includes a private delivery callback.
[Three-round continuation](examples/multi-round.ts) persists mutation intent and checks that an
answer is still the current expected business step before publishing or completing. Its store
and worker lease are application-owned. See [Integration](docs/integration.md).

## Runtime and imports

Supported: maintained Node 22 releases at or above 22.14, and Node 24 (recommended).
TypeScript consumer declarations target 5.9 and current stable. JavaScript consumers need no compiler.
The package contains one ESM build. CommonJS applications use `await import('@sess.si/sdk')`, as in the
[CommonJS example](examples/commonjs.cjs); synchronous `require` is not a supported contract.

Entry points are `@sess.si/sdk`, `@sess.si/sdk/receipts` and `@sess.si/sdk/webhooks`. Importing or constructing
the SDK does not contact a service, start a server, read credential files or log data.

## Errors and retries

Errors are `SessError` with stable `kind`, API `code`, `status`, `requestId`, `attempts` and write
`outcome` fields when applicable. Server bodies and request secrets are omitted from default errors.

Session creation is attempted once. An unknown outcome may mean a Session exists whose private
URL was lost. Never automatically create again. If a valid creation body arrived with defective
headers, explicitly inspect `error.getRecoveryResult()` and protect that capability.

Publish and complete require a strong quoted `ifMatch`. Persist the body, original ETag and explicit
`idempotencyKey` before a durable write. Internal retries retain those values and the same resolved
credential. A 409 or 412 is returned to the caller; the SDK never refreshes an ETag to force a write.

## Direct HTTP remains supported

The same create operation is available without the SDK:

```sh
curl --request POST https://api.sess.si/v1/sessions \
  --header "Authorization: Bearer $SESS_API_KEY" \
  --header 'Content-Type: application/json' \
  --data-binary @interaction.json
```

Here `interaction.json` contains the same `{ "interaction": ... }` request body. The response
contains a private human URL; protect terminal output and disable request tracing. The complete
contract is served at [OpenAPI](https://api.sess.si/openapi.json).

## Guides

- [API reference](docs/api.md): supported operations, validated responses, options and errors.
- [Integration](docs/integration.md): authoring, lifecycle, validation, durability and future boundaries.
- [Security](docs/security.md) and [receipt example](examples/receipt-verification.ts).
- [Webhooks](docs/webhooks.md) and [Node receiver with a durable-inbox boundary](examples/webhook-receiver.ts).
- [Compatibility](docs/compatibility.md), [testbed migration](docs/migration.md) and [release runbook](docs/releasing.md).
- [Reference demo](https://github.com/w1991e/sess-agent-testbed): the application and terminal handoff.

The present runtime can require manual browser refresh between rounds. Owner polling in this
SDK does not change that browser behavior. Appearance configuration and front-door invocation
helpers remain conditional future work, with no placeholder exports.

[Contribute](CONTRIBUTING.md) · [Security reporting](SECURITY.md) · [Apache-2.0](LICENSE)
