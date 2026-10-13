import { getEventListeners } from 'node:events';
import { describe, expect, it, vi } from 'vitest';
import { Sess } from '../../src/client.js';
import { withSignal } from '../../src/internal/time.js';
import { snapshotJson as requestSnapshot } from '../../src/internal/json.js';
import { snapshotJson as verificationSnapshot } from '../../src/receipts/json.js';
import { strongETag } from '../../src/transport.js';
import { fixture, sessionId } from './fixtures.js';

describe('transport security audit regressions', () => {
  it('releases an abort listener even if the underlying operation never settles', async () => {
    const controller = new AbortController();
    const pending = withSignal(new Promise<never>(() => {}), controller.signal);
    expect(getEventListeners(controller.signal, 'abort')).toHaveLength(1);
    controller.abort();
    await expect(pending).rejects.toMatchObject({ kind: 'aborted' });
    expect(getEventListeners(controller.signal, 'abort')).toHaveLength(0);
  });

  it.each([`sess_mg_${'a'.repeat(43)}`, 'A'.repeat(43)])(
    'keeps reflected credentials out of errors and hooks',
    async (credential) => {
      const observer = vi.fn();
      const sess = new Sess({
        apiKey: 'synthetic-owner',
        maxRetries: 0,
        onRequestEvent: observer,
        fetch: async () =>
          new Response(JSON.stringify({ error: { code: 'UNAUTHORIZED', request_id: credential } }), {
            status: 401,
            headers: { 'content-type': 'application/json', 'x-request-id': credential },
          }),
      });
      const result = await sess.sessions.retrieve(sessionId).then(
        () => {
          throw new Error('Expected refusal');
        },
        (error: unknown) => error,
      );
      expect(result).toMatchObject({ kind: 'api', code: 'UNAUTHORIZED' });
      expect(JSON.stringify(result)).not.toContain(credential);
      expect(JSON.stringify(observer.mock.calls)).not.toContain(credential);
    },
  );

  it('preserves future safe API codes independently of opaque credential-shaped IDs', async () => {
    const code = 'F'.repeat(43);
    const sess = new Sess({
      apiKey: 'synthetic-owner',
      maxRetries: 0,
      fetch: async () =>
        new Response(JSON.stringify({ error: { code, request_id: 'normal-request-id' } }), {
          status: 400,
          headers: { 'content-type': 'application/json' },
        }),
    });
    await expect(sess.sessions.retrieve(sessionId)).rejects.toMatchObject({
      code,
      requestId: 'normal-request-id',
    });
  });

  it('treats strong ETags as opaque RFC validators, including empty and obs-text tags', async () => {
    for (const etag of ['""', '"opaque\\backslash"', '"\u0080\u00ff"']) expect(strongETag(etag)).toBe(true);
    for (const etag of ['W/"weak"', '"space inside"', '"newline\n"', '"quote"inside"', '"\u0100"'])
      expect(strongETag(etag)).toBe(false);
    const f = fixture();
    const fetch = vi.fn(
      async (_input: RequestInfo | URL, _init?: RequestInit) =>
        new Response(JSON.stringify(f.session), {
          headers: { 'content-type': 'application/json', etag: '""' },
        }),
    );
    const sess = new Sess({ apiKey: 'synthetic-owner', fetch });
    expect((await sess.sessions.retrieve(sessionId)).meta.etag).toBe('""');
  });

  it('refuses custom array and hidden serialization semantics without invoking them', () => {
    const coercion = vi.fn(() => ['different-business-data']);
    class CustomArray extends Array {
      toJSON = coercion;
    }
    class InheritedArray extends Array {
      toJSON() {
        return coercion();
      }
    }
    const customArray = new CustomArray();
    customArray.push(1, 2);
    const inheritedArray = new InheritedArray();
    inheritedArray.push(1, 2);
    const hidden = Object.defineProperty({ amount: 120 }, 'toJSON', { value: coercion });
    const accessor = Object.defineProperty({ amount: 120 }, 'hidden', { get: coercion });
    for (const snapshot of [requestSnapshot, verificationSnapshot]) {
      for (const invalid of [customArray, inheritedArray, hidden, accessor]) {
        expect(() => snapshot(invalid)).toThrow();
      }
      expect(snapshot({ toJSON: 'ordinary field data', amount: 120 })).toEqual({
        toJSON: 'ordinary field data',
        amount: 120,
      });
    }
    expect(coercion).not.toHaveBeenCalled();
  });
});
