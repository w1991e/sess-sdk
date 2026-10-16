// The signed archival core (archival-core-v1, docs/spec/archival-core-v1.md), read for
// verification. An immutable, versioned statement by the issuer that it holds the exact bytes of
// one issued receipt-v1 compact JWS in custody, with that receipt's acceptance bindings and the
// workspace sequence its custody record committed at. It is RFC 8785 canonical JSON signed with
// pure Ed25519 in its own signing domain, so a receipt can never be presented as a core or a core
// as a receipt.
//
// Ported from the Sess evidence package (core.ts at the commit recorded in docs/spec/source.json)
// with the same members, bounds, check order, rejection codes, canonicalization and signing
// domain. Building and signing a core is the issuer's job and is not part of the SDK.
import { createHash, webcrypto } from 'node:crypto';
import { importJWK } from 'jose';
import { canonicalJson } from '../receipts/json.js';
import type { ReceiptKeySet } from '../receipts/verify.js';

/** `type` of an archival core. */
export const ARCHIVAL_CORE_TYPE = 'sess.archival-core';
/** The only archival core version this package reads. */
export const ARCHIVAL_CORE_VERSION = 1;
/** The core's explicit, signed purpose: custody of one issued decision receipt. */
export const ARCHIVAL_CORE_PURPOSE = 'sess.receipt-custody';
/** `type` of the signed core object (the core plus its detached signature). */
export const SIGNED_ARCHIVAL_CORE_TYPE = 'sess.signed-archival-core';
/**
 * The signing domain. The signed bytes are UTF-8 of this tag, one 0x00 byte, then the core's JCS
 * bytes. A JWS signing input is base64url text and a dot, which never contains 0x00, so no
 * receipt-v1 signature can verify as a core signature and no core signature as a receipt.
 */
export const ARCHIVAL_CORE_SIGNING_DOMAIN = 'sess.archival-core/v1';
/** The only core signature algorithm: pure Ed25519 over the domain-separated bytes. */
export const ARCHIVAL_CORE_ALG = 'Ed25519';

/** Bounds (see the spec): the receipt is small; the core is smaller. */
export const RECEIPT_JWS_MAX_BYTES = 32_768;
export const ARCHIVAL_CORE_MAX_BYTES = 4_096;

const RECEIPT_TYP = 'sess-receipt+jwt';
const RECEIPT_VERSION = 1;
const DIGEST_FORMAT = /^sha256:[0-9a-f]{64}$/;
const ID_MAX = 200;
const KID_FORMAT = /^[A-Za-z0-9._-]{1,64}$/;
/** RFC 3339 UTC with exactly millisecond precision, as receipt-v1 `accepted_at` is written. */
const INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const BASE64URL = /^[A-Za-z0-9_-]+$/;
const CONTROL = /[\u0000-\u001f\u007f-\u009f]/;

/** `sha256:<hex>` of UTF-8 bytes or a string. */
export const sha256Digest = (bytes: Uint8Array | string): string =>
  `sha256:${createHash('sha256').update(bytes).digest('hex')}`;

/** An immutable version reference (a target, capability or owner record version). */
export interface VersionRef {
  id: string;
  version: number;
}

export interface ArchivalCore {
  type: typeof ARCHIVAL_CORE_TYPE;
  version: typeof ARCHIVAL_CORE_VERSION;
  purpose: typeof ARCHIVAL_CORE_PURPOSE;
  /** The receipt's `iss`. */
  issuer: string;
  /** The receipt's `workspace_id`. */
  workspace_id: string;
  /** The receipt's `event_id` (= its `jti`). */
  event_id: string;
  /** The exact original compact JWS, by digest and length; the bytes travel beside the core. */
  receipt: {
    typ: typeof RECEIPT_TYP;
    version: typeof RECEIPT_VERSION;
    /** `sha256:<hex>` of the JWS's ASCII bytes. */
    digest: string;
    byte_length: number;
  };
  /** The issuer's asserted acceptance time: the receipt's `accepted_at`, unchanged. */
  accepted_at: string;
  /** The committed per-workspace custody sequence (1, 2, … with no gaps from rollbacks). */
  workspace_sequence: number;
  /** Immutable counterparty versions; null where the acceptance had none (explicit). */
  bindings: {
    target: VersionRef | null;
    capability: VersionRef | null;
    owner: VersionRef | null;
  };
}

export interface ArchivalCoreSignature {
  alg: typeof ARCHIVAL_CORE_ALG;
  kid: string;
  /** base64url (no padding) of the 64-byte Ed25519 signature. */
  value: string;
}

export interface SignedArchivalCore {
  type: typeof SIGNED_ARCHIVAL_CORE_TYPE;
  version: typeof ARCHIVAL_CORE_VERSION;
  core: ArchivalCore;
  signature: ArchivalCoreSignature;
}

export type ArchivalCoreRejection =
  /** Not the expected shape: missing, extra or mistyped members, unreadable values. */
  | 'malformed'
  /** Another object type, purpose or signing domain. */
  | 'wrong_type'
  /** A version this package does not implement. */
  | 'unknown_version'
  /** A signature algorithm this package does not implement. */
  | 'unsupported_algorithm'
  /** Larger than the format's bound. */
  | 'oversized';

export class ArchivalCoreError extends Error {
  override name = 'ArchivalCoreError';
  readonly code: ArchivalCoreRejection;
  constructor(code: ArchivalCoreRejection, message: string) {
    super(message);
    this.code = code;
  }
}

const malformed = (message: string) => new ArchivalCoreError('malformed', message);

export function isObject(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

/** Exactly these own keys, nothing more or less. */
export function exactKeys(o: Record<string, unknown>, keys: readonly string[]): boolean {
  const own = Object.keys(o);
  return own.length === keys.length && keys.every((k) => Object.hasOwn(o, k));
}

function id(v: unknown, field: string): string {
  if (
    typeof v !== 'string' ||
    v.length === 0 ||
    v.length > ID_MAX ||
    CONTROL.test(v) ||
    /\s/.test(v) ||
    !v.isWellFormed()
  )
    throw malformed(`${field} must be a non-empty identifier of at most ${ID_MAX} characters`);
  return v;
}

function positiveInt(v: unknown, field: string, max = Number.MAX_SAFE_INTEGER): number {
  if (typeof v !== 'number' || !Number.isSafeInteger(v) || v < 1 || v > max)
    throw malformed(`${field} must be a positive integer`);
  return v;
}

function instant(v: unknown, field: string): string {
  if (typeof v !== 'string' || !INSTANT.test(v) || new Date(v).toISOString() !== v)
    throw malformed(`${field} must be an RFC 3339 UTC instant with millisecond precision`);
  return v;
}

function versionRef(v: unknown, field: string): VersionRef | null {
  if (v === null) return null;
  if (!isObject(v) || !exactKeys(v, ['id', 'version']))
    throw malformed(`${field} must be null or {id, version}`);
  return { id: id(v.id, `${field}.id`), version: positiveInt(v.version, `${field}.version`) };
}

/**
 * Strictly parses an archival core: the type, then the version, then exactly the v1 members with
 * their types and bounds. Throws ArchivalCoreError (`wrong_type`, `unknown_version`, `malformed`,
 * `oversized`). The result is a fresh, frozen object holding only the validated members.
 */
export function parseArchivalCore(value: unknown): ArchivalCore {
  if (!isObject(value)) throw malformed('an archival core must be a JSON object');
  if (value.type !== ARCHIVAL_CORE_TYPE) throw new ArchivalCoreError('wrong_type', 'not an archival core');
  if (value.version !== ARCHIVAL_CORE_VERSION)
    throw new ArchivalCoreError('unknown_version', 'unsupported archival core version');
  const top = [
    'type',
    'version',
    'purpose',
    'issuer',
    'workspace_id',
    'event_id',
    'receipt',
    'accepted_at',
    'workspace_sequence',
    'bindings',
  ];
  if (!exactKeys(value, top)) throw malformed('archival core members are not exactly the v1 set');
  if (value.purpose !== ARCHIVAL_CORE_PURPOSE)
    throw new ArchivalCoreError('wrong_type', 'archival core purpose is not receipt custody');
  const r = value.receipt;
  if (!isObject(r) || !exactKeys(r, ['typ', 'version', 'digest', 'byte_length']))
    throw malformed('receipt must be {typ, version, digest, byte_length}');
  if (r.typ !== RECEIPT_TYP || r.version !== RECEIPT_VERSION)
    throw new ArchivalCoreError('unknown_version', 'the referenced receipt is not receipt-v1');
  if (typeof r.digest !== 'string' || !DIGEST_FORMAT.test(r.digest))
    throw malformed('receipt.digest must be sha256:<64 lowercase hex>');
  const b = value.bindings;
  if (!isObject(b) || !exactKeys(b, ['target', 'capability', 'owner']))
    throw malformed('bindings must be exactly {target, capability, owner}');
  const core: ArchivalCore = {
    type: ARCHIVAL_CORE_TYPE,
    version: ARCHIVAL_CORE_VERSION,
    purpose: ARCHIVAL_CORE_PURPOSE,
    issuer: id(value.issuer, 'issuer'),
    workspace_id: id(value.workspace_id, 'workspace_id'),
    event_id: id(value.event_id, 'event_id'),
    receipt: {
      typ: RECEIPT_TYP,
      version: RECEIPT_VERSION,
      digest: r.digest,
      byte_length: positiveInt(r.byte_length, 'receipt.byte_length', RECEIPT_JWS_MAX_BYTES),
    },
    accepted_at: instant(value.accepted_at, 'accepted_at'),
    workspace_sequence: positiveInt(value.workspace_sequence, 'workspace_sequence'),
    bindings: {
      target: versionRef(b.target, 'bindings.target'),
      capability: versionRef(b.capability, 'bindings.capability'),
      owner: versionRef(b.owner, 'bindings.owner'),
    },
  };
  if (Buffer.byteLength(canonicalJson(core)) > ARCHIVAL_CORE_MAX_BYTES)
    throw new ArchivalCoreError('oversized', 'archival core exceeds its bound');
  return Object.freeze(core);
}

/** The core's canonical text (RFC 8785 JCS): exactly what is stored and what is signed. */
export function archivalCoreText(core: ArchivalCore): string {
  return canonicalJson(parseArchivalCore(core));
}

/** The bytes the core signature covers: domain tag, 0x00, then the core's JCS bytes. */
export function archivalSigningInput(core: ArchivalCore): Uint8Array {
  return Buffer.concat([
    Buffer.from(ARCHIVAL_CORE_SIGNING_DOMAIN, 'utf8'),
    Buffer.from([0]),
    Buffer.from(archivalCoreText(core), 'utf8'),
  ]);
}

// ------------------------------------------------------------------------------------------------
// Receipt-v1 structure, read without changing or re-signing it.

export interface DecodedReceipt {
  header: { alg: unknown; kid: unknown; typ: unknown };
  claims: Record<string, unknown>;
}

/**
 * Reads a compact JWS's protected header and claims as JSON, structurally only (no signature,
 * issuer or expiry check: that is the receipt-v1 verifier's job). Throws ArchivalCoreError
 * `malformed`.
 */
export function decodeReceipt(jws: unknown): DecodedReceipt {
  if (typeof jws !== 'string' || Buffer.byteLength(jws) > RECEIPT_JWS_MAX_BYTES)
    throw malformed('the receipt must be a compact JWS string within its bound');
  const parts = jws.split('.');
  if (parts.length !== 3 || !parts.every((p) => BASE64URL.test(p)))
    throw malformed('the receipt is not a compact JWS');
  const json = (part: string) => {
    try {
      return JSON.parse(Buffer.from(part, 'base64url').toString('utf8')) as unknown;
    } catch {
      throw malformed('the receipt has an unreadable part');
    }
  };
  const header = json(parts[0] as string);
  const claims = json(parts[1] as string);
  if (!isObject(header) || !isObject(claims)) throw malformed('the receipt parts are not objects');
  return { header: { alg: header.alg, kid: header.kid, typ: header.typ }, claims };
}

/**
 * Strictly parses a signed core object: type, version, exactly {type, version, core, signature},
 * a supported algorithm, a kid and a 64-byte base64url signature, and the core itself.
 */
export function parseSignedArchivalCore(value: unknown): SignedArchivalCore {
  if (!isObject(value)) throw malformed('a signed archival core must be a JSON object');
  if (value.type !== SIGNED_ARCHIVAL_CORE_TYPE)
    throw new ArchivalCoreError('wrong_type', 'not a signed archival core');
  if (value.version !== ARCHIVAL_CORE_VERSION)
    throw new ArchivalCoreError('unknown_version', 'unsupported signed archival core version');
  if (!exactKeys(value, ['type', 'version', 'core', 'signature']))
    throw malformed('signed archival core members are not exactly {type, version, core, signature}');
  const s = value.signature;
  if (!isObject(s) || !exactKeys(s, ['alg', 'kid', 'value']))
    throw malformed('signature must be {alg, kid, value}');
  if (s.alg !== ARCHIVAL_CORE_ALG)
    throw new ArchivalCoreError('unsupported_algorithm', 'unsupported core signature algorithm');
  if (typeof s.kid !== 'string' || !KID_FORMAT.test(s.kid)) throw malformed('signature.kid is not a key ID');
  if (
    typeof s.value !== 'string' ||
    s.value.length !== 86 ||
    !BASE64URL.test(s.value) ||
    Buffer.from(s.value, 'base64url').toString('base64url') !== s.value
  )
    throw malformed('signature.value must be base64url of 64 bytes');
  const core = parseArchivalCore(value.core);
  return Object.freeze({
    type: SIGNED_ARCHIVAL_CORE_TYPE,
    version: ARCHIVAL_CORE_VERSION,
    core,
    signature: Object.freeze({ alg: ARCHIVAL_CORE_ALG, kid: s.kid, value: s.value }),
  });
}

/**
 * Checks the core signature with the caller's trusted key for its kid. `unknown_kid` when the
 * trusted key set has no such kid (no fallback key), else `valid` or `invalid`.
 */
export async function checkArchivalCoreSignature(
  signed: SignedArchivalCore,
  keys: ReceiptKeySet,
): Promise<'valid' | 'invalid' | 'unknown_kid'> {
  const jwk = keys.keys.find((k) => k.kid === signed.signature.kid);
  if (!jwk) return 'unknown_kid';
  const key = await importJWK({ kty: jwk.kty, crv: jwk.crv, x: jwk.x }, 'EdDSA');
  const ok = await webcrypto.subtle.verify(
    ARCHIVAL_CORE_ALG,
    key as webcrypto.CryptoKey,
    Buffer.from(signed.signature.value, 'base64url'),
    archivalSigningInput(signed.core),
  );
  return ok ? 'valid' : 'invalid';
}
