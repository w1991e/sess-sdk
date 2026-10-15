// @acceptance P2-14 (groundwork): stateless HTTP composition and the hosted operations/store seam.
import { afterEach, describe, expect, it } from 'vitest';
import {
  AdapterError,
  RECORD_SCHEMA,
  assertBindingAccess,
  createSessMcpHttpHandler,
  decodeRecord,
  grantBinding,
} from '../src/http.js';
import { TOOLS } from '../src/tools.js';
import { ANSWER_1, FakeSess, ORIGIN, ROUND_1 } from './helpers.js';
import {
  MODERN_META,
  RESOURCE_METADATA,
  SCOPE,
  legacyV1Client,
  legacyV2Client,
  modernClient,
  modernHeaders,
  rawPost,
  rpcBody,
  startHttp,
  toolPayload,
  type Harness,
} from './http-helpers.js';
import { MemoryHandleBackend } from './memory-store.js';

let harness: Harness | undefined;
const closers: (() => Promise<unknown>)[] = [];
afterEach(async () => {
  for (const close of closers.splice(0).reverse()) await close().catch(() => undefined);
  await harness?.close();
  harness = undefined;
});
async function start(options: Parameters<typeof startHttp>[0] = {}): Promise<Harness> {
  harness = await startHttp(options);
  return harness;
}

const call = (id: number, name: string, args: string) =>
  `{"jsonrpc":"2.0","id":${id},"method":"tools/call","params":{"name":"${name}","arguments":${args}}}`;

/** One tool call as an independent legacy (2025-era, no initialize) HTTP request. */
async function legacyCall(url: URL, token: string, name: string, args: unknown) {
  const response = await rawPost(url, call(1, name, JSON.stringify(args)), {}, token);
  expect(response.status).toBe(200);
  return (await rpcBody(response)).result;
}

/** One tool call as an independent modern (2026-07-28) HTTP request. */
async function modernCall(url: URL, token: string, name: string, args: unknown) {
  const body = JSON.stringify({
    jsonrpc: '2.0',
    id: 1,
    method: 'tools/call',
    params: { name, arguments: args, _meta: MODERN_META },
  });
  const response = await rawPost(url, body, modernHeaders('tools/call', name), token);
  expect(response.status).toBe(200);
  return (await rpcBody(response)).result;
}

describe('[P2-14] stateless HTTP: declared revisions and the five tools', () => {
  it('serves a modern 2026-07-28 client with the five tools, byte-identical schemas and a full verified round', async () => {
    const h = await start();
    const client = await modernClient(h.url, 'mcp-token-alice');
    closers.push(() => client.close());
    expect(client.getNegotiatedProtocolVersion()).toBe('2026-07-28');
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name)).toEqual(TOOLS.map((t) => t.name));

    const created = await client.callTool({ name: 'sess_request', arguments: { interaction: ROUND_1 } });
    expect(created.isError).toBeFalsy();
    const interaction = (created.structuredContent as any).interaction;
    const fake = h.fakes['sess-cred-alice']!;
    expect(interaction.humanUrl).toBe(fake.humanUrl);
    const eventId = fake.answerSigned(ANSWER_1.data, ANSWER_1.action_id);
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

    // The SESS API saw only the principal's SESS credential, never the MCP bearer token. The one
    // unauthenticated call is the public receipt-key fetch.
    for (const c of fake.calls)
      if (c.path === '/.well-known/sess-receipt-keys.json') expect(c.authorization).toBeNull();
      else expect(c.authorization).toBe('Bearer sess-cred-alice');
    // The human URL went to the agent only: never into diagnostics.
    const log = h.lines.join('\n');
    expect(log).not.toContain(fake.humanUrl);
    expect(log).not.toContain(fake.humanUrl.split('/').pop()!);
    expect(log).not.toMatch(/sess-cred|mcp-token/);
  });

  it('answers tools/list byte-identically to TOOLS in both eras over independent requests', async () => {
    const h = await start();
    const legacy = await rawPost(h.url, '{"jsonrpc":"2.0","id":1,"method":"tools/list"}');
    const legacyTools = (await rpcBody(legacy)).result.tools;
    const modern = await rawPost(
      h.url,
      JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/list', params: { _meta: MODERN_META } }),
      modernHeaders('tools/list'),
    );
    const modernTools = (await rpcBody(modern)).result.tools;
    expect(JSON.stringify(legacyTools)).toBe(JSON.stringify(TOOLS));
    expect(JSON.stringify(modernTools)).toBe(JSON.stringify(TOOLS));
  });

  it('serves the legacy 2025-11-25 path to the v1 SDK client and the v2 client, with no session state', async () => {
    const h = await start();
    const { client: v1, transport } = await legacyV1Client(h.url, 'mcp-token-alice');
    closers.push(() => v1.close());
    expect(transport.protocolVersion).toBe('2025-11-25');
    expect(transport.sessionId).toBeUndefined();
    expect((await v1.listTools()).tools).toHaveLength(5);
    const created = await v1.callTool({ name: 'sess_request', arguments: { interaction: ROUND_1 } });
    const handle = (created.structuredContent as any).interaction.handle;
    expect(handle).toMatch(/^sh_/);

    const v2 = await legacyV2Client(h.url, 'mcp-token-alice');
    closers.push(() => v2.close());
    expect(v2.getNegotiatedProtocolVersion()).toBe('2025-11-25');
    // Another client, another connection: the same principal continues the same handle.
    const waiting = await v2.callTool({
      name: 'sess_response',
      arguments: { handle, revision: 1, wait_ms: 0 },
    });
    expect((waiting.structuredContent as any).interaction.state).toBe('waiting');
  });

  it('refuses an unsupported modern revision with -32022 and names the supported one', async () => {
    const h = await start();
    const meta = { ...MODERN_META, 'io.modelcontextprotocol/protocolVersion': '2099-01-01' };
    const response = await rawPost(
      h.url,
      JSON.stringify({ jsonrpc: '2.0', id: 3, method: 'tools/list', params: { _meta: meta } }),
      { 'mcp-protocol-version': '2099-01-01', 'mcp-method': 'tools/list' },
    );
    expect(response.status).toBe(400);
    const body = await rpcBody(response);
    expect(body.error.code).toBe(-32022);
    expect(body.error.data.supported).toEqual(['2026-07-28']);
  });

  it('answers 415 for a non-JSON body and 413 above the body bound, before any tool runs', async () => {
    const h = await start({ overrides: { maxBodyBytes: 4096 } });
    const wrongType = await rawPost(h.url, '{}', { 'content-type': 'text/plain' });
    expect(wrongType.status).toBe(415);
    const big = call(4, 'sess_request', JSON.stringify({ interaction: { pad: 'x'.repeat(8192) } }));
    const tooLarge = await rawPost(h.url, big);
    expect(tooLarge.status).toBe(413);
    // The fetch face enforces the same bound (no node adapter in front).
    const direct = await h.handler.fetch(
      new Request(h.url, {
        method: 'POST',
        headers: {
          host: h.url.host,
          'content-type': 'application/json',
          authorization: 'Bearer mcp-token-alice',
        },
        body: big,
      }),
    );
    expect(direct.status).toBe(413);
    expect(h.backend.opened).toHaveLength(0);
    expect(h.fakes['sess-cred-alice']!.calls).toHaveLength(0);
  });

  it('ends a long sess_response wait as needs_resume at the per-request deadline', async () => {
    const h = await start({ overrides: { requestTimeoutMs: 400 } });
    const created = await legacyCall(h.url, 'mcp-token-alice', 'sess_request', { interaction: ROUND_1 });
    const handle = toolPayload(created).interaction.handle;
    const started = Date.now();
    const waited = await legacyCall(h.url, 'mcp-token-alice', 'sess_response', {
      handle,
      revision: 1,
      wait_ms: 30_000,
    });
    expect(toolPayload(waited).interaction.state).toBe('needs_resume');
    expect(Date.now() - started).toBeLessThan(10_000);
    expect(h.backend.record(handle).state).toBe('needs_resume');
  });
});

describe('[P2-14] authentication, Host and Origin in front of the SDK', () => {
  it('answers 401 with a resource-metadata challenge and never opens a store or calls SESS', async () => {
    const h = await start();
    const missing = await rawPost(h.url, '{"jsonrpc":"2.0","id":1,"method":"tools/list"}', {}, null);
    expect(missing.status).toBe(401);
    expect(missing.headers.get('www-authenticate')).toBe(`Bearer resource_metadata="${RESOURCE_METADATA}"`);
    const invalid = await rawPost(
      h.url,
      call(2, 'sess_request', JSON.stringify({ interaction: ROUND_1 })),
      {},
      'mcp-token-revoked',
    );
    expect(invalid.status).toBe(401);
    expect(invalid.headers.get('www-authenticate')).toBe(
      `Bearer error="invalid_token", resource_metadata="${RESOURCE_METADATA}"`,
    );
    expect(await invalid.json()).toMatchObject({ error: 'invalid_token' });
    // A modern client without credentials cannot connect at all.
    await expect(modernClient(h.url)).rejects.toThrow();
    expect(h.backend.opened).toHaveLength(0);
    for (const fake of Object.values(h.fakes)) expect(fake.calls).toHaveLength(0);
  });

  it('answers 403 insufficient_scope when the grant lacks the required scope', async () => {
    const h = await start();
    const response = await rawPost(
      h.url,
      call(1, 'sess_request', JSON.stringify({ interaction: ROUND_1 })),
      {},
      'mcp-token-alice-noscope',
    );
    expect(response.status).toBe(403);
    expect(response.headers.get('www-authenticate')).toBe(
      `Bearer error="insufficient_scope", scope="${SCOPE}", resource_metadata="${RESOURCE_METADATA}"`,
    );
    expect(h.fakes['sess-cred-alice']!.calls).toHaveLength(0);
  });

  it('validates Host always and Origin only when present; no header text is echoed', async () => {
    const h = await start();
    const list = '{"jsonrpc":"2.0","id":1,"method":"tools/list"}';
    const authenticatedBefore = h.authenticated.length;
    const evilHost = await h.handler.fetch(
      new Request('http://evil.test/mcp', {
        method: 'POST',
        headers: {
          host: 'evil.test',
          'content-type': 'application/json',
          accept: 'application/json, text/event-stream',
          authorization: 'Bearer mcp-token-alice',
        },
        body: list,
      }),
    );
    expect(evilHost.status).toBe(403);
    expect(await evilHost.text()).not.toContain('evil');
    // Host is checked before authentication runs.
    expect(h.authenticated).toHaveLength(authenticatedBefore);
    const evilOrigin = await rawPost(h.url, list, { origin: 'https://evil.test' });
    expect(evilOrigin.status).toBe(403);
    const nullOrigin = await rawPost(h.url, list, { origin: 'null' });
    expect(nullOrigin.status).toBe(403);
    const allowed = await rawPost(h.url, list, { origin: 'https://allowed.test' });
    expect(allowed.status).toBe(200);
    // Non-browser clients send no Origin and are not required to.
    expect((await rawPost(h.url, list)).status).toBe(200);
  });

  it('fails closed with 500 when the composer supplies a malformed principal', async () => {
    const h = await start({
      overrides: {
        authenticate: () => ({
          workspaceId: 'not a workspace id',
          principalId: 'usr_x',
          clientId: 'c',
          grantId: 'g',
          grantGeneration: '1',
          scopes: [SCOPE],
          credential: () => 'sess-cred-alice',
        }),
      },
    });
    const response = await rawPost(h.url, call(1, 'sess_request', JSON.stringify({ interaction: ROUND_1 })));
    expect(response.status).toBe(500);
    expect(h.fakes['sess-cred-alice']!.calls).toHaveLength(0);
  });

  it('requires authenticate, a store and a Host allowlist at construction', () => {
    const base = {
      authenticate: () => undefined,
      handleStore: () => new MemoryHandleBackend().view(undefined as never),
      requiredScopes: [],
      allowedHosts: ['localhost'],
      apiOrigin: ORIGIN,
    };
    expect(() => createSessMcpHttpHandler({ ...base, authenticate: undefined as never })).toThrow(
      /authenticate/,
    );
    expect(() => createSessMcpHttpHandler({ ...base, handleStore: undefined as never })).toThrow(
      /handleStore/,
    );
    expect(() => createSessMcpHttpHandler({ ...base, allowedHosts: [] })).toThrow(/allowedHosts/);
    expect(() => createSessMcpHttpHandler({ ...base, apiOrigin: 'http://api.sess.test' })).toThrow();
  });
});

describe('[P2-14] handle isolation, refresh, revocation and recovery through the injected store', () => {
  async function aliceHandle(h: Harness) {
    const created = await modernCall(h.url, 'mcp-token-alice', 'sess_request', { interaction: ROUND_1 });
    return toolPayload(created).interaction.handle as string;
  }

  for (const naive of [false, true]) {
    it(`two users of one host, one user's second host and another workspace cannot read or mutate a handle${naive ? ' (store without its own check)' : ''}`, async () => {
      const h = await start({ naive });
      const handle = await aliceHandle(h);
      const fake = h.fakes['sess-cred-alice']!;
      const eventId = fake.answerSigned(ANSWER_1.data, ANSWER_1.action_id);
      const before = h.backend.rows.get(handle);
      const aliceCalls = fake.calls.length;
      for (const token of ['mcp-token-bob', 'mcp-token-carol', 'mcp-token-alice-host-two']) {
        for (const [name, args] of [
          ['sess_response', { handle, revision: 1, wait_ms: 0 }],
          ['sess_complete', { handle, expected_revision: 1, response_event_id: eventId }],
          [
            'sess_publish',
            { handle, expected_revision: 1, response_event_id: eventId, interaction: ROUND_1 },
          ],
        ] as const) {
          const result = await modernCall(h.url, token, name, args);
          expect(result.isError).toBe(true);
          expect(toolPayload(result).error.code).toBe('HANDLE_NOT_FOUND');
        }
      }
      // Nothing was read from or written to Alice's runtime or record on their behalf.
      expect(fake.calls).toHaveLength(aliceCalls);
      expect(h.backend.rows.get(handle)).toBe(before);
      for (const key of ['sess-cred-bob', 'sess-cred-carol']) expect(h.fakes[key]!.calls).toHaveLength(0);
      // Alice still reads her own answer.
      const own = await modernCall(h.url, 'mcp-token-alice', 'sess_response', {
        handle,
        revision: 1,
        wait_ms: 0,
      });
      expect(toolPayload(own).interaction.state).toBe('answered');
    });
  }

  it('a refreshed token keeps the handles; a new grant generation refuses them', async () => {
    let refreshes = 0;
    const h = await start({
      // The SESS credential is re-read for every SESS request; refresh changes its value.
      credential: (who) => () => `${who.sessCredential}#${++refreshes}`,
    });
    const handle = await aliceHandle(h);
    const refreshed = await modernCall(h.url, 'mcp-token-alice-refreshed', 'sess_response', {
      handle,
      revision: 1,
      wait_ms: 0,
    });
    expect(toolPayload(refreshed).interaction.state).toBe('waiting');
    const keys = new Set(h.fakes['sess-cred-alice']!.calls.map((c) => c.authorization));
    expect(keys.size).toBeGreaterThan(1);

    const regranted = await modernCall(h.url, 'mcp-token-alice-regranted', 'sess_response', {
      handle,
      revision: 1,
      wait_ms: 0,
    });
    expect(regranted.isError).toBe(true);
    expect(toolPayload(regranted).error.code).toBe('BINDING_MISMATCH');
    // The new generation starts fresh handles of its own.
    const fresh = await modernCall(h.url, 'mcp-token-alice-regranted', 'sess_request', {
      interaction: ROUND_1,
    });
    expect(fresh.isError).toBeFalsy();
  });

  it('a restarted handler continues from the shared store with the saved replay identity', async () => {
    const backend = new MemoryHandleBackend();
    const fakes = { 'sess-cred-alice': new FakeSess() };
    let h = await start({ backend, fakes });
    const handle = await aliceHandle(h);
    const eventId = fakes['sess-cred-alice'].answerSigned(ANSWER_1.data, ANSWER_1.action_id);
    await modernCall(h.url, 'mcp-token-alice', 'sess_response', { handle, revision: 1, wait_ms: 0 });
    // The complete is sent, but its reply is lost: the outcome is unknown and stays pending.
    fakes['sess-cred-alice'].failNext = { method: 'POST', pathSuffix: '/complete', apply: true };
    const lost = await modernCall(h.url, 'mcp-token-alice', 'sess_complete', {
      handle,
      expected_revision: 1,
      response_event_id: eventId,
    });
    expect(toolPayload(lost).error.code).toBe('OUTCOME_UNKNOWN');
    const pending = backend.record(handle).pending!;
    await h.close();

    harness = h = await start({ backend, fakes });
    const replay = await legacyCall(h.url, 'mcp-token-alice', 'sess_complete', {
      handle,
      expected_revision: 1,
      response_event_id: eventId,
    });
    expect(toolPayload(replay).interaction.state).toBe('completed');
    const completes = fakes['sess-cred-alice'].calls.filter((c) => c.path.endsWith('/complete'));
    expect(completes.map((c) => c.idempotencyKey)).toEqual([pending.idempotencyKey, pending.idempotencyKey]);
    expect(completes.map((c) => c.ifMatch)).toEqual([pending.ifMatch, pending.ifMatch]);
  });

  it('concurrent identical requests share one replay identity', async () => {
    const h = await start();
    const handle = await aliceHandle(h);
    const fake = h.fakes['sess-cred-alice']!;
    const eventId = fake.answerSigned(ANSWER_1.data, ANSWER_1.action_id);
    await modernCall(h.url, 'mcp-token-alice', 'sess_response', { handle, revision: 1, wait_ms: 0 });
    const args = { handle, expected_revision: 1, response_event_id: eventId };
    const results = await Promise.all([
      modernCall(h.url, 'mcp-token-alice', 'sess_complete', args),
      legacyCall(h.url, 'mcp-token-alice', 'sess_complete', args),
      modernCall(h.url, 'mcp-token-alice-refreshed', 'sess_complete', args),
    ]);
    for (const result of results) expect(toolPayload(result).interaction.state).toBe('completed');
    const keys = new Set(fake.calls.filter((c) => c.path.endsWith('/complete')).map((c) => c.idempotencyKey));
    expect(keys.size).toBe(1);
    expect(h.backend.record(handle).state).toBe('completed');
  });

  it('a lost create reply stays unknown and is never recreated', async () => {
    const h = await start();
    const fake = h.fakes['sess-cred-alice']!;
    fake.createFailure = 'network';
    const lost = await modernCall(h.url, 'mcp-token-alice', 'sess_request', { interaction: ROUND_1 });
    expect(toolPayload(lost).error.code).toBe('CREATE_OUTCOME_UNKNOWN');
    const [handle] = [...h.backend.rows.keys()];
    expect(h.backend.record(handle!).state).toBe('create_unknown');
    const again = await modernCall(h.url, 'mcp-token-alice', 'sess_response', {
      handle,
      revision: 1,
      wait_ms: 0,
    });
    expect(toolPayload(again).error.code).toBe('CREATE_OUTCOME_UNKNOWN');
    expect(fake.calls.filter((c) => c.method === 'POST')).toHaveLength(1);
  });

  it('refuses a store that is not bound to the request authority', async () => {
    const backend = new MemoryHandleBackend();
    const h = await start({
      backend,
      overrides: {
        handleStore: (binding) => backend.view({ ...binding, principalId: 'usr_someone_else' }),
      },
    });
    const result = await modernCall(h.url, 'mcp-token-alice', 'sess_request', { interaction: ROUND_1 });
    expect(toolPayload(result).error.code).toBe('STATE_STORE_ERROR');
    expect(h.fakes['sess-cred-alice']!.calls).toHaveLength(0);
    expect(backend.rows.size).toBe(0);
  });
});

describe('[P2-14] grant binding primitives', () => {
  const authority = {
    origin: ORIGIN,
    workspaceId: 'wks_synthetic',
    principalId: 'usr_alice',
    clientId: 'https://host-one.test/client.json',
    grantId: 'grt_alice_one',
    grantGeneration: 'gen_1',
  };

  it('derives a stable, secret-free generation digest and refuses malformed identifiers', () => {
    const a = grantBinding(authority);
    expect(a.credentialGeneration).toMatch(/^cg1_[A-Za-z0-9_-]{22}$/);
    expect(grantBinding({ ...authority }).credentialGeneration).toBe(a.credentialGeneration);
    expect(grantBinding({ ...authority, grantGeneration: 'gen_2' }).credentialGeneration).not.toBe(
      a.credentialGeneration,
    );
    expect(() => grantBinding({ ...authority, workspaceId: 'wks with space' })).toThrow(TypeError);
    expect(() => grantBinding({ ...authority, principalId: '' })).toThrow(TypeError);
    expect(() => grantBinding({ ...authority, origin: 'ftp://x' })).toThrow(TypeError);
  });

  it('decodeRecord refuses a hosted record whose generation digest does not match its fields', () => {
    const binding = grantBinding(authority);
    const record = {
      schema: RECORD_SCHEMA,
      handle: 'sh_AAAAAAAAAAAAAAAAAAAAAA',
      binding,
      state: 'create_intent',
      createdAt: 'x',
      updatedAt: 'x',
      requestDigest: '0'.repeat(64),
      revision: 1,
      processed: [],
    };
    expect(decodeRecord(record, record.handle).binding).toEqual(binding);
    const forged = { ...record, binding: { ...binding, principalId: 'usr_bob' } };
    expect(() => decodeRecord(forged, record.handle)).toThrow(/unreadable or inconsistent/);
  });

  it('access: other authority is an unknown handle, other generation is a binding mismatch', () => {
    const own = grantBinding(authority);
    const code = (record: ReturnType<typeof grantBinding>) => {
      try {
        assertBindingAccess(record, own);
        return 'ok';
      } catch (error) {
        return (error as AdapterError).code;
      }
    };
    expect(code(own)).toBe('ok');
    expect(code(grantBinding({ ...authority, principalId: 'usr_bob' }))).toBe('HANDLE_NOT_FOUND');
    expect(code(grantBinding({ ...authority, workspaceId: 'wks_other' }))).toBe('HANDLE_NOT_FOUND');
    expect(code(grantBinding({ ...authority, clientId: 'cli_two' }))).toBe('HANDLE_NOT_FOUND');
    expect(code(grantBinding({ ...authority, grantGeneration: 'gen_2' }))).toBe('BINDING_MISMATCH');
  });
});
