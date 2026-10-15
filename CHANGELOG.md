# Changelog

## Unreleased

Not part of any published or prepared version. `0.1.0-rc.5` as prepared does not contain it.

- `@sess.si/sdk/archival`, a new subpath with the successor archival verifier: `verifyArchivalEnvelope`
  checks an archival envelope (the exact original receipt, the issuer's signed archival core and any
  witness evidence) offline against the receipt keys and witness anchors you trust, and reports
  independent dimensions (signature, contents, context, witness, key trust, live expiry) with the
  Sess core's reason codes. `presentArchivalVerification` maps them to the user-facing messages.
  `parseTrustedRoot` and `parseWitnessKeySet` read a Sigstore `trusted_root.json` and the issuer's
  witness key set into anchors. `verifyDecisionReceipt`, `verifyDecisionBundle` and receipt-v1
  behaviour are unchanged.
- `sess verify --archival <envelope.json> --keys <jwks.json>` with optional `--issuer`, context,
  `--content`, `--witness-root` and `--witness-keys`; exits 0 verified, 1 not verified, 2 usage error,
  and makes no network calls.
- Verbatim archival-core-v1 and witness-evidence-v1 specifications, the archival-v1 corpus, the
  witness renewal vector and the recorded Sigstore staging run in the source repository, pinned by
  SHA-256 to one Sess commit and checked by `npm run check:spec`.

## 0.1.0-rc.5 — 2026-10-15

- `verifyDecisionBundle` in `@sess.si/sdk/receipts`: offline verification of a bundle-v1 decision
  bundle against the issuer and keys the caller trusts, with the Sess core's checks, order, bounds,
  reasons and result object, proven against the shared conformance corpus. `BUNDLE_LIMITS` exports
  its size bounds. `verifyDecisionReceipt` is unchanged.
- The `sess` executable: `sess verify <file> --issuer <url> --keys <jwks.json>` prints a short
  summary (or `--json`), exits 0 valid, 1 invalid, 2 usage error, and makes no network calls.
- Verbatim receipt-v1 and bundle-v1 specifications in the source repository's `docs/spec/`, checked
  against the Sess copies.
- The README's first screen installs from npm (`@sess.si/sdk@next`), runs the quickstart and says what
  you'll see; it no longer describes installing a candidate tarball. Release status follows it.

## 0.1.0-rc.4 — 2026-10-14

Documentation and packaging only; the library source is unchanged from `0.1.0-rc.3`. The README's
first screen links the runnable plain-Node quickstart (only `SESS_API_KEY` needed; the human link is
printed before waiting) and points to this changelog and the registry's dist-tags for release status.

## 0.1.0-rc.3 — 2026-10-13

Unpublished R2 corrective candidate, now named `@sess.si/sdk` by the owner's superseding distribution decision. Earlier candidates and their recorded hashes retain their historical `@sess/sdk` identity; no alias is created. Inherit and validate polling operation budgets, dispose cancelled polling/backoff listeners, and match the runtime replay-key alphabet in transport and durable examples. Extend tracked-source and retained-history scanning with pinned tooling and synthetic controls.

## 0.1.0-rc.2 — 2026-10-13

Unpublished corrective candidate. Return actual verified-endpoint/redelivery bodies, restore display/interactive immutable Surface retrieval, count Unicode code points, reject nonprimitive replay options, and validate versioned durable-example checkpoints with credential-scope binding. Narrow array-item schema annotations to the runtime-supported subset.

## 0.1.0-rc.1 — Unreleased

- Compiled ESM JavaScript and declarations for the supported owner HTTP API.
- Exact-revision polling with explicit concurrency, retry and uncertain-write semantics.
- Offline and client-assisted full decision-receipt verification and raw-byte webhook verification.
- Form-authoring, durable continuation, webhook-inbox and CommonJS import examples.
- Reviewed public-contract snapshot, packed-consumer tests and protected OIDC release preparation.

This is a release candidate under review. No registry publication is implied.
