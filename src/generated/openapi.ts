export interface paths {
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
    /** @description Consumes the link once (same-origin requests only) and sets the account-page cookie: HttpOnly, Secure, SameSite=Strict, host-only, Path=/app, 12 hours. When the same browser holds a pending key creation of the same account (the key-intent cookie, set by a create post with an expired session of that account), the key is created now with that label and expiry, once, and the response is the one-time reveal; the intent cookie is cleared. A pending creation of another account creates nothing. */
    post: operations['signInConfirm'];
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
    /** @description Creates an owner API key (sess_sk_…) of the developer workspace and shows it once, in one post of the keys page’s create form. The form states each expiry choice’s exact date and carries a single-use nonce bound to the account session (15 minutes); creating consumes it, so a refresh or repeat never creates a second key or shows the secret again. The stored expiry has the date the form showed (rendered_at, bound to the nonce); when that date is no longer true the form is shown again (400). Form fields: csrf (the page’s token), nonce, rendered_at, label (optional, ≤ 64 characters, no control characters), expires_in_days (30, 90, 365 or never; required). Same-origin requests with the session’s CSRF token only. At most 10 active keys per account. With an expired account session (same-origin posts only), a valid label and expiry choice, bound to that account, is kept in a key-intent cookie (HMAC-protected, HttpOnly, Secure, SameSite=Strict, host-only, Path=/app, 15 minutes) and the answer is 303 to /app/sign-in ("Verify it’s you"); the key is created only after the email link is confirmed in the same browser. Revoke: POST /app/keys/{id}/revoke (same rules), immediate. Sign out: POST /app/sign-out. */
    post: operations['createApiKey'];
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
    /** @description Claims a no-signup trial for the signed-in developer account. Form fields: csrf (the page’s token) and management_credential (the trial’s sess_mg_… credential, in the form body only, never in a URL). Same-origin requests with the session’s CSRF token only; the human link can never claim. A claim records the account as the trial’s owner, once: nothing moves, the trial keeps its deadlines, limits and deletion time, its receipts stay as issued and its management credential keeps working. The account’s API keys can then read (only read) the trial’s Sessions with the owner read routes, each Session until its result_available_until (as with the management credential). Claiming the same trial again from the same account answers as the first claim. */
    post: operations['claimTrial'];
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
    /** @description The no-signup trial. Without Authorization: creates a trial workspace and its first interactive Session, and returns the management credential once, in the body. With `Authorization: Bearer <management credential>`: creates a further Session in that trial. Interactive Sessions only (mode interactive); no return channel, webhook or outbound endpoint exists for a trial. Trial limits (published, reversible): human link and action window 1 hour; result readable 24 hours after the action window; at most 3 active Sessions and 10 Sessions per trial within its 24-hour creation window; at most 3 new trials per client and 200 overall per rolling 24 hours. Any other credential, or a management credential that is unknown, expired, revoked or bound to one Session → 404 NOT_FOUND. An Idempotency-Key header is refused (400 INVALID_SCHEMA): the credential and the human link cannot be replayed. */
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
    /** @description A trial Session and its accepted responses, read with the trial’s management credential, until result_available_until. Reading never consumes or changes it. A Session of another trial or workspace, an unknown, expired or revoked credential, a human link or an owner key → 404 NOT_FOUND (generic). */
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
    /** @description Creates a display Session (mode display, source.kind data) or an interactive one (mode interactive, source.kind sess_surface; components: SurfaceComponent). An unrecognized component type → 400 UNKNOWN_COMPONENT; a field-schema keyword outside the supported subset → 400 INVALID_SCHEMA. An Idempotency-Key header is refused (400 INVALID_SCHEMA): the human link cannot be replayed (it is stored only as a hash). Retention: the human link expires 720 hours after creation with the deployment owner key and 168 hours with a developer API key (free plan). The Session’s content, accepted results and receipts are purged 720 hours (owner key) or 168 hours (developer API key) after the earlier of its completion and its link’s expiry, and outstanding webhook deliveries are cancelled; afterwards every owner route answers 404 SESSION_NOT_FOUND. A webhook already delivered is not recalled. */
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
    /** @description The Session. Interactive Sessions return status, the current revision, its response_schema and every accepted response bound to its revision; repeated reads of an unchanged Session are byte-identical. A developer API key also reads the Sessions of trials its account claimed (read-only), each until that Session’s result_available_until. */
    get: operations['getSession'];
    put?: never;
    post?: never;
    delete?: never;
    options?: never;
    head?: never;
    /** @description Publishes the next immutable Surface revision of an interactive Session, from responded or active (superseding the unanswered revision). The Session returns to active on the same Session ID and human link; a submission against an older revision is then refused with SESSION_REVISION_CONFLICT. */
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
    /** @description Every Event of the Session in sequence order: response.accepted (actor link_holder, the revision it was accepted on, action_id and the typed data), revision.published and session.completed (actor owner). Append-only: Event IDs and sequences never change, and every accepted result stays listed after later revisions and completion. Not paginated in P1 (a Session has a few Events per round). Display Sessions have none. Cache-Control: no-store, no-transform. */
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
    /** @description The human form submission (the human link is the capability; never log it). Accepted only from the page itself: Sec-Fetch-Site same-origin, or without Fetch Metadata an Origin equal to the public origin. The server resolves action_id from the exact stored revision and validates data against its response_schema. Responses are HTML pages whose stable code is in a data-error-code attribute. */
    post: operations['submitHumanAction'];
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
}
export interface components {
  schemas: {
    CreateSessionRequest: {
      interaction:
        | {
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
          }
        | {
            /** @constant */
            mode: 'interactive';
            title: string;
            description?: string;
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
    CreateSessionResponse: {
      id: string;
      revision: number;
      human_url: string;
    };
    SessionResponse: {
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
    InteractiveSessionResponse: {
      id: string;
      status: 'active' | 'responded' | 'completed';
      /** @description The current Surface revision. */
      revision: number;
      interaction: {
        /** @constant */
        mode: 'interactive';
        title: string;
        description?: string;
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
                /** @description The field value schema, JSON Schema 2020-12 restricted to: type string (minLength, maxLength, enum), number or integer (minimum, maximum, exclusiveMinimum, exclusiveMaximum), boolean, or array of string enum IDs (items {type: string, enum}, minItems, maxItems, uniqueItems: true); title and description are allowed everywhere. Any other keyword fails with INVALID_SCHEMA. */
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
        /** @description The signed decision receipt: a compact JWS (EdDSA/Ed25519, typ sess-receipt+jwt, kid) over the RFC 8785 canonical claims, verifiable with GET /.well-known/sess-receipt-keys.json. Issued once in the acceptance transaction and never re-signed. Its exp is at least 720 hours after acceptance and, for an owner-key Session that is purged automatically, no earlier than the Session’s latest possible purge (its human link’s expiry plus its retention after it ends). null only for responses accepted before receipts existed. */
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
                /** @description The field value schema, JSON Schema 2020-12 restricted to: type string (minLength, maxLength, enum), number or integer (minimum, maximum, exclusiveMinimum, exclusiveMaximum), boolean, or array of string enum IDs (items {type: string, enum}, minItems, maxItems, uniqueItems: true); title and description are allowed everywhere. Any other keyword fails with INVALID_SCHEMA. */
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
        /** @description The signed decision receipt: a compact JWS (EdDSA/Ed25519, typ sess-receipt+jwt, kid) over the RFC 8785 canonical claims, verifiable with GET /.well-known/sess-receipt-keys.json. Issued once in the acceptance transaction and never re-signed. Its exp is at least 720 hours after acceptance and, for an owner-key Session that is purged automatically, no earlier than the Session’s latest possible purge (its human link’s expiry plus its retention after it ends). null only for responses accepted before receipts existed. */
        receipt?: string | null;
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
        title: string;
        description?: string;
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
          /** @description The field value schema, JSON Schema 2020-12 restricted to: type string (minLength, maxLength, enum), number or integer (minimum, maximum, exclusiveMinimum, exclusiveMaximum), boolean, or array of string enum IDs (items {type: string, enum}, minItems, maxItems, uniqueItems: true); title and description are allowed everywhere. Any other keyword fails with INVALID_SCHEMA. */
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
          | 'WEBHOOK_NOT_CONFIGURED';
        message: string;
        request_id: string;
        /** @description A stable machine-readable refinement of some codes (P1 A4 webhook errors). */
        reason?: string;
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
        title: string;
        description?: string;
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
      /** @description The human link (a capability): share it only with the responder. */
      human_url: string;
      /** @description The trial workspace this Session belongs to. */
      workspace_id: string;
      /** @description Returned once, only when this request created the trial (no Authorization header). It reads this trial’s results and creates further Sessions in it; it is never retrievable again. Keep it secret; never put it in a URL. */
      management_credential?: string;
      /** @description After this instant the human link accepts no response. */
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
      interaction: {
        /** @constant */
        mode: 'interactive';
        title: string;
        description?: string;
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
                /** @description The field value schema, JSON Schema 2020-12 restricted to: type string (minLength, maxLength, enum), number or integer (minimum, maximum, exclusiveMinimum, exclusiveMaximum), boolean, or array of string enum IDs (items {type: string, enum}, minItems, maxItems, uniqueItems: true); title and description are allowed everywhere. Any other keyword fails with INVALID_SCHEMA. */
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
        /** @description The signed decision receipt: a compact JWS (EdDSA/Ed25519, typ sess-receipt+jwt, kid) over the RFC 8785 canonical claims, verifiable with GET /.well-known/sess-receipt-keys.json. Issued once in the acceptance transaction and never re-signed. Its exp is at least 720 hours after acceptance and, for an owner-key Session that is purged automatically, no earlier than the Session’s latest possible purge (its human link’s expiry plus its retention after it ends). null only for responses accepted before receipts existed. */
        receipt: string | null;
      }[];
      trial: {
        workspace_id: string;
        /** @description After this instant the human link accepts no response. */
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
  };
  responses: never;
  parameters: never;
  requestBodies: never;
  headers: never;
  pathItems: never;
}
export type $defs = Record<string, never>;
export interface operations {
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
      /** @description No live account session: to /app/sign-in (with the key-intent cookie for a valid choice). */
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
      /** @description PAYLOAD_TOO_LARGE */
      413: {
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
            components['schemas']['SessionResponse'] | components['schemas']['InteractiveSurfaceResponse'];
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
      /** @description Accepted (with a signed decision receipt stored with its Event, returned by the owner GET and the Event log), or a repeated client_event_id with the same request (original result and the same receipt, never re-signed). */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'text/html': unknown;
        };
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
      /** @description Unknown, expired or revoked link (generic). */
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
      /** @description Verified. */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content?: never;
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
      /** @description Queued. */
      202: {
        headers: {
          [name: string]: unknown;
        };
        content?: never;
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
}
