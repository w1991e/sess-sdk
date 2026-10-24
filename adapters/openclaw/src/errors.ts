/**
 * Adapter failures surface through the host's tool-error contract (a thrown Error). Messages are
 * fixed, safe text: they never include human URLs, API keys, response bodies or stored paths.
 */
export type AdapterErrorCode =
  | 'INVALID_ARGUMENTS'
  | 'CONFIGURATION'
  | 'CREDENTIAL_MISSING'
  | 'HOST_CAPABILITY_MISSING'
  | 'HOST_BINDING_UNAVAILABLE'
  | 'AUTHORITY_REVOKED'
  | 'NOT_FOUND'
  | 'STATE_CONFLICT'
  | 'STORE_FULL'
  | 'STORE_UNAVAILABLE'
  | 'RECOVERY_BLOCKED'
  | 'CREATE_REJECTED'
  | 'PLAN_LIMIT_REACHED'
  | 'CREATE_OUTCOME_UNKNOWN'
  | 'CREATED_NOT_SAVED'
  | 'MUTATION_OUTCOME_UNKNOWN'
  | 'MUTATION_REJECTED'
  | 'VERIFICATION_FAILED'
  | 'CANCELLED'
  | 'PROTOCOL_ERROR'
  | 'UNAVAILABLE';

/** Contract error classes (adapters/CONTRACT.md, "Error classes"). */
export type ErrorClass =
  | 'invalid_arguments'
  | 'not_found'
  | 'conflict'
  | 'create_rejected'
  | 'create_unknown'
  | 'created_not_saved'
  | 'outcome_unknown'
  | 'mutation_rejected'
  | 'verification_failed'
  | 'blocked'
  | 'unavailable'
  | 'configuration'
  | 'store';

/** Every adapter code maps to exactly one contract class; README documents this table (tested). */
export const ERROR_CLASSES: Readonly<Record<AdapterErrorCode, ErrorClass>> = Object.freeze({
  INVALID_ARGUMENTS: 'invalid_arguments',
  NOT_FOUND: 'not_found',
  STATE_CONFLICT: 'conflict',
  CREATE_REJECTED: 'create_rejected',
  PLAN_LIMIT_REACHED: 'create_rejected',
  CREATE_OUTCOME_UNKNOWN: 'create_unknown',
  CREATED_NOT_SAVED: 'created_not_saved',
  MUTATION_OUTCOME_UNKNOWN: 'outcome_unknown',
  MUTATION_REJECTED: 'mutation_rejected',
  VERIFICATION_FAILED: 'verification_failed',
  RECOVERY_BLOCKED: 'blocked',
  UNAVAILABLE: 'unavailable',
  CANCELLED: 'unavailable',
  AUTHORITY_REVOKED: 'unavailable',
  CONFIGURATION: 'configuration',
  // Non-retryable with no state change; the contract has no dedicated protocol class.
  PROTOCOL_ERROR: 'configuration',
  CREDENTIAL_MISSING: 'configuration',
  HOST_CAPABILITY_MISSING: 'configuration',
  HOST_BINDING_UNAVAILABLE: 'configuration',
  STORE_FULL: 'store',
  STORE_UNAVAILABLE: 'store',
});

/**
 * A value over its length limit: a JSON pointer to it in the tool arguments, the most it may
 * have and what it has, in Unicode code points.
 */
export interface LengthDetail {
  field: string;
  limit: number;
  length: number;
}

export class SessAdapterError extends Error {
  readonly code: AdapterErrorCode;
  readonly errorClass: ErrorClass;
  /** Set only for a length error: shorten the value at `field` to at most `limit` and call again. */
  readonly field?: string;
  readonly limit?: number;
  readonly length?: number;
  constructor(code: AdapterErrorCode, message: string, tooLong?: LengthDetail) {
    super(`${code}: ${message}`);
    this.name = 'SessAdapterError';
    this.code = code;
    this.errorClass = ERROR_CLASSES[code];
    if (tooLong) Object.assign(this, tooLong);
  }
  toJSON(): object {
    const { field, limit, length } = this;
    return {
      name: this.name,
      code: this.code,
      errorClass: this.errorClass,
      message: this.message,
      ...(field !== undefined ? { field, limit, length } : {}),
    };
  }
}

export function fail(code: AdapterErrorCode, message: string): never {
  throw new SessAdapterError(code, message);
}

/** Sess's own sentences for a length error (`field` is a JSON pointer); the title has its own. */
export function lengthMessage(field: string, limit: number, length: number): string {
  if (field === '/interaction/title')
    return `The title can be at most ${limit} characters. Keep it to a short heading, about 40.`;
  return `${field} is ${length} characters; the limit is ${limit}. Shorten it to at most ${limit} characters.`;
}

/** Sess's sentence for an enum ID with no option label, shown as its own label and too long. */
export function fallbackLabelMessage(field: string, limit: number, length: number): string {
  return `${field} is ${length} characters and has no option label, so it is shown as its label; the limit is ${limit}. Give it an option label of at most ${limit} characters, or shorten it.`;
}

/** A value over its length limit: field, limit, its length and the one-line fix. */
export function failTooLong(
  field: string,
  limit: number,
  length: number,
  message: (field: string, limit: number, length: number) => string = lengthMessage,
): never {
  throw new SessAdapterError('INVALID_ARGUMENTS', message(field, limit, length), {
    field,
    limit,
    length,
  });
}
