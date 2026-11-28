// `sess verify <file.pdf>` for Sess L-196: a receipt PDF from Sess is checked by the kept file it
// carries, read by the Sess profile's own bounded extractor (src/receipts/pdf-extract.ts, copied
// from the Sess runtime), never by its pages. The PDFs in tests/fixtures/receipt-pdf were made by
// the Sess exporter from its gallery cases, with test-only keys (their public keys beside them);
// adversarial.ts is the Sess runtime's own crafted-PDF builder. Fixtures only.
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { EXIT, runCli } from '../../src/cli/verify.js';
import { extractReceiptPdfRecord } from '../../src/receipts/pdf-extract.js';
import { RECEIPT_PDF_BOUNDS } from '../../src/receipts/pdf-profile.js';
import {
  classicPdf,
  cyclicPdf,
  deepPdf,
  flatArrayPdf,
  manyReferencesPdf,
  oneLeafPdf,
  overlappingPdf,
  repeatedChildPdf,
  sharedArrayPdf,
  widePdf,
} from '../fixtures/receipt-pdf/adversarial.js';

const FIXTURES = new URL('../fixtures/receipt-pdf/', import.meta.url);
const ISSUER = 'https://api.sess.test';
/** The Sess runtime commit the extractor and the adversarial builder were copied from. */
const SESS_COMMIT = 'afb541341db1a4989b114e18364037be6cccada4';
const SESS_EXTRACT_SHA256 = 'fbcbe05d78d41bee3cb17826325446615dd2a405bbd57fc1d20e7364483a60a1';
const SESS_ADVERSARIAL_SHA256 = '63f7426041d20c04dba98c5af683ed74bc082eda49012616da5af42cd3a432a8';

// The signed lines (Sess L-196, 2026-11-28 18:41Z): one refusal for any PDF the profile cannot
// read, a PDF with no receipt or more than one included (exactly one is the rule), and one for size.
const PDF_UNREADABLE = "sess: this PDF can't be read as a Sess receipt, so it was not checked";
const PDF_TOO_LARGE = 'sess: this PDF is larger than a Sess receipt PDF can be, so it was not read';

let dir: string;
const sha256 = (b: Uint8Array | string) => createHash('sha256').update(b).digest('hex');
const fixture = (name: string) => readFile(new URL(name, FIXTURES));

interface Result {
  code: number;
  stdout: string;
  stderr: string;
  fetched: string[];
}
async function sess(args: string[]): Promise<Result> {
  let stdout = '';
  let stderr = '';
  const fetched: string[] = [];
  const code = await runCli(args, {
    stdout: (t) => (stdout += t),
    stderr: (t) => (stderr += t),
    fetch: async (url) => {
      fetched.push(url);
      throw new Error('no network in this test');
    },
    // One fixed clock, so a file and its PDF are checked at the same time.
    clock: () => Date.parse('2026-11-01T00:00:00Z'),
  });
  return { code, stdout, stderr, fetched };
}
async function write(name: string, bytes: Uint8Array | string): Promise<string> {
  const file = join(dir, name);
  await writeFile(file, bytes);
  return file;
}
const verifyArgs = (file: string, keys: string) => ['verify', file, '--issuer', ISSUER, '--keys', keys];

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), 'sess-receipt-pdf-'));
});
afterAll(async () => {
  if (dir) await rm(dir, { recursive: true, force: true });
});

describe('the receipt PDF extractor: the Sess profile, copied', () => {
  it('is the Sess runtime’s extractor and crafted-PDF builder at the recorded commit, changed only in its import line', async () => {
    const extract = await readFile(new URL('../../src/receipts/pdf-extract.ts', import.meta.url), 'utf8');
    const asInSess = extract.replace("} from './pdf-profile.js';", "} from './profile.ts';");
    expect(asInSess).not.toBe(extract);
    expect(sha256(asInSess), `packages/evidence/src/receipt-pdf/extract.ts at ${SESS_COMMIT}`).toBe(
      SESS_EXTRACT_SHA256,
    );
    expect(sha256(await fixture('adversarial.ts')), 'receipt-pdf-adversarial.ts').toBe(
      SESS_ADVERSARIAL_SHA256,
    );
    // The profile's values (packages/evidence/src/receipt-pdf/profile.ts at that commit).
    expect(RECEIPT_PDF_BOUNDS).toEqual({
      pdfMaxBytes: 24 * 1_048_576,
      attachmentMaxBytes: 16 * 1_048_576,
      bundleMaxBytes: 1_048_576,
      maxRounds: 64,
      maxPages: 400,
      maxObjects: 50_000,
      maxXrefSections: 16,
      maxNesting: 32,
      maxTokens: 2_000_000,
    });
  });

  it('reads the one embedded kept file of a real Sess receipt PDF, byte for byte, and refuses every other shape with its reason', async () => {
    for (const name of ['short-approve-ended', 'invoices-strings']) {
      const r = extractReceiptPdfRecord(await fixture(`${name}.pdf`));
      expect(r.ok, name).toBe(true);
      if (r.ok) expect(JSON.parse(r.text).type, name).toMatch(/^sess\.kept-conversation/);
    }
    expect(extractReceiptPdfRecord(oneLeafPdf())).toEqual({ ok: true, text: '{}' });
    // Not a PDF of the profile's version line, or too short to be one.
    expect(extractReceiptPdfRecord(new TextEncoder().encode('%PDF-1.7\n'))).toEqual({
      ok: false,
      reason: 'not_pdf',
    });
    // No associated Data file: nothing to read.
    const none = classicPdf('1 0 obj\n<< /Type /Catalog >>\nendobj\n', [1]);
    expect(extractReceiptPdfRecord(none)).toEqual({ ok: false, reason: 'no_record' });
    // Two Data files of the receipt's name: ambiguous, never a guess.
    const two = classicPdf(
      '1 0 obj\n<< /Type /Catalog /AF [2 0 R 2 0 R] >>\nendobj\n' +
        '2 0 obj\n<< /Type /Filespec /F (sess-kept-conversation.json) /AFRelationship /Data /EF << /F 3 0 R >> >>\nendobj\n' +
        '3 0 obj\n<< /Type /EmbeddedFile /Subtype /application#2Fjson /Length 2 >>\nstream\n{}\nendstream\nendobj\n',
      [1, 2, 3],
    );
    expect(extractReceiptPdfRecord(two)).toEqual({ ok: false, reason: 'ambiguous_record' });
    // A compressed attachment is outside the profile: nothing is ever decompressed.
    const filtered = classicPdf(
      '1 0 obj\n<< /Type /Catalog /AF [2 0 R] >>\nendobj\n' +
        '2 0 obj\n<< /Type /Filespec /F (sess-kept-conversation.json) /AFRelationship /Data /EF << /F 3 0 R >> >>\nendobj\n' +
        '3 0 obj\n<< /Type /EmbeddedFile /Subtype /application#2Fjson /Filter /FlateDecode /Length 2 >>\nstream\n{}\nendstream\nendobj\n',
      [1, 2, 3],
    );
    expect(extractReceiptPdfRecord(filtered)).toEqual({ ok: false, reason: 'outside_profile' });
    // Truncated: its cross-reference table is gone.
    const real = await fixture('short-approve-ended.pdf');
    expect(extractReceiptPdfRecord(real.subarray(0, real.length - 200)).ok).toBe(false);
    // Past the input bound, read no further.
    expect(extractReceiptPdfRecord(real, { ...RECEIPT_PDF_BOUNDS, pdfMaxBytes: real.length - 1 })).toEqual({
      ok: false,
      reason: 'too_large',
    });
    expect(extractReceiptPdfRecord(real, { ...RECEIPT_PDF_BOUNDS, attachmentMaxBytes: 100 })).toEqual({
      ok: false,
      reason: 'record_too_large',
    });
  });

  it('refuses a cyclic, shared or repeated embedded-files name tree as malformed, and stops deep, wide, overlapping and reference-heavy files at the one work budget, in bounded time', () => {
    const timed = (pdf: Uint8Array) => {
      const t0 = performance.now();
      const result = extractReceiptPdfRecord(pdf);
      return { result, ms: performance.now() - t0 };
    };
    expect(extractReceiptPdfRecord(cyclicPdf('self'))).toEqual({ ok: false, reason: 'malformed' });
    expect(extractReceiptPdfRecord(cyclicPdf('pair'))).toEqual({ ok: false, reason: 'malformed' });
    for (const kind of ['names', 'kids'] as const) {
      const shared = timed(sharedArrayPdf(kind, 1_000, 1_000));
      expect(shared.result).toEqual({ ok: false, reason: 'malformed' });
      expect(shared.ms).toBeLessThan(2_000);
    }
    const repeated = timed(repeatedChildPdf(4095, 10_000));
    expect(repeated.result).toEqual({ ok: false, reason: 'malformed' });
    expect(repeated.ms).toBeLessThan(2_000);
    expect(extractReceiptPdfRecord(deepPdf(20))).toEqual({ ok: true, text: '{}' });
    expect(extractReceiptPdfRecord(deepPdf(40))).toEqual({ ok: false, reason: 'work_exceeded' });
    expect(extractReceiptPdfRecord(widePdf(5_000))).toEqual({ ok: false, reason: 'work_exceeded' });
    for (const pdf of [
      manyReferencesPdf(100_000),
      flatArrayPdf(2_100_000, '1 0 R'),
      overlappingPdf('comment', 4_000, 200),
    ]) {
      const r = timed(pdf);
      expect(r.result).toEqual({ ok: false, reason: 'work_exceeded' });
      expect(r.ms).toBeLessThan(2_000);
    }
  });
});

describe('sess verify: a receipt PDF', () => {
  it('verifies a real Sess receipt PDF exactly as the kept file it carries: the same result, the same words, from the same keys, fetching nothing', async () => {
    for (const name of ['short-approve-ended', 'invoices-strings']) {
      const pdf = await write(`${name}.pdf`, await fixture(`${name}.pdf`));
      const keys = await write(`${name}.keys.json`, await fixture(`${name}.keys.json`));
      const viaPdf = await sess(verifyArgs(pdf, keys));
      expect(viaPdf.code, `${name}: ${viaPdf.stdout}${viaPdf.stderr}`).toBe(EXIT.valid);
      expect(viaPdf.stdout.split('\n')[0]).toMatch(/^Verified: a kept file with 1 answer/);
      expect(viaPdf.fetched).toEqual([]);
      const extracted = extractReceiptPdfRecord(await fixture(`${name}.pdf`));
      if (!extracted.ok) throw new Error(`${name}: ${extracted.reason}`);
      const json = await write(`${name}.json`, extracted.text);
      const viaJson = await sess(verifyArgs(json, keys));
      expect(viaPdf.code).toBe(viaJson.code);
      expect(viaPdf.stdout).toBe(viaJson.stdout);
      const asJson = await sess([...verifyArgs(pdf, keys), '--json']);
      expect(JSON.parse(asJson.stdout)).toEqual(
        JSON.parse((await sess([...verifyArgs(json, keys), '--json'])).stdout),
      );
    }
    // The closing receipt the finished PDF carries is checked too.
    const ended = await sess(
      verifyArgs(
        await write('ended.pdf', await fixture('short-approve-ended.pdf')),
        await write('ended.keys.json', await fixture('short-approve-ended.keys.json')),
      ),
    );
    expect(ended.stdout).toContain('the closing receipt covers exactly these 1 answer');
  });

  it('a receipt PDF whose embedded kept file was changed by one byte is unverified (exit 1); one checked against other keys is unverified too', async () => {
    const bytes = Buffer.from(await fixture('invoices-strings.pdf'));
    const extracted = extractReceiptPdfRecord(bytes);
    if (!extracted.ok) throw new Error(extracted.reason);
    const at = bytes.indexOf(Buffer.from(extracted.text, 'utf8'));
    expect(at).toBeGreaterThan(0);
    // One letter of the round's title, inside the signed content, changed in place: same length.
    const title = extracted.text.indexOf('Approve October invoices');
    expect(title).toBeGreaterThan(0);
    const tampered = Buffer.from(bytes);
    tampered[at + Buffer.byteLength(extracted.text.slice(0, title), 'utf8')] = 'a'.charCodeAt(0);
    const keys = await write('t.keys.json', await fixture('invoices-strings.keys.json'));
    const r = await sess(verifyArgs(await write('tampered.pdf', tampered), keys));
    expect(r.code, r.stdout + r.stderr).toBe(EXIT.invalid);
    expect(r.stdout.split('\n')[0]).toMatch(/^Unverified/);
    // The right file under the wrong keys: never verified.
    const wrong = await sess(
      verifyArgs(
        await write('right.pdf', await fixture('invoices-strings.pdf')),
        await write('wrong.keys.json', await fixture('short-approve-ended.keys.json')),
      ),
    );
    expect(wrong.code).not.toBe(EXIT.valid);
  });

  it('refuses a PDF with no receipt or two (exactly one is the rule), a malformed, cyclic or oversized one, and a non-receipt attachment, each with its signed line (exit 2) and without fetching', async () => {
    const real = Buffer.from(await fixture('short-approve-ended.pdf'));
    const big = Buffer.alloc(RECEIPT_PDF_BOUNDS.pdfMaxBytes + 1, 32);
    big.write('%PDF-1.7\n', 0, 'latin1');
    const cases: Array<[string, Uint8Array, string]> = [
      ['none.pdf', classicPdf('1 0 obj\n<< /Type /Catalog >>\nendobj\n', [1]), PDF_UNREADABLE],
      [
        'two.pdf',
        classicPdf(
          '1 0 obj\n<< /Type /Catalog /AF [2 0 R 2 0 R] >>\nendobj\n' +
            '2 0 obj\n<< /Type /Filespec /F (sess-kept-conversation.json) /AFRelationship /Data /EF << /F 3 0 R >> >>\nendobj\n' +
            '3 0 obj\n<< /Type /EmbeddedFile /Subtype /application#2Fjson /Length 2 >>\nstream\n{}\nendstream\nendobj\n',
          [1, 2, 3],
        ),
        PDF_UNREADABLE,
      ],
      ['truncated.pdf', real.subarray(0, real.length - 200), PDF_UNREADABLE],
      ['cyclic.pdf', cyclicPdf('pair'), PDF_UNREADABLE],
      ['shared.pdf', sharedArrayPdf('kids', 10, 10), PDF_UNREADABLE],
      ['short.pdf', Buffer.from('%PDF-1.7\n%âã\n'), PDF_UNREADABLE],
      ['big.pdf', big, PDF_TOO_LARGE],
      // An attachment of the receipt's name that is not a kept file.
      ['empty-record.pdf', oneLeafPdf(), PDF_UNREADABLE],
    ];
    for (const [name, bytes, message] of cases) {
      const r = await sess(['verify', await write(name, bytes)]);
      expect(r.code, name).toBe(EXIT.usage);
      expect(r.stderr.split('\n')[0], name).toBe(message);
      expect(r.stdout, name).toBe('');
      expect(r.fetched, `${name}: nothing fetched`).toEqual([]);
    }
  });
});

describe('sess verify: the receipt PDF lines, as signed (Sess L-196, 2026-11-28 18:41Z)', () => {
  it('the help, the README, the security note and the changelog say exactly the signed words', async () => {
    const SIGNED_06 =
      "`sess verify` checks a Sess receipt PDF by the kept file it carries. It never reads the PDF's pages, and it refuses anything outside the Sess profile with exit 2.";
    let help = '';
    await runCli(['--help'], { stdout: (s) => (help += s), stderr: () => {} });
    // VR-PDF-05 is the help's last line.
    expect(help.trimEnd().split('\n').at(-1)).toBe(
      'It checks a receipt PDF from Sess. It does not read QR codes.',
    );
    const text = (p: string) => readFile(new URL(`../../${p}`, import.meta.url), 'utf8');
    const flat = (s: string) => s.replace(/\s+/g, ' ');
    expect(flat(await text('README.md'))).toContain(
      'It does not read QR codes, and in a kept file it checks the receipts, not the archival records, holder keys or witness evidence.',
    );
    expect(flat(await text('docs/security.md'))).toContain(`**A receipt PDF.** ${SIGNED_06}`);
    expect(flat(await text('CHANGELOG.md'))).toContain(`- ${SIGNED_06}`);
    for (const p of ['README.md', 'docs/security.md', 'CHANGELOG.md'])
      expect(await text(p), p).not.toMatch(/L-196|placeholder|does not read PDFs/);
  });
});
