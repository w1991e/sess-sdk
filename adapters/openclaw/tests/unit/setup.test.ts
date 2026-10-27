// `openclaw sess setup`: consent-driven, additive, never stores a credential, never restarts.
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { redactSensitiveText } from 'openclaw/plugin-sdk/security-runtime';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { doctorReport, toolsLine } from '../../src/doctor.js';
import { applySetup, formatPlan, planSetup, RESTART_COMMAND, TOOL_NAMES } from '../../src/setup.js';
import { registerPlugin } from './harness.js';

const temps: string[] = [];
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  for (const dir of temps.splice(0)) rmSync(dir, { recursive: true, force: true });
});

/**
 * Writes an authored config file for the host's real `readConfigFileSnapshotForWrite` (public
 * openclaw/plugin-sdk/config-mutation) and points the host at it through its documented env.
 */
function authored(config: unknown) {
  const dir = mkdtempSync(join(tmpdir(), 'sess-setup-authored-'));
  temps.push(dir);
  writeFileSync(join(dir, 'openclaw.json'), JSON.stringify(config, null, 2));
  vi.stubEnv('OPENCLAW_STATE_DIR', dir);
  vi.stubEnv('OPENCLAW_CONFIG_PATH', join(dir, 'openclaw.json'));
}

/** A realistic config with unrelated settings, a SecretRef and existing allow entries. */
function existingConfig() {
  return {
    gateway: {
      port: 18789,
      auth: { mode: 'token', token: { source: 'env', provider: 'default', id: 'GW_TOKEN' } },
    },
    models: {
      providers: { openai: { apiKey: { source: 'env', provider: 'default', id: 'OPENAI_API_KEY' } } },
    },
    plugins: { entries: { other: { enabled: true, config: { x: 1 } } } },
    tools: { alsoAllow: ['lobster', 'sess_request'], deny: ['exec'] },
    agents: { entries: { main: { tools: { alsoAllow: ['llm-task'] } } } },
  };
}

describe('planSetup / applySetup', () => {
  it('previews only additive changes and preserves unrelated config, secret references and alsoAllow', () => {
    const before = existingConfig();
    const plan = planSetup(before, {});
    expect(plan.changes.map((c) => c.path)).toEqual([
      'plugins.entries.sess.enabled',
      'plugins.entries.sess.config.apiKeyEnv',
      'tools.alsoAllow',
    ]);
    const draft = structuredClone(before);
    applySetup(draft, plan);
    expect(draft.tools.alsoAllow).toEqual([
      'lobster',
      'sess_request',
      'sess_response',
      'sess_publish',
      'sess_complete',
    ]);
    expect(draft.plugins.entries).toMatchObject({
      other: { enabled: true, config: { x: 1 } },
      sess: { enabled: true, config: { apiKeyEnv: 'SESS_API_KEY' } },
    });
    // Everything else is byte-identical, including secret references.
    const { plugins: _p, tools: _t, ...restAfter } = draft;
    const { plugins: _p2, tools: _t2, ...restBefore } = before;
    expect(JSON.stringify(restAfter)).toBe(JSON.stringify(restBefore));
    expect(draft.tools.deny).toEqual(['exec']);
  });

  it('is idempotent: a re-run after applying has no changes', () => {
    const draft = existingConfig();
    applySetup(draft, planSetup(draft, { baseUrl: 'https://api.sess.si', waitBudgetMs: 30000 }));
    const again = planSetup(draft, { baseUrl: 'https://api.sess.si', waitBudgetMs: 30000 });
    expect(again.changes).toEqual([]);
    expect(formatPlan(again, {}, false)).toMatch(/no changes needed/);
  });

  it('keeps alsoAllow entries added concurrently on the host snapshot', () => {
    const plan = planSetup({}, {});
    const draft = { tools: { alsoAllow: ['added-meanwhile'] } } as Record<string, unknown>;
    applySetup(draft, plan);
    expect((draft.tools as { alsoAllow: string[] }).alsoAllow).toEqual(['added-meanwhile', ...TOOL_NAMES]);
  });

  it('refuses plaintext credentials and invalid config before anything is written', () => {
    for (const value of ['sess_sk_' + 'a'.repeat(40), 'eyJhbGciOiJ', 'abcDEF123456ghiJKL789012mnoPQR'])
      expect(() => planSetup({}, { apiKeyEnv: value })).toThrow(/never accepts a credential|CONFIGURATION/);
    expect(() => planSetup({}, { baseUrl: 'http://example.com' })).toThrow(/HTTPS/);
    expect(() => planSetup({}, { apiKeyEnv: 'lowercase' })).toThrow(/environment variable/);
    expect(planSetup({}, { apiKeyEnv: 'SESS_API_KEY_FOR_PRODUCTION_GATEWAY_ONE' }).apiKeyEnv).toBe(
      'SESS_API_KEY_FOR_PRODUCTION_GATEWAY_ONE',
    );
  });

  it('warns about restrictive allowlists without touching them', () => {
    const plan = planSetup({ tools: { allow: ['read'] }, plugins: { allow: ['other'] } }, {});
    expect(plan.changes.map((c) => c.path)).not.toContain('tools.allow');
    expect(plan.warnings.join('\n')).toMatch(/tools\.allow .*unchanged/);
    expect(plan.warnings.join('\n')).toMatch(/plugins\.allow .*"sess"/);
  });

  it('explains shell versus Gateway environment and never prints a key value', () => {
    const text = formatPlan(planSetup({}, {}), { SESS_API_KEY: 'test-owner-credential' }, true);
    // Founder 2026-10-27 06:05Z: the terminal line matches doctor's wording.
    expect(text).toContain(
      '  SESS_API_KEY is set in this terminal; the running Gateway must also have it in its own environment.',
    );
    expect(formatPlan(planSetup({}, {}), {}, true)).toContain(
      '  SESS_API_KEY is not set in this terminal; the running Gateway needs it in its own environment.',
    );
    expect(text).toContain(RESTART_COMMAND);
    expect(text).not.toContain('test-owner-credential');
  });
});

describe('CLI wiring', () => {
  function cli(host: Awaited<ReturnType<typeof registerPlugin>>, config: unknown) {
    const actions = new Map<string, (opts: Record<string, unknown>) => Promise<void>>();
    const options = new Map<string, string[]>();
    const command = (name: string): unknown => {
      const self = {
        command,
        description: () => self,
        option: (flag: string) => (options.set(name, [...(options.get(name) ?? []), flag]), self),
        requiredOption: (flag: string) => (options.set(name, [...(options.get(name) ?? []), flag]), self),
        action: (fn: (opts: Record<string, unknown>) => Promise<void>) => (actions.set(name, fn), self),
      };
      return self;
    };
    host.cli[0]!.registrar({ program: { command }, config });
    return { actions, options };
  }

  it('previews by default, applies only with --yes, with afterWrite none (no restart)', async () => {
    const mutate = vi.fn(async (params: { afterWrite: unknown; mutate: (draft: unknown) => void }) => {
      params.mutate(draft);
      return {};
    });
    const draft = existingConfig();
    authored(existingConfig());
    const host = await registerPlugin(undefined, undefined, { config: { mutateConfigFile: mutate } });
    const { actions, options } = cli(host, existingConfig());
    expect(options.get('setup')).toEqual([
      '--base-url <origin>',
      '--api-key-env <NAME>',
      '--wait-budget-ms <ms>',
      '--yes',
    ]);
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    await actions.get('setup')!({});
    expect(mutate).not.toHaveBeenCalled();
    expect(String(log.mock.calls.at(-1)?.[0])).toMatch(/preview \(nothing written/);
    await actions.get('setup')!({ yes: true });
    expect(mutate).toHaveBeenCalledTimes(1);
    expect(mutate.mock.calls[0]![0].afterWrite).toMatchObject({ mode: 'none' });
    expect(draft.tools.alsoAllow).toEqual([
      'lobster',
      'sess_request',
      'sess_response',
      'sess_publish',
      'sess_complete',
    ]);
    expect(String(log.mock.calls.at(-1)?.[0])).toContain(RESTART_COMMAND);
  });

  it('previews from the authored file, not the CLI runtime view (enabled unset but reported enabled)', async () => {
    // Authored: plugin installed but `enabled` unset. Runtime view: reports enabled and all tools.
    const file = { tools: { alsoAllow: ['lobster'] }, plugins: { entries: { sess: { config: {} } } } };
    authored(file);
    const runtimeView = {
      tools: { alsoAllow: ['lobster', 'sess_request', 'sess_response', 'sess_publish', 'sess_complete'] },
      plugins: { entries: { sess: { enabled: true, config: { apiKeyEnv: 'SESS_API_KEY' } } } },
    };
    const draft = structuredClone(file) as Record<string, any>;
    const mutate = vi.fn(async (params: { mutate: (d: unknown) => void }) => (params.mutate(draft), {}));
    const host = await registerPlugin(undefined, undefined, { config: { mutateConfigFile: mutate } });
    const { actions } = cli(host, runtimeView);
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    await actions.get('setup')!({});
    const preview = String(log.mock.calls.at(-1)?.[0]);
    expect(preview).toContain('plugins.entries.sess.enabled: (unset) -> true');
    expect(preview).toContain('tools.alsoAllow');
    await actions.get('setup')!({ yes: true });
    const applied = String(log.mock.calls.at(-1)?.[0]);
    // --yes applies exactly the previewed change lines.
    const lines = (text: string) =>
      text.split('\n').filter((l) => l.startsWith('  plugins.') || l.startsWith('  tools.'));
    expect(lines(applied)).toEqual(lines(preview));
    expect(draft.plugins.entries.sess.enabled).toBe(true);
  });

  it('refuses to write when the host snapshot no longer matches the preview', async () => {
    authored({ plugins: { entries: { sess: { config: {} } } } });
    // Between preview and apply someone else enabled the plugin and added the tools.
    const draft = {
      plugins: { entries: { sess: { enabled: true, config: { apiKeyEnv: 'SESS_API_KEY' } } } },
      tools: { alsoAllow: ['sess_request', 'sess_response', 'sess_publish', 'sess_complete'] },
    };
    const before = JSON.stringify(draft);
    const mutate = vi.fn(async (params: { mutate: (d: unknown) => void }) => (params.mutate(draft), {}));
    const host = await registerPlugin(undefined, undefined, { config: { mutateConfigFile: mutate } });
    const { actions } = cli(host, {});
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    await expect(actions.get('setup')!({ yes: true })).rejects.toThrow(
      /^STATE_CONFLICT: .*since the preview/,
    );
    expect(JSON.stringify(draft)).toBe(before);
  });

  it('doctor reads the tools from the authored file that setup writes', async () => {
    authored({ tools: { alsoAllow: ['lobster', ...TOOL_NAMES] } });
    const host = await registerPlugin();
    // The CLI runtime view lists none; the authored file wins.
    const { actions } = cli(host, { tools: {} });
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    await actions.get('doctor')!({});
    const report = String(log.mock.calls[0]?.[0]);
    expect(report).toContain('tools: allowed (sess_request, sess_response, sess_publish, sess_complete)');
    expect(report).not.toMatch(/tools: optional/);
  });

  it('has no option that accepts a key value', async () => {
    const host = await registerPlugin();
    const { options } = cli(host, {});
    for (const flags of options.values())
      for (const flag of flags) expect(flag).not.toMatch(/key(?!-env)|secret|token/i);
  });
});

describe('doctor tools line', () => {
  const all = 'tools: allowed (sess_request, sess_response, sess_publish, sess_complete)';

  it('reports all four as allowed after setup has added them', () => {
    const draft: Record<string, unknown> = { tools: { alsoAllow: ['lobster'] } };
    applySetup(draft, planSetup(draft, {}));
    expect(toolsLine(draft)).toBe(all);
    expect(doctorReport({}, undefined, {}, undefined, draft)).toContain(all);
    // A restrictive tools.allow that lists them also allows them.
    expect(toolsLine({ tools: { allow: ['read', ...TOOL_NAMES] } })).toBe(all);
  });

  it('asks to add all four only when none is allowed', () => {
    const expected =
      'tools: optional and not yet allowed; add sess_request, sess_response, sess_publish, sess_complete to tools.alsoAllow (keep any existing entries; do not replace tools.allow), or preview with: openclaw sess setup';
    for (const config of [{}, { tools: {} }, { tools: { alsoAllow: ['lobster'] } }, null])
      expect(toolsLine(config)).toBe(expected);
  });

  it('lists the allowed and the missing ones when only some are allowed', () => {
    expect(toolsLine({ tools: { alsoAllow: ['sess_request'], allow: ['sess_complete'] } })).toBe(
      'tools: sess_request, sess_complete allowed; add sess_response, sess_publish to tools.alsoAllow (keep any existing entries; do not replace tools.allow), or preview with: openclaw sess setup',
    );
  });

  it('says it did not check when the config could not be read', () => {
    expect(toolsLine(undefined)).toBe(
      'tools: not checked (the config could not be read); to allow them, run: openclaw sess setup',
    );
  });
});

describe("host log redaction (OpenClaw's redactSensitiveText)", () => {
  it('masks nothing in the doctor report or the setup preview, and no line starts with a secret label', () => {
    const env = { SESS_API_KEY: 'test-owner-credential' };
    const outputs = [
      doctorReport({}, { openKeyedStore: () => undefined }, env, '2026.10.3', {}),
      doctorReport({}, undefined, {}, '2026.10.3', { tools: { alsoAllow: [...TOOL_NAMES] } }),
      formatPlan(planSetup({}, {}), env, false),
      formatPlan(planSetup({}, {}), {}, true),
    ];
    for (const text of outputs) {
      expect(text).not.toContain('test-owner-credential');
      for (const line of text.split('\n')) {
        expect(redactSensitiveText(line)).toBe(line);
        expect(line.trimStart()).not.toMatch(/^(credential|key|token|secret|password)\b/i);
      }
    }
    const keyLine = (text: string) => text.split('\n').filter((line) => line.startsWith('API key source:'));
    expect(keyLine(outputs[0]!)).toEqual([
      'API key source: SESS_API_KEY, set in this CLI process (the running Gateway must also have it)',
    ]);
    expect(keyLine(outputs[1]!)).toEqual([
      'API key source: SESS_API_KEY is not set in this CLI process; the running Gateway needs it in its own environment.',
    ]);
    expect(outputs[2]).toContain(
      "API key source: SESS_API_KEY in the Gateway's own environment (for example $OPENCLAW_STATE_DIR/.env or the service definition). Setup never stores the key.",
    );
    // The old wording is what the host masked.
    expect(redactSensitiveText('credential: SESS_API_KEY is set')).toContain('***');
  });
});
