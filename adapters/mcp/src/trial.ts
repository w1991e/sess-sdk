// Trial mode for the local (stdio) composition: used only when no SESS_API_KEY is configured.
//
// The no-signup trial is Sess's `/v1/trial/sessions` API. The first real create (sess_ask or
// sess_request) starts the trial: it is sent without Authorization and its response carries the
// trial's management credential exactly once. That credential is kept only in this module's
// protected state file (0600, in an owner-private 0700 directory under the profile), reused for
// every later create and read, across calls and restarts, and never returned in a tool result or
// written to a log. A trial is started at most once per profile and API origin: a limit or an ended
// trial stays an error, and no replacement trial is ever started to get around it.
//
// Reads and receipt verification use the unchanged @sess.si/sdk client, whose owner read paths are
// mapped onto the trial read route by a narrow fetch adapter (below).
import { createHash } from 'node:crypto';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { Sess, SessError, type CreateSessionRequest } from '@sess.si/sdk';
import type { TrialConfig } from './config.js';
import { AdapterError, type Diagnostics } from './errors.js';
import type { SessClient } from './operations.js';
import { atomicWrite } from './store.js';

/**
 * The published trial limits (Sess TRIAL_POLICY, as the trial API describes them). They only name
 * the limit in a refusal; Sess enforces them. A test checks them against the API contract text.
 */
export const TRIAL_LIMITS = Object.freeze({
  linkHours: 1,
  maxActiveSessions: 3,
  maxSessionsPerTrial: 10,
  creationWindowHours: 24,
  resultHoursAfterLink: 24,
  maxTrialsPerClient: 3,
  trialRateWindowHours: 24,
});

/** The Free-plan continuation every trial refusal ends with (proposed copy; see DOCS/product/copy.md in sess). */
export const FREE_PLAN_NEXT =
  'To keep going, use the Free plan (up to 500 requests a month, at no cost): create an API key in your Sess account and set it as SESS_API_KEY for this server.';

const SESSION_ID = /^ses_[0-9A-HJKMNP-TV-Z]{26}$/;
const MANAGEMENT_CREDENTIAL = /^sess_mg_[A-Za-z0-9_-]{43}$/;
const WORKSPACE_ID = /^[A-Za-z0-9_-]{1,128}$/;
const ISO_INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/;
const STRONG_ETAG = /^"[\x21\x23-\x7e\x80-\xff]{0,1024}"$/;
const CREATE_TIMEOUT_MS = 30_000;
const LOCK_WAIT_MS = 60_000;
const LOCK_POLL_MS = 25;

/** The protected trial record. `credential` is a secret; nothing else here is. */
interface TrialState {
  schema: 1;
  origin: string;
  workspaceId: string;
  credential: string;
  trialExpiresAt: string;
  startedAt: string;
  /** Sessions this profile confirmed created in the trial (names the per-trial limit; Sess enforces it). */
  sessionsCreated: number;
}

function isoInstant(value: unknown): value is string {
  return typeof value === 'string' && ISO_INSTANT.test(value) && Number.isFinite(Date.parse(value));
}

function decodeState(value: unknown, origin: string): TrialState {
  const s = value as Partial<TrialState> | null;
  if (
    !s ||
    typeof s !== 'object' ||
    s.schema !== 1 ||
    s.origin !== origin ||
    typeof s.workspaceId !== 'string' ||
    !WORKSPACE_ID.test(s.workspaceId) ||
    typeof s.credential !== 'string' ||
    !MANAGEMENT_CREDENTIAL.test(s.credential) ||
    !isoInstant(s.trialExpiresAt) ||
    typeof s.startedAt !== 'string' ||
    !Number.isSafeInteger(s.sessionsCreated) ||
    (s.sessionsCreated as number) < 0
  )
    throw new AdapterError(
      'STATE_STORE_ERROR',
      'The saved Sess trial is unreadable. It was left unchanged and nothing was sent.',
    );
  return {
    schema: 1,
    origin: s.origin,
    workspaceId: s.workspaceId,
    credential: s.credential,
    trialExpiresAt: s.trialExpiresAt,
    startedAt: s.startedAt,
    sessionsCreated: s.sessionsCreated as number,
  };
}

function processAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'EPERM';
  }
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * The trial's protected state for one profile and API origin:
 * `<stateDir>/profiles/<profile>/trials/<origin digest>.json`, mode 0600 in a 0700 directory.
 * `withLock` serializes trial starts within this process (single flight) and across processes
 * sharing the state directory (an exclusive lock file naming its holder's pid).
 */
export class TrialStateStore {
  readonly #dir: string;
  readonly #path: string;
  readonly #origin: string;
  #queue: Promise<unknown> = Promise.resolve();

  constructor(stateDir: string, profile: string, origin: string) {
    this.#origin = origin;
    this.#dir = join(stateDir, 'profiles', profile, 'trials');
    const name = createHash('sha256').update(origin, 'utf8').digest('hex').slice(0, 32);
    this.#path = join(this.#dir, `${name}.json`);
  }

  async read(): Promise<TrialState | undefined> {
    let text: string;
    try {
      text = await readFile(this.#path, 'utf8');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
      throw new AdapterError('STATE_STORE_ERROR', 'The saved Sess trial could not be read.', true);
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      parsed = undefined;
    }
    return decodeState(parsed, this.#origin);
  }

  async write(state: TrialState): Promise<void> {
    await mkdir(this.#dir, { recursive: true, mode: 0o700 });
    await atomicWrite(this.#path, this.#dir, JSON.stringify(state));
  }

  async withLock<T>(fn: () => Promise<T>): Promise<T> {
    const previous = this.#queue;
    let release!: () => void;
    this.#queue = new Promise<void>((resolve) => (release = resolve));
    await previous.catch(() => undefined);
    try {
      const lock = await this.#acquireFileLock();
      try {
        return await fn();
      } finally {
        await rm(lock, { force: true }).catch(() => undefined);
      }
    } finally {
      release();
    }
  }

  async #acquireFileLock(): Promise<string> {
    const lock = `${this.#path}.lock`;
    const deadline = Date.now() + LOCK_WAIT_MS;
    try {
      await mkdir(this.#dir, { recursive: true, mode: 0o700 });
    } catch {
      throw new AdapterError('STATE_STORE_ERROR', 'The local state directory could not be prepared.', true);
    }
    for (;;) {
      try {
        await writeFile(lock, JSON.stringify({ pid: process.pid }), { mode: 0o600, flag: 'wx' });
        return lock;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'EEXIST')
          throw new AdapterError('STATE_STORE_ERROR', 'The saved Sess trial could not be locked.', true);
      }
      // A lock left by a process that no longer runs is removed; a live holder is waited for.
      let holder: number | undefined;
      try {
        const pid: unknown = (JSON.parse(await readFile(lock, 'utf8')) as { pid?: unknown }).pid;
        holder = Number.isSafeInteger(pid) && (pid as number) > 0 ? (pid as number) : undefined;
      } catch {
        holder = undefined;
      }
      if (holder !== undefined && !processAlive(holder)) {
        await rm(lock, { force: true }).catch(() => undefined);
        continue;
      }
      if (Date.now() >= deadline)
        throw new AdapterError(
          'SESS_UNAVAILABLE',
          'Another Sess MCP server on this computer is starting the Sess trial. Nothing was sent; try again in a moment.',
          true,
        );
      await sleep(LOCK_POLL_MS);
    }
  }
}

/**
 * A create the trial refused, or could not send, with the adapter error to report. It is a
 * SessError with outcome `rejected` or `not_sent`, so the request operation discards its intent.
 */
export class TrialRefusal extends SessError {
  readonly adapterError: AdapterError;
  constructor(adapterError: AdapterError, outcome: 'rejected' | 'not_sent', code?: string) {
    super('api', 'The Sess trial did not create the Session.', {
      outcome,
      operation: 'sessions.create',
      ...(code ? { code } : {}),
    });
    this.adapterError = adapterError;
  }
}

/** Unsupported in trial mode: the operations the trial routes do not offer. */
export function trialUnsupported(what: 'publish' | 'complete' | 'expires_in'): AdapterError {
  const lead = {
    publish:
      'Trial mode can ask a person and read their answer, but it can’t show a next step on the same link (sess_publish).',
    complete:
      'Trial mode can ask a person and read their answer, but it can’t finish a request (sess_complete). Its link closes by itself within 1 hour.',
    expires_in:
      'Trial links stay open for 1 hour, and trial mode can’t change that (expires_in). Ask again without expires_in.',
  }[what];
  return new AdapterError('TRIAL_UNSUPPORTED', `${lead} ${FREE_PLAN_NEXT}`);
}

function retryHint(retryAfterMs: number | undefined): string {
  if (retryAfterMs === undefined) return 'Try again later.';
  const minutes = Math.max(1, Math.ceil(retryAfterMs / 60_000));
  return minutes >= 120
    ? `Try again in about ${Math.round(minutes / 60)} hours.`
    : `Try again in about ${minutes} minute${minutes === 1 ? '' : 's'}.`;
}

/**
 * Names the trial limit behind a 429 from what this profile knows (the API's code and Retry-After
 * are its stable contract; its message is never parsed).
 */
export function trialLimitError(
  state: Pick<TrialState, 'trialExpiresAt' | 'sessionsCreated'> | undefined,
  retryAfterMs: number | undefined,
  now = Date.now(),
): AdapterError {
  const L = TRIAL_LIMITS;
  if (!state)
    return new AdapterError(
      'TRIAL_LIMIT',
      `Sess couldn’t start a trial: this network has started ${L.maxTrialsPerClient} trials in the last ${L.trialRateWindowHours} hours, or today’s trial allowance is used up. ${retryHint(retryAfterMs)} ${FREE_PLAN_NEXT}`,
      retryAfterMs !== undefined,
    );
  if (now >= Date.parse(state.trialExpiresAt))
    return new AdapterError(
      'TRIAL_LIMIT',
      `This trial’s ${L.creationWindowHours} hours for new requests have ended. Answers you already have stay readable for ${L.resultHoursAfterLink} hours after their link closes. ${FREE_PLAN_NEXT}`,
    );
  if (state.sessionsCreated >= L.maxSessionsPerTrial)
    return new AdapterError(
      'TRIAL_LIMIT',
      `This trial has made its ${L.maxSessionsPerTrial} requests, its limit. ${FREE_PLAN_NEXT}`,
    );
  return new AdapterError(
    'TRIAL_LIMIT',
    `This trial already has ${L.maxActiveSessions} requests waiting for an answer, its limit. Try again when one is answered or its link closes (within ${L.linkHours} hour); ${retryHint(retryAfterMs).toLowerCase()} ${FREE_PLAN_NEXT}`,
    true,
  );
}

function trialEnded(): AdapterError {
  return new AdapterError(
    'TRIAL_ENDED',
    `This Sess trial has ended, so it can’t make new requests. ${FREE_PLAN_NEXT}`,
  );
}

function retryAfterMs(header: string | null): number | undefined {
  if (header === null || !/^\d{1,9}$/.test(header.trim())) return undefined;
  return Number(header.trim()) * 1000;
}

function httpsOrLoopback(text: unknown, allowInsecureLocalhost: boolean): text is string {
  if (typeof text !== 'string' || text.length > 4096 || /[\s\u0000-\u001f\u007f]/.test(text)) return false;
  let url: URL;
  try {
    url = new URL(text);
  } catch {
    return false;
  }
  const loopback = url.hostname === 'localhost' || url.hostname === '[::1]' || /^127\./.test(url.hostname);
  return (
    !url.username &&
    !url.password &&
    !url.hash &&
    !url.search &&
    (url.protocol === 'https:' || (allowInsecureLocalhost && url.protocol === 'http:' && loopback))
  );
}

/** A create whose outcome is unknown: a Session (and a trial) may exist. Never retried. */
function unknownOutcome(status?: number, code?: string): SessError {
  return new SessError(
    'unknown_outcome',
    'Session creation may have succeeded. Do not automatically create again.',
    {
      outcome: 'unknown',
      operation: 'sessions.create',
      ...(status ? { status } : {}),
      ...(code ? { code } : {}),
    },
  );
}

/** The trial's definitive refusals: refused before any write (see the trial API contract). */
const TRIAL_REJECTIONS: Record<number, readonly string[]> = {
  400: ['INVALID_SCHEMA', 'UNKNOWN_COMPONENT'],
  404: ['NOT_FOUND'],
  413: ['PAYLOAD_TOO_LARGE'],
  429: ['RATE_LIMITED'],
  503: ['TRIAL_UNAVAILABLE'],
};

export interface TrialClientOptions {
  config: TrialConfig;
  state: TrialStateStore;
  diagnostics: Diagnostics;
  /** Records a value that must never appear in diagnostics (the credential, every Sess link). */
  protect: (secret: string) => void;
  /** Test seam only; never reachable from tool arguments. */
  fetch?: typeof globalThis.fetch;
  now?: () => number;
}

/**
 * The SessClient for trial mode. `sessions.create` starts the trial lazily on the first create and
 * reuses it afterwards; reads and receipt verification are the SDK's own, with the saved credential.
 */
export function createTrialClient(options: TrialClientOptions): SessClient {
  const { config, state: store, diagnostics, protect } = options;
  const fetcher = options.fetch ?? globalThis.fetch;
  const now = options.now ?? Date.now;
  let reader: { credential: string; sess: Sess } | undefined;

  async function post(body: { interaction: unknown }, credential: string | undefined): Promise<Response> {
    let response: Response;
    try {
      response = await fetcher(`${config.origin}/v1/trial/sessions`, {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
          ...(credential ? { Authorization: `Bearer ${credential}` } : {}),
        },
        body: JSON.stringify(body),
        redirect: 'manual',
        credentials: 'omit',
        signal: AbortSignal.timeout(CREATE_TIMEOUT_MS),
      });
    } catch {
      // Sent (or possibly sent) with no answer: the outcome is unknown and never retried.
      throw unknownOutcome();
    }
    return response;
  }

  /** Reads a non-201 answer: a definitive refusal, or an unknown outcome. */
  async function refusal(response: Response): Promise<{ code: string | undefined; retryAfterMs?: number }> {
    let code: string | undefined;
    try {
      const value = (await response.json()) as { error?: { code?: unknown } };
      const c = value?.error?.code;
      code = typeof c === 'string' && /^[A-Z][A-Z0-9_]{0,95}$/.test(c) ? c : undefined;
    } catch {
      code = undefined;
    }
    if (code === undefined || !TRIAL_REJECTIONS[response.status]?.includes(code))
      throw unknownOutcome(response.status, code);
    const after = retryAfterMs(response.headers.get('retry-after'));
    return { code, ...(after !== undefined ? { retryAfterMs: after } : {}) };
  }

  async function created(response: Response, first: boolean) {
    let value: Record<string, unknown>;
    try {
      value = (await response.json()) as Record<string, unknown>;
    } catch {
      throw unknownOutcome(response.status, 'INVALID_RESPONSE');
    }
    if (
      !value ||
      typeof value !== 'object' ||
      typeof value.id !== 'string' ||
      !SESSION_ID.test(value.id) ||
      !Number.isSafeInteger(value.revision) ||
      (value.revision as number) < 1 ||
      !httpsOrLoopback(value.human_url, config.allowInsecureLocalhost) ||
      (value.action_expires_at !== undefined && !isoInstant(value.action_expires_at)) ||
      typeof value.workspace_id !== 'string' ||
      !WORKSPACE_ID.test(value.workspace_id) ||
      (first &&
        (typeof value.management_credential !== 'string' ||
          !MANAGEMENT_CREDENTIAL.test(value.management_credential) ||
          !isoInstant(value.trial_expires_at)))
    )
      throw unknownOutcome(response.status, 'INVALID_RESPONSE');
    protect(value.human_url as string);
    if (typeof value.management_credential === 'string') protect(value.management_credential);
    const etag = response.headers.get('etag');
    return {
      // Only the owner-create fields; the management credential never leaves this module.
      data: {
        id: value.id,
        revision: value.revision as number,
        human_url: value.human_url as string,
        ...(value.action_expires_at !== undefined
          ? { action_expires_at: value.action_expires_at as string }
          : {}),
      },
      meta: {
        status: 201,
        attempts: 1,
        ...(etag !== null && STRONG_ETAG.test(etag) ? { etag } : {}),
      },
      workspaceId: value.workspace_id,
      credential: value.management_credential as string | undefined,
      trialExpiresAt: value.trial_expires_at as string | undefined,
    };
  }

  /** The anonymous create that starts the trial, under the trial lock. */
  async function start(body: { interaction: unknown }) {
    const response = await post(body, undefined);
    if (response.status !== 201) {
      const { code, retryAfterMs: after } = await refusal(response);
      if (code === 'RATE_LIMITED')
        throw new TrialRefusal(trialLimitError(undefined, after, now()), 'rejected', code);
      if (code === 'TRIAL_UNAVAILABLE')
        throw new TrialRefusal(
          new AdapterError(
            'TRIAL_UNAVAILABLE',
            `This Sess server doesn’t offer the no-signup trial. ${FREE_PLAN_NEXT}`,
          ),
          'rejected',
          code,
        );
      throw new SessError('api', 'The Sess trial refused the request.', {
        code,
        status: response.status,
        outcome: 'rejected',
        operation: 'sessions.create',
      });
    }
    const result = await created(response, true);
    const state: TrialState = {
      schema: 1,
      origin: config.origin,
      workspaceId: result.workspaceId as string,
      credential: result.credential as string,
      trialExpiresAt: result.trialExpiresAt as string,
      startedAt: new Date(now()).toISOString(),
      sessionsCreated: 1,
    };
    try {
      await store.write(state);
    } catch {
      // The Session and trial exist but the credential could not be kept: never claim success.
      diagnostics('trial_not_saved');
      throw unknownOutcome(201, 'TRIAL_NOT_SAVED');
    }
    diagnostics('trial_started');
    return result;
  }

  async function createInTrial(body: { interaction: unknown }, saved: TrialState) {
    const response = await post(body, saved.credential);
    if (response.status !== 201) {
      const { code, retryAfterMs: after } = await refusal(response);
      if (code === 'RATE_LIMITED')
        throw new TrialRefusal(trialLimitError(saved, after, now()), 'rejected', code);
      if (code === 'NOT_FOUND') throw new TrialRefusal(trialEnded(), 'rejected', code);
      if (code === 'TRIAL_UNAVAILABLE')
        throw new TrialRefusal(
          new AdapterError(
            'TRIAL_UNAVAILABLE',
            `This Sess server doesn’t offer the no-signup trial. ${FREE_PLAN_NEXT}`,
          ),
          'rejected',
          code,
        );
      throw new SessError('api', 'The Sess trial refused the request.', {
        code,
        status: response.status,
        outcome: 'rejected',
        operation: 'sessions.create',
      });
    }
    const result = await created(response, false);
    // Advisory count (it only names the per-trial limit); a failed save never undoes the create.
    await store
      .withLock(async () => {
        const current = await store.read();
        if (current && current.credential === saved.credential)
          await store.write({ ...current, sessionsCreated: current.sessionsCreated + 1 });
      })
      .catch(() => diagnostics('trial_count_not_saved'));
    return result;
  }

  async function saved(): Promise<TrialState> {
    const state = await store.read();
    if (!state)
      throw new AdapterError(
        'STATE_STORE_ERROR',
        'The Sess trial for this interaction is no longer saved on this computer. Nothing was sent.',
      );
    protect(state.credential);
    return state;
  }

  async function sess(): Promise<Sess> {
    const state = await saved();
    if (reader?.credential !== state.credential) {
      reader = {
        credential: state.credential,
        sess: new Sess({
          apiKey: state.credential,
          baseUrl: config.origin,
          fetch: trialReadFetch(config.origin, fetcher),
          allowInsecureLocalhost: config.allowInsecureLocalhost,
          // The trial's own workspace, from its authenticated create: the receipt audience.
          expectedWorkspaceId: state.workspaceId,
          ...(config.receiptIssuer ? { receiptIssuer: config.receiptIssuer } : {}),
        }),
      };
    }
    return reader.sess;
  }

  const sessions = {
    async create(request: CreateSessionRequest) {
      const body = { interaction: request.interaction };
      if ((request as { expires_in?: unknown }).expires_in !== undefined)
        throw new TrialRefusal(trialUnsupported('expires_in'), 'not_sent');
      let existing: TrialState | undefined;
      // Single flight: the first create starts the trial while holding the lock; every concurrent
      // or later create (in this process or another sharing the state) reuses the saved trial.
      const first = await store
        .withLock(async () => {
          existing = await store.read();
          if (existing) return undefined;
          return start(body);
        })
        .catch((error: unknown) => {
          if (error instanceof AdapterError) throw new TrialRefusal(error, 'not_sent');
          throw error;
        });
      if (first) return { data: first.data, meta: first.meta };
      protect(existing!.credential);
      const next = await createInTrial(body, existing!);
      return { data: next.data, meta: next.meta };
    },
    async retrieve(id: string, requestOptions?: Parameters<Sess['sessions']['retrieve']>[1]) {
      return (await sess()).sessions.retrieve(id, requestOptions);
    },
    async waitForResponse(id: string, waitOptions: Parameters<Sess['sessions']['waitForResponse']>[1]) {
      return (await sess()).sessions.waitForResponse(id, waitOptions);
    },
    publish(): never {
      throw trialUnsupported('publish');
    },
    complete(): never {
      throw trialUnsupported('complete');
    },
  };
  const receipts = {
    async verifyResponse(...args: Parameters<Sess['receipts']['verifyResponse']>) {
      return (await sess()).receipts.verifyResponse(...args);
    },
  };
  return { sessions, receipts } as unknown as SessClient;
}

/**
 * The narrow fetch the SDK reads through in trial mode. It maps exactly two owner read paths onto
 * the trial read route and passes the public receipt-key read through; anything else is refused
 * before dispatch, so the management credential reaches no other route.
 *
 * - `GET /v1/sessions/{id}` reads `GET /v1/trial/sessions/{id}`; the link expiry the trial reports
 *   in `trial.action_expires_at` is also given as `action_expires_at`, as on the owner read.
 * - `GET /v1/sessions/{id}/surfaces/{n}` is the same read's interaction when the Session is at
 *   revision n. A trial Session never publishes, so revision 1 is its only, immutable revision.
 * - `GET /.well-known/sess-receipt-keys.json` unchanged and unauthenticated.
 */
export function trialReadFetch(origin: string, fetcher: typeof globalThis.fetch): typeof globalThis.fetch {
  const notFound = () =>
    new Response(JSON.stringify({ error: { code: 'NOT_FOUND', message: 'Not found.' } }), {
      status: 404,
      headers: { 'content-type': 'application/json' },
    });
  return (async (input: string | URL | Request, init: RequestInit = {}) => {
    const url = new URL(typeof input === 'string' || input instanceof URL ? input : input.url);
    const method = (init.method ?? 'GET').toUpperCase();
    if (url.origin !== origin || method !== 'GET' || url.search || url.hash)
      throw new TypeError('Not available in trial mode.');
    if (url.pathname === '/.well-known/sess-receipt-keys.json') {
      const headers = new Headers(init.headers);
      headers.delete('authorization');
      return fetcher(url.href, { ...init, headers });
    }
    const match = /^\/v1\/sessions\/(ses_[0-9A-HJKMNP-TV-Z]{26})(?:\/surfaces\/([1-9]\d{0,8}))?$/.exec(
      url.pathname,
    );
    if (!match) throw new TypeError('Not available in trial mode.');
    const [, id, surface] = match;
    const response = await fetcher(`${origin}/v1/trial/sessions/${id}`, init);
    if (response.status !== 200) return response;
    const mediaType = response.headers.get('content-type')?.split(';')[0]?.trim().toLowerCase();
    if (mediaType !== 'application/json') return response;
    let body: Record<string, unknown>;
    try {
      body = (await response.json()) as Record<string, unknown>;
    } catch {
      return new Response('{', { status: 200, headers: { 'content-type': 'application/json' } });
    }
    const headers = new Headers();
    for (const name of ['content-type', 'etag', 'date', 'x-request-id']) {
      const value = response.headers.get(name);
      if (value !== null) headers.set(name, value);
    }
    if (surface !== undefined) {
      if (!body || typeof body !== 'object' || body.revision !== Number(surface)) return notFound();
      headers.delete('etag');
      return new Response(
        JSON.stringify({
          id: body.id,
          revision: body.revision,
          interaction: body.interaction,
          response_schema: body.response_schema,
        }),
        { status: 200, headers },
      );
    }
    const trial = body?.trial as { action_expires_at?: unknown } | undefined;
    if (
      body &&
      typeof body === 'object' &&
      body.action_expires_at === undefined &&
      trial?.action_expires_at !== undefined
    )
      body = { ...body, action_expires_at: trial.action_expires_at };
    return new Response(JSON.stringify(body), { status: 200, headers });
  }) as typeof globalThis.fetch;
}
