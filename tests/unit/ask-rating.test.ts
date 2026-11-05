import { describe, expect, expectTypeOf, it } from 'vitest';
import { readFile } from 'node:fs/promises';
import * as ts from 'typescript';
import { Sess } from '@sess.si/sdk';
import { SessError, type AskAnswer } from '../../src/index.js';
import { checkAnswer, compileAsk } from '../../src/ask.js';
// Test-only parity oracle: the MCP adapter's sess_ask expansion and sess_request check.
import { parseAskArgs, validateInteraction, type JsonValue } from '../../adapters/mcp/src/validate.js';
import { createFakeRuntime, FAKE_LINK } from '../fixtures/fake-runtime.mjs';
import { API_KEY } from '../fixtures/api.js';

/** The rating field (Sess P2-24(h)): an integer from 1 to `max`, 2–10, default 5. */
const ratings = {
  question: 'How did we do?',
  fields: [
    { name: 'stars', label: 'Your visit', type: 'rating' },
    { name: 'nps', label: 'Recommend us?', type: 'rating', max: 10, low: 'Not likely', high: 'Very likely' },
    { name: 'pair', label: 'Two', type: 'rating', max: 2, required: false, default: 2 },
  ],
} as const;

function refusal(input: unknown): SessError {
  try {
    compileAsk(input);
  } catch (error) {
    if (error instanceof SessError) return error;
    throw error;
  }
  throw new Error('compiled');
}
const one = (field: Record<string, unknown>) => ({
  question: 'Q',
  fields: [{ name: 'r', label: 'R', type: 'rating', ...field }],
});

describe('rating fields in sess.ask', () => {
  it('compiles type rating to Sess’s rating field: five stars by default, max 2–10, end labels only when given', () => {
    const { interaction, fields } = compileAsk(ratings);
    expect(interaction.source.components).toEqual([
      {
        type: 'field',
        name: 'stars',
        label: 'Your visit',
        required: true,
        rating: {},
        schema: { type: 'integer', minimum: 1, maximum: 5 },
      },
      {
        type: 'field',
        name: 'nps',
        label: 'Recommend us?',
        required: true,
        rating: { low: 'Not likely', high: 'Very likely' },
        schema: { type: 'integer', minimum: 1, maximum: 10 },
      },
      {
        type: 'field',
        name: 'pair',
        label: 'Two',
        required: false,
        rating: {},
        schema: { type: 'integer', minimum: 1, maximum: 2 },
        value: 2,
      },
    ]);
    expect(fields.map((f) => [f.type, f.minimum, f.maximum])).toEqual([
      ['rating', 1, 5],
      ['rating', 1, 10],
      ['rating', 1, 2],
    ]);
    // The same expansion as the MCP sess_ask tool, which sess_request's check accepts.
    expect(interaction).toEqual(parseAskArgs(ratings).interaction);
    expect(validateInteraction(JSON.parse(JSON.stringify(interaction)))).toEqual(
      JSON.parse(JSON.stringify(interaction)),
    );
  });

  it('types the answer as a number', () => {
    expectTypeOf<AskAnswer<typeof ratings.fields>>().toEqualTypeOf<{
      readonly stars: number;
      readonly nps: number;
      readonly pair?: number;
    }>();
  });

  it('refuses before sending: max outside 2–10 or not whole, rating keys on other types, a default off the scale, end labels blank or over 24', () => {
    for (const max of [1, 11, 2.5, '5', null])
      expect(refusal(one({ max })).message, String(max)).toBe(
        'Invalid question: fields[0].max must be a whole number from 2 to 10.',
      );
    for (const field of [
      { name: 'r', label: 'R', type: 'integer', max: 5 },
      { name: 'r', label: 'R', type: 'text', low: 'x' },
      { name: 'r', label: 'R', type: 'choice', options: ['a'], high: 'x' },
    ])
      expect(refusal({ question: 'Q', fields: [field] }).message).toBe(
        'Invalid question: fields[0] max/low/high are only allowed for rating.',
      );
    expect(refusal(one({ minimum: 1 })).message).toBe(
      'Invalid question: fields[0] minimum/maximum are only allowed for number and integer.',
    );
    for (const value of [0, 6, 2.5, '3'])
      expect(refusal(one({ default: value })).message).toBe(
        'Invalid question: fields[0].default is not a valid value for this field.',
      );
    expect(refusal(one({ low: '   ' })).message).toBe('Invalid question: fields[0].low must not be blank.');
    const long = refusal(one({ high: 'x'.repeat(25) }));
    expect(long).toMatchObject({
      code: 'INVALID_QUESTION',
      outcome: 'not_sent',
      field: '/fields/0/high',
      limit: 24,
      length: 25,
    });
    expect(compileAsk(one({ low: '😀'.repeat(24) })).interaction.source.components[0]).toMatchObject({
      rating: { low: '😀'.repeat(24) },
    });
  });

  it('accepts a verified answer only on the scale', () => {
    const { fields } = compileAsk(ratings);
    expect(checkAnswer(fields, { stars: 1, nps: 10 })).toEqual({ stars: 1, nps: 10 });
    expect(checkAnswer(fields, { stars: 5, nps: 7, pair: 1 })).toEqual({ stars: 5, nps: 7, pair: 1 });
    for (const data of [
      { stars: 0, nps: 1 },
      { stars: 6, nps: 1 },
      { stars: 3.5, nps: 1 },
      { stars: '3', nps: 1 },
      { nps: 1 },
    ])
      expect(() => checkAnswer(fields, data), JSON.stringify(data)).toThrow(SessError);
  });
});

describe('the MCP tools accept a rating', () => {
  it('sess_ask refuses what sess.ask refuses, and sess_request refuses a rating whose schema is not its shape', () => {
    for (const field of [{ max: 1 }, { max: 11 }, { low: 'x'.repeat(25) }])
      expect(() => parseAskArgs(one(field)), JSON.stringify(field)).toThrow();
    const raw = (schema: JsonValue, rating: JsonValue = {}): JsonValue => ({
      mode: 'interactive',
      title: 'Q',
      source: {
        kind: 'sess_surface',
        components: [{ type: 'field', name: 'r', label: 'R', rating, schema }],
      },
      actions: [{ id: 'send', label: 'Send' }],
    });
    expect(() =>
      validateInteraction(raw({ type: 'integer', minimum: 1, maximum: 10, title: 'T' })),
    ).not.toThrow();
    for (const schema of [
      { type: 'integer', minimum: 1, maximum: 11 },
      { type: 'integer', minimum: 0, maximum: 5 },
      { type: 'number', minimum: 1, maximum: 5 },
      { type: 'integer', minimum: 1, maximum: 5, exclusiveMaximum: 6 },
    ] as JsonValue[])
      expect(() => validateInteraction(raw(schema)), JSON.stringify(schema)).toThrow(
        'must be exactly {"type": "integer", "minimum": 1, "maximum": N} for a rating, with N from 2 to 10',
      );
    expect(() =>
      validateInteraction(raw({ type: 'integer', minimum: 1, maximum: 5 }, { mid: 'x' })),
    ).toThrow();
    expect(() =>
      validateInteraction(raw({ type: 'integer', minimum: 1, maximum: 5 }, { low: 'x'.repeat(25) })),
    ).toThrow(
      expect.objectContaining({
        tooLong: { field: '/interaction/source/components/0/rating/low', limit: 24, length: 25 },
      }),
    );
  });
});

describe('the one-to-one feedback example in docs/api.md', () => {
  async function example(): Promise<string> {
    const docs = (await readFile(new URL('../../docs/api.md', import.meta.url), 'utf8')).replace(
      /\r\n/g,
      '\n',
    );
    const block = /<!-- example:feedback -->\s*```ts\n([\s\S]*?)\n```\s*<!-- \/example:feedback -->/.exec(
      docs,
    )?.[1];
    if (!block) throw new Error('no feedback example in docs/api.md');
    return block;
  }

  it('is examples/feedback.ts, line for line', async () => {
    const source = await readFile(new URL('../../examples/feedback.ts', import.meta.url), 'utf8');
    expect(await example()).toBe(source.replace(/\r\n/g, '\n').trimEnd());
  });

  it('runs: the link before any wait, then the verified rating and the optional comment', async () => {
    const source = (await example()).replace(/^import \{ Sess \} from .@sess\.si\/sdk.;\r?\n/m, '');
    const compiled = ts.transpileModule(source, {
      compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
    }).outputText;
    for (const [answer, last] of [
      [{ satisfaction: 4, comment: 'Lovely staff' }, 'Rated 4 of 5. They said: Lovely staff'],
      [{ satisfaction: 5 }, 'Rated 5 of 5.'],
    ] as const) {
      const runtime = createFakeRuntime({ autoAnswer: answer });
      class ExampleSess extends Sess {
        constructor(options: ConstructorParameters<typeof Sess>[0]) {
          super({ ...options, fetch: runtime.fetch });
        }
      }
      const lines: { text: string; reads: number }[] = [];
      const output = { log: (text: string) => lines.push({ text, reads: runtime.counts.retrieve }) };
      const execute = new Function(
        'Sess',
        'process',
        'console',
        `return (async () => { ${compiled}\n})()`,
      ) as (SDK: typeof Sess, context: { env: Record<string, string> }, out: typeof output) => Promise<void>;
      await execute(ExampleSess, { env: { SESS_API_KEY: API_KEY } }, output);
      expect(lines.map((l) => l.text)).toEqual([`Send this Sess link to the person: ${FAKE_LINK}`, last]);
      expect(lines[0]!.reads).toBe(0);
      const stored = runtime.session()!.interaction as { source: { components: unknown[] } };
      expect(stored.source.components[0]).toEqual({
        type: 'field',
        name: 'satisfaction',
        label: 'Your visit',
        required: true,
        rating: {},
        schema: { type: 'integer', minimum: 1, maximum: 5 },
      });
      expect(runtime.counts).toMatchObject({ create: 1, complete: 1 });
      expect(runtime.session()!.status).toBe('completed');
    }
  });
});
