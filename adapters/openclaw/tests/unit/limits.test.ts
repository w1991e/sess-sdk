// Sess's length limits for what a person reads, as the OpenClaw tool schema teaches them and as
// every call enforces them: N accepted, N+1 refused (in code points) with field, limit, length and
// the fix; nothing truncated.
import { describe, expect, it } from 'vitest';
import { SessAdapterError } from '../../src/errors.js';
import { INTERACTION_SCHEMA, TEXT_LIMITS, parseRequestArgs } from '../../src/schemas.js';

type Schema = Record<string, any>;
const root = INTERACTION_SCHEMA as Schema;
const components = root.properties.source.properties.components.items.anyOf as Schema[];
const component = (type: string) => components.find((c) => c.properties.type.enum[0] === type)!.properties;
const EXAMPLE = root.examples[0] as Schema;

const VISIBLE: [string, Schema, number][] = [
  ['title', root.properties.title, 80],
  ['description', root.properties.description, 280],
  ['heading', component('heading').text, 60],
  ['text', component('text').text, 4000],
  ['record label', component('record').label, 200],
  ['record value', component('record').fields.additionalProperties, 200],
  ['field label', component('field').label, 60],
  ['field description', component('field').description, 160],
  ['option label', component('field').option_labels.additionalProperties, 60],
  ['action label', root.properties.actions.items.properties.label, 24],
];

describe('the tool schema teaches the limits', () => {
  it.each(VISIBLE)('%s: one-line description, maxLength and examples within it', (_, schema, limit) => {
    expect(schema.maxLength).toBe(limit);
    expect(schema.description).toContain(`at most ${limit}`);
    expect(schema.description).not.toContain('\n');
    expect(schema.examples.length).toBeGreaterThan(0);
    for (const example of schema.examples) {
      expect([...example].length).toBeLessThanOrEqual(limit);
      if (schema.pattern) expect(example).toMatch(new RegExp(schema.pattern));
    }
  });

  it('mirrors Sess’s wording exactly; example titles are under 40', () => {
    expect(root.properties.title.description).toBe(
      "The page's heading: a question or a task, about 40 characters; at most 80.",
    );
    expect(root.properties.actions.items.properties.label.description).toBe(
      'A button: a verb, 1–3 words; at most 24.',
    );
    for (const title of [...root.properties.title.examples, EXAMPLE.title])
      expect([...title].length).toBeLessThan(40);
  });

  it('the complete example passes the adapter’s own validation', () => {
    expect(parseRequestArgs({ interaction: EXAMPLE }).interaction).toEqual(EXAMPLE);
    expect(component('record').fields.description).toContain('at most 40');
  });
});

function refused(interaction: Schema): SessAdapterError {
  try {
    parseRequestArgs({ interaction });
  } catch (error) {
    expect(error).toBeInstanceOf(SessAdapterError);
    return error as SessAdapterError;
  }
  throw new Error('expected INVALID_ARGUMENTS');
}

const CASES: [string, number, (i: Schema, v: string) => void, string | ((v: string) => string)][] = [
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
    'record key',
    TEXT_LIMITS.recordKey,
    (i, v) => (i.source.components[1].fields = { [v]: 'x' }),
    // As Sess's, the pointer ends with that key.
    (v) => `/interaction/source/components/1/fields/${v}`,
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
    it.each(CASES)(`%s (${unit})`, (_, limit, set, at) => {
      const ok = structuredClone(EXAMPLE);
      set(ok, unit.repeat(limit));
      expect(() => parseRequestArgs({ interaction: ok })).not.toThrow();
      const over = structuredClone(EXAMPLE);
      set(over, unit.repeat(limit + 1));
      const field = typeof at === 'string' ? at : at(unit.repeat(limit + 1));
      const error = refused(over);
      expect(error.code).toBe('INVALID_ARGUMENTS');
      expect(error.toJSON()).toMatchObject({ field, limit, length: limit + 1 });
      // Sess's own sentences: the title has its own; every other value names its pointer.
      expect(error.message).toBe(
        field === '/interaction/title'
          ? 'INVALID_ARGUMENTS: The title can be at most 80 characters. Keep it to a short heading, about 40.'
          : `INVALID_ARGUMENTS: ${field} is ${limit + 1} characters; the limit is ${limit}. Shorten it to at most ${limit} characters.`,
      );
    });
  }

  describe('an unlabelled enum ID is the visible option text: held to 60 at its enum entry', () => {
    const withChoice = (schema: Schema, option_labels?: Record<string, string>) => {
      const i = structuredClone(EXAMPLE);
      i.source.components.push({
        type: 'field',
        name: 'pick',
        label: 'Pick one',
        schema,
        ...(option_labels ? { option_labels } : {}),
      });
      return i;
    };
    const single = (id: string) => ({ type: 'string', enum: ['short', id] });
    const multi = (id: string) => ({ type: 'array', items: { type: 'string', enum: ['short', id] } });
    for (const unit of ['x', '🦉']) {
      it.each([
        ['enum', single, '/interaction/source/components/3/schema/enum/1'],
        ['items enum', multi, '/interaction/source/components/3/schema/items/enum/1'],
      ] as const)(`%s, no or partial labels (${unit})`, (_, schemaOf, field) => {
        for (const labels of [undefined, { short: 'Short' }]) {
          expect(() =>
            parseRequestArgs({ interaction: withChoice(schemaOf(unit.repeat(60)), labels) }),
          ).not.toThrow();
          const error = refused(withChoice(schemaOf(unit.repeat(61)), labels));
          expect(error.toJSON()).toMatchObject({ code: 'INVALID_ARGUMENTS', field, limit: 60, length: 61 });
          expect(error.message).toBe(
            `INVALID_ARGUMENTS: ${field} is 61 characters and has no option label, so it is shown as its label; the limit is 60. Give it an option label of at most 60 characters, or shorten it.`,
          );
        }
        const id = unit.repeat(200);
        expect(() =>
          parseRequestArgs({ interaction: withChoice(schemaOf(id), { [id]: 'Long one' }) }),
        ).not.toThrow();
      });
    }
  });

  it('other errors carry no field, limit or length', () => {
    const error = refused({ ...structuredClone(EXAMPLE), mode: 'display' });
    expect(error.toJSON()).not.toHaveProperty('field');
    expect(error.limit).toBeUndefined();
  });
});
