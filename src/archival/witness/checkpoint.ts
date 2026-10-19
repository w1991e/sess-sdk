// The signed batch checkpoint (docs/spec/witness-evidence-v1.md §2): the bytes that are
// timestamped and logged. It names the issuer, the issuer's batch number, the (padded) tree size
// and the batch root, and nothing about any tenant or decision. Its bytes are
//
//   UTF-8(domain) || 0x00 || JCS(checkpoint)
//
// where the domain and type are versioned: version 1 uses "sess.witness.checkpoint/v1" and type
// "sess.witness-checkpoint"; version 0 is the R-V2a spike format, read so that a spike checkpoint
// inside version 1 evidence is refused exactly as the Sess core refuses it. Signed with ECDSA P-256
// / SHA-256 (DER) under the issuer's dedicated witness key. Ported from the Sess evidence package
// (witness/checkpoint.ts); building and signing are the issuer's job and are omitted.
import { createPublicKey, type KeyObject, verify } from 'node:crypto';
import { canonicalJson } from '../../receipts/json.js';
import { isObject } from '../core.js';
import { sha256 } from './merkle.js';

/** 0: the R-V2a spike format; 1: the production format. */
export type WitnessFormatVersion = 0 | 1;
const CHECKPOINT_FORMATS = {
  0: { domain: 'sess.witness-spike.checkpoint/0', type: 'sess.witness-spike-checkpoint' },
  1: { domain: 'sess.witness.checkpoint/v1', type: 'sess.witness-checkpoint' },
} as const;
/** Sigstore PublicKeyDetails name of the checkpoint signing algorithm. */
export const CHECKPOINT_KEY_DETAILS = 'PKIX_ECDSA_P256_SHA_256';
const CHECKPOINT_MAX_BYTES = 1024;
const ISSUER_MAX = 200;

export interface WitnessCheckpoint {
  type: 'sess.witness-spike-checkpoint' | 'sess.witness-checkpoint';
  version: WitnessFormatVersion;
  /** The receipt issuer (`iss`), the only identifier: no tenant, workspace or event. */
  issuer: string;
  /** The issuer's batch number. */
  batch: number;
  /** The padded batch tree size. */
  tree_size: number;
  /** `sha256:<hex>` batch tree root. */
  root: string;
}

export interface SignedCheckpoint {
  /** The exact checkpoint bytes (domain tag, 0x00, JCS). */
  bytes: Uint8Array;
  /** DER ECDSA P-256 signature over `bytes` with SHA-256. */
  signature: Uint8Array;
  /** DER SubjectPublicKeyInfo of the witness key. */
  publicKey: Uint8Array;
}

const DIGEST = /^sha256:[0-9a-f]{64}$/;

export class CheckpointError extends Error {
  override name = 'CheckpointError';
}

function check(cp: unknown): WitnessCheckpoint {
  if (!isObject(cp)) throw new CheckpointError('a checkpoint must be an object');
  const keys = ['type', 'version', 'issuer', 'batch', 'tree_size', 'root'];
  if (Object.keys(cp).length !== keys.length || !keys.every((k) => Object.hasOwn(cp, k)))
    throw new CheckpointError('checkpoint members are not exactly the checkpoint set');
  const format = cp.version === 0 || cp.version === 1 ? CHECKPOINT_FORMATS[cp.version] : undefined;
  if (!format || cp.type !== format.type)
    throw new CheckpointError('not a witness checkpoint of a known version');
  if (
    typeof cp.issuer !== 'string' ||
    cp.issuer.length === 0 ||
    cp.issuer.length > ISSUER_MAX ||
    /\s/.test(cp.issuer) ||
    [...cp.issuer].some((ch) => (ch.codePointAt(0) as number) < 0x20 || ch === '\u007f')
  )
    throw new CheckpointError('issuer must be a non-empty identifier');
  for (const k of ['batch', 'tree_size'] as const)
    if (!Number.isSafeInteger(cp[k]) || (cp[k] as number) < 1)
      throw new CheckpointError(`${k} must be a positive integer`);
  if (typeof cp.root !== 'string' || !DIGEST.test(cp.root))
    throw new CheckpointError('root must be sha256:<64 lowercase hex>');
  return {
    type: format.type,
    version: cp.version as WitnessFormatVersion,
    issuer: cp.issuer,
    batch: cp.batch as number,
    tree_size: cp.tree_size as number,
    root: cp.root,
  };
}

const domainTag = (version: WitnessFormatVersion) =>
  Buffer.from(`${CHECKPOINT_FORMATS[version].domain}\u0000`, 'utf8');

/**
 * Strictly reads checkpoint bytes: a known version's domain tag, 0x00 and exactly canonical JCS
 * whose type and version are that domain's.
 */
export function parseCheckpointBytes(bytes: Uint8Array): WitnessCheckpoint {
  if (bytes.length > CHECKPOINT_MAX_BYTES) throw new CheckpointError('checkpoint exceeds its bound');
  const version = ([0, 1] as const).find((v) =>
    Buffer.from(bytes.subarray(0, domainTag(v).length)).equals(domainTag(v)),
  );
  if (version === undefined) throw new CheckpointError('not in the checkpoint signing domain');
  const tag = domainTag(version);
  let value: unknown;
  const text = Buffer.from(bytes.subarray(tag.length)).toString('utf8');
  try {
    value = JSON.parse(text);
  } catch {
    throw new CheckpointError('checkpoint is not JSON');
  }
  const cp = check(value);
  if (cp.version !== version) throw new CheckpointError('checkpoint version differs from its domain');
  if (canonicalJson(cp) !== text) throw new CheckpointError('checkpoint is not canonical');
  return cp;
}

function assertP256(key: KeyObject) {
  if (key.asymmetricKeyType !== 'ec' || key.asymmetricKeyDetails?.namedCurve !== 'prime256v1')
    throw new CheckpointError('the witness key must be ECDSA P-256');
}

/** True when `signature` is a valid witness signature over `bytes` by the SPKI key. */
export function verifyCheckpointSignature(
  bytes: Uint8Array,
  signature: Uint8Array,
  publicKey: Uint8Array,
): boolean {
  try {
    const key = createPublicKey({ key: Buffer.from(publicKey), format: 'der', type: 'spki' });
    assertP256(key);
    return verify('sha256', bytes, { key, dsaEncoding: 'der' }, signature);
  } catch {
    return false;
  }
}

/** `sha256:<hex>` of a witness key's SPKI DER: how trusted configuration names it. */
export const witnessKeyId = (publicKey: Uint8Array) =>
  `sha256:${Buffer.from(sha256(publicKey)).toString('hex')}`;
