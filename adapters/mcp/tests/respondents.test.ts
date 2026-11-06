import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { Sess, SessError, type AcceptedResponse } from '@sess.si/sdk';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { AdapterError, stderrDiagnostics } from '../src/errors.js';
import { isUnsafeToolCall } from '../src/guard.js';
import { sdkClient, type AskOperations, type AskPage, type SessClient } from '../src/operations.js';
import { createSessMcpServer } from '../src/server.js';
import { TOOLS } from '../src/tools.js';
import { parseAskArgs, parseRequestArgs, type JsonObject } from '../src/validate.js';
import { API_KEY, FakeSess, ORIGIN, ROUND_1, clientFor, env, tempDir } from './helpers.js';

/** The Ask (Sess P2-24(d), Decision 0011): sess_ask's Advanced `respondents`, read by sess_response. */
const ASK_ID = `ask_01JASK${'0'.repeat(20)}`;
const QUESTION = {
  question: 'End of class check',
  fields: [{ name: 'understood', label: 'Did it make sense?', type: 'choice', options: ['Yes', 'No'] }],
};

/**
 * An in-memory stand-in for the two SDK operations the adapter uses for an Ask (the pinned SDK
 * before 0.2.0 has neither): `sess.ask({ ..., respondents })` and `sess.asks.retrieve`.
 */
class FakeAsks implements AskOperations {
  inputs: JsonObject[] = [];
  reads = 0;
  link = 'https://app.sess.test/n/synthetic-one-link-token';
  page: AskPage = {
    status: 'open',
    closed_by: null,
    max: 3,
    counts: { started: 0, answered: 0, completed: 0, refused: { full: 0, paused: 0 } },
    sessions: [],
    next_cursor: null,
  };
  createFailure: SessError | undefined;
  pageSize = 100;
  async create(input: JsonObject) {
    this.inputs.push(structuredClone(input));
    if (this.createFailure) throw this.createFailure;
    return { askId: ASK_ID, link: this.link, expiresAt: '2026-11-12T10:00:00.000Z', max: 3 };
  }
  async retrieve(id: string, options: { cursor?: string } = {}) {
    this.reads++;
    expect(id).toBe(ASK_ID);
    const from = options.cursor ? Number(options.cursor) : 0;
    const sessions = this.page.sessions.slice(from, from + this.pageSize);
    const more = from + this.pageSize < this.page.sessions.length;
    return {
      data: {
        ...structuredClone(this.page),
        sessions,
        next_cursor: more ? String(from + this.pageSize) : null,
      },
    };
  }
  start(): string {
    const id = `ses_01JRESP${String(this.page.sessions.length + 1).padStart(19, '0')}`;
    this.page.sessions.push({
      id,
      status: 'active',
      started_at: '2026-11-05T10:01:00.000Z',
      completed_at: null,
      responses: [],
    });
    this.page.counts.started++;
    if (this.page.sessions.length === this.page.max) {
      this.page.status = 'closed';
      this.page.closed_by = 'max';
    }
    return id;
  }
  answer(id: string, data: Record<string, unknown>): AcceptedResponse {
    const s = this.page.sessions.find((r) => r.id === id)!;
    const response = {
      event_id: `evt_${String(this.page.counts.answered + 1).padStart(26, '0')}`,
      sequence: 1,
      revision: 1,
      action_id: 'submit',
      data,
      actor: { assurance: 'link_holder' as const },
      accepted_at: '2026-11-05T10:02:00.000Z',
      receipt: 'aaaa.bbbb.cccc',
    };
    s.responses.push(response);
    s.status = 'completed';
    s.completed_at = response.accepted_at;
    this.page.counts.answered++;
    this.page.counts.completed++;
    return response;
  }
}

type Verify = SessClient['receipts']['verifyResponse'];
/** Accepts what the fake Ask holds for that respondent (receipt verification itself is the SDK's). */
function verifierFor(asks: FakeAsks, calls: string[] = []): Verify {
  return (async ({ sessionId, response }: { sessionId: string; response: AcceptedResponse }) => {
    calls.push(sessionId);
    const held = asks.page.sessions.find((s) => s.id === sessionId);
    if (!held?.responses.some((r) => r.event_id === response.event_id))
      throw new SessError('receipt_verification', 'not held', { code: 'RECORD_BINDING_MISMATCH' });
    return {
      claims: {},
      response,
      surface: { id: sessionId, revision: 1, interaction: {}, response_schema: {} },
    };
  }) as unknown as Verify;
}

let dir: ReturnType<typeof tempDir>;
beforeEach(() => {
  dir = tempDir();
});
afterEach(() => dir.cleanup());

async function connect(asks: FakeAsks | undefined, verify?: Verify) {
  const fake = new FakeSess();
  const lines: string[] = [];
  let secrets: () => readonly string[] = () => [];
  const base = clientFor(fake);
  const created = createSessMcpServer({
    env: env(dir.path),
    createClient: (config) => ({
      ...base(config),
      ...(verify ? { receipts: { verifyResponse: verify } } : {}),
      ...(asks ? { respondents: asks } : {}),
    }),
    diagnostics: stderrDiagnostics(
      (line) => lines.push(line),
      () => secrets(),
    ),
  });
  secrets = () => created.adapter.secrets();
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await created.connect(serverTransport);
  const client = new Client({ name: 'test-client', version: '0.0.0' });
  await client.connect(clientTransport);
  return { client, lines, fake, adapter: created.adapter };
}
const call = (client: Client, name: string, args: Record<string, unknown>) =>
  client.callTool({ name, arguments: args }) as Promise<{
    isError?: boolean;
    content: { type: string; text: string }[];
    structuredContent?: any;
  }>;
const errorOf = (result: { content: { text: string }[] }) => JSON.parse(result.content[0]!.text).error;

describe('sess_ask with respondents: the schema', () => {
  const ask = TOOLS.find((t) => t.name === 'sess_ask')!;
  it('takes respondents under Advanced, with max required and the SDK’s shape (no auto_complete: no tool continues one respondent)', () => {
    const schema = (ask.inputSchema as any).properties.respondents;
    expect(schema).toMatchObject({ type: 'object', additionalProperties: false, required: ['max'] });
    expect(schema.description).toMatch(/^Advanced: /);
    expect(Object.keys(schema.properties)).toEqual(['max', 'name', 'expires_in', 'respondent_expires_in']);
    expect(schema.properties.max).toMatchObject({ type: 'integer', minimum: 2 });
    for (const key of ['name', 'expires_in', 'respondent_expires_in'])
      expect(schema.properties[key].description, key).toMatch(/^Advanced: /);
    expect((ask.inputSchema as any).required).toEqual(['question', 'fields']);
  });

  it('leaves sess_request exactly as it was: no respondents, no Ask in its result', () => {
    const request = TOOLS.find((t) => t.name === 'sess_request')!;
    expect(Object.keys((request.inputSchema as any).properties)).toEqual(['interaction', 'expires_in']);
    const out = (request.outputSchema as any).properties.interaction.properties;
    expect(out.ask).toBeUndefined();
    expect(out.state.enum).not.toContain('closed');
    expect(() => parseRequestArgs({ interaction: ROUND_1, respondents: { max: 3 } })).toThrow(AdapterError);
  });

  it('parses respondents to the create body, only what was given; without respondents nothing changes', () => {
    expect(parseAskArgs({ ...QUESTION, respondents: { max: 20 } }).ask!.body).toEqual({
      respondents: { max: 20 },
    });
    expect(
      parseAskArgs({
        ...QUESTION,
        respondents: { max: 20, name: true, expires_in: 3600, respondent_expires_in: 600 },
      }).ask!.body,
    ).toEqual({ respondents: { max: 20, name: true }, expires_in: 3600, respondent_expires_in: 600 });
    const plain = parseAskArgs(QUESTION);
    expect(Object.keys(plain)).toEqual(['interaction']);
    expect(parseAskArgs({ ...QUESTION, respondents: { max: 2 } }).interaction).toEqual(plain.interaction);
  });

  it('the unsafe-key guard and the argument check reach inside respondents', () => {
    const raw = `{"question":"Q","fields":[{"name":"a","label":"A","type":"text"}],"respondents":{"max":3,"__proto__":{"x":1}}}`;
    expect(
      isUnsafeToolCall({
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/call',
        params: { arguments: JSON.parse(raw) },
      }),
    ).toBe(true);
    expect(() => parseAskArgs(JSON.parse(raw))).toThrow(AdapterError);
  });

  it('refuses before sending what Sess would refuse, naming the argument', () => {
    const refused = (args: Record<string, unknown>) => {
      try {
        parseAskArgs({ ...QUESTION, ...args });
      } catch (error) {
        expect(error).toBeInstanceOf(AdapterError);
        return (error as AdapterError).message;
      }
      throw new Error('accepted');
    };
    for (const max of [1, 2.5, '20', null])
      expect(refused({ respondents: { max } })).toBe('respondents.max: must be a whole number, at least 2');
    expect(refused({ respondents: {} })).toMatch(/^respondents: /);
    expect(refused({ respondents: { max: 3, auto_complete: false } })).toMatch(
      /^respondents: .*auto_complete/,
    );
    expect(refused({ respondents: { max: 3 }, expires_in: 600 })).toBe(
      'expires_in: is for one person’s link; with respondents, use respondents.expires_in',
    );
    expect(refused({ respondents: { max: 3, expires_in: 29 } })).toBe(
      'respondents.expires_in: must be a whole number of seconds, at least 30',
    );
    expect(refused({ respondents: { max: 3, respondent_expires_in: 1.5 } })).toBe(
      'respondents.respondent_expires_in: must be a whole number of seconds, at least 30',
    );
    expect(refused({ respondents: { max: 3, name: 'yes' } })).toBe('respondents.name: must be a boolean');
    expect(
      refused({
        fields: [{ name: 'name', label: 'Name', type: 'text' }],
        respondents: { max: 3, name: true },
      }),
    ).toBe('respondents.name: adds a field named "name"; rename the field that has it');
  });
});

describe('sess_ask with respondents: the Ask through the tools', () => {
  it('creates one Ask through the SDK with the arguments, shares its one link and returns the Ask id', async () => {
    const asks = new FakeAsks();
    const { client, fake, lines } = await connect(asks, verifierFor(asks));
    const args = { ...QUESTION, respondents: { max: 3 } };
    const created = await call(client, 'sess_ask', args);
    expect(created.isError).toBeFalsy();
    expect(asks.inputs).toEqual([args]);
    expect(fake.calls).toEqual([]);
    const { interaction } = created.structuredContent;
    expect(interaction).toMatchObject({
      revision: 1,
      state: 'waiting',
      humanUrl: asks.link,
      expiresAt: '2026-11-12T10:00:00.000Z',
      ask: { id: ASK_ID, max: 3 },
    });
    const text = created.content[0]!.text;
    expect(text.startsWith(`Share this link with everyone who should answer: ${asks.link}\n`)).toBe(true);
    expect(text).toContain('Each person gets their own page. Call sess_response to read their answers.');
    expect(lines.join('')).not.toContain(asks.link);
  });

  it('sess_response reads the Ask at once: counts, each respondent in Start order, each answer verified', async () => {
    const asks = new FakeAsks();
    const verified: string[] = [];
    const { client } = await connect(asks, verifierFor(asks, verified));
    const { handle } = (await call(client, 'sess_ask', { ...QUESTION, respondents: { max: 3 } }))
      .structuredContent.interaction;
    const first = asks.start();
    asks.answer(first, { understood: 'Yes' });
    const second = asks.start();
    const read = await call(client, 'sess_response', { handle, revision: 1 });
    expect(read.isError).toBeFalsy();
    const { interaction } = read.structuredContent;
    expect(interaction.state).toBe('waiting');
    expect(interaction.ask).toMatchObject({
      id: ASK_ID,
      status: 'open',
      closedBy: null,
      counts: { started: 2, answered: 1, completed: 1 },
    });
    expect(interaction.ask.respondents).toEqual([
      {
        status: 'completed',
        startedAt: '2026-11-05T10:01:00.000Z',
        completedAt: '2026-11-05T10:02:00.000Z',
        response: {
          eventId: 'evt_00000000000000000000000001',
          actionId: 'submit',
          data: { understood: 'Yes' },
          verified: true,
          actorAssurance: 'link_holder',
        },
      },
      { status: 'active', startedAt: '2026-11-05T10:01:00.000Z' },
    ]);
    expect(verified).toEqual([first]);
    // An Ask's read is the JSON result alone: the one-person re-wait line does not apply.
    expect(JSON.parse(read.content[0]!.text)).toEqual(read.structuredContent);
    // A second read verifies only the new answer; the first is remembered.
    asks.answer(second, { understood: 'No' });
    await call(client, 'sess_response', { handle, revision: 1 });
    expect(verified).toEqual([first, second]);
  });

  it('is closed once no more answers can come; closed at the last place while someone still answers is waiting', async () => {
    const asks = new FakeAsks();
    const { client } = await connect(asks, verifierFor(asks));
    const { handle } = (await call(client, 'sess_ask', { ...QUESTION, respondents: { max: 3 } }))
      .structuredContent.interaction;
    const ids = [asks.start(), asks.start(), asks.start()];
    asks.answer(ids[0]!, { understood: 'Yes' });
    asks.answer(ids[1]!, { understood: 'No' });
    let read = (await call(client, 'sess_response', { handle, revision: 1 })).structuredContent.interaction;
    expect(read.ask).toMatchObject({ status: 'closed', closedBy: 'max' });
    expect(read.state).toBe('waiting');
    asks.answer(ids[2]!, { understood: 'Yes' });
    read = (await call(client, 'sess_response', { handle, revision: 1 })).structuredContent.interaction;
    expect(read.state).toBe('closed');
    expect(read.ask.respondents.map((r: any) => r.response.data.understood)).toEqual(['Yes', 'No', 'Yes']);
    // Final: later reads still return the answers, and the handle no longer holds the link.
    const again = (await call(client, 'sess_response', { handle, revision: 1 })).structuredContent
      .interaction;
    expect(again.state).toBe('closed');
    expect(again.ask.respondents).toHaveLength(3);
    const saved = readdirSync(join(dir.path, 'profiles', 'default', 'handles'));
    const record = JSON.parse(
      readFileSync(join(dir.path, 'profiles', 'default', 'handles', saved[0]!), 'utf8'),
    );
    expect(record).toMatchObject({ state: 'completed', askId: ASK_ID, revision: 1 });
    expect(record.humanUrl).toBeUndefined();
  });

  it('the owner’s close or the deadline is final at once; a purged respondent is listed without an answer', async () => {
    for (const closedBy of ['owner', 'deadline'] as const) {
      const asks = new FakeAsks();
      const { client } = await connect(asks, verifierFor(asks));
      const { handle } = (await call(client, 'sess_ask', { ...QUESTION, respondents: { max: 3 } }))
        .structuredContent.interaction;
      asks.start();
      const purged = asks.start();
      asks.answer(purged, { understood: 'Yes' });
      const s = asks.page.sessions[1]!;
      s.status = 'purged';
      s.responses = [];
      asks.page.status = 'closed';
      asks.page.closed_by = closedBy;
      const read = (await call(client, 'sess_response', { handle, revision: 1 })).structuredContent
        .interaction;
      expect(read.state).toBe('closed');
      expect(read.ask.respondents.map((r: any) => [r.status, r.response])).toEqual([
        ['active', undefined],
        ['purged', undefined],
      ]);
    }
  });

  it('follows every page of the read', async () => {
    const asks = new FakeAsks();
    asks.pageSize = 2;
    asks.page.max = 10;
    const { client } = await connect(asks, verifierFor(asks));
    const { handle } = (await call(client, 'sess_ask', { ...QUESTION, respondents: { max: 10 } }))
      .structuredContent.interaction;
    for (let i = 0; i < 5; i++) asks.answer(asks.start(), { understood: i % 2 ? 'No' : 'Yes' });
    const read = (await call(client, 'sess_response', { handle, revision: 1 })).structuredContent.interaction;
    expect(read.ask.respondents).toHaveLength(5);
    expect(asks.reads).toBe(3);
  });

  it('releases no answer when one receipt does not verify', async () => {
    const asks = new FakeAsks();
    const failing = (async () => {
      throw new SessError('receipt_verification', 'bad', { code: 'SIGNATURE_INVALID' });
    }) as unknown as Verify;
    const { client } = await connect(asks, failing);
    const { handle } = (await call(client, 'sess_ask', { ...QUESTION, respondents: { max: 3 } }))
      .structuredContent.interaction;
    asks.answer(asks.start(), { understood: 'Yes' });
    const read = await call(client, 'sess_response', { handle, revision: 1 });
    expect(read.isError).toBe(true);
    expect(errorOf(read).code).toBe('VERIFICATION_FAILED');
    expect(read.content[0]!.text).not.toContain('understood');
  });

  it('refuses sess_publish and sess_complete for an Ask, and a revision other than 1', async () => {
    const asks = new FakeAsks();
    const { client } = await connect(asks, verifierFor(asks));
    const { handle } = (await call(client, 'sess_ask', { ...QUESTION, respondents: { max: 3 } }))
      .structuredContent.interaction;
    const event = 'evt_00000000000000000000000001';
    for (const [name, extra] of [
      ['sess_complete', {}],
      ['sess_publish', { interaction: ROUND_1 }],
    ] as const) {
      const result = await call(client, name, {
        handle,
        expected_revision: 1,
        response_event_id: event,
        ...extra,
      });
      expect(result.isError, name).toBe(true);
      expect(errorOf(result)).toMatchObject({ code: 'INVALID_STATE' });
      expect(errorOf(result).message).toContain('This handle is an Ask');
    }
    expect(errorOf(await call(client, 'sess_response', { handle, revision: 2 })).code).toBeDefined();
  });

  it('a refused create keeps nothing; an uncertain one keeps nothing and says the same call may be made again', async () => {
    const asks = new FakeAsks();
    const { client } = await connect(asks, verifierFor(asks));
    asks.createFailure = new SessError('api', 'x', {
      code: 'INVALID_SCHEMA',
      status: 400,
      outcome: 'rejected',
    });
    const rejected = await call(client, 'sess_ask', { ...QUESTION, respondents: { max: 30 } });
    expect(errorOf(rejected)).toMatchObject({ code: 'CREATE_REJECTED' });
    expect(errorOf(rejected).message).toBe('Sess did not create the Ask (INVALID_SCHEMA).');
    asks.createFailure = new SessError('unknown_outcome', 'x', { outcome: 'unknown' });
    const unknown = await call(client, 'sess_ask', { ...QUESTION, respondents: { max: 3 } });
    expect(errorOf(unknown)).toMatchObject({ code: 'CREATE_OUTCOME_UNKNOWN', retryable: true });
    expect(readdirSync(join(dir.path, 'profiles', 'default', 'handles'))).toEqual([]);
  });

  it('with an SDK that has no Ask (the pinned SDK before 0.2.0), refuses respondents before anything is sent', async () => {
    const sess = new Sess({
      apiKey: API_KEY,
      baseUrl: ORIGIN,
      fetch: (() => {
        throw new Error('no network');
      }) as unknown as typeof fetch,
    });
    const client = sdkClient(sess);
    if ('asks' in sess) {
      // An SDK with the Ask: the operations are wired from it.
      expect(client.respondents).toBeDefined();
      return;
    }
    expect(client.respondents).toBeUndefined();
    const { client: mcp, fake } = await connect(undefined);
    const result = await call(mcp, 'sess_ask', { ...QUESTION, respondents: { max: 3 } });
    expect(errorOf(result)).toMatchObject({ code: 'NOT_CONFIGURED' });
    expect(errorOf(result).message).toContain('Nothing was created');
    expect(fake.calls).toEqual([]);
    // Without respondents, sess_ask is as before.
    const one = await call(mcp, 'sess_ask', QUESTION);
    expect(one.structuredContent.interaction).toMatchObject({ state: 'waiting', revision: 1 });
    expect(one.structuredContent.interaction.ask).toBeUndefined();
    expect(one.content[0]!.text.startsWith('Show the person this link now: ')).toBe(true);
  });
});
