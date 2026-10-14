import { randomBytes } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Sess } from '@sess.si/sdk';
import type { AdapterConfig } from '../src/config.js';
import { SessMcpAdapter, type SessClient } from '../src/operations.js';

export const ORIGIN = 'https://api.sess.test';
// Synthetic, never a real credential format.
export const API_KEY = 'synthetic-owner-key-one';
export const SESSION_ID = 'ses_00000000000000000000000001';

const fixtures = join(import.meta.dirname, '..', '..', 'fixtures', 'plan-afternoon');
export const ROUND_1 = JSON.parse(readFileSync(join(fixtures, 'round-1.json'), 'utf8')) as Record<
  string,
  unknown
>;
export const ROUND_2 = JSON.parse(readFileSync(join(fixtures, 'round-2.json'), 'utf8')) as Record<
  string,
  unknown
>;
export const ANSWER_1 = JSON.parse(readFileSync(join(fixtures, 'answer-1.json'), 'utf8')) as {
  action_id: string;
  data: Record<string, unknown>;
};

export function tempDir(): { path: string; cleanup(): void } {
  const path = mkdtempSync(join(tmpdir(), 'sess-mcp-test-'));
  return { path, cleanup: () => rmSync(path, { recursive: true, force: true }) };
}

export function env(stateDir: string, overrides: Record<string, string> = {}): NodeJS.ProcessEnv {
  return { SESS_API_KEY: API_KEY, SESS_API_ORIGIN: ORIGIN, SESS_MCP_STATE_DIR: stateDir, ...overrides };
}

type Json = Record<string, any>;
export interface Call {
  method: string;
  path: string;
  ifMatch?: string | null;
  idempotencyKey?: string | null;
  authorization?: string | null;
}

/**
 * Deterministic in-memory stand-in for the SESS owner HTTP API, served through the real SDK's
 * fetch seam. It implements only what the adapter uses. No network is involved.
 */
export class FakeSess {
  session: Json | undefined;
  calls: Call[] = [];
  /** Human link token is generated at runtime; no capability literal exists in source. */
  humanUrl = `https://app.sess.test/s/${randomBytes(32).toString('base64url')}`;
  #version = 1;
  #replays = new Map<string, { status: number; body: Json; etag: string }>();
  /** Set to make the next matching request fail at the network level after (or before) applying. */
  failNext: { method: string; pathSuffix: string; apply: boolean } | undefined;
  createFailure: 'network' | 'reject' | undefined;
  /** Answer the next matching request with this HTTP error, without applying it. */
  rejectNext: { method: string; pathSuffix: string; status: number; code: string } | undefined;
  /** Runs once, before the next GET of the Session is served (to stage interleavings). */
  beforeNextGet: (() => Promise<void>) | undefined;

  etag(): string {
    return `"v${this.#version}"`;
  }

  answer(data: Json, actionId = 'submit', receipt: string | null = 'aaaa.bbbb.cccc'): string {
    const s = this.session!;
    const eventId = `evt_0000000000000000000000000${s.responses.length + 1}`;
    s.responses.push({
      event_id: eventId,
      sequence: s.responses.length + 1,
      revision: s.revision,
      action_id: actionId,
      data,
      actor: { assurance: 'link_holder' },
      accepted_at: '2026-10-13T12:00:00.000Z',
      receipt,
    });
    s.status = 'responded';
    this.#version++;
    return eventId;
  }

  #json(status: number, body: unknown, headers: Record<string, string> = {}): Response {
    return new Response(JSON.stringify(body), {
      status,
      headers: { 'content-type': 'application/json', 'sess-workspace-id': 'wks_synthetic', ...headers },
    });
  }

  fetch = async (input: string | URL | Request, init: RequestInit = {}): Promise<Response> => {
    const url = new URL(typeof input === 'string' || input instanceof URL ? input : input.url);
    const headers = new Headers(init.headers);
    const method = init.method ?? 'GET';
    const call: Call = {
      method,
      path: url.pathname,
      ifMatch: headers.get('if-match'),
      idempotencyKey: headers.get('idempotency-key'),
      authorization: headers.get('authorization'),
    };
    this.calls.push(call);
    if (init.signal?.aborted) throw init.signal.reason ?? new DOMException('aborted', 'AbortError');
    const reject = this.rejectNext;
    if (reject && reject.method === method && url.pathname.endsWith(reject.pathSuffix)) {
      this.rejectNext = undefined;
      return this.#json(reject.status, { error: { code: reject.code, request_id: 'req_9', message: 'x' } });
    }
    if (method === 'GET' && this.beforeNextGet && url.pathname === `/v1/sessions/${SESSION_ID}`) {
      const hook = this.beforeNextGet;
      this.beforeNextGet = undefined;
      await hook();
    }
    const fail = this.failNext;
    if (fail && fail.method === method && url.pathname.endsWith(fail.pathSuffix)) {
      this.failNext = undefined;
      if (fail.apply) await this.#route(method, url, init, headers);
      throw new TypeError('fetch failed');
    }
    return this.#route(method, url, init, headers);
  };

  async #route(method: string, url: URL, init: RequestInit, headers: Headers): Promise<Response> {
    const path = url.pathname;
    if (method === 'POST' && path === '/v1/sessions') {
      if (this.createFailure === 'network') throw new TypeError('fetch failed');
      if (this.createFailure === 'reject')
        return this.#json(400, { error: { code: 'INVALID_SCHEMA', request_id: 'req_1', message: 'x' } });
      const body = JSON.parse(String(init.body)) as Json;
      this.session = {
        id: SESSION_ID,
        revision: 1,
        status: 'active',
        interaction: { ...body.interaction, response_policy: 'first' },
        response_schema: { type: 'object' },
        responses: [],
      };
      return this.#json(
        201,
        { id: SESSION_ID, revision: 1, human_url: this.humanUrl },
        { etag: this.etag() },
      );
    }
    const s = this.session;
    if (!s || !path.startsWith(`/v1/sessions/${SESSION_ID}`))
      return this.#json(404, { error: { code: 'NOT_FOUND', request_id: 'req_2', message: 'x' } });
    const rest = path.slice(`/v1/sessions/${SESSION_ID}`.length);
    if (method === 'GET' && rest === '') return this.#json(200, s, { etag: this.etag() });
    const surface = /^\/surfaces\/(\d+)$/.exec(rest);
    if (method === 'GET' && surface)
      return this.#json(200, {
        id: SESSION_ID,
        revision: Number(surface[1]),
        interaction: s.interaction,
        response_schema: s.response_schema,
      });
    if ((method === 'POST' && rest === '/complete') || (method === 'PATCH' && rest === '')) {
      const key = headers.get('idempotency-key') ?? '';
      const replay = this.#replays.get(key);
      if (replay) return this.#json(replay.status, replay.body, { etag: replay.etag });
      if (s.status === 'completed')
        return this.#json(409, { error: { code: 'SESSION_COMPLETED', request_id: 'req_3', message: 'x' } });
      if (headers.get('if-match') !== this.etag())
        return this.#json(412, {
          error: { code: 'SESSION_REVISION_CONFLICT', request_id: 'req_4', message: 'x' },
        });
      if (method === 'POST') s.status = 'completed';
      else {
        const body = JSON.parse(String(init.body)) as Json;
        s.revision += 1;
        s.status = 'active';
        s.interaction = { ...body.interaction, response_policy: 'first' };
      }
      this.#version++;
      this.#replays.set(key, { status: 200, body: structuredClone(s), etag: this.etag() });
      return this.#json(200, s, { etag: this.etag() });
    }
    if (method === 'GET' && path === '/.well-known/sess-receipt-keys.json')
      return this.#json(200, { keys: [] });
    return this.#json(404, { error: { code: 'NOT_FOUND', request_id: 'req_5', message: 'x' } });
  }
}

/** Real SDK client over the fake API; optionally replaces receipt verification. */
export function clientFor(
  fake: FakeSess,
  verify?: SessClient['receipts']['verifyResponse'],
): (config: AdapterConfig) => SessClient {
  return (config) => {
    const sess = new Sess({
      apiKey: config.apiKey,
      baseUrl: config.origin,
      fetch: fake.fetch as typeof fetch,
      maxRetries: 0,
    });
    return { sessions: sess.sessions, receipts: verify ? { verifyResponse: verify } : sess.receipts };
  };
}

/** A verification stand-in that accepts exactly what the fake runtime holds (unit tests only). */
export function acceptingVerifier(fake: FakeSess): SessClient['receipts']['verifyResponse'] {
  return (async ({ sessionId, response }) => {
    const s = fake.session!;
    return {
      claims: {},
      response,
      surface: {
        id: sessionId,
        revision: response.revision,
        interaction: s.interaction,
        response_schema: {},
      },
    };
  }) as SessClient['receipts']['verifyResponse'];
}

export function adapterWith(
  stateDir: string,
  fake: FakeSess,
  options: {
    env?: Record<string, string>;
    verify?: SessClient['receipts']['verifyResponse'];
    lines?: string[];
  } = {},
): SessMcpAdapter {
  const lines = options.lines ?? [];
  return new SessMcpAdapter({
    env: env(stateDir, options.env),
    diagnostics: (event, fields = {}) => lines.push(`${event} ${JSON.stringify(fields)}`),
    createClient: clientFor(fake, options.verify),
  });
}
