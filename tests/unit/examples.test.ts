import { describe, expect, it, vi } from 'vitest';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as ts from 'typescript';
import { Sess } from '@sess/sdk';
import type { InteractiveSession, SurfaceRevision } from '../../src/index.js';
import {
  assertCurrentStep,
  fileCheckpointStore,
  runMultiRound,
  type Checkpoint,
  type CheckpointStore,
} from '../../examples/multi-round.js';
import { invoiceInteraction, reviewInvoice } from '../../examples/quickstart.js';
import { formRequest, previewForm } from '../../examples/form-controls.js';
import {
  API_KEY,
  INTERACTION,
  RESPONSE,
  SESSION_ID,
  WORKSPACE,
  creation,
  json,
  session,
} from '../fixtures/api.js';
import { fixture, digest, signClaims } from '../security/fixtures.js';

function mockLifecycle() {
  let current = session();
  let creates = 0;
  let publishes = 0;
  let completes = 0;
  const surfaces = new Map<number, SurfaceRevision>();
  const keys = fixture().keys;
  function answer() {
    if (current.status !== 'active') return;
    const revision = current.revision;
    surfaces.set(revision, {
      id: SESSION_ID,
      revision,
      interaction: structuredClone(current.interaction),
      response_schema: current.response_schema,
    });
    const response = {
      ...RESPONSE,
      event_id: `evt_${String(revision).padStart(26, '0')}`,
      sequence: revision * 2 - 1,
      revision,
      data: { amount: 120 + revision },
      accepted_at: new Date().toISOString(),
    };
    const claims = fixture(Date.now()).claims;
    claims.iss = 'https://api.sess.si';
    claims.aud = WORKSPACE;
    claims.workspace_id = WORKSPACE;
    claims.jti = response.event_id;
    claims.event_id = response.event_id;
    claims.session_id = SESSION_ID;
    claims.step_id = `rev_${revision}`;
    claims.accepted_at = response.accepted_at;
    claims.surface = { revision, hash: digest(current.interaction), renderer_version: 'sess-html-form-1' };
    claims.action = { id: 'submit', label: 'Submit review', summary: 'submit' };
    claims.input_hash = digest(response.data);
    claims.actor.subject = `${WORKSPACE}:human_link:${SESSION_ID}`;
    claims.return_binding.recipient = WORKSPACE;
    current.responses.push({ ...response, receipt: signClaims(claims) });
    current.status = 'responded';
  }
  const fetch: typeof globalThis.fetch = vi.fn(async (url, init) => {
    const path = new URL(String(url)).pathname;
    if (path === '/.well-known/sess-receipt-keys.json') return json(keys);
    if (path === '/v1/sessions') {
      creates++;
      current.interaction = {
        ...(JSON.parse(String(init?.body)).interaction as InteractiveSession['interaction']),
        response_policy: 'first',
      };
      return creation({ 'sess-workspace-id': WORKSPACE });
    }
    if (/\/surfaces\/\d+$/.test(path)) return json(surfaces.get(Number(path.split('/').at(-1))));
    if (init?.method === 'PATCH') {
      publishes++;
      current.revision++;
      current.status = 'active';
      current.interaction = {
        ...(JSON.parse(String(init.body)).interaction as InteractiveSession['interaction']),
        response_policy: 'first',
      };
    } else if (path.endsWith('/complete')) {
      completes++;
      current.status = 'completed';
    } else answer();
    return json(current, 200, {
      etag: `"${current.revision}-${current.status}"`,
      'sess-workspace-id': WORKSPACE,
    });
  });
  return {
    fetch,
    counts: () => ({ creates, publishes, completes }),
    current: () => structuredClone(current),
  };
}

describe('compiled examples and continuation safeguards', () => {
  it('sends the form-authoring envelope identically through the SDK and direct HTTP', async () => {
    const bodies: string[] = [];
    const fetch: typeof globalThis.fetch = vi.fn(async (_url, init) => {
      bodies.push(String(init?.body));
      return creation({ 'sess-workspace-id': WORKSPACE });
    });
    await previewForm(new Sess({ apiKey: API_KEY, fetch }));
    await fetch('https://api.sess.si/v1/sessions', {
      method: 'POST',
      headers: { authorization: `Bearer ${API_KEY}`, 'content-type': 'application/json' },
      body: JSON.stringify(formRequest),
    });
    expect(bodies).toHaveLength(2);
    expect(bodies[0]).toBe(bodies[1]);
    expect(JSON.parse(bodies[0]!)).toEqual(formRequest);
  });
  it('executes the advertised README quickstart against a signed synthetic lifecycle', async () => {
    const readme = await readFile(new URL('../../README.md', import.meta.url), 'utf8');
    const snippet = readme.match(
      /<!-- example:quickstart -->\s*```ts\n([\s\S]*?)\n```\s*<!-- \/example:quickstart -->/,
    );
    expect(snippet?.[1]).toBeTruthy();
    const source = snippet![1]!.replace(/^import \{ Sess \} from '@sess\/sdk';\r?\n/m, '');
    const compiled = ts.transpileModule(source, {
      compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
    }).outputText;
    const runtime = mockLifecycle();
    class ExampleSess extends Sess {
      constructor(options: ConstructorParameters<typeof Sess>[0]) {
        super({ ...options, fetch: runtime.fetch });
      }
    }
    const execute = new Function(
      'Sess',
      'process',
      `return (async () => { ${compiled}\nreturn amount; })()`,
    ) as (SDK: typeof Sess, context: { env: Record<string, string> }) => Promise<number>;
    expect(await execute(ExampleSess, { env: { SESS_API_KEY: API_KEY } })).toBe(121);
    expect(runtime.counts()).toEqual({ creates: 1, publishes: 0, completes: 0 });
  });
  it('quickstart creates, privately hands off, waits and fully verifies input', async () => {
    const runtime = mockLifecycle();
    const handoff = vi.fn(async () => {});
    expect(await reviewInvoice(new Sess({ apiKey: API_KEY, fetch: runtime.fetch }), handoff)).toBe(121);
    expect(handoff).toHaveBeenCalledTimes(1);
    expect(runtime.counts().creates).toBe(1);
  });
  it('runs three rounds with persisted intents and fresh completed verification on resume', async () => {
    const runtime = mockLifecycle();
    let saved: Checkpoint | undefined;
    const snapshots: Checkpoint[] = [];
    const store: CheckpointStore = {
      async load() {
        return saved && structuredClone(saved);
      },
      async save(value) {
        saved = structuredClone(value);
        snapshots.push(structuredClone(value));
      },
    };
    const sdk = new Sess({ apiKey: API_KEY, fetch: runtime.fetch });
    const handoff = vi.fn(async () => {});
    await runMultiRound(sdk, store, handoff, undefined, 'credential-slot-v1');
    expect(runtime.counts()).toEqual({ creates: 1, publishes: 2, completes: 1 });
    expect(saved?.verification).toBe('verified');
    const legacyCompleted = structuredClone(saved!);
    legacyCompleted.version = 1;
    delete legacyCompleted.credentialScope;
    delete legacyCompleted.verification;
    await runMultiRound(
      sdk,
      {
        async load() {
          return legacyCompleted;
        },
        async save() {
          throw new Error('Legacy state must remain untouched');
        },
      },
      handoff,
    );
    expect(runtime.counts()).toEqual({ creates: 1, publishes: 2, completes: 1 });
    expect(handoff).toHaveBeenCalledTimes(1);
    expect(runtime.current().responses).toHaveLength(3);
    expect(snapshots[0]?.phase).toBe('creating');
    expect(snapshots.filter((s) => s.intent)).toHaveLength(3);
    for (const snapshot of snapshots.filter((s) => s.intent)) {
      expect(snapshot.intent).toMatchObject({
        sessionId: SESSION_ID,
        idempotencyKey: expect.any(String),
        ifMatch: expect.stringMatching(/^"/),
      });
    }
    await runMultiRound(sdk, store, handoff, undefined, 'credential-slot-v1');
    expect(runtime.counts()).toEqual({ creates: 1, publishes: 2, completes: 1 });
  });
  it.each(['advanced', 'completed', 'already_processed'] as const)(
    'historical or processed answer cannot derive new writes: %s',
    (reason) => {
      const checkpoint: Checkpoint = {
        version: 1,
        phase: 'running',
        sessionId: SESSION_ID,
        revision: 1,
        processedEvents: reason === 'already_processed' ? [RESPONSE.event_id] : [],
      };
      const current = session({
        status: reason === 'completed' ? 'completed' : 'responded',
        revision: reason === 'advanced' ? 3 : 1,
        responses: [RESPONSE],
      });
      expect(() =>
        assertCurrentStep(checkpoint, {
          session: current,
          response: RESPONSE,
          meta: { status: 200, attempts: 1, etag: '"latest"' },
        }),
      ).toThrow('reconcile');
    },
  );
  it('current answered expected step can derive a guarded mutation', () => {
    expect(() =>
      assertCurrentStep(
        { version: 1, phase: 'running', sessionId: SESSION_ID, revision: 1, processedEvents: [] },
        {
          session: session({ status: 'responded', responses: [RESPONSE] }),
          response: RESPONSE,
          meta: { status: 200, attempts: 1, etag: '"answered"' },
        },
      ),
    ).not.toThrow();
  });
  it('unresolved create intent never sends another create', async () => {
    const fetch = vi.fn();
    const store: CheckpointStore = {
      async load() {
        return { version: 1, phase: 'creating', revision: 1, processedEvents: [] };
      },
      async save() {},
    };
    await expect(runMultiRound(new Sess({ apiKey: API_KEY, fetch }), store, async () => {})).rejects.toThrow(
      'Unresolved creation',
    );
    expect(fetch).not.toHaveBeenCalled();
  });
  it('saved uncertain mutation replays its original identity without a newer read', async () => {
    const current = session({ status: 'responded', responses: [RESPONSE] });
    const state: Checkpoint = {
      version: 2,
      phase: 'running',
      sessionId: SESSION_ID,
      humanUrl: 'https://human.example/s/synthetic',
      credentialScope: 'credential-slot-v1',
      revision: 1,
      processedEvents: [RESPONSE.event_id],
      intent: {
        operation: 'publish',
        sessionId: SESSION_ID,
        ifMatch: '"original"',
        idempotencyKey: 'original-key',
        nextRevision: 2,
        credentialScope: 'credential-slot-v1',
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
    const fetch: typeof globalThis.fetch = vi.fn(async (_url, init) => {
      expect(init?.method).toBe('PATCH');
      expect(new Headers(init.headers).get('if-match')).toBe('"original"');
      expect(new Headers(init.headers).get('idempotency-key')).toBe('original-key');
      return json(
        { error: { code: 'SESSION_REVISION_CONFLICT', message: 'stale', request_id: 'request-1' } },
        412,
      );
    });
    await expect(
      runMultiRound(
        new Sess({ apiKey: API_KEY, fetch }),
        {
          async load() {
            return state;
          },
          async save() {},
        },
        async () => {},
        undefined,
        'credential-slot-v1',
      ),
    ).rejects.toMatchObject({ status: 412 });
    expect(fetch).toHaveBeenCalledTimes(1);
  });
  it('file checkpoint commits ordinary JSON and fails closed on incompatible state', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'sess-example-'));
    const path = join(dir, 'state.json');
    try {
      const store = fileCheckpointStore(path);
      expect(await store.load()).toBeUndefined();
      const value: Checkpoint = { version: 1, phase: 'creating', revision: 1, processedEvents: [] };
      await store.save(value);
      expect(await store.load()).toEqual(value);
      expect(JSON.parse(await readFile(path, 'utf8'))).toEqual(value);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
