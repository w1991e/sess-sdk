import { describe, expect, it } from 'vitest';
import { AdapterError } from '../src/errors.js';
import {
  LIMITS,
  parseCompleteArgs,
  parsePublishArgs,
  parseRequestArgs,
  parseResponseArgs,
} from '../src/validate.js';
import { ROUND_1, ROUND_2 } from './helpers.js';

const HANDLE = 'sh_AAAAAAAAAAAAAAAAAAAAAA';
const EVENT = 'evt_00000000000000000000000001';

function rejects(fn: () => unknown, fragment: string | RegExp): void {
  try {
    fn();
  } catch (error) {
    expect(error).toBeInstanceOf(AdapterError);
    expect((error as AdapterError).code).toBe('INVALID_ARGUMENTS');
    expect((error as AdapterError).message).toMatch(fragment);
    return;
  }
  throw new Error('expected INVALID_ARGUMENTS');
}
const clone = <T>(value: T): T => structuredClone(value);

describe('tool argument validation (closed, versioned schemas)', () => {
  it('accepts the shared plan-afternoon fixtures', () => {
    expect(parseRequestArgs({ interaction: ROUND_1 }).interaction).toEqual(ROUND_1);
    expect(
      parsePublishArgs({
        handle: HANDLE,
        expected_revision: 1,
        response_event_id: EVENT,
        interaction: ROUND_2,
      }).interaction,
    ).toEqual(ROUND_2);
  });

  it('rejects unknown top-level fields, including owner-only configuration', () => {
    for (const key of [
      'api_key',
      'origin',
      'base_url',
      'workspace_id',
      'session_id',
      'callback_url',
      'extra',
    ])
      rejects(() => parseRequestArgs({ interaction: ROUND_1, [key]: 'x' }), 'unknown property');
    rejects(
      () => parseResponseArgs({ handle: HANDLE, revision: 1, session_id: 'ses_x' }),
      'unknown property',
    );
    rejects(
      () =>
        parseCompleteArgs({ handle: HANDLE, expected_revision: 1, response_event_id: EVENT, force: true }),
      'unknown property',
    );
  });

  it('rejects unknown nested fields and unsupported components', () => {
    const extra = clone(ROUND_1) as any;
    extra.source.components[2].pattern = '.*';
    rejects(() => parseRequestArgs({ interaction: extra }), 'unknown property');
    const html = clone(ROUND_1) as any;
    html.source.components.push({ type: 'html', html: '<script></script>' });
    rejects(() => parseRequestArgs({ interaction: html }), 'heading, text, record or field');
    const schemaKeyword = clone(ROUND_1) as any;
    schemaKeyword.source.components[2].schema.pattern = '[a-z]+';
    rejects(() => parseRequestArgs({ interaction: schemaKeyword }), 'unknown property');
  });

  it('rejects unsafe keys at any depth, including JSON-parsed __proto__', () => {
    rejects(
      () => parseRequestArgs(JSON.parse(`{"interaction":${JSON.stringify(ROUND_1)},"__proto__":{"x":1}}`)),
      'unsafe key',
    );
    const nested = JSON.parse(
      JSON.stringify({ interaction: ROUND_1 }).replace('"value":2', '"value":2,"constructor":1'),
    );
    rejects(() => parseRequestArgs(nested), 'unsafe key');
    rejects(() => parseResponseArgs({ handle: HANDLE, revision: 1, prototype: 1 }), 'unsafe key');
  });

  it('rejects reserved object keys as field names at request time', () => {
    for (const name of ['constructor', 'prototype']) {
      const reserved = clone(ROUND_1) as any;
      reserved.source.components[2].name = name;
      rejects(() => parseRequestArgs({ interaction: reserved }), 'reserved name');
    }
    const proto = clone(ROUND_1) as any;
    proto.source.components[2].name = '__proto__';
    rejects(() => parseRequestArgs({ interaction: proto }), 'invalid format');
  });

  it('rejects oversized and deeply nested input without truncating', () => {
    const big = clone(ROUND_1) as any;
    big.description = 'x'.repeat(4000);
    big.source.components = Array.from({ length: 20 }, () => ({ type: 'text', text: 'y'.repeat(2000) }));
    rejects(() => parseRequestArgs({ interaction: big }), /serialized size exceeds/);
    let deep: any = 'leaf';
    for (let i = 0; i < LIMITS.depth + 2; i++) deep = { nested: deep };
    rejects(() => parseRequestArgs({ interaction: deep }), /nesting exceeds/);
    const manyActions = clone(ROUND_1) as any;
    manyActions.actions = Array.from({ length: LIMITS.actions + 1 }, (_, i) => ({ id: `a${i}`, label: 'A' }));
    rejects(() => parseRequestArgs({ interaction: manyActions }), /1\.\.5 actions/);
    const manyFields = clone(ROUND_1) as any;
    manyFields.source.components = Array.from({ length: LIMITS.fields + 1 }, (_, i) => ({
      type: 'field',
      name: `f${i}`,
      label: 'F',
      schema: { type: 'boolean' },
    }));
    rejects(() => parseRequestArgs({ interaction: manyFields }), /at most 24 fields/);
  });

  it('rejects structural defects before any state write', () => {
    rejects(
      () => parseRequestArgs({ interaction: { ...ROUND_1, mode: 'display' } }),
      'must be "interactive"',
    );
    const dup = clone(ROUND_1) as any;
    dup.source.components.push(clone(dup.source.components[2]));
    rejects(() => parseRequestArgs({ interaction: dup }), 'duplicates another field');
    const control = clone(ROUND_1) as any;
    control.title = 'Plan ‮ reversed';
    rejects(() => parseRequestArgs({ interaction: control }), 'control or bidirectional');
    rejects(() => parseRequestArgs({ interaction: { ...ROUND_1, title: '   ' } }), 'blank');
    rejects(() => parseRequestArgs({}), 'missing required property "interaction"');
    rejects(() => parseRequestArgs([ROUND_1]), 'must be an object');
  });

  it('bounds handles, revisions and waits', () => {
    expect(parseResponseArgs({ handle: HANDLE, revision: 1 })).toEqual({ handle: HANDLE, revision: 1 });
    expect(parseResponseArgs({ handle: HANDLE, revision: 2, wait_ms: 0 }).waitMs).toBe(0);
    rejects(
      () => parseResponseArgs({ handle: HANDLE, revision: 1, wait_ms: LIMITS.maxWaitMs + 1 }),
      'wait_ms',
    );
    rejects(() => parseResponseArgs({ handle: HANDLE, revision: 1, wait_ms: Infinity }), 'finite');
    rejects(() => parseResponseArgs({ handle: HANDLE, revision: 0 }), 'revision');
    rejects(() => parseResponseArgs({ handle: HANDLE, revision: 1.5 }), 'revision');
    rejects(() => parseResponseArgs({ handle: 'ses_00000000000000000000000001', revision: 1 }), 'handle');
    rejects(
      () => parseCompleteArgs({ handle: HANDLE, expected_revision: 1, response_event_id: 'evt_x' }),
      'response_event_id',
    );
  });
});
