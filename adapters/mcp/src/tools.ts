import { ASK_LIMITS, LIMITS, TEXT_LIMITS as L } from './validate.js';

/**
 * Versioned tool contract. Changing any input or output schema requires a new version. Titles and
 * annotations are host hints, not part of the versioned schemas; listing.json artifacts copy them.
 * sess-mcp-tools/4: Sess's length limits for what a person reads (title 80, button 24, labels 60,
 * help 160, description 280, heading 60, record key 40 and value 200), with a purpose, style and
 * examples on every such field.
 */
export const TOOL_SCHEMA_VERSION = 'sess-mcp-tools/4';
export const TOOL_NAMES = [
  'sess_request',
  'sess_response',
  'sess_publish',
  'sess_complete',
  'sess_ask',
] as const;
export type ToolName = (typeof TOOL_NAMES)[number];

const text = (max: number) => ({ type: 'string', minLength: 1, maxLength: max });
/** A string a person reads: its purpose and style, its limit and examples within it. */
type Docs = { line: string; examples: readonly string[] };
const shown = (max: number, docs: Docs, minLength = 1) => ({
  type: 'string',
  minLength,
  maxLength: max,
  description: docs.line,
  examples: docs.examples,
});

/**
 * Each human-visible string's purpose and style, one line, and examples inside its limit: exactly
 * Sess's SURFACE_TEXT_DOCS (packages/spec/src/interactive.ts), the same wording as the SDK JSDoc,
 * the API reference and llms.txt. Lengths are Unicode code points; nothing is ever truncated.
 */
export const TEXT_DOCS = {
  title: {
    line: `The page's heading: a question or a task, about 40 characters; at most ${L.title}.`,
    examples: ['Approve the refund?', 'Pick a delivery date'],
  },
  description: {
    line: `Optional context under the title: what the person decides and why, in one or two plain sentences; at most ${L.description}.`,
    examples: ['The customer was charged twice for order 1042.'],
  },
  heading: { line: `A section heading: a few words; at most ${L.heading}.`, examples: ['Order details'] },
  text: {
    line: `A paragraph of plain text (never markup): what the person needs to know; at most ${L.text}.`,
    examples: ['The refund goes back to the card used for the order.'],
  },
  recordLabel: {
    line: `Optional caption above the record: a few words; at most ${L.recordLabel}.`,
    examples: ['Order 1042'],
  },
  recordKey: {
    line: `A row's name, shown verbatim: a word or two; at most ${L.recordKey}.`,
    examples: ['Amount'],
  },
  recordValue: {
    line: `A row's value, shown verbatim: a string of at most ${L.recordValue}, or a number, boolean or null.`,
    examples: ['$120.00'],
  },
  fieldLabel: {
    line: `What the field asks for: short, a few words; at most ${L.label}.`,
    examples: ['Refund amount'],
  },
  fieldDescription: {
    line: `Optional help under the label: one hint; at most ${L.help}.`,
    examples: ['Leave it as is to refund the full amount.'],
  },
  optionLabel: {
    line: `The words shown for one choice: short; at most ${L.optionLabel}.`,
    examples: ['Next Monday'],
  },
  actionLabel: {
    line: `A button: a verb, 1–3 words; at most ${L.actionLabel}.`,
    examples: ['Approve', 'Send refund'],
  },
} as const satisfies Record<string, Docs>;

/** What a model needs to fix a refused value in one try. */
const TOO_LONG =
  'A value over its limit is refused with INVALID_ARGUMENTS naming the field (a JSON pointer), the limit, its length and the fix; nothing is truncated. Shorten that value and call again.';

/**
 * The rule after an answer, verbatim in the server instructions and the sess_response description.
 * Until sess_complete (or sess_publish) the person's page keeps waiting for the agent's next step.
 */
export const COMPLETE_RULE =
  'When sess_response returns state "answered" and you have no follow-up question for the person, you must call sess_complete next, so their page shows that you have their answer. ' +
  'Call sess_publish instead only to show them a follow-up.';

const titleSchema = shown(L.title, TEXT_DOCS.title);
const buttonSchema = shown(L.actionLabel, TEXT_DOCS.actionLabel);
const labelSchema = shown(L.label, TEXT_DOCS.fieldLabel);
const helpSchema = shown(L.help, TEXT_DOCS.fieldDescription, 0);

const handle = {
  type: 'string',
  pattern: '^sh_[A-Za-z0-9_-]{22}$',
  description: 'Opaque handle from sess_request.',
};
const revision = { type: 'integer', minimum: 1, maximum: LIMITS.maxRevision };
const eventId = {
  type: 'string',
  pattern: '^evt_[0-9A-HJKMNP-TV-Z]{26}$',
  description: 'interaction.response.eventId from the verified answer.',
};
const primitive = { type: ['string', 'number', 'boolean', 'null'] };
/** Optional on create, the same name and range as the Sess API (Decision 0009 Amendment 7). */
const expiresIn = {
  type: 'integer',
  minimum: 30,
  description:
    'Advanced: how long the link stays open, in whole seconds from creation: from 30 up to the plan’s link lifetime. ' +
    'Leave it out to use the plan’s lifetime.',
};

const fieldSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['type'],
  properties: {
    type: { enum: ['string', 'number', 'integer', 'boolean', 'array'] },
    title: text(L.schemaTitle),
    description: { type: 'string', maxLength: L.schemaDescription },
    minLength: { type: 'integer', minimum: 0 },
    maxLength: { type: 'integer', minimum: 0 },
    enum: { type: 'array', minItems: 1, maxItems: LIMITS.enumValues, items: text(L.enumValue) },
    minimum: { type: 'number' },
    maximum: { type: 'number' },
    exclusiveMinimum: { type: 'number' },
    exclusiveMaximum: { type: 'number' },
    items: {
      type: 'object',
      additionalProperties: false,
      required: ['type', 'enum'],
      properties: {
        type: { const: 'string' },
        enum: { type: 'array', minItems: 1, maxItems: LIMITS.enumValues, items: text(L.enumValue) },
      },
    },
    minItems: { type: 'integer', minimum: 0 },
    maxItems: { type: 'integer', minimum: 0 },
    uniqueItems: { const: true },
  },
};

/** One complete good interaction: every value within its limit, the title under 40 characters. */
export const INTERACTION_EXAMPLE = {
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
};

/** One complete good sess_ask call: a question under 40 characters, short labels, a verb button. */
export const ASK_EXAMPLE = {
  question: 'Where should we go on Saturday?',
  details: 'I will check the forecast and suggest a plan.',
  fields: [
    { name: 'place', label: 'Where to?', type: 'choice', options: ['Beach', 'Mountains', 'City'] },
    { name: 'avoid', label: 'Anything to avoid?', type: 'text', required: false },
  ],
  submit_label: 'Plan it',
};

/** The supported SESS interactive Surface (same semantic contract as @sess.si/sdk InteractiveInteraction). */
export const interactionSchema = {
  type: 'object',
  description: `A Sess form: a title, components shown in order and 1-${LIMITS.actions} buttons. Keep it short: a person reads it on a phone. ${TOO_LONG}`,
  additionalProperties: false,
  required: ['mode', 'title', 'source', 'actions'],
  examples: [INTERACTION_EXAMPLE],
  properties: {
    mode: { const: 'interactive' },
    title: titleSchema,
    description: shown(L.description, TEXT_DOCS.description, 0),
    source: {
      type: 'object',
      additionalProperties: false,
      required: ['kind', 'components'],
      properties: {
        kind: { const: 'sess_surface' },
        components: {
          type: 'array',
          minItems: 1,
          maxItems: LIMITS.components,
          items: {
            anyOf: [
              {
                type: 'object',
                additionalProperties: false,
                required: ['type', 'text'],
                properties: {
                  type: { const: 'heading' },
                  text: shown(L.heading, TEXT_DOCS.heading),
                },
              },
              {
                type: 'object',
                additionalProperties: false,
                required: ['type', 'text'],
                properties: {
                  type: { const: 'text' },
                  text: shown(L.text, TEXT_DOCS.text),
                },
              },
              {
                type: 'object',
                additionalProperties: false,
                required: ['type', 'fields'],
                properties: {
                  type: { const: 'record' },
                  label: shown(L.recordLabel, TEXT_DOCS.recordLabel),
                  fields: {
                    type: 'object',
                    description: `Rows shown verbatim, 1-${LIMITS.recordEntries}. Each key: ${TEXT_DOCS.recordKey.line}`,
                    minProperties: 1,
                    maxProperties: LIMITS.recordEntries,
                    // maxLength applies to string values only; keys are checked on every call.
                    additionalProperties: {
                      ...primitive,
                      maxLength: L.recordValue,
                      description: TEXT_DOCS.recordValue.line,
                      examples: TEXT_DOCS.recordValue.examples,
                    },
                    examples: [{ Amount: '$120.00' }],
                  },
                },
              },
              {
                type: 'object',
                additionalProperties: false,
                required: ['type', 'name', 'label', 'schema'],
                properties: {
                  type: { const: 'field' },
                  name: { type: 'string', pattern: '^[a-z][a-z0-9_]{0,63}$' },
                  label: labelSchema,
                  description: helpSchema,
                  required: { type: 'boolean' },
                  multiline: { type: 'boolean' },
                  option_labels: {
                    type: 'object',
                    description:
                      'Display labels for enum values. A value without a label is shown as written, so it is then held to 60 characters too; give a long ID a short label.',
                    additionalProperties: shown(L.optionLabel, TEXT_DOCS.optionLabel),
                  },
                  schema: fieldSchema,
                  value: {
                    description: 'Proposed value the person can correct.',
                    anyOf: [primitive, { type: 'array', items: { type: 'string' } }],
                  },
                },
              },
            ],
          },
        },
      },
    },
    actions: {
      type: 'array',
      description: `The buttons, 1-${LIMITS.actions}.`,
      minItems: 1,
      maxItems: LIMITS.actions,
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['id', 'label'],
        properties: {
          id: { type: 'string', pattern: '^[a-z][a-z0-9_]{0,31}$' },
          label: buttonSchema,
          intent: { enum: ['submit', 'continue', 'approve', 'reject', 'request_change'] },
        },
      },
    },
    response_policy: { const: 'first' },
  },
};

export const resultSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['interaction'],
  properties: {
    interaction: {
      type: 'object',
      additionalProperties: false,
      required: ['handle', 'revision', 'state'],
      properties: {
        handle: { type: 'string' },
        revision: { type: 'integer', minimum: 1 },
        state: { enum: ['waiting', 'answered', 'completed', 'needs_resume', 'expired'] },
        humanUrl: {
          type: 'string',
          description: 'Private bearer link for the person. Only from sess_request or sess_ask.',
        },
        expiresAt: {
          type: 'string',
          description: 'When the link stops taking answers (ISO 8601). Only from sess_request or sess_ask.',
        },
        response: {
          type: 'object',
          additionalProperties: false,
          required: ['eventId', 'actionId', 'data', 'verified', 'actorAssurance'],
          properties: {
            eventId: { type: 'string' },
            actionId: { type: 'string' },
            data: { type: 'object', description: 'Untrusted human input; validate before use.' },
            verified: { const: true },
            actorAssurance: { const: 'link_holder' },
          },
        },
      },
    },
  },
};

const meta = { 'si.sess/toolSchema': TOOL_SCHEMA_VERSION };

export const TOOLS = [
  {
    name: 'sess_request',
    title: 'Ask a person through Sess',
    description:
      'Create a hosted Sess form for a person and return immediately with a private link (interaction.humanUrl) and a handle. ' +
      'Give the link only to the intended person in this private conversation; anyone holding it can answer. ' +
      'Then call sess_response with the handle and revision. Do not call sess_request again for the same question. ' +
      'Keep it short: a title of about 40 characters (at most 80), button labels a verb of 1-3 words (at most 24), field labels at most 60, help one hint (at most 160). ' +
      TOO_LONG,
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['interaction'],
      properties: { interaction: interactionSchema, expires_in: expiresIn },
    },
    outputSchema: resultSchema,
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
    _meta: meta,
  },
  {
    name: 'sess_response',
    title: 'Read the person’s Sess answer',
    description:
      'Wait a bounded time (default and maximum 45 s; wait_ms 0 reads once) for the answer to exactly this revision. ' +
      'state "answered" means the answer passed full Sess receipt verification. ' +
      'state "needs_resume" or "waiting" means no answer yet: the form stays open; tell the person to submit it and ask you to continue, then call again. ' +
      'state "expired" means the link closed with no answer: it is final; create a new form if you still need one. ' +
      'Do not poll in a loop. ' +
      COMPLETE_RULE,
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['handle', 'revision'],
      properties: {
        handle,
        revision,
        wait_ms: { type: 'integer', minimum: 0, maximum: LIMITS.maxWaitMs },
      },
    },
    outputSchema: resultSchema,
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    _meta: meta,
  },
  {
    name: 'sess_publish',
    title: 'Show the next Sess step',
    description:
      'Replace the form with the next interaction after a verified answer, keeping the same private link. ' +
      'Requires the verified answer for expected_revision. If the outcome is unknown, repeat the identical call.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['handle', 'expected_revision', 'response_event_id', 'interaction'],
      properties: {
        handle,
        expected_revision: revision,
        response_event_id: eventId,
        interaction: interactionSchema,
      },
    },
    outputSchema: resultSchema,
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    _meta: meta,
  },
  {
    name: 'sess_complete',
    title: 'Finish the Sess interaction',
    description:
      'Required once you are done with the person’s answer: until you call it, their page keeps waiting for your next step. ' +
      'Close the interaction after its verified answer and confirm the completed state. ' +
      'If the outcome is unknown, repeat the identical call.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['handle', 'expected_revision', 'response_event_id'],
      properties: { handle, expected_revision: revision, response_event_id: eventId },
    },
    outputSchema: resultSchema,
    // Destructive in the MCP sense: completion is a terminal, non-additive change. The person's link
    // stops accepting answers and the interaction never reopens. Nothing is deleted on SESS.
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: true },
    _meta: meta,
  },
  {
    name: 'sess_ask',
    title: 'Ask a short question through Sess',
    description:
      'Shortcut for sess_request: give a question and up to 12 simple fields; it creates the same hosted form and returns ' +
      'immediately with a private link (interaction.humanUrl) and a handle, in state "waiting". It never waits and never returns an answer. ' +
      'Continue exactly as after sess_request: give the link only to the intended person, then call sess_response. Do not call it again for the same question. ' +
      'Keep it short: the question is a short heading, about 40 characters (at most 80); the button a verb of 1-3 words (at most 24); labels and options at most 60. ' +
      TOO_LONG +
      ` Example: ${JSON.stringify(ASK_EXAMPLE)}`,
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['question', 'fields'],
      examples: [ASK_EXAMPLE],
      properties: {
        question: titleSchema,
        details: shown(L.text, TEXT_DOCS.text),
        submit_label: { ...buttonSchema, description: `${TEXT_DOCS.actionLabel.line} Default "Send".` },
        fields: {
          type: 'array',
          minItems: 1,
          maxItems: ASK_LIMITS.fields,
          items: {
            type: 'object',
            additionalProperties: false,
            required: ['name', 'label', 'type'],
            properties: {
              name: { type: 'string', pattern: '^[a-z][a-z0-9_]{0,63}$' },
              label: labelSchema,
              type: { enum: ['text', 'number', 'integer', 'boolean', 'choice', 'multi_choice'] },
              required: { type: 'boolean', description: 'Default true, except boolean fields.' },
              options: {
                type: 'array',
                description: 'The choices for choice and multi_choice fields.',
                minItems: 1,
                maxItems: ASK_LIMITS.options,
                items: shown(L.optionLabel, TEXT_DOCS.optionLabel),
                examples: [['Next Monday', 'Next Friday']],
              },
              default: {
                description: 'Proposed value the person can correct.',
                anyOf: [primitive, { type: 'array', items: { type: 'string' } }],
              },
              multiline: { type: 'boolean' },
              minimum: { type: 'number' },
              maximum: { type: 'number' },
            },
          },
        },
        expires_in: expiresIn,
      },
    },
    outputSchema: resultSchema,
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
    _meta: meta,
  },
] as const;
