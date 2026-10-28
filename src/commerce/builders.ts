// Commerce: merchant vocabulary over one runtime component. Each builder returns an
// ordinary interactive Surface (an `interaction` for `sess.sessions.create()` or `publish()`): an
// optional record with the document's reference under a plain name, the `items` card with its
// totals computed exactly, and the actions the runtime requires. There are no Invoice, Receipt or
// Quote objects in Sess; a bill is a Surface the person approves or declines like any other.
// Sess takes no payment: nothing here charges, captures or moves money.
import type { ItemsComponent, InteractiveInteraction, SurfaceComponent } from '../types.js';
import { buildItems, refuse, text, token, tooLong, type ItemsInput } from './items.js';
import { lintText } from './lint.js';

type Action = InteractiveInteraction['actions'][number];
type RecordValue = string | number | boolean | null;

/** Common input of the five builders: the items input plus the page around it. */
export interface BillInput extends ItemsInput {
  /** The page's heading, about 40 characters; at most 80. Each builder has a default. */
  readonly title?: string;
  /** Optional context under the title, one or two sentences; at most 280. */
  readonly description?: string;
  /** Advanced: the BCP 47 locale the page formats amounts in (default: the page's language). */
  readonly locale?: string;
  /**
   * The document's number (invoice, receipt, quote, refund or purchase order number), shown in a
   * record under its plain name, such as `Invoice` → `INV-2041`; at most 200.
   */
  readonly reference?: string;
  /** Other facts beside the bill, shown verbatim in the same record (`Due`, `Valid until` …). */
  readonly record?: Readonly<Record<string, RecordValue>>;
  /**
   * Advanced: the buttons, replacing the builder's (1–5). A bill with editable quantities needs
   * one with `intent: 'request_change'`.
   */
  readonly actions?: readonly Action[];
}

/** A refund: positive amounts under refund labels, never a negative total. No payments. */
export type RefundInput = Omit<BillInput, 'payments'>;

const LIMITS = Object.freeze({
  title: 80,
  description: 280,
  recordKey: 40,
  recordValue: 200,
  recordFields: 50,
  actions: 5,
  actionLabel: 24,
});
const ACTION_ID = /^[a-z][a-z0-9_]{0,31}$/;
const INTENTS = ['submit', 'continue', 'approve', 'reject', 'request_change'] as const;
const LOCALE = /^[A-Za-z]{2,3}(-[A-Za-z0-9]{1,8}){0,4}$/;
const COMPONENTS = '/interaction/source/components';
// Keys an ordinary object does not hold as plain data (the same set ask() refuses): copied with
// `fields[key] = value`, "__proto__" would run the prototype setter and the row would vanish.
const RESERVED_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

/**
 * The words a builder puts on the page when you give none (proposed copy; `Request changes` is
 * Sess's signed label for a change request). Every one can be replaced through the input.
 */
export const COMMERCE_DEFAULTS = Object.freeze({
  titles: Object.freeze({
    invoice: 'Approve this invoice?',
    receipt: 'Your receipt',
    quote: 'Accept this quote?',
    refund: 'Approve the refund?',
    purchaseOrder: 'Approve the order?',
  }),
  references: Object.freeze({
    invoice: 'Invoice',
    receipt: 'Receipt',
    quote: 'Quote',
    refund: 'Refund',
    purchaseOrder: 'Purchase order',
  }),
  actions: Object.freeze({
    approve: Object.freeze({ id: 'approve', label: 'Approve', intent: 'approve' as const }),
    accept: Object.freeze({ id: 'accept', label: 'Accept', intent: 'approve' as const }),
    continue: Object.freeze({ id: 'continue', label: 'Continue', intent: 'continue' as const }),
    decline: Object.freeze({ id: 'decline', label: 'Decline', intent: 'reject' as const }),
    change: Object.freeze({ id: 'change', label: 'Request changes', intent: 'request_change' as const }),
  }),
  refundTotal: 'Refund total',
});

type Kind = keyof typeof COMMERCE_DEFAULTS.titles;
interface Shape {
  /** The answer's name when the person chooses rows or changes a quantity. */
  name: string;
  /** The accepting action. */
  accept: Action;
  /** Whether the person may decline. */
  decline: boolean;
  /** Whether a change request is offered even without editable quantities. */
  change: boolean;
}
const D = COMMERCE_DEFAULTS.actions;
const SHAPES: Readonly<Record<Kind, Shape>> = {
  invoice: { name: 'invoice', accept: D.approve, decline: true, change: false },
  receipt: { name: 'receipt', accept: D.continue, decline: false, change: false },
  quote: { name: 'quote', accept: D.accept, decline: true, change: false },
  refund: { name: 'refund', accept: D.approve, decline: true, change: false },
  purchaseOrder: { name: 'order', accept: D.approve, decline: true, change: true },
};

function recordComponent(kind: Kind, input: BillInput, at: string): SurfaceComponent | undefined {
  const fields: Record<string, RecordValue> = {};
  if (input.reference !== undefined)
    fields[COMMERCE_DEFAULTS.references[kind]] = text(
      input.reference,
      `${at}/fields/${token(COMMERCE_DEFAULTS.references[kind])}`,
      LIMITS.recordValue,
    );
  const extra = input.record ?? {};
  if (extra === null || typeof extra !== 'object' || Array.isArray(extra))
    refuse(`${at}/fields`, 'must be object');
  for (const [key, value] of Object.entries(extra)) {
    const p = `${at}/fields/${token(key)}`;
    const keyLength = [...key].length;
    if (keyLength > LIMITS.recordKey) tooLong(p, LIMITS.recordKey, keyLength);
    if (RESERVED_KEYS.has(key)) refuse(p, 'is a reserved name; give the fact another name');
    if (Object.hasOwn(fields, key)) refuse(p, 'repeats the reference row; give the reference once');
    if (typeof value === 'string') {
      const length = [...value].length;
      if (length > LIMITS.recordValue) tooLong(p, LIMITS.recordValue, length);
      if (!value.isWellFormed()) refuse(p, 'must be well-formed Unicode');
    } else if (!(
      value === null ||
      typeof value === 'boolean' ||
      (typeof value === 'number' && Number.isFinite(value))
    ))
      refuse(p, 'must be a string, number, boolean or null');
    fields[key] = value;
  }
  const count = Object.keys(fields).length;
  if (count > LIMITS.recordFields)
    refuse(`${at}/fields`, `must NOT have more than ${LIMITS.recordFields} properties`);
  return count ? { type: 'record', fields } : undefined;
}

function checkActions(actions: readonly Action[], editable: boolean, editableAt: string): Action[] {
  const at = '/interaction/actions';
  if (!Array.isArray(actions) || actions.length < 1 || actions.length > LIMITS.actions)
    refuse(at, `must have 1–${LIMITS.actions} actions`);
  const ids = new Set<string>();
  const out = actions.map((a, i) => {
    const p = `${at}/${i}`;
    if (a === null || typeof a !== 'object') return refuse(p, 'must be object');
    if (typeof a.id !== 'string' || !ACTION_ID.test(a.id))
      refuse(`${p}/id`, `must match pattern "${ACTION_ID.source}"`);
    if (ids.has(a.id)) refuse(at, 'action ids must be unique');
    ids.add(a.id);
    const label = text(a.label, `${p}/label`, LIMITS.actionLabel);
    if (a.intent !== undefined && !INTENTS.includes(a.intent))
      refuse(`${p}/intent`, `must be one of ${INTENTS.join(', ')}`);
    return a.intent === undefined ? { id: a.id, label } : { id: a.id, label, intent: a.intent };
  });
  // Sess refuses editable quantities without a way to send the edit (signed rule, 2026-10-23).
  if (editable && !out.some((a) => a.intent === 'request_change'))
    refuse(
      `${editableAt}/editable`,
      'needs an action with intent request_change in interaction.actions, such as "Request changes", so the person can send a changed quantity',
    );
  return out;
}

function bill(
  kind: Kind,
  input: BillInput,
  adjust?: (items: ItemsComponent, at: string) => void,
): InteractiveInteraction {
  if (input === null || typeof input !== 'object') return refuse('/interaction', 'must be object');
  const shape = SHAPES[kind];
  const title = text(input.title ?? COMMERCE_DEFAULTS.titles[kind], '/interaction/title', LIMITS.title);
  let description: string | undefined;
  if (input.description !== undefined) {
    if (typeof input.description !== 'string' || !input.description.isWellFormed())
      refuse('/interaction/description', 'must be a well-formed string');
    const length = [...input.description].length;
    if (length > LIMITS.description) tooLong('/interaction/description', LIMITS.description, length);
    // A table drawn in the description reaches the person as pipes: the bill is the items card.
    const table = lintText(input.description)[0];
    if (table !== undefined)
      refuse(
        '/interaction/description',
        table.use === 'items'
          ? 'contains a Markdown table, which the person would see as pipes; put prices in the rows'
          : 'contains a Markdown table, which the person would see as pipes; put the rows in record',
      );
    description = input.description;
  }
  if (
    input.locale !== undefined &&
    (typeof input.locale !== 'string' || input.locale.length > 35 || !LOCALE.test(input.locale))
  )
    refuse(
      '/interaction/locale',
      'is not a locale Sess can format; use a BCP 47 tag such as en-CA, or leave it out',
    );

  const record = recordComponent(kind, input, `${COMPONENTS}/0`);
  const at = `${COMPONENTS}/${record ? 1 : 0}`;
  // The answer's name, when the person answers (a choice of rows or a quantity), is the builder's.
  const wantsName =
    input.select !== undefined ||
    (Array.isArray(input.rows) &&
      input.rows.some((r) => r !== null && typeof r === 'object' && r.quantity !== undefined));
  const items = buildItems(
    {
      ...input,
      ...(input.name === undefined && wantsName ? { name: shape.name } : {}),
    },
    at,
  );
  adjust?.(items, at);
  const editable = items.editable !== undefined;
  const actions = checkActions(
    input.actions ?? [
      ...(shape.decline ? [D.decline] : []),
      ...(shape.change || editable ? [D.change] : []),
      shape.accept,
    ],
    editable,
    at,
  );
  return {
    mode: 'interactive',
    title,
    ...(description === undefined ? {} : { description }),
    ...(input.locale === undefined ? {} : { locale: input.locale }),
    source: { kind: 'sess_surface', components: [...(record ? [record] : []), items] },
    actions,
  };
}

/**
 * An invoice to approve: the items card with its totals, `Decline` and `Approve` (and
 * `Request changes` when a row has an editable quantity). Returns an `interaction` for
 * `sess.sessions.create({ interaction })`. Sess takes no payment: approval is the person's
 * decision and its signed receipt; collecting the money stays with your payment processor.
 */
export function invoice(input: BillInput): InteractiveInteraction {
  return bill('invoice', input);
}

/** A receipt or order confirmation for the person to check, with one `Continue` button. */
export function receipt(input: BillInput): InteractiveInteraction {
  return bill('receipt', input);
}

/** A quote or estimate to accept: `Decline` and `Accept`. Put its validity in `record`. */
export function quote(input: BillInput): InteractiveInteraction {
  return bill('quote', input);
}

/**
 * A refund to approve, stated in positive amounts: every row is zero or more and the total,
 * labelled `Refund total`, is never negative. A deduction (such as a restocking fee) is a
 * negative line. With `select: 'many'` the person chooses the rows to refund.
 */
export function refund(input: RefundInput): InteractiveInteraction {
  if (input === null || typeof input !== 'object') return refuse('/interaction', 'must be object');
  if ((input as BillInput).payments !== undefined)
    refuse('/interaction', 'is a refund, which has no payments; state what is refunded');
  return bill(
    'refund',
    {
      ...input,
      labels: { ...input.labels, total: input.labels?.total ?? COMMERCE_DEFAULTS.refundTotal },
    },
    (items, at) => {
      for (const [i, row] of items.rows.entries())
        if (row.amount !== null && row.amount < 0)
          refuse(
            `${at}/rows/${i}/amount`,
            'is negative; a refund states what is refunded as a positive amount (a deduction is a negative line)',
          );
      const total = items.totals?.find((t) => t.role === 'total');
      if (total !== undefined && total.amount < 0)
        refuse(
          `${at}/totals/${items.totals!.indexOf(total)}/amount`,
          'is a negative refund total; a refund total is zero or more',
        );
    },
  );
}

/**
 * A purchase order to approve. A row with a `quantity` lets the person change it; the order
 * always offers `Request changes` (a changed quantity is sent only with it, and your agent replies
 * with a new revision and updated amounts) beside `Decline` and `Approve`.
 */
export function purchaseOrder(input: BillInput): InteractiveInteraction {
  return bill('purchaseOrder', input);
}
