// R-01 regressions (ASTRA runtime-adapter-cycle review): an answer is released only after
// authenticated current-revision evidence obtained AFTER full receipt verification, including
// cached answered results. Real SDK client and verifier, Ed25519-signed synthetic receipts,
// deterministic fake HTTP API; no verifier stub.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Sess, SessError } from '@sess.si/sdk';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { AdapterError } from '../src/errors.js';
import { SessMcpAdapter } from '../src/operations.js';
import { parseRequestArgs } from '../src/validate.js';
import { ANSWER_1, FakeSess, ROUND_1, ROUND_2, SESSION_ID, env, tempDir } from './helpers.js';

let dir: ReturnType<typeof tempDir>;
beforeEach(() => {
  dir = tempDir();
});
afterEach(() => dir.cleanup());

const sessionPath = `/v1/sessions/${SESSION_ID}`;
function raw(handle: string): string {
  return readFileSync(join(dir.path, 'profiles', 'default', 'handles', `${handle}.json`), 'utf8');
}
async function failure(promise: Promise<unknown>): Promise<AdapterError> {
  try {
    await promise;
  } catch (error) {
    expect(error).toBeInstanceOf(AdapterError);
    return error as AdapterError;
  }
  throw new Error('expected an AdapterError');
}

/**
 * Adapter over the fake API with the real SDK. `onSessionGet(n)` runs before the n-th
 * authenticated Session read (1-based) is served; it may mutate the fake or throw.
 */
function harness(onSessionGet: (n: number) => Promise<void> | void = () => {}) {
  const fake = new FakeSess();
  let gets = 0;
  let hooks = true;
  const fetch = async (input: string | URL | Request, init: RequestInit = {}) => {
    const url = new URL(typeof input === 'string' || input instanceof URL ? input : input.url);
    if ((init.method ?? 'GET') === 'GET' && url.pathname === sessionPath) {
      gets += 1;
      if (hooks) await onSessionGet(gets);
    }
    return fake.fetch(input, init);
  };
  const adapter = new SessMcpAdapter({
    env: env(dir.path),
    diagnostics: () => {},
    createClient: (config) => {
      const sess = new Sess({
        apiKey: config.apiKey,
        baseUrl: config.origin,
        fetch: fetch as typeof globalThis.fetch,
        maxRetries: 0,
      });
      return { sessions: sess.sessions, receipts: sess.receipts };
    },
  });
  return {
    fake,
    adapter,
    gets: () => gets,
    resetGets() {
      gets = 0;
    },
    pauseHooks: async <T>(fn: () => Promise<T>): Promise<T> => {
      hooks = false;
      try {
        return await fn();
      } finally {
        hooks = true;
      }
    },
  };
}
const advanceToRevision2 = (fake: FakeSess) => {
  fake.session!.revision = 2;
  fake.session!.status = 'active';
};

async function requested(h: ReturnType<typeof harness>) {
  const { interaction } = await h.adapter.request(parseRequestArgs({ interaction: ROUND_1 }));
  const eventId = h.fake.answerSigned(ANSWER_1.data, ANSWER_1.action_id);
  h.resetGets();
  return { handle: interaction.handle, eventId };
}

describe('R-01: progress between the first read and the post-verification check', () => {
  // GET 1 = adapter read/wait, GET 2 = verifier's authenticated read, GET 3 = post-verify read.
  for (const [label, waitMs] of [
    ['read-once', 0],
    ['bounded wait', 1200],
  ] as const) {
    for (const at of [2, 3]) {
      it(`${label}: Session advances to revision 2 before GET ${at} → blocked, no answer released`, async () => {
        let h!: ReturnType<typeof harness>;
        h = harness((n) => {
          if (n === at) advanceToRevision2(h.fake);
        });
        const { handle } = await requested(h);
        const error = await failure(h.adapter.response({ handle, revision: 1, waitMs }));
        expect(error.code).toBe('RECOVERY_BLOCKED');
        expect(error.message).not.toMatch(/museum|activity/);
        const saved = JSON.parse(raw(handle));
        expect(saved.state).toBe('blocked');
        expect(saved.blockedReason).toBe('UNEXPECTED_PROGRESS');
        expect(saved.answer).toBeUndefined();
        expect(h.gets()).toBe(3);
      });
    }
  }

  it('the verified answer is released when the Session is still current (one extra read)', async () => {
    const h = harness();
    const { handle, eventId } = await requested(h);
    const result = await h.adapter.response({ handle, revision: 1, waitMs: 0 });
    expect(result.interaction.response).toMatchObject({ eventId, verified: true, data: ANSWER_1.data });
    expect(h.gets()).toBe(3);
  });

  it('a failed post-verification read is retryable unavailable and changes nothing', async () => {
    const h = harness((n) => {
      if (n === 3) throw new TypeError('fetch failed');
    });
    const { handle } = await requested(h);
    const before = raw(handle);
    const error = await failure(h.adapter.response({ handle, revision: 1, waitMs: 0 }));
    expect(error.code).toBe('SESS_UNAVAILABLE');
    expect(error.retryable).toBe(true);
    expect(error.message).not.toMatch(/museum|activity/);
    expect(raw(handle)).toBe(before);
  });

  it('a concurrent local complete during the post-verification read wins; the stale call conflicts', async () => {
    let h!: ReturnType<typeof harness>;
    let handle = '';
    let eventId = '';
    h = harness(async (n) => {
      if (n !== 3) return;
      await h.pauseHooks(async () => {
        await h.adapter.response({ handle, revision: 1, waitMs: 0 });
        await h.adapter.complete({ handle, expectedRevision: 1, responseEventId: eventId });
      });
    });
    ({ handle, eventId } = await requested(h));
    const error = await failure(h.adapter.response({ handle, revision: 1, waitMs: 0 }));
    expect(error.code).toBe('INVALID_STATE');
    const saved = JSON.parse(raw(handle));
    expect(saved.state).toBe('completed');
    expect(saved.answer.data).toEqual({});
  });
});

describe('R-01: cached answered results', () => {
  async function answered(h: ReturnType<typeof harness>) {
    const ids = await requested(h);
    await h.adapter.response({ handle: ids.handle, revision: 1, waitMs: 0 });
    h.resetGets();
    return ids;
  }

  it('a remotely advanced Session is detected by a fresh read; the cached answer is not released', async () => {
    const h = harness();
    const { handle } = await answered(h);
    advanceToRevision2(h.fake);
    const before = h.fake.calls.length;
    const error = await failure(h.adapter.response({ handle, revision: 1, waitMs: 0 }));
    expect(error.code).toBe('RECOVERY_BLOCKED');
    expect(error.message).not.toMatch(/museum|activity/);
    expect(h.fake.calls.length).toBeGreaterThan(before);
    expect(h.gets()).toBe(1);
    expect(JSON.parse(raw(handle)).state).toBe('blocked');
  });

  it('a still-current cached answer is re-released after exactly one fresh read', async () => {
    const h = harness();
    const { handle, eventId } = await answered(h);
    const result = await h.adapter.response({ handle, revision: 1, waitMs: 0 });
    expect(result.interaction.response).toMatchObject({ eventId, verified: true });
    expect(h.gets()).toBe(1);
  });

  it('completed remotely at the same revision with the retained answer is legitimate', async () => {
    const h = harness();
    const { handle, eventId } = await answered(h);
    h.fake.session!.status = 'completed';
    const result = await h.adapter.response({ handle, revision: 1, waitMs: 0 });
    expect(result.interaction.state).toBe('answered');
    expect(result.interaction.response).toMatchObject({ eventId, verified: true, data: ANSWER_1.data });
  });

  it('a failed fresh read is retryable unavailable and leaves the record unchanged', async () => {
    let armed = false;
    const h = harness((n) => {
      if (armed && n === 1) throw new TypeError('fetch failed');
    });
    const { handle } = await answered(h);
    armed = true;
    const before = raw(handle);
    const error = await failure(h.adapter.response({ handle, revision: 1, waitMs: 0 }));
    expect(error.code).toBe('SESS_UNAVAILABLE');
    expect(error.retryable).toBe(true);
    expect(raw(handle)).toBe(before);
  });

  it('a concurrent local publish during the fresh read wins; the stale cached read conflicts', async () => {
    let h!: ReturnType<typeof harness>;
    let ids = { handle: '', eventId: '' };
    h = harness(async (n) => {
      if (n !== 1 || !ids.handle) return;
      await h.pauseHooks(() =>
        h.adapter.publish({
          handle: ids.handle,
          expectedRevision: 1,
          responseEventId: ids.eventId,
          interaction: parseRequestArgs({ interaction: ROUND_2 }).interaction,
        }),
      );
    });
    const created = await requested(h);
    await h.pauseHooks(() => h.adapter.response({ handle: created.handle, revision: 1, waitMs: 0 }));
    ids = created;
    h.resetGets();
    const error = await failure(h.adapter.response({ handle: created.handle, revision: 1, waitMs: 0 }));
    expect(error.code).toBe('INVALID_STATE');
    const saved = JSON.parse(raw(created.handle));
    expect(saved.state).toBe('waiting');
    expect(saved.revision).toBe(2);
    expect(saved.blockedReason).toBeUndefined();
  });

  it('a concurrent local complete during the fresh read wins; no cached data is released', async () => {
    let h!: ReturnType<typeof harness>;
    let ids = { handle: '', eventId: '' };
    h = harness(async (n) => {
      if (n !== 1 || !ids.handle) return;
      await h.pauseHooks(() =>
        h.adapter.complete({ handle: ids.handle, expectedRevision: 1, responseEventId: ids.eventId }),
      );
    });
    const created = await requested(h);
    await h.pauseHooks(() => h.adapter.response({ handle: created.handle, revision: 1, waitMs: 0 }));
    ids = created;
    h.resetGets();
    const error = await failure(h.adapter.response({ handle: created.handle, revision: 1, waitMs: 0 }));
    expect(error.code).toBe('INVALID_STATE');
    expect(JSON.parse(raw(created.handle)).state).toBe('completed');
  });
});

describe('R-01: a wait that ends never releases an answer saved by another call', () => {
  it('WAIT_TIMEOUT after a concurrent answered save → conflict, no cached data', async () => {
    const fake = new FakeSess();
    let adapter!: SessMcpAdapter;
    let handle = '';
    adapter = new SessMcpAdapter({
      env: env(dir.path),
      diagnostics: () => {},
      createClient: (config) => {
        const sess = new Sess({
          apiKey: config.apiKey,
          baseUrl: config.origin,
          fetch: fake.fetch as typeof globalThis.fetch,
          maxRetries: 0,
        });
        return {
          sessions: {
            create: (...a: Parameters<Sess['sessions']['create']>) => sess.sessions.create(...a),
            retrieve: (...a: Parameters<Sess['sessions']['retrieve']>) => sess.sessions.retrieve(...a),
            publish: (...a: Parameters<Sess['sessions']['publish']>) => sess.sessions.publish(...a),
            complete: (...a: Parameters<Sess['sessions']['complete']>) => sess.sessions.complete(...a),
            // The bounded wait ends while another call answers and saves the same handle.
            waitForResponse: async () => {
              fake.answerSigned(ANSWER_1.data, ANSWER_1.action_id);
              await adapter.response({ handle, revision: 1, waitMs: 0 });
              throw new SessError('wait_ended', 'synthetic', { code: 'WAIT_TIMEOUT' });
            },
          } as unknown as Sess['sessions'],
          receipts: sess.receipts,
        };
      },
    });
    ({
      interaction: { handle },
    } = await adapter.request(parseRequestArgs({ interaction: ROUND_1 })));
    const error = await failure(adapter.response({ handle, revision: 1, waitMs: 1200 }));
    expect(error.code).toBe('INVALID_STATE');
    expect(JSON.parse(raw(handle)).state).toBe('answered');
  });
});

describe('R-01: other unexpected observations at the post-verification read', () => {
  const cases: [string, (fake: FakeSess) => void][] = [
    [
      'retained event missing',
      (fake) => {
        fake.session!.responses = [];
        fake.session!.status = 'active';
      },
    ],
    [
      'a different event at that revision',
      (fake) => {
        fake.session!.responses[0].event_id = 'evt_0000000000000000000000000Z';
      },
    ],
  ];
  for (const [label, mutate] of cases) {
    for (const path of ['fresh answer', 'cached answer'] as const) {
      it(`${path}: ${label} → blocked, no answer data, verify before read before persist`, async () => {
        let armed = false;
        let h!: ReturnType<typeof harness>;
        h = harness((n) => {
          // Fresh path: GET 3 is the post-verification read. Cached path: GET 1 is the fresh read.
          if (armed && n === (path === 'fresh answer' ? 3 : 1)) mutate(h.fake);
        });
        const { handle } = await requested(h);
        if (path === 'cached answer') {
          await h.adapter.response({ handle, revision: 1, waitMs: 0 });
          h.resetGets();
        }
        armed = true;
        const error = await failure(h.adapter.response({ handle, revision: 1, waitMs: 0 }));
        expect(error.code).toBe('RECOVERY_BLOCKED');
        expect(error.message).not.toMatch(/museum|activity/);
        const saved = JSON.parse(raw(handle));
        expect(saved.state).toBe('blocked');
        if (path === 'fresh answer') expect(saved.answer).toBeUndefined();
      });
    }
  }

  it('a failed post-verification read leaves the record exactly as before verification', async () => {
    let armed = false;
    const h = harness((n) => {
      if (armed && n === 3) throw new TypeError('fetch failed');
    });
    const { handle } = await requested(h);
    const beforeVerification = raw(handle);
    armed = true;
    const error = await failure(h.adapter.response({ handle, revision: 1, waitMs: 0 }));
    expect(error.code).toBe('SESS_UNAVAILABLE');
    // GET 1 (read), GET 2 (verifier) succeeded, so verification ran; nothing was persisted.
    expect(h.gets()).toBe(3);
    expect(raw(handle)).toBe(beforeVerification);
    expect(JSON.parse(raw(handle)).state).toBe('waiting');
  });
});
