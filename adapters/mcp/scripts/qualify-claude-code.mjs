// Real-client qualification with Claude Code WITHOUT model calls and WITHOUT touching the owner's
// Claude configuration: a temporary CLAUDE_CONFIG_DIR and project directory are used, and only
// `claude mcp add --scope local`, `claude mcp list` (health check) and `claude mcp get` run.
// No `claude -p` or any prompt is ever issued. A recording stdio proxy captures the protocol
// version and method names that Claude Code actually sends (no params beyond those, no results).
//
//   SESS_MCP_CLAUDE_BIN    path to the claude executable (default: claude on PATH)
//   SESS_MCP_INSTALLED_BIN optional path to an already installed sess-mcp bin; otherwise the
//                          packed adapter is installed into a temporary consumer first.
// Machines with an enterprise managed-mcp.json that has exclusive control cannot add servers;
// the script reports that as BLOCKED rather than a pass.
import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { adapterDir, installPacked } from './lib/install-packed.mjs';

const claude = process.env.SESS_MCP_CLAUDE_BIN || 'claude';
const work = await mkdtemp(join(tmpdir(), 'sess-mcp-claude-'));
const config = join(work, 'config');
const project = join(work, 'project');
const record = join(work, 'record.jsonl');
const state = join(work, 'state');
let install;
try {
  for (const path of [config, project, state]) await mkdir(path, { recursive: true });
  let binPath = process.env.SESS_MCP_INSTALLED_BIN;
  if (!binPath) {
    install = await installPacked();
    binPath = install.binPath;
  }
  const env = { ...process.env, CLAUDE_CONFIG_DIR: config };
  const sh = (args) => {
    try {
      return {
        ok: true,
        out: execFileSync(claude, args, { cwd: project, env, encoding: 'utf8', timeout: 60_000 }),
      };
    } catch (error) {
      return { ok: false, out: `${error.stdout ?? ''}${error.stderr ?? ''}` };
    }
  };
  const version = sh(['--version']).out.trim();
  console.log(`claude: ${version}`);
  const added = sh([
    'mcp',
    'add',
    '--scope',
    'local',
    'sess',
    '-e',
    `SESS_MCP_STATE_DIR=${state}`,
    '--',
    process.execPath,
    join(adapterDir, 'scripts', 'lib', 'record-proxy.mjs'),
    record,
    binPath,
  ]);
  console.log(`mcp add: ${added.ok ? 'ok' : 'FAILED'} ${added.out.trim()}`);
  if (!added.ok) {
    console.log('result: BLOCKED (server could not be added; see message)');
    process.exitCode = 2;
  } else {
    const list = sh(['mcp', 'list']);
    console.log(`mcp list:\n${list.out.trim()}`);
    const get = sh(['mcp', 'get', 'sess']);
    console.log(`mcp get:\n${get.out.trim()}`);
    const observed = (await readFile(record, 'utf8').catch(() => ''))
      .trim()
      .split('\n')
      .filter(Boolean)
      .map((line) => JSON.parse(line));
    console.log(`observed protocol messages:\n${observed.map((o) => JSON.stringify(o)).join('\n')}`);
    const init = observed.find((o) => o.method === 'initialize');
    const reply = observed.find((o) => o.direction === 'server->host' && o.protocolVersion);
    const connected = /sess:.*(✓|Connected)/i.test(list.out);
    console.log(
      `result: ${connected && init ? 'CONNECTED' : 'NOT CONNECTED'} requested=${init?.protocolVersion} negotiated=${reply?.protocolVersion} client=${JSON.stringify(init?.clientInfo)}`,
    );
    if (!connected) process.exitCode = 1;
  }
} finally {
  await install?.cleanup();
  await rm(work, { recursive: true, force: true });
}
