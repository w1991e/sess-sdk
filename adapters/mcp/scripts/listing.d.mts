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
export const PRICING_WORDS: RegExp[];
export const PRODUCTION_REMOTE: string;
export function registryListsPackage(listing: any): boolean;
export function formatJson(value: unknown): string;
export function cursorDeeplink(name: string, config: unknown): string;
export function generate(inputs: ListingInputs): Map<string, string>;
export function scanText(file: string, content: string): string[];
export function validate(
  inputs: ListingInputs,
  files: Map<string, string>,
  schemaTexts: SchemaTexts,
): { errors: string[]; blockers: string[] };
export function pngSize(bytes: Uint8Array | undefined): { width: number; height: number } | undefined;
export function checkIconFiles(listing: any, read: (path: string) => Uint8Array | undefined): string[];
export function checkPackets(listing: any, text: string): string[];
export function readSchemas(listing: any, base?: string): SchemaTexts;
