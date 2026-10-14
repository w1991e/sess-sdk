// Alignment with adapters/CONTRACT.md after G1 convergence. Each block names its contract section.
import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ERROR_CLASSES } from '../../src/errors.js';
import { parseRequestArgs } from '../../src/schemas.js';
import { API_KEY, API_KEY_ENV, FakeSess, call, conversation, fixtures, registerPlugin } from './harness.js';

let sess: FakeSess;
beforeEach(() => {
  sess = new FakeSess();
  vi.stubGlobal('fetch', sess.fetch);
  vi.stubEnv(API_KEY_ENV, API_KEY);
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

const round1 = () => fixtures('round-1.json');
const writes = () => sess.requests.filter((r) => r.method !== 'GET');

async function started() {
  const host = await registerPlugin();
  const conv = conversation();
  const { handle } = (await call(host, 'sess_request', conv, { interaction: round1() })).details.interaction;
  return { host, conv, handle: handle as string };
}

async function answered() {
  const ctx = await started();
  const eventId = sess.answer(1, 'submit', { activity: 'museum', hours: 3 });
  await call(ctx.host, 'sess_response', ctx.conv, { handle: ctx.handle, revision: 1, wait_ms: 0 });
  return { ...ctx, eventId };
}

/** Makes the next compare-and-apply whose value matches `when` fail (store fault or lost race). */
function failNextApply(
  host: Awaited<ReturnType<typeof registerPlugin>>,
  when: (value: any) => boolean,
  mode: 'throw' | 'conflict',
) {
  const view = host.store.withCurrent.bind(host.store);
  let armed = true;
  host.store.withCurrent = (authority) => {
    const bound = view(authority);
    const apply = bound.compareAndApply;
    bound.compareAndApply = async (key, comparison, intent) => {
      if (armed && when(intent.value)) {
        armed = false;
        if (mode === 'throw') throw new Error('disk full');
        return { status: 'conflict', current: { value: undefined, comparison: '' } };
      }
      return apply(key, comparison, intent);
    };
    return bound;
  };
}

describe('Create outcomes', () => {
  it('a confirmed create that cannot be saved is created_not_saved and must not be repeated', async () => {
    const host = await registerPlugin();
    failNextApply(host, (v) => v.state === 'waiting', 'throw');
    const error = await call(host, 'sess_request', conversation(), { interaction: round1() }).catch((e) => e);
    expect(error.code).toBe('CREATED_NOT_SAVED');
    expect(error.errorClass).toBe('created_not_saved');
    expect(error.message).toMatch(/was created .*Do not repeat/);
    expect(error.message).not.toContain('/s/');
    expect(sess.requests.filter((r) => r.path === '/v1/sessions')).toHaveLength(1);
  });

  it('a definitive non-create is create_rejected, and a redelivery reports the same class and sends nothing', async () => {
    const host = await registerPlugin();
    const conv = conversation();
    sess.intercept = (method, path) =>
      method === 'POST' && path === '/v1/sessions'
        ? new Response('{"error":{"code":"INVALID_SCHEMA","message":"bad"}}', {
            status: 400,
            headers: { 'content-type': 'application/json' },
          })
        : undefined;
    await expect(
      call(host, 'sess_request', conv, { interaction: round1() }, { toolCallId: 'r' }),
    ).rejects.toThrow(/^CREATE_REJECTED: /);
    const before = sess.requests.length;
    await expect(
      call(host, 'sess_request', conv, { interaction: round1() }, { toolCallId: 'r' }),
    ).rejects.toThrow(/^CREATE_REJECTED: /);
    expect(sess.requests.length).toBe(before);
  });
});

describe('Response outcomes', () => {
  it('read-once (wait_ms 0) with no answer while open is waiting', async () => {
    const { host, conv, handle } = await started();
    const read = await call(host, 'sess_response', conv, { handle, revision: 1, wait_ms: 0 });
    expect(read.details.interaction).toEqual({ handle, revision: 1, state: 'waiting' });
  });

  it('read-once on a Session closed without a response blocks', async () => {
    const { host, conv, handle } = await started();
    sess.status = 'completed';
    await expect(call(host, 'sess_response', conv, { handle, revision: 1, wait_ms: 0 })).rejects.toThrow(
      /^RECOVERY_BLOCKED: /,
    );
    sess.status = 'active';
    await expect(call(host, 'sess_response', conv, { handle, revision: 1, wait_ms: 0 })).rejects.toThrow(
      /^RECOVERY_BLOCKED: .*operator/,
    );
  });

  it('read-once on a superseded revision blocks', async () => {
    const { host, conv, handle } = await started();
    sess.revision = 2;
    sess.surfaces.set(2, round1());
    await expect(call(host, 'sess_response', conv, { handle, revision: 1, wait_ms: 0 })).rejects.toThrow(
      /^RECOVERY_BLOCKED: /,
    );
  });

  for (const waitMs of [0, 1000])
    it(`an answer whose Session moved past the revision blocks before any data is released (wait_ms ${waitMs})`, async () => {
      const { host, conv, handle } = await started();
      sess.answer(1, 'submit', { activity: 'museum', hours: 3 });
      sess.revision = 2;
      sess.status = 'active';
      sess.surfaces.set(2, fixtures('round-2.json'));
      const outcome = await call(host, 'sess_response', conv, { handle, revision: 1, wait_ms: waitMs }).catch(
        (e) => e,
      );
      expect(outcome.code).toBe('RECOVERY_BLOCKED');
      expect(JSON.stringify(outcome)).not.toContain('museum');
    });

  it('VERIFICATION_CONTEXT_MISSING is a configuration error naming expectedWorkspaceId, with no state change', async () => {
    const { host, conv, handle } = await started();
    const eventId = sess.answer(1, 'submit', { activity: 'museum', hours: 3 });
    sess.omitWorkspace = true;
    const error = await call(host, 'sess_response', conv, { handle, revision: 1, wait_ms: 0 }).catch(
      (e) => e,
    );
    expect(error.code).toBe('CONFIGURATION');
    expect(error.message).toContain('plugins.entries.sess.config.expectedWorkspaceId');
    sess.omitWorkspace = false;
    const ok = await call(host, 'sess_response', conv, { handle, revision: 1, wait_ms: 0 });
    expect(ok.details.interaction.response.eventId).toBe(eventId);
  });

  it('a block is reported only once persisted; a lost compare-and-apply reports a conflict', async () => {
    const { host, conv, handle } = await started();
    sess.answer(1, 'submit', { activity: 'museum', hours: 3 }, { tamper: true });
    failNextApply(host, (v) => v.state === 'blocked', 'conflict');
    await expect(call(host, 'sess_response', conv, { handle, revision: 1, wait_ms: 0 })).rejects.toThrow(
      /^STATE_CONFLICT: /,
    );
    // Not blocked: the next read reaches verification again and then blocks for real.
    await expect(call(host, 'sess_response', conv, { handle, revision: 1, wait_ms: 0 })).rejects.toThrow(
      /^VERIFICATION_FAILED: /,
    );
  });
});

describe('Replay', () => {
  it('an exact repeat of a confirmed publish returns waiting at expected_revision + 1 without network', async () => {
    const { host, conv, handle, eventId } = await answered();
    const args = {
      handle,
      expected_revision: 1,
      response_event_id: eventId,
      interaction: fixtures('round-2.json'),
    };
    await call(host, 'sess_publish', conv, args);
    const before = sess.requests.length;
    const repeat = await call(host, 'sess_publish', conv, JSON.parse(JSON.stringify(args)));
    expect(repeat.details.interaction).toEqual({ handle, revision: 2, state: 'waiting' });
    expect(sess.requests.length).toBe(before);
    const changed = { ...args, interaction: { ...args.interaction, title: 'Something else' } };
    await expect(call(host, 'sess_publish', conv, changed)).rejects.toThrow(/^STATE_CONFLICT: /);
    expect(sess.requests.length).toBe(before);
    expect(writes().filter((r) => r.method === 'PATCH')).toHaveLength(1);
  });
});

describe('Mutation outcomes: SESSION_COMPLETED on complete', () => {
  it('a 409 SESSION_COMPLETED read back as completed at expected_revision is recorded completed', async () => {
    const { host, conv, handle, eventId } = await answered();
    sess.intercept = (method, path) => {
      if (method === 'POST' && path.endsWith('/complete')) {
        sess.status = 'completed';
        return new Response('{"error":{"code":"SESSION_COMPLETED","message":"done"}}', {
          status: 409,
          headers: { 'content-type': 'application/json' },
        });
      }
      return undefined;
    };
    const done = await call(host, 'sess_complete', conv, {
      handle,
      expected_revision: 1,
      response_event_id: eventId,
    });
    expect(done.details.interaction).toEqual({ handle, revision: 1, state: 'completed' });
  });

  it('a Session already completed at expected_revision before dispatch is confirmed without a write', async () => {
    const { host, conv, handle, eventId } = await answered();
    sess.status = 'completed';
    const before = writes().length;
    const done = await call(host, 'sess_complete', conv, {
      handle,
      expected_revision: 1,
      response_event_id: eventId,
    });
    expect(done.details.interaction.state).toBe('completed');
    expect(writes().length).toBe(before);
  });

  it('SESSION_COMPLETED at another revision blocks', async () => {
    const { host, conv, handle, eventId } = await answered();
    sess.intercept = (method, path) => {
      if (method === 'POST' && path.endsWith('/complete')) {
        sess.status = 'completed';
        sess.revision = 2;
        sess.surfaces.set(2, round1());
        return new Response('{"error":{"code":"SESSION_COMPLETED","message":"done"}}', {
          status: 409,
          headers: { 'content-type': 'application/json' },
        });
      }
      return undefined;
    };
    await expect(
      call(host, 'sess_complete', conv, { handle, expected_revision: 1, response_event_id: eventId }),
    ).rejects.toThrow(/^MUTATION_REJECTED: /);
  });
});

describe('Validation', () => {
  it('reserves the field names constructor and prototype', () => {
    for (const name of ['constructor', 'prototype']) {
      const interaction = round1();
      interaction.source.components[2].name = name;
      expect(() => parseRequestArgs({ interaction })).toThrow(/reserved field name/);
    }
  });

  it('rejects C0 (except tab/LF/CR), DEL, C1 and bidi overrides in every string, including values', () => {
    const bad = ['\u0000', '\u0007', '\u007f', '\u0085', '\u009f', '‪', '‮', '⁦', '⁩'];
    for (const ch of bad) {
      const inValue = round1();
      inValue.source.components[1] = { type: 'record', fields: { note: `a${ch}b` } };
      expect(() => parseRequestArgs({ interaction: inValue })).toThrow(/control or bidirectional/);
      const inLabel = round1();
      inLabel.source.components[2].option_labels.walk = `Walk${ch}`;
      expect(() => parseRequestArgs({ interaction: inLabel })).toThrow(/control or bidirectional/);
      const inKey = round1();
      inKey.source.components[1] = { type: 'record', fields: { [`k${ch}`]: 'v' } };
      expect(() => parseRequestArgs({ interaction: inKey })).toThrow(/control or bidirectional/);
    }
    const allowed = round1();
    allowed.description = 'tab\there\nnew line\r\nok';
    expect(() => parseRequestArgs({ interaction: allowed })).not.toThrow();
  });
});

describe('Convergence: shared core and error classes', () => {
  it('src/internal/shared.ts is byte-identical to adapters/shared/core.ts', () => {
    const vendored = readFileSync(new URL('../../src/internal/shared.ts', import.meta.url));
    const canonical = readFileSync(new URL('../../../shared/core.ts', import.meta.url));
    expect(vendored.equals(canonical)).toBe(true);
  });

  it('README documents every adapter error code with its contract class', () => {
    const readme = readFileSync(new URL('../../README.md', import.meta.url), 'utf8');
    for (const [code, errorClass] of Object.entries(ERROR_CLASSES))
      expect(readme).toMatch(new RegExp(`\\|\\s*\`${code}\`\\s*\\|\\s*\`${errorClass}\`\\s*\\|`));
  });
});
