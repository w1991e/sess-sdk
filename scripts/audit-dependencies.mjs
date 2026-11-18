// The repository's dependency audit: `npm audit` over every dependency, development dependencies
// included, at --audit-level=moderate, with dated exceptions for named advisories read from
// .github/audit-exceptions.json (founder 2026-11-17 22:05Z item 1). npm audit has no per-advisory
// ignore, so this reads its JSON report and decides.
//
//   node scripts/audit-dependencies.mjs
//
// It takes no arguments (any argument exits 2) and runs `npm audit --json --audit-level=moderate`
// in the repository root, the same scope as `npm audit --audit-level=moderate`: no --omit, no other
// level. It exits 0 only if every rule below passes, and 1 otherwise, printing each failure:
//
// 1. The exceptions file is exactly {"exceptions": [...]}, each entry exactly
//    {id, package, reason, until}: id a GHSA identifier (listed once), package and reason non-empty,
//    until a UTC timestamp "YYYY-MM-DDTHH:MM:SSZ". Anything else fails.
// 2. npm ran, was not killed or timed out, and exited 0 or 1. Any other outcome fails.
// 3. Its output is one JSON object with auditReportVersion 2, a vulnerabilities object and
//    metadata.vulnerabilities counts (info, low, moderate, high, critical, total) that match the
//    entries. No "error" member. Anything else fails: an npm error or an unknown shape never passes.
// 4. Every entry is well formed: its name equals its key, its severity is one of info, low,
//    moderate, high, critical, and its via is a non-empty list of names of other entries or
//    advisories with a GitHub advisory URL (https://github.com/advisories/GHSA-...), a package name
//    and a known severity. Anything else fails.
// 5. npm's exit code agrees with the report: 1 if and only if an entry is moderate or above.
// 6. Every advisory at moderate or above fails, naming its ID, package, severity and title, unless
//    an exception names the same ID and package and the time is before its until. At or after until
//    the exception no longer applies and the advisory fails ("exception expired"). Advisories below
//    moderate pass, as with --audit-level=moderate, and need no exception.
// 7. Every entry at moderate or above reaches, through its via, at least one advisory at moderate or
//    above; one that reaches none fails as unexplained.
// 8. Every exception, expired or not, names an advisory npm still reports for that package; one that
//    does not fails as stale, so the entry is deleted the day a fixed version is installed.
//
// The exception's reason is checked by tests/dependencies/dev-only-picomatch.test.ts, and this
// script's rules by tests/dependencies/audit-dependencies.test.ts. See SECURITY.md.
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
export const EXCEPTIONS_PATH = join(ROOT, '.github', 'audit-exceptions.json');
export const NPM_ARGS = ['audit', '--json', '--audit-level=moderate'];

const SEVERITIES = ['info', 'low', 'moderate', 'high', 'critical'];
const FAILING = new Set(['moderate', 'high', 'critical']);
const GHSA = /^GHSA(?:-[23456789cfghjmpqrvwx]{4}){3}$/;
const ADVISORY_URL = /^https:\/\/github\.com\/advisories\/(GHSA(?:-[23456789cfghjmpqrvwx]{4}){3})$/;
const UNTIL = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/;

const isRecord = (v) => typeof v === 'object' && v !== null && !Array.isArray(v);
const sameKeys = (obj, keys) => {
  const actual = Object.keys(obj).sort();
  const wanted = [...keys].sort();
  return actual.length === wanted.length && actual.every((k, i) => k === wanted[i]);
};

/** Parse the exceptions file's text. Returns { exceptions, errors }; any error fails the audit. */
export function parseExceptions(text) {
  let json;
  try {
    json = JSON.parse(text);
  } catch (error) {
    return { exceptions: [], errors: [`exceptions file is not JSON: ${error.message}`] };
  }
  if (!isRecord(json) || !sameKeys(json, ['exceptions']) || !Array.isArray(json.exceptions))
    return { exceptions: [], errors: ['exceptions file is not exactly {"exceptions": [...]}'] };
  const errors = [];
  const exceptions = [];
  const ids = new Set();
  json.exceptions.forEach((entry, i) => {
    const where = `exception ${i}`;
    if (!isRecord(entry) || !sameKeys(entry, ['id', 'package', 'reason', 'until'])) {
      errors.push(`${where} is not exactly {id, package, reason, until}`);
      return;
    }
    const { id, package: pkg, reason, until } = entry;
    if (typeof id !== 'string' || !GHSA.test(id)) errors.push(`${where}: id is not a GHSA identifier`);
    else if (ids.has(id)) errors.push(`${where}: ${id} is listed twice`);
    else ids.add(id);
    if (typeof pkg !== 'string' || pkg.trim() === '') errors.push(`${where}: package is empty`);
    if (typeof reason !== 'string' || reason.trim() === '') errors.push(`${where}: reason is empty`);
    const time = typeof until === 'string' && UNTIL.test(until) ? Date.parse(until) : Number.NaN;
    if (Number.isNaN(time) || new Date(time).toISOString() !== until.replace(/Z$/, '.000Z'))
      errors.push(`${where}: until is not a UTC timestamp YYYY-MM-DDTHH:MM:SSZ`);
    exceptions.push({ id, package: pkg, reason, until, untilMs: time });
  });
  return { exceptions: errors.length === 0 ? exceptions : [], errors };
}

/**
 * Decide an audit run. `npm` is { status, signal, error, stdout } as from spawnSync; `exceptions`
 * is parseExceptions' output; `now` a Date. Returns { ok, failures, excepted }.
 */
export function evaluate({ npm, exceptions, now }) {
  const failures = [...exceptions.errors];
  const excepted = [];
  const done = () => ({ ok: failures.length === 0, failures, excepted });

  if (npm.error) failures.push(`npm audit did not run: ${npm.error.message ?? npm.error}`);
  else if (npm.signal) failures.push(`npm audit was killed by ${npm.signal}`);
  else if (npm.status !== 0 && npm.status !== 1) failures.push(`npm audit exited ${npm.status}, not 0 or 1`);
  if (failures.length > 0) return done();

  let report;
  try {
    report = JSON.parse(npm.stdout);
  } catch {
    failures.push('npm audit output is not JSON');
    return done();
  }
  if (!isRecord(report)) failures.push('npm audit output is not a JSON object');
  else if ('error' in report) failures.push(`npm audit reported an error: ${JSON.stringify(report.error)}`);
  else if (report.auditReportVersion !== 2) failures.push('npm audit output is not auditReportVersion 2');
  else if (!isRecord(report.vulnerabilities)) failures.push('npm audit output has no vulnerabilities object');
  else if (!isRecord(report.metadata) || !isRecord(report.metadata.vulnerabilities))
    failures.push('npm audit output has no metadata.vulnerabilities counts');
  if (failures.length > 0) return done();

  // Rule 4: entries and their advisories.
  const entries = report.vulnerabilities;
  const advisories = new Map(); // `${id} ${package}` -> advisory
  const counts = Object.fromEntries(SEVERITIES.map((s) => [s, 0]));
  for (const [key, entry] of Object.entries(entries)) {
    if (!isRecord(entry) || entry.name !== key) {
      failures.push(`audit entry ${key}: malformed or its name is not its key`);
      continue;
    }
    if (!SEVERITIES.includes(entry.severity)) {
      failures.push(`audit entry ${key}: unknown severity ${JSON.stringify(entry.severity)}`);
      continue;
    }
    counts[entry.severity] += 1;
    if (!Array.isArray(entry.via) || entry.via.length === 0) {
      failures.push(`audit entry ${key}: via is not a non-empty list`);
      continue;
    }
    for (const via of entry.via) {
      if (typeof via === 'string') {
        if (!Object.hasOwn(entries, via))
          failures.push(`audit entry ${key}: via ${via}, which is not an entry`);
        continue;
      }
      const match = isRecord(via) && typeof via.url === 'string' ? ADVISORY_URL.exec(via.url) : null;
      if (!match || typeof via.name !== 'string' || !SEVERITIES.includes(via.severity)) {
        failures.push(`audit entry ${key}: an advisory without a GHSA URL, package or known severity`);
        continue;
      }
      const advisory = { id: match[1], package: via.name, severity: via.severity, title: via.title };
      // The same advisory may be listed more than once; it keeps its highest severity, so a later
      // lower listing never hides a higher one from rules 6 and 8 (ASTRA-69-R1).
      const key2 = `${advisory.id} ${advisory.package}`;
      const prior = advisories.get(key2);
      if (!prior || SEVERITIES.indexOf(advisory.severity) > SEVERITIES.indexOf(prior.severity))
        advisories.set(key2, advisory);
    }
  }
  if (failures.length > 0) return done();

  // Rule 3: the counts match the entries.
  const meta = report.metadata.vulnerabilities;
  const total = Object.keys(entries).length;
  for (const s of [...SEVERITIES, 'total']) {
    const want = s === 'total' ? total : counts[s];
    if (meta[s] !== want)
      failures.push(`npm audit metadata ${s} is ${JSON.stringify(meta[s])}, entries give ${want}`);
  }
  if (failures.length > 0) return done();

  // Rule 5: the exit code agrees.
  const failingEntries = Object.values(entries).filter((e) => FAILING.has(e.severity));
  if ((npm.status === 1) !== failingEntries.length > 0)
    failures.push(
      `npm audit exited ${npm.status} with ${failingEntries.length} entries at moderate or above`,
    );

  // Rule 6: every advisory at moderate or above is excepted or fails.
  const nowMs = now.getTime();
  for (const advisory of advisories.values()) {
    if (!FAILING.has(advisory.severity)) continue;
    const named = `${advisory.id} (${advisory.package}, ${advisory.severity}: ${advisory.title ?? 'no title'})`;
    const exception = exceptions.exceptions.find(
      (e) => e.id === advisory.id && e.package === advisory.package,
    );
    if (!exception) failures.push(`advisory ${named}`);
    else if (nowMs >= exception.untilMs)
      failures.push(`advisory ${named}: exception expired at ${exception.until}`);
    else excepted.push({ ...advisory, until: exception.until, reason: exception.reason });
  }

  // Rule 7: every failing entry is explained by an advisory at moderate or above.
  const reaches = (key, seen = new Set()) => {
    if (seen.has(key)) return false;
    seen.add(key);
    return entries[key].via.some((via) =>
      typeof via === 'string' ? reaches(via, seen) : FAILING.has(via.severity),
    );
  };
  for (const entry of failingEntries)
    if (!reaches(entry.name))
      failures.push(`audit entry ${entry.name} (${entry.severity}) reaches no advisory at moderate or above`);

  // Rule 8: no stale exception.
  for (const exception of exceptions.exceptions)
    if (!advisories.has(`${exception.id} ${exception.package}`))
      failures.push(
        `exception ${exception.id} (${exception.package}) names an advisory npm audit no longer reports: delete it`,
      );

  return done();
}

function main(argv) {
  if (argv.length > 0) {
    console.error('usage: node scripts/audit-dependencies.mjs (no arguments)');
    return 2;
  }
  let text;
  try {
    text = readFileSync(EXCEPTIONS_PATH, 'utf8');
  } catch (error) {
    console.error(`audit: cannot read ${EXCEPTIONS_PATH}: ${error.message}`);
    return 1;
  }
  const npm = spawnSync('npm', NPM_ARGS, {
    cwd: ROOT,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
    timeout: 5 * 60 * 1000,
    shell: process.platform === 'win32',
    stdio: ['ignore', 'pipe', 'inherit'],
  });
  const result = evaluate({ npm, exceptions: parseExceptions(text), now: new Date() });
  for (const e of result.excepted)
    console.log(`audit: excepted ${e.id} (${e.package}, ${e.severity}) until ${e.until}: ${e.reason}`);
  if (!result.ok) {
    for (const f of result.failures) console.error(`audit: FAIL ${f}`);
    return 1;
  }
  console.log(`audit: passed (npm ${NPM_ARGS.join(' ')}; ${result.excepted.length} excepted advisory)`);
  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  process.exitCode = main(process.argv.slice(2));
