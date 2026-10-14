// Qualification-only stdio proxy: forwards bytes unchanged between an MCP host and the installed
// `sess-mcp` bin, and records the JSON-RPC method names, protocol versions and client identity it
// observes (never params beyond those fields, never results). Used to learn what a real host
// negotiates without modifying the server under test.
//   node record-proxy.mjs <record-file> <bin-path>
import { spawn } from 'node:child_process';
import { appendFileSync } from 'node:fs';

const [recordFile, binPath] = process.argv.slice(2);
const child = spawn(process.execPath, [binPath], { stdio: ['pipe', 'pipe', 'inherit'], env: process.env });
function observe(direction, chunk, state) {
  state.buffer += chunk.toString('utf8');
  let index;
  while ((index = state.buffer.indexOf('\n')) >= 0) {
    const line = state.buffer.slice(0, index);
    state.buffer = state.buffer.slice(index + 1);
    try {
      const message = JSON.parse(line);
      const entry = { direction, method: message.method ?? null, id: message.id ?? null };
      if (message.method === 'initialize') {
        entry.protocolVersion = message.params?.protocolVersion;
        entry.clientInfo = message.params?.clientInfo;
        entry.clientCapabilities = Object.keys(message.params?.capabilities ?? {});
      }
      if (message.result?.protocolVersion) entry.protocolVersion = message.result.protocolVersion;
      if (Array.isArray(message.result?.tools)) entry.tools = message.result.tools.map((t) => t.name);
      appendFileSync(recordFile, `${JSON.stringify(entry)}\n`);
    } catch {
      appendFileSync(recordFile, `${JSON.stringify({ direction, unparsed: true })}\n`);
    }
  }
}
const inbound = { buffer: '' };
const outbound = { buffer: '' };
process.stdin.on('data', (chunk) => {
  observe('host->server', chunk, inbound);
  child.stdin.write(chunk);
});
process.stdin.on('end', () => child.stdin.end());
child.stdout.on('data', (chunk) => {
  observe('server->host', chunk, outbound);
  process.stdout.write(chunk);
});
child.on('exit', (code) => process.exit(code ?? 0));
