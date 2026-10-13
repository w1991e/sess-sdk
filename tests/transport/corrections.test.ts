import { inspect } from 'node:util';
import { describe, expect, it, vi } from 'vitest';
import { Sess, type MutationOptions } from '../../src/index.js';
import { API_KEY, INTERACTION, SESSION_ID, json, session } from '../fixtures/api.js';
import { fixture, digest, signClaims } from '../security/fixtures.js';

describe('correction regressions S-02/S-03/S-04', () => {
  it('returns a rejected Promise for a malformed plain-JavaScript mutation key', async () => {
    const fetch = vi.fn();
    const sdk = new Sess({ apiKey: API_KEY, fetch });
    const result = sdk.sessions.complete(SESSION_ID, {
      ifMatch: '"original"',
      idempotencyKey: {},
    } as unknown as MutationOptions);
    expect(result).toBeInstanceOf(Promise);
    await expect(result).rejects.toMatchObject({ kind: 'configuration', outcome: 'not_sent' });
    expect(fetch).not.toHaveBeenCalled();
  });
  it.each(['x', 'é', '🦉'])(
    'rejects over-maximum heading and label code points for %s',
    async (character) => {
      const long = character.repeat(201);
      for (const change of [
        { source: { kind: 'sess_surface' as const, components: [{ type: 'heading' as const, text: long }] } },
        {
          source: {
            kind: 'sess_surface' as const,
            components: [
              { type: 'field' as const, name: 'amount', label: long, schema: { type: 'number' as const } },
            ],
          },
        },
        { actions: [{ id: 'submit', label: long }] },
      ]) {
        const value = session({ interaction: { ...session().interaction, ...change } });
        const sdk = new Sess({ apiKey: API_KEY, fetch: async () => json(value, 200, { etag: '"one"' }) });
        await expect(sdk.sessions.retrieve(SESSION_ID)).rejects.toMatchObject({ kind: 'protocol' });
      }
    },
  );
  it('retrieves either exact immutable Surface variant without losing semantic content', async () => {
    const display = {
      id: SESSION_ID,
      revision: 2,
      interaction: {
        mode: 'display',
        title: 'Display',
        description: 'Preserve me',
        source: { kind: 'data', data: { unicode: 'é🦉' } },
      },
    };
    const interactive = {
      id: SESSION_ID,
      revision: 2,
      interaction: session().interaction,
      response_schema: session().response_schema,
    };
    for (const value of [display, interactive]) {
      const sdk = new Sess({ apiKey: API_KEY, fetch: async () => json(value) });
      expect((await sdk.sessions.retrieveSurface(SESSION_ID, 2)).data).toEqual(value);
    }
  });
  it.each([
    { id: SESSION_ID, revision: 1, interaction: { mode: 'unknown' } },
    { id: SESSION_ID, revision: 2, interaction: session().interaction, response_schema: {} },
    {
      id: 'ses_00000000000000000000000002',
      revision: 1,
      interaction: session().interaction,
      response_schema: {},
    },
    {
      id: SESSION_ID,
      revision: 1,
      interaction: { mode: 'display', title: 'Display', source: { kind: 'data', data: {} } },
      response_schema: {},
    },
    { id: SESSION_ID, revision: 1, interaction: session().interaction },
  ])('rejects malformed or misbound immutable Surface', async (value) => {
    const sdk = new Sess({ apiKey: API_KEY, fetch: async () => json(value) });
    await expect(sdk.sessions.retrieveSurface(SESSION_ID, 1)).rejects.toMatchObject({ kind: 'protocol' });
  });
  it.each(['x', 'é', '🦉'])(
    'counts contract title code points for %s across reads and writes',
    async (character) => {
      const interaction = { ...session().interaction, title: character.repeat(200) };
      const fetch = vi.fn(async (url, init) => {
        if (String(url).includes('/surfaces/'))
          return json({ id: SESSION_ID, revision: 1, interaction, response_schema: {} });
        return json(
          session({ interaction, status: String(url).endsWith('/complete') ? 'completed' : 'active' }),
          200,
          { etag: '"one"' },
        );
      });
      const sdk = new Sess({ apiKey: API_KEY, fetch });
      expect((await sdk.sessions.retrieve(SESSION_ID)).data.interaction.title).toBe(character.repeat(200));
      expect((await sdk.sessions.retrieveSurface(SESSION_ID, 1)).data.interaction.title).toBe(
        character.repeat(200),
      );
      expect(
        (
          await sdk.sessions.publish(
            SESSION_ID,
            { interaction: INTERACTION },
            { ifMatch: '"original"', idempotencyKey: 'fixed' },
          )
        ).data.interaction.title,
      ).toBe(character.repeat(200));
      expect(
        (await sdk.sessions.complete(SESSION_ID, { ifMatch: '"original"', idempotencyKey: 'fixed' })).data
          .interaction.title,
      ).toBe(character.repeat(200));
      const invalid = new Sess({
        apiKey: API_KEY,
        fetch: async () =>
          json(session({ interaction: { ...interaction, title: character.repeat(201) } }), 200, {
            etag: '"one"',
          }),
      });
      await expect(invalid.sessions.retrieve(SESSION_ID)).rejects.toMatchObject({ kind: 'protocol' });
    },
  );
  it.each(['x', 'é', '🦉'])('preserves maximum text code points for %s', async (character) => {
    const interaction = {
      ...session().interaction,
      source: {
        kind: 'sess_surface' as const,
        components: [{ type: 'text' as const, text: character.repeat(4000) }],
      },
    };
    const sdk = new Sess({
      apiKey: API_KEY,
      fetch: async () => json(session({ interaction }), 200, { etag: '"one"' }),
    });
    expect((await sdk.sessions.retrieve(SESSION_ID)).data.interaction.source).toEqual(interaction.source);
    const invalid = new Sess({
      apiKey: API_KEY,
      fetch: async () =>
        json(
          session({
            interaction: {
              ...interaction,
              source: { kind: 'sess_surface', components: [{ type: 'text', text: character.repeat(4001) }] },
            },
          }),
          200,
          { etag: '"one"' },
        ),
    });
    await expect(invalid.sessions.retrieve(SESSION_ID)).rejects.toMatchObject({ kind: 'protocol' });
  });
  it.each(['x', 'é', '🦉'])(
    'fully verifies exact code-point boundary content without normalizing %s',
    async (character) => {
      const f = fixture(Date.now() - 1000);
      f.session.interaction.title = character.repeat(200);
      f.session.interaction.source.components = [
        { type: 'heading', text: character.repeat(200) },
        { type: 'text', text: character.repeat(4000) },
        {
          type: 'field',
          name: 'amount',
          label: character.repeat(200),
          schema: { type: 'number' },
          value: 125.5,
        },
      ];
      f.session.interaction.actions[0]!.label = character.repeat(200);
      f.surface.interaction = structuredClone(f.session.interaction);
      f.claims.action.label = character.repeat(200);
      f.claims.surface.hash = digest(f.surface.interaction);
      f.response.receipt = signClaims(f.claims);
      f.session.responses = [f.response];
      const sdk = new Sess({
        apiKey: API_KEY,
        baseUrl: f.claims.iss,
        fetch: async (url) => {
          if (String(url).includes('/surfaces/')) return json(f.surface);
          if (String(url).includes('/.well-known/')) return json(f.keys);
          return json(f.session, 200, { etag: '"one"' });
        },
      });
      const checked = await sdk.receipts.verifyResponse({
        sessionId: f.session.id,
        response: f.response,
        expectedWorkspaceId: f.claims.aud,
      });
      expect(checked.surface.interaction).toEqual(f.surface.interaction);
      expect(checked.claims.surface.hash).toBe(digest(f.surface.interaction));
    },
  );
  it.each(['publish', 'complete'] as const)(
    'rejects explicitly supplied nonprimitive %s replay identity before any effects',
    async (operation) => {
      const coercion = vi.fn(() => 'safe-looking-key');
      const getter = vi.fn(() => 'safe-looking-key');
      const privateValue = 'synthetic-private-payload';
      const coercive = { privateValue, toString: coercion, valueOf: coercion, toJSON: coercion };
      const values: unknown[] = [
        null,
        undefined,
        '',
        42,
        true,
        [],
        ['safe-looking-key'],
        new String('safe-looking-key'),
        coercive,
      ];
      const optionsList = values.map((idempotencyKey) => ({ ifMatch: '"original"', idempotencyKey }));
      optionsList.push(
        Object.defineProperty({ ifMatch: '"original"' }, 'idempotencyKey', {
          enumerable: true,
          get: getter,
        }) as (typeof optionsList)[number],
      );
      for (const options of optionsList) {
        const provider = vi.fn(async () => API_KEY);
        const fetch = vi.fn(async () => json(session(), 200, { etag: '"one"' }));
        const sdk = new Sess({ apiKey: provider, fetch });
        const error = await (async () =>
          operation === 'publish'
            ? sdk.sessions.publish(SESSION_ID, { interaction: INTERACTION }, options as MutationOptions)
            : sdk.sessions.complete(SESSION_ID, options as MutationOptions))().then(
          () => undefined,
          (error: unknown) => error,
        );
        expect(error).toMatchObject({ kind: 'configuration', outcome: 'not_sent' });
        expect(provider).not.toHaveBeenCalled();
        expect(fetch).not.toHaveBeenCalled();
        expect(JSON.stringify(error)).not.toContain(privateValue);
        expect(inspect(error)).not.toContain(privateValue);
      }
      expect(coercion).not.toHaveBeenCalled();
      expect(getter).not.toHaveBeenCalled();
    },
  );
});
