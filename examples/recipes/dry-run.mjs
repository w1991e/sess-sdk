// The free pre-flight (`node qualify.mjs --dry-run <provider>`): a qualification run with the
// same scenario, limits, budget accounting and evidence record, where everything outside this
// process is simulated. Nothing leaves the machine and nothing is billed:
//   - the model provider: a scripted model speaking that provider's own wire format;
//   - the Sess API: a synthetic server behind the real @sess.si/sdk client, with signed Ed25519
//     receipts, If-Match and idempotent replays (a repeated key with a different body conflicts);
//   - the person: a simulated answer to each question, after one empty poll;
//   - the weather: a fixed forecast.
// It writes to its own ledger and records (qualification/dry-run/), never the real ledger. Its
// record says `dry_run: true` and lists what was simulated, so it is never mistaken for a
// provider qualification.
import { createHash, generateKeyPairSync, randomBytes, sign } from 'node:crypto';

export const SIMULATED = Object.freeze(['model provider', 'Sess API', 'the person', 'weather']);

const API = 'https://api.sess.si';
const WORKSPACE = 'ws_dryrun000000000000000001';
const SESSION_ID = `ses_${'0'.repeat(25)}D`;
const KID = 'dry-run-1';

const canonical = (value) =>
  Array.isArray(value)
    ? `[${value.map(canonical).join(',')}]`
    : value !== null && typeof value === 'object'
      ? `{${Object.keys(value)
          .filter((key) => value[key] !== undefined)
          .sort()
          .map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`)
          .join(',')}}`
      : JSON.stringify(value);
const digest = (value) => `sha256:${createHash('sha256').update(canonical(value)).digest('hex')}`;
const json = (status, body, headers = {}) =>
  new Response(body === undefined ? null : JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  });
const error = (status, code) => json(status, { error: { code, request_id: 'dry-run', message: code } });

/**
 * A synthetic Sess API for the real SDK client (`new Sess({ apiKey, fetch: server.fetch })`).
 * `answers[r - 1]` answers revision r after one unanswered poll. `loseReply` names writes
 * ('create' | 'publish' | 'complete') whose first reply is lost after the write took effect.
 */
export function syntheticSess({ apiKey, answers, loseReply = [] }) {
  const { privateKey, publicKey } = generateKeyPairSync('ed25519');
  const keySet = {
    keys: [
      {
        kty: 'OKP',
        crv: 'Ed25519',
        x: publicKey.export({ format: 'jwk' }).x,
        kid: KID,
        alg: 'EdDSA',
        use: 'sig',
        key_ops: ['verify'],
      },
    ],
  };
  const lose = new Set(loseReply);
  const log = { writes: [], conflicts: 0, replays: 0, lost: [] };
  const writes = new Map();
  let session = null;
  let unansweredPolls = 0;
  const etag = () => `"${session.revision}-${session.status}"`;
  const authed = (status, body) => json(status, body, { etag: etag(), 'sess-workspace-id': WORKSPACE });
  const view = () => ({
    id: SESSION_ID,
    revision: session.revision,
    status: session.status,
    interaction: session.interaction,
    response_schema: { type: 'object' },
    responses: session.responses,
  });

  function store(interaction, revision) {
    const normalized = { ...interaction, response_policy: 'first' };
    session.surfaces[revision] = normalized;
    session.interaction = normalized;
  }

  function personAnswers() {
    const revision = session.revision;
    const data = answers[revision - 1];
    const action = session.interaction.actions[0];
    const millis = Date.now();
    const eventId = `evt_${String(revision).padStart(26, '0')}`;
    const claims = {
      sess_receipt: 1,
      iss: API,
      aud: WORKSPACE,
      jti: eventId,
      iat: Math.floor(millis / 1000),
      exp: Math.floor(millis / 1000) + 3600,
      accepted_at: new Date(millis).toISOString(),
      workspace_id: WORKSPACE,
      session_id: SESSION_ID,
      step_id: `rev_${revision}`,
      event_id: eventId,
      surface: { revision, hash: digest(session.interaction), renderer_version: 'sess-html-form-1' },
      action: { id: action.id, label: action.label, summary: action.intent ?? '' },
      input_hash: digest(data),
      actor: { assurance: 'link_holder', subject: `${WORKSPACE}:human_link:${SESSION_ID}` },
      return_binding: { recipient: WORKSPACE, return_channel_id: null },
    };
    const header = Buffer.from(JSON.stringify({ alg: 'EdDSA', kid: KID, typ: 'sess-receipt+jwt' })).toString(
      'base64url',
    );
    const input = `${header}.${Buffer.from(canonical(claims)).toString('base64url')}`;
    session.responses.push({
      event_id: eventId,
      sequence: revision,
      revision,
      action_id: action.id,
      data,
      actor: { assurance: 'link_holder' },
      accepted_at: claims.accepted_at,
      receipt: `${input}.${sign(null, Buffer.from(input), privateKey).toString('base64url')}`,
    });
    session.status = 'responded';
  }

  /** A keyed write: the same key and body replays the first reply; another body conflicts. */
  function keyed(kind, key, body, apply) {
    const hash = digest({ kind, body: body ?? null });
    const seen = writes.get(key);
    if (seen) {
      if (seen.hash !== hash) {
        log.conflicts++;
        return error(409, 'IDEMPOTENCY_CONFLICT');
      }
      log.replays++;
      return seen.reply();
    }
    const result = apply();
    if (result.status < 300) writes.set(key, { hash, reply: () => authedAt(result) });
    return authedAt(result);
  }
  const authedAt = ({ status, body, headers }) => json(status, body, headers);
  const snapshot = (status) => ({
    status,
    body: view(),
    headers: { etag: etag(), 'sess-workspace-id': WORKSPACE },
  });

  async function route(url, init) {
    const method = init.method;
    const path = url.pathname;
    if (method === 'GET' && path === '/.well-known/sess-receipt-keys.json') return json(200, keySet);
    if (init.headers.get('authorization') !== `Bearer ${apiKey}`) return error(401, 'UNAUTHENTICATED');
    const body = init.body ? JSON.parse(init.body) : undefined;
    if (method === 'POST' && path === '/v1/sessions') {
      log.writes.push('create');
      if (session) return error(409, 'UNEXPECTED_SECOND_CREATE');
      session = { revision: 1, status: 'active', responses: [], surfaces: {} };
      store(body.interaction, 1);
      const capability = randomBytes(32).toString('base64url');
      return json(
        201,
        { id: SESSION_ID, revision: 1, human_url: `https://app.sess.si/s/${capability}` },
        { etag: etag(), 'sess-workspace-id': WORKSPACE },
      );
    }
    const base = `/v1/sessions/${SESSION_ID}`;
    if (!session || !path.startsWith(base)) return error(404, 'NOT_FOUND');
    const rest = path.slice(base.length);
    if (method === 'GET' && rest === '') {
      if (session.status === 'active') {
        if (unansweredPolls >= 1) personAnswers();
        else unansweredPolls++;
      }
      return authed(200, view());
    }
    const surface = /^\/surfaces\/(\d+)$/.exec(rest);
    if (method === 'GET' && surface) {
      const interaction = session.surfaces[Number(surface[1])];
      if (!interaction) return error(404, 'NOT_FOUND');
      return authed(200, {
        id: SESSION_ID,
        revision: Number(surface[1]),
        interaction,
        response_schema: { type: 'object' },
      });
    }
    const ifMatch = init.headers.get('if-match');
    const key = init.headers.get('idempotency-key');
    if (method === 'PATCH' && rest === '') {
      log.writes.push('publish');
      if (!key) return error(400, 'IDEMPOTENCY_KEY_REQUIRED');
      return keyed('publish', key, { ifMatch, body }, () => {
        if (ifMatch !== etag() || session.status !== 'responded')
          return { status: 412, body: { error: { code: 'PRECONDITION_FAILED' } } };
        session.revision++;
        session.status = 'active';
        unansweredPolls = 0;
        store(body.interaction, session.revision);
        return snapshot(200);
      });
    }
    if (method === 'POST' && rest === '/complete') {
      log.writes.push('complete');
      if (!key) return error(400, 'IDEMPOTENCY_KEY_REQUIRED');
      return keyed('complete', key, { ifMatch }, () => {
        if (ifMatch !== etag() || session.status !== 'responded')
          return { status: 412, body: { error: { code: 'PRECONDITION_FAILED' } } };
        session.status = 'completed';
        return snapshot(200);
      });
    }
    return error(404, 'NOT_FOUND');
  }

  const kindOf = (method, path) =>
    method === 'POST' && path === '/v1/sessions'
      ? 'create'
      : method === 'PATCH'
        ? 'publish'
        : path.endsWith('/complete')
          ? 'complete'
          : null;

  /** The fetch for the SDK: the synthetic API on its origin; every other origin is refused. */
  async function fetch(input, init) {
    const request = new Request(input, init);
    const url = new URL(request.url);
    if (url.origin !== API) throw new TypeError('dry-run: network access refused');
    const body = request.method === 'GET' ? undefined : await request.text();
    const response = await route(url, {
      method: request.method,
      headers: request.headers,
      body: body || undefined,
    });
    const kind = kindOf(request.method, url.pathname);
    if (kind && lose.has(kind)) {
      lose.delete(kind);
      log.lost.push(kind);
      throw new TypeError('dry-run: the reply was lost');
    }
    return response;
  }

  return { fetch, log, session: () => session };
}

/** A fixed forecast for every place: dry, 18 °C, light wind. */
export async function dryWeather() {
  const slot = (id, name) => ({
    id,
    name,
    covered: true,
    temp: 18,
    rain: 0,
    wind: 3,
    line: '18 °C · dry · wind 3 m/s',
  });
  return {
    forecast: { properties: {} },
    slots: [
      slot('morning', 'Morning, 09:00–12:00'),
      slot('afternoon', 'Afternoon, 12:00–17:00'),
      slot('evening', 'Evening, 17:00–21:00'),
    ],
    alerts: [],
  };
}

/** The tool calls a model makes for the weekend planner, in order. */
export const SCRIPT = Object.freeze([
  ['sess_ask', { intro: 'Tell me where and when, and I will suggest three plans.' }],
  ['sess_response', { revision: 1 }],
  ['get_weather', { place: 'oslo', day: 'saturday' }],
  ['sess_publish', { intro: 'Here are three plans for the forecast. Pick one or change its time.' }],
  ['sess_response', { revision: 2 }],
  ['sess_complete', {}],
]);
export const DRY_ANSWERS = Object.freeze([
  { place: 'oslo', day: 'saturday' },
  { choice: 'option_1', time: 'evening' },
]);
const FINAL = 'Your plan is ready. (A scripted dry-run reply: no model wrote it.)';

/** A scripted model in one provider's own wire format: each request gets the next call. */
export function scriptedProvider(providerId, script = SCRIPT) {
  let step = 0;
  const usage = { input: 1000, output: 100 };
  const next = () => {
    const call = script[step++];
    return call ? [call[0], call[0] === 'sess_ask' ? call[1] : { session_id: SESSION_ID, ...call[1] }] : null;
  };
  const replies = {
    openai: (call, i, model) => ({
      id: `resp_${i}`,
      model,
      status: 'completed',
      usage: { input_tokens: usage.input, output_tokens: usage.output },
      output: call
        ? [
            { type: 'reasoning', id: `rs_${i}`, encrypted_content: `enc_${i}`, summary: [] },
            {
              type: 'function_call',
              id: `fc_${i}`,
              call_id: `call_${i}`,
              name: call[0],
              arguments: JSON.stringify(call[1]),
            },
          ]
        : [{ type: 'message', role: 'assistant', content: [{ type: 'output_text', text: FINAL }] }],
    }),
    anthropic: (call, i, model) => ({
      id: `msg_${i}`,
      model,
      usage: { input_tokens: usage.input, output_tokens: usage.output },
      stop_reason: call ? 'tool_use' : 'end_turn',
      content: call
        ? [
            { type: 'thinking', thinking: 'planning', signature: `sig_${i}` },
            { type: 'tool_use', id: `toolu_${i}`, name: call[0], input: call[1] },
          ]
        : [{ type: 'text', text: FINAL }],
    }),
    gemini: (call, i, model) => ({
      modelVersion: model,
      usageMetadata: { promptTokenCount: usage.input, candidatesTokenCount: usage.output },
      candidates: [
        {
          finishReason: 'STOP',
          content: {
            role: 'model',
            parts: call
              ? [
                  {
                    functionCall: { id: `fc_${i}`, name: call[0], args: call[1] },
                    thoughtSignature: `ts_${i}`,
                  },
                ]
              : [{ text: FINAL }],
          },
        },
      ],
    }),
    xai: (call, i, model) => ({
      id: `resp_${i}`,
      model,
      status: 'completed',
      usage: { input_tokens: usage.input, output_tokens: usage.output },
      output: call
        ? [{ type: 'function_call', call_id: `call_${i}`, name: call[0], arguments: JSON.stringify(call[1]) }]
        : [{ type: 'message', content: [{ type: 'output_text', text: FINAL }] }],
    }),
    openrouter: (call, i, model) => ({
      model,
      usage: { prompt_tokens: usage.input, completion_tokens: usage.output },
      choices: [
        {
          finish_reason: call ? 'tool_calls' : 'stop',
          message: call
            ? {
                role: 'assistant',
                content: null,
                tool_calls: [
                  {
                    id: `call_${i}`,
                    type: 'function',
                    function: { name: call[0], arguments: JSON.stringify(call[1]) },
                  },
                ],
                reasoning_details: [{ type: 'reasoning.encrypted', data: `rd_${i}` }],
              }
            : { role: 'assistant', content: FINAL },
        },
      ],
    }),
  };
  replies.meta = replies.xai;
  const reply = replies[providerId];
  let i = 0;
  const seen = [];
  /** The model endpoint's fetch (the bounds guard's). Nothing is sent anywhere. */
  async function fetch(url, init) {
    const body = JSON.parse(init.body);
    seen.push({ url, body });
    const model = String(body.model ?? String(url).split('/models/')[1]?.split(':')[0]);
    return new Response(JSON.stringify(reply(next(), i++, `${model} (dry run)`)), { status: 200 });
  }
  return { fetch, seen };
}
