import type { SessOptions } from './types.js';
import { Transport } from './transport.js';
import { Sessions } from './sessions.js';
import { Asks, createAsk } from './asks.js';
import { WebhookResource } from './webhook-resource.js';
import { createReceiptResource } from './receipts/resource.js';
import {
  ask,
  type AskAnswer,
  type AskContext,
  type AskField,
  type AskHandle,
  type AskInput,
  type AskOptions,
  type AskRespondents,
  type AskRespondentsAnswer,
  type AskRespondentsHandle,
  type AskRespondentsInput,
} from './ask.js';

/** Server-side client. Construction has no network or installation side effects. */
export class Sess {
  readonly sessions: Sessions;
  readonly webhooks: WebhookResource;
  readonly receipts: ReturnType<typeof createReceiptResource>;
  /** Advanced: read or close an Ask by its ID. Create one with `sess.ask({ ..., respondents })`. */
  readonly asks: Asks;
  #ask: AskContext;

  constructor(options: SessOptions) {
    const transport = new Transport(options);
    this.sessions = new Sessions(transport);
    this.asks = new Asks(transport);
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
    this.#ask = {
      sessions: this.sessions,
      receipts: this.receipts,
      asks: this.asks,
      createAsk: (body, requestOptions) => createAsk(transport, body, requestOptions),
    };
    Object.freeze(this);
  }

  /**
   * Asks many people one question through one link: with `respondents`, Sess creates an Ask, and
   * each person who starts gets their own page. The handle carries the link to share before any
   * wait; `read()` returns each respondent's verified, typed answer and `close()` ends it.
   */
  ask<const F extends readonly AskField[], const R extends AskRespondents>(
    input: AskRespondentsInput<F, R>,
    options?: AskOptions,
  ): Promise<AskRespondentsHandle<AskRespondentsAnswer<F, R>>>;
  /**
   * Asks one question with simple typed fields. Invalid input fails before credential lookup or
   * network access. The Session is created once with the whole interaction, and the returned
   * handle carries the private link before any wait. `answer()` verifies the answer, checks that it
   * is still current, completes the Session and returns the typed values.
   */
  ask<const F extends readonly AskField[]>(
    input: AskInput<F>,
    options?: AskOptions,
  ): Promise<AskHandle<AskAnswer<F>>>;
  ask(input: AskInput | AskRespondentsInput, options?: AskOptions): Promise<unknown> {
    return ask(this.#ask, input, options);
  }
}
