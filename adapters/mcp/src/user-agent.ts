import { VERSION } from './version.js';

/** The product token Sess classifies this adapter's requests by. */
export const USER_AGENT = `sess-mcp/${VERSION}`;

/**
 * A fetch for the Sess client that puts USER_AGENT first in the User-Agent header. The SDK pin
 * (0.1.0-rc.8) sends none of its own, so the header is exactly USER_AGENT; an SDK that sends its
 * own token keeps it after ours. `base` is read at call time (default: the global fetch).
 */
export function userAgentFetch(base?: typeof globalThis.fetch): typeof globalThis.fetch {
  return (input, init) => {
    const headers = new Headers(init?.headers);
    const sdk = headers.get('user-agent');
    headers.set('user-agent', sdk ? `${USER_AGENT} ${sdk}` : USER_AGENT);
    return (base ?? globalThis.fetch)(input, { ...init, headers });
  };
}
