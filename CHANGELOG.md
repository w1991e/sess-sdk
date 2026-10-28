# Changelog

## Unreleased

- Commerce: bills as ordinary Surfaces, for Sess's `items` component. Sess takes no payment.
  `money(amount, currency)` checks a whole number of minor units (cents for USD, yen for JPY, fils
  for BHD) and an ISO 4217 code Sess accepts; it never rounds or converts. `items()` builds the
  component with its subtotal, total and amount due computed exactly from the rows, lines and
  payments, so Sess's arithmetic check passes. `invoice()`, `receipt()`, `quote()`, `refund()` and
  `purchaseOrder()` return an `interaction` for `sessions.create()`: the card, the document's
  reference in a record under a plain name, and the buttons Sess requires (Request changes
  whenever a quantity is editable). `refund()` states positive amounts under "Refund total" and
  never a negative total. `lintText()` finds Markdown pipe tables in text and says whether to send
  an items component or a record. Limits match Sess's and reject, never truncate: row name 80,
  detail 160, totals label 40, caption 200, rows 100, totals lines 8 (`ITEMS_LIMITS`); a refusal is
  a `SessError` with code `INVALID_SCHEMA`, outcome `not_sent`, and the value's JSON pointer in
  `field`. New types `ItemsComponent` and `ItemTotalRole` (`SurfaceComponent` includes items) and
  the Advanced `locale` on an interactive interaction. Session reads now accept an items component,
  and a 400 for too many rows or totals lines carries Sess's sentence.
- Every request names the SDK in its `User-Agent` header: `sess-sdk/<version> node/<version>`.
  The new client option `userAgent` puts a wrapping client's product tokens first, for example
  `userAgent: 'my-app/1.2.0'` sends `my-app/1.2.0 sess-sdk/0.1.0-rc.9 node/24.21.0`. A value that is
  not product tokens separated by single spaces (at most 256 characters) is a `configuration`
  error before anything is sent.
- A plan limit is a refusal, not an uncertain outcome. Sess answers a create over the workspace's
  plan with HTTP 429 `PLAN_LIMIT_REACHED`, and nothing is created. The SDK now reports it as
  `kind: 'api'`, `outcome: 'rejected'`, with `code`, `reason` (`monthly_allowance` or
  `active_sessions`), `status: 429` and, for `monthly_allowance`, `retryAfterMs` from
  `Retry-After` (time until the period resets); it is never retried. Before, it was
  `unknown_outcome` ("may have succeeded"). Any other 429 (no code, or `RATE_LIMITED`) is unchanged:
  transient, retried where retries are allowed, and uncertain for a write.
- The package ships compiled output only: no source maps (`*.js.map`, `*.d.ts.map`) or
  `sourceMappingURL` comments, and no `src/` TypeScript sources (every export and types path is in
  `dist/`). The generated wire types' JSDoc names Sess specifications instead of runtime-repository
  document paths. Every published package's packed bytes now pass a hygiene check (no maps,
  fixtures, non-public hosts, credential-shaped strings or internal references).

## 0.1.0-rc.8 — 2026-10-22 (prepared, unpublished)

- Link timing (Decision 0009 Amendment 10). On an interactive Sess link of 20 hours or less the
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
  reads again sooner but never ends the wait inside the grace). A live read never ends the wait. Without `link_state` the
  deadline stays final, as in rc.7.
- Contract snapshot from Sess runtime commit `2f8500e` (see `contract/contract-lock.json`). Besides link timing it carries what Sess master already
  describes: the interactive text limits with `field`, `limit` and `length` on a length error,
  `progress`, the receipt `format` and the renderer identities list. The generated wire types gain
  them; the SDK's public types and behavior in this change are link timing only.
- Renderer identities (Decision 0009 Amendment 13). A receipt's `surface.renderer_version` now
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
  `seq` and `iat`).
- Sess's length limits, in Unicode code points and never truncated: title 80, description 280,
  heading 60, field and option labels 60, field description 160, action label 24, record caption
  200, record key 40 and string value 200, text 4,000; at most 5 actions. The types' JSDoc gives each field its
  purpose, style and limit.
- `sess.ask()` checks them before anything is sent: `question` 80, `submit_label` 24, field
  labels and options 60 (were 200).
- A length error carries `field` (a JSON pointer), `limit` and `length` on `SessError`, from
  `sess.ask()` (`INVALID_QUESTION`) and from Sess (400 `INVALID_SCHEMA`), and its message is
  Sess's own fix. The README and the quickstart show catching it, shortening the value and asking again.
  Surfaces stored before these limits still read as before.

## 0.1.0-rc.7 — 2026-10-18 (prepared, unpublished)

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
