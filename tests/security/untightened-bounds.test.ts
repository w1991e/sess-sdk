// The bounds Sess's tighter Surface text limits (title 60, description 200, heading 40, label 40,
// help 120, option 30, record key 24, button 16, items row name 30) leave alone, each named here so
// a tidy-up cannot tighten it. Receipts already issued under the old limits verify forever: only
// inputs are checked, never a stored Surface or a signed receipt.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { compileAsk } from '../../src/ask.js';
import { RECEIPT_V2_ACTION_LABEL_MAX } from '../../src/receipts/json.js';
import { SHARED_TITLE_MAX, isStoredSharedTitle } from '../../src/receipts/shared-title.js';
import { verifyDecisionReceipt } from '../../src/receipts/verify.js';
import { digest, envelopeOf, fixture, now, revisionDigest, signClaims } from './fixtures.js';

const options = { now: new Date(now) };

beforeEach(() => vi.useFakeTimers({ now }));
afterEach(() => vi.useRealTimers());

/**
 * A receipt v2 over a stored Surface written under the old limits (title 80, description 280),
 * with `label` on its one action, signed by hand over that exact Surface and its envelope.
 */
function issuedUnderOldLimits(label: string) {
  const f = fixture();
  const interaction = {
    ...f.input.interaction,
    title: '🦉'.repeat(80),
    description: 'd'.repeat(280),
    actions: [{ id: 'submit', label, intent: 'submit' }],
  } as typeof f.input.interaction;
  const v1 = {
    ...f.claims,
    surface: { ...f.claims.surface, hash: digest(interaction) },
    action: { ...f.claims.action, label },
  } as typeof f.claims;
  const envelope = envelopeOf({ ...f, claims: v1 });
  const claims = {
    ...v1,
    sess_receipt: 2,
    surface: { ...v1.surface, revision_hash: revisionDigest(envelope) },
  };
  const receipt = signClaims(claims as never, {
    alg: 'EdDSA',
    kid: 'rfc8032-test-1',
    typ: 'sess-receipt-2+jwt',
  });
  return { ...f.input, interaction, receipt, revisionEnvelope: envelope };
}

describe('bounds the tighter text limits leave alone', () => {
  it('the receipt v2 verifier keeps action.label at most 24: labels of 17–24 issued under the old button limit verify', async () => {
    expect(RECEIPT_V2_ACTION_LABEL_MAX).toBe(24);
    for (const label of ['Send for approval', 'Approve and send invoice', '😀'.repeat(24)]) {
      expect([...label].length).toBeGreaterThan(16);
      expect([...label].length).toBeLessThanOrEqual(24);
      expect(await verifyDecisionReceipt(issuedUnderOldLimits(label), options)).toMatchObject({
        sess_receipt: 2,
        action: { label },
      });
    }
    // The verifier's own bound is unchanged too: 25 is refused as before.
    await expect(verifyDecisionReceipt(issuedUnderOldLimits('W'.repeat(25)), options)).rejects.toMatchObject({
      code: 'INVALID_CLAIMS',
    });
  });

  it('the shared title rule (receipt v2 envelope titles) keeps SHARED_TITLE_MAX 60', () => {
    expect(SHARED_TITLE_MAX).toBe(60);
    expect(isStoredSharedTitle('🦉'.repeat(60))).toBe(true);
    expect(isStoredSharedTitle('🦉'.repeat(61))).toBe(false);
  });

  it('Sess’s "Your name" respondent field keeps maxLength 80 (its own bound, not the field label limit)', () => {
    const compiled = compileAsk({
      question: 'End of class check',
      fields: [{ name: 'understood', label: 'Did it make sense?', type: 'boolean' }],
      respondents: { max: 3, name: true },
    });
    expect(compiled.respondents!.surface.source.components[0]).toEqual({
      type: 'field',
      name: 'name',
      label: 'Your name',
      required: true,
      schema: { type: 'string', minLength: 1, maxLength: 80 },
    });
  });
});
