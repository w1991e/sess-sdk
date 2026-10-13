import { Sess, type InteractiveInteraction } from '@sess/sdk';

/** Ordinary typed data describes the interaction; SESS owns its hosted renderer. */
export const invoiceInteraction = {
  mode: 'interactive',
  title: 'Review a synthetic invoice',
  description: 'Check the proposed amount before submitting your review.',
  source: {
    kind: 'sess_surface',
    components: [
      { type: 'heading', text: 'Invoice INV-001' },
      { type: 'text', text: 'This example uses fictional data and makes no payment.' },
      {
        type: 'record',
        label: 'Invoice details',
        fields: { Supplier: 'Example supplier', Currency: 'USD', Amount: 120 },
      },
      {
        type: 'field',
        name: 'amount',
        label: 'Correct amount',
        description: 'Enter the amount you intend to accept.',
        required: true,
        schema: { type: 'number', minimum: 0 },
        value: 120,
      },
    ],
  },
  actions: [{ id: 'submit', label: 'Submit review', intent: 'submit' }],
} satisfies InteractiveInteraction;

/** A minimal in-process example. Use multi-round.ts for checkpointed continuation. */
export async function reviewInvoice(
  sess: Sess,
  deliverPrivately: (humanUrl: string) => Promise<void>,
  expectedWorkspaceId?: string,
): Promise<number> {
  const created = await sess.sessions.create({ interaction: invoiceInteraction });
  await deliverPrivately(created.data.human_url);
  const answer = await sess.sessions.waitForResponse(created.data.id, { revision: created.data.revision });
  const verified = await sess.receipts.verifyResponse({
    sessionId: created.data.id,
    response: answer.response,
    ...(expectedWorkspaceId ? { expectedWorkspaceId } : {}),
  });
  const amount = verified.response.data.amount;
  if (typeof amount !== 'number' || !Number.isFinite(amount))
    throw new Error('Expected an accepted numeric amount.');
  return amount;
}
