// Shared helper for the adapter's scripts: start an installed `sess-mcp` bin over stdio with the
// official MCP TypeScript client. The client is a maintainer devDependency of the adapter
// (`@modelcontextprotocol/sdk` 1.x, the client generation hosts ship today); it is never a runtime
// dependency of the package, so it is resolved from the adapter directory, not from the packed
// consumer, which installs production dependencies only.
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { adapterDir } from './install-packed.mjs';

export async function loadClientLibrary(requireFrom = adapterDir) {
  const require = createRequire(join(requireFrom, 'noop.js'));
  const resolve = (spec) => pathToFileURL(require.resolve(spec)).href;
  const { Client } = await import(resolve('@modelcontextprotocol/sdk/client/index.js'));
  const { StdioClientTransport } = await import(resolve('@modelcontextprotocol/sdk/client/stdio.js'));
  return { Client, StdioClientTransport };
}

/** Connects to `node <binPath>` with exactly `env` (no inherited secrets). stderr is captured. */
export async function connectStdio({ binPath, env, cwd }) {
  const { Client, StdioClientTransport } = await loadClientLibrary();
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
