export interface paths {
  '/.well-known/oauth-protected-resource': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    /** @description RFC 9728 metadata of the remote MCP resource: the resource, its one authorization server and the one scope (the five Sess tools). Served at the root and with the resource path appended. Hosted MCP only; on the MCP host. */
    get: operations['protectedResourceMetadata'];
    put?: never;
    post?: never;
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  '/.well-known/oauth-protected-resource/mcp': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    /** @description RFC 9728 metadata of the remote MCP resource: the resource, its one authorization server and the one scope (the five Sess tools). Served at the root and with the resource path appended. Hosted MCP only; on the MCP host. */
    get: operations['protectedResourceMetadataForPath'];
    put?: never;
    post?: never;
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  '/.well-known/oauth-authorization-server': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    /** @description RFC 8414 metadata: authorization code with S256 PKCE only, public clients only (token_endpoint_auth_method none), client ID metadata documents preferred (client_id_metadata_document_supported) and dynamic registration as compatibility, refresh and revocation, RFC 9207 `iss` in every authorization response. The issuer and the token, registration and revocation endpoints are on the MCP host; the authorization endpoint is the account pages’ consent page (app.sess.si). Hosted MCP only. */
    get: operations['authorizationServerMetadata'];
    put?: never;
    post?: never;
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  '/app/oauth/authorize': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    /** @description The authorization endpoint. Query: response_type=code, client_id (a registered id, or the https URL of a client ID metadata document, fetched over the SSRF-safe egress: public addresses, port 443, no redirects, 16 KiB, 5 s, reused for 5 minutes), redirect_uri (required; exactly one of the client’s registered URIs), code_challenge and code_challenge_method=S256 (required), state (optional, ≤ 512), scope (optional; sess:interact), resource (optional; must be the MCP resource). Without an account signed in within the last 15 minutes a page asks to sign in (again), and nothing is validated or fetched. Then an unknown client or an unregistered redirect URI is an HTML error page here, never a redirect; later errors are 303 to the redirect URI with error, state and iss; a valid request shows "Authorize an agent host" (the host, the workspace and the five tools). GET never decides, consumes or issues anything. Hosted MCP only. */
    get: operations['authorizeAgentHost'];
    put?: never;
    /** @description The deliberate decision. Form fields: csrf, request (the page’s single-use consent request, 10 minutes, bound to the account session), decision (allow or deny). Same origin, CSRF token and a sign-in within 15 minutes required. Allow creates or renews the consent grant of (workspace, account, agent host) with a new generation (earlier tokens and hosted handles of the host end) and answers 303 to the redirect URI with a single-use code (5 minutes), state and iss. A (client, state) pair is accepted once. Hosted MCP only. */
    post: operations['decideAgentHost'];
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  '/app/hosts': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    /** @description The account’s authorized agent hosts. Without a live account session: 303 to /app/sign-in. Hosted MCP only. */
    get: operations['agentHostsPage'];
    put?: never;
    post?: never;
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  '/app/hosts/{id}/revoke': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get?: never;
    put?: never;
    /** @description Removes an agent host now: the grant gets a new generation and every token is revoked, so its access and its hosted interaction handles end at once. Form field: csrf. Same origin. Hosted MCP only. */
    post: operations['removeAgentHost'];
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  '/oauth/token': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get?: never;
    put?: never;
    /** @description grant_type=authorization_code: code, redirect_uri (as authorized), client_id, code_verifier (S256), resource (optional). grant_type=refresh_token: refresh_token, client_id, scope and resource (optional; never wider). Public clients: no client secret or HTTP authentication. A used code or refresh token presented again revokes every token of its family. Cache-Control: no-store. Body at most 16 KiB. Hosted MCP only; on the MCP host. */
    post: operations['oauthToken'];
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  '/oauth/register': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get?: never;
    put?: never;
    /** @description RFC 7591 dynamic registration of a public client (the compatibility path; client ID metadata documents are preferred). Redirect URIs: https, http on a loopback host, or a native app scheme; no fragment or user info. Registration grants nothing: every use needs the person’s consent. At most 10 registrations per client per hour and 500 in total. Hosted MCP only; on the MCP host. */
    post: operations['oauthRegister'];
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  '/oauth/revoke': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get?: never;
    put?: never;
    /** @description RFC 7009. Form fields: token, client_id (token_type_hint ignored). An access token ends with the API credentials minted under it; a refresh token ends its whole family. An unknown or another client’s token is answered the same (200). Hosted MCP only; on the MCP host. */
    post: operations['oauthRevoke'];
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  '/personal/sign-in': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get?: never;
    put?: never;
    /** @description P2-15 personal sign-in. Emails one challenge: a six-digit code (10 minutes, 5 guesses, only in this browser: it is bound to the __Host-sess_personal_signin challenge cookie set here) and a 256-bit single-use link (15 minutes) whose token is in the URL fragment of /personal/confirm. The answer is the same whether or not an identity, a personal account or a developer account exists. The send is reserved before the email provider is called, so every attempt counts: per address, per client and in total (shared with developer sign-in: 5, 20 and 1000 per rolling hour), per browser (5 per hour), one email per address and per browser per minute, and at most 20 sends in flight. */
    post: operations['requestPersonalSignIn'];
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  '/personal/sign-in/code': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get?: never;
    put?: never;
    /** @description Redeems the emailed code in the browser that asked for it (its challenge cookie). Using the code or the link ends the other. */
    post: operations['redeemPersonalSignInCode'];
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  '/personal/sign-in/link': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get?: never;
    put?: never;
    /** @description Redeems the emailed link: the page at /personal/confirm posts the token from its URL fragment. Opening the link never consumes it. */
    post: operations['redeemPersonalSignInLink'];
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  '/personal/session': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    /** @description The live personal session’s own account (its address, to name it before a Save) and its CSRF token. Reads only. A developer session is never accepted here. */
    get: operations['getPersonalSession'];
    put?: never;
    post?: never;
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  '/personal/sign-out': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get?: never;
    put?: never;
    /** @description Revokes this personal session and clears its cookie. */
    post: operations['personalSignOut'];
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  '/personal/close': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get?: never;
    put?: never;
    /** @description Personal closure (Delete my account): deletes every personal session of this identity, every claim redeemed into its personal grant and every saved copy under it, and the grant itself; leaves an opaque tombstone (no address), also in the personal restore ledger, and deletes the identity record unless a developer membership still uses the address. A developer membership, its sessions, keys and workspace are untouched. */
    post: operations['closePersonalAccount'];
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  '/personal/save/destination': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get?: never;
    put?: never;
    /** @description The Save sheet binds its own random nonce to this personal session: the answer is an HMAC of the nonce keyed by the session’s secret. Nothing is stored. A claim created for this binding can be redeemed only by this session presenting the same nonce. */
    post: operations['bindSaveDestination'];
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  '/personal/save/redeem': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get?: never;
    put?: never;
    /** @description Redeems a claim into this personal grant, atomically with the saved copy: the secret, source verifier, nonce and this session’s binding must all match (the secret alone never does). Suppression is rechecked: if the rounds the claim’s grants authorize are no longer exactly its batch, the claim is aborted and nothing is saved. The identical request again answers the prior result without a second write. */
    post: operations['redeemSaveClaim'];
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  '/personal/save/direct': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get?: never;
    put?: never;
    /** @description Apex-native Save: the human page is on this same origin, so it saves without a claim. The link token and Keep grants are in the body (never a URL); the rounds the grants authorize now are saved as Keep would export them. Not available on any other origin. */
    post: operations['saveDirect'];
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  '/personal/copies': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    /** @description Your receipts: the saved copies of this personal account, newest first (at most 100), each with its title and rounds as served now: per round the archival verifier’s signature outcome and, separately, whether the questions and answers match, and the holder status as recorded at Save. A round an operator restriction or deletion whose scope reaches personal copies withholds is left out, and holder proofs whose batch names it are withheld; the status then says partly_unavailable or unavailable, never why. Reads only. */
    get: operations['listPersonalCopies'];
    put?: never;
    post?: never;
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  '/personal/copies/download': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get?: never;
    put?: never;
    /** @description One saved copy’s sess.kept-conversation file (an attachment): its stored bytes exactly when nothing of it is withheld, otherwise the file as Keep would serve it under the same suppression (withheld rounds left out, holder proofs naming them withheld). */
    post: operations['downloadPersonalCopy'];
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  '/personal/copies/remove': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get?: never;
    put?: never;
    /** @description Remove from Sess: deletes this saved copy and the claims that wrote it, and records the removal in the personal restore ledger, in one transaction. Never touches custody, a receipt, a Session or the developer’s records. */
    post: operations['removePersonalCopy'];
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  '/v1/auth/email-link': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get?: never;
    put?: never;
    /** @description Developer account sign-in. Emails a sign-in link to the address: it works once, expires 15 minutes after issue, and a newer link cancels it once the email provider has confirmed sending the newer one (an unconfirmed send cancels nothing). Signing in with one link cancels the address’s other links. The answer is the same whether or not an account exists. Opening the link shows a page whose Sign in button finishes the sign-in (GET never consumes it). Limits: 5 links per address and 20 per client per rolling hour. Developer sign-in never verifies a human responder. */
    post: operations['requestSignInLink'];
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  '/app/sign-in': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    /** @description The developer sign-in page: an email field and an explicit, unticked "Remember this device" box (remember=1) whose form (POST, same-origin only) requests a sign-in email. A request from this page is one challenge: a link and a six-digit code (P2 D2(a)), with a random browser challenge in an HttpOnly, Secure, SameSite=Strict, host-only cookie (Path=/app, 15 minutes) that the code is bound to; then 303 to /app/check-email, whose code form posts to /app/sign-in/code. With a live account session (unexpired, not revoked) the answer is 303 to /app/keys, a fixed internal path that nothing in the request can change. With a pending key creation (a valid key-intent cookie) the page is always shown, re-titled "Verify it’s you", whatever the session: that key is created only after the email link is confirmed. When GitHub sign-in is configured (P2 D2(b)) the page also has "Continue with GitHub" (POST /app/sign-in/github), and then its form-action also allows https://github.com. Reading this page never consumes a link, creates a key or changes anything. */
    get: operations['signInPage'];
    put?: never;
    post?: never;
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  '/app/confirm/{token}': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    /** @description The page the emailed link opens (the token is a single-use secret; never log it). It only shows a Sign in button (with ?continue=key, a link requested to finish a key creation: "Continue creating your key"); it consumes nothing. */
    get: operations['signInConfirmPage'];
    put?: never;
    /** @description Consumes the link once (same-origin requests only), which also ends the code of the same challenge, and sets the account-page cookie: HttpOnly, Secure, SameSite=Strict, host-only, Path=/app, 12 hours, or 30 days when "Remember this device" was chosen and the link is confirmed in the browser that chose it (absolute: never extended). A previous session of this browser is revoked. When the same browser holds a pending key creation of the same account (the key-intent cookie, set by a create post with an expired session of that account), the key is created now with that label and expiry, once, and the response is the one-time reveal; the intent cookie is cleared. A pending creation of another account creates nothing. */
    post: operations['signInConfirm'];
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  '/app/sign-in/code': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get?: never;
    put?: never;
    /** @description Redeems the emailed six-digit sign-in code (P2 D2(a)) in the browser that requested it. Form fields: csrf (the check-email page’s token, derived from the browser challenge) and code (6 digits; spaces and hyphens are ignored). Same-origin form posts only. The code works for 10 minutes and for at most 5 guesses per challenge; failed guesses also count, across resends, toward per-address (10), per-client (30) and global (2000) limits per rolling hour. A match consumes the challenge atomically (its link stops working) and then behaves as POST /app/confirm/{token}: the session cookie (12 hours, or 30 days when "Remember this device" was chosen), and a pending key creation of the same account in this browser is created and shown once. Every refusal is the same answer. */
    post: operations['signInWithCode'];
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  '/app/devices/{id}/revoke': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get?: never;
    put?: never;
    /** @description Signs out one remembered device of the signed-in account (P2 D2(a)), listed with its public id (acs_…) under "Sign-in and sessions" on /app/keys. Same-origin form posts with the session’s CSRF token only. Signing out this device clears its cookie. */
    post: operations['signOutDevice'];
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  '/app/sign-in/github': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get?: never;
    put?: never;
    /** @description Starts a GitHub account sign-in (P2 D2(b)): "Continue with GitHub" on /app/sign-in, shown only when the deployment has a GitHub OAuth app (SESS_GITHUB_CLIENT_ID and SESS_GITHUB_CLIENT_SECRET). Same-origin form posts only. A new random state (256 bits, stored only as its hash, single use, 10 minutes) is bound to a new browser binding secret in the __Secure-sess_github cookie (HttpOnly, Secure, SameSite=Strict, host-only, Path=/app, 10 minutes; stored only as its hash), which also derives the PKCE verifier (never stored or sent to the browser). The answer is 303 to https://github.com/login/oauth/authorize with client_id, the fixed redirect_uri <account origin>/app/sign-in/github/callback, scope=user:email (the only scope), state, code_challenge and code_challenge_method=S256. Optional field return: /keys (default) or /evidence; anything else is /keys. At most 30 starts per client and 1000 in total per rolling hour. A page with this form also allows https://github.com in form-action; every other account page keeps form-action 'self'. */
    post: operations['gitHubSignInStart'];
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  '/app/sign-in/github/callback': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    /** @description Where GitHub sends the browser back (the callback URL registered with the OAuth app). GET reads only: with a well-formed code and state, a "Finish signing in with GitHub" page whose Continue button posts them back (same origin); GitHub’s own error (error=access_denied when the person cancelled) is shown as such. The code and state are single-use secrets: the request log carries the route pattern only, never the query. */
    get: operations['gitHubSignInReturn'];
    put?: never;
    /** @description Finishes a GitHub sign-in or link in the browser that started it. Form fields: code and state. Same-origin form posts only, carrying the __Secure-sess_github binding cookie whose hash the state is bound to: the state is used once, whatever happens next (a replay, another browser or a planted callback finds it used or unbound). Then the code is exchanged at GitHub with the PKCE verifier, the stable numeric GitHub user ID and the verified primary address are read with user:email, and the GitHub access token is discarded (never stored or logged). A sign-in: a linked GitHub ID signs in to its account (whatever the address or login now); a new ID with a verified, usable primary address that no account has creates an account and its link; an address that an existing account has is never merged (GITHUB_NOT_LINKED: sign in with email, then link); no verified usable address leads to the email sign-in (nothing created). Signing in opens a new 12-hour account session exactly as the email sign-in does (the cookie policy is the same; the browser’s previous session is revoked) and continues a pending key creation of the same account in this browser. A link: only the account session that started it, still live and signed in within 12 hours, links; a GitHub account links to one Sess account and an account to one GitHub account. */
    post: operations['gitHubSignInFinish'];
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  '/app/github/link': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get?: never;
    put?: never;
    /** @description Starts linking a GitHub account to the signed-in account (P2 D2(b)), from "Sign-in and sessions" on /app/keys. Same-origin form posts with the session’s CSRF token only, and a sign-in within the last 12 hours. Then exactly as POST /app/sign-in/github, with the state also bound to this account and session. */
    post: operations['gitHubLinkStart'];
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  '/app/github/unlink': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get?: never;
    put?: never;
    /** @description Unlinks the account’s GitHub account (P2 D2(b)). Same-origin form posts with the session’s CSRF token only, and a sign-in within the last 12 hours. Every other live session that GitHub account opened is signed out; this one goes on. The account always keeps its email sign-in, so unlinking never leaves it without a way in. Works even when GitHub sign-in is no longer configured. */
    post: operations['gitHubUnlink'];
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  '/app/keys': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    /** @description The account page listing the workspace’s API keys (label, fingerprint, created, last used, expiry, state). Without a live account session: 303 to /app/sign-in. */
    get: operations['apiKeysPage'];
    put?: never;
    /** @description Creates an owner API key (sess_sk_…) of the developer workspace and shows it once, in one post of the keys page’s create form. The form states each expiry choice’s exact date and carries a single-use nonce bound to the account session (15 minutes); creating consumes it, so a refresh or repeat never creates a second key or shows the secret again. The stored expiry has the date the form showed (rendered_at, bound to the nonce); when that date is no longer true the form is shown again (400). Form fields: csrf (the page’s token), nonce, rendered_at, label (optional, ≤ 64 characters, no control characters), expires_in_days (30, 90, 365 or never; required). Same-origin requests with the session’s CSRF token only. At most 10 active keys per account. With an expired account session (same-origin posts only), a valid label and expiry choice, bound to that account, is kept in a key-intent cookie (HMAC-protected, HttpOnly, Secure, SameSite=Strict, host-only, Path=/app, 15 minutes) and the answer is 303 to /app/sign-in ("Verify it’s you"); the key is created only after the email link is confirmed in the same browser. A live session whose sign-in is more than 12 hours old (a remembered device) is treated the same way: revealing a new key needs a recent email verification. Revoke: POST /app/keys/{id}/revoke (same rules), immediate. Sign out: POST /app/sign-out. */
    post: operations['createApiKey'];
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  '/app/usage': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    /** @description P2-12: the account page with the workspace’s plan, resolved Sessions used of the allowance, the next reset (UTC), active Sessions and the 80%/100% allowance warnings. P2-12 B3: with billing configured, the Change plan section (Checkout from Free, an in-place change for a subscribed workspace, Manage billing) and the plan badge; at the limit a link to Change plan beside the reason. Query billing (a fixed notice code after a billing action) is display only. Its CSP form-action also allows the payment provider’s hosted Checkout and portal origins. Without a live account session: 303 to /app/sign-in. */
    get: operations['usagePage'];
    put?: never;
    post?: never;
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  '/app/billing/plan': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get?: never;
    put?: never;
    /** @description P2-12 B3: changes the signed-in developer workspace’s paid plan. Form fields: csrf (the page’s token) and plan (starter or pro; the server selects the approved price, nothing else comes from the browser). Same-origin requests with the session’s CSRF token only. Without a subscription: a hosted Checkout (the same one as POST /v1/account/billing/checkout), answered 303 to the provider’s Checkout page. With a subscription: its one subscription changes in place (never a second subscription or a new Checkout), which needs a sign-in within the last 12 hours; the plan changes only when the provider’s verified subscription state shows it (a signed event or reconciliation), never from this request. An uncertain provider outcome is never success: the change stays pending and the next request replays it under the same idempotency key before anything else is sent. */
    post: operations['changeBillingPlan'];
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  '/app/billing/portal': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get?: never;
    put?: never;
    /** @description P2-12 B3: the payment provider’s hosted customer portal (payment details, invoices, cancellation) for the signed-in workspace’s own provider customer, resolved server-side (no customer id or email from the browser). Form field: csrf. Same-origin requests with the session’s CSRF token and a sign-in within the last 12 hours only. Cancellation there ends the subscription at the provider; the plan returns to Free only from its verified state. */
    post: operations['openBillingPortal'];
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  '/app/trials/claim': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get?: never;
    put?: never;
    /** @description Claims a no-signup trial for the signed-in developer account. Form fields: csrf (the page’s token) and management_credential (the trial’s sess_mg_… credential, in the form body only, never in a URL). Same-origin requests with the session’s CSRF token only; the Sess link can never claim. A claim records the account as the trial’s owner, once: nothing moves, the trial keeps its deadlines, limits and deletion time, its receipts stay as issued and its management credential keeps working. The account’s API keys can then read (only read) the trial’s Sessions with the owner read routes, each Session until its result_available_until (as with the management credential). Claiming the same trial again from the same account answers as the first claim. */
    post: operations['claimTrial'];
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  '/app/evidence': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    /** @description P2-13 V6: the console page listing the signed-in developer workspace’s receipts as metadata only (receipt and Session IDs, workspace sequence, acceptance time, witness status, whether the answers are still kept, and the receipts held unverified in their own view). Query: custody (exception), from and to (UTC dates, to inclusive), target (a target ID), cursor. Never a receipt or an answer on the page. Without a live account session: 303 to /app/sign-in. Labelled "issued records in this defined scope/range". */
    get: operations['evidencePage'];
    put?: never;
    post?: never;
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  '/app/sessions': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    /** @description P2-19: the console page listing the signed-in developer workspace’s Sessions, read only, as metadata: title, Sent (created), Closes at (action_expires_at) and status (open, answered, expired, revoked or closed). Query: status (open, answered or expired; default all), sort (sent or closes; default sent), dir (asc or desc; default desc for sent, asc for closes), after or before (an opaque page key). An unknown or malformed value takes its default. Never a human link, token or answer on the page. Without a live account session: 303 to /app/sign-in. */
    get: operations['sessionsPage'];
    put?: never;
    post?: never;
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  '/app/sessions/{id}': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    /** @description P2-19: one Session of the signed-in developer workspace, read only: its status, Sent and Closes at, its event log as metadata (event, step, action, by, time; never the answer) and, for each accepted answer, its receipt’s event ID and time with a link to the Evidence page for that day while the receipt is kept and not restricted. Another workspace’s Session is the same 404 as an unknown one. */
    get: operations['sessionPage'];
    put?: never;
    post?: never;
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  '/app/evidence/export': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get?: never;
    put?: never;
    /** @description P2-13 V6: the console’s deliberate export, a download of the same document as POST /v1/evidence/export for the accepted dates chosen (form fields: csrf, custody, from and to as UTC dates, both required, to inclusive; target optional). The page states the disclosure before the button. Same-origin requests with the session’s CSRF token only. Content-Disposition: attachment with a filename built from the workspace, custody and range only. */
    post: operations['evidenceExportDownload'];
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  '/v1/trial/sessions': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get?: never;
    put?: never;
    /** @description The no-signup trial. Without Authorization: creates a trial workspace and its first interactive Session, and returns the management credential once, in the body. With `Authorization: Bearer <management credential>`: creates a further Session in that trial. Interactive Sessions only (mode interactive); no return channel, webhook or outbound endpoint exists for a trial. Trial limits (published, reversible): human link and action window 1 hour; result readable 24 hours after the action window; at most 3 active Sessions and 10 Sessions per trial within its 24-hour creation window; at most 3 new trials per client and 200 overall per rolling 24 hours. Any other credential, or a management credential that is unknown, expired, revoked or bound to one Session → 404 NOT_FOUND. An Idempotency-Key header is refused (400 INVALID_SCHEMA): the credential and the Sess link cannot be replayed. */
    post: operations['createTrialSession'];
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  '/v1/trial/sessions/{id}': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    /** @description A trial Session and its accepted responses, read with the trial’s management credential, until result_available_until. Reading never consumes or changes it. A Session of another trial or workspace, an unknown, expired or revoked credential, a Sess link or an owner key → 404 NOT_FOUND (generic). */
    get: operations['getTrialSession'];
    put?: never;
    post?: never;
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  '/v1/sessions': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get?: never;
    put?: never;
    /** @description Creates a display Session (mode display, source.kind data) or an interactive one (mode interactive, source.kind sess_surface; components: SurfaceComponent). An unrecognized component type → 400 UNKNOWN_COMPONENT; a field-schema keyword outside the supported subset → 400 INVALID_SCHEMA. An Idempotency-Key header is refused (400 INVALID_SCHEMA): the Sess link cannot be replayed (it is stored only as a hash). Retention: the Sess link expires 720 hours after creation with the deployment owner key and 168 hours with a developer API key (free plan). The Session’s content, accepted results and receipts are purged 720 hours (owner key) or 168 hours (developer API key) after the earlier of its completion and its link’s expiry, and outstanding webhook deliveries are cancelled; afterwards every owner route answers 404 SESSION_NOT_FOUND. A webhook already delivered is not recalled. Advanced: expires_in (seconds from creation, at least 30, at most the plan’s live-link lifetime) sets a shorter Sess link; the Session’s retention then also ends sooner, because it counts from the earlier of completion and the link’s end. An interactive link of 72000 seconds or less can be extended by the person, at most ten times, up to a fixed horizon (GET /v1/sessions/{id}: action_expires_horizon); its link ends at that horizon, or at the deadline once no extension is left. The response’s action_expires_at is the stored expiry, the same value GET /v1/sessions/{id} returns. Advanced: invocation_id ties the Session to the run of your registered agent that it serves; the archival core of each receipt it issues then binds that agent (target) and its version. */
    post: operations['createSession'];
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  '/v1/sessions/{id}': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    /** @description The Session. Interactive Sessions return status, the current revision, its response_schema and every accepted response bound to its revision; repeated reads of an unchanged Session are byte-identical. Every Session carries action_expires_at, its Sess link’s stored deadline; a read never extends it. It also carries link_state (live, lapsed or expired, at the time of the read), action_expires_horizon and extensions_used: for an interactive link of 20 hours or less, the person may extend the deadline up to ten times, never past the fixed horizon. A lapsed link accepts no answer but can still be extended: the Session is still open, so keep waiting; revoke the link for a hard end at the deadline. extensions lists every accepted extension (old and new deadline, from lapsed, when; no answer value), in order. The ETag is the owner mutations’ concurrency token (the revision and the Event sequence), not a cache validator: it does not change with link timing. A developer API key also reads the Sessions of trials its account claimed (read-only), each until that Session’s result_available_until. */
    get: operations['getSession'];
    put?: never;
    post?: never;
    delete?: never;
    options?: never;
    head?: never;
    /** @description Publishes the next immutable Surface revision of an interactive Session, from responded or active (superseding the unanswered revision). The Session returns to active on the same Session ID and Sess link; a submission against an older revision is then refused with SESSION_REVISION_CONFLICT. */
    patch: operations['publishRevision'];
    trace?: never;
  };
  '/v1/sessions/{id}/complete': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get?: never;
    put?: never;
    /** @description Completes an interactive Session explicitly. Terminal: a completed Session accepts no further submission or revision. No request body. */
    post: operations['completeSession'];
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  '/v1/sessions/{id}/events': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    /** @description Every Event of the Session in sequence order: response.accepted (actor link_holder, the revision it was accepted on, action_id and the typed data), revision.published and session.completed (actor owner). Append-only: Event IDs and sequences never change, and every accepted result stays listed after later revisions and completion. Not paginated in P1 (a Session has a few Events per round). Display Sessions have none. Beside the Events, link_extensions lists every accepted extension of the Sess link (its old and new deadline, whether it was asked for after the deadline, and when; no answer value), in order. Cache-Control: no-store, no-transform. */
    get: operations['listSessionEvents'];
    put?: never;
    post?: never;
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  '/v1/sessions/{id}/surfaces/{revision}': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    /** @description One immutable Surface revision exactly as stored: the interaction (and, for an interactive Session, the response schema) that responses on that revision are bound to. Cache-Control: no-store, no-transform. */
    get: operations['getSurfaceRevision'];
    put?: never;
    post?: never;
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  '/s/{token}': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get?: never;
    put?: never;
    /** @description The human form submission (the Sess link is the capability; never log it). Accepted only from the page itself: Sec-Fetch-Site same-origin, or without Fetch Metadata an Origin equal to the public origin. The server resolves action_id from the exact stored revision and validates data against its response_schema. Success is a 303 redirect to the same link; refusals are HTML pages whose stable code is in a data-error-code attribute (422 and 409 re-render the form with the safe draft for explicit resubmit). */
    post: operations['submitHumanAction'];
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  '/s/{token}/extend': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get?: never;
    put?: never;
    /** @description Asks for more time on a Sess link of 20 hours or less (the Sess link is the capability; never log it). It is the answer form’s second submitter, so the body is the form’s own entries without action_id; same-origin only, as for the answer. While the link is live the deadline (action_expires_at) moves to min(horizon, deadline + step); while it is lapsed (past the deadline, before the horizon, extensions left) to min(horizon, now + step), where step = min(original lifetime, 1 hour). At most ten extensions; never past the fixed horizon. A repeated client_event_id is answered as the original and never counted twice. It never accepts an answer, dispatches, completes the Session or signs a receipt, and never stores or logs a submitted value: the values are only used to re-render the same form. */
    post: operations['extendHumanLink'];
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  '/s/{token}/keep/challenge': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get?: never;
    put?: never;
    /** @description P2-13 V3 / P2-11, step 1 of "Keep your receipt" (DOCS/spec/keep-v1.md). The human link is the capability; never log it. Sent by the receipt card’s same-origin script after the person taps Keep: Sec-Fetch-Site same-origin (or, without Fetch Metadata, an Origin equal to the page’s origin), application/json, at most 65536 bytes, at most 128 grants. Each round is authorized only by its own receipt-scoped Keep grant: the Session, a receipt list or another round’s grant never authorize it. Reads one Session snapshot (its Event sequence cutoff) and, when some authorized receipt in custody has no holder yet, records one fresh challenge (5 minutes) bound to exactly that batch. Headers as every /s/* response (no-store, no-referrer, noindex, no CORS). */
    post: operations['createKeepChallenge'];
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  '/s/{token}/keep': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get?: never;
    put?: never;
    /** @description P2-13 V3 / P2-11, step 2: the kept-conversation file (DOCS/spec/keep-v1.md), the one bounded, versioned file the person saves — every authorized accepted round of the Session through the snapshot cutoff with its unchanged receipt and bundle (or content unavailable once purged), preservation status (the witness state at snapshot time, with the evidence attached by then), holder status and an inventory. Same request checks as the challenge. With `enrollment`, first enrolls one fresh holder key per receipt of the challenge’s exact batch (or only its final receipt: the disclosed fallback): every proof is checked, then all enrollments and the challenge’s consumption commit atomically; the same request again is an idempotent replay, a different one is refused, a receipt keeps its first holder and a key holds one receipt. Without `enrollment` (key generation or storage failed, or nothing to enrol) the file is exported with every round marked unenrolled: export never depends on enrollment. The file holds no private key, grant secret or Sess link. Content-Disposition: attachment. */
    post: operations['keepConversation'];
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  '/s/{token}/claim': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get?: never;
    put?: never;
    /** @description P2-15 PR-B, Save to Sess from a human page on another origin than /personal (DOCS/spec/personal-copies-v1.md §7). The Sess link is the capability; never log it. Sent by the receipt card’s same-origin script once the Save sheet on the personal origin is signed in and has sent its destination binding: Sec-Fetch-Site same-origin (or an Origin equal to the page’s), application/json, at most 65536 bytes, rate limited per link. Records one pending claim bound to the rounds the presented Keep grants authorize now, exactly as Keep reads them (restricted or deleted rounds never included; no client-chosen IDs), their cutoff, a fresh 256-bit transfer secret (stored as its hash), the purpose, the personal origin, the source verifier’s challenge and the destination binding. The claim expires in 5 minutes. Nothing is saved until the sheet redeems it. Headers as every /s/* response. */
    post: operations['createSaveClaim'];
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  '/s/{token}/status': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    /** @description The read-only status of a Sess link, for its waiting page (S2): the current revision and the person’s view of the state, nothing else (no owner data, Event IDs, receipts, responses or Surface content). The Sess link is the capability; never log it. Nothing is written or consumed. The waiting page’s same-origin script calls it about every 4 s while the page waits, and navigates to the same link (a GET) once the revision or the state differs. A page with a form also calls it, about every 25 s while visible, only to keep its connection in use: it ignores the answer. Headers as every /s/* response: Cache-Control: no-store, Referrer-Policy: no-referrer, X-Robots-Tag: noindex, nofollow, no CORS. */
    get: operations['getHumanStatus'];
    put?: never;
    post?: never;
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  '/v1/account/usage': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    /** @description P2-12: the developer workspace’s plan, resolved Sessions used in the current period, the next reset, active Sessions and the 80%/100% allowance warnings. Read only. A resolved Session is one the owner completed after at least one accepted response whose final result was accepted by the webhook endpoint or fetched with an owner credential (a read or completion response sent in full) before its delivery deadline (completion plus the Session’s retention); it counts once, in the period it qualifies. Periods are monthly from the workspace’s billing anchor (its creation on Free). Admission reserves one unit per admitted interactive Session that can still qualify, so admitted work always fits the allowance. Workspaces without a plan (the deployment owner key) → 404 NOT_FOUND. */
    get: operations['getAccountUsage'];
    put?: never;
    post?: never;
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  '/v1/account/billing/checkout': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get?: never;
    put?: never;
    /** @description P2-12: a hosted Checkout for upgrading the developer workspace to a paid plan, at the server’s approved price for that plan (the caller names only the plan). Idempotent: while a Checkout for this plan is open, every request (concurrent or retried) returns the same one; a Checkout for the other plan is ended first, so at most one is payable (it is replaced only after the provider confirms its expiry), and a paid Checkout fences the workspace until its subscription is recorded. A workspace with a subscription gets no new Checkout (409 SUBSCRIPTION_EXISTS: plan changes happen in place). Returning from the Checkout page grants nothing: the plan changes only when the provider’s signed subscription state says it is paid, and the Usage page shows “processing” until then. */
    post: operations['createBillingCheckout'];
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  '/v1/billing/provider-events': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get?: never;
    put?: never;
    /** @description P2-12: the payment provider’s signed asynchronous events (provider-to-Sess only; DOCS/spec/billing-provider-v1.md). The signature header is verified over the exact raw body (at most 256 KiB, timestamp within 300 s) before the body is parsed. Each event id is processed once (a duplicate is acknowledged without effect); older subscription states never replace newer ones; unknown event types are acknowledged and ignored. Not configured → 404. */
    post: operations['receiveBillingProviderEvent'];
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  '/v1/webhook': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    /** @description The endpoint, the signing secrets in force (key IDs only) and delivery counts with the age of the oldest pending delivery. */
    get: operations['getWebhook'];
    /** @description Registers the owner workspace’s webhook endpoint (one return channel). It replaces the current endpoint, whose pending deliveries are not redirected (they fail as endpoint_unavailable; redeliver explicitly), and receives nothing until verified. The first registration also creates the signing secret, returned once. 503 SERVICE_UNAVAILABLE while data-encryption keys are not configured. */
    put: operations['registerWebhook'];
    post?: never;
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  '/v1/webhook/verify': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get?: never;
    put?: never;
    /** @description POSTs a fresh random challenge to the exact registered URL through the delivery egress policy; the endpoint is verified when it echoes it, for 30 days (verification_expires_at). Verifying again renews it; an expired verification reads as pending (no new deliveries; queued ones fail endpoint_unavailable). Every connection resolves the host and refuses non-public addresses. */
    post: operations['verifyWebhook'];
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  '/v1/webhook/secrets/rotate': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get?: never;
    put?: never;
    /** @description Creates a new signing secret (returned once). The previous one keeps signing for a 24-hour overlap, so deliveries carry both signatures until then. */
    post: operations['rotateWebhookSecret'];
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  '/v1/sessions/{id}/deliveries': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    /** @description Every webhook delivery job of the Session’s accepted responses with every attempt (outcome and HTTP status), including permanent failures and exhausted retries. */
    get: operations['listDeliveries'];
    put?: never;
    post?: never;
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  '/v1/sessions/{id}/events/{event_id}/redeliver': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get?: never;
    put?: never;
    /** @description Queues the accepted Event for delivery again to the current verified endpoint, with a fresh retry budget. The message is the same bytes (same event_id and receipt). A delivery already pending for the Event to the current endpoint is returned instead; one pending for a replaced endpoint is ended (endpoint_unavailable) and a new one queued. */
    post: operations['redeliverEvent'];
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  '/v1/sessions/{id}/events/{event_id}/bundle': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    /** @description The deliberate export of one accepted response as a bundle-v1 disclosure (DOCS/spec/bundle-v1.md): its stored receipt exactly as issued, the complete normalized Surface of the revision it was accepted on, the accepted data, and the current public receipt keys. Never a private key, owner credential or Sess link. Anyone holding the bundle can verify it (POST /v1/receipts/verify, or offline with trusted keys); share it only with whom you mean to show the decision. Read-only. Cache-Control: no-store, no-transform; Referrer-Policy: no-referrer. */
    get: operations['exportDecisionBundle'];
    put?: never;
    post?: never;
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  '/v1/receipts/verify': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get?: never;
    put?: never;
    /** @description Public, no credential. Verifies a disclosed bundle-v1 against this server's own receipt issuer and published keys (never keys in the bundle) at the current time: the receipt by the receipt-v1 rules, then that the disclosed Surface and input match the receipt hashes. It looks nothing up and stores nothing. The declared signed context is checked only against itself, so context is "unchecked" and application_purpose is "unchecked": check the event, Session and workspace you expect in your own application. A valid result means the issuer accepted this input from someone holding the Sess link; it never names a person or proves that anything was executed. An invalid bundle is a 200 result with valid false and a reason. Body: application/json, at most 2097152 bytes (413 above); 1 MiB canonical bundle bound (reason oversized). Rate limited per client and in total (429 RATE_LIMITED with Retry-After). An absolute 2-second deadline runs from the request's arrival and covers receiving the body as well as verifying it: an unanswered request then gets 503 SERVICE_UNAVAILABLE with Connection: close and the connection is closed. Cache-Control: no-store, no-transform; Referrer-Policy: no-referrer; CORS only for the product site origins. Never put a bundle or receipt in a URL. */
    post: operations['verifyDecisionBundle'];
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  '/v1/receipts/verify-archival': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get?: never;
    put?: never;
    /** @description Public, no credential. Verifies an archival envelope (DOCS/spec/archival-core-v1.md §3) with the successor archival verifier against this server's own configuration only: its published receipt keys, its receipt issuer as the expected context issuer, its published witness key set (/.well-known/sess-witness-keys.json) and, when configured, its TUF-verified witness trusted root. Nothing in the request is trusted. It reports the independent dimensions of archival-core-v1 §5 (signature, contents, context, witness, key_trust, live_expiry) with the same statuses and reasons as @sess.si/sdk/archival, and their presentation. The body is the envelope only: contents is therefore unverifiable: content_unavailable (verify a bundle-v1 at /v1/receipts/verify for content), and context is at most incomplete (application_context_unchecked). Without a witness trusted root, attached evidence is indeterminate: witness_trust_unavailable. It looks nothing up and stores nothing. A malformed or oversized envelope is a 200 result. The bundle route is unchanged. Body: application/json, at most 2097152 bytes (413 above); 65,536 bytes envelope bound (reason oversized). The same per-client and total rate limits as /v1/receipts/verify, shared with it (429 RATE_LIMITED with Retry-After), and the same absolute 2-second deadline from the request's arrival (503 SERVICE_UNAVAILABLE with Connection: close). Cache-Control: no-store, no-transform; Referrer-Policy: no-referrer; CORS only for the product site origins. Never put an envelope or receipt in a URL. */
    post: operations['verifyArchivalEnvelope'];
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  '/v1/targets': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    /** @description The owner workspace’s targets with owner-only start and completion counts. */
    get: operations['listTargets'];
    put?: never;
    /** @description Registers an HTTP Agent Target in the owner workspace (from the credential only). Requires the explicit type http, an https endpoint on port 443 (no user info or fragment; an IP literal must be public), a versioned capability with a bounded input schema, a grant policy (audience origins and lifetime), a budget and an optional enabled switch. Starts are possible only after domain verification. Human, trial and probe credentials cannot register or modify targets. An optional Idempotency-Key makes a retry safe: the same request returns the original target. */
    post: operations['registerTarget'];
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  '/v1/targets/{id}': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get: operations['getTarget'];
    put?: never;
    post?: never;
    delete?: never;
    options?: never;
    head?: never;
    /** @description Enables or disables the target, or changes its capability, grant policy or budget (each of those increments the version). Disabling refuses new starts at once and fails admitted runs not yet dispatched (target_disabled); a new version makes older grants stale (409 TARGET_VERSION_CONFLICT on start) and fails admitted runs not yet dispatched (stale_binding). Runs already dispatched are not recalled. */
    patch: operations['updateTarget'];
    trace?: never;
  };
  '/v1/targets/{id}/sharing': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get?: never;
    put?: never;
    post?: never;
    delete?: never;
    options?: never;
    head?: never;
    /** @description Sets how the target is shared at /a/{name}: the name, whether it is shared (off by default), the owner description and data-source attribution shown on the card, and whether a finished run offers “Ask this agent again”. Not part of the versioned binding: the version does not change and admitted runs continue. The card answers 404 unless the target is shared, enabled and verified, lists the site origin among its grant audiences and accepts an empty start input; unsharing or disabling makes it 404 at once, and admission refuses every grant the card issued while the target is not shared. Start and completion counts stay owner-only (TargetResponse.counts). */
    patch: operations['updateTargetSharing'];
    trace?: never;
  };
  '/v1/targets/{id}/verify': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get?: never;
    put?: never;
    /** @description GETs /.well-known/sess-target/{id}.json on the endpoint origin through the egress safeguards (no redirect followed, non-public and rebound addresses refused) and verifies the target for 30 days when it is a JSON TargetVerificationDocument naming this target_id and its verification token. Never calls the capability endpoint. */
    post: operations['verifyTarget'];
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  '/v1/targets/{id}/grants': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get?: never;
    put?: never;
    /** @description Issues a start grant (256-bit, stored only as a hash) bound to this workspace, target, current target version, capability and one audience origin from the grant policy, expiring after the policy lifetime. The secret is returned once. */
    post: operations['issueTargetGrant'];
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  '/v1/targets/{id}/grants/{grant_id}/revoke': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get?: never;
    put?: never;
    /** @description Revokes a grant at once (idempotent). Runs it already admitted continue and stay observable with their participant credential. */
    post: operations['revokeTargetGrant'];
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  '/v1/invocations': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get?: never;
    put?: never;
    /** @description The deliberate start: one transaction checks the grant (live, unrevoked, from its audience Origin) and the target (enabled, verified, same version and capability), validates the input, reserves global, workspace, target, grant and client-bucket limits, records the Invocation with its request identity and an audit event, and enqueues its dispatch. Target, endpoint, capability and policy come only from the grant; any other body field is refused. The same request_id and body returns the same run (200) with the same participant credential; a different body → 409 IDEMPOTENCY_CONFLICT. GET never starts work. Initial limits: 10 active runs globally and per workspace, 1 per grant, 10 starts per client per 24 h, the target’s own budget; a 15-minute run lifetime; input at most 4 KiB. An operator switch refuses every start (503, reason admission_disabled). A target whose workspace is at its plan limit starts nothing new (429, reason workspace_paused); its admitted runs finish. */
    post: operations['startInvocation'];
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  '/v1/invocations/{id}': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    /** @description The run’s status and, once completed, its bound result. */
    get: operations['getInvocation'];
    put?: never;
    post?: never;
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  '/v1/invocations/{id}/cancel': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get?: never;
    put?: never;
    /** @description Cancels an active run (idempotent once cancelled). A run not yet dispatched is never sent; a later target answer is recorded as late and never applied. */
    post: operations['cancelInvocation'];
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  '/v1/invocations/{id}/result': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get?: never;
    put?: never;
    /** @description The target’s result for a dispatched run, with the callback credential of that dispatch, naming the same invocation_id and target_version. Terminal runs never reopen: a late result → 409 INVOCATION_TERMINAL. */
    post: operations['reportInvocationResult'];
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  '/v1/evidence': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    /** @description P2-13 V6: the custody records of the owner workspace (from the credential only), newest first: archival custody by workspace sequence, or (custody=exception) the receipts held unverified, by acceptance time. Minimal metadata only; a list never carries a receipt, a Surface or an answer. Filters: target_id (records whose archival core binds that target; records with no target binding never match) and accepted_from/accepted_to. Every answer is labelled "issued records in this defined scope/range" with complete_history false: it is never a complete history. Cursor-paginated (next_cursor). Cache-Control: no-store, no-transform. */
    get: operations['listEvidence'];
    put?: never;
    post?: never;
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  '/v1/evidence/export': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get?: never;
    put?: never;
    /** @description P2-13 V6: a deliberate, bounded export of one explicit range of the owner workspace’s custody records: both from_sequence and to_sequence (archival), or both accepted_from and accepted_to. At most limit (≤ 100) records and 8 MiB; a range beyond either is truncated and range.next_cursor continues it. Each record carries its exact receipt, its archival envelope (signed core and preservation evidence) and preservation status; the original Surface and input only while still retained, otherwise content {status: unavailable, reason: purged} (never reconstructed). Exception-custody records are labelled unverified. The document carries a disclosure warning and the scope label "issued records in this defined scope/range" (never a complete history). Content-Disposition: attachment; the filename is built from the workspace, custody and range only. At most 6 exports per workspace per 10 minutes. The export’s content is never logged. */
    post: operations['exportEvidence'];
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  '/v1/evidence/records/{event_id}': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    /** @description P2-13 V5: the status of one custody record of the owner workspace (from the credential only), never its content: available, restricted (with its reason code and since when) or deleted (with its reason code and deletion time). A restricted or deleted record is excluded from the list, the export, its bundle and every other receipt-scoped fetch; a restricted one stays verifiable for preservation integrity. Restriction, holds and deletion are decided by the operator through the recorded procedure (DOCS/spec/custody-restriction-deletion-v1.md); holds are not shown here. A deletion does not recall exported copies or files people already kept, and the public witness commitment (an aggregate batch root) remains. Another workspace’s record, or an unknown event ID, is 404. Cache-Control: no-store, no-transform. */
    get: operations['getEvidenceRecordStatus'];
    put?: never;
    post?: never;
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  '/.well-known/sess-receipt-keys.json': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    /** @description The public decision-receipt verification keys as a JWK Set (Ed25519, alg EdDSA): the active signing key and every retained key of the rotation overlap. Verify a receipt (compact JWS, typ sess-receipt+jwt) with the key its protected header kid names. Expected issuer: configured SESS_RECEIPT_ISSUER, otherwise the origin of SESS_PUBLIC_BASE_URL. Expected audience: the Session’s actual workspace, from independently trusted configuration or Sess-Workspace-Id on authenticated owner create/retrieve. Claimed trials retain their original workspace. No credential. 503 SERVICE_UNAVAILABLE while the receipt keys are not configured. Cache-Control: no-store, no-transform. */
    get: operations['receiptKeys'];
    put?: never;
    post?: never;
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  '/.well-known/sess-renderer-identities.json': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    /** @description Decision 0009 Amendment 13: the renderer identities Sess signs receipts under (the values of a receipt’s surface.renderer_version), as one JWS signed with the receipt keys, in the RFC 7515 flattened JSON serialization {protected, payload, signature} (joined with dots they are its compact form). Protected header {alg EdDSA, kid, typ sess-renderer-identities+jwt}; payload the RFC 8785 canonical JSON {sess_renderer_identities: 1, iss: the receipt issuer, seq: the list edition (an integer, higher in every later published edition), iat: when this copy was signed (NumericDate), identities: [{renderer_version, since: the UTC date it was added}]}; the signature covers seq and iat. Order authentic lists by seq, with containment as the cross-check; an older list still proves the identities it contains. Verify it with GET /.well-known/sess-receipt-keys.json (the key its kid names) and the expected issuer; a receipt verifies when its renderer_version is on a list whose signature verifies. The list only grows: an identity is never removed, reordered or reused, so every receipt issued keeps verifying (sess-html-form-1 is always on it). DOCS/spec/receipt-v1.md §10. No credential. 503 SERVICE_UNAVAILABLE while the receipt keys are not configured. Cache-Control: no-store, no-transform. */
    get: operations['rendererIdentities'];
    put?: never;
    post?: never;
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  '/.well-known/sess-witness-keys.json': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    /** @description The issuer’s published witness key set (DOCS/spec/witness-evidence-v1.md §5.1): the public ECDSA P-256 keys that sign witness checkpoints, each with its validity window. The current key has valid_to null; a rotated-out key is kept with its closed window, so evidence it signed stays verifiable. Read with parseWitnessKeySet and pass as the witnessKeys anchor of verifyWitnessEvidence, beside an independently distributed trusted root. Public keys only. No credential. Empty keys when no witness key is configured; 503 SERVICE_UNAVAILABLE when a configured key set is unusable (it is never trimmed or served empty). Cache-Control: no-store, no-transform. */
    get: operations['witnessKeys'];
    put?: never;
    post?: never;
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  '/openapi.json': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    /** @description This document: the generated, CI-drift-checked contract of the artifact. */
    get: operations['openApi'];
    put?: never;
    post?: never;
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  '/health/live': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    /** @description Process liveness only: no dependency is called. Cache-Control: no-store. */
    get: operations['healthLive'];
    put?: never;
    post?: never;
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  '/health/ready': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    /** @description Readiness, checked within a bound and never cached: the owner key and the decision-receipt signing keys are configured and usable, the build identity is complete and valid (git_sha, build_id and build_time are all non-null in /version), the database answers, and every migration bundled with the artifact is applied. Concurrent requests share the check in progress; the next request after it settles runs a new one. Never migrates and never calls a telemetry backend. Query parameters are ignored. Cache-Control: no-store. */
    get: operations['healthReady'];
    put?: never;
    post?: never;
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  '/version': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    /** @description Non-secret build identity. Answers 200 even when readiness does not. git_sha, build_id and build_time are each null when not supplied or invalid (git_sha: SESS_GIT_SHA missing, empty or malformed; build_time also while it is more than 5 s in the future, checked per request); any null fails readiness (503). Cache-Control: no-store. */
    get: operations['version'];
    put?: never;
    post?: never;
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
}
export interface webhooks {
  responseAccepted: {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get?: never;
    put?: never;
    /** @description Sent for every accepted response while the workspace has a verified endpoint. Signed per workspace (Standard Webhooks v1): webhook-id = event_id (stable across retries and redeliveries: deduplicate on it), webhook-timestamp (seconds), webhook-signature = space-separated v1,<base64 HMAC-SHA256(secret, id.timestamp.body)>, one per secret in force (two during a 24-hour rotation overlap), sess-webhook-key-ids = their key IDs. HTTPS on port 443, no redirects followed, 10-second timeout, response read up to 64 KiB. 2xx = accepted by the endpoint (not that the workflow resumed); 5xx, 429 (Retry-After honored up to 1 h), 408, 425, timeouts and disconnects are retried with jitter up to 12 attempts within 24 h (a job out of budget ends exhausted); 3xx and other 4xx (including 401/403) are permanent. Delivery is at least once. */
    post: operations['webhookResponseAccepted'];
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  endpointVerification: {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get?: never;
    put?: never;
    /** @description Sent by POST /v1/webhook/verify to the exact registered URL, signed like deliveries. Answer 2xx with a JSON body (at most 4 KiB) {"challenge": <the same value>}. */
    post: operations['webhookEndpointVerification'];
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  targetDispatch: {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get?: never;
    put?: never;
    /** @description POSTed to the exact registered target endpoint once per admitted Invocation, through the same egress safeguards as webhooks (HTTPS on port 443, every connection resolved and refused for non-public addresses, no redirects followed, 10-second timeout, response read up to 64 KiB). Headers: content-type, User-Agent Sess-Target/1 and sess-invocation-id (deduplicate on it); never an owner key, Sess link or caller header. Answer 2xx with TargetDispatchAnswer naming the same invocation_id and target_version: accepted (report later on callback.url with callback.credential), completed with result, or failed. An answer that does not bind, a timeout, a dropped connection or a 5xx leaves the Invocation unknown: it is never treated as success and never sent again. Only a DNS failure or an explicit 429/503 is retried (at most 3 attempts within the Invocation lifetime); 3xx and other 4xx fail it. */
    post: operations['targetDispatch'];
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
}
export interface components {
  schemas: {
    CreateSessionRequest: {
      interaction:
        | {
            /** @constant */
            mode: 'display';
            /**
             * @description The page's heading: a question or a task, about 40 characters; at most 80. Longer fails with 400 INVALID_SCHEMA naming it; never truncated.
             * @example Approve the refund?
             * @example Pick a delivery date
             */
            title: string;
            description?: string;
            source: {
              /** @constant */
              kind: 'data';
              data: {
                [key: string]:
                  | (string | number | boolean | null)
                  | {
                      [key: string]: string | number | boolean | null;
                    }
                  | {
                      [key: string]: string | number | boolean | null;
                    }[];
              };
            };
          }
        | {
            /** @constant */
            mode: 'interactive';
            /**
             * @description The page's heading: a question or a task, about 40 characters; at most 80. Longer fails with 400 INVALID_SCHEMA naming it; never truncated.
             * @example Approve the refund?
             * @example Pick a delivery date
             */
            title: string;
            /**
             * @description Optional context under the title: what the person decides and why, in one or two plain sentences; at most 280. Longer fails with 400 INVALID_SCHEMA naming it; never truncated.
             * @example The customer was charged twice for order 1042.
             */
            description?: string;
            /** @description Advanced. Optional position in a sequence of questions: integers with 1 ≤ step ≤ total ≤ 20. The person sees it as a small counter ("1/2"). Anything else fails with 400 INVALID_SCHEMA. */
            progress?: {
              step: number;
              total: number;
            };
            source: {
              /** @constant */
              kind: 'sess_surface';
              components: ({
                type: string;
              } & {
                [key: string]: unknown;
              })[];
            };
            actions: {
              id: string;
              /**
               * @description A button: a verb, 1–3 words; at most 24. Longer fails with 400 INVALID_SCHEMA naming it; never truncated.
               * @example Approve
               * @example Send refund
               */
              label: string;
              intent?: 'submit' | 'continue' | 'approve' | 'reject' | 'request_change';
            }[];
            /**
             * @description One accepted response per revision (the only P1 policy; the default).
             * @constant
             */
            response_policy?: 'first';
          };
      /** @description Advanced. How long the Sess link stays open, in seconds from creation: at least 30 and at most the plan’s live-link lifetime (Free 604800, Starter and Pro 2592000; the deployment owner key 2592000). Absent: the plan’s lifetime. Out of range → 400 INVALID_SCHEMA, whose message names both bounds. Completion never moves the expiry. */
      expires_in?: number;
      /** @description Advanced. The invocation_id of the run your registered agent received, when this Session serves that run. Sess then records the agent and its version with every receipt it keeps for this Session. The run must be in your workspace and still open: an unknown run → 422 VALIDATION_FAILED (reason unknown_invocation); a run that has ended → 409 INVOCATION_TERMINAL. Absent: the Session is not tied to a run. */
      invocation_id?: string;
    };
    CreateSessionResponse: {
      id: string;
      revision: number;
      human_url: string;
      /** @description The Sess link’s current deadline for answers: an RFC 3339 UTC instant with milliseconds. From this instant the link no longer opens and accepts no response. Set when the Session is created and never extended by a read; never null. For an interactive link of 20 hours or less the person may move it forward by asking for more time, never past action_expires_horizon (see link_state). A link revoked by the operator stops earlier; this field does not report revocation. */
      action_expires_at: string;
    };
    SessionResponse: {
      id: string;
      revision: number;
      /** @description The Sess link’s current deadline for answers: an RFC 3339 UTC instant with milliseconds. From this instant the link no longer opens and accepts no response. Set when the Session is created and never extended by a read; never null. For an interactive link of 20 hours or less the person may move it forward by asking for more time, never past action_expires_horizon (see link_state). A link revoked by the operator stops earlier; this field does not report revocation. */
      action_expires_at: string;
      /** @description For an interactive Sess link of 20 hours or less (created with expires_in of 72000 or less, or a trial): the fixed instant after which the link can never be extended or reopened, set when the Session is created: creation + the original lifetime + 10 × min(original lifetime, 1 hour). It never moves. null for a link longer than 20 hours, a display Session, or a Session created before link extensions existed: their links end at action_expires_at. */
      action_expires_horizon: string | null;
      /** @description How many times the person extended the link (at most 10). Each extension moves action_expires_at forward by min(original lifetime, 1 hour), never past action_expires_horizon. Always 0 when action_expires_horizon is null. */
      extensions_used: number;
      /** @description The Sess link’s state at the time of this read. live: it opens and accepts answers (before action_expires_at). lapsed: past action_expires_at, but the person can still ask for more time until action_expires_horizon; it accepts no answer and does not open, and the Session is still open for your agent: keep waiting. expired: it will never accept an answer (at the horizon, once the deadline passes with no extensions left, on revocation, or after the deadline of a completed Session). Revoke the link when you need a hard end at the deadline. An answer accepted while live stays the result. */
      link_state: 'live' | 'lapsed' | 'expired';
      /** @description Every accepted extension of the Sess link, in order: at most ten, empty when none (always empty when action_expires_horizon is null). Recorded atomically with each extension; a repeated request is never recorded twice. No answer or field value is recorded. */
      extensions: {
        /** @description Its number, 1 to 10, in order. */
        number: number;
        /** @description The deadline (action_expires_at) before this extension. */
        previous_action_expires_at: string;
        /** @description The deadline this extension set. */
        action_expires_at: string;
        /** @description True when the person asked after the deadline (lapsed): the new deadline is counted from that moment; false when asked in time: it is counted from the old deadline. */
        from_lapsed: boolean;
        /** @description When the extension was accepted. */
        extended_at: string;
      }[];
      interaction: {
        /** @constant */
        mode: 'display';
        title: string;
        description?: string;
        source: {
          /** @constant */
          kind: 'data';
          data: {
            [key: string]:
              | (string | number | boolean | null)
              | {
                  [key: string]: string | number | boolean | null;
                }
              | {
                  [key: string]: string | number | boolean | null;
                }[];
          };
        };
      };
    };
    InteractiveSessionResponse: {
      id: string;
      status: 'active' | 'responded' | 'completed';
      /** @description The current Surface revision. */
      revision: number;
      /** @description The Sess link’s current deadline for answers: an RFC 3339 UTC instant with milliseconds. From this instant the link no longer opens and accepts no response. Set when the Session is created and never extended by a read; never null. For an interactive link of 20 hours or less the person may move it forward by asking for more time, never past action_expires_horizon (see link_state). A link revoked by the operator stops earlier; this field does not report revocation. */
      action_expires_at: string;
      /** @description For an interactive Sess link of 20 hours or less (created with expires_in of 72000 or less, or a trial): the fixed instant after which the link can never be extended or reopened, set when the Session is created: creation + the original lifetime + 10 × min(original lifetime, 1 hour). It never moves. null for a link longer than 20 hours, a display Session, or a Session created before link extensions existed: their links end at action_expires_at. */
      action_expires_horizon: string | null;
      /** @description How many times the person extended the link (at most 10). Each extension moves action_expires_at forward by min(original lifetime, 1 hour), never past action_expires_horizon. Always 0 when action_expires_horizon is null. */
      extensions_used: number;
      /** @description The Sess link’s state at the time of this read. live: it opens and accepts answers (before action_expires_at). lapsed: past action_expires_at, but the person can still ask for more time until action_expires_horizon; it accepts no answer and does not open, and the Session is still open for your agent: keep waiting. expired: it will never accept an answer (at the horizon, once the deadline passes with no extensions left, on revocation, or after the deadline of a completed Session). Revoke the link when you need a hard end at the deadline. An answer accepted while live stays the result. */
      link_state: 'live' | 'lapsed' | 'expired';
      /** @description Every accepted extension of the Sess link, in order: at most ten, empty when none (always empty when action_expires_horizon is null). Recorded atomically with each extension; a repeated request is never recorded twice. No answer or field value is recorded. */
      extensions: {
        /** @description Its number, 1 to 10, in order. */
        number: number;
        /** @description The deadline (action_expires_at) before this extension. */
        previous_action_expires_at: string;
        /** @description The deadline this extension set. */
        action_expires_at: string;
        /** @description True when the person asked after the deadline (lapsed): the new deadline is counted from that moment; false when asked in time: it is counted from the old deadline. */
        from_lapsed: boolean;
        /** @description When the extension was accepted. */
        extended_at: string;
      }[];
      interaction: {
        /** @constant */
        mode: 'interactive';
        title: string;
        description?: string;
        /** @description Advanced. Optional position in a sequence of questions: integers with 1 ≤ step ≤ total ≤ 20. The person sees it as a small counter ("1/2"). Anything else fails with 400 INVALID_SCHEMA. */
        progress?: {
          step: number;
          total: number;
        };
        source: {
          /** @constant */
          kind: 'sess_surface';
          components: (
            | {
                /** @constant */
                type: 'heading';
                text: string;
              }
            | {
                /** @constant */
                type: 'text';
                text: string;
              }
            | {
                /** @constant */
                type: 'record';
                label?: string;
                fields: {
                  [key: string]: string | number | boolean | null;
                };
              }
            | {
                /** @constant */
                type: 'field';
                name: string;
                label: string;
                description?: string;
                required?: boolean;
                /** @description A string field rendered as a multi-line text area. */
                multiline?: boolean;
                /** @description Display labels for enum values (default: the value itself). */
                option_labels?: {
                  [key: string]: string;
                };
                /** @description The field value schema, JSON Schema 2020-12 restricted to: type string (minLength, maxLength, enum), number or integer (minimum, maximum, exclusiveMinimum, exclusiveMaximum), boolean, or array of string enum IDs (items {type: string, enum}, minItems, maxItems, uniqueItems: true). title and description are allowed on the field value schema itself; array items permit only type and enum. Any other keyword fails with INVALID_SCHEMA. */
                schema: {
                  [key: string]: unknown;
                };
                /** @description The proposed value shown to the person (a correction is a field with a proposed value). It must be valid against the field schema. */
                value?: unknown;
              }
          )[];
        };
        actions: {
          id: string;
          label: string;
          intent?: 'submit' | 'continue' | 'approve' | 'reject' | 'request_change';
        }[];
        /** @constant */
        response_policy: 'first';
      };
      /** @description The JSON Schema 2020-12 the current revision’s responses are validated against. */
      response_schema: {
        [key: string]: unknown;
      };
      /** @description Every accepted response, in sequence order, each bound to its revision. */
      responses: {
        event_id: string;
        /** @description Monotonic per-Session Event sequence. */
        sequence: number;
        /** @description The Surface revision it was accepted on. */
        revision: number;
        action_id: string;
        /** @description The normalized typed result, valid against that revision’s response_schema. */
        data: {
          [key: string]: unknown;
        };
        actor: {
          /** @constant */
          assurance: 'link_holder';
        };
        /** @description ISO 8601 UTC time of acceptance. */
        accepted_at: string;
        /** @description The signed decision receipt: a compact JWS (EdDSA/Ed25519, typ sess-receipt+jwt, kid) over the RFC 8785 canonical claims, verifiable with GET /.well-known/sess-receipt-keys.json. Issued once in the acceptance transaction and never re-signed. Its exp is at least 720 hours after acceptance and, for an owner-key Session that is purged automatically, no earlier than the Session’s latest possible purge (its Sess link’s expiry plus its retention after it ends). null only for responses accepted before receipts existed. */
        receipt: string | null;
      }[];
    };
    InteractiveSurfaceResponse: {
      id: string;
      revision: number;
      interaction: {
        /** @constant */
        mode: 'interactive';
        title: string;
        description?: string;
        /** @description Advanced. Optional position in a sequence of questions: integers with 1 ≤ step ≤ total ≤ 20. The person sees it as a small counter ("1/2"). Anything else fails with 400 INVALID_SCHEMA. */
        progress?: {
          step: number;
          total: number;
        };
        source: {
          /** @constant */
          kind: 'sess_surface';
          components: (
            | {
                /** @constant */
                type: 'heading';
                text: string;
              }
            | {
                /** @constant */
                type: 'text';
                text: string;
              }
            | {
                /** @constant */
                type: 'record';
                label?: string;
                fields: {
                  [key: string]: string | number | boolean | null;
                };
              }
            | {
                /** @constant */
                type: 'field';
                name: string;
                label: string;
                description?: string;
                required?: boolean;
                /** @description A string field rendered as a multi-line text area. */
                multiline?: boolean;
                /** @description Display labels for enum values (default: the value itself). */
                option_labels?: {
                  [key: string]: string;
                };
                /** @description The field value schema, JSON Schema 2020-12 restricted to: type string (minLength, maxLength, enum), number or integer (minimum, maximum, exclusiveMinimum, exclusiveMaximum), boolean, or array of string enum IDs (items {type: string, enum}, minItems, maxItems, uniqueItems: true). title and description are allowed on the field value schema itself; array items permit only type and enum. Any other keyword fails with INVALID_SCHEMA. */
                schema: {
                  [key: string]: unknown;
                };
                /** @description The proposed value shown to the person (a correction is a field with a proposed value). It must be valid against the field schema. */
                value?: unknown;
              }
          )[];
        };
        actions: {
          id: string;
          label: string;
          intent?: 'submit' | 'continue' | 'approve' | 'reject' | 'request_change';
        }[];
        /** @constant */
        response_policy: 'first';
      };
      response_schema: {
        [key: string]: unknown;
      };
    };
    DisplaySurfaceResponse: {
      id: string;
      revision: number;
      interaction: {
        /** @constant */
        mode: 'display';
        title: string;
        description?: string;
        source: {
          /** @constant */
          kind: 'data';
          data: {
            [key: string]:
              | (string | number | boolean | null)
              | {
                  [key: string]: string | number | boolean | null;
                }
              | {
                  [key: string]: string | number | boolean | null;
                }[];
          };
        };
      };
    };
    HumanStatusResponse: {
      state: 'waiting' | 'active' | 'completed';
      /** @description The current Surface revision. */
      revision: number;
    };
    SessionEventsResponse: {
      id: string;
      /** @description Every Event of the Session, in sequence order (append-only; never rewritten). */
      events: {
        event_id: string;
        /** @description Monotonic per-Session sequence. */
        sequence: number;
        type: 'response.accepted' | 'revision.published' | 'session.completed';
        /** @description response.accepted: the revision the response was accepted on; revision.published: the revision published; session.completed: the current revision at completion. */
        revision: number;
        actor: {
          assurance: 'link_holder' | 'owner';
        };
        action_id?: string;
        /** @description response.accepted only: the typed result, valid against that revision. */
        data?: {
          [key: string]: unknown;
        };
        /** @description ISO 8601 UTC time the Event was recorded. */
        created_at: string;
        /** @description The signed decision receipt: a compact JWS (EdDSA/Ed25519, typ sess-receipt+jwt, kid) over the RFC 8785 canonical claims, verifiable with GET /.well-known/sess-receipt-keys.json. Issued once in the acceptance transaction and never re-signed. Its exp is at least 720 hours after acceptance and, for an owner-key Session that is purged automatically, no earlier than the Session’s latest possible purge (its Sess link’s expiry plus its retention after it ends). null only for responses accepted before receipts existed. */
        receipt?: string | null;
      }[];
      /** @description Decision 0009 Amendment 10: every accepted extension of the Sess link, in order (the same records as the Session read’s extensions). Listed beside the Events, not as an Event type, so readers of the Event types above are unaffected. Present only where the deployment has enabled link extensions. */
      link_extensions?: {
        /** @description Its number, 1 to 10, in order. */
        number: number;
        /** @description The deadline (action_expires_at) before this extension. */
        previous_action_expires_at: string;
        /** @description The deadline this extension set. */
        action_expires_at: string;
        /** @description True when the person asked after the deadline (lapsed): the new deadline is counted from that moment; false when asked in time: it is counted from the old deadline. */
        from_lapsed: boolean;
        /** @description When the extension was accepted. */
        extended_at: string;
      }[];
    };
    ReceiptKeysResponse: {
      /** @description The active signing key and every retained verification key (rotation overlap). A receipt verifies with the key whose kid its protected header names; there is no fallback key. */
      keys: {
        /** @constant */
        kty: 'OKP';
        /** @constant */
        crv: 'Ed25519';
        x: string;
        kid: string;
        /** @constant */
        alg: 'EdDSA';
        /** @constant */
        use: 'sig';
      }[];
    };
    WitnessKeysResponse: {
      /** @constant */
      type: 'sess.witness-key-set';
      /** @constant */
      version: 1;
      /** @description The receipt issuer whose witness checkpoints these keys sign. */
      issuer: string;
      /** @description The current witness key (open window) first, then every retained key, newest first. Empty when no witness key is configured. */
      keys: {
        /** @description sha256:<hex> of the SPKI DER: the key id stored with each witnessed batch. */
        key_id: string;
        /** @constant */
        key_details: 'PKIX_ECDSA_P256_SHA_256';
        /** @description Standard base64 of the ECDSA P-256 SubjectPublicKeyInfo DER. Public material only. */
        spki: string;
        /** @description RFC 3339 UTC: from when the key may have signed a checkpoint (TSA time). */
        valid_from: string;
        /** @description RFC 3339 UTC end of the window; null for the current key. A retired key keeps its closed window, so evidence it signed stays verifiable. */
        valid_to: string | null;
      }[];
    };
    /** @description A deliberate disclosure of one accepted decision: the receipt, the accepted record and the issuer’s public keys. Never a private key, owner credential or Sess link. At most 1 MiB canonical, depth 32, 1000 items per array and members per object, 100000 values. */
    DecisionBundle: {
      /** @constant */
      type: 'sess.decision-bundle';
      /** @constant */
      version: 1;
      /** @description The receipt-v1 compact JWS exactly as issued. */
      receipt: string;
      content: {
        /** @description The complete normalized Surface document of the accepted revision (its RFC 8785 SHA-256 is the receipt surface.hash). */
        surface: {
          [key: string]: unknown;
        };
        /** @description The complete validated input as accepted (its RFC 8785 SHA-256 is the receipt input_hash). */
        input: {
          [key: string]: unknown;
        };
      };
      keys: {
        /** @description The issuer's public verification keys when the bundle was exported. Disclosed for convenience only: verifiers use keys they trust, never these. */
        keys: {
          /** @constant */
          kty: 'OKP';
          /** @constant */
          crv: 'Ed25519';
          x: string;
          kid: string;
          /** @constant */
          alg?: 'EdDSA';
          /** @constant */
          use?: 'sig';
        }[];
      };
    };
    DecisionBundleVerification: {
      valid: boolean;
      /** @description null when valid; otherwise the first check that failed. */
      reason:
        | (
            | 'malformed'
            | 'oversized'
            | 'unsupported_version'
            | 'receipt_malformed'
            | 'algorithm'
            | 'missing_kid'
            | 'unknown_kid'
            | 'type'
            | 'signature'
            | 'issuer'
            | 'audience'
            | 'expired'
            | 'claims'
            | 'not_yet_valid'
            | 'surface_mismatch'
            | 'input_mismatch'
            | 'context_mismatch'
          )
        | null;
      /** @description The time the receipt was checked against (UTC). */
      checked_at: string;
      content: 'verified' | 'mismatch' | 'not_checked';
      context: {
        status: 'verified' | 'incomplete' | 'mismatch' | 'unchecked' | 'not_checked';
        checked: (
          'audience' | 'workspace_id' | 'session_id' | 'event_id' | 'surface.revision' | 'action.id'
        )[];
        mismatches: (
          'audience' | 'workspace_id' | 'session_id' | 'event_id' | 'surface.revision' | 'action.id'
        )[];
      };
      /** @description Always unchecked from the public verifier: it checks the signed declared context only, never what the decision was for in your application. */
      application_purpose: 'unchecked' | 'matched_caller_context';
      actor: {
        /** @constant */
        assurance: 'link_holder';
      } | null;
      receipt: {
        key_id: string;
        issuer: string;
        audience: string;
        event_id: string;
        session_id: string;
        workspace_id: string;
        step_id: string;
        surface: {
          revision: number;
          hash: string;
          renderer_version: string;
        };
        action: {
          id: string;
          label: string;
          summary: string;
        };
        input_hash: string;
        accepted_at: string;
        expires_at: string;
      } | null;
    };
    /** @description An archival envelope: the original receipt, the signed archival core that binds it and its preservation evidence. Public structure only; never a private key, holder secret or recovery section. */
    ArchivalEnvelope: {
      /** @constant */
      type: 'sess.archival-envelope';
      /** @constant */
      version: 1;
      /** @description The original receipt-v1 compact JWS, exactly as issued. */
      receipt: string;
      signed_core: {
        /** @constant */
        type: 'sess.signed-archival-core';
        /** @constant */
        version: 1;
        /** @description The archival core (archival-core-v1 §1), strictly checked by the verifier. */
        core: {
          [key: string]: unknown;
        };
        signature: {
          /** @constant */
          alg: 'Ed25519';
          kid: string;
          /** @description base64url, 64 bytes. */
          value: string;
        };
      };
      /** @description Detachable preservation evidence: witness evidence version 1 entries (witness-evidence-v1 §4). Empty while the witness is pending. */
      evidence: {
        [key: string]: unknown;
      }[];
    };
    ArchivalVerifyResponse: {
      /** @description The current time the check used (UTC). */
      checked_at: string;
      signature: {
        status: 'valid' | 'invalid' | 'unsupported' | 'unverifiable';
        reason:
          | 'verified'
          | 'malformed'
          | 'oversized'
          | 'wrong_type'
          | 'unknown_version'
          | 'unsupported_algorithm'
          | 'core_signature'
          | 'receipt_digest_mismatch'
          | 'receipt_malformed'
          | 'receipt_signature'
          | 'core_receipt_mismatch'
          | 'untrusted_key';
      };
      contents: {
        status: 'valid' | 'invalid' | 'unsupported' | 'unverifiable';
        reason:
          | 'verified'
          | 'content_unavailable'
          | 'content_mismatch'
          | 'content_malformed'
          | 'content_oversized'
          | 'signature_unverified';
      };
      context: {
        status: 'valid' | 'invalid' | 'unsupported' | 'unverifiable';
        reason: 'verified' | 'unchecked' | 'incomplete' | 'mismatch' | 'signature_unverified';
        /** @description The expected members checked, of: issuer, audience, workspace_id, session_id, event_id, surface_revision, action_id. */
        checked: string[];
        /** @description The checked members that did not match. */
        mismatched: string[];
      };
      witness: {
        status: 'witnessed' | 'pending' | 'indeterminate' | 'invalid' | 'unsupported' | 'unverifiable';
        reason:
          | 'verified'
          | 'unwitnessed'
          | 'malformed_evidence'
          | 'invalid_evidence'
          | 'unsupported_evidence'
          | 'witness_trust_unavailable'
          | 'untrusted_witness_key'
          | 'untrusted_tsa'
          | 'unknown_log'
          | 'renewal_lapsed'
          | 'signature_unverified';
        /** @description Witnessed only: the TSA time, an upper bound on when the signed core existed. */
        witnessed_at?: string;
        /** @description invalid_evidence only: which part failed. */
        detail?: string;
      };
      key_trust: {
        status: 'valid' | 'invalid' | 'unsupported' | 'unverifiable';
        reason: 'trusted' | 'unknown_kid' | 'not_evaluated';
        /**
         * @description Always this server's own published receipt keys, never the envelope's.
         * @constant
         */
        key_set: 'caller_supplied';
        key_set_observed_at: string | null;
      };
      live_expiry: {
        status: 'valid' | 'invalid' | 'unsupported' | 'unverifiable';
        reason: 'unexpired' | 'expired' | 'signature_unverified';
        expires_at: string | null;
      };
      /** @description The validated archival core; null unless signature is valid. */
      core: {
        [key: string]: unknown;
      } | null;
      /** @description The verified receipt-v1 claims; null unless signature is valid. */
      claims: {
        [key: string]: unknown;
      } | null;
      /** @description presentArchivalVerification of the dimensions: the user-facing messages, or the refusal. Witness status and live expiry are beside the messages, never folded in. */
      presentation: {
        verified: boolean;
        messages: (
          | 'signature_verified'
          | 'contents_verified'
          | 'contents_unavailable'
          | 'application_context_unchecked'
        )[];
        refusal: {
          dimension: 'signature' | 'contents' | 'context';
          reason: string;
        } | null;
        witness: 'witnessed' | 'pending' | 'indeterminate' | 'invalid' | 'unsupported' | 'unverifiable';
        expired_for_live_use: boolean | null;
      };
    };
    KeepChallengeRequest: {
      /** @description The Keep grant secrets this browser holds for this link: each the 32-byte secret whose domain-separated SHA-256 was the client_event_id of a round it submitted (`kg-` + hash). A round is authorized only by its own grant. Sent in the body only, never in a URL. */
      grants: string[];
    };
    KeepChallengeResponse: {
      /** @description The authorized accepted rounds the file will hold. */
      rounds: number;
      cutoff_sequence: number;
      challenge: null | {
        id: string;
        nonce: string;
        issuer: string;
        workspace_id: string;
        session_id: string;
        /** Format: date-time */
        expires_at: string;
        /** @description The exact batch, in order: every authorized round whose receipt is in custody and has no holder yet. */
        items: {
          event_id: string;
          core_digest: string;
        }[];
      };
    };
    KeepRequest: {
      /** @description The Keep grant secrets this browser holds for this link: each the 32-byte secret whose domain-separated SHA-256 was the client_event_id of a round it submitted (`kg-` + hash). A round is authorized only by its own grant. Sent in the body only, never in a URL. */
      grants: string[];
      /** @description S-04: `pdf` answers the same kept conversation as a receipt PDF (application/pdf; PDF/A-3b and PDF/UA-1, the exact file embedded unchanged as its one associated file), named "Sess receipt – <title> – <d Mon yyyy>.pdf". A file outside the PDF profile is answered as the JSON instead, whole. Default `json`: the file itself, unchanged. */
      format?: 'json' | 'pdf';
      enrollment?: {
        challenge_id: string;
        /** @description Exactly the challenge's batch in order, or only its final receipt (the disclosed fallback). One distinct key per receipt. */
        items: {
          event_id: string;
          /** @description A fresh public P-256 key (never a private one). */
          holder_key: {
            /** @constant */
            crv: 'P-256';
            /** @constant */
            kty: 'EC';
            x: string;
            y: string;
          };
          /** @description base64url of the 64-byte ECDSA P-256 SHA-256 signature (IEEE P1363) over the holder proof message (DOCS/spec/keep-v1.md §3). */
          proof: string;
        }[];
      };
    };
    /** @description The kept conversation (DOCS/spec/keep-v1.md): every authorized accepted round of the Session through the snapshot cutoff, each with its unchanged receipt-v1, its bundle-v1 while the content is retained (else unavailable, never reconstructed), its preservation status and holder status, plus an inventory. No private key, grant secret or Sess link. Each extracted bundle verifies with the unchanged bundle-v1 verifier. */
    KeptConversation: {
      /** @constant */
      type: 'sess.kept-conversation';
      /** @constant */
      version: 1;
      issuer: string;
      workspace_id: string;
      session_id: string;
      snapshot: {
        cutoff_sequence: number;
        /** Format: date-time */
        taken_at: string;
      };
      coverage: 'every_accepted_round' | 'partial';
      inventory: {
        event_id: string;
        sequence: number;
        revision: number;
        /** Format: date-time */
        accepted_at: string;
        content: 'included' | 'unavailable';
        preservation: 'preserved' | 'not_preserved';
        witness: string | null;
        holder: 'enrolled' | 'unenrolled' | 'revoked';
      }[];
      rounds: {
        event_id: string;
        sequence: number;
        revision: number;
        /** Format: date-time */
        accepted_at: string;
        /** @description The receipt-v1 compact JWS exactly as issued. */
        receipt: string;
        content:
          | {
              /** @constant */
              status: 'included';
              /** @description A deliberate disclosure of one accepted decision: the receipt, the accepted record and the issuer’s public keys. Never a private key, owner credential or Sess link. At most 1 MiB canonical, depth 32, 1000 items per array and members per object, 100000 values. */
              bundle: {
                /** @constant */
                type: 'sess.decision-bundle';
                /** @constant */
                version: 1;
                /** @description The receipt-v1 compact JWS exactly as issued. */
                receipt: string;
                content: {
                  /** @description The complete normalized Surface document of the accepted revision (its RFC 8785 SHA-256 is the receipt surface.hash). */
                  surface: {
                    [key: string]: unknown;
                  };
                  /** @description The complete validated input as accepted (its RFC 8785 SHA-256 is the receipt input_hash). */
                  input: {
                    [key: string]: unknown;
                  };
                };
                keys: {
                  /** @description The issuer's public verification keys when the bundle was exported. Disclosed for convenience only: verifiers use keys they trust, never these. */
                  keys: {
                    /** @constant */
                    kty: 'OKP';
                    /** @constant */
                    crv: 'Ed25519';
                    x: string;
                    kid: string;
                    /** @constant */
                    alg?: 'EdDSA';
                    /** @constant */
                    use?: 'sig';
                  }[];
                };
              };
            }
          | {
              /** @constant */
              status: 'unavailable';
            };
        preservation:
          | {
              /** @constant */
              status: 'preserved';
              /** @description The witness state at snapshot time (the custody witness job: `pending` until a witness attaches, then e.g. `witnessed`); the envelope carries the evidence attached by then. */
              witness: string;
              /** @description The archival envelope (DOCS/spec/archival-core-v1.md). */
              archival_envelope: {
                [key: string]: unknown;
              };
            }
          | {
              /** @constant */
              status: 'not_preserved';
            };
        holder:
          | {
              status: 'enrolled' | 'revoked';
              /** @description A fresh public P-256 key (never a private one). */
              public_key: {
                /** @constant */
                crv: 'P-256';
                /** @constant */
                kty: 'EC';
                x: string;
                y: string;
              };
              key_thumbprint: string;
              /** Format: date-time */
              enrolled_at: string;
              batch: {
                [key: string]: unknown;
              };
              proof: string;
            }
          | {
              /** @constant */
              status: 'unenrolled';
              reason: 'not_preserved' | 'final_only' | 'not_enrolled' | 'holder_withheld';
            };
      }[];
    };
    WebhookRegisterRequest: {
      /** @description Absolute https:// URL on port 443, without user info or fragment. Registering replaces the current endpoint (which stops receiving new deliveries); the new one receives nothing until verified. */
      url: string;
    };
    WebhookRegisterResponse: {
      endpoint: {
        id: string;
        url: string;
        status: 'pending' | 'verified';
        created_at: string;
        verified_at: string | null;
        /** @description The verification lapses 30 days after it succeeds; after that the endpoint is pending again (no new deliveries; queued ones fail endpoint_unavailable) until re-verified. */
        verification_expires_at: string | null;
      };
      /** @description The workspace’s first signing secret when this registration created it, else null. */
      signing_secret: {
        kid: string;
        /** @description Shown once. Store it in the receiver; Sess keeps it only encrypted. */
        secret: string;
      } | null;
    };
    WebhookVerifyResponse: {
      endpoint: {
        id: string;
        url: string;
        status: 'pending' | 'verified';
        created_at: string;
        verified_at: string | null;
        /** @description The verification lapses 30 days after it succeeds; after that the endpoint is pending again (no new deliveries; queued ones fail endpoint_unavailable) until re-verified. */
        verification_expires_at: string | null;
      };
    };
    WebhookResponse: {
      endpoint: {
        id: string;
        url: string;
        status: 'pending' | 'verified';
        created_at: string;
        verified_at: string | null;
        /** @description The verification lapses 30 days after it succeeds; after that the endpoint is pending again (no new deliveries; queued ones fail endpoint_unavailable) until re-verified. */
        verification_expires_at: string | null;
      } | null;
      /** @description Secrets in force, newest first (never the secret values). */
      signing_secrets: {
        kid: string;
        active: boolean;
        retire_at: string | null;
      }[];
      deliveries: {
        pending: number;
        failed: number;
        delivered: number;
        oldest_pending_age_seconds: number | null;
      };
    };
    WebhookRotateResponse: {
      signing_secret: {
        kid: string;
        /** @description Shown once. Store it in the receiver; Sess keeps it only encrypted. */
        secret: string;
      };
      previous: {
        kid: string;
        retire_at: string;
      } | null;
    };
    DeliveriesResponse: {
      id: string;
      deliveries: {
        delivery_id: string;
        event_id: string;
        kind: 'accepted' | 'redelivery';
        status: 'pending' | 'delivered' | 'failed';
        endpoint_id: string;
        next_attempt_at: string | null;
        deadline_at: string;
        created_at: string;
        finished_at: string | null;
        /** @description The job-level outcome: the last attempt’s, or `exhausted` when the attempt or time budget ran out, or `endpoint_unavailable` when its endpoint was replaced, disabled or its verification lapsed. */
        last_outcome:
          | (
              | 'started'
              | 'delivered'
              | 'server_error'
              | 'rate_limited'
              | 'timeout'
              | 'connection'
              | 'dns'
              | 'signing_unavailable'
              | 'request_timeout'
              | 'too_early'
              | 'rejected'
              | 'redirect'
              | 'egress_refused'
              | 'endpoint_unavailable'
              | 'exhausted'
            )
          | null;
        /** @description Every started attempt. `started` with no finish time: the attempt was interrupted (e.g. a crash); the outcome at the endpoint is unknown and the job is retried. */
        attempts: {
          attempt: number;
          started_at: string;
          finished_at: string | null;
          outcome:
            | 'started'
            | 'delivered'
            | 'server_error'
            | 'rate_limited'
            | 'timeout'
            | 'connection'
            | 'dns'
            | 'signing_unavailable'
            | 'request_timeout'
            | 'too_early'
            | 'rejected'
            | 'redirect'
            | 'egress_refused'
            | 'endpoint_unavailable'
            | 'exhausted';
          http_status: number | null;
        }[];
      }[];
    };
    RedeliverResponse: {
      delivery: {
        delivery_id: string;
        event_id: string;
        kind: 'accepted' | 'redelivery';
        status: 'pending' | 'delivered' | 'failed';
        endpoint_id: string;
        next_attempt_at: string | null;
        deadline_at: string;
        created_at: string;
        finished_at: string | null;
        /** @description The job-level outcome: the last attempt’s, or `exhausted` when the attempt or time budget ran out, or `endpoint_unavailable` when its endpoint was replaced, disabled or its verification lapsed. */
        last_outcome:
          | (
              | 'started'
              | 'delivered'
              | 'server_error'
              | 'rate_limited'
              | 'timeout'
              | 'connection'
              | 'dns'
              | 'signing_unavailable'
              | 'request_timeout'
              | 'too_early'
              | 'rejected'
              | 'redirect'
              | 'egress_refused'
              | 'endpoint_unavailable'
              | 'exhausted'
            )
          | null;
        /** @description Every started attempt. `started` with no finish time: the attempt was interrupted (e.g. a crash); the outcome at the endpoint is unknown and the job is retried. */
        attempts: {
          attempt: number;
          started_at: string;
          finished_at: string | null;
          outcome:
            | 'started'
            | 'delivered'
            | 'server_error'
            | 'rate_limited'
            | 'timeout'
            | 'connection'
            | 'dns'
            | 'signing_unavailable'
            | 'request_timeout'
            | 'too_early'
            | 'rejected'
            | 'redirect'
            | 'egress_refused'
            | 'endpoint_unavailable'
            | 'exhausted';
          http_status: number | null;
        }[];
      };
    };
    WebhookDelivery: {
      /** @constant */
      type: 'response.accepted';
      /** @description Stable across retries and redeliveries: deduplicate on it. */
      event_id: string;
      session_id: string;
      sequence: number;
      revision: number;
      action_id: string;
      data: {
        [key: string]: unknown;
      };
      accepted_at: string;
      /** @description The stored signed decision receipt (identical on every delivery). */
      receipt: string | null;
    };
    WebhookVerification: {
      /** @constant */
      type: 'sess.webhook.verification';
      challenge: string;
    };
    PatchSessionRequest: {
      interaction: {
        /** @constant */
        mode: 'interactive';
        /**
         * @description The page's heading: a question or a task, about 40 characters; at most 80. Longer fails with 400 INVALID_SCHEMA naming it; never truncated.
         * @example Approve the refund?
         * @example Pick a delivery date
         */
        title: string;
        /**
         * @description Optional context under the title: what the person decides and why, in one or two plain sentences; at most 280. Longer fails with 400 INVALID_SCHEMA naming it; never truncated.
         * @example The customer was charged twice for order 1042.
         */
        description?: string;
        /** @description Advanced. Optional position in a sequence of questions: integers with 1 ≤ step ≤ total ≤ 20. The person sees it as a small counter ("1/2"). Anything else fails with 400 INVALID_SCHEMA. */
        progress?: {
          step: number;
          total: number;
        };
        source: {
          /** @constant */
          kind: 'sess_surface';
          components: ({
            type: string;
          } & {
            [key: string]: unknown;
          })[];
        };
        actions: {
          id: string;
          /**
           * @description A button: a verb, 1–3 words; at most 24. Longer fails with 400 INVALID_SCHEMA naming it; never truncated.
           * @example Approve
           * @example Send refund
           */
          label: string;
          intent?: 'submit' | 'continue' | 'approve' | 'reject' | 'request_change';
        }[];
        /**
         * @description One accepted response per revision (the only P1 policy; the default).
         * @constant
         */
        response_policy?: 'first';
      };
    };
    SurfaceComponent:
      | {
          /** @constant */
          type: 'heading';
          /**
           * @description A section heading: a few words; at most 60. Longer fails with 400 INVALID_SCHEMA naming it; never truncated.
           * @example Order details
           */
          text: string;
        }
      | {
          /** @constant */
          type: 'text';
          /**
           * @description A paragraph of plain text (never markup): what the person needs to know; at most 4000. Longer fails with 400 INVALID_SCHEMA naming it; never truncated.
           * @example The refund goes back to the card used for the order.
           */
          text: string;
        }
      | {
          /** @constant */
          type: 'record';
          /**
           * @description Optional caption above the record: a few words; at most 200. Longer fails with 400 INVALID_SCHEMA naming it; never truncated.
           * @example Order 1042
           */
          label?: string;
          fields: {
            [key: string]: string | number | boolean | null;
          };
        }
      | {
          /** @constant */
          type: 'field';
          name: string;
          /**
           * @description What the field asks for: short, a few words; at most 60. Longer fails with 400 INVALID_SCHEMA naming it; never truncated.
           * @example Refund amount
           */
          label: string;
          /**
           * @description Optional help under the label: one hint; at most 160. Longer fails with 400 INVALID_SCHEMA naming it; never truncated.
           * @example Leave it as is to refund the full amount.
           */
          description?: string;
          required?: boolean;
          /** @description A string field rendered as a multi-line text area. */
          multiline?: boolean;
          /** @description Display labels for enum values (default: the value itself). */
          option_labels?: {
            [key: string]: string;
          };
          /** @description The field value schema, JSON Schema 2020-12 restricted to: type string (minLength, maxLength, enum), number or integer (minimum, maximum, exclusiveMinimum, exclusiveMaximum), boolean, or array of string enum IDs (items {type: string, enum}, minItems, maxItems, uniqueItems: true). title and description are allowed on the field value schema itself; array items permit only type and enum. Any other keyword fails with INVALID_SCHEMA. */
          schema: {
            [key: string]: unknown;
          };
          /** @description The proposed value shown to the person (a correction is a field with a proposed value). It must be valid against the field schema. */
          value?: unknown;
        };
    HumanSubmissionForm: {
      client_event_id: string;
      surface_revision: string;
      action_id: string;
    } & {
      [key: string]: string;
    };
    HumanExtensionForm: {
      client_event_id: string;
      surface_revision: string;
    } & {
      [key: string]: string;
    };
    Error: {
      error: {
        code:
          | 'INVALID_SCHEMA'
          | 'PAYLOAD_TOO_LARGE'
          | 'UNAUTHORIZED'
          | 'SESSION_NOT_FOUND'
          | 'NOT_FOUND'
          | 'INTERNAL'
          | 'UNKNOWN_COMPONENT'
          | 'SESSION_REVISION_CONFLICT'
          | 'IDEMPOTENCY_CONFLICT'
          | 'PRECONDITION_REQUIRED'
          | 'SESSION_COMPLETED'
          | 'ACTION_NOT_ALLOWED'
          | 'ACTION_NOT_FOUND'
          | 'VALIDATION_FAILED'
          | 'RESPONSE_LIMIT_REACHED'
          | 'SERVICE_UNAVAILABLE'
          | 'RATE_LIMITED'
          | 'TRIAL_UNAVAILABLE'
          | 'SIGN_IN_UNAVAILABLE'
          | 'WEBHOOK_INVALID_URL'
          | 'WEBHOOK_VERIFICATION_FAILED'
          | 'WEBHOOK_NOT_CONFIGURED'
          | 'TARGET_INVALID_URL'
          | 'TARGET_INVALID_CAPABILITY'
          | 'TARGET_VERIFICATION_FAILED'
          | 'TARGET_VERSION_CONFLICT'
          | 'INVOCATION_TERMINAL'
          | 'HOLDER_ENROLLMENT_REFUSED'
          | 'PLAN_LIMIT_REACHED'
          | 'SUBSCRIPTION_EXISTS'
          | 'TARGET_NAME_TAKEN'
          | 'EVIDENCE_RESTRICTED'
          | 'EVIDENCE_DELETED'
          | 'CUSTODY_HOLD_ACTIVE';
        /** @description Plain words for people; clients read code, field, limit and length, never this text. For a value over its length limit it names the value, its length and the limit, and says how to fix it: "Shorten it to at most <limit> characters." */
        message: string;
        request_id: string;
        /** @description A stable machine-readable refinement of some codes (P1 A4 webhook errors; P2 target, admission and limit errors). */
        reason?: string;
        /** @description INVALID_SCHEMA for a value over its length limit only (Decision 0009 Amendment 12): a JSON pointer to that value in the request body, for example /interaction/title (for a record key, the pointer names that key). Other schema errors carry no field, limit or length. */
        field?: string;
        /** @description With field: the most the value may have, in Unicode code points. Interactive Surface: title 80, description 280, heading 60, text 4,000, record caption 200, record key 40, record string value 200, field label 60, field description 160, option label 60, action label 24. Display Session: title 80, description 4,000. */
        limit?: number;
        /** @description With field: the value’s length in Unicode code points. */
        length?: number;
      };
    };
    HealthOk: {
      /** @constant */
      status: 'ok';
    };
    HealthUnavailable: {
      /** @constant */
      status: 'unavailable';
    };
    VersionResponse: {
      /** @description The deployed commit, from SESS_GIT_SHA. null when SESS_GIT_SHA is missing, empty or not exactly 40 lower-case hex characters; readiness then answers 503. Never derived from a checkout or normalized. */
      git_sha: string | null;
      /** @description SESS_BUILD_ID, else the BUILD_ID file at the workspace root of the image. null when neither supplies a valid one; readiness then answers 503. */
      build_id: string | null;
      /** @description ISO 8601 UTC build time, from SESS_BUILD_TIME, else the BUILD_TIME file at the workspace root of the image. Valid when it has real calendar components and is not more than 5 s after the current time, checked on every request. null when neither supplies a valid one, and readiness then answers 503; never the start time. */
      build_time: string | null;
      /** @description The Node.js version (process.version). */
      node_version: string;
    };
    TrialCreateSessionRequest: {
      interaction: {
        /** @constant */
        mode: 'interactive';
        /**
         * @description The page's heading: a question or a task, about 40 characters; at most 80. Longer fails with 400 INVALID_SCHEMA naming it; never truncated.
         * @example Approve the refund?
         * @example Pick a delivery date
         */
        title: string;
        /**
         * @description Optional context under the title: what the person decides and why, in one or two plain sentences; at most 280. Longer fails with 400 INVALID_SCHEMA naming it; never truncated.
         * @example The customer was charged twice for order 1042.
         */
        description?: string;
        /** @description Advanced. Optional position in a sequence of questions: integers with 1 ≤ step ≤ total ≤ 20. The person sees it as a small counter ("1/2"). Anything else fails with 400 INVALID_SCHEMA. */
        progress?: {
          step: number;
          total: number;
        };
        source: {
          /** @constant */
          kind: 'sess_surface';
          components: ({
            type: string;
          } & {
            [key: string]: unknown;
          })[];
        };
        actions: {
          id: string;
          /**
           * @description A button: a verb, 1–3 words; at most 24. Longer fails with 400 INVALID_SCHEMA naming it; never truncated.
           * @example Approve
           * @example Send refund
           */
          label: string;
          intent?: 'submit' | 'continue' | 'approve' | 'reject' | 'request_change';
        }[];
        /**
         * @description One accepted response per revision (the only P1 policy; the default).
         * @constant
         */
        response_policy?: 'first';
      };
    };
    TrialCreateSessionResponse: {
      id: string;
      revision: number;
      /** @description The Sess link (a capability): share it only with the responder. */
      human_url: string;
      /** @description The trial workspace this Session belongs to. */
      workspace_id: string;
      /** @description Returned once, only when this request created the trial (no Authorization header). It reads this trial’s results and creates further Sessions in it; it is never retrievable again. Keep it secret; never put it in a URL. */
      management_credential?: string;
      /** @description After this instant the Sess link accepts no response. */
      action_expires_at: string;
      /** @description Until this instant the result can be read with the management credential. */
      result_available_until: string;
      /** @description After this instant the trial creates no further Session. */
      trial_expires_at: string;
    };
    TrialSessionResponse: {
      id: string;
      status: 'active' | 'responded' | 'completed';
      /** @description The current Surface revision. */
      revision: number;
      /** @description For an interactive Sess link of 20 hours or less (created with expires_in of 72000 or less, or a trial): the fixed instant after which the link can never be extended or reopened, set when the Session is created: creation + the original lifetime + 10 × min(original lifetime, 1 hour). It never moves. null for a link longer than 20 hours, a display Session, or a Session created before link extensions existed: their links end at action_expires_at. */
      action_expires_horizon: string | null;
      /** @description How many times the person extended the link (at most 10). Each extension moves action_expires_at forward by min(original lifetime, 1 hour), never past action_expires_horizon. Always 0 when action_expires_horizon is null. */
      extensions_used: number;
      /** @description The Sess link’s state at the time of this read. live: it opens and accepts answers (before action_expires_at). lapsed: past action_expires_at, but the person can still ask for more time until action_expires_horizon; it accepts no answer and does not open, and the Session is still open for your agent: keep waiting. expired: it will never accept an answer (at the horizon, once the deadline passes with no extensions left, on revocation, or after the deadline of a completed Session). Revoke the link when you need a hard end at the deadline. An answer accepted while live stays the result. */
      link_state: 'live' | 'lapsed' | 'expired';
      /** @description Every accepted extension of the Sess link, in order: at most ten, empty when none (always empty when action_expires_horizon is null). Recorded atomically with each extension; a repeated request is never recorded twice. No answer or field value is recorded. */
      extensions: {
        /** @description Its number, 1 to 10, in order. */
        number: number;
        /** @description The deadline (action_expires_at) before this extension. */
        previous_action_expires_at: string;
        /** @description The deadline this extension set. */
        action_expires_at: string;
        /** @description True when the person asked after the deadline (lapsed): the new deadline is counted from that moment; false when asked in time: it is counted from the old deadline. */
        from_lapsed: boolean;
        /** @description When the extension was accepted. */
        extended_at: string;
      }[];
      interaction: {
        /** @constant */
        mode: 'interactive';
        title: string;
        description?: string;
        /** @description Advanced. Optional position in a sequence of questions: integers with 1 ≤ step ≤ total ≤ 20. The person sees it as a small counter ("1/2"). Anything else fails with 400 INVALID_SCHEMA. */
        progress?: {
          step: number;
          total: number;
        };
        source: {
          /** @constant */
          kind: 'sess_surface';
          components: (
            | {
                /** @constant */
                type: 'heading';
                text: string;
              }
            | {
                /** @constant */
                type: 'text';
                text: string;
              }
            | {
                /** @constant */
                type: 'record';
                label?: string;
                fields: {
                  [key: string]: string | number | boolean | null;
                };
              }
            | {
                /** @constant */
                type: 'field';
                name: string;
                label: string;
                description?: string;
                required?: boolean;
                /** @description A string field rendered as a multi-line text area. */
                multiline?: boolean;
                /** @description Display labels for enum values (default: the value itself). */
                option_labels?: {
                  [key: string]: string;
                };
                /** @description The field value schema, JSON Schema 2020-12 restricted to: type string (minLength, maxLength, enum), number or integer (minimum, maximum, exclusiveMinimum, exclusiveMaximum), boolean, or array of string enum IDs (items {type: string, enum}, minItems, maxItems, uniqueItems: true). title and description are allowed on the field value schema itself; array items permit only type and enum. Any other keyword fails with INVALID_SCHEMA. */
                schema: {
                  [key: string]: unknown;
                };
                /** @description The proposed value shown to the person (a correction is a field with a proposed value). It must be valid against the field schema. */
                value?: unknown;
              }
          )[];
        };
        actions: {
          id: string;
          label: string;
          intent?: 'submit' | 'continue' | 'approve' | 'reject' | 'request_change';
        }[];
        /** @constant */
        response_policy: 'first';
      };
      /** @description The JSON Schema 2020-12 the current revision’s responses are validated against. */
      response_schema: {
        [key: string]: unknown;
      };
      /** @description Every accepted response, in sequence order, each bound to its revision. */
      responses: {
        event_id: string;
        /** @description Monotonic per-Session Event sequence. */
        sequence: number;
        /** @description The Surface revision it was accepted on. */
        revision: number;
        action_id: string;
        /** @description The normalized typed result, valid against that revision’s response_schema. */
        data: {
          [key: string]: unknown;
        };
        actor: {
          /** @constant */
          assurance: 'link_holder';
        };
        /** @description ISO 8601 UTC time of acceptance. */
        accepted_at: string;
        /** @description The signed decision receipt: a compact JWS (EdDSA/Ed25519, typ sess-receipt+jwt, kid) over the RFC 8785 canonical claims, verifiable with GET /.well-known/sess-receipt-keys.json. Issued once in the acceptance transaction and never re-signed. Its exp is at least 720 hours after acceptance and, for an owner-key Session that is purged automatically, no earlier than the Session’s latest possible purge (its Sess link’s expiry plus its retention after it ends). null only for responses accepted before receipts existed. */
        receipt: string | null;
      }[];
      trial: {
        workspace_id: string;
        /** @description After this instant the Sess link accepts no response. */
        action_expires_at: string;
        /** @description Until this instant this result remains readable. */
        result_available_until: string;
      };
    };
    EmailLinkRequest: {
      /** @description The address to send a sign-in link to. Trimmed and lower-cased. */
      email: string;
    };
    EmailLinkAccepted: {
      /**
       * @description The link was handed to the email provider. The same answer for every address: it never says whether an account exists.
       * @constant
       */
      status: 'accepted';
    };
    PersonalSignInRequest: {
      /** @description The address to send the personal sign-in code and link to. Trimmed and lower-cased. */
      email: string;
    };
    PersonalSignInAccepted: {
      /**
       * @description The email was handed to the email provider. The same answer for every address: it never says whether an identity, a personal account or a developer account exists.
       * @constant
       */
      status: 'accepted';
    };
    PersonalCodeRequest: {
      /** @description The six-digit code from the email (spaces and hyphens are ignored). */
      code: string;
    };
    PersonalLinkRequest: {
      /** @description The sign-in link token, read by the page from the link’s URL fragment (it is never in a request URL). */
      token: string;
    };
    PersonalEmptyRequest: Record<string, never>;
    PersonalSignedInResponse: {
      /** @constant */
      status: 'signed_in';
      /**
       * Format: date-time
       * @description The personal session’s absolute expiry (never extended).
       */
      expires_at: string;
      /** @description The personal session’s CSRF token: send it as the x-sess-csrf header on /personal/sign-out and /personal/close. */
      csrf: string;
    };
    PersonalSessionResponse: {
      /** @description The address of this session’s own identity. */
      email: string;
      /** Format: date-time */
      expires_at: string;
      /** @description The personal session’s CSRF token: send it as the x-sess-csrf header on /personal/sign-out and /personal/close. */
      csrf: string;
    };
    PersonalDone: {
      status: 'signed_out' | 'closed';
    };
    SaveClaimRequest: {
      /** @description The Keep grant secrets this browser holds for this link: each the 32-byte secret whose domain-separated SHA-256 was the client_event_id of a round it submitted (`kg-` + hash). A round is authorized only by its own grant. Sent in the body only, never in a URL. */
      grants: string[];
      /** @description base64url SHA-256 of UTF-8 "sess.personal-save.source/v1", one 0x00 byte and the source verifier: a 32-byte random value (base64url) this page keeps and hands only to the destination page. */
      source: string;
      /** @description The destination binding the signed-in destination page obtained from POST /personal/save/destination for its own nonce. */
      destination: string;
    };
    SaveClaimResponse: {
      /** @description The 256-bit transfer secret (stored only as its hash). Hand it, with the source verifier, only to the destination page, in a window message or a body; never put it in a URL. */
      secret: string;
      /**
       * Format: date-time
       * @description The claim’s expiry.
       */
      expires_at: string;
    };
    SaveDestinationRequest: {
      /** @description A 32-byte random nonce this destination page keeps until it redeems. */
      nonce: string;
    };
    SaveDestinationResponse: {
      /** @description The destination binding: bound to the nonce and to this personal session, so a claim made for it can be redeemed only by this session presenting the same nonce. */
      destination: string;
    };
    SaveRedeemRequest: {
      /** @description The claim’s transfer secret. */
      secret: string;
      /** @description The source verifier whose hash the claim was created with. */
      verifier: string;
      /** @description This page’s nonce, the one its destination binding was made for. */
      nonce: string;
    };
    SaveDirectRequest: {
      /** @description The Sess link token of the page on this same origin (read from its path; sent only in this body, never in a URL). */
      link: string;
      /** @description The Keep grant secrets this browser holds for this link: each the 32-byte secret whose domain-separated SHA-256 was the client_event_id of a round it submitted (`kg-` + hash). A round is authorized only by its own grant. Sent in the body only, never in a URL. */
      grants: string[];
    };
    SavedResponse: {
      /** @constant */
      status: 'saved';
      /**
       * Format: date-time
       * @description When the saved copy was written. The identical request again answers the same time: nothing is written twice.
       */
      saved_at: string;
    };
    PersonalCopyRequest: {
      /** @description A saved copy of this personal account, as GET /personal/copies lists it. */
      item: string;
    };
    PersonalCopiesResponse: {
      /** @description The newest saved copies first, at most 100. */
      copies: {
        item: string;
        /** Format: date-time */
        saved_at: string;
        /** @description `partly_unavailable` or `unavailable` when an operator restriction or deletion whose scope reaches personal copies withholds rounds or holder proofs of it: that content is never served, and the status never says why. */
        status: 'available' | 'partly_unavailable' | 'unavailable';
        /** @description The first served round’s Surface title, from the copy itself. */
        title: string | null;
        rounds: {
          /** Format: date-time */
          accepted_at: string;
          /** @description The archival verifier’s signature outcome for this round’s kept record with the service’s receipt keys: `not_checked` when the round was not preserved or its key is not trusted here. */
          signature: 'verified' | 'not_valid' | 'not_checked';
          /** @description Whether the round’s questions and answers in the copy match the receipt: `unavailable` when the copy does not hold them (they were purged before the Save), `not_checked` when the signature was not verified first. Never folded into the signature outcome. */
          contents: 'verified' | 'not_valid' | 'unavailable' | 'not_checked';
          /** @description The holder status as recorded at Save; `withheld` when its signed batch names a round an operator order now withholds. */
          holder: 'enrolled' | 'revoked' | 'not_enrolled' | 'withheld';
        }[];
      }[];
    };
    PersonalCopyRemoved: {
      /** @constant */
      status: 'removed';
    };
    ProtectedResourceMetadata: {
      /** @description The MCP resource (RFC 8707): the deployment’s MCP endpoint, the /mcp path on its MCP host. */
      resource: string;
      authorization_servers: string[];
      scopes_supported: 'sess:interact'[];
      bearer_methods_supported: 'header'[];
      resource_name: string;
    };
    AuthorizationServerMetadata: {
      issuer: string;
      authorization_endpoint: string;
      token_endpoint: string;
      registration_endpoint: string;
      revocation_endpoint: string;
      scopes_supported: 'sess:interact'[];
      response_types_supported: 'code'[];
      response_modes_supported: 'query'[];
      grant_types_supported: ('authorization_code' | 'refresh_token')[];
      token_endpoint_auth_methods_supported: 'none'[];
      revocation_endpoint_auth_methods_supported: 'none'[];
      code_challenge_methods_supported: 'S256'[];
      /** @constant */
      client_id_metadata_document_supported: true;
      /** @constant */
      authorization_response_iss_parameter_supported: true;
    };
    OAuthTokenResponse: {
      /** @description Bearer for the MCP resource only (audience-bound), 256 bits, about one hour. */
      access_token: string;
      /** @constant */
      token_type: 'Bearer';
      expires_in: number;
      /** @description Single use: every refresh returns a new one. Presenting a used one again revokes the whole token family. */
      refresh_token: string;
      /** @constant */
      scope: 'sess:interact';
    };
    OAuthErrorResponse: {
      error:
        | 'invalid_request'
        | 'invalid_client'
        | 'invalid_grant'
        | 'invalid_scope'
        | 'invalid_target'
        | 'unsupported_grant_type'
        | 'invalid_redirect_uri'
        | 'invalid_client_metadata'
        | 'temporarily_unavailable'
        | 'server_error';
    };
    /** @description A public client (no secret). Other RFC 7591 metadata is ignored; a client secret, `jwks` or another authentication method is refused. */
    ClientRegistrationRequest: {
      redirect_uris: string[];
      client_name?: string;
      /** @constant */
      token_endpoint_auth_method?: 'none';
      grant_types?: ('authorization_code' | 'refresh_token')[];
      response_types?: 'code'[];
    };
    ClientRegistrationResponse: {
      client_id: string;
      client_id_issued_at: number;
      client_name: string;
      redirect_uris: string[];
      /** @constant */
      token_endpoint_auth_method: 'none';
      grant_types: ('authorization_code' | 'refresh_token')[];
      response_types: 'code'[];
    };
    TargetRegisterRequest: {
      /**
       * @description The only supported target protocol type.
       * @constant
       */
      type: 'http';
      /** @description Absolute https:// URL on port 443 without user info or fragment; an IP literal must be public. Immutable: register a new target to change it. */
      endpoint: string;
      capability: {
        name: string;
        version: string;
        /** @description JSON Schema 2020-12 for the start input: an object schema using only type, properties, required, additionalProperties, items, enum, const, numeric and length bounds, title and description (no pattern, format, $ref or composition), at most 6 levels deep and 8192 bytes. */
        input_schema: {
          [key: string]: unknown;
        };
      };
      grant: {
        /** @description The exact browser origins a grant may be issued for. A start must come from its grant’s origin (the Origin header). */
        audiences: string[];
        /** @description How long an issued grant lives. */
        lifetime_seconds: number;
      };
      budget: {
        max_concurrent: number;
        max_starts_per_day: number;
      };
      /** @description Default true. */
      enabled?: boolean;
      /** @description Advanced. The Sess link lifetime, in seconds, the target’s agent is asked to give each Session it creates for a run: at least 30 and at most the workspace plan’s live-link lifetime (Free 604800, Starter and Pro 2592000; the deployment owner key 2592000); out of range → 400 INVALID_SCHEMA, whose message names both bounds. Advisory: Sess does not create the target’s Sessions. It is copied into each admitted run and sent in the dispatch message as limits.expires_in; an agent that sets its own expires_in, calls the API directly or uses an SDK that does not apply it is not governed by it, and the Session’s create checks the value against the creating key’s plan again. Not part of the versioned binding: changing it changes no version and leaves grants and admitted runs as they are. */
      default_expires_in?: number;
    };
    TargetUpdateRequest: {
      enabled?: boolean;
      capability?: {
        name: string;
        version: string;
        /** @description JSON Schema 2020-12 for the start input: an object schema using only type, properties, required, additionalProperties, items, enum, const, numeric and length bounds, title and description (no pattern, format, $ref or composition), at most 6 levels deep and 8192 bytes. */
        input_schema: {
          [key: string]: unknown;
        };
      };
      grant?: {
        /** @description The exact browser origins a grant may be issued for. A start must come from its grant’s origin (the Origin header). */
        audiences: string[];
        /** @description How long an issued grant lives. */
        lifetime_seconds: number;
      };
      budget?: {
        max_concurrent: number;
        max_starts_per_day: number;
      };
      default_expires_in?: number | null;
    };
    TargetSharingRequest: {
      name?: string | null;
      shared?: boolean;
      description?: string | null;
      attribution?: string | null;
      ask_again?: boolean;
    };
    TargetResponse: {
      id: string;
      /** @constant */
      type: 'http';
      endpoint: string;
      /** @description Incremented by every change of capability, grant policy or budget (not by sharing or default_expires_in). Grants are bound to one version; a start with an older grant → 409 TARGET_VERSION_CONFLICT, and admitted runs not yet dispatched fail as stale_binding. */
      version: number;
      capability: {
        name: string;
        version: string;
        /** @description JSON Schema 2020-12 for the start input: an object schema using only type, properties, required, additionalProperties, items, enum, const, numeric and length bounds, title and description (no pattern, format, $ref or composition), at most 6 levels deep and 8192 bytes. */
        input_schema: {
          [key: string]: unknown;
        };
      };
      grant: {
        /** @description The exact browser origins a grant may be issued for. A start must come from its grant’s origin (the Origin header). */
        audiences: string[];
        /** @description How long an issued grant lives. */
        lifetime_seconds: number;
      };
      budget: {
        max_concurrent: number;
        max_starts_per_day: number;
      };
      enabled: boolean;
      verification: {
        status: 'pending' | 'verified';
        /** @description Publish it at well_known_url (public by design). */
        token: string;
        well_known_url: string;
        verified_at: string | null;
        expires_at: string | null;
      };
      /** @description Owner-only counts; never public. */
      counts: {
        started: number;
        completed: number;
      };
      sharing: {
        name: string | null;
        /** @description Off by default. While false, /a/{name} answers 404 and its starts stop. */
        shared: boolean;
        description: string | null;
        attribution: string | null;
        /** @description Off by default. When on, the completion page of a run started from the card offers “Ask this agent again”: a new start (a new Invocation and a new Session) that carries nothing from the finished one. */
        ask_again: boolean;
      };
      /** @description The advisory link lifetime in seconds; null: none (the plan’s lifetime). */
      default_expires_in: number | null;
      created_at: string;
    };
    TargetListResponse: {
      targets: {
        id: string;
        /** @constant */
        type: 'http';
        endpoint: string;
        /** @description Incremented by every change of capability, grant policy or budget (not by sharing or default_expires_in). Grants are bound to one version; a start with an older grant → 409 TARGET_VERSION_CONFLICT, and admitted runs not yet dispatched fail as stale_binding. */
        version: number;
        capability: {
          name: string;
          version: string;
          /** @description JSON Schema 2020-12 for the start input: an object schema using only type, properties, required, additionalProperties, items, enum, const, numeric and length bounds, title and description (no pattern, format, $ref or composition), at most 6 levels deep and 8192 bytes. */
          input_schema: {
            [key: string]: unknown;
          };
        };
        grant: {
          /** @description The exact browser origins a grant may be issued for. A start must come from its grant’s origin (the Origin header). */
          audiences: string[];
          /** @description How long an issued grant lives. */
          lifetime_seconds: number;
        };
        budget: {
          max_concurrent: number;
          max_starts_per_day: number;
        };
        enabled: boolean;
        verification: {
          status: 'pending' | 'verified';
          /** @description Publish it at well_known_url (public by design). */
          token: string;
          well_known_url: string;
          verified_at: string | null;
          expires_at: string | null;
        };
        /** @description Owner-only counts; never public. */
        counts: {
          started: number;
          completed: number;
        };
        sharing: {
          name: string | null;
          /** @description Off by default. While false, /a/{name} answers 404 and its starts stop. */
          shared: boolean;
          description: string | null;
          attribution: string | null;
          /** @description Off by default. When on, the completion page of a run started from the card offers “Ask this agent again”: a new start (a new Invocation and a new Session) that carries nothing from the finished one. */
          ask_again: boolean;
        };
        /** @description The advisory link lifetime in seconds; null: none (the plan’s lifetime). */
        default_expires_in: number | null;
        created_at: string;
      }[];
    };
    TargetVerificationDocument: {
      target_id: string;
      token: string;
    } & {
      [key: string]: unknown;
    };
    GrantIssueRequest: {
      audience: string;
    };
    GrantIssueResponse: {
      grant: {
        id: string;
        target_id: string;
        target_version: number;
        capability: {
          name: string;
          version: string;
        };
        audience: string;
        expires_at: string;
        revoked_at: string | null;
      };
      /** @description Shown once; Sess stores only its hash. Present it as `Authorization: Bearer` on POST /v1/invocations from the grant’s audience origin. Never put it in a URL. */
      secret: string;
    };
    GrantRevokeResponse: {
      grant: {
        id: string;
        target_id: string;
        target_version: number;
        capability: {
          name: string;
          version: string;
        };
        audience: string;
        expires_at: string;
        revoked_at: string | null;
      };
    };
    InvocationStartRequest: {
      /** @description One logical start. The same request_id and body with the same grant returns the same admitted run; a different body → 409 IDEMPOTENCY_CONFLICT. */
      request_id: string;
      input: {
        [key: string]: unknown;
      };
    };
    InvocationStartResponse: {
      invocation: {
        id: string;
        /** @description admitted → dispatching → dispatched → completed | failed; unknown when the dispatch outcome at the target cannot be known (never success, never repeated blindly); cancelled and expired. completed, failed, cancelled and expired are terminal. */
        status:
          | 'admitted'
          | 'dispatching'
          | 'dispatched'
          | 'unknown'
          | 'completed'
          | 'failed'
          | 'cancelled'
          | 'expired';
        reason: string | null;
        request_id: string;
        target_version: number;
        capability: {
          name: string;
          version: string;
        };
        created_at: string;
        expires_at: string;
        finished_at: string | null;
        result: {
          [key: string]: unknown;
        } | null;
      };
      /** @description Status, result and cancel access to this Invocation only (Authorization: Bearer). The same on every replay of the start. */
      participant_credential: string;
    };
    InvocationResponse: {
      id: string;
      /** @description admitted → dispatching → dispatched → completed | failed; unknown when the dispatch outcome at the target cannot be known (never success, never repeated blindly); cancelled and expired. completed, failed, cancelled and expired are terminal. */
      status:
        | 'admitted'
        | 'dispatching'
        | 'dispatched'
        | 'unknown'
        | 'completed'
        | 'failed'
        | 'cancelled'
        | 'expired';
      reason: string | null;
      request_id: string;
      target_version: number;
      capability: {
        name: string;
        version: string;
      };
      created_at: string;
      expires_at: string;
      finished_at: string | null;
      result: {
        [key: string]: unknown;
      } | null;
    };
    InvocationResultRequest: {
      invocation_id: string;
      target_version: number;
      status: 'completed' | 'failed';
      result?: {
        [key: string]: unknown;
      };
    };
    TargetDispatch: {
      /** @constant */
      type: 'sess.invocation';
      invocation_id: string;
      request_id: string;
      target_id: string;
      target_version: number;
      capability: {
        name: string;
        version: string;
      };
      input: {
        [key: string]: unknown;
      };
      limits: {
        accepted_rounds: number;
        /** @description Decision 0009 Amendment 7: the target’s default_expires_in when this run was admitted (absent when it had none). Advisory: the agent passes it as expires_in on POST /v1/sessions for the Sessions of this run unless it sets its own; that create checks it against the agent key’s plan. */
        expires_in?: number;
      };
      expires_at: string;
      callback: {
        url: string;
        /** @description Present as Authorization: Bearer on the callback URL; one dispatch only. */
        credential: string;
      };
    };
    TargetDispatchAnswer: {
      invocation_id: string;
      target_version: number;
      status: 'accepted' | 'completed' | 'failed';
      result?: {
        [key: string]: unknown;
      };
    };
    AccountUsageResponse: {
      plan: {
        id: 'free' | 'starter' | 'pro';
        name: string;
        /** @description US dollars per month in cents, excluding applicable taxes. */
        price_usd_cents: number;
        /** @description Resolved Sessions per period: the plan total. No overage is charged. */
        resolved_per_period: number;
        active_sessions: number;
        /** @description The human-link lifetime a new Session gets (captured at admission). */
        live_hours: number;
        /** @description How long a new Session’s payloads and results are kept after it ends (captured at admission). Receipts are kept without automatic expiry on every plan. */
        retention_hours_after_end: number;
      };
      period: {
        /** @description Resolutions from this instant count against the allowance (the period start, or earlier when a plan change carried usage over). */
        usage_from: string;
        /** @description The next reset: monthly from the workspace’s billing anchor (UTC). */
        resets_at: string;
      };
      usage: {
        /** @description Resolved Sessions in this period. */
        resolved: number;
        allowance: number;
        /** @description Admitted interactive Sessions that can still qualify; each holds one unit of the allowance until it qualifies, its link ends before completion, or its delivery deadline passes without its result reaching the owner. */
        reserved: number;
        /** @description New Sessions the allowance still admits: allowance − resolved − reserved. */
        available: number;
        active: number;
        active_limit: number;
      };
      /** @description allowance_80 at 80% of the allowance used, allowance_100 at 100%. */
      warnings: ('allowance_80' | 'allowance_100')[];
      /** @description Why a new Session would be refused now (429 PLAN_LIMIT_REACHED with this reason); null when it would be admitted. */
      paused: 'monthly_allowance' | 'active_sessions' | null;
    };
    BillingCheckoutRequest: {
      /** @description The paid plan to upgrade to. */
      plan: 'starter' | 'pro';
    };
    BillingCheckoutResponse: {
      plan: 'starter' | 'pro';
      /** @description The payment provider’s hosted Checkout page. Open it in a browser; returning from it grants nothing by itself: the plan changes when the provider’s verified subscription state says it is paid. */
      checkout_url: string;
      /** @description When the Checkout page stops accepting payment. */
      expires_at: string;
    };
    BillingEventAck: {
      /** @constant */
      received: true;
    };
    EvidenceRecordSummary: {
      event_id: string;
      session_id: string;
      /** @description archival (default): records held with a signed archival core, in workspace sequence. exception: receipts held unverified (exception custody), by acceptance time; they never match a target filter or a sequence range. */
      custody: 'archival' | 'exception';
      /** @description The committed workspace custody sequence (archival); null for exception. */
      sequence: number | null;
      /** @description The receipt’s asserted acceptance time. */
      accepted_at: string;
      /** @description When custody began: at acceptance, by the later backfill, or the exception. */
      preserved_at: string;
      origin: 'acceptance' | 'backfill' | null;
      /** @description pending: not yet witnessed by an external timestamp. none: exception custody is never witnessed. */
      witness: 'pending' | 'none';
      /** @description The target the archival core binds, or null (no target binding). */
      target_id: string | null;
      /** @description null for archival custody. For exception custody: the receipt is kept exactly as issued but is unverified; it is not evidence that the decision happened as stated. */
      exception: null | {
        /** @constant */
        status: 'unverified';
        reason: 'signature_invalid' | 'event_mismatch' | 'malformed' | 'custody_deferral_expired';
      };
      /** @description True while the original Surface and accepted input are still kept (the Session’s retention has not ended). The receipt itself is kept either way. */
      content_retained: boolean;
    };
    EvidenceListResponse: {
      scope: {
        /** @constant */
        label: 'issued records in this defined scope/range';
        /**
         * @description Always false: no anchored high-water/count evidence and reconciliation exist yet, so a list or export is never a complete history.
         * @constant
         */
        complete_history: false;
        /** @description archival (default): records held with a signed archival core, in workspace sequence. exception: receipts held unverified (exception custody), by acceptance time; they never match a target filter or a sequence range. */
        custody: 'archival' | 'exception';
        filters: {
          target_id?: string;
          accepted_from?: string;
          accepted_to?: string;
          from_sequence?: number;
          to_sequence?: number;
        };
      };
      records: {
        event_id: string;
        session_id: string;
        /** @description archival (default): records held with a signed archival core, in workspace sequence. exception: receipts held unverified (exception custody), by acceptance time; they never match a target filter or a sequence range. */
        custody: 'archival' | 'exception';
        /** @description The committed workspace custody sequence (archival); null for exception. */
        sequence: number | null;
        /** @description The receipt’s asserted acceptance time. */
        accepted_at: string;
        /** @description When custody began: at acceptance, by the later backfill, or the exception. */
        preserved_at: string;
        origin: 'acceptance' | 'backfill' | null;
        /** @description pending: not yet witnessed by an external timestamp. none: exception custody is never witnessed. */
        witness: 'pending' | 'none';
        /** @description The target the archival core binds, or null (no target binding). */
        target_id: string | null;
        /** @description null for archival custody. For exception custody: the receipt is kept exactly as issued but is unverified; it is not evidence that the decision happened as stated. */
        exception: null | {
          /** @constant */
          status: 'unverified';
          reason: 'signature_invalid' | 'event_mismatch' | 'malformed' | 'custody_deferral_expired';
        };
        /** @description True while the original Surface and accepted input are still kept (the Session’s retention has not ended). The receipt itself is kept either way. */
        content_retained: boolean;
      }[];
      next_cursor: string | null;
    };
    /** @description An explicit range is required: both from_sequence and to_sequence (archival only), or both accepted_from and accepted_to. A range beyond the record or size bound is truncated; range.next_cursor continues it. */
    EvidenceExportRequest: {
      /** @description archival (default): records held with a signed archival core, in workspace sequence. exception: receipts held unverified (exception custody), by acceptance time; they never match a target filter or a sequence range. */
      custody?: 'archival' | 'exception';
      from_sequence?: number;
      to_sequence?: number;
      /** @description Accepted at or after (inclusive). UTC, at most millisecond precision (finer is refused). */
      accepted_from?: string;
      /** @description Accepted before (exclusive). UTC, at most millisecond precision (finer is refused). */
      accepted_to?: string;
      target_id?: string;
      /** @description At most this many records (default 100). */
      limit?: number;
      /** @description Opaque. Pass the next_cursor of the previous answer, with the same filters. */
      cursor?: string;
    };
    EvidenceExport: {
      /** @constant */
      type: 'sess.evidence-export';
      /** @constant */
      version: 1;
      /** @constant */
      disclosure: 'This file contains signed decision receipts and, where still kept, the questions people saw and the answers they gave. Anyone you share it with can read all of it. Sess cannot recall a copy once it leaves your account.';
      exported_at: string;
      workspace_id: string;
      scope: {
        /** @constant */
        label: 'issued records in this defined scope/range';
        /**
         * @description Always false: no anchored high-water/count evidence and reconciliation exist yet, so a list or export is never a complete history.
         * @constant
         */
        complete_history: false;
        /** @description archival (default): records held with a signed archival core, in workspace sequence. exception: receipts held unverified (exception custody), by acceptance time; they never match a target filter or a sequence range. */
        custody: 'archival' | 'exception';
        filters: {
          target_id?: string;
          accepted_from?: string;
          accepted_to?: string;
          from_sequence?: number;
          to_sequence?: number;
        };
      };
      range: {
        count: number;
        first_sequence: number | null;
        last_sequence: number | null;
        /** @description True when more records match: continue with next_cursor. */
        truncated: boolean;
        next_cursor: string | null;
      };
      records: {
        event_id: string;
        session_id: string;
        /** @description archival (default): records held with a signed archival core, in workspace sequence. exception: receipts held unverified (exception custody), by acceptance time; they never match a target filter or a sequence range. */
        custody: 'archival' | 'exception';
        /** @description The committed workspace custody sequence (archival); null for exception. */
        sequence: number | null;
        /** @description The receipt’s asserted acceptance time. */
        accepted_at: string;
        /** @description When custody began: at acceptance, by the later backfill, or the exception. */
        preserved_at: string;
        origin: 'acceptance' | 'backfill' | null;
        /** @description pending: not yet witnessed by an external timestamp. none: exception custody is never witnessed. */
        witness: 'pending' | 'none';
        /** @description The target the archival core binds, or null (no target binding). */
        target_id: string | null;
        /** @description null for archival custody. For exception custody: the receipt is kept exactly as issued but is unverified; it is not evidence that the decision happened as stated. */
        exception: null | {
          /** @constant */
          status: 'unverified';
          reason: 'signature_invalid' | 'event_mismatch' | 'malformed' | 'custody_deferral_expired';
        };
        /** @description The exact original receipt-v1 compact JWS. */
        receipt: string;
        receipt_digest: string;
        /** @description The archival envelope (sess.archival-envelope v1: the exact receipt, its signed archival core and detachable preservation evidence) for the successor verifier; null for exception custody. */
        archival: {
          [key: string]: unknown;
        } | null;
        /** @description Included only while retained, and only for the authenticated workspace. */
        content:
          | {
              /** @constant */
              status: 'retained';
              surface_revision: number;
              /** @description The exact interaction of that revision (what the receipt hashes). */
              surface: {
                [key: string]: unknown;
              };
              /** @description The accepted input (what the receipt hashes). */
              input: unknown;
            }
          | {
              /** @constant */
              status: 'unavailable';
              /** @constant */
              reason: 'purged';
            };
      }[];
    };
    /** @description The status of one custody record of the owner workspace, never its content. A deletion does not recall copies already exported or kept by people, and public witness commitments (aggregate batch roots) remain. */
    EvidenceRecordStatus: {
      event_id: string;
      /** @description available: listed and exported as usual. restricted: kept and still verifiable for preservation integrity, but excluded from every list, export and receipt-scoped fetch until it is unrestricted. deleted: the receipt, its signed archival core and its preservation evidence are removed; only a minimal tombstone remains. */
      status: 'available' | 'restricted' | 'deleted';
      /** @description archival (default): records held with a signed archival core, in workspace sequence. exception: receipts held unverified (exception custody), by acceptance time; they never match a target filter or a sequence range. */
      custody: 'archival' | 'exception';
      restriction: null | {
        reason:
          'data_subject_request' | 'accuracy_dispute' | 'legal_request' | 'security_review' | 'owner_request';
        /** @description When the current restriction began (UTC). */
        since: string;
      };
      deletion: null | {
        reason: 'data_subject_erasure' | 'owner_request' | 'legal_order' | 'issued_in_error';
        /** @description When the record was deleted (UTC). */
        deleted_at: string;
      };
    };
  };
  responses: never;
  parameters: never;
  requestBodies: never;
  headers: never;
  pathItems: never;
}
export type $defs = Record<string, never>;
export interface operations {
  protectedResourceMetadata: {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      /** @description The metadata. */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['ProtectedResourceMetadata'];
        };
      };
    };
  };
  protectedResourceMetadataForPath: {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      /** @description The metadata. */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['ProtectedResourceMetadata'];
        };
      };
    };
  };
  authorizationServerMetadata: {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      /** @description The metadata. */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['AuthorizationServerMetadata'];
        };
      };
    };
  };
  authorizeAgentHost: {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      /** @description The consent page, or the sign-in-to-continue page. */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'text/html': unknown;
        };
      };
      /** @description A request error, redirected to the agent host (error, state, iss). */
      303: {
        headers: {
          [name: string]: unknown;
        };
        content?: never;
      };
      /** @description INVALID_REQUEST, INVALID_CLIENT or INVALID_REDIRECT_URI. */
      400: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'text/html': unknown;
        };
      };
    };
  };
  decideAgentHost: {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      /** @description To the agent host: code (or error=access_denied), state, iss. */
      303: {
        headers: {
          [name: string]: unknown;
        };
        content?: never;
      };
      /** @description AUTHORIZATION_REQUEST_INVALID (expired, used or another session’s). */
      400: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'text/html': unknown;
        };
      };
      /** @description The sign-in is not recent: sign in again. */
      401: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'text/html': unknown;
        };
      };
      /** @description ACTION_NOT_ALLOWED: cross-origin or a wrong CSRF token. */
      403: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'text/html': unknown;
        };
      };
    };
  };
  agentHostsPage: {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      /** @description The agent hosts page. */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'text/html': unknown;
        };
      };
      /** @description To sign-in. */
      303: {
        headers: {
          [name: string]: unknown;
        };
        content?: never;
      };
    };
  };
  removeAgentHost: {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      /** @description To /app/hosts?removed=1. */
      303: {
        headers: {
          [name: string]: unknown;
        };
        content?: never;
      };
      /** @description ACTION_NOT_ALLOWED. */
      403: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'text/html': unknown;
        };
      };
      /** @description NOT_FOUND: not an authorized agent host of this account. */
      404: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'text/html': unknown;
        };
      };
    };
  };
  oauthToken: {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    /** @description Form fields: grant_type, client_id and the grant’s fields. Each at most once. */
    requestBody: {
      content: {
        'application/x-www-form-urlencoded': Record<string, never>;
      };
    };
    responses: {
      /** @description Tokens. */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['OAuthTokenResponse'];
        };
      };
      /** @description invalid_request, invalid_client, invalid_grant, invalid_scope, invalid_target or unsupported_grant_type. */
      400: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['OAuthErrorResponse'];
        };
      };
      /** @description invalid_client: HTTP client authentication was attempted. */
      401: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['OAuthErrorResponse'];
        };
      };
    };
  };
  oauthRegister: {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    requestBody: {
      content: {
        'application/json': components['schemas']['ClientRegistrationRequest'];
      };
    };
    responses: {
      /** @description Registered. */
      201: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['ClientRegistrationResponse'];
        };
      };
      /** @description invalid_redirect_uri or invalid_client_metadata. */
      400: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['OAuthErrorResponse'];
        };
      };
      /** @description temporarily_unavailable (with Retry-After). */
      429: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['OAuthErrorResponse'];
        };
      };
    };
  };
  oauthRevoke: {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    /** @description Form fields: token, client_id. Each at most once. */
    requestBody: {
      content: {
        'application/x-www-form-urlencoded': Record<string, never>;
      };
    };
    responses: {
      /** @description Revoked, or nothing to revoke. */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content?: never;
      };
      /** @description invalid_request or invalid_client. */
      400: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['OAuthErrorResponse'];
        };
      };
    };
  };
  requestPersonalSignIn: {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    requestBody: {
      content: {
        'application/json': components['schemas']['PersonalSignInRequest'];
      };
    };
    responses: {
      /** @description Handed to the email provider; the challenge cookie is set. */
      202: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['PersonalSignInAccepted'];
        };
      };
      /** @description INVALID_SCHEMA: not a plausible email address */
      400: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['Error'];
        };
      };
      /** @description ACTION_NOT_ALLOWED: not a same-origin request (or, with a session, no CSRF token). */
      403: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['Error'];
        };
      };
      /** @description INVALID_SCHEMA: not application/json. */
      415: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['Error'];
        };
      };
      /** @description RATE_LIMITED: a send budget or cooldown is reached */
      429: {
        headers: {
          'Retry-After'?: number;
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['Error'];
        };
      };
      /** @description SIGN_IN_UNAVAILABLE (personal sign-in is not configured) or SERVICE_UNAVAILABLE (the provider did not confirm the send: an email may or may not arrive; earlier links stay valid and the attempt counts) */
      503: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['Error'];
        };
      };
    };
  };
  redeemPersonalSignInCode: {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    requestBody: {
      content: {
        'application/json': components['schemas']['PersonalCodeRequest'];
      };
    };
    responses: {
      /** @description Signed in: the host-only __Host-sess_personal cookie (HttpOnly, Secure, SameSite=Strict, Path=/, the session lifetime, absolute) is set and the challenge cookie cleared. Only a personal session: no workspace, developer, API key or billing record is created or changed, and the cookie authenticates no developer route. */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['PersonalSignedInResponse'];
        };
      };
      /** @description INVALID_SCHEMA */
      400: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['Error'];
        };
      };
      /** @description UNAUTHORIZED: every refusal alike (unknown, used, superseded, expired, a developer challenge, a wrong or locked code, a full failure bucket, no challenge cookie). */
      401: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['Error'];
        };
      };
      /** @description ACTION_NOT_ALLOWED: not a same-origin request (or, with a session, no CSRF token). */
      403: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['Error'];
        };
      };
      /** @description INVALID_SCHEMA: not application/json. */
      415: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['Error'];
        };
      };
    };
  };
  redeemPersonalSignInLink: {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    requestBody: {
      content: {
        'application/json': components['schemas']['PersonalLinkRequest'];
      };
    };
    responses: {
      /** @description Signed in: the host-only __Host-sess_personal cookie (HttpOnly, Secure, SameSite=Strict, Path=/, the session lifetime, absolute) is set and the challenge cookie cleared. Only a personal session: no workspace, developer, API key or billing record is created or changed, and the cookie authenticates no developer route. */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['PersonalSignedInResponse'];
        };
      };
      /** @description INVALID_SCHEMA */
      400: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['Error'];
        };
      };
      /** @description UNAUTHORIZED: every refusal alike (unknown, used, superseded, expired, a developer challenge, a wrong or locked code, a full failure bucket, no challenge cookie). */
      401: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['Error'];
        };
      };
      /** @description ACTION_NOT_ALLOWED: not a same-origin request (or, with a session, no CSRF token). */
      403: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['Error'];
        };
      };
      /** @description INVALID_SCHEMA: not application/json. */
      415: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['Error'];
        };
      };
    };
  };
  getPersonalSession: {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      /** @description Signed in. */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['PersonalSessionResponse'];
        };
      };
      /** @description UNAUTHORIZED: no live personal session. */
      401: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['Error'];
        };
      };
    };
  };
  personalSignOut: {
    parameters: {
      query?: never;
      header: {
        'x-sess-csrf': string;
      };
      path?: never;
      cookie?: never;
    };
    requestBody: {
      content: {
        'application/json': components['schemas']['PersonalEmptyRequest'];
      };
    };
    responses: {
      /** @description Signed out. */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['PersonalDone'];
        };
      };
      /** @description INVALID_SCHEMA */
      400: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['Error'];
        };
      };
      /** @description UNAUTHORIZED: no live personal session (a developer session never counts). */
      401: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['Error'];
        };
      };
      /** @description ACTION_NOT_ALLOWED: not a same-origin request (or, with a session, no CSRF token). */
      403: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['Error'];
        };
      };
      /** @description INVALID_SCHEMA: not application/json. */
      415: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['Error'];
        };
      };
    };
  };
  closePersonalAccount: {
    parameters: {
      query?: never;
      header: {
        'x-sess-csrf': string;
      };
      path?: never;
      cookie?: never;
    };
    requestBody: {
      content: {
        'application/json': components['schemas']['PersonalEmptyRequest'];
      };
    };
    responses: {
      /** @description Closed. */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['PersonalDone'];
        };
      };
      /** @description INVALID_SCHEMA */
      400: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['Error'];
        };
      };
      /** @description UNAUTHORIZED: no live personal session (a developer session never counts). */
      401: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['Error'];
        };
      };
      /** @description ACTION_NOT_ALLOWED: not a same-origin request (or, with a session, no CSRF token). */
      403: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['Error'];
        };
      };
      /** @description ACTION_NOT_ALLOWED (reason removal_delayed): a justified hold whose scope reaches personal copies names a round of a saved copy; nothing was changed. The hold is never named. */
      409: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['Error'];
        };
      };
      /** @description INVALID_SCHEMA: not application/json. */
      415: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['Error'];
        };
      };
      /** @description SERVICE_UNAVAILABLE: the restore suppression has not yet run after start. */
      503: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['Error'];
        };
      };
    };
  };
  bindSaveDestination: {
    parameters: {
      query?: never;
      header: {
        'x-sess-csrf': string;
      };
      path?: never;
      cookie?: never;
    };
    requestBody: {
      content: {
        'application/json': components['schemas']['SaveDestinationRequest'];
      };
    };
    responses: {
      /** @description The binding. */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['SaveDestinationResponse'];
        };
      };
      /** @description INVALID_SCHEMA */
      400: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['Error'];
        };
      };
      /** @description UNAUTHORIZED: no live personal session. */
      401: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['Error'];
        };
      };
      /** @description ACTION_NOT_ALLOWED: not a same-origin request (or, with a session, no CSRF token). */
      403: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['Error'];
        };
      };
      /** @description INVALID_SCHEMA: not application/json. */
      415: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['Error'];
        };
      };
      /** @description RATE_LIMITED (per personal session; Retry-After) */
      429: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['Error'];
        };
      };
      /** @description SERVICE_UNAVAILABLE: the restriction/deletion suppression is not yet re-applied after start. */
      503: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['Error'];
        };
      };
    };
  };
  redeemSaveClaim: {
    parameters: {
      query?: never;
      header: {
        'x-sess-csrf': string;
      };
      path?: never;
      cookie?: never;
    };
    requestBody: {
      content: {
        'application/json': components['schemas']['SaveRedeemRequest'];
      };
    };
    responses: {
      /** @description Saved: the kept-conversation file as Keep produces it at this moment is stored under the personal grant (the same rounds saved again write nothing and answer the same saved_at). */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['SavedResponse'];
        };
      };
      /** @description INVALID_SCHEMA */
      400: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['Error'];
        };
      };
      /** @description UNAUTHORIZED: no live personal session. */
      401: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['Error'];
        };
      };
      /** @description ACTION_NOT_ALLOWED: not a same-origin request (or, with a session, no CSRF token). */
      403: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['Error'];
        };
      };
      /** @description NOT_FOUND: no claim matches (one answer for an unknown secret, another purpose or destination, a wrong verifier or nonce, or another session); with reason claim_expired or claim_aborted for a matching claim that can no longer be redeemed. */
      404: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['Error'];
        };
      };
      /** @description IDEMPOTENCY_CONFLICT: the claim was redeemed by a different request or into another account. */
      409: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['Error'];
        };
      };
      /** @description INVALID_SCHEMA: not application/json. */
      415: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['Error'];
        };
      };
      /** @description RATE_LIMITED (per personal session; Retry-After) */
      429: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['Error'];
        };
      };
      /** @description SERVICE_UNAVAILABLE: the restriction/deletion suppression is not yet re-applied after start. */
      503: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['Error'];
        };
      };
    };
  };
  saveDirect: {
    parameters: {
      query?: never;
      header: {
        'x-sess-csrf': string;
      };
      path?: never;
      cookie?: never;
    };
    requestBody: {
      content: {
        'application/json': components['schemas']['SaveDirectRequest'];
      };
    };
    responses: {
      /** @description Saved: the kept-conversation file as Keep produces it at this moment is stored under the personal grant (the same rounds saved again write nothing and answer the same saved_at). */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['SavedResponse'];
        };
      };
      /** @description INVALID_SCHEMA */
      400: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['Error'];
        };
      };
      /** @description UNAUTHORIZED: no live personal session. */
      401: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['Error'];
        };
      };
      /** @description ACTION_NOT_ALLOWED: not a same-origin request (or, with a session, no CSRF token). */
      403: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['Error'];
        };
      };
      /** @description NOT_FOUND: not on the personal origin, or the link is not live; with reason no_authorized_rounds when no presented grant authorizes a round. */
      404: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['Error'];
        };
      };
      /** @description PAYLOAD_TOO_LARGE */
      413: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['Error'];
        };
      };
      /** @description INVALID_SCHEMA: not application/json. */
      415: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['Error'];
        };
      };
      /** @description RATE_LIMITED (per personal session; Retry-After) */
      429: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['Error'];
        };
      };
      /** @description SERVICE_UNAVAILABLE: the restriction/deletion suppression is not yet re-applied after start. */
      503: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['Error'];
        };
      };
    };
  };
  listPersonalCopies: {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      /** @description The saved copies. */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['PersonalCopiesResponse'];
        };
      };
      /** @description UNAUTHORIZED: no live personal session (a developer session, owner key or Sess link never counts). */
      401: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['Error'];
        };
      };
      /** @description RATE_LIMITED (per personal session; Retry-After) */
      429: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['Error'];
        };
      };
      /** @description SERVICE_UNAVAILABLE: the restore suppression has not yet run after start. */
      503: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['Error'];
        };
      };
    };
  };
  downloadPersonalCopy: {
    parameters: {
      query?: never;
      header: {
        'x-sess-csrf': string;
      };
      path?: never;
      cookie?: never;
    };
    requestBody: {
      content: {
        'application/json': components['schemas']['PersonalCopyRequest'];
      };
    };
    responses: {
      /** @description The file (Content-Disposition: attachment). */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': unknown;
        };
      };
      /** @description INVALID_SCHEMA */
      400: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['Error'];
        };
      };
      /** @description UNAUTHORIZED: no live personal session (a developer session, owner key or Sess link never counts). */
      401: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['Error'];
        };
      };
      /** @description ACTION_NOT_ALLOWED: not a same-origin request (or, with a session, no CSRF token). */
      403: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['Error'];
        };
      };
      /** @description NOT_FOUND: no such saved copy in this account (another account’s copy answers the same). */
      404: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['Error'];
        };
      };
      /** @description ACTION_NOT_ALLOWED (reason copy_unavailable): nothing of this copy can be served now. */
      409: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['Error'];
        };
      };
      /** @description INVALID_SCHEMA: not application/json. */
      415: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['Error'];
        };
      };
      /** @description RATE_LIMITED (per personal session; Retry-After) */
      429: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['Error'];
        };
      };
      /** @description SERVICE_UNAVAILABLE: the restore suppression has not yet run after start. */
      503: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['Error'];
        };
      };
    };
  };
  removePersonalCopy: {
    parameters: {
      query?: never;
      header: {
        'x-sess-csrf': string;
      };
      path?: never;
      cookie?: never;
    };
    requestBody: {
      content: {
        'application/json': components['schemas']['PersonalCopyRequest'];
      };
    };
    responses: {
      /** @description Removed. */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['PersonalCopyRemoved'];
        };
      };
      /** @description INVALID_SCHEMA */
      400: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['Error'];
        };
      };
      /** @description UNAUTHORIZED: no live personal session (a developer session, owner key or Sess link never counts). */
      401: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['Error'];
        };
      };
      /** @description ACTION_NOT_ALLOWED: not a same-origin request (or, with a session, no CSRF token). */
      403: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['Error'];
        };
      };
      /** @description NOT_FOUND: no such saved copy in this account (another account’s copy answers the same). */
      404: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['Error'];
        };
      };
      /** @description ACTION_NOT_ALLOWED (reason removal_delayed): a justified hold whose scope reaches personal copies names one of its rounds; nothing was changed. The hold is never named. */
      409: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['Error'];
        };
      };
      /** @description INVALID_SCHEMA: not application/json. */
      415: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['Error'];
        };
      };
      /** @description RATE_LIMITED (per personal session; Retry-After) */
      429: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['Error'];
        };
      };
      /** @description SERVICE_UNAVAILABLE: the restore suppression has not yet run after start. */
      503: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['Error'];
        };
      };
    };
  };
  requestSignInLink: {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    requestBody: {
      content: {
        'application/json': components['schemas']['EmailLinkRequest'];
      };
    };
    responses: {
      /** @description Handed to the email provider. */
      202: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['EmailLinkAccepted'];
        };
      };
      /** @description INVALID_SCHEMA: not a plausible email address */
      400: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['Error'];
        };
      };
      /** @description RATE_LIMITED: too many links for this address or client */
      429: {
        headers: {
          'Retry-After'?: number;
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['Error'];
        };
      };
      /** @description SIGN_IN_UNAVAILABLE (email is not configured on this deployment) or SERVICE_UNAVAILABLE (the email provider did not confirm the send: the outcome is unknown, so an email may or may not arrive; earlier links stay valid, and the attempt counts toward the limits) */
      503: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['Error'];
        };
      };
    };
  };
  signInPage: {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      /** @description The sign-in page (no live account session, or a pending key creation waiting for verification). */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'text/html': unknown;
        };
      };
      /** @description A live account session: to /app/keys. */
      303: {
        headers: {
          [name: string]: unknown;
        };
        content?: never;
      };
    };
  };
  signInConfirmPage: {
    parameters: {
      query?: never;
      header?: never;
      path: {
        token: string;
      };
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      /** @description The confirm page. */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'text/html': unknown;
        };
      };
    };
  };
  signInConfirm: {
    parameters: {
      query?: never;
      header?: never;
      path: {
        token: string;
      };
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      /** @description Signed in; the pending key was not created because the expiry date its form showed is no longer the date a key created now would get (a new UTC day began): the keys page with a fresh form. */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'text/html': unknown;
        };
      };
      /** @description Signed in and the pending key created: the keys page with it, shown once. */
      201: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'text/html': unknown;
        };
      };
      /** @description Signed in: to /app/keys (/app/keys?resume=elsewhere when the link was for a key creation started in another browser), with Set-Cookie. */
      303: {
        headers: {
          [name: string]: unknown;
        };
        content?: never;
      };
      /** @description SIGN_IN_LINK_INVALID: expired, used or replaced by a newer link. */
      400: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'text/html': unknown;
        };
      };
      /** @description ACTION_NOT_ALLOWED: not a same-origin request. */
      403: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'text/html': unknown;
        };
      };
      /** @description Signed in; the pending key was not created: KEY_LIMIT_REACHED (the account has 10 active keys). */
      409: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'text/html': unknown;
        };
      };
    };
  };
  signInWithCode: {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      /** @description Signed in and the pending key created: the keys page with it, shown once. */
      201: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'text/html': unknown;
        };
      };
      /** @description Signed in: to /app/keys (/app/keys?resume=elsewhere for a key creation started in another browser or account), with Set-Cookie. */
      303: {
        headers: {
          [name: string]: unknown;
        };
        content?: never;
      };
      /** @description SIGN_IN_CODE_INVALID: the same answer for a wrong, expired, used, replaced or locked code, an unknown or missing browser challenge, a full guess limit or a malformed entry. */
      400: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'text/html': unknown;
        };
      };
      /** @description ACTION_NOT_ALLOWED: not a same-origin form post, or a wrong CSRF token. */
      403: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'text/html': unknown;
        };
      };
    };
  };
  signOutDevice: {
    parameters: {
      query?: never;
      header?: never;
      path: {
        id: string;
      };
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      /** @description Signed out: to /app/keys?device_revoked=1, or to /app/sign-in for this device. */
      303: {
        headers: {
          [name: string]: unknown;
        };
        content?: never;
      };
      /** @description ACTION_NOT_ALLOWED: cross-origin or a wrong CSRF token. */
      403: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'text/html': unknown;
        };
      };
      /** @description NOT_FOUND: not a signed-in device of this account. */
      404: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'text/html': unknown;
        };
      };
    };
  };
  gitHubSignInStart: {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    requestBody?: {
      content: {
        'application/x-www-form-urlencoded': {
          /** @enum {string} */
          return?: '/keys' | '/evidence';
        };
      };
    };
    responses: {
      /** @description To GitHub’s authorization page, with Set-Cookie (the binding). */
      303: {
        headers: {
          [name: string]: unknown;
        };
        content?: never;
      };
      /** @description ACTION_NOT_ALLOWED: not a same-origin form post. */
      403: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'text/html': unknown;
        };
      };
      /** @description RATE_LIMITED: too many GitHub sign-ins started from this client or in total. */
      429: {
        headers: {
          'Retry-After'?: number;
          [name: string]: unknown;
        };
        content: {
          'text/html': unknown;
        };
      };
      /** @description SIGN_IN_UNAVAILABLE: GitHub sign-in is not configured on this deployment. */
      503: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'text/html': unknown;
        };
      };
    };
  };
  gitHubSignInReturn: {
    parameters: {
      query?: {
        code?: string;
        state?: string;
        error?: string;
      };
      header?: never;
      path?: never;
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      /** @description The Continue page. */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'text/html': unknown;
        };
      };
      /** @description GITHUB_SIGN_IN_CANCELLED (the person cancelled on GitHub) or GITHUB_SIGN_IN_FAILED (GitHub’s error, or a malformed code or state). */
      400: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'text/html': unknown;
        };
      };
      /** @description SIGN_IN_UNAVAILABLE: GitHub sign-in is not configured. */
      503: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'text/html': unknown;
        };
      };
    };
  };
  gitHubSignInFinish: {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    requestBody: {
      content: {
        'application/x-www-form-urlencoded': {
          code: string;
          state: string;
        };
      };
    };
    responses: {
      /** @description GITHUB_EMAIL_UNVERIFIED: GitHub shared no verified, usable primary address; the sign-in page with the email form. Nothing was created. */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'text/html': unknown;
        };
      };
      /** @description Signed in and the pending key created: the keys page with it, shown once. */
      201: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'text/html': unknown;
        };
      };
      /** @description Signed in: to the allowlisted return (/app/keys or /app/evidence; /app/keys?resume=elsewhere for a key creation of another account), with Set-Cookie. Linked: to /app/keys?github=linked. */
      303: {
        headers: {
          [name: string]: unknown;
        };
        content?: never;
      };
      /** @description GITHUB_SIGN_IN_FAILED: the same answer for an unknown, used, expired or altered state, a missing or other browser binding, and a code GitHub refused. */
      400: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'text/html': unknown;
        };
      };
      /** @description ACTION_NOT_ALLOWED (not a same-origin form post), or for a link RECENT_SIGN_IN_REQUIRED / GITHUB_SIGN_IN_FAILED (the session is not the one that started it, or its sign-in is more than 12 hours old). */
      403: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'text/html': unknown;
        };
      };
      /** @description GITHUB_NOT_LINKED (a sign-in whose address an existing account has), GITHUB_ALREADY_LINKED (a link of a GitHub account another account has) or GITHUB_LINK_EXISTS (this account already has another GitHub account). */
      409: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'text/html': unknown;
        };
      };
      /** @description SERVICE_UNAVAILABLE: GitHub did not answer usefully (5xx, timeout, connection, an unreadable answer); nothing was changed. SIGN_IN_UNAVAILABLE: not configured. */
      503: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'text/html': unknown;
        };
      };
    };
  };
  gitHubLinkStart: {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    requestBody: {
      content: {
        'application/x-www-form-urlencoded': {
          csrf: string;
        };
      };
    };
    responses: {
      /** @description To GitHub’s authorization page, with Set-Cookie (the binding). No live account session: to /app/sign-in. */
      303: {
        headers: {
          [name: string]: unknown;
        };
        content?: never;
      };
      /** @description ACTION_NOT_ALLOWED (cross-origin or a wrong CSRF token) or RECENT_SIGN_IN_REQUIRED (signed in more than 12 hours ago). */
      403: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'text/html': unknown;
        };
      };
      /** @description RATE_LIMITED: too many GitHub sign-ins started. */
      429: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'text/html': unknown;
        };
      };
      /** @description SIGN_IN_UNAVAILABLE: GitHub sign-in is not configured. */
      503: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'text/html': unknown;
        };
      };
    };
  };
  gitHubUnlink: {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    requestBody: {
      content: {
        'application/x-www-form-urlencoded': {
          csrf: string;
        };
      };
    };
    responses: {
      /** @description Unlinked: to /app/keys?github=unlinked. No live account session: to /app/sign-in. */
      303: {
        headers: {
          [name: string]: unknown;
        };
        content?: never;
      };
      /** @description ACTION_NOT_ALLOWED (cross-origin or a wrong CSRF token) or RECENT_SIGN_IN_REQUIRED (signed in more than 12 hours ago). */
      403: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'text/html': unknown;
        };
      };
      /** @description NOT_FOUND: no GitHub account is linked to this account. */
      404: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'text/html': unknown;
        };
      };
      /** @description GITHUB_UNLINK_REFUSED: it is the account’s only way to sign in. */
      409: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'text/html': unknown;
        };
      };
    };
  };
  apiKeysPage: {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      /** @description The keys page. */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'text/html': unknown;
        };
      };
      /** @description To /app/sign-in. */
      303: {
        headers: {
          [name: string]: unknown;
        };
        content?: never;
      };
    };
  };
  createApiKey: {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      /** @description The keys page with the new key, shown once. */
      201: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'text/html': unknown;
        };
      };
      /** @description No live account session, or a sign-in more than 12 hours old: to /app/sign-in (with the key-intent cookie for a valid choice). */
      303: {
        headers: {
          [name: string]: unknown;
        };
        content?: never;
      };
      /** @description INVALID_SCHEMA: an expiry that is not offered, an invalid label (the field shows the error), a form nonce that is missing, unknown, expired or issued to another account session, a changed rendered_at, or expiry dates that changed since the form was shown. */
      400: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'text/html': unknown;
        };
      };
      /** @description ACTION_NOT_ALLOWED: cross-origin or a wrong CSRF token. */
      403: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'text/html': unknown;
        };
      };
      /** @description KEY_LIMIT_REACHED, or KEY_ALREADY_CREATED (the same create form again: no second key, and the secret is not shown again). */
      409: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'text/html': unknown;
        };
      };
    };
  };
  usagePage: {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      /** @description The usage page. */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'text/html': unknown;
        };
      };
      /** @description To /app/sign-in. */
      303: {
        headers: {
          [name: string]: unknown;
        };
        content?: never;
      };
    };
  };
  changeBillingPlan: {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      /** @description To the provider’s hosted Checkout page; or to /app/usage?billing=<notice> with notice requested, unchanged, payment_required, reauth, not_changeable, ending, processing, busy, unavailable, subscribed, not_configured or invalid; or, with no live account session, to /app/sign-in. */
      303: {
        headers: {
          [name: string]: unknown;
        };
        content?: never;
      };
      /** @description ACTION_NOT_ALLOWED: cross-origin or a wrong CSRF token. */
      403: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'text/html': unknown;
        };
      };
    };
  };
  openBillingPortal: {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      /** @description To the provider’s hosted portal page; or to /app/usage?billing=<notice> with notice reauth, no_customer (no billing details yet), unavailable or not_configured; or, with no live account session, to /app/sign-in. */
      303: {
        headers: {
          [name: string]: unknown;
        };
        content?: never;
      };
      /** @description ACTION_NOT_ALLOWED: cross-origin or a wrong CSRF token. */
      403: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'text/html': unknown;
        };
      };
    };
  };
  claimTrial: {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      /** @description Claimed (or already claimed by this account): to /app/keys?claimed=1. No live account session: to /app/sign-in. */
      303: {
        headers: {
          [name: string]: unknown;
        };
        content?: never;
      };
      /** @description INVALID_SCHEMA: not a management credential. */
      400: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'text/html': unknown;
        };
      };
      /** @description ACTION_NOT_ALLOWED: cross-origin or a wrong CSRF token. */
      403: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'text/html': unknown;
        };
      };
      /** @description TRIAL_NOT_FOUND: no live trial for that credential (unknown, revoked, deleted or past its deletion time). */
      404: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'text/html': unknown;
        };
      };
      /** @description TRIAL_ALREADY_CLAIMED: another account claimed this trial. */
      409: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'text/html': unknown;
        };
      };
    };
  };
  evidencePage: {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      /** @description The Evidence page. */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'text/html': unknown;
        };
      };
      /** @description To /app/sign-in. */
      303: {
        headers: {
          [name: string]: unknown;
        };
        content?: never;
      };
      /** @description INVALID_SCHEMA: a filter that does not parse. */
      400: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'text/html': unknown;
        };
      };
      /** @description INTERNAL: the records could not be read. */
      500: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'text/html': unknown;
        };
      };
      /** @description SERVICE_UNAVAILABLE: the evidence view is not composed. */
      503: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'text/html': unknown;
        };
      };
    };
  };
  sessionsPage: {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      /** @description The Sessions page. */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'text/html': unknown;
        };
      };
      /** @description To /app/sign-in. */
      303: {
        headers: {
          [name: string]: unknown;
        };
        content?: never;
      };
      /** @description The Sessions could not be read. */
      503: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'text/html': unknown;
        };
      };
    };
  };
  sessionPage: {
    parameters: {
      query?: never;
      header?: never;
      path: {
        id: string;
      };
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      /** @description The Session page. */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'text/html': unknown;
        };
      };
      /** @description To /app/sign-in. */
      303: {
        headers: {
          [name: string]: unknown;
        };
        content?: never;
      };
      /** @description NOT_FOUND: no such Session in this workspace. */
      404: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'text/html': unknown;
        };
      };
    };
  };
  evidenceExportDownload: {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      /** @description The export file. */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['EvidenceExport'];
        };
      };
      /** @description No live account session: to /app/sign-in. */
      303: {
        headers: {
          [name: string]: unknown;
        };
        content?: never;
      };
      /** @description INVALID_SCHEMA: no complete date range, or an invalid target ID. */
      400: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'text/html': unknown;
        };
      };
      /** @description ACTION_NOT_ALLOWED: cross-origin or a wrong CSRF token. */
      403: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'text/html': unknown;
        };
      };
      /** @description RATE_LIMITED, with Retry-After. */
      429: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'text/html': unknown;
        };
      };
    };
  };
  createTrialSession: {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    requestBody: {
      content: {
        'application/json': components['schemas']['TrialCreateSessionRequest'];
      };
    };
    responses: {
      /** @description Session created at revision 1. */
      201: {
        headers: {
          /** @description Strong: "1.0". */
          ETag?: string;
          /** @description /v1/trial/sessions/{id} */
          Location?: string;
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['TrialCreateSessionResponse'];
        };
      };
      /** @description INVALID_SCHEMA or UNKNOWN_COMPONENT */
      400: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['Error'];
        };
      };
      /** @description NOT_FOUND: the credential does not authorize a trial, an unknown /v1/trial path or a malformed trial URL (never 401) */
      404: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['Error'];
        };
      };
      /** @description PAYLOAD_TOO_LARGE */
      413: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['Error'];
        };
      };
      /** @description RATE_LIMITED: a trial limit (active Sessions, Sessions per trial, new trials per client or overall); also after the trial creation window has ended. The message names the limit in plain words for people; the code and Retry-After are the stable contract, so clients never parse the message. */
      429: {
        headers: {
          /** @description Seconds until the limit frees up, when a retry can succeed. */
          'Retry-After'?: number;
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['Error'];
        };
      };
      /** @description INTERNAL */
      500: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['Error'];
        };
      };
      /** @description TRIAL_UNAVAILABLE: the trial is not configured on this deployment */
      503: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['Error'];
        };
      };
    };
  };
  getTrialSession: {
    parameters: {
      query?: never;
      header?: never;
      path: {
        id: string;
      };
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      /** @description The Session with its trial timing. */
      200: {
        headers: {
          ETag?: string;
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['TrialSessionResponse'];
        };
      };
      /** @description NOT_FOUND: any credential or isolation failure, an unknown /v1/trial path or a malformed trial URL (never 401 or 400) */
      404: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['Error'];
        };
      };
      /** @description INTERNAL */
      500: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['Error'];
        };
      };
      /** @description TRIAL_UNAVAILABLE: the trial is not configured on this deployment */
      503: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['Error'];
        };
      };
    };
  };
  createSession: {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    requestBody: {
      content: {
        'application/json': components['schemas']['CreateSessionRequest'];
      };
    };
    responses: {
      /** @description Session created at revision 1. */
      201: {
        headers: {
          /** @description Display: the quoted revision ("1"). Interactive: the strong "<revision>.<sequence>" ("1.0"). */
          ETag?: string;
          /** @description /v1/sessions/{id} */
          Location?: string;
          /** @description The actual workspace in which this Session was created. Authenticated server-authoritative context for the receipt audience; not a request header or a human identity claim. Returned only on successful owner creation. */
          'Sess-Workspace-Id'?: string;
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['CreateSessionResponse'];
        };
      };
      /** @description INVALID_SCHEMA (including expires_in out of range: the message names the floor and the ceiling in seconds) or UNKNOWN_COMPONENT */
      400: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['Error'];
        };
      };
      /** @description UNAUTHORIZED */
      401: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['Error'];
        };
      };
      /** @description INVOCATION_TERMINAL: the invocation_id names a run of this workspace that has ended or passed its expiry. Nothing is created. */
      409: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['Error'];
        };
      };
      /** @description PAYLOAD_TOO_LARGE */
      413: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['Error'];
        };
      };
      /** @description VALIDATION_FAILED, reason unknown_invocation: the invocation_id names no run of this workspace (a run of another workspace is answered the same way). Nothing is created. */
      422: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['Error'];
        };
      };
      /** @description PLAN_LIMIT_REACHED (P2-12; developer workspaces): reason monthly_allowance (the resolved Sessions of the period plus the admitted Sessions that can still resolve reach the plan allowance) or active_sessions (the plan’s active Sessions are live). Nothing is created. Sessions already admitted, their responses, completion and result delivery are unaffected. The message names the reason, the reset and where to change the plan; GET /v1/account/usage has the numbers. */
      429: {
        headers: {
          /** @description monthly_allowance only: seconds until the period resets. */
          'Retry-After'?: number;
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['Error'];
        };
      };
      /** @description INTERNAL */
      500: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['Error'];
        };
      };
    };
  };
  getSession: {
    parameters: {
      query?: never;
      header?: never;
      path: {
        id: string;
      };
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      /** @description The current revision of the Session. */
      200: {
        headers: {
          ETag?: string;
          /** @description The authorized Session resource’s actual workspace, including the original trial workspace when read through a claim. It can differ from the API credential’s workspace. Use as trusted receipt audience context, not as a human identity or permission to execute an operation. Absent on errors. */
          'Sess-Workspace-Id'?: string;
          [name: string]: unknown;
        };
        content: {
          'application/json':
            components['schemas']['SessionResponse'] | components['schemas']['InteractiveSessionResponse'];
        };
      };
      /** @description INVALID_SCHEMA */
      400: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['Error'];
        };
      };
      /** @description UNAUTHORIZED */
      401: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['Error'];
        };
      };
      /** @description SESSION_NOT_FOUND */
      404: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['Error'];
        };
      };
      /** @description INTERNAL */
      500: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['Error'];
        };
      };
    };
  };
  publishRevision: {
    parameters: {
      query?: never;
      header: {
        /** @description The strong ETag from the latest GET (e.g. "2.3"). Required: absent or `*` → 428 PRECONDITION_REQUIRED. A weak tag (W/"…") never matches (strong comparison); a stale tag → 412 SESSION_REVISION_CONFLICT. */
        'If-Match': string;
        /** @description Scoped to the owner credential, the operation and the Session. The same canonical request (body and If-Match) returns the original result (status, ETag, body); a different request with the same key → 409 IDEMPOTENCY_CONFLICT. Only successful results are recorded. */
        'Idempotency-Key'?: string;
      };
      path: {
        id: string;
      };
      cookie?: never;
    };
    requestBody: {
      content: {
        'application/json': components['schemas']['PatchSessionRequest'];
      };
    };
    responses: {
      /** @description The Session at its new revision. */
      200: {
        headers: {
          /** @description Strong: "<revision>.<sequence>". */
          ETag?: string;
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['InteractiveSessionResponse'];
        };
      };
      /** @description INVALID_SCHEMA or UNKNOWN_COMPONENT */
      400: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['Error'];
        };
      };
      /** @description UNAUTHORIZED */
      401: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['Error'];
        };
      };
      /** @description ACTION_NOT_ALLOWED: a Session of a claimed trial (read-only) */
      403: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['Error'];
        };
      };
      /** @description SESSION_NOT_FOUND */
      404: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['Error'];
        };
      };
      /** @description SESSION_COMPLETED, ACTION_NOT_ALLOWED (display Session) or IDEMPOTENCY_CONFLICT */
      409: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['Error'];
        };
      };
      /** @description SESSION_REVISION_CONFLICT (If-Match does not match the current ETag) */
      412: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['Error'];
        };
      };
      /** @description PAYLOAD_TOO_LARGE */
      413: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['Error'];
        };
      };
      /** @description PRECONDITION_REQUIRED */
      428: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['Error'];
        };
      };
      /** @description INTERNAL */
      500: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['Error'];
        };
      };
    };
  };
  completeSession: {
    parameters: {
      query?: never;
      header: {
        /** @description The strong ETag from the latest GET (e.g. "2.3"). Required: absent or `*` → 428 PRECONDITION_REQUIRED. A weak tag (W/"…") never matches (strong comparison); a stale tag → 412 SESSION_REVISION_CONFLICT. */
        'If-Match': string;
        /** @description Scoped to the owner credential, the operation and the Session. The same canonical request (body and If-Match) returns the original result (status, ETag, body); a different request with the same key → 409 IDEMPOTENCY_CONFLICT. Only successful results are recorded. */
        'Idempotency-Key'?: string;
      };
      path: {
        id: string;
      };
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      /** @description The completed Session. */
      200: {
        headers: {
          /** @description Strong: "<revision>.<sequence>". */
          ETag?: string;
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['InteractiveSessionResponse'];
        };
      };
      /** @description INVALID_SCHEMA */
      400: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['Error'];
        };
      };
      /** @description UNAUTHORIZED */
      401: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['Error'];
        };
      };
      /** @description ACTION_NOT_ALLOWED: a Session of a claimed trial (read-only) */
      403: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['Error'];
        };
      };
      /** @description SESSION_NOT_FOUND */
      404: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['Error'];
        };
      };
      /** @description SESSION_COMPLETED, ACTION_NOT_ALLOWED (display Session) or IDEMPOTENCY_CONFLICT */
      409: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['Error'];
        };
      };
      /** @description SESSION_REVISION_CONFLICT */
      412: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['Error'];
        };
      };
      /** @description PRECONDITION_REQUIRED */
      428: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['Error'];
        };
      };
      /** @description INTERNAL */
      500: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['Error'];
        };
      };
    };
  };
  listSessionEvents: {
    parameters: {
      query?: never;
      header?: never;
      path: {
        id: string;
      };
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      /** @description The Event log. */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['SessionEventsResponse'];
        };
      };
      /** @description UNAUTHORIZED */
      401: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['Error'];
        };
      };
      /** @description SESSION_NOT_FOUND */
      404: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['Error'];
        };
      };
      /** @description INTERNAL */
      500: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['Error'];
        };
      };
    };
  };
  getSurfaceRevision: {
    parameters: {
      query?: never;
      header?: never;
      path: {
        id: string;
        revision: string;
      };
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      /** @description The revision. */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json':
            | components['schemas']['DisplaySurfaceResponse']
            | components['schemas']['InteractiveSurfaceResponse'];
        };
      };
      /** @description INVALID_SCHEMA (revision is not a positive integer) */
      400: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['Error'];
        };
      };
      /** @description UNAUTHORIZED */
      401: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['Error'];
        };
      };
      /** @description SESSION_NOT_FOUND, or NOT_FOUND for a revision that does not exist */
      404: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['Error'];
        };
      };
      /** @description INTERNAL */
      500: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['Error'];
        };
      };
    };
  };
  submitHumanAction: {
    parameters: {
      query?: never;
      header?: never;
      path: {
        token: string;
      };
      cookie?: never;
    };
    requestBody: {
      content: {
        'application/x-www-form-urlencoded': components['schemas']['HumanSubmissionForm'];
      };
    };
    responses: {
      /** @description See Other (Post/Redirect/Get): accepted (with a signed decision receipt stored with its Event, returned by the owner GET and the Event log), or a repeated client_event_id with the same request (the original Event and the same receipt, never re-signed). No body. Location is the same Sess link path, relative, with no query: never an Event ID, receipt or submitted data. A GET there renders the Session as it is then: waiting for the agent (responded), the next revision’s form (active) or the completion (completed). */
      303: {
        headers: {
          /** @description The same /s/{token} path. */
          Location?: string;
          [name: string]: unknown;
        };
        content?: never;
      };
      /** @description INVALID_SCHEMA or ACTION_NOT_FOUND. */
      400: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'text/html': unknown;
        };
      };
      /** @description ACTION_NOT_ALLOWED: not a same-origin submission. */
      403: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'text/html': unknown;
        };
      };
      /** @description Unknown, lapsed, expired or revoked link (generic): an answer is accepted only while the link is live. */
      404: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'text/html': unknown;
        };
      };
      /** @description ACTION_NOT_ALLOWED: a display Session. */
      405: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'text/html': unknown;
        };
      };
      /** @description SESSION_REVISION_CONFLICT (the current revision, prefilled with the safe draft), RESPONSE_LIMIT_REACHED, SESSION_COMPLETED or IDEMPOTENCY_CONFLICT. */
      409: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'text/html': unknown;
        };
      };
      /** @description PAYLOAD_TOO_LARGE. */
      413: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'text/html': unknown;
        };
      };
      /** @description INVALID_SCHEMA: not application/x-www-form-urlencoded. */
      415: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'text/html': unknown;
        };
      };
      /** @description VALIDATION_FAILED: the form with field errors. */
      422: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'text/html': unknown;
        };
      };
      /** @description SERVICE_UNAVAILABLE: the receipt keys are not configured; nothing is accepted. */
      503: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'text/html': unknown;
        };
      };
    };
  };
  extendHumanLink: {
    parameters: {
      query?: never;
      header?: never;
      path: {
        token: string;
      };
      cookie?: never;
    };
    requestBody: {
      content: {
        'application/x-www-form-urlencoded': components['schemas']['HumanExtensionForm'];
      };
    };
    responses: {
      /** @description Extended (or a repeated request for an extension already made): the current page, its form re-rendered with the submitted values. */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'text/html': unknown;
        };
      };
      /** @description INVALID_SCHEMA: not the form’s exact shape, or values that do not decode. */
      400: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'text/html': unknown;
        };
      };
      /** @description ACTION_NOT_ALLOWED: not a same-origin request. */
      403: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'text/html': unknown;
        };
      };
      /** @description Unknown, expired, revoked or purged link (the one generic page). Nothing changes. */
      404: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'text/html': unknown;
        };
      };
      /** @description ACTION_NOT_ALLOWED: a display Session. */
      405: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'text/html': unknown;
        };
      };
      /** @description Nothing changed: SESSION_REVISION_CONFLICT (the current revision, prefilled with the safe draft), SESSION_COMPLETED, or no extension left (none for this link, all ten used, or the deadline already at the horizon; the link stays live until its deadline). */
      409: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'text/html': unknown;
        };
      };
      /** @description PAYLOAD_TOO_LARGE. */
      413: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'text/html': unknown;
        };
      };
      /** @description INVALID_SCHEMA: not application/x-www-form-urlencoded. */
      415: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'text/html': unknown;
        };
      };
    };
  };
  createKeepChallenge: {
    parameters: {
      query?: never;
      header?: never;
      path: {
        token: string;
      };
      cookie?: never;
    };
    requestBody: {
      content: {
        'application/json': components['schemas']['KeepChallengeRequest'];
      };
    };
    responses: {
      /** @description The snapshot and the challenge. */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['KeepChallengeResponse'];
        };
      };
      /** @description INVALID_SCHEMA */
      400: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['Error'];
        };
      };
      /** @description ACTION_NOT_ALLOWED: not a same-origin request. */
      403: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['Error'];
        };
      };
      /** @description Unknown, expired or revoked link, or a display Session (the generic not-found page, text/html); or NOT_FOUND (JSON, reason no_authorized_rounds) when none of the presented grants authorizes an accepted round of this Session. */
      404: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'text/html': unknown;
          'application/json': components['schemas']['Error'];
        };
      };
      /** @description PAYLOAD_TOO_LARGE */
      413: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['Error'];
        };
      };
      /** @description RATE_LIMITED (per link; Retry-After) */
      429: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['Error'];
        };
      };
      /** @description SERVICE_UNAVAILABLE (receipt keys not configured, Keep is off, or the restriction/deletion suppression is not yet re-applied after start) */
      503: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['Error'];
        };
      };
    };
  };
  keepConversation: {
    parameters: {
      query?: never;
      header?: never;
      path: {
        token: string;
      };
      cookie?: never;
    };
    requestBody: {
      content: {
        'application/json': components['schemas']['KeepRequest'];
      };
    };
    responses: {
      /** @description The kept conversation (JSON; Content-Disposition attachment). With `format: pdf`, the receipt PDF of the same snapshot (S-04; Content-Disposition with an ASCII `filename` and the exact `filename*`, header Sess-Keep-Summary `rounds=<n>; coverage=<every_accepted_round|partial>; unenrolled=<0|1>`), or the JSON when the file is outside the PDF profile. */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['KeptConversation'];
          'application/pdf': string;
        };
      };
      /** @description INVALID_SCHEMA */
      400: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['Error'];
        };
      };
      /** @description ACTION_NOT_ALLOWED: not a same-origin request. */
      403: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['Error'];
        };
      };
      /** @description The generic not-found page for an unknown, expired or revoked link (text/html); or NOT_FOUND (JSON, reason no_authorized_rounds). */
      404: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'text/html': unknown;
          'application/json': components['schemas']['Error'];
        };
      };
      /** @description IDEMPOTENCY_CONFLICT: the challenge was already used by a different request. */
      409: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['Error'];
        };
      };
      /** @description PAYLOAD_TOO_LARGE */
      413: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['Error'];
        };
      };
      /** @description HOLDER_ENROLLMENT_REFUSED with reason challenge_unknown, challenge_expired, batch_mismatch, not_authorized, proof_invalid, key_reused or already_enrolled: nothing was enrolled; the same grants without `enrollment` still export the file. */
      422: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['Error'];
        };
      };
      /** @description RATE_LIMITED (per link; Retry-After) */
      429: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['Error'];
        };
      };
      /** @description SERVICE_UNAVAILABLE (receipt keys not configured, Keep is off, or the restriction/deletion suppression is not yet re-applied after start) */
      503: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['Error'];
        };
      };
    };
  };
  createSaveClaim: {
    parameters: {
      query?: never;
      header?: never;
      path: {
        token: string;
      };
      cookie?: never;
    };
    requestBody: {
      content: {
        'application/json': components['schemas']['SaveClaimRequest'];
      };
    };
    responses: {
      /** @description The claim’s transfer secret and expiry. */
      201: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['SaveClaimResponse'];
        };
      };
      /** @description INVALID_SCHEMA */
      400: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['Error'];
        };
      };
      /** @description ACTION_NOT_ALLOWED: not a same-origin request. */
      403: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['Error'];
        };
      };
      /** @description The generic not-found page for an unknown, expired or revoked link (text/html); or NOT_FOUND (JSON, reason no_authorized_rounds). */
      404: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'text/html': unknown;
          'application/json': components['schemas']['Error'];
        };
      };
      /** @description IDEMPOTENCY_CONFLICT (reason destination_used): this destination binding already has a claim. */
      409: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['Error'];
        };
      };
      /** @description PAYLOAD_TOO_LARGE */
      413: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['Error'];
        };
      };
      /** @description RATE_LIMITED (per link; Retry-After) */
      429: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['Error'];
        };
      };
      /** @description SERVICE_UNAVAILABLE: the restriction/deletion suppression is not yet re-applied after start. */
      503: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['Error'];
        };
      };
    };
  };
  getHumanStatus: {
    parameters: {
      query?: never;
      header?: never;
      path: {
        token: string;
      };
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      /** @description waiting: the response to this revision is recorded and the agent has not continued; active: a revision awaits a response; completed: terminal. */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['HumanStatusResponse'];
        };
      };
      /** @description Unknown, expired or revoked link, or a display Session (the generic not-found page). */
      404: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'text/html': unknown;
        };
      };
      /** @description RATE_LIMITED: more than 60 status reads of this link in one minute (per runtime process). Retry-After gives the seconds to wait. */
      429: {
        headers: {
          'Retry-After'?: string;
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['Error'];
        };
      };
    };
  };
  getAccountUsage: {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      /** @description The plan and usage. */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['AccountUsageResponse'];
        };
      };
      /** @description UNAUTHORIZED */
      401: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['Error'];
        };
      };
      /** @description NOT_FOUND: this credential’s workspace has no plan */
      404: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['Error'];
        };
      };
      /** @description SERVICE_UNAVAILABLE: billing is not configured */
      503: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['Error'];
        };
      };
    };
  };
  createBillingCheckout: {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    requestBody: {
      content: {
        'application/json': components['schemas']['BillingCheckoutRequest'];
      };
    };
    responses: {
      /** @description The hosted Checkout page and when it expires. */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['BillingCheckoutResponse'];
        };
      };
      /** @description INVALID_SCHEMA */
      400: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['Error'];
        };
      };
      /** @description UNAUTHORIZED */
      401: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['Error'];
        };
      };
      /** @description NOT_FOUND: this credential’s workspace has no plan */
      404: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['Error'];
        };
      };
      /** @description SUBSCRIPTION_EXISTS (reason: subscribed, checkout_completed): no new Checkout */
      409: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['Error'];
        };
      };
      /** @description SERVICE_UNAVAILABLE (reason: not_configured, checkout_in_progress, checkout_processing, provider_unavailable, provider_rejected). checkout_processing: a paid Checkout’s subscription is still being confirmed; checkout_in_progress: another Checkout is being created or its expiry is not yet confirmed by the provider. No new Checkout is created in either case. Retry after Retry-After seconds when given; a retry returns the same Checkout. */
      503: {
        headers: {
          'Retry-After'?: number;
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['Error'];
        };
      };
    };
  };
  receiveBillingProviderEvent: {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    requestBody: {
      content: {
        'application/json': Record<string, never>;
      };
    };
    responses: {
      /** @description Received (processed, a duplicate, or ignored). */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['BillingEventAck'];
        };
      };
      /** @description INVALID_SCHEMA: a verified body that is not a provider event */
      400: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['Error'];
        };
      };
      /** @description UNAUTHORIZED: missing, malformed, stale or mismatched signature */
      401: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['Error'];
        };
      };
      /** @description NOT_FOUND: no billing provider is configured */
      404: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['Error'];
        };
      };
      /** @description PAYLOAD_TOO_LARGE */
      413: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['Error'];
        };
      };
      /** @description SERVICE_UNAVAILABLE (reason: provider_unavailable): not processed; redeliver */
      503: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['Error'];
        };
      };
    };
  };
  getWebhook: {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      /** @description The webhook state. */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['WebhookResponse'];
        };
      };
      /** @description UNAUTHORIZED */
      401: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['Error'];
        };
      };
    };
  };
  registerWebhook: {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    requestBody: {
      content: {
        'application/json': components['schemas']['WebhookRegisterRequest'];
      };
    };
    responses: {
      /** @description Registered (pending). */
      201: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['WebhookRegisterResponse'];
        };
      };
      /** @description WEBHOOK_INVALID_URL (reason: not_https, port, credentials, fragment, non_public_address, malformed, too_long) or INVALID_SCHEMA */
      400: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['Error'];
        };
      };
      /** @description UNAUTHORIZED */
      401: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['Error'];
        };
      };
      /** @description SERVICE_UNAVAILABLE */
      503: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['Error'];
        };
      };
    };
  };
  verifyWebhook: {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      /** @description Verified; the updated endpoint and its verification expiry. */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['WebhookVerifyResponse'];
        };
      };
      /** @description UNAUTHORIZED */
      401: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['Error'];
        };
      };
      /** @description WEBHOOK_NOT_CONFIGURED */
      409: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['Error'];
        };
      };
      /** @description WEBHOOK_VERIFICATION_FAILED (reason: egress_refused, redirect, rejected, bad_answer, timeout, connection, dns) */
      422: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['Error'];
        };
      };
      /** @description SERVICE_UNAVAILABLE */
      503: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['Error'];
        };
      };
    };
  };
  rotateWebhookSecret: {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      /** @description Rotated. */
      201: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['WebhookRotateResponse'];
        };
      };
      /** @description UNAUTHORIZED */
      401: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['Error'];
        };
      };
      /** @description WEBHOOK_NOT_CONFIGURED */
      409: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['Error'];
        };
      };
      /** @description SERVICE_UNAVAILABLE */
      503: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['Error'];
        };
      };
    };
  };
  listDeliveries: {
    parameters: {
      query?: never;
      header?: never;
      path: {
        id: string;
      };
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      /** @description The delivery log. */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['DeliveriesResponse'];
        };
      };
      /** @description UNAUTHORIZED */
      401: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['Error'];
        };
      };
      /** @description SESSION_NOT_FOUND */
      404: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['Error'];
        };
      };
    };
  };
  redeliverEvent: {
    parameters: {
      query?: never;
      header?: never;
      path: {
        id: string;
        event_id: string;
      };
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      /** @description Queued, or the existing pending delivery for the same Event/endpoint. */
      202: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['RedeliverResponse'];
        };
      };
      /** @description UNAUTHORIZED */
      401: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['Error'];
        };
      };
      /** @description ACTION_NOT_ALLOWED: a Session of a claimed trial (read-only) */
      403: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['Error'];
        };
      };
      /** @description NOT_FOUND (no such accepted Event in this Session) */
      404: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['Error'];
        };
      };
      /** @description WEBHOOK_NOT_CONFIGURED (no verified endpoint) */
      409: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['Error'];
        };
      };
    };
  };
  exportDecisionBundle: {
    parameters: {
      query?: never;
      header?: never;
      path: {
        id: string;
        event_id: string;
      };
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      /** @description The bundle. */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['DecisionBundle'];
        };
      };
      /** @description INVALID_SCHEMA (event_id is not an Event ID) */
      400: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['Error'];
        };
      };
      /** @description UNAUTHORIZED */
      401: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['Error'];
        };
      };
      /** @description SESSION_NOT_FOUND, or NOT_FOUND when the Session has no such accepted response with a receipt (or its content was purged) */
      404: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['Error'];
        };
      };
      /** @description EVIDENCE_RESTRICTED: the receipt’s custody record is restricted; nothing is disclosed until it is unrestricted (P2-13 V5) */
      409: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['Error'];
        };
      };
      /** @description EVIDENCE_DELETED: the receipt’s custody record was deleted; only its tombstone remains (P2-13 V5) */
      410: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['Error'];
        };
      };
      /** @description INTERNAL */
      500: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['Error'];
        };
      };
      /** @description SERVICE_UNAVAILABLE (receipt keys not configured, or restriction/deletion suppression not yet re-applied after start) */
      503: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['Error'];
        };
      };
    };
  };
  verifyDecisionBundle: {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    requestBody: {
      content: {
        'application/json': components['schemas']['DecisionBundle'];
      };
    };
    responses: {
      /** @description The verification result (valid or invalid). */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['DecisionBundleVerification'];
        };
      };
      /** @description INVALID_SCHEMA (not a JSON body) */
      400: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['Error'];
        };
      };
      /** @description PAYLOAD_TOO_LARGE */
      413: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['Error'];
        };
      };
      /** @description RATE_LIMITED */
      429: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['Error'];
        };
      };
      /** @description SERVICE_UNAVAILABLE (receipt keys not configured, or the 2-second deadline from arrival passed; Connection: close) */
      503: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['Error'];
        };
      };
    };
  };
  verifyArchivalEnvelope: {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    requestBody: {
      content: {
        'application/json': components['schemas']['ArchivalEnvelope'];
      };
    };
    responses: {
      /** @description The archival verification result and its presentation. */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['ArchivalVerifyResponse'];
        };
      };
      /** @description INVALID_SCHEMA (not a JSON body) */
      400: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['Error'];
        };
      };
      /** @description PAYLOAD_TOO_LARGE */
      413: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['Error'];
        };
      };
      /** @description RATE_LIMITED */
      429: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['Error'];
        };
      };
      /** @description SERVICE_UNAVAILABLE (receipt keys not configured, or the 2-second deadline from arrival passed; Connection: close) */
      503: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['Error'];
        };
      };
    };
  };
  listTargets: {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      /** @description The targets. */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['TargetListResponse'];
        };
      };
      /** @description UNAUTHORIZED */
      401: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['Error'];
        };
      };
    };
  };
  registerTarget: {
    parameters: {
      query?: never;
      header?: {
        /** @description Optional. Scoped to the owner credential and the operation. The same canonical request body returns the original 201 (status, Location and body: the target as first registered) and registers nothing more, even after the target or the plan changed; a different body with the same key → 409 IDEMPOTENCY_CONFLICT; concurrent requests with one key register one target. Only successful registrations are recorded. Without the header every request registers. */
        'Idempotency-Key'?: string;
      };
      path?: never;
      cookie?: never;
    };
    requestBody: {
      content: {
        'application/json': components['schemas']['TargetRegisterRequest'];
      };
    };
    responses: {
      /** @description Registered (verification pending). */
      201: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['TargetResponse'];
        };
      };
      /** @description TARGET_INVALID_URL (reason: not_https, port, credentials, fragment, non_public_address, malformed, too_long), TARGET_INVALID_CAPABILITY (reason: not_object, unsupported_keyword, too_deep, too_large, does_not_compile, not_a_schema) or INVALID_SCHEMA (an unsupported type, any unknown field or a malformed Idempotency-Key) */
      400: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['Error'];
        };
      };
      /** @description UNAUTHORIZED */
      401: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['Error'];
        };
      };
      /** @description ACTION_NOT_ALLOWED: the workspace may not hold an outbound target */
      403: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['Error'];
        };
      };
      /** @description IDEMPOTENCY_CONFLICT: the key was used for a different request */
      409: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['Error'];
        };
      };
    };
  };
  getTarget: {
    parameters: {
      query?: never;
      header?: never;
      path: {
        id: string;
      };
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      /** @description The target. */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['TargetResponse'];
        };
      };
      /** @description UNAUTHORIZED */
      401: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['Error'];
        };
      };
      /** @description NOT_FOUND (also another workspace’s target) */
      404: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['Error'];
        };
      };
    };
  };
  updateTarget: {
    parameters: {
      query?: never;
      header?: never;
      path: {
        id: string;
      };
      cookie?: never;
    };
    requestBody: {
      content: {
        'application/json': components['schemas']['TargetUpdateRequest'];
      };
    };
    responses: {
      /** @description The updated target. */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['TargetResponse'];
        };
      };
      /** @description TARGET_INVALID_CAPABILITY or INVALID_SCHEMA */
      400: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['Error'];
        };
      };
      /** @description UNAUTHORIZED */
      401: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['Error'];
        };
      };
      /** @description NOT_FOUND */
      404: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['Error'];
        };
      };
    };
  };
  updateTargetSharing: {
    parameters: {
      query?: never;
      header?: never;
      path: {
        id: string;
      };
      cookie?: never;
    };
    requestBody: {
      content: {
        'application/json': components['schemas']['TargetSharingRequest'];
      };
    };
    responses: {
      /** @description The updated target. */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['TargetResponse'];
        };
      };
      /** @description VALIDATION_FAILED (reason: name_invalid, name_reserved, description_invalid, attribution_invalid) or INVALID_SCHEMA */
      400: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['Error'];
        };
      };
      /** @description UNAUTHORIZED */
      401: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['Error'];
        };
      };
      /** @description NOT_FOUND (also another workspace’s target) */
      404: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['Error'];
        };
      };
      /** @description TARGET_NAME_TAKEN, or ACTION_NOT_ALLOWED (reason: name_required) when sharing without a name */
      409: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['Error'];
        };
      };
    };
  };
  verifyTarget: {
    parameters: {
      query?: never;
      header?: never;
      path: {
        id: string;
      };
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      /** @description Verified. */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['TargetResponse'];
        };
      };
      /** @description UNAUTHORIZED */
      401: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['Error'];
        };
      };
      /** @description NOT_FOUND */
      404: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['Error'];
        };
      };
      /** @description TARGET_VERIFICATION_FAILED (reason: egress_refused, redirect, rejected, bad_answer, timeout, connection, dns) */
      422: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['Error'];
        };
      };
    };
  };
  issueTargetGrant: {
    parameters: {
      query?: never;
      header?: never;
      path: {
        id: string;
      };
      cookie?: never;
    };
    requestBody: {
      content: {
        'application/json': components['schemas']['GrantIssueRequest'];
      };
    };
    responses: {
      /** @description Issued. */
      201: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['GrantIssueResponse'];
        };
      };
      /** @description VALIDATION_FAILED (reason: audience) or INVALID_SCHEMA */
      400: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['Error'];
        };
      };
      /** @description UNAUTHORIZED */
      401: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['Error'];
        };
      };
      /** @description NOT_FOUND */
      404: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['Error'];
        };
      };
      /** @description ACTION_NOT_ALLOWED (reason: disabled, unverified) */
      409: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['Error'];
        };
      };
    };
  };
  revokeTargetGrant: {
    parameters: {
      query?: never;
      header?: never;
      path: {
        id: string;
        grant_id: string;
      };
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      /** @description Revoked. */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['GrantRevokeResponse'];
        };
      };
      /** @description UNAUTHORIZED */
      401: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['Error'];
        };
      };
      /** @description NOT_FOUND */
      404: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['Error'];
        };
      };
    };
  };
  startInvocation: {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    requestBody: {
      content: {
        'application/json': components['schemas']['InvocationStartRequest'];
      };
    };
    responses: {
      /** @description Replay: the same admitted run. */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['InvocationStartResponse'];
        };
      };
      /** @description Admitted. */
      201: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['InvocationStartResponse'];
        };
      };
      /** @description INVALID_SCHEMA */
      400: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['Error'];
        };
      };
      /** @description NOT_FOUND: unknown, expired or revoked grant, wrong Origin, or a disabled or unverified target (one generic answer) */
      404: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['Error'];
        };
      };
      /** @description IDEMPOTENCY_CONFLICT or TARGET_VERSION_CONFLICT */
      409: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['Error'];
        };
      };
      /** @description PAYLOAD_TOO_LARGE */
      413: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['Error'];
        };
      };
      /** @description VALIDATION_FAILED: the input does not match the capability schema */
      422: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['Error'];
        };
      };
      /** @description RATE_LIMITED (reason: grant_active, client_daily, target_daily, target_concurrency, workspace_concurrency, global_concurrency, workspace_paused) */
      429: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['Error'];
        };
      };
      /** @description SERVICE_UNAVAILABLE (reason: admission_disabled, not_configured) */
      503: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['Error'];
        };
      };
    };
  };
  getInvocation: {
    parameters: {
      query?: never;
      header?: never;
      path: {
        id: string;
      };
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      /** @description The Invocation. */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['InvocationResponse'];
        };
      };
      /** @description NOT_FOUND (any other credential or Invocation) */
      404: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['Error'];
        };
      };
    };
  };
  cancelInvocation: {
    parameters: {
      query?: never;
      header?: never;
      path: {
        id: string;
      };
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      /** @description Cancelled. */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['InvocationResponse'];
        };
      };
      /** @description NOT_FOUND */
      404: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['Error'];
        };
      };
      /** @description INVOCATION_TERMINAL: it already completed, failed or expired */
      409: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['Error'];
        };
      };
    };
  };
  reportInvocationResult: {
    parameters: {
      query?: never;
      header?: never;
      path: {
        id: string;
      };
      cookie?: never;
    };
    requestBody: {
      content: {
        'application/json': components['schemas']['InvocationResultRequest'];
      };
    };
    responses: {
      /** @description Recorded. */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['InvocationResponse'];
        };
      };
      /** @description NOT_FOUND */
      404: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['Error'];
        };
      };
      /** @description INVOCATION_TERMINAL */
      409: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['Error'];
        };
      };
      /** @description PAYLOAD_TOO_LARGE: result over 16 KiB */
      413: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['Error'];
        };
      };
      /** @description VALIDATION_FAILED (reason: unbound_result) */
      422: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['Error'];
        };
      };
    };
  };
  listEvidence: {
    parameters: {
      query?: {
        /** @description archival (default) or exception. */
        custody?: string;
        /** @description A target ID (tgt_…). */
        target_id?: string;
        /** @description UTC instant (YYYY-MM-DDTHH:MM:SS[.fff]Z, at most millisecond precision; finer is refused), inclusive. */
        accepted_from?: string;
        /** @description UTC instant (at most millisecond precision), exclusive. */
        accepted_to?: string;
        /** @description 1–100, default 25. */
        limit?: string;
        /** @description The previous answer’s next_cursor, with the same filters. */
        cursor?: string;
      };
      header?: never;
      path?: never;
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      /** @description One page. */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['EvidenceListResponse'];
        };
      };
      /** @description INVALID_SCHEMA: a filter, limit or cursor that does not parse */
      400: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['Error'];
        };
      };
      /** @description UNAUTHORIZED */
      401: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['Error'];
        };
      };
      /** @description SERVICE_UNAVAILABLE */
      503: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['Error'];
        };
      };
    };
  };
  exportEvidence: {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    requestBody: {
      content: {
        'application/json': components['schemas']['EvidenceExportRequest'];
      };
    };
    responses: {
      /** @description The export document (a download). */
      200: {
        headers: {
          /** @description attachment; filename="sess-evidence-<workspace>-<custody>-<range>.json" */
          'Content-Disposition'?: string;
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['EvidenceExport'];
        };
      };
      /** @description INVALID_SCHEMA: no explicit range, or a range that does not parse */
      400: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['Error'];
        };
      };
      /** @description UNAUTHORIZED */
      401: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['Error'];
        };
      };
      /** @description RATE_LIMITED, with Retry-After */
      429: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['Error'];
        };
      };
      /** @description SERVICE_UNAVAILABLE */
      503: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['Error'];
        };
      };
    };
  };
  getEvidenceRecordStatus: {
    parameters: {
      query?: never;
      header?: never;
      path: {
        event_id: string;
      };
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      /** @description The status. */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['EvidenceRecordStatus'];
        };
      };
      /** @description INVALID_SCHEMA (event_id is not an Event ID) */
      400: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['Error'];
        };
      };
      /** @description UNAUTHORIZED */
      401: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['Error'];
        };
      };
      /** @description NOT_FOUND */
      404: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['Error'];
        };
      };
      /** @description SERVICE_UNAVAILABLE (the evidence view is not composed, or restriction/deletion suppression is not yet re-applied after start) */
      503: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['Error'];
        };
      };
    };
  };
  receiptKeys: {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      /** @description The JWK Set. */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['ReceiptKeysResponse'];
        };
      };
      /** @description SERVICE_UNAVAILABLE */
      503: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['Error'];
        };
      };
    };
  };
  rendererIdentities: {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      /** @description The signed list (flattened JWS JSON serialization). */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': {
            protected: string;
            payload: string;
            signature: string;
          };
        };
      };
      /** @description SERVICE_UNAVAILABLE */
      503: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['Error'];
        };
      };
    };
  };
  witnessKeys: {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      /** @description The witness key set. */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['WitnessKeysResponse'];
        };
      };
      /** @description SERVICE_UNAVAILABLE: the configured witness key set is unusable */
      503: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['Error'];
        };
      };
    };
  };
  openApi: {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      /** @description The OpenAPI 3.1 document. */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': unknown;
        };
      };
    };
  };
  healthLive: {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      /** @description The process is running. */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['HealthOk'];
        };
      };
    };
  };
  healthReady: {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      /** @description Ready to serve. */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['HealthOk'];
        };
      };
      /** @description Not ready: configuration, database or schema. No detail is disclosed. */
      503: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['HealthUnavailable'];
        };
      };
    };
  };
  version: {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      /** @description The build identity of the running artifact. */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['VersionResponse'];
        };
      };
    };
  };
  webhookResponseAccepted: {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    requestBody: {
      content: {
        'application/json': components['schemas']['WebhookDelivery'];
      };
    };
    responses: {
      /** @description Accepted by the endpoint. */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content?: never;
      };
    };
  };
  webhookEndpointVerification: {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    requestBody: {
      content: {
        'application/json': components['schemas']['WebhookVerification'];
      };
    };
    responses: {
      /** @description The echoed challenge. */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content?: never;
      };
    };
  };
  targetDispatch: {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    requestBody: {
      content: {
        'application/json': components['schemas']['TargetDispatch'];
      };
    };
    responses: {
      /** @description Bound answer. */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['TargetDispatchAnswer'];
        };
      };
    };
  };
}
