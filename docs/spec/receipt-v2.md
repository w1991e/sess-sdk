# Sess decision receipt, version 2 (receipt-v2)

**Status:** published format. Issued by the Sess runtime for every human response accepted from this version on. It is self-contained so that it can be copied verbatim into public distributions. [receipt-v1](receipt-v1.md) is unchanged: version 1 receipts issued before receipt v2 keep verifying exactly as written there. The formats that wrap a receipt v2 are [bundle-v2](bundle-v2.md), [keep-v2](keep-v2.md) and the archival envelope version 2 of [archival-core-v2](archival-core-v2.md).

A receipt is the issuer's signed statement of what it **accepted**: which revision of which interface was shown, which declared action was taken, and a hash of the validated input, by someone holding the human link, at a time. A receipt v2 also commits to the **revision envelope**: the record of how that revision was published (when, and by which of the owning workspace's API keys, under that key's label at the time). It is not proof of who that person is, that they understood the content, that anything was executed afterwards, or who runs the publishing key.

## 1. Encoding

A receipt is a JWS in compact serialization (RFC 7515): `BASE64URL(header) "." BASE64URL(payload) "." BASE64URL(signature)`.

- **Protected header:** exactly `{"alg": "EdDSA", "kid": <key ID>, "typ": "sess-receipt-2+jwt"}`. `alg` is EdDSA over Ed25519 (RFC 8037), the only algorithm. `kid` is 1–64 characters of `[A-Za-z0-9._-]` and names the issuer key that signed it. The `typ` names the version: `sess-receipt-2+jwt` is version 2 only, and `sess-receipt+jwt` is version 1 only.
- **Payload:** the RFC 8785 (JCS) canonical JSON of the claims, UTF-8. The signed payload bytes are exactly the canonical form; a payload in any other serialization is invalid even when its signature holds.
- **Signature:** Ed25519 is deterministic, so a receipt is issued once, in the transaction that accepts the response, stored, and redelivered byte for byte. It is never re-signed (not after a key rotation, and never into another version).

## 2. The revision envelope

The revision envelope is a JSON object with exactly these members. It is computed by the issuer from the stored revision; it is not a second stored copy.

```json
{ "sess_revision": 1,
  "session_id": "ses_…", "revision": 1,
  "surface_hash": "sha256:<hex>",
  "renderer_version": "sess-html-form-2",
  "published_at": "2026-11-08T03:40:00.123Z",
  "key_id": "key_…",
  "key_label": "Production agent",
  "grant_id": null }
```

| Member | Value |
|---|---|
| `sess_revision` | `1`, the envelope's own schema version. A member added later is a new `sess_revision`; the receipt version does not change for an envelope change |
| `session_id` | the Session, equal to the receipt's `session_id` |
| `revision` | the revision, equal to the receipt's `surface.revision` |
| `surface_hash` | `sha256:<hex>` of the revision's complete normalized Surface document (§4), equal to the receipt's `surface.hash` |
| `renderer_version` | the renderer identity the revision was recorded with, equal to the receipt's `surface.renderer_version` |
| `published_at` | when the revision was published, in the canonical form below |
| `key_id` | the non-secret ID of the API key of the Session's owning workspace that published the revision, or `null` |
| `key_label` | that key's label as it stood when the revision was published, or `null` exactly when `key_id` is `null` |
| `grant_id` | always `null` in this version of Sess; an identifier or `null` is accepted |

**`published_at` canonical form.** RFC 3339 UTC with exactly three fractional digits and a `Z`: `YYYY-MM-DDTHH:MM:SS.mmmZ`, as ECMAScript `Date.prototype.toISOString` writes it. The issuer stores publish times with microseconds; the envelope carries that time **truncated** (never rounded) to milliseconds. The stored microsecond value is not what is hashed. A `published_at` in any other form (other precision, an offset, an impossible date) makes the envelope invalid.

**`key_id` and `key_label`.** Both are set only when the revision was published with an API key of the Session's owning workspace, and both come from the issuer's own records at the moment of publishing, written with the revision and never changed. `key_label` is the integrator's own name for its key (0–64 characters, possibly empty): a key renamed later keeps its old label on the revisions it already published. For every other publisher (the issuer's own operator credential, a hosted agent host's credential, the issuer's synthetic probe, a hosted demo, an anonymous trial) and for revisions published before receipt v2, both are `null`: the envelope states what is known and claims nothing else. A key ID is never a secret and never the fingerprint of one.

Identifiers are 1–200 characters without whitespace or control characters and are never credentials.

## 3. Claims

Every member is required and no other member is allowed. The claims are receipt-v1's (receipt-v1 §2), unchanged in name, type and meaning, with `sess_receipt` equal to `2` and exactly one more member, `surface.revision_hash`.

| Claim | Value |
|---|---|
| `sess_receipt` | `2`, the format version |
| `iss` | the issuer: an https origin (Sess hosted: `https://api.sess.si`) |
| `aud` | the recipient: the ID of the workspace the Session belongs to |
| `jti` | the receipt ID: equal to `event_id` |
| `iat` | acceptance time, NumericDate (whole seconds) |
| `exp` | expiry, NumericDate; exclusive (§6) |
| `accepted_at` | acceptance time with milliseconds, RFC 3339 UTC (`2026-10-09T12:00:00.123Z`) |
| `workspace_id` | the Session's workspace (equal to `aud`) |
| `session_id` | the Session |
| `step_id` | `rev_<n>`: the Surface revision the response was accepted on |
| `event_id` | the accepted Event |
| `surface` | `{"revision": n, "hash": "sha256:<hex>", "renderer_version": string, "revision_hash": "sha256:<hex>"}`: the accepted revision, the hash of its complete normalized Surface document (§4), the renderer version, and the hash of its revision envelope (§4) |
| `action` | `{"id", "label", "summary"}`: the declared action taken, exactly as the revision declared it; `summary` is its declared intent or `""` |
| `input_hash` | `sha256:<hex>` of the complete validated input as accepted (§4) |
| `actor` | `{"assurance": "link_holder", "subject": "<workspace_id>:human_link:<session_id>"}` |
| `return_binding` | `{"recipient": <aud>, "return_channel_id": null}` |

`grant_id`, `key_id` and `key_label` are not claims: they are inside the committed envelope. `label` is 1–4000 characters; `summary` is 0–4000.

## 4. Hashes

`surface.hash`, `surface.revision_hash` and `input_hash` are `"sha256:"` followed by 64 lowercase hex characters of SHA-256 over the RFC 8785 canonical JSON (UTF-8) of the value:

- **Surface:** the complete normalized Surface document of the accepted revision as stored by the issuer, including its title, description, components, actions and response policy. Equal documents give equal hashes regardless of member order.
- **Revision envelope:** the complete envelope of §2, all nine members. `revision_hash` = SHA-256 of `JCS(envelope)`. The envelope's values are strings, integers and `null`, so its canonical form is its members sorted by name, each value written as JSON.
- **Input:** the complete validated input object the issuer accepted (field names to typed values).

A hash binds content only for someone who holds that content. It is not confidential: short or guessable content can be recovered from its hash. Treat receipts and envelopes as potentially sensitive.

## 5. Issuer and keys

As receipt-v1 §4, unchanged: the issuer publishes its verification keys as a JWK Set at `<iss>/.well-known/sess-receipt-keys.json`, and a verifier uses only keys it trusts (the published set from the issuer it expects, or keys configured out of band), never keys supplied alongside a receipt. A `kid` the verifier does not hold is a rejection. The expected issuer and audience come from the verifier's own configuration. The same keys sign receipts v1 and v2.

## 6. Expiry

As receipt-v1 §5, unchanged: `exp` is at least 720 hours after acceptance and, for a Session created with an owner key, no earlier than the latest time the Session's result can still be retrieved. `exp` itself is expired. Verification uses the current time by default.

## 7. Verification

A verifier dispatches on the protected header's `typ`: `sess-receipt+jwt` is verified by receipt-v1 §6, exactly as before (a revision envelope is not read for it); `sess-receipt-2+jwt` by the steps below. **A receipt v2 is verified only with its revision envelope**, supplied beside it by whoever holds the receipt: there is no signature-only path. A verifier accepts a receipt v2 only if all of the following hold, and reports the first failure:

| Code | Rejected when |
|---|---|
| `malformed` | it is not a compact JWS, or its header is unreadable |
| `algorithm` | `alg` is anything but `EdDSA` (including `none`) |
| `missing_kid` | there is no `kid` |
| `unknown_kid` | the verifier holds no trusted key with that `kid` |
| `type` | `typ` is neither `sess-receipt+jwt` nor `sess-receipt-2+jwt` (a wrapper of one version, such as bundle-v1, also refuses the other version's `typ` here) |
| `signature` | the signature does not verify (tampered header, payload or signature, or another key) |
| `issuer` | `iss` is not the expected issuer |
| `audience` | `aud` is not the expected recipient |
| `expired` | the verification time is at or after `exp` |
| `claims` | a claim is missing, extra or mistyped (including `sess_receipt` other than `2`, or a `surface` without `revision_hash`), `jti` differs from `event_id`, `return_binding.recipient` differs from `aud`, `actor.subject` is not scoped to `workspace_id`, or the payload is not the canonical form of its claims |
| `revision` | the revision envelope is missing (absent or `null`), is not exactly the §2 object with its member types and the canonical `published_at`, its SHA-256 (§4) differs from `surface.revision_hash`, or its `session_id`, `revision`, `surface_hash` or `renderer_version` differ from the receipt's `session_id`, `surface.revision`, `surface.hash` or `surface.renderer_version` |

A holder of the accepted content additionally checks that `surface.revision`, `surface.hash` and `input_hash` match it; bundle-v2 defines that check for a disclosed bundle.

After verification, the envelope's `key_label` and `published_at` say which of the owning workspace's keys published the round, under which label, and when. A face that shows a publisher shows it only from a verified envelope, never from any other source (a live lookup of a key's current name included). A receipt v1 has no envelope: it shows no publisher.

## 8. Assurance limits

As receipt-v1 §7, and also:

- `key_id` and `key_label` name a credential of the owning workspace and the integrator's own word for it, at publish time. They do not name or verify who operates that key, and a label is not an identity.
- A receipt v2 proves under which envelope its round was served. It never proves who answered or what they read.

## 9. Key rotation

As receipt-v1 §8, unchanged. Receipts are never re-signed.

## 10. Versioning and dependent formats

Any change to the claims, canonicalization, header or algorithm is a new format with a new `sess_receipt` value and `typ`; a change to the envelope's members is a new `sess_revision`. Version 1 and version 2 receipts stay verifiable as written. Nothing already issued is re-signed or migrated: a receipt v1 stays a receipt v1.

Whatever wraps a receipt carries its revision envelope and steps to version 2 (founder 2026-11-08 04:10Z and 04:25Z). The dispositions:

| Format | Disposition |
|---|---|
| bundle-v1 ([bundle-v1.md](bundle-v1.md)) | **versioned**: [bundle-v2](bundle-v2.md) carries a receipt v2 with its envelope; bundle-v1 stays as written for receipt v1 |
| kept conversation ([keep-v1.md](keep-v1.md)) | **versioned**: [keep-v2](keep-v2.md); every file made now is version 2 |
| archival envelope ([archival-core-v1.md](archival-core-v1.md)) | **versioned**: archival envelope version 2 with a `revision_envelope` member ([archival-core-v2.md](archival-core-v2.md)); the archival core's members are unchanged and its receipt reference accepts `{"typ": "sess-receipt-2+jwt", "version": 2}` |
| evidence export (`sess.evidence-export`, the owner's `POST /v1/evidence/export`) | **versioned**: version 2; each record gains `revision_envelope` |
| webhook delivery (`response.accepted`) | no version member: a receipt v2's message carries `revision_envelope` beside `receipt` |

Readers accept versions 1 and 2. A version-2 wrapper without its envelope is refused with `revision`.

**Cut-over.** One release boundary: receipt v2 is issued from the deploy that also ships every v2 reader (the verifier, the SDK, `/verify`, bundle, keep, archival, export and the PDF), so no face meets a receipt v2 it cannot read. There is no separate issuance switch. Once the first receipt v2 exists, no rollback may remove v2 reader support from any face.

## 11. Renderer identities

As receipt-v1 §10, unchanged. The envelope's `renderer_version` equals the receipt's `surface.renderer_version`.
