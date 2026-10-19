// RFC 3161 time-stamp token verification against independently distributed TSA certificate
// chains (the trusted root's timestampAuthorities). Certificates embedded in a token are never
// trusted: the signer must be the leaf of a chain from the caller's trusted root.
//
// Verification: TSTInfo version 1 with the expected SHA-256 message imprint (and nonce, when the
// request is known); the CMS signed attributes bind the TSTInfo (contentType, messageDigest) and
// the signer certificate (ESS signingCertificateV2, or v1 with SHA-1); the signature over the
// DER SET of signed attributes verifies with the trusted leaf key; the chain verifies leaf to
// self-signed root; the leaf has the critical timeStamping extended key usage; and genTime lies
// within every chain certificate's validity and the authority's trusted validity window.
//
// Ported from the Sess evidence package (witness/tsa.ts); building a timestamp request and
// reading a TSA response, which only the witness worker needs, are omitted.
import { createHash, verify, X509Certificate } from 'node:crypto';
import {
  children,
  ctx,
  type Der,
  DerError,
  expect,
  generalizedTime,
  integerBytes,
  OID,
  oid,
  parseDer,
  smallInt,
  TAG,
} from './der.js';
import { equalBytes } from './merkle.js';

/** A trusted time-stamping authority: its chain (leaf first) and its trusted validity window. */
export interface TrustedTsa {
  /** DER certificates, leaf first, ending with the self-signed root. */
  certChain: Uint8Array[];
  validFrom: Date;
  validTo: Date | null;
  /** Where the trusted root says the TSA lives (informational). */
  uri: string;
}

interface ParsedToken {
  tstInfo: Uint8Array;
  policy: string;
  imprintAlg: string;
  imprint: Uint8Array;
  serial: string;
  genTime: Date;
  nonce: Uint8Array | null;
  digestAlg: string;
  /** The signed attributes re-tagged as a DER SET: what the signature covers. */
  signedAttrs: Uint8Array;
  signatureAlg: string;
  signature: Uint8Array;
  sid: { issuer: Uint8Array; serial: Uint8Array };
  contentType: string;
  messageDigest: Uint8Array;
  essCertHash: { alg: string; hash: Uint8Array } | null;
}

const HASHES: Record<string, string> = {
  [OID.sha256]: 'sha256',
  [OID.sha384]: 'sha384',
  [OID.sha512]: 'sha512',
};
const SIG_HASHES: Record<string, string> = {
  [OID.ecdsaWithSha256]: 'sha256',
  [OID.ecdsaWithSha384]: 'sha384',
  [OID.ecdsaWithSha512]: 'sha512',
};

function algOf(el: Der | undefined): string {
  return oid(children(expect(el, TAG.SEQUENCE, 'AlgorithmIdentifier'))[0]);
}

function attrValue(attrs: Der[], type: string): Der | undefined {
  const found = attrs.filter((a) => oid(children(a)[0]) === type);
  if (found.length > 1) throw new DerError('duplicate signed attribute');
  if (found.length === 0) return undefined;
  const values = children(expect(children(found[0] as Der)[1], TAG.SET, 'attribute values'));
  if (values.length !== 1) throw new DerError('attribute must have one value');
  return values[0];
}

/** Parses a TimeStampToken (CMS ContentInfo of SignedData over TSTInfo). Throws DerError. */
export function parseTimestampToken(bytes: Uint8Array): ParsedToken {
  const ci = children(expect(parseDer(bytes), TAG.SEQUENCE, 'ContentInfo'));
  if (oid(ci[0]) !== OID.signedData) throw new DerError('not SignedData');
  const sd = children(expect(children(expect(ci[1], ctx(0), 'content'))[0], TAG.SEQUENCE, 'SD'));
  smallInt(sd[0]);
  const encap = children(expect(sd[2], TAG.SEQUENCE, 'EncapsulatedContentInfo'));
  if (oid(encap[0]) !== OID.tstInfo) throw new DerError('not a TSTInfo');
  const eContent = expect(children(expect(encap[1], ctx(0), 'eContent'))[0], TAG.OCTET_STRING, 'e');
  const tst = children(expect(parseDer(eContent.value), TAG.SEQUENCE, 'TSTInfo'));
  if (smallInt(tst[0]) !== 1) throw new DerError('TSTInfo version is not 1');
  const policy = oid(tst[1]);
  const mi = children(expect(tst[2], TAG.SEQUENCE, 'MessageImprint'));
  const imprintAlg = algOf(mi[0]);
  const imprint = expect(mi[1], TAG.OCTET_STRING, 'hashedMessage').value;
  const serial = Buffer.from(integerBytes(tst[3])).toString('hex');
  const genTime = generalizedTime(tst[4]);
  let nonce: Uint8Array | null = null;
  for (const el of tst.slice(5)) if (el.tag === TAG.INTEGER) nonce = integerBytes(el);

  // signerInfos is the last element; certificates [0] and crls [1] are optional before it.
  const signerInfos = children(expect(sd.at(-1), TAG.SET, 'signerInfos'));
  if (signerInfos.length !== 1) throw new DerError('exactly one signer is required');
  const si = children(expect(signerInfos[0], TAG.SEQUENCE, 'SignerInfo'));
  if (smallInt(si[0]) !== 1) throw new DerError('signer must be identified by issuer and serial');
  const sid = children(expect(si[1], TAG.SEQUENCE, 'IssuerAndSerialNumber'));
  const digestAlg = algOf(si[2]);
  const attrsEl = expect(si[3], ctx(0), 'signedAttrs');
  const attrs = children(attrsEl);
  const signatureAlg = algOf(si[4]);
  const signature = expect(si[5], TAG.OCTET_STRING, 'signature').value;
  const ct = attrValue(attrs, OID.contentType);
  const md = attrValue(attrs, OID.messageDigest);
  if (!ct || !md) throw new DerError('contentType and messageDigest are required');
  let essCertHash: ParsedToken['essCertHash'] = null;
  const v2 = attrValue(attrs, OID.signingCertificateV2);
  const v1 = attrValue(attrs, OID.signingCertificate);
  if (v2) {
    const certs = children(expect(children(v2)[0], TAG.SEQUENCE, 'certs'));
    const id = children(expect(certs[0], TAG.SEQUENCE, 'ESSCertIDv2'));
    const hasAlg = id[0]?.tag === TAG.SEQUENCE;
    essCertHash = {
      alg: hasAlg ? (HASHES[algOf(id[0])] ?? 'unsupported') : 'sha256',
      hash: expect(hasAlg ? id[1] : id[0], TAG.OCTET_STRING, 'certHash').value,
    };
  } else if (v1) {
    const certs = children(expect(children(v1)[0], TAG.SEQUENCE, 'certs'));
    const id = children(expect(certs[0], TAG.SEQUENCE, 'ESSCertID'));
    essCertHash = { alg: 'sha1', hash: expect(id[0], TAG.OCTET_STRING, 'certHash').value };
  }
  const signedAttrs = new Uint8Array(attrsEl.raw);
  signedAttrs[0] = TAG.SET;
  return {
    tstInfo: new Uint8Array(eContent.value),
    policy,
    imprintAlg,
    imprint: new Uint8Array(imprint),
    serial,
    genTime,
    nonce: nonce ? new Uint8Array(nonce) : null,
    digestAlg,
    signedAttrs,
    signatureAlg,
    signature: new Uint8Array(signature),
    sid: {
      issuer: new Uint8Array((sid[0] as Der).raw),
      serial: new Uint8Array(integerBytes(sid[1])),
    },
    contentType: oid(ct),
    messageDigest: new Uint8Array(expect(md, TAG.OCTET_STRING, 'messageDigest').value),
    essCertHash,
  };
}

/** Issuer Name and serial of a DER certificate (from its TBSCertificate). */
function issuerAndSerial(cert: Uint8Array): { issuer: Uint8Array; serial: Uint8Array } {
  const tbs = children(expect(children(parseDer(cert))[0], TAG.SEQUENCE, 'TBSCertificate'));
  const off = tbs[0]?.tag === ctx(0) ? 1 : 0;
  return {
    serial: integerBytes(tbs[off]),
    issuer: (tbs[off + 2] as Der).raw,
  };
}

export type TimestampVerification =
  | {
      status: 'valid';
      genTime: Date;
      serial: string;
      policy: string;
      tsa: number;
      /**
       * The earliest notAfter of the signer's trusted chain: after it the token's signature can
       * no longer be relied on unless a renewal timestamp covered it before then (RFC 4998).
       */
      validUntil: Date;
    }
  | {
      status: 'invalid';
      reason:
        | 'malformed_token'
        | 'imprint_mismatch'
        | 'nonce_mismatch'
        | 'content_type'
        | 'message_digest'
        | 'signer_certificate'
        | 'unsupported_algorithm'
        | 'signature'
        | 'chain'
        | 'key_usage'
        | 'outside_validity';
    }
  | { status: 'unverifiable'; reason: 'untrusted_tsa' };

/**
 * Verifies a TimeStampToken over `imprint` (SHA-256) against trusted TSAs only. A token whose
 * signer is not a trusted leaf is unverifiable (wrong or rotated-out root); any failure of the
 * token itself is invalid.
 */
export function verifyTimestampToken(
  token: Uint8Array,
  imprint: Uint8Array,
  trusted: readonly TrustedTsa[],
  expectedNonce?: Uint8Array,
): TimestampVerification {
  let t: ParsedToken;
  try {
    t = parseTimestampToken(token);
  } catch {
    return { status: 'invalid', reason: 'malformed_token' };
  }
  if (t.imprintAlg !== OID.sha256 || !equalBytes(t.imprint, imprint))
    return { status: 'invalid', reason: 'imprint_mismatch' };
  if (expectedNonce && (!t.nonce || !equalBytes(t.nonce, stripZeros(expectedNonce))))
    return { status: 'invalid', reason: 'nonce_mismatch' };
  if (t.contentType !== OID.tstInfo) return { status: 'invalid', reason: 'content_type' };
  const digestHash = HASHES[t.digestAlg];
  const sigHash = SIG_HASHES[t.signatureAlg];
  if (!digestHash || !sigHash) return { status: 'invalid', reason: 'unsupported_algorithm' };
  const md = new Uint8Array(createHash(digestHash).update(t.tstInfo).digest());
  if (!equalBytes(md, t.messageDigest)) return { status: 'invalid', reason: 'message_digest' };

  const index = trusted.findIndex((a) => {
    const leaf = a.certChain[0];
    if (!leaf) return false;
    try {
      const id = issuerAndSerial(leaf);
      return equalBytes(id.issuer, t.sid.issuer) && equalBytes(id.serial, t.sid.serial);
    } catch {
      return false;
    }
  });
  if (index < 0) return { status: 'unverifiable', reason: 'untrusted_tsa' };
  const authority = trusted[index] as TrustedTsa;
  const chain = authority.certChain.map((c) => new X509Certificate(Buffer.from(c)));
  const leaf = chain[0] as X509Certificate;
  const leafDer = authority.certChain[0] as Uint8Array;

  if (!t.essCertHash || t.essCertHash.alg === 'unsupported')
    return { status: 'invalid', reason: 'signer_certificate' };
  const certHash = new Uint8Array(createHash(t.essCertHash.alg).update(leafDer).digest());
  if (!equalBytes(certHash, t.essCertHash.hash)) return { status: 'invalid', reason: 'signer_certificate' };
  if (!verify(sigHash, t.signedAttrs, { key: leaf.publicKey, dsaEncoding: 'der' }, t.signature))
    return { status: 'invalid', reason: 'signature' };
  for (let i = 0; i < chain.length; i++) {
    const cert = chain[i] as X509Certificate;
    const issuer = chain[i + 1] ?? cert;
    if (!cert.checkIssued(issuer) || !cert.verify(issuer.publicKey))
      return { status: 'invalid', reason: 'chain' };
  }
  if (!(leaf.keyUsage ?? []).includes(OID.timeStamping) || !ekuIsCritical(leafDer))
    return { status: 'invalid', reason: 'key_usage' };
  const at = t.genTime.getTime();
  const inCert = chain.every(
    (c) => at >= new Date(c.validFrom).getTime() && at <= new Date(c.validTo).getTime(),
  );
  const inWindow =
    at >= authority.validFrom.getTime() && (authority.validTo === null || at <= authority.validTo.getTime());
  if (!inCert || !inWindow) return { status: 'invalid', reason: 'outside_validity' };
  const validUntil = new Date(Math.min(...chain.map((c) => new Date(c.validTo).getTime())));
  return {
    status: 'valid',
    genTime: t.genTime,
    serial: t.serial,
    policy: t.policy,
    tsa: index,
    validUntil,
  };
}

function stripZeros(b: Uint8Array): Uint8Array {
  let i = 0;
  while (i < b.length - 1 && b[i] === 0) i++;
  return b.subarray(i);
}

/** RFC 3161 §2.3: the TSA certificate's extended key usage must be critical. */
function ekuIsCritical(cert: Uint8Array): boolean {
  try {
    const tbs = children(expect(children(parseDer(cert))[0], TAG.SEQUENCE, 'TBSCertificate'));
    const exts = tbs.find((e) => e.tag === ctx(3));
    if (!exts) return false;
    for (const ext of children(expect(children(exts)[0], TAG.SEQUENCE, 'extensions'))) {
      const parts = children(ext);
      if (oid(parts[0]) !== OID.extKeyUsage) continue;
      return parts[1]?.tag === TAG.BOOLEAN && parts[1].value[0] === 0xff;
    }
    return false;
  } catch {
    return false;
  }
}
