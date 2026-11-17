import { describe, expect, expectTypeOf, it, vi } from 'vitest';
import { Sess, SessError, type AskAnswer, type AskField } from '../../src/index.js';
import { checkAnswer, compileAsk } from '../../src/ask.js';
// Test-only parity oracle: the MCP adapter sess_ask expansion. The root SDK never imports it.
import { parseAskArgs } from '../../adapters/mcp/src/validate.js';
import { API_KEY } from '../fixtures/api.js';

const everyKind = {
  question: 'Approve the synthetic refund?',
  details: 'Order 42 arrived damaged.\nNo payment is made.',
  submit_label: 'Send answer',
  fields: [
    { name: 'approved', label: 'Approve it', type: 'boolean' },
    { name: 'agree', label: 'I agree', type: 'boolean', required: true, default: false },
    { name: 'amount', label: 'Refund amount', type: 'number', minimum: 0, maximum: 500, default: 12.5 },
    { name: 'count', label: 'Items', type: 'integer', minimum: 1 },
    { name: 'reason', label: 'Reason', type: 'choice', options: ['damaged', 'late'], default: 'late' },
    { name: 'tags', label: 'Tags', type: 'multi_choice', options: ['a', 'b', 'c'], default: ['a', 'c'] },
    { name: 'note', label: 'Note', type: 'text', required: false, multiline: true, default: '' },
    { name: 'who', label: 'Your name', type: 'text' },
  ],
} as const;
const parityCorpus: unknown[] = [
  everyKind,
  { question: 'One field', fields: [{ name: 'a', label: 'A', type: 'text' }] },
  {
    question: 'Optional choice',
    fields: [{ name: 'c', label: 'C', type: 'choice', options: ['x'], required: false }],
  },
  {
    question: 'Twelve fields',
    fields: Array.from({ length: 12 }, (_, i) => ({
      name: `f${i}`,
      label: `Field ${i}`,
      type: 'integer',
      maximum: i,
    })),
  },
];
const invalidForBoth: [string, unknown][] = [
  ['unknown top-level property', { ...everyKind, mode: 'interactive' }],
  ['missing fields', { question: 'Q' }],
  ['no fields', { question: 'Q', fields: [] }],
  [
    'thirteen fields',
    {
      question: 'Q',
      fields: Array.from({ length: 13 }, (_, i) => ({ name: `f${i}`, label: 'L', type: 'text' })),
    },
  ],
  ['blank question', { question: '   ', fields: [{ name: 'a', label: 'A', type: 'text' }] }],
  ['long question', { question: 'q'.repeat(201), fields: [{ name: 'a', label: 'A', type: 'text' }] }],
  ['control character', { question: 'Q', fields: [{ name: 'a', label: 'A\u0007', type: 'text' }] }],
  ['bidirectional override', { question: 'Q‮', fields: [{ name: 'a', label: 'A', type: 'text' }] }],
  ['bad name', { question: 'Q', fields: [{ name: 'Bad', label: 'A', type: 'text' }] }],
  ['reserved name', { question: 'Q', fields: [{ name: 'constructor', label: 'A', type: 'text' }] }],
  [
    'duplicate names',
    {
      question: 'Q',
      fields: [
        { name: 'a', label: 'A', type: 'text' },
        { name: 'a', label: 'B', type: 'boolean' },
      ],
    },
  ],
  ['unknown type', { question: 'Q', fields: [{ name: 'a', label: 'A', type: 'date' }] }],
  [
    'unknown field property',
    { question: 'Q', fields: [{ name: 'a', label: 'A', type: 'text', pattern: 'x' }] },
  ],
  ['options on text', { question: 'Q', fields: [{ name: 'a', label: 'A', type: 'text', options: ['x'] }] }],
  ['choice without options', { question: 'Q', fields: [{ name: 'a', label: 'A', type: 'choice' }] }],
  ['empty options', { question: 'Q', fields: [{ name: 'a', label: 'A', type: 'choice', options: [] }] }],
  [
    'duplicate options',
    { question: 'Q', fields: [{ name: 'a', label: 'A', type: 'choice', options: ['x', 'x'] }] },
  ],
  [
    'too many options',
    {
      question: 'Q',
      fields: [
        { name: 'a', label: 'A', type: 'choice', options: Array.from({ length: 101 }, (_, i) => `o${i}`) },
      ],
    },
  ],
  [
    'multiline on number',
    { question: 'Q', fields: [{ name: 'a', label: 'A', type: 'number', multiline: true }] },
  ],
  ['minimum on text', { question: 'Q', fields: [{ name: 'a', label: 'A', type: 'text', minimum: 1 }] }],
  [
    'non-boolean required',
    { question: 'Q', fields: [{ name: 'a', label: 'A', type: 'text', required: 'yes' }] },
  ],
  [
    'infinite bound',
    { question: 'Q', fields: [{ name: 'a', label: 'A', type: 'number', maximum: Infinity }] },
  ],
];
const invalidLocally: [string, unknown][] = [
  [
    'choice default outside options',
    { question: 'Q', fields: [{ name: 'a', label: 'A', type: 'choice', options: ['x'], default: 'y' }] },
  ],
  [
    'number default below minimum',
    { question: 'Q', fields: [{ name: 'a', label: 'A', type: 'number', minimum: 0, default: -1 }] },
  ],
  [
    'integer default with a fraction',
    { question: 'Q', fields: [{ name: 'a', label: 'A', type: 'integer', default: 1.5 }] },
  ],
  ['null default', { question: 'Q', fields: [{ name: 'a', label: 'A', type: 'text', default: null }] }],
  [
    'text default for a boolean',
    { question: 'Q', fields: [{ name: 'a', label: 'A', type: 'boolean', default: 'true' }] },
  ],
  [
    'repeated multiple-choice default',
    {
      question: 'Q',
      fields: [{ name: 'a', label: 'A', type: 'multi_choice', options: ['x'], default: ['x', 'x'] }],
    },
  ],
  [
    'minimum above maximum',
    { question: 'Q', fields: [{ name: 'a', label: 'A', type: 'number', minimum: 2, maximum: 1 }] },
  ],
  [
    'class instance',
    {
      question: 'Q',
      fields: [
        new (class Field {
          name = 'a';
          label = 'A';
          type = 'text';
        })(),
      ],
    },
  ],
  [
    'accessor property',
    {
      question: 'Q',
      get fields() {
        return [{ name: 'a', label: 'A', type: 'text' }];
      },
    },
  ],
  ['symbol key', { question: 'Q', fields: [{ name: 'a', label: 'A', type: 'text', [Symbol('x')]: 1 }] }],
  [
    'oversized Surface',
    {
      question: 'Q',
      fields: Array.from({ length: 12 }, (_, i) => ({
        name: `f${i}`,
        label: 'L',
        type: 'choice',
        options: Array.from({ length: 100 }, (_, j) => `${'é'.repeat(150)}${j}`),
      })),
    },
  ],
  ['not an object', 'Approve?'],
];

describe('the simple-field compiler', () => {
  it.each(parityCorpus.map((input, i) => [i, input] as const))(
    'expands a question exactly like the MCP sess_ask schema (case %i)',
    (_i, input) => {
      expect(compileAsk(input).interaction).toEqual(parseAskArgs(input).interaction);
    },
  );

  it('compiles every kind to the runtime field schema', () => {
    const { interaction } = compileAsk(everyKind);
    expect(interaction.title).toBe(everyKind.question);
    expect(interaction.actions).toEqual([{ id: 'submit', label: 'Send answer', intent: 'submit' }]);
    expect(interaction.source.components).toEqual([
      { type: 'text', text: everyKind.details },
      { type: 'field', name: 'approved', label: 'Approve it', required: false, schema: { type: 'boolean' } },
      {
        type: 'field',
        name: 'agree',
        label: 'I agree',
        required: true,
        schema: { type: 'boolean' },
        value: false,
      },
      {
        type: 'field',
        name: 'amount',
        label: 'Refund amount',
        required: true,
        schema: { type: 'number', minimum: 0, maximum: 500 },
        value: 12.5,
      },
      {
        type: 'field',
        name: 'count',
        label: 'Items',
        required: true,
        schema: { type: 'integer', minimum: 1 },
      },
      {
        type: 'field',
        name: 'reason',
        label: 'Reason',
        required: true,
        schema: { type: 'string', enum: ['damaged', 'late'] },
        value: 'late',
      },
      {
        type: 'field',
        name: 'tags',
        label: 'Tags',
        required: true,
        schema: { type: 'array', items: { type: 'string', enum: ['a', 'b', 'c'] }, uniqueItems: true },
        value: ['a', 'c'],
      },
      {
        type: 'field',
        name: 'note',
        label: 'Note',
        required: false,
        schema: { type: 'string' },
        multiline: true,
        value: '',
      },
      { type: 'field', name: 'who', label: 'Your name', required: true, schema: { type: 'string' } },
    ]);
  });

  it('is deterministic and detached from the caller input', () => {
    const input = structuredClone(everyKind) as unknown as { question: string; fields: { label: string }[] };
    const first = JSON.stringify(compileAsk(input));
    expect(JSON.stringify(compileAsk(input))).toBe(first);
    const compiled = compileAsk(input);
    input.question = 'Changed';
    input.fields[0]!.label = 'Changed';
    expect(JSON.stringify(compiled)).toBe(first);
  });

  it.each(invalidForBoth)('rejects %s, as the MCP schema does', (_name, input) => {
    expect(() => compileAsk(input)).toThrow(SessError);
    expect(() => parseAskArgs(input)).toThrow();
  });

  it.each([...invalidForBoth, ...invalidLocally])(
    'rejects %s before credential lookup or any network work',
    async (_name, input) => {
      const apiKey = vi.fn(() => API_KEY);
      const fetch = vi.fn();
      const sess = new Sess({ apiKey, fetch });
      const error = await sess.ask(input as never).catch((e: unknown) => e);
      expect(error).toBeInstanceOf(SessError);
      expect(error).toMatchObject({ kind: 'configuration', code: 'INVALID_QUESTION', outcome: 'not_sent' });
      expect(apiKey).not.toHaveBeenCalled();
      expect(fetch).not.toHaveBeenCalled();
    },
  );

  it('names the problem without echoing caller values', () => {
    const error = (() => {
      try {
        compileAsk({ question: 'Q', fields: [{ name: 'a', label: 'private-value\u0007', type: 'text' }] });
      } catch (e) {
        return e as SessError;
      }
    })();
    expect(error?.message).toContain('fields[0].label');
    expect(error?.message).not.toContain('private-value');
  });

  it('captures the input before the first asynchronous step', async () => {
    let body = '';
    const fetch = vi.fn(async (_url: unknown, init?: RequestInit) => {
      body = String(init?.body);
      throw new TypeError('stop after capture');
    });
    const input = { question: 'Original', fields: [{ name: 'a', label: 'A', type: 'text' as const }] };
    const pending = new Sess({ apiKey: API_KEY, fetch }).ask(input);
    input.question = 'Mutated';
    await expect(pending).rejects.toMatchObject({ kind: 'unknown_outcome' });
    expect(JSON.parse(body).interaction.title).toBe('Original');
  });
});

describe('checking a verified answer against the fields', () => {
  const { fields } = compileAsk(everyKind);
  const valid = {
    approved: false,
    agree: true,
    amount: 1,
    count: 2,
    reason: 'damaged',
    tags: [],
    who: 'Ada',
  };

  it('returns a frozen copy in field order; absent optional values stay absent', () => {
    const checked = checkAnswer(fields, Object.fromEntries(Object.entries(valid).reverse()));
    expect(Object.keys(checked)).toEqual(['approved', 'agree', 'amount', 'count', 'reason', 'tags', 'who']);
    expect(Object.isFrozen(checked)).toBe(true);
    expect(Object.isFrozen(checked.tags)).toBe(true);
    expect(checked).not.toHaveProperty('note');
  });

  it.each([
    ['an unknown key', { ...valid, extra: 1 }],
    ['a missing required value', { ...valid, who: undefined }],
    ['a missing checkbox', { ...valid, approved: undefined }],
    ['a missing multiple choice', { ...valid, tags: undefined }],
    ['an empty text', { ...valid, who: '' }],
    ['a fractional integer', { ...valid, count: 2.5 }],
    ['a number above maximum', { ...valid, amount: 501 }],
    ['a string number', { ...valid, amount: '1' }],
    ['a choice outside options', { ...valid, reason: 'other' }],
    ['a repeated selection', { ...valid, tags: ['a', 'a'] }],
    ['an unknown selection', { ...valid, tags: ['z'] }],
    ['an overlong text', { ...valid, who: 'x'.repeat(4001) }],
    ['a non-object', ['Ada']],
  ])('refuses %s', (_name, data) => {
    const value = JSON.parse(JSON.stringify(data));
    expect(() => checkAnswer(fields, value)).toThrow(
      expect.objectContaining({ kind: 'protocol', code: 'INVALID_RESPONSE' }),
    );
  });
});

describe('answer types are inferred from the field definitions', () => {
  it('maps each kind and presence rule to a type', () => {
    type Answer = AskAnswer<typeof everyKind.fields>;
    expectTypeOf<Answer['approved']>().toEqualTypeOf<boolean>();
    expectTypeOf<Answer['amount']>().toEqualTypeOf<number>();
    expectTypeOf<Answer['count']>().toEqualTypeOf<number>();
    expectTypeOf<Answer['reason']>().toEqualTypeOf<'damaged' | 'late'>();
    expectTypeOf<Answer['tags']>().toEqualTypeOf<readonly ('a' | 'b' | 'c')[]>();
    expectTypeOf<Answer['who']>().toEqualTypeOf<string>();
    expectTypeOf<Answer['note']>().toEqualTypeOf<string | undefined>();
    expectTypeOf<Answer>().toHaveProperty('note');
    // @ts-expect-error a required value is not optional
    const missing: Answer = { approved: true };
    void missing;
  });

  it('infers literal names and options from an inline call without annotations', () => {
    async function typesOnly(sess: Sess) {
      const handle = await sess.ask({
        question: 'Q',
        fields: [
          { name: 'size', label: 'Size', type: 'choice', options: ['s', 'm'] },
          { name: 'qty', label: 'Quantity', type: 'integer', required: false },
        ],
      });
      const answer = await handle.answer();
      expectTypeOf(answer).toEqualTypeOf<{ readonly size: 's' | 'm'; readonly qty?: number }>();
      // @ts-expect-error unsupported kinds are not accepted
      void sess.ask({ question: 'Q', fields: [{ name: 'a', label: 'A', type: 'date' }] });
    }
    expect(typesOnly).toBeTypeOf('function');
    const anyField: AskField = { name: 'a', label: 'A', type: 'boolean' };
    expect(anyField.type).toBe('boolean');
  });
});
