import { AdapterError } from './errors.js';

/**
 * Adapter policy limits. They are at or below the runtime's published contract limits and are
 * checked before any state write or network dispatch. Nothing is truncated: an oversized or
 * malformed request is rejected with a specific error instead.
 */
export const LIMITS = Object.freeze({
  argumentBytes: 40 * 1024,
  interactionBytes: 32 * 1024,
  depth: 8,
  components: 64,
  fields: 24,
  actions: 5,
  recordEntries: 50,
  optionLabels: 100,
  enumValues: 100,
  maxWaitMs: 45_000,
  maxRevision: 999_999_999,
});

export const HANDLE_PATTERN = /^sh_[A-Za-z0-9_-]{22}$/;
export const EVENT_ID_PATTERN = /^evt_[0-9A-HJKMNP-TV-Z]{26}$/;
const ACTION_ID = /^[a-z][a-z0-9_]{0,31}$/;
const FIELD_NAME = /^[a-z][a-z0-9_]{0,63}$/;
const UNSAFE_KEYS = new Set(['__proto__', 'constructor', 'prototype']);
// Plain text: no C0/C1 controls other than tab and newline, no bidi overrides.
const CONTROL = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f‪-‮⁦-⁩]/;

export type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };
export type JsonObject = { [key: string]: JsonValue };

function invalid(path: string, problem: string): never {
  throw new AdapterError('INVALID_ARGUMENTS', `${path || 'arguments'}: ${problem}`);
}
function label(key: string): string {
  return /^[A-Za-z0-9_]{1,40}$/.test(key) ? key : '?';
}

/**
 * Structural JSON guard: plain data objects/arrays only, finite numbers, no unsafe or accessor
 * keys, bounded depth. Returns a detached deep copy so later code never sees caller-owned objects.
 */
export function plainJson(value: unknown, path: string, depth = 0): JsonValue {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) invalid(path, 'numbers must be finite');
    return value;
  }
  if (typeof value !== 'object') return invalid(path, 'only JSON values are accepted');
  if (depth >= LIMITS.depth) invalid(path, `nesting exceeds ${LIMITS.depth} levels`);
  if (Array.isArray(value)) {
    if (Object.getPrototypeOf(value) !== Array.prototype) invalid(path, 'unsupported array');
    const out: JsonValue[] = [];
    for (let i = 0; i < value.length; i++) {
      const descriptor = Object.getOwnPropertyDescriptor(value, i);
      if (!descriptor || !('value' in descriptor)) invalid(`${path}[${i}]`, 'sparse or accessor element');
      out.push(plainJson(descriptor.value, `${path}[${i}]`, depth + 1));
    }
    return out;
  }
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) invalid(path, 'only plain objects are accepted');
  if (Object.getOwnPropertySymbols(value).length) invalid(path, 'symbol keys are not accepted');
  const out: JsonObject = Object.create(null) as JsonObject;
  for (const key of Object.getOwnPropertyNames(value)) {
    if (UNSAFE_KEYS.has(key)) invalid(path, `unsafe key "${label(key)}"`);
    const descriptor = Object.getOwnPropertyDescriptor(value, key)!;
    if (!('value' in descriptor) || !descriptor.enumerable) invalid(path, 'accessor or hidden property');
    out[key] = plainJson(descriptor.value, `${path}.${label(key)}`, depth + 1);
  }
  return Object.assign({}, out) as JsonObject;
}

function bytes(value: unknown): number {
  return Buffer.byteLength(JSON.stringify(value), 'utf8');
}

function object(value: JsonValue | undefined, path: string): JsonObject {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return invalid(path, 'must be an object');
  return value;
}
function closed(
  value: JsonObject,
  path: string,
  allowed: readonly string[],
  required: readonly string[],
): void {
  for (const key of Object.keys(value)) {
    if (!allowed.includes(key)) invalid(path, `unknown property "${label(key)}"`);
  }
  for (const key of required) if (!(key in value)) invalid(path, `missing required property "${key}"`);
}
function text(value: JsonValue | undefined, path: string, max: number, min = 1, nonBlank = true): string {
  if (typeof value !== 'string') return invalid(path, 'must be a string');
  if (value.length < min || value.length > max) invalid(path, `length must be ${min}..${max}`);
  if (nonBlank && min > 0 && !/\S/.test(value)) invalid(path, 'must not be blank');
  if (CONTROL.test(value)) invalid(path, 'contains control or bidirectional override characters');
  return value;
}
function integer(value: JsonValue | undefined, path: string, min: number, max: number): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < min || value > max)
    return invalid(path, `must be an integer from ${min} to ${max}`);
  return value;
}
function pattern(value: JsonValue | undefined, path: string, regex: RegExp): string {
  if (typeof value !== 'string' || !regex.test(value)) return invalid(path, 'has an invalid format');
  return value;
}

const SCHEMA_KEYS = [
  'type',
  'title',
  'description',
  'minLength',
  'maxLength',
  'enum',
  'minimum',
  'maximum',
  'exclusiveMinimum',
  'exclusiveMaximum',
  'items',
  'minItems',
  'maxItems',
  'uniqueItems',
] as const;

function fieldSchema(value: JsonValue | undefined, path: string): void {
  const schema = object(value, path);
  closed(schema, path, SCHEMA_KEYS, ['type']);
  if (!['string', 'number', 'integer', 'boolean', 'array'].includes(schema.type as string))
    invalid(`${path}.type`, 'must be string, number, integer, boolean or array');
  if (schema.title !== undefined) text(schema.title, `${path}.title`, 200);
  if (schema.description !== undefined) text(schema.description, `${path}.description`, 1000, 0);
  if (schema.enum !== undefined) {
    if (!Array.isArray(schema.enum) || schema.enum.length < 1 || schema.enum.length > LIMITS.enumValues)
      invalid(`${path}.enum`, `must list 1..${LIMITS.enumValues} values`);
    schema.enum.forEach((item, i) => text(item, `${path}.enum[${i}]`, 200));
  }
  for (const key of ['minLength', 'maxLength', 'minItems', 'maxItems'] as const) {
    if (schema[key] !== undefined) integer(schema[key], `${path}.${key}`, 0, 100_000);
  }
  for (const key of ['minimum', 'maximum', 'exclusiveMinimum', 'exclusiveMaximum'] as const) {
    if (schema[key] !== undefined && typeof schema[key] !== 'number')
      invalid(`${path}.${key}`, 'must be a number');
  }
  if (schema.uniqueItems !== undefined && schema.uniqueItems !== true)
    invalid(`${path}.uniqueItems`, 'must be true');
  if (schema.items !== undefined) {
    const items = object(schema.items, `${path}.items`);
    closed(items, `${path}.items`, ['type', 'enum'], ['type', 'enum']);
    if (items.type !== 'string') invalid(`${path}.items.type`, 'must be string');
    if (!Array.isArray(items.enum) || items.enum.length < 1 || items.enum.length > LIMITS.enumValues)
      invalid(`${path}.items.enum`, `must list 1..${LIMITS.enumValues} values`);
    items.enum.forEach((item, i) => text(item, `${path}.items.enum[${i}]`, 200));
  }
}

function component(value: JsonValue, path: string, names: Set<string>): boolean {
  const c = object(value, path);
  switch (c.type) {
    case 'heading':
      closed(c, path, ['type', 'text'], ['type', 'text']);
      text(c.text, `${path}.text`, 200);
      return false;
    case 'text':
      closed(c, path, ['type', 'text'], ['type', 'text']);
      text(c.text, `${path}.text`, 4000, 1, false);
      return false;
    case 'record': {
      closed(c, path, ['type', 'label', 'fields'], ['type', 'fields']);
      if (c.label !== undefined) text(c.label, `${path}.label`, 200);
      const fields = object(c.fields, `${path}.fields`);
      const keys = Object.keys(fields);
      if (keys.length < 1 || keys.length > LIMITS.recordEntries)
        invalid(`${path}.fields`, `must have 1..${LIMITS.recordEntries} entries`);
      for (const key of keys) {
        text(key, `${path}.fields`, 200);
        const entry = fields[key];
        if (entry !== null && typeof entry === 'object')
          invalid(`${path}.fields`, 'values must be primitive');
        if (typeof entry === 'string') text(entry, `${path}.fields`, 4000, 0);
      }
      return false;
    }
    case 'field': {
      closed(
        c,
        path,
        ['type', 'name', 'label', 'description', 'required', 'multiline', 'option_labels', 'schema', 'value'],
        ['type', 'name', 'label', 'schema'],
      );
      const name = pattern(c.name, `${path}.name`, FIELD_NAME);
      // The name becomes a key of the submitted data object; reserved object keys are refused.
      if (UNSAFE_KEYS.has(name)) invalid(`${path}.name`, `"${name}" is a reserved name`);
      if (names.has(name)) invalid(`${path}.name`, 'duplicates another field name');
      names.add(name);
      text(c.label, `${path}.label`, 200);
      if (c.description !== undefined) text(c.description, `${path}.description`, 1000, 0);
      for (const key of ['required', 'multiline'] as const) {
        if (c[key] !== undefined && typeof c[key] !== 'boolean')
          invalid(`${path}.${key}`, 'must be a boolean');
      }
      if (c.option_labels !== undefined) {
        const labels = object(c.option_labels, `${path}.option_labels`);
        const keys = Object.keys(labels);
        if (keys.length > LIMITS.optionLabels)
          invalid(`${path}.option_labels`, `must have at most ${LIMITS.optionLabels} entries`);
        for (const key of keys) {
          text(key, `${path}.option_labels`, 200);
          text(labels[key], `${path}.option_labels`, 200);
        }
      }
      fieldSchema(c.schema, `${path}.schema`);
      if (c.value !== undefined) {
        const v = c.value;
        if (Array.isArray(v)) v.forEach((item, i) => text(item, `${path}.value[${i}]`, 200));
        else if (v === null || typeof v === 'object')
          invalid(`${path}.value`, 'must be a primitive or string list');
        else if (typeof v === 'string') text(v, `${path}.value`, 100_000, 0);
      }
      return true;
    }
    default:
      return invalid(`${path}.type`, 'must be heading, text, record or field');
  }
}

/** A closed check of the supported interactive Surface shape. The runtime still validates it. */
export function validateInteraction(value: JsonValue | undefined, path = 'interaction'): JsonObject {
  const interaction = object(value, path);
  if (bytes(interaction) > LIMITS.interactionBytes)
    invalid(path, `serialized size exceeds ${LIMITS.interactionBytes} bytes`);
  closed(
    interaction,
    path,
    ['mode', 'title', 'description', 'source', 'actions', 'response_policy'],
    ['mode', 'title', 'source', 'actions'],
  );
  if (interaction.mode !== 'interactive') invalid(`${path}.mode`, 'must be "interactive"');
  text(interaction.title, `${path}.title`, 200);
  if (interaction.description !== undefined) text(interaction.description, `${path}.description`, 4000, 0);
  if (interaction.response_policy !== undefined && interaction.response_policy !== 'first')
    invalid(`${path}.response_policy`, 'must be "first"');
  const source = object(interaction.source, `${path}.source`);
  closed(source, `${path}.source`, ['kind', 'components'], ['kind', 'components']);
  if (source.kind !== 'sess_surface') invalid(`${path}.source.kind`, 'must be "sess_surface"');
  const components = source.components;
  if (!Array.isArray(components) || components.length < 1 || components.length > LIMITS.components)
    invalid(`${path}.source.components`, `must contain 1..${LIMITS.components} components`);
  const names = new Set<string>();
  let fields = 0;
  components.forEach((c, i) => {
    if (component(c, `${path}.source.components[${i}]`, names)) fields++;
  });
  if (fields > LIMITS.fields) invalid(`${path}.source.components`, `at most ${LIMITS.fields} fields`);
  const actions = interaction.actions;
  if (!Array.isArray(actions) || actions.length < 1 || actions.length > LIMITS.actions)
    invalid(`${path}.actions`, `must contain 1..${LIMITS.actions} actions`);
  const ids = new Set<string>();
  actions.forEach((a, i) => {
    const action = object(a, `${path}.actions[${i}]`);
    closed(action, `${path}.actions[${i}]`, ['id', 'label', 'intent'], ['id', 'label']);
    const id = pattern(action.id, `${path}.actions[${i}].id`, ACTION_ID);
    if (ids.has(id)) invalid(`${path}.actions[${i}].id`, 'duplicates another action');
    ids.add(id);
    text(action.label, `${path}.actions[${i}].label`, 200);
    if (
      action.intent !== undefined &&
      !['submit', 'continue', 'approve', 'reject', 'request_change'].includes(action.intent as string)
    )
      invalid(`${path}.actions[${i}].intent`, 'is not a supported intent');
  });
  return interaction;
}

function args(raw: unknown, allowed: readonly string[], required: readonly string[]): JsonObject {
  if (raw === undefined) raw = {};
  const value = plainJson(raw, '');
  const top = object(value, 'arguments');
  if (bytes(top) > LIMITS.argumentBytes)
    invalid('arguments', `serialized size exceeds ${LIMITS.argumentBytes} bytes`);
  closed(top, 'arguments', allowed, required);
  return top;
}

export interface RequestArgs {
  interaction: JsonObject;
  /** Advanced: the link lifetime in seconds (from 30; the plan's ceiling is checked by Sess). */
  expiresIn?: number;
}

/** The shortest link lifetime Sess accepts, in seconds (Decision 0009 Amendment 7). */
export const LINK_LIFETIME_FLOOR_SECONDS = 30;

function linkLifetime(value: JsonValue | undefined): { expiresIn?: number } {
  if (value === undefined) return {};
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < LINK_LIFETIME_FLOOR_SECONDS)
    invalid('expires_in', `must be a whole number of seconds, at least ${LINK_LIFETIME_FLOOR_SECONDS}`);
  return { expiresIn: value };
}
export interface ResponseArgs {
  handle: string;
  revision: number;
  waitMs?: number;
}
export interface PublishArgs {
  handle: string;
  expectedRevision: number;
  responseEventId: string;
  interaction: JsonObject;
}
export interface CompleteArgs {
  handle: string;
  expectedRevision: number;
  responseEventId: string;
}

export function parseRequestArgs(raw: unknown): RequestArgs {
  const a = args(raw, ['interaction', 'expires_in'], ['interaction']);
  return { interaction: validateInteraction(a.interaction), ...linkLifetime(a.expires_in) };
}
export function parseResponseArgs(raw: unknown): ResponseArgs {
  const a = args(raw, ['handle', 'revision', 'wait_ms'], ['handle', 'revision']);
  return {
    handle: pattern(a.handle, 'handle', HANDLE_PATTERN),
    revision: integer(a.revision, 'revision', 1, LIMITS.maxRevision),
    ...(a.wait_ms !== undefined ? { waitMs: integer(a.wait_ms, 'wait_ms', 0, LIMITS.maxWaitMs) } : {}),
  };
}
export function parsePublishArgs(raw: unknown): PublishArgs {
  const a = args(
    raw,
    ['handle', 'expected_revision', 'response_event_id', 'interaction'],
    ['handle', 'expected_revision', 'response_event_id', 'interaction'],
  );
  return {
    handle: pattern(a.handle, 'handle', HANDLE_PATTERN),
    expectedRevision: integer(a.expected_revision, 'expected_revision', 1, LIMITS.maxRevision),
    responseEventId: pattern(a.response_event_id, 'response_event_id', EVENT_ID_PATTERN),
    interaction: validateInteraction(a.interaction),
  };
}
export function parseCompleteArgs(raw: unknown): CompleteArgs {
  const a = args(
    raw,
    ['handle', 'expected_revision', 'response_event_id'],
    ['handle', 'expected_revision', 'response_event_id'],
  );
  return {
    handle: pattern(a.handle, 'handle', HANDLE_PATTERN),
    expectedRevision: integer(a.expected_revision, 'expected_revision', 1, LIMITS.maxRevision),
    responseEventId: pattern(a.response_event_id, 'response_event_id', EVENT_ID_PATTERN),
  };
}

/** sess_ask: a question plus a small field list, expanded into an ordinary interaction. */
export const ASK_LIMITS = Object.freeze({ fields: 12, options: LIMITS.enumValues });
const ASK_TYPES = ['text', 'number', 'integer', 'boolean', 'choice', 'multi_choice'] as const;

function askField(value: JsonValue | undefined, path: string): JsonObject {
  const f = object(value, path);
  closed(
    f,
    path,
    ['name', 'label', 'type', 'required', 'options', 'default', 'multiline', 'minimum', 'maximum'],
    ['name', 'label', 'type'],
  );
  const type = f.type as (typeof ASK_TYPES)[number];
  if (!ASK_TYPES.includes(type)) invalid(`${path}.type`, `must be one of ${ASK_TYPES.join(', ')}`);
  const choice = type === 'choice' || type === 'multi_choice';
  if (choice !== (f.options !== undefined))
    invalid(
      `${path}.options`,
      choice ? 'is required for choice fields' : 'is only allowed for choice fields',
    );
  if (f.multiline !== undefined && type !== 'text') invalid(`${path}.multiline`, 'is only allowed for text');
  if ((f.minimum !== undefined || f.maximum !== undefined) && type !== 'number' && type !== 'integer')
    invalid(path, 'minimum/maximum are only allowed for number and integer');
  let schema: JsonObject;
  switch (type) {
    case 'text':
      schema = { type: 'string' };
      break;
    case 'number':
    case 'integer':
      schema = {
        type,
        ...(f.minimum !== undefined ? { minimum: f.minimum } : {}),
        ...(f.maximum !== undefined ? { maximum: f.maximum } : {}),
      };
      break;
    case 'boolean':
      schema = { type: 'boolean' };
      break;
    case 'choice':
    case 'multi_choice': {
      const options = f.options;
      if (!Array.isArray(options) || options.length < 1 || options.length > ASK_LIMITS.options)
        invalid(`${path}.options`, `must list 1..${ASK_LIMITS.options} options`);
      if (new Set(options).size !== options.length) invalid(`${path}.options`, 'must be unique');
      schema =
        type === 'choice'
          ? { type: 'string', enum: options }
          : { type: 'array', items: { type: 'string', enum: options }, uniqueItems: true };
      break;
    }
  }
  return {
    type: 'field',
    name: f.name as JsonValue,
    label: f.label as JsonValue,
    required: f.required === undefined ? type !== 'boolean' : f.required,
    schema,
    ...(f.multiline !== undefined ? { multiline: f.multiline } : {}),
    ...(f.default !== undefined ? { value: f.default } : {}),
  };
}

/**
 * Builds the interaction for sess_ask and validates it with exactly the same rules and limits as
 * sess_request. The result goes through the ordinary request operation.
 */
export function parseAskArgs(raw: unknown): RequestArgs {
  const a = args(
    raw,
    ['question', 'details', 'fields', 'submit_label', 'expires_in'],
    ['question', 'fields'],
  );
  const fields = a.fields;
  if (!Array.isArray(fields) || fields.length < 1 || fields.length > ASK_LIMITS.fields)
    invalid('fields', `must contain 1..${ASK_LIMITS.fields} fields`);
  const components: JsonValue[] = [];
  if (a.details !== undefined) components.push({ type: 'text', text: text(a.details, 'details', 4000) });
  fields.forEach((f, i) => components.push(askField(f, `fields[${i}]`)));
  const interaction: JsonObject = {
    mode: 'interactive',
    title: text(a.question, 'question', 200),
    source: { kind: 'sess_surface', components },
    actions: [
      {
        id: 'submit',
        label: a.submit_label === undefined ? 'Send' : text(a.submit_label, 'submit_label', 200),
        intent: 'submit',
      },
    ],
  };
  return { interaction: validateInteraction(interaction), ...linkLifetime(a.expires_in) };
}
