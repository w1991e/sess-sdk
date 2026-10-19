// Witness evidence version 1 in the successor archival verifier (docs/spec/witness-evidence-v1.md
// §5). Three sources, each with the Sess core's expectations:
//
//   - the pinned recorded Sigstore staging run (tests/fixtures/archival/sigstage-run.json, verbatim
//     from Sess): a real RFC 3161 token and real Rekor v2 and v1 entries verify offline through the
//     ported part verifier, against the run's trusted root only;
//   - the pinned renewal vector (tests/fixtures/archival/renewal-vector.der, verbatim from Sess):
//     the RFC 4998 chain rules at fixed times;
//   - synthetic batches (fixtures/archival/witness-synthetic.ts, ported from Sess's synthetic
//     Sigstore): witnessed, pending, indeterminate, invalid and unsupported evidence through the
//     envelope, with anchors from the caller only, including their published JSON forms.
//
// No network: every anchor is in memory or a pinned file.
import { createHash, generateKeyPairSync } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { beforeAll, describe, expect, it } from 'vitest';
import {
  checkWitnessAnchors,
  parseTrustedRoot,
  parseWitnessKeySet,
  presentArchivalVerification,
  type TrustedTsa,
  verifyArchivalEnvelope,
  WITNESS_ANCHORS_INVALID,
  type WitnessAnchors,
  WitnessKeySetError,
} from '../../src/archival/index.js';
import type { SignedArchivalCore } from '../../src/archival/core.js';
import { children, expect as expectDer, parseDer, TAG } from '../../src/archival/witness/der.js';
import { verifyWitnessEvidence } from '../../src/archival/witness/evidence.js';
import type { BatchOpening } from '../../src/archival/witness/opening.js';
import { verifyWitnessParts } from '../../src/archival/witness/parts.js';
import { verifyRenewalChain } from '../../src/archival/witness/renewal.js';
import type { TlogEntry } from '../../src/archival/witness/rekor.js';
import { verifyTimestampToken } from '../../src/archival/witness/tsa.js';
import {
  archivalEnvelope,
  buildArchivalCore,
  buildReceipt,
  CORPUS_KEY_LABEL,
  corpusTrustedKeys,
  corpusVectors,
  derivedKey,
  signArchivalCore,
  signReceipt,
} from '../fixtures/archival/corpus-vectors.js';
import {
  b64,
  commitBatch,
  sha256,
  signCheckpoint,
  syntheticTsa,
  trustedRootJson,
  type WitnessEvidenceEntry,
  type WitnessedBatch,
  witnessBatch,
  witnessKeyPair,
  witnessKeySetJson,
} from '../fixtures/archival/witness-synthetic.js';

const ISSUER = 'https://api.sess.example';
const copy = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;
const flip = (b: Uint8Array, i: number) => {
  b[i] = (b[i] as number) ^ 1;
  return b;
};

/** `n` envelopes of distinct receipts, their cores signed by the corpus key. */
async function envelopes(n: number) {
  const key = derivedKey(CORPUS_KEY_LABEL, 'corpus-2026-01');
  const out = [];
  for (let i = 0; i < n; i++) {
    const receipt = await signReceipt(
      buildReceipt({
        issuer: ISSUER,
        workspaceId: 'wks_corpus',
        sessionId: `ses_witness_${i}`,
        stepId: 'rev_1',
        eventId: `evt_witness_${i}`,
        surface: { revision: 1, document: { title: 'Witness' }, rendererVersion: 'renderer@0.0.0' },
        action: { id: 'approve', label: 'Approve', summary: '' },
        input: { n: i },
        actor: { assurance: 'link_holder', subject: `human_link:ses_witness_${i}` },
        acceptedAt: new Date(Date.now() - 60_000),
        expiresAt: new Date(Date.now() + 30 * 86_400_000),
        recipient: { audience: 'wks_corpus', returnChannelId: null },
      }),
      key,
    );
    out.push(archivalEnvelope(receipt, signArchivalCore(buildArchivalCore(receipt, i + 1), key)));
  }
  return out;
}

interface Witnessed extends WitnessedBatch {
  cores: SignedArchivalCore[];
  envelopes: Awaited<ReturnType<typeof envelopes>>;
  anchors: WitnessAnchors;
}

async function witnessed(n: number): Promise<Witnessed> {
  const envs = await envelopes(n);
  const cores = envs.map((e) => e.signed_core);
  const batch = witnessBatch(cores);
  return {
    ...batch,
    cores,
    envelopes: envs,
    anchors: { trustedRoot: batch.trustedRoot, witnessKeys: [batch.key.trusted] },
  };
}

const verifyEntry = (w: Witnessed, entry: unknown, i = 0, anchors: WitnessAnchors | undefined = w.anchors) =>
  verifyWitnessEvidence(entry, w.cores[i] as SignedArchivalCore, anchors, new Date());
const trusted = () => ({ trustedKeys: corpusTrustedKeys() });

describe('witness evidence through the archival envelope', () => {
  let w: Witnessed;
  beforeAll(async () => {
    w = await witnessed(5);
  });

  it('every member of a version 1 batch is witnessed at the TSA time; each entry proves only its own core', () => {
    expect(w.treeSize).toBe(8);
    for (const [i] of w.cores.entries()) {
      const r = verifyEntry(w, w.evidence[i], i);
      expect(r).toMatchObject({ status: 'witnessed', renewedAt: null, logUrl: 'https://log.synthetic.test' });
      if (r.status === 'witnessed') expect(r.witnessedAt.toISOString()).toBe(w.witnessedAt.toISOString());
      expect(verifyEntry(w, w.evidence[i], (i + 1) % 5)).toEqual({ status: 'invalid', reason: 'opening' });
    }
  });

  it('witnessed with caller anchors, indeterminate without them, pending without evidence; detaching changes only the witness', async () => {
    const envelope = { ...copy(w.envelopes[0]), evidence: [w.evidence[0]] };
    const now = new Date();
    const r = await verifyArchivalEnvelope(envelope, { ...trusted(), now, witnessAnchors: w.anchors });
    expect(r.signature).toEqual({ status: 'valid', reason: 'verified' });
    expect(r.witness).toEqual({
      status: 'witnessed',
      reason: 'verified',
      witnessed_at: w.witnessedAt.toISOString(),
    });
    expect(presentArchivalVerification(r)).toMatchObject({ verified: true, witness: 'witnessed' });
    const bare = await verifyArchivalEnvelope(envelope, { ...trusted(), now });
    expect(bare.witness).toEqual({ status: 'indeterminate', reason: 'witness_trust_unavailable' });
    const pending = await verifyArchivalEnvelope(w.envelopes[0], {
      ...trusted(),
      now,
      witnessAnchors: w.anchors,
    });
    expect(pending.witness).toEqual({ status: 'pending', reason: 'unwitnessed' });
    const strip = (x: typeof r) => ({ ...x, witness: null, checked_at: null });
    expect(strip(pending)).toEqual(strip(r));
    const swapped = await verifyArchivalEnvelope(
      { ...envelope, evidence: [w.evidence[1]] },
      { ...trusted(), now, witnessAnchors: w.anchors },
    );
    expect(swapped.witness).toEqual({ status: 'invalid', reason: 'invalid_evidence', detail: 'opening' });
    const mixed = await verifyArchivalEnvelope(
      { ...envelope, evidence: [{ type: 'example.other' }, w.evidence[0]] },
      { ...trusted(), now, witnessAnchors: w.anchors },
    );
    expect(mixed.witness.status).toBe('witnessed');
  });

  it('reads the anchors from their published forms: Sigstore trusted_root.json and the issuer witness key set', async () => {
    const anchors: WitnessAnchors = {
      trustedRoot: parseTrustedRoot(trustedRootJson(w.trustedRoot)),
      witnessKeys: parseWitnessKeySet(JSON.parse(witnessKeySetJson(ISSUER, [w.key.trusted])), ISSUER),
    };
    expect(anchors).toEqual(w.anchors);
    const envelope = { ...copy(w.envelopes[2]), evidence: [w.evidence[2]] };
    const r = await verifyArchivalEnvelope(envelope, { ...trusted(), witnessAnchors: anchors });
    expect(r.witness.status).toBe('witnessed');
    expect(() =>
      parseWitnessKeySet(JSON.parse(witnessKeySetJson(ISSUER, [w.key.trusted])), 'https://other'),
    ).toThrow(WitnessKeySetError);
    const set = JSON.parse(witnessKeySetJson(ISSUER, [w.key.trusted]));
    for (const bad of [
      { ...set, extra: 1 },
      { ...set, version: 2 },
      { ...set, keys: [{ ...set.keys[0], key_id: `sha256:${'0'.repeat(64)}` }] },
      { ...set, keys: [{ ...set.keys[0], valid_to: '2019-01-01T00:00:00Z' }] },
      { ...set, keys: [set.keys[0], set.keys[0]] },
    ])
      expect(() => parseWitnessKeySet(bad)).toThrow(WitnessKeySetError);
  });

  it('malformed or failing evidence is invalid (never pending), untrusted anchors are indeterminate, another version is unsupported', async () => {
    const e = w.evidence[0] as WitnessEvidenceEntry;
    const edit = (f: (x: WitnessEvidenceEntry & Record<string, unknown>) => void) => {
      const x = copy(e) as WitnessEvidenceEntry & Record<string, unknown>;
      f(x);
      return x;
    };
    const malformed = { status: 'invalid', reason: 'malformed_evidence' };
    for (const bad of [
      null,
      'evidence',
      edit((x) => (x.extra = 1)),
      edit((x) => delete (x as Record<string, unknown>).renewals),
      edit((x) => (x.checkpoint.signature = '***')),
      edit((x) => (x.timestamp = { token: e.timestamp.token, at: 'now' } as never)),
      edit((x) => (x.tlog = { garbage: true } as never)),
      edit((x) => (x.trust_reference.trusted_root_digest = 'sha256:xyz')),
      edit(
        (x) =>
          (x.renewals = [
            { type: 'sess.witness-renewal', version: 1, hash_alg: 'md5', token: 'AA==' },
          ] as never),
      ),
    ])
      expect(verifyEntry(w, bad)).toEqual(malformed);
    expect(
      verifyEntry(
        w,
        edit((x) => (x.version = 2 as 1)),
      ),
    ).toEqual({
      status: 'unsupported',
      reason: 'unknown_evidence_version',
    });
    const sig = flip(
      Buffer.from(e.checkpoint.signature, 'base64'),
      Buffer.from(e.checkpoint.signature, 'base64').length - 1,
    );
    const badSig = edit((x) => (x.checkpoint.signature = Buffer.from(sig).toString('base64')));
    expect(verifyEntry(w, badSig)).toEqual({ status: 'invalid', reason: 'checkpoint_signature' });
    const token = Buffer.from(e.timestamp.token, 'base64');
    flip(token, token.length - 1);
    expect(
      verifyEntry(
        w,
        edit((x) => (x.timestamp.token = token.toString('base64'))),
      ),
    ).toMatchObject({
      status: 'invalid',
      reason: 'timestamp',
    });
    expect(
      verifyEntry(
        w,
        edit((x) => x.tlog.inclusionProof.hashes.pop()),
      ),
    ).toEqual({
      status: 'invalid',
      reason: 'tlog',
      detail: 'inclusion',
    });
    expect(
      verifyEntry(
        w,
        edit((x) => (x.opening.nonce = b64(new Uint8Array(32)))),
      ),
    ).toEqual({
      status: 'invalid',
      reason: 'checkpoint_root_mismatch',
    });
    expect(
      verifyEntry(
        w,
        edit((x) => (x.opening.path = ['x'])),
      ),
    ).toEqual({ status: 'invalid', reason: 'opening' });
    // A spike (version 0) part never stands in for a version 1 part.
    const core = w.cores[0] as SignedArchivalCore;
    const v0 = commitBatch([core], 0);
    expect(
      verifyEntry(
        w,
        edit((x) => (x.opening = v0.openings[0] as BatchOpening)),
      ),
    ).toEqual({
      status: 'invalid',
      reason: 'opening',
    });
    const v0cp = signCheckpoint(core.core.issuer, 7, w.root, w.treeSize, w.key.privateKey, 0);
    expect(
      verifyEntry(
        w,
        edit(
          (x) =>
            (x.checkpoint = {
              bytes: b64(v0cp.bytes),
              signature: b64(v0cp.signature),
              public_key: b64(v0cp.publicKey),
            }),
        ),
      ),
    ).toEqual({ status: 'invalid', reason: 'checkpoint_root_mismatch' });
    // Untrusted anchors: indeterminate, never invalid and never witnessed.
    const root = w.anchors.trustedRoot;
    expect(verifyEntry(w, e, 0, { ...w.anchors, witnessKeys: [] })).toEqual({
      status: 'indeterminate',
      reason: 'untrusted_witness_key',
    });
    expect(verifyEntry(w, e, 0, { ...w.anchors, trustedRoot: { ...root, tsas: [] } })).toEqual({
      status: 'indeterminate',
      reason: 'untrusted_tsa',
    });
    expect(verifyEntry(w, e, 0, { ...w.anchors, trustedRoot: { ...root, tlogs: [] } })).toEqual({
      status: 'indeterminate',
      reason: 'unknown_log',
    });
    expect(verifyWitnessEvidence(e, core, undefined, new Date())).toEqual({
      status: 'indeterminate',
      reason: 'witness_trust_unavailable',
    });
    // Its own trust reference is informational: pointing it elsewhere changes nothing.
    expect(
      verifyEntry(
        w,
        edit(
          (x) =>
            (x.trust_reference = {
              source: 'https://elsewhere.example',
              tuf_root_version: 99,
              trusted_root_digest: `sha256:${'0'.repeat(64)}`,
            }),
        ),
      ).status,
    ).toBe('witnessed');
    // Through the envelope: one failing entry makes the dimension invalid even beside a good one.
    const envelope = copy(w.envelopes[0]);
    const r = await verifyArchivalEnvelope(
      { ...envelope, evidence: [e, badSig] },
      { ...trusted(), witnessAnchors: w.anchors },
    );
    expect(r.witness).toEqual({
      status: 'invalid',
      reason: 'invalid_evidence',
      detail: 'checkpoint_signature',
    });
    const m = await verifyArchivalEnvelope(
      { ...envelope, evidence: [edit((x) => (x.extra = true))] },
      { ...trusted(), witnessAnchors: w.anchors },
    );
    expect(m.witness).toEqual({ status: 'invalid', reason: 'malformed_evidence' });
    const later = await verifyArchivalEnvelope(
      { ...envelope, evidence: [edit((x) => (x.version = 2 as 1))] },
      { ...trusted(), witnessAnchors: w.anchors },
    );
    expect(later.witness).toEqual({ status: 'unsupported', reason: 'unsupported_evidence' });
  });

  it('key rotation: a retired witness key verifies inside its window, is indeterminate once unlisted and invalid outside its window', () => {
    const e = w.evidence[0];
    const next = witnessKeyPair(new Date());
    const retired = { ...w.key.trusted, validTo: new Date(w.witnessedAt.getTime() + 1000) };
    expect(verifyEntry(w, e, 0, { ...w.anchors, witnessKeys: [retired, next.trusted] }).status).toBe(
      'witnessed',
    );
    expect(verifyEntry(w, e, 0, { ...w.anchors, witnessKeys: [next.trusted] })).toEqual({
      status: 'indeterminate',
      reason: 'untrusted_witness_key',
    });
    expect(
      verifyEntry(w, e, 0, {
        ...w.anchors,
        witnessKeys: [{ ...w.key.trusted, validTo: new Date(w.witnessedAt.getTime() - 1000) }],
      }),
    ).toEqual({ status: 'invalid', reason: 'outside_validity' });
  });

  it('renewal: a chain renewed before its TSA lapsed stays witnessed; an unrenewed chain past its lapse is indeterminate', async () => {
    const envs = await envelopes(1);
    const core = envs[0]?.signed_core as SignedArchivalCore;
    const batch = witnessBatch([core]);
    // The first TSA is valid for one more hour only; a second, longer-lived one renews it.
    const shortTsa = syntheticTsa({
      name: 'short',
      notBefore: new Date(Date.now() - 86_400_000),
      notAfter: new Date(Date.now() + 3_600_000),
    });
    const longTsa = syntheticTsa({ name: 'long' });
    const cp = Buffer.from(batch.evidence[0]?.checkpoint.signature as string, 'base64');
    const token = shortTsa.token(sha256(cp), batch.witnessedAt);
    const renewal = longTsa.token(sha256(token), new Date(Math.floor(Date.now() / 1000) * 1000));
    const entry = { ...copy(batch.evidence[0] as WitnessEvidenceEntry), timestamp: { token: b64(token) } };
    const renewed = {
      ...entry,
      renewals: [
        {
          type: 'sess.witness-renewal' as const,
          version: 1 as const,
          hash_alg: 'sha256' as const,
          token: b64(renewal),
        },
      ],
    };
    const anchors: WitnessAnchors = {
      trustedRoot: { tlogs: batch.trustedRoot.tlogs, tsas: [shortTsa.trusted(), longTsa.trusted()] },
      witnessKeys: [batch.key.trusted],
    };
    const later = new Date(Date.now() + 2 * 3_600_000);
    const verify = (evidence: unknown, now: Date) =>
      verifyArchivalEnvelope(
        { ...copy(envs[0]), evidence: [evidence] },
        { ...trusted(), now, witnessAnchors: anchors },
      );
    expect((await verify(entry, new Date())).witness.status).toBe('witnessed');
    expect((await verify(entry, later)).witness).toEqual({
      status: 'indeterminate',
      reason: 'renewal_lapsed',
    });
    expect((await verify(renewed, later)).witness).toEqual({
      status: 'witnessed',
      reason: 'verified',
      witnessed_at: batch.witnessedAt.toISOString(),
    });
    // A renewal by a TSA the caller does not trust leaves the chain indeterminate.
    const untrusted = await verifyArchivalEnvelope(
      { ...copy(envs[0]), evidence: [renewed] },
      {
        ...trusted(),
        now: later,
        witnessAnchors: { ...anchors, trustedRoot: { ...anchors.trustedRoot, tsas: [shortTsa.trusted()] } },
      },
    );
    expect(untrusted.witness).toEqual({ status: 'indeterminate', reason: 'untrusted_tsa' });
  });
});

describe('the pinned renewal vector (RFC 4998 chain rules)', () => {
  it('matches its Sess digest; renewed before the first TSA lapsed it stays reliable, renewed late it lapses, renewed over other bytes it is invalid', () => {
    const bytes = new Uint8Array(
      readFileSync(new URL('../fixtures/archival/renewal-vector.der', import.meta.url)),
    );
    expect(createHash('sha256').update(bytes).digest('hex')).toBe(
      '12eea4d0edb88dd7f75b28f98ca5230193f1e6eac532329081a3d9137321c732',
    );
    const parts = children(parseDer(bytes));
    const value = (i: number) => new Uint8Array(expectDer(parts[i], TAG.OCTET_STRING, 'part').value);
    const chain = (i: number) =>
      children(expectDer(parts[i], TAG.SEQUENCE, 'chain')).map(
        (c) => new Uint8Array(expectDer(c, TAG.OCTET_STRING, 'cert').value),
      );
    expect(Buffer.from(expectDer(parts[0], TAG.UTF8_STRING, 'label').value).toString('utf8')).toBe(
      'sess.witness-renewal-vector/1',
    );
    const times = {
      aFrom: new Date('2026-01-01T00:00:00Z'),
      aUntil: new Date('2027-01-01T00:00:00Z'),
      bFrom: new Date('2026-06-01T00:00:00Z'),
      bUntil: new Date('2036-06-01T00:00:00Z'),
      t0: new Date('2026-03-01T12:00:00Z'),
      t1: new Date('2026-12-01T12:00:00Z'),
      t2: new Date('2030-01-01T12:00:00Z'),
    };
    const tsa = (certChain: Uint8Array[], validFrom: Date): TrustedTsa => ({
      certChain,
      validFrom,
      validTo: null,
      uri: 'https://tsa.synthetic.test/api/v1/timestamp',
    });
    const a = tsa(chain(2), times.aFrom);
    const b = tsa(chain(3), times.bFrom);
    const [t0, t1, t1Late, tWrong, t2] = [4, 5, 6, 7, 8].map(value) as Uint8Array[];
    const first = verifyTimestampToken(t0 as Uint8Array, value(1), [a, b]);
    expect(first).toMatchObject({ status: 'valid', tsa: 0 });
    if (first.status !== 'valid') return;
    expect(first.genTime.toISOString()).toBe(times.t0.toISOString());
    expect(first.validUntil.toISOString()).toBe(times.aUntil.toISOString());
    const initial = { token: t0 as Uint8Array, genTime: first.genTime, validUntil: first.validUntil };
    const tsas = [a, b];
    expect(verifyRenewalChain(initial, [], tsas)).toEqual({
      status: 'valid',
      validUntil: times.aUntil,
      renewedAt: null,
    });
    expect(verifyRenewalChain(initial, [t1 as Uint8Array], tsas)).toEqual({
      status: 'valid',
      validUntil: times.bUntil,
      renewedAt: times.t1,
    });
    expect(verifyRenewalChain(initial, [t1 as Uint8Array, t2 as Uint8Array], tsas)).toEqual({
      status: 'valid',
      validUntil: times.bUntil,
      renewedAt: times.t2,
    });
    expect(verifyRenewalChain(initial, [t1Late as Uint8Array], tsas)).toEqual({
      status: 'indeterminate',
      reason: 'renewal_lapsed',
    });
    expect(verifyRenewalChain(initial, [tWrong as Uint8Array], tsas)).toEqual({
      status: 'invalid',
      reason: 'renewal',
      detail: 'imprint_mismatch',
    });
    expect(verifyRenewalChain(initial, [t2 as Uint8Array], tsas)).toMatchObject({ status: 'invalid' });
    expect(verifyRenewalChain(initial, [t1 as Uint8Array], [a])).toEqual({
      status: 'indeterminate',
      reason: 'untrusted_tsa',
    });
    const tampered = new Uint8Array(t1 as Uint8Array);
    flip(tampered, tampered.length - 1);
    expect(verifyRenewalChain(initial, [tampered], tsas)).toMatchObject({
      status: 'invalid',
      reason: 'renewal',
    });
  });
});

describe('the pinned Sigstore staging run (real TSA and Rekor data)', () => {
  interface Run {
    started_at: string;
    synthetic: {
      signed_cores: SignedArchivalCore[];
      batch: { openings: BatchOpening[] };
      checkpoint: { bytes: string; signature: string; public_key: string };
      timestamp: { gen_time: string };
      tlog: { v1: TlogEntry; v2: TlogEntry };
    };
    trust: { trusted_root_digest: string };
    exchanges: { url: string; status: number | null; response_body: string | null }[];
  }
  const run = JSON.parse(
    readFileSync(new URL('../fixtures/archival/sigstage-run.json', import.meta.url), 'utf8'),
  ) as Run;
  const recorded = (suffix: string) => {
    const e = run.exchanges.find((x) => x.url.endsWith(suffix) && x.status === 200);
    if (!e?.response_body) throw new Error(`no recorded response for ${suffix}`);
    return new Uint8Array(Buffer.from(e.response_body, 'base64'));
  };
  const s = run.synthetic;
  const bytes = (v: string) => new Uint8Array(Buffer.from(v, 'base64'));
  // The token is the second element of the recorded TimeStampResp.
  const token = new Uint8Array(
    (children(parseDer(recorded('/api/v1/timestamp')))[1]?.raw ?? []) as Uint8Array,
  );
  const rootBytes = recorded('trusted_root.json');
  const anchors = (): WitnessAnchors => ({
    trustedRoot: parseTrustedRoot(rootBytes),
    witnessKeys: [
      { publicKey: bytes(s.checkpoint.public_key), validFrom: new Date(run.started_at), validTo: null },
    ],
  });
  const parts = (api: 'v1' | 'v2', i: number) => ({
    checkpoint: {
      bytes: bytes(s.checkpoint.bytes),
      signature: bytes(s.checkpoint.signature),
      publicKey: bytes(s.checkpoint.public_key),
    },
    token,
    tlog: s.tlog[api],
    opening: s.batch.openings[i],
  });

  it('the recorded trusted root is the one Sess verified through TUF', () => {
    expect(`sha256:${createHash('sha256').update(rootBytes).digest('hex')}`).toBe(
      run.trust.trusted_root_digest,
    );
  });

  it('every receipt of the staging batch is witnessed offline through Rekor v2 and v1 at the TSA time, against the trusted root only', () => {
    for (const api of ['v2', 'v1'] as const)
      for (const [i, core] of s.signed_cores.entries()) {
        const r = verifyWitnessParts(parts(api, i), core, anchors(), 0);
        expect(r).toMatchObject({ status: 'witnessed', logIndex: s.tlog[api].logIndex });
        if (r.status !== 'witnessed') continue;
        expect(r.witnessedAt.toISOString()).toBe(new Date(s.timestamp.gen_time).toISOString());
        expect(r.promisedAt === null).toBe(api === 'v2');
      }
    const core = s.signed_cores[0] as SignedArchivalCore;
    // Wrong or missing anchors: unverifiable; altered parts: invalid; another format: invalid.
    expect(verifyWitnessParts(parts('v2', 0), core, { ...anchors(), witnessKeys: [] }, 0)).toEqual({
      status: 'unverifiable',
      reason: 'untrusted_witness_key',
    });
    expect(
      verifyWitnessParts(
        parts('v2', 0),
        core,
        { ...anchors(), trustedRoot: { ...anchors().trustedRoot, tsas: [] } },
        0,
      ),
    ).toEqual({ status: 'unverifiable', reason: 'untrusted_tsa' });
    expect(
      verifyWitnessParts(
        parts('v1', 0),
        core,
        { ...anchors(), trustedRoot: { ...anchors().trustedRoot, tlogs: [] } },
        0,
      ),
    ).toEqual({ status: 'unverifiable', reason: 'unknown_log' });
    const v2 = copy(s.tlog.v2);
    v2.inclusionProof.hashes.pop();
    expect(verifyWitnessParts({ ...parts('v2', 0), tlog: v2 }, core, anchors(), 0)).toEqual({
      status: 'invalid',
      reason: 'tlog',
      detail: 'inclusion',
    });
    expect(verifyWitnessParts(parts('v2', 1), core, anchors(), 0)).toEqual({
      status: 'invalid',
      reason: 'opening',
    });
    expect(verifyWitnessParts(parts('v2', 0), core, anchors(), 1)).toEqual({
      status: 'invalid',
      reason: 'opening',
    });
  });

  it('a spike proof attached to an envelope is unsupported evidence, never witnessed', async () => {
    const v = await corpusVectors();
    const proof = {
      type: 'sess.witness-spike-proof',
      version: 0,
      checkpoint: s.checkpoint,
      timestamp: { token: b64(token) },
      tlog: s.tlog.v2,
    };
    const r = await verifyArchivalEnvelope(
      { ...copy(v.cases[0]?.input as object), evidence: [proof] },
      { ...trusted(), now: new Date('2026-01-20T00:00:00.000Z'), witnessAnchors: anchors() },
    );
    expect(r.signature.status).toBe('valid');
    expect(r.witness).toEqual({ status: 'unsupported', reason: 'unsupported_evidence' });
  });
});

// Caller-supplied witness anchors are configuration, so an unusable anchor is refused up front with
// a stable TypeError (archival-core-v1 §5; ported with the Sess core's checkWitnessAnchors and its
// regression cases). Before, a bad certificate DER or log base URL escaped from inside the token or
// log verifier as a parser exception that was not a TypeError.
describe('witness anchors are validated up front', () => {
  let w: Witnessed;
  beforeAll(async () => {
    w = await witnessed(1);
  });

  type Editable = Record<string, unknown>;
  /** The anchors with one part replaced (a shallow edit of the caller's configuration). */
  function edited(
    a: WitnessAnchors,
    edit: (root: { tlogs: Editable[]; tsas: Editable[] }, keys: Editable[]) => void,
  ): WitnessAnchors {
    const root = {
      tlogs: a.trustedRoot.tlogs.map((l) => ({ ...l })),
      tsas: a.trustedRoot.tsas.map((t) => ({ ...t, certChain: [...t.certChain] })),
    };
    const keys = a.witnessKeys.map((k) => ({ ...k }));
    edit(root as unknown as { tlogs: Editable[]; tsas: Editable[] }, keys as unknown as Editable[]);
    return { trustedRoot: root, witnessKeys: keys };
  }
  const withEvidence = () => ({ ...copy(w.envelopes[0] as object), evidence: [w.evidence[0]] });
  const withoutEvidence = () => ({ ...copy(w.envelopes[0] as object), evidence: [] });

  it('malformed caller witness anchors (certificate DER, log base URL, witness or log key, window) are refused with a stable TypeError before any evidence is read, never a parser exception or a result', async () => {
    const garbage = new Uint8Array([0x30, 0x03, 0x02, 0x01, 0x01]);
    const ed25519 = new Uint8Array(
      generateKeyPairSync('ed25519').publicKey.export({ format: 'der', type: 'spki' }),
    );
    const chain = (t: Editable) => t.certChain as Uint8Array[];
    const cases: [string, WitnessAnchors][] = [
      [
        'a TSA chain certificate that is not DER',
        edited(w.anchors, (r) => void chain(r.tsas[0] as Editable).push(garbage)),
      ],
      [
        'a TSA leaf that is not DER',
        edited(w.anchors, (r) => void (chain(r.tsas[0] as Editable)[0] = garbage)),
      ],
      ['an empty TSA chain', edited(w.anchors, (r) => void ((r.tsas[0] as Editable).certChain = []))],
      [
        'a log base URL that is not a URL',
        edited(w.anchors, (r) => void ((r.tlogs[0] as Editable).baseUrl = 'log.synthetic.test')),
      ],
      [
        'a log base URL that is not https',
        edited(w.anchors, (r) => void ((r.tlogs[0] as Editable).baseUrl = 'http://log.synthetic.test')),
      ],
      [
        'a log key that is not SPKI',
        edited(w.anchors, (r) => void ((r.tlogs[0] as Editable).publicKey = garbage)),
      ],
      [
        'a witness key that is not SPKI',
        edited(w.anchors, (_r, k) => void ((k[0] as Editable).publicKey = garbage)),
      ],
      [
        'a witness key that is not ECDSA P-256',
        edited(w.anchors, (_r, k) => void ((k[0] as Editable).publicKey = ed25519)),
      ],
      [
        'a window start that is not a date',
        edited(w.anchors, (r) => void ((r.tsas[0] as Editable).validFrom = new Date(Number.NaN))),
      ],
      [
        'a window end that is neither a date nor null',
        edited(w.anchors, (_r, k) => void ((k[0] as Editable).validTo = '2030-01-01T00:00:00Z')),
      ],
    ];
    for (const [label, anchors] of cases) {
      expect(() => checkWitnessAnchors(anchors), label).toThrow(TypeError);
      expect(() => checkWitnessAnchors(anchors), label).toThrow(new RegExp(`^${WITNESS_ANCHORS_INVALID}: `));
      // The same refusal whether or not the envelope carries evidence: it is the options' error.
      for (const envelope of [withEvidence(), withoutEvidence()]) {
        const err = await verifyArchivalEnvelope(envelope, {
          ...trusted(),
          witnessAnchors: anchors,
        }).then(
          () => null,
          (e: unknown) => e,
        );
        expect(err, label).toBeInstanceOf(TypeError);
        expect((err as TypeError).message.startsWith(`${WITNESS_ANCHORS_INVALID}: `), label).toBe(true);
      }
    }
  });

  it('usable anchors pass validation and still verify: the synthetic anchors witness their envelope, and the recorded Sigstore staging trusted root is accepted as is', async () => {
    expect(() => checkWitnessAnchors(w.anchors)).not.toThrow();
    const r = await verifyArchivalEnvelope(withEvidence(), { ...trusted(), witnessAnchors: w.anchors });
    expect([r.witness.status, r.witness.reason]).toEqual(['witnessed', 'verified']);
    expect(r.witness.witnessed_at).toBe(w.witnessedAt.toISOString());
    expect(presentArchivalVerification(r).witness).toBe('witnessed');
    const run = JSON.parse(
      readFileSync(new URL('../fixtures/archival/sigstage-run.json', import.meta.url), 'utf8'),
    ) as { exchanges: { url: string; status: number | null; response_body: string | null }[] };
    const root = run.exchanges.find((x) => x.url.endsWith('trusted_root.json') && x.status === 200);
    const staging = parseTrustedRoot(new Uint8Array(Buffer.from(root?.response_body ?? '', 'base64')));
    expect(staging.tsas.length).toBeGreaterThan(0);
    expect(() => checkWitnessAnchors({ trustedRoot: staging, witnessKeys: [] })).not.toThrow();
    // Anchors without the witness key are usable but leave the evidence indeterminate.
    const keyless = { trustedRoot: w.anchors.trustedRoot, witnessKeys: [] };
    const k = await verifyArchivalEnvelope(withEvidence(), { ...trusted(), witnessAnchors: keyless });
    expect([k.witness.status, k.witness.reason]).toEqual(['indeterminate', 'untrusted_witness_key']);
  });
});
