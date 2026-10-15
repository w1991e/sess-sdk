import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { Sess } from '@sess.si/sdk';
import {
  decodeCheckpoint,
  fileCheckpointStore,
  runMultiRound,
  type Checkpoint,
} from '../../examples/multi-round.js';
import { API_KEY, EVENT_ID, INTERACTION, SESSION_ID, json, session } from '../fixtures/api.js';
import { invoiceInteraction } from '../../examples/quickstart.js';

const original = {
  version: 1,
  phase: 'running',
  sessionId: SESSION_ID,
  revision: 1,
  processedEvents: [EVENT_ID],
  intent: {
    operation: 'publish',
    sessionId: SESSION_ID,
    ifMatch: '"original"',
    idempotencyKey: 'original-key',
    body: { interaction: INTERACTION },
  },
};
const malformed: unknown[] = [
  ...[undefined, null, '', 42, [], {}].map((idempotencyKey) => ({
    ...original,
    intent: { ...original.intent, idempotencyKey },
  })),
  { ...original, intent: { ...original.intent, operation: 'unknown' } },
  { ...original, intent: { ...original.intent, sessionId: 'ses_00000000000000000000000002' } },
  { ...original, intent: { ...original.intent, ifMatch: 'W/"weak"' } },
  { ...original, intent: { ...original.intent, body: undefined } },
  { ...original, intent: { ...original.intent, operation: 'complete' } },
  { ...original, revision: 4 },
  { ...original, sessionId: undefined },
  { ...original, phase: 'completed', verification: 'unknown' },
  { ...original, processedEvents: [] },
];
const current = {
  ...original,
  version: 2,
  credentialScope: 'owner-key-v1',
  humanUrl: 'https://human.example/s/synthetic',
  intent: {
    ...original.intent,
    nextRevision: 2,
    credentialScope: 'owner-key-v1',
    body: {
      interaction: {
        ...invoiceInteraction,
        title: 'Review round 2',
        source: {
          kind: 'sess_surface',
          components: [
            {
              type: 'field',
              name: 'amount',
              label: 'Confirm amount',
              required: true,
              schema: { type: 'number', minimum: 0 },
              value: 120,
            },
          ],
        },
      },
    },
  },
};
malformed.push(
  ...[undefined, null, '2', 3].map((nextRevision) => ({
    ...current,
    intent: { ...current.intent, nextRevision },
  })),
  { ...current, credentialScope: undefined },
  { ...current, credentialScope: null },
  { ...current, humanUrl: undefined },
  { ...current, intent: { ...current.intent, credentialScope: 'rotated-owner-key' } },
  {
    ...current,
    intent: {
      ...current.intent,
      body: { interaction: { ...current.intent.body.interaction, title: 'Wrong next round' } },
    },
  },
  {
    ...current,
    intent: { ...current.intent, body: { interaction: { ...current.intent.body.interaction, actions: [] } } },
  },
  { ...current, version: 3 },
);
const invalidReplayKeys: unknown[] = [
  'key/with+punctuation',
  'key,value',
  'key=value',
  'key value',
  'key\t',
  'key\r',
  'key\n',
  'key\u0000',
  'key\u007f',
  'key\u2028',
  'key\u2029',
  'a'.repeat(129),
  '',
  null,
  undefined,
  42,
  [],
  {},
];
for (const state of [original, current]) {
  for (const idempotencyKey of invalidReplayKeys)
    malformed.push({ ...state, intent: { ...state.intent, idempotencyKey } });
}
describe('durable SDK example checkpoint boundary', () => {
  it.each([original, current])(
    'refuses inherited or accessor keys in schema $version without evaluating them',
    async (state) => {
      const getter = vi.fn(() => 'valid-looking-key');
      const inherited = Object.assign(Object.create({ idempotencyKey: 'valid-looking-key' }), state.intent);
      delete inherited.idempotencyKey;
      const accessor = Object.defineProperty({ ...state.intent }, 'idempotencyKey', {
        enumerable: true,
        get: getter,
      });
      for (const intent of [inherited, accessor]) {
        const provider = vi.fn(() => API_KEY);
        const fetch = vi.fn();
        const save = vi.fn();
        await expect(
          runMultiRound(
            new Sess({ apiKey: provider, fetch }),
            { load: async () => ({ ...state, intent }) as Checkpoint, save },
            async () => {},
            undefined,
            current.credentialScope,
          ),
        ).rejects.toThrow('Checkpoint');
        expect(provider).not.toHaveBeenCalled();
        expect(fetch).not.toHaveBeenCalled();
        expect(save).not.toHaveBeenCalled();
      }
      expect(getter).not.toHaveBeenCalled();
    },
  );
  it.each([original, current])('preserves schema $version valid replay-key bytes on decoding', (state) => {
    for (const idempotencyKey of ['a', 'A0_.:-', 'a'.repeat(128)]) {
      const saved = { ...state, intent: { ...state.intent, idempotencyKey } };
      expect(decodeCheckpoint(saved).intent?.idempotencyKey).toBe(idempotencyKey);
      expect(saved.intent.idempotencyKey).toBe(idempotencyKey);
    }
  });
  it('replays the original valid current intent before any lookup and retains it on uncertain failure', async () => {
    const idempotencyKey = 'Original.Key:with_Bytes-128';
    const saved = { ...current, intent: { ...current.intent, idempotencyKey } };
    const save = vi.fn();
    const fetch = vi.fn(async () => {
      throw new Error('synthetic lost reply');
    });
    await expect(
      runMultiRound(
        new Sess({ apiKey: API_KEY, fetch, maxRetries: 0 }),
        { load: async () => saved as Checkpoint, save },
        async () => {},
        undefined,
        current.credentialScope,
      ),
    ).rejects.toMatchObject({ kind: 'transport', outcome: 'unknown', idempotencyKey });
    expect(fetch).toHaveBeenCalledTimes(1);
    const [url, options] = fetch.mock.calls[0]! as unknown as [string, RequestInit];
    expect(url).toBe(`https://api.sess.si/v1/sessions/${SESSION_ID}`);
    expect(options.method).toBe('PATCH');
    const headers = new Headers(options.headers);
    expect(headers.get('if-match')).toBe(current.intent.ifMatch);
    expect(headers.get('idempotency-key')).toBe(idempotencyKey);
    expect(options.body).toBe(JSON.stringify(current.intent.body));
    expect(save).not.toHaveBeenCalled();
    expect(saved.intent.idempotencyKey).toBe(idempotencyKey);
  });
  it('retains valid old intent without inventing credential scope or replaying', async () => {
    const save = vi.fn();
    const fetch = vi.fn(async (url) =>
      String(url).includes('/surfaces/')
        ? json({
            id: SESSION_ID,
            revision: 2,
            interaction: { ...original.intent.body.interaction, response_policy: 'first' },
            response_schema: {},
          })
        : json(session({ revision: 2 }), 200, { etag: '"newer"' }),
    );
    await expect(
      runMultiRound(
        new Sess({ apiKey: API_KEY, fetch }),
        { load: async () => original as Checkpoint, save },
        async () => {},
      ),
    ).rejects.toThrow('read-only reconciliation');
    expect(fetch).toHaveBeenCalledTimes(2);
    for (const [, init] of fetch.mock.calls as unknown as [unknown, RequestInit][])
      expect(init.method).toBe('GET');
    expect(save).not.toHaveBeenCalled();
    expect(original.intent.idempotencyKey).toBe('original-key');
  });
  it('refuses rotated current credential scope before replay or lookup', async () => {
    const fetch = vi.fn();
    const provider = vi.fn(() => API_KEY);
    const save = vi.fn();
    await expect(
      runMultiRound(
        new Sess({ apiKey: provider, fetch }),
        { load: async () => current as Checkpoint, save },
        async () => {},
        undefined,
        'owner-key-v2',
      ),
    ).rejects.toThrow('Credential scope');
    expect(fetch).not.toHaveBeenCalled();
    expect(provider).not.toHaveBeenCalled();
    expect(save).not.toHaveBeenCalled();
  });
  it.each(malformed.map((value, i) => [i, value] as const))(
    'retains malformed checkpoint %s and performs no writes or credential lookup',
    async (_index, value) => {
      const directory = await mkdtemp(join(tmpdir(), 'sess-example-negative-'));
      const path = join(directory, 'state.json');
      const text = JSON.stringify(value);
      const provider = vi.fn(() => API_KEY);
      const fetch = vi.fn();
      const sdk = new Sess({ apiKey: provider, fetch });
      try {
        await writeFile(path, text);
        const store = fileCheckpointStore(path);
        await expect(store.load()).rejects.toThrow('Checkpoint');
        await expect(runMultiRound(sdk, store, async () => {})).rejects.toThrow('Checkpoint');
        await expect(
          runMultiRound(
            sdk,
            { load: async () => value as unknown as Checkpoint, save: vi.fn() },
            async () => {},
          ),
        ).rejects.toThrow('Checkpoint');
        expect(await readFile(path, 'utf8')).toBe(text);
        expect(provider).not.toHaveBeenCalled();
        expect(fetch).not.toHaveBeenCalled();
      } finally {
        await rm(directory, { recursive: true, force: true });
      }
    },
  );
});
