import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { Sess } from '@sess/sdk';
import { fileCheckpointStore, runMultiRound, type Checkpoint } from '../../examples/multi-round.js';
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
describe('T-01 durable SDK example checkpoint boundary', () => {
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
