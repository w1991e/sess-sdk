import { SessError } from './errors.js';
import { Transport, pathSegment } from './transport.js';
import {
  decodeCreate,
  decodeDeliveries,
  decodeEvents,
  decodeSession,
  decodeSurface,
  decodeRedelivery,
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
  RedeliverResponse,
} from './types.js';

function mutationIdentity(options: MutationOptions): {
  ifMatch: string;
  idempotencyKey?: string;
  requestOptions: RequestOptions;
} {
  const source = options ?? ({} as MutationOptions);
  if (typeof source !== 'object' || Array.isArray(source))
    throw new SessError('configuration', 'Mutation options must be an object.', { outcome: 'not_sent' });
  // Inspect the two replay identity fields before spreading/accessing caller options.
  // Accessor or inherited identities are not immutable primitive options.
  for (const name of ['ifMatch', 'idempotencyKey'] as const) {
    const descriptor = Object.getOwnPropertyDescriptor(source, name);
    if (
      (name in source && !descriptor) ||
      (descriptor && !('value' in descriptor)) ||
      (name === 'idempotencyKey' && descriptor && typeof descriptor.value !== 'string')
    )
      throw new SessError(
        'configuration',
        'Mutation identity options must be primitive string data properties.',
        { outcome: 'not_sent' },
      );
  }
  const { ifMatch, idempotencyKey, ...requestOptions } = source;
  return { ifMatch, idempotencyKey, requestOptions };
}

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
  async publish(
    id: string,
    body: PublishSessionRequest,
    options: MutationOptions,
  ): Promise<VersionedResult<InteractiveSession>> {
    const { ifMatch, idempotencyKey, requestOptions } = mutationIdentity(options);
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
  async complete(id: string, options: MutationOptions): Promise<VersionedResult<InteractiveSession>> {
    const { ifMatch, idempotencyKey, requestOptions } = mutationIdentity(options);
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
  redeliverEvent(
    id: string,
    eventId: string,
    options?: RequestOptions,
  ): Promise<ApiResult<RedeliverResponse>> {
    return this.#transport.request(
      {
        name: 'sessions.redeliverEvent',
        method: 'POST',
        path: `/v1/sessions/${pathSegment(id)}/events/${pathSegment(eventId)}/redeliver`,
        status: 202,
        retry: 'never',
        parse: (value) => decodeRedelivery(value, eventId),
      },
      options,
    );
  }
  /** Read-only, restartable wait for exactly one immutable revision. */
  waitForResponse(id: string, options: WaitOptions): Promise<WaitResult> {
    return waitForResponse((requestOptions) => this.retrieve(id, requestOptions), id, options);
  }
}
