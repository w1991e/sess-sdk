import { randomUUID } from 'node:crypto';
import {
  Sess,
  SessError,
  type AcceptedResponse,
  type CreateSessionRequest,
  type PublishSessionRequest,
} from '@sess.si/sdk';
import { loadConfig, type AdapterConfig } from './config.js';
import { AdapterError, type Diagnostics } from './errors.js';
import { HandleStore, RECORD_SCHEMA, type HandleRecord, type PendingMutation } from './store.js';
import { bodyDigest, canonicalJson, classifyVerification } from './internal/shared.js';
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

export type InteractionState = 'waiting' | 'answered' | 'completed' | 'needs_resume';
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
    response?: VerifiedResponseResult;
  };
}

export interface AdapterOptions {
  env: NodeJS.ProcessEnv;
  diagnostics: Diagnostics;
  /** Test seam only; never reachable from tool arguments. */
  createClient?: (config: AdapterConfig) => SessClient;
  now?: () => Date;
}

interface Context {
  config: AdapterConfig;
  store: HandleStore;
  client: SessClient;
}

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

function sessCode(error: unknown): string {
  if (error instanceof SessError) return `${error.kind}${safeCode(error) ? `/${safeCode(error)}` : ''}`;
  return 'unexpected';
}

/** Saving after a confirmed create failed: the Session exists, so the call must not be repeated. */
function createdNotSaved(): AdapterError {
  return new AdapterError(
    'CREATED_NOT_SAVED',
    'SESS created the interaction, but it could not be saved locally. Do not call sess_request again for this question; ask the owner to check the local state directory and SESS.',
  );
}

function unavailable(error: unknown): AdapterError {
  const code = safeCode(error);
  const detail = code ? ` (${code})` : '';
  return new AdapterError(
    'SESS_UNAVAILABLE',
    `SESS could not be reached or returned an error${detail}. Nothing was changed locally; the same call can be repeated.`,
    true,
  );
}

export class SessMcpAdapter {
  #options: AdapterOptions;
  #context?: Promise<Context>;
  #secrets: string[] = [];

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

  async #ctx(): Promise<Context> {
    this.#context ??= (async () => {
      const config = loadConfig(this.#options.env);
      this.#secrets.push(config.apiKey);
      const store = await HandleStore.open(config.stateDir, config.profile, config.origin, config.apiKey);
      const client = (this.#options.createClient ?? defaultClient)(config);
      this.#options.diagnostics('configured', { profile: config.profile });
      return { config, store, client };
    })();
    try {
      return await this.#context;
    } catch (error) {
      this.#context = undefined;
      throw error;
    }
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
    const body = { interaction: args.interaction };
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
      if (error instanceof SessError && (error.outcome === 'not_sent' || error.outcome === 'rejected')) {
        await store.discard(record.handle);
        this.#options.diagnostics('create_rejected', { code: sessCode(error) });
        const code = safeCode(error);
        const detail = code ? ` (${code})` : '';
        throw new AdapterError('CREATE_REJECTED', `SESS did not create the interaction${detail}.`);
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
          'The create outcome is unknown and could not be saved locally; a Session may exist. Do not call sess_request again for this question; ask the owner to check SESS and the local state directory.',
        );
      });
      this.#options.diagnostics('create_unknown', { code: sessCode(error) });
      throw new AdapterError(
        'CREATE_OUTCOME_UNKNOWN',
        'The create outcome is unknown; a Session may exist. It was not retried automatically. Ask the owner to check SESS before creating another interaction.',
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
    return this.#result(record, 'waiting', { humanUrl: created.data.human_url });
  }

  /** response: authorize, then read or perform one bounded wait for the exact revision; verify fully. */
  async response(args: ResponseArgs, signal?: AbortSignal): Promise<AdapterResult> {
    const { config, store, client } = await this.#ctx();
    const record = await store.load(args.handle);
    const settled = this.#settled(record, args.revision);
    if (settled) return settled;
    const sessionId = record.sessionId!;
    const waitMs = Math.min(args.waitMs ?? config.maxWaitMs, config.maxWaitMs);
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
        else return await this.#transition(record, 'waiting');
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
          'An answer arrived, but SESS receipt keys could not be loaded right now. Nothing was accepted or changed; call sess_response again shortly.',
          true,
        );
      }
      if (verification === 'configuration') {
        // No trusted workspace audience: an owner configuration problem, not a bad answer.
        // Nothing is recorded and the state is unchanged; the same answer verifies once configured.
        this.#options.diagnostics('verification_not_configured', { code: sessCode(error) });
        throw new AdapterError(
          'NOT_CONFIGURED',
          'The answer cannot be verified because no trusted workspace is known. This SESS runtime does not return Sess-Workspace-Id; set SESS_EXPECTED_WORKSPACE_ID in the MCP server environment and call sess_response again. Nothing was accepted or changed.',
        );
      }
      if (verification === 'genuine') {
        this.#options.diagnostics('verification_failed', { code: sessCode(error) });
        await this.#block(record, 'VERIFICATION_FAILED', false);
        throw new AdapterError(
          'VERIFICATION_FAILED',
          'An answer arrived but its SESS receipt did not verify. It was not accepted; the interaction is blocked for owner review.',
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
    const data = plainJson(JSON.parse(JSON.stringify(response.data)), 'data') as JsonObject;
    return store.withLock(record.handle, async () => {
      const current = await store.load(record.handle);
      if (current.state === 'answered' && current.answer?.eventId === response.event_id)
        return this.#answered(current);
      if (
        (current.state !== 'waiting' && current.state !== 'needs_resume') ||
        current.revision !== args.revision
      ) {
        const again = this.#settled(current, args.revision);
        if (again) return again;
        throw new AdapterError(
          'INVALID_STATE',
          'The interaction changed while waiting. Call sess_response again.',
        );
      }
      Object.assign(current, {
        state: 'answered',
        etag: found.etag,
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
        if (revision !== record.answer!.revision) throw this.#revisionMismatch(record);
        return this.#answered(record);
      case 'waiting':
      case 'needs_resume':
        if (revision !== record.revision) throw this.#revisionMismatch(record);
        return undefined;
    }
  }

  #revisionMismatch(record: HandleRecord): AdapterError {
    return new AdapterError('REVISION_MISMATCH', `This interaction is at revision ${record.revision}.`);
  }

  async #transition(record: HandleRecord, state: 'waiting' | 'needs_resume'): Promise<AdapterResult> {
    const { store } = await this.#ctx();
    return store.withLock(record.handle, async () => {
      const current = await store.load(record.handle);
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
        this.#settled(current, record.revision) ?? this.#result(current, current.state as InteractionState)
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
      const current = await store.load(observed.handle);
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
      const record = await store.load(args.handle);
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
          this.#settled(record, args.expectedRevision);
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

  async #mutationFailed(record: HandleRecord, operation: string, error: unknown): Promise<never> {
    this.#options.diagnostics(`${operation}_failed`, { code: sessCode(error) });
    const code = safeCode(error);
    // The SDK reports `rejected` only for a definitive coded 4xx from its rejection table with no
    // possible earlier write; such a saved request cannot succeed by replay. Everything else
    // (not_sent, unknown, 408/429/5xx, transport, timeout, abort) stays pending and retryable.
    if (error instanceof SessError && error.outcome === 'rejected') {
      const reason = code ?? `HTTP_${error.status ?? 'REJECTED'}`;
      await this.#block(record, reason, false);
      throw new AdapterError(
        'MUTATION_REJECTED',
        `SESS rejected the ${operation} (${reason}). The interaction is blocked for owner review.`,
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
          return this.#mutationFailed(record, 'complete', readError);
        }
      } else {
        return this.#mutationFailed(record, 'complete', error);
      }
    }
    if (!confirmed) return this.#block(record, 'COMPLETE_NOT_CONFIRMED');
    return store.withLock(record.handle, async () => {
      const current = await store.load(record.handle);
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
      const current = await store.load(record.handle);
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
