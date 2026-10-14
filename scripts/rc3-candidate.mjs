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
import { fileURLToPath, pathToFileURL } from 'node:url';

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

/** A refusal: thrown (never process.exit inside a try) so temporary directories are always removed. */
export class Refusal extends Error {}
const refuse = (message) => {
  throw new Refusal(message);
};
function digests(path) {
  const bytes = readFileSync(path);
  return {
    sha256: createHash('sha256').update(bytes).digest('hex'),
    integrity: `sha512-${createHash('sha512').update(bytes).digest('base64')}`,
  };
}
const run = (command, args, cwd, stdio = 'pipe') =>
  execFileSync(command, args, {
    cwd,
    encoding: 'utf8',
    stdio: stdio === 'pipe' ? ['ignore', 'pipe', 'pipe'] : ['ignore', process.stderr, process.stderr],
    shell: process.platform === 'win32' && command === 'npm',
  });

/**
 * Rebuilds the candidate from `expected.commit` and returns the accepted tarball path in `out`.
 * The CLI always passes the pinned RC3 record; tests may pass stricter expectations to exercise
 * the refusal paths. `tmpRoot` (default os.tmpdir()) holds the temporary work directory, which is
 * removed on success, refusal and error alike.
 */
export function reproduce({ out, expected = RC3, tmpRoot = tmpdir() }) {
  const approved = (path) => {
    const d = digests(path);
    return d.sha256 === expected.sha256 && d.integrity === expected.integrity;
  };
  const target = join(out, expected.filename);
  mkdirSync(out, { recursive: true });
  if (existsSync(target) && approved(target)) {
    log(`reusing the approved ${expected.name}@${expected.version} tarball (sha256 ${expected.sha256})`);
    return target;
  }
  try {
    run('git', ['cat-file', '-e', `${expected.commit}^{commit}`], root);
  } catch {
    refuse(
      `commit ${expected.commit} is not available. Fetch full history (git fetch origin, or fetch-depth: 0 in CI).`,
    );
  }
  if (run('git', ['rev-parse', `${expected.commit}^{tree}`], root).trim() !== expected.tree)
    refuse('the pinned commit does not have the reviewed tree. Refusing.');
  const work = mkdtempSync(join(tmpRoot, 'sess-sdk-rc3-'));
  try {
    const source = join(work, 'source');
    const pack = join(work, 'pack');
    mkdirSync(source);
    mkdirSync(pack);
    const archive = join(work, 'source.tar');
    run('git', ['archive', '--format=tar', '-o', archive, expected.commit], root);
    run('tar', ['-xf', archive, '-C', source], work);
    const manifest = JSON.parse(readFileSync(join(source, 'package.json'), 'utf8'));
    if (manifest.name !== expected.name || manifest.version !== expected.version)
      refuse(
        `the pinned source is ${manifest.name}@${manifest.version}, not ${expected.name}@${expected.version}.`,
      );
    log(
      `building ${expected.name}@${expected.version} from ${expected.commit} with npm ${run('npm', ['--version'], source).trim()}`,
    );
    run('npm', ['ci', '--ignore-scripts', '--no-audit', '--no-fund'], source, 'inherit');
    run('npm', ['run', 'build'], source, 'inherit');
    const packed = JSON.parse(
      run('npm', ['pack', '--json', '--ignore-scripts', '--pack-destination', pack], source),
    )[0];
    const produced = join(pack, packed.filename);
    if (packed.filename !== expected.filename || !approved(produced))
      refuse(
        `reproduced bytes differ from the approved candidate (sha256 ${digests(produced).sha256}). Refusing them.`,
      );
    copyFileSync(produced, target);
    log(`reproduced the approved ${expected.name}@${expected.version} (sha256 ${expected.sha256})`);
    return target;
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const args = process.argv.slice(2);
  const outArg = args.includes('--out') ? args[args.indexOf('--out') + 1] : undefined;
  try {
    if (args.includes('--out') && !outArg) refuse('--out requires a directory.');
    console.log(reproduce({ out: resolve(outArg ?? join(root, '.artifacts', 'rc3')) }));
  } catch (error) {
    // Cleanup already ran in reproduce()'s finally; only now set the failing exit status.
    log(error instanceof Refusal ? error.message : `failed: ${error.message}`);
    process.exitCode = 1;
  }
}
