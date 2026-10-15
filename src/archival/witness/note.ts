// Transparency-log checkpoints as signed notes (C2SP signed-note and tlog-checkpoint): a body of
// origin, tree size and base64 root hash lines (plus optional extension lines), a blank line, and
// signature lines "— <name> <base64(key hint || signature)>", where <name> is the log's host
// (Rekor v1's origin line adds " - <tree ID>"; Rekor v2 adds witness cosignature lines, which are
// ignored here). Rekor v1 signs with ECDSA P-256 (SHA-256, DER; key hint = the first four bytes of
// the log ID, SHA-256 of the key's SPKI DER); Rekor v2 signs with Ed25519 (key hint =
// SHA-256(name || 0x0A || 0x01 || raw key)[:4]). Ported from the Sess evidence package
// (witness/note.ts).
import { createHash, createPublicKey, verify } from 'node:crypto';
import { equalBytes, HASH_BYTES } from './merkle.js';

const NOTE_MAX_BYTES = 8 * 1024;

export interface Checkpoint {
  /** The exact signed body (through its final newline). */
  body: Uint8Array;
  origin: string;
  size: bigint;
  root: Uint8Array;
  signatures: { name: string; hint: Uint8Array; signature: Uint8Array }[];
}

export class NoteError extends Error {
  override name = 'NoteError';
}

const B64 = /^[A-Za-z0-9+/]+={0,2}$/;

export function parseCheckpoint(envelope: string): Checkpoint {
  if (typeof envelope !== 'string' || Buffer.byteLength(envelope) > NOTE_MAX_BYTES)
    throw new NoteError('checkpoint is not a bounded string');
  const split = envelope.indexOf('\n\n');
  if (split < 0 || !envelope.endsWith('\n')) throw new NoteError('not a signed note');
  const bodyText = envelope.slice(0, split + 1);
  const lines = bodyText.slice(0, -1).split('\n');
  const [origin, size, root] = lines;
  if (!origin || !size || !root || !/^(0|[1-9]\d{0,19})$/.test(size) || !B64.test(root))
    throw new NoteError('checkpoint body is not origin, size and root hash');
  const rootBytes = new Uint8Array(Buffer.from(root, 'base64'));
  if (rootBytes.length !== HASH_BYTES) throw new NoteError('root hash is not 32 bytes');
  const signatures = envelope
    .slice(split + 2, -1)
    .split('\n')
    .map((line) => {
      const m = /^— (\S+) ([A-Za-z0-9+/]+={0,2})$/.exec(line);
      if (!m) throw new NoteError('malformed signature line');
      const raw = new Uint8Array(Buffer.from(m[2] as string, 'base64'));
      if (raw.length < 5) throw new NoteError('signature too short');
      return { name: m[1] as string, hint: raw.subarray(0, 4), signature: raw.subarray(4) };
    });
  if (signatures.length === 0 || signatures.length > 16)
    throw new NoteError('a checkpoint carries 1-16 signatures');
  return {
    body: new Uint8Array(Buffer.from(bodyText, 'utf8')),
    origin,
    size: BigInt(size),
    root: rootBytes,
    signatures,
  };
}

const ED25519_SPKI_PREFIX = Buffer.from('302a300506032b6570032100', 'hex');

/** The key hint a log key's note signatures carry. */
export function keyHint(name: string, publicKey: Uint8Array, keyDetails: string): Uint8Array {
  if (keyDetails === 'PKIX_ED25519') {
    const raw = Buffer.from(publicKey).subarray(ED25519_SPKI_PREFIX.length);
    return new Uint8Array(
      createHash('sha256')
        .update(Buffer.concat([Buffer.from(`${name}\n`, 'utf8'), Buffer.of(1), raw]))
        .digest()
        .subarray(0, 4),
    );
  }
  return new Uint8Array(createHash('sha256').update(publicKey).digest().subarray(0, 4));
}

/**
 * True when some signature line names the log (`name`: its host, as in the trusted root's base
 * URL), carries the key's hint and verifies over the body with the trusted log key. Other lines
 * (witness cosignatures on Rekor v2) are ignored.
 */
export function verifyCheckpointNote(
  cp: Checkpoint,
  name: string,
  publicKey: Uint8Array,
  keyDetails: string,
): boolean {
  let key: ReturnType<typeof createPublicKey>;
  try {
    key = createPublicKey({ key: Buffer.from(publicKey), format: 'der', type: 'spki' });
  } catch {
    return false;
  }
  const hint = keyHint(name, publicKey, keyDetails);
  return cp.signatures.some((s) => {
    if (s.name !== name || !equalBytes(s.hint, hint)) return false;
    try {
      if (keyDetails === 'PKIX_ED25519') return verify(null, cp.body, key, s.signature);
      if (keyDetails === 'PKIX_ECDSA_P256_SHA_256')
        return verify('sha256', cp.body, { key, dsaEncoding: 'der' }, s.signature);
    } catch {
      return false;
    }
    return false;
  });
}
