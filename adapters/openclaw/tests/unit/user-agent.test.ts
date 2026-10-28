// The plugin names itself to Sess in the User-Agent header (Sess classifies the creating client by
// product token). The SDK pin, 0.1.0-rc.9, sends its own User-Agent (sess-sdk/<version>
// node/<version>) and puts its `userAgent` option's tokens first, so the plugin's client passes its
// token there; this test sends real requests through native fetch to a local stub server and
// asserts the exact header.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import { createGuardedClient, USER_AGENT } from '../../src/client.js';
import { parseConfig, resolveCredential } from '../../src/config.js';
import { API_KEY, API_KEY_ENV } from './harness.js';

const pkg = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8'));
const sdkVersion: string = JSON.parse(
  readFileSync(new URL('../../node_modules/@sess.si/sdk/package.json', import.meta.url), 'utf8'),
).version;
// The plugin's token, then the SDK's own: exactly one of each, in that order.
const EXPECTED = `sess-openclaw/${pkg.version} sess-sdk/${sdkVersion} node/${process.versions.node}`;
const SESSION_ID = 'ses_00000000000000000000000001';

let server: Server;
let baseUrl: string;
const seen: { method: string; path: string; userAgent: string | undefined }[] = [];

beforeAll(async () => {
  server = createServer((request, response) => {
    seen.push({
      method: String(request.method),
      path: String(request.url),
      userAgent: request.headers['user-agent'],
    });
    request.resume();
    request.on('end', () => {
      response.writeHead(201, { 'content-type': 'application/json', etag: '"r1"' });
      response.end(JSON.stringify({ id: SESSION_ID, revision: 1, human_url: 'https://human.example/s/ua' }));
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Missing local address');
  baseUrl = `http://127.0.0.1:${address.port}`;
});
afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));

describe('User-Agent', () => {
  it('is sess-openclaw/<plugin version>', () => {
    expect(USER_AGENT).toBe(`sess-openclaw/${pkg.version}`);
  });

  it('every request the plugin client sends carries the exact header', async () => {
    const config = parseConfig({ baseUrl, apiKeyEnv: API_KEY_ENV, allowInsecureLocalhost: true });
    const lease = { binding: { agentId: 'a', sessionKey: 'k', sessionId: 's' }, assertCurrent() {} };
    const client = createGuardedClient(config, resolveCredential(config, { [API_KEY_ENV]: API_KEY }), lease);
    await client.sess.sessions.create({
      interaction: {
        mode: 'interactive',
        title: 'Synthetic check',
        source: { kind: 'sess_surface', components: [{ type: 'text', text: 'Synthetic.' }] },
        actions: [{ id: 'ok', label: 'OK', intent: 'approve' }],
      },
    });
    expect(seen).toEqual([{ method: 'POST', path: '/v1/sessions', userAgent: EXPECTED }]);
    expect(client.dispatched()).toBe(1);
  });
});
