// P2-22 Commerce B: money() and the items builder. Synthetic bills; the expected totals are the
// runtime's own fixtures (w1991e/sess packages/core/test/fixtures/items.ts), so a bill built here
// adds up exactly as Sess checks it.
import { describe, expect, it } from 'vitest';
import {
  ITEMS_DEFAULT_LABELS,
  ITEMS_LIMITS,
  Sess,
  items,
  money,
  type ItemRowInput,
} from '../../src/index.js';
import { API_KEY, SESSION_ID, json, session, INTERACTION } from '../fixtures/api.js';
import { refusal, runtimeItemsFailure } from '../fixtures/commerce.js';

const row = (amount: number | null, name = 'Line'): ItemRowInput => ({ name, amount });

describe('reading a Session that carries an items component', () => {
  it('decodes it (the boundary decoder knows the items type) and keeps it as sent', async () => {
    const component = items({ currency: 'USD', rows: [row(1200, 'Booking fee')] });
    const interaction = {
      ...INTERACTION,
      source: { kind: 'sess_surface' as const, components: [component] },
      response_policy: 'first' as const,
    };
    // The read types come from the contract snapshot, which predates items: the cast is the test's.
    const fetch = async () =>
      json(session({ interaction: interaction as never }), 200, { etag: '"revision-1"' });
    const sdk = new Sess({ apiKey: API_KEY, fetch });
    const read = await sdk.sessions.retrieve(SESSION_ID);
    expect(read.data.interaction.source).toEqual(interaction.source);
    const broken = {
      ...interaction,
      source: { ...interaction.source, components: [{ ...component, currency: 'usd' }] },
    };
    const bad = new Sess({
      apiKey: API_KEY,
      fetch: async () => json(session({ interaction: broken as never }), 200, { etag: '"revision-1"' }),
    });
    await expect(bad.sessions.retrieve(SESSION_ID)).rejects.toMatchObject({ code: 'INVALID_RESPONSE' });
  });
});

describe('money()', () => {
  it('keeps a whole number of minor units and its ISO 4217 code, frozen', () => {
    const m = money(1250, 'USD');
    expect(m).toEqual({ amount: 1250, currency: 'USD' });
    expect(Object.isFrozen(m)).toBe(true);
    expect(money(1250, 'JPY')).toEqual({ amount: 1250, currency: 'JPY' });
    expect(money(1250, 'BHD')).toEqual({ amount: 1250, currency: 'BHD' });
    expect(money(-2000, 'EUR').amount).toBe(-2000);
    expect(Object.is(money(-0, 'EUR').amount, 0)).toBe(true);
  });

  it('accepts the amount range exactly and refuses one minor unit beyond it', () => {
    expect(money(ITEMS_LIMITS.amount, 'USD').amount).toBe(1e15);
    expect(money(-ITEMS_LIMITS.amount, 'USD').amount).toBe(-1e15);
    for (const amount of [ITEMS_LIMITS.amount + 1, -ITEMS_LIMITS.amount - 1])
      expect(refusal(() => money(amount, 'USD')).code).toBe('INVALID_SCHEMA');
  });

  it('never rounds: a fraction of the minor unit, NaN, Infinity or a string is refused', () => {
    for (const amount of [12.5, 1.005, 0.1, Number.NaN, Infinity, '1250' as unknown as number]) {
      const e = refusal(() => money(amount, 'USD'));
      expect(e.code).toBe('INVALID_SCHEMA');
      expect(e.message).toBe(
        "money(): the amount must be a whole number of the currency's smallest unit (cents for USD, yen for JPY, fils for BHD), within ±1000000000000000: 1250 for 12.50 USD. Sess never rounds.",
      );
    }
  });

  it('refuses a code Sess does not accept: unknown, lowercase, or without minor units', () => {
    for (const code of ['XYZ', 'usd', 'XAU', 'XDR', 'XXX', '', 'USDT']) {
      const e = refusal(() => money(100, code));
      expect(e.message).toBe(
        'money(): the currency is not an ISO 4217 code with known minor units; use one such as USD, EUR or JPY.',
      );
    }
  });
});

describe('items()', () => {
  it('computes the subtotal and total of the runtime invoice fixture exactly (CAD, a negative discount row)', () => {
    const component = items({
      label: 'Invoice 2041',
      currency: 'CAD',
      rows: [
        { name: 'Design retainer, October', amount: 420000 },
        { name: 'Additional revisions beyond scope, landing page v3', detail: '3 × $150.00', amount: 45000 },
        {
          name: 'Stock photography licence',
          detail: '2 × $49.99',
          reference: 'SKU STK-88213-A',
          amount: 9998,
        },
        { name: 'Early-payment discount', detail: 'Paid within 10 days', amount: -23750 },
      ],
      lines: [{ label: 'GST 5%', amount: 22562, role: 'tax' }],
    });
    // The runtime's INVOICE fixture, member for member.
    expect(component).toEqual({
      type: 'items',
      label: 'Invoice 2041',
      currency: 'CAD',
      rows: [
        { name: 'Design retainer, October', amount: 420000 },
        { name: 'Additional revisions beyond scope, landing page v3', detail: '3 × $150.00', amount: 45000 },
        { name: 'Stock photography licence', detail: '2 × $49.99 · SKU STK-88213-A', amount: 9998 },
        { name: 'Early-payment discount', detail: 'Paid within 10 days', amount: -23750 },
      ],
      totals: [
        { label: 'Subtotal', amount: 451248, role: 'subtotal' },
        { label: 'GST 5%', amount: 22562, role: 'tax' },
        { label: 'Total', amount: 473810, role: 'total' },
      ],
    });
    expect(runtimeItemsFailure(component)).toBeNull();
  });

  it('JPY (no decimals): fourteen rows with a null amount, a tax and a negative coupon', () => {
    const amounts = [28340, 21000, null, 4400, 0, 800, 1200, 1500, 2300, 3000, 4100, 6200, 2400, 1500];
    const component = items({
      currency: 'JPY',
      rows: amounts.map((a, i) => row(a, `Line ${i + 1}`)),
      lines: [
        { label: 'Consumption tax 10%', amount: 7674, role: 'tax' },
        { label: 'Coupon', amount: -2000, role: 'discount' },
      ],
    });
    expect(component.totals).toEqual([
      { label: 'Subtotal', amount: 76740, role: 'subtotal' },
      { label: 'Consumption tax 10%', amount: 7674, role: 'tax' },
      { label: 'Coupon', amount: -2000, role: 'discount' },
      { label: 'Total', amount: 82414, role: 'total' },
    ]);
    expect(component.rows[2]).toEqual({ name: 'Line 3', amount: null });
    expect(runtimeItemsFailure(component)).toBeNull();
  });

  it('BHD (three decimals, fils), with money() amounts in the same currency', () => {
    const component = items({
      currency: 'BHD',
      rows: [
        { name: 'Karak tea', detail: '5 × 0.500', amount: money(2500, 'BHD') },
        { name: 'Chicken machboos', amount: 3750 },
        { name: 'Water', amount: money(250, 'BHD') },
      ],
      lines: [{ label: 'VAT 10%', amount: money(650, 'BHD'), role: 'tax' }],
    });
    expect(component.rows.map((r) => r.amount)).toEqual([2500, 3750, 250]);
    expect(component.totals?.map((t) => [t.role, t.amount])).toEqual([
      ['subtotal', 6500],
      ['tax', 650],
      ['total', 7150],
    ]);
    expect(runtimeItemsFailure(component)).toBeNull();
  });

  it('an included tax is shown, never added; payments are counted once, in the amount due', () => {
    const component = items({
      currency: 'EUR',
      rows: [row(4800, 'Menu du jour'), row(1800, 'Carafe of wine')],
      lines: [
        { label: 'VAT 10%', amount: 600, role: 'tax', included: true },
        { label: 'Tip', amount: 700, role: 'tip' },
      ],
      payments: [{ label: 'Deposit paid', amount: -2000 }],
    });
    expect(component.totals).toEqual([
      { label: 'Subtotal', amount: 6600, role: 'subtotal' },
      { label: 'VAT 10%', amount: 600, role: 'tax', included: true },
      { label: 'Tip', amount: 700, role: 'tip' },
      { label: 'Total', amount: 7300, role: 'total' },
      { label: 'Deposit paid', amount: -2000, role: 'paid' },
      { label: 'Amount due', amount: 5300, role: 'due' },
    ]);
    expect(runtimeItemsFailure(component)).toBeNull();
  });

  it('without lines states only the total; totals: false states none; labels can be replaced', () => {
    expect(items({ currency: 'USD', rows: [row(1200)] }).totals).toEqual([
      { label: ITEMS_DEFAULT_LABELS.total, amount: 1200, role: 'total' },
    ]);
    const plain = items({ currency: 'USD', rows: [row(1200), row(12000)], totals: false });
    expect(plain).not.toHaveProperty('totals');
    expect(runtimeItemsFailure(plain)).toBeNull();
    expect(
      items({
        currency: 'USD',
        rows: [row(1000)],
        lines: [{ label: 'Shipping', amount: 500, role: 'shipping' }],
        payments: [{ label: 'Paid', amount: -1500 }],
        labels: { subtotal: 'Items', total: 'Order total', due: 'Balance due' },
      }).totals?.map((t) => t.label),
    ).toEqual(['Items', 'Shipping', 'Order total', 'Paid', 'Balance due']);
    expect(
      refusal(() =>
        items({
          currency: 'USD',
          rows: [row(1)],
          totals: false,
          lines: [{ label: 'Tax', amount: 1, role: 'tax' }],
        }),
      ).field,
    ).toBe('/totals');
  });

  it('adds exactly where Number would not: 1 + ten 10^15 + ten −10^15 is 1', () => {
    const rows = [
      row(1),
      ...Array.from({ length: 10 }, () => row(1e15)),
      ...Array.from({ length: 10 }, () => row(-1e15)),
    ];
    let float = 0;
    for (const r of rows) float += r.amount as number;
    expect(float).not.toBe(1); // the trap the BigInt accumulator avoids
    const component = items({ currency: 'USD', rows, lines: [{ label: 'Fee', amount: 0, role: 'fee' }] });
    expect(component.totals?.map((t) => t.amount)).toEqual([1, 0, 1]);
    expect(runtimeItemsFailure(component)).toBeNull();
  });

  it('refuses a sum outside ±10^15 rather than sending a total Sess cannot state', () => {
    const e = refusal(() => items({ currency: 'USD', rows: [row(1e15), row(1)] }));
    expect([e.field, e.message]).toEqual(['/rows', '/rows must be <= 1000000000000000.']);
    const t = refusal(() =>
      items({ currency: 'USD', rows: [row(1e15)], lines: [{ label: 'Tax', amount: 1, role: 'tax' }] }),
    );
    expect(t.field).toBe('/totals');
  });

  it('negative amounts: discount rows and lines are negative; a positive discount or payment is refused', () => {
    const component = items({
      currency: 'USD',
      rows: [row(5000), row(-500, 'Store credit')],
      lines: [{ label: 'Coupon', amount: -250, role: 'discount' }],
    });
    expect(component.totals?.map((t) => t.amount)).toEqual([4500, -250, 4250]);
    const discount = refusal(() =>
      items({
        currency: 'USD',
        rows: [row(5000)],
        lines: [{ label: 'Coupon', amount: 250, role: 'discount' }],
      }),
    );
    expect([discount.field, discount.message]).toEqual([
      '/totals/1/amount',
      '/totals/1/amount is a discount, so it is negative; state it with a minus sign.',
    ]);
    const payment = refusal(() =>
      items({ currency: 'USD', rows: [row(5000)], payments: [{ label: 'Paid', amount: 100 }] }),
    );
    expect(payment.field).toBe('/totals/1/amount');
  });

  it('one currency per component and only codes Sess accepts', () => {
    const other = refusal(() => items({ currency: 'CAD', rows: [{ name: 'A', amount: money(100, 'USD') }] }));
    expect([other.field, other.code]).toEqual(['/rows/0/amount', 'INVALID_SCHEMA']);
    const line = refusal(() =>
      items({
        currency: 'CAD',
        rows: [row(100)],
        lines: [{ label: 'Tax', amount: money(5, 'USD'), role: 'tax' }],
      }),
    );
    expect(line.field).toBe('/totals/1/amount');
    const unknown = refusal(() => items({ currency: 'XAU', rows: [row(100)] }));
    expect([unknown.field, unknown.message]).toEqual([
      '/currency',
      '/currency is not an ISO 4217 currency code with known minor units; use one such as USD, EUR or JPY.',
    ]);
  });

  it('refuses a fraction of a minor unit with the runtime validator words', () => {
    const e = refusal(() => items({ currency: 'USD', rows: [row(100), row(12.5)] }));
    expect([e.field, e.message]).toEqual(['/rows/1/amount', '/rows/1/amount must be integer.']);
    expect(refusal(() => items({ currency: 'USD', rows: [row(1e15 + 2)] })).message).toBe(
      '/rows/0/amount must be <= 1000000000000000.',
    );
  });
});

describe('items() limits: the boundary is accepted, one over is refused, never truncated', () => {
  const longText = (n: number) => '😀'.repeat(n); // code points, not UTF-16 units

  it.each([
    ['row name', 80, (s: string) => ({ currency: 'USD', rows: [{ name: s, amount: 1 }] }), '/rows/0/name'],
    [
      'row detail',
      160,
      (s: string) => ({ currency: 'USD', rows: [{ name: 'A', detail: s, amount: 1 }] }),
      '/rows/0/detail',
    ],
    ['caption', 200, (s: string) => ({ currency: 'USD', label: s, rows: [row(1)] }), '/label'],
    [
      'total label',
      40,
      (s: string) => ({ currency: 'USD', rows: [row(1)], labels: { total: s } }),
      '/totals/0/label',
    ],
    [
      'line label',
      40,
      (s: string) => ({
        currency: 'USD',
        rows: [row(1)],
        lines: [{ label: s, amount: 1, role: 'fee' as const }],
      }),
      '/totals/1/label',
    ],
    [
      'quantity unit',
      16,
      (s: string) => ({
        currency: 'USD',
        name: 'order',
        rows: [{ name: 'A', amount: 1, quantity: { value: 1, unit: s } }],
      }),
      '/rows/0/quantity/unit',
    ],
  ])('%s: %i code points', (_, limit, build, field) => {
    const ok = items(build(longText(limit)));
    expect(runtimeItemsFailure(ok)).toBeNull();
    const e = refusal(() => items(build(longText(limit + 1))));
    expect([e.code, e.field, e.limit, e.length]).toEqual(['INVALID_SCHEMA', field, limit, limit + 1]);
    expect(e.message).toBe(
      `${field} is ${limit + 1} characters; the limit is ${limit}. Shorten it to at most ${limit} characters.`,
    );
  });

  it('a reference joins the detail line and counts toward its 160', () => {
    const ok = items({
      currency: 'USD',
      rows: [{ name: 'A', detail: 'x'.repeat(100), reference: 'R'.repeat(57), amount: 1 }],
    });
    expect(ok.rows[0]?.detail).toHaveLength(160);
    const e = refusal(() =>
      items({
        currency: 'USD',
        rows: [{ name: 'A', detail: 'x'.repeat(100), reference: 'R'.repeat(58), amount: 1 }],
      }),
    );
    expect([e.field, e.limit, e.length]).toEqual(['/rows/0/detail', 160, 161]);
    expect(
      items({ currency: 'USD', rows: [{ name: 'Booking reference', reference: 'REF-88213', amount: 0 }] })
        .rows[0],
    ).toEqual({
      name: 'Booking reference',
      detail: 'REF-88213',
      amount: 0,
    });
  });

  it('rows: 100 accepted, 101 refused with the rows sentence; none refused', () => {
    const hundred = items({
      currency: 'USD',
      rows: Array.from({ length: 100 }, (_, i) => row(100 * (i + 1))),
    });
    expect(hundred.totals).toEqual([{ label: 'Total', amount: 505000, role: 'total' }]);
    expect(runtimeItemsFailure(hundred)).toBeNull();
    const e = refusal(() => items({ currency: 'USD', rows: Array.from({ length: 101 }, () => row(1)) }));
    expect([e.field, e.limit, e.length]).toEqual(['/rows', 100, 101]);
    expect(e.message).toBe(
      '/rows has 101 rows; the limit is 100. Send at most 100, in more than one items component if you need more.',
    );
    expect(refusal(() => items({ currency: 'USD', rows: [] })).field).toBe('/rows');
  });

  it('totals: 8 lines accepted, 9 refused with the totals sentence', () => {
    const lines = (n: number) =>
      Array.from({ length: n }, (_, i) => ({ label: `Fee ${i}`, amount: 1, role: 'fee' as const }));
    const eight = items({ currency: 'USD', rows: [row(10)], lines: lines(6) }); // subtotal + 6 + total
    expect(eight.totals).toHaveLength(8);
    expect(eight.totals?.at(-1)).toEqual({ label: 'Total', amount: 16, role: 'total' });
    expect(runtimeItemsFailure(eight)).toBeNull();
    const e = refusal(() => items({ currency: 'USD', rows: [row(10)], lines: lines(7) }));
    expect([e.field, e.limit, e.length]).toEqual(['/totals', 8, 9]);
    expect(e.message).toBe('/totals has 9 totals lines; the limit is 8. Send at most 8.');
    const withPayments = refusal(() =>
      items({
        currency: 'USD',
        rows: [row(10)],
        lines: lines(4),
        payments: [
          { label: 'Paid', amount: -1 },
          { label: 'Paid', amount: -1 },
        ],
      }),
    );
    expect(withPayments.length).toBe(9); // subtotal + 4 + total + 2 payments + due
  });

  it('a blank or missing name is refused, not invented', () => {
    expect(refusal(() => items({ currency: 'USD', rows: [{ name: '   ', amount: 1 }] })).message).toBe(
      '/rows/0/name must not be blank.',
    );
    expect(
      refusal(() => items({ currency: 'USD', rows: [{ amount: 1 } as unknown as ItemRowInput] })).field,
    ).toBe('/rows/0/name');
  });
});

describe('items() answers: select and editable quantity', () => {
  it('select many or one needs a name; a name needs select or a quantity', () => {
    const many = items({
      currency: 'USD',
      select: 'many',
      name: 'returns',
      rows: [row(11900), row(2400)],
      totals: false,
    });
    expect(many).toMatchObject({ select: 'many', name: 'returns' });
    expect(runtimeItemsFailure(many)).toBeNull();
    expect(refusal(() => items({ currency: 'USD', select: 'one', rows: [row(1)] })).message).toBe(
      'The items component has select or editable but no name; add a name for the answer.',
    );
    expect(refusal(() => items({ currency: 'USD', name: 'plan', rows: [row(1)] })).message).toBe(
      '/name applies only with select or editable; remove it.',
    );
    expect(refusal(() => items({ currency: 'USD', select: 'one', name: 'Plan', rows: [row(1)] })).field).toBe(
      '/name',
    );
  });

  it('a row quantity makes the quantity editable, within min and max', () => {
    const component = items({
      currency: 'USD',
      name: 'order',
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
    });
    expect(component).toMatchObject({ editable: ['quantity'], name: 'order' });
    expect(component.rows[0]?.quantity).toEqual({ value: 10, unit: 'boxes', max: 50 });
    expect(component.totals).toEqual([{ label: 'Total', amount: 22470, role: 'total' }]);
    expect(runtimeItemsFailure(component)).toBeNull();
    const q = (quantity: object) => () =>
      items({
        currency: 'USD',
        name: 'order',
        rows: [{ name: 'A', amount: 1, quantity: quantity as { value: number } }],
      });
    expect(refusal(q({ value: 11, max: 10 })).field).toBe('/rows/0/quantity/value');
    expect(refusal(q({ value: 1, min: 2, max: 1 })).message).toBe('/rows/0/quantity/min is more than max.');
    expect(refusal(q({ value: 1.5 })).message).toBe('/rows/0/quantity/value must be integer.');
    expect(refusal(q({ value: 1_000_001 })).field).toBe('/rows/0/quantity/value');
    expect(
      items({
        currency: 'USD',
        name: 'order',
        rows: [{ name: 'A', amount: 1, quantity: { value: 1_000_000 } }],
      }).rows[0]?.quantity,
    ).toEqual({ value: 1_000_000 });
    expect(
      refusal(() => items({ currency: 'USD', rows: [{ name: 'A', amount: 1, quantity: { value: 1 } }] }))
        .message,
    ).toBe('The items component has select or editable but no name; add a name for the answer.');
  });
});
