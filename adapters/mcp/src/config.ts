import { homedir } from 'node:os';
import { isAbsolute, join } from 'node:path';
import { AdapterError } from './errors.js';

/**
 * Owner-controlled configuration. It is read from the server process environment only when a tool
 * is first called, never from tool arguments and never at import time.
 */
export interface AdapterConfig {
  apiKey: string;
  /** Normalized API origin, e.g. https://api.sess.si */
  origin: string;
  allowInsecureLocalhost: boolean;
  profile: string;
  stateDir: string;
  receiptIssuer?: string;
  expectedWorkspaceId?: string;
  /** Upper bound and default for one sess_response wait. */
  maxWaitMs: number;
}

export const DEFAULT_ORIGIN = 'https://api.sess.si';
export const DEFAULT_WAIT_MS = 45_000;
export const PROFILE_PATTERN = /^[a-z0-9][a-z0-9_-]{0,31}$/;

/** Environment variable names (documented in README.md). */
export const ENV = {
  apiKey: 'SESS_API_KEY',
  origin: 'SESS_API_ORIGIN',
  insecureLocalhost: 'SESS_MCP_TEST_ALLOW_INSECURE_LOCALHOST',
  profile: 'SESS_MCP_PROFILE',
  stateDir: 'SESS_MCP_STATE_DIR',
  receiptIssuer: 'SESS_RECEIPT_ISSUER',
  workspace: 'SESS_EXPECTED_WORKSPACE_ID',
  maxWait: 'SESS_MCP_MAX_WAIT_MS',
} as const;

function notConfigured(message: string): never {
  throw new AdapterError('NOT_CONFIGURED', message);
}

function loopback(hostname: string): boolean {
  return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '[::1]';
}

export function parseOrigin(value: string | undefined, allowInsecureLocalhost: boolean): string {
  const text = value === undefined || value === '' ? DEFAULT_ORIGIN : value;
  let url: URL;
  try {
    url = new URL(text);
  } catch {
    return notConfigured(`${ENV.origin} must be an absolute origin.`);
  }
  if (
    text !== text.trim() ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    url.pathname !== '/' ||
    !(
      url.protocol === 'https:' ||
      (url.protocol === 'http:' && allowInsecureLocalhost && loopback(url.hostname))
    )
  ) {
    return notConfigured(
      `${ENV.origin} must be an HTTPS origin without credentials, path, query or fragment. HTTP is accepted only for localhost when ${ENV.insecureLocalhost}=1 (testing only).`,
    );
  }
  return url.origin;
}

export function defaultStateDir(env: NodeJS.ProcessEnv, platform = process.platform): string {
  if (platform === 'win32') {
    const base = env.LOCALAPPDATA;
    if (base && isAbsolute(base)) return join(base, 'sess-mcp');
  }
  const xdg = env.XDG_STATE_HOME;
  if (xdg && isAbsolute(xdg)) return join(xdg, 'sess-mcp');
  return join(homedir(), '.local', 'state', 'sess-mcp');
}

export function loadConfig(env: NodeJS.ProcessEnv): AdapterConfig {
  const apiKey = env[ENV.apiKey];
  if (typeof apiKey !== 'string' || !/^[\x21-\x7e]{1,4096}$/.test(apiKey)) {
    return notConfigured(`Set ${ENV.apiKey} in the MCP server environment (never in a tool argument).`);
  }
  const insecure = env[ENV.insecureLocalhost];
  if (insecure !== undefined && insecure !== '' && insecure !== '1' && insecure !== '0') {
    return notConfigured(`${ENV.insecureLocalhost} must be 1 or unset.`);
  }
  const allowInsecureLocalhost = insecure === '1';
  const origin = parseOrigin(env[ENV.origin], allowInsecureLocalhost);
  const profile = env[ENV.profile] || 'default';
  if (!PROFILE_PATTERN.test(profile)) {
    return notConfigured(`${ENV.profile} must match ${PROFILE_PATTERN.source}.`);
  }
  const stateDir = env[ENV.stateDir] || defaultStateDir(env);
  if (!isAbsolute(stateDir)) return notConfigured(`${ENV.stateDir} must be an absolute path.`);
  const receiptIssuer = env[ENV.receiptIssuer] || undefined;
  if (receiptIssuer !== undefined && !/^[\x21-\x7e]{1,2048}$/.test(receiptIssuer)) {
    return notConfigured(`${ENV.receiptIssuer} must be a printable protocol identity.`);
  }
  const expectedWorkspaceId = env[ENV.workspace] || undefined;
  if (expectedWorkspaceId !== undefined && !/^[A-Za-z0-9_-]{1,128}$/.test(expectedWorkspaceId)) {
    return notConfigured(`${ENV.workspace} must be a workspace identifier.`);
  }
  let maxWaitMs = DEFAULT_WAIT_MS;
  const maxWait = env[ENV.maxWait];
  if (maxWait !== undefined && maxWait !== '') {
    if (!/^\d{1,6}$/.test(maxWait) || Number(maxWait) > DEFAULT_WAIT_MS) {
      return notConfigured(`${ENV.maxWait} must be an integer from 0 to ${DEFAULT_WAIT_MS}.`);
    }
    maxWaitMs = Number(maxWait);
  }
  return {
    apiKey,
    origin,
    allowInsecureLocalhost,
    profile,
    stateDir,
    ...(receiptIssuer ? { receiptIssuer } : {}),
    ...(expectedWorkspaceId ? { expectedWorkspaceId } : {}),
    maxWaitMs,
  };
}
