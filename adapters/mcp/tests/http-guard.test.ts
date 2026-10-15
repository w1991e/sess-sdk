// Raw-body guard regression, run in this package's CI. The v2 HTTP entry (createMcpHandler) silently drops `__proto__`
// keys from tools/call arguments before a tool handler runs, so @sess.si/mcp/http inspects the raw
// body in front of the SDK entry and answers in the request's protocol era (isLegacyRequest).
// The reference guard wrapped a stub tool; here the guarded handler is the real
// createSessMcpHttpHandler, and "no tool ran" means no store was opened and no SESS call was made.
import http from 'node:http';
import { toNodeHandler } from '@modelcontextprotocol/node';
import { Server, createMcpHandler } from '@modelcontextprotocol/server';
import { afterEach, describe, expect, it } from 'vitest';
import { ROUND_1 } from './helpers.js';
import {
  MODERN_META,
  legacyV1Client,
  modernClient,
  modernHeaders,
  rawPost,
  rpcBody,
  startHttp,
  type Harness,
} from './http-helpers.js';

let harness: Harness | undefined;
const closers: (() => Promise<unknown>)[] = [];
afterEach(async () => {
  for (const close of closers.splice(0).reverse()) await close().catch(() => undefined);
  await harness?.close();
  harness = undefined;
});

const call = (id: number, args: string, name = 'sess_request') =>
  `{"jsonrpc":"2.0","id":${id},"method":"tools/call","params":{"name":"${name}","arguments":${args}}}`;

function noToolRan(h: Harness) {
  expect(h.backend.opened).toHaveLength(0);
  for (const fake of Object.values(h.fakes)) expect(fake.calls).toHaveLength(0);
}

describe('raw-body unsafe-key guard (regression)', () => {
  it('canary: the unguarded v2 entry drops __proto__ before the tool handler', async () => {
    const seen: unknown[] = [];
    const handler = createMcpHandler(
      () => {
        const s = new Server({ name: 'guard-canary', version: '1' }, { capabilities: { tools: {} } });
        s.setRequestHandler('tools/list', async () => ({
          tools: [{ name: 't', inputSchema: { type: 'object' } }],
        }));
        s.setRequestHandler('tools/call', async (req) => {
          seen.push(req.params.arguments);
          return { content: [{ type: 'text', text: 'ran' }] };
        });
        return s;
      },
      { maxRequestBodySize: 256 * 1024 },
    );
    const server = http.createServer(toNodeHandler(handler));
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    closers.push(() => new Promise((resolve) => server.close(resolve)));
    const url = new URL(`http://127.0.0.1:${(server.address() as { port: number }).port}/mcp`);
    const r = await rawPost(url, call(1, '{"a":1,"__proto__":{"x":1}}', 't'), {}, null);
    expect(r.status).toBe(200);
    await r.text();
    expect(seen).toHaveLength(1);
    // If this fails the SDK changed: re-evaluate the guard.
    expect(Object.prototype.hasOwnProperty.call(seen[0], '__proto__')).toBe(false);
    expect(Object.keys(seen[0] as object)).toEqual(['a']);
  });

  it('rejects unsafe keys at any depth without running a tool', async () => {
    const h = (harness = await startHttp());
    for (const body of [
      call(2, '{"__proto__":{"polluted":true}}'),
      call(3, '{"n":{"constructor":{"prototype":1}}}'),
      call(4, '{"list":[{"ok":1},{"prototype":2}]}'),
    ]) {
      const r = await rawPost(h.url, body);
      expect(r.status).toBe(200);
      const j = await rpcBody(r);
      expect(j.result.isError, body).toBe(true);
      expect(j.result.content[0].text).toMatch(/INVALID_ARGUMENTS/);
      expect(j.result.resultType).toBeUndefined(); // 2025-era shape
    }
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
    noToolRan(h);
  });

  it('rejects a legacy batch containing an unsafe call, answering every request in it', async () => {
    // Expectation change from the reference: the reference answered a batch with one response
    // object for the first offending call. JSON-RPC answers a batch with an array, and the SDK's
    // legacy leg does process batches, so this guard answers each request in the batch: the
    // offending tools/call gets the INVALID_ARGUMENTS tool error, every other request gets -32600
    // "Not processed". As in the reference, nothing in the batch runs.
    const h = (harness = await startHttp());
    const r = await rawPost(h.url, `[${call(5, '{"a":1}')},${call(6, '{"__proto__":1}')}]`);
    expect(r.status).toBe(200);
    const j = await rpcBody(r);
    expect(Array.isArray(j)).toBe(true);
    const byId = new Map((j as { id: number }[]).map((m) => [m.id, m as any]));
    expect(byId.get(6).result.isError).toBe(true);
    expect(byId.get(6).result.content[0].text).toMatch(/INVALID_ARGUMENTS/);
    expect(byId.get(5).error.code).toBe(-32600);
    noToolRan(h);
  });

  it('rejects unsafe keys from a pinned 2026-07-28 client, answered in that era', async () => {
    const h = (harness = await startHttp());
    const client = await modernClient(h.url, 'mcp-token-alice');
    closers.push(() => client.close());
    expect(client.getNegotiatedProtocolVersion()).toBe('2026-07-28');
    // The modern client validates the result shape (resultType); a legacy-shaped answer would fail here.
    const r = await client.callTool({
      name: 'sess_request',
      arguments: JSON.parse('{"__proto__":{"polluted":true}}'),
    });
    expect(r.isError).toBe(true);
    expect((r.content as { text: string }[])[0]!.text).toMatch(/INVALID_ARGUMENTS.*unsafe key/);
    // A raw modern request gets the modern shape, and a modern batch is refused outright.
    const body = `{"jsonrpc":"2.0","id":7,"method":"tools/call","params":{"name":"sess_request","arguments":{"__proto__":1},"_meta":${JSON.stringify(MODERN_META)}}}`;
    const raw = await rpcBody(await rawPost(h.url, body, modernHeaders('tools/call', 'sess_request')));
    expect(raw.result).toMatchObject({ isError: true, resultType: 'complete' });
    const batch = await rawPost(h.url, `[${body}]`, modernHeaders('tools/call', 'sess_request'));
    expect(batch.status).toBe(400);
    noToolRan(h);
  });

  it('rejects unsafe keys from the v1 SDK client (2025-11-25)', async () => {
    const h = (harness = await startHttp());
    const { client } = await legacyV1Client(h.url, 'mcp-token-alice');
    closers.push(() => client.close());
    const r = await client.callTool({
      name: 'sess_request',
      arguments: JSON.parse('{"__proto__":{"polluted":true}}'),
    });
    expect(r.isError).toBe(true);
    expect((r.content as { text: string }[])[0]!.text).toMatch(/INVALID_ARGUMENTS.*unsafe key/);
    noToolRan(h);
  });

  it('passes clean arguments unchanged in both eras', async () => {
    const h = (harness = await startHttp());
    const legacy = await rpcBody(await rawPost(h.url, call(8, JSON.stringify({ interaction: ROUND_1 }))));
    expect(legacy.result.isError).toBeFalsy();
    expect(h.fakes['sess-cred-alice']!.session!.interaction).toMatchObject(ROUND_1);

    const bob = h.fakes['sess-cred-bob']!;
    const client = await modernClient(h.url, 'mcp-token-bob');
    closers.push(() => client.close());
    const modern = await client.callTool({ name: 'sess_request', arguments: { interaction: ROUND_1 } });
    expect(modern.isError).toBeFalsy();
    expect(bob.session!.interaction).toMatchObject(ROUND_1);
  });
});
