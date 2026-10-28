import { randomUUID } from 'node:crypto';
import { SessError, attachRecovery, lengthMessage } from './errors.js';
import type { SessErrorDetails, WriteOutcome } from './errors.js';
import type { ApiResult, CreateSessionResponse, RequestOptions, ResponseMeta, SessOptions } from './types.js';
import { isLoopback } from './internal/decode.js';
import { serializeBody } from './internal/json.js';
import { abortError, boundedNumber, deadline, delay, withSignal } from './internal/time.js';
import { SDK_VERSION } from './internal/version.js';

export interface Operation<T> {
  name: string;
  method: 'GET' | 'POST' | 'PATCH' | 'PUT';
  path: string;
  status: number;
  parse?: (value: unknown) => T;
  body?: unknown;
  versioned?: boolean;
  retry: 'safe' | 'mutation' | 'never';
  ifMatch?: string;
  idempotencyKey?: string;
  authenticated?: boolean;
}
const transientStatuses = new Set([408, 429, 500, 502, 503, 504]);
const rejections: Record<number, readonly string[]> = {
  400: ['INVALID_SCHEMA', 'UNKNOWN_COMPONENT', 'WEBHOOK_INVALID_URL'],
  401: ['UNAUTHORIZED'],
  403: ['ACTION_NOT_ALLOWED'],
  404: ['NOT_FOUND', 'SESSION_NOT_FOUND'],
  409: [
    'SESSION_REVISION_CONFLICT',
    'IDEMPOTENCY_CONFLICT',
    'SESSION_COMPLETED',
    'WEBHOOK_NOT_CONFIGURED',
    'RESPONSE_LIMIT_REACHED',
  ],
  412: ['SESSION_REVISION_CONFLICT'],
  413: ['PAYLOAD_TOO_LARGE'],
  422: ['VALIDATION_FAILED', 'WEBHOOK_VERIFICATION_FAILED'],
  428: ['PRECONDITION_REQUIRED'],
  // A plan limit refuses the create before anything is written: nothing is created. It is not a
  // rate limit; a plain 429 (no code, or RATE_LIMITED) stays transient and its outcome uncertain.
  429: ['PLAN_LIMIT_REACHED'],
};

/** RFC 9110 product tokens (`name` or `name/version`), separated by single spaces. */
const PRODUCT = "[!#$%&'*+.^_`|~0-9A-Za-z-]+(?:/[!#$%&'*+.^_`|~0-9A-Za-z-]+)?";
const PRODUCTS = new RegExp(`^${PRODUCT}(?: ${PRODUCT})*$`);
/**
 * The User-Agent: a wrapping client's tokens, then `sess-sdk/<version>`, then the runtime's
 * `node/<version>` when there is one. Sess classifies the creating client by these tokens.
 */
function userAgent(prefix: unknown): string {
  if (prefix !== undefined && (typeof prefix !== 'string' || prefix.length > 256 || !PRODUCTS.test(prefix)))
    throw new SessError(
      'configuration',
      'userAgent must be one or more product tokens such as my-app/1.2.0, separated by single spaces.',
      { outcome: 'not_sent' },
    );
  const node = typeof process === 'undefined' ? undefined : process.versions?.node;
  return [prefix, `sess-sdk/${SDK_VERSION}`, typeof node === 'string' ? `node/${node}` : undefined]
    .filter((token) => token !== undefined)
    .join(' ');
}

function credential(value: unknown): string {
  if (typeof value !== 'string' || !/^[\x21-\x7e]{1,4096}$/.test(value)) {
    throw new SessError(
      'configuration',
      'Supply a Sess API key on the server. It must not be empty or contain whitespace or control characters.',
      { code: 'INVALID_API_KEY', outcome: 'not_sent' },
    );
  }
  return value;
}
export function strongETag(value: unknown): value is string {
  return typeof value === 'string' && /^"[\x21\x23-\x7e\x80-\xff]{0,1024}"$/.test(value);
}
export function pathSegment(value: string): string {
  if (
    typeof value !== 'string' ||
    !value.length ||
    value.length > 512 ||
    /[\u0000-\u0020\u007f]/.test(value) ||
    value === '.' ||
    value === '..'
  ) {
    throw new SessError('configuration', 'Resource ID must be a nonempty path segment.', {
      outcome: 'not_sent',
    });
  }
  try {
    return encodeURIComponent(value);
  } catch {
    throw new SessError('configuration', 'Resource ID has invalid encoding.', { outcome: 'not_sent' });
  }
}
function origin(input: string | undefined, allowInsecure: boolean): string {
  const text = input ?? 'https://api.sess.si';
  let url: URL;
  try {
    url = new URL(text);
  } catch {
    throw new SessError('configuration', 'baseUrl must be a trusted absolute API origin.', {
      outcome: 'not_sent',
    });
  }
  if (
    text !== text.trim() ||
    /[\u0000-\u0020\u007f\\]/.test(text) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    url.pathname !== '/' ||
    !(url.protocol === 'https:' || (url.protocol === 'http:' && allowInsecure && isLoopback(url.hostname)))
  ) {
    throw new SessError(
      'configuration',
      'baseUrl requires HTTPS and an origin without credentials, path, query, or fragment. Only explicit loopback development may use HTTP.',
      { outcome: 'not_sent' },
    );
  }
  return url.origin;
}
/** The request id the Sess API assigns: `req_` and a random UUID. */
const SESS_REQUEST_ID = /^req_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
function safeText(
  value: unknown,
  pattern: RegExp,
  key?: string,
  opaqueIdentifier = false,
): string | undefined {
  if (
    typeof value !== 'string' ||
    !pattern.test(value) ||
    /sess_(?:sk|mg|tk|mk)_|whsec_|eyJ/.test(value) ||
    // A request identifier holding a run of 22 or more base64url characters may carry a reflected
    // human-link token (22 for /n/ short links, 43 for /s/ links, alone or glued to more token
    // characters), so it is withheld. Sess's own request ids, req_ and a lowercase UUID, are kept.
    (opaqueIdentifier && /[A-Za-z0-9_-]{22,}/.test(value) && !SESS_REQUEST_ID.test(value)) ||
    (key && value.includes(key))
  )
    return undefined;
  return value;
}
/** A JSON pointer into the request body: no controls or bidirectional overrides. */
const POINTER = /^(?:\/[^\u0000-\u001f\u007f-\u009f‪-‮⁦-⁩/]{0,128}){1,16}$/;
const count = (value: unknown) =>
  typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : undefined;

/**
 * The length detail of a 400 INVALID_SCHEMA for a value over its limit (field, limit, length):
 * all three or none. Every other error carries none.
 */
function lengthDetail(
  remote: Record<string, unknown>,
  code: string | undefined,
  key: string | undefined,
): Pick<SessErrorDetails, 'field' | 'limit' | 'length'> {
  if (code !== 'INVALID_SCHEMA') return {};
  const field = safeText(remote.field, POINTER, key);
  const limit = count(remote.limit);
  const length = count(remote.length);
  return field !== undefined && limit !== undefined && length !== undefined && length > limit
    ? { field, limit, length }
    : {};
}
const lengthFields = (e: SessError): Pick<SessErrorDetails, 'field' | 'limit' | 'length'> =>
  e.field !== undefined ? { field: e.field, limit: e.limit, length: e.length } : {};

export function retryAfter(header: string | null): number | undefined {
  if (header === null) return undefined;
  if (/^\d+$/.test(header.trim())) {
    const ms = Number(header.trim()) * 1000;
    return Number.isSafeInteger(ms) ? ms : undefined;
  }
  // HTTP-date only; Date.parse alone also accepts misleading values such as "1.5".
  if (!/^[A-Za-z]{3}, \d{2} [A-Za-z]{3} \d{4} \d{2}:\d{2}:\d{2} GMT$/.test(header)) return undefined;
  const date = Date.parse(header);
  return Number.isFinite(date) ? Math.max(0, date - Date.now()) : undefined;
}
/** An IMF-fixdate HTTP `Date` header in milliseconds since the epoch, or undefined. */
export function httpDate(header: string | null): number | undefined {
  if (header === null || !/^[A-Za-z]{3}, \d{2} [A-Za-z]{3} \d{4} \d{2}:\d{2}:\d{2} GMT$/.test(header))
    return undefined;
  const date = Date.parse(header);
  return Number.isFinite(date) ? date : undefined;
}
async function readBody(response: Response, maxBytes: number, signal: AbortSignal): Promise<string> {
  if (!response.body) return '';
  const reader = response.body.getReader();
  const parts: Uint8Array[] = [];
  let bytes = 0;
  let done = false;
  try {
    while (true) {
      const result = await withSignal(
        reader.read().catch(() => {
          throw new SessError('transport', 'API response stream failed.');
        }),
        signal,
      );
      if (result.done) {
        done = true;
        break;
      }
      bytes += result.value.byteLength;
      if (bytes > maxBytes)
        throw new SessError('protocol', 'Response body exceeds the configured byte limit.', {
          code: 'RESPONSE_TOO_LARGE',
        });
      parts.push(result.value);
    }
    try {
      return new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(parts, bytes));
    } catch {
      throw new SessError('protocol', 'Response contains invalid UTF-8.', { code: 'INVALID_RESPONSE' });
    }
  } finally {
    if (!done) void reader.cancel().catch(() => {});
    try {
      reader.releaseLock();
    } catch {
      /* cancelled reader may still settle */
    }
  }
}

/** Shared policy for owner operations and unauthenticated receipt-key reads. */
export class Transport {
  readonly baseUrl: string;
  readonly receiptIssuer: string;
  readonly expectedWorkspaceId?: string;
  readonly operationTimeoutMs: number;
  readonly allowInsecureLocalhost: boolean;
  #apiKey: SessOptions['apiKey'];
  #fetch: typeof globalThis.fetch;
  #timeoutMs: number;
  #maxRetries: number;
  #maxResponseBytes: number;
  #onRequestEvent?: SessOptions['onRequestEvent'];
  #userAgent: string;

  constructor(options: SessOptions) {
    if (!options || typeof options !== 'object')
      throw new SessError('configuration', 'Sess options with apiKey are required.', { outcome: 'not_sent' });
    this.#apiKey = typeof options.apiKey === 'function' ? options.apiKey : credential(options.apiKey);
    this.allowInsecureLocalhost = options.allowInsecureLocalhost === true;
    this.baseUrl = origin(options.baseUrl, this.allowInsecureLocalhost);
    this.receiptIssuer = options.receiptIssuer ?? this.baseUrl;
    if (
      typeof this.receiptIssuer !== 'string' ||
      !this.receiptIssuer.length ||
      this.receiptIssuer.length > 2048 ||
      /[\u0000-\u0020\u007f]/.test(this.receiptIssuer)
    )
      throw new SessError('configuration', 'receiptIssuer must be a trusted nonempty protocol identity.', {
        outcome: 'not_sent',
      });
    if (
      options.expectedWorkspaceId !== undefined &&
      (typeof options.expectedWorkspaceId !== 'string' ||
        !/^[A-Za-z0-9_:-]{1,128}$/.test(options.expectedWorkspaceId))
    )
      throw new SessError('configuration', 'expectedWorkspaceId must be a trusted workspace identifier.', {
        outcome: 'not_sent',
      });
    this.expectedWorkspaceId = options.expectedWorkspaceId;
    this.#fetch = options.fetch ?? globalThis.fetch;
    if (typeof this.#fetch !== 'function')
      throw new SessError('configuration', 'A compatible fetch implementation is required.', {
        outcome: 'not_sent',
      });
    this.#timeoutMs = boundedNumber(options.timeoutMs, 12000, 'timeoutMs');
    this.operationTimeoutMs = boundedNumber(options.operationTimeoutMs, 30000, 'operationTimeoutMs');
    this.#maxRetries = boundedNumber(options.maxRetries, 2, 'maxRetries', 0, 10);
    this.#maxResponseBytes = boundedNumber(
      options.maxResponseBytes,
      16 * 1024 * 1024,
      'maxResponseBytes',
      1,
      256 * 1024 * 1024,
    );
    this.#userAgent = userAgent(options.userAgent);
    this.#onRequestEvent = options.onRequestEvent;
    if (this.#onRequestEvent !== undefined && typeof this.#onRequestEvent !== 'function')
      throw new SessError('configuration', 'onRequestEvent must be a function.', { outcome: 'not_sent' });
  }

  async request<T>(operation: Operation<T>, inputOptions: RequestOptions = {}): Promise<ApiResult<T>> {
    // Capture every mutable input before the first asynchronous boundary.
    const op = { ...operation };
    const options = { ...inputOptions };
    const isWrite = op.method !== 'GET';
    const body = op.body === undefined ? undefined : serializeBody(op.body);
    const timeoutMs = boundedNumber(options.timeoutMs, this.#timeoutMs, 'timeoutMs');
    const totalMs = boundedNumber(options.operationTimeoutMs, this.operationTimeoutMs, 'operationTimeoutMs');
    const retries = boundedNumber(options.maxRetries, this.#maxRetries, 'maxRetries', 0, 10);
    const maxBytes = boundedNumber(
      options.maxResponseBytes,
      this.#maxResponseBytes,
      'maxResponseBytes',
      1,
      256 * 1024 * 1024,
    );
    if ('headers' in options || 'baseUrl' in options || 'apiKey' in options)
      throw new SessError(
        'configuration',
        'Per-request authentication, host, and header overrides are not supported.',
        { outcome: 'not_sent' },
      );
    if (options.signal !== undefined && !(options.signal instanceof AbortSignal))
      throw new SessError('configuration', 'signal must be an AbortSignal.', { outcome: 'not_sent' });
    if (
      !op.path.startsWith('/') ||
      op.path.startsWith('//') ||
      op.path.includes('#') ||
      op.path.includes('?')
    )
      throw new SessError('configuration', 'Invalid API resource path.', { outcome: 'not_sent' });
    const headers: Record<string, string> = { Accept: 'application/json', 'User-Agent': this.#userAgent };
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    let idempotencyKey: string | undefined;
    if (op.retry === 'mutation') {
      if (!strongETag(op.ifMatch))
        throw new SessError(
          'configuration',
          'Publish and complete require an original strong quoted If-Match ETag.',
          { code: 'INVALID_IF_MATCH', outcome: 'not_sent' },
        );
      if (op.idempotencyKey !== undefined && typeof op.idempotencyKey !== 'string')
        throw new SessError('configuration', 'idempotencyKey must be a primitive string.', {
          outcome: 'not_sent',
        });
      idempotencyKey = op.idempotencyKey === undefined ? randomUUID() : op.idempotencyKey;
      if (!/^[A-Za-z0-9_.:-]{1,128}$/.test(idempotencyKey))
        throw new SessError(
          'configuration',
          'idempotencyKey must contain 1–128 characters using only letters, digits, underscore, period, colon, or hyphen.',
          { outcome: 'not_sent' },
        );
      headers['If-Match'] = op.ifMatch;
      headers['Idempotency-Key'] = idempotencyKey;
    }
    const started = performance.now();
    const expires = started + totalMs;
    const whole = deadline(totalMs, options.signal);
    let attempts = 0;
    let dispatched = false;
    let key: string | undefined;
    let possiblePriorWrite = false;
    try {
      if (whole.signal.aborted) throw abortError(whole.signal);
      if (op.authenticated !== false) {
        const suppliedKey = new Promise<string | undefined>((resolve) => {
          resolve(typeof this.#apiKey === 'function' ? this.#apiKey() : this.#apiKey);
        }).catch(() => {
          throw new SessError('configuration', 'The API credential provider did not supply a usable key.', {
            code: 'CREDENTIAL_PROVIDER_FAILED',
            outcome: 'not_sent',
          });
        });
        key = credential(await withSignal(suppliedKey, whole.signal));
        headers.Authorization = `Bearer ${key}`;
      }
      const budget = op.retry === 'never' ? 0 : retries;
      for (;;) {
        if (whole.signal.aborted) throw abortError(whole.signal);
        attempts++;
        const attempt = deadline(
          Math.min(timeoutMs, Math.max(1, Math.ceil(expires - performance.now()))),
          whole.signal,
        );
        let retryable = false;
        let response: Response | undefined;
        let error: SessError | undefined;
        let recoveryBody: CreateSessionResponse | undefined;
        try {
          dispatched = true;
          const pendingResponse = Promise.resolve()
            .then(() =>
              this.#fetch(`${this.baseUrl}${op.path}`, {
                method: op.method,
                headers: { ...headers },
                ...(body !== undefined ? { body } : {}),
                redirect: 'manual',
                credentials: 'omit',
                signal: attempt.signal,
              }),
            )
            .catch(() => {
              if (attempt.signal.aborted) throw abortError(attempt.signal);
              throw new SessError('transport', 'API transport failed.');
            });
          pendingResponse.then(
            (r) => {
              if (attempt.signal.aborted) void r.body?.cancel().catch(() => {});
            },
            () => {},
          );
          response = await withSignal(pendingResponse, attempt.signal);
          if (response.redirected || (response.status >= 300 && response.status < 400)) {
            void response.body?.cancel().catch(() => {});
            throw new SessError('protocol', 'Redirected API responses are refused.', {
              code: 'REDIRECT_REFUSED',
              status: response.status,
            });
          }
          const requestId = safeText(
            response.headers.get('x-request-id'),
            /^[A-Za-z0-9._:-]{1,128}$/,
            key,
            true,
          );
          const retryAfterMs = retryAfter(response.headers.get('retry-after'));
          const mediaType = response.headers.get('content-type')?.split(';')[0]?.trim().toLowerCase();
          const text = await readBody(
            response,
            response.ok ? maxBytes : Math.min(maxBytes, 65536),
            attempt.signal,
          );
          if (!response.ok) {
            let remote: Record<string, unknown> = {};
            if (mediaType === 'application/json') {
              try {
                const value = JSON.parse(text) as { error?: unknown };
                if (value.error && typeof value.error === 'object')
                  remote = value.error as Record<string, unknown>;
              } catch {
                /* gateway/unusable body remains redacted */
              }
            }
            const code = safeText(remote.code, /^[A-Z][A-Z0-9_]{0,95}$/, key);
            const reason = safeText(remote.reason, /^[a-z_]{1,40}$/, key);
            const remoteId = safeText(remote.request_id, /^[A-Za-z0-9._:-]{1,128}$/, key, true) ?? requestId;
            const rejected = code !== undefined && rejections[response.status]?.includes(code);
            // A definite coded refusal is final: repeating it cannot succeed, so it is never retried.
            retryable = transientStatuses.has(response.status) && !rejected;
            const length = lengthDetail(remote, code, key);
            const message =
              length.field !== undefined
                ? lengthMessage(length.field, length.limit!, length.length!)
                : 'The Sess API returned an error. See the status and code fields.';
            throw new SessError('api', message, {
              code,
              reason,
              ...length,
              status: response.status,
              requestId: remoteId,
              retryAfterMs,
              outcome: isWrite ? (rejected && !possiblePriorWrite ? 'rejected' : 'unknown') : undefined,
            });
          }
          if (response.status !== op.status)
            throw new SessError('protocol', 'Unexpected API success status.', {
              code: 'INVALID_RESPONSE',
              status: response.status,
            });
          let data: T;
          if (op.parse) {
            if (mediaType !== 'application/json')
              throw new SessError('protocol', 'Expected an application/json response.', {
                code: 'INVALID_RESPONSE',
              });
            let parsed: unknown;
            try {
              parsed = JSON.parse(text);
            } catch {
              throw new SessError('protocol', 'Response is not valid JSON.', { code: 'INVALID_RESPONSE' });
            }
            data = op.parse(parsed);
            if (op.name === 'sessions.create') recoveryBody = data as CreateSessionResponse;
          } else {
            if (text.length !== 0)
              throw new SessError('protocol', 'Expected an empty API success body.', {
                code: 'INVALID_RESPONSE',
              });
            data = undefined as T;
          }
          const etag = response.headers.get('etag') ?? undefined;
          if ((op.versioned || etag !== undefined) && !strongETag(etag))
            throw new SessError('protocol', 'API response is missing a valid strong ETag.', {
              code: 'INVALID_ETAG',
            });
          const workspaceHeader = response.headers.get('sess-workspace-id');
          if (workspaceHeader !== null && !/^[A-Za-z0-9_:-]{1,128}$/.test(workspaceHeader))
            throw new SessError('protocol', 'API response has an invalid workspace context.', {
              code: 'INVALID_WORKSPACE_CONTEXT',
            });
          const serverDate = httpDate(response.headers.get('date'));
          const meta: ResponseMeta = {
            status: response.status,
            attempts,
            ...(serverDate !== undefined ? { serverDate } : {}),
            ...(etag ? { etag } : {}),
            ...(requestId ? { requestId } : {}),
            ...(workspaceHeader ? { workspaceId: workspaceHeader } : {}),
            ...(idempotencyKey ? { idempotencyKey } : {}),
          };
          this.#observe(op.name, started, attempts, meta);
          return { data, meta };
        } catch (e) {
          if (e instanceof SessError) error = e;
          else {
            error = new SessError(
              attempt.signal.aborted ? abortError(attempt.signal).kind : 'transport',
              attempt.signal.aborted
                ? 'Request deadline or caller cancellation ended the local request.'
                : 'API transport failed.',
            );
            retryable = true;
          }
          if (error.kind === 'timeout' || error.kind === 'transport') retryable = true;
          const outcome: WriteOutcome | undefined = isWrite ? (error.outcome ?? 'unknown') : undefined;
          if (outcome === 'unknown') possiblePriorWrite = true;
          const details: SessErrorDetails = {
            code: error.code,
            reason: error.reason,
            ...lengthFields(error),
            status: error.status ?? response?.status,
            requestId: error.requestId,
            retryAfterMs: error.retryAfterMs,
            operation: op.name,
            attempts,
            outcome,
            idempotencyKey,
          };
          error = new SessError(
            op.name === 'sessions.create' && outcome === 'unknown' ? 'unknown_outcome' : error.kind,
            op.name === 'sessions.create' && outcome === 'unknown'
              ? 'Session creation may have succeeded. Do not automatically create again; inspect recovery information if available.'
              : error.message,
            details,
          );
          if (recoveryBody) attachRecovery(error, recoveryBody);
          this.#observe(op.name, started, attempts, details);
        } finally {
          attempt.dispose();
        }
        if (!retryable || attempts > budget || whole.signal.aborted || options.signal?.aborted) throw error;
        const backoffMs = Math.ceil(200 * 2 ** (attempts - 1) + Math.random() * 100);
        const waitMs = Math.max(backoffMs, error.retryAfterMs ?? 0);
        if (waitMs >= expires - performance.now()) throw error;
        await delay(waitMs, whole.signal);
      }
    } catch (e) {
      if (!(e instanceof SessError))
        throw new SessError('transport', 'API operation failed.', {
          operation: op.name,
          attempts,
          outcome: isWrite ? (dispatched ? 'unknown' : 'not_sent') : undefined,
          idempotencyKey,
        });
      if (e.operation) throw e;
      throw new SessError(
        op.name === 'sessions.create' && dispatched ? 'unknown_outcome' : e.kind,
        op.name === 'sessions.create' && dispatched
          ? 'Session creation may have succeeded. Do not automatically create again.'
          : e.message,
        {
          code: e.code,
          reason: e.reason,
          ...lengthFields(e),
          operation: op.name,
          attempts,
          outcome: isWrite ? (dispatched ? 'unknown' : 'not_sent') : undefined,
          idempotencyKey,
        },
      );
    } finally {
      whole.dispose();
    }
  }

  #observe(
    operation: string,
    started: number,
    attempt: number,
    meta: { status?: number; code?: string; requestId?: string },
  ): void {
    try {
      const result = this.#onRequestEvent?.(
        Object.freeze({
          operation,
          attempt,
          durationMs: performance.now() - started,
          status: meta.status,
          code: meta.code,
          requestId: meta.requestId,
        }),
      );
      // An async callback's rejected promise cannot change request semantics either.
      Promise.resolve(result).catch(() => {});
    } catch {
      /* optional observer failures are isolated */
    }
  }
}
