// A value over its length limit, from sess.ask()'s own check or from Sess (400 INVALID_SCHEMA):
// the SessError carries field (a JSON pointer), limit and length, and its message ends with the
// fix, so a model can shorten the value and ask again in one try. Nothing is ever truncated.
import { inspect } from 'node:util';
import { describe, expect, it, vi } from 'vitest';
import { Sess, SessError } from '../../src/index.js';
import { compileAsk } from '../../src/ask.js';
// Test-only parity oracle: the MCP adapter applies the same sess_ask limits to the same paths.
import { parseAskArgs } from '../../adapters/mcp/src/validate.js';
import { API_KEY, INTERACTION, apiError } from '../fixtures/api.js';

const field = { name: 'place', label: 'Where to?', type: 'choice', options: ['Beach', 'City'] } as const;
const question = { question: 'Where should we go on Saturday?', fields: [field] };

function caught(run: () => unknown): SessError {
  try {
    run();
  } catch (error) {
    expect(error).toBeInstanceOf(SessError);
    return error as SessError;
  }
  throw new Error('expected a SessError');
}

const ASK_CASES = [
  ['question', 80, (v: string) => ({ ...question, question: v }), '/question'],
  ['submit_label', 24, (v: string) => ({ ...question, submit_label: v }), '/submit_label'],
  ['field label', 60, (v: string) => ({ ...question, fields: [{ ...field, label: v }] }), '/fields/0/label'],
  [
    'option',
    60,
    (v: string) => ({ ...question, fields: [{ ...field, options: ['Beach', v] }] }),
    '/fields/0/options/1',
  ],
  ['details', 4000, (v: string) => ({ ...question, details: v }), '/details'],
] as const;

describe('sess.ask() length limits, in code points', () => {
  for (const unit of ['x', 'é', '🦉']) {
    it.each(ASK_CASES)(
      `%s: N accepted, N+1 refused with field, limit, length (${unit})`,
      (_, limit, make, pointer) => {
        expect(() => compileAsk(make(unit.repeat(limit)))).not.toThrow();
        expect(() => parseAskArgs(make(unit.repeat(limit)))).not.toThrow();
        const error = caught(() => compileAsk(make(unit.repeat(limit + 1))));
        expect(error).toMatchObject({
          kind: 'configuration',
          code: 'INVALID_QUESTION',
          outcome: 'not_sent',
          field: pointer,
          limit,
          length: limit + 1,
        });
        // Sess's own sentences: the title (the question) has its own; others name the pointer.
        expect(error.message).toBe(
          pointer === '/question'
            ? 'The title can be at most 80 characters. Keep it to a short heading, about 40.'
            : `${pointer} is ${limit + 1} characters; the limit is ${limit}. Shorten it to at most ${limit} characters.`,
        );
        expect(error.message).not.toContain(unit.repeat(limit));
        expect(error.toJSON()).toMatchObject({ field: pointer, limit, length: limit + 1 });
        // The MCP sess_ask applies the same limit at the same path.
        let mcp: unknown;
        try {
          parseAskArgs(make(unit.repeat(limit + 1)));
        } catch (e) {
          mcp = e;
        }
        expect((mcp as { toJSON(): object }).toJSON()).toMatchObject({
          field: pointer,
          limit,
          length: limit + 1,
        });
      },
    );
  }

  it('is refused before any credential or network access', async () => {
    const fetch = vi.fn();
    const apiKey = vi.fn(() => API_KEY);
    const sess = new Sess({ apiKey, fetch });
    await expect(sess.ask({ ...question, question: 'q'.repeat(81) })).rejects.toMatchObject({
      field: '/question',
      limit: 80,
      length: 81,
      outcome: 'not_sent',
    });
    expect(apiKey).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });

  it('other ask errors carry no field, limit or length', () => {
    const error = caught(() => compileAsk({ ...question, question: '   ' }));
    expect(error.field).toBeUndefined();
    expect(error.limit).toBeUndefined();
    expect(error.length).toBeUndefined();
  });
});

describe('a length refusal from Sess (400 INVALID_SCHEMA)', () => {
  const create = async (body: Record<string, unknown>, code = 'INVALID_SCHEMA') => {
    const fetch = vi.fn(async () => apiError(400, code, body));
    const sess = new Sess({ apiKey: API_KEY, fetch });
    try {
      await sess.sessions.create({ interaction: INTERACTION });
    } catch (error) {
      expect(error).toBeInstanceOf(SessError);
      return error as SessError;
    }
    throw new Error('expected a rejection');
  };

  it('keeps field, limit and length, names the fix, and is an authoritative rejection', async () => {
    const error = await create({ field: '/interaction/title', limit: 80, length: 95 });
    expect(error).toMatchObject({
      kind: 'api',
      code: 'INVALID_SCHEMA',
      status: 400,
      outcome: 'rejected',
      field: '/interaction/title',
      limit: 80,
      length: 95,
    });
    expect(error.message).toBe(
      'The title can be at most 80 characters. Keep it to a short heading, about 40.',
    );
    const label = await create({ field: '/interaction/actions/0/label', limit: 24, length: 30 });
    expect(label.message).toBe(
      '/interaction/actions/0/label is 30 characters; the limit is 24. Shorten it to at most 24 characters.',
    );
    // A record key ends the pointer (Sess's shape), and survives.
    const key = await create({
      field: '/interaction/source/components/0/fields/A row name that is far too long here',
      limit: 40,
      length: 41,
    });
    expect(key.field).toBe('/interaction/source/components/0/fields/A row name that is far too long here');
    expect(JSON.parse(JSON.stringify(error))).toMatchObject({
      field: '/interaction/title',
      limit: 80,
      length: 95,
    });
    expect(inspect(error)).not.toContain(API_KEY);
    expect(JSON.stringify(error)).not.toContain('remote secret');
  });

  it.each([
    ['no field', { limit: 80, length: 95 }],
    ['a non-pointer field', { field: 'interaction.title', limit: 80, length: 95 }],
    ['a field with a control character', { field: '/interaction/ti\u0007tle', limit: 80, length: 95 }],
    ['a credential-shaped field', { field: '/sess_sk_abcdef', limit: 80, length: 95 }],
    ['a non-integer limit', { field: '/interaction/title', limit: 80.5, length: 95 }],
    ['a negative length', { field: '/interaction/title', limit: 80, length: -1 }],
    ['a length within the limit', { field: '/interaction/title', limit: 80, length: 80 }],
  ])('drops all three for %s', async (_, body) => {
    const error = await create(body);
    expect(error.field).toBeUndefined();
    expect(error.limit).toBeUndefined();
    expect(error.length).toBeUndefined();
    expect(error.message).toBe('The Sess API returned an error. See the status and code fields.');
  });

  it('ignores them on any other code', async () => {
    const error = await create({ field: '/interaction/title', limit: 80, length: 95 }, 'UNKNOWN_COMPONENT');
    expect(error.field).toBeUndefined();
  });
});
