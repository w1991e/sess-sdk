import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { loadConfig } from '../src/config.js';
import {
  AdapterError,
  BLOCK_REASONS,
  SESS_ERROR_CODES,
  SESS_ERROR_KINDS,
  isKnownCode,
  redact,
  stderrDiagnostics,
} from '../src/errors.js';
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
  // ASTRA-807-01: a canonical 16-byte base64url token can be one letter case, and a token glued to
  // other token characters is a longer run. Free text keeps no run of 22 or more for its shape.
  const canonical = 'abcdefghijklmnopqrstug';
  it('redacts a canonical single-case short-link token', () => {
    expect(canonical).toHaveLength(22);
    expect(Buffer.from(canonical, 'base64url')).toHaveLength(16);
    expect(Buffer.from(canonical, 'base64url').toString('base64url')).toBe(canonical);
    for (const token of [canonical, canonical.toUpperCase(), short])
      expect(redact(`v ${token} v`)).toBe('v [token] v');
  });
  it('redacts a token glued to 1 to 20 token characters on either side', () => {
    for (let n = 1; n <= 20; n++) {
      for (const pad of ['A', 'z', '9', '_', '-']) {
        const glue = pad.repeat(n);
        for (const run of [`${glue}${canonical}`, `${canonical}${glue}`, `${glue}${canonical}${glue}`])
          expect(redact(`v ${run}.`)).toBe('v [token].');
      }
    }
  });
  it('redacts every run of 22 or more token characters in free text, codes and handles included', () => {
    // Previously kept by shape (single-case snake case, or a sh_/cg1_ prefix); now withheld in free
    // text. Codes and event names survive only as structured diagnostic values.
    for (const run of [
      'Create_Outcome_Unknown',
      'CREATE_OUTCOME_UNKNOWN',
      'http_protocol_rejected',
      `sh_${short}`,
      `cg1_${short}`,
    ])
      expect(redact(`v ${run} v`)).toBe('v [token] v');
    expect(redact(`file=sh_${short}.json code=transport/RESPONSE_LIMIT_REACHED`)).toBe(
      'file=[token].json code=transport/[token]',
    );
  });
  it('does not redact ordinary text or runs shorter than 22', () => {
    const text = [
      'The Sess MCP server hit an unexpected error.',
      'tool=sess_response code=INVALID_STATE revision=3 remoteRevision=4',
      `run=${canonical.slice(0, 21)} pair=${canonical.slice(0, 11)}.${canonical.slice(11)}`,
      'Call sess_response for the current revision.',
    ].join(' ');
    expect(redact(text)).toBe(text);
  });
  it('stderr diagnostics keep listed event names and exactly known codes as structured values', () => {
    const lines: string[] = [];
    const diagnostics = stderrDiagnostics(
      (line) => lines.push(line),
      () => [],
    );
    diagnostics('verification_not_configured', { code: 'transport/RESPONSE_LIMIT_REACHED' });
    diagnostics('http_protocol_rejected');
    diagnostics('blocked', { reason: 'CLOSED_WITHOUT_RESPONSE' });
    diagnostics('tool_error', { tool: 'sess_request', code: 'CREATE_OUTCOME_UNKNOWN' });
    diagnostics('create_rejected', { code: 'api/WEBHOOK_VERIFICATION_FAILED' });
    expect(lines).toEqual([
      'sess-mcp: verification_not_configured code=transport/RESPONSE_LIMIT_REACHED\n',
      'sess-mcp: http_protocol_rejected\n',
      'sess-mcp: blocked reason=CLOSED_WITHOUT_RESPONSE\n',
      'sess-mcp: tool_error tool=sess_request code=CREATE_OUTCOME_UNKNOWN\n',
      'sess-mcp: create_rejected code=api/WEBHOOK_VERIFICATION_FAILED\n',
    ]);
  });
  it('stderr diagnostics redact token-shaped values that are not exactly a known code', () => {
    const lines: string[] = [];
    const diagnostics = stderrDiagnostics(
      (line) => lines.push(line),
      () => [],
    );
    const upper = canonical.toUpperCase();
    diagnostics('blocked', { reason: upper });
    diagnostics('create_rejected', { code: `api/${upper}` });
    diagnostics('create_rejected', { code: 'evil/CREATE_OUTCOME_UNKNOWN' });
    diagnostics('create_rejected', { code: 'CREATE_OUTCOME_UNKNOWN_' });
    diagnostics('tool_error', { tool: `A${canonical}`, code: `${canonical}` });
    // A JavaScript caller can pass any event name; an unlisted one is redacted like free text.
    (diagnostics as (event: string) => void)(canonical);
    expect(lines).toEqual([
      'sess-mcp: blocked reason=[token]\n',
      'sess-mcp: create_rejected code=api/[token]\n',
      'sess-mcp: create_rejected code=evil/[token]\n',
      'sess-mcp: create_rejected code=[token]\n',
      'sess-mcp: tool_error tool=[token] code=[token]\n',
      'sess-mcp: [token]\n',
    ]);
  });
  it('the code allowlist is taken from the contract and SDK sources', () => {
    const root = join(import.meta.dirname, '..', '..', '..');
    const contract = JSON.parse(readFileSync(join(root, 'contract', 'openapi.json'), 'utf8'));
    const apiCodes: string[] = contract.components.schemas.Error.properties.error.properties.code.anyOf.map(
      (entry: { const: string }) => entry.const,
    );
    const sdkCodes = new Set<string>();
    for (const file of readdirSync(join(root, 'src'), { recursive: true, encoding: 'utf8' })) {
      if (!file.endsWith('.ts')) continue;
      const text = readFileSync(join(root, 'src', file), 'utf8');
      for (const [, code] of text.matchAll(/\bcode: '([A-Z][A-Z0-9_]*)'/g)) sdkCodes.add(code as string);
    }
    expect(apiCodes.length).toBeGreaterThan(20);
    expect(sdkCodes.size).toBeGreaterThan(5);
    expect([...SESS_ERROR_CODES].sort()).toEqual([...new Set([...apiCodes, ...sdkCodes])].sort());
    const sdkErrors = readFileSync(join(root, 'src', 'errors.ts'), 'utf8');
    const kinds = /export type SessErrorKind =([^;]*);/.exec(sdkErrors)?.[1] ?? '';
    expect([...SESS_ERROR_KINDS].sort()).toEqual([...kinds.matchAll(/'([a-z_]+)'/g)].map((m) => m[1]).sort());
    // Every literal block reason in operations.ts is listed (Sess codes reach #block as well).
    const operations = readFileSync(join(import.meta.dirname, '..', 'src', 'operations.ts'), 'utf8');
    const reasons = [
      ...operations.matchAll(/#block\(record, '([A-Z_]+)'/g),
      ...operations.matchAll(/kind: 'progress', reason: '([A-Z_]+)'/g),
      // `code ?? 'SDK_CONFIGURATION'` and `error.code ?? 'WAIT_ENDED'`; HTTP_<status> stays short.
      ...operations.matchAll(/\?\? '([A-Z_]+)'[);]/g),
    ].map((m) => m[1] as string);
    expect(reasons.length).toBeGreaterThan(5);
    for (const reason of reasons) expect(isKnownCode(reason), reason).toBe(true);
    expect(BLOCK_REASONS).toContain('LINK_EXPIRED'); // through the LINK_EXPIRED constant
  });
});
