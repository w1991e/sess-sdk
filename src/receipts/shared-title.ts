// The shared title rule (receipt-v2 §2: one line of plain text), as the revision-envelope reader
// applies it to every owner-chosen title a receipt v2 carries (`titles.grant_title`,
// `titles.target_title`, `titles.owner_name`): the frozen receipt v2 format says each title "is
// normalised by the shared title rule before storage, and stored as normalised", so a title this
// rule would change or refuse is not a valid envelope title. Ported from the Sess security core
// (packages/security/src/shared-title.ts at the commit recorded in docs/spec/source.json) with the
// same behaviour and the same refusal vectors (tests/security/receipts-v2.test.ts).

/** A title's bound, in code points. */
export const SHARED_TITLE_MAX = 60;

/**
 * Characters owner text may not contain: C0/C1 controls other than the newline, the bidirectional
 * embedding/override/isolate controls, zero-width and invisible format characters, and unpaired
 * surrogates. A title refuses these and more (titleRefused).
 */
const FORBIDDEN_RANGES: readonly (readonly [number, number])[] = [
  [0x00, 0x09],
  [0x0b, 0x1f],
  [0x7f, 0x9f],
  [0x61c, 0x61c],
  [0x200b, 0x200f],
  [0x2028, 0x202e],
  [0x2060, 0x206f],
  [0xd800, 0xdfff],
  [0xfeff, 0xfeff],
  [0xfff9, 0xfffb],
];

const codePoints = (text: string) => [...text].length;

/**
 * The display title: one line of plain text, trimmed; no control or format character and none of
 * FORBIDDEN_RANGES, except the joiners and the three flags titleRefused allows; at most
 * SHARED_TITLE_MAX characters; at least one visible character (isVisible); null when empty.
 */
function normalizeSharedTitle(text: string): { ok: true; text: string | null } | { ok: false } {
  if (titleRefused([...text])) return { ok: false };
  const normalized = text.trim();
  if (normalized === '') return { ok: true, text: null };
  if (codePoints(normalized) > SHARED_TITLE_MAX) return { ok: false };
  if (![...normalized].some(isVisible)) return { ok: false };
  return { ok: true, text: normalized };
}

/**
 * Whether `v` is a stored title: a string the shared title rule leaves exactly as it is (a fixed
 * point of the rule, so non-empty, trimmed and within every rule above).
 */
export function isStoredSharedTitle(v: unknown): v is string {
  if (typeof v !== 'string') return false;
  const r = normalizeSharedTitle(v);
  return r.ok && r.text === v;
}

/** Every control (Cc, which covers CR and LF) and every format character (Cf). */
const TITLE_REFUSED = /[\p{Cc}\p{Cf}]/u;

const ZWNJ = 0x200c;
const ZWJ = 0x200d;
const BLACK_FLAG = 0x1f3f4;
/**
 * The only tag sequences a title may hold: the three RGI subdivision flags, exactly (England,
 * Scotland, Wales: U+1F3F4, the tag letters gbeng, gbsct or gbwls, U+E007F). Any other run of tag
 * characters is refused: it could carry hidden ASCII text behind a plain black flag.
 */
const RGI_SUBDIVISION_FLAGS: readonly (readonly number[])[] = [
  [0x1f3f4, 0xe0067, 0xe0062, 0xe0065, 0xe006e, 0xe0067, 0xe007f],
  [0x1f3f4, 0xe0067, 0xe0062, 0xe0073, 0xe0063, 0xe0074, 0xe007f],
  [0x1f3f4, 0xe0067, 0xe0062, 0xe0077, 0xe006c, 0xe0073, 0xe007f],
];
/** The length of the RGI subdivision flag starting at `i`, or 0. */
const flagAt = (cps: readonly number[], i: number) =>
  RGI_SUBDIVISION_FLAGS.find((f) => f.every((c, k) => cps[i + k] === c))?.length ?? 0;
const MARK = /\p{M}/u;
const VS15 = 0xfe0e;
const VS16 = 0xfe0f;
const EMOJI = /\p{Emoji}/u;

/**
 * True when a title (as code points) has a character it may not hold. Every Cc and Cf, every
 * default-ignorable code point and every FORBIDDEN_RANGES character is refused, with exactly three
 * exceptions that real text needs:
 * - one presentation selector (VS15, VS16) directly after an emoji character;
 * - ZWNJ and ZWJ between two visible characters (the left neighbour is the base of the grapheme
 *   before the joiner: combining marks after it are skipped);
 * - the three RGI subdivision flags, each as its exact code points.
 */
function titleRefused(chars: string[]): boolean {
  const cps = chars.map((ch) => ch.codePointAt(0) as number);
  for (let i = 0; i < cps.length; i++) {
    const c = cps[i] as number;
    if (c === BLACK_FLAG) {
      const flag = flagAt(cps, i);
      if (flag > 0) i += flag - 1; // the whole flag, its cancel tag included
      continue; // a plain black flag is a symbol; tags after it fall to the Cf check
    }
    if (c === ZWNJ || c === ZWJ) {
      let left = i - 1;
      while (left >= 0 && MARK.test(chars[left] as string)) left--;
      const before = chars[left];
      const after = chars[i + 1];
      if (before === undefined || after === undefined || !isVisible(before) || !isVisible(after)) return true;
      continue;
    }
    if (c === VS15 || c === VS16) {
      const base = chars[i - 1];
      if (base === undefined || !EMOJI.test(base) || IGNORABLE.test(base)) return true;
      continue;
    }
    if (IGNORABLE.test(chars[i] as string)) return true;
    if (TITLE_REFUSED.test(chars[i] as string)) return true;
    if (FORBIDDEN_RANGES.some(([lo, hi]) => c >= lo && c <= hi)) return true;
  }
  return false;
}

/**
 * A visible character: a letter, number, symbol or punctuation (L, N, S, P) that is not a
 * default-ignorable code point (the Hangul fillers are letters by category but draw blank) and not
 * U+2800, the blank Braille pattern. Spaces, marks alone and private use do not count.
 */
const VISIBLE = /[\p{L}\p{N}\p{S}\p{P}]/u;
const IGNORABLE = /\p{Default_Ignorable_Code_Point}/u;
const isVisible = (ch: string) => VISIBLE.test(ch) && !IGNORABLE.test(ch) && ch.codePointAt(0) !== 0x2800;
