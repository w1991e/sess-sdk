/**
 * Unsafe argument keys. The MCP library's request parsing drops keys such as `__proto__` before a
 * tool handler runs (v1 and v2 alike), which would silently change what the caller sent, so every
 * transport inspects the raw JSON-RPC message first and rejects such tool calls.
 */
export const UNSAFE_KEYS: ReadonlySet<string> = new Set(['__proto__', 'constructor', 'prototype']);

/** Maximum nesting inspected; anything deeper is treated as unsafe. */
export const MAX_GUARD_DEPTH = 64;

export function hasUnsafeKey(value: unknown, depth = 0): boolean {
  if (!value || typeof value !== 'object' || depth > MAX_GUARD_DEPTH) return depth > MAX_GUARD_DEPTH;
  if (Array.isArray(value)) return value.some((item) => hasUnsafeKey(item, depth + 1));
  return Object.keys(value).some(
    (key) => UNSAFE_KEYS.has(key) || hasUnsafeKey((value as Record<string, unknown>)[key], depth + 1),
  );
}

/** A raw JSON-RPC message that is a tools/call request whose arguments carry an unsafe key. */
export function isUnsafeToolCall(message: unknown): boolean {
  if (!message || typeof message !== 'object' || Array.isArray(message)) return false;
  const m = message as { method?: unknown; params?: { arguments?: unknown } };
  return m.method === 'tools/call' && hasUnsafeKey(m.params?.arguments);
}

export const UNSAFE_KEY_MESSAGE = 'arguments: unsafe key (__proto__, constructor or prototype)';
