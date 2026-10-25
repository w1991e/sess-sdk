// P2-22 Commerce B: the SDK emits exactly what the runtime accepts. The oracle is an extract of the
// runtime at a recorded commit (tests/fixtures/runtime-items-contract.json): the OpenAPI schemas of
// the items and record components and the interactive interaction, and the ISO 4217 minor-unit
// table. Refresh the extract from the runtime when it changes; never edit it by hand.
import { describe, expect, it } from 'vitest';
import { ITEMS_LIMITS } from '../../src/index.js';
import { CURRENCY_MINOR_UNITS } from '../../src/commerce/currency.js';
import { validate } from '../fixtures/json-schema.js';
import { RUNTIME_CONTRACT } from '../fixtures/runtime-items-check.js';
import { runtimeItemsFailure } from '../fixtures/commerce.js';

type Node = { [key: string]: unknown };
const schema = RUNTIME_CONTRACT.items_component as Node;
const prop = (node: Node, ...path: string[]): Node =>
  path.reduce<Node>((n, key) => (n.properties as Record<string, Node>)[key] ?? (n[key] as Node), node);
const rowSchema = prop(schema, 'rows').items as Node;
const totalSchema = prop(schema, 'totals').items as Node;
const quantitySchema = prop(rowSchema, 'quantity');

describe('the runtime contract extract', () => {
  it('is pinned to a runtime commit', () => {
    expect(RUNTIME_CONTRACT.source_runtime_commit).toMatch(/^[0-9a-f]{40}$/);
  });

  it('the SDK minor-unit table equals the runtime table, code for code', () => {
    expect(Object.fromEntries([...CURRENCY_MINOR_UNITS].sort(([a], [b]) => a.localeCompare(b)))).toEqual(
      RUNTIME_CONTRACT.currency_minor_units,
    );
    expect(CURRENCY_MINOR_UNITS.size).toBe(Object.keys(RUNTIME_CONTRACT.currency_minor_units).length);
    expect([
      CURRENCY_MINOR_UNITS.get('JPY'),
      CURRENCY_MINOR_UNITS.get('USD'),
      CURRENCY_MINOR_UNITS.get('BHD'),
    ]).toEqual([0, 2, 3]);
  });

  it('the SDK limits are the runtime schema constants', () => {
    expect({
      rows: prop(schema, 'rows').maxItems,
      totals: prop(schema, 'totals').maxItems,
      name: prop(rowSchema, 'name').maxLength,
      detail: prop(rowSchema, 'detail').maxLength,
      totalLabel: prop(totalSchema, 'label').maxLength,
      label: prop(schema, 'label').maxLength,
      quantityUnit: prop(quantitySchema, 'unit').maxLength,
      amount: prop(totalSchema, 'amount').maximum,
      quantity: prop(quantitySchema, 'value').maximum,
    }).toEqual({ ...ITEMS_LIMITS });
    expect(prop(totalSchema, 'amount').minimum).toBe(-ITEMS_LIMITS.amount);
  });

  it('the oracle accepts the runtime fixtures and refuses what the runtime refuses', () => {
    const invoice = {
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
    };
    expect(runtimeItemsFailure(invoice)).toBeNull();
    // The contract's §4 example as written: its rows do not add up to its subtotal.
    const asWritten = {
      ...invoice,
      rows: [
        ...invoice.rows.slice(0, 2),
        { name: 'Breakfast', detail: 'Included', amount: null },
        invoice.rows[3],
      ],
    };
    expect(runtimeItemsFailure(asWritten)).toBe('/totals/0/amount');
    expect(runtimeItemsFailure({ ...invoice, rows: [{ name: 'x'.repeat(81), amount: 1 }] })).toBe(
      '/rows/0/name: maxLength',
    );
    expect(runtimeItemsFailure({ ...invoice, rows: [{ name: 'A', amount: 1.5 }] })).toBe(
      '/rows/0/amount: anyOf',
    );
    expect(runtimeItemsFailure({ ...invoice, currency: 'XAU' })).toBe('/currency');
    expect(runtimeItemsFailure({ ...invoice, extra: true })).toBe('/extra: additionalProperties');
    expect(
      runtimeItemsFailure({
        type: 'items',
        currency: 'EUR',
        rows: [{ name: 'Menu', amount: 6600 }],
        totals: [
          { label: 'Subtotal', amount: 6600, role: 'subtotal' },
          { label: 'Deposit paid', amount: -2000, role: 'paid' },
          { label: 'Amount due', amount: 6600, role: 'due' },
        ],
      }),
    ).toBe('/totals/2/amount');
  });

  it('the validator refuses a keyword it does not know rather than passing it', () => {
    expect(() => validate({ type: 'string', format: 'email' }, 'a')).toThrow(/unsupported keyword format/);
  });
});
