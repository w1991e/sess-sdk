import { SessError } from './errors.js';
import { Transport, pathSegment } from './transport.js';
import {
  decodeCreate,
  decodeDeliveries,
  decodeEvents,
  decodeSession,
  decodeSurface,
} from './internal/decode.js';
import { boundedNumber } from './internal/time.js';
import { waitForResponse } from './polling.js';
import type {
  ApiResult,
  CreateSessionRequest,
  CreateSessionResponse,
  Deliveries,
  InteractiveSession,
  MutationOptions,
  PublishSessionRequest,
  RequestOptions,
  Session,
  SessionEvents,
  SurfaceRevision,
  VersionedResult,
  WaitOptions,
  WaitResult,
} from './types.js';

export class Sessions {
  #transport: Transport;
  constructor(transport: Transport) {
    this.#transport = transport;
  }

  /** Creates once. A lost reply may mean creation succeeded; no retry is safe. */
  create(
    body: CreateSessionRequest,
    options: RequestOptions = {},
  ): Promise<VersionedResult<CreateSessionResponse>> {
    if ('idempotencyKey' in options || 'ifMatch' in options)
      return Promise.reject(
        new SessError('configuration', 'Session creation does not support idempotency keys or If-Match.', {
          outcome: 'not_sent',
        }),
      );
    return this.#transport.request(
      {
        name: 'sessions.create',
        method: 'POST',
        path: '/v1/sessions',
        body,
        status: 201,
        versioned: true,
        retry: 'never',
        parse: (value) => decodeCreate(value, this.#transport.allowInsecureLocalhost),
      },
      options,
    ) as Promise<VersionedResult<CreateSessionResponse>>;
  }
  retrieve(id: string, options?: RequestOptions): Promise<VersionedResult<Session>> {
    return this.#transport.request(
      {
        name: 'sessions.retrieve',
        method: 'GET',
        path: `/v1/sessions/${pathSegment(id)}`,
        status: 200,
        versioned: true,
        retry: 'safe',
        parse: (value) => decodeSession(value, id),
      },
      options,
    ) as Promise<VersionedResult<Session>>;
  }
  /** Full next interaction, with the original concurrency and replay identity. */
  publish(
    id: string,
    body: PublishSessionRequest,
    options: MutationOptions,
  ): Promise<VersionedResult<InteractiveSession>> {
    const { ifMatch, idempotencyKey, ...requestOptions } = options ?? ({} as MutationOptions);
    return this.#transport.request(
      {
        name: 'sessions.publish',
        method: 'PATCH',
        path: `/v1/sessions/${pathSegment(id)}`,
        body,
        ifMatch,
        idempotencyKey,
        status: 200,
        versioned: true,
        retry: 'mutation',
        parse: (value) => {
          const session = decodeSession(value, id);
          if (!('status' in session) || session.status !== 'active')
            throw new SessError('protocol', 'Publish did not return an active interactive Session.', {
              code: 'INVALID_RESPONSE',
            });
          return session;
        },
      },
      requestOptions,
    ) as Promise<VersionedResult<InteractiveSession>>;
  }
  complete(id: string, options: MutationOptions): Promise<VersionedResult<InteractiveSession>> {
    const { ifMatch, idempotencyKey, ...requestOptions } = options ?? ({} as MutationOptions);
    return this.#transport.request(
      {
        name: 'sessions.complete',
        method: 'POST',
        path: `/v1/sessions/${pathSegment(id)}/complete`,
        ifMatch,
        idempotencyKey,
        status: 200,
        versioned: true,
        retry: 'mutation',
        parse: (value) => {
          const session = decodeSession(value, id);
          if (!('status' in session) || session.status !== 'completed')
            throw new SessError('protocol', 'Complete did not return a completed interactive Session.', {
              code: 'INVALID_RESPONSE',
            });
          return session;
        },
      },
      requestOptions,
    ) as Promise<VersionedResult<InteractiveSession>>;
  }
  listEvents(id: string, options?: RequestOptions): Promise<ApiResult<SessionEvents>> {
    return this.#transport.request(
      {
        name: 'sessions.listEvents',
        method: 'GET',
        path: `/v1/sessions/${pathSegment(id)}/events`,
        status: 200,
        retry: 'safe',
        parse: (value) => decodeEvents(value, id),
      },
      options,
    );
  }
  retrieveSurface(
    id: string,
    revision: number,
    options?: RequestOptions,
  ): Promise<ApiResult<SurfaceRevision>> {
    boundedNumber(revision, 0, 'revision');
    return this.#transport.request(
      {
        name: 'sessions.retrieveSurface',
        method: 'GET',
        path: `/v1/sessions/${pathSegment(id)}/surfaces/${revision}`,
        status: 200,
        retry: 'safe',
        parse: (value) => decodeSurface(value, id, revision),
      },
      options,
    );
  }
  listDeliveries(id: string, options?: RequestOptions): Promise<ApiResult<Deliveries>> {
    return this.#transport.request(
      {
        name: 'sessions.listDeliveries',
        method: 'GET',
        path: `/v1/sessions/${pathSegment(id)}/deliveries`,
        status: 200,
        retry: 'safe',
        parse: (value) => decodeDeliveries(value, id),
      },
      options,
    );
  }
  redeliverEvent(id: string, eventId: string, options?: RequestOptions): Promise<ApiResult<void>> {
    return this.#transport.request(
      {
        name: 'sessions.redeliverEvent',
        method: 'POST',
        path: `/v1/sessions/${pathSegment(id)}/events/${pathSegment(eventId)}/redeliver`,
        status: 202,
        retry: 'never',
      },
      options,
    );
  }
  /** Read-only, restartable wait for exactly one immutable revision. */
  waitForResponse(id: string, options: WaitOptions): Promise<WaitResult> {
    return waitForResponse((requestOptions) => this.retrieve(id, requestOptions), id, options);
  }
}
