// Loopback HTTP harness for the stateless HTTP composition: the real handler mounted on node:http
// through its node face, a token → principal table standing in for the hosted OAuth verifier, the
// hosted-style memory store and one fake SESS runtime per SESS credential. No external network.
import http from 'node:http';
import { Client as ModernClient, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import { Client as V1Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport as V1Transport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { Sess, type SessOptions } from '@sess.si/sdk';
import {
  createSessMcpHttpHandler,
  type PrincipalContext,
  type SessMcpHttpHandler,
  type SessMcpHttpHandlerOptions,
} from '../src/http.js';
import { shareLinkLines } from '../src/server.js';
import { FakeSess, ORIGIN } from './helpers.js';
import { MemoryHandleBackend } from './memory-store.js';

export const SCOPE = 'sess:interact';
export const RESOURCE_METADATA = 'https://mcp.sess.test/.well-known/oauth-protected-resource/mcp';

type Who = Omit<PrincipalContext, 'credential'> & { sessCredential: string };
const who = (fields: Partial<Who> & Pick<Who, 'principalId' | 'grantId' | 'sessCredential'>): Who => ({
  workspaceId: 'wks_synthetic',
  clientId: 'https://host-one.test/client.json',
  grantGeneration: 'gen_1',
  scopes: [SCOPE],
  ...fields,
});

/** Synthetic principals. MCP bearer tokens and SESS credentials are deliberately different values. */
export const PRINCIPALS: Record<string, Who> = {
  'mcp-token-alice': who({
    principalId: 'usr_alice',
    grantId: 'grt_alice_one',
    sessCredential: 'sess-cred-alice',
  }),
  // A refreshed access token for the same grant and generation.
  'mcp-token-alice-refreshed': who({
    principalId: 'usr_alice',
    grantId: 'grt_alice_one',
    sessCredential: 'sess-cred-alice',
  }),
  // The same grant after revocation and re-consent: a new generation.
  'mcp-token-alice-regranted': who({
    principalId: 'usr_alice',
    grantId: 'grt_alice_one',
    grantGeneration: 'gen_2',
    sessCredential: 'sess-cred-alice',
  }),
  // The same user through a second agent host (its own client and grant).
  'mcp-token-alice-host-two': who({
    principalId: 'usr_alice',
    clientId: 'https://host-two.test/client.json',
    grantId: 'grt_alice_two',
    sessCredential: 'sess-cred-alice',
  }),
  'mcp-token-alice-noscope': who({
    principalId: 'usr_alice',
    grantId: 'grt_alice_one',
    scopes: [],
    sessCredential: 'sess-cred-alice',
  }),
  // A second user of the same host and workspace.
  'mcp-token-bob': who({ principalId: 'usr_bob', grantId: 'grt_bob_one', sessCredential: 'sess-cred-bob' }),
  // A user of another workspace.
  'mcp-token-carol': who({
    workspaceId: 'wks_other',
    principalId: 'usr_carol',
    grantId: 'grt_carol_one',
    sessCredential: 'sess-cred-carol',
  }),
};

export interface Harness {
  url: URL;
  handler: SessMcpHttpHandler;
  backend: MemoryHandleBackend;
  fakes: Record<string, FakeSess>;
  lines: string[];
  /** Every bearer token value presented to authenticate(). */
  authenticated: string[];
  /** One entry per request served by the node face: when its handler promise settled (ms since entry). */
  nodeSettled: Promise<number>[];
  close(): Promise<void>;
}

export async function startHttp(
  options: {
    backend?: MemoryHandleBackend;
    fakes?: Record<string, FakeSess>;
    naive?: boolean;
    credential?: (who: Who) => () => string | Promise<string>;
    overrides?: Partial<SessMcpHttpHandlerOptions>;
  } = {},
): Promise<Harness> {
  const backend = options.backend ?? new MemoryHandleBackend();
  const fakes = options.fakes ?? {
    'sess-cred-alice': new FakeSess(),
    'sess-cred-bob': new FakeSess(),
    'sess-cred-carol': Object.assign(new FakeSess(), { workspace: 'wks_other' }),
  };
  const lines: string[] = [];
  const authenticated: string[] = [];
  // Each SESS client talks to the fake runtime of its own credential (including the
  // unauthenticated receipt-key fetch). Refreshed credentials carry a `#n` suffix.
  const routeFor = (apiKey: SessOptions['apiKey']) =>
    (async (input: string | URL | Request, init: RequestInit = {}) => {
      const key = String(typeof apiKey === 'function' ? await apiKey() : apiKey);
      const fake = fakes[key.replace(/#\d+$/, '')];
      if (!fake)
        return new Response('{"error":{"code":"UNAUTHORIZED","request_id":"req_x","message":"x"}}', {
          status: 401,
        });
      return fake.fetch(input, init);
    }) as typeof fetch;
  const handler = createSessMcpHttpHandler({
    authenticate: (request) => {
      const token = request.headers.get('authorization')?.replace(/^Bearer /, '');
      if (token === undefined) return undefined;
      authenticated.push(token);
      const p = PRINCIPALS[token];
      if (!p) return undefined;
      const { sessCredential, ...rest } = p;
      return { ...rest, credential: options.credential?.(p) ?? (() => sessCredential) };
    },
    handleStore: (binding) => backend.view(binding, { naive: options.naive === true }),
    requiredScopes: [SCOPE],
    allowedHosts: ['127.0.0.1', 'localhost'],
    allowedOrigins: ['https://allowed.test'],
    apiOrigin: ORIGIN,
    resourceMetadataUrl: RESOURCE_METADATA,
    diagnostics: (event, fields = {}) => lines.push(`${event} ${JSON.stringify(fields)}`),
    createClient: (sessOptions) =>
      new Sess({ ...sessOptions, fetch: routeFor(sessOptions.apiKey), maxRetries: 0 }),
    ...options.overrides,
  });
  const nodeSettled: Promise<number>[] = [];
  const server = http.createServer((req, res) => {
    const entered = Date.now();
    nodeSettled.push(handler.node(req, res).then(() => Date.now() - entered));
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address() as { port: number };
  return {
    url: new URL(`http://127.0.0.1:${address.port}/mcp`),
    handler,
    backend,
    fakes,
    lines,
    authenticated,
    nodeSettled,
    close: async () => {
      await handler.close();
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}

const auth = (token?: string | null) => (token ? { authorization: `Bearer ${token}` } : {});

/** A 2026-07-28 client pinned to the modern revision (no initialize handshake). */
export async function modernClient(url: URL, token?: string): Promise<ModernClient> {
  const client = new ModernClient(
    { name: 'modern-test', version: '0.0.0' },
    { versionNegotiation: { mode: { pin: '2026-07-28' } } },
  );
  await client.connect(new StreamableHTTPClientTransport(url, { requestInit: { headers: auth(token) } }));
  return client;
}

/** The v2 client in its default mode: a 2025-11-25 initialize handshake. */
export async function legacyV2Client(url: URL, token?: string): Promise<ModernClient> {
  const client = new ModernClient({ name: 'legacy-v2-test', version: '0.0.0' });
  await client.connect(new StreamableHTTPClientTransport(url, { requestInit: { headers: auth(token) } }));
  return client;
}

/** The v1 SDK client (1.32.1), the generation most hosts ship today. */
export async function legacyV1Client(
  url: URL,
  token?: string,
): Promise<{ client: V1Client; transport: V1Transport }> {
  const client = new V1Client({ name: 'legacy-v1-test', version: '0.0.0' });
  const transport = new V1Transport(url, { requestInit: { headers: auth(token) } });
  await client.connect(transport);
  return { client, transport };
}

export const MODERN_META = {
  'io.modelcontextprotocol/protocolVersion': '2026-07-28',
  'io.modelcontextprotocol/clientCapabilities': {},
  'io.modelcontextprotocol/clientInfo': { name: 'raw', version: '0' },
};

export function modernHeaders(method: string, name?: string): Record<string, string> {
  return {
    'mcp-protocol-version': '2026-07-28',
    'mcp-method': method,
    ...(name ? { 'mcp-name': name } : {}),
  };
}

export async function rawPost(
  url: URL,
  body: string,
  headers: Record<string, string> = {},
  token: string | null = 'mcp-token-alice',
): Promise<Response> {
  return fetch(url, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      accept: 'application/json, text/event-stream',
      ...auth(token),
      ...headers,
    },
    body,
  });
}

/** Reads one JSON-RPC answer from a JSON or SSE response body. */
export async function rpcBody(response: Response): Promise<any> {
  const text = await response.text();
  if (!(response.headers.get('content-type') ?? '').includes('text/event-stream')) return JSON.parse(text);
  const data = text
    .split('\n')
    .filter((line) => line.startsWith('data: '))
    .map((line) => JSON.parse(line.slice(6)));
  return data.length === 1 ? data[0] : data;
}

/**
 * Calls a tool and returns its parsed adapter result or error envelope. A created form's text starts
 * with the signed share lines for its own link; they are checked and stripped before parsing.
 */
export function toolPayload(result: {
  content?: unknown;
  structuredContent?: unknown;
  isError?: unknown;
}): any {
  const content = result.content as { type: string; text: string }[];
  const text = content[0]!.text;
  if (!text.startsWith('Show the person')) return JSON.parse(text);
  const link = (result.structuredContent as any)?.interaction?.humanUrl as string;
  const lines = `${shareLinkLines(link)}\n\n`;
  if (!text.startsWith(lines)) throw new Error('share lines do not name the result link');
  return JSON.parse(text.slice(lines.length));
}
