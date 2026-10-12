// One-time implementation bootstrap. Removed before review; no consumer/install hook.
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import openapiTS, { astToString } from 'openapi-typescript';

await mkdir('contract', { recursive: true });
await mkdir('src/generated', { recursive: true });
await mkdir('docs', { recursive: true });
const response = await fetch('https://api.sess.si/openapi.json', { redirect: 'manual', signal: AbortSignal.timeout(15000) });
if (response.status !== 200) throw new Error('Public contract unavailable');
const bytes = Buffer.from(await response.arrayBuffer());
const blob = createHash('sha1').update('blob ' + bytes.length + '\0').update(bytes).digest('hex');
if (blob !== '1334a460f61d923871575ce8011d6b9616fa7a89') throw new Error('Public contract drift: re-review before generation');
await writeFile('contract/openapi.json', bytes);
const generator = JSON.parse(await readFile('node_modules/openapi-typescript/package.json', 'utf8')).version;
await writeFile('src/generated/openapi.ts', astToString(await openapiTS(JSON.parse(bytes.toString('utf8')))));
await writeFile('contract/contract-lock.json', JSON.stringify({
  source: 'https://api.sess.si/openapi.json',
  source_runtime_commit: '31ce5d557e6c6dd14972c8e8923f68ea294ce9b3',
  source_git_blob_sha1: blob,
  snapshot_sha256: createHash('sha256').update(bytes).digest('hex'),
  generator: 'openapi-typescript', generator_version: generator,
  recorded_at: new Date().toISOString()
}, null, 2) + '\n');
const names = ['jose', 'canonicalize', 'standardwebhooks', 'typescript', 'vitest', 'openapi-typescript', '@types/node', 'esbuild'];
const packages = [];
for (const name of names) {
  const data = JSON.parse(await readFile('node_modules/' + name + '/package.json', 'utf8'));
  packages.push({ name, version: data.version, license: data.license, engines: data.engines ?? null, repository: data.repository ?? null });
}
let audit;
try { audit = JSON.parse(execFileSync('npm', ['audit', '--json'], { encoding: 'utf8' })); }
catch (error) { audit = JSON.parse(error.stdout?.toString() || '{}'); }
const releases = await fetch('https://nodejs.org/dist/index.json', { signal: AbortSignal.timeout(10000) }).then(r => r.json());
await writeFile('contract/toolchain.json', JSON.stringify({
  checked_at: new Date().toISOString(),
  node22: releases.find(r => r.version.startsWith('v22.')).version.slice(1),
  node24: releases.find(r => r.version.startsWith('v24.')).version.slice(1),
  npm: execFileSync('npm', ['--version'], { encoding: 'utf8' }).trim(),
  typescript_consumer_current: JSON.parse(execFileSync('npm', ['view', 'typescript', 'version', '--json'], { encoding: 'utf8' })),
  packages, audit: audit.metadata ?? audit
}, null, 2) + '\n');
console.log(JSON.stringify({ blob, generator, packages, vulnerabilities: audit.metadata?.vulnerabilities }));
