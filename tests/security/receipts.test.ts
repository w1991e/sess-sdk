import { createHash } from 'node:crypto';
import { inspect } from 'node:util';
import { describe, expect, it, vi } from 'vitest';
import { SessError } from '../../src/errors.js';
import { verifyDecisionReceipt, type ReceiptClaims, type ReceiptKeySet } from '../../src/receipts/verify.js';
import { canonicalJson, jsonDigest, snapshotJson } from '../../src/receipts/json.js';
import {
  deferred,
  fixture,
  independentCanonical,
  now,
  publicKey,
  signClaims,
  signPayload,
  workspace,
} from './fixtures.js';

const options = { now: new Date(now) };

describe('full receipt verification', () => {
  it('verifies a Node-crypto signed independent Ed25519 vector and every binding offline', async () => {
    const f = fixture();
    const network = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('must stay offline'));
    try {
      expect(publicKey.export({ format: 'jwk' }).x).toBe('11qYAYKxCrfVS_7TyWQHOg7hcvPapiMlrwIaaPcHURo');
      const claims = await verifyDecisionReceipt(f.input, options);
      expect(claims).toEqual(f.claims);
      expect(network).not.toHaveBeenCalled();
    } finally {
      network.mockRestore();
    }
  });

  it.each([
    [
      'issuer',
      (c: ReceiptClaims) => {
        c.iss = 'https://wrong.example';
      },
      'ISSUER_MISMATCH',
    ],
    [
      'audience',
      (c: ReceiptClaims) => {
        c.aud = 'wks_other';
      },
      'AUDIENCE_MISMATCH',
    ],
    [
      'workspace',
      (c: ReceiptClaims) => {
        c.workspace_id = 'wks_other';
      },
      'AUDIENCE_MISMATCH',
    ],
    [
      'recipient',
      (c: ReceiptClaims) => {
        c.return_binding.recipient = 'wks_other';
      },
      'AUDIENCE_MISMATCH',
    ],
    [
      'session',
      (c: ReceiptClaims) => {
        c.session_id += '0';
      },
      'RECORD_BINDING_MISMATCH',
    ],
    [
      'event',
      (c: ReceiptClaims) => {
        c.event_id += '0';
      },
      'RECORD_BINDING_MISMATCH',
    ],
    [
      'jti',
      (c: ReceiptClaims) => {
        c.jti += '0';
      },
      'RECORD_BINDING_MISMATCH',
    ],
    [
      'step',
      (c: ReceiptClaims) => {
        c.step_id = 'rev_2';
      },
      'RECORD_BINDING_MISMATCH',
    ],
    [
      'revision',
      (c: ReceiptClaims) => {
        c.surface.revision = 2;
      },
      'RECORD_BINDING_MISMATCH',
    ],
    [
      'input hash',
      (c: ReceiptClaims) => {
        c.input_hash = `sha256:${'0'.repeat(64)}`;
      },
      'INPUT_HASH_MISMATCH',
    ],
    [
      'surface hash',
      (c: ReceiptClaims) => {
        c.surface.hash = `sha256:${'0'.repeat(64)}`;
      },
      'SURFACE_HASH_MISMATCH',
    ],
    [
      'action id',
      (c: ReceiptClaims) => {
        c.action.id = 'approve';
      },
      'ACTION_BINDING_MISMATCH',
    ],
    [
      'action label',
      (c: ReceiptClaims) => {
        c.action.label = 'Changed label';
      },
      'ACTION_BINDING_MISMATCH',
    ],
    [
      'action summary',
      (c: ReceiptClaims) => {
        c.action.summary = 'approve';
      },
      'ACTION_BINDING_MISMATCH',
    ],
    [
      'actor subject',
      (c: ReceiptClaims) => {
        c.actor.subject = `${workspace}:someone_else`;
      },
      'ACTOR_BINDING_MISMATCH',
    ],
    [
      'renderer',
      (c: ReceiptClaims) => {
        (c.surface as { renderer_version: string }).renderer_version = 'future';
      },
      'UNSUPPORTED_RENDERER',
    ],
    [
      'assurance',
      (c: ReceiptClaims) => {
        (c.actor as { assurance: string }).assurance = 'verified_email';
      },
      'UNSUPPORTED_ACTOR',
    ],
    [
      'return channel',
      (c: ReceiptClaims) => {
        (c.return_binding as { return_channel_id: string | null }).return_channel_id = 'ret_other';
      },
      'RETURN_BINDING_MISMATCH',
    ],
    [
      'accepted time',
      (c: ReceiptClaims) => {
        c.accepted_at = new Date(now - 2000).toISOString();
      },
      'ACCEPTED_TIME_MISMATCH',
    ],
    [
      'issue time',
      (c: ReceiptClaims) => {
        c.iat -= 1;
      },
      'ACCEPTED_TIME_MISMATCH',
    ],
    [
      'expired',
      (c: ReceiptClaims) => {
        c.exp = Math.floor(now / 1000);
      },
      'RECEIPT_EXPIRED',
    ],
    [
      'unsupported version',
      (c: ReceiptClaims) => {
        (c as { sess_receipt: number }).sess_receipt = 2;
      },
      'UNSUPPORTED_RECEIPT_VERSION',
    ],
  ])('rejects correctly signed wrong %s', async (_name, change, code) => {
    const f = fixture();
    change(f.claims);
    await expect(
      verifyDecisionReceipt({ ...f.input, receipt: signClaims(f.claims) }, options),
    ).rejects.toMatchObject({ code });
  });

  it.each([
    'iss',
    'aud',
    'jti',
    'iat',
    'exp',
    'accepted_at',
    'workspace_id',
    'session_id',
    'step_id',
    'event_id',
    'surface',
    'action',
    'input_hash',
    'actor',
    'return_binding',
  ])('rejects missing required claim %s', async (name) => {
    const f = fixture();
    delete (f.claims as unknown as Record<string, unknown>)[name];
    await expect(
      verifyDecisionReceipt({ ...f.input, receipt: signClaims(f.claims) }, options),
    ).rejects.toMatchObject({ kind: 'receipt_verification' });
  });

  it.each([
    [{ alg: 'none', kid: 'rfc8032-test-1', typ: 'sess-receipt+jwt' }, 'UNSUPPORTED_ALGORITHM'],
    [{ alg: 'EdDSA', kid: 'rfc8032-test-1', typ: 'JWT' }, 'UNSUPPORTED_TYPE'],
    [{ alg: 'EdDSA', typ: 'sess-receipt+jwt' }, 'UNSUPPORTED_HEADER'],
    [
      { alg: 'EdDSA', kid: 'rfc8032-test-1', typ: 'sess-receipt+jwt', jku: 'https://untrusted.example/keys' },
      'UNSUPPORTED_HEADER',
    ],
    [
      { alg: 'EdDSA', kid: 'rfc8032-test-1', typ: 'sess-receipt+jwt', x5u: 'https://untrusted.example/cert' },
      'UNSUPPORTED_HEADER',
    ],
    [
      { alg: 'EdDSA', kid: 'rfc8032-test-1', typ: 'sess-receipt+jwt', crit: ['b64'], b64: true },
      'UNSUPPORTED_HEADER',
    ],
    ['{"alg":"EdDSA","kid":"other","kid":"rfc8032-test-1","typ":"sess-receipt+jwt"}', 'UNSUPPORTED_HEADER'],
  ])('rejects unsupported protected fields without key lookup', async (header, code) => {
    const f = fixture();
    const resolver = vi.fn(() => f.keys);
    const { keys: _keys, ...input } = f.input;
    await expect(
      verifyDecisionReceipt(
        { ...input, receipt: signClaims(f.claims, header), keyResolver: resolver },
        options,
      ),
    ).rejects.toMatchObject({ code });
    expect(resolver).not.toHaveBeenCalled();
  });

  it('rejects signature tampering without exposing signed material in error inspection', async () => {
    const f = fixture();
    const segments = f.input.receipt!.split('.');
    segments[2] = Buffer.alloc(64).toString('base64url');
    try {
      await verifyDecisionReceipt({ ...f.input, receipt: segments.join('.') }, options);
      throw new Error('unexpected');
    } catch (error) {
      expect(error).toMatchObject({ code: 'INVALID_SIGNATURE' });
      expect(inspect(error)).not.toContain(f.input.receipt);
      expect(JSON.stringify(error)).not.toContain('Café');
    }
  });

  it('requires canonical signed JSON, rejecting reordered, whitespace and duplicate payloads', async () => {
    const f = fixture();
    for (const payload of [
      JSON.stringify(f.claims),
      ` ${independentCanonical(f.claims)}`,
      independentCanonical(f.claims).replace('"sess_receipt":1', '"sess_receipt":1,"sess_receipt":1'),
    ]) {
      await expect(
        verifyDecisionReceipt({ ...f.input, receipt: signPayload(payload) }, options),
      ).rejects.toMatchObject({ code: 'NON_CANONICAL_PAYLOAD' });
    }
    await expect(
      verifyDecisionReceipt(
        { ...f.input, receipt: signPayload(`\ufeff${independentCanonical(f.claims)}`) },
        options,
      ),
    ).rejects.toMatchObject({ code: 'MALFORMED_RECEIPT' });
  });

  it('bounds receipt size and refuses legacy null or receipt-derived audience', async () => {
    const f = fixture();
    await expect(
      verifyDecisionReceipt({ ...f.input, receipt: `${'A'.repeat(65536)}.a.b` }, options),
    ).rejects.toMatchObject({ code: 'MALFORMED_RECEIPT' });
    await expect(verifyDecisionReceipt({ ...f.input, receipt: null }, options)).rejects.toMatchObject({
      code: 'LEGACY_RECEIPT_UNAVAILABLE',
    });
    await expect(
      verifyDecisionReceipt({ ...f.input, audience: undefined as unknown as string }, options),
    ).rejects.toMatchObject({ code: 'VERIFICATION_CONTEXT_MISSING' });
  });

  it('never gives expiry an issued-time grace, and bounds future issuance', async () => {
    const past = fixture(now - 1000);
    past.claims.exp = Math.floor(now / 1000);
    await expect(
      verifyDecisionReceipt({ ...past.input, receipt: signClaims(past.claims) }, options),
    ).rejects.toMatchObject({ code: 'RECEIPT_EXPIRED' });
    const future = fixture(now + 60_001);
    await expect(verifyDecisionReceipt(future.input, options)).rejects.toMatchObject({
      code: 'RECEIPT_FROM_FUTURE',
    });
    await expect(verifyDecisionReceipt(fixture(now + 59_000).input, options)).resolves.toMatchObject({
      sess_receipt: 1,
    });
    await expect(
      verifyDecisionReceipt(past.input, { ...options, issuedAtToleranceSeconds: 61 }),
    ).rejects.toMatchObject({ code: 'INVALID_VERIFICATION_OPTIONS' });
  });

  it('hashes the full immutable interaction including description and preserves Unicode/numbers', async () => {
    const f = fixture();
    f.input.interaction.description = 'changed';
    await expect(verifyDecisionReceipt(f.input, options)).rejects.toMatchObject({
      code: 'SURFACE_HASH_MISMATCH',
    });
    const g = fixture();
    (g.input.input.metadata as { unicode: string }).unicode = 'e\u0301🦉';
    await expect(verifyDecisionReceipt(g.input, options)).rejects.toMatchObject({
      code: 'INPUT_HASH_MISMATCH',
    });
  });

  it('snapshots all caller data and key sets before asynchronous lookup and protects nested results', async () => {
    const f = fixture();
    const gate = deferred<ReceiptKeySet>();
    const { keys: _keys, ...input } = f.input;
    const pending = verifyDecisionReceipt({ ...input, keyResolver: () => gate.promise }, options);
    input.input.amount = 999;
    input.interaction.actions[0]!.label = 'changed after start';
    input.expected.actionId = 'approve';
    gate.resolve(f.keys);
    const verified = await pending;
    expect(verified.action.label).toBe('Submit review');
    expect(Object.isFrozen(verified)).toBe(true);
    expect(Object.isFrozen(verified.action)).toBe(true);
    expect(() => {
      (verified.action as { label: string }).label = 'mutated';
    }).toThrow();
    expect(Object.isFrozen(input.input)).toBe(false);
    expect(Object.isFrozen(input.interaction)).toBe(false);
  });

  it('cancels an awaited resolver without leaking its error data', async () => {
    const f = fixture();
    const controller = new AbortController();
    const { keys: _keys, ...input } = f.input;
    const pending = verifyDecisionReceipt(
      { ...input, keyResolver: () => new Promise(() => {}) },
      { ...options, signal: controller.signal },
    );
    controller.abort(new Error('private application failure'));
    await expect(pending).rejects.toMatchObject({ kind: 'aborted' });
  });

  it.each(['sync', 'async'])('sanitizes a forged SessError from a %s key resolver', async (mode) => {
    const f = fixture();
    const { keys: _keys, ...input } = f.input;
    const sensitive = 'private upstream receipt-key failure';
    const external = new SessError('unknown_outcome', sensitive, {
      code: 'PRIVATE_UPSTREAM_CODE',
      outcome: 'unknown',
    });
    const keyResolver = () => {
      if (mode === 'async') return Promise.reject(external);
      throw external;
    };
    const failure = await verifyDecisionReceipt({ ...input, keyResolver }, options).catch((error) => error);
    expect(failure).toMatchObject({ kind: 'receipt_verification', code: 'KEY_RESOLUTION_FAILED' });
    expect(failure).not.toBe(external);
    expect(failure.outcome).toBeUndefined();
    expect(failure.cause).toBeUndefined();
    for (const rendered of [String(failure), inspect(failure), JSON.stringify(failure), failure.stack]) {
      expect(rendered).not.toContain(sensitive);
      expect(rendered).not.toContain('PRIVATE_UPSTREAM_CODE');
    }
  });

  it('preserves an actual verification deadline without forwarding its private abort reason', async () => {
    const f = fixture();
    const controller = new AbortController();
    const { keys: _keys, ...input } = f.input;
    const pending = verifyDecisionReceipt(
      { ...input, keyResolver: () => new Promise(() => {}) },
      { ...options, signal: controller.signal },
    );
    controller.abort(new SessError('timeout', 'private deadline reason'));
    const failure = await pending.catch((error) => error);
    expect(failure).toMatchObject({ kind: 'timeout' });
    expect(inspect(failure)).not.toContain('private deadline reason');
    expect(failure.cause).toBeUndefined();
  });
});

describe('public verification keys and JSON boundaries', () => {
  it.each([
    (keys: ReceiptKeySet) => ({ keys: [keys.keys[0], keys.keys[0]] }),
    (keys: ReceiptKeySet) => ({ keys: [{ ...keys.keys[0], d: 'private-material' }] }),
    (keys: ReceiptKeySet) => ({ keys: [{ ...keys.keys[0], crv: 'Ed448' }] }),
    (keys: ReceiptKeySet) => ({ keys: [{ ...keys.keys[0], alg: 'RS256' }] }),
    (keys: ReceiptKeySet) => ({ keys: [{ ...keys.keys[0], use: 'enc' }] }),
    (keys: ReceiptKeySet) => ({ keys: [{ ...keys.keys[0], key_ops: ['sign'] }] }),
    (keys: ReceiptKeySet) => ({ keys: [{ ...keys.keys[0], key_ops: ['verify', 'verify'] }] }),
    (keys: ReceiptKeySet) => ({ keys: [{ ...keys.keys[0], x: 'A'.repeat(42) }] }),
    (keys: ReceiptKeySet) => ({
      keys: Array.from({ length: 65 }, (_, i) => ({ ...keys.keys[0], kid: `key${i}` })),
    }),
  ])('rejects invalid, duplicate, private or incompatible key sets', async (change) => {
    const f = fixture();
    await expect(
      verifyDecisionReceipt({ ...f.input, keys: change(f.keys) as ReceiptKeySet }, options),
    ).rejects.toMatchObject({ kind: 'receipt_verification' });
  });

  it('rejects an unknown key without fallback and validates resolver result snapshots', async () => {
    const f = fixture();
    const keys: ReceiptKeySet = { keys: [{ ...f.keys.keys[0]!, kid: 'unrelated' }] };
    await expect(verifyDecisionReceipt({ ...f.input, keys }, options)).rejects.toMatchObject({
      code: 'UNKNOWN_KEY_ID',
    });
  });

  it('matches an independent fixed canonical string and digest', () => {
    const value = { z: [1e30, 4.5, 0.002, 1e-27, -0], a: 'é🦉', '\r': 'line', '1': true };
    const expected = '{"\\r":"line","1":true,"a":"é🦉","z":[1e+30,4.5,0.002,1e-27,0]}';
    expect(canonicalJson(value)).toBe(expected);
    expect(jsonDigest(value)).toBe(`sha256:${createHash('sha256').update(expected).digest('hex')}`);
  });

  it('retains prototype-related keys as ordinary data and rejects coercion/accessors/cycles', () => {
    const value = JSON.parse('{"__proto__":{"polluted":true},"constructor":"data"}');
    const copy = snapshotJson(value);
    expect(Object.hasOwn(copy, '__proto__')).toBe(true);
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
    const getter = vi.fn(() => 'private');
    const accessor = Object.defineProperty({}, 'value', { enumerable: true, get: getter });
    for (const bad of [
      NaN,
      Infinity,
      BigInt(1),
      [undefined],
      Array(1),
      { value: undefined },
      { bad: '\ud800' },
      new Date(),
      accessor,
    ]) {
      expect(() => snapshotJson(bad)).toThrow();
    }
    expect(getter).not.toHaveBeenCalled();
    const cycle: unknown[] = [];
    cycle.push(cycle);
    expect(() => snapshotJson(cycle)).toThrow();
  });
});
