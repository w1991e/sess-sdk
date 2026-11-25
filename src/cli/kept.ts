// The kept file (keep-v1 to keep-v4, Sess's kept-conversation formats), read structurally for
// `sess verify`: the file's
// own members, each round's receipt, its bundle when the file holds its content, and keep-v4's
// closing receipt. This verifies nothing. Each bundle goes to verifyDecisionBundle and the closing
// receipt to verifyClosingReceipt. The inventory, snapshot, archival or person envelopes, holder
// proofs and witness evidence are not read, and `sess verify` says so.
import { canonicalJson, exactKeys, isRecord } from '../receipts/json.js';

/** The product's own bound on a kept file (keep-v3 and keep-v4: 80 MiB). */
export const MAX_KEPT_FILE_BYTES = 80 * 1024 * 1024;
const KEPT_TYPE = 'sess.kept-conversation';
const MAX_ROUNDS = 64;
const MAX_ROUND_RECEIPT_CHARS = 32_768;
const MAX_CLOSING_RECEIPT_CHARS = 8_192;
const COMPACT_JWS = /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/;
const TOP = [
  'type',
  'version',
  'issuer',
  'workspace_id',
  'session_id',
  'snapshot',
  'coverage',
  'inventory',
  'rounds',
];
const ROUND_V1 = [
  'event_id',
  'sequence',
  'revision',
  'accepted_at',
  'receipt',
  'content',
  'preservation',
  'holder',
];

export interface KeptRound {
  /** The round's receipt, its exact compact JWS as the file carries it. */
  receipt: string;
  /** Its decision bundle, or null when the file holds no content for it. */
  bundle: unknown;
}

export type KeptRead =
  | {
      ok: true;
      version: 1 | 2 | 3 | 4;
      rounds: KeptRound[];
      /** keep-v4: the closing receipt or null; undefined for versions 1 to 3. */
      closing: string | null | undefined;
    }
  | { ok: false; reason: 'malformed' | 'newer' };

/** Whether a parsed JSON value declares itself a kept file (then readKeptFile decides the rest). */
export function isKeptFile(value: unknown): value is Record<string, unknown> {
  return isRecord(value) && value.type === KEPT_TYPE;
}

function typOf(jws: string): unknown {
  try {
    const header = JSON.parse(
      Buffer.from(jws.split('.')[0] as string, 'base64url').toString('utf8'),
    ) as unknown;
    return isRecord(header) ? header.typ : undefined;
  } catch {
    return undefined;
  }
}

function sameJson(a: unknown, b: unknown): boolean {
  try {
    return canonicalJson(a) === canonicalJson(b);
  } catch {
    return false;
  }
}

export function readKeptFile(file: Record<string, unknown>): KeptRead {
  const malformed = { ok: false, reason: 'malformed' } as const;
  const version = file.version;
  if (!Number.isSafeInteger(version) || (version as number) < 1) return malformed;
  // A later version is newer, never a damaged file: nothing in it is read.
  if ((version as number) > 4) return { ok: false, reason: 'newer' };
  const v = version as 1 | 2 | 3 | 4;
  if (!exactKeys(file, v === 4 ? [...TOP, 'closing_receipt'] : TOP)) return malformed;
  const rawRounds = file.rounds;
  if (!Array.isArray(rawRounds) || rawRounds.length < 1 || rawRounds.length > MAX_ROUNDS) return malformed;
  const roundMembers = v === 1 ? ROUND_V1 : [...ROUND_V1, 'revision_envelope'];
  const rounds: KeptRound[] = [];
  for (const round of rawRounds as unknown[]) {
    if (!isRecord(round) || !exactKeys(round, roundMembers)) return malformed;
    const receipt = round.receipt;
    if (typeof receipt !== 'string' || receipt.length > MAX_ROUND_RECEIPT_CHARS || !COMPACT_JWS.test(receipt))
      return malformed;
    const typ = typOf(receipt);
    if (v === 1 ? typ !== 'sess-receipt+jwt' : typ !== 'sess-receipt+jwt' && typ !== 'sess-receipt-2+jwt')
      return malformed;
    if (
      v !== 1 &&
      (typ === 'sess-receipt-2+jwt' ? !isRecord(round.revision_envelope) : round.revision_envelope !== null)
    )
      return malformed;
    const content = round.content;
    if (!isRecord(content)) return malformed;
    if (content.status === 'unavailable' && exactKeys(content, ['status'])) {
      rounds.push({ receipt, bundle: null });
      continue;
    }
    if (content.status !== 'included' || !exactKeys(content, ['status', 'bundle'])) return malformed;
    const bundle = content.bundle;
    // The bundle checked must be this round's: the same receipt, byte for byte, and for a receipt v2
    // the same revision envelope. Otherwise the file could pair one valid bundle with another
    // round's receipt, which is the one the closing receipt commits to.
    if (!isRecord(bundle) || bundle.receipt !== receipt) return malformed;
    if (typ === 'sess-receipt-2+jwt' && !sameJson(bundle.revision_envelope, round.revision_envelope))
      return malformed;
    rounds.push({ receipt, bundle });
  }
  let closing: string | null | undefined;
  if (v === 4) {
    const c = file.closing_receipt;
    if (c !== null && (typeof c !== 'string' || c.length > MAX_CLOSING_RECEIPT_CHARS || !COMPACT_JWS.test(c)))
      return malformed;
    closing = c;
  }
  return { ok: true, version: v, rounds, closing };
}
