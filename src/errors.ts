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
    };
  }

  [inspect.custom](): object {
    return this.toJSON();
  }
}

/** Internal: keep private creation capabilities out of inspection and serialization. */
export function attachRecovery(error: SessError, value: CreateSessionResponse): void {
  recovery.set(error, Object.freeze({ ...value }));
}
