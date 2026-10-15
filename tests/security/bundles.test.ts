// Decision-bundle verification, SDK library face (bundle-v1). The shared conformance
// corpus is rebuilt from labelled test seeds and checked against its frozen digests before any
// verification; then every vector must reach its frozen result for a trusting caller (expected
// context, fixed time) and for a public verifier (no expected context, current time), exactly as
// the Sess core does. Never print a receipt or key material.
import { readFileSync } from 'node:fs';
import { describe, expect, expectTypeOf, it, vi } from 'vitest';
import * as receipts from '../../src/receipts/index.js';
import {
  BUNDLE_LIMITS,
  verifyDecisionBundle,
  verifyDecisionReceipt,
  type DecisionBundleVerification,
  type DeepReadonly,
  type ReceiptClaims,
  type VerifyDecisionReceiptInput,
  type VerifyDecisionReceiptOptions,
} from '../../src/receipts/index.js';
import { SessError } from '../../src/errors.js';
import {
  buildCorpusVectors,
  bundleDigest,
  CORPUS_AUDIENCE,
  CORPUS_INPUT,
  CORPUS_ISSUER,
  CORPUS_NOW,
  CORPUS_SURFACE,
  canonicalJson,
  corpusPublicJwks,
  corpusTrustedKeys,
  FULL_CONTEXT,
  receiptDigestOf,
  type CorpusVector,
  type FrozenCorpus,
  type FrozenOutcome,
} from '../fixtures/bundle/corpus-vectors.js';
import { fixture, now } from './fixtures.js';
import { createHash } from 'node:crypto';

const CORPUS = JSON.parse(
  readFileSync(new URL('../fixtures/bundle/bundle-v1-corpus.json', import.meta.url), 'utf8'),
) as FrozenCorpus;

const outcome = (r: DecisionBundleVerification): FrozenOutcome => ({
  valid: r.valid,
  reason: r.reason,
  content: r.content,
  context: r.context.status,
  mismatches: r.context.mismatches,
  application_purpose: r.application_purpose,
});

const digest = (value: unknown) =>
  `sha256:${createHash('sha256').update(canonicalJson(value), 'utf8').digest('hex')}`;

let built: Promise<CorpusVector[]> | undefined;
const vectors = () => {
  built ??= buildCorpusVectors();
  return built;
};
const vector = async (id: string) => {
  const v = (await vectors()).find((x) => x.id === id);
  if (!v) throw new Error(`no corpus vector ${id}`);
  return v;
};

describe('decision bundle verification (bundle-v1)', () => {
  it('rebuilds the shared corpus byte for byte and reaches every frozen trusted and public result', async () => {
    expect(CORPUS.issuer).toBe(CORPUS_ISSUER);
    expect(CORPUS.now).toBe(CORPUS_NOW.toISOString());
    const rebuilt = await vectors();
    expect(rebuilt.map((v) => v.id)).toEqual(CORPUS.vectors.map((v) => v.id));
    expect(rebuilt).toHaveLength(35);
    const trustedKeys = corpusTrustedKeys();
    const network = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('must stay offline'));
    for (const frozen of CORPUS.vectors) {
      const v = rebuilt.find((x) => x.id === frozen.id) as CorpusVector;
      // The exact bytes first: a vector that does not match its frozen digest proves nothing.
      expect(bundleDigest(v.bundle), `${frozen.id} bundle bytes`).toEqual(frozen.bundle);
      expect(receiptDigestOf(v.bundle), `${frozen.id} receipt bytes`).toEqual(frozen.receipt);
      expect(v.context ?? null, `${frozen.id} expected context`).toEqual(frozen.expected_context);
      const trusted = await verifyDecisionBundle(v.bundle, {
        issuer: CORPUS_ISSUER,
        trustedKeys,
        ...(v.context ? { expectedContext: v.context } : {}),
        now: CORPUS_NOW,
      });
      expect(outcome(trusted), `${frozen.id} trusted`).toEqual(frozen.expected.trusted);
      // The public face: no expected context and the current time.
      const pub = await verifyDecisionBundle(v.bundle, { issuer: CORPUS_ISSUER, trustedKeys });
      expect(outcome(pub), `${frozen.id} public`).toEqual(frozen.expected.public);
    }
    expect(network).not.toHaveBeenCalled();
    // The corpus covers every reason the specification names.
    const reasons = new Set(CORPUS.vectors.map((v) => v.expected.trusted.reason));
    for (const r of [
      null,
      'malformed',
      'oversized',
      'unsupported_version',
      'receipt_malformed',
      'algorithm',
      'missing_kid',
      'unknown_kid',
      'type',
      'signature',
      'issuer',
      'audience',
      'expired',
      'claims',
      'not_yet_valid',
      'surface_mismatch',
      'input_mismatch',
      'context_mismatch',
    ])
      expect(reasons.has(r), `corpus covers ${r}`).toBe(true);
  });

  it('states the checked time, link-holder assurance and verified receipt, never a person, and labels purpose unchecked without trusted context', async () => {
    const v = await vector('valid-full-context');
    const trustedKeys = corpusTrustedKeys();
    const pub = await verifyDecisionBundle(v.bundle, { issuer: CORPUS_ISSUER, trustedKeys, now: CORPUS_NOW });
    expect(pub).toEqual({
      valid: true,
      reason: null,
      checked_at: CORPUS_NOW.toISOString(),
      content: 'verified',
      context: { status: 'unchecked', checked: [], mismatches: [] },
      application_purpose: 'unchecked',
      actor: { assurance: 'link_holder' },
      receipt: {
        key_id: 'corpus-current',
        issuer: CORPUS_ISSUER,
        audience: CORPUS_AUDIENCE,
        event_id: FULL_CONTEXT.eventId,
        session_id: FULL_CONTEXT.sessionId,
        workspace_id: CORPUS_AUDIENCE,
        step_id: 'rev_1',
        surface: { revision: 1, hash: digest(CORPUS_SURFACE), renderer_version: 'renderer@corpus' },
        action: { id: 'approve', label: 'Approve', summary: 'approve' },
        input_hash: digest(CORPUS_INPUT),
        accepted_at: '2026-10-09T12:00:00.123Z',
        expires_at: '2036-10-09T12:00:00.000Z',
      },
    });
    // No actor subject or any other person identifier is presented.
    expect(JSON.stringify(pub)).not.toContain('human_link');
    const trusted = await verifyDecisionBundle(v.bundle, {
      issuer: CORPUS_ISSUER,
      trustedKeys,
      expectedContext: FULL_CONTEXT,
      now: CORPUS_NOW,
    });
    expect(trusted.context).toEqual({
      status: 'verified',
      checked: ['audience', 'workspace_id', 'session_id', 'event_id', 'surface.revision', 'action.id'],
      mismatches: [],
    });
    expect(trusted.application_purpose).toBe('matched_caller_context');
    // An audience mismatch reports the context member, as the core does.
    const wrong = await verifyDecisionBundle(v.bundle, {
      issuer: CORPUS_ISSUER,
      trustedKeys,
      expectedContext: { ...FULL_CONTEXT, audience: 'wks_other' },
      now: CORPUS_NOW,
    });
    expect(wrong.context).toEqual({
      status: 'mismatch',
      checked: ['audience', 'workspace_id', 'session_id', 'event_id', 'surface.revision', 'action.id'],
      mismatches: ['audience'],
    });
    // Default current-time semantics: without `now`, checked_at is the current time.
    const before = Date.now();
    const current = await verifyDecisionBundle(v.bundle, { issuer: CORPUS_ISSUER, trustedKeys });
    expect(Date.parse(current.checked_at)).toBeGreaterThanOrEqual(before - 1);
    expect(Date.parse(current.checked_at)).toBeLessThanOrEqual(Date.now());
  });

  it('trusts only the caller: keys disclosed in the bundle are never used, and the issuer is the caller’s', async () => {
    const stranger = await vector('wrong-key-same-kid');
    // The stranger's bundle discloses the stranger's own key under the issuer's kid: still refused.
    const disguised = { ...(stranger.bundle as object), keys: { keys: corpusPublicJwks('stranger') } };
    const r = await verifyDecisionBundle(disguised, {
      issuer: CORPUS_ISSUER,
      trustedKeys: corpusTrustedKeys(),
      now: CORPUS_NOW,
    });
    expect([r.valid, r.reason]).toEqual([false, 'signature']);
    // A genuine bundle with its keys emptied still verifies with the caller's keys.
    const base = await vector('valid-no-context');
    const emptied = { ...(base.bundle as object), keys: { keys: [] } };
    const ok = await verifyDecisionBundle(emptied, {
      issuer: CORPUS_ISSUER,
      trustedKeys: corpusTrustedKeys(),
      now: CORPUS_NOW,
    });
    expect(ok.valid).toBe(true);
    // Trusting only the stranger's key refuses the genuine bundle, whatever keys it discloses.
    const strangerOnly = await verifyDecisionBundle(base.bundle, {
      issuer: CORPUS_ISSUER,
      trustedKeys: { keys: corpusPublicJwks('stranger') },
      now: CORPUS_NOW,
    });
    expect([strangerOnly.valid, strangerOnly.reason]).toEqual([false, 'signature']);
    // Another trusted issuer refuses it, whatever the bundle says.
    const other = await verifyDecisionBundle(base.bundle, {
      issuer: 'https://another-issuer.example',
      trustedKeys: corpusTrustedKeys(),
      now: CORPUS_NOW,
    });
    expect([other.valid, other.reason]).toEqual([false, 'issuer']);
  });

  it('never throws for hostile input and stays bounded; only invalid options throw TypeError', async () => {
    const trustedKeys = corpusTrustedKeys();
    const opts = { issuer: CORPUS_ISSUER, trustedKeys, now: CORPUS_NOW };
    let deep: unknown = 1;
    for (let i = 0; i < 100_000; i++) deep = [deep];
    const many = Array.from({ length: BUNDLE_LIMITS.objectMembers + 1 }, (_, i) => [`k${i}`, i]);
    for (const [label, bad, reason] of [
      ['null', null, 'malformed'],
      ['string', 'bundle', 'malformed'],
      ['number', 5, 'malformed'],
      ['undefined', undefined, 'malformed'],
      ['a Date', { type: 'sess.decision-bundle', at: new Date(0) }, 'malformed'],
      ['NaN', { type: 'sess.decision-bundle', n: Number.NaN }, 'malformed'],
      ['a lone surrogate', { type: 'sess.decision-bundle', s: '\ud800' }, 'malformed'],
      ['deep nesting', { type: 'sess.decision-bundle', deep }, 'oversized'],
      ['too many members', Object.fromEntries(many), 'oversized'],
      ['version 0', { type: 'sess.decision-bundle', version: 0 }, 'malformed'],
    ] as const) {
      const r = await verifyDecisionBundle(bad, opts);
      expect([r.valid, r.reason], label).toEqual([false, reason]);
    }
    const v = (await vector('valid-no-context')).bundle;
    await expect(verifyDecisionBundle(v, { ...opts, issuer: '' })).rejects.toThrow(TypeError);
    await expect(verifyDecisionBundle(v, { ...opts, now: new Date(Number.NaN) })).rejects.toThrow(TypeError);
    await expect(verifyDecisionBundle(v, { ...opts, expectedContext: { revision: 0 } })).rejects.toThrow(
      TypeError,
    );
    await expect(verifyDecisionBundle(v, { ...opts, expectedContext: { sessionId: '' } })).rejects.toThrow(
      TypeError,
    );
    // Trusted keys are public keys only: private material in the caller's key set is refused too.
    const withPrivate = {
      keys: [{ ...corpusPublicJwks('current')[0], d: Buffer.alloc(32, 7).toString('base64url') }],
    };
    await expect(
      verifyDecisionBundle(v, { ...opts, trustedKeys: withPrivate as unknown as typeof trustedKeys }),
    ).rejects.toThrow(TypeError);
    await expect(
      verifyDecisionBundle(v, { ...opts, trustedKeys: undefined as unknown as typeof trustedKeys }),
    ).rejects.toThrow(TypeError);
  });
});

describe('verifyDecisionReceipt is unchanged', () => {
  it('keeps its exact signature, result and errors alongside the new bundle interface', async () => {
    expectTypeOf(verifyDecisionReceipt).toEqualTypeOf<
      (
        input: VerifyDecisionReceiptInput,
        options?: VerifyDecisionReceiptOptions,
      ) => Promise<DeepReadonly<ReceiptClaims>>
    >();
    expect(verifyDecisionReceipt.length).toBe(1);
    expect(receipts.verifyDecisionReceipt).toBe(verifyDecisionReceipt);
    expect(Object.keys(receipts).sort()).toEqual([
      'BUNDLE_LIMITS',
      'verifyDecisionBundle',
      'verifyDecisionReceipt',
    ]);
    // The same independent vector verifies to the same frozen claims.
    const f = fixture();
    expect(await verifyDecisionReceipt(f.input, { now: new Date(now) })).toEqual(f.claims);
    // Its errors keep their SessError kind and codes.
    await expect(
      verifyDecisionReceipt({ ...f.input, receipt: null }, { now: new Date(now) }),
    ).rejects.toMatchObject({ kind: 'receipt_verification', code: 'LEGACY_RECEIPT_UNAVAILABLE' });
    await expect(
      verifyDecisionReceipt({ ...f.input, issuer: 'https://wrong.example' }, { now: new Date(now) }),
    ).rejects.toBeInstanceOf(SessError);
    await expect(
      verifyDecisionReceipt({ ...f.input, issuer: 'https://wrong.example' }, { now: new Date(now) }),
    ).rejects.toMatchObject({ code: 'ISSUER_MISMATCH' });
    // A bundle's receipt is not accepted by the record-bound receipt interface without its record.
    const base = (await vector('valid-no-context')).bundle as { receipt: string };
    await expect(
      verifyDecisionReceipt({ ...f.input, receipt: base.receipt }, { now: CORPUS_NOW }),
    ).rejects.toBeInstanceOf(SessError);
  });
});
