import canonicalize from 'canonicalize';
import { createHash } from 'node:crypto';
import { SessError } from '../errors.js';

/** JSON-shaped values returned by a verifier are copies, protected at every depth. */
export type DeepReadonly<T> = T extends readonly (infer U)[]
  ? readonly DeepReadonly<U>[]
  : T extends object
    ? { readonly [P in keyof T]: DeepReadonly<T[P]> }
    : T;

export function verificationError(code: string, message: string): SessError {
  return new SessError('receipt_verification', message, { code });
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

export function wellFormedUnicode(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(++index);
      if (!(next >= 0xdc00 && next <= 0xdfff)) return false;
    } else if (code >= 0xdc00 && code <= 0xdfff) return false;
  }
  return true;
}

export function exactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  return Object.keys(value).length === keys.length && keys.every((key) => Object.hasOwn(value, key));
}

/**
 * Copy data without invoking accessors/toJSON or coercing non-JSON business values.
 * This helper intentionally does not freeze data owned by the application.
 */
export function snapshotJson<T>(input: T): T {
  const ancestors = new Set<object>();
  let remaining = 200_000;
  const visit = (value: unknown, depth: number): unknown => {
    if (--remaining < 0 || depth > 128) {
      throw verificationError('INVALID_JSON', 'Verification data exceeds the supported JSON complexity.');
    }
    if (value === null || typeof value === 'boolean') return value;
    if (typeof value === 'string') {
      if (!wellFormedUnicode(value))
        throw verificationError('INVALID_JSON', 'Verification data must contain well-formed Unicode.');
      return value;
    }
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    if (typeof value !== 'object' || value === null) {
      throw verificationError('INVALID_JSON', 'Verification data must be JSON without coercion.');
    }
    if (ancestors.has(value) || Object.getOwnPropertySymbols(value).length !== 0) {
      throw verificationError('INVALID_JSON', 'Verification data must be acyclic JSON.');
    }
    const array = Array.isArray(value);
    const prototype = Object.getPrototypeOf(value);
    if (array && prototype !== Array.prototype) {
      throw verificationError('INVALID_JSON', 'Verification arrays must have ordinary JSON array semantics.');
    }
    if (!array && prototype !== Object.prototype && prototype !== null) {
      throw verificationError('INVALID_JSON', 'Verification data must contain only plain JSON objects.');
    }
    ancestors.add(value);
    try {
      if (array) {
        const descriptors = Object.getOwnPropertyDescriptors(value);
        if (Object.keys(descriptors).some((key) => key !== 'length' && !/^(?:0|[1-9][0-9]*)$/.test(key))) {
          throw verificationError('INVALID_JSON', 'Verification arrays cannot have named properties.');
        }
        return Array.from({ length: value.length }, (_, index) => {
          const descriptor = descriptors[String(index)];
          if (!descriptor || !('value' in descriptor)) {
            throw verificationError(
              'INVALID_JSON',
              'Verification arrays cannot be sparse or contain accessors.',
            );
          }
          return visit(descriptor.value, depth + 1);
        });
      }
      const result: Record<string, unknown> = {};
      for (const [key, descriptor] of Object.entries(Object.getOwnPropertyDescriptors(value))) {
        if (!wellFormedUnicode(key) || !descriptor.enumerable || !('value' in descriptor)) {
          throw verificationError(
            'INVALID_JSON',
            'Verification objects cannot contain accessors or hidden properties.',
          );
        }
        Object.defineProperty(result, key, {
          value: visit(descriptor.value, depth + 1),
          enumerable: true,
          configurable: true,
          writable: true,
        });
      }
      return result;
    } finally {
      ancestors.delete(value);
    }
  };
  return visit(input, 0) as T;
}

export function deepFreeze<T>(value: T): DeepReadonly<T> {
  if (value !== null && typeof value === 'object') {
    for (const child of Object.values(value)) deepFreeze(child);
    Object.freeze(value);
  }
  return value as DeepReadonly<T>;
}

export function canonicalJson(value: unknown): string {
  try {
    const result = canonicalize(value);
    if (result !== undefined) return result;
  } catch {
    // Dependencies' exceptions may contain caller data; expose only a fixed explanation.
  }
  throw verificationError('INVALID_JSON', 'Verification data is not canonicalizable JSON.');
}

export function jsonDigest(value: unknown): string {
  return `sha256:${createHash('sha256').update(canonicalJson(value), 'utf8').digest('hex')}`;
}

export function checkedInstant(value: unknown): number | undefined {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value))
    return undefined;
  const millis = Date.parse(value);
  return Number.isFinite(millis) && new Date(millis).toISOString() === value ? millis : undefined;
}

export function abortError(signal: AbortSignal): SessError {
  return signal.reason instanceof SessError && signal.reason.kind === 'timeout'
    ? new SessError('timeout', 'Verification exceeded its deadline.')
    : new SessError('aborted', 'Verification was cancelled.');
}

/** Race a promise without cancelling shared work; always remove this waiter's listener. */
export async function waitWithSignal<T>(promise: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return promise;
  if (signal.aborted) {
    void promise.catch(() => {});
    throw abortError(signal);
  }
  return new Promise<T>((resolve, reject) => {
    const aborted = () => {
      cleanup();
      reject(abortError(signal));
    };
    const cleanup = () => signal.removeEventListener('abort', aborted);
    signal.addEventListener('abort', aborted, { once: true });
    promise.then(
      (result) => {
        cleanup();
        resolve(result);
      },
      (error: unknown) => {
        cleanup();
        reject(error);
      },
    );
  });
}
