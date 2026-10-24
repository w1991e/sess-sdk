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
  | 'PLAN_LIMIT_REACHED'
  | 'CREATED_NOT_SAVED'
  | 'OUTCOME_UNKNOWN'
  | 'MUTATION_REJECTED'
  | 'RECOVERY_BLOCKED'
  | 'VERIFICATION_FAILED'
  | 'SESS_UNAVAILABLE'
  | 'SESS_PROTOCOL_ERROR'
  | 'STATE_STORE_ERROR'
  | 'STATE_STORE_FULL';

/**
 * A value over its length limit: a JSON pointer to it in the tool arguments (or, from Sess, in the
 * request body), the most it may have and what it has, in Unicode code points.
 */
export interface LengthDetail {
  field: string;
  limit: number;
  length: number;
}

/**
 * Sess's own sentences for a length error (`field` is a JSON pointer); the title (sess_ask's
 * question) has its own.
 */
export function lengthMessage(field: string, limit: number, length: number): string {
  if (field === '/interaction/title' || field === '/question')
    return `The title can be at most ${limit} characters. Keep it to a short heading, about 40.`;
  return `${field} is ${length} characters; the limit is ${limit}. Shorten it to at most ${limit} characters.`;
}

/** Sess's sentence for an enum ID with no option label, shown as its own label and too long. */
export function fallbackLabelMessage(field: string, limit: number, length: number): string {
  return `${field} is ${length} characters and has no option label, so it is shown as its label; the limit is ${limit}. Give it an option label of at most ${limit} characters, or shorten it.`;
}

export class AdapterError extends Error {
  readonly code: AdapterErrorCode;
  /** True when repeating the same call later may succeed without operator action. */
  readonly retryable: boolean;
  /** Set only for a value over its length limit: fix that value and call again. */
  readonly tooLong?: LengthDetail;
  constructor(code: AdapterErrorCode, message: string, retryable = false, tooLong?: LengthDetail) {
    super(message);
    this.name = 'AdapterError';
    this.code = code;
    this.retryable = retryable;
    if (tooLong) this.tooLong = tooLong;
  }
  /** `field`, `limit` and `length` appear beside the code only for a length error. */
  toJSON(): { code: AdapterErrorCode; message: string; retryable: boolean } & Partial<LengthDetail> {
    return {
      code: this.code,
      message: this.message,
      retryable: this.retryable,
      ...(this.tooLong ? { ...this.tooLong } : {}),
    };
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
