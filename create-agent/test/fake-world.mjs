// Test-only preload for the generated agent (`node --import <this file> agent.mjs`). Not packed.
//
// It replaces fetch with an offline world: a fake SESS API that keeps one Session, signs genuine
// Ed25519 receipts and serves its key set; a scripted person who answers each revision after the
// agent has polled it unanswered once; MET Norway and NWS. Any other origin is refused and recorded.
// On exit it writes what the agent sent (paths, weather request headers, published interactions,
// counts) to the JSON file named in SESS_FAKE_WORLD.record, so tests assert behavior, not prose.
//
// SESS_FAKE_WORLD (JSON): { apiKey, answers: [round1Data, round2Data], met, nws, record }
//   met: 'ok' | 'busy' (one 429, then ok) | 'outage' (503 every time) | 'revalidate' (304 when asked)
//   nws: 'ok' | 'outage'
//   tamper: <revision> signs that revision's receipt over altered input (verification must fail).
//   lapsed: true serves link timing (Decision 0009 Amendment 10): every unanswered read shows the
//     link lapsed, an hour past its deadline with its horizon an hour ahead; the person then asks
//     for more time and answers, so the answering read shows it live with one extension.
//   weather: 'live' sends the weather requests to the real services instead (manual checks only).
import { createHash, generateKeyPairSync, randomBytes, sign } from 'node:crypto';
import { writeFileSync } from 'node:fs';

const config = JSON.parse(process.env.SESS_FAKE_WORLD ?? 'null');
if (!config) throw new Error('fake-world: SESS_FAKE_WORLD is not set');
// Through NODE_OPTIONS (`npm start`) npm itself loads this file too: only the agent gets the world.
const active = /(?:^|[\\/])agent\.mjs$/.test(process.argv[1] ?? '');

const API = 'https://api.sess.si';
const WORKSPACE = 'ws_fakeworld0000000000000001';
const SESSION_ID = `ses_${'0'.repeat(25)}W`;
const KID = 'fake-world-1';
const capability = randomBytes(24).toString('base64url');
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

const record = {
  sess: [],
  unauthorized: 0,
  creates: 0,
  publishes: [],
  completes: 0,
  completeChecked: false,
  interactions: [],
  pollsBeforeAnswer: [],
  weather: [],
  refused: [],
  status: null,
};
if (active)
  process.on('exit', () => {
    record.status = session?.status ?? null;
    writeFileSync(config.record, JSON.stringify(record, null, 2));
  });

let session;
let unansweredPolls = 0;
let metCalls = 0;

const canonical = (value) =>
  Array.isArray(value)
    ? `[${value.map(canonical).join(',')}]`
    : value !== null && typeof value === 'object'
      ? `{${Object.keys(value)
          .sort()
          .map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`)
          .join(',')}}`
      : JSON.stringify(value);
const digest = (value) => `sha256:${createHash('sha256').update(canonical(value)).digest('hex')}`;
const etag = () => `"${session.revision}-${session.status}"`;
const json = (status, body, headers = {}) =>
  new Response(body === undefined ? null : JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  });
const authed = (status, body) => json(status, body, { etag: etag(), 'sess-workspace-id': WORKSPACE });
const error = (status, code) => json(status, { error: { code, request_id: 'fake', message: code } });

/** The scripted person answers the current revision with the configured data. */
function personAnswers() {
  const revision = session.revision;
  const data = config.answers[revision - 1];
  const action = session.interaction.actions[0];
  const millis = Date.now();
  const acceptedAt = new Date(millis).toISOString();
  const eventId = `evt_${String(revision).padStart(26, '0')}`;
  const claims = {
    sess_receipt: 1,
    iss: API,
    aud: WORKSPACE,
    jti: eventId,
    iat: Math.floor(millis / 1000),
    exp: Math.floor(millis / 1000) + 3600,
    accepted_at: acceptedAt,
    workspace_id: WORKSPACE,
    session_id: SESSION_ID,
    step_id: `rev_${revision}`,
    event_id: eventId,
    surface: { revision, hash: digest(session.interaction), renderer_version: 'sess-html-form-1' },
    action: { id: action.id, label: action.label, summary: action.intent ?? '' },
    // tamper: the receipt of that revision binds different input, so verification must fail.
    input_hash: digest(config.tamper === revision ? { ...data, tampered: true } : data),
    actor: { assurance: 'link_holder', subject: `${WORKSPACE}:human_link:${SESSION_ID}` },
    return_binding: { recipient: WORKSPACE, return_channel_id: null },
  };
  const header = Buffer.from(JSON.stringify({ alg: 'EdDSA', kid: KID, typ: 'sess-receipt+jwt' })).toString(
    'base64url',
  );
  const input = `${header}.${Buffer.from(canonical(claims)).toString('base64url')}`;
  const receipt = `${input}.${sign(null, Buffer.from(input), privateKey).toString('base64url')}`;
  session.responses.push({
    event_id: eventId,
    sequence: revision,
    revision,
    action_id: action.id,
    data,
    actor: { assurance: 'link_holder' },
    accepted_at: acceptedAt,
    receipt,
  });
  session.status = 'responded';
  record.pollsBeforeAnswer.push(unansweredPolls);
}

/** The `lapsed` world's link timing for the current read. */
function linkTiming() {
  const now = Date.now();
  const iso = (ms) => new Date(ms).toISOString();
  const deadline = now - 3_600_000;
  const horizon = now + 3_600_000;
  if (session.status === 'active')
    return {
      action_expires_at: iso(deadline),
      action_expires_horizon: iso(horizon),
      extensions_used: 0,
      link_state: 'lapsed',
      extensions: [],
    };
  const extended = {
    number: 1,
    previous_action_expires_at: iso(deadline),
    action_expires_at: iso(now + 600_000),
    from_lapsed: true,
    extended_at: iso(now - 1000),
  };
  return {
    action_expires_at: extended.action_expires_at,
    action_expires_horizon: iso(horizon),
    extensions_used: 1,
    link_state: 'live',
    extensions: [extended],
  };
}

function store(interaction, revision) {
  const normalized = { ...interaction, response_policy: 'first' };
  record.interactions.push(normalized);
  session.surfaces[revision] = normalized;
  session.interaction = normalized;
}

async function sessApi(url, init, headers) {
  const path = url.pathname;
  const method = init.method;
  record.sess.push(`${method} ${path}`);
  if (method === 'GET' && path === '/.well-known/sess-receipt-keys.json') return json(200, keySet);
  if (headers.get('authorization') !== `Bearer ${config.apiKey}`) {
    record.unauthorized++;
    return error(401, 'UNAUTHENTICATED');
  }
  const body = init.body ? JSON.parse(String(init.body)) : undefined;
  if (method === 'POST' && path === '/v1/sessions') {
    record.creates++;
    if (session) return error(409, 'UNEXPECTED_SECOND_CREATE');
    session = { revision: 1, status: 'active', responses: [], surfaces: {} };
    store(body.interaction, 1);
    return json(
      201,
      { id: SESSION_ID, revision: 1, human_url: `https://app.sess.si/s/${capability}` },
      { etag: etag(), 'sess-workspace-id': WORKSPACE },
    );
  }
  const base = `/v1/sessions/${SESSION_ID}`;
  if (!session || !path.startsWith(base)) return error(404, 'NOT_FOUND');
  const rest = path.slice(base.length);
  const view = () => ({
    id: SESSION_ID,
    revision: session.revision,
    status: session.status,
    interaction: session.interaction,
    response_schema: { type: 'object' },
    responses: session.responses,
    ...(config.lapsed === true ? linkTiming() : {}),
  });
  if (method === 'GET' && rest === '') {
    if (session.status === 'active') {
      if (unansweredPolls >= 1) personAnswers();
      else unansweredPolls++;
    }
    return authed(200, view());
  }
  const surface = /^\/surfaces\/(\d+)$/.exec(rest);
  if (method === 'GET' && surface) {
    const revision = Number(surface[1]);
    const interaction = session.surfaces[revision];
    if (!interaction) return error(404, 'NOT_FOUND');
    return authed(200, { id: SESSION_ID, revision, interaction, response_schema: { type: 'object' } });
  }
  const ifMatch = headers.get('if-match');
  const key = headers.get('idempotency-key');
  if (method === 'PATCH' && rest === '') {
    record.publishes.push({ ifMatch, key, current: etag() });
    if (ifMatch !== etag() || !key || session.status !== 'responded')
      return error(412, 'PRECONDITION_FAILED');
    session.revision++;
    session.status = 'active';
    unansweredPolls = 0;
    store(body.interaction, session.revision);
    return authed(200, view());
  }
  if (method === 'POST' && rest === '/complete') {
    record.completes++;
    if (ifMatch !== etag() || !key || session.status !== 'responded')
      return error(412, 'PRECONDITION_FAILED');
    record.completeChecked = true;
    session.status = 'completed';
    return authed(200, view());
  }
  return error(404, 'NOT_FOUND');
}

/** Hourly MET Norway `compact` steps from yesterday (UTC) for 10 days: 18 °C, 3 m/s, dry. */
function metForecast() {
  const start = (Math.floor(Date.now() / 86_400_000) - 1) * 86_400_000;
  const timeseries = Array.from({ length: 10 * 24 }, (_, i) => ({
    time: new Date(start + i * 3_600_000).toISOString().replace('.000Z', 'Z'),
    data: {
      instant: { details: { air_temperature: 18, wind_speed: 3 } },
      next_1_hours: { summary: { symbol_code: 'clearsky_day' }, details: { precipitation_amount: 0 } },
    },
  }));
  return { type: 'Feature', properties: { meta: { updated_at: new Date(start).toISOString() }, timeseries } };
}

function weather(url, init, headers) {
  const entry = {
    url: url.href,
    userAgent: headers.get('user-agent'),
    accept: headers.get('accept'),
    ifModifiedSince: headers.get('if-modified-since'),
    redirect: init.redirect,
  };
  record.weather.push(entry);
  const cache = {
    expires: new Date(Date.now() + 3_600_000).toUTCString(),
    'last-modified': 'Thu, 15 Oct 2026 06:00:00 GMT',
  };
  if (url.hostname === 'api.met.no') {
    metCalls++;
    if (config.met === 'outage') return json(503, undefined, { 'retry-after': '0' });
    if (config.met === 'busy' && metCalls === 1) return json(429, undefined, { 'retry-after': '0' });
    if (config.met === 'revalidate' && entry.ifModifiedSince)
      return new Response(null, { status: 304, headers: cache });
    return json(200, metForecast(), cache);
  }
  if (config.nws === 'outage') return json(503, undefined, { 'retry-after': '0' });
  return json(
    200,
    {
      type: 'FeatureCollection',
      features: [{ properties: { event: 'Heat Advisory', headline: 'Heat Advisory until 8 PM' } }],
    },
    { ...cache, 'content-type': 'application/geo+json' },
  );
}

const realFetch = globalThis.fetch;
if (active)
  globalThis.fetch = async (input, init) => {
    const request = new Request(input, init);
    const url = new URL(request.url);
    const body = request.method === 'GET' ? '' : await request.text();
    const seen = { method: request.method, body, redirect: request.redirect };
    if (url.origin === API) return sessApi(url, seen, request.headers);
    if (url.origin === 'https://api.met.no' || url.origin === 'https://api.weather.gov') {
      if (config.weather !== 'live') return weather(url, seen, request.headers);
      const response = await realFetch(request);
      record.weather.push({ url: url.href, live: response.status });
      return response;
    }
    record.refused.push(url.origin);
    throw new TypeError('fake-world: network access refused');
  };
