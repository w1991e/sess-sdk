// P2-22 Commerce B: the five builders. Each returns an ordinary interactive Surface that Sess
// accepts as sent: checked here against the runtime's schemas, its items checks and its
// request_change rule (tests/fixtures/runtime-items-contract.json), and sent through the SDK's
// create path to a synthetic runtime.
import { describe, expect, it } from 'vitest';
import {
  COMMERCE_DEFAULTS,
  Sess,
  invoice,
  money,
  purchaseOrder,
  quote,
  receipt,
  refund,
  type BillInput,
  type ItemsComponent,
  type RefundInput,
} from '../../src/index.js';
import { API_KEY, creation } from '../fixtures/api.js';
import { refusal, runtimeSurfaceFailure } from '../fixtures/commerce.js';

const BILL: BillInput = {
  currency: 'CAD',
  rows: [
    { name: 'Design retainer, October', amount: 420000 },
    { name: 'Additional revisions, landing page v3', detail: '3 × $150.00', amount: 45000 },
    { name: 'Early-payment discount', detail: 'Paid within 10 days', amount: -23750 },
  ],
  lines: [{ label: 'GST 5%', amount: 22062, role: 'tax' }],
};
const itemsOf = (i: { source: { components: unknown[] } }) =>
  i.source.components.find((c) => (c as { type: string }).type === 'items') as ItemsComponent;
const actionsOf = (i: { actions: { id: string; label: string; intent?: string }[] }) =>
  i.actions.map((a) => `${a.id}:${a.label}:${a.intent}`);

describe('the five builders', () => {
  it.each([
    ['invoice', invoice, 'Approve this invoice?', ['decline:Decline:reject', 'approve:Approve:approve']],
    ['receipt', receipt, 'Your receipt', ['continue:Continue:continue']],
    ['quote', quote, 'Accept this quote?', ['decline:Decline:reject', 'accept:Accept:approve']],
    ['refund', refund, 'Approve the refund?', ['decline:Decline:reject', 'approve:Approve:approve']],
    [
      'purchaseOrder',
      purchaseOrder,
      'Approve the order?',
      ['decline:Decline:reject', 'change:Request changes:request_change', 'approve:Approve:approve'],
    ],
  ] as const)(
    '%s: an interaction Sess accepts, with its title, actions and exact totals',
    (kind, build, title, actions) => {
      const input =
        kind === 'refund'
          ? {
              currency: 'EUR',
              rows: [
                { name: 'Wool scarf', amount: 4500 },
                { name: 'Leather gloves', amount: 2900 },
              ],
            }
          : BILL;
      const interaction = build(input);
      expect(interaction.mode).toBe('interactive');
      expect(interaction.title).toBe(title);
      expect(actionsOf(interaction)).toEqual(actions);
      expect(interaction.source.components).toHaveLength(1);
      const totals = itemsOf(interaction).totals?.map((t) => [t.label, t.amount, t.role]);
      expect(totals).toEqual(
        kind === 'refund'
          ? [['Refund total', 7400, 'total']]
          : [
              ['Subtotal', 441250, 'subtotal'],
              ['GST 5%', 22062, 'tax'],
              ['Total', 463312, 'total'],
            ],
      );
      expect(runtimeSurfaceFailure(interaction)).toBeNull();
    },
  );

  it('the happy path is one call: sess.sessions.create({ interaction: invoice(...) })', async () => {
    const sent: unknown[] = [];
    const fetch = async (_url: RequestInfo | URL, init?: RequestInit) => {
      sent.push(JSON.parse(String(init?.body)));
      return creation();
    };
    const sess = new Sess({ apiKey: API_KEY, fetch });
    const interaction = invoice({ ...BILL, reference: 'INV-2041' });
    const created = await sess.sessions.create({ interaction });
    expect(created.data.revision).toBe(1);
    expect(sent).toEqual([{ interaction }]);
  });

  it('the reference sits in a record under a plain name, before the card; pointers follow it', () => {
    const interaction = invoice({
      ...BILL,
      reference: 'INV-2026-10-000417-ACME-STUDIO',
      record: { Due: '30 November 2026' },
    });
    expect(interaction.source.components[0]).toEqual({
      type: 'record',
      fields: { Invoice: 'INV-2026-10-000417-ACME-STUDIO', Due: '30 November 2026' },
    });
    expect(runtimeSurfaceFailure(interaction)).toBeNull();
    for (const [build, name] of [
      [receipt, 'Receipt'],
      [quote, 'Quote'],
      [refund, 'Refund'],
      [purchaseOrder, 'Purchase order'],
    ] as const)
      expect(
        build({ currency: 'USD', rows: [{ name: 'A', amount: 1 }], reference: 'R-1' }).source.components[0],
      ).toEqual({
        type: 'record',
        fields: { [name]: 'R-1' },
      });
    const e = refusal(() =>
      invoice({ ...BILL, reference: 'INV-1', rows: [{ name: 'x'.repeat(81), amount: 1 }] }),
    );
    expect([e.field, e.limit, e.length]).toEqual(['/interaction/source/components/1/rows/0/name', 80, 81]);
    const key = refusal(() => invoice({ ...BILL, record: { ['k'.repeat(41)]: 'v' } }));
    expect([key.field, key.limit]).toEqual([`/interaction/source/components/0/fields/${'k'.repeat(41)}`, 40]);
    const value = refusal(() => invoice({ ...BILL, record: { Note: 'v'.repeat(201) } }));
    expect([value.field, value.limit, value.length]).toEqual([
      '/interaction/source/components/0/fields/Note',
      200,
      201,
    ]);
    expect(refusal(() => invoice({ ...BILL, reference: 'A', record: { Invoice: 'B' } })).field).toBe(
      '/interaction/source/components/0/fields/Invoice',
    );
  });

  it('title, description and locale: the page around the bill, checked as Sess checks it', () => {
    const interaction = quote({
      ...BILL,
      title: 'Accept the quote for the dock?',
      description: 'Northside Facilities sent a quote.',
      locale: 'en-CA',
      record: { 'Valid until': '30 November 2026' },
    });
    expect(interaction).toMatchObject({ title: 'Accept the quote for the dock?', locale: 'en-CA' });
    expect(runtimeSurfaceFailure(interaction)).toBeNull();
    const title = refusal(() => invoice({ ...BILL, title: 't'.repeat(81) }));
    expect([title.field, title.message]).toEqual([
      '/interaction/title',
      'The title can be at most 80 characters. Keep it to a short heading, about 40.',
    ]);
    expect(invoice({ ...BILL, title: 't'.repeat(80) }).title).toHaveLength(80);
    expect(refusal(() => invoice({ ...BILL, description: 'd'.repeat(281) })).limit).toBe(280);
    expect(refusal(() => invoice({ ...BILL, locale: 'en_CA' })).message).toBe(
      '/interaction/locale is not a locale Sess can format; use a BCP 47 tag such as en-CA, or leave it out.',
    );
  });

  it('JPY and BHD bills keep their minor units exactly', () => {
    const yen = receipt({
      currency: 'JPY',
      rows: [
        { name: 'Shinkansen', amount: money(28340, 'JPY') },
        { name: 'Breakfast', detail: 'Included', amount: null },
      ],
    });
    expect(itemsOf(yen).totals).toEqual([{ label: 'Total', amount: 28340, role: 'total' }]);
    const fils = invoice({
      currency: 'BHD',
      rows: [{ name: 'Karak tea', detail: '5 × 0.500', amount: 2500 }],
      lines: [{ label: 'VAT 10%', amount: 250, role: 'tax' }],
    });
    expect(itemsOf(fils).totals?.map((t) => t.amount)).toEqual([2500, 250, 2750]);
    expect(runtimeSurfaceFailure(yen)).toBeNull();
    expect(runtimeSurfaceFailure(fils)).toBeNull();
  });
});

describe('refund(): positive amounts under refund labels, never a negative total', () => {
  const base: RefundInput = {
    currency: 'EUR',
    rows: [
      { name: 'Wool scarf', amount: 4500 },
      { name: 'Leather gloves', amount: 2900 },
    ],
  };

  it('states what is refunded as positive amounts, a deduction as a negative line', () => {
    const interaction = refund({ ...base, lines: [{ label: 'Restocking fee', amount: -500, role: 'fee' }] });
    expect(itemsOf(interaction).totals).toEqual([
      { label: 'Subtotal', amount: 7400, role: 'subtotal' },
      { label: 'Restocking fee', amount: -500, role: 'fee' },
      { label: 'Refund total', amount: 6900, role: 'total' },
    ]);
    expect(itemsOf(interaction).rows.every((r) => r.amount === null || r.amount >= 0)).toBe(true);
    expect(runtimeSurfaceFailure(interaction)).toBeNull();
  });

  it('refuses a negative row and a negative total; has no payments', () => {
    const row = refusal(() => refund({ ...base, rows: [{ name: 'Scarf', amount: -4500 }] }));
    expect([row.field, row.message]).toEqual([
      '/interaction/source/components/0/rows/0/amount',
      '/interaction/source/components/0/rows/0/amount is negative; a refund states what is refunded as a positive amount (a deduction is a negative line).',
    ]);
    const total = refusal(() =>
      refund({ ...base, lines: [{ label: 'Restocking fee', amount: -8000, role: 'fee' }] }),
    );
    expect(total.field).toBe('/interaction/source/components/0/totals/2/amount');
    expect(
      refund({ ...base, lines: [{ label: 'Restocking fee', amount: -7400, role: 'fee' }] }),
    ).toBeTruthy(); // zero is not negative
    expect(
      refusal(() => refund({ ...base, payments: [{ label: 'Paid', amount: -1 }] } as RefundInput)).field,
    ).toBe('/interaction');
  });

  it('with select many the person chooses the rows to refund (named refund)', () => {
    const interaction = refund({ ...base, select: 'many' });
    expect(itemsOf(interaction)).toMatchObject({ select: 'many', name: 'refund' });
    expect(runtimeSurfaceFailure(interaction)).toBeNull();
    expect(refund({ ...base, labels: { total: 'Refund' } }).source.components[0]).toMatchObject({
      totals: [{ label: 'Refund', amount: 7400, role: 'total' }],
    });
  });
});

describe('editable quantities need a way to send the edit (request_change)', () => {
  const order: BillInput = {
    currency: 'USD',
    rows: [
      {
        name: 'Printer paper, A4, 500 sheets',
        detail: '$4.99 each',
        quantity: { value: 10, unit: 'boxes', max: 50 },
        amount: 4990,
      },
      {
        name: 'Toner cartridge',
        detail: '$79.90 each',
        quantity: { value: 2, min: 1, max: 10 },
        amount: 15980,
      },
      { name: 'Delivery', amount: 1500 },
    ],
  };

  it('purchaseOrder(): editable quantity, named order, with Request changes', () => {
    const interaction = purchaseOrder(order);
    expect(itemsOf(interaction)).toMatchObject({ editable: ['quantity'], name: 'order' });
    expect(interaction.actions).toContainEqual({
      id: 'change',
      label: 'Request changes',
      intent: 'request_change',
    });
    expect(runtimeSurfaceFailure(interaction)).toBeNull();
  });

  it('any builder with a quantity adds Request changes; without one, only purchaseOrder offers it', () => {
    for (const build of [invoice, quote, receipt, refund]) {
      const interaction = build(order);
      expect(interaction.actions.filter((a) => a.intent === 'request_change')).toHaveLength(1);
      expect(runtimeSurfaceFailure(interaction)).toBeNull();
    }
    expect(invoice(BILL).actions.some((a) => a.intent === 'request_change')).toBe(false);
  });

  it('replacing the actions without a change request is refused as Sess refuses it', () => {
    const e = refusal(() =>
      purchaseOrder({ ...order, actions: [{ id: 'approve', label: 'Approve', intent: 'approve' }] }),
    );
    expect([e.field, e.message]).toEqual([
      '/interaction/source/components/0/editable',
      '/interaction/source/components/0/editable needs an action with intent request_change in interaction.actions, such as "Request changes", so the person can send a changed quantity.',
    ]);
    // The same Surface without the builder's check is what the runtime refuses.
    const raw = purchaseOrder(order);
    expect(
      runtimeSurfaceFailure({ ...raw, actions: [{ id: 'approve', label: 'Approve', intent: 'approve' }] }),
    ).toBe('/interaction/source/components/0/editable');
    const relabelled = purchaseOrder({
      ...order,
      actions: [
        { id: 'no', label: 'Nein', intent: 'reject' },
        { id: 'change', label: 'Änderungen senden', intent: 'request_change' },
        { id: 'yes', label: 'Genehmigen', intent: 'approve' },
      ],
    });
    expect(runtimeSurfaceFailure(relabelled)).toBeNull();
  });

  it('actions are checked: 1–5, unique ids, labels at most 24', () => {
    expect(refusal(() => invoice({ ...BILL, actions: [] })).field).toBe('/interaction/actions');
    expect(
      refusal(() =>
        invoice({
          ...BILL,
          actions: [
            { id: 'a', label: 'A' },
            { id: 'a', label: 'B' },
          ],
        }),
      ).message,
    ).toBe('/interaction/actions action ids must be unique.');
    const label = refusal(() => invoice({ ...BILL, actions: [{ id: 'a', label: 'l'.repeat(25) }] }));
    expect([label.field, label.limit, label.length]).toEqual(['/interaction/actions/0/label', 24, 25]);
  });
});

describe('builder defaults', () => {
  it('are the listed strings, each within its limit', () => {
    for (const title of Object.values(COMMERCE_DEFAULTS.titles))
      expect([...title].length).toBeLessThanOrEqual(80);
    for (const key of Object.values(COMMERCE_DEFAULTS.references))
      expect([...key].length).toBeLessThanOrEqual(40);
    for (const a of Object.values(COMMERCE_DEFAULTS.actions))
      expect([...a.label].length).toBeLessThanOrEqual(24);
    expect(COMMERCE_DEFAULTS.actions.change.label).toBe('Request changes'); // signed CM-34
    expect([...COMMERCE_DEFAULTS.refundTotal].length).toBeLessThanOrEqual(40);
  });
});
