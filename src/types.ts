import type { components } from './generated/openapi.js';
import type { RevisionEnvelope } from './receipts/envelope.js';

/** Unmodified types generated from the reviewed public HTTP contract. */
export type { components, paths, operations } from './generated/openapi.js';
export type { RevisionEnvelope } from './receipts/envelope.js';
type Schemas = components['schemas'];
export type RawCreateSessionRequest = Schemas['CreateSessionRequest'];
export type RawPublishSessionRequest = Schemas['PatchSessionRequest'];
export type CreateSessionResponse = Schemas['CreateSessionResponse'];
export type DisplaySession = Schemas['SessionResponse'];
/**
 * Receipt v2 (receipt-v2 §2): `revision_envelope` is written by hand beside the generated
 * contract types. It is present beside a receipt v2 and absent beside a receipt v1.
 */
interface RevisionEnvelopeMember {
  /**
   * The revision envelope the receipt v2 commits to (`surface.revision_hash`): when the revision
   * was published and, when one of your API keys published it, that key's ID and its label at the
   * time. `receipts.verifyResponse` verifies the receipt with it. Absent beside a receipt v1.
   */
  revision_envelope?: RevisionEnvelope;
}
type GeneratedInteractiveSession = Schemas['InteractiveSessionResponse'];
type GeneratedSessionEvents = Schemas['SessionEventsResponse'];
export type AcceptedResponse = GeneratedInteractiveSession['responses'][number] & RevisionEnvelopeMember;
export type InteractiveSession = Omit<GeneratedInteractiveSession, 'responses'> & {
  responses: AcceptedResponse[];
};
export type Session = DisplaySession | InteractiveSession;
export type DisplaySurfaceRevision = Schemas['SessionResponse'];
export type InteractiveSurfaceRevision = Schemas['InteractiveSurfaceResponse'];
export type SurfaceRevision = DisplaySurfaceRevision | InteractiveSurfaceRevision;
/** One Event of `GET /v1/sessions/{id}/events`; `revision_envelope` on `response.accepted` only. */
export type SessionEvent = GeneratedSessionEvents['events'][number] & RevisionEnvelopeMember;
export type SessionEvents = Omit<GeneratedSessionEvents, 'events'> & { events: SessionEvent[] };
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
/** The role of a totals line: how Sess checks the arithmetic, never a colour. */
export type ItemTotalRole =
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
/**
 * Line items with amounts and totals (Commerce): the runtime's `items` component, as sent. Amounts
 * are whole numbers in the currency's minor unit (cents for USD, yen for JPY, fils for BHD), one
 * ISO 4217 currency per component; Sess never rounds, converts or computes them, and checks a
 * stated subtotal, total and amount due exactly. Build one with `items()` or a Commerce builder.
 */
export interface ItemsComponent {
  type: 'items';
  /** Optional caption: what the list is, a few words; at most 200. Example: `Invoice 2041` */
  label?: string;
  /** ISO 4217 code with known minor units, such as `CAD`, `JPY` or `BHD`. */
  currency: string;
  /** The person may choose rows: one (radios) or many (checkboxes). Needs `name`. */
  select?: 'one' | 'many';
  /** The person may change the quantity of rows that carry one. Needs `name` and a `request_change` action. */
  editable?: ['quantity'];
  /** The answer's name, `^[a-z][a-z0-9_]{0,55}$`, with `select` or `editable` only. */
  name?: string;
  /** 1–100 rows, in order. */
  rows: {
    /** What one line is: at most 80. Example: `Design retainer, October` */
    name: string;
    /** Optional second line: quantity, unit price or a reference; at most 160. Example: `3 × $150.00` */
    detail?: string;
    /** An editable quantity (with `editable`): an integer 0–1,000,000 within `min` and `max`. */
    quantity?: { value: number; unit?: string; min?: number; max?: number };
    /** Minor units, |amount| ≤ 10^15, or null for a line with no amount. */
    amount: number | null;
  }[];
  /** Up to 8 totals lines, in order, as stated. A label: a word or two; at most 40. */
  totals?: { label: string; amount: number; role: ItemTotalRole; included?: boolean }[];
}
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
      /**
       * A rating: with it the schema must be exactly `{ type: 'integer', minimum: 1, maximum: N }`,
       * N from 2 to 10 (stars up to 5, numbered choices above; the answer is the integer).
       * `low` and `high` are optional words at the two ends: a word or two; at most 24 each.
       */
      rating?: { low?: string; high?: string };
      schema: FieldSchema;
    })
  | ItemsComponent;
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
  /**
   * Advanced: one BCP 47 locale for formatting this page's amounts (default: the page's language,
   * `en`). It does not translate the page. Example: `en-CA`
   */
  locale?: string;
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

// The Ask (Sess Decision 0011): one link that many people can answer, each on their own page.
// Hand-written from the Sess contract (`packages/spec/src/asks.ts`) until the reviewed contract
// snapshot carries `/v1/asks`; then these become aliases of the generated schemas.

/** `POST /v1/asks`: round one as an interactive create takes it, plus the respondents. */
export interface CreateAskRequest {
  interaction: InteractiveInteraction;
  respondents: {
    /**
     * How many people may start: at least 2, at most the plan's active-Session limit (Free 25,
     * Starter 50, Pro 100; a trial Ask 2). Exact: it is checked when a person starts.
     */
    max: number;
    /** Advanced: one required "Your name" text field, named `name`, before the first field. Default false. */
    name?: boolean;
  };
  /** Advanced: the one deadline, whole seconds from creation, 30 up to the plan's link lifetime. Absent: that lifetime. */
  expires_in?: number;
  /** Advanced: each respondent's link life from their Start, at least 30 seconds, clamped to what remains. Absent: what remains of the Ask. */
  respondent_expires_in?: number;
  /** Advanced: default true, a respondent's Session completes when its answer is accepted. */
  auto_complete?: boolean;
}
export interface CreateAskResponse {
  id: string;
  revision: number;
  /** The link to share with everyone who should answer. Returned once; keep it out of logs. */
  human_url: string;
  /** The Ask's deadline (ISO 8601): from it no one new may start. */
  action_expires_at: string;
  max: number;
}
/** Derived at read time: Starts admitted, respondents answered and completed, Starts refused by reason. */
export interface AskCounts {
  started: number;
  answered: number;
  completed: number;
  refused: {
    full: number;
    closed: number;
    deadline: number;
    minimum_time: number;
    burst: number;
    paused: number;
    network: number;
  };
}
/** One respondent as `GET /v1/asks/{id}` lists it: an ordinary Session, or its tombstone once purged. */
export interface AskRespondentRecord {
  id: string;
  status: 'active' | 'responded' | 'completed' | 'purged';
  revision: number;
  started_at: string;
  completed_at: string | null;
  /** Every accepted answer, in order (none for a tombstone). */
  responses: AcceptedResponse[];
}
/** `POST /v1/asks/{id}/close`: the Ask after the close (no answers). */
export interface AskCloseResponse {
  id: string;
  status: 'open' | 'closed';
  /** Which closed it: `max` (the last place was started), `owner` (you) or `deadline`. Null while open. */
  closed_by: 'max' | 'owner' | 'deadline' | null;
  closed_at: string | null;
  max: number;
  action_expires_at: string;
  auto_complete: boolean;
  counts: AskCounts;
}
/** `GET /v1/asks/{id}`: one page of respondents in Start order. */
export interface AskResponse extends AskCloseResponse {
  sessions: AskRespondentRecord[];
  /** Pass as `cursor` to read the next page; null on the last page. */
  next_cursor: string | null;
}

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
  /**
   * Product tokens of a client built on this SDK, sent before the SDK's own in the User-Agent
   * header: `'my-app/1.2.0'` sends `my-app/1.2.0 sess-sdk/<version> node/<version>`. One or more
   * `name` or `name/version` tokens separated by single spaces, at most 256 characters.
   */
  userAgent?: string;
}

/** Narrow a retrieved display/interactive Session without asserting business data. */
export function isInteractiveSession(session: Session): session is InteractiveSession {
  return 'status' in session && session.interaction.mode === 'interactive';
}

/** Narrow immutable content before accessing interactive-only schema or actions. */
export function isInteractiveSurface(surface: SurfaceRevision): surface is InteractiveSurfaceRevision {
  return 'response_schema' in surface && surface.interaction.mode === 'interactive';
}
