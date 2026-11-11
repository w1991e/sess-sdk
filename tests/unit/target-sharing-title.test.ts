// Sess P2-27: the shared Agent Target's display title. The SDK has no targets helper; it learns the
// sharing contract only from the reviewed OpenAPI snapshot (contract/openapi.json, pinned in
// contract/contract-lock.json) and the wire types generated from it. These tests hold the generated
// types and the snapshot to the title the runtime defines.
import { readFileSync } from 'node:fs';
import { describe, expect, expectTypeOf, it } from 'vitest';
import type { components, paths } from '../../src/index.js';
import { validate } from '../fixtures/json-schema.js';

type Schema = { [key: string]: unknown };
type SharingRequest = components['schemas']['TargetSharingRequest'];
type Sharing = components['schemas']['TargetResponse']['sharing'];

const openapi = JSON.parse(readFileSync(new URL('../../contract/openapi.json', import.meta.url), 'utf8'));
const operation = openapi.paths['/v1/targets/{id}/sharing'].patch;
const requestSchema = openapi.components.schemas.TargetSharingRequest as Schema;
const sharingSchema = (
  openapi.components.schemas.TargetResponse as Schema & {
    properties: { sharing: Schema & { required: string[]; properties: Record<string, Schema> } };
  }
).properties.sharing;

describe('the display title in the wire types', () => {
  it('a Target’s sharing always carries title, a string or null', () => {
    expectTypeOf<Sharing['title']>().toEqualTypeOf<string | null>();
    expectTypeOf<Sharing>().toHaveProperty('title');
  });

  it('the update-sharing request takes an optional title, a string or null', () => {
    expectTypeOf<SharingRequest['title']>().toEqualTypeOf<string | null | undefined>();
    expectTypeOf<{ shared: true; title: 'Weekend planner' }>().toExtend<SharingRequest>();
    expectTypeOf<{ title: null }>().toExtend<SharingRequest>();
    expectTypeOf<
      NonNullable<paths['/v1/targets/{id}/sharing']['patch']['requestBody']>['content']['application/json']
    >().toEqualTypeOf<SharingRequest>();
  });
});

describe('the display title in the pinned contract', () => {
  it('a request body with a title is valid and sends the title as written', () => {
    const body: SharingRequest = {
      name: 'weekend-planner',
      shared: true,
      title: 'Weekend planner',
      ask_again: false,
    };
    expect(validate(requestSchema, body)).toBeNull();
    expect(JSON.parse(JSON.stringify(body))).toMatchObject({ shared: true, title: 'Weekend planner' });
    expect(validate(requestSchema, { title: null })).toBeNull();
    expect(validate(requestSchema, { title: 'x'.repeat(241) })).toBe('/title: anyOf');
  });

  it('the documented share example sends a title', () => {
    const example = operation.requestBody.content['application/json'].examples.share.value;
    expect(example).toMatchObject({ shared: true, title: 'Weekend planner' });
    expect(validate(requestSchema, example)).toBeNull();
  });

  it('the response requires title, at most 60 characters or null', () => {
    expect(sharingSchema.required).toContain('title');
    const branches = (sharingSchema.properties.title as { anyOf: Schema[] }).anyOf;
    expect(branches).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: 'string', maxLength: 60 }),
        expect.objectContaining({ type: 'null' }),
      ]),
    );
  });

  it('the 400 names title_required and title_invalid, with field /title', () => {
    const refusal = operation.responses['400'].description as string;
    expect(refusal).toContain('VALIDATION_FAILED');
    expect(refusal).toContain('`title_invalid`');
    expect(refusal).toContain('`title_required`');
    expect(refusal).toContain('field `/title`');
  });
});
