// A receipt newer than the installed packages can check (Sess founder 2026-11-17 16:02Z item 4b):
// @sess.si/sdk 0.4.0 throws kind `receipt_newer`, code `RECEIPT_NEWER` for a later receipt `typ` or
// a revision envelope above `sess_revision: 2`. The rule: a newer receipt releases no verified data
// and is never reported as a verification failure.
import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PLUGIN_VERSION } from '../../src/doctor.js';
import { ERROR_CLASSES } from '../../src/errors.js';
import { receiptNewerMessage } from '../../src/tools.js';
import {
  API_KEY,
  API_KEY_ENV,
  FakeSess,
  call,
  conversation,
  fixtures,
  recordRow,
  registerPlugin,
} from './harness.js';

/** While set, replaces every plugin client's receipts.verifyResponse (the real SDK otherwise). */
const hook = vi.hoisted(() => ({ verify: undefined as undefined | (() => Promise<never>) }));
vi.mock('@sess.si/sdk', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@sess.si/sdk')>();
  // The real client is frozen, so the plugin gets a view of it whose receipts resource differs.
  function Sess(...args: ConstructorParameters<typeof actual.Sess>) {
    const real = new actual.Sess(...args);
    return Object.freeze({
      sessions: real.sessions,
      asks: real.asks,
      webhooks: real.webhooks,
      receipts: Object.freeze({
        ...real.receipts,
        verifyResponse: (...input: Parameters<typeof real.receipts.verifyResponse>) =>
          hook.verify ? hook.verify() : real.receipts.verifyResponse(...input),
      }),
      ask: real.ask.bind(real),
    });
  }
  return { ...actual, Sess };
});

const sdk = await import('@sess.si/sdk');
/** Exactly what @sess.si/sdk 0.4.0 throws (src/receipts/json.ts, newerReceiptError). */
const sdkNewer = () =>
  new sdk.SessError(
    // The 0.3.0 pin's SessErrorKind does not name it yet; the plugin reads kind and code as strings.
    'receipt_newer' as never,
    'This receipt is newer than @sess.si/sdk 0.4.0. Update @sess.si/sdk to check it. No answer data was returned.',
    { code: 'RECEIPT_NEWER' },
  );
const newer = async (): Promise<never> => {
  throw sdkNewer();
};

const installedSdk = (
  JSON.parse(
    readFileSync(new URL('../../node_modules/@sess.si/sdk/package.json', import.meta.url), 'utf8'),
  ) as { version: string }
).version;
const [sdkMajor, sdkMinor] = installedSdk.split('.').map(Number) as [number, number];
/** @sess.si/sdk 0.4.0 is the first SDK that reports a later receipt type as newer. */
const sdkReadsNewer = sdkMajor > 0 || sdkMinor >= 4;

const NEWER_LINE = `This receipt is newer than @sess.si/openclaw ${PLUGIN_VERSION}. Update @sess.si/openclaw to check it. No answer data was returned.`;

let sess: FakeSess;
beforeEach(() => {
  sess = new FakeSess();
  vi.stubGlobal('fetch', sess.fetch);
  vi.stubEnv(API_KEY_ENV, API_KEY);
  hook.verify = undefined;
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  hook.verify = undefined;
});

const writes = () => sess.requests.filter((r) => r.method !== 'GET');

async function started() {
  const host = await registerPlugin();
  const conv = conversation();
  const { handle } = (await call(host, 'sess_request', conv, { interaction: fixtures('round-1.json') }))
    .details.interaction;
  return { host, conv, handle: handle as string };
}

/** The newer tool error and nothing else: no answer data, event or verification claim. */
function expectNewer(error: any): void {
  expect(error.code).toBe('RECEIPT_NEWER');
  expect(error.errorClass).toBe('configuration');
  expect(error.message).toBe(`RECEIPT_NEWER: ${NEWER_LINE}`);
  expect(error.field).toBeUndefined();
  const shown = JSON.stringify(error);
  for (const absent of ['museum', 'evt_', 'VERIFICATION_FAILED', 'verified'])
    expect(shown).not.toContain(absent);
}

describe('a receipt newer than this plugin (RECEIPT_NEWER)', () => {
  it('the message is the signed line with this package and version; the class is configuration', () => {
    expect(receiptNewerMessage()).toBe(NEWER_LINE);
    const manifest = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8'));
    expect(NEWER_LINE).toContain(
      `newer than @sess.si/openclaw ${manifest.version}. Update @sess.si/openclaw`,
    );
    expect(ERROR_CLASSES.RECEIPT_NEWER).toBe('configuration');
  });

  it.each([
    ['a read (wait_ms 0)', 0],
    ['a bounded wait', 500],
  ] as const)(
    'sess_response, %s: releases nothing, records nothing, never blocks; updated, the same handle answers',
    async (_label, waitMs) => {
      const { host, conv, handle } = await started();
      const eventId = sess.answer(1, 'submit', { activity: 'museum', hours: 3 });
      const before = JSON.stringify(recordRow(host, handle));
      const writesBefore = writes().length;
      hook.verify = newer;
      for (let attempt = 0; attempt < 2; attempt++) {
        const error = await call(host, 'sess_response', conv, { handle, revision: 1, wait_ms: waitMs }).catch(
          (e) => e,
        );
        expectNewer(error);
      }
      // No state change and nothing recorded: not blocked, no answer saved, nothing sent.
      expect(JSON.stringify(recordRow(host, handle))).toBe(before);
      expect(recordRow(host, handle).state).not.toBe('blocked');
      expect(writes().length).toBe(writesBefore);
      // Nothing released means nothing to continue from: complete refuses and sends nothing.
      await expect(
        call(host, 'sess_complete', conv, { handle, expected_revision: 1, response_event_id: eventId }),
      ).rejects.toThrow();
      expect(writes().length).toBe(writesBefore);

      // The plugin is updated (the real SDK verifier checks this answer): the same handle releases it.
      hook.verify = undefined;
      const ok = await call(host, 'sess_response', conv, { handle, revision: 1, wait_ms: 0 });
      expect(ok.details.interaction).toMatchObject({
        state: 'answered',
        response: { eventId, data: { activity: 'museum', hours: 3 }, verified: true },
      });
    },
  );

  it.each(['sess_publish', 'sess_complete'] as const)(
    '%s: the re-verification before advancing is newer: nothing is sent, the answer stays answered',
    async (tool) => {
      const { host, conv, handle } = await started();
      const eventId = sess.answer(1, 'submit', { activity: 'museum', hours: 3 });
      await call(host, 'sess_response', conv, { handle, revision: 1, wait_ms: 0 });
      const before = JSON.stringify(recordRow(host, handle));
      const writesBefore = writes().length;
      hook.verify = newer;
      const args = {
        handle,
        expected_revision: 1,
        response_event_id: eventId,
        ...(tool === 'sess_publish' ? { interaction: fixtures('round-2.json') } : {}),
      };
      expectNewer(await call(host, tool, conv, args).catch((e) => e));
      expect(writes().length).toBe(writesBefore);
      expect(JSON.stringify(recordRow(host, handle))).toBe(before);
      expect(recordRow(host, handle).state).toBe('answered');
      // Updated, the same call proceeds.
      hook.verify = undefined;
      const done = await call(host, tool, conv, args);
      expect(done.details.interaction.state).toBe(tool === 'sess_publish' ? 'waiting' : 'completed');
    },
  );

  it.runIf(sdkReadsNewer)(
    `a genuinely signed receipt of a later Sess type, through the real SDK (installed ${installedSdk}), is newer and releases nothing`,
    async () => {
      const { host, conv, handle } = await started();
      sess.answer(1, 'submit', { activity: 'museum', hours: 3 }, { typ: 'sess-receipt-3+jwt' });
      const before = JSON.stringify(recordRow(host, handle));
      expectNewer(
        await call(host, 'sess_response', conv, { handle, revision: 1, wait_ms: 0 }).catch((e) => e),
      );
      expect(JSON.stringify(recordRow(host, handle))).toBe(before);
    },
  );
});
