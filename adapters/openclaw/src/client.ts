import { Sess } from '@sess.si/sdk';
import type { AdapterConfig, ResolvedCredential } from './config.js';
import { SessAdapterError } from './errors.js';
import type { InvocationLease } from './host.js';

export interface GuardedClient {
  readonly sess: Sess;
  /** Number of requests that actually left the process (the guard passed). */
  dispatched(): number;
  /** True when the live-authority guard refused a dispatch in this invocation. */
  refused(): boolean;
}

export interface GuardedFetch {
  readonly fetch: typeof globalThis.fetch;
  dispatched(): number;
  refused(): boolean;
}

/** Re-checks live host authority and the approved origin immediately before each dispatch. */
export function guardFetch(
  origin: string,
  lease: InvocationLease,
  baseFetch: typeof globalThis.fetch = globalThis.fetch,
): GuardedFetch {
  let sent = 0;
  let refusedDispatch = false;
  const fetch: typeof globalThis.fetch = (input, init) => {
    const url = new URL(typeof input === 'string' || input instanceof URL ? input : input.url);
    if (url.origin !== origin) {
      refusedDispatch = true;
      return Promise.reject(
        new SessAdapterError('CONFIGURATION', 'Refused a request to an unapproved origin.'),
      );
    }
    try {
      lease.assertCurrent();
    } catch (error) {
      refusedDispatch = true;
      return Promise.reject(error);
    }
    sent++;
    return baseFetch(input, { ...init, redirect: 'manual', credentials: 'omit' });
  };
  return { fetch, dispatched: () => sent, refused: () => refusedDispatch };
}

/**
 * Invocation-scoped SDK client (spec 8.1). Its fetch wrapper re-checks the live host authority
 * immediately before every dispatch, including SDK retries, and refuses any origin other than the
 * owner-configured one, so credentials never reach a host chosen by arguments or redirects.
 */
export function createGuardedClient(
  config: AdapterConfig,
  credential: ResolvedCredential,
  lease: InvocationLease,
  baseFetch: typeof globalThis.fetch = globalThis.fetch,
): GuardedClient {
  const guarded = guardFetch(config.baseUrl, lease, baseFetch);
  const sess = new Sess({
    apiKey: credential.apiKey,
    baseUrl: config.baseUrl,
    fetch: guarded.fetch,
    allowInsecureLocalhost: config.allowInsecureLocalhost,
    ...(config.receiptIssuer ? { receiptIssuer: config.receiptIssuer } : {}),
    ...(config.expectedWorkspaceId ? { expectedWorkspaceId: config.expectedWorkspaceId } : {}),
  });
  return { sess, dispatched: guarded.dispatched, refused: guarded.refused };
}
