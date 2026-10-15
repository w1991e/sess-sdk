// The bundle-v1 conformance corpus (docs/spec/bundle-v1.md §7), rebuilt deterministically on every
// run. Ported from the Sess server core's builder (packages/security/test/fixtures/
// bundle-corpus-vectors.ts at the commit recorded in docs/spec/source.json); bundle-v1-corpus.json
// is that core's frozen corpus, verbatim. Nothing token-shaped is committed: the test-only Ed25519
// keys take their 32-byte seed from the SHA-256 of a fixed, labelled string, so they are public by
// construction and must never sign anything outside tests. Ed25519 is deterministic, so every
// receipt and bundle is rebuilt byte for byte and checked against its frozen digest before use.
//
// The core builds receipts with its own issuer library; the SDK has none (it only verifies), so the
// few lines that build and sign the claims are reproduced here with the same jose calls and the
// same protected-header member order. The frozen digests prove the bytes are identical.
import { createHash, createHmac, createPrivateKey, createPublicKey, type KeyObject } from 'node:crypto';
import canonicalize from 'canonicalize';
import { CompactSign } from 'jose';
import type { ExpectedBundleContext, ReceiptKeySet } from '../../../src/receipts/index.js';

/** The issuer every corpus receipt names (except the wrong-issuer vector). */
export const CORPUS_ISSUER = 'https://receipts.corpus.sess.test';
/** The fixed verification time of the trusted face (the public face uses the current time). */
export const CORPUS_NOW = new Date('2026-10-09T12:05:00Z');
export const CORPUS_AUDIENCE = 'wks_corpus';

/** Seed labels: public test material only. */
const SEED_PREFIX = 'sess bundle-v1 corpus test key v1';
export const CORPUS_KEYS = {
  /** The issuer's active key. */
  current: { kid: 'corpus-current', label: `${SEED_PREFIX} current` },
  /** The previous key, still retained for verification (rotation overlap). */
  previous: { kid: 'corpus-previous', label: `${SEED_PREFIX} previous` },
  /** A key the issuer no longer publishes. */
  retired: { kid: 'corpus-retired', label: `${SEED_PREFIX} retired` },
  /** Someone else's key presenting the issuer's current kid. */
  stranger: { kid: 'corpus-current', label: `${SEED_PREFIX} stranger` },
} as const;
type KeyName = keyof typeof CORPUS_KEYS;

const PKCS8_ED25519_PREFIX = Buffer.from('302e020100300506032b657004220420', 'hex');

function corpusPrivateKey(name: KeyName): KeyObject {
  const seed = createHash('sha256').update(CORPUS_KEYS[name].label, 'utf8').digest();
  return createPrivateKey({
    key: Buffer.concat([PKCS8_ED25519_PREFIX, seed]),
    format: 'der',
    type: 'pkcs8',
  });
}

/** The published-key-set member for a corpus key (the core's member order). */
function publicJwk(name: KeyName) {
  const jwk = createPublicKey(corpusPrivateKey(name)).export({ format: 'jwk' });
  return {
    kty: 'OKP' as const,
    crv: 'Ed25519' as const,
    x: jwk.x as string,
    kid: CORPUS_KEYS[name].kid,
    alg: 'EdDSA' as const,
    use: 'sig' as const,
  };
}

/** The public keys of the named corpus key's issuer key set (`current` retains `previous`). */
export function corpusPublicJwks(name: KeyName): ReturnType<typeof publicJwk>[] {
  return name === 'current' ? [publicJwk('current'), publicJwk('previous')] : [publicJwk(name)];
}

/** What a trusting caller holds: the current and previous public keys (the issuer's key set). */
export function corpusTrustedKeys(): ReceiptKeySet {
  return { keys: corpusPublicJwks('current') };
}

export const canonicalJson = (value: unknown): string => {
  const text = canonicalize(value);
  if (text === undefined) throw new TypeError('value has no canonical JSON form');
  return text;
};
const jcsDigest = (value: unknown) =>
  `sha256:${createHash('sha256').update(canonicalJson(value), 'utf8').digest('hex')}`;

/** A synthetic accepted interactive Surface (the normalized stored form). */
export const CORPUS_SURFACE = {
  mode: 'interactive',
  title: 'Approve the synthetic weekend plan',
  description: 'Synthetic data for the bundle-v1 corpus.',
  source: {
    kind: 'sess_surface',
    components: [
      { type: 'heading', text: 'Plan' },
      { type: 'record', label: 'Saturday', fields: { activity: 'Hike', start: '09:00' } },
      {
        type: 'field',
        name: 'approved',
        label: 'Approve the plan',
        required: true,
        schema: { type: 'boolean' },
      },
      {
        type: 'field',
        name: 'note',
        label: 'Note',
        multiline: true,
        schema: { type: 'string', maxLength: 200 },
      },
    ],
  },
  actions: [{ id: 'approve', label: 'Approve', intent: 'approve' }],
  response_policy: 'first',
} as const;

export const CORPUS_INPUT = { approved: true, note: 'Bring water.' } as const;

const IDS = {
  session: 'ses_corpus_session_1',
  event: 'evt_corpus_event_1',
};

interface ReceiptInput {
  issuer: string;
  input: unknown;
  acceptedAt: Date;
  expiresAt: Date;
}

/** The claims the core's buildReceipt produces for the corpus receipt input. */
function claimsOf(over: Partial<ReceiptInput> = {}): Record<string, unknown> {
  const r: ReceiptInput = {
    issuer: CORPUS_ISSUER,
    input: CORPUS_INPUT,
    acceptedAt: new Date('2026-10-09T12:00:00.123Z'),
    // Far enough ahead that the public face (current time) agrees with the trusted face.
    expiresAt: new Date('2036-10-09T12:00:00.000Z'),
    ...over,
  };
  return {
    sess_receipt: 1,
    iss: r.issuer,
    aud: CORPUS_AUDIENCE,
    jti: IDS.event,
    iat: Math.floor(r.acceptedAt.getTime() / 1000),
    exp: Math.floor(r.expiresAt.getTime() / 1000),
    accepted_at: r.acceptedAt.toISOString(),
    workspace_id: CORPUS_AUDIENCE,
    session_id: IDS.session,
    step_id: 'rev_1',
    event_id: IDS.event,
    surface: { revision: 1, hash: jcsDigest(CORPUS_SURFACE), renderer_version: 'renderer@corpus' },
    action: { id: 'approve', label: 'Approve', summary: 'approve' },
    input_hash: jcsDigest(r.input),
    actor: { assurance: 'link_holder', subject: `${CORPUS_AUDIENCE}:human_link:${IDS.session}` },
    return_binding: { recipient: CORPUS_AUDIENCE, return_channel_id: null },
  };
}

const json = (o: unknown) => new TextEncoder().encode(canonicalJson(o));

async function sign(name: KeyName, over: Partial<ReceiptInput> = {}): Promise<string> {
  return new CompactSign(json(claimsOf(over)))
    .setProtectedHeader({ alg: 'EdDSA', kid: CORPUS_KEYS[name].kid, typ: 'sess-receipt+jwt' })
    .sign(corpusPrivateKey(name));
}

/** Signs arbitrary header/payload bytes with the issuer's current key. */
async function forge(header: Record<string, unknown>, payload: Uint8Array): Promise<string> {
  return new CompactSign(payload)
    .setProtectedHeader({ alg: 'EdDSA', ...header } as { alg: string })
    .sign(corpusPrivateKey('current'));
}

const b64 = (o: unknown) => Buffer.from(JSON.stringify(o), 'utf8').toString('base64url');

function bundleOf(receipt: string, over: Record<string, unknown> = {}): unknown {
  return {
    type: 'sess.decision-bundle',
    version: 1,
    receipt,
    content: { surface: CORPUS_SURFACE, input: CORPUS_INPUT },
    keys: { keys: corpusPublicJwks('current') },
    ...over,
  };
}

/** A bundle whose receipt is the base claims with some replaced, signed by the issuer's current key. */
export async function corpusBundleWithClaims(over: Record<string, unknown>): Promise<unknown> {
  const receipt = await forge(
    { kid: CORPUS_KEYS.current.kid, typ: 'sess-receipt+jwt' },
    json({ ...claimsOf(), ...over }),
  );
  return JSON.parse(JSON.stringify(bundleOf(receipt))) as unknown;
}

/** The full trusted context of the base vector. */
export const FULL_CONTEXT: ExpectedBundleContext = {
  audience: CORPUS_AUDIENCE,
  workspaceId: CORPUS_AUDIENCE,
  sessionId: IDS.session,
  eventId: IDS.event,
  revision: 1,
  actionId: 'approve',
};

export interface CorpusVector {
  id: string;
  /** The bundle as a JSON value (any JSON value: malformed vectors need not be objects). */
  bundle: unknown;
  /** The expected context a trusting caller supplies; undefined: none. */
  context: ExpectedBundleContext | undefined;
}

function nested(depth: number): unknown {
  let v: unknown = 'leaf';
  for (let i = 0; i < depth; i++) v = { n: v };
  return v;
}

/** Every vector, in corpus order. */
export async function buildCorpusVectors(): Promise<CorpusVector[]> {
  const base = await sign('current');
  const [h, p, s] = base.split('.') as [string, string, string];
  const baseClaims = JSON.parse(Buffer.from(p, 'base64url').toString('utf8')) as Record<string, unknown>;
  const tamperedPayload = Buffer.from(
    canonicalJson({
      ...baseClaims,
      action: { id: 'approve', label: 'Reject', summary: 'approve' },
    }),
    'utf8',
  ).toString('base64url');
  // Flip one bit of the signature's first byte.
  const sig = Buffer.from(s, 'base64url');
  sig[0] = (sig[0] as number) ^ 1;
  const hmacKey = createHmac('sha256', 'sess bundle-v1 corpus hs256 v1').update('k').digest();
  const hs256 = await new CompactSign(json(baseClaims))
    .setProtectedHeader({ alg: 'HS256', kid: CORPUS_KEYS.current.kid, typ: 'sess-receipt+jwt' })
    .sign(hmacKey);
  const bigInput = { approved: true, note: 'x'.repeat(1_100_000) };
  const deepInput = { approved: true, note: nested(40) };
  const wideInput = { approved: true, note: Array.from({ length: 1_001 }, (_, i) => i) };
  const privateJwk = { ...corpusPublicJwks('current')[0], d: Buffer.alloc(32, 7).toString('base64url') };

  const v = (id: string, bundle: unknown, context?: ExpectedBundleContext): CorpusVector => ({
    id,
    bundle,
    context,
  });
  return [
    v('valid-full-context', bundleOf(base), FULL_CONTEXT),
    v('valid-partial-context', bundleOf(base), { sessionId: IDS.session }),
    v('valid-no-context', bundleOf(base)),
    v('valid-key-rotation-overlap', bundleOf(await sign('previous')), FULL_CONTEXT),
    v('unknown-retired-key', bundleOf(await sign('retired')), FULL_CONTEXT),
    v('wrong-key-same-kid', bundleOf(await sign('stranger')), FULL_CONTEXT),
    v('tampered-claims', bundleOf(`${h}.${tamperedPayload}.${s}`), FULL_CONTEXT),
    v('tampered-signature', bundleOf(`${h}.${p}.${sig.toString('base64url')}`), FULL_CONTEXT),
    v(
      'wrong-issuer',
      bundleOf(await sign('current', { issuer: 'https://other.corpus.sess.test' })),
      FULL_CONTEXT,
    ),
    v(
      'wrong-algorithm-none',
      bundleOf(`${b64({ alg: 'none', kid: CORPUS_KEYS.current.kid, typ: 'sess-receipt+jwt' })}.${p}.`),
      FULL_CONTEXT,
    ),
    v('wrong-algorithm-hs256', bundleOf(hs256), FULL_CONTEXT),
    v(
      'wrong-type',
      bundleOf(await forge({ kid: CORPUS_KEYS.current.kid, typ: 'JWT' }, json(baseClaims))),
      FULL_CONTEXT,
    ),
    v('missing-kid', bundleOf(await forge({ typ: 'sess-receipt+jwt' }, json(baseClaims))), FULL_CONTEXT),
    v(
      'non-canonical-claims',
      bundleOf(
        await forge(
          { kid: CORPUS_KEYS.current.kid, typ: 'sess-receipt+jwt' },
          new TextEncoder().encode(JSON.stringify(baseClaims, null, 1)),
        ),
      ),
      FULL_CONTEXT,
    ),
    v('wrong-audience', bundleOf(base), { ...FULL_CONTEXT, audience: 'wks_other' }),
    v('wrong-workspace', bundleOf(base), { ...FULL_CONTEXT, workspaceId: 'wks_other' }),
    v('wrong-session', bundleOf(base), { ...FULL_CONTEXT, sessionId: 'ses_other' }),
    v('wrong-event', bundleOf(base), { ...FULL_CONTEXT, eventId: 'evt_other' }),
    v('wrong-revision', bundleOf(base), { ...FULL_CONTEXT, revision: 2 }),
    v('wrong-action', bundleOf(base), { ...FULL_CONTEXT, actionId: 'reject' }),
    v(
      'altered-input',
      bundleOf(base, {
        content: { surface: CORPUS_SURFACE, input: { ...CORPUS_INPUT, approved: false } },
      }),
      FULL_CONTEXT,
    ),
    v(
      'redacted-input',
      bundleOf(base, { content: { surface: CORPUS_SURFACE, input: { approved: true } } }),
      FULL_CONTEXT,
    ),
    v(
      'altered-surface',
      bundleOf(base, {
        content: {
          surface: { ...CORPUS_SURFACE, title: 'Approve a different plan' },
          input: CORPUS_INPUT,
        },
      }),
      FULL_CONTEXT,
    ),
    v(
      'expired',
      bundleOf(
        await sign('current', {
          acceptedAt: new Date('2026-01-01T00:00:00.000Z'),
          expiresAt: new Date('2026-02-01T00:00:00.000Z'),
        }),
      ),
      FULL_CONTEXT,
    ),
    v(
      'future',
      bundleOf(
        await sign('current', {
          acceptedAt: new Date('2100-01-01T00:00:00.000Z'),
          expiresAt: new Date('2100-02-01T00:00:00.000Z'),
        }),
      ),
      FULL_CONTEXT,
    ),
    v('malformed-not-an-object', [bundleOf(base)], FULL_CONTEXT),
    v('malformed-wrong-type', bundleOf(base, { type: 'sess.receipt' }), FULL_CONTEXT),
    v('malformed-extra-member', bundleOf(base, { human_url: 'removed' }), FULL_CONTEXT),
    v('malformed-missing-content', bundleOf(base, { content: undefined }), FULL_CONTEXT),
    v('malformed-private-key-material', bundleOf(base, { keys: { keys: [privateJwk] } }), FULL_CONTEXT),
    v('malformed-receipt-not-a-jws', bundleOf('not-a-receipt'), FULL_CONTEXT),
    v('unsupported-version', bundleOf(base, { version: 2 }), FULL_CONTEXT),
    v(
      'oversized-bytes',
      bundleOf(await sign('current', { input: bigInput }), {
        content: { surface: CORPUS_SURFACE, input: bigInput },
      }),
      FULL_CONTEXT,
    ),
    v(
      'oversized-depth',
      bundleOf(await sign('current', { input: deepInput }), {
        content: { surface: CORPUS_SURFACE, input: deepInput },
      }),
      FULL_CONTEXT,
    ),
    v(
      'oversized-array',
      bundleOf(await sign('current', { input: wideInput }), {
        content: { surface: CORPUS_SURFACE, input: wideInput },
      }),
      FULL_CONTEXT,
    ),
  ].map((x) => ({ ...x, bundle: JSON.parse(JSON.stringify(x.bundle)) as unknown }));
}

/** SHA-256 hex and UTF-8 byte length of a vector's canonical bundle. */
export function bundleDigest(bundle: unknown): { sha256: string; bytes: number } {
  const text = canonicalJson(bundle);
  return {
    sha256: createHash('sha256').update(text, 'utf8').digest('hex'),
    bytes: Buffer.byteLength(text, 'utf8'),
  };
}

/** SHA-256 hex and byte length of a vector's receipt string, when it has one. */
export function receiptDigestOf(bundle: unknown): { sha256: string; bytes: number } | null {
  const r = (bundle as { receipt?: unknown } | null)?.receipt;
  if (typeof r !== 'string') return null;
  return {
    sha256: createHash('sha256').update(r, 'ascii').digest('hex'),
    bytes: Buffer.byteLength(r, 'ascii'),
  };
}

/** The frozen corpus file shared with the Sess core. */
export interface FrozenOutcome {
  valid: boolean;
  reason: string | null;
  content: string;
  context: string;
  mismatches: string[];
  application_purpose: string;
}
export interface FrozenVector {
  id: string;
  expected_context: Record<string, unknown> | null;
  bundle: { sha256: string; bytes: number };
  receipt: { sha256: string; bytes: number } | null;
  expected: { trusted: FrozenOutcome; public: FrozenOutcome };
}
export interface FrozenCorpus {
  issuer: string;
  now: string;
  vectors: FrozenVector[];
}
