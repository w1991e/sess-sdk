import type { components } from './generated/openapi.js';

/** Unmodified types generated from the reviewed public HTTP contract. */
export type { components, paths, operations } from './generated/openapi.js';
type Schemas = components['schemas'];
export type RawCreateSessionRequest = Schemas['CreateSessionRequest'];
export type RawPublishSessionRequest = Schemas['PatchSessionRequest'];
export type CreateSessionResponse = Schemas['CreateSessionResponse'];
export type DisplaySession = Schemas['SessionResponse'];
export type InteractiveSession = Schemas['InteractiveSessionResponse'];
export type Session = DisplaySession | InteractiveSession;
export type DisplaySurfaceRevision = Schemas['SessionResponse'];
export type InteractiveSurfaceRevision = Schemas['InteractiveSurfaceResponse'];
export type SurfaceRevision = DisplaySurfaceRevision | InteractiveSurfaceRevision;
export type AcceptedResponse = InteractiveSession['responses'][number];
export type SessionEvents = Schemas['SessionEventsResponse'];
export type SessionEvent = SessionEvents['events'][number];
/**
 * The Sess link's state at the time of a Session read (Decision 0009 Amendment 10): `live` takes
 * answers; `lapsed` is past its deadline but the person can still ask for more time, so the
 * Session is still open; `expired` will never take an answer.
 */
export type LinkState = InteractiveSession['link_state'];
/**
 * One accepted extension of the Sess link: on Session reads (`extensions`) and on the Session log
 * (`link_extensions`). It carries deadlines only, never an answer value.
 */
export type LinkExtension = InteractiveSession['extensions'][number];
export type Deliveries = Schemas['DeliveriesResponse'];
export type WebhookRegisterRequest = Schemas['WebhookRegisterRequest'];
export type WebhookRegisterResponse = Schemas['WebhookRegisterResponse'];
export type WebhookResponse = Schemas['WebhookResponse'];
export type WebhookRotateResponse = Schemas['WebhookRotateResponse'];
export type WebhookVerifyResponse = Schemas['WebhookVerifyResponse'];
export type RedeliverResponse = Schemas['RedeliverResponse'];
export type WebhookDelivery = Schemas['WebhookDelivery'];
export type WebhookVerification = Schemas['WebhookVerification'];
export type DisplayInteraction = DisplaySession['interaction'];
export type Action = InteractiveSession['interaction']['actions'][number];

type SchemaDocumentation = { title?: string; description?: string };
/** The documented restricted field-schema subset; the runtime validates it. */
export type FieldSchema = SchemaDocumentation &
  (
    | { type: 'string'; minLength?: number; maxLength?: number; enum?: string[] }
    | {
        type: 'number' | 'integer';
        minimum?: number;
        maximum?: number;
        exclusiveMinimum?: number;
        exclusiveMaximum?: number;
      }
    | { type: 'boolean' }
    | {
        type: 'array';
        items: { type: 'string'; enum: string[] };
        minItems?: number;
        maxItems?: number;
        uniqueItems?: true;
      }
  );
type WireComponent = Schemas['SurfaceComponent'];
type Component<T extends WireComponent['type']> = Extract<WireComponent, { type: T }>;
/**
 * One piece of an interactive Surface, shown in order. Lengths are Unicode code points; Sess
 * never truncates: a value over its limit is a 400 INVALID_SCHEMA whose `field`, `limit` and
 * `length` (on `SessError`) name the value and the most it may have.
 */
export type SurfaceComponent =
  | (Component<'heading'> & {
      /** A section heading: a few words; at most 60. Example: `Order details` */
      text: string;
    })
  | (Component<'text'> & {
      /**
       * A paragraph of plain text (never markup): what the person needs to know; at most 4000.
       * Example: `The refund goes back to the card used for the order.`
       */
      text: string;
    })
  | (Component<'record'> & {
      /** Optional caption above the record: a few words; at most 200. Example: `Order 1042` */
      label?: string;
      /**
       * Rows shown verbatim, 1–50. A row's name: a word or two; at most 40 (example `Amount`).
       * A row's value: a string of at most 200, or a number, boolean or null (example `$120.00`).
       */
      fields: { [key: string]: string | number | boolean | null };
    })
  | (Omit<Component<'field'>, 'schema'> & {
      /** What the field asks for: short, a few words; at most 60. Example: `Refund amount` */
      label: string;
      /**
       * Optional help under the label: one hint; at most 160.
       * Example: `Leave it as is to refund the full amount.`
       */
      description?: string;
      /** The words shown for one choice: short; at most 60. Example: `Next Monday` */
      option_labels?: { [key: string]: string };
      schema: FieldSchema;
    });
type DocumentedAction = RawPublishSessionRequest['interaction']['actions'][number] & {
  /** A button: a verb, 1–3 words; at most 24. Examples: `Approve`, `Send refund` */
  label: string;
};
/**
 * An interactive Surface: a title, plain-text components and typed fields, and 1–5 actions.
 * Limits in Unicode code points: title 80, description 280, heading 60, text 4000, record
 * caption 200, row name 40, row string value 200, field label 60, field help 160, option label
 * 60, button 24; at most 5 actions.
 */
export type InteractiveInteraction = Omit<RawPublishSessionRequest['interaction'], 'source' | 'actions'> & {
  /**
   * The page's heading: a question or a task, about 40 characters; at most 80.
   * Examples: `Approve the refund?`, `Pick a delivery date`
   */
  title: string;
  /**
   * Optional context under the title: what the person decides and why, in one or two plain
   * sentences; at most 280. Example: `The customer was charged twice for order 1042.`
   */
  description?: string;
  source: { kind: 'sess_surface'; components: SurfaceComponent[] };
  /** The buttons, 1–5. A button: a verb, 1–3 words; at most 24. */
  actions: DocumentedAction[];
};
export type CreateSessionRequest = {
  interaction: DisplayInteraction | InteractiveInteraction;
  /**
   * Advanced: how long the human link stays open, in whole seconds from creation: from 30 up to
   * the plan's link lifetime (the runtime checks the ceiling). Absent: the plan's lifetime. The
   * create response's `action_expires_at` is the link's deadline. On an interactive link of 20
   * hours or less the person may move it forward, up to the horizon a Session read reports
   * (`action_expires_horizon`, `link_state`); nothing else moves it.
   */
  expires_in?: number;
};
export type PublishSessionRequest = { interaction: InteractiveInteraction };

export interface ResponseMeta {
  status: number;
  requestId?: string;
  etag?: string;
  /** Authenticated resource workspace, when supplied by the runtime. */
  workspaceId?: string;
  attempts: number;
  idempotencyKey?: string;
  /**
   * The response's HTTP `Date` in milliseconds since the epoch (whole seconds), when the runtime
   * sent one: the runtime clock at or before the response. Used to observe link expiry.
   */
  serverDate?: number;
}
export interface ApiResult<T> {
  data: T;
  meta: ResponseMeta;
}
export interface VersionedResult<T> extends ApiResult<T> {
  meta: ResponseMeta & { etag: string };
}
export interface RequestEvent {
  operation: string;
  status?: number;
  code?: string;
  durationMs: number;
  attempt: number;
  requestId?: string;
}
export interface RequestOptions {
  signal?: AbortSignal;
  /** Deadline per attempt, including its response body. */
  timeoutMs?: number;
  /** Total logical-operation deadline, including credential resolution and retry delays. */
  operationTimeoutMs?: number;
  maxRetries?: number;
  maxResponseBytes?: number;
}
export interface MutationOptions extends RequestOptions {
  ifMatch: string;
  /** Persist with the original body/If-Match. Primitive string matching ^[A-Za-z0-9_.:-]{1,128}$. */
  idempotencyKey?: string;
}
export interface WaitOptions extends Omit<RequestOptions, 'timeoutMs'> {
  revision: number;
  /** Total human wait, default ten minutes. */
  timeoutMs?: number;
  intervalMs?: number;
  /** Each poll inherits the client's logical-operation budget unless overridden, bounded by the remaining human wait. */
  operationTimeoutMs?: number;
}
export interface WaitResult {
  session: InteractiveSession;
  response: AcceptedResponse;
  /** The ETag is for this current snapshot, even when response is historical. */
  meta: ResponseMeta & { etag: string };
}
export interface SessOptions {
  apiKey: string | undefined | (() => string | Promise<string>);
  baseUrl?: string;
  fetch?: typeof globalThis.fetch;
  timeoutMs?: number;
  operationTimeoutMs?: number;
  maxRetries?: number;
  maxResponseBytes?: number;
  receiptIssuer?: string;
  expectedWorkspaceId?: string;
  allowInsecureLocalhost?: boolean;
  onRequestEvent?: (event: Readonly<RequestEvent>) => void;
}

/** Narrow a retrieved display/interactive Session without asserting business data. */
export function isInteractiveSession(session: Session): session is InteractiveSession {
  return 'status' in session && session.interaction.mode === 'interactive';
}

/** Narrow immutable content before accessing interactive-only schema or actions. */
export function isInteractiveSurface(surface: SurfaceRevision): surface is InteractiveSurfaceRevision {
  return 'response_schema' in surface && surface.interaction.mode === 'interactive';
}
