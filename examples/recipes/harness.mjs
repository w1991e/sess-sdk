// Runs one recipe: checks the environment, builds the Sess client, the tools and the bounds guard,
// runs the provider's own loop, and prints the plan with the usage and its cost.
//
// With `qualify` it is the qualification runner. Before the run it reserves the run's maximum
// possible cost (the token caps at the dated rates, retries included) in the local spend ledger,
// and refuses unless that fits both the US$100 ceiling and the lower operating target
// (RECIPE_BUDGET_USD, default 15). After the run it settles the reservation at the cost computed
// from the usage, and writes a versioned record of what was proved, with no key, no private link
// and no answer content.
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { link, mkdir, open, readdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { hostname } from 'node:os';
import { basename, dirname, isAbsolute, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { BOUNDS, createGuard, maxRunCost } from './bounds.mjs';
import { CHECKS, createWorkflow, observed, SYSTEM, TASK } from './workflow.mjs';

export const RECORD_SCHEMA = 'sess.recipe-qualification/2';
export const LEDGER_SCHEMA = 'sess.recipe-spend-ledger/1';
export const RUNNER_VERSION = '2.0.0';
/** The total ceiling for provider qualification spend (founder amendment 3), US dollars. */
export const CEILING_USD = 100;
export const DEFAULT_BUDGET_USD = 15;
const HERE = fileURLToPath(new URL('.', import.meta.url));
export const QUALIFICATION_DIR = join(HERE, 'qualification');

/** True when `moduleUrl` is the script node was started with. */
export const isMain = (moduleUrl) => process.argv[1] === fileURLToPath(moduleUrl);

/** models.json: dated rates with their sources, and each provider's default model. */
export async function loadModels() {
  return JSON.parse(await readFile(join(HERE, 'models.json'), 'utf8'));
}

/** The model to run and its dated rates (null rates: unknown; a qualification refuses it). */
export function resolveModel(providerId, models, env, model) {
  const entry = models.providers[providerId];
  const id = model ?? (env.RECIPE_MODEL?.trim() || entry.default);
  const listed = entry.models[id];
  if (listed) return { id, rates: { ...listed, source: entry.source, read_at: models.read_at } };
  const custom = parseRates(env.RECIPE_RATES);
  return { id, rates: custom ? { ...custom, source: 'RECIPE_RATES', read_at: today() } : null };
}

/**
 * `provider`: { id, keyEnv, file }. `plan`: the provider's loop,
 * `({ workflow, guard, model, apiKey, system, task }) => text`.
 */
export async function runRecipe(provider, plan, options = {}) {
  const env = options.env ?? process.env;
  const out = options.stdout ?? ((line) => console.log(line));
  const err = options.stderr ?? ((line) => console.error(line));
  const sessKey = env.SESS_API_KEY;
  const apiKey = env[provider.keyEnv];
  const contact = env.SESS_DEMO_CONTACT?.trim() ?? '';
  const { isContact } = await import('../../create-agent/template/weather.mjs');
  const missing = [
    !sessKey && 'SESS_API_KEY',
    !apiKey && provider.keyEnv,
    !isContact(contact) && 'SESS_DEMO_CONTACT',
  ];
  if (missing.some(Boolean)) {
    err(
      `Set ${missing.filter(Boolean).join(', ')} in your environment first. ` +
        `This recipe needs both a Sess key and the ${provider.id} key.`,
    );
    return { ok: false, code: 'missing_environment' };
  }
  const models = options.models ?? (await loadModels());
  const entry = models.providers[provider.id];
  let { id: model, rates } = resolveModel(provider.id, models, env, options.model);
  const bounds = options.guard?.bounds ?? BOUNDS;
  // The listed fallback is tried only for the default model, when the key is not offered it.
  const fallback = entry.fallback && !options.model && !env.RECIPE_MODEL?.trim() ? entry.fallback : null;

  // A real qualification record always names the recipe commit: without it, nothing is run.
  const recipeGit = options.gitState ?? gitState();
  if (options.qualify && !options.recordExtra?.dry_run && !recipeGit.git_sha) {
    err(
      'The recipe commit (git rev-parse HEAD) could not be determined, so this run would leave an unattributable record. Run from a git checkout of the recipes.',
    );
    return { ok: false, code: 'recipe_sha_unknown' };
  }

  // The spend guard (qualification runs only).
  let ledger = null;
  let reservation = null;
  let runLock = null;
  if (options.qualify) {
    if (!rates) {
      err(
        `No rates for ${model}. Add it to models.json, or set RECIPE_RATES=input,output (USD per 1M tokens).`,
      );
      return { ok: false, code: 'rates_unknown' };
    }
    const budget = budgetOf(env);
    if (budget === null) {
      err(`RECIPE_BUDGET_USD must be a number above 0 and at most ${CEILING_USD}.`);
      return { ok: false, code: 'budget_invalid' };
    }
    const fallbackRates = fallback ? resolveModel(provider.id, models, env, fallback).rates : null;
    const maxCost = Math.max(
      maxRunCost(rates, bounds),
      fallbackRates ? maxRunCost(fallbackRates, bounds) : 0,
    );
    ledger = openLedger(options.out ?? QUALIFICATION_DIR);
    // One qualification run at a time (founder rule): a second concurrent run is refused.
    runLock = await ledger.lockRun();
    if (!runLock) {
      err(`Another qualification run is in progress (${ledger.dir}/run.lock). Wait for it to finish.`);
      return { ok: false, code: 'run_in_progress' };
    }
    try {
      // Checked and reserved in one locked step against the latest ledger.
      const admitted = await ledger.admit(budget, {
        provider: provider.id,
        model,
        scenario: options.scenario ?? 'happy_path',
        max_cost_usd: round(maxCost),
      });
      out(budgetLine('before', admitted.before, budget));
      if (!admitted.entry) {
        err(
          `Refused: this run could cost up to US$${maxCost.toFixed(4)} (its token caps at the ${model} rates, ` +
            `retries included), and only US$${admitted.before.left.toFixed(4)} is left.`,
        );
        await runLock.release();
        return { ok: false, code: 'budget_refused', max_cost_usd: maxCost };
      }
      reservation = admitted.entry;
    } catch (error) {
      await runLock.release();
      throw error;
    }
  }

  try {
    return await execute();
  } finally {
    await runLock?.release();
  }

  async function execute() {
    const Sess = options.Sess ?? (await import('@sess.si/sdk')).Sess;
    const sess = new Sess({ ...options.sessOptions, apiKey: sessKey });
    const guard = createGuard(options.guard);
    const workflow = createWorkflow({
      sess,
      contact,
      deadline: guard.deadline,
      showLink: (url) =>
        err(`Open this private link on your phone and answer there. Anyone with it can answer:\n  ${url}`),
      ...options.workflow,
    });

    out(`Running the ${provider.id} recipe (${model}). Waiting for the person on the link.`);
    let text = null;
    let failure = null;
    for (;;) {
      try {
        text = await plan({ workflow, guard, model, apiKey, system: SYSTEM, task: TASK });
        failure = null;
      } catch (error) {
        failure = error?.code ?? error?.name ?? 'error';
        // The default model is not offered to this key: try the listed fallback once, before any tool ran.
        if (error?.status === 404 && fallback && model !== fallback && workflow.state.events.length === 0) {
          err(`${model} is not available to this key; trying ${fallback}.`);
          ({ id: model, rates } = resolveModel(provider.id, models, env, fallback));
          continue;
        }
        err(`Stopped: ${error?.name === 'BoundError' ? error.message : failure}`);
      }
      break;
    }
    const stats = guard.stats();
    const cost = rates ? costOf(stats.usage, rates) : null;
    const completed = workflow.state.steps.includes('completed');
    if (text) out(`\n${text}`);
    out(
      `\nusage: ${stats.usage.input_tokens} input, ${stats.usage.output_tokens} output tokens in ` +
        `${stats.calls} calls, ${stats.requests} requests (${stats.retries} retries)`,
    );
    out(
      cost === null
        ? 'cost: unknown (set RECIPE_RATES=input,output in USD per 1M tokens)'
        : `cost: US$${cost.toFixed(4)}`,
    );
    const result = {
      ok: completed && !failure,
      code: failure ?? (completed ? 'completed' : 'not_completed'),
    };
    if (!options.qualify) return result;

    const { proved, not_proved } = observed(workflow.state, text);
    const recordedAt = new Date();
    const record = {
      schema: RECORD_SCHEMA,
      ...options.recordExtra,
      runner_version: RUNNER_VERSION,
      recorded_at: recordedAt.toISOString(),
      provider: provider.id,
      model_requested: model,
      model_returned: stats.models,
      sdk_version: options.sdkVersion !== undefined ? options.sdkVersion : await resolvedSdkVersion(),
      recipe: { file: `examples/recipes/${provider.id}/agent.mjs`, ...recipeGit },
      scenario: options.scenario ?? 'happy_path',
      outcome: result.code,
      // A dry run proves nothing about a provider: what it observed was against simulations.
      ...(options.recordExtra?.dry_run
        ? {
            proved: [],
            not_proved: CHECKS,
            // The weather was a fixed forecast: never named as live.
            proved_in_simulation: proved.map((c) =>
              c === 'live_weather_used' ? 'weather_used (simulated)' : c,
            ),
          }
        : { proved, not_proved }),
      usage: stats.usage,
      calls: stats.calls,
      requests: stats.requests,
      retries: stats.retries,
      attempts_charged_at_ceiling: stats.estimated_attempts,
      rates_usd_per_million: rates,
      cost_usd: round(cost),
      max_cost_usd: reservation?.max_cost_usd ?? null,
      duration_s: Math.round(stats.elapsed_ms / 1000),
      bounds,
    };
    const textOut = `${JSON.stringify(record, null, 2)}\n`;
    const secrets = [sessKey, apiKey].filter((s) => s && s.length >= 8);
    const withheld = secrets.some((s) => textOut.includes(s)) || /\/s\/[A-Za-z0-9_-]{16,}/.test(textOut);
    let path = null;
    if (withheld) {
      err('The qualification record would carry a secret or a private link; it was not written.');
    } else {
      path = join(ledger.dir, `${provider.id}-${record.recorded_at.replace(/[:.]/g, '-')}.json`);
      await writeFile(path, textOut, { flag: 'wx' });
      out(`record: ${path}`);
    }
    // Settled at the computed cost; without rates or usage, the reservation stands at its maximum.
    const after = await ledger.settle(
      reservation.id,
      {
        cost_usd: round(cost),
        record: path ? path.slice(ledger.dir.length + 1) : null,
      },
      budgetOf(env),
    );
    out(budgetLine('after', after, budgetOf(env)));
    return withheld ? { ok: false, code: 'record_withheld' } : { ...result, record, path };
  }
}

export function costOf(usage, rates) {
  return (usage.input_tokens * rates.input + usage.output_tokens * rates.output) / 1e6;
}

/** The operating target: RECIPE_BUDGET_USD (default 15), never above the ceiling. Null if invalid. */
export function budgetOf(env) {
  const raw = env.RECIPE_BUDGET_USD;
  if (raw === undefined || raw === '') return DEFAULT_BUDGET_USD;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 && n <= CEILING_USD ? n : null;
}

/**
 * The local spend ledger (`<dir>/spend-ledger.json`, gitignored with the records). Spent is the
 * settled costs plus every open reservation at its maximum, so a run that crashed still counts.
 *
 * Safe across processes: the budget check and the reservation are one step, and so is each
 * settlement. Each holds `<dir>/spend-ledger.lock` (created exclusively), reloads the latest
 * ledger, changes only its own entry and replaces the file by an atomic rename. `lockRun()` is the
 * separate one-run-at-a-time lock (`<dir>/run.lock`), held for a whole qualification run.
 */
export function openLedger(dir, { hooks = {} } = {}) {
  const file = join(dir, 'spend-ledger.json');
  const empty = () => ({ schema: LEDGER_SCHEMA, ceiling_usd: CEILING_USD, runs: [] });
  const load = async () => {
    const data = existsSync(file) ? JSON.parse(await readFile(file, 'utf8')) : empty();
    if (data.schema !== LEDGER_SCHEMA || !Array.isArray(data.runs))
      throw new Error('spend-ledger.json has an unknown schema; it was not changed.');
    return data;
  };
  const save = async (data) => {
    const tmp = `${file}.${process.pid}.${randomUUID()}.tmp`;
    await writeFile(tmp, `${JSON.stringify(data, null, 2)}\n`, { flag: 'wx' });
    await rename(tmp, file);
  };
  const remainingOf = (data, budget) => {
    const used = spentOf(data);
    const ceilingLeft = CEILING_USD - used;
    const targetLeft = budget - used;
    return { spent: used, left: Math.max(0, Math.min(ceilingLeft, targetLeft)), ceilingLeft, targetLeft };
  };
  /** Runs `change(latest)` holding the ledger lock; writes the ledger if it returns true. */
  async function locked(change) {
    await mkdir(dir, { recursive: true });
    const lock = await acquireLock(join(dir, 'spend-ledger.lock'), { waitMs: 10_000, hooks });
    if (!lock) throw new Error('The spend ledger is locked by another process; nothing was changed.');
    try {
      const data = await load();
      const out = await change(data);
      if (out.write) {
        await hooks.beforeSave?.();
        await save(data);
      }
      return out.value;
    } finally {
      await lock.release();
    }
  }
  return {
    dir,
    file,
    async remaining(budget) {
      return remainingOf(await load(), budget);
    },
    /** Checks the budget and, if the run fits, reserves its maximum, in one locked step. */
    admit(budget, run) {
      return locked((data) => {
        const before = remainingOf(data, budget);
        if (run.max_cost_usd > before.left) return { write: false, value: { before, entry: null } };
        const entry = {
          id: randomUUID(),
          started_at: new Date().toISOString(),
          status: 'reserved',
          ...run,
          cost_usd: null,
        };
        data.runs.push(entry);
        return { write: true, value: { before, entry } };
      });
    },
    /** Settles one reservation against the latest ledger; every other entry is left as it is. */
    settle(id, { cost_usd, record }, budget = DEFAULT_BUDGET_USD) {
      return locked((data) => {
        const entry = data.runs.find((r) => r.id === id);
        if (!entry) throw new Error(`No reservation ${id} in the spend ledger.`);
        Object.assign(entry, { status: 'settled', settled_at: new Date().toISOString(), cost_usd, record });
        return { write: true, value: remainingOf(data, budget) };
      });
    },
    /** The one-run lock, or null while another live run holds it. */
    lockRun: async () => {
      await mkdir(dir, { recursive: true });
      return acquireLock(join(dir, 'run.lock'), { waitMs: 0, hooks });
    },
  };
}

const spentOf = (data) =>
  data.runs.reduce(
    (sum, r) => sum + (r.status === 'settled' && r.cost_usd !== null ? r.cost_usd : r.max_cost_usd),
    0,
  );

/**
 * An exclusive lock file holding a unique owner token: pid, host, start time and a random nonce.
 * One protocol serves both run.lock and spend-ledger.lock:
 *
 * - **Publish.** The lock pathname never exists without its full token. The token is written to a
 *   private temporary file in the same directory (`<lock>.tmp-<pid>-<nonce>`, created `'wx'`),
 *   synced and closed, then published with `link(tmp, lock)`. That fails if a lock exists and
 *   never overwrites one. The holder then re-reads the lock, and only its exact token makes a
 *   handle.
 * - **Stale lock.** A parsed token whose owner is a process on this host that no longer runs. To
 *   break it, a contender first takes `<lock>.break` the same way. Holding that, it re-reads the
 *   lock and unlinks it only if the full token is still the one it judged stale. Then it releases
 *   `.break` and retries. Someone else's replacement has a different token, so it is never
 *   removed; the contender simply retries.
 * - **Release.** Also under `.break`: the lock is unlinked only if it still holds this owner's
 *   token, so a release never removes another generation's lock.
 * - **Fail closed.** A lock or `.break` that is empty or cannot be parsed can't come from a live
 *   creator, so it is treated as corruption. So is a `.break` left by an exited process. Neither
 *   is broken automatically: the helper stops and names the file to remove by hand while no
 *   qualification run is active.
 * - **Left-over temporary files** older than 30 s whose owner pid has exited are removed.
 *
 * Waits up to `waitMs` for a live lock, then returns null. `hooks` (tests only): `afterStaleRead`
 * runs after a stale token was read, `beforeTokenWrite` before the token is written to the temp file.
 */
export async function acquireLock(path, { waitMs = 0, hooks = {} } = {}) {
  const until = Date.now() + waitMs;
  const mine = ownerToken();
  await sweepTemporaries(path);
  for (;;) {
    if (await publishExclusive(path, mine, hooks)) return lockHandle(path, mine);
    const seen = await readText(path);
    if (seen === null) continue; // released meanwhile: publish again
    const state = tokenState(seen);
    if (state === 'corrupt') throw corruptLock(path);
    if (state === 'exited') {
      await hooks.afterStaleRead?.(path);
      await withBreak(path, Infinity, async () => {
        if ((await readText(path)) === seen) await rm(path, { force: true });
      });
      continue;
    }
    if (Date.now() >= until) return null;
    await new Promise((done) => setTimeout(done, 20));
  }
}

function lockHandle(path, mine) {
  let released = false;
  return {
    token: mine,
    async release() {
      if (released) return;
      released = true;
      await withBreak(path, Infinity, async () => {
        if ((await readText(path)) === mine) await rm(path, { force: true });
      });
    },
  };
}

/** Runs `fn` holding `<path>.break` (published like a lock; removed only by its own holder). */
async function withBreak(path, waitMs, fn) {
  const brk = `${path}.break`;
  const mine = ownerToken();
  const until = Date.now() + waitMs;
  for (;;) {
    if (await publishExclusive(brk, mine)) break;
    const seen = await readText(brk);
    if (seen === null) continue;
    const state = tokenState(seen);
    if (state === 'corrupt') throw corruptLock(brk);
    if (state === 'exited')
      throw new Error(
        `${brk} was left by a process that has exited. Remove it by hand while no qualification run is active.`,
      );
    if (Date.now() >= until) throw new Error(`${brk} stayed held.`);
    await new Promise((done) => setTimeout(done, 5));
  }
  try {
    return await fn();
  } finally {
    // Only this holder ever removes a live .break; it still holds its token.
    if ((await readText(brk)) === mine) await rm(brk, { force: true });
  }
}

const corruptLock = (path) =>
  new Error(
    `${path} is empty or unreadable, which no live run leaves. Remove it by hand while no qualification run is active.`,
  );

const ownerToken = () =>
  JSON.stringify({
    pid: process.pid,
    host: hostname(),
    started: new Date().toISOString(),
    nonce: randomUUID(),
  });

/**
 * Publishes `text` at `path` only if nothing is there: written whole to a private temporary file,
 * synced, then hard-linked into place (`link` never overwrites). True only if `path` then holds
 * exactly `text`.
 */
async function publishExclusive(path, text, hooks = {}) {
  const tmp = `${path}.tmp-${process.pid}-${randomUUID()}`;
  const handle = await open(tmp, 'wx');
  try {
    await hooks.beforeTokenWrite?.(tmp);
    await handle.writeFile(text);
    await handle.sync();
  } finally {
    await handle.close();
  }
  try {
    await link(tmp, path);
  } catch (error) {
    if (error?.code === 'EEXIST') return false;
    throw error;
  } finally {
    await rm(tmp, { force: true });
  }
  return (await readText(path)) === text;
}

async function readText(path) {
  try {
    return await readFile(path, 'utf8');
  } catch (error) {
    if (error?.code === 'ENOENT') return null;
    throw error;
  }
}

/** Removes `<lock>.tmp-<pid>-<nonce>` files older than 30 s whose creating process has exited. */
async function sweepTemporaries(path) {
  const dir = dirname(path);
  const prefix = `${basename(path)}.tmp-`;
  const names = await readdir(dir).catch(() => []);
  for (const name of names) {
    if (!name.startsWith(prefix)) continue;
    const pid = Number(name.slice(prefix.length).split('-')[0]);
    const at = await stat(join(dir, name)).then(
      (s) => s.mtimeMs,
      () => null,
    );
    if (at === null || Date.now() - at <= 30_000 || !Number.isInteger(pid) || pidRuns(pid)) continue;
    await rm(join(dir, name), { force: true });
  }
}

/** 'exited': a parsed token whose owner on this host no longer runs; 'corrupt': empty or unparsable. */
function tokenState(text) {
  let owner = null;
  try {
    owner = JSON.parse(text);
  } catch {}
  if (!owner || typeof owner !== 'object' || !Number.isInteger(owner.pid) || typeof owner.host !== 'string')
    return 'corrupt';
  if (owner.host !== hostname()) return 'live';
  return pidRuns(owner.pid) ? 'live' : 'exited';
}

function pidRuns(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error?.code !== 'ESRCH';
  }
}

function budgetLine(when, remaining, budget) {
  return (
    `budget ${when} the run: US$${remaining.spent.toFixed(4)} spent; US$${Math.max(0, remaining.targetLeft).toFixed(4)} ` +
    `left of the US$${budget} target, US$${remaining.ceilingLeft.toFixed(4)} of the US$${CEILING_USD} ceiling`
  );
}

/** The @sess.si/sdk version node actually resolves from here, or null if it is not installed. */
async function resolvedSdkVersion() {
  try {
    let dir = dirname(fileURLToPath(import.meta.resolve('@sess.si/sdk')));
    for (let i = 0; i < 6; i++, dir = dirname(dir)) {
      const file = join(dir, 'package.json');
      if (!existsSync(file)) continue;
      const manifest = JSON.parse(await readFile(file, 'utf8'));
      if (manifest.name === '@sess.si/sdk') return manifest.version;
    }
  } catch {}
  return null;
}

/** The commit the recipes ran from, and whether the recipe directory had local changes. */
/**
 * The commit the recipes ran from, and whether the recipe directory had local changes. The SHA
 * comes from `git rev-parse HEAD` (a branch or a detached HEAD alike); if git cannot answer (not
 * installed, or refusing the checkout), it is read from the checkout's own HEAD file, following a
 * worktree's `.git` file and the common refs. `dirty` is null when `git status` cannot run.
 */
export function gitState(dir = HERE) {
  const git = (args) =>
    execFileSync('git', args, { cwd: dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  let sha = null;
  let source = null;
  try {
    sha = git(['rev-parse', '--verify', 'HEAD^{commit}']);
    source = 'git';
  } catch {
    sha = readGitHead(dir);
    source = sha ? 'git-files' : null;
  }
  if (sha && !/^[0-9a-f]{40}([0-9a-f]{24})?$/.test(sha)) [sha, source] = [null, null];
  let dirty = null;
  try {
    dirty = git(['status', '--porcelain', '--', '.']) !== '';
  } catch {}
  return { git_sha: sha, dirty, sha_source: source };
}

/** HEAD's commit read from the files of the checkout containing `dir`, or null. */
export function readGitHead(dir) {
  const read = (path) => {
    try {
      return readFileSync(path, 'utf8').trim();
    } catch {
      return null;
    }
  };
  for (let at = dir, i = 0; i < 64; i++, at = dirname(at)) {
    const dotGit = join(at, '.git');
    let gitDir = null;
    if (existsSync(join(dotGit, 'HEAD'))) gitDir = dotGit;
    else {
      const pointer = /^gitdir:\s*(.+)$/.exec(read(dotGit) ?? '');
      if (pointer) gitDir = isAbsolute(pointer[1]) ? pointer[1] : join(at, pointer[1]);
    }
    if (gitDir) {
      const head = read(join(gitDir, 'HEAD'));
      if (!head) return null;
      if (/^[0-9a-f]{40}([0-9a-f]{24})?$/.test(head)) return head; // detached
      const ref = /^ref:\s*(\S+)$/.exec(head)?.[1];
      if (!ref) return null;
      const common = read(join(gitDir, 'commondir'));
      const commonDir = common ? (isAbsolute(common) ? common : join(gitDir, common)) : gitDir;
      for (const base of [gitDir, commonDir]) {
        const loose = read(join(base, ref));
        if (loose) return loose;
      }
      const packed = read(join(commonDir, 'packed-refs')) ?? '';
      const line = packed.split('\n').find((l) => l.endsWith(` ${ref}`));
      return line ? line.split(' ')[0] : null;
    }
    if (dirname(at) === at) break;
  }
  return null;
}

function parseRates(value) {
  const [input, output] = String(value ?? '')
    .split(',')
    .map(Number);
  return Number.isFinite(input) && Number.isFinite(output) && input >= 0 && output >= 0
    ? { input, output }
    : null;
}
const today = () => new Date().toISOString().slice(0, 10);
const round = (n) => (n === null || n === undefined ? null : Number(n.toFixed(6)));
