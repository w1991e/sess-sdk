// The one network use of `sess verify`: without --keys, one GET of the issuer's published receipt
// key set (<issuer>/.well-known/sess-receipt-keys.json, receipt-v1 §4). HTTPS only, no credential,
// no redirect, no cookie, a 5-second deadline and the SDK's 256 KiB key-set bound; the set is then
// validated by the SDK's own strict reader (validateKeySet). Nothing else is ever sent.
import { MAX_RECEIPT_KEY_SET_BYTES, validateKeySet, type ReceiptKeySet } from '../receipts/verify.js';

export const RECEIPT_KEYS_PATH = '/.well-known/sess-receipt-keys.json';
const FETCH_TIMEOUT_MS = 5_000;

export type FetchKeys = (input: string, init: RequestInit) => Promise<Response>;

/** The published key-set URL of an issuer that is an HTTPS origin (exactly), else undefined. */
export function keySetUrl(issuer: string): string | undefined {
  let url: URL;
  try {
    url = new URL(issuer);
  } catch {
    return undefined;
  }
  if (url.protocol !== 'https:' || url.username || url.password || url.origin !== issuer) return undefined;
  return `${url.origin}${RECEIPT_KEYS_PATH}`;
}

export type PublishedKeys =
  | { ok: true; keys: ReceiptKeySet }
  /** unreachable: no 200 answer in time; unusable: an answer that is not a valid key set. */
  | { ok: false; why: 'unreachable' | 'unusable' };

/** Fetches and validates the published key set once. Never throws. */
export async function fetchPublishedKeys(url: string, fetchImpl: FetchKeys): Promise<PublishedKeys> {
  let response: Response;
  try {
    response = await fetchImpl(url, {
      method: 'GET',
      redirect: 'error',
      credentials: 'omit',
      cache: 'no-store',
      referrerPolicy: 'no-referrer',
      headers: { accept: 'application/json' },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
  } catch {
    return { ok: false, why: 'unreachable' };
  }
  if (response.status !== 200 || !response.body) {
    await response.body?.cancel().catch(() => undefined);
    return { ok: false, why: 'unreachable' };
  }
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    const reader = response.body.getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_RECEIPT_KEY_SET_BYTES) {
        await reader.cancel().catch(() => undefined);
        return { ok: false, why: 'unusable' };
      }
      chunks.push(value);
    }
  } catch {
    return { ok: false, why: 'unreachable' };
  }
  try {
    const text = new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks));
    return { ok: true, keys: validateKeySet(JSON.parse(text) as unknown) };
  } catch {
    return { ok: false, why: 'unusable' };
  }
}
