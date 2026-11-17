// The dependency audit excepts GHSA-fc5q-39xc-vjpf (picomatch, no fixed version published) until
// its date in .github/audit-exceptions.json, for one reason: "development and test toolchain only;
// the globs it parses come from our own configuration". This checks that reason (founder
// 2026-11-17 22:05Z item 1): picomatch, or anything that brings it in, must not be reachable in the
// runtime graph (dependencies, optionalDependencies, peerDependencies, transitively) of any published
// package: @sess.si/sdk, @sess.si/mcp, @sess.si/openclaw and @sess.si/create-agent with its starter.
// Each graph is read from the lockfile that package's CI installs from.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { RUNTIME_EDGES, chainsTo, parseLock, type Lock } from './npm-lockfile-graph.js';

const WANTED = 'picomatch';
const read = (path: string): string => readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8');
const manifest = (path: string): Record<string, unknown> => JSON.parse(read(path)) as Record<string, unknown>;
const lockAt = (path: string): Lock => parseLock(read(path), path);

const DECLARED = ['dependencies', 'optionalDependencies', 'peerDependencies'] as const;
const BUNDLED = ['bundleDependencies', 'bundledDependencies'] as const;

/** The lockfile's root agrees with package.json, so the walk reads the graph the package declares. */
const agrees = (lock: Lock, pkg: Record<string, unknown>): void => {
  const root = lock.packages.get('');
  expect(root?.name).toBe(pkg.name);
  expect(root?.version).toBe(pkg.version);
  for (const field of DECLARED)
    expect(root?.[field] ?? {}, `${String(pkg.name)} ${field}`).toEqual(pkg[field] ?? {});
  for (const field of BUNDLED) expect(pkg[field], `${String(pkg.name)} ${field}`).toBeUndefined();
};

/** A package's runtime chains to picomatch, from its own lockfile. */
const runtimeChains = (manifestPath: string, lockPath: string): string[] => {
  const lock = lockAt(lockPath);
  agrees(lock, manifest(manifestPath));
  return chainsTo(lock, RUNTIME_EDGES, WANTED);
};

/** Non-vacuous: the same walk finds picomatch from the lockfile's devDependencies today. */
const devChains = (lockPath: string): string[] => chainsTo(lockAt(lockPath), ['devDependencies'], WANTED);

// A minimal lockfile for the walker's own cases.
const lock = (root: Record<string, unknown>, packages: Record<string, Record<string, unknown>>): string =>
  JSON.stringify({
    name: 'x',
    version: '1.0.0',
    lockfileVersion: 3,
    requires: true,
    packages: { '': { name: 'x', version: '1.0.0', ...root }, ...packages },
  });
const PACKAGES: Record<string, Record<string, unknown>> = {
  'node_modules/glob': { version: '1.0.0', dependencies: { micromatch: '^4' } },
  'node_modules/micromatch': { version: '4.0.8', dependencies: { picomatch: '^2' } },
  'node_modules/picomatch': { version: '4.0.7' },
  'node_modules/safe': { version: '1.0.0' },
  'node_modules/host': { version: '2.0.0', dependencies: { tool: '1' } },
  'node_modules/host/node_modules/tool': { version: '1.0.0', dependencies: { picomatch: '^2' } },
  'node_modules/host/node_modules/tool/node_modules/picomatch': { version: '2.3.1' },
};
const walk = (root: Record<string, unknown>, packages = PACKAGES): string[] =>
  chainsTo(parseLock(lock(root, packages), 'synthetic'), RUNTIME_EDGES, WANTED);

describe('the picomatch audit exception: picomatch stays out of every published runtime graph', () => {
  it('the audit exceptions all name picomatch, so this test checks each one', () => {
    const { exceptions } = JSON.parse(read('.github/audit-exceptions.json')) as {
      exceptions: { package: string }[];
    };
    expect(exceptions.map((e) => e.package)).toEqual([WANTED]);
  });

  it('@sess.si/sdk: picomatch is not reachable at runtime, and is reachable from its devDependencies', () => {
    expect(runtimeChains('package.json', 'package-lock.json')).toEqual([]);
    expect(devChains('package-lock.json')).not.toEqual([]);
  });

  it('@sess.si/mcp: picomatch is not reachable at runtime, and is reachable from its devDependencies', () => {
    expect(runtimeChains('adapters/mcp/package.json', 'adapters/mcp/package-lock.json')).toEqual([]);
    expect(devChains('adapters/mcp/package-lock.json')).not.toEqual([]);
  });

  it('@sess.si/openclaw: picomatch is not reachable at runtime, and is reachable from its devDependencies', () => {
    expect(runtimeChains('adapters/openclaw/package.json', 'adapters/openclaw/package-lock.json')).toEqual(
      [],
    );
    expect(devChains('adapters/openclaw/package-lock.json')).not.toEqual([]);
  });

  it('@sess.si/create-agent: no runtime dependency, and its starter installs only @sess.si/sdk, whose graph is the root lockfile', () => {
    const pkg = manifest('create-agent/package.json');
    expect(pkg.name).toBe('@sess.si/create-agent');
    for (const field of [...DECLARED, ...BUNDLED])
      expect(pkg[field], `create-agent ${field}`).toBeUndefined();
    const starter = manifest('create-agent/template/package.json');
    for (const field of ['optionalDependencies', 'peerDependencies', ...BUNDLED])
      expect(starter[field], `starter ${field}`).toBeUndefined();
    const root = manifest('package.json');
    // The starter's one dependency is the SDK version the root lockfile describes; another version
    // would need its own lockfile, so it fails here rather than being assumed.
    expect(starter.dependencies).toEqual({ '@sess.si/sdk': root.version });
    expect(runtimeChains('package.json', 'package-lock.json')).toEqual([]);
  });

  describe('the walker', () => {
    it('finds picomatch through a transitive runtime dependency, naming the chain', () => {
      expect(walk({ dependencies: { glob: '1' } })).toEqual([
        'x > glob@1.0.0 > micromatch@4.0.8 > picomatch@4.0.7',
      ]);
    });

    it('finds a direct, an optional and a peer picomatch', () => {
      expect(walk({ dependencies: { picomatch: '4' } })).toEqual(['x > picomatch@4.0.7']);
      expect(walk({ optionalDependencies: { micromatch: '4' } })).toEqual([
        'x > micromatch@4.0.8 > picomatch@4.0.7',
      ]);
      expect(walk({ peerDependencies: { glob: '1' } })).toEqual([
        'x > glob@1.0.0 (peer) > micromatch@4.0.8 > picomatch@4.0.7',
      ]);
    });

    it('resolves nested node_modules the way Node does, and finds an aliased picomatch', () => {
      expect(walk({ dependencies: { host: '2' } })).toEqual([
        'x > host@2.0.0 > tool@1.0.0 > picomatch@2.3.1',
      ]);
      expect(
        walk(
          { dependencies: { pm: 'npm:picomatch@4' } },
          { 'node_modules/pm': { name: 'picomatch', version: '4.0.7' } },
        ),
      ).toEqual(['x > picomatch@4.0.7']);
    });

    it('does not count devDependencies, of the root or of a dependency', () => {
      expect(walk({ devDependencies: { glob: '1' }, dependencies: { safe: '1' } })).toEqual([]);
      expect(
        walk(
          { dependencies: { safe: '1' } },
          { ...PACKAGES, 'node_modules/safe': { version: '1.0.0', devDependencies: { glob: '1' } } },
        ),
      ).toEqual([]);
    });

    it('skips only an optional peer the lockfile does not install', () => {
      expect(
        walk({ peerDependencies: { absent: '1' }, peerDependenciesMeta: { absent: { optional: true } } }),
      ).toEqual([]);
      expect(() => walk({ peerDependencies: { absent: '1' } })).toThrow(
        /absent resolves to no lockfile entry/,
      );
    });

    it('fails closed on a lockfile it cannot read', () => {
      expect(() => parseLock('{', 'broken')).toThrow(/not JSON/);
      expect(() => parseLock('[]', 'array')).toThrow(/not a lockfile object/);
      expect(() => parseLock(JSON.stringify({ lockfileVersion: 2, packages: {} }), 'v2')).toThrow(
        /lockfileVersion is not 3/,
      );
      expect(() => parseLock(JSON.stringify({ lockfileVersion: 3 }), 'nopackages')).toThrow(
        /no packages map/,
      );
      expect(() => parseLock(JSON.stringify({ lockfileVersion: 3, packages: {} }), 'noroot')).toThrow(
        /no root entry/,
      );
      expect(() => parseLock(lock({}, { 'packages/lib': { version: '1.0.0' } }), 'ws')).toThrow(
        /not a node_modules path/,
      );
      expect(() => parseLock(lock({}, { 'node_modules/lib': { link: true } }), 'link')).toThrow(/is a link/);
      expect(() => parseLock(lock({ dependencies: ['glob'] }, {}), 'shape')).toThrow(
        /dependencies is not an object/,
      );
      expect(() => walk({ dependencies: { missing: '1' } })).toThrow(/missing resolves to no lockfile entry/);
      expect(() => lockAt('adapters/none/package-lock.json')).toThrow(/ENOENT/);
    });
  });
});
