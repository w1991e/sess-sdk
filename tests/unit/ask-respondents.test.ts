import { describe, expect, expectTypeOf, it } from 'vitest';
import { readFile } from 'node:fs/promises';
import { inspect } from 'node:util';
import * as ts from 'typescript';
import { Sess as PackageSess } from '@sess.si/sdk';
import { Sess, SessError, type AskRead, type AskRespondentsHandle } from '../../src/index.js';
import { compileAsk } from '../../src/ask.js';
// Test-only parity oracle: the MCP adapter's sess_ask expansion and its `respondents`.
import { parseAskArgs } from '../../adapters/mcp/src/validate.js';
import {
  createFakeRuntime,
  FAKE_ASK_ID,
  FAKE_ASK_LINK,
  FAKE_LINK,
  type FakeRuntime,
} from '../fixtures/fake-runtime.mjs';
import { API_KEY } from '../fixtures/api.js';

/** Sess P2-24(d), Decision 0011: `respondents` in sess.ask creates one Ask (POST /v1/asks). */
const classroom = {
  question: 'End of class check',
  fields: [
    { name: 'understood', label: 'Did it make sense?', type: 'choice', options: ['Yes', 'Mostly', 'No'] },
    { name: 'note', label: 'Anything unclear?', type: 'text', required: false },
  ],
} as const;

function client(runtime: FakeRuntime) {
  return new Sess({ apiKey: API_KEY, fetch: runtime.fetch, maxRetries: 0 });
}
const paths = (runtime: FakeRuntime) => runtime.requests.map((r) => `${r.method} ${r.path}`);
function refusal(input: unknown): SessError {
  try {
    compileAsk(input);
  } catch (error) {
    if (error instanceof SessError) return error;
    throw error;
  }
  throw new Error('compiled');
}

describe('sess.ask with respondents: the create', () => {
  it('creates one Ask with round one and only the respondents given; Sess applies the defaults', async () => {
    const runtime = createFakeRuntime();
    const handle = await client(runtime).ask({ ...classroom, respondents: { max: 20 } });
    expect(paths(runtime)).toEqual(['POST /v1/asks']);
    const { body } = runtime.ask()!;
    expect(body).toEqual({ interaction: compileAsk(classroom).interaction, respondents: { max: 20 } });
    expect(handle.askId).toBe(FAKE_ASK_ID);
    expect(handle.link).toBe(FAKE_ASK_LINK);
    expect(handle.max).toBe(20);
    expect(handle.expiresAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    // The link is never serialized or inspected.
    expect(JSON.stringify(handle)).not.toContain(FAKE_ASK_LINK);
    expect(inspect(handle)).not.toContain(FAKE_ASK_LINK);
    expect(JSON.parse(JSON.stringify(handle))).toEqual({
      askId: FAKE_ASK_ID,
      max: 20,
      expiresAt: handle.expiresAt,
    });
    expect(Object.isFrozen(handle)).toBe(true);
  });

  it('sends every Advanced member exactly as given', async () => {
    const runtime = createFakeRuntime();
    await client(runtime).ask({
      ...classroom,
      respondents: { max: 3, name: true, expires_in: 3600, respondent_expires_in: 600, auto_complete: false },
    });
    expect(runtime.ask()!.body).toEqual({
      interaction: compileAsk(classroom).interaction,
      respondents: { max: 3, name: true },
      expires_in: 3600,
      respondent_expires_in: 600,
      auto_complete: false,
    });
  });

  it('refuses before any request what Sess would refuse, naming the path', async () => {
    const one = (respondents: unknown, extra: Record<string, unknown> = {}) =>
      refusal({ ...classroom, ...extra, respondents });
    for (const max of [1, 0, 2.5, '20', null])
      expect(one({ max }).message, String(max)).toBe(
        'Invalid question: respondents.max must be a whole number, at least 2.',
      );
    expect(one({}).message).toBe('Invalid question: respondents needs "max".');
    expect(one({ max: 3, quorum: 2 }).message).toBe(
      'Invalid question: respondents has an unsupported property "quorum".',
    );
    expect(one({ max: 3 }, { expires_in: 600 }).message).toBe(
      'Invalid question: expires_in is for one person’s link; with respondents, use respondents.expires_in.',
    );
    for (const key of ['expires_in', 'respondent_expires_in'])
      for (const value of [29, 30.5, '600'])
        expect(one({ max: 3, [key]: value }).message).toBe(
          `Invalid question: respondents.${key} must be a whole number of seconds, at least 30.`,
        );
    for (const key of ['name', 'auto_complete'])
      expect(one({ max: 3, [key]: 'yes' }).message).toBe(
        `Invalid question: respondents.${key} must be a boolean.`,
      );
    expect(
      refusal({
        question: 'Q',
        fields: [{ name: 'name', label: 'Name', type: 'text' }],
        respondents: { max: 3, name: true },
      }).message,
    ).toBe('Invalid question: respondents.name adds a field named "name"; rename the field that has it.');
    expect(one('20').message).toBe('Invalid question: respondents must be an object.');
    expect(one(JSON.parse('{"max":3,"__proto__":{}}')).message).toBe(
      'Invalid question: respondents has a reserved key.',
    );
    const runtime = createFakeRuntime();
    await expect(client(runtime).ask({ ...classroom, respondents: { max: 1 } })).rejects.toMatchObject({
      kind: 'configuration',
      code: 'INVALID_QUESTION',
      outcome: 'not_sent',
    });
    expect(runtime.requests).toEqual([]);
  });

  it('reports an uncertain create once, never retried, and says an unused Ask reserves nothing', async () => {
    const runtime = createFakeRuntime();
    runtime.setHook(({ method }) => {
      if (method === 'POST') throw new TypeError('synthetic network failure');
      return undefined;
    });
    const sess = new Sess({ apiKey: API_KEY, fetch: runtime.fetch, maxRetries: 3 });
    const error = await sess.ask({ ...classroom, respondents: { max: 3 } }).catch((e: unknown) => e);
    expect(error).toMatchObject({ kind: 'unknown_outcome', outcome: 'unknown', operation: 'asks.create' });
    expect((error as SessError).message).toBe(
      'Ask creation may have succeeded. It was not retried automatically; an unused Ask reserves nothing, so you may create it again.',
    );
    expect(paths(runtime)).toEqual(['POST /v1/asks']);
  });

  it('a definite refusal by Sess is rejected (nothing created)', async () => {
    const runtime = createFakeRuntime();
    const error = await client(runtime)
      .ask({ ...classroom, respondents: { max: 26 } })
      .catch((e: unknown) => e);
    expect(error).toMatchObject({ kind: 'api', code: 'INVALID_SCHEMA', status: 400, outcome: 'rejected' });
  });

  it('is the same create body, and the same round-one binding, as the MCP sess_ask tool with respondents', () => {
    for (const respondents of [
      { max: 20 },
      { max: 3, name: true, expires_in: 3600, respondent_expires_in: 600 },
      { max: 2, name: false },
    ]) {
      const compiled = compileAsk({ ...classroom, respondents });
      const mcp = parseAskArgs({ ...classroom, respondents });
      expect(mcp.interaction).toEqual(compiled.interaction);
      expect(mcp.ask!.body).toEqual(compiled.respondents!.body);
      // Both release an answer only from a Session whose surface is exactly this round one.
      expect(mcp.ask!.surface).toEqual({ ...compiled.respondents!.surface, response_policy: 'first' });
    }
  });
});

describe('without respondents nothing changes', () => {
  it('compiles exactly as before: no respondents member, the same interaction and fields', () => {
    const plain = compileAsk(classroom);
    expect(Object.keys(plain)).toEqual(['interaction', 'fields']);
    expect(Object.keys(compileAsk({ ...classroom, expires_in: 600 }))).toEqual([
      'interaction',
      'fields',
      'expiresIn',
    ]);
    expect(compileAsk({ ...classroom, respondents: { max: 2 } }).interaction).toEqual(plain.interaction);
  });

  it('sends the same bytes to POST /v1/sessions, byte for byte', async () => {
    const runtime = createFakeRuntime();
    const bodies: string[] = [];
    runtime.setHook(({ method, init }) => {
      if (method === 'POST') bodies.push(String(init.body));
      return undefined;
    });
    const handle = await client(runtime).ask({ ...classroom, expires_in: 600 });
    expect(paths(runtime)).toEqual(['POST /v1/sessions']);
    expect(bodies).toEqual([
      '{"interaction":{"mode":"interactive","title":"End of class check","source":{"kind":"sess_surface",' +
        '"components":[{"type":"field","name":"understood","label":"Did it make sense?","required":true,' +
        '"schema":{"type":"string","enum":["Yes","Mostly","No"]}},{"type":"field","name":"note",' +
        '"label":"Anything unclear?","required":false,"schema":{"type":"string"}}]},' +
        '"actions":[{"id":"submit","label":"Send","intent":"submit"}]},"expires_in":600}',
    ]);
    expect(handle.link).toBe(FAKE_LINK);
    // The one-person handle, exactly as before (`answer` is bound in its constructor).
    expect(Object.keys(handle).sort()).toEqual(['answer', 'expiresAt', 'revision', 'sessionId']);
    expect(typeof handle.answer).toBe('function');
    expect('read' in handle).toBe(false);
  });
});

describe('the Ask handle: read and close', () => {
  it('reads counts and each respondent in Start order, each answer verified and typed; unanswered is null', async () => {
    const runtime = createFakeRuntime();
    const handle = await client(runtime).ask({ ...classroom, respondents: { max: 20 } });
    const first = runtime.start()!;
    runtime.answerRespondent(first, { understood: 'Yes', note: 'Slide 4' });
    const second = runtime.start()!;
    const third = runtime.start()!;
    runtime.answerRespondent(third, { understood: 'No' });
    const read = await handle.read();
    expect(read).toMatchObject({
      status: 'open',
      closedBy: null,
      closedAt: null,
      counts: { started: 3, answered: 2, completed: 2 },
      nextCursor: null,
    });
    expect(read.respondents.map((r) => [r.sessionId, r.status, r.answer])).toEqual([
      [first, 'completed', { understood: 'Yes', note: 'Slide 4' }],
      [second, 'active', null],
      [third, 'completed', { understood: 'No' }],
    ]);
    expect(read.respondents[0]).toMatchObject({ revision: 1, completedAt: expect.any(String) });
    expect(
      Object.isFrozen(read) && Object.isFrozen(read.respondents[0]) && Object.isFrozen(read.counts),
    ).toBe(true);
    // Each answer was verified against its own Session and round one.
    expect(runtime.counts.respondentRetrieve).toBe(2);
    // A later read verifies only what is new.
    runtime.answerRespondent(second, { understood: 'Mostly' });
    const again = await handle.read();
    expect(again.respondents[1]!.answer).toEqual({ understood: 'Mostly' });
    expect(runtime.counts.respondentRetrieve).toBe(3);
  });

  it('with name: each answer has the name first, and the stored round one has Sess’s name field', async () => {
    const runtime = createFakeRuntime();
    const handle = await client(runtime).ask({ ...classroom, respondents: { max: 5, name: true } });
    runtime.answerRespondent(runtime.start()!, { name: 'Ada', understood: 'Yes' });
    const read = await handle.read();
    expect(read.respondents[0]!.answer).toEqual({ name: 'Ada', understood: 'Yes' });
    expect(Object.keys(read.respondents[0]!.answer!)).toEqual(['name', 'understood']);
    const fields = runtime.ask()!.interaction.source.components.map((c: { name: string }) => c.name);
    expect(fields).toEqual(['name', 'understood', 'note']);
  });

  it('pages with limit and cursor', async () => {
    const runtime = createFakeRuntime();
    const handle = await client(runtime).ask({ ...classroom, respondents: { max: 5 } });
    for (const understood of ['Yes', 'No', 'Mostly'])
      runtime.answerRespondent(runtime.start()!, { understood });
    const first = await handle.read({ limit: 2 });
    expect(first.respondents.map((r) => r.answer?.understood)).toEqual(['Yes', 'No']);
    expect(first.nextCursor).toBe('c2');
    const next = await handle.read({ cursor: first.nextCursor!, limit: 2 });
    expect(next.respondents.map((r) => r.answer?.understood)).toEqual(['Mostly']);
    expect(next.nextCursor).toBeNull();
    expect(runtime.requests.filter((r) => r.method === 'GET' && r.path.startsWith('/v1/asks/')).length).toBe(
      2,
    );
    for (const bad of [{ limit: 0 }, { limit: 101 }, { limit: 1.5 }, { cursor: '' }, { cursor: 'a b' }])
      await expect(handle.read(bad as never), JSON.stringify(bad)).rejects.toMatchObject({
        kind: 'configuration',
        outcome: 'not_sent',
      });
  });

  it('a purged respondent is a tombstone without an answer', async () => {
    const runtime = createFakeRuntime();
    const handle = await client(runtime).ask({ ...classroom, respondents: { max: 5 } });
    const id = runtime.start()!;
    runtime.answerRespondent(id, { understood: 'Yes' });
    runtime.purge(id);
    const read = await handle.read();
    expect(read.respondents.map((r) => [r.status, r.answer])).toEqual([['purged', null]]);
  });

  it('closes at the last place; the deadline reads as closed; close() is the owner’s and safe to repeat', async () => {
    const runtime = createFakeRuntime();
    const handle = await client(runtime).ask({ ...classroom, respondents: { max: 2 } });
    runtime.start();
    runtime.start();
    expect(runtime.start()).toBeUndefined();
    expect(await handle.read()).toMatchObject({
      status: 'closed',
      closedBy: 'max',
      counts: { refused: { full: 1 } },
    });

    const other = createFakeRuntime();
    const open = await client(other).ask({ ...classroom, respondents: { max: 5 } });
    other.start();
    const closed = await open.close();
    expect(closed).toMatchObject({ status: 'closed', closedBy: 'owner', counts: { started: 1 } });
    expect(Object.keys(closed)).toEqual(['status', 'closedBy', 'closedAt', 'counts']);
    expect(await open.close()).toEqual(closed);
    expect(other.start()).toBeUndefined();

    const late = createFakeRuntime();
    const expiring = await client(late).ask({ ...classroom, respondents: { max: 5 } });
    late.expireAsk();
    expect(await expiring.read()).toMatchObject({ status: 'closed', closedBy: 'deadline' });
  });

  it('refuses an answer whose Session does not hold this question, or that changed after verification', async () => {
    const runtime = createFakeRuntime();
    const handle = await client(runtime).ask({ ...classroom, respondents: { max: 5 } });
    const id = runtime.start()!;
    runtime.tamper(id, (r) => {
      r.interaction = { ...r.interaction, title: 'Something else' };
    });
    runtime.answerRespondent(id, { understood: 'Yes' });
    await expect(handle.read()).rejects.toMatchObject({
      kind: 'receipt_verification',
      code: 'RECORD_BINDING_MISMATCH',
    });

    const other = createFakeRuntime();
    const ask = await client(other).ask({ ...classroom, respondents: { max: 5 } });
    const respondent = other.start()!;
    other.answerRespondent(respondent, { understood: 'Yes' });
    await ask.read();
    other.tamper(respondent, (r) => {
      r.responses[0].data = { understood: 'No' };
    });
    await expect(ask.read()).rejects.toMatchObject({ code: 'RECORD_BINDING_MISMATCH' });
  });

  it('types each answer by the fields, with name only when asked for', () => {
    type Classroom = { readonly understood: 'Yes' | 'Mostly' | 'No'; readonly note?: string };
    expectTypeOf<ReturnType<typeof answerOf<false>>>().toEqualTypeOf<Promise<Classroom | null>>();
    expectTypeOf<ReturnType<typeof answerOf<true>>>().toEqualTypeOf<
      Promise<
        ({ readonly name: string } & Classroom extends infer T ? { [K in keyof T]: T[K] } : never) | null
      >
    >();
    expectTypeOf<AskRespondentsHandle<Classroom>['read']>().returns.resolves.toEqualTypeOf<
      AskRead<Classroom>
    >();
  });
});

/** Type-level helper only: the answer type sess.ask infers for the classroom question. */
async function answerOf<N extends boolean>(sess: Sess, name: N) {
  const handle = await sess.ask({ ...classroom, respondents: { max: 3, name } as { max: 3; name: N } });
  return (await handle.read()).respondents[0]?.answer ?? null;
}

describe('the Ask examples in docs/api.md', () => {
  async function example(name: string): Promise<string> {
    const docs = (await readFile(new URL('../../docs/api.md', import.meta.url), 'utf8')).replace(
      /\r\n/g,
      '\n',
    );
    const block = new RegExp(
      `<!-- example:${name} -->\\s*\`\`\`ts\\n([\\s\\S]*?)\\n\`\`\`\\s*<!-- /example:${name} -->`,
    ).exec(docs)?.[1];
    if (!block) throw new Error(`no ${name} example in docs/api.md`);
    return block;
  }
  async function run(source: string, runtime: FakeRuntime): Promise<string[]> {
    const compiled = ts.transpileModule(
      source.replace(/^import \{ Sess \} from .@sess\.si\/sdk.;\r?\n/m, ''),
      {
        compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
      },
    ).outputText;
    class ExampleSess extends PackageSess {
      constructor(options: ConstructorParameters<typeof PackageSess>[0]) {
        super({ ...options, fetch: runtime.fetch });
      }
    }
    const lines: string[] = [];
    const execute = new Function('Sess', 'process', 'console', `return (async () => { ${compiled}\n})()`) as (
      SDK: typeof PackageSess,
      context: { env: Record<string, string> },
      out: { log(text: string): void },
    ) => Promise<void>;
    await execute(ExampleSess, { env: { SESS_API_KEY: API_KEY } }, { log: (text) => lines.push(text) });
    return lines;
  }

  for (const [name, fixture] of [
    ['classroom', 'classroom-example.ts'],
    ['feedback-respondents', 'feedback-respondents-example.ts'],
  ] as const)
    it(`${name} is tests/fixtures/${fixture} (typechecked SDK code), line for line`, async () => {
      const source = await readFile(new URL(`../fixtures/${fixture}`, import.meta.url), 'utf8');
      expect(await example(name)).toBe(source.replace(/\r\n/g, '\n').trimEnd());
    });

  it('classroom runs: one Ask of 20, the link to share, then the verified answers counted', async () => {
    const runtime = createFakeRuntime({
      autoRespondents: [{ understood: 'Yes' }, { understood: 'No' }, null, { understood: 'Mostly' }],
    });
    const lines = await run(await example('classroom'), runtime);
    expect(lines).toEqual([
      `Share this link with the class: ${FAKE_ASK_LINK}`,
      '3 of 20 answered. 1 said no.',
    ]);
    expect(runtime.ask()!.body.respondents).toEqual({ max: 20 });
    expect(runtime.counts).toMatchObject({ askCreate: 1, askRead: 1, respondentRetrieve: 3, create: 0 });
  });

  it('feedback with respondents runs: the rating from #45 for every guest, averaged', async () => {
    const runtime = createFakeRuntime({
      autoRespondents: [{ satisfaction: 5, comment: 'Lovely' }, { satisfaction: 4 }, null],
    });
    const lines = await run(await example('feedback-respondents'), runtime);
    expect(lines).toEqual([`Share this link with today’s guests: ${FAKE_ASK_LINK}`, '2 rated us 4.5 of 5.']);
    expect(runtime.ask()!.interaction.source.components[0]).toMatchObject({
      type: 'field',
      name: 'satisfaction',
      rating: {},
      schema: { type: 'integer', minimum: 1, maximum: 5 },
    });
    const empty = createFakeRuntime({ autoRespondents: [] });
    expect((await run(await example('feedback-respondents'), empty))[1]).toBe('No ratings yet.');
  });
});
