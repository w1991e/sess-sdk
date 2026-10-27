import { readFileSync, readdirSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CONFIG_JSON_SCHEMA, DEFAULT_ORIGIN, parseConfig, resolveCredential } from '../../src/config.js';
import { doctorReport, QUALIFIED_HOST } from '../../src/doctor.js';
import { TOOL_PARAMETERS } from '../../src/schemas.js';
import { API_KEY, API_KEY_ENV, registerPlugin } from './harness.js';

const root = new URL('../../', import.meta.url);
const read = (path: string) => readFileSync(new URL(path, root), 'utf8');
const manifest = JSON.parse(read('openclaw.plugin.json'));
const pkg = JSON.parse(read('package.json'));
// The single SDK pin at the repository root (release/sdk-candidate.json).
const sdkPin = JSON.parse(
  readFileSync(new URL('../../../../release/sdk-candidate.json', import.meta.url), 'utf8'),
);
const sources = (readdirSync(new URL('src/', root), { recursive: true }) as string[])
  .filter((f) => f.endsWith('.ts'))
  .map((f) => read(`src/${f}`));

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe('manifest and runtime declarations agree', () => {
  it('declares exactly the registered tools, all optional, and the same config schema', async () => {
    expect(manifest.contracts.tools).toEqual(Object.keys(TOOL_PARAMETERS));
    for (const tool of manifest.contracts.tools)
      expect(manifest.toolMetadata[tool]).toEqual({ optional: true });
    expect(manifest.configSchema).toEqual(JSON.parse(JSON.stringify(CONFIG_JSON_SCHEMA)));
    const host = await registerPlugin();
    expect([...host.tools.keys()]).toEqual(manifest.contracts.tools);
    for (const factory of host.tools.values())
      expect((factory as unknown as { contextVersion: number }).contextVersion).toBe(2);
    expect(manifest.version).toBe(pkg.version);
    expect(pkg.openclaw.extensions).toEqual(['./dist/index.js']);
  });

  it('package boundary: exact SDK dependency, host as peer only, no lifecycle scripts', () => {
    expect(pkg.dependencies).toEqual({ [sdkPin.name]: sdkPin.version });
    expect(Object.keys(pkg.peerDependencies)).toEqual(['openclaw']);
    expect(pkg.peerDependencies.openclaw.split(' || ')).toContain(pkg.devDependencies.openclaw);
    for (const hook of [
      'preinstall',
      'install',
      'postinstall',
      'prepare',
      'prepack',
      'postpack',
      'prepublishOnly',
      'prepublish',
      'publish',
      'postpublish',
    ])
      expect(pkg.scripts[hook]).toBeUndefined();
  });
});

describe('no MCP server, routes, services or detached wake-up in this package', () => {
  it('declares and registers none of them', () => {
    expect(manifest.mcpServers).toBeUndefined();
    expect(Object.keys(pkg.dependencies)).not.toContain('@modelcontextprotocol/sdk');
    expect(Object.keys(pkg.dependencies).some((d) => /mcp/i.test(d))).toBe(false);
    for (const source of sources) {
      expect(source).not.toMatch(
        /registerHttpRoute|registerService|registerGatewayMethod|registerMcpServer|registerHook|enqueueSystemEvent|requestHeartbeat|subagent/,
      );
      expect(source).not.toMatch(/@sess\.si\/mcp|adapters\/mcp|@modelcontextprotocol/);
      expect(source).not.toMatch(/from ['"]openclaw\/(?!plugin-sdk\/plugin-entry['"])/);
      // The only lazily loaded host subpath is the public config reader used by `sess setup`.
      expect(source).not.toMatch(/import\(\s*['"]openclaw\/(?!plugin-sdk\/config-mutation['"])/);
      expect(source).not.toMatch(/@sess\/(core|spec|security|session-web|db)/);
    }
  });
});

describe('import and registration have no network, timer, state or secret side effects', () => {
  it('imports the entry and registers without fetch, timers, state or credential reads', async () => {
    vi.resetModules();
    const fetchSpy = vi.fn(() => Promise.reject(new Error('network is denied in this test')));
    vi.stubGlobal('fetch', fetchSpy);
    const timeout = vi.spyOn(globalThis, 'setTimeout');
    const interval = vi.spyOn(globalThis, 'setInterval');
    vi.stubEnv(API_KEY_ENV, API_KEY);
    const reads: string[] = [];
    const realEnv = process.env;
    process.env = new Proxy(realEnv, {
      get(target, key) {
        if (typeof key === 'string') reads.push(key);
        return Reflect.get(target, key);
      },
    });
    try {
      const host = await registerPlugin();
      expect(host.openCount).toBe(0);
      expect(host.store.writes).toBe(0);
      expect(host.tools.size).toBe(4);
      // Building the concrete tools for a catalog is also side-effect free.
      for (const factory of host.tools.values()) factory.create({});
    } finally {
      process.env = realEnv;
    }
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(reads).not.toContain(API_KEY_ENV);
    expect(timeout.mock.calls.filter((c) => String(c[0]).includes('sess'))).toHaveLength(0);
    expect(interval).not.toHaveBeenCalled();
  });

  it('doctor reports presence only, never the key, and makes no request', () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    const report = doctorReport(
      { apiKeyEnv: API_KEY_ENV },
      { openKeyedStore: () => undefined },
      { [API_KEY_ENV]: API_KEY },
    );
    expect(report).toContain(`API key source: ${API_KEY_ENV}, set in this CLI process`);
    expect(report).not.toContain(API_KEY);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe('owner-controlled origin and credentials', () => {
  it('defaults to the official origin and refuses non-HTTPS or test flags off loopback', () => {
    expect(parseConfig(undefined).baseUrl).toBe(DEFAULT_ORIGIN);
    expect(() => parseConfig({ baseUrl: 'http://api.sess.si' })).toThrow(/HTTPS/);
    expect(() => parseConfig({ baseUrl: 'http://localhost:18082' })).toThrow(/HTTPS/);
    expect(parseConfig({ baseUrl: 'http://localhost:18082', allowInsecureLocalhost: true }).baseUrl).toBe(
      'http://localhost:18082',
    );
    expect(() => parseConfig({ baseUrl: 'https://api.sess.si', allowInsecureLocalhost: true })).toThrow(
      /test-only/,
    );
    expect(() => parseConfig({ baseUrl: 'https://u:p@api.sess.si' })).toThrow(/origin/);
    expect(() => parseConfig({ apiKey: 'x' })).toThrow(/unsupported/);
  });

  it('reads only the configured environment variable and derives a non-secret scope identity', () => {
    const config = parseConfig({ apiKeyEnv: API_KEY_ENV });
    expect(() => resolveCredential(config, {})).toThrow(/CREDENTIAL_MISSING/);
    const credential = resolveCredential(config, { [API_KEY_ENV]: API_KEY });
    expect(credential.generation).toMatch(/^[0-9a-f]{32}$/);
    expect(credential.generation).not.toContain(API_KEY);
  });

  it('the guarded fetch refuses foreign origins and revoked authority before dispatch', async () => {
    const { guardFetch } = await import('../../src/client.js');
    const base = vi.fn(async () => new Response('{}'));
    let revoked = false;
    const lease = {
      binding: { agentId: 'a', sessionKey: 'k', sessionId: 's' },
      assertCurrent() {
        if (revoked) throw new Error('revoked');
      },
    };
    const guarded = guardFetch(DEFAULT_ORIGIN, lease, base as unknown as typeof fetch);
    await expect(guarded.fetch('https://evil.example/v1/sessions')).rejects.toThrow(/unapproved origin/);
    await guarded.fetch(`${DEFAULT_ORIGIN}/v1/sessions`, { redirect: 'follow' });
    expect(base).toHaveBeenCalledTimes(1);
    expect((base.mock.calls[0] as unknown as [string, RequestInit])[1].redirect).toBe('manual');
    revoked = true;
    await expect(guarded.fetch(`${DEFAULT_ORIGIN}/v1/sessions`)).rejects.toThrow(/revoked/);
    expect(base).toHaveBeenCalledTimes(1);
    expect(guarded.dispatched()).toBe(1);
    expect(guarded.refused()).toBe(true);
  });
});

describe('peer, engines and types metadata match qualification', () => {
  it('declares only the two declared hosts, the qualified Node floor and no TypeScript declarations', () => {
    expect(pkg.peerDependencies).toEqual({ openclaw: '2026.10.3 || 2026.10.7' });
    expect(pkg.devDependencies.openclaw).toBe('2026.10.3');
    expect(pkg.engines).toEqual({ node: '>=24.16.0 <25' });
    expect(pkg.types).toBeUndefined();
    expect(JSON.stringify(pkg.exports)).not.toMatch(/types|\.d\.ts/);
    expect(pkg.openclaw.compat.pluginApi).toBe('>=2026.10.3');
    expect(pkg.openclaw.install.minHostVersion).toBe('>=2026.10.3');
  });

  it('doctor flags any host version other than the two declared ones', () => {
    const header =
      /^Sess for OpenClaw .* \(qualified host: OpenClaw 2026\.10\.3; also supported: 2026\.10\.7\)$/m;
    const q3 = doctorReport({}, undefined, {}, '2026.10.3');
    expect(q3).toMatch(header);
    expect(q3).toMatch(/^host: OpenClaw 2026\.10\.3 \(qualified\)$/m);
    expect(q3).not.toMatch(/warning: host/);
    const q7 = doctorReport({}, undefined, {}, '2026.10.7');
    expect(q7).toMatch(/^host: OpenClaw 2026\.10\.7 \(supported; production qualification pending\)$/m);
    expect(q7).not.toMatch(/warning: host/);
    expect(q7).not.toMatch(/2026\.10\.7 \(qualified\)/);
    for (const other of ['2026.11.0', '2026.10.5', '2026.10.7-beta.1']) {
      expect(doctorReport({}, undefined, {}, other)).toMatch(
        new RegExp(
          `warning: host OpenClaw ${other.replace(/\./g, '\\.')} is not a supported version; only 2026\\.10\\.3 and 2026\\.10\\.7 have been tested`,
        ),
      );
    }
    expect([...QUALIFIED_HOST]).toEqual(['2026.10.3', '2026.10.7']);
  });

  it('records 2026.10.7 as a preview rehearsal of the agent-turn round trip, not qualification', () => {
    const compatibility = JSON.parse(read('compatibility.json'));
    expect(compatibility.host.version).toBe('2026.10.3');
    expect(compatibility.additionalHosts).toHaveLength(1);
    const [extra] = compatibility.additionalHosts;
    expect(extra).toMatchObject({ name: 'openclaw', version: '2026.10.7', build: '157d8c2' });
    expect(extra.integrity).toMatch(/^sha512-/);
    expect(extra.hostEngines).toBe('>=24.22.1 <25 || >=26.12.1');
    expect(extra.label).toBe('preview rehearsal, agent-turn round trip, adapter rc.4');
    expect(extra.status).toMatch(/^Not qualification\./);
    expect(extra.status).toMatch(/agent-turn round trip/);
    expect(extra.status).toMatch(/direct-invoke suite.*NOT run/);
    expect(extra.status).toMatch(/production host run.*upgrades this entry/);
    expect(extra.qualification).toBeUndefined();
    expect(extra.previewRun).toMatchObject({ date: '2026-10-27', result: 'passed' });
    expect(extra.previewRun.adapter).toMatch(/^@sess\.si\/openclaw@0\.1\.0-rc\.4 /);
    expect(extra.previewRun.target).toMatch(/Sess preview environment/);
    expect(extra.previewRun.node).toMatchObject({ version: '24.22.1' });
    expect(extra.previewRun.node.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(extra.previewRun.evidence).toMatch(/host-qualification-2026-10-27\/preview-1b645b97/);
    expect(compatibility.host.evidenceEnvironment).toMatch(
      /isolated local Sess runtime.*no production run yet/,
    );
    expect(compatibility.host.peerDeclaration).toMatch(
      /^peerDependencies\.openclaw = 2026\.10\.3 \|\| 2026\.10\.7 /,
    );
  });
});
