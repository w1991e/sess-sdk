import { describe, expect, it } from 'vitest';
import { AdapterError } from '../src/errors.js';
import { TOOLS } from '../src/tools.js';
import { parseAskArgs, parseRequestArgs } from '../src/validate.js';

/** Sess's rating field (P2-24(h)): an integer from 1 to `max`, 2–10; sess_ask's default is 5. */
function refused(fn: () => unknown): AdapterError {
  try {
    fn();
  } catch (error) {
    expect(error).toBeInstanceOf(AdapterError);
    return error as AdapterError;
  }
  throw new Error('expected INVALID_ARGUMENTS');
}
const ask = (field: Record<string, unknown>) =>
  parseAskArgs({
    question: 'How did we do?',
    fields: [{ name: 'visit', label: 'Your visit', type: 'rating', ...field }],
  });
const request = (component: Record<string, unknown>) =>
  parseRequestArgs({
    interaction: {
      mode: 'interactive',
      title: 'How did we do?',
      source: {
        kind: 'sess_surface',
        components: [{ type: 'field', name: 'visit', label: 'Your visit', ...component }],
      },
      actions: [{ id: 'send', label: 'Send' }],
    },
  });

describe('sess_ask and sess_request take a rating', () => {
  it('sess_ask: type rating is five stars; max 2–10 and the end labels compile to Sess’s field', () => {
    const components = (field: Record<string, unknown>) =>
      (ask(field).interaction.source as { components: unknown[] }).components;
    expect(components({})).toEqual([
      {
        type: 'field',
        name: 'visit',
        label: 'Your visit',
        required: true,
        rating: {},
        schema: { type: 'integer', minimum: 1, maximum: 5 },
      },
    ]);
    expect(
      components({ max: 10, low: 'Not likely', high: 'Very likely', required: false, default: 8 }),
    ).toEqual([
      {
        type: 'field',
        name: 'visit',
        label: 'Your visit',
        required: false,
        rating: { low: 'Not likely', high: 'Very likely' },
        schema: { type: 'integer', minimum: 1, maximum: 10 },
        value: 8,
      },
    ]);
    for (const max of [1, 11, 2.5, '5'])
      expect(refused(() => ask({ max })).message).toBe('fields[0].max: must be a whole number from 2 to 10');
    expect(refused(() => ask({ low: 'x'.repeat(25) })).tooLong).toEqual({
      field: '/fields/0/low',
      limit: 24,
      length: 25,
    });
    expect(
      refused(() =>
        parseAskArgs({ question: 'Q', fields: [{ name: 'a', label: 'A', type: 'integer', max: 5 }] }),
      ).message,
    ).toBe('fields[0]: max/low/high are only allowed for rating');
  });

  it('sess_request: a raw rating field passes with its exact schema and is refused with any other', () => {
    const ok = request({
      rating: { high: 'Great' },
      schema: { type: 'integer', minimum: 1, maximum: 5, title: 'Visit' },
    });
    expect((ok.interaction.source as { components: unknown[] }).components[0]).toMatchObject({
      rating: { high: 'Great' },
    });
    for (const schema of [
      { type: 'integer', minimum: 1, maximum: 1 },
      { type: 'integer', minimum: 2, maximum: 5 },
      { type: 'string', enum: ['1', '2'] },
      { type: 'integer', minimum: 1, maximum: 5, exclusiveMinimum: 0 },
    ])
      expect(refused(() => request({ rating: {}, schema })).message).toBe(
        'interaction.source.components[0].schema: must be exactly {"type": "integer", "minimum": 1, "maximum": N} for a rating, with N from 2 to 10',
      );
    expect(
      refused(() => request({ rating: { mid: 'x' }, schema: { type: 'integer', minimum: 1, maximum: 5 } }))
        .message,
    ).toMatch(/rating/);
  });

  it('the tool schemas list the rating: sess_ask type, max, low and high; sess_request and sess_publish a field’s rating', () => {
    const askTool = TOOLS.find((t) => t.name === 'sess_ask')!;
    const field = (askTool.inputSchema.properties.fields as { items: { properties: Record<string, any> } })
      .items.properties;
    expect(field.type.enum).toContain('rating');
    expect(field.max).toMatchObject({ type: 'integer', minimum: 2, maximum: 10 });
    expect(field.low).toMatchObject({ type: 'string', maxLength: 24 });
    expect(field.high).toMatchObject({ type: 'string', maxLength: 24 });
    for (const name of ['sess_request', 'sess_publish'] as const)
      expect(JSON.stringify(TOOLS.find((t) => t.name === name)!.inputSchema)).toContain(
        '"rating":{"type":"object"',
      );
  });
});
