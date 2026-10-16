import { describe, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';
import * as ts from 'typescript';
import { Sess } from '@sess.si/sdk';
import { createFakeRuntime, FAKE_LINK } from '../fixtures/fake-runtime.mjs';
import { API_KEY } from '../fixtures/api.js';
import { readmeExamples } from '../../scripts/readme-examples.mjs';

async function firstBlock() {
  const readme = await readFile(new URL('../../README.md', import.meta.url), 'utf8');
  const { first, ask } = readmeExamples(readme);
  return { first, marked: ask };
}

describe('README first code block', () => {
  it('is found identically in an LF and a CRLF copy of the README (Windows checkouts and packs)', async () => {
    const lf = await readFile(new URL('../../README.md', import.meta.url), 'utf8');
    const crlf = lf.replace(/\r?\n/g, '\r\n');
    const a = readmeExamples(lf);
    const b = readmeExamples(crlf);
    expect(a.ask).toBeTruthy();
    expect(a.first).toBe(a.ask);
    expect(b).toEqual(a);
  });

  it('is the question example and fits in twelve lines', async () => {
    const { first, marked } = await firstBlock();
    expect(marked).toBeTruthy();
    expect(first).toBe(marked);
    expect(marked!.split('\n').length).toBeLessThanOrEqual(12);
    expect(marked).toContain('sess.ask(');
    expect(marked).not.toMatch(/mode|source|revision|ifMatch|idempotencyKey|receipt/);
  });

  it('delivers the link before waiting, then uses the verified typed answer', async () => {
    const source = (await firstBlock()).marked!.replace(
      /^import \{ Sess \} from .@sess\.si\/sdk.;\r?\n/m,
      '',
    );
    const compiled = ts.transpileModule(source, {
      compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
    }).outputText;
    const runtime = createFakeRuntime({ autoAnswer: { approved: true, amount: 12.5 } });
    class ExampleSess extends Sess {
      constructor(options: ConstructorParameters<typeof Sess>[0]) {
        super({ ...options, fetch: runtime.fetch });
      }
    }
    const lines: { text: string; reads: number }[] = [];
    const output = { log: (text: string) => lines.push({ text, reads: runtime.counts.retrieve }) };
    const execute = new Function('Sess', 'process', 'console', `return (async () => { ${compiled}\n})()`) as (
      SDK: typeof Sess,
      context: { env: Record<string, string> },
      out: typeof output,
    ) => Promise<void>;
    await execute(ExampleSess, { env: { SESS_API_KEY: API_KEY } }, output);
    expect(lines).toEqual([
      { text: `Send this private link to the person: ${FAKE_LINK}`, reads: 0 },
      { text: 'Refund of 12.50 approved.', reads: 3 },
    ]);
    expect(runtime.counts).toMatchObject({ create: 1, complete: 1 });
    expect(runtime.session()!.status).toBe('completed');
  });
});
