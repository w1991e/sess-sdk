import { randomUUID } from 'node:crypto';
import {
  Sess,
  SessError,
  type AcceptedResponse,
  type CreateSessionRequest,
  type PublishSessionRequest,
} from '@sess.si/sdk';
import { loadConfig, type AdapterConfig } from './config.js';
import { AdapterError, lengthMessage, type Diagnostics, type LengthDetail } from './errors.js';
import {
  ProfileHandleStore,
  RECORD_SCHEMA,
  assertBindingAccess,
  type HandleRecord,
  type HandleStore,
  type PendingMutation,
} from './store.js';
import { bodyDigest, canonicalJson, classifyVerification } from './internal/shared.js';
import { userAgentFetch } from './user-agent.js';
import {
  plainJson,
  type CompleteArgs,
  type JsonObject,
  type PublishArgs,
  type RequestArgs,
  type ResponseArgs,
} from './validate.js';

/** The SDK surface this adapter uses. Tests substitute a fake; production uses `Sess`. */
export interface SessClient {
  sessions: Pick<Sess['sessions'], 'create' | 'retrieve' | 'waitForResponse' | 'publish' | 'complete'>;
  receipts: Pick<Sess['receipts'], 'verifyResponse'>;
}

export type InteractionState = 'waiting' | 'answered' | 'completed' | 'needs_resume' | 'expired';

/** Reason saved on a record whose link expired with no answer (state `blocked`, reported as `expired`). */
const LINK_EXPIRED = 'LINK_EXPIRED';
/**
 * A read made when the runtime clock was this far past the link's expiry, with no answer, is final
 * (the same grace as the SDK wait).
 */
const LINK_EXPIRY_GRACE_MS = 2000;
const ISO_INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/;

function instant(value: unknown): number | undefined {
  if (typeof value !== 'string' || !ISO_INSTANT.test(value)) return undefined;
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? ms : undefined;
}

/**
 * Whether the read shows the link still open (Decision 0009 Amendment 10): `live`, or `lapsed`,
 * past its deadline but still extendable by the person. Never expired while either.
 */
function stillOpen(session: object): boolean {
  const state: unknown = (session as { link_state?: unknown }).link_state;
  return state === 'live' || state === 'lapsed';
}

/**
 * What a read with no answer for the revision shows about the link's end:
 * - `false`: still open, or not yet past its end. live or lapsed (link timing, Amendment 10) is
 *   never expired; a lapsed link can still be extended.
 * - `'final'`: expired, with the runtime clock the grace past the link's end (its horizon while an
 *   extension is left, else its deadline); or, from a runtime before link timing (no link_state),
 *   past the deadline plus the grace, as before.
 * - `'unplaced'`: expired at an instant the clocks cannot place past its end (revoked before its
 *   end, or no end given). As in the SDK wait (A10-SDK-GRACE-01), such a read is final only once
 *   another, at least the grace (plus the clock's resolution) later on the same clock, still
 *   shows it: an answer accepted just before a revocation may still be landing.
 */
function expiredAt(session: object, meta: object): false | 'final' | 'unplaced' {
  if (stillOpen(session)) return false;
  const v = session as {
    action_expires_at?: unknown;
    action_expires_horizon?: unknown;
    extensions_used?: unknown;
    link_state?: unknown;
  };
  const deadline = instant(v.action_expires_at);
  const observedAt = observed(meta).at;
  if (v.link_state === 'expired') {
    const horizon = instant(v.action_expires_horizon);
    const extendable =
      horizon !== undefined && typeof v.extensions_used === 'number' && v.extensions_used < 10;
    const end = extendable && deadline !== undefined ? Math.max(horizon, deadline) : deadline;
    if (end !== undefined && observedAt >= end + LINK_EXPIRY_GRACE_MS) return 'final';
    return end === undefined || end > observedAt + LINK_EXPIRY_GRACE_MS ? 'unplaced' : false;
  }
  return deadline !== undefined && observedAt >= deadline + LINK_EXPIRY_GRACE_MS ? 'final' : false;
}

/** The runtime clock of a read: its HTTP Date (whole seconds) when given, else this machine's. */
function observed(meta: object): { at: number; resolutionMs: number; server: boolean } {
  const serverDate: unknown = (meta as { serverDate?: unknown }).serverDate;
  return typeof serverDate === 'number' && Number.isFinite(serverDate)
    ? { at: serverDate, resolutionMs: 1000, server: true }
    : { at: Date.now(), resolutionMs: 0, server: false };
}
export interface VerifiedResponseResult {
  eventId: string;
  actionId: string;
  data: Record<string, unknown>;
  verified: true;
  actorAssurance: 'link_holder';
}
export interface AdapterResult {
  interaction: {
    handle: string;
    revision: number;
    state: InteractionState;
    humanUrl?: string;
    /** When the link stops taking answers (`action_expires_at`), on create. */
    expiresAt?: string;
    response?: VerifiedResponseResult;
  };
}

/**
 * The authority the operations run with, supplied by a composition and never by tool arguments:
 * a SESS client acting for exactly that authority (its credential comes from the composition), a
 * handle store view bound to the same authority, and the wait bound.
 */
export interface OperationContext {
  client: SessClient;
  store: HandleStore;
  /** Upper bound and default for one sess_response wait. */
  maxWaitMs: number;
}

/**
 * Local (stdio) composition: the owner credential and profile store come from the server process
 * environment on the first tool call, exactly as before.
 */
export interface LocalAdapterOptions {
  env: NodeJS.ProcessEnv;
  diagnostics: Diagnostics;
  /** Test seam only; never reachable from tool arguments. */
  createClient?: (config: AdapterConfig) => SessClient;
  now?: () => Date;
  context?: never;
}

/**
 * Explicit composition (for example the hosted HTTP handler): `context` resolves the authority
 * once per adapter, on the first tool call; a failure is not cached.
 */
export interface ContextAdapterOptions {
  context: () => Promise<OperationContext>;
  diagnostics: Diagnostics;
  now?: () => Date;
  env?: never;
  createClient?: never;
}

export type AdapterOptions = LocalAdapterOptions | ContextAdapterOptions;

/**
 * Canonical body digest from the shared adapter core. Inputs are validated plain JSON (finite
 * numbers, no undefined), so the shared canonicalizer's non-JSON TypeError cannot occur here.
 */
function digest(value: JsonObject): string {
  return bodyDigest(value);
}

function defaultClient(config: AdapterConfig): SessClient {
  return new Sess({
    apiKey: config.apiKey,
    baseUrl: config.origin,
    allowInsecureLocalhost: config.allowInsecureLocalhost,
    fetch: userAgentFetch(),
    ...(config.receiptIssuer ? { receiptIssuer: config.receiptIssuer } : {}),
    ...(config.expectedWorkspaceId ? { expectedWorkspaceId: config.expectedWorkspaceId } : {}),
  });
}

/** A SESS error code only if it has the stable public shape; anything else is dropped. */
function safeCode(error: unknown): string | undefined {
  return error instanceof SessError && typeof error.code === 'string' && /^[A-Z_]{1,64}$/.test(error.code)
    ? error.code
    : undefined;
}

/**
 * The length detail of a Sess 400 INVALID_SCHEMA (field, limit, length), when the SDK exposes it
 * (`SessError.field/limit/length`, after @sess.si/sdk 0.1.0-rc.7). Read defensively: an older SDK
 * has none, and the local checks have already refused the same limits before dispatch.
 */
function sessLength(error: unknown): LengthDetail | undefined {
  if (!(error instanceof SessError) || error.code !== 'INVALID_SCHEMA') return undefined;
  const { field, limit, length } = error as unknown as Record<string, unknown>;
  const count = (n: unknown) => typeof n === 'number' && Number.isSafeInteger(n) && n >= 0;
  return typeof field === 'string' &&
    // A pointer may end with a record key; no controls or bidirectional overrides.
    /^(?:\/[^\u0000-\u001f\u007f-\u009f‪-‮⁦-⁩/]{0,128}){1,16}$/.test(field) &&
    count(limit) &&
    count(length)
    ? { field, limit: limit as number, length: length as number }
    : undefined;
}

/** The fixed text of a plan refusal; Sess's own message (owner wording and a URL) is never relayed. */
const PLAN_LIMIT_MESSAGE =
  'Sess did not create the interaction: the workspace has reached a limit of its plan. Nothing was created.';

/**
 * A create that Sess refused with 429 PLAN_LIMIT_REACHED: a definite refusal, nothing created.
 * An SDK with the plan limit in its rejection table reports it as `rejected`; an earlier SDK
 * (0.1.0-rc.8, the current pin) reports it as `unknown_outcome`, but a create is attempted exactly
 * once, so its single coded 429 answer is the whole outcome. A plain rate limit (no code or
 * RATE_LIMITED) and any other status stay uncertain.
 */
function planLimitRefusal(error: unknown): boolean {
  return (
    error instanceof SessError &&
    error.code === 'PLAN_LIMIT_REACHED' &&
    error.status === 429 &&
    error.getRecoveryResult() === undefined &&
    (error.outcome === 'rejected' || (error.outcome === 'unknown' && error.attempts === 1))
  );
}

function sessCode(error: unknown): string {
  if (error instanceof SessError) return `${error.kind}${safeCode(error) ? `/${safeCode(error)}` : ''}`;
  return 'unexpected';
}

/** Saving after a confirmed create failed: the Session exists, so the call must not be repeated. */
function createdNotSaved(): AdapterError {
  return new AdapterError(
    'CREATED_NOT_SAVED',
    'Sess created the interaction, but it could not be saved locally. Do not call sess_request again for this question; ask the owner to check the local state directory and Sess.',
  );
}

/**
 * Maps an SDK error from a read, wait or verification (no state change in any case):
 * `configuration` and `protocol` are deterministic and not retryable; `api`, `transport`,
 * `timeout`, `unknown_outcome` and anything unrecognized are retryable unavailability. Callers
 * handle `aborted`, `wait_ended` and `receipt_verification` before this.
 */
function unavailable(error: unknown): AdapterError {
  const code = safeCode(error);
  const detail = code ? ` (${code})` : '';
  if (error instanceof SessError && error.kind === 'configuration')
    return new AdapterError(
      'NOT_CONFIGURED',
      `The Sess client rejected the request before sending it${detail}. Check the MCP server configuration. Nothing was changed.`,
    );
  if (error instanceof SessError && error.kind === 'protocol')
    return new AdapterError(
      'SESS_PROTOCOL_ERROR',
      `Sess returned a response this client cannot accept${detail}. Check that SESS_API_ORIGIN is a compatible Sess API. Nothing was changed.`,
    );
  return new AdapterError(
    'SESS_UNAVAILABLE',
    `Sess could not be reached or returned an error${detail}. Nothing was changed locally; the same call can be repeated.`,
    true,
  );
}

export class SessMcpAdapter {
  #options: AdapterOptions;
  #context?: Promise<OperationContext>;
  #secrets: string[] = [];
  /**
   * Per handle and revision, the first read-once (wait_ms 0) in a row that showed the link expired
   * at an instant the clocks cannot place (see expiredAt). In memory only: a restart starts the
   * grace again, which only ever delays the end, never reports it early.
   */
  #unplacedSince = new Map<string, { at: number; resolutionMs: number; server: boolean }>();

  constructor(options: AdapterOptions) {
    this.#options = options;
  }

  /** Values that must never appear in diagnostics: the key and every human URL seen. */
  secrets(): readonly string[] {
    return this.#secrets;
  }

  #now(): string {
    return (this.#options.now?.() ?? new Date()).toISOString();
  }

  /** The local composition: env credential and profile store, read on the first tool call. */
  async #local(options: LocalAdapterOptions): Promise<OperationContext> {
    const config = loadConfig(options.env);
    this.#secrets.push(config.apiKey);
    const store = await ProfileHandleStore.open(
      config.stateDir,
      config.profile,
      config.origin,
      config.apiKey,
    );
    const client = (options.createClient ?? defaultClient)(config);
    options.diagnostics('configured', { profile: config.profile });
    return { client, store, maxWaitMs: config.maxWaitMs };
  }

  async #ctx(): Promise<OperationContext> {
    const options = this.#options;
    this.#context ??= options.context ? options.context() : this.#local(options);
    try {
      return await this.#context;
    } catch (error) {
      this.#context = undefined;
      throw error;
    }
  }

  /** Every loaded record is checked against the authority of this call, whatever the store does. */
  async #load(store: HandleStore, handle: string): Promise<HandleRecord> {
    const record = await store.load(handle);
    assertBindingAccess(record.binding, store.binding);
    return record;
  }

  #result(record: HandleRecord, state: InteractionState, extra: Partial<AdapterResult['interaction']> = {}) {
    return { interaction: { handle: record.handle, revision: record.revision, state, ...extra } };
  }

  #answered(record: HandleRecord): AdapterResult {
    const answer = record.answer!;
    return {
      interaction: {
        handle: record.handle,
        revision: answer.revision,
        state: 'answered',
        response: {
          eventId: answer.eventId,
          actionId: answer.actionId,
          data: answer.data,
          verified: true,
          actorAssurance: 'link_holder',
        },
      },
    };
  }

  /** request: persist intent, create exactly once, persist, then return URL and handle immediately. */
  async request(args: RequestArgs): Promise<AdapterResult> {
    const { store, client } = await this.#ctx();
    await store.assertCapacity();
    const body = {
      interaction: args.interaction,
      ...(args.expiresIn !== undefined ? { expires_in: args.expiresIn } : {}),
    };
    const now = this.#now();
    const record: HandleRecord = {
      schema: RECORD_SCHEMA,
      handle: store.newHandle(),
      binding: store.binding,
      state: 'create_intent',
      createdAt: now,
      updatedAt: now,
      requestDigest: digest(body),
      revision: 1,
      processed: [],
    };
    await store.save(record);
    let created;
    try {
      // No abort signal: cancelling an in-flight create would only make its outcome unknown.
      created = await client.sessions.create(body as unknown as CreateSessionRequest);
    } catch (error) {
      if (planLimitRefusal(error)) {
        // A definite refusal: nothing was created, so nothing is kept and nothing is uncertain.
        await store.discard(record.handle);
        this.#options.diagnostics('create_rejected', { code: sessCode(error) });
        throw new AdapterError('PLAN_LIMIT_REACHED', PLAN_LIMIT_MESSAGE);
      }
      if (error instanceof SessError && (error.outcome === 'not_sent' || error.outcome === 'rejected')) {
        await store.discard(record.handle);
        this.#options.diagnostics('create_rejected', { code: sessCode(error) });
        const code = safeCode(error);
        const detail = code ? ` (${code})` : '';
        const tooLong = sessLength(error);
        if (tooLong)
          throw new AdapterError(
            'CREATE_REJECTED',
            `Sess did not create the interaction: ${lengthMessage(tooLong.field, tooLong.limit, tooLong.length)}`,
            false,
            tooLong,
          );
        throw new AdapterError('CREATE_REJECTED', `Sess did not create the interaction${detail}.`);
      }
      const recovered = error instanceof SessError ? error.getRecoveryResult() : undefined;
      if (recovered) {
        // A valid creation body arrived with a defective envelope: protect and reconcile it.
        this.#secrets.push(recovered.human_url);
        Object.assign(record, {
          state: 'waiting',
          sessionId: recovered.id,
          humanUrl: recovered.human_url,
          revision: recovered.revision,
          updatedAt: this.#now(),
        });
        await store.save(record).catch(() => {
          throw createdNotSaved();
        });
        this.#options.diagnostics('create_recovered', { code: sessCode(error) });
        return this.#result(record, 'waiting', { humanUrl: recovered.human_url });
      }
      record.state = 'create_unknown';
      record.updatedAt = this.#now();
      // The intent saved before dispatch still reports the unconfirmed create if this save fails;
      // either way the result is non-retryable so the create is never repeated.
      await store.save(record).catch(() => {
        throw new AdapterError(
          'CREATE_OUTCOME_UNKNOWN',
          'The create outcome is unknown and could not be saved locally; a Session may exist. Do not call sess_request again for this question; ask the owner to check Sess and the local state directory.',
        );
      });
      this.#options.diagnostics('create_unknown', { code: sessCode(error) });
      throw new AdapterError(
        'CREATE_OUTCOME_UNKNOWN',
        'The create outcome is unknown; a Session may exist. It was not retried automatically. Ask the owner to check Sess before creating another interaction.',
      );
    }
    this.#secrets.push(created.data.human_url);
    Object.assign(record, {
      state: 'waiting',
      sessionId: created.data.id,
      humanUrl: created.data.human_url,
      revision: created.data.revision,
      etag: created.meta.etag,
      updatedAt: this.#now(),
    });
    // The Session exists now. A save failure must never invite a repeated create.
    await store.save(record).catch(() => {
      throw createdNotSaved();
    });
    this.#options.diagnostics('created', { revision: record.revision });
    const expiresAt: unknown = (created.data as { action_expires_at?: unknown }).action_expires_at;
    return this.#result(record, 'waiting', {
      humanUrl: created.data.human_url,
      ...(typeof expiresAt === 'string' ? { expiresAt } : {}),
    });
  }

  /** response: authorize, then read or perform one bounded wait for the exact revision; verify fully. */
  async response(args: ResponseArgs, signal?: AbortSignal): Promise<AdapterResult> {
    const { maxWaitMs, store, client } = await this.#ctx();
    const record = await this.#load(store, args.handle);
    if (record.state === 'answered') return this.#releaseCached(record, args.revision, signal);
    const settled = this.#settledWithoutAnswer(record, args.revision);
    if (settled) return settled;
    const sessionId = record.sessionId!;
    const waitMs = Math.min(args.waitMs ?? maxWaitMs, maxWaitMs);
    let found: { response: AcceptedResponse; etag: string; currentRevision: number } | undefined;
    try {
      if (waitMs === 0) {
        const current = await client.sessions.retrieve(sessionId, signal ? { signal } : {});
        const session = current.data;
        if (!('responses' in session)) return await this.#block(record, 'NOT_INTERACTIVE');
        const response = session.responses.find((r) => r.revision === args.revision);
        if (response) found = { response, etag: current.meta.etag, currentRevision: session.revision };
        else if (session.status === 'completed') return await this.#block(record, 'CLOSED_WITHOUT_RESPONSE');
        else if (session.revision > args.revision) return await this.#block(record, 'REVISION_SUPERSEDED');
        else {
          const key = `${record.handle}:${args.revision}`;
          const end = expiredAt(session, current.meta);
          if (end === 'final') {
            this.#unplacedSince.delete(key);
            return await this.#expire(record);
          }
          if (end === 'unplaced') {
            const now = observed(current.meta);
            const since = this.#unplacedSince.get(key);
            if (
              since !== undefined &&
              since.server === now.server &&
              now.at >= since.at + LINK_EXPIRY_GRACE_MS + since.resolutionMs
            ) {
              this.#unplacedSince.delete(key);
              return await this.#expire(record);
            }
            if (since === undefined || since.server !== now.server) this.#unplacedSince.set(key, now);
          } else this.#unplacedSince.delete(key);
          return await this.#transition(record, 'waiting');
        }
      } else {
        const result = await client.sessions.waitForResponse(sessionId, {
          revision: args.revision,
          timeoutMs: waitMs,
          ...(signal ? { signal } : {}),
        });
        found = {
          response: result.response,
          etag: result.meta.etag,
          currentRevision: result.session.revision,
        };
      }
    } catch (error) {
      if (error instanceof AdapterError) throw error;
      if (error instanceof SessError && error.kind === 'wait_ended') {
        if (error.code === 'WAIT_TIMEOUT') return await this.#transition(record, 'needs_resume');
        if (error.code === LINK_EXPIRED) {
          // An SDK before link timing ends its wait at the deadline even when the link has only
          // lapsed. One read decides: a live or lapsed link is still open (waiting); otherwise
          // the link has expired.
          let session: object;
          try {
            session = (await client.sessions.retrieve(sessionId, signal ? { signal } : {})).data;
          } catch (readError) {
            throw unavailable(readError);
          }
          const answered =
            'responses' in session &&
            (session as { responses: { revision: number }[] }).responses.some(
              (r) => r.revision === args.revision,
            );
          // An answer that landed meanwhile is released by the next call.
          if (answered || stillOpen(session)) return await this.#transition(record, 'waiting');
          return await this.#expire(record);
        }
        return await this.#block(record, error.code ?? 'WAIT_ENDED');
      }
      if (error instanceof SessError && error.kind === 'aborted') {
        // MCP cancellation ends only this local wait. The Session stays open for a later call.
        return await this.#transition(record, 'needs_resume');
      }
      throw unavailable(error);
    }
    if (found.currentRevision !== args.revision) return await this.#block(record, 'UNEXPECTED_PROGRESS');
    let verified;
    try {
      verified = await client.receipts.verifyResponse(
        { sessionId, response: found.response },
        signal ? { signal } : {},
      );
    } catch (error) {
      const verification = classifyVerification(error);
      if (verification === 'transient') {
        // The trusted key set could not be loaded (for example a 5xx, timeout or refresh
        // cooldown). The answer was not judged: nothing is recorded and the state is unchanged,
        // so a later sess_response re-reads and fully verifies it.
        this.#options.diagnostics('verification_deferred', { code: sessCode(error) });
        throw new AdapterError(
          'SESS_UNAVAILABLE',
          'An answer arrived, but Sess receipt keys could not be loaded right now. Nothing was accepted or changed; call sess_response again shortly.',
          true,
        );
      }
      if (verification === 'configuration') {
        // No trusted workspace audience: an owner configuration problem, not a bad answer.
        // Nothing is recorded and the state is unchanged; the same answer verifies once configured.
        this.#options.diagnostics('verification_not_configured', { code: sessCode(error) });
        throw new AdapterError(
          'NOT_CONFIGURED',
          'The answer cannot be verified because no trusted workspace is known. This Sess runtime does not return Sess-Workspace-Id; set SESS_EXPECTED_WORKSPACE_ID in the MCP server environment and call sess_response again. Nothing was accepted or changed.',
        );
      }
      if (verification === 'genuine') {
        this.#options.diagnostics('verification_failed', { code: sessCode(error) });
        await this.#block(record, 'VERIFICATION_FAILED', false);
        throw new AdapterError(
          'VERIFICATION_FAILED',
          'An answer arrived but its Sess receipt did not verify. It was not accepted; the interaction is blocked for owner review.',
        );
      }
      if (error instanceof SessError && error.kind === 'aborted')
        return await this.#transition(record, 'needs_resume');
      throw unavailable(error);
    }
    const response = verified.response;
    if (
      response.event_id !== found.response.event_id ||
      response.revision !== args.revision ||
      verified.surface.revision !== args.revision ||
      verified.surface.id !== sessionId ||
      response.actor.assurance !== 'link_holder'
    ) {
      await this.#block(record, 'VERIFICATION_FAILED', false);
      throw new AdapterError(
        'VERIFICATION_FAILED',
        'The verified answer did not match the requested revision.',
      );
    }
    // Currentness: the verifier proves the retained historical event, not that it is still the current
    // step. An authenticated current-revision read after verification gates every release.
    const fresh = await this.#confirmCurrent(sessionId, args.revision, response.event_id, signal);
    if (fresh.kind === 'aborted') return await this.#transition(record, 'needs_resume');
    if (fresh.kind === 'progress') return await this.#block(record, fresh.reason);
    const data = plainJson(JSON.parse(JSON.stringify(response.data)), 'data') as JsonObject;
    return store.withLock(record.handle, async () => {
      const current = await this.#load(store, record.handle);
      // Same accepted event already saved by a concurrent call; this call made its own fresh read.
      if (
        current.state === 'answered' &&
        current.answer?.eventId === response.event_id &&
        current.revision === args.revision
      )
        return this.#answered(current);
      if (
        (current.state !== 'waiting' && current.state !== 'needs_resume') ||
        current.revision !== args.revision
      ) {
        // A stale observation never overwrites a concurrently changed record or releases data.
        this.#settledWithoutAnswer(current, args.revision);
        throw new AdapterError(
          'INVALID_STATE',
          'The interaction changed while waiting. Call sess_response again.',
        );
      }
      Object.assign(current, {
        state: 'answered',
        etag: fresh.etag,
        answer: { revision: args.revision, eventId: response.event_id, actionId: response.action_id, data },
        updatedAt: this.#now(),
      });
      await store.save(current);
      this.#options.diagnostics('answered', { revision: args.revision });
      return this.#answered(current);
    });
  }

  /** Returns a result for records whose state answers the read without contacting SESS. */
  #settled(record: HandleRecord, revision: number): AdapterResult | undefined {
    switch (record.state) {
      case 'create_intent':
      case 'create_unknown':
        throw new AdapterError(
          'CREATE_OUTCOME_UNKNOWN',
          'This interaction was never confirmed as created. It needs owner resolution and is not retried.',
        );
      case 'blocked':
        if (record.blockedReason === LINK_EXPIRED) {
          if (revision !== record.revision) throw this.#revisionMismatch(record);
          return this.#result(record, 'expired');
        }
        throw new AdapterError(
          'RECOVERY_BLOCKED',
          `This interaction is blocked (${record.blockedReason ?? 'unknown'}) and needs owner review.`,
        );
      case 'completed':
        if (revision !== record.revision) throw this.#revisionMismatch(record);
        return this.#result(record, 'completed');
      case 'publish_pending':
      case 'complete_pending': {
        const operation = record.pending!.operation;
        throw new AdapterError(
          'MUTATION_PENDING',
          `A ${operation} for this interaction is pending. Repeat that exact sess_${operation} call to reconcile it before reading again.`,
        );
      }
      case 'answered':
        // Unreachable by design: cached answers are released only by #releaseCached after a fresh
        // current-revision read. Fail closed rather than release cached data.
        throw new AdapterError(
          'INVALID_STATE',
          'The interaction changed while this call was running. Call sess_response again.',
        );
      case 'waiting':
      case 'needs_resume':
        if (revision !== record.revision) throw this.#revisionMismatch(record);
        return undefined;
    }
  }

  /**
   * Like #settled, but never releases a cached answer: answer data is released only by a call that
   * made its own post-verification current-revision read. Returns undefined only for waiting states.
   */
  #settledWithoutAnswer(record: HandleRecord, revision: number): AdapterResult | undefined {
    if (record.state === 'answered')
      throw new AdapterError(
        'INVALID_STATE',
        'The interaction changed while this call was running. Call sess_response again.',
      );
    return this.#settled(record, revision);
  }

  /**
   * Authenticated current-revision evidence for releasing an answer. Current only if the Session
   * is still at `revision` and retains exactly the verified event: `responded` there, or
   * `completed` at that same revision (a legitimate terminal state for the same answer).
   * A failed read changes nothing and is reported as unavailable; it never releases data.
   */
  async #confirmCurrent(
    sessionId: string,
    revision: number,
    eventId: string,
    signal?: AbortSignal,
  ): Promise<{ kind: 'current'; etag: string } | { kind: 'progress'; reason: string } | { kind: 'aborted' }> {
    const { client } = await this.#ctx();
    let current;
    try {
      current = await client.sessions.retrieve(sessionId, signal ? { signal } : {});
    } catch (error) {
      if (error instanceof SessError && error.kind === 'aborted') return { kind: 'aborted' };
      this.#options.diagnostics('currentness_read_failed', { code: sessCode(error) });
      throw unavailable(error);
    }
    const session = current.data;
    if (!('responses' in session)) return { kind: 'progress', reason: 'NOT_INTERACTIVE' };
    const retained = session.responses.some((r) => r.event_id === eventId && r.revision === revision);
    if (
      retained &&
      session.revision === revision &&
      (session.status === 'responded' || session.status === 'completed')
    )
      return { kind: 'current', etag: current.meta.etag };
    this.#options.diagnostics('answer_superseded', { revision, remoteRevision: session.revision });
    return { kind: 'progress', reason: 'UNEXPECTED_PROGRESS' };
  }

  /** Cached answered result: re-released only after a fresh current-revision read. */
  async #releaseCached(record: HandleRecord, revision: number, signal?: AbortSignal): Promise<AdapterResult> {
    const { store } = await this.#ctx();
    const answer = record.answer!;
    if (revision !== answer.revision) throw this.#revisionMismatch(record);
    const fresh = await this.#confirmCurrent(record.sessionId!, revision, answer.eventId, signal);
    if (fresh.kind === 'aborted')
      throw new AdapterError(
        'SESS_UNAVAILABLE',
        'The read was cancelled before the answer could be confirmed as current. Nothing changed; call sess_response again.',
        true,
      );
    if (fresh.kind === 'progress') return await this.#block(record, fresh.reason);
    return store.withLock(record.handle, async () => {
      const current = await this.#load(store, record.handle);
      if (
        current.state !== 'answered' ||
        current.revision !== record.revision ||
        current.answer?.eventId !== answer.eventId
      ) {
        this.#settledWithoutAnswer(current, revision);
        throw new AdapterError(
          'INVALID_STATE',
          'The interaction changed while this call was running. Call sess_response again.',
        );
      }
      return this.#answered(current);
    });
  }

  /**
   * The link expired with no answer for this revision: an expected end, not an error. The record
   * is kept as blocked with reason LINK_EXPIRED (no new state on disk) and reported as `expired`.
   * Nothing is completed or written on Sess.
   */
  async #expire(record: HandleRecord): Promise<AdapterResult> {
    await this.#block(record, LINK_EXPIRED, false);
    this.#options.diagnostics('expired', { revision: record.revision });
    return this.#result(record, 'expired');
  }

  #revisionMismatch(record: HandleRecord): AdapterError {
    return new AdapterError('REVISION_MISMATCH', `This interaction is at revision ${record.revision}.`);
  }

  async #transition(record: HandleRecord, state: 'waiting' | 'needs_resume'): Promise<AdapterResult> {
    const { store } = await this.#ctx();
    return store.withLock(record.handle, async () => {
      const current = await this.#load(store, record.handle);
      if (
        (current.state === 'waiting' || current.state === 'needs_resume') &&
        current.revision === record.revision
      ) {
        if (current.state !== state) {
          current.state = state;
          current.updatedAt = this.#now();
          await store.save(current);
        }
        return this.#result(current, state);
      }
      return (
        this.#settledWithoutAnswer(current, record.revision) ??
        this.#result(current, current.state as InteractionState)
      );
    });
  }

  /**
   * Compare-and-apply: blocks only if the record still has the state group and revision that the
   * caller observed. A stale observation (for example a wait that returned after another call
   * already advanced the record) never blocks newer work; it reports INVALID_STATE instead.
   */
  async #block(observed: HandleRecord, reason: string, raise = true): Promise<never> {
    const { store } = await this.#ctx();
    const safe = /^[A-Z_]{1,64}$/.test(reason) ? reason : 'UNEXPECTED';
    const group = (state: string) => (state === 'needs_resume' ? 'waiting' : state);
    const applied = await store.withLock(observed.handle, async () => {
      const current = await this.#load(store, observed.handle);
      if (current.state === 'blocked') return true;
      if (group(current.state) !== group(observed.state) || current.revision !== observed.revision)
        return false;
      current.state = 'blocked';
      current.blockedReason = safe;
      current.updatedAt = this.#now();
      await store.save(current);
      return true;
    });
    if (!applied) {
      this.#options.diagnostics('block_skipped_stale', { reason: safe });
      throw new AdapterError(
        'INVALID_STATE',
        'The interaction changed while this call was running. Call sess_response for the current revision.',
      );
    }
    this.#options.diagnostics('blocked', { reason: safe });
    if (!raise) return undefined as never;
    throw new AdapterError(
      'RECOVERY_BLOCKED',
      `This interaction is blocked (${safe}) and needs owner review.`,
    );
  }

  /** Shared publish/complete preparation: require the matching verified answer, persist the exact intent. */
  async #prepare(
    operation: 'publish' | 'complete',
    args: CompleteArgs,
    body?: JsonObject,
  ): Promise<{ record: HandleRecord; pending: PendingMutation } | { done: AdapterResult }> {
    const { store } = await this.#ctx();
    return store.withLock(args.handle, async () => {
      const record = await this.#load(store, args.handle);
      const pendingState = operation === 'publish' ? 'publish_pending' : 'complete_pending';
      if (record.state === pendingState) {
        const p = record.pending!;
        if (
          p.expectedRevision !== args.expectedRevision ||
          p.responseEventId !== args.responseEventId ||
          (body !== undefined && canonicalJson(p.body!) !== canonicalJson(body))
        )
          throw new AdapterError(
            'PENDING_MUTATION_DIFFERS',
            `A ${operation} for this interaction is already pending with different arguments. Repeat the original call to reconcile it.`,
          );
        return { record, pending: p };
      }
      const used = record.processed.find((t) => t.eventId === args.responseEventId);
      if (used) {
        // Only an exact replay of the confirmed call is answered from the saved transition.
        const exact =
          used.operation === operation &&
          used.expectedRevision === args.expectedRevision &&
          (operation === 'complete' || used.bodyDigest === digest(body!));
        if (!exact)
          throw new AdapterError(
            'PENDING_MUTATION_DIFFERS',
            'This answer was already used by a different publish or complete call. Nothing was sent.',
          );
        if (operation === 'complete' && record.state === 'completed')
          return { done: this.#result(record, 'completed') };
        if (
          operation === 'publish' &&
          (record.state === 'waiting' || record.state === 'needs_resume') &&
          record.revision === args.expectedRevision + 1
        )
          return { done: this.#result(record, 'waiting') };
        throw new AdapterError(
          'RESPONSE_MISMATCH',
          'This answer was already used and the interaction has advanced since. Nothing was sent.',
        );
      }
      if (operation === 'complete' && record.state === 'completed')
        throw new AdapterError(
          'RESPONSE_MISMATCH',
          'This interaction was completed from a different answer.',
        );
      if (record.state !== 'answered') {
        if (
          record.state === 'blocked' ||
          record.state === 'create_intent' ||
          record.state === 'create_unknown'
        )
          this.#settledWithoutAnswer(record, args.expectedRevision);
        throw new AdapterError(
          'INVALID_STATE',
          `This interaction has no verified, unused answer to ${operation} from. Call sess_response first.`,
        );
      }
      const answer = record.answer!;
      if (answer.revision !== args.expectedRevision || record.revision !== args.expectedRevision)
        throw this.#revisionMismatch(record);
      if (answer.eventId !== args.responseEventId)
        throw new AdapterError(
          'RESPONSE_MISMATCH',
          'response_event_id is not the verified answer for this revision.',
        );
      if (!record.etag)
        throw new AdapterError(
          'INVALID_STATE',
          'No current version is saved for this answer. Call sess_response again.',
        );
      const pending: PendingMutation = {
        operation,
        sessionId: record.sessionId!,
        ifMatch: record.etag,
        idempotencyKey: `sess-mcp:${randomUUID()}`,
        credentialGeneration: record.binding.credentialGeneration,
        expectedRevision: args.expectedRevision,
        responseEventId: args.responseEventId,
        ...(body !== undefined ? { body } : {}),
      };
      Object.assign(record, { state: pendingState, pending, updatedAt: this.#now() });
      // Persisted before dispatch: replay uses exactly these values, never a regenerated identity.
      await store.save(record);
      return { record, pending };
    });
  }

  async #mutationFailed(
    record: HandleRecord,
    operation: 'publish' | 'complete',
    error: unknown,
  ): Promise<never> {
    this.#options.diagnostics(`${operation}_failed`, { code: sessCode(error) });
    const code = safeCode(error);
    // The SDK reports `rejected` only for a definitive coded 4xx from its rejection table with no
    // possible earlier write; such a saved request cannot succeed by replay. Everything else
    // (not_sent, unknown, 408/429/5xx, transport, timeout, abort) stays pending and retryable.
    // A not_sent failure from the SDK's own deterministic input/configuration checks (for example a
    // corrupt saved If-Match) can never succeed on identical replay either.
    if (error instanceof SessError && error.outcome === 'not_sent' && error.kind === 'configuration') {
      const reason = code ?? 'SDK_CONFIGURATION';
      await this.#block(record, reason, false);
      throw new AdapterError(
        'MUTATION_REJECTED',
        `The Sess client refused to send the saved ${operation} (${reason}). The interaction is blocked for owner review.`,
      );
    }
    if (error instanceof SessError && error.outcome === 'rejected') {
      const reason = code ?? `HTTP_${error.status ?? 'REJECTED'}`;
      await this.#block(record, reason, false);
      throw new AdapterError(
        'MUTATION_REJECTED',
        `Sess rejected the ${operation} (${reason}). The interaction is blocked for owner review.`,
      );
    }
    throw new AdapterError(
      'OUTCOME_UNKNOWN',
      `The ${operation} outcome is not confirmed. Repeat the same call to reconcile it with the saved request.`,
      true,
    );
  }

  async complete(args: CompleteArgs): Promise<AdapterResult> {
    const { store, client } = await this.#ctx();
    const prepared = await this.#prepare('complete', args);
    if ('done' in prepared) return prepared.done;
    const { record, pending } = prepared;
    let confirmed = false;
    try {
      const result = await client.sessions.complete(pending.sessionId, {
        ifMatch: pending.ifMatch,
        idempotencyKey: pending.idempotencyKey,
      });
      confirmed =
        result.data.id === pending.sessionId &&
        result.data.status === 'completed' &&
        result.data.revision === pending.expectedRevision;
    } catch (error) {
      if (error instanceof SessError && error.code === 'SESSION_COMPLETED') {
        try {
          const current = await client.sessions.retrieve(pending.sessionId);
          // Already completed: confirmed only if completed at the expected revision.
          confirmed =
            'status' in current.data &&
            current.data.status === 'completed' &&
            current.data.revision === pending.expectedRevision;
        } catch (readError) {
          // The read-back failed: the completion stays pending and the same call reconciles later.
          this.#options.diagnostics('complete_readback_failed', { code: sessCode(readError) });
          throw new AdapterError(
            'OUTCOME_UNKNOWN',
            'Sess reports the interaction completed, but it could not be read back to confirm. Repeat the same sess_complete call later.',
            true,
          );
        }
      } else {
        return this.#mutationFailed(record, 'complete', error);
      }
    }
    if (!confirmed) return this.#block(record, 'COMPLETE_NOT_CONFIRMED');
    return store.withLock(record.handle, async () => {
      const current = await this.#load(store, record.handle);
      if (current.state === 'completed') return this.#result(current, 'completed');
      if (current.state !== 'complete_pending')
        throw new AdapterError('INVALID_STATE', 'The interaction changed.');
      current.state = 'completed';
      current.processed = [
        ...current.processed,
        {
          eventId: pending.responseEventId,
          operation: 'complete',
          expectedRevision: pending.expectedRevision,
        },
      ];
      current.answer = { ...current.answer!, data: {} };
      delete current.pending;
      delete current.humanUrl;
      current.updatedAt = this.#now();
      await store.save(current);
      this.#options.diagnostics('completed', { revision: current.revision });
      return this.#result(current, 'completed');
    });
  }

  async publish(args: PublishArgs): Promise<AdapterResult> {
    const { store, client } = await this.#ctx();
    const body = { interaction: args.interaction };
    const prepared = await this.#prepare('publish', args, body);
    if ('done' in prepared) return prepared.done;
    const { record, pending } = prepared;
    const nextRevision = pending.expectedRevision + 1;
    let result;
    try {
      result = await client.sessions.publish(
        pending.sessionId,
        pending.body as unknown as PublishSessionRequest,
        {
          ifMatch: pending.ifMatch,
          idempotencyKey: pending.idempotencyKey,
        },
      );
    } catch (error) {
      return this.#mutationFailed(record, 'publish', error);
    }
    if (result.data.id !== pending.sessionId || result.data.revision !== nextRevision)
      return this.#block(record, 'PUBLISH_NOT_CONFIRMED');
    return store.withLock(record.handle, async () => {
      const current = await this.#load(store, record.handle);
      if (current.state !== 'publish_pending') {
        if (current.state === 'waiting' && current.revision === nextRevision)
          return this.#result(current, 'waiting');
        throw new AdapterError('INVALID_STATE', 'The interaction changed.');
      }
      current.state = 'waiting';
      current.revision = nextRevision;
      current.etag = result.meta.etag;
      current.processed = [
        ...current.processed,
        {
          eventId: pending.responseEventId,
          operation: 'publish',
          expectedRevision: pending.expectedRevision,
          bodyDigest: digest(pending.body!),
        },
      ];
      delete current.answer;
      delete current.pending;
      current.updatedAt = this.#now();
      await store.save(current);
      this.#options.diagnostics('published', { revision: nextRevision });
      return this.#result(current, 'waiting');
    });
  }
}
