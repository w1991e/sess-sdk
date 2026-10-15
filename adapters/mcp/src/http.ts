import { AsyncLocalStorage } from 'node:async_hooks';
import { toNodeHandler, type NodeMcpRequestHandler } from '@modelcontextprotocol/node';
import {
  SERVER_INFO_META_KEY,
  createMcpHandler,
  isJsonContentType,
  isLegacyRequest,
  readRequestBody,
  validateHostHeader,
} from '@modelcontextprotocol/server';
import { Sess, type SessOptions } from '@sess.si/sdk';
import { DEFAULT_WAIT_MS, parseOrigin } from './config.js';
import { AdapterError, type Diagnostics } from './errors.js';
import { UNSAFE_KEY_MESSAGE, isUnsafeToolCall } from './guard.js';
import { SessMcpAdapter, type OperationContext, type SessClient } from './operations.js';
import { SERVER_NAME, buildToolServer, failure } from './server.js';
import { grantBinding, sameBinding, type GrantBinding, type HandleStore } from './store.js';
import { VERSION } from './version.js';

export {
  AUTHORITY_ID_PATTERN,
  MAX_ACTIVE_RECORDS,
  RECORD_SCHEMA,
  WORKSPACE_ID_PATTERN,
  assertBindingAccess,
  decodeRecord,
  generateHandle,
  grantBinding,
  type Binding,
  type GrantAuthority,
  type GrantBinding,
  type HandleRecord,
  type HandleStore,
  type PendingMutation,
  type ProcessedTransition,
  type RecoveryState,
  type VerifiedAnswer,
} from './store.js';
export { AdapterError, type AdapterErrorCode, type Diagnostics } from './errors.js';
export type { SessClient } from './operations.js';

/**
 * The authority of one HTTP request, resolved server-side by the composer's `authenticate` hook
 * (for example from a verified OAuth access token and its consent grant). It never comes from
 * tool arguments, a browser-supplied workspace or the transport connection.
 */
export interface PrincipalContext {
  workspaceId: string;
  /** User or service principal. */
  principalId: string;
  /** The agent host (OAuth client) the grant was issued to. */
  clientId: string;
  grantId: string;
  /** Stable across token refresh; changes when the grant is revoked or re-issued. */
  grantGeneration: string;
  scopes: readonly string[];
  /**
   * The credential the tools present to the SESS API for this principal. It is read for every SESS
   * request, so a refreshed value takes effect at once. It is never logged, never returned to the
   * agent and never derived from the MCP request's own bearer token by this handler.
   */
  credential: () => string | Promise<string>;
}

export interface SessMcpHttpHandlerOptions {
  /**
   * Required. Authenticates one request from its method, URL and headers (the body is not
   * readable here) and returns its principal, or `undefined` for a 401 challenge. Token
   * verification (issuer, audience/resource, expiry, revocation) belongs to this hook.
   */
  authenticate(request: Request): PrincipalContext | undefined | Promise<PrincipalContext | undefined>;
  /**
   * Opens the handle store view bound to `binding`, at most once per request and only when a tool
   * that needs it is called. The returned store's `binding` must equal `binding`.
   */
  handleStore(binding: GrantBinding, principal: PrincipalContext): HandleStore | Promise<HandleStore>;
  /** Scopes every request must hold; a principal without one gets 403 insufficient_scope. */
  requiredScopes: readonly string[];
  /** Allowed `Host` hostnames (port-agnostic; IPv6 in brackets). Required, never empty. */
  allowedHosts: readonly string[];
  /**
   * Exact browser origins (scheme://host[:port]) allowed to call. A request without `Origin`
   * (non-browser clients) is accepted; any other present value is refused. Default: none.
   */
  allowedOrigins?: readonly string[];
  /** SESS API origin (HTTPS; loopback HTTP only with `allowInsecureLocalhost`, for tests). */
  apiOrigin: string;
  allowInsecureLocalhost?: boolean;
  /** RFC 9728 protected-resource metadata URL advertised in `WWW-Authenticate`. */
  resourceMetadataUrl?: string;
  receiptIssuer?: string;
  /** Bounded body size in bytes (default 256 KiB). */
  maxBodyBytes?: number;
  /**
   * Per-request deadline in milliseconds (default 60 s). When it passes, an in-flight
   * sess_response wait or read ends as `needs_resume`. A create, publish or complete already sent
   * is never abandoned mid-flight (its outcome would become unknown); the SESS client's own
   * timeouts bound those.
   */
  requestTimeoutMs?: number;
  /** Upper bound and default for one sess_response wait (default and maximum 45 s). */
  maxWaitMs?: number;
  /** Fixed event names with primitive, secret-free fields. Default: no output. */
  diagnostics?: Diagnostics;
  /** Test seam: builds the SESS client from the resolved options. */
  createClient?: (options: SessOptions) => SessClient;
  now?: () => Date;
}

export interface SessMcpHttpHandler {
  /** Web-standard face: serves one HTTP request. */
  fetch(request: Request): Promise<Response>;
  /** `node:http` face (`(req, res)`), built with `@modelcontextprotocol/node`. */
  node: NodeMcpRequestHandler;
  close(): Promise<void>;
}

export const DEFAULT_MAX_BODY_BYTES = 256 * 1024;
export const DEFAULT_REQUEST_TIMEOUT_MS = 60_000;

interface RequestScope {
  principal: PrincipalContext;
  binding: GrantBinding;
  deadline: AbortSignal;
}

const json = (status: number, body: unknown, headers: Record<string, string> = {}): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store', ...headers },
  });

const rpcError = (status: number, code: number, message: string, id: unknown = null): Response =>
  json(status, { jsonrpc: '2.0', error: { code, message }, id });

function quoted(value: string): string {
  return `"${value.replace(/[\\"]/g, '\\$&')}"`;
}

function positiveInteger(value: number | undefined, fallback: number, name: string, max?: number): number {
  const n = value ?? fallback;
  if (!Number.isSafeInteger(n) || n < 1 || (max !== undefined && n > max))
    throw new TypeError(`createSessMcpHttpHandler: ${name} must be a positive integer${max ? ` up to ${max}` : ''}.`);
  return n;
}

function normalizedOrigin(value: string): string {
  const url = new URL(value);
  if ((url.protocol !== 'https:' && url.protocol !== 'http:') || url.origin !== value.replace(/\/$/, ''))
    throw new TypeError('createSessMcpHttpHandler: allowedOrigins entries must be exact origins.');
  return url.origin;
}

function validPrincipal(p: unknown): p is PrincipalContext {
  if (!p || typeof p !== 'object') return false;
  const v = p as Record<string, unknown>;
  return (
    typeof v.credential === 'function' &&
    Array.isArray(v.scopes) &&
    v.scopes.every((s) => typeof s === 'string')
  );
}

/**
 * Stateless Streamable HTTP composition of the five tools: one `createMcpHandler` factory with its
 * default stateless legacy fallback serves 2026-07-28 and 2025-era clients from one endpoint, with
 * a fresh server and adapter per request. In front of the SDK entry: Host/Origin validation, the
 * required `authenticate` hook (401/403 challenges), a bounded body, the raw-body unsafe-key
 * guard (answered in the request's era) and a per-request deadline. The handler never derives
 * `authInfo` from headers, never passes a bearer token to the tools and keeps no state between
 * requests; handle state lives in the injected store.
 */
export function createSessMcpHttpHandler(options: SessMcpHttpHandlerOptions): SessMcpHttpHandler {
  if (typeof options?.authenticate !== 'function')
    throw new TypeError('createSessMcpHttpHandler: authenticate(request) is required.');
  if (typeof options.handleStore !== 'function')
    throw new TypeError('createSessMcpHttpHandler: handleStore(binding, principal) is required.');
  if (!Array.isArray(options.requiredScopes) || !options.requiredScopes.every((s) => typeof s === 'string'))
    throw new TypeError('createSessMcpHttpHandler: requiredScopes must be a list (it may be empty).');
  if (!Array.isArray(options.allowedHosts) || options.allowedHosts.length === 0)
    throw new TypeError('createSessMcpHttpHandler: allowedHosts must name at least one hostname.');
  const allowedHosts = [...options.allowedHosts];
  const allowedOrigins = new Set((options.allowedOrigins ?? []).map(normalizedOrigin));
  const apiOrigin = parseOrigin(options.apiOrigin, options.allowInsecureLocalhost === true);
  const maxBodyBytes = positiveInteger(options.maxBodyBytes, DEFAULT_MAX_BODY_BYTES, 'maxBodyBytes');
  const requestTimeoutMs = positiveInteger(
    options.requestTimeoutMs,
    DEFAULT_REQUEST_TIMEOUT_MS,
    'requestTimeoutMs',
  );
  const maxWaitMs = options.maxWaitMs ?? DEFAULT_WAIT_MS;
  if (!Number.isSafeInteger(maxWaitMs) || maxWaitMs < 0 || maxWaitMs > DEFAULT_WAIT_MS)
    throw new TypeError(`createSessMcpHttpHandler: maxWaitMs must be an integer from 0 to ${DEFAULT_WAIT_MS}.`);
  let resourceMetadataUrl: string | undefined;
  if (options.resourceMetadataUrl !== undefined) {
    const url = new URL(options.resourceMetadataUrl);
    if (url.protocol !== 'https:' && !(options.allowInsecureLocalhost && url.protocol === 'http:'))
      throw new TypeError('createSessMcpHttpHandler: resourceMetadataUrl must be an HTTPS URL.');
    resourceMetadataUrl = url.href;
  }
  const diagnostics: Diagnostics = options.diagnostics ?? (() => {});
  const report: Diagnostics = (event, fields) => {
    try {
      diagnostics(event, fields);
    } catch {
      // Diagnostics never affect protocol behavior.
    }
  };
  const createClient = options.createClient ?? ((sessOptions: SessOptions) => new Sess(sessOptions));
  const requestScope = new AsyncLocalStorage<RequestScope>();

  const openContext = async (scope: RequestScope): Promise<OperationContext> => {
    const store = await options.handleStore(scope.binding, scope.principal);
    if (!store || typeof store !== 'object' || !sameBinding(store.binding, scope.binding))
      throw new AdapterError(
        'STATE_STORE_ERROR',
        'The hosted interaction store is not bound to this authorization. Nothing was changed.',
      );
    const client = createClient({
      apiKey: scope.principal.credential,
      baseUrl: apiOrigin,
      allowInsecureLocalhost: options.allowInsecureLocalhost === true,
      // Receipts and responses must belong to the server-resolved workspace.
      expectedWorkspaceId: scope.principal.workspaceId,
      ...(options.receiptIssuer ? { receiptIssuer: options.receiptIssuer } : {}),
    });
    return { client, store, maxWaitMs };
  };

  const mcp = createMcpHandler(
    () => {
      const scope = requestScope.getStore();
      // Fail closed: a server instance is never built without its request's authority.
      if (!scope) throw new Error('No authenticated request scope.');
      const adapter = new SessMcpAdapter({
        context: () => openContext(scope),
        diagnostics: report,
        ...(options.now ? { now: options.now } : {}),
      });
      return buildToolServer({ adapter, diagnostics: report, shutdown: scope.deadline });
    },
    {
      maxRequestBodySize: maxBodyBytes,
      // Reporting only, and never the error text: it can quote request headers.
      onerror: () => report('http_protocol_rejected'),
    },
  );

  /** RFC 6750 challenge; `error` is omitted when the request carried no credentials at all. */
  const challenge = (status: 401 | 403, error: string, description: string, request: Request): Response => {
    const params: string[] = [];
    if (status === 403 || request.headers.has('authorization')) params.push(`error=${quoted(error)}`);
    if (status === 403 && options.requiredScopes.length > 0)
      params.push(`scope=${quoted(options.requiredScopes.join(' '))}`);
    if (resourceMetadataUrl) params.push(`resource_metadata=${quoted(resourceMetadataUrl)}`);
    const header = params.length ? `Bearer ${params.join(', ')}` : 'Bearer';
    return json(status, { error, error_description: description }, { 'www-authenticate': header });
  };

  /** Era-correct tool error for every request in a body that carries an unsafe tools/call. */
  const rejectUnsafe = async (forward: Request, parsed: unknown): Promise<Response> => {
    const legacy = await isLegacyRequest(forward, parsed, { maxRequestBodySize: maxBodyBytes });
    const toolError = (id: unknown) => {
      const result = failure(new AdapterError('INVALID_ARGUMENTS', UNSAFE_KEY_MESSAGE));
      // 2026-07-28 results carry resultType and the server identity, as the SDK's own results do.
      const shaped = legacy
        ? result
        : { ...result, resultType: 'complete', _meta: { [SERVER_INFO_META_KEY]: { name: SERVER_NAME, version: VERSION } } };
      return { jsonrpc: '2.0', id, result: shaped };
    };
    report('tool_error', { code: 'INVALID_ARGUMENTS' });
    if (!Array.isArray(parsed)) {
      const m = parsed as { id?: unknown };
      if (m.id === undefined) return new Response(null, { status: 202 });
      return json(200, toolError(m.id));
    }
    // Batches are 2025-era only; a modern one is refused outright, as the SDK would.
    if (!legacy) return rpcError(400, -32600, 'Bad Request: invalid batch.');
    const answers = parsed
      .filter((m): m is { id: unknown } => !!m && typeof m === 'object' && 'method' in m && (m as { id?: unknown }).id !== undefined)
      .map((m) =>
        isUnsafeToolCall(m)
          ? toolError(m.id)
          : {
              jsonrpc: '2.0',
              id: m.id,
              error: { code: -32600, message: 'Not processed: this batch contains a tools/call with unsafe argument keys.' },
            },
      );
    return answers.length ? json(200, answers) : new Response(null, { status: 202 });
  };

  const handle = async (request: Request): Promise<Response> => {
    // Node faces carry the Host header; a fetch-native runtime's URL host is derived from it.
    const host = validateHostHeader(request.headers.get('host') ?? new URL(request.url).host, allowedHosts);
    if (!host.ok) {
      report('http_rejected', { reason: 'host' });
      return rpcError(403, -32000, 'Forbidden: host not allowed.');
    }
    const origin = request.headers.get('origin');
    if (origin !== null && origin !== '' && !allowedOrigins.has(origin)) {
      report('http_rejected', { reason: 'origin' });
      return rpcError(403, -32000, 'Forbidden: origin not allowed.');
    }
    // The hook sees method, URL and headers only; the body stays unread for the guard and the SDK.
    const view = new Request(request.url, { method: request.method, headers: request.headers });
    let principal: PrincipalContext | undefined;
    try {
      principal = await options.authenticate(view);
    } catch {
      report('http_auth_error');
      return json(503, { error: 'temporarily_unavailable', error_description: 'Authentication is unavailable.' });
    }
    if (principal === undefined || principal === null) {
      report('http_rejected', { reason: 'unauthenticated' });
      return challenge(401, 'invalid_token', 'Authentication required.', request);
    }
    let binding: GrantBinding;
    try {
      if (!validPrincipal(principal)) throw new TypeError('invalid principal');
      binding = grantBinding({
        origin: apiOrigin,
        workspaceId: principal.workspaceId,
        principalId: principal.principalId,
        clientId: principal.clientId,
        grantId: principal.grantId,
        grantGeneration: principal.grantGeneration,
      });
    } catch {
      report('http_principal_invalid');
      return rpcError(500, -32603, 'Internal server error');
    }
    if (!options.requiredScopes.every((scope) => principal.scopes.includes(scope))) {
      report('http_rejected', { reason: 'insufficient_scope' });
      return challenge(403, 'insufficient_scope', 'The authorization does not include the required scope.', request);
    }
    let forward = request;
    if (request.method.toUpperCase() === 'POST' && isJsonContentType(request.headers.get('content-type'))) {
      let read: Awaited<ReturnType<typeof readRequestBody>>;
      try {
        read = await readRequestBody(request, maxBodyBytes);
      } catch {
        return rpcError(400, -32700, 'Parse error: the request body could not be read');
      }
      if (read.tooLarge || read.text === undefined) {
        report('http_rejected', { reason: 'body_too_large' });
        return rpcError(413, -32000, `Payload Too Large: Request body must not exceed ${maxBodyBytes} bytes`);
      }
      const headers = new Headers(request.headers);
      headers.delete('content-length');
      headers.delete('transfer-encoding');
      forward = new Request(request.url, { method: 'POST', headers, body: read.text, signal: request.signal });
      let parsed: unknown;
      let parsedOk = false;
      try {
        parsed = JSON.parse(read.text);
        parsedOk = true;
      } catch {
        // Not JSON: the SDK answers with its parse error.
      }
      if (parsedOk && (Array.isArray(parsed) ? parsed : [parsed]).some(isUnsafeToolCall))
        return rejectUnsafe(forward, parsed);
    }
    const scope: RequestScope = { principal, binding, deadline: AbortSignal.timeout(requestTimeoutMs) };
    return requestScope.run(scope, () => mcp.fetch(forward));
  };

  const fetch = async (request: Request): Promise<Response> => {
    try {
      return await handle(request);
    } catch {
      report('http_internal_error');
      return rpcError(500, -32603, 'Internal server error');
    }
  };
  const node = toNodeHandler(
    { fetch: (request) => fetch(request) },
    { maxRequestBodySize: maxBodyBytes, onerror: () => report('http_internal_error') },
  );
  return { fetch, node, close: () => mcp.close() };
}
