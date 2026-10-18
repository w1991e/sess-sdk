import { describe, expect, it, vi } from 'vitest';
import { compileAsk } from '../../src/ask.js';
import { Sess } from '../../src/index.js';
import { LINK_EXPIRY_GRACE_MS } from '../../src/polling.js';
import { API_KEY, INTERACTION, RESPONSE, SESSION_ID, json, session } from '../fixtures/api.js';

// Decision 0009 Amendment 7 (S-09): an optional link lifetime on create, the link's expiry on the
// create response, and a wait that observes that expiry. One read made when the runtime clock is
// LINK_EXPIRY_GRACE_MS past the expiry is final: an answer accepted before the expiry is the
// result; with none the wait ends with LINK_EXPIRED. Nothing is ever completed by the SDK.

const CUTOFF = Date.parse('2026-10-18T03:00:30.000Z');
const EXPIRES = new Date(CUTOFF).toISOString();
/** An HTTP Date header for a runtime clock reading (whole seconds, as servers send it). */
const httpDate = (ms: number) => ({ date: new Date(ms).toUTCString() });
const LINK = 'https://app.example/s/private-test-capability';

const created = (extra: Record<string, unknown> = {}) =>
  json({ id: SESSION_ID, revision: 1, human_url: LINK, action_expires_at: EXPIRES, ...extra }, 201, {
    etag: '"revision-1"',
  });

describe('link lifetime: create', () => {
  it('sends expires_in as given and returns the stored expiry as action_expires_at', async () => {
    const fetch = vi.fn(async (_url: string | URL | Request, _init?: RequestInit) => created());
    const sess = new Sess({ apiKey: API_KEY, fetch });
    const result = await sess.sessions.create({ interaction: INTERACTION, expires_in: 30 });
    expect(JSON.parse(String(fetch.mock.calls[0]?.[1]?.body)).expires_in).toBe(30);
    expect(result.data.action_expires_at).toBe(EXPIRES);
    // Absent: the body carries no expires_in (the plan's lifetime).
    await sess.sessions.create({ interaction: INTERACTION });
    expect('expires_in' in JSON.parse(String(fetch.mock.calls[1]?.[1]?.body))).toBe(false);
  });

  it.each([29, 0, -30, 30.5, Number.NaN, '600', null])(
    'refuses expires_in %p locally, before sending anything',
    async (value) => {
      const fetch = vi.fn(async () => created());
      await expect(
        new Sess({ apiKey: API_KEY, fetch }).sessions.create({
          interaction: INTERACTION,
          expires_in: value as number,
        }),
      ).rejects.toMatchObject({ kind: 'configuration', outcome: 'not_sent' });
      expect(fetch).not.toHaveBeenCalled();
    },
  );

  it('a malformed action_expires_at makes the create outcome unknown (never a success); its absence (older runtime) is accepted', async () => {
    const bad = vi.fn(async () => created({ action_expires_at: 'tomorrow' }));
    await expect(
      new Sess({ apiKey: API_KEY, fetch: bad, maxRetries: 0 }).sessions.create({
        interaction: INTERACTION,
      }),
    ).rejects.toMatchObject({ kind: 'unknown_outcome' });
    const older = vi.fn(async () =>
      json({ id: SESSION_ID, revision: 1, human_url: LINK }, 201, { etag: '"revision-1"' }),
    );
    const result = await new Sess({ apiKey: API_KEY, fetch: older }).sessions.create({
      interaction: INTERACTION,
    });
    expect(result.data.action_expires_at).toBeUndefined();
  });
});

describe('link lifetime: the wait observes the expiry', () => {
  it('the grace is two seconds', () => {
    expect(LINK_EXPIRY_GRACE_MS).toBe(2000);
  });

  it('a read made at least the grace past the expiry with no answer ends the wait with LINK_EXPIRED, after that one read', async () => {
    const fetch = vi.fn(async () =>
      json(session({ action_expires_at: EXPIRES } as never), 200, {
        etag: '"one"',
        ...httpDate(CUTOFF + LINK_EXPIRY_GRACE_MS),
      }),
    );
    await expect(
      new Sess({ apiKey: API_KEY, fetch }).sessions.waitForResponse(SESSION_ID, { revision: 1 }),
    ).rejects.toMatchObject({
      kind: 'wait_ended',
      code: 'LINK_EXPIRED',
      sessionId: SESSION_ID,
      revision: 1,
    });
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('an answer accepted before the expiry is the result, even when it is read after the expiry', async () => {
    const fetch = vi.fn(async () =>
      json(
        session({
          status: 'responded',
          action_expires_at: EXPIRES,
          responses: [{ ...RESPONSE, accepted_at: new Date(CUTOFF - 1000).toISOString() }],
        } as never),
        200,
        { etag: '"answered"', ...httpDate(CUTOFF + 60_000) },
      ),
    );
    const result = await new Sess({ apiKey: API_KEY, fetch }).sessions.waitForResponse(SESSION_ID, {
      revision: 1,
    });
    expect(result.response.event_id).toBe(RESPONSE.event_id);
  });

  it('before the expiry it keeps waiting, then makes one final read just after expiry + grace; an answer that landed meanwhile is returned', async () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(CUTOFF - 1000);
      let reads = 0;
      const fetch = vi.fn(async () => {
        reads++;
        const now = Date.now();
        const responses =
          reads === 1 ? [] : [{ ...RESPONSE, accepted_at: new Date(CUTOFF - 500).toISOString() }];
        return json(
          session({
            status: reads === 1 ? 'active' : 'responded',
            action_expires_at: EXPIRES,
            responses,
          } as never),
          200,
          { etag: `"read-${reads}"`, ...httpDate(now) },
        );
      });
      const waiting = new Sess({ apiKey: API_KEY, fetch }).sessions.waitForResponse(SESSION_ID, {
        revision: 1,
        intervalMs: 60_000,
      });
      await vi.advanceTimersByTimeAsync(1);
      expect(fetch).toHaveBeenCalledTimes(1);
      // The next read is due at expiry + grace (+ 1 s for the Date header's whole seconds), not
      // after the 60-second interval.
      await vi.advanceTimersByTimeAsync(1000 + LINK_EXPIRY_GRACE_MS + 1000 + 200);
      expect(fetch).toHaveBeenCalledTimes(2);
      expect((await waiting).response.event_id).toBe(RESPONSE.event_id);
    } finally {
      vi.useRealTimers();
    }
  });

  it('with no answer by then, the final read ends the wait with LINK_EXPIRED; nothing is written', async () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(CUTOFF - 1000);
      const methods: string[] = [];
      const fetch = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
        methods.push(init?.method ?? 'GET');
        return json(session({ action_expires_at: EXPIRES } as never), 200, {
          etag: '"open"',
          ...httpDate(Date.now()),
        });
      });
      const waiting = new Sess({ apiKey: API_KEY, fetch }).sessions.waitForResponse(SESSION_ID, {
        revision: 1,
        intervalMs: 60_000,
      });
      const outcome = expect(waiting).rejects.toMatchObject({ kind: 'wait_ended', code: 'LINK_EXPIRED' });
      await vi.advanceTimersByTimeAsync(1000 + LINK_EXPIRY_GRACE_MS + 1000 + 200);
      await outcome;
      expect(fetch).toHaveBeenCalledTimes(2);
      expect(methods.every((m) => m === 'GET')).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it('without a Date header it uses this machine’s clock', async () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(CUTOFF + LINK_EXPIRY_GRACE_MS);
      const fetch = vi.fn(async () =>
        json(session({ action_expires_at: EXPIRES } as never), 200, { etag: '"x"' }),
      );
      await expect(
        new Sess({ apiKey: API_KEY, fetch }).sessions.waitForResponse(SESSION_ID, { revision: 1 }),
      ).rejects.toMatchObject({ code: 'LINK_EXPIRED' });
      expect(fetch).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it('a read before expiry + grace never ends the wait as expired (one second short)', async () => {
    vi.useFakeTimers();
    try {
      const fetch = vi.fn(async () =>
        json(session({ action_expires_at: EXPIRES } as never), 200, {
          etag: '"y"',
          ...httpDate(CUTOFF + LINK_EXPIRY_GRACE_MS - 1000),
        }),
      );
      const waiting = new Sess({ apiKey: API_KEY, fetch }).sessions.waitForResponse(SESSION_ID, {
        revision: 1,
        timeoutMs: 1500,
        intervalMs: 1000,
      });
      const outcome = expect(waiting).rejects.toMatchObject({ code: 'WAIT_TIMEOUT' });
      await vi.advanceTimersByTimeAsync(1600);
      await outcome;
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('link lifetime: sess.ask', () => {
  it('passes expires_in, exposes expiresAt, and ends answer() with LINK_EXPIRED without completing', async () => {
    const requests: string[] = [];
    const fetch = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      const method = init?.method ?? 'GET';
      requests.push(`${method} ${new URL(String(url)).pathname}`);
      if (method === 'POST') {
        expect(JSON.parse(String(init?.body)).expires_in).toBe(45);
        return created();
      }
      return json(session({ action_expires_at: EXPIRES } as never), 200, {
        etag: '"open"',
        ...httpDate(CUTOFF + LINK_EXPIRY_GRACE_MS),
      });
    });
    const handle = await new Sess({ apiKey: API_KEY, fetch }).ask({
      question: 'Synthetic question?',
      fields: [{ name: 'ok', label: 'OK', type: 'boolean' }],
      expires_in: 45,
    });
    expect(handle.expiresAt).toBe(EXPIRES);
    await expect(handle.answer()).rejects.toMatchObject({ kind: 'wait_ended', code: 'LINK_EXPIRED' });
    expect(requests).toEqual([`POST /v1/sessions`, `GET /v1/sessions/${SESSION_ID}`]);
  });

  it('compiles expires_in only as a whole number of seconds from 30; the interaction is unchanged', () => {
    const base = { question: 'Q?', fields: [{ name: 'ok', label: 'OK', type: 'boolean' }] };
    expect(compileAsk({ ...base, expires_in: 30 }).expiresIn).toBe(30);
    expect(compileAsk({ ...base, expires_in: 30 }).interaction).toEqual(compileAsk(base).interaction);
    expect('expiresIn' in compileAsk(base)).toBe(false);
    for (const bad of [29, 30.5, '30', null])
      expect(() => compileAsk({ ...base, expires_in: bad })).toThrow(/expires_in/);
  });
});
