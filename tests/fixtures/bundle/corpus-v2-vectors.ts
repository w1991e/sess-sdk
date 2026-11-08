// The bundle-v2 conformance corpus (docs/spec/bundle-v2.md §7), rebuilt deterministically on every
// run beside bundle-v1's. Ported from the Sess server core's builder (packages/security/test/
// fixtures/bundle-v2-corpus-vectors.ts at the commit recorded in docs/spec/source.json);
// bundle-v2-corpus.json is that core's frozen corpus, verbatim. The same labelled test-only seeds
// as bundle-v1 (corpus-vectors.ts): public by construction, never trusted outside tests.
//
// The core builds the revision envelope and the receipt v2 with its own issuer library; the SDK has
// none, so the few lines that build them are reproduced here. The frozen digests prove the bytes
// are identical.
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

/** The corpus revision's envelope: published by the API key `key_corpus_1`, labelled "Corpus agent". */
export function corpusEnvelope(over: { keyId?: string | null } = {}): Record<string, unknown> {
  const keyId = over.keyId === undefined ? 'key_corpus_1' : over.keyId;
  return {
    sess_revision: 1,
    session_id: 'ses_corpus_session_1',
    revision: 1,
    surface_hash: jcsDigest(CORPUS_SURFACE),
    renderer_version: 'renderer@corpus',
    published_at: '2026-10-09T11:58:00.456Z',
    key_id: keyId,
    key_label: keyId === null ? null : 'Corpus agent',
    grant_id: null,
  };
}

/** The claims of the core's receipt v2: v1's plus `surface.revision_hash`. */
export function claimsV2Of(
  over: Partial<ReceiptInput> = {},
  envelope: Record<string, unknown> = corpusEnvelope(),
): Record<string, unknown> {
  const v1 = claimsOf(over);
  return {
    ...v1,
    sess_receipt: 2,
    surface: { ...(v1.surface as Record<string, unknown>), revision_hash: jcsDigest(envelope) },
  };
}

const json = (o: unknown) => new TextEncoder().encode(canonicalJson(o));

async function signWith(claims: Record<string, unknown>, typ: string): Promise<string> {
  return new CompactSign(json(claims))
    .setProtectedHeader({ alg: 'EdDSA', kid: CORPUS_KEYS.current.kid, typ })
    .sign(corpusPrivateKey('current'));
}

/** A receipt v2 signed with the corpus's current key. */
export async function signV2(
  over: Partial<ReceiptInput> = {},
  envelope: Record<string, unknown> = corpusEnvelope(),
): Promise<string> {
  return signWith(claimsV2Of(over, envelope), 'sess-receipt-2+jwt');
}

function bundleOf(receipt: string, envelope: unknown, over: Record<string, unknown> = {}): unknown {
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
    v('v2-envelope-other-label', bundleOf(base, { ...envelope, key_label: 'Renamed later' }), FULL_CONTEXT),
    v('v2-envelope-without-key', bundleOf(base, nullKey), FULL_CONTEXT),
    v(
      'v2-envelope-other-time',
      bundleOf(base, { ...envelope, published_at: '2026-10-09T11:58:00.457Z' }),
      FULL_CONTEXT,
    ),
    v('v2-envelope-named-grant', bundleOf(base, { ...envelope, grant_id: 'grt_corpus_1' }), FULL_CONTEXT),
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
