// Sess's length limits for what a person reads, as the tool schemas teach them and as every call
// enforces them: a purpose, style and examples on each such field, examples within their own
// schemas, N accepted and N+1 refused (in code points) with field, limit, length and the fix.
import { Ajv } from 'ajv';
import { SessError } from '@sess.si/sdk';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { AdapterError } from '../src/errors.js';
import { SessMcpAdapter } from '../src/operations.js';
import { ASK_EXAMPLE, INTERACTION_EXAMPLE, TOOLS, interactionSchema } from '../src/tools.js';
import { TEXT_LIMITS, parseAskArgs, parseRequestArgs } from '../src/validate.js';
import { FakeSess, ROUND_1, clientFor, env, tempDir } from './helpers.js';

type Schema = Record<string, any>;
const tool = (name: string) => TOOLS.find((t) => t.name === name)!.inputSchema as Schema;
const components = (interactionSchema as Schema).properties.source.properties.components.items
  .anyOf as Schema[];
const component = (type: string) => components.find((c) => c.properties.type.const === type)!.properties;
const ask = tool('sess_ask').properties;

/** Every string a person reads, its schema and its limit. */
const VISIBLE: [string, Schema, number][] = [
  ['interaction.title', (interactionSchema as Schema).properties.title, 80],
  ['interaction.description', (interactionSchema as Schema).properties.description, 280],
  ['heading.text', component('heading').text, 60],
  ['text.text', component('text').text, 4000],
  ['record.label', component('record').label, 200],
  ['record.fields value', component('record').fields.additionalProperties, 200],
  ['field.label', component('field').label, 60],
  ['field.description', component('field').description, 160],
  ['field.option_labels value', component('field').option_labels.additionalProperties, 60],
  ['action.label', (interactionSchema as Schema).properties.actions.items.properties.label, 24],
  ['sess_ask.question', ask.question, 80],
  ['sess_ask.details', ask.details, 4000],
  ['sess_ask.submit_label', ask.submit_label, 24],
  ['sess_ask.fields[].label', ask.fields.items.properties.label, 60],
  ['sess_ask.fields[].options[]', ask.fields.items.properties.options.items, 60],
];

describe('tool schemas teach the limits', () => {
  it.each(VISIBLE)('%s has a one-line description, maxLength and examples within it', (_, schema, limit) => {
    expect(schema.maxLength).toBe(limit);
    expect(typeof schema.description).toBe('string');
    expect(schema.description).not.toContain('\n');
    expect(schema.description).toContain(`at most ${limit}`);
    expect(schema.examples.length).toBeGreaterThan(0);
    for (const example of schema.examples) expect([...example].length).toBeLessThanOrEqual(limit);
  });

  it('mirrors Sess’s SURFACE_TEXT_DOCS wording; every example title is under 40 characters', () => {
    for (const schema of [(interactionSchema as Schema).properties.title, ask.question]) {
      expect(schema.description).toBe(
        "The page's heading: a question or a task, about 40 characters; at most 80.",
      );
      for (const example of schema.examples) expect([...example].length).toBeLessThan(40);
    }
    expect((interactionSchema as Schema).properties.actions.items.properties.label.description).toBe(
      'A button: a verb, 1–3 words; at most 24.',
    );
    expect([...INTERACTION_EXAMPLE.title].length).toBeLessThan(40);
    expect([...ASK_EXAMPLE.question].length).toBeLessThan(40);
  });

  it('record fields bound string values (and say the key limit); button labels are verbs of 1-3 words', () => {
    const fields = component('record').fields;
    expect(fields.additionalProperties.maxLength).toBe(200);
    expect(fields.description).toContain("A row's name, shown verbatim: a word or two; at most 40.");
    for (const example of (interactionSchema as Schema).properties.actions.items.properties.label.examples)
      expect(example.split(' ').length).toBeLessThanOrEqual(3);
  });

  it('every examples entry anywhere in the tool schemas validates against its own schema', () => {
    const ajv = new Ajv({ strict: false });
    let checked = 0;
    const walk = (schema: unknown): void => {
      if (!schema || typeof schema !== 'object') return;
      if (Array.isArray(schema)) return schema.forEach(walk);
      const s = schema as Schema;
      if (Array.isArray(s.examples)) {
        const validate = ajv.compile(s);
        for (const example of s.examples) {
          expect(validate(example), JSON.stringify(validate.errors)).toBe(true);
          checked++;
        }
      }
      for (const value of Object.values(s)) walk(value);
    };
    for (const t of TOOLS) walk(t.inputSchema);
    expect(checked).toBeGreaterThanOrEqual(20);
  });

  it('the complete examples pass the tools’ own checks; sess_ask’s description carries one', () => {
    expect(parseAskArgs(ASK_EXAMPLE).interaction.title).toBe(ASK_EXAMPLE.question);
    expect(parseRequestArgs({ interaction: INTERACTION_EXAMPLE }).interaction).toEqual(INTERACTION_EXAMPLE);
    const description = TOOLS.find((t) => t.name === 'sess_ask')!.description;
    expect(description).toContain(JSON.stringify(ASK_EXAMPLE));
    for (const t of TOOLS.filter((t) => t.name === 'sess_ask' || t.name === 'sess_request'))
      expect(t.description).toMatch(/field \(a JSON pointer\), the limit, its length and the fix/);
  });
});

function refused(run: () => unknown): AdapterError {
  try {
    run();
  } catch (error) {
    expect(error).toBeInstanceOf(AdapterError);
    return error as AdapterError;
  }
  throw new Error('expected INVALID_ARGUMENTS');
}

const base = () => structuredClone(INTERACTION_EXAMPLE) as Schema;
/** Each limit: where it is, how to set a value there, and the JSON pointer of that value. */
const REQUEST_CASES: [string, number, (i: Schema, v: string) => void, string][] = [
  ['title', TEXT_LIMITS.title, (i, v) => (i.title = v), '/interaction/title'],
  ['description', TEXT_LIMITS.description, (i, v) => (i.description = v), '/interaction/description'],
  [
    'heading',
    TEXT_LIMITS.heading,
    (i, v) => (i.source.components[0].text = v),
    '/interaction/source/components/0/text',
  ],
  [
    'record label',
    TEXT_LIMITS.recordLabel,
    (i, v) => (i.source.components[1].label = v),
    '/interaction/source/components/1/label',
  ],
  [
    'record value',
    TEXT_LIMITS.recordValue,
    (i, v) => (i.source.components[1].fields = { Total: v }),
    '/interaction/source/components/1/fields/Total',
  ],
  [
    'field label',
    TEXT_LIMITS.label,
    (i, v) => (i.source.components[2].label = v),
    '/interaction/source/components/2/label',
  ],
  [
    'field description',
    TEXT_LIMITS.help,
    (i, v) => (i.source.components[2].description = v),
    '/interaction/source/components/2/description',
  ],
  [
    'action label',
    TEXT_LIMITS.actionLabel,
    (i, v) => (i.actions[0].label = v),
    '/interaction/actions/0/label',
  ],
  [
    'option label',
    TEXT_LIMITS.optionLabel,
    (i, v) =>
      i.source.components.push({
        type: 'field',
        name: 'day',
        label: 'Which day?',
        schema: { type: 'string', enum: ['sat'] },
        option_labels: { sat: v },
      }),
    '/interaction/source/components/3/option_labels/sat',
  ],
  [
    'text',
    TEXT_LIMITS.text,
    (i, v) => i.source.components.push({ type: 'text', text: v }),
    '/interaction/source/components/3/text',
  ],
];

describe('every limit: N accepted, N+1 refused with field, limit, length and the fix', () => {
  for (const unit of ['x', 'é', '🦉']) {
    it.each(REQUEST_CASES)(`sess_request %s (${unit})`, (_, limit, set, field) => {
      const ok = base();
      set(ok, unit.repeat(limit));
      expect(() => parseRequestArgs({ interaction: ok })).not.toThrow();
      const over = base();
      set(over, unit.repeat(limit + 1));
      const error = refused(() => parseRequestArgs({ interaction: over }));
      expect(error.code).toBe('INVALID_ARGUMENTS');
      expect(error.toJSON()).toMatchObject({ field, limit, length: limit + 1, retryable: false });
      // Sess's own sentences: the title has its own; every other value names its pointer.
      expect(error.message).toBe(
        field === '/interaction/title'
          ? 'The title can be at most 80 characters. Keep it to a short heading, about 40.'
          : `${field} is ${limit + 1} characters; the limit is ${limit}. Shorten it to at most ${limit} characters.`,
      );
      // The value itself never appears in the error.
      expect(JSON.stringify(error.toJSON())).not.toContain(unit.repeat(limit));
    });
  }

  it('a record key over 40 is refused with a pointer ending with that key (escaped), as Sess’s', () => {
    const ok = base();
    ok.source.components[1].fields = { ['k'.repeat(40)]: 'v' };
    expect(() => parseRequestArgs({ interaction: ok })).not.toThrow();
    const key = `a/b~${'k'.repeat(37)}`;
    const over = base();
    over.source.components[1].fields = { [key]: 'v' };
    expect(refused(() => parseRequestArgs({ interaction: over })).toJSON()).toMatchObject({
      field: `/interaction/source/components/1/fields/a~1b~0${'k'.repeat(37)}`,
      limit: 40,
      length: 41,
    });
  });

  it.each([
    ['question', 80, (v: string) => ({ ...ASK_EXAMPLE, question: v }), '/question'],
    ['submit_label', 24, (v: string) => ({ ...ASK_EXAMPLE, submit_label: v }), '/submit_label'],
    [
      'field label',
      60,
      (v: string) => ({ ...ASK_EXAMPLE, fields: [{ ...ASK_EXAMPLE.fields[0], label: v }] }),
      '/fields/0/label',
    ],
    [
      'option',
      60,
      (v: string) => ({ ...ASK_EXAMPLE, fields: [{ ...ASK_EXAMPLE.fields[0], options: ['Beach', v] }] }),
      '/fields/0/options/1',
    ],
  ] as const)('sess_ask %s names the sess_ask argument', (_, limit, make, field) => {
    expect(() => parseAskArgs(make('🦉'.repeat(limit)))).not.toThrow();
    expect(refused(() => parseAskArgs(make('🦉'.repeat(limit + 1)))).toJSON()).toMatchObject({
      code: 'INVALID_ARGUMENTS',
      field,
      limit,
      length: limit + 1,
    });
  });

  it('at most 5 actions', () => {
    const ok = base();
    ok.actions = ['a', 'b', 'c', 'd', 'e'].map((id) => ({ id, label: 'Go' }));
    expect(() => parseRequestArgs({ interaction: ok })).not.toThrow();
    ok.actions.push({ id: 'f', label: 'Go' });
    expect(refused(() => parseRequestArgs({ interaction: ok })).message).toMatch(/1\.\.5 actions/);
  });

  describe('an unlabelled enum ID is the visible option text: held to 60 at its enum entry', () => {
    const withChoice = (schema: Schema, option_labels?: Record<string, string>) => {
      const i = base();
      i.source.components.push({
        type: 'field',
        name: 'pick',
        label: 'Pick one',
        schema,
        ...(option_labels ? { option_labels } : {}),
      });
      return { interaction: i };
    };
    const single = (id: string) => ({ type: 'string', enum: ['short', id] });
    const multi = (id: string) => ({ type: 'array', items: { type: 'string', enum: ['short', id] } });
    for (const unit of ['x', '🦉']) {
      it.each([
        ['enum', single, '/interaction/source/components/3/schema/enum/1'],
        ['items enum', multi, '/interaction/source/components/3/schema/items/enum/1'],
      ] as const)(`%s, no or partial labels (${unit})`, (_, schemaOf, field) => {
        for (const labels of [undefined, { short: 'Short' }]) {
          expect(() => parseRequestArgs(withChoice(schemaOf(unit.repeat(60)), labels))).not.toThrow();
          const error = refused(() => parseRequestArgs(withChoice(schemaOf(unit.repeat(61)), labels)));
          expect(error.toJSON()).toMatchObject({ code: 'INVALID_ARGUMENTS', field, limit: 60, length: 61 });
          expect(error.message).toBe(
            `${field} is 61 characters and has no option label, so it is shown as its label; the limit is 60. Give it an option label of at most 60 characters, or shorten it.`,
          );
        }
        // A long opaque ID stays legal when its visible label is short.
        const id = unit.repeat(200);
        expect(() => parseRequestArgs(withChoice(schemaOf(id), { [id]: 'Long one' }))).not.toThrow();
      });
    }
  });

  it('other errors carry no field, limit or length', () => {
    const error = refused(() => parseRequestArgs({ interaction: { ...base(), mode: 'display' } }));
    expect(Object.keys(error.toJSON()).sort()).toEqual(['code', 'message', 'retryable']);
  });
});

describe('a length error from Sess reaches the model', () => {
  let dir: ReturnType<typeof tempDir>;
  beforeEach(() => {
    dir = tempDir();
  });
  afterEach(() => dir.cleanup());

  it('CREATE_REJECTED carries field, limit and length when the SDK exposes them', async () => {
    const fake = new FakeSess();
    const real = clientFor(fake);
    const adapter = new SessMcpAdapter({
      env: env(dir.path),
      diagnostics: () => {},
      createClient: (config) => {
        const client = real(config);
        const create = async () => {
          throw Object.assign(
            new SessError('api', 'Sess refused the request.', {
              code: 'INVALID_SCHEMA',
              status: 400,
              outcome: 'rejected',
            }),
            { field: '/interaction/title', limit: 80, length: 81 },
          );
        };
        return { ...client, sessions: Object.assign(Object.create(client.sessions), { create }) };
      },
    });
    let error: unknown;
    try {
      await adapter.request(parseRequestArgs({ interaction: ROUND_1 }));
    } catch (e) {
      error = e;
    }
    expect(error).toBeInstanceOf(AdapterError);
    expect((error as AdapterError).toJSON()).toEqual({
      code: 'CREATE_REJECTED',
      message:
        'Sess did not create the interaction: The title can be at most 80 characters. Keep it to a short heading, about 40.',
      retryable: false,
      field: '/interaction/title',
      limit: 80,
      length: 81,
    });
  });
});
