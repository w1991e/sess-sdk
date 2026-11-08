// Receipt v2 (docs/spec/receipt-v2.md): verifyDecisionReceipt dispatches on the protected typ.
// sess-receipt+jwt stays receipt v1 and is verified exactly as before (the v1 tests and vectors in
// receipts.test.ts are untouched); sess-receipt-2+jwt is verified only with the revision envelope
// it commits to, and is refused with REVISION_ENVELOPE_MISMATCH without it or with any other.
// The resource, decoder and webhook cases are the SDK's contract cases: v1 without the envelope,
// v2 with it, v2 missing it refused.
import { createHmac } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { decodeAccepted, decodeEvents } from '../../src/internal/decode.js';
import { createReceiptResource, type VerificationRequestOptions } from '../../src/receipts/resource.js';
import { verifyDecisionReceipt, type ReceiptClaimsV1 } from '../../src/receipts/verify.js';
import type { InteractiveSession } from '../../src/types.js';
import { verifyWebhook } from '../../src/webhooks/index.js';
import {
  digest,
  envelopeOf,
  eventId,
  fixture,
  fixtureV2,
  issuer,
  now,
  sessionId,
  signClaims,
  workspace,
} from './fixtures.js';

const options = { now: new Date(now) };
const REVISION = { kind: 'receipt_verification', code: 'REVISION_ENVELOPE_MISMATCH' };

beforeEach(() => vi.useFakeTimers({ now }));
afterEach(() => vi.useRealTimers());

describe('receipt v2: verifyDecisionReceipt with the revision envelope', () => {
  it('verifies a receipt v2 with its envelope and returns its claims, revision_hash included', async () => {
    const f = fixtureV2();
    const claims = await verifyDecisionReceipt(f.input, options);
    expect(claims).toEqual(f.claims);
    expect(claims.sess_receipt).toBe(2);
    expect(claims.surface).toEqual({ ...fixture().claims.surface, revision_hash: digest(f.envelope) });
    expect(Object.isFrozen(claims.surface)).toBe(true);
    // An envelope naming no API key (another publisher) verifies when it is the committed one.
    const anonymous = fixtureV2(undefined, {
      envelope: envelopeOf(fixture(), { key_id: null, key_label: null }),
    });
    await expect(verifyDecisionReceipt(anonymous.input, options)).resolves.toMatchObject({ sess_receipt: 2 });
    // An empty label and a named grant are accepted members.
    for (const over of [{ key_label: '' }, { grant_id: 'grt_01JABCDEFGHJKMNPQRSTVWXYZ3' }]) {
      const g = fixtureV2(undefined, { envelope: envelopeOf(fixture(), over) });
      await expect(verifyDecisionReceipt(g.input, options)).resolves.toMatchObject({ sess_receipt: 2 });
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

  it('refuses a malformed envelope', async () => {
    const f = fixtureV2();
    const malformed: Array<[string, unknown]> = [
      ['an extra member', { ...f.envelope, publisher: 'someone' }],
      ['a missing member', (({ grant_id: _, ...rest }) => rest)(f.envelope)],
      ['another schema version', { ...f.envelope, sess_revision: 2 }],
      ['microsecond precision', { ...f.envelope, published_at: '2026-10-12T17:50:00.123000Z' }],
      ['second precision', { ...f.envelope, published_at: '2026-10-12T17:50:00Z' }],
      ['an offset', { ...f.envelope, published_at: '2026-10-12T17:50:00.123+00:00' }],
      ['an impossible date', { ...f.envelope, published_at: '2026-02-30T17:50:00.123Z' }],
      ['a label without a key', { ...f.envelope, key_id: null }],
      ['a key without a label', { ...f.envelope, key_label: null }],
      ['a label over 64 characters', { ...f.envelope, key_label: 'x'.repeat(65) }],
      ['a credential as key ID', { ...f.envelope, key_id: `sess_sk_${'A'.repeat(43)}` }],
      ['a human-link token as key ID', { ...f.envelope, key_id: 'A'.repeat(22) }],
      ['a revision of 0', { ...f.envelope, revision: 0 }],
      ['a short surface hash', { ...f.envelope, surface_hash: 'sha256:00' }],
      ['an array', [f.envelope]],
      ['a string', JSON.stringify(f.envelope)],
    ];
    for (const [label, envelope] of malformed) {
      await expect(
        verifyDecisionReceipt({ ...f.input, revisionEnvelope: envelope as never }, options),
        label,
      ).rejects.toMatchObject(REVISION);
    }
  });

  it('refuses an envelope of another digest: another key, label, time or grant', async () => {
    const f = fixtureV2();
    for (const over of [
      { key_id: 'key_01JABCDEFGHJKMNPQRSTVWXYZ9' },
      { key_label: 'Renamed later' },
      { key_id: null, key_label: null },
      { published_at: '2026-10-12T17:50:00.124Z' },
      { grant_id: 'grt_01JABCDEFGHJKMNPQRSTVWXYZ3' },
    ]) {
      await expect(
        verifyDecisionReceipt({ ...f.input, revisionEnvelope: { ...f.envelope, ...over } as never }, options),
        JSON.stringify(over),
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
      // The receipt's revision_hash is this envelope's own digest, so only the members differ.
      const g = fixtureV2(undefined, { envelope: envelopeOf(base, over) });
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
    ).rejects.toMatchObject({ code: 'RECEIPT_EXPIRED' });
    const [h, p, s] = f.input.receipt!.split('.') as [string, string, string];
    const sig = Buffer.from(s, 'base64url');
    sig[0] = (sig[0] as number) ^ 1;
    await expect(
      verifyDecisionReceipt({ ...missing, receipt: `${h}.${p}.${sig.toString('base64url')}` }, options),
    ).rejects.toMatchObject({ code: 'INVALID_SIGNATURE' });
  });

  it('keeps the typ and the format version together: neither version passes as the other', async () => {
    const v1 = fixture();
    const v2 = fixtureV2();
    // Receipt v1 claims under the v2 typ, and v2 claims under the v1 typ.
    const v1AsV2 = signClaims(v1.claims, { alg: 'EdDSA', kid: 'rfc8032-test-1', typ: 'sess-receipt-2+jwt' });
    const v2AsV1 = signClaims(v2.claims);
    await expect(verifyDecisionReceipt({ ...v2.input, receipt: v1AsV2 }, options)).rejects.toMatchObject({
      code: 'UNSUPPORTED_RECEIPT_VERSION',
    });
    await expect(verifyDecisionReceipt({ ...v2.input, receipt: v2AsV1 }, options)).rejects.toMatchObject({
      code: 'UNSUPPORTED_RECEIPT_VERSION',
    });
    // A v2 typ over claims without revision_hash is not a receipt v2.
    const noHash = signClaims({ ...(v1.claims as ReceiptClaimsV1), sess_receipt: 2 } as never, {
      alg: 'EdDSA',
      kid: 'rfc8032-test-1',
      typ: 'sess-receipt-2+jwt',
    });
    await expect(verifyDecisionReceipt({ ...v2.input, receipt: noHash }, options)).rejects.toMatchObject({
      code: 'INVALID_CLAIMS',
    });
  });

  it('verifies a receipt v1 exactly as before and never reads an envelope for it', async () => {
    const f = fixture();
    expect(await verifyDecisionReceipt(f.input, options)).toEqual(f.claims);
    expect(await verifyDecisionReceipt({ ...f.input, revisionEnvelope: null }, options)).toEqual(f.claims);
    const garbage = { anything: 'at all' } as never;
    expect(await verifyDecisionReceipt({ ...f.input, revisionEnvelope: garbage }, options)).toEqual(f.claims);
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
    const other = { ...f.response, revision_envelope: { ...f.envelope, key_label: 'Renamed later' } };
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
