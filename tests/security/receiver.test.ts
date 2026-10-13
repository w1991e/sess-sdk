import { createHmac } from 'node:crypto';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { acceptWebhookDelivery, createWebhookReceiver } from '../../examples/webhook-receiver.js';
import { deferred, eventId, fixture, now, sessionId, workspace } from './fixtures.js';

const secret = `whsec_${Buffer.alloc(32, 7).toString('base64')}`;
function headers(raw: string, id = eventId, timestamp = Math.floor(now / 1000)) {
  const signature = createHmac('sha256', Buffer.alloc(32, 7))
    .update(`${id}.${timestamp}.${raw}`)
    .digest('base64');
  return { 'webhook-id': id, 'webhook-timestamp': String(timestamp), 'webhook-signature': `v1,${signature}` };
}
function message() {
  const f = fixture();
  return {
    type: 'response.accepted',
    event_id: eventId,
    session_id: sessionId,
    sequence: 1,
    revision: 1,
    action_id: 'submit',
    data: f.response.data,
    accepted_at: f.response.accepted_at,
    receipt: f.response.receipt,
  };
}

beforeEach(() => vi.useFakeTimers({ now }));
afterEach(() => vi.useRealTimers());

describe('application durable-inbox receiver boundary', () => {
  it('does not return success before the injected inbox commits, and treats duplicates equally', async () => {
    const gate = deferred<'inserted' | 'duplicate'>();
    const accept = vi.fn(() => gate.promise);
    const raw = JSON.stringify(message());
    const outcome = vi.fn();
    const pending = acceptWebhookDelivery(Buffer.from(raw), headers(raw), {
      workspaceId: workspace,
      secrets: [secret],
      inbox: { accept },
    }).then(outcome);
    await Promise.resolve();
    expect(outcome).not.toHaveBeenCalled();
    expect(accept).toHaveBeenCalledWith(
      expect.objectContaining({
        workspaceId: workspace,
        event: expect.objectContaining({ event_id: eventId }),
      }),
    );
    gate.resolve('inserted');
    await pending;
    expect(outcome).toHaveBeenCalledWith({ status: 200, body: { accepted: true } });
    const duplicate = await acceptWebhookDelivery(Buffer.from(raw), headers(raw), {
      workspaceId: workspace,
      secrets: [secret],
      inbox: { accept: async () => 'duplicate' },
    });
    expect(duplicate).toEqual({ status: 200, body: { accepted: true } });
  });

  it('echoes verified challenges without enqueueing them as business work', async () => {
    const challenge = Buffer.alloc(32, 3).toString('base64url');
    const raw = JSON.stringify({ type: 'sess.webhook.verification', challenge });
    const accept = vi.fn(async () => 'inserted' as const);
    const result = await acceptWebhookDelivery(
      Buffer.from(raw),
      headers(raw, `vfy_${challenge.slice(0, 26)}`),
      { workspaceId: workspace, secrets: [secret], inbox: { accept } },
    );
    expect(result).toEqual({ status: 200, body: { challenge } });
    expect(accept).not.toHaveBeenCalled();
  });

  it('rejects authentication or inbox failures without claiming delivery acceptance', async () => {
    const raw = JSON.stringify(message());
    const accept = vi.fn(async () => {
      throw new Error('database unavailable');
    });
    await expect(
      acceptWebhookDelivery(Buffer.from(raw), headers(raw), {
        workspaceId: workspace,
        secrets: [secret],
        inbox: { accept },
      }),
    ).rejects.toThrow('database unavailable');
    const calls = accept.mock.calls.length;
    await expect(
      acceptWebhookDelivery(Buffer.from(`${raw} `), headers(raw), {
        workspaceId: workspace,
        secrets: [secret],
        inbox: { accept },
      }),
    ).rejects.toMatchObject({ code: 'WEBHOOK_INVALID_SIGNATURE' });
    expect(accept.mock.calls.length).toBe(calls);
  });

  it('runs the example as an actual bounded Node HTTP receiver on loopback', async () => {
    vi.useRealTimers();
    const accept = vi.fn(async () => 'inserted' as const);
    const server = createServer(
      { requestTimeout: 15_000, headersTimeout: 10_000, maxHeaderSize: 8192 },
      createWebhookReceiver({ workspaceId: workspace, secrets: [secret], inbox: { accept } }),
    );
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    try {
      const port = (server.address() as AddressInfo).port;
      const raw = JSON.stringify(message());
      const result = await fetch(`http://127.0.0.1:${port}`, {
        method: 'POST',
        body: raw,
        headers: headers(raw, eventId, Math.floor(Date.now() / 1000)),
      });
      expect(result.status).toBe(200);
      expect(await result.json()).toEqual({ accepted: true });
      expect(accept).toHaveBeenCalledTimes(1);
    } finally {
      server.closeAllConnections();
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
    }
  });
});
