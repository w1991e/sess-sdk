// The weekend planner as five local tools, shared by every provider recipe. Each recipe declares
// these tools in its provider's own tool format and runs that provider's own loop; this file only
// does what a tool call asks: Sess through @sess.si/sdk, the weather through the starter's licensed
// helper (MET Norway, NWS in the US). The person's private link goes to `showLink` (the terminal),
// never into a tool result, so it is never sent to a model provider.
import { randomUUID } from 'node:crypto';
import * as w from '../../create-agent/template/weather.mjs';

export const SYSTEM = [
  'You plan a weekend outing with a person through Sess. Use only the tools; never invent weather.',
  '1. Call sess_ask with a short friendly intro. The person gets the private link from the app, not from you.',
  '2. Call sess_response with the session_id and revision you got. If it says waiting, call it again.',
  "3. Call get_weather with the person's place and day.",
  '4. Call sess_publish with a one-sentence intro to the three plans.',
  '5. Call sess_response for the new revision.',
  '6. Call sess_complete, then reply with the plan in one sentence and the weather attribution.',
].join('\n');

export const TASK = 'Plan my weekend.';

const id = { type: 'string', description: 'The session_id from sess_ask.' };
const revision = { type: 'integer', minimum: 1, description: 'The revision to wait for.' };
const intro = { type: 'string', minLength: 1, maxLength: 300 };

/** The tools, provider-neutral: name, description and a JSON Schema for the arguments. */
export const TOOLS = Object.freeze([
  {
    name: 'sess_ask',
    description: 'Ask the person where and when (question 1 of 2) on a new private Sess link.',
    parameters: obj({ intro }, ['intro']),
  },
  {
    name: 'sess_response',
    description: "Wait for the person's answer to a revision. Returns the verified answer, or waiting.",
    parameters: obj({ session_id: id, revision }, ['session_id', 'revision']),
  },
  {
    name: 'get_weather',
    description: 'Live forecast for the place and day the person chose, and three plans from a fixed rule.',
    parameters: obj(
      {
        place: { type: 'string', enum: Object.keys(w.CITIES) },
        day: { type: 'string', enum: ['saturday', 'sunday'] },
      },
      ['place', 'day'],
    ),
  },
  {
    name: 'sess_publish',
    description: 'Show the three plans (question 2 of 2) on the same link. The person picks or corrects one.',
    parameters: obj({ session_id: id, intro }, ['session_id', 'intro']),
  },
  {
    name: 'sess_complete',
    description: "Close the Session after the person's second answer and return their plan.",
    parameters: obj({ session_id: id }, ['session_id']),
  },
]);

/**
 * One run's tools over a Sess client. `deadline` (epoch ms) bounds the human waits; each
 * sess_response call waits up to `pollsPerCall` long-polls of `pollMs`, at most `maxPolls` in all.
 */
export function createWorkflow({
  sess,
  contact,
  showLink,
  weatherFor = w.weatherFor,
  deadline = Infinity,
  now = Date.now,
  pollMs = 45_000,
  maxPolls = 20,
  pollsPerCall = 4,
}) {
  const state = {
    sessionId: null,
    createAttempted: false,
    answers: {},
    trip: null,
    weather: null,
    options: null,
    /** Each mutation's whole request, fixed before its first send; a retry replays it unchanged. */
    publishRequest: null,
    published: null,
    completeRequest: null,
    completed: null,
    polls: 0,
    steps: [],
    /** Every tool call the model made, in order: its name and how it ended (no arguments). */
    events: [],
    corrected: false,
    plan: null,
  };

  const tools = {
    async sess_ask({ intro }) {
      if (state.createAttempted) return { error: 'The question was already asked. Use its session_id.' };
      state.createAttempted = true; // creation is never repeated: its outcome may be unknown
      const created = await sess.sessions.create({ interaction: whereAndWhen(String(intro)) });
      state.sessionId = created.data.id;
      showLink(created.data.human_url);
      state.steps.push('asked');
      return { session_id: created.data.id, revision: created.data.revision, link: 'shown to the person' };
    },

    async sess_response({ session_id, revision }) {
      if (session_id !== state.sessionId) return { error: 'Unknown session_id.' };
      if (state.answers[revision]) return answered(revision);
      for (let i = 0; i < pollsPerCall; i++) {
        const left = deadline - now();
        if (state.polls >= maxPolls || left <= 0) return { error: 'The wait budget is used up.' };
        state.polls++;
        try {
          const reply = await sess.sessions.waitForResponse(session_id, {
            revision,
            timeoutMs: Math.min(pollMs, left),
          });
          const { response } = await sess.receipts.verifyResponse({
            sessionId: session_id,
            response: reply.response,
          });
          state.answers[revision] = { data: response.data, etag: reply.meta.etag };
          state.steps.push(`answered_${revision}`, `receipt_verified_${revision}`);
          return answered(revision);
        } catch (error) {
          if (error?.code !== 'WAIT_TIMEOUT') throw error;
        }
      }
      return { waiting: true, note: 'No answer yet. Call sess_response again to keep waiting.' };
    },

    async get_weather({ place, day }) {
      const first = state.answers[1]?.data;
      if (!first) return { error: 'Wait for the answer to question 1 first.' };
      if (place !== first.place || day !== first.day)
        return { error: `Use the person's answer: place ${first.place}, day ${first.day}.` };
      // Once question 2 is being published its plans are fixed: no new forecast may change them.
      if (state.publishRequest) return { error: 'The plans are already on the link. Use them.' };
      state.trip = w.readTrip(first);
      state.weather = await weatherFor(state.trip, contact);
      state.options = w.propose(state.weather.slots);
      state.steps.push(state.weather.forecast ? 'weather_live' : 'weather_unavailable');
      return {
        city: state.trip.name,
        date: state.trip.date,
        forecast_available: Boolean(state.weather.forecast),
        slots: state.weather.slots.map((s) => ({ id: s.id, name: s.name, weather: s.line })),
        us_alerts: state.weather.alerts,
        plans: state.options.map((o) => ({ id: o.id, idea: o.idea, slot: o.slot.name })),
        attribution: state.weather.forecast ? w.ATTRIBUTION : null,
      };
    },

    async sess_publish({ session_id, intro }) {
      if (session_id !== state.sessionId) return { error: 'Unknown session_id.' };
      if (state.published) return { revision: state.published.revision, note: 'Question 2 is on the link.' };
      if (!state.publishRequest) {
        if (!state.options || !state.answers[1]) return { error: 'Call get_weather first.' };
        // The whole request (body, precondition, key) is fixed before any I/O. A retry after a lost
        // reply replays exactly these bytes, so the server can recognise it as the same write.
        state.publishRequest = Object.freeze({
          body: JSON.stringify({ interaction: pickAPlan(String(intro)) }),
          ifMatch: state.answers[1].etag,
          idempotencyKey: randomUUID(),
          intro: String(intro),
        });
      }
      const request = state.publishRequest;
      const published = await sess.sessions.publish(session_id, JSON.parse(request.body), {
        ifMatch: request.ifMatch,
        idempotencyKey: request.idempotencyKey,
      });
      state.published = { revision: published.data.revision };
      state.steps.push('published');
      return {
        revision: published.data.revision,
        ...(String(intro) !== request.intro
          ? { note: 'The first request was sent again unchanged; the new intro was not used.' }
          : {}),
      };
    },

    async sess_complete({ session_id }) {
      if (session_id !== state.sessionId) return { error: 'Unknown session_id.' };
      if (state.completed) return state.completed;
      const second = state.answers[2];
      if (!second) return { error: 'Wait for the answer to question 2 first.' };
      // Fixed before the first send; a retry after a lost reply replays it unchanged.
      state.completeRequest ??= Object.freeze({ ifMatch: second.etag, idempotencyKey: randomUUID() });
      const plan = w.readPlan(second.data, state.options, state.weather.slots, state.trip);
      const done = await sess.sessions.complete(session_id, { ...state.completeRequest });
      state.plan = plan;
      state.corrected = second.data.time !== 'keep';
      state.steps.push('completed');
      state.completed = {
        status: done.data.status,
        plan: `${plan.text} in ${state.trip.name}`,
        weather: plan.weather,
        attribution: state.weather.forecast ? w.ATTRIBUTION : null,
      };
      return state.completed;
    },
  };

  /** Runs one tool call. A refusal or failure comes back as `{ error }`, never as a thrown secret. */
  async function call(name, args) {
    const tool = Object.hasOwn(tools, name) ? tools[name] : null;
    if (!tool) {
      state.events.push({ tool: 'unknown', outcome: 'error' });
      return { error: `Unknown tool ${name}.` };
    }
    let result;
    try {
      result = await tool(args && typeof args === 'object' ? args : {});
    } catch (error) {
      const unknown =
        error?.outcome !== 'unknown'
          ? ''
          : name === 'sess_ask'
            ? ' Its outcome is unknown; do not repeat it.'
            : ' Its outcome is unknown; calling it again sends the same request.';
      result = { error: `${name} failed (${error?.code ?? error?.name ?? 'error'}).${unknown}` };
    }
    state.events.push({ tool: name, outcome: result.error ? 'error' : result.waiting ? 'waiting' : 'ok' });
    return result;
  }

  function answered(rev) {
    return { answered: true, revision: rev, verified: true, data: state.answers[rev].data };
  }

  /** Question 1: where and when (the starter's form, with the model's intro). */
  function whereAndWhen(text) {
    const places = Object.fromEntries(Object.entries(w.CITIES).map(([key, city]) => [key, city[0]]));
    return form('Plan your weekend', 'Question 1 of 2', { id: 'next', label: 'Next', intent: 'continue' }, [
      { type: 'text', text },
      field('place', 'Where', places),
      field('day', 'Which day', { saturday: 'Saturday', sunday: 'Sunday' }),
    ]);
  }

  /** Question 2: the three plans from the fixed rule; pick one or change its time. */
  function pickAPlan(text) {
    // Option labels stay under 60 characters; the forecast above shows each slot's weather.
    const plans = state.options.map((o) => [o.id, `${o.idea} — ${o.slot.name}`]);
    const times = [['keep', 'Keep the suggested time'], ...w.SLOTS.map((s) => [s[0], s[1]])];
    const action = { id: 'approve', label: 'Make my plan', intent: 'approve' };
    return form('Pick your plan', 'Question 2 of 2', action, [
      { type: 'text', text },
      ...w.weatherShown(state.trip, state.weather),
      field('choice', 'Pick a plan', Object.fromEntries(plans), 'Picked by a fixed rule from the forecast.'),
      field('time', 'Time', Object.fromEntries(times)),
    ]);
  }

  return { tools: TOOLS, call, state };
}

function obj(properties, required) {
  return { type: 'object', properties, required, additionalProperties: false };
}
function form(title, description, action, components) {
  return {
    mode: 'interactive',
    title,
    description,
    source: { kind: 'sess_surface', components },
    actions: [action],
  };
}
function field(name, label, choices, description) {
  const values = Object.keys(choices);
  return {
    type: 'field',
    name,
    label,
    description,
    required: true,
    schema: { type: 'string', enum: values },
    option_labels: choices,
    value: values[0],
  };
}

/** What a qualification run can prove, in order. */
export const CHECKS = Object.freeze([
  'tool_call_issued',
  'sess_link_created_before_wait',
  'human_answer_received',
  'receipt_verified',
  'continuation_after_first_answer',
  'live_weather_used',
  'second_round_published',
  'second_answer_on_same_link',
  'second_receipt_verified',
  'session_completed',
  'final_answer_returned',
  'wait_resumed_after_timeout',
  'correction_applied',
]);

/**
 * The checks this run actually observed, and the rest. Each is read from what the tools saw,
 * never from what the model said: an answer counts only once its receipt verified.
 */
export function observed(state, finalText) {
  const ev = state.events;
  const first = (pred) => ev.findIndex(pred);
  const ok = (tool) => (e) => e.tool === tool && e.outcome === 'ok';
  const askedAt = first(ok('sess_ask'));
  const waitAt = first((e) => e.tool === 'sess_response');
  const step = (s) => state.steps.includes(s);
  const answeredAt = state.steps.indexOf('answered_1');
  const resumed = ev.some(
    (e, i) =>
      e.tool === 'sess_response' && e.outcome === 'waiting' && ev.slice(i + 1).some(ok('sess_response')),
  );
  const seen = {
    tool_call_issued: ev.some((e) => e.tool !== 'unknown'),
    sess_link_created_before_wait: askedAt >= 0 && waitAt > askedAt,
    human_answer_received: step('answered_1'),
    receipt_verified: step('receipt_verified_1'),
    continuation_after_first_answer:
      answeredAt >= 0 &&
      Math.max(state.steps.indexOf('weather_live'), state.steps.indexOf('weather_unavailable')) > answeredAt,
    live_weather_used: step('weather_live'),
    second_round_published: step('published'),
    second_answer_on_same_link: step('published') && step('answered_2'),
    second_receipt_verified: step('receipt_verified_2'),
    session_completed: step('completed'),
    final_answer_returned: typeof finalText === 'string' && finalText.trim().length > 0 && step('completed'),
    wait_resumed_after_timeout: resumed,
    correction_applied: step('completed') && state.corrected,
  };
  return {
    proved: CHECKS.filter((c) => seen[c]),
    not_proved: CHECKS.filter((c) => !seen[c]),
  };
}
