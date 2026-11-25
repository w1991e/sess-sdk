import { createHash, createPrivateKey, createPublicKey, sign } from 'node:crypto';
import type { AcceptedResponse, InteractiveSession, InteractiveSurfaceRevision } from '../../src/types.js';
import type {
  ReceiptClaims,
  ReceiptClaimsV1,
  ReceiptClaimsV2,
  ReceiptKeySet,
  VerifyDecisionReceiptInput,
} from '../../src/receipts/verify.js';
import type { RevisionEnvelope, RevisionEnvelopeFull } from '../../src/receipts/envelope.js';

// RFC 8032 §7.1 test 1 seed. This public test vector is never a runtime or fixture-secret input.
const seed = '9d61b19deffd5a60ba844af492ec2cc44449c5697b326919703bac031cae7f60';
export const privateKey = createPrivateKey({
  key: Buffer.from(`302e020100300506032b657004220420${seed}`, 'hex'),
  type: 'pkcs8',
  format: 'der',
});
export const publicKey = createPublicKey(privateKey);
export const issuer = 'https://api.sess.example';
export const workspace = 'wks_synthetic_one';
export const sessionId = 'ses_01JABCDEFGHJKMNPQRSTVWXYZ0';
export const eventId = 'evt_01JABCDEFGHJKMNPQRSTVWXYZ1';
export const now = Date.parse('2026-10-12T18:00:00.000Z');

// Deliberately independent test-only JCS for these known JSON fixtures. Tests also carry
// fixed canonical text/digests; production canonicalization is the maintained dependency.
export function independentCanonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(independentCanonical).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${independentCanonical((value as Record<string, unknown>)[key])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

export function digest(value: unknown): string {
  return `sha256:${createHash('sha256').update(independentCanonical(value)).digest('hex')}`;
}

export function signPayload(
  payload: string,
  header: unknown = { alg: 'EdDSA', kid: 'rfc8032-test-1', typ: 'sess-receipt+jwt' },
  key = privateKey,
): string {
  const protectedHeader = typeof header === 'string' ? header : JSON.stringify(header);
  const signingInput = `${Buffer.from(protectedHeader).toString('base64url')}.${Buffer.from(payload).toString('base64url')}`;
  return `${signingInput}.${sign(null, Buffer.from(signingInput), key).toString('base64url')}`;
}

export function signClaims(claims: ReceiptClaims, header?: unknown): string {
  return signPayload(independentCanonical(claims), header);
}

export function fixture(acceptedMillis = now - 1000) {
  const interaction: InteractiveSurfaceRevision['interaction'] = {
    mode: 'interactive',
    title: 'Review synthetic Café invoice',
    description: 'Complete immutable description.',
    source: {
      kind: 'sess_surface',
      components: [
        { type: 'record', label: 'INV-001', fields: { amount: 120, currency: 'CAD', nested_name: 'é' } },
        {
          type: 'field',
          name: 'amount',
          label: 'Correct amount',
          required: true,
          schema: { type: 'number', minimum: 0 },
          value: 120,
        },
      ],
    },
    actions: [{ id: 'submit', label: 'Submit review', intent: 'submit' }],
    response_policy: 'first',
  };
  const data = { amount: 125.5, selection: ['A', 'B'], metadata: { unicode: 'é🦉', __value: 'preserved' } };
  const acceptedAt = new Date(acceptedMillis).toISOString();
  const claims: ReceiptClaims = {
    sess_receipt: 1,
    iss: issuer,
    aud: workspace,
    jti: eventId,
    iat: Math.floor(acceptedMillis / 1000),
    exp: Math.floor(acceptedMillis / 1000) + 3600,
    accepted_at: acceptedAt,
    workspace_id: workspace,
    session_id: sessionId,
    step_id: 'rev_1',
    event_id: eventId,
    surface: { revision: 1, hash: digest(interaction), renderer_version: 'sess-html-form-1' },
    action: { id: 'submit', label: 'Submit review', summary: 'submit' },
    input_hash: digest(data),
    actor: { assurance: 'link_holder', subject: `${workspace}:human_link:${sessionId}` },
    return_binding: { recipient: workspace, return_channel_id: null },
  };
  const receipt = signClaims(claims);
  const response: AcceptedResponse = {
    event_id: eventId,
    sequence: 1,
    revision: 1,
    action_id: 'submit',
    data,
    actor: { assurance: 'link_holder' },
    accepted_at: acceptedAt,
    receipt,
  };
  const surface: InteractiveSurfaceRevision = {
    id: sessionId,
    revision: 1,
    interaction,
    response_schema: { type: 'object' },
  };
  const session: InteractiveSession = {
    id: sessionId,
    revision: 1,
    status: 'responded',
    // The served contract requires every Session to carry its human link's stored expiry.
    action_expires_at: new Date(acceptedMillis + 7 * 24 * 60 * 60 * 1000).toISOString(),
    // Decision 0009 Amendment 10: a seven-day link has no horizon and is never extended.
    action_expires_horizon: null,
    extensions_used: 0,
    link_state: 'live',
    extensions: [],
    interaction,
    response_schema: { type: 'object' },
    responses: [response],
  };
  const keys: ReceiptKeySet = {
    keys: [
      {
        kty: 'OKP',
        crv: 'Ed25519',
        x: publicKey.export({ format: 'jwk' }).x as string,
        kid: 'rfc8032-test-1',
        alg: 'EdDSA',
        use: 'sig',
        key_ops: ['verify'],
      },
    ],
  };
  const input: VerifyDecisionReceiptInput = {
    receipt,
    issuer,
    audience: workspace,
    expected: { sessionId, eventId, revision: 1, actionId: 'submit', acceptedAt },
    input: data,
    interaction,
    keys,
  };
  return { claims, response, surface, session, keys, input };
}

/** A titles nonce: sixteen 0x5a bytes, unpadded base64url (the Sess QR evidence's). */
export const NONCE = Buffer.alloc(16, 0x5a).toString('base64url');

/**
 * The revision envelope of the fixture's revision 1 (receipt-v2 §2, `sess_revision: 2`) in its
 * full form, as Sess returns it: published by an API key on a Session started at the registered
 * address `bike-shop`, titled "Example bike shop".
 */
export function envelopeOf(
  f: ReturnType<typeof fixture>,
  over: Record<string, unknown> = {},
): RevisionEnvelopeFull {
  return {
    sess_revision: 2,
    revision: 1,
    session_id: sessionId,
    surface_hash: f.claims.surface.hash,
    renderer_version: f.claims.surface.renderer_version,
    published_at: '2026-10-12T17:50:00.123Z',
    key_id: 'key_01JABCDEFGHJKMNPQRSTVWXYZ2',
    grant_id: null,
    agent_target: { id: 'tgt_01JABCDEFGHJKMNPQRSTVWXYZ4', version: 3, name: 'bike-shop' },
    ask_id: null,
    titles: { nonce: NONCE, grant_title: null, target_title: 'Example bike shop', owner_name: null },
    ...over,
  } as RevisionEnvelopeFull;
}

/** The ten common members, in order (receipt-v2 §2). */
export const ENVELOPE_MEMBERS = [
  'sess_revision',
  'revision',
  'session_id',
  'surface_hash',
  'renderer_version',
  'published_at',
  'key_id',
  'grant_id',
  'agent_target',
  'ask_id',
] as const;

/** `titles_digest`, by hand: base64url SHA-256 of the independent canonical JSON of `titles`. */
export function titlesDigestOf(titles: unknown): string {
  return createHash('sha256').update(independentCanonical(titles)).digest('base64url');
}

/** The compact form of a full envelope, by hand: the common members, then `titles_digest`. */
export function compactOf(envelope: object): Record<string, unknown> {
  const { titles, ...rest } = envelope as Record<string, unknown>;
  return { ...rest, titles_digest: titlesDigestOf(titles) };
}

/**
 * `revision_hash`, by hand (receipt-v2 §2): the SHA-256 of the canonical compact form; a full form
 * has its `titles` replaced by their digest first. Any other object is digested as it is.
 */
export function revisionDigest(envelope: object): string {
  const e = envelope as Record<string, unknown>;
  return digest(Object.hasOwn(e, 'titles') ? compactOf(e) : e);
}

/**
 * The same accepted record with a receipt v2 (typ sess-receipt-2+jwt) committing to `committed`
 * (by default the envelope returned beside it), and that envelope on the response and the input.
 * The receipt v1 fixture above is unchanged.
 */
export function fixtureV2(
  acceptedMillis = now - 1000,
  options: { envelope?: object; committed?: object } = {},
) {
  const f = fixture(acceptedMillis);
  const envelope = (options.envelope ?? envelopeOf(f)) as RevisionEnvelopeFull;
  const committed = options.committed ?? envelope;
  const claims: ReceiptClaimsV2 = {
    ...(f.claims as ReceiptClaimsV1),
    sess_receipt: 2,
    surface: { ...f.claims.surface, revision_hash: revisionDigest(committed) },
  };
  const receipt = signClaims(claims, { alg: 'EdDSA', kid: 'rfc8032-test-1', typ: 'sess-receipt-2+jwt' });
  const response: AcceptedResponse = { ...f.response, receipt, revision_envelope: envelope };
  const session: InteractiveSession = { ...f.session, responses: [response] };
  const input: VerifyDecisionReceiptInput = { ...f.input, receipt, revisionEnvelope: envelope };
  return { ...f, claims, envelope, response, session, input };
}

export function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
