import { execFileSync } from 'node:child_process';
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
if (manifest.name !== '@sess/sdk' || manifest.type !== 'module' || manifest.license !== 'Apache-2.0')
  throw new Error('Package identity drift.');
if (
  JSON.stringify(Object.keys(manifest.exports).sort()) !== JSON.stringify(['.', './receipts', './webhooks'])
)
  throw new Error('Unexpected public export.');
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
    dependencies: { '@sess/sdk': packageSpec },
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
      'node_modules/@sess/sdk': {
        version: manifest.version,
        resolved: packageSpec,
        integrity: packed.integrity,
        license: manifest.license,
        dependencies: manifest.dependencies,
        engines: manifest.engines,
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
  const installed = join(consumer, 'node_modules/@sess/sdk');
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
const { Sess, SessError, isInteractiveSession } = await import('@sess/sdk');
const { verifyDecisionReceipt } = await import('@sess/sdk/receipts');
const { verifyWebhook } = await import('@sess/sdk/webhooks');
assert.equal(typeof verifyDecisionReceipt, 'function');
assert.equal(typeof verifyWebhook, 'function');
assert.equal(typeof isInteractiveSession, 'function');
assert.throws(() => new Sess({ apiKey: undefined }), SessError);
const client = new Sess({ apiKey: 'synthetic-owner-key' });
assert.equal(typeof client.sessions.waitForResponse, 'function');
assert.equal(typeof client.webhooks.rotateSecret, 'function');
await assert.rejects(import('@sess/sdk/transport'), { code: 'ERR_PACKAGE_PATH_NOT_EXPORTED' });
`,
  );
  if (run(process.execPath, ['smoke.mjs'], consumer).trim())
    throw new Error('SDK import/constructor wrote unexpected output.');
  await writeFile(
    join(consumer, 'commonjs.cjs'),
    `
'use strict';
(async () => {
  const { Sess } = await import('@sess/sdk');
  const { verifyWebhook } = await import('@sess/sdk/webhooks');
  const sess = new Sess({ apiKey: 'synthetic-owner-key', fetch: () => { throw new Error('No network'); } });
  if (typeof sess.sessions.retrieve !== 'function' || typeof verifyWebhook !== 'function') throw new Error('CommonJS dynamic import failed');
})().catch(() => { process.exitCode = 1; });
`,
  );
  run(process.execPath, ['commonjs.cjs'], consumer);
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
import { Sess, type InteractiveInteraction, type Session, isInteractiveSession, type FieldSchema } from '@sess/sdk';
import { verifyDecisionReceipt, type ReceiptKeySet } from '@sess/sdk/receipts';
import { verifyWebhook } from '@sess/sdk/webhooks';
const interaction = { mode: 'interactive', title: 'Review', source: { kind: 'sess_surface', components: [{ type: 'field', name: 'amount', label: 'Amount', schema: { type: 'number' }, value: 12 }] }, actions: [{ id: 'submit', label: 'Submit' }] } satisfies InteractiveInteraction;
const sess = new Sess({ apiKey: 'synthetic-owner-key' });
void sess.sessions.create({ interaction });
declare const current: Session;
if (isInteractiveSession(current)) { const unknownValue: unknown = current.responses[0]?.data.amount; void unknownValue; }
// @ts-expect-error no unsupported JSON Schema keyword in ergonomic authoring
const bad: FieldSchema = { type: 'string', pattern: '[a-z]+' };
// @ts-expect-error no invented cancellation endpoint
void sess.sessions.cancel;
// @ts-expect-error business results are not an unchecked generic cast
void sess.sessions.waitForResponse<{ amount: number }>;
void verifyDecisionReceipt; void verifyWebhook; void (null as ReceiptKeySet | null); void bad;
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
import { Sess } from '@sess/sdk';
import { verifyDecisionReceipt } from '@sess/sdk/receipts';
import { verifyWebhook } from '@sess/sdk/webhooks';
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
  let sourceTreeDirty = null;
  try {
    sourceCommit = run('git', ['rev-parse', 'HEAD']).trim();
    sourceTreeDirty = run('git', ['status', '--porcelain', '--untracked-files=all']).trim().length !== 0;
  } catch {
    // A downloaded source archive may have no Git metadata. Release CI requires it.
  }
  const result = {
    version: manifest.version,
    sourceCommit,
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
      'TypeScript 5.9.3 and 7.0.2',
      'Node server bundle',
      'included source maps',
      'no import/constructor network/timers/output',
    ],
  };
  if (result.integrity !== packed.integrity) throw new Error('Pack integrity differs from tested bytes.');
  await writeFile('.artifacts/package-result.json', JSON.stringify(result, null, 2) + '\n');
  console.log(JSON.stringify(result, null, 2));
} finally {
  await rm(consumer, { recursive: true, force: true });
}
