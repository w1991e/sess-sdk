// Decision 0009 Amendment 13 (rc.8): a receipt's `surface.renderer_version` verifies when it is an
// identity this release bundles (sess-html-form-1, sess-html-form-2) or one on the issuer's list
// whose signature verifies under the same trusted keys and issuer. A forged, unsigned, re-typed,
// foreign, tampered or malformed list is refused; an identity missing from a valid list is
// refused; old receipts keep verifying, offline, with no list.
import { generateKeyPairSync } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  BUNDLED_RENDERER_IDENTITIES,
  BUNDLED_RENDERER_LIST,
  newerRendererList,
  verifyRendererIdentities,
} from '../../src/receipts/index.js';
import type { RendererIdentitiesDocument } from '../../src/receipts/renderers.js';
import { createReceiptResource } from '../../src/receipts/resource.js';
import { verifyDecisionReceipt, type ReceiptClaims } from '../../src/receipts/verify.js';
import {
  fixture,
  independentCanonical,
  issuer,
  now,
  sessionId,
  signClaims,
  signPayload,
} from './fixtures.js';

const options = { now: new Date(now) };
const LIST = [
  { renderer_version: 'sess-html-form-1', since: '2026-10-09' },
  { renderer_version: 'sess-html-form-2', since: '2026-10-18' },
  { renderer_version: 'sess-html-form-3', since: '2026-11-02' },
];
const LIST_HEADER = { alg: 'EdDSA', kid: 'rfc8032-test-1', typ: 'sess-renderer-identities+jwt' };
const IAT = Math.floor(Date.parse('2026-11-02T00:00:00Z') / 1000);

/** List claims: edition 2 (the bundled edition 1 plus sess-html-form-3) unless overridden. */
const claimsOf = (over: Record<string, unknown> = {}) => ({
  iat: IAT,
  identities: LIST,
  iss: issuer,
  seq: 2,
  sess_renderer_identities: 1,
  ...over,
});
/** Edition 1: exactly the bundled list. */
const EDITION_1 = { identities: LIST.slice(0, 2), seq: 1 };

/** A signed list document: the compact JWS of `claims` (canonical unless text), as flattened JSON. */
function list(
  claims: unknown = claimsOf(),
  header: unknown = LIST_HEADER,
  key?: Parameters<typeof signPayload>[2],
): RendererIdentitiesDocument {
  const text = typeof claims === 'string' ? claims : independentCanonical(claims);
  const [p, payload, signature] = signPayload(text, header, key).split('.') as [string, string, string];
  return { protected: p, payload, signature };
}

/** The base fixture with its receipt re-signed under `renderer`. */
function withRenderer(renderer: string) {
  const f = fixture();
  (f.claims as { surface: { renderer_version: string } }).surface.renderer_version = renderer;
  return { ...f, input: { ...f.input, receipt: signClaims(f.claims as ReceiptClaims) } };
}

describe('renderer identities: the receipt verifier (Decision 0009 Amendment 13)', () => {
  it('bundles sess-html-form-1 and sess-html-form-2: an old receipt and a sess-html-form-2 receipt verify offline with no list', async () => {
    expect(BUNDLED_RENDERER_IDENTITIES).toEqual(['sess-html-form-1', 'sess-html-form-2']);
    const network = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('must stay offline'));
    try {
      expect((await verifyDecisionReceipt(fixture().input, options)).surface.renderer_version).toBe(
        'sess-html-form-1',
      );
      const two = withRenderer('sess-html-form-2');
      expect((await verifyDecisionReceipt(two.input, options)).surface.renderer_version).toBe(
        'sess-html-form-2',
      );
      // A supplied list is not needed (and not read) for a bundled identity.
      const garbage = { protected: 'x', payload: 'y', signature: 'z' };
      await expect(
        verifyDecisionReceipt({ ...fixture().input, rendererIdentities: garbage }, options),
      ).resolves.toBeDefined();
      expect(network).not.toHaveBeenCalled();
    } finally {
      network.mockRestore();
    }
  });

  it('a future identity verifies only on the issuer’s signed list: refused without one, accepted on it, refused when the list does not name it', async () => {
    const three = withRenderer('sess-html-form-3');
    await expect(verifyDecisionReceipt(three.input, options)).rejects.toMatchObject({
      code: 'UNSUPPORTED_RENDERER',
    });
    const claims = await verifyDecisionReceipt({ ...three.input, rendererIdentities: list() }, options);
    expect(claims.surface.renderer_version).toBe('sess-html-form-3');
    const missing = list(claimsOf(EDITION_1));
    await expect(
      verifyDecisionReceipt({ ...three.input, rendererIdentities: missing }, options),
    ).rejects.toMatchObject({ code: 'UNSUPPORTED_RENDERER' });
    // A malformed identity is refused before any list is consulted.
    await expect(
      verifyDecisionReceipt({ ...withRenderer('has space').input, rendererIdentities: list() }, options),
    ).rejects.toMatchObject({ code: 'UNSUPPORTED_RENDERER' });
  });

  it('a forged, unsigned, re-typed, foreign, tampered or malformed list is refused (INVALID_RENDERER_LIST), and the receipt with it', async () => {
    const three = withRenderer('sess-html-form-3');
    const other = generateKeyPairSync('ed25519').privateKey;
    const good = list();
    const added = list(
      claimsOf({ identities: [...LIST, { renderer_version: 'x-4', since: '2026-12-01' }], seq: 3 }),
    );
    const bad: [string, unknown][] = [
      ['forged: another key under the trusted kid', list(undefined, LIST_HEADER, other)],
      ['unsigned: an empty signature', { ...good, signature: '' }],
      [
        'unsigned: alg none',
        {
          ...good,
          protected: Buffer.from(JSON.stringify({ ...LIST_HEADER, alg: 'none' })).toString('base64url'),
        },
      ],
      ['tampered: an identity added under the old signature', { ...good, payload: added.payload }],
      ['a receipt typ', list(undefined, { ...LIST_HEADER, typ: 'sess-receipt+jwt' })],
      ['an unknown kid', list(undefined, { ...LIST_HEADER, kid: 'unknown-kid' })],
      ['another issuer', list(claimsOf({ iss: 'https://evil.example' }))],
      ['another version', list(claimsOf({ sess_renderer_identities: 2 }))],
      [
        'not canonical',
        list(
          JSON.stringify({ sess_renderer_identities: 1, seq: 2, iss: issuer, iat: IAT, identities: LIST }),
        ),
      ],
      ['a duplicate identity', list(claimsOf({ identities: [LIST[2], LIST[2]] }))],
      ['an extra document member', { ...good, header: { kid: 'rfc8032-test-1' } }],
      ['a compact string, not the document', `${good.protected}.${good.payload}.${good.signature}`],
      ['no seq', list(claimsOf({ seq: undefined }))],
      ['no iat', list(claimsOf({ iat: undefined }))],
      ['seq 0', list(claimsOf({ seq: 0 }))],
      ['a fractional seq', list(claimsOf({ seq: 2.5 }))],
      ['a string iat', list(claimsOf({ iat: String(IAT) }))],
      [
        'tampered: seq raised under the old signature',
        { ...good, payload: list(claimsOf({ seq: 9 })).payload },
      ],
      [
        'tampered: iat moved under the old signature',
        { ...good, payload: list(claimsOf({ iat: IAT + 1 })).payload },
      ],
      [
        'disagrees with the bundled edition: sess-html-form-2 dropped',
        list(claimsOf({ identities: [LIST[0], LIST[2]] })),
      ],
      [
        'disagrees with the bundled edition: a re-dated identity',
        list(claimsOf({ identities: [{ ...LIST[0], since: '2026-10-10' }, LIST[1], LIST[2]] })),
      ],
      ['the bundled edition number with other identities', list(claimsOf({ seq: 1 }))],
    ];
    for (const [name, document] of bad) {
      await expect(
        verifyDecisionReceipt(
          { ...three.input, rendererIdentities: document as RendererIdentitiesDocument },
          options,
        ),
        name,
      ).rejects.toMatchObject({ code: 'INVALID_RENDERER_LIST' });
    }
  });

  it('verifyRendererIdentities verifies a list offline under explicit keys or a resolver and refuses an ambiguous context', async () => {
    const f = fixture();
    expect(await verifyRendererIdentities(list(), { issuer, keys: f.keys })).toEqual({
      seq: 2,
      iat: IAT,
      identities: LIST,
    });
    const resolver = vi.fn(async () => f.keys);
    expect((await verifyRendererIdentities(list(), { issuer, keyResolver: resolver })).identities).toEqual(
      LIST,
    );
    expect(resolver).toHaveBeenCalledWith(expect.objectContaining({ kid: 'rfc8032-test-1', issuer }));
    await expect(
      verifyRendererIdentities(list(), { issuer, keys: f.keys, keyResolver: resolver }),
    ).rejects.toMatchObject({ code: 'VERIFICATION_CONTEXT_MISSING' });
    await expect(verifyRendererIdentities(list(), { issuer: '', keys: f.keys })).rejects.toMatchObject({
      code: 'VERIFICATION_CONTEXT_MISSING',
    });
  });
});

describe('renderer identities: list editions (seq, iat) and their order', () => {
  it('the bundled list is edition 1 with its dates; BUNDLED_RENDERER_IDENTITIES names it', () => {
    expect(BUNDLED_RENDERER_LIST).toEqual({ seq: 1, identities: LIST.slice(0, 2) });
    expect(BUNDLED_RENDERER_IDENTITIES).toEqual(
      BUNDLED_RENDERER_LIST.identities.map((i) => i.renderer_version),
    );
    expect(Object.isFrozen(BUNDLED_RENDERER_LIST)).toBe(true);
  });

  it('seq orders authentic lists across a growth, whichever comes first; an older edition still proves the identities it holds, and never their absence', async () => {
    const f = fixture();
    const v2 = await verifyRendererIdentities(list(), { issuer, keys: f.keys });
    const grown = [...LIST, { renderer_version: 'sess-html-form-4', since: '2026-12-01' }];
    const v3 = await verifyRendererIdentities(
      list(claimsOf({ identities: grown, seq: 3, iat: IAT + 86400 })),
      {
        issuer,
        keys: f.keys,
      },
    );
    expect(newerRendererList(v2, v3)).toBe(v3);
    expect(newerRendererList(v3, v2)).toBe(v3);
    expect(newerRendererList(BUNDLED_RENDERER_LIST, v2)).toBe(v2);
    // Edition 2 still proves sess-html-form-3 although edition 3 exists.
    const three = withRenderer('sess-html-form-3');
    await expect(
      verifyDecisionReceipt({ ...three.input, rendererIdentities: list() }, options),
    ).resolves.toBeDefined();
    // It does not hold sess-html-form-4: that receipt is unsupported with it, never accepted by
    // fallback, and accepted with edition 3.
    const four = withRenderer('sess-html-form-4');
    await expect(
      verifyDecisionReceipt({ ...four.input, rendererIdentities: list() }, options),
    ).rejects.toMatchObject({ code: 'UNSUPPORTED_RENDERER' });
    await expect(
      verifyDecisionReceipt(
        { ...four.input, rendererIdentities: list(claimsOf({ identities: grown, seq: 3 })) },
        options,
      ),
    ).resolves.toBeDefined();
    // Lists that disagree are refused, never merged: a later edition that drops or reorders an
    // identity, or two copies of one edition that differ.
    for (const bad of [
      { seq: 3, iat: IAT, identities: LIST.slice(0, 2) },
      { seq: 3, iat: IAT, identities: [LIST[1]!, LIST[0]!, LIST[2]!] },
      { seq: 2, iat: IAT, identities: grown },
    ])
      expect(() => newerRendererList(v2, bad)).toThrow(
        expect.objectContaining({ code: 'INVALID_RENDERER_LIST' }),
      );
  });

  it('key rotation: the same edition re-signed under a rotated key (another kid, a later iat) verifies with the published keys and agrees with the first copy', async () => {
    const f = fixture();
    const rotated = generateKeyPairSync('ed25519');
    const keys = {
      keys: [
        ...f.keys.keys,
        {
          kty: 'OKP',
          crv: 'Ed25519',
          x: rotated.publicKey.export({ format: 'jwk' }).x as string,
          kid: 'rotated-2',
          alg: 'EdDSA',
          use: 'sig',
          key_ops: ['verify'],
        },
      ],
    } as typeof f.keys;
    const first = await verifyRendererIdentities(list(), { issuer, keys });
    const copy = await verifyRendererIdentities(
      list(claimsOf({ iat: IAT + 3600 }), { ...LIST_HEADER, kid: 'rotated-2' }, rotated.privateKey),
      { issuer, keys },
    );
    expect(copy).toEqual({ seq: 2, iat: IAT + 3600, identities: LIST });
    expect(newerRendererList(first, copy).identities).toEqual(LIST);
    // The old key's copy still verifies while the old key is published; once it is not, it is not
    // trusted (no fallback to another kid).
    await expect(
      verifyRendererIdentities(list(), { issuer, keys: { keys: [keys.keys[1]!] } as typeof f.keys }),
    ).rejects.toMatchObject({ code: 'INVALID_RENDERER_LIST' });
  });
});

describe('renderer identities: online verification fetches the list only when needed', () => {
  beforeEach(() => vi.useFakeTimers({ now }));
  afterEach(() => vi.useRealTimers());

  function resource(renderer: string, listDocument: unknown = list()) {
    const f = withRenderer(renderer);
    const session = structuredClone(f.session);
    session.responses[0] = { ...session.responses[0]!, receipt: f.input.receipt };
    const publicGet = vi.fn(async (path: string) => ({
      data: structuredClone(path.endsWith('sess-renderer-identities.json') ? listDocument : f.keys),
      meta: { status: 200, attempts: 1 },
    }));
    const r = createReceiptResource({
      receiptIssuer: issuer,
      operationTimeoutMs: 1000,
      baseUrl: 'https://api.sess.example',
      retrieveSession: async () => ({
        data: structuredClone(session),
        meta: { status: 200, attempts: 1, etag: '"current-1"', workspaceId: f.claims.aud },
      }),
      retrieveSurface: async () => ({ data: structuredClone(f.surface), meta: { status: 200, attempts: 1 } }),
      publicGet,
    });
    return { r, publicGet, response: session.responses[0]! };
  }

  it('a bundled identity needs no list; a future one is verified against the list fetched from the API origin', async () => {
    const old = resource('sess-html-form-1');
    await old.r.verifyResponse({ sessionId, response: old.response });
    expect(old.publicGet.mock.calls.map((c) => c[0])).toEqual(['/.well-known/sess-receipt-keys.json']);
    const future = resource('sess-html-form-3');
    const verified = await future.r.verifyResponse({ sessionId, response: future.response });
    expect(verified.claims.surface.renderer_version).toBe('sess-html-form-3');
    expect(future.publicGet).toHaveBeenCalledWith(
      '/.well-known/sess-renderer-identities.json',
      expect.objectContaining({ maxResponseBytes: 64 * 1024 }),
    );
    // A list served without the identity, or a forged one, does not verify the receipt.
    const unlisted = resource('sess-html-form-3', list(claimsOf(EDITION_1)));
    await expect(unlisted.r.verifyResponse({ sessionId, response: unlisted.response })).rejects.toMatchObject(
      { code: 'UNSUPPORTED_RENDERER' },
    );
    const forged = resource(
      'sess-html-form-3',
      list(undefined, LIST_HEADER, generateKeyPairSync('ed25519').privateKey),
    );
    await expect(forged.r.verifyResponse({ sessionId, response: forged.response })).rejects.toMatchObject({
      code: 'INVALID_RENDERER_LIST',
    });
  });
});
