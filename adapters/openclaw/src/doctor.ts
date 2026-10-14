import { parseConfig } from './config.js';
import { SessAdapterError } from './errors.js';

export const PLUGIN_VERSION = '0.1.0-rc.1';
export const QUALIFIED_HOST = '2026.10.3';

/**
 * Plain-language, read-only diagnostics. No network request, no state opened, and no secret,
 * human link or response data printed: only whether the configured variable is present here.
 */
export function doctorReport(
  rawConfig: unknown,
  state: unknown,
  env: Readonly<Record<string, string | undefined>>,
): string {
  const lines = [`SESS for OpenClaw ${PLUGIN_VERSION} (qualified host: OpenClaw ${QUALIFIED_HOST})`];
  try {
    const config = parseConfig(rawConfig);
    lines.push(`config: valid; SESS origin ${config.baseUrl}; wait budget ${config.waitBudgetMs} ms`);
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
    'tools: optional; enable them explicitly with tools.allow (sess_request, sess_response, sess_publish, sess_complete)',
  );
  lines.push('network: not contacted by doctor');
  return lines.join('\n');
}
