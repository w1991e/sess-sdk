// Decision 0009 Amendment 13 (rc.8): a receipt's `surface.renderer_version` verifies when it is an
// identity this release bundles (sess-html-form-1, sess-html-form-2) or one on the issuer's list
// whose signature verifies under the same trusted keys and issuer. A forged, unsigned, re-typed,
// foreign, tampered or malformed list is refused; an identity missing from a valid list is
// refused; old receipts keep verifying, offline, with no list.
import { generateKeyPairSync } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BUNDLED_RENDERER_IDENTITIES, verifyRendererIdentities } from '../../src/receipts/index.js';
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

/** A signed list document: the compact JWS of `claims` (canonical unless text), as flattened JSON. */
function list(
  claims: unknown = { identities: LIST, iss: issuer, sess_renderer_identities: 1 },
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
    const missing = list({ identities: LIST.slice(0, 2), iss: issuer, sess_renderer_identities: 1 });
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
    const added = list({
      identities: [...LIST, { renderer_version: 'x-4', since: '2026-12-01' }],
      iss: issuer,
      sess_renderer_identities: 1,
    });
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
      [
        'another issuer',
        list({ identities: LIST, iss: 'https://evil.example', sess_renderer_identities: 1 }),
      ],
      ['another version', list({ identities: LIST, iss: issuer, sess_renderer_identities: 2 })],
      ['not canonical', list(JSON.stringify({ sess_renderer_identities: 1, iss: issuer, identities: LIST }))],
      [
        'a duplicate identity',
        list({ identities: [LIST[2], LIST[2]], iss: issuer, sess_renderer_identities: 1 }),
      ],
      ['an extra document member', { ...good, header: { kid: 'rfc8032-test-1' } }],
      ['a compact string, not the document', `${good.protected}.${good.payload}.${good.signature}`],
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
    expect(await verifyRendererIdentities(list(), { issuer, keys: f.keys })).toEqual(LIST);
    const resolver = vi.fn(async () => f.keys);
    expect(await verifyRendererIdentities(list(), { issuer, keyResolver: resolver })).toEqual(LIST);
    expect(resolver).toHaveBeenCalledWith(expect.objectContaining({ kid: 'rfc8032-test-1', issuer }));
    await expect(
      verifyRendererIdentities(list(), { issuer, keys: f.keys, keyResolver: resolver }),
    ).rejects.toMatchObject({ code: 'VERIFICATION_CONTEXT_MISSING' });
    await expect(verifyRendererIdentities(list(), { issuer: '', keys: f.keys })).rejects.toMatchObject({
      code: 'VERIFICATION_CONTEXT_MISSING',
    });
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
    const unlisted = resource(
      'sess-html-form-3',
      list({ identities: LIST.slice(0, 2), iss: issuer, sess_renderer_identities: 1 }),
    );
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
