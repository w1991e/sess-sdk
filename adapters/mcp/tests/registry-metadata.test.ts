import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ENV } from '../src/config.js';

const read = (name: string) => JSON.parse(readFileSync(join(import.meta.dirname, '..', name), 'utf8'));
const manifest = read('package.json');
const server = read('server.json');
const listing = read('listing.json');

describe('MCP registry metadata (server.json, schema 2025-12-11)', () => {
  it('server.json’s version is package.json’s (CI version check)', () => {
    expect(manifest.version).toMatch(/^\d+\.\d+\.\d+(?:-rc\.\d+)?$/);
    expect(server.version).toBe(manifest.version);
  });

  it('is remote-only under si.sess/sess while the npm package is deferred; the package keeps its published mcpName', () => {
    expect(server.$schema).toBe(
      'https://static.modelcontextprotocol.io/schemas/2025-12-11/server.schema.json',
    );
    expect(server.name).toBe('si.sess/sess');
    expect(listing.providers.mcpRegistry.npmPackage.status).toBe('deferred');
    // No package is listed, so the registry cross-checks no published package's mcpName.
    expect(server.packages).toBeUndefined();
    expect(server.remotes).toEqual([{ type: 'streamable-http', url: 'https://mcp.sess.si/mcp' }]);
    // The published @sess.si/mcp@0.1.0-rc.3's identity is unchanged.
    expect(manifest.mcpName).toBe('io.github.w1991e/sess');
    expect(listing.providers.mcpRegistry.npmPackage.publishedMcpName).toBe(manifest.mcpName);
    // A version, never a dist-tag.
    expect(JSON.stringify(server)).not.toMatch(/"next"|@next|"latest"|@latest/);
    expect(server.description.length).toBeGreaterThan(0);
    expect(server.description.length).toBeLessThanOrEqual(100);
    expect(server.repository).toEqual({
      url: 'https://github.com/w1991e/sess-sdk',
      source: 'github',
      subfolder: manifest.repository.directory,
    });
  });

  it('the stdio entry, once listed, declares only real owner configuration; the key is required and secret', () => {
    const vars = listing.stdio.environmentVariables as {
      name: string;
      isRequired: boolean;
      isSecret: boolean;
    }[];
    const known = new Set<string>(Object.values(ENV));
    for (const v of vars) expect(known.has(v.name)).toBe(true);
    expect(vars.find((v) => v.name === ENV.apiKey)).toMatchObject({ isRequired: true, isSecret: true });
    expect(vars.filter((v) => v.isRequired).map((v) => v.name)).toEqual([ENV.apiKey]);
    expect(vars.some((v) => v.name === ENV.insecureLocalhost)).toBe(false);
    // Every owner setting the server reads is declared, except the test-only localhost flag.
    expect(vars.map((v) => v.name).sort()).toEqual(
      Object.values(ENV)
        .filter((name) => name !== ENV.insecureLocalhost)
        .sort(),
    );
  });

  it('server.json is not shipped in the npm tarball (registry metadata only)', () => {
    expect(manifest.files).not.toContain('server.json');
  });
});
