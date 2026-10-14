// Reproduce the approved @sess.si/sdk@0.1.0-rc.3 candidate tarball from its pinned, reviewed source.
//
//   node scripts/rc3-candidate.mjs [--out <dir>]
//
// The repository root may now carry a later successor candidate, so consumers that need the
// approved rc.3 bytes (the MCP and OpenClaw adapters and the Node quickstart) must not pack the
// current root. This script materializes commit cea3f1e (tree 53405908, identical to the reviewed
// f0d99f5f) with `git archive` into a temporary directory, runs `npm ci --ignore-scripts`,
// `npm run build` and `npm pack --ignore-scripts` there, and accepts the tarball only if its SHA-256
// and SHA-512 integrity equal the approved digests. It writes sess.si-sdk-0.1.0-rc.3.tgz into --out
// (default .artifacts/rc3 under the repository root) and prints the absolute path as the last line
// of stdout. An existing tarball in --out with the approved digests is reused.
//
// The commit must be present locally (CI: actions/checkout with fetch-depth: 0). Nothing here
// publishes, tags or modifies the repository; the temporary directory is removed afterwards.
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const RC3 = Object.freeze({
  name: '@sess.si/sdk',
  version: '0.1.0-rc.3',
  commit: 'cea3f1eda448e632d5e3a4e5e717bf4986c0e506',
  tree: '534059084cc7fb25f621c5297423a72a343bf2d6',
  filename: 'sess.si-sdk-0.1.0-rc.3.tgz',
  sha256: 'b4d29d8ff01fe8f21d2c7d72e1a8c7ed08ec7cf903efd98715a55a308daa0502',
  integrity:
    'sha512-vvFPa7AKr9ivoXu38ZgDxfozvPXhdWMsV/P6R8UkaijmHS0EG2zn6izIixH/DuZN9UHfmC5IHGn43ZoSHebOjw==',
});

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const log = (message) => process.stderr.write(`rc3-candidate: ${message}\n`);
function fail(message) {
  log(message);
  process.exit(1);
}
function digests(path) {
  const bytes = readFileSync(path);
  return {
    sha256: createHash('sha256').update(bytes).digest('hex'),
    integrity: `sha512-${createHash('sha512').update(bytes).digest('base64')}`,
  };
}
const approved = (path) => {
  const d = digests(path);
  return d.sha256 === RC3.sha256 && d.integrity === RC3.integrity;
};
const run = (command, args, cwd, stdio = 'pipe') =>
  execFileSync(command, args, {
    cwd,
    encoding: 'utf8',
    stdio: stdio === 'pipe' ? ['ignore', 'pipe', 'pipe'] : ['ignore', process.stderr, process.stderr],
    shell: process.platform === 'win32' && command === 'npm',
  });

const args = process.argv.slice(2);
const outArg = args.includes('--out') ? args[args.indexOf('--out') + 1] : undefined;
if (args.includes('--out') && !outArg) fail('--out requires a directory.');
const out = resolve(outArg ?? join(root, '.artifacts', 'rc3'));
const target = join(out, RC3.filename);
mkdirSync(out, { recursive: true });

if (existsSync(target) && approved(target)) {
  log(`reusing the approved ${RC3.name}@${RC3.version} tarball (sha256 ${RC3.sha256})`);
} else {
  try {
    run('git', ['cat-file', '-e', `${RC3.commit}^{commit}`], root);
  } catch {
    fail(
      `commit ${RC3.commit} is not available. Fetch full history (git fetch origin, or fetch-depth: 0 in CI).`,
    );
  }
  if (run('git', ['rev-parse', `${RC3.commit}^{tree}`], root).trim() !== RC3.tree)
    fail('the pinned commit does not have the reviewed tree. Refusing.');
  const work = mkdtempSync(join(tmpdir(), 'sess-sdk-rc3-'));
  try {
    const source = join(work, 'source');
    const pack = join(work, 'pack');
    mkdirSync(source);
    mkdirSync(pack);
    const archive = join(work, 'source.tar');
    run('git', ['archive', '--format=tar', '-o', archive, RC3.commit], root);
    run('tar', ['-xf', archive, '-C', source], work);
    const manifest = JSON.parse(readFileSync(join(source, 'package.json'), 'utf8'));
    if (manifest.name !== RC3.name || manifest.version !== RC3.version)
      fail(`the pinned source is ${manifest.name}@${manifest.version}, not ${RC3.name}@${RC3.version}.`);
    log(
      `building ${RC3.name}@${RC3.version} from ${RC3.commit} with npm ${run('npm', ['--version'], source).trim()}`,
    );
    run('npm', ['ci', '--ignore-scripts', '--no-audit', '--no-fund'], source, 'inherit');
    run('npm', ['run', 'build'], source, 'inherit');
    const packed = JSON.parse(
      run('npm', ['pack', '--json', '--ignore-scripts', '--pack-destination', pack], source),
    )[0];
    const produced = join(pack, packed.filename);
    if (packed.filename !== RC3.filename || !approved(produced)) {
      const d = digests(produced);
      fail(`reproduced bytes differ from the approved candidate (sha256 ${d.sha256}). Refusing them.`);
    }
    copyFileSync(produced, target);
    log(`reproduced the approved ${RC3.name}@${RC3.version} (sha256 ${RC3.sha256})`);
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}
console.log(target);
