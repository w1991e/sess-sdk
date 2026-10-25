// Test-only: a small JSON Schema 2020-12 validator for the keywords the runtime's OpenAPI uses for
// the items and record components and the interactive interaction. An unknown keyword throws, so a
// schema this does not understand can never pass silently. Lengths count Unicode code points, as
// Sess (Ajv) does.
type Schema = { [key: string]: unknown };

const ANNOTATIONS = new Set(['description', 'examples', 'title']);
const KNOWN = new Set([
  'type',
  'properties',
  'required',
  'additionalProperties',
  'propertyNames',
  'minProperties',
  'maxProperties',
  'items',
  'minItems',
  'maxItems',
  'minLength',
  'maxLength',
  'pattern',
  'minimum',
  'maximum',
  'const',
  'enum',
  'anyOf',
]);

function typeOf(value: unknown): string {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  if (typeof value === 'number') return Number.isInteger(value) ? 'integer' : 'number';
  return typeof value;
}

/** The first violation as `pointer: keyword`, or null when the value is valid. */
export function validate(schema: Schema, value: unknown, at = ''): string | null {
  for (const key of Object.keys(schema))
    if (!KNOWN.has(key) && !ANNOTATIONS.has(key)) throw new Error(`unsupported keyword ${key} at ${at}`);
  if (schema.anyOf !== undefined) {
    const branches = schema.anyOf as Schema[];
    if (!branches.some((b) => validate(b, value, at) === null)) return `${at}: anyOf`;
  }
  if (schema.const !== undefined && value !== schema.const) return `${at}: const`;
  if (schema.enum !== undefined && !(schema.enum as unknown[]).includes(value)) return `${at}: enum`;
  if (schema.type !== undefined) {
    const t = typeOf(value);
    const ok = schema.type === t || (schema.type === 'number' && t === 'integer');
    if (!ok) return `${at}: type ${String(schema.type)}`;
  }
  if (typeof value === 'string') {
    const length = [...value].length;
    if (typeof schema.minLength === 'number' && length < schema.minLength) return `${at}: minLength`;
    if (typeof schema.maxLength === 'number' && length > schema.maxLength) return `${at}: maxLength`;
    if (typeof schema.pattern === 'string' && !new RegExp(schema.pattern, 'u').test(value))
      return `${at}: pattern`;
  }
  if (typeof value === 'number') {
    if (typeof schema.minimum === 'number' && value < schema.minimum) return `${at}: minimum`;
    if (typeof schema.maximum === 'number' && value > schema.maximum) return `${at}: maximum`;
  }
  if (Array.isArray(value)) {
    if (typeof schema.minItems === 'number' && value.length < schema.minItems) return `${at}: minItems`;
    if (typeof schema.maxItems === 'number' && value.length > schema.maxItems) return `${at}: maxItems`;
    if (schema.items !== undefined)
      for (const [i, item] of value.entries()) {
        const failed = validate(schema.items as Schema, item, `${at}/${i}`);
        if (failed) return failed;
      }
  }
  if (typeOf(value) === 'object') {
    const object = value as Record<string, unknown>;
    const keys = Object.keys(object);
    if (typeof schema.minProperties === 'number' && keys.length < schema.minProperties)
      return `${at}: minProperties`;
    if (typeof schema.maxProperties === 'number' && keys.length > schema.maxProperties)
      return `${at}: maxProperties`;
    for (const key of (schema.required as string[] | undefined) ?? [])
      if (!Object.hasOwn(object, key)) return `${at}: required ${key}`;
    const properties = (schema.properties as Record<string, Schema> | undefined) ?? {};
    for (const key of keys) {
      if (schema.propertyNames !== undefined) {
        const failed = validate(schema.propertyNames as Schema, key, `${at}/${key}`);
        if (failed) return failed;
      }
      const child = properties[key];
      if (child !== undefined) {
        const failed = validate(child, object[key], `${at}/${key}`);
        if (failed) return failed;
      } else if (schema.additionalProperties === false) return `${at}/${key}: additionalProperties`;
      else if (schema.additionalProperties !== undefined && schema.additionalProperties !== true) {
        const failed = validate(schema.additionalProperties as Schema, object[key], `${at}/${key}`);
        if (failed) return failed;
      }
    }
  }
  return null;
}
