// Starter template parity (not packed).
//
//   node create-agent/scripts/check-parity.mjs [<starter directory>]
//
// Always checks the single template source in create-agent/template:
// - its package.json is private, has only exact dependency versions, depends on @sess.si/sdk at
//   exactly the version pinned in release/sdk-candidate.json, and has no script but `start`;
// - the initializer's package.json has no scripts at all and packs the template.
// With a directory (a generated agent, or a checkout of the public sess-agent-starter repository),
// it also checks that every template file is there with identical bytes (package.json may differ
// only in its name) and that nothing else is, apart from a lockfile, .git, .github, node_modules, the weather cache
// and the starter repository's own agent instructions (AGENTS.md, and CLAUDE.md importing it).
// The test suite runs it on every `npm test`; sdk-pin.mjs keeps the version pin itself current.
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
export const TEMPLATE = resolve(here, '..', 'template');
const ROOT = resolve(here, '..', '..');
const EXACT = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;
const EXTRA = new Set([
  'package-lock.json',
  '.git',
  '.github',
  'node_modules',
  '.weather-cache.json',
  'AGENTS.md',
  'CLAUDE.md',
]);

/** Template file name -> generated name. Dotfiles are stored as `_name` so that npm packs them. */
export function templateFiles() {
  return Object.fromEntries(
    readdirSync(TEMPLATE)
      .sort()
      .map((name) => [name, name.startsWith('_') ? `.${name.slice(1)}` : name]),
  );
}

/** Returns a list of problems (empty when everything agrees). */
export function checkParity(starter) {
  const problems = [];
  const json = (path) => JSON.parse(readFileSync(path, 'utf8'));
  const pin = json(join(ROOT, 'release', 'sdk-candidate.json'));
  const template = json(join(TEMPLATE, 'package.json'));
  const initializer = json(join(ROOT, 'create-agent', 'package.json'));
  if (template.private !== true) problems.push('template package.json must be private');
  for (const [name, version] of Object.entries(template.dependencies ?? {}))
    if (!EXACT.test(version))
      problems.push(`template dependency ${name} is not an exact version: ${version}`);
  if (template.dependencies?.[pin.name] !== pin.version)
    problems.push(`template ${pin.name} must be exactly the pinned ${pin.version}`);
  if (template.devDependencies || template.optionalDependencies || template.peerDependencies)
    problems.push('template package.json must have only dependencies');
  if (JSON.stringify(template.scripts) !== JSON.stringify({ start: 'node agent.mjs' }))
    problems.push('template scripts must be exactly { "start": "node agent.mjs" }');
  if (initializer.scripts !== undefined) problems.push('create-agent package.json must have no scripts');
  if (!initializer.files?.includes('template/')) problems.push('create-agent must pack template/');

  if (starter !== undefined) {
    const files = templateFiles();
    const written = new Set(Object.values(files));
    for (const [from, to] of Object.entries(files)) {
      let actual;
      try {
        actual = readFileSync(join(starter, to), 'utf8');
      } catch {
        problems.push(`${to} is missing`);
        continue;
      }
      let expected = readFileSync(join(TEMPLATE, from), 'utf8');
      if (from === 'package.json') {
        const name = /"name": ("[^"]*")/.exec(actual)?.[1] ?? '""';
        expected = expected.replace('"name": "sess-agent"', `"name": ${name}`);
      }
      if (actual !== expected) problems.push(`${to} differs from create-agent/template/${from}`);
    }
    for (const name of readdirSync(starter))
      if (!written.has(name) && !EXTRA.has(name)) problems.push(`${name} is not part of the template`);
  }
  return problems;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const args = process.argv.slice(2);
  if (args.length > 1) {
    console.error('usage: node create-agent/scripts/check-parity.mjs [<starter directory>]');
    process.exit(2);
  }
  const problems = checkParity(args[0] && resolve(args[0]));
  for (const problem of problems) console.error(`check-parity: ${problem}`);
  if (problems.length) process.exit(1);
  console.log(`check-parity: template ${args[0] ? `and ${args[0]} ` : ''}agree with the SDK pin.`);
}
