// The revision envelope (receipt-v2 §2, docs/spec/receipt-v2.md): the record of one published
// Surface revision that a receipt v2 commits to through `surface.revision_hash`, the RFC 8785
// SHA-256 of the envelope. Sess computes it from the stored revision and returns it beside every
// receipt v2; a verifier recomputes the digest from the envelope it is given. It is read here
// exactly as the Sess verification core reads it (same members, types and identifier rules), so
// an envelope one accepts the other accepts.
import { exactKeys, isRecord, jsonDigest, wellFormedUnicode } from './json.js';

/** The envelope's own schema version (`sess_revision`). */
export const REVISION_ENVELOPE_VERSION = 1;

/**
 * The canonical `published_at` form: RFC 3339 UTC with exactly three fractional digits, as
 * `Date.prototype.toISOString` writes it.
 */
const PUBLISHED_AT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const DIGEST = /^sha256:[0-9a-f]{64}$/;
const ID_MAX = 200;
/** The key label's bound (at most 64 characters, possibly empty). */
const KEY_LABEL_MAX = 64;
const CONTROL = /[\u0000-\u001f\u007f-\u009f]/;
// A bearer credential is never envelope material: Sess owner and management keys, and the
// unprefixed 22- or 43-character human link token.
const CREDENTIAL =
  /^(?:sess_sk_[A-Za-z0-9_-]{43}|sess_mg_[A-Za-z0-9_-]{43}|[A-Za-z0-9_-]{22}|[A-Za-z0-9_-]{43})$/;

/**
 * The revision envelope beside a receipt v2: exactly these nine members. `key_id` and `key_label`
 * name the API key of the Session's owning workspace that published the revision, and that key's
 * label when it was published (both null for any other publisher, and for revisions published
 * before receipt v2). They are the integrator's own key and word for it, never a person.
 */
export interface RevisionEnvelope {
  sess_revision: 1;
  session_id: string;
  revision: number;
  /** The receipt's `surface.hash`: SHA-256 of the revision's normalized Surface document. */
  surface_hash: string;
  renderer_version: string;
  /** When the revision was published: `YYYY-MM-DDTHH:MM:SS.mmmZ`. */
  published_at: string;
  key_id: string | null;
  /** 0–64 characters; null exactly when `key_id` is null. */
  key_label: string | null;
  /** Null in this version of Sess; an identifier is accepted. */
  grant_id: string | null;
}

const MEMBERS = [
  'sess_revision',
  'session_id',
  'revision',
  'surface_hash',
  'renderer_version',
  'published_at',
  'key_id',
  'key_label',
  'grant_id',
] as const;

function plain(v: unknown): v is string {
  return typeof v === 'string' && v.length > 0 && v.length <= ID_MAX && !CONTROL.test(v) && !/\s/.test(v);
}

function identifier(v: unknown): v is string {
  return plain(v) && !CREDENTIAL.test(v) && !/sess_(?:sk|mg)_/.test(v);
}

function label(v: unknown): v is string {
  return typeof v === 'string' && [...v].length <= KEY_LABEL_MAX && wellFormedUnicode(v) && !CONTROL.test(v);
}

function publishedAt(v: unknown): v is string {
  if (typeof v !== 'string' || !PUBLISHED_AT.test(v)) return false;
  const t = new Date(v);
  return !Number.isNaN(t.getTime()) && t.toISOString() === v;
}

/**
 * Reads a supplied envelope strictly: exactly the nine members, each of its type, with the
 * canonical `published_at`. Null for anything else (a receipt v2 verifier then refuses it).
 */
export function parseRevisionEnvelope(v: unknown): RevisionEnvelope | null {
  if (!isRecord(v) || !exactKeys(v, MEMBERS)) return null;
  const ok =
    v.sess_revision === REVISION_ENVELOPE_VERSION &&
    identifier(v.session_id) &&
    Number.isSafeInteger(v.revision) &&
    (v.revision as number) >= 1 &&
    typeof v.surface_hash === 'string' &&
    DIGEST.test(v.surface_hash) &&
    plain(v.renderer_version) &&
    publishedAt(v.published_at) &&
    (v.key_id === null ? v.key_label === null : identifier(v.key_id) && label(v.key_label)) &&
    (v.grant_id === null || identifier(v.grant_id));
  if (!ok) return null;
  return {
    sess_revision: REVISION_ENVELOPE_VERSION,
    session_id: v.session_id as string,
    revision: v.revision as number,
    surface_hash: v.surface_hash as string,
    renderer_version: v.renderer_version as string,
    published_at: v.published_at as string,
    key_id: v.key_id as string | null,
    key_label: v.key_label as string | null,
    grant_id: v.grant_id as string | null,
  };
}

/** `revision_hash`: `sha256:<hex>` of the envelope's RFC 8785 canonical JSON. */
export function revisionHash(envelope: RevisionEnvelope): string {
  return jsonDigest(envelope);
}
