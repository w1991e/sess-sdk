import { describe, expect, it, vi } from 'vitest';
import { Sess, type MutationOptions } from '../../src/index.js';
import { API_KEY, INTERACTION, SESSION_ID, json, session } from '../fixtures/api.js';

const validKeys = ['a', 'A0_.:-', '.', ':', '-'.repeat(128)];
const disallowedPunctuation = Array.from({ length: 94 }, (_, i) => String.fromCharCode(i + 33)).filter(
  (character) => !/[A-Za-z0-9_.:-]/.test(character),
);
const invalidKeys: unknown[] = [
  ...disallowedPunctuation.map((character) => `key${character}value`),
  '',
  'a'.repeat(129),
  'key value',
  ' key',
  'key ',
  'key\t',
  'key\r',
  'key\n',
  'key\u0000',
  'key\u007f',
  'key\u2028',
  'key\u2029',
  'é',
  '🦉',
  null,
  undefined,
  1,
  true,
  [],
  {},
  new String('valid-key'),
];

describe('E-02 public mutation replay alphabet', () => {
  it.each(['publish', 'complete'] as const)(
    'preserves valid %s key bytes and boundaries',
    async (operation) => {
      for (const key of validKeys) {
        const provider = vi.fn(() => API_KEY);
        let sent: Headers | undefined;
        const fetch = vi.fn(async (_url, options) => {
          sent = new Headers(options?.headers);
          return json(session({ status: operation === 'complete' ? 'completed' : 'active' }), 200, {
            etag: '"after"',
          });
        });
        const sess = new Sess({ apiKey: provider, fetch });
        const options = { ifMatch: '"original"', idempotencyKey: key };
        const result =
          operation === 'publish'
            ? await sess.sessions.publish(SESSION_ID, { interaction: INTERACTION }, options)
            : await sess.sessions.complete(SESSION_ID, options);
        expect(sent?.get('idempotency-key')).toBe(key);
        expect(sent?.get('if-match')).toBe('"original"');
        expect(result.meta.idempotencyKey).toBe(key);
        expect(provider).toHaveBeenCalledTimes(1);
        expect(fetch).toHaveBeenCalledTimes(1);
      }
    },
  );

  it.each(['publish', 'complete'] as const)(
    'rejects every invalid %s key before credential resolution or dispatch',
    async (operation) => {
      for (const idempotencyKey of invalidKeys) {
        const provider = vi.fn(() => API_KEY);
        const fetch = vi.fn(async () => json(session(), 200, { etag: '"one"' }));
        const sess = new Sess({ apiKey: provider, fetch });
        const options = { ifMatch: '"original"', idempotencyKey } as MutationOptions;
        await expect(
          operation === 'publish'
            ? sess.sessions.publish(SESSION_ID, { interaction: INTERACTION }, options)
            : sess.sessions.complete(SESSION_ID, options),
        ).rejects.toMatchObject({ kind: 'configuration', outcome: 'not_sent' });
        expect(provider).not.toHaveBeenCalled();
        expect(fetch).not.toHaveBeenCalled();
      }
    },
  );

  it('generates a key only when a new in-process operation omits the field', async () => {
    const fetch = vi.fn(async (_url: string | URL | Request, _options?: RequestInit) =>
      json(session({ status: 'completed' }), 200, { etag: '"one"' }),
    );
    const result = await new Sess({ apiKey: API_KEY, fetch }).sessions.complete(SESSION_ID, {
      ifMatch: '"original"',
    });
    expect(result.meta.idempotencyKey).toMatch(/^[A-Za-z0-9_.:-]{1,128}$/);
    expect(new Headers(fetch.mock.calls[0]?.[1]?.headers).get('idempotency-key')).toBe(
      result.meta.idempotencyKey,
    );
  });
});
