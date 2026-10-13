import { createHash, createPrivateKey, createPublicKey, sign } from 'node:crypto';
import type { AcceptedResponse, InteractiveSession, InteractiveSurfaceRevision } from '../../src/types.js';
import type { ReceiptClaims, ReceiptKeySet, VerifyDecisionReceiptInput } from '../../src/receipts/verify.js';

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

export function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
