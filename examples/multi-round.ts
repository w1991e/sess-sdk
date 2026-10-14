import { randomUUID } from 'node:crypto';
import { open, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import canonicalize from 'canonicalize';
import { Sess, SessError, type InteractiveInteraction, type WaitResult } from '@sess.si/sdk';
import { invoiceInteraction } from './quickstart.js';

type Intent = {
  operation: 'publish' | 'complete';
  sessionId: string;
  ifMatch: string;
  idempotencyKey: string;
  body?: { interaction: InteractiveInteraction };
  nextRevision?: number;
  credentialScope?: string;
};
export interface Checkpoint {
  version: 1 | 2;
  phase: 'creating' | 'running' | 'completed';
  sessionId?: string;
  humanUrl?: string;
  revision: number;
  processedEvents: string[];
  intent?: Intent;
  /** An application-owned credential slot/version label, never the credential itself. */
  credentialScope?: string;
  verification?: 'pending' | 'verified';
}
/** Application-owned persistence. save must commit before its promise resolves. */
export interface CheckpointStore {
  load(): Promise<Checkpoint | undefined>;
  save(value: Checkpoint): Promise<void>;
}

function incompatible(): never {
  throw new Error('Checkpoint is incompatible; reconcile it without creating another Session.');
}
function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) incompatible();
  return value as Record<string, unknown>;
}
const sessionIdPattern = /^ses_[0-9A-HJKMNP-TV-Z]{26}$/;
const eventIdPattern = /^evt_[0-9A-HJKMNP-TV-Z]{26}$/;
const keyPattern = /^[A-Za-z0-9_.:-]{1,128}$/;
const etagPattern = /^"[\x21\x23-\x7e\x80-\xff]{0,1024}"$/;
const scopePattern = /^[A-Za-z0-9_.:-]{1,128}$/;
function text(value: unknown, pattern: RegExp): value is string {
  return typeof value === 'string' && pattern.test(value);
}
function nextInteraction(amount: number, revision: number): InteractiveInteraction {
  return {
    ...invoiceInteraction,
    title: `Review round ${revision}`,
    source: {
      kind: 'sess_surface',
      components: [
        {
          type: 'field',
          name: 'amount',
          label: 'Confirm amount',
          required: true,
          schema: { type: 'number', minimum: 0 },
          value: amount,
        },
      ],
    },
  };
}

/** Version-aware application state, checked for every store before any dispatch. */
export function decodeCheckpoint(value: unknown): Checkpoint {
  const state = record(value);
  if (state.version !== 1 && state.version !== 2) incompatible();
  if (
    !['creating', 'running', 'completed'].includes(state.phase as string) ||
    !Number.isSafeInteger(state.revision) ||
    (state.revision as number) < 1 ||
    (state.revision as number) > 3 ||
    !Array.isArray(state.processedEvents) ||
    state.processedEvents.some((id) => !text(id, eventIdPattern)) ||
    new Set(state.processedEvents).size !== state.processedEvents.length
  )
    incompatible();
  if (
    state.verification !== undefined &&
    state.verification !== 'pending' &&
    state.verification !== 'verified'
  )
    incompatible();
  if (state.phase !== 'completed' && state.verification !== undefined) incompatible();
  if (state.version === 2 && !text(state.credentialScope, scopePattern)) incompatible();
  if (state.credentialScope !== undefined && !text(state.credentialScope, scopePattern)) incompatible();
  if (state.humanUrl !== undefined) {
    if (typeof state.humanUrl !== 'string' || /[\s\u0000-\u001f\u007f]/.test(state.humanUrl)) incompatible();
    let url: URL;
    try {
      url = new URL(state.humanUrl);
    } catch {
      return incompatible();
    }
    const local =
      url.hostname === 'localhost' ||
      url.hostname === '[::1]' ||
      /^127\.(?:\d{1,3}\.){2}\d{1,3}$/.test(url.hostname);
    if (
      !(url.protocol === 'https:' || (url.protocol === 'http:' && local)) ||
      url.username ||
      url.password ||
      url.search ||
      url.hash
    )
      incompatible();
  }
  if (state.phase === 'creating') {
    if (
      state.revision !== 1 ||
      state.processedEvents.length !== 0 ||
      state.sessionId !== undefined ||
      state.humanUrl !== undefined ||
      state.intent !== undefined
    )
      incompatible();
    return structuredClone(state) as unknown as Checkpoint;
  }
  if (!text(state.sessionId, sessionIdPattern) || (state.version === 2 && state.humanUrl === undefined))
    incompatible();
  if (state.phase === 'completed') {
    if (
      state.revision !== 3 ||
      state.processedEvents.length !== 3 ||
      state.intent !== undefined ||
      (state.version === 2 && state.verification === undefined)
    )
      incompatible();
    return structuredClone(state) as unknown as Checkpoint;
  }
  if (state.processedEvents.length !== (state.revision as number) - (state.intent === undefined ? 1 : 0))
    incompatible();
  if (state.intent !== undefined) {
    const intent = record(state.intent);
    const replayKey = Object.getOwnPropertyDescriptor(intent, 'idempotencyKey');
    if (!replayKey || !('value' in replayKey) || !text(replayKey.value, keyPattern)) incompatible();
    if (intent.sessionId !== state.sessionId || !text(intent.ifMatch, etagPattern)) incompatible();
    if (intent.operation !== 'publish' && intent.operation !== 'complete') incompatible();
    const expectedNext = intent.operation === 'publish' ? (state.revision as number) + 1 : 3;
    if (intent.nextRevision !== undefined && intent.nextRevision !== expectedNext) incompatible();
    if (
      state.version === 2 &&
      (intent.nextRevision !== expectedNext || intent.credentialScope !== state.credentialScope)
    )
      incompatible();
    if (intent.credentialScope !== undefined && !text(intent.credentialScope, scopePattern)) incompatible();
    switch (intent.operation) {
      case 'publish': {
        if (state.revision === 3) incompatible();
        const body = record(intent.body);
        if (Object.keys(body).length !== 1) incompatible();
        const interaction = record(body.interaction);
        const source = record(interaction.source);
        if (
          interaction.mode !== 'interactive' ||
          typeof interaction.title !== 'string' ||
          !interaction.title.trim() ||
          source.kind !== 'sess_surface' ||
          !Array.isArray(source.components) ||
          source.components.length === 0 ||
          !Array.isArray(interaction.actions) ||
          interaction.actions.length === 0 ||
          interaction.actions.some(
            (action) =>
              !text(record(action).id, /^[a-z][a-z0-9_]{0,31}$/) || typeof record(action).label !== 'string',
          )
        )
          incompatible();
        if (
          state.version === 2 &&
          (interaction.title !== `Review round ${expectedNext}` ||
            source.components.length !== 1 ||
            record(source.components[0]).type !== 'field' ||
            record(source.components[0]).name !== 'amount' ||
            typeof record(source.components[0]).value !== 'number' ||
            !Number.isFinite(record(source.components[0]).value))
        )
          incompatible();
        if (
          state.version === 2 &&
          canonicalize(body) !==
            canonicalize({
              interaction: nextInteraction(record(source.components[0]).value as number, expectedNext),
            })
        )
          incompatible();
        break;
      }
      case 'complete':
        if (state.revision !== 3 || intent.body !== undefined) incompatible();
        break;
      default:
        incompatible();
    }
  }
  return structuredClone(state) as unknown as Checkpoint;
}

/** Small single-process example. The application must hold an exclusive worker lease. */
export function fileCheckpointStore(path: string): CheckpointStore {
  return {
    async load() {
      let text: string;
      try {
        text = await readFile(path, 'utf8');
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
        throw error;
      }
      try {
        return decodeCheckpoint(JSON.parse(text));
      } catch {
        return incompatible();
      }
    },
    async save(value) {
      const snapshot = decodeCheckpoint(value);
      const temporary = `${path}.${randomUUID()}.tmp`;
      try {
        await writeFile(temporary, JSON.stringify(snapshot), { mode: 0o600, flag: 'wx', flush: true });
        await rename(temporary, path);
        // Persist the new directory entry before a create or mutation may be dispatched.
        if (process.platform !== 'win32') {
          const directory = await open(dirname(path), 'r');
          try {
            await directory.sync();
          } finally {
            await directory.close();
          }
        }
      } finally {
        await rm(temporary, { force: true });
      }
    },
  };
}

/** An old accepted answer plus a newer ETag must never advance a later business step. */
export function assertCurrentStep(state: Checkpoint, answer: WaitResult): void {
  if (
    state.phase !== 'running' ||
    state.sessionId !== answer.session.id ||
    state.revision !== answer.response.revision ||
    answer.session.revision !== state.revision ||
    answer.session.status !== 'responded' ||
    state.processedEvents.includes(answer.response.event_id)
  ) {
    throw new Error(
      'Saved workflow step differs from the current answered revision; reconcile without a new write.',
    );
  }
}

/**
 * Three rounds on one Session. The caller holds an exclusive durable worker lease,
 * keeps credential identity stable across uncertain retries, and privately protects
 * its checkpoint path. This example does no external business side effects.
 */
export async function runMultiRound(
  sess: Sess,
  store: CheckpointStore,
  deliverPrivately: (url: string) => Promise<void>,
  expectedWorkspaceId?: string,
  credentialScope?: string,
): Promise<void> {
  const loaded = await store.load();
  let state = loaded === undefined ? undefined : decodeCheckpoint(loaded);
  if (!state) {
    if (!text(credentialScope, scopePattern))
      throw new Error(
        'Supply an application-owned credential scope label before starting a durable workflow.',
      );
    state = { version: 2, phase: 'creating', revision: 1, processedEvents: [], credentialScope };
    await store.save(structuredClone(state));
    const created = await sess.sessions.create({ interaction: invoiceInteraction });
    state = {
      ...state,
      phase: 'running',
      sessionId: created.data.id,
      humanUrl: created.data.human_url,
      revision: created.data.revision,
    };
    await store.save(structuredClone(state));
    await deliverPrivately(created.data.human_url);
  }
  if (state.phase === 'creating' || !state.sessionId)
    throw new Error('Unresolved creation intent. Do not automatically create again.');
  const sessionId = state.sessionId;
  if (state.phase === 'completed') {
    // Fresh verification after restart; a saved completion marker is not trusted proof.
    const current = await sess.sessions.retrieve(sessionId);
    if (
      !('status' in current.data) ||
      current.data.status !== 'completed' ||
      current.data.revision !== 3 ||
      current.data.responses.length !== 3
    )
      throw new Error('Completed checkpoint requires reconciliation.');
    for (const response of current.data.responses)
      await sess.receipts.verifyResponse({
        sessionId,
        response,
        ...(expectedWorkspaceId ? { expectedWorkspaceId } : {}),
      });
    if (state.version === 2) {
      state.verification = 'verified';
      await store.save(structuredClone(state));
    }
    return;
  }
  if (state.version === 1) {
    // Old checkpoints never recorded credential scope. Observe already-applied work
    // without fabricating a scope, replacing its marker, or dispatching the old intent.
    const current = await sess.sessions.retrieve(sessionId);
    if (state.intent?.operation === 'publish') {
      if (current.data.revision < state.revision + 1)
        throw new Error('Legacy checkpoint intent is unresolved; reconcile without replay.');
      const surface = await sess.sessions.retrieveSurface(sessionId, state.revision + 1);
      if (
        canonicalize(surface.data.interaction) !==
        canonicalize({ ...state.intent.body!.interaction, response_policy: 'first' })
      )
        throw new Error('Legacy checkpoint intent is unresolved; reconcile without replay.');
    } else if (
      state.intent?.operation === 'complete' &&
      (!('status' in current.data) || current.data.status !== 'completed')
    ) {
      throw new Error('Legacy checkpoint intent is unresolved; reconcile without replay.');
    }
    throw new Error(
      'Legacy checkpoint retained for read-only reconciliation; establish credential scope manually before continuation.',
    );
  }
  if (credentialScope !== state.credentialScope)
    throw new Error('Credential scope differs from the saved checkpoint; reconcile without replay.');
  for (;;) {
    if (state.intent) {
      const intent = structuredClone(state.intent);
      if (intent.sessionId !== sessionId) throw new Error('Mutation intent belongs to a different Session.');
      // Replay the saved body, ETag and key. Never derive a fresh intent on recovery.
      let result;
      switch (intent.operation) {
        case 'publish':
          result = await sess.sessions.publish(sessionId, intent.body!, {
            ifMatch: intent.ifMatch,
            idempotencyKey: intent.idempotencyKey,
          });
          break;
        case 'complete':
          result = await sess.sessions.complete(sessionId, {
            ifMatch: intent.ifMatch,
            idempotencyKey: intent.idempotencyKey,
          });
          break;
        default:
          return incompatible();
      }
      if (result.data.revision !== intent.nextRevision)
        throw new Error(
          'Checkpoint replay result differs from its saved next revision; reconcile without clearing the intent.',
        );
      delete state.intent;
      state.revision = result.data.revision;
      if (intent.operation === 'complete') {
        state.phase = 'completed';
        state.verification = 'pending';
      }
      await store.save(structuredClone(state));
      if (state.phase === 'completed')
        return runMultiRound(sess, store, deliverPrivately, expectedWorkspaceId, credentialScope);
    }
    const answer = await sess.sessions.waitForResponse(sessionId, { revision: state.revision });
    assertCurrentStep(state, answer);
    const decision = await sess.receipts.verifyResponse({
      sessionId,
      response: answer.response,
      ...(expectedWorkspaceId ? { expectedWorkspaceId } : {}),
    });
    const amount = decision.response.data.amount;
    if (typeof amount !== 'number' || !Number.isFinite(amount))
      throw new Error('Expected an accepted numeric amount.');
    state.processedEvents.push(decision.response.event_id);
    state.intent = {
      operation: state.revision === 3 ? 'complete' : 'publish',
      sessionId,
      ifMatch: answer.meta.etag,
      idempotencyKey: randomUUID(),
      nextRevision: state.revision === 3 ? 3 : state.revision + 1,
      credentialScope: state.credentialScope,
      ...(state.revision === 3
        ? {}
        : {
            body: {
              interaction: nextInteraction(amount, state.revision + 1),
            },
          }),
    };
    await store.save(structuredClone(state));
  }
}

/** Local abort/timeout stops waiting; it never cancels the remote Session. */
export function isResumableWait(error: unknown): boolean {
  return error instanceof SessError && (error.kind === 'wait_ended' || error.kind === 'aborted');
}
