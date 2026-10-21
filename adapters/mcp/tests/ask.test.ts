import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { AdapterError } from '../src/errors.js';
import { createSessMcpServer } from '../src/server.js';
import { ASK_LIMITS, parseAskArgs } from '../src/validate.js';
import { ANSWER_1, FakeSess, acceptingVerifier, clientFor, env, tempDir } from './helpers.js';

let dir: ReturnType<typeof tempDir>;
beforeEach(() => {
  dir = tempDir();
});
afterEach(() => dir.cleanup());

const ask = {
  question: 'Plan an afternoon',
  details: 'Conditions are illustrative.',
  fields: [
    {
      name: 'activity',
      label: 'Preferred activity',
      type: 'choice',
      options: ['walk', 'museum', 'cafe'],
      default: 'walk',
    },
    { name: 'hours', label: 'Hours available', type: 'integer', minimum: 1, maximum: 6, default: 2 },
  ],
};

function rejects(raw: unknown, fragment: string | RegExp): void {
  try {
    parseAskArgs(raw);
  } catch (error) {
    expect(error).toBeInstanceOf(AdapterError);
    expect((error as AdapterError).code).toBe('INVALID_ARGUMENTS');
    expect((error as AdapterError).message).toMatch(fragment);
    return;
  }
  throw new Error('expected INVALID_ARGUMENTS');
}

describe('sess_ask input', () => {
  it('expands to an ordinary interactive interaction', () => {
    expect(parseAskArgs(ask).interaction).toEqual({
      mode: 'interactive',
      title: 'Plan an afternoon',
      source: {
        kind: 'sess_surface',
        components: [
          { type: 'text', text: 'Conditions are illustrative.' },
          {
            type: 'field',
            name: 'activity',
            label: 'Preferred activity',
            required: true,
            schema: { type: 'string', enum: ['walk', 'museum', 'cafe'] },
            value: 'walk',
          },
          {
            type: 'field',
            name: 'hours',
            label: 'Hours available',
            required: true,
            schema: { type: 'integer', minimum: 1, maximum: 6 },
            value: 2,
          },
        ],
      },
      actions: [{ id: 'submit', label: 'Send', intent: 'submit' }],
    });
    const multi = parseAskArgs({
      question: 'Which?',
      fields: [
        { name: 'tags', label: 'Tags', type: 'multi_choice', options: ['a', 'b'] },
        { name: 'ok', label: 'OK', type: 'boolean' },
        { name: 'note', label: 'Note', type: 'text', multiline: true, required: false },
      ],
      submit_label: 'Confirm',
    }).interaction as any;
    expect(multi.source.components[0].schema).toEqual({
      type: 'array',
      items: { type: 'string', enum: ['a', 'b'] },
      uniqueItems: true,
    });
    expect(multi.source.components[1].required).toBe(false);
    expect(multi.source.components[2]).toMatchObject({ multiline: true, required: false });
    expect(multi.actions[0].label).toBe('Confirm');
  });

  it('is closed and uses the same validation limits as sess_request', () => {
    rejects({ ...ask, origin: 'https://evil.test' }, 'unknown property');
    rejects({ ...ask, api_key: 'x' }, 'unknown property');
    rejects({ ...ask, fields: [{ ...ask.fields[0], html: '<b>' }] }, 'unknown property');
    rejects({ question: 'Q' }, 'missing required property "fields"');
    rejects({ question: 'Q', fields: [] }, /1\.\.12 fields/);
    rejects(
      {
        question: 'Q',
        fields: Array.from({ length: ASK_LIMITS.fields + 1 }, (_, i) => ({
          name: `f${i}`,
          label: 'F',
          type: 'boolean',
        })),
      },
      /1\.\.12 fields/,
    );
    rejects({ question: 'Q', fields: [{ name: 'a', label: 'A', type: 'choice' }] }, 'required for choice');
    rejects(
      { question: 'Q', fields: [{ name: 'a', label: 'A', type: 'text', options: ['x'] }] },
      'only allowed for choice',
    );
    rejects(
      { question: 'Q', fields: [{ name: 'a', label: 'A', type: 'choice', options: ['x', 'x'] }] },
      'unique',
    );
    rejects({ question: 'Q', fields: [{ name: 'a', label: 'A', type: 'html' }] }, 'must be one of');
    rejects(
      { question: 'Q', fields: [{ name: 'a', label: 'A', type: 'boolean', minimum: 1 }] },
      'minimum/maximum',
    );
    rejects({ question: 'Q', fields: [{ name: 'constructor', label: 'A', type: 'text' }] }, 'reserved name');
    rejects(
      { question: 'Q', fields: [ask.fields[0], { ...ask.fields[1], name: 'activity' }] },
      'duplicates another field',
    );
    rejects({ question: 'Q ‮', fields: [ask.fields[0]] }, 'control or bidirectional');
    rejects(
      JSON.parse(`{"question":"Q","fields":[{"name":"a","label":"A","type":"text"}],"__proto__":{}}`),
      'unsafe key',
    );
    rejects(
      { question: 'Q', details: 'x'.repeat(4001), fields: [ask.fields[0]] },
      'Shorten it to at most 4000 characters',
    );
  });
});

describe('sess_ask through the MCP server', () => {
  async function connect(fake: FakeSess) {
    const created = createSessMcpServer({
      env: env(dir.path),
      createClient: clientFor(fake, acceptingVerifier(fake)),
      diagnostics: () => {},
    });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await created.connect(serverTransport);
    const client = new Client({ name: 'test', version: '0' });
    await client.connect(clientTransport);
    return client;
  }

  it('creates exactly one Session through the request lifecycle and returns URL + handle at once', async () => {
    const fake = new FakeSess();
    const client = await connect(fake);
    const result = await client.callTool({ name: 'sess_ask', arguments: ask });
    expect(result.isError).toBeFalsy();
    const interaction = (result.structuredContent as any).interaction;
    expect(interaction).toEqual({
      handle: expect.stringMatching(/^sh_/),
      revision: 1,
      state: 'waiting',
      humanUrl: fake.humanUrl,
    });
    // Exactly one create and nothing else: no wait, no read, no answer.
    expect(fake.calls.map((c) => `${c.method} ${c.path}`)).toEqual(['POST /v1/sessions']);
    expect(fake.session!.interaction.title).toBe('Plan an afternoon');
    // The same durable record as sess_request, continued with the ordinary tools.
    const records = readdirSync(join(dir.path, 'profiles', 'default', 'handles')).filter((n) =>
      n.endsWith('.json'),
    );
    expect(records).toEqual([`${interaction.handle}.json`]);
    const eventId = fake.answer(ANSWER_1.data);
    const answered = await client.callTool({
      name: 'sess_response',
      arguments: { handle: interaction.handle, revision: 1, wait_ms: 0 },
    });
    expect((answered.structuredContent as any).interaction).toMatchObject({
      state: 'answered',
      response: { eventId, verified: true },
    });
  });

  it('a rejected sess_ask sends nothing and writes no record', async () => {
    const fake = new FakeSess();
    const client = await connect(fake);
    const result = await client.callTool({
      name: 'sess_ask',
      arguments: { question: 'Q', fields: [{ name: 'a', label: 'A', type: 'choice' }] },
    });
    expect(result.isError).toBe(true);
    expect(JSON.parse((result.content as any)[0].text).error.code).toBe('INVALID_ARGUMENTS');
    expect(fake.calls).toHaveLength(0);
  });
});
