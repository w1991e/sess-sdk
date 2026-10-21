import { inspect } from 'node:util';
import type { CreateSessionResponse } from './types.js';

export type SessErrorKind =
  | 'configuration'
  | 'api'
  | 'transport'
  | 'timeout'
  | 'aborted'
  | 'protocol'
  | 'unknown_outcome'
  | 'receipt_verification'
  | 'wait_ended';
export type WriteOutcome = 'not_sent' | 'rejected' | 'unknown';
export interface SessErrorDetails {
  code?: string;
  reason?: string;
  status?: number;
  requestId?: string;
  operation?: string;
  attempts?: number;
  outcome?: WriteOutcome;
  idempotencyKey?: string;
  retryAfterMs?: number;
  sessionId?: string;
  revision?: number;
  /** With a length error: a JSON pointer to the value that is too long, e.g. `/interaction/title`. */
  field?: string;
  /** With a length error: the most the value may have, in Unicode code points. */
  limit?: number;
  /** With a length error: the value's actual length, in Unicode code points. */
  length?: number;
}
const recovery = new WeakMap<SessError, Readonly<CreateSessionResponse>>();

/** Stable error fields; messages never include response bodies or request secrets. */
export class SessError extends Error {
  readonly kind: SessErrorKind;
  readonly code?: string;
  readonly reason?: string;
  readonly status?: number;
  readonly requestId?: string;
  readonly operation?: string;
  readonly attempts?: number;
  readonly outcome?: WriteOutcome;
  readonly idempotencyKey?: string;
  readonly retryAfterMs?: number;
  readonly sessionId?: string;
  readonly revision?: number;
  /**
   * Set only when a value is too long (a 400 INVALID_SCHEMA from Sess, or INVALID_QUESTION from
   * `ask`): a JSON pointer to it, e.g. `/interaction/title`. Nothing is ever truncated: shorten
   * the value to at most `limit` characters and send again.
   */
  readonly field?: string;
  /** With `field`: the most the value may have, in Unicode code points (e.g. title 80). */
  readonly limit?: number;
  /** With `field`: the value's actual length, in Unicode code points. */
  readonly length?: number;

  constructor(kind: SessErrorKind, message: string, details: SessErrorDetails = {}) {
    super(message);
    this.name = 'SessError';
    this.kind = kind;
    Object.assign(this, details);
  }

  /** Explicit access only. A usable create body may accompany a defective header. */
  getRecoveryResult(): Readonly<CreateSessionResponse> | undefined {
    return recovery.get(this);
  }

  toJSON(): object {
    const {
      name,
      kind,
      message,
      code,
      reason,
      status,
      requestId,
      operation,
      attempts,
      outcome,
      idempotencyKey,
      retryAfterMs,
      field,
      limit,
      length,
    } = this;
    return {
      name,
      kind,
      message,
      code,
      reason,
      status,
      requestId,
      operation,
      attempts,
      outcome,
      idempotencyKey,
      retryAfterMs,
      field,
      limit,
      length,
    };
  }

  [inspect.custom](): object {
    return this.toJSON();
  }
}

/** Internal: the one-line fix every length error carries (field, limit, actual length, fix). */
export function lengthMessage(field: string, limit: number, length: number): string {
  // The same sentences as Sess's 400 INVALID_SCHEMA (`field` is a JSON pointer); the title (the
  // `sess.ask()` question) has its own.
  if (field === '/interaction/title' || field === '/question')
    return `The title can be at most ${limit} characters. Keep it to a short heading, about 40.`;
  return `${field} is ${length} characters; the limit is ${limit}. Shorten it to at most ${limit} characters.`;
}

/** Internal: keep private creation capabilities out of inspection and serialization. */
export function attachRecovery(error: SessError, value: CreateSessionResponse): void {
  recovery.set(error, Object.freeze({ ...value }));
}
