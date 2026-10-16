import { describe, expect, it } from 'vitest';
import { generateKeyPairSync } from 'node:crypto';
import { inspect } from 'node:util';
import { Sess } from '../../src/index.js';
import {
  createFakeRuntime,
  FAKE_LINK,
  FAKE_SESSION_ID,
  type FakeRuntime,
} from '../fixtures/fake-runtime.mjs';
import { API_KEY } from '../fixtures/api.js';

const question = {
  question: 'Approve the synthetic refund?',
  fields: [
    { name: 'approved', label: 'Approve it', type: 'boolean' },
    { name: 'amount', label: 'Refund amount', type: 'number', minimum: 0 },
    { name: 'reason', label: 'Reason', type: 'choice', options: ['damaged', 'late'] },
    { name: 'note', label: 'Note', type: 'text', required: false },
    { name: 'tags', label: 'Tags', type: 'multi_choice', options: ['a', 'b'] },
  ],
} as const;
const valid = { approved: true, amount: 12.5, reason: 'late', tags: ['a'] };

function client(runtime: FakeRuntime, extra: Partial<ConstructorParameters<typeof Sess>[0]> = {}) {
  return new Sess({ apiKey: API_KEY, fetch: runtime.fetch, maxRetries: 0, ...extra });
}
const isComplete = (r: { method: string; path: string }) =>
  r.method === 'POST' && r.path.endsWith('/complete');
const completes = (runtime: FakeRuntime) => runtime.requests.filter(isComplete);
const json = (value: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(value), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  });
function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((yes) => (resolve = yes));
  return { promise, resolve };
}

describe('sess.ask: create once, link before waiting', () => {
  it('returns the private link after exactly one create carrying the whole interaction', async () => {
    const runtime = createFakeRuntime();
    const handle = await client(runtime).ask(question);
    expect(handle.link).toBe(FAKE_LINK);
    expect(handle.sessionId).toBe(FAKE_SESSION_ID);
    expect(handle.revision).toBe(1);
    // No wait, publish or second create has happened: the link is available first.
    expect(runtime.requests.map((r) => `${r.method} ${r.path}`)).toEqual(['POST /v1/sessions']);
    const stored = runtime.session()!;
    expect(stored.status).toBe('active');
    expect(stored.interaction.title).toBe(question.question);
    expect(stored.interaction.actions).toEqual([{ id: 'submit', label: 'Send', intent: 'submit' }]);
  });

  it('reports an uncertain create once and never retries it', async () => {
    const runtime = createFakeRuntime();
    runtime.setHook(({ method }) => {
      if (method === 'POST') throw new TypeError('synthetic network failure');
      return undefined;
    });
    const sess = client(runtime, { maxRetries: 2 });
    await expect(sess.ask(question)).rejects.toMatchObject({ kind: 'unknown_outcome', outcome: 'unknown' });
    expect(runtime.requests).toHaveLength(1);
  });

  it('keeps the private link out of serialization and inspection', async () => {
    const runtime = createFakeRuntime();
    const handle = await client(runtime).ask(question);
    expect(JSON.stringify(handle)).not.toContain('human.example');
    expect(inspect(handle)).not.toContain('human.example');
    expect(Object.keys(handle)).not.toContain('link');
    expect(Object.isFrozen(handle)).toBe(true);
  });
});

describe('sess.ask: verify, recheck currentness, then complete', () => {
  it('verifies the receipt, reads the current step, completes and returns typed data', async () => {
    const runtime = createFakeRuntime();
    const handle = await client(runtime).ask(question);
    runtime.answer(valid);
    const answer = await handle.answer();
    expect(answer).toEqual(valid);
    expect(Object.isFrozen(answer)).toBe(true);
    expect(Object.isFrozen(answer.tags)).toBe(true);
    const amount: number = answer.amount;
    const reason: 'damaged' | 'late' = answer.reason;
    const note: string | undefined = answer.note;
    expect([amount, reason, note]).toEqual([12.5, 'late', undefined]);
    expect(runtime.requests.map((r) => `${r.method} ${r.path.replace(FAKE_SESSION_ID, '{id}')}`)).toEqual([
      'POST /v1/sessions',
      'GET /v1/sessions/{id}',
      'GET /v1/sessions/{id}',
      'GET /v1/sessions/{id}/surfaces/1',
      'GET /.well-known/sess-receipt-keys.json',
      'GET /v1/sessions/{id}',
      'POST /v1/sessions/{id}/complete',
    ]);
    const [complete] = completes(runtime);
    expect(complete!.ifMatch).toMatch(/^"r1-responded-/);
    expect(complete!.idempotencyKey).toMatch(/^sess-ask:/);
    expect(runtime.session()!.status).toBe('completed');
  });

  it('repeated and destructured calls return the same result without another write', async () => {
    const runtime = createFakeRuntime();
    const { answer } = await client(runtime).ask(question);
    runtime.answer(valid);
    const first = await answer();
    const writes = runtime.requests.length;
    expect(await answer()).toBe(first);
    expect(runtime.requests).toHaveLength(writes);
    expect(runtime.counts).toMatchObject({ create: 1, complete: 1 });
  });

  it('concurrent calls on one handle share one settlement: one create, one completion', async () => {
    const runtime = createFakeRuntime();
    const handle = await client(runtime).ask(question);
    runtime.answer(valid);
    const [a, b, c] = await Promise.all([handle.answer(), handle.answer(), handle.answer()]);
    expect(a).toBe(b);
    expect(b).toBe(c);
    expect(runtime.counts.create).toBe(1);
    expect(completes(runtime)).toHaveLength(1);
  });

  it('refuses data outside the declared fields before completing', async () => {
    const runtime = createFakeRuntime();
    const handle = await client(runtime).ask(question);
    runtime.answer({ ...valid, amount: -1 });
    await expect(handle.answer()).rejects.toMatchObject({ kind: 'protocol', code: 'INVALID_RESPONSE' });
    expect(completes(runtime)).toHaveLength(0);
    expect(runtime.session()!.status).toBe('responded');
  });

  it('refuses an answer whose Surface is not exactly the question that was asked', async () => {
    const runtime = createFakeRuntime();
    runtime.setHook(({ method, url, init, route }) => {
      if (method !== 'POST' || !String(url).endsWith('/v1/sessions')) return undefined;
      const body = JSON.parse(String(init.body));
      body.interaction.title = 'A different question';
      return route(url, { ...init, body: JSON.stringify(body) });
    });
    const handle = await client(runtime).ask(question);
    runtime.setHook(undefined);
    runtime.answer(valid);
    await expect(handle.answer()).rejects.toMatchObject({
      kind: 'receipt_verification',
      code: 'RECORD_BINDING_MISMATCH',
    });
    expect(completes(runtime)).toHaveLength(0);
  });

  it('a receipt that does not verify never completes or returns data', async () => {
    const runtime = createFakeRuntime();
    const handle = await client(runtime).ask(question);
    runtime.answer(valid);
    const other = generateKeyPairSync('ed25519').publicKey.export({ format: 'jwk' }).x;
    runtime.setHook(({ path }) =>
      path.startsWith('/.well-known/') ? json({ keys: [{ ...runtime.keys.keys[0], x: other }] }) : undefined,
    );
    await expect(handle.answer()).rejects.toMatchObject({
      kind: 'receipt_verification',
      code: 'INVALID_SIGNATURE',
    });
    expect(completes(runtime)).toHaveLength(0);
  });

  it('uses application-owned expected workspace context for verification', async () => {
    const runtime = createFakeRuntime();
    const handle = await client(runtime).ask(question, { expectedWorkspaceId: 'wks_other' });
    runtime.answer(valid);
    await expect(handle.answer()).rejects.toMatchObject({ code: 'AUDIENCE_MISMATCH' });
    expect(completes(runtime)).toHaveLength(0);
  });

  it('an answered revision that was superseded is not used for progression', async () => {
    const runtime = createFakeRuntime();
    const handle = await client(runtime).ask(question);
    runtime.answer(valid);
    runtime.publish(runtime.session()!.interaction);
    await expect(handle.answer()).rejects.toMatchObject({
      kind: 'wait_ended',
      code: 'REVISION_SUPERSEDED',
      sessionId: FAKE_SESSION_ID,
      revision: 1,
    });
    expect(completes(runtime)).toHaveLength(0);
  });

  it('supersession detected after verification stops before completion', async () => {
    const runtime = createFakeRuntime();
    const handle = await client(runtime).ask(question);
    runtime.answer(valid);
    runtime.setHook(({ path }) => {
      // The receipt keys are read last during verification; supersede right after it.
      if (path.startsWith('/.well-known/')) runtime.publish(runtime.session()!.interaction);
      return undefined;
    });
    await expect(handle.answer()).rejects.toMatchObject({ kind: 'wait_ended', code: 'REVISION_SUPERSEDED' });
    expect(completes(runtime)).toHaveLength(0);
  });
});

describe('sess.ask: completion outcomes and replay identity', () => {
  it('an unknown completion outcome is not done; the next call replays the same identity', async () => {
    const runtime = createFakeRuntime();
    const handle = await client(runtime).ask(question);
    runtime.answer(valid);
    let lose = true;
    runtime.setHook(({ method, path }) => {
      if (method === 'POST' && path.endsWith('/complete') && lose) {
        lose = false;
        throw new TypeError('synthetic network failure');
      }
      return undefined;
    });
    await expect(handle.answer()).rejects.toMatchObject({
      outcome: 'unknown',
      operation: 'sessions.complete',
    });
    expect(runtime.session()!.status).toBe('responded');
    await expect(handle.answer()).resolves.toEqual(valid);
    const [first, second] = completes(runtime);
    expect(completes(runtime)).toHaveLength(2);
    expect(second!.idempotencyKey).toBe(first!.idempotencyKey);
    expect(second!.ifMatch).toBe(first!.ifMatch);
    expect(runtime.counts.create).toBe(1);
  });

  it('a lost completion reply is confirmed by readback at the revision, without another write', async () => {
    const runtime = createFakeRuntime();
    const handle = await client(runtime).ask(question);
    runtime.answer(valid);
    let lose = true;
    runtime.setHook(async ({ method, path, url, init, route }) => {
      if (method === 'POST' && path.endsWith('/complete') && lose) {
        lose = false;
        await route(url, init);
        throw new TypeError('synthetic lost reply');
      }
      return undefined;
    });
    await expect(handle.answer()).rejects.toMatchObject({ outcome: 'unknown' });
    expect(runtime.session()!.status).toBe('completed');
    await expect(handle.answer()).resolves.toEqual(valid);
    expect(completes(runtime)).toHaveLength(1);
  });

  it('an already completed Session is confirmed only by a matching readback', async () => {
    const runtime = createFakeRuntime();
    const handle = await client(runtime).ask(question);
    runtime.answer(valid);
    runtime.setHook(({ method, path }) => {
      if (method === 'POST' && path.endsWith('/complete')) runtime.completeNow();
      return undefined;
    });
    await expect(handle.answer()).resolves.toEqual(valid);
    expect(runtime.requests.at(-1)).toMatchObject({ method: 'GET' });
  });

  it('a completion reply at another revision is an unknown outcome, then reconciled by replay', async () => {
    const runtime = createFakeRuntime();
    const handle = await client(runtime).ask(question);
    runtime.answer(valid);
    let wrong = true;
    runtime.setHook(({ method, path }) => {
      if (method === 'POST' && path.endsWith('/complete') && wrong) {
        wrong = false;
        return json({ ...runtime.session(), status: 'completed', revision: 2 }, 200, { etag: '"other"' });
      }
      return undefined;
    });
    await expect(handle.answer()).rejects.toMatchObject({
      kind: 'protocol',
      code: 'INVALID_RESPONSE',
      outcome: 'unknown',
    });
    await expect(handle.answer()).resolves.toEqual(valid);
    const [first, second] = completes(runtime);
    expect(second!.idempotencyKey).toBe(first!.idempotencyKey);
  });

  it('a rejected completion keeps the API error semantics', async () => {
    const runtime = createFakeRuntime();
    const handle = await client(runtime).ask(question);
    runtime.answer(valid);
    runtime.setHook(({ method, path }) =>
      method === 'POST' && path.endsWith('/complete')
        ? json({ error: { code: 'SESSION_REVISION_CONFLICT', request_id: 'request-1' } }, 412)
        : undefined,
    );
    await expect(handle.answer()).rejects.toMatchObject({
      kind: 'api',
      status: 412,
      code: 'SESSION_REVISION_CONFLICT',
      outcome: 'rejected',
    });
    expect(runtime.session()!.status).toBe('responded');
  });
});

describe('sess.ask: waiting semantics', () => {
  it('a finite wait ends locally; a later call resumes the same Session', async () => {
    const runtime = createFakeRuntime();
    const handle = await client(runtime).ask(question);
    await expect(handle.answer({ timeoutMs: 1 })).rejects.toMatchObject({
      kind: 'wait_ended',
      code: 'WAIT_TIMEOUT',
      sessionId: FAKE_SESSION_ID,
      revision: 1,
    });
    expect(runtime.session()!.status).toBe('active');
    runtime.answer(valid);
    await expect(handle.answer()).resolves.toEqual(valid);
    expect(runtime.counts.create).toBe(1);
  });

  it('abort ends only the local wait and never closes the Session', async () => {
    const runtime = createFakeRuntime();
    const handle = await client(runtime).ask(question);
    const controller = new AbortController();
    controller.abort();
    await expect(handle.answer({ signal: controller.signal })).rejects.toMatchObject({
      kind: 'aborted',
      sessionId: FAKE_SESSION_ID,
    });
    expect(runtime.session()!.status).toBe('active');
    expect(completes(runtime)).toHaveLength(0);
  });

  it('abort during settlement leaves the shared settlement for other callers', async () => {
    const runtime = createFakeRuntime();
    const handle = await client(runtime).ask(question);
    runtime.answer(valid);
    const gate = deferred();
    const reached = deferred();
    runtime.setHook(async ({ method, path }) => {
      if (method === 'POST' && path.endsWith('/complete')) {
        reached.resolve();
        await gate.promise;
      }
      return undefined;
    });
    const controller = new AbortController();
    const first = handle.answer({ signal: controller.signal });
    await reached.promise;
    controller.abort();
    await expect(first).rejects.toMatchObject({ kind: 'aborted', sessionId: FAKE_SESSION_ID });
    const second = handle.answer();
    gate.resolve();
    await expect(second).resolves.toEqual(valid);
    expect(completes(runtime)).toHaveLength(1);
  });

  it('a revision completed without an answer ends the wait', async () => {
    const runtime = createFakeRuntime();
    const handle = await client(runtime).ask(question);
    runtime.completeNow();
    await expect(handle.answer()).rejects.toMatchObject({
      kind: 'wait_ended',
      code: 'CLOSED_WITHOUT_RESPONSE',
    });
  });

  it('revoked access surfaces the API error and writes nothing', async () => {
    const runtime = createFakeRuntime();
    const handle = await client(runtime).ask(question);
    runtime.answer(valid);
    runtime.setHook(({ method }) =>
      method === 'GET' ? json({ error: { code: 'UNAUTHORIZED', request_id: 'request-1' } }, 401) : undefined,
    );
    await expect(handle.answer()).rejects.toMatchObject({ kind: 'api', status: 401, code: 'UNAUTHORIZED' });
    expect(completes(runtime)).toHaveLength(0);
  });
});
