import { SessError } from '../errors.js';
import type {
  AcceptedResponse,
  CreateSessionResponse,
  Deliveries,
  InteractiveSession,
  Session,
  SessionEvents,
  SurfaceRevision,
  WebhookRegisterResponse,
  WebhookResponse,
  WebhookRotateResponse,
} from '../types.js';

export const ulid = '[0-9A-HJKMNP-TV-Z]{26}';
export const sessionPattern = new RegExp(`^ses_${ulid}$`);
const eventPattern = new RegExp(`^evt_${ulid}$`);
const actionPattern = /^[a-z][a-z0-9_]{0,31}$/;
const receiptPattern = /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/;
export function protocol(): never {
  throw new SessError('protocol', 'Response does not match the supported SESS contract.', {
    code: 'INVALID_RESPONSE',
  });
}
export function object(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) protocol();
  return value as Record<string, unknown>;
}
export function string(value: unknown, pattern?: RegExp, max = 4096): string {
  if (typeof value !== 'string' || !value.length || value.length > max || (pattern && !pattern.test(value)))
    protocol();
  return value;
}
export function integer(value: unknown, minimum = 1): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < minimum) protocol();
  return value;
}
function date(value: unknown): void {
  const text = string(value, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/, 32);
  if (!Number.isFinite(Date.parse(text))) protocol();
}
function nullableDate(value: unknown): void {
  if (value !== null) date(value);
}
function array(value: unknown): unknown[] {
  if (!Array.isArray(value)) protocol();
  return value;
}
function oneOf(value: unknown, values: readonly string[]): void {
  if (!values.includes(String(value)) || typeof value !== 'string') protocol();
}
function receipt(value: unknown): void {
  if (value !== null) string(value, receiptPattern, 65536);
}
function interaction(value: unknown, mode: 'display' | 'interactive'): void {
  const v = object(value);
  if (v.mode !== mode) protocol();
  string(v.title, undefined, 200);
  if (v.description !== undefined && typeof v.description !== 'string') protocol();
  const source = object(v.source);
  if (mode === 'display') {
    if (source.kind !== 'data') protocol();
    object(source.data);
    return;
  }
  if (source.kind !== 'sess_surface' || v.response_policy !== 'first') protocol();
  for (const item of array(source.components)) {
    const c = object(item);
    oneOf(c.type, ['heading', 'text', 'record', 'field']);
    if (c.type === 'heading' || c.type === 'text') string(c.text);
    if (c.type === 'record') object(c.fields);
    if (c.type === 'field') {
      string(c.name, /^[a-z][a-z0-9_]{0,63}$/);
      string(c.label);
      oneOf(object(c.schema).type, ['string', 'number', 'integer', 'boolean', 'array']);
    }
  }
  const seen = new Set<string>();
  for (const item of array(v.actions)) {
    const a = object(item);
    const id = string(a.id, actionPattern);
    if (seen.has(id)) protocol();
    seen.add(id);
    string(a.label);
    if (a.intent !== undefined)
      oneOf(a.intent, ['submit', 'continue', 'approve', 'reject', 'request_change']);
  }
  if (!seen.size) protocol();
}

/** Keeps all additive JSON fields intact; this is a boundary decoder, not normalization. */
export function decodeAccepted(value: unknown): AcceptedResponse {
  const v = object(value);
  string(v.event_id, eventPattern);
  integer(v.sequence);
  integer(v.revision);
  string(v.action_id, actionPattern);
  object(v.data);
  if (object(v.actor).assurance !== 'link_holder') protocol();
  date(v.accepted_at);
  receipt(v.receipt);
  return value as AcceptedResponse;
}
export function decodeCreate(value: unknown, allowInsecureLocalhost = false): CreateSessionResponse {
  const v = object(value);
  string(v.id, sessionPattern);
  integer(v.revision);
  const text = string(v.human_url, /^[^\s\u0000-\u001f\u007f]+$/, 4096);
  let url: URL;
  try {
    url = new URL(text);
  } catch {
    return protocol();
  }
  if (
    url.username ||
    url.password ||
    url.hash ||
    url.search ||
    !(
      url.protocol === 'https:' ||
      (allowInsecureLocalhost && url.protocol === 'http:' && isLoopback(url.hostname))
    )
  )
    protocol();
  return value as CreateSessionResponse;
}
export function isLoopback(host: string): boolean {
  return host === 'localhost' || host === '[::1]' || /^127\.(?:\d{1,3}\.){2}\d{1,3}$/.test(host);
}
export function decodeSession(value: unknown, expectedId: string): Session {
  const v = object(value);
  if (string(v.id, sessionPattern) !== expectedId) protocol();
  const rev = integer(v.revision);
  const mode = object(v.interaction).mode;
  if (mode === 'display') {
    interaction(v.interaction, 'display');
    if ('status' in v || 'responses' in v) protocol();
    return value as Session;
  }
  interaction(v.interaction, 'interactive');
  oneOf(v.status, ['active', 'responded', 'completed']);
  object(v.response_schema);
  const seen = new Set<string>();
  const revisions = new Set<number>();
  let previousSequence = 0;
  let previousRevision = 0;
  for (const item of array(v.responses)) {
    const r = decodeAccepted(item);
    if (
      r.revision > rev ||
      r.sequence <= previousSequence ||
      r.revision <= previousRevision ||
      seen.has(r.event_id) ||
      revisions.has(r.revision)
    )
      protocol();
    seen.add(r.event_id);
    revisions.add(r.revision);
    previousSequence = r.sequence;
    previousRevision = r.revision;
  }
  if (v.status === 'responded' && !revisions.has(rev)) protocol();
  if (v.status === 'active' && revisions.has(rev)) protocol();
  return value as InteractiveSession;
}
export function decodeSurface(value: unknown, expectedId: string, revision: number): SurfaceRevision {
  const v = object(value);
  if (string(v.id, sessionPattern) !== expectedId || integer(v.revision) !== revision) protocol();
  interaction(v.interaction, 'interactive');
  object(v.response_schema);
  return value as SurfaceRevision;
}
export function decodeEvents(value: unknown, expectedId: string): SessionEvents {
  const v = object(value);
  if (string(v.id, sessionPattern) !== expectedId) protocol();
  const seen = new Set<string>();
  let seq = 0;
  for (const item of array(v.events)) {
    const e = object(item);
    const id = string(e.event_id, eventPattern);
    const next = integer(e.sequence);
    if (seen.has(id) || next <= seq) protocol();
    seen.add(id);
    seq = next;
    integer(e.revision);
    date(e.created_at);
    oneOf(e.type, ['response.accepted', 'revision.published', 'session.completed']);
    const actor = object(e.actor).assurance;
    if (e.type === 'response.accepted') {
      if (actor !== 'link_holder') protocol();
      string(e.action_id, actionPattern);
      object(e.data);
      receipt(e.receipt);
    } else if (actor !== 'owner') protocol();
  }
  return value as SessionEvents;
}
function endpoint(value: unknown): void {
  const v = object(value);
  string(v.id, new RegExp(`^whe_${ulid}$`));
  string(v.url);
  oneOf(v.status, ['pending', 'verified']);
  date(v.created_at);
  nullableDate(v.verified_at);
  nullableDate(v.verification_expires_at);
}
function secret(value: unknown): void {
  const v = object(value);
  string(v.kid, new RegExp(`^wk_${ulid}$`));
  string(v.secret, /^whsec_[A-Za-z0-9+/]{43}=$/);
}
export function decodeWebhookRegister(value: unknown): WebhookRegisterResponse {
  const v = object(value);
  endpoint(v.endpoint);
  if (v.signing_secret !== null) secret(v.signing_secret);
  return value as WebhookRegisterResponse;
}
export function decodeWebhook(value: unknown): WebhookResponse {
  const v = object(value);
  if (v.endpoint !== null) endpoint(v.endpoint);
  for (const item of array(v.signing_secrets)) {
    const s = object(item);
    string(s.kid);
    if (typeof s.active !== 'boolean') protocol();
    nullableDate(s.retire_at);
  }
  const d = object(v.deliveries);
  integer(d.pending, 0);
  integer(d.failed, 0);
  integer(d.delivered, 0);
  if (d.oldest_pending_age_seconds !== null) integer(d.oldest_pending_age_seconds, 0);
  return value as WebhookResponse;
}
export function decodeWebhookRotate(value: unknown): WebhookRotateResponse {
  const v = object(value);
  secret(v.signing_secret);
  if (v.previous !== null) {
    const p = object(v.previous);
    string(p.kid);
    date(p.retire_at);
  }
  return value as WebhookRotateResponse;
}
const outcomes = [
  'started',
  'delivered',
  'server_error',
  'rate_limited',
  'timeout',
  'connection',
  'dns',
  'signing_unavailable',
  'request_timeout',
  'too_early',
  'rejected',
  'redirect',
  'egress_refused',
  'endpoint_unavailable',
  'exhausted',
];
export function decodeDeliveries(value: unknown, expectedId: string): Deliveries {
  const v = object(value);
  if (string(v.id) !== expectedId) protocol();
  for (const item of array(v.deliveries)) {
    const d = object(item);
    string(d.delivery_id, new RegExp(`^obx_${ulid}$`));
    string(d.event_id, eventPattern);
    string(d.endpoint_id);
    oneOf(d.kind, ['accepted', 'redelivery']);
    oneOf(d.status, ['pending', 'delivered', 'failed']);
    nullableDate(d.next_attempt_at);
    date(d.deadline_at);
    date(d.created_at);
    nullableDate(d.finished_at);
    if (d.last_outcome !== null) oneOf(d.last_outcome, outcomes);
    for (const item of array(d.attempts)) {
      const a = object(item);
      integer(a.attempt);
      date(a.started_at);
      nullableDate(a.finished_at);
      oneOf(a.outcome, outcomes);
      if (a.http_status !== null) {
        const status = integer(a.http_status, 100);
        if (status > 599) protocol();
      }
    }
  }
  return value as Deliveries;
}
