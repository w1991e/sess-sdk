import { afterEach, describe, expect, it, vi } from 'vitest';
import { inspect } from 'node:util';
import { Sess, SessError } from '../../src/index.js';
import type { RequestOptions, SessOptions } from '../../src/index.js';
import {
  API_KEY,
  INTERACTION,
  RESPONSE,
  SESSION_ID,
  WORKSPACE,
  apiError,
  creation,
  json,
  session,
} from '../fixtures/api.js';

const client = (fetch: typeof globalThis.fetch, options: Partial<SessOptions> = {}) =>
  new Sess({ apiKey: API_KEY, fetch, ...options });
afterEach(() => vi.useRealTimers());

describe('configuration and boundaries', () => {
  it.each(['provider', 'fetch', 'stream'] as const)(
    'sanitizes an injected %s failure even when it throws a public SessError',
    async (source) => {
      const external = new SessError('configuration', `private ${API_KEY}`, {
        code: API_KEY,
        outcome: 'rejected',
      });
      const fetch: typeof globalThis.fetch = vi.fn(async () => {
        if (source === 'fetch') throw external;
        return new Response(
          new ReadableStream({
            start(controller) {
              controller.error(external);
            },
          }),
          {
            status: 201,
            headers: { 'content-type': 'application/json', etag: '"created"' },
          },
        );
      });
      const sdk = client(fetch, {
        apiKey:
          source === 'provider'
            ? () => {
                throw external;
              }
            : API_KEY,
      });
      const error = await sdk.sessions.create({ interaction: INTERACTION }).then(
        () => {
          throw new Error('Expected rejection');
        },
        (error: unknown) => {
          if (!(error instanceof SessError)) throw error;
          return error;
        },
      );
      expect(error.outcome).toBe(source === 'provider' ? 'not_sent' : 'unknown');
      expect(error.kind).toBe(source === 'provider' ? 'configuration' : 'unknown_outcome');
      expect(`${String(error)} ${JSON.stringify(error)} ${inspect(error)}`).not.toContain(API_KEY);
      expect(fetch).toHaveBeenCalledTimes(source === 'provider' ? 0 : 1);
    },
  );
  it.each([undefined, '', ' key', 'key ', 'key\nother', 'key\tother'])(
    'rejects malformed key %s before I/O',
    (key) => {
      const fetch = vi.fn();
      expect(() => new Sess({ apiKey: key, fetch })).toThrow(SessError);
      expect(fetch).not.toHaveBeenCalled();
    },
  );
  it('constructs with owner keys/provider without network, credential files, or logs', () => {
    const provider = vi.fn(async () => API_KEY);
    const fetch = vi.fn();
    const instance = client(fetch, { apiKey: provider });
    expect(Object.keys(instance)).toEqual(['sessions', 'webhooks', 'receipts']);
    expect(provider).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
    expect(inspect(instance)).not.toContain(API_KEY);
  });
  it.each([
    'http://example.com',
    'https://a:b@example.com',
    'https://example.com/path',
    'https://example.com/?x=1',
    'https://example.com/#x',
    ' https://example.com',
    'https://example.com\\path',
  ])('rejects unsafe base %s', (baseUrl) => {
    expect(() => client(vi.fn(), { baseUrl })).toThrow(SessError);
  });
  it('allows only explicit loopback HTTP development', () => {
    expect(() => client(vi.fn(), { baseUrl: 'http://127.0.0.1:1234' })).toThrow();
    expect(() =>
      client(vi.fn(), { baseUrl: 'http://127.0.0.1:1234', allowInsecureLocalhost: true }),
    ).not.toThrow();
    expect(() => client(vi.fn(), { baseUrl: 'http://192.168.0.2', allowInsecureLocalhost: true })).toThrow();
  });
  it('encodes IDs and never forwards credentials on redirects', async () => {
    const fetch = vi.fn(
      async () => new Response(null, { status: 302, headers: { location: 'https://attacker.invalid/' } }),
    );
    await expect(client(fetch).sessions.retrieve('part/other?value')).rejects.toMatchObject({
      kind: 'protocol',
      code: 'REDIRECT_REFUSED',
      attempts: 1,
    });
    expect(fetch).toHaveBeenCalledTimes(1);
    const [url, options] = fetch.mock.calls[0]! as unknown as [string, RequestInit];
    expect(url).toBe('https://api.sess.si/v1/sessions/part%2Fother%3Fvalue');
    expect(options.redirect).toBe('manual');
    expect(options.credentials).toBe('omit');
    expect(options.headers).toMatchObject({ Authorization: `Bearer ${API_KEY}` });
  });
  it('refuses request header/credential overrides', async () => {
    const fetch = vi.fn(async () => creation());
    await expect(
      client(fetch).sessions.create({ interaction: INTERACTION }, {
        headers: { Authorization: 'other' },
      } as RequestOptions),
    ).rejects.toMatchObject({ outcome: 'not_sent' });
    expect(fetch).not.toHaveBeenCalled();
  });
});

describe('single attempt create and secret-safe failure', () => {
  it.each([408, 429, 500, 502, 503, 504])('never retries create HTTP %i', async (status) => {
    const fetch = vi.fn(async () => new Response('private gateway page', { status }));
    const error = await client(fetch, { maxRetries: 10 })
      .sessions.create({ interaction: INTERACTION })
      .then(
        () => {
          throw new Error('Expected rejection');
        },
        (error: unknown) => {
          if (!(error instanceof SessError)) throw error;
          return error;
        },
      );
    expect(error).toMatchObject({ kind: 'unknown_outcome', outcome: 'unknown', status, attempts: 1 });
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(inspect(error)).not.toContain('private gateway');
    const init = (fetch.mock.calls as unknown as [unknown, RequestInit][])[0]?.[1];
    expect(new Headers(init?.headers).has('idempotency-key')).toBe(false);
  });
  it('reports a 429 PLAN_LIMIT_REACHED create as a definite refusal with its reason and Retry-After', async () => {
    const fetch = vi.fn(async () =>
      json(
        {
          error: {
            code: 'PLAN_LIMIT_REACHED',
            reason: 'monthly_allowance',
            request_id: 'request-123',
            message: 'remote upgrade text https://sess.si/usage must not be shown',
          },
        },
        429,
        { 'retry-after': '3600' },
      ),
    );
    const error = await client(fetch, { maxRetries: 10 })
      .sessions.create({ interaction: INTERACTION })
      .then(
        () => {
          throw new Error('Expected rejection');
        },
        (error: unknown) => {
          if (!(error instanceof SessError)) throw error;
          return error;
        },
      );
    expect(error).toMatchObject({
      kind: 'api',
      code: 'PLAN_LIMIT_REACHED',
      reason: 'monthly_allowance',
      status: 429,
      requestId: 'request-123',
      retryAfterMs: 3_600_000,
      outcome: 'rejected',
      attempts: 1,
    });
    expect(error.getRecoveryResult()).toBeUndefined();
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(error)).not.toContain('upgrade');
    expect(inspect(error)).not.toContain('sess.si/usage');
  });
  it('keeps a 429 active_sessions plan limit definite without Retry-After', async () => {
    const fetch = vi.fn(async () => apiError(429, 'PLAN_LIMIT_REACHED', { reason: 'active_sessions' }));
    await expect(client(fetch).sessions.create({ interaction: INTERACTION })).rejects.toMatchObject({
      kind: 'api',
      code: 'PLAN_LIMIT_REACHED',
      reason: 'active_sessions',
      outcome: 'rejected',
      retryAfterMs: undefined,
      attempts: 1,
    });
  });
  it.each([
    ['429 RATE_LIMITED', () => apiError(429, 'RATE_LIMITED')],
    ['429 without a code', () => new Response('', { status: 429 })],
    ['PLAN_LIMIT_REACHED on a 503', () => apiError(503, 'PLAN_LIMIT_REACHED')],
  ])('keeps %s uncertain on create', async (_label, reply) => {
    const fetch = vi.fn(async () => reply());
    await expect(
      client(fetch, { maxRetries: 10 }).sessions.create({ interaction: INTERACTION }),
    ).rejects.toMatchObject({ kind: 'unknown_outcome', outcome: 'unknown', attempts: 1 });
    expect(fetch).toHaveBeenCalledTimes(1);
  });
  it('does not offer create idempotency options to JS callers', async () => {
    const fetch = vi.fn();
    await expect(
      client(fetch).sessions.create({ interaction: INTERACTION }, {
        idempotencyKey: 'fake',
      } as RequestOptions),
    ).rejects.toMatchObject({ outcome: 'not_sent' });
    expect(fetch).not.toHaveBeenCalled();
  });
  it('preserves nested safe API fields and authoritative rejection', async () => {
    const fetch = vi.fn(async () => apiError(400, 'INVALID_SCHEMA', { reason: 'bad_answer' }));
    const error = await client(fetch)
      .sessions.create({ interaction: INTERACTION })
      .then(
        () => {
          throw new Error('Expected rejection');
        },
        (error: unknown) => {
          if (!(error instanceof SessError)) throw error;
          return error;
        },
      );
    expect(error).toMatchObject({
      kind: 'api',
      code: 'INVALID_SCHEMA',
      reason: 'bad_answer',
      requestId: 'request-123',
      status: 400,
      outcome: 'rejected',
      attempts: 1,
    });
    expect(JSON.stringify(error)).not.toContain('remote secret');
    expect(inspect(error)).not.toContain(API_KEY);
  });
  it('retains unknown safe API codes without trusting a new rejection semantic', async () => {
    const fetch = vi.fn(async () => apiError(400, 'FUTURE_CODE'));
    await expect(client(fetch).sessions.create({ interaction: INTERACTION })).rejects.toMatchObject({
      code: 'FUTURE_CODE',
      outcome: 'unknown',
    });
  });
  it.each([undefined, 'W/"weak"', 'unquoted'])(
    'keeps validated creation private recovery for bad ETag %s',
    async (etag) => {
      const fetch = vi.fn(async () =>
        json(
          { id: SESSION_ID, revision: 1, human_url: 'https://human.example/s/private-capability' },
          201,
          etag === undefined ? {} : { etag },
        ),
      );
      const error = await client(fetch)
        .sessions.create({ interaction: INTERACTION })
        .then(
          () => {
            throw new Error('Expected rejection');
          },
          (error: unknown) => {
            if (!(error instanceof SessError)) throw error;
            return error;
          },
        );
      expect(error).toBeInstanceOf(SessError);
      expect(error).toMatchObject({ kind: 'unknown_outcome', code: 'INVALID_ETAG', outcome: 'unknown' });
      expect(error.getRecoveryResult()?.id).toBe(SESSION_ID);
      expect(error.getRecoveryResult()?.human_url).toContain('private-capability');
      expect(inspect(error)).not.toContain('private-capability');
      expect(JSON.stringify(error)).not.toContain('private-capability');
      expect(error.stack).not.toContain('private-capability');
    },
  );
  it.each([
    ['html', 'text/html'],
    ['{malformed', 'application/json'],
    ['{}', 'application/json'],
  ])('malformed create has unknown outcome without fabricated recovery', async (body, contentType) => {
    const fetch = vi.fn(
      async () =>
        new Response(body, { status: 201, headers: { 'content-type': contentType, etag: '"one"' } }),
    );
    const error = await client(fetch)
      .sessions.create({ interaction: INTERACTION })
      .then(
        () => {
          throw new Error('Expected rejection');
        },
        (error: unknown) => {
          if (!(error instanceof SessError)) throw error;
          return error;
        },
      );
    expect(error.outcome).toBe('unknown');
    expect(error.getRecoveryResult()).toBeUndefined();
    expect(fetch).toHaveBeenCalledTimes(1);
  });
  it('abort after dispatch reports uncertainty, before dispatch reports not_sent', async () => {
    const controller = new AbortController();
    const fetch = vi.fn(async () => {
      controller.abort('secret reason');
      throw new Error('secret transport');
    });
    await expect(
      client(fetch).sessions.create({ interaction: INTERACTION }, { signal: controller.signal }),
    ).rejects.toMatchObject({ outcome: 'unknown', attempts: 1 });
    const before = new AbortController();
    before.abort();
    await expect(
      client(fetch).sessions.create({ interaction: INTERACTION }, { signal: before.signal }),
    ).rejects.toMatchObject({ outcome: 'not_sent', attempts: 0 });
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});

describe('request snapshots, retry identity and concurrent mutation', () => {
  it('snapshots JSON/options and resolves credential once across retries', async () => {
    let unlock!: (key: string) => void;
    const provider = vi.fn(
      () =>
        new Promise<string>((resolve) => {
          unlock = resolve;
        }),
    );
    const requests: RequestInit[] = [];
    const fetch = vi.fn(async (_url: Parameters<typeof globalThis.fetch>[0], init?: RequestInit) => {
      requests.push(init!);
      return requests.length === 1
        ? apiError(503, 'SERVICE_UNAVAILABLE')
        : json(session({ revision: 2, responses: [RESPONSE] }), 200, { etag: '"two"' });
    });
    const body = structuredClone({ interaction: INTERACTION });
    const options = { ifMatch: '"one"', idempotencyKey: 'persisted-key' };
    const result = client(fetch, { apiKey: provider }).sessions.publish(SESSION_ID, body, options);
    body.interaction.title = 'CHANGED';
    options.ifMatch = '"new"';
    options.idempotencyKey = 'changed';
    unlock(API_KEY);
    const response = await result;
    expect(response.meta.idempotencyKey).toBe('persisted-key');
    expect(provider).toHaveBeenCalledTimes(1);
    expect(requests).toHaveLength(2);
    expect(requests[0]?.body).toBe(requests[1]?.body);
    expect(requests[0]?.body).not.toContain('CHANGED');
    expect(requests[0]?.headers).toEqual(requests[1]?.headers);
    expect(requests[1]?.headers).toMatchObject({
      'If-Match': '"one"',
      'Idempotency-Key': 'persisted-key',
      Authorization: `Bearer ${API_KEY}`,
    });
  });
  it('never retries a keyed mutation refused with 429 PLAN_LIMIT_REACHED', async () => {
    const fetch = vi.fn(async () => apiError(429, 'PLAN_LIMIT_REACHED', { reason: 'active_sessions' }));
    await expect(
      client(fetch, { maxRetries: 10 }).sessions.publish(
        SESSION_ID,
        { interaction: INTERACTION },
        { ifMatch: '"one"' },
      ),
    ).rejects.toMatchObject({
      kind: 'api',
      code: 'PLAN_LIMIT_REACHED',
      status: 429,
      attempts: 1,
      outcome: 'rejected',
    });
    expect(fetch).toHaveBeenCalledTimes(1);
  });
  it.each([
    ['RATE_LIMITED', () => apiError(429, 'RATE_LIMITED')],
    ['no code', () => new Response('', { status: 429, headers: { 'retry-after': '0' } })],
  ])('still retries a keyed mutation after a 429 rate limit (%s)', async (_label, reply) => {
    const fetch = vi
      .fn()
      .mockImplementationOnce(async () => reply())
      .mockImplementationOnce(async () =>
        json(session({ status: 'completed' }), 200, { etag: '"completed"' }),
      );
    const result = await client(fetch).sessions.complete(SESSION_ID, { ifMatch: '"one"' });
    expect(result.meta.attempts).toBe(2);
  });
  it('keeps a plan limit after an uncertain earlier attempt uncertain and does not retry it', async () => {
    const fetch = vi
      .fn()
      .mockRejectedValueOnce(new Error('lost response'))
      .mockImplementation(async () => apiError(429, 'PLAN_LIMIT_REACHED'));
    await expect(
      client(fetch, { maxRetries: 10 }).sessions.complete(SESSION_ID, { ifMatch: '"one"' }),
    ).rejects.toMatchObject({ code: 'PLAN_LIMIT_REACHED', attempts: 2, outcome: 'unknown' });
    expect(fetch).toHaveBeenCalledTimes(2);
  });
  it.each([409, 412])('surfaces %i without rebasing', async (status) => {
    const fetch = vi.fn(async () =>
      apiError(status, status === 409 ? 'IDEMPOTENCY_CONFLICT' : 'SESSION_REVISION_CONFLICT'),
    );
    await expect(
      client(fetch).sessions.publish(SESSION_ID, { interaction: INTERACTION }, { ifMatch: '"old"' }),
    ).rejects.toMatchObject({ status, attempts: 1, outcome: 'rejected', idempotencyKey: expect.any(String) });
    expect(fetch).toHaveBeenCalledTimes(1);
  });
  it('generates one internal key and returns it after same-key completion replay', async () => {
    const headers: Headers[] = [];
    const fetch = vi.fn(async (_url: Parameters<typeof globalThis.fetch>[0], init?: RequestInit) => {
      headers.push(new Headers(init?.headers));
      if (headers.length === 1) throw new Error('lost response');
      return json(session({ status: 'completed' }), 200, { etag: '"completed"' });
    });
    const result = await client(fetch).sessions.complete(SESSION_ID, { ifMatch: '"one"' });
    expect(headers[0]?.get('idempotency-key')).toBe(headers[1]?.get('idempotency-key'));
    expect(result.meta.idempotencyKey).toBe(headers[0]?.get('idempotency-key'));
  });
  it.each([NaN, Infinity, -Infinity, 1n, -0, new Date(), [undefined], [, 1], () => 1])(
    'rejects JSON coercion before dispatch',
    async (value) => {
      const fetch = vi.fn();
      await expect(
        client(fetch).sessions.create({
          interaction: { ...INTERACTION, source: { kind: 'data', data: { value } } },
        } as never),
      ).rejects.toMatchObject({ code: 'INVALID_JSON', outcome: 'not_sent' });
      expect(fetch).not.toHaveBeenCalled();
    },
  );
  it('rejects cycles, getters and oversized bodies, permits omitted optional properties', async () => {
    const fetch = vi.fn(async () => creation());
    const sdk = client(fetch);
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    await expect(sdk.sessions.create(cyclic as never)).rejects.toMatchObject({ code: 'INVALID_JSON' });
    let invoked = false;
    const getter = {
      get interaction() {
        invoked = true;
        return INTERACTION;
      },
    };
    await expect(sdk.sessions.create(getter)).rejects.toMatchObject({ code: 'INVALID_JSON' });
    expect(invoked).toBe(false);
    await expect(
      sdk.sessions.create({ interaction: { ...INTERACTION, description: 'x'.repeat(262144) } }),
    ).rejects.toMatchObject({ code: 'PAYLOAD_TOO_LARGE' });
    await expect(
      sdk.sessions.create({ interaction: { ...INTERACTION, description: undefined } }),
    ).resolves.toHaveProperty('data.id', SESSION_ID);
    expect(fetch).toHaveBeenCalledTimes(1);
  });
  it('preserves Unicode and prototype-shaped keys as data', async () => {
    let sent = '';
    const fetch = vi.fn(async (_url: Parameters<typeof globalThis.fetch>[0], init?: RequestInit) => {
      sent = String(init?.body);
      return creation();
    });
    const fields = JSON.parse('{"__proto__":"verbatim","constructor":"also data","café":"雪"}') as Record<
      string,
      string
    >;
    await client(fetch).sessions.create({
      interaction: {
        ...INTERACTION,
        source: { kind: 'sess_surface', components: [{ type: 'record', fields }] },
      },
    });
    expect(JSON.parse(sent).interaction.source.components[0].fields).toEqual(fields);
    expect(({} as { polluted?: boolean }).polluted).toBeUndefined();
  });
});

describe('deadlines, bounded responses and metadata', () => {
  it('bounds asynchronous credential resolution without sending', async () => {
    const fetch = vi.fn();
    const provider = () => new Promise<string>(() => {});
    await expect(
      client(fetch, { apiKey: provider, operationTimeoutMs: 20 }).sessions.create({
        interaction: INTERACTION,
      }),
    ).rejects.toMatchObject({ kind: 'timeout', outcome: 'not_sent', attempts: 0 });
    expect(fetch).not.toHaveBeenCalled();
  });
  it('bounds hung injected fetch even if it ignores AbortSignal', async () => {
    const fetch = vi.fn(() => new Promise<Response>(() => {}));
    await expect(
      client(fetch, { timeoutMs: 15, operationTimeoutMs: 25 }).sessions.create({ interaction: INTERACTION }),
    ).rejects.toMatchObject({ kind: 'unknown_outcome', outcome: 'unknown', attempts: 1 });
  });
  it('body deadline remains active and stream is cancelled', async () => {
    const cancelled = vi.fn();
    const fetch = vi.fn(
      async () =>
        new Response(
          new ReadableStream({
            start(controller) {
              controller.enqueue(new TextEncoder().encode('{'));
            },
            cancel: cancelled,
          }),
          { headers: { 'content-type': 'application/json' } },
        ),
    );
    await expect(
      client(fetch, { timeoutMs: 15, operationTimeoutMs: 25, maxRetries: 0 }).sessions.retrieve(SESSION_ID),
    ).rejects.toMatchObject({ kind: 'timeout' });
    expect(cancelled).toHaveBeenCalled();
  });
  it('counts streamed bytes without trusting content-length', async () => {
    const fetch = vi.fn(
      async () =>
        new Response('x'.repeat(64), {
          headers: { 'content-type': 'application/json', 'content-length': '1' },
        }),
    );
    await expect(client(fetch, { maxResponseBytes: 32 }).sessions.retrieve(SESSION_ID)).rejects.toMatchObject(
      { code: 'RESPONSE_TOO_LARGE', attempts: 1 },
    );
    expect(fetch).toHaveBeenCalledTimes(1);
  });
  it.each(['10', 'Mon, 12 Oct 2099 12:00:00 GMT'])(
    'honors Retry-After %s without sending early',
    async (value) => {
      const fetch = vi.fn(async () => new Response('', { status: 429, headers: { 'retry-after': value } }));
      await expect(
        client(fetch, { operationTimeoutMs: 500 }).sessions.retrieve(SESSION_ID),
      ).rejects.toMatchObject({ status: 429, attempts: 1, retryAfterMs: expect.any(Number) });
      expect(fetch).toHaveBeenCalledTimes(1);
    },
  );
  it('retries safe GET within bounded budget and returns actual attempts', async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(apiError(503, 'SERVICE_UNAVAILABLE'))
      .mockImplementationOnce(async () =>
        json(session(), 200, { etag: '"one"', 'sess-workspace-id': WORKSPACE }),
      );
    const response = await client(fetch).sessions.retrieve(SESSION_ID);
    expect(response.meta).toMatchObject({ attempts: 2, etag: '"one"', workspaceId: WORKSPACE });
  });
  it('isolates throwing observer hooks with strictly allowlisted metadata', async () => {
    const events: unknown[] = [];
    const fetch = vi.fn(async () => creation({ 'x-request-id': 'safe-request' }));
    await client(fetch, {
      onRequestEvent(e) {
        events.push(e);
        throw new Error('observer failed');
      },
    }).sessions.create({ interaction: INTERACTION });
    expect(events).toHaveLength(1);
    expect(Object.keys(events[0] as object).sort()).toEqual([
      'attempt',
      'code',
      'durationMs',
      'operation',
      'requestId',
      'status',
    ]);
    expect(JSON.stringify(events)).not.toContain('private-test-capability');
    expect(JSON.stringify(events)).not.toContain(API_KEY);
    expect(fetch).toHaveBeenCalledTimes(1);
  });
  it('redacts credential-shaped request identifiers', async () => {
    const fetch = vi.fn(async () => apiError(401, 'UNAUTHORIZED', { request_id: API_KEY }));
    const error = await client(fetch)
      .sessions.retrieve(SESSION_ID)
      .then(
        () => {
          throw new Error('Expected rejection');
        },
        (error: unknown) => {
          if (!(error instanceof SessError)) throw error;
          return error;
        },
      );
    expect(error.requestId).toBeUndefined();
    expect(JSON.stringify(error)).not.toContain(API_KEY);
  });
});
