// `openclaw sess setup`: consent-driven, additive, never stores a credential, never restarts.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { applySetup, formatPlan, planSetup, RESTART_COMMAND, TOOL_NAMES } from '../../src/setup.js';
import { registerPlugin } from './harness.js';

afterEach(() => {
  vi.restoreAllMocks();
});

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
    expect(text).toMatch(/not inherited by an already-running Gateway service/);
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

  it('has no option that accepts a key value', async () => {
    const host = await registerPlugin();
    const { options } = cli(host, {});
    for (const flags of options.values())
      for (const flag of flags) expect(flag).not.toMatch(/key(?!-env)|secret|token/i);
  });
});
