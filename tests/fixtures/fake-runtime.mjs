// A synthetic SESS runtime for tests and the packed-consumer check. Plain JavaScript with no
// dependencies, so the packed package can be exercised without the SDK source. It signs real
// receipts with an ephemeral Ed25519 key generated per instance; nothing here is a credential.
import { createHash, generateKeyPairSync, sign } from 'node:crypto';

export const FAKE_SESSION_ID = 'ses_01JABCDEFGHJKMNPQRSTVWXYZA';
export const FAKE_WORKSPACE = 'wks_synthetic_ask';
export const FAKE_ISSUER = 'https://api.sess.si';
export const FAKE_LINK = 'https://human.example/s/synthetic-ask-link';

/** Independent JCS for the plain JSON used here (strings, finite numbers, booleans, null). */
export function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value !== null && typeof value === 'object')
    return `{${Object.keys(value)
      .filter((key) => value[key] !== undefined)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`)
      .join(',')}}`;
  return JSON.stringify(value);
}
const digest = (value) => `sha256:${createHash('sha256').update(canonical(value)).digest('hex')}`;
const clone = (value) => JSON.parse(JSON.stringify(value));

function reply(body, status = 200, headers = {}) {
  return new Response(body === undefined ? null : JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  });
}
function failure(status, code) {
  return reply({ error: { code, message: 'synthetic failure', request_id: 'request-synthetic' } }, status);
}

/**
 * createFakeRuntime({ autoAnswer }) returns a fetch implementation and controls. autoAnswer is
 * answer data (or a function of the stored interaction) submitted on the first owner read after
 * creation, as a person would after receiving the link.
 */
export function createFakeRuntime(options = {}) {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  const kid = 'synthetic-ask-1';
  const keys = {
    keys: [
      {
        kty: 'OKP',
        crv: 'Ed25519',
        x: publicKey.export({ format: 'jwk' }).x,
        kid,
        alg: 'EdDSA',
        use: 'sig',
        key_ops: ['verify'],
      },
    ],
  };
  const header = Buffer.from(JSON.stringify({ alg: 'EdDSA', kid, typ: 'sess-receipt+jwt' })).toString(
    'base64url',
  );
  const counts = { create: 0, retrieve: 0, surface: 0, complete: 0, keys: 0 };
  const requests = [];
  const surfaces = new Map();
  const completions = new Map();
  let session;
  let version = 0;
  let sequence = 0;
  let hook;
  let autoAnswer = options.autoAnswer;

  const etag = () => `"r${session.revision}-${session.status}-${version}"`;
  const headers = () => ({ etag: etag(), 'sess-workspace-id': FAKE_WORKSPACE });
  const sessionPath = `/v1/sessions/${FAKE_SESSION_ID}`;

  function answer(data) {
    if (!session || session.status !== 'active') throw new Error('No active revision to answer');
    const revision = session.revision;
    const now = Date.now();
    const acceptedAt = new Date(now).toISOString();
    const eventId = `evt_${String(++sequence).padStart(26, '0')}`;
    const action = session.interaction.actions[0];
    const claims = {
      sess_receipt: 1,
      iss: FAKE_ISSUER,
      aud: FAKE_WORKSPACE,
      jti: eventId,
      iat: Math.floor(now / 1000),
      exp: Math.floor(now / 1000) + 3600,
      accepted_at: acceptedAt,
      workspace_id: FAKE_WORKSPACE,
      session_id: FAKE_SESSION_ID,
      step_id: `rev_${revision}`,
      event_id: eventId,
      surface: { revision, hash: digest(session.interaction), renderer_version: 'sess-html-form-1' },
      action: { id: action.id, label: action.label, summary: action.intent ?? '' },
      input_hash: digest(data),
      actor: { assurance: 'link_holder', subject: `${FAKE_WORKSPACE}:human_link:${FAKE_SESSION_ID}` },
      return_binding: { recipient: FAKE_WORKSPACE, return_channel_id: null },
    };
    const input = `${header}.${Buffer.from(canonical(claims)).toString('base64url')}`;
    const receipt = `${input}.${sign(null, Buffer.from(input), privateKey).toString('base64url')}`;
    session.responses.push({
      event_id: eventId,
      sequence,
      revision,
      action_id: action.id,
      data: clone(data),
      actor: { assurance: 'link_holder' },
      accepted_at: acceptedAt,
      receipt,
    });
    session.status = 'responded';
    version++;
    return eventId;
  }
  function store(interaction) {
    session.interaction = { ...clone(interaction), response_policy: 'first' };
    surfaces.set(session.revision, {
      id: FAKE_SESSION_ID,
      revision: session.revision,
      interaction: clone(session.interaction),
      response_schema: { type: 'object' },
    });
  }
  function publish(interaction) {
    session.revision++;
    session.status = 'active';
    version++;
    store(interaction);
  }
  function completeNow() {
    session.status = 'completed';
    version++;
  }

  async function route(url, init = {}) {
    const method = init.method ?? 'GET';
    const path = new URL(String(url)).pathname;
    if (path === '/.well-known/sess-receipt-keys.json') {
      counts.keys++;
      return reply(keys);
    }
    if (method === 'POST' && path === '/v1/sessions') {
      counts.create++;
      const body = JSON.parse(String(init.body));
      session = { id: FAKE_SESSION_ID, revision: 1, status: 'active', responses: [] };
      session.response_schema = { type: 'object' };
      store(body.interaction);
      version++;
      return reply({ id: FAKE_SESSION_ID, revision: 1, human_url: FAKE_LINK }, 201, headers());
    }
    if (!session || !path.startsWith(sessionPath)) return failure(404, 'SESSION_NOT_FOUND');
    if (method === 'GET' && path === sessionPath) {
      counts.retrieve++;
      if (autoAnswer !== undefined && session.status === 'active') {
        answer(typeof autoAnswer === 'function' ? autoAnswer(clone(session.interaction)) : autoAnswer);
        autoAnswer = undefined;
      }
      return reply(clone(session), 200, headers());
    }
    const surface = /^\/surfaces\/(\d+)$/.exec(path.slice(sessionPath.length));
    if (method === 'GET' && surface) {
      counts.surface++;
      const found = surfaces.get(Number(surface[1]));
      return found
        ? reply(clone(found), 200, { 'sess-workspace-id': FAKE_WORKSPACE })
        : failure(404, 'NOT_FOUND');
    }
    if (method === 'POST' && path === `${sessionPath}/complete`) {
      counts.complete++;
      const given = new Headers(init.headers);
      const key = given.get('idempotency-key');
      const replayed = completions.get(key);
      if (replayed) return reply(clone(replayed.body), 200, replayed.headers);
      if (session.status === 'completed') return failure(409, 'SESSION_COMPLETED');
      if (given.get('if-match') !== etag()) return failure(412, 'SESSION_REVISION_CONFLICT');
      if (session.status !== 'responded') return failure(409, 'SESSION_REVISION_CONFLICT');
      completeNow();
      const saved = { body: clone(session), headers: headers() };
      completions.set(key, saved);
      return reply(clone(saved.body), 200, saved.headers);
    }
    return failure(404, 'NOT_FOUND');
  }

  /** The fetch given to the SDK. A hook may answer, fail, or delegate to route(). */
  async function fetch(url, init = {}) {
    const given = new Headers(init.headers);
    const method = init.method ?? 'GET';
    const path = new URL(String(url)).pathname;
    requests.push({
      method,
      path,
      ifMatch: given.get('if-match') ?? undefined,
      idempotencyKey: given.get('idempotency-key') ?? undefined,
    });
    if (hook) {
      const result = await hook({ method, path, url, init, route });
      if (result) return result;
    }
    return route(url, init);
  }

  return {
    fetch,
    route,
    keys,
    counts,
    requests,
    answer,
    publish,
    completeNow,
    setHook(next) {
      hook = next;
    },
    setAutoAnswer(next) {
      autoAnswer = next;
    },
    session: () => (session ? clone(session) : undefined),
  };
}
