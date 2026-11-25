import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { SessError } from '@sess.si/sdk';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { receiptNewerMessage, stderrDiagnostics } from '../src/errors.js';
import type { SessClient } from '../src/operations.js';
import { createSessMcpServer } from '../src/server.js';
import { classifyVerification } from '../src/internal/shared.js';
import { VERSION } from '../src/version.js';
import { ANSWER_1, FakeSess, ROUND_1, clientFor, env, tempDir } from './helpers.js';

/**
 * A receipt newer than the installed packages can check (Sess founder 2026-11-17 16:02Z item 4b):
 * @sess.si/sdk 0.4.0 throws kind `receipt_newer`, code `RECEIPT_NEWER` for a later receipt `typ`
 * or a revision envelope above `sess_revision: 2`. The rule: a newer receipt releases no verified
 * data and is never reported as a verification failure.
 */
const NEWER_LINE = `This receipt is newer than @sess.si/mcp ${VERSION}. Update @sess.si/mcp to check it. No answer data was returned.`;

/** Exactly what @sess.si/sdk 0.4.0 throws (src/receipts/json.ts, newerReceiptError). */
function sdkNewer(): SessError {
  return new SessError(
    // The 0.3.0 pin's SessErrorKind does not name it yet; the adapter reads kind and code as strings.
    'receipt_newer' as never,
    'This receipt is newer than @sess.si/sdk 0.4.0. Update @sess.si/sdk to check it. No answer data was returned.',
    { code: 'RECEIPT_NEWER' },
  );
}

type Verify = SessClient['receipts']['verifyResponse'];
const newerVerifier: Verify = (async () => {
  throw sdkNewer();
}) as unknown as Verify;

const installedSdk = (
  JSON.parse(
    readFileSync(join(import.meta.dirname, '..', 'node_modules', '@sess.si', 'sdk', 'package.json'), 'utf8'),
  ) as { version: string }
).version;
const [sdkMajor, sdkMinor] = installedSdk.split('.').map(Number) as [number, number];
/** @sess.si/sdk 0.4.0 is the first SDK that reports a later receipt type as newer. */
const sdkReadsNewer = sdkMajor > 0 || sdkMinor >= 4;

let dir: ReturnType<typeof tempDir>;
beforeEach(() => {
  dir = tempDir();
});
afterEach(() => dir.cleanup());

function record(handle: string): any {
  return JSON.parse(readFileSync(join(dir.path, 'profiles', 'default', 'handles', `${handle}.json`), 'utf8'));
}

/**
 * The stdio server over the fake runtime and the real SDK. `state.verify` replaces receipt
 * verification while set; cleared, the real SDK verifier runs (the package "updated").
 */
async function connect(fake: FakeSess, state: { verify?: Verify }, lines: string[] = []) {
  let secrets: () => readonly string[] = () => [];
  const created = createSessMcpServer({
    env: env(dir.path),
    createClient: (config) => {
      const real = clientFor(fake)(config);
      const verifyResponse = ((input, options) =>
        (state.verify ?? real.receipts.verifyResponse)(input, options)) as Verify;
      return { ...real, receipts: { verifyResponse } };
    },
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
  return { client, lines };
}
const call = (client: Client, name: string, args: Record<string, unknown>) =>
  client.callTool({ name, arguments: args }) as Promise<{
    isError?: boolean;
    content: { type: string; text: string }[];
    structuredContent?: any;
  }>;

/** The whole tool result for a newer receipt: the error, and nothing else. */
function expectNewer(result: Awaited<ReturnType<typeof call>>): void {
  expect(result.isError).toBe(true);
  expect(result.structuredContent).toBeUndefined();
  expect(result.content).toHaveLength(1);
  expect(result.content[0]!.text).toBe(
    JSON.stringify({ error: { code: 'RECEIPT_NEWER', message: NEWER_LINE, retryable: false } }),
  );
  // No answer data, event, action or verification claim reaches the agent.
  for (const absent of ['museum', 'evt_', 'submit', 'verified', 'VERIFICATION_FAILED'])
    expect(result.content[0]!.text).not.toContain(absent);
}

describe('a receipt newer than this package (RECEIPT_NEWER)', () => {
  it('the message is the signed line with this package and version', () => {
    expect(receiptNewerMessage()).toBe(NEWER_LINE);
    const manifest = JSON.parse(readFileSync(join(import.meta.dirname, '..', 'package.json'), 'utf8'));
    expect(NEWER_LINE).toContain(`newer than @sess.si/mcp ${manifest.version}. Update @sess.si/mcp`);
  });

  it('the shared core classifies the SDK’s receipt_newer as newer, never as a genuine failure', () => {
    expect(classifyVerification(sdkNewer())).toBe('newer');
    expect(classifyVerification({ kind: 'receipt_newer' })).toBe('newer');
    expect(
      classifyVerification(new SessError('receipt_verification', 'x', { code: 'INVALID_SIGNATURE' })),
    ).toBe('genuine');
  });

  it.each([
    ['a read (wait_ms 0)', { wait_ms: 0 }],
    ['a bounded wait', {}],
  ] as const)(
    'sess_response, %s: releases nothing, records nothing, never blocks; updated, the same handle answers',
    async (_label, wait) => {
      const fake = new FakeSess();
      const state: { verify?: Verify } = { verify: newerVerifier };
      const lines: string[] = [];
      const { client } = await connect(fake, state, lines);
      const created = await call(client, 'sess_request', { interaction: ROUND_1 });
      const { handle } = created.structuredContent.interaction;
      const eventId = fake.answerSigned(ANSWER_1.data, ANSWER_1.action_id);
      const before = JSON.stringify(record(handle));

      expectNewer(await call(client, 'sess_response', { handle, revision: 1, ...wait }));
      // Nothing recorded and no state change: the handle is still waiting, with no answer saved.
      expect(JSON.stringify(record(handle))).toBe(before);
      expect(record(handle).state).toBe('waiting');
      expect(record(handle).answer).toBeUndefined();
      // Repeating it is the same newer result, never a block or a verification failure.
      expectNewer(await call(client, 'sess_response', { handle, revision: 1, ...wait }));
      expect(record(handle).state).toBe('waiting');
      // Nothing released means nothing to continue from: complete refuses and sends nothing.
      const complete = await call(client, 'sess_complete', {
        handle,
        expected_revision: 1,
        response_event_id: eventId,
      });
      expect(complete.isError).toBe(true);
      expect(complete.content[0]!.text).not.toContain('museum');
      expect(fake.calls.some((c) => c.path.endsWith('/complete'))).toBe(false);
      expect(fake.calls.filter((c) => c.method === 'PATCH')).toHaveLength(0);
      const diagnostics = lines.join('');
      expect(diagnostics).toContain('sess-mcp: receipt_newer code=receipt_newer/RECEIPT_NEWER');
      expect(diagnostics).not.toContain('verification_failed');
      expect(diagnostics).not.toContain('blocked');
      expect(diagnostics).not.toContain('answered');

      // The package is updated (the real SDK verifier checks this answer): the same handle releases it.
      delete state.verify;
      const answered = await call(client, 'sess_response', { handle, revision: 1, ...wait });
      expect(answered.isError).toBeFalsy();
      expect(answered.structuredContent.interaction).toMatchObject({
        state: 'answered',
        response: { eventId, data: ANSWER_1.data, verified: true, actorAssurance: 'link_holder' },
      });
    },
  );

  it.runIf(sdkReadsNewer)(
    `a genuinely signed receipt of a later Sess type, through the real SDK (installed ${installedSdk}), is newer and releases nothing`,
    async () => {
      const fake = new FakeSess();
      const lines: string[] = [];
      const { client } = await connect(fake, {}, lines);
      const { handle } = (await call(client, 'sess_request', { interaction: ROUND_1 })).structuredContent
        .interaction;
      fake.answerSigned(ANSWER_1.data, ANSWER_1.action_id, { typ: 'sess-receipt-3+jwt' });
      const before = JSON.stringify(record(handle));
      expectNewer(await call(client, 'sess_response', { handle, revision: 1, wait_ms: 0 }));
      expectNewer(await call(client, 'sess_response', { handle, revision: 1 }));
      expect(JSON.stringify(record(handle))).toBe(before);
      expect(lines.join('')).toContain('receipt_newer code=receipt_newer/RECEIPT_NEWER');
      expect(lines.join('')).not.toContain('verification_failed');
    },
  );
});
