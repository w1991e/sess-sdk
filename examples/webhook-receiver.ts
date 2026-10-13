import type { IncomingMessage, ServerResponse } from 'node:http';
import { verifyWebhook, type WebhookEvent, type WebhookHeaders } from '@sess.si/sdk/webhooks';
import type { DeepReadonly } from '@sess.si/sdk/receipts';

/** Implement this with your database/queue transaction and a UNIQUE(workspace_id,event_id). */
export interface DurableInbox {
  accept(message: {
    workspaceId: string;
    event: DeepReadonly<WebhookEvent>;
  }): Promise<'inserted' | 'duplicate'>;
}

export interface ReceiverConfiguration {
  /** Trusted routing configuration for this endpoint/secret; never supplied by the payload. */
  workspaceId: string;
  secrets: readonly string[];
  inbox: DurableInbox;
}

/** The testable application boundary. It does not perform downstream business operations. */
export async function acceptWebhookDelivery(
  rawBody: Uint8Array,
  headers: WebhookHeaders,
  configuration: ReceiverConfiguration,
): Promise<{ status: 200; body: { challenge: string } | { accepted: true } }> {
  const workspaceId = configuration.workspaceId;
  if (!workspaceId || /[\s\u0000-\u001f\u007f]/.test(workspaceId))
    throw new Error('Configure a trusted workspace for this webhook endpoint.');
  const message = verifyWebhook(rawBody, headers, { secrets: configuration.secrets });
  if (message.type === 'sess.webhook.verification') {
    return { status: 200, body: { challenge: message.challenge } };
  }
  // The inbox must commit durably before its promise resolves. `duplicate` has the same
  // accepted outcome. Polling and webhook workers use this same durable event identity.
  await configuration.inbox.accept({ workspaceId, event: message });
  return { status: 200, body: { accepted: true } };
}

/**
 * Pass this listener to node:http createServer with finite requestTimeout/headersTimeout,
 * a request/header size limit and normal application TLS/proxy configuration.
 * Importing this file never opens a port or reads environment variables.
 */
export function createWebhookReceiver(configuration: ReceiverConfiguration) {
  const stable = {
    workspaceId: configuration.workspaceId,
    secrets: [...configuration.secrets],
    inbox: configuration.inbox,
  };
  return async (request: IncomingMessage, response: ServerResponse): Promise<void> => {
    const send = (status: number, body: unknown) => {
      response.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' });
      response.end(JSON.stringify(body));
    };
    if (request.method !== 'POST') {
      send(405, { error: 'method_not_allowed' });
      return;
    }
    const parts: Buffer[] = [];
    let total = 0;
    try {
      for await (const chunk of request) {
        const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        total += bytes.byteLength;
        if (total > 1024 * 1024) {
          send(413, { error: 'body_too_large' });
          return;
        }
        parts.push(bytes);
      }
      const result = await acceptWebhookDelivery(Buffer.concat(parts, total), request.headers, stable);
      send(result.status, result.body);
    } catch {
      // Retryable failure: no 2xx is returned if durable acceptance was not established.
      // Log only application-owned safe diagnostics; never the body, receipt or secrets.
      if (!response.headersSent) send(503, { error: 'delivery_not_accepted' });
    }
  };
}

// Integration (application-owned startup, not run on import):
// createServer({ requestTimeout: 15_000, headersTimeout: 10_000, maxHeaderSize: 8192 },
//   createWebhookReceiver({ workspaceId, secrets, inbox: databaseInbox })).listen(port);
// A worker later retrieves the accepted record, calls sess.receipts.verifyResponse,
// and applies its own authorization/transaction policy before external side effects.
