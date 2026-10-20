import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ENV } from '../src/config.js';

const read = (name: string) => JSON.parse(readFileSync(join(import.meta.dirname, '..', name), 'utf8'));
const manifest = read('package.json');
const server = read('server.json');
const listing = read('listing.json');
/** The planned stable release the registry entry names (never a prerelease or a dist-tag). */
const stable = listing.providers.mcpRegistry.version as string;

describe('MCP registry metadata (server.json, schema 2025-12-11)', () => {
  it('names the package at its stable release, and proves ownership through mcpName', () => {
    expect(server.$schema).toBe(
      'https://static.modelcontextprotocol.io/schemas/2025-12-11/server.schema.json',
    );
    expect(server.name).toMatch(/^[a-zA-Z0-9.-]+\/[a-zA-Z0-9._-]+$/);
    expect(manifest.mcpName).toBe(server.name);
    expect(stable).toMatch(/^\d+\.\d+\.\d+$/);
    // package.json is that release or a candidate of it (0.1.0-rc.1 -> 0.1.0).
    expect(manifest.version.split('-')[0]).toBe(stable);
    expect(server.version).toBe(stable);
    expect(JSON.stringify(server)).not.toMatch(/-rc\.|"next"|@next/);
    expect(server.description.length).toBeGreaterThan(0);
    expect(server.description.length).toBeLessThanOrEqual(100);
    expect(server.repository).toEqual({
      url: 'https://github.com/w1991e/sess-sdk',
      source: 'github',
      subfolder: manifest.repository.directory,
    });
    expect(server.packages).toHaveLength(1);
    expect(server.packages[0]).toMatchObject({
      registryType: 'npm',
      registryBaseUrl: 'https://registry.npmjs.org',
      identifier: manifest.name,
      version: stable,
      runtimeHint: 'npx',
      transport: { type: 'stdio' },
    });
  });

  it('declares only real owner configuration; the key is optional (trial mode) and secret; no test-only flag', () => {
    const vars = server.packages[0].environmentVariables as {
      name: string;
      isRequired: boolean;
      isSecret: boolean;
    }[];
    const known = new Set<string>(Object.values(ENV));
    for (const v of vars) expect(known.has(v.name)).toBe(true);
    // Without SESS_API_KEY the stdio server runs the no-signup trial, so nothing is required.
    expect(vars.find((v) => v.name === ENV.apiKey)).toMatchObject({ isRequired: false, isSecret: true });
    expect(vars.filter((v) => v.isRequired).map((v) => v.name)).toEqual([]);
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
