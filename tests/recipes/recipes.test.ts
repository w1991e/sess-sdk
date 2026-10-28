// Mocked-provider tests of the provider recipes (examples/recipes): deterministic plumbing only,
// never a real model call. Each provider's own wire format is mocked: its tool declarations, its
// tool-call ids and the reasoning context it must get back, its usage fields and model id. The
// Sess side is a fake client and the weather a fixed forecast. Also: the per-run limits (every
// request and attempt counted), the spend guard and its ledger, the qualification record (what
// was proved, no key or private link), the weekly check and the Keychain wrapper (with a fake
// `security` command).
import { spawnSync } from 'node:child_process';
import {
  chmodSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/* eslint-disable @typescript-eslint/no-explicit-any */
type Any = any;
const RECIPES = fileURLToPath(new URL('../../examples/recipes/', import.meta.url));
const load = (path: string): Promise<Any> => import(join(RECIPES, path));

const SESS_KEY = 'sess-test-key';
const MODEL_KEY = 'provider-test-key';
const LINK = `https://app.sess.si/s/${'L'.repeat(43)}`;
const ANSWERS: Record<number, Record<string, string>> = {
  1: { place: 'oslo', day: 'saturday' },
  2: { choice: 'option_1', time: 'evening' },
};
const KEY_ENV: Record<string, string> = {
  openai: 'OPENAI_API_KEY',
  anthropic: 'ANTHROPIC_API_KEY',
  gemini: 'GEMINI_API_KEY',
  xai: 'XAI_API_KEY',
  meta: 'META_API_KEY',
  openrouter: 'OPENROUTER_API_KEY',
};
const DEFAULT_MODEL: Record<string, string> = {
  openai: 'gpt-5.4-nano',
  anthropic: 'claude-haiku-5-5',
  gemini: 'gemini-3.8-flash',
  xai: 'grok-4.3',
  meta: 'muse-spark-1.3',
  openrouter: 'anthropic/claude-haiku-5.5',
};

const scratch = (prefix: string) => realpathSync(mkdtempSync(join(realpathSync(tmpdir()), prefix)));

/** A fake Sess client: one Session, answers per revision after `timeouts` empty waits. */
function fakeSess(timeouts = 0) {
  const log = {
    creates: 0,
    interactions: [] as Any[],
    publishes: [] as Any[],
    completes: [] as Any[],
    answered: new Set<number>(),
    waits: 0,
  };
  let left = timeouts;
  const client = {
    sessions: {
      async create(body: Any) {
        log.creates++;
        log.interactions.push(body.interaction);
        return { data: { id: 'ses_1', revision: 1, human_url: LINK }, meta: { etag: '"1-active"' } };
      },
      async waitForResponse(_id: string, { revision }: { revision: number }) {
        log.waits++;
        if (left > 0) {
          left--;
          throw Object.assign(new Error('Human wait timed out.'), { code: 'WAIT_TIMEOUT' });
        }
        log.answered.add(revision);
        return { response: { revision, data: ANSWERS[revision] }, meta: { etag: `"${revision}-responded"` } };
      },
      async publish(_id: string, body: Any, options: Any) {
        log.interactions.push(body.interaction);
        log.publishes.push(options);
        return { data: { revision: 2 } };
      },
      async complete(_id: string, options: Any) {
        log.completes.push(options);
        return { data: { status: 'completed' } };
      },
    },
    receipts: { verifyResponse: async ({ response }: Any) => ({ response }) },
  };
  return {
    log,
    Sess: class {
      constructor() {
        return client;
      }
    },
  };
}

const slot = (id: string, name: string) => ({
  id,
  name,
  covered: true,
  temp: 18,
  rain: 0,
  wind: 3,
  line: '18 °C · dry · wind 3 m/s',
});
const weatherFor = async () => ({
  forecast: { properties: {} },
  slots: [slot('morning', 'Morning'), slot('afternoon', 'Afternoon'), slot('evening', 'Evening')],
  alerts: [],
});

/** The scripted model: the next tool call, given what the fake Sess has answered so far. */
function scriptedModel(log: ReturnType<typeof fakeSess>['log']) {
  let step = 0;
  const calls: [string, Any][] = [
    ['sess_ask', { intro: 'Tell me where and when.' }],
    ['sess_response', { session_id: 'ses_1', revision: 1 }],
    ['get_weather', { place: 'oslo', day: 'saturday' }],
    ['sess_publish', { session_id: 'ses_1', intro: 'Here are three plans.' }],
    ['sess_response', { session_id: 'ses_1', revision: 2 }],
    ['sess_complete', { session_id: 'ses_1' }],
  ];
  return () => {
    // A sess_response that came back waiting is asked again (the resume).
    const previous = calls[step - 1];
    if (previous?.[0] === 'sess_response' && !log.answered.has(previous[1].revision)) return previous;
    return calls[step++] ?? null;
  };
}

interface Seen {
  url: string;
  headers: Record<string, string>;
  body: Any;
}
type Reply = (next: [string, Any] | null, i: number, model: string) => Any;

/** A provider mock: each request is recorded; `refuse(body)` may answer a status instead. */
function mockFetch(reply: Reply, next: () => [string, Any] | null, refuse?: (body: Any) => number | null) {
  const seen: Seen[] = [];
  let answered = 0;
  const fetch = async (url: string, init: Any) => {
    const body = JSON.parse(init.body);
    seen.push({ url, headers: init.headers, body });
    const status = refuse?.(body);
    if (status) return new Response('{"error":{"message":"no such model"}}', { status });
    const modelId = String(body.model ?? url.split('/models/')[1]?.split(':')[0]);
    return new Response(JSON.stringify(reply(next(), answered++, modelId)), { status: 200 });
  };
  return { seen, fetch };
}

const FINAL = 'Your plan: a walk on Saturday evening in Oslo.';
const REPLIES: Record<string, Reply> = {
  openai: (next, i, model) => ({
    id: `resp_${i}`,
    model: `${model}-2026-08-01`,
    status: 'completed',
    usage: { input_tokens: 1000, output_tokens: 100 },
    output: next
      ? [
          { type: 'reasoning', id: `rs_${i}`, encrypted_content: `enc_${i}`, summary: [] },
          {
            type: 'function_call',
            id: `fc_${i}`,
            call_id: `call_${i}`,
            name: next[0],
            arguments: JSON.stringify(next[1]),
          },
        ]
      : [{ type: 'message', role: 'assistant', content: [{ type: 'output_text', text: FINAL }] }],
  }),
  anthropic: (next, i, model) => ({
    id: `msg_${i}`,
    model: `${model}-20261001`,
    usage: { input_tokens: 900, cache_read_input_tokens: 100, output_tokens: 100 },
    stop_reason: next ? 'tool_use' : 'end_turn',
    content: next
      ? [
          { type: 'thinking', thinking: 'plan', signature: `sig_${i}` },
          { type: 'tool_use', id: `toolu_${i}`, name: next[0], input: next[1] },
        ]
      : [{ type: 'text', text: FINAL }],
  }),
  gemini: (next, i, model) => ({
    modelVersion: `${model}-001`,
    usageMetadata: { promptTokenCount: 1000, candidatesTokenCount: 60, thoughtsTokenCount: 40 },
    candidates: [
      {
        finishReason: 'STOP',
        content: {
          role: 'model',
          parts: next
            ? [{ functionCall: { id: `fc_${i}`, name: next[0], args: next[1] }, thoughtSignature: `ts_${i}` }]
            : [{ text: FINAL }],
        },
      },
    ],
  }),
  xai: (next, i, model) => ({
    id: `resp_${i}`,
    model,
    status: 'completed',
    usage: { input_tokens: 1000, output_tokens: 100 },
    output: next
      ? [{ type: 'function_call', call_id: `call_${i}`, name: next[0], arguments: JSON.stringify(next[1]) }]
      : [{ type: 'message', content: [{ type: 'output_text', text: FINAL }] }],
  }),
  openrouter: (next, i, model) => ({
    model,
    usage: { prompt_tokens: 1000, completion_tokens: 100 },
    choices: [
      {
        finish_reason: next ? 'tool_calls' : 'stop',
        message: next
          ? {
              role: 'assistant',
              content: null,
              tool_calls: [
                {
                  id: `call_${i}`,
                  type: 'function',
                  function: { name: next[0], arguments: JSON.stringify(next[1]) },
                },
              ],
              reasoning_details: [{ type: 'reasoning.encrypted', data: `rd_${i}` }],
            }
          : { role: 'assistant', content: FINAL },
      },
    ],
  }),
};
REPLIES.meta = REPLIES.xai as Reply;

/** What each provider must send back on request `i` (> 0), about request `i - 1`. */
const CARRIES: Record<string, (seen: Seen, i: number) => void> = {
  openai(s, i) {
    expect(s.url).toBe('https://api.openai.com/v1/responses');
    expect(s.headers.authorization).toBe(`Bearer ${MODEL_KEY}`);
    expect(s.body).toMatchObject({
      model: 'gpt-5.4-nano',
      store: false,
      include: ['reasoning.encrypted_content'],
      max_output_tokens: 2000,
    });
    expect(s.body.tools[0]).toMatchObject({
      type: 'function',
      name: 'sess_ask',
      parameters: { type: 'object' },
    });
    expect(s.body.input).toContainEqual(
      expect.objectContaining({ type: 'reasoning', encrypted_content: `enc_${i - 1}` }),
    );
    expect(s.body.input).toContainEqual(
      expect.objectContaining({ type: 'function_call_output', call_id: `call_${i - 1}` }),
    );
  },
  anthropic(s, i) {
    expect(s.url).toBe('https://api.anthropic.com/v1/messages');
    expect(s.headers['x-api-key']).toBe(MODEL_KEY);
    expect(s.headers['anthropic-version']).toBe('2023-06-01');
    expect(s.body).toMatchObject({ model: 'claude-haiku-5-5', max_tokens: 2000 });
    expect(s.body.tools[0]).toMatchObject({ name: 'sess_ask', input_schema: { type: 'object' } });
    const assistant = s.body.messages.at(-2);
    expect(assistant.content).toContainEqual(
      expect.objectContaining({ type: 'thinking', signature: `sig_${i - 1}` }),
    );
    expect(s.body.messages.at(-1).content[0]).toMatchObject({
      type: 'tool_result',
      tool_use_id: `toolu_${i - 1}`,
    });
  },
  gemini(s, i) {
    expect(s.url).toBe(
      'https://generativelanguage.googleapis.com/v1beta/models/gemini-3.8-flash:generateContent',
    );
    expect(s.headers['x-goog-api-key']).toBe(MODEL_KEY);
    expect(s.body.generationConfig).toEqual({
      maxOutputTokens: 2000,
      thinkingConfig: { thinkingLevel: 'low' },
    });
    expect(s.body.tools[0].functionDeclarations[0]).toMatchObject({ name: 'sess_ask' });
    const model = s.body.contents.at(-2);
    expect(model.parts[0]).toMatchObject({ thoughtSignature: `ts_${i - 1}` });
    expect(s.body.contents.at(-1).parts[0].functionResponse).toMatchObject({ id: `fc_${i - 1}` });
  },
  xai(s, i) {
    expect(s.url).toBe('https://api.x.ai/v1/responses');
    expect(s.headers.authorization).toBe(`Bearer ${MODEL_KEY}`);
    expect(s.body).toMatchObject({
      model: 'grok-4.3',
      max_output_tokens: 2000,
      previous_response_id: `resp_${i - 1}`,
    });
    expect(s.body.input).toEqual([
      expect.objectContaining({ type: 'function_call_output', call_id: `call_${i - 1}` }),
    ]);
  },
  meta(s, i) {
    expect(s.url).toBe('https://api.meta.ai/v1/responses');
    expect(s.headers.authorization).toBe(`Bearer ${MODEL_KEY}`);
    expect(s.body).toMatchObject({
      model: 'muse-spark-1.3',
      max_output_tokens: 2000,
      previous_response_id: `resp_${i - 1}`,
    });
    expect(s.body.input).toEqual([
      expect.objectContaining({ type: 'function_call_output', call_id: `call_${i - 1}` }),
    ]);
  },
  openrouter(s, i) {
    expect(s.url).toBe('https://openrouter.ai/api/v1/chat/completions');
    expect(s.headers.authorization).toBe(`Bearer ${MODEL_KEY}`);
    expect(s.body).toMatchObject({ model: 'anthropic/claude-haiku-5.5', max_tokens: 2000 });
    expect(s.body.tools[0]).toMatchObject({ type: 'function', function: { name: 'sess_ask' } });
    expect(s.body.messages.at(-2)).toMatchObject({
      role: 'assistant',
      reasoning_details: [{ data: `rd_${i - 1}` }],
    });
    expect(s.body.messages.at(-1)).toMatchObject({ role: 'tool', tool_call_id: `call_${i - 1}` });
  },
};

/** OpenRouter's GET /api/v1/key, mocked: usage 1.25 before the run, 1.2512 after. */
function billingMock() {
  const reads = [1.25, 1.2512];
  return async (url: string) => {
    expect(url).toBe('https://openrouter.ai/api/v1/key');
    return new Response(JSON.stringify({ data: { usage: reads.shift() } }), { status: 200 });
  };
}

interface RunOptions {
  timeouts?: number;
  env?: Record<string, string | undefined>;
  dir?: string;
  refuse?: (body: Any) => number | null;
  extra?: Record<string, unknown>;
}

async function runProvider(id: string, { timeouts = 0, env = {}, dir, refuse, extra = {} }: RunOptions = {}) {
  const recipe = await load(`${id}/agent.mjs`);
  const { runRecipe } = await load('harness.mjs');
  const sess = fakeSess(timeouts);
  const model = mockFetch(REPLIES[id] as Reply, scriptedModel(sess.log), refuse);
  const out: string[] = [];
  const err: string[] = [];
  const outDir = dir ?? scratch('sess-recipe-');
  const result = await runRecipe(recipe.PROVIDER, recipe.plan, {
    env: {
      SESS_API_KEY: SESS_KEY,
      [KEY_ENV[id] as string]: MODEL_KEY,
      SESS_DEMO_CONTACT: 'https://example.com/contact',
      ...env,
    },
    Sess: sess.Sess,
    guard: { fetch: model.fetch, sleep: async () => {} },
    // OpenRouter's billed readback, mocked: the key's usage before and after the run.
    billingFetch: billingMock(),
    billingSettleMs: 0,
    workflow: { weatherFor, pollMs: 10 },
    qualify: true,
    sdkVersion: '0.1.0-rc.9',
    scenario: timeouts ? 'timeout_resume' : 'happy_path',
    out: outDir,
    stdout: (line: string) => out.push(line),
    stderr: (line: string) => err.push(line),
    ...extra,
  });
  return { result, sess, model, out: out.join('\n'), err: err.join('\n'), dir: outDir, recipe };
}

const records = (dir: string) =>
  readdirSync(dir)
    .filter((f) => f !== 'spend-ledger.json')
    .map((f) => JSON.parse(readFileSync(join(dir, f), 'utf8')));
const ledgerOf = (dir: string) => JSON.parse(readFileSync(join(dir, 'spend-ledger.json'), 'utf8'));

describe('provider recipes (mocked providers)', () => {
  for (const id of Object.keys(KEY_ENV)) {
    it(`${id}: runs the planner on ${DEFAULT_MODEL[id]} in its own tool format, carrying its call ids and reasoning context, and never sends the link to the model`, async () => {
      const { result, sess, model, out, err } = await runProvider(id);
      expect(result).toMatchObject({ ok: true, code: 'completed' });
      expect(model.seen).toHaveLength(7); // six tool calls, then the final answer
      for (let i = 1; i < model.seen.length; i++) CARRIES[id]?.(model.seen[i] as Seen, i);
      // The private link reaches the terminal only, never a model request.
      for (const s of model.seen) expect(JSON.stringify(s.body)).not.toMatch(/\/[sn]\//);
      expect(err).toContain(LINK);
      expect(out).not.toContain(LINK);
      // Sess: one create; publish and complete bound to the answered snapshots.
      expect(sess.log.creates).toBe(1);
      expect(sess.log.publishes[0]).toMatchObject({ ifMatch: '"1-responded"' });
      expect(sess.log.completes[0]).toMatchObject({ ifMatch: '"2-responded"' });
      expect(sess.log.interactions[0].source.components[0]).toEqual({
        type: 'text',
        text: 'Tell me where and when.',
      });
      expect(out).toContain(FINAL);
      expect(out).toMatch(/usage: 7000 input, 700 output tokens in 7 calls, 7 requests \(0 retries\)/);
      expect(out).toMatch(
        /estimate: US\$\d+\.\d{4} \(reported usage × published rates\)\nreservation: US\$\d+\.\d{4} booked against the cap \(charged at ceiling US\$0\.0000; US\$\d+\.\d{4} reserved before the run\)/,
      );
      expect(out).toMatch(
        id === 'openrouter'
          ? /provider charge: unknown \(not attributable to this run \(OpenRouter GET \/api\/v1\/key usage is a cumulative key counter\); unreconciled_key_counter_only\)/
          : /provider charge: unknown \(not available with this key \(provider console\); unreconciled_unknown\)/,
      );
      expect(out).toMatch(/budget before the run: US\$0\.0000 spent; US\$15\.0000 left of the US\$15 target/);
      expect(out).toMatch(/budget after the run: US\$0\.\d{4} spent/);
    });
  }

  it('the record names the model the API returned, the versions and the time, claims only what was proved, and holds no key, link or answer', async () => {
    const { dir } = await runProvider('openai');
    const files = readdirSync(dir).filter((f) => f !== 'spend-ledger.json');
    expect(files).toHaveLength(1);
    const text = readFileSync(join(dir, files[0] as string), 'utf8');
    for (const secret of [SESS_KEY, MODEL_KEY, LINK, '/s/', '/n/', 'oslo', 'option_1', 'evening'])
      expect(text).not.toContain(secret);
    const record = JSON.parse(text);
    expect(record).toMatchObject({
      schema: 'sess.recipe-qualification/3',
      runner_version: '2.1.0',
      provider: 'openai',
      model_requested: 'gpt-5.4-nano',
      model_returned: ['gpt-5.4-nano-2026-08-01'],
      sdk_version: '0.1.0-rc.9',
      recipe: { file: 'examples/recipes/openai/agent.mjs' },
      scenario: 'happy_path',
      outcome: 'completed',
      calls: 7,
      requests: 7,
      retries: 0,
      attempts_charged_at_ceiling: 0,
      usage: { input_tokens: 7000, output_tokens: 700 },
      rates_usd_per_million: {
        input: 0.2,
        output: 1.25,
        source: 'https://developers.openai.com/api/docs/pricing',
        read_at: '2026-10-18',
      },
      usage_cost_usd: 0.002275, // 7,000 × 0.20 + 700 × 1.25 per million, all reported
      ceiling_reserved_usd: 0,
      estimated_total_usd: 0.002275,
      billed_usd: null,
      billed_source: 'not available with this key (provider console)',
      max_cost_usd: 0.064, // the token caps at the dearer of gpt-5.4-nano and its fallback gpt-4.1-mini
      bounds: { maxCalls: 10, maxRequests: 12, maxOutputTokens: 2000, maxRunInputTokens: 80000 },
    });
    expect(record.recipe.git_sha).toMatch(/^[0-9a-f]{40}$/);
    expect(typeof record.recipe.dirty).toBe('boolean');
    expect(Date.parse(record.recorded_at)).not.toBeNaN();
    expect(record.recorded_at).toMatch(/Z$/);
    expect(record.proved).toEqual([
      'tool_call_issued',
      'sess_link_created_before_wait',
      'human_answer_received',
      'receipt_verified',
      'continuation_after_first_answer',
      'live_weather_used',
      'second_round_published',
      'second_answer_on_same_link',
      'second_receipt_verified',
      'session_completed',
      'final_answer_returned',
      'correction_applied', // the person changed the time to the evening
    ]);
    expect(record.not_proved).toEqual(['wait_resumed_after_timeout']);
  });

  it('a run that stops early proves only what happened before it stopped', async () => {
    // The model refuses after the first answer: no weather, no second round.
    let n = 0;
    const { result, dir } = await runProvider('anthropic', { refuse: () => (n++ >= 2 ? 400 : null) });
    expect(result).toMatchObject({ ok: false, code: 'provider_failed' });
    const [record] = records(dir);
    expect(record.proved).toEqual([
      'tool_call_issued',
      'sess_link_created_before_wait',
      'human_answer_received',
      'receipt_verified',
    ]);
    expect(record.not_proved).toContain('session_completed');
    expect(record.not_proved).toContain('continuation_after_first_answer');
    expect(record.outcome).toBe('provider_failed');
    // The refused attempt is charged at its ceiling (its usage was not reported).
    expect(record.attempts_charged_at_ceiling).toBe(1);
    expect(record.usage.output_tokens).toBe(2 * 100 + 2000);
  });

  it('timeout then resume: a wait that comes back empty is resumed on the same link, and the record proves it', async () => {
    const { result, sess, model, dir } = await runProvider('anthropic', { timeouts: 4 });
    expect(result).toMatchObject({ ok: true, code: 'completed' });
    expect(sess.log.waits).toBe(6); // four empty long-polls (one call), then each round's answer
    expect(model.seen).toHaveLength(8); // one extra sess_response turn
    expect(records(dir)[0].proved).toContain('wait_resumed_after_timeout');
  });

  it('OpenAI falls back to gpt-4.1-mini when the key is not offered gpt-5.4-nano; the refused request counts', async () => {
    const { result, model, dir, err } = await runProvider('openai', {
      refuse: (body) => (body.model === 'gpt-5.4-nano' ? 404 : null),
    });
    expect(result).toMatchObject({ ok: true, code: 'completed' });
    expect(err).toContain('gpt-5.4-nano is not available to this key; trying gpt-4.1-mini.');
    expect(model.seen.map((s) => s.body.model)).toEqual(['gpt-5.4-nano', ...Array(7).fill('gpt-4.1-mini')]);
    const [record] = records(dir);
    expect(record).toMatchObject({
      model_requested: 'gpt-4.1-mini',
      requests: 8,
      attempts_charged_at_ceiling: 1,
    });
    expect(record.rates_usd_per_million).toMatchObject({ input: 0.4, output: 1.6 });
  });

  it('a model other than the listed ones gets its cost only from RECIPE_RATES, and a qualification refuses it without', async () => {
    const a = await runProvider('gemini', { env: { RECIPE_MODEL: 'gemini-other' } });
    expect(a.result).toEqual({ ok: false, code: 'rates_unknown' });
    expect(a.model.seen).toHaveLength(0);
    const b = await runProvider('gemini', { env: { RECIPE_MODEL: 'gemini-other', RECIPE_RATES: '1,2' } });
    expect(b.model.seen[0]?.url).toContain('/models/gemini-other:generateContent');
    expect(b.out).toMatch(/estimate: US\$0\.0084/); // 7000 × 1 + 700 × 2 per million
    expect(records(b.dir)[0].rates_usd_per_million).toMatchObject({
      input: 1,
      output: 2,
      source: 'RECIPE_RATES',
    });
  });

  it('refuses to start without both keys and the weather contact, and names what is missing', async () => {
    const { runRecipe } = await load('harness.mjs');
    const recipe = await load('xai/agent.mjs');
    const err: string[] = [];
    let called = false;
    const result = await runRecipe(recipe.PROVIDER, recipe.plan, {
      env: { SESS_API_KEY: SESS_KEY },
      qualify: true,
      out: scratch('sess-recipe-'),
      guard: { fetch: async () => ((called = true), new Response('{}')) },
      stdout: () => {},
      stderr: (line: string) => err.push(line),
    });
    expect(result).toEqual({ ok: false, code: 'missing_environment' });
    expect(err.join('\n')).toContain('XAI_API_KEY, SESS_DEMO_CONTACT');
    expect(err.join('\n')).toContain('both a Sess key and the xai key');
    expect(called).toBe(false);
  });
});

describe('recipe spend guard', () => {
  it('refuses a run whose maximum possible cost does not fit the operating target, before any request', async () => {
    const { result, model, err, dir } = await runProvider('meta', { env: { RECIPE_BUDGET_USD: '0.1' } });
    // muse-spark-1.3: 80,000 × 1.25 + 20,000 × 4.25 per million = US$0.185 > US$0.10.
    expect(result).toMatchObject({ ok: false, code: 'budget_refused', max_cost_usd: 0.185 });
    expect(err).toContain('could cost up to US$0.1850');
    expect(model.seen).toHaveLength(0);
    expect(existsSync(join(dir, 'spend-ledger.json'))).toBe(false); // nothing was reserved
  });

  it('refuses at the US$100 ceiling whatever the target, and refuses a target above it', async () => {
    const dir = scratch('sess-ledger-');
    writeFileSync(
      join(dir, 'spend-ledger.json'),
      JSON.stringify({
        schema: 'sess.recipe-spend-ledger/1',
        ceiling_usd: 100,
        runs: [{ id: 'a', status: 'settled', provider: 'openai', cost_usd: 99.99, max_cost_usd: 1 }],
      }),
    );
    const near = await runProvider('anthropic', { dir, env: { RECIPE_BUDGET_USD: '100' } });
    expect(near.result).toMatchObject({ ok: false, code: 'budget_refused' });
    expect(near.out).toContain('US$0.0100 of the US$100 ceiling');
    const over = await runProvider('anthropic', { env: { RECIPE_BUDGET_USD: '150' } });
    expect(over.result).toEqual({ ok: false, code: 'budget_invalid' });
    expect(over.model.seen).toHaveLength(0);
  });

  it('accumulates settled costs in the ledger, and an unsettled reservation counts at its maximum', async () => {
    const dir = scratch('sess-ledger-');
    await runProvider('anthropic', { dir });
    await runProvider('gemini', { dir });
    const ledger = ledgerOf(dir);
    expect(ledger.schema).toBe('sess.recipe-spend-ledger/1');
    expect(ledger.runs.map((r: Any) => [r.provider, r.status])).toEqual([
      ['anthropic', 'settled'],
      ['gemini', 'settled'],
    ]);
    // anthropic: 7,000 × 0.10 + 700 × 0.50; gemini (3.8 Flash): 7,000 × 0.75 + 700 × 3.75 (per million).
    expect(ledger.runs.map((r: Any) => r.estimated_total_usd)).toEqual([0.00105, 0.007875]);
    expect(ledger.runs.map((r: Any) => r.cost_usd)).toEqual([0.00105, 0.007875]); // the alias earlier runners read
    expect(ledger.runs.map((r: Any) => r.max_cost_usd)).toEqual([0.018, 0.135]); // gemini: the dearer of 3.8 Flash and its 3.5 Flash-Lite fallback
    expect(ledger.runs[0].record).toMatch(/^anthropic-.*\.json$/);

    ledger.runs.push({ id: 'crashed', status: 'reserved', provider: 'xai', cost_usd: null, max_cost_usd: 5 });
    writeFileSync(join(dir, 'spend-ledger.json'), JSON.stringify(ledger));
    const next = await runProvider('openrouter', { dir });
    expect(next.out).toContain('budget before the run: US$5.0089 spent; US$9.9911 left of the US$15 target');
  });
});

describe('recipe workflow', () => {
  it('asks once (a create is never repeated) and uses the weather of the place and day the person chose', async () => {
    const { createWorkflow } = await load('workflow.mjs');
    const sess = fakeSess();
    const links: string[] = [];
    const flow = createWorkflow({
      sess: new sess.Sess(),
      contact: 'x',
      showLink: (l: string) => links.push(l),
      weatherFor,
    });
    const first = await flow.call('sess_ask', { intro: 'Hi' });
    expect(first).toEqual({ session_id: 'ses_1', revision: 1, link: 'shown to the person' });
    expect(await flow.call('sess_ask', { intro: 'Again' })).toHaveProperty('error');
    expect(sess.log.creates).toBe(1);
    expect(links).toEqual([LINK]);
    expect(await flow.call('get_weather', { place: 'oslo', day: 'saturday' })).toHaveProperty('error');
    await flow.call('sess_response', { session_id: 'ses_1', revision: 1 });
    expect(await flow.call('get_weather', { place: 'paris', day: 'saturday' })).toMatchObject({
      error: expect.stringContaining('place oslo'),
    });
    const weather = await flow.call('get_weather', { place: 'oslo', day: 'saturday' });
    expect(weather).toMatchObject({ city: 'Oslo', forecast_available: true });
    expect(weather.plans).toHaveLength(3);
    expect(await flow.call('no_such_tool', {})).toEqual({ error: 'Unknown tool no_such_tool.' });
  });

  it('stops waiting at the poll budget', async () => {
    const { createWorkflow } = await load('workflow.mjs');
    const sess = fakeSess(100);
    const flow = createWorkflow({
      sess: new sess.Sess(),
      contact: 'x',
      showLink: () => {},
      weatherFor,
      pollMs: 1,
      maxPolls: 5,
    });
    await flow.call('sess_ask', { intro: 'Hi' });
    expect(await flow.call('sess_response', { session_id: 'ses_1', revision: 1 })).toMatchObject({
      waiting: true,
    });
    expect(await flow.call('sess_response', { session_id: 'ses_1', revision: 1 })).toEqual({
      error: 'The wait budget is used up.',
    });
    expect(sess.log.waits).toBe(5);
  });
});

describe('recipe per-run limits', () => {
  const ok = () => new Response('{"ok":true}', { status: 200 });
  const status = (code: number, body = '{}') => new Response(body, { status: code });

  it('retries only 429, 5xx and network failures, at most twice, after 1 s then 4 s; a body never enters the error', async () => {
    const { createGuard } = await load('bounds.mjs');
    const waits: number[] = [];
    const replies = [status(429), status(503), ok()];
    const guard = createGuard({
      fetch: async () => replies.shift(),
      sleep: async (ms: number) => void waits.push(ms),
    });
    expect(await guard.post('https://model.test', {}, {})).toEqual({ ok: true });
    expect(waits).toEqual([1000, 4000]);
    expect(guard.stats()).toMatchObject({ calls: 1, requests: 3, retries: 2 });

    let n = 0;
    const failing = createGuard({ fetch: async () => (n++, status(500)), sleep: async () => {} });
    await expect(failing.post('https://model.test', {}, {})).rejects.toMatchObject({
      code: 'provider_failed',
    });
    expect(n).toBe(3);

    let m = 0;
    const network = createGuard({
      fetch: async () => {
        if (m++ === 0) throw new TypeError('fetch failed');
        return ok();
      },
      sleep: async () => {},
    });
    expect(await network.post('https://model.test', {}, {})).toEqual({ ok: true });

    let k = 0;
    const refused = createGuard({
      fetch: async () => (k++, status(400, '{"error":"bad key provider-test-key"}')),
      sleep: async () => {},
    });
    const error = await refused.post('https://model.test', {}, {}).catch((e: Error) => e);
    expect(k).toBe(1); // a 4xx other than 429 is never retried
    expect(error.message).toBe('The model request failed (400).');
    expect(error).toMatchObject({ status: 400 });
  });

  it('counts every HTTP request, retries included, against the 12-request cap', async () => {
    const { createGuard } = await load('bounds.mjs');
    let i = 0;
    // Each call needs three requests (two 503s, then success): four calls use all twelve.
    const guard = createGuard({
      fetch: async () => (i++ % 3 === 2 ? ok() : status(503)),
      sleep: async () => {},
    });
    for (let c = 0; c < 4; c++) {
      await guard.post('https://model.test', {}, {});
      guard.count(10, 10);
    }
    expect(guard.stats()).toMatchObject({ calls: 4, requests: 12, retries: 8 });
    await expect(guard.post('https://model.test', {}, {})).rejects.toMatchObject({ code: 'max_requests' });
    expect(i).toBe(12);
  });

  it("charges a failed attempt, or a response without usage, at that attempt's ceiling", async () => {
    const { createGuard } = await load('bounds.mjs');
    const body = { prompt: 'x'.repeat(100) };
    const bytes = Buffer.byteLength(JSON.stringify(body));
    const once = [status(500), ok()];
    const guard = createGuard({ fetch: async () => once.shift(), sleep: async () => {} });
    await guard.post('https://model.test', {}, body);
    guard.count(undefined, 50, 'model-x'); // input not reported: its ceiling stands
    expect(guard.stats()).toMatchObject({
      usage: { input_tokens: 2 * (bytes + 1000), output_tokens: 2000 + 50 },
      estimated_attempts: 2,
      models: ['model-x'],
    });
    // A response whose usage is never reported is charged when the totals are read.
    const silent = createGuard({ fetch: async () => ok() });
    await silent.post('https://model.test', {}, body);
    expect(silent.stats().usage).toEqual({ input_tokens: bytes + 1000, output_tokens: 2000 });
  });

  it('sends no request whose ceiling could pass a run token cap, and stops at 10 calls and the wall clock', async () => {
    const { createGuard, BOUNDS, maxRunCost } = await load('bounds.mjs');
    expect(BOUNDS).toMatchObject({
      maxCalls: 10,
      maxRequests: 12,
      maxOutputTokens: 2000,
      maxRunInputTokens: 80_000,
      maxRunOutputTokens: 20_000,
      callTimeoutMs: 60_000,
      backoffMs: [1000, 4000],
      wallMs: 1_200_000,
    });
    expect(maxRunCost({ input: 1, output: 10 })).toBeCloseTo(0.28); // 80k × 1 + 20k × 10 per million

    let sent = 0;
    const capped = createGuard({
      bounds: { ...BOUNDS, maxRunOutputTokens: 3000 },
      fetch: async () => (sent++, ok()),
    });
    await capped.post('https://model.test', {}, {});
    capped.count(10, 1500);
    await expect(capped.post('https://model.test', {}, {})).rejects.toMatchObject({ code: 'token_cap' });
    expect(sent).toBe(1);

    const calls = createGuard({ fetch: async () => ok() });
    for (let i = 0; i < 10; i++) {
      await calls.post('https://model.test', {}, {});
      calls.count(10, 10);
    }
    await expect(calls.post('https://model.test', {}, {})).rejects.toMatchObject({ code: 'max_calls' });

    const input = createGuard({ fetch: async () => ok() });
    expect(() => input.count(80_000, 0)).toThrow(expect.objectContaining({ code: 'input_token_cap' }));

    let t = 0;
    const wall = createGuard({ fetch: async () => ok(), now: () => t });
    await wall.post('https://model.test', {}, {});
    wall.count(10, 10);
    t = 20 * 60_000;
    await expect(wall.post('https://model.test', {}, {})).rejects.toMatchObject({ code: 'wall_clock' });
  });
});

describe('models and the weekly check', () => {
  it('models.json lists dated rates with sources, and each default is the cheapest listed model except where its note says why', async () => {
    const models = JSON.parse(readFileSync(join(RECIPES, 'models.json'), 'utf8'));
    const { cheapestModel } = await load('qualify.mjs');
    expect(models.read_at).toBe('2026-10-18');
    for (const [id, entry] of Object.entries<Any>(models.providers)) {
      expect(entry.source).toMatch(/^https:\/\//);
      expect(entry.default).toBe(DEFAULT_MODEL[id]);
      expect(entry.models[entry.default]).toEqual({ input: expect.any(Number), output: expect.any(Number) });
    }
    expect(models.providers.openai.fallback).toBe('gpt-4.1-mini');
    const cheapest = Object.fromEntries(
      Object.entries<Any>(models.providers).map(([id, e]) => [id, cheapestModel(e)]),
    );
    // Gemini's default is the current Flash by choice (models.json note), not the cheapest.
    expect(cheapest).toEqual({
      ...DEFAULT_MODEL,
      gemini: 'gemini-3.1-flash-lite',
      openrouter: 'google/gemini-2.5-flash-lite',
    });
  });

  it('--weekly runs the happy path once per provider with a key, on its cheapest model, under the same guard', async () => {
    const { weekly } = await load('qualify.mjs');
    const sess = fakeSess();
    const model = mockFetch(REPLIES.openai as Reply, scriptedModel(sess.log));
    const dir = scratch('sess-weekly-');
    const out: string[] = [];
    const results = await weekly({
      env: { SESS_API_KEY: SESS_KEY, OPENAI_API_KEY: MODEL_KEY, SESS_DEMO_CONTACT: 'https://example.com/c' },
      Sess: sess.Sess,
      guard: { fetch: model.fetch, sleep: async () => {} },
      workflow: { weatherFor, pollMs: 10 },
      sdkVersion: '0.1.0-rc.9',
      out: dir,
      stdout: (line: string) => out.push(line),
      stderr: () => {},
    });
    expect(results).toEqual([
      { provider: 'openai', model: 'gpt-5.4-nano', code: 'completed' },
      { provider: 'anthropic', code: 'skipped' },
      { provider: 'gemini', code: 'skipped' },
      { provider: 'xai', code: 'skipped' },
      { provider: 'meta', code: 'skipped' },
      { provider: 'openrouter', code: 'skipped' },
    ]);
    expect(out.join('\n')).toContain('anthropic: skipped (no ANTHROPIC_API_KEY)');
    const [record] = records(dir);
    expect(record).toMatchObject({
      scenario: 'happy_path',
      model_requested: 'gpt-5.4-nano',
      max_cost_usd: 0.041,
    });
    expect(ledgerOf(dir).runs).toHaveLength(1);
  });
});

describe('with-keychain.sh', () => {
  const script = join(RECIPES, 'with-keychain.sh');
  const child =
    'process.stdout.write(JSON.stringify({ sess: process.env.SESS_API_KEY, openai: process.env.OPENAI_API_KEY, anthropic: process.env.ANTHROPIC_API_KEY, gemini: process.env.GEMINI_API_KEY ?? null }))';

  function fakeSecurity() {
    const bin = scratch('sess-keychain-');
    const tool = join(bin, 'security');
    writeFileSync(
      tool,
      [
        '#!/bin/sh',
        '[ "$1" = find-generic-password ] && [ "$2" = -s ] && [ "$4" = -w ] || exit 64',
        'case "$3" in',
        `  sess-qual-sess-api-key) printf '%s\\n' '${SESS_KEY}' ;;`,
        `  sess-test-openai-api-key) printf '%s\\n' '${MODEL_KEY}-openai' ;;`,
        `  sess-test-anthropic-api-key) printf '%s\\n' '${MODEL_KEY}-anthropic' ;;`,
        '  sess-qual-meta-key) printf "" ;;',
        "  *) echo 'security: item not found' >&2; exit 44 ;;",
        'esac',
        '',
      ].join('\n'),
    );
    chmodSync(tool, 0o755);
    return { PATH: `${bin}:${process.env.PATH ?? ''}` };
  }
  const run = (args: string[], env: Record<string, string>) =>
    spawnSync('sh', [script, ...args], { encoding: 'utf8', env });

  it("reuses the existing OpenAI and Anthropic items and puts the keys only into the child's environment", () => {
    const openai = run(['openai', '--', process.execPath, '-e', child], fakeSecurity());
    expect(openai.status).toBe(0);
    expect(JSON.parse(openai.stdout)).toMatchObject({ sess: SESS_KEY, openai: `${MODEL_KEY}-openai` });
    expect(openai.stderr).toBe('');
    const anthropic = run(['anthropic', '--', process.execPath, '-e', child], fakeSecurity());
    expect(JSON.parse(anthropic.stdout)).toMatchObject({
      sess: SESS_KEY,
      anthropic: `${MODEL_KEY}-anthropic`,
    });
  });

  it('all: the Sess key and every provider key present; a missing provider is left out', () => {
    const r = run(['all', '--', process.execPath, '-e', child], fakeSecurity());
    expect(r.status).toBe(0);
    expect(JSON.parse(r.stdout)).toEqual({
      sess: SESS_KEY,
      openai: `${MODEL_KEY}-openai`,
      anthropic: `${MODEL_KEY}-anthropic`,
      gemini: null,
    });
    expect(r.stderr).toBe('');
  });

  it('refuses a missing or empty item before running anything, without printing a key', () => {
    const missing = run(
      ['gemini', '--', process.execPath, '-e', 'process.stdout.write("ran")'],
      fakeSecurity(),
    );
    expect(missing.status).toBe(1);
    expect(missing.stdout).toBe('');
    expect(missing.stderr).toContain('sess-qual-gemini-key is missing or empty');
    expect(missing.stderr).not.toContain(SESS_KEY);
    const empty = run(['meta', '--', process.execPath, '-e', 'process.stdout.write("ran")'], fakeSecurity());
    expect(empty.status).toBe(1);
    expect(empty.stdout).toBe('');
    expect(empty.stderr).toContain('sess-qual-meta-key is missing or empty');
  });

  it('refuses an unknown provider or a missing command', () => {
    expect(run(['other', '--', 'true'], fakeSecurity()).status).toBe(2);
    expect(run(['openai', '--'], fakeSecurity()).status).toBe(2);
    expect(run(['openai', 'true', 'x'], fakeSecurity()).status).toBe(2);
    expect(existsSync(script)).toBe(true);
  });
});
