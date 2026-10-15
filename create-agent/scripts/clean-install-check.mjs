// Clean-install check of the starter, timed against the 60 s "npm create -> agent running" budget.
//
//   node create-agent/scripts/clean-install-check.mjs [--offline] [--keep]
//
// 1. Packs create-agent/ into a fresh temporary directory outside the repository (no node_modules
//    in any ancestor), exactly as it would be published. No lifecycle script runs (--ignore-scripts).
// 2. Starts the clock and runs the packed initializer the way `npm create @sess.si/agent my-agent`
//    does (`npm create` is `npm exec @sess.si/create-agent`; a local tarball has to be named with
//    `npm exec --package=<tarball>`), then the README's `npm install --ignore-scripts` and
//    `npm start`. The clock stops when the agent prints "Agent running.".
// 3. Accepts the install only if @sess.si/sdk is the pinned version from the public registry with
//    the integrity recorded in release/sdk-candidate.json, and the generated files pass the
//    template parity check.
// 4. Lets the agent finish both rounds against the offline fake world (create-agent/test/
//    fake-world.mjs: fake SESS API with genuinely signed receipts, fake MET Norway and NWS).
//
// Network: only the npm install of the SDK and its pinned dependencies (npm's cache is preferred;
// --offline forbids the network and fails if the cache lacks them). No SESS or weather traffic.
import { execFileSync, spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, realpathSync, rmSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const BUDGET_MS = 60_000;
const PUBLIC_REGISTRY = 'https://registry.npmjs.org/';
const here = dirname(fileURLToPath(import.meta.url));
const initializer = resolve(here, '..');
const root = resolve(initializer, '..');
const fakeWorld = join(initializer, 'test', 'fake-world.mjs');
const pin = JSON.parse(readFileSync(join(root, 'release', 'sdk-candidate.json'), 'utf8'));
const args = process.argv.slice(2);
const offline = args.includes('--offline');
const keep = args.includes('--keep');
if (args.some((arg) => arg !== '--offline' && arg !== '--keep')) {
  console.error('usage: node create-agent/scripts/clean-install-check.mjs [--offline] [--keep]');
  process.exit(2);
}

function npm(argv, cwd, env = process.env) {
  const options = { cwd, env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] };
  if (process.env.npm_execpath)
    return execFileSync(process.execPath, [process.env.npm_execpath, ...argv], options);
  return execFileSync('npm', argv, { ...options, shell: process.platform === 'win32' });
}
const fail = (message) => {
  throw new Error(message);
};
const seconds = (ms) => `${(ms / 1000).toFixed(1)} s`;

const work = realpathSync(mkdtempSync(join(realpathSync(tmpdir()), 'sess-create-agent-clean-')));
let exitCode = 1;
try {
  const rel = relative(realpathSync(root), work);
  if (rel === '' || !(rel.startsWith('..') || rel.startsWith(sep)))
    fail('the temporary directory is inside the repository');
  for (let dir = dirname(work); dirname(dir) !== dir; dir = dirname(dir))
    if (existsSync(join(dir, 'node_modules'))) fail(`an ancestor directory has node_modules: ${dir}`);
  const registry = npm(['config', 'get', 'registry'], work).trim();
  if (registry !== PUBLIC_REGISTRY) fail(`npm is configured for ${registry}, not ${PUBLIC_REGISTRY}`);

  // --- 1. Pack the initializer as it would be published. ---
  const packDir = join(work, 'pack');
  mkdirSync(packDir);
  const [packed] = JSON.parse(
    npm(['pack', '--json', '--ignore-scripts', '--pack-destination', packDir], initializer),
  );
  const tarball = join(packDir, packed.filename);
  console.log(`packed ${packed.name}@${packed.version} (${packed.files.length} files)`);

  // --- 2. npm create -> npm install -> npm start, timed. ---
  const project = join(work, 'project');
  mkdirSync(project);
  const app = join(project, 'my-agent');
  const started = performance.now();
  const created = npm(['exec', '--yes', `--package=${tarball}`, '--', 'create-agent', 'my-agent'], project);
  const afterCreate = performance.now();
  if (!created.includes('npm install --ignore-scripts')) fail('the initializer did not print next steps');
  const install = ['install', '--ignore-scripts', '--no-audit', '--no-fund'];
  npm([...install, offline ? '--offline' : '--prefer-offline'], app);
  const afterInstall = performance.now();

  const record = join(work, 'record.json');
  const env = {
    PATH: process.env.PATH ?? '',
    HOME: process.env.HOME ?? '',
    ...(process.env.npm_config_cache ? { npm_config_cache: process.env.npm_config_cache } : {}),
    SESS_API_KEY: 'test-only-clean-install-key',
    SESS_DEMO_CONTACT: 'https://example.com/sess-starter-clean-install',
    NODE_OPTIONS: `--import=${pathToFileURL(fakeWorld).href}`,
    SESS_FAKE_WORLD: JSON.stringify({
      apiKey: 'test-only-clean-install-key',
      answers: [
        { place: 'oslo', day: 'saturday' },
        { choice: 'option_2', time: 'evening' },
      ],
      met: 'ok',
      nws: 'ok',
      record,
    }),
  };
  const run = await start(app, env);
  if (run.runningAt === undefined) fail(`the agent never printed "Agent running." (exit ${run.code})`);
  const toRunning = run.runningAt - started;

  // --- 3. The install is the pinned, published SDK; the files are the template. ---
  const lock = JSON.parse(readFileSync(join(app, 'package-lock.json'), 'utf8'));
  const entry = lock.packages?.[`node_modules/${pin.name}`] ?? {};
  if (entry.version !== pin.version) fail(`installed ${pin.name}@${entry.version}, not ${pin.version}`);
  if (entry.resolved !== `${PUBLIC_REGISTRY}${pin.name}/-/sdk-${pin.version}.tgz`)
    fail(`${pin.name} was resolved from ${entry.resolved}`);
  if (entry.integrity !== pin.integrity) fail(`${pin.name} integrity ${entry.integrity} is not the pin`);
  const scripts = Object.entries(lock.packages ?? {}).filter(([, value]) => value.hasInstallScript);
  if (scripts.length) fail(`dependencies with install scripts: ${scripts.map(([key]) => key).join(', ')}`);

  // --- 4. Both rounds, completion and the receipt summary. ---
  const world = JSON.parse(readFileSync(record, 'utf8'));
  const failures = [];
  const expect = (condition, message) => condition || failures.push(message);
  expect(run.code === 0, `npm start exits 0 (got ${run.code})`);
  expect(run.stderr === '', 'the agent writes nothing to stderr');
  expect(world.creates === 1 && world.publishes.length === 1, 'one Session, two rounds');
  expect(world.status === 'completed' && world.completeChecked, 'the Session is completed');
  expect(world.refused.length === 0, 'no request left the fake world');
  expect(/· verified ✓\n/.test(run.stdout), 'the receipt summary is printed');
  expect(run.stdout.includes('Verify this yourself at https://sess.si/verify'), 'the verify hint is printed');
  expect(toRunning <= BUDGET_MS, `npm create -> agent running within ${seconds(BUDGET_MS)}`);
  const parity = execFileSync(process.execPath, [join(here, 'check-parity.mjs'), app], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  console.log(parity.trim());
  console.log(
    `installed ${pin.name}@${pin.version} from ${PUBLIC_REGISTRY} (integrity equals the pin; ` +
      `${offline ? 'offline' : 'prefer-offline'}; node ${process.version})`,
  );
  console.log(
    `timing: npm create ${seconds(afterCreate - started)} + npm install ${seconds(afterInstall - afterCreate)} ` +
      `+ npm start to "Agent running." ${seconds(run.runningAt - afterInstall)} = ${seconds(toRunning)} ` +
      `(budget ${seconds(BUDGET_MS)}); both rounds and completion took ${seconds(run.endedAt - run.runningAt)} more`,
  );
  for (const message of failures) console.log(`FAIL: ${message}`);
  if (failures.length) console.log('CREATE-AGENT CLEAN INSTALL CHECK FAILED');
  else {
    console.log('CREATE-AGENT CLEAN INSTALL CHECK PASSED');
    exitCode = 0;
  }
} catch (error) {
  console.error(`clean-install-check: ${error instanceof Error ? error.message : String(error)}`);
} finally {
  if (keep) console.log(`kept ${work}`);
  else rmSync(work, { recursive: true, force: true });
}
process.exit(exitCode);

/** `npm start` in `cwd`; records when "Agent running." appears and when the process ends. */
function start(cwd, env) {
  const cli = process.env.npm_execpath;
  const child = cli
    ? spawn(process.execPath, [cli, 'start', '--silent'], { cwd, env, stdio: ['ignore', 'pipe', 'pipe'] })
    : spawn('npm', ['start', '--silent'], {
        cwd,
        env,
        stdio: ['ignore', 'pipe', 'pipe'],
        shell: process.platform === 'win32',
      });
  let stdout = '';
  let stderr = '';
  let runningAt;
  child.stdout.setEncoding('utf8').on('data', (chunk) => {
    stdout += chunk;
    if (runningAt === undefined && stdout.includes('Agent running.')) runningAt = performance.now();
  });
  child.stderr.setEncoding('utf8').on('data', (chunk) => (stderr += chunk));
  const timer = setTimeout(() => child.kill('SIGKILL'), 120_000);
  return new Promise((done) =>
    child.on('exit', (code) => {
      clearTimeout(timer);
      done({ code, stdout, stderr, runningAt, endedAt: performance.now() });
    }),
  );
}
