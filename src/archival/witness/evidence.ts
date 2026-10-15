// Witness evidence version 1 (docs/spec/witness-evidence-v1.md §4-§5): the detachable
// preservation evidence of one receipt's signed archival core, carried as an entry of the archival
// envelope's `evidence` array and bound to the core from outside it. It holds the private opening
// of the core's commitment in its batch, the signed batch checkpoint, the RFC 3161 token over
// SHA-256 of the checkpoint signature, the transparency log entry, renewal tokens (an RFC 4998
// archive timestamp chain) and an informational trust reference, which verification never uses.
//
// Verification is offline and takes every anchor from the caller. Results:
//
//   witnessed      every part verifies; `witnessedAt` (the TSA time) is an upper bound on when the
//                  signed core existed, and `validUntil` how long the token chain can be relied on
//   invalid        a supplied part is malformed or fails verification (never pending)
//   indeterminate  well formed, but historical trust cannot be established: no trust anchors were
//                  supplied, the witness key, TSA or log is not trusted, or the token chain lapsed
//   unsupported    another evidence version
//
// Ported from the Sess evidence package (witness/evidence.ts); building and renewing evidence are
// the issuer's job and are omitted.
import { canonicalJson } from '../../receipts/json.js';
import { isObject, type SignedArchivalCore } from '../core.js';
import type { SignedCheckpoint } from './checkpoint.js';
import { bytesOf, verifyWitnessParts, type WitnessAnchors } from './parts.js';
import { parseTlogEntry } from './rekor.js';
import {
  verifyRenewalChain,
  WITNESS_RENEWAL_HASH,
  WITNESS_RENEWAL_TYPE,
  WITNESS_RENEWALS_MAX,
} from './renewal.js';

export const WITNESS_EVIDENCE_TYPE = 'sess.witness-evidence';
export const WITNESS_EVIDENCE_VERSION = 1;
/** One evidence entry's bound, as canonical JSON. */
export const WITNESS_EVIDENCE_MAX_BYTES = 24 * 1024;
const SOURCE_MAX = 200;
const DIGEST = /^sha256:[0-9a-f]{64}$/;

class WitnessEvidenceError extends Error {
  override name = 'WitnessEvidenceError';
}

const exact = (v: Record<string, unknown>, keys: readonly string[]) =>
  Object.keys(v).length === keys.length && keys.every((k) => Object.hasOwn(v, k));

interface ParsedEvidence {
  opening: unknown;
  checkpoint: SignedCheckpoint;
  token: Uint8Array;
  tlog: unknown;
  renewals: Uint8Array[];
}

/**
 * Strictly reads a version 1 evidence entry's structure (exact members, base64 parts, bounded
 * size and renewals). Throws WitnessEvidenceError. Cryptographic checks are verifyWitnessEvidence's.
 */
function parseWitnessEvidence(value: unknown): ParsedEvidence {
  const fail = (m: string): never => {
    throw new WitnessEvidenceError(m);
  };
  if (!isObject(value)) return fail('evidence must be an object');
  if (value.type !== WITNESS_EVIDENCE_TYPE || value.version !== WITNESS_EVIDENCE_VERSION)
    return fail('not version 1 witness evidence');
  const keys = [
    'type',
    'version',
    'opening',
    'checkpoint',
    'timestamp',
    'tlog',
    'renewals',
    'trust_reference',
  ];
  if (!exact(value, keys)) return fail('evidence members are not exactly the version 1 set');
  let size: number;
  try {
    size = Buffer.byteLength(canonicalJson(value));
  } catch {
    return fail('evidence has no JSON form');
  }
  if (size > WITNESS_EVIDENCE_MAX_BYTES) return fail('evidence exceeds its bound');
  const { checkpoint: c, timestamp: t, renewals, trust_reference: ref } = value;
  if (!isObject(c) || !exact(c, ['bytes', 'signature', 'public_key']))
    return fail('checkpoint must be {bytes, signature, public_key}');
  if (!isObject(t) || !exact(t, ['token'])) return fail('timestamp must be {token}');
  const bytes = bytesOf(c.bytes);
  const signature = bytesOf(c.signature);
  const publicKey = bytesOf(c.public_key);
  const token = bytesOf(t.token);
  if (!bytes || !signature || !publicKey || !token) return fail('parts must be base64');
  if (!isObject(value.opening)) return fail('opening must be an object');
  try {
    parseTlogEntry(value.tlog);
  } catch {
    return fail('tlog is not a transparency log entry');
  }
  if (!Array.isArray(renewals) || renewals.length > WITNESS_RENEWALS_MAX)
    return fail(`renewals must be an array of at most ${WITNESS_RENEWALS_MAX}`);
  const renewalTokens = renewals.map((r) => {
    if (!isObject(r) || !exact(r, ['type', 'version', 'hash_alg', 'token']))
      return fail('a renewal must be {type, version, hash_alg, token}');
    if (r.type !== WITNESS_RENEWAL_TYPE || r.version !== 1 || r.hash_alg !== WITNESS_RENEWAL_HASH)
      return fail('a renewal must be a version 1 sha256 renewal');
    return bytesOf(r.token) ?? fail('a renewal token must be base64');
  });
  if (
    !isObject(ref) ||
    !exact(ref, ['source', 'tuf_root_version', 'trusted_root_digest']) ||
    typeof ref.source !== 'string' ||
    ref.source.length === 0 ||
    ref.source.length > SOURCE_MAX ||
    !Number.isSafeInteger(ref.tuf_root_version) ||
    (ref.tuf_root_version as number) < 1 ||
    typeof ref.trusted_root_digest !== 'string' ||
    !DIGEST.test(ref.trusted_root_digest)
  )
    return fail('trust_reference is malformed');
  return {
    opening: value.opening,
    checkpoint: { bytes, signature, publicKey },
    token,
    tlog: value.tlog,
    renewals: renewalTokens,
  };
}

export type WitnessEvidenceResult =
  | {
      status: 'witnessed';
      /** TSA genTime: the signed core existed no later than this. */
      witnessedAt: Date;
      logIndex: string;
      logUrl: string;
      /** How long the token chain can be relied on (renew before then). */
      validUntil: Date;
      /** The last renewal's time; null when never renewed. */
      renewedAt: Date | null;
    }
  | {
      status: 'invalid';
      reason:
        | 'malformed_evidence'
        | 'opening'
        | 'checkpoint_malformed'
        | 'checkpoint_signature'
        | 'checkpoint_root_mismatch'
        | 'timestamp'
        | 'tlog'
        | 'outside_validity'
        | 'renewal';
      detail?: string;
    }
  | {
      status: 'indeterminate';
      reason:
        | 'witness_trust_unavailable'
        | 'untrusted_witness_key'
        | 'untrusted_tsa'
        | 'unknown_log'
        | 'renewal_lapsed';
    }
  | { status: 'unsupported'; reason: 'unknown_evidence_version' };

/**
 * Verifies one witness evidence entry for `signedCore` at `now`, against the caller's trust
 * anchors (`undefined`: none supplied, so a well-formed entry is indeterminate). Never throws for
 * the entry's content.
 */
export function verifyWitnessEvidence(
  entry: unknown,
  signedCore: SignedArchivalCore,
  anchors: WitnessAnchors | undefined,
  now: Date,
): WitnessEvidenceResult {
  if (isObject(entry) && entry.type === WITNESS_EVIDENCE_TYPE && entry.version !== 1)
    return { status: 'unsupported', reason: 'unknown_evidence_version' };
  let parsed: ParsedEvidence;
  try {
    parsed = parseWitnessEvidence(entry);
  } catch (e) {
    if (e instanceof WitnessEvidenceError) return { status: 'invalid', reason: 'malformed_evidence' };
    throw e;
  }
  if (!anchors) return { status: 'indeterminate', reason: 'witness_trust_unavailable' };
  const r = verifyWitnessParts(
    {
      checkpoint: parsed.checkpoint,
      token: parsed.token,
      tlog: parsed.tlog,
      opening: parsed.opening,
    },
    signedCore,
    anchors,
    1,
  );
  if (r.status === 'unverifiable') return { status: 'indeterminate', reason: r.reason };
  if (r.status === 'unsupported') return { status: 'invalid', reason: 'malformed_evidence' };
  if (r.status === 'invalid') {
    const { reason, detail } = r;
    if (reason === 'malformed_proof') return { status: 'invalid', reason: 'malformed_evidence' };
    return { status: 'invalid', reason, ...(detail ? { detail } : {}) };
  }
  const chain = verifyRenewalChain(
    {
      token: parsed.token,
      genTime: r.witnessedAt,
      validUntil: r.tokenValidUntil,
    },
    parsed.renewals,
    anchors.trustedRoot.tsas,
  );
  if (chain.status !== 'valid') return chain;
  if (chain.validUntil.getTime() < now.getTime())
    return { status: 'indeterminate', reason: 'renewal_lapsed' };
  return {
    status: 'witnessed',
    witnessedAt: r.witnessedAt,
    logIndex: r.logIndex,
    logUrl: r.logUrl,
    validUntil: chain.validUntil,
    renewedAt: chain.renewedAt,
  };
}
