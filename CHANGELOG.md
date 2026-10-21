# Changelog

## 0.1.0-rc.8 — 2026-10-19 (prepared, unpublished)

Builds on `0.1.0-rc.7` below, which is published; the registry goes from `0.1.0-rc.7` to
`0.1.0-rc.8`. Every existing export is unchanged; runtime dependencies are unchanged.

### Link timing (Decision 0009 Amendment 10)

- On an interactive Sess link of 20 hours or less the
  person may ask for more time, up to ten times, never past a fixed horizon. Session reads carry
  `link_state` (`live`, `lapsed` or `expired`), `action_expires_horizon`, `extensions_used` and the
  `extensions` history; the Session log (`listEvents()`) lists the same records as
  `link_extensions`, beside the Events, whose shape is unchanged. New types `LinkState` and
  `LinkExtension`. These fields are checked when present; a runtime without link timing omits them
  and is read as before.
- `waitForResponse()` and `answer()` treat a lapsed link as still open: they keep waiting until the
  horizon and end with `wait_ended` `LINK_EXPIRED` only once a read shows the link expired (two
  seconds past its end on the runtime clock, or, when the end cannot be placed, such as a
  revocation, a later read at least the grace after the first expired read; a short `intervalMs`
  reads again sooner but never ends the wait inside the grace). A live read never ends the wait.
  Without `link_state` the deadline stays final, as in rc.7.
- Contract snapshot from Sess runtime commit `2f8500e` (w1991e/sess master, PR #431's merge commit;
  see `contract/contract-lock.json`). Besides link timing it carries what Sess master already
  describes: the interactive text limits with `field`, `limit` and `length` on a length error,
  `progress`, the receipt `format` and the renderer identities list. The generated wire types gain
  them; the SDK's public types and behavior change only where an entry here says so.

### Renderer identities on the issuer's signed list (Decision 0009 Amendment 13)

- A receipt's `surface.renderer_version` now
  verifies when it is an identity this release bundles (`sess-html-form-1`, `sess-html-form-2`;
  `BUNDLED_RENDERER_IDENTITIES`) or one on the issuer's renderer list whose signature verifies
  under the same trusted keys and issuer, so a later Sess page change needs no SDK update. Every
  receipt that verified before still verifies, offline, with no list.
- `verifyResponse()` (and so `sess.ask()`'s `answer()`) fetch the list from the API origin
  (`/.well-known/sess-renderer-identities.json`) only for an identity this release does not
  bundle. `verifyDecisionReceipt` takes it as `rendererIdentities`; `verifyRendererIdentities`
  verifies a list on its own. A forged, unsigned, re-typed, foreign or malformed list fails with
  `INVALID_RENDERER_LIST`; an identity on no verified list fails with `UNSUPPORTED_RENDERER`, as
  before. New types `RendererIdentitiesDocument`, `RendererIdentity` and `RendererList`.
  `ReceiptClaims`' `surface.renderer_version` is now `string`.
- Renderer list editions. A list carries a signed `seq` (its edition, higher in every later
  published edition) and `iat` (when that copy was signed); `verifyRendererIdentities` returns
  `{ seq, iat, identities }`. `newerRendererList` orders two authentic lists by `seq`, with
  containment as the cross-check, and refuses lists that disagree (`INVALID_RENDERER_LIST`);
  `BUNDLED_RENDERER_LIST` is the bundled edition 1, and a verified list must agree with it. An
  older list proves the identities it holds, never their absence: an identity it does not hold is
  `UNSUPPORTED_RENDERER`, never accepted by fallback. Each online verification fetches the list
  afresh (the endpoint is served `no-store`); nothing is cached.
- `sess verify --renderers <file>`: with the issuer's signed list (verified under `--keys` and
  `--issuer`; a list that does not verify exits 2), the bundle's renderer identity must be known
  or listed (otherwise invalid, exit 1). Without it, bundle verification is unchanged.
- The receipt-v1 specification copy is from Sess commit `a60ca69` (§10, renderer identities with
  `seq` and `iat`; Sess PR #444's merge commit).

### Archival verifier

- `@sess.si/sdk/archival`, a new subpath with the successor archival verifier:
  `verifyArchivalEnvelope` checks an archival envelope (the exact original receipt, the issuer's
  signed archival core and any witness evidence) offline against the receipt keys and witness anchors you trust, and reports
  independent dimensions (signature, contents, context, witness, key trust, live expiry) with the
  Sess core's reason codes. `presentArchivalVerification` maps them to the user-facing messages.
  `parseTrustedRoot` and `parseWitnessKeySet` read a Sigstore `trusted_root.json` and the issuer's
  witness key set into anchors. `checkWitnessAnchors` refuses an unusable anchor (a TSA certificate
  that is not DER, a log base URL that is not https, a witness key that is not ECDSA P-256 SPKI, a
  window that is not a date) with a `TypeError`; the verifier runs it on its `witnessAnchors`.
  `verifyDecisionReceipt`, `verifyDecisionBundle` and receipt-v1 behaviour are unchanged.
- `sess verify --archival <envelope.json> --keys <jwks.json>` with optional `--issuer`, context,
  `--content`, `--witness-root` and `--witness-keys`; exits 0 verified, 1 not verified, 2 usage
  error, and makes no network calls. `--renderers` applies to bundle verification only and is
  refused with `--archival` (exit 2).
- Verbatim archival-core-v1 and witness-evidence-v1 specifications, the archival-v1 corpus, the
  witness renewal vector and the recorded Sigstore staging run in the source repository, pinned by
  SHA-256 to one Sess commit (`a60ca69`, with receipt-v1 above) and checked by
  `npm run check:spec`.

## 0.1.0-rc.7 — 2026-10-18 (published 2026-10-18)

Includes everything in the unpublished 0.1.0-rc.6 below, which is not published on its own.

- Advanced: a link lifetime. `sessions.create()` and `sess.ask()` take an optional `expires_in`, in
  whole seconds from creation: from 30 up to your plan's link lifetime (Sess checks the ceiling).
  Values below 30 or not whole are refused before anything is sent. Absent: the plan's lifetime,
  as before.
- The create response carries the link's expiry as `action_expires_at`; `sess.ask()` handles expose
  it as `expiresAt`. Nothing moves it later: not reading, not completing.
- `waitForResponse()` (and `answer()`) observe the expiry. Once the runtime clock (the response's
  HTTP `Date`, else this machine's) is two seconds past `action_expires_at`, one final read decides:
  an answer accepted before the expiry is returned as the result; otherwise the wait ends with
  `wait_ended`, code `LINK_EXPIRED`. The SDK never completes a Session on its own.
- `ResponseMeta.serverDate`: the response's HTTP `Date`, when the runtime sends one.
- Contract snapshot from Sess runtime commit `b48e8e7` (see `contract/contract-lock.json`), with
  `expires_in`, `action_expires_at` on create and the target's `default_expires_in`.
- `@sess.si/sdk/qr` (S-07): `qr(url, { format: 'svg' | 'png' | 'terminal' })` draws a Sess link as a
  QR code locally (error correction level M, 4-module quiet zone, deterministic, no network call), and
  `printQr(url)` prints "Scan to answer on your phone" and the code on an interactive terminal only:
  never without a TTY, in CI or with `NODE_ENV=production`; `--no-qr` or `{ qr: false }` turn it off
  and `NO_COLOR` draws it without colour. The SVG is one exact tree with the accessible title "QR code
  for this Sess link". The encoder is the Sess renderer's, after Project Nayuki's QR Code generator
  (MIT; see NOTICE). No new dependency; every existing export is unchanged.

## 0.1.0-rc.6 — 2026-10-15

- `sess.ask({ question, fields })`: one question with simple typed fields (the MCP `sess_ask`
  shape). It validates locally, creates the Session once and returns its private link before
  waiting. `answer()` verifies the receipt and exact Surface, checks that the answer is still
  current, completes the Session and returns values typed from the field definitions and checked at
  runtime. New types `AskInput`, `AskField`, `AskAnswer`, `AskHandle`, `AskOptions` and
  `AskAnswerOptions`. Every existing export, `verifyDecisionReceipt` and the advanced API are
  unchanged.
- The README opens with `sess.ask()`; the full Surface API is under "Advanced", unchanged.
- Wording only: the README's guide list and closing note, and the `0.1.0-rc.3` entry below, no
  longer refer to internal processes or unreleased work.
- Wording only: the README, the package description and four error messages say "Sess" in plain
  sentences. The README drops the stale manual-refresh caveat (the hosted page now advances between
  rounds by itself) and notes that Sess supplies the trusted workspace for verification. Error
  `kind`, `code` and every other field are unchanged.

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

Unpublished corrective candidate, the first named `@sess.si/sdk`. Earlier candidates and their recorded hashes keep their historical `@sess/sdk` name; no alias is created. Inherit and validate polling operation budgets, dispose cancelled polling/backoff listeners, and match the runtime replay-key alphabet in transport and durable examples. Extend tracked-source and retained-history scanning with pinned tooling and synthetic controls.

## 0.1.0-rc.2 — 2026-10-13

Unpublished corrective candidate. Return actual verified-endpoint/redelivery bodies, restore display/interactive immutable Surface retrieval, count Unicode code points, reject nonprimitive replay options, and validate versioned durable-example checkpoints with credential-scope binding. Narrow array-item schema annotations to the runtime-supported subset.

## 0.1.0-rc.1 — Unreleased

- Compiled ESM JavaScript and declarations for the supported owner HTTP API.
- Exact-revision polling with explicit concurrency, retry and uncertain-write semantics.
- Offline and client-assisted full decision-receipt verification and raw-byte webhook verification.
- Form-authoring, durable continuation, webhook-inbox and CommonJS import examples.
- Reviewed public-contract snapshot, packed-consumer tests and protected OIDC release preparation.

This is a release candidate under review. No registry publication is implied.
