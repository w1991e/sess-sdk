// `sess verify <file>`, the CLI face of bundle-v1 verification. The CLI source is bundled once and
// run as a real Node process with every network entry point replaced by a hard failure. Every
// corpus vector must reach the same outcome and reason as the frozen corpus (and the library
// face) for a trusting caller and for a public verifier, with the documented exit codes, and the
// output must never contain the receipt, the disclosed content or key material.
import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build } from 'esbuild';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { verifyDecisionBundle, type DecisionBundleVerification } from '../../src/receipts/index.js';
import {
  buildCorpusVectors,
  corpusBundleWithClaims,
  corpusBundleWithRenderer,
  corpusRendererList,
  CORPUS_INPUT,
  CORPUS_ISSUER,
  CORPUS_NOW,
  CORPUS_SURFACE,
  corpusTrustedKeys,
  type CorpusVector,
  type FrozenCorpus,
  type FrozenOutcome,
} from '../fixtures/bundle/corpus-vectors.js';

const CORPUS = JSON.parse(
  await readFile(new URL('../fixtures/bundle/bundle-v1-corpus.json', import.meta.url), 'utf8'),
) as FrozenCorpus;

// Any attempted network use ends the process with a distinctive status and marker.
const NO_NETWORK = `
import dns from 'node:dns';
import http from 'node:http';
import https from 'node:https';
import net from 'node:net';
import tls from 'node:tls';
const deny = (name) => () => { process.stderr.write('NETWORK-ATTEMPT:' + name + '\\n'); process.exit(97); };
globalThis.fetch = deny('fetch');
globalThis.WebSocket = deny('websocket');
net.connect = net.createConnection = deny('net');
net.Socket.prototype.connect = deny('socket');
tls.connect = deny('tls');
dns.lookup = deny('dns');
dns.resolve = deny('dns');
dns.promises.lookup = deny('dns');
http.request = http.get = deny('http');
https.request = https.get = deny('https');
`;

let dir: string;
let cli: string;
let preload: string;
let keysFile: string;
let vectors: CorpusVector[];

interface Run {
  code: number | null;
  stdout: string;
  stderr: string;
}
function sess(args: string[], script = cli): Promise<Run> {
  return new Promise((resolve) => {
    execFile(
      process.execPath,
      ['--import', pathToFileURL(preload).href, script, ...args],
      { encoding: 'utf8', maxBuffer: 4 * 1024 * 1024, env: { PATH: process.env.PATH ?? '' } },
      (error, stdout, stderr) =>
        resolve({ code: error ? ((error as { code?: number }).code ?? null) : 0, stdout, stderr }),
    );
  });
}

/** Runs tasks with bounded concurrency. */
async function pool<T, R>(items: T[], size: number, task: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: size }, async () => {
      while (next < items.length) {
        const i = next++;
        out[i] = await task(items[i] as T);
      }
    }),
  );
  return out;
}

const contextFlags = (v: CorpusVector): string[] => {
  const c = v.context ?? {};
  return [
    ...(c.audience !== undefined ? ['--audience', c.audience] : []),
    ...(c.workspaceId !== undefined ? ['--workspace', c.workspaceId] : []),
    ...(c.sessionId !== undefined ? ['--session', c.sessionId] : []),
    ...(c.eventId !== undefined ? ['--event', c.eventId] : []),
    ...(c.revision !== undefined ? ['--revision', String(c.revision)] : []),
    ...(c.actionId !== undefined ? ['--action', c.actionId] : []),
  ];
};

const outcome = (r: DecisionBundleVerification): FrozenOutcome => ({
  valid: r.valid,
  reason: r.reason,
  content: r.content,
  context: r.context.status,
  mismatches: r.context.mismatches,
  application_purpose: r.application_purpose,
});

/** Strings that must never appear in CLI output for a vector. */
function secretsOf(v: CorpusVector): string[] {
  const b = v.bundle as {
    receipt?: unknown;
    keys?: { keys?: Array<Record<string, unknown>> };
  } | null;
  const out: string[] = [CORPUS_SURFACE.title, CORPUS_INPUT.note];
  if (b && typeof b.receipt === 'string' && b.receipt.length > 20) {
    out.push(b.receipt);
    for (const part of b.receipt.split('.')) if (part.length > 20) out.push(part);
  }
  for (const k of [...(b?.keys?.keys ?? []), ...corpusTrustedKeys().keys] as Array<Record<string, unknown>>)
    for (const m of ['x', 'd']) if (typeof k[m] === 'string') out.push(k[m] as string);
  return out;
}

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), 'sess-cli-'));
  cli = join(dir, 'sess.mjs');
  preload = join(dir, 'no-network.mjs');
  await build({
    entryPoints: [fileURLToPath(new URL('../../src/cli/main.ts', import.meta.url))],
    bundle: true,
    platform: 'node',
    format: 'esm',
    target: 'node22',
    outfile: cli,
    logLevel: 'silent',
  });
  await writeFile(preload, NO_NETWORK);
  keysFile = join(dir, 'trusted-keys.json');
  await writeFile(keysFile, JSON.stringify(corpusTrustedKeys()));
  vectors = await buildCorpusVectors();
  for (const v of vectors) await writeFile(join(dir, `${v.id}.json`), JSON.stringify(v.bundle));
}, 60_000);

afterAll(async () => {
  if (dir) await rm(dir, { recursive: true, force: true });
});

const base = (id: string) => [
  'verify',
  join(dir, `${id}.json`),
  '--issuer',
  CORPUS_ISSUER,
  '--keys',
  keysFile,
];

describe('sess verify <file>', () => {
  it('runs under a harness that turns any network attempt into a failure', async () => {
    for (const call of [
      "fetch('https://example.invalid')",
      "require('node:net').connect(443, 'example.invalid')",
    ]) {
      const probe = join(dir, 'probe.cjs');
      await writeFile(probe, call);
      const r = await sess([], probe);
      expect(r.code).toBe(97);
      expect(r.stderr).toContain('NETWORK-ATTEMPT');
    }
  });

  it('reaches every frozen trusted and public result, equal to the library face, with exit 0/1 and no network', async () => {
    expect(vectors.map((v) => v.id)).toEqual(CORPUS.vectors.map((v) => v.id));
    const runs = await pool(vectors, 8, async (v) => {
      const trusted = await sess([
        ...base(v.id),
        ...contextFlags(v),
        '--now',
        CORPUS_NOW.toISOString(),
        '--json',
      ]);
      const pub = await sess([...base(v.id), '--json']);
      const human = await sess([...base(v.id), ...contextFlags(v), '--now', CORPUS_NOW.toISOString()]);
      return { v, trusted, pub, human };
    });
    let checked = 0;
    for (const { v, trusted, pub, human } of runs) {
      const frozen = CORPUS.vectors.find((x) => x.id === v.id)!;
      for (const run of [trusted, pub, human]) {
        expect(run.stderr, `${v.id} stderr`).toBe('');
        expect(run.stderr).not.toContain('NETWORK-ATTEMPT');
      }
      const t = JSON.parse(trusted.stdout) as DecisionBundleVerification;
      const p = JSON.parse(pub.stdout) as DecisionBundleVerification;
      expect(outcome(t), `${v.id} trusted`).toEqual(frozen.expected.trusted);
      expect(outcome(p), `${v.id} public`).toEqual(frozen.expected.public);
      expect(trusted.code, `${v.id} trusted exit`).toBe(frozen.expected.trusted.valid ? 0 : 1);
      expect(pub.code, `${v.id} public exit`).toBe(frozen.expected.public.valid ? 0 : 1);
      expect(human.code, `${v.id} human exit`).toBe(frozen.expected.trusted.valid ? 0 : 1);
      // The CLI reports the library's result object exactly (the public face's time differs).
      const library = await verifyDecisionBundle(v.bundle, {
        issuer: CORPUS_ISSUER,
        trustedKeys: corpusTrustedKeys(),
        ...(v.context ? { expectedContext: v.context } : {}),
        now: CORPUS_NOW,
      });
      expect(t, `${v.id} trusted result`).toEqual(library);
      const libraryPublic = await verifyDecisionBundle(v.bundle, {
        issuer: CORPUS_ISSUER,
        trustedKeys: corpusTrustedKeys(),
      });
      expect({ ...p, checked_at: '' }, `${v.id} public result`).toEqual({ ...libraryPublic, checked_at: '' });
      // The summary names the outcome and reason in a few lines.
      expect(human.stdout.split('\n')[0]).toBe(
        frozen.expected.trusted.valid
          ? 'Valid decision bundle.'
          : `Invalid decision bundle: ${frozen.expected.trusted.reason}`,
      );
      expect(human.stdout.split('\n').length).toBeLessThanOrEqual(12);
      for (const secret of secretsOf(v))
        for (const run of [trusted, pub, human])
          expect(run.stdout.includes(secret), `${v.id} leaks`).toBe(false);
      checked += 1;
    }
    expect(checked).toBe(35);
  }, 120_000);

  it('summarizes a valid decision without naming a person', async () => {
    const r = await sess([
      ...base('valid-full-context'),
      ...contextFlags(vectors[0]!),
      '--now',
      CORPUS_NOW.toISOString(),
    ]);
    expect(r.code).toBe(0);
    expect(r.stdout).toContain("someone holding the Session's human link (not a verified person)");
    expect(r.stdout).toContain(
      'verified: audience, workspace_id, session_id, event_id, surface.revision, action.id',
    );
    expect(r.stdout).toContain('matched_caller_context');
    expect(r.stdout).not.toContain('human_link:');
    const pub = await sess([...base('valid-no-context'), '--now', CORPUS_NOW.toISOString()]);
    expect(pub.code).toBe(0);
    expect(pub.stdout).toContain('unchecked (no expected context given)');
    expect(pub.stdout).toMatch(/Purpose\s+unchecked/);
  });

  it('reports a file that is not JSON as an invalid (malformed) bundle', async () => {
    const file = join(dir, 'not-json.json');
    await writeFile(file, '{"type": "sess.decision-bundle",');
    const r = await sess(['verify', file, '--issuer', CORPUS_ISSUER, '--keys', keysFile, '--json']);
    expect(r.code).toBe(1);
    expect(JSON.parse(r.stdout)).toMatchObject({ valid: false, reason: 'malformed' });
  });

  it('exits 2 for usage and file errors, without echoing key material', async () => {
    const privateKeys = join(dir, 'private-keys.json');
    const d = Buffer.alloc(32, 9).toString('base64url');
    await writeFile(privateKeys, JSON.stringify({ keys: [{ ...corpusTrustedKeys().keys[0], d }] }));
    const notJson = join(dir, 'keys-not-json.json');
    await writeFile(notJson, 'keys');
    const bundle = join(dir, 'valid-no-context.json');
    const cases: Array<[string, string[]]> = [
      ['no arguments', []],
      ['unknown command', ['check', bundle, '--issuer', CORPUS_ISSUER, '--keys', keysFile]],
      ['no file', ['verify', '--issuer', CORPUS_ISSUER, '--keys', keysFile]],
      ['two files', ['verify', bundle, bundle, '--issuer', CORPUS_ISSUER, '--keys', keysFile]],
      ['no keys', ['verify', bundle, '--issuer', CORPUS_ISSUER]],
      ['no issuer', ['verify', bundle, '--keys', keysFile]],
      ['unknown option', ['verify', bundle, '--issuer', CORPUS_ISSUER, '--keys', keysFile, '--trust-bundle']],
      ['repeated issuer', ['verify', bundle, '--issuer', CORPUS_ISSUER, '--issuer', 'x', '--keys', keysFile]],
      [
        'missing bundle file',
        ['verify', join(dir, 'absent.json'), '--issuer', CORPUS_ISSUER, '--keys', keysFile],
      ],
      ['bundle is a directory', ['verify', dir, '--issuer', CORPUS_ISSUER, '--keys', keysFile]],
      [
        'missing keys file',
        ['verify', bundle, '--issuer', CORPUS_ISSUER, '--keys', join(dir, 'absent.json')],
      ],
      ['keys file not JSON', ['verify', bundle, '--issuer', CORPUS_ISSUER, '--keys', notJson]],
      ['private key in keys file', ['verify', bundle, '--issuer', CORPUS_ISSUER, '--keys', privateKeys]],
      ['revision 0', ['verify', bundle, '--issuer', CORPUS_ISSUER, '--keys', keysFile, '--revision', '0']],
      [
        'revision text',
        ['verify', bundle, '--issuer', CORPUS_ISSUER, '--keys', keysFile, '--revision', '1x'],
      ],
      ['empty session', ['verify', bundle, '--issuer', CORPUS_ISSUER, '--keys', keysFile, '--session', '']],
      ['bad time', ['verify', bundle, '--issuer', CORPUS_ISSUER, '--keys', keysFile, '--now', 'yesterday']],
    ];
    const runs = await pool(cases, 8, async ([label, args]) => ({ label, r: await sess(args) }));
    for (const { label, r } of runs) {
      expect(r.code, label).toBe(2);
      expect(r.stdout, label).toBe('');
      expect(r.stderr, label).toMatch(/^sess: /);
      expect(r.stderr, label).not.toContain(d);
      expect(r.stderr, label).not.toContain('NETWORK-ATTEMPT');
      for (const k of corpusTrustedKeys().keys) expect(r.stderr, label).not.toContain(k.x);
    }
    const help = await sess(['--help']);
    expect(help.code).toBe(0);
    expect(help.stdout).toContain('Usage: sess verify <bundle.json> --issuer <url> --keys <jwks.json>');
  }, 60_000);

  it('escapes terminal control and bidi characters from verified claims in the summary and JSON', async () => {
    // Claims are signed by the trusted issuer but are still untrusted text for a terminal.
    const esc = String.fromCharCode(0x1b);
    const rlo = String.fromCharCode(0x202e);
    const c1 = String.fromCharCode(0x9b);
    const hostile = `ses_${esc}[2J${rlo}${c1}x`;
    const file = join(dir, 'hostile-claims.json');
    await writeFile(file, JSON.stringify(await corpusBundleWithClaims({ session_id: hostile })));
    const args = [
      'verify',
      file,
      '--issuer',
      CORPUS_ISSUER,
      '--keys',
      keysFile,
      '--now',
      CORPUS_NOW.toISOString(),
    ];
    const human = await sess(args);
    const json = await sess([...args, '--json']);
    for (const r of [human, json]) {
      expect(r.code).toBe(0);
      for (const ch of [esc, rlo, c1]) expect(r.stdout.includes(ch)).toBe(false);
    }
    expect(human.stdout).toContain('ses_\\u001b[2J\\u202e\\u009bx');
    expect((JSON.parse(json.stdout) as DecisionBundleVerification).receipt?.session_id).toBe(hostile);
  });
});

// Decision 0009 Amendment 13 (rc.8): `--renderers <file>` takes the issuer's signed renderer list.
// With it, the receipt's renderer identity must be one this release knows or one on that list; the
// list is trusted only through its signature under --keys and --issuer. Without it, bundle-v1
// verification is unchanged.
describe('sess verify --renderers <file>', () => {
  const LIST = [
    { renderer_version: 'sess-html-form-1', since: '2026-10-09' },
    { renderer_version: 'sess-html-form-3', since: '2026-11-02' },
  ];
  const write = async (name: string, value: unknown) => {
    const file = join(dir, name);
    await writeFile(file, JSON.stringify(value));
    return file;
  };
  const args = (bundle: string, extra: string[] = []) => [
    'verify',
    bundle,
    '--issuer',
    CORPUS_ISSUER,
    '--keys',
    keysFile,
    '--now',
    CORPUS_NOW.toISOString(),
    ...extra,
  ];

  it('accepts a receipt whose renderer identity is on the signed list, refuses one missing from it, and without the option checks nothing new', async () => {
    const future = await write('future.json', await corpusBundleWithRenderer('sess-html-form-3'));
    const listed = await write('renderers.json', await corpusRendererList(LIST));
    const ok = await sess(args(future, ['--renderers', listed]));
    expect(ok.code).toBe(0);
    expect(ok.stdout).toContain('Renderer    sess-html-form-3 (listed)');
    const json = await sess(args(future, ['--renderers', listed, '--json']));
    expect(JSON.parse(json.stdout).renderer).toEqual({ identity: 'sess-html-form-3', status: 'listed' });
    // A bundled identity needs no listing.
    const two = await write('two.json', await corpusBundleWithRenderer('sess-html-form-2'));
    expect((await sess(args(two, ['--renderers', listed]))).code).toBe(0);
    // Not on the list: invalid, exit 1.
    const short = await write('short.json', await corpusRendererList(LIST.slice(0, 1)));
    const missing = await sess(args(future, ['--renderers', short]));
    expect(missing.code).toBe(1);
    expect(missing.stdout).toContain('Invalid decision bundle: renderer');
    // Without --renderers, bundle-v1 verification is unchanged.
    expect((await sess(args(future))).code).toBe(0);
  });

  it('exits 2 for a list that is not signed by the keys you trust, is from another issuer, has another typ or is not a list', async () => {
    const future = await write('future-2.json', await corpusBundleWithRenderer('sess-html-form-3'));
    const bad = [
      await corpusRendererList(LIST, { key: 'stranger' }),
      await corpusRendererList(LIST, { key: 'retired' }),
      await corpusRendererList(LIST, { issuer: 'https://evil.example' }),
      await corpusRendererList(LIST, { typ: 'sess-receipt+jwt' }),
      { ...(await corpusRendererList(LIST)), signature: '' },
      { keys: [] },
    ];
    for (const [i, value] of bad.entries()) {
      const r = await sess(args(future, ['--renderers', await write(`bad-${i}.json`, value)]));
      expect(r.code, String(i)).toBe(2);
      expect(r.stderr).toContain("the --renderers file must be the issuer's renderer list");
    }
  });
});
