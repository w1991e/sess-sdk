// Shared helper for the adapter's scripts: start an installed `sess-mcp` bin over stdio with the
// official MCP TypeScript client. `requireFrom` is the directory whose node_modules supplies the
// client library, so packed-consumer checks use the consumer's own installed copy.
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

export async function loadClientLibrary(requireFrom) {
  const require = createRequire(join(requireFrom, 'noop.js'));
  const resolve = (spec) => pathToFileURL(require.resolve(spec)).href;
  const { Client } = await import(resolve('@modelcontextprotocol/sdk/client/index.js'));
  const { StdioClientTransport } = await import(resolve('@modelcontextprotocol/sdk/client/stdio.js'));
  return { Client, StdioClientTransport };
}

/** Connects to `node <binPath>` with exactly `env` (no inherited secrets). stderr is captured. */
export async function connectStdio({ requireFrom, binPath, env, cwd }) {
  const { Client, StdioClientTransport } = await loadClientLibrary(requireFrom);
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [binPath],
    env,
    cwd,
    stderr: 'pipe',
  });
  let stderr = '';
  transport.stderr?.on('data', (chunk) => {
    stderr += chunk.toString();
  });
  const client = new Client({ name: 'sess-mcp-qualification', version: '0.0.0' });
  await client.connect(transport);
  return {
    client,
    stderr: () => stderr,
    async close() {
      await client.close();
    },
  };
}
