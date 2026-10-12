import { Webhook } from 'standardwebhooks';
import { SessError } from '../errors.js';
import type { components } from '../generated/openapi.js';
import {
  checkedInstant,
  deepFreeze,
  exactKeys,
  isRecord,
  snapshotJson,
  wellFormedUnicode,
  type DeepReadonly,
} from '../receipts/json.js';

export type WebhookEvent = components['schemas']['WebhookDelivery'];
export type WebhookChallenge = components['schemas']['WebhookVerification'];
export type VerifiedWebhook = DeepReadonly<WebhookEvent | WebhookChallenge>;
export type WebhookHeaders = Headers | Readonly<Record<string, string | readonly string[] | undefined>>;

export interface VerifyWebhookOptions {
  /** Workspace-specific secrets from registration/rotation; store outside source control. */
  secret?: string;
  /** During rotation, either trusted secret can authenticate the overlapping signatures. */
  secrets?: readonly string[];
  /** 0–300 seconds; the maintained Standard Webhooks verifier sets the outer 300-second bound. */
  toleranceSeconds?: number;
  /** Defaults to 1 MiB; can be tightened, never increased beyond 1 MiB. */
  maxBodyBytes?: number;
}

const MAX_BODY_BYTES = 1024 * 1024;
const MAX_HEADER_BYTES = 8192;
const MAX_SIGNATURES = 8;
const MAX_SECRETS = 4;
const SECRET = /^whsec_[A-Za-z0-9+/]{43}=$/;
const EVENT_ID = /^evt_[0-9A-HJKMNP-TV-Z]{26}$/;
const SESSION_ID = /^ses_[0-9A-HJKMNP-TV-Z]{26}$/;

function failure(code: string, message: string): SessError {
  return new SessError('protocol', message, { code, operation: 'webhooks.verify' });
}

function headersOf(headers: WebhookHeaders): Record<string, string> {
  const wanted = new Set(['webhook-id', 'webhook-timestamp', 'webhook-signature']);
  const result: Record<string, string> = {};
  const seen = new Set<string>();
  let bytes = 0;
  const entries: Iterable<[string, unknown]> =
    headers instanceof Headers ? headers.entries() : Object.entries(headers);
  for (const [rawName, value] of entries) {
    const name = rawName.toLowerCase();
    if (!wanted.has(name)) continue; // sess-webhook-key-ids never grants authorization.
    if (seen.has(name) || typeof value !== 'string' || /[\u0000-\u001f\u007f]/.test(value)) {
      throw failure('WEBHOOK_INVALID_HEADERS', 'Webhook authentication headers are duplicated or malformed.');
    }
    seen.add(name);
    bytes += Buffer.byteLength(name) + Buffer.byteLength(value);
    if (bytes > MAX_HEADER_BYTES)
      throw failure('WEBHOOK_INVALID_HEADERS', 'Webhook authentication headers exceed the safety limit.');
    result[name] = value;
  }
  const id = result['webhook-id'];
  const timestamp = result['webhook-timestamp'];
  const signatures = result['webhook-signature'];
  if (
    !id ||
    !/^[A-Za-z0-9._-]{1,128}$/.test(id) ||
    !timestamp ||
    !/^(?:0|[1-9][0-9]{0,11})$/.test(timestamp) ||
    !signatures ||
    signatures.length > 2048
  ) {
    throw failure('WEBHOOK_INVALID_HEADERS', 'Webhook authentication headers are missing or malformed.');
  }
  const candidates = signatures.split(' ');
  if (
    candidates.length > MAX_SIGNATURES ||
    candidates.some((candidate) => !/^v[1-9][0-9]*,[A-Za-z0-9+/]{43}=$/.test(candidate))
  ) {
    throw failure(
      'WEBHOOK_INVALID_HEADERS',
      'Webhook signatures must use bounded, space-separated versioned signatures.',
    );
  }
  // Headers combines repeated lines with a comma; exact grammar above rejects that form.
  return result;
}

/**
 * Authenticates exact raw UTF-8 bytes before parsing JSON. This is transport authentication,
 * not decision-receipt verification or authorization to perform application business work.
 */
export function verifyWebhook(
  rawBody: Uint8Array | string,
  headers: WebhookHeaders,
  options: VerifyWebhookOptions,
): VerifiedWebhook {
  if (!options || !headers)
    throw new SessError('configuration', 'Webhook verification requires headers and trusted-secret options.');
  const tolerance = options?.toleranceSeconds ?? 300;
  const maxBytes = options?.maxBodyBytes ?? MAX_BODY_BYTES;
  if (
    !Number.isFinite(tolerance) ||
    tolerance < 0 ||
    tolerance > 300 ||
    !Number.isSafeInteger(maxBytes) ||
    maxBytes < 1 ||
    maxBytes > MAX_BODY_BYTES
  ) {
    throw new SessError(
      'configuration',
      'Webhook tolerance must be 0–300 seconds and its byte limit 1–1048576.',
    );
  }
  if ((options.secret === undefined) === (options.secrets === undefined)) {
    throw new SessError(
      'configuration',
      'Provide exactly one webhook secret or a trusted rotation secret list.',
    );
  }
  const secrets = options.secrets === undefined ? [options.secret] : [...options.secrets];
  if (
    secrets.length === 0 ||
    secrets.length > MAX_SECRETS ||
    secrets.some(
      (secret) =>
        typeof secret !== 'string' ||
        !SECRET.test(secret) ||
        Buffer.from(secret.slice(6), 'base64').length !== 32 ||
        Buffer.from(secret.slice(6), 'base64').toString('base64') !== secret.slice(6),
    )
  ) {
    throw new SessError('configuration', 'Use the workspace webhook signing secret returned by SESS.');
  }
  let bytes: Buffer;
  if (typeof rawBody === 'string') {
    if (!wellFormedUnicode(rawBody))
      throw failure('WEBHOOK_INVALID_ENCODING', 'Webhook bodies must be exact well-formed UTF-8.');
    if (Buffer.byteLength(rawBody, 'utf8') > maxBytes)
      throw failure('WEBHOOK_BODY_TOO_LARGE', 'Webhook body exceeds the configured byte limit.');
    bytes = Buffer.from(rawBody, 'utf8');
  } else if (rawBody instanceof Uint8Array) {
    if (rawBody.byteLength > maxBytes)
      throw failure('WEBHOOK_BODY_TOO_LARGE', 'Webhook body exceeds the configured byte limit.');
    bytes = Buffer.from(rawBody);
  } else {
    throw failure('WEBHOOK_RAW_BODY_REQUIRED', 'Provide the original request bytes before JSON parsing.');
  }
  let body: string;
  try {
    body = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes);
  } catch {
    throw failure('WEBHOOK_INVALID_ENCODING', 'Webhook bodies must contain valid UTF-8 bytes.');
  }
  // Standard Webhooks accepts strings/Buffers and internally decodes text. This round trip
  // guarantees that decoding cannot replace malformed bytes before signature verification.
  if (!Buffer.from(body, 'utf8').equals(bytes))
    throw failure('WEBHOOK_INVALID_ENCODING', 'Webhook UTF-8 decoding changed its signed bytes.');
  const verifiedHeaders = headersOf(headers);
  const timestamp = Number(verifiedHeaders['webhook-timestamp']);
  if (Math.abs(Math.floor(Date.now() / 1000) - timestamp) > tolerance) {
    throw failure(
      'WEBHOOK_TIMESTAMP_OUT_OF_RANGE',
      'Webhook timestamp is outside the configured replay tolerance.',
    );
  }
  let authenticated = false;
  for (const secret of secrets) {
    try {
      new Webhook(secret as string).verify(bytes, verifiedHeaders, { jsonParse: false });
      authenticated = true;
      break;
    } catch {
      // Neither dependency error messages nor secret/signature material reaches callers.
    }
  }
  if (!authenticated)
    throw failure(
      'WEBHOOK_INVALID_SIGNATURE',
      'Webhook authentication failed for the trusted workspace secrets.',
    );
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    throw failure('WEBHOOK_INVALID_PAYLOAD', 'The authenticated webhook body is not JSON.');
  }
  let value: unknown;
  try {
    value = snapshotJson(parsed);
  } catch {
    throw failure('WEBHOOK_INVALID_PAYLOAD', 'The authenticated webhook body is not supported JSON.');
  }
  if (!isRecord(value))
    throw failure('WEBHOOK_INVALID_PAYLOAD', 'The authenticated webhook payload must be an object.');
  const id = verifiedHeaders['webhook-id'];
  if (value.type === 'sess.webhook.verification') {
    if (
      !exactKeys(value, ['type', 'challenge']) ||
      typeof value.challenge !== 'string' ||
      Buffer.byteLength(value.challenge, 'utf8') > 1024
    ) {
      throw failure(
        'WEBHOOK_INVALID_CHALLENGE',
        'The webhook challenge is malformed or exceeds its safety limit.',
      );
    }
    return deepFreeze(value) as DeepReadonly<WebhookChallenge>;
  }
  if (
    value.type !== 'response.accepted' ||
    !exactKeys(value, [
      'type',
      'event_id',
      'session_id',
      'sequence',
      'revision',
      'action_id',
      'data',
      'accepted_at',
      'receipt',
    ]) ||
    typeof value.event_id !== 'string' ||
    !EVENT_ID.test(value.event_id) ||
    value.event_id !== id ||
    typeof value.session_id !== 'string' ||
    !SESSION_ID.test(value.session_id) ||
    !Number.isSafeInteger(value.sequence) ||
    (value.sequence as number) < 1 ||
    !Number.isSafeInteger(value.revision) ||
    (value.revision as number) < 1 ||
    typeof value.action_id !== 'string' ||
    !/^[a-z][a-z0-9_]{0,31}$/.test(value.action_id) ||
    !isRecord(value.data) ||
    checkedInstant(value.accepted_at) === undefined ||
    (value.receipt !== null &&
      (typeof value.receipt !== 'string' ||
        value.receipt.length > 64 * 1024 ||
        !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(value.receipt)))
  ) {
    throw failure(
      'WEBHOOK_INVALID_PAYLOAD',
      'The accepted webhook event is malformed or does not match its transport identity.',
    );
  }
  return deepFreeze(value) as unknown as DeepReadonly<WebhookEvent>;
}
