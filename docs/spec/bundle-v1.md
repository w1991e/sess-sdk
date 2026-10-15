# Sess decision bundle, version 1 (bundle-v1)

**Status:** published format. A bundle is a deliberate disclosure of one accepted decision that anyone can verify: the [receipt-v1](receipt-v1.md), the accepted record, and the issuer's public keys. This document is self-contained so that it can be copied verbatim into public distributions.

Exporting a bundle is a choice made by someone entitled to the record (with Sess hosted, the owner of the Session, through its owner credential). Whoever receives the bundle can read everything in it. Share it only with whom you mean to show the decision.

## 1. What a bundle contains, and what it never contains

A bundle contains **only**:

- the receipt-v1 compact JWS, exactly as issued;
- the accepted record: the complete normalized Surface document of the accepted revision and the complete validated input, as the receipt's hashes were computed over them;
- the issuer's public verification keys.

It never contains a private key, an owner credential, a management credential or a human link (the link is a capability), and it contains no data other than the above.

## 2. Format

A JSON object with exactly these members. Unknown, missing or mistyped members make the bundle `malformed`.

```json
{
  "type": "sess.decision-bundle",
  "version": 1,
  "receipt": "<receipt-v1 compact JWS>",
  "content": { "surface": { … }, "input": { … } },
  "keys": { "keys": [ { "kty": "OKP", "crv": "Ed25519", "x": "…", "kid": "…", "alg": "EdDSA", "use": "sig" } ] }
}
```

| Member | Value |
|---|---|
| `type` | `"sess.decision-bundle"` |
| `version` | `1` |
| `receipt` | the receipt, at most 32,768 characters |
| `content.surface` | JSON object: the Surface document whose RFC 8785 SHA-256 is the receipt's `surface.hash` |
| `content.input` | JSON object: the input whose RFC 8785 SHA-256 is the receipt's `input_hash` |
| `keys.keys` | at most 16 public Ed25519 JWKs with members `kty`, `crv`, `x`, `kid` and optionally `alg` (`EdDSA`) and `use` (`sig`); no other member, no duplicate `kid` |

The keys are disclosed for convenience (for example, to show which key signed). A verifier **never trusts them**: it verifies with keys it trusts itself (receipt-v1 §4).

## 3. Expected context

Who the verifier expects the decision to belong to is **application context**, and it comes only from the verifier's own trusted configuration, never from the bundle. The members a caller may supply are: `audience` (the expected `aud`), `workspace_id`, `session_id`, `event_id`, `revision` (the expected `surface.revision`) and `action_id` (the expected `action.id`). The trusted issuer and keys are always supplied by the caller.

A public verifier (one that has no application context, such as a hosted verification page) checks the receipt against its own declared, signed context only. It reports the context as `unchecked` and the application purpose as `unchecked`: the bundle is genuine, but whether it is the decision your application was waiting for is for your application to check.

## 4. Bounds

A bundle is at most 1,048,576 bytes as RFC 8785 canonical UTF-8 JSON, nested at most 32 levels deep, with at most 1,000 items in any array, 1,000 members in any object and 100,000 JSON values in total; its receipt is at most 32,768 characters and `keys.keys` holds at most 16 keys. A bundle beyond a bound is `oversized`. Values must have a JSON form (no non-finite numbers or lone surrogates); otherwise the bundle is `malformed`. An HTTP verifier may additionally refuse a request body above its own body limit (Sess: 2,097,152 bytes, `413 PAYLOAD_TOO_LARGE`).

## 5. Verification

Verification is offline and deterministic given the bundle, the trusted issuer, the trusted keys, the optional expected context and the verification time (default: the current time). The first failing step decides the reason:

1. **Shape and bounds** (§2, §4): `malformed`, `oversized`, or `unsupported_version` for an integer `version` above 1.
2. **Receipt** by the receipt-v1 rules (receipt-v1 §6) against the trusted issuer and keys. The expected audience is the caller's when supplied, else the receipt's own declared `aud`. The receipt-v1 codes are the reasons, except that an unreadable receipt is `receipt_malformed`: `algorithm`, `missing_kid`, `unknown_kid`, `type`, `signature`, `issuer`, `audience`, `expired`, `claims`.
3. **Not in the future:** `iat` later than the verification time plus 60 seconds is `not_yet_valid`.
4. **Complete content:** the canonical SHA-256 of `content.surface` must equal `surface.hash` (`surface_mismatch`) and that of `content.input` must equal `input_hash` (`input_mismatch`). A modified, partial or redacted record therefore never verifies.
5. **Expected context:** every supplied member must equal the receipt's (`context_mismatch`, listing the members that differ; an audience mismatch is already `audience` in step 2).

## 6. Result

Every face (library, CLI, public HTTP endpoint, browser page) reports the same result object:

| Member | Value |
|---|---|
| `valid` | `true` or `false` |
| `reason` | `null` when valid; otherwise one of `malformed`, `oversized`, `unsupported_version`, `receipt_malformed`, `algorithm`, `missing_kid`, `unknown_kid`, `type`, `signature`, `issuer`, `audience`, `expired`, `claims`, `not_yet_valid`, `surface_mismatch`, `input_mismatch`, `context_mismatch` |
| `checked_at` | the verification time, RFC 3339 UTC |
| `content` | `verified`, `mismatch`, or `not_checked` (an earlier step failed) |
| `context.status` | `verified` (every supplied member matched, including `audience`), `incomplete` (members matched but no `audience` was supplied), `mismatch`, `unchecked` (none supplied), or `not_checked` (an earlier step failed) |
| `context.checked` | the supplied members, in the order `audience`, `workspace_id`, `session_id`, `event_id`, `surface.revision`, `action.id` |
| `context.mismatches` | the members that differ, in the same order |
| `application_purpose` | `matched_caller_context` only when `context.status` is `verified`; otherwise `unchecked`. A public verifier always reports `unchecked`. |
| `actor` | `{"assurance": "link_holder"}` when valid, else `null` |
| `receipt` | when valid: `key_id`, `issuer`, `audience`, `event_id`, `session_id`, `workspace_id`, `step_id`, `surface`, `action`, `input_hash`, `accepted_at`, `expires_at`; else `null` |

A valid result means: this issuer accepted exactly this input, on exactly this revision of this interface, from someone holding the Session's human link, at `accepted_at`, and the receipt is unexpired at `checked_at`. It does not name or verify a person, does not show that the person understood the content, and is not evidence that anything was authorized or executed. The result presents no actor subject.

## 7. Conformance corpus

One corpus of positive and negative vectors is shared by every face. Its vectors are rebuilt deterministically from test-only Ed25519 keys whose 32-byte seeds are the SHA-256 of fixed, labelled strings (`"sess bundle-v1 corpus test key v1 current"`, `… previous`, `… retired`, `… stranger`); these keys are public by construction and must never be trusted outside tests. Each vector is frozen by the SHA-256 and byte length of its canonical bundle and of its receipt, with its expected result for a trusting caller (with the vector's expected context, at `2026-10-09T12:05:00Z`) and for a public verifier (no expected context, at the current time). It covers: valid bundles with full, partial and no context; a key-rotation overlap; a retired key; another key under the issuer's kid; tampered claims and signature; wrong issuer, algorithm (`none`, `HS256`), type and missing kid; non-canonical claims; wrong audience, workspace, Session, Event, revision and action; altered and redacted input; an altered Surface; expired and future receipts; malformed, private-key-bearing, unsupported-version and oversized (bytes, depth, array) bundles.

## 8. Versioning

A change to the members, the content definition or the verification steps is a new `version`. Verifiers report a later version as `unsupported_version`, never as valid or as malformed. Version 1 bundles stay verifiable as written, subject to receipt-v1 current-time expiry. A later collection or archival format may contain v1 bundles unchanged.
