// Billed and estimated spend, reported separately (founder: "Report billed and estimated spend
// separately from now on"). Mocked only. A record carries usage_cost_usd (reported usage × rates,
// null if no attempt reported usage), ceiling_reserved_usd (attempts charged at their ceiling),
// estimated_total_usd (their sum; the cap and the ledger use it) and billed_usd with billed_source
// (a free provider readback where an ordinary key has one: OpenRouter GET /api/v1/key; otherwise
// null, "not available with this key (provider console)"). Older ledger entries (cost_usd only)
// still count.
import { mkdtempSync, readdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Sess } from '@sess.si/sdk';
import { describe, expect, it } from 'vitest';

/* eslint-disable @typescript-eslint/no-explicit-any */
type Any = any;
const RECIPES = fileURLToPath(new URL('../../examples/recipes/', import.meta.url));
const load = (path: string): Promise<Any> => import(join(RECIPES, path));
const scratch = (prefix: string) => realpathSync(mkdtempSync(join(realpathSync(tmpdir()), prefix)));
const SESS_KEY = 'sess-test-key';
const MODEL_KEY = 'provider-test-key';

/** A real (non-dry) qualification run with every outside party mocked. */
async function qualify(
  id: string,
  opts: { model?: (url: string, init: Any) => Promise<Response> | null; billing?: Any } = {},
) {
  const { runRecipe } = await load('harness.mjs');
  const { syntheticSess, scriptedProvider, dryWeather, DRY_ANSWERS } = await load('dry-run.mjs');
  const recipe = await load(`${id}/agent.mjs`);
  const server = syntheticSess({ apiKey: SESS_KEY, answers: DRY_ANSWERS });
  const scripted = scriptedProvider(id);
  const dir = scratch('sess-spend-');
  const out: string[] = [];
  const billingCalls: { url: string; auth: string | undefined }[] = [];
  const result = await runRecipe(recipe.PROVIDER, recipe.plan, {
    env: {
      SESS_API_KEY: SESS_KEY,
      [recipe.PROVIDER.keyEnv]: MODEL_KEY,
      SESS_DEMO_CONTACT: 'https://example.com/c',
    },
    qualify: true,
    out: dir,
    Sess,
    sessOptions: { fetch: server.fetch },
    guard: {
      fetch: async (url: string, init: Any) => (await opts.model?.(url, init)) ?? scripted.fetch(url, init),
      sleep: async () => {},
    },
    workflow: { weatherFor: dryWeather, showLink: () => {} },
    sdkVersion: '0.1.0-rc.7',
    billingSettleMs: 0,
    billingFetch: async (url: string, init: Any) => {
      billingCalls.push({ url, auth: init?.headers?.authorization });
      return opts.billing ? opts.billing() : new Response('{}', { status: 500 });
    },
    stdout: (line: string) => out.push(line),
    stderr: (line: string) => out.push(line),
  });
  const record = readdirSync(dir)
    .filter((f) => f.startsWith(`${id}-`))
    .map((f) => JSON.parse(readFileSync(join(dir, f), 'utf8')))[0];
  const ledger = JSON.parse(readFileSync(join(dir, 'spend-ledger.json'), 'utf8'));
  return { result, record, ledger, out: out.join('\n'), billingCalls };
}

describe('billed and estimated spend, separately', { timeout: 30_000 }, () => {
  it('reported usage: usage cost is the estimate, no ceiling, and billed is not available for this provider', async () => {
    const { record, ledger, out, billingCalls } = await qualify('anthropic');
    // 7 calls × (1,000 in, 100 out) at 0.10 / 0.50 per million.
    expect(record).toMatchObject({
      schema: 'sess.recipe-qualification/3',
      usage_reported: { input_tokens: 7000, output_tokens: 700, attempts: 7 },
      usage_at_ceiling: { input_tokens: 0, output_tokens: 0, attempts: 0 },
      usage_cost_usd: 0.00105,
      ceiling_reserved_usd: 0,
      estimated_total_usd: 0.00105,
      billed_usd: null,
      billed_source: 'not available with this key (provider console)',
    });
    expect(record).not.toHaveProperty('cost_usd');
    expect(billingCalls).toEqual([]);
    expect(ledger.runs[0]).toMatchObject({
      estimated_total_usd: 0.00105,
      cost_usd: 0.00105,
      billed_usd: null,
    });
    expect(record).toMatchObject({ booked_usd: 0.00105, billed_reconciliation: 'unreconciled_unknown' });
    expect(ledger.runs[0]).toMatchObject({ booked_usd: 0.00105 });
    expect(out).toContain('estimate: US$0.0010 (reported usage × published rates)');
    expect(out).toContain('reservation: US$0.0010 booked against the cap (charged at ceiling US$0.0000; US$');
    expect(out).toContain(
      'provider charge: unknown (not available with this key (provider console); unreconciled_unknown)',
    );
    // Unknown billing is never shown or recorded as zero.
    expect(out).not.toMatch(/provider charge: US\$0\.0000/);
    expect(record.billed_usd).toBeNull();
  });

  it('a failure without reported usage: usage cost is null, the ceiling is the whole estimate', async () => {
    let sentBytes = 0;
    const { result, record, out } = await qualify('anthropic', {
      model: (_url, init) => {
        sentBytes = Buffer.byteLength(init.body);
        return Promise.resolve(
          new Response(JSON.stringify({ error: { type: 'invalid_request_error' } }), { status: 400 }),
        );
      },
    });
    expect(result).toMatchObject({ ok: false, code: 'provider_failed' });
    const input = sentBytes + 1000;
    expect(record).toMatchObject({
      usage_reported: { attempts: 0 },
      usage_at_ceiling: { input_tokens: input, output_tokens: 2000, attempts: 1 },
      usage_cost_usd: null,
      ceiling_reserved_usd: Number(((input * 0.1 + 2000 * 0.5) / 1e6).toFixed(6)),
      estimated_total_usd: Number(((input * 0.1 + 2000 * 0.5) / 1e6).toFixed(6)),
      billed_usd: null,
    });
    expect(out).toContain('estimate: unknown (the provider reported no usage)');
    expect(out).toContain('reservation: US$');
    expect(record.booked_usd).toBe(record.ceiling_reserved_usd);
    expect(out).toContain('(400 invalid_request_error)');
  });

  it("OpenRouter: the key counter's change is a diagnostic only; the run's provider charge stays unknown, read with the key in the header only and never printed", async () => {
    const reads = [3.5, 3.50061];
    const { record, ledger, out, billingCalls } = await qualify('openrouter', {
      billing: () =>
        new Response(JSON.stringify({ data: { usage: reads.shift(), label: 'sk-or-v1-abc...xyz' } }), {
          status: 200,
        }),
    });
    expect(billingCalls).toEqual([
      { url: 'https://openrouter.ai/api/v1/key', auth: `Bearer ${MODEL_KEY}` },
      { url: 'https://openrouter.ai/api/v1/key', auth: `Bearer ${MODEL_KEY}` },
    ]);
    expect(record).toMatchObject({
      usage_cost_usd: 0.00105,
      estimated_total_usd: 0.00105,
      billed_usd: null,
      billed_source:
        'not attributable to this run (OpenRouter GET /api/v1/key usage is a cumulative key counter)',
      key_usage_delta_usd: 0.00061,
      booked_usd: 0.00105,
      billed_reconciliation: 'unreconciled_key_counter_only',
    });
    expect(ledger.runs[0]).toMatchObject({
      billed_usd: null,
      booked_usd: 0.00105,
      estimated_total_usd: 0.00105,
    });
    expect(out).toContain('provider charge: unknown (not attributable to this run');
    expect(out).toContain('key usage change during the run: US$0.0006 (diagnostic only');
    expect(out).not.toMatch(/provider charge: US\$/);
    expect(out).not.toContain(MODEL_KEY);
    expect(JSON.stringify(record)).not.toContain(MODEL_KEY);
  });

  for (const [name, reads, delta] of [
    ['delayed accounting (the counter has not moved yet)', [10, 10], 0],
    ['a decreasing counter', [10, 9.5], -0.5],
    ['unrelated use of the same key during the run', [1, 1.01], 0.01],
  ] as const) {
    it(`OpenRouter, ${name}: never a zero or attributed charge; the estimate alone is booked`, async () => {
      const queue = [...reads];
      const { record, ledger, out } = await qualify('openrouter', {
        billing: () => new Response(JSON.stringify({ data: { usage: queue.shift() } }), { status: 200 }),
      });
      expect(record).toMatchObject({
        billed_usd: null,
        key_usage_delta_usd: delta,
        estimated_total_usd: 0.00105,
        booked_usd: 0.00105,
        billed_reconciliation: 'unreconciled_key_counter_only',
      });
      expect(ledger.runs[0]).toMatchObject({ booked_usd: 0.00105, cost_usd: 0.00105, billed_usd: null });
      expect(out).toContain('provider charge: unknown');
      expect(out).not.toMatch(/provider charge: US\$/);
    });
  }

  it('OpenRouter readback failure: billed is null with the reason; the estimate still settles the ledger', async () => {
    const { record, ledger } = await qualify('openrouter', {
      billing: () => new Response('{}', { status: 401 }),
    });
    expect(record).toMatchObject({
      billed_usd: null,
      billed_source: 'readback failed (OpenRouter GET /api/v1/key usage)',
      estimated_total_usd: 0.00105,
    });
    expect(ledger.runs[0]).toMatchObject({ status: 'settled', estimated_total_usd: 0.00105 });
  });

  it('migration: ledger entries from before the split (cost_usd only) still count at their cost', async () => {
    const { openLedger } = await load('harness.mjs');
    const dir = scratch('sess-spend-migrate-');
    writeFileSync(
      join(dir, 'spend-ledger.json'),
      JSON.stringify({
        schema: 'sess.recipe-spend-ledger/1',
        ceiling_usd: 100,
        runs: [
          { id: 'old', status: 'settled', provider: 'gemini', cost_usd: 0.001158, max_cost_usd: 0.016 },
          {
            id: 'new',
            status: 'settled',
            provider: 'x',
            estimated_total_usd: 0.5,
            cost_usd: 0.5,
            max_cost_usd: 1,
          },
          {
            id: 'booked',
            status: 'settled',
            provider: 'openrouter',
            estimated_total_usd: 0.001,
            booked_usd: 0.01,
            cost_usd: 0.01,
            max_cost_usd: 0.02,
          },
          { id: 'open', status: 'reserved', provider: 'y', cost_usd: null, max_cost_usd: 2 },
        ],
      }),
    );
    expect((await openLedger(dir).remaining(15)).spent).toBeCloseTo(0.001158 + 0.5 + 0.01 + 2, 9);
  });
});
