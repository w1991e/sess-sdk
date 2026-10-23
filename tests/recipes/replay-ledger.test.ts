// Recipe repairs (sess-sdk #71), mocked only, on the real @sess.si/sdk client where Sess is
// involved: the synthetic Sess server of examples/recipes/dry-run.mjs signs receipts, checks
// If-Match and treats a repeated idempotency key with a different body as IDEMPOTENCY_CONFLICT.
// - RECIPE-PUBLISH-REPLAY-01: a mutation whose reply was lost is retried byte for byte.
// - RECIPE-BUDGET-LEDGER-01: the spend ledger is safe across processes, and one run at a time.
// - The free dry run (`qualify.mjs --dry-run`).
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, readdirSync, realpathSync, writeFileSync } from 'node:fs';
import { hostname, tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Sess } from '@sess.si/sdk';
import { describe, expect, it } from 'vitest';

/* eslint-disable @typescript-eslint/no-explicit-any */
type Any = any;
const RECIPES = fileURLToPath(new URL('../../examples/recipes/', import.meta.url));
const load = (path: string): Promise<Any> => import(join(RECIPES, path));
const KEY = 'sess-test-key';
const scratch = (prefix: string) => realpathSync(mkdtempSync(join(realpathSync(tmpdir()), prefix)));
const ledgerOf = (dir: string) => JSON.parse(readFileSync(join(dir, 'spend-ledger.json'), 'utf8'));
const recordsOf = (dir: string) =>
  readdirSync(dir)
    .filter((f) => f.endsWith('.json') && f !== 'spend-ledger.json')
    .map((f) => JSON.parse(readFileSync(join(dir, f), 'utf8')));

const slot = (id: string, temp: number) => ({
  id,
  name: id,
  covered: true,
  temp,
  rain: 0,
  wind: 3,
  line: `${temp} °C · dry · wind 3 m/s`,
});

/** The workflow on the real SDK against the synthetic server, SDK retries off so a lost reply surfaces. */
async function realFlow(loseReply: string[]) {
  const { syntheticSess, DRY_ANSWERS } = await load('dry-run.mjs');
  const { createWorkflow } = await load('workflow.mjs');
  const server = syntheticSess({ apiKey: KEY, answers: DRY_ANSWERS, loseReply });
  const sent: { method: string; path: string; key: string | null; ifMatch: string | null; body: string }[] =
    [];
  const fetch = async (input: Any, init?: Any) => {
    const request = new Request(input, init);
    if (request.method !== 'GET')
      sent.push({
        method: request.method,
        path: new URL(request.url).pathname,
        key: request.headers.get('idempotency-key'),
        ifMatch: request.headers.get('if-match'),
        body: await request.clone().text(),
      });
    return server.fetch(request);
  };
  let forecasts = 0;
  const flow = createWorkflow({
    sess: new Sess({ apiKey: KEY, fetch, maxRetries: 0 }),
    contact: 'https://example.com/c',
    showLink: () => {},
    // A second forecast would differ: a replay must never pick it up.
    weatherFor: async () => {
      const temp = forecasts++ === 0 ? 18 : 2;
      return {
        forecast: {},
        slots: [slot('morning', temp), slot('afternoon', temp), slot('evening', temp)],
        alerts: [],
      };
    },
    pollMs: 10_000,
  });
  return { flow, server, sent };
}
const writes = (sent: Any[], method: string, suffix = '') =>
  sent.filter((s) => s.method === method && s.path.endsWith(suffix));

describe(
  'RECIPE-PUBLISH-REPLAY-01: lost replies are retried with the identical request',
  { timeout: 30_000 },
  () => {
    it('a publish whose reply was lost is sent again byte for byte whatever the new intro, and succeeds; no new forecast can change it', async () => {
      const { flow, server, sent } = await realFlow(['publish']);
      const { session_id } = await flow.call('sess_ask', { intro: 'Where and when?' });
      await flow.call('sess_response', { session_id, revision: 1 });
      await flow.call('get_weather', { place: 'oslo', day: 'saturday' });
      const lost = await flow.call('sess_publish', { session_id, intro: 'First intro.' });
      expect(lost.error).toContain('calling it again sends the same request');
      expect(server.log.lost).toEqual(['publish']);
      // The model asks for a fresh forecast and writes a different intro.
      expect(await flow.call('get_weather', { place: 'oslo', day: 'saturday' })).toEqual({
        error: 'The plans are already on the link. Use them.',
      });
      const retried = await flow.call('sess_publish', { session_id, intro: 'A different intro.' });
      expect(retried).toMatchObject({ revision: 2, note: expect.stringContaining('sent again unchanged') });
      const [first, second] = writes(sent, 'PATCH');
      expect(second).toEqual(first); // body, If-Match and key, byte for byte
      expect(server.log).toMatchObject({ conflicts: 0, replays: 1 });
      expect(JSON.parse(first?.body ?? '{}').interaction.source.components[0].text).toBe('First intro.');
      // The person answers the question they saw; the plan reads its options and first forecast.
      await flow.call('sess_response', { session_id, revision: 2 });
      expect(await flow.call('sess_complete', { session_id })).toMatchObject({
        status: 'completed',
        weather: '18 °C · dry · wind 3 m/s',
      });
    });

    it('control: under the same key a different body is refused by the server, the failure the fix prevents', async () => {
      const { syntheticSess } = await load('dry-run.mjs');
      const server = syntheticSess({ apiKey: KEY, answers: [{}] });
      const sess = new Sess({ apiKey: KEY, fetch: server.fetch, maxRetries: 0 });
      const page = (text: string): Any => ({
        interaction: {
          mode: 'interactive',
          title: 'T',
          source: { kind: 'sess_surface', components: [{ type: 'text', text }] },
          actions: [{ id: 'go', label: 'Go' }],
        },
      });
      const created = await sess.sessions.create(page('first'));
      const reply = await sess.sessions.waitForResponse(created.data.id, { revision: 1, timeoutMs: 10_000 });
      const options = { ifMatch: reply.meta.etag, idempotencyKey: 'same-key' };
      await sess.sessions.publish(created.data.id, page('one'), options);
      const conflict = await sess.sessions
        .publish(created.data.id, page('two'), options)
        .catch((e: Any) => e);
      expect(conflict?.code).toBe('IDEMPOTENCY_CONFLICT');
    });

    it('a complete whose reply was lost is sent again with the same key and precondition and succeeds; a create is never repeated', async () => {
      const { flow, server, sent } = await realFlow(['complete']);
      const { session_id } = await flow.call('sess_ask', { intro: 'Where and when?' });
      await flow.call('sess_response', { session_id, revision: 1 });
      await flow.call('get_weather', { place: 'oslo', day: 'saturday' });
      await flow.call('sess_publish', { session_id, intro: 'Plans.' });
      await flow.call('sess_response', { session_id, revision: 2 });
      expect(await flow.call('sess_complete', { session_id })).toHaveProperty('error');
      expect(await flow.call('sess_complete', { session_id })).toMatchObject({ status: 'completed' });
      const posts = writes(sent, 'POST', '/complete');
      expect(posts).toHaveLength(2);
      expect(posts[1]).toEqual(posts[0]);
      expect(server.log).toMatchObject({ conflicts: 0, replays: 1, lost: ['complete'] });
      expect(writes(sent, 'POST', '/v1/sessions')).toHaveLength(1);
    });
  },
);

describe('RECIPE-BUDGET-LEDGER-01: the ledger across processes', { timeout: 30_000 }, () => {
  const seed = (dir: string, runs: Any[]) =>
    writeFileSync(
      join(dir, 'spend-ledger.json'),
      JSON.stringify({ schema: 'sess.recipe-spend-ledger/1', ceiling_usd: 100, runs }),
    );
  const run = (max: number) => ({
    provider: 'openai',
    model: 'gpt-5.4-nano',
    scenario: 'happy_path',
    max_cost_usd: max,
  });

  it('two handles opened before either reserves (seeded US$99.90): the second admission sees the first and is refused, and no entry is lost', async () => {
    const { openLedger } = await load('harness.mjs');
    const dir = scratch('sess-ledger-race-');
    seed(dir, [{ id: 'seed', status: 'settled', provider: 'x', cost_usd: 99.9, max_cost_usd: 99.9 }]);
    const a = openLedger(dir);
    const b = openLedger(dir);
    const first = await a.admit(100, run(0.064));
    const second = await b.admit(100, run(0.064));
    expect(first.entry).not.toBeNull();
    expect(second.entry).toBeNull(); // 99.90 + 0.064 leaves 0.036, less than 0.064
    expect(ledgerOf(dir).runs.map((r: Any) => r.id)).toEqual(['seed', first.entry.id]);
    expect((await openLedger(dir).remaining(100)).spent).toBeCloseTo(99.964, 6);
  });

  it('concurrent admissions and settlements each apply to the latest ledger: nothing is lost, and a stale settlement erases no other run', async () => {
    const { openLedger } = await load('harness.mjs');
    const dir = scratch('sess-ledger-race-');
    const handles = Array.from({ length: 8 }, () => openLedger(dir));
    const admitted = await Promise.all(handles.map((h) => h.admit(15, run(0.1))));
    expect(admitted.every((x: Any) => x.entry)).toBe(true);
    expect(ledgerOf(dir).runs).toHaveLength(8);
    await Promise.all(
      handles.map((h, i) => h.settle(admitted[i].entry.id, { estimated_total_usd: 0.01, record: null })),
    );
    const runs = ledgerOf(dir).runs;
    expect(runs).toHaveLength(8);
    expect(
      runs.every((r: Any) => r.status === 'settled' && r.estimated_total_usd === 0.01 && r.cost_usd === 0.01),
    ).toBe(true);
    // A crashed run's reservation (never settled) survives another run's settlement.
    const crashed = await handles[0].admit(15, run(1));
    const other = await handles[1].admit(15, run(0.5));
    await handles[1].settle(other.entry.id, { estimated_total_usd: 0.2, record: null });
    expect(ledgerOf(dir).runs.find((r: Any) => r.id === crashed.entry.id)).toMatchObject({
      status: 'reserved',
      max_cost_usd: 1,
    });
    expect(existsSync(join(dir, 'spend-ledger.lock'))).toBe(false);
  });

  it('refuses a second concurrent run; a lock left by a process that has exited is taken over and released at the end', async () => {
    const { dryRun } = await load('qualify.mjs');
    const dir = scratch('sess-ledger-run-');
    const quiet = { out: dir, Sess, sdkVersion: '0.1.0-rc.8', env: {}, stdout: () => {}, stderr: () => {} };
    writeFileSync(join(dir, 'run.lock'), JSON.stringify({ pid: process.pid, host: hostname() }));
    expect(await dryRun('anthropic', quiet)).toEqual({ ok: false, code: 'run_in_progress' });
    const gone = spawnSync(process.execPath, ['-e', 'process.stdout.write(String(process.pid))'], {
      encoding: 'utf8',
    });
    writeFileSync(join(dir, 'run.lock'), JSON.stringify({ pid: Number(gone.stdout), host: hostname() }));
    expect(await dryRun('anthropic', quiet)).toMatchObject({ ok: true, code: 'completed' });
    expect(existsSync(join(dir, 'run.lock'))).toBe(false);
  });
});

describe('qualify.mjs --dry-run (free pre-flight)', { timeout: 30_000 }, () => {
  it('runs the scenario on the real SDK client against simulations, with its own ledger and a record that proves nothing about the provider', async () => {
    const { dryRun } = await load('qualify.mjs');
    const dir = scratch('sess-dryrun-');
    const out: string[] = [];
    const result = await dryRun('gemini', {
      out: dir,
      Sess,
      sdkVersion: '0.1.0-rc.8',
      env: {},
      stdout: (line: string) => out.push(line),
      stderr: () => {},
    });
    expect(result).toMatchObject({ ok: true, code: 'completed' });
    const text = out.join('\n');
    expect(text).toContain(
      'DRY RUN: the model provider, the Sess API, the person and the weather are simulated.',
    );
    expect(text).toContain('budget after the run: US$0.0079 spent');
    const [record] = recordsOf(dir);
    expect(record).toMatchObject({
      dry_run: true,
      simulated: ['model provider', 'Sess API', 'the person', 'weather'],
      provider: 'gemini',
      model_requested: 'gemini-3.8-flash',
      outcome: 'completed',
      proved: [],
      estimated_total_usd: 0.007875,
      billed_usd: null,
      billed_source: 'dry run: nothing is sent or billed',
      max_cost_usd: 0.135,
    });
    expect(record.proved_in_simulation).toEqual(
      expect.arrayContaining(['receipt_verified', 'second_receipt_verified']),
    );
    // The fixed forecast is never named as live weather.
    expect(record.proved_in_simulation).toContain('weather_used (simulated)');
    expect(record.proved_in_simulation).not.toContain('live_weather_used');
    expect(record.not_proved).toHaveLength(13);
    expect(record.recipe.git_sha).toMatch(/^[0-9a-f]{40}$/);
    expect(ledgerOf(dir).runs).toHaveLength(1);
  });
});

describe('the recipe commit in every record', { timeout: 30_000 }, () => {
  const git = (cwd: string, ...args: string[]) => {
    const r = spawnSync(
      'git',
      ['-c', 'user.name=t', '-c', 'user.email=t@example.com', '-c', 'commit.gpgsign=false', ...args],
      { cwd, encoding: 'utf8' },
    );
    if (r.status !== 0) throw new Error(`git ${args[0]} failed`);
    return r.stdout.trim();
  };

  it('is read in a detached-HEAD checkout and in a detached worktree, by git and from the git files alike', async () => {
    const { gitState, readGitHead } = await load('harness.mjs');
    const repo = scratch('sess-git-');
    git(repo, 'init', '-q');
    writeFileSync(join(repo, 'a.txt'), 'a');
    git(repo, 'add', 'a.txt');
    git(repo, 'commit', '-q', '-m', 'a');
    const sha = git(repo, 'rev-parse', 'HEAD');
    git(repo, 'checkout', '-q', '--detach');
    expect(gitState(repo)).toEqual({ git_sha: sha, dirty: false, sha_source: 'git' });
    expect(readGitHead(repo)).toBe(sha);
    const worktree = join(scratch('sess-git-wt-'), 'wt');
    git(repo, 'worktree', 'add', '-q', '--detach', worktree, sha);
    expect(gitState(worktree)).toMatchObject({ git_sha: sha, dirty: false });
    expect(readGitHead(worktree)).toBe(sha); // through the worktree's .git file
    writeFileSync(join(worktree, 'b.txt'), 'b');
    expect(gitState(worktree).dirty).toBe(true);
    // On a branch: the loose ref, then the packed ref.
    git(repo, 'checkout', '-q', '-b', 'topic');
    expect(readGitHead(repo)).toBe(sha);
    git(repo, 'pack-refs', '--all');
    expect(readGitHead(repo)).toBe(sha);
    expect(readGitHead(scratch('sess-no-git-'))).toBeNull();
  });

  it('a real run whose recipe commit cannot be determined is refused before anything is reserved or sent; a dry run still runs', async () => {
    const { runRecipe } = await load('harness.mjs');
    const recipe = await load('anthropic/agent.mjs');
    const dir = scratch('sess-nosha-');
    const err: string[] = [];
    let sent = 0;
    const result = await runRecipe(recipe.PROVIDER, recipe.plan, {
      env: {
        SESS_API_KEY: KEY,
        ANTHROPIC_API_KEY: 'provider-test-key',
        SESS_DEMO_CONTACT: 'https://example.com/c',
      },
      qualify: true,
      out: dir,
      gitState: { git_sha: null, dirty: null, sha_source: null },
      guard: { fetch: async () => (sent++, new Response('{}')) },
      stdout: () => {},
      stderr: (line: string) => err.push(line),
    });
    expect(result).toEqual({ ok: false, code: 'recipe_sha_unknown' });
    expect(err.join('\n')).toContain('git rev-parse HEAD');
    expect(sent).toBe(0);
    expect(existsSync(join(dir, 'spend-ledger.json'))).toBe(false);
    const { dryRun } = await load('qualify.mjs');
    const dry = await dryRun('gemini', {
      out: scratch('sess-nosha-dry-'),
      Sess,
      sdkVersion: '0.1.0-rc.8',
      env: {},
      gitState: { git_sha: null, dirty: null, sha_source: null },
      stdout: () => {},
      stderr: () => {},
    });
    expect(dry).toMatchObject({ ok: true, code: 'completed' });
  });
});
