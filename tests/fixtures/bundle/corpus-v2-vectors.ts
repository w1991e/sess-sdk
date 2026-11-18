// The bundle-v2 conformance corpus (docs/spec/bundle-v2.md §7), rebuilt deterministically on every
// run beside bundle-v1's. Ported from the Sess server core's builder (packages/security/test/
// fixtures/bundle-v2-corpus-vectors.ts at the commit recorded in docs/spec/source.json);
// bundle-v2-corpus.json is that core's frozen corpus, verbatim. The same labelled test-only seeds
// as bundle-v1 (corpus-vectors.ts): public by construction, never trusted outside tests.
//
// The envelope is the frozen receipt v2 format (`sess_revision: 2`): ten common members, then
// `titles`. The core builds the envelope and the receipt v2 with its own issuer library; the SDK
// has none, so the few lines that build them are reproduced here, and `revision_hash` is computed
// by hand (the JCS SHA-256 of the ten common members plus `titles_digest`), independently of the
// SDK's reader. The frozen digests prove the bytes are identical.
import { createHash } from 'node:crypto';
import { CompactSign } from 'jose';
import type { ExpectedBundleContext } from '../../../src/receipts/index.js';
import {
  CORPUS_INPUT,
  CORPUS_KEYS,
  CORPUS_SURFACE,
  FULL_CONTEXT,
  canonicalJson,
  claimsOf,
  corpusPrivateKey,
  corpusPublicJwks,
  jcsDigest,
  type CorpusVector,
  type ReceiptInput,
} from './corpus-vectors.js';

/** The ten common members, in order (receipt-v2 §2). */
export const ENVELOPE_MEMBERS = [
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

/** The corpus titles nonce: sixteen labelled bytes (test-only, as the QR evidence's). */
export const CORPUS_NONCE = Buffer.alloc(16, 0x5a).toString('base64url');
/** The corpus revision's registered address and its title at Start. */
export const CORPUS_AGENT_TARGET = { id: 'tgt_corpus_1', version: 1, name: 'corpus-agent' };
export const CORPUS_TARGET_TITLE = 'Corpus agent';

export type Envelope = Record<string, unknown> & { titles: Record<string, unknown> };

/**
 * The corpus revision's envelope (the frozen full form): published by the API key `key_corpus_1`
 * on a Session started at the registered address `corpus-agent`, titled "Corpus agent".
 */
export function corpusEnvelope(over: { keyId?: string | null } = {}): Envelope {
  return {
    sess_revision: 2,
    revision: 1,
    session_id: 'ses_corpus_session_1',
    surface_hash: jcsDigest(CORPUS_SURFACE),
    renderer_version: 'renderer@corpus',
    published_at: '2026-10-09T11:58:00.456Z',
    key_id: over.keyId === undefined ? 'key_corpus_1' : over.keyId,
    grant_id: null,
    agent_target: { ...CORPUS_AGENT_TARGET },
    ask_id: null,
    titles: { nonce: CORPUS_NONCE, grant_title: null, target_title: CORPUS_TARGET_TITLE, owner_name: null },
  };
}

/** `titles_digest`, by hand: base64url SHA-256 of the canonical JSON of `titles`. */
export function handTitlesDigest(titles: unknown): string {
  return createHash('sha256').update(canonicalJson(titles), 'utf8').digest('base64url');
}

/** The compact form, by hand: the ten common members plus `titles_digest`. */
export function handCompact(envelope: Envelope): Record<string, unknown> {
  return {
    ...Object.fromEntries(ENVELOPE_MEMBERS.map((n) => [n, envelope[n]])),
    titles_digest: handTitlesDigest(envelope.titles),
  };
}

/** `revision_hash`, by hand: the JCS SHA-256 of the compact form. */
export function handRevisionHash(envelope: Envelope): string {
  return jcsDigest(handCompact(envelope));
}

/** The claims of the core's receipt v2: v1's plus `surface.revision_hash`. */
export function claimsV2Of(
  over: Partial<ReceiptInput> = {},
  envelope: Envelope = corpusEnvelope(),
): Record<string, unknown> {
  const v1 = claimsOf(over);
  return {
    ...v1,
    sess_receipt: 2,
    surface: { ...(v1.surface as Record<string, unknown>), revision_hash: handRevisionHash(envelope) },
  };
}

const json = (o: unknown) => new TextEncoder().encode(canonicalJson(o));

/** Signs claims with the corpus's current key under the given `typ`. */
export async function signWith(claims: Record<string, unknown>, typ: string): Promise<string> {
  return new CompactSign(json(claims))
    .setProtectedHeader({ alg: 'EdDSA', kid: CORPUS_KEYS.current.kid, typ })
    .sign(corpusPrivateKey('current'));
}

/** A receipt v2 signed with the corpus's current key. */
export async function signV2(
  over: Partial<ReceiptInput> = {},
  envelope: Envelope = corpusEnvelope(),
): Promise<string> {
  return signWith(claimsV2Of(over, envelope), 'sess-receipt-2+jwt');
}

export function bundleOf(receipt: string, envelope: unknown, over: Record<string, unknown> = {}): unknown {
  return {
    type: 'sess.decision-bundle',
    version: 2,
    receipt,
    revision_envelope: envelope,
    content: { surface: CORPUS_SURFACE, input: CORPUS_INPUT },
    keys: { keys: corpusPublicJwks('current') },
    ...over,
  };
}

/**
 * The corpus bundle with `targetTitle` as its envelope's Target title and its receipt v2 signed,
 * with the corpus's current key, over exactly that envelope (revision_hash computed by hand, as a
 * forger holding the key would), so that a title the shared title rule refuses reaches the reader
 * under a valid signature. Not a corpus vector.
 */
export async function corpusBundleV2WithTitle(targetTitle: string): Promise<unknown> {
  const e = corpusEnvelope();
  const envelope = { ...e, titles: { ...e.titles, target_title: targetTitle } };
  return bundleOf(await signV2({}, envelope), envelope);
}

/** Every bundle-v2 vector, in corpus order. */
export async function buildCorpusV2Vectors(): Promise<CorpusVector[]> {
  const envelope = corpusEnvelope();
  const base = await signV2();
  const [h, p, s] = base.split('.') as [string, string, string];
  const claims = JSON.parse(Buffer.from(p, 'base64url').toString('utf8')) as Record<string, unknown>;
  const tampered = Buffer.from(
    canonicalJson({ ...claims, action: { id: 'approve', label: 'Reject', summary: 'approve' } }),
    'utf8',
  ).toString('base64url');
  const nullKey = corpusEnvelope({ keyId: null });
  const v1Receipt = await signWith(claimsOf(), 'sess-receipt+jwt');
  // A v1-typed header over the v2 claims, signed with the issuer's current key.
  const v1Typed = await signWith(claims, 'sess-receipt+jwt');
  // A later receipt type over the same claims (frozen spec §4): newer, never a failure.
  const newerTyped = await signWith(claims, 'sess-receipt-3+jwt');
  const { titles: _titles, ...withoutTitles } = envelope;
  const v = (id: string, bundle: unknown, context?: ExpectedBundleContext): CorpusVector => ({
    id,
    bundle,
    context,
  });
  const { revision_envelope: _, ...withoutEnvelope } = bundleOf(base, envelope) as Record<string, unknown>;
  return [
    v('v2-valid-full-context', bundleOf(base, envelope), FULL_CONTEXT),
    v('v2-valid-no-context', bundleOf(base, envelope)),
    v('v2-valid-no-key', bundleOf(await signV2({}, nullKey), nullKey), FULL_CONTEXT),
    v('v2-missing-envelope', withoutEnvelope, FULL_CONTEXT),
    v('v2-null-envelope', bundleOf(base, null), FULL_CONTEXT),
    v('v2-envelope-other-key', bundleOf(base, { ...envelope, key_id: 'key_corpus_2' }), FULL_CONTEXT),
    v(
      'v2-envelope-other-title',
      bundleOf(base, { ...envelope, titles: { ...envelope.titles, target_title: 'Renamed later' } }),
      FULL_CONTEXT,
    ),
    v(
      'v2-envelope-other-nonce',
      bundleOf(base, {
        ...envelope,
        titles: { ...envelope.titles, nonce: Buffer.alloc(16, 0x5b).toString('base64url') },
      }),
      FULL_CONTEXT,
    ),
    v('v2-envelope-key-label', bundleOf(base, { ...envelope, key_label: 'Corpus agent' }), FULL_CONTEXT),
    v('v2-envelope-compact-form', bundleOf(base, handCompact(envelope)), FULL_CONTEXT),
    v(
      'v2-envelope-both-forms',
      bundleOf(base, { ...envelope, titles_digest: handTitlesDigest(envelope.titles) }),
      FULL_CONTEXT,
    ),
    v('v2-envelope-neither-form', bundleOf(base, withoutTitles), FULL_CONTEXT),
    v(
      'v2-envelope-withdrawn-nine-member',
      bundleOf(base, {
        sess_revision: 1,
        session_id: envelope.session_id,
        revision: envelope.revision,
        surface_hash: envelope.surface_hash,
        renderer_version: envelope.renderer_version,
        published_at: envelope.published_at,
        key_id: envelope.key_id,
        key_label: 'Corpus agent',
        grant_id: null,
      }),
      FULL_CONTEXT,
    ),
    v(
      'v2-envelope-withdrawn-twelve-member',
      bundleOf(base, {
        ...withoutTitles,
        agent_target: { ...CORPUS_AGENT_TARGET, title: CORPUS_TARGET_TITLE },
        grant_title: null,
        owner_name: null,
      }),
      FULL_CONTEXT,
    ),
    v(
      'v2-envelope-newer',
      bundleOf(base, { ...envelope, sess_revision: 3, audience: 'wks_corpus' }),
      FULL_CONTEXT,
    ),
    v('v2-receipt-newer-typ', bundleOf(newerTyped, envelope), FULL_CONTEXT),
    v('v2-envelope-without-key', bundleOf(base, nullKey), FULL_CONTEXT),
    v(
      'v2-envelope-other-time',
      bundleOf(base, { ...envelope, published_at: '2026-10-09T11:58:00.457Z' }),
      FULL_CONTEXT,
    ),
    v(
      'v2-envelope-named-grant',
      bundleOf(base, {
        ...envelope,
        grant_id: 'sgr_corpus_1',
        titles: { ...envelope.titles, grant_title: 'Corpus grant' },
      }),
      FULL_CONTEXT,
    ),
    v('v2-envelope-extra-member', bundleOf(base, { ...envelope, publisher: 'someone' }), FULL_CONTEXT),
    v(
      'v2-envelope-non-canonical-time',
      bundleOf(base, { ...envelope, published_at: '2026-10-09T11:58:00.456000Z' }),
      FULL_CONTEXT,
    ),
    v('v2-receipt-v1-in-bundle-v2', bundleOf(v1Receipt, envelope), FULL_CONTEXT),
    v('v2-receipt-v2-typed-as-v1', bundleOf(v1Typed, envelope), FULL_CONTEXT),
    v(
      'v2-receipt-v2-in-bundle-v1',
      bundleOf(base, undefined, { version: 1, revision_envelope: undefined }),
      FULL_CONTEXT,
    ),
    v('v2-tampered-claims', bundleOf(`${h}.${tampered}.${s}`, envelope), FULL_CONTEXT),
    v(
      'v2-altered-input',
      bundleOf(base, envelope, {
        content: { surface: CORPUS_SURFACE, input: { ...CORPUS_INPUT, approved: false } },
      }),
      FULL_CONTEXT,
    ),
    v(
      'v2-altered-surface',
      bundleOf(base, envelope, {
        content: { surface: { ...CORPUS_SURFACE, title: 'Another plan' }, input: CORPUS_INPUT },
      }),
      FULL_CONTEXT,
    ),
    v('v2-wrong-audience', bundleOf(base, envelope), { ...FULL_CONTEXT, audience: 'wks_other' }),
    v(
      'v2-expired',
      bundleOf(
        await signV2({
          acceptedAt: new Date('2026-01-01T00:00:00.000Z'),
          expiresAt: new Date('2026-02-01T00:00:00.000Z'),
        }),
        envelope,
      ),
      FULL_CONTEXT,
    ),
    v('v2-unsupported-version', bundleOf(base, envelope, { version: 3 }), FULL_CONTEXT),
  ].map((x) => ({ ...x, bundle: JSON.parse(JSON.stringify(x.bundle)) as unknown }));
}
