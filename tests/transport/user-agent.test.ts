// The SDK names itself in the User-Agent header of every request it makes (Sess classifies the
// creating client by product token), and a wrapping client may put its own token first.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import { Sess, SessError } from '../../src/index.js';
import { SDK_VERSION } from '../../src/internal/version.js';
import { API_KEY, INTERACTION, SESSION_ID, WORKSPACE, session } from '../fixtures/api.js';

const PACKAGE = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8')) as {
  version: string;
};
const SDK = `sess-sdk/${PACKAGE.version} node/${process.versions.node}`;

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
      const headers = { 'content-type': 'application/json', 'sess-workspace-id': WORKSPACE };
      if (request.method === 'POST') {
        response.writeHead(201, { ...headers, etag: '"r1"' });
        response.end(
          JSON.stringify({ id: SESSION_ID, revision: 1, human_url: 'https://human.example/s/ua-test' }),
        );
      } else {
        response.writeHead(200, { ...headers, etag: '"r1"' });
        response.end(JSON.stringify(session()));
      }
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Missing local address');
  baseUrl = `http://127.0.0.1:${address.port}`;
});
afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));

const client = (userAgent?: string) =>
  new Sess({
    apiKey: API_KEY,
    baseUrl,
    allowInsecureLocalhost: true,
    ...(userAgent === undefined ? {} : { userAgent }),
  });

describe('User-Agent', () => {
  it('names the SDK version from package.json', () => {
    expect(SDK_VERSION).toBe(PACKAGE.version);
  });

  it('sends sess-sdk/<version> and the runtime token on every request, through native fetch', async () => {
    seen.length = 0;
    const sdk = client();
    await sdk.sessions.create({ interaction: INTERACTION });
    await sdk.sessions.retrieve(SESSION_ID);
    expect(seen).toEqual([
      { method: 'POST', path: '/v1/sessions', userAgent: SDK },
      { method: 'GET', path: `/v1/sessions/${SESSION_ID}`, userAgent: SDK },
    ]);
  });

  it("puts a wrapping client's tokens first", async () => {
    seen.length = 0;
    await client('sess-openclaw/0.1.0-rc.4').sessions.create({ interaction: INTERACTION });
    expect(seen.map((r) => r.userAgent)).toEqual([`sess-openclaw/0.1.0-rc.4 ${SDK}`]);
    seen.length = 0;
    await client('my-app/2 helper').sessions.create({ interaction: INTERACTION });
    expect(seen.map((r) => r.userAgent)).toEqual([`my-app/2 helper ${SDK}`]);
  });

  it.each([
    '',
    ' my-app/1',
    'my-app/1 ',
    'my-app/1  other/2',
    'my app/1/2',
    'my-app/1\r\nX-Injected: 1',
    'my-app/(1)',
    'a'.repeat(257),
    42,
  ])('refuses userAgent %j before anything is sent', (value) => {
    let error: unknown;
    try {
      new Sess({ apiKey: API_KEY, baseUrl, allowInsecureLocalhost: true, userAgent: value as string });
    } catch (e) {
      error = e;
    }
    expect(error).toBeInstanceOf(SessError);
    expect(error).toMatchObject({ kind: 'configuration', outcome: 'not_sent' });
  });
});
