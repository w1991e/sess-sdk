import { Sess, type AcceptedResponse } from '@sess.si/sdk';
import { verifyDecisionReceipt, type ReceiptKeySet } from '@sess.si/sdk/receipts';

/** The application supplies configuration explicitly; imports do not contact any service. */
export async function verifyAcceptedResponse(
  sess: Sess,
  sessionId: string,
  response: AcceptedResponse,
  expectedWorkspaceId?: string,
) {
  return sess.receipts.verifyResponse({
    sessionId,
    response,
    ...(expectedWorkspaceId ? { expectedWorkspaceId } : {}),
  });
}

/** Explicit keys keep verification offline, including in an archival verifier. */
export async function verifyOffline(input: {
  receipt: string | null;
  issuer: string;
  workspaceId: string;
  sessionId: string;
  response: AcceptedResponse;
  interaction: Parameters<typeof verifyDecisionReceipt>[0]['interaction'];
  trustedKeys: ReceiptKeySet;
}) {
  return verifyDecisionReceipt({
    receipt: input.receipt,
    issuer: input.issuer,
    audience: input.workspaceId,
    expected: {
      sessionId: input.sessionId,
      eventId: input.response.event_id,
      revision: input.response.revision,
      actionId: input.response.action_id,
      acceptedAt: input.response.accepted_at,
    },
    input: input.response.data,
    interaction: input.interaction,
    keys: input.trustedKeys,
  });
}
