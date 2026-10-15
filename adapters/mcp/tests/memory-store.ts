// Test-only, hosted-style handle store: one shared table keyed by handle (as a database table
// would be), with per-authority views. The durable hosted store lives in the private SESS runtime;
// this exists only to prove the seam's isolation, refresh, generation and restart behaviour.
import { AdapterError } from '../src/errors.js';
import {
  MAX_ACTIVE_RECORDS,
  assertBindingAccess,
  decodeRecord,
  generateHandle,
  type GrantBinding,
  type HandleRecord,
  type HandleStore,
} from '../src/store.js';

export class MemoryHandleBackend {
  /** Serialized records, shared by every authority and every handler instance ("process"). */
  readonly rows = new Map<string, string>();
  readonly #locks = new Map<string, Promise<unknown>>();
  opened: GrantBinding[] = [];

  /**
   * A view bound to `binding`. `naive` skips the store's own binding check on load, so a test can
   * prove the operations' independent check still refuses another authority's record.
   */
  view(binding: GrantBinding, options: { naive?: boolean } = {}): HandleStore {
    this.opened.push(binding);
    const rows = this.rows;
    const locks = this.#locks;
    const sameGrant = (b: HandleRecord['binding']) =>
      'kind' in b &&
      b.workspaceId === binding.workspaceId &&
      b.principalId === binding.principalId &&
      b.clientId === binding.clientId &&
      b.grantId === binding.grantId;
    return {
      binding,
      newHandle: generateHandle,
      async load(handle) {
        const text = rows.get(handle);
        if (text === undefined) throw new AdapterError('HANDLE_NOT_FOUND', 'Unknown interaction handle.');
        const record = decodeRecord(JSON.parse(text), handle);
        if (!options.naive) assertBindingAccess(record.binding, binding);
        return record;
      },
      async save(record) {
        const snapshot = decodeRecord(JSON.parse(JSON.stringify(record)), record.handle);
        assertBindingAccess(snapshot.binding, binding);
        const existing = rows.get(record.handle);
        if (existing !== undefined)
          assertBindingAccess(decodeRecord(JSON.parse(existing), record.handle).binding, binding);
        rows.set(record.handle, JSON.stringify(snapshot));
      },
      async discard(handle) {
        const existing = rows.get(handle);
        if (existing === undefined) return;
        assertBindingAccess(decodeRecord(JSON.parse(existing), handle).binding, binding);
        rows.delete(handle);
      },
      async assertCapacity() {
        let active = 0;
        for (const [handle, text] of rows) {
          const record = decodeRecord(JSON.parse(text), handle);
          if (sameGrant(record.binding) && record.state !== 'completed') active++;
        }
        if (active >= MAX_ACTIVE_RECORDS)
          throw new AdapterError('STATE_STORE_FULL', 'Too many unfinished interactions.');
      },
      async withLock<T>(handle: string, fn: () => Promise<T>): Promise<T> {
        const previous = locks.get(handle) ?? Promise.resolve();
        let release!: () => void;
        const current = new Promise<void>((resolve) => (release = resolve));
        const chained = previous.then(() => current);
        locks.set(handle, chained);
        await previous.catch(() => undefined);
        try {
          return await fn();
        } finally {
          release();
          if (locks.get(handle) === chained) locks.delete(handle);
        }
      },
    };
  }

  /** The decoded record for a handle, bypassing any view (test inspection only). */
  record(handle: string): HandleRecord {
    return decodeRecord(JSON.parse(this.rows.get(handle)!), handle);
  }
}
