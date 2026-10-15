// The archival-v1 compatibility/state corpus (docs/spec/archival-core-v1.md §7), rebuilt
// deterministically on every run. Ported from the Sess evidence package's builder
// (packages/evidence/test/fixtures/archival-corpus-vectors.ts at the commit recorded in
// docs/spec/source.json); archival-v1-corpus.json is that package's frozen corpus, verbatim. It
// commits no token-shaped string: it holds the claims inputs, the expected results and, per
// vector, the SHA-256 and byte length of the exact input, receipt JWS and canonical core.
//
// Keys: test-only Ed25519 keys whose 32-byte seed is SHA-256 of a fixed, labelled string. They are
// public by construction and must never sign anything outside tests. Ed25519 is deterministic, so
// the same receipts, cores and envelopes are rebuilt byte for byte; the corpus test checks every
// rebuilt vector against its frozen digests before verifying it.
//
// Sess builds receipts and cores with its issuer libraries; the SDK only verifies, so the few lines
// that build and sign them are reproduced here (receipt claims as Sess's buildReceipt writes them,
// the same jose protected-header member order, the archival signing domain). The frozen digests
// prove the bytes are identical.
import { createHash, createPrivateKey, createPublicKey, type KeyObject, sign } from 'node:crypto';
import { CompactSign } from 'jose';
import {
  ARCHIVAL_CORE_PURPOSE,
  ARCHIVAL_CORE_TYPE,
  ARCHIVAL_CORE_VERSION,
  type ArchivalCore,
  archivalCoreText,
  archivalSigningInput,
  parseArchivalCore,
  type SignedArchivalCore,
  SIGNED_ARCHIVAL_CORE_TYPE,
  sha256Digest,
} from '../../../src/archival/core.js';
import { type ArchivalEnvelope, parseArchivalEnvelope } from '../../../src/archival/envelope.js';
import {
  ARCHIVAL_ENVELOPE_MAX_BYTES,
  type ArchivalVerification,
  type ExpectedArchivalContext,
  presentArchivalVerification,
} from '../../../src/archival/index.js';
import { canonicalJson } from '../../../src/receipts/json.js';
import type { ReceiptKeySet } from '../../../src/receipts/verify.js';

/** The labelled seed strings of the corpus's test-only keys (SHA-256 of each is the seed). */
export const CORPUS_KEY_LABEL = 'sess archival-core corpus test key v1';
export const CORPUS_STRANGER_KEY_LABEL = 'sess archival-core corpus stranger key v1';

/** RFC 8410 PKCS#8 framing of an Ed25519 private key around its 32-byte seed. */
const ED25519_PKCS8_HEADER = Buffer.from('302e020100300506032b657004220420', 'hex');

/** A test-only signing key: an Ed25519 private key and the kid it signs under. */
export interface TestKey {
  kid: string;
  privateKey: KeyObject;
}

export function derivedKey(label: string, kid: string): TestKey {
  const seed = createHash('sha256').update(label, 'utf8').digest();
  return {
    kid,
    privateKey: createPrivateKey({
      key: Buffer.concat([ED25519_PKCS8_HEADER, seed]),
      format: 'der',
      type: 'pkcs8',
    }),
  };
}

/** The published-key-set member for a test key (Sess's member order). */
export function publicJwkOf(key: TestKey) {
  const jwk = createPublicKey(key.privateKey).export({ format: 'jwk' });
  return {
    kty: 'OKP' as const,
    crv: 'Ed25519' as const,
    x: jwk.x as string,
    kid: key.kid,
    alg: 'EdDSA' as const,
    use: 'sig' as const,
  };
}

const jcsDigest = (value: unknown) => sha256Digest(canonicalJson(value));

/** The receipt input, as Sess's buildReceipt takes it. */
export interface ReceiptInput {
  issuer: string;
  workspaceId: string;
  sessionId: string;
  stepId: string;
  eventId: string;
  surface: { revision: number; document: unknown; rendererVersion: string };
  action: { id: string; label: string; summary: string };
  input: unknown;
  actor: { assurance: 'link_holder'; subject: string };
  acceptedAt: Date;
  expiresAt: Date;
  recipient: { audience: string; returnChannelId: string | null };
}

/** The receipt-v1 claims Sess's buildReceipt writes for `r`. */
export function buildReceipt(r: ReceiptInput): Record<string, unknown> {
  return {
    sess_receipt: 1,
    iss: r.issuer,
    aud: r.recipient.audience,
    jti: r.eventId,
    iat: Math.floor(r.acceptedAt.getTime() / 1000),
    exp: Math.floor(r.expiresAt.getTime() / 1000),
    accepted_at: r.acceptedAt.toISOString(),
    workspace_id: r.workspaceId,
    session_id: r.sessionId,
    step_id: r.stepId,
    event_id: r.eventId,
    surface: {
      revision: r.surface.revision,
      hash: jcsDigest(r.surface.document),
      renderer_version: r.surface.rendererVersion,
    },
    action: { ...r.action },
    input_hash: jcsDigest(r.input),
    actor: { assurance: r.actor.assurance, subject: `${r.workspaceId}:${r.actor.subject}` },
    return_binding: { recipient: r.recipient.audience, return_channel_id: r.recipient.returnChannelId },
  };
}

/** Signs canonical claims as Sess's signReceipt does: compact JWS, header {alg, kid, typ}. */
export function signReceipt(claims: Record<string, unknown>, key: TestKey): Promise<string> {
  return new CompactSign(new TextEncoder().encode(canonicalJson(claims)))
    .setProtectedHeader({ alg: 'EdDSA', kid: key.kid, typ: 'sess-receipt+jwt' })
    .sign(key.privateKey);
}

/** The archival core of an issued receipt, read from its own claims (Sess's buildArchivalCore). */
export function buildArchivalCore(receipt: string, workspaceSequence: number): ArchivalCore {
  const claims = JSON.parse(
    Buffer.from(receipt.split('.')[1] as string, 'base64url').toString('utf8'),
  ) as Record<string, unknown>;
  return parseArchivalCore({
    type: ARCHIVAL_CORE_TYPE,
    version: ARCHIVAL_CORE_VERSION,
    purpose: ARCHIVAL_CORE_PURPOSE,
    issuer: claims.iss,
    workspace_id: claims.workspace_id,
    event_id: claims.event_id,
    receipt: {
      typ: 'sess-receipt+jwt',
      version: 1,
      digest: sha256Digest(receipt),
      byte_length: Buffer.byteLength(receipt),
    },
    accepted_at: claims.accepted_at,
    workspace_sequence: workspaceSequence,
    bindings: { target: null, capability: null, owner: null },
  });
}

/** Signs the core in the archival signing domain (pure Ed25519, deterministic). */
export function signArchivalCore(core: ArchivalCore, key: TestKey): SignedArchivalCore {
  return {
    type: SIGNED_ARCHIVAL_CORE_TYPE,
    version: ARCHIVAL_CORE_VERSION,
    core: parseArchivalCore(core),
    signature: {
      alg: 'Ed25519',
      kid: key.kid,
      value: sign(null, archivalSigningInput(core), key.privateKey).toString('base64url'),
    },
  };
}

/** The envelope of a custody record (Sess's archivalEnvelope). */
export function archivalEnvelope(
  receipt: string,
  signedCore: SignedArchivalCore,
  evidence: readonly unknown[] = [],
): ArchivalEnvelope {
  return parseArchivalEnvelope({
    type: 'sess.archival-envelope',
    version: 1,
    receipt,
    signed_core: signedCore,
    evidence: [...evidence],
  });
}

export interface CorpusCase {
  name: string;
  /** The verifier input: an envelope value, or a string. */
  input: unknown;
  /** Spaces appended to the input's JSON text (the oversized case). */
  padding?: number;
  options: { now: string; content?: 'disclosed' | 'altered'; context?: ExpectedArchivalContext };
  expect: Record<string, unknown>;
}

export interface CorpusVectors {
  keys: ReturnType<typeof publicJwkOf>[];
  content: Record<'disclosed' | 'altered', { surface: unknown; input: unknown }>;
  receiptV1: {
    jws: string;
    issuer: string;
    audience: string;
    claimsDigest: string;
    validAt: string;
    expiredAt: string;
  };
  coreText: string;
  cases: CorpusCase[];
}

/** The input's JSON text, as the corpus digests it (strings as they are). */
export const inputText = (input: unknown): string =>
  typeof input === 'string' ? input : JSON.stringify(input);

const measured = (text: string) => ({
  sha256: sha256Digest(text),
  byte_length: Buffer.byteLength(text),
});

/** What the corpus freezes of one vector: digests and lengths of its exact parts, never the bytes. */
export function vectorDigests(input: unknown): Record<string, unknown> {
  const out: Record<string, unknown> = { input: measured(inputText(input)) };
  if (input !== null && typeof input === 'object') {
    const e = input as { receipt?: unknown; signed_core?: { core?: unknown } };
    if (typeof e.receipt === 'string') out.receipt = measured(e.receipt);
    if (e.signed_core?.core !== undefined) out.core = measured(canonicalJson(e.signed_core.core));
  }
  return out;
}

/** The committed corpus document for the vectors. */
export function frozenCorpus(v: CorpusVectors): Record<string, unknown> {
  return {
    format: 'sess.archival-corpus',
    version: 2,
    spec: 'DOCS/spec/archival-core-v1.md',
    note: 'Synthetic vectors, rebuilt by archival-corpus-vectors.ts from labelled test-only keys; frozen here by digest.',
    key_labels: { corpus: CORPUS_KEY_LABEL, stranger: CORPUS_STRANGER_KEY_LABEL },
    keys: v.keys,
    content: v.content,
    receipt_v1: {
      jws: measured(v.receiptV1.jws),
      issuer: v.receiptV1.issuer,
      audience: v.receiptV1.audience,
      claims_digest: v.receiptV1.claimsDigest,
      valid_at: v.receiptV1.validAt,
      expired_at: v.receiptV1.expiredAt,
    },
    core_text: v.coreText,
    cases: v.cases.map((c) => ({
      name: c.name,
      vector: vectorDigests(c.input),
      ...(c.padding === undefined ? {} : { padding: c.padding }),
      options: c.options,
      expect: c.expect,
    })),
  };
}

/** The corpus key's public key set: what a trusting caller holds. */
export function corpusTrustedKeys(): ReceiptKeySet {
  return { keys: [publicJwkOf(derivedKey(CORPUS_KEY_LABEL, 'corpus-2026-01'))] };
}

/** Rebuilds every corpus vector. */
export async function corpusVectors(): Promise<CorpusVectors> {
  const ISSUER = 'https://api.sess.example';
  const WORKSPACE = 'wks_corpus';
  const SURFACE = {
    title: 'Approve the weather plan',
    blocks: [{ type: 'text', text: 'Rain after 3 pm; move the walk to 10 am.' }],
    actions: [{ id: 'approve', label: 'Approve' }],
  };
  const INPUT = { approved: true };
  const ACCEPTED = new Date('2026-01-05T09:30:00.250Z');
  const EXPIRES = new Date('2026-02-04T09:31:00.000Z');
  const LIVE = '2026-01-20T00:00:00.000Z';
  const AFTER = '2026-03-01T00:00:00.000Z';

  const copy = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

  const key = derivedKey(CORPUS_KEY_LABEL, 'corpus-2026-01');
  // Same kid, another key: a core it signs must not verify under the corpus key.
  const stranger = derivedKey(CORPUS_STRANGER_KEY_LABEL, 'corpus-2026-01');

  const receiptInput = (input: unknown): ReceiptInput => ({
    issuer: ISSUER,
    workspaceId: WORKSPACE,
    sessionId: 'ses_corpus_1',
    stepId: 'rev_1',
    eventId: 'evt_corpus_1',
    surface: { revision: 1, document: SURFACE, rendererVersion: 'renderer@0.0.0' },
    action: { id: 'approve', label: 'Approve', summary: '' },
    input,
    actor: { assurance: 'link_holder', subject: 'human_link:ses_corpus_1' },
    acceptedAt: ACCEPTED,
    expiresAt: EXPIRES,
    recipient: { audience: WORKSPACE, returnChannelId: null },
  });
  const claims = buildReceipt(receiptInput(INPUT));
  const receipt = await signReceipt(claims, key);
  const otherReceipt = await signReceipt(buildReceipt(receiptInput({ approved: false })), key);

  const core = buildArchivalCore(receipt, 1);
  const positive = archivalEnvelope(receipt, signArchivalCore(core, key));
  const env = (f: (e: Record<string, unknown> & typeof positive) => void) => {
    const e = copy(positive) as Record<string, unknown> & typeof positive;
    f(e);
    return e;
  };

  const plainSignature = sign(null, Buffer.from(archivalCoreText(core)), key.privateKey).toString(
    'base64url',
  );
  const [h, p, s] = receipt.split('.') as [string, string, string];
  const forgedReceipt = `${h}.${p}.${s.startsWith('A') ? `B${s.slice(1)}` : `A${s.slice(1)}`}`;

  const CONTEXT = {
    issuer: ISSUER,
    audience: WORKSPACE,
    workspace_id: WORKSPACE,
    session_id: 'ses_corpus_1',
    event_id: 'evt_corpus_1',
    surface_revision: 1,
    action_id: 'approve',
  };
  const REFUSED = {
    contents: 'unverifiable:signature_unverified',
    context: 'unverifiable:signature_unverified',
    witness: 'unverifiable:signature_unverified',
    live_expiry: 'unverifiable:signature_unverified',
    verified: false,
    messages: [],
  };
  const refused = (signature: string, key_trust = 'unverifiable:not_evaluated') => ({
    signature,
    key_trust,
    ...REFUSED,
  });
  const ok = {
    signature: 'valid:verified',
    key_trust: 'valid:trusted',
    witness: 'pending:unwitnessed',
    verified: true,
  };

  const cases: CorpusCase[] = [
    {
      name: 'positive: content disclosed, trusted context',
      input: positive,
      options: { now: LIVE, content: 'disclosed', context: CONTEXT },
      expect: {
        ...ok,
        contents: 'valid:verified',
        context: 'valid:verified',
        live_expiry: 'valid:unexpired',
        messages: ['signature_verified', 'contents_verified'],
      },
    },
    {
      name: 'positive: no content, no context',
      input: positive,
      options: { now: LIVE },
      expect: {
        ...ok,
        contents: 'unverifiable:content_unavailable',
        context: 'unverifiable:unchecked',
        live_expiry: 'valid:unexpired',
        messages: ['signature_verified', 'contents_unavailable', 'application_context_unchecked'],
      },
    },
    {
      name: 'positive: expired for live use',
      input: positive,
      options: { now: AFTER, content: 'disclosed', context: CONTEXT },
      expect: {
        ...ok,
        contents: 'valid:verified',
        context: 'valid:verified',
        live_expiry: 'invalid:expired',
        messages: ['signature_verified', 'contents_verified'],
      },
    },
    {
      name: 'content mismatch',
      input: positive,
      options: { now: LIVE, content: 'altered', context: CONTEXT },
      expect: {
        ...ok,
        contents: 'invalid:content_mismatch',
        context: 'valid:verified',
        live_expiry: 'valid:unexpired',
        verified: false,
        messages: [],
      },
    },
    {
      name: 'context mismatch',
      input: positive,
      options: { now: LIVE, context: { ...CONTEXT, audience: 'wks_other' } },
      expect: {
        ...ok,
        contents: 'unverifiable:content_unavailable',
        context: 'invalid:mismatch',
        live_expiry: 'valid:unexpired',
        verified: false,
        messages: [],
      },
    },
    {
      name: 'tampered core',
      input: env((e) => ((e.signed_core.core as { workspace_sequence: number }).workspace_sequence = 2)),
      options: { now: LIVE },
      expect: refused('invalid:core_signature', 'valid:trusted'),
    },
    {
      name: 'wrong signing domain (plain JCS signature)',
      input: env((e) => ((e.signed_core.signature as { value: string }).value = plainSignature)),
      options: { now: LIVE },
      expect: refused('invalid:core_signature', 'valid:trusted'),
    },
    {
      name: 'receipt signature presented as core signature',
      input: env((e) => ((e.signed_core.signature as { value: string }).value = s)),
      options: { now: LIVE },
      expect: refused('invalid:core_signature', 'valid:trusted'),
    },
    {
      name: 'wrong core type',
      input: env((e) => ((e.signed_core.core as { type: string }).type = 'sess.receipt')),
      options: { now: LIVE },
      expect: refused('invalid:wrong_type'),
    },
    {
      name: 'wrong envelope type',
      input: env((e) => (e.type = 'sess.decision-bundle' as never)),
      options: { now: LIVE },
      expect: refused('invalid:wrong_type'),
    },
    {
      name: 'unknown core version',
      input: env((e) => ((e.signed_core.core as { version: number }).version = 2)),
      options: { now: LIVE },
      expect: refused('unsupported:unknown_version'),
    },
    {
      name: 'unknown envelope version',
      input: env((e) => (e.version = 2 as never)),
      options: { now: LIVE },
      expect: refused('unsupported:unknown_version'),
    },
    {
      name: 'unsupported core signature algorithm',
      input: env((e) => ((e.signed_core.signature as { alg: string }).alg = 'ES256')),
      options: { now: LIVE },
      expect: refused('unsupported:unsupported_algorithm'),
    },
    {
      name: 'malformed: missing evidence member',
      input: env((e) => delete (e as Record<string, unknown>).evidence),
      options: { now: LIVE },
      expect: refused('invalid:malformed'),
    },
    {
      name: 'malformed: extra core member',
      input: env((e) => ((e.signed_core.core as unknown as Record<string, unknown>).witness = 'done')),
      options: { now: LIVE },
      expect: refused('invalid:malformed'),
    },
    {
      name: 'malformed: a receipt-v1 JWS is not an envelope',
      input: receipt,
      options: { now: LIVE },
      expect: refused('invalid:malformed'),
    },
    {
      name: 'oversized: the envelope text padded past the bound',
      input: positive,
      padding: ARCHIVAL_ENVELOPE_MAX_BYTES,
      options: { now: LIVE },
      expect: refused('invalid:oversized'),
    },
    {
      name: 'mismatched original digest: the core names other receipt bytes',
      input: env((e) => ((e as { receipt: string }).receipt = otherReceipt)),
      options: { now: LIVE },
      expect: refused('invalid:receipt_digest_mismatch', 'valid:trusted'),
    },
    {
      name: 'receipt signature does not verify',
      input: archivalEnvelope(forgedReceipt, signArchivalCore(buildArchivalCore(forgedReceipt, 1), key)),
      options: { now: LIVE },
      expect: refused('invalid:receipt_signature', 'valid:trusted'),
    },
    {
      name: 'core signed by an untrusted key',
      input: archivalEnvelope(receipt, signArchivalCore(core, stranger)),
      options: { now: LIVE },
      expect: refused('invalid:core_signature', 'valid:trusted'),
    },
    {
      name: 'unknown kid',
      input: env((e) => ((e.signed_core.signature as { kid: string }).kid = 'corpus-unknown')),
      options: { now: LIVE },
      expect: refused('unverifiable:untrusted_key', 'unverifiable:unknown_kid'),
    },
    {
      name: 'witness evidence of an unsupported type',
      input: env((e) => ((e as { evidence: readonly unknown[] }).evidence = [{ type: 'rfc3161-token' }])),
      options: { now: LIVE },
      expect: {
        ...ok,
        witness: 'unsupported:unsupported_evidence',
        contents: 'unverifiable:content_unavailable',
        context: 'unverifiable:unchecked',
        live_expiry: 'valid:unexpired',
        messages: ['signature_verified', 'contents_unavailable', 'application_context_unchecked'],
      },
    },
    {
      name: 'malformed witness evidence',
      input: env((e) => ((e as { evidence: readonly unknown[] }).evidence = ['not evidence'])),
      options: { now: LIVE },
      expect: {
        ...ok,
        witness: 'invalid:malformed_evidence',
        contents: 'unverifiable:content_unavailable',
        context: 'unverifiable:unchecked',
        live_expiry: 'valid:unexpired',
        messages: ['signature_verified', 'contents_unavailable', 'application_context_unchecked'],
      },
    },
  ];

  return {
    keys: [publicJwkOf(key)],
    content: {
      disclosed: { surface: SURFACE, input: INPUT },
      altered: { surface: SURFACE, input: { approved: false } },
    },
    receiptV1: {
      jws: receipt,
      issuer: ISSUER,
      audience: WORKSPACE,
      claimsDigest: jcsDigest(claims),
      validAt: LIVE,
      expiredAt: AFTER,
    },
    coreText: archivalCoreText(core),
    cases,
  };
}

/** The dimension summary the Sess corpus freezes for each vector (as its corpus test computes it). */
export const summary = (r: ArchivalVerification) => {
  const p = presentArchivalVerification(r);
  return {
    signature: `${r.signature.status}:${r.signature.reason}`,
    contents: `${r.contents.status}:${r.contents.reason}`,
    context: `${r.context.status}:${r.context.reason}`,
    witness: `${r.witness.status}:${r.witness.reason}`,
    key_trust: `${r.key_trust.status}:${r.key_trust.reason}`,
    live_expiry: `${r.live_expiry.status}:${r.live_expiry.reason}`,
    verified: p.verified,
    messages: p.messages,
  };
};
