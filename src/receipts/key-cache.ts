import { SessError } from '../errors.js';
import { abortError, verificationError, waitWithSignal } from './json.js';
import { validateKeySet, type ReceiptKeySet } from './verify.js';

export interface ReceiptKeyCacheOptions {
  issuer: string;
  /** Identifies the configured trusted source. It is never derived from a receipt. */
  keySource: string;
  load: (options: {
    signal: AbortSignal;
    operationTimeoutMs: number;
    timeoutMs?: number;
    maxRetries?: number;
  }) => Promise<unknown>;
  ttlMs?: number;
  refreshCooldownMs?: number;
  requestTimeoutMs?: number;
}

interface Flight {
  controller: AbortController;
  promise: Promise<ReceiptKeySet>;
  waiters: number;
}

/** One bounded, issuer/source-scoped cache per client; no global `kid` cache. */
export class ReceiptKeyCache {
  readonly #issuer: string;
  readonly #keySource: string;
  readonly #load: ReceiptKeyCacheOptions['load'];
  readonly #ttl: number;
  readonly #cooldown: number;
  readonly #requestTimeout: number;
  #keys?: ReceiptKeySet;
  #loadedAt = 0;
  #attemptedAt = -Infinity;
  #lastFailure?: unknown;
  #flight?: Flight;

  constructor(options: ReceiptKeyCacheOptions) {
    this.#issuer = options.issuer;
    this.#keySource = options.keySource;
    this.#load = options.load;
    this.#ttl = options.ttlMs ?? 5 * 60_000;
    this.#cooldown = options.refreshCooldownMs ?? 10_000;
    this.#requestTimeout = options.requestTimeoutMs ?? 5_000;
    if (
      !this.#issuer ||
      !this.#keySource ||
      typeof this.#load !== 'function' ||
      !Number.isFinite(this.#ttl) ||
      this.#ttl < 1 ||
      this.#ttl > 5 * 60_000 ||
      !Number.isFinite(this.#cooldown) ||
      this.#cooldown < 1 ||
      this.#cooldown > 60_000 ||
      !Number.isFinite(this.#requestTimeout) ||
      this.#requestTimeout < 1 ||
      this.#requestTimeout > 10_000
    ) {
      throw new SessError('configuration', 'Invalid receipt key-cache configuration.');
    }
  }

  async resolve(context: {
    kid: string;
    issuer: string;
    signal?: AbortSignal;
    timeoutMs?: number;
    maxRetries?: number;
  }): Promise<ReceiptKeySet> {
    if (context.issuer !== this.#issuer) {
      throw verificationError('ISSUER_MISMATCH', 'The key cache belongs to a different trusted issuer.');
    }
    if (context.signal?.aborted) throw abortError(context.signal);
    const fresh = this.#keys !== undefined && Date.now() - this.#loadedAt < this.#ttl;
    if (fresh && this.#keys?.keys.some((key) => key.kid === context.kid)) return this.#keys;
    if (this.#flight) return this.#join(this.#flight, context.signal);
    // Every unknown key can trigger at most one shared refresh in this cooldown, including
    // failures. Cold-start misses use the initial fetch, never an immediate redundant fetch.
    if (Date.now() - this.#attemptedAt < this.#cooldown) {
      if (fresh && this.#keys) return this.#keys;
      if (this.#lastFailure instanceof SessError) throw this.#lastFailure;
      throw verificationError(
        'KEY_FETCH_COOLDOWN',
        'Receipt-key refresh is cooling down after a recent attempt.',
      );
    }
    return this.#join(this.#start(context), context.signal);
  }

  #start(options: { timeoutMs?: number; maxRetries?: number }): Flight {
    const controller = new AbortController();
    this.#attemptedAt = Date.now();
    const timer = setTimeout(
      () => controller.abort(new SessError('timeout', 'Receipt-key retrieval exceeded its deadline.')),
      this.#requestTimeout,
    );
    const flight: Flight = { controller, waiters: 0, promise: Promise.resolve({ keys: [] }) };
    const load = Promise.resolve().then(() =>
      this.#load({
        signal: controller.signal,
        operationTimeoutMs: this.#requestTimeout,
        ...(options.timeoutMs !== undefined ? { timeoutMs: options.timeoutMs } : {}),
        ...(options.maxRetries !== undefined ? { maxRetries: options.maxRetries } : {}),
      }),
    );
    flight.promise = waitWithSignal(load, controller.signal)
      .then((raw) => {
        const keys = validateKeySet(raw);
        this.#keys = keys;
        this.#loadedAt = Date.now();
        this.#lastFailure = undefined;
        return keys;
      })
      .catch((error: unknown) => {
        if (this.#flight === flight) this.#lastFailure = error;
        throw error;
      })
      .finally(() => {
        clearTimeout(timer);
        if (this.#flight === flight) this.#flight = undefined;
      });
    this.#flight = flight;
    return flight;
  }

  async #join(flight: Flight, signal?: AbortSignal): Promise<ReceiptKeySet> {
    flight.waiters += 1;
    try {
      return await waitWithSignal(flight.promise, signal);
    } finally {
      flight.waiters -= 1;
      // One cancelled caller must not cancel another caller's shared fetch. When everyone
      // leaves, release the underlying transport and its timer promptly.
      if (flight.waiters === 0 && this.#flight === flight) {
        this.#flight = undefined;
        this.#attemptedAt = -Infinity;
        flight.controller.abort(new SessError('aborted', 'Receipt-key retrieval has no remaining waiters.'));
      }
    }
  }
}
