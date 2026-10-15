// Rekor hashedrekord entries for a signed witness checkpoint (entry kind version 0.0.1 from the
// Rekor v1 API, 0.0.2 from Rekor v2), in the Sigstore bundle's TransparencyLogEntry shape, verified
// offline against the caller's trusted log keys:
//
//   - the log is a trusted log (by log ID), never a key carried by the entry;
//   - the canonicalized body is exactly a hashedrekord of this checkpoint's SHA-256, signature and
//     witness key, so the entry commits to the signed checkpoint bytes;
//   - the RFC 6962 inclusion proof leads from SHA-256(0x00 || body) to the proof's root;
//   - the signed checkpoint (note) verifies under the log key, names the log's origin and carries
//     the same tree size and root (verified inclusion, as opposed to a promise);
//   - Rekor v1 only: the signed entry timestamp (an inclusion promise with the log's integrated
//     time) is reported separately; it is not inclusion.
//
// Ported from the Sess evidence package (witness/rekor.ts); request building and response
// normalization, which only the witness worker needs, are omitted.
import { createPublicKey, verify } from 'node:crypto';
import { canonicalJson } from '../../receipts/json.js';
import { isObject } from '../core.js';
import { CHECKPOINT_KEY_DETAILS, type SignedCheckpoint } from './checkpoint.js';
import { equalBytes, HASH_BYTES, leafHash, rootFromInclusion, sha256 } from './merkle.js';
import { NoteError, parseCheckpoint, verifyCheckpointNote } from './note.js';
import type { TrustedLog } from './trusted-root.js';

const MAX_PROOF_HASHES = 64;
const BODY_MAX_BYTES = 16 * 1024;

/** A Sigstore bundle TransparencyLogEntry (protobuf JSON field names). */
export interface TlogEntry {
  logIndex: string;
  logId: { keyId: string };
  kindVersion: { kind: string; version: string };
  /** Rekor v1's integrated time (seconds); "0" on Rekor v2, which has no trusted time. */
  integratedTime: string;
  inclusionPromise?: { signedEntryTimestamp: string };
  inclusionProof: {
    logIndex: string;
    rootHash: string;
    treeSize: string;
    hashes: string[];
    checkpoint: { envelope: string };
  };
  canonicalizedBody: string;
}

const b64 = (b: Uint8Array) => Buffer.from(b).toString('base64');

export class RekorError extends Error {
  override name = 'RekorError';
}

const B64 = /^[A-Za-z0-9+/]*={0,2}$/;
const UINT = /^(0|[1-9]\d{0,19})$/;

function str(v: unknown, what: string): string {
  if (typeof v !== 'string') throw new RekorError(`${what} must be a string`);
  return v;
}
function uint(v: unknown, what: string): string {
  const s = typeof v === 'number' && Number.isSafeInteger(v) && v >= 0 ? String(v) : v;
  if (typeof s !== 'string' || !UINT.test(s)) throw new RekorError(`${what} must be an unsigned integer`);
  return s;
}
function base64(v: unknown, what: string): string {
  const s = str(v, what);
  if (!B64.test(s) || s.length % 4 !== 0) throw new RekorError(`${what} must be base64`);
  return s;
}
function json(bytes: Uint8Array): unknown {
  try {
    return JSON.parse(Buffer.from(bytes).toString('utf8'));
  } catch {
    throw new RekorError('response is not JSON');
  }
}

/** Strictly reads a TransparencyLogEntry value (as stored in witness evidence). */
export function parseTlogEntry(e: unknown): TlogEntry {
  if (!isObject(e) || !isObject(e.logId) || !isObject(e.kindVersion) || !isObject(e.inclusionProof))
    throw new RekorError('not a transparency log entry');
  const p = e.inclusionProof;
  if (!isObject(p.checkpoint)) throw new RekorError('inclusion proof has no checkpoint');
  const hashes = p.hashes ?? [];
  if (!Array.isArray(hashes) || hashes.length > MAX_PROOF_HASHES)
    throw new RekorError('inclusion proof hashes are malformed');
  // Rekor v2 answers `"inclusionPromise": null`: it makes no promise.
  const promise = e.inclusionPromise ?? undefined;
  if (promise !== undefined && !isObject(promise)) throw new RekorError('bad inclusion promise');
  return {
    logIndex: uint(e.logIndex ?? '0', 'logIndex'),
    logId: { keyId: base64(e.logId.keyId, 'logId.keyId') },
    kindVersion: {
      kind: str(e.kindVersion.kind, 'kindVersion.kind'),
      version: str(e.kindVersion.version, 'kindVersion.version'),
    },
    integratedTime: uint(e.integratedTime ?? '0', 'integratedTime'),
    ...(promise
      ? {
          inclusionPromise: {
            signedEntryTimestamp: base64(promise.signedEntryTimestamp, 'signedEntryTimestamp'),
          },
        }
      : {}),
    inclusionProof: {
      logIndex: uint(p.logIndex ?? '0', 'inclusionProof.logIndex'),
      rootHash: base64(p.rootHash, 'inclusionProof.rootHash'),
      treeSize: uint(p.treeSize, 'inclusionProof.treeSize'),
      hashes: hashes.map((h, i) => base64(h, `inclusionProof.hashes[${i}]`)),
      checkpoint: { envelope: str(p.checkpoint.envelope, 'checkpoint.envelope') },
    },
    canonicalizedBody: base64(e.canonicalizedBody, 'canonicalizedBody'),
  };
}

export type TlogVerification =
  | {
      status: 'valid';
      log: TrustedLog;
      logIndex: string;
      /** Rekor v1 integrated time when its inclusion promise verified; otherwise null. */
      promisedTime: Date | null;
      promise: 'verified' | 'absent';
    }
  | {
      status: 'invalid';
      reason:
        | 'malformed_entry'
        | 'entry_mismatch'
        | 'inclusion'
        | 'checkpoint_malformed'
        | 'checkpoint_signature'
        | 'checkpoint_mismatch'
        | 'promise_signature'
        | 'unsupported_log_key';
    }
  | { status: 'unverifiable'; reason: 'unknown_log' };

/** Does the canonicalized body record exactly this signed checkpoint? */
function bodyMatches(body: Uint8Array, kind: TlogEntry['kindVersion'], cp: SignedCheckpoint) {
  const v = json(body);
  if (!isObject(v) || v.kind !== 'hashedrekord' || kind.kind !== 'hashedrekord') return false;
  const digest = sha256(cp.bytes);
  const spec = v.spec;
  if (!isObject(spec)) return false;
  if (v.apiVersion === '0.0.1' && kind.version === '0.0.1') {
    const data = isObject(spec.data) && isObject(spec.data.hash) ? spec.data.hash : null;
    const sig = isObject(spec.signature) ? spec.signature : null;
    const key = sig && isObject(sig.publicKey) ? sig.publicKey.content : null;
    if (!data || !sig || typeof key !== 'string') return false;
    let spki: Uint8Array;
    try {
      spki = new Uint8Array(
        createPublicKey(Buffer.from(key, 'base64').toString('utf8')).export({
          format: 'der',
          type: 'spki',
        }),
      );
    } catch {
      return false;
    }
    return (
      data.algorithm === 'sha256' &&
      data.value === Buffer.from(digest).toString('hex') &&
      sig.content === b64(cp.signature) &&
      equalBytes(spki, cp.publicKey)
    );
  }
  if (v.apiVersion === '0.0.2' && kind.version === '0.0.2') {
    const h = spec.hashedRekordV002;
    if (!isObject(h) || !isObject(h.data) || !isObject(h.signature)) return false;
    const verifier = h.signature.verifier;
    if (!isObject(verifier) || !isObject(verifier.publicKey)) return false;
    return (
      h.data.algorithm === 'SHA2_256' &&
      h.data.digest === b64(digest) &&
      h.signature.content === b64(cp.signature) &&
      verifier.publicKey.rawBytes === b64(cp.publicKey) &&
      verifier.keyDetails === CHECKPOINT_KEY_DETAILS
    );
  }
  return false;
}

/** Verifies a log entry for `cp` offline against the trusted logs. */
export function verifyTlogEntry(
  entry: unknown,
  cp: SignedCheckpoint,
  logs: readonly TrustedLog[],
): TlogVerification {
  let e: TlogEntry;
  try {
    e = parseTlogEntry(entry);
  } catch {
    return { status: 'invalid', reason: 'malformed_entry' };
  }
  const log = logs.find((l) => l.logId === e.logId.keyId);
  if (!log) return { status: 'unverifiable', reason: 'unknown_log' };
  if (log.keyDetails !== 'PKIX_ED25519' && log.keyDetails !== 'PKIX_ECDSA_P256_SHA_256')
    return { status: 'invalid', reason: 'unsupported_log_key' };
  const body = new Uint8Array(Buffer.from(e.canonicalizedBody, 'base64'));
  if (body.length === 0 || body.length > BODY_MAX_BYTES)
    return { status: 'invalid', reason: 'malformed_entry' };
  try {
    if (!bodyMatches(body, e.kindVersion, cp)) return { status: 'invalid', reason: 'entry_mismatch' };
  } catch {
    return { status: 'invalid', reason: 'entry_mismatch' };
  }
  const p = e.inclusionProof;
  const root = new Uint8Array(Buffer.from(p.rootHash, 'base64'));
  const path = p.hashes.map((h) => new Uint8Array(Buffer.from(h, 'base64')));
  const computed = rootFromInclusion(BigInt(p.logIndex), BigInt(p.treeSize), leafHash(body), path);
  if (!computed || root.length !== HASH_BYTES || !equalBytes(computed, root))
    return { status: 'invalid', reason: 'inclusion' };
  let note: ReturnType<typeof parseCheckpoint>;
  try {
    note = parseCheckpoint(p.checkpoint.envelope);
  } catch (err) {
    if (err instanceof NoteError) return { status: 'invalid', reason: 'checkpoint_malformed' };
    throw err;
  }
  const host = new URL(log.baseUrl).host;
  if (note.origin !== host && !note.origin.startsWith(`${host} - `))
    return { status: 'invalid', reason: 'checkpoint_mismatch' };
  if (!verifyCheckpointNote(note, host, log.publicKey, log.keyDetails))
    return { status: 'invalid', reason: 'checkpoint_signature' };
  if (note.size !== BigInt(p.treeSize) || !equalBytes(note.root, root))
    return { status: 'invalid', reason: 'checkpoint_mismatch' };

  let promisedTime: Date | null = null;
  if (e.inclusionPromise) {
    // Rekor v1 SET: the log's signature over canonical {body, integratedTime, logID, logIndex}.
    const payload = canonicalJson({
      body: e.canonicalizedBody,
      integratedTime: Number(e.integratedTime),
      logID: Buffer.from(e.logId.keyId, 'base64').toString('hex'),
      logIndex: Number(e.logIndex),
    });
    let ok = false;
    try {
      const key = createPublicKey({ key: Buffer.from(log.publicKey), format: 'der', type: 'spki' });
      ok =
        log.keyDetails === 'PKIX_ECDSA_P256_SHA_256' &&
        verify(
          'sha256',
          Buffer.from(payload),
          { key, dsaEncoding: 'der' },
          Buffer.from(e.inclusionPromise.signedEntryTimestamp, 'base64'),
        );
    } catch {
      ok = false;
    }
    if (!ok) return { status: 'invalid', reason: 'promise_signature' };
    promisedTime = new Date(Number(e.integratedTime) * 1000);
  }
  return {
    status: 'valid',
    log,
    logIndex: e.logIndex,
    promisedTime,
    promise: promisedTime ? 'verified' : 'absent',
  };
}
