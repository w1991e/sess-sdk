# Sess witness evidence v1

**Status:** implemented in `packages/evidence/src/witness/` (P2-13 slice R-V2b), the runtime witness worker in `apps/api/src/witness.ts` and the witness outbox in `packages/db` (migration `1760000920000_witness-attach.sql`); the published witness key set (§5.1) and the renewal worker (§6.1) in slice R-V2c (`apps/api/src/witness-renewal.ts`, migration `1760000960000_witness-renewal.sql`). Not yet published in the SDK. **Production witness writes are not configured:** they begin only after the production qualification and the recorded privacy assessment (Decision 0009 Amendment 2), with the production hosts pinned by a reviewed change to the P2 assignment's witness egress allowlist (§7).
**Build contract:** P2 assignment §7.2 vault slice 3 (R-V2b); ASTRA #200 §2 C3 and §3 V2; the R-V2a result in [`witness-spike-result.md`](witness-spike-result.md), whose format family and algorithm this version pins.

Witness evidence is the detachable preservation evidence of one receipt's signed archival core ([`archival-core-v1.md`](archival-core-v1.md)). It shows that the exact signed core existed no later than a time stated by an independent time-stamping authority, and that a commitment to it was publicly logged, without disclosing the core or anything about its tenant.

## 1. Commitment and batch

Each signed archival core is committed with a fresh, private 256-bit nonce:

`commitment = SHA-256(UTF-8("sess.witness.leaf/v1") || 0x00 || nonce || SHA-256(JCS(signed core)))`

The commitment covers the signed bytes (core and Ed25519 signature). Commitments of one issuer's receipts are shuffled, padded with random dummy leaves to a power of two (at least 2, at most 4,096) and hashed into an RFC 6962 tree (`0x00` leaf and `0x01` node prefixes). The public tree size reveals only a size bucket.

The **opening** of one member is private and travels with its receipt:

`{"type": "sess.witness-opening", "version": 1, "signed_core_digest": "sha256:<hex>", "nonce": <base64, 32 bytes>, "leaf_index": n, "tree_size": n, "path": [<base64, 32 bytes>, ...]}`

## 2. Checkpoint

`UTF-8("sess.witness.checkpoint/v1") || 0x00 || JCS({"type": "sess.witness-checkpoint", "version": 1, "issuer", "batch", "tree_size", "root": "sha256:<hex>"})`

It names the receipt issuer, the issuer's batch number, the padded size and the root, and nothing else. It is signed with **ECDSA P-256 / SHA-256** (DER) under the issuer's **dedicated witness key**. Receipt and archival-core keys (Ed25519) never sign a checkpoint. Every attempt signs afresh; ECDSA signatures are randomized, so a retry is a distinct log entry.

## 3. Timestamp and log

- **Timestamp:** an RFC 3161 token over **SHA-256 of the checkpoint signature's DER bytes**, with a 64-bit nonce and `certReq`.
- **Log:** a Sigstore `hashedrekord` entry (Rekor v2 `0.0.2` preferred, v1 `0.0.1` accepted) holding SHA-256 of the checkpoint bytes, the signature and the witness public key. The checkpoint bytes themselves are never sent anywhere. Public entries carry the aggregate root's digest and signing material only.

## 4. Evidence entry

An entry of the archival envelope's `evidence` array. Exactly these members, at most 24,576 bytes of canonical JSON:

| Member | Value |
|---|---|
| `type` | `"sess.witness-evidence"` |
| `version` | `1` |
| `opening` | §1 |
| `checkpoint` | `{"bytes", "signature", "public_key"}`: base64 of the exact checkpoint bytes, the DER signature and the witness key's SPKI DER |
| `timestamp` | `{"token"}`: base64 DER TimeStampToken |
| `tlog` | the log entry in the Sigstore bundle `TransparencyLogEntry` shape: canonicalized body, RFC 6962 inclusion proof and signed log checkpoint (and Rekor v1's inclusion promise, reported separately, never as inclusion) |
| `renewals` | the archive timestamp chain (§6), oldest first; at most 8 |
| `trust_reference` | `{"source", "tuf_root_version", "trusted_root_digest"}`: where the attaching worker's trusted root came from. **Informational only; verification never uses it.** |

All members of one batch share the checkpoint, token and log entry; only the opening differs.

## 5. Verification and outcomes

`verifyWitnessEvidence(entry, signedCore, anchors, now)` runs offline. Its anchors come from the trusted caller only: an independently distributed trusted root (the TSAs and logs, e.g. the TUF-distributed Sigstore `trusted_root.json` checked against a pinned root) and the issuer's published witness key set with validity windows. Nothing in the entry is trusted on its own.

It checks, in order: the opening opens these exact signed-core bytes to a root; the checkpoint is version 1, states that root, size and issuer, and is signed by a trusted witness key; the token covers SHA-256 of that signature and chains to a trusted TSA (imprint, CMS signed attributes, ESS certificate binding, signature, chain, critical timeStamping EKU, genTime within the certificates' and the authority's validity); the log entry is exactly this checkpoint's `hashedrekord`, included under a trusted log's signed checkpoint; the witness and log keys were valid at genTime; the renewal chain (§6); and that the last link's validity has not lapsed at `now`.

| Outcome | Meaning |
|---|---|
| `witnessed` | Every part verifies. `witnessedAt` is the TSA genTime: **an upper bound** on when the signed core existed, stated at the TSA's precision (Sigstore's: whole seconds, so it can read earlier than a millisecond acceptance time within the same second). `validUntil` is how long the chain can be relied on. |
| `invalid` | A supplied part is malformed (`malformed_evidence`) or fails a check (`opening`, `checkpoint_malformed`, `checkpoint_signature`, `checkpoint_root_mismatch`, `timestamp`, `tlog`, `outside_validity`, `renewal`). **Never pending.** |
| `indeterminate` | Well formed, but historical trust cannot be established: no anchors supplied (`witness_trust_unavailable`), the witness key, TSA or log is not trusted (`untrusted_witness_key`, `untrusted_tsa`, `unknown_log`: a wrong or rotated-out root or key set), or the chain lapsed (`renewal_lapsed`). |
| `unsupported` | Another evidence version. |

In the successor archival verifier (`verifyArchivalEnvelope(..., {witness: anchors})`) the `witness` dimension is: `pending: unwitnessed` with no evidence (the receipt is **unanchored**); otherwise `invalid` if any entry is malformed or fails (`malformed_evidence`, or `invalid_evidence` with a `detail`), else `witnessed: verified` with `witnessed_at` (the earliest), else `indeterminate` with its reason, else `unsupported: unsupported_evidence` (only unknown types). The spike's version 0 proof is an unknown type. The other dimensions and receipt-v1 are unchanged.

### 5.1 Published witness key set

`GET /.well-known/sess-witness-keys.json` (API host; public, no credential; the receipt key set's headers: `Cache-Control: no-store, no-transform`) serves the issuer's witness keys in the form `verifyWitnessEvidence` takes as its `witnessKeys` anchor:

`{"type": "sess.witness-key-set", "version": 1, "issuer": <receipt issuer>, "keys": [{"key_id": "sha256:<hex>", "key_details": "PKIX_ECDSA_P256_SHA_256", "spki": <base64 SPKI DER>, "valid_from": <RFC 3339>, "valid_to": <RFC 3339 or null>}, ...]}`

- Exactly these members; at most 32 keys. `key_id` is SHA-256 of the SPKI DER, as each witnessed batch records its key.
- The **current** key comes first with `valid_to: null`. **Rotation** retires the old key with its **closed window** (`SESS_WITNESS_VERIFY_KEYS`), and the set keeps it, newest first, so evidence it signed stays verifiable. A key verifies a checkpoint only when the TSA time lies inside its window (otherwise `invalid: outside_validity`); a key the set no longer lists leaves its evidence `indeterminate: untrusted_witness_key`.
- **Public material only:** every key is re-derived as SPKI before it is written; a private key can never be serialized into the set.
- The set is read from the key variables alone, independently of the provider, so evidence stays verifiable while the worker is disabled. **One validated key configuration** feeds both the published set and the workers' anchors: it is checked when loaded against everything the set enforces (at most 32 keys in total, current plus retained; P-256 public keys; no repeats; valid, ordered windows; times RFC 3339 can state). Nothing is ever trimmed.
- Without a witness key the set is published with `keys: []`. A configured but unusable key set (for example 33 keys) disables the witness and renewal workers before either can write, is logged at startup naming the variable only, and makes the route answer `503 SERVICE_UNAVAILABLE`, never an empty set in place of the configured keys.
- `parseWitnessKeySet(json, issuer?)` (`@sess/evidence/witness`) reads it strictly into anchors. A verifier combines it with an independently distributed trusted root; it is never taken from an evidence entry.

## 6. Renewal (RFC 4998 model)

A token is relied on only while its TSA chain is valid. Before that chain's notAfter, a **renewal** token is obtained over **SHA-256 of the previous token's exact DER bytes** (RFC 4998 §5.2 timestamp renewal) and appended as `{"type": "sess.witness-renewal", "version": 1, "hash_alg": "sha256", "token"}`. One renewal request renews a whole batch, whose members share the token. The chain verifies when each renewal is a valid token from a trusted TSA over the previous token, no earlier than it, and obtained **no later than the previous token's validity end**. A renewal obtained after the previous token lapsed cannot rescue it (`indeterminate: renewal_lapsed`). The witness time stays the first token's genTime.

The executable approach is `renewalTarget`, `renewWitnessEvidence` and `verifyRenewalChain`, with a committed binary test vector (`packages/evidence/test/fixtures/witness/renewal-vector.der`, SHA-256 pinned in `witness-renewal.test.ts`): a chain renewed in time, an unrenewed chain past its TSA's lapse, a late renewal and a renewal over other bytes. Hash-tree renewal (a new hash algorithm over the data and the previous chain, RFC 4998 §5.2) is not defined in version 1; it is the planned path should SHA-256 weaken, as a new evidence version.

### 6.1 Renewal worker (R-V2c)

- **Schedule:** every witnessed batch (also one an older artifact completed) gets one renewal schedule, holding its token chain's validity end, verified against the worker's TUF-verified trusted root. A token that does not verify there is recorded `unverifiable` and never renewed.
- **Due:** a configured, bounded lead time before the validity end (`SESS_WITNESS_RENEWAL_LEAD_MS`, default 30 days, 1 hour to 180 days). Per batch: one renewal request renews every member.
- **Attempt:** under a lease (`SESS_WITNESS_RENEWAL_LEASE_MS`, default 60 s, at least 20 s); claim is idempotent (`FOR UPDATE SKIP LOCKED`), so concurrent workers obtain one renewal. It obtains one token over the chain's last token from the provider's TSA, appends it to every member's evidence and verifies each renewed entry offline against the trusted root and the published key set before storing anything. A crashed attempt is taken over with a new attempt once its lease expires; the stale owner can neither complete, fail nor lapse it.
- **Completion:** one transaction, only while the attempt is held, writes every member's renewed evidence (an immutable row per renewal; a receipt's evidence is then its latest renewed evidence) and advances the schedule to the new validity end. A renewal that does not extend the validity end (the same TSA chain) is not attached.
- **Retries:** the witness worker's backoff (exponential with jitter from `SESS_WITNESS_RETRY_BASE_MS`, capped at `SESS_WITNESS_RETRY_MAX_MS`), never before a provider's `Retry-After`: the cap bounds only the backoff. Retries continue until the validity end.
- **Lapse:** a chain whose validity end passes unrenewed is marked `lapsed` without contacting the TSA. A renewal token obtained after the validity end is **never attached**: the chain is marked `lapsed` (outcome `renewal_lapsed`), and verifiers report `indeterminate: renewal_lapsed` after that end. Lapsed is terminal.
- **Bound:** at most 8 renewals per chain. After the eighth the schedule is `limit_reached` and the chain lapses at its validity end unless a later evidence version (hash-tree renewal) is defined.
- **Fail closed and telemetry:** the worker runs only when the witness is enabled (provider, witness key and verified trust) and renews nothing otherwise. Metrics (`sess.witness.renewal`, `sess.witness.renewal.backlog`) carry counts and bounded outcome names, never a token, key or content.

## 7. Witness outbox and worker

- **Atomic outbox:** a pending witness job is written with custody in the acceptance (or backfill) transaction. The acceptance makes no witness network call and never depends on the witness. Exception-custody (quarantined) receipts have no job and are never witnessed. The synthetic probe's receipts are never batched.
- **Job states:** `pending` → `batched` → `witnessed`, with `failed_retryable` after a definite failure and `indeterminate` after an uncertain one (the provider may have logged without a proof in hand: never success). A job that is not witnessed is **unanchored**, never invalid.
- **Batches:** short and bounded: a batch of one issuer is cut when it holds `batchMax` (default 256, at most 1,024) due jobs or when its oldest has waited the batch delay (default 60 s). Formation locks its jobs, so no receipt is in two active batches.
- **Attempts:** under a lease (default 120 s, at least 40 s: two 10-second exchanges with margin); each signs a fresh checkpoint with the current witness key, timestamps it, logs it and verifies every member's evidence offline before storing anything. An expired lease (a crashed attempt) is taken over with a new attempt; the stale owner can neither complete nor fail it.
- **Completion:** one transaction, only while the attempt is held, writes every member's evidence (an immutable table referencing custody), the batch's witness time, key, log URL and index, and the jobs' `witnessed` state and witness time. A repeated or stale completion writes nothing.
- **Retries:** bounded (default 8 attempts) with exponential backoff and jitter (base 30 s, cap 1 h), never before a provider's `Retry-After`. The cap bounds only the backoff; a `Retry-After` beyond it is kept. An exhausted batch is released: its jobs return to `pending` after the cooldown (default 1 h), **and never before the batch's scheduled next attempt** (so a provider's `Retry-After` survives the release, including the cleanup of a crashed final attempt), and are re-committed in a new batch with fresh nonces.
- **Fail closed:** without a supported provider configuration, the dedicated witness key (`SESS_WITNESS_SIGNING_KEY`, ECDSA P-256 PKCS#8, with `SESS_WITNESS_SIGNING_KEY_VALID_FROM`) or the pinned TUF root (`SESS_WITNESS_TUF_ROOT`) the worker witnesses nothing and receipts stay pending. Without verified trust an attempt is handed back unspent.
- **Key rotation:** retained public keys (`SESS_WITNESS_VERIFY_KEYS`, with closed validity windows) are published beside the current key (§5.1); an in-flight batch completes under the rotated key on its next attempt.
- **Trust:** the last TUF-verified trusted root and signing configuration are persisted; refreshes are periodic (default daily), never roll back, and an outage keeps the last verified trust in force.
- **Visible backlog:** the `sess.witness.backlog` metric and the ops summary's `witness` block report counts per state, active batches and the oldest unwitnessed age. No content.
- **Egress:** the provider reaches only its configuration's exact origins, HTTPS on 443, through the witness egress transport (`apps/api/src/witness-egress.ts`): DNS checked public and pinned, no redirect followed, one deadline for the whole exchange including DNS, a response bound. Only Sigstore staging is configured; production hosts need the reviewed pin.

## 8. Staging qualification

`apps/api/scripts/witness-staging-attach.ts` runs the attachment path once against Sigstore **staging**, through the runtime's witness egress transport, trust source, attempt and verifier, with synthetic receipts and ephemeral keys, and writes nothing to disk. Its run on 2026-10-15 at 08:37Z:

- TUF refreshed from the pinned staging root v1 to v15, with the same trusted-root and signing-config digests as the spike;
- one TSA token (200, 417 ms) and one Rekor v2 entry (`global.rekor.sigstage.dev`, 201, 2.0 s, log index 6083556) for a batch of 3 in a tree of 4;
- all three envelopes verified offline as `witnessed`, at a witness time of 08:37:41Z;
- one renewal token (200, 188 ms), and the renewed evidence verified as `witnessed` with the same witness time;
- 23 exchanges, all to the four staging origins; each evidence entry was 5,245 bytes.

This qualifies the format and the runtime egress against staging only. Production hosts, roots, quotas and the privacy assessment remain prerequisites (Decision 0009 Amendment 2).

## 9. Versioning

Any change to the domains, members, algorithms or renewal rules is a new version with new domain tags. Version 0 (the R-V2a spike formats, `sess.witness-spike.*`) stays readable for the recorded staging run but is never produced by the worker, and a version 0 part never verifies inside version 1 evidence.
