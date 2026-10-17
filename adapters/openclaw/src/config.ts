import { createHash } from 'node:crypto';
import { fail } from './errors.js';

export const DEFAULT_ORIGIN = 'https://api.sess.si';
export const DEFAULT_API_KEY_ENV = 'SESS_API_KEY';
/** Requested live-wait default (spec 6.3), clamped below by the qualified host limit. */
export const DEFAULT_WAIT_BUDGET_MS = 45_000;
/** Largest operator-configurable wait; see compatibility.json for the qualified host evidence. */
export const MAX_WAIT_BUDGET_MS = 120_000;

/** Owner-controlled profile. Tool arguments can never supply or change any of these values. */
export interface AdapterConfig {
  readonly baseUrl: string;
  readonly apiKeyEnv: string;
  readonly receiptIssuer?: string;
  readonly expectedWorkspaceId?: string;
  readonly waitBudgetMs: number;
  /** Test-only: permits plain-HTTP loopback origins for isolated runtime evidence. */
  readonly allowInsecureLocalhost: boolean;
}

/** The plugin config JSON Schema; openclaw.plugin.json carries an identical copy (tested). */
export const CONFIG_JSON_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    baseUrl: {
      type: 'string',
      maxLength: 2048,
      description: 'Sess API origin. Defaults to https://api.sess.si. HTTPS only.',
    },
    apiKeyEnv: {
      type: 'string',
      pattern: '^[A-Z][A-Z0-9_]{0,63}$',
      description:
        'Name of the Gateway environment variable that holds the Sess API key (default SESS_API_KEY). Never put the key itself in config or chat.',
    },
    receiptIssuer: { type: 'string', minLength: 1, maxLength: 2048 },
    expectedWorkspaceId: { type: 'string', minLength: 1, maxLength: 256 },
    waitBudgetMs: { type: 'integer', minimum: 1000, maximum: MAX_WAIT_BUDGET_MS },
    allowInsecureLocalhost: {
      type: 'boolean',
      description: 'Test-only. Allows an http://localhost origin for an isolated local Sess runtime.',
    },
  },
} as const;

const KNOWN = new Set(Object.keys(CONFIG_JSON_SCHEMA.properties));
const LOOPBACK = new Set(['localhost', '127.0.0.1', '[::1]']);

function text(value: unknown, name: string, max: number): string {
  if (typeof value !== 'string' || value.length === 0 || value.length > max || /[\u0000- \u007f]/.test(value))
    fail(
      'CONFIGURATION',
      `Plugin config ${name} must be a nonempty string without spaces or control characters.`,
    );
  return value;
}

function origin(value: string, allowInsecureLocalhost: boolean): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return fail('CONFIGURATION', 'Plugin config baseUrl must be an absolute origin.');
  }
  const loopback = LOOPBACK.has(url.hostname);
  if (
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    url.pathname !== '/' ||
    !(url.protocol === 'https:' || (url.protocol === 'http:' && allowInsecureLocalhost && loopback))
  )
    fail(
      'CONFIGURATION',
      'Plugin config baseUrl must be an HTTPS origin without credentials, path, query or fragment; plain HTTP is allowed only for loopback with allowInsecureLocalhost.',
    );
  if (allowInsecureLocalhost && !loopback)
    fail('CONFIGURATION', 'allowInsecureLocalhost is test-only and requires a loopback baseUrl.');
  return url.origin;
}

/** Strict, closed parse of the owner's plugin config. Performs no I/O and reads no secrets. */
export function parseConfig(raw: unknown): AdapterConfig {
  const source = raw ?? {};
  if (
    typeof source !== 'object' ||
    Array.isArray(source) ||
    Object.getPrototypeOf(source) !== Object.prototype
  )
    fail('CONFIGURATION', 'Plugin config must be an object.');
  for (const key of Object.keys(source))
    if (!KNOWN.has(key)) fail('CONFIGURATION', 'Plugin config has an unsupported property.');
  const input = source as Record<string, unknown>;
  const allowInsecureLocalhost = input.allowInsecureLocalhost ?? false;
  if (typeof allowInsecureLocalhost !== 'boolean')
    fail('CONFIGURATION', 'Plugin config allowInsecureLocalhost must be a boolean.');
  const baseUrl = origin(
    input.baseUrl === undefined ? DEFAULT_ORIGIN : text(input.baseUrl, 'baseUrl', 2048),
    allowInsecureLocalhost,
  );
  const apiKeyEnv = input.apiKeyEnv === undefined ? DEFAULT_API_KEY_ENV : input.apiKeyEnv;
  if (typeof apiKeyEnv !== 'string' || !/^[A-Z][A-Z0-9_]{0,63}$/.test(apiKeyEnv))
    fail('CONFIGURATION', 'Plugin config apiKeyEnv must name an environment variable.');
  const waitBudgetMs = input.waitBudgetMs ?? DEFAULT_WAIT_BUDGET_MS;
  if (
    typeof waitBudgetMs !== 'number' ||
    !Number.isSafeInteger(waitBudgetMs) ||
    waitBudgetMs < 1000 ||
    waitBudgetMs > MAX_WAIT_BUDGET_MS
  )
    fail(
      'CONFIGURATION',
      `Plugin config waitBudgetMs must be an integer from 1000 to ${MAX_WAIT_BUDGET_MS}.`,
    );
  return Object.freeze({
    baseUrl,
    apiKeyEnv,
    ...(input.receiptIssuer !== undefined
      ? { receiptIssuer: text(input.receiptIssuer, 'receiptIssuer', 2048) }
      : {}),
    ...(input.expectedWorkspaceId !== undefined
      ? { expectedWorkspaceId: text(input.expectedWorkspaceId, 'expectedWorkspaceId', 256) }
      : {}),
    waitBudgetMs,
    allowInsecureLocalhost,
  });
}

export interface ResolvedCredential {
  readonly apiKey: string;
  /** Non-secret, stored-only scope identity: a different key or origin is a different scope. */
  readonly generation: string;
}

/** Reads the owner's key from the Gateway environment at invocation time, never at import. */
export function resolveCredential(
  config: AdapterConfig,
  env: Readonly<Record<string, string | undefined>> = process.env,
): ResolvedCredential {
  const apiKey = env[config.apiKeyEnv];
  if (typeof apiKey !== 'string' || !/^[\x21-\x7e]{1,4096}$/.test(apiKey))
    fail(
      'CREDENTIAL_MISSING',
      `The Sess API key is not available to the Gateway process (environment variable ${config.apiKeyEnv}).`,
    );
  const generation = createHash('sha256')
    .update(`sess-openclaw-credential-v1\n${config.baseUrl}\n${apiKey}`)
    .digest('hex')
    .slice(0, 32);
  return Object.freeze({ apiKey, generation });
}
