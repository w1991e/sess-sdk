import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Sess, type WaitOptions } from '../../src/index.js';
import { API_KEY, RESPONSE, SESSION_ID, apiError, json, session } from '../fixtures/api.js';

const answered = () => json(session({ status: 'responded', responses: [RESPONSE] }), 200, { etag: '"one"' });

/** Observe SDK cleanup, including listeners on signals created inside the transport. */
function abortListeners() {
  const listeners = new Map<AbortSignal, Set<EventListenerOrEventListenerObject>>();
  const add = AbortSignal.prototype.addEventListener;
  const remove = AbortSignal.prototype.removeEventListener;
  vi.spyOn(AbortSignal.prototype, 'addEventListener').mockImplementation(function (
    this: AbortSignal,
    type,
    listener,
    options,
  ) {
    if (type === 'abort' && listener) {
      const current = listeners.get(this) ?? new Set();
      current.add(listener);
      listeners.set(this, current);
    }
    add.call(this, type, listener, options);
  });
  vi.spyOn(AbortSignal.prototype, 'removeEventListener').mockImplementation(function (
    this: AbortSignal,
    type,
    listener,
    options,
  ) {
    if (type === 'abort' && listener) listeners.get(this)?.delete(listener);
    remove.call(this, type, listener, options);
  });
  return () => [...listeners.values()].reduce((total, current) => total + current.size, 0);
}

describe('exported polling operation budgets', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'performance'] });
    vi.spyOn(Math, 'random').mockReturnValue(0);
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it.each(['credentials', 'fetch'] as const)(
    'inherits a shorter client budget during %s and disposes deadlines/listeners',
    async (stage) => {
      const remaining = abortListeners();
      const provider = vi.fn(() => (stage === 'credentials' ? new Promise<string>(() => {}) : API_KEY));
      const fetch = vi.fn(() => new Promise<Response>(() => {}));
      const failure = expect(
        new Sess({
          apiKey: provider,
          fetch,
          operationTimeoutMs: 30,
          timeoutMs: 1000,
          maxRetries: 0,
        }).sessions.waitForResponse(SESSION_ID, { revision: 1, timeoutMs: 500 }),
      ).rejects.toMatchObject({ kind: 'timeout' });
      await vi.advanceTimersByTimeAsync(600);
      await failure;
      expect(provider).toHaveBeenCalledTimes(1);
      expect(fetch).toHaveBeenCalledTimes(stage === 'fetch' ? 1 : 0);
      expect(vi.getTimerCount()).toBe(0);
      expect(remaining()).toBe(0);
    },
  );

  it('inherits a longer client budget instead of restoring the 30-second default', async () => {
    const fetch = vi.fn(async () => {
      await new Promise((resolve) => setTimeout(resolve, 35_000));
      return answered();
    });
    const result = new Sess({
      apiKey: API_KEY,
      fetch,
      operationTimeoutMs: 60_000,
      timeoutMs: 60_000,
    }).sessions
      .waitForResponse(SESSION_ID, { revision: 1, timeoutMs: 90_000 })
      .then(
        (value) => ({ value }),
        (error: unknown) => ({ error }),
      );
    await vi.advanceTimersByTimeAsync(35_001);
    expect(await result).toMatchObject({ value: { response: { event_id: RESPONSE.event_id } } });
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each([
    { client: 30, override: 100, responseDelay: 40 },
    { client: 1000, override: 50, responseDelay: 40 },
  ])('honors a valid explicit override $override with client budget $client', async (setting) => {
    const fetch = vi.fn(async () => {
      await new Promise((resolve) => setTimeout(resolve, setting.responseDelay));
      return answered();
    });
    const pending = new Sess({
      apiKey: API_KEY,
      fetch,
      operationTimeoutMs: setting.client,
      timeoutMs: 1000,
    }).sessions.waitForResponse(SESSION_ID, {
      revision: 1,
      timeoutMs: 500,
      operationTimeoutMs: setting.override,
    });
    await vi.advanceTimersByTimeAsync(41);
    expect((await pending).response).toEqual(RESPONSE);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('expires an explicit override without waiting for the longer client or human deadline', async () => {
    const fetch = vi.fn(() => new Promise<Response>(() => {}));
    const failure = expect(
      new Sess({ apiKey: API_KEY, fetch, operationTimeoutMs: 1000, maxRetries: 0 }).sessions.waitForResponse(
        SESSION_ID,
        { revision: 1, timeoutMs: 500, operationTimeoutMs: 10 },
      ),
    ).rejects.toMatchObject({ kind: 'timeout' });
    await vi.advanceTimersByTimeAsync(11);
    await failure;
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  const invalid: unknown[] = [
    0,
    -1,
    Infinity,
    -Infinity,
    NaN,
    1.5,
    2_147_483_648,
    '100',
    '',
    null,
    true,
    {},
    [],
    100n,
    new Number(100),
  ];
  it.each(invalid.map((value, index) => [index, value] as const))(
    'rejects invalid override case %i before credential resolution or fetch',
    async (_index, operationTimeoutMs) => {
      const provider = vi.fn(() => API_KEY);
      const fetch = vi.fn(async () => answered());
      await expect(
        new Sess({ apiKey: provider, fetch }).sessions.waitForResponse(SESSION_ID, {
          revision: 1,
          timeoutMs: 500,
          operationTimeoutMs,
        } as WaitOptions),
      ).rejects.toMatchObject({ kind: 'configuration', outcome: 'not_sent' });
      expect(provider).not.toHaveBeenCalled();
      expect(fetch).not.toHaveBeenCalled();
      expect(vi.getTimerCount()).toBe(0);
    },
  );

  it('bounds streaming by the inherited operation budget and cancels the reader', async () => {
    const remaining = abortListeners();
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
          { headers: { 'content-type': 'application/json', etag: '"one"' } },
        ),
    );
    const failure = expect(
      new Sess({
        apiKey: API_KEY,
        fetch,
        operationTimeoutMs: 30,
        timeoutMs: 1000,
        maxRetries: 0,
      }).sessions.waitForResponse(SESSION_ID, { revision: 1, timeoutMs: 500 }),
    ).rejects.toMatchObject({ kind: 'timeout' });
    await vi.advanceTimersByTimeAsync(600);
    await failure;
    expect(cancelled).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
    expect(remaining()).toBe(0);
  });

  it('a shorter human deadline keeps the resumable wait error and aborts its request', async () => {
    const remaining = abortListeners();
    let signal: AbortSignal | undefined | null;
    const fetch = vi.fn((_url, options) => {
      signal = options?.signal;
      return new Promise<Response>(() => {});
    });
    const failure = expect(
      new Sess({ apiKey: API_KEY, fetch, operationTimeoutMs: 1000 }).sessions.waitForResponse(SESSION_ID, {
        revision: 1,
        timeoutMs: 20,
      }),
    ).rejects.toMatchObject({ kind: 'wait_ended', code: 'WAIT_TIMEOUT', sessionId: SESSION_ID, revision: 1 });
    await vi.advanceTimersByTimeAsync(21);
    await failure;
    expect(signal?.aborted).toBe(true);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
    expect(remaining()).toBe(0);
  });

  it('retains the per-attempt timeout and retries within one inherited operation budget', async () => {
    const signals: AbortSignal[] = [];
    const fetch = vi.fn((_url, options) => {
      signals.push(options!.signal!);
      return signals.length === 1 ? new Promise<Response>(() => {}) : Promise.resolve(answered());
    });
    const pending = new Sess({
      apiKey: API_KEY,
      fetch,
      timeoutMs: 15,
      operationTimeoutMs: 1000,
      maxRetries: 1,
    }).sessions.waitForResponse(SESSION_ID, { revision: 1, timeoutMs: 2000 });
    await vi.advanceTimersByTimeAsync(214);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(signals[0]?.aborted).toBe(true);
    await vi.advanceTimersByTimeAsync(2);
    expect((await pending).response).toEqual(RESPONSE);
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('does not restart the logical budget after retry backoff', async () => {
    const remaining = abortListeners();
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(apiError(503, 'TEMPORARY'))
      .mockImplementation(() => new Promise<Response>(() => {}));
    let failure: unknown;
    const pending = new Sess({
      apiKey: API_KEY,
      fetch,
      timeoutMs: 1000,
      operationTimeoutMs: 250,
      maxRetries: 1,
    }).sessions
      .waitForResponse(SESSION_ID, { revision: 1, timeoutMs: 2000 })
      .catch((error: unknown) => {
        failure = error;
      });
    await vi.advanceTimersByTimeAsync(199);
    expect(fetch).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(52);
    expect(failure).toMatchObject({ kind: 'timeout' });
    await pending;
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(vi.getTimerCount()).toBe(0);
    expect(remaining()).toBe(0);
  });

  it('honors Retry-After inside the operation budget before the next request', async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(
        new Response('{"error":{"code":"TEMPORARY"}}', {
          status: 503,
          headers: { 'content-type': 'application/json', 'retry-after': '1' },
        }),
      )
      .mockImplementation(async () => answered());
    const pending = new Sess({
      apiKey: API_KEY,
      fetch,
      timeoutMs: 2000,
      operationTimeoutMs: 1200,
      maxRetries: 1,
    }).sessions.waitForResponse(SESSION_ID, { revision: 1, timeoutMs: 2000 });
    await vi.advanceTimersByTimeAsync(999);
    expect(fetch).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(2);
    expect((await pending).response).toEqual(RESPONSE);
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each(['poll interval', 'retry backoff'] as const)(
    'disposes timers and listeners on abort during %s',
    async (stage) => {
      const remaining = abortListeners();
      const controller = new AbortController();
      const fetch = vi.fn(async () =>
        stage === 'poll interval' ? json(session(), 200, { etag: '"one"' }) : apiError(503, 'TEMPORARY'),
      );
      const failure = expect(
        new Sess({ apiKey: API_KEY, fetch, operationTimeoutMs: 5000 }).sessions.waitForResponse(SESSION_ID, {
          revision: 1,
          timeoutMs: 5000,
          signal: controller.signal,
        }),
      ).rejects.toMatchObject({ kind: 'aborted', sessionId: SESSION_ID, revision: 1 });
      await vi.advanceTimersByTimeAsync(50);
      expect(fetch).toHaveBeenCalledTimes(1);
      controller.abort();
      await failure;
      expect(vi.getTimerCount()).toBe(0);
      expect(remaining()).toBe(0);
    },
  );
});
