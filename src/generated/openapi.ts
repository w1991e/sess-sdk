export interface paths {
  '/.well-known/oauth-protected-resource': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    /**
     * @description Describes the hosted MCP server to an agent host that connects to it (RFC 9728 metadata).
     *
     *     It names the MCP resource, its one authorization server and its one scope, which covers the five Sess tools. The same metadata is served at the root and with the resource path appended.
     *
     *     Advanced: Hosted MCP only; served on the MCP host.
     */
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
    /**
     * @description Describes the hosted MCP server to an agent host that connects to it (RFC 9728 metadata).
     *
     *     It names the MCP resource, its one authorization server and its one scope, which covers the five Sess tools. The same metadata is served at the root and with the resource path appended.
     *
     *     Advanced: Hosted MCP only; served on the MCP host.
     */
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
    /**
     * @description Describes how an agent host signs in to the hosted MCP server (RFC 8414 metadata).
     *
     *     - Only the authorization code flow, with S256 PKCE.
     *     - Only public clients, which send no client secret.
     *     - A client identifies itself with a client ID metadata document; dynamic registration is there for compatibility.
     *     - Tokens can be refreshed and revoked, and every authorization response names its issuer (RFC 9207).
     *
     *     Advanced: The metadata sets `token_endpoint_auth_method` to none and `client_id_metadata_document_supported`. The issuer and the token, registration and revocation endpoints are on the MCP host; the authorization endpoint is the consent page on the account pages (app.sess.si). Hosted MCP only.
     */
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
    /**
     * @description Shows the person the page where they allow an agent host to use Sess for their workspace.
     *
     *     - Someone who has not signed in within the last 12 hours is asked to sign in again first; until then nothing is checked or fetched.
     *     - An unknown client or a redirect address the client never registered gets an error page here, never a redirect.
     *     - Other problems send the person back to the agent host with the error.
     *     - A valid request shows "Authorize an agent host": the host, the workspace and the five tools.
     *     - Opening this page never decides, uses up or issues anything.
     *
     *     Advanced: The query takes `response_type=code`; `client_id`, a registered ID or the https address of a client ID metadata document; `redirect_uri`, required, exactly one of the client’s registered addresses; `code_challenge` and `code_challenge_method=S256`, both required; `state`, optional, at most 512 characters; `scope`, optional, `sess:interact` (an unknown scope beside it is ignored, and a request naming no known scope is refused as `invalid_scope`); and `resource`, optional, the MCP resource, its scheme and host in any letter case. A metadata document is fetched only from public addresses, on port 443, with no redirects, at most 16 KiB within 5 seconds, and is reused for 5 minutes. A redirect back to the host carries the error, the state and the issuer. Hosted MCP only.
     */
    get: operations['authorizeAgentHost'];
    put?: never;
    /**
     * @description Records the person’s choice to allow or deny an agent host.
     *
     *     - The choice must come from the consent page itself, within its 10 minutes, from someone who signed in within the last 12 hours.
     *     - Allow gives the host access to the workspace and ends any earlier access the same host had.
     *     - The person goes back to the agent host with a single-use code that works for 5 minutes.
     *     - Each request from a client is accepted once.
     *
     *     Advanced: The form fields are `csrf`, `request` (the page’s single-use consent request, bound to the account’s session) and `decision` (`allow` or `deny`). The request must be same-origin with a valid CSRF token. Allow creates or renews the consent grant of the workspace, the account and the agent host with a new generation, so earlier tokens and hosted handles of that host end. The redirect carries the code, the state and the issuer. A client and state pair is accepted once. Hosted MCP only.
     */
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
    /**
     * @description Lists the agent hosts the account has allowed.
     *
     *     Someone who is not signed in is sent to the sign-in page.
     *
     *     Advanced: Hosted MCP only.
     */
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
    /**
     * @description Asks the person to confirm removing an agent host.
     *
     *     The page asks one question and offers Remove, which sends the request below, and Cancel, which goes back to the agent hosts page. Opening it changes nothing. Someone who is not signed in is sent to the sign-in page.
     *
     *     Advanced: Hosted MCP only.
     */
    get: operations['removeAgentHostConfirm'];
    put?: never;
    /**
     * @description Removes an agent host’s access to the workspace.
     *
     *     Every token the host holds is revoked, so its access and its hosted conversations end at once.
     *
     *     Advanced: Sent by the confirmation page’s Remove button, same-origin, with the form field `csrf`. The consent grant gets a new generation. Hosted MCP only.
     */
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
    /**
     * @description Exchanges an authorization code or a refresh token for new tokens.
     *
     *     - Clients are public: they send no client secret and no HTTP authentication.
     *     - A code that is used a second time revokes every token issued from it.
     *     - A refresh token that is used again after it was replaced revokes its whole family too, unless it is the family’s latest one and less than 30 seconds have passed, so two refreshes at once both work.
     *     - The body may be at most 16 KiB.
     *
     *     Advanced: With `grant_type=authorization_code`, send `code`, `redirect_uri` (as authorized), `client_id`, `code_verifier` (S256) and, optionally, `resource`. With `grant_type=refresh_token`, send `refresh_token`, `client_id` and, optionally, `scope` and `resource`; the scope is never wider, and an unknown scope is ignored. A refresh within the 30 seconds issues another token pair of the same family. Responses are sent with `Cache-Control: no-store`. Hosted MCP only; served on the MCP host.
     */
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
    /**
     * @description Registers an agent host as a public client, for hosts that cannot use a client ID metadata document (RFC 7591).
     *
     *     - Redirect addresses must be https, http on a loopback host, or a native app scheme, with no fragment or user info.
     *     - Registering grants nothing: the person still allows each use.
     *     - The redirect addresses and the name together may be at most 4 KiB.
     *     - One network address can register at most 400 times an hour, and all addresses together at most 40,000 times an hour.
     *
     *     Advanced: Client ID metadata documents are the preferred path; this one is for compatibility. Hosted MCP only; served on the MCP host.
     */
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
    /**
     * @description Revokes an access or refresh token (RFC 7009).
     *
     *     Revoking an access token also ends the API credentials issued under it; revoking a refresh token ends its whole family. An unknown token, or another client’s, gets the same answer.
     *
     *     Advanced: The form fields are `token` and `client_id`; `token_type_hint` is ignored. Hosted MCP only; served on the MCP host.
     */
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
    /**
     * @description Emails a person a code and a link to sign in to their receipts.
     *
     *     - The six-digit code works for 10 minutes, allows 5 guesses, and only in the browser that asked for it.
     *     - The single-use link works for 15 minutes.
     *     - The answer is the same whether or not the address has an account.
     *     - Every attempt counts toward the sending limits, even one the email provider did not confirm.
     *
     *     Advanced: The code is bound to a challenge cookie this request sets. The link holds a 256-bit token in the URL fragment of the confirm page, /personal/confirm. A send is reserved before the email provider is called. The limits are shared with developer sign-in: 10 sends per address, 100 per client and 1,000 in total per rolling hour; 5 per address and 50 per client per rolling 10 minutes; 5 per browser per hour; and at most 20 sends in flight.
     */
    post: operations['requestPersonalSignIn'];
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  '/personal/sign-in/resend': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get?: never;
    put?: never;
    /**
     * @description Sends a new sign-in email to the address this browser is already signing in with.
     *
     *     The address comes from the browser’s own live sign-in challenge, never from the request, and the body is empty. The sending limits and answers are those of the first send; success is reported only once the email provider confirmed the send, and an uncertain send is never reported as sent.
     */
    post: operations['resendPersonalSignIn'];
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
    /**
     * @description Signs the person in with the emailed code, in the browser that asked for it.
     *
     *     Using the code ends the link of the same email, and using the link ends the code.
     *
     *     Advanced: The person’s session is a host-only cookie (HttpOnly, Secure, SameSite=Lax, path /) for 30 days, renewed to 30 days on a signed-in request at most once an hour; the challenge cookie is cleared. It is a personal session only: no workspace, developer account, API key or billing record is created or changed, and it signs in to no developer page or route. Every refusal gets the same answer: an unknown, used, replaced or expired code, a developer challenge, a wrong or locked code, too many failures, or no challenge in this browser.
     */
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
    /**
     * @description Signs the person in with the emailed link.
     *
     *     The confirm page sends the link’s token from its address. Opening the link never uses it up.
     *
     *     Advanced: The token comes from the URL fragment of /personal/confirm. The session cookie, its renewal and its limits are those of signing in with the code. Every refusal gets the same answer.
     */
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
    /**
     * @description Returns the signed-in person’s own account and the copy they saved most recently.
     *
     *     - The account’s address, so the page can name it before a Save.
     *     - The form token for the person’s next requests.
     *     - The copy this session’s latest Save wrote or found, or nothing when there is none or it was removed, and whether it was saved within the last ten minutes, so the receipts page can open it after a save.
     *     - Reading changes nothing, except that it renews a live session at most once an hour.
     *     - A developer session is never accepted here.
     *
     *     Advanced: The copy is `last_saved`, null when there is none or it was removed, and `last_saved_just_now` says whether it was saved within the last ten minutes.
     */
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
    /** @description Signs the person out in this browser. */
    post: operations['personalSignOut'];
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  '/personal/sign-out/everywhere': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get?: never;
    put?: never;
    /**
     * @description Signs the person out of their receipts on every device.
     *
     *     Every session of this account ends, this one included. Other accounts and any developer session are not touched.
     */
    post: operations['personalSignOutEverywhere'];
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
    /**
     * @description Deletes the person’s account and everything they saved in it.
     *
     *     Every session, every saved copy and the claims that wrote them are deleted. A developer account on the same address, with its sessions, keys and workspace, is not touched.
     *
     *     Advanced: The personal grant itself is deleted too, and an opaque record with no address is left, also in the restore ledger, so a restore cannot bring the account back. The identity record is deleted unless a developer account still uses the address. Closing needs a sign-in within the last 15 minutes; a renewed session does not count. A hold that names a round of a saved copy stops the closing, and the hold is never named.
     */
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
    /**
     * @description Ties a Save to this signed-in person, so only they can finish it.
     *
     *     - The Save sheet sends a random value of its own; the answer is a value derived from it that only this session can produce.
     *     - A claim made for this binding can be finished only by this session, presenting the same value.
     *     - Nothing is stored, apart from renewing the session at most once an hour.
     *     - Binding the same claim again gets the same answer, so a retry after a lost answer is safe.
     *
     *     Advanced: The answer is an HMAC of the nonce keyed by the session’s secret. With `secret` and `verifier` (a claim made at the tap, not bound yet), the same request binds that claim to this binding, atomically and before any redemption: the claim must match the secret, purpose, personal origin and source verifier, and a binding already held by another claim never binds it.
     */
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
    /**
     * @description Saves the claimed conversation into the person’s receipts.
     *
     *     - The claim’s secret, its verifier, the Save sheet’s value and this session’s binding must all match; the secret alone never does, and a claim that is not bound yet never matches.
     *     - The claim and the saved copy are written together, or not at all.
     *     - If what the claim covers changed under a restriction since it was made, nothing is saved.
     *     - Sending the same request again gets the first answer, without a second save.
     *
     *     Advanced: Suppression is checked again: if the rounds the claim’s grants authorize are no longer exactly its batch, the claim is aborted. The copy is the kept-conversation file as Keep produces it at that moment, stored under the personal grant; saving the same rounds again writes nothing and answers the same `saved_at`.
     */
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
    /**
     * @description Saves a conversation straight into the person’s receipts when the Sess link page is on the same site.
     *
     *     No claim is needed. The link and the person’s keep permissions travel in the body, never in an address. What those permissions cover now is saved, exactly as Keep would export it. This works only on that one site.
     *
     *     Advanced: Saving the same rounds again writes nothing and answers the same `saved_at`.
     */
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
    /**
     * @description Lists the copies the person saved, newest first, at most 100.
     *
     *     Each copy comes with its title and its rounds as they are served now. For each round you get, separately, whether its signature checks out, whether its questions and answers match, and the holder status recorded when it was saved.
     *
     *     A round withheld by a restriction or deletion order is left out, and the copy’s status says it is partly unavailable or unavailable, never why. Reading changes nothing, apart from renewing the session at most once an hour.
     *
     *     Advanced: The signature outcome is the archival verifier’s. Holder proofs whose batch names a withheld round are withheld too, and the status is then `partly_unavailable` or `unavailable`.
     */
    get: operations['listPersonalCopies'];
    put?: never;
    post?: never;
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  '/personal/copies/query': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get?: never;
    put?: never;
    /**
     * @description Returns one page of 20 of the person’s saved copies, sorted, searched and filtered, with the number of matches.
     *
     *     - Sort by the date the row shows (the last answer, else the date saved), the shown title or the agent’s name.
     *     - Search a part of the title or the agent’s name; the answers are never searched.
     *     - Filter by status, and page past the newest 100.
     *     - Each copy shows only its item, the date saved, the date of its last answer, its status, its shown title and the agent’s name.
     *     - The search travels only in this body, never in an address, and is never logged.
     *     - Reading changes nothing, apart from renewing the session at most once an hour.
     *
     *     Advanced: The shown title is the title of the first round the copy serves now that has one, and the last answer is that round’s or a later served round’s time. The agent’s name is the one it was published under when the copy was saved: a historical display name, never a verified identity. Withholding comes first: a round a restriction or deletion order withholds from personal copies, and the name of a copy with nothing served, are never shown, matched, counted or sorted on. Paging is by a stable position: each answer carries the cursors of its next and previous pages, sealed for this session, so a copy saved meanwhile never repeats or skips a row.
     */
    post: operations['queryPersonalCopies'];
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  '/personal/copies/open': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get?: never;
    put?: never;
    /**
     * @description Returns one saved copy to read on the page.
     *
     *     For each round it serves now: its title and description, the action the person chose, the questions and answers as plain text, and the two verification outcomes and the holder status, each kept separate. A withheld round is left out.
     *
     *     No file, receipt or proof is returned here; Download gives the file. Reading changes nothing, apart from renewing the session at most once an hour.
     */
    post: operations['openPersonalCopy'];
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  '/personal/copies/label': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get?: never;
    put?: never;
    /**
     * @description Renames a saved copy for the person, or clears the name.
     *
     *     The name is stored beside the copy, never in it: the file, its digest, its receipt and its download stay the same. The receipts table shows it, searches it and sorts by it in place of the title. It is deleted with the copy.
     *
     *     Advanced: Send null to clear the name.
     */
    post: operations['labelPersonalCopy'];
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  '/personal/copies/download-many': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get?: never;
    put?: never;
    /**
     * @description Downloads several saved copies as one ZIP file.
     *
     *     - Each file in the archive is exactly what downloading that one copy gives, named by the date saved and its place in the selection, never by the person’s own name for it.
     *     - Copies with nothing to serve, or not in this account, are left out, and the response says how many and which.
     *     - A selection larger than one archive holds is refused whole, never trimmed.
     *
     *     Advanced: The archive is stored uncompressed, named sess-receipts-YYYY-MM-DD.zip, and sent as an attachment. The `X-Sess-Left-Out` header counts the copies left out and `X-Sess-Left-Out-Items` names them. It holds at most 32 MiB, a limit set from the largest valid copy measured, so any one copy fits; it must be ready within 20 seconds; one export runs per account and one per process at a time. Files are streamed one at a time with a `Content-Length`, so a copy that changes while it is sent ends the response short and the download fails rather than delivering a wrong archive.
     */
    post: operations['downloadPersonalCopies'];
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  '/personal/copies/remove-many': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get?: never;
    put?: never;
    /**
     * @description Removes several saved copies from Sess and reports what happened to each.
     *
     *     Each copy is removed exactly as removing it alone would, in its own step with its own hold check and its own ledger entry.
     *
     *     Each copy gets one outcome: removed; not found, as it was already gone, so a retry is safe; held, as a legal hold covers it; failed, still saved as read again afterwards; not attempted, as the request ran out of time or the session ended part way; or unknown, as the removal failed and could not be read back in time.
     *
     *     Advanced: Each copy has its own transaction. The outcomes are `removed`, `not_found`, `held`, `failed` (read again under its lock), `not_attempted` and `unknown`; a lost answer to a commit is never taken for a rollback. Removing needs a sign-in within the last 12 hours; a renewed session does not count.
     */
    post: operations['removePersonalCopies'];
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
    /**
     * @description Downloads one saved copy as a file, or as its receipt PDF.
     *
     *     When nothing of the copy is withheld, the file is exactly what was saved. Otherwise it is the file as Keep would serve it now: withheld rounds and the holder proofs that name them are left out.
     *
     *     Advanced: The file is the copy’s sess.kept-conversation file, sent as an attachment. With `format: pdf`, as the receipts page’s Download asks, the answer is the receipt PDF of that same file, with an ASCII `filename` and the exact `filename*` in `Content-Disposition`, or the JSON file when it falls outside what the PDF can show.
     */
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
    /**
     * @description Removes one saved copy from Sess.
     *
     *     The copy and the claims that wrote it are deleted and the removal is recorded in the restore ledger, all in one step. Nothing else is touched: no receipt, no Session, nothing the developer keeps.
     *
     *     Advanced: A legal hold that covers one of the copy’s rounds stops the removal, and the hold is never named.
     */
    post: operations['removePersonalCopy'];
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  '/v1/asks': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get?: never;
    put?: never;
    /**
     * @description Creates an Ask: one link that many people can answer, each on their own page.
     *
     *     - Share the link with everyone who should answer. Each person gets their own page.
     *     - Each person who starts gets an ordinary Session; read them all with GET /v1/asks/{id}, or each with GET /v1/sessions/{id}.
     *     - `respondents.max` is exact: it is checked when a person starts, so it cannot be overshot.
     *     - A respondent is a browser, not a person.
     *     - Creating an Ask reserves nothing and counts nothing; each Start is admitted against your plan then, like a new Session.
     *
     *     Advanced: The body takes the same interactive `interaction` as POST /v1/sessions. `expires_in` is the one deadline; each respondent’s link ends by it. A Start is refused after the deadline, with less than a minute left, above 30 Starts a minute on one Ask, and while your plan admits nothing new (the person sees that it is paused; the Ask stays open). An Ask is immutable: PATCH is refused. An `Idempotency-Key` header is refused, because the link cannot be sent again: if the outcome is uncertain, create again (an unused Ask costs nothing).
     */
    post: operations['createAsk'];
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  '/v1/asks/{id}': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    /**
     * @description Reads an Ask: whether it is open, how many started, answered and completed, and each respondent with their accepted answers.
     *
     *     - Respondents are in the order they started.
     *     - Counts include Starts refused, by reason.
     *     - An Ask is `closed` once its last place was started, you closed it, or its deadline passed; `closed_by` says which.
     *     - A respondent whose content was deleted after its retention is listed with its times only.
     *
     *     Advanced: Returning a respondent’s answer here is its retrieval, exactly as GET /v1/sessions/{id} is: it counts toward your plan once, when the response was sent in full. Up to 100 respondents a page; pass `next_cursor` as `cursor` for the next.
     */
    get: operations['getAsk'];
    put?: never;
    post?: never;
    delete?: never;
    options?: never;
    head?: never;
    /** @description Always refused: an Ask is immutable. Every respondent sees the round you created. To continue one respondent, set `auto_complete` false at create and use PATCH /v1/sessions/{id} on their Session. */
    patch: operations['updateAsk'];
    trace?: never;
  };
  '/v1/asks/{id}/close': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get?: never;
    put?: never;
    /**
     * @description Closes an Ask now: no one new can start.
     *
     *     - Respondents who have not answered yet have their links ended, and their places on your plan are freed.
     *     - Respondents who answered keep their pages and receipts.
     *     - Closing a closed Ask changes nothing.
     *
     *     Advanced: The answer carries no respondent answers. An `ask.closed` webhook is sent when this closes it.
     */
    post: operations['closeAsk'];
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  '/v1/asks/{id}/deliveries': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    /** @description Lists every webhook delivery of an Ask’s own events (`ask.closed`), with every attempt. A respondent’s answers are listed on its Session’s deliveries. */
    get: operations['listAskDeliveries'];
    put?: never;
    post?: never;
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  '/v1/asks/{id}/events/{event_id}/redeliver': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get?: never;
    put?: never;
    /** @description Sends an Ask’s `ask.closed` to your webhook again, to your current verified address with a fresh set of retries; the same bytes and event ID as before. */
    post: operations['redeliverAskEvent'];
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  '/v1/trial/asks': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get?: never;
    put?: never;
    /**
     * @description Creates an Ask in a no-signup trial, for at most 2 people.
     *
     *     - Without a key, it starts a trial and returns the trial key once.
     *     - With the trial key, it adds an Ask to that trial.
     *     - Each respondent is a trial Session: it counts toward the trial’s 3 active and 10 Sessions, and its link lasts at most 1 hour.
     *     - Each Start counts as one in the network’s 3 trials a day, together with new trials.
     *
     *     Advanced: Read it with GET /v1/trial/asks/{id} and the trial key. An `Idempotency-Key` header is refused.
     */
    post: operations['createTrialAsk'];
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  '/v1/trial/asks/{id}': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    /** @description Reads a trial Ask with the trial key, as GET /v1/asks/{id} reads an Ask. Another trial’s Ask, an unknown key and an owner key all get the same not-found answer. */
    get: operations['getTrialAsk'];
    put?: never;
    post?: never;
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
    /**
     * @description Emails a developer a link to sign in to their account.
     *
     *     - The link works once and for 15 minutes.
     *     - A newer link replaces it once the email provider has confirmed sending the newer one; a send that was not confirmed replaces nothing.
     *     - Signing in with one link ends the address’s other links.
     *     - The answer is the same whether or not the address has an account.
     *     - Opening the link shows a page whose Sign in button finishes signing in; opening it never uses it up.
     *     - Signing in as a developer never verifies a person who answers a Sess link.
     *
     *     Advanced: Each address can ask for 10 links and each client for 100 per rolling hour, and 5 and 50 per rolling 10 minutes. A send that was not confirmed still counts toward these limits.
     */
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
    /**
     * @description Shows the developer sign-in page, where a developer asks for a sign-in email.
     *
     *     - The email has a link and a six-digit code; the code works only in this browser.
     *     - Someone already signed in goes straight to the account pages.
     *     - When a key creation is waiting for a sign-in, the page is shown as "Verify it’s you", whatever the session, and the key is created only after the email is confirmed.
     *     - When GitHub sign-in is set up, the page also offers "Continue with GitHub".
     *     - Opening the page never uses a link, creates a key or changes anything, apart from renewing a signed-in session at most once an hour.
     *
     *     Advanced: The form posts same-origin only. Each request is one challenge, a link and a code, with a random browser challenge in a cookie (HttpOnly, Secure, SameSite=Strict, host-only, path /app, 15 minutes) that the code is bound to; the browser then goes to /app/check-email, whose code form posts to /app/sign-in/code. A live session (unexpired, not revoked) goes to /app/, a fixed path that nothing in the request can change. A waiting key creation is a valid key-creation cookie. "Continue with GitHub" posts to /app/sign-in/github, and the page’s form-action then also allows https://github.com.
     */
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
    /**
     * @description Shows the page the emailed sign-in link opens.
     *
     *     It shows only a Sign in button, and opening it uses nothing up. When the link was asked for to finish creating a key, the button says "Continue creating your key".
     *
     *     Advanced: The token in the address is a single-use secret and is never logged. The key-creation case is `?continue=key`.
     */
    get: operations['signInConfirmPage'];
    put?: never;
    /**
     * @description Signs the developer in with the emailed link.
     *
     *     - The link works once, and using it also ends the code from the same email.
     *     - The session lasts 30 days and renews while it is used; deleting things needs a sign-in within the last 12 hours.
     *     - This browser’s previous session ends.
     *     - When this browser was waiting to create a key for the same account, the key is created now, once, with the name and expiry chosen, and the keys page shows it once.
     *     - A key creation waiting for another account creates nothing.
     *
     *     Advanced: Same-origin requests only. The session is a cookie (HttpOnly, Secure, SameSite=Lax, host-only, path /app). The waiting key creation is a key-creation cookie, set by a create request whose session had expired, and it is cleared here. When the expiry date its form showed is no longer the date a key created now would get, because a new UTC day began, the key is not created and the keys page shows a fresh form. A link asked for to finish a key creation started in another browser goes to /app/keys?resume=elsewhere.
     */
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
    /**
     * @description Signs the developer in with the emailed six-digit code, in the browser that asked for it.
     *
     *     - The code works for 10 minutes and allows 5 guesses.
     *     - Failed guesses also count toward limits per address, per client and in total, across resent emails.
     *     - A correct code ends the link from the same email, then signs in exactly as the link does, including a waiting key creation.
     *     - Every refusal gets the same answer.
     *
     *     Advanced: Same-origin form posts only, with the fields `csrf` (the check-email page’s token, derived from the browser challenge) and `code` (6 digits; spaces and hyphens are ignored). The limits are 10 failed guesses per address, 30 per client and 2,000 in total per rolling hour. A match uses up the challenge atomically. The session, its 30 days, its renewal and the 12-hour rule for deleting are the link’s. A key creation started in another browser or account goes to /app/keys?resume=elsewhere.
     */
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
    /**
     * @description Signs one of the account’s sessions out.
     *
     *     Each session is listed under "Sign-in and sessions" on the keys page. Signing out the device you are using also clears its cookie.
     *
     *     Advanced: Each session has a public ID (`acs_…`). Same-origin form posts with the session’s form token only.
     */
    post: operations['signOutDevice'];
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  '/app/account/close': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    /**
     * @description Shows the one screen that confirms deleting the developer account.
     *
     *     It opens from the account menu. Nothing is deleted until the person confirms; opening it only renews a signed-in session, at most once an hour.
     */
    get: operations['closeAccountScreen'];
    put?: never;
    /**
     * @description Deletes the signed-in developer account.
     *
     *     - It needs a sign-in within the last 15 minutes; an older one deletes nothing and asks the person to confirm by email in the same browser first, then deletes once.
     *     - Any paid plan is set to end at the end of its period first; if that is not confirmed, nothing is deleted.
     *     - Every API key, session, agent host’s access, the GitHub link and the account itself are deleted together, and any trial claims are released.
     *     - The workspace closes: its webhook and agents stop, and its Sessions follow their retention; each signed receipt stays and keeps verifying, kept without automatic expiry.
     *     - A personal account on the same address is never touched.
     *
     *     Advanced: Same-origin form posts with the session’s form token only; the 15 minutes are measured by the database clock. Each live subscription not already ending is set to cancel at the end of its period through the billing provider, and open Checkouts are expired. Then one transaction deletes every API key, account session, hosted-MCP grant and token, the GitHub link, trial claims and the developer record, replaces live sign-in links, closes the workspace with its webhook endpoint and targets disabled, and records a content-free tombstone and account-ledger line.
     */
    post: operations['closeAccount'];
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  '/app/account/closed': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    /**
     * @description Shows the page a person sees after deleting their account.
     *
     *     Its words are fixed and it reads nothing.
     */
    get: operations['accountClosed'];
    put?: never;
    post?: never;
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
    /**
     * @description Starts signing in with GitHub, from "Continue with GitHub" on the sign-in page.
     *
     *     - The button is shown only when the deployment has a GitHub app set up.
     *     - The person goes to GitHub’s authorization page, asked only for their email address.
     *     - The start is tied to this browser for 10 minutes, so it can finish only here.
     *     - After signing in, the person returns to the receipts page when they started there, else to the account pages.
     *     - A client can start 30 GitHub sign-ins and the service 1,000 per rolling hour.
     *
     *     Advanced: Same-origin form posts only. A new random state (256 bits, single use, 10 minutes, stored only as a hash) is bound to a new browser secret in a cookie (HttpOnly, Secure, SameSite=Strict, host-only, path /app, 10 minutes, stored only as a hash), which also derives the PKCE verifier; the verifier is never stored or sent to the browser. The redirect to https://github.com/login/oauth/authorize carries `client_id`, the fixed `redirect_uri` of /app/sign-in/github/callback on the account origin, `scope=user:email` (the only scope), `state`, `code_challenge` and `code_challenge_method=S256`. The optional field `return` takes `/evidence`; anything else returns to /app/. A page with this form also allows https://github.com in its form-action; every other account page keeps form-action 'self'.
     */
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
    /**
     * @description Shows the page GitHub sends the person back to.
     *
     *     Opening it changes nothing. With a valid reply it shows "Finish signing in with GitHub", whose Continue button finishes on this site. When the person cancelled on GitHub, or GitHub reports an error, the page says so.
     *
     *     Advanced: This is the callback address registered with the GitHub app. Continue posts the `code` and `state` back, same-origin. Both are single-use secrets: the request log records only the route, never the query. GitHub’s cancel is `error=access_denied`.
     */
    get: operations['gitHubSignInReturn'];
    put?: never;
    /**
     * @description Finishes signing in with GitHub, or linking a GitHub account, in the browser that started it.
     *
     *     - Each start finishes once, whatever happens next, so a replay or another browser cannot use it.
     *     - A GitHub account already linked signs in to its Sess account, whatever its address or login is now.
     *     - A new GitHub account with a verified address no account uses creates a Sess account linked to it.
     *     - An address an existing account already uses is never merged: sign in with email, then link GitHub.
     *     - Without a verified, usable address the person signs in with email instead, and nothing is created.
     *     - Signing in works exactly like the email sign-in, including a waiting key creation in this browser.
     *     - Linking works only from the session that started it, signed in within the last 12 hours; a GitHub account links to one Sess account, and a Sess account to one GitHub account.
     *
     *     Advanced: Same-origin form posts only, with the fields `code` and `state`, carrying the browser cookie whose hash the state is bound to; the state is used once, so a replay, another browser or a planted callback finds it used or unbound. The code is exchanged at GitHub with the PKCE verifier; the stable numeric GitHub user ID and the verified primary address are read with `user:email`, and GitHub’s access token is discarded, never stored or logged. The session, its 30 days, its renewal, the 12-hour rule and the end of the browser’s previous session are those of the email sign-in. The person returns to /app/ or /app/evidence, or to /app/keys?resume=elsewhere for a key creation of another account; a link returns to /app/keys?github=linked.
     */
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
    /**
     * @description Starts linking a GitHub account to the signed-in account, from "Sign-in and sessions" on the keys page.
     *
     *     It needs a sign-in within the last 12 hours. It then works exactly as starting a GitHub sign-in, tied to this account and session as well.
     *
     *     Advanced: Same-origin form posts with the session’s form token only.
     */
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
    /**
     * @description Unlinks the account’s GitHub account.
     *
     *     - It needs a sign-in within the last 12 hours.
     *     - Every other live session that GitHub opened is signed out; this one stays.
     *     - The account always keeps its email sign-in, so unlinking never locks anyone out.
     *     - It works even when GitHub sign-in is no longer set up.
     *
     *     Advanced: Same-origin form posts with the session’s form token only.
     */
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
    /**
     * @description Shows the workspace’s API keys: each key’s name, fingerprint, creation date, last use, expiry and state.
     *
     *     Right after you create a key, this page shows its secret once. If you open the page again within two minutes, it lists the keys and says the key was created and its secret already shown. Someone who is not signed in is sent to the sign-in page.
     *
     *     Advanced: The secret is held server-side for two minutes, bound to the session and sealed under a key derived from the session cookie, never in an address, and exactly one request takes it. The page is never cached.
     */
    get: operations['apiKeysPage'];
    put?: never;
    /**
     * @description Creates an API key for the developer workspace from the keys page’s form.
     *
     *     - The keys page you return to shows the key once; no secret is ever in this response or its headers.
     *     - Each form can create one key: sending the same form again never creates a second key or shows the secret again.
     *     - The key gets the expiry date the form showed; if that date is no longer right, the form is shown again.
     *     - An account can have at most 10 active keys.
     *     - If the session has expired, or the sign-in is more than 12 hours old, your choice is kept and the key is created right after you confirm by email in the same browser.
     *
     *     Advanced: The form fields are `csrf`, `nonce` (single use, bound to the account session, 15 minutes), `rendered_at` (bound to the nonce), `label` (optional, at most 64 characters, no control characters) and `expires_in_days` (30, 90, 365 or never; required). Same-origin requests with the session’s form token only. The answer is a 303 to /app/keys (Post/Redirect/Get). A kept choice is a key-creation cookie (HMAC-protected, HttpOnly, Secure, SameSite=Strict, host-only, path /app, 15 minutes) bound to that account, and the browser goes to the sign-in page, "Verify it’s you". Keys begin `sess_sk_`. Revoking asks first: GET /app/keys/{id}/revoke is the confirmation step, and its button posts to POST /app/keys/{id}/revoke. Sign out is POST /app/sign-out, at once.
     */
    post: operations['createApiKey'];
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  '/app/keys/{id}/revoke': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    /**
     * @description Asks the developer to confirm revoking an API key.
     *
     *     The page asks one question naming the key and offers Revoke key and Cancel, which goes back to the keys page. Opening it changes nothing, apart from renewing a signed-in session at most once an hour, and needs no recent sign-in. Someone who is not signed in is sent to the sign-in page.
     */
    get: operations['revokeApiKeyConfirm'];
    put?: never;
    /**
     * @description Revokes one active API key of the workspace, at once.
     *
     *     If the sign-in is more than 12 hours old, nothing is revoked yet: your choice is kept, and the key is revoked once you confirm by email in the same browser.
     *
     *     Advanced: Sent by the confirmation page’s button, same-origin, with the form field `csrf`. The kept choice is the key-creation cookie, and the browser goes to the sign-in page, "Verify it’s you".
     */
    post: operations['revokeApiKey'];
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
    /**
     * @description Shows the workspace’s plan and how much of it is used.
     *
     *     - The plan, the Sessions used of the monthly allowance, the next reset (UTC) and the active Sessions.
     *     - A warning at 80% and at 100% of the allowance.
     *     - Where billing is set up: Change plan, which opens a payment page from the free plan or changes a paid plan in place, and Manage billing, with the plan’s badge and, at the limit, a link to Change plan beside the reason.
     *     - Someone who is not signed in is sent to the sign-in page.
     *
     *     Advanced: The `billing` query is a fixed notice code shown after a billing action and changes nothing. The page’s form-action also allows the payment provider’s hosted Checkout and portal origins.
     */
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
    /**
     * @description Changes the workspace’s paid plan.
     *
     *     - Without a paid plan, the person goes to the payment provider’s checkout page.
     *     - With one, that one plan changes in place, never a second plan or a new checkout; this needs a sign-in within the last 12 hours.
     *     - The plan changes only when the payment provider confirms it, never from this request alone.
     *     - When the provider’s answer is uncertain the change stays pending, and the next request repeats it safely before anything else is sent.
     *
     *     Advanced: The form fields are `csrf` and `plan` (`starter` or `pro`); the server chooses the approved price, and nothing else comes from the browser. Same-origin requests with the session’s form token only. The checkout is the same one as POST /v1/account/billing/checkout. The confirmation is the provider’s signed event or a reconciliation, and a repeat uses the same idempotency key. The usage page’s notices are `requested`, `unchanged`, `payment_required`, `reauth`, `not_changeable`, `ending`, `processing`, `busy`, `unavailable`, `subscribed`, `not_configured` and `invalid`.
     */
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
    /**
     * @description Opens the payment provider’s billing page for the workspace: payment details, invoices and cancelling.
     *
     *     It needs a sign-in within the last 12 hours. Cancelling there ends the paid plan at the provider, and the workspace returns to the free plan only once the provider confirms it.
     *
     *     Advanced: The customer is the workspace’s own, found on the server; no customer ID or email comes from the browser. Same-origin requests with the form field `csrf` only. The usage page’s notices are `reauth`, `no_customer` (no billing details yet), `unavailable` and `not_configured`.
     */
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
    /**
     * @description Adds a no-signup trial to the signed-in developer account.
     *
     *     - The account becomes the trial’s owner, once; nothing moves.
     *     - The trial keeps its deadlines, limits and deletion time, its receipts stay as issued, and its trial key keeps working.
     *     - The account’s API keys can then read, and only read, the trial’s Sessions, each until its result is no longer available, as the trial key can.
     *     - Claiming the same trial again from the same account gets the same answer.
     *     - A Sess link can never claim a trial.
     *
     *     Advanced: The form fields are `csrf` and `management_credential`, the trial’s `sess_mg_…` credential, only ever in the form body, never in an address. Same-origin requests with the session’s form token only. The reads use the owner read routes, each Session until its `result_available_until`.
     */
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
    /**
     * @description Lists the workspace’s receipts in the console, as details only.
     *
     *     Each row shows the receipt and Session IDs, the workspace’s sequence number, when the answer was accepted, the witness status and whether the answers are still kept; receipts held unverified have their own view. A receipt or an answer is never shown on this page. The page shows 25 at a time, counted under the same filters, with Previous and Next. Someone who is not signed in is sent to the sign-in page.
     *
     *     Advanced: The query takes `custody` (`exception`), `from` and `to` (UTC dates, `to` included), `target` (a target ID), `q` (a part of the Session title, matched as plain text) and `cursor`, an opaque page position, forward or back; one that is not of this view gives the first page. The page is labelled "issued records in this defined scope/range".
     */
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
    /**
     * @description Lists the workspace’s Sessions in the console, as details only.
     *
     *     Each row shows the title, when it was sent, when it closes and its status: open, answered, expired, revoked or closed. You can filter by open, answered or expired, and sort by when it was sent or when it closes. The page shows 25 at a time, counted under the same filter, with Previous and Next. A Sess link, a token or an answer is never shown here. Reading changes nothing, apart from renewing a signed-in session at most once an hour; someone who is not signed in is sent to the sign-in page.
     *
     *     Advanced: The query takes `status` (`open`, `answered` or `expired`; all by default), `sort` (`sent` or `closes`; `sent` by default), `dir` (`asc` or `desc`; newest first for sent, soonest first for closes) and `after` or `before`, an opaque page key, and `q` (a part of the title, matched as plain text). The Filter menu sends `order` (`sent-desc`, `sent-asc`, `closes-asc` or `closes-desc`) in place of `sort` and `dir`. An unknown or malformed value, or a key past every row, takes its default. Closes is the Session’s `action_expires_at`.
     */
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
    /**
     * @description Shows one Session of the workspace in the console, as details only.
     *
     *     You see its status, when it was sent and when it closes, and its event log: event, round, action, by whom and when, never the answer. Each accepted answer shows its receipt’s workspace number when it has one (the number Evidence names it by), its event ID and time, with a link to that receipt’s Evidence page while the receipt is kept and not restricted. Reading changes nothing, apart from renewing a signed-in session at most once an hour. Another workspace’s Session gets the same answer as an unknown one.
     */
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
    /**
     * @description Downloads an export of the receipts in the current filter, from the console.
     *
     *     It is the same document as the export API, for up to 100 receipts that the applied filter shows (every receipt when none is applied); the search is not part of it. The page says what the export holds in the line under the list.
     *
     *     Advanced: The form fields are `csrf`, `custody` and, optionally, `from` and `to` (UTC dates, `to` included) and `target`. Same-origin requests with the session’s form token only. The file is an attachment named from the workspace, the custody and the dates only. The export API is POST /v1/evidence/export.
     */
    post: operations['evidenceExportDownload'];
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  '/app/evidence/{event_id}': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    /**
     * @description Shows one receipt of the workspace in the console.
     *
     *     You see its receipt number, its event and Session IDs, when the answer was accepted, the witness status and whether the answers are still kept, with Verify and the receipt download when the receipt has a signed archival core. A receipt, an answer or a Sess link is never shown on the page. Another workspace’s receipt, an unknown one and a malformed ID get the same answer; someone who is not signed in is sent to the sign-in page.
     */
    get: operations['evidenceReceiptPage'];
    put?: never;
    post?: never;
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  '/app/evidence/{event_id}/receipt.json': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    /**
     * @description Downloads one receipt’s archival envelope.
     *
     *     It is the same value the export holds for that receipt. A receipt without a signed archival core, another workspace’s receipt and an unknown one get the same answer; someone who is not signed in is sent to the sign-in page.
     *
     *     Advanced: The file is an attachment named from the workspace and the receipt number, or the event ID, only.
     */
    get: operations['evidenceReceiptDownload'];
    put?: never;
    post?: never;
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  '/app/evidence/{event_id}/verify': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    /**
     * @description Sends a reload of Verify’s answer back to the receipt page.
     *
     *     Nothing is checked here; the receipt page applies its own rules.
     */
    get: operations['evidenceReceiptVerifyReload'];
    put?: never;
    /**
     * @description Checks a receipt from its page in the console, and shows the result there.
     *
     *     It uses the same checker as the public archival verifier and says the result in the words of the public verify page. A receipt without a signed archival core, another workspace’s receipt and an unknown one get the same answer.
     *
     *     Advanced: The checker is POST /v1/receipts/verify-archival’s, run in process. Same-origin requests with the form field `csrf` only.
     */
    post: operations['evidenceReceiptVerify'];
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  '/app/evidence/records/{event_id}/pdf': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    /**
     * @description Downloads a receipt’s PDF from the console.
     *
     *     It is the same PDF as the receipt PDF API, for the signed-in workspace, and it is refused for the same reasons, each shown as a page. Someone who is not signed in is sent to the sign-in page.
     *
     *     Advanced: The API is GET /v1/evidence/records/{event_id}/pdf.
     */
    get: operations['evidenceRecordPdfDownload'];
    put?: never;
    post?: never;
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
    /**
     * @description Starts a no-signup trial, or adds a Session to one, and returns the Sess link to share.
     *
     *     - Without a key, it creates a trial and its first Session, and returns the trial key once, in the body.
     *     - With the trial key, it creates another Session in that trial.
     *     - Trial Sessions ask the person to answer; a trial has no webhook and sends nothing out.
     *     - A trial’s Sess link and answer window last 1 hour, and its result can be read for 24 hours after that.
     *     - A trial has at most 3 active Sessions and 10 Sessions in all, created within its first 24 hours.
     *
     *     Advanced: Send the trial key as `Authorization: Bearer <management credential>`. The trial creates interactive Sessions only (`mode` `interactive`). Each client can start 3 new trials, and the service 200, per rolling 24 hours. These limits are published and may change. Any other credential, or a trial key that is unknown, expired, revoked or tied to one Session, gets the not-found answer. An `Idempotency-Key` header is refused, because the trial key and the Sess link cannot be sent again.
     */
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
    /**
     * @description Reads a trial Session and the answers it received, with the trial key.
     *
     *     It can be read until its result is no longer available. Reading never uses up or changes anything.
     *
     *     Advanced: The end is the Session’s `result_available_until`. Another trial’s or workspace’s Session, an unknown, expired or revoked key, a Sess link and an owner key all get the same not-found answer.
     */
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
    /**
     * @description Creates a Session and returns the Sess link to send to the person.
     *
     *     - A display Session shows the person information.
     *     - An interactive Session asks the person to answer, with the components you send.
     *     - Sess refuses a component it does not know, and a field rule outside the supported subset.
     *     - The person opens the Sess link on any device; your agent reads the typed answer with this Session’s ID.
     *     - Sess deletes the Session’s content and answers after a retention period, and cancels webhook deliveries still waiting; a webhook already delivered is not recalled. The signed receipt stays and keeps verifying: receipts are kept without automatic expiry on every plan.
     *
     *     Advanced: Retention. The Sess link stays open 720 hours (30 days) after creation with the deployment owner key, and 168 hours (7 days) with a developer API key on the free plan. The Session’s content and accepted results are deleted 720 hours (owner key) or 168 hours (developer API key) after the earlier of its completion and the end of its link; after that every owner route answers that the Session is not found. The signed receipts of its accepted answers are kept and keep verifying.
     *
     *     Advanced: `expires_in` sets a shorter link, in seconds from creation: at least 30, at most the plan’s link lifetime. Retention then also ends sooner, because it counts from the earlier of completion and the end of the link. When the deployment enables link extensions, the person can extend an interactive link of 72,000 seconds (20 hours) or less up to ten times, never past a fixed horizon, which reading the Session returns as `action_expires_horizon`; the link then ends at that horizon, or at its deadline once no extension is left. The response’s `action_expires_at` is the stored deadline, the same value reading the Session returns.
     *
     *     Advanced: `invocation_id` ties the Session to the run of your registered agent that it serves; each receipt it issues then names that agent and its version in its signed archival core. The run must be in your workspace and still open; a run of another workspace is answered as an unknown one.
     *
     *     Advanced: An `Idempotency-Key` header is refused, because the Sess link is stored only as a hash and cannot be sent again. A display Session is `mode` `display` with a `data` source; an interactive Session is `mode` `interactive` with a `sess_surface` source and its components.
     *
     *     Advanced: Plan limits apply to developer workspaces. The monthly allowance is reached when the period’s resolved Sessions plus the admitted Sessions that can still resolve reach it (reason `monthly_allowance`); the active limit when the plan’s active Sessions are all live (reason `active_sessions`). Sessions already admitted keep their answers, completion and result delivery. GET /v1/account/usage has the numbers. With no `Authorization` header, the refusal’s message names the no-signup trial, POST /v1/trial/sessions; a wrong, revoked or expired key keeps the generic message.
     */
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
    /**
     * @description Reads a Session: its status, its current revision and every answer it accepted.
     *
     *     - Each answer names the revision it was given on.
     *     - Reading the same unchanged Session twice gives the same bytes.
     *     - Every Session carries its Sess link’s deadline; reading never extends it.
     *     - A developer API key can also read, and only read, the Sessions of trials its account claimed, each until its result is no longer available.
     *
     *     Advanced: An interactive Session returns `status`, the current revision, its `response_schema` and every accepted response bound to its revision. `action_expires_at` is the stored deadline. `link_state` is `live`, `lapsed` or `expired` at the time of the read; `action_expires_horizon` and `extensions_used` describe extensions. When the deployment enables link extensions, the person may extend an interactive link of 20 hours or less up to ten times, never past the fixed horizon.
     *
     *     Advanced: A lapsed link accepts no answer but can still be extended: the Session is still open, so keep waiting, or revoke the link for a hard end at the deadline. `extensions` lists every accepted extension in order: the old and new deadline, whether it was lapsed, and when; never an answer value.
     *
     *     Advanced: The `ETag` is the concurrency token for owner changes (the revision and the Event sequence), not a cache validator: it does not change with link timing. A claimed trial’s Session is readable until its `result_available_until`.
     */
    get: operations['getSession'];
    put?: never;
    post?: never;
    delete?: never;
    options?: never;
    head?: never;
    /**
     * @description Asks the person a follow-up question on the same Sess link.
     *
     *     It publishes the next revision of an interactive Session, whether the person answered or not; an unanswered revision is replaced. The Session is open again with the same ID and link, and an answer to an older revision is then refused.
     *
     *     Advanced: The Session may be `responded` or `active`, and returns to `active`. Every revision is immutable.
     */
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
    /**
     * @description Completes an interactive Session.
     *
     *     A completed Session accepts no more answers or revisions, and this cannot be undone. Send no body.
     */
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
    /**
     * @description Lists everything that happened in a Session, in order.
     *
     *     - Each accepted answer, with the revision it was given on, the action chosen and the typed data.
     *     - Each published revision, and the completion.
     *     - Events never change, and every accepted answer stays listed after later revisions and completion.
     *     - Every accepted extension of the Sess link is listed beside the events, never with an answer value.
     *     - A display Session has no events.
     *
     *     Advanced: Answers are `response.accepted` by `link_holder`, with the revision, `action_id` and the data; `revision.published` and `session.completed` are by `owner`. Event IDs and sequence numbers never change. The list is not paginated: a Session has a few Events per round. `link_extensions` lists each extension’s old and new deadline, whether it was asked for after the deadline, and when. Responses are sent with `Cache-Control: no-store, no-transform`.
     */
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
    /**
     * @description Reads one revision of a Session exactly as it was stored.
     *
     *     You get what the person saw and, for an interactive Session, the schema their answers to that revision were checked against. A revision never changes.
     *
     *     Advanced: Responses are sent with `Cache-Control: no-store, no-transform`.
     */
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
    /**
     * @description Records the person’s answer from the Sess link page.
     *
     *     - Only the page itself can send it; anything sent from another site is refused.
     *     - Sess checks the action and the answer against the exact revision the person answered.
     *     - An accepted answer comes with a signed receipt, and the page then shows the Session as it is: waiting for your agent, its next question, or done.
     *     - A refused answer shows the page again, keeping what the person typed so they can send it again.
     *     - The Sess link is the person’s key to the page; never log it.
     *
     *     Advanced: Accepted are requests with `Sec-Fetch-Site: same-origin` or an `Origin` equal to the public origin; with only `Origin: null` or `Sec-Fetch-Site: none`, as Safari sends under no-referrer, only with the page’s form token, bound to a browser cookie. A foreign `Origin`, a cross-site or same-site `Sec-Fetch-Site`, or neither header is always refused. The server resolves `action_id` from the stored revision and checks the data against its `response_schema`. The receipt is stored with its Event and returned by reading the Session and its Event log. Sending the same `client_event_id` with the same request answers with the original Event and receipt, never signed again. A refusal is an HTML page whose stable code is in its `data-error-code` attribute.
     *
     *     Advanced: Success is a 303 to the same link path, relative, with no query: never an Event ID, a receipt or submitted data. Sess links created from 30 October 2026 are /n/{token} with a 22-character token, and every /s/{token} operation is served at /n/{token} the same way; /s/{token} keeps serving the 43-character links created before, and each path answers the generic not-found page for the other length.
     */
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
    /**
     * @description Gives the person more time to answer, from Need more time? on the Sess link page.
     *
     *     - It works on a link of 20 hours or less, when the deployment enables link extensions.
     *     - Each extension adds the link’s original lifetime, at most 1 hour, up to ten times, never past a fixed horizon.
     *     - A link that is past its deadline but not past the horizon can still be extended, from now.
     *     - Sending the same request again is never counted twice.
     *     - It never records an answer, completes the Session or signs a receipt, and never stores or logs what the person typed; it only shows the same form again with their values.
     *     - The Sess link is the person’s key to the page; never log it.
     *
     *     Advanced: It is the answer form’s second button, so the body is the form’s own entries without `action_id`, and it is accepted from the page itself only, as the answer is. While the link is live the deadline (`action_expires_at`) moves to the earlier of the horizon and the deadline plus one step; while it is lapsed, to the earlier of the horizon and now plus one step; the step is the earlier of the original lifetime and 1 hour. A repeated `client_event_id` is answered as the original.
     */
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
    /**
     * @description Starts “Keep your receipt” on the Sess link page, the first of two steps.
     *
     *     - The page’s own script sends it after the person taps Keep.
     *     - Each round is covered only by its own Keep permission; nothing else covers it.
     *     - Sess reads the Session at one moment and, when a covered receipt has no holder yet, records a challenge for exactly those receipts, for 5 minutes.
     *     - The Sess link is the person’s key to the page; never log it.
     *
     *     Advanced: The format is in the Sess keep-v1 specification. The request must be same-origin: `Sec-Fetch-Site: same-origin` or an `Origin` equal to the page’s; with only `Origin: null` or `Sec-Fetch-Site: none`, the JSON content type alone, since a cross-origin JSON request needs a CORS preflight, which is never granted. JSON, at most 65536 bytes and 128 grants. Each grant is receipt-scoped: the Session, a list of receipts or another round’s grant never authorize a round. The snapshot is the Session’s Event sequence cutoff. Every /s/ response is no-store, no-referrer and noindex, with no CORS.
     */
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
    /**
     * @description Gives the person their kept conversation: one file with every round they may keep, its receipt and how well it is preserved.
     *
     *     - Every covered, answered round of the Session up to the snapshot, with its unchanged receipt and bundle, or a note that the content is gone once deleted.
     *     - Each round’s witness status at the snapshot, with the evidence attached by then, and its holder status.
     *     - With the person’s new holder keys, Sess first records them as holders of those receipts; if that is not possible, the file is still exported, marked unenrolled.
     *     - The file never holds a private key, a permission secret or the Sess link.
     *     - The checks are those of the first step, and the Sess link is the person’s key to the page; never log it.
     *
     *     Advanced: The format is in the Sess keep-v1 specification: one bounded, versioned file with an inventory, sent as an attachment. With `enrollment`, one fresh holder key per receipt of the challenge’s exact batch is enrolled, or only its final receipt, the disclosed fallback. Every proof is checked, then every enrollment and the use of the challenge commit together. The same request again is replayed safely and a different one refused; a receipt keeps its first holder, and a key holds one receipt. Without `enrollment` (when key generation or storage failed, or there is nothing to enrol) every round is marked unenrolled: exporting never depends on enrolling.
     *
     *     Advanced: With `format: pdf`, the answer is the receipt PDF of the same snapshot, with an ASCII `filename` and the exact `filename*` in `Content-Disposition` and the header `Sess-Keep-Summary` (`rounds=<n>; coverage=<every_accepted_round|partial>; unenrolled=<0|1>`), or the JSON file when it falls outside what the PDF can show.
     */
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
    /**
     * @description Starts Save to Sess from a Sess link page on another site than the personal one.
     *
     *     - The page’s own script sends it: at the tap on Save to Sess, or once the Save sheet is signed in.
     *     - It records a claim for the rounds the person’s Keep permissions cover now, exactly as Keep reads them; restricted or deleted rounds are never included.
     *     - The claim lasts 5 minutes, and nothing is saved until the signed-in Save sheet finishes it.
     *     - The Sess link is the person’s key to the page; never log it.
     *
     *     Advanced: The format is in the Sess personal-copies-v1 specification §7. On a form-2 page the claim is made at the tap, with no destination binding; otherwise once the sheet on the personal origin is signed in and has sent its destination binding. A claim without one is bound by the signed-in sheet through POST /personal/save/destination before it can be redeemed. The request must be same-origin as for Keep, JSON, at most 65536 bytes, and is rate limited per link. The claim holds the rounds and their cutoff, chosen by the server (no client-chosen IDs), a fresh 256-bit transfer secret stored as its hash, the purpose, the personal origin, the source verifier’s challenge and the destination binding when one is given. Every /s/ response has the same headers.
     */
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
    /**
     * @description Tells the Sess link’s waiting page whether something changed.
     *
     *     - It returns only the current revision and the state as the person sees it: no owner data, events, receipts, answers or content.
     *     - Nothing is written or used up.
     *     - The waiting page asks about every 4 seconds and reloads the link once the revision or the state changes.
     *     - A page with a form asks about every 25 seconds while it is visible, only to keep its connection alive, and ignores the answer.
     *     - The Sess link is the person’s key to the page; never log it.
     *
     *     Advanced: Every /s/ response is sent with `Cache-Control: no-store`, `Referrer-Policy: no-referrer` and `X-Robots-Tag: noindex, nofollow`, with no CORS.
     */
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
    /**
     * @description Reads the workspace’s plan and how much of it is used this month.
     *
     *     - The plan, the resolved Sessions used in the current period, the next reset and the active Sessions.
     *     - A warning at 80% and at 100% of the allowance.
     *     - Reading changes nothing, apart from recording when the API key was last used.
     *
     *     Advanced: A resolved Session is one you completed after at least one accepted answer, whose final result your webhook endpoint accepted, or you fetched in full with an owner credential (a read or completion response), before its delivery deadline: completion plus the Session’s retention. It counts once, in the period it qualifies. Periods are monthly from the workspace’s billing anchor, its creation on the free plan. Each interactive Session admitted that can still qualify reserves one unit, so admitted work always fits the allowance. A workspace without a plan, as with the deployment owner key, gets the not-found answer.
     */
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
    /**
     * @description Opens a payment page to move the workspace to a paid plan.
     *
     *     - You name only the plan; the price is the one Sess approved for it.
     *     - While a payment page for this plan is open, every request, at once or retried, returns the same one.
     *     - A workspace that already pays changes plan in place and gets no new payment page.
     *     - Coming back from the payment page grants nothing: the plan changes only when the payment provider confirms it is paid, and the usage page says processing until then.
     *
     *     Advanced: A payment page for the other plan is ended first, so at most one is payable; it is replaced only after the provider confirms its expiry. A paid page holds the workspace until its subscription is recorded. The confirmation is the provider’s signed subscription state.
     */
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
    /**
     * @description Receives the payment provider’s signed events. Only the provider calls it.
     *
     *     - The signature is checked over the exact body before anything is read.
     *     - Each event is handled once; a repeat is acknowledged and changes nothing.
     *     - An older subscription state never replaces a newer one, and unknown event types are acknowledged and ignored.
     *
     *     Advanced: The format is in the Sess billing-provider-v1 specification. The body may be at most 256 KiB, and its timestamp within 300 seconds. A deployment without a billing provider answers not found.
     */
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
    /**
     * @description Reads your webhook: its address, the signing secrets in use and how deliveries are going.
     *
     *     Secrets are shown by their key IDs only. You see delivery counts and how long the oldest waiting delivery has waited.
     */
    get: operations['getWebhook'];
    /**
     * @description Sets the address where Sess sends your workspace’s answers.
     *
     *     - A workspace has one webhook address; a new one replaces the old.
     *     - Deliveries waiting for the old address are not moved: they fail, and you can redeliver them.
     *     - The address receives nothing until you verify it.
     *     - The first registration also creates the signing secret, which is returned once.
     *
     *     Advanced: The waiting deliveries fail as `endpoint_unavailable`. The service answers unavailable while its data-encryption keys are not set up.
     */
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
    /**
     * @description Proves you control your webhook address, so Sess can send to it.
     *
     *     - Sess sends a fresh random challenge to the exact address; it is verified when it sends the challenge back.
     *     - Verification lasts 30 days, and verifying again renews it.
     *     - An expired verification counts as waiting: nothing new is sent, and queued deliveries fail.
     *     - Sess looks the host up on every connection and never connects to a non-public address.
     *
     *     Advanced: The challenge is sent through the delivery egress policy. The expiry is `verification_expires_at`. Queued deliveries fail as `endpoint_unavailable`.
     */
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
    /**
     * @description Creates a new signing secret for your webhook, returned once.
     *
     *     The previous secret keeps signing for 24 hours, so deliveries carry both signatures until then.
     */
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
    /**
     * @description Lists every webhook delivery of a Session’s answers, with every attempt.
     *
     *     Each attempt shows its outcome and HTTP status, including failures that will not be retried and deliveries that ran out of retries.
     */
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
    /**
     * @description Sends an accepted answer to your webhook again.
     *
     *     - It goes to your current, verified address, with a fresh set of retries.
     *     - The message is the same bytes as before, with the same event ID and receipt.
     *     - If a delivery of this answer to the current address is already waiting, you get that one instead.
     *     - One waiting for an address you replaced is ended, and a new one is queued.
     *
     *     Advanced: The ended delivery fails as `endpoint_unavailable`.
     */
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
    /**
     * @description Exports one accepted answer as a bundle anyone can verify.
     *
     *     - The bundle holds the receipt exactly as issued, everything the person saw on that revision, the answer, and the current public receipt keys.
     *     - It never holds a private key, an owner credential or the Sess link.
     *     - Anyone with the bundle can verify it, with the verify API or offline with trusted keys, so share it only with whom you mean to show the decision.
     *     - Reading changes nothing, apart from recording when the API key was last used.
     *
     *     Advanced: The format is bundle-v1, in the Sess bundle-v1 specification, with the complete normalized Surface of the revision. Online verification is POST /v1/receipts/verify. A restricted receipt discloses nothing until it is unrestricted; a deleted one leaves only its tombstone. Responses are sent with `Cache-Control: no-store, no-transform` and `Referrer-Policy: no-referrer`.
     */
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
    /**
     * @description Checks a bundle against this server’s own receipt keys. No credential needed.
     *
     *     - It checks the receipt, then that what the person saw and answered matches the receipt.
     *     - It uses only this server’s issuer and published keys, never keys in the bundle, at the current time.
     *     - It looks nothing up and stores nothing.
     *     - The context the bundle declares is checked only against itself, so check the event, Session and workspace you expect in your own application.
     *     - A valid result means the issuer accepted this answer from someone holding the Sess link. It never names a person or proves that anything was done.
     *     - An invalid bundle is still a 200 result, with the reason.
     *
     *     Advanced: The receipt is checked by the receipt-v1 rules, and the disclosed Surface and input against the receipt’s hashes; `context` and `application_purpose` are therefore `unchecked`, and an invalid bundle has `valid: false`. The body is JSON, at most 2097152 bytes, and the canonical bundle at most 1 MiB (reason `oversized`). Requests are rate limited per client and in total. An absolute 2-second deadline runs from the request’s arrival, receiving the body included; a request not answered by then gets the unavailable answer with `Connection: close`, and the connection is closed. Responses are sent with `Cache-Control: no-store, no-transform` and `Referrer-Policy: no-referrer`, with CORS only for the product site’s origins. Never put a bundle or a receipt in an address.
     */
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
    /**
     * @description Checks a receipt’s archival envelope against this server’s own keys and settings. No credential needed.
     *
     *     - Nothing in the request is trusted.
     *     - It reports each part of the check on its own: signature, contents, context, witness, key trust and live expiry, with the same statuses and reasons as the SDK’s archival verifier, and how to present them.
     *     - The envelope carries no content, so contents are reported as unverifiable; to check content, verify a bundle instead.
     *     - It looks nothing up and stores nothing, and a malformed or oversized envelope is still a 200 result.
     *
     *     Advanced: The format is in the Sess archival-core-v1 specification §3, and the dimensions are those of §5: `signature`, `contents`, `context`, `witness`, `key_trust` and `live_expiry`. It uses the successor archival verifier with this server’s published receipt keys, its receipt issuer as the expected context issuer, its published witness key set (/.well-known/sess-witness-keys.json) and, when set up, its TUF-verified witness trusted root. `contents` is `content_unavailable`, and `context` is at most incomplete (`application_context_unchecked`). Without a witness trusted root, attached evidence is indeterminate (`witness_trust_unavailable`). The SDK verifier is `@sess.si/sdk/archival`; the bundle check is POST /v1/receipts/verify and is unchanged.
     *
     *     Advanced: The body is JSON, at most 2097152 bytes, and the envelope at most 65,536 bytes (reason `oversized`). It shares the bundle check’s rate limits per client and in total, and its absolute 2-second deadline from arrival, after which the connection is closed with `Connection: close`. Responses are sent with `Cache-Control: no-store, no-transform` and `Referrer-Policy: no-referrer`, with CORS only for the product site’s origins. Never put an envelope or a receipt in an address.
     */
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
    /**
     * @description Lists your workspace’s agents, with how many runs each started and completed.
     *
     *     Only you see the counts.
     */
    get: operations['listTargets'];
    put?: never;
    /**
     * @description Registers your agent, as an HTTP endpoint, so people can start it.
     *
     *     - It needs an https endpoint on port 443, a versioned capability with a bounded input schema, who may start it and for how long, and a budget.
     *     - People can start it only after you verify your domain.
     *     - Only an owner credential can register or change an agent; a Sess link, a trial key or a probe credential cannot.
     *     - An optional idempotency key makes a retry safe: the same request returns the agent as first registered.
     *
     *     Advanced: The body sets `type` `http` explicitly; the endpoint has no user info or fragment, and an IP address must be public. The grant policy names the audience origins and the grant lifetime; `enabled` is optional. The workspace comes from the credential only. The key is the `Idempotency-Key` header. An endpoint is refused with reason `not_https`, `port`, `credentials`, `fragment`, `non_public_address`, `malformed` or `too_long`; a capability with `not_object`, `unsupported_keyword`, `too_deep`, `too_large`, `does_not_compile` or `not_a_schema`; and a body with an unsupported `type`, an unknown field or a malformed `Idempotency-Key`.
     */
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
    /**
     * @description Reads one of your agents, with its versions, its verification and its counts.
     *
     *     Only you see the counts.
     */
    get: operations['getTarget'];
    put?: never;
    post?: never;
    delete?: never;
    options?: never;
    head?: never;
    /**
     * @description Turns your agent on or off, or changes its capability, who may start it, or its budget.
     *
     *     - Changing the capability, the grant policy or the budget makes a new version.
     *     - Turning it off refuses new starts at once and fails runs admitted but not yet sent.
     *     - A new version makes older start grants out of date and fails runs admitted but not yet sent.
     *     - Runs already sent are not recalled.
     *
     *     Advanced: Runs failed by turning it off end as `target_disabled`, and by a new version as `stale_binding`. A start with an out-of-date grant is refused as a version conflict.
     */
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
    /**
     * @description Chooses whether your agent has a public card that anyone can start, and what the card says.
     *
     *     - Set its name, whether it is shared (off by default), its title, your description, where its data comes from, and whether a finished run offers "Ask this agent again".
     *     - The title is the card’s heading and the run page’s; the name is only the address. Sharing needs both.
     *     - Sharing is not part of the agent’s version: the version does not change, and admitted runs carry on.
     *     - The card exists only while the agent is shared, on and verified, accepts the site among those who may start it, and takes an empty input.
     *     - Unsharing or turning the agent off removes the card at once, and starts from the card are refused while the agent is not shared.
     *     - Start and completion counts stay visible only to you.
     *
     *     Advanced: The card is at /a/{name} and answers not found when any of the conditions fails. The site origin must be in the grant policy’s audiences. The counts are `TargetResponse.counts`.
     */
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
    /**
     * @description Verifies that you control your agent’s domain.
     *
     *     - Sess fetches a verification document from your endpoint’s site, following no redirect and never connecting to a non-public address.
     *     - The agent is verified for 30 days when the document names this agent and its verification token.
     *     - Your agent’s endpoint itself is never called.
     *
     *     Advanced: The document is /.well-known/sess-target/{id}.json, a JSON `TargetVerificationDocument` naming this `target_id` and its token, fetched through the egress safeguards, which also refuse rebound addresses.
     */
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
    /**
     * @description Issues a start grant: a secret that lets one site start your agent.
     *
     *     The grant is tied to your workspace, this agent, its current version and capability, and one of the sites your grant policy allows, and it expires after the policy’s lifetime. The secret is returned once.
     *
     *     Advanced: The grant is 256 bits and stored only as a hash.
     */
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
    /**
     * @description Revokes a start grant at once.
     *
     *     Revoking twice is the same as once. Runs the grant already started carry on, and stay visible with their participant credential.
     */
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
    /**
     * @description Starts a run of an agent, with a start grant.
     *
     *     - Sess checks the grant and the agent, validates the input, reserves the limits, records the run and queues it to be sent, all in one step.
     *     - The agent, its endpoint, capability and policy come only from the grant; any other field is refused.
     *     - Sending the same request again returns the same run and the same participant credential.
     *     - Opening an address never starts work.
     *
     *     Advanced: The grant must be live, unrevoked and sent from its audience `Origin`; the agent enabled, verified and at the grant’s version and capability. A run is recorded with its request identity and an audit event. The same `request_id` and body returns the same run (200); a different body with the same `request_id` is a conflict. Initial limits: 10 active runs in total and per workspace, 1 per grant, 10 starts per client per 24 hours, and the agent’s own budget; a run lasts at most 15 minutes, and its input at most 4 KiB. An operator switch can refuse every start (reason `admission_disabled`). An agent whose workspace is at its plan limit starts nothing new (reason `workspace_paused`); its admitted runs finish.
     */
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
    /** @description Reads a run’s status and, once it completed, its result. */
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
    /**
     * @description Cancels a run that is still going.
     *
     *     Cancelling twice is the same as once. A run not yet sent is never sent, and an answer the agent sends later is recorded as late and never used.
     */
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
    /**
     * @description Records your agent’s result for a run Sess sent it.
     *
     *     Send it with the callback credential of that run, naming the same run and agent version. A finished run never reopens: a late result is refused.
     *
     *     Advanced: The body names the same `invocation_id` and `target_version`.
     */
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
    /**
     * @description Lists your workspace’s receipts, newest first, as details only.
     *
     *     - By default, receipts in archival custody, in the workspace’s order; or only the receipts held unverified, by when the answer was accepted.
     *     - A list never carries a receipt, a question or an answer.
     *     - Filter by agent, or by when the answer was accepted.
     *     - Every answer says it covers the records issued in the range you asked for, never a complete history.
     *
     *     Advanced: The workspace comes from the credential only. `custody=exception` lists the receipts held unverified. `target_id` matches records whose archival core names that agent; records with no agent never match. `accepted_from` and `accepted_to` bound the acceptance time. Every answer is labelled "issued records in this defined scope/range" with `complete_history` false. Pages continue with `next_cursor`. Responses are sent with `Cache-Control: no-store, no-transform`.
     */
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
    /**
     * @description Exports one range of your workspace’s receipts as a file, with everything needed to check them.
     *
     *     - Name one range, by sequence number or by when the answers were accepted.
     *     - Each record carries its exact receipt, its archival envelope and its preservation status.
     *     - What the person saw and answered is included only while it is still kept; after that the record says it was deleted, and it is never rebuilt.
     *     - Receipts held unverified are labelled so.
     *     - The file says what it discloses, and that it covers the range asked for, never a complete history; its content is never logged.
     *
     *     Advanced: The range is both `from_sequence` and `to_sequence` (archival), or both `accepted_from` and `accepted_to`. An export holds at most `limit` records (at most 100) and 8 MiB; a range beyond either is cut short, and `range.next_cursor` continues it. The envelope is the signed core and its preservation evidence. Deleted content reads `{status: unavailable, reason: purged}`. The scope label is "issued records in this defined scope/range". The file is an attachment named from the workspace, the custody and the range only. A workspace can export 6 times per 10 minutes.
     */
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
    /**
     * @description Tells you whether one of your receipts is available, restricted or deleted, never its content.
     *
     *     - A restricted receipt shows why and since when; a deleted one shows why and when.
     *     - A restricted or deleted receipt is left out of the list, the export, its bundle and every other receipt fetch; a restricted one can still be verified, so its preservation can be checked.
     *     - Sess decides restriction, holds and deletion through a recorded procedure; holds are not shown here.
     *     - Deleting never recalls copies already exported or kept by people, and the public witness commitment remains.
     *
     *     Advanced: The workspace comes from the credential only. The reason is a code. The procedure is in the Sess custody-restriction-deletion-v1 specification, and the operator applies it. The witness commitment is an aggregate batch root. Another workspace’s record, or an unknown event ID, gets the not-found answer. Responses are sent with `Cache-Control: no-store, no-transform`.
     */
    get: operations['getEvidenceRecordStatus'];
    put?: never;
    post?: never;
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  '/v1/evidence/records/{event_id}/pdf': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    /**
     * @description Downloads the receipt PDF of the Session one of your receipts belongs to.
     *
     *     - It is the same document the person keeps from the Sess link, with every answered round of that Session and its signed record attached.
     *     - Fetch it once and store it with your own records.
     *     - After the Session’s retention ended, its receipts still make the PDF, and each round reads "Answers deleted".
     *     - Other rounds that are restricted or deleted are left out.
     *     - A Session too large for a PDF is returned as its record, whole.
     *
     *     Advanced: The workspace comes from the credential only. The record is returned as JSON when the Session falls outside what the PDF can show. Another workspace’s record, or an unknown event ID, gets the not-found answer. A workspace can download 30 per minute, shared with the console’s download. Responses are sent with `Cache-Control: no-store, no-transform`.
     */
    get: operations['getEvidenceRecordPdf'];
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
    /**
     * @description Publishes the public keys that verify Sess receipts. No credential needed.
     *
     *     You get the active signing key and every key still kept from a rotation. Verify a receipt with the key its header names, and expect the issuer and audience below.
     *
     *     Advanced: The keys are a JWK Set (Ed25519, `alg` EdDSA). A receipt is a compact JWS (`typ` `sess-receipt+jwt`); its protected header’s `kid` names its key. The expected issuer is the deployment’s configured receipt issuer, otherwise the origin of its public address. The expected audience is the Session’s actual workspace, from configuration you trust independently or from the `Sess-Workspace-Id` header on an authenticated owner create or read. A claimed trial keeps its original workspace. The service answers unavailable while the receipt keys are not set up. Responses are sent with `Cache-Control: no-store, no-transform`.
     */
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
    /**
     * @description Publishes the signed list of renderers that Sess signs receipts under. No credential needed.
     *
     *     - A receipt verifies when its renderer is on a list whose signature verifies.
     *     - Each edition of the list has a higher number than the last; order the lists by it, and use containment as the cross-check. An older list still proves what it contains.
     *     - The list only grows: a renderer is never removed, reordered or reused, so every receipt issued keeps verifying.
     *
     *     Advanced: The list is one JWS signed with the receipt keys, in the RFC 7515 flattened JSON serialization `{protected, payload, signature}`; joined with dots, the parts are its compact form. The protected header is `{alg EdDSA, kid, typ sess-renderer-identities+jwt}`. The payload is RFC 8785 canonical JSON: `sess_renderer_identities: 1`, `iss` (the receipt issuer), `seq` (the edition, an integer), `iat` (when this copy was signed, a NumericDate) and `identities`, each a `renderer_version` with `since`, the UTC date it was added. The signature covers `seq` and `iat`. A receipt’s renderer is its `surface.renderer_version`. Verify the list with the receipt keys, GET /.well-known/sess-receipt-keys.json (the key its `kid` names) and the expected issuer. `sess-html-form-1` is always on it. The rules are in the Sess receipt-v1 specification §10. The service answers unavailable while the receipt keys are not set up. Responses are sent with `Cache-Control: no-store, no-transform`.
     */
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
    /**
     * @description Publishes the public keys that sign Sess’s witness checkpoints. No credential needed.
     *
     *     - Each key comes with the window when it was valid; the current key’s window has no end.
     *     - A key that was rotated out stays, with its closed window, so the evidence it signed stays verifiable.
     *     - Public keys only. With no witness key set up the set is empty; a set that is set up but unusable is never trimmed or served empty.
     *
     *     Advanced: The format is in the Sess witness-evidence-v1 specification §5.1: ECDSA P-256 keys, the current one with `valid_to` null. Read the set with `parseWitnessKeySet` and pass it as the `witnessKeys` anchor of `verifyWitnessEvidence`, beside a trusted root distributed independently. Responses are sent with `Cache-Control: no-store, no-transform`.
     */
    get: operations['witnessKeys'];
    put?: never;
    post?: never;
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  '/': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    /**
     * @description Tells an agent where to start on the API host. No credential needed.
     *
     *     It points to this document, the docs, the docs' llms.txt and the no-signup trial, which needs no key.
     *
     *     Advanced: The trial is POST /v1/trial/sessions with no `Authorization` header. Responses are sent with `Cache-Control: no-store`.
     */
    get: operations['apiRoot'];
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
    /**
     * @description Returns this document.
     *
     *     It is generated from the running artifact’s contract and checked for drift on every change.
     */
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
    /**
     * @description Tells you the process is running.
     *
     *     It calls nothing else.
     *
     *     Advanced: Responses are sent with `Cache-Control: no-store`.
     */
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
    /**
     * @description Tells you the service is ready to serve, checked within a time bound.
     *
     *     - The owner key and the receipt signing keys are set up and usable.
     *     - The build identity is complete and valid.
     *     - The database answers, and every migration shipped with the artifact is applied.
     *     - Requests at the same moment share one check; the next request after it finishes runs a new one.
     *     - It never migrates, never calls a telemetry service, and is never cached.
     *
     *     Advanced: A complete build identity means `git_sha`, `build_id` and `build_time` are all non-null in /version. Query parameters are ignored. Responses are sent with `Cache-Control: no-store`.
     */
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
    /**
     * @description Returns the build identity of the running service, which is not secret.
     *
     *     It answers even when the service is not ready. A part of the identity that was not supplied, or is not valid, is null, and any null makes the service not ready.
     *
     *     Advanced: `git_sha`, `build_id` and `build_time` are each null when missing or invalid; `git_sha` when the deployment’s git SHA is missing, empty or malformed, and `build_time` also while it is more than 5 seconds in the future, checked on every request. Responses are sent with `Cache-Control: no-store`.
     */
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
  askClosed: {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get?: never;
    put?: never;
    /** @description Sent once when an Ask closes at its last place or by your close, while the workspace has a verified endpoint. Signed, retried and delivered at least once exactly as responseAccepted is; webhook-id = event_id. An Ask that passes its deadline sends nothing: read it with GET /v1/asks/{id}. */
    post: operations['webhookAskClosed'];
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
            /**
             * @description Advanced. Optional BCP 47 locale for formatting the amounts on this page, one per Surface (default: the page’s language, en). It does not translate the page.
             * @example en-CA
             */
            locale?: string;
            /** @description Advanced. Optional position in a sequence of questions: integers with 1 ≤ step ≤ total ≤ 20. The person sees it as a small counter ("1/2"). Anything else fails with 400 INVALID_SCHEMA. */
            progress?: {
              step: number;
              total: number;
            };
            source: {
              /** @constant */
              kind: 'sess_surface';
              /** @description The page's content, in order. How the page lays it out: Fields keep the order you send them in. Consecutive fields share one group; a heading or a text starts a new one. Each label sits beside its answer, or above it when the two do not fit, so keep it to a word or two (about 20 characters). A field's help shows under that field; give it only when it is needed. Keep choice labels short, and put any detail the decision needs in a text or record on the page: a phone's picker may cut a long choice short. Nothing is truncated: rows grow to fit their text. */
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
        /**
         * @description Advanced. Optional BCP 47 locale for formatting the amounts on this page, one per Surface (default: the page’s language, en). It does not translate the page.
         * @example en-CA
         */
        locale?: string;
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
                /** @description A rating is a field with rating and the schema exactly {"type": "integer", "minimum": 1, "maximum": N}, N from 2 to 10 (title and description allowed); any other schema fails with 400 INVALID_SCHEMA. The person sees stars when N is 5 or less, numbered choices above it; the result is the chosen integer. low and high are optional words shown at the two ends of the scale. */
                rating?: {
                  low?: string;
                  high?: string;
                };
                /** @description The field value schema, JSON Schema 2020-12 restricted to: type string (minLength, maxLength, enum), number or integer (minimum, maximum, exclusiveMinimum, exclusiveMaximum), boolean, or array of string enum IDs (items {type: string, enum}, minItems, maxItems, uniqueItems: true). title and description are allowed on the field value schema itself; array items permit only type and enum. With rating, exactly {type: integer, minimum: 1, maximum: 2–10}. Any other keyword fails with INVALID_SCHEMA. */
                schema: {
                  [key: string]: unknown;
                };
                /** @description The proposed value shown to the person (a correction is a field with a proposed value). It must be valid against the field schema. */
                value?: unknown;
              }
            | {
                /** @constant */
                type: 'items';
                label?: string;
                /**
                 * @description ISO 4217 alphabetic code with known minor units (CAD, JPY, BHD …); one per component.
                 * @example CAD
                 */
                currency: string;
                /** @description The person may choose rows: one (radios) or many (checkboxes). Needs name; the result carries the chosen row indices in selected. */
                select?: 'one' | 'many';
                /** @description The person may change the quantity of rows that carry one. Needs name and an action with intent request_change; a changed quantity is sent only with that action. The result carries quantities, one per row (null for a row without one). */
                editable?: 'quantity'[];
                name?: string;
                /** @description 1 to 100 rows, in order; more fail with 400 INVALID_SCHEMA (never truncated). */
                rows: {
                  name: string;
                  detail?: string;
                  /** @description An editable quantity (only with editable ["quantity"]): the person may change it within min (default 0) and max; Sess never recomputes the amount, your agent does on its next revision. The result carries the quantities. */
                  quantity?: {
                    value: number;
                    unit?: string;
                    min?: number;
                    max?: number;
                  };
                  /** @description The line amount in minor units, or null for a line with no amount. */
                  amount: number | null;
                }[];
                /** @description Up to 8 totals lines, in order, as you state them. */
                totals?: {
                  label: string;
                  /** @description The amount in minor units, as stated. */
                  amount: number;
                  /** @description subtotal (at most one) must equal the sum of the rows; total (at most one), with a subtotal, must equal the subtotal plus the other lines except paid, due and included. */
                  role:
                    | 'subtotal'
                    | 'tax'
                    | 'discount'
                    | 'shipping'
                    | 'fee'
                    | 'tip'
                    | 'paid'
                    | 'due'
                    | 'adjustment'
                    | 'total'
                    | 'other';
                  /** @description Already included in the prices (such as VAT): shown, never added. Not on a subtotal or total. */
                  included?: boolean;
                }[];
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
        /**
         * @description Advanced. Optional BCP 47 locale for formatting the amounts on this page, one per Surface (default: the page’s language, en). It does not translate the page.
         * @example en-CA
         */
        locale?: string;
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
                /** @description A rating is a field with rating and the schema exactly {"type": "integer", "minimum": 1, "maximum": N}, N from 2 to 10 (title and description allowed); any other schema fails with 400 INVALID_SCHEMA. The person sees stars when N is 5 or less, numbered choices above it; the result is the chosen integer. low and high are optional words shown at the two ends of the scale. */
                rating?: {
                  low?: string;
                  high?: string;
                };
                /** @description The field value schema, JSON Schema 2020-12 restricted to: type string (minLength, maxLength, enum), number or integer (minimum, maximum, exclusiveMinimum, exclusiveMaximum), boolean, or array of string enum IDs (items {type: string, enum}, minItems, maxItems, uniqueItems: true). title and description are allowed on the field value schema itself; array items permit only type and enum. With rating, exactly {type: integer, minimum: 1, maximum: 2–10}. Any other keyword fails with INVALID_SCHEMA. */
                schema: {
                  [key: string]: unknown;
                };
                /** @description The proposed value shown to the person (a correction is a field with a proposed value). It must be valid against the field schema. */
                value?: unknown;
              }
            | {
                /** @constant */
                type: 'items';
                label?: string;
                /**
                 * @description ISO 4217 alphabetic code with known minor units (CAD, JPY, BHD …); one per component.
                 * @example CAD
                 */
                currency: string;
                /** @description The person may choose rows: one (radios) or many (checkboxes). Needs name; the result carries the chosen row indices in selected. */
                select?: 'one' | 'many';
                /** @description The person may change the quantity of rows that carry one. Needs name and an action with intent request_change; a changed quantity is sent only with that action. The result carries quantities, one per row (null for a row without one). */
                editable?: 'quantity'[];
                name?: string;
                /** @description 1 to 100 rows, in order; more fail with 400 INVALID_SCHEMA (never truncated). */
                rows: {
                  name: string;
                  detail?: string;
                  /** @description An editable quantity (only with editable ["quantity"]): the person may change it within min (default 0) and max; Sess never recomputes the amount, your agent does on its next revision. The result carries the quantities. */
                  quantity?: {
                    value: number;
                    unit?: string;
                    min?: number;
                    max?: number;
                  };
                  /** @description The line amount in minor units, or null for a line with no amount. */
                  amount: number | null;
                }[];
                /** @description Up to 8 totals lines, in order, as you state them. */
                totals?: {
                  label: string;
                  /** @description The amount in minor units, as stated. */
                  amount: number;
                  /** @description subtotal (at most one) must equal the sum of the rows; total (at most one), with a subtotal, must equal the subtotal plus the other lines except paid, due and included. */
                  role:
                    | 'subtotal'
                    | 'tax'
                    | 'discount'
                    | 'shipping'
                    | 'fee'
                    | 'tip'
                    | 'paid'
                    | 'due'
                    | 'adjustment'
                    | 'total'
                    | 'other';
                  /** @description Already included in the prices (such as VAT): shown, never added. Not on a subtotal or total. */
                  included?: boolean;
                }[];
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
        /** @description The Ask this respondent Session belongs to: on its `response.accepted` and `session.completed` only. */
        ask_id?: string;
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
          /** @description base64url of the 64-byte ECDSA P-256 SHA-256 signature (IEEE P1363) over the holder proof message (the Sess keep-v1 specification §3). */
          proof: string;
        }[];
      };
    };
    /** @description The kept conversation (the Sess keep-v1 specification): every authorized accepted round of the Session through the snapshot cutoff, each with its unchanged receipt-v1, its bundle-v1 while the content is retained (else unavailable, never reconstructed), its preservation status and holder status, plus an inventory. No private key, grant secret or Sess link. Each extracted bundle verifies with the unchanged bundle-v1 verifier. */
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
              /** @description The archival envelope (the Sess archival-core-v1 specification). */
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
      /** @description Present only when the Session is a respondent of an Ask (POST /v1/asks). */
      ask_id?: string;
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
        /**
         * @description Advanced. Optional BCP 47 locale for formatting the amounts on this page, one per Surface (default: the page’s language, en). It does not translate the page.
         * @example en-CA
         */
        locale?: string;
        /** @description Advanced. Optional position in a sequence of questions: integers with 1 ≤ step ≤ total ≤ 20. The person sees it as a small counter ("1/2"). Anything else fails with 400 INVALID_SCHEMA. */
        progress?: {
          step: number;
          total: number;
        };
        source: {
          /** @constant */
          kind: 'sess_surface';
          /** @description The page's content, in order. How the page lays it out: Fields keep the order you send them in. Consecutive fields share one group; a heading or a text starts a new one. Each label sits beside its answer, or above it when the two do not fit, so keep it to a word or two (about 20 characters). A field's help shows under that field; give it only when it is needed. Keep choice labels short, and put any detail the decision needs in a text or record on the page: a phone's picker may cut a long choice short. Nothing is truncated: rows grow to fit their text. */
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
           * @description Optional caption above the record: a few words; at most 200. When a later page depends on an earlier answer, restate it in a record. Longer fails with 400 INVALID_SCHEMA naming it; never truncated.
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
           * @description What the field asks for: a word or two, about 20 characters; at most 60. Longer fails with 400 INVALID_SCHEMA naming it; never truncated.
           * @example Refund amount
           */
          label: string;
          /**
           * @description Optional help, shown under its own field: one hint, only when needed; at most 160. Longer fails with 400 INVALID_SCHEMA naming it; never truncated.
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
          /** @description A rating is a field with rating and the schema exactly {"type": "integer", "minimum": 1, "maximum": N}, N from 2 to 10 (title and description allowed); any other schema fails with 400 INVALID_SCHEMA. The person sees stars when N is 5 or less, numbered choices above it; the result is the chosen integer. low and high are optional words shown at the two ends of the scale. */
          rating?: {
            /**
             * @description Optional words at one end of a rating, shown by its lowest (low) or highest (high) choice: a word or two; at most 24 characters. Longer fails with 400 INVALID_SCHEMA naming it; never truncated.
             * @example Not likely
             * @example Very likely
             */
            low?: string;
            /**
             * @description Optional words at one end of a rating, shown by its lowest (low) or highest (high) choice: a word or two; at most 24 characters. Longer fails with 400 INVALID_SCHEMA naming it; never truncated.
             * @example Not likely
             * @example Very likely
             */
            high?: string;
          };
          /** @description The field value schema, JSON Schema 2020-12 restricted to: type string (minLength, maxLength, enum), number or integer (minimum, maximum, exclusiveMinimum, exclusiveMaximum), boolean, or array of string enum IDs (items {type: string, enum}, minItems, maxItems, uniqueItems: true). title and description are allowed on the field value schema itself; array items permit only type and enum. With rating, exactly {type: integer, minimum: 1, maximum: 2–10}. Any other keyword fails with INVALID_SCHEMA. */
          schema: {
            [key: string]: unknown;
          };
          /** @description The proposed value shown to the person (a correction is a field with a proposed value). It must be valid against the field schema. */
          value?: unknown;
        }
      | {
          /** @constant */
          type: 'items';
          /**
           * @description Optional caption of an items card: what the list is, a few words; at most 200. Longer fails with 400 INVALID_SCHEMA naming it; never truncated.
           * @example Invoice 2041
           */
          label?: string;
          /**
           * @description ISO 4217 alphabetic code with known minor units (CAD, JPY, BHD …); one per component.
           * @example CAD
           */
          currency: string;
          /** @description The person may choose rows: one (radios) or many (checkboxes). Needs name; the result carries the chosen row indices in selected. */
          select?: 'one' | 'many';
          /** @description The person may change the quantity of rows that carry one. Needs name and an action with intent request_change; a changed quantity is sent only with that action. The result carries quantities, one per row (null for a row without one). */
          editable?: 'quantity'[];
          name?: string;
          /** @description 1 to 100 rows, in order; more fail with 400 INVALID_SCHEMA (never truncated). */
          rows: {
            /**
             * @description What one line is, shown verbatim; put quantity and unit price in detail; at most 80. Longer fails with 400 INVALID_SCHEMA naming it; never truncated.
             * @example Design retainer, October
             */
            name: string;
            /**
             * @description Optional second line under the name: quantity, unit price or a reference; at most 160. Longer fails with 400 INVALID_SCHEMA naming it; never truncated.
             * @example 3 × $150.00
             */
            detail?: string;
            /** @description An editable quantity (only with editable ["quantity"]): the person may change it within min (default 0) and max; Sess never recomputes the amount, your agent does on its next revision. The result carries the quantities. */
            quantity?: {
              value: number;
              /**
               * @description Optional unit shown after an editable quantity: a word; at most 16. Longer fails with 400 INVALID_SCHEMA naming it; never truncated.
               * @example boxes
               */
              unit?: string;
              min?: number;
              max?: number;
            };
            /** @description The line amount in minor units, or null for a line with no amount. */
            amount: number | null;
          }[];
          /** @description Up to 8 totals lines, in order, as you state them. */
          totals?: {
            /**
             * @description A totals line's label: a word or two; at most 40. Longer fails with 400 INVALID_SCHEMA naming it; never truncated.
             * @example Subtotal
             * @example GST 5%
             */
            label: string;
            /** @description The amount in minor units, as stated. */
            amount: number;
            /** @description subtotal (at most one) must equal the sum of the rows; total (at most one), with a subtotal, must equal the subtotal plus the other lines except paid, due and included. */
            role:
              | 'subtotal'
              | 'tax'
              | 'discount'
              | 'shipping'
              | 'fee'
              | 'tip'
              | 'paid'
              | 'due'
              | 'adjustment'
              | 'total'
              | 'other';
            /** @description Already included in the prices (such as VAT): shown, never added. Not on a subtotal or total. */
            included?: boolean;
          }[];
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
          | 'EVIDENCE_DELETED';
        /** @description Plain words for people; clients read code, field, limit, length and expected, never this text. For a value over its length limit it names the value, its length and the limit, and says how to fix it: "Shorten it to at most <limit> characters." A 401 for a create sent with no Authorization header also names the no-signup trial, POST /v1/trial/sessions. */
        message: string;
        request_id: string;
        /** @description A stable machine-readable refinement of some codes (P1 A4 webhook errors; P2 target, admission and limit errors). */
        reason?: string;
        /** @description INVALID_SCHEMA for a value over its length limit (Decision 0009 Amendment 12), and for an items component (Commerce): a JSON pointer to the value in the request body, for example /interaction/title (for a record key, the pointer names that key) or /interaction/source/components/2/currency. VALIDATION_FAILED for an agent’s sharing title (reason title_invalid or title_required): /title. A request body that does not match the schema carries field, the pointer to its first failing value, with expected: for a missing property the pointer names it; for an unknown property it is the object that holds it (the unknown name is never repeated); a pointer never passes through a key you chose (it stops at the object holding that key). Other schema errors (malformed JSON, path and query values) carry no field, limit, length, expected or actual. */
        field?: string;
        /** @description With field: the most the value may have, in Unicode code points. Interactive Surface: title 80, description 280, heading 60, text 4,000, record caption 200, record key 40, record string value 200, field label 60, field description 160, option label 60, action label 24, items caption 200, item name 120, item detail 160, totals label 40, quantity unit 16. Display Session: title 80, description 4,000. For an items component’s rows or totals (field ending /rows or /totals) it is a count: rows 100, totals 8. */
        limit?: number;
        /** @description With field: the value’s length in Unicode code points (for rows or totals, how many were sent). */
        length?: number;
        /** @description An integer (with actual) for an items amount that does not add up; a short string (without actual) for a request body that does not match the schema. */
        expected?: number | string;
        /** @description With expected: the amount stated, in minor units. */
        actual?: number;
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
    ApiRootResponse: {
      /** @constant */
      name: 'Sess API';
      /** @description The OpenAPI document of this API (absolute URL). */
      openapi: string;
      /** @description The docs home (absolute URL). */
      docs: string;
      /** @description The docs’ llms.txt, written for agents (absolute URL). */
      llms: string;
      /** @description The no-signup trial: create a Session with no Authorization header. */
      trial: {
        /** @constant */
        method: 'POST';
        /** @constant */
        path: '/v1/trial/sessions';
      };
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
        /**
         * @description Advanced. Optional BCP 47 locale for formatting the amounts on this page, one per Surface (default: the page’s language, en). It does not translate the page.
         * @example en-CA
         */
        locale?: string;
        /** @description Advanced. Optional position in a sequence of questions: integers with 1 ≤ step ≤ total ≤ 20. The person sees it as a small counter ("1/2"). Anything else fails with 400 INVALID_SCHEMA. */
        progress?: {
          step: number;
          total: number;
        };
        source: {
          /** @constant */
          kind: 'sess_surface';
          /** @description The page's content, in order. How the page lays it out: Fields keep the order you send them in. Consecutive fields share one group; a heading or a text starts a new one. Each label sits beside its answer, or above it when the two do not fit, so keep it to a word or two (about 20 characters). A field's help shows under that field; give it only when it is needed. Keep choice labels short, and put any detail the decision needs in a text or record on the page: a phone's picker may cut a long choice short. Nothing is truncated: rows grow to fit their text. */
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
        /**
         * @description Advanced. Optional BCP 47 locale for formatting the amounts on this page, one per Surface (default: the page’s language, en). It does not translate the page.
         * @example en-CA
         */
        locale?: string;
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
                /** @description A rating is a field with rating and the schema exactly {"type": "integer", "minimum": 1, "maximum": N}, N from 2 to 10 (title and description allowed); any other schema fails with 400 INVALID_SCHEMA. The person sees stars when N is 5 or less, numbered choices above it; the result is the chosen integer. low and high are optional words shown at the two ends of the scale. */
                rating?: {
                  low?: string;
                  high?: string;
                };
                /** @description The field value schema, JSON Schema 2020-12 restricted to: type string (minLength, maxLength, enum), number or integer (minimum, maximum, exclusiveMinimum, exclusiveMaximum), boolean, or array of string enum IDs (items {type: string, enum}, minItems, maxItems, uniqueItems: true). title and description are allowed on the field value schema itself; array items permit only type and enum. With rating, exactly {type: integer, minimum: 1, maximum: 2–10}. Any other keyword fails with INVALID_SCHEMA. */
                schema: {
                  [key: string]: unknown;
                };
                /** @description The proposed value shown to the person (a correction is a field with a proposed value). It must be valid against the field schema. */
                value?: unknown;
              }
            | {
                /** @constant */
                type: 'items';
                label?: string;
                /**
                 * @description ISO 4217 alphabetic code with known minor units (CAD, JPY, BHD …); one per component.
                 * @example CAD
                 */
                currency: string;
                /** @description The person may choose rows: one (radios) or many (checkboxes). Needs name; the result carries the chosen row indices in selected. */
                select?: 'one' | 'many';
                /** @description The person may change the quantity of rows that carry one. Needs name and an action with intent request_change; a changed quantity is sent only with that action. The result carries quantities, one per row (null for a row without one). */
                editable?: 'quantity'[];
                name?: string;
                /** @description 1 to 100 rows, in order; more fail with 400 INVALID_SCHEMA (never truncated). */
                rows: {
                  name: string;
                  detail?: string;
                  /** @description An editable quantity (only with editable ["quantity"]): the person may change it within min (default 0) and max; Sess never recomputes the amount, your agent does on its next revision. The result carries the quantities. */
                  quantity?: {
                    value: number;
                    unit?: string;
                    min?: number;
                    max?: number;
                  };
                  /** @description The line amount in minor units, or null for a line with no amount. */
                  amount: number | null;
                }[];
                /** @description Up to 8 totals lines, in order, as you state them. */
                totals?: {
                  label: string;
                  /** @description The amount in minor units, as stated. */
                  amount: number;
                  /** @description subtotal (at most one) must equal the sum of the rows; total (at most one), with a subtotal, must equal the subtotal plus the other lines except paid, due and included. */
                  role:
                    | 'subtotal'
                    | 'tax'
                    | 'discount'
                    | 'shipping'
                    | 'fee'
                    | 'tip'
                    | 'paid'
                    | 'due'
                    | 'adjustment'
                    | 'total'
                    | 'other';
                  /** @description Already included in the prices (such as VAT): shown, never added. Not on a subtotal or total. */
                  included?: boolean;
                }[];
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
      /** @description The sign-in link token, read by the page from the link’s URL fragment (it is never in a request URL). New tokens are base62 (0-9, A-Z, a-z); tokens of earlier links may also contain - and _, and both are accepted. */
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
      /** @description The saved copy (its item) this session’s latest Save wrote or found, while it exists; null otherwise. Bound to this session: another session never sees it. */
      last_saved: string | null;
      /** @description Where Save lands: `last_saved` was saved within the last ten minutes on the server’s clock, so Your receipts marks it "Saved just now". False when there is none. */
      last_saved_just_now: boolean;
    };
    PersonalDone: {
      status: 'signed_out' | 'closed';
    };
    SaveClaimRequest: {
      /** @description The Keep grant secrets this browser holds for this link: each the 32-byte secret whose domain-separated SHA-256 was the client_event_id of a round it submitted (`kg-` + hash). A round is authorized only by its own grant. Sent in the body only, never in a URL. */
      grants: string[];
      /** @description base64url SHA-256 of UTF-8 "sess.personal-save.source/v1", one 0x00 byte and the source verifier: a 32-byte random value (base64url) this page keeps and hands only to the destination page. */
      source: string;
      /** @description The destination binding the signed-in destination page obtained from POST /personal/save/destination for its own nonce. Absent: the claim is made at the tap, before the destination page is signed in, and has no binding until the signed-in destination page binds it (POST /personal/save/destination with the secret and the source verifier); it is never redeemed unbound. */
      destination?: string;
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
      /** @description The transfer secret of a claim made at the tap (with no destination binding). With `verifier`, this request binds that pending claim to this personal session and nonce, atomically; the claim is redeemable only once bound. Never in a URL. */
      secret?: string;
      /** @description The source verifier of that claim (required with `secret`, and only with it). */
      verifier?: string;
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
      /** @description This page’s nonce, the one its destination binding was made for (for a claim made at the tap, the nonce it was bound with). */
      nonce: string;
    };
    SaveDirectRequest: {
      /** @description The Sess link token of the page on this same origin (read from its path; sent only in this body, never in a URL): 22 characters for a /n/ link, 43 for a /s/ link. New tokens are base62 (0-9, A-Z, a-z); tokens of earlier links may also contain - and _, and both are accepted. */
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
    PersonalCopyDownloadRequest: {
      /** @description A saved copy of this personal account, as GET /personal/copies lists it. */
      item: string;
      /** @description `pdf` answers the copy as served now as a receipt PDF (application/pdf; the same exporter as Keep with `format: pdf`, the file as served embedded unchanged as its one associated file). A file outside the PDF profile is answered as the JSON instead, whole. Default `json`: the data file, unchanged. */
      format?: 'json' | 'pdf';
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
    PersonalCopiesQuery: {
      /** @description Search: a case-insensitive part of the shown title or of the agent name (no wildcards), matched only against what the copy serves now. Sent only in this body; never logged. */
      q?: string;
      /** @description `partly_unavailable` or `unavailable` when an operator restriction or deletion whose scope reaches personal copies withholds rounds or holder proofs of it: that content is never served, and the status never says why. */
      status?: 'available' | 'partly_unavailable' | 'unavailable';
      /** @description The order: by the date the row shows (the default; `answered_at`, else `saved_at`), the shown title or the agent name (copies with none last). */
      sort?: 'saved' | 'title' | 'agent';
      /** @description Ascending or descending (the default: desc by date, asc by title or agent). */
      order?: 'asc' | 'desc';
      /** @description How many matching copies to skip (pages of 20), when no cursor is given. Kept for a page loaded before cursors; the page itself sends a cursor. */
      offset?: number;
      /** @description A page position from a previous answer’s next or previous, under the same sort, order, status and search: opaque, sealed for this personal session, never a credential. One that does not open here is the first page. */
      cursor?: string;
    };
    PersonalCopiesPage: {
      copies: {
        item: string;
        /** Format: date-time */
        saved_at: string;
        /** @description When the last round the copy serves now was answered (its `accepted_at`, as opening the copy shows it): the date the list shows and sorts by. null when the copy serves no round or gives no readable time (the list then shows and sorts by `saved_at`). */
        answered_at: string | null;
        /** @description `partly_unavailable` or `unavailable` when an operator restriction or deletion whose scope reaches personal copies withholds rounds or holder proofs of it: that content is never served, and the status never says why. */
        status: 'available' | 'partly_unavailable' | 'unavailable';
        /** @description The Surface title of the first round the copy serves now that has one, from the copy itself; a withheld round’s title is never used. */
        title: string | null;
        /** @description The person’s own name for the copy (Rename, D7): the page’s navigation title only. It is never in the file, a receipt, a PDF or an export, and never presented as the author’s. null when there is none, or when nothing of the copy is served now. */
        label: string | null;
        /** @description The name the agent was published under for this conversation when it was saved (a shared card’s name, or the Sess demo), kept as it was then: a historical display name, never a verified identity. null when there was none, or when nothing of the copy is served now. */
        agent: string | null;
      }[];
      /** @description Every saved copy that matches. */
      total: number;
      /** @description Every saved copy the list holds, under no search and no status, counted after suppression in the same snapshot as total (the page shows {total} of {all} while a search or status narrows it). */
      all: number;
      /** @description How many matching copies precede this page’s first row. */
      offset: number;
      /** @description The page size (20). */
      limit: number;
      /** @description The cursor of the next page; null on the last page. */
      next: string | null;
      /** @description The cursor of the previous page; an empty string when the previous page is the first (asked for with no cursor); null on the first page. */
      previous: string | null;
    };
    PersonalCopyView: {
      item: string;
      /** Format: date-time */
      saved_at: string;
      /** @description `partly_unavailable` or `unavailable` when an operator restriction or deletion whose scope reaches personal copies withholds rounds or holder proofs of it: that content is never served, and the status never says why. */
      status: 'available' | 'partly_unavailable' | 'unavailable';
      title: string | null;
      /** @description The person’s own name for the copy (Rename, D7): the page’s navigation title only. It is never in the file, a receipt, a PDF or an export, and never presented as the author’s. null when there is none, or when nothing of the copy is served now. */
      label: string | null;
      /** @description The name the agent was published under for this conversation when it was saved (a shared card’s name, or the Sess demo), kept as it was then: a historical display name, never a verified identity. null when there was none, or when nothing of the copy is served now. */
      agent: string | null;
      rounds: {
        /** Format: date-time */
        accepted_at: string;
        title: string | null;
        description: string | null;
        /** @description The label of the action the person chose, as the receipt records it. */
        action: string | null;
        /** @description Empty when the copy does not hold the round’s questions and answers. */
        blocks: (
          | {
              /** @constant */
              kind: 'heading';
              text: string;
            }
          | {
              /** @constant */
              kind: 'text';
              text: string;
            }
          | {
              /** @constant */
              kind: 'record';
              label: string | null;
              pairs: [string, string][];
            }
          | {
              /** @constant */
              kind: 'items';
              label: string | null;
              /** @description The ISO 4217 code, or null when the formatted amounts carry it already. */
              currency: string | null;
              /** @description Where the amounts carry the ISO code set apart from the number by a space (@sess/core amountCodeAt): before it, after it, or null where they carry a symbol. */
              amount_code: 'start' | 'end' | null;
              rows: {
                name: string;
                detail: string | null;
                /** @description The row’s quantity and unit; where the person could change it, the accepted one. */
                quantity: string | null;
                /** @description The line amount, formatted exactly; null for a line with no amount. */
                amount: string | null;
                amount_groups: string[] | null;
              }[];
              totals: {
                label: string;
                amount: string;
                /** @description The amount cut after each grouping separator (@sess/core formatMinorGroups): the only places the page lets a long amount break; an ISO code apart from the number is a piece of its own. The pieces join to the amount, the space beside such a code an ordinary one. */
                amount_groups: string[];
                /** @description The total, or without one the amount due. */
                main: boolean;
                /** @description Already in the prices: shown, not added. */
                included: boolean;
              }[];
            }
          | {
              /** @constant */
              kind: 'answer';
              label: string;
              /** @description The accepted answer: text as typed, a number as written, a choice as its option label, several choices joined with ", "; true or false for a yes/no field; null when it was left empty. */
              answer: string | boolean | null;
            }
        )[];
        /** @description The archival verifier’s signature outcome for this round’s kept record with the service’s receipt keys: `not_checked` when the round was not preserved or its key is not trusted here. */
        signature: 'verified' | 'not_valid' | 'not_checked';
        /** @description Whether the round’s questions and answers in the copy match the receipt: `unavailable` when the copy does not hold them (they were purged before the Save), `not_checked` when the signature was not verified first. Never folded into the signature outcome. */
        contents: 'verified' | 'not_valid' | 'unavailable' | 'not_checked';
        /** @description The holder status as recorded at Save; `withheld` when its signed batch names a round an operator order now withholds. */
        holder: 'enrolled' | 'revoked' | 'not_enrolled' | 'withheld';
      }[];
    };
    PersonalCopyLabelRequest: {
      item: string;
      /** @description null clears the label: the copy shows its own title again. */
      label: string | null;
    };
    PersonalCopyLabelled: {
      status: 'saved' | 'cleared';
    };
    PersonalCopiesRequest: {
      /** @description Saved copies of this account, as the table lists them (at most a page). */
      items: string[];
    };
    PersonalCopiesRemoved: {
      results: {
        item: string;
        /** @description Each item, exactly (D8): `removed` in its own committed transaction; `not_found` not among this account’s copies now (already removed, also when a removal’s answer was lost and the copy, read under its lock, is gone: a retry is safe); `held` a justified hold delays it (never named); `failed` not removed: its removal failed and the copy, read under its lock, is still saved; `not_attempted` the request’s time bound or the session ended before it; `unknown` its removal failed and what happened could not be read in time. */
        outcome: 'removed' | 'held' | 'not_found' | 'failed' | 'not_attempted' | 'unknown';
      }[];
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
      error_description?: string;
    };
    /** @description A public client (no secret). The redirect addresses and the name together may be at most 4 KiB. Other RFC 7591 metadata is ignored; a client secret, `jwks` or another authentication method is refused. */
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
      /** @description Turning sharing on needs a name and a title, in this request or already set. Any change while shared needs the title too. */
      shared?: boolean;
      title?: string | null;
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
        title: string | null;
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
          title: string | null;
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
      /** @description The archival record’s witness job state. witnessed: its preservation evidence (an external timestamp and transparency log entry) is attached. Not yet witnessed: pending (waiting for a batch), batched (in a batch being witnessed), failed_retryable (the last attempt failed; it is retried) or indeterminate (the last attempt’s outcome is unknown; it is retried). A record that is not witnessed is unanchored, never invalid. none: exception custody is never witnessed. */
      witness: 'pending' | 'batched' | 'failed_retryable' | 'indeterminate' | 'witnessed' | 'none';
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
        /** @description The archival record’s witness job state. witnessed: its preservation evidence (an external timestamp and transparency log entry) is attached. Not yet witnessed: pending (waiting for a batch), batched (in a batch being witnessed), failed_retryable (the last attempt failed; it is retried) or indeterminate (the last attempt’s outcome is unknown; it is retried). A record that is not witnessed is unanchored, never invalid. none: exception custody is never witnessed. */
        witness: 'pending' | 'batched' | 'failed_retryable' | 'indeterminate' | 'witnessed' | 'none';
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
        /** @description The archival record’s witness job state. witnessed: its preservation evidence (an external timestamp and transparency log entry) is attached. Not yet witnessed: pending (waiting for a batch), batched (in a batch being witnessed), failed_retryable (the last attempt failed; it is retried) or indeterminate (the last attempt’s outcome is unknown; it is retried). A record that is not witnessed is unanchored, never invalid. none: exception custody is never witnessed. */
        witness: 'pending' | 'batched' | 'failed_retryable' | 'indeterminate' | 'witnessed' | 'none';
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
    CreateAskRequest: {
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
        /**
         * @description Advanced. Optional BCP 47 locale for formatting the amounts on this page, one per Surface (default: the page’s language, en). It does not translate the page.
         * @example en-CA
         */
        locale?: string;
        /** @description Advanced. Optional position in a sequence of questions: integers with 1 ≤ step ≤ total ≤ 20. The person sees it as a small counter ("1/2"). Anything else fails with 400 INVALID_SCHEMA. */
        progress?: {
          step: number;
          total: number;
        };
        source: {
          /** @constant */
          kind: 'sess_surface';
          /** @description The page's content, in order. How the page lays it out: Fields keep the order you send them in. Consecutive fields share one group; a heading or a text starts a new one. Each label sits beside its answer, or above it when the two do not fit, so keep it to a word or two (about 20 characters). A field's help shows under that field; give it only when it is needed. Keep choice labels short, and put any detail the decision needs in a text or record on the page: a phone's picker may cut a long choice short. Nothing is truncated: rows grow to fit their text. */
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
      respondents: {
        /** @description How many people may start. At least 2 and at most the plan’s active-Session limit (Free 25, Starter 50, Pro 100); a trial Ask at most 2. Out of range → 400 INVALID_SCHEMA, whose message names both bounds. The cap is exact: it is checked when a person starts, so it cannot be overshot. */
        max: number;
        /** @description Advanced. Adds one required “Your name” text field, named `name`, before the page’s first field. Typed data for your agent to compare; never verified. Default false. */
        name?: boolean;
      };
      /** @description Advanced. The one deadline, in seconds from creation: after it no one new may start, and every respondent’s link has ended. At least 30 and at most the plan’s live-link lifetime. Absent: the plan’s lifetime. */
      expires_in?: number;
      /** @description Advanced. Each respondent’s link life from their Start, in seconds: at least 30, and clamped at Start to the plan’s limit and to what remains of the Ask. Absent: what remains of the Ask. */
      respondent_expires_in?: number;
      /** @description Advanced. True (the default): a respondent’s Session completes when its answer is accepted. False: your agent continues each respondent by PATCH /v1/sessions/{id} and completes it. */
      auto_complete?: boolean;
    };
    CreateAskResponse: {
      id: string;
      /** @description Round one. */
      revision: number;
      /** @description The link to share with everyone who should answer. Each person gets their own page. */
      human_url: string;
      /** @description The Ask’s deadline: an RFC 3339 UTC instant with milliseconds. From it no one new may start. */
      action_expires_at: string;
      max: number;
    };
    AskResponse: {
      id: string;
      status: 'open' | 'closed';
      /** @description Which closed it: `max` (the last place was started), `owner` (you closed it) or `deadline`. Null while open. */
      closed_by: 'max' | 'owner' | 'deadline' | null;
      closed_at: string | null;
      max: number;
      /** @description The Ask’s deadline: an RFC 3339 UTC instant with milliseconds. From it no one new may start. */
      action_expires_at: string;
      auto_complete: boolean;
      counts: {
        /** @description Starts admitted: each made one respondent Session. */
        started: number;
        /** @description Respondents with at least one accepted answer. */
        answered: number;
        /** @description Respondents whose Session is completed. */
        completed: number;
        refused: {
          /** @description Starts refused because every place was taken. */
          full: number;
          /** @description Starts refused after you closed the Ask. */
          closed: number;
          /** @description Starts refused after the deadline. */
          deadline: number;
          /** @description Starts refused because less than a minute was left. */
          minimum_time: number;
          /** @description Starts refused by the per-Ask limit of 30 Starts a minute. */
          burst: number;
          /** @description Starts refused by your plan (the person saw that it is paused). */
          paused: number;
          /** @description Trial Asks only: Starts refused by the network’s trial allowance. */
          network: number;
        };
      };
      /** @description Respondents in Start order, then by id; one page. */
      sessions: {
        id: string;
        /** @description The respondent Session’s status, as GET /v1/sessions/{id} reads it; `purged` once its content is deleted (a tombstone: times only). */
        status: 'active' | 'responded' | 'completed' | 'purged';
        /** @description Its current revision. */
        revision: number;
        started_at: string;
        completed_at: string | null;
        /** @description Every accepted answer, in order (none for a tombstone). */
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
      }[];
      /** @description Pass as `cursor` to read the next page; null on the last page. */
      next_cursor: string | null;
    };
    AskCloseResponse: {
      id: string;
      status: 'open' | 'closed';
      /** @description Which closed it: `max` (the last place was started), `owner` (you closed it) or `deadline`. Null while open. */
      closed_by: 'max' | 'owner' | 'deadline' | null;
      closed_at: string | null;
      max: number;
      /** @description The Ask’s deadline: an RFC 3339 UTC instant with milliseconds. From it no one new may start. */
      action_expires_at: string;
      auto_complete: boolean;
      counts: {
        /** @description Starts admitted: each made one respondent Session. */
        started: number;
        /** @description Respondents with at least one accepted answer. */
        answered: number;
        /** @description Respondents whose Session is completed. */
        completed: number;
        refused: {
          /** @description Starts refused because every place was taken. */
          full: number;
          /** @description Starts refused after you closed the Ask. */
          closed: number;
          /** @description Starts refused after the deadline. */
          deadline: number;
          /** @description Starts refused because less than a minute was left. */
          minimum_time: number;
          /** @description Starts refused by the per-Ask limit of 30 Starts a minute. */
          burst: number;
          /** @description Starts refused by your plan (the person saw that it is paused). */
          paused: number;
          /** @description Trial Asks only: Starts refused by the network’s trial allowance. */
          network: number;
        };
      };
    };
    TrialCreateAskResponse: {
      id: string;
      /** @description Round one. */
      revision: number;
      /** @description The link to share with everyone who should answer. Each person gets their own page. */
      human_url: string;
      /** @description The Ask’s deadline: an RFC 3339 UTC instant with milliseconds. From it no one new may start. */
      action_expires_at: string;
      max: number;
      /** @description The trial workspace this Ask belongs to. */
      workspace_id: string;
      /** @description Returned once, only when this request created the trial (no Authorization header). */
      management_credential?: string;
      /** @description After this instant the trial admits no further respondent or Session. */
      trial_expires_at: string;
    };
    AskClosedDelivery: {
      /** @constant */
      type: 'ask.closed';
      /** @description Stable across retries and redeliveries: deduplicate on it. */
      event_id: string;
      ask_id: string;
      closed_by: 'max' | 'owner';
      /** @description Starts admitted when it closed. */
      started: number;
      closed_at: string;
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
      /** @description Too many requests. Try again after the time in the Retry-After header. */
      429: {
        headers: {
          'Retry-After'?: number;
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['OAuthErrorResponse'];
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
      /** @description Too many requests. Try again after the time in the Retry-After header. */
      429: {
        headers: {
          'Retry-After'?: number;
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['OAuthErrorResponse'];
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
      /** @description Too many requests. Try again after the time in the Retry-After header. */
      429: {
        headers: {
          'Retry-After'?: number;
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['OAuthErrorResponse'];
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
      /** @description The consent page, or a page asking the person to sign in first. */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'text/html': unknown;
        };
      };
      /** @description The request has a problem, so the person goes back to the agent host with the error. */
      303: {
        headers: {
          [name: string]: unknown;
        };
        content?: never;
      };
      /** @description The client or its redirect address is unknown, or the request is malformed (`INVALID_REQUEST`, `INVALID_CLIENT` or `INVALID_REDIRECT_URI`). */
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
      /** @description The outcome page, which sends the person back to the agent host with a code, or with `access_denied` when the person denied it, by a refresh and a link. */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'text/html': unknown;
        };
      };
      /** @description The consent request expired, was already used or belongs to another session (`AUTHORIZATION_REQUEST_INVALID`). */
      400: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'text/html': unknown;
        };
      };
      /** @description The sign-in is not recent enough, so the person signs in again. */
      401: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'text/html': unknown;
        };
      };
      /** @description The request came from another site or had a wrong form token (`ACTION_NOT_ALLOWED`). */
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
      /** @description Not signed in, so to the sign-in page. */
      303: {
        headers: {
          [name: string]: unknown;
        };
        content?: never;
      };
    };
  };
  removeAgentHostConfirm: {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      /** @description The confirmation page. */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'text/html': unknown;
        };
      };
      /** @description Not signed in, so to the sign-in page. */
      303: {
        headers: {
          [name: string]: unknown;
        };
        content?: never;
      };
      /** @description This account has not allowed that agent host (`NOT_FOUND`). */
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
  removeAgentHost: {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      /** @description Removed; back to the agent hosts page (`/app/hosts?removed=1`). */
      303: {
        headers: {
          [name: string]: unknown;
        };
        content?: never;
      };
      /** @description The request came from another site or had a wrong form token (`ACTION_NOT_ALLOWED`). */
      403: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'text/html': unknown;
        };
      };
      /** @description This account has not allowed that agent host (`NOT_FOUND`). */
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
      /** @description The new tokens. */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['OAuthTokenResponse'];
        };
      };
      /** @description The request, client, grant, scope or resource is not valid, or the grant type is not supported (`invalid_request`, `invalid_client`, `invalid_grant`, `invalid_scope`, `invalid_target` or `unsupported_grant_type`). */
      400: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['OAuthErrorResponse'];
        };
      };
      /** @description The client tried HTTP authentication, which public clients do not use (`invalid_client`). */
      401: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['OAuthErrorResponse'];
        };
      };
      /** @description Too many requests. Try again after the time in the Retry-After header. */
      429: {
        headers: {
          'Retry-After'?: number;
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
      /** @description A redirect address or the client’s details are not valid (`invalid_redirect_uri` or `invalid_client_metadata`). */
      400: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['OAuthErrorResponse'];
        };
      };
      /** @description Too many requests. Try again after the time in the Retry-After header. */
      429: {
        headers: {
          'Retry-After'?: number;
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
      /** @description Revoked, or there was nothing to revoke. */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content?: never;
      };
      /** @description The request or the client is not valid (`invalid_request` or `invalid_client`). */
      400: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['OAuthErrorResponse'];
        };
      };
      /** @description Too many requests. Try again after the time in the Retry-After header. */
      429: {
        headers: {
          'Retry-After'?: number;
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
      /** @description Handed to the email provider; the browser now holds the sign-in challenge. */
      202: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['PersonalSignInAccepted'];
        };
      };
      /** @description That is not a valid email address (`INVALID_SCHEMA`). */
      400: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['Error'];
        };
      };
      /** @description The request came from another site, or a signed-in request had no form token (`ACTION_NOT_ALLOWED`). */
      403: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['Error'];
        };
      };
      /** @description The body is not JSON (`INVALID_SCHEMA`). */
      415: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['Error'];
        };
      };
      /** @description A sending limit is reached (`RATE_LIMITED`). */
      429: {
        headers: {
          'Retry-After'?: number;
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['Error'];
        };
      };
      /** @description Sign-in is not set up here, or the email provider did not confirm the send, so an email may or may not arrive; earlier links still work and the attempt counts (`SIGN_IN_UNAVAILABLE` or `SERVICE_UNAVAILABLE`). */
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
  resendPersonalSignIn: {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    requestBody: {
      content: {
        'application/json': components['schemas']['PersonalEmptyRequest'];
      };
    };
    responses: {
      /** @description Handed to the email provider; the browser now holds the new challenge. */
      202: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['PersonalSignInAccepted'];
        };
      };
      /** @description The body is not valid (`INVALID_SCHEMA`). */
      400: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['Error'];
        };
      };
      /** @description The request came from another site, or a signed-in request had no form token (`ACTION_NOT_ALLOWED`). */
      403: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['Error'];
        };
      };
      /** @description This browser has no sign-in in progress, so ask for the address again (`NOT_FOUND`, reason `no_challenge`). */
      404: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['Error'];
        };
      };
      /** @description The body is not JSON (`INVALID_SCHEMA`). */
      415: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['Error'];
        };
      };
      /** @description A sending limit is reached (`RATE_LIMITED`). */
      429: {
        headers: {
          'Retry-After'?: number;
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['Error'];
        };
      };
      /** @description Sign-in is not set up here, or the email provider did not confirm the send (`SIGN_IN_UNAVAILABLE` or `SERVICE_UNAVAILABLE`). */
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
      /** @description Signed in. */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['PersonalSignedInResponse'];
        };
      };
      /** @description The body is not valid (`INVALID_SCHEMA`). */
      400: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['Error'];
        };
      };
      /** @description The code or link was not accepted, whatever the reason (`UNAUTHORIZED`). */
      401: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['Error'];
        };
      };
      /** @description The request came from another site, or a signed-in request had no form token (`ACTION_NOT_ALLOWED`). */
      403: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['Error'];
        };
      };
      /** @description The body is not JSON (`INVALID_SCHEMA`). */
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
      /** @description Signed in. */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['PersonalSignedInResponse'];
        };
      };
      /** @description The body is not valid (`INVALID_SCHEMA`). */
      400: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['Error'];
        };
      };
      /** @description The code or link was not accepted, whatever the reason (`UNAUTHORIZED`). */
      401: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['Error'];
        };
      };
      /** @description The request came from another site, or a signed-in request had no form token (`ACTION_NOT_ALLOWED`). */
      403: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['Error'];
        };
      };
      /** @description The body is not JSON (`INVALID_SCHEMA`). */
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
      /** @description No one is signed in to a personal account (`UNAUTHORIZED`). */
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
      /** @description The body is not valid (`INVALID_SCHEMA`). */
      400: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['Error'];
        };
      };
      /** @description No one is signed in to a personal account; a developer session never counts (`UNAUTHORIZED`). */
      401: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['Error'];
        };
      };
      /** @description The request came from another site, or a signed-in request had no form token (`ACTION_NOT_ALLOWED`). */
      403: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['Error'];
        };
      };
      /** @description The body is not JSON (`INVALID_SCHEMA`). */
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
  personalSignOutEverywhere: {
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
      /** @description Signed out on every device. */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['PersonalDone'];
        };
      };
      /** @description The body is not valid (`INVALID_SCHEMA`). */
      400: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['Error'];
        };
      };
      /** @description No one is signed in to a personal account; a developer session never counts (`UNAUTHORIZED`). */
      401: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['Error'];
        };
      };
      /** @description The request came from another site, or a signed-in request had no form token (`ACTION_NOT_ALLOWED`). */
      403: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['Error'];
        };
      };
      /** @description The body is not JSON (`INVALID_SCHEMA`). */
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
      /** @description The body is not valid (`INVALID_SCHEMA`). */
      400: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['Error'];
        };
      };
      /** @description No one is signed in to a personal account; a developer session never counts (`UNAUTHORIZED`). */
      401: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['Error'];
        };
      };
      /** @description The request came from another site, had no form token, or the sign-in is more than 15 minutes old, so nothing changed and the person signs in again with an email code first (`ACTION_NOT_ALLOWED`, reason `recent_sign_in_required` for the last). */
      403: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['Error'];
        };
      };
      /** @description A legal hold covers one of the saved copies, so nothing changed (`ACTION_NOT_ALLOWED`, reason `removal_delayed`). */
      409: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['Error'];
        };
      };
      /** @description The body is not JSON (`INVALID_SCHEMA`). */
      415: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['Error'];
        };
      };
      /** @description The service has just started and is not ready yet (`SERVICE_UNAVAILABLE`). */
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
      /** @description The body is not valid (`INVALID_SCHEMA`). */
      400: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['Error'];
        };
      };
      /** @description No one is signed in to a personal account (`UNAUTHORIZED`). */
      401: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['Error'];
        };
      };
      /** @description The request came from another site, or a signed-in request had no form token (`ACTION_NOT_ALLOWED`). */
      403: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['Error'];
        };
      };
      /** @description No claim matches, or it is bound elsewhere, with one answer for both; or the matching claim has expired or was abandoned (`NOT_FOUND`, reason `claim_expired` or `claim_aborted` for the last two). */
      404: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['Error'];
        };
      };
      /** @description The body is not JSON (`INVALID_SCHEMA`). */
      415: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['Error'];
        };
      };
      /** @description Too many requests from this session; try again after `Retry-After` (`RATE_LIMITED`). */
      429: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['Error'];
        };
      };
      /** @description The service has just started and is not ready yet (`SERVICE_UNAVAILABLE`). */
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
      /** @description Saved. */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['SavedResponse'];
        };
      };
      /** @description The body is not valid (`INVALID_SCHEMA`). */
      400: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['Error'];
        };
      };
      /** @description No one is signed in to a personal account (`UNAUTHORIZED`). */
      401: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['Error'];
        };
      };
      /** @description The request came from another site, or a signed-in request had no form token (`ACTION_NOT_ALLOWED`). */
      403: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['Error'];
        };
      };
      /** @description No claim matches, with one answer whatever did not match; or the matching claim has expired or was abandoned (`NOT_FOUND`, reason `claim_expired` or `claim_aborted` for the last two). */
      404: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['Error'];
        };
      };
      /** @description The body is not JSON (`INVALID_SCHEMA`). */
      415: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['Error'];
        };
      };
      /** @description Too many requests from this session; try again after `Retry-After` (`RATE_LIMITED`). */
      429: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['Error'];
        };
      };
      /** @description The service has just started and is not ready yet (`SERVICE_UNAVAILABLE`). */
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
      /** @description Saved. */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['SavedResponse'];
        };
      };
      /** @description The body is not valid (`INVALID_SCHEMA`). */
      400: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['Error'];
        };
      };
      /** @description No one is signed in to a personal account (`UNAUTHORIZED`). */
      401: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['Error'];
        };
      };
      /** @description The request came from another site, or a signed-in request had no form token (`ACTION_NOT_ALLOWED`). */
      403: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['Error'];
        };
      };
      /** @description This is not the personal site, the link is no longer live, or nothing presented covers a round (`NOT_FOUND`, reason `no_authorized_rounds` for the last). */
      404: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['Error'];
        };
      };
      /** @description The body is too large (`PAYLOAD_TOO_LARGE`). */
      413: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['Error'];
        };
      };
      /** @description The body is not JSON (`INVALID_SCHEMA`). */
      415: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['Error'];
        };
      };
      /** @description Too many requests from this session; try again after `Retry-After` (`RATE_LIMITED`). */
      429: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['Error'];
        };
      };
      /** @description The service has just started and is not ready yet (`SERVICE_UNAVAILABLE`). */
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
      /** @description No one is signed in to a personal account; a developer session, an owner key or a Sess link never counts (`UNAUTHORIZED`). */
      401: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['Error'];
        };
      };
      /** @description Too many requests from this session; try again after `Retry-After` (`RATE_LIMITED`). */
      429: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['Error'];
        };
      };
      /** @description The service has just started and is not ready yet (`SERVICE_UNAVAILABLE`). */
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
  queryPersonalCopies: {
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
        'application/json': components['schemas']['PersonalCopiesQuery'];
      };
    };
    responses: {
      /** @description One page of saved copies. */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['PersonalCopiesPage'];
        };
      };
      /** @description The body is not valid (`INVALID_SCHEMA`). */
      400: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['Error'];
        };
      };
      /** @description No one is signed in to a personal account; a developer session, an owner key or a Sess link never counts (`UNAUTHORIZED`). */
      401: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['Error'];
        };
      };
      /** @description The request came from another site, or a signed-in request had no form token (`ACTION_NOT_ALLOWED`). */
      403: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['Error'];
        };
      };
      /** @description The body is not JSON (`INVALID_SCHEMA`). */
      415: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['Error'];
        };
      };
      /** @description Too many requests from this session; try again after `Retry-After` (`RATE_LIMITED`). */
      429: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['Error'];
        };
      };
      /** @description The service has just started and is not ready yet (`SERVICE_UNAVAILABLE`). */
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
  openPersonalCopy: {
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
      /** @description The copy as it is served now. */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['PersonalCopyView'];
        };
      };
      /** @description The body is not valid (`INVALID_SCHEMA`). */
      400: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['Error'];
        };
      };
      /** @description No one is signed in to a personal account; a developer session, an owner key or a Sess link never counts (`UNAUTHORIZED`). */
      401: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['Error'];
        };
      };
      /** @description The request came from another site, or a signed-in request had no form token (`ACTION_NOT_ALLOWED`). */
      403: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['Error'];
        };
      };
      /** @description This account has no such copy; another account’s copy gets the same answer (`NOT_FOUND`). */
      404: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['Error'];
        };
      };
      /** @description The body is not JSON (`INVALID_SCHEMA`). */
      415: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['Error'];
        };
      };
      /** @description Too many requests from this session; try again after `Retry-After` (`RATE_LIMITED`). */
      429: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['Error'];
        };
      };
      /** @description The service has just started and is not ready yet (`SERVICE_UNAVAILABLE`). */
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
  labelPersonalCopy: {
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
        'application/json': components['schemas']['PersonalCopyLabelRequest'];
      };
    };
    responses: {
      /** @description Saved or cleared. */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['PersonalCopyLabelled'];
        };
      };
      /** @description The body is not valid (`INVALID_SCHEMA`). */
      400: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['Error'];
        };
      };
      /** @description No one is signed in to a personal account; a developer session, an owner key or a Sess link never counts (`UNAUTHORIZED`). */
      401: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['Error'];
        };
      };
      /** @description The request came from another site, or a signed-in request had no form token (`ACTION_NOT_ALLOWED`). */
      403: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['Error'];
        };
      };
      /** @description This account has no such copy; another account’s copy gets the same answer (`NOT_FOUND`). */
      404: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['Error'];
        };
      };
      /** @description The body is not JSON (`INVALID_SCHEMA`). */
      415: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['Error'];
        };
      };
      /** @description Too many requests from this session; try again after `Retry-After` (`RATE_LIMITED`). */
      429: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['Error'];
        };
      };
      /** @description The service has just started and is not ready yet (`SERVICE_UNAVAILABLE`). */
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
  downloadPersonalCopies: {
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
        'application/json': components['schemas']['PersonalCopiesRequest'];
      };
    };
    responses: {
      /** @description The archive, as an attachment. */
      200: {
        headers: {
          'X-Sess-Left-Out'?: number;
          /** @description The items left out, comma-separated (empty when none). */
          'X-Sess-Left-Out-Items'?: string;
          [name: string]: unknown;
        };
        content: {
          'application/zip': unknown;
        };
      };
      /** @description The body is not valid (`INVALID_SCHEMA`). */
      400: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['Error'];
        };
      };
      /** @description No one is signed in to a personal account; a developer session, an owner key or a Sess link never counts (`UNAUTHORIZED`). */
      401: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['Error'];
        };
      };
      /** @description The request came from another site, or a signed-in request had no form token (`ACTION_NOT_ALLOWED`). */
      403: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['Error'];
        };
      };
      /** @description None of the selected copies can be served now (`ACTION_NOT_ALLOWED`, reason `copy_unavailable`). */
      409: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['Error'];
        };
      };
      /** @description The selection is larger than one archive holds, so select fewer; nothing is trimmed (`PAYLOAD_TOO_LARGE`, reason `export_too_large`). */
      413: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['Error'];
        };
      };
      /** @description The body is not JSON (`INVALID_SCHEMA`). */
      415: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['Error'];
        };
      };
      /** @description Too many requests from this session, or another export of this account or the service’s limit is in progress (`RATE_LIMITED`, reason `export_busy` for another export). */
      429: {
        headers: {
          'Retry-After'?: number;
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['Error'];
        };
      };
      /** @description The service has just started and is not ready yet, or the archive could not be prepared in time (`SERVICE_UNAVAILABLE`, reason `export_timeout` for the last). */
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
  removePersonalCopies: {
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
        'application/json': components['schemas']['PersonalCopiesRequest'];
      };
    };
    responses: {
      /** @description The outcome for each copy. */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['PersonalCopiesRemoved'];
        };
      };
      /** @description The body is not valid (`INVALID_SCHEMA`). */
      400: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['Error'];
        };
      };
      /** @description No one is signed in to a personal account; a developer session, an owner key or a Sess link never counts (`UNAUTHORIZED`). */
      401: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['Error'];
        };
      };
      /** @description The request came from another site, had no form token, or the sign-in is more than 12 hours old, so nothing was removed and the person signs in again with an email code first (`ACTION_NOT_ALLOWED`, reason `recent_sign_in_required` for the last). */
      403: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['Error'];
        };
      };
      /** @description The body is not JSON (`INVALID_SCHEMA`). */
      415: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['Error'];
        };
      };
      /** @description Too many requests from this session; try again after `Retry-After` (`RATE_LIMITED`). */
      429: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['Error'];
        };
      };
      /** @description The service has just started and is not ready yet (`SERVICE_UNAVAILABLE`). */
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
        'application/json': components['schemas']['PersonalCopyDownloadRequest'];
      };
    };
    responses: {
      /** @description The file, or its receipt PDF, as an attachment. */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': unknown;
          'application/pdf': string;
        };
      };
      /** @description The body is not valid (`INVALID_SCHEMA`). */
      400: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['Error'];
        };
      };
      /** @description No one is signed in to a personal account; a developer session, an owner key or a Sess link never counts (`UNAUTHORIZED`). */
      401: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['Error'];
        };
      };
      /** @description The request came from another site, or a signed-in request had no form token (`ACTION_NOT_ALLOWED`). */
      403: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['Error'];
        };
      };
      /** @description This account has no such copy; another account’s copy gets the same answer (`NOT_FOUND`). */
      404: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['Error'];
        };
      };
      /** @description Nothing of this copy can be served now (`ACTION_NOT_ALLOWED`, reason `copy_unavailable`). */
      409: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['Error'];
        };
      };
      /** @description The body is not JSON (`INVALID_SCHEMA`). */
      415: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['Error'];
        };
      };
      /** @description Too many requests from this session; try again after `Retry-After` (`RATE_LIMITED`). */
      429: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['Error'];
        };
      };
      /** @description The service has just started and is not ready yet (`SERVICE_UNAVAILABLE`). */
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
      /** @description The body is not valid (`INVALID_SCHEMA`). */
      400: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['Error'];
        };
      };
      /** @description No one is signed in to a personal account; a developer session, an owner key or a Sess link never counts (`UNAUTHORIZED`). */
      401: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['Error'];
        };
      };
      /** @description The request came from another site, or a signed-in request had no form token (`ACTION_NOT_ALLOWED`). */
      403: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['Error'];
        };
      };
      /** @description This account has no such copy; another account’s copy gets the same answer (`NOT_FOUND`). */
      404: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['Error'];
        };
      };
      /** @description A legal hold covers one of its rounds, so nothing changed (`ACTION_NOT_ALLOWED`, reason `removal_delayed`). */
      409: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['Error'];
        };
      };
      /** @description The body is not JSON (`INVALID_SCHEMA`). */
      415: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['Error'];
        };
      };
      /** @description Too many requests from this session; try again after `Retry-After` (`RATE_LIMITED`). */
      429: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['Error'];
        };
      };
      /** @description The service has just started and is not ready yet (`SERVICE_UNAVAILABLE`). */
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
  createAsk: {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    requestBody: {
      content: {
        'application/json': components['schemas']['CreateAskRequest'];
      };
    };
    responses: {
      /** @description Ask created and open. */
      201: {
        headers: {
          /** @description /v1/asks/{id} */
          Location?: string;
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['CreateAskResponse'];
        };
      };
      /** @description The body is not valid, `respondents.max` or a lifetime is out of range, or an idempotency key was sent (`INVALID_SCHEMA` or `UNKNOWN_COMPONENT`). */
      400: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['Error'];
        };
      };
      /** @description The API key is missing, wrong, revoked or expired (`UNAUTHORIZED`). */
      401: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['Error'];
        };
      };
      /** @description The body is too large (`PAYLOAD_TOO_LARGE`). */
      413: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['Error'];
        };
      };
      /** @description Something went wrong on our side (`INTERNAL`). */
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
  getAsk: {
    parameters: {
      query?: {
        cursor?: string;
        limit?: number;
      };
      header?: never;
      path: {
        id: string;
      };
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      /** @description The Ask. */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['AskResponse'];
        };
      };
      /** @description The cursor or limit is not valid (`INVALID_SCHEMA`). */
      400: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['Error'];
        };
      };
      /** @description The API key is missing, wrong, revoked or expired (`UNAUTHORIZED`). */
      401: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['Error'];
        };
      };
      /** @description Your workspace has no Ask with this ID (`NOT_FOUND`). */
      404: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['Error'];
        };
      };
      /** @description Something went wrong on our side (`INTERNAL`). */
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
  updateAsk: {
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
      /** @description The API key is missing, wrong, revoked or expired (`UNAUTHORIZED`). */
      401: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['Error'];
        };
      };
      /** @description An Ask cannot be changed (`ACTION_NOT_ALLOWED`). */
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
  closeAsk: {
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
      /** @description The closed Ask. */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['AskCloseResponse'];
        };
      };
      /** @description The API key is missing, wrong, revoked or expired (`UNAUTHORIZED`). */
      401: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['Error'];
        };
      };
      /** @description Your workspace has no Ask with this ID (`NOT_FOUND`). */
      404: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['Error'];
        };
      };
      /** @description Something went wrong on our side (`INTERNAL`). */
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
  listAskDeliveries: {
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
      /** @description The API key is missing, wrong, revoked or expired (`UNAUTHORIZED`). */
      401: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['Error'];
        };
      };
      /** @description Your workspace has no Ask with this ID (`NOT_FOUND`). */
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
  redeliverAskEvent: {
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
      /** @description Queued, or the delivery already waiting for this event and address. */
      202: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['RedeliverResponse'];
        };
      };
      /** @description The API key is missing, wrong, revoked or expired (`UNAUTHORIZED`). */
      401: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['Error'];
        };
      };
      /** @description This Ask has no such event (`NOT_FOUND`). */
      404: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['Error'];
        };
      };
      /** @description There is no verified webhook address (`WEBHOOK_NOT_CONFIGURED`). */
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
  createTrialAsk: {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    requestBody: {
      content: {
        'application/json': components['schemas']['CreateAskRequest'];
      };
    };
    responses: {
      /** @description Ask created and open. */
      201: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['TrialCreateAskResponse'];
        };
      };
      /** @description The body is not valid, `respondents.max` is above 2, or an idempotency key was sent (`INVALID_SCHEMA` or `UNKNOWN_COMPONENT`). */
      400: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['Error'];
        };
      };
      /** @description The key does not open a trial (`NOT_FOUND`). */
      404: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['Error'];
        };
      };
      /** @description A trial limit is reached (`RATE_LIMITED`). */
      429: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['Error'];
        };
      };
      /** @description Something went wrong on our side (`INTERNAL`). */
      500: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['Error'];
        };
      };
      /** @description The trial is not set up on this deployment (`TRIAL_UNAVAILABLE`). */
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
  getTrialAsk: {
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
      /** @description The Ask. */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['AskResponse'];
        };
      };
      /** @description The key does not open this Ask (`NOT_FOUND`). */
      404: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['Error'];
        };
      };
      /** @description Something went wrong on our side (`INTERNAL`). */
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
      /** @description That is not a valid email address (`INVALID_SCHEMA`). */
      400: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['Error'];
        };
      };
      /** @description Too many links for this address or from this client (`RATE_LIMITED`). */
      429: {
        headers: {
          'Retry-After'?: number;
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['Error'];
        };
      };
      /** @description Email is not set up here, or the email provider did not confirm the send, so an email may or may not arrive; earlier links still work and the attempt counts (`SIGN_IN_UNAVAILABLE` or `SERVICE_UNAVAILABLE`). */
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
      /** @description The sign-in page, for someone not signed in or with a key creation waiting for a sign-in. */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'text/html': unknown;
        };
      };
      /** @description Already signed in, so to the account pages. */
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
      /** @description Signed in, but the waiting key was not created because its expiry date changed with the new day; the keys page shows a fresh form. */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'text/html': unknown;
        };
      };
      /** @description Signed in, to the account pages, or to the keys page, which shows the new key once. */
      303: {
        headers: {
          [name: string]: unknown;
        };
        content?: never;
      };
      /** @description The link expired, was already used or was replaced by a newer one (`SIGN_IN_LINK_INVALID`). */
      400: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'text/html': unknown;
        };
      };
      /** @description The request came from another site (`ACTION_NOT_ALLOWED`). */
      403: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'text/html': unknown;
        };
      };
      /** @description Signed in, but the waiting key was not created because the account already has 10 active keys (`KEY_LIMIT_REACHED`). */
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
      /** @description Signed in, to the account pages, or to the keys page, which shows the new key once. */
      303: {
        headers: {
          [name: string]: unknown;
        };
        content?: never;
      };
      /** @description The code was not accepted, with one answer for every reason: wrong, expired, used, replaced or locked, no challenge in this browser, too many guesses or a malformed entry (`SIGN_IN_CODE_INVALID`). */
      400: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'text/html': unknown;
        };
      };
      /** @description The request came from another site or had a wrong form token (`ACTION_NOT_ALLOWED`). */
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
      /** @description Signed out; back to the keys page (`/app/keys?device_revoked=1`), or to the sign-in page for this device. */
      303: {
        headers: {
          [name: string]: unknown;
        };
        content?: never;
      };
      /** @description The request came from another site or had a wrong form token (`ACTION_NOT_ALLOWED`). */
      403: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'text/html': unknown;
        };
      };
      /** @description That is not a signed-in device of this account (`NOT_FOUND`). */
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
  closeAccountScreen: {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      /** @description The confirmation screen. */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'text/html': unknown;
        };
      };
      /** @description Not signed in, so to the sign-in page. */
      303: {
        headers: {
          [name: string]: unknown;
        };
        content?: never;
      };
    };
  };
  closeAccount: {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      /** @description Deleted, to the closed page (`/app/account/closed`) with the session cleared; or the sign-in is older than 15 minutes ("Verify it’s you"), or there is none, so to the sign-in page. */
      303: {
        headers: {
          [name: string]: unknown;
        };
        content?: never;
      };
      /** @description The request came from another site or had a wrong form token (`ACTION_NOT_ALLOWED`). */
      403: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'text/html': unknown;
        };
      };
      /** @description Nothing was deleted, because the plan’s cancellation was not confirmed or the service is not ready yet; or the outcome of the deletion is unknown, and the page says so (`SERVICE_UNAVAILABLE`). */
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
  accountClosed: {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      /** @description Your account is deleted. */
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
      /** @description To GitHub’s authorization page, with this browser’s tie set. */
      303: {
        headers: {
          [name: string]: unknown;
        };
        content?: never;
      };
      /** @description The request came from another site (`ACTION_NOT_ALLOWED`). */
      403: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'text/html': unknown;
        };
      };
      /** @description Too many GitHub sign-ins started from this client or in total (`RATE_LIMITED`). */
      429: {
        headers: {
          'Retry-After'?: number;
          [name: string]: unknown;
        };
        content: {
          'text/html': unknown;
        };
      };
      /** @description GitHub sign-in is not set up on this deployment (`SIGN_IN_UNAVAILABLE`). */
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
      /** @description The person cancelled on GitHub, or GitHub returned an error or a malformed reply (`GITHUB_SIGN_IN_CANCELLED` or `GITHUB_SIGN_IN_FAILED`). */
      400: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'text/html': unknown;
        };
      };
      /** @description GitHub sign-in is not set up on this deployment (`SIGN_IN_UNAVAILABLE`). */
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
      /** @description GitHub shared no verified, usable address, so the sign-in page offers email instead and nothing was created (`GITHUB_EMAIL_UNVERIFIED`). */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'text/html': unknown;
        };
      };
      /** @description Signed in or linked, to the page the person started from (`/app/` or `/app/evidence`), to the keys page when a waiting key was created, or after a link to `/app/keys?github=linked`. */
      303: {
        headers: {
          [name: string]: unknown;
        };
        content?: never;
      };
      /** @description This sign-in cannot finish, with one answer for every reason: an unknown, used, expired or altered start, another browser, or a code GitHub refused (`GITHUB_SIGN_IN_FAILED`). */
      400: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'text/html': unknown;
        };
      };
      /** @description The request came from another site; or, for a link, the session is not the one that started it or signed in more than 12 hours ago (`ACTION_NOT_ALLOWED`, `RECENT_SIGN_IN_REQUIRED` or `GITHUB_SIGN_IN_FAILED`). */
      403: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'text/html': unknown;
        };
      };
      /** @description An account already uses this address, the GitHub account is linked to another account, or this account already has another GitHub account (`GITHUB_NOT_LINKED`, `GITHUB_ALREADY_LINKED` or `GITHUB_LINK_EXISTS`). */
      409: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'text/html': unknown;
        };
      };
      /** @description GitHub did not answer usefully, so nothing changed; or GitHub sign-in is not set up (`SERVICE_UNAVAILABLE` or `SIGN_IN_UNAVAILABLE`). */
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
      /** @description To GitHub’s authorization page, with this browser’s tie set; or, not signed in, to the sign-in page. */
      303: {
        headers: {
          [name: string]: unknown;
        };
        content?: never;
      };
      /** @description The request came from another site, had a wrong form token, or the sign-in is more than 12 hours old (`ACTION_NOT_ALLOWED` or `RECENT_SIGN_IN_REQUIRED`). */
      403: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'text/html': unknown;
        };
      };
      /** @description Too many GitHub sign-ins started (`RATE_LIMITED`). */
      429: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'text/html': unknown;
        };
      };
      /** @description GitHub sign-in is not set up on this deployment (`SIGN_IN_UNAVAILABLE`). */
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
      /** @description Unlinked, back to the keys page (`/app/keys?github=unlinked`); or, not signed in, to the sign-in page. */
      303: {
        headers: {
          [name: string]: unknown;
        };
        content?: never;
      };
      /** @description The request came from another site, had a wrong form token, or the sign-in is more than 12 hours old (`ACTION_NOT_ALLOWED` or `RECENT_SIGN_IN_REQUIRED`). */
      403: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'text/html': unknown;
        };
      };
      /** @description No GitHub account is linked to this account (`NOT_FOUND`). */
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
  apiKeysPage: {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      /** @description The keys page, with a new key’s secret shown once. */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'text/html': unknown;
        };
      };
      /** @description Not signed in, so to the sign-in page. */
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
      /** @description Created, to the keys page, which shows the key once; or, with no session or an old sign-in, to the sign-in page, keeping a valid choice. */
      303: {
        headers: {
          [name: string]: unknown;
        };
        content?: never;
      };
      /** @description The expiry or the name is not valid, the form is missing, unknown, expired or from another session, or the expiry dates changed since the form was shown (`INVALID_SCHEMA`). */
      400: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'text/html': unknown;
        };
      };
      /** @description The request came from another site or had a wrong form token (`ACTION_NOT_ALLOWED`). */
      403: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'text/html': unknown;
        };
      };
      /** @description The account already has 10 active keys, or this form already created a key, which is not shown again (`KEY_LIMIT_REACHED` or `KEY_ALREADY_CREATED`). */
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
  revokeApiKeyConfirm: {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      /** @description The confirmation page. */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'text/html': unknown;
        };
      };
      /** @description Not signed in, so to the sign-in page. */
      303: {
        headers: {
          [name: string]: unknown;
        };
        content?: never;
      };
      /** @description That is not an active key of this account; the keys page shows the error (`NOT_FOUND`). */
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
  revokeApiKey: {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      /** @description Revoked, back to the keys page (`/app/keys?revoked=1`); or, with no session or an old sign-in, to the sign-in page. */
      303: {
        headers: {
          [name: string]: unknown;
        };
        content?: never;
      };
      /** @description The request came from another site or had a wrong form token (`ACTION_NOT_ALLOWED`). */
      403: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'text/html': unknown;
        };
      };
      /** @description That is not an active key of this account; the keys page shows the error (`NOT_FOUND`). */
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
      /** @description Not signed in, so to the sign-in page. */
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
      /** @description To the payment page, to the usage page with a notice (`/app/usage?billing=<notice>`), or, not signed in, to the sign-in page. */
      303: {
        headers: {
          [name: string]: unknown;
        };
        content?: never;
      };
      /** @description The request came from another site or had a wrong form token (`ACTION_NOT_ALLOWED`). */
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
      /** @description To the billing page, to the usage page with a notice (`/app/usage?billing=<notice>`), or, not signed in, to the sign-in page. */
      303: {
        headers: {
          [name: string]: unknown;
        };
        content?: never;
      };
      /** @description The request came from another site or had a wrong form token (`ACTION_NOT_ALLOWED`). */
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
      /** @description Claimed, or already claimed by this account, back to the keys page (`/app/keys?claimed=1`); or, not signed in, to the sign-in page. */
      303: {
        headers: {
          [name: string]: unknown;
        };
        content?: never;
      };
      /** @description That is not a trial key (`INVALID_SCHEMA`). */
      400: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'text/html': unknown;
        };
      };
      /** @description The request came from another site or had a wrong form token (`ACTION_NOT_ALLOWED`). */
      403: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'text/html': unknown;
        };
      };
      /** @description No live trial has that key: it is unknown, revoked, deleted or past its deletion time (`TRIAL_NOT_FOUND`). */
      404: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'text/html': unknown;
        };
      };
      /** @description Another account already claimed this trial (`TRIAL_ALREADY_CLAIMED`). */
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
      /** @description The receipts page. */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'text/html': unknown;
        };
      };
      /** @description Not signed in, so to the sign-in page. */
      303: {
        headers: {
          [name: string]: unknown;
        };
        content?: never;
      };
      /** @description A filter could not be read (`INVALID_SCHEMA`). */
      400: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'text/html': unknown;
        };
      };
      /** @description The receipts could not be read (`INTERNAL`). */
      500: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'text/html': unknown;
        };
      };
      /** @description The receipts view is not set up here (`SERVICE_UNAVAILABLE`). */
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
      /** @description Not signed in, so to the sign-in page. */
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
      /** @description Not signed in, so to the sign-in page. */
      303: {
        headers: {
          [name: string]: unknown;
        };
        content?: never;
      };
      /** @description This workspace has no such Session (`NOT_FOUND`). */
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
      /** @description Not signed in, so to the sign-in page. */
      303: {
        headers: {
          [name: string]: unknown;
        };
        content?: never;
      };
      /** @description The dates are the wrong way round or the agent ID is not valid (`INVALID_SCHEMA`). */
      400: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'text/html': unknown;
        };
      };
      /** @description The request came from another site or had a wrong form token (`ACTION_NOT_ALLOWED`). */
      403: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'text/html': unknown;
        };
      };
      /** @description Too many exports; try again after `Retry-After` (`RATE_LIMITED`). */
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
  evidenceReceiptPage: {
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
      /** @description The receipt page. */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'text/html': unknown;
        };
      };
      /** @description Not signed in, so to the sign-in page. */
      303: {
        headers: {
          [name: string]: unknown;
        };
        content?: never;
      };
      /** @description This workspace has no such receipt (`NOT_FOUND`). */
      404: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'text/html': unknown;
        };
      };
      /** @description The receipts view is not set up here (`SERVICE_UNAVAILABLE`). */
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
  evidenceReceiptDownload: {
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
      /** @description The archival envelope. */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['ArchivalEnvelope'];
        };
      };
      /** @description Not signed in, so to the sign-in page. */
      303: {
        headers: {
          [name: string]: unknown;
        };
        content?: never;
      };
      /** @description This workspace has no such receipt (`NOT_FOUND`). */
      404: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'text/html': unknown;
        };
      };
      /** @description The receipts view is not set up here (`SERVICE_UNAVAILABLE`). */
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
  evidenceReceiptVerifyReload: {
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
      /** @description To the receipt page, or, not signed in, to the sign-in page. */
      303: {
        headers: {
          [name: string]: unknown;
        };
        content?: never;
      };
    };
  };
  evidenceReceiptVerify: {
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
      /** @description The receipt page with the result. */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'text/html': unknown;
        };
      };
      /** @description Not signed in, so to the sign-in page. */
      303: {
        headers: {
          [name: string]: unknown;
        };
        content?: never;
      };
      /** @description The request came from another site or had a wrong form token (`ACTION_NOT_ALLOWED`). */
      403: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'text/html': unknown;
        };
      };
      /** @description This workspace has no such receipt (`NOT_FOUND`). */
      404: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'text/html': unknown;
        };
      };
      /** @description The receipts view is not set up here (`SERVICE_UNAVAILABLE`). */
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
  evidenceRecordPdfDownload: {
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
      /** @description The receipt PDF as a download, or the record itself when it is too large for the PDF. */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/pdf': string;
          'application/json': Record<string, never>;
        };
      };
      /** @description Not signed in, so to the sign-in page. */
      303: {
        headers: {
          [name: string]: unknown;
        };
        content?: never;
      };
      /** @description This workspace has no such record (`NOT_FOUND`). */
      404: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'text/html': unknown;
        };
      };
      /** @description The record is restricted (`EVIDENCE_RESTRICTED`). */
      409: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'text/html': unknown;
        };
      };
      /** @description The record was deleted (`EVIDENCE_DELETED`). */
      410: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'text/html': unknown;
        };
      };
      /** @description Too many downloads; try again after `Retry-After` (`RATE_LIMITED`). */
      429: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'text/html': unknown;
        };
      };
      /** @description The receipts view is not set up or not ready yet (`SERVICE_UNAVAILABLE`). */
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
      /** @description The body is not valid, uses an unknown component, or sends an idempotency key (`INVALID_SCHEMA` or `UNKNOWN_COMPONENT`). */
      400: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['Error'];
        };
      };
      /** @description The key does not open a trial, or the trial address is unknown or malformed; this is never a 401 (`NOT_FOUND`). */
      404: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['Error'];
        };
      };
      /** @description The body is too large (`PAYLOAD_TOO_LARGE`). */
      413: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['Error'];
        };
      };
      /** @description A trial limit is reached, or the trial’s 24 hours for creating Sessions are over; rely on the code and `Retry-After`, not the message, which is written for people (`RATE_LIMITED`). */
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
      /** @description Something went wrong on our side (`INTERNAL`). */
      500: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['Error'];
        };
      };
      /** @description The trial is not set up on this deployment (`TRIAL_UNAVAILABLE`). */
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
      /** @description The key does not open this Session, or the trial address is unknown or malformed; this is never a 401 or 400 (`NOT_FOUND`). */
      404: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['Error'];
        };
      };
      /** @description Something went wrong on our side (`INTERNAL`). */
      500: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['Error'];
        };
      };
      /** @description The trial is not set up on this deployment (`TRIAL_UNAVAILABLE`). */
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
      /** @description The body is not valid: it does not match the schema, uses an unknown component or an unsupported field rule, sets the link lifetime out of range (the message names the allowed range), or sends an idempotency key (`INVALID_SCHEMA` or `UNKNOWN_COMPONENT`). */
      400: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['Error'];
        };
      };
      /** @description The API key is missing, wrong, revoked or expired; with no key at all, the message also points to the no-signup trial (`UNAUTHORIZED`). */
      401: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['Error'];
        };
      };
      /** @description The agent run named by `invocation_id` has ended or expired, so nothing is created (`INVOCATION_TERMINAL`). */
      409: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['Error'];
        };
      };
      /** @description The body is too large (`PAYLOAD_TOO_LARGE`). */
      413: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['Error'];
        };
      };
      /** @description Your workspace has no run with that `invocation_id`, so nothing is created (`VALIDATION_FAILED`, reason `unknown_invocation`). */
      422: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['Error'];
        };
      };
      /** @description The plan’s monthly allowance or its limit on active Sessions is reached, so nothing is created; Sessions already created carry on, and the message says which limit, when it resets and where to change plan (`PLAN_LIMIT_REACHED`). */
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
      /** @description Something went wrong on our side (`INTERNAL`). */
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
      /** @description The request is not valid (`INVALID_SCHEMA`). */
      400: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['Error'];
        };
      };
      /** @description The API key is missing, wrong, revoked or expired (`UNAUTHORIZED`). */
      401: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['Error'];
        };
      };
      /** @description Your workspace has no Session with this ID (`SESSION_NOT_FOUND`). */
      404: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['Error'];
        };
      };
      /** @description Something went wrong on our side (`INTERNAL`). */
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
        /** @description The ETag from your latest read of the Session, such as "2.3". It is required: without it, or with `*`, the request is refused. A weak tag (W/"…") never matches, and an out-of-date one is refused as a conflict. */
        'If-Match': string;
        /** @description Makes a retry safe. The key belongs to your credential, the operation and the Session: the same request (body and If-Match) returns the first result (status, ETag and body), and a different request with the same key is refused. Only successful results are kept. */
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
      /** @description The body is not valid or uses an unknown component (`INVALID_SCHEMA` or `UNKNOWN_COMPONENT`). */
      400: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['Error'];
        };
      };
      /** @description The API key is missing, wrong, revoked or expired (`UNAUTHORIZED`). */
      401: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['Error'];
        };
      };
      /** @description This Session belongs to a claimed trial, which is read-only (`ACTION_NOT_ALLOWED`). */
      403: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['Error'];
        };
      };
      /** @description Your workspace has no Session with this ID (`SESSION_NOT_FOUND`). */
      404: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['Error'];
        };
      };
      /** @description The Session is completed, is a display Session, or the idempotency key was used for a different request (`SESSION_COMPLETED`, `ACTION_NOT_ALLOWED` or `IDEMPOTENCY_CONFLICT`). */
      409: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['Error'];
        };
      };
      /** @description The Session changed since you read it, so read it again (`SESSION_REVISION_CONFLICT`). */
      412: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['Error'];
        };
      };
      /** @description The body is too large (`PAYLOAD_TOO_LARGE`). */
      413: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['Error'];
        };
      };
      /** @description The request must say which version of the Session it changes (`PRECONDITION_REQUIRED`). */
      428: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['Error'];
        };
      };
      /** @description Something went wrong on our side (`INTERNAL`). */
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
        /** @description The ETag from your latest read of the Session, such as "2.3". It is required: without it, or with `*`, the request is refused. A weak tag (W/"…") never matches, and an out-of-date one is refused as a conflict. */
        'If-Match': string;
        /** @description Makes a retry safe. The key belongs to your credential, the operation and the Session: the same request (body and If-Match) returns the first result (status, ETag and body), and a different request with the same key is refused. Only successful results are kept. */
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
      /** @description The request is not valid (`INVALID_SCHEMA`). */
      400: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['Error'];
        };
      };
      /** @description The API key is missing, wrong, revoked or expired (`UNAUTHORIZED`). */
      401: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['Error'];
        };
      };
      /** @description This Session belongs to a claimed trial, which is read-only (`ACTION_NOT_ALLOWED`). */
      403: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['Error'];
        };
      };
      /** @description Your workspace has no Session with this ID (`SESSION_NOT_FOUND`). */
      404: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['Error'];
        };
      };
      /** @description The Session is already completed, is a display Session, or the idempotency key was used for a different request (`SESSION_COMPLETED`, `ACTION_NOT_ALLOWED` or `IDEMPOTENCY_CONFLICT`). */
      409: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['Error'];
        };
      };
      /** @description The Session changed since you read it, so read it again (`SESSION_REVISION_CONFLICT`). */
      412: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['Error'];
        };
      };
      /** @description The request must say which version of the Session it changes (`PRECONDITION_REQUIRED`). */
      428: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['Error'];
        };
      };
      /** @description Something went wrong on our side (`INTERNAL`). */
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
      /** @description The API key is missing, wrong, revoked or expired (`UNAUTHORIZED`). */
      401: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['Error'];
        };
      };
      /** @description Your workspace has no Session with this ID (`SESSION_NOT_FOUND`). */
      404: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['Error'];
        };
      };
      /** @description Something went wrong on our side (`INTERNAL`). */
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
      /** @description The revision is not a positive whole number (`INVALID_SCHEMA`). */
      400: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['Error'];
        };
      };
      /** @description The API key is missing, wrong, revoked or expired (`UNAUTHORIZED`). */
      401: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['Error'];
        };
      };
      /** @description Your workspace has no such Session, or it has no such revision (`SESSION_NOT_FOUND` or `NOT_FOUND`). */
      404: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['Error'];
        };
      };
      /** @description Something went wrong on our side (`INTERNAL`). */
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
      /** @description Accepted, or the same answer sent again, so the person goes back to the Sess link page. */
      303: {
        headers: {
          /** @description The same /s/{token} path. */
          Location?: string;
          [name: string]: unknown;
        };
        content?: never;
      };
      /** @description The form is not valid or names an action that does not exist (`INVALID_SCHEMA` or `ACTION_NOT_FOUND`). */
      400: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'text/html': unknown;
        };
      };
      /** @description The answer was not sent from the page itself (`ACTION_NOT_ALLOWED`). */
      403: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'text/html': unknown;
        };
      };
      /** @description The link is unknown, expired, revoked or deleted; an answer is accepted only while the link is live. */
      404: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'text/html': unknown;
        };
      };
      /** @description A display Session takes no answer (`ACTION_NOT_ALLOWED`). */
      405: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'text/html': unknown;
        };
      };
      /** @description The question changed, the Session takes no more answers, is completed, or the request was sent before with other values; or the link is past its deadline but can still be extended, so the form returns with the person’s values and Need more time? (`SESSION_REVISION_CONFLICT`, `RESPONSE_LIMIT_REACHED`, `SESSION_COMPLETED`, `IDEMPOTENCY_CONFLICT` or `LINK_LAPSED`). */
      409: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'text/html': unknown;
        };
      };
      /** @description The form is too large (`PAYLOAD_TOO_LARGE`). */
      413: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'text/html': unknown;
        };
      };
      /** @description The form is not sent as a web form (`INVALID_SCHEMA`). */
      415: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'text/html': unknown;
        };
      };
      /** @description Some fields need fixing; the form shows which (`VALIDATION_FAILED`). */
      422: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'text/html': unknown;
        };
      };
      /** @description Receipts are not set up on this deployment, so nothing is accepted (`SERVICE_UNAVAILABLE`). */
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
      /** @description Extended, or already extended by the same request; the page shows the form again with the person’s values. */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'text/html': unknown;
        };
      };
      /** @description The body is not the form’s exact shape, or its values cannot be read (`INVALID_SCHEMA`). */
      400: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'text/html': unknown;
        };
      };
      /** @description The request was not sent from the page itself (`ACTION_NOT_ALLOWED`). */
      403: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'text/html': unknown;
        };
      };
      /** @description The link is unknown, expired, revoked or deleted, and nothing changed. */
      404: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'text/html': unknown;
        };
      };
      /** @description A display Session has no deadline to extend (`ACTION_NOT_ALLOWED`). */
      405: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'text/html': unknown;
        };
      };
      /** @description Nothing changed: the question changed, the Session is completed, or no extension is left, and the link stays live until its deadline (`SESSION_REVISION_CONFLICT` or `SESSION_COMPLETED`). */
      409: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'text/html': unknown;
        };
      };
      /** @description The form is too large (`PAYLOAD_TOO_LARGE`). */
      413: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'text/html': unknown;
        };
      };
      /** @description The form is not sent as a web form (`INVALID_SCHEMA`). */
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
      /** @description The body is not valid (`INVALID_SCHEMA`). */
      400: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['Error'];
        };
      };
      /** @description The request was not sent from the page itself (`ACTION_NOT_ALLOWED`). */
      403: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['Error'];
        };
      };
      /** @description The link is unknown, expired or revoked, or is a display Session, shown as the not-found page; or none of the permissions covers an answered round of this Session (`NOT_FOUND`, reason `no_authorized_rounds`, as JSON). */
      404: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'text/html': unknown;
          'application/json': components['schemas']['Error'];
        };
      };
      /** @description The body is too large (`PAYLOAD_TOO_LARGE`). */
      413: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['Error'];
        };
      };
      /** @description Too many requests for this link; try again after `Retry-After` (`RATE_LIMITED`). */
      429: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['Error'];
        };
      };
      /** @description Receipts or Keep are not set up here, or the service has just started and is not ready yet (`SERVICE_UNAVAILABLE`). */
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
      /** @description The kept conversation as a JSON attachment, or its receipt PDF. */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['KeptConversation'];
          'application/pdf': string;
        };
      };
      /** @description The body is not valid (`INVALID_SCHEMA`). */
      400: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['Error'];
        };
      };
      /** @description The request was not sent from the page itself (`ACTION_NOT_ALLOWED`). */
      403: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['Error'];
        };
      };
      /** @description The link is unknown, expired or revoked, shown as the not-found page; or none of the permissions covers an answered round (`NOT_FOUND`, reason `no_authorized_rounds`, as JSON). */
      404: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'text/html': unknown;
          'application/json': components['schemas']['Error'];
        };
      };
      /** @description This challenge was already used by a different request (`IDEMPOTENCY_CONFLICT`). */
      409: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['Error'];
        };
      };
      /** @description The body is too large (`PAYLOAD_TOO_LARGE`). */
      413: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['Error'];
        };
      };
      /** @description The holder keys were refused, so nothing was enrolled, and the same request without them still exports the file (`HOLDER_ENROLLMENT_REFUSED`, reason `challenge_unknown`, `challenge_expired`, `batch_mismatch`, `not_authorized`, `proof_invalid`, `key_reused` or `already_enrolled`). */
      422: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['Error'];
        };
      };
      /** @description Too many requests for this link; try again after `Retry-After` (`RATE_LIMITED`). */
      429: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['Error'];
        };
      };
      /** @description Receipts or Keep are not set up here, or the service has just started and is not ready yet (`SERVICE_UNAVAILABLE`). */
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
      /** @description The body is not valid (`INVALID_SCHEMA`). */
      400: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['Error'];
        };
      };
      /** @description The request was not sent from the page itself (`ACTION_NOT_ALLOWED`). */
      403: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['Error'];
        };
      };
      /** @description The link is unknown, expired or revoked, shown as the not-found page; or none of the permissions covers an answered round (`NOT_FOUND`, reason `no_authorized_rounds`, as JSON). */
      404: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'text/html': unknown;
          'application/json': components['schemas']['Error'];
        };
      };
      /** @description This Save sheet already has a claim (`IDEMPOTENCY_CONFLICT`, reason `destination_used`). */
      409: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['Error'];
        };
      };
      /** @description The body is too large (`PAYLOAD_TOO_LARGE`). */
      413: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['Error'];
        };
      };
      /** @description Too many requests for this link; try again after `Retry-After` (`RATE_LIMITED`). */
      429: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['Error'];
        };
      };
      /** @description The service has just started and is not ready yet (`SERVICE_UNAVAILABLE`). */
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
      /** @description The state: waiting for your agent after an answer, active when a question waits for one, or completed, which is final. */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['HumanStatusResponse'];
        };
      };
      /** @description The link is unknown, expired or revoked, or is a display Session, shown as the not-found page. */
      404: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'text/html': unknown;
        };
      };
      /** @description More than 60 reads of this link in one minute; wait the seconds `Retry-After` gives (`RATE_LIMITED`). */
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
      /** @description The API key is missing, wrong, revoked or expired (`UNAUTHORIZED`). */
      401: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['Error'];
        };
      };
      /** @description This key’s workspace has no plan (`NOT_FOUND`). */
      404: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['Error'];
        };
      };
      /** @description Billing is not set up on this deployment (`SERVICE_UNAVAILABLE`). */
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
      /** @description The payment page and when it expires. */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['BillingCheckoutResponse'];
        };
      };
      /** @description The body is not valid (`INVALID_SCHEMA`). */
      400: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['Error'];
        };
      };
      /** @description The API key is missing, wrong, revoked or expired (`UNAUTHORIZED`). */
      401: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['Error'];
        };
      };
      /** @description This key’s workspace has no plan (`NOT_FOUND`). */
      404: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['Error'];
        };
      };
      /** @description The workspace already pays, or its payment went through, so there is no new payment page (`SUBSCRIPTION_EXISTS`, reason `subscribed` or `checkout_completed`). */
      409: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['Error'];
        };
      };
      /** @description No payment page now: billing is not set up, another is being created or confirmed, a payment is still being confirmed, or the provider is unavailable or refused; retry after `Retry-After`, which returns the same page (`SERVICE_UNAVAILABLE`, reason `not_configured`, `checkout_in_progress`, `checkout_processing`, `provider_unavailable` or `provider_rejected`). */
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
      /** @description Received: handled, a repeat, or ignored. */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['BillingEventAck'];
        };
      };
      /** @description The signed body is not a provider event (`INVALID_SCHEMA`). */
      400: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['Error'];
        };
      };
      /** @description The signature is missing, malformed, too old or does not match (`UNAUTHORIZED`). */
      401: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['Error'];
        };
      };
      /** @description No billing provider is set up here (`NOT_FOUND`). */
      404: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['Error'];
        };
      };
      /** @description The body is too large (`PAYLOAD_TOO_LARGE`). */
      413: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['Error'];
        };
      };
      /** @description The event was not handled; send it again (`SERVICE_UNAVAILABLE`, reason `provider_unavailable`). */
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
      /** @description The webhook. */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['WebhookResponse'];
        };
      };
      /** @description The API key is missing, wrong, revoked or expired (`UNAUTHORIZED`). */
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
      /** @description Registered, waiting for verification. */
      201: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['WebhookRegisterResponse'];
        };
      };
      /** @description The address is not an https address Sess can use, or the body is not valid (`WEBHOOK_INVALID_URL`, reason `not_https`, `port`, `credentials`, `fragment`, `non_public_address`, `malformed` or `too_long`; or `INVALID_SCHEMA`). */
      400: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['Error'];
        };
      };
      /** @description The API key is missing, wrong, revoked or expired (`UNAUTHORIZED`). */
      401: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['Error'];
        };
      };
      /** @description Webhooks are not set up on this deployment (`SERVICE_UNAVAILABLE`). */
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
      /** @description Verified; the address and when its verification expires. */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['WebhookVerifyResponse'];
        };
      };
      /** @description The API key is missing, wrong, revoked or expired (`UNAUTHORIZED`). */
      401: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['Error'];
        };
      };
      /** @description There is no webhook address to verify (`WEBHOOK_NOT_CONFIGURED`). */
      409: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['Error'];
        };
      };
      /** @description The address did not answer the challenge correctly (`WEBHOOK_VERIFICATION_FAILED`, reason `egress_refused`, `redirect`, `rejected`, `bad_answer`, `timeout`, `connection` or `dns`). */
      422: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['Error'];
        };
      };
      /** @description Webhooks are not set up on this deployment (`SERVICE_UNAVAILABLE`). */
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
      /** @description The API key is missing, wrong, revoked or expired (`UNAUTHORIZED`). */
      401: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['Error'];
        };
      };
      /** @description There is no webhook address yet (`WEBHOOK_NOT_CONFIGURED`). */
      409: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['Error'];
        };
      };
      /** @description Webhooks are not set up on this deployment (`SERVICE_UNAVAILABLE`). */
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
      /** @description The API key is missing, wrong, revoked or expired (`UNAUTHORIZED`). */
      401: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['Error'];
        };
      };
      /** @description Your workspace has no Session with this ID (`SESSION_NOT_FOUND`). */
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
      /** @description Queued, or the delivery already waiting for this answer and address. */
      202: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['RedeliverResponse'];
        };
      };
      /** @description The API key is missing, wrong, revoked or expired (`UNAUTHORIZED`). */
      401: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['Error'];
        };
      };
      /** @description This Session belongs to a claimed trial, which is read-only (`ACTION_NOT_ALLOWED`). */
      403: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['Error'];
        };
      };
      /** @description This Session has no such accepted answer (`NOT_FOUND`). */
      404: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['Error'];
        };
      };
      /** @description There is no verified webhook address (`WEBHOOK_NOT_CONFIGURED`). */
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
      /** @description That is not an event ID (`INVALID_SCHEMA`). */
      400: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['Error'];
        };
      };
      /** @description The API key is missing, wrong, revoked or expired (`UNAUTHORIZED`). */
      401: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['Error'];
        };
      };
      /** @description Your workspace has no such Session, or it has no such accepted answer with a receipt, or its content was deleted (`SESSION_NOT_FOUND` or `NOT_FOUND`). */
      404: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['Error'];
        };
      };
      /** @description The receipt is restricted, so nothing is disclosed until it is unrestricted (`EVIDENCE_RESTRICTED`). */
      409: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['Error'];
        };
      };
      /** @description The receipt was deleted, and only its tombstone remains (`EVIDENCE_DELETED`). */
      410: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['Error'];
        };
      };
      /** @description Something went wrong on our side (`INTERNAL`). */
      500: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['Error'];
        };
      };
      /** @description Receipts are not set up here, or the service has just started and is not ready yet (`SERVICE_UNAVAILABLE`). */
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
      /** @description The verification result, valid or invalid. */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['DecisionBundleVerification'];
        };
      };
      /** @description The body is not JSON (`INVALID_SCHEMA`). */
      400: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['Error'];
        };
      };
      /** @description The body is too large (`PAYLOAD_TOO_LARGE`). */
      413: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['Error'];
        };
      };
      /** @description Too many checks; try again after `Retry-After` (`RATE_LIMITED`). */
      429: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['Error'];
        };
      };
      /** @description Receipts are not set up here, or the 2-second deadline passed and the connection is closed (`SERVICE_UNAVAILABLE`). */
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
      /** @description The result of the archival check and how to present it. */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['ArchivalVerifyResponse'];
        };
      };
      /** @description The body is not JSON (`INVALID_SCHEMA`). */
      400: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['Error'];
        };
      };
      /** @description The body is too large (`PAYLOAD_TOO_LARGE`). */
      413: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['Error'];
        };
      };
      /** @description Too many checks; try again after `Retry-After` (`RATE_LIMITED`). */
      429: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['Error'];
        };
      };
      /** @description Receipts are not set up here, or the 2-second deadline passed and the connection is closed (`SERVICE_UNAVAILABLE`). */
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
      /** @description The agents. */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['TargetListResponse'];
        };
      };
      /** @description The API key is missing, wrong, revoked or expired (`UNAUTHORIZED`). */
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
        /** @description Optional. Makes a retry safe. The key belongs to your credential and the operation: the same body returns the first 201 (status, Location and the agent as first registered) and registers nothing more, even if the agent or the plan changed since; a different body with the same key is refused; requests at the same moment with one key register one agent. Only successful registrations are kept. Without the header every request registers. */
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
      /** @description Registered, waiting for verification. */
      201: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['TargetResponse'];
        };
      };
      /** @description The endpoint, the capability or the body is not valid (`TARGET_INVALID_URL`, `TARGET_INVALID_CAPABILITY` or `INVALID_SCHEMA`; the reason says which part). */
      400: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['Error'];
        };
      };
      /** @description The API key is missing, wrong, revoked or expired (`UNAUTHORIZED`). */
      401: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['Error'];
        };
      };
      /** @description The idempotency key was used for a different request (`IDEMPOTENCY_CONFLICT`). */
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
      /** @description The agent. */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['TargetResponse'];
        };
      };
      /** @description The API key is missing, wrong, revoked or expired (`UNAUTHORIZED`). */
      401: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['Error'];
        };
      };
      /** @description Your workspace has no such agent; another workspace’s agent gets the same answer (`NOT_FOUND`). */
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
      /** @description The updated agent. */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['TargetResponse'];
        };
      };
      /** @description The capability or the body is not valid (`TARGET_INVALID_CAPABILITY` or `INVALID_SCHEMA`). */
      400: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['Error'];
        };
      };
      /** @description The API key is missing, wrong, revoked or expired (`UNAUTHORIZED`). */
      401: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['Error'];
        };
      };
      /** @description Your workspace has no such agent (`NOT_FOUND`). */
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
      /** @description The updated agent. */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['TargetResponse'];
        };
      };
      /** @description The name, the title, the description, the attribution or the body is not valid, or the agent would be shared without a title (`VALIDATION_FAILED`, reason `name_invalid`, `name_reserved`, `title_invalid`, `title_required`, `description_invalid` or `attribution_invalid`; the title’s two carry field `/title`; or `INVALID_SCHEMA`). */
      400: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['Error'];
        };
      };
      /** @description The API key is missing, wrong, revoked or expired (`UNAUTHORIZED`). */
      401: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['Error'];
        };
      };
      /** @description Your workspace has no such agent; another workspace’s agent gets the same answer (`NOT_FOUND`). */
      404: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['Error'];
        };
      };
      /** @description Another agent has that name, or sharing needs a name first (`TARGET_NAME_TAKEN`, or `ACTION_NOT_ALLOWED`, reason `name_required`). */
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
      /** @description The API key is missing, wrong, revoked or expired (`UNAUTHORIZED`). */
      401: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['Error'];
        };
      };
      /** @description Your workspace has no such agent (`NOT_FOUND`). */
      404: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['Error'];
        };
      };
      /** @description The verification document could not be fetched or is not right (`TARGET_VERIFICATION_FAILED`, reason `egress_refused`, `redirect`, `rejected`, `bad_answer`, `timeout`, `connection` or `dns`). */
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
      /** @description That site is not allowed by the grant policy, or the body is not valid (`VALIDATION_FAILED`, reason `audience`; or `INVALID_SCHEMA`). */
      400: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['Error'];
        };
      };
      /** @description The API key is missing, wrong, revoked or expired (`UNAUTHORIZED`). */
      401: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['Error'];
        };
      };
      /** @description Your workspace has no such agent (`NOT_FOUND`). */
      404: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['Error'];
        };
      };
      /** @description The agent is turned off or not verified (`ACTION_NOT_ALLOWED`, reason `disabled` or `unverified`). */
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
      /** @description The API key is missing, wrong, revoked or expired (`UNAUTHORIZED`). */
      401: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['Error'];
        };
      };
      /** @description Your workspace has no such agent or grant (`NOT_FOUND`). */
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
      /** @description The same run, started by the same request before. */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['InvocationStartResponse'];
        };
      };
      /** @description Started. */
      201: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['InvocationStartResponse'];
        };
      };
      /** @description The body is not valid (`INVALID_SCHEMA`). */
      400: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['Error'];
        };
      };
      /** @description The grant is unknown, expired or revoked, sent from the wrong site, or the agent is off or not verified, with one answer for all (`NOT_FOUND`). */
      404: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['Error'];
        };
      };
      /** @description The same request ID came with a different body, or the agent’s version changed since the grant (`IDEMPOTENCY_CONFLICT` or `TARGET_VERSION_CONFLICT`). */
      409: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['Error'];
        };
      };
      /** @description The input is too large (`PAYLOAD_TOO_LARGE`). */
      413: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['Error'];
        };
      };
      /** @description The input does not match the agent’s capability (`VALIDATION_FAILED`). */
      422: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['Error'];
        };
      };
      /** @description A limit is reached: this grant’s run, the client’s day, the agent’s day or concurrency, the workspace’s or the service’s concurrency, or the workspace’s plan (`RATE_LIMITED`, reason `grant_active`, `client_daily`, `target_daily`, `target_concurrency`, `workspace_concurrency`, `global_concurrency` or `workspace_paused`). */
      429: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['Error'];
        };
      };
      /** @description Starts are switched off or not set up here (`SERVICE_UNAVAILABLE`, reason `admission_disabled` or `not_configured`). */
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
      /** @description The run. */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['InvocationResponse'];
        };
      };
      /** @description This credential has no such run (`NOT_FOUND`). */
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
      /** @description This credential has no such run (`NOT_FOUND`). */
      404: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['Error'];
        };
      };
      /** @description The run already completed, failed or expired (`INVOCATION_TERMINAL`). */
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
      /** @description This credential has no such run (`NOT_FOUND`). */
      404: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['Error'];
        };
      };
      /** @description The run has already finished (`INVOCATION_TERMINAL`). */
      409: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['Error'];
        };
      };
      /** @description The result is larger than 16 KiB (`PAYLOAD_TOO_LARGE`). */
      413: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['Error'];
        };
      };
      /** @description The result does not belong to this run (`VALIDATION_FAILED`, reason `unbound_result`). */
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
      /** @description A filter, the limit or the cursor could not be read (`INVALID_SCHEMA`). */
      400: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['Error'];
        };
      };
      /** @description The API key is missing, wrong, revoked or expired (`UNAUTHORIZED`). */
      401: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['Error'];
        };
      };
      /** @description The receipts view is not set up here (`SERVICE_UNAVAILABLE`). */
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
      /** @description The export file, as a download. */
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
      /** @description There is no explicit range, or the range could not be read (`INVALID_SCHEMA`). */
      400: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['Error'];
        };
      };
      /** @description The API key is missing, wrong, revoked or expired (`UNAUTHORIZED`). */
      401: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['Error'];
        };
      };
      /** @description Too many exports; try again after `Retry-After` (`RATE_LIMITED`). */
      429: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['Error'];
        };
      };
      /** @description The receipts view is not set up here (`SERVICE_UNAVAILABLE`). */
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
      /** @description That is not an event ID (`INVALID_SCHEMA`). */
      400: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['Error'];
        };
      };
      /** @description The API key is missing, wrong, revoked or expired (`UNAUTHORIZED`). */
      401: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['Error'];
        };
      };
      /** @description Your workspace has no such record (`NOT_FOUND`). */
      404: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['Error'];
        };
      };
      /** @description The receipts view is not set up here, or the service has just started and is not ready yet (`SERVICE_UNAVAILABLE`). */
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
  getEvidenceRecordPdf: {
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
      /** @description The receipt PDF as a download, or the record itself when it is too large for the PDF. */
      200: {
        headers: {
          /** @description attachment; filename="Sess receipt – <title> – <d Mon yyyy>.pdf" (with filename* in UTF-8), or filename="sess-receipt.json" */
          'Content-Disposition'?: string;
          [name: string]: unknown;
        };
        content: {
          'application/pdf': string;
          'application/json': Record<string, never>;
        };
      };
      /** @description That is not an event ID (`INVALID_SCHEMA`). */
      400: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['Error'];
        };
      };
      /** @description The API key is missing, wrong, revoked or expired (`UNAUTHORIZED`). */
      401: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['Error'];
        };
      };
      /** @description Your workspace has no such record (`NOT_FOUND`). */
      404: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['Error'];
        };
      };
      /** @description The receipt is restricted (`EVIDENCE_RESTRICTED`). */
      409: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['Error'];
        };
      };
      /** @description The receipt was deleted (`EVIDENCE_DELETED`). */
      410: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['Error'];
        };
      };
      /** @description Too many downloads; try again after `Retry-After` (`RATE_LIMITED`). */
      429: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['Error'];
        };
      };
      /** @description The receipts view or the receipt keys are not set up here, or the service has just started and is not ready yet (`SERVICE_UNAVAILABLE`). */
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
      /** @description The key set. */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['ReceiptKeysResponse'];
        };
      };
      /** @description The receipt keys are not set up on this deployment (`SERVICE_UNAVAILABLE`). */
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
      /** @description The signed list. */
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
      /** @description The receipt keys are not set up on this deployment (`SERVICE_UNAVAILABLE`). */
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
      /** @description The witness keys set up on this deployment are unusable (`SERVICE_UNAVAILABLE`). */
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
  apiRoot: {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      /** @description Where to start. */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['ApiRootResponse'];
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
      /** @description Not ready: the configuration, the database or the schema; no detail is disclosed. */
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
  webhookAskClosed: {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    requestBody: {
      content: {
        'application/json': components['schemas']['AskClosedDelivery'];
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
}
