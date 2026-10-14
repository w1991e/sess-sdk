// Regressions for the independent review findings R-01 (an obsolete answer released as current) and
// R-02 (terminal results escaping the final authority guard). Real SDK receipt verifier, synthetic
// Ed25519-signed receipts, deterministic fake HTTP; only the host boundary is a test double.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  API_KEY,
  API_KEY_ENV,
  FakeSess,
  call,
  conversation,
  fixtures,
  recordRow,
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

const answer1 = () => fixtures('answer-1.json');
type Host = Awaited<ReturnType<typeof registerPlugin>>;

async function started() {
  const host = await registerPlugin();
  const conv = conversation();
  const { handle } = (await call(host, 'sess_request', conv, { interaction: fixtures('round-1.json') }))
    .details.interaction;
  return { host, conv, handle: handle as string };
}

/** Runs `action` on the nth authenticated GET of the Session resource (1-based, counted from now). */
function onSessionRead(n: number, action: () => Response | void) {
  let reads = 0;
  sess.intercept = (method, path) => {
    if (method !== 'GET' || path !== `/v1/sessions/${sess.sessionId}`) return undefined;
    reads++;
    return reads === n ? (action() ?? undefined) : undefined;
  };
  return () => reads;
}

function advanceToRevision2() {
  sess.revision = 2;
  sess.status = 'active';
  sess.surfaces.set(2, fixtures('round-2.json'));
}

const row = (host: Host, handle: string) => recordRow(host, handle);

async function expectNoRelease(promise: Promise<unknown>, code: RegExp) {
  const outcome = await promise.then(
    (r) => ({ released: JSON.stringify(r) }),
    (e: Error) => ({ error: e.message, json: JSON.stringify(e) }),
  );
  expect(outcome).not.toHaveProperty('released');
  expect((outcome as { error: string }).error).toMatch(code);
  expect(JSON.stringify(outcome)).not.toContain('museum');
}

describe('R-01: after verification, an authenticated current-revision read precedes any answer release', () => {
  it('read-once: Session advances during the verifier read (review reproduction) -> blocked, no data', async () => {
    const { host, conv, handle } = await started();
    sess.answer(1, 'submit', answer1().data);
    const reads = onSessionRead(2, advanceToRevision2);
    await expectNoRelease(
      call(host, 'sess_response', conv, { handle, revision: 1, wait_ms: 0 }),
      /^RECOVERY_BLOCKED: /,
    );
    expect(reads()).toBe(3); // findResponse, verifier, post-verification currentness read
    expect(row(host, handle).state).toBe('blocked');
  });

  it('read-once: Session advances only before the post-verification read -> blocked, no data', async () => {
    const { host, conv, handle } = await started();
    sess.answer(1, 'submit', answer1().data);
    onSessionRead(3, advanceToRevision2);
    await expectNoRelease(
      call(host, 'sess_response', conv, { handle, revision: 1, wait_ms: 0 }),
      /^RECOVERY_BLOCKED: /,
    );
  });

  it('bounded wait: Session advances during verification -> blocked, no data', async () => {
    const { host, conv, handle } = await started();
    sess.answer(1, 'submit', answer1().data);
    onSessionRead(2, advanceToRevision2);
    await expectNoRelease(
      call(host, 'sess_response', conv, { handle, revision: 1, wait_ms: 1000 }),
      /^RECOVERY_BLOCKED: /,
    );
    expect(row(host, handle).state).toBe('blocked');
  });

  it('an already-answered handle re-read after remote progress releases nothing', async () => {
    const { host, conv, handle } = await started();
    sess.answer(1, 'submit', answer1().data);
    await call(host, 'sess_response', conv, { handle, revision: 1, wait_ms: 0 });
    onSessionRead(3, advanceToRevision2);
    await expectNoRelease(
      call(host, 'sess_response', conv, { handle, revision: 1, wait_ms: 0 }),
      /^RECOVERY_BLOCKED: /,
    );
  });

  it('an unexpected post-verification observation (accepted event missing) -> blocked, no data', async () => {
    const { host, conv, handle } = await started();
    sess.answer(1, 'submit', answer1().data);
    onSessionRead(3, () => {
      sess.responses = [];
      sess.status = 'completed';
    });
    await expectNoRelease(
      call(host, 'sess_response', conv, { handle, revision: 1, wait_ms: 0 }),
      /^RECOVERY_BLOCKED: /,
    );
    expect(row(host, handle).state).toBe('blocked');
  });

  it('a failed post-verification read is retryable unavailable: no data, no state change', async () => {
    const { host, conv, handle } = await started();
    sess.answer(1, 'submit', answer1().data);
    // Every read from the post-verification one onward fails (the SDK retries safe reads itself).
    let reads = 0;
    sess.intercept = (method, path) => {
      if (method === 'GET' && path === `/v1/sessions/${sess.sessionId}` && ++reads >= 3)
        throw new TypeError('network down');
      return undefined;
    };
    // Byte-level: the stored row must be exactly as before verification (no `answered` persisted).
    const before = host.store.rows.get(`i:${handle}`);
    expect(before).toBeDefined();
    await expectNoRelease(
      call(host, 'sess_response', conv, { handle, revision: 1, wait_ms: 0 }),
      /^UNAVAILABLE: /,
    );
    expect(host.store.rows.get(`i:${handle}`)).toBe(before);
    sess.intercept = undefined;
    const ok = await call(host, 'sess_response', conv, { handle, revision: 1, wait_ms: 0 });
    expect(ok.details.interaction.state).toBe('answered');
  });

  it('a concurrent local change during the await (first answer) is a conflict and the record is untouched', async () => {
    const { host, conv, handle } = await started();
    sess.answer(1, 'submit', answer1().data);
    let concurrent: string | undefined;
    onSessionRead(3, () => {
      const value = row(host, handle);
      concurrent = JSON.stringify({ ...value, generation: value.generation + 1, state: 'needs_resume' });
      host.store.rows.set(`i:${handle}`, concurrent);
    });
    await expectNoRelease(
      call(host, 'sess_response', conv, { handle, revision: 1, wait_ms: 0 }),
      /^STATE_CONFLICT: /,
    );
    // Untouched (byte-equal) wherever the layout now keeps it (a terminal record may be archived).
    expect(host.store.rows.get(`i:${handle}`) ?? host.archive.rows.get(`i:${handle}`)).toBe(concurrent);
  });

  it('a concurrent local publication/completion of an answered record is a conflict and the record is untouched', async () => {
    const { host, conv, handle } = await started();
    sess.answer(1, 'submit', answer1().data);
    await call(host, 'sess_response', conv, { handle, revision: 1, wait_ms: 0 });
    let concurrent: string | undefined;
    onSessionRead(3, () => {
      const value = row(host, handle);
      concurrent = JSON.stringify({ ...value, generation: value.generation + 1, state: 'completed' });
      host.store.rows.set(`i:${handle}`, concurrent);
    });
    await expectNoRelease(
      call(host, 'sess_response', conv, { handle, revision: 1, wait_ms: 0 }),
      /^STATE_CONFLICT: /,
    );
    // Untouched (byte-equal) wherever the layout now keeps it (a terminal record may be archived).
    expect(host.store.rows.get(`i:${handle}`) ?? host.archive.rows.get(`i:${handle}`)).toBe(concurrent);
  });

  it('a Session completed at the same expected revision with the retained answer is still legitimate', async () => {
    const { host, conv, handle } = await started();
    const eventId = sess.answer(1, 'submit', answer1().data);
    sess.status = 'completed';
    const ok = await call(host, 'sess_response', conv, { handle, revision: 1, wait_ms: 0 });
    expect(ok.details.interaction).toMatchObject({
      state: 'answered',
      revision: 1,
      response: { eventId, verified: true },
    });
  });
});

describe('R-02: the final release boundary re-asserts live authority', () => {
  async function completed() {
    const ctx = await started();
    const eventId = sess.answer(1, 'submit', answer1().data);
    await call(ctx.host, 'sess_response', ctx.conv, { handle: ctx.handle, revision: 1, wait_ms: 0 });
    await call(ctx.host, 'sess_complete', ctx.conv, {
      handle: ctx.handle,
      expected_revision: 1,
      response_event_id: eventId,
    });
    return { ...ctx, eventId };
  }

  /** Revokes (or aborts) right after the awaited guarded record lookup returns (review reproduction). */
  function afterLookup(host: Host, action: () => void) {
    const original = host.store.withCurrent.bind(host.store);
    host.store.withCurrent = (authority) => {
      const bound = original(authority);
      return {
        ...bound,
        lookup: async (key: string) => {
          const value = await bound.lookup(key);
          action();
          return value;
        },
      };
    };
  }

  it('completed sess_response: revocation after the awaited lookup releases no result', async () => {
    const { host, conv, handle } = await completed();
    afterLookup(host, () => (conv.revoked = true));
    await expect(call(host, 'sess_response', conv, { handle, revision: 1, wait_ms: 0 })).rejects.toThrow(
      /^AUTHORITY_REVOKED: /,
    );
  });

  it('repeated sess_complete: revocation after the awaited lookup releases no result', async () => {
    const { host, conv, handle, eventId } = await completed();
    afterLookup(host, () => (conv.revoked = true));
    await expect(
      call(host, 'sess_complete', conv, { handle, expected_revision: 1, response_event_id: eventId }),
    ).rejects.toThrow(/^AUTHORITY_REVOKED: /);
  });

  it('cancellation after the awaited lookup releases no result', async () => {
    const { host, conv, handle, eventId } = await completed();
    const controller = new AbortController();
    afterLookup(host, () => controller.abort());
    await expect(
      call(
        host,
        'sess_complete',
        conv,
        { handle, expected_revision: 1, response_event_id: eventId },
        {
          signal: controller.signal,
        },
      ),
    ).rejects.toThrow(/^CANCELLED: /);
  });

  it('admitted calls still return their terminal results', async () => {
    const { host, conv, handle, eventId } = await completed();
    const read = await call(host, 'sess_response', conv, { handle, revision: 1, wait_ms: 0 });
    expect(read.details.interaction).toEqual({ handle, revision: 1, state: 'completed' });
    const again = await call(host, 'sess_complete', conv, {
      handle,
      expected_revision: 1,
      response_event_id: eventId,
    });
    expect(again.details.interaction).toEqual({ handle, revision: 1, state: 'completed' });
  });
});
