import { randomUUID } from 'node:crypto';
import { open, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { Sess, SessError, type InteractiveInteraction, type WaitResult } from '@sess/sdk';
import { invoiceInteraction } from './quickstart.js';

type Intent = {
  operation: 'publish' | 'complete';
  sessionId: string;
  ifMatch: string;
  idempotencyKey: string;
  body?: { interaction: InteractiveInteraction };
};
export interface Checkpoint {
  version: 1;
  phase: 'creating' | 'running' | 'completed';
  sessionId?: string;
  humanUrl?: string;
  revision: number;
  processedEvents: string[];
  intent?: Intent;
}
/** Application-owned persistence. save must commit before its promise resolves. */
export interface CheckpointStore {
  load(): Promise<Checkpoint | undefined>;
  save(value: Checkpoint): Promise<void>;
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
      const state = JSON.parse(text) as Checkpoint;
      if (
        state.version !== 1 ||
        !['creating', 'running', 'completed'].includes(state.phase) ||
        !Number.isSafeInteger(state.revision) ||
        state.revision < 1 ||
        !Array.isArray(state.processedEvents)
      ) {
        throw new Error('Checkpoint is incompatible; reconcile it without creating another Session.');
      }
      return state;
    },
    async save(value) {
      const temporary = `${path}.${randomUUID()}.tmp`;
      try {
        await writeFile(temporary, JSON.stringify(value), { mode: 0o600, flag: 'wx', flush: true });
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
): Promise<void> {
  let state = await store.load();
  if (!state) {
    state = { version: 1, phase: 'creating', revision: 1, processedEvents: [] };
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
    return;
  }
  for (;;) {
    if (state.intent) {
      const intent = structuredClone(state.intent);
      if (intent.sessionId !== sessionId) throw new Error('Mutation intent belongs to a different Session.');
      // Replay the saved body, ETag and key. Never derive a fresh intent on recovery.
      const result =
        intent.operation === 'publish'
          ? await sess.sessions.publish(sessionId, intent.body!, {
              ifMatch: intent.ifMatch,
              idempotencyKey: intent.idempotencyKey,
            })
          : await sess.sessions.complete(sessionId, {
              ifMatch: intent.ifMatch,
              idempotencyKey: intent.idempotencyKey,
            });
      delete state.intent;
      state.revision = result.data.revision;
      if (intent.operation === 'complete') state.phase = 'completed';
      await store.save(structuredClone(state));
      if (state.phase === 'completed')
        return runMultiRound(sess, store, deliverPrivately, expectedWorkspaceId);
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
      ...(state.revision === 3
        ? {}
        : {
            body: {
              interaction: {
                ...invoiceInteraction,
                title: `Review round ${state.revision + 1}`,
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
              } as InteractiveInteraction,
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
