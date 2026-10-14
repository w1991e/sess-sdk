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
  | 'RECOVERY_BLOCKED'
  | 'CREATE_OUTCOME_UNKNOWN'
  | 'MUTATION_OUTCOME_UNKNOWN'
  | 'REJECTED'
  | 'VERIFICATION_FAILED'
  | 'WAIT_ENDED'
  | 'CANCELLED'
  | 'UNAVAILABLE';

export class SessAdapterError extends Error {
  readonly code: AdapterErrorCode;
  constructor(code: AdapterErrorCode, message: string) {
    super(`${code}: ${message}`);
    this.name = 'SessAdapterError';
    this.code = code;
  }
  toJSON(): object {
    return { name: this.name, code: this.code, message: this.message };
  }
}

export function fail(code: AdapterErrorCode, message: string): never {
  throw new SessAdapterError(code, message);
}
