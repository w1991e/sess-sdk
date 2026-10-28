// Commerce: money and the items builder. The runtime's `items` component carries amounts as
// whole numbers in a currency's minor unit and checks the stated subtotal, total and amount due
// exactly; this builder computes them so a bill it returns passes that check. It never rounds,
// converts or formats: what you state is what is sent. Limits reject, never truncate, with the
// pointer and sentences of Sess's 400 INVALID_SCHEMA. Pure: no network, clock or I/O.
import { SessError, lengthMessage } from '../errors.js';
import type { ItemsComponent } from '../types.js';
import { minorUnits } from './currency.js';

/**
 * The runtime's items limits (Unicode code points for text): rows 1–100, totals lines ≤ 8, a row
 * name ≤ 80, a detail ≤ 160, a totals label ≤ 40, a caption ≤ 200, a quantity unit ≤ 16, every
 * amount within ±10^15 minor units, a quantity within 0–1,000,000.
 */
export const ITEMS_LIMITS = Object.freeze({
  rows: 100,
  totals: 8,
  name: 80,
  detail: 160,
  totalLabel: 40,
  label: 200,
  quantityUnit: 16,
  amount: 1_000_000_000_000_000,
  quantity: 1_000_000,
});

/** An amount in a currency's minor unit (1250 is 12.50 USD, 1250 JPY, 1.250 BHD). */
export interface Money {
  readonly amount: number;
  readonly currency: string;
}

/** A row, totals or payment amount: minor units of the component's currency, or `money()`. */
export type Amount = number | Money;

/** A line of the bill. Put quantity and unit price in `detail`, not in `name`. */
export interface ItemRowInput {
  /** What the line is, shown verbatim; at most 80. Example: `Design retainer, October` */
  readonly name: string;
  /** Optional second line: quantity or unit price; at most 160 with `reference`. Example: `3 × $150.00` */
  readonly detail?: string;
  /** Optional reference (SKU, booking or PO number): shown in the detail line, after it. */
  readonly reference?: string;
  /** Minor units (or `money()`), or null for a line with no amount, such as `Included`. */
  readonly amount: Amount | null;
  /**
   * A quantity the person may change (an integer within `min`, default 0, and `max`, default
   * 1,000,000). The amount stays as stated: a changed quantity comes back as a change request
   * and your agent sends a new revision with new amounts.
   */
  readonly quantity?: {
    readonly value: number;
    readonly unit?: string;
    readonly min?: number;
    readonly max?: number;
  };
}

/** A line between the subtotal and the total. Added to the total unless `included`. */
export interface ItemLineInput {
  /** A word or two; at most 40. Examples: `GST 5%`, `Shipping`, `Early-payment discount` */
  readonly label: string;
  /** Minor units (or `money()`). A discount is negative. */
  readonly amount: Amount;
  readonly role: 'tax' | 'discount' | 'shipping' | 'fee' | 'tip' | 'adjustment' | 'other';
  /** Already inside the row prices (such as VAT): shown, never added. */
  readonly included?: boolean;
}

/** A payment already made, such as a deposit: a negative amount, counted once, in the amount due. */
export interface ItemPaymentInput {
  /** A word or two; at most 40. Example: `Deposit paid` */
  readonly label: string;
  /** Minor units (or `money()`), negative. */
  readonly amount: Amount;
}

export interface ItemsInput {
  /** ISO 4217 code with known minor units, such as `CAD`, `JPY` or `BHD`: one per component. */
  readonly currency: string;
  /** 1–100 rows, in order. */
  readonly rows: readonly ItemRowInput[];
  /** Optional caption: what the list is; at most 200. Example: `Invoice 2041` */
  readonly label?: string;
  /** Tax, discount, shipping, fee, tip and other lines, shown between the subtotal and the total. */
  readonly lines?: readonly ItemLineInput[];
  /** Payments already made, shown after the total and followed by the amount due. */
  readonly payments?: readonly ItemPaymentInput[];
  /** The totals lines' labels. Defaults: `Subtotal`, `Total`, `Amount due`. */
  readonly labels?: { readonly subtotal?: string; readonly total?: string; readonly due?: string };
  /** `false` states no totals (a list to choose from); then `lines` and `payments` are not allowed. */
  readonly totals?: boolean;
  /** The person may choose rows: `one` or `many`. Needs `name`. */
  readonly select?: 'one' | 'many';
  /** The answer's name (`^[a-z][a-z0-9_]{0,55}$`), with `select` or a row `quantity`. */
  readonly name?: string;
}

/** Default totals labels (proposed copy; see CHANGELOG). */
export const ITEMS_DEFAULT_LABELS = Object.freeze({
  subtotal: 'Subtotal',
  total: 'Total',
  due: 'Amount due',
});

const ADDITIVE_ROLES: readonly ItemLineInput['role'][] = [
  'tax',
  'discount',
  'shipping',
  'fee',
  'tip',
  'adjustment',
  'other',
];
const ANSWER_NAME = /^[a-z][a-z0-9_]{0,55}$/;
const AMOUNT_MAX = BigInt(ITEMS_LIMITS.amount);
const codePoints = (value: string) => [...value].length;

/** Internal: a refused builder input, named by its JSON pointer; nothing was sent. */
export function refuse(field: string, problem: string): never {
  // Pointers and problems only: caller values never enter the message.
  const subject = field === '' ? 'The items component' : field;
  throw new SessError('configuration', `${subject} ${problem}.`, {
    code: 'INVALID_SCHEMA',
    outcome: 'not_sent',
    ...(field === '' ? {} : { field }),
  });
}

/** Internal: a value over its limit, in Sess's own sentence (`field`, `limit` and `length` set). */
export function tooLong(field: string, limit: number, length: number): never {
  throw new SessError('configuration', lengthMessage(field, limit, length), {
    code: 'INVALID_SCHEMA',
    outcome: 'not_sent',
    field,
    limit,
    length,
  });
}

/** Internal: a non-blank, well-formed string of at most `max` code points (never truncated). */
export function text(value: unknown, field: string, max: number): string {
  if (typeof value !== 'string') return refuse(field, 'must be string');
  if (!value.isWellFormed()) refuse(field, 'must be well-formed Unicode');
  const length = codePoints(value);
  if (length > max) tooLong(field, max, length);
  if (!/\S/.test(value)) refuse(field, 'must not be blank');
  return value;
}

/** Internal: the JSON pointer token of a key (RFC 6901). */
export const token = (key: string) => key.replace(/~/g, '~0').replace(/\//g, '~1');

function checkCurrency(currency: unknown, field: string): string {
  if (typeof currency !== 'string' || minorUnits(currency) === undefined)
    refuse(field, 'is not an ISO 4217 currency code with known minor units; use one such as USD, EUR or JPY');
  return currency;
}

function wholeAmount(amount: unknown, field: string): number {
  if (typeof amount !== 'number' || !Number.isInteger(amount)) return refuse(field, 'must be integer');
  if (amount > ITEMS_LIMITS.amount) refuse(field, `must be <= ${ITEMS_LIMITS.amount}`);
  if (amount < -ITEMS_LIMITS.amount) refuse(field, `must be >= ${-ITEMS_LIMITS.amount}`);
  return amount === 0 ? 0 : amount; // -0 is sent as 0
}

/**
 * An amount in a currency's minor unit, checked: a whole number within ±10^15 and an ISO 4217
 * code Sess accepts. `money(1250, 'USD')` is $12.50; `money(1250, 'JPY')` is ¥1,250;
 * `money(1250, 'BHD')` is 1.250 BHD. It never rounds or converts: `money(12.5, 'USD')` throws.
 */
export function money(amount: number, currency: string): Money {
  if (typeof currency !== 'string' || minorUnits(currency) === undefined)
    throw new SessError(
      'configuration',
      'money(): the currency is not an ISO 4217 code with known minor units; use one such as USD, EUR or JPY.',
      { code: 'INVALID_SCHEMA', outcome: 'not_sent' },
    );
  if (typeof amount !== 'number' || !Number.isSafeInteger(amount) || Math.abs(amount) > ITEMS_LIMITS.amount)
    throw new SessError(
      'configuration',
      `money(): the amount must be a whole number of the currency's smallest unit (cents for USD, yen for JPY, fils for BHD), within ±${ITEMS_LIMITS.amount}: 1250 for 12.50 USD. Sess never rounds.`,
      { code: 'INVALID_SCHEMA', outcome: 'not_sent' },
    );
  return Object.freeze({ amount: amount === 0 ? 0 : amount, currency });
}

/** A stated amount in the component's currency: a number, or `money()` in the same currency. */
function amountOf(value: unknown, currency: string, field: string): number {
  if (value !== null && typeof value === 'object') {
    const m = value as Partial<Money>;
    if (m.currency !== currency)
      refuse(
        field,
        'is in another currency; an items component has one currency, so send it as its own items component',
      );
    return wholeAmount(m.amount, field);
  }
  return wholeAmount(value, field);
}

function quantityOf(
  raw: ItemRowInput['quantity'],
  field: string,
): NonNullable<ItemsComponent['rows'][number]['quantity']> {
  if (raw === null || typeof raw !== 'object') return refuse(field, 'must be object');
  const whole = (v: unknown, at: string): number => {
    if (typeof v !== 'number' || !Number.isInteger(v)) return refuse(at, 'must be integer');
    if (v < 0) refuse(at, 'must be >= 0');
    if (v > ITEMS_LIMITS.quantity) refuse(at, `must be <= ${ITEMS_LIMITS.quantity}`);
    return v;
  };
  const value = whole(raw.value, `${field}/value`);
  const min = raw.min === undefined ? undefined : whole(raw.min, `${field}/min`);
  const max = raw.max === undefined ? undefined : whole(raw.max, `${field}/max`);
  if ((min ?? 0) > (max ?? ITEMS_LIMITS.quantity)) refuse(`${field}/min`, 'is more than max');
  if (value < (min ?? 0) || value > (max ?? ITEMS_LIMITS.quantity))
    refuse(`${field}/value`, 'is not within min and max');
  const unit =
    raw.unit === undefined ? undefined : text(raw.unit, `${field}/unit`, ITEMS_LIMITS.quantityUnit);
  return {
    value,
    ...(unit === undefined ? {} : { unit }),
    ...(min === undefined ? {} : { min }),
    ...(max === undefined ? {} : { max }),
  };
}

/** The exact sum of minor-unit amounts (BigInt, so no order of 100 amounts loses a unit). */
function sum(field: string, amounts: readonly number[]): number {
  const total = amounts.reduce((s, a) => s + BigInt(a), 0n);
  if (total > AMOUNT_MAX) refuse(field, `must be <= ${ITEMS_LIMITS.amount}`);
  if (total < -AMOUNT_MAX) refuse(field, `must be >= ${-ITEMS_LIMITS.amount}`);
  return Number(total);
}

/** Internal: `items()` at a pointer (`at` is the component's pointer in the request). */
export function buildItems(input: ItemsInput, at: string): ItemsComponent {
  if (input === null || typeof input !== 'object') return refuse(at, 'must be object');
  const currency = checkCurrency(input.currency, `${at}/currency`);
  const label = input.label === undefined ? undefined : text(input.label, `${at}/label`, ITEMS_LIMITS.label);

  const sourceRows = input.rows;
  if (!Array.isArray(sourceRows) || sourceRows.length < 1)
    return refuse(`${at}/rows`, 'needs at least one row');
  if (sourceRows.length > ITEMS_LIMITS.rows) tooLong(`${at}/rows`, ITEMS_LIMITS.rows, sourceRows.length);
  const rows: ItemsComponent['rows'] = sourceRows.map((r: ItemRowInput, i: number) => {
    const p = `${at}/rows/${i}`;
    if (r === null || typeof r !== 'object') return refuse(p, 'must be object');
    const name = text(r.name, `${p}/name`, ITEMS_LIMITS.name);
    // A reference goes in the detail line under the plain name, after any detail, so it reads as one.
    const detail = r.detail === undefined ? undefined : text(r.detail, `${p}/detail`, ITEMS_LIMITS.detail);
    const reference =
      r.reference === undefined ? undefined : text(r.reference, `${p}/detail`, ITEMS_LIMITS.detail);
    const joined =
      reference === undefined
        ? detail
        : text(
            detail === undefined ? reference : `${detail} · ${reference}`,
            `${p}/detail`,
            ITEMS_LIMITS.detail,
          );
    const quantity = r.quantity === undefined ? undefined : quantityOf(r.quantity, `${p}/quantity`);
    const amount = r.amount === null ? null : amountOf(r.amount, currency, `${p}/amount`);
    return {
      name,
      ...(joined === undefined ? {} : { detail: joined }),
      ...(quantity === undefined ? {} : { quantity }),
      amount,
    };
  });

  const editable = rows.some((r) => r.quantity !== undefined);
  const select = input.select;
  if (select !== undefined && select !== 'one' && select !== 'many')
    refuse(`${at}/select`, 'must be one or many');
  const answered = select !== undefined || editable;
  if (input.name !== undefined && !answered)
    refuse(`${at}/name`, 'applies only with select or editable; remove it');
  if (answered && input.name === undefined)
    refuse(at, 'has select or editable but no name; add a name for the answer');
  if (input.name !== undefined && (typeof input.name !== 'string' || !ANSWER_NAME.test(input.name)))
    refuse(`${at}/name`, `must match pattern "${ANSWER_NAME.source}"`);

  // Totals: the subtotal is the rows; the total adds every line not already included; payments are
  // counted once, in the amount due. Computed exactly, as Sess checks them.
  const lines = input.lines ?? [];
  const payments = input.payments ?? [];
  if (!Array.isArray(lines)) refuse(`${at}/lines`, 'must be array');
  if (!Array.isArray(payments)) refuse(`${at}/payments`, 'must be array');
  const totals: NonNullable<ItemsComponent['totals']> = [];
  if (input.totals === false) {
    if (lines.length || payments.length)
      refuse(`${at}/totals`, 'is false, so a bill without totals has no lines or payments; remove them');
  } else {
    const labels = input.labels ?? {};
    const labelOf = (key: 'subtotal' | 'total' | 'due', index: number) =>
      labels[key] === undefined
        ? ITEMS_DEFAULT_LABELS[key]
        : text(labels[key], `${at}/totals/${index}/label`, ITEMS_LIMITS.totalLabel);
    const count = (lines.length ? 1 : 0) + lines.length + 1 + (payments.length ? payments.length + 1 : 0);
    if (count > ITEMS_LIMITS.totals) tooLong(`${at}/totals`, ITEMS_LIMITS.totals, count);
    const subtotal = sum(
      `${at}/rows`,
      rows.map((r) => r.amount ?? 0),
    );
    if (lines.length) totals.push({ label: labelOf('subtotal', 0), amount: subtotal, role: 'subtotal' });
    for (const line of lines) {
      const p = `${at}/totals/${totals.length}`;
      if (line === null || typeof line !== 'object') refuse(p, 'must be object');
      const lineLabel = text(line.label, `${p}/label`, ITEMS_LIMITS.totalLabel);
      if (!ADDITIVE_ROLES.includes(line.role))
        refuse(`${p}/role`, `must be one of ${ADDITIVE_ROLES.join(', ')}`);
      const amount = amountOf(line.amount, currency, `${p}/amount`);
      if (line.role === 'discount' && amount > 0)
        refuse(`${p}/amount`, 'is a discount, so it is negative; state it with a minus sign');
      if (line.included !== undefined && typeof line.included !== 'boolean')
        refuse(`${p}/included`, 'must be boolean');
      totals.push({
        label: lineLabel,
        amount,
        role: line.role,
        ...(line.included === undefined ? {} : { included: line.included }),
      });
    }
    const added = totals.filter((t) => t.role !== 'subtotal' && t.included !== true).map((t) => t.amount);
    const total = sum(`${at}/totals`, [subtotal, ...added]);
    totals.push({ label: labelOf('total', totals.length), amount: total, role: 'total' });
    if (payments.length) {
      const paid: number[] = [];
      for (const payment of payments) {
        const p = `${at}/totals/${totals.length}`;
        if (payment === null || typeof payment !== 'object') refuse(p, 'must be object');
        const paymentLabel = text(payment.label, `${p}/label`, ITEMS_LIMITS.totalLabel);
        const amount = amountOf(payment.amount, currency, `${p}/amount`);
        if (amount > 0) refuse(`${p}/amount`, 'is a payment, so it is negative; state it with a minus sign');
        paid.push(amount);
        totals.push({ label: paymentLabel, amount, role: 'paid' });
      }
      totals.push({
        label: labelOf('due', totals.length),
        amount: sum(`${at}/totals`, [total, ...paid]),
        role: 'due',
      });
    }
  }

  // Canonical member order, as Sess stores the component.
  return {
    type: 'items',
    ...(label === undefined ? {} : { label }),
    currency,
    ...(select === undefined ? {} : { select }),
    ...(editable ? { editable: ['quantity'] as ['quantity'] } : {}),
    ...(input.name === undefined ? {} : { name: input.name }),
    rows,
    ...(totals.length ? { totals } : {}),
  };
}

/**
 * Builds an items component: rows in one currency, and the subtotal, total and amount due computed
 * exactly from them, so Sess's arithmetic check passes. A bill with lines (tax, discount,
 * shipping …) gets `Subtotal`, the lines and `Total`; with none, `Total` only; with payments, the
 * payments and `Amount due` after the total. Amounts are whole minor units (`money()` checks
 * one). Over a limit it throws a `SessError` (`code` `INVALID_SCHEMA`, `outcome` `not_sent`) whose
 * `field` is the value's JSON pointer within the component, such as `/rows/3/name`; nothing is
 * ever truncated. With a row `quantity`, put it in a Surface with a `request_change` action.
 */
export function items(input: ItemsInput): ItemsComponent {
  return buildItems(input, '');
}
