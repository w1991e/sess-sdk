// The Gemini recipe's exact wire request, pinned against Google's documented Gemini API
// (https://ai.google.dev/api/generate-content#method:-models.generatecontent and
// https://ai.google.dev/gemini-api/docs/function-calling): POST
// https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent with the key in
// the x-goog-api-key header (never a ?key= query), a body of systemInstruction, contents, tools
// (functionDeclarations with parametersJsonSchema) and generationConfig. Plus the 2026-10-19
// qualification failure: gemini-2.5-flash-lite answers 404 NOT_FOUND ("no longer available to new
// users"), which is not retried, is charged at the attempt's ceiling, names the provider's error
// and falls back to the listed fallback model. Mocked only: no request leaves the process.
import { mkdtempSync, readdirSync, readFileSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Sess } from '@sess.si/sdk';
import { describe, expect, it } from 'vitest';

/* eslint-disable @typescript-eslint/no-explicit-any */
type Any = any;
const RECIPES = fileURLToPath(new URL('../../examples/recipes/', import.meta.url));
const load = (path: string): Promise<Any> => import(join(RECIPES, path));
const scratch = (prefix: string) => realpathSync(mkdtempSync(join(realpathSync(tmpdir()), prefix)));
const ENDPOINT = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-3.8-flash:generateContent';

async function geminiDryRun(respond?: (url: string, body: Any) => Response | null) {
  const { dryRun } = await load('qualify.mjs');
  const { scriptedProvider } = await load('dry-run.mjs');
  const scripted = scriptedProvider('gemini');
  const seen: { url: string; method: string; headers: Record<string, string>; body: Any }[] = [];
  const fetch = async (url: string, init: Any) => {
    const body = JSON.parse(init.body);
    seen.push({ url, method: init.method, headers: init.headers, body });
    return respond?.(url, body) ?? scripted.fetch(url, init);
  };
  const dir = scratch('sess-gemini-');
  const err: string[] = [];
  const result = await dryRun('gemini', {
    out: dir,
    Sess,
    sdkVersion: '0.1.0-rc.7',
    env: {},
    guard: { fetch, sleep: async () => {} },
    stdout: () => {},
    stderr: (line: string) => err.push(line),
  });
  const record = readdirSync(dir)
    .filter((f) => f.startsWith('gemini-'))
    .map((f) => JSON.parse(readFileSync(join(dir, f), 'utf8')))[0];
  return { result, seen, record, err: err.join('\n') };
}

describe('Gemini recipe request (documented API shape)', { timeout: 30_000 }, () => {
  it('POSTs to v1beta/models/{model}:generateContent with the x-goog-api-key header and the documented body', async () => {
    const { SYSTEM, TASK, TOOLS } = await load('workflow.mjs');
    const { result, seen } = await geminiDryRun();
    expect(result).toMatchObject({ ok: true, code: 'completed' });
    const [first, second] = seen;
    expect(first?.url).toBe(ENDPOINT); // the bare model id, no `models/` doubled, no query
    expect(new URL(first?.url ?? '').search).toBe('');
    expect(first?.method).toBe('POST');
    expect(first?.headers).toEqual({
      'content-type': 'application/json',
      'x-goog-api-key': 'dry-run-provider-key',
    });
    expect(Object.keys(first?.body).sort()).toEqual([
      'contents',
      'generationConfig',
      'systemInstruction',
      'tools',
    ]);
    expect(first?.body.systemInstruction).toEqual({ parts: [{ text: SYSTEM }] });
    expect(first?.body.contents).toEqual([{ role: 'user', parts: [{ text: TASK }] }]);
    expect(first?.body.tools).toHaveLength(1);
    expect(first?.body.tools[0].functionDeclarations).toEqual(
      TOOLS.map((t: Any) => ({
        name: t.name,
        description: t.description,
        parametersJsonSchema: t.parameters,
      })),
    );
    expect(first?.body.generationConfig).toEqual({
      maxOutputTokens: 2000,
      thinkingConfig: { thinkingLevel: 'low' },
    });
    // The next turn: the model's content unchanged (its thought signature with its call), then the
    // function response with the call's name and id.
    expect(second?.body.contents[1]).toEqual({
      role: 'model',
      parts: [
        {
          functionCall: { id: 'fc_0', name: 'sess_ask', args: expect.any(Object) },
          thoughtSignature: 'ts_0',
        },
      ],
    });
    expect(second?.body.contents[2]).toEqual({
      role: 'user',
      parts: [{ functionResponse: { name: 'sess_ask', id: 'fc_0', response: expect.any(Object) } }],
    });
  });

  it('a 404 NOT_FOUND for the model is not retried, is charged at its ceiling, names the provider error and falls back to the listed model', async () => {
    const notFound = () =>
      new Response(
        JSON.stringify({
          error: {
            code: 404,
            status: 'NOT_FOUND',
            message:
              'This model models/gemini-3.8-flash is no longer available to new users. key=provider-test-key',
          },
        }),
        { status: 404 },
      );
    const { result, seen, record, err } = await geminiDryRun((url) => (url === ENDPOINT ? notFound() : null));
    expect(result).toMatchObject({ ok: true, code: 'completed' });
    expect(seen[0]?.url).toBe(ENDPOINT);
    expect(seen[1]?.url).toBe(
      'https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash-lite:generateContent',
    );
    expect(seen.filter((s) => s.url === ENDPOINT)).toHaveLength(1); // a 404 is never retried
    expect(err).toContain('gemini-3.8-flash is not available to this key; trying gemini-3.5-flash-lite.');
    expect(record).toMatchObject({
      model_requested: 'gemini-3.5-flash-lite',
      requests: 8,
      retries: 0,
      attempts_charged_at_ceiling: 1,
    });
    // The refused attempt is charged at its ceiling: body bytes + 1,000 input, 2,000 output.
    const bytes = Buffer.byteLength(JSON.stringify(seen[0]?.body));
    expect(record.usage).toEqual({ input_tokens: bytes + 1000 + 7000, output_tokens: 2000 + 700 });
  });

  it("the failure names the provider's error status, never its message or a key", async () => {
    const { createGuard } = await load('bounds.mjs');
    const guard = createGuard({
      fetch: async () =>
        new Response(
          JSON.stringify({
            error: { code: 404, status: 'NOT_FOUND', message: 'no longer available; provider-test-key' },
          }),
          { status: 404 },
        ),
    });
    const error = await guard.post(ENDPOINT, {}, {}).catch((e: Error) => e);
    expect(error).toMatchObject({ code: 'provider_failed', status: 404, reason: 'NOT_FOUND' });
    expect(error.message).toBe('The model request failed (404 NOT_FOUND).');
    // A value that is not a short error name is dropped.
    const odd = createGuard({
      fetch: async () =>
        new Response(JSON.stringify({ error: { status: 'provider-test-key-123' } }), { status: 400 }),
    });
    const plain = await odd.post(ENDPOINT, {}, {}).catch((e: Error) => e);
    expect(plain.message).toBe('The model request failed (400).');
  });
});
