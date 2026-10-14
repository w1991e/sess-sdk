// #19 review follow-ups: retire, move-collision restore, prune upgrade guard, upgrade waiters,
// paged operator reads and archival retry.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { countStates, pruneTerminal, retireIdle, type HostStores } from '../../src/store.js';
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
const stores = (host: FakeHost) =>
  ({ legacy: host.legacy, active: host.store, archive: host.archive }) as unknown as HostStores;
const DAY = 86_400_000;

function age(host: FakeHost, handle: string, days: number) {
  const key = `i:${handle}`;
  const row = JSON.parse(host.store.rows.get(key)!);
  row.updatedAt = new Date(Date.now() - days * DAY).toISOString();
  host.store.rows.set(key, JSON.stringify(row));
}

describe('retire: operator remedy for abandoned interactions', () => {
  it('dry-run lists idle waiting records; --apply blocks and archives them; claims kept; ambiguous untouched', async () => {
    const host = await registerPlugin();
    const conv = conversation();
    const idle = (await call(host, 'sess_request', conv, { interaction: round1() }, { toolCallId: 'idle' }))
      .details.interaction.handle as string;
    const fresh = (await call(host, 'sess_request', conv, { interaction: round1() })).details.interaction
      .handle as string;
    // An ambiguous create (create_unknown) that is just as old must never be retired.
    sess.intercept = (method, path) => {
      if (method === 'POST' && path === '/v1/sessions') throw new TypeError('lost');
      return undefined;
    };
    await call(host, 'sess_request', conv, { interaction: round1() }, { toolCallId: 'lost' }).catch(
      () => undefined,
    );
    sess.intercept = undefined;
    const unknownKey = [...host.store.rows].find(([, v]) => JSON.parse(v).state === 'create_unknown')![0];
    const unknownBefore = host.store.rows.get(unknownKey);
    age(host, idle, 10);
    const unknownRow = JSON.parse(unknownBefore!);
    host.store.rows.set(
      unknownKey,
      JSON.stringify({ ...unknownRow, updatedAt: new Date(Date.now() - 10 * DAY).toISOString() }),
    );
    const agedUnknown = host.store.rows.get(unknownKey);

    const dry = await retireIdle(stores(host), 7 * DAY, false);
    expect(dry).toMatchObject({ eligible: 1, retired: 0, skippedByState: { create_unknown: 1 } });
    expect(recordRow(host, idle).state).toBe('waiting');

    const applied = await retireIdle(stores(host), 7 * DAY, true);
    expect(applied).toMatchObject({ eligible: 1, retired: 1, archived: 1, conflicts: 0 });
    expect(host.archive.rows.has(`i:${idle}`)).toBe(true);
    expect(recordRow(host, idle)).toMatchObject({ state: 'blocked', blockedReason: 'operator_retired' });
    expect(recordRow(host, idle).humanUrl).toBeUndefined();
    expect(recordRow(host, fresh).state).toBe('waiting');
    expect(host.store.rows.get(unknownKey)).toBe(agedUnknown);
    // The replay tombstone survives: a redelivered call reports blocked and never creates again.
    const before = creates();
    await expect(
      call(host, 'sess_request', conv, { interaction: round1() }, { toolCallId: 'idle' }),
    ).rejects.toThrow(/^RECOVERY_BLOCKED: /);
    expect(creates()).toBe(before);
  });
});

describe('archive move collision (host keeps the destination and removes the source)', () => {
  it('restores the source value into active when a concurrent destination write wins', async () => {
    const host = await registerPlugin();
    const conv = conversation();
    const { handle } = (await call(host, 'sess_request', conv, { interaction: round1() })).details
      .interaction;
    const eventId = sess.answer(1, 'submit', { activity: 'museum', hours: 3 });
    await call(host, 'sess_response', conv, { handle, revision: 1, wait_ms: 0 });
    // A different value lands on the destination right after the pre-check (simulated race).
    const original = host.archive.withCurrent.bind(host.archive);
    host.archive.withCurrent = (authority) => {
      const bound = original(authority);
      const move = bound.moveEntriesFrom;
      bound.moveEntriesFrom = async (source) => {
        host.archive.rows.set(
          `i:${handle}`,
          JSON.stringify({ kind: 'interaction', schema: 2, racing: true }),
        );
        return move(source);
      };
      return bound;
    };
    await call(host, 'sess_complete', conv, { handle, expected_revision: 1, response_event_id: eventId });
    const restored = JSON.parse(host.store.rows.get(`i:${handle}`)!);
    expect(restored).toMatchObject({ handle, state: 'completed' });
    expect(JSON.parse(host.archive.rows.get(`i:${handle}`)!)).toEqual({
      kind: 'interaction',
      schema: 2,
      racing: true,
    });
  });
});

describe('prune and upgrade guards', () => {
  it('prune refuses while unmigrated legacy schema-1 data remains', async () => {
    const state = fakeState();
    const host = await registerPlugin(undefined, state);
    host.legacy.rows.set('c:legacy', JSON.stringify({ kind: 'claim', schema: 1, handle: 'ih_x' }));
    await expect(pruneTerminal(stores(host), false)).rejects.toThrow(/upgrade has not completed/);
  });

  it('an upgrade waiter does not inherit the runner revocation; it reports a retryable conflict', async () => {
    const state = fakeState();
    state
      .open({ namespace: 'interactions-v1', maxEntries: 2200 })
      .rows.set('c:legacy', JSON.stringify({ kind: 'claim', schema: 1, handle: `ih_${'x'.repeat(24)}` }));
    const host = await registerPlugin(undefined, state);
    const first = conversation();
    const second = conversation({ sessionKey: 'agent:main:dashboard:two' });
    const legacy = host.legacy;
    const original = legacy.withCurrent.bind(legacy);
    legacy.withCurrent = (authority) => {
      const bound = original(authority);
      const entries = bound.entries;
      bound.entries = async () => {
        const rows = await entries();
        first.revoked = true; // the runner loses authority mid-upgrade
        return rows;
      };
      return bound;
    };
    const a = call(host, 'sess_request', first, { interaction: round1() });
    const b = call(host, 'sess_request', second, { interaction: round1() });
    await expect(a).rejects.toThrow(/^AUTHORITY_REVOKED: /);
    await expect(b).rejects.toThrow(/^STATE_CONFLICT: .*upgrade was interrupted/);
    legacy.withCurrent = original;
    const retried = await call(host, 'sess_request', second, { interaction: round1() });
    expect(retried.details.interaction).toMatchObject({ state: 'waiting', humanUrl: HUMAN_URL });
  });

  it('operator reads page with entriesInKeyRange instead of loading everything', async () => {
    const host = await registerPlugin();
    for (let n = 0; n < 1201; n++)
      host.archive.rows.set(
        `c:${String(n).padStart(5, '0')}`,
        JSON.stringify({ kind: 'claim', schema: 2, handle: 'h' }),
      );
    const counts = await countStates(stores(host));
    expect(counts.archive).toEqual({ claim: 1201 });
    expect(host.archive.rangeCalls).toBe(3);
    expect(host.archive.entriesCalls).toBe(0);
  });
});

describe('archival retry', () => {
  it('a failed archival is retried on the next call, not only at process start', async () => {
    const host = await registerPlugin();
    const conv = conversation();
    const { handle } = (await call(host, 'sess_request', conv, { interaction: round1() })).details
      .interaction;
    const eventId = sess.answer(1, 'submit', { activity: 'museum', hours: 3 });
    await call(host, 'sess_response', conv, { handle, revision: 1, wait_ms: 0 });
    host.archive.failAtWrite = 1; // the move after completion fails
    await call(host, 'sess_complete', conv, { handle, expected_revision: 1, response_event_id: eventId });
    expect(host.store.rows.has(`i:${handle}`)).toBe(true);
    const read = await call(host, 'sess_response', conv, { handle, revision: 1, wait_ms: 0 });
    expect(read.details.interaction.state).toBe('completed');
    expect(host.store.rows.has(`i:${handle}`)).toBe(false);
    expect(recordRow(host, handle).state).toBe('completed');
  });
});

describe('prune racing archival (#22 review note)', () => {
  it('a prune applied between the archival pre-check and the move leaves no stale active duplicate', async () => {
    const host = await registerPlugin();
    const conv = conversation();
    const { handle } = (await call(host, 'sess_request', conv, { interaction: round1() })).details
      .interaction;
    // A tampered receipt blocks the interaction; the blocked record still holds its human link
    // when the Gateway archives it.
    sess.answer(1, 'submit', { activity: 'cafe', hours: 2 }, { tamper: true });
    const original = host.archive.withCurrent.bind(host.archive);
    let pruned: Awaited<ReturnType<typeof pruneTerminal>> | undefined;
    host.archive.withCurrent = (authority) => {
      const bound = original(authority);
      const move = bound.moveEntriesFrom;
      bound.moveEntriesFrom = async (source) => {
        // Operator `openclaw sess prune --apply` (another process) lands right before the move.
        pruned ??= await pruneTerminal(stores(host), true);
        return move(source);
      };
      return bound;
    };
    await expect(call(host, 'sess_response', conv, { handle, revision: 1, wait_ms: 0 })).rejects.toThrow(
      /^VERIFICATION_FAILED: /,
    );
    expect(pruned).toMatchObject({ compacted: 1 });
    expect(host.store.rows.has(`i:${handle}`)).toBe(false); // no restored pre-prune duplicate
    const archived = JSON.parse(host.archive.rows.get(`i:${handle}`)!);
    expect(archived).toMatchObject({ handle, state: 'blocked' });
    expect(archived.humanUrl).toBeUndefined();
    expect(JSON.stringify([...host.store.rows.values()])).not.toContain(HUMAN_URL);
  });
});
