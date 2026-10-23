// Packed-consumer check for @sess.si/mcp. Packs the adapter, installs that tarball plus the
// pinned @sess.si/sdk (the locked registry tarball) into a clean temporary project with --ignore-scripts
// (offline, using the reviewed lock resolutions), then:
//   - checks the tarball allowlist, manifest boundary and absence of lifecycle hooks;
//   - imports every shipped module with network, timers, console and credential reads trapped;
//   - starts the installed bin over stdio with the official MCP client and lists the five tools;
//   - sends raw JSON-RPC with unsafe/unknown keys to the installed bin and expects rejection;
//   - imports the `@sess.si/mcp/http` export from the consumer and serves tools/list, a 401 and an
//     unsafe-key rejection through its fetch face (no listener, no network).
import { execFileSync, spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { assertPackedHygiene } from '../../../scripts/check-packed-hygiene.mjs';
import { installPacked } from './lib/install-packed.mjs';
import { connectStdio } from './lib/mcp-client.mjs';

const adapter = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const run = (command, args, cwd) =>
  execFileSync(command, args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
function assert(condition, message) {
  if (!condition) throw new Error(`check-package: ${message}`);
}

const manifest = JSON.parse(await readFile(join(adapter, 'package.json'), 'utf8'));
const lock = JSON.parse(await readFile(join(adapter, 'package-lock.json'), 'utf8'));
const compatibility = JSON.parse(await readFile(join(adapter, 'compatibility.json'), 'utf8'));
assert(manifest.name === '@sess.si/mcp' && manifest.license === 'Apache-2.0', 'package identity drift');
assert(manifest.type === 'module' && manifest.publishConfig?.access === 'public', 'manifest drift');
assert(manifest.repository?.directory === 'adapters/mcp', 'repository.directory drift');
assert(lock.packages['']?.version === manifest.version, 'lockfile identity drift');
assert(compatibility.package.version === manifest.version, 'compatibility record version drift');
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
  assert(!manifest.scripts?.[hook], `lifecycle hook forbidden: ${hook}`);
assert(
  JSON.stringify(manifest.dependencies) ===
    JSON.stringify({
      '@modelcontextprotocol/node': '2.1.1',
      '@modelcontextprotocol/server': '2.3.1',
      '@sess.si/sdk': compatibility.sessSdk.version,
    }),
  'runtime dependency boundary drift (exact MCP server/node packages and SESS SDK only)',
);
assert(
  compatibility.mcpLibrary.version === manifest.dependencies[compatibility.mcpLibrary.name] &&
    compatibility.mcpLibrary.node.version === manifest.dependencies[compatibility.mcpLibrary.node.name],
  'compatibility record MCP library drift',
);
assert(
  JSON.stringify(manifest.exports) ===
    JSON.stringify({
      './http': { types: './dist/http.d.ts', default: './dist/http.js' },
      './package.json': './package.json',
    }),
  'export boundary drift (./http and ./package.json only)',
);
assert(
  !Object.keys(lock.packages).some((p) => /openclaw/i.test(p)),
  'the MCP adapter must not depend on any OpenClaw package',
);

const install = await installPacked();
const { packed, tarball, consumer, binPath, installed } = install;
assert(packed.id === `${manifest.name}@${manifest.version}`, 'npm pack identity drift');
const allowed =
  /^(?:dist\/(?:internal\/)?[a-z-]+\.(?:js|d\.ts)|README\.md|CHANGELOG\.md|LICENSE|NOTICE|compatibility\.json|package\.json)$/;
for (const file of packed.files) assert(allowed.test(file.path), `unexpected tarball file: ${file.path}`);
// Hygiene of the exact packed bytes: no maps, fixtures, non-public hosts, credential-shaped
// strings or internal references (repository root scripts/check-packed-hygiene.mjs).
assertPackedHygiene(tarball);
for (const required of [
  'dist/bin.js',
  'dist/server.js',
  'dist/http.js',
  'dist/http.d.ts',
  'dist/internal/shared.js',
  'README.md',
  'LICENSE',
  'NOTICE',
  'CHANGELOG.md',
])
  assert(
    packed.files.some((f) => f.path === required),
    `missing ${required}`,
  );
// Import boundary: shipped modules import only Node built-ins, their own relative files, the MCP
// library and the SESS SDK. The vendored shared core is a package file; no sibling adapter path
// (../shared, adapters/, openclaw) is ever imported at runtime.
// The scan is deliberately conservative: it may reject harmless text, never accept a hidden import.
const allowedSpecifier = (file, specifier) =>
  specifier.startsWith('node:') ||
  (/^\.\.?\//.test(specifier) &&
    resolve(dirname(join(installed, file)), specifier).startsWith(join(installed, 'dist'))) ||
  specifier === '@modelcontextprotocol/server' ||
  specifier === '@modelcontextprotocol/server/stdio' ||
  specifier === '@modelcontextprotocol/node' ||
  specifier === '@sess.si/sdk';
for (const file of packed.files.filter((f) => /\.[cm]?js$/.test(f.path))) {
  const text = await readFile(join(installed, file.path), 'utf8');
  const specifiers = [
    // static import/export ... from '...' (including multi-line clauses)
    ...[...text.matchAll(/\bfrom\s*['"]([^'"]+)['"]/g)].map((m) => m[1]),
    // side-effect import '...'
    ...[...text.matchAll(/(?:^|[;\n}])\s*import\s*['"]([^'"]+)['"]/g)].map((m) => m[1]),
  ];
  for (const m of text.matchAll(/\bimport\s*\(\s*([^)]*?)\s*\)/g)) {
    const literal = /^(['"])([^'"`]+)\1$/.exec(m[1]);
    assert(literal, `${file.path} has a non-literal dynamic import`);
    specifiers.push(literal[2]);
  }
  assert(!/\brequire\s*\(/.test(text), `${file.path} uses require()`);
  for (const specifier of specifiers)
    assert(
      allowedSpecifier(file.path, specifier),
      `${file.path} imports outside the package boundary: ${specifier}`,
    );
  assert(!/openclaw|adapters\/shared/i.test(text), `${file.path} references a sibling adapter`);
}
const state = await mkdtemp(join(tmpdir(), 'sess-mcp-state-'));
try {
  const installedManifest = JSON.parse(await readFile(join(installed, 'package.json'), 'utf8'));
  assert(installedManifest.version === manifest.version, 'installed identity drift');
  assert(!existsSync(join(consumer, 'node_modules', 'typescript')), 'consumer unexpectedly needs a compiler');
  assert(
    !(await readdir(join(consumer, 'node_modules'))).some((n) => /openclaw/i.test(n)),
    'OpenClaw package installed',
  );
  assert((await readFile(binPath, 'utf8')).startsWith('#!/usr/bin/env node'), 'bin has no node shebang');

  // Import-time side effects: every shipped module except the bin (which starts the server).
  const modules = packed.files
    .map((f) => f.path)
    .filter((p) => p.startsWith('dist/') && p.endsWith('.js') && p !== 'dist/bin.js')
    .map((p) => pathToFileURL(join(installed, p)).href);
  await writeFile(
    join(consumer, 'import-smoke.mjs'),
    `
const fail = (what) => () => { throw new Error('Unexpected import-time ' + what); };
globalThis.fetch = fail('network');
for (const name of ['setTimeout', 'setInterval', 'setImmediate']) globalThis[name] = fail('timer');
for (const name of ['log', 'info', 'warn', 'error', 'debug']) console[name] = fail('console output');
process.stderr.write = fail('stderr output');
process.stdout.write = fail('stdout output');
const env = process.env;
process.env = new Proxy(env, { get: (t, k) => { if (typeof k === 'string' && k.startsWith('SESS')) throw new Error('Unexpected import-time credential/config read: ' + k); return t[k]; } });
// The adapter's own state I/O is fs/promises. Some Node versions (22.x) load ESM source through
// fs/promises.readFile, so module-source reads under node_modules pass; any other read, and every
// write or directory operation, fails.
const { createRequire, syncBuiltinESMExports } = await import('node:module');
const { fileURLToPath } = await import('node:url');
const promises = createRequire(import.meta.url)('node:fs/promises');
const { resolve: resolvePath, sep } = await import('node:path');
// Normalize before the prefix check so a path such as node_modules/../secret cannot pass.
const moduleRoot = resolvePath(fileURLToPath(new URL('./node_modules/', import.meta.url))) + sep;
const originalReadFile = promises.readFile;
promises.readFile = (path, ...rest) => {
  const text = resolvePath(path instanceof URL ? fileURLToPath(path) : String(path));
  if (text.startsWith(moduleRoot) && /\.(?:[cm]?js|json)$/.test(text)) return originalReadFile(path, ...rest);
  throw new Error('Unexpected import-time state file access: read');
};
for (const name of ['writeFile', 'open', 'mkdir', 'readdir', 'rename', 'rm']) promises[name] = fail('state file access');
syncBuiltinESMExports();
for (const url of ${JSON.stringify(modules)}) await import(url);
process.env = env;
`,
  );
  run(process.execPath, ['import-smoke.mjs'], consumer);

  // The installed bin over stdio, with an environment that has no SESS credential at all.
  const env = { PATH: process.env.PATH ?? '', SESS_MCP_STATE_DIR: state };
  const session = await connectStdio({ binPath, env, cwd: consumer });
  let tools;
  try {
    assert(session.client.getServerVersion()?.version === manifest.version, 'server version drift');
    tools = (await session.client.listTools()).tools;
    assert(
      JSON.stringify(tools.map((t) => t.name)) ===
        JSON.stringify(['sess_request', 'sess_response', 'sess_publish', 'sess_complete', 'sess_ask']),
      'tool list drift',
    );
    for (const tool of tools) {
      assert(tool.inputSchema.additionalProperties === false, `${tool.name} input schema is not closed`);
      assert(
        tool._meta?.['si.sess/toolSchema'] === compatibility.package.toolSchema,
        `${tool.name} schema version`,
      );
      for (const forbidden of ['api_key', 'origin', 'base_url', 'workspace_id', 'session_id', 'callback_url'])
        assert(!(forbidden in tool.inputSchema.properties), `${tool.name} accepts ${forbidden}`);
    }
    const missing = await session.client.callTool({
      name: 'sess_response',
      arguments: { handle: 'sh_AAAAAAAAAAAAAAAAAAAAAA', revision: 1 },
    });
    assert(
      missing.isError && missing.content[0].text.includes('NOT_CONFIGURED'),
      'unconfigured call must fail closed',
    );
  } finally {
    await session.close();
  }
  assert(!existsSync(join(state, 'profiles')), 'tools/list or an unconfigured call wrote local state');

  // Raw JSON-RPC: the server itself must reject unknown and unsafe keys, whatever a client does.
  const raw = await rawExchange(binPath, env, [
    {
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'raw', version: '0' } },
    },
    { jsonrpc: '2.0', method: 'notifications/initialized' },
    '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"sess_response","arguments":{"handle":"sh_AAAAAAAAAAAAAAAAAAAAAA","revision":1,"__proto__":{"polluted":true}}}}',
    {
      jsonrpc: '2.0',
      id: 3,
      method: 'tools/call',
      params: {
        name: 'sess_request',
        arguments: { interaction: {}, api_key: 'x', origin: 'https://example.test' },
      },
    },
  ]);
  assert(raw[1]?.result?.protocolVersion === '2025-11-25', 'protocol 2025-11-25 not negotiated');
  assert(
    raw[2]?.result?.isError === true && raw[2].result.content[0].text.includes('INVALID_ARGUMENTS'),
    'unsafe key accepted',
  );
  assert(
    raw[3]?.result?.isError === true && raw[3].result.content[0].text.includes('unknown property'),
    'unknown key accepted',
  );

  // The HTTP export, resolved through the installed package's `exports` from the consumer. Its
  // fetch face is driven directly: no listener, no SESS call (fetch is trapped), no store opened.
  await writeFile(
    join(consumer, 'http-smoke.mjs'),
    `
import { createSessMcpHttpHandler } from '@sess.si/mcp/http';
globalThis.fetch = () => { throw new Error('unexpected network'); };
let storeOpened = false;
const handler = createSessMcpHttpHandler({
  authenticate: (request) => request.headers.get('authorization') === 'Bearer smoke' ? {
    workspaceId: 'wks_smoke', principalId: 'usr_smoke', clientId: 'cli_smoke', grantId: 'grt_smoke',
    grantGeneration: '1', scopes: ['smoke'], credential: () => 'smoke-credential',
  } : undefined,
  handleStore: () => { storeOpened = true; throw new Error('store must not be opened'); },
  requiredScopes: ['smoke'],
  allowedHosts: ['mcp.smoke.test'],
  apiOrigin: 'https://api.smoke.test',
  resourceMetadataUrl: 'https://mcp.smoke.test/.well-known/oauth-protected-resource/mcp',
});
const post = (body, auth = true) => handler.fetch(new Request('https://mcp.smoke.test/mcp', {
  method: 'POST',
  headers: { host: 'mcp.smoke.test', 'content-type': 'application/json', accept: 'application/json, text/event-stream', ...(auth ? { authorization: 'Bearer smoke' } : {}) },
  body,
}));
const rpc = async (response) => {
  const text = await response.text();
  const line = text.split('\\n').find((l) => l.startsWith('data: '));
  return JSON.parse(line ? line.slice(6) : text);
};
const list = await post('{"jsonrpc":"2.0","id":1,"method":"tools/list"}');
const tools = (await rpc(list)).result.tools.map((t) => t.name);
const unauthenticated = await post('{"jsonrpc":"2.0","id":2,"method":"tools/list"}', false);
const unsafe = await rpc(await post('{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"sess_response","arguments":{"handle":"sh_AAAAAAAAAAAAAAAAAAAAAA","revision":1,"__proto__":{"polluted":true}}}}'));
await handler.close();
process.stdout.write(JSON.stringify({
  listStatus: list.status,
  tools,
  unauthenticatedStatus: unauthenticated.status,
  challenge: unauthenticated.headers.get('www-authenticate'),
  unsafe: unsafe.result,
  storeOpened,
}));
`,
  );
  const httpSmoke = JSON.parse(run(process.execPath, ['http-smoke.mjs'], consumer));
  assert(
    httpSmoke.listStatus === 200 &&
      JSON.stringify(httpSmoke.tools) === JSON.stringify(tools.map((t) => t.name)),
    'HTTP export tools/list drift',
  );
  assert(
    httpSmoke.unauthenticatedStatus === 401 && /resource_metadata=/.test(httpSmoke.challenge ?? ''),
    'HTTP export must challenge an unauthenticated request',
  );
  assert(
    httpSmoke.unsafe?.isError === true && httpSmoke.unsafe.content[0].text.includes('INVALID_ARGUMENTS'),
    'HTTP export accepted an unsafe key',
  );
  assert(httpSmoke.storeOpened === false, 'HTTP export opened a store for tools/list or a rejected call');

  // Source identity of the tested bytes; the release workflow requires the tag commit and a clean tree.
  const git = (args) => {
    try {
      return run('git', args, adapter).trim();
    } catch {
      return null; // a downloaded source archive may have no Git metadata; release CI requires it
    }
  };
  const porcelain = git(['status', '--porcelain', '--untracked-files=all']);
  const result = {
    name: manifest.name,
    version: manifest.version,
    status: install.sdkMode === 'registry' ? 'registry SDK dependency' : 'candidate',
    sdkMode: install.sdkMode,
    sourceCommit: git(['rev-parse', 'HEAD']),
    sourceTreeDirty: porcelain === null ? null : porcelain.length !== 0,
    filename: packed.filename,
    tarball: `.artifacts/${packed.filename}`,
    sha256: createHash('sha256')
      .update(await readFile(tarball))
      .digest('hex'),
    integrity: packed.integrity,
    compressedBytes: packed.size,
    unpackedBytes: packed.unpackedSize,
    fileCount: packed.files.length,
    sessSdk: `${compatibility.sessSdk.name}@${compatibility.sessSdk.version} (${install.sdkMode} sha256 ${compatibility.sessSdk.sha256})`,
    installedProductionPackages: install.productionCount,
    node: process.version,
    negotiatedProtocol: raw[1].result.protocolVersion,
    tools: tools.map((t) => t.name),
    checks: [
      'tarball allowlist and no lifecycle hooks',
      'packed hygiene: no maps, fixtures, non-public hosts, credential shapes or internal references',
      `offline --ignore-scripts install of packed adapter + ${install.sdkMode} SDK`,
      'no import-time network/timers/output/file reads/SESS env reads',
      'installed bin initialize + tools/list via official MCP client',
      'unconfigured call fails closed without writing state',
      'server-side rejection of __proto__ and unknown argument keys',
      'import boundary: node:, own relative files, @modelcontextprotocol/server(/stdio), @modelcontextprotocol/node and SESS SDK only',
      'exports: ./http (with types) and ./package.json only',
      '@sess.si/mcp/http from the consumer: tools/list, 401 challenge and unsafe-key rejection without network or store',
    ],
  };
  await writeFile(join(adapter, '.artifacts', 'package-result.json'), `${JSON.stringify(result, null, 2)}\n`);
  console.log(JSON.stringify(result, null, 2));
} finally {
  await install.cleanup();
  await rm(state, { recursive: true, force: true });
}

/** Writes newline-delimited JSON-RPC to the bin and collects responses by id. */
function rawExchange(binPath, env, messages) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(process.execPath, [binPath], { env, stdio: ['pipe', 'pipe', 'ignore'] });
    const responses = {};
    const expected = messages.filter(
      (m) => (typeof m === 'string' ? JSON.parse(m).id : m.id) !== undefined,
    ).length;
    let buffer = '';
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error('check-package: raw JSON-RPC exchange timed out'));
    }, 15_000);
    child.stdout.on('data', (chunk) => {
      buffer += chunk.toString();
      let index;
      while ((index = buffer.indexOf('\n')) >= 0) {
        const message = JSON.parse(buffer.slice(0, index));
        buffer = buffer.slice(index + 1);
        if (message.id !== undefined) responses[message.id] = message;
        if (Object.keys(responses).length === expected) {
          clearTimeout(timer);
          child.stdin.end();
          resolvePromise(responses);
        }
      }
    });
    child.on('error', reject);
    for (const message of messages)
      child.stdin.write(`${typeof message === 'string' ? message : JSON.stringify(message)}\n`);
  });
}
