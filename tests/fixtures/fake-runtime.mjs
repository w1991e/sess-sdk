// A synthetic SESS runtime for tests and the packed-consumer check. Plain JavaScript with no
// dependencies, so the packed package can be exercised without the SDK source. It signs real
// receipts with an ephemeral Ed25519 key generated per instance; nothing here is a credential.
import { createHash, generateKeyPairSync, sign } from 'node:crypto';

export const FAKE_SESSION_ID = 'ses_01JABCDEFGHJKMNPQRSTVWXYZA';
export const FAKE_WORKSPACE = 'wks_synthetic_ask';
export const FAKE_ISSUER = 'https://api.sess.si';
export const FAKE_LINK = 'https://human.example/s/synthetic-ask-link';
export const FAKE_ASK_ID = `ask_01JASK${'0'.repeat(20)}`;
export const FAKE_ASK_LINK = 'https://human.example/n/synthetic-one-link';

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
 * createFakeRuntime({ autoAnswer, autoRespondents }) returns a fetch implementation and controls.
 * autoAnswer is answer data (or a function of the stored interaction) submitted on the first owner
 * read after creation, as a person would after receiving the link. autoRespondents is a list for an
 * Ask: on its first read, one person starts for each entry and answers with it (null: starts only).
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
  const counts = {
    create: 0,
    retrieve: 0,
    surface: 0,
    complete: 0,
    keys: 0,
    askCreate: 0,
    askRead: 0,
    askClose: 0,
    respondentRetrieve: 0,
  };
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

  /** Accepts `data` on the target Session's current revision with a genuinely signed receipt. */
  function accept(target, data) {
    const revision = target.revision;
    const now = Date.now();
    const acceptedAt = new Date(now).toISOString();
    const eventId = `evt_${String(++sequence).padStart(26, '0')}`;
    const action = target.interaction.actions[0];
    const claims = {
      sess_receipt: 1,
      iss: FAKE_ISSUER,
      aud: FAKE_WORKSPACE,
      jti: eventId,
      iat: Math.floor(now / 1000),
      exp: Math.floor(now / 1000) + 3600,
      accepted_at: acceptedAt,
      workspace_id: FAKE_WORKSPACE,
      session_id: target.id,
      step_id: `rev_${revision}`,
      event_id: eventId,
      surface: { revision, hash: digest(target.interaction), renderer_version: 'sess-html-form-1' },
      action: { id: action.id, label: action.label, summary: action.intent ?? '' },
      input_hash: digest(data),
      actor: { assurance: 'link_holder', subject: `${FAKE_WORKSPACE}:human_link:${target.id}` },
      return_binding: { recipient: FAKE_WORKSPACE, return_channel_id: null },
    };
    const input = `${header}.${Buffer.from(canonical(claims)).toString('base64url')}`;
    const receipt = `${input}.${sign(null, Buffer.from(input), privateKey).toString('base64url')}`;
    target.responses.push({
      event_id: eventId,
      sequence,
      revision,
      action_id: action.id,
      data: clone(data),
      actor: { assurance: 'link_holder' },
      accepted_at: acceptedAt,
      receipt,
    });
    target.status = 'responded';
    return { eventId, acceptedAt };
  }
  function answer(data) {
    if (!session || session.status !== 'active') throw new Error('No active revision to answer');
    const { eventId } = accept(session, data);
    version++;
    return eventId;
  }

  // The Ask (Sess Decision 0011): one link, and an ordinary Session for each person who starts.
  let ask;
  const respondents = [];
  let autoRespondents = options.autoRespondents;
  const askPath = `/v1/asks/${FAKE_ASK_ID}`;
  const askNow = () => {
    if (ask.closedBy === null && Date.now() >= Date.parse(ask.expiresAt))
      return { status: 'closed', closed_by: 'deadline', closed_at: ask.expiresAt };
    return ask.closedBy === null
      ? { status: 'open', closed_by: null, closed_at: null }
      : { status: 'closed', closed_by: ask.closedBy, closed_at: ask.closedAt };
  };
  const askSummary = () => ({
    id: FAKE_ASK_ID,
    ...askNow(),
    max: ask.max,
    action_expires_at: ask.expiresAt,
    auto_complete: ask.autoComplete,
    counts: {
      started: respondents.length,
      answered: respondents.filter((r) => r.responses.length).length,
      completed: respondents.filter((r) => r.status === 'completed').length,
      refused: { ...ask.refused },
    },
  });
  /** A person presses Start: a new respondent Session at revision 1, a copy of round one. */
  function start() {
    if (!ask) throw new Error('No Ask to start');
    if (askNow().status === 'closed') {
      ask.refused[ask.closedBy === 'owner' ? 'closed' : ask.closedBy === 'max' ? 'full' : 'deadline']++;
      return undefined;
    }
    const id = `ses_01JRESP${String(respondents.length + 1).padStart(19, '0')}`;
    const respondent = {
      id,
      revision: 1,
      status: 'active',
      interaction: clone(ask.interaction),
      response_schema: { type: 'object' },
      responses: [],
      started_at: new Date().toISOString(),
      completed_at: null,
    };
    respondents.push(respondent);
    if (respondents.length === ask.max) {
      ask.closedBy = 'max';
      ask.closedAt = new Date().toISOString();
    }
    return id;
  }
  /** That respondent answers; with auto_complete their Session completes in the same step. */
  function answerRespondent(id, data) {
    const respondent = respondents.find((r) => r.id === id);
    if (!respondent || respondent.status !== 'active' || respondent.revoked)
      throw new Error('No active respondent to answer');
    const { acceptedAt } = accept(respondent, data);
    if (ask.autoComplete) {
      respondent.status = 'completed';
      respondent.completed_at = acceptedAt;
    }
    return respondent.responses.at(-1).event_id;
  }
  const pick = (r) => ({
    id: r.id,
    status: r.status,
    revision: r.revision,
    started_at: r.started_at,
    completed_at: r.completed_at,
  });
  const respondentView = (r) => ({
    id: r.id,
    status: r.status,
    revision: r.revision,
    interaction: clone(r.interaction),
    response_schema: clone(r.response_schema),
    responses: clone(r.responses),
  });
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
    if (method === 'POST' && path === '/v1/asks') {
      counts.askCreate++;
      const body = JSON.parse(String(init.body));
      const allowed = ['interaction', 'respondents', 'expires_in', 'respondent_expires_in', 'auto_complete'];
      const r = body.respondents ?? {};
      const fields = body.interaction?.source?.components?.filter((c) => c.type === 'field') ?? [];
      if (
        Object.keys(body).some((k) => !allowed.includes(k)) ||
        Object.keys(r).some((k) => !['max', 'name'].includes(k)) ||
        !Number.isInteger(r.max) ||
        r.max < 2 ||
        r.max > 25 ||
        (r.name === true && fields.some((f) => f.name === 'name'))
      )
        return failure(400, 'INVALID_SCHEMA');
      const components = clone(body.interaction.source.components);
      if (r.name === true)
        components.splice(
          components.findIndex((c) => c.type === 'field'),
          0,
          {
            type: 'field',
            name: 'name',
            label: 'Your name',
            required: true,
            schema: { type: 'string', minLength: 1, maxLength: 80 },
          },
        );
      ask = {
        body: clone(body),
        interaction: {
          ...clone(body.interaction),
          source: { ...body.interaction.source, components },
          response_policy: 'first',
        },
        max: r.max,
        autoComplete: body.auto_complete ?? true,
        expiresAt: new Date(Date.now() + (body.expires_in ?? 86400) * 1000).toISOString(),
        closedBy: null,
        closedAt: null,
        refused: { full: 0, closed: 0, deadline: 0, minimum_time: 0, burst: 0, paused: 0, network: 0 },
      };
      return reply(
        {
          id: FAKE_ASK_ID,
          revision: 1,
          human_url: FAKE_ASK_LINK,
          action_expires_at: ask.expiresAt,
          max: ask.max,
        },
        201,
        { location: askPath },
      );
    }
    if (path.startsWith('/v1/asks/')) {
      if (!ask || !(path === askPath || path === `${askPath}/close`)) return failure(404, 'NOT_FOUND');
      if (method === 'GET' && path === askPath) {
        counts.askRead++;
        if (autoRespondents !== undefined) {
          for (const data of autoRespondents) {
            const id = start();
            if (id && data !== null) answerRespondent(id, data);
          }
          autoRespondents = undefined;
        }
        const query = new URL(String(url)).searchParams;
        const from = query.has('cursor') ? Number(query.get('cursor').slice(1)) : 0;
        const limit = query.has('limit') ? Number(query.get('limit')) : 100;
        const page = respondents
          .slice(from, from + limit)
          .map((r) =>
            r.purged
              ? { ...pick(r), status: 'purged', responses: [] }
              : { ...pick(r), responses: clone(r.responses) },
          );
        const more = from + limit < respondents.length;
        return reply({ ...askSummary(), sessions: page, next_cursor: more ? `c${from + limit}` : null });
      }
      if (method === 'POST' && path === `${askPath}/close`) {
        counts.askClose++;
        if (askNow().status === 'open') {
          ask.closedBy = 'owner';
          ask.closedAt = new Date().toISOString();
          // The owner's close ends the links of respondents who have not answered.
          for (const r of respondents) if (!r.responses.length) r.revoked = true;
        }
        return reply(askSummary());
      }
      return failure(404, 'NOT_FOUND');
    }
    const respondent = respondents.find((r) => path.startsWith(`/v1/sessions/${r.id}`));
    if (respondent && method === 'GET') {
      const rest = path.slice(`/v1/sessions/${respondent.id}`.length);
      if (rest === '') {
        counts.respondentRetrieve++;
        return reply(respondentView(respondent), 200, {
          etag: `"${respondent.id}-${respondent.status}-${respondent.responses.length}"`,
          'sess-workspace-id': FAKE_WORKSPACE,
        });
      }
      if (rest === '/surfaces/1') {
        counts.surface++;
        return reply(
          {
            id: respondent.id,
            revision: 1,
            interaction: clone(respondent.interaction),
            response_schema: clone(respondent.response_schema),
          },
          200,
          { 'sess-workspace-id': FAKE_WORKSPACE },
        );
      }
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
    start,
    answerRespondent,
    setAutoRespondents(next) {
      autoRespondents = next;
    },
    /** Deletes a respondent's content after its retention: the read lists a tombstone. */
    purge(id) {
      respondents.find((r) => r.id === id).purged = true;
    },
    /** Rewrites a respondent's stored round one (a runtime that does not bind it to the Ask). */
    tamper(id, change) {
      change(respondents.find((r) => r.id === id));
    },
    expireAsk() {
      ask.expiresAt = new Date(Date.now() - 1000).toISOString();
    },
    ask: () => (ask ? clone({ body: ask.body, interaction: ask.interaction }) : undefined),
    respondents: () => clone(respondents),
  };
}
