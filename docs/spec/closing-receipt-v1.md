# Sess closing receipt, version 1 (closing-receipt-v1)

**Status:** implemented in `@sess/security` (`closing-receipts.ts`), `@sess/evidence` (`closing-core.ts`) and `@sess/db` (`closures.ts`, migration `1760001570000_session-closures`), slice 1 of [Decision 0016](../decisions/0016-whole-exchange-closing-receipt.md) ("the terminal expiry Event and the closing receipt"), and the checker's set match in `@sess/security` (`closing-check.ts`, §6.1), slice 2, and the kept file, [keep-v4](keep-v4.md) (`@sess/evidence` `keep.ts`; written only behind its switch, off by default), slice 3, and the server half of delivery through Events polling (§11; `apps/api` `closing-delivery.ts`), slice 5. Not yet delivered: the faces, webhooks and the SDK are later slices (Decision 0016 §4). Round receipts ([receipt-v1](receipt-v1.md)), bundles ([bundle-v1](bundle-v1.md)) and [archival-core-v1](archival-core-v1.md) are unchanged.

A closing receipt is the issuer's signed statement of how one Session ended and a list of scope-labelled commitments. Version 1 carries exactly one: `accepted_rounds`, how many rounds the Session accepted and one commitment over those rounds' receipts in order. It is issued only when the Session ended with at least one accepted round. Its claim, and the whole of it: **these are the final accepted rounds Sess signed for this Session.** It does not prove who answered, that a link was opened or seen, a page nobody answered, rejected attempts, drafts, what an agent did, anything about an Ask's respondents as a group, or independence from the issuer.

## 1. Encoding

A JWS in compact serialization (RFC 7515), as receipt-v1 §1, with one difference: the protected header is exactly `{"alg": "EdDSA", "kid": <key ID>, "typ": "sess-closing-receipt+jwt"}`. It is signed with the receipt key (receipt-v1 §4), so the same published key set and key history apply. The payload is the RFC 8785 canonical JSON of the claims; a payload in any other serialization is invalid even when its signature holds. A closing receipt is issued once and stored; it is never re-signed.

## 2. Claims

Every member is required and no other member is allowed. There is **no `exp`**: a closing receipt has no live use by an app and no live-use expiry.

| Claim | Value |
|---|---|
| `sess_closing_receipt` | `1`, the format version |
| `iss` | the issuer, as receipt-v1 |
| `aud` | the ID of the workspace the Session belongs to (equal to `workspace_id`) |
| `jti` | the closure ID, `cls_` and a ULID |
| `iat` | issuance, NumericDate (whole seconds of `issued_at`) |
| `workspace_id` | the Session's workspace |
| `session_id` | the Session |
| `terminal` | `{"event_id", "cause", "actor_class"}` (§4) |
| `effective_end_at` | when the terminal rule took effect, RFC 3339 UTC with milliseconds |
| `recorded_at` | when the database recorded the end |
| `issued_at` | when this receipt was signed |
| `commitments` | a list of scope-labelled commitments, each exactly `{"scope", "count", "commitment"}` (§3). Sess issues exactly one today: `{"scope": "accepted_rounds", "count": n, "commitment": "<base64url>"}`, `n` ≥ 1 |

The three times are kept apart and ordered: `effective_end_at` ≤ `recorded_at` ≤ `issued_at`. A late sweep has an earlier effective end and a later recording and issuance. Issuance is never backdated. `iat` is `issued_at` in whole seconds.

## 3. The commitments

`commitments` is a list of one to 16 entries. Each entry has exactly three members:

| Member | Value |
|---|---|
| `scope` | what the entry commits to: a plain, documented lowercase word (`[a-z][a-z0-9_]{0,63}`), never an internal name such as a table or column |
| `count` | how many items the commitment covers, a non-negative integer |
| `commitment` | the 32-byte SHA-256 over the scope's domain-separated bytes, base64url without padding (43 characters) |

Rules: the list is ordered by `scope` (code-point order) and a scope appears at most once; a version 1 closing receipt always contains `accepted_rounds`; each scope's commitment is computed in its own domain, whose tag names the version and the scope. A later scope (for example `published_pages`, the pages published that nobody answered) is a versioned addition: a new documented scope word with its own domain tag, added beside `accepted_rounds`, never a change to what `accepted_rounds` means. It does not upgrade old closures.

The one scope of version 1, **`accepted_rounds`**, counts the Session's accepted rounds (`count` = n, from 1 to 100,000), and its `commitment` is SHA-256 over:

```
UTF-8("sess.closing-commitment/v1/accepted_rounds") || 0x00 || uint32be(n) || d1 || … || dn
```

where `d1 … dn` are the 32-byte SHA-256 digests of the accepted rounds' receipts, **each over its exact compact-JWS ASCII bytes, signature included**, in the order the rounds were accepted (their Event sequence). A round receipt is hashed, never parsed: a receipt-v1 and a receipt-v2 enter alike.

**An unknown extra scope makes the whole receipt newer (ASTRA, 2026-11-16 22:56Z; the founder made it ASTRA's call at 23:03Z).** A verifier that meets a well-formed entry whose scope it does not know treats the whole closing receipt as **newer** than itself and releases nothing: not valid, not a `claims` failure, and no claims returned, not even the `accepted_rounds` entry it knows. The reason, in ASTRA's words: "An older checker cannot know whether an unknown signed scope constrains the meaning or completeness of a known scope. Per-scope partial verification becomes safe only if a versioned contract first proves scopes are semantically independent and the UI/API cannot present a partial result as the whole receipt." Nothing partial is ever presented as verified. This is the same rule as a receipt's newer envelope: a reader reports newer and releases no verified data until it is upgraded. A higher format version is treated the same way: a `sess_closing_receipt` that is a whole number above `1` is **newer** and releases nothing, since its members may constrain what version 1 would release (as a higher receipt `sess_revision`, ASTRA-1138-1); a version that is not a whole number of at least `1` stays `unsupported` (§6). For an unknown scope, `newer` is reported only for a receipt that passes every other check (a higher version is decided earlier, after the signature, issuer and audience checks and before the claims are read; §6); a missing `accepted_rounds`, a duplicate or out-of-order scope, a scope that is not a plain word, or an entry of another shape (including a negative count on an unknown scope) is still refused as `claims` (§6), because those are this format's own rules.

The count and the digests come from the Session's own accepted Events (its authoritative history): never from a filtered, suppressed, restricted or exported list. A custody restriction or deletion of a round's record does not remove it from the commitment.

## 4. Terminal causes and actor class

Every Session ends at most once, by exactly one of four causes; a later operation never gives it a second cause.

| `cause` | Recorded when | `terminal.event_id` | `actor_class` |
|---|---|---|---|
| `completed_by_owner` | the owner's `POST /v1/sessions/{id}/complete` | its `session.completed` Event | `owner` |
| `completed_by_ask_rule` | an Ask with `auto_complete` completes a respondent in the transaction that accepts its answer (Decision 0011 §1) | that `session.completed` Event | `owner` |
| `final_expiry` | the link's irreversible final expiry: its horizon while extensions remain, else its deadline, has passed | its `session.expired` Event | `sess` |
| `revoked` | an Ask's close revokes a respondent with no accepted answer | `null` (no Session Event) | `owner` |

The actor class is derived by the server from the cause, never supplied. A `revoked` respondent has no accepted round, so it never has a closing receipt; the cause is in the schema so that the structure is the same for every end.

**Final expiry** is its own Event, `session.expired`, written by Sess (`actor_assurance` `system`), with no action, data or receipt. It is never `session.completed`. It invents no input, sets no completion time, changes no Session status, writes no billing row and moves no retention deadline (Decision 0009 Amendment 7). A *lapsed* link (past its deadline with extensions left before its horizon) has not ended: it stays extendable and gets no closure (Amendment 10).

An owner's completion after a Session has ended (final expiry or revocation) is refused with `409 SESSION_ENDED` (founder 2026-11-16 22:39Z), whose body states the terminal cause in `reason` (`final_expiry` or `revoked`), and the end already reached stands. A completed Session is still refused with `409 SESSION_COMPLETED`.

## 5. When it is issued, and when not

- **One or more accepted rounds:** the closing receipt is sealed in the same transaction as the terminal transition when the receipt key is at hand. If it is not (no keyring configured), the end, its count and its ordered digests are fixed in that transaction and the receipt is sealed later from exactly those digests (delayed signing). A later seal never reads the round receipts or any other source again, so it can never cover a reduced set.
- **Zero accepted rounds:** the end is recorded with its cause and a count of zero, and no closing receipt is kept. This includes an owner's completion with zero responses, a final expiry with none and a revoked respondent.
- **Purge is not a fifth cause.** Under the Session's lock, before it deletes any source, purge observes the cause already recorded or records the applicable one: a Session with no end yet first reaches final expiry, its effective end being the earlier of its link's end and the purge's time. A completed or revoked Session keeps its cause. The closure survives the purge.
- **Cutover:** no closure is invented for a Session that ended (completion, revocation or final expiry) before migration `1760001570000` ran (`session_closure_cutover`). A reader treats a missing closure as "no closing record", never as "closed".
- Acceptance, extension and every terminal transition serialize under the Session's row lock: an acceptance or extension after the end is recorded is refused, so a closure never omits the final acceptance, and concurrent closers record one end.

## 6. Verification

A verifier accepts a closing receipt only if all of the following hold, and reports the first failure. Codes are receipt-v1 §6's, plus `unsupported` and `newer`. An accepted closing receipt is returned with its claims; any other result returns none.

| Code | Rejected when |
|---|---|
| `malformed` | not a compact JWS, or an unreadable header |
| `algorithm` | `alg` is anything but `EdDSA` |
| `missing_kid` / `unknown_kid` | no `kid`, or one the verifier does not trust |
| `type` | `typ` is not `sess-closing-receipt+jwt` (a round receipt offered as a closing receipt fails here). The reverse is refused too, by the round receipt verifier's own table ([receipt-v2](receipt-v2.md) §7): its `typ` is a Sess format that verifier does not know, so it is `newer`, checked before the key, and nothing is released (a bundle carrying it is `unsupported_version`); it is never a valid round receipt |
| `signature` | the signature does not verify |
| `issuer` / `audience` | not the expected issuer or workspace |
| `unsupported` | `sess_closing_receipt` is not a whole number of at least `1` (for example `0` or `1.5`). It never yields completeness |
| `claims` | a member is missing, extra (including `exp`) or mistyped; `aud` differs from `workspace_id`; the times are out of order or `iat` is not `issued_at`'s second; `commitments` is not a list of 1 to 16 entries of exactly `scope`, `count` and `commitment`, its scopes are not plain words in strictly increasing order, a count is not a non-negative integer or a commitment is not 43-character base64url; `accepted_rounds` is missing or its count is not 1 to 100,000; the actor class is not the cause's; `event_id` is null for a cause other than `revoked`, or not null for it; or the payload is not canonical |
| `newer` | `sess_closing_receipt` is a whole number above `1` (checked after the signature, issuer and audience, before the claims, whose shape a later version may change); or every check above passes but `commitments` carries a scope this verifier does not know (§3). Not valid and not a `claims` failure: the receipt is newer than the verifier, and nothing is released |

This checks the closing receipt alone. Matching a set of round receipts against it is the checker's set match (§6.1).

### 6.1 The checker's set match

`checkClosingSet` (`@sess/security`, `closing-check.ts`; Decision 0016 slice 2) takes a closing receipt, the round receipts present in the order a file carries them (each with a receipt v2's revision envelope and, when the file has them, the question and answer), and the caller's trusted issuer, workspace and key set. Trust comes only from the caller. It never throws for bad evidence, and it reports four separate results; none stands in for another:

| Result | What it says |
|---|---|
| `authenticity` | the closing receipt by §6, and each round receipt by the unchanged round verifier ([receipt-v1](receipt-v1.md) §6, [receipt-v2](receipt-v2.md) §7) at its own issuance time, so a round receipt's live `exp` never decides it |
| `set_match` | the receipts present are the final accepted-round set the closing receipt signs |
| `contents` | each round's question and answer are present and match its signed hashes |
| `independent_time` | a valid independent timestamp. This version takes no timestamp evidence (the closing core's witness is later work, §7), so it is always `missing` |

Each result has a `status`: `valid`; `invalid` (supplied evidence that fails); `missing` (nothing supplied); `unsupported` (a format, version or scope newer than the checker); or `unverifiable` (supplied evidence the checker cannot decide: a key the caller does not trust, or a result that depends on evidence that did not verify). Missing evidence is never reported as invalid, and invalid evidence never as missing.

The set match rebuilds the ordered digest vector from the exact compact-JWS bytes of the receipts present, signature included (§3), and never reads a list in the file: a manifest beside the receipts is not read. It is `valid` only when the closing receipt is valid, the receipts present are unique, their number is the signed `accepted_rounds` count, the rebuilt vector gives the signed commitment (so membership and order are exact), every round receipt is authentic, and each agrees with the closing receipt in its signed `iss`, `workspace_id` and `session_id`. Its reasons, in the order checked: `no_closing_receipt` (missing), `closing_receipt_newer` (unsupported), `closing_receipt_not_verified` (unverifiable), `round_malformed`, `duplicate`, `count`, `commitment`, `round_invalid`, `context` (each invalid), `round_newer` (unsupported), `round_unverifiable` (unverifiable). A closing receipt in a round's place is refused as `wrong_type`; a round receipt in the closing receipt's place is refused as `wrong_type` too (the `type` code of §6). A receipt v2 without its revision envelope is `missing`, with another envelope `invalid`.

`completeness` is derived from authenticity and set match alone: `complete` when the closing receipt is valid and the set match is valid; else `failed` when any of them is `invalid` (the shared failed-evidence result); else `unsupported` when any is `unsupported`; else `none`. A closing receipt of an unknown format version or commitment scope is `unsupported` and never yields `complete`. `complete` says nothing about contents or independent time: a readable exchange also needs `contents` valid, and an anchored claim needs `independent_time`.

## 7. The closing archival object

Its own object; archival-core-v1's schema is not widened.

`{"type": "sess.closing-core", "version": 1, "purpose": "sess.closing-custody", "issuer", "workspace_id", "session_id", "closure_id", "closing_receipt": {"typ": "sess-closing-receipt+jwt", "version": 1, "digest": "sha256:<hex>", "byte_length": n}, "issued_at"}`, all read from the closing receipt's own claims and its exact bytes (at most 8,192). The canonical core is at most 4,096 bytes. It is signed with the receipt key in its own domain, `UTF-8("sess.closing-core/v1") || 0x00 || JCS(core)`, as `{"type": "sess.signed-closing-core", "version": 1, "core", "signature": {"alg": "Ed25519", "kid", "value"}}`, so it never verifies as an archival core, a round receipt or a closing receipt. A pending witness job is written with every sealed closing receipt (`session_closure_witness_jobs`); executing it through the witness batches is later work.

## 8. Storage

`session_closures` holds one row per ended Session: the cause, the actor class, the terminal Event, the three times, the count, the ordered round digests, and, once sealed, the closing receipt, its digest, the `accepted_rounds` commitment exactly as signed, and its signed closing core. The `accepted_rounds` entry is stored as these scalar columns (count, digests, commitment), which its database checks constrain; the closing receipt's `commitments` list is built from them when it is sealed. A later scope gets its own columns with its own migration. It has no foreign key to `sessions`: purge never cascades to it. The facts never change; the seal is written once; deletion is refused except for the synthetic probe's own fixture cleanup.

## 9. Conformance corpus

`packages/security/test/fixtures/closing-corpus-vectors.ts` rebuilds the vectors deterministically from test-only Ed25519 keys whose 32-byte seeds are the SHA-256 of fixed, labelled strings (`"sess closing-receipt-v1 corpus test key v1 current"` and `… stranger`); they are public by construction and must never be trusted outside tests. `packages/security/test/fixtures/closing-receipt-v1-corpus.json` freezes each round receipt and each closing-receipt vector by the SHA-256 and byte length of its exact JWS, with its expected verification result, and the commitment of each ordered list of rounds. It covers valid receipts for three causes (one over a receipt-v1 and a receipt-v2-shaped round), a round receipt offered as a closing receipt, an `exp` member, a format version 2 (`newer`), 0 and 1.5 (`unsupported`), an extra `published_pages` scope (`newer`), a missing `accepted_rounds`, a duplicate scope, scopes out of order, a scope that is not a plain word, an entry with an extra member, a commitment not in base64url, a 43-character commitment whose last character is not canonical, 17 entries, a negative count on an unknown scope, an actor class not derived from the cause, a backdated issuance, a zero count, tampered payload and signature, another key under the issuer's kid, wrong issuer and audience, non-canonical JSON and `alg: none`; and commitments over one and three rounds, reordered, a middle round removed, the last round removed, a duplicated round, and v1 and v2 rounds together. Every face that later verifies closing receipts must reach the same results on these vectors.

## 10. Versioning

Any change to the claims, an existing scope's commitment, the canonicalization, the header or the algorithm is a new format with a new `sess_closing_receipt` value (and, for a commitment, a new version and domain tag); a version 1 verifier reports it as `newer` and releases nothing. A new scope in `commitments` is a versioned addition (§3), documented here with its word, its count and its domain tag; an older checker reports a receipt carrying it as `newer` and releases nothing (§3). Version 1 closing receipts stay verifiable as written.

## 11. Delivery

Decision 0016 slice 5 (WX-11), its server half. The owner receives the closing receipt in two places: the kept file (keep-v4, behind its switch) and the Event log, `GET /v1/sessions/{id}/events`.

- **Events polling.** The body carries `closing` (public schema `SessionClosing`) beside `events`, as `link_extensions` is: `{"typ": "sess-closing-receipt+jwt", "closure_id", "cause", "terminal_event_id", "accepted_rounds", "receipt"}`, where `receipt` is the sealed closing receipt's exact bytes and the other members are the facts it signs (§2, §4). It is never an Event and never an Event's `receipt` member, so a reader of round receipts never meets it in a round's place. `session.expired` stays out of `events` (the published Event types, and today's SDK, do not carry it); `terminal_event_id` names it.
- **When it is present.** Only once the closing receipt is sealed, and only when the body's `response.accepted` receipts are exactly the rounds the closure fixed, the same receipts in the same order (the kept file's rule, `closingDisclosable`; Decision 0016 §3 disposition 3, WX-08). Otherwise the member is absent and the body is exactly as before: an open Session, an end with zero accepted rounds, an end not sealed yet (delayed signing), a Session that ended before the cutover, a round without a stored receipt, and a stored value that is not a closing receipt. The read is scoped to the caller's workspace, as every Event log read; a purged Session, or one in another workspace, is not found.
- **Webhooks do not carry it.** The Session webhook message stays `response.accepted` only; the outbox enqueues nothing for a closure or for a terminal Event, and a redelivery is refused for any Event but an accepted response. Webhooks follow in a clean SDK version (C-52).
- Round receipts, their Events, the Session read and bundles are byte for byte as before (C-60, C-61).
