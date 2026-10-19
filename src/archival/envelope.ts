// The archival envelope (docs/spec/archival-core-v1.md §3): the exact original receipt-v1 compact
// JWS, the signed archival core that binds it, and detachable preservation evidence bound to that
// core from outside it. The envelope itself is not signed: each part carries its own proof, and
// verifyArchivalEnvelope checks each one independently. Ported from the Sess evidence package
// (envelope.ts) with the same bounds and rejection codes.
import { canonicalJson } from '../receipts/json.js';
import {
  ARCHIVAL_CORE_VERSION,
  ArchivalCoreError,
  exactKeys,
  isObject,
  parseSignedArchivalCore,
  RECEIPT_JWS_MAX_BYTES,
  type SignedArchivalCore,
} from './core.js';

export const ARCHIVAL_ENVELOPE_TYPE = 'sess.archival-envelope';
/** The whole envelope's bound, as JSON text or canonical JSON (receipt, core, evidence). */
export const ARCHIVAL_ENVELOPE_MAX_BYTES = 65_536;
/** At most this many detachable evidence entries. */
export const EVIDENCE_MAX_ENTRIES = 16;

export interface ArchivalEnvelope {
  type: typeof ARCHIVAL_ENVELOPE_TYPE;
  version: typeof ARCHIVAL_CORE_VERSION;
  /** The exact original compact JWS. */
  receipt: string;
  signed_core: SignedArchivalCore;
  /**
   * Detachable preservation evidence, each entry bound to the core from outside it (witness
   * evidence, docs/spec/witness-evidence-v1.md). Empty until a witness attaches one: pending.
   */
  evidence: readonly unknown[];
}

/**
 * Reads untrusted envelope input: JSON text (string or UTF-8 bytes) or an already-parsed value.
 * The size bound applies before parsing (text) or to the canonical form (values). Throws
 * ArchivalCoreError (`oversized`, `malformed`, `wrong_type`, `unknown_version`,
 * `unsupported_algorithm`).
 */
export function readArchivalEnvelope(input: unknown): ArchivalEnvelope {
  let value: unknown = input;
  if (typeof input === 'string' || input instanceof Uint8Array) {
    const bytes = typeof input === 'string' ? Buffer.byteLength(input) : input.byteLength;
    if (bytes > ARCHIVAL_ENVELOPE_MAX_BYTES)
      throw new ArchivalCoreError('oversized', 'archival envelope exceeds its bound');
    const text = typeof input === 'string' ? input : Buffer.from(input).toString('utf8');
    try {
      value = JSON.parse(text);
    } catch {
      throw new ArchivalCoreError('malformed', 'archival envelope is not JSON');
    }
  } else {
    let size: number;
    try {
      size = Buffer.byteLength(canonicalJson(input));
    } catch {
      throw new ArchivalCoreError('malformed', 'archival envelope has no JSON form');
    }
    if (size > ARCHIVAL_ENVELOPE_MAX_BYTES)
      throw new ArchivalCoreError('oversized', 'archival envelope exceeds its bound');
  }
  return parseArchivalEnvelope(value);
}

/** Strictly parses an envelope value (no size check; see readArchivalEnvelope). */
export function parseArchivalEnvelope(value: unknown): ArchivalEnvelope {
  if (!isObject(value))
    throw new ArchivalCoreError('malformed', 'an archival envelope must be a JSON object');
  if (value.type !== ARCHIVAL_ENVELOPE_TYPE)
    throw new ArchivalCoreError('wrong_type', 'not an archival envelope');
  if (value.version !== ARCHIVAL_CORE_VERSION)
    throw new ArchivalCoreError('unknown_version', 'unsupported archival envelope version');
  if (!exactKeys(value, ['type', 'version', 'receipt', 'signed_core', 'evidence']))
    throw new ArchivalCoreError('malformed', 'archival envelope members are not exactly the v1 set');
  if (
    typeof value.receipt !== 'string' ||
    value.receipt.length === 0 ||
    Buffer.byteLength(value.receipt) > RECEIPT_JWS_MAX_BYTES
  )
    throw new ArchivalCoreError('malformed', 'receipt must be the original compact JWS string');
  if (!Array.isArray(value.evidence) || value.evidence.length > EVIDENCE_MAX_ENTRIES)
    throw new ArchivalCoreError(
      'malformed',
      `evidence must be an array of at most ${EVIDENCE_MAX_ENTRIES} entries`,
    );
  const signed = parseSignedArchivalCore(value.signed_core);
  return Object.freeze({
    type: ARCHIVAL_ENVELOPE_TYPE,
    version: ARCHIVAL_CORE_VERSION,
    receipt: value.receipt,
    signed_core: signed,
    evidence: Object.freeze([...value.evidence]),
  });
}
