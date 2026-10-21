import { SessError } from '../errors.js';
import { isInteractiveSurface } from '../types.js';
import type {
  AcceptedResponse,
  ApiResult,
  InteractiveSurfaceRevision,
  Session,
  SurfaceRevision,
  VersionedResult,
} from '../types.js';
import { ReceiptKeyCache } from './key-cache.js';
import {
  abortError,
  canonicalJson,
  deepFreeze,
  snapshotJson,
  verificationError,
  waitWithSignal,
  type DeepReadonly,
} from './json.js';
import {
  BUNDLED_RENDERER_IDENTITIES,
  MAX_RENDERER_IDENTITIES_BYTES,
  RENDERER_IDENTITIES_PATH,
  type RendererIdentitiesDocument,
} from './renderers.js';
import { MAX_RECEIPT_KEY_SET_BYTES, verifyDecisionReceipt, type ReceiptClaims } from './verify.js';

/**
 * The renderer identity a receipt names, read without trusting it: only to decide whether the
 * issuer's signed list is needed (the verifier decides). Undefined when it cannot be read.
 */
function namedRenderer(receipt: string): string | undefined {
  try {
    const claims: unknown = JSON.parse(
      Buffer.from(receipt.split('.')[1] ?? '', 'base64url').toString('utf8'),
    );
    const surface = (claims as { surface?: { renderer_version?: unknown } } | null)?.surface;
    return typeof surface?.renderer_version === 'string' ? surface.renderer_version : undefined;
  } catch {
    return undefined;
  }
}

export interface VerificationRequestOptions {
  signal?: AbortSignal;
  operationTimeoutMs?: number;
  timeoutMs?: number;
  maxRetries?: number;
}

interface Context {
  receiptIssuer: string;
  expectedWorkspaceId?: string;
  operationTimeoutMs: number;
  /** Stable configured API origin, used only to identify this trusted key source. */
  baseUrl?: string;
  retrieveSession: (id: string, options: VerificationRequestOptions) => Promise<VersionedResult<Session>>;
  retrieveSurface: (
    id: string,
    revision: number,
    options: VerificationRequestOptions,
  ) => Promise<ApiResult<SurfaceRevision>>;
  publicGet: (
    path: string,
    options: VerificationRequestOptions & { maxResponseBytes: number },
  ) => Promise<ApiResult<unknown>>;
}

export interface VerifyResponseInput {
  sessionId: string;
  response: AcceptedResponse;
  expectedWorkspaceId?: string;
}

export interface VerifiedResponse {
  claims: DeepReadonly<ReceiptClaims>;
  response: DeepReadonly<AcceptedResponse>;
  surface: DeepReadonly<InteractiveSurfaceRevision>;
}

export interface ReceiptResource {
  /** Full receipt verification with authorized current context and exact immutable revision. */
  verifyResponse(
    input: VerifyResponseInput,
    options?: VerificationRequestOptions,
  ): Promise<DeepReadonly<VerifiedResponse>>;
}

/** Internal bridge: all HTTP is supplied by the client's ordinary bounded transport. */
export function createReceiptResource(context: Context): ReceiptResource {
  // Copy configuration/callbacks; mutation of an application-owned config object has no effect.
  const issuer = context.receiptIssuer;
  const configuredWorkspace = context.expectedWorkspaceId;
  const defaultBudget = context.operationTimeoutMs;
  const retrieve = context.retrieveSession;
  const surfaceRead = context.retrieveSurface;
  const publicGet = context.publicGet;
  const keyPath = '/.well-known/sess-receipt-keys.json';
  const cache = new ReceiptKeyCache({
    issuer,
    keySource: `${context.baseUrl ?? 'configured-api-origin'}${keyPath}`,
    load: async (options) =>
      (await publicGet(keyPath, { ...options, maxResponseBytes: MAX_RECEIPT_KEY_SET_BYTES })).data,
  });
  return Object.freeze({
    async verifyResponse(
      input: VerifyResponseInput,
      options: VerificationRequestOptions = {},
    ): Promise<DeepReadonly<VerifiedResponse>> {
      const sessionId = input.sessionId;
      const response = snapshotJson(input.response);
      const requestedWorkspace = input.expectedWorkspaceId;
      const timeoutMs = options.timeoutMs;
      const maxRetries = options.maxRetries;
      const originalSignal = options.signal;
      const budget = options.operationTimeoutMs ?? defaultBudget;
      if (!Number.isSafeInteger(budget) || budget <= 0 || budget > 2_147_483_647) {
        throw new SessError(
          'configuration',
          'Receipt verification requires a finite positive operation timeout.',
        );
      }
      if (!response || response.receipt === null) {
        throw verificationError(
          'LEGACY_RECEIPT_UNAVAILABLE',
          'This accepted response has no verifiable receipt.',
        );
      }
      if (requestedWorkspace && configuredWorkspace && requestedWorkspace !== configuredWorkspace) {
        throw verificationError(
          'AUDIENCE_MISMATCH',
          'The supplied workspace differs from this client’s trusted workspace.',
        );
      }
      if (originalSignal?.aborted) throw abortError(originalSignal);
      const controller = new AbortController();
      const abort = () => controller.abort(originalSignal?.reason);
      originalSignal?.addEventListener('abort', abort, { once: true });
      const started = performance.now();
      const timer = setTimeout(
        () =>
          controller.abort(new SessError('timeout', 'Receipt verification exceeded its overall deadline.')),
        budget,
      );
      const requestOptions = (): VerificationRequestOptions => {
        if (controller.signal.aborted) throw abortError(controller.signal);
        const remaining = Math.floor(budget - (performance.now() - started));
        if (remaining <= 0) {
          controller.abort(new SessError('timeout', 'Receipt verification exceeded its overall deadline.'));
          throw abortError(controller.signal);
        }
        return {
          signal: controller.signal,
          operationTimeoutMs: remaining,
          ...(timeoutMs !== undefined ? { timeoutMs } : {}),
          ...(maxRetries !== undefined ? { maxRetries } : {}),
        };
      };
      try {
        const current = await waitWithSignal(retrieve(sessionId, requestOptions()), controller.signal);
        // Copy at the read boundary; transport adapters must not be able to mutate verified data later.
        const currentSnapshot = snapshotJson(current);
        const trustedWorkspace =
          requestedWorkspace ?? configuredWorkspace ?? currentSnapshot.meta.workspaceId;
        if (typeof trustedWorkspace !== 'string' || trustedWorkspace.length === 0) {
          throw verificationError(
            'VERIFICATION_CONTEXT_MISSING',
            'Provide expectedWorkspaceId or use a runtime that returns authenticated Sess-Workspace-Id context.',
          );
        }
        if (
          currentSnapshot.meta.workspaceId !== undefined &&
          currentSnapshot.meta.workspaceId !== trustedWorkspace
        ) {
          throw verificationError(
            'AUDIENCE_MISMATCH',
            'The authorized resource belongs to a different workspace.',
          );
        }
        if (currentSnapshot.data.id !== sessionId || !('responses' in currentSnapshot.data)) {
          throw verificationError(
            'RECORD_BINDING_MISMATCH',
            'The authorized Session does not contain this accepted response.',
          );
        }
        const retained = currentSnapshot.data.responses.filter(
          (candidate) => candidate.event_id === response.event_id,
        );
        if (retained.length !== 1 || canonicalJson(retained[0]) !== canonicalJson(response)) {
          throw verificationError(
            'RECORD_BINDING_MISMATCH',
            'The supplied response does not match the authorized accepted record.',
          );
        }
        const retrievedSurface = await waitWithSignal(
          surfaceRead(sessionId, response.revision, requestOptions()),
          controller.signal,
        );
        const surface = snapshotJson(retrievedSurface.data);
        if (surface.id !== sessionId || surface.revision !== response.revision) {
          throw verificationError(
            'RECORD_BINDING_MISMATCH',
            'The retrieved Surface is not the requested immutable revision.',
          );
        }
        if (!isInteractiveSurface(surface)) {
          throw verificationError(
            'RECORD_BINDING_MISMATCH',
            'An accepted response requires an interactive immutable Surface.',
          );
        }
        // Decision 0009 Amendment 13: a renderer identity this release does not bundle is
        // accepted only on the issuer's signed list, fetched from the same API origin as the keys.
        const renderer = namedRenderer(response.receipt);
        let rendererIdentities: RendererIdentitiesDocument | undefined;
        if (renderer !== undefined && !BUNDLED_RENDERER_IDENTITIES.includes(renderer)) {
          const listed = await waitWithSignal(
            publicGet(RENDERER_IDENTITIES_PATH, {
              ...requestOptions(),
              maxResponseBytes: MAX_RENDERER_IDENTITIES_BYTES,
            }),
            controller.signal,
          );
          rendererIdentities = listed.data as RendererIdentitiesDocument;
        }
        const claims = await verifyDecisionReceipt(
          {
            receipt: response.receipt,
            ...(rendererIdentities !== undefined ? { rendererIdentities } : {}),
            issuer,
            audience: trustedWorkspace,
            expected: {
              sessionId,
              eventId: response.event_id,
              revision: response.revision,
              actionId: response.action_id,
              acceptedAt: response.accepted_at,
            },
            input: response.data,
            interaction: surface.interaction,
            keyResolver: (resolverContext) =>
              cache.resolve({
                ...resolverContext,
                ...(timeoutMs !== undefined ? { timeoutMs } : {}),
                ...(maxRetries !== undefined ? { maxRetries } : {}),
              }),
          },
          { signal: controller.signal },
        );
        if (response.actor.assurance !== 'link_holder') {
          throw verificationError(
            'ACTOR_BINDING_MISMATCH',
            'The accepted response has an unsupported actor assurance.',
          );
        }
        return deepFreeze({ claims, response, surface });
      } finally {
        clearTimeout(timer);
        originalSignal?.removeEventListener('abort', abort);
      }
    },
  });
}
