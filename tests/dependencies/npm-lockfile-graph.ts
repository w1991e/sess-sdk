// A strict reader of npm's package-lock.json (lockfileVersion 3) and a walk over what a package
// installs at runtime: its dependencies, optionalDependencies and peerDependencies, transitively,
// resolved the way Node resolves them (the nearest node_modules up the tree). devDependencies are
// never followed. It fails closed: an unreadable lockfile, another lockfile version, a link or
// workspace entry, or a reference that resolves to no entry throws instead of being skipped, so a
// format change cannot make the walk silently find nothing. The one skip is a peer dependency that
// peerDependenciesMeta marks optional and that the lockfile does not install. runtimeChainsAllowing
// allows one family of routes inside a host peer's own npm and nothing else, checked route by route
// (Sess founder 2026-11-18 01:38Z and 02:01Z; ASTRA-69-R2).
// Used by dev-only-picomatch.test.ts (founder 2026-11-17 22:05Z item 1).

export type LockEntry = {
  name?: string;
  version?: string;
  dependencies?: Record<string, string>;
  optionalDependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
  peerDependenciesMeta?: Record<string, { optional?: boolean }>;
  devDependencies?: Record<string, string>;
};
export type Lock = { name: string; packages: Map<string, LockEntry> };
export type Edge = 'dependencies' | 'optionalDependencies' | 'peerDependencies' | 'devDependencies';

export const RUNTIME_EDGES: readonly Edge[] = ['dependencies', 'optionalDependencies', 'peerDependencies'];

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

const PATH = /^(?:node_modules\/(?:@[^/]+\/)?[^/@][^/]*)(?:\/node_modules\/(?:@[^/]+\/)?[^/@][^/]*)*$/;

export function parseLock(text: string, label: string): Lock {
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch (error) {
    throw new Error(`${label}: not JSON (${(error as Error).message})`);
  }
  if (!isRecord(json)) throw new Error(`${label}: not a lockfile object`);
  if (json.lockfileVersion !== 3) throw new Error(`${label}: lockfileVersion is not 3`);
  if (!isRecord(json.packages)) throw new Error(`${label}: no packages map`);
  const packages = new Map<string, LockEntry>();
  for (const [key, value] of Object.entries(json.packages)) {
    if (!isRecord(value)) throw new Error(`${label}: entry ${JSON.stringify(key)} is not an object`);
    if (key !== '' && !PATH.test(key))
      throw new Error(
        `${label}: entry ${JSON.stringify(key)} is not a node_modules path (workspace or link)`,
      );
    if (value.link === true) throw new Error(`${label}: entry ${key} is a link, not read`);
    for (const edge of [...RUNTIME_EDGES, 'devDependencies', 'peerDependenciesMeta'] as const) {
      const field = value[edge];
      if (field === undefined) continue;
      if (!isRecord(field)) throw new Error(`${label}: ${key || '(root)'} ${edge} is not an object`);
    }
    packages.set(key, value as LockEntry);
  }
  const root = packages.get('');
  if (!root) throw new Error(`${label}: no root entry`);
  if (typeof root.name !== 'string') throw new Error(`${label}: the root entry has no name`);
  return { name: root.name, packages };
}

/** The directory whose node_modules Node searches next: the parent package of `from`. */
const parentOf = (from: string): string | null => {
  if (from === '') return null;
  const at = from.lastIndexOf('node_modules/');
  return at <= 0 ? '' : from.slice(0, at - 1);
};

/** The lockfile entry Node loads for `name` required from the package at `from`, or null. */
export function resolve(lock: Lock, from: string, name: string): string | null {
  for (let dir: string | null = from; dir !== null; dir = parentOf(dir)) {
    const key = `${dir === '' ? '' : `${dir}/`}node_modules/${name}`;
    if (lock.packages.has(key)) return key;
  }
  return null;
}

/** The installed package's real name: its recorded name (an alias records it), else its path. */
export const packageName = (key: string, entry: LockEntry): string =>
  entry.name ?? key.slice(key.lastIndexOf('node_modules/') + 'node_modules/'.length);

type Hit = { key: string; chain: string };
/** Which of the root's own edges a walk starts from: all, all but one peer, or that peer only. */
type RootFilter =
  { kind: 'all' } | { kind: 'withoutPeer'; peer: string } | { kind: 'onlyPeer'; peer: string };

const startsHere = (filter: RootFilter, edge: Edge, name: string): boolean => {
  if (filter.kind === 'all') return true;
  const isPeer = edge === 'peerDependencies' && name === filter.peer;
  return filter.kind === 'onlyPeer' ? isPeer : !isPeer;
};

/**
 * Every lockfile entry named `wanted` (by real name or by the name it is installed under) reachable
 * from the root's `rootEdges`, then through every entry's runtime edges, each with the first chain
 * that reaches it: "root > name@version > ... > wanted@version". Each entry is reported once.
 */
export function chainsTo(lock: Lock, rootEdges: readonly Edge[], wanted: string): string[] {
  return hitsOf(lock, rootEdges, wanted, { kind: 'all' }).map((hit) => hit.chain);
}

/**
 * The lockfile entry a named chain of packages ends at, or null if the lockfile does not hold that
 * exact chain: the root declares `names[0]` as a peer dependency, each later name is in the
 * `dependencies` of the one before, each resolves the way Node resolves it, and each installed
 * package's real name is the name in the chain (an alias does not match).
 */
export function chainEnd(lock: Lock, names: readonly string[]): string | null {
  if (names.length === 0) return null;
  let from = '';
  for (const [index, name] of names.entries()) {
    const entry = lock.packages.get(from) as LockEntry;
    const declared = index === 0 ? entry.peerDependencies : entry.dependencies;
    if (declared?.[name] === undefined) return null;
    const key = resolve(lock, from, name);
    if (key === null || packageName(key, lock.packages.get(key) as LockEntry) !== name) return null;
    from = key;
  }
  return from;
}

/**
 * The host's own routes that may reach `wanted` (Sess founder 2026-11-18 02:01Z, option 1): a route
 * enters through the root's peer `peer` and then its `dependencies` edge to `enter`, stays inside
 * `enter`'s own install directory, and reaches `wanted` only through one of `tails` (each step's
 * package and edge), ending at the one installed copy that `[peer, enter, ...tails[0]]` ends at.
 */
export type HostFamily = {
  peer: string;
  enter: string;
  tails: readonly (readonly { name: string; edges: readonly Edge[] }[])[];
};

/**
 * A package's runtime chains to `wanted`, with one family of host-peer routes allowed. Two walks:
 *  - the root's dependencies, optionalDependencies and every other peer: every `wanted` reached
 *    here is `found`, by whatever chain, so the package's own graph never uses the allowance;
 *  - the host peer alone: every distinct runtime route to a `wanted` entry is enumerated, not only
 *    the first route to each entry (ASTRA-69-R2), so a second route to the same installed copy is
 *    checked on its own. A route is `allowed` only when it is in `family` (HostFamily); every
 *    other route under the host, to the same copy or another, is `found`.
 * With no family, nothing is allowed. With a family whose named chain the lockfile no longer
 * holds, nothing under the host is allowed.
 */
export function runtimeChainsAllowing(
  lock: Lock,
  wanted: string,
  family?: HostFamily,
): { found: string[]; allowed: string[] } {
  if (family === undefined) return { found: chainsTo(lock, RUNTIME_EDGES, wanted), allowed: [] };
  const first = family.tails[0];
  if (
    first === undefined ||
    family.tails.some((tail) => tail.length === 0 || tail[tail.length - 1]?.name !== wanted)
  )
    throw new Error(`host family under ${family.peer} has a tail that does not end at ${wanted}`);
  const own = hitsOf(lock, RUNTIME_EDGES, wanted, { kind: 'withoutPeer', peer: family.peer });
  const found = own.map((hit) => hit.chain);
  const allowed: string[] = [];
  const copy = chainEnd(lock, [family.peer, family.enter, ...first.map((step) => step.name)]);
  const inside = `${resolve(lock, resolve(lock, '', family.peer) ?? '', family.enter) ?? '\0'}/node_modules/`;
  const inFamily = (route: Step[]): boolean => {
    const [peerStep, enterStep, ...rest] = route;
    if (copy === null || peerStep === undefined || enterStep === undefined) return false;
    if (peerStep.edge !== 'peerDependencies' || peerStep.name !== family.peer) return false;
    if (enterStep.edge !== 'dependencies' || enterStep.name !== family.enter) return false;
    if (route.some((step) => step.real !== step.name)) return false;
    if (!rest.every((step) => step.key.startsWith(inside))) return false;
    if (route[route.length - 1]?.key !== copy) return false;
    return family.tails.some((tail) => {
      if (rest.length < tail.length) return false;
      const middle = rest.slice(0, rest.length - tail.length);
      const end = rest.slice(rest.length - tail.length);
      return (
        middle.every((step) => step.edge === 'dependencies' && step.name !== wanted) &&
        end.every((step, i) => step.name === tail[i]?.name && (tail[i]?.edges ?? []).includes(step.edge))
      );
    });
  };
  for (const route of hostPaths(lock, family.peer, wanted))
    (inFamily(route) ? allowed : found).push([lock.name, ...route.map((step) => step.label)].join(' > '));
  return { found, allowed };
}

type Step = { key: string; name: string; real: string; edge: Edge; label: string };

/**
 * Every distinct runtime path from the root's peer `peer` to an entry named `wanted`, with
 * path-local cycle protection. Only entries from which `wanted` is reachable are entered, so the
 * enumeration stays within the routes that matter. Fails closed as hitsOf does.
 */
function hostPaths(lock: Lock, peer: string, wanted: string): Step[][] {
  const stepsFrom = (from: string, edges: readonly Edge[], chain: string): Step[] => {
    const entry = lock.packages.get(from) as LockEntry;
    const steps: Step[] = [];
    for (const edge of edges)
      for (const name of Object.keys(entry[edge] ?? {})) {
        if (from === '' && !(edge === 'peerDependencies' && name === peer)) continue;
        const key = resolve(lock, from, name);
        if (key === null) {
          if (edge === 'peerDependencies' && entry.peerDependenciesMeta?.[name]?.optional === true) continue;
          throw new Error(`${chain}: ${edge} ${name} resolves to no lockfile entry`);
        }
        const target = lock.packages.get(key) as LockEntry;
        const real = packageName(key, target);
        const label = `${real}@${target.version ?? '?'}${edge === 'peerDependencies' ? ' (peer)' : ''}`;
        steps.push({ key, name, real, edge, label });
      }
    return steps;
  };
  // Which entries reach `wanted` (memoised; a node on the current stack counts as not reaching).
  const reaches = new Map<string, boolean>();
  const reach = (key: string, stack: Set<string>): boolean => {
    const known = reaches.get(key);
    if (known !== undefined) return known;
    if (stack.has(key)) return false;
    stack.add(key);
    let hit = false;
    for (const step of stepsFrom(key, RUNTIME_EDGES, key))
      if (step.real === wanted || step.name === wanted || reach(step.key, stack)) hit = true;
    stack.delete(key);
    reaches.set(key, hit);
    return hit;
  };
  const paths: Step[][] = [];
  const walk = (from: string, edges: readonly Edge[], path: Step[], onPath: Set<string>): void => {
    for (const step of stepsFrom(from, edges, [lock.name, ...path.map((p) => p.label)].join(' > '))) {
      if (onPath.has(step.key)) continue;
      const next = [...path, step];
      if (step.real === wanted || step.name === wanted) paths.push(next);
      if (!reach(step.key, new Set())) continue;
      onPath.add(step.key);
      walk(step.key, RUNTIME_EDGES, next, onPath);
      onPath.delete(step.key);
    }
  };
  walk('', ['peerDependencies'], [], new Set());
  return paths;
}

function hitsOf(lock: Lock, rootEdges: readonly Edge[], wanted: string, filter: RootFilter): Hit[] {
  const found: Hit[] = [];
  const seen = new Set<string>();
  const queue: { key: string; chain: string[] }[] = [];
  const visit = (from: string, edges: readonly Edge[], chain: string[]): void => {
    const entry = lock.packages.get(from) as LockEntry;
    for (const edge of edges) {
      for (const name of Object.keys(entry[edge] ?? {})) {
        if (from === '' && !startsHere(filter, edge, name)) continue;
        const key = resolve(lock, from, name);
        if (key === null) {
          if (edge === 'peerDependencies' && entry.peerDependenciesMeta?.[name]?.optional === true) continue;
          throw new Error(`${chain.join(' > ')}: ${edge} ${name} resolves to no lockfile entry`);
        }
        if (seen.has(key)) continue;
        seen.add(key);
        const target = lock.packages.get(key) as LockEntry;
        const real = packageName(key, target);
        const label = `${real}@${target.version ?? '?'}${edge === 'peerDependencies' ? ' (peer)' : ''}`;
        const next = [...chain, label];
        if (real === wanted || name === wanted) found.push({ key, chain: next.join(' > ') });
        queue.push({ key, chain: next });
      }
    }
  };
  visit('', rootEdges, [lock.name]);
  while (queue.length > 0) {
    const node = queue.shift() as { key: string; chain: string[] };
    visit(node.key, RUNTIME_EDGES, node.chain);
  }
  return found;
}
