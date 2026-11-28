// The receipt PDF extractor (S-04, TRY-PDF-BOUNDS-03 and TRY-PDF-CONTAINER-02): reads back the
// one embedded Keep JSON from a receipt PDF of the profile (profile.ts). It never interprets the
// visible pages: what /verify checks is this extracted record, not how the page looks
// (TRY-PDF-PROOF-01). Pure and dependency-free (Uint8Array in, text out), so the browser can run it.
//
// The profile it accepts, and refuses everything else with a stated reason:
// - classic cross-reference tables (an original file or incremental updates of it); a
//   cross-reference stream or object stream is `outside_profile`;
// - exactly one associated file on the catalog with AFRelationship /Data named
//   RECEIPT_PDF_ATTACHMENT_NAME, and no other embedded file of that name (else `ambiguous_record`);
// - that file's stream is application/json, unfiltered (nothing is decompressed), its /Length a
//   plain integer within the attachment bound, its bytes valid UTF-8.
// Every step is bounded before it allocates: input size, cross-reference sections and entries,
// object nesting, the attachment's length and one work budget (RECEIPT_PDF_BOUNDS.maxTokens) that
// every unit of parser work is charged to: each token, each byte scanned in whitespace, comments,
// names and strings, each reference followed (a cached object too) and each name-tree entry and
// child. The embedded-files name tree must be a tree: a node, child list or leaf array reached
// twice (shared or cyclic) is malformed, so no part of it is read more than once.
import {
  RECEIPT_PDF_ATTACHMENT_NAME,
  RECEIPT_PDF_ATTACHMENT_RELATIONSHIP,
  RECEIPT_PDF_ATTACHMENT_TYPE,
  RECEIPT_PDF_BOUNDS,
  type ReceiptPdfBounds,
} from './pdf-profile.js';

export type ReceiptPdfRejection =
  | 'not_pdf'
  | 'too_large'
  | 'malformed'
  | 'outside_profile'
  | 'no_record'
  | 'ambiguous_record'
  | 'record_too_large'
  | 'work_exceeded';

export type ReceiptPdfExtraction =
  | { ok: true; text: string }
  | { ok: false; reason: ReceiptPdfRejection };

type PdfValue = null | boolean | number | PdfName | PdfString | PdfRef | PdfValue[] | PdfDict;
interface PdfName {
  t: 'name';
  v: string;
}
interface PdfString {
  t: 'str';
  b: Uint8Array;
}
interface PdfRef {
  t: 'ref';
  n: number;
  g: number;
}
interface PdfDict {
  t: 'dict';
  m: Map<string, PdfValue>;
}
interface PdfStream {
  dict: PdfDict;
  /** Offset of the first data byte (after `stream` and its end-of-line). */
  data: number;
}

class Stop extends Error {
  readonly reason: ReceiptPdfRejection;
  constructor(reason: ReceiptPdfRejection) {
    super(reason);
    this.reason = reason;
  }
}

const WS = new Set([0, 9, 10, 12, 13, 32]);
const DELIM = new Set([40, 41, 60, 62, 91, 93, 123, 125, 47, 37]);
const ascii = (s: string) => Uint8Array.from(s, (c) => c.charCodeAt(0));
const isDigit = (b: number) => b >= 48 && b <= 57;

class Parser {
  private tokens = 0;
  private readonly objects = new Map<number, { offset: number; gen: number }>();
  private readonly cache = new Map<number, PdfValue | PdfStream>();
  private readonly resolving = new Set<number>();
  trailer: PdfDict | null = null;
  private readonly b: Uint8Array;
  private readonly bounds: ReceiptPdfBounds;

  constructor(b: Uint8Array, bounds: ReceiptPdfBounds) {
    this.b = b;
    this.bounds = bounds;
  }

  /** Charges `units` of work to the one budget; past it, the extraction stops. */
  work(units = 1): void {
    this.tokens += units;
    if (this.tokens > this.bounds.maxTokens) throw new Stop('work_exceeded');
  }

  private ws(p0: number): number {
    const b = this.b;
    let p = p0;
    while (p < b.length) {
      const c = b[p] as number;
      if (WS.has(c)) p += 1;
      else if (c === 37) {
        while (p < b.length && b[p] !== 10 && b[p] !== 13) p += 1;
      } else break;
    }
    // Whitespace and comments are work too: overlapping objects could otherwise rescan them.
    if (p > p0) this.work(p - p0);
    return p;
  }

  private startsWith(p: number, word: string): boolean {
    if (p + word.length > this.b.length) return false;
    for (let i = 0; i < word.length; i++) if (this.b[p + i] !== word.charCodeAt(i)) return false;
    return true;
  }

  /** A keyword at `p` followed by a delimiter, whitespace or the end. */
  private keyword(p: number, word: string): boolean {
    if (!this.startsWith(p, word)) return false;
    const next = this.b[p + word.length];
    return next === undefined || WS.has(next) || DELIM.has(next);
  }

  private integerAt(p: number): { v: number; end: number } | null {
    let q = p;
    while (q < this.b.length && isDigit(this.b[q] as number) && q - p < 12) q += 1;
    if (q === p) return null;
    let v = 0;
    for (let i = p; i < q; i++) v = v * 10 + ((this.b[i] as number) - 48);
    return { v, end: q };
  }

  /** One object at `p` (after whitespace); refs are recognized as `n g R`. */
  value(p0: number, depth: number): { v: PdfValue; end: number } {
    this.work();
    if (depth > this.bounds.maxNesting) throw new Stop('work_exceeded');
    const b = this.b;
    const p = this.ws(p0);
    const c = b[p];
    if (c === undefined) throw new Stop('malformed');
    if (c === 60 && b[p + 1] === 60) {
      const m = new Map<string, PdfValue>();
      let q = this.ws(p + 2);
      while (!(b[q] === 62 && b[q + 1] === 62)) {
        if (q >= b.length) throw new Stop('malformed');
        const k = this.value(q, depth + 1);
        if (typeof k.v !== 'object' || k.v === null || !('t' in k.v) || k.v.t !== 'name')
          throw new Stop('malformed');
        const val = this.value(k.end, depth + 1);
        // A repeated key is ambiguous: refuse rather than pick one.
        if (m.has(k.v.v)) throw new Stop('malformed');
        m.set(k.v.v, val.v);
        q = this.ws(val.end);
      }
      return { v: { t: 'dict', m }, end: q + 2 };
    }
    if (c === 91) {
      const a: PdfValue[] = [];
      let q = this.ws(p + 1);
      while (b[q] !== 93) {
        if (q >= b.length) throw new Stop('malformed');
        const item = this.value(q, depth + 1);
        a.push(item.v);
        q = this.ws(item.end);
      }
      return { v: a, end: q + 1 };
    }
    if (c === 47) {
      let q = p + 1;
      const bytes: number[] = [];
      while (q < b.length && !WS.has(b[q] as number) && !DELIM.has(b[q] as number)) {
        if (b[q] === 35) {
          const hex = String.fromCharCode(b[q + 1] ?? 0, b[q + 2] ?? 0);
          if (!/^[0-9A-Fa-f]{2}$/.test(hex)) throw new Stop('malformed');
          bytes.push(Number.parseInt(hex, 16));
          q += 3;
        } else {
          bytes.push(b[q] as number);
          q += 1;
        }
        if (bytes.length > 127) throw new Stop('malformed');
      }
      this.work(q - p);
      return { v: { t: 'name', v: String.fromCharCode(...bytes) }, end: q };
    }
    if (c === 40) return this.literal(p);
    if (c === 60) {
      let q = p + 1;
      let hex = '';
      while (q < b.length && b[q] !== 62) {
        const ch = b[q] as number;
        if (!WS.has(ch)) hex += String.fromCharCode(ch);
        q += 1;
        if (hex.length > 65_536) throw new Stop('malformed');
      }
      this.work(q - p);
      if (q >= b.length || !/^[0-9A-Fa-f]*$/.test(hex)) throw new Stop('malformed');
      if (hex.length % 2) hex += '0';
      const out = new Uint8Array(hex.length / 2);
      for (let i = 0; i < out.length; i++)
        out[i] = Number.parseInt(hex.slice(2 * i, 2 * i + 2), 16);
      return { v: { t: 'str', b: out }, end: q + 1 };
    }
    if (this.keyword(p, 'true')) return { v: true, end: p + 4 };
    if (this.keyword(p, 'false')) return { v: false, end: p + 5 };
    if (this.keyword(p, 'null')) return { v: null, end: p + 4 };
    // A number, or the reference `n g R`.
    const m = /^[+-]?(\d+\.?\d*|\.\d+)/.exec(String.fromCharCode(...b.subarray(p, p + 24)));
    if (!m) throw new Stop('malformed');
    const end = p + m[0].length;
    const num = Number(m[0]);
    if (/^\d+$/.test(m[0])) {
      const q = this.ws(end);
      const g = this.integerAt(q);
      if (g) {
        const r = this.ws(g.end);
        if (this.keyword(r, 'R')) return { v: { t: 'ref', n: num, g: g.v }, end: r + 1 };
      }
    }
    return { v: num, end };
  }

  private literal(p: number): { v: PdfString; end: number } {
    const b = this.b;
    const out: number[] = [];
    let q = p + 1;
    let depth = 1;
    while (q < b.length) {
      const c = b[q] as number;
      if (out.length > 65_536) throw new Stop('malformed');
      if (c === 92) {
        const n = b[q + 1];
        if (n === undefined) break;
        const esc: Record<number, number> = {
          110: 10,
          114: 13,
          116: 9,
          98: 8,
          102: 12,
          40: 40,
          41: 41,
          92: 92,
        };
        if (esc[n] !== undefined) {
          out.push(esc[n] as number);
          q += 2;
        } else if (n >= 48 && n <= 55) {
          let k = q + 1;
          let v = 0;
          while (k < q + 4 && (b[k] as number) >= 48 && (b[k] as number) <= 55) {
            v = v * 8 + ((b[k] as number) - 48);
            k += 1;
          }
          out.push(v & 255);
          q = k;
        } else if (n === 13 || n === 10) {
          q += n === 13 && b[q + 2] === 10 ? 3 : 2;
        } else {
          out.push(n);
          q += 2;
        }
        continue;
      }
      if (c === 40) depth += 1;
      if (c === 41) {
        depth -= 1;
        if (depth === 0) {
          this.work(q + 1 - p);
          return { v: { t: 'str', b: Uint8Array.from(out) }, end: q + 1 };
        }
      }
      out.push(c);
      q += 1;
    }
    throw new Stop('malformed');
  }

  /** Reads the cross-reference chain from the last `startxref`. */
  readXref(): void {
    const b = this.b;
    const tailFrom = Math.max(0, b.length - 1024);
    const tail = String.fromCharCode(...b.subarray(tailFrom));
    const at = tail.lastIndexOf('startxref');
    if (at < 0) throw new Stop('malformed');
    const off = this.integerAt(this.ws(tailFrom + at + 9));
    if (!off) throw new Stop('malformed');
    let offset: number | null = off.v;
    const seen = new Set<number>();
    while (offset !== null) {
      if (seen.has(offset) || seen.size >= this.bounds.maxXrefSections) throw new Stop('malformed');
      seen.add(offset);
      if (offset >= b.length) throw new Stop('malformed');
      const p = this.ws(offset);
      if (!this.keyword(p, 'xref')) {
        // A cross-reference stream (`n g obj << /Type /XRef … >>`) is valid PDF, not this profile.
        if (this.integerAt(p)) throw new Stop('outside_profile');
        throw new Stop('malformed');
      }
      let q = this.ws(p + 4);
      while (!this.keyword(q, 'trailer')) {
        const start = this.integerAt(q);
        if (!start) throw new Stop('malformed');
        const count = this.integerAt(this.ws(start.end));
        if (!count) throw new Stop('malformed');
        q = this.ws(count.end);
        if (this.objects.size + count.v > this.bounds.maxObjects) throw new Stop('work_exceeded');
        for (let i = 0; i < count.v; i++) {
          this.work();
          const line = String.fromCharCode(...b.subarray(q, q + 20));
          const e = /^(\d{10}) (\d{5}) ([nf])[\r\n ]{0,2}/.exec(line);
          if (!e) throw new Stop('malformed');
          const n = start.v + i;
          // Newer sections come first: an object keeps its newest entry.
          if (!this.objects.has(n) && e[3] === 'n')
            this.objects.set(n, { offset: Number(e[1]), gen: Number(e[2]) });
          if (!this.objects.has(n) && e[3] === 'f') this.objects.set(n, { offset: -1, gen: 0 });
          q += e[0].length;
          q = this.ws(q);
        }
      }
      const t = this.value(q + 7, 0).v;
      if (!isDict(t)) throw new Stop('malformed');
      if (t.m.has('XRefStm')) throw new Stop('outside_profile');
      if (this.trailer === null) this.trailer = t;
      const prev = t.m.get('Prev');
      offset = typeof prev === 'number' && Number.isInteger(prev) && prev >= 0 ? prev : null;
      if (prev !== undefined && offset === null) throw new Stop('malformed');
    }
  }

  /** The object a value names (direct values pass through). */
  resolve(v: PdfValue | undefined): PdfValue | PdfStream | undefined {
    if (v === undefined || v === null || typeof v !== 'object' || !('t' in v) || v.t !== 'ref')
      return v;
    const ref = v;
    // Every reference followed is work, a cached one included.
    this.work();
    const cached = this.cache.get(ref.n);
    if (cached !== undefined) return cached;
    if (this.resolving.has(ref.n)) throw new Stop('malformed');
    const entry = this.objects.get(ref.n);
    if (!entry || entry.offset < 0) return null;
    if (entry.gen !== ref.g) throw new Stop('malformed');
    this.resolving.add(ref.n);
    try {
      let p = this.ws(entry.offset);
      const n = this.integerAt(p);
      if (!n || n.v !== ref.n) throw new Stop('malformed');
      const g = this.integerAt(this.ws(n.end));
      if (!g || g.v !== ref.g) throw new Stop('malformed');
      p = this.ws(g.end);
      if (!this.keyword(p, 'obj')) throw new Stop('malformed');
      const body = this.value(p + 3, 0);
      let after = this.ws(body.end);
      let out: PdfValue | PdfStream = body.v;
      if (this.keyword(after, 'stream')) {
        if (!isDict(body.v)) throw new Stop('malformed');
        after += 6;
        if (this.b[after] === 13 && this.b[after + 1] === 10) after += 2;
        else if (this.b[after] === 10) after += 1;
        else throw new Stop('malformed');
        out = { dict: body.v, data: after };
      }
      this.cache.set(ref.n, out);
      return out;
    } finally {
      this.resolving.delete(ref.n);
    }
  }

  /** A stream's raw bytes, `length` long, checked against `endstream`. */
  streamBytes(s: PdfStream, length: number): Uint8Array {
    const end = s.data + length;
    if (end > this.b.length) throw new Stop('malformed');
    let q = end;
    if (this.b[q] === 13) q += 1;
    if (this.b[q] === 10) q += 1;
    if (!this.keyword(this.ws(q), 'endstream')) throw new Stop('malformed');
    return this.b.slice(s.data, end);
  }
}

function isDict(v: unknown): v is PdfDict {
  return typeof v === 'object' && v !== null && 't' in v && (v as PdfDict).t === 'dict';
}
function isStream(v: unknown): v is PdfStream {
  return typeof v === 'object' && v !== null && 'dict' in v && 'data' in v;
}
function nameOf(v: unknown): string | null {
  return typeof v === 'object' && v !== null && 't' in v && (v as PdfName).t === 'name'
    ? (v as PdfName).v
    : null;
}

/** A PDF text string (UTF-16BE with its BOM, else PDFDocEncoding's ASCII range only). */
function textOf(v: unknown): string | null {
  if (typeof v !== 'object' || v === null || !('t' in v) || (v as PdfString).t !== 'str')
    return null;
  const b = (v as PdfString).b;
  if (b[0] === 0xfe && b[1] === 0xff) {
    if (b.length % 2) return null;
    let s = '';
    for (let i = 2; i < b.length; i += 2)
      s += String.fromCharCode(((b[i] as number) << 8) | (b[i + 1] as number));
    return s;
  }
  for (const c of b) if (c > 0x7e) return null;
  return String.fromCharCode(...b);
}

/**
 * Extracts the embedded Keep JSON of a receipt PDF, or says why not. The text is the attachment's
 * exact bytes as UTF-8; the caller parses and verifies it as it would the JSON download.
 */
export function extractReceiptPdfRecord(
  bytes: Uint8Array,
  bounds: ReceiptPdfBounds = RECEIPT_PDF_BOUNDS,
): ReceiptPdfExtraction {
  if (bytes.length > bounds.pdfMaxBytes) return { ok: false, reason: 'too_large' };
  const head = ascii('%PDF-1.');
  if (bytes.length < 64 || head.some((c, i) => bytes[i] !== c))
    return { ok: false, reason: 'not_pdf' };
  const p = new Parser(bytes, bounds);
  try {
    p.readXref();
    const root = p.resolve(p.trailer?.m.get('Root'));
    if (!isDict(root) || nameOf(root.m.get('Type')) !== 'Catalog')
      return { ok: false, reason: 'malformed' };

    const named = (fs: PdfDict) => textOf(fs.m.get('UF')) ?? textOf(fs.m.get('F'));
    // The associated files of the document (PDF/A-3 /AF on the catalog).
    const af = p.resolve(root.m.get('AF'));
    const candidates: { spec: PdfDict; ref: PdfValue }[] = [];
    if (Array.isArray(af)) {
      if (af.length > 64) return { ok: false, reason: 'work_exceeded' };
      for (const item of af) {
        const spec = p.resolve(item);
        if (!isDict(spec) || named(spec) !== RECEIPT_PDF_ATTACHMENT_NAME) continue;
        if (nameOf(spec.m.get('AFRelationship')) !== RECEIPT_PDF_ATTACHMENT_RELATIONSHIP) continue;
        candidates.push({ spec, ref: item });
      }
    } else if (af !== undefined) return { ok: false, reason: 'malformed' };
    if (candidates.length === 0) return { ok: false, reason: 'no_record' };
    if (candidates.length > 1) return { ok: false, reason: 'ambiguous_record' };
    const chosen = candidates[0] as { spec: PdfDict; ref: PdfValue };

    // Another embedded file of the same name (the document's name tree) is ambiguous. The tree is
    // read once: a node, child list or leaf array reached a second time (shared or cyclic) is
    // malformed, each entry and child is charged to the work budget, and a file specification named
    // by several entries is checked once.
    const names = p.resolve(root.m.get('Names'));
    const tree = isDict(names) ? p.resolve(names.m.get('EmbeddedFiles')) : undefined;
    const reached = new Set<object>();
    const once = (o: object) => {
      if (reached.has(o)) throw new Stop('malformed');
      reached.add(o);
    };
    const checked = new Set<PdfDict>();
    let visited = 0;
    const walk = (node: PdfValue | PdfStream | undefined, depth: number): boolean => {
      if (!isDict(node)) return false;
      if (++visited > 4096 || depth > bounds.maxNesting) throw new Stop('work_exceeded');
      once(node);
      const leaf = p.resolve(node.m.get('Names'));
      if (Array.isArray(leaf)) {
        once(leaf);
        for (let i = 0; i + 1 < leaf.length; i += 2) {
          p.work();
          const spec = p.resolve(leaf[i + 1]);
          if (!isDict(spec) || checked.has(spec)) continue;
          checked.add(spec);
          if (named(spec) === RECEIPT_PDF_ATTACHMENT_NAME && spec !== chosen.spec) return true;
        }
      }
      const kids = p.resolve(node.m.get('Kids'));
      if (Array.isArray(kids)) {
        once(kids);
        for (const k of kids) {
          p.work();
          if (walk(p.resolve(k), depth + 1)) return true;
        }
      }
      return false;
    };
    if (tree !== undefined && walk(tree, 0)) return { ok: false, reason: 'ambiguous_record' };

    const ef = p.resolve(chosen.spec.m.get('EF'));
    if (!isDict(ef)) return { ok: false, reason: 'malformed' };
    const stream = p.resolve(ef.m.get('F'));
    if (!isStream(stream)) return { ok: false, reason: 'malformed' };
    const d = stream.dict.m;
    if (nameOf(d.get('Subtype')) !== RECEIPT_PDF_ATTACHMENT_TYPE)
      return { ok: false, reason: 'outside_profile' };
    const filter = d.get('Filter');
    if (filter !== undefined && !(Array.isArray(filter) && filter.length === 0))
      return { ok: false, reason: 'outside_profile' };
    if (d.has('DecodeParms') || d.has('F')) return { ok: false, reason: 'outside_profile' };
    const length = p.resolve(d.get('Length'));
    if (typeof length !== 'number' || !Number.isInteger(length) || length < 0)
      return { ok: false, reason: 'malformed' };
    if (length > bounds.attachmentMaxBytes) return { ok: false, reason: 'record_too_large' };
    const params = p.resolve(d.get('Params'));
    if (isDict(params)) {
      const size = p.resolve(params.m.get('Size'));
      if (size !== undefined && size !== length) return { ok: false, reason: 'malformed' };
    }
    const data = p.streamBytes(stream, length);
    let text: string;
    try {
      text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: false }).decode(data);
    } catch {
      return { ok: false, reason: 'malformed' };
    }
    return { ok: true, text };
  } catch (e) {
    if (e instanceof Stop) return { ok: false, reason: e.reason };
    if (e instanceof RangeError) return { ok: false, reason: 'work_exceeded' };
    throw e;
  }
}
