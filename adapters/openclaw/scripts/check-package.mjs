// Packed-artifact checks for @sess.si/openclaw (OC-03, OC-04, OC-06, OC-41, OC-42).
//   node scripts/check-package.mjs [--registry] [--host]
// Packs with lifecycle scripts disabled, checks the file allowlist and manifest, installs the
// exact bytes into a clean consumer the way OpenClaw's installer does (--omit=dev --omit=peer
// --legacy-peer-deps --ignore-scripts), imports and registers the entry with networking denied,
// and with --host installs the tarball through the real OpenClaw CLI in a DISPOSABLE profile.
// The SDK resolves from the public npm registry and must equal release/sdk-candidate.json
// (scripts/registry-sdk.mjs); --registry is accepted for the release workflow and is the only mode.
import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { SDK_PIN, sdkDrift } from './registry-sdk.mjs';

const args = process.argv.slice(2);
const withHost = args.includes('--host');
for (const arg of args)
  if (arg !== '--registry' && arg !== '--host')
    throw new Error(`Unsupported argument ${arg}: the SDK installs from the public registry only.`);

const root = resolve(new URL('..', import.meta.url).pathname);
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
const result = { package: pkg.name, version: pkg.version, checks: [] };
const pass = (name, detail = {}) => {
  result.checks.push({ name, outcome: 'pass', ...detail });
  console.log(`PASS ${name}${Object.keys(detail).length ? ` ${JSON.stringify(detail)}` : ''}`);
};
const assert = (condition, message) => {
  if (!condition) throw new Error(`check-package: ${message}`);
};
const run = (cmd, argv, options = {}) => {
  const out = spawnSync(cmd, argv, { encoding: 'utf8', ...options });
  if (out.status !== 0)
    throw new Error(`${cmd} ${argv[0]} failed (${out.status}): ${(out.stderr || out.stdout).slice(-2000)}`);
  return out.stdout;
};

// Async variant for long-running commands (installs, host CLI).
const runAsync = (cmd, argv, options = {}) =>
  new Promise((resolveRun, reject) => {
    const child = spawn(cmd, argv, { ...options, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => (stdout += d));
    child.stderr.on('data', (d) => (stderr += d));
    child.on('error', reject);
    child.on('exit', (code) =>
      code === 0
        ? resolveRun(stdout)
        : reject(new Error(`${cmd} ${argv[0]} failed (${code}): ${(stderr || stdout).slice(-2000)}`)),
    );
  });

const artifacts = join(root, '.artifacts');
rmSync(artifacts, { recursive: true, force: true });
mkdirSync(artifacts, { recursive: true });
assert(existsSync(join(root, 'dist/index.js')), 'run npm run build first');

// 1. Pack with lifecycle scripts disabled; read the filename from npm's output. npm 11 prints an
// array when run directly but an object keyed by package name when nested in an npm script.
const packOutput = JSON.parse(
  run('npm', ['pack', '--json', '--ignore-scripts', '--pack-destination', artifacts], { cwd: root }),
);
const packedList = Array.isArray(packOutput) ? packOutput : Object.values(packOutput);
assert(packedList.length === 1, `npm pack reported ${packedList.length} packages`);
const [packed] = packedList;
const tarball = join(artifacts, packed.filename);
assert(
  packed.filename === 'sess.si-openclaw-0.1.0-rc.1.tgz' && existsSync(tarball),
  'unexpected tarball name',
);
const bytes = readFileSync(tarball);
const sha256 = createHash('sha256').update(bytes).digest('hex');

// 2. Exact content allowlist: compiled output, manifest, skill, compatibility record, notices.
const allowed = [
  /^dist\/[a-z-]+\.js$/,
  /^dist\/internal\/shared\.js$/,
  /^openclaw\.plugin\.json$/,
  /^package\.json$/,
  /^skills\/sess\/SKILL\.md$/,
  /^compatibility\.json$/,
  /^(README|CHANGELOG)\.md$/,
  /^(LICENSE|NOTICE)$/,
];
const files = packed.files.map((f) => f.path);
for (const file of files)
  assert(
    allowed.some((p) => p.test(file)),
    `unexpected packed file ${file}`,
  );
for (const required of [
  'dist/index.js',
  'openclaw.plugin.json',
  'skills/sess/SKILL.md',
  'compatibility.json',
  'README.md',
  'CHANGELOG.md',
  'LICENSE',
  'NOTICE',
])
  assert(files.includes(required), `missing packed file ${required}`);
const text = files
  .filter((f) => !f.endsWith('LICENSE'))
  .map((f) => readFileSync(join(root, f), 'utf8'))
  .join('\n');
assert(
  !/sess_(?:sk|mg|tk|mk)_[A-Za-z0-9_-]{30,}|\/s\/[A-Za-z0-9_-]{43}|-----BEGIN [A-Z ]*PRIVATE KEY/.test(text),
  'packed content contains secret-like material',
);
assert(
  !/@sess\/(core|spec|security|session-web|db)|sess-agent-testbed|adapters\/mcp|@modelcontextprotocol/.test(
    text,
  ),
  'packed content references private/runtime/testbed/MCP sources',
);
pass('pack-allowlist', { files: files.length });

// No import leaves the package: compiled modules may import only relative files inside dist/,
// node: built-ins, the SDK dependency and the one public host entry subpath (no sibling adapter,
// no adapters/shared path at runtime).
const allowedImports =
  /^(\.\.?\/[a-z/.-]+\.js|node:[a-z]+|@sess\.si\/sdk|openclaw\/plugin-sdk\/(plugin-entry|config-mutation))$/;
const specifiers = [];
for (const file of files.filter((f) => f.endsWith('.js'))) {
  const source = readFileSync(join(root, file), 'utf8');
  for (const [, spec] of source.matchAll(
    /(?:^|\s)(?:import|export)\s[^'"]*?from\s*['"]([^'"]+)['"]|import\(\s*['"]([^'"]+)['"]/gm,
  ))
    if (spec) specifiers.push(spec);
  for (const [, spec] of source.matchAll(/import\(\s*['"]([^'"]+)['"]/g)) specifiers.push(spec);
  for (const spec of source.matchAll(/(?:^|\s)import\s*['"]([^'"]+)['"]/gm)) specifiers.push(spec[1]);
  for (const spec of specifiers.splice(0)) {
    assert(allowedImports.test(spec), `${file} imports ${spec}, which leaves the package`);
    if (spec.startsWith('.')) {
      const target = resolve(root, file, '..', spec);
      assert(target.startsWith(join(root, 'dist') + '/'), `${file} imports ${spec} outside dist/`);
      assert(existsSync(target), `${file} imports missing ${spec}`);
    }
  }
}
pass('imports-stay-in-package');

// 3. Manifest: no lifecycle scripts, exact registry-shaped dependency, peer host only.
const manifest = JSON.parse(
  execFileSync('tar', ['-xOzf', tarball, 'package/package.json'], { encoding: 'utf8' }),
);
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
])
  assert(!manifest.scripts?.[hook], `lifecycle script ${hook}`);
assert(
  JSON.stringify(manifest.dependencies) === JSON.stringify({ [SDK_PIN.name]: SDK_PIN.version }),
  `dependencies must be exactly ${SDK_PIN.name} ${SDK_PIN.version} (release/sdk-candidate.json)`,
);
for (const spec of Object.values({ ...manifest.dependencies, ...manifest.peerDependencies }))
  assert(!/^(file|link|workspace|git|https?):/.test(spec), 'non-registry dependency spec');
assert(manifest.peerDependencies?.openclaw === '2026.10.3', 'OpenClaw must be the exact qualified host peer');
pass('manifest-boundary');

// 4. Sizes (measured; reviewed budget 250 KiB packed / 1 MiB unpacked first-party).
const sizes = {
  packedBytes: packed.size,
  unpackedBytes: packed.unpackedSize,
  fileCount: packed.entryCount,
  sha256,
  integrity: packed.integrity,
};
assert(
  packed.size < 250 * 1024 && packed.unpackedSize < 1024 * 1024,
  `size budget exceeded ${JSON.stringify(sizes)}`,
);
pass('size-budget', sizes);
result.artifact = { filename: packed.filename, ...sizes };

// The adapter lockfile pins the SDK bytes (name/version/integrity) to release/sdk-candidate.json.
const drift = sdkDrift(root, { installed: false });
assert(drift.length === 0, `SDK lock differs from the pin: ${drift.join('; ')}`);
const lockedSdkIntegrity = SDK_PIN.integrity;
const scratch = mkdtempSync(join(tmpdir(), 'sess-openclaw-pack-'));
try {
  // 5. Consumer install with the host installer's flags; the SDK arrives automatically, no host.
  const consumer = join(scratch, 'consumer');
  mkdirSync(consumer);
  writeFileSync(join(consumer, 'package.json'), '{"private":true}');
  await runAsync(
    'npm',
    [
      'install',
      '--omit=dev',
      '--omit=peer',
      '--legacy-peer-deps',
      '--ignore-scripts',
      '--no-audit',
      '--no-fund',
      `--cache=${join(scratch, 'npm-cache')}`,
      tarball,
    ],
    { cwd: consumer },
  );
  const lock = JSON.parse(readFileSync(join(consumer, 'package-lock.json'), 'utf8'));
  const installed = Object.keys(lock.packages)
    .filter(Boolean)
    .map((p) => p.replace(/^.*node_modules\//, ''))
    .sort();
  assert(!installed.includes('openclaw'), 'a second OpenClaw gateway was installed');
  assert(
    lock.packages['node_modules/@sess.si/sdk']?.integrity === lockedSdkIntegrity,
    'installed SDK is not the locked, integrity-pinned SDK',
  );
  const expected = [
    '@sess.si/openclaw',
    '@sess.si/sdk',
    '@stablelib/base64',
    'canonicalize',
    'fast-sha256',
    'jose',
    'standardwebhooks',
  ];
  assert(
    JSON.stringify(installed) === JSON.stringify(expected),
    `unexpected production dependency set ${JSON.stringify(installed)}`,
  );
  pass('consumer-install', {
    productionPackages: installed,
    sdk: `REGISTRY ${SDK_PIN.name}@${SDK_PIN.version}`,
  });

  // 6. Network-denied import + registration (host peer linked exactly as the installer does).
  const pluginDir = join(consumer, 'node_modules/@sess.si/openclaw');
  mkdirSync(join(pluginDir, 'node_modules'), { recursive: true });
  symlinkSync(join(root, 'node_modules/openclaw'), join(pluginDir, 'node_modules/openclaw'));
  const probe = join(scratch, 'probe.mjs');
  writeFileSync(
    probe,
    `import net from 'node:net';
const attempts = [];
globalThis.fetch = (...a) => { attempts.push('fetch'); return Promise.reject(new Error('network denied')); };
const connect = net.Socket.prototype.connect;
net.Socket.prototype.connect = function (...a) { attempts.push('socket'); return connect.apply(this, a); };
const reads = [];
process.env = new Proxy(process.env, { get(t, k) { if (k === 'SESS_API_KEY') reads.push(k); return Reflect.get(t, k); } });
const entry = (await import(${JSON.stringify(join(pluginDir, 'dist/index.js'))})).default;
const tools = []; const cli = []; let opened = 0;
entry.register({ id: 'sess', pluginConfig: {}, runtime: { state: { openKeyedStore() { opened++; return {}; } } },
  registerTool: (f, o) => tools.push([o.name, f.contextVersion, o.optional]), registerCli: (r, o) => cli.push(o.descriptors.map((d) => d.name)) });
console.log(JSON.stringify({ id: entry.id, tools, cli, opened, attempts, reads }));
`,
  );
  const imported = JSON.parse(
    run(process.execPath, [probe], {
      cwd: scratch,
      env: { ...process.env, SESS_API_KEY: 'not-read-at-import' },
    })
      .trim()
      .split('\n')
      .pop(),
  );
  assert(
    imported.id === 'sess' &&
      imported.tools.length === 4 &&
      imported.tools.every(([, v, o]) => v === 2 && o === true),
    'entry did not register four optional v2 tools',
  );
  assert(
    imported.attempts.length === 0 && imported.reads.length === 0 && imported.opened === 0,
    `import/registration side effects ${JSON.stringify(imported)}`,
  );
  pass('network-denied-import', { tools: imported.tools.map(([n]) => n), cli: imported.cli.flat() });

  // 7. Real host install through OpenClaw's installer in a disposable profile.
  if (withHost) {
    const home = join(scratch, 'openclaw-home');
    mkdirSync(join(home, '.openclaw'), { recursive: true });
    writeFileSync(join(home, '.npmrc'), '');
    const env = {
      ...process.env,
      HOME: home,
      OPENCLAW_HOME: home,
      OPENCLAW_STATE_DIR: join(home, '.openclaw'),
      OPENCLAW_CONFIG_PATH: join(home, '.openclaw/openclaw.json'),
      npm_config_userconfig: join(home, '.npmrc'),
      npm_config_cache: join(scratch, 'npm-cache'),
      XDG_CONFIG_HOME: join(home, '.config'),
      XDG_CACHE_HOME: join(home, '.cache'),
    };
    const openclaw = (argv) =>
      runAsync(process.execPath, [join(root, 'node_modules/openclaw/openclaw.mjs'), ...argv], {
        cwd: scratch,
        env,
      });
    const version = (await openclaw(['--version'])).trim();
    assert(version.startsWith('OpenClaw 2026.10.3'), `unexpected host ${version}`);
    const install = await openclaw([
      'plugins',
      'install',
      '--force',
      '--no-enable',
      '--accept-capabilities',
      `npm-pack:${tarball}`,
    ]);
    assert(
      /Installed plugin: sess/.test(install) && /Linked peerDependency "openclaw"/.test(install),
      'installer did not install/link as expected',
    );
    await openclaw(['plugins', 'enable', 'sess']);
    const inspected = JSON.parse(
      (await openclaw(['plugins', 'inspect', 'sess', '--runtime', '--json'])).replace(/^[^{]*/, ''),
    );
    assert(inspected.plugin.status === 'loaded', `plugin status ${inspected.plugin.status}`);
    assert(
      JSON.stringify(inspected.plugin.toolNames) ===
        JSON.stringify(['sess_request', 'sess_response', 'sess_publish', 'sess_complete']),
      'host tool list',
    );
    assert(
      inspected.mcpServers.length === 0 && inspected.httpRouteCount === 0 && inspected.services.length === 0,
      'unexpected MCP/route/service surface',
    );
    assert(inspected.diagnostics.length === 0, `host diagnostics ${JSON.stringify(inspected.diagnostics)}`);
    const projects = readdirSync(join(home, '.openclaw/npm/projects'));
    for (const project of projects)
      assert(
        !existsSync(join(home, '.openclaw/npm/projects', project, 'node_modules/openclaw')),
        'installer placed a second gateway',
      );
    const help = await openclaw(['sess', '--help']);
    assert(/doctor/.test(help), 'sess doctor command missing');
    const doctor = await openclaw(['sess', 'doctor']);
    assert(/network: not contacted/.test(doctor), 'doctor output');
    // Retained + bounded plugin state open in the real host's CLI process (redacted counts).
    assert(
      /active interactions .*: empty/.test(doctor) && /archive .*: empty/.test(doctor),
      'doctor state counts',
    );
    // Consent-driven setup through the real host CLI: preview writes nothing, --yes is additive
    // (an existing alsoAllow entry and an unrelated setting survive), a re-run is a no-op.
    await openclaw(['config', 'set', 'tools.alsoAllow', '["lobster"]', '--strict-json']);
    await openclaw(['config', 'set', 'gateway.port', '18998', '--strict-json']);
    const configPath = join(home, '.openclaw/openclaw.json');
    // Authored `enabled` unset while the plugin is installed: the runtime view may still report it
    // enabled, but the preview must list the enable change the apply will write.
    await openclaw(['config', 'unset', 'plugins.entries.sess.enabled']);
    const beforeSetup = readFileSync(configPath, 'utf8');
    assert(JSON.parse(beforeSetup).plugins?.entries?.sess?.enabled === undefined, 'enabled not unset');
    const preview = await openclaw(['sess', 'setup']);
    assert(/preview \(nothing written/.test(preview), 'setup preview');
    assert(
      /plugins\.entries\.sess\.enabled: \(unset\) -> true/.test(preview),
      'preview omits the enable change',
    );
    assert(readFileSync(configPath, 'utf8') === beforeSetup, 'setup preview wrote config');
    const applied = await openclaw(['sess', 'setup', '--yes']);
    assert(/openclaw gateway restart/.test(applied), 'setup restart instruction');
    const changeLines = (text) => text.split('\n').filter((l) => /^ {2}(plugins|tools)\./.test(l));
    assert(
      JSON.stringify(changeLines(applied)) === JSON.stringify(changeLines(preview)) &&
        changeLines(preview).length === 3,
      `--yes did not apply exactly the previewed changes ${JSON.stringify({ preview: changeLines(preview), applied: changeLines(applied) })}`,
    );
    const written = JSON.parse(readFileSync(configPath, 'utf8'));
    assert(
      JSON.stringify(written.tools?.alsoAllow) ===
        JSON.stringify(['lobster', 'sess_request', 'sess_response', 'sess_publish', 'sess_complete']) &&
        written.gateway?.port === 18998 &&
        written.plugins?.entries?.sess?.enabled === true &&
        written.plugins?.entries?.sess?.config?.apiKeyEnv === 'SESS_API_KEY',
      `setup result ${JSON.stringify({ alsoAllow: written.tools?.alsoAllow, sess: written.plugins?.entries?.sess })}`,
    );
    assert(/no changes needed/.test(await openclaw(['sess', 'setup'])), 'setup re-run is not a no-op');
    // Operator commands page through the real host's plugin state (dry runs).
    assert(
      /retire \(dry run\): 0 /.test(await openclaw(['sess', 'retire', '--older-than-days', '7'])),
      'retire dry run',
    );
    assert(/prune \(dry run\): 0 /.test(await openclaw(['sess', 'prune'])), 'prune dry run');
    pass('host-install', {
      host: version,
      setup: 'preview-only, additive apply, idempotent re-run',
      status: inspected.plugin.status,
      tools: inspected.plugin.toolNames,
      cli: inspected.cliCommands,
      install: inspected.install?.artifactKind,
    });
  } else {
    result.checks.push({ name: 'host-install', outcome: 'not_run' });
    console.log('NOT RUN host-install (pass --host)');
  }
} finally {
  rmSync(scratch, { recursive: true, force: true });
}
// Verification record consumed by the release publish job (never self-referential in the tarball).
const git = (argv) => execFileSync('git', argv, { cwd: root, encoding: 'utf8' }).trim();
Object.assign(result, {
  name: pkg.name,
  filename: packed.filename,
  tarball: `.artifacts/${packed.filename}`,
  sha256,
  integrity: packed.integrity,
  node: process.version,
  sdkSource: 'registry',
  sdkIntegrity: lockedSdkIntegrity,
  sourceCommit: git(['rev-parse', 'HEAD']),
  sourceTreeDirty: git(['status', '--porcelain', '--untracked-files=no']).length > 0,
});
writeFileSync(join(artifacts, 'package-result.json'), `${JSON.stringify(result, null, 2)}\n`);
console.log('check-package: all executed checks passed');
