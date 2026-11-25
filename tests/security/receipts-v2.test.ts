// Receipt v2 (docs/spec/receipt-v2.md) on the frozen revision envelope, `sess_revision: 2` (frozen
// by the Sess founder on 2026-11-17: ten common members, then exactly one of `titles` or
// `titles_digest`; `revision_hash` over the digest form; no key label). verifyDecisionReceipt
// dispatches on the protected typ: sess-receipt+jwt stays receipt v1 and is verified exactly as
// before (receipts.test.ts); sess-receipt-2+jwt is verified only with the envelope it commits to.
//
// The refusal vectors are those of the Sess security core's reader (packages/security/test/
// receipts-v2.test.ts at the commit recorded in docs/spec/source.json), each signed over by hand
// (revision_hash recomputed independently, as a forger holding the key would) so that the reader's
// own rule, not a digest mismatch, is what refuses it. A receipt newer than this release (a later
// Sess typ or a later sess_revision) is reported with kind `receipt_newer` and code
// `RECEIPT_NEWER`, never as a verification failure, and nothing is returned.
import { createHmac } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SessError } from '../../src/errors.js';
import { decodeAccepted, decodeEvents } from '../../src/internal/decode.js';
import { SDK_VERSION } from '../../src/internal/version.js';
import { createReceiptResource, type VerificationRequestOptions } from '../../src/receipts/resource.js';
import { verifyDecisionReceipt, type ReceiptClaimsV1 } from '../../src/receipts/verify.js';
import type { InteractiveSession } from '../../src/types.js';
import { verifyWebhook } from '../../src/webhooks/index.js';
import {
  compactOf,
  digest,
  ENVELOPE_MEMBERS,
  envelopeOf,
  eventId,
  fixture,
  fixtureV2,
  issuer,
  NONCE,
  now,
  revisionDigest,
  sessionId,
  signClaims,
  titlesDigestOf,
  workspace,
} from './fixtures.js';

const options = { now: new Date(now) };
const REVISION = { kind: 'receipt_verification', code: 'REVISION_ENVELOPE_MISMATCH' };
const NEWER = {
  kind: 'receipt_newer',
  code: 'RECEIPT_NEWER',
  message: `This receipt is newer than @sess.si/sdk ${SDK_VERSION}. Update @sess.si/sdk to check it. No answer data was returned.`,
};
const GRANT = 'sgr_01JABCDEFGHJKMNPQRSTVWXYZ5';
const ASK = 'ask_01JABCDEFGHJKMNPQRSTVWXYZ6';
const OTHER_NONCE = Buffer.alloc(16, 0x5b).toString('base64url');

/**
 * Titles the shared title rule (Sess P2-27) refuses: bidirectional controls, zero-width and other
 * default-ignorable or format characters, alone or inside, and titles with no visible character.
 * The Sess core's own refusal list, verbatim.
 */
const TITLE_REFUSALS = [
  'A‮B',
  '‮Example bakery',
  '⁦Example⁩',
  'Example‎bakery',
  '​',
  'Example​bakery',
  'Example­bakery',
  'Example͏bakery',
  'Example\u{E0041}',
  '⁠',
  'ㅤ',
  '⠀',
  '́',
  'ㅤㅤ',
];
/** Titles the rule keeps exactly (joiners, an emoji presentation selector, Persian with ZWNJ). */
const TITLE_ALLOWED = [
  'Pride \u{1F3F3}\u{FE0F}‍\u{1F308}',
  'می‌خواهم',
  'I ❤\u{FE0F} bikes',
  'Ada’s workshop',
  '\u{1F600}'.repeat(60),
];

beforeEach(() => vi.useFakeTimers({ now }));
afterEach(() => vi.useRealTimers());

/** The fixture's receipt v2, signed over exactly `envelope` (its revision_hash by hand). */
const signedOver = (envelope: object) => fixtureV2(undefined, { envelope, committed: envelope });

/** An inbox child's envelope: every optional member set (grant, address, Ask, three titles). */
const inboxChild = () =>
  envelopeOf(fixture(), {
    grant_id: GRANT,
    ask_id: ASK,
    titles: {
      nonce: NONCE,
      grant_title: 'Example bakery',
      target_title: 'Example bike shop',
      owner_name: null,
    },
  });

async function outcomeOf(p: Promise<unknown>): Promise<unknown> {
  return p.then(
    () => 'returned',
    (error: unknown) => error,
  );
}

describe('receipt v2: verifyDecisionReceipt with the frozen revision envelope', () => {
  it('verifies a receipt v2 with its full-form envelope and returns its claims; revision_hash is over the digest form', async () => {
    const f = fixtureV2();
    const claims = await verifyDecisionReceipt(f.input, options);
    expect(claims).toEqual(f.claims);
    expect(claims.sess_receipt).toBe(2);
    expect(Object.isFrozen(claims.surface)).toBe(true);
    // revision_hash is the digest of the compact form, written out by hand, not of the full form.
    const compactText = `{"agent_target":{"id":"tgt_01JABCDEFGHJKMNPQRSTVWXYZ4","name":"bike-shop","version":3},"ask_id":null,"grant_id":null,"key_id":"key_01JABCDEFGHJKMNPQRSTVWXYZ2","published_at":"2026-10-12T17:50:00.123Z","renderer_version":"${f.envelope.renderer_version}","revision":1,"sess_revision":2,"session_id":"${sessionId}","surface_hash":"${f.envelope.surface_hash}","titles_digest":"${titlesDigestOf(f.envelope.titles)}"}`;
    const committed = (claims.surface as { revision_hash?: string }).revision_hash;
    expect(committed).toBe(digest(JSON.parse(compactText)));
    expect(committed).not.toBe(digest(f.envelope));
    expect(titlesDigestOf(f.envelope.titles)).toHaveLength(43);
  });

  it('verifies with either form: the compact form as given gives the same result as the full form', async () => {
    for (const envelope of [envelopeOf(fixture()), inboxChild()]) {
      const f = signedOver(envelope);
      const full = await verifyDecisionReceipt(f.input, options);
      const compact = await verifyDecisionReceipt(
        { ...f.input, revisionEnvelope: JSON.parse(JSON.stringify(compactOf(envelope))) },
        options,
      );
      expect(compact).toEqual(full);
    }
  });

  it('accepts every applicable optional member: no key, an address start, an Ask respondent, an inbox child, an owner name', async () => {
    const base = fixture();
    for (const over of [
      { key_id: null },
      {
        agent_target: null,
        titles: { nonce: NONCE, grant_title: null, target_title: null, owner_name: null },
      },
      {
        agent_target: null,
        ask_id: ASK,
        titles: { nonce: NONCE, grant_title: null, target_title: null, owner_name: 'Ada’s workshop' },
      },
      {
        grant_id: GRANT,
        ask_id: ASK,
        titles: {
          nonce: NONCE,
          grant_title: 'Example bakery',
          target_title: 'Example bike shop',
          owner_name: null,
        },
      },
    ]) {
      const f = signedOver(envelopeOf(base, over));
      await expect(verifyDecisionReceipt(f.input, options), JSON.stringify(over)).resolves.toMatchObject({
        sess_receipt: 2,
      });
    }
    for (const title of TITLE_ALLOWED) {
      const titles = { nonce: NONCE, grant_title: null, target_title: title, owner_name: null };
      const f = signedOver(envelopeOf(base, { titles }));
      await expect(verifyDecisionReceipt(f.input, options), JSON.stringify(title)).resolves.toMatchObject({
        sess_receipt: 2,
      });
    }
  });

  it('refuses a receipt v2 whose envelope is missing or null', async () => {
    const f = fixtureV2();
    const { revisionEnvelope: _, ...missing } = f.input;
    await expect(verifyDecisionReceipt(missing, options)).rejects.toMatchObject(REVISION);
    await expect(
      verifyDecisionReceipt({ ...f.input, revisionEnvelope: null }, options),
    ).rejects.toMatchObject(REVISION);
  });

  it('refuses every envelope outside the frozen member set, even one the receipt commits to', async () => {
    const e = inboxChild();
    const compact = compactOf(e);
    const { titles: _t, ...neither } = e;
    const at = (agent: Record<string, unknown>) => ({ ...e, agent_target: { ...e.agent_target, ...agent } });
    const titled = (titles: Record<string, unknown>) => ({ ...e, titles: { ...e.titles, ...titles } });
    const nineMember = {
      sess_revision: 1,
      session_id: e.session_id,
      revision: e.revision,
      surface_hash: e.surface_hash,
      renderer_version: e.renderer_version,
      published_at: e.published_at,
      key_id: e.key_id,
      key_label: 'Production agent',
      grant_id: null,
    };
    const twelveMember = {
      ...neither,
      agent_target: { ...e.agent_target, title: 'Example bike shop' },
      grant_title: 'Example bakery',
      owner_name: null,
    };
    const refusals: Array<[string, unknown]> = [
      ['both forms', { ...e, titles_digest: compact.titles_digest }],
      ['neither form', neither],
      ['the withdrawn nine-member sess_revision 1', nineMember],
      ['the withdrawn twelve-member top-level titles', twelveMember],
      ['a title on agent_target', at({ title: 'Example bike shop' })],
      ['sess_revision 1 on the frozen shape', { ...e, sess_revision: 1 }],
      ['sess_revision as a string', { ...e, sess_revision: '3' }],
      ['a key label', { ...e, key_label: 'Production agent' }],
      ['a null key label', { ...e, key_label: null }],
      ['a key label under titles', titled({ key_label: 'Production agent' })],
      ['an extra member', { ...e, extra: 1 }],
      ['an extra title member', titled({ extra: null })],
      ['an extra agent_target member', at({ extra: 1 })],
      [
        'a missing title member',
        { ...e, titles: { nonce: NONCE, grant_title: 'Example bakery', target_title: 'Example bike shop' } },
      ],
      ['a malformed titles_digest', { ...compact, titles_digest: 'x' }],
      ['a long titles_digest', { ...compact, titles_digest: `${compact.titles_digest as string}A` }],
      ['titles as an array', { ...e, titles: [e.titles] }],
      ['microsecond precision', { ...e, published_at: '2026-10-12T17:50:00.123000Z' }],
      ['second precision', { ...e, published_at: '2026-10-12T17:50:00Z' }],
      ['an offset', { ...e, published_at: '2026-10-12T17:50:00.123+00:00' }],
      ['an impossible date', { ...e, published_at: '2026-02-30T17:50:00.123Z' }],
      ['an empty key ID', { ...e, key_id: '' }],
      ['a key ID of another kind', { ...e, key_id: 'tgr_01JABCDEFGHJKMNPQRSTVWXYZ2' }],
      ['a credential as key ID', { ...e, key_id: `sess_sk_${'A'.repeat(43)}` }],
      ['a human-link token as key ID', { ...e, key_id: 'A'.repeat(22) }],
      ['a grant ID of another kind', { ...e, grant_id: 'tgr_01JABCDEFGHJKMNPQRSTVWXYZ5' }],
      ['a grant title without a grant', { ...e, grant_id: null }],
      ['a grant without its title', titled({ grant_title: null })],
      ['a Target title without a Target', { ...e, agent_target: null }],
      ['an Ask ID of another kind', { ...e, ask_id: 'ses_01JABCDEFGHJKMNPQRSTVWXYZ6' }],
      ['a Target version of 0', at({ version: 0 })],
      ['a Target version of 1.5', at({ version: 1.5 })],
      ['a Target version as a string', at({ version: '3' })],
      ['a Target ID of another kind', at({ id: 'ses_01JABCDEFGHJKMNPQRSTVWXYZ4' })],
      ...['Bike-Shop', 'ab', 'a'.repeat(41), 'bike_shop', '-bike'].map((name): [string, unknown] => [
        `the address ${name}`,
        at({ name }),
      ]),
      ['a revision of 0', { ...e, revision: 0 }],
      ['a short surface hash', { ...e, surface_hash: 'sha256:00' }],
      ...['', NONCE.slice(1), `${NONCE}A`, `${NONCE.slice(0, 21)}B`].map((nonce): [string, unknown] => [
        `the nonce ${JSON.stringify(nonce)}`,
        titled({ nonce }),
      ]),
      ['a title over 60 code points', titled({ owner_name: `${'\u{1F600}'.repeat(60)}x` })],
      ['an empty title', titled({ owner_name: '' })],
      ['an untrimmed title', titled({ owner_name: ' padded' })],
      ['a title over two lines', titled({ owner_name: 'line\nbreak' })],
      ...ENVELOPE_MEMBERS.map((name): [string, unknown] => {
        const { [name]: _, ...missing } = e as unknown as Record<string, unknown>;
        return [`no ${name}`, missing];
      }),
    ];
    for (const [label, envelope] of refusals) {
      const f = signedOver(envelope as object);
      await expect(verifyDecisionReceipt(f.input, options), label).rejects.toMatchObject(REVISION);
    }
    for (const [label, envelope] of [
      ['an array', [e]],
      ['a string', JSON.stringify(e)],
    ] as const)
      await expect(
        verifyDecisionReceipt({ ...fixtureV2().input, revisionEnvelope: envelope as never }, options),
        label,
      ).rejects.toMatchObject(REVISION);
  });

  it('refuses every title the shared title rule refuses, in each of the three title slots, even under a valid signature', async () => {
    const base = fixture();
    for (const bad of TITLE_REFUSALS) {
      for (const slot of ['grant_title', 'target_title', 'owner_name'] as const) {
        const titles = {
          nonce: NONCE,
          grant_title: 'Example bakery',
          target_title: 'Example bike shop',
          owner_name: null,
          [slot]: bad,
        };
        const f = signedOver(envelopeOf(base, { grant_id: GRANT, titles }));
        await expect(
          verifyDecisionReceipt(f.input, options),
          `${slot} ${JSON.stringify(bad)}`,
        ).rejects.toMatchObject(REVISION);
      }
    }
  });

  it('refuses an envelope of another digest: another key, title, nonce, time, Ask, Target version or digest', async () => {
    const f = signedOver(inboxChild());
    const e = f.envelope;
    for (const altered of [
      { ...e, key_id: 'key_01JABCDEFGHJKMNPQRSTVWXYZ9' },
      { ...e, key_id: null },
      { ...e, published_at: '2026-10-12T17:50:00.124Z' },
      { ...e, ask_id: null },
      { ...e, titles: { ...e.titles, grant_title: 'Someone else' } },
      { ...e, titles: { ...e.titles, target_title: 'Renamed later' } },
      { ...e, titles: { ...e.titles, nonce: OTHER_NONCE } },
      { ...e, agent_target: { ...e.agent_target, version: 4 } },
      { ...compactOf(e), titles_digest: titlesDigestOf({ ...e.titles, target_title: 'Other' }) },
    ]) {
      await expect(
        verifyDecisionReceipt({ ...f.input, revisionEnvelope: altered as never }, options),
        JSON.stringify(altered),
      ).rejects.toMatchObject(REVISION);
    }
  });

  it('refuses a committed envelope that names another Session, revision, Surface or renderer', async () => {
    const base = fixture();
    for (const over of [
      { session_id: 'ses_01JABCDEFGHJKMNPQRSTVWXYZ8' },
      { revision: 2 },
      { surface_hash: `sha256:${'0'.repeat(64)}` },
      { renderer_version: 'sess-html-form-2' },
    ]) {
      const g = signedOver(envelopeOf(base, over));
      await expect(verifyDecisionReceipt(g.input, options), JSON.stringify(over)).rejects.toMatchObject(
        REVISION,
      );
    }
  });

  it('runs the issuer, audience, expiry and signature checks first', async () => {
    const f = fixtureV2();
    const { revisionEnvelope: _, ...missing } = f.input;
    await expect(
      verifyDecisionReceipt({ ...missing, issuer: 'https://wrong.example' }, options),
    ).rejects.toMatchObject({ code: 'ISSUER_MISMATCH' });
    await expect(verifyDecisionReceipt({ ...missing, audience: 'wks_other' }, options)).rejects.toMatchObject(
      {
        code: 'AUDIENCE_MISMATCH',
      },
    );
    await expect(
      verifyDecisionReceipt(missing, { now: new Date(now + 2 * 3600 * 1000) }),
    ).rejects.toMatchObject({
      code: 'RECEIPT_EXPIRED',
    });
    const [h, p, s] = f.input.receipt!.split('.') as [string, string, string];
    const sig = Buffer.from(s, 'base64url');
    sig[0] = (sig[0] as number) ^ 1;
    await expect(
      verifyDecisionReceipt({ ...missing, receipt: `${h}.${p}.${sig.toString('base64url')}` }, options),
    ).rejects.toMatchObject({ code: 'INVALID_SIGNATURE' });
  });

  it('keeps the typ and the format version together: neither version passes as the other; a non-Sess typ is unsupported', async () => {
    const v1 = fixture();
    const v2 = fixtureV2();
    const v1AsV2 = signClaims(v1.claims, { alg: 'EdDSA', kid: 'rfc8032-test-1', typ: 'sess-receipt-2+jwt' });
    const v2AsV1 = signClaims(v2.claims);
    await expect(verifyDecisionReceipt({ ...v2.input, receipt: v1AsV2 }, options)).rejects.toMatchObject({
      code: 'UNSUPPORTED_RECEIPT_VERSION',
    });
    await expect(verifyDecisionReceipt({ ...v2.input, receipt: v2AsV1 }, options)).rejects.toMatchObject({
      code: 'UNSUPPORTED_RECEIPT_VERSION',
    });
    const noHash = signClaims({ ...(v1.claims as ReceiptClaimsV1), sess_receipt: 2 } as never, {
      alg: 'EdDSA',
      kid: 'rfc8032-test-1',
      typ: 'sess-receipt-2+jwt',
    });
    await expect(verifyDecisionReceipt({ ...v2.input, receipt: noHash }, options)).rejects.toMatchObject({
      code: 'INVALID_CLAIMS',
    });
    for (const typ of ['JWT', 'sess-receipt', 'Sess-Receipt-3+jwt', 'sess_receipt+jwt']) {
      const receipt = signClaims(v2.claims, { alg: 'EdDSA', kid: 'rfc8032-test-1', typ });
      await expect(verifyDecisionReceipt({ ...v2.input, receipt }, options), typ).rejects.toMatchObject({
        kind: 'receipt_verification',
        code: 'UNSUPPORTED_TYPE',
      });
    }
  });

  it('a receipt v2 action label is at most 24 code points (INVALID_CLAIMS beyond); receipt v1 keeps its bound', async () => {
    const f = fixtureV2();
    const signedWithLabel = (label: string, typ: string, claims: object) =>
      signClaims({ ...claims, action: { ...(claims as typeof f.claims).action, label } } as never, {
        alg: 'EdDSA',
        kid: 'rfc8032-test-1',
        typ,
      });
    // The claims check comes before the record checks: a label beyond the bound is INVALID_CLAIMS;
    // one within it passes the claims check and is then refused only as another action.
    const at25 = signedWithLabel('W'.repeat(25), 'sess-receipt-2+jwt', f.claims);
    await expect(verifyDecisionReceipt({ ...f.input, receipt: at25 }, options)).rejects.toMatchObject({
      code: 'INVALID_CLAIMS',
    });
    const at24 = signedWithLabel('\u{1F600}'.repeat(24), 'sess-receipt-2+jwt', f.claims);
    await expect(verifyDecisionReceipt({ ...f.input, receipt: at24 }, options)).rejects.toMatchObject({
      code: 'ACTION_BINDING_MISMATCH',
    });
    const v1 = fixture();
    const long1 = signedWithLabel('W'.repeat(200), 'sess-receipt+jwt', v1.claims);
    await expect(verifyDecisionReceipt({ ...v1.input, receipt: long1 }, options)).rejects.toMatchObject({
      code: 'ACTION_BINDING_MISMATCH',
    });
  });

  it('verifies a receipt v1 exactly as before and never reads an envelope for it', async () => {
    const f = fixture();
    expect(await verifyDecisionReceipt(f.input, options)).toEqual(f.claims);
    expect(await verifyDecisionReceipt({ ...f.input, revisionEnvelope: null }, options)).toEqual(f.claims);
    for (const garbage of [{ anything: 'at all' }, { sess_revision: 9 }])
      expect(
        await verifyDecisionReceipt({ ...f.input, revisionEnvelope: garbage as never }, options),
      ).toEqual(f.claims);
  });
});

describe('receipt v2: a newer receipt is reported as newer and releases nothing (RECEIPT_NEWER)', () => {
  it('an envelope of a later sess_revision, informational or constraining, committed or not', async () => {
    const e = envelopeOf(fixture());
    for (const later of [
      { ...e, sess_revision: 3 },
      { ...e, sess_revision: 3, audience: 'constraining' },
      { sess_revision: 4 },
    ]) {
      // Signed over exactly that envelope, and beside a receipt committing to another one.
      for (const input of [
        signedOver(later).input,
        { ...fixtureV2().input, revisionEnvelope: later as never },
      ]) {
        const outcome = await outcomeOf(verifyDecisionReceipt(input, options));
        expect(outcome, JSON.stringify(later)).toBeInstanceOf(SessError);
        expect(outcome).toMatchObject(NEWER);
        expect((outcome as SessError).kind).not.toBe('receipt_verification');
      }
    }
  });

  it('a later Sess receipt typ, before any other check of the receipt: its key may be one this release lacks', async () => {
    const f = fixtureV2();
    for (const typ of ['sess-receipt-3+jwt', 'sess-closing-receipt+jwt']) {
      for (const kid of ['rfc8032-test-1', 'later-key']) {
        const receipt = signClaims(f.claims, { alg: 'EdDSA', kid, typ });
        await expect(
          verifyDecisionReceipt({ ...f.input, receipt }, options),
          `${typ} ${kid}`,
        ).rejects.toMatchObject(NEWER);
      }
      // Header members this release does not know are the later format's own.
      const extended = signClaims(f.claims, { alg: 'EdDSA', kid: 'later-key', typ, crit: ['x'], x: 1 });
      await expect(verifyDecisionReceipt({ ...f.input, receipt: extended }, options)).rejects.toMatchObject(
        NEWER,
      );
    }
  });

  it('receipts.verifyResponse refuses a newer receipt or envelope with RECEIPT_NEWER and returns nothing', async () => {
    const later = { ...envelopeOf(fixture()), sess_revision: 3 };
    const newerEnvelope = signedOver(later);
    await expect(
      resourceFor(newerEnvelope.session, newerEnvelope.surface, newerEnvelope.keys).verifyResponse({
        sessionId,
        response: newerEnvelope.response,
      }),
    ).rejects.toMatchObject(NEWER);
    const f = fixtureV2();
    const receipt = signClaims(f.claims, { alg: 'EdDSA', kid: 'rfc8032-test-1', typ: 'sess-receipt-3+jwt' });
    const response = { ...f.response, receipt };
    const session = { ...f.session, responses: [response] };
    await expect(
      resourceFor(session, f.surface, f.keys).verifyResponse({ sessionId, response }),
    ).rejects.toMatchObject(NEWER);
  });
});

function resourceFor(session: InteractiveSession, surface: unknown, keys: unknown) {
  return createReceiptResource({
    receiptIssuer: issuer,
    operationTimeoutMs: 1000,
    baseUrl: 'https://api.sess.example',
    retrieveSession: async (_id: string, _options: VerificationRequestOptions) => ({
      data: structuredClone(session),
      meta: { status: 200, attempts: 1, etag: '"current-1"', workspaceId: workspace },
    }),
    retrieveSurface: async () => ({
      data: structuredClone(surface) as never,
      meta: { status: 200, attempts: 1 },
    }),
    publicGet: async () => ({ data: structuredClone(keys), meta: { status: 200, attempts: 1 } }),
  });
}

describe('receipt v2: receipts.verifyResponse (contract cases)', () => {
  it('v1: a response without revision_envelope verifies as before', async () => {
    const f = fixture();
    const verified = await resourceFor(f.session, f.surface, f.keys).verifyResponse({
      sessionId,
      response: f.response,
    });
    expect(verified.claims.sess_receipt).toBe(1);
    expect('revision_envelope' in verified.response).toBe(false);
  });

  it('v2: a response with its revision_envelope verifies, and the envelope is returned', async () => {
    const f = fixtureV2();
    const verified = await resourceFor(f.session, f.surface, f.keys).verifyResponse({
      sessionId,
      response: f.response,
    });
    expect(verified.claims.sess_receipt).toBe(2);
    expect(verified.response.revision_envelope).toEqual(f.envelope);
    expect(Object.isFrozen(verified.response.revision_envelope)).toBe(true);
    expect(JSON.stringify(verified)).not.toContain('key_label');
  });

  it('v2: an unsigned member beside the receipt that this release does not know is ignored', async () => {
    const f = fixtureV2();
    const response = { ...f.response, later_member: { anything: true } } as typeof f.response;
    const session = { ...f.session, responses: [response] };
    const verified = await resourceFor(session, f.surface, f.keys).verifyResponse({ sessionId, response });
    expect(verified.claims).toEqual(f.claims);
  });

  it('v2: a response missing its revision_envelope is refused with the revision code', async () => {
    const f = fixtureV2();
    const { revision_envelope: _, ...bare } = f.response;
    const session = { ...f.session, responses: [bare] };
    await expect(
      resourceFor(session, f.surface, f.keys).verifyResponse({ sessionId, response: bare }),
    ).rejects.toMatchObject(REVISION);
  });

  it('v2: an envelope other than the authorized record’s is refused before the receipt is read', async () => {
    const f = fixtureV2();
    const other = {
      ...f.response,
      revision_envelope: { ...f.envelope, titles: { ...f.envelope.titles, target_title: 'Renamed later' } },
    };
    await expect(
      resourceFor(f.session, f.surface, f.keys).verifyResponse({ sessionId, response: other }),
    ).rejects.toMatchObject({ code: 'RECORD_BINDING_MISMATCH' });
    // The authorized record itself carrying another envelope: the receipt refuses it.
    const session = { ...f.session, responses: [other] };
    await expect(
      resourceFor(session, f.surface, f.keys).verifyResponse({ sessionId, response: other }),
    ).rejects.toMatchObject(REVISION);
  });
});

describe('receipt v2: decoders keep revision_envelope beside the receipt', () => {
  it('AcceptedResponse: kept when present, absent on v1, refused when not an object', () => {
    const v1 = fixture().response;
    const v2 = fixtureV2().response;
    expect(decodeAccepted(structuredClone(v1))).toEqual(v1);
    expect(decodeAccepted(structuredClone(v2))).toEqual(v2);
    for (const bad of [null, 'envelope', [v2.revision_envelope]]) {
      expect(() => decodeAccepted({ ...v2, revision_envelope: bad })).toThrow(
        expect.objectContaining({ code: 'INVALID_RESPONSE' }),
      );
    }
    expect(() => decodeAccepted({ ...v2, receipt: null })).toThrow(
      expect.objectContaining({ code: 'INVALID_RESPONSE' }),
    );
  });

  it('SessionEvents: response.accepted carries it, other Event types never do', () => {
    const v2 = fixtureV2();
    const accepted = {
      event_id: eventId,
      sequence: 2,
      type: 'response.accepted',
      revision: 1,
      actor: { assurance: 'link_holder' },
      action_id: 'submit',
      data: v2.response.data,
      created_at: v2.response.accepted_at,
      receipt: v2.response.receipt,
      revision_envelope: v2.envelope,
    };
    const published = {
      event_id: 'evt_01JABCDEFGHJKMNPQRSTVWXYZ0',
      sequence: 1,
      type: 'revision.published',
      revision: 1,
      actor: { assurance: 'owner' },
      created_at: v2.response.accepted_at,
    };
    const events = { id: sessionId, events: [published, accepted] };
    const decoded = decodeEvents(structuredClone(events), sessionId);
    expect(decoded.events[1]?.revision_envelope).toEqual(v2.envelope);
    const { revision_envelope: _, ...v1Accepted } = accepted;
    expect(decodeEvents({ id: sessionId, events: [published, v1Accepted] }, sessionId).events[1]).toEqual(
      v1Accepted,
    );
    expect(() =>
      decodeEvents(
        { id: sessionId, events: [{ ...published, revision_envelope: v2.envelope }, accepted] },
        sessionId,
      ),
    ).toThrow(expect.objectContaining({ code: 'INVALID_RESPONSE' }));
  });
});

describe('receipt v2: the response.accepted webhook message', () => {
  const secret = `whsec_${Buffer.alloc(32, 7).toString('base64')}`;
  const headers = (raw: string) => {
    const timestamp = Math.floor(now / 1000);
    const hmac = createHmac('sha256', Buffer.from(secret.slice(6), 'base64'));
    hmac.update(`${eventId}.${timestamp}.`);
    hmac.update(raw);
    return {
      'webhook-id': eventId,
      'webhook-timestamp': String(timestamp),
      'webhook-signature': `v1,${hmac.digest('base64')}`,
    };
  };
  const message = (response: { data: unknown; accepted_at: string; receipt: string | null }) => ({
    type: 'response.accepted',
    event_id: eventId,
    session_id: sessionId,
    sequence: 1,
    revision: 1,
    action_id: 'submit',
    data: response.data,
    accepted_at: response.accepted_at,
    receipt: response.receipt,
  });

  it('carries revision_envelope for a receipt v2 only, and its receipt verifies with it', async () => {
    const v2 = fixtureV2();
    const withEnvelope = { ...message(v2.response), revision_envelope: v2.envelope };
    const raw = JSON.stringify(withEnvelope);
    const verified = verifyWebhook(raw, headers(raw), { secret });
    expect(verified).toEqual(withEnvelope);
    if (verified.type !== 'response.accepted') throw new Error('expected an accepted event');
    await expect(
      verifyDecisionReceipt(
        { ...v2.input, receipt: verified.receipt, revisionEnvelope: verified.revision_envelope },
        options,
      ),
    ).resolves.toMatchObject({ sess_receipt: 2 });
    // A v1 message keeps exactly its members.
    const v1Raw = JSON.stringify(message(fixture().response));
    expect(verifyWebhook(v1Raw, headers(v1Raw), { secret })).toEqual(JSON.parse(v1Raw));
    // A v2 message delivered without its envelope authenticates, but its receipt is refused.
    const bareRaw = JSON.stringify(message(v2.response));
    const bare = verifyWebhook(bareRaw, headers(bareRaw), { secret });
    if (bare.type !== 'response.accepted') throw new Error('expected an accepted event');
    await expect(
      verifyDecisionReceipt(
        { ...v2.input, receipt: bare.receipt, revisionEnvelope: bare.revision_envelope },
        options,
      ),
    ).rejects.toMatchObject(REVISION);
  });

  it('refuses an envelope that is not an object, or beside no receipt', () => {
    const v2 = fixtureV2();
    for (const [label, body] of [
      ['null', { ...message(v2.response), revision_envelope: null }],
      ['a string', { ...message(v2.response), revision_envelope: 'envelope' }],
      ['no receipt', { ...message({ ...v2.response, receipt: null }), revision_envelope: v2.envelope }],
    ] as const) {
      const raw = JSON.stringify(body);
      expect(() => verifyWebhook(raw, headers(raw), { secret }), label).toThrow(
        expect.objectContaining({ code: 'WEBHOOK_INVALID_PAYLOAD' }),
      );
    }
  });
});

describe('receipt v2: the test’s own revision_hash', () => {
  it('is the digest of the compact form, from either form', () => {
    const e = envelopeOf(fixture());
    expect(revisionDigest(e)).toBe(digest(compactOf(e)));
    expect(revisionDigest(compactOf(e))).toBe(revisionDigest(e));
  });
});
