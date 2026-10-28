import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { loadConfig } from '../src/config.js';
import { AdapterError, redact, stderrDiagnostics } from '../src/errors.js';
import { VERSION } from '../src/version.js';

const base = { SESS_API_KEY: 'synthetic-owner-key-one', SESS_MCP_STATE_DIR: '/tmp/sess-mcp-config-test' };
function notConfigured(env: NodeJS.ProcessEnv): string {
  try {
    loadConfig(env);
  } catch (error) {
    expect(error).toBeInstanceOf(AdapterError);
    expect((error as AdapterError).code).toBe('NOT_CONFIGURED');
    return (error as AdapterError).message;
  }
  throw new Error('expected NOT_CONFIGURED');
}

describe('owner-controlled configuration', () => {
  it('defaults to the official HTTPS origin and a bounded 45 s wait', () => {
    const config = loadConfig(base);
    expect(config.origin).toBe('https://api.sess.si');
    expect(config.maxWaitMs).toBe(45_000);
    expect(config.profile).toBe('default');
    expect(config.allowInsecureLocalhost).toBe(false);
  });

  it('requires a key from the environment and never echoes it', () => {
    expect(notConfigured({ SESS_MCP_STATE_DIR: '/tmp/x' })).toContain('SESS_API_KEY');
    expect(notConfigured({ ...base, SESS_API_KEY: 'has space' })).not.toContain('has space');
  });

  it('accepts alternative origins only over HTTPS; localhost HTTP only behind the test flag', () => {
    expect(loadConfig({ ...base, SESS_API_ORIGIN: 'https://api.example.test' }).origin).toBe(
      'https://api.example.test',
    );
    notConfigured({ ...base, SESS_API_ORIGIN: 'http://localhost:18081' });
    notConfigured({
      ...base,
      SESS_API_ORIGIN: 'http://api.example.test',
      SESS_MCP_TEST_ALLOW_INSECURE_LOCALHOST: '1',
    });
    notConfigured({ ...base, SESS_API_ORIGIN: 'https://api.example.test/v1' });
    notConfigured({ ...base, SESS_API_ORIGIN: 'https://user:pw@api.example.test' });
    notConfigured({ ...base, SESS_MCP_TEST_ALLOW_INSECURE_LOCALHOST: 'yes' });
    const local = loadConfig({
      ...base,
      SESS_API_ORIGIN: 'http://127.0.0.1:18081',
      SESS_MCP_TEST_ALLOW_INSECURE_LOCALHOST: '1',
    });
    expect(local.origin).toBe('http://127.0.0.1:18081');
    expect(local.allowInsecureLocalhost).toBe(true);
  });

  it('validates profile, state directory and wait ceiling', () => {
    notConfigured({ ...base, SESS_MCP_PROFILE: '../escape' });
    notConfigured({ ...base, SESS_MCP_STATE_DIR: 'relative/dir' });
    notConfigured({ ...base, SESS_MCP_MAX_WAIT_MS: '45001' });
    expect(loadConfig({ ...base, SESS_MCP_MAX_WAIT_MS: '10000' }).maxWaitMs).toBe(10_000);
  });

  it('keeps the package version in sync', () => {
    const manifest = JSON.parse(readFileSync(join(import.meta.dirname, '..', 'package.json'), 'utf8'));
    const compatibility = JSON.parse(
      readFileSync(join(import.meta.dirname, '..', 'compatibility.json'), 'utf8'),
    );
    expect(VERSION).toBe(manifest.version);
    expect(compatibility.package.version).toBe(manifest.version);
    expect(manifest.dependencies['@sess.si/sdk']).toBe(compatibility.sessSdk.version);
    expect(manifest.dependencies[compatibility.mcpLibrary.name]).toBe(compatibility.mcpLibrary.version);
    expect(manifest.dependencies[compatibility.mcpLibrary.node.name]).toBe(
      compatibility.mcpLibrary.node.version,
    );
    // The 1.x library is a test-only client now; it must never return as a runtime dependency.
    expect(manifest.dependencies['@modelcontextprotocol/sdk']).toBeUndefined();
    const lock = JSON.parse(readFileSync(join(import.meta.dirname, '..', 'package-lock.json'), 'utf8'));
    for (const pkg of [
      compatibility.mcpLibrary,
      compatibility.mcpLibrary.node,
      ...compatibility.mcpLibrary.transitive,
    ]) {
      const entry = lock.packages[`node_modules/${pkg.name}`];
      expect(entry.version).toBe(pkg.version);
      expect(entry.integrity).toBe(pkg.integrity);
      expect(entry.dev).toBeUndefined();
    }
  });
});

describe('diagnostic redaction', () => {
  const token = 'Q'.repeat(43);
  const url = `https://app.sess.test/s/${token}`;
  it('removes URLs, capability paths, bare tokens and configured secrets', () => {
    const out = redact(`link ${url} path /s/${token} bare ${token} key synthetic-owner-key-one Bearer abc`, [
      'synthetic-owner-key-one',
    ]);
    expect(out).not.toContain(token);
    expect(out).not.toContain('app.sess.test');
    expect(out).not.toContain('synthetic-owner-key-one');
    expect(out).not.toContain('Bearer abc');
  });
  it('stderr diagnostics are redacted line by line', () => {
    const lines: string[] = [];
    const diagnostics = stderrDiagnostics(
      (line) => lines.push(line),
      () => ['synthetic-owner-key-one', url],
    );
    diagnostics('tool_error', { code: 'X', leaked: url, key: 'synthetic-owner-key-one' });
    expect(lines.join('')).not.toMatch(/QQQQ|synthetic-owner|app\.sess\.test/);
    expect(lines.join('')).toMatch(/^sess-mcp: tool_error code=X/);
  });

  // Short human links (sess.si/n/{22}, 128 bits) are bearer capabilities like /s/{43}.
  const short = 'Zq3-x_9Kp0LmN4rTv7Wy2a';
  const shortUrl = `https://sess.si/n/${short}`;
  it('removes short-link URLs, /n/ paths and bare 22-character tokens', () => {
    expect(short).toHaveLength(22);
    const out = redact(`link ${shortUrl} path /n/${short}?x=1 bare ${short}. quoted "${short}" (${short})`);
    expect(out).not.toContain(short);
    expect(out).not.toContain('/n/');
    expect(out).not.toContain('sess.si');
    expect(out).toContain('[capability-path]');
    expect(out.match(/\[token\]/g)).toHaveLength(3);
  });
  it('stderr diagnostics redact short links without a configured secret', () => {
    const lines: string[] = [];
    stderrDiagnostics(
      (line) => lines.push(line),
      () => [],
    )('tool_error', { code: 'X', leaked: shortUrl, path: `/n/${short}`, bare: short });
    expect(lines.join('')).not.toContain(short);
    expect(lines.join('')).toMatch(/^sess-mcp: tool_error code=X /);
  });
  it('keeps the adapter’s own 22-character identifiers, codes and event names', () => {
    const handle = `sh_${short}`;
    const generation = `cg1_${short}`;
    const text = [
      `handle=${handle}`,
      `file=${handle}.json`,
      `generation=${generation}`,
      'code=CREATE_OUTCOME_UNKNOWN',
      'code=transport/RESPONSE_LIMIT_REACHED',
      'http_protocol_rejected',
    ].join(' ');
    expect(redact(text)).toBe(text);
  });
  it('a 22-character run inside a longer token-character run is not a short link', () => {
    for (const run of [`${short}A`, `A${short}`, `-${short}`, `${short}_`]) expect(redact(run)).toBe(run);
  });
  it('mixed-case or digit-bearing 22-character runs are redacted even with underscores', () => {
    for (const run of ['Create_Outcome_Unknown', 'CREATE_OUTCOME_UNKNOW1', 'create-outcome-unknown'])
      expect(redact(`v ${run} v`)).toBe('v [token] v');
  });
});
