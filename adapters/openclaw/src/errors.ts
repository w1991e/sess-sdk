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
  | 'CREATE_OUTCOME_UNKNOWN'
  | 'CREATED_NOT_SAVED'
  | 'MUTATION_OUTCOME_UNKNOWN'
  | 'MUTATION_REJECTED'
  | 'VERIFICATION_FAILED'
  | 'CANCELLED'
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
  CREDENTIAL_MISSING: 'configuration',
  HOST_CAPABILITY_MISSING: 'configuration',
  HOST_BINDING_UNAVAILABLE: 'configuration',
  STORE_FULL: 'store',
  STORE_UNAVAILABLE: 'store',
});

export class SessAdapterError extends Error {
  readonly code: AdapterErrorCode;
  readonly errorClass: ErrorClass;
  constructor(code: AdapterErrorCode, message: string) {
    super(`${code}: ${message}`);
    this.name = 'SessAdapterError';
    this.code = code;
    this.errorClass = ERROR_CLASSES[code];
  }
  toJSON(): object {
    return { name: this.name, code: this.code, errorClass: this.errorClass, message: this.message };
  }
}

export function fail(code: AdapterErrorCode, message: string): never {
  throw new SessAdapterError(code, message);
}
