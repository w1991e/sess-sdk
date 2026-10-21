import { randomUUID } from 'node:crypto';
import { inspect } from 'node:util';
import { SessError, lengthMessage } from './errors.js';
import { canonicalJson } from './receipts/json.js';
import type { ReceiptResource } from './receipts/resource.js';
import type { Sessions } from './sessions.js';
import { isInteractiveSession } from './types.js';
import type {
  AcceptedResponse,
  FieldSchema,
  InteractiveInteraction,
  InteractiveSession,
  RequestOptions,
  SurfaceComponent,
  VersionedResult,
} from './types.js';
import { withSignal } from './internal/time.js';

interface AskFieldBase {
  /** Key of this field in the answer: `^[a-z][a-z0-9_]{0,63}$`. */
  readonly name: string;
  /** What the field asks for: a word or two, about 20 characters; at most 60. Example: `Refund amount` */
  readonly label: string;
  /** Default `true`, except boolean fields (default `false`). */
  readonly required?: boolean;
}
/**
 * One simple field of a single question. Each kind compiles to the ordinary interactive field
 * with the runtime names, limits and schema semantics. `default` is a proposal the person can
 * correct; it must itself be a valid value.
 */
export type AskField =
  | (AskFieldBase & { readonly type: 'text'; readonly multiline?: boolean; readonly default?: string })
  | (AskFieldBase & {
      readonly type: 'number' | 'integer';
      readonly minimum?: number;
      readonly maximum?: number;
      readonly default?: number;
    })
  | (AskFieldBase & { readonly type: 'boolean'; readonly default?: boolean })
  | (AskFieldBase & {
      readonly type: 'choice';
      /**
       * 1–100 choices. The words shown for one choice: short; at most 60. Put any detail the
       * decision needs in `details`: a phone's picker may cut a long choice short.
       * Example: `Next Monday`
       */
      readonly options: readonly [string, ...string[]];
      readonly default?: string;
    })
  | (AskFieldBase & {
      readonly type: 'multi_choice';
      /**
       * 1–100 choices. The words shown for one choice: short; at most 60. Put any detail the
       * decision needs in `details`: a phone's picker may cut a long choice short.
       * Example: `Next Monday`
       */
      readonly options: readonly [string, ...string[]];
      readonly default?: readonly string[];
    });

/**
 * A question plus typed fields: the same shape as the MCP `sess_ask` tool input. Lengths are in
 * Unicode code points and are never truncated: a value over its limit throws a `SessError` whose
 * `field`, `limit` and `length` say which value to shorten and to what.
 */
export interface AskInput<F extends readonly AskField[] = readonly AskField[]> {
  /**
   * The page's heading: a question or a task, about 40 characters; at most 80.
   * Examples: `Approve the refund?`, `Pick a delivery date`
   */
  readonly question: string;
  /** Optional plain-text context shown above the fields, at most 4,000 characters. */
  readonly details?: string;
  /** A button: a verb, 1–3 words; at most 24. Default `Send`. Examples: `Approve`, `Send refund` */
  readonly submit_label?: string;
  /**
   * One to twelve fields with unique names. Fields keep the order you send them in and share one
   * group, under `details`. Each label sits beside its answer, or above it when the two do not
   * fit, so keep it to a word or two (about 20 characters). Nothing is truncated: rows grow to fit
   * their text.
   */
  readonly fields: F;
  /**
   * Advanced: how long the link stays open, in whole seconds from creation: from 30 up to your
   * plan's link lifetime (Sess checks the ceiling). Absent: the plan's lifetime.
   */
  readonly expires_in?: number;
}

type AskValue<T> = T extends { type: 'text' }
  ? string
  : T extends { type: 'number' | 'integer' }
    ? number
    : T extends { type: 'boolean' }
      ? boolean
      : T extends { type: 'choice'; options: readonly (infer O extends string)[] }
        ? O
        : T extends { type: 'multi_choice'; options: readonly (infer O extends string)[] }
          ? readonly O[]
          : never;
/** A checkbox and a multiple choice always have a value; other fields only when required. */
type AlwaysPresent<T> = T extends { type: 'boolean' | 'multi_choice' }
  ? true
  : T extends { required: false }
    ? false
    : T extends { required: true }
      ? true
      : T extends { required: boolean }
        ? false
        : true;
type Simplify<T> = { [K in keyof T]: T[K] } & {};
/** The verified answer type inferred from the field definitions (and checked at runtime). */
export type AskAnswer<F extends readonly AskField[]> = Simplify<
  {
    readonly [P in F[number] as AlwaysPresent<P> extends true ? P['name'] : never]: AskValue<P>;
  } & {
    readonly [P in F[number] as AlwaysPresent<P> extends true ? never : P['name']]?: AskValue<P>;
  }
>;

export interface AskOptions extends RequestOptions {
  /** Trusted expected receipt audience for this question; defaults to the client configuration. */
  expectedWorkspaceId?: string;
}
export interface AskAnswerOptions {
  /** Total local wait for the person, default ten minutes. Ending it never closes the Session. */
  timeoutMs?: number;
  /** Polling interval, default 1,500 ms plus jitter, minimum 1,000 ms. */
  intervalMs?: number;
  /** Ends the local wait of this call only. */
  signal?: AbortSignal;
}
/** One question: its private link now, its verified answer later. */
export interface AskHandle<T> {
  /** Private bearer link for the person. Deliver it only to them; keep it out of logs. */
  readonly link: string;
  readonly sessionId: string;
  /** The Surface revision of the question, for recovery through the advanced API. */
  readonly revision: number;
  /**
   * When the link stops taking answers (`action_expires_at`, ISO 8601), as created. On a link of
   * 20 hours or less the person may ask for more time, which moves it forward up to a fixed
   * horizon; while the link is lapsed (past it, still extendable) `answer()` keeps waiting. An
   * answer accepted before the end is still returned after it; with none, `answer()` ends with
   * `wait_ended` code `LINK_EXPIRED` once the link has expired. Null only from a runtime that
   * does not report it.
   */
  readonly expiresAt: string | null;
  /**
   * Waits for the answer, verifies its signed receipt and exact bindings, checks that it is still
   * the current step, completes (closes) the Session, then returns the typed answer.
   */
  answer(options?: AskAnswerOptions): Promise<T>;
}

/** The runtime byte limit for one stored interaction. */
const SURFACE_LIMIT_BYTES = 131_072;
/**
 * Sess's limits, in Unicode code points (the runtime checks the same numbers; nothing is ever
 * truncated): the question (title) 80, details (a text component) 4,000, the submit button 24,
 * field labels and options 60.
 */
const LIMITS = Object.freeze({
  fields: 12,
  options: 100,
  depth: 8,
  textMax: 4000,
  question: 80,
  details: 4000,
  submitLabel: 24,
  label: 60,
  option: 60,
});
const TYPES = ['text', 'number', 'integer', 'boolean', 'choice', 'multi_choice'] as const;
type AskType = (typeof TYPES)[number];
const FIELD_NAME = /^[a-z][a-z0-9_]{0,63}$/;
const RESERVED = new Set(['__proto__', 'constructor', 'prototype']);
// Plain text: no C0/C1 controls other than tab and newline, no bidirectional overrides.
const CONTROL = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f‪-‮⁦-⁩]/;

/** Internal compiled field: what an accepted answer is checked against. */
interface CompiledField {
  name: string;
  type: AskType;
  required: boolean;
  options?: readonly string[];
  minimum?: number;
  maximum?: number;
}
export interface CompiledAsk {
  interaction: InteractiveInteraction;
  fields: readonly CompiledField[];
  /** The link lifetime in seconds, when the question set one. */
  expiresIn?: number;
}

/** The shortest link lifetime Sess accepts, in seconds (the ceiling is the plan's). */
export const LINK_LIFETIME_FLOOR_SECONDS = 30;

type Json = string | number | boolean | null | Json[] | { [key: string]: Json };
type JsonObject = { [key: string]: Json };

function invalid(path: string, problem: string): never {
  // Paths and problems only: caller values never enter the message.
  throw new SessError('configuration', `Invalid question: ${path} ${problem}.`, {
    code: 'INVALID_QUESTION',
    outcome: 'not_sent',
  });
}
/** `fields[0].label` → `/fields/0/label`: the JSON pointer of an input path. */
function pointer(path: string): string {
  return `/${path
    .replace(/\[(\d+)\]/g, '.$1')
    .split('.')
    .join('/')}`;
}
function tooLong(path: string, limit: number, length: number): never {
  // The value itself never enters the message: only its pointer, the limit and its length, in
  // Sess's own sentences.
  throw new SessError('configuration', lengthMessage(pointer(path), limit, length), {
    code: 'INVALID_QUESTION',
    outcome: 'not_sent',
    field: pointer(path),
    limit,
    length,
  });
}
function safeKey(key: string): string {
  return /^[A-Za-z0-9_]{1,40}$/.test(key) ? key : '?';
}

/** Detached copy of plain JSON data: no accessors, symbols, special objects or deep nesting. */
function plain(value: unknown, path: string, depth = 0): Json {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) invalid(path, 'must be a finite number');
    return value;
  }
  if (typeof value !== 'object') return invalid(path, 'must be JSON data');
  if (depth >= LIMITS.depth) invalid(path, 'is nested too deeply');
  if (Array.isArray(value)) {
    if (Object.getPrototypeOf(value) !== Array.prototype) invalid(path, 'must be a plain array');
    const out: Json[] = [];
    for (let i = 0; i < value.length; i++) {
      const descriptor = Object.getOwnPropertyDescriptor(value, i);
      if (!descriptor || !('value' in descriptor)) invalid(`${path}[${i}]`, 'must be a plain element');
      out.push(plain(descriptor.value, `${path}[${i}]`, depth + 1));
    }
    return out;
  }
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) invalid(path, 'must be a plain object');
  if (Object.getOwnPropertySymbols(value).length) invalid(path, 'must not have symbol keys');
  const out: JsonObject = {};
  for (const key of Object.getOwnPropertyNames(value)) {
    if (RESERVED.has(key)) invalid(path, 'has a reserved key');
    const descriptor = Object.getOwnPropertyDescriptor(value, key)!;
    if (!('value' in descriptor) || !descriptor.enumerable) invalid(path, 'must have plain data properties');
    // An optional property given as undefined is omitted, as in request serialization.
    if (descriptor.value === undefined) continue;
    out[key] = plain(descriptor.value, path ? `${path}.${safeKey(key)}` : safeKey(key), depth + 1);
  }
  return out;
}

function object(value: Json | undefined, path: string): JsonObject {
  if (value === null || typeof value !== 'object' || Array.isArray(value))
    return invalid(path, 'must be an object');
  return value;
}
function closed(value: JsonObject, path: string, allowed: readonly string[], required: readonly string[]) {
  for (const key of Object.keys(value))
    if (!allowed.includes(key)) invalid(path, `has an unsupported property "${safeKey(key)}"`);
  for (const key of required) if (!Object.hasOwn(value, key)) invalid(path, `needs "${key}"`);
}
const codePoints = (value: string) => [...value].length;
function text(value: Json | undefined, path: string, max: number): string {
  if (typeof value !== 'string') return invalid(path, 'must be a string');
  if (!value.isWellFormed()) invalid(path, 'must be well-formed Unicode');
  const length = codePoints(value);
  if (length > max) tooLong(path, max, length);
  if (length < 1) invalid(path, `must be 1–${max} characters`);
  if (!/\S/.test(value)) invalid(path, 'must not be blank');
  if (CONTROL.test(value)) invalid(path, 'contains control or bidirectional override characters');
  return value;
}
function finite(value: Json | undefined, path: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return invalid(path, 'must be a finite number');
  return value;
}

/** Whether `value` is valid for the field: a proposal before creation or an accepted value after. */
function validValue(field: CompiledField, value: unknown): boolean {
  switch (field.type) {
    case 'text':
      // The runtime bounds a string field without maxLength to 4000 code points.
      return typeof value === 'string' && value.isWellFormed() && codePoints(value) <= LIMITS.textMax;
    case 'number':
    case 'integer':
      return (
        typeof value === 'number' &&
        Number.isFinite(value) &&
        (field.type === 'number' || Number.isInteger(value)) &&
        (field.minimum === undefined || value >= field.minimum) &&
        (field.maximum === undefined || value <= field.maximum)
      );
    case 'boolean':
      return typeof value === 'boolean';
    case 'choice':
      return typeof value === 'string' && field.options!.includes(value);
    case 'multi_choice':
      return (
        Array.isArray(value) &&
        value.every((item) => typeof item === 'string' && field.options!.includes(item)) &&
        new Set(value).size === value.length
      );
  }
}

function compileField(raw: Json, path: string, names: Set<string>) {
  const f = object(raw, path);
  closed(
    f,
    path,
    ['name', 'label', 'type', 'required', 'options', 'default', 'multiline', 'minimum', 'maximum'],
    ['name', 'label', 'type'],
  );
  if (typeof f.name !== 'string' || !FIELD_NAME.test(f.name) || RESERVED.has(f.name))
    invalid(`${path}.name`, 'must match ^[a-z][a-z0-9_]{0,63}$');
  const name = f.name;
  if (names.has(name)) invalid(`${path}.name`, 'duplicates another field name');
  names.add(name);
  const label = text(f.label, `${path}.label`, LIMITS.label);
  const type = f.type as AskType;
  if (!TYPES.includes(type)) invalid(`${path}.type`, `must be one of ${TYPES.join(', ')}`);
  const choice = type === 'choice' || type === 'multi_choice';
  if (choice !== (f.options !== undefined))
    invalid(
      `${path}.options`,
      choice ? 'is required for choice fields' : 'is only allowed for choice fields',
    );
  if (f.multiline !== undefined && type !== 'text') invalid(`${path}.multiline`, 'is only allowed for text');
  if ((f.minimum !== undefined || f.maximum !== undefined) && type !== 'number' && type !== 'integer')
    invalid(path, 'minimum/maximum are only allowed for number and integer');
  for (const key of ['required', 'multiline'] as const)
    if (f[key] !== undefined && typeof f[key] !== 'boolean') invalid(`${path}.${key}`, 'must be a boolean');
  const required = f.required === undefined ? type !== 'boolean' : f.required === true;
  const compiled: CompiledField = { name, type, required };
  let schema: FieldSchema;
  switch (type) {
    case 'text':
      schema = { type: 'string' };
      break;
    case 'number':
    case 'integer': {
      const minimum = f.minimum === undefined ? undefined : finite(f.minimum, `${path}.minimum`);
      const maximum = f.maximum === undefined ? undefined : finite(f.maximum, `${path}.maximum`);
      if (minimum !== undefined && maximum !== undefined && minimum > maximum)
        invalid(`${path}.minimum`, 'must not exceed maximum');
      if (minimum !== undefined) compiled.minimum = minimum;
      if (maximum !== undefined) compiled.maximum = maximum;
      schema = {
        type,
        ...(minimum !== undefined ? { minimum } : {}),
        ...(maximum !== undefined ? { maximum } : {}),
      };
      break;
    }
    case 'boolean':
      schema = { type: 'boolean' };
      break;
    case 'choice':
    case 'multi_choice': {
      const options = f.options;
      if (!Array.isArray(options) || options.length < 1 || options.length > LIMITS.options)
        invalid(`${path}.options`, `must list 1–${LIMITS.options} options`);
      const values = options.map((option, i) => text(option, `${path}.options[${i}]`, LIMITS.option));
      if (new Set(values).size !== values.length) invalid(`${path}.options`, 'must be unique');
      compiled.options = Object.freeze([...values]);
      schema =
        type === 'choice'
          ? { type: 'string', enum: values }
          : { type: 'array', items: { type: 'string', enum: [...values] }, uniqueItems: true };
      break;
    }
  }
  if (f.default !== undefined && !validValue(compiled, f.default))
    invalid(`${path}.default`, 'is not a valid value for this field');
  const component: SurfaceComponent = {
    type: 'field',
    name,
    label,
    required,
    schema,
    ...(f.multiline !== undefined ? { multiline: f.multiline as boolean } : {}),
    ...(f.default !== undefined ? { value: f.default } : {}),
  };
  return { component, compiled: Object.freeze(compiled) };
}

/**
 * The one deterministic simple-field compiler: validates a question locally, without network,
 * credential or clock access, and expands it into the ordinary interactive Surface.
 */
export function compileAsk(input: unknown): CompiledAsk {
  const a = object(plain(input, ''), 'input');
  closed(a, 'input', ['question', 'details', 'fields', 'submit_label', 'expires_in'], ['question', 'fields']);
  const expiresIn = a.expires_in;
  if (
    expiresIn !== undefined &&
    (typeof expiresIn !== 'number' ||
      !Number.isSafeInteger(expiresIn) ||
      expiresIn < LINK_LIFETIME_FLOOR_SECONDS)
  )
    invalid('expires_in', `must be a whole number of seconds, at least ${LINK_LIFETIME_FLOOR_SECONDS}`);
  const title = text(a.question, 'question', LIMITS.question);
  const details = a.details === undefined ? undefined : text(a.details, 'details', LIMITS.details);
  const submit =
    a.submit_label === undefined ? 'Send' : text(a.submit_label, 'submit_label', LIMITS.submitLabel);
  const fields = a.fields;
  if (!Array.isArray(fields) || fields.length < 1 || fields.length > LIMITS.fields)
    invalid('fields', `must contain 1–${LIMITS.fields} fields`);
  const components: SurfaceComponent[] = [];
  if (details !== undefined) components.push({ type: 'text', text: details });
  const names = new Set<string>();
  const compiled: CompiledField[] = [];
  fields.forEach((field, i) => {
    const result = compileField(field, `fields[${i}]`, names);
    components.push(result.component);
    compiled.push(result.compiled);
  });
  const interaction: InteractiveInteraction = {
    mode: 'interactive',
    title,
    source: { kind: 'sess_surface', components },
    actions: [{ id: 'submit', label: submit, intent: 'submit' }],
  };
  if (Buffer.byteLength(JSON.stringify(interaction), 'utf8') > SURFACE_LIMIT_BYTES)
    invalid('input', `exceeds the ${SURFACE_LIMIT_BYTES}-byte Surface limit`);
  return {
    interaction,
    fields: Object.freeze(compiled),
    ...(expiresIn !== undefined ? { expiresIn: expiresIn as number } : {}),
  };
}

/**
 * Checks verified answer data against the compiled fields and returns a frozen copy in field
 * order. It follows the runtime decoding: a checkbox is always present, a multiple choice is
 * always a list, and an empty optional value is absent.
 */
export function checkAnswer(
  fields: readonly CompiledField[],
  data: unknown,
): Readonly<Record<string, unknown>> {
  const mismatch = () =>
    new SessError('protocol', 'The verified answer does not match the question’s fields.', {
      code: 'INVALID_RESPONSE',
    });
  if (data === null || typeof data !== 'object' || Array.isArray(data)) throw mismatch();
  const source = data as Record<string, unknown>;
  const known = new Set(fields.map((f) => f.name));
  for (const key of Object.keys(source)) if (!known.has(key)) throw mismatch();
  const out: Record<string, unknown> = {};
  for (const field of fields) {
    if (!Object.hasOwn(source, field.name)) {
      if (field.required || field.type === 'boolean' || field.type === 'multi_choice') throw mismatch();
      continue;
    }
    const value = source[field.name];
    if (!validValue(field, value) || value === '') throw mismatch();
    out[field.name] = Array.isArray(value) ? Object.freeze([...value]) : value;
  }
  return Object.freeze(out);
}

/** The replay identity of the completion, saved before its first dispatch. */
interface Completion {
  eventId: string;
  ifMatch: string;
  idempotencyKey: string;
  uncertain: boolean;
}

class Handle<T> implements AskHandle<T> {
  readonly sessionId: string;
  readonly revision: number;
  readonly expiresAt: string | null;
  #link: string;
  #sessions: Sessions;
  #receipts: ReceiptResource;
  #expectedWorkspaceId: string | undefined;
  #fields: readonly CompiledField[];
  #surface: string;
  #result: { value: T } | undefined;
  #settling: Promise<T> | undefined;
  #completion: Completion | undefined;

  constructor(context: {
    sessionId: string;
    revision: number;
    expiresAt: string | null;
    link: string;
    sessions: Sessions;
    receipts: ReceiptResource;
    expectedWorkspaceId: string | undefined;
    compiled: CompiledAsk;
  }) {
    this.sessionId = context.sessionId;
    this.revision = context.revision;
    this.expiresAt = context.expiresAt;
    this.#link = context.link;
    this.#sessions = context.sessions;
    this.#receipts = context.receipts;
    this.#expectedWorkspaceId = context.expectedWorkspaceId;
    this.#fields = context.compiled.fields;
    // The runtime stores the interaction with its only response policy.
    this.#surface = canonicalJson({ ...context.compiled.interaction, response_policy: 'first' });
    this.answer = this.answer.bind(this);
    Object.freeze(this);
  }

  get link(): string {
    return this.#link;
  }

  async answer(options: AskAnswerOptions = {}): Promise<T> {
    if (!options || typeof options !== 'object')
      throw new SessError('configuration', 'answer options must be an object.', { outcome: 'not_sent' });
    const { timeoutMs, intervalMs, signal } = options;
    if (this.#result) return this.#result.value;
    const waited = await this.#sessions.waitForResponse(this.sessionId, {
      revision: this.revision,
      ...(timeoutMs !== undefined ? { timeoutMs } : {}),
      ...(intervalMs !== undefined ? { intervalMs } : {}),
      ...(signal !== undefined ? { signal } : {}),
    });
    // Another call may have settled this handle during the wait.
    const settled = this.#result as { value: T } | undefined;
    if (settled) return settled.value;
    // One logical settlement per handle, shared by concurrent callers. It is not bound to the
    // signal of any caller: an abort ends only that local wait.
    this.#settling ??= this.#settle(waited.response).finally(() => {
      this.#settling = undefined;
    });
    if (!signal) return this.#settling;
    try {
      return await withSignal(this.#settling, signal);
    } catch (error) {
      if (signal.aborted)
        throw new SessError('aborted', 'Waiting for the answer was aborted. The Session remains available.', {
          sessionId: this.sessionId,
          revision: this.revision,
        });
      throw error;
    }
  }

  async #settle(accepted: AcceptedResponse): Promise<T> {
    const verified = await this.#receipts.verifyResponse({
      sessionId: this.sessionId,
      response: accepted,
      ...(this.#expectedWorkspaceId !== undefined ? { expectedWorkspaceId: this.#expectedWorkspaceId } : {}),
    });
    const response = verified.response;
    if (
      response.event_id !== accepted.event_id ||
      response.revision !== this.revision ||
      response.action_id !== 'submit' ||
      verified.surface.id !== this.sessionId ||
      verified.surface.revision !== this.revision ||
      canonicalJson(verified.surface.interaction) !== this.#surface
    )
      throw new SessError('receipt_verification', 'The verified answer is not bound to this question.', {
        code: 'RECORD_BINDING_MISMATCH',
      });
    const value = checkAnswer(this.#fields, response.data) as T;
    await this.#complete(response.event_id);
    this.#result = { value };
    return value;
  }

  /** Completed at exactly this revision and still retaining exactly this accepted event. */
  #completedHere(session: InteractiveSession, eventId: string): boolean {
    return (
      session.status === 'completed' &&
      session.revision === this.revision &&
      session.responses.some((r) => r.event_id === eventId && r.revision === this.revision)
    );
  }

  async #complete(eventId: string): Promise<void> {
    if (this.#completion && this.#completion.eventId !== eventId)
      throw new SessError('receipt_verification', 'A different answer was already used for this question.', {
        code: 'RECORD_BINDING_MISMATCH',
      });
    // Currentness after verification: a historically valid answer alone does not allow progression.
    const current = await this.#sessions.retrieve(this.sessionId);
    const session = current.data;
    if (!isInteractiveSession(session))
      throw this.#ended('NOT_INTERACTIVE', 'A display Session has no accepted human responses.');
    if (this.#completedHere(session, eventId)) return;
    const retained = session.responses.some((r) => r.event_id === eventId && r.revision === this.revision);
    if (!retained || session.revision !== this.revision || session.status !== 'responded')
      throw this.#ended('REVISION_SUPERSEDED', 'The answered revision is no longer the current step.');
    // Saved before the first dispatch and replayed after any uncertainty: never a fresh identity.
    this.#completion ??= {
      eventId,
      ifMatch: current.meta.etag,
      idempotencyKey: `sess-ask:${randomUUID()}`,
      uncertain: false,
    };
    const pending = this.#completion;
    let result: VersionedResult<InteractiveSession>;
    try {
      result = await this.#sessions.complete(this.sessionId, {
        ifMatch: pending.ifMatch,
        idempotencyKey: pending.idempotencyKey,
      });
    } catch (error) {
      if (error instanceof SessError && error.code === 'SESSION_COMPLETED') {
        // Already completed: confirmed only by reading it back at this revision with this event.
        const readback = await this.#sessions.retrieve(this.sessionId);
        if (isInteractiveSession(readback.data) && this.#completedHere(readback.data, eventId)) return;
        throw error;
      }
      // A definite rejection of an identity that was never uncertain wrote nothing; anything else
      // keeps the identity for an exact replay on the next call.
      if (error instanceof SessError && error.outcome === 'rejected' && !pending.uncertain)
        this.#completion = undefined;
      else pending.uncertain = true;
      throw error;
    }
    if (!this.#completedHere(result.data, eventId)) {
      pending.uncertain = true;
      throw new SessError('protocol', 'Completion was not confirmed at the answered revision.', {
        code: 'INVALID_RESPONSE',
        operation: 'sessions.complete',
        outcome: 'unknown',
      });
    }
  }

  #ended(code: string, message: string): SessError {
    return new SessError('wait_ended', message, { code, sessionId: this.sessionId, revision: this.revision });
  }

  /** The private link is omitted from serialization and inspection. */
  toJSON(): object {
    return { sessionId: this.sessionId, revision: this.revision };
  }

  [inspect.custom](): object {
    return this.toJSON();
  }
}

/** Validates locally, creates once (the link is available before any wait) and returns the handle. */
export async function ask<T>(
  sessions: Sessions,
  receipts: ReceiptResource,
  input: unknown,
  options: AskOptions = {},
): Promise<AskHandle<T>> {
  const compiled = compileAsk(input);
  if (!options || typeof options !== 'object')
    throw new SessError('configuration', 'ask options must be an object.', { outcome: 'not_sent' });
  const { expectedWorkspaceId, ...requestOptions } = options;
  if (
    expectedWorkspaceId !== undefined &&
    (typeof expectedWorkspaceId !== 'string' || !/^[A-Za-z0-9_:-]{1,128}$/.test(expectedWorkspaceId))
  )
    throw new SessError('configuration', 'expectedWorkspaceId must be a trusted workspace identifier.', {
      outcome: 'not_sent',
    });
  // Creation carries the whole interaction and is attempted once. An uncertain outcome surfaces as
  // the unknown_outcome error of the client and is never retried here.
  const created = await sessions.create(
    {
      interaction: compiled.interaction,
      ...(compiled.expiresIn !== undefined ? { expires_in: compiled.expiresIn } : {}),
    },
    requestOptions,
  );
  return new Handle<T>({
    sessionId: created.data.id,
    revision: created.data.revision,
    expiresAt: typeof created.data.action_expires_at === 'string' ? created.data.action_expires_at : null,
    link: created.data.human_url,
    sessions,
    receipts,
    expectedWorkspaceId,
    compiled,
  });
}
