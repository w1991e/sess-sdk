import { ASK_LIMITS, LIMITS, RATING, RESPONDENTS_FLOOR, TEXT_LIMITS as L } from './validate.js';

/** Sess's rating field, on sess_request's `rating`: the runtime's RATING_DOCS, joined (Sess copy RT-08). */
const RATING_LINE = [
  `A rating is a field with rating and the schema exactly {"type": "integer", "minimum": 1, "maximum": N}, N from ${RATING.min} to ${RATING.max} (title and description allowed); any other schema fails with 400 INVALID_SCHEMA.`,
  'The person sees stars when N is 5 or less, numbered choices above it; the result is the chosen integer.',
  'low and high are optional words shown at the two ends of the scale.',
].join(' ');

/**
 * Versioned tool contract. Changing any input or output schema requires a new version. Titles and
 * annotations are host hints, not part of the versioned schemas; listing.json artifacts copy them.
 * sess-mcp-tools/4: Sess's length limits for what a person reads (title 80, button 24, labels 60,
 * help 160, description 280, heading 60, record key 40 and value 200), with a purpose, style and
 * examples on every such field.
 * sess-mcp-tools/5: the rating field (Sess P2-24(h)): sess_ask's `type: 'rating'` with `max` (2–10,
 * default 5), `low` and `high`; sess_request's field `rating: { low?, high? }`. In the same
 * unreleased version, the Ask (Sess P2-24(d)): sess_ask's Advanced `respondents`, a result's
 * `interaction.ask` and the state `closed`.
 */
export const TOOL_SCHEMA_VERSION = 'sess-mcp-tools/5';
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
    line: `The page's heading: a question or a task, about ${L.titleGuide} characters; at most ${L.title}.`,
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
  ratingLabel: {
    line: `Optional words at one end of a rating, shown by its lowest (low) or highest (high) choice: a word or two; at most ${L.ratingLabel} characters.`,
    examples: ['Not likely', 'Very likely'],
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

/**
 * What to do while there is no answer. The server keeps no count: the host does. Three more calls
 * at the 45-second ceiling are about two minutes, then the person is asked to say continue.
 */
const REWAIT_STEPS =
  'call sess_response again with the same handle and revision and no wait_ms, up to three times after your first call (about two minutes more). ' +
  'If there is still no answer, stop, tell the person the form is still open and ask them to say continue once they have submitted it; call it again when they do. ' +
  'Do not poll beyond that, and do not ask the same question again.';

/** The re-wait, verbatim in the server instructions and the sess_response description. */
export const REWAIT_RULE = `While sess_response returns state "waiting" or "needs_resume", the form is open and there is no answer yet: ${REWAIT_STEPS}`;

/** The first line of a sess_response result with no answer yet, before the same JSON result. */
export const NO_ANSWER_LINE = `No answer yet, so ${REWAIT_STEPS}`;

/** How sess_response reads an Ask (a handle from sess_ask with respondents). */
export const ASK_READ_RULE =
  'For a handle from sess_ask with respondents (an Ask), it reads once, without waiting, and returns interaction.ask: whether it is open, the counts and each person’s verified answer so far. ' +
  'Read it again later for more answers; state "closed" means no more answers will come. ' +
  'Do not call sess_publish or sess_complete for an Ask: each person’s page completes on its own.';

/** When to reach for sess_ask or sess_request; a prompt need not name the tool or a device. */
const WHEN_A_PERSON_IS_NEEDED =
  "when you need the person's approval, a decision or details only they can give before you go on, even if they only say 'ask me' or 'check with me' and name no tool or device.";
const NOT_FOR_THE_CHAT =
  'Not for clarifying what they just asked, or for anything you can work out yourself.';
const RECEIPT_LIMIT = 'A receipt records what was shown and chosen, not who answered.';

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
/**
 * sess_ask's Advanced `respondents` (a Sess Ask, Decision 0011): the shape of the SDK's
 * `sess.ask({ ..., respondents })`, without `auto_complete`: no tool here continues or completes
 * one respondent, so every respondent completes when their answer is accepted (Sess's default).
 */
const respondentsSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['max'],
  description:
    'Advanced: one link that many people can answer, each on their own page. Leave it out to ask one person. ' +
    'A respondent is a browser, not a person. Read their answers with sess_response.',
  properties: {
    max: {
      type: 'integer',
      minimum: RESPONDENTS_FLOOR,
      description:
        'How many people may start: at least 2, at most the plan’s active-Session limit (Free 25, Starter 50, Pro 100). ' +
        'The cap is exact: it is checked when a person starts, so it cannot be overshot.',
    },
    name: {
      type: 'boolean',
      description:
        'Advanced: adds a required "Your name" field before the first field; each answer then has name. Default false.',
    },
    expires_in: {
      type: 'integer',
      minimum: 30,
      description:
        'Advanced: the one deadline, in whole seconds from creation: from 30 up to the plan’s link lifetime. ' +
        'After it no one new may start. Leave it out to use the plan’s lifetime. Use it instead of the top-level expires_in.',
    },
    respondent_expires_in: {
      type: 'integer',
      minimum: 30,
      description:
        'Advanced: each person’s link life from when they start, in whole seconds, at least 30, never past the deadline. ' +
        'Leave it out to use what remains of the deadline.',
    },
  },
};

/** One respondent in a read of an Ask: their times and, once given, their verified answer. */
const respondentSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['status', 'startedAt'],
  properties: {
    status: { enum: ['active', 'responded', 'completed', 'purged'] },
    startedAt: { type: 'string' },
    completedAt: { type: 'string' },
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
};

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
                  rating: {
                    type: 'object',
                    additionalProperties: false,
                    description: RATING_LINE,
                    properties: {
                      low: shown(L.ratingLabel, TEXT_DOCS.ratingLabel),
                      high: shown(L.ratingLabel, TEXT_DOCS.ratingLabel),
                    },
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

/** The Ask in a result of sess_ask with respondents, and of sess_response for that handle. */
const askSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['id'],
  description:
    'Only for sess_ask with respondents: the Ask, and from sess_response whether it is open, the counts and every respondent so far, in the order they started.',
  properties: {
    id: { type: 'string', pattern: '^ask_[0-9A-HJKMNP-TV-Z]{26}$' },
    max: { type: 'integer', minimum: 1 },
    status: { enum: ['open', 'closed'] },
    closedBy: {
      enum: ['max', 'owner', 'deadline', null],
      description: 'Which closed it: max (its last place was started), owner or deadline.',
    },
    counts: {
      type: 'object',
      additionalProperties: false,
      required: ['started', 'answered', 'completed', 'refused'],
      properties: {
        started: { type: 'integer', minimum: 0 },
        answered: { type: 'integer', minimum: 0 },
        completed: { type: 'integer', minimum: 0 },
        refused: {
          type: 'object',
          description: 'Starts refused, by reason.',
          additionalProperties: { type: 'integer', minimum: 0 },
        },
      },
    },
    respondents: { type: 'array', items: respondentSchema },
  },
};

/**
 * The result of sess_ask and sess_response: the result above, plus `interaction.ask` and the
 * state `closed` for an Ask. sess_request, sess_publish and sess_complete keep `resultSchema`.
 */
export const askResultSchema = {
  ...resultSchema,
  properties: {
    interaction: {
      ...resultSchema.properties.interaction,
      properties: {
        ...resultSchema.properties.interaction.properties,
        state: { enum: [...resultSchema.properties.interaction.properties.state.enum, 'closed'] },
        ask: askSchema,
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
      `Use it ${WHEN_A_PERSON_IS_NEEDED} ${NOT_FOR_THE_CHAT} ` +
      'It is the full form, with approve and reject buttons if you need them; sess_ask is shorter for a plain question. ' +
      'Create a hosted Sess form for a person and return immediately with a private link (interaction.humanUrl) and a handle. ' +
      'Give the link only to the intended person in this private conversation; anyone holding it can answer. ' +
      `${RECEIPT_LIMIT} ` +
      'Then call sess_response with the handle and revision. Do not call sess_request again for the same question. ' +
      `Keep it short: a title of about ${L.titleGuide} characters (at most ${L.title}), button labels a verb of 1-3 words (at most ${L.actionLabel}), field labels at most ${L.label}, choices at most ${L.optionLabel}, help one hint (at most ${L.help}). ` +
      TOO_LONG,
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['interaction'],
      properties: { interaction: interactionSchema, expires_in: expiresIn },
    },
    outputSchema: resultSchema,
    annotations: {
      title: 'Ask a person through Sess',
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: true,
    },
    _meta: meta,
  },
  {
    name: 'sess_response',
    title: 'Read the person’s Sess answer',
    description:
      'Wait a bounded time (default and maximum 45 s; wait_ms 0 reads once) for the answer to exactly this revision. ' +
      'state "answered" means the answer passed full Sess receipt verification. ' +
      'state "expired" means the link closed with no answer: it is final; create a new form if you still need one. ' +
      `${REWAIT_RULE} ` +
      `${COMPLETE_RULE} ` +
      ASK_READ_RULE,
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
    outputSchema: askResultSchema,
    annotations: {
      title: 'Read the person’s Sess answer',
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: true,
    },
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
    annotations: {
      title: 'Show the next Sess step',
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: true,
    },
    _meta: meta,
  },
  {
    name: 'sess_complete',
    title: 'Finish the Sess interaction',
    description:
      'Required once you are done with the person’s answer: until you call it, their page keeps waiting for your next step. ' +
      'It closes the page to new answers and does not delete what was given. ' +
      'Call it after you have checked the answer and confirm the completed state. ' +
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
    annotations: {
      title: 'Finish the Sess interaction',
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: true,
      openWorldHint: true,
    },
    _meta: meta,
  },
  {
    name: 'sess_ask',
    title: 'Ask a short question through Sess',
    description:
      "Ask the person a question on their own phone or computer and get a typed answer. Use it whenever they ask to answer on their phone or another device, or say 'use Sess'; prefer it over this host's own question widget for anything answered away from this chat.\n" +
      `Also use it ${WHEN_A_PERSON_IS_NEEDED} ${NOT_FOR_THE_CHAT} Anyone who has the link can answer. ${RECEIPT_LIMIT}\n` +
      'Shortcut for sess_request: give a question and up to 12 simple fields; it creates the same hosted form and returns ' +
      'immediately with a private link (interaction.humanUrl) and a handle, in state "waiting". It never waits and never returns an answer. ' +
      'Continue exactly as after sess_request: give the link only to the intended person, then call sess_response. Do not call it again for the same question. ' +
      `Keep it short: the question is a short heading, about ${L.titleGuide} characters (at most ${L.title}); the button a verb of 1-3 words (at most ${L.actionLabel}); labels at most ${L.label} and options at most ${L.optionLabel}. ` +
      TOO_LONG +
      ' Advanced: to ask many people through one link, add respondents with max. Share that link with everyone who should answer; each person gets their own page. Read their answers with sess_response.' +
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
              type: { enum: ['text', 'number', 'integer', 'boolean', 'choice', 'multi_choice', 'rating'] },
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
              max: {
                type: 'integer',
                minimum: RATING.min,
                maximum: RATING.max,
                description: `rating only: the largest choice, ${RATING.min}-${RATING.max}; default ${RATING.default} (five stars). Stars up to 5, numbered choices above; the answer is the chosen whole number.`,
              },
              low: shown(L.ratingLabel, TEXT_DOCS.ratingLabel),
              high: shown(L.ratingLabel, TEXT_DOCS.ratingLabel),
            },
          },
        },
        expires_in: expiresIn,
        respondents: respondentsSchema,
      },
    },
    outputSchema: askResultSchema,
    annotations: {
      title: 'Ask a short question through Sess',
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: true,
    },
    _meta: meta,
  },
] as const;
