// Decision 0009 Amendment 13: the renderer identities a receipt's `surface.renderer_version` may
// name. A receipt verifies when its identity is one this release bundles, or is on a list signed
// with the issuer's trusted receipt keys, so a future Sess page change needs no SDK update.
//
// The issuer publishes the list at `<issuer>/.well-known/sess-renderer-identities.json`
// (DOCS/spec/receipt-v1.md §10): one JWS in the RFC 7515 flattened JSON serialization
// {"protected", "payload", "signature"}, protected header {"alg": "EdDSA", "kid",
// "typ": "sess-renderer-identities+jwt"}, payload the RFC 8785 canonical JSON
// {"identities": [{"renderer_version", "since"}, …], "iss", "sess_renderer_identities": 1}.
// The list only grows; a list is trusted only through its signature, never because it was
// supplied beside a receipt.
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

/** The identities known when this SDK was released; always accepted for their issuer's receipts. */
export const BUNDLED_RENDERER_IDENTITIES: readonly string[] = Object.freeze([
  'sess-html-form-1',
  'sess-html-form-2',
]);

/** Where an issuer publishes its signed list (application/json). */
export const RENDERER_IDENTITIES_PATH = '/.well-known/sess-renderer-identities.json';
export const MAX_RENDERER_IDENTITIES_BYTES = 64 * 1024;

/** The published document: the signed list, as a flattened JWS JSON serialization. */
export interface RendererIdentitiesDocument {
  protected: string;
  payload: string;
  signature: string;
}

/** One listed identity and the UTC date it was added. */
export interface RendererIdentity {
  renderer_version: string;
  since: string;
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
 * list's kid to a trusted public key (undefined: not trusted). Returns the identities, in order.
 */
export async function verifyRendererList(
  document: unknown,
  context: {
    issuer: string;
    keyFor: (kid: string) => Promise<ReceiptPublicKey | undefined>;
    signal?: AbortSignal;
  },
): Promise<readonly RendererIdentity[]> {
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
    !exactKeys(claims, ['identities', 'iss', 'sess_renderer_identities']) ||
    claims.sess_renderer_identities !== 1 ||
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
  return Object.freeze(
    (claims.identities as RendererIdentity[]).map((i) =>
      Object.freeze({ renderer_version: i.renderer_version, since: i.since }),
    ),
  );
}
