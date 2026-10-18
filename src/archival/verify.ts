// The successor archival verifier (archival-core-v1 §5, docs/spec/archival-core-v1.md): a
// separately named, offline interface beside verifyDecisionReceipt and verifyDecisionBundle, which
// are not changed. It never throws for a bad envelope; it reports independent result dimensions,
// each with an explicit status and reason:
//
//   signature   the envelope/core/receipt structure and both signatures (receipt-v1 verified at
//               its own issuance time, so current-time expiry is reported separately below)
//   contents    whether disclosed content matches the receipt's hashes (absent: unavailable to
//               this check, never "deleted")
//   context     whether the trusted caller's expected application context matches
//   witness     detachable preservation evidence: witness evidence version 1 verified offline
//               against the caller's witness trust anchors (witnessed, with the witness time as an
//               upper bound), none attached (pending: unanchored), well formed but without
//               established historical trust (indeterminate), malformed or failing (invalid)
//   key_trust   whether the signing key is in the caller's trusted key set
//   live_expiry whether the receipt is still within its `exp` (what receipt-v1 checks today)
//
// presentArchivalVerification maps them to the four user-facing messages. A signature that is not
// valid never yields a verified message. Trusted keys, witness trust anchors and context come only
// from the caller, never from the envelope. It makes no network request.
//
// This is the SDK face of the Sess evidence verifier (verify.ts at the commit recorded in
// docs/spec/source.json): the same check order, bounds, canonicalization, signing domain, result
// object and reason codes, proven against the shared archival corpus.
import { type ReceiptV1Claims, ReceiptV1Failure, verifyReceiptV1 } from '../receipts/bundle.js';
import { canonicalJson, jsonDigest } from '../receipts/json.js';
import { type ReceiptKeySet, validateKeySet } from '../receipts/verify.js';
import {
  type ArchivalCore,
  ArchivalCoreError,
  type ArchivalCoreRejection,
  checkArchivalCoreSignature,
  decodeReceipt,
  isObject,
  sha256Digest,
  type SignedArchivalCore,
} from './core.js';
import { readArchivalEnvelope } from './envelope.js';
import { checkWitnessAnchors } from './witness/anchors.js';
import { verifyWitnessEvidence, WITNESS_EVIDENCE_TYPE } from './witness/evidence.js';
import type { WitnessAnchors } from './witness/parts.js';

export type DimensionStatus = 'valid' | 'invalid' | 'unsupported' | 'unverifiable';

export type SignatureReason =
  | 'verified'
  | 'malformed'
  | 'oversized'
  | 'wrong_type'
  | 'unknown_version'
  | 'unsupported_algorithm'
  /** The core signature does not verify (tampered core, other signing domain or key). */
  | 'core_signature'
  /** The receipt bytes are not the ones the core names (digest or length). */
  | 'receipt_digest_mismatch'
  | 'receipt_malformed'
  | 'receipt_signature'
  /** The core's issuer/workspace/event/acceptance time differ from the receipt's claims. */
  | 'core_receipt_mismatch'
  /** A signing key is not in the trusted key set: the signature cannot be checked. */
  | 'untrusted_key';

export type ContentsReason =
  | 'verified'
  | 'content_unavailable'
  | 'content_mismatch'
  | 'content_malformed'
  | 'content_oversized'
  | 'signature_unverified';

export type ContextReason =
  | 'verified'
  /** No expected context was supplied by a trusted caller. */
  | 'unchecked'
  /** Some expected values matched, but issuer and audience were not both supplied. */
  | 'incomplete'
  | 'mismatch'
  | 'signature_unverified';

export type WitnessStatus =
  'witnessed' | 'pending' | 'indeterminate' | 'invalid' | 'unsupported' | 'unverifiable';
export type WitnessReason =
  /** witnessed: a version 1 witness evidence entry verified against the caller's anchors. */
  | 'verified'
  /** pending: no evidence is attached (the receipt is unanchored). */
  | 'unwitnessed'
  /** invalid: an entry is not an object or not well formed. */
  | 'malformed_evidence'
  /** invalid: a well-formed witness entry fails verification (see `detail`). */
  | 'invalid_evidence'
  /** unsupported: entries of unknown types or versions only. */
  | 'unsupported_evidence'
  /** indeterminate: no witness trust anchors were supplied by the caller. */
  | 'witness_trust_unavailable'
  /** indeterminate: the witness key, TSA or log is not in the caller's trust anchors. */
  | 'untrusted_witness_key'
  | 'untrusted_tsa'
  | 'unknown_log'
  /** indeterminate: the timestamp chain lapsed before it was renewed. */
  | 'renewal_lapsed'
  | 'signature_unverified';

export type KeyTrustReason = 'trusted' | 'unknown_kid' | 'not_evaluated';
export type LiveExpiryReason = 'unexpired' | 'expired' | 'signature_unverified';

export interface Dimension<S extends string, R extends string> {
  status: S;
  reason: R;
}

/** Application context expected by a trusted caller; every supplied member must match. */
export interface ExpectedArchivalContext {
  issuer?: string;
  audience?: string;
  workspace_id?: string;
  session_id?: string;
  event_id?: string;
  surface_revision?: number;
  action_id?: string;
}

export interface VerifyArchivalEnvelopeOptions {
  /** The issuer's public receipt keys you trust (a JWK Set). Keys are never read from the envelope. */
  trustedKeys: ReceiptKeySet;
  /** For live_expiry only. Defaults to the current time. */
  now?: Date;
  /** Disclosed content: the accepted normalized Surface document and the validated input. */
  content?: { surface: unknown; input: unknown };
  /** The application context you expect; only the members you supply are compared. */
  expectedContext?: ExpectedArchivalContext;
  /** When you last refreshed your trusted key set; echoed to disclose key freshness. */
  keySetObservedAt?: Date;
  /**
   * Witness trust anchors you supplied: an independently distributed trusted root (TSAs, logs)
   * and the issuer's witness key set. Never taken from the envelope. Absent: attached witness
   * evidence is indeterminate (witness_trust_unavailable). Unusable anchors throw a TypeError
   * (checkWitnessAnchors), like any other invalid option.
   */
  witnessAnchors?: WitnessAnchors;
}

/** The receipt-v1 claims, as verified. */
export type ArchivalReceiptClaims = ReceiptV1Claims;

/** The result every archival verification face reports. JSON-serializable. */
export interface ArchivalVerification {
  checked_at: string;
  signature: Dimension<DimensionStatus, SignatureReason>;
  contents: Dimension<DimensionStatus, ContentsReason>;
  context: Dimension<DimensionStatus, ContextReason> & {
    checked: string[];
    mismatched: string[];
  };
  witness: Dimension<WitnessStatus, WitnessReason> & {
    /** Witnessed only: the TSA time, an upper bound on when the signed core existed. */
    witnessed_at?: string;
    /** Invalid evidence only: which part failed. */
    detail?: string;
  };
  key_trust: Dimension<DimensionStatus, KeyTrustReason> & {
    /** Always the caller: trust never comes from the submitted envelope. */
    key_set: 'caller_supplied';
    key_set_observed_at: string | null;
  };
  live_expiry: Dimension<DimensionStatus, LiveExpiryReason> & { expires_at: string | null };
  /** The validated core and receipt claims; null unless `signature` is valid. */
  core: ArchivalCore | null;
  claims: ArchivalReceiptClaims | null;
}

/** Disclosed content above this canonical size is refused (Surface 128 KiB plus input). */
export const ARCHIVAL_CONTENT_MAX_BYTES = 1_048_576;

const CONTEXT_KEYS = [
  'issuer',
  'audience',
  'workspace_id',
  'session_id',
  'event_id',
  'surface_revision',
  'action_id',
] as const;

function checkOptions(options: VerifyArchivalEnvelopeOptions): ReceiptKeySet {
  if (!isObject(options)) throw new TypeError('options must be an object');
  if (options.trustedKeys === undefined) throw new TypeError('verifyArchivalEnvelope needs trustedKeys');
  let keys: ReceiptKeySet;
  try {
    keys = validateKeySet(options.trustedKeys);
  } catch {
    throw new TypeError('trustedKeys must be a JWK Set of public Ed25519 keys with unique kids');
  }
  for (const k of ['now', 'keySetObservedAt'] as const) {
    const d = options[k];
    if (d !== undefined && (!(d instanceof Date) || Number.isNaN(d.getTime())))
      throw new TypeError(`${k} must be a valid Date`);
  }
  const c = options.expectedContext;
  if (c !== undefined) {
    if (!isObject(c)) throw new TypeError('expectedContext must be an object');
    for (const k of Object.keys(c))
      if (!(CONTEXT_KEYS as readonly string[]).includes(k))
        throw new TypeError(`expectedContext.${k} is not a supported context member`);
    for (const k of CONTEXT_KEYS) {
      const v = c[k];
      if (v === undefined) continue;
      const ok =
        k === 'surface_revision'
          ? Number.isSafeInteger(v) && (v as number) >= 1
          : typeof v === 'string' && v.length > 0;
      if (!ok) throw new TypeError(`expectedContext.${k} is not a valid expected value`);
    }
  }
  if (options.content !== undefined) {
    const x = options.content as unknown;
    if (!isObject(x) || !Object.hasOwn(x, 'surface') || !Object.hasOwn(x, 'input'))
      throw new TypeError('content must be {surface, input}');
  }
  // Witness anchors are the caller's configuration: an unusable one (a certificate that is not
  // DER, a log base URL that is not https, a key that is not SPKI, a window that is not a date) is
  // refused here with a stable TypeError, never reported as a property of the evidence and never
  // thrown later from inside the token or log verifier (witness/anchors.ts; as the Sess core).
  if (options.witnessAnchors !== undefined) checkWitnessAnchors(options.witnessAnchors);
  return keys;
}

const SIGNATURE_OF: Record<ArchivalCoreRejection, Dimension<DimensionStatus, SignatureReason>> = {
  malformed: { status: 'invalid', reason: 'malformed' },
  oversized: { status: 'invalid', reason: 'oversized' },
  wrong_type: { status: 'invalid', reason: 'wrong_type' },
  unknown_version: { status: 'unsupported', reason: 'unknown_version' },
  unsupported_algorithm: { status: 'unsupported', reason: 'unsupported_algorithm' },
};

function receiptFailure(e: unknown): Dimension<DimensionStatus, SignatureReason> {
  if (!(e instanceof ReceiptV1Failure)) return { status: 'invalid', reason: 'receipt_malformed' };
  switch (e.code) {
    case 'unknown_kid':
      return { status: 'unverifiable', reason: 'untrusted_key' };
    case 'algorithm':
      return { status: 'unsupported', reason: 'unsupported_algorithm' };
    case 'signature':
      return { status: 'invalid', reason: 'receipt_signature' };
    default:
      return { status: 'invalid', reason: 'receipt_malformed' };
  }
}

/**
 * Verifies an archival envelope (a parsed value, or its JSON text or UTF-8 bytes) offline against
 * the keys and anchors you trust. Never throws for the envelope's content: every outcome is a
 * dimension with a reason. Only invalid options throw a TypeError.
 */
export async function verifyArchivalEnvelope(
  input: unknown,
  options: VerifyArchivalEnvelopeOptions,
): Promise<ArchivalVerification> {
  const trustedKeys = checkOptions(options);
  const now = options.now ?? new Date();
  const unverified = {
    contents: { status: 'unverifiable', reason: 'signature_unverified' },
    context: {
      status: 'unverifiable',
      reason: 'signature_unverified',
      checked: [],
      mismatched: [],
    },
    witness: { status: 'unverifiable', reason: 'signature_unverified' },
    live_expiry: { status: 'unverifiable', reason: 'signature_unverified', expires_at: null },
  } as const;
  const keyTrust = (status: DimensionStatus, reason: KeyTrustReason): ArchivalVerification['key_trust'] => ({
    status,
    reason,
    key_set: 'caller_supplied',
    key_set_observed_at: options.keySetObservedAt?.toISOString() ?? null,
  });
  const refuse = (
    signature: Dimension<DimensionStatus, SignatureReason>,
    trust = keyTrust('unverifiable', 'not_evaluated'),
  ): ArchivalVerification => ({
    checked_at: now.toISOString(),
    signature,
    contents: { ...unverified.contents },
    context: { ...unverified.context, checked: [], mismatched: [] },
    witness: { ...unverified.witness },
    key_trust: trust,
    live_expiry: { ...unverified.live_expiry },
    core: null,
    claims: null,
  });

  // 1. Structure: envelope, signed core, core (strict, bounded).
  let envelope: ReturnType<typeof readArchivalEnvelope>;
  try {
    envelope = readArchivalEnvelope(input);
  } catch (e) {
    if (e instanceof ArchivalCoreError) return refuse(SIGNATURE_OF[e.code]);
    return refuse({ status: 'invalid', reason: 'malformed' });
  }
  const { core } = envelope.signed_core;

  // 2. The core signature, in its own signing domain, with a trusted key only.
  const coreSig = await checkArchivalCoreSignature(envelope.signed_core, trustedKeys);
  if (coreSig === 'unknown_kid')
    return refuse(
      { status: 'unverifiable', reason: 'untrusted_key' },
      keyTrust('unverifiable', 'unknown_kid'),
    );
  if (coreSig === 'invalid')
    return refuse({ status: 'invalid', reason: 'core_signature' }, keyTrust('valid', 'trusted'));

  // 3. The receipt is exactly the bytes the core names.
  if (
    sha256Digest(envelope.receipt) !== core.receipt.digest ||
    Buffer.byteLength(envelope.receipt) !== core.receipt.byte_length
  )
    return refuse({ status: 'invalid', reason: 'receipt_digest_mismatch' }, keyTrust('valid', 'trusted'));

  // 4. The receipt-v1 signature and claims, checked by the receipt-v1 rules at the receipt's own
  //    issuance time (so its current-time expiry is a separate dimension).
  let decoded: ReturnType<typeof decodeReceipt>;
  try {
    decoded = decodeReceipt(envelope.receipt);
  } catch {
    return refuse({ status: 'invalid', reason: 'receipt_malformed' }, keyTrust('valid', 'trusted'));
  }
  const { iss, aud, iat } = decoded.claims;
  // receipt-v1 needs a non-empty issuer and audience; an empty one cannot be verified.
  if (
    typeof iss !== 'string' ||
    typeof aud !== 'string' ||
    !Number.isSafeInteger(iat) ||
    iss.length === 0 ||
    aud.length === 0
  )
    return refuse({ status: 'invalid', reason: 'receipt_malformed' }, keyTrust('valid', 'trusted'));
  let claims: ReceiptV1Claims;
  try {
    claims = await verifyReceiptV1(envelope.receipt, trustedKeys, {
      issuer: iss,
      audience: aud,
      now: new Date((iat as number) * 1000),
    });
  } catch (e) {
    const failure = receiptFailure(e);
    return refuse(
      failure,
      failure.reason === 'untrusted_key'
        ? keyTrust('unverifiable', 'unknown_kid')
        : keyTrust('valid', 'trusted'),
    );
  }

  // 5. The core's own bindings equal the receipt's claims.
  if (
    core.issuer !== claims.iss ||
    core.workspace_id !== claims.workspace_id ||
    core.event_id !== claims.event_id ||
    core.accepted_at !== claims.accepted_at
  )
    return refuse({ status: 'invalid', reason: 'core_receipt_mismatch' }, keyTrust('valid', 'trusted'));

  return {
    checked_at: now.toISOString(),
    signature: { status: 'valid', reason: 'verified' },
    contents: contentsOf(claims, options.content),
    context: contextOf(claims, options.expectedContext),
    witness: witnessOf(envelope.evidence, envelope.signed_core, options.witnessAnchors, now),
    key_trust: keyTrust('valid', 'trusted'),
    live_expiry: {
      // As jose (and so receipt-v1 verification) decides: expired when exp <= now in whole seconds.
      ...(claims.exp <= Math.floor(now.getTime() / 1000)
        ? { status: 'invalid' as const, reason: 'expired' as const }
        : { status: 'valid' as const, reason: 'unexpired' as const }),
      expires_at: new Date(claims.exp * 1000).toISOString(),
    },
    core,
    claims,
  };
}

function contentsOf(
  claims: ReceiptV1Claims,
  content: VerifyArchivalEnvelopeOptions['content'],
): ArchivalVerification['contents'] {
  if (content === undefined) return { status: 'unverifiable', reason: 'content_unavailable' };
  let size: number;
  try {
    size =
      Buffer.byteLength(canonicalJson(content.surface)) + Buffer.byteLength(canonicalJson(content.input));
  } catch {
    return { status: 'invalid', reason: 'content_malformed' };
  }
  if (size > ARCHIVAL_CONTENT_MAX_BYTES) return { status: 'invalid', reason: 'content_oversized' };
  // The revision is the receipt's own; only the Surface and input hashes can differ.
  const mismatched =
    claims.surface.hash !== jsonDigest(content.surface) || claims.input_hash !== jsonDigest(content.input);
  return mismatched
    ? { status: 'invalid', reason: 'content_mismatch' }
    : { status: 'valid', reason: 'verified' };
}

function contextOf(
  claims: ReceiptV1Claims,
  expected: ExpectedArchivalContext | undefined,
): ArchivalVerification['context'] {
  const actual: Record<(typeof CONTEXT_KEYS)[number], string | number> = {
    issuer: claims.iss,
    audience: claims.aud,
    workspace_id: claims.workspace_id,
    session_id: claims.session_id,
    event_id: claims.event_id,
    surface_revision: claims.surface.revision,
    action_id: claims.action.id,
  };
  const checked = CONTEXT_KEYS.filter((k) => expected?.[k] !== undefined);
  const mismatched = checked.filter((k) => expected?.[k] !== actual[k]);
  if (checked.length === 0)
    return { status: 'unverifiable', reason: 'unchecked', checked: [], mismatched: [] };
  if (mismatched.length > 0)
    return { status: 'invalid', reason: 'mismatch', checked: [...checked], mismatched };
  if (!checked.includes('issuer') || !checked.includes('audience'))
    return { status: 'unverifiable', reason: 'incomplete', checked: [...checked], mismatched: [] };
  return { status: 'valid', reason: 'verified', checked: [...checked], mismatched: [] };
}

/**
 * The witness dimension over every evidence entry. A supplied entry is never ignored into a
 * pending state: any malformed or failing entry makes the dimension invalid; otherwise a verified
 * witness entry makes it witnessed (the earliest witness time), then indeterminate, then
 * unsupported (only entries of unknown types or versions).
 */
function witnessOf(
  evidence: readonly unknown[],
  signedCore: SignedArchivalCore,
  anchors: WitnessAnchors | undefined,
  now: Date,
): ArchivalVerification['witness'] {
  if (evidence.length === 0) return { status: 'pending', reason: 'unwitnessed' };
  if (evidence.some((e) => !isObject(e) || typeof e.type !== 'string' || e.type.length === 0))
    return { status: 'invalid', reason: 'malformed_evidence' };
  const results = evidence
    .filter((e) => isObject(e) && e.type === WITNESS_EVIDENCE_TYPE)
    .map((e) => verifyWitnessEvidence(e, signedCore, anchors, now));
  for (const r of results)
    if (r.status === 'invalid')
      return r.reason === 'malformed_evidence'
        ? { status: 'invalid', reason: 'malformed_evidence' }
        : {
            status: 'invalid',
            reason: 'invalid_evidence',
            detail: r.detail ? `${r.reason}:${r.detail}` : r.reason,
          };
  const witnessed = results
    .flatMap((r) => (r.status === 'witnessed' ? [r.witnessedAt.getTime()] : []))
    .sort((a, b) => a - b);
  if (witnessed.length > 0)
    return {
      status: 'witnessed',
      reason: 'verified',
      witnessed_at: new Date(witnessed[0] as number).toISOString(),
    };
  for (const r of results) if (r.status === 'indeterminate') return { status: r.status, reason: r.reason };
  return { status: 'unsupported', reason: 'unsupported_evidence' };
}

// ------------------------------------------------------------------------------------------------
// Presentation: the four user-facing messages, backed by the dimensions above.

export type ArchivalMessage =
  'signature_verified' | 'contents_verified' | 'contents_unavailable' | 'application_context_unchecked';

export interface ArchivalPresentation {
  /** True only when the signature dimension is valid and nothing supplied contradicts it. */
  verified: boolean;
  /** The applicable messages, in this order; empty when not verified. */
  messages: ArchivalMessage[];
  /** Why nothing is verified: the failing dimension and its reason; null when verified. */
  refusal: { dimension: 'signature' | 'contents' | 'context'; reason: string } | null;
  /** Shown beside the messages, never folded into them. */
  witness: WitnessStatus;
  /** Whether live (current-time) verification would refuse it; null when not verified. */
  expired_for_live_use: boolean | null;
}

export function presentArchivalVerification(r: ArchivalVerification): ArchivalPresentation {
  const refused = (
    dimension: 'signature' | 'contents' | 'context',
    reason: string,
  ): ArchivalPresentation => ({
    verified: false,
    messages: [],
    refusal: { dimension, reason },
    witness: r.witness.status,
    expired_for_live_use: null,
  });
  if (r.signature.status !== 'valid' || r.key_trust.status !== 'valid')
    return refused('signature', r.signature.reason);
  if (r.contents.status === 'invalid') return refused('contents', r.contents.reason);
  if (r.context.status === 'invalid') return refused('context', r.context.reason);
  const messages: ArchivalMessage[] = ['signature_verified'];
  messages.push(r.contents.status === 'valid' ? 'contents_verified' : 'contents_unavailable');
  if (r.context.status !== 'valid') messages.push('application_context_unchecked');
  return {
    verified: true,
    messages,
    refusal: null,
    witness: r.witness.status,
    expired_for_live_use: r.live_expiry.status === 'invalid',
  };
}
