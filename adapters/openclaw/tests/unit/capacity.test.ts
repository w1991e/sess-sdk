// PR-B: capacity without destroying create replay identity (ASTRA #189 §3(c), §4 item 3; #188
// late-replay evidence). Host boundary doubles mirror the released openclaw@2026.10.3 store API;
// the plugin entry, SDK transport and receipt verifier are real.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { formatCounts, formatPrune } from '../../src/doctor.js';
import { countStates, pruneTerminal, type HostStores } from '../../src/store.js';
import { REVOKED_AFTER_SAVE } from '../../src/tools.js';
import {
  API_KEY,
  API_KEY_ENV,
  FakeSess,
  HUMAN_URL,
  call,
  conversation,
  fakeState,
  fixtures,
  recordRow,
  registerPlugin,
  type FakeHost,
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
const creates = () => sess.requests.filter((r) => r.method === 'POST' && r.path === '/v1/sessions').length;
const freshSess = () => {
  sess = new FakeSess();
  vi.stubGlobal('fetch', sess.fetch);
};
const stores = (host: FakeHost): HostStores =>
  ({ legacy: host.legacy, active: host.store, archive: host.archive }) as unknown as HostStores;
const snapshot = (host: FakeHost) =>
  JSON.stringify([...host.stores].map(([ns, s]) => [ns, [...s.rows].sort()]).sort());

async function completeCycle(host: FakeHost, conv: ReturnType<typeof conversation>, toolCallId: string) {
  freshSess();
  const { handle } = (await call(host, 'sess_request', conv, { interaction: round1() }, { toolCallId }))
    .details.interaction;
  const eventId = sess.answer(1, 'submit', { activity: 'museum', hours: 3 });
  await call(host, 'sess_response', conv, { handle, revision: 1, wait_ms: 0 });
  await call(host, 'sess_complete', conv, { handle, expected_revision: 1, response_event_id: eventId });
  return handle as string;
}

describe('capacity: terminal interactions leave active admission, replay identity is kept', () => {
  it('completes more interactions than active capacity; every old call still replays without a second create', async () => {
    const host = await registerPlugin(undefined, fakeState({ 'active-v2': 6 }));
    const conv = conversation();
    const handles: string[] = [];
    for (let n = 0; n < 5; n++) handles.push(await completeCycle(host, conv, `call-${n}`));
    expect(host.store.rows.size).toBe(0);
    expect(host.archive.rows.size).toBe(10); // 5 records + 5 create-claim replay tombstones
    for (let n = 0; n < 5; n++) {
      freshSess();
      const replay = await call(
        host,
        'sess_request',
        conv,
        { interaction: round1() },
        { toolCallId: `call-${n}` },
      );
      expect(replay.details.interaction).toEqual({ handle: handles[n], revision: 1, state: 'completed' });
      expect(creates()).toBe(0);
    }
  });

  it('a claim archived concurrently with a redelivery is detected after registration: no second create', async () => {
    const host = await registerPlugin();
    const conv = conversation();
    const handle = await completeCycle(host, conv, 'raced-call');
    freshSess();
    // The redelivery's first archive lookup observes the claim as not yet archived (the move lands
    // between that lookup and its active registration); only the post-registration recheck sees it.
    const original = host.archive.withCurrent.bind(host.archive);
    let claimLookups = 0;
    host.archive.withCurrent = (authority) => {
      const bound = original(authority);
      const lookup = bound.lookup;
      bound.lookup = async (key: string) =>
        key.startsWith('c:') && ++claimLookups === 1 ? undefined : lookup(key);
      return bound;
    };
    const replay = await call(
      host,
      'sess_request',
      conv,
      { interaction: round1() },
      { toolCallId: 'raced-call' },
    );
    expect(replay.details.interaction).toEqual({ handle, revision: 1, state: 'completed' });
    expect(creates()).toBe(0);
    expect([...host.store.rows.keys()].filter((k) => k.startsWith('c:'))).toEqual([]); // stray claim removed
  });

  it('non-terminal interactions at the active limit refuse new work; nothing is evicted', async () => {
    const host = await registerPlugin(undefined, fakeState({ 'active-v2': 4 }));
    const conv = conversation();
    await call(host, 'sess_request', conv, { interaction: round1() });
    await call(host, 'sess_request', conv, { interaction: round1() });
    const before = [...host.store.rows.keys()].sort();
    await expect(call(host, 'sess_request', conv, { interaction: round1() })).rejects.toThrow(
      /^STORE_FULL: /,
    );
    expect([...host.store.rows.keys()].sort()).toEqual(before);
    expect(creates()).toBe(2);
  });
});

// ---------------------------------------------------------------- legacy (schema 1) upgrade

const binding = { agentId: 'main', sessionKey: 'agent:main:dashboard:one', sessionId: 'incarnation-1' };
function legacyRecord(handle: string, state: string, extra: Record<string, unknown> = {}) {
  return {
    kind: 'interaction',
    schema: 1,
    handle,
    binding,
    origin: 'https://api.sess.example',
    credentialGeneration: 'GEN',
    state,
    generation: 7,
    createdAt: '2026-10-13T00:00:00.000Z',
    updatedAt: '2026-10-13T00:00:01.000Z',
    sessionId: 'ses_01JABCDEFGHJKMNPQRSTVWXYZ0',
    revision: 1,
    ...extra,
  };
}

/** Seeds a pre-upgrade profile through the same claim keys the adapter derives for host calls. */
async function seedLegacy(state: ReturnType<typeof fakeState>) {
  const { claimKey } = await import('../../src/store.js');
  const { resolveCredential, parseConfig } = await import('../../src/config.js');
  const generation = resolveCredential(
    parseConfig({ baseUrl: 'https://api.sess.example', apiKeyEnv: API_KEY_ENV }),
    {
      [API_KEY_ENV]: API_KEY,
    },
  ).generation;
  const legacy = state.open({ namespace: 'interactions-v1', maxEntries: 2200 });
  const put = (key: string, value: unknown) => legacy.rows.set(key, JSON.stringify(value));
  const pending = {
    operation: 'publish',
    ifMatch: '"r1-responded"',
    idempotencyKey: 'sessoc_original-key',
    body: { interaction: fixtures('round-2.json') },
    fromRevision: 1,
    responseEventId: 'evt_01JABCDEFGHJKMNPQRSTVWXY01',
    credentialGeneration: generation,
  };
  const seeds: Record<string, Record<string, unknown>> = {
    done: legacyRecord(`ih_${'d'.repeat(24)}`, 'completed', { credentialGeneration: generation }),
    wait: legacyRecord(`ih_${'w'.repeat(24)}`, 'waiting', {
      credentialGeneration: generation,
      humanUrl: HUMAN_URL,
    }),
    unknown: legacyRecord(`ih_${'u'.repeat(24)}`, 'create_unknown', {
      credentialGeneration: generation,
      sessionId: undefined,
    }),
    pending: legacyRecord(`ih_${'p'.repeat(24)}`, 'publish_pending', {
      credentialGeneration: generation,
      pending,
    }),
    blocked: legacyRecord(`ih_${'b'.repeat(24)}`, 'blocked', {
      credentialGeneration: generation,
      blockedReason: 'verification_failed',
      humanUrl: HUMAN_URL,
    }),
  };
  const calls: Record<string, string> = {};
  for (const [name, record] of Object.entries(seeds)) {
    calls[name] = `old-call-${name}`;
    put(claimKey(binding, calls[name]), { kind: 'claim', schema: 1, handle: record.handle });
    put(`i:${record.handle}`, JSON.parse(JSON.stringify(record)));
  }
  put('i:ih_corruptcorruptcorruptcorr', { some: 'unknown legacy value' });
  return { seeds, calls, claimKey, pending };
}

describe('schema 1 -> 2 profile upgrade', () => {
  it('migrates claims and records, preserving generations and exact replay identities; unknown values untouched', async () => {
    const state = fakeState();
    const { seeds, pending } = await seedLegacy(state);
    const host = await registerPlugin(undefined, state);
    // First admitted invocation upgrades before anything else (a read-once on the waiting handle).
    freshSess();
    sess.revision = 1;
    sess.surfaces.set(1, round1());
    await call(host, 'sess_response', conversation(), {
      handle: seeds.wait!.handle,
      revision: 1,
      wait_ms: 0,
    });
    for (const name of ['done', 'blocked'])
      expect(host.archive.rows.has(`i:${seeds[name]!.handle}`)).toBe(true);
    for (const name of ['wait', 'unknown', 'pending'])
      expect(host.store.rows.has(`i:${seeds[name]!.handle}`)).toBe(true);
    const migratedPending = recordRow(host, seeds.pending!.handle as string);
    expect(migratedPending).toMatchObject({ schema: 2, generation: 7, state: 'publish_pending' });
    expect(migratedPending.pending).toEqual(pending); // exact saved replay identity
    expect(migratedPending.claimKey).toMatch(/^c:/);
    expect(recordRow(host, seeds.unknown!.handle as string)).toMatchObject({
      state: 'create_unknown',
      generation: 7,
    });
    // Legacy keys now carry markers; the unknown value is byte-for-byte unchanged.
    const legacy = host.legacy.rows;
    for (const seed of Object.values(seeds))
      expect(JSON.parse(legacy.get(`i:${seed.handle}`)!)).toEqual({ kind: 'migrated', schema: 2 });
    expect(JSON.parse(legacy.get('i:ih_corruptcorruptcorruptcorr')!)).toEqual({
      some: 'unknown legacy value',
    });
  });

  it('late redelivery of an old create call after migration never creates another Session', async () => {
    const state = fakeState();
    const { calls } = await seedLegacy(state);
    const host = await registerPlugin(undefined, state);
    freshSess();
    const done = await call(
      host,
      'sess_request',
      conversation(),
      { interaction: round1() },
      { toolCallId: calls.done },
    );
    expect(done.details.interaction.state).toBe('completed');
    await expect(
      call(host, 'sess_request', conversation(), { interaction: round1() }, { toolCallId: calls.unknown }),
    ).rejects.toThrow(/^CREATE_OUTCOME_UNKNOWN: /);
    await expect(
      call(host, 'sess_request', conversation(), { interaction: round1() }, { toolCallId: calls.pending }),
    ).rejects.toThrow(/^STATE_CONFLICT: /);
    await expect(
      call(host, 'sess_request', conversation(), { interaction: round1() }, { toolCallId: calls.blocked }),
    ).rejects.toThrow(/^RECOVERY_BLOCKED: /);
    const waiting = await call(
      host,
      'sess_request',
      conversation(),
      { interaction: round1() },
      { toolCallId: calls.wait },
    );
    expect(waiting.details.interaction).toMatchObject({ state: 'waiting', humanUrl: HUMAN_URL });
    expect(creates()).toBe(0);
  });

  it('an interrupted upgrade resumes to the same result, and a repeated upgrade changes nothing', async () => {
    const reference = fakeState();
    const refSeeds = await seedLegacy(reference);
    const refHost = await registerPlugin(undefined, reference);
    freshSess();
    await call(
      refHost,
      'sess_request',
      conversation(),
      { interaction: round1() },
      { toolCallId: refSeeds.calls.done },
    );

    for (const [namespace, failAt] of [
      ['archive-v2', 1],
      ['active-v2', 3],
      ['interactions-v1', 4],
      ['interactions-v1', 40],
    ] as const) {
      const state = fakeState();
      const { calls } = await seedLegacy(state);
      const host = await registerPlugin(undefined, state);
      state.open(
        namespace === 'archive-v2' ? { namespace, retention: 'retained' } : { namespace, maxEntries: 2200 },
      ).failAtWrite = failAt;
      freshSess();
      await expect(
        call(host, 'sess_request', conversation(), { interaction: round1() }, { toolCallId: calls.done }),
      ).rejects.toThrow(/^STORE_UNAVAILABLE: /);
      const resumed = await call(
        host,
        'sess_request',
        conversation(),
        { interaction: round1() },
        { toolCallId: calls.done },
      );
      expect(resumed.details.interaction.state).toBe('completed');
      expect(creates()).toBe(0);
      if (snapshot(host) !== snapshot(refHost)) {
        const keys = (h: FakeHost) =>
          [...h.stores].flatMap(([ns, st]) => [...st.rows].map(([k, v]) => `${ns}|${k}|${v}`));
        const a = new Set(keys(host));
        const b = new Set(keys(refHost));
        throw new Error(
          `DIFF ${namespace}:${failAt} onlyResumed=${JSON.stringify([...a].filter((x) => !b.has(x)).map((x) => x.slice(0, 160)))} onlyRef=${JSON.stringify([...b].filter((x) => !a.has(x)).map((x) => x.slice(0, 160)))}`,
        );
      }
      // A new process (fresh registration on the same profile) repeats the upgrade: no change.
      const again = await registerPlugin(undefined, state);
      await call(
        again,
        'sess_request',
        conversation(),
        { interaction: round1() },
        { toolCallId: calls.done },
      );
      expect(snapshot(again)).toBe(snapshot(refHost));
    }
  });

  it('a destination collision stops the upgrade without overwriting or marking anything', async () => {
    const state = fakeState();
    const { seeds, calls } = await seedLegacy(state);
    const archive = state.open({ namespace: 'archive-v2', retention: 'retained' });
    archive.rows.set(
      `i:${seeds.done!.handle}`,
      JSON.stringify({ kind: 'interaction', schema: 2, different: true }),
    );
    const host = await registerPlugin(undefined, state);
    freshSess();
    await expect(
      call(host, 'sess_request', conversation(), { interaction: round1() }, { toolCallId: calls.done }),
    ).rejects.toThrow(/^STORE_UNAVAILABLE: .*collision/);
    expect(JSON.parse(host.legacy.rows.get(`i:${seeds.done!.handle}`)!).schema).toBe(1);
    expect(JSON.parse(archive.rows.get(`i:${seeds.done!.handle}`)!)).toEqual({
      kind: 'interaction',
      schema: 2,
      different: true,
    });
    expect(creates()).toBe(0);
  });

  it('downgrade safety: an older plugin version finds markers and a full legacy namespace', async () => {
    const state = fakeState();
    const { seeds, calls, claimKey } = await seedLegacy(state);
    const host = await registerPlugin(undefined, state);
    freshSess();
    await call(host, 'sess_request', conversation(), { interaction: round1() }, { toolCallId: calls.done });
    const legacy = host.legacy;
    expect(legacy.rows.size).toBe(2200);
    // Older code: a new claim cannot be admitted (reject-new at its own 2200 limit) ...
    const old = legacy.withCurrent({ assertCurrent() {} });
    await expect(
      old.registerIfAbsent('c:new-call', { kind: 'claim', schema: 1, handle: 'x' }),
    ).rejects.toMatchObject({
      code: 'PLUGIN_STATE_LIMIT_EXCEEDED',
    });
    // ... and every migrated claim/record is a marker it cannot read as schema 1 (it stops safely).
    expect(await old.lookup(claimKey(binding, calls.done!))).toEqual({ kind: 'migrated', schema: 2 });
    expect(await old.lookup(`i:${seeds.done!.handle}`)).toEqual({ kind: 'migrated', schema: 2 });
  });
});

// ---------------------------------------------------------------- prune and diagnostics

describe('prune and redacted diagnostics', () => {
  async function profile() {
    const state = fakeState();
    const host = await registerPlugin(undefined, state);
    const conv = conversation();
    // A blocked interaction retaining its human link (verification failure).
    freshSess();
    const blocked = (
      await call(host, 'sess_request', conv, { interaction: round1() }, { toolCallId: 'blocked-call' })
    ).details.interaction.handle as string;
    sess.answer(1, 'submit', { activity: 'cafe', hours: 2 }, { tamper: true });
    await call(host, 'sess_response', conv, { handle: blocked, revision: 1, wait_ms: 0 }).catch(
      () => undefined,
    );
    // A waiting interaction (non-terminal) that also holds its link.
    freshSess();
    const waiting = (await call(host, 'sess_request', conv, { interaction: round1() })).details.interaction
      .handle as string;
    return { host, conv, blocked, waiting };
  }

  it('dry-run by default changes nothing; --apply removes only terminal links and keeps replay tombstones', async () => {
    const { host, conv, blocked, waiting } = await profile();
    const before = snapshot(host);
    const dry = await pruneTerminal(stores(host), false);
    expect(dry).toEqual({ eligible: 1, compacted: 0, conflicts: 0 });
    expect(snapshot(host)).toBe(before);
    expect(formatPrune(dry, false)).toMatch(/dry run/);
    const claimsBefore = [...host.archive.rows].filter(([k]) => k.startsWith('c:'));
    const applied = await pruneTerminal(stores(host), true);
    expect(applied).toEqual({ eligible: 1, compacted: 1, conflicts: 0 });
    expect(recordRow(host, blocked).humanUrl).toBeUndefined();
    expect(recordRow(host, blocked).state).toBe('blocked');
    expect(recordRow(host, waiting).humanUrl).toBe(HUMAN_URL); // non-terminal untouched
    expect([...host.archive.rows].filter(([k]) => k.startsWith('c:'))).toEqual(claimsBefore);
    // Terminal behavior is retained: the redelivered call still reports its terminal class, no create.
    freshSess();
    await expect(
      call(host, 'sess_request', conv, { interaction: round1() }, { toolCallId: 'blocked-call' }),
    ).rejects.toThrow(/^RECOVERY_BLOCKED: /);
    expect(creates()).toBe(0);
  });

  it('counts are redacted: kinds and states only', async () => {
    const { host } = await profile();
    const text = formatCounts(await countStates(stores(host)));
    expect(text).toMatch(/active interactions.*waiting=1/);
    expect(text).toMatch(/archive.*blocked=1/);
    expect(text).not.toMatch(/ih_|ses_|https?:|\/s\/|c:/);
  });

  it('registers dry-run-first prune and doctor CLI commands', async () => {
    const host = await registerPlugin();
    const names: string[] = [];
    const options: string[] = [];
    const command = (name: string): unknown => {
      names.push(name);
      const self = {
        command,
        description: () => self,
        option: (flag: string) => (options.push(flag), self),
        requiredOption: (flag: string) => (options.push(flag), self),
        action: () => self,
      };
      return self;
    };
    host.cli[0]!.registrar({ program: { command }, config: {} });
    expect(names).toEqual(['sess', 'setup', 'doctor', 'retire', 'prune']);
    expect(options).toContain('--apply');
  });
});

// ---------------------------------------------------------------- R-02 follow-ups (#16 review)

describe('release-boundary revocation for request and publish', () => {
  /** Revokes right after the next write of `state` commits. */
  function revokeAfterWrite(host: FakeHost, conv: { revoked: boolean }, state: string) {
    const original = host.store.withCurrent.bind(host.store);
    host.store.withCurrent = (authority) => {
      const bound = original(authority);
      const apply = bound.compareAndApply;
      bound.compareAndApply = async (key, comparison, intent) => {
        const result = await apply(key, comparison, intent);
        if ((intent as { value?: { state?: string } }).value?.state === state) conv.revoked = true;
        return result;
      };
      return bound;
    };
  }

  it('sess_request revoked after the create is saved releases no result and says to redeliver the original call', async () => {
    const host = await registerPlugin();
    const conv = conversation();
    revokeAfterWrite(host, conv, 'waiting');
    const error = await call(
      host,
      'sess_request',
      conv,
      { interaction: round1() },
      { toolCallId: 'orig' },
    ).catch((e) => e);
    expect(error.code).toBe('AUTHORITY_REVOKED');
    expect(error.message).toContain(REVOKED_AFTER_SAVE);
    expect(JSON.stringify(error)).not.toContain('/s/');
    conv.revoked = false;
    const redelivered = await call(
      host,
      'sess_request',
      conv,
      { interaction: round1() },
      { toolCallId: 'orig' },
    );
    expect(redelivered.details.interaction).toMatchObject({ state: 'waiting', humanUrl: HUMAN_URL });
    expect(creates()).toBe(1);
  });

  it('sess_publish revoked after the confirmed write releases no result', async () => {
    const host = await registerPlugin();
    const conv = conversation();
    const { handle } = (await call(host, 'sess_request', conv, { interaction: round1() })).details
      .interaction;
    const eventId = sess.answer(1, 'submit', { activity: 'museum', hours: 3 });
    await call(host, 'sess_response', conv, { handle, revision: 1, wait_ms: 0 });
    revokeAfterWrite(host, conv, 'waiting');
    await expect(
      call(host, 'sess_publish', conv, {
        handle,
        expected_revision: 1,
        response_event_id: eventId,
        interaction: fixtures('round-2.json'),
      }),
    ).rejects.toThrow(/^AUTHORITY_REVOKED: /);
    expect(recordRow(host, handle)).toMatchObject({ state: 'waiting', revision: 2 });
  });
});
