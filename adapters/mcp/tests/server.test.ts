import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { stderrDiagnostics } from '../src/errors.js';
import { createSessMcpServer } from '../src/server.js';
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
