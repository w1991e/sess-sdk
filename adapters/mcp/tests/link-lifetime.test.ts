import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { SessError } from '@sess.si/sdk';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AdapterError } from '../src/errors.js';
import { SessMcpAdapter } from '../src/operations.js';
import { TOOLS } from '../src/tools.js';
import { parseAskArgs, parseRequestArgs } from '../src/validate.js';
import {
  ANSWER_1,
  FakeSess,
  ROUND_1,
  acceptingVerifier,
  adapterWith,
  clientFor,
  env,
  tempDir,
} from './helpers.js';

// Decision 0009 Amendment 7 (S-09) in the MCP tools: an optional `expires_in` on sess_request and
// sess_ask with the API's name and range, the link's expiry on create, and an expired link reported
// as the final state "expired" (never a completion, never an error needing owner review).

let dir: ReturnType<typeof tempDir>;
beforeEach(() => {
  dir = tempDir();
});
afterEach(() => dir.cleanup());

function records(profile = 'default'): any[] {
  const handles = join(dir.path, 'profiles', profile, 'handles');
  return readdirSync(handles)
    .filter((n) => n.endsWith('.json'))
    .map((n) => JSON.parse(readFileSync(join(handles, n), 'utf8')));
}
/** The adapter's link expiry grace, as in the SDK wait. */
const LINK_EXPIRY_GRACE_MS = 2000;
const tool = (name: string) => TOOLS.find((t) => t.name === name)!;
const ask = { question: 'Synthetic question?', fields: [{ name: 'ok', label: 'OK', type: 'boolean' }] };

describe('expires_in in the tool schemas', () => {
  it('is optional on sess_request and sess_ask, an integer from 30, described as Advanced; the required fields are unchanged', () => {
    for (const name of ['sess_request', 'sess_ask']) {
      const schema = tool(name).inputSchema as any;
      expect(schema.properties.expires_in).toMatchObject({ type: 'integer', minimum: 30 });
      expect(schema.properties.expires_in.description).toMatch(/^Advanced: /);
      expect(schema.required).not.toContain('expires_in');
    }
    expect((tool('sess_request').inputSchema as any).required).toEqual(['interaction']);
    expect((tool('sess_ask').inputSchema as any).required).toEqual(['question', 'fields']);
    const states = (tool('sess_response').outputSchema as any).properties.interaction.properties.state.enum;
    expect(states).toContain('expired');
  });

  it('parses 30 and above; refuses 29, fractions, strings and null as INVALID_ARGUMENTS', () => {
    expect(parseRequestArgs({ interaction: ROUND_1, expires_in: 30 }).expiresIn).toBe(30);
    expect(parseAskArgs({ ...ask, expires_in: 600 }).expiresIn).toBe(600);
    expect('expiresIn' in parseAskArgs(ask)).toBe(false);
    expect(parseAskArgs({ ...ask, expires_in: 600 }).interaction).toEqual(parseAskArgs(ask).interaction);
    for (const bad of [29, 0, 30.5, '600', null])
      for (const parse of [
        () => parseRequestArgs({ interaction: ROUND_1, expires_in: bad }),
        () => parseAskArgs({ ...ask, expires_in: bad }),
      ])
        expect(parse).toThrow(AdapterError);
  });
});

describe('expires_in in the operations', () => {
  it('sess_request sends expires_in and returns expiresAt with the link', async () => {
    const fake = new FakeSess();
    const original = fake.fetch;
    const bodies: string[] = [];
    fake.fetch = async (input, init) => {
      if (init?.method === 'POST') bodies.push(String(init.body));
      return original(input, init);
    };
    const adapter = adapterWith(dir.path, fake);
    const result = await adapter.request(parseRequestArgs({ interaction: ROUND_1, expires_in: 45 }));
    expect(bodies.map((b) => JSON.parse(b).expires_in)).toEqual([45]);
    expect(result.interaction.state).toBe('waiting');
    expect(result.interaction.expiresAt).toBe(fake.session!.action_expires_at);
    // Without it, nothing is sent and no expiry is invented.
    const plain = await adapterWith(dir.path, new FakeSess()).request(
      parseRequestArgs({ interaction: ROUND_1 }),
    );
    expect(plain.interaction.expiresAt).toBeUndefined();
  });

  it('a read-once after the expiry with no answer reports "expired", finally: later reads stay expired without a call, and complete is refused', async () => {
    const fake = new FakeSess();
    const adapter = adapterWith(dir.path, fake, { verify: acceptingVerifier(fake) });
    const created = await adapter.request(parseRequestArgs({ interaction: ROUND_1, expires_in: 30 }));
    const handle = created.interaction.handle;
    // Before the expiry: still waiting.
    expect((await adapter.response({ handle, revision: 1, waitMs: 0 })).interaction.state).toBe('waiting');
    // The link expired three seconds ago (past the two-second grace).
    fake.session!.action_expires_at = new Date(Date.now() - 3000).toISOString();
    const expired = await adapter.response({ handle, revision: 1, waitMs: 0 });
    expect(expired.interaction).toEqual({ handle, revision: 1, state: 'expired' });
    expect(records()[0]).toMatchObject({ state: 'blocked', blockedReason: 'LINK_EXPIRED' });
    const calls = fake.calls.length;
    expect((await adapter.response({ handle, revision: 1, waitMs: 0 })).interaction.state).toBe('expired');
    expect(fake.calls.length).toBe(calls);
    await expect(
      adapter.complete({ handle, expectedRevision: 1, responseEventId: 'evt_00000000000000000000000001' }),
    ).rejects.toMatchObject({ code: 'INVALID_STATE' });
    expect(fake.calls.filter((c) => c.method !== 'GET')).toHaveLength(1); // the create only
  });

  it('an answer accepted before the expiry is still released after it', async () => {
    const fake = new FakeSess();
    const adapter = adapterWith(dir.path, fake, { verify: acceptingVerifier(fake) });
    const created = await adapter.request(parseRequestArgs({ interaction: ROUND_1, expires_in: 30 }));
    const eventId = fake.answer(ANSWER_1.data, ANSWER_1.action_id);
    fake.session!.action_expires_at = new Date(Date.now() - 60_000).toISOString();
    const result = await adapter.response({ handle: created.interaction.handle, revision: 1, waitMs: 0 });
    expect(result.interaction.state).toBe('answered');
    expect(result.interaction.response?.eventId).toBe(eventId);
  });

  it('a wait that ends with LINK_EXPIRED reports "expired"', async () => {
    const fake = new FakeSess();
    const base = clientFor(fake, acceptingVerifier(fake));
    const adapter = new SessMcpAdapter({
      env: env(dir.path),
      diagnostics: () => undefined,
      createClient: (config) => {
        const client = base(config);
        return {
          ...client,
          sessions: {
            ...client.sessions,
            create: client.sessions.create.bind(client.sessions),
            retrieve: client.sessions.retrieve.bind(client.sessions),
            publish: client.sessions.publish.bind(client.sessions),
            complete: client.sessions.complete.bind(client.sessions),
            waitForResponse: async (sessionId: string, options: { revision: number }) => {
              throw new SessError('wait_ended', 'The Sess link expired.', {
                code: 'LINK_EXPIRED',
                sessionId,
                revision: options.revision,
              });
            },
          },
        } as ReturnType<typeof base>;
      },
    });
    const created = await adapter.request(parseRequestArgs({ interaction: ROUND_1, expires_in: 30 }));
    const result = await adapter.response({ handle: created.interaction.handle, revision: 1, waitMs: 1000 });
    expect(result.interaction.state).toBe('expired');
  });
});

/** A client whose wait always ends with LINK_EXPIRED, as an SDK before link timing does at the deadline. */
function linkExpiredWait(fake: FakeSess): SessMcpAdapter {
  const base = clientFor(fake, acceptingVerifier(fake));
  return new SessMcpAdapter({
    env: env(dir.path),
    diagnostics: () => undefined,
    createClient: (config) => {
      const client = base(config);
      return {
        ...client,
        sessions: {
          ...client.sessions,
          create: client.sessions.create.bind(client.sessions),
          retrieve: client.sessions.retrieve.bind(client.sessions),
          publish: client.sessions.publish.bind(client.sessions),
          complete: client.sessions.complete.bind(client.sessions),
          waitForResponse: async (sessionId: string, options: { revision: number }) => {
            throw new SessError('wait_ended', 'The Sess link expired.', {
              code: 'LINK_EXPIRED',
              sessionId,
              revision: options.revision,
            });
          },
        },
      } as ReturnType<typeof base>;
    },
  });
}

// Decision 0009 Amendment 10: a link of 20 hours or less can be extended by the person up to a
// fixed horizon. A lapsed link (past its deadline, still extendable) takes no answer but is still
// open: sess_response (and so sess_ask) reports "waiting", never "expired", until a read shows the
// link expired.
describe('link timing: lapsed is still open', () => {
  const lapsed = (fake: FakeSess, deadlineAgoMs: number, horizonInMs: number) =>
    Object.assign(fake.session!, {
      action_expires_at: new Date(Date.now() - deadlineAgoMs).toISOString(),
      action_expires_horizon: new Date(Date.now() + horizonInMs).toISOString(),
      extensions_used: 0,
      link_state: 'lapsed',
      extensions: [],
    });

  it('a read of a lapsed link, a minute past its deadline, reports "waiting"; once a read shows it expired past its horizon, "expired"', async () => {
    const fake = new FakeSess();
    const adapter = adapterWith(dir.path, fake, { verify: acceptingVerifier(fake) });
    const created = await adapter.request(parseRequestArgs({ interaction: ROUND_1, expires_in: 30 }));
    const handle = created.interaction.handle;
    lapsed(fake, 60_000, 300_000);
    expect((await adapter.response({ handle, revision: 1, waitMs: 0 })).interaction.state).toBe('waiting');
    expect(records()[0].state).not.toBe('blocked');
    // The horizon passed three seconds ago with no extension: expired.
    Object.assign(fake.session!, {
      action_expires_horizon: new Date(Date.now() - 3000).toISOString(),
      link_state: 'expired',
    });
    expect((await adapter.response({ handle, revision: 1, waitMs: 0 })).interaction.state).toBe('expired');
    expect(records()[0]).toMatchObject({ state: 'blocked', blockedReason: 'LINK_EXPIRED' });
  });

  it('a live read is never expired, even an hour past its deadline by the clocks; a link read as expired before its end (revoked) is "expired" only once a read the grace later still shows it', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    try {
      const fake = new FakeSess();
      const adapter = adapterWith(dir.path, fake, { verify: acceptingVerifier(fake) });
      const created = await adapter.request(parseRequestArgs({ interaction: ROUND_1, expires_in: 30 }));
      const handle = created.interaction.handle;
      Object.assign(fake.session!, {
        action_expires_at: new Date(Date.now() - 3_600_000).toISOString(),
        action_expires_horizon: null,
        extensions_used: 0,
        link_state: 'live',
        extensions: [],
      });
      expect((await adapter.response({ handle, revision: 1, waitMs: 0 })).interaction.state).toBe('waiting');
      Object.assign(fake.session!, {
        action_expires_at: new Date(Date.now() + 600_000).toISOString(),
        link_state: 'expired',
      });
      // The first such read cannot be final: an answer accepted just before the revocation may
      // still be landing (A10-SDK-GRACE-01, as in the SDK wait).
      expect((await adapter.response({ handle, revision: 1, waitMs: 0 })).interaction.state).toBe('waiting');
      expect(records()[0].state).not.toBe('blocked');
      vi.setSystemTime(Date.now() + LINK_EXPIRY_GRACE_MS - 1);
      expect((await adapter.response({ handle, revision: 1, waitMs: 0 })).interaction.state).toBe('waiting');
      vi.setSystemTime(Date.now() + 1);
      expect((await adapter.response({ handle, revision: 1, waitMs: 0 })).interaction.state).toBe('expired');
      expect(records()[0]).toMatchObject({ state: 'blocked', blockedReason: 'LINK_EXPIRED' });
    } finally {
      vi.useRealTimers();
    }
  });

  it('A10-SDK-GRACE-01: an answer that becomes visible inside the grace after a revoked (expired, end ahead) read-once is released, never reported as expired', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    try {
      const fake = new FakeSess();
      const adapter = adapterWith(dir.path, fake, { verify: acceptingVerifier(fake) });
      const created = await adapter.request(parseRequestArgs({ interaction: ROUND_1, expires_in: 30 }));
      const handle = created.interaction.handle;
      Object.assign(fake.session!, {
        action_expires_at: new Date(Date.now() + 600_000).toISOString(),
        action_expires_horizon: null,
        extensions_used: 0,
        link_state: 'expired',
        extensions: [],
      });
      expect((await adapter.response({ handle, revision: 1, waitMs: 0 })).interaction.state).toBe('waiting');
      vi.setSystemTime(Date.now() + 1_500);
      const eventId = fake.answer(ANSWER_1.data, ANSWER_1.action_id);
      const result = await adapter.response({ handle, revision: 1, waitMs: 0 });
      expect(result.interaction.state).toBe('answered');
      expect(result.interaction.response?.eventId).toBe(eventId);
    } finally {
      vi.useRealTimers();
    }
  });

  it('A10-SDK-GRACE-01: an expired read with no end given is placed by the grace too, and a read that is not expired starts the grace again', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    try {
      const fake = new FakeSess();
      const adapter = adapterWith(dir.path, fake, { verify: acceptingVerifier(fake) });
      const created = await adapter.request(parseRequestArgs({ interaction: ROUND_1, expires_in: 30 }));
      const handle = created.interaction.handle;
      Object.assign(fake.session!, {
        action_expires_at: null,
        action_expires_horizon: null,
        extensions_used: 0,
        link_state: 'expired',
        extensions: [],
      });
      expect((await adapter.response({ handle, revision: 1, waitMs: 0 })).interaction.state).toBe('waiting');
      // A read that is not expired in between starts the grace again.
      fake.session!.link_state = 'lapsed';
      vi.setSystemTime(Date.now() + 1_000);
      expect((await adapter.response({ handle, revision: 1, waitMs: 0 })).interaction.state).toBe('waiting');
      fake.session!.link_state = 'expired';
      vi.setSystemTime(Date.now() + 1_500);
      expect((await adapter.response({ handle, revision: 1, waitMs: 0 })).interaction.state).toBe('waiting');
      vi.setSystemTime(Date.now() + LINK_EXPIRY_GRACE_MS);
      expect((await adapter.response({ handle, revision: 1, waitMs: 0 })).interaction.state).toBe('expired');
    } finally {
      vi.useRealTimers();
    }
  });

  it('a wait that ends with LINK_EXPIRED while a read shows the link lapsed reports "waiting", not "expired"; nothing is written on Sess', async () => {
    const fake = new FakeSess();
    const adapter = linkExpiredWait(fake);
    const created = await adapter.request(parseRequestArgs({ interaction: ROUND_1, expires_in: 30 }));
    lapsed(fake, 60_000, 300_000);
    const result = await adapter.response({ handle: created.interaction.handle, revision: 1, waitMs: 1000 });
    expect(result.interaction.state).toBe('waiting');
    expect(records()[0].state).not.toBe('blocked');
    expect(fake.calls.filter((c) => c.method !== 'GET')).toHaveLength(1); // the create only
  });

  it('a wait that ends with LINK_EXPIRED while a read shows the link expired reports "expired"', async () => {
    const fake = new FakeSess();
    const adapter = linkExpiredWait(fake);
    const created = await adapter.request(parseRequestArgs({ interaction: ROUND_1, expires_in: 30 }));
    lapsed(fake, 600_000, -3_000);
    fake.session!.link_state = 'expired';
    const result = await adapter.response({ handle: created.interaction.handle, revision: 1, waitMs: 1000 });
    expect(result.interaction.state).toBe('expired');
  });
});
