// The served skill against the official checkers (Sess ledger L-351; the note "Skills, Tasks and
// Elicitation over MCP", 4.4 item 4). Starts the built HTTP composition (dist/http.js) on a loopback
// port, then runs, each pinned by exact version in package.json / package-lock.json:
//   - the official MCP conformance suite (@modelcontextprotocol/conformance) on its three SEP-2640
//     Skills server scenarios: skills-enumeration (skills/list, skills/get, capability), -manifest
//     (the SKILL.md resource through resources/read) and -directory (resources/directory/read);
//   - the MCP Inspector CLI (@modelcontextprotocol/inspector) `--verify --require-digests` over
//     skills/list and skills/get, which re-reads every file and checks its size and digest.
// Local only: 127.0.0.1, synthetic principal, no SESS call (fetch is trapped), no store opened, no
// secret. The checkers send no credential, so this local test server authenticates every request
// as one synthetic principal; the hosted /mcp keeps its sign-in. Usage: npm run check:skills
// (after npm run build).
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import http from 'node:http';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const adapter = join(dirname(fileURLToPath(import.meta.url)), '..');
const bin = (name) => join(adapter, 'node_modules', '.bin', name);
const SCENARIOS = ['sep-2640-skills-enumeration', 'sep-2640-skills-manifest', 'sep-2640-skills-directory'];
const SKILL_URI = 'skill://ask-a-person/SKILL.md';
// One check excused, by its <scenario>:<check-id>: it needs a skill subdirectory, and ours has none.
const BASELINE = join(adapter, 'scripts', 'skills-conformance-baseline.yml');

if (!existsSync(join(adapter, 'dist', 'http.js')))
  throw new Error('dist/ is missing: run npm run build first');
const { createSessMcpHttpHandler } = await import(pathToFileURL(join(adapter, 'dist', 'http.js')).href);

globalThis.fetch = () => {
  throw new Error('skills-conformance: unexpected network call from the server under test');
};
const handler = createSessMcpHttpHandler({
  authenticate: () => ({
    workspaceId: 'wks_conformance',
    principalId: 'usr_conformance',
    clientId: 'cli_conformance',
    grantId: 'grt_conformance',
    grantGeneration: '1',
    scopes: ['conformance'],
    credential: () => 'synthetic-conformance-credential',
  }),
  handleStore: () => {
    throw new Error('skills-conformance: the store must not be opened');
  },
  requiredScopes: ['conformance'],
  allowedHosts: ['127.0.0.1', 'localhost'],
  apiOrigin: 'https://api.conformance.invalid',
});
const server = http.createServer((req, res) => void handler.node(req, res));
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const url = `http://127.0.0.1:${server.address().port}/mcp`;

function run(command, args, cwd) {
  return new Promise((resolve) => {
    const child = spawn(command, args, { cwd, env: { PATH: process.env.PATH ?? '', HOME: cwd, CI: '1' } });
    let out = '';
    child.stdout.on('data', (chunk) => (out += chunk));
    child.stderr.on('data', (chunk) => (out += chunk));
    child.on('close', (code) => resolve({ code, out }));
  });
}

const work = await mkdtemp(join(tmpdir(), 'sess-skills-conformance-'));
const failures = [];
const summary = [];
try {
  for (const scenario of SCENARIOS) {
    const { code, out } = await run(
      bin('conformance'),
      ['server', '--url', url, '--scenario', scenario, '--expected-failures', BASELINE],
      work,
    );
    summary.push(`conformance ${scenario}: exit ${code}`);
    process.stdout.write(`\n== conformance server --scenario ${scenario}\n${out}`);
    if (code !== 0) failures.push(`conformance ${scenario} exited ${code}`);
  }
  for (const args of [
    ['--method', 'skills/list', '--verify', '--require-digests'],
    ['--method', 'skills/get', '--uri', SKILL_URI, '--verify', '--require-digests'],
  ]) {
    const { code, out } = await run(bin('mcp-inspector'), ['--cli', url, ...args], work);
    summary.push(`inspector ${args.join(' ')}: exit ${code}`);
    process.stdout.write(`\n== mcp-inspector --cli ${args.join(' ')}\n${out}`);
    if (code !== 0) failures.push(`inspector ${args.join(' ')} exited ${code}`);
    else if (!/"outcome"\s*:\s*"verified"/.test(out))
      failures.push(`inspector ${args.join(' ')}: no verified report`);
  }
} finally {
  await handler.close();
  server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
  await rm(work, { recursive: true, force: true });
}
process.stdout.write(`\n${summary.join('\n')}\n`);
if (failures.length) {
  process.stderr.write(`skills-conformance failed:\n- ${failures.join('\n- ')}\n`);
  process.exit(1);
}
process.stdout.write(
  'skills-conformance: the served skill passes the conformance scenarios and the Inspector verification.\n',
);
