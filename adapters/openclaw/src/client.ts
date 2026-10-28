import { Sess } from '@sess.si/sdk';
import type { AdapterConfig, ResolvedCredential } from './config.js';
import { PLUGIN_VERSION } from './doctor.js';
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
    return baseFetch(input, {
      ...init,
      headers: withUserAgent(init?.headers),
      redirect: 'manual',
      credentials: 'omit',
    });
  };
  return { fetch, dispatched: () => sent, refused: () => refusedDispatch };
}

/** The product token Sess classifies this plugin's requests by. */
export const USER_AGENT = `sess-openclaw/${PLUGIN_VERSION}`;

/**
 * Puts this plugin's token first in the User-Agent. The SDK it runs on (0.1.0-rc.8) sends none of
 * its own, so the header is exactly USER_AGENT; an SDK that sends its own token keeps it after ours.
 */
function withUserAgent(init: HeadersInit | undefined): Headers {
  const headers = new Headers(init);
  const sdk = headers.get('user-agent');
  headers.set('user-agent', sdk ? `${USER_AGENT} ${sdk}` : USER_AGENT);
  return headers;
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
