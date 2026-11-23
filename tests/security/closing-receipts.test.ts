// Decision 0016 car 5, the SDK half (C-50, C-52, C-53; WX-11): the closing receipt.
//
// - The closing-receipt-v1 conformance corpus (docs/spec/closing-receipt-v1.md §9) is rebuilt from
//   its labelled public test seeds, checked byte for byte against the frozen corpus copied from Sess
//   (docs/spec/source.json), and every vector reaches its frozen result in verifyClosingReceipt.
// - The round receipt verifier refuses a closing receipt as newer (RECEIPT_NEWER); the closing
//   verifier refuses a round receipt (UNSUPPORTED_TYPE).
// - sessions.listEvents() returns the closing receipt as its own typed member, `closing`, beside the
//   Events, never as an Event or an Event's receipt; receipts.verifyClosing() verifies it against
//   the authorized Event log and the published keys.
// - Webhooks are unchanged: every Session message but response.accepted is refused.
import { createHash, createHmac } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { SessError } from '../../src/errors.js';
import { Sess } from '../../src/index.js';
import { decodeEvents } from '../../src/internal/decode.js';
import { createReceiptResource, type VerificationRequestOptions } from '../../src/receipts/resource.js';
import { verifyClosingReceipt, verifyDecisionReceipt } from '../../src/receipts/index.js';
import type { SessionClosing, SessionEvents } from '../../src/types.js';
import { verifyWebhook } from '../../src/webhooks/index.js';
import {
  buildClosingCorpus,
  CLOSING_CORPUS_AUDIENCE,
  CLOSING_CORPUS_ISSUER,
  CLOSING_CORPUS_SESSION,
  closingClaimsOf,
  closingCorpusTrustedKeys,
  forge,
  handCommitment,
  signClosingClaims,
  type ClosingCorpus,
} from '../fixtures/bundle/closing-corpus-vectors.js';
import { eventId, fixture, now, sessionId } from './fixtures.js';

const FROZEN = JSON.parse(
  readFileSync(new URL('../fixtures/bundle/closing-receipt-v1-corpus.json', import.meta.url), 'utf8'),
) as {
  issuer: string;
  audience: string;
  rounds: { id: string; sha256: string; byte_length: number }[];
  vectors: { id: string; sha256: string; byte_length: number; expected: string }[];
  commitments: { id: string; rounds: string[]; commitment: string }[];
};

const hashOf = (jws: string) => `sha256:${createHash('sha256').update(jws, 'ascii').digest('hex')}`;

/** The spec's result codes (closing-receipt-v1 §6) as this SDK reports them. */
const SDK_CODE: Record<string, string | null> = {
  valid: null,
  malformed: 'MALFORMED_RECEIPT',
  algorithm: 'UNSUPPORTED_ALGORITHM',
  type: 'UNSUPPORTED_TYPE',
  signature: 'INVALID_SIGNATURE',
  issuer: 'ISSUER_MISMATCH',
  audience: 'AUDIENCE_MISMATCH',
  unsupported: 'UNSUPPORTED_RECEIPT_VERSION',
  claims: 'INVALID_CLAIMS',
  newer: 'RECEIPT_NEWER',
};
const NEWER = { kind: 'receipt_newer', code: 'RECEIPT_NEWER' };

async function outcome(promise: Promise<unknown>): Promise<string | null> {
  try {
    await promise;
    return null;
  } catch (error) {
    if (!(error instanceof SessError)) throw error;
    return error.code ?? error.kind;
  }
}

let corpus: ClosingCorpus;
beforeAll(async () => {
  corpus = await buildClosingCorpus();
});
const vector = (id: string) => {
  const v = corpus.vectors.find((x) => x.id === id);
  if (!v) throw new Error(`no corpus vector ${id}`);
  return v.jws;
};
const roundsOf = (...ids: string[]) => ids.map((id) => corpus.rounds.find((r) => r.id === id)?.jws as string);
const verifyCorpus = (receipt: string, extra: Record<string, unknown> = {}) =>
  verifyClosingReceipt({
    receipt,
    issuer: CLOSING_CORPUS_ISSUER,
    audience: CLOSING_CORPUS_AUDIENCE,
    keys: closingCorpusTrustedKeys(),
    ...extra,
  });

describe('closing-receipt-v1 conformance corpus (Decision 0016 C-50)', () => {
  it('rebuilds every round, vector and commitment byte for byte', () => {
    expect(FROZEN.issuer).toBe(CLOSING_CORPUS_ISSUER);
    expect(FROZEN.audience).toBe(CLOSING_CORPUS_AUDIENCE);
    expect(corpus.rounds.map((r) => r.id)).toEqual(FROZEN.rounds.map((r) => r.id));
    for (const r of corpus.rounds) {
      const frozen = FROZEN.rounds.find((x) => x.id === r.id);
      expect({ sha256: hashOf(r.jws), byte_length: r.jws.length }, r.id).toEqual({
        sha256: frozen?.sha256,
        byte_length: frozen?.byte_length,
      });
    }
    expect(corpus.vectors.map((v) => v.id)).toEqual(FROZEN.vectors.map((v) => v.id));
    for (const v of corpus.vectors) {
      const frozen = FROZEN.vectors.find((x) => x.id === v.id);
      expect({ sha256: hashOf(v.jws), byte_length: v.jws.length, expected: v.expected }, v.id).toEqual({
        sha256: frozen?.sha256,
        byte_length: frozen?.byte_length,
        expected: frozen?.expected,
      });
    }
    expect(corpus.commitments).toEqual(FROZEN.commitments);
  });

  it('reaches every frozen verification result', async () => {
    for (const v of FROZEN.vectors) {
      // The spec's `claims` covers a non-canonical payload, which this SDK names as its round
      // receipt verifier does.
      const expected = v.id === 'non-canonical-payload' ? 'NON_CANONICAL_PAYLOAD' : SDK_CODE[v.expected];
      expect(expected, `${v.id}: ${v.expected} has an SDK code`).not.toBeUndefined();
      expect(await outcome(verifyCorpus(vector(v.id))), v.id).toBe(expected);
    }
  });

  it('returns the verified claims, frozen, for a valid closing receipt', async () => {
    const claims = await verifyCorpus(vector('valid-final-expiry'));
    expect(claims).toEqual(closingClaimsOf(corpus.base));
    expect(claims.terminal).toEqual({
      event_id: 'evt_corpus_expired_1',
      cause: 'final_expiry',
      actor_class: 'sess',
    });
    expect(Object.isFrozen(claims) && Object.isFrozen(claims.commitments[0])).toBe(true);
  });

  it('a newer closing receipt is newer, never a verification failure, and nothing is returned', async () => {
    for (const id of ['newer-format-version', 'unknown-extra-scope']) {
      await expect(verifyCorpus(vector(id)), id).rejects.toMatchObject(NEWER);
    }
  });
});

describe('the round set a closing receipt signs (Decision 0016 C-50, closing-receipt-v1 §3)', () => {
  it('accepts exactly the signed rounds, in order', async () => {
    const claims = await verifyCorpus(vector('valid-final-expiry'), {
      rounds: roundsOf('round-1-v1', 'round-2-v1', 'round-3-v1'),
      expected: { sessionId: CLOSING_CORPUS_SESSION, closureId: 'cls_01KCORPUSCLOSING0000000001' },
    });
    expect(claims.commitments[0]?.count).toBe(3);
  });

  it.each([
    ['reordered', ['round-2-v1', 'round-1-v1', 'round-3-v1']],
    ['a middle round removed', ['round-1-v1', 'round-3-v1']],
    ['the last round removed', ['round-1-v1', 'round-2-v1']],
    ['a round duplicated', ['round-1-v1', 'round-1-v1', 'round-2-v1', 'round-3-v1']],
    ['another round in a place', ['round-1-v1', 'round-2-v1', 'round-4-v2']],
  ])('refuses the rounds %s with CLOSING_ROUNDS_MISMATCH', async (_name, ids) => {
    await expect(
      verifyCorpus(vector('valid-final-expiry'), { rounds: roundsOf(...ids) }),
    ).rejects.toMatchObject({ kind: 'receipt_verification', code: 'CLOSING_ROUNDS_MISMATCH' });
  });

  it('refuses another Session or closure than the expected one', async () => {
    for (const expected of [
      { sessionId: 'ses_corpus_other' },
      { closureId: 'cls_01KCORPUSCLOSING0000000002' },
    ])
      await expect(verifyCorpus(vector('valid-final-expiry'), { expected })).rejects.toMatchObject({
        code: 'RECORD_BINDING_MISMATCH',
      });
  });

  it('refuses malformed rounds or context before any key is used', async () => {
    const keyResolver = vi.fn();
    for (const extra of [
      { rounds: [] },
      { rounds: ['not a jws'] },
      { expected: { sessionId: 'ses with space' } },
      { expected: { other: 'x' } },
    ])
      await expect(
        verifyClosingReceipt({
          receipt: vector('valid-final-expiry'),
          issuer: CLOSING_CORPUS_ISSUER,
          audience: CLOSING_CORPUS_AUDIENCE,
          keyResolver,
          ...(extra as object),
        }),
      ).rejects.toMatchObject({ code: 'INVALID_VERIFICATION_INPUT' });
    expect(keyResolver).not.toHaveBeenCalled();
    await expect(
      verifyClosingReceipt({
        receipt: vector('valid-final-expiry'),
        issuer: CLOSING_CORPUS_ISSUER,
        audience: '',
      }),
    ).rejects.toMatchObject({ code: 'VERIFICATION_CONTEXT_MISSING' });
    await expect(
      verifyClosingReceipt({
        receipt: vector('valid-final-expiry'),
        issuer: CLOSING_CORPUS_ISSUER,
        audience: CLOSING_CORPUS_AUDIENCE,
      }),
    ).rejects.toMatchObject({ code: 'VERIFICATION_CONTEXT_MISSING' });
    await expect(verifyCorpus('a'.repeat(8193))).rejects.toMatchObject({ code: 'MALFORMED_RECEIPT' });
  });

  it('takes its keys from a trusted resolver and refuses a kid it does not supply', async () => {
    const keyResolver = vi.fn(() => closingCorpusTrustedKeys());
    const input = {
      receipt: vector('valid-final-expiry'),
      issuer: CLOSING_CORPUS_ISSUER,
      audience: CLOSING_CORPUS_AUDIENCE,
      keyResolver,
    };
    await expect(verifyClosingReceipt(input)).resolves.toBeDefined();
    expect(keyResolver).toHaveBeenCalledWith(
      expect.objectContaining({ kid: 'closing-corpus-current', issuer: CLOSING_CORPUS_ISSUER }),
    );
    const other = { keys: [{ ...closingCorpusTrustedKeys().keys[0]!, kid: 'another-kid' }] };
    await expect(verifyClosingReceipt({ ...input, keyResolver: () => other })).rejects.toMatchObject({
      code: 'UNKNOWN_KEY_ID',
    });
  });

  it('refuses a header beyond exactly alg, kid and typ', async () => {
    const claims = closingClaimsOf(corpus.base);
    const payload = Buffer.from(JSON.stringify(claims)).toString('base64url');
    const header = Buffer.from(
      JSON.stringify({ alg: 'EdDSA', kid: 'closing-corpus-current', typ: 'sess-closing-receipt+jwt', x: 1 }),
    ).toString('base64url');
    const signature = vector('valid-final-expiry').split('.')[2];
    await expect(verifyCorpus(`${header}.${payload}.${signature}`)).rejects.toMatchObject({
      code: 'UNSUPPORTED_HEADER',
    });
  });

  it('checks the whole header before its key resolver sees anything (ASTRA-SDK-80-1)', async () => {
    const payload = Buffer.from(JSON.stringify(closingClaimsOf(corpus.base))).toString('base64url');
    const signature = vector('valid-final-expiry').split('.')[2];
    const jws = (headerJson: string) =>
      `${Buffer.from(headerJson).toString('base64url')}.${payload}.${signature}`;
    const typ = 'sess-closing-receipt+jwt';
    const refused = [
      // An oversized key ID, and ones outside the receipt key grammar.
      JSON.stringify({ alg: 'EdDSA', kid: 'x'.repeat(4000), typ }),
      JSON.stringify({ alg: 'EdDSA', kid: 'x'.repeat(65), typ }),
      JSON.stringify({ alg: 'EdDSA', kid: 'closing corpus/current', typ }),
      // An extra member, a duplicated member, and a typ that is not a string.
      JSON.stringify({ alg: 'EdDSA', kid: 'closing-corpus-current', typ, x: 1 }),
      `{"alg":"EdDSA","kid":"closing-corpus-current","kid":"closing-corpus-current","typ":"${typ}"}`,
      JSON.stringify({ alg: 'EdDSA', kid: 'closing-corpus-current', typ: 1 }),
      // A typ that holds the closing type's string without being one still has six string tokens.
      JSON.stringify({ alg: 'EdDSA', kid: 'closing-corpus-current', typ: [typ] }),
      JSON.stringify({ alg: 'EdDSA', kid: 'closing-corpus-current', typ: { x: 1 } }),
    ];
    for (const headerJson of refused) {
      const keyResolver = vi.fn(() => {
        throw new Error('the resolver must not be called');
      });
      await expect(
        verifyClosingReceipt({
          receipt: jws(headerJson),
          issuer: CLOSING_CORPUS_ISSUER,
          audience: CLOSING_CORPUS_AUDIENCE,
          keyResolver,
        }),
        headerJson.slice(0, 80),
      ).rejects.toMatchObject({ code: 'UNSUPPORTED_HEADER' });
      expect(keyResolver, headerJson.slice(0, 80)).not.toHaveBeenCalled();
    }
    // A 64-character key ID is the grammar's longest: it reaches the resolver, which does not know it.
    const longest = vi.fn(() => closingCorpusTrustedKeys());
    await expect(
      verifyClosingReceipt({
        receipt: jws(JSON.stringify({ alg: 'EdDSA', kid: 'k'.repeat(64), typ })),
        issuer: CLOSING_CORPUS_ISSUER,
        audience: CLOSING_CORPUS_AUDIENCE,
        keyResolver: longest,
      }),
    ).rejects.toMatchObject({ code: 'UNKNOWN_KEY_ID' });
    expect(longest).toHaveBeenCalledWith(expect.objectContaining({ kid: 'k'.repeat(64) }));
  });
});

describe('each verifier refuses the other receipt type (Decision 0016 C-50)', () => {
  it('the round receipt verifier refuses a closing receipt as newer (RECEIPT_NEWER), as before', async () => {
    const f = fixture();
    const options = { now: new Date(now) };
    for (const id of ['valid-final-expiry', 'valid-completed-by-owner']) {
      const failure = await verifyDecisionReceipt({ ...f.input, receipt: vector(id) }, options).catch(
        (e: unknown) => e,
      );
      expect(failure, id).toBeInstanceOf(SessError);
      expect(failure).toMatchObject(NEWER);
    }
  });

  it('the closing verifier refuses a round receipt, v1 or v2, by its type', async () => {
    await expect(verifyCorpus(roundsOf('round-1-v1')[0]!)).rejects.toMatchObject({
      kind: 'receipt_verification',
      code: 'UNSUPPORTED_TYPE',
    });
    // Closing claims under a receipt v2's own typ, signed by the trusted key: refused by the typ.
    const v2 = await forge(
      { typ: 'sess-receipt-2+jwt' },
      Buffer.from(JSON.stringify(closingClaimsOf(corpus.base))),
    );
    await expect(verifyCorpus(v2)).rejects.toMatchObject({ code: 'UNSUPPORTED_TYPE' });
  });
});

/** A ULID-shaped Session log with the corpus rounds as its accepted answers. */
const LOG_SESSION = 'ses_01JABCDEFGHJKMNPQRSTVWXYZ0';
function logOf(rounds: string[], closing?: unknown): Record<string, unknown> {
  const events: Record<string, unknown>[] = [
    {
      event_id: 'evt_01JABCDEFGHJKMNPQRSTVWX000',
      sequence: 1,
      type: 'revision.published',
      revision: 1,
      actor: { assurance: 'owner' },
      created_at: '2026-11-16T12:00:00.000Z',
    },
    ...rounds.map((receipt, i) => ({
      event_id: `evt_01JABCDEFGHJKMNPQRSTVWX00${i + 1}`,
      sequence: i + 2,
      type: 'response.accepted',
      revision: 1,
      actor: { assurance: 'link_holder' },
      action_id: 'send',
      data: { ok: true },
      created_at: '2026-11-16T12:01:00.123Z',
      receipt,
    })),
  ];
  return { id: LOG_SESSION, events, ...(closing === undefined ? {} : { closing }) };
}
const LOG_CLOSURE = 'cls_01JABCDEFGHJKMNPQRSTVWX001';
function closingOf(receipt: string, over: Partial<SessionClosing> = {}): SessionClosing {
  return {
    typ: 'sess-closing-receipt+jwt',
    closure_id: LOG_CLOSURE,
    cause: 'final_expiry',
    terminal_event_id: 'evt_01JABCDEFGHJKMNPQRSTVWX999',
    accepted_rounds: 3,
    receipt,
    ...over,
  };
}

describe('sessions.listEvents carries the closing receipt as its own member (Decision 0016 C-49, C-50)', () => {
  it('absent when the Session has none: the body is as before', () => {
    const decoded = decodeEvents(logOf(['a.b.c']), LOG_SESSION);
    expect('closing' in decoded).toBe(false);
  });

  it('present and typed beside the Events, never an Event or a round receipt', () => {
    const closing = closingOf('h.p.s');
    const decoded = decodeEvents(logOf(['a.b.c', 'd.e.f', 'g.h.i'], closing), LOG_SESSION);
    expect(decoded.closing).toEqual(closing);
    expect(decoded.events.map((e) => e.type)).toEqual([
      'revision.published',
      'response.accepted',
      'response.accepted',
      'response.accepted',
    ]);
    expect(decoded.events.some((e) => 'receipt' in e && e.receipt === closing.receipt)).toBe(false);
  });

  it.each([
    ['another typ', { typ: 'sess-receipt+jwt' }],
    ['an extra member', { extra: 1 }],
    ['a closure ID of another form', { closure_id: 'cls_x' }],
    ['an unknown cause', { cause: 'purged' }],
    ['a terminal Event ID of another form', { terminal_event_id: 'evt_x' }],
    ['a count that is not the accepted answers served', { accepted_rounds: 2 }],
    ['a zero count', { accepted_rounds: 0 }],
    ['a receipt that is not a compact JWS', { receipt: 'not a jws' }],
    ['a receipt over 8,192 characters', { receipt: `${'a'.repeat(8190)}.b.c` }],
  ])('refuses a closing member with %s as a protocol error', (_name, over) => {
    expect(() =>
      decodeEvents(logOf(['a.b.c', 'd.e.f', 'g.h.i'], { ...closingOf('h.p.s'), ...over }), LOG_SESSION),
    ).toThrow(expect.objectContaining({ kind: 'protocol', code: 'INVALID_RESPONSE' }));
    expect(() => decodeEvents(logOf(['a.b.c', 'd.e.f', 'g.h.i'], null), LOG_SESSION)).toThrow(
      expect.objectContaining({ kind: 'protocol' }),
    );
  });

  it('a terminal Event of null (revoked) is the schema’s own form', () => {
    const decoded = decodeEvents(
      logOf(['a.b.c'], closingOf('h.p.s', { cause: 'revoked', terminal_event_id: null, accepted_rounds: 1 })),
      LOG_SESSION,
    );
    expect(decoded.closing?.terminal_event_id).toBeNull();
  });
});

describe('receipts.verifyClosing against the authorized Event log (Decision 0016 C-50, C-53)', () => {
  let receipt: string;
  let rounds: string[];
  beforeAll(async () => {
    rounds = roundsOf('round-1-v1', 'round-2-v1', 'round-3-v1');
    // The corpus's valid closing receipt, for the ULID-shaped Session and terminal Event of the log.
    receipt = await signClosingClaims(
      closingClaimsOf({
        ...corpus.base,
        sessionId: LOG_SESSION,
        closureId: LOG_CLOSURE,
        terminalEventId: 'evt_01JABCDEFGHJKMNPQRSTVWX999',
      }),
    );
  });

  function resource(
    body: () => unknown,
    meta: Record<string, unknown> = { workspaceId: CLOSING_CORPUS_AUDIENCE },
    extra: Record<string, unknown> = {},
  ) {
    const paths: string[] = [];
    const listEvents = vi.fn(async (_id: string, _options: VerificationRequestOptions) => ({
      data: structuredClone(body()) as SessionEvents,
      meta: { status: 200, attempts: 1, ...meta },
    }));
    const r = createReceiptResource({
      receiptIssuer: CLOSING_CORPUS_ISSUER,
      operationTimeoutMs: 1000,
      baseUrl: 'https://api.sess.example',
      retrieveSession: async () => {
        throw new Error('not read');
      },
      retrieveSurface: async () => {
        throw new Error('not read');
      },
      publicGet: async (path: string) => {
        paths.push(path);
        return { data: closingCorpusTrustedKeys(), meta: { status: 200, attempts: 1 } };
      },
      listEvents,
      ...extra,
    });
    return { r, paths, listEvents };
  }

  it('verifies the served closing receipt with the published keys and returns it typed', async () => {
    const closing = closingOf(receipt);
    const { r, paths, listEvents } = resource(() => logOf(rounds, closing));
    const verified = await r.verifyClosing({ sessionId: LOG_SESSION, closing });
    expect(verified.closing).toEqual(closing);
    expect(verified.claims.session_id).toBe(LOG_SESSION);
    expect(verified.claims.jti).toBe(closing.closure_id);
    expect(verified.claims.commitments).toEqual([
      { scope: 'accepted_rounds', count: 3, commitment: handCommitment(rounds) },
    ]);
    expect(Object.isFrozen(verified) && Object.isFrozen(verified.claims)).toBe(true);
    expect(paths).toEqual(['/.well-known/sess-receipt-keys.json']);
    expect(listEvents).toHaveBeenCalledWith(
      LOG_SESSION,
      expect.objectContaining({ signal: expect.anything() }),
    );
  });

  it('refuses without a closing receipt, before any read', async () => {
    const { r, listEvents } = resource(() => logOf(rounds));
    for (const closing of [undefined, null])
      await expect(
        r.verifyClosing({ sessionId: LOG_SESSION, closing: closing as never }),
      ).rejects.toMatchObject({
        code: 'CLOSING_RECEIPT_UNAVAILABLE',
      });
    expect(listEvents).not.toHaveBeenCalled();
  });

  it('refuses a closing receipt the authorized Event log does not carry', async () => {
    const closing = closingOf(receipt);
    for (const served of [
      logOf(rounds),
      logOf(rounds, { ...closing, closure_id: 'cls_01JABCDEFGHJKMNPQRSTVWX002' }),
    ])
      await expect(
        resource(() => served).r.verifyClosing({ sessionId: LOG_SESSION, closing }),
      ).rejects.toMatchObject({
        code: 'RECORD_BINDING_MISMATCH',
      });
  });

  it('refuses served facts the receipt does not sign', async () => {
    for (const over of [
      { cause: 'completed_by_owner' as const },
      { terminal_event_id: 'evt_01JABCDEFGHJKMNPQRSTVWX998' },
    ]) {
      const closing = closingOf(receipt, over);
      await expect(
        resource(() => logOf(rounds, closing)).r.verifyClosing({ sessionId: LOG_SESSION, closing }),
      ).rejects.toMatchObject({ code: 'RECORD_BINDING_MISMATCH' });
    }
  });

  it('refuses when the served answers are not exactly the rounds it signs', async () => {
    const closing = closingOf(receipt);
    for (const served of [
      [rounds[1]!, rounds[0]!, rounds[2]!],
      [rounds[0]!, rounds[1]!, roundsOf('round-4-v2')[0]!],
    ])
      await expect(
        resource(() => logOf(served, closing)).r.verifyClosing({ sessionId: LOG_SESSION, closing }),
      ).rejects.toMatchObject({ code: 'CLOSING_ROUNDS_MISMATCH' });
  });

  it('through the client: listEvents hands over `closing`, verifyClosing verifies it in one more call', async () => {
    const closing = closingOf(receipt);
    const paths: string[] = [];
    const fetch: typeof globalThis.fetch = vi.fn(async (url) => {
      const path = new URL(String(url)).pathname;
      paths.push(path);
      const body = path.startsWith('/.well-known/') ? closingCorpusTrustedKeys() : logOf(rounds, closing);
      return new Response(JSON.stringify(body), {
        status: 200,
        headers: { 'content-type': 'application/json', 'sess-workspace-id': CLOSING_CORPUS_AUDIENCE },
      });
    });
    const sdk = new Sess({
      apiKey: 'test-owner-credential',
      baseUrl: 'https://api.sess.example',
      receiptIssuer: CLOSING_CORPUS_ISSUER,
      fetch,
    });
    const log = await sdk.sessions.listEvents(LOG_SESSION);
    expect(log.data.closing).toEqual(closing);
    const verified = await sdk.receipts.verifyClosing({
      sessionId: LOG_SESSION,
      closing: log.data.closing!,
    });
    expect(verified.claims.terminal.cause).toBe('final_expiry');
    expect(paths).toEqual([
      `/v1/sessions/${LOG_SESSION}/events`,
      `/v1/sessions/${LOG_SESSION}/events`,
      '/.well-known/sess-receipt-keys.json',
    ]);
  });

  it('takes its workspace from authenticated context, never from the receipt', async () => {
    const closing = closingOf(receipt);
    await expect(
      resource(() => logOf(rounds, closing), {}).r.verifyClosing({ sessionId: LOG_SESSION, closing }),
    ).rejects.toMatchObject({ code: 'VERIFICATION_CONTEXT_MISSING' });
    await expect(
      resource(() => logOf(rounds, closing), { workspaceId: 'wks_other' }).r.verifyClosing({
        sessionId: LOG_SESSION,
        closing,
      }),
    ).rejects.toMatchObject({ code: 'AUDIENCE_MISMATCH' });
    await expect(
      resource(() => logOf(rounds, closing), {}).r.verifyClosing({
        sessionId: LOG_SESSION,
        closing,
        expectedWorkspaceId: CLOSING_CORPUS_AUDIENCE,
      }),
    ).resolves.toBeDefined();
    await expect(
      resource(
        () => logOf(rounds, closing),
        {},
        { expectedWorkspaceId: CLOSING_CORPUS_AUDIENCE },
      ).r.verifyClosing({
        sessionId: LOG_SESSION,
        closing,
        expectedWorkspaceId: 'wks_other',
      }),
    ).rejects.toMatchObject({ code: 'AUDIENCE_MISMATCH' });
  });
});

describe('webhooks stay response.accepted only (Decision 0016 C-52)', () => {
  const secret = `whsec_${Buffer.alloc(32, 7).toString('base64')}`;
  function headers(raw: string) {
    const timestamp = Math.floor(now / 1000);
    const hmac = createHmac('sha256', Buffer.from(secret.slice(6), 'base64'));
    hmac.update(`${eventId}.${timestamp}.`);
    hmac.update(raw);
    return {
      'webhook-id': eventId,
      'webhook-timestamp': String(timestamp),
      'webhook-signature': `v1,${hmac.digest('base64')}`,
    };
  }
  beforeEach(() => vi.useFakeTimers({ now }));
  afterEach(() => vi.useRealTimers());

  it.each(['session.completed', 'session.expired', 'session.closed', 'closing', 'revision.published'])(
    'refuses an authenticated %s message',
    (type) => {
      const raw = JSON.stringify({
        type,
        event_id: eventId,
        session_id: sessionId,
        closing: closingOf(vector('valid-final-expiry')),
      });
      expect(() => verifyWebhook(raw, headers(raw), { secret })).toThrow(
        expect.objectContaining({ code: 'WEBHOOK_INVALID_PAYLOAD' }),
      );
    },
  );

  it('refuses a response.accepted that carries a closing member', () => {
    const f = fixture();
    const raw = JSON.stringify({
      type: 'response.accepted',
      event_id: eventId,
      session_id: sessionId,
      sequence: 1,
      revision: 1,
      action_id: 'submit',
      data: f.response.data,
      accepted_at: f.response.accepted_at,
      receipt: f.response.receipt,
      closing: closingOf(vector('valid-final-expiry')),
    });
    expect(() => verifyWebhook(raw, headers(raw), { secret })).toThrow(
      expect.objectContaining({ code: 'WEBHOOK_INVALID_PAYLOAD' }),
    );
    const plain = JSON.parse(raw) as Record<string, unknown>;
    delete plain.closing;
    const ok = JSON.stringify(plain);
    expect(verifyWebhook(ok, headers(ok), { secret }).type).toBe('response.accepted');
  });
});
