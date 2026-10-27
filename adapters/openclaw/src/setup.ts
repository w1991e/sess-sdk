import { DEFAULT_API_KEY_ENV, parseConfig } from './config.js';
import { SessAdapterError, fail } from './errors.js';

export const TOOL_NAMES = ['sess_request', 'sess_response', 'sess_publish', 'sess_complete'] as const;
export const PLUGIN_KEY = 'sess';
export const RESTART_COMMAND = 'openclaw gateway restart';

/** Owner choices for `openclaw sess setup`. The API key itself is never an input. */
export interface SetupOptions {
  baseUrl?: string;
  apiKeyEnv?: string;
  waitBudgetMs?: number;
}

export interface SetupChange {
  readonly path: string;
  readonly from: unknown;
  readonly to: unknown;
}

export interface SetupPlan {
  readonly changes: readonly SetupChange[];
  readonly warnings: readonly string[];
  readonly apiKeyEnv: string;
}

type Json = Record<string, unknown>;
const isObject = (value: unknown): value is Json =>
  !!value && typeof value === 'object' && !Array.isArray(value);

/** A value that looks like a credential must never be written to config or passed as an option. */
const SECRET_LIKE = /sess_(?:sk|mg|tk|mk)_|^eyJ|-----BEGIN|^(?=.*[a-z])(?=.*[0-9])[A-Za-z0-9_-]{24,}$/;

/**
 * Computes the additive change set. Only these paths can change:
 * plugins.entries.sess.enabled, plugins.entries.sess.config.{baseUrl,apiKeyEnv,waitBudgetMs} and
 * missing entries appended to tools.alsoAllow. Everything else, including secret references and
 * existing alsoAllow entries, is left exactly as it is.
 */
export function planSetup(current: unknown, options: SetupOptions): SetupPlan {
  for (const value of Object.values(options))
    if (typeof value === 'string' && SECRET_LIKE.test(value))
      fail(
        'CONFIGURATION',
        'Setup never accepts a credential value. Put the API key in the Gateway environment and pass only its variable name.',
      );
  const root = isObject(current) ? current : {};
  const entry = isObject((root.plugins as Json | undefined)?.entries)
    ? ((root.plugins as Json).entries as Json)[PLUGIN_KEY]
    : undefined;
  const existingConfig = isObject(entry) && isObject(entry.config) ? entry.config : {};
  const desiredConfig: Json = { ...existingConfig };
  if (options.baseUrl !== undefined) desiredConfig.baseUrl = options.baseUrl;
  if (options.waitBudgetMs !== undefined) desiredConfig.waitBudgetMs = options.waitBudgetMs;
  desiredConfig.apiKeyEnv = options.apiKeyEnv ?? existingConfig.apiKeyEnv ?? DEFAULT_API_KEY_ENV;
  // Strict validation of the resulting plugin config before anything is shown or written.
  const parsed = parseConfig(desiredConfig);
  const changes: SetupChange[] = [];
  if (!isObject(entry) || entry.enabled !== true)
    changes.push({
      path: `plugins.entries.${PLUGIN_KEY}.enabled`,
      from: isObject(entry) ? entry.enabled : undefined,
      to: true,
    });
  for (const key of ['baseUrl', 'apiKeyEnv', 'waitBudgetMs'] as const)
    if (desiredConfig[key] !== undefined && desiredConfig[key] !== existingConfig[key])
      changes.push({
        path: `plugins.entries.${PLUGIN_KEY}.config.${key}`,
        from: existingConfig[key],
        to: desiredConfig[key],
      });
  const tools = isObject(root.tools) ? root.tools : {};
  const alsoAllow = Array.isArray(tools.alsoAllow) ? tools.alsoAllow : [];
  const missing = TOOL_NAMES.filter((name) => !alsoAllow.includes(name));
  if (missing.length)
    changes.push({ path: 'tools.alsoAllow', from: [...alsoAllow], to: [...alsoAllow, ...missing] });
  const warnings: string[] = [];
  if (Array.isArray(tools.allow) && TOOL_NAMES.some((name) => !(tools.allow as unknown[]).includes(name)))
    warnings.push(
      'tools.allow is a restrictive allowlist and does not list all Sess tools; setup leaves it unchanged. Add them there yourself only if you intend to keep that restrictive mode.',
    );
  const pluginsAllow = isObject(root.plugins) ? (root.plugins as Json).allow : undefined;
  if (Array.isArray(pluginsAllow) && !pluginsAllow.includes(PLUGIN_KEY))
    warnings.push(
      'plugins.allow does not list "sess"; setup leaves it unchanged, so the plugin will not load until you add it.',
    );
  return { changes, warnings, apiKeyEnv: parsed.apiKeyEnv };
}

/** Applies a plan's paths to a mutable config draft (the host's file snapshot), additively. */
export function applySetup(draft: Json, plan: SetupPlan): void {
  for (const change of plan.changes) {
    const segments = change.path.split('.');
    let node: Json = draft;
    for (const segment of segments.slice(0, -1)) {
      if (!isObject(node[segment])) node[segment] = {};
      node = node[segment] as Json;
    }
    const leaf = segments.at(-1)!;
    if (change.path === 'tools.alsoAllow') {
      // Re-read the draft so entries added concurrently are kept; only append what is missing.
      const current = Array.isArray(node.alsoAllow) ? (node.alsoAllow as unknown[]) : [];
      node.alsoAllow = [...current, ...TOOL_NAMES.filter((name) => !current.includes(name))];
    } else node[leaf] = change.to;
  }
}

const show = (value: unknown) => (value === undefined ? '(unset)' : JSON.stringify(value));

/** Human-readable preview; contains no secret (only the variable name). */
export function formatPlan(
  plan: SetupPlan,
  env: Readonly<Record<string, string | undefined>>,
  applied: boolean,
): string {
  const lines = [
    applied ? 'Sess setup applied:' : 'Sess setup preview (nothing written; rerun with --yes to apply):',
  ];
  if (!plan.changes.length) lines.push('  no changes needed (already configured)');
  for (const change of plan.changes)
    lines.push(`  ${change.path}: ${show(change.from)} -> ${show(change.to)}`);
  for (const warning of plan.warnings) lines.push(`warning: ${warning}`);
  const present = typeof env[plan.apiKeyEnv] === 'string' && env[plan.apiKeyEnv]!.length > 0;
  lines.push(
    `API key source: ${plan.apiKeyEnv} in the Gateway's own environment (for example $OPENCLAW_STATE_DIR/.env or the service definition). Setup never stores the key.`,
    present
      ? `  ${plan.apiKeyEnv} is set in this terminal; the running Gateway must also have it in its own environment.`
      : `  ${plan.apiKeyEnv} is not set in this terminal; the running Gateway needs it in its own environment.`,
  );
  if (applied && plan.changes.length)
    lines.push(`The Gateway was not restarted. When ready, run: ${RESTART_COMMAND}`);
  return lines.join('\n');
}

export function parseSetupOptions(raw: {
  baseUrl?: string;
  apiKeyEnv?: string;
  waitBudgetMs?: string;
}): SetupOptions {
  const options: SetupOptions = {};
  if (raw.baseUrl !== undefined) options.baseUrl = raw.baseUrl;
  if (raw.apiKeyEnv !== undefined) options.apiKeyEnv = raw.apiKeyEnv;
  if (raw.waitBudgetMs !== undefined) {
    const value = Number(raw.waitBudgetMs);
    if (!Number.isSafeInteger(value))
      throw new SessAdapterError('CONFIGURATION', 'waitBudgetMs must be an integer.');
    options.waitBudgetMs = value;
  }
  return options;
}
