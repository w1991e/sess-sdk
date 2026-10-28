// P2-22 Commerce B: the pipe-table lint. Sess shows text as written, so a Markdown table reaches the
// person as pipes; prices go in an items component, other rows in a record.
import { describe, expect, it } from 'vitest';
import { invoice, lintText } from '../../src/index.js';
import { refusal } from '../fixtures/commerce.js';

describe('lintText()', () => {
  it('flags a GFM table with prices and points to items', () => {
    const text = [
      'Here is the bill:',
      '| Item | Price |',
      '| --- | ---: |',
      '| Design retainer | $4,200.00 |',
      '| Revisions | $450.00 |',
      '',
      'Thanks.',
    ].join('\n');
    expect(lintText(text)).toEqual([
      {
        rule: 'pipe-table',
        line: 2,
        use: 'items',
        message:
          'Line 2 starts a Markdown table. Sess shows text as written, so the person would see the pipes. For prices, send an items component instead.',
      },
    ]);
  });

  it('flags a table without prices and points to record', () => {
    const findings = lintText('Name | Role\n--- | ---\nAda | Engineer\nGrace | Admiral');
    expect(findings.map((f) => [f.line, f.use])).toEqual([[1, 'record']]);
    expect(findings[0]?.message).toContain('send a record component instead');
    // Names beside numbers are not prices.
    expect(lintText('| Name | Born |\n|---|---|\n| Ada 2 | 1815 |').map((f) => f.use)).toEqual(['record']);
  });

  it('flags rows drawn between pipes without a delimiter row, and each table once', () => {
    const text = '| a | b |\n| c | d |\n\ntext\n\n| SKU | Qty |\n|-|-|\n| X1 | 2 |';
    expect(lintText(text).map((f) => [f.line, f.use])).toEqual([
      [1, 'record'],
      [6, 'items'], // a quantity column reads as a bill
    ]);
    expect(lintText('| Total | 12.50 |\r\n| Tax | 1.25 |').map((f) => f.use)).toEqual(['items']);
  });

  it('leaves ordinary text alone: one pipe, a lone row, a rule or a heading underline', () => {
    for (const text of [
      'Choose yes | no and send.',
      '| just one bordered line |',
      'Heading\n---',
      'Above\n\n---\n\nBelow',
      'Escaped \\| pipes \\| here\n--- \\| ---',
      '',
      'The refund goes back to the card used for the order.',
    ])
      expect(lintText(text)).toEqual([]);
  });
});

describe('the builders refuse a table in the description', () => {
  it('points to the rows for prices', () => {
    const e = refusal(() =>
      invoice({
        currency: 'USD',
        rows: [{ name: 'A', amount: 100 }],
        description: '| Item | Price |\n|---|---|\n| A | $1.00 |',
      }),
    );
    expect([e.code, e.field, e.message]).toEqual([
      'INVALID_SCHEMA',
      '/interaction/description',
      '/interaction/description contains a Markdown table, which the person would see as pipes; put prices in the rows.',
    ]);
  });
});
