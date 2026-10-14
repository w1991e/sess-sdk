import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { AdapterError } from '../src/errors.js';
import type { SessMcpAdapter } from '../src/operations.js';
import { parseRequestArgs } from '../src/validate.js';
import { ANSWER_1, FakeSess, ROUND_1, ROUND_2, acceptingVerifier, adapterWith, tempDir } from './helpers.js';

let dir: ReturnType<typeof tempDir>;
beforeEach(() => {
  dir = tempDir();
});
afterEach(() => dir.cleanup());

const request = () => parseRequestArgs({ interaction: ROUND_1 });
function records(profile = 'default'): any[] {
  const handles = join(dir.path, 'profiles', profile, 'handles');
  return readdirSync(handles)
    .filter((n) => n.endsWith('.json'))
    .map((n) => JSON.parse(readFileSync(join(handles, n), 'utf8')));
}
async function code(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
  } catch (error) {
    expect(error).toBeInstanceOf(AdapterError);
    return (error as AdapterError).code;
  }
  throw new Error('expected an AdapterError');
}
async function answered(adapter: SessMcpAdapter, fake: FakeSess) {
  const created = await adapter.request(request());
  const eventId = fake.answer(ANSWER_1.data, ANSWER_1.action_id);
  const result = await adapter.response({ handle: created.interaction.handle, revision: 1, waitMs: 0 });
  return { handle: created.interaction.handle, eventId, result };
}

describe('sess_request', () => {
  it('persists the create intent before dispatch and returns URL and handle immediately', async () => {
    const fake = new FakeSess();
    const adapter = adapterWith(dir.path, fake);
    const original = fake.fetch;
    let stateAtCreate: string | undefined;
    fake.fetch = async (input, init) => {
      if (init?.method === 'POST') stateAtCreate = records()[0]?.state;
      return original(input, init);
    };
    const result = await adapter.request(request());
    expect(stateAtCreate).toBe('create_intent');
    expect(result).toEqual({
      interaction: {
        handle: expect.stringMatching(/^sh_[A-Za-z0-9_-]{22}$/),
        revision: 1,
        state: 'waiting',
        humanUrl: fake.humanUrl,
      },
    });
    // No read or wait happened before the URL was returned.
    expect(fake.calls.map((c) => `${c.method} ${c.path}`)).toEqual(['POST /v1/sessions']);
    const [saved] = records();
    expect(saved.state).toBe('waiting');
    expect(saved.sessionId).toBe(fake.session!.id);
    const raw = readFileSync(
      join(dir.path, 'profiles', 'default', 'handles', `${saved.handle}.json`),
      'utf8',
    );
    expect(raw).not.toContain('synthetic-owner-key-one');
    if (process.platform !== 'win32')
      expect(
        statSync(join(dir.path, 'profiles', 'default', 'handles', `${saved.handle}.json`)).mode & 0o077,
      ).toBe(0);
  });

  it('never retries an unknown create and keeps create_unknown blocked', async () => {
    const fake = new FakeSess();
    fake.createFailure = 'network';
    const adapter = adapterWith(dir.path, fake);
    expect(await code(adapter.request(request()))).toBe('CREATE_OUTCOME_UNKNOWN');
    expect(fake.calls.filter((c) => c.method === 'POST')).toHaveLength(1);
    const [saved] = records();
    expect(saved.state).toBe('create_unknown');
    expect(await code(adapter.response({ handle: saved.handle, revision: 1 }))).toBe(
      'CREATE_OUTCOME_UNKNOWN',
    );
    expect(records()[0]!.state).toBe('create_unknown');
  });

  it('discards the intent of an authoritatively rejected create', async () => {
    const fake = new FakeSess();
    fake.createFailure = 'reject';
    const adapter = adapterWith(dir.path, fake);
    expect(await code(adapter.request(request()))).toBe('CREATE_REJECTED');
    expect(records()).toHaveLength(0);
  });
});

describe('sess_response', () => {
  it('returns waiting on a single read with no answer, then a fully verified answer', async () => {
    const fake = new FakeSess();
    const adapter = adapterWith(dir.path, fake, { verify: acceptingVerifier(fake) });
    const { interaction } = await adapter.request(request());
    expect(await adapter.response({ handle: interaction.handle, revision: 1, waitMs: 0 })).toEqual({
      interaction: { handle: interaction.handle, revision: 1, state: 'waiting' },
    });
    const eventId = fake.answer(ANSWER_1.data);
    const result = await adapter.response({ handle: interaction.handle, revision: 1, waitMs: 0 });
    expect(result.interaction).toEqual({
      handle: interaction.handle,
      revision: 1,
      state: 'answered',
      response: {
        eventId,
        actionId: 'submit',
        data: ANSWER_1.data,
        verified: true,
        actorAssurance: 'link_holder',
      },
    });
    expect(result.interaction.humanUrl).toBeUndefined();
    expect(records()[0]!.state).toBe('answered');
    // Repeated read returns the same verified answer without new remote mutation.
    expect(await adapter.response({ handle: interaction.handle, revision: 1 })).toEqual(result);
  });

  it('a bounded wait timeout yields needs_resume; a later call resumes the same handle', async () => {
    const fake = new FakeSess();
    const adapter = adapterWith(dir.path, fake, { verify: acceptingVerifier(fake) });
    const { interaction } = await adapter.request(request());
    const started = Date.now();
    const timedOut = await adapter.response({ handle: interaction.handle, revision: 1, waitMs: 1200 });
    expect(Date.now() - started).toBeLessThan(5000);
    expect(timedOut.interaction.state).toBe('needs_resume');
    expect(records()[0]!.state).toBe('needs_resume');
    fake.answer(ANSWER_1.data);
    const resumed = await adapter.response({ handle: interaction.handle, revision: 1, waitMs: 1200 });
    expect(resumed.interaction.state).toBe('answered');
    expect(fake.calls.filter((c) => c.method === 'POST')).toHaveLength(1);
  });

  it('host cancellation ends only the local wait as needs_resume', async () => {
    const fake = new FakeSess();
    const adapter = adapterWith(dir.path, fake);
    const { interaction } = await adapter.request(request());
    const controller = new AbortController();
    setTimeout(() => controller.abort(), 100);
    const result = await adapter.response(
      { handle: interaction.handle, revision: 1, waitMs: 30_000 },
      controller.signal,
    );
    expect(result.interaction.state).toBe('needs_resume');
    expect(fake.session!.status).toBe('active');
    expect(fake.calls.some((c) => c.path.endsWith('/complete'))).toBe(false);
  });

  it('a receipt that fails real SDK verification is never returned as verified', async () => {
    const fake = new FakeSess();
    const lines: string[] = [];
    const adapter = adapterWith(dir.path, fake, { lines }); // real client.receipts.verifyResponse
    const { interaction } = await adapter.request(request());
    fake.answer(ANSWER_1.data, 'submit', 'forged.receipt.value');
    expect(await code(adapter.response({ handle: interaction.handle, revision: 1, waitMs: 0 }))).toBe(
      'VERIFICATION_FAILED',
    );
    const [saved] = records();
    expect(saved.state).toBe('blocked');
    expect(saved.answer).toBeUndefined();
    // blocked is never auto-exited.
    expect(await code(adapter.response({ handle: interaction.handle, revision: 1 }))).toBe(
      'RECOVERY_BLOCKED',
    );
    expect(
      await code(
        adapter.complete({
          handle: interaction.handle,
          expectedRevision: 1,
          responseEventId: 'evt_00000000000000000000000001',
        }),
      ),
    ).toBe('RECOVERY_BLOCKED');
    expect(records()[0]!.state).toBe('blocked');
  });

  it('a legacy answer without a receipt is never verified', async () => {
    const fake = new FakeSess();
    const adapter = adapterWith(dir.path, fake);
    const { interaction } = await adapter.request(request());
    fake.answer(ANSWER_1.data, 'submit', null);
    expect(await code(adapter.response({ handle: interaction.handle, revision: 1, waitMs: 0 }))).toBe(
      'VERIFICATION_FAILED',
    );
  });

  it('rejects a revision that is not the handle’s current revision', async () => {
    const fake = new FakeSess();
    const adapter = adapterWith(dir.path, fake);
    const { interaction } = await adapter.request(request());
    expect(await code(adapter.response({ handle: interaction.handle, revision: 2 }))).toBe(
      'REVISION_MISMATCH',
    );
  });
});

describe('profile boundary', () => {
  it('rejects handles from another profile, origin or credential generation', async () => {
    const fake = new FakeSess();
    const owner = adapterWith(dir.path, fake);
    const { interaction } = await owner.request(request());
    const other = adapterWith(dir.path, fake, { env: { SESS_MCP_PROFILE: 'other' } });
    expect(await code(other.response({ handle: interaction.handle, revision: 1 }))).toBe('HANDLE_NOT_FOUND');
    const rotated = adapterWith(dir.path, fake, { env: { SESS_API_KEY: 'synthetic-owner-key-two' } });
    expect(await code(rotated.response({ handle: interaction.handle, revision: 1 }))).toBe(
      'BINDING_MISMATCH',
    );
    const origin = adapterWith(dir.path, fake, { env: { SESS_API_ORIGIN: 'https://api2.sess.test' } });
    expect(await code(origin.response({ handle: interaction.handle, revision: 1 }))).toBe('BINDING_MISMATCH');
    expect(fake.calls.filter((c) => c.method === 'GET')).toHaveLength(0);
  });

  it('never stores the raw key; the generation identifier is a profile-local digest', async () => {
    const fake = new FakeSess();
    await adapterWith(dir.path, fake).request(request());
    const [saved] = records();
    expect(saved.binding).toEqual({
      profile: 'default',
      origin: 'https://api.sess.test',
      credentialGeneration: expect.stringMatching(/^cg1_[A-Za-z0-9_-]{22}$/),
    });
    expect(JSON.stringify(saved)).not.toContain('synthetic-owner-key');
  });
});

describe('sess_complete', () => {
  it('requires the matching verified answer and confirms the terminal state', async () => {
    const fake = new FakeSess();
    const adapter = adapterWith(dir.path, fake, { verify: acceptingVerifier(fake) });
    const { handle, eventId } = await answered(adapter, fake);
    expect(
      await code(
        adapter.complete({ handle, expectedRevision: 1, responseEventId: 'evt_00000000000000000000000009' }),
      ),
    ).toBe('RESPONSE_MISMATCH');
    expect(await code(adapter.complete({ handle, expectedRevision: 2, responseEventId: eventId }))).toBe(
      'REVISION_MISMATCH',
    );
    const done = await adapter.complete({ handle, expectedRevision: 1, responseEventId: eventId });
    expect(done).toEqual({ interaction: { handle, revision: 1, state: 'completed' } });
    expect(fake.session!.status).toBe('completed');
    const [saved] = records();
    expect(saved.state).toBe('completed');
    expect(saved.humanUrl).toBeUndefined();
    expect(saved.answer.data).toEqual({});
    // Idempotent repeat: no second remote write.
    const writes = fake.calls.filter((c) => c.path.endsWith('/complete')).length;
    expect(await adapter.complete({ handle, expectedRevision: 1, responseEventId: eventId })).toEqual(done);
    expect(fake.calls.filter((c) => c.path.endsWith('/complete')).length).toBe(writes);
  });

  it('persists the exact mutation before dispatch and replays the same identity after an unknown outcome', async () => {
    const fake = new FakeSess();
    const adapter = adapterWith(dir.path, fake, { verify: acceptingVerifier(fake) });
    const { handle, eventId } = await answered(adapter, fake);
    fake.failNext = { method: 'POST', pathSuffix: '/complete', apply: true };
    expect(await code(adapter.complete({ handle, expectedRevision: 1, responseEventId: eventId }))).toBe(
      'OUTCOME_UNKNOWN',
    );
    const [pending] = records();
    expect(pending.state).toBe('complete_pending');
    const done = await adapter.complete({ handle, expectedRevision: 1, responseEventId: eventId });
    expect(done.interaction.state).toBe('completed');
    const attempts = fake.calls.filter((c) => c.path.endsWith('/complete'));
    expect(attempts).toHaveLength(2);
    expect(attempts[1]!.idempotencyKey).toBe(attempts[0]!.idempotencyKey);
    expect(attempts[1]!.ifMatch).toBe(attempts[0]!.ifMatch);
    expect(attempts[0]!.idempotencyKey).toBe(pending.pending.idempotencyKey);
  });

  it('cannot complete before an answer exists', async () => {
    const fake = new FakeSess();
    const adapter = adapterWith(dir.path, fake);
    const { interaction } = await adapter.request(request());
    expect(
      await code(
        adapter.complete({
          handle: interaction.handle,
          expectedRevision: 1,
          responseEventId: 'evt_00000000000000000000000001',
        }),
      ),
    ).toBe('INVALID_STATE');
  });
});

describe('sess_publish', () => {
  it('publishes the next revision once and keeps the saved identity for replay', async () => {
    const fake = new FakeSess();
    const adapter = adapterWith(dir.path, fake, { verify: acceptingVerifier(fake) });
    const { handle, eventId } = await answered(adapter, fake);
    const next = parseRequestArgs({ interaction: ROUND_2 }).interaction;
    fake.failNext = { method: 'PATCH', pathSuffix: fake.session!.id, apply: false };
    expect(
      await code(
        adapter.publish({ handle, expectedRevision: 1, responseEventId: eventId, interaction: next }),
      ),
    ).toBe('OUTCOME_UNKNOWN');
    expect(records()[0]!.state).toBe('publish_pending');
    expect(
      await code(
        adapter.publish({
          handle,
          expectedRevision: 1,
          responseEventId: eventId,
          interaction: parseRequestArgs({ interaction: ROUND_1 }).interaction,
        }),
      ),
    ).toBe('PENDING_MUTATION_DIFFERS');
    const published = await adapter.publish({
      handle,
      expectedRevision: 1,
      responseEventId: eventId,
      interaction: next,
    });
    expect(published).toEqual({ interaction: { handle, revision: 2, state: 'waiting' } });
    const patches = fake.calls.filter((c) => c.method === 'PATCH');
    expect(patches).toHaveLength(2);
    expect(patches[1]!.idempotencyKey).toBe(patches[0]!.idempotencyKey);
    // The used answer cannot complete: it was consumed by a different (publish) transition.
    expect(await code(adapter.complete({ handle, expectedRevision: 1, responseEventId: eventId }))).toBe(
      'PENDING_MUTATION_DIFFERS',
    );
    expect(await adapter.response({ handle, revision: 2, waitMs: 0 })).toEqual({
      interaction: { handle, revision: 2, state: 'waiting' },
    });
  });
});
