import { SessError } from './errors.js';
import { Transport, pathSegment } from './transport.js';
import { decodeAsk, decodeAskClose, decodeAskCreate } from './internal/decode.js';
import type {
  ApiResult,
  AskCloseResponse,
  AskResponse,
  CreateAskRequest,
  CreateAskResponse,
  RequestOptions,
} from './types.js';

/** The fewest respondents an Ask takes, and the shortest lifetime, in seconds (the ceilings are the plan's). */
export const ASK_RESPONDENTS_FLOOR = 2;
const LIFETIME_FLOOR_SECONDS = 30;

/** One page of an Ask read. */
export interface AskReadOptions extends RequestOptions {
  /** The `next_cursor` of the page before. */
  cursor?: string;
  /** Respondents per page, 1–100 (default 100). */
  limit?: number;
}

function notSent(message: string): SessError {
  return new SessError('configuration', message, { outcome: 'not_sent' });
}
function seconds(value: unknown): boolean {
  return (
    value === undefined ||
    (typeof value === 'number' && Number.isSafeInteger(value) && value >= LIFETIME_FLOOR_SECONDS)
  );
}

/** The query of one page; checked before the request is sent. */
export function pageQuery(options: AskReadOptions): Record<string, string> | undefined {
  const { cursor, limit } = options;
  if (cursor !== undefined && (typeof cursor !== 'string' || !/^[\x21-\x7e]{1,200}$/.test(cursor)))
    throw notSent('cursor must be the next_cursor of the page before.');
  if (limit !== undefined && (!Number.isSafeInteger(limit) || limit < 1 || limit > 100))
    throw notSent('limit must be a whole number from 1 to 100.');
  if (cursor === undefined && limit === undefined) return undefined;
  return {
    ...(cursor !== undefined ? { cursor } : {}),
    ...(limit !== undefined ? { limit: String(limit) } : {}),
  };
}

/**
 * `POST /v1/asks`, attempted once: a lost reply may mean creation succeeded, and it is never
 * retried here (an unused Ask reserves nothing, so creating again is safe). Internal: the one
 * public way to create an Ask is `sess.ask({ ..., respondents })`; there is no second create verb.
 */
export function createAsk(
  transport: Transport,
  body: CreateAskRequest,
  options: RequestOptions = {},
): Promise<ApiResult<CreateAskResponse>> {
  if ('idempotencyKey' in options || 'ifMatch' in options)
    return Promise.reject(notSent('Ask creation does not support idempotency keys or If-Match.'));
  const max = body.respondents.max;
  if (!Number.isSafeInteger(max) || max < ASK_RESPONDENTS_FLOOR)
    return Promise.reject(
      notSent(`respondents.max must be a whole number, at least ${ASK_RESPONDENTS_FLOOR}.`),
    );
  for (const key of ['expires_in', 'respondent_expires_in'] as const)
    if (!seconds(body[key]))
      return Promise.reject(notSent(`${key} must be a whole number of seconds, at least 30.`));
  return transport.request(
    {
      name: 'asks.create',
      method: 'POST',
      path: '/v1/asks',
      body,
      status: 201,
      retry: 'never',
      parse: (value) => decodeAskCreate(value, transport.allowInsecureLocalhost),
    },
    options,
  );
}

/**
 * Advanced: read or close an Ask by its ID (`/v1/asks/{id}`), for example after a restart. The
 * handle from `sess.ask({ ..., respondents })` has the same read and close, with typed, verified
 * answers; prefer it.
 */
export class Asks {
  #transport: Transport;
  constructor(transport: Transport) {
    this.#transport = transport;
  }

  /**
   * Reads an Ask: open or closed, its counts, and one page of respondents with their accepted
   * answers. Returning an answer here is that respondent's retrieval, as a Session read is.
   * The answers are not yet receipt-verified; the handle's `read()` verifies them.
   */
  retrieve(id: string, options: AskReadOptions = {}): Promise<ApiResult<AskResponse>> {
    const { cursor: _cursor, limit: _limit, ...requestOptions } = options;
    let query: Record<string, string> | undefined;
    try {
      query = pageQuery(options);
    } catch (error) {
      return Promise.reject(error);
    }
    return this.#transport.request(
      {
        name: 'asks.retrieve',
        method: 'GET',
        path: `/v1/asks/${pathSegment(id)}`,
        ...(query ? { query } : {}),
        status: 200,
        retry: 'safe',
        parse: (value) => decodeAsk(value, id),
      },
      requestOptions,
    );
  }

  /**
   * Closes an Ask now: no one new can start; respondents who have not answered have their links
   * ended. Closing a closed Ask changes nothing, so this is safe to repeat.
   */
  close(id: string, options?: RequestOptions): Promise<ApiResult<AskCloseResponse>> {
    return this.#transport.request(
      {
        name: 'asks.close',
        method: 'POST',
        path: `/v1/asks/${pathSegment(id)}/close`,
        status: 200,
        retry: 'safe',
        parse: (value) => decodeAskClose(value, id),
      },
      options,
    );
  }
}
