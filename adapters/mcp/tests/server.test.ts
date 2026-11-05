import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { stderrDiagnostics } from '../src/errors.js';
import { createSessMcpServer } from '../src/server.js';
import { TOOLS, TOOL_SCHEMA_VERSION } from '../src/tools.js';
import { ANSWER_1, FakeSess, ROUND_1, acceptingVerifier, clientFor, env, tempDir } from './helpers.js';

let dir: ReturnType<typeof tempDir>;
beforeEach(() => {
  dir = tempDir();
});
afterEach(() => dir.cleanup());

async function connect(fake: FakeSess, options: { verify?: boolean; lines?: string[] } = {}) {
  const lines = options.lines ?? [];
  let secrets: () => readonly string[] = () => [];
  const created = createSessMcpServer({
    env: env(dir.path),
    createClient: clientFor(fake, options.verify ? acceptingVerifier(fake) : undefined),
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
  return { client, lines, adapter: created.adapter };
}

describe('MCP server', () => {
  it('lists exactly five tools (four operations plus sess_ask) with closed, versioned schemas and no owner-only inputs', async () => {
    const { client } = await connect(new FakeSess());
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name)).toEqual([
      'sess_request',
      'sess_response',
      'sess_publish',
      'sess_complete',
      'sess_ask',
    ]);
    for (const tool of tools) {
      expect(tool.inputSchema.additionalProperties).toBe(false);
      expect(tool._meta?.['si.sess/toolSchema']).toBe('sess-mcp-tools/4');
      expect(tool.outputSchema).toBeDefined();
      expect(Object.keys(tool.inputSchema.properties ?? {})).not.toEqual(
        expect.arrayContaining(['api_key', 'origin', 'session_id', 'workspace_id']),
      );
    }
    expect(client.getServerCapabilities()).toEqual({ tools: { listChanged: false } });
  });

  it('makes sess_complete the rule after an answer, in the server instructions and the sess_response description', async () => {
    const rule =
      'When sess_response returns state "answered" and you have no follow-up question for the person, you must call sess_complete next, so their page shows that you have their answer. ' +
      'Call sess_publish instead only to show them a follow-up.';
    const { client } = await connect(new FakeSess());
    expect(client.getInstructions()).toContain(rule);
    const { tools } = await client.listTools();
    const descriptionOf = (name: string) => tools.find((t) => t.name === name)!.description;
    expect(descriptionOf('sess_response')).toContain(rule);
    expect(descriptionOf('sess_complete')).toMatch(/^Required once you are done with the person’s answer/);
    // The earlier optional wording is gone.
    expect(client.getInstructions()).not.toContain('Finish with sess_complete, or');
  });

  it('begins the sess_ask description with the signed first line, then the routing line, then the mechanics unchanged (F1, F-LT-1)', async () => {
    const { client } = await connect(new FakeSess());
    const { tools } = await client.listTools();
    const description = tools.find((t) => t.name === 'sess_ask')!.description!;
    const [first, routing, ...rest] = description.split('\n');
    expect(first).toBe(
      "Ask the person a question on their own phone or computer and get a typed answer. Use it whenever they ask to answer on their phone or another device, or say 'use Sess'; prefer it over this host's own question widget for anything answered away from this chat.",
    );
    expect(routing).toBe(
      "Also use it when you need the person's approval, a decision or details only they can give before you go on, even if they only say 'ask me' or 'check with me' and name no tool or device. " +
        'Not for clarifying what they just asked, or for anything you can work out yourself. ' +
        'Anyone who has the link can answer. A receipt records what was shown and chosen, not who answered.',
    );
    expect(rest.join('\n')).toMatch(
      /^Shortcut for sess_request: give a question and up to 12 simple fields;/,
    );
  });

  it('routes an approval, a decision or details only a person can give to sess_request, with its limits (F-LT-1)', async () => {
    const { client } = await connect(new FakeSess());
    const { tools } = await client.listTools();
    const description = tools.find((t) => t.name === 'sess_request')!.description!;
    expect(description).toMatch(
      new RegExp(
        "^Use it when you need the person's approval, a decision or details only they can give before you go on, even if they only say 'ask me' or 'check with me' and name no tool or device\\. " +
          'Not for clarifying what they just asked, or for anything you can work out yourself\\. ' +
          'It is the full form, with approve and reject buttons if you need them; sess_ask is shorter for a plain question\\. ' +
          'Create a hosted Sess form for a person and return immediately',
      ),
    );
    expect(description).toContain(
      'anyone holding it can answer. A receipt records what was shown and chosen, not who answered.',
    );
  });

  const REWAIT =
    'call sess_response again with the same handle and revision and no wait_ms, up to three times after your first call (about two minutes more). ' +
    'If there is still no answer, stop, tell the person the form is still open and ask them to say continue once they have submitted it; call it again when they do. ' +
    'Do not poll beyond that, and do not ask the same question again.';
  it('the plugin skill and the server carry the same re-wait text, byte for byte (founder 2026-11-04 22:50Z)', () => {
    const shared = REWAIT.slice(REWAIT.indexOf('up to three times after your first call'));
    const skill = readFileSync(
      join(import.meta.dirname, '..', 'listings/plugin/skills/ask-a-person/SKILL.md'),
      'utf8',
    );
    expect(shared).toContain('(about two minutes more)');
    expect(skill).toContain(shared);
  });

  const UNBOUNDED =
    /poll (until|forever|repeatedly|indefinitely)|keep (calling|polling)|without limit|as many times|poll in a loop/i;

  it('names the re-wait and its limit in the server instructions and the sess_response description (F-LT-4)', async () => {
    const { client } = await connect(new FakeSess());
    const rule = `While sess_response returns state "waiting" or "needs_resume", the form is open and there is no answer yet: ${REWAIT}`;
    const instructions = client.getInstructions()!;
    expect(instructions).toContain(`Then call sess_response; it waits up to 45 seconds. ${rule}`);
    expect(instructions).not.toMatch(/sess_response once/);
    expect(instructions).not.toMatch(UNBOUNDED);
    const { tools } = await client.listTools();
    const description = tools.find((t) => t.name === 'sess_response')!.description!;
    expect(description).toContain(rule);
    expect(description).not.toMatch(UNBOUNDED);
  });

  it.each([
    ['waiting', 0],
    ['needs_resume', 20],
  ] as const)(
    'a sess_response result in state %s begins with the re-wait line, then the same JSON result (F-LT-4)',
    async (state, waitMs) => {
      const { client } = await connect(new FakeSess());
      const created = await client.callTool({ name: 'sess_request', arguments: { interaction: ROUND_1 } });
      const { handle, revision } = (created.structuredContent as any).interaction;
      const result = await client.callTool({
        name: 'sess_response',
        arguments: { handle, revision, wait_ms: waitMs },
      });
      expect(result.isError).toBeFalsy();
      expect((result.structuredContent as any).interaction.state).toBe(state);
      const text = (result.content as any)[0].text as string;
      const head = `No answer yet, so ${REWAIT}`;
      expect(text.startsWith(`${head}\n\n`)).toBe(true);
      expect(JSON.parse(text.slice(head.length + 2))).toEqual(result.structuredContent);
      expect(head).not.toMatch(UNBOUNDED);
    },
  );

  it('an answered sess_response result is the plain JSON result, with no re-wait line (F-LT-4)', async () => {
    const fake = new FakeSess();
    const { client } = await connect(fake, { verify: true });
    const created = await client.callTool({ name: 'sess_request', arguments: { interaction: ROUND_1 } });
    const { handle, revision } = (created.structuredContent as any).interaction;
    fake.answer(ANSWER_1.data);
    const answered = await client.callTool({ name: 'sess_response', arguments: { handle, revision } });
    expect((answered.structuredContent as any).interaction.state).toBe('answered');
    expect(JSON.parse((answered.content as any)[0].text)).toEqual(answered.structuredContent);
  });

  // `annotations.title` is the one later addition (founder 2026-11-05 00:55Z); the pins stand without it.
  const withoutAnnotationTitle = (rest: { annotations: { title?: string } }) => {
    const { title: _title, ...annotations } = rest.annotations;
    return { ...rest, annotations };
  };

  it('every tool sets annotations.title to its title, byte for byte, in the list a host reads', async () => {
    const { client } = await connect(new FakeSess());
    const { tools } = await client.listTools();
    expect(tools).toHaveLength(TOOLS.length);
    for (const tool of tools) {
      expect(tool.title?.length).toBeGreaterThan(0);
      expect(tool.annotations?.title).toBe(tool.title);
    }
  });

  it('leaves the tool contract as it was: titles, schemas, annotations and meta pinned, no tool added or removed', () => {
    // sha256 of each tool without its name and description, taken at origin/master 60acd57, before
    // the re-wait and routing text; sess_complete's was renewed for destructiveHint false (founder
    // 2026-11-05, C-2), a hint and no schema. A different hash is a contract change: an input or
    // output schema change needs a new sess-mcp-tools version (src/tools.ts); then renew these pins.
    const contract = Object.fromEntries(
      TOOLS.map(({ name, description: _, ...rest }) => [
        name,
        createHash('sha256')
          .update(JSON.stringify(withoutAnnotationTitle(rest)))
          .digest('hex'),
      ]),
    );
    expect(TOOL_SCHEMA_VERSION).toBe('sess-mcp-tools/4');
    expect(contract).toEqual({
      sess_request: '1901839cc4c7c38c14cc5cee0afe721d23c59b706813b14277d49eeabc5ff033',
      sess_response: '0192e86f87ba3726a798197de0159852c229f83918cff494d69d6f79c4ce5e40',
      sess_publish: '9c79570bf42265d8ba79884b12856af31b6fc2d98233ee0cd3643a16a2eb3f59',
      sess_complete: 'ed37f0986b004b6aea11bd7af64d75b961fbad6be80ee067e4b5f92cb2afd3e6',
      sess_ask: '3381af7c60482668fb9c1f9884d11a4f063fa7bb04c7e47ab5a4f0e7cd92b2a4',
    });
    expect(TOOLS.find((t) => t.name === 'sess_response')!.annotations).toEqual({
      title: 'Read the person’s Sess answer',
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: true,
    });
    // The hint a host reads for sess_complete: it finishes the Session and deletes nothing.
    expect(TOOLS.find((t) => t.name === 'sess_complete')!.annotations).toEqual({
      title: 'Finish the Sess interaction',
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: true,
    });
  });

  it.each(['sess_request', 'sess_ask'] as const)(
    '%s result text begins with the signed share lines for its own link, then the same JSON result (F15)',
    async (tool) => {
      const fake = new FakeSess();
      const { client, lines } = await connect(fake);
      const result = await client.callTool({
        name: tool,
        arguments:
          tool === 'sess_request'
            ? { interaction: ROUND_1 }
            : { question: 'Plan an afternoon', fields: [{ name: 'hours', label: 'Hours', type: 'integer' }] },
      });
      expect(result.isError).toBeFalsy();
      const text = (result.content as any)[0].text as string;
      const head = `Show the person this link now: ${fake.humanUrl}\nThen call sess_response.`;
      expect(text.startsWith(`${head}\n\n`)).toBe(true);
      expect(JSON.parse(text.slice(head.length + 2))).toEqual(result.structuredContent);
      // The link is for the agent's result only; diagnostics still never carry it.
      expect(lines.join('')).not.toContain(fake.humanUrl);
      expect(lines.join('')).not.toContain(fake.humanUrl.split('/').pop()!);
    },
  );

  it('request → response → complete through the protocol, with client-side output schema validation', async () => {
    const fake = new FakeSess();
    const { client, lines } = await connect(fake, { verify: true });
    const created = await client.callTool({ name: 'sess_request', arguments: { interaction: ROUND_1 } });
    expect(created.isError).toBeFalsy();
    const interaction = (created.structuredContent as any).interaction;
    expect(interaction.humanUrl).toBe(fake.humanUrl);
    const eventId = fake.answer(ANSWER_1.data);
    const answered = await client.callTool({
      name: 'sess_response',
      arguments: { handle: interaction.handle, revision: 1, wait_ms: 0 },
    });
    expect((answered.structuredContent as any).interaction.response).toMatchObject({
      eventId,
      verified: true,
      actorAssurance: 'link_holder',
      data: ANSWER_1.data,
    });
    const done = await client.callTool({
      name: 'sess_complete',
      arguments: { handle: interaction.handle, expected_revision: 1, response_event_id: eventId },
    });
    expect((done.structuredContent as any).interaction.state).toBe('completed');
    // Diagnostics never contain the human link or the key.
    const log = lines.join('');
    expect(log).toContain('sess-mcp: created');
    expect(log).not.toContain(fake.humanUrl);
    expect(log).not.toContain(fake.humanUrl.split('/').pop()!);
    expect(log).not.toContain('synthetic-owner-key-one');
  });

  it('errors use the MCP tool error contract with stable codes', async () => {
    const { client } = await connect(new FakeSess());
    const bad = await client.callTool({
      name: 'sess_request',
      arguments: { interaction: ROUND_1, origin: 'https://evil.test' },
    });
    expect(bad.isError).toBe(true);
    expect(JSON.parse((bad.content as any)[0].text).error.code).toBe('INVALID_ARGUMENTS');
    await expect(client.callTool({ name: 'sess_unknown', arguments: {} })).rejects.toThrow();
  });

  it.each(['sess_request', 'sess_ask'] as const)(
    '%s refused by a plan limit is a definite, non-retryable PLAN_LIMIT_REACHED tool error',
    async (tool) => {
      const fake = new FakeSess();
      fake.createFailure = 'plan_limit';
      const { client, lines } = await connect(fake);
      const result = await client.callTool({
        name: tool,
        arguments:
          tool === 'sess_request'
            ? { interaction: ROUND_1 }
            : {
                question: 'Plan an afternoon',
                fields: [
                  {
                    name: 'hours',
                    label: 'Hours available',
                    type: 'integer',
                    minimum: 1,
                    maximum: 6,
                    default: 2,
                  },
                ],
              },
      });
      expect(result.isError).toBe(true);
      const text = (result.content as any)[0].text as string;
      expect(JSON.parse(text)).toEqual({
        error: {
          code: 'PLAN_LIMIT_REACHED',
          message:
            'Sess did not create the interaction: the workspace has reached a limit of its plan. Nothing was created.',
          retryable: false,
        },
      });
      // Sess's owner text and its URL are not relayed; nothing is kept as an unknown create.
      expect(text).not.toContain('sess.si');
      expect(text).not.toContain('Usage');
      expect(fake.calls.filter((c) => c.method === 'POST')).toHaveLength(1);
      expect(lines.join('')).toContain('sess-mcp: create_rejected');
      expect(lines.join('')).not.toContain('create_unknown');
      expect(
        readdirSync(join(dir.path, 'profiles', 'default', 'handles')).filter((n) => n.endsWith('.json')),
      ).toEqual([]);
    },
  );

  it('MCP request cancellation ends sess_response as needs_resume without touching the Session', async () => {
    const fake = new FakeSess();
    const { client, adapter } = await connect(fake, { verify: true });
    const created = await client.callTool({ name: 'sess_request', arguments: { interaction: ROUND_1 } });
    const handle = (created.structuredContent as any).interaction.handle;
    const controller = new AbortController();
    const pending = client.callTool(
      { name: 'sess_response', arguments: { handle, revision: 1, wait_ms: 30_000 } },
      undefined,
      { signal: controller.signal },
    );
    setTimeout(() => controller.abort(), 150);
    await expect(pending).rejects.toThrow();
    // The server observed the cancellation and persisted needs_resume (not failure, not cancellation).
    const file = join(dir.path, 'profiles', 'default', 'handles', `${handle}.json`);
    let state = '';
    for (let i = 0; i < 100 && state !== 'needs_resume'; i++) {
      state = JSON.parse(readFileSync(file, 'utf8')).state;
      await new Promise((r) => setTimeout(r, 20));
    }
    expect(state).toBe('needs_resume');
    expect(fake.session!.status).toBe('active');
    // A later authorized call resumes the same handle.
    fake.answer(ANSWER_1.data);
    expect((await adapter.response({ handle, revision: 1, waitMs: 0 })).interaction.state).toBe('answered');
    expect(fake.calls.filter((c) => c.method !== 'GET' && !c.path.endsWith('/v1/sessions'))).toHaveLength(0);
  });

  it('rejects unsafe argument keys that the MCP library would otherwise drop', async () => {
    const fake = new FakeSess();
    const created = createSessMcpServer({
      env: env(dir.path),
      createClient: clientFor(fake),
      diagnostics: () => {},
    });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await created.connect(serverTransport);
    const responses: any[] = [];
    clientTransport.onmessage = (message) => responses.push(message);
    await clientTransport.start();
    await clientTransport.send({
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'raw', version: '0' } },
    });
    await clientTransport.send(
      JSON.parse(
        '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"sess_request","arguments":{"interaction":{},"__proto__":{"polluted":true}}}}',
      ),
    );
    for (let i = 0; i < 50 && responses.length < 2; i++) await new Promise((r) => setTimeout(r, 10));
    const result = responses.find((r) => r.id === 2).result;
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('unsafe key');
    expect(({} as any).polluted).toBeUndefined();
    expect(fake.calls).toHaveLength(0);
  });
});
