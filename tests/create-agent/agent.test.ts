// The generated starter agent, offline: type-checked against the SDK's declarations, then run end to
// end against a fake SESS API (genuine signed receipts) and fake MET Norway / NWS services
// (create-agent/test/fake-world.mjs). `@sess.si/sdk` resolves to this repository's build, whose
// packed bytes `npm run check:pin` proves equal to the published pin.
import { beforeAll, describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { API_KEY, CONTACT, ROOT, initialize, runAgent, scratch, type WorldRecord } from './helpers.js';

const ATTRIBUTION =
  'Weather data from MET Norway (https://api.met.no), licensed CC BY 4.0 ' +
  '(https://creativecommons.org/licenses/by/4.0/). Summarized into time slots by this agent.';
const ROUND_2 = { choice: 'option_2', time: 'evening' }; // option 2 is in the afternoon: a correction

/** A freshly generated agent whose @sess.si/sdk is this repository's build. */
function generate(): { app: string; record: string } {
  const cwd = scratch('sess-starter-');
  expect(initialize(cwd, 'agent').status).toBe(0);
  const app = join(cwd, 'agent');
  mkdirSync(join(app, 'node_modules', '@sess.si'), { recursive: true });
  symlinkSync(ROOT, join(app, 'node_modules', '@sess.si', 'sdk'), 'junction');
  return { app, record: join(cwd, 'record.json') };
}
const read = (path: string) => JSON.parse(readFileSync(path, 'utf8')) as WorldRecord;
const components = (record: WorldRecord, round: number) =>
  record.interactions[round - 1]?.source.components ?? [];
const texts = (record: WorldRecord, round: number) => components(record, round).map((c) => JSON.stringify(c));

beforeAll(() => {
  if (!existsSync(join(ROOT, 'dist', 'index.d.ts')))
    throw new Error('Build the SDK first (npm run build); npm run check does this before the tests.');
});

describe('generated starter agent', { timeout: 60_000 }, () => {
  it('type-checks against the published SDK declarations', () => {
    const { app } = generate();
    const tsc = spawnSync(
      process.execPath,
      [
        join(ROOT, 'node_modules', 'typescript', 'bin', 'tsc'),
        ...['--noEmit', '--allowJs', '--checkJs', '--strictNullChecks', '--skipLibCheck', 'false'],
        ...['--module', 'nodenext', '--moduleResolution', 'nodenext', '--target', 'es2022'],
        ...['--types', 'node', '--typeRoots', join(ROOT, 'node_modules', '@types'), 'agent.mjs'],
      ],
      { cwd: app, encoding: 'utf8' },
    );
    expect(`${tsc.stdout}${tsc.stderr}`).toBe('');
    expect(tsc.status).toBe(0);
  });

  it('runs two rounds on MET Norway weather, completes and prints a verified receipt; then uses its cache', async () => {
    const { app, record } = generate();
    const run = await runAgent(app, record, { answers: [{ place: 'oslo', day: 'sunday' }, ROUND_2] });
    expect(run.stderr).toBe('');
    expect(run.code).toBe(0);
    const lines = run.stdout.split('\n');
    expect(lines[0]).toBe('Agent running. Asking where and when.');
    const link = lines.findIndex((line) => /^ {2}https:\/\/app\.sess\.si\/s\/\S+$/.test(line));
    expect(link).toBeGreaterThan(0);
    expect(lines.findIndex((line) => line.startsWith('Question 2'))).toBeGreaterThan(link);
    expect(run.stdout).toMatch(
      /\nYour plan: A picnic in the park, Sunday \d{1,2} \w+, Evening, 17:00–21:00 in Oslo \(18 °C · dry · wind 3 m\/s\)\.\n/,
    );
    expect(run.stdout).toContain(
      `${ATTRIBUTION}\nPicked by a fixed rule from the forecast. No AI model is used.`,
    );
    expect(run.stdout).toMatch(
      /You approved "A picnic in the park, Sunday .*, Evening, 17:00–21:00" at \d\d:\d\d · verified ✓/,
    );
    expect(run.stdout).toContain('Verify this yourself at https://sess.si/verify\n');
    expect(run.stdout).toMatch(/Session ses_\w+ is completed\.\n$/);
    expect(run.stdout).not.toContain(API_KEY);

    const world = read(record);
    expect(world).toMatchObject({ creates: 1, completes: 1, completeChecked: true, unauthorized: 0 });
    expect(world.status).toBe('completed');
    expect(world.refused).toEqual([]);
    expect(world.pollsBeforeAnswer).toEqual([1, 1]); // the agent was waiting before each answer
    expect(world.publishes).toHaveLength(1);
    expect(world.publishes[0]?.ifMatch).toBe(world.publishes[0]?.current);
    expect(world.publishes[0]?.key).toMatch(/^[0-9a-f-]{36}$/);
    // MET Norway only (Oslo is not in the US): identified, 4-decimal coordinates, never redirected.
    expect(world.weather).toEqual([
      {
        url: 'https://api.met.no/weatherapi/locationforecast/2.0/compact?lat=59.9139&lon=10.7522',
        userAgent: `sess-agent-starter/1.0 ${CONTACT}`,
        accept: 'application/json',
        ifModifiedSince: null,
        redirect: 'error',
      },
    ]);
    // Round 1 asks where and when; round 2 shows the forecast with attribution and three plans.
    expect(world.interactions.map((i) => i.title)).toEqual(['Plan your weekend', 'Pick your plan']);
    expect(components(world, 1).map((c) => c.name ?? c.type)).toEqual(['text', 'place', 'day']);
    expect(components(world, 2).map((c) => c.name ?? c.type)).toEqual(['record', 'text', 'choice', 'time']);
    expect(texts(world, 2)[1]).toContain(JSON.stringify(ATTRIBUTION));
    const choice = components(world, 2)[2] as {
      schema: { enum: string[] };
      option_labels: Record<string, string>;
    };
    expect(choice.schema.enum).toEqual(['option_1', 'option_2', 'option_3']);
    expect(Object.values(choice.option_labels)).toEqual([
      'A walk or hike outdoors — Morning, 09:00–12:00 (18 °C · dry · wind 3 m/s)',
      'A picnic in the park — Afternoon, 12:00–17:00 (18 °C · dry · wind 3 m/s)',
      'A bike ride — Evening, 17:00–21:00 (18 °C · dry · wind 3 m/s)',
    ]);

    // A second run within the forecast's Expires does not ask MET again.
    const cached = await runAgent(app, record, { answers: [{ place: 'oslo', day: 'sunday' }, ROUND_2] });
    expect(cached.code).toBe(0);
    expect(read(record).weather).toEqual([]);

    // After it expires, the agent revalidates with If-Modified-Since and reuses the 304'd copy.
    const cachePath = join(app, '.weather-cache.json');
    const cache = JSON.parse(readFileSync(cachePath, 'utf8')) as Record<string, { expires: number }>;
    for (const entry of Object.values(cache)) entry.expires = Date.now() - 1000;
    writeFileSync(cachePath, JSON.stringify(cache));
    const revalidated = await runAgent(app, record, {
      answers: [{ place: 'oslo', day: 'sunday' }, ROUND_2],
      met: 'revalidate',
    });
    expect(revalidated.code).toBe(0);
    expect(revalidated.stdout).toContain('(18 °C · dry · wind 3 m/s)');
    expect(read(record).weather.map((w) => w.ifModifiedSince)).toEqual(['Thu, 15 Oct 2026 06:00:00 GMT']);
  });

  it('adds NWS alerts for a US city and backs off after a 429', async () => {
    const { app, record } = generate();
    const run = await runAgent(app, record, {
      answers: [{ place: 'new_york', day: 'saturday' }, ROUND_2],
      met: 'busy',
    });
    expect(run.stderr).toBe('');
    expect(run.code).toBe(0);
    expect(run.stdout).toContain('in New York (18 °C · dry · wind 3 m/s).');
    const world = read(record);
    expect(world.weather.map((w) => [w.url, w.accept])).toEqual([
      [
        'https://api.met.no/weatherapi/locationforecast/2.0/compact?lat=40.7128&lon=-74.006',
        'application/json',
      ],
      [
        'https://api.met.no/weatherapi/locationforecast/2.0/compact?lat=40.7128&lon=-74.006',
        'application/json',
      ],
      ['https://api.weather.gov/alerts/active?point=40.7128,-74.006', 'application/geo+json'],
    ]);
    expect(world.weather.every((w) => w.userAgent === `sess-agent-starter/1.0 ${CONTACT}`)).toBe(true);
    expect(texts(world, 2).join()).toContain('US weather alerts (NWS)');
    expect(texts(world, 2).join()).toContain('Heat Advisory until 8 PM');
  });

  it('says so when NWS alerts cannot be reached, and still completes the plan', async () => {
    const { app, record } = generate();
    const run = await runAgent(app, record, {
      answers: [{ place: 'chicago', day: 'saturday' }, ROUND_2],
      nws: 'outage',
    });
    expect(run.stderr).toBe('');
    expect(run.code).toBe(0);
    expect(run.stdout).toContain('in Chicago (18 °C · dry · wind 3 m/s).');
    expect(run.stdout).toContain('US weather alerts (NWS) could not be reached right now.');
    expect(run.stdout).toContain('· verified ✓');
    const world = read(record);
    expect(world.status).toBe('completed');
    expect(world.weather.filter((w) => w.url.startsWith('https://api.weather.gov/'))).toHaveLength(3);
    const round2 = texts(world, 2).join();
    expect(round2).toContain('US weather alerts (NWS) could not be reached right now.');
    expect(round2).toContain(JSON.stringify(ATTRIBUTION));
  });

  it('stops without "verified" or completion when a receipt does not verify', async () => {
    const { app, record } = generate();
    const run = await runAgent(app, record, {
      answers: [{ place: 'oslo', day: 'saturday' }, ROUND_2],
      tamper: 2,
    });
    expect(run.code).toBe(1);
    expect(run.stderr).toMatch(/^Stopped: The receipt does not bind the accepted typed input\./);
    expect(run.stdout).not.toContain('verified');
    expect(run.stdout).not.toContain('Your plan');
    const world = read(record);
    expect(world.completes).toBe(0);
    expect(world.status).toBe('responded');
  });

  it('says so on a weather outage, retries a bounded number of times and never invents weather', async () => {
    const { app, record } = generate();
    const run = await runAgent(app, record, {
      answers: [
        { place: 'london', day: 'saturday' },
        { choice: 'option_1', time: 'keep' },
      ],
      met: 'outage',
    });
    expect(run.stderr).toBe('');
    expect(run.code).toBe(0);
    expect(run.stdout).toMatch(
      /Your plan: A museum or gallery, Saturday .*, Morning, 09:00–12:00 in London \(No forecast\)\./,
    );
    expect(run.stdout).toContain('No forecast was available for this plan.');
    expect(run.stdout).not.toContain('°C');
    expect(run.stdout).not.toContain('MET Norway');
    const world = read(record);
    expect(world.weather).toHaveLength(3);
    expect(world.status).toBe('completed');
    const round2 = texts(world, 2).join();
    expect(round2).toContain('The weather service could not be reached.');
    expect(round2).not.toContain('°C');
    expect(round2).not.toContain('"record"');
  });

  it('refuses to start without SESS_API_KEY or a SESS_DEMO_CONTACT, before any request', async () => {
    for (const [env, message] of [
      [{ SESS_API_KEY: undefined }, 'Set SESS_API_KEY in your environment first.'],
      [{ SESS_DEMO_CONTACT: undefined }, 'Set SESS_DEMO_CONTACT to a project URL or team email.'],
      [{ SESS_DEMO_CONTACT: 'nobody' }, 'Set SESS_DEMO_CONTACT to a project URL or team email.'],
    ] as const) {
      const { app, record } = generate();
      const run = await runAgent(app, record, { answers: [], env });
      expect(run.code).toBe(1);
      expect(run.stderr).toContain(message);
      expect(run.stdout).toBe('');
      const world = read(record);
      expect([...world.sess, ...world.weather.map((w) => w.url)]).toEqual([]);
    }
  });
});
