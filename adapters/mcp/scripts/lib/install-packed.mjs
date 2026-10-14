// Packs @sess.si/mcp and installs that tarball plus the pinned @sess.si/sdk (the locked registry
// tarball, or a digest-checked local candidate tarball for a future unpublished pin) into a clean
// temporary consumer project: offline, --ignore-scripts, using only the reviewed production
// resolutions from the adapter lockfile. Shared by check-package, runtime-round and
// the client qualification scripts so they all exercise the same installed artifact.
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const adapterDir = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

const run = (command, args, cwd) =>
  execFileSync(command, args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
export function npm(args, cwd) {
  if (process.env.npm_execpath) return run(process.execPath, [process.env.npm_execpath, ...args], cwd);
  if (process.platform === 'win32') throw new Error('Run this script through npm run.');
  return run('npm', args, cwd);
}

export async function readAdapterRecords() {
  const read = async (name) => JSON.parse(await readFile(join(adapterDir, name), 'utf8'));
  return {
    manifest: await read('package.json'),
    lock: await read('package-lock.json'),
    compatibility: await read('compatibility.json'),
  };
}

/** Returns { consumer, installed, binPath, packed, tarball, productionCount, cleanup }. */
export async function installPacked() {
  const { manifest, lock, compatibility } = await readAdapterRecords();
  await mkdir(join(adapterDir, '.artifacts'), { recursive: true });
  const packed = JSON.parse(
    npm(
      ['pack', '--json', '--ignore-scripts', '--pack-destination', join(adapterDir, '.artifacts')],
      adapterDir,
    ),
  )[0];
  const tarball = join(adapterDir, '.artifacts', packed.filename);
  // Candidate mode installs the digest-checked local SDK tarball next to the adapter; registry
  // mode lets the adapter's exact dependency resolve to the locked registry tarball.
  const sdkEntry = lock.packages['node_modules/@sess.si/sdk'];
  const sdkMode = String(sdkEntry?.resolved).startsWith('file:') ? 'candidate' : 'registry';
  let sdkSpec;
  if (sdkMode === 'candidate') {
    const sdkTarball = join(adapterDir, compatibility.sessSdk.candidatePath);
    const sdkDigest = createHash('sha256')
      .update(await readFile(sdkTarball))
      .digest('hex');
    if (sdkDigest !== compatibility.sessSdk.sha256) throw new Error('SDK candidate tarball digest mismatch');
    sdkSpec = pathToFileURL(sdkTarball).href;
  } else if (sdkEntry?.integrity !== compatibility.sessSdk.integrity) {
    throw new Error('SDK registry lock integrity differs from the pinned version');
  }
  const consumer = await mkdtemp(join(tmpdir(), 'sess-mcp-packed-'));
  const mcpSpec = pathToFileURL(tarball).href;
  const consumerManifest = {
    name: 'sess-mcp-packed-consumer',
    version: '1.0.0',
    private: true,
    type: 'module',
    dependencies: { '@sess.si/mcp': mcpSpec, ...(sdkSpec ? { '@sess.si/sdk': sdkSpec } : {}) },
  };
  const production = Object.fromEntries(
    Object.entries(lock.packages).filter(
      ([path, entry]) => path && !entry.dev && path !== 'node_modules/@sess.si/sdk',
    ),
  );
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
      ...production,
      'node_modules/@sess.si/sdk': { ...sdkEntry, ...(sdkSpec ? { resolved: sdkSpec } : {}) },
      'node_modules/@sess.si/mcp': {
        version: manifest.version,
        resolved: mcpSpec,
        integrity: packed.integrity,
        license: manifest.license,
        dependencies: manifest.dependencies,
        bin: manifest.bin,
        engines: manifest.engines,
      },
    },
  };
  await writeFile(join(consumer, 'package.json'), JSON.stringify(consumerManifest));
  await writeFile(join(consumer, 'package-lock.json'), JSON.stringify(consumerLock));
  npm(['ci', '--offline', '--ignore-scripts', '--no-audit', '--no-fund'], consumer);
  const installed = join(consumer, 'node_modules', '@sess.si', 'mcp');
  return {
    consumer,
    installed,
    binPath: join(installed, manifest.bin['sess-mcp']),
    packed,
    tarball,
    productionCount: Object.keys(production).length + 2,
    sdkMode,
    cleanup: () => rm(consumer, { recursive: true, force: true }),
  };
}
