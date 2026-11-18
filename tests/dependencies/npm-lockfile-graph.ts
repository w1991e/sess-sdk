// A strict reader of npm's package-lock.json (lockfileVersion 3) and a walk over what a package
// installs at runtime: its dependencies, optionalDependencies and peerDependencies, transitively,
// resolved the way Node resolves them (the nearest node_modules up the tree). devDependencies are
// never followed. It fails closed: an unreadable lockfile, another lockfile version, a link or
// workspace entry, or a reference that resolves to no entry throws instead of being skipped, so a
// format change cannot make the walk silently find nothing. The one skip is a peer dependency that
// peerDependenciesMeta marks optional and that the lockfile does not install. runtimeChainsAllowing
// allows one named chain under a host peer and nothing else (Sess founder 2026-11-18 01:38Z).
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
 * A package's runtime chains to `wanted`, with at most one host-peer path allowed. `hostPath` names
 * a chain from the root's peer `hostPath[0]` (the host application) to `wanted`. Two walks:
 *  - the root's dependencies, optionalDependencies and every other peer: every `wanted` reached
 *    here is `found`, by whatever chain, so the package's own graph never uses the allowance;
 *  - the host peer alone: the one `wanted` entry the named chain ends at is `allowed`; any other
 *    `wanted` entry under the host (another copy, by another chain) is `found`.
 * With no host path, or a lockfile that no longer holds that exact chain, nothing is allowed.
 */
export function runtimeChainsAllowing(
  lock: Lock,
  wanted: string,
  hostPath?: readonly string[],
): { found: string[]; allowed: string[] } {
  if (hostPath === undefined) return { found: chainsTo(lock, RUNTIME_EDGES, wanted), allowed: [] };
  const peer = hostPath[0];
  if (peer === undefined || hostPath.length < 2 || hostPath[hostPath.length - 1] !== wanted)
    throw new Error(`host path ${hostPath.join(' > ')} does not run from a peer to ${wanted}`);
  const own = hitsOf(lock, RUNTIME_EDGES, wanted, { kind: 'withoutPeer', peer });
  const host = hitsOf(lock, ['peerDependencies'], wanted, { kind: 'onlyPeer', peer });
  const end = chainEnd(lock, hostPath);
  return {
    found: [...own, ...host.filter((hit) => hit.key !== end)].map((hit) => hit.chain),
    allowed: host.filter((hit) => hit.key === end).map((hit) => hit.chain),
  };
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
