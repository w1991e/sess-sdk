// `sess verify <file>`: the CLI face of decision-bundle verification. Offline only: it reads the
// bundle and the keys the caller trusts from local files, verifies with verifyDecisionBundle and
// prints a short summary (or the result object with --json). It opens no network connection and
// never prints the receipt, the disclosed content or any key material.
import { readFile, stat } from 'node:fs/promises';
import { parseArgs } from 'node:util';
import {
  verifyDecisionBundle,
  type DecisionBundleVerification,
  type ExpectedBundleContext,
} from '../receipts/bundle.js';
import { BUNDLED_RENDERER_IDENTITIES } from '../receipts/renderers.js';
import { validateKeySet, verifyRendererIdentities } from '../receipts/verify.js';

/** Exit codes: valid, invalid bundle, usage or file error. */
export const EXIT = Object.freeze({ valid: 0, invalid: 1, usage: 2 });

/** A bundle file larger than this is not read (the bundle bound itself is 1 MiB canonical). */
const MAX_BUNDLE_FILE_BYTES = 16 * 1024 * 1024;
const MAX_KEYS_FILE_BYTES = 1024 * 1024;
const MAX_RENDERERS_FILE_BYTES = 64 * 1024;

export interface CliIo {
  stdout: (text: string) => void;
  stderr: (text: string) => void;
}

export const USAGE = `Usage: sess verify <bundle.json> --issuer <url> --keys <jwks.json> [options]

Checks a Sess decision bundle on this computer against the issuer and keys you trust.
Nothing is sent anywhere. Keys inside the bundle are never trusted.

Required:
  --issuer <url>      the receipt issuer you trust, for example https://api.sess.si
  --keys <file>       that issuer's public keys (a JWK Set) you obtained yourself

Expected context (optional; only what you pass is checked):
  --audience <id>     the workspace the decision must belong to
  --workspace <id>    the workspace ID
  --session <id>      the Session ID
  --event <id>        the Event ID
  --revision <n>      the Surface revision
  --action <id>       the action ID

Renderer identity (optional):
  --renderers <file>  the issuer's signed renderer list you obtained yourself
                      (<issuer>/.well-known/sess-renderer-identities.json); also checks that the
                      receipt's renderer identity is one this release knows or one on that list

Other:
  --now <time>        check at this RFC 3339 time instead of now
  --json              print the full result as JSON
  -h, --help          show this help

Exit status: 0 valid, 1 invalid, 2 usage or file error.
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

/** Escapes characters a terminal could interpret (controls, bidi overrides, line separators). */
function safe(text: string): string {
  return text.replace(
    /[\u0000-\u001f\u007f-\u009f\u200e\u200f\u2028\u2029\u202a-\u202e\u2066-\u2069]/g,
    (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, '0')}`,
  );
}

async function readBounded(path: string, max: number, what: string): Promise<Buffer> {
  let size: number;
  try {
    const info = await stat(path);
    if (!info.isFile()) throw new UsageError(`${what} is not a file: ${safe(path)}`);
    size = info.size;
  } catch (e) {
    if (e instanceof UsageError) throw e;
    throw new UsageError(`cannot read ${what}: ${safe(path)}`);
  }
  if (size > max) throw new UsageError(`${what} is larger than ${max} bytes: ${safe(path)}`);
  try {
    return await readFile(path);
  } catch {
    throw new UsageError(`cannot read ${what}: ${safe(path)}`);
  }
}

function parseJson(bytes: Buffer): { ok: true; value: unknown } | { ok: false } {
  try {
    const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    return { ok: true, value: JSON.parse(text) as unknown };
  } catch {
    return { ok: false };
  }
}

interface Parsed {
  file: string;
  issuer: string;
  keysPath: string;
  renderersPath: string | undefined;
  context: ExpectedBundleContext | undefined;
  now: Date | undefined;
  json: boolean;
}

function parse(argv: readonly string[]): Parsed | 'help' {
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
  if (command !== 'verify') throw new UsageError('the only command is: verify <bundle.json>');
  if (file === undefined || rest.length > 0) throw new UsageError('give exactly one bundle file');
  const str = (name: (typeof STRING_OPTIONS)[number]) => {
    const v = values[name];
    if (v === undefined) return undefined;
    if (typeof v !== 'string' || v.length === 0) throw new UsageError(`--${name} needs a value`);
    return v;
  };
  const issuer = str('issuer');
  const keysPath = str('keys');
  if (issuer === undefined || keysPath === undefined)
    throw new UsageError('--issuer and --keys are required: verification only uses keys you trust');
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
    json: values.json === true,
  };
}

const REASON_TEXT: Record<string, string> = {
  malformed: 'the file is not a bundle-v1 decision bundle',
  oversized: 'the bundle exceeds a bundle-v1 size bound',
  unsupported_version: 'the bundle uses a later format version',
  receipt_malformed: 'the receipt cannot be read',
  algorithm: 'the receipt does not use the EdDSA algorithm',
  missing_kid: 'the receipt names no key',
  unknown_kid: 'the receipt was signed with a key you do not trust',
  type: 'the receipt has the wrong type',
  signature: 'the signature does not verify with the key you trust',
  issuer: 'the receipt is from another issuer',
  audience: 'the receipt belongs to another workspace',
  expired: 'the receipt has expired',
  claims: 'the receipt claims are not valid receipt-v1 claims',
  not_yet_valid: 'the receipt is dated in the future',
  surface_mismatch: 'the disclosed Surface is not the one the receipt signed',
  input_mismatch: 'the disclosed input is not the one the receipt signed',
  context_mismatch: 'the decision is not the one you expected',
  renderer: 'the receipt names a renderer identity that is neither known nor on the signed list',
};

/** With --renderers: the receipt's renderer identity and whether it is known or listed. */
interface RendererCheck {
  identity: string | null;
  status: 'listed' | 'unlisted' | 'not_checked';
}

function summary(r: DecisionBundleVerification, renderer?: RendererCheck): string {
  const lines: string[] = [];
  const row = (label: string, value: string) => lines.push(`  ${label.padEnd(11)} ${value}`);
  const context =
    r.context.status === 'mismatch'
      ? `mismatch: ${r.context.mismatches.join(', ')}`
      : r.context.status === 'unchecked'
        ? 'unchecked (no expected context given)'
        : r.context.checked.length > 0
          ? `${r.context.status}: ${r.context.checked.join(', ')}`
          : r.context.status;
  if (r.valid && r.receipt) {
    const c = r.receipt;
    lines.push('Valid decision bundle.');
    row('Accepted', `${safe(c.accepted_at)}, action ${safe(c.action.id)} on revision ${c.surface.revision}`);
    row('Session', `${safe(c.session_id)} (event ${safe(c.event_id)}, workspace ${safe(c.workspace_id)})`);
    row('Issuer', `${safe(c.issuer)} (key ${safe(c.key_id)})`);
    row('Actor', "someone holding the Session's human link (not a verified person)");
    row('Content', 'verified');
    row('Context', context);
    row('Purpose', r.application_purpose);
    row('Expires', safe(c.expires_at));
    if (renderer) row('Renderer', `${safe(c.surface.renderer_version)} (listed)`);
  } else {
    lines.push(`Invalid decision bundle: ${r.reason}`);
    lines.push(`  ${REASON_TEXT[r.reason ?? ''] ?? ''}`);
    row('Content', r.content);
    row('Context', context);
    if (renderer?.identity) row('Renderer', `${safe(renderer.identity)} (${renderer.status})`);
  }
  row('Checked at', r.checked_at);
  return `${lines.join('\n')}\n`;
}

/**
 * JSON with every terminal-sensitive character escaped; parses to the same value. JSON.stringify
 * already escapes C0 controls inside strings, and the only raw characters it can leave are inside
 * strings, where a \u escape denotes the same character.
 */
function safeJson(value: unknown): string {
  const text = JSON.stringify(value, null, 2).replace(
    /[\u007f-\u009f\u200e\u200f\u2028\u2029\u202a-\u202e\u2066-\u2069]/g,
    (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, '0')}`,
  );
  return `${text}\n`;
}

/** Runs `sess <argv>`; resolves to the exit code. Never throws. */
export async function runCli(argv: readonly string[], io: CliIo): Promise<number> {
  try {
    const parsed = parse(argv);
    if (parsed === 'help') {
      io.stdout(USAGE);
      return EXIT.valid;
    }
    const keyBytes = await readBounded(parsed.keysPath, MAX_KEYS_FILE_BYTES, 'the --keys file');
    const keyJson = parseJson(keyBytes);
    let trustedKeys;
    try {
      if (!keyJson.ok) throw new Error('not JSON');
      trustedKeys = validateKeySet(keyJson.value);
    } catch {
      throw new UsageError(
        'the --keys file must be a JWK Set of public Ed25519 keys with unique kids (private keys are refused)',
      );
    }
    // Decision 0009 Amendment 13: the issuer's signed renderer list, trusted only through its
    // signature under the keys above.
    let listed: readonly string[] | undefined;
    if (parsed.renderersPath !== undefined) {
      const listJson = parseJson(
        await readBounded(parsed.renderersPath, MAX_RENDERERS_FILE_BYTES, 'the --renderers file'),
      );
      try {
        if (!listJson.ok) throw new Error('not JSON');
        listed = (
          await verifyRendererIdentities(listJson.value as never, {
            issuer: parsed.issuer,
            keys: trustedKeys,
          })
        ).map((i) => i.renderer_version);
      } catch {
        throw new UsageError(
          "the --renderers file must be the issuer's renderer list, signed with the keys you trust",
        );
      }
    }
    const bundleBytes = await readBounded(parsed.file, MAX_BUNDLE_FILE_BYTES, 'the bundle file');
    const bundleJson = parseJson(bundleBytes);
    let result: DecisionBundleVerification;
    try {
      // A file that is not JSON is not a bundle: the same facade reports it as malformed.
      result = await verifyDecisionBundle(bundleJson.ok ? bundleJson.value : undefined, {
        issuer: parsed.issuer,
        trustedKeys,
        ...(parsed.context ? { expectedContext: parsed.context } : {}),
        ...(parsed.now ? { now: parsed.now } : {}),
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
    io.stdout(
      parsed.json ? safeJson(renderer ? { ...result, renderer } : result) : summary(result, renderer),
    );
    return result.valid ? EXIT.valid : EXIT.invalid;
  } catch (e) {
    const message = e instanceof UsageError ? e.message : 'unexpected error';
    io.stderr(`sess: ${message}\nRun "sess --help" for usage.\n`);
    return EXIT.usage;
  }
}
