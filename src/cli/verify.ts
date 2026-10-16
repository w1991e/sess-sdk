// `sess verify <file>`: the CLI face of decision-bundle verification, and with `--archival` of
// archival-envelope verification. Offline only: it reads the bundle or envelope and the keys and
// witness anchors the caller trusts from local files, verifies with verifyDecisionBundle or
// verifyArchivalEnvelope and prints a short summary (or the result object with --json). It opens
// no network connection and never prints the receipt, the disclosed content or any key material.
import { readFile, stat } from 'node:fs/promises';
import { parseArgs } from 'node:util';
import {
  presentArchivalVerification,
  verifyArchivalEnvelope,
  type ArchivalPresentation,
  type ArchivalVerification,
  type ExpectedArchivalContext,
} from '../archival/verify.js';
import { parseWitnessKeySet } from '../archival/witness/key-set.js';
import type { WitnessAnchors } from '../archival/witness/parts.js';
import { parseTrustedRoot } from '../archival/witness/trusted-root.js';
import {
  verifyDecisionBundle,
  type DecisionBundleVerification,
  type ExpectedBundleContext,
} from '../receipts/bundle.js';
import { validateKeySet } from '../receipts/verify.js';

/** Exit codes: valid, invalid bundle, usage or file error. */
export const EXIT = Object.freeze({ valid: 0, invalid: 1, usage: 2 });

/**
 * A bundle or envelope file larger than this is not read (the bundle bound itself is 1 MiB
 * canonical, the envelope bound 64 KiB: a larger file that is read is reported as `oversized`).
 */
const MAX_BUNDLE_FILE_BYTES = 16 * 1024 * 1024;
const MAX_KEYS_FILE_BYTES = 1024 * 1024;
/** Disclosed content (the Surface and input) and a Sigstore trusted root. */
const MAX_CONTENT_FILE_BYTES = 16 * 1024 * 1024;
const MAX_TRUSTED_ROOT_FILE_BYTES = 1024 * 1024;

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

Other:
  --now <time>        check at this RFC 3339 time instead of now
  --json              print the full result as JSON
  -h, --help          show this help

Exit status: 0 valid, 1 invalid, 2 usage or file error.

Usage: sess verify --archival <envelope.json> --keys <jwks.json> [options]

Checks a Sess archival envelope (a receipt in the issuer's custody, with its signed archival
core and any witness evidence) and reports each result dimension separately: signature,
contents, context, witness, key trust and live expiry. Nothing is sent anywhere. Keys and
witness anchors inside the envelope are never trusted.

Required:
  --keys <file>          the issuer's public receipt keys (a JWK Set) you obtained yourself

Optional:
  --issuer <url>         the issuer you expect (compared as context)
  --audience, --workspace, --session, --event, --revision, --action
                         the context you expect; only what you pass is compared
  --content <file>       the disclosed content, {"surface": ..., "input": ...}, to check
  --witness-root <file>  a Sigstore trusted_root.json you obtained and checked yourself
  --witness-keys <file>  the issuer's witness key set (sess-witness-keys.json); give both
                         witness files or neither
  --now <time>           check live expiry at this RFC 3339 time instead of now
  --json                 print the result and its presentation as JSON

Exit status: 0 verified (the signature verifies with your keys and nothing you supplied
contradicts it), 1 not verified, 2 usage or file error. Witness status and live expiry are
reported beside the result and do not change the exit status.
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
  'content',
  'witness-root',
  'witness-keys',
] as const;
/** Options that only archival verification takes. */
const ARCHIVAL_ONLY = ['content', 'witness-root', 'witness-keys'] as const;

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
  mode: 'bundle';
  file: string;
  issuer: string;
  keysPath: string;
  context: ExpectedBundleContext | undefined;
  now: Date | undefined;
  json: boolean;
}

interface ParsedArchival {
  mode: 'archival';
  file: string;
  keysPath: string;
  issuer: string | undefined;
  context: ExpectedArchivalContext | undefined;
  now: Date | undefined;
  json: boolean;
  contentPath: string | undefined;
  witness: { rootPath: string; keysPath: string } | undefined;
}

function parse(argv: readonly string[]): Parsed | ParsedArchival | 'help' {
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
        archival: { type: 'boolean' },
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
  const archival = values.archival === true;
  const [command, file, ...rest] = parsed.positionals;
  if (command !== 'verify')
    throw new UsageError('the only command is: verify <bundle.json> (or verify --archival <envelope.json>)');
  if (file === undefined || rest.length > 0)
    throw new UsageError(archival ? 'give exactly one envelope file' : 'give exactly one bundle file');
  const str = (name: (typeof STRING_OPTIONS)[number]) => {
    const v = values[name];
    if (v === undefined) return undefined;
    if (typeof v !== 'string' || v.length === 0) throw new UsageError(`--${name} needs a value`);
    return v;
  };
  const issuer = str('issuer');
  const keysPath = str('keys');
  if (!archival) {
    for (const name of ARCHIVAL_ONLY)
      if (values[name] !== undefined) throw new UsageError(`--${name} needs --archival`);
    if (issuer === undefined || keysPath === undefined)
      throw new UsageError('--issuer and --keys are required: verification only uses keys you trust');
  } else if (keysPath === undefined) {
    throw new UsageError('--keys is required: verification only uses keys you trust');
  }
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
  const audience = str('audience');
  const workspaceId = str('workspace');
  const sessionId = str('session');
  const eventId = str('event');
  const actionId = str('action');
  if (archival) {
    const c: ExpectedArchivalContext = {};
    if (issuer !== undefined) c.issuer = issuer;
    if (audience !== undefined) c.audience = audience;
    if (workspaceId !== undefined) c.workspace_id = workspaceId;
    if (sessionId !== undefined) c.session_id = sessionId;
    if (eventId !== undefined) c.event_id = eventId;
    if (revision !== undefined) c.surface_revision = revision;
    if (actionId !== undefined) c.action_id = actionId;
    const rootPath = str('witness-root');
    const witnessKeysPath = str('witness-keys');
    if ((rootPath === undefined) !== (witnessKeysPath === undefined))
      throw new UsageError('give both --witness-root and --witness-keys, or neither');
    return {
      mode: 'archival',
      file,
      keysPath,
      issuer,
      context: Object.keys(c).length > 0 ? c : undefined,
      now,
      json: values.json === true,
      contentPath: str('content'),
      witness:
        rootPath !== undefined && witnessKeysPath !== undefined
          ? { rootPath, keysPath: witnessKeysPath }
          : undefined,
    };
  }
  const context: ExpectedBundleContext = {};
  if (audience !== undefined) context.audience = audience;
  if (workspaceId !== undefined) context.workspaceId = workspaceId;
  if (sessionId !== undefined) context.sessionId = sessionId;
  if (eventId !== undefined) context.eventId = eventId;
  if (revision !== undefined) context.revision = revision;
  if (actionId !== undefined) context.actionId = actionId;
  return {
    mode: 'bundle',
    file,
    issuer: issuer as string,
    keysPath,
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
};

function summary(r: DecisionBundleVerification): string {
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
  } else {
    lines.push(`Invalid decision bundle: ${r.reason}`);
    lines.push(`  ${REASON_TEXT[r.reason ?? ''] ?? ''}`);
    row('Content', r.content);
    row('Context', context);
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

const dimension = (d: { status: string; reason: string }) => `${d.status}: ${d.reason}`;

function archivalSummary(r: ArchivalVerification, p: ArchivalPresentation): string {
  const lines: string[] = [];
  const row = (label: string, value: string) => lines.push(`  ${label.padEnd(11)} ${value}`);
  lines.push(
    p.verified
      ? 'Verified archival envelope.'
      : `Not verified: ${p.refusal?.dimension ?? 'signature'} ${p.refusal?.reason ?? ''}`.trimEnd(),
  );
  row('Signature', dimension(r.signature));
  row('Contents', dimension(r.contents));
  const checked = r.context.status === 'invalid' ? r.context.mismatched : r.context.checked;
  row(
    'Context',
    checked.length > 0 ? `${dimension(r.context)} (${checked.join(', ')})` : dimension(r.context),
  );
  row(
    'Witness',
    r.witness.witnessed_at !== undefined
      ? `${dimension(r.witness)}, existed no later than ${r.witness.witnessed_at}`
      : r.witness.detail !== undefined
        ? `${dimension(r.witness)} (${safe(r.witness.detail)})`
        : dimension(r.witness),
  );
  row('Key trust', `${dimension(r.key_trust)} (keys you supplied)`);
  row(
    'Live use',
    r.live_expiry.expires_at !== null
      ? `${dimension(r.live_expiry)} (expires ${r.live_expiry.expires_at})`
      : dimension(r.live_expiry),
  );
  if (p.messages.length > 0) row('Messages', p.messages.join(', '));
  if (p.verified)
    row('Means', 'the issuer held these exact receipt bytes (not a named person, not authority)');
  if (r.core && r.claims) {
    row(
      'Receipt',
      `event ${safe(r.core.event_id)} in workspace ${safe(r.core.workspace_id)}, accepted ${safe(r.core.accepted_at)}`,
    );
    row('Custody', `sequence ${r.core.workspace_sequence}; issuer ${safe(r.core.issuer)}`);
  }
  row('Checked at', r.checked_at);
  return `${lines.join('\n')}\n`;
}

async function readTrustedJson(path: string, max: number, what: string): Promise<unknown> {
  const parsed = parseJson(await readBounded(path, max, what));
  if (!parsed.ok) throw new UsageError(`${what} is not JSON`);
  return parsed.value;
}

async function runArchival(
  parsed: ParsedArchival,
  io: CliIo,
  trustedKeys: ReturnType<typeof validateKeySet>,
) {
  let content: { surface: unknown; input: unknown } | undefined;
  if (parsed.contentPath !== undefined) {
    const value = await readTrustedJson(parsed.contentPath, MAX_CONTENT_FILE_BYTES, 'the --content file');
    if (
      value === null ||
      typeof value !== 'object' ||
      Array.isArray(value) ||
      Object.keys(value).length !== 2 ||
      !Object.hasOwn(value, 'surface') ||
      !Object.hasOwn(value, 'input')
    )
      throw new UsageError('the --content file must be {"surface": ..., "input": ...}');
    content = value as { surface: unknown; input: unknown };
  }
  let witnessAnchors: WitnessAnchors | undefined;
  if (parsed.witness) {
    const rootBytes = await readBounded(
      parsed.witness.rootPath,
      MAX_TRUSTED_ROOT_FILE_BYTES,
      'the --witness-root file',
    );
    const keySet = await readTrustedJson(
      parsed.witness.keysPath,
      MAX_KEYS_FILE_BYTES,
      'the --witness-keys file',
    );
    try {
      witnessAnchors = {
        trustedRoot: parseTrustedRoot(new Uint8Array(rootBytes)),
        witnessKeys: [],
      };
    } catch {
      throw new UsageError('the --witness-root file must be a Sigstore trusted_root.json');
    }
    try {
      witnessAnchors.witnessKeys = parseWitnessKeySet(keySet, parsed.issuer);
    } catch {
      throw new UsageError(
        parsed.issuer === undefined
          ? 'the --witness-keys file must be a Sess witness key set (version 1)'
          : 'the --witness-keys file must be a Sess witness key set (version 1) of the --issuer',
      );
    }
  }
  // The exact file bytes: the envelope bound applies to them before they are parsed.
  const envelopeBytes = await readBounded(parsed.file, MAX_BUNDLE_FILE_BYTES, 'the envelope file');
  let result: ArchivalVerification;
  try {
    result = await verifyArchivalEnvelope(new Uint8Array(envelopeBytes), {
      trustedKeys,
      ...(parsed.context ? { expectedContext: parsed.context } : {}),
      ...(parsed.now ? { now: parsed.now } : {}),
      ...(content ? { content } : {}),
      ...(witnessAnchors ? { witnessAnchors } : {}),
    });
  } catch {
    throw new UsageError('invalid verification options');
  }
  const presentation = presentArchivalVerification(result);
  io.stdout(
    parsed.json ? safeJson({ verification: result, presentation }) : archivalSummary(result, presentation),
  );
  return presentation.verified ? EXIT.valid : EXIT.invalid;
}

/** Runs `sess <argv>`; resolves to the exit code. Never throws. */
export async function runCli(argv: readonly string[], io: CliIo): Promise<number> {
  try {
    const parsed = parse(argv);
    if (parsed === 'help') {
      io.stdout(USAGE);
      return EXIT.valid;
    }
    if (parsed.mode === 'archival') {
      const keyJson = parseJson(await readBounded(parsed.keysPath, MAX_KEYS_FILE_BYTES, 'the --keys file'));
      let keys;
      try {
        if (!keyJson.ok) throw new Error('not JSON');
        keys = validateKeySet(keyJson.value);
      } catch {
        throw new UsageError(
          'the --keys file must be a JWK Set of public Ed25519 keys with unique kids (private keys are refused)',
        );
      }
      return await runArchival(parsed, io, keys);
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
    io.stdout(parsed.json ? safeJson(result) : summary(result));
    return result.valid ? EXIT.valid : EXIT.invalid;
  } catch (e) {
    const message = e instanceof UsageError ? e.message : 'unexpected error';
    io.stderr(`sess: ${message}\nRun "sess --help" for usage.\n`);
    return EXIT.usage;
  }
}
