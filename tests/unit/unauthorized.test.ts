// A key Sess does not accept (HTTP 401 UNAUTHORIZED) says so in one sentence a person can act on
// (founder 2026-10-27 04:05Z item 3), and printing any SessError never lists absent fields as
// `undefined`. The examples print the message first and the code and request ID on a "Details" line.
import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { inspect, promisify } from 'node:util';
import * as ts from 'typescript';
import { describe, expect, it, vi } from 'vitest';
import { Sess, SessError } from '../../src/index.js';
import { API_KEY, INTERACTION, SESSION_ID, apiError, json } from '../fixtures/api.js';

const UNAUTHORIZED = 'Sess did not accept your API key. Check SESS_API_KEY and the portal you made it on.';
const GENERIC = 'The Sess API returned an error. See the status and code fields.';
const run = promisify(execFile);
const root = new URL('../../', import.meta.url);

async function rejection(promise: Promise<unknown>): Promise<SessError> {
  return promise.then(
    () => {
      throw new Error('Expected rejection');
    },
    (error: unknown) => {
      if (!(error instanceof SessError)) throw error;
      return error;
    },
  );
}
const client = (fetch: typeof globalThis.fetch) => new Sess({ apiKey: API_KEY, fetch });
const question = {
  question: 'Approve the synthetic refund?',
  fields: [{ name: 'approved', label: 'Approve it', type: 'boolean' }],
} as const;

/** Every own property of a printed error has a value, and no output names `undefined`. */
function expectNoAbsentFields(error: SessError) {
  for (const [name, value] of Object.entries(error)) expect(value, name).not.toBeUndefined();
  expect(inspect(error)).not.toContain('undefined');
  expect(JSON.stringify(error)).not.toContain('undefined');
  expect(String(error)).toBe(`SessError: ${error.message}`);
}

describe('a 401 UNAUTHORIZED', () => {
  it.each([
    ['sessions.create', (sess: Sess) => sess.sessions.create({ interaction: INTERACTION })],
    ['sessions.retrieve', (sess: Sess) => sess.sessions.retrieve(SESSION_ID)],
    ['ask', (sess: Sess) => sess.ask(question)],
  ])('says Sess did not accept the key, from %s', async (_, call) => {
    const fetch = vi.fn(async () => apiError(401, 'UNAUTHORIZED'));
    const error = await rejection(call(client(fetch)));
    expect(error.message).toBe(UNAUTHORIZED);
    expect(error).toMatchObject({ kind: 'api', code: 'UNAUTHORIZED', status: 401, requestId: 'request-123' });
    expect(fetch).toHaveBeenCalledTimes(1);
    expectNoAbsentFields(error);
    expect(inspect(error)).not.toContain(API_KEY);
    expect(inspect(error)).not.toContain('remote secret');
  });

  it('keeps the typed fields a program reads; absent ones read as undefined', async () => {
    const error = await rejection(
      client(async () => apiError(401, 'UNAUTHORIZED')).sessions.create({ interaction: INTERACTION }),
    );
    expect(error).toMatchObject({ operation: 'sessions.create', attempts: 1, outcome: 'rejected' });
    expect(error.retryAfterMs).toBeUndefined();
    expect(error.reason).toBeUndefined();
    expect(error.field).toBeUndefined();
    expect('retryAfterMs' in error).toBe(false);
    expect(inspect(error)).toBe(
      inspect({
        name: 'SessError',
        kind: 'api',
        message: UNAUTHORIZED,
        code: 'UNAUTHORIZED',
        status: 401,
        requestId: 'request-123',
        operation: 'sessions.create',
        attempts: 1,
        outcome: 'rejected',
      }),
    );
  });

  it.each([
    ['a 401 without a code', () => json({ error: {} }, 401)],
    ['a 401 with another code', () => apiError(401, 'FORBIDDEN')],
    ['UNAUTHORIZED on a 403', () => apiError(403, 'UNAUTHORIZED')],
    ['a 403 ACTION_NOT_ALLOWED', () => apiError(403, 'ACTION_NOT_ALLOWED')],
    ['a 429 PLAN_LIMIT_REACHED', () => apiError(429, 'PLAN_LIMIT_REACHED', { reason: 'active_sessions' })],
  ])('leaves the other messages as they were: %s', async (_, reply) => {
    // A read: an uncoded write refusal is reported as an uncertain create, with its own message.
    const error = await rejection(client(async () => reply()).sessions.retrieve(SESSION_ID));
    expect(error.message).toBe(GENERIC);
    expectNoAbsentFields(error);
  });

  it('a network failure keeps its message and prints no absent fields', async () => {
    const error = await rejection(
      client(async () => {
        throw new TypeError('fetch failed');
      }).sessions.create({ interaction: INTERACTION }),
    );
    expect(error.kind).toBe('unknown_outcome');
    expect(error.message).toBe(
      'Session creation may have succeeded. Do not automatically create again; inspect recovery information if available.',
    );
    expectNoAbsentFields(error);
  });

  it('a directly constructed error drops details given as undefined', () => {
    const error = new SessError('api', 'Synthetic.', {
      code: 'X',
      retryAfterMs: undefined,
      status: undefined,
    });
    expect(Object.keys(error).sort()).toEqual(['code', 'kind', 'name']);
    expectNoAbsentFields(error);
  });
});

describe('printing a 401 from the examples', () => {
  /** A loopback Sess that refuses every key, as the API does for a key it does not accept. */
  async function refusingServer() {
    const server = createServer((_, res) => {
      res.writeHead(401, { 'content-type': 'application/json', 'x-request-id': 'req_synthetic401' });
      res.end(
        JSON.stringify({
          error: { code: 'UNAUTHORIZED', message: 'remote text', request_id: 'req_synthetic401' },
        }),
      );
    });
    await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
    return { server, url: `http://127.0.0.1:${(server.address() as AddressInfo).port}` };
  }
  const env = (url: string) => ({
    PATH: process.env.PATH ?? '',
    SESS_API_KEY: API_KEY,
    SESS_API_URL: url,
    SESS_ALLOW_INSECURE_LOCALHOST: '1',
  });
  /** Resolves `@sess.si/sdk` to this checkout's build, as an installed copy would. */
  const sdk = pathToFileURL(fileURLToPath(new URL('dist/index.js', root))).href;
  const hooks = `export async function resolve(s, c, next) { return s === '@sess.si/sdk' ? { url: ${JSON.stringify(sdk)}, shortCircuit: true } : next(s, c); }`;
  const register = `import { register } from 'node:module'; register(${JSON.stringify(`data:text/javascript,${encodeURIComponent(hooks)}`)});`;
  const importSdk = `data:text/javascript,${encodeURIComponent(register)}`;

  it('the Node quickstart prints the message, then the code and request ID on a Details line', async () => {
    const { server, url } = await refusingServer();
    try {
      const program = fileURLToPath(new URL('examples/quickstart-node/index.mjs', root));
      const result = await run(process.execPath, ['--import', importSdk, program], { env: env(url) }).then(
        () => {
          throw new Error('Expected the quickstart to fail');
        },
        (error: { code: number; stdout: string; stderr: string }) => error,
      );
      expect(result.code).toBe(1);
      expect(result.stdout).toBe('');
      expect(result.stderr).toBe(
        `Could not create the Session: ${UNAUTHORIZED}\nDetails: UNAUTHORIZED, request req_synthetic401\n`,
      );
    } finally {
      server.close();
    }
  });

  it('an uncaught 401 (the README example without a catch) prints no absent fields', async () => {
    const { server, url } = await refusingServer();
    try {
      const source = `import { Sess } from '@sess.si/sdk';
const sess = new Sess({ apiKey: process.env.SESS_API_KEY, baseUrl: process.env.SESS_API_URL, allowInsecureLocalhost: true });
await sess.ask(${JSON.stringify(question)});`;
      const result = await run(
        process.execPath,
        ['--import', importSdk, '--input-type=module', '--eval', source],
        { env: env(url) },
      ).then(
        () => {
          throw new Error('Expected an uncaught error');
        },
        (error: { code: number; stderr: string }) => error,
      );
      expect(result.code).toBe(1);
      expect(result.stderr).toContain(`SessError: ${UNAUTHORIZED}\n`);
      expect(result.stderr).toContain("code: 'UNAUTHORIZED'");
      expect(result.stderr).toContain("requestId: 'req_synthetic401'");
      expect(result.stderr).not.toContain('undefined');
      expect(result.stderr).not.toContain(API_KEY);
      expect(result.stderr).not.toContain('remote text');
    } finally {
      server.close();
    }
  });

  it("the README's error example prints the message, then a Details line", async () => {
    const readme = (await readFile(new URL('README.md', root), 'utf8')).replace(/\r\n/g, '\n');
    const block = /<!-- example:ask-error -->\s*```js\n([\s\S]*?)\n```\s*<!-- \/example:ask-error -->/.exec(
      readme,
    )?.[1];
    expect(block).toBeTruthy();
    const compiled = ts.transpileModule(block!, {
      compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
    }).outputText;
    const execute = new Function('sess', 'process', 'console', `return (async () => { ${compiled}\n})()`) as (
      sess: Sess,
      process: { exitCode?: number },
      console: { log(text: string): void; error(text: string): void },
    ) => Promise<void>;
    const printed = async (reply: () => Response | Promise<Response>) => {
      const lines: string[] = [];
      const errors: string[] = [];
      const proc: { exitCode?: number } = {};
      await execute(
        client(async () => reply()),
        proc,
        {
          log: (text) => lines.push(text),
          error: (text) => errors.push(text),
        },
      );
      return { lines, errors, exitCode: proc.exitCode };
    };
    expect(await printed(() => apiError(401, 'UNAUTHORIZED'))).toEqual({
      lines: [],
      errors: [UNAUTHORIZED, 'Details: UNAUTHORIZED, request request-123'],
      exitCode: 1,
    });
    // An error without a code or request ID names its kind and nothing absent.
    const offline = await printed(() => {
      throw new TypeError('fetch failed');
    });
    expect(offline.errors[1]).toBe('Details: unknown_outcome');
    expect(offline.errors.join('\n')).not.toContain('undefined');
  });
});
