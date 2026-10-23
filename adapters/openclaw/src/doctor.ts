import { parseConfig } from './config.js';
import { SessAdapterError } from './errors.js';
import type { PruneReport, RetireReport, StateCounts } from './store.js';

export const PLUGIN_VERSION = '0.1.0-rc.3';
export const QUALIFIED_HOST = '2026.10.3';

/**
 * Plain-language, read-only diagnostics. No network request, no state opened, and no secret,
 * human link or response data printed: only whether the configured variable is present here.
 */
export function doctorReport(
  rawConfig: unknown,
  state: unknown,
  env: Readonly<Record<string, string | undefined>>,
  hostVersion?: string,
): string {
  const lines = [`Sess for OpenClaw ${PLUGIN_VERSION} (qualified host: OpenClaw ${QUALIFIED_HOST})`];
  if (typeof hostVersion === 'string')
    lines.push(
      hostVersion === QUALIFIED_HOST
        ? `host: OpenClaw ${hostVersion} (qualified)`
        : `warning: host OpenClaw ${hostVersion} is not a qualified version; only ${QUALIFIED_HOST} has been tested`,
    );
  try {
    const config = parseConfig(rawConfig);
    lines.push(`config: valid; Sess origin ${config.baseUrl}; wait budget ${config.waitBudgetMs} ms`);
    if (config.allowInsecureLocalhost) lines.push('warning: allowInsecureLocalhost is a test-only setting');
    const present = typeof env[config.apiKeyEnv] === 'string' && env[config.apiKeyEnv]!.length > 0;
    lines.push(
      `credential: ${config.apiKeyEnv} is ${present ? 'set' : 'NOT set'} in this CLI process (the running Gateway must also have it)`,
    );
  } catch (error) {
    lines.push(`config: invalid (${error instanceof SessAdapterError ? error.message : 'unreadable'})`);
  }
  const keyed = typeof (state as { openKeyedStore?: unknown } | undefined)?.openKeyedStore === 'function';
  lines.push(`durable plugin state: ${keyed ? 'available' : 'NOT available'}`);
  lines.push(
    'tools: optional; add sess_request, sess_response, sess_publish and sess_complete to tools.alsoAllow (keep any existing entries; do not replace tools.allow), or preview with: openclaw sess setup',
  );
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
