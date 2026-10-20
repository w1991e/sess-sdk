/**
 * Adapter errors are reported to the MCP client as tool execution errors (`isError: true`) with a
 * stable code and a fixed, secret-free message. They never carry SESS response bodies, request
 * secrets, human URLs or local storage paths.
 */
export type AdapterErrorCode =
  | 'INVALID_ARGUMENTS'
  | 'NOT_CONFIGURED'
  | 'HANDLE_NOT_FOUND'
  | 'BINDING_MISMATCH'
  | 'REVISION_MISMATCH'
  | 'RESPONSE_MISMATCH'
  | 'INVALID_STATE'
  | 'PENDING_MUTATION_DIFFERS'
  | 'MUTATION_PENDING'
  | 'CREATE_OUTCOME_UNKNOWN'
  | 'CREATE_REJECTED'
  | 'CREATED_NOT_SAVED'
  | 'OUTCOME_UNKNOWN'
  | 'MUTATION_REJECTED'
  | 'RECOVERY_BLOCKED'
  | 'VERIFICATION_FAILED'
  | 'SESS_UNAVAILABLE'
  | 'SESS_PROTOCOL_ERROR'
  | 'STATE_STORE_ERROR'
  | 'STATE_STORE_FULL'
  /** Trial mode (no SESS_API_KEY): the operation needs an API key. Nothing was sent. */
  | 'TRIAL_UNSUPPORTED'
  /** Trial mode: Sess refused a create for a named trial limit. Nothing was created. */
  | 'TRIAL_LIMIT'
  /** Trial mode: the saved trial no longer exists on Sess. Nothing was created; no new trial is started. */
  | 'TRIAL_ENDED'
  /** Trial mode: this Sess API has no trial. Nothing was created. */
  | 'TRIAL_UNAVAILABLE';

export class AdapterError extends Error {
  readonly code: AdapterErrorCode;
  /** True when repeating the same call later may succeed without operator action. */
  readonly retryable: boolean;
  constructor(code: AdapterErrorCode, message: string, retryable = false) {
    super(message);
    this.name = 'AdapterError';
    this.code = code;
    this.retryable = retryable;
  }
  toJSON(): { code: AdapterErrorCode; message: string; retryable: boolean } {
    return { code: this.code, message: this.message, retryable: this.retryable };
  }
}

/**
 * Removes the configured secrets and any capability-shaped material from text before it can reach
 * stderr. Human URLs are bearer capabilities; the owner key is a credential.
 */
export function redact(text: string, secrets: readonly string[] = []): string {
  let out = text;
  for (const secret of [...secrets].filter((s) => s && s.length >= 8).sort((a, b) => b.length - a.length)) {
    out = out.split(secret).join('[redacted]');
  }
  return out
    .replace(/https?:\/\/[^\s"'<>]+/gi, '[url]')
    .replace(/\/s\/[^\s"'<>?#]*/g, '[capability-path]')
    .replace(/(?<![A-Za-z0-9_-])[A-Za-z0-9_-]{43}(?![A-Za-z0-9_-])/g, '[token]')
    .replace(/sess_(?:sk|mg|tk|mk)_[A-Za-z0-9_-]+/g, '[key]')
    .replace(/Bearer\s+[^\s"']+/gi, 'Bearer [redacted]');
}

export type Diagnostics = (event: string, fields?: Record<string, string | number | boolean>) => void;

/**
 * Line-oriented stderr diagnostics. Only fixed event names and primitive, already-safe fields are
 * accepted; every line is still passed through redact() with the known secrets. stdout belongs to
 * the MCP protocol and is never written here.
 */
export function stderrDiagnostics(
  write: (line: string) => void,
  secrets: () => readonly string[],
): Diagnostics {
  return (event, fields = {}) => {
    const parts = [`sess-mcp: ${event}`];
    for (const [key, value] of Object.entries(fields)) parts.push(`${key}=${String(value)}`);
    try {
      write(`${redact(parts.join(' '), secrets())}\n`);
    } catch {
      // Diagnostics never affect protocol behavior.
    }
  };
}
