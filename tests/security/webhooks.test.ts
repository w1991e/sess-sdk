import { createHmac } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { vi } from 'vitest';
import { verifyWebhook, type WebhookHeaders } from '../../src/webhooks/index.js';
import { eventId, fixture, now, sessionId } from './fixtures.js';

export const webhookSecret = `whsec_${Buffer.alloc(32, 7).toString('base64')}`;
const nextSecret = `whsec_${Buffer.alloc(32, 8).toString('base64')}`;
export function transportHeaders(
  raw: string | Buffer,
  id = eventId,
  secrets = [webhookSecret],
  timestamp = Math.floor(now / 1000),
) {
  const signature = secrets
    .map((secret) => {
      const hmac = createHmac('sha256', Buffer.from(secret.slice(6), 'base64'));
      hmac.update(`${id}.${timestamp}.`);
      hmac.update(raw);
      return `v1,${hmac.digest('base64')}`;
    })
    .join(' ');
  return { 'webhook-id': id, 'webhook-timestamp': String(timestamp), 'webhook-signature': signature };
}

export function acceptedEvent() {
  const f = fixture();
  return {
    type: 'response.accepted' as const,
    event_id: eventId,
    session_id: sessionId,
    sequence: 1,
    revision: 1,
    action_id: 'submit',
    data: f.response.data,
    accepted_at: f.response.accepted_at,
    receipt: f.response.receipt,
  };
}

beforeEach(() => vi.useFakeTimers({ now }));
afterEach(() => vi.useRealTimers());

describe('incoming Standard Webhooks verification', () => {
  it('authenticates independent HMAC vectors over exact original bytes and protects returned data', () => {
    const event = acceptedEvent();
    const raw = JSON.stringify(event, null, 2);
    const verified = verifyWebhook(Buffer.from(raw), transportHeaders(raw), { secret: webhookSecret });
    expect(verified).toEqual(event);
    expect(Object.isFrozen(verified)).toBe(true);
    if (verified.type === 'response.accepted') {
      expect(Object.isFrozen(verified.data.metadata)).toBe(true);
      expect(() => {
        (verified.data as Record<string, unknown>).amount = 1;
      }).toThrow();
    }
    const reformatted = JSON.stringify(JSON.parse(raw));
    expect(() => verifyWebhook(reformatted, transportHeaders(raw), { secret: webhookSecret })).toThrow(
      expect.objectContaining({ code: 'WEBHOOK_INVALID_SIGNATURE' }),
    );
  });

  it('accepts matching Headers and case-insensitive records, rotation overlaps, and duplicate deliveries', () => {
    const raw = JSON.stringify(acceptedEvent());
    const headers = transportHeaders(raw, eventId, [nextSecret, webhookSecret]);
    expect(verifyWebhook(raw, new Headers(headers), { secret: webhookSecret }).type).toBe(
      'response.accepted',
    );
    expect(verifyWebhook(raw, headers, { secrets: [webhookSecret, nextSecret] })).toEqual(
      verifyWebhook(raw, headers, { secret: nextSecret }),
    );
    expect(
      verifyWebhook(raw, Object.fromEntries(Object.entries(headers).map(([k, v]) => [k.toUpperCase(), v])), {
        secret: webhookSecret,
      }).type,
    ).toBe('response.accepted');
    expect(verifyWebhook(raw, headers, { secret: webhookSecret })).toEqual(
      verifyWebhook(raw, headers, { secret: webhookSecret }),
    );
  });

  it('verifies authentication before attempting JSON parsing', () => {
    const invalidJson = '{invalid';
    expect(() =>
      verifyWebhook(invalidJson, transportHeaders(invalidJson, eventId, [nextSecret]), {
        secret: webhookSecret,
      }),
    ).toThrow(expect.objectContaining({ code: 'WEBHOOK_INVALID_SIGNATURE' }));
    expect(() =>
      verifyWebhook(invalidJson, transportHeaders(invalidJson), { secret: webhookSecret }),
    ).toThrow(expect.objectContaining({ code: 'WEBHOOK_INVALID_PAYLOAD' }));
  });

  it('rejects forged accepted-event identity despite a valid transport signature', () => {
    const raw = JSON.stringify({ ...acceptedEvent(), event_id: 'evt_01JABCDEFGHJKMNPQRSTVWXYZ2' });
    expect(() => verifyWebhook(raw, transportHeaders(raw), { secret: webhookSecret })).toThrow(
      expect.objectContaining({ code: 'WEBHOOK_INVALID_PAYLOAD' }),
    );
  });

  it.each([-301, 301])('rejects stale/future timestamp delta %i', (delta) => {
    const raw = JSON.stringify(acceptedEvent());
    expect(() =>
      verifyWebhook(raw, transportHeaders(raw, eventId, [webhookSecret], Math.floor(now / 1000) + delta), {
        secret: webhookSecret,
      }),
    ).toThrow(expect.objectContaining({ code: 'WEBHOOK_TIMESTAMP_OUT_OF_RANGE' }));
  });

  it('supports only a tighter finite tolerance, including exact-second verification', () => {
    const raw = JSON.stringify(acceptedEvent());
    expect(
      verifyWebhook(raw, transportHeaders(raw), { secret: webhookSecret, toleranceSeconds: 0 }).type,
    ).toBe('response.accepted');
    expect(() =>
      verifyWebhook(raw, transportHeaders(raw, eventId, [webhookSecret], Math.floor(now / 1000) - 2), {
        secret: webhookSecret,
        toleranceSeconds: 1,
      }),
    ).toThrow();
    for (const toleranceSeconds of [-1, Infinity, NaN, 301]) {
      expect(() =>
        verifyWebhook(raw, transportHeaders(raw), { secret: webhookSecret, toleranceSeconds }),
      ).toThrow(expect.objectContaining({ kind: 'configuration' }));
    }
  });

  it.each([
    (headers: Record<string, string>) => ({ ...headers, 'Webhook-Id': headers['webhook-id'] }),
    (headers: Record<string, string>) => ({ ...headers, 'webhook-id': [headers['webhook-id']] }),
    (headers: Record<string, string>) => ({ ...headers, 'webhook-timestamp': '012345' }),
    (headers: Record<string, string>) => ({
      ...headers,
      'webhook-timestamp': `${headers['webhook-timestamp']}ignored`,
    }),
    (headers: Record<string, string>) => ({
      ...headers,
      'webhook-signature': `${headers['webhook-signature']}, ${headers['webhook-signature']}`,
    }),
    (headers: Record<string, string>) => ({ ...headers, 'webhook-id': 'evt_fake\r\n' }),
    (headers: Record<string, string>) => ({ ...headers, 'webhook-signature': 'v1,?' }),
    (headers: Record<string, string>) => ({
      ...headers,
      'webhook-signature': Array(9).fill(headers['webhook-signature']).join(' '),
    }),
    (headers: Record<string, string>) => ({ ...headers, 'webhook-signature': '' }),
  ])('rejects repeated, malformed or oversized headers', (change) => {
    const raw = JSON.stringify(acceptedEvent());
    expect(() =>
      verifyWebhook(raw, change(transportHeaders(raw)) as WebhookHeaders, { secret: webhookSecret }),
    ).toThrow(expect.objectContaining({ code: 'WEBHOOK_INVALID_HEADERS' }));
  });

  it('rejects repeated scalar Headers and ignores informational key IDs as authority', () => {
    const raw = JSON.stringify(acceptedEvent());
    const duplicate = new Headers(transportHeaders(raw));
    duplicate.append('webhook-id', eventId);
    expect(() => verifyWebhook(raw, duplicate, { secret: webhookSecret })).toThrow(
      expect.objectContaining({ code: 'WEBHOOK_INVALID_HEADERS' }),
    );
    const wrong = {
      ...transportHeaders(raw, eventId, [nextSecret]),
      'sess-webhook-key-ids': 'trusted-secret-id',
    };
    expect(() => verifyWebhook(raw, wrong, { secret: webhookSecret })).toThrow(
      expect.objectContaining({ code: 'WEBHOOK_INVALID_SIGNATURE' }),
    );
  });

  it('ignores unknown signature versions only when a supported signature also authenticates', () => {
    const raw = JSON.stringify(acceptedEvent());
    const headers = transportHeaders(raw);
    const unknown = headers['webhook-signature'].replace('v1,', 'v2,');
    expect(() =>
      verifyWebhook(raw, { ...headers, 'webhook-signature': unknown }, { secret: webhookSecret }),
    ).toThrow(expect.objectContaining({ code: 'WEBHOOK_INVALID_SIGNATURE' }));
    expect(
      verifyWebhook(
        raw,
        { ...headers, 'webhook-signature': `${unknown} ${headers['webhook-signature']}` },
        { secret: webhookSecret },
      ).type,
    ).toBe('response.accepted');
  });

  it('keeps authenticated challenges separate and exactly echoes their bounded content', () => {
    const challenge = Buffer.alloc(32, 2).toString('base64url');
    const message = { type: 'sess.webhook.verification', challenge };
    const raw = JSON.stringify(message);
    const verified = verifyWebhook(raw, transportHeaders(raw, `vfy_${challenge.slice(0, 26)}`), {
      secret: webhookSecret,
    });
    expect(verified).toEqual(message);
    const compatible = JSON.stringify({
      type: 'sess.webhook.verification',
      challenge: 'a different opaque challenge',
    });
    expect(
      verifyWebhook(compatible, transportHeaders(compatible, 'vfy_public-contract'), {
        secret: webhookSecret,
      }),
    ).toHaveProperty('challenge', 'a different opaque challenge');
    const oversized = JSON.stringify({ type: 'sess.webhook.verification', challenge: 'a'.repeat(1025) });
    expect(() =>
      verifyWebhook(oversized, transportHeaders(oversized, 'vfy_bounded-challenge'), {
        secret: webhookSecret,
      }),
    ).toThrow(expect.objectContaining({ code: 'WEBHOOK_INVALID_CHALLENGE' }));
  });

  it('refuses parsed objects, lossy UTF-8, malformed Unicode and excessive bodies before hashing', () => {
    const headers = transportHeaders('');
    expect(() => verifyWebhook({} as string, headers, { secret: webhookSecret })).toThrow(
      expect.objectContaining({ code: 'WEBHOOK_RAW_BODY_REQUIRED' }),
    );
    const malformedBytes = Buffer.from([0xc3, 0x28]);
    expect(() =>
      verifyWebhook(malformedBytes, transportHeaders(malformedBytes), { secret: webhookSecret }),
    ).toThrow(expect.objectContaining({ code: 'WEBHOOK_INVALID_ENCODING' }));
    expect(() => verifyWebhook('\ud800', headers, { secret: webhookSecret })).toThrow(
      expect.objectContaining({ code: 'WEBHOOK_INVALID_ENCODING' }),
    );
    expect(() => verifyWebhook(Buffer.alloc(1024 * 1024 + 1), headers, { secret: webhookSecret })).toThrow(
      expect.objectContaining({ code: 'WEBHOOK_BODY_TOO_LARGE' }),
    );
  });

  it('does not confuse transport verification with receipt verification', () => {
    const raw = JSON.stringify({ ...acceptedEvent(), receipt: null });
    const verified = verifyWebhook(raw, transportHeaders(raw), { secret: webhookSecret });
    expect(verified.type).toBe('response.accepted');
    if (verified.type === 'response.accepted') expect(verified.receipt).toBeNull();
    expect(verified).not.toHaveProperty('verifiedReceipt');
  });
});

const askId = 'ask_01JABCDEFGHJKMNPQRSTVWXYZ3';
const askEventId = 'evt_01JABCDEFGHJKMNPQRSTVWXYZ4';

/** As the Sess server builds it (`deliveryMessage`): `ask_id` right after `session_id`. */
function respondentEvent() {
  const { type, event_id, session_id, ...rest } = acceptedEvent();
  return { type, event_id, session_id, ask_id: askId, ...rest };
}

/** As the Sess server builds it (`askClosedMessage`), in its key order. */
function askClosedEvent() {
  return {
    type: 'ask.closed' as const,
    event_id: askEventId,
    ask_id: askId,
    closed_by: 'owner' as const,
    started: 3,
    closed_at: '2026-10-12T17:59:00.000Z',
  };
}

describe('Ask webhook messages (0.3.1)', () => {
  it("verifies a respondent's response.accepted with its ask_id and returns it typed", () => {
    const event = respondentEvent();
    const raw = JSON.stringify(event);
    const verified = verifyWebhook(raw, transportHeaders(raw), { secret: webhookSecret });
    expect(verified).toEqual(event);
    expect(Object.isFrozen(verified)).toBe(true);
    if (verified.type !== 'response.accepted') throw new Error('expected response.accepted');
    const typed: string | undefined = verified.ask_id;
    expect(typed).toBe(askId);
    // A non-Ask Session's message still verifies without the member.
    const plain = JSON.stringify(acceptedEvent());
    expect(verifyWebhook(plain, transportHeaders(plain), { secret: webhookSecret })).not.toHaveProperty(
      'ask_id',
    );
  });

  it('verifies a respondent message carrying both ask_id and revision_envelope', () => {
    const raw = JSON.stringify({ ...respondentEvent(), revision_envelope: { v: 1 } });
    expect(verifyWebhook(raw, transportHeaders(raw), { secret: webhookSecret })).toHaveProperty(
      'ask_id',
      askId,
    );
  });

  it.each([
    ['wrong prefix', 'ses_01JABCDEFGHJKMNPQRSTVWXYZ3'],
    ['short', 'ask_01JABCDEFGHJKMNPQRSTVWXYZ'],
    ['excluded letter', 'ask_01JABCDEFGHJKMNPQRSTVWXYZI'],
    ['lower case', 'ask_01jabcdefghjkmnpqrstvwxyz3'],
    ['empty', ''],
    ['null', null],
    ['number', 1],
    ['object', { id: 'ask_01JABCDEFGHJKMNPQRSTVWXYZ3' }],
  ])('refuses a response.accepted with a malformed ask_id (%s)', (_name, bad) => {
    const raw = JSON.stringify({ ...respondentEvent(), ask_id: bad });
    expect(() => verifyWebhook(raw, transportHeaders(raw), { secret: webhookSecret })).toThrow(
      expect.objectContaining({ code: 'WEBHOOK_INVALID_PAYLOAD' }),
    );
  });

  it('verifies ask.closed and returns it typed and frozen', () => {
    for (const closed_by of ['owner', 'max'] as const) {
      for (const started of [0, 3]) {
        const event = { ...askClosedEvent(), closed_by, started };
        const raw = JSON.stringify(event);
        const verified = verifyWebhook(raw, transportHeaders(raw, askEventId), { secret: webhookSecret });
        expect(verified).toEqual(event);
        expect(Object.isFrozen(verified)).toBe(true);
        if (verified.type !== 'ask.closed') throw new Error('expected ask.closed');
        const typed: { ask_id: string; closed_by: 'max' | 'owner'; started: number; closed_at: string } =
          verified;
        expect(typed.ask_id).toBe(askId);
      }
    }
  });

  it('refuses an ask.closed whose event_id differs from the webhook-id header', () => {
    const raw = JSON.stringify(askClosedEvent());
    expect(() => verifyWebhook(raw, transportHeaders(raw, eventId), { secret: webhookSecret })).toThrow(
      expect.objectContaining({ code: 'WEBHOOK_INVALID_PAYLOAD' }),
    );
  });

  it.each([
    ['an unknown member', { extra: 1 }],
    ['a session_id', { session_id: sessionId }],
    ['a malformed ask_id', { ask_id: 'ask_nope' }],
    ['a malformed event_id', { event_id: 'evt_nope' }],
    ['closed_by deadline', { closed_by: 'deadline' }],
    ['closed_by null', { closed_by: null }],
    ['a negative started', { started: -1 }],
    ['a fractional started', { started: 1.5 }],
    ['a string started', { started: '3' }],
    ['a non-canonical closed_at', { closed_at: '2026-10-12T17:59:00Z' }],
  ])('refuses an ask.closed with %s', (_name, change) => {
    const event: Record<string, unknown> = { ...askClosedEvent(), ...change };
    const raw = JSON.stringify(event);
    const id =
      typeof event.event_id === 'string' && /^[A-Za-z0-9._-]{1,128}$/.test(event.event_id)
        ? event.event_id
        : askEventId;
    expect(() => verifyWebhook(raw, transportHeaders(raw, id), { secret: webhookSecret })).toThrow(
      expect.objectContaining({ code: 'WEBHOOK_INVALID_PAYLOAD' }),
    );
  });

  it.each(['type', 'event_id', 'ask_id', 'closed_by', 'started', 'closed_at'])(
    'refuses an ask.closed missing %s',
    (member) => {
      const event: Record<string, unknown> = askClosedEvent();
      delete event[member];
      const raw = JSON.stringify(event);
      expect(() => verifyWebhook(raw, transportHeaders(raw, askEventId), { secret: webhookSecret })).toThrow(
        expect.objectContaining({ code: 'WEBHOOK_INVALID_PAYLOAD' }),
      );
    },
  );

  it('still refuses unknown members on response.accepted, with or without ask_id', () => {
    for (const event of [acceptedEvent(), respondentEvent()]) {
      const raw = JSON.stringify({ ...event, extra: true });
      expect(() => verifyWebhook(raw, transportHeaders(raw), { secret: webhookSecret })).toThrow(
        expect.objectContaining({ code: 'WEBHOOK_INVALID_PAYLOAD' }),
      );
    }
  });

  it('applies the same signature and timestamp rules to Ask messages', () => {
    for (const [event, id] of [
      [respondentEvent(), eventId],
      [askClosedEvent(), askEventId],
    ] as const) {
      const raw = JSON.stringify(event);
      expect(() =>
        verifyWebhook(raw, transportHeaders(raw, id, [nextSecret]), { secret: webhookSecret }),
      ).toThrow(expect.objectContaining({ code: 'WEBHOOK_INVALID_SIGNATURE' }));
      const reformatted = JSON.stringify(event, null, 1);
      expect(() => verifyWebhook(reformatted, transportHeaders(raw, id), { secret: webhookSecret })).toThrow(
        expect.objectContaining({ code: 'WEBHOOK_INVALID_SIGNATURE' }),
      );
      for (const delta of [-301, 301]) {
        expect(() =>
          verifyWebhook(raw, transportHeaders(raw, id, [webhookSecret], Math.floor(now / 1000) + delta), {
            secret: webhookSecret,
          }),
        ).toThrow(expect.objectContaining({ code: 'WEBHOOK_TIMESTAMP_OUT_OF_RANGE' }));
      }
      // Authentication still precedes parsing: a wrong secret is a signature failure, not a payload one.
      const malformed = JSON.stringify({ ...event, extra: 1 });
      expect(() =>
        verifyWebhook(malformed, transportHeaders(malformed, id, [nextSecret]), { secret: webhookSecret }),
      ).toThrow(expect.objectContaining({ code: 'WEBHOOK_INVALID_SIGNATURE' }));
    }
  });
});
