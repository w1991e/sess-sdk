// @sess.si/sdk/archival: the successor archival verifier (archival-core-v1 and witness evidence
// v1). Offline verification of an archival envelope (the exact original receipt, the issuer's
// signed archival core and detachable witness evidence) with independent result dimensions, and
// the strict readers for the witness trust anchors a caller supplies. verifyDecisionReceipt and
// verifyDecisionBundle in @sess.si/sdk/receipts are unchanged.
export { ARCHIVAL_CONTENT_MAX_BYTES, presentArchivalVerification, verifyArchivalEnvelope } from './verify.js';
export type {
  ArchivalMessage,
  ArchivalPresentation,
  ArchivalReceiptClaims,
  ArchivalVerification,
  ContentsReason,
  ContextReason,
  Dimension,
  DimensionStatus,
  ExpectedArchivalContext,
  KeyTrustReason,
  LiveExpiryReason,
  SignatureReason,
  VerifyArchivalEnvelopeOptions,
  WitnessReason,
  WitnessStatus,
} from './verify.js';
export { ARCHIVAL_ENVELOPE_MAX_BYTES } from './envelope.js';
export type { ArchivalEnvelope } from './envelope.js';
export type { ArchivalCore, SignedArchivalCore, VersionRef } from './core.js';
export { parseWitnessKeySet, WitnessKeySetError } from './witness/key-set.js';
export { parseTrustedRoot, TrustedRootError } from './witness/trusted-root.js';
export type { TrustedLog, TrustedRoot } from './witness/trusted-root.js';
export type { TrustedTsa } from './witness/tsa.js';
export type { TrustedWitnessKey, WitnessAnchors } from './witness/parts.js';
