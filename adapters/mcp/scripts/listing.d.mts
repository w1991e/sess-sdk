// Types for scripts/listing.mjs, used by tests/listing.test.ts.
export interface ListingInputs {
  listing: any;
  manifest: any;
  tools: readonly any[];
  toolNames: readonly string[];
  envNames: readonly string[];
  askFieldLimit: number;
}
export interface SchemaTexts {
  registry: string;
  plugin: string;
  mcp: string;
}
export const LISTING_SCHEMA: string;
export const FORBIDDEN_WORDS: RegExp[];
export const OVERCLAIMS: RegExp[];
export function formatJson(value: unknown): string;
export function cursorDeeplink(name: string, config: unknown): string;
export function generate(inputs: ListingInputs): Map<string, string>;
export function scanText(file: string, content: string): string[];
export function validate(
  inputs: ListingInputs,
  files: Map<string, string>,
  schemaTexts: SchemaTexts,
): { errors: string[]; blockers: string[] };
export function readSchemas(listing: any, base?: string): SchemaTexts;
