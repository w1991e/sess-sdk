import { SessError } from './errors.js';
import { abortError, boundedNumber, deadline, delay } from './internal/time.js';
import { isInteractiveSession } from './types.js';
import type { RequestOptions, Session, VersionedResult, WaitOptions, WaitResult } from './types.js';

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
      await delay(
        Math.min(
          intervalMs + Math.floor(Math.random() * 150),
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
