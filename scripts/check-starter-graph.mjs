// The starter's installed runtime graph reaches no picomatch (founder 2026-11-17 22:05Z item 1;
// ASTRA-70-R1).
//
//   node scripts/check-starter-graph.mjs <package-lock.json>
//
// The starter (create-agent/template) ships no lockfile: a user's `npm install` resolves the
// published SDK's transitive ranges at install time, so the SDK's direct pins and the root
// lockfile do not establish the graph a starter user gets. This reads the lockfile a real starter
// install produced (create-agent/scripts/clean-install-check.mjs runs it on each install it makes)
// and walks what the starter loads at runtime: dependencies, optionalDependencies and
// peerDependencies, transitively, resolved the way Node resolves them (the nearest node_modules up
// the tree). devDependencies are never followed. Any picomatch reached, by its real name or the
// name it is installed under, fails; the starter has no host-peer allowance.
//
// It fails closed: unreadable or non-JSON input, another lockfile version, a link or workspace
// entry, a reference that resolves to no entry, or a root that does not install @sess.si/sdk is
// an error, not a pass. The one skip is a peer dependency that peerDependenciesMeta marks optional
// and that the lockfile does not install. The walk is a JS port of tests/dependencies/
// npm-lockfile-graph.ts (parseLock and chainsTo); tests/dependencies/starter-graph.test.ts checks
// the two agree.
import { readFileSync } from 'node:fs';
import { resolve as resolvePath } from 'node:path';
import { pathToFileURL } from 'node:url';

export const WANTED = 'picomatch';
export const SDK = '@sess.si/sdk';
const RUNTIME_EDGES = ['dependencies', 'optionalDependencies', 'peerDependencies'];
const PATH = /^(?:node_modules\/(?:@[^/]+\/)?[^/@][^/]*)(?:\/node_modules\/(?:@[^/]+\/)?[^/@][^/]*)*$/;
const isRecord = (v) => typeof v === 'object' && v !== null && !Array.isArray(v);

/** A strict reader of a lockfileVersion 3 package-lock.json; throws on anything else. */
export function parseLock(text, label) {
  let json;
  try {
    json = JSON.parse(text);
  } catch (error) {
    throw new Error(`${label}: not JSON (${error.message})`);
  }
  if (!isRecord(json)) throw new Error(`${label}: not a lockfile object`);
  if (json.lockfileVersion !== 3) throw new Error(`${label}: lockfileVersion is not 3`);
  if (!isRecord(json.packages)) throw new Error(`${label}: no packages map`);
  const packages = new Map();
  for (const [key, value] of Object.entries(json.packages)) {
    if (!isRecord(value)) throw new Error(`${label}: entry ${JSON.stringify(key)} is not an object`);
    if (key !== '' && !PATH.test(key))
      throw new Error(
        `${label}: entry ${JSON.stringify(key)} is not a node_modules path (workspace or link)`,
      );
    if (value.link === true) throw new Error(`${label}: entry ${key} is a link, not read`);
    for (const edge of [...RUNTIME_EDGES, 'devDependencies', 'peerDependenciesMeta']) {
      const field = value[edge];
      if (field === undefined) continue;
      if (!isRecord(field)) throw new Error(`${label}: ${key || '(root)'} ${edge} is not an object`);
    }
    packages.set(key, value);
  }
  const root = packages.get('');
  if (!root) throw new Error(`${label}: no root entry`);
  if (typeof root.name !== 'string') throw new Error(`${label}: the root entry has no name`);
  return { name: root.name, packages };
}

const parentOf = (from) => {
  if (from === '') return null;
  const at = from.lastIndexOf('node_modules/');
  return at <= 0 ? '' : from.slice(0, at - 1);
};

function resolveFrom(lock, from, name) {
  for (let dir = from; dir !== null; dir = parentOf(dir)) {
    const key = `${dir === '' ? '' : `${dir}/`}node_modules/${name}`;
    if (lock.packages.has(key)) return key;
  }
  return null;
}

const packageName = (key, entry) =>
  entry.name ?? key.slice(key.lastIndexOf('node_modules/') + 'node_modules/'.length);

/**
 * Every entry named `wanted` reachable from the root's runtime edges, each with the first chain
 * that reaches it: "root > name@version > ... > wanted@version".
 */
export function runtimeChains(lock, wanted) {
  const found = [];
  const seen = new Set();
  const queue = [];
  const visit = (from, chain) => {
    const entry = lock.packages.get(from);
    for (const edge of RUNTIME_EDGES) {
      for (const name of Object.keys(entry[edge] ?? {})) {
        const key = resolveFrom(lock, from, name);
        if (key === null) {
          if (edge === 'peerDependencies' && entry.peerDependenciesMeta?.[name]?.optional === true) continue;
          throw new Error(`${chain.join(' > ')}: ${edge} ${name} resolves to no lockfile entry`);
        }
        if (seen.has(key)) continue;
        seen.add(key);
        const target = lock.packages.get(key);
        const real = packageName(key, target);
        const label = `${real}@${target.version ?? '?'}${edge === 'peerDependencies' ? ' (peer)' : ''}`;
        const next = [...chain, label];
        if (real === wanted || name === wanted) found.push(next.join(' > '));
        queue.push({ key, chain: next });
      }
    }
  };
  visit('', [lock.name]);
  while (queue.length > 0) {
    const node = queue.shift();
    visit(node.key, node.chain);
  }
  return found;
}

/**
 * The picomatch chains in a starter install's lockfile text (empty when none). Throws when the
 * lockfile is unreadable or is not a starter install of @sess.si/sdk, so the walk is never vacuous.
 */
export function starterChains(text, label) {
  const lock = parseLock(text, label);
  const root = lock.packages.get('');
  if (typeof root.dependencies?.[SDK] !== 'string')
    throw new Error(`${label}: the root does not depend on ${SDK}; not a starter install`);
  const sdk = lock.packages.get(`node_modules/${SDK}`);
  if (!sdk || packageName(`node_modules/${SDK}`, sdk) !== SDK)
    throw new Error(`${label}: ${SDK} is not installed at node_modules/${SDK}`);
  return runtimeChains(lock, WANTED);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolvePath(process.argv[1])).href) {
  const args = process.argv.slice(2);
  if (args.length !== 1) {
    console.error('usage: node scripts/check-starter-graph.mjs <package-lock.json>');
    process.exit(2);
  }
  try {
    const chains = starterChains(readFileSync(args[0], 'utf8'), args[0]);
    if (chains.length) {
      console.error(`check-starter-graph: ${WANTED} is in the starter's runtime graph:`);
      for (const chain of chains) console.error(`  ${chain}`);
      process.exit(1);
    }
    console.log(`check-starter-graph: no ${WANTED} in the starter's installed runtime graph`);
  } catch (error) {
    console.error(`check-starter-graph: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  }
}
