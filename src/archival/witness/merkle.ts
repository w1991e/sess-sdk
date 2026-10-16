// RFC 6962 / RFC 9162 Merkle tree hashing: leaf hash SHA-256(0x00 || data), interior node
// SHA-256(0x01 || left || right), and the root an inclusion path implies. The same construction
// serves the private batch tree (opening.ts) and the transparency log's proofs (rekor.ts). Ported
// from the Sess evidence package (witness/merkle.ts); tree building is an issuer concern and is
// omitted.
import { createHash, timingSafeEqual } from 'node:crypto';

export const HASH_BYTES = 32;

export const sha256 = (...parts: Uint8Array[]): Uint8Array => {
  const h = createHash('sha256');
  for (const p of parts) h.update(p);
  return new Uint8Array(h.digest());
};

export const leafHash = (data: Uint8Array): Uint8Array => sha256(Uint8Array.of(0), data);
export const nodeHash = (left: Uint8Array, right: Uint8Array): Uint8Array =>
  sha256(Uint8Array.of(1), left, right);

export const equalBytes = (a: Uint8Array, b: Uint8Array): boolean =>
  a.length === b.length && timingSafeEqual(a, b);

/**
 * The root an inclusion path implies (RFC 9162 §2.1.3.2), or null when the path cannot belong to
 * a tree of `size` at `index` (wrong length, index outside the tree). BigInt indices: log sizes
 * are 64-bit.
 */
export function rootFromInclusion(
  index: bigint,
  size: bigint,
  leaf: Uint8Array,
  path: readonly Uint8Array[],
): Uint8Array | null {
  if (index < 0n || size <= 0n || index >= size) return null;
  if (leaf.length !== HASH_BYTES || path.some((p) => p.length !== HASH_BYTES)) return null;
  let fn = index;
  let sn = size - 1n;
  let r = leaf;
  for (const p of path) {
    if (sn === 0n) return null;
    if ((fn & 1n) === 1n || fn === sn) {
      r = nodeHash(p, r);
      while ((fn & 1n) === 0n && fn !== 0n) {
        fn >>= 1n;
        sn >>= 1n;
      }
    } else r = nodeHash(r, p);
    fn >>= 1n;
    sn >>= 1n;
  }
  return sn === 0n ? r : null;
}
