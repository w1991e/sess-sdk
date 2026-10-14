import { createHash } from 'node:crypto';
import type { InteractiveInteraction } from '@sess.si/sdk';
import { SessAdapterError, fail } from './errors.js';
import type { HostBinding, InvocationLease } from './host.js';

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

export interface RecoveryRecord {
  readonly kind: 'interaction';
  readonly schema: 1;
  readonly handle: string;
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
  readonly blockedReason?: string;
}

interface CreateClaim {
  readonly kind: 'claim';
  readonly schema: 1;
  readonly handle: string;
}

type Stored = RecoveryRecord | CreateClaim;

/** Public OpenClaw 2026.10.3 PluginStateKeyedStore<T, 2> operations this adapter requires. */
interface BoundStore {
  observe(key: string): Promise<{ value: Stored | undefined; comparison: string }>;
  compareAndApply(
    key: string,
    comparison: string,
    intent: { operation: 'update'; action: 'set'; value: Stored },
  ): Promise<{ status: 'applied' | 'unchanged' } | { status: 'conflict' }>;
  registerIfAbsent(key: string, value: Stored): Promise<boolean>;
  lookup(key: string): Promise<Stored | undefined>;
}

export interface HostKeyedStore {
  withCurrent?: (authority: { assertCurrent: () => void }) => unknown;
}

export interface HostStateRuntime {
  openKeyedStore?: (options: {
    namespace: string;
    maxEntries: number;
    overflowPolicy: 'reject-new';
  }) => HostKeyedStore;
}

/** Bounded, non-evicting admission: new keys fail at the limit; pending records are never shed. */
export const STORE_OPTIONS = Object.freeze({
  namespace: 'interactions-v1',
  maxEntries: 2200,
  overflowPolicy: 'reject-new' as const,
});

const REQUIRED = ['observe', 'compareAndApply', 'registerIfAbsent', 'lookup'] as const;

export function openHostStore(state: HostStateRuntime | undefined): HostKeyedStore {
  if (!state || typeof state.openKeyedStore !== 'function')
    fail('HOST_CAPABILITY_MISSING', 'This OpenClaw host does not provide durable plugin state.');
  const store = state.openKeyedStore({ ...STORE_OPTIONS });
  if (!store || typeof store.withCurrent !== 'function')
    fail(
      'HOST_CAPABILITY_MISSING',
      'This OpenClaw host cannot bind plugin state writes to live invocation authority.',
    );
  return store;
}

function storeError(error: unknown): never {
  if (error instanceof SessAdapterError) throw error;
  const code = (error as { code?: unknown } | null)?.code;
  if (typeof code === 'string' && /LIMIT|FULL|QUOTA|CAPACITY/i.test(code))
    fail(
      'STORE_FULL',
      'The SESS plugin has reached its retained-interaction limit; no interaction was dropped.',
    );
  fail('AUTHORITY_REVOKED', 'Durable plugin state refused this invocation.');
}

export const recordKey = (handle: string) => `i:${handle}`;

export function claimKey(binding: HostBinding, toolCallId: string): string {
  return `c:${createHash('sha256')
    .update(JSON.stringify([binding.agentId, binding.sessionKey, binding.sessionId, toolCallId]))
    .digest('base64url')}`;
}

function isRecord(value: unknown): value is RecoveryRecord {
  if (!value || typeof value !== 'object') return false;
  const r = value as Record<string, unknown>;
  const b = r.binding as Record<string, unknown> | undefined;
  return (
    r.kind === 'interaction' &&
    r.schema === 1 &&
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

/** Invocation-scoped view: every read and write re-checks the live host authority. */
export class RecoveryStore {
  readonly #store: BoundStore;

  constructor(host: HostKeyedStore, lease: InvocationLease) {
    const bound = host.withCurrent?.({ assertCurrent: lease.assertCurrent }) as
      Partial<BoundStore> | undefined;
    for (const name of REQUIRED)
      if (!bound || typeof bound[name] !== 'function')
        fail('HOST_CAPABILITY_MISSING', 'This OpenClaw host lacks atomic compare-and-apply plugin state.');
    this.#store = bound as BoundStore;
  }

  /** Atomic create-intent claim. A repeated delivery of the same host tool call reuses its handle. */
  async claimCreate(claim: string, record: RecoveryRecord): Promise<{ created: boolean; handle: string }> {
    try {
      const fresh = await this.#store.registerIfAbsent(claim, {
        kind: 'claim',
        schema: 1,
        handle: record.handle,
      });
      if (!fresh) {
        const existing = await this.#store.lookup(claim);
        if (!existing || existing.kind !== 'claim')
          fail('RECOVERY_BLOCKED', 'A prior create claim is unreadable.');
        return { created: false, handle: existing.handle };
      }
      if (!(await this.#store.registerIfAbsent(recordKey(record.handle), record)))
        fail('RECOVERY_BLOCKED', 'Handle collision; nothing was sent.');
      return { created: true, handle: record.handle };
    } catch (error) {
      return storeError(error);
    }
  }

  /** Unknown or corrupt record schemas stay intact and block safely (spec 11.5). */
  async read(handle: string): Promise<RecoveryRecord | undefined> {
    let value: Stored | undefined;
    try {
      value = await this.#store.lookup(recordKey(handle));
    } catch (error) {
      return storeError(error);
    }
    if (value === undefined) return undefined;
    if (!isRecord(value) || value.handle !== handle)
      fail('RECOVERY_BLOCKED', 'This interaction record has an unsupported format and was left unchanged.');
    return value;
  }

  /** Compare-and-apply against the exact record generation; a concurrent advance conflicts. */
  async replace(
    current: RecoveryRecord,
    next: Omit<RecoveryRecord, 'generation' | 'updatedAt'>,
  ): Promise<RecoveryRecord> {
    const key = recordKey(current.handle);
    const updated: RecoveryRecord = {
      ...next,
      generation: current.generation + 1,
      updatedAt: new Date().toISOString(),
    };
    try {
      const observed = await this.#store.observe(key);
      if (!isRecord(observed.value) || observed.value.generation !== current.generation)
        fail('STATE_CONFLICT', 'This interaction changed concurrently; read it again before continuing.');
      const result = await this.#store.compareAndApply(key, observed.comparison, {
        operation: 'update',
        action: 'set',
        value: updated,
      });
      if (result.status === 'conflict')
        fail('STATE_CONFLICT', 'This interaction changed concurrently; read it again before continuing.');
    } catch (error) {
      return storeError(error);
    }
    return updated;
  }
}
