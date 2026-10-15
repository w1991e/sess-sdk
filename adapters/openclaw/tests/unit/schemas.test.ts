import { describe, expect, it } from 'vitest';
import {
  LIMITS,
  TOOL_PARAMETERS,
  parseCompleteArgs,
  parsePublishArgs,
  parseRequestArgs,
  parseResponseArgs,
} from '../../src/schemas.js';
import { fixtures } from './harness.js';

const base = () => fixtures('round-1.json');
const reject = (mutate: (i: any) => unknown, pattern: RegExp = /INVALID_ARGUMENTS/) => {
  const interaction = base();
  const replaced = mutate(interaction);
  expect(() => parseRequestArgs({ interaction: replaced ?? interaction })).toThrow(pattern);
};

describe('closed, bounded tool schemas', () => {
  it('accepts the shared fixtures', () => {
    expect(parseRequestArgs({ interaction: base() }).interaction.title).toBe('Plan an afternoon');
    expect(parseRequestArgs({ interaction: fixtures('round-2.json') }).interaction.actions[0]!.id).toBe(
      'confirm',
    );
  });

  it('rejects unknown properties at every level', () => {
    expect(() => parseRequestArgs({ interaction: base(), extra: 1 })).toThrow(/unknown property/);
    reject((i) => void (i.extra = true));
    reject((i) => void (i.source.extra = true));
    reject((i) => void (i.source.components[2].extra = true));
    reject((i) => void (i.actions[0].extra = true));
    reject((i) => void (i.source.components[2].schema.pattern = '.*'));
  });

  it('rejects invalid values, defaults and option labels', () => {
    reject((i) => void (i.mode = 'display'));
    reject((i) => void (i.title = '   '));
    reject((i) => void (i.source.components[2].value = 'skydiving'));
    reject((i) => void (i.source.components[3].value = 2.5));
    reject((i) => void (i.source.components[3].value = 99));
    reject((i) => void (i.source.components[2].option_labels.ski = 'Ski'));
    reject((i) => void i.source.components.push({ type: 'html', html: '<script>' }));
    reject((i) => void (i.actions[0].intent = 'pay'));
    reject((i) => void (i.source.components[0].text = 'bad\u0000text'));
  });

  it('rejects duplicate field names and action IDs', () => {
    reject((i) => void i.source.components.push({ ...i.source.components[2] }), /unique/);
    reject((i) => void i.actions.push({ id: 'submit', label: 'Again' }), /unique/);
  });

  it('rejects oversized, over-count and deeply nested input without truncation', () => {
    // Contract "Validation": interaction <= 32 KiB serialized, arguments <= 40 KiB.
    const texts = (n: number) => Array.from({ length: n }, () => ({ type: 'text', text: 'x'.repeat(4000) }));
    reject((i) => void i.source.components.push(...texts(8)), /exceeds 32768 bytes serialized/);
    reject((i) => void i.source.components.push(...texts(11)), /arguments exceed 40960 bytes/);
    reject((i) => {
      i.actions = Array.from({ length: LIMITS.actions + 1 }, (_, n) => ({ id: `a${n}`, label: `A${n}` }));
    });
    reject((i) => {
      i.source.components = Array.from({ length: LIMITS.fields + 1 }, (_, n) => ({
        type: 'field',
        name: `f${n}`,
        label: `F${n}`,
        schema: { type: 'boolean' },
      }));
    });
    let deep: Record<string, unknown> = { leaf: 1 };
    for (let n = 0; n < LIMITS.depth + 2; n++) deep = { nested: deep };
    reject((i) => void (i.source.components[1] = { type: 'record', fields: deep }), /nesting|values must be/);
  });

  it('rejects unsafe keys, cycles, accessors and non-JSON values', () => {
    reject(() => JSON.parse(`{"mode":"interactive","__proto__":{"x":1}}`), /unsafe object key/);
    const cyclic = base();
    cyclic.self = cyclic;
    expect(() => parseRequestArgs({ interaction: cyclic })).toThrow(/cyclic/);
    const accessor = base();
    Object.defineProperty(accessor, 'title', { get: () => 'x', enumerable: true });
    expect(() => parseRequestArgs({ interaction: accessor })).toThrow(/accessor/);
    reject((i) => void (i.source.components[3].value = Number.NaN), /finite/);
    reject((i) => void (i.source.components[3].value = 10n as unknown as number), /JSON/);
  });

  it('closes the handle/revision/event arguments', () => {
    const handle = `ih_${'A'.repeat(24)}`;
    expect(parseResponseArgs({ handle, revision: 1 })).toEqual({ handle, revision: 1 });
    expect(() => parseResponseArgs({ handle: 'ses_123', revision: 1 })).toThrow(/handle/);
    expect(() => parseResponseArgs({ handle, revision: 0 })).toThrow(/revision/);
    expect(() => parseResponseArgs({ handle, revision: 1, wait_ms: LIMITS.maxWaitArgMs + 1 })).toThrow(
      /wait_ms/,
    );
    expect(() => parseCompleteArgs({ handle, expected_revision: 1, response_event_id: 'bad id!' })).toThrow(
      /eventId/,
    );
    expect(() => parsePublishArgs({ handle, expected_revision: 1, response_event_id: 'evt_1' })).toThrow(
      /missing/,
    );
  });

  it('no tool schema exposes origin, credential, workspace, session or callback inputs', () => {
    const allowed: Record<string, string[]> = {
      sess_request: ['interaction'],
      sess_response: ['handle', 'revision', 'wait_ms'],
      sess_publish: ['handle', 'expected_revision', 'response_event_id', 'interaction'],
      sess_complete: ['handle', 'expected_revision', 'response_event_id'],
    };
    for (const [name, schema] of Object.entries(TOOL_PARAMETERS)) {
      expect(Object.keys(schema.properties).sort()).toEqual(allowed[name]!.sort());
      expect(schema.additionalProperties).toBe(false);
    }
  });
});
