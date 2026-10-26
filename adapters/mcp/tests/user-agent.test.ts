// The adapter names itself to Sess in the User-Agent header (Sess classifies the creating client by
// product token), on the local stdio path and the hosted HTTP path. The SDK pin, 0.1.0-rc.8, sends
// no User-Agent of its own and has no option to prepend one, so the adapter's fetch sets it. Real
// requests go through native fetch to a local stub Sess API; the test asserts the exact header.
import { readFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import { Sess } from '@sess.si/sdk';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { SessMcpAdapter } from '../src/operations.js';
import { USER_AGENT } from '../src/user-agent.js';
import { parseRequestArgs } from '../src/validate.js';
import { ROUND_1, env, tempDir } from './helpers.js';
import { modernClient, startHttp } from './http-helpers.js';

const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
const sdkVersion: string = JSON.parse(
  readFileSync(new URL('../node_modules/@sess.si/sdk/package.json', import.meta.url), 'utf8'),
).version;
// rc.8 sends no User-Agent: the header is exactly the adapter's token. A later SDK appends its own.
const EXPECTED =
  sdkVersion === '0.1.0-rc.8'
    ? `sess-mcp/${pkg.version}`
    : `sess-mcp/${pkg.version} sess-sdk/${sdkVersion} node/${process.versions.node}`;

let server: Server;
let origin: string;
const seen: { method: string; path: string; userAgent: string | undefined }[] = [];
const closers: (() => Promise<unknown>)[] = [];

beforeAll(async () => {
  // Answers every request with a refusal: only the request headers matter here.
  server = createServer((request, response) => {
    seen.push({
      method: String(request.method),
      path: String(request.url),
      userAgent: request.headers['user-agent'],
    });
    request.resume();
    request.on('end', () => {
      response.writeHead(401, { 'content-type': 'application/json' });
      response.end('{"error":{"code":"UNAUTHORIZED","request_id":"req_ua","message":"x"}}');
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Missing local address');
  origin = `http://127.0.0.1:${address.port}`;
});
afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));
afterEach(async () => {
  while (closers.length) await closers.pop()!();
  seen.length = 0;
});

describe('User-Agent', () => {
  it('is sess-mcp/<adapter version>', () => {
    expect(USER_AGENT).toBe(`sess-mcp/${pkg.version}`);
  });

  it('the local stdio adapter sends the exact header', async () => {
    const dir = tempDir();
    closers.push(async () => dir.cleanup());
    const adapter = new SessMcpAdapter({
      env: env(dir.path, { SESS_API_ORIGIN: origin, SESS_MCP_TEST_ALLOW_INSECURE_LOCALHOST: '1' }),
      diagnostics: () => {},
    });
    await adapter.request(parseRequestArgs({ interaction: ROUND_1 })).catch(() => {});
    expect(seen).toEqual([{ method: 'POST', path: '/v1/sessions', userAgent: EXPECTED }]);
  });

  it('the hosted HTTP handler sends the exact header', async () => {
    const h = await startHttp({
      overrides: {
        apiOrigin: origin,
        allowInsecureLocalhost: true,
        // The production client: only retries are turned off.
        createClient: (options) => new Sess({ ...options, maxRetries: 0 }),
      },
    });
    closers.push(() => h.close());
    const client = await modernClient(h.url, 'mcp-token-alice');
    closers.push(() => client.close());
    await client.callTool({ name: 'sess_request', arguments: { interaction: ROUND_1 } });
    expect(seen).toEqual([{ method: 'POST', path: '/v1/sessions', userAgent: EXPECTED }]);
  });
});
