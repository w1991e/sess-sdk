# Sess archival core v1

**Status:** implemented in `packages/evidence` (P2-13 slice R-V1). Not yet published in the SDK. The successor interface is selected through the existing release discipline.
**Build contract:** Decision 0009 Amendment 2; ASTRA #200 §2 C1/C5/C6 and §3 V1, V2, V4, V5.

The archival core is the issuer's immutable, signed statement that it holds one issued **receipt-v1** compact JWS in custody. It records the receipt's exact bytes, its acceptance bindings and the committed workspace sequence of its custody record. It does not change receipt-v1. Existing clients keep receiving the original JWS string, and `verifyDecisionReceipt` and the in-repository `verifyReceipt` keep their contract, including current-time expiry.

## 1. Archival core object

A JSON object with exactly these members. Unknown, missing or mistyped members are rejected.

| Member | Value |
|---|---|
| `type` | `"sess.archival-core"` |
| `version` | `1` |
| `purpose` | `"sess.receipt-custody"`, the explicit signed purpose |
| `issuer` | the receipt's `iss` |
| `workspace_id` | the receipt's `workspace_id` |
| `event_id` | the receipt's `event_id`, which equals its `jti` |
| `receipt` | `{"typ": "sess-receipt+jwt", "version": 1, "digest": "sha256:<hex>", "byte_length": n}`. `digest` is the SHA-256 of the exact compact-JWS ASCII bytes. `byte_length` is their length, at most 32,768. |
| `accepted_at` | the receipt's `accepted_at`: the issuer's asserted acceptance time, RFC 3339 UTC with milliseconds |
| `workspace_sequence` | positive integer; the committed per-workspace custody sequence (§4) |
| `bindings` | `{"target": R, "capability": R, "owner": R}`, where each `R` is `null` or `{"id": string, "version": positive integer}`. Each value is an immutable version that the server bound at admission. `null` states explicitly that the acceptance had no such binding. In this release no versioned target, capability or owner record exists, so all three are `null`. |

Identifiers are 1–200 characters with no whitespace or control characters. The canonical core is at most 4,096 bytes.

The core contains **no** witness or preservation evidence, holder or claim mapping, private key, actor subject or other actor identifier. Its only identifiers are the tenant and event identifiers the receipt already carries. These bytes are sensitive: custody protects them under tenant-scoped access, and this format makes no confidentiality claim for hashes or labels.

## 2. Canonical bytes and signature

- **Canonical bytes:** RFC 8785 JCS of the core, the same canonicalization receipt-v1 uses (`canonicalJson` in `@sess/security`). Custody stores exactly this text.
- **Signing domain:** the signed bytes are `UTF-8("sess.archival-core/v1") || 0x00 || JCS(core)`. A JWS signing input is base64url text and a dot and never contains `0x00`. So a receipt-v1 signature never verifies as a core signature, and a core signature never verifies as a receipt. Type separation also appears inside the bytes (`type`, `version`, `purpose`).
- **Algorithm:** pure Ed25519 (`"alg": "Ed25519"`), signed with the receipt keyring's active key. The `kid` names the key. Rotation works as it does for receipts. A dedicated archival key can be introduced later under its own kid.
- **Signed core object:** `{"type": "sess.signed-archival-core", "version": 1, "core": <core>, "signature": {"alg": "Ed25519", "kid": <kid>, "value": <base64url, 64 bytes>}}`.

## 3. Archival envelope

`{"type": "sess.archival-envelope", "version": 1, "receipt": <exact original JWS>, "signed_core": <signed core>, "evidence": [...]}`, at most 65,536 bytes.

`evidence` holds detachable preservation evidence, each entry bound to the core from outside it. The defined type is witness evidence version 1 (`sess.witness-evidence`, [`witness-evidence-v1.md`](witness-evidence-v1.md), R-V2b), which custody attaches once a receipt is witnessed. An empty array means the witness is **pending** (the receipt is unanchored). A non-object or malformed entry is **invalid**. An entry of any other type or version is **unsupported**. A supplied proof is never treated as an ordinary pending state. Removing the evidence changes only the witness dimension.

The envelope is not signed as a whole. Each part carries its own proof.

## 4. Custody record (`receipt_custody`)

One row per issued receipt holds the exact JWS, the core text, its digest and signature, the asserted acceptance time, the actual preservation time and the origin (`acceptance` or `backfill`).

- **Atomic write:** at acceptance the row is written in the transaction of the accepted Event and its outbox job, together with a pending witness job. If custody fails, the acceptance rolls back. Witness execution comes later and can never roll an acceptance back.
- **Identity:** the identity is the issuer plus the event ID. An event ID is also unique on its own.
- **Workspace sequence:** a counter row advanced in the same transaction, so a rollback allocates nothing and committed numbers have no gaps. It orders issued records in this custody scope only. Alone it is not evidence of a complete history (C7).
- **Purge independence:** Session/Event purge and retention purge never delete or change a custody row. Purge defers a Session that still holds a receipt not yet in custody. Only the isolated synthetic probe's fixture cleanup deletes its own workspace's rows.
- **Backfill:** receipts issued before custody are preserved later, never re-signed. The asserted acceptance time stays as issued, and `preserved_at` records the actual, later preservation time. A receipt whose signature fails under a key the issuer holds, or whose claims do not match its Event, is not preserved. A receipt under a rotated-out key is preserved as it is, and verifiers report its key as untrusted.

### 4a. Exception custody (`receipt_custody_quarantine`)

A receipt that can never be preserved as verified evidence is kept in exception custody instead: its exact original bytes, their SHA-256 digest, the Event/Session/workspace, the acceptance time, a reason and the quarantine time. The reasons are:
- `signature_invalid`: the signature fails under a key the keyring still holds;
- `event_mismatch`: the claims do not match the accepted Event;
- `malformed`;
- `custody_deferral_expired`: custody could not run, for example because no signer was configured or every attempt failed transiently, before the bounded deferral expired.

The bounded deferral is `CUSTODY_DEFERRAL_MAX_MS`, 7 days past the Session's purge deadline.

Exception custody gets no archival core, no signature, no witness job, and no verified result from any verifier. Like custody, it is immutable, except for synthetic-fixture cleanup.

Once a receipt is in custody or exception custody, its Session's ordinary payload follows its existing retention. A refused or delayed receipt never becomes an indefinite hold on unrelated payload (ASTRA #221 V-01).

## 5. Successor archival verifier

`verifyArchivalEnvelope(envelope, trustedKeys, {now, content, context, keySetObservedAt, witness})` runs offline. It never trusts keys, witness anchors or context from the envelope. It reports independent dimensions, each as `{status, reason}`:

| Dimension | Statuses and reasons |
|---|---|
| `signature` (schema and both signatures) | `valid: verified`. `invalid: malformed, oversized, wrong_type, core_signature, receipt_digest_mismatch, receipt_signature, receipt_malformed, core_receipt_mismatch`. `unsupported: unknown_version, unsupported_algorithm`. `unverifiable: untrusted_key`. The receipt-v1 signature and claims are checked by the unchanged receipt-v1 verifier at the receipt's own issuance time. |
| `contents` | `valid: verified`. `invalid: content_mismatch, content_malformed, content_oversized`. `unverifiable: content_unavailable` (no content supplied; this is unavailable to the check, not proven deleted). |
| `context` (trusted caller) | `valid: verified` (all supplied members match, including issuer and audience). `invalid: mismatch`. `unverifiable: unchecked, incomplete`. |
| `witness` | `witnessed: verified` (with `witnessed_at`, the TSA time: an upper bound on existence), `pending: unwitnessed` (no evidence: unanchored), `indeterminate: witness_trust_unavailable / untrusted_witness_key / untrusted_tsa / unknown_log / renewal_lapsed`, `invalid: malformed_evidence / invalid_evidence` (with a `detail`), `unsupported: unsupported_evidence`. Witness evidence is verified against the caller's `witness` anchors only (an independently distributed trusted root and the issuer's witness key set), never against anything in the envelope; see [`witness-evidence-v1.md`](witness-evidence-v1.md) §5. |
| `key_trust` | `valid: trusted`, `unverifiable: unknown_kid / not_evaluated`. The key set is always caller-supplied, and its observation time is echoed back. |
| `live_expiry` | `valid: unexpired`, `invalid: expired`. This is the same `exp` rule that receipt-v1 verification applies at the current time. |

When `signature` is not valid, every later dimension is `unverifiable: signature_unverified`.

**Presentation** (`presentArchivalVerification`) shows the four user-facing messages only when the signature and key trust are valid and nothing supplied contradicts them:

- `signature_verified`, always shown first;
- then `contents_verified` or `contents_unavailable`;
- plus `application_context_unchecked` unless the context is verified.

A signature, content or context failure yields no message and a `refusal` naming the dimension and reason. Witness status and live expiry are shown beside the messages, never folded into them. A verified result attests that the issuer held these exact bytes. It is not execution authority, not named-human proof and not a witnessed time.

## 6. Versioning

Any change to members, canonicalization, domain tag or algorithm is a new `version` with a new domain tag (`sess.archival-core/v2`). Verifiers report an unknown version as `unsupported`, never as invalid or valid. Version 1 objects stay verifiable as written.

## 7. Corpus

`packages/evidence/test/fixtures/archival-corpus-vectors.ts` rebuilds the vectors deterministically on every run. Their test-only Ed25519 keys take their 32-byte seed from the SHA-256 of a fixed, labelled string (`"sess archival-core corpus test key v1"` and a stranger key), so they are public by construction and must never sign anything outside tests. Ed25519 signatures are deterministic, so every receipt, core and envelope is rebuilt byte for byte. `packages/evidence/test/fixtures/archival-v1-corpus.json` freezes them without committing any token-shaped string. It holds the claims inputs, the expected results and, for each vector, the SHA-256 and byte length of the exact input, receipt JWS and canonical core. The test checks each rebuilt vector against those digests before verifying it. It covers positive and negative vectors with expected dimension results and messages: tampered core, wrong domain, wrong type, unknown version, unsupported algorithm, malformed, oversized, mismatched original digest, failing receipt signature, untrusted key, content and context mismatches, expired-for-live-use and witness evidence states. It also holds a frozen receipt-v1 vector whose receipt-v1 verification, including current-time expiry, must stay unchanged. Every face that later implements this verifier (SDK, CLI, public POST, browser) must reach the same results on these vectors.
