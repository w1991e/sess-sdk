// Test-only: the Sess runtime's semantic checks of an items component and of the Surface around it
// (w1991e/sess packages/core/src/items.ts `checkItems` and the request_change rule of
// packages/core/src/interactive.ts, at the source_runtime_commit of runtime-items-contract.json),
// ported line for line so the builders' output is checked against the runtime's equations rather
// than the SDK's own. It returns the runtime's failure pointer, or null when Sess would accept.
import { readFileSync } from 'node:fs';

/** The runtime extract (see its `source`): schemas and the minor-unit table at a pinned commit. */
export const RUNTIME_CONTRACT = JSON.parse(
  readFileSync(new URL('./runtime-items-contract.json', import.meta.url), 'utf8'),
) as {
  source_runtime_commit: string;
  items_component: Record<string, unknown>;
  record_component: Record<string, unknown>;
  interactive_interaction: Record<string, unknown>;
  currency_minor_units: Record<string, number>;
};
const contract = RUNTIME_CONTRACT;

type Total = { label: string; amount: number; role: string; included?: boolean };
type Row = {
  name: string;
  detail?: string;
  quantity?: { value: number; min?: number; max?: number };
  amount: number | null;
};
type Items = {
  currency: string;
  select?: string;
  editable?: string[];
  name?: string;
  rows: Row[];
  totals?: Total[];
};

const QUANTITY_MAX = 1_000_000;
const AMOUNT_MAX = 1_000_000_000_000_000n;
const NON_SUM = new Set(['subtotal', 'total', 'paid', 'due']);
const minor = contract.currency_minor_units as Record<string, number>;

export function runtimeCheckItems(raw: Items, at: string): string | null {
  if (minor[raw.currency] === undefined) return `${at}/currency`;
  const answered = raw.select !== undefined || raw.editable !== undefined;
  if (answered && raw.name === undefined) return at;
  if (!answered && raw.name !== undefined) return `${at}/name`;
  const editable = raw.editable !== undefined;
  let quantities = 0;
  for (const [i, r] of raw.rows.entries()) {
    if (r.quantity === undefined) continue;
    const p = `${at}/rows/${i}/quantity`;
    if (!editable) return p;
    quantities += 1;
    const min = r.quantity.min ?? 0;
    const max = r.quantity.max ?? QUANTITY_MAX;
    if (min > max) return `${p}/min`;
    if (r.quantity.value < min || r.quantity.value > max) return `${p}/value`;
  }
  if (editable && quantities === 0) return `${at}/editable`;
  const totals = raw.totals ?? [];
  for (const role of ['subtotal', 'total', 'due']) {
    const first = totals.findIndex((t) => t.role === role);
    const second = totals.findIndex((t, i) => i > first && t.role === role);
    if (first !== -1 && second !== -1) return `${at}/totals/${second}/role`;
  }
  for (const [i, t] of totals.entries())
    if (t.included === true && ['subtotal', 'total', 'paid', 'due'].includes(t.role))
      return `${at}/totals/${i}/included`;
  const sum = (xs: number[]) => xs.reduce((s, a) => s + BigInt(a), 0n);
  const outside = (s: bigint) => s > AMOUNT_MAX || s < -AMOUNT_MAX;
  const sub = totals.findIndex((t) => t.role === 'subtotal');
  const tot = totals.findIndex((t) => t.role === 'total');
  const due = totals.findIndex((t) => t.role === 'due');
  const additive = totals.filter((t) => !NON_SUM.has(t.role) && t.included !== true);
  if (sub !== -1) {
    const s = sum(raw.rows.map((r) => r.amount ?? 0));
    if (outside(s)) return `${at}/rows`;
    if (Number(s) !== totals[sub]!.amount) return `${at}/totals/${sub}/amount`;
    if (tot !== -1) {
      const t = sum([totals[sub]!.amount, ...additive.map((x) => x.amount)]);
      if (outside(t)) return `${at}/totals`;
      if (Number(t) !== totals[tot]!.amount) return `${at}/totals/${tot}/amount`;
    }
  }
  if (due !== -1 && (tot !== -1 || sub !== -1)) {
    const paid = totals.filter((t) => t.role === 'paid').map((t) => t.amount);
    const base = tot !== -1 ? [totals[tot]!.amount] : [totals[sub]!.amount, ...additive.map((t) => t.amount)];
    const d = sum([...base, ...paid]);
    if (outside(d)) return `${at}/totals`;
    if (Number(d) !== totals[due]!.amount) return `${at}/totals/${due}/amount`;
  }
  return null;
}

/** The Surface-level items rules: each component's checks, and request_change for editable. */
export function runtimeCheckSurface(interaction: {
  source: { components: { type: string }[] };
  actions: { intent?: string }[];
}): string | null {
  let editableAt: string | undefined;
  for (const [i, c] of interaction.source.components.entries()) {
    if (c.type !== 'items') continue;
    const at = `/interaction/source/components/${i}`;
    const failed = runtimeCheckItems(c as unknown as Items, at);
    if (failed) return failed;
    if ((c as unknown as Items).editable !== undefined && editableAt === undefined) editableAt = at;
  }
  if (editableAt !== undefined && !interaction.actions.some((a) => a.intent === 'request_change'))
    return `${editableAt}/editable`;
  return null;
}
