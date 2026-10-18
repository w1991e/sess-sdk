import { SessError } from './errors.js';
import { abortError, boundedNumber, deadline, delay } from './internal/time.js';
import { isInteractiveSession } from './types.js';
import type {
  InteractiveSession,
  RequestOptions,
  Session,
  VersionedResult,
  WaitOptions,
  WaitResult,
} from './types.js';

/**
 * Once a Session's link has expired (`action_expires_at`), the wait reads it once more when the
 * runtime clock is this far past the expiry, then ends: an answer accepted before the expiry is
 * returned; otherwise the wait ends with `LINK_EXPIRED`. Two seconds covers the one-second
 * resolution of the HTTP `Date` header plus an answer accepted just before the expiry whose write
 * is still landing, and keeps the end prompt.
 */
export const LINK_EXPIRY_GRACE_MS = 2000;

/** The Session's link expiry in milliseconds since the epoch, when it carries a valid one. */
function linkExpiry(session: InteractiveSession): number | undefined {
  const value: unknown = (session as { action_expires_at?: unknown }).action_expires_at;
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(value))
    return undefined;
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? ms : undefined;
}

export async function waitForResponse(
  retrieve: (options: RequestOptions) => Promise<VersionedResult<Session>>,
  id: string,
  input: WaitOptions,
  clientOperationTimeoutMs: number,
): Promise<WaitResult> {
  if (!input || typeof input !== 'object')
    throw new SessError('configuration', 'waitForResponse requires an exact revision.');
  const options = { ...input };
  const revision = boundedNumber(options.revision, 0, 'revision');
  const timeoutMs = boundedNumber(options.timeoutMs, 10 * 60_000, 'timeoutMs');
  const intervalMs = boundedNumber(options.intervalMs, 1500, 'intervalMs', 1000);
  if (options.operationTimeoutMs !== undefined && typeof options.operationTimeoutMs !== 'number')
    throw new SessError('configuration', 'operationTimeoutMs must be a positive integer duration.', {
      outcome: 'not_sent',
    });
  // Validate before clamping so malformed overrides cannot become usable durations.
  const operationTimeoutMs = boundedNumber(
    options.operationTimeoutMs,
    clientOperationTimeoutMs,
    'operationTimeoutMs',
  );
  const budget = deadline(timeoutMs, options.signal);
  const expires = performance.now() + timeoutMs;
  const ended = (code: string, message: string) =>
    new SessError('wait_ended', message, { code, sessionId: id, revision });
  try {
    for (;;) {
      if (budget.signal.aborted) throw abortError(budget.signal);
      const remainingMs = Math.ceil(expires - performance.now());
      if (remainingMs <= 0)
        throw ended('WAIT_TIMEOUT', 'Human wait timed out. Resume using the same Session and revision.');
      const current = await retrieve({
        signal: budget.signal,
        operationTimeoutMs: Math.min(operationTimeoutMs, remainingMs),
        maxRetries: options.maxRetries,
        maxResponseBytes: options.maxResponseBytes,
      });
      if (!isInteractiveSession(current.data))
        throw ended('NOT_INTERACTIVE', 'A display Session has no accepted human responses.');
      const session = current.data;
      const response = session.responses.find((item) => item.revision === revision);
      // Retained history remains readable after a later revision or completion.
      if (response) return { session, response, meta: current.meta };
      if (session.status === 'completed')
        throw ended(
          'CLOSED_WITHOUT_RESPONSE',
          'Session completed without an accepted response for this revision.',
        );
      if (session.revision > revision)
        throw ended('REVISION_SUPERSEDED', 'The requested unanswered revision was superseded.');
      // The link's expiry (Decision 0009 Amendment 7): the runtime accepts no answer after
      // action_expires_at, and an answer accepted before it is in every later read. A read made
      // when the runtime clock was at least LINK_EXPIRY_GRACE_MS past the expiry, with no answer,
      // is final. The runtime clock is the response's HTTP Date (at or before the read), else
      // this machine's. Nothing is completed here.
      let untilFinalReadMs = Number.POSITIVE_INFINITY;
      const cutoff = linkExpiry(session);
      if (cutoff !== undefined) {
        const observedAt = current.meta.serverDate ?? Date.now();
        const finalAt = cutoff + LINK_EXPIRY_GRACE_MS;
        if (observedAt >= finalAt)
          throw ended(
            'LINK_EXPIRED',
            'The Sess link expired with no accepted response for this revision. Nothing was completed.',
          );
        // A Date header has whole seconds: one more second puts the next read past finalAt.
        untilFinalReadMs = finalAt - observedAt + (current.meta.serverDate === undefined ? 0 : 1000);
      }
      await delay(
        Math.min(
          intervalMs + Math.floor(Math.random() * 150),
          untilFinalReadMs,
          Math.max(1, Math.ceil(expires - performance.now())),
        ),
        budget.signal,
      );
    }
  } catch (error) {
    if (options.signal?.aborted)
      throw new SessError('aborted', 'Human wait was aborted. The Session remains available.', {
        sessionId: id,
        revision,
      });
    if (budget.signal.aborted || performance.now() >= expires)
      throw ended('WAIT_TIMEOUT', 'Human wait timed out. Resume using the same Session and revision.');
    throw error;
  } finally {
    budget.dispose();
  }
}
