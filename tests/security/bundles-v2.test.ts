// Decision-bundle verification, bundle-v2 (docs/spec/bundle-v2.md), on the frozen receipt v2 format
// (`sess_revision: 2`). The shared bundle-v2 corpus is rebuilt from the same labelled test seeds as
// bundle-v1 and checked against its frozen digests before any verification; then every vector must
// reach its frozen result for a trusting caller and for a public verifier, exactly as the Sess core
// does (the corpus and the core's builder are at the commit recorded in docs/spec/source.json).
// bundle-v1 stays as tested in bundles.test.ts. Never print a receipt or key material.
import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { verifyDecisionBundle, type DecisionBundleVerification } from '../../src/receipts/index.js';
import {
  buildCorpusV2Vectors,
  corpusBundleV2WithTitle,
  corpusEnvelope,
  handRevisionHash,
} from '../fixtures/bundle/corpus-v2-vectors.js';
import {
  bundleDigest,
  CORPUS_ISSUER,
  CORPUS_NOW,
  corpusTrustedKeys,
  receiptDigestOf,
  type CorpusVector,
  type FrozenCorpus,
  type FrozenOutcome,
} from '../fixtures/bundle/corpus-vectors.js';

const CORPUS = JSON.parse(
  readFileSync(new URL('../fixtures/bundle/bundle-v2-corpus.json', import.meta.url), 'utf8'),
) as FrozenCorpus;

const outcome = (r: DecisionBundleVerification): FrozenOutcome => ({
  valid: r.valid,
  reason: r.reason,
  content: r.content,
  context: r.context.status,
  mismatches: r.context.mismatches,
  application_purpose: r.application_purpose,
});

let built: Promise<CorpusVector[]> | undefined;
const vectors = () => {
  built ??= buildCorpusV2Vectors();
  return built;
};
const vector = async (id: string) => {
  const v = (await vectors()).find((x) => x.id === id);
  if (!v) throw new Error(`no corpus vector ${id}`);
  return v;
};
const verify = (bundle: unknown) =>
  verifyDecisionBundle(bundle, { issuer: CORPUS_ISSUER, trustedKeys: corpusTrustedKeys(), now: CORPUS_NOW });

/** The most specific owner-chosen title, as a face would show "Asked by" (receipt-v2 §2). */
const askedBy = (r: DecisionBundleVerification) => {
  const t = r.receipt?.revision_envelope?.titles;
  return t ? (t.grant_title ?? t.target_title ?? t.owner_name) : null;
};

describe('decision bundle verification (bundle-v2)', () => {
  it('rebuilds the shared bundle-v2 corpus byte for byte and reaches every frozen result', async () => {
    expect(CORPUS.issuer).toBe(CORPUS_ISSUER);
    expect(CORPUS.now).toBe(CORPUS_NOW.toISOString());
    const rebuilt = await vectors();
    expect(rebuilt.map((v) => v.id)).toEqual(CORPUS.vectors.map((v) => v.id));
    expect(rebuilt).toHaveLength(30);
    const trustedKeys = corpusTrustedKeys();
    const network = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('must stay offline'));
    for (const frozen of CORPUS.vectors) {
      const v = rebuilt.find((x) => x.id === frozen.id) as CorpusVector;
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
      const pub = await verifyDecisionBundle(v.bundle, { issuer: CORPUS_ISSUER, trustedKeys });
      expect(outcome(pub), `${frozen.id} public`).toEqual(frozen.expected.public);
      // A refused bundle never presents a receipt, an envelope or an actor.
      if (!trusted.valid) expect([trusted.receipt, trusted.actor], frozen.id).toEqual([null, null]);
    }
    expect(network).not.toHaveBeenCalled();
    const reasons = new Set(CORPUS.vectors.map((v) => v.expected.trusted.reason));
    for (const r of [null, 'revision', 'type', 'signature', 'unsupported_version'])
      expect(reasons.has(r), `corpus covers ${r}`).toBe(true);
  });

  it('a valid result carries revision_hash and the verified full-form envelope, with no key label', async () => {
    const r = await verify((await vector('v2-valid-full-context')).bundle);
    expect(r.valid).toBe(true);
    expect(r.receipt?.surface.revision_hash).toBe(handRevisionHash(corpusEnvelope()));
    expect(r.receipt?.revision_envelope).toEqual(corpusEnvelope());
    expect(r.receipt?.revision_envelope?.agent_target).toEqual({
      id: 'tgt_corpus_1',
      version: 1,
      name: 'corpus-agent',
    });
    expect(askedBy(r)).toBe('Corpus agent');
    expect(JSON.stringify(r)).not.toContain('key_label');
    const noKey = await verify((await vector('v2-valid-no-key')).bundle);
    expect(noKey.receipt?.revision_envelope).toMatchObject({ key_id: null });
    const missing = await verify((await vector('v2-missing-envelope')).bundle);
    expect([missing.valid, missing.reason, missing.receipt]).toEqual([false, 'revision', null]);
  });

  it('a newer receipt type or a newer envelope is reported as unsupported_version and releases nothing, never as a failure', async () => {
    for (const id of ['v2-receipt-newer-typ', 'v2-envelope-newer', 'v2-unsupported-version']) {
      const r = await verify((await vector(id)).bundle);
      expect(
        { valid: r.valid, reason: r.reason, receipt: r.receipt, actor: r.actor, content: r.content },
        id,
      ).toEqual({
        valid: false,
        reason: 'unsupported_version',
        receipt: null,
        actor: null,
        content: 'not_checked',
      });
    }
    // The never-issued nine-member sess_revision 1 is lower, not newer: a verification failure.
    expect((await verify((await vector('v2-envelope-withdrawn-nine-member')).bundle)).reason).toBe(
      'revision',
    );
  });

  it('a compact envelope is a QR code’s, never a bundle’s: refused with revision though its digest matches', async () => {
    const r = await verify((await vector('v2-envelope-compact-form')).bundle);
    expect([r.valid, r.reason, r.receipt]).toEqual([false, 'revision', null]);
  });

  it('a title the shared title rule refuses (a bidirectional control, a zero-width or default-ignorable character, no visible character) is refused with revision, even under a valid signature', async () => {
    const check = async (title: string) => {
      const r = await verify(await corpusBundleV2WithTitle(title));
      return { valid: r.valid, reason: r.reason, askedBy: askedBy(r) };
    };
    // The control: an allowed title goes through the same path and verifies.
    expect(await check('Ada')).toEqual({ valid: true, reason: null, askedBy: 'Ada' });
    for (const bad of ['A‮B', '⁦Example⁩', '​', 'Example​bakery', 'Example͏bakery', 'ㅤ', '⠀'])
      expect(await check(bad), JSON.stringify(bad)).toEqual({
        valid: false,
        reason: 'revision',
        askedBy: null,
      });
  });
});
