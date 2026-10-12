import type { AcceptedResponse, InteractiveInteraction, InteractiveSession } from '../../src/types.js';

export const SESSION_ID = 'ses_00000000000000000000000001';
export const EVENT_ID = 'evt_00000000000000000000000001';
export const WORKSPACE = 'ws_00000000000000000000000001';
export const API_KEY = 'test-owner-credential';
export const INTERACTION: InteractiveInteraction = {
  mode: 'interactive',
  title: 'Review synthetic invoice',
  source: {
    kind: 'sess_surface',
    components: [
      { type: 'record', label: 'INV-001', fields: { amount: 120 } },
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
};
export const RESPONSE: AcceptedResponse = {
  event_id: EVENT_ID,
  sequence: 1,
  revision: 1,
  action_id: 'submit',
  data: { amount: 120 },
  actor: { assurance: 'link_holder' },
  accepted_at: '2026-10-12T12:00:00.000Z',
  receipt: null,
};
export function session(overrides: Partial<InteractiveSession> = {}): InteractiveSession {
  return {
    id: SESSION_ID,
    revision: 1,
    status: 'active',
    interaction: { ...INTERACTION, response_policy: 'first' },
    response_schema: {
      type: 'object',
      properties: { amount: { type: 'number' } },
      required: ['amount'],
      additionalProperties: false,
    },
    responses: [],
    ...overrides,
  } as InteractiveSession;
}
export function json(value: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  });
}
export function creation(headers: Record<string, string> = {}): Response {
  return json(
    { id: SESSION_ID, revision: 1, human_url: 'https://app.example/s/private-test-capability' },
    201,
    { etag: '"revision-1"', ...headers },
  );
}
export function apiError(status: number, code: string, extra: Record<string, unknown> = {}): Response {
  return json(
    { error: { code, request_id: 'request-123', message: 'remote secret must not be shown', ...extra } },
    status,
  );
}
