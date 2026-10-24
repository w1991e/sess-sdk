import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ENV } from '../src/config.js';

const read = (name: string) => JSON.parse(readFileSync(join(import.meta.dirname, '..', name), 'utf8'));
const manifest = read('package.json');
const server = read('server.json');
/** The registry entry stays in step with the package on every release candidate (2026-10-20). */
const stable = manifest.version as string;

describe('MCP registry metadata (server.json, schema 2025-12-11)', () => {
  it('server.json’s version is package.json’s, for the server and its npm package (CI version check)', () => {
    expect(manifest.version).toMatch(/^\d+\.\d+\.\d+(?:-rc\.\d+)?$/);
    expect(server.version).toBe(manifest.version);
    expect(server.packages.map((p: { version: string }) => p.version)).toEqual([manifest.version]);
  });

  it('names the package at its exact version, and proves ownership through mcpName', () => {
    expect(server.$schema).toBe(
      'https://static.modelcontextprotocol.io/schemas/2025-12-11/server.schema.json',
    );
    expect(server.name).toMatch(/^[a-zA-Z0-9.-]+\/[a-zA-Z0-9._-]+$/);
    expect(manifest.mcpName).toBe(server.name);
    // A version, never a dist-tag.
    expect(JSON.stringify(server)).not.toMatch(/"next"|@next|"latest"|@latest/);
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

  it('declares only real owner configuration; the key is required and secret; no test-only flag', () => {
    const vars = server.packages[0].environmentVariables as {
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
