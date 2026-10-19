// The Sigstore trusted root (application/vnd.dev.sigstore.trustedroot+json;version=0.1): the
// transparency logs and timestamp authorities a verifier trusts. The caller obtains it
// independently (for example from Sigstore's TUF repository, checked against a pinned root) and
// passes it in; witness verification takes its keys and chains from here, never from the
// evidence. Only the members the witness uses are read. Ported from the Sess evidence package
// (witness/trusted-root.ts); the signing configuration, which only the witness worker needs, is
// omitted.
import { isObject } from '../core.js';
import type { TrustedTsa } from './tsa.js';

export const TRUSTED_ROOT_MEDIA_TYPE = 'application/vnd.dev.sigstore.trustedroot+json;version=0.1';

export class TrustedRootError extends Error {
  override name = 'TrustedRootError';
}

/** A transparency log the caller trusts. */
export interface TrustedLog {
  baseUrl: string;
  /** DER SubjectPublicKeyInfo. */
  publicKey: Uint8Array;
  /** Sigstore PublicKeyDetails, e.g. PKIX_ECDSA_P256_SHA_256 or PKIX_ED25519. */
  keyDetails: string;
  /** The log ID (base64 of its key ID bytes). */
  logId: string;
  validFrom: Date;
  validTo: Date | null;
}

/** The logs and timestamp authorities the caller trusts. */
export interface TrustedRoot {
  tlogs: TrustedLog[];
  tsas: TrustedTsa[];
}

const B64 = /^[A-Za-z0-9+/]*={0,2}$/;

function bytes(v: unknown, what: string): Uint8Array {
  if (typeof v !== 'string' || v.length === 0 || v.length % 4 !== 0 || !B64.test(v))
    throw new TrustedRootError(`${what} must be base64`);
  return new Uint8Array(Buffer.from(v, 'base64'));
}

function time(v: unknown, what: string): Date {
  if (typeof v !== 'string') throw new TrustedRootError(`${what} must be a timestamp`);
  const d = new Date(v);
  if (Number.isNaN(d.getTime()) || !/^\d{4}-\d{2}-\d{2}T/.test(v))
    throw new TrustedRootError(`${what} must be an RFC 3339 timestamp`);
  return d;
}

function validFor(v: unknown, what: string): { validFrom: Date; validTo: Date | null } {
  if (!isObject(v)) throw new TrustedRootError(`${what}.validFor is required`);
  return {
    validFrom: time(v.start, `${what}.validFor.start`),
    validTo: v.end === undefined ? null : time(v.end, `${what}.validFor.end`),
  };
}

function httpsUrl(v: unknown, what: string): string {
  if (typeof v !== 'string') throw new TrustedRootError(`${what} must be a URL`);
  let u: URL;
  try {
    u = new URL(v);
  } catch {
    throw new TrustedRootError(`${what} must be a URL`);
  }
  if (u.protocol !== 'https:' || u.username || u.password || u.hash)
    throw new TrustedRootError(`${what} must be a plain https URL`);
  return v;
}

function json(input: Uint8Array): Record<string, unknown> {
  let value: unknown;
  try {
    value = JSON.parse(Buffer.from(input).toString('utf8'));
  } catch {
    throw new TrustedRootError('not JSON');
  }
  if (!isObject(value)) throw new TrustedRootError('not a JSON object');
  return value;
}

/**
 * Reads the bytes of a Sigstore `trusted_root.json` you obtained and checked yourself (for
 * example a TUF-verified target). Throws TrustedRootError for anything it cannot read strictly.
 * Fetching or checking the file's distribution is the caller's responsibility: this function
 * makes no network request.
 */
export function parseTrustedRoot(input: Uint8Array | string): TrustedRoot {
  const v = json(typeof input === 'string' ? new TextEncoder().encode(input) : input);
  if (v.mediaType !== TRUSTED_ROOT_MEDIA_TYPE)
    throw new TrustedRootError('unsupported trusted root media type');
  if (!Array.isArray(v.tlogs) || !Array.isArray(v.timestampAuthorities))
    throw new TrustedRootError('tlogs and timestampAuthorities are required');
  const tlogs = v.tlogs.map((t, i): TrustedLog => {
    const what = `tlogs[${i}]`;
    if (!isObject(t) || !isObject(t.publicKey) || !isObject(t.logId))
      throw new TrustedRootError(`${what} is malformed`);
    if (t.hashAlgorithm !== 'SHA2_256') throw new TrustedRootError(`${what} hash is not SHA2_256`);
    if (typeof t.publicKey.keyDetails !== 'string')
      throw new TrustedRootError(`${what}.publicKey.keyDetails is required`);
    return {
      baseUrl: httpsUrl(t.baseUrl, `${what}.baseUrl`),
      publicKey: bytes(t.publicKey.rawBytes, `${what}.publicKey.rawBytes`),
      keyDetails: t.publicKey.keyDetails,
      logId: Buffer.from(bytes(t.logId.keyId, `${what}.logId.keyId`)).toString('base64'),
      ...validFor(t.publicKey.validFor, what),
    };
  });
  const tsas = v.timestampAuthorities.map((t, i): TrustedTsa => {
    const what = `timestampAuthorities[${i}]`;
    if (!isObject(t) || !isObject(t.certChain) || !Array.isArray(t.certChain.certificates))
      throw new TrustedRootError(`${what} is malformed`);
    const certChain = t.certChain.certificates.map((c, j) =>
      bytes(isObject(c) ? c.rawBytes : undefined, `${what}.certChain[${j}]`),
    );
    if (certChain.length === 0) throw new TrustedRootError(`${what} has no certificates`);
    return { certChain, uri: httpsUrl(t.uri, `${what}.uri`), ...validFor(t.validFor, what) };
  });
  return { tlogs, tsas };
}

export const activeAt = (s: { validFrom: Date; validTo: Date | null }, at: Date): boolean =>
  at.getTime() >= s.validFrom.getTime() && (s.validTo === null || at.getTime() < s.validTo.getTime());
