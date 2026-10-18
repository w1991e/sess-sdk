// `sess verify --archival <file>`, the CLI face of the successor archival verifier. The CLI source
// is bundled once and run as a real Node process with every network entry point replaced by a hard
// failure. Every vector of the shared archival-v1 corpus (pinned verbatim from Sess) must reach the
// frozen dimensions and messages, report exactly the library's result object, exit 0 when verified
// and 1 otherwise, and never print the receipt, the disclosed content or key material. Witness
// anchors come only from the files the caller names.
import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build } from 'esbuild';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  type ArchivalPresentation,
  type ArchivalVerification,
  type ExpectedArchivalContext,
  parseTrustedRoot,
  parseWitnessKeySet,
  presentArchivalVerification,
  verifyArchivalEnvelope,
} from '../../src/archival/index.js';
import {
  archivalEnvelope,
  buildArchivalCore,
  buildReceipt,
  CORPUS_KEY_LABEL,
  type CorpusVectors,
  corpusTrustedKeys,
  corpusVectors,
  derivedKey,
  inputText,
  signArchivalCore,
  signReceipt,
  summary,
} from '../fixtures/archival/corpus-vectors.js';
import { trustedRootJson, witnessBatch, witnessKeySetJson } from '../fixtures/archival/witness-synthetic.js';

interface FrozenCase {
  name: string;
  padding?: number;
  options: { now: string; content?: 'disclosed' | 'altered'; context?: ExpectedArchivalContext };
  expect: { verified: boolean } & Record<string, unknown>;
}
const CORPUS = JSON.parse(
  await readFile(new URL('../fixtures/archival/archival-v1-corpus.json', import.meta.url), 'utf8'),
) as { cases: FrozenCase[]; content: Record<'disclosed' | 'altered', { surface: unknown; input: unknown }> };

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
let vectors: CorpusVectors;

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
async function pool<T, R>(items: readonly T[], size: number, task: (item: T) => Promise<R>): Promise<R[]> {
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

const contextFlags = (c: ExpectedArchivalContext | undefined): string[] => [
  ...(c?.issuer !== undefined ? ['--issuer', c.issuer] : []),
  ...(c?.audience !== undefined ? ['--audience', c.audience] : []),
  ...(c?.workspace_id !== undefined ? ['--workspace', c.workspace_id] : []),
  ...(c?.session_id !== undefined ? ['--session', c.session_id] : []),
  ...(c?.event_id !== undefined ? ['--event', c.event_id] : []),
  ...(c?.surface_revision !== undefined ? ['--revision', String(c.surface_revision)] : []),
  ...(c?.action_id !== undefined ? ['--action', c.action_id] : []),
];

/** Strings that must never appear in CLI output. */
function secrets(): string[] {
  const jws = vectors.receiptV1.jws;
  return [
    jws,
    ...jws.split('.'),
    'Approve the weather plan',
    'Rain after 3 pm',
    ...corpusTrustedKeys().keys.map((k) => k.x),
  ];
}

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), 'sess-archival-cli-'));
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
  for (const name of ['disclosed', 'altered'] as const)
    await writeFile(join(dir, `content-${name}.json`), JSON.stringify(CORPUS.content[name]));
  vectors = await corpusVectors();
  for (const [i, c] of CORPUS.cases.entries()) {
    const input = vectors.cases[i]?.input;
    await writeFile(join(dir, `case-${i}.json`), inputText(input) + ' '.repeat(c.padding ?? 0));
  }
}, 60_000);

afterAll(async () => {
  if (dir) await rm(dir, { recursive: true, force: true });
});

describe('sess verify --archival <file>', () => {
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

  it('reaches every frozen corpus result, equal to the library face, with exit 0/1, no network and no leaks', async () => {
    let checked = 0;
    const runs = await pool(
      CORPUS.cases.map((c, i) => [c, i] as const),
      8,
      async ([c, i]) => {
        const args = [
          'verify',
          '--archival',
          join(dir, `case-${i}.json`),
          '--keys',
          keysFile,
          '--now',
          c.options.now,
          ...contextFlags(c.options.context),
          ...(c.options.content ? ['--content', join(dir, `content-${c.options.content}.json`)] : []),
        ];
        return { c, i, json: await sess([...args, '--json']), human: await sess(args) };
      },
    );
    for (const { c, i, json, human } of runs) {
      for (const run of [json, human]) {
        expect(run.stderr, `${c.name} stderr`).toBe('');
        expect(run.code, `${c.name} exit`).toBe(c.expect.verified ? 0 : 1);
        for (const secret of secrets()) expect(run.stdout.includes(secret), `${c.name} leaks`).toBe(false);
      }
      const out = JSON.parse(json.stdout) as {
        verification: ArchivalVerification;
        presentation: ArchivalPresentation;
      };
      expect(summary(out.verification), c.name).toEqual(c.expect);
      // The CLI reports the library's result object exactly.
      const text = inputText(vectors.cases[i]?.input) + ' '.repeat(c.padding ?? 0);
      const library = await verifyArchivalEnvelope(text, {
        trustedKeys: corpusTrustedKeys(),
        now: new Date(c.options.now),
        ...(c.options.content ? { content: CORPUS.content[c.options.content] } : {}),
        ...(c.options.context ? { expectedContext: c.options.context } : {}),
      });
      expect(out.verification, c.name).toEqual(JSON.parse(JSON.stringify(library)));
      expect(out.presentation, c.name).toEqual(presentArchivalVerification(library));
      const first = human.stdout.split('\n')[0];
      expect(first, c.name).toBe(
        c.expect.verified
          ? 'Verified archival envelope.'
          : `Not verified: ${out.presentation.refusal?.dimension} ${out.presentation.refusal?.reason}`,
      );
      expect(human.stdout.split('\n').length).toBeLessThanOrEqual(14);
      checked += 1;
    }
    expect(checked).toBe(23);
  }, 120_000);

  it('verifies witness evidence only against the trusted root and witness key set files the caller names', async () => {
    const key = derivedKey(CORPUS_KEY_LABEL, 'corpus-2026-01');
    const issuer = 'https://api.sess.example';
    const receipt = await signReceipt(
      buildReceipt({
        issuer,
        workspaceId: 'wks_corpus',
        sessionId: 'ses_cli_witness',
        stepId: 'rev_1',
        eventId: 'evt_cli_witness',
        surface: { revision: 1, document: { title: 'Witness' }, rendererVersion: 'renderer@0.0.0' },
        action: { id: 'approve', label: 'Approve', summary: '' },
        input: { ok: true },
        actor: { assurance: 'link_holder', subject: 'human_link:ses_cli_witness' },
        acceptedAt: new Date(Date.now() - 60_000),
        expiresAt: new Date(Date.now() + 30 * 86_400_000),
        recipient: { audience: 'wks_corpus', returnChannelId: null },
      }),
      key,
    );
    const base = archivalEnvelope(receipt, signArchivalCore(buildArchivalCore(receipt, 1), key));
    const batch = witnessBatch([base.signed_core]);
    const envelopeFile = join(dir, 'witnessed.json');
    await writeFile(envelopeFile, JSON.stringify({ ...base, evidence: [batch.evidence[0]] }));
    const rootFile = join(dir, 'trusted_root.json');
    await writeFile(rootFile, trustedRootJson(batch.trustedRoot));
    const witnessKeysFile = join(dir, 'sess-witness-keys.json');
    await writeFile(witnessKeysFile, witnessKeySetJson(issuer, [batch.key.trusted]));
    const otherKeysFile = join(dir, 'other-witness-keys.json');
    await writeFile(otherKeysFile, witnessKeySetJson('https://other.example', [batch.key.trusted]));
    const notRoot = join(dir, 'not-root.json');
    await writeFile(notRoot, JSON.stringify({ mediaType: 'text/plain' }));
    // A trusted root whose log base URL is not https: an unusable trust anchor (checkWitnessAnchors).
    const httpRoot = JSON.parse(trustedRootJson(batch.trustedRoot)) as { tlogs: { baseUrl: string }[] };
    for (const l of httpRoot.tlogs) l.baseUrl = l.baseUrl.replace(/^https:/, 'http:');
    const unusableRoot = join(dir, 'unusable-root.json');
    await writeFile(unusableRoot, JSON.stringify(httpRoot));
    const badContent = join(dir, 'bad-content.json');
    await writeFile(badContent, JSON.stringify({ surface: {} }));
    const args = ['verify', '--archival', envelopeFile, '--keys', keysFile, '--issuer', issuer];
    const witnessed = await sess([
      ...args,
      '--witness-root',
      rootFile,
      '--witness-keys',
      witnessKeysFile,
      '--json',
    ]);
    expect(witnessed.stderr).toBe('');
    expect(witnessed.code).toBe(0);
    const out = JSON.parse(witnessed.stdout) as { verification: ArchivalVerification };
    expect(out.verification.witness).toEqual({
      status: 'witnessed',
      reason: 'verified',
      witnessed_at: batch.witnessedAt.toISOString(),
    });
    const library = await verifyArchivalEnvelope(JSON.stringify({ ...base, evidence: [batch.evidence[0]] }), {
      trustedKeys: corpusTrustedKeys(),
      now: new Date(out.verification.checked_at),
      expectedContext: { issuer },
      witnessAnchors: {
        trustedRoot: parseTrustedRoot(trustedRootJson(batch.trustedRoot)),
        witnessKeys: parseWitnessKeySet(JSON.parse(witnessKeySetJson(issuer, [batch.key.trusted])), issuer),
      },
    });
    expect(out.verification).toEqual(JSON.parse(JSON.stringify(library)));
    const human = await sess([...args, '--witness-root', rootFile, '--witness-keys', witnessKeysFile]);
    expect(human.code).toBe(0);
    expect(human.stdout).toContain(
      `witnessed: verified, existed no later than ${batch.witnessedAt.toISOString()}`,
    );
    // Without anchors from the caller the evidence is never trusted on its own.
    const bare = await sess([...args, '--json']);
    expect(bare.code).toBe(0);
    expect((JSON.parse(bare.stdout) as { verification: ArchivalVerification }).verification.witness).toEqual({
      status: 'indeterminate',
      reason: 'witness_trust_unavailable',
    });
    // Usage and file errors: exit 2, nothing on stdout, no network.
    const usage: Array<[string, string[]]> = [
      ['root without keys', [...args, '--witness-root', rootFile]],
      ['keys without root', [...args, '--witness-keys', witnessKeysFile]],
      ['key set of another issuer', [...args, '--witness-root', rootFile, '--witness-keys', otherKeysFile]],
      ['not a trusted root', [...args, '--witness-root', notRoot, '--witness-keys', witnessKeysFile]],
      [
        'an unusable trust anchor',
        [...args, '--witness-root', unusableRoot, '--witness-keys', witnessKeysFile],
      ],
      ['content is not {surface, input}', [...args, '--content', badContent]],
      ['no keys', ['verify', '--archival', envelopeFile]],
      ['two envelopes', ['verify', '--archival', envelopeFile, envelopeFile, '--keys', keysFile]],
      [
        'archival options without --archival',
        ['verify', envelopeFile, '--issuer', issuer, '--keys', keysFile, '--content', badContent],
      ],
      [
        'witness without --archival',
        [
          'verify',
          envelopeFile,
          '--issuer',
          issuer,
          '--keys',
          keysFile,
          '--witness-root',
          rootFile,
          '--witness-keys',
          witnessKeysFile,
        ],
      ],
      ['missing envelope', ['verify', '--archival', join(dir, 'absent.json'), '--keys', keysFile]],
      ['repeated --archival', ['verify', '--archival', '--archival', envelopeFile, '--keys', keysFile]],
    ];
    for (const [label, a] of usage) {
      const r = await sess(a);
      expect(r.code, label).toBe(2);
      expect(r.stdout, label).toBe('');
      expect(r.stderr, label).toMatch(/^sess: /);
      expect(r.stderr, label).not.toContain('NETWORK-ATTEMPT');
    }
    const help = await sess(['--help']);
    expect(help.code).toBe(0);
    expect(help.stdout).toContain('Usage: sess verify --archival <envelope.json> --keys <jwks.json>');
  }, 60_000);
});
