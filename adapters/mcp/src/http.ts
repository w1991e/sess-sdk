import { AsyncLocalStorage } from 'node:async_hooks';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { Readable } from 'node:stream';
import { toNodeHandler } from '@modelcontextprotocol/node';
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
import { userAgentFetch } from './user-agent.js';
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
   * Absolute per-request deadline in milliseconds (default 60 s), started when the request
   * enters either face. It bounds `authenticate` (503 when exceeded) and body ingestion (`408`,
   * reading stops; the Node face closes the connection). During tool execution it ends an in-flight
   * sess_response wait or read as `needs_resume`. A create, publish or complete already sent is
   * never abandoned mid-flight (its outcome would become unknown); the SESS client's own timeouts
   * bound those. The timer is cleared when the response completes or fails. A peer disconnect (fetch
   * `request.signal`, or a Node response closed before it finished, including on entry) also
   * cancels: a pending `authenticate` or body read stops waiting and the handler settles at once,
   * without calling the hook if the peer was already gone.
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
  /**
   * `node:http` face. Host, Origin and authentication run on the headers before any body byte is
   * read; the bounded body is then replayed through `@modelcontextprotocol/node`'s adapter.
   */
  node: (req: IncomingMessage, res: ServerResponse) => Promise<void>;
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
    throw new TypeError(
      `createSessMcpHttpHandler: ${name} must be a positive integer${max ? ` up to ${max}` : ''}.`,
    );
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
    throw new TypeError(
      `createSessMcpHttpHandler: maxWaitMs must be an integer from 0 to ${DEFAULT_WAIT_MS}.`,
    );
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
      fetch: userAgentFetch(),
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
        : {
            ...result,
            resultType: 'complete',
            _meta: { [SERVER_INFO_META_KEY]: { name: SERVER_NAME, version: VERSION } },
          };
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
      .filter(
        (m): m is { id: unknown } =>
          !!m && typeof m === 'object' && 'method' in m && (m as { id?: unknown }).id !== undefined,
      )
      .map((m) =>
        isUnsafeToolCall(m)
          ? toolError(m.id)
          : {
              jsonrpc: '2.0',
              id: m.id,
              error: {
                code: -32600,
                message: 'Not processed: this batch contains a tools/call with unsafe argument keys.',
              },
            },
      );
    return answers.length ? json(200, answers) : new Response(null, { status: 202 });
  };

  /**
   * Header-only preflight, run before any body byte is read: Host, Origin, then exactly one
   * `authenticate` call (raced against the request deadline), principal validation and scopes.
   */
  const preflight = async (
    method: string,
    host: string | null,
    url: () => string,
    headers: Headers,
    deadline: AbortSignal,
  ): Promise<Preflight> => {
    const reject = (response: Response): Preflight => ({ kind: 'reject', response });
    if (!validateHostHeader(host ?? undefined, allowedHosts).ok) {
      report('http_rejected', { reason: 'host' });
      return reject(rpcError(403, -32000, 'Forbidden: host not allowed.'));
    }
    const origin = headers.get('origin');
    if (origin !== null && origin !== '' && !allowedOrigins.has(origin)) {
      report('http_rejected', { reason: 'origin' });
      return reject(rpcError(403, -32000, 'Forbidden: origin not allowed.'));
    }
    let view: Request;
    try {
      // The hook sees method, URL and headers only; there is no body to read.
      view = new Request(url(), { method, headers });
    } catch {
      report('http_rejected', { reason: 'method' });
      return reject(rpcError(405, -32000, 'Method not allowed.'));
    }
    // Nobody is waiting for an answer: settle without calling the hook. The response is discarded.
    const gone = (): Preflight => {
      report('http_rejected', { reason: 'disconnect' });
      return reject(new Response(null, { status: 499 }));
    };
    if (peerGone(deadline)) return gone();
    let outcome: Settled<PrincipalContext | undefined>;
    try {
      outcome = await settleWithin(Promise.resolve(options.authenticate(view)), deadline);
    } catch {
      report('http_auth_error');
      return reject(
        json(503, { error: 'temporarily_unavailable', error_description: 'Authentication is unavailable.' }),
      );
    }
    if (!outcome.done) {
      if (peerGone(deadline)) return gone();
      report('http_auth_error', { reason: 'deadline' });
      return reject(
        json(503, { error: 'temporarily_unavailable', error_description: 'Authentication is unavailable.' }),
      );
    }
    const principal = outcome.value;
    if (principal === undefined || principal === null) {
      report('http_rejected', { reason: 'unauthenticated' });
      return reject(challenge(401, 'invalid_token', 'Authentication required.', view));
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
      return reject(rpcError(500, -32603, 'Internal server error'));
    }
    if (!options.requiredScopes.every((scope) => principal.scopes.includes(scope))) {
      report('http_rejected', { reason: 'insufficient_scope' });
      return reject(
        challenge(403, 'insufficient_scope', 'The authorization does not include the required scope.', view),
      );
    }
    return { kind: 'ok', principal, binding };
  };

  /** The answer for a body that could not be ingested within the bounds. */
  const ingestFailure = (read: Exclude<BodyRead, { kind: 'ok' }>): Response => {
    report('http_rejected', { reason: `body_${read.kind}` });
    if (read.kind === 'too_large')
      return rpcError(413, -32000, `Payload Too Large: Request body must not exceed ${maxBodyBytes} bytes`);
    if (read.kind === 'timeout')
      return rpcError(408, -32000, 'Request Timeout: the request body did not arrive within the deadline.');
    return rpcError(400, -32700, 'Parse error: the request body could not be read');
  };

  /**
   * After preflight and ingestion: the body is complete and in memory. Applies the raw-body
   * unsafe-key guard and hands the request to the SDK entry under the request's authority.
   */
  const dispatch = async (request: Request, pre: Admitted, deadline: AbortSignal): Promise<Response> => {
    let forward = request;
    if (request.method.toUpperCase() === 'POST' && isJsonContentType(request.headers.get('content-type'))) {
      const read = await readRequestBody(request, maxBodyBytes);
      if (read.tooLarge || read.text === undefined) return ingestFailure({ kind: 'too_large' });
      const headers = new Headers(request.headers);
      headers.delete('content-length');
      headers.delete('transfer-encoding');
      forward = new Request(request.url, {
        method: 'POST',
        headers,
        body: read.text,
        signal: request.signal,
      });
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
    const scope: RequestScope = { principal: pre.principal, binding: pre.binding, deadline };
    return requestScope.run(scope, () => mcp.fetch(forward));
  };

  const fetch = async (request: Request): Promise<Response> => {
    const deadline = startDeadline(requestTimeoutMs);
    // Peer gone (now or later): cancel, so a pending authenticate or body read settles at once.
    const onDisconnect = () => deadline.cancel();
    if (request.signal.aborted) deadline.cancel();
    else request.signal.addEventListener('abort', onDisconnect, { once: true });
    // Normal completion: clear the timer and the listener; the signal is left as it is.
    const done = () => {
      request.signal.removeEventListener('abort', onDisconnect);
      deadline.dispose();
    };
    try {
      const pre = await preflight(
        request.method.toUpperCase(),
        // A fetch-native runtime may omit Host from the Request; its URL host is derived from it.
        request.headers.get('host') ?? new URL(request.url).host,
        () => request.url,
        request.headers,
        deadline.signal,
      );
      if (pre.kind === 'reject') return settleResponse(pre.response, done);
      let forward = request;
      if (
        request.method.toUpperCase() === 'POST' &&
        isJsonContentType(request.headers.get('content-type')) &&
        request.body !== null
      ) {
        const reader = request.body.getReader();
        const read = await ingest(
          () => reader.read(),
          () => void reader.cancel().catch(() => undefined),
          request.headers.get('content-length'),
          maxBodyBytes,
          AbortSignal.any([deadline.signal, request.signal]),
          () => request.signal.aborted || peerGone(deadline.signal),
        );
        if (read.kind !== 'ok') return settleResponse(ingestFailure(read), done);
        const headers = new Headers(request.headers);
        headers.set('content-length', String(read.bytes.byteLength));
        headers.delete('transfer-encoding');
        forward = new Request(request.url, {
          method: 'POST',
          headers,
          body: read.bytes,
          signal: request.signal,
        });
      }
      return settleResponse(await dispatch(forward, pre, deadline.signal), done);
    } catch {
      done();
      report('http_internal_error');
      return rpcError(500, -32603, 'Internal server error');
    }
  };

  // The node face reuses the SDK's Node adapter for request conversion and response streaming, fed
  // with a body this handler has already admitted and bounded.
  const nodeScope = new AsyncLocalStorage<{ pre: Admitted; deadline: AbortSignal }>();
  const sdkNode = toNodeHandler(
    {
      fetch: async (request) => {
        const scope = nodeScope.getStore();
        if (!scope) return rpcError(500, -32603, 'Internal server error');
        return dispatch(request, scope.pre, scope.deadline);
      },
    },
    { maxRequestBodySize: maxBodyBytes, onerror: () => report('http_internal_error') },
  );

  const node = async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    const deadline = startDeadline(requestTimeoutMs);
    // Completion, error and disconnect all end in 'close' (the listener runs once and is gone). A
    // finished response only clears the timer; anything else means the peer is gone and cancels,
    // so a pending authenticate or body read settles at once.
    res.once('close', () => (res.writableFinished ? deadline.dispose() : deadline.cancel()));
    if (res.destroyed || req.socket?.destroyed === true) deadline.cancel();
    try {
      const headers = new Headers();
      for (const [name, value] of Object.entries(req.headers)) {
        if (value === undefined || name.startsWith(':')) continue;
        if (Array.isArray(value)) for (const item of value) headers.append(name, item);
        else headers.set(name, value);
      }
      const method = (req.method ?? 'GET').toUpperCase();
      const host = headers.get('host');
      const pre = await preflight(
        method,
        host,
        () => new URL(req.url ?? '/', `http://${host}`).href,
        headers,
        deadline.signal,
      );
      if (pre.kind === 'reject') return await writeEarly(res, pre.response);
      const replayHeaders: IncomingMessage['headers'] = { ...req.headers };
      delete replayHeaders['content-length'];
      delete replayHeaders['transfer-encoding'];
      let chunks: Uint8Array[] = [];
      if (method === 'POST' && isJsonContentType(headers.get('content-type'))) {
        const iterator = req[Symbol.asyncIterator]() as AsyncIterator<Uint8Array>;
        const read = await ingest(
          () => iterator.next(),
          // Reading simply stops; the early answer carries Connection: close.
          () => undefined,
          headers.get('content-length'),
          maxBodyBytes,
          deadline.signal,
          () => peerGone(deadline.signal) || (req.destroyed && !req.complete),
        );
        if (read.kind !== 'ok') return await writeEarly(res, ingestFailure(read));
        chunks = [read.bytes];
        replayHeaders['content-length'] = String(read.bytes.byteLength);
      } else if (hasUnreadBody(headers)) {
        // The SDK answers without this body (415, 405); do not keep the connection for it.
        res.setHeader('connection', 'close');
      }
      const replay = Object.assign(Readable.from(chunks), {
        method: req.method,
        url: req.url,
        headers: replayHeaders,
      });
      await nodeScope.run({ pre, deadline: deadline.signal }, () => sdkNode(replay, res));
    } catch {
      report('http_internal_error');
      if (!res.headersSent) await writeEarly(res, rpcError(500, -32603, 'Internal server error'));
      else res.destroy();
    }
  };

  return { fetch, node, close: () => mcp.close() };
}

type Admitted = { principal: PrincipalContext; binding: GrantBinding };
type Preflight = ({ kind: 'ok' } & Admitted) | { kind: 'reject'; response: Response };
type Settled<T> = { done: true; value: T } | { done: false };
type BodyRead =
  { kind: 'ok'; bytes: Uint8Array } | { kind: 'too_large' } | { kind: 'timeout' } | { kind: 'aborted' };

/** Abort reasons of the request deadline signal. */
const DEADLINE = 'deadline';
const DISCONNECT = 'disconnect';

interface Deadline {
  /** Aborts with DEADLINE when the time is up, or with DISCONNECT when the peer goes away. */
  signal: AbortSignal;
  /** Normal completion: clears the timer, leaves the signal as it is. Idempotent. */
  dispose(): void;
  /** Peer gone: clears the timer and aborts the signal, so pending work settles now. Idempotent. */
  cancel(): void;
}

/** An absolute per-request deadline started at entry. */
function startDeadline(ms: number): Deadline {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(DEADLINE), ms);
  return {
    signal: controller.signal,
    dispose: () => clearTimeout(timer),
    cancel: () => {
      clearTimeout(timer);
      if (!controller.signal.aborted) controller.abort(DISCONNECT);
    },
  };
}

const peerGone = (signal: AbortSignal) => signal.aborted && signal.reason === DISCONNECT;

/** Settles with the work's value, or `{ done: false }` once `signal` aborts; rejections pass through. */
function settleWithin<T>(work: Promise<T>, signal: AbortSignal): Promise<Settled<T>> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      work.catch(() => undefined);
      resolve({ done: false });
      return;
    }
    const onAbort = () => resolve({ done: false });
    signal.addEventListener('abort', onAbort, { once: true });
    work.then(
      (value) => {
        signal.removeEventListener('abort', onAbort);
        resolve({ done: true, value });
      },
      (error: unknown) => {
        signal.removeEventListener('abort', onAbort);
        reject(error);
      },
    );
  });
}

/**
 * Reads a body chunk by chunk under a byte bound and an abort signal: a declared Content-Length
 * over the bound is refused before reading; reading stops at the first byte over the bound or when
 * the signal aborts (deadline: `timeout`, peer gone: `aborted`).
 */
async function ingest(
  next: () => Promise<IteratorResult<Uint8Array>>,
  stop: () => void,
  declaredLength: string | null,
  maxBytes: number,
  signal: AbortSignal,
  disconnected: () => boolean,
): Promise<BodyRead> {
  if (Number(declaredLength) > maxBytes) {
    stop();
    return { kind: 'too_large' };
  }
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    let step: Settled<IteratorResult<Uint8Array>>;
    try {
      step = await settleWithin(next(), signal);
    } catch {
      return { kind: 'aborted' };
    }
    if (!step.done) {
      stop();
      return disconnected() ? { kind: 'aborted' } : { kind: 'timeout' };
    }
    if (step.value.done) break;
    const chunk = step.value.value;
    total += chunk.byteLength;
    if (total > maxBytes) {
      stop();
      return { kind: 'too_large' };
    }
    chunks.push(chunk);
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return { kind: 'ok', bytes };
}

function hasUnreadBody(headers: Headers): boolean {
  const length = headers.get('content-length');
  return headers.has('transfer-encoding') || (length !== null && length !== '0');
}

/** Fetch face: runs `done` once the response body is fully delivered, cancelled or failed. */
function settleResponse(response: Response, done: () => void): Response {
  if (response.body === null) {
    done();
    return response;
  }
  const reader = response.body.getReader();
  const body = new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const step = await reader.read();
        if (step.done) {
          done();
          controller.close();
        } else controller.enqueue(step.value);
      } catch (error) {
        done();
        controller.error(error);
      }
    },
    cancel(reason) {
      done();
      return reader.cancel(reason);
    },
  });
  return new Response(body, {
    status: response.status,
    statusText: response.statusText,
    headers: response.headers,
  });
}

/** Node face: a complete answer written before (or instead of) reading the body; closes the connection. */
async function writeEarly(res: ServerResponse, response: Response): Promise<void> {
  if (res.headersSent || res.destroyed) return;
  const headers: Record<string, string> = {};
  for (const [name, value] of response.headers) headers[name] = value;
  headers.connection = 'close';
  const body = Buffer.from(await response.arrayBuffer());
  res.writeHead(response.status, headers);
  res.end(body);
}
