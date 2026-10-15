// A synthetic, in-memory Sigstore for the SDK's witness tests, ported from the Sess evidence
// package's test support (packages/evidence/test/witness-synthetic.ts and the batch, checkpoint
// and evidence builders it drives): a throwaway CA and RFC 3161 TSA (ECDSA P-256, real X.509 and
// CMS DER, so the token verifier checks them exactly as it checks Sigstore's), a Rekor v2-style
// transparency log (Ed25519 C2SP signed-note checkpoints, RFC 6962 inclusion proofs), the
// version 1 batch commitment and checkpoint, and per-member witness evidence. It also writes the
// trusted root and witness key set in their published JSON forms, as a verifier would hold them.
//
// Everything is generated per test run from fresh keys and lives in memory only; the hosts are
// reserved `.test` names that never resolve. No network. Synthetic and single-use; never print a
// key. ECDSA signatures are randomized, so these vectors are not byte-reproducible: their expected
// outcomes are the Sess tests' expectations for the same constructions.
import {
  createHash,
  createPublicKey,
  generateKeyPairSync,
  type KeyObject,
  randomBytes,
  randomInt,
  sign,
} from 'node:crypto';
import type { SignedArchivalCore } from '../../../src/archival/core.js';
import { canonicalJson } from '../../../src/receipts/json.js';
import { CHECKPOINT_KEY_DETAILS, type SignedCheckpoint } from '../../../src/archival/witness/checkpoint.js';
import { OID, TAG, ctx } from '../../../src/archival/witness/der.js';
import { leafHash, nodeHash } from '../../../src/archival/witness/merkle.js';
import type { BatchOpening } from '../../../src/archival/witness/opening.js';
import { signedCoreBytes } from '../../../src/archival/witness/opening.js';
import type { TrustedWitnessKey } from '../../../src/archival/witness/parts.js';
import type { TlogEntry } from '../../../src/archival/witness/rekor.js';
import type { TrustedLog, TrustedRoot } from '../../../src/archival/witness/trusted-root.js';
import type { TrustedTsa } from '../../../src/archival/witness/tsa.js';

export const SYNTHETIC_TSA_URL = 'https://tsa.synthetic.test/api/v1/timestamp';
export const SYNTHETIC_LOG_ORIGIN = 'https://log.synthetic.test';
const LOG_HOST = new URL(SYNTHETIC_LOG_ORIGIN).host;

// ------------------------------------------------------------------------------------------------
// DER writer (test-only: the SDK reads DER, it never writes it)

export const sha256 = (...parts: (Uint8Array | string)[]) => {
  const h = createHash('sha256');
  for (const p of parts) h.update(p);
  return new Uint8Array(h.digest());
};
export const b64 = (b: Uint8Array) => Buffer.from(b).toString('base64');
const cat = (...parts: Uint8Array[]) => new Uint8Array(Buffer.concat(parts));

function length(n: number): Uint8Array {
  if (n < 0x80) return Uint8Array.of(n);
  const bytes: number[] = [];
  for (let x = n; x > 0; x = Math.floor(x / 256)) bytes.unshift(x & 0xff);
  return Uint8Array.of(0x80 | bytes.length, ...bytes);
}
export const encode = (tag: number, content: Uint8Array) =>
  cat(Uint8Array.of(tag), length(content.length), content);
export const seq = (...parts: Uint8Array[]) => encode(TAG.SEQUENCE, cat(...parts));
export function encodeUnsigned(bytes: Uint8Array): Uint8Array {
  let i = 0;
  while (i < bytes.length - 1 && bytes[i] === 0) i++;
  const v = bytes.subarray(i);
  return encode(TAG.INTEGER, ((v[0] as number) & 0x80) !== 0 ? cat(Uint8Array.of(0), v) : new Uint8Array(v));
}
export function encodeOid(dotted: string): Uint8Array {
  const arcs = dotted.split('.').map(Number);
  const out: number[] = [];
  const push = (n: number) => {
    const b: number[] = [n & 0x7f];
    for (let x = Math.floor(n / 128); x > 0; x = Math.floor(x / 128)) b.unshift(0x80 | (x & 0x7f));
    out.push(...b);
  };
  push((arcs[0] as number) * 40 + (arcs[1] as number));
  for (const a of arcs.slice(2)) push(a);
  return encode(TAG.OID, Uint8Array.from(out));
}
/** DER SET OF content: the elements in ascending order of their encodings. */
const sorted = (parts: Uint8Array[]) =>
  cat(...[...parts].sort((a, b) => Buffer.compare(Buffer.from(a), Buffer.from(b))));
const set = (...parts: Uint8Array[]) => encode(TAG.SET, sorted(parts));
export const octets = (b: Uint8Array) => encode(TAG.OCTET_STRING, b);
const bits = (b: Uint8Array, unused = 0) => encode(TAG.BIT_STRING, cat(Uint8Array.of(unused), b));
const bool = (v: boolean) => encode(TAG.BOOLEAN, Uint8Array.of(v ? 0xff : 0));
const utf8 = (s: string) => encode(TAG.UTF8_STRING, new TextEncoder().encode(s));
const int = (n: number) => encodeUnsigned(Uint8Array.of(n));
const explicit = (n: number, inner: Uint8Array) => encode(ctx(n), inner);
const ECDSA_SHA256 = seq(encodeOid(OID.ecdsaWithSha256));
const SHA256_ALG = seq(encodeOid(OID.sha256));

function time(d: Date): Uint8Array {
  const iso = d.toISOString().replace(/\.\d{3}Z$/, 'Z');
  const digits = iso.replace(/[-:T]/g, '');
  const year = d.getUTCFullYear();
  return year >= 1950 && year < 2050
    ? encode(0x17, new TextEncoder().encode(digits.slice(2)))
    : encode(TAG.GENERALIZED_TIME, new TextEncoder().encode(digits));
}

const generalized = (d: Date) =>
  encode(
    TAG.GENERALIZED_TIME,
    new TextEncoder().encode(
      d
        .toISOString()
        .replace(/\.\d{3}Z$/, 'Z')
        .replace(/[-:T]/g, ''),
    ),
  );

const name = (cn: string) => seq(set(seq(encodeOid('2.5.4.3'), utf8(cn))));

const extension = (oid: string, critical: boolean, value: Uint8Array) =>
  seq(encodeOid(oid), ...(critical ? [bool(true)] : []), octets(value));

interface SyntheticCert {
  der: Uint8Array;
  key: KeyObject;
  subject: Uint8Array;
  serial: Uint8Array;
}

/** An X.509 v3 certificate (ECDSA P-256 / SHA-256), CA or TSA leaf. */
function certificate(options: {
  cn: string;
  issuer: SyntheticCert | null;
  notBefore: Date;
  notAfter: Date;
  kind: 'ca' | 'tsa';
}): SyntheticCert {
  const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
  const serial = randomBytes(12);
  serial[0] = ((serial[0] as number) & 0x7f) | 0x01;
  const subject = name(options.cn);
  const issuerName = options.issuer?.subject ?? subject;
  const exts =
    options.kind === 'ca'
      ? [
          extension('2.5.29.19', true, seq(bool(true))),
          extension('2.5.29.15', true, bits(Uint8Array.of(0x06), 1)),
        ]
      : [
          extension('2.5.29.15', true, bits(Uint8Array.of(0x80), 7)),
          extension(OID.extKeyUsage, true, seq(encodeOid(OID.timeStamping))),
        ];
  const tbs = seq(
    explicit(0, int(2)),
    encodeUnsigned(serial),
    ECDSA_SHA256,
    issuerName,
    seq(time(options.notBefore), time(options.notAfter)),
    subject,
    new Uint8Array(publicKey.export({ format: 'der', type: 'spki' })),
    explicit(3, seq(...exts)),
  );
  const signer = options.issuer?.key ?? privateKey;
  const signature = sign('sha256', tbs, { key: signer, dsaEncoding: 'der' });
  return { der: seq(tbs, ECDSA_SHA256, bits(new Uint8Array(signature))), key: privateKey, subject, serial };
}

export interface SyntheticTsa {
  /** DER certificates, leaf first, ending with the self-signed root. */
  chain: Uint8Array[];
  /** The authority as a trusted root lists it, with its trusted issuance window. */
  trusted(validFrom?: Date, validTo?: Date | null): TrustedTsa;
  /** A TimeStampToken over `imprint` (SHA-256) at `genTime`. */
  token(imprint: Uint8Array, genTime: Date): Uint8Array;
}

/** A throwaway CA and TSA leaf, valid over [notBefore, notAfter]. */
export function syntheticTsa(
  options: { name?: string; notBefore?: Date; notAfter?: Date } = {},
): SyntheticTsa {
  const notBefore = options.notBefore ?? new Date(Date.now() - 86_400_000);
  const notAfter = options.notAfter ?? new Date(Date.now() + 10 * 365 * 86_400_000);
  const label = options.name ?? 'synthetic';
  const ca = certificate({ cn: `${label} test CA`, issuer: null, notBefore, notAfter, kind: 'ca' });
  const leaf = certificate({ cn: `${label} test TSA`, issuer: ca, notBefore, notAfter, kind: 'tsa' });
  const token = (imprint: Uint8Array, genTime: Date): Uint8Array => {
    const tstInfo = seq(
      int(1),
      encodeOid('1.3.6.1.4.1.57264.99.1'),
      seq(SHA256_ALG, octets(imprint)),
      encodeUnsigned(randomBytes(8)),
      generalized(genTime),
    );
    const attrs = [
      seq(encodeOid(OID.contentType), set(encodeOid(OID.tstInfo))),
      seq(encodeOid(OID.messageDigest), set(octets(sha256(tstInfo)))),
      seq(encodeOid(OID.signingCertificateV2), set(seq(seq(seq(octets(sha256(leaf.der))))))),
    ];
    // The signature covers the attributes as a SET; the SignerInfo carries them as [0] IMPLICIT.
    const signedAttrs = set(...attrs);
    const signature = sign('sha256', signedAttrs, { key: leaf.key, dsaEncoding: 'der' });
    const signerInfo = seq(
      int(1),
      seq(ca.subject, encodeUnsigned(leaf.serial)),
      SHA256_ALG,
      encode(ctx(0), sorted(attrs)),
      ECDSA_SHA256,
      octets(new Uint8Array(signature)),
    );
    const signedData = seq(
      int(3),
      set(SHA256_ALG),
      seq(encodeOid(OID.tstInfo), explicit(0, octets(tstInfo))),
      encode(ctx(0), leaf.der),
      set(signerInfo),
    );
    return seq(encodeOid(OID.signedData), explicit(0, signedData));
  };
  return {
    chain: [leaf.der, ca.der],
    trusted: (validFrom = notBefore, validTo = null) => ({
      certChain: [leaf.der, ca.der],
      validFrom,
      validTo,
      uri: SYNTHETIC_TSA_URL,
    }),
    token,
  };
}

// ------------------------------------------------------------------------------------------------
// Merkle tree building (RFC 6962)

function split(n: number): number {
  let k = 1;
  while (k * 2 < n) k *= 2;
  return k;
}
export function treeHead(leaves: readonly Uint8Array[]): Uint8Array {
  if (leaves.length === 1) return leaves[0] as Uint8Array;
  const k = split(leaves.length);
  return nodeHash(treeHead(leaves.slice(0, k)), treeHead(leaves.slice(k)));
}
export function inclusionPath(index: number, leaves: readonly Uint8Array[]): Uint8Array[] {
  if (leaves.length === 1) return [];
  const k = split(leaves.length);
  return index < k
    ? [...inclusionPath(index, leaves.slice(0, k)), treeHead(leaves.slice(k))]
    : [...inclusionPath(index - k, leaves.slice(k)), treeHead(leaves.slice(0, k))];
}

/** The C2SP key hint of an Ed25519 log key. */
function keyHint(host: string, spki: Uint8Array): Uint8Array {
  const raw = spki.subarray(spki.length - 32);
  return sha256(new TextEncoder().encode(`${host}\n`), Uint8Array.of(1), raw).subarray(0, 4);
}

export interface SyntheticLog {
  trusted: TrustedLog;
  /** Logs a signed checkpoint as a hashedrekord 0.0.2 entry; the TransparencyLogEntry. */
  log(cp: SignedCheckpoint): TlogEntry;
}

/** A Rekor v2-style log with an Ed25519 key and some earlier entries. */
export function syntheticLog(options: { validFrom?: Date } = {}): SyntheticLog {
  const { privateKey, publicKey } = generateKeyPairSync('ed25519');
  const spki = new Uint8Array(publicKey.export({ format: 'der', type: 'spki' }));
  const raw = spki.subarray(spki.length - 32);
  const logId = sha256(new TextEncoder().encode(`${LOG_HOST}\n`), Uint8Array.of(1), raw);
  const hint = keyHint(LOG_HOST, spki);
  const leaves: Uint8Array[] = Array.from({ length: 5 }, () => leafHash(randomBytes(32)));
  return {
    trusted: {
      baseUrl: SYNTHETIC_LOG_ORIGIN,
      publicKey: spki,
      keyDetails: 'PKIX_ED25519',
      logId: b64(logId),
      validFrom: options.validFrom ?? new Date(Date.now() - 86_400_000),
      validTo: null,
    },
    log(cp) {
      const body = new TextEncoder().encode(
        JSON.stringify({
          apiVersion: '0.0.2',
          kind: 'hashedrekord',
          spec: {
            hashedRekordV002: {
              data: { algorithm: 'SHA2_256', digest: b64(sha256(cp.bytes)) },
              signature: {
                content: b64(cp.signature),
                verifier: { publicKey: { rawBytes: b64(cp.publicKey) }, keyDetails: CHECKPOINT_KEY_DETAILS },
              },
            },
          },
        }),
      );
      leaves.push(leafHash(body));
      const index = leaves.length - 1;
      const size = leaves.length;
      const root = treeHead(leaves);
      const noteBody = `${LOG_HOST}\n${size}\n${b64(root)}\n`;
      const noteSig = sign(null, Buffer.from(noteBody), privateKey);
      const envelope = `${noteBody}\n— ${LOG_HOST} ${b64(cat(hint, new Uint8Array(noteSig)))}\n`;
      return {
        logIndex: String(index),
        logId: { keyId: b64(logId) },
        kindVersion: { kind: 'hashedrekord', version: '0.0.2' },
        integratedTime: '0',
        inclusionProof: {
          logIndex: String(index),
          rootHash: b64(root),
          treeSize: String(size),
          hashes: inclusionPath(index, leaves).map(b64),
          checkpoint: { envelope },
        },
        canonicalizedBody: b64(body),
      };
    },
  };
}

// ------------------------------------------------------------------------------------------------
// Batch commitment, checkpoint and evidence (the witness worker's builders)

const LEAF_FORMATS = {
  0: { domain: 'sess.witness-spike.leaf/0', opening: 'sess.witness-spike-opening' },
  1: { domain: 'sess.witness.leaf/v1', opening: 'sess.witness-opening' },
} as const;
const CHECKPOINT_FORMATS = {
  0: { domain: 'sess.witness-spike.checkpoint/0', type: 'sess.witness-spike-checkpoint' },
  1: { domain: 'sess.witness.checkpoint/v1', type: 'sess.witness-checkpoint' },
} as const;

export function commitment(nonce: Uint8Array, signedCoreDigest: Uint8Array, version: 0 | 1): Uint8Array {
  return sha256(
    new TextEncoder().encode(LEAF_FORMATS[version].domain),
    Uint8Array.of(0),
    nonce,
    signedCoreDigest,
  );
}

/** Commits a batch of signed cores: shuffled, padded to a power of two, hashed. */
export function commitBatch(members: readonly SignedArchivalCore[], version: 0 | 1 = 1) {
  let size = 2;
  while (size < members.length) size *= 2;
  const digests = members.map((m) => sha256(signedCoreBytes(m)));
  const nonces = members.map(() => new Uint8Array(randomBytes(32)));
  const slots = Array.from({ length: size }, (_, i) => i);
  for (let i = size - 1; i > 0; i--) {
    const j = randomInt(i + 1);
    [slots[i], slots[j]] = [slots[j] as number, slots[i] as number];
  }
  const leaves = slots.map((slot) =>
    slot < members.length
      ? leafHash(commitment(nonces[slot] as Uint8Array, digests[slot] as Uint8Array, version))
      : leafHash(randomBytes(32)),
  );
  const root = treeHead(leaves);
  const openings = members.map((_, m): BatchOpening => {
    const index = slots.indexOf(m);
    return {
      type: LEAF_FORMATS[version].opening,
      version,
      signed_core_digest: `sha256:${Buffer.from(digests[m] as Uint8Array).toString('hex')}`,
      nonce: b64(nonces[m] as Uint8Array),
      leaf_index: index,
      tree_size: size,
      path: inclusionPath(index, leaves).map(b64),
    };
  });
  return { root, treeSize: size, openings };
}

/** Signs a checkpoint for a batch root with the witness key (ECDSA P-256, SHA-256, DER). */
export function signCheckpoint(
  issuer: string,
  batch: number,
  root: Uint8Array,
  treeSize: number,
  privateKey: KeyObject,
  version: 0 | 1 = 1,
): SignedCheckpoint {
  const body = canonicalJson({
    type: CHECKPOINT_FORMATS[version].type,
    version,
    issuer,
    batch,
    tree_size: treeSize,
    root: `sha256:${Buffer.from(root).toString('hex')}`,
  });
  const bytes = cat(
    new TextEncoder().encode(CHECKPOINT_FORMATS[version].domain),
    Uint8Array.of(0),
    new TextEncoder().encode(body),
  );
  return {
    bytes,
    signature: new Uint8Array(sign('sha256', bytes, { key: privateKey, dsaEncoding: 'der' })),
    publicKey: new Uint8Array(createPublicKey(privateKey).export({ format: 'der', type: 'spki' })),
  };
}

/** A fresh witness key: the P-256 private key, its SPKI DER and its trusted-key entry. */
export function witnessKeyPair(validFrom = new Date('2020-01-01T00:00:00Z'), validTo: Date | null = null) {
  const { privateKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
  const publicKey = new Uint8Array(createPublicKey(privateKey).export({ format: 'der', type: 'spki' }));
  const trusted: TrustedWitnessKey = { publicKey, validFrom, validTo };
  return { privateKey, publicKey, trusted };
}

export interface WitnessEvidenceEntry {
  type: 'sess.witness-evidence';
  version: 1;
  opening: BatchOpening;
  checkpoint: { bytes: string; signature: string; public_key: string };
  timestamp: { token: string };
  tlog: TlogEntry;
  renewals: { type: 'sess.witness-renewal'; version: 1; hash_alg: 'sha256'; token: string }[];
  trust_reference: { source: string; tuf_root_version: number; trusted_root_digest: string };
}

export interface WitnessedBatch {
  tsa: SyntheticTsa;
  log: SyntheticLog;
  key: ReturnType<typeof witnessKeyPair>;
  trustedRoot: TrustedRoot;
  openings: BatchOpening[];
  treeSize: number;
  root: Uint8Array;
  evidence: WitnessEvidenceEntry[];
  witnessedAt: Date;
}

/** Witnesses one batch of signed cores end to end: commit, checkpoint, timestamp, log. */
export function witnessBatch(cores: readonly SignedArchivalCore[], batchNumber = 7): WitnessedBatch {
  const tsa = syntheticTsa();
  const log = syntheticLog();
  const key = witnessKeyPair();
  const batch = commitBatch(cores, 1);
  const cp = signCheckpoint(
    cores[0]?.core.issuer as string,
    batchNumber,
    batch.root,
    batch.treeSize,
    key.privateKey,
  );
  const witnessedAt = new Date(Math.floor(Date.now() / 1000) * 1000);
  const token = tsa.token(sha256(cp.signature), witnessedAt);
  const entry = log.log(cp);
  const evidence = batch.openings.map((opening): WitnessEvidenceEntry => ({
    type: 'sess.witness-evidence',
    version: 1,
    opening,
    checkpoint: { bytes: b64(cp.bytes), signature: b64(cp.signature), public_key: b64(cp.publicKey) },
    timestamp: { token: b64(token) },
    tlog: entry,
    renewals: [],
    trust_reference: {
      source: 'https://tuf.synthetic.test',
      tuf_root_version: 1,
      trusted_root_digest: `sha256:${'0'.repeat(64)}`,
    },
  }));
  return {
    tsa,
    log,
    key,
    trustedRoot: { tlogs: [log.trusted], tsas: [tsa.trusted()] },
    openings: batch.openings,
    treeSize: batch.treeSize,
    root: batch.root,
    evidence,
    witnessedAt,
  };
}

// ------------------------------------------------------------------------------------------------
// Published forms of the anchors

/** A trusted root as Sigstore publishes it (trusted_root.json), naming the given logs and TSAs. */
export function trustedRootJson(root: TrustedRoot): string {
  const window = (from: Date, to: Date | null) => ({
    start: from.toISOString(),
    ...(to ? { end: to.toISOString() } : {}),
  });
  return JSON.stringify({
    mediaType: 'application/vnd.dev.sigstore.trustedroot+json;version=0.1',
    tlogs: root.tlogs.map((l) => ({
      baseUrl: l.baseUrl,
      hashAlgorithm: 'SHA2_256',
      publicKey: {
        rawBytes: b64(l.publicKey),
        keyDetails: l.keyDetails,
        validFor: window(l.validFrom, l.validTo),
      },
      logId: { keyId: l.logId },
    })),
    certificateAuthorities: [],
    ctlogs: [],
    timestampAuthorities: root.tsas.map((t) => ({
      subject: { organization: 'synthetic', commonName: 'synthetic test TSA' },
      uri: t.uri,
      certChain: { certificates: t.certChain.map((c) => ({ rawBytes: b64(c) })) },
      validFor: window(t.validFrom, t.validTo),
    })),
  });
}

/** The issuer's published witness key set (/.well-known/sess-witness-keys.json). */
export function witnessKeySetJson(issuer: string, keys: readonly TrustedWitnessKey[]): string {
  return JSON.stringify({
    type: 'sess.witness-key-set',
    version: 1,
    issuer,
    keys: keys.map((k) => ({
      key_id: `sha256:${Buffer.from(sha256(k.publicKey)).toString('hex')}`,
      key_details: CHECKPOINT_KEY_DETAILS,
      spki: b64(k.publicKey),
      valid_from: k.validFrom.toISOString(),
      valid_to: k.validTo === null ? null : k.validTo.toISOString(),
    })),
  });
}
