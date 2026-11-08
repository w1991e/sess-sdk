# Sess decision bundle, version 2 (bundle-v2)

**Status:** published format. A bundle is a deliberate disclosure of one accepted decision that anyone can verify: a [receipt-v2](receipt-v2.md), the revision envelope it commits to, the accepted record, and the issuer's public keys. This document is self-contained so that it can be copied verbatim into public distributions. [bundle-v1](bundle-v1.md) is unchanged and remains the format of a receipt v1; every bundle of a receipt v2 is version 2.

Exporting a bundle is a choice made by someone entitled to the record (with Sess hosted, the owner of the Session, through its owner credential). Whoever receives the bundle can read everything in it. Share it only with whom you mean to show the decision.

## 1. What a bundle contains, and what it never contains

A bundle contains **only**:

- the receipt-v2 compact JWS, exactly as issued;
- the revision envelope the receipt commits to (receipt-v2 §2), exactly as the issuer computed it;
- the accepted record: the complete normalized Surface document of the accepted revision and the complete validated input, as the receipt's hashes were computed over them;
- the issuer's public verification keys.

It never contains a private key, an owner credential, a management credential or a human link (the link is a capability), and it contains no data other than the above. The envelope's `key_id` is a non-secret key ID and its `key_label` the integrator's own name for that key.

## 2. Format

A JSON object with exactly these members. Unknown members, and mistyped members other than `revision_envelope`, make the bundle `malformed`; a `revision_envelope` that is absent, `null` or not the receipt-v2 §2 object is `revision` (§5).

```json
{
  "type": "sess.decision-bundle",
  "version": 2,
  "receipt": "<receipt-v2 compact JWS>",
  "revision_envelope": { "sess_revision": 1, "session_id": "…", "revision": 1, "surface_hash": "sha256:…", "renderer_version": "…", "published_at": "…", "key_id": "…", "key_label": "…", "grant_id": null },
  "content": { "surface": { … }, "input": { … } },
  "keys": { "keys": [ { "kty": "OKP", "crv": "Ed25519", "x": "…", "kid": "…", "alg": "EdDSA", "use": "sig" } ] }
}
```

| Member | Value |
|---|---|
| `type` | `"sess.decision-bundle"` |
| `version` | `2` |
| `receipt` | the receipt v2, at most 32,768 characters |
| `revision_envelope` | the revision envelope of receipt-v2 §2. A bundle-v2 without it (or with `null`) is refused with `revision` (§5), never verified without it |
| `content.surface` | JSON object: the Surface document whose RFC 8785 SHA-256 is the receipt's `surface.hash` |
| `content.input` | JSON object: the input whose RFC 8785 SHA-256 is the receipt's `input_hash` |
| `keys.keys` | at most 16 public Ed25519 JWKs with members `kty`, `crv`, `x`, `kid` and optionally `alg` (`EdDSA`) and `use` (`sig`); no other member, no duplicate `kid` |

The keys are disclosed for convenience. A verifier **never trusts them**: it verifies with keys it trusts itself (receipt-v2 §5).

## 3. Expected context

As bundle-v1 §3, unchanged: who the verifier expects the decision to belong to comes only from the verifier's own trusted configuration (`audience`, `workspace_id`, `session_id`, `event_id`, `revision`, `action_id`), never from the bundle. A public verifier reports the context and the application purpose as `unchecked`.

## 4. Bounds

As bundle-v1 §4, unchanged: at most 1,048,576 bytes as RFC 8785 canonical UTF-8 JSON, nested at most 32 levels deep, at most 1,000 items in any array, 1,000 members in any object and 100,000 JSON values in total; the receipt at most 32,768 characters; at most 16 keys. Beyond a bound: `oversized`. A value with no JSON form: `malformed`.

## 5. Verification

Verification is offline and deterministic given the bundle, the trusted issuer, the trusted keys, the optional expected context and the verification time (default: the current time). A verifier reads versions 1 and 2: a version 1 bundle by bundle-v1 §5, exactly as before; a version 2 bundle by these steps. The first failing step decides the reason:

1. **Shape and bounds** (§2, §4): `malformed`, `oversized`, or `unsupported_version` for an integer `version` above 2.
2. **Receipt** by the receipt-v2 rules (receipt-v2 §7) against the trusted issuer and keys, **with the bundle's `revision_envelope`**. The expected audience is the caller's when supplied, else the receipt's own declared `aud`. A bundle-v2 holds a receipt v2 only: a receipt v1 inside it (or a receipt v2 inside a bundle-v1) is `type`. The receipt codes are the reasons, except that an unreadable receipt is `receipt_malformed`: `algorithm`, `missing_kid`, `unknown_kid`, `type`, `signature`, `issuer`, `audience`, `expired`, `claims`, `revision`. A missing or `null` envelope, an envelope that is not exactly the receipt-v2 §2 object, or one whose digest is not the receipt's `surface.revision_hash`, is `revision`.
3. **Not in the future:** `iat` later than the verification time plus 60 seconds is `not_yet_valid`.
4. **Complete content:** the canonical SHA-256 of `content.surface` must equal `surface.hash` (`surface_mismatch`) and that of `content.input` must equal `input_hash` (`input_mismatch`).
5. **Expected context:** every supplied member must equal the receipt's (`context_mismatch`).

## 6. Result

The result object of bundle-v1 §6, with these differences for a version 2 bundle:

- `reason` may also be `revision`;
- a valid result's `receipt.surface` also carries `revision_hash`, and `receipt` also carries `revision_envelope`: the envelope as verified.

A valid version 1 bundle's result is exactly bundle-v1's. A valid result means what bundle-v1 §6 says, and also: this revision was published as the envelope states, when it states, by the API key it names under the label it names (or by no API key, when `key_id` is `null`). A face that shows the publisher shows only the verified envelope's `key_label` and `published_at`.

## 7. Conformance corpus

The bundle-v2 corpus sits beside bundle-v1's (`packages/security/test/fixtures/bundle-v2-corpus.json`, rebuilt by `bundle-v2-corpus-vectors.ts` from the same labelled test-only Ed25519 seeds as bundle-v1 §7; these keys are public by construction and must never be trusted outside tests). Each vector is frozen by the SHA-256 and byte length of its canonical bundle and of its receipt, with its expected result for a trusting caller (with the vector's expected context, at `2026-10-09T12:05:00Z`) and for a public verifier. It covers: valid bundles with full and no context and with an envelope that names no key; a missing and a `null` envelope; an envelope naming another key, another label, no key, another time, a grant, an extra member and a non-canonical time; cross-version vectors (a receipt v1 in a bundle-v2, a receipt v2 under the v1 `typ`, a receipt v2 in a bundle-v1); tampered claims; altered input and Surface; a wrong audience; an expired receipt; and a later bundle version. bundle-v1's own "unsupported version" vector names version 3.

## 8. Versioning

A change to the members, the content definition or the verification steps is a new `version`. Verifiers report a later version as `unsupported_version`, never as valid or as malformed. Version 1 and 2 bundles stay verifiable as written, subject to their receipt's current-time expiry.
