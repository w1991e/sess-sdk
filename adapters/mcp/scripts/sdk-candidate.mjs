// CANDIDATE dependency mechanism for the unpublished @sess.si/sdk@0.1.0-rc.3.
//
// The adapter declares the exact registry dependency it will use after publication
// ("@sess.si/sdk": "0.1.0-rc.3"). Until then package-lock.json resolves that node to a local,
// gitignored tarball at .candidate/sess.si-sdk-0.1.0-rc.3.tgz. npm 11 does not enforce the lock
// integrity for file: tarballs, so this script is the integrity gate:
//
//   prepare  obtain the tarball (SESS_SDK_CANDIDATE_TGZ, or `npm pack` of the SDK repository root,
//            whose dist must already be built) and accept it only if its SHA-256 equals the pinned
//            reviewed candidate digest.
//   verify   re-hash .candidate/, check the lock entry's integrity equals the same bytes, and, when
//            installed, the installed @sess.si/sdk identity.
//
// Nothing here contacts the registry for @sess.si/sdk or fabricates a registry entry. Switching to
// the genuine published dependency/lockfile is a recorded release hold (see compatibility.json).
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const adapter = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const compatibility = JSON.parse(readFileSync(join(adapter, 'compatibility.json'), 'utf8'));
const pinned = compatibility.sessSdk;
const target = join(adapter, pinned.candidatePath);

function digests(path) {
  const bytes = readFileSync(path);
  return {
    sha256: createHash('sha256').update(bytes).digest('hex'),
    integrity: `sha512-${createHash('sha512').update(bytes).digest('base64')}`,
  };
}
function fail(message) {
  console.error(`sdk-candidate: ${message}`);
  process.exit(1);
}
function accept(path) {
  const d = digests(path);
  if (d.sha256 !== pinned.sha256 || d.integrity !== pinned.integrity)
    fail(`tarball digest ${d.sha256} is not the pinned candidate ${pinned.sha256}. Refusing it.`);
  return d;
}

function npm(args, cwd) {
  if (process.env.npm_execpath)
    return execFileSync(process.execPath, [process.env.npm_execpath, ...args], { cwd, encoding: 'utf8' });
  return execFileSync('npm', args, { cwd, encoding: 'utf8', shell: process.platform === 'win32' });
}

const command = process.argv[2];
if (command === 'prepare') {
  mkdirSync(dirname(target), { recursive: true });
  const supplied = process.env.SESS_SDK_CANDIDATE_TGZ;
  if (supplied) {
    accept(supplied);
    copyFileSync(supplied, target);
  } else {
    const root = resolve(adapter, '..', '..');
    const manifest = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
    if (manifest.name !== pinned.name || manifest.version !== pinned.version)
      fail(
        `repository root is ${manifest.name}@${manifest.version}, not the pinned ${pinned.name}@${pinned.version}.`,
      );
    if (!existsSync(join(root, 'dist', 'index.js')))
      fail('build the SDK root first (npm ci --ignore-scripts && npm run build at the repository root).');
    const out = mkdtempSync(join(tmpdir(), 'sess-sdk-candidate-'));
    try {
      const packed = JSON.parse(
        npm(['pack', '--json', '--ignore-scripts', '--pack-destination', out], root),
      )[0];
      const produced = join(out, packed.filename);
      accept(produced);
      copyFileSync(produced, target);
    } finally {
      rmSync(out, { recursive: true, force: true });
    }
  }
  console.log(`sdk-candidate: accepted CANDIDATE ${pinned.name}@${pinned.version} sha256=${pinned.sha256}`);
} else if (command === 'verify') {
  if (!existsSync(target)) fail(`missing ${pinned.candidatePath}; run npm run candidate:prepare first.`);
  accept(target);
  const lock = JSON.parse(readFileSync(join(adapter, 'package-lock.json'), 'utf8'));
  const entry = lock.packages?.['node_modules/@sess.si/sdk'];
  if (
    !entry ||
    entry.version !== pinned.version ||
    entry.resolved !== `file:${pinned.candidatePath}` ||
    entry.integrity !== pinned.integrity
  )
    fail('package-lock.json does not resolve @sess.si/sdk to the pinned candidate tarball.');
  const manifest = JSON.parse(readFileSync(join(adapter, 'package.json'), 'utf8'));
  if (manifest.dependencies?.['@sess.si/sdk'] !== pinned.version)
    fail('package.json must declare the exact @sess.si/sdk version.');
  const installed = join(adapter, 'node_modules', '@sess.si', 'sdk', 'package.json');
  if (existsSync(installed)) {
    const identity = JSON.parse(readFileSync(installed, 'utf8'));
    if (identity.name !== pinned.name || identity.version !== pinned.version)
      fail('installed @sess.si/sdk identity differs from the pinned candidate.');
  }
  console.log(`sdk-candidate: verified CANDIDATE ${pinned.name}@${pinned.version} sha256=${pinned.sha256}`);
} else {
  fail('usage: node scripts/sdk-candidate.mjs prepare|verify');
}
