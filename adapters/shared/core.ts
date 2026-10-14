// Canonical shared pure logic for the SESS companion adapters (adapters/CONTRACT.md,
// "Convergence"). Each adapter vendors a byte-identical copy as src/internal/shared.ts and a test
// asserts equality with this file. No package imports this path at runtime.
import { createHash } from 'node:crypto';

/**
 * Deterministic JSON: object keys sorted by UTF-16 code units, no whitespace. Accepts plain JSON
 * values only (null, booleans, finite numbers, strings, dense arrays and plain objects); anything
 * else, including cycles, throws a TypeError.
 */
export function canonicalJson(value: unknown): string {
  return encode(value, new Set());
}

function encode(value: unknown, path: Set<object>): string {
  if (typeof value === 'number' && !Number.isFinite(value))
    throw new TypeError('Canonical JSON accepts finite numbers only.');
  if (value === null || typeof value === 'boolean' || typeof value === 'number' || typeof value === 'string')
    return JSON.stringify(value);
  if (typeof value !== 'object') throw new TypeError('Canonical JSON accepts JSON values only.');
  if (path.has(value)) throw new TypeError('Canonical JSON does not accept cycles.');
  path.add(value);
  try {
    if (Array.isArray(value)) {
      const items: string[] = [];
      for (let index = 0; index < value.length; index += 1) {
        if (!Object.prototype.hasOwnProperty.call(value, index))
          throw new TypeError('Canonical JSON does not accept sparse arrays.');
        items.push(encode(value[index], path));
      }
      return `[${items.join(',')}]`;
    }
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null)
      throw new TypeError('Canonical JSON accepts plain objects only.');
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${encode(record[key], path)}`)
      .join(',')}}`;
  } finally {
    path.delete(value);
  }
}

/** SHA-256 (hex) of the canonical JSON of a mutation body. */
export function bodyDigest(value: unknown): string {
  return createHash('sha256').update(canonicalJson(value), 'utf8').digest('hex');
}

export type VerificationClass = 'transient' | 'configuration' | 'genuine' | 'other';

const TRANSIENT_VERIFICATION_CODES: ReadonlySet<string> = new Set([
  'KEY_RESOLUTION_FAILED',
  'KEY_FETCH_COOLDOWN',
]);
const CONFIGURATION_VERIFICATION_CODES: ReadonlySet<string> = new Set(['VERIFICATION_CONTEXT_MISSING']);

/**
 * Classifies an error thrown by `client.receipts.verifyResponse`. Only `genuine` failures block an
 * interaction; `transient` and `configuration` record nothing and change no state; `other` is
 * handled by the adapter's ordinary SDK error mapping.
 */
export function classifyVerification(error: unknown): VerificationClass {
  if (!error || typeof error !== 'object') return 'other';
  const { kind, code } = error as { kind?: unknown; code?: unknown };
  if (kind !== 'receipt_verification') return 'other';
  if (typeof code === 'string' && TRANSIENT_VERIFICATION_CODES.has(code)) return 'transient';
  if (typeof code === 'string' && CONFIGURATION_VERIFICATION_CODES.has(code)) return 'configuration';
  return 'genuine';
}
