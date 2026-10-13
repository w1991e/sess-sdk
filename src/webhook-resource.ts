import { Transport } from './transport.js';
import {
  decodeWebhook,
  decodeWebhookRegister,
  decodeWebhookRotate,
  decodeWebhookVerify,
} from './internal/decode.js';
import type {
  ApiResult,
  RequestOptions,
  WebhookRegisterRequest,
  WebhookRegisterResponse,
  WebhookResponse,
  WebhookRotateResponse,
  WebhookVerifyResponse,
} from './types.js';

export class WebhookResource {
  #transport: Transport;
  constructor(transport: Transport) {
    this.#transport = transport;
  }
  /** Replaces the workspace endpoint. Store any returned signing secret privately. */
  register(
    body: WebhookRegisterRequest,
    options?: RequestOptions,
  ): Promise<ApiResult<WebhookRegisterResponse>> {
    return this.#transport.request(
      {
        name: 'webhooks.register',
        method: 'PUT',
        path: '/v1/webhook',
        body,
        status: 201,
        retry: 'never',
        parse: decodeWebhookRegister,
      },
      options,
    );
  }
  retrieve(options?: RequestOptions): Promise<ApiResult<WebhookResponse>> {
    return this.#transport.request(
      {
        name: 'webhooks.retrieve',
        method: 'GET',
        path: '/v1/webhook',
        status: 200,
        retry: 'safe',
        parse: decodeWebhook,
      },
      options,
    );
  }
  verifyEndpoint(options?: RequestOptions): Promise<ApiResult<WebhookVerifyResponse>> {
    return this.#transport.request(
      {
        name: 'webhooks.verifyEndpoint',
        method: 'POST',
        path: '/v1/webhook/verify',
        status: 200,
        retry: 'never',
        parse: decodeWebhookVerify,
      },
      options,
    );
  }
  /** Once-returned secret; never automatically retried. */
  rotateSecret(options?: RequestOptions): Promise<ApiResult<WebhookRotateResponse>> {
    return this.#transport.request(
      {
        name: 'webhooks.rotateSecret',
        method: 'POST',
        path: '/v1/webhook/secrets/rotate',
        status: 201,
        retry: 'never',
        parse: decodeWebhookRotate,
      },
      options,
    );
  }
}
