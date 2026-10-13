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
export type SurfaceComponent =
  | Exclude<WireComponent, { type: 'field' }>
  | (Omit<Extract<WireComponent, { type: 'field' }>, 'schema'> & { schema: FieldSchema });
export type InteractiveInteraction = Omit<RawPublishSessionRequest['interaction'], 'source'> & {
  source: { kind: 'sess_surface'; components: SurfaceComponent[] };
};
export type CreateSessionRequest = { interaction: DisplayInteraction | InteractiveInteraction };
export type PublishSessionRequest = { interaction: InteractiveInteraction };

export interface ResponseMeta {
  status: number;
  requestId?: string;
  etag?: string;
  /** Authenticated resource workspace, when supplied by the runtime. */
  workspaceId?: string;
  attempts: number;
  idempotencyKey?: string;
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
  /** Persist this with the original body and If-Match before a durable operation. */
  idempotencyKey?: string;
}
export interface WaitOptions extends Omit<RequestOptions, 'timeoutMs'> {
  revision: number;
  /** Total human wait, default ten minutes. */
  timeoutMs?: number;
  intervalMs?: number;
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
