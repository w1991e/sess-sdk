// Crafted receipt PDFs for the extractor's work bound (S-04, TRY-PDF-BOUNDS-03; ASTRA finding
// S04-EXTRACT-WORK-01). Each is a small classic-xref PDF whose catalog, Data file specification
// and unfiltered application/json stream ("{}") are in the profile, so only the shape of its
// embedded-files name tree (or the bytes its objects share) decides the outcome. Synthetic only.

const enc = new TextEncoder();

/**
 * A classic-xref PDF of `body` (raw object text, ASCII). Each object number in `objects` is found
 * at its first `n 0 obj` in the body (objects may overlap, as crafted files do); the rest are free.
 */
export function classicPdf(body: string, objects: number[]): Uint8Array {
  const head = '%PDF-1.7\n%crafted for the receipt PDF extractor tests\n';
  const offsets = new Map<number, number>();
  for (const n of objects) {
    const at = new RegExp(`(?<![0-9])${n} 0 obj`).exec(body);
    if (!at) throw new Error(`no object ${n}`);
    offsets.set(n, head.length + at.index);
  }
  const size = Math.max(...objects) + 1;
  const start = head.length + body.length;
  let xref = `xref\n0 ${size}\n`;
  for (let n = 0; n < size; n++) {
    const at = offsets.get(n);
    xref +=
      at === undefined
        ? `0000000000 ${n === 0 ? '65535' : '00000'} f \n`
        : `${String(at).padStart(10, '0')} 00000 n \n`;
  }
  return enc.encode(
    `${head}${body}${xref}trailer\n<< /Size ${size} /Root 1 0 R >>\nstartxref\n${start}\n%%EOF\n`,
  );
}

/** Objects 1–3: the catalog (name tree root `4 0 R`), the Data file specification and "{}". */
const BASE =
  '1 0 obj\n<< /Type /Catalog /AF [2 0 R] /Names << /EmbeddedFiles 4 0 R >> >>\nendobj\n' +
  '2 0 obj\n<< /Type /Filespec /F (sess-kept-conversation.json) /UF (sess-kept-conversation.json)' +
  ' /AFRelationship /Data /EF << /F 3 0 R >> >>\nendobj\n' +
  '3 0 obj\n<< /Type /EmbeddedFile /Subtype /application#2Fjson /Length 2 >>\nstream\n{}\nendstream\nendobj\n';

const ENTRY = '(sess-kept-conversation.json) 2 0 R';
const obj = (n: number, body: string) => `${n} 0 obj\n${body}\nendobj\n`;
const refs = (from: number, count: number) =>
  Array.from({ length: count }, (_, i) => `${from + i} 0 R`).join(' ');

/** A name tree whose one leaf names the Data file once: read exactly. */
export function oneLeafPdf(): Uint8Array {
  return classicPdf(
    `${BASE}${obj(4, `<< /Kids [5 0 R] >>`)}${obj(5, `<< /Names [${ENTRY}] >>`)}`,
    [1, 2, 3, 4, 5],
  );
}

/**
 * The reviewer's counterexample: the root lists the same leaf `children` times, and the leaf names
 * the Data file `entries` times (4095 × 10,000 is 40,950,000 entry checks if each child is rescanned).
 */
export function repeatedChildPdf(children: number, entries: number): Uint8Array {
  const kids = Array.from({ length: children }, () => '5 0 R').join(' ');
  const leaf = Array.from({ length: entries }, () => ENTRY).join(' ');
  return classicPdf(
    `${BASE}${obj(4, `<< /Kids [${kids}] >>`)}${obj(5, `<< /Names [${leaf}] >>`)}`,
    [1, 2, 3, 4, 5],
  );
}

/** A node that is its own child, or two nodes that are each other's child. */
export function cyclicPdf(kind: 'self' | 'pair'): Uint8Array {
  const tree =
    kind === 'self'
      ? obj(4, '<< /Kids [4 0 R] >>')
      : `${obj(4, '<< /Kids [5 0 R] >>')}${obj(5, '<< /Kids [4 0 R] >>')}`;
  return classicPdf(`${BASE}${tree}`, kind === 'self' ? [1, 2, 3, 4] : [1, 2, 3, 4, 5]);
}

/**
 * Distinct child nodes that share one indirect leaf array (`entries` entries) or one indirect
 * child list: the same array would be read once per node.
 */
export function sharedArrayPdf(kind: 'names' | 'kids', nodes: number, entries: number): Uint8Array {
  const first = 10;
  const shared = 6;
  const list =
    kind === 'names'
      ? obj(shared, `[${Array.from({ length: entries }, () => ENTRY).join(' ')}]`)
      : `${obj(shared, `[${first + nodes} 0 R]`)}${obj(first + nodes, `<< /Names [${ENTRY}] >>`)}`;
  const key = kind === 'names' ? '/Names' : '/Kids';
  let body = `${BASE}${obj(4, `<< /Kids [${refs(first, nodes)}] >>`)}${list}`;
  for (let i = 0; i < nodes; i++) body += obj(first + i, `<< ${key} ${shared} 0 R >>`);
  const numbers = [1, 2, 3, 4, shared, ...Array.from({ length: nodes }, (_, i) => first + i)];
  if (kind === 'kids') numbers.push(first + nodes);
  return classicPdf(body, numbers);
}

/** A chain of `depth` distinct nodes, each the only child of the one before. */
export function deepPdf(depth: number): Uint8Array {
  let body = BASE;
  for (let i = 0; i < depth; i++) body += obj(4 + i, `<< /Kids [${5 + i} 0 R] >>`);
  body += obj(4 + depth, `<< /Names [${ENTRY}] >>`);
  return classicPdf(
    body,
    Array.from({ length: depth + 4 }, (_, i) => 1 + i),
  );
}

/** A root with `width` distinct leaf children, each naming the Data file once. */
export function widePdf(width: number): Uint8Array {
  let body = `${BASE}${obj(4, `<< /Kids [${refs(10, width)}] >>`)}`;
  for (let i = 0; i < width; i++) body += obj(10 + i, `<< /Names [${ENTRY}] >>`);
  return classicPdf(body, [1, 2, 3, 4, ...Array.from({ length: width }, (_, i) => 10 + i)]);
}

/** One leaf naming the Data file `entries` times: every entry is a reference followed. */
export function manyReferencesPdf(entries: number): Uint8Array {
  const leaf = Array.from({ length: entries }, () => ENTRY).join(' ');
  return classicPdf(`${BASE}${obj(4, `<< /Names [${leaf}] >>`)}`, [1, 2, 3, 4]);
}

/**
 * `children` distinct child objects that overlap: each starts inside the one before it, in its
 * comment (to the end of one long line) or its literal string, so reading each one rescans the
 * rest of that comment or string. Only charged byte work stops it.
 */
export function overlappingPdf(
  kind: 'comment' | 'string',
  children: number,
  pad: number,
): Uint8Array {
  const first = 10;
  const filler = 'x'.repeat(pad);
  let nested = '';
  for (let i = 0; i < children; i++)
    nested +=
      kind === 'comment' ? `${first + i} 0 obj << % ${filler} ` : `${first + i} 0 obj (${filler} `;
  nested += kind === 'comment' ? '\n>>\nendobj\n' : `${')'.repeat(children)}\nendobj\n`;
  return classicPdf(`${BASE}${obj(4, `<< /Kids [${refs(first, children)}] >>`)}${nested}`, [
    1,
    2,
    3,
    4,
    ...Array.from({ length: children }, (_, i) => first + i),
  ]);
}

/**
 * A catalog holding one flat array of `count` copies of `item` (`1`, `1 0 R`, `/a` …) and no
 * record: only the work budget stops the parse, so this is the most work any input can cost.
 */
export function flatArrayPdf(count: number, item = '1'): Uint8Array {
  const items = Array.from({ length: count }, () => item).join(' ');
  return classicPdf(`1 0 obj\n<< /Type /Catalog /X [${items}] >>\nendobj\n`, [1]);
}
