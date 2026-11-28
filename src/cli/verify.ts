// `sess verify <file>`: the CLI face of receipt verification. It checks a decision bundle (one answer
// with its content), a closing receipt, or a kept file (keep-v1 to keep-v4) with the SDK's own
// verifiers: verifyDecisionBundle for each answer and verifyClosingReceipt for the closing receipt
// and its set. The keys come from a file you give (--keys; then nothing is fetched) or from one
// fetch of the issuer's published key set (./keys.ts); keys inside a file are never trusted. Each
// answer is judged at the time Sess says it signed it, as Sess's own set check does, unless --now
// is given. It never prints the receipt, the disclosed content or any key material.
//
// Every human-facing line here is proposed wording, awaiting sign-off.
import { open } from 'node:fs/promises';
import { parseArgs } from 'node:util';
import { SessError } from '../errors.js';
import {
  CLOCK_TOLERANCE_S,
  verifyDecisionBundle,
  type DecisionBundleVerification,
  type ExpectedBundleContext,
} from '../receipts/bundle.js';
import { verifyClosingReceipt, type ClosingReceiptClaims } from '../receipts/closing.js';
import { SDK_VERSION } from '../internal/version.js';
import { BUNDLED_RENDERER_IDENTITIES } from '../receipts/renderers.js';
import { validateKeySet, verifyRendererIdentities, type ReceiptKeySet } from '../receipts/verify.js';
import { extractReceiptPdfRecord, type ReceiptPdfRejection } from '../receipts/pdf-extract.js';
import { isKeptFile, MAX_KEPT_FILE_BYTES, readKeptFile, type KeptRound } from './kept.js';
import { fetchPublishedKeys, keySetUrl, type FetchKeys } from './keys.js';

/**
 * Exit codes: verified; unverified (something checked failed); usage, file or refusal; newer than
 * this release checks (never a failure); the published keys could not be fetched or used (nothing
 * was checked); not everything in the file could be checked (nothing failed).
 */
export const EXIT = Object.freeze({
  valid: 0,
  invalid: 1,
  usage: 2,
  newer: 3,
  keysUnavailable: 4,
  notAllChecked: 5,
});

/** The issuer whose published keys are fetched when --issuer is not given. */
export const DEFAULT_ISSUER = 'https://api.sess.si';

/** A bundle larger than this is not read (the bundle bound itself is 1 MiB canonical). */
const MAX_BUNDLE_FILE_BYTES = 16 * 1024 * 1024;
const MAX_KEYS_FILE_BYTES = 1024 * 1024;
const MAX_RENDERERS_FILE_BYTES = 64 * 1024;
const CLOSING_RECEIPT_TYP = 'sess-closing-receipt+jwt';
const COMPACT_JWS = /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/;
const SESS_TYP = /^sess-[a-z0-9]+(?:-[a-z0-9]+)*\+jwt$/;
const QR_VERIFY_LINK = 'https://sess.si/verify#';

export interface CliIo {
  stdout: (text: string) => void;
  stderr: (text: string) => void;
  /** The fetch used for the published keys (tests); defaults to the global fetch. */
  fetch?: FetchKeys;
  /** The current time in milliseconds (tests); defaults to Date.now. */
  clock?: () => number;
}

export const USAGE = `Usage: sess verify <file> [options]

Checks a Sess receipt on this computer: a decision bundle (one answer and its content), a closing
receipt, or a kept file (.json). Keys inside the file are never trusted.

Keys:
  --keys <file>       the issuer's public keys (a JWK Set) you obtained yourself; with it,
                      nothing is fetched
  --issuer <url>      the receipt issuer you trust (default ${DEFAULT_ISSUER})
  Without --keys, the command fetches the issuer's published keys once
  (<issuer>/.well-known/sess-receipt-keys.json) and sends nothing else.

Expected context (optional; only what you pass is checked):
  --audience <id>     the workspace the receipt must belong to
  --workspace <id>    the workspace ID
  --session <id>      the Session ID
  --event <id>        the Event ID (a decision bundle only)
  --revision <n>      the Surface revision (a decision bundle only)
  --action <id>       the action ID (a decision bundle only)

Renderer identity (optional):
  --renderers <file>  the issuer's signed renderer list you obtained yourself
                      (<issuer>/.well-known/sess-renderer-identities.json); also checks that each
                      answer's renderer identity is one this release knows or one on that list

Other:
  --now <time>        check at this RFC 3339 time; without it, each answer is checked at the
                      time Sess says it signed it, and a receipt dated after this computer's
                      time is refused
  --json              print the full result as JSON
  -h, --help          show this help

Exit status: 0 verified, 1 unverified, 2 usage or file error, 3 newer than this version checks,
4 the published keys could not be fetched, 5 not everything in the file could be checked.

It checks a receipt PDF from Sess. It does not read QR codes.
`;

class UsageError extends Error {}

const STRING_OPTIONS = [
  'issuer',
  'keys',
  'audience',
  'workspace',
  'session',
  'event',
  'revision',
  'action',
  'now',
  'renderers',
] as const;

const RFC3339 = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$/;

/** A character class of code point ranges, written as escapes (no raw control in this source). */
function charClass(ranges: readonly (readonly [number, number])[]): RegExp {
  const hex = (n: number) => `\\u${n.toString(16).padStart(4, '0')}`;
  return new RegExp(`[${ranges.map(([a, b]) => `${hex(a)}-${hex(b)}`).join('')}]`, 'g');
}
/** C1 controls, bidi marks, embeddings, overrides and isolates, and line and paragraph separators. */
const BEYOND_C0: readonly (readonly [number, number])[] = [
  [0x7f, 0x9f],
  [0x200e, 0x200f],
  [0x2028, 0x2029],
  [0x202a, 0x202e],
  [0x2066, 0x2069],
];
/** Characters a terminal could interpret: C0 controls and the above. */
const TERMINAL_UNSAFE = charClass([[0x00, 0x1f], ...BEYOND_C0]);
/** What JSON.stringify can leave raw inside strings (it already escapes C0 controls). */
const JSON_UNSAFE = charClass(BEYOND_C0);
const escapeChar = (c: string) => `\\u${c.charCodeAt(0).toString(16).padStart(4, '0')}`;

/** Escapes characters a terminal could interpret (controls, bidi overrides, line separators). */
function safe(text: string): string {
  return text.replace(TERMINAL_UNSAFE, escapeChar);
}

/**
 * Reads a whole file into one buffer of its size, refusing it above `max` before reading. No
 * chunks are concatenated: the bytes are held once, and a file that changes size while it is read
 * is refused.
 */
async function readBounded(path: string, max: number, what: string): Promise<Buffer> {
  let handle: Awaited<ReturnType<typeof open>>;
  try {
    handle = await open(path, 'r');
  } catch {
    throw new UsageError(`cannot read ${what}: ${safe(path)}`);
  }
  try {
    let size: number;
    try {
      const info = await handle.stat();
      if (!info.isFile()) throw new UsageError(`${what} is not a file: ${safe(path)}`);
      size = info.size;
    } catch (e) {
      if (e instanceof UsageError) throw e;
      throw new UsageError(`cannot read ${what}: ${safe(path)}`);
    }
    if (size > max) throw new UsageError(`${what} is larger than ${max} bytes: ${safe(path)}`);
    const bytes = Buffer.allocUnsafe(size);
    let complete: boolean;
    try {
      let filled = 0;
      while (filled < size) {
        const { bytesRead } = await handle.read(bytes, filled, size - filled, filled);
        if (bytesRead === 0) break;
        filled += bytesRead;
      }
      const extra = await handle.read(Buffer.alloc(1), 0, 1, size);
      complete = filled === size && extra.bytesRead === 0;
    } catch {
      throw new UsageError(`cannot read ${what}: ${safe(path)}`);
    }
    if (!complete) throw new UsageError(`${what} changed while it was read: ${safe(path)}`);
    return bytes;
  } finally {
    await handle.close().catch(() => undefined);
  }
}

function decodeUtf8(bytes: Uint8Array): string | undefined {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    return undefined;
  }
}

function parseJson(text: string | undefined): { ok: true; value: unknown } | { ok: false } {
  if (text === undefined) return { ok: false };
  try {
    return { ok: true, value: JSON.parse(text) as unknown };
  } catch {
    return { ok: false };
  }
}

/** A compact JWS's protected `typ` and `kid`, and its payload's `iat` and `aud`: unverified. */
function peek(jws: unknown): { typ?: unknown; kid?: unknown; iat?: unknown; aud?: unknown } {
  // An empty signature (alg none) still has a header and payload to read; the verifier refuses it.
  if (typeof jws !== 'string' || !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]*$/.test(jws)) return {};
  const [h, p] = jws.split('.') as [string, string];
  const json = (s: string): Record<string, unknown> => {
    try {
      const v = JSON.parse(Buffer.from(s, 'base64url').toString('utf8')) as unknown;
      return v !== null && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
    } catch {
      return {};
    }
  };
  const header = json(h);
  const payload = json(p);
  return { typ: header.typ, kid: header.kid, iat: payload.iat, aud: payload.aud };
}

/**
 * The time an answer is judged at, and whether that is its signing time. With --now, --now.
 * Otherwise the time Sess says it signed the receipt (its `iat`, which the signature covers), as
 * Sess's own set check does (closing-receipt-v1 §6.1), so an answer past its `exp` still checks;
 * but never later than this computer's clock: a receipt dated in the future is judged now, and the
 * verifier refuses it as `not_yet_valid` beyond its clock-skew allowance. An unreadable `iat`
 * gives the epoch, and the verifier then refuses the receipt on its own terms.
 */
function judgedAt(receipt: unknown, parsed: Parsed): { at: Date; atSigning: boolean } {
  if (parsed.now) return { at: parsed.now, atSigning: false };
  const iat = peek(receipt).iat;
  const signed = Number.isSafeInteger(iat) ? (iat as number) * 1000 : 0;
  return signed <= parsed.clockMs
    ? { at: new Date(signed), atSigning: true }
    : { at: new Date(parsed.clockMs), atSigning: false };
}

/** Whether a verified signing time (`iat`, seconds) is later than the clock plus the allowance. */
function datedInFuture(iat: number, parsed: Parsed): boolean {
  const at = parsed.now ? parsed.now.getTime() : parsed.clockMs;
  return iat > Math.floor(at / 1000) + CLOCK_TOLERANCE_S;
}

interface Parsed {
  file: string;
  issuer: string;
  keysPath: string | undefined;
  renderersPath: string | undefined;
  context: ExpectedBundleContext | undefined;
  now: Date | undefined;
  /** This computer's clock, read once when the command starts (milliseconds). */
  clockMs: number;
  json: boolean;
}

function parse(argv: readonly string[], clockMs: number): Parsed | 'help' {
  let parsed: ReturnType<typeof parseArgs>;
  try {
    parsed = parseArgs({
      args: [...argv],
      allowPositionals: true,
      strict: true,
      tokens: true,
      options: {
        ...Object.fromEntries(STRING_OPTIONS.map((name) => [name, { type: 'string' as const }])),
        json: { type: 'boolean' },
        help: { type: 'boolean', short: 'h' },
      },
    });
  } catch {
    throw new UsageError('unknown option or missing option value');
  }
  const values = parsed.values as Record<string, string | boolean | undefined>;
  if (values.help) return 'help';
  // A trust setting given twice is ambiguous: refuse rather than pick one.
  const seen = new Set<string>();
  for (const token of parsed.tokens ?? []) {
    if (token.kind !== 'option') continue;
    if (seen.has(token.name)) throw new UsageError(`--${token.name} is given more than once`);
    seen.add(token.name);
  }
  const [command, file, ...rest] = parsed.positionals;
  if (command !== 'verify') throw new UsageError('the only command is: verify <file>');
  if (file === undefined || rest.length > 0) throw new UsageError('give exactly one file');
  const str = (name: (typeof STRING_OPTIONS)[number]) => {
    const v = values[name];
    if (v === undefined) return undefined;
    if (typeof v !== 'string' || v.length === 0) throw new UsageError(`--${name} needs a value`);
    return v;
  };
  const issuer = str('issuer') ?? DEFAULT_ISSUER;
  const keysPath = str('keys');
  // Without --keys the issuer's published keys are fetched: only from an HTTPS origin.
  if (keysPath === undefined && keySetUrl(issuer) === undefined)
    throw new UsageError(
      '--issuer must be an https origin (for example https://api.sess.si) to fetch its published keys; or give --keys',
    );
  const revisionText = str('revision');
  let revision: number | undefined;
  if (revisionText !== undefined) {
    revision = Number(revisionText);
    if (!/^[1-9][0-9]*$/.test(revisionText) || !Number.isSafeInteger(revision))
      throw new UsageError('--revision must be a positive integer');
  }
  const nowText = str('now');
  let now: Date | undefined;
  if (nowText !== undefined) {
    now = new Date(nowText);
    if (!RFC3339.test(nowText) || Number.isNaN(now.getTime()))
      throw new UsageError('--now must be an RFC 3339 time, for example 2026-10-09T12:05:00Z');
  }
  const context: ExpectedBundleContext = {};
  const audience = str('audience');
  const workspaceId = str('workspace');
  const sessionId = str('session');
  const eventId = str('event');
  const actionId = str('action');
  if (audience !== undefined) context.audience = audience;
  if (workspaceId !== undefined) context.workspaceId = workspaceId;
  if (sessionId !== undefined) context.sessionId = sessionId;
  if (eventId !== undefined) context.eventId = eventId;
  if (revision !== undefined) context.revision = revision;
  if (actionId !== undefined) context.actionId = actionId;
  return {
    file,
    issuer,
    keysPath,
    renderersPath: str('renderers'),
    context: Object.keys(context).length > 0 ? context : undefined,
    now,
    clockMs,
    json: values.json === true,
  };
}

// ------------------------------------------------------------------------------------------------
// Words (every line proposed wording, awaiting sign-off)
// ------------------------------------------------------------------------------------------------

const REASON_TEXT: Record<string, string> = {
  malformed: 'This file is not a receipt, bundle or kept file this command reads.',
  kept_malformed: 'This kept file is not in a form this command reads.',
  oversized: 'The bundle exceeds a decision bundle size bound.',
  receipt_malformed: 'The receipt cannot be read.',
  algorithm: 'The receipt does not use the EdDSA algorithm.',
  missing_kid: 'The receipt names no key.',
  unknown_kid: 'This receipt names a key that is not among the keys used for this check.',
  type: 'The receipt has the wrong type.',
  signature: 'The signature does not match the key it names.',
  issuer: 'This receipt names another issuer.',
  audience: 'This receipt belongs to another workspace.',
  expired: 'The receipt had expired at the time it was checked.',
  claims: 'The receipt claims are not valid receipt claims.',
  revision: 'The revision envelope is missing or is not the one the receipt signed.',
  not_yet_valid: 'The receipt is dated after the time it was checked.',
  surface_mismatch: 'The disclosed Surface is not the one the receipt signed.',
  input_mismatch: 'The disclosed input is not the one the receipt signed.',
  context_mismatch: 'The receipt is not the one you expected.',
  renderer: 'The receipt names a renderer identity that is neither known nor on the signed list.',
  header: 'The receipt header has missing or unsupported fields.',
  unsupported: 'The receipt format version is not supported.',
  rounds: 'The closing receipt does not cover exactly the answers in this file.',
  round_context:
    'An answer in this file names another issuer, workspace or Session than the closing receipt.',
};

const NEWER_FILE = `This file is newer than @sess.si/sdk ${SDK_VERSION}. Update @sess.si/sdk to check it.`;
const NEWER_BUNDLE = `This bundle is newer than @sess.si/sdk ${SDK_VERSION}. Update @sess.si/sdk to check it.`;
// Why a PDF was not checked (Sess L-196, signed 2026-11-28 18:41Z): one line for anything the
// Sess profile's extractor (./pdf-extract.ts) cannot read, a PDF with no receipt or more than one
// included (exactly one is the rule), and one for a PDF past the profile's size bounds.
const PDF_UNREADABLE = "this PDF can't be read as a Sess receipt, so it was not checked";
const PDF_TOO_LARGE = 'this PDF is larger than a Sess receipt PDF can be, so it was not read';
const PDF_REFUSALS: Readonly<Record<ReceiptPdfRejection, string>> = Object.freeze({
  not_pdf: PDF_UNREADABLE,
  malformed: PDF_UNREADABLE,
  outside_profile: PDF_UNREADABLE,
  work_exceeded: PDF_UNREADABLE,
  no_record: PDF_UNREADABLE,
  ambiguous_record: PDF_UNREADABLE,
  too_large: PDF_TOO_LARGE,
  record_too_large: PDF_TOO_LARGE,
});
const REFUSE_QR =
  'this looks like a receipt code from a QR code, and this command does not read receipt codes: check the kept file (.json) instead';
const REFUSE_LONE_ROUND =
  "this is one answer's receipt on its own: check it with its content, in its decision bundle or the kept file that holds it";
const REFUSE_ROUND_FLAGS =
  '--event, --revision and --action check one answer: use them with a decision bundle';
const KEYS_UNREACHABLE =
  "Sess's published keys couldn't be reached, so this receipt wasn't checked. Try again in a moment.";
const KEYS_UNUSABLE =
  "The keys published at this address aren't a key set this command can use, so this receipt wasn't checked.";
const NOT_CHECKED_ROUND = 'not checked: this file holds no content for it';
const ACTOR = "someone holding the Session's human link (not a verified person)";
const AT_SIGNING = '(when Sess says it was signed)';
const NOT_READ =
  "the file's archival records, holder keys and witness evidence (this command checks the receipts)";

interface KeysSource {
  kind: 'file' | 'published';
  /** The --keys path, or the published key-set URL. */
  where: string;
}

function keysRow(source: KeysSource): string {
  return source.kind === 'file'
    ? `from ${safe(source.where)}; nothing was fetched`
    : `published at ${safe(source.where)}, fetched once`;
}

function rowWriter(lines: string[]) {
  return (label: string, value: string) => lines.push(`  ${label.padEnd(11)} ${value}`);
}

function contextText(c: DecisionBundleVerification['context']): string {
  return c.status === 'mismatch'
    ? `mismatch: ${c.mismatches.join(', ')}`
    : c.status === 'unchecked'
      ? 'unchecked (no expected context given)'
      : c.checked.length > 0
        ? `${c.status}: ${c.checked.join(', ')}`
        : c.status;
}

// ------------------------------------------------------------------------------------------------
// One decision bundle
// ------------------------------------------------------------------------------------------------

/** With --renderers: the receipt's renderer identity and whether it is known or listed. */
interface RendererCheck {
  identity: string | null;
  status: 'listed' | 'unlisted' | 'not_checked';
}

interface BundleOutcome {
  result: DecisionBundleVerification;
  renderer: RendererCheck | undefined;
  /** Whether it was judged at its own signing time (no --now, not dated in the future). */
  atSigning: boolean;
}

async function checkBundle(
  bundle: unknown,
  parsed: Parsed,
  keys: ReceiptKeySet,
  listed: readonly string[] | undefined,
  context: ExpectedBundleContext | undefined,
): Promise<BundleOutcome> {
  const receipt = (bundle as { receipt?: unknown } | null | undefined)?.receipt;
  const { at, atSigning } = judgedAt(receipt, parsed);
  let result: DecisionBundleVerification;
  try {
    // A file that is not JSON is not a bundle: the same facade reports it as malformed. A receipt
    // dated in the future is judged at this computer's time, where the facade itself refuses it
    // as `not_yet_valid` beyond its clock-skew allowance.
    result = await verifyDecisionBundle(bundle, {
      issuer: parsed.issuer,
      trustedKeys: keys,
      ...(context ? { expectedContext: context } : {}),
      now: at,
    });
  } catch {
    throw new UsageError('invalid verification options');
  }
  let renderer: RendererCheck | undefined;
  if (listed !== undefined) {
    const identity = result.receipt?.surface.renderer_version ?? null;
    renderer =
      identity === null
        ? { identity, status: 'not_checked' }
        : {
            identity,
            status:
              BUNDLED_RENDERER_IDENTITIES.includes(identity) || listed.includes(identity)
                ? 'listed'
                : 'unlisted',
          };
    if (renderer.status === 'unlisted')
      result = { ...result, valid: false, reason: 'renderer' as DecisionBundleVerification['reason'] };
  }
  return { result, renderer, atSigning };
}

function bundleSummary({ result: r, renderer, atSigning }: BundleOutcome, source: KeysSource): string {
  const lines: string[] = [];
  const row = rowWriter(lines);
  if (r.valid && r.receipt) {
    const c = r.receipt;
    lines.push('Verified: one answer and its content.');
    row('Accepted', `${safe(c.accepted_at)}, action ${safe(c.action.id)} on revision ${c.surface.revision}`);
    row('Session', `${safe(c.session_id)} (event ${safe(c.event_id)}, workspace ${safe(c.workspace_id)})`);
    row('Issuer', `${safe(c.issuer)} (key ${safe(c.key_id)})`);
    row('Actor', ACTOR);
    row('Content', 'verified');
    row('Context', contextText(r.context));
    row('Purpose', r.application_purpose);
    row('Expires', safe(c.expires_at));
    if (renderer) row('Renderer', `${safe(c.surface.renderer_version)} (listed)`);
  } else if (r.reason === 'unsupported_version') {
    // A later bundle version, receipt type or revision envelope: newer, never a damaged file.
    lines.push(NEWER_BUNDLE);
  } else {
    lines.push(`Unverified. ${REASON_TEXT[r.reason ?? ''] ?? ''}`);
    row('Reason', r.reason ?? '');
    row('Content', r.content);
    row('Context', contextText(r.context));
    if (renderer?.identity) row('Renderer', `${safe(renderer.identity)} (${renderer.status})`);
  }
  row('Checked at', atSigning ? `${r.checked_at} ${AT_SIGNING}` : r.checked_at);
  row('Keys', keysRow(source));
  return `${lines.join('\n')}\n`;
}

const bundleExit = (r: DecisionBundleVerification) =>
  r.valid ? EXIT.valid : r.reason === 'unsupported_version' ? EXIT.newer : EXIT.invalid;

// ------------------------------------------------------------------------------------------------
// A closing receipt (on its own, or a kept file's)
// ------------------------------------------------------------------------------------------------

type ClosingReason =
  | 'receipt_malformed'
  | 'algorithm'
  | 'header'
  | 'unknown_kid'
  | 'type'
  | 'signature'
  | 'issuer'
  | 'audience'
  | 'unsupported'
  | 'claims'
  | 'context_mismatch'
  | 'rounds'
  | 'round_context'
  | 'not_yet_valid'
  | 'newer';

/** verifyClosingReceipt's codes, as this command reports them. */
const CLOSING_CODES: Record<string, ClosingReason> = {
  MALFORMED_RECEIPT: 'receipt_malformed',
  UNSUPPORTED_ALGORITHM: 'algorithm',
  UNSUPPORTED_HEADER: 'header',
  UNKNOWN_KEY_ID: 'unknown_kid',
  UNSUPPORTED_TYPE: 'type',
  INVALID_SIGNATURE: 'signature',
  ISSUER_MISMATCH: 'issuer',
  AUDIENCE_MISMATCH: 'audience',
  UNSUPPORTED_RECEIPT_VERSION: 'unsupported',
  INVALID_CLAIMS: 'claims',
  NON_CANONICAL_PAYLOAD: 'claims',
  RECORD_BINDING_MISMATCH: 'context_mismatch',
  CLOSING_ROUNDS_MISMATCH: 'rounds',
  INVALID_VERIFICATION_INPUT: 'rounds',
  VERIFICATION_CONTEXT_MISSING: 'receipt_malformed',
  RECEIPT_NEWER: 'newer',
};

interface ClosingOutcome {
  valid: boolean;
  reason: ClosingReason | null;
  /** The expected members checked; none given: unchecked. */
  context: { status: 'verified' | 'unchecked' | 'mismatch'; checked: ('workspace_id' | 'session_id')[] };
  key_id: string | null;
  claims: ClosingReceiptClaims | null;
}

async function checkClosing(
  receipt: string,
  parsed: Parsed,
  keys: ReceiptKeySet,
  rounds: readonly string[] | undefined,
): Promise<ClosingOutcome> {
  const c = parsed.context ?? {};
  const checked: ('workspace_id' | 'session_id')[] = [];
  if (c.audience !== undefined || c.workspaceId !== undefined) checked.push('workspace_id');
  if (c.sessionId !== undefined) checked.push('session_id');
  // Without an expected workspace the receipt is checked against its own signed `aud`, and the
  // context is reported unchecked (as verifyDecisionBundle does).
  const declared = peek(receipt).aud;
  const audience = c.audience ?? c.workspaceId ?? (typeof declared === 'string' ? declared : '');
  const fail = (reason: ClosingReason): ClosingOutcome => ({
    valid: false,
    reason,
    context: {
      status:
        (reason === 'audience' || reason === 'context_mismatch') && checked.length > 0
          ? 'mismatch'
          : 'unchecked',
      checked,
    },
    key_id: null,
    claims: null,
  });
  let claims: ClosingReceiptClaims;
  try {
    claims = (await verifyClosingReceipt({
      receipt,
      issuer: parsed.issuer,
      audience,
      keys,
      ...(c.sessionId !== undefined ? { expected: { sessionId: c.sessionId } } : {}),
      ...(rounds !== undefined ? { rounds } : {}),
    })) as ClosingReceiptClaims;
  } catch (e) {
    if (!(e instanceof SessError)) return fail('receipt_malformed');
    return fail(CLOSING_CODES[e.code ?? ''] ?? 'receipt_malformed');
  }
  // --audience and --workspace both name the workspace: both must match.
  if (c.workspaceId !== undefined && claims.workspace_id !== c.workspaceId) return fail('context_mismatch');
  // A closing receipt has no `exp`, but its signed time is still checked against the clock (or
  // --now): one dated in the future, beyond the same allowance as an answer, is refused.
  if (datedInFuture(claims.iat, parsed)) return fail('not_yet_valid');
  const kid = peek(receipt).kid;
  return {
    valid: true,
    reason: null,
    context: { status: checked.length > 0 ? 'verified' : 'unchecked', checked },
    key_id: typeof kid === 'string' ? kid : null,
    claims,
  };
}

function closingContextText(c: ClosingOutcome['context']): string {
  return c.checked.length === 0
    ? 'unchecked (no expected context given)'
    : `${c.status}: ${c.checked.join(', ')}`;
}

function closingSummary(r: ClosingOutcome, source: KeysSource, checkedAt: string): string {
  const lines: string[] = [];
  const row = rowWriter(lines);
  if (r.valid && r.claims) {
    const c = r.claims;
    const count = c.commitments.find((x) => x.scope === 'accepted_rounds')?.count ?? 0;
    lines.push('Verified: how a Session ended, and the answers it counts.');
    row('Session', `${safe(c.session_id)} (workspace ${safe(c.workspace_id)})`);
    row('Ended', `${safe(c.terminal.cause)} at ${safe(c.effective_end_at)}`);
    row('Answers', `${count}, signed as the final set; the answers themselves are not in this file`);
    row('Issuer', `${safe(c.iss)} (key ${safe(r.key_id ?? '')})`);
    row('Context', closingContextText(r.context));
  } else if (r.reason === 'newer') {
    lines.push(NEWER_FILE);
  } else {
    lines.push(`Unverified. ${REASON_TEXT[r.reason ?? ''] ?? ''}`);
    row('Reason', r.reason ?? '');
    row('Context', closingContextText(r.context));
  }
  row('Checked at', checkedAt);
  row('Keys', keysRow(source));
  return `${lines.join('\n')}\n`;
}

const closingExit = (r: ClosingOutcome) =>
  r.valid ? EXIT.valid : r.reason === 'newer' ? EXIT.newer : EXIT.invalid;

// ------------------------------------------------------------------------------------------------
// A kept file
// ------------------------------------------------------------------------------------------------

type RoundStatus = 'verified' | 'unverified' | 'newer' | 'not_checked';

interface KeptOutcome {
  kind: 'kept_file';
  version: number;
  status: 'verified' | 'unverified' | 'newer' | 'not_all_checked';
  rounds: {
    answer: number;
    status: RoundStatus;
    result: DecisionBundleVerification | null;
    renderer?: RendererCheck;
  }[];
  closing:
    | { status: 'none' }
    | { status: 'complete' | 'failed' | 'newer'; reason: ClosingReason | null; result: ClosingOutcome };
  /** Each answer at the time Sess says it signed it, or the --now time. */
  judged_at: string;
  checked_at: string;
}

async function checkKept(
  version: number,
  rounds: KeptRound[],
  closing: string | null | undefined,
  parsed: Parsed,
  keys: ReceiptKeySet,
  listed: readonly string[] | undefined,
  checkedAt: string,
): Promise<KeptOutcome> {
  const c = parsed.context ?? {};
  const context: ExpectedBundleContext = {};
  if (c.audience !== undefined) context.audience = c.audience;
  if (c.workspaceId !== undefined) context.workspaceId = c.workspaceId;
  if (c.sessionId !== undefined) context.sessionId = c.sessionId;
  const expected = Object.keys(context).length > 0 ? context : undefined;
  const out: KeptOutcome['rounds'] = [];
  for (const [i, round] of rounds.entries()) {
    if (round.bundle === null) {
      out.push({ answer: i + 1, status: 'not_checked', result: null });
      continue;
    }
    const { result, renderer } = await checkBundle(round.bundle, parsed, keys, listed, expected);
    const status: RoundStatus = result.valid
      ? 'verified'
      : result.reason === 'unsupported_version'
        ? 'newer'
        : 'unverified';
    out.push({ answer: i + 1, status, result, ...(renderer ? { renderer } : {}) });
  }
  let closingOut: KeptOutcome['closing'] = { status: 'none' };
  if (typeof closing === 'string') {
    const result = await checkClosing(
      closing,
      parsed,
      keys,
      rounds.map((r) => r.receipt),
    );
    let reason = result.reason;
    // Every answer checked must agree with the closing receipt in its signed issuer, workspace and
    // Session (closing-receipt-v1 §6.1).
    if (result.valid && result.claims) {
      const cl = result.claims;
      for (const r of out)
        if (
          r.result?.receipt &&
          (r.result.receipt.issuer !== cl.iss ||
            r.result.receipt.workspace_id !== cl.workspace_id ||
            r.result.receipt.session_id !== cl.session_id)
        )
          reason = 'round_context';
    }
    closingOut =
      reason === null
        ? { status: 'complete', reason, result }
        : { status: reason === 'newer' ? 'newer' : 'failed', reason, result };
  }
  const any = (s: RoundStatus) => out.some((r) => r.status === s);
  const status: KeptOutcome['status'] =
    any('unverified') || closingOut.status === 'failed'
      ? 'unverified'
      : any('newer') || closingOut.status === 'newer'
        ? 'newer'
        : any('not_checked')
          ? 'not_all_checked'
          : 'verified';
  return {
    kind: 'kept_file',
    version,
    status,
    rounds: out,
    closing: closingOut,
    judged_at: parsed.now ? parsed.now.toISOString() : 'signing_time',
    checked_at: checkedAt,
  };
}

function keptSummary(k: KeptOutcome, source: KeysSource): string {
  const lines: string[] = [];
  const row = rowWriter(lines);
  const n = k.rounds.length;
  const answers = n === 1 ? '1 answer' : `${n} answers`;
  const notChecked = k.rounds.filter((r) => r.status === 'not_checked').length;
  if (k.status === 'verified') lines.push(`Verified: a kept file with ${answers}, each checked.`);
  else if (k.status === 'newer') lines.push(NEWER_FILE);
  else if (k.status === 'not_all_checked')
    lines.push(
      `Not everything was checked. ${notChecked} of ${n} answers have no content in this file, so they were not checked. Nothing failed.`,
    );
  else {
    const failed = k.rounds.find((r) => r.status === 'unverified');
    lines.push(
      failed
        ? `Unverified. Answer ${failed.answer} of ${n}: ${REASON_TEXT[failed.result?.reason ?? ''] ?? ''}`
        : `Unverified. ${REASON_TEXT[k.closing.status !== 'none' ? (k.closing.reason ?? '') : ''] ?? ''}`,
    );
  }
  for (const r of k.rounds) {
    const res = r.result;
    row(
      `Answer ${r.answer}`,
      r.status === 'verified' && res?.receipt
        ? `verified: accepted ${safe(res.receipt.accepted_at)}, action ${safe(res.receipt.action.id)}`
        : r.status === 'not_checked'
          ? NOT_CHECKED_ROUND
          : r.status === 'newer'
            ? 'newer than this version checks'
            : `unverified: ${res?.reason ?? ''}`,
    );
  }
  row(
    'Closing',
    k.closing.status === 'none'
      ? 'this file carries no closing receipt'
      : k.closing.status === 'complete'
        ? `the closing receipt covers exactly these ${answers}`
        : k.closing.status === 'newer'
          ? 'the closing receipt is newer than this version checks'
          : `unverified: ${k.closing.reason ?? ''}`,
  );
  const first = k.rounds.find((r) => r.result?.valid && r.result.receipt)?.result;
  if (first?.receipt) {
    row('Session', `${safe(first.receipt.session_id)} (workspace ${safe(first.receipt.workspace_id)})`);
    row('Issuer', safe(first.receipt.issuer));
    row('Actor', ACTOR);
    row('Context', contextText(first.context));
  }
  row('Not checked', NOT_READ);
  row('Checked at', k.judged_at === 'signing_time' ? `each answer ${AT_SIGNING}` : k.judged_at);
  row('Keys', keysRow(source));
  return `${lines.join('\n')}\n`;
}

const KEPT_EXIT = {
  verified: EXIT.valid,
  unverified: EXIT.invalid,
  newer: EXIT.newer,
  not_all_checked: EXIT.notAllChecked,
} as const;

/**
 * JSON with every terminal-sensitive character escaped; parses to the same value. JSON.stringify
 * already escapes C0 controls inside strings, and the only raw characters it can leave are inside
 * strings, where a \u escape denotes the same character.
 */
function safeJson(value: unknown): string {
  const text = JSON.stringify(value, null, 2).replace(JSON_UNSAFE, escapeChar);
  return `${text}\n`;
}

// ------------------------------------------------------------------------------------------------
// The command
// ------------------------------------------------------------------------------------------------

type FileKind =
  | { kind: 'bundle'; value: unknown; bytes: number }
  | { kind: 'closing'; receipt: string }
  | { kind: 'kept'; value: Record<string, unknown> }
  | { kind: 'newer' };

/** What the file is, from its bytes; a refusal is a usage error (exit 2). */
function classify(bytes: Buffer): FileKind {
  // A receipt PDF (Sess L-196): the kept file it carries, read by the Sess profile's own bounded
  // extractor (never the visible pages), is checked exactly as that file on its own would be.
  if (bytes.subarray(0, 5).toString('latin1') === '%PDF-') {
    const extracted = extractReceiptPdfRecord(bytes);
    if (!extracted.ok) throw new UsageError(PDF_REFUSALS[extracted.reason]);
    const json = parseJson(extracted.text);
    if (!json.ok || !isKeptFile(json.value)) throw new UsageError(PDF_UNREADABLE);
    return { kind: 'kept', value: json.value };
  }
  const text = decodeUtf8(bytes);
  const trimmed = text?.trim();
  if (trimmed !== undefined && COMPACT_JWS.test(trimmed)) {
    const typ = peek(trimmed).typ;
    if (typ === CLOSING_RECEIPT_TYP) return { kind: 'closing', receipt: trimmed };
    if (typ === 'sess-receipt+jwt' || typ === 'sess-receipt-2+jwt') throw new UsageError(REFUSE_LONE_ROUND);
    if (typeof typ === 'string' && SESS_TYP.test(typ)) return { kind: 'newer' };
  }
  if (trimmed !== undefined && (trimmed.startsWith(QR_VERIFY_LINK) || /^[A-Za-z0-9_-]{32,}$/.test(trimmed)))
    throw new UsageError(REFUSE_QR);
  const json = parseJson(text);
  if (json.ok && isKeptFile(json.value)) return { kind: 'kept', value: json.value };
  return { kind: 'bundle', value: json.ok ? json.value : undefined, bytes: bytes.length };
}

type Trusted =
  { ok: true; keys: ReceiptKeySet; source: KeysSource } | { ok: false; url: string; why: string };

async function trustedKeysFrom(parsed: Parsed, io: CliIo): Promise<Trusted> {
  if (parsed.keysPath !== undefined) {
    const keyJson = parseJson(
      decodeUtf8(await readBounded(parsed.keysPath, MAX_KEYS_FILE_BYTES, 'the --keys file')),
    );
    try {
      if (!keyJson.ok) throw new Error('not JSON');
      return {
        ok: true,
        keys: validateKeySet(keyJson.value),
        source: { kind: 'file', where: parsed.keysPath },
      };
    } catch {
      throw new UsageError(
        'the --keys file must be a JWK Set of public Ed25519 keys with unique kids (private keys are refused)',
      );
    }
  }
  const url = keySetUrl(parsed.issuer) as string;
  const fetched = await fetchPublishedKeys(url, io.fetch ?? ((u, init) => globalThis.fetch(u, init)));
  if (!fetched.ok) return { ok: false, url, why: fetched.why };
  return { ok: true, keys: fetched.keys, source: { kind: 'published', where: url } };
}

/** Runs `sess <argv>`; resolves to the exit code. Never throws. */
export async function runCli(argv: readonly string[], io: CliIo): Promise<number> {
  try {
    const parsed = parse(argv, (io.clock ?? Date.now)());
    if (parsed === 'help') {
      io.stdout(USAGE);
      return EXIT.valid;
    }
    // The file first: a file this command refuses, or cannot read, never causes a fetch.
    const file = classify(await readBounded(parsed.file, MAX_KEPT_FILE_BYTES, 'the file'));
    if (file.kind === 'bundle' && file.bytes > MAX_BUNDLE_FILE_BYTES)
      throw new UsageError(
        `the bundle file is larger than ${MAX_BUNDLE_FILE_BYTES} bytes: ${safe(parsed.file)}`,
      );
    const c = parsed.context;
    if (
      file.kind !== 'bundle' &&
      (c?.eventId !== undefined || c?.revision !== undefined || c?.actionId !== undefined)
    )
      throw new UsageError(REFUSE_ROUND_FLAGS);
    if (file.kind === 'newer') {
      io.stdout(parsed.json ? safeJson({ valid: false, reason: 'newer' }) : `${NEWER_FILE}\n`);
      return EXIT.newer;
    }
    const kept = file.kind === 'kept' ? readKeptFile(file.value) : undefined;
    if (kept && !kept.ok) {
      const newer = kept.reason === 'newer';
      io.stdout(
        parsed.json
          ? safeJson({ kind: 'kept_file', status: newer ? 'newer' : 'unverified', reason: kept.reason })
          : newer
            ? `${NEWER_FILE}\n`
            : `Unverified. ${REASON_TEXT.kept_malformed}\n  ${'Reason'.padEnd(11)} malformed\n`,
      );
      return newer ? EXIT.newer : EXIT.invalid;
    }

    const trusted = await trustedKeysFrom(parsed, io);
    if (!trusted.ok) {
      const line = trusted.why === 'unusable' ? KEYS_UNUSABLE : KEYS_UNREACHABLE;
      io.stdout(
        parsed.json
          ? safeJson({ valid: false, reason: `keys_${trusted.why}`, keys_url: trusted.url })
          : `${line}\n  ${'Keys'.padEnd(11)} ${safe(trusted.url)}\n`,
      );
      return EXIT.keysUnavailable;
    }
    const { keys, source } = trusted;

    // Decision 0009 Amendment 13: the issuer's signed renderer list, trusted only through its
    // signature under the keys above.
    let listed: readonly string[] | undefined;
    if (parsed.renderersPath !== undefined) {
      const listJson = parseJson(
        decodeUtf8(await readBounded(parsed.renderersPath, MAX_RENDERERS_FILE_BYTES, 'the --renderers file')),
      );
      try {
        if (!listJson.ok) throw new Error('not JSON');
        listed = (
          await verifyRendererIdentities(listJson.value as never, { issuer: parsed.issuer, keys })
        ).identities.map((i) => i.renderer_version);
      } catch {
        throw new UsageError(
          "the --renderers file must be the issuer's renderer list, signed with the keys you trust",
        );
      }
    }

    const checkedAt = (parsed.now ?? new Date(parsed.clockMs)).toISOString();
    if (file.kind === 'closing') {
      const r = await checkClosing(file.receipt, parsed, keys, undefined);
      io.stdout(
        parsed.json
          ? safeJson({ kind: 'closing_receipt', ...r, checked_at: checkedAt })
          : closingSummary(r, source, checkedAt),
      );
      return closingExit(r);
    }
    if (kept?.ok) {
      const k = await checkKept(kept.version, kept.rounds, kept.closing, parsed, keys, listed, checkedAt);
      io.stdout(parsed.json ? safeJson(k) : keptSummary(k, source));
      return KEPT_EXIT[k.status];
    }
    const outcome = await checkBundle(
      file.kind === 'bundle' ? file.value : undefined,
      parsed,
      keys,
      listed,
      parsed.context,
    );
    io.stdout(
      parsed.json
        ? safeJson(outcome.renderer ? { ...outcome.result, renderer: outcome.renderer } : outcome.result)
        : bundleSummary(outcome, source),
    );
    return bundleExit(outcome.result);
  } catch (e) {
    const message = e instanceof UsageError ? e.message : 'unexpected error';
    io.stderr(`sess: ${message}\nRun "sess --help" for usage.\n`);
    return EXIT.usage;
  }
}
