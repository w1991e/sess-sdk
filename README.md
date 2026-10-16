# SESS SDK

Ask a person a question from your server and continue with their verified answer. `@sess.si/sdk`
creates a hosted SESS page, waits for the answer on the exact Surface revision, verifies its signed
receipt, and continues the same Session.

**Install** from npm:

```sh
npm install --save-exact @sess.si/sdk@next
```

**Run** the [plain-Node quickstart](examples/quickstart-node/README.md), a complete program that
needs only `SESS_API_KEY`.

**What you'll see:** a private human link, printed before the program starts waiting. Open it on any
device and answer; the program prints the verified answer and completes the Session.

**Release status:** every SDK release so far is a `0.1.0` release candidate, served under the `next`
dist-tag. There is no stable release yet: do not install the bare name, whose `latest` tag points at a
deprecated `0.0.0-stage` placeholder. The [changelog](CHANGELOG.md) describes each version;
`npm view @sess.si/sdk dist-tags` shows what the registry serves now.

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

## Check a decision bundle

A decision bundle is one accepted decision that its owner chose to share: the signed receipt, the
exact Surface and input, and the issuer's public keys. Check it on your own computer, with keys you
trust (never the keys inside the bundle):

```sh
npx -p @sess.si/sdk@0.1.0-rc.5 sess verify bundle.json --issuer https://api.sess.si --keys sess-receipt-keys.json
```

The `sess` command first ships in `0.1.0-rc.5`; name that version (or a later one) exactly, because
the bare package name resolves to the `latest` placeholder, which has no command.

You'll see `Valid decision bundle.` and what was accepted, when, on which revision; or `Invalid`
and the first reason. Exit status is 0 valid, 1 invalid, 2 usage error; add `--json` for the full
result. Nothing is sent anywhere. In code, use `verifyDecisionBundle` from `@sess.si/sdk/receipts`
([Security](docs/security.md#decision-bundles)). Formats: [receipt-v1](docs/spec/receipt-v1.md) and
[bundle-v1](docs/spec/bundle-v1.md).

## Check an archival envelope (not yet released)

In this repository, not yet in any published or prepared version: an archival envelope is a receipt
in the issuer's custody, with the issuer's signed archival core and any witness evidence. Check it
with the receipt keys you trust, and optionally the content, the context you expect and the witness
anchors you obtained yourself:

```sh
sess verify --archival envelope.json --keys sess-receipt-keys.json --issuer https://api.sess.si \
  --witness-root trusted_root.json --witness-keys sess-witness-keys.json
```

Each dimension is reported separately: signature, contents, context, witness, key trust and live
expiry. Exit status is 0 verified, 1 not verified, 2 usage error; witness status and live expiry are
shown beside the result and do not change it. In code, use `verifyArchivalEnvelope` from
`@sess.si/sdk/archival` ([Security](docs/security.md#archival-envelopes-not-yet-released)). Formats:
[archival-core-v1](docs/spec/archival-core-v1.md) and
[witness-evidence-v1](docs/spec/witness-evidence-v1.md).

## Runtime and imports

Supported: maintained Node 22 releases at or above 22.14, and Node 24 (recommended).
TypeScript consumer declarations target 5.9 and current stable. JavaScript consumers need no compiler.
The package contains one ESM build. CommonJS applications use `await import('@sess.si/sdk')`, as in the
[CommonJS example](examples/commonjs.cjs); synchronous `require` is not a supported contract.

Entry points are `@sess.si/sdk`, `@sess.si/sdk/receipts` and `@sess.si/sdk/webhooks` (and, not yet released,
`@sess.si/sdk/archival`). Importing or constructing
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
- [Plain-Node quickstart](examples/quickstart-node/README.md): a complete program, from the first call to the verified answer.

The present runtime can require manual browser refresh between rounds. Owner polling in this
SDK does not change that browser behavior. Appearance configuration and front-door invocation
helpers remain conditional future work, with no placeholder exports.

[Contribute](CONTRIBUTING.md) · [Security reporting](SECURITY.md) · [Apache-2.0](LICENSE)
