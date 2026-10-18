// S-07: `@sess.si/sdk/qr`. The encoder is a vendored copy of the Sess renderer's (packages/renderer/
// src/qr.ts at w1991e/sess b48e8e7): parity is checked on the same vectors as that repository's
// qr.test.ts, as digests of the module matrices Sess draws. Every drawing (SVG, PNG and terminal, with
// and without colour) is read back with an independent decoder written here from the specification
// (format bits with BCH check, function-module map, unmasking, zig-zag order, block de-interleaving,
// Reed–Solomon syndromes, byte mode), and must decode to exactly the URL given. The SVG must match
// one exact tree, attribute and value grammar (TRY-QR-ALLOWLIST-07), and malicious variants must
// fail it. printQr prints only on an interactive terminal, never in CI or production, and honours
// NO_COLOR and --no-qr. Synthetic links only.
import { createHash } from 'node:crypto';
import { crc32, inflateSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { encodeQr } from '../../src/qr/encoder.js';
import { printQr, QR_HEADING, QR_TITLE, qr } from '../../src/qr/index.js';

const TOKEN = 'AbCdEfGhIjKlMnOpQrStUvWxYz0123456789_-abcde';
const LINKS = [
  `https://sess.si/s/${TOKEN}`,
  `https://sess-preview-abc12.ondigitalocean.app/s/${TOKEN}`,
  `https://example.test/${'x'.repeat(120)}`,
];
const QUIET = 4;

// ---- An independent reader --------------------------------------------------------------------

// Level M block layout per version (data codewords per block), ISO/IEC 18004 Table 9.
const LAYOUT: Record<number, { ecc: number; blocks: number[] }> = {
  1: { ecc: 10, blocks: [16] },
  2: { ecc: 16, blocks: [28] },
  3: { ecc: 26, blocks: [44] },
  4: { ecc: 18, blocks: [32, 32] },
  5: { ecc: 24, blocks: [43, 43] },
  6: { ecc: 16, blocks: [27, 27, 27, 27] },
  7: { ecc: 18, blocks: [31, 31, 31, 31] },
  8: { ecc: 22, blocks: [38, 38, 39, 39] },
  9: { ecc: 22, blocks: [36, 36, 36, 37, 37] },
  10: { ecc: 26, blocks: [43, 43, 43, 43, 44] },
};
const ALIGN: Record<number, number[]> = {
  1: [],
  2: [6, 18],
  3: [6, 22],
  4: [6, 26],
  5: [6, 30],
  6: [6, 34],
  7: [6, 22, 38],
  8: [6, 24, 42],
  9: [6, 26, 46],
  10: [6, 28, 50],
};

function gfMul(a: number, b: number): number {
  let r = 0;
  while (b) {
    if (b & 1) r ^= a;
    a <<= 1;
    if (a & 0x100) a ^= 0x11d;
    b >>= 1;
  }
  return r;
}
const gfPow = (e: number) => {
  let r = 1;
  for (let i = 0; i < e; i++) r = gfMul(r, 2);
  return r;
};

function decode(m: boolean[][]): string {
  const size = m.length;
  const version = (size - 17) / 4;
  const layout = LAYOUT[version];
  if (!layout) throw new Error(`unsupported version ${version}`);
  const at = (x: number, y: number) => m[y]![x]!;
  let bits = 0;
  const place: [number, number][] = [];
  for (let i = 0; i <= 5; i++) place.push([8, i]);
  place.push([8, 7], [8, 8], [7, 8]);
  for (let i = 9; i < 15; i++) place.push([14 - i, 8]);
  place.forEach(([x, y], i) => {
    if (at(x, y)) bits |= 1 << i;
  });
  const format = bits ^ 0x5412;
  let rem = format >> 10;
  for (let i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >> 9) * 0x537);
  if ((((format >> 10) << 10) | rem) !== format) throw new Error('format BCH check failed');
  if (format >> 13 !== 0) throw new Error('not level M');
  const mask = (format >> 10) & 7;
  const fn = Array.from({ length: size }, () => new Array<boolean>(size).fill(false));
  const mark = (x: number, y: number) => {
    if (x >= 0 && y >= 0 && x < size && y < size) fn[y]![x] = true;
  };
  for (const [cx, cy] of [
    [0, 0],
    [size - 8, 0],
    [0, size - 8],
  ] as const)
    for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) mark(cx + x, cy + y);
  for (let i = 0; i < size; i++) {
    mark(6, i);
    mark(i, 6);
  }
  for (let i = 0; i < 9; i++) {
    mark(8, i);
    mark(i, 8);
  }
  for (let i = 0; i < 8; i++) {
    mark(size - 1 - i, 8);
    mark(8, size - 1 - i);
  }
  const al = ALIGN[version]!;
  for (const ax of al)
    for (const ay of al) {
      if (
        (ax === 6 && ay === 6) ||
        (ax === 6 && ay === al[al.length - 1]) ||
        (ay === 6 && ax === al[al.length - 1])
      )
        continue;
      for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) mark(ax + dx, ay + dy);
    }
  if (version >= 7)
    for (let i = 0; i < 6; i++)
      for (let j = 0; j < 3; j++) {
        mark(i, size - 11 + j);
        mark(size - 11 + j, i);
      }
  const masked = (x: number, y: number) => {
    switch (mask) {
      case 0:
        return (x + y) % 2 === 0;
      case 1:
        return y % 2 === 0;
      case 2:
        return x % 3 === 0;
      case 3:
        return (x + y) % 3 === 0;
      case 4:
        return (Math.floor(y / 2) + Math.floor(x / 3)) % 2 === 0;
      case 5:
        return ((x * y) % 2) + ((x * y) % 3) === 0;
      case 6:
        return (((x * y) % 2) + ((x * y) % 3)) % 2 === 0;
      default:
        return (((x + y) % 2) + ((x * y) % 3)) % 2 === 0;
    }
  };
  const stream: number[] = [];
  let upward = true;
  for (let right = size - 1; right > 0; right -= 2) {
    if (right === 6) right = 5;
    for (let k = 0; k < size; k++) {
      const y = upward ? size - 1 - k : k;
      for (const x of [right, right - 1]) {
        if (fn[y]![x]) continue;
        stream.push(at(x, y) !== masked(x, y) ? 1 : 0);
      }
    }
    upward = !upward;
  }
  const total = layout.blocks.reduce((a, b) => a + b, 0) + layout.ecc * layout.blocks.length;
  const words: number[] = [];
  for (let i = 0; i < total; i++) {
    let w = 0;
    for (let j = 0; j < 8; j++) w = (w << 1) | stream[i * 8 + j]!;
    words.push(w);
  }
  const n = layout.blocks.length;
  const blocks = layout.blocks.map(() => [] as number[]);
  let p = 0;
  const longest = Math.max(...layout.blocks);
  for (let i = 0; i < longest; i++)
    for (let b = 0; b < n; b++) if (i < layout.blocks[b]!) blocks[b]!.push(words[p++]!);
  for (let i = 0; i < layout.ecc; i++) for (let b = 0; b < n; b++) blocks[b]!.push(words[p++]!);
  for (const block of blocks)
    for (let k = 0; k < layout.ecc; k++) {
      let s = 0;
      for (const c of block) s = gfMul(s, gfPow(k)) ^ c;
      if (s !== 0) throw new Error('Reed–Solomon syndrome is not zero');
    }
  const data = blocks.flatMap((b, i) => b.slice(0, layout.blocks[i]));
  const bitsOf = data.flatMap((w) => Array.from({ length: 8 }, (_, j) => (w >> (7 - j)) & 1));
  let q = 0;
  const read = (len: number) => {
    let v = 0;
    for (let i = 0; i < len; i++) v = (v << 1) | bitsOf[q++]!;
    return v;
  };
  if (read(4) !== 0b0100) throw new Error('not byte mode');
  const len = read(version <= 9 ? 8 : 16);
  return new TextDecoder().decode(new Uint8Array(Array.from({ length: len }, () => read(8))));
}

/** The module matrix inside a quiet-zoned square `full` (whose border must be light). */
function unframe(full: boolean[][]): boolean[][] {
  const size = full.length;
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++)
      if ((x < QUIET || y < QUIET || x >= size - QUIET || y >= size - QUIET) && full[y]![x])
        throw new Error('quiet zone is not light');
  return full.slice(QUIET, size - QUIET).map((r) => r.slice(QUIET, size - QUIET));
}

// ---- Readers for each drawing ------------------------------------------------------------------

const SVG_GRAMMAR = new RegExp(
  '^<svg xmlns="http://www\\.w3\\.org/2000/svg" viewBox="0 0 ([1-9][0-9]) \\1" role="img" shape-rendering="crispEdges">' +
    `<title>${QR_TITLE}</title>` +
    '<rect width="\\1" height="\\1" fill="#ffffff"/>' +
    '<path d="((?:M[0-9]{1,2} [0-9]{1,2}h1v1h-1z)*)" fill="#000000"/></svg>$',
);

/**
 * The exact SVG allowlist (TRY-QR-ALLOWLIST-07): one root svg in the SVG namespace with a bounded
 * viewBox (29–65: versions 1–10 with the quiet zone), one title with the fixed text, one white rect
 * of the full size, one black path of unit squares inside the code area. Returns the module matrix,
 * or throws.
 */
function readSvg(svg: string): boolean[][] {
  const match = SVG_GRAMMAR.exec(svg);
  if (!match) throw new Error('svg is outside the allowlist');
  const size = Number(match[1]);
  if (size < 29 || size > 65 || (size - 29) % 4 !== 0) throw new Error('viewBox out of bounds');
  const full = Array.from({ length: size }, () => new Array<boolean>(size).fill(false));
  for (const [, x, y] of match[2]!.matchAll(/M([0-9]+) ([0-9]+)h1v1h-1z/g)) {
    const cx = Number(x);
    const cy = Number(y);
    if (cx >= size || cy >= size || full[cy]![cx]) throw new Error('path outside the code or repeated');
    full[cy]![cx] = true;
  }
  return unframe(full);
}

function readPng(png: Uint8Array, scale = 8): boolean[][] {
  const view = new DataView(png.buffer, png.byteOffset, png.byteLength);
  expect([...png.subarray(0, 8)]).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  let at = 8;
  let width = 0;
  let height = 0;
  const idat: Uint8Array[] = [];
  const types: string[] = [];
  while (at < png.length) {
    const len = view.getUint32(at);
    const type = new TextDecoder().decode(png.subarray(at + 4, at + 8));
    const data = png.subarray(at + 8, at + 8 + len);
    expect(view.getUint32(at + 8 + len)).toBe(crc32(png.subarray(at + 4, at + 8 + len)));
    types.push(type);
    if (type === 'IHDR') {
      width = view.getUint32(at + 8);
      height = view.getUint32(at + 12);
      expect([...data.subarray(8)]).toEqual([1, 0, 0, 0, 0]);
    }
    if (type === 'IDAT') idat.push(data);
    at += 12 + len;
  }
  expect(types).toEqual(['IHDR', 'IDAT', 'IEND']);
  expect(width).toBe(height);
  const raw = inflateSync(Buffer.concat(idat));
  const stride = Math.ceil(width / 8);
  expect(raw.length).toBe((stride + 1) * height);
  const pixel = (x: number, y: number) => {
    const row = y * (stride + 1);
    expect(raw[row]).toBe(0);
    return ((raw[row + 1 + (x >> 3)]! >> (7 - (x & 7))) & 1) === 0; // 0 is black
  };
  const size = width / scale;
  // Every pixel of a module agrees with its centre.
  const full = Array.from({ length: size }, (_, my) =>
    Array.from({ length: size }, (_, mx) => {
      const dark = pixel(mx * scale + scale / 2, my * scale + scale / 2);
      for (let dy = 0; dy < scale; dy++)
        for (let dx = 0; dx < scale; dx++)
          if (pixel(mx * scale + dx, my * scale + dy) !== dark) throw new Error('module not uniform');
      return dark;
    }),
  );
  return unframe(full);
}

const ANSI = /\u001b\[[0-9;]*m/g;

function readTerminal(text: string): boolean[][] {
  const lines = text.replace(ANSI, '').split('\n');
  const width = lines[0]!.length;
  const rows: boolean[][] = [];
  for (const line of lines) {
    expect(line.length).toBe(width);
    expect(line).toMatch(/^[ ▀▄█]+$/);
    const top: boolean[] = [];
    const bottom: boolean[] = [];
    for (const c of line) {
      top.push(c === '▀' || c === '█');
      bottom.push(c === '▄' || c === '█');
    }
    rows.push(top, bottom);
  }
  // An odd size leaves one light padding row under the code.
  if (rows.length === width + 1) expect(rows.pop()!.some(Boolean)).toBe(false);
  expect(rows.length).toBe(width);
  return unframe(rows);
}

const digest = (m: boolean[][]) =>
  createHash('sha256')
    .update(m.map((r) => r.map((d) => (d ? '1' : '0')).join('')).join('\n'))
    .digest('hex');

// ---- Tests -------------------------------------------------------------------------------------

describe('S-07 QR helper (@sess.si/sdk/qr)', () => {
  it('is the Sess encoder: the same vectors give the same module matrices as the Sess renderer', () => {
    // Digests of encodeQr's matrices in w1991e/sess packages/renderer/src/qr.ts (b48e8e7), for the
    // vectors of its qr.test.ts.
    const SESS: [string, number, string][] = [
      ['HELLO', 21, 'c346c75add5698735afe3f7eb4f3e6c57ccefd9563f45f65c6d76aa518fb6f91'],
      [LINKS[0]!, 33, '8ecf5d4880fca5d66e91448cb697bb196580216ae8a172e3d64ec86fabef5e09'],
      [LINKS[1]!, 41, '255a7a7115da445b728bc7fd4bffd7c8f27ce74365f5063fd635767e549846eb'],
      [LINKS[2]!, 49, '90de46ef25d5a764794704f26ed02456c177ca6af5bb295c4002b71a6e33a434'],
    ];
    for (const [text, size, hash] of SESS) {
      const m = encodeQr(text);
      expect(m.length).toBe(size);
      expect(digest(m)).toBe(hash);
      expect(decode(m)).toBe(text);
    }
    expect(() => encodeQr('x'.repeat(400))).toThrow(RangeError);
  });

  it('draws SVG, PNG and terminal text that decode to exactly the URL given, the same every time', () => {
    const longest = `https://example.test/${'y'.repeat(213 - 'https://example.test/'.length)}`;
    for (const url of [...LINKS, longest]) {
      const svg = qr(url, { format: 'svg' });
      expect(decode(readSvg(svg))).toBe(url);
      expect(qr(url, { format: 'svg' })).toBe(svg);
      const png = qr(url, { format: 'png' });
      expect(decode(readPng(png))).toBe(url);
      expect(Buffer.from(qr(url, { format: 'png' })).equals(Buffer.from(png))).toBe(true);
      const coloured = qr(url, { format: 'terminal' });
      expect(coloured).toMatch(/^\u001b\[30;107m/);
      expect(decode(readTerminal(coloured))).toBe(url);
      const plain = qr(url, { format: 'terminal', color: false });
      expect(plain).not.toContain('\u001b');
      expect(decode(readTerminal(plain))).toBe(url);
    }
  });

  it('the SVG is one exact tree with the fixed title, bounded in size, and malicious variants fail the allowlist', () => {
    const svg = qr(LINKS[0]!, { format: 'svg' });
    expect(() => readSvg(svg)).not.toThrow();
    expect(svg.match(/<title>/g)).toHaveLength(1);
    expect(svg).toContain(`<title>QR code for this Sess link</title>`);
    // The largest link (213 bytes, version 10) stays well under 32 KiB; a typical link is smaller.
    const longest = qr(`https://example.test/${'y'.repeat(192)}`, { format: 'svg' });
    expect(longest.length).toBeLessThan(32 * 1024);
    expect(svg.length).toBeLessThan(12 * 1024);
    const swap = (from: string, to: string) => svg.replace(from, to);
    const variants = [
      swap('<svg ', '<svg onload="alert(1)" '),
      swap('role="img"', 'role="img" style="display:none"'),
      swap('</svg>', '<script>alert(1)</script></svg>'),
      swap('</svg>', '<foreignObject><p>x</p></foreignObject></svg>'),
      swap('</svg>', '<image href="https://evil.test/x.png"/></svg>'),
      swap('</svg>', '<a href="https://evil.test/"><rect width="1" height="1"/></a></svg>'),
      swap('fill="#000000"', 'fill="url(https://evil.test/#p)"'),
      swap('fill="#ffffff"', 'fill="url(#p)"'),
      swap(`<title>${QR_TITLE}</title>`, '<title>Pay here</title>'),
      swap(`<title>${QR_TITLE}</title>`, `<title>${QR_TITLE}</title><title>x</title>`),
      swap(`<title>${QR_TITLE}</title>`, ''),
      swap('xmlns="http://www.w3.org/2000/svg"', 'xmlns="http://www.w3.org/1999/xhtml"'),
      swap('viewBox="0 0 41 41"', 'viewBox="0 0 4100 4100"'),
      swap('viewBox="0 0 41 41"', 'viewBox="0 0 41 9"'),
      swap('h1v1h-1z', 'h1v1h-1z" onclick="x'),
      swap('<path d="', '<path d="M99 99h1v1h-1z'),
      `${svg}<script/>`,
      `<?xml version="1.0"?>${svg}`,
    ];
    for (const v of variants) {
      expect(v).not.toBe(svg);
      expect(() => readSvg(v)).toThrow();
    }
  });

  it('refuses anything but an absolute http(s) URL of at most 213 bytes, without echoing it', () => {
    const secret = 'not a url SYNTHETIC-SECRET';
    for (const bad of [
      secret,
      'javascript:alert(1)',
      `data:text/plain,${secret}`,
      '',
      42 as unknown as string,
    ])
      expect(() => qr(bad, { format: 'svg' })).toThrow(
        expect.objectContaining({ message: expect.not.stringContaining('SYNTHETIC') }),
      );
    const tooLong = `https://example.test/${'SYNTHETIC'.repeat(30)}`;
    expect(() => qr(tooLong, { format: 'svg' })).toThrow(RangeError);
    expect(() => qr(tooLong, { format: 'svg' })).toThrow(
      expect.not.objectContaining({ message: /SYNTHETIC/ }),
    );
    expect(() => qr(LINKS[0]!, { format: 'gif' } as never)).toThrow(TypeError);
  });
});

describe('S-07 printQr (development helper)', () => {
  const tty = () => {
    const out: string[] = [];
    return { out, stream: { isTTY: true, write: (t: string) => out.push(t) } };
  };
  const env = {};

  it('on an interactive terminal prints one line, then the code, and the code decodes to the URL', () => {
    const { out, stream } = tty();
    expect(printQr(LINKS[0]!, { stream, env, argv: [] })).toBe(true);
    expect(out).toHaveLength(1);
    const [heading, ...rest] = out[0]!.split('\n');
    expect(heading).toBe(QR_HEADING);
    expect(heading).toBe('Scan to answer on your phone');
    expect(out[0]!.endsWith('\n')).toBe(true);
    const drawing = rest.join('\n').replace(/\n$/, '');
    expect(drawing).toContain('\u001b[30;107m');
    expect(decode(readTerminal(drawing))).toBe(LINKS[0]);
    // The link itself is not printed by the helper (the caller prints it once, as text).
    expect(out[0]).not.toContain('sess.si');
  });

  it('prints nothing without a TTY, in CI, in production, with --no-qr or with qr: false', () => {
    const cases: [string, Parameters<typeof printQr>[1]][] = [
      ['pipe', { stream: { isTTY: false, write: () => undefined }, env, argv: [] }],
      ['no isTTY', { stream: { write: () => undefined }, env, argv: [] }],
      ['CI=true', { env: { CI: 'true' }, argv: [] }],
      ['CI=1', { env: { CI: '1' }, argv: [] }],
      ['production', { env: { NODE_ENV: 'production' }, argv: [] }],
      ['--no-qr', { env, argv: ['node', 'agent.js', '--no-qr'] }],
      ['qr: false', { env, argv: [], qr: false }],
    ];
    for (const [name, options] of cases) {
      const { out, stream } = tty();
      const printed = printQr(LINKS[0]!, { stream, ...options });
      expect(printed, name).toBe(false);
      expect(out, name).toEqual([]);
    }
  });

  it('NO_COLOR draws without colour; CI=false and NODE_ENV=development still print; a bad URL throws even when nothing would print', () => {
    const plain = tty();
    expect(printQr(LINKS[0]!, { stream: plain.stream, env: { NO_COLOR: '1' }, argv: [] })).toBe(true);
    expect(plain.out[0]).not.toContain('\u001b');
    expect(decode(readTerminal(plain.out[0]!.split('\n').slice(1, -1).join('\n')))).toBe(LINKS[0]);
    for (const e of [{ CI: 'false' }, { CI: '' }, { NODE_ENV: 'development' }, { NO_COLOR: '' }]) {
      const { out, stream } = tty();
      expect(printQr(LINKS[0]!, { stream, env: e, argv: [] })).toBe(true);
      expect(out).toHaveLength(1);
    }
    expect(() =>
      printQr('not a url', { stream: { isTTY: false, write: () => undefined }, env, argv: [] }),
    ).toThrow(TypeError);
  });
});
