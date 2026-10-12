import { describe, expect, it, vi } from 'vitest';
import { createServer } from 'node:http';
import { Sess } from '../../src/index.js';
import {
  API_KEY,
  EVENT_ID,
  INTERACTION,
  RESPONSE,
  SESSION_ID,
  WORKSPACE,
  json,
  session,
} from '../fixtures/api.js';

describe('documented owner resource mapping', () => {
  it('reads exact immutable Surfaces, event history and delivery diagnostics', async () => {
    const requests: string[] = [];
    const fetch: typeof globalThis.fetch = vi.fn(async (url) => {
      requests.push(String(url));
      if (String(url).endsWith('/surfaces/1'))
        return json({
          id: SESSION_ID,
          revision: 1,
          interaction: session().interaction,
          response_schema: session().response_schema,
        });
      if (String(url).endsWith('/events'))
        return json({
          id: SESSION_ID,
          events: [
            {
              event_id: EVENT_ID,
              sequence: 1,
              type: 'response.accepted',
              revision: 1,
              actor: { assurance: 'link_holder' },
              action_id: 'submit',
              data: RESPONSE.data,
              created_at: RESPONSE.accepted_at,
              receipt: null,
            },
          ],
        });
      return json({ id: SESSION_ID, deliveries: [] });
    });
    const sdk = new Sess({ apiKey: API_KEY, fetch });
    expect((await sdk.sessions.retrieveSurface(SESSION_ID, 1)).data.interaction).toEqual(
      session().interaction,
    );
    expect((await sdk.sessions.listEvents(SESSION_ID)).data.events).toHaveLength(1);
    expect((await sdk.sessions.listDeliveries(SESSION_ID)).data.deliveries).toEqual([]);
    expect(requests.map((url) => new URL(url).pathname)).toEqual([
      `/v1/sessions/${SESSION_ID}/surfaces/1`,
      `/v1/sessions/${SESSION_ID}/events`,
      `/v1/sessions/${SESSION_ID}/deliveries`,
    ]);
  });
  it('supports the documented empty 200 and 202 success bodies', async () => {
    const seen: { url: string; options?: RequestInit }[] = [];
    const fetch: typeof globalThis.fetch = vi.fn(async (url, options) => {
      seen.push({ url: String(url), options });
      return new Response(null, { status: String(url).endsWith('/redeliver') ? 202 : 200 });
    });
    const sdk = new Sess({ apiKey: API_KEY, fetch });
    expect((await sdk.webhooks.verifyEndpoint()).data).toBeUndefined();
    expect((await sdk.sessions.redeliverEvent(SESSION_ID, EVENT_ID)).meta.status).toBe(202);
    for (const item of seen) {
      expect(item.options?.method).toBe('POST');
      expect(item.options?.body).toBeUndefined();
    }
  });
  it('registers, reads and rotates one workspace endpoint with once-returned secrets', async () => {
    const signing_secret = {
      kid: 'wk_00000000000000000000000001',
      secret: `whsec_${Buffer.alloc(32, 1).toString('base64')}`,
    };
    const endpoint = {
      id: 'whe_00000000000000000000000001',
      url: 'https://receiver.example/hooks',
      status: 'pending',
      created_at: RESPONSE.accepted_at,
      verified_at: null,
      verification_expires_at: null,
    };
    const fetch: typeof globalThis.fetch = vi.fn(async (url, options) => {
      if (String(url).endsWith('/rotate')) return json({ signing_secret, previous: null }, 201);
      if (options?.method === 'PUT') return json({ endpoint, signing_secret }, 201);
      return json({
        endpoint,
        signing_secrets: [{ kid: signing_secret.kid, active: true, retire_at: null }],
        deliveries: { pending: 0, failed: 0, delivered: 0, oldest_pending_age_seconds: null },
      });
    });
    const sdk = new Sess({ apiKey: API_KEY, fetch });
    expect((await sdk.webhooks.register({ url: endpoint.url })).data.signing_secret).toEqual(signing_secret);
    expect((await sdk.webhooks.retrieve()).data.endpoint).toEqual(endpoint);
    expect((await sdk.webhooks.rotateSecret()).data.signing_secret).toEqual(signing_secret);
  });
  it('management writes/redelivery never retry even with configured retry budget', async () => {
    const fetch = vi.fn(async () => new Response('gateway', { status: 503 }));
    const sdk = new Sess({ apiKey: API_KEY, fetch, maxRetries: 10 });
    for (const call of [
      () => sdk.webhooks.register({ url: 'https://receiver.example/' }),
      () => sdk.webhooks.verifyEndpoint(),
      () => sdk.webhooks.rotateSecret(),
      () => sdk.sessions.redeliverEvent(SESSION_ID, EVENT_ID),
    ]) {
      await expect(call()).rejects.toMatchObject({ attempts: 1, outcome: 'unknown' });
    }
    expect(fetch).toHaveBeenCalledTimes(4);
  });
  it('native fetch loopback covers serialized request and streamed resource response', async () => {
    let requestBody = '';
    let authorization = '';
    let requestCount = 0;
    const server = createServer((request, response) => {
      requestCount++;
      authorization = String(request.headers.authorization);
      request.on('data', (chunk) => {
        requestBody += String(chunk);
      });
      request.on('end', () => {
        response.writeHead(201, {
          'content-type': 'application/json',
          etag: '"opaque-created"',
          'sess-workspace-id': WORKSPACE,
        });
        response.write('{"id":');
        response.end(
          JSON.stringify(SESSION_ID) +
            ',"revision":1,"human_url":"https://human.example/s/private-loopback"}',
        );
      });
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    try {
      const address = server.address();
      if (!address || typeof address === 'string') throw new Error('Missing local address');
      const sdk = new Sess({
        apiKey: API_KEY,
        baseUrl: `http://127.0.0.1:${address.port}`,
        allowInsecureLocalhost: true,
      });
      const result = await sdk.sessions.create({ interaction: INTERACTION });
      expect(result.meta).toMatchObject({ workspaceId: WORKSPACE, etag: '"opaque-created"', attempts: 1 });
      expect(JSON.parse(requestBody)).toEqual({ interaction: INTERACTION });
      expect(authorization).toBe(`Bearer ${API_KEY}`);
      expect(requestCount).toBe(1);
    } finally {
      server.closeAllConnections();
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
    }
  });
});
