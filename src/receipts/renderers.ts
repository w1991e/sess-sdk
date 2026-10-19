// Decision 0009 Amendment 13: the renderer identities a receipt's `surface.renderer_version` may
// name. A receipt verifies when its identity is one this release bundles, or is on a list signed
// with the issuer's trusted receipt keys, so a future Sess page change needs no SDK update.
//
// The issuer publishes the list at `<issuer>/.well-known/sess-renderer-identities.json`
// (DOCS/spec/receipt-v1.md §10): one JWS in the RFC 7515 flattened JSON serialization
// {"protected", "payload", "signature"}, protected header {"alg": "EdDSA", "kid",
// "typ": "sess-renderer-identities+jwt"}, payload the RFC 8785 canonical JSON
// {"iat", "identities": [{"renderer_version", "since"}, …], "iss", "seq",
// "sess_renderer_identities": 1}. `seq` is the list's edition (higher in every later published
// edition; a copy re-signed unchanged keeps it) and `iat` when that copy was signed (NumericDate);
// the signature covers both. The list only grows; a list is trusted only through its signature,
// never because it was supplied beside a receipt. Authentic lists are ordered by `seq`, with
// containment as the cross-check (newerRendererList); an older list proves the identities it
// holds and never their absence.
import { compactVerify, importJWK } from 'jose';
import {
  abortError,
  canonicalJson,
  exactKeys,
  isRecord,
  snapshotJson,
  verificationError,
  waitWithSignal,
} from './json.js';
import type { ReceiptPublicKey } from './verify.js';

/** One listed identity and the UTC date it was added. */
export interface RendererIdentity {
  renderer_version: string;
  since: string;
}

/** A verified list: its edition, when that copy was signed, and its identities in order. */
export interface RendererList {
  seq: number;
  iat: number;
  identities: readonly RendererIdentity[];
}

/**
 * The issuer's list as published when this SDK was released (edition 1). Its identities are
 * always accepted for their issuer's receipts; a fetched or supplied list is cross-checked
 * against it.
 */
export const BUNDLED_RENDERER_LIST: Readonly<{ seq: number; identities: readonly RendererIdentity[] }> =
  Object.freeze({
    seq: 1,
    identities: Object.freeze([
      Object.freeze({ renderer_version: 'sess-html-form-1', since: '2026-10-09' }),
      Object.freeze({ renderer_version: 'sess-html-form-2', since: '2026-10-18' }),
    ]),
  });

/** The identities known when this SDK was released; always accepted for their issuer's receipts. */
export const BUNDLED_RENDERER_IDENTITIES: readonly string[] = Object.freeze(
  BUNDLED_RENDERER_LIST.identities.map((i) => i.renderer_version),
);

/** Where an issuer publishes its signed list (application/json). */
export const RENDERER_IDENTITIES_PATH = '/.well-known/sess-renderer-identities.json';
export const MAX_RENDERER_IDENTITIES_BYTES = 64 * 1024;

/** The published document: the signed list, as a flattened JWS JSON serialization. */
export interface RendererIdentitiesDocument {
  protected: string;
  payload: string;
  signature: string;
}

const PART = /^[A-Za-z0-9_-]+$/;
const KID = /^[A-Za-z0-9._-]{1,64}$/;
const IDENTITY = /^[a-z0-9][a-z0-9.-]{0,63}$/;
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const TYP = 'sess-renderer-identities+jwt';

const invalid = (message: string) => verificationError('INVALID_RENDERER_LIST', message);

function decode(segment: string): string {
  const bytes = Buffer.from(segment, 'base64url');
  if (bytes.toString('base64url') !== segment) throw invalid('The renderer list is not canonical base64url.');
  try {
    return new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes);
  } catch {
    throw invalid('The renderer list does not contain valid UTF-8 JSON.');
  }
}

function json(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    throw invalid('The renderer list is not JSON.');
  }
}

/**
 * Verifies a signed renderer-identity list under the issuer's trusted keys. `keyFor` resolves the
 * list's kid to a trusted public key (undefined: not trusted). Returns the verified edition: its
 * seq, its iat and its identities, in order. It must agree with the bundled list
 * (newerRendererList), or it is refused.
 */
export async function verifyRendererList(
  document: unknown,
  context: {
    issuer: string;
    keyFor: (kid: string) => Promise<ReceiptPublicKey | undefined>;
    signal?: AbortSignal;
  },
): Promise<RendererList> {
  const value = snapshotJson(document);
  if (
    !isRecord(value) ||
    !exactKeys(value, ['protected', 'payload', 'signature']) ||
    ![value.protected, value.payload, value.signature].every((p) => typeof p === 'string' && PART.test(p)) ||
    Buffer.byteLength(canonicalJson(value), 'utf8') > MAX_RENDERER_IDENTITIES_BYTES
  ) {
    throw invalid('The renderer list is not a signed renderer-identity document.');
  }
  const { protected: protectedHeader, payload, signature } = value as unknown as RendererIdentitiesDocument;
  const header = json(decode(protectedHeader));
  if (
    !isRecord(header) ||
    !exactKeys(header, ['alg', 'kid', 'typ']) ||
    header.alg !== 'EdDSA' ||
    header.typ !== TYP ||
    typeof header.kid !== 'string' ||
    !KID.test(header.kid)
  ) {
    throw invalid('The renderer list has an unsupported protected header.');
  }
  const signal = context.signal;
  const publicKey = await context.keyFor(header.kid);
  if (!publicKey) throw invalid('The renderer list is not signed with a trusted key.');
  try {
    const key = await waitWithSignal(
      importJWK({ ...publicKey, key_ops: ['verify'], ext: false }, 'EdDSA'),
      signal,
    );
    await waitWithSignal(
      compactVerify(`${protectedHeader}.${payload}.${signature}`, key, { algorithms: ['EdDSA'] }),
      signal,
    );
  } catch {
    if (signal?.aborted) throw abortError(signal);
    throw invalid('The renderer list signature did not verify with the trusted key.');
  }
  const text = decode(payload);
  const claims = json(text);
  if (canonicalJson(claims) !== text) throw invalid('The renderer list payload is not canonical JSON.');
  if (
    !isRecord(claims) ||
    !exactKeys(claims, ['iat', 'identities', 'iss', 'seq', 'sess_renderer_identities']) ||
    claims.sess_renderer_identities !== 1 ||
    !positiveInteger(claims.seq) ||
    !positiveInteger(claims.iat) ||
    !Array.isArray(claims.identities) ||
    claims.identities.length === 0
  ) {
    throw invalid('The renderer list payload has an unsupported shape.');
  }
  if (claims.iss !== context.issuer) throw invalid('The renderer list is from another issuer.');
  const seen = new Set<string>();
  for (const item of claims.identities) {
    if (
      !isRecord(item) ||
      !exactKeys(item, ['renderer_version', 'since']) ||
      typeof item.renderer_version !== 'string' ||
      !IDENTITY.test(item.renderer_version) ||
      seen.has(item.renderer_version) ||
      typeof item.since !== 'string' ||
      !DAY.test(item.since) ||
      !Number.isFinite(Date.parse(`${item.since}T00:00:00Z`)) ||
      new Date(`${item.since}T00:00:00Z`).toISOString().slice(0, 10) !== item.since
    ) {
      throw invalid('The renderer list has a malformed or repeated identity.');
    }
    seen.add(item.renderer_version);
  }
  const list: RendererList = Object.freeze({
    seq: claims.seq as number,
    iat: claims.iat as number,
    identities: Object.freeze(
      (claims.identities as RendererIdentity[]).map((i) =>
        Object.freeze({ renderer_version: i.renderer_version, since: i.since }),
      ),
    ),
  });
  // An authentic list that disagrees with the edition this release bundles is refused.
  newerRendererList(BUNDLED_RENDERER_LIST, list);
  return list;
}

const positiveInteger = (v: unknown): v is number =>
  typeof v === 'number' && Number.isSafeInteger(v) && v >= 1;

/**
 * Of two authentic lists of one issuer, the newer edition (the higher seq; for one seq, either:
 * they list the same identities). Containment is the cross-check: the newer list must begin with
 * every identity of the older, in order and with the same dates, and two lists of one seq must
 * list the same identities. Lists that disagree are refused with INVALID_RENDERER_LIST, never
 * merged.
 */
export function newerRendererList<
  A extends { seq: number; identities: readonly RendererIdentity[] },
  B extends { seq: number; identities: readonly RendererIdentity[] },
>(a: A, b: B): A | B {
  const [older, newer]: [A | B, A | B] = b.seq < a.seq ? [b, a] : [a, b];
  const prefix =
    newer.identities.length >= older.identities.length &&
    older.identities.every(
      (o, i) =>
        newer.identities[i]?.renderer_version === o.renderer_version &&
        newer.identities[i]?.since === o.since,
    );
  if (!prefix || (older.seq === newer.seq && newer.identities.length !== older.identities.length)) {
    throw invalid('The renderer lists disagree.');
  }
  return newer;
}
