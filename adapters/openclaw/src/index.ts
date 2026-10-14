import { buildJsonPluginConfigSchema, definePluginEntry } from 'openclaw/plugin-sdk/plugin-entry';
import type { OpenClawPluginApi } from 'openclaw/plugin-sdk/plugin-entry';
import { createGuardedClient } from './client.js';
import { CONFIG_JSON_SCHEMA, parseConfig, resolveCredential } from './config.js';
import { doctorReport, formatCounts, formatPrune, formatRetire } from './doctor.js';
import { SessAdapterError } from './errors.js';
import {
  applySetup,
  formatPlan,
  parseSetupOptions,
  planSetup,
  RESTART_COMMAND,
  type SetupPlan,
} from './setup.js';
import { captureInvocation, type HostToolContext } from './host.js';
import {
  TOOL_PARAMETERS,
  parseCompleteArgs,
  parsePublishArgs,
  parseRequestArgs,
  parseResponseArgs,
  type ToolName,
} from './schemas.js';
import {
  LayoutGate,
  RecoveryStore,
  countStates,
  openHostStores,
  pruneTerminal,
  retireIdle,
  type HostStateRuntime,
  type HostStores,
} from './store.js';
import {
  REVOKED_AFTER_SAVE,
  sessComplete,
  sessPublish,
  sessRequest,
  sessResponse,
  type InvocationDeps,
  type ToolOutcome,
} from './tools.js';

export const PLUGIN_ID = 'sess';

const DESCRIPTIONS: Record<ToolName, string> = {
  sess_request:
    'Ask a person for a structured decision through a private SESS link. Returns a handle, revision and humanUrl immediately. Present the link privately; wait with sess_response only once the person can see it.',
  sess_response:
    'Read, or wait a bounded time for, the verified answer to one exact revision. A needs_resume result is normal: the form stays available; ask the person to submit, then call again. Never loop.',
  sess_publish:
    'Publish the next revision on the same link after a verified answer (same handle). Requires the answer eventId and its revision.',
  sess_complete: 'Complete the interaction after its final verified answer and confirm the terminal state.',
};

type Runner = (deps: InvocationDeps, raw: unknown) => Promise<ToolOutcome>;
const RUNNERS: Record<ToolName, { parse: (raw: unknown) => unknown; run: Runner }> = {
  sess_request: { parse: parseRequestArgs, run: (d, a) => sessRequest(d, a as never) },
  sess_response: { parse: parseResponseArgs, run: (d, a) => sessResponse(d, a as never) },
  sess_publish: { parse: parsePublishArgs, run: (d, a) => sessPublish(d, a as never) },
  sess_complete: { parse: parseCompleteArgs, run: (d, a) => sessComplete(d, a as never) },
};

function createTool(
  api: OpenClawPluginApi,
  name: ToolName,
  context: HostToolContext,
  hostStores: () => HostStores,
  gate: LayoutGate,
) {
  return {
    name,
    label: name,
    description: DESCRIPTIONS[name],
    parameters: TOOL_PARAMETERS[name],
    executionMode: 'sequential' as const,
    ...(name === 'sess_response' ? { resultContentSource: 'network' as const } : {}),
    async execute(toolCallId: string, params: unknown, signal?: AbortSignal) {
      // Nothing below runs at import or registration: config, secrets, state and network are
      // touched only inside an admitted invocation.
      const lease = captureInvocation(context, signal);
      const args = RUNNERS[name].parse(params);
      const config = parseConfig(api.pluginConfig);
      const credential = resolveCredential(config);
      const store = new RecoveryStore(hostStores(), lease);
      // Schema upgrade fence: no admission in this Gateway until the layout is current.
      await gate.ensure(store);
      const client = createGuardedClient(config, credential, lease);
      const outcome = await RUNNERS[name].run({ config, credential, lease, store, client, toolCallId }, args);
      // R-02: the final release boundary re-asserts live authority after every awaited runner, so
      // no result (terminal shortcuts included) escapes a revoked or cancelled invocation.
      try {
        lease.assertCurrent();
      } catch (error) {
        // A request result always refers to a created and saved Session: say how to recover it.
        if (
          name === 'sess_request' &&
          error instanceof SessAdapterError &&
          error.code === 'AUTHORITY_REVOKED'
        )
          throw new SessAdapterError('AUTHORITY_REVOKED', REVOKED_AFTER_SAVE);
        throw error;
      }
      return {
        content: [{ type: 'text' as const, text: `${outcome.note}\n${JSON.stringify(outcome.result)}` }],
        details: outcome.result,
      };
    },
  };
}

export default definePluginEntry({
  id: PLUGIN_ID,
  name: 'SESS',
  description:
    'Agents request structured human decisions through hosted SESS interfaces and receive verified answers.',
  configSchema: buildJsonPluginConfigSchema(CONFIG_JSON_SCHEMA as never),
  register(api) {
    let opened: HostStores | undefined;
    const state = () => api.runtime?.state as HostStateRuntime | undefined;
    const hostStores = () => (opened ??= openHostStores(state()));
    const gate = new LayoutGate();
    for (const name of Object.keys(TOOL_PARAMETERS) as ToolName[]) {
      api.registerTool(
        {
          contextVersion: 2,
          create: (context) => createTool(api, name, context as HostToolContext, hostStores, gate) as never,
        },
        { name, optional: true },
      );
    }
    api.registerCli(
      ({ program, config }) => {
        const root = program
          .command('sess')
          .description('SESS plugin setup and diagnostics (no network, no secrets printed)');
        root
          .command('setup')
          .description(
            'Preview (default) or apply with --yes: enable the plugin, add the four tools to tools.alsoAllow and set plugin config. Never stores the API key and never restarts the Gateway',
          )
          .option('--base-url <origin>', 'SESS API origin (HTTPS)')
          .option('--api-key-env <NAME>', 'name of the Gateway environment variable holding the API key')
          .option('--wait-budget-ms <ms>', 'longest single bounded wait')
          .option('--yes', 'apply the previewed change (explicit consent)')
          .action(
            async (raw: { baseUrl?: string; apiKeyEnv?: string; waitBudgetMs?: string; yes?: boolean }) => {
              const options = parseSetupOptions(raw);
              const preview = planSetup(config, options);
              if (raw.yes !== true || preview.changes.length === 0) {
                console.log(formatPlan(preview, process.env, false));
                return;
              }
              const mutate = api.runtime?.config?.mutateConfigFile;
              if (typeof mutate !== 'function')
                throw new SessAdapterError(
                  'HOST_CAPABILITY_MISSING',
                  'This host cannot write plugin config.',
                );
              let applied: SetupPlan = preview;
              await mutate({
                // Never restart: the operator owns the follow-up restart.
                afterWrite: { mode: 'none', reason: `sess setup; restart with: ${RESTART_COMMAND}` },
                mutate(draft) {
                  // Recompute on the host's file snapshot so references and concurrent edits are kept.
                  applied = planSetup(draft, options);
                  applySetup(draft as unknown as Record<string, unknown>, applied);
                },
              });
              console.log(formatPlan(applied, process.env, true));
            },
          );
        root
          .command('doctor')
          .description('Check SESS plugin configuration and host capabilities without contacting SESS')
          .action(async () => {
            console.log(
              doctorReport(api.pluginConfig, api.runtime?.state, process.env, api.runtime?.version),
            );
            try {
              console.log(formatCounts(await countStates(hostStores())));
            } catch (error) {
              console.log(
                `state counts: unavailable (${error instanceof SessAdapterError ? error.code : 'error'})`,
              );
            }
          });
        root
          .command('retire')
          .description(
            'Dry-run by default: list how many waiting/needs_resume/answered interactions have been idle for at least --older-than-days. With --apply, mark them blocked (operator_retired) and archive them; claims are kept, pending or ambiguous records are never touched',
          )
          .requiredOption('--older-than-days <days>', 'minimum idle age in days (at least 1)')
          .option('--apply', 'retire the listed interactions (requires this explicit flag)')
          .action(async (options: { olderThanDays: string; apply?: boolean }) => {
            const days = Number(options.olderThanDays);
            if (!Number.isSafeInteger(days) || days < 1)
              throw new SessAdapterError(
                'INVALID_ARGUMENTS',
                '--older-than-days must be an integer of at least 1.',
              );
            const apply = options.apply === true;
            console.log(formatRetire(await retireIdle(hostStores(), days * 86_400_000, apply), days, apply));
          });
        root
          .command('prune')
          .description(
            'Dry-run by default: count terminal records holding a retained human link. With --apply, remove only that link; replay tombstones and non-terminal records are never touched',
          )
          .option('--apply', 'compact terminal secret payload (requires this explicit flag)')
          .action(async (options: { apply?: boolean }) => {
            console.log(
              formatPrune(await pruneTerminal(hostStores(), options.apply === true), options.apply === true),
            );
          });
      },
      { descriptors: [{ name: 'sess', description: 'SESS plugin diagnostics', hasSubcommands: true }] },
    );
  },
});
