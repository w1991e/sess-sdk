// Validation of caller-supplied witness trust anchors, ported from the Sess core
// (packages/evidence/src/witness/anchors.ts at the commit in docs/spec/source.json; archival-core-v1
// §5). Anchors are the trusted caller's configuration (an independently distributed trusted root and the issuer's witness key
// set), never part of a submitted envelope, so an unusable anchor is the caller's error: it is
// refused up front with a stable TypeError, exactly like any other invalid verifier option. It is
// never reported as a property of the evidence (it would make a caller's broken configuration look
// like an invalid or untrusted proof), and it never escapes later as a parser exception from deep
// inside the token or log verifier (a bad certificate DER or log base URL used to throw there).
//
// Checked: the shape ({trustedRoot: {tlogs, tsas}, witnessKeys}); each witness key is an ECDSA
// P-256 SPKI DER with a valid window; each log has a plain https base URL, an SPKI DER public key,
// key details, a log ID and a valid window; each TSA has a non-empty chain of DER certificates
// that X.509 parsing accepts, a URI and a valid window. Nothing here judges whether a TSA or log is
// trustworthy: that is the caller's distribution (TUF) and the verifier's checks.
import { createPublicKey, X509Certificate } from 'node:crypto';
import { isObject } from '../core.js';

/** The prefix of every anchor refusal's message (the rest names the member). */
export const WITNESS_ANCHORS_INVALID = 'witness anchors are not valid';

function refuse(what: string): never {
  throw new TypeError(`${WITNESS_ANCHORS_INVALID}: ${what}`);
}

const isDate = (v: unknown): v is Date => v instanceof Date && !Number.isNaN(v.getTime());

function window(v: Record<string, unknown>, what: string): void {
  if (!isDate(v.validFrom)) refuse(`${what}.validFrom must be a valid Date`);
  if (v.validTo !== null && !isDate(v.validTo)) refuse(`${what}.validTo must be a valid Date or null`);
}

function spki(v: unknown, what: string) {
  if (!(v instanceof Uint8Array) || v.length === 0) refuse(`${what} must be SPKI DER bytes`);
  try {
    return createPublicKey({ key: Buffer.from(v), format: 'der', type: 'spki' });
  } catch {
    return refuse(`${what} is not a public key in SPKI DER`);
  }
}

/**
 * Throws a TypeError (message prefixed WITNESS_ANCHORS_INVALID) unless `anchors` is a usable
 * WitnessAnchors value. Callers that load anchors from configuration run it once at load
 * time; verifyArchivalEnvelope runs it on every call (its witnessAnchors option), before reading
 * the envelope.
 */
export function checkWitnessAnchors(anchors: unknown): void {
  if (
    !isObject(anchors) ||
    !isObject(anchors.trustedRoot) ||
    !Array.isArray(anchors.trustedRoot.tlogs) ||
    !Array.isArray(anchors.trustedRoot.tsas) ||
    !Array.isArray(anchors.witnessKeys)
  )
    refuse('they must be {trustedRoot: {tlogs, tsas}, witnessKeys}');
  const { tlogs, tsas } = anchors.trustedRoot as { tlogs: unknown[]; tsas: unknown[] };
  for (const [i, k] of (anchors.witnessKeys as unknown[]).entries()) {
    const what = `witnessKeys[${i}]`;
    if (!isObject(k)) refuse(`${what} must be an object`);
    const key = spki(k.publicKey, `${what}.publicKey`);
    if (key.asymmetricKeyType !== 'ec' || key.asymmetricKeyDetails?.namedCurve !== 'prime256v1')
      refuse(`${what}.publicKey must be an ECDSA P-256 key`);
    window(k, what);
  }
  for (const [i, l] of tlogs.entries()) {
    const what = `trustedRoot.tlogs[${i}]`;
    if (!isObject(l)) refuse(`${what} must be an object`);
    let url: URL | undefined;
    try {
      url = typeof l.baseUrl === 'string' ? new URL(l.baseUrl) : undefined;
    } catch {
      url = undefined;
    }
    if (url?.protocol !== 'https:' || url.host === '' || url.username || url.password)
      refuse(`${what}.baseUrl must be a plain https URL`);
    spki(l.publicKey, `${what}.publicKey`);
    if (typeof l.keyDetails !== 'string' || l.keyDetails.length === 0)
      refuse(`${what}.keyDetails must be a non-empty string`);
    if (typeof l.logId !== 'string' || l.logId.length === 0)
      refuse(`${what}.logId must be a non-empty string`);
    window(l, what);
  }
  for (const [i, t] of tsas.entries()) {
    const what = `trustedRoot.tsas[${i}]`;
    if (!isObject(t)) refuse(`${what} must be an object`);
    if (!Array.isArray(t.certChain) || t.certChain.length === 0)
      refuse(`${what}.certChain must be a non-empty array of DER certificates`);
    for (const [j, c] of (t.certChain as unknown[]).entries()) {
      if (!(c instanceof Uint8Array) || c.length === 0) refuse(`${what}.certChain[${j}] must be DER bytes`);
      try {
        new X509Certificate(Buffer.from(c));
      } catch {
        refuse(`${what}.certChain[${j}] is not a DER X.509 certificate`);
      }
    }
    if (typeof t.uri !== 'string') refuse(`${what}.uri must be a string`);
    window(t, what);
  }
}
