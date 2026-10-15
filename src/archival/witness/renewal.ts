// Renewal of witness evidence, after the RFC 4998 (Evidence Record Syntax) archive timestamp
// chain (docs/spec/witness-evidence-v1.md §6): a timestamp is relied on only while its TSA's
// certificate chain is valid, so before that chain's notAfter a new timestamp is obtained over the
// previous one, and so on. Each renewal is an RFC 3161 token over SHA-256 of the previous token's
// exact DER bytes. The chain verifies when every renewal is a valid token from a trusted TSA over
// the previous token, no earlier than it, and obtained no later than the previous token's validity
// end. The witness time stays the first token's genTime; a renewal obtained after the previous
// token lapsed cannot rescue it (indeterminate, never valid). Ported from the Sess evidence
// package (witness/renewal.ts).
import { sha256 } from './merkle.js';
import { type TrustedTsa, verifyTimestampToken } from './tsa.js';

export const WITNESS_RENEWAL_TYPE = 'sess.witness-renewal';
export const WITNESS_RENEWAL_HASH = 'sha256';
/** At most this many renewals in one evidence entry. */
export const WITNESS_RENEWALS_MAX = 8;

/** The imprint a renewal of `previousToken` timestamps: SHA-256 of its exact DER bytes. */
const renewalImprint = (previousToken: Uint8Array): Uint8Array => sha256(previousToken);

/** One link of the chain as verified: its token, its time and its chain's validity end. */
export interface RenewalLink {
  token: Uint8Array;
  genTime: Date;
  validUntil: Date;
}

export type RenewalChainResult =
  | {
      status: 'valid';
      /** The last link's validity end: the evidence can be relied on until then. */
      validUntil: Date;
      /** The last renewal's time; null when there is none. */
      renewedAt: Date | null;
    }
  | { status: 'invalid'; reason: 'renewal'; detail: string }
  | { status: 'indeterminate'; reason: 'untrusted_tsa' | 'renewal_lapsed' };

/**
 * Verifies renewal tokens (oldest first) over the initial, already verified token, against the
 * caller's trusted TSAs only.
 */
export function verifyRenewalChain(
  initial: RenewalLink,
  renewals: readonly Uint8Array[],
  tsas: readonly TrustedTsa[],
): RenewalChainResult {
  let previous = initial;
  for (const token of renewals) {
    const v = verifyTimestampToken(token, renewalImprint(previous.token), tsas);
    if (v.status === 'unverifiable') return { status: 'indeterminate', reason: 'untrusted_tsa' };
    if (v.status === 'invalid') return { status: 'invalid', reason: 'renewal', detail: v.reason };
    if (v.genTime.getTime() < previous.genTime.getTime())
      return { status: 'invalid', reason: 'renewal', detail: 'order' };
    if (v.genTime.getTime() > previous.validUntil.getTime())
      return { status: 'indeterminate', reason: 'renewal_lapsed' };
    previous = { token, genTime: v.genTime, validUntil: v.validUntil };
  }
  return {
    status: 'valid',
    validUntil: previous.validUntil,
    renewedAt: renewals.length > 0 ? previous.genTime : null,
  };
}
