// The issuer's published witness key set, version 1 (docs/spec/witness-evidence-v1.md §5.1),
// served at `/.well-known/sess-witness-keys.json`: the public ECDSA P-256 witness keys, each with
// its validity window. parseWitnessKeySet reads it strictly into verifier anchors. It is one
// anchor of two: a verifier obtains it from the issuer (or holds an independently distributed
// copy) and the TSAs and logs from the independently distributed trusted root. Nothing inside an
// evidence entry is trusted on its own. Ported from the Sess evidence package
// (witness/key-set.ts); building the published set is the issuer's job and is omitted.
import { createPublicKey, type KeyObject } from 'node:crypto';
import { isObject } from '../core.js';
import { CHECKPOINT_KEY_DETAILS, witnessKeyId } from './checkpoint.js';
import type { TrustedWitnessKey } from './parts.js';

export const WITNESS_KEY_SET_TYPE = 'sess.witness-key-set';
export const WITNESS_KEY_SET_VERSION = 1;
/** At most this many keys (current plus retained) in one published set. */
export const WITNESS_KEY_SET_MAX_KEYS = 32;
const ISSUER_MAX = 200;
const RFC3339 = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/;
const B64 = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;

export class WitnessKeySetError extends Error {
  override name = 'WitnessKeySetError';
}

const isP256 = (k: KeyObject) =>
  k.type === 'public' && k.asymmetricKeyType === 'ec' && k.asymmetricKeyDetails?.namedCurve === 'prime256v1';

/** The SPKI DER of a P-256 public key, re-encoded; throws for anything else. */
function publicSpki(der: Uint8Array): Uint8Array {
  let key: KeyObject;
  try {
    key = createPublicKey({ key: Buffer.from(der), format: 'der', type: 'spki' });
  } catch {
    throw new WitnessKeySetError('a witness key is not an SPKI public key');
  }
  if (!isP256(key)) throw new WitnessKeySetError('a witness key is not ECDSA P-256');
  return new Uint8Array(key.export({ format: 'der', type: 'spki' }));
}

const exact = (v: Record<string, unknown>, keys: readonly string[]) =>
  Object.keys(v).length === keys.length && keys.every((k) => Object.hasOwn(v, k));

function time(v: unknown, name: string): Date {
  if (typeof v !== 'string' || !RFC3339.test(v))
    throw new WitnessKeySetError(`${name} must be an RFC 3339 UTC time`);
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) throw new WitnessKeySetError(`${name} is not a valid time`);
  return d;
}

/**
 * Strictly reads a published version 1 witness key set into verifier anchors
 * (`WitnessAnchors.witnessKeys`). With `expectedIssuer`, the set must name that issuer.
 * Throws WitnessKeySetError for anything else: unknown members, another type or version, a key
 * that is not a P-256 SPKI, a key id that does not name its key, a repeated key or a bad window.
 */
export function parseWitnessKeySet(value: unknown, expectedIssuer?: string): TrustedWitnessKey[] {
  if (!isObject(value) || !exact(value, ['type', 'version', 'issuer', 'keys']))
    throw new WitnessKeySetError('a witness key set has exactly type, version, issuer and keys');
  if (value.type !== WITNESS_KEY_SET_TYPE || value.version !== WITNESS_KEY_SET_VERSION)
    throw new WitnessKeySetError('not a version 1 witness key set');
  if (typeof value.issuer !== 'string' || value.issuer.length === 0 || value.issuer.length > ISSUER_MAX)
    throw new WitnessKeySetError('issuer must be a non-empty string');
  if (expectedIssuer !== undefined && value.issuer !== expectedIssuer)
    throw new WitnessKeySetError('the key set names another issuer');
  if (!Array.isArray(value.keys) || value.keys.length > WITNESS_KEY_SET_MAX_KEYS)
    throw new WitnessKeySetError(`keys must be an array of at most ${WITNESS_KEY_SET_MAX_KEYS}`);
  const seen = new Set<string>();
  return value.keys.map((k: unknown, i: number): TrustedWitnessKey => {
    const at = `keys[${i}]`;
    if (!isObject(k) || !exact(k, ['key_id', 'key_details', 'spki', 'valid_from', 'valid_to']))
      throw new WitnessKeySetError(`${at} has exactly the version 1 members`);
    if (k.key_details !== CHECKPOINT_KEY_DETAILS)
      throw new WitnessKeySetError(`${at}.key_details must be ${CHECKPOINT_KEY_DETAILS}`);
    if (typeof k.spki !== 'string' || k.spki.length === 0 || !B64.test(k.spki))
      throw new WitnessKeySetError(`${at}.spki must be standard base64`);
    const der = new Uint8Array(Buffer.from(k.spki, 'base64'));
    const spki = publicSpki(der);
    if (!Buffer.from(spki).equals(Buffer.from(der)))
      throw new WitnessKeySetError(`${at}.spki is not a canonical SPKI`);
    if (k.key_id !== witnessKeyId(spki)) throw new WitnessKeySetError(`${at}.key_id does not name its key`);
    if (seen.has(k.key_id)) throw new WitnessKeySetError(`${at} repeats a key`);
    seen.add(k.key_id);
    const validFrom = time(k.valid_from, `${at}.valid_from`);
    const validTo = k.valid_to === null ? null : time(k.valid_to, `${at}.valid_to`);
    if (validTo !== null && validTo.getTime() <= validFrom.getTime())
      throw new WitnessKeySetError(`${at}.valid_to must be after valid_from`);
    return { publicKey: spki, validFrom, validTo };
  });
}
