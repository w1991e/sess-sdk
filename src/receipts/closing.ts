import { createHash } from 'node:crypto';
import { compactVerify, importJWK } from 'jose';
import {
  abortError,
  canonicalJson,
  checkedInstant,
  deepFreeze,
  exactKeys,
  isRecord,
  newerReceiptError,
  snapshotJson,
  verificationError,
  waitWithSignal,
  type DeepReadonly,
} from './json.js';
import {
  decodeSegment,
  identifier,
  trustedKeyLookup,
  validateKeySet,
  type ReceiptKeyResolver,
  type ReceiptKeySet,
} from './verify.js';

/** Protected `typ` of a closing receipt (closing-receipt-v1 §1); never a round receipt's. */
export const CLOSING_RECEIPT_TYP = 'sess-closing-receipt+jwt';
/** A closing receipt is at most 8,192 bytes (its archival object's bound, closing-receipt-v1 §7). */
export const MAX_CLOSING_RECEIPT_BYTES = 8192;
/** The receipt key ID grammar (verify.ts, bundle.ts). */
const KID = /^[A-Za-z0-9._-]{1,64}$/;
/** A round receipt entering the commitment is at most 32,768 bytes (closing-receipt-v1 §3). */
const MAX_ROUND_RECEIPT_BYTES = 32_768;
const COMPACT_JWS = /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/;
/** Three segments; an empty signature (`alg: none`) is refused by its algorithm, not its shape. */
const JWS_SHAPE = /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]*$/;
/** The one scope of version 1, and so the only one this release knows. */
const ACCEPTED_ROUNDS = 'accepted_rounds';
const SCOPE = /^[a-z][a-z0-9_]{0,63}$/;
/** A 32-byte SHA-256 as base64url without padding: 43 characters, the last canonical. */
const COMMITMENT = /^[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]$/;
const COMMITMENTS_MAX = 16;
const ROUNDS_MAX = 100_000;
const DOMAIN = 'sess.closing-commitment/v1/accepted_rounds';
const CAUSES = ['completed_by_owner', 'completed_by_ask_rule', 'final_expiry', 'revoked'] as const;

/** How a Session ended, as its closing receipt signs it (closing-receipt-v1 §4). */
export type ClosingCause = (typeof CAUSES)[number];

/** A verified closing receipt's claims (closing-receipt-v1 §2): every member, no other, no `exp`. */
export interface ClosingReceiptClaims {
  sess_closing_receipt: 1;
  iss: string;
  /** The Session's workspace, equal to `workspace_id`. */
  aud: string;
  /** The closure ID (`cls_…`). */
  jti: string;
  iat: number;
  workspace_id: string;
  session_id: string;
  terminal: {
    /** The Event that ended the Session; null only for `revoked`. */
    event_id: string | null;
    cause: ClosingCause;
    /** `sess` for `final_expiry`, else `owner`: derived from the cause. */
    actor_class: 'owner' | 'sess';
  };
  effective_end_at: string;
  recorded_at: string;
  issued_at: string;
  /** Ordered by scope. Version 1 has `accepted_rounds`; a scope this release does not know is refused as newer. */
  commitments: { scope: string; count: number; commitment: string }[];
}

export interface VerifyClosingReceiptInput {
  /** The closing receipt's compact JWS (`closing.receipt` beside a Session's Events). */
  receipt: string;
  /** Trusted protocol identity, independently configured. */
  issuer: string;
  /** Trusted workspace, never read from an unverified receipt. */
  audience: string;
  /** Optional bindings the receipt must name: the Session and the closure (`closing.closure_id`). */
  expected?: { sessionId?: string; closureId?: string };
  /**
   * Optional: the accepted rounds' receipts, in their Event order. When given, the signed
   * `accepted_rounds` count and commitment must be exactly these receipts' bytes, in this order;
   * any other set is refused with `CLOSING_ROUNDS_MISMATCH`. Each round receipt is verified on its
   * own (`receipts.verifyResponse`); this checks only that the set is the one the receipt signs.
   */
  rounds?: readonly string[];
  keys?: ReceiptKeySet;
  keyResolver?: ReceiptKeyResolver;
}

export interface VerifyClosingReceiptOptions {
  signal?: AbortSignal;
}

/** The commitment over round receipts' exact bytes, in order (closing-receipt-v1 §3). */
export function closingCommitmentOf(receipts: readonly string[]): string {
  const hash = createHash('sha256');
  hash.update(Buffer.from(DOMAIN, 'utf8'));
  hash.update(Buffer.from([0]));
  const count = Buffer.alloc(4);
  count.writeUInt32BE(receipts.length);
  hash.update(count);
  for (const receipt of receipts) hash.update(createHash('sha256').update(receipt, 'ascii').digest());
  return hash.digest('base64url');
}

function actorClassOf(cause: ClosingCause): 'owner' | 'sess' {
  return cause === 'final_expiry' ? 'sess' : 'owner';
}

const TOP = [
  'sess_closing_receipt',
  'iss',
  'aud',
  'jti',
  'iat',
  'workspace_id',
  'session_id',
  'terminal',
  'effective_end_at',
  'recorded_at',
  'issued_at',
  'commitments',
];

const invalidClaims = () =>
  verificationError('INVALID_CLAIMS', 'The closing receipt claims do not match the supported format.');

/** The commitments list's own rules; returns whether it carries a scope this release does not know. */
function unknownScope(value: unknown): boolean {
  if (!Array.isArray(value) || value.length < 1 || value.length > COMMITMENTS_MAX) throw invalidClaims();
  let previous = '';
  let unknown = false;
  let rounds = false;
  for (const entry of value as unknown[]) {
    if (
      !isRecord(entry) ||
      !exactKeys(entry, ['scope', 'count', 'commitment']) ||
      typeof entry.scope !== 'string' ||
      !SCOPE.test(entry.scope) ||
      entry.scope <= previous ||
      !Number.isSafeInteger(entry.count) ||
      (entry.count as number) < 0 ||
      typeof entry.commitment !== 'string' ||
      !COMMITMENT.test(entry.commitment)
    )
      throw invalidClaims();
    previous = entry.scope;
    if (entry.scope === ACCEPTED_ROUNDS) {
      if ((entry.count as number) < 1 || (entry.count as number) > ROUNDS_MAX) throw invalidClaims();
      rounds = true;
    } else unknown = true;
  }
  if (!rounds) throw invalidClaims();
  return unknown;
}

/** Strict claims (closing-receipt-v1 §6); the format version is decided by the caller first. */
function claimsOf(raw: Record<string, unknown>): { claims: ClosingReceiptClaims; newer: boolean } {
  if (!exactKeys(raw, TOP)) throw invalidClaims();
  const newer = unknownScope(raw.commitments);
  const t = raw.terminal;
  const effective = checkedInstant(raw.effective_end_at);
  const recorded = checkedInstant(raw.recorded_at);
  const issued = checkedInstant(raw.issued_at);
  if (
    ![raw.iss, raw.aud, raw.jti, raw.workspace_id, raw.session_id].every(identifier) ||
    raw.aud !== raw.workspace_id ||
    !Number.isSafeInteger(raw.iat) ||
    effective === undefined ||
    recorded === undefined ||
    issued === undefined ||
    effective > recorded ||
    recorded > issued ||
    Math.floor(issued / 1000) !== raw.iat ||
    !isRecord(t) ||
    !exactKeys(t, ['event_id', 'cause', 'actor_class']) ||
    typeof t.cause !== 'string' ||
    !(CAUSES as readonly string[]).includes(t.cause) ||
    t.actor_class !== actorClassOf(t.cause as ClosingCause) ||
    (t.cause === 'revoked' ? t.event_id !== null : !identifier(t.event_id))
  )
    throw invalidClaims();
  return { claims: raw as unknown as ClosingReceiptClaims, newer };
}

/**
 * Verifies a Session's closing receipt (closing-receipt-v1 §6) under the keys you trust for the
 * issuer: exactly one of `keys` or `keyResolver`. Offline with explicit keys. It returns the
 * verified claims, deeply frozen, or throws a `SessError`; nothing is returned with a refusal.
 *
 * In order: a compact JWS of at most 8,192 bytes; `alg` exactly `EdDSA`; a `kid` you trust;
 * `typ` exactly `sess-closing-receipt+jwt` (a round receipt is refused here with
 * `UNSUPPORTED_TYPE`); the header exactly `alg`, `kid` and `typ`; the Ed25519 signature; the
 * issuer and workspace; the format version; the strict claims, with no `exp`; RFC 8785 canonical
 * JSON; then the optional Session, closure and round-set bindings. A format version above 1, or a
 * commitment scope this release does not know, is newer: kind `receipt_newer`, code
 * `RECEIPT_NEWER`, never a verification failure.
 *
 * A valid closing receipt says only that these are the final accepted rounds Sess signed for the
 * Session, and how it ended; it is not a receipt for any one answer.
 */
export async function verifyClosingReceipt(
  input: VerifyClosingReceiptInput,
  options: VerifyClosingReceiptOptions = {},
): Promise<DeepReadonly<ClosingReceiptClaims>> {
  // Capture all caller-owned data before a resolver can yield control.
  const receipt = input?.receipt;
  if (typeof receipt !== 'string' || receipt.length > MAX_CLOSING_RECEIPT_BYTES || !JWS_SHAPE.test(receipt))
    throw verificationError(
      'MALFORMED_RECEIPT',
      'The closing receipt is malformed or exceeds its 8,192-byte limit.',
    );
  const issuer = input.issuer;
  const audience = input.audience;
  if (!identifier(issuer) || !identifier(audience))
    throw verificationError(
      'VERIFICATION_CONTEXT_MISSING',
      'A trusted issuer and expected resource workspace are required.',
    );
  const expected = input.expected === undefined ? {} : snapshotJson(input.expected);
  const rounds = input.rounds === undefined ? undefined : snapshotJson(input.rounds);
  if (
    !isRecord(expected) ||
    !exactKeys(
      expected,
      ['sessionId', 'closureId'].filter((k) => Object.hasOwn(expected, k)),
    ) ||
    (expected.sessionId !== undefined && !identifier(expected.sessionId)) ||
    (expected.closureId !== undefined && !identifier(expected.closureId)) ||
    (rounds !== undefined &&
      (!Array.isArray(rounds) ||
        rounds.length < 1 ||
        rounds.length > ROUNDS_MAX ||
        rounds.some(
          (r) => typeof r !== 'string' || r.length > MAX_ROUND_RECEIPT_BYTES || !COMPACT_JWS.test(r),
        )))
  )
    throw verificationError(
      'INVALID_VERIFICATION_INPUT',
      'Expected bindings must be identifiers, and rounds one or more compact round receipts.',
    );
  const resolver = input.keyResolver;
  const keys = input.keys === undefined ? undefined : validateKeySet(input.keys);
  if (
    (keys === undefined) === (resolver === undefined) ||
    (resolver !== undefined && typeof resolver !== 'function')
  )
    throw verificationError(
      'VERIFICATION_CONTEXT_MISSING',
      'Provide exactly one trusted public key set or key resolver.',
    );
  const signal = options.signal;
  if (signal?.aborted) throw abortError(signal);

  const parts = receipt.split('.') as [string, string, string];
  let header: unknown;
  const headerText = decodeSegment(parts[0]);
  try {
    header = JSON.parse(headerText);
  } catch {
    throw verificationError('MALFORMED_RECEIPT', 'The closing receipt protected header is not JSON.');
  }
  if (!isRecord(header))
    throw verificationError('MALFORMED_RECEIPT', 'The closing receipt protected header is not JSON.');
  if (header.alg !== 'EdDSA')
    throw verificationError(
      'UNSUPPORTED_ALGORITHM',
      'The closing receipt must use the supported EdDSA algorithm.',
    );
  if (typeof header.kid !== 'string' || header.kid.length === 0)
    throw verificationError('UNSUPPORTED_HEADER', 'The closing receipt names no signing key.');
  // The whole header is checked before any key is looked up (ASTRA-SDK-80-1): an application's
  // key resolver only ever sees a key ID of the receipt key grammar from a header of exactly
  // {alg, kid, typ}, each once (six string tokens are three names and three values).
  const strings = headerText.match(/"(?:[^"\\\u0000-\u001f]|\\(?:["\\/bfnrt]|u[0-9a-fA-F]{4}))*"/g);
  if (!exactKeys(header, ['alg', 'kid', 'typ']) || strings?.length !== 6 || !KID.test(header.kid))
    throw verificationError(
      'UNSUPPORTED_HEADER',
      'The closing receipt protected header has missing or unsupported fields.',
    );
  const kid = header.kid;
  const publicKey = await trustedKeyLookup(keys, resolver, issuer, signal)(kid);
  if (!publicKey)
    throw verificationError(
      'UNKNOWN_KEY_ID',
      'The closing receipt signing key is not in the trusted key set.',
    );
  // A round receipt (or any other format) offered as a closing receipt stops here: after the key,
  // as the specification's first-failure order has it (closing-receipt-v1 §6: unknown_kid, then
  // type) and Sess's own verifier does.
  if (header.typ !== CLOSING_RECEIPT_TYP)
    throw verificationError('UNSUPPORTED_TYPE', 'This is not a closing receipt.');
  try {
    const key = await waitWithSignal(
      importJWK({ ...publicKey, key_ops: ['verify'], ext: false }, 'EdDSA'),
      signal,
    );
    await waitWithSignal(compactVerify(receipt, key, { algorithms: ['EdDSA'] }), signal);
  } catch {
    if (signal?.aborted) throw abortError(signal);
    throw verificationError(
      'INVALID_SIGNATURE',
      'The closing receipt signature did not verify with the trusted Ed25519 key.',
    );
  }
  const payloadText = decodeSegment(parts[1]);
  let parsed: unknown;
  try {
    parsed = JSON.parse(payloadText);
  } catch {
    throw verificationError('MALFORMED_RECEIPT', 'The closing receipt payload is not JSON.');
  }
  const raw = snapshotJson(parsed);
  if (!isRecord(raw))
    throw verificationError('MALFORMED_RECEIPT', 'The closing receipt payload is not a JSON object.');
  if (raw.iss !== issuer)
    throw verificationError(
      'ISSUER_MISMATCH',
      'The closing receipt issuer does not match the trusted issuer.',
    );
  if (raw.aud !== audience)
    throw verificationError(
      'AUDIENCE_MISMATCH',
      'The closing receipt does not belong to the expected resource workspace.',
    );
  const version = raw.sess_closing_receipt;
  // A later version may constrain what version 1 would release: nothing is released.
  if (Number.isSafeInteger(version) && (version as number) > 1) throw newerReceiptError();
  if (version !== 1)
    throw verificationError(
      'UNSUPPORTED_RECEIPT_VERSION',
      'The closing receipt format version is not supported (version 1 is).',
    );
  const { claims, newer } = claimsOf(raw);
  if (canonicalJson(claims) !== payloadText)
    throw verificationError(
      'NON_CANONICAL_PAYLOAD',
      'The signed closing receipt payload must be RFC 8785 canonical JSON.',
    );
  // Only after every other check: an unknown signed scope makes the whole receipt newer.
  if (newer) throw newerReceiptError();
  if (
    (expected.sessionId !== undefined && claims.session_id !== expected.sessionId) ||
    (expected.closureId !== undefined && claims.jti !== expected.closureId)
  )
    throw verificationError(
      'RECORD_BINDING_MISMATCH',
      'The closing receipt does not name the expected Session and closure.',
    );
  if (rounds !== undefined) {
    const signed = claims.commitments.find((c) => c.scope === ACCEPTED_ROUNDS) as {
      count: number;
      commitment: string;
    };
    if (signed.count !== rounds.length || signed.commitment !== closingCommitmentOf(rounds))
      throw verificationError(
        'CLOSING_ROUNDS_MISMATCH',
        'These round receipts are not exactly the accepted rounds the closing receipt signs.',
      );
  }
  return deepFreeze(claims);
}
