import { SessAdapterError, fail } from './errors.js';

/**
 * The subset of the public OpenClaw 2026.10.3 `OpenClawPluginToolContext<2>` this adapter reads
 * (documented in docs/plugins/tool-plugins.md of the released artifact). Field names are the
 * host's own; nothing here is parsed out of a session-key string.
 */
export interface HostToolContext {
  agentId?: unknown;
  sessionKey?: unknown;
  /** Host doc: "Ephemeral session UUID - regenerated on /new and /reset." */
  sessionId?: unknown;
  assertInvocationCurrent?: unknown;
  assertMemoryAudienceCurrent?: unknown;
}

/** Exact admitted conversation incarnation an interaction is bound to. */
export interface HostBinding {
  readonly agentId: string;
  readonly sessionKey: string;
  readonly sessionId: string;
}

/** One admitted tool invocation. Never shared between invocations, never serialized. */
export interface InvocationLease {
  readonly binding: HostBinding;
  readonly signal?: AbortSignal;
  /** Throws AUTHORITY_REVOKED once the host revokes this invocation or its session incarnation. */
  assertCurrent(): void;
}

function identity(value: unknown): string | undefined {
  return typeof value === 'string' &&
    value.length > 0 &&
    value.length <= 512 &&
    !/[\u0000-\u001f\u007f]/.test(value)
    ? value
    : undefined;
}

/**
 * Captures the host binding during the admitted call. A missing live guard or identity blocks
 * the profile (spec 5.3): no always-true fallback and no identity inferred from strings.
 */
export function captureInvocation(context: HostToolContext, signal?: AbortSignal): InvocationLease {
  const guard = context.assertInvocationCurrent;
  if (typeof guard !== 'function')
    fail('HOST_CAPABILITY_MISSING', 'This OpenClaw host did not supply a live invocation guard.');
  const audienceGuard =
    typeof context.assertMemoryAudienceCurrent === 'function'
      ? context.assertMemoryAudienceCurrent
      : undefined;
  const agentId = identity(context.agentId);
  const sessionKey = identity(context.sessionKey);
  const sessionId = identity(context.sessionId);
  if (!agentId || !sessionKey || !sessionId)
    fail(
      'HOST_BINDING_UNAVAILABLE',
      'Sess tools need an admitted agent conversation with host-provided agent, session and incarnation identity.',
    );
  const binding = Object.freeze({ agentId, sessionKey, sessionId });
  const assertCurrent = () => {
    if (signal?.aborted) throw new SessAdapterError('CANCELLED', 'The tool call was cancelled.');
    try {
      (guard as () => void)();
      audienceGuard?.();
    } catch {
      throw new SessAdapterError('AUTHORITY_REVOKED', 'The host revoked this tool invocation.');
    }
  };
  assertCurrent();
  return Object.freeze({ binding, ...(signal ? { signal } : {}), assertCurrent });
}

export function sameBinding(a: HostBinding, b: HostBinding): boolean {
  return a.agentId === b.agentId && a.sessionKey === b.sessionKey && a.sessionId === b.sessionId;
}
