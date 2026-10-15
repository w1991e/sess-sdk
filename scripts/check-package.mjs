import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';

const root = process.cwd();
function run(command, args, cwd = root) {
  return execFileSync(command, args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
}
function npm(args, cwd = root) {
  // npm's own entry point avoids shell quoting and npm.cmd differences on Windows.
  if (process.env.npm_execpath) return run(process.execPath, [process.env.npm_execpath, ...args], cwd);
  if (process.platform === 'win32') throw new Error('Run this check through npm run check:package.');
  return run('npm', args, cwd);
}
const manifest = JSON.parse(await readFile('package.json', 'utf8'));
const lock = JSON.parse(await readFile('package-lock.json', 'utf8'));
if (manifest.name !== '@sess.si/sdk' || manifest.type !== 'module' || manifest.license !== 'Apache-2.0')
  throw new Error('Package identity drift.');
if (
  lock.name !== manifest.name ||
  lock.version !== manifest.version ||
  lock.packages['']?.name !== manifest.name ||
  lock.packages['']?.version !== manifest.version
)
  throw new Error('Root lockfile identity drift.');
if (
  JSON.stringify(Object.keys(manifest.exports).sort()) !== JSON.stringify(['.', './receipts', './webhooks'])
)
  throw new Error('Unexpected public export.');
// One executable: the offline `sess verify <file>` command.
if (JSON.stringify(manifest.bin) !== JSON.stringify({ sess: './dist/cli/main.js' }))
  throw new Error('Unexpected package executable.');
for (const hook of [
  'preinstall',
  'install',
  'postinstall',
  'prepare',
  'prepack',
  'postpack',
  'prepublish',
  'prepublishOnly',
  'publish',
  'postpublish',
]) {
  if (manifest.scripts?.[hook]) throw new Error(`Consumer/release lifecycle hook is forbidden: ${hook}`);
}
if (
  JSON.stringify(Object.keys(manifest.dependencies).sort()) !==
    JSON.stringify(['canonicalize', 'jose', 'standardwebhooks']) ||
  Object.values(manifest.dependencies).some((v) => /^(file:|git|workspace:)/.test(v))
)
  throw new Error('Runtime dependency boundary drift.');
await mkdir('.artifacts', { recursive: true });
await rm('.artifacts/package-result.json', { force: true });
const packed = JSON.parse(npm(['pack', '--json', '--ignore-scripts', '--pack-destination', '.artifacts']))[0];
if (
  packed.name !== manifest.name ||
  packed.version !== manifest.version ||
  packed.id !== `${manifest.name}@${manifest.version}` ||
  !/^[A-Za-z0-9][A-Za-z0-9._-]*\.tgz$/.test(packed.filename)
)
  throw new Error('npm pack identity or filename drift.');
const tarball = resolve('.artifacts', packed.filename);
for (const required of ['README.md', 'LICENSE', 'NOTICE', 'CHANGELOG.md', 'package.json']) {
  if (!packed.files.some((file) => file.path === required))
    throw new Error(`Missing required package file: ${required}`);
}
for (const file of packed.files) {
  if (!/^(?:dist\/|src\/|README\.md$|LICENSE$|NOTICE$|CHANGELOG\.md$|package\.json$)/.test(file.path))
    throw new Error(`Unexpected tarball file: ${file.path}`);
  if (/(?:^|\/)(?:\.env|node_modules|tests|\.git|checkpoints)(?:\/|\.|$)/.test(file.path))
    throw new Error('Private or development content in package.');
}
for (const entry of Object.values(manifest.exports)) {
  if (
    !packed.files.some((f) => `./${f.path}` === entry.import) ||
    !packed.files.some((f) => `./${f.path}` === entry.types)
  )
    throw new Error('Missing compiled public export.');
}
const consumer = await mkdtemp(join(tmpdir(), 'sess-packed-'));
try {
  const packageSpec = pathToFileURL(tarball).href;
  const consumerManifest = {
    name: 'sess-packed-consumer',
    version: '1.0.0',
    private: true,
    type: 'module',
    dependencies: { '@sess.si/sdk': packageSpec },
  };
  // Preserve the reviewed transitive resolutions. A clean npm ci cache contains
  // integrity-addressed archives, but need not contain registry packuments for
  // resolving transitive ranges during an unlocked offline npm install.
  const consumerLock = {
    name: consumerManifest.name,
    version: consumerManifest.version,
    lockfileVersion: 3,
    requires: true,
    packages: {
      '': {
        name: consumerManifest.name,
        version: consumerManifest.version,
        dependencies: consumerManifest.dependencies,
      },
      ...Object.fromEntries(Object.entries(lock.packages).filter(([path, entry]) => path && !entry.dev)),
      'node_modules/@sess.si/sdk': {
        version: manifest.version,
        resolved: packageSpec,
        integrity: packed.integrity,
        license: manifest.license,
        dependencies: manifest.dependencies,
        engines: manifest.engines,
        // npm links executables from the lockfile entry, as it does for a registry install.
        bin: manifest.bin,
      },
    },
  };
  async function installFixture() {
    await writeFile(join(consumer, 'package.json'), JSON.stringify(consumerManifest));
    await writeFile(join(consumer, 'package-lock.json'), JSON.stringify(consumerLock));
    npm(['ci', '--offline', '--ignore-scripts', '--no-audit', '--no-fund'], consumer);
  }
  await installFixture();
  if (existsSync(join(consumer, 'node_modules/typescript')))
    throw new Error('Plain JS consumer unexpectedly needs a compiler.');
  const installed = join(consumer, 'node_modules/@sess.si/sdk');
  const installedManifest = JSON.parse(await readFile(join(installed, 'package.json'), 'utf8'));
  if (installedManifest.name !== manifest.name || installedManifest.version !== manifest.version)
    throw new Error('Installed tarball identity drift.');
  const files = new Set(packed.files.map((f) => resolve(installed, f.path)));
  for (const file of packed.files.filter((f) => f.path.endsWith('.map'))) {
    const map = JSON.parse(await readFile(join(installed, file.path), 'utf8'));
    for (const source of map.sources) {
      if (!files.has(resolve(dirname(join(installed, file.path)), map.sourceRoot ?? '', source)))
        throw new Error('Source map points outside included public source.');
    }
  }
  await writeFile(
    join(consumer, 'smoke.mjs'),
    `
import assert from 'node:assert/strict';
globalThis.fetch = () => { throw new Error('Unexpected import/constructor network'); };
for (const name of ['setTimeout', 'setInterval', 'setImmediate']) globalThis[name] = () => { throw new Error('Unexpected import/constructor timer'); };
for (const name of ['log', 'info', 'warn', 'error', 'debug']) console[name] = () => { throw new Error('Unexpected import/constructor console output'); };
process.stderr.write = () => { throw new Error('Unexpected import/constructor stderr output'); };
const { Sess, SessError, isInteractiveSession } = await import('@sess.si/sdk');
const { verifyDecisionReceipt, verifyDecisionBundle } = await import('@sess.si/sdk/receipts');
assert.equal(typeof verifyDecisionBundle, 'function');
const { verifyWebhook } = await import('@sess.si/sdk/webhooks');
assert.equal(typeof verifyDecisionReceipt, 'function');
assert.equal(typeof verifyWebhook, 'function');
assert.equal(typeof isInteractiveSession, 'function');
assert.throws(() => new Sess({ apiKey: undefined }), SessError);
const client = new Sess({ apiKey: 'synthetic-owner-key' });
assert.equal(typeof client.sessions.waitForResponse, 'function');
assert.equal(typeof client.webhooks.rotateSecret, 'function');
assert.equal(typeof client.ask, 'function');
await assert.rejects(client.ask({ question: 'Q', fields: [] }), (error) => error instanceof SessError && error.code === 'INVALID_QUESTION' && error.outcome === 'not_sent');
await assert.rejects(import('@sess.si/sdk/transport'), { code: 'ERR_PACKAGE_PATH_NOT_EXPORTED' });
// The superseded historical distribution is not provided as an alias.
await assert.rejects(import('@sess/sdk'), { code: 'ERR_MODULE_NOT_FOUND' });
`,
  );
  if (run(process.execPath, ['smoke.mjs'], consumer).trim())
    throw new Error('SDK import/constructor wrote unexpected output.');
  await writeFile(
    join(consumer, 'commonjs.cjs'),
    `
'use strict';
(async () => {
  const { Sess } = await import('@sess.si/sdk');
  const { verifyWebhook } = await import('@sess.si/sdk/webhooks');
  const sess = new Sess({ apiKey: 'synthetic-owner-key', fetch: () => { throw new Error('No network'); } });
  if (typeof sess.sessions.retrieve !== 'function' || typeof verifyWebhook !== 'function') throw new Error('CommonJS dynamic import failed');
})().catch(() => { process.exitCode = 1; });
`,
  );
  run(process.execPath, ['commonjs.cjs'], consumer);
  // The first README block, read from the installed package, runs against a synthetic runtime.
  const installedReadme = await readFile(join(installed, 'README.md'), 'utf8');
  const firstBlock = /```ts\n([\s\S]*?)\n```/.exec(installedReadme)?.[1];
  const askBlock = /<!-- example:ask -->\s*```ts\n([\s\S]*?)\n```/.exec(installedReadme)?.[1];
  if (!firstBlock || firstBlock !== askBlock)
    throw new Error('The packed README does not open with the sess.ask() example.');
  await writeFile(join(consumer, 'readme-first.mjs'), firstBlock);
  const fakeRuntime = pathToFileURL(join(root, 'tests/fixtures/fake-runtime.mjs')).href;
  await writeFile(
    join(consumer, 'readme-run.mjs'),
    `
import assert from 'node:assert/strict';
import { createFakeRuntime, FAKE_LINK } from ${JSON.stringify(fakeRuntime)};
const runtime = createFakeRuntime({ autoAnswer: { approved: true, amount: 12.5 } });
globalThis.fetch = runtime.fetch;
process.env.SESS_API_KEY = 'synthetic-owner-key';
const lines = [];
console.log = (text) => lines.push([text, runtime.counts.retrieve]);
await import('./readme-first.mjs');
assert.deepEqual(lines, [['Send this private link to the person: ' + FAKE_LINK, 0], ['Refund of 12.50 approved.', 3]]);
assert.deepEqual([runtime.counts.create, runtime.counts.complete, runtime.session().status], [1, 1, 'completed']);
`,
  );
  run(process.execPath, ['readme-run.mjs'], consumer);
  // The installed `sess` executable: linked by npm, prints help, and exits 2 on a usage error.
  const binLink = join(consumer, 'node_modules', '.bin', process.platform === 'win32' ? 'sess.cmd' : 'sess');
  if (!existsSync(binLink)) throw new Error('npm did not link the sess executable.');
  const cliPath = join(installed, 'dist', 'cli', 'main.js');
  if (!run(process.execPath, [cliPath, '--help'], consumer).startsWith('Usage: sess verify <bundle.json>'))
    throw new Error('The sess executable does not print its usage.');
  const usage = spawnSync(process.execPath, [cliPath, 'verify', 'absent.json'], {
    cwd: consumer,
    encoding: 'utf8',
  });
  if (usage.status !== 2 || usage.stdout !== '')
    throw new Error('The sess executable usage exit status drifted.');
  // Compiler is a fixture tool, not a runtime dependency of the installed package.
  consumerManifest.devDependencies = { '@types/node': manifest.devDependencies['@types/node'] };
  consumerLock.packages[''].devDependencies = consumerManifest.devDependencies;
  const addTypeDependency = (name) => {
    const path = `node_modules/${name}`;
    if (consumerLock.packages[path]) return;
    const entry = lock.packages[path];
    if (!entry) throw new Error(`Consumer type fixture needs a reviewed lock resolution for ${name}.`);
    consumerLock.packages[path] = { ...entry, dev: true };
    for (const dependency of Object.keys(entry.dependencies ?? {})) addTypeDependency(dependency);
  };
  addTypeDependency('@types/node');
  await installFixture();
  await writeFile(
    join(consumer, 'consumer.mts'),
    `
import { Sess, type InteractiveInteraction, type Session, isInteractiveSession, isInteractiveSurface, type SurfaceRevision, type FieldSchema } from '@sess.si/sdk';
import { verifyDecisionReceipt, verifyDecisionBundle, type DecisionBundleVerification, type ReceiptKeySet } from '@sess.si/sdk/receipts';
const bundleResult: Promise<DecisionBundleVerification> = verifyDecisionBundle({}, { issuer: 'https://api.sess.example', trustedKeys: { keys: [] } });
void bundleResult;
import { verifyWebhook } from '@sess.si/sdk/webhooks';
const interaction = { mode: 'interactive', title: 'Review', source: { kind: 'sess_surface', components: [{ type: 'field', name: 'amount', label: 'Amount', schema: { type: 'number' }, value: 12 }] }, actions: [{ id: 'submit', label: 'Submit' }] } satisfies InteractiveInteraction;
const sess = new Sess({ apiKey: 'synthetic-owner-key' });
void sess.sessions.create({ interaction });
declare const current: Session;
if (isInteractiveSession(current)) { const unknownValue: unknown = current.responses[0]?.data.amount; void unknownValue; }
declare const surface: SurfaceRevision;
if (isInteractiveSurface(surface)) { void surface.response_schema; void surface.interaction.actions; }
else { const mode: 'display' = surface.interaction.mode; void mode; }
// @ts-expect-error display Surface has no interactive response schema before narrowing
void surface.response_schema;
// @ts-expect-error no unsupported JSON Schema keyword in ergonomic authoring
const bad: FieldSchema = { type: 'string', pattern: '[a-z]+' };
// @ts-expect-error array item annotations are not supported by the runtime subset
const badItems: FieldSchema = { type: 'array', items: { type: 'string', enum: ['A'], title: 'unsupported' } };
// @ts-expect-error no invented cancellation endpoint
void sess.sessions.cancel;
// @ts-expect-error business results are not an unchecked generic cast
void sess.sessions.waitForResponse<{ amount: number }>;
async function askTypes() {
  const question = await sess.ask({ question: 'Q', fields: [{ name: 'ok', label: 'OK', type: 'boolean' }, { name: 'size', label: 'Size', type: 'choice', options: ['s', 'm'] }, { name: 'note', label: 'Note', type: 'text', required: false }] });
  const link: string = question.link;
  const answer = await question.answer({ timeoutMs: 60_000 });
  const ok: boolean = answer.ok; const size: 's' | 'm' = answer.size; const note: string | undefined = answer.note;
  // @ts-expect-error an optional field may be absent
  const required: string = answer.note;
  void link; void ok; void size; void note; void required;
}
void askTypes;
// @ts-expect-error unsupported field types are refused
void sess.ask({ question: 'Q', fields: [{ name: 'a', label: 'A', type: 'date' }] });
void verifyDecisionReceipt; void verifyWebhook; void (null as ReceiptKeySet | null); void bad; void badItems;
`,
  );
  await writeFile(
    join(consumer, 'tsconfig.json'),
    JSON.stringify({
      compilerOptions: {
        noEmit: true,
        strict: true,
        skipLibCheck: false,
        target: 'ES2022',
        module: 'NodeNext',
        moduleResolution: 'NodeNext',
        lib: ['ES2024', 'DOM', 'DOM.Iterable'],
        types: ['node'],
        typeRoots: ['./node_modules/@types'],
      },
      files: ['consumer.mts'],
    }),
  );
  for (const compiler of ['typescript', 'typescript-current']) {
    run(process.execPath, [join(root, 'node_modules', compiler, 'bin/tsc'), '-p', 'tsconfig.json'], consumer);
  }
  await writeFile(
    join(consumer, 'bundle.mjs'),
    `
import { Sess } from '@sess.si/sdk';
import { verifyDecisionReceipt } from '@sess.si/sdk/receipts';
import { verifyWebhook } from '@sess.si/sdk/webhooks';
export const client = new Sess({ apiKey: 'synthetic-owner-key' });
if (typeof verifyDecisionReceipt !== 'function' || typeof verifyWebhook !== 'function') throw new Error('Bundled subpath import failed');
`,
  );
  await build({
    entryPoints: [join(consumer, 'bundle.mjs')],
    bundle: true,
    platform: 'node',
    format: 'esm',
    target: 'node22',
    outfile: join(consumer, 'bundle-output.mjs'),
    logLevel: 'silent',
  });
  run(process.execPath, ['bundle-output.mjs'], consumer);
  const bytes = await readFile(tarball);
  let sourceCommit = null;
  let sourceTree = null;
  let sourceTreeDirty = null;
  try {
    sourceCommit = run('git', ['rev-parse', 'HEAD']).trim();
    sourceTree = run('git', ['rev-parse', 'HEAD^{tree}']).trim();
    sourceTreeDirty = run('git', ['status', '--porcelain', '--untracked-files=all']).trim().length !== 0;
  } catch {
    // A downloaded source archive may have no Git metadata. Release CI requires it.
  }
  const result = {
    name: manifest.name,
    version: manifest.version,
    sourceCommit,
    sourceTree,
    sourceTreeDirty,
    filename: packed.filename,
    tarball: `.artifacts/${packed.filename}`,
    sha256: createHash('sha256').update(bytes).digest('hex'),
    integrity: `sha512-${createHash('sha512').update(bytes).digest('base64')}`,
    compressedBytes: packed.size,
    unpackedBytes: packed.unpackedSize,
    directRuntimeDependencies: Object.keys(manifest.dependencies).length,
    node: process.version,
    checks: [
      'ESM JavaScript',
      'no compiler or hooks',
      'CommonJS dynamic import',
      'all subpaths',
      'no former-name alias',
      'TypeScript 5.9.3 and 7.0.2',
      'Node server bundle',
      'included source maps',
      'no import/constructor network/timers/output',
      'sess executable linked, usage and exit status',
      'README first block (sess.ask) from the packed README against a synthetic runtime',
    ],
  };
  if (result.integrity !== packed.integrity) throw new Error('Pack integrity differs from tested bytes.');
  await writeFile('.artifacts/package-result.json', JSON.stringify(result, null, 2) + '\n');
  console.log(JSON.stringify(result, null, 2));
} finally {
  await rm(consumer, { recursive: true, force: true });
}
