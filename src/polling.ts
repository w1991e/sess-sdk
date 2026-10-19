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
 * Once a Session's link has reached its end (its deadline, `action_expires_at`, or while the
 * person can still extend it, its horizon), the wait reads it once more when the runtime clock is
 * this far past that end, then ends: an answer accepted before the end is returned; otherwise the
 * wait ends with `LINK_EXPIRED`. Two seconds covers the one-second
 * resolution of the HTTP `Date` header plus an answer accepted just before the expiry whose write
 * is still landing, and keeps the end prompt.
 */
export const LINK_EXPIRY_GRACE_MS = 2000;

/** An RFC 3339 UTC instant in milliseconds since the epoch, when the value is a valid one. */
function instant(value: unknown): number | undefined {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(value))
    return undefined;
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? ms : undefined;
}

/**
 * The link's state as read and the instant it ends for good as far as this read shows: its
 * horizon while the person can still extend it (an extension left), else its deadline
 * (`action_expires_at`). No state from a runtime before link timing (Decision 0009 Amendment 10).
 */
function linkEnd(session: InteractiveSession): { state: string | undefined; endsAt: number | undefined } {
  const v = session as {
    action_expires_at?: unknown;
    action_expires_horizon?: unknown;
    extensions_used?: unknown;
    link_state?: unknown;
  };
  const deadline = instant(v.action_expires_at);
  const horizon = instant(v.action_expires_horizon);
  const extendable = horizon !== undefined && typeof v.extensions_used === 'number' && v.extensions_used < 10;
  return {
    state: typeof v.link_state === 'string' ? v.link_state : undefined,
    endsAt: extendable && deadline !== undefined ? Math.max(horizon, deadline) : deadline,
  };
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
  /**
   * The first read in a row that showed the link expired with no answer at an instant the clocks
   * cannot place past its end: its runtime clock, that clock's resolution, and whether the clock
   * was the runtime's (HTTP Date) or this machine's. Such a read is final only once a later one,
   * at least LINK_EXPIRY_GRACE_MS (plus the resolution) after it on the same clock, still shows it.
   */
  let expiredSince: { at: number; resolutionMs: number; server: boolean } | undefined;
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
      // The link's end (Decision 0009 Amendments 7 and 10): an answer accepted while the link
      // was live is in every later read. The runtime clock is the response's HTTP Date (at or
      // before the read), else this machine's. Nothing is completed here.
      // - live or lapsed: the Session is still open (a lapsed link takes no answer, but the
      //   person can still ask for more time until the horizon). The wait never ends on the
      //   link; it reads again soon after the link could end.
      // - expired: final once a read made at least LINK_EXPIRY_GRACE_MS past the link's end, or a
      //   read at least the grace after the first expired read on the same clock (an end the
      //   clocks cannot place, such as a revocation), still shows it expired with no answer. A
      //   short polling interval reads again sooner but never ends the wait inside the grace.
      // - no link_state (a runtime before link timing): the deadline is final, as before.
      let untilFinalReadMs = Number.POSITIVE_INFINITY;
      const link = linkEnd(session);
      const observedAt = current.meta.serverDate ?? Date.now();
      // A Date header has whole seconds: one more second puts the next read past the instant.
      const resolutionMs = current.meta.serverDate === undefined ? 0 : 1000;
      const server = current.meta.serverDate !== undefined;
      if (link.state !== 'expired' || (expiredSince !== undefined && expiredSince.server !== server))
        expiredSince = undefined;
      if (link.state === 'live' || link.state === 'lapsed') {
        if (link.endsAt !== undefined && link.endsAt + LINK_EXPIRY_GRACE_MS > observedAt)
          untilFinalReadMs = link.endsAt + LINK_EXPIRY_GRACE_MS - observedAt + resolutionMs;
      } else if (link.state === 'expired' || link.endsAt !== undefined) {
        const finalAt = (link.endsAt ?? observedAt) + LINK_EXPIRY_GRACE_MS;
        // Whole-second Date headers: a full grace plus one second between the two headers puts
        // more than the grace between the two reads.
        const graceSeenAt =
          expiredSince === undefined
            ? Number.POSITIVE_INFINITY
            : expiredSince.at + LINK_EXPIRY_GRACE_MS + expiredSince.resolutionMs;
        if (observedAt >= finalAt || observedAt >= graceSeenAt)
          throw ended(
            'LINK_EXPIRED',
            'The Sess link expired with no accepted response for this revision. Nothing was completed.',
          );
        untilFinalReadMs = finalAt - observedAt + resolutionMs;
        if (link.state === 'expired') {
          expiredSince ??= { at: observedAt, resolutionMs, server };
          const graceEndsAt = expiredSince.at + LINK_EXPIRY_GRACE_MS + expiredSince.resolutionMs;
          untilFinalReadMs = Math.min(untilFinalReadMs, Math.max(1, graceEndsAt - observedAt));
        }
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
