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

/**
 * Stable error fields; messages never include response bodies or request secrets. An optional
 * field is an own property only when it has a value, so printing an error lists no empty fields.
 */
export class SessError extends Error {
  readonly kind: SessErrorKind;
  // `declare`: no class-field initializer, so an absent detail is absent, not an own `undefined`.
  declare readonly code?: string;
  declare readonly reason?: string;
  declare readonly status?: number;
  declare readonly requestId?: string;
  declare readonly operation?: string;
  declare readonly attempts?: number;
  declare readonly outcome?: WriteOutcome;
  declare readonly idempotencyKey?: string;
  declare readonly retryAfterMs?: number;
  declare readonly sessionId?: string;
  declare readonly revision?: number;
  /**
   * Set only when a value is too long (a 400 INVALID_SCHEMA from Sess, or INVALID_QUESTION from
   * `ask`): a JSON pointer to it, e.g. `/interaction/title`. Nothing is ever truncated: shorten
   * the value to at most `limit` characters and send again.
   */
  declare readonly field?: string;
  /** With `field`: the most the value may have, in Unicode code points (e.g. title 80). */
  declare readonly limit?: number;
  /** With `field`: the value's actual length, in Unicode code points. */
  declare readonly length?: number;

  constructor(kind: SessErrorKind, message: string, details: SessErrorDetails = {}) {
    super(message);
    this.name = 'SessError';
    this.kind = kind;
    for (const [name, value] of Object.entries(details))
      if (value !== undefined) Object.assign(this, { [name]: value });
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
    const fields: Record<string, unknown> = {
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
    return Object.fromEntries(Object.entries(fields).filter(([, value]) => value !== undefined));
  }

  /** `util.inspect` and `console.log`: the same fields as JSON, without the absent ones. */
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
