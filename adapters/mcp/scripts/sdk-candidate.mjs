// @sess.si/sdk dependency gate for this adapter.
//
// package.json always declares the exact registry dependency on the pinned SDK version
// (release/sdk-candidate.json at the repository root, mirrored in compatibility.json).
// package-lock.json is a maintainer artifact (npm never ships it to consumers) and resolves that
// node in one of two modes:
//
//   candidate  `file:.candidate/<pinned filename>`, a gitignored local tarball, while the
//              SDK is unpublished. npm does not enforce lock integrity for file: tarballs, so this
//              script is the gate: only bytes with the pinned reviewed digest are accepted.
//   registry   the genuine npm registry tarball, after publication, with the same pinned integrity.
//
// Commands:
//   setup [--require-registry]
//                            registry mode: npm ci. candidate mode: prepare, then
//                            npm ci. --require-registry refuses candidate mode (used by releases).
//   prepare [--build-root]   obtain the candidate (SESS_SDK_CANDIDATE_TGZ, or `scripts/sdk-pin.mjs
//                            pack --build` at the root, which packs the current root and accepts
//                            only the pinned bytes) and accept it by digest. --build-root is kept
//                            for compatibility; the root is always built before packing.
//   verify                   check the lock entry (either mode), the candidate bytes (candidate
//                            mode) and the installed identity.
//   switch-to-registry [--apply]
//                            dry run by default: confirm the version is published with the pinned
//                            integrity. --apply then runs `npm install --save-exact` against the
//                            registry, checks the regenerated lock, re-downloads the tarball and
//                            compares its SHA-256, and records the published status.
//
// Nothing here fabricates a registry entry: registry mode is only reachable through npm itself.
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const adapter = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const compatibilityPath = join(adapter, 'compatibility.json');
const compatibility = JSON.parse(readFileSync(compatibilityPath, 'utf8'));
const pinned = compatibility.sessSdk;
const target = join(adapter, pinned.candidatePath);
const spec = `${pinned.name}@${pinned.version}`;
const REGISTRY_TARBALL = `https://registry.npmjs.org/${pinned.name}/-/sdk-${pinned.version}.tgz`;

function digests(path) {
  const bytes = readFileSync(path);
  return {
    sha256: createHash('sha256').update(bytes).digest('hex'),
    integrity: `sha512-${createHash('sha512').update(bytes).digest('base64')}`,
  };
}
function fail(message, code = 1) {
  console.error(`sdk-candidate: ${message}`);
  process.exit(code);
}
/** Returns a refusal message for bytes that are not the pinned candidate, otherwise undefined. */
function refusalFor(path) {
  const d = digests(path);
  return d.sha256 !== pinned.sha256 || d.integrity !== pinned.integrity
    ? `tarball digest ${d.sha256} is not the pinned candidate ${pinned.sha256}. Refusing it.`
    : undefined;
}
function accept(path) {
  const d = digests(path);
  if (d.sha256 !== pinned.sha256 || d.integrity !== pinned.integrity)
    fail(`tarball digest ${d.sha256} is not the pinned candidate ${pinned.sha256}. Refusing it.`);
  return d;
}
function npm(args, cwd, stdio = 'pipe') {
  const options = { cwd, encoding: 'utf8', stdio: stdio === 'pipe' ? ['ignore', 'pipe', 'pipe'] : 'inherit' };
  if (process.env.npm_execpath)
    return execFileSync(process.execPath, [process.env.npm_execpath, ...args], options);
  return execFileSync('npm', args, { ...options, shell: process.platform === 'win32' });
}
function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}
function lockEntry() {
  return readJson(join(adapter, 'package-lock.json')).packages?.['node_modules/@sess.si/sdk'];
}
/** 'candidate' | 'registry'; anything else stops. */
function lockMode(entry = lockEntry()) {
  if (!entry || entry.version !== pinned.version || entry.integrity !== pinned.integrity) return undefined;
  if (entry.resolved === `file:${pinned.candidatePath}`) return 'candidate';
  if (entry.resolved === REGISTRY_TARBALL) return 'registry';
  return undefined;
}

const [command, ...flags] = process.argv.slice(2);
if (command === 'setup') {
  // Maintainer and release entry point. Registry mode needs no candidate: npm ci installs the
  // locked registry tarball. Candidate mode prepares the digest-gated tarball first.
  const mode = lockMode();
  if (!mode)
    fail('package-lock.json resolves @sess.si/sdk to neither the pinned candidate nor the registry.');
  if (flags.includes('--require-registry') && mode !== 'registry')
    fail(
      'this step requires the genuine registry @sess.si/sdk dependency; the lock is in candidate mode.',
      4,
    );
  if (mode === 'candidate')
    execFileSync(process.execPath, [fileURLToPath(import.meta.url), 'prepare', '--build-root'], {
      stdio: 'inherit',
    });
  npm(['ci', '--ignore-scripts', '--no-audit', '--no-fund'], adapter, 'inherit');
  console.log(`sdk-candidate: setup complete in ${mode.toUpperCase()} mode`);
} else if (command === 'prepare') {
  mkdirSync(dirname(target), { recursive: true });
  const supplied = process.env.SESS_SDK_CANDIDATE_TGZ;
  if (supplied) {
    accept(supplied);
    copyFileSync(supplied, target);
  } else {
    // The current repository root is packed and accepted only if its bytes equal the single pin
    // (release/sdk-candidate.json, mirrored in compatibility.json by `npm run pin:update`).
    const root = resolve(adapter, '..', '..');
    const out = mkdtempSync(join(tmpdir(), 'sess-sdk-candidate-'));
    // Refusals are decided inside, reported only after the temporary directory is removed.
    let refusal;
    try {
      const produced = execFileSync(
        process.execPath,
        [join(root, 'scripts', 'sdk-pin.mjs'), 'pack', '--build', '--out', out],
        { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] },
      )
        .trim()
        .split('\n')
        .pop();
      refusal = refusalFor(produced);
      if (!refusal) copyFileSync(produced, target);
    } catch {
      refusal =
        'the pinned SDK candidate could not be packed from the repository root (see the output above).';
    } finally {
      rmSync(out, { recursive: true, force: true });
    }
    if (refusal) fail(refusal);
  }
  console.log(`sdk-candidate: accepted CANDIDATE ${spec} sha256=${pinned.sha256}`);
} else if (command === 'verify') {
  const manifest = readJson(join(adapter, 'package.json'));
  if (manifest.dependencies?.[pinned.name] !== pinned.version)
    fail('package.json must declare the exact @sess.si/sdk version.');
  const mode = lockMode();
  if (!mode)
    fail(
      'package-lock.json must resolve @sess.si/sdk either to the pinned candidate tarball or to the genuine registry tarball, with the pinned integrity.',
    );
  if (mode === 'candidate') {
    if (!existsSync(target)) fail(`missing ${pinned.candidatePath}; run npm run candidate:prepare first.`);
    accept(target);
  }
  const installed = join(adapter, 'node_modules', '@sess.si', 'sdk', 'package.json');
  if (existsSync(installed)) {
    const identity = readJson(installed);
    if (identity.name !== pinned.name || identity.version !== pinned.version)
      fail('installed @sess.si/sdk identity differs from the pinned version.');
  }
  console.log(`sdk-candidate: verified ${mode.toUpperCase()} ${spec} sha256=${pinned.sha256}`);
} else if (command === 'switch-to-registry') {
  const apply = flags.includes('--apply');
  let published;
  try {
    published = JSON.parse(npm(['view', spec, 'dist', '--json'], adapter));
  } catch {
    fail(`${spec} is not available from the registry yet; the candidate mode remains. Nothing changed.`, 3);
  }
  if (published?.integrity !== pinned.integrity)
    fail(
      `the registry integrity for ${spec} (${published?.integrity}) is not the reviewed ${pinned.integrity}. Refusing to switch.`,
    );
  console.log(`sdk-candidate: ${spec} is published with the pinned integrity.`);
  if (!apply) {
    console.log('sdk-candidate: dry run. Re-run with --apply to switch package-lock.json to the registry.');
    process.exit(0);
  }
  npm(['install', '--save-exact', '--ignore-scripts', '--no-audit', '--no-fund', spec], adapter, 'inherit');
  if (lockMode() !== 'registry')
    fail('the regenerated lock does not resolve the genuine registry tarball with the pinned integrity.');
  const out = mkdtempSync(join(tmpdir(), 'sess-sdk-registry-'));
  let refusal;
  try {
    const packed = JSON.parse(npm(['pack', spec, '--json', '--pack-destination', out], adapter))[0];
    refusal = refusalFor(join(out, packed.filename));
  } finally {
    rmSync(out, { recursive: true, force: true });
  }
  if (refusal) fail(refusal);
  compatibility.sessSdk = {
    ...pinned,
    status: 'published (registry)',
    source: REGISTRY_TARBALL,
    releaseHold: 'none for the SDK dependency; review the regenerated package-lock.json',
  };
  writeFileSync(compatibilityPath, `${JSON.stringify(compatibility, null, 2)}\n`);
  console.log(
    `sdk-candidate: switched to the registry. sha256=${pinned.sha256}. Review package-lock.json and compatibility.json, run npm run check, then commit.`,
  );
} else {
  fail(
    'usage: node scripts/sdk-candidate.mjs setup [--require-registry] | prepare [--build-root] | verify | switch-to-registry [--apply]',
  );
}
