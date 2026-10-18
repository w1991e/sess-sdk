import { ASK_LIMITS, LIMITS } from './validate.js';

/**
 * Versioned tool contract. Changing any input or output schema requires a new version. Titles and
 * annotations are host hints, not part of the versioned schemas; listing.json artifacts copy them.
 */
export const TOOL_SCHEMA_VERSION = 'sess-mcp-tools/3';
export const TOOL_NAMES = [
  'sess_request',
  'sess_response',
  'sess_publish',
  'sess_complete',
  'sess_ask',
] as const;
export type ToolName = (typeof TOOL_NAMES)[number];

const text = (max: number) => ({ type: 'string', minLength: 1, maxLength: max });
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
    title: text(200),
    description: { type: 'string', maxLength: 1000 },
    minLength: { type: 'integer', minimum: 0 },
    maxLength: { type: 'integer', minimum: 0 },
    enum: { type: 'array', minItems: 1, maxItems: LIMITS.enumValues, items: text(200) },
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
        enum: { type: 'array', minItems: 1, maxItems: LIMITS.enumValues, items: text(200) },
      },
    },
    minItems: { type: 'integer', minimum: 0 },
    maxItems: { type: 'integer', minimum: 0 },
    uniqueItems: { const: true },
  },
};

/** The supported SESS interactive Surface (same semantic contract as @sess.si/sdk InteractiveInteraction). */
export const interactionSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['mode', 'title', 'source', 'actions'],
  properties: {
    mode: { const: 'interactive' },
    title: text(200),
    description: { type: 'string', maxLength: 4000 },
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
                properties: { type: { const: 'heading' }, text: text(200) },
              },
              {
                type: 'object',
                additionalProperties: false,
                required: ['type', 'text'],
                properties: { type: { const: 'text' }, text: text(4000) },
              },
              {
                type: 'object',
                additionalProperties: false,
                required: ['type', 'fields'],
                properties: {
                  type: { const: 'record' },
                  label: text(200),
                  fields: {
                    type: 'object',
                    minProperties: 1,
                    maxProperties: LIMITS.recordEntries,
                    additionalProperties: primitive,
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
                  label: text(200),
                  description: { type: 'string', maxLength: 1000 },
                  required: { type: 'boolean' },
                  multiline: { type: 'boolean' },
                  option_labels: { type: 'object', additionalProperties: text(200) },
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
      minItems: 1,
      maxItems: LIMITS.actions,
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['id', 'label'],
        properties: {
          id: { type: 'string', pattern: '^[a-z][a-z0-9_]{0,31}$' },
          label: text(200),
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
      'Then call sess_response with the handle and revision. Do not call sess_request again for the same question.',
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
      'Do not poll in a loop.',
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
      'Continue exactly as after sess_request: give the link only to the intended person, then call sess_response. Do not call it again for the same question.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['question', 'fields'],
      properties: {
        question: { ...text(200), description: 'Shown as the form title.' },
        details: {
          type: 'string',
          maxLength: 4000,
          description: 'Optional plain-text context shown above the fields.',
        },
        submit_label: text(200),
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
              label: text(200),
              type: { enum: ['text', 'number', 'integer', 'boolean', 'choice', 'multi_choice'] },
              required: { type: 'boolean', description: 'Default true, except boolean fields.' },
              options: { type: 'array', minItems: 1, maxItems: ASK_LIMITS.options, items: text(200) },
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
