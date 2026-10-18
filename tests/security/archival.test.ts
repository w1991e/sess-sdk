// The successor archival verifier (archival-core-v1 §5) against the shared archival-v1 corpus.
// tests/fixtures/archival/archival-v1-corpus.json is the Sess evidence package's frozen corpus,
// verbatim and pinned by digest and Sess commit (docs/spec/source.json, scripts/check-spec.mjs).
// Every vector is rebuilt byte for byte here, checked against its frozen digests, then verified
// with nothing but the corpus public key: the SDK must reach exactly the dimensions and messages
// the Sess core reaches. verifyDecisionReceipt and verifyDecisionBundle stay unchanged.
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { CompactSign } from 'jose';
import { describe, expect, it } from 'vitest';
import * as archival from '../../src/archival/index.js';
import { presentArchivalVerification, verifyArchivalEnvelope } from '../../src/archival/index.js';
import { parseArchivalCore } from '../../src/archival/core.js';
import * as receipts from '../../src/receipts/index.js';
import { verifyDecisionBundle } from '../../src/receipts/index.js';
import { ReceiptV1Failure, verifyReceiptV1 } from '../../src/receipts/bundle.js';
import {
  archivalEnvelope,
  buildArchivalCore,
  buildReceipt,
  type CorpusVectors,
  corpusVectors,
  CORPUS_KEY_LABEL,
  derivedKey,
  frozenCorpus,
  inputText,
  publicJwkOf,
  type ReceiptInput,
  signArchivalCore,
  signReceipt,
  summary,
  vectorDigests,
} from '../fixtures/archival/corpus-vectors.js';
import { canonicalJson } from '../../src/receipts/json.js';

interface FrozenCase {
  name: string;
  vector: Record<string, { sha256: string; byte_length: number }>;
  padding?: number;
  options: { now: string; content?: 'disclosed' | 'altered'; context?: archival.ExpectedArchivalContext };
  expect: Record<string, unknown>;
}
interface Frozen {
  format: string;
  version: number;
  keys: ReturnType<typeof publicJwkOf>[];
  content: Record<'disclosed' | 'altered', { surface: unknown; input: unknown }>;
  receipt_v1: {
    jws: { sha256: string; byte_length: number };
    issuer: string;
    audience: string;
    claims_digest: string;
    valid_at: string;
    expired_at: string;
  };
  core_text: string;
  cases: FrozenCase[];
}

const frozen = JSON.parse(
  readFileSync(new URL('../fixtures/archival/archival-v1-corpus.json', import.meta.url), 'utf8'),
) as Frozen;

let rebuilt: Promise<CorpusVectors> | undefined;
const vectors = () => (rebuilt ??= corpusVectors());
const trustedKeys = () => ({ keys: frozen.keys });
const sha256 = (s: string) => `sha256:${createHash('sha256').update(s).digest('hex')}`;

describe('archival verifier: the shared archival-v1 corpus', () => {
  it('rebuilds every vector byte for byte and reaches every frozen dimension and message with only the corpus public key', async () => {
    const v = await vectors();
    expect(frozen.format).toBe('sess.archival-corpus');
    expect(frozen.keys.every((k) => !('d' in k))).toBe(true);
    // The whole frozen document is exactly what the rebuilt vectors produce.
    expect(frozenCorpus(v)).toEqual(frozen);
    expect(frozen.cases.length).toBe(23);
    for (const [i, c] of frozen.cases.entries()) {
      const built = v.cases[i];
      if (!built) throw new Error(`no rebuilt vector for ${c.name}`);
      expect(vectorDigests(built.input), c.name).toEqual(c.vector);
      const text =
        c.padding === undefined ? inputText(built.input) : inputText(built.input) + ' '.repeat(c.padding);
      const options = {
        trustedKeys: trustedKeys(),
        now: new Date(c.options.now),
        ...(c.options.content ? { content: frozen.content[c.options.content] } : {}),
        ...(c.options.context ? { expectedContext: c.options.context } : {}),
      };
      // The value, its JSON text and its UTF-8 bytes (what the CLI reads) reach one result.
      const inputs: unknown[] = [
        c.padding === undefined ? built.input : text,
        text,
        new TextEncoder().encode(text),
      ];
      const results = await Promise.all(inputs.map((input) => verifyArchivalEnvelope(input, options)));
      for (const r of results) expect(summary(r), c.name).toEqual(c.expect);
      expect(results[1], c.name).toEqual(results[2]);
    }
  });

  it('the corpus core is the canonical core of the frozen receipt-v1 vector', async () => {
    const v = await vectors();
    expect(sha256(v.receiptV1.jws)).toBe(frozen.receipt_v1.jws.sha256);
    expect(Buffer.byteLength(v.receiptV1.jws)).toBe(frozen.receipt_v1.jws.byte_length);
    const positive = v.cases[0]?.input as { receipt: string; signed_core: { core: unknown } };
    expect(positive.receipt).toBe(v.receiptV1.jws);
    expect(canonicalJson(buildArchivalCore(v.receiptV1.jws, 1))).toBe(frozen.core_text);
    expect(canonicalJson(positive.signed_core.core)).toBe(frozen.core_text);
  });

  it('the frozen receipt-v1 vector keeps its receipt-v1 result, current-time expiry included, and verifyDecisionBundle is unchanged', async () => {
    const v = await vectors();
    const f = frozen.receipt_v1;
    const claims = await verifyReceiptV1(v.receiptV1.jws, trustedKeys(), {
      issuer: f.issuer,
      audience: f.audience,
      now: new Date(f.valid_at),
    });
    expect(sha256(canonicalJson(claims))).toBe(f.claims_digest);
    const code = (opts: { issuer: string; audience: string; now: Date }) =>
      verifyReceiptV1(v.receiptV1.jws, trustedKeys(), opts).then(
        () => 'verified',
        (e: unknown) => (e as ReceiptV1Failure).code,
      );
    // This vector expired in 2026-02: current-time verification refuses it.
    expect(await code({ issuer: f.issuer, audience: f.audience, now: new Date() })).toBe('expired');
    expect(await code({ issuer: f.issuer, audience: f.audience, now: new Date(f.expired_at) })).toBe(
      'expired',
    );
    expect(
      await code({ issuer: 'https://other.example', audience: f.audience, now: new Date(f.valid_at) }),
    ).toBe('issuer');
    expect(await code({ issuer: f.issuer, audience: 'wks_other', now: new Date(f.valid_at) })).toBe(
      'audience',
    );
    // The same receipt as a bundle-v1 decision bundle: valid then, expired now.
    const bundle = {
      type: 'sess.decision-bundle',
      version: 1,
      receipt: v.receiptV1.jws,
      content: frozen.content.disclosed,
      keys: { keys: frozen.keys },
    };
    const then = await verifyDecisionBundle(bundle, {
      issuer: f.issuer,
      trustedKeys: trustedKeys(),
      now: new Date(f.valid_at),
    });
    expect(then).toMatchObject({ valid: true, content: 'verified' });
    const today = await verifyDecisionBundle(bundle, { issuer: f.issuer, trustedKeys: trustedKeys() });
    expect(today).toMatchObject({ valid: false, reason: 'expired' });
  });

  it('adds a separately named subpath; the receipts exports are unchanged', () => {
    expect(Object.keys(receipts).sort()).toEqual([
      'BUNDLE_LIMITS',
      'verifyDecisionBundle',
      'verifyDecisionReceipt',
    ]);
    expect(Object.keys(archival).sort()).toEqual([
      'ARCHIVAL_CONTENT_MAX_BYTES',
      'ARCHIVAL_ENVELOPE_MAX_BYTES',
      'TrustedRootError',
      'WITNESS_ANCHORS_INVALID',
      'WitnessKeySetError',
      'checkWitnessAnchors',
      'parseTrustedRoot',
      'parseWitnessKeySet',
      'presentArchivalVerification',
      'verifyArchivalEnvelope',
    ]);
  });
});

describe('archival verifier: result object and trust', () => {
  it('reports the full result: checked time, caller-supplied key set and its observation time, expiry, core and claims', async () => {
    const v = await vectors();
    const observed = new Date('2026-01-19T08:00:00.000Z');
    const r = await verifyArchivalEnvelope(v.cases[0]?.input, {
      trustedKeys: trustedKeys(),
      now: new Date('2026-01-20T00:00:00.000Z'),
      keySetObservedAt: observed,
      content: frozen.content.disclosed,
      expectedContext: {
        issuer: 'https://api.sess.example',
        audience: 'wks_corpus',
        session_id: 'ses_corpus_1',
      },
    });
    expect(r).toMatchObject({
      checked_at: '2026-01-20T00:00:00.000Z',
      signature: { status: 'valid', reason: 'verified' },
      contents: { status: 'valid', reason: 'verified' },
      context: {
        status: 'valid',
        reason: 'verified',
        checked: ['issuer', 'audience', 'session_id'],
        mismatched: [],
      },
      witness: { status: 'pending', reason: 'unwitnessed' },
      key_trust: {
        status: 'valid',
        reason: 'trusted',
        key_set: 'caller_supplied',
        key_set_observed_at: observed.toISOString(),
      },
      live_expiry: { status: 'valid', reason: 'unexpired', expires_at: '2026-02-04T09:31:00.000Z' },
    });
    expect(canonicalJson(r.core)).toBe(frozen.core_text);
    expect(r.claims?.event_id).toBe('evt_corpus_1');
    expect(presentArchivalVerification(r)).toEqual({
      verified: true,
      messages: ['signature_verified', 'contents_verified'],
      refusal: null,
      witness: 'pending',
      expired_for_live_use: false,
    });
    // Only issuer and audience together make the context verified; a subset is incomplete.
    const partial = await verifyArchivalEnvelope(v.cases[0]?.input, {
      trustedKeys: trustedKeys(),
      expectedContext: { session_id: 'ses_corpus_1' },
    });
    expect(partial.context).toEqual({
      status: 'unverifiable',
      reason: 'incomplete',
      checked: ['session_id'],
      mismatched: [],
    });
    // A refusal carries no core and no claims, and names the dimension and reason.
    const refused = await verifyArchivalEnvelope(v.cases[5]?.input, { trustedKeys: trustedKeys() });
    expect(refused).toMatchObject({ core: null, claims: null, live_expiry: { expires_at: null } });
    expect(presentArchivalVerification(refused)).toEqual({
      verified: false,
      messages: [],
      refusal: { dimension: 'signature', reason: 'core_signature' },
      witness: 'unverifiable',
      expired_for_live_use: null,
    });
  });

  it('checks the receipt against the core: a core naming other claims, an unreadable receipt, a receipt under an untrusted or unsupported key', async () => {
    const key = derivedKey(CORPUS_KEY_LABEL, 'corpus-2026-01');
    const other = derivedKey('sdk archival test: another issuer key', 'other-2026-01');
    const input: ReceiptInput = {
      issuer: 'https://api.sess.example',
      workspaceId: 'wks_corpus',
      sessionId: 'ses_corpus_2',
      stepId: 'rev_1',
      eventId: 'evt_corpus_2',
      surface: { revision: 1, document: { title: 'T' }, rendererVersion: 'renderer@0.0.0' },
      action: { id: 'approve', label: 'Approve', summary: '' },
      input: { approved: true },
      actor: { assurance: 'link_holder', subject: 'human_link:ses_corpus_2' },
      acceptedAt: new Date('2026-01-05T09:30:00.250Z'),
      expiresAt: new Date('2036-01-05T09:30:00.000Z'),
      recipient: { audience: 'wks_corpus', returnChannelId: null },
    };
    const receipt = await signReceipt(buildReceipt(input), key);
    const verify = (envelope: unknown) => verifyArchivalEnvelope(envelope, { trustedKeys: trustedKeys() });

    // The core is signed and names the receipt's bytes, but states another event.
    const core = buildArchivalCore(receipt, 4);
    const lying = parseArchivalCore({ ...core, event_id: 'evt_corpus_other' });
    const mismatch = await verify(archivalEnvelope(receipt, signArchivalCore(lying, key)));
    expect(summary(mismatch)).toMatchObject({
      signature: 'invalid:core_receipt_mismatch',
      key_trust: 'valid:trusted',
    });

    // Bytes the core names that are not a readable compact JWS.
    const garbage = 'not.a.receipt';
    const garbageCore = parseArchivalCore({
      ...core,
      receipt: { ...core.receipt, digest: sha256(garbage), byte_length: garbage.length },
    });
    const unreadable = await verify(archivalEnvelope(garbage, signArchivalCore(garbageCore, key)));
    expect(summary(unreadable)).toMatchObject({
      signature: 'invalid:receipt_malformed',
      key_trust: 'valid:trusted',
    });

    // The core key is trusted but the receipt was signed by a key the caller does not trust.
    const foreign = await signReceipt(buildReceipt(input), other);
    const untrusted = await verify(
      archivalEnvelope(foreign, signArchivalCore(buildArchivalCore(foreign, 4), key)),
    );
    expect(summary(untrusted)).toMatchObject({
      signature: 'unverifiable:untrusted_key',
      key_trust: 'unverifiable:unknown_kid',
      verified: false,
    });
    // Trusting that key too: the receipt verifies (rotation overlap: retained keys stay usable).
    const both = await verifyArchivalEnvelope(
      archivalEnvelope(foreign, signArchivalCore(buildArchivalCore(foreign, 4), key)),
      { trustedKeys: { keys: [...frozen.keys, publicJwkOf(other)] } },
    );
    expect(summary(both)).toMatchObject({ signature: 'valid:verified', verified: true });

    // A receipt under another algorithm is unsupported.
    const hs = await new CompactSign(new TextEncoder().encode(canonicalJson(buildReceipt(input))))
      .setProtectedHeader({ alg: 'HS256', kid: key.kid, typ: 'sess-receipt+jwt' })
      .sign(createHash('sha256').update('sdk archival test hs256').digest());
    const unsupported = await verify(archivalEnvelope(hs, signArchivalCore(buildArchivalCore(hs, 4), key)));
    expect(summary(unsupported)).toMatchObject({ signature: 'unsupported:unsupported_algorithm' });

    // The right signature in a non-canonical encoding (padded base64url) is malformed, not valid.
    const signed = signArchivalCore(core, key);
    const padded = await verify({
      ...JSON.parse(JSON.stringify(archivalEnvelope(receipt, signed))),
      signed_core: { ...signed, signature: { ...signed.signature, value: `${signed.signature.value}=` } },
    });
    expect(summary(padded)).toMatchObject({ signature: 'invalid:malformed' });
    expect(summary(await verify(archivalEnvelope(receipt, signed)))).toMatchObject({ verified: true });
  });

  it('never throws for hostile envelopes; only invalid options throw a TypeError', async () => {
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    for (const input of [
      undefined,
      null,
      0,
      'x'.repeat(70_000),
      [],
      {},
      cyclic,
      10n,
      new Uint8Array([0xff, 0xfe, 0x00]),
      { type: 'sess.archival-envelope', version: 1, receipt: 'a', signed_core: null, evidence: [] },
    ]) {
      const r = await verifyArchivalEnvelope(input, { trustedKeys: trustedKeys() });
      expect(['invalid', 'unsupported']).toContain(r.signature.status);
      expect(presentArchivalVerification(r).verified).toBe(false);
    }
    const v = await vectors();
    const envelope = v.cases[0]?.input;
    const bad: unknown[] = [
      undefined,
      null,
      {},
      { trustedKeys: { keys: [] } },
      { trustedKeys: { keys: [{ ...frozen.keys[0], d: Buffer.alloc(32).toString('base64url') }] } },
      { trustedKeys: trustedKeys(), now: 'today' },
      { trustedKeys: trustedKeys(), now: new Date(Number.NaN) },
      { trustedKeys: trustedKeys(), keySetObservedAt: 1 },
      { trustedKeys: trustedKeys(), expectedContext: { tenant: 'x' } },
      { trustedKeys: trustedKeys(), expectedContext: { audience: '' } },
      { trustedKeys: trustedKeys(), expectedContext: { surface_revision: 0 } },
      { trustedKeys: trustedKeys(), content: { surface: {} } },
      { trustedKeys: trustedKeys(), witnessAnchors: {} },
      { trustedKeys: trustedKeys(), witnessAnchors: { trustedRoot: { tlogs: [] }, witnessKeys: [] } },
    ];
    for (const options of bad)
      await expect(
        verifyArchivalEnvelope(envelope, options as Parameters<typeof verifyArchivalEnvelope>[1]),
      ).rejects.toThrow(TypeError);
  });
});

// archival-core-v1 §2: a Session created for an Invocation binds its target and capability (at the
// admission target version); owner stays null. Ported from the Sess core's verifier tests.
describe('archival verifier: non-null bindings', () => {
  it('a core carrying the target and capability bindings of an Invocation verifies on every dimension and keeps them; changing a bound version breaks the core signature', async () => {
    const v = await vectors();
    const original = v.cases[0]?.input as { receipt: string };
    const key = derivedKey(CORPUS_KEY_LABEL, 'corpus-2026-01');
    const now = new Date('2026-01-20T00:00:00.000Z');
    for (const bindings of [
      { target: { id: 'tgt_01JABCDEFGHJKMNPQRSTVWXYZ0', version: 2 }, capability: null, owner: null },
      {
        target: { id: 'tgt_01JABCDEFGHJKMNPQRSTVWXYZ0', version: 4 },
        capability: { id: 'weekend.plan', version: 4 },
        owner: null,
      },
    ]) {
      const core = buildArchivalCore(original.receipt, 1, bindings);
      const envelope = archivalEnvelope(original.receipt, signArchivalCore(core, key));
      const r = await verifyArchivalEnvelope(JSON.stringify(envelope), {
        trustedKeys: trustedKeys(),
        now,
        content: frozen.content.disclosed,
        expectedContext: { issuer: 'https://api.sess.example', audience: 'wks_corpus' },
      });
      expect([r.signature, r.contents, r.context, r.key_trust].map((d) => `${d.status}:${d.reason}`)).toEqual(
        ['valid:verified', 'valid:verified', 'valid:verified', 'valid:trusted'],
      );
      expect(r.core?.bindings).toEqual(bindings);
      // The bindings are signed: a changed version breaks the core signature.
      const altered = JSON.parse(JSON.stringify(envelope)) as {
        signed_core: { core: { bindings: Record<string, { version: number } | null> } };
      };
      const bound = altered.signed_core.core.bindings[bindings.capability ? 'capability' : 'target'];
      if (!bound) throw new Error('no bound version to alter');
      bound.version += 1;
      const t = await verifyArchivalEnvelope(altered, { trustedKeys: trustedKeys(), now });
      expect([t.signature.status, t.signature.reason]).toEqual(['invalid', 'core_signature']);
    }
  });
});
