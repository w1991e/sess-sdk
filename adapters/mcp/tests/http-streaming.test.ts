// @acceptance P2-14
// Streaming regressions for HTTP-01 (ASTRA review of sess-sdk #32): Host, Origin and authentication
// are decided from the headers before any body byte is read, and an absolute deadline started at
// entry bounds body ingestion. Each case sends a real, deliberately incomplete or slow body and
// asserts the answer arrives while the body is still open, with no store opened and no SESS call.
import http from 'node:http';
import { afterEach, describe, expect, it } from 'vitest';
import { startHttp, type Harness } from './http-helpers.js';

let harness: Harness | undefined;
const cleanups: (() => void)[] = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0)) cleanup();
  await harness?.close();
  harness = undefined;
});

const LIST = '{"jsonrpc":"2.0","id":1,"method":"tools/list"}';
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const timers = () => process.getActiveResourcesInfo().filter((name) => name === 'Timeout').length;

function untouched(h: Harness) {
  expect(h.backend.opened).toHaveLength(0);
  for (const fake of Object.values(h.fakes)) expect(fake.calls).toHaveLength(0);
}

interface Answer {
  status: number;
  headers: http.IncomingHttpHeaders;
  body: string;
  ms: number;
}

/**
 * Node face over a real socket: sends the headers and `first`, then nothing more until `rest` is
 * called. `answer` resolves with the first complete response.
 */
function openNode(url: URL, headers: Record<string, string>, first: string) {
  const started = Date.now();
  const req = http.request(url, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      accept: 'application/json, text/event-stream',
      ...headers,
    },
  });
  const answer = new Promise<Answer>((resolve, reject) => {
    req.on('response', (res) => {
      let body = '';
      res.on('data', (chunk: Buffer) => (body += chunk.toString()));
      res.on('end', () =>
        resolve({ status: res.statusCode!, headers: res.headers, body, ms: Date.now() - started }),
      );
      res.on('error', reject);
    });
    req.on('error', reject);
  });
  req.flushHeaders();
  if (first) req.write(first);
  cleanups.push(() => req.destroy());
  return { req, answer, rest: (text: string) => req.end(text) };
}

/** Fetch face with a body stream this test controls; nothing more is sent until `push`/`end`. */
function openFetch(h: Harness, headers: Record<string, string>, first: string, signal?: AbortSignal) {
  let controller!: ReadableStreamDefaultController<Uint8Array>;
  const body = new ReadableStream<Uint8Array>({ start: (c) => void (controller = c) });
  if (first) controller.enqueue(new TextEncoder().encode(first));
  const started = Date.now();
  const response = h.handler
    .fetch(
      new Request(h.url, {
        method: 'POST',
        headers: {
          host: h.url.host,
          'content-type': 'application/json',
          accept: 'application/json, text/event-stream',
          ...headers,
        },
        body,
        duplex: 'half',
        ...(signal ? { signal } : {}),
      } as RequestInit),
    )
    .then(async (r) => ({ status: r.status, body: await r.text(), ms: Date.now() - started }));
  cleanups.push(() => {
    try {
      controller.close();
    } catch {
      // already closed or errored
    }
  });
  return {
    response,
    push: (text: string) => controller.enqueue(new TextEncoder().encode(text)),
    end: () => controller.close(),
  };
}

const ALICE = { authorization: 'Bearer mcp-token-alice' };

describe('[P2-14] HTTP-01 node face: header preflight before any body byte', () => {
  it('rejects a disallowed Host while the body is still open, without calling authenticate', async () => {
    const h = (harness = await startHttp());
    const { answer } = openNode(h.url, { ...ALICE, host: 'evil.test', 'content-length': '2' }, '{');
    const a = await answer;
    expect(a.status).toBe(403);
    expect(a.headers.connection).toBe('close');
    expect(a.ms).toBeLessThan(1000);
    expect(h.authenticated).toHaveLength(0);
    untouched(h);
  });

  it('rejects a disallowed Origin while the body is still open, without calling authenticate', async () => {
    const h = (harness = await startHttp());
    const { answer } = openNode(h.url, { ...ALICE, origin: 'https://evil.test', 'content-length': '2' }, '{');
    const a = await answer;
    expect(a.status).toBe(403);
    expect(h.authenticated).toHaveLength(0);
    untouched(h);
  });

  it('answers 401 for a missing or invalid credential while the body is still open, authenticating once', async () => {
    const h = (harness = await startHttp());
    const missing = await openNode(h.url, { 'content-length': '2' }, '{').answer;
    expect(missing.status).toBe(401);
    expect(missing.ms).toBeLessThan(1000);
    const invalid = await openNode(
      h.url,
      { authorization: 'Bearer mcp-token-revoked', 'content-length': '2' },
      '{',
    ).answer;
    expect(invalid.status).toBe(401);
    expect(h.authenticated).toEqual(['mcp-token-revoked']);
    untouched(h);
  });

  it('answers 413 for a declared length over the bound before reading the body', async () => {
    const h = (harness = await startHttp({ overrides: { maxBodyBytes: 1024 } }));
    const a = await openNode(h.url, { ...ALICE, 'content-length': '4096' }, '{').answer;
    expect(a.status).toBe(413);
    expect(a.ms).toBeLessThan(1000);
    untouched(h);
  });

  it('terminates an authorized incomplete body at the deadline (ASTRA repro: Content-Length 2, only "{")', async () => {
    const h = (harness = await startHttp({ overrides: { requestTimeoutMs: 250 } }));
    const a = await openNode(h.url, { ...ALICE, 'content-length': '2' }, '{').answer;
    expect(a.status).toBe(408);
    expect(a.headers.connection).toBe('close');
    expect(a.ms).toBeGreaterThanOrEqual(200);
    expect(a.ms).toBeLessThan(250 + 750);
    expect(h.authenticated).toEqual(['mcp-token-alice']);
    expect(h.lines).toContain('http_rejected {"reason":"body_timeout"}');
    untouched(h);
  });

  it('serves a slow body that completes within the deadline', async () => {
    const h = (harness = await startHttp({ overrides: { requestTimeoutMs: 2000 } }));
    const open = openNode(h.url, { ...ALICE, 'content-length': String(LIST.length) }, LIST.slice(0, 10));
    await sleep(300);
    open.rest(LIST.slice(10));
    const a = await open.answer;
    expect(a.status).toBe(200);
    expect(a.body).toContain('sess_request');
    expect(h.authenticated).toEqual(['mcp-token-alice']);
  });

  it('cleans up after a disconnect mid-body: no store, no SESS call, no deadline timer left', async () => {
    const h = (harness = await startHttp());
    const before = timers();
    const open = openNode(h.url, { ...ALICE, 'content-length': '64' }, '{"jsonrpc"');
    open.answer.catch(() => undefined);
    await sleep(100);
    open.req.destroy();
    await sleep(200);
    expect(h.lines).toContain('http_rejected {"reason":"body_aborted"}');
    expect(timers()).toBeLessThanOrEqual(before);
    untouched(h);
  });
});

describe('[P2-14] HTTP-01 fetch face: header preflight before any body byte', () => {
  it('rejects Host, Origin and missing credentials while the body stream is still open', async () => {
    const h = (harness = await startHttp());
    const host = await openFetch(h, { ...ALICE, host: 'evil.test' }, '{').response;
    expect(host.status).toBe(403);
    const origin = await openFetch(h, { ...ALICE, origin: 'https://evil.test' }, '{').response;
    expect(origin.status).toBe(403);
    expect(h.authenticated).toHaveLength(0);
    const missing = await openFetch(h, {}, '{').response;
    expect(missing.status).toBe(401);
    for (const r of [host, origin, missing]) expect(r.ms).toBeLessThan(1000);
    untouched(h);
  });

  it('terminates an authorized incomplete body stream at the deadline and clears its timer', async () => {
    const h = (harness = await startHttp({ overrides: { requestTimeoutMs: 250 } }));
    const before = timers();
    const r = await openFetch(h, ALICE, '{').response;
    expect(r.status).toBe(408);
    expect(r.ms).toBeGreaterThanOrEqual(200);
    expect(r.ms).toBeLessThan(250 + 750);
    expect(timers()).toBeLessThanOrEqual(before);
    untouched(h);
  });

  it('enforces the byte bound on a streamed body without a declared length', async () => {
    const h = (harness = await startHttp({ overrides: { maxBodyBytes: 1024 } }));
    const open = openFetch(h, ALICE, '{"pad":"');
    open.push('x'.repeat(2048));
    const r = await open.response;
    expect(r.status).toBe(413);
    untouched(h);
  });

  it('serves a slow body stream that completes within the deadline, then clears its timer', async () => {
    const h = (harness = await startHttp({ overrides: { requestTimeoutMs: 2000 } }));
    const before = timers();
    const open = openFetch(h, ALICE, LIST.slice(0, 10));
    await sleep(300);
    open.push(LIST.slice(10));
    open.end();
    const r = await open.response;
    expect(r.status).toBe(200);
    expect(r.body).toContain('sess_request');
    expect(timers()).toBeLessThanOrEqual(before);
  });

  it('stops on a client abort mid-body: no store, no SESS call, timer cleared', async () => {
    const h = (harness = await startHttp());
    const before = timers();
    const abort = new AbortController();
    const open = openFetch(h, ALICE, '{"jsonrpc"', abort.signal);
    await sleep(100);
    abort.abort();
    const r = await open.response;
    expect(r.status).toBe(400);
    expect(h.lines).toContain('http_rejected {"reason":"body_aborted"}');
    expect(timers()).toBeLessThanOrEqual(before);
    untouched(h);
  });
});
