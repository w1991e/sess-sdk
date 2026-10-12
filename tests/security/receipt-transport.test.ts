import { describe, expect, it, vi } from 'vitest';
import { Sess } from '../../src/client.js';
import { fixture, issuer, sessionId, workspace } from './fixtures.js';

function integration() {
  const f = fixture(Date.now() - 1000);
  const calls: Array<{ url: URL; headers: Headers; redirect?: RequestRedirect }> = [];
  const fetch: typeof globalThis.fetch = vi.fn(async (input, init) => {
    const url = new URL(String(input));
    calls.push({ url, headers: new Headers(init?.headers), redirect: init?.redirect });
    const headers = {
      'content-type': 'application/json',
      etag: '"version-1"',
      'sess-workspace-id': workspace,
    };
    if (url.pathname === `/v1/sessions/${sessionId}`)
      return new Response(JSON.stringify(f.session), { headers });
    if (url.pathname === `/v1/sessions/${sessionId}/surfaces/1`)
      return new Response(JSON.stringify(f.surface), { headers });
    if (url.pathname === '/.well-known/sess-receipt-keys.json')
      return new Response(JSON.stringify(f.keys), { headers });
    throw new Error('Unexpected configured transport request');
  });
  const sess = new Sess({
    apiKey: 'synthetic-owner-key',
    baseUrl: 'https://transport.example',
    receiptIssuer: issuer,
    fetch,
    maxRetries: 0,
  });
  return { f, sess, calls, fetch };
}

describe('receipt helpers through the actual configured Sess transport', () => {
  it('uses injected fetch for every operation with owner-only authentication and integer aggregate budgets', async () => {
    const i = integration();
    const globalFetch = vi
      .spyOn(globalThis, 'fetch')
      .mockRejectedValue(new Error('global fetch must not run'));
    try {
      const verified = await i.sess.receipts.verifyResponse({ sessionId, response: i.f.response });
      expect(verified.claims.aud).toBe(workspace);
      expect(i.calls).toHaveLength(3);
      expect(i.calls.every((call) => call.url.origin === 'https://transport.example')).toBe(true);
      expect(i.calls.every((call) => call.redirect === 'manual')).toBe(true);
      expect(i.calls[0]!.headers.get('authorization')).toBe('Bearer synthetic-owner-key');
      expect(i.calls[1]!.headers.get('authorization')).toBe('Bearer synthetic-owner-key');
      expect(i.calls[2]!.headers.get('authorization')).toBeNull();
      expect(globalFetch).not.toHaveBeenCalled();
    } finally {
      globalFetch.mockRestore();
    }
  });

  it('keeps context resource-scoped while reusing only public-key reads', async () => {
    const i = integration();
    await i.sess.receipts.verifyResponse({ sessionId, response: i.f.response });
    await i.sess.receipts.verifyResponse({ sessionId, response: i.f.response });
    expect(i.calls.filter((call) => call.url.pathname.includes('/.well-known/'))).toHaveLength(1);
    expect(i.calls.filter((call) => call.url.pathname === `/v1/sessions/${sessionId}`)).toHaveLength(2);
  });

  it('enforces the public key body ceiling through the same streaming transport', async () => {
    const i = integration();
    const original = i.fetch;
    const cancel = vi.fn();
    const fetch: typeof globalThis.fetch = async (input, init) => {
      if (String(input).endsWith('/.well-known/sess-receipt-keys.json')) {
        // Valid keys plus JSON whitespace would verify if the transport cap were absent.
        const bytes = new TextEncoder().encode(JSON.stringify(i.f.keys) + ' '.repeat(256 * 1024));
        let sent = false;
        return new Response(
          new ReadableStream<Uint8Array>(
            {
              pull(controller) {
                if (sent) controller.close();
                else {
                  sent = true;
                  controller.enqueue(bytes);
                }
              },
              cancel,
            },
            { highWaterMark: 0 },
          ),
          { headers: { 'content-type': 'application/json' } },
        );
      }
      return original(input, init);
    };
    const sess = new Sess({
      apiKey: 'synthetic-owner-key',
      baseUrl: 'https://transport.example',
      receiptIssuer: issuer,
      fetch,
      maxRetries: 0,
    });
    await expect(sess.receipts.verifyResponse({ sessionId, response: i.f.response })).rejects.toMatchObject({
      code: 'KEY_RESOLUTION_FAILED',
    });
    expect(cancel).toHaveBeenCalledOnce();
  });
});
