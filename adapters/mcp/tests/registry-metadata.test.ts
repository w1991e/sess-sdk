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

  it('lists @sess.si/mcp under si.sess/sess beside the remote, with the repository; the package declares that name', () => {
    expect(server.$schema).toBe(
      'https://static.modelcontextprotocol.io/schemas/2025-12-11/server.schema.json',
    );
    expect(server.name).toBe('si.sess/sess');
    expect(listing.providers.mcpRegistry.npmPackage.status).toBe('listed');
    // The registry cross-checks a listed package's mcpName against the server name.
    expect(manifest.mcpName).toBe('si.sess/sess');
    expect(server.packages[0]).toMatchObject({ identifier: '@sess.si/mcp', version: manifest.version });
    expect(server.remotes).toEqual([{ type: 'streamable-http', url: 'https://mcp.sess.si/mcp' }]);
    // npm's readback: the published package is this version and declares the entry's name.
    expect(listing.providers.mcpRegistry.npmPackage.publishedMcpName).toBe('si.sess/sess');
    expect(listing.providers.mcpRegistry.npmPackage.publishedVersion).toBe(manifest.version);
    // A version, never a dist-tag.
    expect(JSON.stringify(server)).not.toMatch(/"next"|@next|"latest"|@latest/);
    expect(server.description.length).toBeGreaterThan(0);
    expect(server.description.length).toBeLessThanOrEqual(100);
    expect(server.websiteUrl).toBe('https://sess.si');
    expect(server.repository).toEqual({ url: 'https://github.com/w1991e/sess-sdk', source: 'github' });
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
