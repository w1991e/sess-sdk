// `@sess.si/sdk/qr`: draw a Sess link as a QR code, locally, so a person at a laptop can answer on
// their phone without copying anything. Optional: Sess never sends links, and the agent decides
// whether a QR helps (a desktop chat window, a dashboard, a kiosk, print) or not (SMS, or a person
// already on their phone).
//
// The link is a private capability: the QR is the same capability in another encoding. Nothing here
// contacts a service, stores the link or its drawing, or puts the link in an error message.
import { crc32, deflateSync } from 'node:zlib';
import { encodeQr, type QrMatrix } from './encoder.js';

/** The accessible name of the SVG drawing (its one `title`). */
export const QR_TITLE = 'QR code for this Sess link';

/** The line `printQr` prints before the code. */
export const QR_HEADING = 'Scan to answer on your phone';

/** Light modules around the code, on every side (ISO/IEC 18004 asks for 4). */
const QUIET = 4;
/** PNG pixels per module. */
const PNG_SCALE = 8;

export type QrFormat = 'svg' | 'png' | 'terminal';

export interface QrSvgOptions {
  format: 'svg';
}
export interface QrPngOptions {
  format: 'png';
}
export interface QrTerminalOptions {
  format: 'terminal';
  /**
   * Draw black on white with ANSI colours, so the code scans in light and dark terminal themes
   * (default true). False: characters only (for `NO_COLOR`); the code is then drawn in the
   * terminal's own text colour.
   */
  color?: boolean;
}
export type QrOptions = QrSvgOptions | QrPngOptions | QrTerminalOptions;

function matrixOf(url: string): QrMatrix {
  // Never echo the link: it is a bearer capability.
  if (typeof url !== 'string' || !URL.canParse(url)) throw new TypeError('qr: url must be an absolute URL');
  const protocol = new URL(url).protocol;
  if (protocol !== 'https:' && protocol !== 'http:') throw new TypeError('qr: url must be an http(s) URL');
  try {
    return encodeQr(url);
  } catch {
    throw new RangeError('qr: url is too long for a QR code (at most 213 bytes)');
  }
}

/**
 * The SVG drawing: exactly one root `svg` (SVG namespace, `viewBox="0 0 N N"`, `role="img"`,
 * `shape-rendering="crispEdges"`) holding one `title` ({@link QR_TITLE}), one white `rect` (the
 * quiet zone and background) and one black `path` of unit squares. No style, script, event
 * attribute, link or external resource; fixed colours, so it scans in either theme.
 */
function svgOf(m: QrMatrix): string {
  const size = m.length + QUIET * 2;
  let d = '';
  m.forEach((row, y) => {
    row.forEach((dark, x) => {
      if (dark) d += `M${x + QUIET} ${y + QUIET}h1v1h-1z`;
    });
  });
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}" role="img" shape-rendering="crispEdges">` +
    `<title>${QR_TITLE}</title>` +
    `<rect width="${size}" height="${size}" fill="#ffffff"/><path d="${d}" fill="#000000"/></svg>`
  );
}

/** Dark at (x, y) of the code with its quiet zone; outside is light. */
function darkAt(m: QrMatrix, x: number, y: number): boolean {
  return m[y - QUIET]?.[x - QUIET] === true;
}

/**
 * The terminal drawing: two module rows per text line with Unicode half blocks (▀ ▄ █), quiet zone
 * included, lines joined by "\n" with no trailing newline.
 */
function terminalOf(m: QrMatrix, color: boolean): string {
  const size = m.length + QUIET * 2;
  const lines: string[] = [];
  for (let y = 0; y < size; y += 2) {
    let line = '';
    for (let x = 0; x < size; x++) {
      const top = darkAt(m, x, y);
      const bottom = y + 1 < size && darkAt(m, x, y + 1);
      line += top ? (bottom ? '█' : '▀') : bottom ? '▄' : ' ';
    }
    // Black text on a bright white background, reset at the end of every line.
    lines.push(color ? `\u001b[30;107m${line}\u001b[0m` : line);
  }
  return lines.join('\n');
}

function chunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.length);
  const view = new DataView(out.buffer);
  view.setUint32(0, data.length);
  out.set(new TextEncoder().encode(type), 4);
  out.set(data, 8);
  view.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)));
  return out;
}

/** The PNG image: 1-bit greyscale, {@link PNG_SCALE} pixels per module, quiet zone included. */
function pngOf(m: QrMatrix): Uint8Array {
  const side = (m.length + QUIET * 2) * PNG_SCALE;
  const stride = Math.ceil(side / 8);
  const raw = new Uint8Array((stride + 1) * side);
  for (let py = 0; py < side; py++) {
    const row = py * (stride + 1);
    raw[row] = 0; // filter: none
    for (let px = 0; px < side; px++) {
      // 1 is white in 1-bit greyscale.
      if (!darkAt(m, Math.floor(px / PNG_SCALE), Math.floor(py / PNG_SCALE)))
        raw[row + 1 + (px >> 3)]! |= 0x80 >> (px & 7);
    }
  }
  const header = new Uint8Array(13);
  const h = new DataView(header.buffer);
  h.setUint32(0, side);
  h.setUint32(4, side);
  header.set([1, 0, 0, 0, 0], 8); // bit depth 1, greyscale, deflate, adaptive filter, no interlace
  const parts = [
    new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', new Uint8Array(0)),
  ];
  const png = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) {
    png.set(p, at);
    at += p.length;
  }
  return png;
}

/**
 * Draws `url` (an absolute http(s) URL of at most 213 bytes, such as the `url` of a created Session)
 * as a QR code: error correction level M, a 4-module quiet zone, deterministic, no network access.
 *
 * - `svg`: an SVG string with an accessible title ({@link QR_TITLE}).
 * - `png`: PNG bytes, 8 pixels per module.
 * - `terminal`: text with Unicode half blocks, for an interactive terminal (see {@link printQr}).
 *
 * The drawing is the link itself in another encoding: keep it wherever the link may be, and never
 * in logs, analytics or a URL.
 */
export function qr(url: string, options: QrSvgOptions | QrTerminalOptions): string;
export function qr(url: string, options: QrPngOptions): Uint8Array;
export function qr(url: string, options: QrOptions): string | Uint8Array {
  const format = (options as { format?: unknown } | undefined)?.format;
  if (format !== 'svg' && format !== 'png' && format !== 'terminal')
    throw new TypeError('qr: format must be "svg", "png" or "terminal"');
  const m = matrixOf(url);
  if (format === 'svg') return svgOf(m);
  if (format === 'png') return pngOf(m);
  return terminalOf(m, (options as QrTerminalOptions).color !== false);
}

export interface PrintQrOptions {
  /** Where to print (default `process.stdout`). Printed only when it is an interactive terminal. */
  stream?: { isTTY?: boolean | undefined; write(text: string): unknown };
  /** The environment (default `process.env`): `CI`, `NODE_ENV` and `NO_COLOR` are read. */
  env?: Readonly<Record<string, string | undefined>>;
  /** The command-line arguments (default `process.argv`): `--no-qr` turns the code off. */
  argv?: readonly string[];
  /** False turns the code off, as `--no-qr` does. */
  qr?: boolean;
}

const set = (v: string | undefined) => v !== undefined && v !== '';
const isCi = (v: string | undefined) => set(v) && v !== 'false' && v !== '0';

/**
 * For development: prints "Scan to answer on your phone" and `url` as a terminal QR code, and
 * returns true, only on an interactive terminal. It prints nothing and returns false when the
 * stream is not a TTY (a pipe, a file, a log collector), in CI (`CI` set), in production
 * (`NODE_ENV=production`), with `--no-qr` or with `qr: false`. `NO_COLOR` draws it without colour.
 * Print the link itself as well: the code is a shortcut, not the only way in.
 */
export function printQr(url: string, options: PrintQrOptions = {}): boolean {
  // The link is checked whether or not anything is printed.
  const m = matrixOf(url);
  const stream = options.stream ?? process.stdout;
  const env = options.env ?? process.env;
  const argv = options.argv ?? process.argv;
  if (
    options.qr === false ||
    argv.includes('--no-qr') ||
    stream.isTTY !== true ||
    isCi(env.CI) ||
    env.NODE_ENV === 'production'
  )
    return false;
  stream.write(`${QR_HEADING}\n${terminalOf(m, !set(env.NO_COLOR))}\n`);
  return true;
}
