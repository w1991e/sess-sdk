import type { InteractiveInteraction } from '@sess.si/sdk';
import { fail, failTooLong, fallbackLabelMessage } from './errors.js';

/**
 * Adapter policy limits, at or below the runtime contract (spec 7.3). They are adapter limits,
 * not claims about the runtime's maxima. Over-limit input is rejected, never truncated.
 */
export const LIMITS = Object.freeze({
  interactionBytes: 32 * 1024,
  argumentBytes: 40 * 1024,
  depth: 8,
  components: 64,
  fields: 24,
  actions: 5,
  enumOptions: 100,
  recordFields: 50,
  maxWaitArgMs: 120_000,
});

const HANDLE_PATTERN = '^ih_[A-Za-z0-9_-]{24}$';
const EVENT_ID_PATTERN = '^[A-Za-z0-9_.:-]{1,128}$';
const HANDLE = new RegExp(HANDLE_PATTERN);
const EVENT_ID = new RegExp(EVENT_ID_PATTERN);
const FIELD_NAME = /^[a-z][a-z0-9_]{0,63}$/;
const ACTION_ID = /^[a-z][a-z0-9_]{0,31}$/;
const DANGEROUS_KEYS = new Set(['__proto__', 'constructor', 'prototype']);
/** Contract "Validation": reserved field names. */
const RESERVED_FIELD_NAMES = new Set(['constructor', 'prototype']);
/** Contract "Validation": C0 except tab/LF/CR, DEL, C1, and bidi overrides/isolates. */
const FORBIDDEN_CHARACTERS =
  /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/;
const INTENTS = new Set(['submit', 'continue', 'approve', 'reject', 'request_change']);

/**
 * Sess's length limits for what a person reads, in Unicode code points: the runtime checks the
 * same numbers and never truncates. Over one, a call is refused with its field (a JSON pointer),
 * the limit, its length and the fix.
 */
export const TEXT_LIMITS = Object.freeze({
  title: 80,
  description: 280,
  heading: 60,
  text: 4000,
  label: 60,
  optionLabel: 60,
  help: 160,
  actionLabel: 24,
  recordLabel: 200,
  recordKey: 40,
  recordValue: 200,
  /** Not shown as written (enum values, a schema's own title): the earlier runtime bounds. */
  schemaTitle: 200,
  schemaDescription: 1000,
  enumValue: 200,
});

const T = TEXT_LIMITS;
/**
 * Each human-visible string's purpose and style, one line, and examples inside its limit: exactly
 * Sess's SURFACE_TEXT_DOCS (packages/spec/src/interactive.ts), shared with the MCP tools, the SDK
 * JSDoc, the API reference and llms.txt.
 */
export const TEXT_DOCS = Object.freeze({
  title: {
    line: `The page's heading: a question or a task, about 40 characters; at most ${T.title}.`,
    examples: ['Approve the refund?', 'Pick a delivery date'],
  },
  description: {
    line: `Optional context under the title: what the person decides and why, in one or two plain sentences; at most ${T.description}.`,
    examples: ['The customer was charged twice for order 1042.'],
  },
  heading: { line: `A section heading: a few words; at most ${T.heading}.`, examples: ['Order details'] },
  text: {
    line: `A paragraph of plain text (never markup): what the person needs to know; at most ${T.text}.`,
    examples: ['The refund goes back to the card used for the order.'],
  },
  recordLabel: {
    line: `Optional caption above the record: a few words; at most ${T.recordLabel}.`,
    examples: ['Order 1042'],
  },
  recordKey: {
    line: `A row's name, shown verbatim: a word or two; at most ${T.recordKey}.`,
    examples: ['Amount'],
  },
  recordValue: {
    line: `A row's value, shown verbatim: a string of at most ${T.recordValue}, or a number, boolean or null.`,
    examples: ['$120.00'],
  },
  fieldLabel: {
    line: `What the field asks for: short, a few words; at most ${T.label}.`,
    examples: ['Refund amount'],
  },
  fieldDescription: {
    line: `Optional help under the label: one hint; at most ${T.help}.`,
    examples: ['Leave it as is to refund the full amount.'],
  },
  optionLabel: {
    line: `The words shown for one choice: short; at most ${T.optionLabel}.`,
    examples: ['Next Monday'],
  },
  actionLabel: {
    line: `A button: a verb, 1–3 words; at most ${T.actionLabel}.`,
    examples: ['Approve', 'Send refund'],
  },
});

const plainText = (max: number) =>
  ({ type: 'string', minLength: 1, maxLength: max, pattern: '\\S' }) as const;
/** A string a person reads: its purpose and style, its limit and examples within it. */
const shown = (max: number, docs: { line: string; examples: readonly string[] }) =>
  ({ ...plainText(max), description: docs.line, examples: docs.examples }) as const;

const fieldValueSchema = {
  type: 'object',
  description:
    'Restricted JSON Schema for the value: string (minLength, maxLength, enum), number/integer (minimum, maximum, exclusiveMinimum, exclusiveMaximum), boolean, or array of string enum IDs (items {type: "string", enum}, minItems, maxItems, uniqueItems: true).',
  properties: {
    type: { type: 'string', enum: ['string', 'number', 'integer', 'boolean', 'array'] },
    title: { type: 'string', maxLength: TEXT_LIMITS.schemaTitle },
    description: { type: 'string', maxLength: TEXT_LIMITS.schemaDescription },
    minLength: { type: 'integer', minimum: 0 },
    maxLength: { type: 'integer', minimum: 0 },
    enum: {
      type: 'array',
      minItems: 1,
      maxItems: LIMITS.enumOptions,
      items: { type: 'string', minLength: 1 },
    },
    minimum: { type: 'number' },
    maximum: { type: 'number' },
    exclusiveMinimum: { type: 'number' },
    exclusiveMaximum: { type: 'number' },
    items: {
      type: 'object',
      properties: {
        type: { type: 'string', enum: ['string'] },
        enum: {
          type: 'array',
          minItems: 1,
          maxItems: LIMITS.enumOptions,
          items: { type: 'string', minLength: 1 },
        },
      },
      required: ['type', 'enum'],
      additionalProperties: false,
    },
    minItems: { type: 'integer', minimum: 0 },
    maxItems: { type: 'integer', minimum: 0 },
    uniqueItems: { type: 'boolean', enum: [true] },
  },
  required: ['type'],
  additionalProperties: false,
} as const;

/** Closed JSON Schema for the existing Sess InteractiveInteraction contract (no new UI language). */
export const INTERACTION_SCHEMA = {
  type: 'object',
  description:
    'A Sess interactive Surface: plain-text components, typed fields and 1-5 actions. No HTML, scripts or styles. ' +
    'Keep it short: a person reads it on a phone. A value over its limit is refused with INVALID_ARGUMENTS naming the field (a JSON pointer), the limit, its length and the fix; nothing is truncated. Shorten that value and call again.',
  examples: [
    {
      mode: 'interactive',
      title: 'Approve this commit?',
      description: 'Check the message before I commit.',
      source: {
        kind: 'sess_surface',
        components: [
          { type: 'heading', text: 'What changed' },
          { type: 'record', label: 'Files', fields: { 'src/greeting.js': 'Greets users by first name' } },
          {
            type: 'field',
            name: 'message',
            label: 'Commit message',
            description: 'Edit it if you like.',
            multiline: true,
            schema: { type: 'string', minLength: 1, maxLength: 2000 },
            value: 'Greet users by first name',
          },
        ],
      },
      actions: [
        { id: 'approve', label: 'Approve', intent: 'approve' },
        { id: 'stop', label: 'Stop', intent: 'reject' },
      ],
    },
  ],
  properties: {
    mode: { type: 'string', enum: ['interactive'] },
    title: shown(TEXT_LIMITS.title, TEXT_DOCS.title),
    description: {
      type: 'string',
      maxLength: TEXT_LIMITS.description,
      description: TEXT_DOCS.description.line,
      examples: TEXT_DOCS.description.examples,
    },
    source: {
      type: 'object',
      properties: {
        kind: { type: 'string', enum: ['sess_surface'] },
        components: {
          type: 'array',
          minItems: 1,
          maxItems: LIMITS.components,
          items: {
            anyOf: [
              {
                type: 'object',
                properties: {
                  type: { type: 'string', enum: ['heading'] },
                  text: shown(TEXT_LIMITS.heading, TEXT_DOCS.heading),
                },
                required: ['type', 'text'],
                additionalProperties: false,
              },
              {
                type: 'object',
                properties: {
                  type: { type: 'string', enum: ['text'] },
                  text: {
                    type: 'string',
                    minLength: 1,
                    maxLength: TEXT_LIMITS.text,
                    description: TEXT_DOCS.text.line,
                    examples: TEXT_DOCS.text.examples,
                  },
                },
                required: ['type', 'text'],
                additionalProperties: false,
              },
              {
                type: 'object',
                properties: {
                  type: { type: 'string', enum: ['record'] },
                  label: shown(TEXT_LIMITS.recordLabel, TEXT_DOCS.recordLabel),
                  fields: {
                    type: 'object',
                    description: `Rows shown verbatim, 1-${LIMITS.recordFields}. Each key: ${TEXT_DOCS.recordKey.line}`,
                    minProperties: 1,
                    maxProperties: LIMITS.recordFields,
                    // maxLength applies to string values only; keys are checked on every call.
                    additionalProperties: {
                      type: ['string', 'number', 'boolean', 'null'],
                      maxLength: TEXT_LIMITS.recordValue,
                      description: TEXT_DOCS.recordValue.line,
                      examples: TEXT_DOCS.recordValue.examples,
                    },
                    examples: [{ Amount: '$120.00' }],
                  },
                },
                required: ['type', 'fields'],
                additionalProperties: false,
              },
              {
                type: 'object',
                properties: {
                  type: { type: 'string', enum: ['field'] },
                  name: { type: 'string', pattern: FIELD_NAME.source },
                  label: shown(TEXT_LIMITS.label, TEXT_DOCS.fieldLabel),
                  description: {
                    type: 'string',
                    maxLength: TEXT_LIMITS.help,
                    description: TEXT_DOCS.fieldDescription.line,
                    examples: TEXT_DOCS.fieldDescription.examples,
                  },
                  required: { type: 'boolean' },
                  multiline: { type: 'boolean' },
                  option_labels: {
                    type: 'object',
                    description:
                      'Display labels for enum values. A value without a label is shown as written, so it is then held to 60 characters too; give a long ID a short label.',
                    maxProperties: LIMITS.enumOptions,
                    additionalProperties: shown(TEXT_LIMITS.optionLabel, TEXT_DOCS.optionLabel),
                  },
                  schema: fieldValueSchema,
                  value: { description: 'Proposed value; must be valid against schema.' },
                },
                required: ['type', 'name', 'label', 'schema'],
                additionalProperties: false,
              },
            ],
          },
        },
      },
      required: ['kind', 'components'],
      additionalProperties: false,
    },
    actions: {
      type: 'array',
      minItems: 1,
      maxItems: LIMITS.actions,
      items: {
        type: 'object',
        properties: {
          id: { type: 'string', pattern: ACTION_ID.source },
          label: shown(TEXT_LIMITS.actionLabel, TEXT_DOCS.actionLabel),
          intent: { type: 'string', enum: [...INTENTS] },
        },
        required: ['id', 'label'],
        additionalProperties: false,
      },
    },
    response_policy: { type: 'string', enum: ['first'] },
  },
  required: ['mode', 'title', 'source', 'actions'],
  additionalProperties: false,
} as const;

const handle = {
  type: 'string',
  pattern: HANDLE_PATTERN,
  description: 'Opaque handle returned by sess_request.',
};
const revision = { type: 'integer', minimum: 1, maximum: 999_999_999 };
const eventId = { type: 'string', pattern: EVENT_ID_PATTERN };

/** Versioned, closed tool parameter schemas (tool schema version 1). */
export const TOOL_PARAMETERS = {
  sess_request: {
    type: 'object',
    properties: { interaction: INTERACTION_SCHEMA },
    required: ['interaction'],
    additionalProperties: false,
  },
  sess_response: {
    type: 'object',
    properties: {
      handle,
      revision: { ...revision, description: 'The exact Surface revision whose answer you want.' },
      wait_ms: {
        type: 'integer',
        minimum: 0,
        maximum: LIMITS.maxWaitArgMs,
        description:
          'Optional bounded wait. Omit for the configured default; 0 reads once without waiting. The plugin clamps it to its configured budget.',
      },
    },
    required: ['handle', 'revision'],
    additionalProperties: false,
  },
  sess_publish: {
    type: 'object',
    properties: {
      handle,
      expected_revision: revision,
      response_event_id: { ...eventId, description: 'eventId of the verified answer this revision follows.' },
      interaction: INTERACTION_SCHEMA,
    },
    required: ['handle', 'expected_revision', 'response_event_id', 'interaction'],
    additionalProperties: false,
  },
  sess_complete: {
    type: 'object',
    properties: { handle, expected_revision: revision, response_event_id: eventId },
    required: ['handle', 'expected_revision', 'response_event_id'],
    additionalProperties: false,
  },
} as const;

export type ToolName = keyof typeof TOOL_PARAMETERS;

// ---- Programmatic validation (the host's schema check is not relied upon; a cast is not validation).

function invalid(path: string, message: string): never {
  return fail('INVALID_ARGUMENTS', `${path}: ${message}`);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

/** Rejects non-JSON values, accessors, cycles, dangerous keys and excessive depth. */
function assertJson(value: unknown, path: string, depth: number, seen: Set<object>): void {
  if (typeof value === 'string') {
    if (FORBIDDEN_CHARACTERS.test(value))
      invalid(path, 'control or bidirectional-override characters are not accepted.');
    return;
  }
  if (value === null || typeof value === 'boolean') return;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) invalid(path, 'numbers must be finite.');
    return;
  }
  if (typeof value !== 'object') invalid(path, 'only JSON values are accepted.');
  if (depth > LIMITS.depth) invalid(path, `nesting deeper than ${LIMITS.depth} is not accepted.`);
  if (seen.has(value)) invalid(path, 'cyclic values are not accepted.');
  seen.add(value);
  if (Array.isArray(value)) {
    for (const key of Reflect.ownKeys(value))
      if (key !== 'length' && (typeof key !== 'string' || !/^(0|[1-9][0-9]*)$/.test(key)))
        invalid(path, 'arrays must not carry extra properties.');
    value.forEach((item, index) => assertJson(item, `${path}[${index}]`, depth + 1, seen));
  } else {
    if (!isPlainObject(value)) invalid(path, 'only plain JSON objects are accepted.');
    for (const key of Reflect.ownKeys(value)) {
      if (typeof key !== 'string') invalid(path, 'symbol keys are not accepted.');
      if (DANGEROUS_KEYS.has(key)) invalid(path, 'unsafe object key.');
      if (FORBIDDEN_CHARACTERS.test(key))
        invalid(path, 'control or bidirectional-override characters are not accepted.');
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (!descriptor || !('value' in descriptor) || !descriptor.enumerable)
        invalid(path, 'accessor or hidden properties are not accepted.');
      assertJson(descriptor.value, `${path}.${key}`, depth + 1, seen);
    }
  }
  seen.delete(value);
}

function closed(value: unknown, path: string, allowed: readonly string[], required: readonly string[]) {
  if (!isPlainObject(value)) invalid(path, 'must be an object.');
  for (const key of Object.keys(value))
    if (!allowed.includes(key)) invalid(path, `unknown property "${key}".`);
  for (const key of required) if (!(key in value)) invalid(path, `missing "${key}".`);
  return value;
}

/** `interaction.actions[0].label` → `/interaction/actions/0/label` (plain identifier segments only). */
function pointer(path: string, key?: string): string {
  const base = `/${path
    .replace(/\[(\d+)\]/g, '.$1')
    .split('.')
    .join('/')}`;
  // A record key or option value ends the pointer as Sess's does (RFC 6901 escaped).
  return key === undefined ? base : `${base}/${key.replace(/~/g, '~0').replace(/\//g, '~1')}`;
}

function str(
  value: unknown,
  path: string,
  min: number,
  max: number,
  nonBlank = false,
  field = pointer(path),
): string {
  if (typeof value !== 'string') invalid(path, `must be a string of ${min}-${max} characters.`);
  // Counted in Unicode code points, as Sess counts them; nothing is ever truncated.
  const length = [...value].length;
  if (length > max) failTooLong(field, max, length);
  if (length < min) invalid(path, `must be a string of ${min}-${max} characters.`);
  if (FORBIDDEN_CHARACTERS.test(value))
    invalid(path, 'control or bidirectional-override characters are not accepted.');
  if (nonBlank && !/\S/.test(value)) invalid(path, 'must not be blank.');
  return value;
}

function int(value: unknown, path: string, min: number, max: number): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < min || value > max)
    invalid(path, `must be an integer from ${min} to ${max}.`);
  return value;
}

function bool(value: unknown, path: string): void {
  if (typeof value !== 'boolean') invalid(path, 'must be a boolean.');
}

function finiteNumber(value: unknown, path: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) invalid(path, 'must be a finite number.');
  return value;
}

function enumList(value: unknown, path: string): string[] {
  if (!Array.isArray(value) || value.length < 1 || value.length > LIMITS.enumOptions)
    invalid(path, `must list 1-${LIMITS.enumOptions} options.`);
  const list = value.map((item, index) => str(item, `${path}[${index}]`, 1, TEXT_LIMITS.enumValue, true));
  if (new Set(list).size !== list.length) invalid(path, 'options must be unique.');
  return list;
}

interface CheckedFieldSchema {
  type: 'string' | 'number' | 'integer' | 'boolean' | 'array';
  options?: string[];
  check(value: unknown, path: string): void;
}

function fieldSchema(value: unknown, path: string): CheckedFieldSchema {
  const base = ['type', 'title', 'description'];
  const raw = closed(
    value,
    path,
    [
      ...base,
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
    ],
    ['type'],
  );
  const type = raw.type;
  if (raw.title !== undefined) str(raw.title, `${path}.title`, 0, TEXT_LIMITS.schemaTitle);
  if (raw.description !== undefined)
    str(raw.description, `${path}.description`, 0, TEXT_LIMITS.schemaDescription);
  const only = (keys: string[]) => {
    for (const key of Object.keys(raw))
      if (![...base, ...keys].includes(key))
        invalid(path, `"${key}" is not allowed for type ${String(type)}.`);
  };
  if (type === 'string') {
    only(['minLength', 'maxLength', 'enum']);
    const minLength = raw.minLength === undefined ? 0 : int(raw.minLength, `${path}.minLength`, 0, 100_000);
    const maxLength =
      raw.maxLength === undefined ? Infinity : int(raw.maxLength, `${path}.maxLength`, 0, 100_000);
    if (minLength > maxLength) invalid(path, 'minLength exceeds maxLength.');
    const options = raw.enum === undefined ? undefined : enumList(raw.enum, `${path}.enum`);
    return {
      type,
      ...(options ? { options } : {}),
      check(v, p) {
        if (typeof v !== 'string' || v.length < minLength || v.length > maxLength)
          invalid(p, 'value does not satisfy the field schema.');
        if (options && !options.includes(v)) invalid(p, 'value is not one of the declared options.');
      },
    };
  }
  if (type === 'number' || type === 'integer') {
    only(['minimum', 'maximum', 'exclusiveMinimum', 'exclusiveMaximum']);
    const bound = (key: string) =>
      raw[key] === undefined ? undefined : finiteNumber(raw[key], `${path}.${key}`);
    const [min, max, xmin, xmax] = ['minimum', 'maximum', 'exclusiveMinimum', 'exclusiveMaximum'].map(bound);
    return {
      type,
      check(v, p) {
        if (typeof v !== 'number' || !Number.isFinite(v) || (type === 'integer' && !Number.isInteger(v)))
          invalid(p, 'value does not satisfy the field schema.');
        if (
          (min !== undefined && v < min) ||
          (max !== undefined && v > max) ||
          (xmin !== undefined && v <= xmin) ||
          (xmax !== undefined && v >= xmax)
        )
          invalid(p, 'value is outside the field bounds.');
      },
    };
  }
  if (type === 'boolean') {
    only([]);
    return { type, check: (v, p) => void (typeof v !== 'boolean' && invalid(p, 'value must be a boolean.')) };
  }
  if (type === 'array') {
    only(['items', 'minItems', 'maxItems', 'uniqueItems']);
    const items = closed(raw.items, `${path}.items`, ['type', 'enum'], ['type', 'enum']);
    if (items.type !== 'string') invalid(`${path}.items.type`, 'must be "string".');
    const options = enumList(items.enum, `${path}.items.enum`);
    const minItems =
      raw.minItems === undefined ? 0 : int(raw.minItems, `${path}.minItems`, 0, LIMITS.enumOptions);
    const maxItems =
      raw.maxItems === undefined
        ? LIMITS.enumOptions
        : int(raw.maxItems, `${path}.maxItems`, 0, LIMITS.enumOptions);
    if (minItems > maxItems) invalid(path, 'minItems exceeds maxItems.');
    if (raw.uniqueItems !== undefined && raw.uniqueItems !== true)
      invalid(`${path}.uniqueItems`, 'only true is supported.');
    return {
      type,
      options,
      check(v, p) {
        if (!Array.isArray(v) || v.length < minItems || v.length > maxItems)
          invalid(p, 'value does not satisfy the field schema.');
        for (const item of v)
          if (typeof item !== 'string' || !options.includes(item))
            invalid(p, 'value contains an undeclared option.');
        if (raw.uniqueItems === true && new Set(v).size !== v.length) invalid(p, 'value repeats an option.');
      },
    };
  }
  return invalid(`${path}.type`, 'must be string, number, integer, boolean or array.');
}

/** Validates an InteractiveInteraction before any network dispatch. */
export function validateInteraction(value: unknown, path = 'interaction'): InteractiveInteraction {
  const top = closed(
    value,
    path,
    ['mode', 'title', 'description', 'source', 'actions', 'response_policy'],
    ['mode', 'title', 'source', 'actions'],
  );
  if (top.mode !== 'interactive') invalid(`${path}.mode`, 'must be "interactive".');
  str(top.title, `${path}.title`, 1, TEXT_LIMITS.title, true);
  if (top.description !== undefined) str(top.description, `${path}.description`, 0, TEXT_LIMITS.description);
  if (top.response_policy !== undefined && top.response_policy !== 'first')
    invalid(`${path}.response_policy`, 'must be "first".');
  const source = closed(top.source, `${path}.source`, ['kind', 'components'], ['kind', 'components']);
  if (source.kind !== 'sess_surface') invalid(`${path}.source.kind`, 'must be "sess_surface".');
  const components = source.components;
  if (!Array.isArray(components) || components.length < 1 || components.length > LIMITS.components)
    invalid(`${path}.source.components`, `must contain 1-${LIMITS.components} components.`);
  const names = new Set<string>();
  components.forEach((component, index) => {
    const at = `${path}.source.components[${index}]`;
    if (!isPlainObject(component)) invalid(at, 'must be an object.');
    switch (component.type) {
      case 'heading':
        closed(component, at, ['type', 'text'], ['type', 'text']);
        str(component.text, `${at}.text`, 1, TEXT_LIMITS.heading, true);
        break;
      case 'text':
        closed(component, at, ['type', 'text'], ['type', 'text']);
        str(component.text, `${at}.text`, 1, TEXT_LIMITS.text);
        break;
      case 'record': {
        closed(component, at, ['type', 'label', 'fields'], ['type', 'fields']);
        if (component.label !== undefined)
          str(component.label, `${at}.label`, 1, TEXT_LIMITS.recordLabel, true);
        if (!isPlainObject(component.fields)) invalid(`${at}.fields`, 'must be an object.');
        const entries = Object.entries(component.fields);
        if (entries.length < 1 || entries.length > LIMITS.recordFields)
          invalid(`${at}.fields`, `must have 1-${LIMITS.recordFields} entries.`);
        for (const [key, item] of entries) {
          str(key, `${at}.fields key`, 1, TEXT_LIMITS.recordKey, true, pointer(`${at}.fields`, key));
          if (!(
            item === null ||
            typeof item === 'string' ||
            typeof item === 'boolean' ||
            (typeof item === 'number' && Number.isFinite(item))
          ))
            invalid(`${at}.fields`, 'values must be strings, finite numbers, booleans or null.');
          if (typeof item === 'string')
            str(item, `${at}.fields value`, 0, TEXT_LIMITS.recordValue, false, pointer(`${at}.fields`, key));
        }
        break;
      }
      case 'field': {
        closed(
          component,
          at,
          [
            'type',
            'name',
            'label',
            'description',
            'required',
            'multiline',
            'option_labels',
            'schema',
            'value',
          ],
          ['type', 'name', 'label', 'schema'],
        );
        const name = component.name;
        if (typeof name !== 'string' || !FIELD_NAME.test(name))
          invalid(`${at}.name`, 'must match ^[a-z][a-z0-9_]{0,63}$.');
        if (RESERVED_FIELD_NAMES.has(name)) invalid(`${at}.name`, `"${name}" is a reserved field name.`);
        if (names.has(name)) invalid(`${at}.name`, 'field names must be unique.');
        names.add(name);
        str(component.label, `${at}.label`, 1, TEXT_LIMITS.label, true);
        if (component.description !== undefined)
          str(component.description, `${at}.description`, 0, TEXT_LIMITS.help);
        if (component.required !== undefined) bool(component.required, `${at}.required`);
        if (component.multiline !== undefined) bool(component.multiline, `${at}.multiline`);
        const schema = fieldSchema(component.schema, `${at}.schema`);
        if (component.multiline === true && schema.type !== 'string')
          invalid(`${at}.multiline`, 'only string fields can be multiline.');
        if (component.option_labels !== undefined) {
          if (!schema.options) invalid(`${at}.option_labels`, 'requires declared enum options.');
          if (!isPlainObject(component.option_labels)) invalid(`${at}.option_labels`, 'must be an object.');
          for (const [key, label] of Object.entries(component.option_labels)) {
            if (!schema.options.includes(key))
              invalid(`${at}.option_labels`, 'labels a value that is not a declared option.');
            str(
              label,
              `${at}.option_labels.${key}`,
              1,
              TEXT_LIMITS.optionLabel,
              true,
              pointer(`${at}.option_labels`, key),
            );
          }
        }
        // The words shown for a choice are its label, otherwise the enum ID itself: an unlabelled ID
        // is held to the option-label limit and named at its enum entry. A long opaque ID with a
        // short label stays legal (IDs keep their own 200 bound).
        if (schema.options) {
          const labels = isPlainObject(component.option_labels) ? component.option_labels : {};
          const enumAt = schema.type === 'array' ? `${at}.schema.items.enum` : `${at}.schema.enum`;
          schema.options.forEach((id, index) => {
            if (Object.hasOwn(labels, id)) return;
            const length = [...id].length;
            if (length > TEXT_LIMITS.optionLabel)
              failTooLong(
                pointer(`${enumAt}[${index}]`),
                TEXT_LIMITS.optionLabel,
                length,
                fallbackLabelMessage,
              );
          });
        }
        if ('value' in component) schema.check(component.value, `${at}.value`);
        break;
      }
      default:
        invalid(`${at}.type`, 'must be heading, text, record or field.');
    }
  });
  if (names.size > LIMITS.fields)
    invalid(`${path}.source.components`, `at most ${LIMITS.fields} fields are accepted.`);
  const actions = top.actions;
  if (!Array.isArray(actions) || actions.length < 1 || actions.length > LIMITS.actions)
    invalid(`${path}.actions`, `must contain 1-${LIMITS.actions} actions.`);
  const ids = new Set<string>();
  actions.forEach((action, index) => {
    const at = `${path}.actions[${index}]`;
    const checked = closed(action, at, ['id', 'label', 'intent'], ['id', 'label']);
    if (typeof checked.id !== 'string' || !ACTION_ID.test(checked.id))
      invalid(`${at}.id`, 'must match ^[a-z][a-z0-9_]{0,31}$.');
    if (ids.has(checked.id)) invalid(`${at}.id`, 'action IDs must be unique.');
    ids.add(checked.id);
    str(checked.label, `${at}.label`, 1, TEXT_LIMITS.actionLabel, true);
    if (checked.intent !== undefined && (typeof checked.intent !== 'string' || !INTENTS.has(checked.intent)))
      invalid(`${at}.intent`, 'unsupported intent.');
  });
  if (Buffer.byteLength(JSON.stringify(value), 'utf8') > LIMITS.interactionBytes)
    invalid(path, `exceeds ${LIMITS.interactionBytes} bytes serialized; nothing was truncated or sent.`);
  return value as InteractiveInteraction;
}

/** Copies arguments into fresh JSON after structural checks; later caller mutation has no effect. */
function snapshot(value: unknown, root: string): Record<string, unknown> {
  assertJson(value, root, 0, new Set());
  const text = JSON.stringify(value);
  if (Buffer.byteLength(text, 'utf8') > LIMITS.argumentBytes)
    invalid(root, `arguments exceed ${LIMITS.argumentBytes} bytes; nothing was truncated or sent.`);
  return JSON.parse(text) as Record<string, unknown>;
}

export interface RequestArgs {
  interaction: InteractiveInteraction;
}
export interface ResponseArgs {
  handle: string;
  revision: number;
  wait_ms?: number;
}
export interface PublishArgs {
  handle: string;
  expected_revision: number;
  response_event_id: string;
  interaction: InteractiveInteraction;
}
export interface CompleteArgs {
  handle: string;
  expected_revision: number;
  response_event_id: string;
}

function handleArg(value: unknown, path: string): string {
  if (typeof value !== 'string' || !HANDLE.test(value))
    invalid(path, 'must be a handle returned by sess_request.');
  return value;
}
function eventArg(value: unknown, path: string): string {
  if (typeof value !== 'string' || !EVENT_ID.test(value))
    invalid(path, 'must be the eventId of a verified answer.');
  return value;
}

export function parseRequestArgs(raw: unknown): RequestArgs {
  const args = closed(snapshot(raw, 'arguments'), 'arguments', ['interaction'], ['interaction']);
  return { interaction: validateInteraction(args.interaction) };
}

export function parseResponseArgs(raw: unknown): ResponseArgs {
  const args = closed(
    snapshot(raw, 'arguments'),
    'arguments',
    ['handle', 'revision', 'wait_ms'],
    ['handle', 'revision'],
  );
  return {
    handle: handleArg(args.handle, 'handle'),
    revision: int(args.revision, 'revision', 1, 999_999_999),
    ...(args.wait_ms !== undefined ? { wait_ms: int(args.wait_ms, 'wait_ms', 0, LIMITS.maxWaitArgMs) } : {}),
  };
}

export function parsePublishArgs(raw: unknown): PublishArgs {
  const keys = ['handle', 'expected_revision', 'response_event_id', 'interaction'];
  const args = closed(snapshot(raw, 'arguments'), 'arguments', keys, keys);
  return {
    handle: handleArg(args.handle, 'handle'),
    expected_revision: int(args.expected_revision, 'expected_revision', 1, 999_999_999),
    response_event_id: eventArg(args.response_event_id, 'response_event_id'),
    interaction: validateInteraction(args.interaction),
  };
}

export function parseCompleteArgs(raw: unknown): CompleteArgs {
  const keys = ['handle', 'expected_revision', 'response_event_id'];
  const args = closed(snapshot(raw, 'arguments'), 'arguments', keys, keys);
  return {
    handle: handleArg(args.handle, 'handle'),
    expected_revision: int(args.expected_revision, 'expected_revision', 1, 999_999_999),
    response_event_id: eventArg(args.response_event_id, 'response_event_id'),
  };
}

export const PATTERNS = Object.freeze({ handle: HANDLE, eventId: EVENT_ID });
