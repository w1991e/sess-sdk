// RECIPE-BUDGET-LEDGER-01 (sess-sdk #71), stale-lock recovery: the deterministic two-contender
// interleavings over real filesystem operations. Two contenders read the same dead owner's lock and
// are paused before acting on it. One breaks and takes it; the other's token re-check under
// `<lock>.break` fails, so it neither breaks the replacement nor holds the lock at the same time.
// A release never removes another generation's lock. The same helper guards run.lock and
// spend-ledger.lock; the ledger case seeds US$99.90 and checks that no reservation is lost.
import { spawnSync } from 'node:child_process';
import {
  existsSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  utimesSync,
  writeFileSync,
} from 'node:fs';
import { hostname, tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/* eslint-disable @typescript-eslint/no-explicit-any */
type Any = any;
const RECIPES = fileURLToPath(new URL('../../examples/recipes/', import.meta.url));
const load = (path: string): Promise<Any> => import(join(RECIPES, path));
const scratch = (prefix: string) => realpathSync(mkdtempSync(join(realpathSync(tmpdir()), prefix)));

/** The token of a lock left by a process that has exited (its pid no longer runs). */
function deadToken() {
  const gone = spawnSync(process.execPath, ['-e', 'process.stdout.write(String(process.pid))'], {
    encoding: 'utf8',
  });
  return JSON.stringify({
    pid: Number(gone.stdout),
    host: hostname(),
    started: '2026-10-18T00:00:00.000Z',
    nonce: 'dead',
  });
}

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

/** Pauses both contenders after they read the stale token, then lets each go when told. */
function twoContenders() {
  const bothRead = deferred();
  let arrived = 0;
  const go = { A: deferred(), B: deferred() };
  const hooks = (who: 'A' | 'B') => ({
    afterStaleRead: async () => {
      if (++arrived === 2) bothRead.resolve();
      await bothRead.promise;
      await go[who].promise;
    },
  });
  return { bothRead: bothRead.promise, go, hooks };
}

describe('RECIPE-BUDGET-LEDGER-01: stale-lock recovery', { timeout: 30_000 }, () => {
  it('two contenders that read the same dead owner: one takes the lock, the other never breaks the replacement or holds it at the same time', async () => {
    const { acquireLock } = await load('harness.mjs');
    const path = join(scratch('sess-lock-'), 'spend-ledger.lock');
    writeFileSync(path, deadToken());
    const race = twoContenders();
    const a = acquireLock(path, { hooks: race.hooks('A') });
    let bHolds = false;
    const b = acquireLock(path, { waitMs: 10_000, hooks: race.hooks('B') }).then((lock: Any) => {
      bHolds = true;
      return lock;
    });
    await race.bothRead;
    race.go.A.resolve();
    const lockA = await a;
    expect(lockA).not.toBeNull();
    expect(readFileSync(path, 'utf8')).toBe(lockA.token);
    // B now acts on its earlier stale reading: its re-check under .break finds A's token.
    race.go.B.resolve();
    await new Promise((done) => setTimeout(done, 200));
    expect(bHolds).toBe(false);
    expect(readFileSync(path, 'utf8')).toBe(lockA.token); // A's live lock is untouched
    await lockA.release();
    const lockB = await b;
    expect(lockB).not.toBeNull();
    expect(readFileSync(path, 'utf8')).toBe(lockB.token);
    // A late or repeated release by A removes nothing of B's.
    await lockA.release();
    expect(readFileSync(path, 'utf8')).toBe(lockB.token);
    await lockB.release();
    expect(existsSync(path)).toBe(false);
    expect(existsSync(`${path}.break`)).toBe(false);
  });

  it("a release never removes another generation's lock", async () => {
    const { acquireLock } = await load('harness.mjs');
    const path = join(scratch('sess-lock-'), 'run.lock');
    const lockA = await acquireLock(path);
    const other = JSON.stringify({
      pid: process.pid,
      host: hostname(),
      started: 'x',
      nonce: 'another-generation',
    });
    writeFileSync(path, other); // the lock now belongs to someone else
    await lockA.release();
    expect(readFileSync(path, 'utf8')).toBe(other);
  });

  it('the one-run lock: two runs recovering the same dead run.lock, only one is admitted', async () => {
    const { openLedger } = await load('harness.mjs');
    const dir = scratch('sess-runlock-');
    writeFileSync(join(dir, 'run.lock'), deadToken());
    const race = twoContenders();
    const a = openLedger(dir, { hooks: race.hooks('A') }).lockRun();
    const b = openLedger(dir, { hooks: race.hooks('B') }).lockRun();
    await race.bothRead;
    race.go.A.resolve();
    const lockA = await a;
    race.go.B.resolve();
    expect(lockA).not.toBeNull();
    expect(await b).toBeNull(); // run in progress
    expect(readFileSync(join(dir, 'run.lock'), 'utf8')).toBe(lockA.token);
    await lockA.release();
  });

  it("the ledger: US$99.90 settled and a dead spend-ledger.lock; A takes over and pauses before its save; B cannot take A's lock or admit, and no reservation is lost", async () => {
    const { openLedger } = await load('harness.mjs');
    const dir = scratch('sess-ledger-stale-');
    writeFileSync(
      join(dir, 'spend-ledger.json'),
      JSON.stringify({
        schema: 'sess.recipe-spend-ledger/1',
        ceiling_usd: 100,
        runs: [{ id: 'seed', status: 'settled', provider: 'x', cost_usd: 99.9, max_cost_usd: 99.9 }],
      }),
    );
    writeFileSync(join(dir, 'spend-ledger.lock'), deadToken());
    const race = twoContenders();
    const saveA = deferred();
    const atSaveA = deferred();
    const ledgerA = openLedger(dir, {
      hooks: {
        ...race.hooks('A'),
        beforeSave: async () => {
          atSaveA.resolve();
          await saveA.promise;
        },
      },
    });
    const ledgerB = openLedger(dir, { hooks: race.hooks('B') });
    const run = { provider: 'openai', model: 'gpt-5.4-nano', scenario: 'happy_path', max_cost_usd: 0.064 };
    const a = ledgerA.admit(100, run);
    const b = ledgerB.admit(100, run);
    await race.bothRead;
    race.go.A.resolve();
    await atSaveA.promise; // A holds the lock, has loaded, and is about to save
    race.go.B.resolve(); // B acts on its stale reading now
    await new Promise((done) => setTimeout(done, 200));
    saveA.resolve();
    const [admittedA, admittedB] = await Promise.all([a, b]);
    expect(admittedA.entry).not.toBeNull();
    expect(admittedB.entry).toBeNull(); // B reloaded after A's save: 0.036 left
    const runs = JSON.parse(readFileSync(join(dir, 'spend-ledger.json'), 'utf8')).runs;
    expect(runs.map((r: Any) => r.id)).toEqual(['seed', admittedA.entry.id]);
    expect((await openLedger(dir).remaining(100)).spent).toBeCloseTo(99.964, 6);
    expect(existsSync(join(dir, 'spend-ledger.lock'))).toBe(false);
    expect(existsSync(join(dir, 'spend-ledger.lock.break'))).toBe(false);
  });

  it('a .break left by a process that has exited fails closed with the file to remove', async () => {
    const { acquireLock } = await load('harness.mjs');
    const path = join(scratch('sess-lock-'), 'spend-ledger.lock');
    writeFileSync(path, deadToken());
    writeFileSync(`${path}.break`, deadToken());
    await expect(acquireLock(path)).rejects.toThrow(
      /spend-ledger\.lock\.break was left by a process that has exited/,
    );
    expect(existsSync(path)).toBe(true); // nothing was broken
  });
});

describe('RECIPE-BUDGET-LEDGER-01: interrupted lock initialization', { timeout: 30_000 }, () => {
  it('a creator suspended before writing its token (temp file aged 31 s) leaves no lock to break: one handle at a time', async () => {
    const { acquireLock } = await load('harness.mjs');
    const dir = scratch('sess-lock-init-');
    const path = join(dir, 'spend-ledger.lock');
    const paused = deferred();
    const resume = deferred();
    let tmpOfA = '';
    const a = acquireLock(path, {
      waitMs: 10_000,
      hooks: {
        beforeTokenWrite: async (tmp: string) => {
          tmpOfA = tmp;
          const old = (Date.now() - 31_000) / 1000;
          utimesSync(tmp, old, old); // the suspended creator's file looks 31 s old
          paused.resolve();
          await resume.promise;
        },
      },
    });
    await paused.promise;
    // The lock pathname does not exist while A is suspended: nothing empty to judge stale.
    expect(existsSync(path)).toBe(false);
    let holders = 0;
    let most = 0;
    const hold = (lock: Any) => {
      if (lock) most = Math.max(most, ++holders);
      return lock;
    };
    const lockB = hold(await acquireLock(path));
    expect(lockB).not.toBeNull();
    // B's sweep did not take A's live temporary file, though it is 31 s old.
    expect(existsSync(tmpOfA)).toBe(true);
    resume.resolve(); // A writes its token and tries to publish: the lock exists, so it waits
    await new Promise((done) => setTimeout(done, 150));
    expect(readFileSync(path, 'utf8')).toBe(lockB.token);
    expect(most).toBe(1);
    holders--;
    await lockB.release();
    const lockA = hold(await a);
    expect(lockA).not.toBeNull();
    expect(readFileSync(path, 'utf8')).toBe(lockA.token);
    expect(most).toBe(1);
    await lockA.release();
    expect(readdirSync(dir)).toEqual([]); // no lock, .break or temporary file left
  });

  it('an empty or unparsable lock fails closed with the file to remove, and is not broken', async () => {
    const { acquireLock } = await load('harness.mjs');
    for (const content of ['', '{"pid":', 'not json']) {
      const path = join(scratch('sess-lock-corrupt-'), 'run.lock');
      writeFileSync(path, content);
      const old = (Date.now() - 31_000) / 1000;
      utimesSync(path, old, old);
      await expect(acquireLock(path)).rejects.toThrow(/run\.lock is empty or unreadable/);
      expect(readFileSync(path, 'utf8')).toBe(content);
    }
  });

  it('a left-over temporary file older than 30 s is removed only if its creator has exited', async () => {
    const { acquireLock } = await load('harness.mjs');
    const dir = scratch('sess-lock-sweep-');
    const path = join(dir, 'spend-ledger.lock');
    const deadPid = JSON.parse(deadToken()).pid;
    const old = (Date.now() - 31_000) / 1000;
    const deadTmp = join(dir, `spend-ledger.lock.tmp-${deadPid}-x`);
    const liveTmp = join(dir, `spend-ledger.lock.tmp-${process.pid}-y`);
    const recentDead = join(dir, `spend-ledger.lock.tmp-${deadPid}-z`);
    for (const f of [deadTmp, liveTmp, recentDead]) writeFileSync(f, '');
    utimesSync(deadTmp, old, old);
    utimesSync(liveTmp, old, old);
    const lock = await acquireLock(path);
    expect(existsSync(deadTmp)).toBe(false);
    expect(existsSync(liveTmp)).toBe(true);
    expect(existsSync(recentDead)).toBe(true);
    await lock.release();
  });
});
