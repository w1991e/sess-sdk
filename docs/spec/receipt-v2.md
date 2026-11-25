# Sess decision receipt, version 2 (receipt-v2)

**Status:** published format. Read and verified by every Sess face from the readers release on; issued by the Sess runtime for every human response accepted from the issuance release on (see §10, Cut-over). It is self-contained so that it can be copied verbatim into public distributions. [receipt-v1](receipt-v1.md) is unchanged: version 1 receipts issued before receipt v2 keep verifying exactly as written there. The formats that wrap a receipt v2 are [bundle-v2](bundle-v2.md), [keep-v2](keep-v2.md) and the archival envelope version 2 of [archival-core-v2](archival-core-v2.md).

A receipt is the issuer's signed statement of what it **accepted**: which revision of which interface was shown, which declared action was taken, and a hash of the validated input, by someone holding the human link, at a time. A receipt v2 also commits to the **revision envelope**: the record of how that revision was published (when, by which of the owning workspace's API keys, from which registered address or Ask, and under which titles its owner chose). It is not proof of who that person is, that they understood the content, that anything was executed afterwards, or who runs the publishing key.

## 1. Encoding

A receipt is a JWS in compact serialization (RFC 7515): `BASE64URL(header) "." BASE64URL(payload) "." BASE64URL(signature)`.

- **Protected header:** exactly `{"alg": "EdDSA", "kid": <key ID>, "typ": "sess-receipt-2+jwt"}`. `alg` is EdDSA over Ed25519 (RFC 8037), the only algorithm. `kid` is 1–64 characters of `[A-Za-z0-9._-]` and names the issuer key that signed it. The `typ` names the version: `sess-receipt-2+jwt` is version 2 only, and `sess-receipt+jwt` is version 1 only.
- **Payload:** the RFC 8785 (JCS) canonical JSON of the claims, UTF-8. The signed payload bytes are exactly the canonical form; a payload in any other serialization is invalid even when its signature holds.
- **Signature:** Ed25519 is deterministic, so a receipt is issued once, in the transaction that accepts the response, stored, and redelivered byte for byte. It is never re-signed (not after a key rotation, and never into another version).

## 2. The revision envelope

The format is frozen (founder 2026-11-17 15:25Z; DOCS/research/2026-11-16/receipt-v2-optional-members.md §0.1 and §0.14). The revision envelope is a JSON object with **ten common members**, then **exactly one** of `titles` (the full form) or `titles_digest` (the compact form). It is computed by the issuer from the stored revision; it is not a second stored copy.

```json
{ "sess_revision": 2,
  "revision": 1, "session_id": "ses_…",
  "surface_hash": "sha256:<hex>",
  "renderer_version": "sess-html-form-2",
  "published_at": "2026-11-08T03:40:00.123Z",
  "key_id": "key_…",
  "grant_id": null,
  "agent_target": { "id": "tgt_…", "version": 3, "name": "bike-shop" },
  "ask_id": null,
  "titles": { "nonce": "<22 characters>", "grant_title": null,
              "target_title": "Example bike shop", "owner_name": null } }
```

| Member | Value |
|---|---|
| `sess_revision` | `2`, the envelope's own schema version. A change to the members is a new `sess_revision`; the receipt version does not change for an envelope change. The nine-member `sess_revision: 1` shape was never issued and is not read |
| `revision` | the revision, equal to the receipt's `surface.revision` |
| `session_id` | the Session (`ses_…`), equal to the receipt's `session_id` |
| `surface_hash` | `sha256:<hex>` of the revision's complete normalized Surface document (§4), equal to the receipt's `surface.hash`; the page includes every field schema's title and description |
| `renderer_version` | the renderer identity the revision was recorded with, equal to the receipt's `surface.renderer_version` |
| `published_at` | when the revision was published, in the canonical form below |
| `key_id` | the responsible owner key (`key_…`), or `null` |
| `grant_id` | a Session grant (`sgr_…`), or `null` |
| `agent_target` | `{"id": "tgt_…", "version": <whole number ≥ 1>, "name": <the address>}`, the registered address the Session was started from as at Start, or `null`. It carries no title. `name` follows the share-name rule (3 to 40 characters, a lowercase slug) |
| `ask_id` | the Ask (`ask_…`) a respondent's Session belongs to, or `null` |
| `titles` | the full form: exactly `{"nonce", "grant_title", "target_title", "owner_name"}`. `nonce` is 16 random bytes drawn once at publish, unpadded base64url (22 characters). Each title is 1 to 60 code points, trimmed, with no control character, or `null`; `grant_title` is `null` exactly when `grant_id` is, and `target_title` is `null` when `agent_target` is |
| `titles_digest` | the compact form: the unpadded base64url (43 characters) of the SHA-256 of the UTF-8 RFC 8785 canonical JSON of `titles` |

Every file a person keeps (bundle, kept file, PDF data, archival envelope) carries the full form; a QR code carries the compact form. An envelope with both `titles` and `titles_digest`, or neither, or any other member at either level, is invalid and releases nothing. **No key label is in the envelope** or in any other portable artefact: the issuer keeps it server-side, for the owner's own views only.

**`published_at` canonical form.** RFC 3339 UTC with exactly three fractional digits and a `Z`: `YYYY-MM-DDTHH:MM:SS.mmmZ`, as ECMAScript `Date.prototype.toISOString` writes it. The issuer stores publish times with microseconds; the envelope carries that time **truncated** (never rounded) to milliseconds. The stored microsecond value is not what is hashed. A `published_at` in any other form (other precision, an offset, an impossible date) makes the envelope invalid.

**`key_id`.** Set only when the revision was published with an API key of the Session's owning workspace, from the issuer's own records at the moment of publishing, written with the revision and never changed. For every other publisher (the issuer's own operator credential, a hosted agent host's credential, the issuer's synthetic probe, a hosted demo, an anonymous trial) it is `null`: the envelope states what is known and claims nothing else. A key ID is never a secret and never the fingerprint of one.

**"Asked by."** A face shows the most specific owner-chosen title of a verified full-form envelope: `titles.grant_title`, else `titles.target_title`, else `titles.owner_name`, else no row. A compact form shows no title.

Identifiers are 1–200 characters of `[A-Za-z0-9_-]` with their prefix and are never credentials.

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

`grant_id`, `key_id`, `agent_target`, `ask_id` and the titles are not claims: they are inside the committed envelope. `label` is 1–24 code points in a receipt v2 (the create-time cap, part of the v2 guarantee: founder 2026-11-17 15:29Z item 2; a longer one is not a valid receipt v2); `summary` is 0–4000.

## 4. Hashes

`surface.hash`, `surface.revision_hash` and `input_hash` are `"sha256:"` followed by 64 lowercase hex characters of SHA-256 over the RFC 8785 canonical JSON (UTF-8) of the value:

- **Surface:** the complete normalized Surface document of the accepted revision as stored by the issuer, including its title, description, components, actions and response policy. Equal documents give equal hashes regardless of member order.
- **Revision envelope:** the envelope of §2 in its compact form: ten common members plus `titles_digest`. A full form is first normalised by removing `titles` and adding `titles_digest` computed from it (§2). `revision_hash` = SHA-256 of `JCS(compact envelope)`, so the full and the compact form of one revision give the same hash. The envelope's values are strings, integers, `null` and two nested objects of those.
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
| `newer` | `typ` names a Sess format this verifier does not know (`sess-<name>+jwt`, such as `sess-receipt-3+jwt` or a closing receipt), checked before the key; or, after the claims, the revision envelope's `sess_revision` is a whole number above `2`. Nothing is released; a viewer reports it as newer, never as a failure |
| `type` | `typ` is neither `sess-receipt+jwt` nor `sess-receipt-2+jwt` nor newer (a wrapper of one version, such as bundle-v1, also refuses the other version's `typ` here) |
| `signature` | the signature does not verify (tampered header, payload or signature, or another key) |
| `issuer` | `iss` is not the expected issuer |
| `audience` | `aud` is not the expected recipient |
| `expired` | the verification time is at or after `exp` |
| `claims` | a claim is missing, extra or mistyped (including `sess_receipt` other than `2`, a `surface` without `revision_hash`, or an `action.label` over 24 code points), `jti` differs from `event_id`, `return_binding.recipient` differs from `aud`, `actor.subject` is not scoped to `workspace_id`, or the payload is not the canonical form of its claims |
| `revision` | the revision envelope is missing (absent or `null`), is not exactly the §2 object (ten common members and exactly one of `titles` or `titles_digest`, with their member types and the canonical `published_at`; a key label is refused), its SHA-256 (§4) differs from `surface.revision_hash`, or its `session_id`, `revision`, `surface_hash` or `renderer_version` differ from the receipt's `session_id`, `surface.revision`, `surface.hash` or `surface.renderer_version` |

A holder of the accepted content additionally checks that `surface.revision`, `surface.hash` and `input_hash` match it; bundle-v2 defines that check for a disclosed bundle.

After verification, the envelope says when the round was published, by which of the owning workspace's keys, from which registered address or Ask, and under which titles. A face that shows "Asked by" shows only a verified full-form envelope's most specific title (§2), never anything from another source (a live lookup of a current name included). A receipt v1 has no envelope: it shows no such line.

## 8. Assurance limits

As receipt-v1 §7, and also:

- `key_id` names a credential of the owning workspace, and the titles are the owner's own words, at publish time. They do not name or verify who operates that key or who anyone is: names are chosen by the owner, and Sess does not check them.
- A receipt v2 proves under which envelope its round was served. It never proves who answered or what they read.

## 9. Key rotation

As receipt-v1 §8, unchanged. Receipts are never re-signed.

## 10. Versioning and dependent formats

Any change to the claims, canonicalization, header or algorithm is a new format with a new `sess_receipt` value and `typ`; a change to the envelope's members is a new `sess_revision`. Version 1 and version 2 receipts stay verifiable as written. Nothing already issued is re-signed or migrated: a receipt v1 stays a receipt v1.

Whatever wraps a receipt carries its revision envelope and steps to version 2 (founder 2026-11-08 04:10Z and 04:25Z). The dispositions:

| Format | Disposition |
|---|---|
| bundle-v1 ([bundle-v1.md](bundle-v1.md)) | **versioned**: [bundle-v2](bundle-v2.md) carries a receipt v2 with its envelope; bundle-v1 stays as written for receipt v1 |
| kept conversation ([keep-v1.md](keep-v1.md)) | **versioned**: [keep-v2](keep-v2.md); a file is version 2 exactly when it holds a receipt v2 round, else version 1 |
| archival envelope ([archival-core-v1.md](archival-core-v1.md)) | **versioned**: archival envelope version 2 with a `revision_envelope` member ([archival-core-v2.md](archival-core-v2.md)); the archival core's members are unchanged and its receipt reference accepts `{"typ": "sess-receipt-2+jwt", "version": 2}` |
| evidence export (`sess.evidence-export`, the owner's `POST /v1/evidence/export`) | **versioned**: version 2 from the issuance release (version 1 until then); each record gains `revision_envelope` |
| webhook delivery (`response.accepted`) | no version member: a receipt v2's message carries `revision_envelope` beside `receipt` |

Readers accept versions 1 and 2. A version-2 wrapper without its envelope is refused with `revision`; a file a person keeps carries the envelope's full form, and a compact form there is refused with `revision`. A later wrapper version, an unknown Sess receipt `typ` or an envelope of a later `sess_revision` is newer (frozen spec §4): reported as newer (bundle `unsupported_version`, archival `unknown_version`, the kept-file reader's newer refusal), never as a damaged file, and nothing in it is released.

**Cut-over.** Two steps, readers first, so no face meets a receipt v2 it cannot read. (1) The readers release ships every v2 reader (the verifier, `/verify`, the bundle, keep and archival readers, the API checkers, the console's record check, Your receipts and the PDF), the revision envelope beside any receipt v2 on every face that returns a receipt, the publisher captured with each revision, and nothing that issues: every receipt it issues is v1, and it writes the evidence export at version 1. A kept conversation (Keep, Save to Sess, the receipt PDF's embedded file, the /try receipt) is written as version 2 exactly when it holds a receipt v2 round, else version 1 (founder 2026-11-16 20:55Z item 2): every file is keep-v1 until issuance, and a Session holding a receipt v2 is still kept after a rollback of issuance. (2) The issuance release passes the accepted revision's envelope to the receipt (a receipt is v2 exactly when it does) and writes evidence export version 2. That is a code change, not a switch: there is no separate issuance switch. Once the first receipt v2 exists, no rollback may remove v2 reader support from any face.

## 11. Renderer identities

As receipt-v1 §10, unchanged. The envelope's `renderer_version` equals the receipt's `surface.renderer_version`.
