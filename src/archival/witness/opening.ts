// The private batch opening of one signed archival core (docs/spec/witness-evidence-v1.md §1).
// Each core in a witness batch is committed with a fresh 256-bit nonce in its own domain:
//
//   commitment = SHA-256(UTF-8(leaf domain) || 0x00 || nonce || SHA-256(JCS(signed core)))
//
// and the commitments are hashed into an RFC 6962 tree whose root the checkpoint states. The
// opening (nonce, index, path) proves that root for these exact signed bytes. Version 1 uses the
// leaf domain "sess.witness.leaf/v1" and opening type "sess.witness-opening"; version 0 is the
// R-V2a spike format, read so that a spike part is recognised (and refused) inside version 1
// evidence exactly as the Sess core refuses it. Ported from the Sess evidence package
// (witness/batch.ts); committing a batch is the issuer's job and is omitted.
import { canonicalJson } from '../../receipts/json.js';
import { isObject, parseSignedArchivalCore, type SignedArchivalCore } from '../core.js';
import type { WitnessFormatVersion } from './checkpoint.js';
import { HASH_BYTES, leafHash, rootFromInclusion, sha256 } from './merkle.js';

const LEAF_FORMATS = {
  0: { domain: 'sess.witness-spike.leaf/0', opening: 'sess.witness-spike-opening' },
  1: { domain: 'sess.witness.leaf/v1', opening: 'sess.witness-opening' },
} as const;
const NONCE_BYTES = 32;
/** At most this many leaves (members plus padding) in one batch tree. */
const BATCH_MAX_LEAVES = 4096;
const MAX_PATH = 12;

/** One member's opening, as witness evidence carries it. */
export interface BatchOpening {
  type: 'sess.witness-spike-opening' | 'sess.witness-opening';
  version: WitnessFormatVersion;
  /** `sha256:<hex>` of the signed core's canonical bytes (what the commitment covers). */
  signed_core_digest: string;
  /** base64 of the 32-byte private nonce. */
  nonce: string;
  leaf_index: number;
  tree_size: number;
  /** base64 sibling hashes, leaf-adjacent first. */
  path: string[];
}

const utf8 = (s: string) => new TextEncoder().encode(s);
const hex = (b: Uint8Array) => Buffer.from(b).toString('hex');

/** The exact signed bytes a commitment covers: JCS of the strictly parsed signed core. */
export function signedCoreBytes(signedCore: SignedArchivalCore): Uint8Array {
  return utf8(canonicalJson(parseSignedArchivalCore(signedCore)));
}

function commitment(
  nonce: Uint8Array,
  signedCoreDigest: Uint8Array,
  version: WitnessFormatVersion,
): Uint8Array {
  if (nonce.length !== NONCE_BYTES || signedCoreDigest.length !== HASH_BYTES)
    throw new RangeError('commitment inputs have fixed sizes');
  const format = LEAF_FORMATS[version];
  if (!format) throw new RangeError('unknown commitment version');
  return sha256(utf8(format.domain), Uint8Array.of(0), nonce, signedCoreDigest);
}

const B64 = /^[A-Za-z0-9+/]*={0,2}$/;
const decode64 = (v: unknown, bytes: number): Uint8Array | null => {
  if (typeof v !== 'string' || !B64.test(v) || v.length % 4 !== 0) return null;
  const b = new Uint8Array(Buffer.from(v, 'base64'));
  return b.length === bytes ? b : null;
};

/**
 * The batch root (and tree size and format version) an opening proves for this signed core, or
 * null when the opening is malformed, of an unknown type and version pair, or is not an opening of
 * these exact signed bytes.
 */
export function openingRoot(
  signedCore: SignedArchivalCore,
  opening: unknown,
): { root: Uint8Array; treeSize: number; version: WitnessFormatVersion } | null {
  if (!isObject(opening)) return null;
  const version = ([0, 1] as const).find(
    (v) => opening.version === v && opening.type === LEAF_FORMATS[v].opening,
  );
  if (version === undefined) return null;
  const keys = ['type', 'version', 'signed_core_digest', 'nonce', 'leaf_index', 'tree_size', 'path'];
  if (Object.keys(opening).length !== keys.length || !keys.every((k) => Object.hasOwn(opening, k)))
    return null;
  const { leaf_index: index, tree_size: size, path } = opening;
  if (
    !Number.isSafeInteger(index) ||
    !Number.isSafeInteger(size) ||
    (size as number) < 1 ||
    (size as number) > BATCH_MAX_LEAVES ||
    !Array.isArray(path) ||
    path.length > MAX_PATH
  )
    return null;
  const nonce = decode64(opening.nonce, NONCE_BYTES);
  const siblings = path.map((p) => decode64(p, HASH_BYTES));
  if (!nonce || siblings.some((s) => s === null)) return null;
  const digest = sha256(signedCoreBytes(signedCore));
  if (opening.signed_core_digest !== `sha256:${hex(digest)}`) return null;
  const root = rootFromInclusion(
    BigInt(index as number),
    BigInt(size as number),
    leafHash(commitment(nonce, digest, version)),
    siblings as Uint8Array[],
  );
  return root ? { root, treeSize: size as number, version } : null;
}
