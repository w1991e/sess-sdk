// `sess verify <file>` for Sess L-151 (receipt car 8): a decision bundle, a closing receipt and a
// kept file (keep-v1 to keep-v4), checked with the SDK's own verifiers, from keys given in a file
// or fetched once from the issuer's published key set. Runs the command in process with an
// injected fetch, so every request it makes is recorded; the subprocess harness in cli.test.ts
// proves the real executable makes no other network call.
import { mkdtemp, open, rm, stat, truncate, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { runCli, EXIT } from '../../src/cli/verify.js';
import { MAX_KEPT_FILE_BYTES } from '../../src/cli/kept.js';
import {
  CORPUS_ISSUER,
  CORPUS_NOW,
  corpusPublicJwks,
  corpusTrustedKeys,
} from '../fixtures/bundle/corpus-vectors.js';
import { bundleOf, closingReceipt, keptFile, roundReceipt } from '../fixtures/kept.js';

let dir: string;
let keysFile: string;
let currentOnlyKeys: string;

interface Call {
  url: string;
  init: RequestInit;
}
interface Result {
  code: number;
  stdout: string;
  stderr: string;
  calls: Call[];
}

const jsonResponse = (body: unknown, status = 200) =>
  new Response(typeof body === 'string' ? body : JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });

async function sess(
  args: string[],
  respond?: (url: string) => Response | Promise<Response>,
): Promise<Result> {
  let stdout = '';
  let stderr = '';
  const calls: Call[] = [];
  const code = await runCli(args, {
    stdout: (t) => (stdout += t),
    stderr: (t) => (stderr += t),
    fetch: async (url, init) => {
      calls.push({ url, init });
      if (!respond) throw new Error('no network in this test');
      return respond(url);
    },
  });
  return { code, stdout, stderr, calls };
}

async function write(name: string, value: unknown): Promise<string> {
  const file = join(dir, name);
  await writeFile(
    file,
    typeof value === 'string' || value instanceof Uint8Array ? value : JSON.stringify(value),
  );
  return file;
}

const withKeys = (file: string, extra: string[] = []) => [
  'verify',
  file,
  '--issuer',
  CORPUS_ISSUER,
  '--keys',
  keysFile,
  ...extra,
];
const firstLine = (r: Result) => r.stdout.split('\n')[0];

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), 'sess-cli-receipts-'));
  keysFile = join(dir, 'keys.json');
  await writeFile(keysFile, JSON.stringify(corpusTrustedKeys()));
  currentOnlyKeys = join(dir, 'current-only.json');
  await writeFile(currentOnlyKeys, JSON.stringify({ keys: corpusPublicJwks('current').slice(0, 1) }));
});

afterAll(async () => {
  if (dir) await rm(dir, { recursive: true, force: true });
});

describe('sess verify: a kept file', () => {
  it('verifies every answer of keep-v1, keep-v2 and keep-v3 files from keys in a file, fetching nothing', async () => {
    const v1 = [await roundReceipt(1), await roundReceipt(2)];
    const v2 = [await roundReceipt(1, { v2: true }), await roundReceipt(2)];
    const files = [
      await write(
        'keep-v1.json',
        keptFile(
          1,
          v1.map((receipt) => ({ receipt })),
        ),
      ),
      await write('keep-v2.json', keptFile(2, [{ receipt: v2[0]!, v2: true }, { receipt: v2[1]! }])),
      await write('keep-v3.json', keptFile(3, [{ receipt: v2[0]!, v2: true }, { receipt: v2[1]! }])),
    ];
    for (const file of files) {
      const r = await sess(withKeys(file));
      expect([r.code, r.stderr, r.calls.length], file).toEqual([EXIT.valid, '', 0]);
      expect(firstLine(r)).toBe('Verified: a kept file with 2 answers, each checked.');
      expect(r.stdout).toContain('Closing     this file carries no closing receipt');
      expect(r.stdout).toContain(`Keys        from ${keysFile}; nothing was fetched`);
      expect(r.stdout).toContain('Checked at  each answer (when Sess says it was signed)');
      expect(r.stdout).toContain("Not checked the file's archival records, holder keys and witness evidence");
      const json = JSON.parse((await sess([...withKeys(file), '--json'])).stdout);
      expect([json.kind, json.status, json.rounds.map((x: { status: string }) => x.status)]).toEqual([
        'kept_file',
        'verified',
        ['verified', 'verified'],
      ]);
    }
  });

  it('checks a keep-v4 closing receipt against exactly the answers in the file, in order', async () => {
    const rounds = [await roundReceipt(1), await roundReceipt(2, { v2: true }), await roundReceipt(3)];
    const kept = (list: string[], closing: string | null) =>
      keptFile(
        4,
        list.map((receipt) => ({ receipt, v2: receipt === rounds[1] })),
        closing,
      );
    const closing = await closingReceipt(rounds);
    const complete = await sess(withKeys(await write('v4-complete.json', kept(rounds, closing))));
    expect([complete.code, firstLine(complete)]).toEqual([
      EXIT.valid,
      'Verified: a kept file with 3 answers, each checked.',
    ]);
    expect(complete.stdout).toContain('Closing     the closing receipt covers exactly these 3 answers');

    const none = await sess(withKeys(await write('v4-none.json', kept(rounds, null))));
    expect(none.code).toBe(EXIT.valid);
    expect(none.stdout).toContain('Closing     this file carries no closing receipt');

    // Reordered, one dropped, one duplicated: the signed set is not these answers.
    const wrong = [
      [rounds[1]!, rounds[0]!, rounds[2]!],
      [rounds[0]!, rounds[2]!],
      [rounds[0]!, rounds[1]!, rounds[2]!, rounds[2]!],
    ];
    for (const [i, list] of wrong.entries()) {
      const r = await sess(withKeys(await write(`v4-wrong-${i}.json`, kept(list, closing))));
      expect(r.code, String(i)).toBe(EXIT.invalid);
      expect(firstLine(r)).toBe(
        'Unverified. The closing receipt does not cover exactly the answers in this file.',
      );
      expect(r.stdout).toContain('Closing     unverified: rounds');
    }
    // A closing receipt signed by a key the caller does not hold.
    const stranger = await closingReceipt(rounds, 'retired');
    const r = await sess(withKeys(await write('v4-stranger.json', kept(rounds, stranger))));
    expect([r.code, r.stdout.includes('Closing     unverified: unknown_kid')]).toEqual([EXIT.invalid, true]);
  });

  it('reports answers with no content as not checked, with their own exit code, never as verified', async () => {
    const rounds = [await roundReceipt(1), await roundReceipt(2), await roundReceipt(3)];
    const file = await write(
      'v4-partial.json',
      keptFile(
        4,
        [{ receipt: rounds[0]! }, { receipt: rounds[1]!, content: false }, { receipt: rounds[2]! }],
        await closingReceipt(rounds),
      ),
    );
    const r = await sess(withKeys(file));
    expect([r.code, r.stderr]).toEqual([EXIT.notAllChecked, '']);
    expect(EXIT.notAllChecked).not.toBe(EXIT.invalid);
    expect(firstLine(r)).toBe(
      'Not everything was checked. 1 of 3 answers have no content in this file, so they were not checked. Nothing failed.',
    );
    expect(r.stdout).not.toMatch(/^Verified/m);
    expect(r.stdout).toContain('Answer 2    not checked: this file holds no content for it');
    const json = JSON.parse((await sess([...withKeys(file), '--json'])).stdout);
    expect([json.status, json.rounds[1].status, json.rounds[1].result]).toEqual([
      'not_all_checked',
      'not_checked',
      null,
    ]);
    // A failure elsewhere still wins: something checked failed.
    const tampered = await write(
      'v1-partial-failed.json',
      keptFile(1, [
        { receipt: rounds[0]!, content: false },
        { receipt: rounds[1]!, bundle: bundleOf(rounds[1]!, false, { approved: false, note: 'x' }) },
      ]),
    );
    const failed = await sess(withKeys(tampered));
    expect([failed.code, firstLine(failed)]).toEqual([
      EXIT.invalid,
      'Unverified. Answer 2 of 2: The disclosed input is not the one the receipt signed.',
    ]);
  });

  it('refuses a round whose bundle is not its own receipt, a member outside the format, and reports a later version as newer', async () => {
    const a = await roundReceipt(1);
    const b = await roundReceipt(2);
    const swapped = await sess(
      withKeys(await write('swapped.json', keptFile(1, [{ receipt: a, bundle: bundleOf(b) }]))),
    );
    expect([swapped.code, firstLine(swapped)]).toEqual([
      EXIT.invalid,
      'Unverified. This kept file is not in a form this command reads.',
    ]);
    const extra = { ...keptFile(1, [{ receipt: a }]), manifest: [] };
    expect((await sess(withKeys(await write('extra.json', extra)))).code).toBe(EXIT.invalid);
    const v2InV1 = keptFile(1, [{ receipt: await roundReceipt(1, { v2: true }), v2: true }]);
    expect((await sess(withKeys(await write('v2-in-v1.json', v2InV1)))).code).toBe(EXIT.invalid);
    const newer = await sess(
      withKeys(await write('v5.json', { ...keptFile(4, [{ receipt: a }]), version: 5 })),
    );
    expect([newer.code, newer.calls.length]).toEqual([EXIT.newer, 0]);
    expect(firstLine(newer)).toMatch(
      /^This file is newer than @sess\.si\/sdk .+\. Update @sess\.si\/sdk to check it\.$/,
    );
  });

  it('judges each answer at the time Sess says it signed it, so an answer past its exp still checks; --now overrides', async () => {
    const old = await roundReceipt(1, {
      acceptedAt: new Date('2026-01-01T00:00:00.000Z'),
      expiresAt: new Date('2026-02-01T00:00:00.000Z'),
    });
    const file = await write('old.json', keptFile(1, [{ receipt: old }]));
    const r = await sess(withKeys(file));
    expect(r.code).toBe(EXIT.valid);
    const later = await sess(withKeys(file, ['--now', CORPUS_NOW.toISOString()]));
    expect([later.code, firstLine(later)]).toEqual([
      EXIT.invalid,
      'Unverified. Answer 1 of 1: The receipt had expired at the time it was checked.',
    ]);
    expect(later.stdout).toContain(`Checked at  ${CORPUS_NOW.toISOString()}`);
  });

  it('reads a kept file of exactly the product bound (80 MiB) and refuses one byte more', async () => {
    const text = JSON.stringify(keptFile(1, [{ receipt: await roundReceipt(1) }]));
    const file = join(dir, 'bound.json');
    // JSON allows trailing whitespace: pad the file to the bound without changing its value.
    await writeFile(file, text);
    await truncate(file, MAX_KEPT_FILE_BYTES);
    const zeroes = await open(file, 'r+');
    try {
      await zeroes.write(
        Buffer.alloc(MAX_KEPT_FILE_BYTES - Buffer.byteLength(text), 0x20),
        0,
        undefined,
        Buffer.byteLength(text),
      );
    } finally {
      await zeroes.close();
    }
    expect((await stat(file)).size).toBe(MAX_KEPT_FILE_BYTES);
    const at = await sess(withKeys(file));
    expect([at.code, at.stderr]).toEqual([EXIT.valid, '']);
    await writeFile(file, ' ', { flag: 'a' });
    const over = await sess(withKeys(file));
    expect(over.code).toBe(EXIT.usage);
    expect(over.stderr).toContain(`the file is larger than ${MAX_KEPT_FILE_BYTES} bytes`);
  }, 120_000);
});

describe('sess verify: a closing receipt on its own', () => {
  it('verifies it against the keys and the receipt’s own workspace, reporting the context unchecked', async () => {
    const closing = await closingReceipt([await roundReceipt(1), await roundReceipt(2)]);
    const file = await write('closing.jws', `${closing}\n`);
    const r = await sess(withKeys(file));
    expect([r.code, firstLine(r)]).toEqual([
      EXIT.valid,
      'Verified: how a Session ended, and the answers it counts.',
    ]);
    expect(r.stdout).toContain(
      'Answers     2, signed as the final set; the answers themselves are not in this file',
    );
    expect(r.stdout).toContain('Context     unchecked (no expected context given)');
    const ws = await sess(withKeys(file, ['--workspace', 'wks_corpus', '--session', 'ses_corpus_session_1']));
    expect(ws.stdout).toContain('Context     verified: workspace_id, session_id');
    const other = await sess(withKeys(file, ['--workspace', 'wks_other']));
    expect([other.code, firstLine(other)]).toEqual([
      EXIT.invalid,
      'Unverified. This receipt belongs to another workspace.',
    ]);
    const rotated = await sess(['verify', file, '--issuer', CORPUS_ISSUER, '--keys', currentOnlyKeys]);
    expect(rotated.code).toBe(EXIT.valid);
    const retired = await sess(
      withKeys(await write('closing-retired.jws', await closingReceipt([await roundReceipt(1)], 'retired'))),
    );
    expect([retired.code, firstLine(retired)]).toEqual([
      EXIT.invalid,
      'Unverified. This receipt names a key that is not among the keys used for this check.',
    ]);
  });
});

describe('sess verify: key changes', () => {
  it('checks an answer signed under an older key only while that key is published; otherwise names the unknown key plainly', async () => {
    const previous = await roundReceipt(1, { key: 'previous' });
    const bundle = await write('previous.json', bundleOf(previous));
    // The published set still holds the previous key (rotation overlap): verified.
    const overlap = await sess(['verify', bundle, '--issuer', CORPUS_ISSUER], () =>
      jsonResponse(corpusTrustedKeys()),
    );
    expect([overlap.code, firstLine(overlap)]).toEqual([EXIT.valid, 'Verified: one answer and its content.']);
    expect(overlap.stdout).toContain('(key corpus-previous)');
    // The key is no longer published: the unknown-key reason, never "changed" or "forged".
    const removed = await sess(['verify', bundle, '--issuer', CORPUS_ISSUER], () =>
      jsonResponse({ keys: corpusPublicJwks('current').slice(0, 1) }),
    );
    expect([removed.code, firstLine(removed)]).toEqual([
      EXIT.invalid,
      'Unverified. This receipt names a key that is not among the keys used for this check.',
    ]);
    expect(removed.stdout).toContain('Reason      unknown_kid');
    const kept = await write('kept-previous.json', keptFile(1, [{ receipt: previous }]));
    expect((await sess(['verify', kept, '--issuer', CORPUS_ISSUER, '--keys', currentOnlyKeys])).code).toBe(
      EXIT.invalid,
    );
    expect((await sess(withKeys(kept))).code).toBe(EXIT.valid);
  });
});

describe('sess verify: the published keys', () => {
  it('fetches the issuer’s published key set once, with no credential, cookie or redirect, and nothing else', async () => {
    const file = await write('fetch.json', keptFile(1, [{ receipt: await roundReceipt(1) }]));
    const r = await sess(['verify', file, '--issuer', CORPUS_ISSUER], () =>
      jsonResponse(corpusTrustedKeys()),
    );
    expect([r.code, r.stderr]).toEqual([EXIT.valid, '']);
    expect(r.calls.map((c) => c.url)).toEqual([`${CORPUS_ISSUER}/.well-known/sess-receipt-keys.json`]);
    const init = r.calls[0]!.init;
    expect([init.method, init.redirect, init.credentials, init.referrerPolicy]).toEqual([
      'GET',
      'error',
      'omit',
      'no-referrer',
    ]);
    expect(Object.keys(init.headers as Record<string, string>)).toEqual(['accept']);
    expect(init.body).toBeUndefined();
    expect(r.stdout).toContain(
      `Keys        published at ${CORPUS_ISSUER}/.well-known/sess-receipt-keys.json, fetched once`,
    );
  });

  it('defaults to https://api.sess.si and never takes the issuer from the file', async () => {
    const file = await write('default-issuer.json', bundleOf(await roundReceipt(1)));
    const r = await sess(['verify', file], () => jsonResponse(corpusTrustedKeys()));
    expect(r.calls.map((c) => c.url)).toEqual(['https://api.sess.si/.well-known/sess-receipt-keys.json']);
    expect([r.code, firstLine(r)]).toEqual([EXIT.invalid, 'Unverified. This receipt names another issuer.']);
  });

  it('exits 4 when the keys cannot be fetched or used, and checks nothing', async () => {
    const file = await write('unreachable.json', bundleOf(await roundReceipt(1)));
    const args = ['verify', file, '--issuer', CORPUS_ISSUER];
    const reached =
      "Sess's published keys couldn't be reached, so this receipt wasn't checked. Try again in a moment.";
    const unusable =
      "The keys published at this address aren't a key set this command can use, so this receipt wasn't checked.";
    const cases: Array<[string, () => Response | Promise<Response>, string]> = [
      ['network error', () => Promise.reject(new TypeError('fetch failed')), reached],
      ['server error', () => jsonResponse({ error: 'x' }, 503), reached],
      ['not JSON', () => jsonResponse('keys'), unusable],
      ['extra member', () => jsonResponse({ ...corpusTrustedKeys(), history: [] }), unusable],
      [
        'private key',
        () => jsonResponse({ keys: [{ ...corpusPublicJwks('current')[0], d: 'AAAA' }] }),
        unusable,
      ],
      ['oversized', () => jsonResponse(' '.repeat(256 * 1024 + 1)), unusable],
    ];
    for (const [label, respond, line] of cases) {
      const r = await sess(args, respond);
      expect([r.code, firstLine(r)], label).toEqual([EXIT.keysUnavailable, line]);
      expect(r.calls.length, label).toBe(1);
      const json = await sess([...args, '--json'], respond);
      expect(JSON.parse(json.stdout).valid, label).toBe(false);
    }
  });

  it('refuses an issuer that is not an https origin when it would fetch, and never fetches for a file it refuses', async () => {
    const file = await write('http-issuer.json', bundleOf(await roundReceipt(1)));
    for (const issuer of [
      'http://receipts.corpus.sess.test',
      'https://receipts.corpus.sess.test/',
      'https://u:p@x.test',
      'x',
    ]) {
      const r = await sess(['verify', file, '--issuer', issuer], () => jsonResponse(corpusTrustedKeys()));
      expect([r.code, r.calls.length], issuer).toEqual([EXIT.usage, 0]);
    }
    expect(
      (await sess(['verify', join(dir, 'absent.json')], () => jsonResponse(corpusTrustedKeys()))).calls,
    ).toEqual([]);
  });
});

describe('sess verify: what it does not read', () => {
  it('refuses a PDF, a receipt code, a lone round receipt and per-answer options on a whole file, plainly and without fetching', async () => {
    const round = await roundReceipt(1);
    const cases: Array<[string, string | Uint8Array, string[], string]> = [
      [
        'receipt.pdf',
        Buffer.from('%PDF-1.7\n%âã\n'),
        [],
        'sess: this file is a PDF, and this command does not read PDFs: check the kept file (.json) instead',
      ],
      [
        'code.txt',
        `https://sess.si/verify#${'A'.repeat(400)}\n`,
        [],
        'sess: this looks like a receipt code from a QR code, and this command does not read receipt codes: check the kept file (.json) instead',
      ],
      ['code-bare.txt', 'Q'.repeat(400), [], 'sess: this looks like a receipt code from a QR code'],
      [
        'round.jws',
        round,
        [],
        "sess: this is one answer's receipt on its own: check it with its content, in its decision bundle or the kept file that holds it",
      ],
      [
        'kept-event.json',
        JSON.stringify(keptFile(1, [{ receipt: round }])),
        ['--event', 'evt_corpus_event_1'],
        'sess: --event, --revision and --action check one answer: use them with a decision bundle',
      ],
    ];
    for (const [name, content, extra, message] of cases) {
      const file = await write(name, content);
      const r = await sess(['verify', file, '--issuer', CORPUS_ISSUER, ...extra], () =>
        jsonResponse(corpusTrustedKeys()),
      );
      expect([r.code, r.stdout, r.calls.length], name).toEqual([EXIT.usage, '', 0]);
      expect(r.stderr.startsWith(message), name).toBe(true);
    }
  });

  it('never prints a receipt, the disclosed content or key material', async () => {
    const rounds = [await roundReceipt(1), await roundReceipt(2)];
    const closing = await closingReceipt(rounds);
    const file = await write(
      'leak.json',
      keptFile(
        4,
        rounds.map((receipt) => ({ receipt })),
        closing,
      ),
    );
    for (const extra of [[], ['--json']]) {
      const r = await sess(['verify', file, '--issuer', CORPUS_ISSUER, ...extra], () =>
        jsonResponse(corpusTrustedKeys()),
      );
      expect(r.code).toBe(EXIT.valid);
      for (const secret of [...rounds, closing, ...rounds.flatMap((x) => x.split('.')), 'Bring water.'])
        expect(r.stdout.includes(secret)).toBe(false);
      for (const k of corpusTrustedKeys().keys) expect(r.stdout.includes(k.x)).toBe(false);
    }
  });
});
