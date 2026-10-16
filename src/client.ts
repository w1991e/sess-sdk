import type { SessOptions } from './types.js';
import { Transport } from './transport.js';
import { Sessions } from './sessions.js';
import { WebhookResource } from './webhook-resource.js';
import { createReceiptResource } from './receipts/resource.js';
import { ask, type AskAnswer, type AskField, type AskHandle, type AskInput, type AskOptions } from './ask.js';

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

  /**
   * Asks one question with simple typed fields. Invalid input fails before credential lookup or
   * network access. The Session is created once with the whole interaction, and the returned
   * handle carries the private link before any wait. `answer()` verifies the answer, checks that it
   * is still current, completes the Session and returns the typed values.
   */
  ask<const F extends readonly AskField[]>(
    input: AskInput<F>,
    options?: AskOptions,
  ): Promise<AskHandle<AskAnswer<F>>> {
    return ask<AskAnswer<F>>(this.sessions, this.receipts, input, options);
  }
}
