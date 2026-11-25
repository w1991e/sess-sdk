// The revision envelope (receipt-v2 §2, docs/spec/receipt-v2.md): the record of one published
// Surface revision that a receipt v2 commits to through `surface.revision_hash`. Sess computes it
// from the stored revision and returns it beside every receipt v2; a verifier recomputes the digest
// from the envelope it is given. It is read here exactly as the Sess verification core reads it
// (packages/security/src/revision-envelope.ts at the commit recorded in docs/spec/source.json:
// same members, types, identifier and title rules), so an envelope one accepts the other accepts.
//
// The format, `sess_revision: 2` (receipt-v2 §2, frozen): ten common members, then exactly one of
// - `titles` (the full form): `{nonce, grant_title, target_title, owner_name}`, exactly these four;
// - `titles_digest` (the compact form): the unpadded base64url SHA-256 of the RFC 8785 canonical
//   JSON of `titles`, 43 characters.
// Both, or neither, or any other key at either level, is refused. `revision_hash` is the JCS
// SHA-256 of the compact form: a full form is first normalised by replacing `titles` with its
// digest, so both forms of one revision give the same hash. No key label is in the envelope.
//
// Forward compatibility (receipt-v2 §7, `newer`): an envelope whose `sess_revision` is a whole number above
// 2 is newer (revisionEnvelopeIsNewer), never read as this version; a verifier reports it as newer
// and releases nothing. The nine-member `sess_revision: 1` shape was never issued and is refused.
import { createHash } from 'node:crypto';
import { canonicalJson, isRecord, jsonDigest } from './json.js';
import { isStoredSharedTitle } from './shared-title.js';

/** The envelope's own schema version (`sess_revision`); a higher one is newer. */
export const REVISION_ENVELOPE_VERSION = 2;

/**
 * The canonical `published_at` form: RFC 3339 UTC with exactly three fractional digits, as
 * `Date.prototype.toISOString` writes it.
 */
const PUBLISHED_AT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const DIGEST = /^sha256:[0-9a-f]{64}$/;
/** `titles.nonce`: 16 bytes as unpadded base64url. */
const TITLES_NONCE = /^[A-Za-z0-9_-]{21}[AQgw]$/;
/** `titles_digest`: a 32-byte SHA-256 as unpadded base64url. */
const TITLES_DIGEST = /^[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]$/;
/** `agent_target.name`: the share-name rule (3 to 40 characters, a lowercase slug). */
const AGENT_TARGET_NAME = /^(?=.{3,40}$)[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;
const ID_MAX = 200;
const CONTROL = /[\u0000-\u001f\u007f-\u009f]/;
// A bearer credential is never envelope material: Sess owner and management keys, and the
// unprefixed 22- or 43-character human link token.
const CREDENTIAL =
  /^(?:sess_sk_[A-Za-z0-9_-]{43}|sess_mg_[A-Za-z0-9_-]{43}|[A-Za-z0-9_-]{22}|[A-Za-z0-9_-]{43})$/;

/** The registered address the Session started from, as at Start. */
export interface EnvelopeAgentTarget {
  /** `tgt_…` */
  id: string;
  /** The Target's version bound at Start, a whole number from 1. */
  version: number;
  /** The address, `sess.si/a/{name}`: an owner-chosen public name, not a verified identity. */
  name: string;
}

/** The three owner-chosen titles under their nonce. Each is 1–60 code points or null. */
export interface EnvelopeTitles {
  nonce: string;
  /** Null exactly when `grant_id` is null. */
  grant_title: string | null;
  /** Null when `agent_target` is null. */
  target_title: string | null;
  owner_name: string | null;
}

/**
 * The ten common members. The owner-chosen names in it (`agent_target.name` and, in the full form,
 * the titles) are the owner's own words, signed by Sess as published, never verified identities.
 */
export interface RevisionEnvelopeCommon {
  sess_revision: 2;
  revision: number;
  /** `ses_…` */
  session_id: string;
  /** The receipt's `surface.hash`: SHA-256 of the revision's normalized Surface document. */
  surface_hash: string;
  renderer_version: string;
  /** When the revision was published: `YYYY-MM-DDTHH:MM:SS.mmmZ`. */
  published_at: string;
  /** The responsible owner key (`key_…`), or null. */
  key_id: string | null;
  /** A Session grant (`sgr_…`), or null. */
  grant_id: string | null;
  /** The registered address the Session started from, or null. */
  agent_target: EnvelopeAgentTarget | null;
  /** The Ask a respondent's Session belongs to (`ask_…`), or null. */
  ask_id: string | null;
}

/** The full form, with `titles`: every file a person keeps, and every API response. */
export interface RevisionEnvelopeFull extends RevisionEnvelopeCommon {
  titles: EnvelopeTitles;
}

/** The compact form, with `titles_digest` in place of `titles` (a QR code's). */
export interface RevisionEnvelopeCompact extends RevisionEnvelopeCommon {
  titles_digest: string;
}

/** The revision envelope beside a receipt v2, in either form. */
export type RevisionEnvelope = RevisionEnvelopeFull | RevisionEnvelopeCompact;

const MEMBERS = [
  'sess_revision',
  'revision',
  'session_id',
  'surface_hash',
  'renderer_version',
  'published_at',
  'key_id',
  'grant_id',
  'agent_target',
  'ask_id',
] as const;
const TITLES = ['nonce', 'grant_title', 'target_title', 'owner_name'] as const;
const AGENT_TARGET = ['id', 'version', 'name'] as const;

function exactly(o: Record<string, unknown>, keys: readonly string[]): boolean {
  const own = Object.keys(o);
  return own.length === keys.length && keys.every((k) => Object.hasOwn(o, k));
}

function renderer(v: unknown): v is string {
  return typeof v === 'string' && v.length > 0 && v.length <= ID_MAX && !CONTROL.test(v) && !/\s/.test(v);
}

/** An opaque ID with its prefix and a non-empty body; never a bearer credential. */
function id(v: unknown, prefix: string): v is string {
  return (
    typeof v === 'string' &&
    v.length > prefix.length &&
    v.length <= ID_MAX &&
    v.startsWith(prefix) &&
    /^[A-Za-z0-9_-]+$/.test(v) &&
    !CREDENTIAL.test(v) &&
    !/sess_(?:sk|mg)_/.test(v)
  );
}

const whole = (v: unknown, min: number): v is number => Number.isSafeInteger(v) && (v as number) >= min;

function publishedAt(v: unknown): v is string {
  if (typeof v !== 'string' || !PUBLISHED_AT.test(v)) return false;
  const t = new Date(v);
  return !Number.isNaN(t.getTime()) && t.toISOString() === v;
}

function agentTarget(v: unknown): v is EnvelopeAgentTarget {
  return (
    isRecord(v) &&
    exactly(v, AGENT_TARGET) &&
    id(v.id, 'tgt_') &&
    whole(v.version, 1) &&
    typeof v.name === 'string' &&
    AGENT_TARGET_NAME.test(v.name)
  );
}

const title = (v: unknown) => v === null || isStoredSharedTitle(v);

function titles(v: unknown): v is EnvelopeTitles {
  return (
    isRecord(v) &&
    exactly(v, TITLES) &&
    typeof v.nonce === 'string' &&
    TITLES_NONCE.test(v.nonce) &&
    title(v.grant_title) &&
    title(v.target_title) &&
    title(v.owner_name)
  );
}

const RULES: { [K in (typeof MEMBERS)[number]]: (v: unknown) => boolean } = {
  sess_revision: (v) => v === REVISION_ENVELOPE_VERSION,
  revision: (v) => whole(v, 1),
  session_id: (v) => id(v, 'ses_'),
  surface_hash: (v) => typeof v === 'string' && DIGEST.test(v),
  renderer_version: renderer,
  published_at: publishedAt,
  key_id: (v) => v === null || id(v, 'key_'),
  grant_id: (v) => v === null || id(v, 'sgr_'),
  agent_target: (v) => v === null || agentTarget(v),
  ask_id: (v) => v === null || id(v, 'ask_'),
};

/**
 * `titles_digest`: the unpadded base64url SHA-256 of the UTF-8 bytes of the RFC 8785 canonical
 * JSON of `titles`.
 */
function titlesDigest(t: EnvelopeTitles): string {
  return createHash('sha256').update(canonicalJson(t), 'utf8').digest('base64url');
}

function isFull(e: RevisionEnvelope): e is RevisionEnvelopeFull {
  return Object.hasOwn(e, 'titles');
}

/**
 * Whether a supplied value is an envelope of a later `sess_revision` than this reader knows: an
 * object whose `sess_revision` is a whole number above 2. A verifier reports it as newer and
 * releases nothing; it is never accepted. A lower or equal version is not newer.
 */
export function revisionEnvelopeIsNewer(v: unknown): boolean {
  return (
    isRecord(v) &&
    Number.isSafeInteger(v.sess_revision) &&
    (v.sess_revision as number) > REVISION_ENVELOPE_VERSION
  );
}

/**
 * Reads a supplied envelope strictly: exactly the ten common members, each of its kind, and exactly
 * one of `titles` (exactly its four members, each title under the shared title rule) or
 * `titles_digest`; `titles.grant_title` null exactly when `grant_id` is null, and
 * `titles.target_title` null when `agent_target` is null. Null for anything else: both forms,
 * neither, an extra or missing member at either level, a key label, a `sess_revision` other than 2
 * (see revisionEnvelopeIsNewer). The value returned is a copy in the form given.
 */
export function parseRevisionEnvelope(v: unknown): RevisionEnvelope | null {
  if (!isRecord(v)) return null;
  const full = Object.hasOwn(v, 'titles');
  const compact = Object.hasOwn(v, 'titles_digest');
  if (full === compact) return null;
  if (!exactly(v, [...MEMBERS, full ? 'titles' : 'titles_digest'])) return null;
  const out: Record<string, unknown> = {};
  for (const name of MEMBERS) {
    if (!RULES[name](v[name])) return null;
    out[name] = v[name];
  }
  if (out.agent_target !== null) out.agent_target = { ...(out.agent_target as EnvelopeAgentTarget) };
  if (full) {
    if (!titles(v.titles)) return null;
    out.titles = { ...v.titles };
    const t = out.titles as EnvelopeTitles;
    if ((out.grant_id === null) !== (t.grant_title === null)) return null;
    if (out.agent_target === null && t.target_title !== null) return null;
  } else {
    if (typeof v.titles_digest !== 'string' || !TITLES_DIGEST.test(v.titles_digest)) return null;
    out.titles_digest = v.titles_digest;
  }
  return out as unknown as RevisionEnvelope;
}

/** Reads a supplied envelope as a person's file carries it: the full form only. */
export function parseFullRevisionEnvelope(v: unknown): RevisionEnvelopeFull | null {
  const e = parseRevisionEnvelope(v);
  return e !== null && isFull(e) ? e : null;
}

/**
 * `revision_hash`: `sha256:<hex>` of the RFC 8785 canonical JSON of the compact form. A full form's
 * `titles` is replaced by its digest first, so both forms of one revision give the same hash.
 */
export function revisionHash(envelope: RevisionEnvelope): string {
  if (!isFull(envelope)) return jsonDigest(envelope);
  const compact: Record<string, unknown> = {};
  for (const name of MEMBERS) compact[name] = envelope[name];
  compact.titles_digest = titlesDigest(envelope.titles);
  return jsonDigest(compact);
}
