import { compactVerify, importJWK } from 'jose';
import type { InteractiveSurfaceRevision } from '../types.js';
import {
  abortError,
  canonicalJson,
  checkedInstant,
  deepFreeze,
  exactKeys,
  isRecord,
  jsonDigest,
  snapshotJson,
  verificationError,
  waitWithSignal,
  type DeepReadonly,
} from './json.js';
import {
  BUNDLED_RENDERER_IDENTITIES,
  verifyRendererList,
  type RendererIdentitiesDocument,
  type RendererList,
} from './renderers.js';

export const MAX_RECEIPT_BYTES = 64 * 1024;
export const MAX_RECEIPT_KEY_SET_BYTES = 256 * 1024;
const MAX_KEYS = 64;
const KID = /^[A-Za-z0-9._-]{1,64}$/;
const SESSION_ID = /^ses_[0-9A-HJKMNP-TV-Z]{26}$/;
const EVENT_ID = /^evt_[0-9A-HJKMNP-TV-Z]{26}$/;
const ACTION_ID = /^[a-z][a-z0-9_]{0,31}$/;
const DIGEST = /^sha256:[0-9a-f]{64}$/;

/** Public Ed25519 verification material; private JWK parameters are refused. */
export interface ReceiptPublicKey {
  kty: 'OKP';
  crv: 'Ed25519';
  x: string;
  kid: string;
  alg?: 'EdDSA';
  use?: 'sig';
  key_ops?: readonly 'verify'[];
  ext?: boolean;
}

export interface ReceiptKeySet {
  keys: readonly ReceiptPublicKey[];
}

/** A resolver is explicitly trusted application configuration, never JWT URL discovery. */
export type ReceiptKeyResolver = (context: {
  readonly kid: string;
  readonly issuer: string;
  readonly signal?: AbortSignal;
}) => ReceiptKeySet | Promise<ReceiptKeySet>;

export interface ReceiptClaims {
  sess_receipt: 1;
  iss: string;
  aud: string;
  jti: string;
  iat: number;
  exp: number;
  accepted_at: string;
  workspace_id: string;
  session_id: string;
  step_id: string;
  event_id: string;
  /**
   * `renderer_version`: the renderer identity the revision was shown under (Decision 0009
   * Amendment 13): one this release bundles, or one on a list signed by the issuer's trusted keys.
   */
  surface: { revision: number; hash: string; renderer_version: string };
  action: { id: string; label: string; summary: string };
  input_hash: string;
  actor: { assurance: 'link_holder'; subject: string };
  return_binding: { recipient: string; return_channel_id: null };
}

export interface VerifyDecisionReceiptInput {
  receipt: string | null;
  /** Trusted protocol identity, independently configured. */
  issuer: string;
  /** Trusted resource workspace, never read from an unverified receipt. */
  audience: string;
  expected: {
    sessionId: string;
    eventId: string;
    revision: number;
    actionId: string;
    acceptedAt: string;
  };
  input: Record<string, unknown>;
  /** The complete normalized `interaction` from the immutable Surface endpoint. */
  interaction: InteractiveSurfaceRevision['interaction'];
  keys?: ReceiptKeySet;
  keyResolver?: ReceiptKeyResolver;
  /**
   * The issuer's signed renderer-identity list (`/.well-known/sess-renderer-identities.json`),
   * needed only for a receipt whose renderer identity this release does not bundle. It is trusted
   * only through its signature under the same trusted keys and issuer.
   */
  rendererIdentities?: RendererIdentitiesDocument;
}

export interface VerifyDecisionReceiptOptions {
  /** An explicit verification instant, useful for deliberate archival verification/tests. */
  now?: Date;
  /** Issued-time tolerance only, 0–60 seconds. Expiry never receives a grace interval. */
  issuedAtToleranceSeconds?: number;
  signal?: AbortSignal;
}

function identifier(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length > 0 &&
    value.length <= 200 &&
    !/[\s\u0000-\u001f\u007f-\u009f]/.test(value)
  );
}

/** Validates and copies the whole set, not merely the key selected by the token. */
export function validateKeySet(raw: unknown): ReceiptKeySet {
  const value = snapshotJson(raw);
  if (
    !isRecord(value) ||
    !exactKeys(value, ['keys']) ||
    !Array.isArray(value.keys) ||
    value.keys.length === 0 ||
    value.keys.length > MAX_KEYS ||
    Buffer.byteLength(canonicalJson(value), 'utf8') > MAX_RECEIPT_KEY_SET_BYTES
  ) {
    throw verificationError(
      'INVALID_KEY_SET',
      'The trusted receipt key set is malformed or exceeds its safety limit.',
    );
  }
  const seen = new Set<string>();
  for (const key of value.keys) {
    if (
      !isRecord(key) ||
      Object.keys(key).some(
        (name) => !['kty', 'crv', 'x', 'kid', 'alg', 'use', 'key_ops', 'ext'].includes(name),
      ) ||
      key.kty !== 'OKP' ||
      key.crv !== 'Ed25519' ||
      typeof key.kid !== 'string' ||
      !KID.test(key.kid) ||
      typeof key.x !== 'string' ||
      !/^[A-Za-z0-9_-]{43}$/.test(key.x) ||
      Buffer.from(key.x, 'base64url').length !== 32 ||
      Buffer.from(key.x, 'base64url').toString('base64url') !== key.x ||
      (key.alg !== undefined && key.alg !== 'EdDSA') ||
      (key.use !== undefined && key.use !== 'sig') ||
      (key.key_ops !== undefined &&
        (!Array.isArray(key.key_ops) || key.key_ops.length !== 1 || key.key_ops[0] !== 'verify')) ||
      (key.ext !== undefined && typeof key.ext !== 'boolean')
    ) {
      throw verificationError(
        'INVALID_PUBLIC_KEY',
        'Receipt keys must be unambiguous public Ed25519 verification keys.',
      );
    }
    if (seen.has(key.kid))
      throw verificationError('DUPLICATE_KEY_ID', 'The trusted key set contains duplicate key IDs.');
    seen.add(key.kid);
  }
  return deepFreeze(value) as unknown as ReceiptKeySet;
}

function decodeSegment(segment: string): string {
  const bytes = Buffer.from(segment, 'base64url');
  if (bytes.toString('base64url') !== segment)
    throw verificationError('MALFORMED_RECEIPT', 'The receipt is not canonical base64url.');
  try {
    return new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes);
  } catch {
    throw verificationError('MALFORMED_RECEIPT', 'The receipt does not contain valid UTF-8 JSON.');
  }
}

/** Header fields have only string values; reject duplicate names before JOSE parsing. */
function headerOf(encoded: string): { alg: string; kid: string; typ: string } {
  let parsed: unknown;
  const text = decodeSegment(encoded);
  try {
    parsed = JSON.parse(text);
  } catch {
    throw verificationError('MALFORMED_RECEIPT', 'The receipt protected header is not JSON.');
  }
  if (
    !isRecord(parsed) ||
    !exactKeys(parsed, ['alg', 'kid', 'typ']) ||
    typeof parsed.alg !== 'string' ||
    typeof parsed.typ !== 'string' ||
    typeof parsed.kid !== 'string' ||
    !KID.test(parsed.kid)
  ) {
    throw verificationError(
      'UNSUPPORTED_HEADER',
      'The receipt protected header has missing or unsupported fields.',
    );
  }
  // Tokenize JSON strings, punctuation and whitespace. The exact shape above allows only
  // {string:string,...}; six string tokens means precisely three names and three values.
  const strings = text.match(/"(?:[^"\\\u0000-\u001f]|\\(?:["\\/bfnrt]|u[0-9a-fA-F]{4}))*"/g);
  if (strings?.length !== 6)
    throw verificationError('UNSUPPORTED_HEADER', 'Duplicate receipt header fields are not supported.');
  if (parsed.alg !== 'EdDSA')
    throw verificationError('UNSUPPORTED_ALGORITHM', 'The receipt must use the supported EdDSA algorithm.');
  if (parsed.typ !== 'sess-receipt+jwt')
    throw verificationError('UNSUPPORTED_TYPE', 'The receipt has an unsupported protected type.');
  return parsed as { alg: string; kid: string; typ: string };
}

function claimsOf(raw: unknown): ReceiptClaims {
  if (!isRecord(raw) || raw.sess_receipt !== 1) {
    throw verificationError('UNSUPPORTED_RECEIPT_VERSION', 'Only receipt format version 1 is supported.');
  }
  const top = [
    'sess_receipt',
    'iss',
    'aud',
    'jti',
    'iat',
    'exp',
    'accepted_at',
    'workspace_id',
    'session_id',
    'step_id',
    'event_id',
    'surface',
    'action',
    'input_hash',
    'actor',
    'return_binding',
  ];
  const surface = raw.surface;
  const action = raw.action;
  const actor = raw.actor;
  const binding = raw.return_binding;
  if (
    !exactKeys(raw, top) ||
    ![raw.iss, raw.aud, raw.jti, raw.workspace_id, raw.session_id, raw.step_id, raw.event_id].every(
      identifier,
    ) ||
    !Number.isSafeInteger(raw.iat) ||
    !Number.isSafeInteger(raw.exp) ||
    (raw.iat as number) < 0 ||
    (raw.exp as number) <= (raw.iat as number) ||
    checkedInstant(raw.accepted_at) === undefined ||
    !isRecord(surface) ||
    !exactKeys(surface, ['revision', 'hash', 'renderer_version']) ||
    !Number.isSafeInteger(surface.revision) ||
    (surface.revision as number) < 1 ||
    typeof surface.hash !== 'string' ||
    !DIGEST.test(surface.hash) ||
    !isRecord(action) ||
    !exactKeys(action, ['id', 'label', 'summary']) ||
    !identifier(action.id) ||
    typeof action.label !== 'string' ||
    action.label.length === 0 ||
    typeof action.summary !== 'string' ||
    typeof raw.input_hash !== 'string' ||
    !DIGEST.test(raw.input_hash) ||
    !isRecord(actor) ||
    !exactKeys(actor, ['assurance', 'subject']) ||
    !isRecord(binding) ||
    !exactKeys(binding, ['recipient', 'return_channel_id'])
  ) {
    throw verificationError('INVALID_CLAIMS', 'The receipt claims do not match the supported format.');
  }
  // Membership (bundled or on a signed list) is checked once the signature holds.
  if (typeof surface.renderer_version !== 'string' || !identifier(surface.renderer_version)) {
    throw verificationError('UNSUPPORTED_RENDERER', 'The receipt names an unsupported renderer version.');
  }
  if (actor.assurance !== 'link_holder' || !identifier(actor.subject)) {
    throw verificationError('UNSUPPORTED_ACTOR', 'The receipt actor assurance or subject is unsupported.');
  }
  if (!identifier(binding.recipient) || binding.return_channel_id !== null) {
    throw verificationError('RETURN_BINDING_MISMATCH', 'The receipt return binding is unsupported.');
  }
  return raw as unknown as ReceiptClaims;
}

/**
 * Fully verifies a version-1 receipt and its exact accepted record. Explicit keys make this
 * function entirely offline. A valid receipt attests the accepted record, not business authority.
 */
export async function verifyDecisionReceipt(
  input: VerifyDecisionReceiptInput,
  options: VerifyDecisionReceiptOptions = {},
): Promise<DeepReadonly<ReceiptClaims>> {
  // Capture all caller-owned data and options before a resolver can yield control.
  if (input?.receipt === null)
    throw verificationError(
      'LEGACY_RECEIPT_UNAVAILABLE',
      'This accepted response has no verifiable receipt.',
    );
  if (
    typeof input?.receipt !== 'string' ||
    input.receipt.length > MAX_RECEIPT_BYTES ||
    !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(input.receipt)
  ) {
    throw verificationError(
      'MALFORMED_RECEIPT',
      'The receipt is malformed or exceeds the 64 KiB safety limit.',
    );
  }
  const receipt = input.receipt;
  const issuer = input.issuer;
  const audience = input.audience;
  if (!identifier(issuer) || !identifier(audience)) {
    throw verificationError(
      'VERIFICATION_CONTEXT_MISSING',
      'A trusted issuer and expected resource workspace are required.',
    );
  }
  const expected = snapshotJson(input.expected);
  const acceptedInput = snapshotJson(input.input);
  const interaction = snapshotJson(input.interaction);
  const resolver = input.keyResolver;
  const keys = input.keys === undefined ? undefined : validateKeySet(input.keys);
  const rendererList =
    input.rendererIdentities === undefined ? undefined : snapshotJson(input.rendererIdentities);
  if (
    (keys === undefined) === (resolver === undefined) ||
    (resolver !== undefined && typeof resolver !== 'function')
  ) {
    throw verificationError(
      'VERIFICATION_CONTEXT_MISSING',
      'Provide exactly one trusted public key set or key resolver.',
    );
  }
  const signal = options.signal;
  const now =
    options.now === undefined ? Date.now() : options.now instanceof Date ? options.now.getTime() : NaN;
  const tolerance = options.issuedAtToleranceSeconds ?? 60;
  if (!Number.isFinite(now) || !Number.isFinite(tolerance) || tolerance < 0 || tolerance > 60) {
    throw verificationError(
      'INVALID_VERIFICATION_OPTIONS',
      'Use a valid verification time and issued-time tolerance between 0 and 60 seconds.',
    );
  }
  if (signal?.aborted) throw abortError(signal);
  if (
    !isRecord(expected) ||
    !SESSION_ID.test(expected.sessionId) ||
    !EVENT_ID.test(expected.eventId) ||
    !Number.isSafeInteger(expected.revision) ||
    expected.revision < 1 ||
    !ACTION_ID.test(expected.actionId) ||
    checkedInstant(expected.acceptedAt) === undefined ||
    !isRecord(acceptedInput) ||
    !isRecord(interaction) ||
    interaction.mode !== 'interactive' ||
    interaction.response_policy !== 'first' ||
    !Array.isArray(interaction.actions) ||
    !isRecord(interaction.source) ||
    interaction.source.kind !== 'sess_surface' ||
    !Array.isArray(interaction.source.components)
  ) {
    throw verificationError(
      'INVALID_VERIFICATION_INPUT',
      'Verification requires an accepted record and its complete normalized immutable interaction.',
    );
  }
  const parts = receipt.split('.') as [string, string, string];
  const header = headerOf(parts[0]);
  let raw: unknown;
  const payloadText = decodeSegment(parts[1]);
  try {
    raw = JSON.parse(payloadText);
  } catch {
    throw verificationError('MALFORMED_RECEIPT', 'The receipt payload is not JSON.');
  }
  const claims = claimsOf(snapshotJson(raw));
  if (canonicalJson(claims) !== payloadText) {
    throw verificationError(
      'NON_CANONICAL_PAYLOAD',
      'The signed receipt payload must be RFC 8785 canonical JSON.',
    );
  }
  if (claims.iss !== issuer)
    throw verificationError('ISSUER_MISMATCH', 'The receipt issuer does not match the trusted issuer.');
  if (
    claims.aud !== audience ||
    claims.workspace_id !== audience ||
    claims.return_binding.recipient !== audience
  ) {
    throw verificationError(
      'AUDIENCE_MISMATCH',
      'The receipt does not belong to the expected resource workspace.',
    );
  }
  if (
    claims.session_id !== expected.sessionId ||
    claims.event_id !== expected.eventId ||
    claims.jti !== expected.eventId ||
    claims.step_id !== `rev_${expected.revision}` ||
    claims.surface.revision !== expected.revision
  ) {
    throw verificationError(
      'RECORD_BINDING_MISMATCH',
      'The receipt does not bind the expected Session, event and revision.',
    );
  }
  if (claims.actor.subject !== `${audience}:human_link:${expected.sessionId}`) {
    throw verificationError(
      'ACTOR_BINDING_MISMATCH',
      'The receipt actor is not bound to this resource workspace and Session.',
    );
  }
  const acceptedAt = checkedInstant(claims.accepted_at) as number;
  if (claims.accepted_at !== expected.acceptedAt || Math.floor(acceptedAt / 1000) !== claims.iat) {
    throw verificationError(
      'ACCEPTED_TIME_MISMATCH',
      'The receipt acceptance time does not match the accepted record.',
    );
  }
  if (claims.exp * 1000 <= now)
    throw verificationError('RECEIPT_EXPIRED', 'The receipt has expired at the verification time.');
  if (acceptedAt > now + tolerance * 1000 || claims.iat * 1000 > now + tolerance * 1000) {
    throw verificationError(
      'RECEIPT_FROM_FUTURE',
      'The receipt was issued after the allowed clock tolerance.',
    );
  }
  const actions = interaction.actions.filter((action) => isRecord(action) && action.id === expected.actionId);
  const action = actions[0];
  if (
    actions.length !== 1 ||
    !action ||
    claims.action.id !== expected.actionId ||
    claims.action.label !== action.label ||
    claims.action.summary !== (action.intent ?? '')
  ) {
    throw verificationError(
      'ACTION_BINDING_MISMATCH',
      'The receipt action does not match its immutable Surface action.',
    );
  }
  if (claims.surface.hash !== jsonDigest(interaction)) {
    throw verificationError(
      'SURFACE_HASH_MISMATCH',
      'The receipt does not bind the complete immutable interaction.',
    );
  }
  if (claims.input_hash !== jsonDigest(acceptedInput)) {
    throw verificationError('INPUT_HASH_MISMATCH', 'The receipt does not bind the accepted typed input.');
  }
  const keyFor = trustedKeyLookup(keys, resolver, issuer, signal);
  const publicKey = await keyFor(header.kid);
  if (!publicKey)
    throw verificationError('UNKNOWN_KEY_ID', 'The receipt signing key is not in the trusted key set.');
  try {
    const key = await waitWithSignal(
      importJWK({ ...publicKey, key_ops: ['verify'], ext: false }, 'EdDSA'),
      signal,
    );
    await waitWithSignal(compactVerify(receipt, key, { algorithms: ['EdDSA'] }), signal);
  } catch {
    if (signal?.aborted) throw abortError(signal);
    throw verificationError(
      'INVALID_SIGNATURE',
      'The receipt signature did not verify with the trusted Ed25519 key.',
    );
  }
  // Decision 0009 Amendment 13: the renderer identity is one this release bundles, or one on the
  // issuer's list that verifies under the same trusted keys.
  const renderer = claims.surface.renderer_version;
  if (!BUNDLED_RENDERER_IDENTITIES.includes(renderer)) {
    // A list proves the identities it holds; an identity it does not hold is unsupported, never
    // accepted by fallback (an older list says nothing about what was added since).
    const listed =
      rendererList === undefined
        ? []
        : (await verifyRendererList(rendererList, { issuer, keyFor, ...(signal ? { signal } : {}) }))
            .identities;
    if (!listed.some((identity) => identity.renderer_version === renderer)) {
      throw verificationError(
        'UNSUPPORTED_RENDERER',
        'The receipt names a renderer identity that is not on the issuer’s signed list.',
      );
    }
  }
  return deepFreeze(claims);
}

/** Resolves a kid to a trusted key: from the explicit set, or the trusted resolver (validated). */
function trustedKeyLookup(
  keys: ReceiptKeySet | undefined,
  resolver: ReceiptKeyResolver | undefined,
  issuer: string,
  signal: AbortSignal | undefined,
): (kid: string) => Promise<ReceiptPublicKey | undefined> {
  return async (kid) => {
    let trusted = keys;
    if (!trusted && resolver) {
      let resolved: ReceiptKeySet;
      try {
        resolved = await waitWithSignal(
          Promise.resolve(resolver(Object.freeze({ kid, issuer, ...(signal ? { signal } : {}) }))),
          signal,
        );
      } catch {
        if (signal?.aborted) throw abortError(signal);
        // Callback failures may contain arbitrary application or upstream material,
        // including caller-created SessError instances. Do not forward their fields.
        throw verificationError(
          'KEY_RESOLUTION_FAILED',
          'The trusted receipt key resolver could not supply verification keys.',
        );
      }
      trusted = validateKeySet(resolved);
    }
    return trusted?.keys.find((key) => key.kid === kid);
  };
}

/**
 * Verifies an issuer's signed renderer-identity list (Decision 0009 Amendment 13) under the keys
 * you trust for that issuer: exactly one of `keys` or `keyResolver`. Offline with explicit keys.
 * Returns the verified edition: `seq` (order lists by it; see newerRendererList), `iat` and the
 * listed identities, in order.
 */
export async function verifyRendererIdentities(
  document: RendererIdentitiesDocument,
  context: {
    issuer: string;
    keys?: ReceiptKeySet;
    keyResolver?: ReceiptKeyResolver;
    signal?: AbortSignal;
  },
): Promise<RendererList> {
  const issuer = context?.issuer;
  const resolver = context?.keyResolver;
  const keys = context?.keys === undefined ? undefined : validateKeySet(context.keys);
  if (
    !identifier(issuer) ||
    (keys === undefined) === (resolver === undefined) ||
    (resolver !== undefined && typeof resolver !== 'function')
  ) {
    throw verificationError(
      'VERIFICATION_CONTEXT_MISSING',
      'A trusted issuer and exactly one trusted public key set or key resolver are required.',
    );
  }
  const signal = context.signal;
  return await verifyRendererList(document, {
    issuer,
    keyFor: trustedKeyLookup(keys, resolver, issuer, signal),
    ...(signal ? { signal } : {}),
  });
}
