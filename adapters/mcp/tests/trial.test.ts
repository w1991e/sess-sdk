import { spawnSync } from 'node:child_process';
import { createHash, generateKeyPairSync } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { Sess } from '@sess.si/sdk';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { AdapterError } from '../src/errors.js';
import { SessMcpAdapter } from '../src/operations.js';
import { createSessMcpServer } from '../src/server.js';
import {
  TRIAL_LIMITS,
  TRIAL_START_LOST,
  TRIAL_START_QUEUED,
  TrialStateStore,
  trialReadFetch,
} from '../src/trial.js';
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

  it('a lost create response in a started trial stays "outcome unknown" and is never retried', async () => {
    const stub = new TrialStub();
    const adapter = trialAdapter(stub);
    await adapter.request(ask());
    stub.loseNextCreate = true;
    const lost = await failure(adapter.request(ask()));
    expect(lost.code).toBe('CREATE_OUTCOME_UNKNOWN');
    expect(lost.message).toMatch(/not retried/);
    expect(stub.calls.filter((c) => c.method === 'POST')).toHaveLength(2);
    const handles = join(dir.path, 'profiles', 'default', 'handles');
    const states = readdirSync(handles).map((n) => JSON.parse(readFileSync(join(handles, n), 'utf8')).state);
    expect(states.sort()).toEqual(['create_unknown', 'waiting']);
    // Founder answer 3: once a trial exists, a later ask reuses it; no new trial is started.
    await new Promise((r) => setTimeout(r, 5));
    await adapter.request(ask());
    expect(stub.anonymousCreates()).toHaveLength(1);
  });
});

describe('trial mode: a trial start whose outcome is unknown (MCP-TRIAL-START-UNKNOWN-01, founder answer 2)', () => {
  const later = () => new Promise((r) => setTimeout(r, 5));
  const handleStates = () => {
    const handles = join(dir.path, 'profiles', 'default', 'handles');
    return readdirSync(handles)
      .map((n) => JSON.parse(readFileSync(join(handles, n), 'utf8')).state)
      .sort();
  };

  it('calls queued behind a lost start send nothing; the next ask starts exactly one new trial', async () => {
    const stub = new TrialStub();
    stub.loseNextCreate = true;
    stub.createDelayMs = 40;
    const one = trialAdapter(stub);
    const two = trialAdapter(stub);
    const results = await Promise.allSettled([one.request(ask()), one.request(ask()), two.request(ask())]);
    const errors = results.map((r) => {
      expect(r.status).toBe('rejected');
      return (r as PromiseRejectedResult).reason as AdapterError;
    });
    for (const e of errors) {
      expect(e.code).toBe('CREATE_OUTCOME_UNKNOWN');
      expect(e.message).toMatch(/unknown outcome|outcome is unknown/);
      expect(e.message).toContain('The next ask will start a new trial.');
    }
    expect(errors.filter((e) => e.message === TRIAL_START_LOST)).toHaveLength(1);
    expect(errors.filter((e) => e.message === TRIAL_START_QUEUED)).toHaveLength(2);
    // Queued calls: 0 extra POSTs. Sess applied the lost start, so exactly one trial exists.
    expect(stub.anonymousCreates()).toHaveLength(1);
    expect(stub.trials.size).toBe(1);
    expect(trialFiles()).toEqual([expect.stringMatching(/\.start\.json$/)]);
    expect(handleStates()).toEqual(['create_unknown']);
    // The next ask, after the outcome was reported, starts exactly one new trial.
    await later();
    expect((await one.request(ask())).interaction.state).toBe('waiting');
    expect(stub.anonymousCreates()).toHaveLength(2);
    expect(trialFiles()).toEqual([expect.stringMatching(/^[0-9a-f]{32}\.json$/)]);
    // And that trial is then reused, never replaced.
    await two.request(ask());
    expect(stub.anonymousCreates()).toHaveLength(2);
  });

  it('a restart after a lost start: the next ask sends exactly one new start', async () => {
    const stub = new TrialStub();
    stub.loseNextCreate = true;
    expect((await failure(trialAdapter(stub).request(ask()))).message).toBe(TRIAL_START_LOST);
    await later();
    const restarted = trialAdapter(stub);
    expect((await restarted.request(ask())).interaction.state).toBe('waiting');
    expect(stub.anonymousCreates()).toHaveLength(2);
    expect(handleStates()).toEqual(['create_unknown', 'waiting']);
  });

  it('an ask that begins while the lost start is still being reported fails closed (MCP-TRIAL-REPORT-ORDER-03)', async () => {
    const stub = new TrialStub();
    stub.loseNextCreate = true;
    const proto = TrialStateStore.prototype;
    const write = proto.writeStartIntent;
    const withLock = proto.withLock;
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    let paused!: () => void;
    const reporting = new Promise<void>((r) => (paused = r));
    let lockEntries = 0;
    proto.writeStartIntent = async function (this: TrialStateStore, ...args: Parameters<typeof write>) {
      // Pause only the report mark (the write that carries reportedAt), after its clock sample.
      if (args[1] !== undefined) {
        paused();
        await gate;
      }
      return write.apply(this, args);
    };
    proto.withLock = function (this: TrialStateStore, fn: () => Promise<unknown>) {
      lockEntries++;
      return withLock.call(this, fn);
    } as typeof withLock;
    try {
      let firstSettled = false;
      const firstAsk = trialAdapter(stub)
        .request(ask())
        .finally(() => (firstSettled = true));
      await reporting;
      // Real time moves past the report's clock sample; a second adapter's ask then begins and
      // waits for the lock while the report write is still pending.
      await later();
      const entered = lockEntries;
      const secondAsk = trialAdapter(stub).request(ask());
      while (lockEntries === entered) await new Promise((r) => setTimeout(r, 1));
      await later();
      expect(firstSettled).toBe(false);
      release();
      const [first, second] = await Promise.allSettled([firstAsk, secondAsk]);
      expect(first.status).toBe('rejected');
      expect(second.status).toBe('rejected');
      const one = (first as PromiseRejectedResult).reason as AdapterError;
      const two = (second as PromiseRejectedResult).reason as AdapterError;
      expect([one.code, one.message]).toEqual(['CREATE_OUTCOME_UNKNOWN', TRIAL_START_LOST]);
      expect([two.code, two.message]).toEqual(['CREATE_OUTCOME_UNKNOWN', TRIAL_START_QUEUED]);
      // One anonymous POST, one trial; the queued ask got no handle.
      expect(stub.anonymousCreates()).toHaveLength(1);
      expect(stub.trials.size).toBe(1);
      expect(handleStates()).toEqual(['create_unknown']);
    } finally {
      proto.writeStartIntent = write;
      proto.withLock = withLock;
    }
    // Control: an ask that begins after the report is persisted starts exactly one fresh trial,
    // which is then reused.
    const next = trialAdapter(stub);
    expect((await next.request(ask())).interaction.state).toBe('waiting');
    expect(stub.anonymousCreates()).toHaveLength(2);
    expect(stub.trials.size).toBe(2);
    await trialAdapter(stub).request(ask());
    expect(stub.anonymousCreates()).toHaveLength(2);
    expect(handleStates()).toEqual(['create_unknown', 'waiting', 'waiting']);
  });

  it('after a lost start, concurrent next asks still start exactly one trial', async () => {
    const stub = new TrialStub();
    stub.loseNextCreate = true;
    await failure(trialAdapter(stub).request(ask()));
    await later();
    stub.createDelayMs = 40;
    const one = trialAdapter(stub);
    const two = trialAdapter(stub);
    const results = await Promise.all([one.request(ask()), one.request(ask()), two.request(ask())]);
    expect(results.map((r) => r.interaction.state)).toEqual(['waiting', 'waiting', 'waiting']);
    expect(stub.anonymousCreates()).toHaveLength(2);
    expect(stub.calls.filter((c) => c.method === 'POST' && c.authorization)).toHaveLength(2);
  });

  it('an intent never reported (a server stopped mid-start) fails closed until the owner resolves it', async () => {
    const stub = new TrialStub();
    const trials = join(dir.path, 'profiles', 'default', 'trials');
    mkdirSync(trials, { recursive: true, mode: 0o700 });
    const name = createHash('sha256').update(stub.origin, 'utf8').digest('hex').slice(0, 32);
    writeFileSync(
      join(trials, `${name}.start.json`),
      JSON.stringify({ schema: 1, origin: stub.origin, at: new Date().toISOString() }),
      { mode: 0o600 },
    );
    await later();
    for (let i = 0; i < 2; i++) {
      const error = await failure(trialAdapter(stub).request(ask()));
      expect(error.code).toBe('CREATE_OUTCOME_UNKNOWN');
      expect(error.message).toContain('outcome is unknown');
      expect(error.message).toContain('trials folder');
    }
    expect(stub.calls).toHaveLength(0);
    rmSync(trials, { recursive: true });
    expect((await trialAdapter(stub).request(ask())).interaction.state).toBe('waiting');
    expect(stub.anonymousCreates()).toHaveLength(1);
  });

  it('the start intent is saved (0600) before the anonymous POST is sent', async () => {
    const stub = new TrialStub();
    const trials = join(dir.path, 'profiles', 'default', 'trials');
    let seen: string[] = [];
    const fetchSpy = (async (input: string | URL | Request, init?: RequestInit) => {
      if (String(input).endsWith('/v1/trial/sessions')) {
        seen = readdirSync(trials);
        if (process.platform !== 'win32')
          for (const n of seen) expect(statSync(join(trials, n)).mode & 0o777).toBe(0o600);
      }
      return stub.fetch(input, init);
    }) as typeof fetch;
    const adapter = new SessMcpAdapter({ env: trialEnv(stub), diagnostics: () => {}, fetch: fetchSpy });
    await adapter.request(ask());
    expect(seen.some((n) => n.endsWith('.start.json'))).toBe(true);
    expect(seen.some((n) => /^[0-9a-f]{32}\.json$/.test(n))).toBe(false);
    // Promoted: only the trial record remains.
    expect(trialFiles()).toEqual([expect.stringMatching(/^[0-9a-f]{32}\.json$/)]);
  });

  it('a definite refusal clears the intent, so a later ask may start the trial', async () => {
    const stub = new TrialStub();
    stub.newTrials = 3;
    const adapter = trialAdapter(stub);
    expect((await failure(adapter.request(ask()))).code).toBe('TRIAL_LIMIT');
    expect(trialFiles()).toEqual([]);
    stub.newTrials = 0;
    expect((await adapter.request(ask())).interaction.state).toBe('waiting');
    expect(stub.anonymousCreates()).toHaveLength(2);
    expect(stub.trials.size).toBe(1);
  });
});

describe('trial mode: the trial lock (MCP-TRIAL-LOCK-02)', () => {
  const lockPath = (stub: TrialStub) => {
    const name = createHash('sha256').update(stub.origin, 'utf8').digest('hex').slice(0, 32);
    return join(dir.path, 'profiles', 'default', 'trials', `${name}.json.lock`);
  };
  const deadPid = () => {
    const child = spawnSync(process.execPath, ['-e', '']);
    return child.pid!;
  };

  it('two reclaimers of a stale lock both fail closed; neither removes it or sends anything', async () => {
    const stub = new TrialStub();
    const lock = lockPath(stub);
    mkdirSync(join(lock, '..'), { recursive: true, mode: 0o700 });
    const stale = JSON.stringify({ pid: deadPid(), token: 'stale-holder' });
    writeFileSync(lock, stale, { mode: 0o600 });
    const results = await Promise.allSettled([
      trialAdapter(stub).request(ask()),
      trialAdapter(stub).request(ask()),
    ]);
    for (const r of results) {
      expect(r.status).toBe('rejected');
      const error = (r as PromiseRejectedResult).reason as AdapterError;
      expect(error.code).toBe('STATE_STORE_ERROR');
      expect(error.message).toContain('.lock');
    }
    expect(readFileSync(lock, 'utf8')).toBe(stale);
    expect(stub.calls).toHaveLength(0);
  });

  it('waits for a live holder, then proceeds once it releases', async () => {
    const stub = new TrialStub();
    const lock = lockPath(stub);
    mkdirSync(join(lock, '..'), { recursive: true, mode: 0o700 });
    writeFileSync(lock, JSON.stringify({ pid: process.pid, token: 'live-holder' }), { mode: 0o600 });
    const pending = trialAdapter(stub).request(ask());
    await new Promise((r) => setTimeout(r, 150));
    expect(stub.calls).toHaveLength(0);
    rmSync(lock);
    expect((await pending).interaction.state).toBe('waiting');
    expect(stub.anonymousCreates()).toHaveLength(1);
    expect(existsSync(lock)).toBe(false);
  });

  it('release never removes a replacement live holder’s lock', async () => {
    const stub = new TrialStub();
    const store = new TrialStateStore(dir.path, 'default', stub.origin);
    const lock = lockPath(stub);
    const replacement = JSON.stringify({ pid: process.pid, token: 'replacement-holder' });
    await store.withLock(async () => {
      expect(JSON.parse(readFileSync(lock, 'utf8')).pid).toBe(process.pid);
      // Another holder's lock replaces ours while we hold the section.
      writeFileSync(lock, replacement, { mode: 0o600 });
    });
    expect(readFileSync(lock, 'utf8')).toBe(replacement);
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
