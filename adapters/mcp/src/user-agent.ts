import { VERSION } from './version.js';

/**
 * The product token Sess classifies this adapter's requests by. The adapter passes it as the SDK's
 * `userAgent` option, so the SDK (0.1.0-rc.9, the current pin) sends
 * `sess-mcp/<version> sess-sdk/<version> node/<version>`: this adapter first, then the SDK's own.
 */
export const USER_AGENT = `sess-mcp/${VERSION}`;
