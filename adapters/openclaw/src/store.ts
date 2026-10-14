import { createHash } from 'node:crypto';
import type { InteractiveInteraction } from '@sess.si/sdk';
import { SessAdapterError, fail } from './errors.js';
import type { HostBinding, InvocationLease } from './host.js';
import { canonicalJson } from './internal/shared.js';

/** Shared recovery-state names (adapters/CONTRACT.md). */
export type RecoveryState =
  | 'create_intent'
  | 'create_unknown'
  | 'waiting'
  | 'answered'
  | 'publish_pending'
  | 'complete_pending'
  | 'completed'
  | 'needs_resume'
  | 'blocked';

/** No tool transition leaves these; they are archived out of active admission. */
export const TERMINAL_STATES: ReadonlySet<RecoveryState> = new Set(['completed', 'blocked']);

/** The exact saved replay identity of a publish/complete; never recalculated (spec 8.6). */
export interface PendingMutation {
  readonly operation: 'publish' | 'complete';
  readonly ifMatch: string;
  readonly idempotencyKey: string;
  readonly body?: { readonly interaction: InteractiveInteraction };
  readonly fromRevision: number;
  readonly responseEventId: string;
  readonly credentialGeneration: string;
}

export interface ConfirmedMutation {
  readonly operation: 'publish' | 'complete';
  readonly expectedRevision: number;
  readonly responseEventId: string;
  /** sha256 of the canonical JSON body; publish only (complete has no body). */
  readonly bodyDigest?: string;
}

/** Layout schema 2 interaction record. Schema 1 lived only in the legacy namespace. */
export interface RecoveryRecord {
  readonly kind: 'interaction';
  readonly schema: 2;
  readonly handle: string;
  /** Create-claim key of the host call that created this interaction (archived together). */
  readonly claimKey?: string;
  readonly binding: HostBinding;
  readonly origin: string;
  readonly credentialGeneration: string;
  readonly state: RecoveryState;
  /** Incremented on every accepted update; part of compare-and-apply. */
  readonly generation: number;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly sessionId?: string;
  /** Bearer capability. Private host state only; never logged or put in diagnostics. */
  readonly humanUrl?: string;
  readonly revision?: number;
  readonly answered?: { readonly eventId: string; readonly actionId: string; readonly revision: number };
  readonly pending?: PendingMutation;
  /** Identity of the last confirmed publish/complete, kept for exact-repeat answers (contract "Replay"). */
  readonly lastMutation?: ConfirmedMutation;
  readonly blockedReason?: string;
}

/** A create claim is the durable replay identity of one host tool call. It is never deleted. */
interface CreateClaim {
  readonly kind: 'claim';
  readonly schema: 2;
  readonly handle: string;
}

/** Left in the legacy namespace for every migrated key, so an older plugin stops on it. */
interface LegacyMarker {
  readonly kind: 'migrated';
  readonly schema: 2;
}

/** Fills remaining legacy capacity, so an older plugin cannot admit new work after upgrade. */
interface LegacyFence {
  readonly kind: 'fence';
  readonly schema: 2;
}

type Stored = RecoveryRecord | CreateClaim | LegacyMarker | LegacyFence | Record<string, unknown>;

// ---------------------------------------------------------------- host capability boundary

type CompareIntent =
  { operation: 'update'; action: 'set'; value: Stored } | { operation: 'delete'; action: 'delete' };

/** Public OpenClaw 2026.10.3 PluginStateKeyedStore<T, 2> operations this adapter requires. */
export interface BoundStore {
  observe(key: string): Promise<{ value: Stored | undefined; comparison: string }>;
  compareAndApply(
    key: string,
    comparison: string,
    intent: CompareIntent,
  ): Promise<{ status: 'applied' | 'unchanged' } | { status: 'conflict' }>;
  registerIfAbsent(key: string, value: Stored): Promise<boolean>;
  lookup(key: string): Promise<Stored | undefined>;
  entries(): Promise<{ key: string; value: Stored }[]>;
  moveEntriesFrom(source: {
    namespace: string;
    entries: { sourceKey: string; targetKey: string }[];
  }): Promise<number>;
}

export interface HostKeyedStore {
  withCurrent?: (authority: { assertCurrent: () => void }) => unknown;
  entries?: () => Promise<{ key: string; value: unknown }[]>;
  entriesInKeyRange?: (range: {
    keyStartInclusive: string;
    keyEndExclusive: string;
    limit: number;
    order?: 'asc' | 'desc';
  }) => Promise<{ key: string; value: unknown }[]>;
  observe?: BoundStore['observe'];
  compareAndApply?: BoundStore['compareAndApply'];
}

export interface HostStateRuntime {
  openKeyedStore?: (
    options:
      | { namespace: string; maxEntries: number; overflowPolicy: 'reject-new' }
      | { namespace: string; retention: 'retained' },
  ) => HostKeyedStore;
}

/** Pre-upgrade layout (schema 1): one bounded namespace for claims and records. */
export const LEGACY_OPTIONS = Object.freeze({
  namespace: 'interactions-v1',
  maxEntries: 2200,
  overflowPolicy: 'reject-new' as const,
});
/** Active admission (schema 2): non-terminal interactions and their claims; bounded, never evicting. */
export const ACTIVE_OPTIONS = Object.freeze({
  namespace: 'active-v2',
  maxEntries: 2200,
  overflowPolicy: 'reject-new' as const,
});
/** Terminal interactions and their create-claim replay tombstones; retained, outside admission. */
export const ARCHIVE_OPTIONS = Object.freeze({ namespace: 'archive-v2', retention: 'retained' as const });

export interface HostStores {
  readonly legacy: HostKeyedStore;
  readonly active: HostKeyedStore;
  readonly archive: HostKeyedStore;
}

const BOUND_REQUIRED = [
  'observe',
  'compareAndApply',
  'registerIfAbsent',
  'lookup',
  'entries',
  'moveEntriesFrom',
] as const;

/**
 * Opens the three namespaces. A host without retained keyed state, live-authority binding or the
 * bound data operations (including the atomic move) blocks this profile: there is no fallback to an
 * evicting store, an empty namespace or deletion of replay identities.
 */
export function openHostStores(state: HostStateRuntime | undefined): HostStores {
  if (!state || typeof state.openKeyedStore !== 'function')
    fail('HOST_CAPABILITY_MISSING', 'This OpenClaw host does not provide durable plugin state.');
  const open = (options: Parameters<NonNullable<HostStateRuntime['openKeyedStore']>>[0]) => {
    let store: HostKeyedStore | undefined;
    try {
      store = state.openKeyedStore!({ ...options });
    } catch {
      fail('HOST_CAPABILITY_MISSING', 'This OpenClaw host cannot open the required plugin state.');
    }
    if (!store || typeof store.withCurrent !== 'function')
      fail(
        'HOST_CAPABILITY_MISSING',
        'This OpenClaw host cannot bind plugin state writes to live invocation authority.',
      );
    return store;
  };
  return Object.freeze({
    legacy: open(LEGACY_OPTIONS),
    active: open(ACTIVE_OPTIONS),
    archive: open(ARCHIVE_OPTIONS),
  });
}

function bind(store: HostKeyedStore, lease: InvocationLease): BoundStore {
  const bound = store.withCurrent?.({ assertCurrent: lease.assertCurrent }) as
    Partial<BoundStore> | undefined;
  for (const name of BOUND_REQUIRED)
    if (!bound || typeof bound[name] !== 'function')
      fail(
        'HOST_CAPABILITY_MISSING',
        'This OpenClaw host lacks atomic compare-and-apply, retained state or atomic move for plugin state.',
      );
  return bound as BoundStore;
}

function storeError(error: unknown): never {
  if (error instanceof SessAdapterError) throw error;
  const code = (error as { code?: unknown } | null)?.code;
  if (typeof code === 'string' && /LIMIT|FULL|QUOTA|CAPACITY/i.test(code))
    fail(
      'STORE_FULL',
      'The SESS plugin has reached its active-interaction limit; no interaction was dropped.',
    );
  fail(
    'STORE_UNAVAILABLE',
    'Durable plugin state refused or failed this operation; nothing further was sent.',
  );
}

const isLimit = (error: unknown) => {
  const code = (error as { code?: unknown } | null)?.code;
  return typeof code === 'string' && /LIMIT/i.test(code);
};

export const recordKey = (handle: string) => `i:${handle}`;
const fenceKey = (n: number) => `fence:${String(n).padStart(5, '0')}`;

export function claimKey(binding: HostBinding, toolCallId: string): string {
  return `c:${createHash('sha256')
    .update(JSON.stringify([binding.agentId, binding.sessionKey, binding.sessionId, toolCallId]))
    .digest('base64url')}`;
}

function isRecordShape(value: unknown, schema: 1 | 2): value is RecoveryRecord {
  if (!value || typeof value !== 'object') return false;
  const r = value as Record<string, unknown>;
  const b = r.binding as Record<string, unknown> | undefined;
  return (
    r.kind === 'interaction' &&
    r.schema === schema &&
    typeof r.handle === 'string' &&
    typeof r.state === 'string' &&
    Number.isSafeInteger(r.generation) &&
    typeof r.origin === 'string' &&
    typeof r.credentialGeneration === 'string' &&
    !!b &&
    typeof b.agentId === 'string' &&
    typeof b.sessionKey === 'string' &&
    typeof b.sessionId === 'string'
  );
}
const isClaim = (value: unknown, schema: 1 | 2): value is CreateClaim =>
  !!value &&
  typeof value === 'object' &&
  (value as Record<string, unknown>).kind === 'claim' &&
  (value as Record<string, unknown>).schema === schema &&
  typeof (value as Record<string, unknown>).handle === 'string';
const isLegacyOnly = (value: unknown) =>
  !!value &&
  typeof value === 'object' &&
  ((value as Record<string, unknown>).kind === 'migrated' ||
    (value as Record<string, unknown>).kind === 'fence');

// ---------------------------------------------------------------- schema 1 -> 2 upgrade

export interface UpgradeReport {
  readonly migratedRecords: number;
  readonly migratedClaims: number;
  readonly preservedUnknown: number;
  readonly archivedTerminal: number;
  readonly fenceRows: number;
}

/**
 * The concrete schema 1 -> 2 profile upgrade. Every legacy schema-1 claim and record is copied
 * into the v2 layout (terminal ones into the retained archive), destination collisions are checked
 * first, and only then is the legacy key replaced by a migration marker under compare-and-apply.
 * Each key is independent, so an interrupted run resumes and a repeated run changes nothing.
 * Unknown legacy values are left exactly as they are. Remaining legacy capacity is then filled with
 * fence rows so an older plugin version cannot admit new work on the legacy layout.
 */
async function upgradeLegacy(views: { legacy: BoundStore; active: BoundStore; archive: BoundStore }) {
  const { legacy, active, archive } = views;
  const rows = await legacy.entries();
  const claimOf = new Map<string, string>();
  const records: { key: string; value: RecoveryRecord }[] = [];
  const claims: { key: string; value: CreateClaim }[] = [];
  let preservedUnknown = 0;
  for (const { key, value } of rows) {
    if (isClaim(value, 1)) {
      claims.push({ key, value });
      claimOf.set(value.handle, key);
    } else if (isRecordShape(value, 1)) records.push({ key, value });
    else if (!isLegacyOnly(value)) preservedUnknown++;
  }
  const terminalHandles = new Set(
    records.filter((r) => TERMINAL_STATES.has(r.value.state)).map((r) => r.value.handle),
  );
  const copy = async (dest: BoundStore, key: string, value: Stored) => {
    if (await dest.registerIfAbsent(key, value)) return;
    const existing = await dest.lookup(key);
    if (existing === undefined || canonicalJson(existing) !== canonicalJson(value))
      fail(
        'STORE_UNAVAILABLE',
        'The SESS state upgrade stopped at a destination collision; nothing was overwritten. Operator resolution is required.',
      );
  };
  const mark = async (key: string, original: Stored) => {
    const observed = await legacy.observe(key);
    if (observed.value === undefined || isLegacyOnly(observed.value)) return;
    if (canonicalJson(observed.value) !== canonicalJson(original))
      fail('STATE_CONFLICT', 'A legacy SESS record changed during the upgrade; retry.');
    const result = await legacy.compareAndApply(key, observed.comparison, {
      operation: 'update',
      action: 'set',
      value: { kind: 'migrated', schema: 2 },
    });
    if (result.status === 'conflict')
      fail('STATE_CONFLICT', 'A legacy SESS record changed during the upgrade; retry.');
  };
  for (const { key, value } of records) {
    const upgraded: RecoveryRecord = {
      ...value,
      schema: 2,
      ...(claimOf.has(value.handle) ? { claimKey: claimOf.get(value.handle) } : {}),
    };
    await copy(TERMINAL_STATES.has(value.state) ? archive : active, key, upgraded);
    await mark(key, value);
  }
  for (const { key, value } of claims) {
    // Placed with its record: decided from the legacy record or, after an interrupted run, from
    // where the already migrated record now lives.
    const archived =
      terminalHandles.has(value.handle) || (await archive.lookup(recordKey(value.handle))) !== undefined;
    await copy(archived ? archive : active, key, { ...value, schema: 2 });
    await mark(key, value);
  }
  // Capacity fence for older plugin versions (documented reject-new behavior at maxEntries).
  let fenceRows = 0;
  for (let n = 0; n < LEGACY_OPTIONS.maxEntries; n++) {
    try {
      if (await legacy.registerIfAbsent(fenceKey(n), { kind: 'fence', schema: 2 })) fenceRows++;
    } catch (error) {
      if (isLimit(error)) break;
      throw error;
    }
  }
  const archivedTerminal = await archiveTerminalSweep(active, archive);
  return {
    migratedRecords: records.length,
    migratedClaims: claims.length,
    preservedUnknown,
    archivedTerminal,
    fenceRows,
  } satisfies UpgradeReport;
}

/** Moves one terminal interaction and its claim into the archive; collisions leave it active. */
async function archiveOne(active: BoundStore, archive: BoundStore, record: RecoveryRecord): Promise<boolean> {
  const keys = [recordKey(record.handle), ...(record.claimKey ? [record.claimKey] : [])];
  const pending: { sourceKey: string; targetKey: string }[] = [];
  const sources = new Map<string, Stored>();
  for (const key of keys) {
    const source = await active.observe(key);
    if (source.value === undefined) continue;
    const existing = await archive.lookup(key);
    if (existing === undefined) {
      pending.push({ sourceKey: key, targetKey: key });
      sources.set(key, source.value);
    } else if (canonicalJson(existing) === canonicalJson(source.value))
      // An identical copy is already archived (an earlier interrupted move): drop the duplicate.
      await active.compareAndApply(key, source.comparison, { operation: 'delete', action: 'delete' });
    else return false; // Collision: never overwrite; the record stays active for the operator.
  }
  if (!pending.length) return true;
  await archive.moveEntriesFrom({ namespace: ACTIVE_OPTIONS.namespace, entries: pending });
  // On openclaw@2026.10.3 a move onto an existing destination keeps the destination and still
  // removes the source (probed). Re-read every destination; if a concurrent writer won, put the
  // source value back so nothing is lost, and leave the record active for the operator.
  let intact = true;
  for (const [key, value] of sources) {
    const landed = await archive.lookup(key);
    if (landed !== undefined && sameRecordLineage(landed, value)) continue;
    intact = false;
    await active.registerIfAbsent(key, value);
  }
  return intact;
}

/**
 * True when the archived value is the moved value or the same record after a concurrent terminal
 * compaction (operator prune: link removed, generation/updatedAt advanced). Such a destination must
 * never trigger a restore, which would resurrect the pre-prune value as a stale active duplicate.
 */
function sameRecordLineage(landed: Stored, moved: Stored): boolean {
  if (canonicalJson(landed) === canonicalJson(moved)) return true;
  if (!isRecordShape(landed, 2) || !isRecordShape(moved, 2)) return false;
  if (landed.handle !== moved.handle || landed.generation < moved.generation) return false;
  const strip = ({ generation: _g, updatedAt: _u, humanUrl: _h, ...rest }: RecoveryRecord) => rest;
  return canonicalJson(strip(landed)) === canonicalJson(strip(moved));
}

async function archiveTerminalSweep(active: BoundStore, archive: BoundStore): Promise<number> {
  let moved = 0;
  for (const { key, value } of await active.entries()) {
    if (isRecordShape(value, 2) && TERMINAL_STATES.has(value.state)) {
      if (await archiveOne(active, archive, value)) moved++;
    } else if (isClaim(value, 2)) {
      // A claim left active while its terminal record is already archived joins it.
      const record = await archive.lookup(recordKey(value.handle));
      if (isRecordShape(record, 2) && TERMINAL_STATES.has(record.state))
        await archiveOne(active, archive, { ...record, claimKey: key });
    }
  }
  return moved;
}

/** Process-wide single flight: the upgrade fences all new admission in this Gateway until done. */
export class LayoutGate {
  #done = false;
  #running: Promise<void> | undefined;
  async ensure(store: RecoveryStore): Promise<void> {
    if (this.#done) return;
    if (this.#running) {
      // A waiter must not inherit the runner's own failure (for example its revoked authority).
      try {
        return await this.#running;
      } catch {
        fail('STATE_CONFLICT', 'The SESS state upgrade was interrupted by another call; retry.');
      }
    }
    this.#running = store.upgrade().then(
      () => {
        this.#done = true;
      },
      (error: unknown) => {
        this.#running = undefined;
        throw error;
      },
    );
    return this.#running;
  }
}

// ---------------------------------------------------------------- invocation-scoped store

/** Invocation-scoped views: every read and write re-checks the live host authority. */
export class RecoveryStore {
  readonly #legacy: BoundStore;
  readonly #active: BoundStore;
  readonly #archive: BoundStore;
  readonly #location = new Map<string, 'active' | 'archive'>();

  constructor(stores: HostStores, lease: InvocationLease) {
    this.#legacy = bind(stores.legacy, lease);
    this.#active = bind(stores.active, lease);
    this.#archive = bind(stores.archive, lease);
  }

  async upgrade(): Promise<UpgradeReport> {
    try {
      return await upgradeLegacy({ legacy: this.#legacy, active: this.#active, archive: this.#archive });
    } catch (error) {
      return storeError(error);
    }
  }

  /** True when the legacy layout still holds schema-1 data for this key (an older plugin wrote it). */
  async #legacyPending(key: string): Promise<boolean> {
    const value = await this.#legacy.lookup(key);
    return isClaim(value, 1) || isRecordShape(value, 1);
  }

  async #claimHandle(claim: string): Promise<string | undefined> {
    for (const store of [this.#active, this.#archive]) {
      const value = await store.lookup(claim);
      if (value === undefined) continue;
      if (!isClaim(value, 2)) fail('RECOVERY_BLOCKED', 'A prior create claim is unreadable.');
      return value.handle;
    }
    return undefined;
  }

  /**
   * Atomic create-intent claim across the layout. A redelivered host call reuses its handle whether
   * its claim is active or archived; the claim (replay tombstone) is never deleted.
   */
  async claimCreate(claim: string, record: RecoveryRecord): Promise<{ created: boolean; handle: string }> {
    try {
      if (await this.#legacyPending(claim)) await this.upgrade();
      const archived = await this.#archive.lookup(claim);
      if (archived !== undefined) {
        if (!isClaim(archived, 2)) fail('RECOVERY_BLOCKED', 'A prior create claim is unreadable.');
        return { created: false, handle: archived.handle };
      }
      const fresh = await this.#active.registerIfAbsent(claim, {
        kind: 'claim',
        schema: 2,
        handle: record.handle,
      });
      if (!fresh) {
        const handle = await this.#claimHandle(claim);
        if (!handle) fail('STATE_CONFLICT', 'A create claim moved concurrently; retry the same call.');
        return { created: false, handle };
      }
      // Archival moves claims atomically; recheck so a concurrent move can never yield a second create.
      const moved = await this.#archive.lookup(claim);
      if (moved !== undefined) {
        const observed = await this.#active.observe(claim);
        if (observed.value !== undefined)
          await this.#active.compareAndApply(claim, observed.comparison, {
            operation: 'delete',
            action: 'delete',
          });
        if (!isClaim(moved, 2)) fail('RECOVERY_BLOCKED', 'A prior create claim is unreadable.');
        return { created: false, handle: moved.handle };
      }
      if (!(await this.#active.registerIfAbsent(recordKey(record.handle), { ...record, claimKey: claim })))
        fail('RECOVERY_BLOCKED', 'Handle collision; nothing was sent.');
      return { created: true, handle: record.handle };
    } catch (error) {
      return storeError(error);
    }
  }

  /** Unknown or corrupt record schemas stay intact and block safely (spec 11.5). */
  async read(handle: string): Promise<RecoveryRecord | undefined> {
    const key = recordKey(handle);
    let found: { value: Stored; where: 'active' | 'archive' } | undefined;
    try {
      for (let attempt = 0; attempt < 2 && !found; attempt++) {
        const activeValue = await this.#active.lookup(key);
        if (activeValue !== undefined) found = { value: activeValue, where: 'active' };
        else {
          const archived = await this.#archive.lookup(key);
          if (archived !== undefined) found = { value: archived, where: 'archive' };
          else if (attempt === 0 && (await this.#legacyPending(key))) await this.upgrade();
          else break;
        }
      }
    } catch (error) {
      return storeError(error);
    }
    if (!found) return undefined;
    if (!isRecordShape(found.value, 2) || found.value.handle !== handle)
      fail('RECOVERY_BLOCKED', 'This interaction record has an unsupported format and was left unchanged.');
    this.#location.set(handle, found.where);
    if (found.where === 'active' && TERMINAL_STATES.has(found.value.state)) {
      // An earlier archival failed after the terminal state was saved: retry it now (best effort).
      try {
        if (await archiveOne(this.#active, this.#archive, found.value)) this.#location.set(handle, 'archive');
      } catch {
        /* the record stays correct in active; a later call retries */
      }
    }
    return found.value;
  }

  /**
   * Compare-and-apply against the exact record generation; a concurrent advance conflicts. A record
   * that becomes terminal is then moved, with its claim, into the retained archive.
   */
  async replace(
    current: RecoveryRecord,
    next: Omit<RecoveryRecord, 'generation' | 'updatedAt'>,
  ): Promise<RecoveryRecord> {
    const key = recordKey(current.handle);
    const where = this.#location.get(current.handle) ?? 'active';
    const store = where === 'archive' ? this.#archive : this.#active;
    const updated: RecoveryRecord = {
      ...next,
      generation: current.generation + 1,
      updatedAt: new Date().toISOString(),
    };
    try {
      const observed = await store.observe(key);
      if (!isRecordShape(observed.value, 2) || observed.value.generation !== current.generation)
        fail('STATE_CONFLICT', 'This interaction changed concurrently; read it again before continuing.');
      const result = await store.compareAndApply(key, observed.comparison, {
        operation: 'update',
        action: 'set',
        value: updated,
      });
      if (result.status === 'conflict')
        fail('STATE_CONFLICT', 'This interaction changed concurrently; read it again before continuing.');
    } catch (error) {
      return storeError(error);
    }
    if (where === 'active' && TERMINAL_STATES.has(updated.state)) {
      // The terminal state is already durable; archival only frees active capacity, so a failure here
      // leaves the record correct in the active namespace (the next upgrade sweep retries it).
      try {
        if (await archiveOne(this.#active, this.#archive, updated))
          this.#location.set(updated.handle, 'archive');
      } catch {
        /* retried by the sweep */
      }
    }
    return updated;
  }
}

// ---------------------------------------------------------------- operator views (CLI, no lease)

export interface StateCounts {
  readonly active: Record<string, number>;
  readonly archive: Record<string, number>;
  readonly legacy: Record<string, number>;
}

const PAGE = 500;
const KEY_END = '\uffff';

/**
 * Visits every entry in bounded pages with the public entriesInKeyRange (present on
 * openclaw@2026.10.3, probed); falls back to entries() only where the host lacks it.
 */
async function forEachEntry(
  store: HostKeyedStore,
  visit: (entry: { key: string; value: unknown }) => Promise<void> | void,
): Promise<void> {
  if (typeof store.entriesInKeyRange === 'function') {
    let start = '';
    for (;;) {
      const page = await store.entriesInKeyRange({
        keyStartInclusive: start,
        keyEndExclusive: KEY_END,
        limit: PAGE,
        order: 'asc',
      });
      for (const entry of page) await visit(entry);
      if (page.length < PAGE) return;
      start = `${page.at(-1)!.key}\u0000`;
    }
  }
  if (typeof store.entries !== 'function')
    fail('HOST_CAPABILITY_MISSING', 'Plugin state entries cannot be listed on this host.');
  for (const entry of await store.entries()) await visit(entry);
}

function tallyOne(counts: Record<string, number>, value: unknown, legacy: boolean): void {
  const add = (k: string) => void (counts[k] = (counts[k] ?? 0) + 1);
  if (isRecordShape(value, 2) || (legacy && isRecordShape(value, 1)))
    add(legacy ? `schema1_record_${(value as RecoveryRecord).state}` : (value as RecoveryRecord).state);
  else if (isClaim(value, 2) || (legacy && isClaim(value, 1))) add(legacy ? 'schema1_claim' : 'claim');
  else if (legacy && isLegacyOnly(value)) add(`${(value as { kind: string }).kind}`);
  else add('unknown');
}

/** Redacted counts only: states and kinds, never handles, URLs, keys or Session IDs. */
export async function countStates(stores: HostStores): Promise<StateCounts> {
  const count = async (store: HostKeyedStore, legacy: boolean) => {
    const counts: Record<string, number> = {};
    await forEachEntry(store, ({ value }) => tallyOne(counts, value, legacy));
    return counts;
  };
  return {
    active: await count(stores.active, false),
    archive: await count(stores.archive, false),
    legacy: await count(stores.legacy, true),
  };
}

export interface PruneReport {
  readonly eligible: number;
  readonly compacted: number;
  readonly conflicts: number;
}

/**
 * Compacts terminal secret payload only: removes the retained human URL from completed/blocked
 * records. Claims (replay tombstones), identities and every non-terminal record are untouched.
 * Refused while unmigrated schema-1 data remains, so nothing is pruned beside an unfinished upgrade.
 */
export async function pruneTerminal(stores: HostStores, apply: boolean): Promise<PruneReport> {
  let legacyPending = 0;
  await forEachEntry(stores.legacy, ({ value }) => {
    if (isRecordShape(value, 1) || isClaim(value, 1)) legacyPending++;
  });
  if (legacyPending)
    fail(
      'CONFIGURATION',
      'The SESS state upgrade has not completed (legacy schema-1 data remains); make one SESS tool call to finish it, then prune.',
    );
  let eligible = 0;
  let compacted = 0;
  let conflicts = 0;
  for (const store of [stores.active, stores.archive]) {
    if (typeof store.observe !== 'function' || typeof store.compareAndApply !== 'function')
      fail('HOST_CAPABILITY_MISSING', 'Plugin state compare-and-apply is not available on this host.');
    await forEachEntry(store, async ({ key, value }) => {
      if (!isRecordShape(value, 2) || !TERMINAL_STATES.has(value.state) || value.humanUrl === undefined)
        return;
      eligible++;
      if (!apply) return;
      const observed = await store.observe!(key);
      if (!isRecordShape(observed.value, 2) || observed.value.generation !== value.generation) {
        conflicts++;
        return;
      }
      const { humanUrl: _drop, ...rest } = observed.value;
      const result = await store.compareAndApply!(key, observed.comparison, {
        operation: 'update',
        action: 'set',
        value: { ...rest, generation: value.generation + 1, updatedAt: new Date().toISOString() },
      });
      if (result.status === 'conflict') conflicts++;
      else compacted++;
    });
  }
  return { eligible, compacted, conflicts };
}

export interface RetireReport {
  readonly eligible: number;
  readonly retired: number;
  readonly conflicts: number;
  readonly archived: number;
  readonly skippedByState: Record<string, number>;
}

/** Only states without a pending mutation or create ambiguity can be retired by the operator. */
const RETIRABLE: ReadonlySet<RecoveryState> = new Set(['waiting', 'needs_resume', 'answered']);

/**
 * Operator remedy for abandoned interactions filling active capacity: marks waiting/needs_resume/
 * answered records idle for at least `olderThanMs` as blocked (reason operator_retired), drops their
 * human link and moves record and claim to the archive. The claim (replay tombstone) is kept, so a
 * redelivered call reports blocked and never creates again. create_intent, create_unknown and
 * pending publish/complete records are never touched. Dry run unless `apply`.
 */
export async function retireIdle(
  stores: HostStores,
  olderThanMs: number,
  apply: boolean,
  now = Date.now(),
): Promise<RetireReport> {
  const { active, archive } = stores;
  if (typeof active.observe !== 'function' || typeof active.compareAndApply !== 'function')
    fail('HOST_CAPABILITY_MISSING', 'Plugin state compare-and-apply is not available on this host.');
  let eligible = 0;
  let retired = 0;
  let conflicts = 0;
  let archived = 0;
  const skippedByState: Record<string, number> = {};
  const candidates: { key: string; value: RecoveryRecord }[] = [];
  await forEachEntry(active, ({ key, value }) => {
    if (!isRecordShape(value, 2)) return;
    if (!RETIRABLE.has(value.state)) {
      skippedByState[value.state] = (skippedByState[value.state] ?? 0) + 1;
      return;
    }
    if (now - Date.parse(value.updatedAt) >= olderThanMs) candidates.push({ key, value });
  });
  eligible = candidates.length;
  if (!apply) return { eligible, retired, conflicts, archived, skippedByState };
  for (const { key, value } of candidates) {
    const observed = await active.observe!(key);
    if (!isRecordShape(observed.value, 2) || observed.value.generation !== value.generation) {
      conflicts++;
      continue;
    }
    const { humanUrl: _drop, ...rest } = observed.value;
    const next: RecoveryRecord = {
      ...rest,
      state: 'blocked',
      blockedReason: 'operator_retired',
      generation: value.generation + 1,
      updatedAt: new Date(now).toISOString(),
    };
    const result = await active.compareAndApply!(key, observed.comparison, {
      operation: 'update',
      action: 'set',
      value: next,
    });
    if (result.status === 'conflict') {
      conflicts++;
      continue;
    }
    retired++;
    const move = (archive as { moveEntriesFrom?: BoundStore['moveEntriesFrom'] }).moveEntriesFrom;
    const lookup = (archive as { lookup?: BoundStore['lookup'] }).lookup;
    const register = (active as { registerIfAbsent?: BoundStore['registerIfAbsent'] }).registerIfAbsent;
    if (typeof move !== 'function' || typeof lookup !== 'function' || typeof register !== 'function')
      continue;
    // Same collision-safe move as tool-time archival.
    const view = {
      observe: active.observe!.bind(active),
      compareAndApply: active.compareAndApply!.bind(active),
      registerIfAbsent: register.bind(active),
      lookup: (active as { lookup: BoundStore['lookup'] }).lookup.bind(active),
    } as unknown as BoundStore;
    const archiveView = {
      lookup: lookup.bind(archive),
      moveEntriesFrom: move.bind(archive),
    } as unknown as BoundStore;
    if (await archiveOne(view, archiveView, next)) archived++;
  }
  return { eligible, retired, conflicts, archived, skippedByState };
}
