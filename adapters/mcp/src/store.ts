import { createHash, createHmac, randomBytes, randomUUID } from 'node:crypto';
import { mkdir, open, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { AdapterError } from './errors.js';
import { canonicalJson } from './internal/shared.js';
import { EVENT_ID_PATTERN, HANDLE_PATTERN, type JsonObject } from './validate.js';

/** Recovery state names shared with the companion adapter contract. */
export const STATES = [
  'create_intent',
  'create_unknown',
  'waiting',
  'answered',
  'publish_pending',
  'complete_pending',
  'completed',
  'needs_resume',
  'blocked',
] as const;
export type RecoveryState = (typeof STATES)[number];

/**
 * The owner-private boundary a stdio handle is bound to. stdio has no authenticated conversation
 * identity, so the boundary is the configured profile, API origin and credential generation.
 * The credential generation is a keyed digest local to the profile; the raw key is never stored.
 * This is the on-disk shape of record schema 2 and is unchanged.
 */
export interface ProfileBinding {
  profile: string;
  origin: string;
  credentialGeneration: string;
}

/**
 * The boundary a hosted handle is bound to: the server-resolved workspace, user or service
 * principal, client (agent host) and consent grant with its stable generation. A token refresh
 * keeps the generation, so handles survive it; a revoked or re-issued grant has a new generation
 * and its earlier handles are refused. `credentialGeneration` is an unkeyed digest of the other
 * fields (no secret is involved); pending mutations record it, as for the profile binding.
 */
export interface GrantBinding {
  kind: 'grant';
  origin: string;
  workspaceId: string;
  principalId: string;
  clientId: string;
  grantId: string;
  grantGeneration: string;
  credentialGeneration: string;
}

export type Binding = ProfileBinding | GrantBinding;

/** The authority fields of a hosted binding, as resolved server-side for one request. */
export type GrantAuthority = Omit<GrantBinding, 'kind' | 'credentialGeneration'>;

export const WORKSPACE_ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;
/** Principal, client, grant and generation identifiers: printable ASCII, bounded. */
export const AUTHORITY_ID_PATTERN = /^[\x21-\x7e]{1,2048}$/;
const ORIGIN_PATTERN = /^https?:\/\/[\x21-\x7e]{1,2048}$/;

function grantDigest(a: GrantAuthority): string {
  const fields = {
    origin: a.origin,
    workspaceId: a.workspaceId,
    principalId: a.principalId,
    clientId: a.clientId,
    grantId: a.grantId,
    grantGeneration: a.grantGeneration,
  };
  const digest = createHash('sha256').update(canonicalJson(fields), 'utf8').digest('base64url');
  return `cg1_${digest.slice(0, 22)}`;
}

/** Builds the binding for one server-resolved authority; throws a TypeError if a field is malformed. */
export function grantBinding(authority: GrantAuthority): GrantBinding {
  const ok =
    typeof authority.origin === 'string' &&
    ORIGIN_PATTERN.test(authority.origin) &&
    typeof authority.workspaceId === 'string' &&
    WORKSPACE_ID_PATTERN.test(authority.workspaceId) &&
    [authority.principalId, authority.clientId, authority.grantId, authority.grantGeneration].every(
      (value) => typeof value === 'string' && AUTHORITY_ID_PATTERN.test(value),
    );
  if (!ok) throw new TypeError('Invalid hosted authority: malformed origin or identifier.');
  return {
    kind: 'grant',
    origin: authority.origin,
    workspaceId: authority.workspaceId,
    principalId: authority.principalId,
    clientId: authority.clientId,
    grantId: authority.grantId,
    grantGeneration: authority.grantGeneration,
    credentialGeneration: grantDigest(authority),
  };
}

/** True when two bindings name exactly the same authority. */
export function sameBinding(a: Binding, b: Binding): boolean {
  try {
    assertBindingAccess(a, b);
    return true;
  } catch {
    return false;
  }
}

/**
 * Access check for a loaded record against the authority of the current call. A profile binding
 * must match exactly (BINDING_MISMATCH, as before). A hosted record of another origin, workspace,
 * principal, client or grant is reported as an unknown handle, so its existence is not disclosed;
 * the same grant at another generation (revoked or re-issued) is BINDING_MISMATCH.
 */
export function assertBindingAccess(record: Binding, expected: Binding): void {
  if (!('kind' in expected)) {
    if (
      'kind' in record ||
      record.profile !== expected.profile ||
      record.origin !== expected.origin ||
      record.credentialGeneration !== expected.credentialGeneration
    )
      throw new AdapterError(
        'BINDING_MISMATCH',
        'This interaction belongs to a different Sess profile, API origin or credential. It was not accessed.',
      );
    return;
  }
  if (
    !('kind' in record) ||
    record.kind !== 'grant' ||
    record.origin !== expected.origin ||
    record.workspaceId !== expected.workspaceId ||
    record.principalId !== expected.principalId ||
    record.clientId !== expected.clientId ||
    record.grantId !== expected.grantId
  )
    throw new AdapterError('HANDLE_NOT_FOUND', 'Unknown interaction handle.');
  if (
    record.grantGeneration !== expected.grantGeneration ||
    record.credentialGeneration !== expected.credentialGeneration
  )
    throw new AdapterError(
      'BINDING_MISMATCH',
      'This interaction belongs to an earlier authorization of this agent host. It was not accessed.',
    );
}

export interface VerifiedAnswer {
  revision: number;
  eventId: string;
  actionId: string;
  data: JsonObject;
}

export interface PendingMutation {
  operation: 'publish' | 'complete';
  sessionId: string;
  ifMatch: string;
  idempotencyKey: string;
  credentialGeneration: string;
  expectedRevision: number;
  responseEventId: string;
  /** Exact publish body; replay sends these bytes' JSON value unchanged. */
  body?: JsonObject;
}

/**
 * A confirmed publish or complete, keyed by the accepted event it consumed. Exact replays of the
 * same call are recognized only when operation, expected revision and (for publish) the canonical
 * body digest all match.
 */
export interface ProcessedTransition {
  eventId: string;
  operation: 'publish' | 'complete';
  expectedRevision: number;
  /** SHA-256 of the canonical publish body; absent for complete. */
  bodyDigest?: string;
}

/** Current record schema. Records of any other schema stop with STATE_STORE_ERROR before dispatch. */
export const RECORD_SCHEMA = 2;

export interface HandleRecord {
  schema: typeof RECORD_SCHEMA;
  handle: string;
  binding: Binding;
  state: RecoveryState;
  createdAt: string;
  updatedAt: string;
  /** SHA-256 of the canonical create request; a create intent never stores a second body. */
  requestDigest: string;
  sessionId?: string;
  /** Bearer capability, kept privately until the interaction is terminal. */
  humanUrl?: string;
  /** The revision the agent is currently waiting on or has an answer for. */
  revision: number;
  /** ETag of the snapshot that contained the verified answer; the If-Match for the next write. */
  etag?: string;
  answer?: VerifiedAnswer;
  pending?: PendingMutation;
  /** Accepted events already consumed by a confirmed publish or complete. */
  processed: ProcessedTransition[];
  blockedReason?: string;
}

const SESSION_ID = /^ses_[0-9A-HJKMNP-TV-Z]{26}$/;
const ETAG = /^"[\x21\x23-\x7e\x80-\xff]{0,1024}"$/;
const IDEMPOTENCY_KEY = /^[A-Za-z0-9_.:-]{1,128}$/;
const GENERATION = /^cg1_[A-Za-z0-9_-]{22}$/;
const MAX_RECORD_BYTES = 256 * 1024;

function corrupt(): never {
  throw new AdapterError(
    'STATE_STORE_ERROR',
    'A saved interaction record is unreadable or inconsistent. It was left unchanged for manual inspection.',
  );
}
function str(value: unknown, regex?: RegExp): value is string {
  return typeof value === 'string' && (!regex || regex.test(value));
}
function obj(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) corrupt();
  return value as Record<string, unknown>;
}

/** Version-checked decode of a persisted record before any network dispatch. */
export function decodeRecord(raw: unknown, expectedHandle: string): HandleRecord {
  const r = obj(raw);
  if (r.schema !== RECORD_SCHEMA)
    throw new AdapterError(
      'STATE_STORE_ERROR',
      'A saved interaction record uses an unsupported format version. It was left unchanged and nothing was sent.',
    );
  if (r.handle !== expectedHandle || !str(r.handle, HANDLE_PATTERN)) corrupt();
  const b = obj(r.binding);
  if (b.kind === 'grant') {
    if (
      !str(b.origin, ORIGIN_PATTERN) ||
      !str(b.workspaceId, WORKSPACE_ID_PATTERN) ||
      !str(b.principalId, AUTHORITY_ID_PATTERN) ||
      !str(b.clientId, AUTHORITY_ID_PATTERN) ||
      !str(b.grantId, AUTHORITY_ID_PATTERN) ||
      !str(b.grantGeneration, AUTHORITY_ID_PATTERN) ||
      !str(b.credentialGeneration, GENERATION) ||
      b.credentialGeneration !== grantDigest(b as unknown as GrantAuthority)
    )
      corrupt();
  } else if (!str(b.profile) || !str(b.origin) || !str(b.credentialGeneration, GENERATION)) corrupt();
  if (!STATES.includes(r.state as RecoveryState)) corrupt();
  if (!str(r.createdAt) || !str(r.updatedAt) || !str(r.requestDigest, /^[0-9a-f]{64}$/)) corrupt();
  if (!Number.isSafeInteger(r.revision) || (r.revision as number) < 1) corrupt();
  if (!Array.isArray(r.processed)) corrupt();
  const seen = new Set<string>();
  for (const item of r.processed) {
    const t = obj(item);
    if (
      !str(t.eventId, EVENT_ID_PATTERN) ||
      seen.has(t.eventId) ||
      (t.operation !== 'publish' && t.operation !== 'complete') ||
      !Number.isSafeInteger(t.expectedRevision) ||
      (t.expectedRevision as number) < 1 ||
      (t.operation === 'publish' ? !str(t.bodyDigest, /^[0-9a-f]{64}$/) : t.bodyDigest !== undefined)
    )
      corrupt();
    seen.add(t.eventId);
  }
  const state = r.state as RecoveryState;
  if (r.sessionId !== undefined && !str(r.sessionId, SESSION_ID)) corrupt();
  if (r.humanUrl !== undefined && !str(r.humanUrl, /^https?:\/\/[\x21-\x7e]{1,4096}$/)) corrupt();
  if (r.etag !== undefined && !str(r.etag, ETAG)) corrupt();
  if (state !== 'create_intent' && state !== 'create_unknown' && state !== 'blocked' && !r.sessionId)
    corrupt();
  if (r.answer !== undefined) {
    const a = obj(r.answer);
    if (
      !Number.isSafeInteger(a.revision) ||
      !str(a.eventId, EVENT_ID_PATTERN) ||
      !str(a.actionId, /^[a-z][a-z0-9_]{0,31}$/)
    )
      corrupt();
    obj(a.data);
  }
  if ((state === 'answered' || state === 'publish_pending' || state === 'complete_pending') && !r.answer)
    corrupt();
  if (r.pending !== undefined) {
    const p = obj(r.pending);
    // Saved replay identity is checked as primitive data before credential lookup or dispatch.
    for (const key of ['ifMatch', 'idempotencyKey', 'credentialGeneration', 'sessionId'] as const) {
      const d = Object.getOwnPropertyDescriptor(p, key);
      if (!d || !('value' in d) || typeof d.value !== 'string') corrupt();
    }
    if (
      (p.operation !== 'publish' && p.operation !== 'complete') ||
      !str(p.sessionId, SESSION_ID) ||
      p.sessionId !== r.sessionId ||
      !str(p.ifMatch, ETAG) ||
      !str(p.idempotencyKey, IDEMPOTENCY_KEY) ||
      !str(p.credentialGeneration, GENERATION) ||
      !Number.isSafeInteger(p.expectedRevision) ||
      !str(p.responseEventId, EVENT_ID_PATTERN)
    )
      corrupt();
    if (p.operation === 'publish') obj(p.body);
    else if (p.body !== undefined) corrupt();
  }
  // A pending mutation is required while pending, kept as evidence when blocked, otherwise absent.
  if ((state === 'publish_pending' || state === 'complete_pending') && r.pending === undefined) corrupt();
  if (r.pending !== undefined && !['publish_pending', 'complete_pending', 'blocked'].includes(state))
    corrupt();
  if (state === 'publish_pending' && (r.pending as PendingMutation).operation !== 'publish') corrupt();
  if (state === 'complete_pending' && (r.pending as PendingMutation).operation !== 'complete') corrupt();
  // Detached plain-data copy; prototype-bearing or accessor values cannot survive.
  return JSON.parse(JSON.stringify(r)) as HandleRecord;
}

async function syncDirectory(path: string): Promise<void> {
  if (process.platform === 'win32') return;
  const directory = await open(path, 'r');
  try {
    await directory.sync();
  } finally {
    await directory.close();
  }
}

/** write-temp + fsync + rename + directory fsync; the temp file never replaces on failure. */
export async function atomicWrite(path: string, directory: string, content: string): Promise<void> {
  const temporary = join(directory, `.${randomUUID()}.tmp`);
  try {
    await writeFile(temporary, content, { mode: 0o600, flag: 'wx', flush: true });
    await rename(temporary, path);
    await syncDirectory(directory);
  } finally {
    await rm(temporary, { force: true });
  }
}

export const MAX_ACTIVE_RECORDS = 100;

/** A new opaque interaction handle (128 random bits) matching HANDLE_PATTERN. */
export function generateHandle(): string {
  return `sh_${randomBytes(16).toString('base64url')}`;
}

/**
 * The handle store the operations use, injected by a composition. One instance is a view bound to
 * one authority (`binding`): `load` returns only records of that authority (checked with
 * `assertBindingAccess`) and every returned record has passed `decodeRecord`. The operations check
 * each loaded record against `binding` again, so a store that is keyed only by handle still cannot
 * hand one principal's record to another. `withLock` must serialize read-modify-write sections for
 * one handle across every process that shares the store. Failures are AdapterErrors
 * (`HANDLE_NOT_FOUND`, `STATE_STORE_ERROR`, `STATE_STORE_FULL`, `BINDING_MISMATCH`).
 */
export interface HandleStore {
  readonly binding: Binding;
  /** A new handle; `generateHandle()` unless the store has its own allocation. */
  newHandle(): string;
  load(handle: string): Promise<HandleRecord>;
  save(record: HandleRecord): Promise<void>;
  /** Deletes a record only for a create that authoritatively did not happen. */
  discard(handle: string): Promise<void>;
  /** Bounded admission: refuse new work rather than evict a pending interaction. */
  assertCapacity(): Promise<void>;
  withLock<T>(handle: string, fn: () => Promise<T>): Promise<T>;
}

/**
 * The local stdio store: one owner-private profile directory, `<stateDir>/profiles/<profile>/`.
 * Each handle has its own record file. A single server process per profile is the supported
 * boundary; within the process, writes to one handle are serialized.
 */
export class ProfileHandleStore implements HandleStore {
  readonly binding: ProfileBinding;
  readonly #handles: string;
  #locks = new Map<string, Promise<unknown>>();

  private constructor(binding: ProfileBinding, handles: string) {
    this.binding = binding;
    this.#handles = handles;
  }

  static async open(
    stateDir: string,
    profile: string,
    origin: string,
    apiKey: string,
  ): Promise<ProfileHandleStore> {
    const root = join(stateDir, 'profiles', profile);
    const handles = join(root, 'handles');
    try {
      await mkdir(handles, { recursive: true, mode: 0o700 });
      const profilePath = join(root, 'profile.json');
      let salt: Buffer | undefined;
      try {
        const saved = JSON.parse(await readFile(profilePath, 'utf8')) as { schema?: unknown; salt?: unknown };
        if (saved.schema !== 1 || typeof saved.salt !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(saved.salt))
          corrupt();
        salt = Buffer.from(saved.salt, 'base64url');
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      }
      if (!salt) {
        const fresh = randomBytes(32);
        const content = JSON.stringify({ schema: 1, profile, salt: fresh.toString('base64url') });
        try {
          await writeFile(profilePath, content, { mode: 0o600, flag: 'wx', flush: true });
          await syncDirectory(root);
          salt = fresh;
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
          return ProfileHandleStore.open(stateDir, profile, origin, apiKey);
        }
      }
      const digest = createHmac('sha256', salt)
        .update(`${origin}\n${apiKey}`)
        .digest('base64url')
        .slice(0, 22);
      return new ProfileHandleStore({ profile, origin, credentialGeneration: `cg1_${digest}` }, handles);
    } catch (error) {
      if (error instanceof AdapterError) throw error;
      throw new AdapterError('STATE_STORE_ERROR', 'The local state directory could not be prepared.');
    }
  }

  newHandle(): string {
    return generateHandle();
  }

  #path(handle: string): string {
    if (!HANDLE_PATTERN.test(handle))
      throw new AdapterError('HANDLE_NOT_FOUND', 'Unknown interaction handle.');
    return join(this.#handles, `${handle}.json`);
  }

  /** Loads a record owned by this profile. Records of another profile live elsewhere and are not found. */
  async load(handle: string): Promise<HandleRecord> {
    let text: string;
    try {
      text = await readFile(this.#path(handle), 'utf8');
    } catch (error) {
      if (error instanceof AdapterError) throw error;
      if ((error as NodeJS.ErrnoException).code === 'ENOENT')
        throw new AdapterError('HANDLE_NOT_FOUND', 'Unknown interaction handle for this Sess MCP profile.');
      throw new AdapterError('STATE_STORE_ERROR', 'The saved interaction could not be read.', true);
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      return corrupt();
    }
    const record = decodeRecord(parsed, handle);
    assertBindingAccess(record.binding, this.binding);
    return record;
  }

  async save(record: HandleRecord): Promise<void> {
    const snapshot = decodeRecord(JSON.parse(JSON.stringify(record)), record.handle);
    const content = JSON.stringify(snapshot);
    if (Buffer.byteLength(content) > MAX_RECORD_BYTES)
      throw new AdapterError('STATE_STORE_ERROR', 'The interaction record exceeds the local size limit.');
    try {
      await atomicWrite(this.#path(record.handle), this.#handles, content);
    } catch {
      throw new AdapterError('STATE_STORE_ERROR', 'The interaction state could not be saved durably.', true);
    }
  }

  /** Deletes a record only for a create that authoritatively did not happen. */
  async discard(handle: string): Promise<void> {
    await rm(this.#path(handle), { force: true });
    await syncDirectory(this.#handles).catch(() => undefined);
  }

  /** Bounded admission: refuse new work rather than evict a pending interaction. */
  async assertCapacity(): Promise<void> {
    let names: string[];
    try {
      names = (await readdir(this.#handles)).filter((n) => /^sh_[A-Za-z0-9_-]{22}\.json$/.test(n));
    } catch {
      throw new AdapterError('STATE_STORE_ERROR', 'The local state directory could not be read.', true);
    }
    if (names.length < MAX_ACTIVE_RECORDS) return;
    let active = 0;
    for (const name of names) {
      try {
        const r = JSON.parse(await readFile(join(this.#handles, name), 'utf8')) as { state?: unknown };
        if (r.state !== 'completed') active++;
      } catch {
        active++;
      }
    }
    if (active >= MAX_ACTIVE_RECORDS)
      throw new AdapterError(
        'STATE_STORE_FULL',
        `At most ${MAX_ACTIVE_RECORDS} unfinished interactions are kept per profile. Complete or resolve one first.`,
      );
  }

  /** Serializes read-modify-write sections for one handle within this process. */
  async withLock<T>(handle: string, fn: () => Promise<T>): Promise<T> {
    const previous = this.#locks.get(handle) ?? Promise.resolve();
    let release!: () => void;
    const current = new Promise<void>((resolve) => (release = resolve));
    const chained = previous.then(() => current);
    this.#locks.set(handle, chained);
    await previous.catch(() => undefined);
    try {
      return await fn();
    } finally {
      release();
      if (this.#locks.get(handle) === chained) this.#locks.delete(handle);
    }
  }
}
