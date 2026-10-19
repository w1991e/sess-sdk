import { describe, expect, it, vi } from 'vitest';
import { Sess } from '../../src/index.js';
import { LINK_EXPIRY_GRACE_MS } from '../../src/polling.js';
import type { LinkExtension } from '../../src/types.js';
import { API_KEY, EVENT_ID, RESPONSE, SESSION_ID, json, session } from '../fixtures/api.js';

// Decision 0009 Amendment 10 (rc.8): a Sess link of 20 hours or less can be extended by the
// person, at most ten times, up to a fixed horizon. Session reads carry link_state (live, lapsed,
// expired), action_expires_horizon, extensions_used and the extensions history; the Session log
// lists link_extensions beside its Events. A lapsed link takes no answer but the Session is still
// open: the wait keeps waiting until the horizon and ends with LINK_EXPIRED only when a read shows
// the link expired. A runtime before link timing omits every field and keeps the earlier rule.

const DEADLINE = Date.parse('2026-10-18T03:00:30.000Z');
const HORIZON = Date.parse('2026-10-18T03:05:30.000Z');
const iso = (ms: number) => new Date(ms).toISOString();
const httpDate = (ms: number) => ({ date: new Date(ms).toUTCString() });
const EXTENSION: LinkExtension = {
  number: 1,
  previous_action_expires_at: iso(DEADLINE),
  action_expires_at: iso(DEADLINE + 30_000),
  from_lapsed: true,
  extended_at: iso(DEADLINE + 5_000),
};
const timing = (state: 'live' | 'lapsed' | 'expired', extra: Record<string, unknown> = {}) => ({
  action_expires_at: iso(DEADLINE),
  action_expires_horizon: iso(HORIZON),
  extensions_used: 0,
  link_state: state,
  extensions: [],
  ...extra,
});
const read = (body: Record<string, unknown>, at: number, etag = '"r"') =>
  json(session(body as never), 200, { etag, ...httpDate(at) });

describe('link timing: Session reads and the Session log', () => {
  it('a Session read carries the link timing fields as sent; a read without them (an older runtime) is accepted', async () => {
    const body = timing('lapsed', { extensions_used: 1, extensions: [EXTENSION] });
    const fetch = vi.fn(async () => read(body, DEADLINE));
    const result = await new Sess({ apiKey: API_KEY, fetch }).sessions.retrieve(SESSION_ID);
    expect(result.data).toMatchObject(body);
    const older = vi.fn(async () => json(session(), 200, { etag: '"o"' }));
    const plain = await new Sess({ apiKey: API_KEY, fetch: older }).sessions.retrieve(SESSION_ID);
    expect('link_state' in plain.data).toBe(false);
  });

  it.each([
    ['an unknown link_state', { link_state: 'paused' }],
    ['a malformed horizon', { action_expires_horizon: 'later' }],
    ['more than ten extensions used', { extensions_used: 11 }],
    ['extensions out of order', { extensions: [{ ...EXTENSION, number: 2 }] }],
    ['an extension without from_lapsed', { extensions: [{ ...EXTENSION, from_lapsed: 'yes' }] }],
  ])('a Session read with %s is a protocol error', async (_name, extra) => {
    const fetch = vi.fn(async () => read(timing('live', extra), DEADLINE));
    await expect(
      new Sess({ apiKey: API_KEY, fetch, maxRetries: 0 }).sessions.retrieve(SESSION_ID),
    ).rejects.toMatchObject({ kind: 'protocol', code: 'INVALID_RESPONSE' });
  });

  it('the Session log accepts link_extensions beside its Events, whose shape is unchanged; absent, the log reads as before', async () => {
    const event = {
      event_id: EVENT_ID,
      sequence: 1,
      type: 'response.accepted',
      revision: 1,
      actor: { assurance: 'link_holder' },
      action_id: 'submit',
      data: RESPONSE.data,
      created_at: RESPONSE.accepted_at,
      receipt: null,
    };
    const fetch = vi.fn(async () => json({ id: SESSION_ID, events: [event], link_extensions: [EXTENSION] }));
    const log = (await new Sess({ apiKey: API_KEY, fetch }).sessions.listEvents(SESSION_ID)).data;
    expect(Object.keys(log).sort()).toEqual(['events', 'id', 'link_extensions']);
    expect(log.events).toEqual([event]);
    expect(log.link_extensions).toEqual([EXTENSION]);
    const without = vi.fn(async () => json({ id: SESSION_ID, events: [event] }));
    const before = (await new Sess({ apiKey: API_KEY, fetch: without }).sessions.listEvents(SESSION_ID)).data;
    expect(Object.keys(before).sort()).toEqual(['events', 'id']);
    const bad = vi.fn(async () =>
      json({ id: SESSION_ID, events: [event], link_extensions: [{ ...EXTENSION, number: 3 }] }),
    );
    await expect(
      new Sess({ apiKey: API_KEY, fetch: bad, maxRetries: 0 }).sessions.listEvents(SESSION_ID),
    ).rejects.toMatchObject({ kind: 'protocol' });
  });
});

describe('link timing: the wait', () => {
  it('a lapsed link is still open: reads well past the deadline keep waiting, and the answer given after an extension is the result', async () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(DEADLINE + 60_000);
      let reads = 0;
      const fetch = vi.fn(async () => {
        reads++;
        const now = Date.now();
        if (reads < 3) return read(timing('lapsed'), now, `"lapsed-${reads}"`);
        return read(
          {
            ...timing('live', {
              action_expires_at: iso(now + 60_000),
              extensions_used: 1,
              extensions: [EXTENSION],
            }),
            status: 'responded',
            responses: [{ ...RESPONSE, accepted_at: iso(now - 100) }],
          },
          now,
          '"answered"',
        );
      });
      const waiting = new Sess({ apiKey: API_KEY, fetch }).sessions.waitForResponse(SESSION_ID, {
        revision: 1,
        intervalMs: 1000,
      });
      await vi.advanceTimersByTimeAsync(5_000);
      const result = await waiting;
      expect(result.response.event_id).toBe(RESPONSE.event_id);
      expect(fetch).toHaveBeenCalledTimes(3);
    } finally {
      vi.useRealTimers();
    }
  });

  it('a link that reaches its horizon unextended ends the wait with LINK_EXPIRED once a read shows it expired; nothing is written', async () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(HORIZON - 1_000);
      const methods: string[] = [];
      const fetch = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
        methods.push(init?.method ?? 'GET');
        const now = Date.now();
        return read(timing(now < HORIZON ? 'lapsed' : 'expired'), now);
      });
      const waiting = new Sess({ apiKey: API_KEY, fetch }).sessions.waitForResponse(SESSION_ID, {
        revision: 1,
        intervalMs: 60_000,
      });
      const outcome = expect(waiting).rejects.toMatchObject({ kind: 'wait_ended', code: 'LINK_EXPIRED' });
      // The next read is due just after horizon + grace, not after the 60-second interval.
      await vi.advanceTimersByTimeAsync(1_000 + LINK_EXPIRY_GRACE_MS + 1_000 + 200);
      await outcome;
      expect(fetch).toHaveBeenCalledTimes(2);
      expect(methods.every((m) => m === 'GET')).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it('with no extension left, the deadline is the end: an expired read past it ends the wait at once', async () => {
    const fetch = vi.fn(async () =>
      read(timing('expired', { extensions_used: 10 }), DEADLINE + LINK_EXPIRY_GRACE_MS),
    );
    await expect(
      new Sess({ apiKey: API_KEY, fetch }).sessions.waitForResponse(SESSION_ID, { revision: 1 }),
    ).rejects.toMatchObject({ kind: 'wait_ended', code: 'LINK_EXPIRED' });
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('a link expired before its end (revoked) is final after one more read past the grace', async () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(DEADLINE - 10_000);
      const fetch = vi.fn(async () => read(timing('expired'), Date.now()));
      const waiting = new Sess({ apiKey: API_KEY, fetch }).sessions.waitForResponse(SESSION_ID, {
        revision: 1,
        intervalMs: 60_000,
      });
      const outcome = expect(waiting).rejects.toMatchObject({ code: 'LINK_EXPIRED' });
      await vi.advanceTimersByTimeAsync(LINK_EXPIRY_GRACE_MS + 1_000 + 200);
      await outcome;
      expect(fetch).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });

  // ASTRA A10-SDK-GRACE-01: a short polling interval reads again inside the grace, and that read
  // must not end the wait. An answer accepted before the end whose write becomes visible inside
  // the grace is returned.
  const shortInterval = async (opts: {
    start: number;
    extra: Record<string, unknown>;
    answerVisibleAt?: number;
    dateHeader?: boolean;
    advanceMs: number;
  }) => {
    vi.useFakeTimers();
    vi.spyOn(Math, 'random').mockReturnValue(0);
    try {
      vi.setSystemTime(opts.start);
      const seen: number[] = [];
      const fetch = vi.fn(async () => {
        const now = Date.now();
        seen.push(now - opts.start);
        const answered = opts.answerVisibleAt !== undefined && now >= opts.answerVisibleAt;
        const body = {
          ...timing('expired', opts.extra),
          ...(answered
            ? { status: 'responded', responses: [{ ...RESPONSE, accepted_at: iso(opts.start - 500) }] }
            : {}),
        };
        return opts.dateHeader === false
          ? json(session(body as never), 200, { etag: '"e"' })
          : read(body, now);
      });
      const settled = new Sess({ apiKey: API_KEY, fetch }).sessions
        .waitForResponse(SESSION_ID, { revision: 1, intervalMs: 1_000 })
        .then(
          (result) => ({ result, error: undefined }),
          (error: unknown) => ({ result: undefined, error }),
        );
      await vi.advanceTimersByTimeAsync(opts.advanceMs);
      return { ...(await settled), seen };
    } finally {
      vi.useRealTimers();
      vi.restoreAllMocks();
    }
  };

  it('A10-SDK-GRACE-01: natural expiry with a one-second interval — a second expired read inside the grace keeps waiting; an answer visible 1.5 s after the end is returned, and with none the wait ends only at end + grace', async () => {
    const extra = { extensions_used: 10 };
    const answered = await shortInterval({
      start: DEADLINE,
      extra,
      answerVisibleAt: DEADLINE + 1_500,
      advanceMs: 5_000,
    });
    expect(answered.error).toBeUndefined();
    expect(answered.result?.response.event_id).toBe(RESPONSE.event_id);
    expect(answered.seen).toEqual([0, 1_000, 2_000]);
    const none = await shortInterval({ start: DEADLINE, extra, advanceMs: 5_000 });
    expect(none.error).toMatchObject({ kind: 'wait_ended', code: 'LINK_EXPIRED' });
    expect(none.seen).toEqual([0, 1_000, 2_000]);
  });

  it('A10-SDK-GRACE-01: a revoked link (expired before its end) with a one-second interval is final only once a read the grace plus the Date resolution after the first expired read still shows it; an answer landing inside that time is returned', async () => {
    const start = DEADLINE - 10_000;
    const answered = await shortInterval({
      start,
      extra: {},
      answerVisibleAt: start + 1_500,
      advanceMs: 5_000,
    });
    expect(answered.result?.response.event_id).toBe(RESPONSE.event_id);
    expect(answered.seen).toEqual([0, 1_000, 2_000]);
    const late = await shortInterval({ start, extra: {}, answerVisibleAt: start + 2_500, advanceMs: 5_000 });
    expect(late.result?.response.event_id).toBe(RESPONSE.event_id);
    expect(late.seen).toEqual([0, 1_000, 2_000, 3_000]);
    const none = await shortInterval({ start, extra: {}, advanceMs: 5_000 });
    expect(none.error).toMatchObject({ kind: 'wait_ended', code: 'LINK_EXPIRED' });
    // Whole-second Date headers: three seconds between the headers, never two.
    expect(none.seen).toEqual([0, 1_000, 2_000, 3_000]);
    // Without a Date header this machine's clock is exact: the grace alone.
    const local = await shortInterval({ start, extra: {}, dateHeader: false, advanceMs: 5_000 });
    expect(local.error).toMatchObject({ kind: 'wait_ended', code: 'LINK_EXPIRED' });
    expect(local.seen).toEqual([0, 1_000, 2_000]);
  });

  it('a live read never ends the wait as expired, even when the clocks place it past the deadline', async () => {
    vi.useFakeTimers();
    try {
      const fetch = vi.fn(async () => read(timing('live'), DEADLINE + 3_600_000));
      const waiting = new Sess({ apiKey: API_KEY, fetch }).sessions.waitForResponse(SESSION_ID, {
        revision: 1,
        timeoutMs: 2_500,
        intervalMs: 1_000,
      });
      const outcome = expect(waiting).rejects.toMatchObject({ code: 'WAIT_TIMEOUT' });
      await vi.advanceTimersByTimeAsync(2_600);
      await outcome;
    } finally {
      vi.useRealTimers();
    }
  });

  it('sess.ask: answer() keeps waiting while the link is lapsed and ends with LINK_EXPIRED only once it is expired, without completing', async () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(HORIZON - 1_500);
      const requests: string[] = [];
      const fetch = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
        const method = init?.method ?? 'GET';
        requests.push(`${method} ${new URL(String(url)).pathname}`);
        if (method === 'POST')
          return json(
            {
              id: SESSION_ID,
              revision: 1,
              human_url: 'https://app.example/s/private-test-capability',
              action_expires_at: iso(DEADLINE),
            },
            201,
            { etag: '"revision-1"' },
          );
        const now = Date.now();
        return read(timing(now < HORIZON ? 'lapsed' : 'expired'), now);
      });
      const handle = await new Sess({ apiKey: API_KEY, fetch }).ask({
        question: 'Synthetic question?',
        fields: [{ name: 'ok', label: 'OK', type: 'boolean' }],
        expires_in: 30,
      });
      const outcome = expect(handle.answer({ intervalMs: 1_000 })).rejects.toMatchObject({
        kind: 'wait_ended',
        code: 'LINK_EXPIRED',
      });
      await vi.advanceTimersByTimeAsync(10_000);
      await outcome;
      const reads = requests.filter((r) => r.startsWith('GET'));
      expect(reads.length).toBeGreaterThanOrEqual(2);
      expect(requests.filter((r) => !r.startsWith('GET'))).toEqual(['POST /v1/sessions']);
    } finally {
      vi.useRealTimers();
    }
  });
});
