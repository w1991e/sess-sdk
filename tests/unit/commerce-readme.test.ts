// P2-22 Commerce B: the README's Commerce section keeps its first screen and states the limits the
// SDK enforces, so the documented numbers cannot drift from ITEMS_LIMITS.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { ITEMS_LIMITS } from '../../src/index.js';

const readme = readFileSync(new URL('../../README.md', import.meta.url), 'utf8');
const api = readFileSync(new URL('../../docs/api.md', import.meta.url), 'utf8');
const section = (text: string) => {
  const start = text.indexOf('\n## Commerce\n');
  expect(start).toBeGreaterThan(-1);
  const end = text.indexOf('\n## ', start + 1);
  return text.slice(start, end);
};

describe('README Commerce section', () => {
  const commerce = section(readme);

  it('opens with the one sentence on payment, then a first code block of at most twelve lines', () => {
    const paragraphs = commerce.split('\n\n');
    expect(paragraphs[1]?.startsWith('Sess takes no payment:')).toBe(true);
    const block = /```ts\n([\s\S]*?)```/.exec(commerce)?.[1] ?? '';
    expect(block.trimEnd().split('\n').length).toBeLessThanOrEqual(12);
    expect(commerce.indexOf('```ts')).toBeLessThan(commerce.indexOf('Three things'));
  });

  it('states the limits the builders enforce', () => {
    expect(commerce).toContain(
      `A row name has at most ${ITEMS_LIMITS.name} characters and its detail at most ${ITEMS_LIMITS.detail}.`,
    );
    const reference = section(api);
    expect(reference).toContain(`row name ${ITEMS_LIMITS.name}, detail ${ITEMS_LIMITS.detail}`);
    expect(reference).toContain(
      `40, caption ${ITEMS_LIMITS.label}, quantity unit ${ITEMS_LIMITS.quantityUnit}, rows ${ITEMS_LIMITS.rows}, totals lines ${ITEMS_LIMITS.totals}`,
    );
    expect(ITEMS_LIMITS.totalLabel).toBe(40);
  });
});
