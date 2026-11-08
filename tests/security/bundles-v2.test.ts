// Decision-bundle verification, bundle-v2 (docs/spec/bundle-v2.md). The shared bundle-v2 corpus is
// rebuilt from the same labelled test seeds as bundle-v1 and checked against its frozen digests
// before any verification; then every vector must reach its frozen result for a trusting caller and
// for a public verifier, exactly as the Sess core does. bundle-v1 stays as tested in
// bundles.test.ts. Never print a receipt or key material.
import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { verifyDecisionBundle, type DecisionBundleVerification } from '../../src/receipts/index.js';
import { buildCorpusV2Vectors, corpusEnvelope } from '../fixtures/bundle/corpus-v2-vectors.js';
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

describe('decision bundle verification (bundle-v2)', () => {
  it('rebuilds the shared bundle-v2 corpus byte for byte and reaches every frozen result', async () => {
    expect(CORPUS.issuer).toBe(CORPUS_ISSUER);
    expect(CORPUS.now).toBe(CORPUS_NOW.toISOString());
    const rebuilt = await vectors();
    expect(rebuilt.map((v) => v.id)).toEqual(CORPUS.vectors.map((v) => v.id));
    expect(rebuilt).toHaveLength(21);
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
    }
    expect(network).not.toHaveBeenCalled();
    const reasons = new Set(CORPUS.vectors.map((v) => v.expected.trusted.reason));
    for (const r of [null, 'revision', 'type', 'signature', 'unsupported_version'])
      expect(reasons.has(r), `corpus covers ${r}`).toBe(true);
  });

  it('a valid result carries revision_hash and the verified envelope; a bundle-v1 result does not', async () => {
    const v = await vector('v2-valid-full-context');
    const r = await verifyDecisionBundle(v.bundle, {
      issuer: CORPUS_ISSUER,
      trustedKeys: corpusTrustedKeys(),
      now: CORPUS_NOW,
    });
    expect(r.valid).toBe(true);
    expect(r.receipt?.surface.revision_hash).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(r.receipt?.revision_envelope).toEqual(corpusEnvelope());
    expect(r.receipt?.revision_envelope?.key_label).toBe('Corpus agent');
    const noKey = await verifyDecisionBundle((await vector('v2-valid-no-key')).bundle, {
      issuer: CORPUS_ISSUER,
      trustedKeys: corpusTrustedKeys(),
      now: CORPUS_NOW,
    });
    expect(noKey.receipt?.revision_envelope).toMatchObject({ key_id: null, key_label: null });
    // Refused results never present an envelope or a receipt.
    const missing = await verifyDecisionBundle((await vector('v2-missing-envelope')).bundle, {
      issuer: CORPUS_ISSUER,
      trustedKeys: corpusTrustedKeys(),
      now: CORPUS_NOW,
    });
    expect([missing.valid, missing.reason, missing.receipt]).toEqual([false, 'revision', null]);
  });
});
