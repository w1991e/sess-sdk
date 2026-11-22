// The closing-receipt-v1 conformance corpus (docs/spec/closing-receipt-v1.md §9), rebuilt
// deterministically on every run. Ported from the Sess server core's builder (packages/security/
// test/fixtures/closing-corpus-vectors.ts at the commit recorded in docs/spec/source.json);
// closing-receipt-v1-corpus.json is that core's frozen corpus, verbatim. The test-only Ed25519 keys
// take their 32-byte seed from the SHA-256 of a fixed, labelled string: public by construction,
// never trusted outside tests. Nothing token-shaped is committed.
//
// The core builds and signs round and closing receipts with its own issuer library; the SDK has
// none (it only verifies), so the few lines that build the claims are reproduced here with the same
// jose calls and protected-header member order. The commitment is computed by hand, independently
// of the SDK's verifier. The frozen digests prove the bytes are identical.
import { createHash, createPrivateKey, createPublicKey, type KeyObject } from 'node:crypto';
import { CompactSign } from 'jose';
import type { ReceiptKeySet } from '../../../src/receipts/index.js';
import { canonicalJson, jcsDigest } from './corpus-vectors.js';

export const CLOSING_CORPUS_ISSUER = 'https://receipts.corpus.sess.test';
export const CLOSING_CORPUS_AUDIENCE = 'wks_corpus';
export const CLOSING_CORPUS_SESSION = 'ses_corpus_closing_1';

const SEED_PREFIX = 'sess closing-receipt-v1 corpus test key v1';
export const CLOSING_CORPUS_KEYS = {
  /** The issuer's key. */
  current: { kid: 'closing-corpus-current', label: `${SEED_PREFIX} current` },
  /** Someone else's key presenting the issuer's kid. */
  stranger: { kid: 'closing-corpus-current', label: `${SEED_PREFIX} stranger` },
} as const;
type KeyName = keyof typeof CLOSING_CORPUS_KEYS;

const PKCS8_ED25519_PREFIX = Buffer.from('302e020100300506032b657004220420', 'hex');

function corpusPrivateKey(name: KeyName): KeyObject {
  const seed = createHash('sha256').update(CLOSING_CORPUS_KEYS[name].label, 'utf8').digest();
  return createPrivateKey({
    key: Buffer.concat([PKCS8_ED25519_PREFIX, seed]),
    format: 'der',
    type: 'pkcs8',
  });
}

/** What a trusting caller holds: the issuer's public key. */
export function closingCorpusTrustedKeys(): ReceiptKeySet {
  const jwk = createPublicKey(corpusPrivateKey('current')).export({ format: 'jwk' });
  return {
    keys: [
      {
        kty: 'OKP',
        crv: 'Ed25519',
        x: jwk.x as string,
        kid: CLOSING_CORPUS_KEYS.current.kid,
        alg: 'EdDSA',
        use: 'sig',
      },
    ],
  };
}

const SURFACE = {
  mode: 'interactive',
  title: 'Synthetic closing corpus round',
  source: {
    kind: 'sess_surface',
    components: [
      {
        type: 'field',
        name: 'ok',
        label: 'Synthetic question',
        required: true,
        schema: { type: 'boolean' },
      },
    ],
  },
  actions: [{ id: 'send', label: 'Send', intent: 'send' }],
  response_policy: 'first',
} as const;

/** The claims the core's buildReceipt produces for corpus round n (receipt v1). */
function roundClaims(n: number): Record<string, unknown> {
  const acceptedAt = new Date(Date.UTC(2026, 10, 16, 12, n, 0, 123));
  return {
    sess_receipt: 1,
    iss: CLOSING_CORPUS_ISSUER,
    aud: CLOSING_CORPUS_AUDIENCE,
    jti: `evt_corpus_round_${n}`,
    iat: Math.floor(acceptedAt.getTime() / 1000),
    exp: Math.floor(Date.parse('2036-11-16T12:00:00.000Z') / 1000),
    accepted_at: acceptedAt.toISOString(),
    workspace_id: CLOSING_CORPUS_AUDIENCE,
    session_id: CLOSING_CORPUS_SESSION,
    step_id: `rev_${n}`,
    event_id: `evt_corpus_round_${n}`,
    surface: { revision: n, hash: jcsDigest(SURFACE), renderer_version: 'renderer@corpus' },
    action: { id: 'send', label: 'Send', summary: 'send' },
    input_hash: jcsDigest({ ok: n % 2 === 1 }),
    actor: {
      assurance: 'link_holder',
      subject: `${CLOSING_CORPUS_AUDIENCE}:human_link:${CLOSING_CORPUS_SESSION}`,
    },
    return_binding: { recipient: CLOSING_CORPUS_AUDIENCE, return_channel_id: null },
  };
}

const json = (o: unknown) => new TextEncoder().encode(canonicalJson(o));

/** Signs arbitrary header and payload bytes with a corpus key (header {alg, kid, ...header}). */
export async function forge(
  header: Record<string, unknown>,
  payload: Uint8Array,
  name: KeyName = 'current',
): Promise<string> {
  return new CompactSign(payload)
    .setProtectedHeader({ alg: 'EdDSA', kid: CLOSING_CORPUS_KEYS[name].kid, ...header } as { alg: string })
    .sign(corpusPrivateKey(name));
}

const CLOSING_TYP = 'sess-closing-receipt+jwt';
const ROUND_TYP = 'sess-receipt+jwt';

/** The commitment over round receipts' exact bytes (closing-receipt-v1 §3), by hand. */
export function handCommitment(receipts: readonly string[]): string {
  const count = Buffer.alloc(4);
  count.writeUInt32BE(receipts.length);
  return createHash('sha256')
    .update(
      Buffer.concat([
        Buffer.from('sess.closing-commitment/v1/accepted_rounds', 'utf8'),
        Buffer.from([0]),
        count,
        ...receipts.map((r) => createHash('sha256').update(Buffer.from(r, 'ascii')).digest()),
      ]),
    )
    .digest('base64url');
}

type Cause = 'completed_by_owner' | 'completed_by_ask_rule' | 'final_expiry' | 'revoked';
export interface ClosingInput {
  issuer: string;
  workspaceId: string;
  sessionId: string;
  closureId: string;
  cause: Cause;
  terminalEventId: string | null;
  effectiveEndAt: Date;
  recordedAt: Date;
  issuedAt: Date;
  rounds: readonly string[];
}

/** The claims the core's buildClosingReceipt produces. */
export function closingClaimsOf(input: ClosingInput): Record<string, unknown> {
  return {
    sess_closing_receipt: 1,
    iss: input.issuer,
    aud: input.workspaceId,
    jti: input.closureId,
    iat: Math.floor(input.issuedAt.getTime() / 1000),
    workspace_id: input.workspaceId,
    session_id: input.sessionId,
    terminal: {
      event_id: input.terminalEventId,
      cause: input.cause,
      actor_class: input.cause === 'final_expiry' ? 'sess' : 'owner',
    },
    effective_end_at: input.effectiveEndAt.toISOString(),
    recorded_at: input.recordedAt.toISOString(),
    issued_at: input.issuedAt.toISOString(),
    commitments: [
      { scope: 'accepted_rounds', count: input.rounds.length, commitment: handCommitment(input.rounds) },
    ],
  };
}

/** Signs closing claims as the core does: header {alg, kid, typ}, canonical payload. */
export function signClosingClaims(claims: unknown, name: KeyName = 'current'): Promise<string> {
  return forge({ typ: CLOSING_TYP }, json(claims), name);
}

export interface ClosingCorpus {
  rounds: { id: string; jws: string }[];
  vectors: { id: string; description: string; jws: string; expected: string }[];
  commitments: { id: string; rounds: string[]; commitment: string }[];
  /** The base inputs, for tests beyond the frozen vectors. */
  base: ClosingInput;
}

/** Rebuilds the whole corpus. */
export async function buildClosingCorpus(): Promise<ClosingCorpus> {
  const v1 = await Promise.all([1, 2, 3].map((n) => forge({ typ: ROUND_TYP }, json(roundClaims(n)))));
  // A receipt-v2-shaped round receipt: the commitment hashes its exact bytes like any other.
  const v2 = await forge(
    { typ: ROUND_TYP },
    json({ sess_receipt: 2, iss: CLOSING_CORPUS_ISSUER, session_id: CLOSING_CORPUS_SESSION }),
  );
  const rounds = [
    { id: 'round-1-v1', jws: v1[0] as string },
    { id: 'round-2-v1', jws: v1[1] as string },
    { id: 'round-3-v1', jws: v1[2] as string },
    { id: 'round-4-v2', jws: v2 },
  ];
  const jwsOf = (id: string) => rounds.find((r) => r.id === id)?.jws ?? '';

  const base: ClosingInput = {
    issuer: CLOSING_CORPUS_ISSUER,
    workspaceId: CLOSING_CORPUS_AUDIENCE,
    sessionId: CLOSING_CORPUS_SESSION,
    closureId: 'cls_01KCORPUSCLOSING0000000001',
    cause: 'final_expiry',
    terminalEventId: 'evt_corpus_expired_1',
    effectiveEndAt: new Date('2026-11-16T13:00:00.000Z'),
    recordedAt: new Date('2026-11-16T13:04:10.250Z'),
    issuedAt: new Date('2026-11-16T13:04:10.731Z'),
    rounds: ['round-1-v1', 'round-2-v1', 'round-3-v1'].map(jwsOf),
  };
  const sign = (over: Partial<ClosingInput> = {}, name: KeyName = 'current') =>
    signClosingClaims(closingClaimsOf({ ...base, ...over }), name);
  // In canonical member order, as the core reads its claims back (the non-canonical vector keeps it).
  const claims = JSON.parse(canonicalJson(closingClaimsOf(base))) as Record<string, unknown>;
  const withClaims = (patch: (c: Record<string, unknown>) => void) => {
    const c = structuredClone(claims);
    patch(c);
    return forge({ typ: CLOSING_TYP }, json(c));
  };
  const commitmentsOf = (c: Record<string, unknown>) => c.commitments as Record<string, unknown>[];
  const acceptedRounds = () => structuredClone(commitmentsOf(claims)[0] as Record<string, unknown>);
  const publishedPages = {
    scope: 'published_pages',
    count: 2,
    commitment: createHash('sha256')
      .update('sess.closing-commitment/v1/published_pages corpus', 'utf8')
      .digest('base64url'),
  };

  const validJws = await sign();
  const [h, p, s] = validJws.split('.') as [string, string, string];
  const flipped = `${h}.${p}.${s.slice(0, -2)}${s.slice(-2) === 'AA' ? 'AB' : 'AA'}`;
  const tamperedPayload = Buffer.from(canonicalJson({ ...claims, session_id: 'ses_corpus_other' })).toString(
    'base64url',
  );

  const vectors: ClosingCorpus['vectors'] = [
    { id: 'valid-final-expiry', description: '', jws: validJws, expected: 'valid' },
    {
      id: 'valid-completed-by-owner',
      description: '',
      jws: await sign({
        cause: 'completed_by_owner',
        terminalEventId: 'evt_corpus_completion_1',
        effectiveEndAt: new Date('2026-11-16T12:30:00.000Z'),
        recordedAt: new Date('2026-11-16T12:30:00.000Z'),
        issuedAt: new Date('2026-11-16T12:30:00.004Z'),
        rounds: [jwsOf('round-1-v1')],
      }),
      expected: 'valid',
    },
    {
      id: 'valid-completed-by-ask-rule-with-v2-round',
      description: '',
      jws: await sign({
        cause: 'completed_by_ask_rule',
        terminalEventId: 'evt_corpus_completion_2',
        effectiveEndAt: new Date('2026-11-16T12:05:00.123Z'),
        recordedAt: new Date('2026-11-16T12:05:00.123Z'),
        issuedAt: new Date('2026-11-16T12:05:00.130Z'),
        rounds: [jwsOf('round-1-v1'), jwsOf('round-4-v2')],
      }),
      expected: 'valid',
    },
    { id: 'round-receipt-offered', description: '', jws: jwsOf('round-1-v1'), expected: 'type' },
    {
      id: 'has-exp',
      description: '',
      jws: await withClaims((c) => {
        c.exp = (c.iat as number) + 3600;
      }),
      expected: 'claims',
    },
    {
      id: 'newer-format-version',
      description: '',
      jws: await withClaims((c) => {
        c.sess_closing_receipt = 2;
      }),
      expected: 'newer',
    },
    {
      id: 'format-version-zero',
      description: '',
      jws: await withClaims((c) => {
        c.sess_closing_receipt = 0;
      }),
      expected: 'unsupported',
    },
    {
      id: 'format-version-not-whole',
      description: '',
      jws: await withClaims((c) => {
        c.sess_closing_receipt = 1.5;
      }),
      expected: 'unsupported',
    },
    {
      id: 'unknown-extra-scope',
      description: '',
      jws: await withClaims((c) => {
        c.commitments = [acceptedRounds(), publishedPages];
      }),
      expected: 'newer',
    },
    {
      id: 'missing-accepted-rounds',
      description: '',
      jws: await withClaims((c) => {
        c.commitments = [publishedPages];
      }),
      expected: 'claims',
    },
    {
      id: 'duplicate-scope',
      description: '',
      jws: await withClaims((c) => {
        c.commitments = [acceptedRounds(), acceptedRounds()];
      }),
      expected: 'claims',
    },
    {
      id: 'scopes-out-of-order',
      description: '',
      jws: await withClaims((c) => {
        c.commitments = [publishedPages, acceptedRounds()];
      }),
      expected: 'claims',
    },
    {
      id: 'scope-not-a-plain-word',
      description: '',
      jws: await withClaims((c) => {
        c.commitments = [acceptedRounds(), { ...publishedPages, scope: 'Published.Pages' }];
      }),
      expected: 'claims',
    },
    {
      id: 'commitment-entry-extra-member',
      description: '',
      jws: await withClaims((c) => {
        c.commitments = [{ ...acceptedRounds(), alg: 'sha256' }];
      }),
      expected: 'claims',
    },
    {
      id: 'commitment-not-base64url',
      description: '',
      jws: await withClaims((c) => {
        c.commitments = [{ ...acceptedRounds(), commitment: `sha256:${'0'.repeat(64)}` }];
      }),
      expected: 'claims',
    },
    {
      id: 'commitment-not-canonical',
      description: '',
      jws: await withClaims((c) => {
        const entry = acceptedRounds();
        entry.commitment = `${(entry.commitment as string).slice(0, 42)}B`;
        c.commitments = [entry];
      }),
      expected: 'claims',
    },
    {
      id: 'too-many-commitments',
      description: '',
      jws: await withClaims((c) => {
        c.commitments = [
          acceptedRounds(),
          ...Array.from({ length: 16 }, (_, i) => ({
            ...publishedPages,
            scope: `scope_${String(i + 1).padStart(2, '0')}`,
          })),
        ];
      }),
      expected: 'claims',
    },
    {
      id: 'unknown-scope-negative-count',
      description: '',
      jws: await withClaims((c) => {
        c.commitments = [acceptedRounds(), { ...publishedPages, count: -1 }];
      }),
      expected: 'claims',
    },
    {
      id: 'actor-class-not-derived',
      description: '',
      jws: await withClaims((c) => {
        (c.terminal as Record<string, unknown>).actor_class = 'owner';
      }),
      expected: 'claims',
    },
    {
      id: 'issued-before-recorded',
      description: '',
      jws: await withClaims((c) => {
        c.issued_at = '2026-11-16T13:04:09.000Z';
        c.iat = Math.floor(Date.parse('2026-11-16T13:04:09.000Z') / 1000);
      }),
      expected: 'claims',
    },
    {
      id: 'zero-rounds',
      description: '',
      jws: await withClaims((c) => {
        (commitmentsOf(c)[0] as Record<string, unknown>).count = 0;
      }),
      expected: 'claims',
    },
    { id: 'tampered-payload', description: '', jws: `${h}.${tamperedPayload}.${s}`, expected: 'signature' },
    { id: 'tampered-signature', description: '', jws: flipped, expected: 'signature' },
    { id: 'stranger-key', description: '', jws: await sign({}, 'stranger'), expected: 'signature' },
    {
      id: 'wrong-issuer',
      description: '',
      jws: await sign({ issuer: 'https://other.corpus.sess.test' }),
      expected: 'issuer',
    },
    {
      id: 'wrong-audience',
      description: '',
      jws: await sign({ workspaceId: 'wks_corpus_other' }),
      expected: 'audience',
    },
    {
      id: 'non-canonical-payload',
      description: '',
      jws: await forge({ typ: CLOSING_TYP }, new TextEncoder().encode(JSON.stringify(claims, null, 1))),
      expected: 'claims',
    },
    {
      id: 'alg-none',
      description: '',
      jws: `${Buffer.from(JSON.stringify({ alg: 'none', typ: CLOSING_TYP })).toString('base64url')}.${p}.`,
      expected: 'algorithm',
    },
  ];

  const commitments = [
    { id: 'one-round', rounds: ['round-1-v1'] },
    { id: 'three-rounds', rounds: ['round-1-v1', 'round-2-v1', 'round-3-v1'] },
    { id: 'three-rounds-reordered', rounds: ['round-2-v1', 'round-1-v1', 'round-3-v1'] },
    { id: 'middle-round-removed', rounds: ['round-1-v1', 'round-3-v1'] },
    { id: 'last-round-removed', rounds: ['round-1-v1', 'round-2-v1'] },
    { id: 'duplicated-round', rounds: ['round-1-v1', 'round-1-v1', 'round-2-v1', 'round-3-v1'] },
    { id: 'v1-and-v2-rounds', rounds: ['round-1-v1', 'round-4-v2'] },
  ].map((c) => ({ ...c, commitment: handCommitment(c.rounds.map(jwsOf)) }));

  return { rounds, vectors, commitments, base };
}
