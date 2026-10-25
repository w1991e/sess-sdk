// Commerce: a text lint for Markdown pipe tables. Sess shows text exactly as written (plain text,
// never markup), so a table drawn with pipes reaches the person as a wall of `|` and `---`. Prices
// belong in an items component; other rows of facts in a record. Pure: no I/O.

/** One pipe table found in a text. */
export interface TextLintFinding {
  readonly rule: 'pipe-table';
  /** The 1-based line where the table starts. */
  readonly line: number;
  /** What to send instead: `items` for amounts, `record` for other rows. */
  readonly use: 'items' | 'record';
  readonly message: string;
}

// A GFM delimiter row: `| --- | :---: |`, `---|---`, `| --- |`.
const DELIMITER = /^\s*\|?\s*:?-+:?\s*(?:\|\s*:?-+:?\s*)*\|?\s*$/;
// Amount-like content: a currency symbol, an ISO-style code beside a number, a two- or three-place
// decimal, or a price word in the header.
const MONEY = /[$€£¥₹₩₽₺₪₫฿]|\b[A-Z]{3}\s?-?\d|\d\s?[A-Z]{3}\b|\d[.,]\d{2,3}\b/;
const PRICE_WORDS = /\b(?:price|amount|total|subtotal|cost|tax|vat|fee|qty|quantity)\b/i;

/** The cells of a line split on unescaped pipes, or null when it has no pipe. */
function cells(line: string): string[] | null {
  const parts = line.split(/(?<!\\)\|/);
  return parts.length > 1 ? parts : null;
}
const bordered = (line: string) => /^\s*\|.*\|\s*$/.test(line) && (cells(line)?.length ?? 0) >= 3;

/**
 * Finds Markdown pipe tables in a text: a header row with pipes followed by a delimiter row
 * (`|---|---|`), or two or more consecutive rows drawn between pipes (`| a | b |`). Each finding
 * says where the table starts and what to send instead: an items component for prices, or a
 * record for other rows. Returns an empty list for ordinary text.
 */
export function lintText(text: string): TextLintFinding[] {
  if (typeof text !== 'string') return [];
  const lines = text.split(/\r\n|\r|\n/);
  const findings: TextLintFinding[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i]!;
    const next = lines[i + 1];
    const headed =
      cells(line) !== null &&
      next !== undefined &&
      next.includes('-') &&
      DELIMITER.test(next) &&
      next.includes('|');
    const drawn = bordered(line) && next !== undefined && bordered(next);
    if (!headed && !drawn) {
      i += 1;
      continue;
    }
    let end = i + (headed ? 2 : 1);
    while (end < lines.length && cells(lines[end]!) !== null && /\S/.test(lines[end]!)) end += 1;
    const use = lines.slice(i, end).some((l) => MONEY.test(l) || PRICE_WORDS.test(l)) ? 'items' : 'record';
    findings.push({
      rule: 'pipe-table',
      line: i + 1,
      use,
      message:
        use === 'items'
          ? `Line ${i + 1} starts a Markdown table. Sess shows text as written, so the person would see the pipes. For prices, send an items component instead.`
          : `Line ${i + 1} starts a Markdown table. Sess shows text as written, so the person would see the pipes. For rows of facts, send a record component instead.`,
    });
    i = end;
  }
  return findings;
}
