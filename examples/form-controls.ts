import { type CreateSessionRequest, type InteractiveInteraction, type Sess } from '@sess.si/sdk';

/** Synthetic authoring example. Order and business text are application choices. */
export const formControls: InteractiveInteraction = {
  mode: 'interactive',
  title: 'Review a synthetic request',
  source: {
    kind: 'sess_surface',
    components: [
      { type: 'heading', text: 'Request DEMO-001' },
      { type: 'text', text: 'Review these proposed values. This example authorizes no purchase.' },
      { type: 'record', label: 'Context only', fields: { Supplier: 'Example supplier', Currency: 'USD' } },
      {
        type: 'field',
        name: 'amount',
        label: 'Accepted amount',
        required: true,
        schema: { type: 'number', minimum: 0 },
        value: 120,
      },
      {
        type: 'field',
        name: 'quantity',
        label: 'Quantity',
        required: true,
        schema: { type: 'integer', minimum: 1, maximum: 10 },
        value: 1,
      },
      {
        type: 'field',
        name: 'category',
        label: 'Expense category',
        required: true,
        schema: { type: 'string', enum: ['office', 'travel'] },
        option_labels: { office: 'Office supplies', travel: 'Business travel' },
        value: 'office',
      },
      {
        type: 'field',
        name: 'checks',
        label: 'Checks performed',
        schema: { type: 'array', items: { type: 'string', enum: ['invoice', 'budget'] }, uniqueItems: true },
        option_labels: { invoice: 'Invoice checked', budget: 'Budget checked' },
        value: [],
      },
      {
        type: 'field',
        name: 'reviewed',
        label: 'I reviewed the proposed values',
        required: true,
        schema: { type: 'boolean' },
        value: false,
      },
      {
        type: 'field',
        name: 'notes',
        label: 'Optional review notes',
        required: false,
        multiline: true,
        schema: { type: 'string', maxLength: 500 },
        value: '',
      },
    ],
  },
  actions: [{ id: 'submit', label: 'Submit my review', intent: 'submit' }],
};

/** Serialize this same envelope with JSON.stringify for direct HTTP. */
export const formRequest = { interaction: formControls } satisfies CreateSessionRequest;

/** Creates a real Session when explicitly called with a configured client. */
export function previewForm(sess: Sess) {
  return sess.sessions.create(formRequest);
}
