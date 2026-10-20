import { createHash, generateKeyPairSync, randomBytes, sign, type KeyObject } from 'node:crypto';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { canonicalJson } from '../src/internal/shared.js';

type Json = Record<string, any>;

export interface StubCall {
  method: string;
  path: string;
  authorization: string | null;
}

interface StubTrial {
  workspaceId: string;
  expiresAt: number;
  created: number;
  deleted: boolean;
}

interface StubSession {
  credential: string;
  id: string;
  revision: number;
  status: 'active' | 'responded' | 'completed';
  interaction: Json;
  response_schema: Json;
  responses: Json[];
  actionExpiresAt: number;
  humanUrl: string;
}

/**
 * A deterministic stand-in for Sess's no-signup trial routes (POST and GET /v1/trial/sessions, the
 * receipt keys) with the published limits, served as a fetch function or as a real loopback HTTP
 * server. Owner routes answer 401 UNAUTHORIZED, as for an invalid or revoked key. Synthetic data
 * only: credentials, links and receipt keys are generated per stub.
 */
export class TrialStub {
  origin: string;
  calls: StubCall[] = [];
  trials = new Map<string, StubTrial>();
  sessions = new Map<string, StubSession>();
  limits = { maxActive: 3, maxCreated: 10, maxNewTrials: 3, linkMs: 3_600_000, windowMs: 86_400_000 };
  newTrials = 0;
  /** The next trial create: a network failure after Sess applied it (the response is lost). */
  loseNextCreate = false;
  /** Delays every create response (to overlap concurrent first calls). */
  createDelayMs = 0;
  #sequence = 0;
  #receiptKey = generateKeyPairSync('ed25519');
  #server: http.Server | undefined;

  constructor(origin = 'https://api.sess.test') {
    this.origin = origin;
  }

  /** Every credential this stub issued (for leak scans). */
  credentials(): string[] {
    return [...this.trials.keys()];
  }

  anonymousCreates(): StubCall[] {
    return this.calls.filter(
      (c) => c.method === 'POST' && c.path === '/v1/trial/sessions' && !c.authorization,
    );
  }

  /** Records the person's answer on the Sess link, with a genuinely signed receipt. */
  answer(sessionId: string, data: Json, options: { actionId?: string; privateKey?: KeyObject } = {}): string {
    const s = this.sessions.get(sessionId)!;
    const trial = this.trials.get(s.credential)!;
    const actionId = options.actionId ?? 'submit';
    const eventId = `evt_${String(++this.#sequence).padStart(26, '0')}`;
    const acceptedMillis = Math.floor(Date.now() / 1000) * 1000 - 1000;
    const acceptedAt = new Date(acceptedMillis).toISOString();
    const action = (s.interaction.actions as Json[]).find((a) => a.id === actionId)!;
    const digest = (value: unknown) =>
      `sha256:${createHash('sha256').update(canonicalJson(value)).digest('hex')}`;
    const workspace = trial.workspaceId;
    const claims = {
      sess_receipt: 1,
      iss: this.origin,
      aud: workspace,
      jti: eventId,
      iat: acceptedMillis / 1000,
      exp: acceptedMillis / 1000 + 3600,
      accepted_at: acceptedAt,
      workspace_id: workspace,
      session_id: s.id,
      step_id: `rev_${s.revision}`,
      event_id: eventId,
      surface: { revision: s.revision, hash: digest(s.interaction), renderer_version: 'sess-html-form-1' },
      action: { id: action.id, label: action.label, summary: action.intent ?? '' },
      input_hash: digest(data),
      actor: { assurance: 'link_holder', subject: `${workspace}:human_link:${s.id}` },
      return_binding: { recipient: workspace, return_channel_id: null },
    };
    const header = { alg: 'EdDSA', kid: 'trial-stub-1', typ: 'sess-receipt+jwt' };
    const input = `${Buffer.from(JSON.stringify(header)).toString('base64url')}.${Buffer.from(
      canonicalJson(claims),
    ).toString('base64url')}`;
    const receipt = `${input}.${sign(null, Buffer.from(input), options.privateKey ?? this.#receiptKey.privateKey).toString('base64url')}`;
    s.responses.push({
      event_id: eventId,
      sequence: s.responses.length + 1,
      revision: s.revision,
      action_id: actionId,
      data,
      actor: { assurance: 'link_holder' },
      accepted_at: acceptedAt,
      receipt,
    });
    s.status = 'responded';
    return eventId;
  }

  #json(status: number, body: unknown, headers: Record<string, string> = {}): Response {
    return new Response(JSON.stringify(body), {
      status,
      headers: { 'content-type': 'application/json; charset=utf-8', ...headers },
    });
  }

  #error(status: number, code: string, headers: Record<string, string> = {}): Response {
    // The message is for people; clients rely on the code (and Retry-After) only.
    return this.#json(
      status,
      { error: { code, message: 'Synthetic stub message.', request_id: 'req_stub' } },
      headers,
    );
  }

  #active(credential: string): number {
    const now = Date.now();
    return [...this.sessions.values()].filter(
      (s) => s.credential === credential && s.status === 'active' && s.actionExpiresAt > now,
    ).length;
  }

  fetch = async (input: string | URL | Request, init: RequestInit = {}): Promise<Response> => {
    const url = new URL(typeof input === 'string' || input instanceof URL ? input : input.url);
    const headers = new Headers(init.headers);
    const method = (init.method ?? 'GET').toUpperCase();
    const body = typeof init.body === 'string' ? init.body : undefined;
    return this.handle(method, url.pathname, headers, body);
  };

  async handle(method: string, path: string, headers: Headers, body: string | undefined): Promise<Response> {
    const authorization = headers.get('authorization');
    this.calls.push({ method, path, authorization });
    if (method === 'GET' && path === '/.well-known/sess-receipt-keys.json')
      return this.#json(200, {
        keys: [
          {
            kty: 'OKP',
            crv: 'Ed25519',
            x: this.#receiptKey.publicKey.export({ format: 'jwk' }).x,
            kid: 'trial-stub-1',
            alg: 'EdDSA',
            use: 'sig',
            key_ops: ['verify'],
          },
        ],
      });
    if (path.startsWith('/v1/sessions')) return this.#error(401, 'UNAUTHORIZED');
    if (!path.startsWith('/v1/trial/')) return this.#error(404, 'NOT_FOUND');
    let trial: StubTrial | undefined;
    let credential: string | undefined;
    if (authorization !== null) {
      credential = /^Bearer (sess_mg_[A-Za-z0-9_-]{43})$/.exec(authorization)?.[1];
      trial = credential ? this.trials.get(credential) : undefined;
      if (!trial || trial.deleted) return this.#error(404, 'NOT_FOUND');
    }
    if (method === 'POST' && path === '/v1/trial/sessions') {
      if (headers.get('idempotency-key') !== null) return this.#error(400, 'INVALID_SCHEMA');
      const request = JSON.parse(body ?? 'null') as Json;
      if (!request || Object.keys(request).join() !== 'interaction')
        return this.#error(400, 'INVALID_SCHEMA');
      if (this.createDelayMs) await new Promise((r) => setTimeout(r, this.createDelayMs));
      const now = Date.now();
      if (!trial) {
        if (this.newTrials >= this.limits.maxNewTrials)
          return this.#error(429, 'RATE_LIMITED', { 'retry-after': '5400' });
        this.newTrials++;
        credential = `sess_mg_${randomBytes(32).toString('base64url').slice(0, 43)}`;
        trial = {
          workspaceId: `wks_${randomBytes(16).toString('hex')}`,
          expiresAt: now + this.limits.windowMs,
          created: 0,
          deleted: false,
        };
        this.trials.set(credential, trial);
      } else {
        if (now >= trial.expiresAt) return this.#error(429, 'RATE_LIMITED');
        if (trial.created >= this.limits.maxCreated) return this.#error(429, 'RATE_LIMITED');
        if (this.#active(credential!) >= this.limits.maxActive)
          return this.#error(429, 'RATE_LIMITED', { 'retry-after': '600' });
      }
      trial.created++;
      const id = `ses_${String(++this.#sequence).padStart(26, '0')}`;
      const humanUrl = `https://app.sess.test/s/${randomBytes(32).toString('base64url')}`;
      const session: StubSession = {
        credential: credential!,
        id,
        revision: 1,
        status: 'active',
        interaction: { ...request.interaction, response_policy: 'first' },
        response_schema: { type: 'object' },
        responses: [],
        actionExpiresAt: now + this.limits.linkMs,
        humanUrl,
      };
      this.sessions.set(id, session);
      const created = {
        id,
        revision: 1,
        human_url: humanUrl,
        workspace_id: trial.workspaceId,
        ...(authorization === null ? { management_credential: credential } : {}),
        action_expires_at: new Date(session.actionExpiresAt).toISOString(),
        result_available_until: new Date(session.actionExpiresAt + 86_400_000).toISOString(),
        trial_expires_at: new Date(trial.expiresAt).toISOString(),
      };
      if (this.loseNextCreate) {
        this.loseNextCreate = false;
        throw new TypeError('fetch failed');
      }
      return this.#json(201, created, { etag: '"1.0"', location: `/v1/trial/sessions/${id}` });
    }
    const read = /^\/v1\/trial\/sessions\/(ses_[0-9A-Z]{26})$/.exec(path);
    if (method === 'GET' && read) {
      const s = this.sessions.get(read[1]!);
      if (!trial || !s || s.credential !== credential) return this.#error(404, 'NOT_FOUND');
      return this.#json(
        200,
        {
          id: s.id,
          revision: s.revision,
          status: s.status,
          interaction: s.interaction,
          response_schema: s.response_schema,
          responses: s.responses,
          trial: {
            workspace_id: trial.workspaceId,
            action_expires_at: new Date(s.actionExpiresAt).toISOString(),
            result_available_until: new Date(s.actionExpiresAt + 86_400_000).toISOString(),
          },
        },
        { etag: `"1.${s.responses.length}"` },
      );
    }
    return this.#error(404, 'NOT_FOUND');
  }

  /** Serves the stub on a loopback port; the origin becomes http://127.0.0.1:<port>. */
  async listen(): Promise<string> {
    this.#server = http.createServer((req, res) => {
      const chunks: Buffer[] = [];
      req.on('data', (c: Buffer) => chunks.push(c));
      req.on('end', () => {
        const headers = new Headers();
        for (const [k, v] of Object.entries(req.headers)) if (typeof v === 'string') headers.set(k, v);
        const body = chunks.length ? Buffer.concat(chunks).toString('utf8') : undefined;
        this.handle(req.method ?? 'GET', req.url ?? '/', headers, body).then(
          async (response) => {
            res.writeHead(response.status, Object.fromEntries(response.headers.entries()));
            res.end(Buffer.from(await response.arrayBuffer()));
          },
          () => res.destroy(),
        );
      });
    });
    await new Promise<void>((resolve) => this.#server!.listen(0, '127.0.0.1', resolve));
    this.origin = `http://127.0.0.1:${(this.#server.address() as AddressInfo).port}`;
    return this.origin;
  }

  async close(): Promise<void> {
    if (this.#server) {
      this.#server.closeAllConnections();
      await new Promise<void>((resolve) => this.#server!.close(() => resolve()));
    }
  }
}
