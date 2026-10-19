// A minimal, strict DER reader for witness evidence verification (RFC 3161 timestamp tokens,
// X.509 extensions). Definite lengths only, minimal length encoding, bounded depth and size;
// anything else is malformed. It reads exactly what the witness verifier needs and is not a
// general ASN.1 library. Ported unchanged from the Sess evidence package (witness/der.ts at the
// commit recorded in docs/spec/source.json); the request writer, which only an issuer needs, is
// omitted.

export class DerError extends Error {
  override name = 'DerError';
}

/** One DER element: its tag byte, its content bytes and its full encoding. */
export interface Der {
  tag: number;
  /** Content octets. */
  value: Uint8Array;
  /** The whole element (tag, length, content), as it appeared. */
  raw: Uint8Array;
}

const MAX_INPUT = 64 * 1024;

export const TAG = {
  BOOLEAN: 0x01,
  INTEGER: 0x02,
  BIT_STRING: 0x03,
  OCTET_STRING: 0x04,
  NULL: 0x05,
  OID: 0x06,
  UTF8_STRING: 0x0c,
  GENERALIZED_TIME: 0x18,
  SEQUENCE: 0x30,
  SET: 0x31,
} as const;

/** Context-specific tag `[n]`, constructed or primitive. */
export const ctx = (n: number, constructed = true) => (constructed ? 0xa0 : 0x80) | n;

/** Reads one element at `offset`; returns it and the offset after it. */
function readAt(buf: Uint8Array, offset: number): { el: Der; next: number } {
  if (offset + 2 > buf.length) throw new DerError('truncated element');
  const tag = buf[offset] as number;
  if ((tag & 0x1f) === 0x1f) throw new DerError('high tag numbers are not supported');
  let len = buf[offset + 1] as number;
  let pos = offset + 2;
  if (len & 0x80) {
    const n = len & 0x7f;
    if (n === 0) throw new DerError('indefinite length is not DER');
    if (n > 3) throw new DerError('length too large');
    if (pos + n > buf.length) throw new DerError('truncated length');
    len = 0;
    for (let i = 0; i < n; i++) len = (len << 8) | (buf[pos + i] as number);
    if (buf[pos] === 0 || len < 0x80) throw new DerError('non-minimal length');
    pos += n;
  }
  const end = pos + len;
  if (end > buf.length) throw new DerError('truncated content');
  return {
    el: { tag, value: buf.subarray(pos, end), raw: buf.subarray(offset, end) },
    next: end,
  };
}

/** Parses exactly one element spanning all of `bytes`. */
export function parseDer(bytes: Uint8Array): Der {
  if (bytes.length > MAX_INPUT) throw new DerError('input exceeds its bound');
  const { el, next } = readAt(bytes, 0);
  if (next !== bytes.length) throw new DerError('trailing bytes after the element');
  return el;
}

/** The children of a constructed element. */
export function children(el: Der): Der[] {
  if ((el.tag & 0x20) === 0) throw new DerError('not a constructed element');
  const out: Der[] = [];
  let pos = 0;
  while (pos < el.value.length) {
    if (out.length >= 256) throw new DerError('too many children');
    const { el: c, next } = readAt(el.value, pos);
    out.push(c);
    pos = next;
  }
  return out;
}

/** The element must have `tag`. */
export function expect(el: Der | undefined, tag: number, what: string): Der {
  if (!el || el.tag !== tag) throw new DerError(`${what}: unexpected element`);
  return el;
}

/** Decodes an OBJECT IDENTIFIER to dotted form. */
export function oid(el: Der | undefined): string {
  const v = expect(el, TAG.OID, 'object identifier').value;
  if (v.length === 0 || ((v.at(-1) as number) & 0x80) !== 0) throw new DerError('bad OID');
  const arcs: number[] = [];
  let acc = 0;
  for (let i = 0; i < v.length; i++) {
    const b = v[i] as number;
    if (acc === 0 && b === 0x80) throw new DerError('non-minimal OID arc');
    acc = acc * 128 + (b & 0x7f);
    if (acc > Number.MAX_SAFE_INTEGER) throw new DerError('OID arc too large');
    if ((b & 0x80) === 0) {
      if (arcs.length === 0) {
        const first = acc < 40 ? 0 : acc < 80 ? 1 : 2;
        arcs.push(first, acc - first * 40);
      } else arcs.push(acc);
      acc = 0;
    }
  }
  return arcs.join('.');
}

/** An INTEGER's content as unsigned big-endian bytes (minimal; negatives refused). */
export function integerBytes(el: Der | undefined): Uint8Array {
  const v = expect(el, TAG.INTEGER, 'integer').value;
  if (v.length === 0) throw new DerError('empty integer');
  if (((v[0] as number) & 0x80) !== 0) throw new DerError('negative integer');
  if (v.length > 1 && v[0] === 0 && ((v[1] as number) & 0x80) === 0)
    throw new DerError('non-minimal integer');
  return v[0] === 0 && v.length > 1 ? v.subarray(1) : v;
}

/** A small INTEGER as a number. */
export function smallInt(el: Der | undefined): number {
  const b = integerBytes(el);
  if (b.length > 6) throw new DerError('integer too large');
  let n = 0;
  for (const x of b) n = n * 256 + x;
  return n;
}

/** A GeneralizedTime (RFC 3161 genTime: UTC "Z", optional fraction without trailing zeros). */
export function generalizedTime(el: Der | undefined): Date {
  const s = Buffer.from(expect(el, TAG.GENERALIZED_TIME, 'generalized time').value).toString('latin1');
  const m = /^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})(?:\.(\d*[1-9]))?Z$/.exec(s);
  if (!m) throw new DerError('generalized time is not RFC 3161 UTC form');
  const [y, mo, day, h, mi, sec] = m.slice(1, 7).map(Number) as [
    number,
    number,
    number,
    number,
    number,
    number,
  ];
  const ms = m[7] ? Math.floor(Number(`0.${m[7]}`) * 1000) : 0;
  const d = new Date(Date.UTC(y, mo - 1, day, h, mi, sec, ms));
  // No rollover: every field must be in range (month 13, 31 February, 24:00 and 60 s are refused).
  if (
    Number.isNaN(d.getTime()) ||
    d.getUTCFullYear() !== y ||
    d.getUTCMonth() !== mo - 1 ||
    d.getUTCDate() !== day ||
    d.getUTCHours() !== h ||
    d.getUTCMinutes() !== mi ||
    d.getUTCSeconds() !== sec
  )
    throw new DerError('invalid generalized time');
  return d;
}

export const OID = {
  sha256: '2.16.840.1.101.3.4.2.1',
  sha384: '2.16.840.1.101.3.4.2.2',
  sha512: '2.16.840.1.101.3.4.2.3',
  signedData: '1.2.840.113549.1.7.2',
  tstInfo: '1.2.840.113549.1.9.16.1.4',
  contentType: '1.2.840.113549.1.9.3',
  messageDigest: '1.2.840.113549.1.9.4',
  signingCertificateV2: '1.2.840.113549.1.9.16.2.47',
  signingCertificate: '1.2.840.113549.1.9.16.2.12',
  ecdsaWithSha256: '1.2.840.10045.4.3.2',
  ecdsaWithSha384: '1.2.840.10045.4.3.3',
  ecdsaWithSha512: '1.2.840.10045.4.3.4',
  extKeyUsage: '2.5.29.37',
  timeStamping: '1.3.6.1.5.5.7.3.8',
} as const;
