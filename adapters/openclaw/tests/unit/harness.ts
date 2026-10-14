// Test doubles for the HOST boundary only (keyed store, invocation guard, registration API) and
// a stateful synthetic SESS HTTP API. SDK transport, decoding and receipt verification are real.
import { createHash, createPrivateKey, createPublicKey, sign } from 'node:crypto';
import { readFileSync } from 'node:fs';

export const ORIGIN = 'https://api.sess.example';
export const WORKSPACE = 'wks_synthetic_one';
export const API_KEY_ENV = 'SESS_TEST_KEY';
export const API_KEY = 'test-owner-credential';
export const HUMAN_URL = `${ORIGIN}/s/${'A'.repeat(43)}`;

export const fixtures = (name: string) =>
  JSON.parse(readFileSync(new URL(`../../../fixtures/plan-afternoon/${name}`, import.meta.url), 'utf8'));

// RFC 8032 section 7.1 test 1 public test vector; never a runtime secret.
const seed = '9d61b19deffd5a60ba844af492ec2cc44449c5697b326919703bac031cae7f60';
const privateKey = createPrivateKey({
  key: Buffer.from(`302e020100300506032b657004220420${seed}`, 'hex'),
  type: 'pkcs8',
  format: 'der',
});
const publicX = createPublicKey(privateKey).export({ format: 'jwk' }).x as string;

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value !== null && typeof value === 'object')
    return `{${Object.keys(value)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${canonical((value as Record<string, unknown>)[k])}`)
      .join(',')}}`;
  return JSON.stringify(value);
}
const digest = (value: unknown) => `sha256:${createHash('sha256').update(canonical(value)).digest('hex')}`;

function signReceipt(claims: unknown): string {
  const header = Buffer.from(
    JSON.stringify({ alg: 'EdDSA', kid: 'rfc8032-test-1', typ: 'sess-receipt+jwt' }),
  ).toString('base64url');
  const input = `${header}.${Buffer.from(canonical(claims)).toString('base64url')}`;
  return `${input}.${sign(null, Buffer.from(input), privateKey).toString('base64url')}`;
}

interface FakeResponse {
  event_id: string;
  sequence: number;
  revision: number;
  action_id: string;
  data: Record<string, unknown>;
  actor: { assurance: 'link_holder' };
  accepted_at: string;
  receipt: string | null;
}

/** Stateful synthetic SESS API. Records every request; never contacts a network. */
export class FakeSess {
  sessionId = 'ses_01JABCDEFGHJKMNPQRSTVWXYZ0';
  revision = 0;
  status: 'active' | 'responded' | 'completed' = 'active';
  surfaces = new Map<number, unknown>();
  responses: FakeResponse[] = [];
  requests: { method: string; path: string; headers: Record<string, string>; body?: unknown }[] = [];
  /** Optional per-request override (fault injection). */
  intercept?: (method: string, path: string) => Response | Promise<Response> | undefined;
  private mutations = new Map<string, unknown>();

  answer(
    revision: number,
    actionId: string,
    data: Record<string, unknown>,
    opts: { tamper?: boolean; noReceipt?: boolean } = {},
  ) {
    const acceptedAt = new Date(Date.now() - 1000).toISOString();
    const eventId = `evt_01JABCDEFGHJKMNPQRSTVWXY${String(this.responses.length + 1).padStart(2, '0')}`;
    const interaction = {
      response_policy: 'first',
      ...(this.surfaces.get(revision) as object),
    } as unknown as {
      actions: { id: string; label: string; intent?: string }[];
    };
    const action = interaction.actions.find((a) => a.id === actionId)!;
    const claims = {
      sess_receipt: 1,
      iss: ORIGIN,
      aud: WORKSPACE,
      jti: eventId,
      iat: Math.floor(Date.now() / 1000) - 1,
      exp: Math.floor(Date.now() / 1000) + 3600,
      accepted_at: acceptedAt,
      workspace_id: WORKSPACE,
      session_id: this.sessionId,
      step_id: `rev_${revision}`,
      event_id: eventId,
      surface: { revision, hash: digest(interaction), renderer_version: 'sess-html-form-1' },
      action: { id: actionId, label: action.label, summary: action.intent ?? '' },
      input_hash: digest(data),
      actor: { assurance: 'link_holder', subject: `${WORKSPACE}:human_link:${this.sessionId}` },
      return_binding: { recipient: WORKSPACE, return_channel_id: null },
    };
    this.responses.push({
      event_id: eventId,
      sequence: this.responses.length + 1,
      revision,
      action_id: actionId,
      data: opts.tamper ? { ...data, tampered: true } : data,
      actor: { assurance: 'link_holder' },
      accepted_at: acceptedAt,
      receipt: opts.noReceipt ? null : signReceipt(claims),
    });
    this.status = 'responded';
    return eventId;
  }

  private session() {
    return {
      id: this.sessionId,
      status: this.status,
      revision: this.revision,
      interaction: { response_policy: 'first', ...(this.surfaces.get(this.revision) as object) },
      response_schema: { type: 'object' },
      responses: this.responses,
    };
  }

  private json(status: number, body: unknown, versioned = false) {
    const headers: Record<string, string> = {
      'content-type': 'application/json',
      'sess-workspace-id': WORKSPACE,
    };
    if (versioned) headers.etag = `"r${this.revision}-${this.status}"`;
    return new Response(JSON.stringify(body), { status, headers });
  }

  fetch = async (input: string | URL | Request, init: RequestInit = {}): Promise<Response> => {
    const url = new URL(typeof input === 'string' || input instanceof URL ? input : input.url);
    const method = init.method ?? 'GET';
    const headers = Object.fromEntries(new Headers(init.headers).entries());
    const body = typeof init.body === 'string' ? JSON.parse(init.body) : undefined;
    this.requests.push({ method, path: url.pathname, headers, body });
    if (url.origin !== ORIGIN) throw new Error('fake SESS received a request for another origin');
    const injected = await this.intercept?.(method, url.pathname);
    if (injected) return injected;
    const base = `/v1/sessions/${this.sessionId}`;
    if (method === 'GET' && url.pathname === '/.well-known/sess-receipt-keys.json')
      return this.json(200, {
        keys: [
          {
            kty: 'OKP',
            crv: 'Ed25519',
            x: publicX,
            kid: 'rfc8032-test-1',
            alg: 'EdDSA',
            use: 'sig',
            key_ops: ['verify'],
          },
        ],
      });
    if (method === 'POST' && url.pathname === '/v1/sessions') {
      this.revision = 1;
      this.surfaces.set(1, body.interaction);
      return this.json(201, { id: this.sessionId, revision: 1, human_url: HUMAN_URL }, true);
    }
    if (method === 'GET' && url.pathname === base) return this.json(200, this.session(), true);
    const surface = url.pathname.match(/\/surfaces\/(\d+)$/);
    if (method === 'GET' && surface)
      return this.json(200, {
        id: this.sessionId,
        revision: Number(surface[1]),
        interaction: { response_policy: 'first', ...(this.surfaces.get(Number(surface[1])) as object) },
        response_schema: { type: 'object' },
      });
    if (
      (method === 'PATCH' && url.pathname === base) ||
      (method === 'POST' && url.pathname === `${base}/complete`)
    ) {
      const key = headers['idempotency-key'] ?? '';
      if (this.mutations.has(key)) return this.json(200, this.mutations.get(key), true);
      if (headers['if-match'] !== `"r${this.revision}-${this.status}"`)
        return this.json(412, { error: { code: 'SESSION_REVISION_CONFLICT', message: 'stale' } });
      if (method === 'PATCH') {
        this.revision += 1;
        this.surfaces.set(this.revision, body.interaction);
        this.status = 'active';
      } else this.status = 'completed';
      const result = this.session();
      this.mutations.set(key, result);
      return this.json(200, result, true);
    }
    return this.json(404, { error: { code: 'NOT_FOUND', message: 'not found' } });
  };
}

/** In-memory double of the public PluginStateKeyedStore with withCurrent/observe/compareAndApply. */
export class FakeKeyedStore {
  rows = new Map<string, string>();
  writes = 0;
  withCurrent({ assertCurrent }: { assertCurrent: () => void }) {
    const rows = this.rows;
    const self = this;
    return {
      async observe(key: string) {
        assertCurrent();
        const raw = rows.get(key);
        return { value: raw === undefined ? undefined : JSON.parse(raw), comparison: raw ?? '<absent>' };
      },
      async compareAndApply(key: string, comparison: string, intent: { value: unknown }) {
        assertCurrent();
        if ((rows.get(key) ?? '<absent>') !== comparison)
          return { status: 'conflict', current: { value: undefined, comparison: '' } };
        rows.set(key, JSON.stringify(intent.value));
        self.writes++;
        return { status: 'applied' };
      },
      async registerIfAbsent(key: string, value: unknown) {
        assertCurrent();
        if (rows.has(key)) return false;
        rows.set(key, JSON.stringify(value));
        self.writes++;
        return true;
      },
      async lookup(key: string) {
        assertCurrent();
        const raw = rows.get(key);
        return raw === undefined ? undefined : JSON.parse(raw);
      },
    };
  }
}

export interface FakeHost {
  store: FakeKeyedStore;
  tools: Map<string, { create: (ctx: unknown) => any }>;
  cli: unknown[];
  openCount: number;
}

/** Calls the real plugin entry's register() with a minimal fake registration API. */
export async function registerPlugin(
  pluginConfig: Record<string, unknown> = { baseUrl: ORIGIN, apiKeyEnv: API_KEY_ENV, waitBudgetMs: 1000 },
) {
  const entry = (await import('../../src/index.js')).default as { register: (api: unknown) => void };
  const host: FakeHost = { store: new FakeKeyedStore(), tools: new Map(), cli: [], openCount: 0 };
  entry.register({
    id: 'sess',
    pluginConfig,
    runtime: {
      state: {
        openKeyedStore: () => {
          host.openCount++;
          return host.store;
        },
      },
    },
    registerTool: (
      factory: { contextVersion: number; create: (ctx: unknown) => unknown },
      opts: { name: string },
    ) => host.tools.set(opts.name, factory as never),
    registerCli: (registrar: unknown) => host.cli.push(registrar),
  });
  return host;
}

export interface Conversation {
  agentId: string;
  sessionKey: string;
  sessionId: string;
  revoked: boolean;
}

export function conversation(overrides: Partial<Conversation> = {}): Conversation {
  return {
    agentId: 'main',
    sessionKey: 'agent:main:dashboard:one',
    sessionId: 'incarnation-1',
    revoked: false,
    ...overrides,
  };
}

let callCounter = 0;
export async function call(
  host: FakeHost,
  name: string,
  conv: Conversation,
  args: unknown,
  opts: { toolCallId?: string; signal?: AbortSignal } = {},
) {
  const tool = host.tools.get(name)!.create({
    agentId: conv.agentId,
    sessionKey: conv.sessionKey,
    sessionId: conv.sessionId,
    assertInvocationCurrent: () => {
      if (conv.revoked) throw new Error('revoked');
    },
  });
  return tool.execute(opts.toolCallId ?? `call-${++callCounter}`, args, opts.signal);
}
