// The QR Code encoder (ISO/IEC 18004, model 2): byte mode, error correction level M, versions 1–10
// (up to 213 bytes). Pure and deterministic, with no network access and no dependency.
//
// Vendored verbatim (apart from this header and the removal of the page-specific SVG drawing) from
// the Sess repository, packages/renderer/src/qr.ts at commit b48e8e7 (w1991e/sess). Its parity with
// that copy is tested against the same vectors (tests/unit/qr.test.ts).
//
// Structure after Project Nayuki's QR Code generator library (https://www.nayuki.io/page/qr-code-generator-library):
//
//   Copyright (c) Project Nayuki. (MIT License)
//
//   Permission is hereby granted, free of charge, to any person obtaining a copy of this software and
//   associated documentation files (the "Software"), to deal in the Software without restriction,
//   including without limitation the rights to use, copy, modify, merge, publish, distribute,
//   sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is
//   furnished to do so, subject to the following conditions:
//   - The above copyright notice and this permission notice shall be included in all copies or
//     substantial portions of the Software.
//   - The Software is provided "as is", without warranty of any kind, express or implied, including
//     but not limited to the warranties of merchantability, fitness for a particular purpose and
//     noninfringement. In no event shall the authors or copyright holders be liable for any claim,
//     damages or other liability, whether in an action of contract, tort or otherwise, arising from,
//     out of or in connection with the Software or the use or other dealings in the Software.

const MAX_VERSION = 10;
/** Level M: error-correction codewords per block and the number of blocks, per version. */
const ECC_PER_BLOCK = [0, 10, 16, 26, 18, 24, 16, 18, 22, 22, 26];
const BLOCKS = [0, 1, 1, 1, 2, 2, 4, 4, 4, 5, 5];
/** Level M's two format bits. */
const ECL_M_BITS = 0;

/** A square module matrix: true is dark. */
export type QrMatrix = boolean[][];

function rawDataModules(ver: number): number {
  let result = (16 * ver + 128) * ver + 64;
  if (ver >= 2) {
    const align = Math.floor(ver / 7) + 2;
    result -= (25 * align - 10) * align - 55;
    if (ver >= 7) result -= 36;
  }
  return result;
}

const dataCodewords = (ver: number) =>
  Math.floor(rawDataModules(ver) / 8) - (ECC_PER_BLOCK[ver] ?? 0) * (BLOCKS[ver] ?? 0);

/** Alignment pattern centre coordinates of a version (both axes). */
export function alignmentPositions(ver: number): number[] {
  if (ver === 1) return [];
  const count = Math.floor(ver / 7) + 2;
  const size = ver * 4 + 17;
  const step = Math.ceil((ver * 4 + 4) / (count * 2 - 2)) * 2;
  const result = [6];
  for (let pos = size - 7; result.length < count; pos -= step) result.splice(1, 0, pos);
  return result;
}

// ---- GF(256) Reed–Solomon (polynomial 0x11D) --------------------------------------------------

function gfMul(x: number, y: number): number {
  let z = 0;
  for (let i = 7; i >= 0; i--) {
    z = (z << 1) ^ ((z >>> 7) * 0x11d);
    z ^= ((y >>> i) & 1) * x;
  }
  return z & 0xff;
}

function rsDivisor(degree: number): number[] {
  const result = new Array<number>(degree).fill(0);
  result[degree - 1] = 1;
  let root = 1;
  for (let i = 0; i < degree; i++) {
    for (let j = 0; j < degree; j++) {
      result[j] = gfMul(result[j] as number, root);
      if (j + 1 < degree) result[j] = (result[j] as number) ^ (result[j + 1] as number);
    }
    root = gfMul(root, 0x02);
  }
  return result;
}

function rsRemainder(data: number[], divisor: number[]): number[] {
  const result = new Array<number>(divisor.length).fill(0);
  for (const b of data) {
    const factor = b ^ (result.shift() as number);
    result.push(0);
    divisor.forEach((coef, i) => {
      result[i] = (result[i] as number) ^ gfMul(coef, factor);
    });
  }
  return result;
}

// ---- Encoding --------------------------------------------------------------------------------

/** The codewords (data then error correction, interleaved) of `bytes` at `ver`. */
function codewords(bytes: Uint8Array, ver: number): number[] {
  const capacityBits = dataCodewords(ver) * 8;
  const bits: number[] = [];
  const put = (value: number, len: number) => {
    for (let i = len - 1; i >= 0; i--) bits.push((value >>> i) & 1);
  };
  put(0b0100, 4); // byte mode
  put(bytes.length, ver <= 9 ? 8 : 16);
  for (const b of bytes) put(b, 8);
  put(0, Math.min(4, capacityBits - bits.length));
  put(0, (8 - (bits.length % 8)) % 8);
  for (let pad = 0xec; bits.length < capacityBits; pad ^= 0xec ^ 0x11) put(pad, 8);
  const data: number[] = [];
  for (let i = 0; i < bits.length; i += 8) {
    let b = 0;
    for (let j = 0; j < 8; j++) b = (b << 1) | (bits[i + j] as number);
    data.push(b);
  }
  // Split into blocks (short blocks first), add each block's ECC, then interleave.
  const numBlocks = BLOCKS[ver] as number;
  const eccLen = ECC_PER_BLOCK[ver] as number;
  const rawCodewords = Math.floor(rawDataModules(ver) / 8);
  const numShort = numBlocks - (rawCodewords % numBlocks);
  const shortLen = Math.floor(rawCodewords / numBlocks);
  const divisor = rsDivisor(eccLen);
  const blocks: number[][] = [];
  for (let i = 0, k = 0; i < numBlocks; i++) {
    const len = shortLen - eccLen + (i < numShort ? 0 : 1);
    const dat = data.slice(k, k + len);
    k += len;
    const ecc = rsRemainder(dat, divisor);
    if (i < numShort) dat.push(0); // placeholder, skipped when interleaving
    blocks.push([...dat, ...ecc]);
  }
  const result: number[] = [];
  for (let i = 0; i < (blocks[0] as number[]).length; i++) {
    blocks.forEach((block, j) => {
      if (i !== shortLen - eccLen || j >= numShort) result.push(block[i] as number);
    });
  }
  return result;
}

class Grid {
  readonly version: number;
  readonly size: number;
  readonly dark: boolean[][];
  readonly fn: boolean[][];
  constructor(version: number) {
    this.version = version;
    this.size = version * 4 + 17;
    this.dark = Array.from({ length: this.size }, () => new Array<boolean>(this.size).fill(false));
    this.fn = Array.from({ length: this.size }, () => new Array<boolean>(this.size).fill(false));
  }
  set(x: number, y: number, dark: boolean) {
    (this.dark[y] as boolean[])[x] = dark;
    (this.fn[y] as boolean[])[x] = true;
  }
}

function drawFunctionPatterns(g: Grid): void {
  const { size, version } = g;
  for (let i = 0; i < size; i++) {
    g.set(6, i, i % 2 === 0);
    g.set(i, 6, i % 2 === 0);
  }
  const finder = (cx: number, cy: number) => {
    for (let dy = -4; dy <= 4; dy++) {
      for (let dx = -4; dx <= 4; dx++) {
        const d = Math.max(Math.abs(dx), Math.abs(dy));
        const x = cx + dx;
        const y = cy + dy;
        if (x >= 0 && x < size && y >= 0 && y < size) g.set(x, y, d !== 2 && d !== 4);
      }
    }
  };
  finder(3, 3);
  finder(size - 4, 3);
  finder(3, size - 4);
  const align = alignmentPositions(version);
  const n = align.length;
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      if ((i === 0 && j === 0) || (i === 0 && j === n - 1) || (i === n - 1 && j === 0)) continue;
      for (let dy = -2; dy <= 2; dy++) {
        for (let dx = -2; dx <= 2; dx++) {
          g.set(
            (align[i] as number) + dx,
            (align[j] as number) + dy,
            Math.max(Math.abs(dx), Math.abs(dy)) !== 1,
          );
        }
      }
    }
  }
  drawFormatBits(g, 0); // reserve; redrawn with the chosen mask
  if (version >= 7) {
    let rem = version;
    for (let i = 0; i < 12; i++) rem = (rem << 1) ^ ((rem >>> 11) * 0x1f25);
    const bits = (version << 12) | rem;
    for (let i = 0; i < 18; i++) {
      const bit = ((bits >>> i) & 1) !== 0;
      const a = size - 11 + (i % 3);
      const b = Math.floor(i / 3);
      g.set(a, b, bit);
      g.set(b, a, bit);
    }
  }
}

/** The 15 format bits for level M and `mask` (BCH(15,5), XOR-masked). */
export function formatBits(mask: number): number {
  const data = (ECL_M_BITS << 3) | mask;
  let rem = data;
  for (let i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >>> 9) * 0x537);
  return ((data << 10) | rem) ^ 0x5412;
}

function drawFormatBits(g: Grid, mask: number): void {
  const bits = formatBits(mask);
  const bit = (i: number) => ((bits >>> i) & 1) !== 0;
  const { size } = g;
  for (let i = 0; i <= 5; i++) g.set(8, i, bit(i));
  g.set(8, 7, bit(6));
  g.set(8, 8, bit(7));
  g.set(7, 8, bit(8));
  for (let i = 9; i < 15; i++) g.set(14 - i, 8, bit(i));
  for (let i = 0; i < 8; i++) g.set(size - 1 - i, 8, bit(i));
  for (let i = 8; i < 15; i++) g.set(8, size - 15 + i, bit(i));
  g.set(8, size - 8, true); // the dark module
}

function drawCodewords(g: Grid, data: number[]): void {
  const { size } = g;
  let i = 0;
  for (let right = size - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5;
    for (let vert = 0; vert < size; vert++) {
      for (let j = 0; j < 2; j++) {
        const x = right - j;
        const upward = ((right + 1) & 2) === 0;
        const y = upward ? size - 1 - vert : vert;
        if (!(g.fn[y] as boolean[])[x] && i < data.length * 8) {
          (g.dark[y] as boolean[])[x] = (((data[i >>> 3] as number) >>> (7 - (i & 7))) & 1) !== 0;
          i++;
        }
      }
    }
  }
}

/** The mask condition: true where a data module is inverted. */
export function maskBit(mask: number, x: number, y: number): boolean {
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
      return (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0;
    case 5:
      return ((x * y) % 2) + ((x * y) % 3) === 0;
    case 6:
      return (((x * y) % 2) + ((x * y) % 3)) % 2 === 0;
    default:
      return (((x + y) % 2) + ((x * y) % 3)) % 2 === 0;
  }
}

function applyMask(g: Grid, mask: number): void {
  for (let y = 0; y < g.size; y++) {
    for (let x = 0; x < g.size; x++) {
      if (!(g.fn[y] as boolean[])[x] && maskBit(mask, x, y)) {
        (g.dark[y] as boolean[])[x] = !(g.dark[y] as boolean[])[x];
      }
    }
  }
}

/** The standard penalty score (rules N1–N4) of a finished matrix. */
function penalty(m: boolean[][]): number {
  const size = m.length;
  let score = 0;
  const line = (get: (i: number) => boolean) => {
    let run = 1;
    for (let i = 1; i <= size; i++) {
      if (i < size && get(i) === get(i - 1)) run++;
      else {
        if (run >= 5) score += 3 + (run - 5);
        run = 1;
      }
    }
    const seq = Array.from({ length: size }, (_, i) => (get(i) ? 1 : 0)).join('');
    for (const p of ['10111010000', '00001011101']) {
      for (let at = seq.indexOf(p); at >= 0; at = seq.indexOf(p, at + 1)) score += 40;
    }
  };
  for (let y = 0; y < size; y++) line((x) => (m[y] as boolean[])[x] as boolean);
  for (let x = 0; x < size; x++) line((y) => (m[y] as boolean[])[x] as boolean);
  let dark = 0;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const c = (m[y] as boolean[])[x];
      if (c) dark++;
      if (
        x + 1 < size &&
        y + 1 < size &&
        c === (m[y] as boolean[])[x + 1] &&
        c === (m[y + 1] as boolean[])[x] &&
        c === (m[y + 1] as boolean[])[x + 1]
      )
        score += 3;
    }
  }
  score += 10 * Math.floor(Math.abs((dark * 100) / (size * size) - 50) / 5);
  return score;
}

/** Encodes `text` (UTF-8, byte mode, level M) at the smallest version 1–10 that holds it. */
export function encodeQr(text: string): QrMatrix {
  const bytes = new TextEncoder().encode(text);
  let version = 0;
  for (let v = 1; v <= MAX_VERSION; v++) {
    const needed = 4 + (v <= 9 ? 8 : 16) + bytes.length * 8;
    if (needed <= dataCodewords(v) * 8) {
      version = v;
      break;
    }
  }
  if (version === 0) throw new RangeError('text too long for a version 1–10 QR code');
  const data = codewords(bytes, version);
  let best: { score: number; matrix: QrMatrix } | null = null;
  for (let mask = 0; mask < 8; mask++) {
    const g = new Grid(version);
    drawFunctionPatterns(g);
    drawCodewords(g, data);
    applyMask(g, mask);
    drawFormatBits(g, mask);
    const score = penalty(g.dark);
    if (best === null || score < best.score) best = { score, matrix: g.dark };
  }
  return (best as { matrix: QrMatrix }).matrix;
}
