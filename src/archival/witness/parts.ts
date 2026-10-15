// The part verifier one receipt's witness rests on: the private opening, the signed checkpoint,
// the RFC 3161 token over SHA-256 of the checkpoint signature, and the transparency log entry with
// its inclusion proof and signed log checkpoint. Every trust anchor comes from the caller: the
// independently distributed trusted root (logs, TSAs) and the issuer's witness keys. Nothing in
// the evidence is trusted on its own.
//
// Result: `witnessed` (with the TSA time, an upper bound on when the signed core existed),
// `invalid` (a supplied part is malformed or fails verification: never pending), `unverifiable`
// (no trusted anchor for a part: wrong or rotated-out root, unknown log, untrusted witness key).
// Ported from the Sess evidence package (witness/proof.ts, verifyWitnessParts); the spike's
// version 0 proof container is not part of the SDK, but the parts verifier keeps its format
// version parameter so a version 0 part inside version 1 evidence is refused exactly as in Sess.
import type { SignedArchivalCore } from '../core.js';
import {
  CheckpointError,
  parseCheckpointBytes,
  type SignedCheckpoint,
  verifyCheckpointSignature,
  type WitnessFormatVersion,
} from './checkpoint.js';
import { equalBytes, sha256 } from './merkle.js';
import { openingRoot } from './opening.js';
import { verifyTlogEntry } from './rekor.js';
import { activeAt, type TrustedRoot } from './trusted-root.js';
import { verifyTimestampToken } from './tsa.js';

/** A witness key the caller trusts, with the window in which it may have signed. */
export interface TrustedWitnessKey {
  /** DER SubjectPublicKeyInfo (ECDSA P-256). */
  publicKey: Uint8Array;
  validFrom: Date;
  validTo: Date | null;
}

/**
 * Witness trust anchors from the caller: an independently distributed trusted root (the TSAs and
 * logs, e.g. Sigstore's `trusted_root.json`, see parseTrustedRoot) and the issuer's published
 * witness key set (see parseWitnessKeySet). Never taken from the envelope.
 */
export interface WitnessAnchors {
  trustedRoot: TrustedRoot;
  witnessKeys: readonly TrustedWitnessKey[];
}

const B64 = /^[A-Za-z0-9+/]*={0,2}$/;
/** Non-empty strict standard base64 as bytes, or null. */
export const bytesOf = (v: unknown): Uint8Array | null =>
  typeof v === 'string' && v.length > 0 && v.length % 4 === 0 && B64.test(v)
    ? new Uint8Array(Buffer.from(v, 'base64'))
    : null;

/** The signed checkpoint, token, log entry and private opening one receipt's witness rests on. */
export interface WitnessParts {
  checkpoint: SignedCheckpoint;
  /** DER TimeStampToken over SHA-256(checkpoint.signature). */
  token: Uint8Array;
  /** A TransparencyLogEntry value (strictly read by the log verifier). */
  tlog: unknown;
  opening: unknown;
}

export type WitnessPartsResult =
  | {
      status: 'witnessed';
      /** TSA genTime: the signed core existed no later than this. */
      witnessedAt: Date;
      logIndex: string;
      logUrl: string;
      /** Rekor v1 inclusion promise time, when present and verified. */
      promisedAt: Date | null;
      /** The token chain's notAfter (what renewal extends). */
      tokenValidUntil: Date;
    }
  | {
      status: 'invalid';
      reason:
        | 'malformed_proof'
        | 'opening'
        | 'checkpoint_malformed'
        | 'checkpoint_signature'
        | 'checkpoint_root_mismatch'
        | 'timestamp'
        | 'tlog'
        | 'outside_validity';
      detail?: string;
    }
  | {
      status: 'unverifiable';
      reason: 'untrusted_witness_key' | 'untrusted_tsa' | 'unknown_log';
    }
  | { status: 'unsupported'; reason: 'unknown_proof_type' };

/**
 * Verifies the parts of one receipt's witness in a single format version: the opening and the
 * checkpoint must both be of `version` (another format's part never stands in for this one's).
 */
export function verifyWitnessParts(
  parts: WitnessParts,
  signedCore: SignedArchivalCore,
  options: WitnessAnchors,
  version: WitnessFormatVersion,
): WitnessPartsResult {
  const { bytes, signature, publicKey } = parts.checkpoint;

  // 1. The private opening ties these exact signed core bytes to a batch root.
  let opened: ReturnType<typeof openingRoot>;
  try {
    opened = openingRoot(signedCore, parts.opening);
  } catch {
    opened = null;
  }
  if (!opened || opened.version !== version) return { status: 'invalid', reason: 'opening' };

  // 2. The checkpoint states that root, in the same format, under a trusted witness key.
  let checkpoint: ReturnType<typeof parseCheckpointBytes>;
  try {
    checkpoint = parseCheckpointBytes(bytes);
  } catch (err) {
    if (err instanceof CheckpointError) return { status: 'invalid', reason: 'checkpoint_malformed' };
    throw err;
  }
  if (
    checkpoint.root !== `sha256:${Buffer.from(opened.root).toString('hex')}` ||
    checkpoint.tree_size !== opened.treeSize ||
    checkpoint.issuer !== signedCore.core.issuer ||
    checkpoint.version !== version
  )
    return { status: 'invalid', reason: 'checkpoint_root_mismatch' };
  const key = options.witnessKeys.find((k) => equalBytes(k.publicKey, publicKey));
  if (!key) return { status: 'unverifiable', reason: 'untrusted_witness_key' };
  if (!verifyCheckpointSignature(bytes, signature, publicKey))
    return { status: 'invalid', reason: 'checkpoint_signature' };

  // 3. The TSA timestamped exactly the checkpoint signature bytes.
  const ts = verifyTimestampToken(parts.token, sha256(signature), options.trustedRoot.tsas);
  if (ts.status === 'unverifiable') return { status: 'unverifiable', reason: 'untrusted_tsa' };
  if (ts.status === 'invalid') return { status: 'invalid', reason: 'timestamp', detail: ts.reason };

  // 4. The log holds exactly this signed checkpoint, with verified inclusion.
  const log = verifyTlogEntry(parts.tlog, parts.checkpoint, options.trustedRoot.tlogs);
  if (log.status === 'unverifiable') return { status: 'unverifiable', reason: 'unknown_log' };
  if (log.status === 'invalid') return { status: 'invalid', reason: 'tlog', detail: log.reason };

  // 5. The witness key and the log key were valid at the timestamp.
  if (!activeAt(key, ts.genTime) || !activeAt(log.log, ts.genTime))
    return { status: 'invalid', reason: 'outside_validity' };
  return {
    status: 'witnessed',
    witnessedAt: ts.genTime,
    logIndex: log.logIndex,
    logUrl: log.log.baseUrl,
    promisedAt: log.promisedTime,
    tokenValidUntil: ts.validUntil,
  };
}
