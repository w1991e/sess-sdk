import { chmodSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AdapterError } from '../src/errors.js';
import type { SessMcpAdapter } from '../src/operations.js';
import { parseRequestArgs } from '../src/validate.js';
import { ANSWER_1, FakeSess, ROUND_1, ROUND_2, acceptingVerifier, adapterWith, tempDir } from './helpers.js';

let dir: ReturnType<typeof tempDir>;
beforeEach(() => {
  dir = tempDir();
});
afterEach(() => dir.cleanup());

const handles = () => join(dir.path, 'profiles', 'default', 'handles');
function record(handle: string): any {
  return JSON.parse(readFileSync(join(handles(), `${handle}.json`), 'utf8'));
}
async function failure(promise: Promise<unknown>): Promise<AdapterError> {
  try {
    await promise;
  } catch (error) {
    expect(error).toBeInstanceOf(AdapterError);
    return error as AdapterError;
  }
  throw new Error('expected an AdapterError');
}
const interaction = (value: unknown) => parseRequestArgs({ interaction: value }).interaction;

async function answered(adapter: SessMcpAdapter, fake: FakeSess) {
  const created = await adapter.request(parseRequestArgs({ interaction: ROUND_1 }));
  const eventId = fake.answer(ANSWER_1.data, ANSWER_1.action_id);
  await adapter.response({ handle: created.interaction.handle, revision: 1, waitMs: 0 });
  return { handle: created.interaction.handle, eventId };
}

describe('replay of a confirmed publish or complete', () => {
  it('an identical publish replay after success returns the confirmed state without a new write', async () => {
    const fake = new FakeSess();
    const adapter = adapterWith(dir.path, fake, { verify: acceptingVerifier(fake) });
    const { handle, eventId } = await answered(adapter, fake);
    const args = { handle, expectedRevision: 1, responseEventId: eventId, interaction: interaction(ROUND_2) };
    expect(await adapter.publish(args)).toEqual({ interaction: { handle, revision: 2, state: 'waiting' } });
    expect(await adapter.publish(args)).toEqual({ interaction: { handle, revision: 2, state: 'waiting' } });
    expect(fake.calls.filter((c) => c.method === 'PATCH')).toHaveLength(1);
    expect(record(handle).processed).toEqual([
      {
        eventId,
        operation: 'publish',
        expectedRevision: 1,
        bodyDigest: expect.stringMatching(/^[0-9a-f]{64}$/),
      },
    ]);
  });

  it('a publish replay with a different body or expected revision is refused and sends nothing', async () => {
    const fake = new FakeSess();
    const adapter = adapterWith(dir.path, fake, { verify: acceptingVerifier(fake) });
    const { handle, eventId } = await answered(adapter, fake);
    await adapter.publish({
      handle,
      expectedRevision: 1,
      responseEventId: eventId,
      interaction: interaction(ROUND_2),
    });
    const differentBody = { ...ROUND_2, title: 'A different next step' };
    expect(
      (
        await failure(
          adapter.publish({
            handle,
            expectedRevision: 1,
            responseEventId: eventId,
            interaction: interaction(differentBody),
          }),
        )
      ).code,
    ).toBe('PENDING_MUTATION_DIFFERS');
    expect(
      (
        await failure(
          adapter.publish({
            handle,
            expectedRevision: 2,
            responseEventId: eventId,
            interaction: interaction(ROUND_2),
          }),
        )
      ).code,
    ).toBe('PENDING_MUTATION_DIFFERS');
    expect(fake.calls.filter((c) => c.method === 'PATCH')).toHaveLength(1);
    expect(record(handle).state).toBe('waiting');
  });

  it('an exact publish replay after the interaction advanced further is refused', async () => {
    const fake = new FakeSess();
    const adapter = adapterWith(dir.path, fake, { verify: acceptingVerifier(fake) });
    const { handle, eventId } = await answered(adapter, fake);
    const args = { handle, expectedRevision: 1, responseEventId: eventId, interaction: interaction(ROUND_2) };
    await adapter.publish(args);
    fake.answer({ confirmed: true }, 'confirm');
    await adapter.response({ handle, revision: 2, waitMs: 0 });
    expect((await failure(adapter.publish(args))).code).toBe('RESPONSE_MISMATCH');
  });

  it('a complete replay with a different expected revision is refused after completion', async () => {
    const fake = new FakeSess();
    const adapter = adapterWith(dir.path, fake, { verify: acceptingVerifier(fake) });
    const { handle, eventId } = await answered(adapter, fake);
    await adapter.complete({ handle, expectedRevision: 1, responseEventId: eventId });
    expect(
      (await failure(adapter.complete({ handle, expectedRevision: 2, responseEventId: eventId }))).code,
    ).toBe('PENDING_MUTATION_DIFFERS');
  });

  it('a record written in another format version stops before any network call', async () => {
    const fake = new FakeSess();
    const adapter = adapterWith(dir.path, fake, { verify: acceptingVerifier(fake) });
    const { handle, eventId } = await answered(adapter, fake);
    const old = record(handle);
    old.schema = 1;
    old.processedEvents = [];
    delete old.processed;
    writeFileSync(join(handles(), `${handle}.json`), JSON.stringify(old));
    const before = fake.calls.length;
    const error = await failure(adapter.complete({ handle, expectedRevision: 1, responseEventId: eventId }));
    expect(error.code).toBe('STATE_STORE_ERROR');
    expect(error.message).toContain('unsupported format version');
    expect(fake.calls).toHaveLength(before);
    expect(record(handle).schema).toBe(1);
  });
});

describe('compare-and-apply blocking', () => {
  it('a stale wait that observes later progress does not block the advanced record', async () => {
    const fake = new FakeSess();
    const adapter = adapterWith(dir.path, fake, { verify: acceptingVerifier(fake) });
    const created = await adapter.request(parseRequestArgs({ interaction: ROUND_1 }));
    const handle = created.interaction.handle;
    const eventId = fake.answer(ANSWER_1.data);
    // While the first read is in flight, a second call verifies the answer and publishes round 2.
    fake.beforeNextGet = async () => {
      await adapter.response({ handle, revision: 1, waitMs: 0 });
      await adapter.publish({
        handle,
        expectedRevision: 1,
        responseEventId: eventId,
        interaction: interaction(ROUND_2),
      });
    };
    const stale = await failure(adapter.response({ handle, revision: 1, waitMs: 0 }));
    expect(stale.code).toBe('INVALID_STATE');
    const saved = record(handle);
    expect(saved.state).toBe('waiting');
    expect(saved.revision).toBe(2);
    expect(saved.blockedReason).toBeUndefined();
  });
});

describe('deterministic rejection of a saved mutation', () => {
  it('400/422-style rejections block with a stable code instead of staying retryable', async () => {
    for (const [status, codeValue] of [
      [400, 'INVALID_SCHEMA'],
      [422, 'VALIDATION_FAILED'],
    ] as const) {
      const fake = new FakeSess();
      const adapter = adapterWith(dir.path, fake, { verify: acceptingVerifier(fake) });
      const { handle, eventId } = await answered(adapter, fake);
      fake.rejectNext = { method: 'PATCH', pathSuffix: fake.session!.id, status, code: codeValue };
      const error = await failure(
        adapter.publish({
          handle,
          expectedRevision: 1,
          responseEventId: eventId,
          interaction: interaction(ROUND_2),
        }),
      );
      expect(error.code).toBe('MUTATION_REJECTED');
      expect(error.retryable).toBe(false);
      expect(error.message).toContain(codeValue);
      expect(record(handle).state).toBe('blocked');
      expect(record(handle).blockedReason).toBe(codeValue);
    }
  });

  it('an unrecognized 4xx code is an unknown outcome (SDK rule) and never enters a message', async () => {
    const fake = new FakeSess();
    const adapter = adapterWith(dir.path, fake, { verify: acceptingVerifier(fake) });
    const { handle, eventId } = await answered(adapter, fake);
    fake.rejectNext = {
      method: 'POST',
      pathSuffix: '/complete',
      status: 400,
      code: 'bad code https://x.test/s/abc',
    };
    const error = await failure(adapter.complete({ handle, expectedRevision: 1, responseEventId: eventId }));
    // The SDK reports outcome "unknown" for codes outside its reviewed rejection table, so the
    // saved request stays pending for an identical replay.
    expect(error.code).toBe('OUTCOME_UNKNOWN');
    expect(error.message).not.toContain('x.test');
    expect(error.message).not.toContain('bad code');
    expect(record(handle).state).toBe('complete_pending');
  });

  it('a 409/412 conflict blocks and keeps the saved request as evidence', async () => {
    const fake = new FakeSess();
    const adapter = adapterWith(dir.path, fake, { verify: acceptingVerifier(fake) });
    const { handle, eventId } = await answered(adapter, fake);
    fake.rejectNext = {
      method: 'POST',
      pathSuffix: '/complete',
      status: 412,
      code: 'SESSION_REVISION_CONFLICT',
    };
    const error = await failure(adapter.complete({ handle, expectedRevision: 1, responseEventId: eventId }));
    expect(error.code).toBe('MUTATION_REJECTED');
    const saved = record(handle);
    expect(saved.state).toBe('blocked');
    expect(saved.blockedReason).toBe('SESSION_REVISION_CONFLICT');
    expect(saved.pending.operation).toBe('complete');
    // blocked is never auto-exited.
    expect(
      (await failure(adapter.complete({ handle, expectedRevision: 1, responseEventId: eventId }))).code,
    ).toBe('RECOVERY_BLOCKED');
  });

  it('a transient 503 keeps the saved request pending and replays the same identity', async () => {
    const fake = new FakeSess();
    const adapter = adapterWith(dir.path, fake, { verify: acceptingVerifier(fake) });
    const { handle, eventId } = await answered(adapter, fake);
    fake.rejectNext = { method: 'POST', pathSuffix: '/complete', status: 503, code: 'UNAVAILABLE' };
    const error = await failure(adapter.complete({ handle, expectedRevision: 1, responseEventId: eventId }));
    expect(error.code).toBe('OUTCOME_UNKNOWN');
    expect(error.retryable).toBe(true);
    expect(record(handle).state).toBe('complete_pending');
    expect(
      (await adapter.complete({ handle, expectedRevision: 1, responseEventId: eventId })).interaction.state,
    ).toBe('completed');
    const keys = fake.calls.filter((c) => c.path.endsWith('/complete')).map((c) => c.idempotencyKey);
    expect(new Set(keys).size).toBe(1);
  });
});

describe('create bookkeeping', () => {
  it.skipIf(process.platform === 'win32' || process.getuid?.() === 0)(
    'a save failure after a confirmed create is a non-retryable CREATED_NOT_SAVED',
    async () => {
      const fake = new FakeSess();
      const adapter = adapterWith(dir.path, fake);
      const original = fake.fetch;
      fake.fetch = async (input, init) => {
        const response = await original(input, init);
        if (init?.method === 'POST') chmodSync(handles(), 0o500);
        return response;
      };
      try {
        const error = await failure(adapter.request(parseRequestArgs({ interaction: ROUND_1 })));
        expect(error.code).toBe('CREATED_NOT_SAVED');
        expect(error.retryable).toBe(false);
        expect(error.message).toContain('Do not call sess_request again');
      } finally {
        chmodSync(handles(), 0o700);
      }
      // The intent saved before dispatch remains; later calls report the unconfirmed create.
      const [name] = readdirSync(handles()).filter((n) => n.endsWith('.json'));
      const saved = JSON.parse(readFileSync(join(handles(), name!), 'utf8'));
      expect(saved.state).toBe('create_intent');
      expect((await failure(adapter.response({ handle: saved.handle, revision: 1 }))).code).toBe(
        'CREATE_OUTCOME_UNKNOWN',
      );
      expect(fake.calls.filter((c) => c.method === 'POST')).toHaveLength(1);
    },
  );
});

describe('unknown create outcome bookkeeping', () => {
  it.skipIf(process.platform === 'win32' || process.getuid?.() === 0)(
    'a save failure after an unknown create outcome is non-retryable and never re-creates',
    async () => {
      const fake = new FakeSess();
      fake.createFailure = 'network';
      const adapter = adapterWith(dir.path, fake);
      const original = fake.fetch;
      fake.fetch = async (input, init) => {
        if (init?.method === 'POST') chmodSync(handles(), 0o500);
        return original(input, init);
      };
      let error: AdapterError;
      try {
        error = await failure(adapter.request(parseRequestArgs({ interaction: ROUND_1 })));
      } finally {
        chmodSync(handles(), 0o700);
      }
      expect(error.code).toBe('CREATE_OUTCOME_UNKNOWN');
      expect(error.retryable).toBe(false);
      expect(error.message).toContain('Do not call sess_request again');
      const [name] = readdirSync(handles()).filter((n) => n.endsWith('.json'));
      const saved = JSON.parse(readFileSync(join(handles(), name!), 'utf8'));
      expect(saved.state).toBe('create_intent');
      expect((await failure(adapter.response({ handle: saved.handle, revision: 1 }))).code).toBe(
        'CREATE_OUTCOME_UNKNOWN',
      );
      expect(fake.calls.filter((c) => c.method === 'POST')).toHaveLength(1);
    },
  );
});

describe('transient receipt-key failures', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('a genuinely signed answer verifies with the real SDK verifier (baseline)', async () => {
    const fake = new FakeSess();
    const adapter = adapterWith(dir.path, fake); // real client.receipts.verifyResponse
    const created = await adapter.request(parseRequestArgs({ interaction: ROUND_1 }));
    const eventId = fake.answerSigned(ANSWER_1.data, ANSWER_1.action_id);
    const result = await adapter.response({ handle: created.interaction.handle, revision: 1, waitMs: 0 });
    expect(result.interaction.state).toBe('answered');
    expect(result.interaction.response).toMatchObject({
      eventId,
      verified: true,
      actorAssurance: 'link_holder',
    });
  });

  it('a key endpoint 503 is retryable, records nothing, and a later call verifies the answer', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-14T12:00:00.000Z'));
    const fake = new FakeSess();
    const lines: string[] = [];
    const adapter = adapterWith(dir.path, fake, { lines }); // real verifier and key cache
    const created = await adapter.request(parseRequestArgs({ interaction: ROUND_1 }));
    const handle = created.interaction.handle;
    const eventId = fake.answerSigned(ANSWER_1.data, ANSWER_1.action_id);
    const before = JSON.stringify(record(handle));
    fake.rejectNext = {
      method: 'GET',
      pathSuffix: '/.well-known/sess-receipt-keys.json',
      status: 503,
      code: 'UNAVAILABLE',
    };
    const first = await failure(adapter.response({ handle, revision: 1, waitMs: 0 }));
    expect(first.code).toBe('SESS_UNAVAILABLE');
    expect(first.retryable).toBe(true);
    expect(JSON.stringify(record(handle))).toBe(before);
    expect(record(handle).state).toBe('waiting');
    // Within the SDK's key-refresh cooldown the retry is still transient, never a block.
    const second = await failure(adapter.response({ handle, revision: 1, waitMs: 0 }));
    expect(second.code).toBe('SESS_UNAVAILABLE');
    expect(record(handle).state).toBe('waiting');
    expect(lines.join('\n')).toContain('verification_deferred');
    expect(lines.join('\n')).not.toContain('blocked');
    // After the cooldown the same handle re-reads and fully verifies the answer.
    vi.setSystemTime(new Date('2026-10-14T12:00:11.000Z'));
    const third = await adapter.response({ handle, revision: 1, waitMs: 0 });
    expect(third.interaction.state).toBe('answered');
    expect(third.interaction.response).toMatchObject({ eventId, verified: true });
    expect(record(handle).state).toBe('answered');
  });

  it('a genuine verification failure still blocks', async () => {
    const fake = new FakeSess();
    const adapter = adapterWith(dir.path, fake);
    const created = await adapter.request(parseRequestArgs({ interaction: ROUND_1 }));
    fake.answerSigned(ANSWER_1.data, ANSWER_1.action_id);
    // Tamper with the accepted data after signing: the input hash no longer matches.
    fake.session!.responses[0].data = { activity: 'walk', hours: 3 };
    const error = await failure(
      adapter.response({ handle: created.interaction.handle, revision: 1, waitMs: 0 }),
    );
    expect(error.code).toBe('VERIFICATION_FAILED');
    expect(record(created.interaction.handle).state).toBe('blocked');
  });
});
