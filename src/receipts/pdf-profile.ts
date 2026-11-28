// The Sess receipt PDF profile, as `sess verify` reads it (Sess L-196): the one embedded file and
// the extractor's bounds, copied from the Sess runtime's packages/evidence/src/receipt-pdf/
// profile.ts (the exporter's own profile, TRY-PDF-BOUNDS-03), values unchanged. Only the constants
// the extractor uses are here; the exporter's naming helpers are not. tests/unit/receipt-pdf.test.ts
// holds these values to the recorded Sess source.

/**
 * The one embedded file: the exact Keep JSON (`sess.kept-conversation` v1, or v2 when it holds a
 * receipt v2 round, or v3, the person-carried file of archival-person-projection §5), unchanged.
 * The profile's bounds are the same for every version.
 */
export const RECEIPT_PDF_ATTACHMENT_NAME = 'sess-kept-conversation.json';
/** Its MIME type (the EmbeddedFile /Subtype) and associated-file relationship. */
export const RECEIPT_PDF_ATTACHMENT_TYPE = 'application/json';
export const RECEIPT_PDF_ATTACHMENT_RELATIONSHIP = 'Data';

/**
 * The profile's bounds, separate from each other and from the JSON format's own limits:
 * - `pdfMaxBytes`: the PDF the extractor reads (input bound).
 * - `attachmentMaxBytes`: the embedded Keep JSON (decoded size; the profile stores it unfiltered,
 *   so decoded and stored sizes are the same and nothing is decompressed).
 * - `bundleMaxBytes`: each bundle-v1 or bundle-v2 inside it, as canonical JSON (the bundle formats' own 1 MiB bound).
 * - `maxRounds`: rounds in one file (keep-v1's and keep-v2's own bound).
 * - `maxPages`: pages of readable text the exporter writes.
 * - `maxObjects`, `maxXrefSections`, `maxNesting`, `maxTokens`: the extractor's traversal and
 *   parser work. `maxTokens` is its one work budget: every token, every byte scanned outside stream
 *   data, every reference followed (cached or not) and every name-tree entry and child count.
 * The exporter emits only PDFs inside every bound, so each one is accepted by its own extractor.
 */
export interface ReceiptPdfBounds {
  readonly pdfMaxBytes: number;
  readonly attachmentMaxBytes: number;
  readonly bundleMaxBytes: number;
  readonly maxRounds: number;
  readonly maxPages: number;
  readonly maxObjects: number;
  readonly maxXrefSections: number;
  readonly maxNesting: number;
  readonly maxTokens: number;
}

export const RECEIPT_PDF_BOUNDS: ReceiptPdfBounds = Object.freeze({
  pdfMaxBytes: 24 * 1_048_576,
  attachmentMaxBytes: 16 * 1_048_576,
  bundleMaxBytes: 1_048_576,
  maxRounds: 64,
  maxPages: 400,
  maxObjects: 50_000,
  maxXrefSections: 16,
  maxNesting: 32,
  maxTokens: 2_000_000,
});
