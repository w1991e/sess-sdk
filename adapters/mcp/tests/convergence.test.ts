import { generateKeyPairSync } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { SessError } from '@sess.si/sdk';
import type { AdapterConfig } from '../src/config.js';
import { AdapterError } from '../src/errors.js';
import { SessMcpAdapter, type SessClient } from '../src/operations.js';
import { parseRequestArgs } from '../src/validate.js';
import {
  ANSWER_1,
  FakeSess,
  ROUND_1,
  ROUND_2,
  acceptingVerifier,
  adapterWith,
  clientFor,
  env,
  tempDir,
} from './helpers.js';

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

describe('renderer identities (SDK 0.1.0-rc.8)', () => {
  it.each(['sess-html-form-1', 'sess-html-form-2'])(
    'a %s receipt verifies offline with the identity the SDK bundles',
    async (rendererVersion) => {
      const fake = new FakeSess();
      const adapter = adapterWith(dir.path, fake); // real SDK verifier
      const { interaction } = await adapter.request(request());
      const eventId = fake.answerSigned(ANSWER_1.data, ANSWER_1.action_id, { rendererVersion });
      const result = await adapter.response({ handle: interaction.handle, revision: 1, waitMs: 0 });
      expect(result.interaction.state).toBe('answered');
      expect(result.interaction.response).toMatchObject({ eventId, verified: true });
      expect(record(interaction.handle).state).toBe('answered');
      // Bundled identities never fetch the issuer's signed renderer list.
      expect(fake.calls.map((c) => c.path)).not.toContain('/.well-known/sess-renderer-identities.json');
    },
  );

  it('an identity outside the bundled list is not released as verified when the issuer list cannot be read', async () => {
    const fake = new FakeSess();
    const adapter = adapterWith(dir.path, fake);
    const { interaction } = await adapter.request(request());
    fake.answerSigned(ANSWER_1.data, ANSWER_1.action_id, { rendererVersion: 'sess-html-form-9' });
    const before = JSON.stringify(record(interaction.handle));
    // The fake issuer serves no list (404): a retryable read failure that records nothing.
    const error = await failure(adapter.response({ handle: interaction.handle, revision: 1, waitMs: 0 }));
    expect(error.code).toBe('SESS_UNAVAILABLE');
    expect(error.retryable).toBe(true);
    expect(JSON.stringify(record(interaction.handle))).toBe(before);
    expect(fake.calls.map((c) => c.path)).toContain('/.well-known/sess-renderer-identities.json');
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

/** Real SDK client over the fake API, with optional per-method overrides and a call log. */
function instrumented(
  fake: FakeSess,
  overrides: Partial<Record<'complete' | 'verifyResponse', (...args: any[]) => Promise<any>>> = {},
) {
  const log: string[] = [];
  const createClient = (config: AdapterConfig): SessClient => {
    const real = clientFor(fake, acceptingVerifier(fake))(config);
    const wrap =
      (name: string, fn: (...args: any[]) => Promise<any>) =>
      (...args: any[]) => {
        log.push(name);
        return fn(...args);
      };
    return {
      sessions: {
        create: wrap('create', (...a) => (real.sessions.create as any)(...a)),
        retrieve: wrap('retrieve', (...a) => (real.sessions.retrieve as any)(...a)),
        waitForResponse: wrap('waitForResponse', (...a) => (real.sessions.waitForResponse as any)(...a)),
        publish: wrap('publish', (...a) => (real.sessions.publish as any)(...a)),
        complete: wrap('complete', overrides.complete ?? ((...a) => (real.sessions.complete as any)(...a))),
      } as SessClient['sessions'],
      receipts: {
        verifyResponse: wrap(
          'verifyResponse',
          overrides.verifyResponse ?? ((...a) => (real.receipts.verifyResponse as any)(...a)),
        ),
      } as SessClient['receipts'],
    };
  };
  const adapter = new SessMcpAdapter({ env: env(dir.path), diagnostics: () => {}, createClient });
  return { adapter, log };
}

describe('clarified response rules', () => {
  it('a revision other than the handle’s current revision is a conflict with no network call', async () => {
    const fake = new FakeSess();
    const { adapter, log } = instrumented(fake);
    const { interaction } = await adapter.request(request());
    const before = JSON.stringify(record(interaction.handle));
    log.length = 0;
    expect(
      (await failure(adapter.response({ handle: interaction.handle, revision: 2, waitMs: 0 }))).code,
    ).toBe('REVISION_MISMATCH');
    expect(log).toEqual([]);
    expect(JSON.stringify(record(interaction.handle))).toBe(before);
  });

  it('wait_ms 0 is one sessions.retrieve read, never waitForResponse', async () => {
    const fake = new FakeSess();
    const { adapter, log } = instrumented(fake);
    const { interaction } = await adapter.request(request());
    log.length = 0;
    await adapter.response({ handle: interaction.handle, revision: 1, waitMs: 0 });
    expect(log).toEqual(['retrieve']);
    log.length = 0;
    await adapter.response({ handle: interaction.handle, revision: 1, waitMs: 1100 });
    expect(log).toEqual(['waitForResponse']);
  });

  it.each([
    ['api', 'SESS_UNAVAILABLE', true],
    ['transport', 'SESS_UNAVAILABLE', true],
    ['timeout', 'SESS_UNAVAILABLE', true],
    ['unknown_outcome', 'SESS_UNAVAILABLE', true],
    ['protocol', 'SESS_PROTOCOL_ERROR', false],
    ['configuration', 'NOT_CONFIGURED', false],
  ] as const)(
    'verification-time SDK kind %s → %s (retryable %s), no state change',
    async (kind, code, retryable) => {
      const fake = new FakeSess();
      const { adapter } = instrumented(fake, {
        verifyResponse: async () => {
          throw new SessError(kind, 'synthetic');
        },
      });
      const { interaction } = await adapter.request(request());
      fake.answer(ANSWER_1.data);
      const before = JSON.stringify(record(interaction.handle));
      const error = await failure(adapter.response({ handle: interaction.handle, revision: 1, waitMs: 0 }));
      expect(error.code).toBe(code);
      expect(error.retryable).toBe(retryable);
      expect(JSON.stringify(record(interaction.handle))).toBe(before);
    },
  );

  it('verification-time abort ends as needs_resume and records no answer', async () => {
    const fake = new FakeSess();
    const { adapter } = instrumented(fake, {
      verifyResponse: async () => {
        throw new SessError('aborted', 'synthetic');
      },
    });
    const { interaction } = await adapter.request(request());
    fake.answer(ANSWER_1.data);
    const result = await adapter.response({ handle: interaction.handle, revision: 1, waitMs: 0 });
    expect(result.interaction.state).toBe('needs_resume');
    expect(record(interaction.handle).answer).toBeUndefined();
  });
});

describe('clarified mutation rules', () => {
  async function answered(adapter: SessMcpAdapter, fake: FakeSess) {
    const { interaction } = await adapter.request(request());
    const eventId = fake.answer(ANSWER_1.data);
    await adapter.response({ handle: interaction.handle, revision: 1, waitMs: 0 });
    return { handle: interaction.handle, eventId };
  }

  it('a failed SESSION_COMPLETED read-back keeps the completion pending and retryable', async () => {
    const fake = new FakeSess();
    const { adapter } = instrumented(fake);
    const { handle, eventId } = await answered(adapter, fake);
    fake.rejectNext = { method: 'POST', pathSuffix: '/complete', status: 409, code: 'SESSION_COMPLETED' };
    fake.failNext = { method: 'GET', pathSuffix: fake.session!.id, apply: false };
    const error = await failure(adapter.complete({ handle, expectedRevision: 1, responseEventId: eventId }));
    expect(error.code).toBe('OUTCOME_UNKNOWN');
    expect(error.retryable).toBe(true);
    expect(record(handle).state).toBe('complete_pending');
    expect(
      (await adapter.complete({ handle, expectedRevision: 1, responseEventId: eventId })).interaction.state,
    ).toBe('completed');
  });

  it('not_sent from an SDK configuration check blocks; not_sent from an abort stays pending', async () => {
    const fake = new FakeSess();
    const { adapter } = instrumented(fake, {
      complete: async () => {
        throw new SessError('configuration', 'synthetic', { outcome: 'not_sent' });
      },
    });
    const { handle, eventId } = await answered(adapter, fake);
    const error = await failure(adapter.complete({ handle, expectedRevision: 1, responseEventId: eventId }));
    expect(error.code).toBe('MUTATION_REJECTED');
    expect(error.retryable).toBe(false);
    expect(record(handle).state).toBe('blocked');
    expect(record(handle).blockedReason).toBe('SDK_CONFIGURATION');

    const second = new FakeSess();
    dir.cleanup();
    dir = tempDir();
    const aborting = instrumented(second, {
      complete: async () => {
        throw new SessError('aborted', 'synthetic', { outcome: 'not_sent' });
      },
    });
    const other = await answered(aborting.adapter, second);
    const pending = await failure(
      aborting.adapter.complete({
        handle: other.handle,
        expectedRevision: 1,
        responseEventId: other.eventId,
      }),
    );
    expect(pending.code).toBe('OUTCOME_UNKNOWN');
    expect(record(other.handle).state).toBe('complete_pending');
  });

  it('a confirmed complete records no body digest', async () => {
    const fake = new FakeSess();
    const { adapter } = instrumented(fake);
    const { handle, eventId } = await answered(adapter, fake);
    await adapter.complete({ handle, expectedRevision: 1, responseEventId: eventId });
    expect(record(handle).processed).toEqual([{ eventId, operation: 'complete', expectedRevision: 1 }]);
  });
});
