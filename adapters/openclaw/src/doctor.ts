import { parseConfig } from './config.js';
import { SessAdapterError } from './errors.js';
import { TOOL_NAMES } from './setup.js';
import type { PruneReport, RetireReport, StateCounts } from './store.js';

export const PLUGIN_VERSION = '0.1.0-rc.5';
/**
 * Host versions declared in peerDependencies; doctor warns on any other. 2026.10.3 is qualified;
 * 2026.10.7 ran the agent-turn round trip on the preview and awaits production qualification.
 */
export const QUALIFIED_HOST: ReadonlySet<string> = new Set(['2026.10.3', '2026.10.7']);
const HOST_NOTE: Readonly<Record<string, string>> = {
  '2026.10.3': 'qualified',
  '2026.10.7': 'supported; production qualification pending',
};

/**
 * Which Sess tools the authored config allows, read where `openclaw sess setup` writes them
 * (`tools.alsoAllow`) and from a restrictive `tools.allow` that lists them. An `undefined` config
 * could not be read.
 */
export function toolsLine(rootConfig: unknown): string {
  if (rootConfig === undefined)
    return 'tools: not checked (the config could not be read); to allow them, run: openclaw sess setup';
  const tools = (rootConfig as { tools?: { alsoAllow?: unknown; allow?: unknown } } | null)?.tools;
  const listed: unknown[] = [tools?.alsoAllow, tools?.allow].flatMap((list) =>
    Array.isArray(list) ? list : [],
  );
  const allowed = TOOL_NAMES.filter((name) => listed.includes(name));
  const missing = TOOL_NAMES.filter((name) => !listed.includes(name));
  if (!missing.length) return `tools: allowed (${allowed.join(', ')})`;
  const add = `add ${missing.join(', ')} to tools.alsoAllow (keep any existing entries; do not replace tools.allow), or preview with: openclaw sess setup`;
  return allowed.length
    ? `tools: ${allowed.join(', ')} allowed; ${add}`
    : `tools: optional and not yet allowed; ${add}`;
}

/**
 * Plain-language, read-only diagnostics. No network request, no state opened, and no secret,
 * human link or response data printed: only whether the configured variable is present here.
 * No line starts with a label the host's log redaction masks (credential, token, secret,
 * password, api_key), so nothing here is shown as "***".
 */
export function doctorReport(
  rawConfig: unknown,
  state: unknown,
  env: Readonly<Record<string, string | undefined>>,
  hostVersion?: string,
  rootConfig?: unknown,
): string {
  const lines = [
    `Sess for OpenClaw ${PLUGIN_VERSION} (qualified host: OpenClaw 2026.10.3; also supported: 2026.10.7)`,
  ];
  if (typeof hostVersion === 'string')
    lines.push(
      QUALIFIED_HOST.has(hostVersion)
        ? `host: OpenClaw ${hostVersion} (${HOST_NOTE[hostVersion]})`
        : `warning: host OpenClaw ${hostVersion} is not a supported version; only 2026.10.3 and 2026.10.7 have been tested`,
    );
  try {
    const config = parseConfig(rawConfig);
    lines.push(`config: valid; Sess origin ${config.baseUrl}; wait budget ${config.waitBudgetMs} ms`);
    if (config.allowInsecureLocalhost) lines.push('warning: allowInsecureLocalhost is a test-only setting');
    const present = typeof env[config.apiKeyEnv] === 'string' && env[config.apiKeyEnv]!.length > 0;
    lines.push(
      present
        ? `API key source: ${config.apiKeyEnv}, set in this CLI process (the running Gateway must also have it)`
        : `API key source: ${config.apiKeyEnv} is not set in this CLI process; the running Gateway needs it in its own environment.`,
    );
  } catch (error) {
    lines.push(`config: invalid (${error instanceof SessAdapterError ? error.message : 'unreadable'})`);
  }
  const keyed = typeof (state as { openKeyedStore?: unknown } | undefined)?.openKeyedStore === 'function';
  lines.push(`durable plugin state: ${keyed ? 'available' : 'NOT available'}`);
  lines.push(toolsLine(rootConfig));
  lines.push('network: not contacted by doctor');
  return lines.join('\n');
}

const line = (label: string, counts: Record<string, number>) =>
  `${label}: ${
    Object.entries(counts)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `${k}=${v}`)
      .join(', ') || 'empty'
  }`;

/** Redacted state counts: kinds and states only. */
export function formatCounts(counts: StateCounts): string {
  return [
    line('active interactions (admission-limited)', counts.active),
    line('archive (terminal records and replay tombstones)', counts.archive),
    line('legacy layout', counts.legacy),
  ].join('\n');
}

export function formatPrune(report: PruneReport, applied: boolean): string {
  return applied
    ? `prune: compacted ${report.compacted} of ${report.eligible} terminal records (removed retained Sess links); conflicts ${report.conflicts}; replay tombstones untouched`
    : `prune (dry run): ${report.eligible} terminal records hold a retained Sess link; rerun with --apply to remove only those links`;
}

export function formatRetire(report: RetireReport, days: number, applied: boolean): string {
  const skipped = Object.entries(report.skippedByState)
    .map(([state, n]) => `${state}=${n}`)
    .join(', ');
  const head = applied
    ? `retire: retired ${report.retired} of ${report.eligible} interactions idle >= ${days} days (archived ${report.archived}); conflicts ${report.conflicts}`
    : `retire (dry run): ${report.eligible} waiting/needs_resume/answered interactions idle >= ${days} days; rerun with --apply to retire them`;
  return `${head}\nnever retired (pending or ambiguous): ${skipped || 'none'}`;
}
