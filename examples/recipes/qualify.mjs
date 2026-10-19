// Bounded qualification runs of the provider recipes:
//
//   node qualify.mjs <provider> [--scenario happy_path|correction|timeout_resume] [--out <dir>]
//   node qualify.mjs --weekly [--out <dir>]
//
// One run: the recipe under the per-run limits in bounds.mjs (10 calls, 12 HTTP requests with
// retries, 2,000 output tokens per request, 80k input / 20k output per run with every attempt
// counted, 60 s per request, 2 retries on 429/5xx/network only, 20 minutes), inside the spend
// guard in harness.mjs (the run's maximum possible cost must fit the US$100 ceiling and the
// RECIPE_BUDGET_USD target, default 15). It prints the usage, the cost and the budget left, and
// writes a versioned record of what it proved. The person answers on the link themselves: this
// runner never answers for them. Keys come only from the environment (see with-keychain.sh).
//
// --weekly (post-launch; prepared, not scheduled): the happy path once per provider, on that
// provider's cheapest listed model, one after another under the same guard. A provider without
// its key is skipped and reported; the run stops at the first budget refusal.
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { loadModels, QUALIFICATION_DIR, runRecipe } from './harness.mjs';

export const PROVIDERS = ['openai', 'anthropic', 'gemini', 'xai', 'meta', 'openrouter'];
const SCENARIOS = ['happy_path', 'correction', 'timeout_resume'];
const KEY_ENV = {
  openai: 'OPENAI_API_KEY',
  anthropic: 'ANTHROPIC_API_KEY',
  gemini: 'GEMINI_API_KEY',
  xai: 'XAI_API_KEY',
  meta: 'META_API_KEY',
  openrouter: 'OPENROUTER_API_KEY',
};

/** The cheapest listed model of a provider, by the plan's expected run (35k input, 6k output). */
export function cheapestModel(entry) {
  const expected = ([, r]) => 35_000 * r.input + 6_000 * r.output;
  return Object.entries(entry.models).sort((a, b) => expected(a) - expected(b))[0][0];
}

/** The weekly check: one happy-path run per provider on its cheapest model. */
export async function weekly(options = {}) {
  const env = options.env ?? process.env;
  const out = options.stdout ?? ((line) => console.log(line));
  const models = options.models ?? (await loadModels());
  const results = [];
  for (const id of PROVIDERS) {
    if (!env[KEY_ENV[id]]) {
      out(`${id}: skipped (no ${KEY_ENV[id]})`);
      results.push({ provider: id, code: 'skipped' });
      continue;
    }
    const recipe = await import(`./${id}/agent.mjs`);
    const model = cheapestModel(models.providers[id]);
    out(`\n${id}: ${model}`);
    const result = await runRecipe(recipe.PROVIDER, recipe.plan, {
      ...options,
      models,
      model,
      qualify: true,
      scenario: 'happy_path',
    });
    results.push({ provider: id, model, code: result.code });
    if (result.code === 'budget_refused') break;
  }
  return results;
}

/**
 * The free pre-flight: the same scenario, limits, budget accounting and record as a real run,
 * with the model provider, the Sess API, the person and the weather simulated (dry-run.mjs).
 * Its ledger and records are qualification/dry-run/, apart from the real ones. It is given no
 * real key: the environment it sees holds placeholders only.
 */
export async function dryRun(providerId, options = {}) {
  const { DRY_ANSWERS, SIMULATED, dryWeather, scriptedProvider, syntheticSess } =
    await import('./dry-run.mjs');
  const env = options.env ?? process.env;
  const scenario = options.scenario ?? 'happy_path';
  if (!['happy_path', 'correction'].includes(scenario))
    throw new Error('A dry run simulates happy_path and correction only.');
  const recipe = await import(`./${providerId}/agent.mjs`);
  const sessKey = 'dry-run-sess-key';
  const answers = [
    DRY_ANSWERS[0],
    { ...DRY_ANSWERS[1], time: scenario === 'correction' ? 'evening' : 'keep' },
  ];
  const server = syntheticSess({ apiKey: sessKey, answers });
  const model = scriptedProvider(providerId);
  const Sess = options.Sess ?? (await import('@sess.si/sdk')).Sess;
  const out = options.stdout ?? ((line) => console.log(line));
  const err = options.stderr ?? ((line) => console.error(line));
  out(
    'DRY RUN: the model provider, the Sess API, the person and the weather are simulated. Nothing is sent or billed.',
  );
  return await runRecipe(recipe.PROVIDER, recipe.plan, {
    env: {
      SESS_API_KEY: sessKey,
      [recipe.PROVIDER.keyEnv]: 'dry-run-provider-key',
      SESS_DEMO_CONTACT: 'https://sess.si/contact',
      ...(env.RECIPE_BUDGET_USD !== undefined ? { RECIPE_BUDGET_USD: env.RECIPE_BUDGET_USD } : {}),
      ...(env.RECIPE_MODEL ? { RECIPE_MODEL: env.RECIPE_MODEL, RECIPE_RATES: env.RECIPE_RATES } : {}),
    },
    qualify: true,
    scenario,
    out: options.out ?? join(QUALIFICATION_DIR, 'dry-run'),
    Sess,
    sessOptions: { fetch: server.fetch },
    guard: { fetch: model.fetch, ...options.guard },
    workflow: {
      weatherFor: dryWeather,
      showLink: () => err('Dry run: the simulated person answers on the synthetic link.'),
      ...options.workflow,
    },
    recordExtra: { dry_run: true, simulated: SIMULATED },
    ...(options.sdkVersion !== undefined ? { sdkVersion: options.sdkVersion } : {}),
    ...(options.gitState ? { gitState: options.gitState } : {}),
    stdout: out,
    stderr: err,
  });
}

const isMain = process.argv[1] === fileURLToPath(import.meta.url);
if (isMain) {
  const args = process.argv.slice(2);
  const flags = {};
  const weeklyMode = args[0] === '--weekly';
  const dryRunMode = args[0] === '--dry-run';
  const provider = weeklyMode ? null : dryRunMode ? args[1] : args[0];
  const rest = args.slice(dryRunMode ? 2 : 1);
  for (let i = 0; i < rest.length; i += 2) {
    const [name, value] = [rest[i], rest[i + 1]];
    if (!['--scenario', '--out'].includes(name) || value === undefined) usage();
    if (weeklyMode && name === '--scenario') usage();
    flags[name.slice(2)] = value;
  }
  if (
    !weeklyMode &&
    (!PROVIDERS.includes(provider) || (flags.scenario && !SCENARIOS.includes(flags.scenario)))
  )
    usage();
  const common = flags.out ? { out: flags.out } : {};
  if (dryRunMode) {
    const result = await dryRun(provider, { ...common, scenario: flags.scenario ?? 'happy_path' });
    process.exitCode = result.ok ? 0 : 1;
  } else if (weeklyMode) {
    const results = await weekly(common);
    process.exitCode = results.every((r) => r.code === 'completed' || r.code === 'skipped') ? 0 : 1;
  } else {
    const recipe = await import(`./${provider}/agent.mjs`);
    const result = await runRecipe(recipe.PROVIDER, recipe.plan, {
      ...common,
      qualify: true,
      scenario: flags.scenario ?? 'happy_path',
    });
    process.exitCode = result.ok ? 0 : 1;
  }
}

function usage() {
  console.error(
    `usage: node qualify.mjs <${PROVIDERS.join('|')}> [--scenario ${SCENARIOS.join('|')}] [--out <dir>]\n` +
      '       node qualify.mjs --weekly [--out <dir>]\n' +
      `       node qualify.mjs --dry-run <${PROVIDERS.join('|')}> [--scenario happy_path|correction] [--out <dir>]`,
  );
  process.exit(2);
}
