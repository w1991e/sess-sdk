// The served skill (Sess ledger L-351) and no elicitation (L-353). Acceptance from the approved note
// "Skills, Tasks and Elicitation over MCP" (Sess DOCS/research/2026-11-26/, section 4.4): two
// negotiation paths, each tested at its exact wire result; one skill entry whose digest and size
// equal the bytes resources/read returns; skills/get for that address and -32602 for any other;
// the plugin's SKILL.md and the served one identical bytes; the text hash-locked.
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { ElicitRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { INSTRUCTIONS, WHEN_TO_USE_SESS, createSessMcpServer } from '../src/server.js';
import { SKILLS, SKILL_DESCRIPTION, SKILL_MD, SKILL_NAME, SKILL_URI } from '../src/skill.js';
import { TOOLS } from '../src/tools.js';
import { ANSWER_1, FakeSess, ROUND_1, acceptingVerifier, clientFor, env, tempDir } from './helpers.js';
import { MODERN_META, modernHeaders, rawPost, rpcBody, startHttp, type Harness } from './http-helpers.js';

const root = join(import.meta.dirname, '..');

/**
 * THE HASH LOCK. The SHA-256 of the one served SKILL.md (src/skill-text.ts). A host ties its user's
 * approval to this digest, so a changed byte asks every user again: change the text only with a
 * package release, from lines signed in Sess (DOCS/product/copy.md), and update this pin in the
 * same reviewed change.
 */
const SKILL_SHA256 = '90f47dbb0b6a3675705669375ba8dd76f824bc897a09e1b3776a98b5e3ba3489';
const SKILL_BYTES = 2029;

const sha256 = (text: string) => createHash('sha256').update(text, 'utf8').digest('hex');

/** The entry skills/list and skills/get must carry, computed here from the bytes, not the library. */
const ENTRY = {
  uri: SKILL_URI,
  frontmatter: { name: SKILL_NAME, description: SKILL_DESCRIPTION },
  resources: [{ uri: SKILL_URI, digest: `sha256:${SKILL_SHA256}`, size: SKILL_BYTES }],
};

/** The declared capabilities, the same on both paths: tools as before, resources and the extension. */
const CAPABILITIES = {
  tools: { listChanged: false },
  resources: { listChanged: true },
  extensions: { 'io.modelcontextprotocol/skills': { directoryRead: true } },
};

describe('the skill text, hash-locked', () => {
  it('is exactly the pinned bytes (sha256 and size)', () => {
    expect(sha256(SKILL_MD)).toBe(SKILL_SHA256);
    expect(Buffer.byteLength(SKILL_MD, 'utf8')).toBe(SKILL_BYTES);
  });

  it('is one SKILL.md: front matter of name and description only, the folder name, LF line ends', () => {
    expect(SKILL_MD).toMatch(/^---\nname: ask-a-person\ndescription: [^\n]+\n---\n\n# Ask a person\n/);
    expect(SKILL_MD.split('\n---\n')[0]!.split('\n').slice(1)).toEqual([
      `name: ${SKILL_NAME}`,
      `description: ${SKILL_DESCRIPTION}`,
    ]);
    expect(SKILL_MD).not.toContain('\r');
    expect(SKILL_MD.endsWith('.\n')).toBe(true);
    expect(SKILL_DESCRIPTION.length).toBeLessThanOrEqual(1024);
    // No supporting files, scripts or allowed-tools (note 4.2): the catalog serves one file.
    expect(SKILLS.entries).toHaveLength(1);
    expect(SKILLS.entries[0]!.resources).toHaveLength(1);
    expect(SKILL_MD).not.toMatch(/allowed-tools|```/);
  });

  it('carries the signed Sess lines verbatim (copy.md SK-02 first two sentences, SK-11 to SK-14)', () => {
    const SK_02_FIRST_TWO =
      "Asks a person outside the conversation for an approval, sign-off, decision or structured answer through a private link they open on any device, and returns a typed answer with a receipt signed by Sess, an independent third party. Use when the user needs someone else's go-ahead, confirmation, choice or details before work continues, especially when that person has no account or is outside the organization, when the answer needs more than yes or no, or when proof of the answer must be signed by someone other than the agent.";
    expect(SKILL_DESCRIPTION).toBe(SK_02_FIRST_TWO);
    // SK-02's third sentence is for an agent with no tools; the served skill leaves it out (note 4.3).
    expect(SKILL_MD).not.toContain('Needs no signup or API key');
    for (const signed of [
      '## What the receipt shows and does not show',
      "The receipt records what Sess accepted: the Session, Event, revision and its hash, the action, a hash of the input, the responder's assurance (`link_holder`) and the time. It does not prove that the person understood the page or that anything happened afterwards.",
      'Who answered: someone with the link, not a verified identity.',
      'A Sess receipt is not a legal e-signature.',
    ])
      expect(SKILL_MD.split(signed)).toHaveLength(2);
    // The link rule (step 2) and the five tools, each named.
    expect(SKILL_MD).toContain(
      '2. Give the link only to the person you mean, in this private conversation. Anyone who has it can answer.',
    );
    for (const tool of TOOLS) expect(SKILL_MD).toContain(`\`${tool.name}\``);
  });

  it('is the plugin listing skill, byte for byte (note 4.4 item 5)', () => {
    const plugin = readFileSync(join(root, 'listings/plugin/skills', SKILL_NAME, 'SKILL.md'), 'utf8');
    expect(plugin).toBe(SKILL_MD);
    expect(readdirSync(join(root, 'listings/plugin/skills'))).toEqual([SKILL_NAME]);
    expect(readdirSync(join(root, 'listings/plugin/skills', SKILL_NAME))).toEqual(['SKILL.md']);
  });
});

let dir: ReturnType<typeof tempDir>;
beforeEach(() => {
  dir = tempDir();
});
afterEach(() => dir.cleanup());

/** A raw 2025-era connection (the stdio composition) after initialize. */
async function rawLegacy() {
  const fake = new FakeSess();
  const created = createSessMcpServer({
    env: env(dir.path),
    createClient: clientFor(fake),
    diagnostics: () => {},
  });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await created.connect(serverTransport);
  const answers = new Map<number, any>();
  const others: any[] = [];
  clientTransport.onmessage = (message: any) => {
    if (typeof message.id === 'number' && !('method' in message)) answers.set(message.id, message);
    else others.push(message);
  };
  await clientTransport.start();
  let next = 1;
  const request = async (method: string, params: object = {}) => {
    const id = next++;
    await clientTransport.send({ jsonrpc: '2.0', id, method, params } as never);
    for (let i = 0; i < 200 && !answers.has(id); i++) await new Promise((r) => setTimeout(r, 5));
    return answers.get(id);
  };
  const init = await request('initialize', {
    protocolVersion: '2025-11-25',
    capabilities: {},
    clientInfo: { name: 'raw', version: '0' },
  });
  await clientTransport.send({ jsonrpc: '2.0', method: 'notifications/initialized' } as never);
  return { init, request, others, close: () => clientTransport.close() };
}

describe('2025-era path: the initialize result (stdio and the legacy HTTP fallback)', () => {
  it('declares tools as before, resources and the Skills extension, and the instructions, exactly', async () => {
    const { init, close } = await rawLegacy();
    expect(init.result).toEqual({
      protocolVersion: '2025-11-25',
      capabilities: CAPABILITIES,
      serverInfo: { name: 'sess-mcp', version: expect.any(String) },
      instructions: INSTRUCTIONS,
    });
    await close();
  });

  it('skills/list returns one entry whose digest and size are those of the bytes resources/read returns', async () => {
    const { request, close } = await rawLegacy();
    const list = await request('skills/list');
    expect(list.result).toEqual({ skills: [ENTRY] });
    const read = await request('resources/read', { uri: SKILL_URI });
    // As on the wire (the library keeps its cache hint on a symbol, which JSON never carries).
    expect(JSON.parse(JSON.stringify(read.result))).toEqual({
      contents: [{ uri: SKILL_URI, mimeType: 'text/markdown', text: SKILL_MD }],
    });
    const text: string = read.result.contents[0].text;
    expect(`sha256:${sha256(text)}`).toBe(list.result.skills[0].resources[0].digest);
    expect(Buffer.byteLength(text, 'utf8')).toBe(list.result.skills[0].resources[0].size);
    await close();
  });

  it('skills/get answers the skill address with the same entry, and any other address with -32602', async () => {
    const { request, close } = await rawLegacy();
    expect((await request('skills/get', { uri: SKILL_URI })).result).toEqual({ skill: ENTRY });
    for (const uri of [
      'skill://ask-a-person-with-sess/SKILL.md',
      'skill://ask-a-person/README.md',
      'https://sess.si/',
    ])
      expect((await request('skills/get', { uri })).error.code).toBe(-32602);
    await close();
  });

  it('lists the one file in resources/list, as the library does, and tools/list is unchanged', async () => {
    const { request, close } = await rawLegacy();
    expect((await request('resources/list')).result).toEqual({
      resources: [
        {
          uri: SKILL_URI,
          name: SKILL_NAME,
          description: SKILL_DESCRIPTION,
          mimeType: 'text/markdown',
          size: SKILL_BYTES,
        },
      ],
    });
    expect(JSON.stringify((await request('tools/list')).result.tools)).toBe(JSON.stringify(TOOLS));
    await close();
  });
});

describe('2026-07-28 path over the stateless HTTP handler', () => {
  let harness: Harness | undefined;
  afterEach(async () => {
    await harness?.close();
    harness = undefined;
  });
  /** One modern request; `name` is the Mcp-Name header a resources/read must carry (its uri). */
  const modern = async (h: Harness, id: number, method: string, params: object = {}, name?: string) => {
    const response = await rawPost(
      h.url,
      JSON.stringify({ jsonrpc: '2.0', id, method, params: { ...params, _meta: MODERN_META } }),
      modernHeaders(method, name),
    );
    return { status: response.status, body: await rpcBody(response) };
  };

  it('server/discover declares resources and io.modelcontextprotocol/skills beside the tools, with the instructions', async () => {
    harness = await startHttp();
    const { status, body } = await modern(harness, 1, 'server/discover');
    expect(status).toBe(200);
    expect(body.result.capabilities).toEqual(CAPABILITIES);
    expect(body.result.instructions).toBe(INSTRUCTIONS);
    expect(body.result.supportedVersions).toEqual(['2026-07-28']);
  });

  it('skills/list, skills/get and resources/read serve the same bytes, publicly cacheable', async () => {
    harness = await startHttp();
    const list = await modern(harness, 1, 'skills/list');
    expect(list.body.result).toMatchObject({ skills: [ENTRY], cacheScope: 'public' });
    const get = await modern(harness, 2, 'skills/get', { uri: SKILL_URI });
    expect(get.body.result).toMatchObject({ skill: ENTRY });
    const unknown = await modern(harness, 3, 'skills/get', { uri: 'skill://other/SKILL.md' });
    expect(unknown.body.error.code).toBe(-32602);
    const read = await modern(harness, 4, 'resources/read', { uri: SKILL_URI }, SKILL_URI);
    expect(read.body.result.contents).toEqual([
      { uri: SKILL_URI, mimeType: 'text/markdown', text: SKILL_MD },
    ]);
  });

  it('the legacy fallback declares the same capabilities in its initialize result', async () => {
    harness = await startHttp();
    const response = await rawPost(
      harness.url,
      JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: {
          protocolVersion: '2025-11-25',
          capabilities: {},
          clientInfo: { name: 'raw', version: '0' },
        },
      }),
    );
    const body = await rpcBody(response);
    expect(body.result.capabilities).toEqual(CAPABILITIES);
    expect(body.result.instructions).toBe(INSTRUCTIONS);
  });

  it('stays behind sign-in: skills/list with no token is a 401 and serves nothing', async () => {
    harness = await startHttp();
    const response = await rawPost(
      harness.url,
      JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'skills/list', params: { _meta: MODERN_META } }),
      modernHeaders('skills/list'),
      null,
    );
    expect(response.status).toBe(401);
    expect(await response.text()).not.toContain('ask-a-person');
  });
});

describe('the server instructions', () => {
  it('open with when to use Sess, in one sentence, within the first 512 characters', () => {
    expect(INSTRUCTIONS.startsWith(`${WHEN_TO_USE_SESS} Sess lets a person answer a structured form`)).toBe(
      true,
    );
    expect(WHEN_TO_USE_SESS.split('. ')).toHaveLength(1);
    expect(WHEN_TO_USE_SESS.endsWith('.')).toBe(true);
    expect(INSTRUCTIONS.indexOf(WHEN_TO_USE_SESS) + WHEN_TO_USE_SESS.length).toBeLessThan(512);
    // It makes no claim about identity or authorization (ASTRA, note section 9 item 6).
    expect(WHEN_TO_USE_SESS).toContain('records what was shown and chosen, not who answered');
    expect(WHEN_TO_USE_SESS).not.toMatch(/verif|identit|authori[sz]/i);
    expect(INSTRUCTIONS.length).toBeLessThanOrEqual(4096);
  });
});

// L-353: Sess sends no elicitation requests, and a Sess link never travels in one.
describe('no elicitation (L-353)', () => {
  it('declares no elicitation anywhere in either path, and the built server never asks for one', async () => {
    const { init, close } = await rawLegacy();
    expect(JSON.stringify(init.result.capabilities)).not.toMatch(/elicit/i);
    await close();
    const h = await startHttp();
    try {
      const response = await rawPost(
        h.url,
        JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'server/discover', params: { _meta: MODERN_META } }),
        modernHeaders('server/discover'),
      );
      expect(JSON.stringify((await rpcBody(response)).result.capabilities)).not.toMatch(/elicit/i);
    } finally {
      await h.close();
    }
    // No source or shipped module calls the library's elicitation API or sends its method.
    const ELICIT_USE =
      /elicitInput|elicitation\/create|ElicitRequest|createElicitationCompletionNotifier|inputRequired\(/;
    for (const folder of ['src', 'dist']) {
      const files = readdirSync(join(root, folder), { recursive: true, encoding: 'utf8' }).filter((f) =>
        /\.(?:ts|js)$/.test(f),
      );
      expect(files.length).toBeGreaterThan(0);
      for (const file of files)
        expect(readFileSync(join(root, folder, file), 'utf8')).not.toMatch(ELICIT_USE);
    }
  });

  it('a client that offers form and URL elicitation gets no elicitation request through a whole round', async () => {
    const fake = new FakeSess();
    const created = createSessMcpServer({
      env: env(dir.path),
      createClient: clientFor(fake, acceptingVerifier(fake)),
      diagnostics: () => {},
    });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const sent: any[] = [];
    const send = serverTransport.send.bind(serverTransport);
    serverTransport.send = (message, options) => {
      sent.push(message);
      return send(message, options);
    };
    await created.connect(serverTransport);
    const client = new Client(
      { name: 'eliciting-host', version: '0.0.0' },
      { capabilities: { elicitation: { form: {}, url: {} } } },
    );
    const elicited: unknown[] = [];
    client.setRequestHandler(ElicitRequestSchema, async (request) => {
      elicited.push(request);
      return { action: 'decline' };
    });
    await client.connect(clientTransport);

    const made = await client.callTool({ name: 'sess_request', arguments: { interaction: ROUND_1 } });
    const { handle } = (made.structuredContent as any).interaction;
    await client.callTool({ name: 'sess_response', arguments: { handle, revision: 1, wait_ms: 0 } });
    const eventId = fake.answerSigned(ANSWER_1.data, ANSWER_1.action_id);
    const answered = await client.callTool({
      name: 'sess_response',
      arguments: { handle, revision: 1, wait_ms: 0 },
    });
    expect((answered.structuredContent as any).interaction.state).toBe('answered');
    const done = await client.callTool({
      name: 'sess_complete',
      arguments: { handle, expected_revision: 1, response_event_id: eventId },
    });
    expect((done.structuredContent as any).interaction.state).toBe('completed');

    expect(elicited).toEqual([]);
    // Every message the server sent is a response: no request (elicitation or other) went to the host,
    // so the Sess link travelled only in tool results.
    expect(sent.length).toBeGreaterThan(0);
    for (const message of sent) expect(message).not.toHaveProperty('method');
    expect(JSON.stringify(sent)).not.toMatch(/elicit/i);
    await client.close();
  });
});
