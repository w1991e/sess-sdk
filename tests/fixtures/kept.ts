// Synthetic kept files (keep-v1 to keep-v4) and closing receipts for `sess verify`, built from the
// bundle corpus's public test-only keys (tests/fixtures/bundle/corpus-vectors.ts). Rounds are the
// corpus decision with distinct event IDs; a closing receipt is signed over their exact bytes with
// the closing-receipt-v1 claims builder. Fixtures only: nothing here is a customer or a Sess file.
import { CompactSign } from 'jose';
import { closingClaimsOf } from './bundle/closing-corpus-vectors.js';
import { claimsV2Of, corpusEnvelope } from './bundle/corpus-v2-vectors.js';
import {
  canonicalJson,
  claimsOf,
  CORPUS_AUDIENCE,
  CORPUS_INPUT,
  CORPUS_ISSUER,
  CORPUS_KEYS,
  CORPUS_SURFACE,
  corpusPrivateKey,
  corpusPublicJwks,
} from './bundle/corpus-vectors.js';

export type CorpusKey = keyof typeof CORPUS_KEYS;
export const KEPT_SESSION = 'ses_corpus_session_1';

const encode = (o: unknown) => new TextEncoder().encode(canonicalJson(o));

function sign(claims: unknown, typ: string, key: CorpusKey): Promise<string> {
  return new CompactSign(encode(claims))
    .setProtectedHeader({ alg: 'EdDSA', kid: CORPUS_KEYS[key].kid, typ })
    .sign(corpusPrivateKey(key));
}

export interface RoundOptions {
  key?: CorpusKey;
  v2?: boolean;
  acceptedAt?: Date;
  expiresAt?: Date;
  input?: unknown;
}

/** Answer `n` of the corpus Session: a receipt v1 (or v2) with its own event ID. */
export async function roundReceipt(n: number, o: RoundOptions = {}): Promise<string> {
  const over = {
    ...(o.acceptedAt ? { acceptedAt: o.acceptedAt } : {}),
    ...(o.expiresAt ? { expiresAt: o.expiresAt } : {}),
    ...(o.input !== undefined ? { input: o.input } : {}),
  };
  const base = o.v2 ? claimsV2Of(over, corpusEnvelope()) : claimsOf(over);
  const event = `evt_corpus_event_${n}`;
  return sign(
    { ...base, jti: event, event_id: event },
    o.v2 ? 'sess-receipt-2+jwt' : 'sess-receipt+jwt',
    o.key ?? 'current',
  );
}

/** The receipt's decision bundle: bundle-v1, or bundle-v2 with the corpus envelope. */
export function bundleOf(
  receipt: string,
  v2 = false,
  input: unknown = CORPUS_INPUT,
): Record<string, unknown> {
  return {
    type: 'sess.decision-bundle',
    version: v2 ? 2 : 1,
    receipt,
    ...(v2 ? { revision_envelope: corpusEnvelope() } : {}),
    content: { surface: CORPUS_SURFACE, input },
    keys: { keys: corpusPublicJwks('current') },
  };
}

export interface KeptRoundInput {
  receipt: string;
  v2?: boolean;
  /** false: the file holds no content for this round. */
  content?: boolean;
  /** A bundle to carry instead of the round's own. */
  bundle?: Record<string, unknown>;
}

/** A kept file of the given version (1 to 4); version 4 carries `closing` (default null). */
export function keptFile(
  version: number,
  rounds: KeptRoundInput[],
  closing: string | null = null,
): Record<string, unknown> {
  return {
    type: 'sess.kept-conversation',
    version,
    issuer: CORPUS_ISSUER,
    workspace_id: CORPUS_AUDIENCE,
    session_id: KEPT_SESSION,
    snapshot: { cutoff_sequence: rounds.length, taken_at: '2026-10-09T12:10:00.000Z' },
    coverage: rounds.every((r) => r.content !== false) ? 'every_accepted_round' : 'partial',
    inventory: [],
    rounds: rounds.map((r, i) => ({
      event_id: `evt_corpus_event_${i + 1}`,
      sequence: i + 1,
      revision: 1,
      accepted_at: '2026-10-09T12:00:00.123Z',
      receipt: r.receipt,
      content:
        r.content === false
          ? { status: 'unavailable' }
          : { status: 'included', bundle: r.bundle ?? bundleOf(r.receipt, r.v2) },
      preservation: { status: 'not_preserved' },
      holder: { status: 'unenrolled', reason: 'not_preserved' },
      ...(version >= 2 ? { revision_envelope: r.v2 ? corpusEnvelope() : null } : {}),
    })),
    ...(version === 4 ? { closing_receipt: closing } : {}),
  };
}

/** The Session's closing receipt over these round receipts, in this order. */
export function closingReceipt(rounds: readonly string[], key: CorpusKey = 'current'): Promise<string> {
  const claims = closingClaimsOf({
    issuer: CORPUS_ISSUER,
    workspaceId: CORPUS_AUDIENCE,
    sessionId: KEPT_SESSION,
    closureId: 'cls_corpus_closure_1',
    cause: 'completed_by_owner',
    terminalEventId: 'evt_corpus_end',
    effectiveEndAt: new Date('2026-10-09T12:20:00.000Z'),
    recordedAt: new Date('2026-10-09T12:20:00.000Z'),
    issuedAt: new Date('2026-10-09T12:20:01.000Z'),
    rounds,
  });
  return sign(claims, 'sess-closing-receipt+jwt', key);
}
