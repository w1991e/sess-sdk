// scripts/check-starter-graph.mjs: the walk over a real starter install's lockfile that keeps
// picomatch out of the starter's runtime graph (founder 2026-11-17 22:05Z item 1; ASTRA-70-R1).
// The starter ships no lockfile, so its graph is what `npm install` resolves from the published
// SDK's ranges; equal direct pins and a clean SDK root lockfile do not establish it.
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  parseLock as parseStarterLock,
  runtimeChains,
  starterChains,
} from '../../scripts/check-starter-graph.mjs';
import { RUNTIME_EDGES, chainsTo, parseLock } from './npm-lockfile-graph.js';

const SCRIPT = fileURLToPath(new URL('../../scripts/check-starter-graph.mjs', import.meta.url));
const read = (path: string): string => readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8');

const lockfile = (
  root: Record<string, unknown>,
  packages: Record<string, Record<string, unknown>>,
  name = 'my-agent',
): string =>
  JSON.stringify({
    name,
    version: '0.1.0',
    lockfileVersion: 3,
    requires: true,
    packages: { '': { name, version: '0.1.0', ...root }, ...packages },
  });

// The pinned SDK's direct dependencies, the same in both closures below.
const DIRECT = { canonicalize: '5.1.0', jose: '6.2.12', standardwebhooks: '1.1.1' };
const STARTER_ROOT = { dependencies: { '@sess.si/sdk': '0.3.0' } };
const CLEAN: Record<string, Record<string, unknown>> = {
  'node_modules/@sess.si/sdk': { version: '0.3.0', dependencies: DIRECT },
  'node_modules/canonicalize': { version: '5.1.0' },
  'node_modules/jose': { version: '6.2.12' },
  'node_modules/standardwebhooks': {
    version: '1.1.1',
    dependencies: { '@stablelib/base64': '^1.0.0', 'fast-sha256': '^1.3.0' },
  },
  'node_modules/@stablelib/base64': { version: '1.0.1' },
  'node_modules/fast-sha256': { version: '1.3.0' },
};
// ASTRA-70-R1's control: the same direct pins, but `fast-sha256 ^1.3.0` resolves to a later
// release that brings picomatch.
const DRIFTED: Record<string, Record<string, unknown>> = {
  ...CLEAN,
  'node_modules/fast-sha256': { version: '1.4.0', dependencies: { micromatch: '^4.0.0' } },
  'node_modules/micromatch': { version: '4.0.8', dependencies: { picomatch: '^2.3.1' } },
  'node_modules/picomatch': { version: '2.3.1' },
};
const DRIFTED_CHAIN =
  'my-agent > @sess.si/sdk@0.3.0 > standardwebhooks@1.1.1 > fast-sha256@1.4.0 > micromatch@4.0.8 > picomatch@2.3.1';

const cli = (text: string): { code: number; out: string } => {
  const dir = mkdtempSync(join(tmpdir(), 'starter-graph-'));
  try {
    const path = join(dir, 'package-lock.json');
    writeFileSync(path, text);
    try {
      const out = execFileSync(process.execPath, [SCRIPT, path], {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      return { code: 0, out };
    } catch (error) {
      const e = error as { status: number; stdout: string; stderr: string };
      return { code: e.status, out: `${e.stdout}${e.stderr}` };
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
};

describe("the starter's installed graph: scripts/check-starter-graph.mjs", () => {
  it('passes a starter closure that reaches no picomatch', () => {
    expect(starterChains(lockfile(STARTER_ROOT, CLEAN), 'clean')).toEqual([]);
    const run = cli(lockfile(STARTER_ROOT, CLEAN));
    expect(run.code).toBe(0);
    expect(run.out).toMatch(/no picomatch in the starter's installed runtime graph/);
  });

  it("fails a closure with the same direct pins whose one transitive resolution differs (ASTRA-70-R1), while the SDK root lockfile's walk passes", () => {
    // The direct-declaration comparison sees no difference between the two closures.
    const sdkOf = (packages: Record<string, Record<string, unknown>>) =>
      packages['node_modules/@sess.si/sdk']?.dependencies;
    expect(sdkOf(DRIFTED)).toEqual(sdkOf(CLEAN));
    // The SDK's own root lockfile, resolved when it was written, is clean.
    const sdkRoot = lockfile(
      { dependencies: DIRECT },
      Object.fromEntries(Object.entries(CLEAN).filter(([key]) => key !== 'node_modules/@sess.si/sdk')),
      '@sess.si/sdk',
    );
    expect(chainsTo(parseLock(sdkRoot, 'sdk root'), RUNTIME_EDGES, 'picomatch')).toEqual([]);
    // The starter install that resolved differently fails, naming the route.
    expect(starterChains(lockfile(STARTER_ROOT, DRIFTED), 'drifted')).toEqual([DRIFTED_CHAIN]);
    const run = cli(lockfile(STARTER_ROOT, DRIFTED));
    expect(run.code).toBe(1);
    expect(run.out).toContain(DRIFTED_CHAIN);
  });

  it('finds picomatch by an optional or peer edge, nested the way Node resolves it, and under an alias', () => {
    const withSdk = (sdk: Record<string, unknown>, extra: Record<string, Record<string, unknown>>) =>
      starterChains(
        lockfile(STARTER_ROOT, {
          ...CLEAN,
          'node_modules/@sess.si/sdk': { version: '0.3.0', ...sdk },
          ...extra,
        }),
        'synthetic',
      );
    expect(
      withSdk(
        { optionalDependencies: { picomatch: '4' } },
        { 'node_modules/picomatch': { version: '4.0.7' } },
      ),
    ).toEqual(['my-agent > @sess.si/sdk@0.3.0 > picomatch@4.0.7']);
    expect(
      withSdk({ peerDependencies: { picomatch: '4' } }, { 'node_modules/picomatch': { version: '4.0.7' } }),
    ).toEqual(['my-agent > @sess.si/sdk@0.3.0 > picomatch@4.0.7 (peer)']);
    expect(
      withSdk(
        { dependencies: { pm: 'npm:picomatch@4' } },
        { 'node_modules/@sess.si/sdk/node_modules/pm': { name: 'picomatch', version: '4.0.7' } },
      ),
    ).toEqual(['my-agent > @sess.si/sdk@0.3.0 > picomatch@4.0.7']);
  });

  it('does not follow devDependencies, and skips only an optional peer that is not installed', () => {
    expect(
      starterChains(
        lockfile(
          { ...STARTER_ROOT, devDependencies: { picomatch: '4' } },
          {
            ...CLEAN,
            'node_modules/picomatch': { version: '4.0.7', dev: true },
          },
        ),
        'dev',
      ),
    ).toEqual([]);
    const sdk = (fields: Record<string, unknown>) =>
      lockfile(STARTER_ROOT, { ...CLEAN, 'node_modules/@sess.si/sdk': { version: '0.3.0', ...fields } });
    expect(
      starterChains(
        sdk({ peerDependencies: { absent: '1' }, peerDependenciesMeta: { absent: { optional: true } } }),
        'p',
      ),
    ).toEqual([]);
    expect(() => starterChains(sdk({ peerDependencies: { absent: '1' } }), 'p')).toThrow(
      /absent resolves to no lockfile entry/,
    );
  });

  it('fails closed on unreadable input, another lockfile version, a link, a missing entry or a non-starter root', () => {
    const cases: [string, RegExp][] = [
      ['not json', /not JSON/],
      [JSON.stringify({ lockfileVersion: 2, packages: {} }), /lockfileVersion is not 3/],
      [
        lockfile(STARTER_ROOT, { ...CLEAN, 'node_modules/jose': { link: true, resolved: '../jose' } }),
        /is a link/,
      ],
      [lockfile(STARTER_ROOT, { ...CLEAN, '../workspace': { version: '1.0.0' } }), /not a node_modules path/],
      [
        lockfile(
          STARTER_ROOT,
          Object.fromEntries(Object.entries(CLEAN).filter(([k]) => k !== 'node_modules/jose')),
        ),
        /jose resolves to no lockfile entry/,
      ],
      [lockfile({ dependencies: {} }, CLEAN), /does not depend on @sess\.si\/sdk/],
      [
        lockfile(
          STARTER_ROOT,
          Object.fromEntries(Object.entries(CLEAN).filter(([k]) => k !== 'node_modules/@sess.si/sdk')),
        ),
        /@sess\.si\/sdk is not installed/,
      ],
    ];
    for (const [text, message] of cases) {
      expect(() => starterChains(text, 'bad')).toThrow(message);
      const run = cli(text);
      expect(run.code).toBe(1);
      expect(run.out).toMatch(message);
    }
  });

  it('agrees with the test walker (npm-lockfile-graph.ts) on every lockfile it reads here, the repository root included', () => {
    const texts = [
      lockfile(STARTER_ROOT, CLEAN),
      lockfile(STARTER_ROOT, DRIFTED),
      read('package-lock.json'),
      read('adapters/mcp/package-lock.json'),
      read('adapters/openclaw/package-lock.json'),
    ];
    for (const text of texts)
      for (const wanted of ['picomatch', 'jose', 'micromatch'])
        expect(runtimeChains(parseStarterLock(text, 'x'), wanted)).toEqual(
          chainsTo(parseLock(text, 'x'), RUNTIME_EDGES, wanted),
        );
    // Non-vacuous: the comparison covers a lockfile where the walk finds picomatch.
    expect(
      runtimeChains(parseStarterLock(read('adapters/openclaw/package-lock.json'), 'x'), 'picomatch'),
    ).not.toEqual([]);
  });
});
