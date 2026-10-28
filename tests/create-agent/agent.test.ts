// The generated starter agent, offline: type-checked against the SDK's declarations, then run end to
// end against a fake SESS API (genuine signed receipts) and fake MET Norway / NWS services
// (create-agent/test/fake-world.mjs). `@sess.si/sdk` resolves to this repository's build, whose
// packed bytes `npm run check:pin` proves equal to the published pin.
import { beforeAll, describe, expect, it } from 'vitest';
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { join } from 'node:path';
import { API_KEY, CONTACT, ROOT, initialize, runAgent, scratch, type WorldRecord } from './helpers.js';

const version = (path: string): string => JSON.parse(readFileSync(join(ROOT, path), 'utf8')).version;
// The starter names itself with the initializer's version, first; the SDK appends its own tokens
// after it (this repository's build here, the published pin 0.1.0-rc.9 in clean-install-check.mjs).
const USER_AGENT = `sess-create-agent/${version('create-agent/package.json')}`;
const SDK_USER_AGENT = `sess-sdk/${version('package.json')} node/${process.versions.node}`;

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
/** Every value a person reads that is over Sess's limit (code points), as `path length>limit`. */
function overLimits(interaction: any): string[] {
  const over: string[] = [];
  const check = (path: string, value: unknown, limit: number) => {
    if (typeof value === 'string' && [...value].length > limit)
      over.push(`${path} ${[...value].length}>${limit}`);
  };
  check('title', interaction.title, 80);
  if ([...interaction.title].length >= 40)
    over.push(`title ${[...interaction.title].length} is not under 40`);
  check('description', interaction.description, 280);
  if (interaction.actions.length > 5) over.push('more than 5 actions');
  interaction.actions.forEach((a: any, i: number) => check(`actions/${i}/label`, a.label, 24));
  interaction.source.components.forEach((c: any, i: number) => {
    const at = `components/${i}`;
    if (c.type === 'heading') check(`${at}/text`, c.text, 60);
    if (c.type === 'text') check(`${at}/text`, c.text, 4000);
    if (c.type === 'record') {
      check(`${at}/label`, c.label, 60);
      for (const [key, value] of Object.entries(c.fields)) {
        check(`${at}/fields key`, key, 40);
        check(`${at}/fields/${key}`, value, 200);
      }
    }
    if (c.type === 'field') {
      check(`${at}/label`, c.label, 60);
      check(`${at}/description`, c.description, 160);
      for (const [key, label] of Object.entries(c.option_labels ?? {}))
        check(`${at}/option_labels/${key}`, label, 60);
    }
  });
  return over;
}

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
    // The link is its own token (still clickable), then two spaces and the hint (founder 2026-10-27 04:05Z item 4).
    const link = lines.findIndex((line) =>
      /^ {2}https:\/\/app\.sess\.si\/s\/\S+ {2}Cmd-click to open\.$/.test(line),
    );
    expect(link).toBeGreaterThan(0);
    expect(lines[link - 1]).toBe('Open this private link on your phone. Anyone with it can answer:');
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
    // Every Sess request names the starter first, then this repository's SDK build.
    expect(world.userAgents).toHaveLength(world.sess.length);
    expect(new Set(world.userAgents)).toEqual(new Set([`${USER_AGENT} ${SDK_USER_AGENT}`]));
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
      'A walk or hike outdoors — Morning, 09:00–12:00',
      'A picnic in the park — Afternoon, 12:00–17:00',
      'A bike ride — Evening, 17:00–21:00',
    ]);
    // Every value a person reads is within Sess's limits; titles under 40 characters.
    expect(world.interactions.flatMap(overLimits)).toEqual([]);

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
    expect(world.interactions.flatMap(overLimits)).toEqual([]);
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

  it('keeps waiting while the link is lapsed (an hour past its deadline, still extendable) and completes once the person asks for more time and answers', async () => {
    const { app, record } = generate();
    const run = await runAgent(app, record, {
      answers: [{ place: 'oslo', day: 'sunday' }, ROUND_2],
      lapsed: true,
    });
    expect(run.stderr).toBe('');
    expect(run.code).toBe(0);
    expect(run.stdout).toContain('· verified ✓');
    const world = read(record);
    expect(world).toMatchObject({ creates: 1, completes: 1, status: 'completed' });
    // Each answer came after a read that showed the link lapsed: the wait did not end there.
    expect(world.pollsBeforeAnswer).toEqual([1, 1]);
  });

  it('verifies receipts under sess-html-form-2, and under a later renderer identity on the signed list, with no template change (Decision 0009 Amendment 13)', async () => {
    for (const options of [
      { renderer: 'sess-html-form-2' },
      { renderer: 'sess-html-form-3', listed: 'sess-html-form-3' },
    ]) {
      const { app, record } = generate();
      const run = await runAgent(app, record, {
        answers: [{ place: 'oslo', day: 'sunday' }, ROUND_2],
        ...options,
      });
      expect(run.stderr, options.renderer).toBe('');
      expect(run.code, options.renderer).toBe(0);
      expect(run.stdout).toContain('· verified ✓');
      const fetched = read(record).sess.filter((r) =>
        r.endsWith('/.well-known/sess-renderer-identities.json'),
      );
      // The list is fetched only for an identity the SDK does not bundle.
      expect(fetched.length > 0, options.renderer).toBe(options.renderer === 'sess-html-form-3');
    }
    // An identity on no signed list is refused: no "verified", no completion.
    const { app, record } = generate();
    const run = await runAgent(app, record, {
      answers: [{ place: 'oslo', day: 'sunday' }, ROUND_2],
      renderer: 'sess-html-form-3',
    });
    expect(run.code).toBe(1);
    expect(run.stdout).not.toContain('verified ✓');
    expect(read(record)).toMatchObject({ completes: 0 });
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

  it('sends User-Agent sess-create-agent/<initializer version> to a real HTTP server', async () => {
    const { app } = generate();
    const seen: { method: string; path: string; userAgent: string | undefined }[] = [];
    const server = createServer((request, response) => {
      seen.push({
        method: String(request.method),
        path: String(request.url),
        userAgent: request.headers['user-agent'],
      });
      request.resume();
      request.on('end', () => {
        response.writeHead(401, { 'content-type': 'application/json' });
        response.end('{"error":{"code":"UNAUTHORIZED","request_id":"req_ua","message":"x"}}');
      });
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    try {
      const { port } = server.address() as AddressInfo;
      // Test-only preload: native fetch, with the Sess API origin pointed at the local server.
      const preload = join(app, '..', 'to-local.mjs');
      writeFileSync(
        preload,
        `const real = globalThis.fetch;
globalThis.fetch = (input, init) => {
  const url = new URL(typeof input === 'string' || input instanceof URL ? input : input.url);
  if (url.origin !== 'https://api.sess.si') throw new TypeError('to-local: network access refused');
  return real('http://127.0.0.1:${port}' + url.pathname + url.search, init);
};
`,
      );
      // Asynchronous, so that this process's server can answer while the agent runs.
      const child = spawn(process.execPath, ['--import', preload, 'agent.mjs'], {
        cwd: app,
        env: { PATH: process.env.PATH ?? '', SESS_API_KEY: API_KEY, SESS_DEMO_CONTACT: CONTACT },
        stdio: ['ignore', 'ignore', 'pipe'],
      });
      let stderr = '';
      child.stderr.setEncoding('utf8').on('data', (chunk: string) => (stderr += chunk));
      const timer = setTimeout(() => child.kill('SIGKILL'), 45_000);
      const status = await new Promise<number | null>((done) => child.on('exit', done));
      clearTimeout(timer);
      expect(status).toBe(1);
      expect(stderr).toContain('Stopped:');
      expect(seen).toEqual([
        { method: 'POST', path: '/v1/sessions', userAgent: `${USER_AGENT} ${SDK_USER_AGENT}` },
      ]);
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });
});
