import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createReceiptResource, type VerificationRequestOptions } from '../../src/receipts/resource.js';
import { ReceiptKeyCache } from '../../src/receipts/key-cache.js';
import type { ReceiptKeySet } from '../../src/receipts/verify.js';
import { deferred, fixture, issuer, now, sessionId, workspace } from './fixtures.js';

beforeEach(() => vi.useFakeTimers({ now }));
afterEach(() => {
  vi.useRealTimers();
});

function context(workspaceId: string | undefined = workspace) {
  const f = fixture();
  const retrieveSession = vi.fn(async (_id?: string, _options?: VerificationRequestOptions) => ({
    data: structuredClone(f.session),
    meta: { status: 200, attempts: 1, etag: '"current-1"', ...(workspaceId ? { workspaceId } : {}) },
  }));
  const retrieveSurface = vi.fn(
    async (_id?: string, _revision?: number, _options?: VerificationRequestOptions) => ({
      data: structuredClone(f.surface),
      meta: { status: 200, attempts: 1 },
    }),
  );
  const publicGet = vi.fn(async () => ({
    data: structuredClone(f.keys),
    meta: { status: 200, attempts: 1 },
  }));
  const configuration = {
    receiptIssuer: issuer,
    operationTimeoutMs: 1000,
    baseUrl: 'https://api.sess.example',
    retrieveSession,
    retrieveSurface,
    publicGet,
  };
  return { f, configuration, retrieveSession, retrieveSurface, publicGet };
}

describe('high-level receipt context and snapshots', () => {
  it('checks all reads and returns protected response/Surface copies through injected callbacks', async () => {
    const c = context();
    const verified = await createReceiptResource(c.configuration).verifyResponse({
      sessionId,
      response: c.f.response,
    });
    expect(c.retrieveSession).toHaveBeenCalledWith(
      sessionId,
      expect.objectContaining({ signal: expect.any(AbortSignal), operationTimeoutMs: expect.any(Number) }),
    );
    expect(c.retrieveSurface).toHaveBeenCalledWith(
      sessionId,
      1,
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
    expect(c.publicGet).toHaveBeenCalledWith(
      '/.well-known/sess-receipt-keys.json',
      expect.objectContaining({ maxResponseBytes: 256 * 1024 }),
    );
    expect(verified.response).toEqual(c.f.response);
    expect(Object.isFrozen(verified.response.data.selection)).toBe(true);
    expect(Object.isFrozen(verified.surface.interaction.source.components)).toBe(true);
    expect(() => {
      (verified.response.data as Record<string, unknown>).amount = 999;
    }).toThrow();
    expect(() => {
      (verified.surface.interaction.actions[0] as { label: string }).label = 'changed';
    }).toThrow();
    expect(Object.isFrozen(c.f.response)).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('fails missing trusted context without learning an audience from the receipt', async () => {
    const c = context('');
    await expect(
      createReceiptResource(c.configuration).verifyResponse({ sessionId, response: c.f.response }),
    ).rejects.toMatchObject({ code: 'VERIFICATION_CONTEXT_MISSING' });
    expect(c.publicGet).not.toHaveBeenCalled();
  });

  it('supports explicit trusted workspace on older runtimes and detects authoritative mismatch', async () => {
    const old = context('');
    await expect(
      createReceiptResource({ ...old.configuration, expectedWorkspaceId: workspace }).verifyResponse({
        sessionId,
        response: old.f.response,
      }),
    ).resolves.toHaveProperty('claims.aud', workspace);
    const cross = context('wks_trial_resource');
    await expect(
      createReceiptResource({ ...cross.configuration, expectedWorkspaceId: workspace }).verifyResponse({
        sessionId,
        response: cross.f.response,
      }),
    ).rejects.toMatchObject({ code: 'AUDIENCE_MISMATCH' });
    await expect(
      createReceiptResource({ ...old.configuration, expectedWorkspaceId: workspace }).verifyResponse({
        sessionId,
        response: old.f.response,
        expectedWorkspaceId: 'wks_other',
      }),
    ).rejects.toMatchObject({ code: 'AUDIENCE_MISMATCH' });
  });

  it('checks response membership and immutable Surface identity before key lookup', async () => {
    const c = context();
    c.f.session.responses = [];
    await expect(
      createReceiptResource(c.configuration).verifyResponse({ sessionId, response: c.f.response }),
    ).rejects.toMatchObject({ code: 'RECORD_BINDING_MISMATCH' });
    expect(c.publicGet).not.toHaveBeenCalled();
    const d = context();
    d.f.surface.revision = 2;
    await expect(
      createReceiptResource(d.configuration).verifyResponse({ sessionId, response: d.f.response }),
    ).rejects.toMatchObject({ code: 'RECORD_BINDING_MISMATCH' });
  });

  it('does not let mutation during context retrieval change the returned verified response', async () => {
    const c = context();
    const gate = deferred<Awaited<ReturnType<typeof c.retrieveSession>>>();
    const original = await c.retrieveSession();
    c.retrieveSession.mockImplementation(() => gate.promise);
    const pending = createReceiptResource(c.configuration).verifyResponse({
      sessionId,
      response: c.f.response,
    });
    c.f.response.data.amount = 999;
    gate.resolve(original);
    const verified = await pending;
    expect(verified.response.data.amount).toBe(125.5);
    expect(c.f.response.data.amount).toBe(999);
  });

  it('verifies retained history after completion without changing it or returning a new mutation validator', async () => {
    const c = context();
    c.f.session.status = 'completed';
    c.f.session.revision = 3;
    const verified = await createReceiptResource(c.configuration).verifyResponse({
      sessionId,
      response: c.f.response,
    });
    expect(verified.claims.surface.revision).toBe(1);
    expect(verified).not.toHaveProperty('etag');
    expect(verified).not.toHaveProperty('meta');
  });

  it('has one aggregate budget across delayed context and Surface reads, including ignoring adapters', async () => {
    const c = context();
    const readCurrent = c.retrieveSession.getMockImplementation()!;
    const readSurface = c.retrieveSurface.getMockImplementation()!;
    c.retrieveSession.mockImplementation(
      () => new Promise((resolve) => setTimeout(() => void readCurrent().then(resolve), 600)),
    );
    c.retrieveSurface.mockImplementation(
      () => new Promise((resolve) => setTimeout(() => void readSurface().then(resolve), 600)),
    );
    const pending = createReceiptResource(c.configuration).verifyResponse({
      sessionId,
      response: c.f.response,
    });
    const rejected = expect(pending).rejects.toMatchObject({ kind: 'timeout' });
    await vi.advanceTimersByTimeAsync(1000);
    await rejected;
    expect(c.publicGet).not.toHaveBeenCalled();
    expect(c.retrieveSurface.mock.calls[0]?.[2]?.operationTimeoutMs).toBeLessThanOrEqual(400);
    await vi.advanceTimersByTimeAsync(300); // release deliberately non-cooperative fixture timer
    expect(vi.getTimerCount()).toBe(0);
  });

  it('caller cancellation ends verification and releases its aggregate timer', async () => {
    const c = context();
    c.retrieveSession.mockImplementation(() => new Promise(() => {}));
    const controller = new AbortController();
    const pending = createReceiptResource(c.configuration).verifyResponse(
      { sessionId, response: c.f.response },
      { signal: controller.signal },
    );
    controller.abort();
    await expect(pending).rejects.toMatchObject({ kind: 'aborted' });
    expect(vi.getTimerCount()).toBe(0);
  });

  it('does not share workspace configuration or keys between concurrent clients', async () => {
    const first = context();
    const second = context('wks_other');
    const a = createReceiptResource(first.configuration);
    const b = createReceiptResource({ ...second.configuration, expectedWorkspaceId: 'wks_other' });
    const results = await Promise.allSettled([
      a.verifyResponse({ sessionId, response: first.f.response }),
      b.verifyResponse({ sessionId, response: second.f.response }),
    ]);
    expect(results[0].status).toBe('fulfilled');
    expect(results[1]).toMatchObject({ status: 'rejected', reason: { code: 'AUDIENCE_MISMATCH' } });
    expect(first.publicGet).toHaveBeenCalledTimes(1);
    expect(second.publicGet).not.toHaveBeenCalled();
  });
});

describe('bounded, trust-scoped key caching', () => {
  it('shares a fetch, caches known keys, refreshes unknown keys once after cooldown, and bounds failures', async () => {
    const f = fixture();
    const load = vi.fn(async () => f.keys);
    const cache = new ReceiptKeyCache({ issuer, keySource: 'configured-source', load });
    await Promise.all(Array.from({ length: 12 }, () => cache.resolve({ kid: 'rfc8032-test-1', issuer })));
    expect(load).toHaveBeenCalledTimes(1);
    await cache.resolve({ kid: 'unknown', issuer });
    expect(load).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(10_001);
    await Promise.all(Array.from({ length: 12 }, (_, i) => cache.resolve({ kid: `unknown${i}`, issuer })));
    expect(load).toHaveBeenCalledTimes(2);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('partitions equal kid values by issuer and configured source', async () => {
    const f = fixture();
    const one = vi.fn(async () => f.keys);
    const otherKeys: ReceiptKeySet = {
      keys: [{ ...f.keys.keys[0]!, x: Buffer.alloc(32, 1).toString('base64url') }],
    };
    const two = vi.fn(async () => otherKeys);
    const a = new ReceiptKeyCache({ issuer, keySource: 'one', load: one });
    const b = new ReceiptKeyCache({ issuer: 'https://issuer.two', keySource: 'two', load: two });
    const result = await Promise.all([
      a.resolve({ kid: 'rfc8032-test-1', issuer }),
      b.resolve({ kid: 'rfc8032-test-1', issuer: 'https://issuer.two' }),
    ]);
    expect(result[0]).not.toEqual(result[1]);
    await expect(a.resolve({ kid: 'rfc8032-test-1', issuer: 'https://issuer.two' })).rejects.toMatchObject({
      code: 'ISSUER_MISMATCH',
    });
  });

  it('keeps shared lookup alive for another waiter after one caller aborts', async () => {
    const f = fixture();
    const gate = deferred<ReceiptKeySet>();
    let sharedSignal: AbortSignal | undefined;
    const cache = new ReceiptKeyCache({
      issuer,
      keySource: 'one',
      load: ({ signal }) => {
        sharedSignal = signal;
        return gate.promise;
      },
    });
    const controller = new AbortController();
    const a = cache.resolve({ kid: 'rfc8032-test-1', issuer, signal: controller.signal });
    const b = cache.resolve({ kid: 'rfc8032-test-1', issuer });
    await Promise.resolve();
    controller.abort();
    await expect(a).rejects.toMatchObject({ kind: 'aborted' });
    expect(sharedSignal?.aborted).toBe(false);
    gate.resolve(f.keys);
    await expect(b).resolves.toEqual(f.keys);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('bounds a non-cooperative loader and does not refetch continuously after failure', async () => {
    const load = vi.fn(() => new Promise<ReceiptKeySet>(() => {}));
    const cache = new ReceiptKeyCache({ issuer, keySource: 'one', requestTimeoutMs: 50, load });
    const pending = cache.resolve({ kid: 'unknown', issuer });
    const reject = expect(pending).rejects.toMatchObject({ kind: 'timeout' });
    await vi.advanceTimersByTimeAsync(50);
    await reject;
    await expect(cache.resolve({ kid: 'newunknown', issuer })).rejects.toMatchObject({ kind: 'timeout' });
    expect(load).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('releases an abandoned fetch and lets a later caller start without inheriting cancellation', async () => {
    const f = fixture();
    const first = deferred<ReceiptKeySet>();
    const load = vi
      .fn()
      .mockImplementationOnce(() => first.promise)
      .mockResolvedValue(f.keys);
    const cache = new ReceiptKeyCache({ issuer, keySource: 'one', load });
    const controller = new AbortController();
    const pending = cache.resolve({ kid: 'rfc8032-test-1', issuer, signal: controller.signal });
    await Promise.resolve();
    controller.abort();
    await expect(pending).rejects.toMatchObject({ kind: 'aborted' });
    await expect(cache.resolve({ kid: 'rfc8032-test-1', issuer })).resolves.toEqual(f.keys);
    expect(load).toHaveBeenCalledTimes(2);
    expect(vi.getTimerCount()).toBe(0);
  });
});
