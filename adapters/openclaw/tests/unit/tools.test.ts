import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  API_KEY,
  API_KEY_ENV,
  FakeSess,
  HUMAN_URL,
  call,
  conversation,
  fixtures,
  registerPlugin,
} from './harness.js';

let sess: FakeSess;
beforeEach(() => {
  sess = new FakeSess();
  vi.stubGlobal('fetch', sess.fetch);
  vi.stubEnv(API_KEY_ENV, API_KEY);
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

const round1 = () => fixtures('round-1.json');
const answer1 = () => fixtures('answer-1.json');

describe('one round through the registered entry (fake host, real SDK)', () => {
  it('request -> link before wait -> verified answer -> publish -> complete', async () => {
    const host = await registerPlugin();
    const conv = conversation();
    expect(host.openCount).toBe(0); // registration opens no state
    const requested = await call(host, 'sess_request', conv, { interaction: round1() });
    expect(requested.details).toEqual({
      interaction: {
        handle: expect.stringMatching(/^ih_/),
        revision: 1,
        state: 'waiting',
        humanUrl: HUMAN_URL,
      },
    });
    const { handle } = requested.details.interaction;
    expect(sess.requests.filter((r) => r.method === 'POST')).toHaveLength(1);
    expect(sess.requests[0]!.headers.authorization).toBe(`Bearer ${API_KEY}`);

    const answer = answer1();
    const eventId = sess.answer(1, answer.action_id, answer.data);
    const answered = await call(host, 'sess_response', conv, { handle, revision: 1 });
    expect(answered.details.interaction).toEqual({
      handle,
      revision: 1,
      state: 'answered',
      response: {
        eventId,
        actionId: 'submit',
        data: { activity: 'museum', hours: 3 },
        verified: true,
        actorAssurance: 'link_holder',
      },
    });
    expect(answered.details.interaction.humanUrl).toBeUndefined();

    const published = await call(host, 'sess_publish', conv, {
      handle,
      expected_revision: 1,
      response_event_id: eventId,
      interaction: fixtures('round-2.json'),
    });
    // Contract "Human URL release": only request returns the link.
    expect(published.details.interaction).toEqual({ handle, revision: 2, state: 'waiting' });
    const patch = sess.requests.find((r) => r.method === 'PATCH')!;
    expect(patch.headers['if-match']).toBe('"r1-responded"');
    expect(patch.headers['idempotency-key']).toMatch(/^sessoc_/);

    const event2 = sess.answer(2, 'confirm', { confirmed: true });
    await call(host, 'sess_response', conv, { handle, revision: 2 });
    const done = await call(host, 'sess_complete', conv, {
      handle,
      expected_revision: 2,
      response_event_id: event2,
    });
    expect(done.details.interaction).toEqual({ handle, revision: 2, state: 'completed' });
    expect(sess.status).toBe('completed');
    // Repeating complete returns the confirmed state without another mutation.
    const before = sess.requests.length;
    await call(host, 'sess_complete', conv, { handle, expected_revision: 2, response_event_id: event2 });
    expect(sess.requests.slice(before).filter((r) => r.method !== 'GET')).toHaveLength(0);
  });

  it('a repeated delivery of the same host tool call creates at most once (create intent persisted first)', async () => {
    const host = await registerPlugin();
    const conv = conversation();
    const a = await call(host, 'sess_request', conv, { interaction: round1() }, { toolCallId: 'same-call' });
    const b = await call(host, 'sess_request', conv, { interaction: round1() }, { toolCallId: 'same-call' });
    expect(b.details.interaction.handle).toBe(a.details.interaction.handle);
    expect(sess.requests.filter((r) => r.method === 'POST' && r.path === '/v1/sessions')).toHaveLength(1);
  });
});

describe('OC-16 timeout is normal pending work', () => {
  it('returns needs_resume, creates nothing, cancels nothing, and resumes the same handle', async () => {
    const host = await registerPlugin();
    const conv = conversation();
    const { handle } = (await call(host, 'sess_request', conv, { interaction: round1() })).details
      .interaction;
    const pending = await call(host, 'sess_response', conv, { handle, revision: 1, wait_ms: 1000 });
    expect(pending.details.interaction).toEqual({ handle, revision: 1, state: 'needs_resume' });
    expect(sess.requests.filter((r) => r.method !== 'GET')).toHaveLength(1); // only the original create
    const eventId = sess.answer(1, 'submit', { activity: 'walk', hours: 1 });
    const resumed = await call(host, 'sess_response', conv, { handle, revision: 1, wait_ms: 0 });
    expect(resumed.details.interaction.response.eventId).toBe(eventId);
  });

  it('local cancellation ends the wait without any remote cancel request', async () => {
    const host = await registerPlugin({
      baseUrl: 'https://api.sess.example',
      apiKeyEnv: API_KEY_ENV,
      waitBudgetMs: 30000,
    });
    const conv = conversation();
    const { handle } = (await call(host, 'sess_request', conv, { interaction: round1() })).details
      .interaction;
    const controller = new AbortController();
    setTimeout(() => controller.abort(), 200);
    await expect(
      call(host, 'sess_response', conv, { handle, revision: 1 }, { signal: controller.signal }),
    ).rejects.toThrow(/CANCELLED/);
    expect(sess.requests.filter((r) => r.method !== 'GET')).toHaveLength(1);
  });
});

describe('receipt failures never become verified answers', () => {
  for (const [label, opts] of [
    ['tampered data', { tamper: true }],
    ['missing receipt', { noReceipt: true }],
  ] as const) {
    it(label, async () => {
      const host = await registerPlugin();
      const conv = conversation();
      const { handle } = (await call(host, 'sess_request', conv, { interaction: round1() })).details
        .interaction;
      sess.answer(1, 'submit', { activity: 'cafe', hours: 2 }, opts);
      await expect(call(host, 'sess_response', conv, { handle, revision: 1, wait_ms: 0 })).rejects.toThrow(
        /VERIFICATION_FAILED/,
      );
      // The interaction is blocked; it never reports answered, and publish/complete are refused.
      await expect(call(host, 'sess_response', conv, { handle, revision: 1, wait_ms: 0 })).rejects.toThrow(
        /RECOVERY_BLOCKED/,
      );
      await expect(
        call(host, 'sess_complete', conv, {
          handle,
          expected_revision: 1,
          response_event_id: sess.responses[0]!.event_id,
        }),
      ).rejects.toThrow(/RECOVERY_BLOCKED/);
      expect(sess.status).not.toBe('completed');
    });
  }
});

describe("OC-09/OC-10 model input cannot select credentials, origin or someone else's interaction", () => {
  it('other conversations, agents and incarnations see NOT_FOUND for the same handle', async () => {
    const host = await registerPlugin();
    const conv = conversation();
    const { handle } = (await call(host, 'sess_request', conv, { interaction: round1() })).details
      .interaction;
    for (const other of [
      conversation({ sessionKey: 'agent:main:dashboard:two' }),
      conversation({ agentId: 'other' }),
      conversation({ sessionId: 'incarnation-2' }),
    ])
      await expect(call(host, 'sess_response', other, { handle, revision: 1, wait_ms: 0 })).rejects.toThrow(
        /NOT_FOUND/,
      );
  });

  it('rejects origin, credential or session arguments before any network', async () => {
    const host = await registerPlugin();
    const conv = conversation();
    for (const extra of [
      { baseUrl: 'https://evil.example' },
      { apiKey: 'x' },
      { sessionId: 'ses_x' },
      { workspace_id: 'w' },
    ])
      await expect(call(host, 'sess_request', conv, { interaction: round1(), ...extra })).rejects.toThrow(
        /INVALID_ARGUMENTS/,
      );
    expect(sess.requests).toHaveLength(0);
  });

  it('a changed credential blocks replay of an existing interaction', async () => {
    const host = await registerPlugin();
    const conv = conversation();
    const { handle } = (await call(host, 'sess_request', conv, { interaction: round1() })).details
      .interaction;
    vi.stubEnv(API_KEY_ENV, 'test-owner-credential-2');
    await expect(call(host, 'sess_response', conv, { handle, revision: 1, wait_ms: 0 })).rejects.toThrow(
      /RECOVERY_BLOCKED/,
    );
  });
});

describe('OC-11/OC-12 live authority is checked before every dispatch', () => {
  it('a revoked invocation sends nothing', async () => {
    const host = await registerPlugin();
    const conv = conversation({ revoked: true });
    await expect(call(host, 'sess_request', conv, { interaction: round1() })).rejects.toThrow(
      /AUTHORITY_REVOKED/,
    );
    expect(sess.requests).toHaveLength(0);
  });

  it('revocation after the create intent is saved refuses the POST and reports not created', async () => {
    const host = await registerPlugin();
    const conv = conversation();
    const view = host.store.withCurrent.bind(host.store);
    host.store.withCurrent = (authority) => {
      const bound = view(authority);
      const lookup = bound.lookup;
      bound.lookup = async (key) => {
        const value = await lookup(key);
        if (key.startsWith('i:')) conv.revoked = true; // revoke after the saved intent is read back
        return value;
      };
      return bound;
    };
    await expect(call(host, 'sess_request', conv, { interaction: round1() })).rejects.toThrow(
      /CREATE_REJECTED: The host revoked this invocation before the request was sent/,
    );
    expect(sess.requests).toHaveLength(0);
  });
});

describe('uncertain outcomes', () => {
  it('a lost create response is create_unknown and is never retried', async () => {
    const host = await registerPlugin();
    const conv = conversation();
    sess.intercept = (method, path) => {
      if (method === 'POST' && path === '/v1/sessions') throw new TypeError('connection reset');
      return undefined;
    };
    await expect(
      call(host, 'sess_request', conv, { interaction: round1() }, { toolCallId: 'lost' }),
    ).rejects.toThrow(/CREATE_OUTCOME_UNKNOWN/);
    await expect(
      call(host, 'sess_request', conv, { interaction: round1() }, { toolCallId: 'lost' }),
    ).rejects.toThrow(/CREATE_OUTCOME_UNKNOWN/);
    expect(sess.requests.filter((r) => r.method === 'POST')).toHaveLength(1);
  });

  it('a lost complete is replayed with the identical saved identity', async () => {
    const host = await registerPlugin();
    const conv = conversation();
    const { handle } = (await call(host, 'sess_request', conv, { interaction: round1() })).details
      .interaction;
    const eventId = sess.answer(1, 'submit', { activity: 'museum', hours: 3 });
    await call(host, 'sess_response', conv, { handle, revision: 1, wait_ms: 0 });
    let drop = true;
    const real = sess.fetch;
    sess.fetch = async (input, init) => {
      const response = await real(input, init);
      if (drop && init?.method === 'POST' && String(input).endsWith('/complete'))
        throw new TypeError('response lost after commit');
      return response;
    };
    vi.stubGlobal('fetch', sess.fetch);
    await expect(
      call(host, 'sess_complete', conv, { handle, expected_revision: 1, response_event_id: eventId }),
    ).rejects.toThrow(/MUTATION_OUTCOME_UNKNOWN/);
    drop = false;
    const done = await call(host, 'sess_complete', conv, {
      handle,
      expected_revision: 1,
      response_event_id: eventId,
    });
    expect(done.details.interaction.state).toBe('completed');
    const completes = sess.requests.filter((r) => r.path.endsWith('/complete'));
    expect(completes.length).toBeGreaterThanOrEqual(2);
    expect(
      new Set(completes.map((r) => `${r.headers['if-match']}|${r.headers['idempotency-key']}`)).size,
    ).toBe(1);
  });
});

describe('OC-14 the human link never reaches logs or errors', () => {
  it('captures all console/stdout/stderr output during a full round and failures', async () => {
    const captured: string[] = [];
    const capture = (...args: unknown[]) => void captured.push(args.map(String).join(' '));
    for (const method of ['log', 'info', 'warn', 'error', 'debug'] as const)
      vi.spyOn(console, method).mockImplementation(capture);
    const out = vi
      .spyOn(process.stdout, 'write')
      .mockImplementation((chunk) => (captured.push(String(chunk)), true));
    const err = vi
      .spyOn(process.stderr, 'write')
      .mockImplementation((chunk) => (captured.push(String(chunk)), true));
    const host = await registerPlugin();
    const conv = conversation();
    const errors: string[] = [];
    const { handle } = (await call(host, 'sess_request', conv, { interaction: round1() })).details
      .interaction;
    sess.answer(1, 'submit', { activity: 'museum', hours: 3 }, { tamper: true });
    await call(host, 'sess_response', conv, { handle, revision: 1, wait_ms: 0 }).catch((e: Error) =>
      errors.push(e.message, JSON.stringify(e)),
    );
    await call(host, 'sess_response', conversation({ sessionId: 'x' }), { handle, revision: 1 }).catch(
      (e: Error) => errors.push(e.message),
    );
    out.mockRestore();
    err.mockRestore();
    const token = HUMAN_URL.split('/s/')[1]!;
    for (const text of [...captured, ...errors]) {
      expect(text).not.toContain(token);
      expect(text).not.toContain(API_KEY);
    }
    expect(errors.length).toBeGreaterThan(0);
  });
});

describe('receipt-key outages are retryable, not verification failures', () => {
  it('key endpoint 503 -> UNAVAILABLE with state unchanged; the next call verifies and answers', async () => {
    const host = await registerPlugin();
    const conv = conversation();
    const { handle } = (await call(host, 'sess_request', conv, { interaction: round1() })).details
      .interaction;
    const eventId = sess.answer(1, 'submit', { activity: 'museum', hours: 3 });
    let outage = true;
    sess.intercept = (method, path) =>
      outage && path === '/.well-known/sess-receipt-keys.json'
        ? new Response('{"error":{"code":"UNAVAILABLE","message":"down"}}', {
            status: 503,
            headers: { 'content-type': 'application/json' },
          })
        : undefined;
    await expect(call(host, 'sess_response', conv, { handle, revision: 1, wait_ms: 0 })).rejects.toThrow(
      /^UNAVAILABLE: /,
    );
    const keyFetches = sess.requests.filter((r) => r.path === '/.well-known/sess-receipt-keys.json').length;
    expect(keyFetches).toBeGreaterThanOrEqual(1);
    outage = false;
    const answered = await call(host, 'sess_response', conv, { handle, revision: 1, wait_ms: 0 });
    expect(answered.details.interaction).toMatchObject({
      state: 'answered',
      response: { eventId, verified: true },
    });
  });
});

describe('repeated delivery of the same host call', () => {
  it('re-checks authority before releasing the stored link', async () => {
    const host = await registerPlugin();
    const conv = conversation();
    const first = await call(host, 'sess_request', conv, { interaction: round1() }, { toolCallId: 'dup' });
    expect(first.details.interaction.humanUrl).toBe(HUMAN_URL);
    const view = host.store.withCurrent.bind(host.store);
    host.store.withCurrent = (authority) => {
      const bound = view(authority);
      const lookup = bound.lookup;
      bound.lookup = async (key) => {
        const value = await lookup(key);
        if (key.startsWith('i:')) conv.revoked = true; // revoked after the record read
        return value;
      };
      return bound;
    };
    const captured: string[] = [];
    await call(host, 'sess_request', conv, { interaction: round1() }, { toolCallId: 'dup' }).then(
      (r: { details: unknown }) => captured.push(JSON.stringify(r.details)),
      (e: Error) => captured.push(e.message),
    );
    expect(captured[0]).toMatch(/AUTHORITY_REVOKED/);
    expect(captured.join('')).not.toContain(HUMAN_URL);
  });

  it('reports the actual stored state and no link once completed', async () => {
    const host = await registerPlugin();
    const conv = conversation();
    const { handle } = (
      await call(host, 'sess_request', conv, { interaction: round1() }, { toolCallId: 'again' })
    ).details.interaction;
    const eventId = sess.answer(1, 'submit', { activity: 'museum', hours: 3 });
    await call(host, 'sess_response', conv, { handle, revision: 1, wait_ms: 0 });
    const answeredReplay = await call(
      host,
      'sess_request',
      conv,
      { interaction: round1() },
      { toolCallId: 'again' },
    );
    expect(answeredReplay.details.interaction).toEqual({ handle, revision: 1, state: 'needs_resume' });
    await call(host, 'sess_complete', conv, { handle, expected_revision: 1, response_event_id: eventId });
    const replay = await call(host, 'sess_request', conv, { interaction: round1() }, { toolCallId: 'again' });
    expect(replay.details.interaction).toEqual({ handle, revision: 1, state: 'completed' });
    expect(sess.requests.filter((r) => r.method === 'POST' && r.path === '/v1/sessions')).toHaveLength(1);
  });
});
