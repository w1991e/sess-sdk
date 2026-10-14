import { generateKeyPairSync } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { AdapterError } from '../src/errors.js';
import { parseRequestArgs } from '../src/validate.js';
import { ANSWER_1, FakeSess, ROUND_1, ROUND_2, acceptingVerifier, adapterWith, tempDir } from './helpers.js';

let dir: ReturnType<typeof tempDir>;
beforeEach(() => {
  dir = tempDir();
});
afterEach(() => dir.cleanup());

function record(handle: string): any {
  return JSON.parse(readFileSync(join(dir.path, 'profiles', 'default', 'handles', `${handle}.json`), 'utf8'));
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
const request = () => parseRequestArgs({ interaction: ROUND_1 });

describe('vendored shared core (adapters/CONTRACT.md, Convergence)', () => {
  it('src/internal/shared.ts is byte-identical to adapters/shared/core.ts', () => {
    const vendored = readFileSync(join(import.meta.dirname, '..', 'src', 'internal', 'shared.ts'));
    const canonical = readFileSync(join(import.meta.dirname, '..', '..', 'shared', 'core.ts'));
    expect(vendored.equals(canonical)).toBe(true);
  });
});

describe('verification configuration errors', () => {
  it('VERIFICATION_CONTEXT_MISSING is a configuration error that records nothing; configured, the answer verifies', async () => {
    const fake = new FakeSess();
    fake.workspaceHeader = false; // older runtime: no authenticated Sess-Workspace-Id
    const lines: string[] = [];
    const adapter = adapterWith(dir.path, fake, { lines }); // real SDK verifier
    const { interaction } = await adapter.request(request());
    const eventId = fake.answerSigned(ANSWER_1.data, ANSWER_1.action_id);
    const before = JSON.stringify(record(interaction.handle));
    const error = await failure(adapter.response({ handle: interaction.handle, revision: 1, waitMs: 0 }));
    expect(error.code).toBe('NOT_CONFIGURED');
    expect(error.retryable).toBe(false);
    expect(error.message).toContain('SESS_EXPECTED_WORKSPACE_ID');
    expect(JSON.stringify(record(interaction.handle))).toBe(before);
    expect(lines.join('\n')).toContain('VERIFICATION_CONTEXT_MISSING');
    expect(lines.join('\n')).not.toContain('blocked');
    // The owner configures the trusted workspace; the same handle and answer now verify.
    const configured = adapterWith(dir.path, fake, { env: { SESS_EXPECTED_WORKSPACE_ID: 'wks_synthetic' } });
    const result = await configured.response({ handle: interaction.handle, revision: 1, waitMs: 0 });
    expect(result.interaction.state).toBe('answered');
    expect(result.interaction.response).toMatchObject({ eventId, verified: true });
  });

  it.each([
    ['UNKNOWN_KEY_ID', { kid: 'rotated-unknown-key' }],
    ['INVALID_SIGNATURE', { privateKey: generateKeyPairSync('ed25519').privateKey }],
  ] as const)('%s is a genuine verification failure that blocks', async (sdkCode, options) => {
    const fake = new FakeSess();
    const lines: string[] = [];
    const adapter = adapterWith(dir.path, fake, { lines });
    const { interaction } = await adapter.request(request());
    fake.answerSigned(ANSWER_1.data, ANSWER_1.action_id, options);
    const error = await failure(adapter.response({ handle: interaction.handle, revision: 1, waitMs: 0 }));
    expect(error.code).toBe('VERIFICATION_FAILED');
    expect(lines.join('\n')).toContain(`receipt_verification/${sdkCode}`);
    const saved = record(interaction.handle);
    expect(saved.state).toBe('blocked');
    expect(saved.answer).toBeUndefined();
  });
});

describe('response while a mutation is pending', () => {
  it('returns a conflict telling the caller to repeat the pending complete', async () => {
    const fake = new FakeSess();
    const adapter = adapterWith(dir.path, fake, { verify: acceptingVerifier(fake) });
    const { interaction } = await adapter.request(request());
    const handle = interaction.handle;
    const eventId = fake.answer(ANSWER_1.data);
    await adapter.response({ handle, revision: 1, waitMs: 0 });
    fake.failNext = { method: 'POST', pathSuffix: '/complete', apply: false };
    expect(
      (await failure(adapter.complete({ handle, expectedRevision: 1, responseEventId: eventId }))).code,
    ).toBe('OUTCOME_UNKNOWN');
    const reads = fake.calls.length;
    const conflict = await failure(adapter.response({ handle, revision: 1, waitMs: 0 }));
    expect(conflict.code).toBe('MUTATION_PENDING');
    expect(conflict.message).toContain('sess_complete');
    expect(fake.calls).toHaveLength(reads);
    expect(record(handle).state).toBe('complete_pending');
    expect(
      (await adapter.complete({ handle, expectedRevision: 1, responseEventId: eventId })).interaction.state,
    ).toBe('completed');
  });

  it('returns a conflict telling the caller to repeat the pending publish', async () => {
    const fake = new FakeSess();
    const adapter = adapterWith(dir.path, fake, { verify: acceptingVerifier(fake) });
    const { interaction } = await adapter.request(request());
    const handle = interaction.handle;
    const eventId = fake.answer(ANSWER_1.data);
    await adapter.response({ handle, revision: 1, waitMs: 0 });
    fake.failNext = { method: 'PATCH', pathSuffix: fake.session!.id, apply: false };
    const next = parseRequestArgs({ interaction: ROUND_2 }).interaction;
    await failure(
      adapter.publish({ handle, expectedRevision: 1, responseEventId: eventId, interaction: next }),
    );
    const conflict = await failure(adapter.response({ handle, revision: 1 }));
    expect(conflict.code).toBe('MUTATION_PENDING');
    expect(conflict.message).toContain('sess_publish');
  });
});

describe('complete reconciliation', () => {
  it('SESSION_COMPLETED is confirmed only at the expected revision; otherwise it blocks', async () => {
    const fake = new FakeSess();
    const adapter = adapterWith(dir.path, fake, { verify: acceptingVerifier(fake) });
    const { interaction } = await adapter.request(request());
    const handle = interaction.handle;
    const eventId = fake.answer(ANSWER_1.data);
    await adapter.response({ handle, revision: 1, waitMs: 0 });
    // Someone else advanced and completed the Session at a later revision.
    fake.session!.revision = 2;
    fake.session!.status = 'completed';
    const error = await failure(adapter.complete({ handle, expectedRevision: 1, responseEventId: eventId }));
    expect(error.code).toBe('RECOVERY_BLOCKED');
    expect(record(handle).state).toBe('blocked');
    expect(record(handle).blockedReason).toBe('COMPLETE_NOT_CONFIRMED');
  });
});
