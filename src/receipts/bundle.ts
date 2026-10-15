// Decision bundles (bundle-v1, docs/spec/bundle-v1.md): a deliberate disclosure of one accepted
// decision that anyone can check. verifyDecisionBundle is the SDK face of the Sess verification
// core: the same check order, bounds, reasons, result object and key-trust rules, proven against
// the shared conformance corpus. Keys and expected context come only from the caller; nothing in
// the bundle is trusted. A valid result states what the issuer accepted from someone holding the
// Session's human link: never who that person is, nor that anything was authorized or executed.
//
// verifyDecisionReceipt is a separate, stricter record-bound interface and is unchanged by this
// module. This module shares its trusted-key validation and canonical JSON helpers.
import { createHash } from 'node:crypto';
import { decodeProtectedHeader, errors, importJWK, jwtVerify, type JWTPayload } from 'jose';
import { canonicalJson, exactKeys, isRecord, jsonDigest } from './json.js';
import { validateKeySet, type ReceiptKeySet } from './verify.js';

const BUNDLE_TYPE = 'sess.decision-bundle';
const BUNDLE_VERSION = 1;
const RECEIPT_ALG = 'EdDSA';
const RECEIPT_TYP = 'sess-receipt+jwt';

/** Bounds of a bundle (bundle-v1 §4). A bundle beyond any of them is `oversized`. */
export const BUNDLE_LIMITS = Object.freeze({
  /** RFC 8785 canonical UTF-8 bytes of the whole bundle. */
  bytes: 1_048_576,
  /** Nesting depth of any value (the bundle object itself is depth 1). */
  depth: 32,
  /** Items in any one array. */
  arrayItems: 1_000,
  /** Members of any one object. */
  objectMembers: 1_000,
  /** JSON values in the whole bundle. */
  nodes: 100_000,
  /** Characters of the receipt's compact JWS. */
  receiptChars: 32_768,
  /** Public keys in `keys.keys`. */
  keys: 16,
});

/** How far in the future a receipt's `iat` may be before it is `not_yet_valid`, in seconds. */
const CLOCK_TOLERANCE_S = 60;

/** One public Ed25519 JWK as disclosed in a bundle. */
export interface BundleJwk {
  kty: 'OKP';
  crv: 'Ed25519';
  x: string;
  kid: string;
  alg?: 'EdDSA';
  use?: 'sig';
}

/** A bundle-v1 object: exactly these members. */
export interface DecisionBundle {
  type: 'sess.decision-bundle';
  version: 1;
  /** The receipt-v1 compact JWS, exactly as issued. */
  receipt: string;
  /** The accepted record: the normalized Surface document and the validated input, complete. */
  content: { surface: Record<string, unknown>; input: Record<string, unknown> };
  /** The issuer's public keys. Disclosed for convenience; a verifier never trusts them. */
  keys: { keys: BundleJwk[] };
}

/** Receipt-v1 rejection codes (receipt-v1 §6). */
type ReceiptV1Rejection =
  | 'malformed'
  | 'algorithm'
  | 'missing_kid'
  | 'unknown_kid'
  | 'type'
  | 'signature'
  | 'issuer'
  | 'audience'
  | 'expired'
  | 'claims';

/** Why a bundle is invalid: the first check that failed (bundle-v1 §5). */
export type BundleRejection =
  | 'malformed'
  | 'oversized'
  | 'unsupported_version'
  | 'receipt_malformed'
  | Exclude<ReceiptV1Rejection, 'malformed'>
  | 'not_yet_valid'
  | 'surface_mismatch'
  | 'input_mismatch'
  | 'context_mismatch';

/** Application context from the caller's trusted configuration, never from the bundle. */
export interface ExpectedBundleContext {
  /** The recipient the caller expects (the receipt's `aud`: the Session's workspace). */
  audience?: string;
  workspaceId?: string;
  sessionId?: string;
  eventId?: string;
  /** The Surface revision the decision must be on. */
  revision?: number;
  actionId?: string;
}

/** Context member names as the result reports them (receipt claim paths). */
export type BundleContextField =
  'audience' | 'workspace_id' | 'session_id' | 'event_id' | 'surface.revision' | 'action.id';

export interface VerifyDecisionBundleOptions {
  /** The issuer the caller trusts (the receipt's `iss`). */
  issuer: string;
  /** The issuer's public verification keys the caller trusts. Keys inside a bundle are never used. */
  trustedKeys: ReceiptKeySet;
  expectedContext?: ExpectedBundleContext;
  /** Defaults to the current time (receipt-v1 current-time expiry). */
  now?: Date;
}

/** The verified receipt, presented only when the bundle is valid. */
export interface VerifiedReceiptSummary {
  key_id: string;
  issuer: string;
  audience: string;
  event_id: string;
  session_id: string;
  workspace_id: string;
  step_id: string;
  surface: { revision: number; hash: string; renderer_version: string };
  action: { id: string; label: string; summary: string };
  input_hash: string;
  accepted_at: string;
  expires_at: string;
}

/** The result every face reports (bundle-v1 §6). JSON-serializable. */
export interface DecisionBundleVerification {
  valid: boolean;
  reason: BundleRejection | null;
  /** The verification time, RFC 3339 UTC. */
  checked_at: string;
  /** Whether the disclosed Surface and input match the receipt's hashes. */
  content: 'verified' | 'mismatch' | 'not_checked';
  context: {
    status: 'verified' | 'incomplete' | 'mismatch' | 'unchecked' | 'not_checked';
    /** The context members the caller supplied, in a fixed order. */
    checked: BundleContextField[];
    mismatches: BundleContextField[];
  };
  /** `matched_caller_context` only when the caller's full context (with audience) matched. */
  application_purpose: 'unchecked' | 'matched_caller_context';
  /** Link possession only: never a named or verified person. Null when invalid. */
  actor: { assurance: 'link_holder' } | null;
  receipt: VerifiedReceiptSummary | null;
}

export interface ReceiptV1Claims {
  sess_receipt: 1;
  iss: string;
  aud: string;
  jti: string;
  iat: number;
  exp: number;
  accepted_at: string;
  workspace_id: string;
  session_id: string;
  step_id: string;
  event_id: string;
  surface: { revision: number; hash: string; renderer_version: string };
  action: { id: string; label: string; summary: string };
  input_hash: string;
  actor: { assurance: 'link_holder'; subject: string };
  return_binding: { recipient: string; return_channel_id: string | null };
}

// ------------------------------------------------------------------------------------------------
// receipt-v1 §6, in its order and with its codes
// ------------------------------------------------------------------------------------------------

export class ReceiptV1Failure extends Error {
  readonly code: ReceiptV1Rejection;
  constructor(code: ReceiptV1Rejection) {
    super(code);
    this.code = code;
  }
}

const DIGEST = /^sha256:[0-9a-f]{64}$/;
const nonEmpty = (v: unknown): v is string => typeof v === 'string' && v.length > 0;

function receiptV1Claims(p: Record<string, unknown>): ReceiptV1Claims {
  const top = [
    'sess_receipt',
    'iss',
    'aud',
    'jti',
    'iat',
    'exp',
    'accepted_at',
    'workspace_id',
    'session_id',
    'step_id',
    'event_id',
    'surface',
    'action',
    'input_hash',
    'actor',
    'return_binding',
  ];
  const s = p.surface;
  const a = p.action;
  const act = p.actor;
  const rb = p.return_binding;
  const ok =
    exactKeys(p, top) &&
    p.sess_receipt === 1 &&
    [p.iss, p.aud, p.jti, p.accepted_at, p.workspace_id, p.session_id, p.step_id, p.event_id].every(
      nonEmpty,
    ) &&
    p.jti === p.event_id &&
    Number.isSafeInteger(p.iat) &&
    Number.isSafeInteger(p.exp) &&
    typeof p.input_hash === 'string' &&
    DIGEST.test(p.input_hash) &&
    isRecord(s) &&
    exactKeys(s, ['revision', 'hash', 'renderer_version']) &&
    Number.isSafeInteger(s.revision) &&
    (s.revision as number) >= 1 &&
    typeof s.hash === 'string' &&
    DIGEST.test(s.hash) &&
    nonEmpty(s.renderer_version) &&
    isRecord(a) &&
    exactKeys(a, ['id', 'label', 'summary']) &&
    nonEmpty(a.id) &&
    nonEmpty(a.label) &&
    typeof a.summary === 'string' &&
    isRecord(act) &&
    exactKeys(act, ['assurance', 'subject']) &&
    act.assurance === 'link_holder' &&
    typeof act.subject === 'string' &&
    act.subject.startsWith(`${p.workspace_id as string}:`) &&
    isRecord(rb) &&
    exactKeys(rb, ['recipient', 'return_channel_id']) &&
    rb.recipient === p.aud &&
    (rb.return_channel_id === null || nonEmpty(rb.return_channel_id));
  if (!ok) throw new ReceiptV1Failure('claims');
  return p as unknown as ReceiptV1Claims;
}

/**
 * The receipt-v1 rules against trusted keys: compact JWS, pinned EdDSA, a kid the caller trusts
 * (no fallback key), the receipt typ, the signature, the trusted issuer, the expected audience,
 * current-time expiry, then the claims and their canonical serialization. Throws ReceiptV1Failure
 * with the first failing code; any other error means the receipt could not be read at all.
 */
export async function verifyReceiptV1(
  jws: string,
  keys: ReceiptKeySet,
  options: { issuer: string; audience: string; now: Date },
): Promise<ReceiptV1Claims> {
  if (jws.split('.').length !== 3) throw new ReceiptV1Failure('malformed');
  let header: ReturnType<typeof decodeProtectedHeader>;
  try {
    header = decodeProtectedHeader(jws);
  } catch {
    throw new ReceiptV1Failure('malformed');
  }
  if (header.alg !== RECEIPT_ALG) throw new ReceiptV1Failure('algorithm');
  if (typeof header.kid !== 'string' || header.kid.length === 0) throw new ReceiptV1Failure('missing_kid');
  const jwk = keys.keys.find((k) => k.kid === header.kid);
  if (!jwk) throw new ReceiptV1Failure('unknown_kid');
  if (header.typ !== RECEIPT_TYP) throw new ReceiptV1Failure('type');
  const key = await importJWK({ kty: jwk.kty, crv: jwk.crv, x: jwk.x }, RECEIPT_ALG);
  let payload: JWTPayload;
  try {
    ({ payload } = await jwtVerify(jws, key, {
      algorithms: [RECEIPT_ALG],
      typ: RECEIPT_TYP,
      issuer: options.issuer,
      audience: options.audience,
      currentDate: options.now,
      requiredClaims: ['iss', 'aud', 'iat', 'exp', 'jti'],
    }));
  } catch (e) {
    if (e instanceof errors.JWSSignatureVerificationFailed) throw new ReceiptV1Failure('signature');
    if (e instanceof errors.JWTExpired) throw new ReceiptV1Failure('expired');
    if (e instanceof errors.JOSEAlgNotAllowed) throw new ReceiptV1Failure('algorithm');
    if (e instanceof errors.JWTClaimValidationFailed) {
      if (e.claim === 'aud') throw new ReceiptV1Failure('audience');
      if (e.claim === 'iss') throw new ReceiptV1Failure('issuer');
      throw new ReceiptV1Failure('claims');
    }
    throw new ReceiptV1Failure('malformed');
  }
  const claims = receiptV1Claims(payload as Record<string, unknown>);
  // The signed bytes must be exactly the canonical form of the claims.
  const signed = Buffer.from(jws.split('.')[1] as string, 'base64url');
  if (`sha256:${createHash('sha256').update(signed).digest('hex')}` !== jsonDigest(claims))
    throw new ReceiptV1Failure('claims');
  return claims;
}

// ------------------------------------------------------------------------------------------------
// bundle-v1 §2 and §4: shape and bounds
// ------------------------------------------------------------------------------------------------

/**
 * Walks a value iteratively (nesting cannot exhaust the stack): 'oversized' for an exceeded
 * bound, 'malformed' for a value with no JSON form, else null.
 */
function structuralProblem(value: unknown): 'malformed' | 'oversized' | null {
  const stack: Array<[unknown, number]> = [[value, 1]];
  let nodes = 0;
  let textBytes = 0;
  while (stack.length > 0) {
    const [v, depth] = stack.pop() as [unknown, number];
    nodes += 1;
    if (nodes > BUNDLE_LIMITS.nodes || depth > BUNDLE_LIMITS.depth) return 'oversized';
    if (v === null || typeof v === 'boolean') continue;
    if (typeof v === 'number') {
      if (!Number.isFinite(v)) return 'malformed';
      continue;
    }
    if (typeof v === 'string') {
      // A lower bound of the UTF-8 size: stops a huge string before canonicalization.
      textBytes += v.length;
      if (textBytes > BUNDLE_LIMITS.bytes) return 'oversized';
      continue;
    }
    if (Array.isArray(v)) {
      if (v.length > BUNDLE_LIMITS.arrayItems) return 'oversized';
      for (const item of v) stack.push([item, depth + 1]);
      continue;
    }
    if (typeof v === 'object' && Object.getPrototypeOf(v) === Object.prototype) {
      const keys = Object.keys(v);
      if (keys.length > BUNDLE_LIMITS.objectMembers) return 'oversized';
      for (const k of keys) {
        textBytes += k.length;
        stack.push([(v as Record<string, unknown>)[k], depth + 1]);
      }
      continue;
    }
    // undefined, functions, symbols, bigint, class instances: no JSON form.
    return 'malformed';
  }
  return null;
}

const COMPACT_JWS = /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]*$/;
const KID = /^[A-Za-z0-9._-]{1,64}$/;
const JWK_MEMBERS = new Set(['kty', 'crv', 'x', 'kid', 'alg', 'use']);

function publicJwkProblem(k: unknown): boolean {
  if (!isRecord(k)) return true;
  // Only the public members: any other member (d, p, q, k, …) makes the bundle malformed, so a
  // bundle never carries private key material.
  if (Object.keys(k).some((m) => !JWK_MEMBERS.has(m))) return true;
  return !(
    k.kty === 'OKP' &&
    k.crv === 'Ed25519' &&
    typeof k.x === 'string' &&
    /^[A-Za-z0-9_-]{43}$/.test(k.x) &&
    typeof k.kid === 'string' &&
    KID.test(k.kid) &&
    (k.alg === undefined || k.alg === RECEIPT_ALG) &&
    (k.use === undefined || k.use === 'sig')
  );
}

function shapeProblem(b: unknown): 'malformed' | 'oversized' | 'unsupported_version' | null {
  if (!isRecord(b)) return 'malformed';
  const structural = structuralProblem(b);
  if (structural) return structural;
  let size: number;
  try {
    size = Buffer.byteLength(canonicalJson(b), 'utf8');
  } catch {
    return 'malformed'; // e.g. a lone surrogate
  }
  if (size > BUNDLE_LIMITS.bytes) return 'oversized';
  if (b.type !== BUNDLE_TYPE) return 'malformed';
  if (b.version !== BUNDLE_VERSION) {
    return Number.isSafeInteger(b.version) && (b.version as number) > BUNDLE_VERSION
      ? 'unsupported_version'
      : 'malformed';
  }
  if (!exactKeys(b, ['type', 'version', 'receipt', 'content', 'keys'])) return 'malformed';
  if (typeof b.receipt !== 'string') return 'malformed';
  if (b.receipt.length > BUNDLE_LIMITS.receiptChars) return 'oversized';
  const c = b.content;
  if (!isRecord(c) || !exactKeys(c, ['surface', 'input'])) return 'malformed';
  if (!isRecord(c.surface) || !isRecord(c.input)) return 'malformed';
  const k = b.keys;
  if (!isRecord(k) || !exactKeys(k, ['keys']) || !Array.isArray(k.keys)) return 'malformed';
  if (k.keys.length > BUNDLE_LIMITS.keys) return 'oversized';
  if (k.keys.some(publicJwkProblem)) return 'malformed';
  const kids = k.keys.map((j) => (j as BundleJwk).kid);
  if (new Set(kids).size !== kids.length) return 'malformed';
  return null;
}

/** The receipt's declared (unverified) `aud`, used only when the caller expects none. */
function declaredAudience(jws: string): string | undefined {
  if (!COMPACT_JWS.test(jws)) return undefined;
  try {
    const payload = JSON.parse(
      Buffer.from(jws.split('.')[1] as string, 'base64url').toString('utf8'),
    ) as unknown;
    return isRecord(payload) && typeof payload.aud === 'string' && payload.aud.length > 0
      ? payload.aud
      : undefined;
  } catch {
    return undefined;
  }
}

function checkOptions(o: VerifyDecisionBundleOptions): ReceiptKeySet {
  if (typeof o?.issuer !== 'string' || o.issuer.length === 0)
    throw new TypeError('verifyDecisionBundle needs a non-empty trusted issuer');
  if (!o.trustedKeys) throw new TypeError('verifyDecisionBundle needs trusted keys');
  let keys: ReceiptKeySet;
  try {
    keys = validateKeySet(o.trustedKeys);
  } catch {
    throw new TypeError('trustedKeys must be a JWK Set of public Ed25519 keys with unique kids');
  }
  if (o.now !== undefined && (!(o.now instanceof Date) || Number.isNaN(o.now.getTime())))
    throw new TypeError('now must be a valid Date');
  const e = o.expectedContext;
  if (e === undefined) return keys;
  if (!isRecord(e as unknown)) throw new TypeError('expectedContext must be an object');
  for (const k of ['audience', 'workspaceId', 'sessionId', 'eventId', 'actionId'] as const)
    if (e[k] !== undefined && (typeof e[k] !== 'string' || e[k].length === 0))
      throw new TypeError(`expectedContext.${k} must be a non-empty string`);
  if (e.revision !== undefined && (!Number.isSafeInteger(e.revision) || e.revision < 1))
    throw new TypeError('expectedContext.revision must be a positive integer');
  return keys;
}

function contextChecks(
  e: ExpectedBundleContext | undefined,
  c: ReceiptV1Claims | null,
): Array<{ field: BundleContextField; ok: boolean }> {
  if (!e) return [];
  const all: Array<[BundleContextField, unknown, unknown]> = [
    ['audience', e.audience, c?.aud],
    ['workspace_id', e.workspaceId, c?.workspace_id],
    ['session_id', e.sessionId, c?.session_id],
    ['event_id', e.eventId, c?.event_id],
    ['surface.revision', e.revision, c?.surface.revision],
    ['action.id', e.actionId, c?.action.id],
  ];
  return all
    .filter(([, expected]) => expected !== undefined)
    .map(([field, expected, actual]) => ({ field, ok: expected === actual }));
}

// ------------------------------------------------------------------------------------------------
// Verification
// ------------------------------------------------------------------------------------------------

/**
 * Verifies a bundle-v1 decision bundle offline against the issuer and keys the caller trusts.
 * Every outcome about the bundle is a result, never an exception; only invalid options throw a
 * TypeError. Order (bundle-v1 §5): shape and bounds; the receipt by the receipt-v1 rules; not
 * issued in the future; the disclosed Surface and input against the receipt's hashes; then the
 * caller's expected context.
 */
export async function verifyDecisionBundle(
  bundle: unknown,
  options: VerifyDecisionBundleOptions,
): Promise<DecisionBundleVerification> {
  const trustedKeys = checkOptions(options);
  const now = options.now ?? new Date();
  const expected = options.expectedContext;
  const supplied = contextChecks(expected, null).map((x) => x.field);
  const invalid = (
    reason: BundleRejection,
    over: Partial<Pick<DecisionBundleVerification, 'content' | 'context'>> = {},
  ): DecisionBundleVerification => ({
    valid: false,
    reason,
    checked_at: now.toISOString(),
    content: 'not_checked',
    context: { status: 'not_checked', checked: supplied, mismatches: [] },
    application_purpose: 'unchecked',
    actor: null,
    receipt: null,
    ...over,
  });

  const shape = shapeProblem(bundle);
  if (shape) return invalid(shape);
  const b = bundle as DecisionBundle;

  // Without an expected audience the receipt is checked against its own declared (signed) `aud`;
  // the result then reports the context as unchecked.
  const audience = expected?.audience ?? declaredAudience(b.receipt);
  if (audience === undefined) return invalid('receipt_malformed');
  let claims: ReceiptV1Claims;
  try {
    claims = await verifyReceiptV1(b.receipt, trustedKeys, { issuer: options.issuer, audience, now });
  } catch (e) {
    if (!(e instanceof ReceiptV1Failure)) return invalid('receipt_malformed');
    if (e.code === 'audience')
      return invalid('audience', {
        context: { status: 'mismatch', checked: supplied, mismatches: ['audience'] },
      });
    return invalid(e.code === 'malformed' ? 'receipt_malformed' : e.code);
  }
  if (claims.iat > Math.floor(now.getTime() / 1000) + CLOCK_TOLERANCE_S) return invalid('not_yet_valid');

  if (claims.surface.hash !== jsonDigest(b.content.surface))
    return invalid('surface_mismatch', { content: 'mismatch' });
  if (claims.input_hash !== jsonDigest(b.content.input))
    return invalid('input_mismatch', { content: 'mismatch' });

  const checks = contextChecks(expected, claims);
  const mismatches = checks.filter((x) => !x.ok).map((x) => x.field);
  if (mismatches.length > 0)
    return invalid('context_mismatch', {
      content: 'verified',
      context: { status: 'mismatch', checked: supplied, mismatches },
    });
  const status =
    checks.length === 0 ? 'unchecked' : expected?.audience === undefined ? 'incomplete' : 'verified';
  const kid = JSON.parse(Buffer.from(b.receipt.split('.')[0] as string, 'base64url').toString('utf8'))
    .kid as string;
  return {
    valid: true,
    reason: null,
    checked_at: now.toISOString(),
    content: 'verified',
    context: { status, checked: supplied, mismatches: [] },
    application_purpose: status === 'verified' ? 'matched_caller_context' : 'unchecked',
    actor: { assurance: claims.actor.assurance },
    receipt: {
      key_id: kid,
      issuer: claims.iss,
      audience: claims.aud,
      event_id: claims.event_id,
      session_id: claims.session_id,
      workspace_id: claims.workspace_id,
      step_id: claims.step_id,
      surface: { ...claims.surface },
      action: { ...claims.action },
      input_hash: claims.input_hash,
      accepted_at: claims.accepted_at,
      expires_at: new Date(claims.exp * 1000).toISOString(),
    },
  };
}
