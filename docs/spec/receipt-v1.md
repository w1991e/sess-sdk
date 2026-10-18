# Sess decision receipt, version 1 (receipt-v1)

**Status:** published format. Issued by the Sess runtime for every accepted human response. This document describes the claims actually issued and the rules verifiers apply. It is self-contained so that it can be copied verbatim into public distributions; the bundle format that discloses a receipt with its content is [bundle-v1](bundle-v1.md).

A receipt is the issuer's signed statement of what it **accepted**: which revision of which interface was shown, which declared action was taken, and a hash of the validated input, by someone holding the human link, at a time. It is not proof of who that person is, that they understood the content, or that anything was executed afterwards.

## 1. Encoding

A receipt is a JWS in compact serialization (RFC 7515): `BASE64URL(header) "." BASE64URL(payload) "." BASE64URL(signature)`.

- **Protected header:** exactly `{"alg": "EdDSA", "kid": <key ID>, "typ": "sess-receipt+jwt"}`. `alg` is EdDSA over Ed25519 (RFC 8037), the only algorithm. `kid` is 1–64 characters of `[A-Za-z0-9._-]` and names the issuer key that signed it.
- **Payload:** the RFC 8785 (JCS) canonical JSON of the claims, UTF-8. The signed payload bytes are exactly the canonical form; a payload in any other serialization is invalid even when its signature holds.
- **Signature:** Ed25519 is deterministic, so a receipt is issued once, stored, and redelivered byte for byte. It is never re-signed (not after a key rotation either).

## 2. Claims

Every member is required and no other member is allowed.

| Claim | Value |
|---|---|
| `sess_receipt` | `1`, the format version |
| `iss` | the issuer: an https origin (Sess hosted: `https://api.sess.si`) |
| `aud` | the recipient: the ID of the workspace the Session belongs to |
| `jti` | the receipt ID: equal to `event_id` |
| `iat` | acceptance time, NumericDate (whole seconds) |
| `exp` | expiry, NumericDate; exclusive (§5) |
| `accepted_at` | acceptance time with milliseconds, RFC 3339 UTC (`2026-10-09T12:00:00.123Z`) |
| `workspace_id` | the Session's workspace (equal to `aud`) |
| `session_id` | the Session |
| `step_id` | `rev_<n>`: the Surface revision the response was accepted on |
| `event_id` | the accepted Event |
| `surface` | `{"revision": n, "hash": "sha256:<hex>", "renderer_version": string}`: the accepted revision, the hash of its complete normalized Surface document (§3) and the renderer version |
| `action` | `{"id", "label", "summary"}`: the declared action taken, exactly as the revision declared it; `summary` is its declared intent or `""` |
| `input_hash` | `sha256:<hex>` of the complete validated input as accepted (§3) |
| `actor` | `{"assurance": "link_holder", "subject": "<workspace_id>:human_link:<session_id>"}` |
| `return_binding` | `{"recipient": <aud>, "return_channel_id": null}` |

Identifiers are 1–200 characters without whitespace or control characters and are never credentials. `label` is 1–4000 characters; `summary` is 0–4000.

## 3. Hashes

`surface.hash` and `input_hash` are `"sha256:"` followed by 64 lowercase hex characters of SHA-256 over the RFC 8785 canonical JSON (UTF-8) of the value:

- **Surface:** the complete normalized Surface document of the accepted revision as stored by the issuer, including its title, description, components, actions and response policy. Equal documents give equal hashes regardless of member order.
- **Input:** the complete validated input object the issuer accepted (field names to typed values).

A hash binds content only for someone who holds that content. It is not confidential: short or guessable content can be recovered from its hash. Treat receipts as potentially sensitive.

## 4. Issuer and keys

- The issuer publishes its verification keys as a JWK Set at `<iss>/.well-known/sess-receipt-keys.json`: `{"keys": [{"kty": "OKP", "crv": "Ed25519", "x", "kid", "alg": "EdDSA", "use": "sig"}, …]}`. It contains public keys only.
- A verifier uses keys it **trusts**: the published set fetched from the issuer it expects, or keys configured out of band. It never trusts keys supplied alongside a receipt, and a `kid` it does not hold is a rejection: there is no fallback key.
- The expected issuer and audience come from the verifier's own configuration. The audience is the workspace the verifier expects the decision to belong to (Sess returns it as `Sess-Workspace-Id` on authenticated Session create and read).

## 5. Expiry

`exp` is at least 720 hours after acceptance. For a Session created with an owner key it is no earlier than the latest time the Session's result can still be retrieved (its human link's expiry plus its retention after it ends). A receipt is valid only while the verification time is before `exp` (`exp` itself is expired). Verification uses the current time by default. receipt-v1 defines no archival or historical validity: an expired receipt is reported as expired.

## 6. Verification

A verifier accepts a receipt only if all of the following hold, and reports the first failure:

| Code | Rejected when |
|---|---|
| `malformed` | it is not a compact JWS, or its header is unreadable |
| `algorithm` | `alg` is anything but `EdDSA` (including `none`) |
| `missing_kid` | there is no `kid` |
| `unknown_kid` | the verifier holds no trusted key with that `kid` |
| `type` | `typ` is not `sess-receipt+jwt` |
| `signature` | the signature does not verify (tampered header, payload or signature, or another key) |
| `issuer` | `iss` is not the expected issuer |
| `audience` | `aud` is not the expected recipient |
| `expired` | the verification time is at or after `exp` |
| `claims` | a claim is missing, extra or mistyped, `jti` differs from `event_id`, `return_binding.recipient` differs from `aud`, `actor.subject` is not scoped to `workspace_id`, or the payload is not the canonical form of its claims |

A holder of the accepted content additionally checks that `surface.revision`, `surface.hash` and `input_hash` match it; bundle-v1 defines that check for a disclosed bundle.

## 7. Assurance limits

- `actor.assurance` is `link_holder`: someone in possession of the Session's human link acted. A link can be forwarded and can have several holders. A receipt never names or verifies a person.
- `actor.subject` is scoped to one workspace and one Session. There is no global actor identifier, and subjects cannot be correlated across workspaces.
- A receipt attests the issuer's accepted record. It is not authorization to execute anything and not evidence that anything was executed. Webhook transport signatures are separate from receipts.

## 8. Key rotation

The issuer signs with one active key and keeps publishing retired public keys for an overlap. A retired key remains in the published set for longer than the longest receipt lifetime after it stopped signing (Sess hosted: more than 1,440 hours), so every unexpired receipt keeps verifying. After the overlap its receipts fail with `unknown_kid`. Receipts are never re-signed.

## 9. Versioning

Any change to the claims, canonicalization, header or algorithm is a new format with a new `sess_receipt` value and `typ`. Version 1 receipts stay verifiable as written.

## 10. Renderer identities

`surface.renderer_version` names how the issuer showed the accepted revision to the person (Decision 0009 Amendment 13). Each revision records the identity it renders under, and every receipt accepted on it binds that identity. The issuer publishes the identities it signs receipts under at `<iss>/.well-known/sess-renderer-identities.json`:

- one JWS signed with a receipt key of §4, in the RFC 7515 flattened JSON serialization `{"protected", "payload", "signature"}` (joined with `.` they are its compact form);
- its protected header is `{"alg": "EdDSA", "kid", "typ": "sess-renderer-identities+jwt"}`;
- its payload is the RFC 8785 canonical JSON `{"identities": [{"renderer_version": string, "since": "YYYY-MM-DD"}, …], "iss": <iss>, "sess_renderer_identities": 1}`, where `since` is the UTC date the identity was added.

The list only grows: an identity is never removed, reordered or reused, so every receipt ever issued keeps verifying. `sess-html-form-1` is always on it.

A verifier that checks `surface.renderer_version` accepts a value on a list it holds whose signature verifies under its trusted keys for the expected issuer (§4), with `typ` exactly `sess-renderer-identities+jwt` and `iss` the expected issuer. A list supplied alongside a receipt is never trusted on its own: it is accepted only through that signature. A verifier may also bundle the identities known at its release. The receipt format, its claims and its signature are unchanged.
