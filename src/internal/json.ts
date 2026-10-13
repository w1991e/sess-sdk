import { SessError } from '../errors.js';

/** Copy only ordinary JSON, never invoke accessors or toJSON coercions. */
export function snapshotJson<T>(input: T): T {
  const active = new Set<object>();
  function copy(value: unknown, depth: number): unknown {
    if (depth > 128) throw new Error();
    if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
    if (typeof value === 'number') {
      if (!Number.isFinite(value) || Object.is(value, -0)) throw new Error();
      return value;
    }
    if (typeof value !== 'object' || active.has(value)) throw new Error();
    if (Object.getOwnPropertySymbols(value).length) throw new Error();
    // Hidden toJSON and inherited Array-subclass semantics must not be silently erased.
    const descriptors = Object.getOwnPropertyDescriptors(value);
    for (const [name, descriptor] of Object.entries(descriptors)) {
      if (!('value' in descriptor) || (name === 'toJSON' && typeof descriptor.value === 'function'))
        throw new Error();
    }
    active.add(value);
    try {
      if (Array.isArray(value)) {
        if (Object.getPrototypeOf(value) !== Array.prototype) throw new Error();
        if (Object.keys(value).length !== value.length) throw new Error();
        return Array.from({ length: value.length }, (_, i) => {
          const descriptor = Object.getOwnPropertyDescriptor(value, String(i));
          if (!descriptor || !('value' in descriptor)) throw new Error();
          return copy(descriptor.value, depth + 1);
        });
      }
      if (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null)
        throw new Error();
      const result: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
      for (const key of Object.keys(value)) {
        const descriptor = Object.getOwnPropertyDescriptor(value, key)!;
        if (!('value' in descriptor)) throw new Error();
        if (descriptor.value !== undefined) result[key] = copy(descriptor.value, depth + 1);
      }
      return result;
    } finally {
      active.delete(value);
    }
  }
  try {
    return copy(input, 0) as T;
  } catch {
    throw new SessError('configuration', 'Request must contain ordinary JSON values without coercion.', {
      code: 'INVALID_JSON',
      outcome: 'not_sent',
    });
  }
}

export function serializeBody(input: unknown): string {
  const serialized = JSON.stringify(snapshotJson(input));
  if (Buffer.byteLength(serialized, 'utf8') > 256 * 1024) {
    throw new SessError('configuration', 'Request body exceeds the 256 KiB limit.', {
      code: 'PAYLOAD_TOO_LARGE',
      outcome: 'not_sent',
    });
  }
  return serialized;
}
