/**
 * Adapter errors are reported to the MCP client as tool execution errors (`isError: true`) with a
 * stable code and a fixed, secret-free message. They never carry SESS response bodies, request
 * secrets, human URLs or local storage paths.
 */
export const ADAPTER_ERROR_CODES = [
  'INVALID_ARGUMENTS',
  'NOT_CONFIGURED',
  'HANDLE_NOT_FOUND',
  'BINDING_MISMATCH',
  'REVISION_MISMATCH',
  'RESPONSE_MISMATCH',
  'INVALID_STATE',
  'PENDING_MUTATION_DIFFERS',
  'MUTATION_PENDING',
  'CREATE_OUTCOME_UNKNOWN',
  'CREATE_REJECTED',
  'PLAN_LIMIT_REACHED',
  'CREATED_NOT_SAVED',
  'OUTCOME_UNKNOWN',
  'MUTATION_REJECTED',
  'RECOVERY_BLOCKED',
  'VERIFICATION_FAILED',
  'SESS_UNAVAILABLE',
  'SESS_PROTOCOL_ERROR',
  'STATE_STORE_ERROR',
  'STATE_STORE_FULL',
] as const;
export type AdapterErrorCode = (typeof ADAPTER_ERROR_CODES)[number];

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
 * Removes the configured secrets and any capability-shaped material from free text before it can
 * reach stderr. Human URLs are bearer capabilities; the owner key is a credential. Fail closed:
 * every run of 22 or more base64url characters is withheld, whatever its letter case, because a
 * short-link token is 22 such characters (128 bits) and a /s/ token 43, and either may arrive glued
 * to other token characters. Known codes and event names are kept only as structured diagnostic
 * values (stderrDiagnostics), never for their shape in free text.
 */
export function redact(text: string, secrets: readonly string[] = []): string {
  let out = text;
  for (const secret of [...secrets].filter((s) => s && s.length >= 8).sort((a, b) => b.length - a.length)) {
    out = out.split(secret).join('[redacted]');
  }
  return out
    .replace(/https?:\/\/[^\s"'<>]+/gi, '[url]')
    .replace(/\/[sn]\/[^\s"'<>?#]*/g, '[capability-path]')
    .replace(/sess_(?:sk|mg|tk|mk)_[A-Za-z0-9_-]+/g, '[key]')
    .replace(/Bearer\s+[^\s"']+/gi, 'Bearer [redacted]')
    .replace(/[A-Za-z0-9_-]{22,}/g, '[token]');
}

/**
 * Every diagnostic event name. The Diagnostics type admits only these, so this list is the source
 * of the names; stderrDiagnostics prints a listed name as it is and redacts anything else.
 */
export const DIAGNOSTIC_EVENTS = [
  'configured',
  'create_rejected',
  'create_recovered',
  'create_unknown',
  'created',
  'verification_deferred',
  'verification_not_configured',
  'verification_failed',
  'answered',
  'currentness_read_failed',
  'answer_superseded',
  'expired',
  'block_skipped_stale',
  'blocked',
  'publish_failed',
  'complete_failed',
  'complete_readback_failed',
  'completed',
  'published',
  'tool_error',
  'tool_internal_error',
  'http_protocol_rejected',
  'http_rejected',
  'http_auth_error',
  'http_principal_invalid',
  'http_internal_error',
] as const;
export type DiagnosticEvent = (typeof DIAGNOSTIC_EVENTS)[number];

/** The SDK's error kinds (SessErrorKind in @sess.si/sdk): the prefix of a `kind/CODE` value. */
export const SESS_ERROR_KINDS = [
  'configuration',
  'api',
  'transport',
  'timeout',
  'aborted',
  'protocol',
  'unknown_outcome',
  'receipt_verification',
  'wait_ended',
] as const;

/**
 * Sess error codes: the API's Error code enum (contract/openapi.json, components.schemas.Error)
 * and the codes the SDK raises itself (`code: '...'` in the SDK's src/). tests/config.test.ts keeps
 * this list in step with both sources in this repository.
 */
export const SESS_ERROR_CODES = [
  'ACTION_NOT_ALLOWED',
  'ACTION_NOT_FOUND',
  'CREDENTIAL_PROVIDER_FAILED',
  'CUSTODY_HOLD_ACTIVE',
  'EVIDENCE_DELETED',
  'EVIDENCE_RESTRICTED',
  'HOLDER_ENROLLMENT_REFUSED',
  'IDEMPOTENCY_CONFLICT',
  'INTERNAL',
  'INVALID_API_KEY',
  'INVALID_ETAG',
  'INVALID_IF_MATCH',
  'INVALID_JSON',
  'INVALID_QUESTION',
  'INVALID_RESPONSE',
  'INVALID_SCHEMA',
  'INVALID_WORKSPACE_CONTEXT',
  'INVOCATION_TERMINAL',
  'NOT_FOUND',
  'PAYLOAD_TOO_LARGE',
  'PLAN_LIMIT_REACHED',
  'PRECONDITION_REQUIRED',
  'RATE_LIMITED',
  'RECORD_BINDING_MISMATCH',
  'REDIRECT_REFUSED',
  'RESPONSE_LIMIT_REACHED',
  'RESPONSE_TOO_LARGE',
  'SERVICE_UNAVAILABLE',
  'SESSION_COMPLETED',
  'SESSION_NOT_FOUND',
  'SESSION_REVISION_CONFLICT',
  'SIGN_IN_UNAVAILABLE',
  'SUBSCRIPTION_EXISTS',
  'TARGET_INVALID_CAPABILITY',
  'TARGET_INVALID_URL',
  'TARGET_NAME_TAKEN',
  'TARGET_VERIFICATION_FAILED',
  'TARGET_VERSION_CONFLICT',
  'TRIAL_UNAVAILABLE',
  'UNAUTHORIZED',
  'UNKNOWN_COMPONENT',
  'VALIDATION_FAILED',
  'WEBHOOK_INVALID_URL',
  'WEBHOOK_NOT_CONFIGURED',
  'WEBHOOK_VERIFICATION_FAILED',
] as const;

/** The adapter's own reasons for blocking a handle (operations.ts #block), besides Sess codes. */
export const BLOCK_REASONS = [
  'NOT_INTERACTIVE',
  'CLOSED_WITHOUT_RESPONSE',
  'REVISION_SUPERSEDED',
  'WAIT_ENDED',
  'UNEXPECTED_PROGRESS',
  'LINK_EXPIRED',
  'COMPLETE_NOT_CONFIRMED',
  'PUBLISH_NOT_CONFIRMED',
  'SDK_CONFIGURATION',
  'UNEXPECTED',
] as const;

const KNOWN_EVENTS: ReadonlySet<string> = new Set(DIAGNOSTIC_EVENTS);
const KNOWN_KINDS: ReadonlySet<string> = new Set(SESS_ERROR_KINDS);
const KNOWN_CODES: ReadonlySet<string> = new Set([
  ...ADAPTER_ERROR_CODES,
  ...SESS_ERROR_CODES,
  ...BLOCK_REASONS,
]);

/**
 * A structured diagnostic value that is exactly a known code: an adapter or Sess code, a block
 * reason, or `kind/CODE` (sessCode in operations.ts) from a known kind and a known code. Exact
 * matches against the lists above only; nothing is kept for its shape.
 */
export function isKnownCode(value: string): boolean {
  if (KNOWN_CODES.has(value)) return true;
  const slash = value.indexOf('/');
  return slash > 0 && KNOWN_KINDS.has(value.slice(0, slash)) && KNOWN_CODES.has(value.slice(slash + 1));
}

export type Diagnostics = (
  event: DiagnosticEvent,
  fields?: Record<string, string | number | boolean>,
) => void;

/**
 * Line-oriented stderr diagnostics. Only fixed event names and primitive, already-safe fields are
 * accepted. A listed event name, and a string field value that is exactly a known code, are printed
 * as they are; every other part still passes through redact() with the known secrets. stdout
 * belongs to the MCP protocol and is never written here.
 */
export function stderrDiagnostics(
  write: (line: string) => void,
  secrets: () => readonly string[],
): Diagnostics {
  return (event, fields = {}) => {
    try {
      const known = secrets();
      const parts = [`sess-mcp: ${KNOWN_EVENTS.has(event) ? event : redact(String(event), known)}`];
      for (const [key, value] of Object.entries(fields)) {
        parts.push(
          typeof value === 'string' && isKnownCode(value)
            ? `${redact(key, known)}=${value}`
            : redact(`${key}=${String(value)}`, known),
        );
      }
      write(`${parts.join(' ')}\n`);
    } catch {
      // Diagnostics never affect protocol behavior.
    }
  };
}
