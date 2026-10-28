// Clean-install check of the starter, timed against the 60 s "npm create -> agent running" budget.
//
//   node create-agent/scripts/clean-install-check.mjs [--offline] [--keep]
//        [--tarball <path> --record-exercised <path>]
//
// 1. Packs create-agent/ into a fresh temporary directory outside the repository (no node_modules
//    in any ancestor), exactly as it would be published. No lifecycle script runs (--ignore-scripts).
//    With --tarball, it does not pack: it copies that exact tarball (the release candidate packed
//    by release-guard.mjs) into the temporary directory and exercises it, and --record-exercised
//    writes the SHA-256 of the bytes it exercised, so the release binds the tested tarball to the
//    published one.
// 2. Starts the clock and runs the packed initializer the way `npm create @sess.si/agent@next my-agent`
//    does (`npm create` is `npm exec @sess.si/create-agent`; a local tarball has to be named with
//    `npm exec --package=<tarball>`), then the README's `npm install --ignore-scripts` and
//    `npm start`. The clock stops when the agent prints "Agent running.".
// 3. Accepts the install only if @sess.si/sdk is the pinned version from the public registry with
//    the integrity recorded in release/sdk-candidate.json, and the generated files pass the
//    template parity check.
// 4. Lets the agent finish both rounds against the offline fake world (create-agent/test/
//    fake-world.mjs: fake SESS API with genuinely signed receipts, fake MET Norway and NWS). Every
//    Sess request carries the starter's User-Agent, exactly `sess-create-agent/<version>` on rc.8.
// 5. The one command: runs the packed initializer again in a new project with SESS_API_KEY and
//    SESS_DEMO_CONTACT in its environment and no terminal, so it scaffolds, installs and runs the
//    agent itself. Timed the same way; the agent completes both rounds in the fake world and the
//    initializer exits with the agent's code.
// 6. The packed initializer's own bytes (index.mjs from the exercised tarball) run once more with
//    create-agent/test/fake-npm standing in for npm: the install call receives neither SESS_API_KEY
//    nor SESS_DEMO_CONTACT from the environment, and only the start call receives them
//    (ASTRA-SDK-86-01). The fake records the key only as a SHA-256.
//
// Network: only the npm install of the SDK and its pinned dependencies (npm's cache is preferred;
// --offline forbids the network and fails if the cache lacks them). No SESS or weather traffic.
import { execFileSync, spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  mkdtempSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { assertPackedHygiene } from '../../scripts/check-packed-hygiene.mjs';

const BUDGET_MS = 60_000;
const PUBLIC_REGISTRY = 'https://registry.npmjs.org/';
const here = dirname(fileURLToPath(import.meta.url));
const initializer = resolve(here, '..');
const root = resolve(initializer, '..');
const fakeWorld = join(initializer, 'test', 'fake-world.mjs');
const pin = JSON.parse(readFileSync(join(root, 'release', 'sdk-candidate.json'), 'utf8'));
// The starter names itself to Sess. On SDK 0.1.0-rc.8 that is the whole User-Agent; a later SDK
// appends its own `sess-sdk/<version> node/<version>`.
const USER_AGENT = `sess-create-agent/${JSON.parse(readFileSync(join(initializer, 'package.json'), 'utf8')).version}`;
const sentUserAgent = (ua) =>
  pin.version === '0.1.0-rc.8'
    ? ua === USER_AGENT
    : typeof ua === 'string' &&
      ua.startsWith(`${USER_AGENT} sess-sdk/${pin.version} node/`) &&
      !/\s/.test(ua.slice(`${USER_AGENT} sess-sdk/${pin.version} node/`.length));
const args = process.argv.slice(2);
const valueOf = (flag) => {
  const i = args.indexOf(flag);
  if (i === -1) return undefined;
  const value = args[i + 1];
  args.splice(i, 2);
  return value;
};
const candidate = valueOf('--tarball');
const recordExercised = valueOf('--record-exercised');
const offline = args.includes('--offline');
const keep = args.includes('--keep');
if (
  args.some((arg) => arg !== '--offline' && arg !== '--keep') ||
  (candidate === undefined) !== (recordExercised === undefined) ||
  (candidate !== undefined && (!candidate.endsWith('.tgz') || !existsSync(candidate)))
) {
  console.error(
    'usage: node create-agent/scripts/clean-install-check.mjs [--offline] [--keep] [--tarball <file.tgz> --record-exercised <file.json>]',
  );
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

  // --- 1. Pack the initializer as it would be published, or take the given release candidate. ---
  const packDir = join(work, 'pack');
  mkdirSync(packDir);
  let tarball;
  if (candidate === undefined) {
    const [packed] = JSON.parse(
      npm(['pack', '--json', '--ignore-scripts', '--pack-destination', packDir], initializer),
    );
    tarball = join(packDir, packed.filename);
    console.log(`packed ${packed.name}@${packed.version} (${packed.files.length} files)`);
  } else {
    tarball = join(packDir, 'candidate.tgz');
    copyFileSync(candidate, tarball);
    console.log('exercising the given release candidate (no repack)');
  }
  const exercisedSha256 = createHash('sha256').update(readFileSync(tarball)).digest('hex');
  // No maps, fixtures, non-public hosts, credential-shaped strings or internal references.
  console.log(`packed hygiene: ${assertPackedHygiene(tarball)} files clean`);

  // --- 2. npm create -> npm install -> npm start, timed. ---
  const project = join(work, 'project');
  mkdirSync(project);
  const app = join(project, 'my-agent');
  const started = performance.now();
  // Without SESS_API_KEY and SESS_DEMO_CONTACT and without a terminal, the initializer only scaffolds.
  const unset = Object.fromEntries(
    Object.entries(process.env).filter(([key]) => key !== 'SESS_API_KEY' && key !== 'SESS_DEMO_CONTACT'),
  );
  const createAgent = ['exec', '--yes', `--package=${tarball}`, '--', 'create-agent', 'my-agent'];
  const created = npm(createAgent, project, unset);
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
  checkInstall(app);

  // --- 4. Both rounds, completion and the receipt summary. ---
  const world = JSON.parse(readFileSync(record, 'utf8'));
  const failures = [];
  const expect = (condition, message) => condition || failures.push(message);
  expect(run.code === 0, `npm start exits 0 (got ${run.code})`);
  expect(run.stderr === '', 'the agent writes nothing to stderr');
  expect(world.creates === 1 && world.publishes.length === 1, 'one Session, two rounds');
  expect(world.status === 'completed' && world.completeChecked, 'the Session is completed');
  expect(world.refused.length === 0, 'no request left the fake world');
  expect(
    world.sess.length > 0 &&
      world.userAgents.length === world.sess.length &&
      world.userAgents.every(sentUserAgent),
    `every Sess request carries User-Agent ${USER_AGENT} (got ${JSON.stringify([...new Set(world.userAgents)])})`,
  );
  expect(/· verified ✓\n/.test(run.stdout), 'the receipt summary is printed');
  expect(run.stdout.includes('Verify this yourself at https://sess.si/verify'), 'the verify hint is printed');
  expect(toRunning <= BUDGET_MS, `npm create -> agent running within ${seconds(BUDGET_MS)}`);
  const parity = execFileSync(process.execPath, [join(here, 'check-parity.mjs'), app], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  // --- 5. The one command: scaffold, install and run, with both values in its environment. ---
  const oneProject = join(work, 'one-command');
  mkdirSync(oneProject);
  const oneRecord = join(work, 'one-command-record.json');
  const oneEnv = {
    ...env,
    [offline ? 'npm_config_offline' : 'npm_config_prefer_offline']: 'true',
    SESS_FAKE_WORLD: JSON.stringify({ ...JSON.parse(env.SESS_FAKE_WORLD), record: oneRecord }),
  };
  const oneStarted = performance.now();
  const one = await start(oneProject, oneEnv, createAgent);
  const oneToRunning = one.runningAt === undefined ? Infinity : one.runningAt - oneStarted;
  const oneWorld = existsSync(oneRecord) ? JSON.parse(readFileSync(oneRecord, 'utf8')) : {};
  if (one.code === 0) checkInstall(join(oneProject, 'my-agent'));
  expect(one.code === 0, `the one command exits with the agent's 0 (got ${one.code})`);
  expect(one.stdout.includes('Installing the agent…'), 'the one command shows its progress line');
  expect(!one.stdout.includes('Next:'), 'the one command runs the agent instead of printing next steps');
  expect(oneWorld.creates === 1 && oneWorld.status === 'completed', 'the one command completes the Session');
  expect(/· verified ✓\n/.test(one.stdout), 'the one command prints the receipt summary');
  expect(!`${one.stdout}${one.stderr}`.includes(oneEnv.SESS_API_KEY), 'the one command never prints the key');
  expect(oneToRunning <= BUDGET_MS, `one command -> agent running within ${seconds(BUDGET_MS)}`);

  // --- 6. The packed bytes: the install child never receives the key or the contact. ---
  const unpacked = join(work, 'unpacked');
  mkdirSync(unpacked);
  execFileSync('tar', ['-xzf', tarball, '-C', unpacked], { stdio: 'ignore' });
  const envProject = join(work, 'env-project');
  mkdirSync(envProject);
  const npmRecord = join(work, 'fake-npm.jsonl');
  const envKey = 'test-only-install-env-key';
  execFileSync(process.execPath, [join(unpacked, 'package', 'index.mjs'), 'my-agent'], {
    cwd: envProject,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: {
      PATH: process.env.PATH ?? '',
      npm_execpath: join(here, '..', 'test', 'fake-npm', 'npm-cli.mjs'),
      FAKE_NPM: JSON.stringify({ record: npmRecord }),
      SESS_API_KEY: envKey,
      SESS_DEMO_CONTACT: 'https://example.test/clean-install',
    },
  });
  const calls = readFileSync(npmRecord, 'utf8')
    .trim()
    .split('\n')
    .map((line) => JSON.parse(line));
  const keyDigest = createHash('sha256').update(envKey).digest('hex');
  expect(
    calls.length === 2 && calls[0].argv[0] === 'install' && calls[1].argv[0] === 'start',
    'the packed initializer installs, then starts',
  );
  expect(
    calls[0]?.keySha256 === null && calls[0]?.contact === null,
    'the install child receives neither SESS_API_KEY nor SESS_DEMO_CONTACT',
  );
  expect(calls[1]?.keySha256 === keyDigest, 'only the start child receives the key');

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
  console.log(
    `timing: one command to "Agent running." ${seconds(oneToRunning)} (budget ${seconds(BUDGET_MS)})`,
  );
  for (const message of failures) console.log(`FAIL: ${message}`);
  if (failures.length) console.log('CREATE-AGENT CLEAN INSTALL CHECK FAILED');
  else {
    // Written only after every check passed: the record names exactly the bytes that were exercised.
    if (recordExercised !== undefined)
      writeFileSync(
        recordExercised,
        `${JSON.stringify({ check: 'create-agent-clean-install', passed: true, sha256: exercisedSha256 })}\n`,
      );
    console.log(`exercised sha256=${exercisedSha256}`);
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

/** The install in `app` is the pinned, published SDK, with no install scripts anywhere. */
function checkInstall(app) {
  const lock = JSON.parse(readFileSync(join(app, 'package-lock.json'), 'utf8'));
  const entry = lock.packages?.[`node_modules/${pin.name}`] ?? {};
  if (entry.version !== pin.version) fail(`installed ${pin.name}@${entry.version}, not ${pin.version}`);
  if (entry.resolved !== `${PUBLIC_REGISTRY}${pin.name}/-/sdk-${pin.version}.tgz`)
    fail(`${pin.name} was resolved from ${entry.resolved}`);
  if (entry.integrity !== pin.integrity) fail(`${pin.name} integrity ${entry.integrity} is not the pin`);
  const scripts = Object.entries(lock.packages ?? {}).filter(([, value]) => value.hasInstallScript);
  if (scripts.length) fail(`dependencies with install scripts: ${scripts.map(([key]) => key).join(', ')}`);
}

/**
 * `npm start` (or the given npm command) in `cwd`; records when "Agent running." appears and when the
 * process ends.
 */
function start(cwd, env, argv = ['start', '--silent']) {
  const cli = process.env.npm_execpath;
  const child = cli
    ? spawn(process.execPath, [cli, ...argv], { cwd, env, stdio: ['ignore', 'pipe', 'pipe'] })
    : spawn('npm', argv, {
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
