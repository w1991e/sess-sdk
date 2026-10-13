import type { SessOptions } from './types.js';
import { Transport } from './transport.js';
import { Sessions } from './sessions.js';
import { WebhookResource } from './webhook-resource.js';
import { createReceiptResource } from './receipts/resource.js';

/** Server-side client. Construction has no network or installation side effects. */
export class Sess {
  readonly sessions: Sessions;
  readonly webhooks: WebhookResource;
  readonly receipts: ReturnType<typeof createReceiptResource>;

  constructor(options: SessOptions) {
    const transport = new Transport(options);
    this.sessions = new Sessions(transport);
    this.webhooks = new WebhookResource(transport);
    this.receipts = createReceiptResource({
      baseUrl: transport.baseUrl,
      receiptIssuer: transport.receiptIssuer,
      expectedWorkspaceId: transport.expectedWorkspaceId,
      operationTimeoutMs: transport.operationTimeoutMs,
      retrieveSession: (id, requestOptions) => this.sessions.retrieve(id, requestOptions),
      retrieveSurface: (id, revision, requestOptions) =>
        this.sessions.retrieveSurface(id, revision, requestOptions),
      publicGet: (path, requestOptions) =>
        transport.request(
          {
            name: 'receipts.keys',
            method: 'GET',
            path,
            status: 200,
            retry: 'safe',
            authenticated: false,
            parse: (value) => value,
          },
          requestOptions,
        ),
    });
    Object.freeze(this);
  }
}
