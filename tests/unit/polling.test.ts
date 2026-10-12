import { describe, expect, it, vi } from 'vitest';
import { Sess } from '../../src/index.js';
import { API_KEY, RESPONSE, SESSION_ID, apiError, json, session } from '../fixtures/api.js';

describe('exact-revision read-only polling', () => {
  it('selects exact historical input with current paired ETag before supersession', async () => {
    const current = session({ revision: 3, responses: [RESPONSE] });
    const fetch = vi.fn(async () => json(current, 200, { etag: '"current-three"' }));
    const answer = await new Sess({ apiKey: API_KEY, fetch }).sessions.waitForResponse(SESSION_ID, {
      revision: 1,
    });
    expect(answer.response.event_id).toBe(RESPONSE.event_id);
    expect(answer.session.revision).toBe(3);
    expect(answer.meta.etag).toBe('"current-three"');
    expect(fetch).toHaveBeenCalledTimes(1);
  });
  it('retained answer is readable after completion', async () => {
    const fetch = vi.fn(async () =>
      json(session({ revision: 3, status: 'completed', responses: [RESPONSE] }), 200, { etag: '"done"' }),
    );
    const answer = await new Sess({ apiKey: API_KEY, fetch }).sessions.waitForResponse(SESSION_ID, {
      revision: 1,
    });
    expect(answer.response.revision).toBe(1);
    expect(answer.session.status).toBe('completed');
  });
  it.each([
    ['active', 'REVISION_SUPERSEDED'],
    ['completed', 'CLOSED_WITHOUT_RESPONSE'],
  ] as const)('unanswered historical revision in %s ends explicitly', async (status, code) => {
    const fetch = vi.fn(async () => json(session({ revision: 3, status }), 200, { etag: '"three"' }));
    await expect(
      new Sess({ apiKey: API_KEY, fetch }).sessions.waitForResponse(SESSION_ID, { revision: 1 }),
    ).rejects.toMatchObject({ kind: 'wait_ended', code, sessionId: SESSION_ID, revision: 1 });
    expect(fetch).toHaveBeenCalledTimes(1);
  });
  it.each([401, 403, 404])('does not poll through authorization/absence HTTP %i', async (status) => {
    const fetch = vi.fn(async () => apiError(status, 'NOT_FOUND'));
    await expect(
      new Sess({ apiKey: API_KEY, fetch }).sessions.waitForResponse(SESSION_ID, { revision: 1 }),
    ).rejects.toMatchObject({ kind: 'api', status });
    expect(fetch).toHaveBeenCalledTimes(1);
  });
  it('reads immediately and waits without overlapping, then cleans timers', async () => {
    vi.useFakeTimers();
    try {
      let busy = false;
      let overlap = false;
      let count = 0;
      const fetch = vi.fn(async () => {
        if (busy) overlap = true;
        busy = true;
        await new Promise((resolve) => setTimeout(resolve, 20));
        busy = false;
        count++;
        return json(count === 1 ? session() : session({ status: 'responded', responses: [RESPONSE] }), 200, {
          etag: '"snapshot"',
        });
      });
      const result = new Sess({ apiKey: API_KEY, fetch }).sessions.waitForResponse(SESSION_ID, {
        revision: 1,
        intervalMs: 1000,
      });
      await vi.advanceTimersByTimeAsync(1);
      expect(fetch).toHaveBeenCalledTimes(1);
      await vi.advanceTimersByTimeAsync(2000);
      expect((await result).response.event_id).toBe(RESPONSE.event_id);
      expect(overlap).toBe(false);
      expect(fetch).toHaveBeenCalledTimes(2);
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });
  it('human deadline cancels hanging request and retains resumable identity', async () => {
    const fetch = vi.fn(() => new Promise<Response>(() => {}));
    await expect(
      new Sess({ apiKey: API_KEY, fetch }).sessions.waitForResponse(SESSION_ID, {
        revision: 1,
        timeoutMs: 20,
      }),
    ).rejects.toMatchObject({ kind: 'wait_ended', code: 'WAIT_TIMEOUT', sessionId: SESSION_ID, revision: 1 });
    expect(fetch).toHaveBeenCalledTimes(1);
  });
  it('caller cancellation ends local wait without mutation', async () => {
    const controller = new AbortController();
    const fetch = vi.fn(async () => {
      controller.abort();
      return json(session(), 200, { etag: '"one"' });
    });
    await expect(
      new Sess({ apiKey: API_KEY, fetch }).sessions.waitForResponse(SESSION_ID, {
        revision: 1,
        signal: controller.signal,
      }),
    ).rejects.toMatchObject({ kind: 'aborted' });
    expect(fetch).toHaveBeenCalledTimes(1);
  });
  it.each([{ revision: 0 }, { revision: 1.5 }, { revision: 1, intervalMs: 999 }])(
    'rejects unsafe wait configuration',
    async (options) => {
      const fetch = vi.fn();
      await expect(
        new Sess({ apiKey: API_KEY, fetch }).sessions.waitForResponse(SESSION_ID, options),
      ).rejects.toMatchObject({ kind: 'configuration' });
      expect(fetch).not.toHaveBeenCalled();
    },
  );
  it('rejects display mode and malformed state transitions', async () => {
    const fetch = vi.fn(async () =>
      json(
        {
          id: SESSION_ID,
          revision: 1,
          interaction: { mode: 'display', title: 'Display', source: { kind: 'data', data: { amount: 1 } } },
        },
        200,
        { etag: '"one"' },
      ),
    );
    await expect(
      new Sess({ apiKey: API_KEY, fetch }).sessions.waitForResponse(SESSION_ID, { revision: 1 }),
    ).rejects.toMatchObject({ code: 'NOT_INTERACTIVE' });
    const bad = vi.fn(async () =>
      json(session({ status: 'responded', responses: [] }), 200, { etag: '"one"' }),
    );
    await expect(
      new Sess({ apiKey: API_KEY, fetch: bad }).sessions.retrieve(SESSION_ID),
    ).rejects.toMatchObject({ kind: 'protocol' });
  });
});
