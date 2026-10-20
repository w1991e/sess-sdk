import { generateKeyPairSync } from 'node:crypto';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { Sess } from '@sess.si/sdk';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { AdapterError } from '../src/errors.js';
import { SessMcpAdapter } from '../src/operations.js';
import { createSessMcpServer } from '../src/server.js';
import { TRIAL_LIMITS, trialReadFetch } from '../src/trial.js';
import { parseAskArgs } from '../src/validate.js';
import { tempDir } from './helpers.js';
import { TrialStub } from './trial-stub.js';

let dir: ReturnType<typeof tempDir>;
beforeEach(() => {
  dir = tempDir();
});
afterEach(() => dir.cleanup());

const ASK = { question: 'Which time works?', fields: [{ name: 'time', label: 'Time', type: 'text' }] };
const ANSWER = { time: 'Tuesday 10:00' };

function trialEnv(stub: TrialStub, extra: Record<string, string> = {}): NodeJS.ProcessEnv {
  return { SESS_API_ORIGIN: stub.origin, SESS_MCP_STATE_DIR: dir.path, ...extra };
}

function trialAdapter(
  stub: TrialStub,
  options: { lines?: string[]; env?: Record<string, string>; now?: () => Date } = {},
): SessMcpAdapter {
  const lines = options.lines ?? [];
  return new SessMcpAdapter({
    env: trialEnv(stub, options.env),
    // Raw, unredacted capture: the credential must never reach diagnostics at all.
    diagnostics: (event, fields = {}) => lines.push(`${event} ${JSON.stringify(fields)}`),
    fetch: stub.fetch as typeof fetch,
    ...(options.now ? { now: options.now } : {}),
  });
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

const ask = () => parseAskArgs(ASK);
const trialFiles = () => {
  const trials = join(dir.path, 'profiles', 'default', 'trials');
  return existsSync(trials) ? readdirSync(trials).filter((n) => n.endsWith('.json')) : [];
};

describe('trial mode: mode selection', () => {
  it('runs in trial mode only when SESS_API_KEY is absent or empty', async () => {
    for (const env of [{}, { SESS_API_KEY: '' }] as Record<string, string>[]) {
      const stub = new TrialStub();
      const adapter = trialAdapter(stub, { env });
      const created = await adapter.request(ask());
      expect(created.interaction.state).toBe('waiting');
      expect(stub.anonymousCreates()).toHaveLength(1);
      expect(stub.calls.some((c) => c.path.startsWith('/v1/sessions'))).toBe(false);
      dir.cleanup();
      dir = tempDir();
    }
  });

  it('never falls back to a trial when a configured key is refused as invalid, expired or revoked', async () => {
    const stub = new TrialStub();
    const lines: string[] = [];
    const adapter = new SessMcpAdapter({
      env: { ...trialEnv(stub), SESS_API_KEY: 'synthetic-revoked-owner-key' },
      diagnostics: (event, fields = {}) => lines.push(`${event} ${JSON.stringify(fields)}`),
      fetch: stub.fetch as typeof fetch,
      createClient: (config) => {
        const sess = new Sess({
          apiKey: config.apiKey,
          baseUrl: config.origin,
          fetch: stub.fetch as typeof fetch,
          maxRetries: 0,
        });
        return { sessions: sess.sessions, receipts: sess.receipts };
      },
    });
    for (let i = 0; i < 2; i++) {
      const error = await failure(adapter.request(ask()));
      expect(error.code).toBe('CREATE_REJECTED');
      expect(error.message).toContain('SESS_API_KEY');
      expect(error.message).toContain('never switches to trial mode');
    }
    expect(stub.calls.map((c) => c.path)).toEqual(['/v1/sessions', '/v1/sessions']);
    expect(stub.calls.some((c) => c.path.startsWith('/v1/trial'))).toBe(false);
    expect(trialFiles()).toEqual([]);
  });

  it('a malformed key or a trial with SESS_EXPECTED_WORKSPACE_ID is NOT_CONFIGURED, with nothing sent', async () => {
    const stub = new TrialStub();
    for (const env of [{ SESS_API_KEY: 'has space' }, { SESS_EXPECTED_WORKSPACE_ID: 'wks_x' }] as Record<
      string,
      string
    >[]) {
      const error = await failure(trialAdapter(stub, { env }).request(ask()));
      expect(error.code).toBe('NOT_CONFIGURED');
    }
    expect(stub.calls).toHaveLength(0);
  });
});

describe('trial mode: lazy creation and single flight', () => {
  it('connecting, listing tools and reading an unknown handle consume nothing', async () => {
    const stub = new TrialStub();
    const created = createSessMcpServer({
      env: trialEnv(stub),
      fetch: stub.fetch as typeof fetch,
      diagnostics: () => {},
    });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await created.connect(serverTransport);
    const client = new Client({ name: 'test-client', version: '0.0.0' });
    await client.connect(clientTransport);
    expect((await client.listTools()).tools).toHaveLength(5);
    const unknown = await client.callTool({
      name: 'sess_response',
      arguments: { handle: 'sh_AAAAAAAAAAAAAAAAAAAAAA', revision: 1, wait_ms: 0 },
    });
    expect(unknown.isError).toBe(true);
    expect(stub.calls).toHaveLength(0);
    expect(trialFiles()).toEqual([]);
    const asked = await client.callTool({ name: 'sess_ask', arguments: ASK });
    expect(asked.isError).toBeFalsy();
    expect(stub.anonymousCreates()).toHaveLength(1);
    await client.close();
  });

  it('concurrent first calls start exactly one trial (in process and across instances sharing the state)', async () => {
    const stub = new TrialStub();
    stub.createDelayMs = 40;
    const lines: string[] = [];
    const one = trialAdapter(stub, { lines });
    const two = trialAdapter(stub, { lines });
    const results = await Promise.all([one.request(ask()), one.request(ask()), two.request(ask())]);
    expect(results.map((r) => r.interaction.state)).toEqual(['waiting', 'waiting', 'waiting']);
    expect(stub.anonymousCreates()).toHaveLength(1);
    expect(stub.trials.size).toBe(1);
    const credential = stub.credentials()[0]!;
    const authenticated = stub.calls.filter((c) => c.method === 'POST' && c.authorization);
    expect(authenticated).toHaveLength(2);
    for (const call of authenticated) expect(call.authorization).toBe(`Bearer ${credential}`);
    expect(trialFiles()).toHaveLength(1);
    const log = lines.join('\n');
    expect(log).not.toContain(credential);
    expect(log).toContain('trial_started');
    // The lock file is gone once the start completes.
    expect(
      readdirSync(join(dir.path, 'profiles', 'default', 'trials')).some((n) => n.endsWith('.lock')),
    ).toBe(false);
  });
});

describe('trial mode: protected state', () => {
  it('keeps the credential only in a 0600 state file, reused across calls and a new instance', async () => {
    const stub = new TrialStub();
    const first = await trialAdapter(stub).request(ask());
    const credential = stub.credentials()[0]!;
    const trials = join(dir.path, 'profiles', 'default', 'trials');
    const [file] = trialFiles();
    const path = join(trials, file!);
    if (process.platform !== 'win32') {
      expect(statSync(path).mode & 0o777).toBe(0o600);
      expect(statSync(trials).mode & 0o777).toBe(0o700);
    }
    expect(readFileSync(path, 'utf8')).toContain(credential);
    // Never in a handle record, a result or the origin-derived file name.
    const handles = join(dir.path, 'profiles', 'default', 'handles');
    for (const name of readdirSync(handles))
      expect(readFileSync(join(handles, name), 'utf8')).not.toContain(credential);
    expect(JSON.stringify(first)).not.toContain(credential);
    // A new adapter instance (a restart) reuses the same trial.
    await trialAdapter(stub).request(ask());
    expect(stub.anonymousCreates()).toHaveLength(1);
    expect(stub.trials.get(credential)!.created).toBe(2);
  });
});

describe('trial mode: only what the trial supports', () => {
  it('sess_publish, sess_complete and expires_in say so plainly, with the Free plan, and send nothing', async () => {
    const stub = new TrialStub();
    const adapter = trialAdapter(stub);
    const created = await adapter.request(ask());
    const eventId = stub.answer([...stub.sessions.keys()][0]!, ANSWER);
    const answered = await adapter.response({ handle: created.interaction.handle, revision: 1, waitMs: 0 });
    expect(answered.interaction.state).toBe('answered');
    const before = stub.calls.length;
    const publish = await failure(
      adapter.publish({
        handle: created.interaction.handle,
        expectedRevision: 1,
        responseEventId: eventId,
        interaction: ask().interaction,
      }),
    );
    const complete = await failure(
      adapter.complete({ handle: created.interaction.handle, expectedRevision: 1, responseEventId: eventId }),
    );
    const expires = await failure(adapter.request(parseAskArgs({ ...ASK, expires_in: 600 })));
    for (const error of [publish, complete, expires]) {
      expect(error.code).toBe('TRIAL_UNSUPPORTED');
      expect(error.message).toMatch(/Free plan/);
      expect(error.message).toMatch(/SESS_API_KEY/);
    }
    expect(publish.message).toMatch(/sess_publish/);
    expect(complete.message).toMatch(/sess_complete/);
    expect(expires.message).toMatch(/expires_in/);
    expect(stub.calls.length).toBe(before);
    // The refused expires_in left no record behind.
    expect(readdirSync(join(dir.path, 'profiles', 'default', 'handles'))).toHaveLength(1);
  });

  it('verifies receipts unchanged: an answer whose receipt does not verify is never accepted', async () => {
    const stub = new TrialStub();
    const adapter = trialAdapter(stub);
    const created = await adapter.request(ask());
    stub.answer([...stub.sessions.keys()][0]!, ANSWER, {
      privateKey: generateKeyPairSync('ed25519').privateKey,
    });
    const error = await failure(
      adapter.response({ handle: created.interaction.handle, revision: 1, waitMs: 0 }),
    );
    expect(error.code).toBe('VERIFICATION_FAILED');
  });

  it('a lost create response stays "outcome unknown"; it is never retried and a lost start saves no trial', async () => {
    const stub = new TrialStub();
    const adapter = trialAdapter(stub);
    stub.loseNextCreate = true;
    const lost = await failure(adapter.request(ask()));
    expect(lost.code).toBe('CREATE_OUTCOME_UNKNOWN');
    expect(lost.message).toMatch(/not retried|Do not call/);
    expect(stub.calls.filter((c) => c.method === 'POST')).toHaveLength(1);
    expect(trialFiles()).toEqual([]);
    // The same for a later create in a started trial.
    await adapter.request(ask());
    stub.loseNextCreate = true;
    const again = await failure(adapter.request(ask()));
    expect(again.code).toBe('CREATE_OUTCOME_UNKNOWN');
    const handles = join(dir.path, 'profiles', 'default', 'handles');
    const states = readdirSync(handles).map((n) => JSON.parse(readFileSync(join(handles, n), 'utf8')).state);
    expect(states.sort()).toEqual(['create_unknown', 'create_unknown', 'waiting']);
  });
});

describe('trial mode: limits name the limit and the Free plan; no replacement trial', () => {
  it('the active-Session limit', async () => {
    const stub = new TrialStub();
    const adapter = trialAdapter(stub);
    for (let i = 0; i < 3; i++) await adapter.request(ask());
    const error = await failure(adapter.request(ask()));
    expect(error.code).toBe('TRIAL_LIMIT');
    expect(error.message).toContain('3 requests waiting for an answer');
    expect(error.message).toContain('Free plan');
    expect(error.message).toContain('in about 10 minutes');
    expect(error.retryable).toBe(true);
    expect(stub.anonymousCreates()).toHaveLength(1);
  });

  it('the Sessions-per-trial limit', async () => {
    const stub = new TrialStub();
    const adapter = trialAdapter(stub);
    for (let i = 0; i < 10; i++) {
      await adapter.request(ask());
      stub.answer([...stub.sessions.keys()].at(-1)!, ANSWER);
    }
    for (let i = 0; i < 2; i++) {
      const error = await failure(adapter.request(ask()));
      expect(error.code).toBe('TRIAL_LIMIT');
      expect(error.message).toContain('made its 10 requests');
      expect(error.message).toContain('Free plan');
      expect(error.retryable).toBe(false);
    }
    expect(stub.anonymousCreates()).toHaveLength(1);
    expect(stub.trials.size).toBe(1);
  });

  it('the creation window', async () => {
    const stub = new TrialStub();
    await trialAdapter(stub).request(ask());
    stub.trials.get(stub.credentials()[0]!)!.expiresAt = Date.now() - 1;
    const later = trialAdapter(stub, { now: () => new Date(Date.now() + 25 * 3_600_000) });
    const error = await failure(later.request(ask()));
    expect(error.code).toBe('TRIAL_LIMIT');
    expect(error.message).toContain('24 hours for new requests have ended');
    expect(stub.anonymousCreates()).toHaveLength(1);
  });

  it('the new-trials-per-network limit', async () => {
    const stub = new TrialStub();
    stub.newTrials = 3;
    const error = await failure(trialAdapter(stub).request(ask()));
    expect(error.code).toBe('TRIAL_LIMIT');
    expect(error.message).toContain('started 3 trials in the last 24 hours');
    expect(error.message).toContain('in about 90 minutes');
    expect(error.message).toContain('Free plan');
    expect(trialFiles()).toEqual([]);
  });

  it('an ended trial (deleted, revoked) is TRIAL_ENDED and never replaced', async () => {
    const stub = new TrialStub();
    const adapter = trialAdapter(stub);
    await adapter.request(ask());
    stub.trials.get(stub.credentials()[0]!)!.deleted = true;
    for (let i = 0; i < 2; i++) {
      const error = await failure(adapter.request(ask()));
      expect(error.code).toBe('TRIAL_ENDED');
      expect(error.message).toContain('Free plan');
    }
    expect(stub.anonymousCreates()).toHaveLength(1);
  });

  it('TRIAL_LIMITS match the published trial limits in the API contract', () => {
    const contract = readFileSync(
      join(import.meta.dirname, '..', '..', '..', 'src', 'generated', 'openapi.ts'),
      'utf8',
    );
    const L = TRIAL_LIMITS;
    expect(contract).toContain(
      `human link and action window ${L.linkHours} hour; result readable ${L.resultHoursAfterLink} hours after the action window; ` +
        `at most ${L.maxActiveSessions} active Sessions and ${L.maxSessionsPerTrial} Sessions per trial within its ` +
        `${L.creationWindowHours}-hour creation window; at most ${L.maxTrialsPerClient} new trials per client and 200 overall per rolling ${L.trialRateWindowHours} hours`,
    );
  });
});

describe('trial mode: the read mapping', () => {
  it('sends the credential only to the trial read route and refuses every other route before dispatch', async () => {
    const seen: string[] = [];
    const inner = (async (input: string | URL | Request) => {
      seen.push(String(input));
      return new Response('{}', { status: 404, headers: { 'content-type': 'application/json' } });
    }) as typeof fetch;
    const mapped = trialReadFetch('https://api.sess.test', inner);
    const id = 'ses_00000000000000000000000001';
    await mapped(`https://api.sess.test/v1/sessions/${id}`, { headers: { authorization: 'Bearer x' } });
    for (const [url, init] of [
      [`https://api.sess.test/v1/sessions/${id}`, { method: 'PATCH' }],
      [`https://api.sess.test/v1/sessions/${id}/complete`, { method: 'POST' }],
      [`https://api.sess.test/v1/sessions/${id}/events`, {}],
      [`https://other.test/v1/sessions/${id}`, {}],
      ['https://api.sess.test/v1/sessions', { method: 'POST' }],
    ] as const)
      await expect(mapped(url, init)).rejects.toThrow(TypeError);
    expect(seen).toEqual([`https://api.sess.test/v1/trial/sessions/${id}`]);
  });
});
