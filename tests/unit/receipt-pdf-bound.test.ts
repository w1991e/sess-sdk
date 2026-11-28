// ASTRA-SDK-87-1 (Sess L-196): a file starting `%PDF-` is held to the receipt PDF profile's own
// bound (24 MiB) before it is read: only its first bytes are read to know it is a PDF, and past
// that bound it is refused with the signed VR-PDF-04, "so it was not read", true. A file that is not
// a PDF keeps the kept file's 80 MiB bound. Every read the command makes is counted here: the
// file system module is wrapped, so the bytes asked of each file handle are recorded.
import { mkdtemp, rm, truncate, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const reads = vi.hoisted(() => ({ bytes: 0, allocated: 0 }));
vi.mock('node:fs/promises', async (importOriginal) => {
  const real = await importOriginal<typeof import('node:fs/promises')>();
  return {
    ...real,
    open: async (...args: Parameters<typeof real.open>) => {
      const handle = await real.open(...args);
      const read = handle.read.bind(handle) as (...a: unknown[]) => Promise<{ bytesRead: number }>;
      (handle as unknown as { read: unknown }).read = async (...a: unknown[]) => {
        const buffer = a[0] as Buffer;
        reads.allocated = Math.max(reads.allocated, buffer.length);
        const out = await read(...a);
        reads.bytes += out.bytesRead;
        return out;
      };
      return handle;
    },
  };
});

const { runCli, EXIT } = await import('../../src/cli/verify.js');
const { MAX_KEPT_FILE_BYTES } = await import('../../src/cli/kept.js');
const { RECEIPT_PDF_BOUNDS } = await import('../../src/receipts/pdf-profile.js');

const PDF_TOO_LARGE = 'sess: this PDF is larger than a Sess receipt PDF can be, so it was not read';
let dir: string;

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), 'sess-receipt-pdf-bound-'));
});
afterAll(async () => {
  if (dir) await rm(dir, { recursive: true, force: true });
});
beforeEach(() => {
  reads.bytes = 0;
  reads.allocated = 0;
});

async function sparse(name: string, head: string, size: number): Promise<string> {
  const file = join(dir, name);
  await writeFile(file, head);
  await truncate(file, size);
  return file;
}
async function verify(file: string) {
  let stderr = '';
  const fetched: string[] = [];
  const code = await runCli(['verify', file], {
    stdout: () => {},
    stderr: (t) => (stderr += t),
    fetch: async (url) => {
      fetched.push(url);
      throw new Error('no network in this test');
    },
  });
  return { code, stderr, fetched };
}

describe('sess verify: a PDF past the profile bound is not read (ASTRA-SDK-87-1)', () => {
  it('a 30 MiB file starting %PDF- is refused with VR-PDF-04 after reading only its first bytes, and no buffer of its size is made', async () => {
    const size = 30 * 1_048_576;
    expect(size).toBeGreaterThan(RECEIPT_PDF_BOUNDS.pdfMaxBytes);
    expect(size).toBeLessThan(MAX_KEPT_FILE_BYTES);
    const r = await verify(await sparse('big.pdf', '%PDF-1.7\n', size));
    expect(r.code).toBe(EXIT.usage);
    expect(r.stderr.split('\n')[0]).toBe(PDF_TOO_LARGE);
    expect(r.fetched).toEqual([]);
    // Read: the five bytes that make it a PDF, nothing more.
    expect(reads.bytes).toBeLessThanOrEqual(5);
    expect(reads.allocated).toBeLessThanOrEqual(5);
  });

  it('a PDF at the bound is read whole (and then refused as unreadable, being zeros); a file that is not a PDF just under 80 MiB is still read whole, under the kept file bound', async () => {
    const atBound = await verify(await sparse('at-bound.pdf', '%PDF-1.7\n', RECEIPT_PDF_BOUNDS.pdfMaxBytes));
    expect(atBound.code).toBe(EXIT.usage);
    expect(atBound.stderr.split('\n')[0]).toBe(
      "sess: this PDF can't be read as a Sess receipt, so it was not checked",
    );
    expect(reads.bytes).toBeGreaterThanOrEqual(RECEIPT_PDF_BOUNDS.pdfMaxBytes);
    reads.bytes = 0;
    const size = MAX_KEPT_FILE_BYTES - 1;
    const notPdf = await verify(await sparse('kept.json', '{"not":"a pdf"', size));
    // Read whole under the kept file bound (then judged as what it is: not a kept file).
    expect(notPdf.stderr).not.toContain('the file is larger than');
    expect(notPdf.stderr).not.toContain('PDF');
    expect(reads.bytes).toBeGreaterThanOrEqual(size);
  });
});
