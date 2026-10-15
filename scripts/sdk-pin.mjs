// The single SDK candidate pin: release/sdk-candidate.json (not packed into the SDK tarball).
//
//   node scripts/sdk-pin.mjs pack [--out <dir>] [--build]
//       Pack the CURRENT repository root and accept the tarball only if its SHA-256 and SHA-512
//       equal the pin. --build first runs `npm ci --ignore-scripts` (when node_modules is missing)
//       and `npm run build`. Prints the tarball path as the last line of stdout. Used by CI and by
//       consumers that still install the unpublished candidate (the Node quickstart installs the
//       published version from the registry).
//   node scripts/sdk-pin.mjs verify
//       Part of `npm run check` (after check:package): the packed root bytes recorded in
//       .artifacts/package-result.json equal the pin, and every consumer (adapter manifests,
//       lockfiles, compatibility records, quickstart, create-agent starter) agrees with it. Any packed-file change
//       therefore fails until the pin is deliberately updated.
//   node scripts/sdk-pin.mjs update            (npm run pin:update)
//       Deliberate repin after a reviewed packed-file change: builds and packs the current root,
//       writes the pin, and updates every consumer consistently. Review the diff, then run
//       `npm run check` and the adapter checks.
//
// Nothing here publishes, tags or contacts the registry.
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
import { fileURLToPath, pathToFileURL } from 'node:url';

export const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const PIN_PATH = join(root, 'release', 'sdk-candidate.json');
const log = (message) => process.stderr.write(`sdk-pin: ${message}\n`);
export class Refusal extends Error {}
const refuse = (message) => {
  throw new Refusal(message);
};
const readJson = (path) => JSON.parse(readFileSync(path, 'utf8'));
const writeJson = (path, value) => writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
export const readPin = () => readJson(PIN_PATH);

function digests(path) {
  const bytes = readFileSync(path);
  return {
    sha256: createHash('sha256').update(bytes).digest('hex'),
    integrity: `sha512-${createHash('sha512').update(bytes).digest('base64')}`,
  };
}
function npm(args, cwd, inherit = false) {
  const options = {
    cwd,
    encoding: 'utf8',
    stdio: inherit ? ['ignore', process.stderr, process.stderr] : ['ignore', 'pipe', 'pipe'],
  };
  if (process.env.npm_execpath)
    return execFileSync(process.execPath, [process.env.npm_execpath, ...args], options);
  return execFileSync('npm', args, { ...options, shell: process.platform === 'win32' });
}

function build() {
  if (!existsSync(join(root, 'node_modules')))
    npm(['ci', '--ignore-scripts', '--no-audit', '--no-fund'], root, true);
  npm(['run', 'build'], root, true);
}

/** Packs the current root into a fresh temporary directory; returns { path, filename, work }. */
function packRoot() {
  if (!existsSync(join(root, 'dist', 'index.js')))
    refuse('the SDK root is not built; use --build (or npm ci --ignore-scripts && npm run build).');
  const work = mkdtempSync(join(tmpdir(), 'sess-sdk-pin-'));
  try {
    const packed = JSON.parse(
      npm(['pack', '--json', '--ignore-scripts', '--pack-destination', work], root),
    )[0];
    return { path: join(work, packed.filename), filename: packed.filename, work };
  } catch (error) {
    rmSync(work, { recursive: true, force: true });
    throw error;
  }
}

/** pack: the current root's bytes, accepted only if they equal the pin. */
export function pack({ out, doBuild = false }) {
  const pin = readPin();
  if (doBuild) build();
  const packed = packRoot();
  try {
    const d = digests(packed.path);
    if (packed.filename !== pin.filename || d.sha256 !== pin.sha256 || d.integrity !== pin.integrity)
      refuse(
        `packed root ${packed.filename} (sha256 ${d.sha256}) is not the pinned ${pin.filename} (sha256 ${pin.sha256}). ` +
          'If a packed file changed deliberately, run `npm run pin:update` and review the result.',
      );
    mkdirSync(out, { recursive: true });
    const target = join(out, pin.filename);
    copyFileSync(packed.path, target); // copy, not rename: --out may be on another filesystem (EXDEV)
    log(`accepted pinned ${pin.name}@${pin.version} (sha256 ${pin.sha256})`);
    return target;
  } finally {
    rmSync(packed.work, { recursive: true, force: true });
  }
}

// --- Consumers kept consistent with the pin. ---
const MCP = join(root, 'adapters', 'mcp');
const OPENCLAW = join(root, 'adapters', 'openclaw');
const QUICKSTART = join(root, 'examples', 'quickstart-node');
// The starter agent written by `npm create @sess.si/agent` (and the public starter template).
const STARTER = join(root, 'create-agent', 'template');
const SDK_DEPENDENCY_FIELDS = ['dependencies', 'engines', 'license'];

/** Returns a list of drift descriptions (empty when every consumer agrees with the pin). */
export function consumerDrift(pin = readPin()) {
  const drift = [];
  const expect = (label, actual, wanted) => {
    if (JSON.stringify(actual) !== JSON.stringify(wanted))
      drift.push(`${label}: ${JSON.stringify(actual)} != ${JSON.stringify(wanted)}`);
  };
  for (const [label, dir] of [
    ['adapters/mcp', MCP],
    ['adapters/openclaw', OPENCLAW],
    ['examples/quickstart-node', QUICKSTART],
    ['create-agent/template', STARTER],
  ]) {
    expect(
      `${label} package.json dependency`,
      readJson(join(dir, 'package.json')).dependencies?.[pin.name],
      pin.version,
    );
  }
  for (const [label, dir, resolved] of [
    ['adapters/mcp', MCP, `file:.candidate/${pin.filename}`],
    ['adapters/openclaw', OPENCLAW, undefined],
  ]) {
    const lock = readJson(join(dir, 'package-lock.json'));
    const entry = lock.packages?.[`node_modules/${pin.name}`] ?? {};
    expect(`${label} lock root dependency`, lock.packages?.['']?.dependencies?.[pin.name], pin.version);
    expect(`${label} lock version`, entry.version, pin.version);
    expect(`${label} lock integrity`, entry.integrity, pin.integrity);
    // MCP resolves the candidate tarball until the registry switch; OpenClaw omits resolved URLs.
    if (!(label === 'adapters/mcp' && String(entry.resolved).startsWith('https://registry.npmjs.org/')))
      expect(`${label} lock resolved`, entry.resolved, resolved);
    for (const field of SDK_DEPENDENCY_FIELDS)
      expect(`${label} lock ${field}`, entry[field], pin.package[field]);
  }
  const compatibility = readJson(join(MCP, 'compatibility.json')).sessSdk;
  expect('adapters/mcp compatibility version', compatibility.version, pin.version);
  expect('adapters/mcp compatibility sha256', compatibility.sha256, pin.sha256);
  expect('adapters/mcp compatibility integrity', compatibility.integrity, pin.integrity);
  expect(
    'adapters/mcp compatibility candidatePath',
    compatibility.candidatePath,
    `.candidate/${pin.filename}`,
  );
  return drift;
}

/** verify: packed root bytes (from check:package) and every consumer equal the pin. */
export function verify() {
  const pin = readPin();
  const resultPath = join(root, '.artifacts', 'package-result.json');
  if (!existsSync(resultPath)) refuse('run npm run check:package first (it records the packed root bytes).');
  const result = readJson(resultPath);
  if (result.filename !== pin.filename || result.sha256 !== pin.sha256 || result.integrity !== pin.integrity)
    refuse(
      `the packed root (${result.filename}, sha256 ${result.sha256}) differs from release/sdk-candidate.json ` +
        `(${pin.filename}, sha256 ${pin.sha256}). A packed file changed: review it, then run npm run pin:update.`,
    );
  const drift = consumerDrift(pin);
  if (drift.length)
    refuse(`consumers disagree with the pin (run npm run pin:update):\n  ${drift.join('\n  ')}`);
  log(
    `root bytes and ${['mcp', 'openclaw', 'quickstart', 'starter'].length} consumers match ${pin.name}@${pin.version} (sha256 ${pin.sha256})`,
  );
}

/** update: deliberate repin of the current root bytes and every consumer. */
export function update() {
  build();
  const packed = packRoot();
  let pin;
  try {
    const manifest = readJson(join(root, 'package.json'));
    const d = digests(packed.path);
    pin = {
      $comment:
        'Single SDK candidate pin. Update only with `npm run pin:update` after a reviewed packed-file change; consumers and npm run check verify against it.',
      name: manifest.name,
      version: manifest.version,
      filename: packed.filename,
      sha256: d.sha256,
      integrity: d.integrity,
      package: {
        license: manifest.license,
        dependencies: manifest.dependencies,
        engines: manifest.engines,
      },
    };
  } finally {
    rmSync(packed.work, { recursive: true, force: true });
  }
  writeJson(PIN_PATH, pin);
  for (const dir of [MCP, OPENCLAW, QUICKSTART, STARTER]) {
    const path = join(dir, 'package.json');
    const text = readFileSync(path, 'utf8');
    const current = readJson(path).dependencies?.[pin.name];
    if (!current) refuse(`${path} has no ${pin.name} dependency.`);
    writeFileSync(path, text.replace(`"${pin.name}": "${current}"`, `"${pin.name}": "${pin.version}"`));
  }
  for (const [dir, resolved] of [
    [MCP, `file:.candidate/${pin.filename}`],
    [OPENCLAW, undefined],
  ]) {
    const path = join(dir, 'package-lock.json');
    const lock = readJson(path);
    const key = `node_modules/${pin.name}`;
    const entry = lock.packages[key];
    // A changed SDK dependency set changes the transitive tree: that needs a real lock regeneration.
    if (JSON.stringify(entry.dependencies) !== JSON.stringify(pin.package.dependencies))
      refuse(`${path}: the SDK's dependencies changed; regenerate this lockfile with npm, then re-run.`);
    lock.packages[''].dependencies[pin.name] = pin.version;
    lock.packages[key] = {
      version: pin.version,
      ...(resolved ? { resolved } : {}),
      integrity: pin.integrity,
      license: pin.package.license,
      dependencies: pin.package.dependencies,
      engines: pin.package.engines,
    };
    writeJson(path, lock);
  }
  const compatibilityPath = join(MCP, 'compatibility.json');
  const compatibility = readJson(compatibilityPath);
  Object.assign(compatibility.sessSdk, {
    version: pin.version,
    sha256: pin.sha256,
    integrity: pin.integrity,
    candidatePath: `.candidate/${pin.filename}`,
  });
  writeJson(compatibilityPath, compatibility);
  // Format what was written with the repository's locked prettier (lockfiles are prettier-ignored).
  execFileSync(
    process.execPath,
    [
      join(root, 'node_modules', 'prettier', 'bin', 'prettier.cjs'),
      '--write',
      PIN_PATH,
      compatibilityPath,
      ...[MCP, OPENCLAW, QUICKSTART, STARTER].map((dir) => join(dir, 'package.json')),
    ],
    { cwd: root, stdio: 'ignore' },
  );
  const drift = consumerDrift(pin);
  if (drift.length) refuse(`update left drift:\n  ${drift.join('\n  ')}`);
  log(
    `pinned ${pin.name}@${pin.version} sha256 ${pin.sha256}; updated MCP, OpenClaw, quickstart and starter. ` +
      'Next: review the diff, run npm run check, then npm run setup + npm run check in adapters/mcp and the OpenClaw checks.',
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const [command, ...args] = process.argv.slice(2);
  try {
    if (command === 'pack') {
      const outArg = args.includes('--out') ? args[args.indexOf('--out') + 1] : undefined;
      if (args.includes('--out') && !outArg) refuse('--out requires a directory.');
      console.log(
        pack({
          out: resolve(outArg ?? join(root, '.artifacts', 'sdk-candidate')),
          doBuild: args.includes('--build'),
        }),
      );
    } else if (command === 'verify') verify();
    else if (command === 'update') update();
    else refuse('usage: node scripts/sdk-pin.mjs pack [--out <dir>] [--build] | verify | update');
  } catch (error) {
    log(error instanceof Refusal ? `REFUSED: ${error.message}` : `failed: ${error.message}`);
    process.exitCode = 1;
  }
}
