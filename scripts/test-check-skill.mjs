import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { INDEX_URL, SKILL_NAME, SKILL_PATH, SKILL_URL, checkSkill, digestOf } from './check-skill.mjs';

const local = Buffer.from('---\nname: ask-a-person-with-sess\n---\n\n# Synthetic skill\n');
const other = Buffer.from('---\nname: ask-a-person-with-sess\n---\n\n# Another skill\n');

const index = (entry) =>
  JSON.stringify({
    $schema: 'https://schemas.agentskills.io/discovery/0.2.0/schema.json',
    skills: entry ? [entry] : [],
  });
const entry = (bytes, over = {}) => ({
  name: SKILL_NAME,
  type: 'skill-md',
  description: 'synthetic',
  url: SKILL_URL,
  digest: digestOf(bytes),
  ...over,
});

/** A fake fetch answering each URL with [status, body]; anything else is a test error. */
function fake(routes) {
  return async (url, init) => {
    assert.equal(init.redirect, 'manual');
    const route = routes[url];
    if (!route) throw new Error(`unexpected GET ${url}`);
    if (route instanceof Error) throw route;
    const [status, body] = route;
    return new Response(status === 204 || status === 304 ? null : body, { status });
  };
}

const run = (routes) => checkSkill({ local, fetch: fake(routes) });
const notFound = [404, '<!doctype html><title>Not found</title>'];

test('the copy in the repository is the generated file', async () => {
  const bytes = await readFile(SKILL_PATH);
  assert.match(bytes.toString('utf8'), /^---\nname: ask-a-person-with-sess\ndescription: "/);
  assert.equal(digestOf(bytes), 'sha256:bd46748c99fa8caa365ceddd8a4ff676733ad2a95b6cbca3b2c445a94104bfc6');
});

test('before production publishes the skill, both 404s skip with a message', async () => {
  const r = await run({ [INDEX_URL]: notFound, [SKILL_URL]: notFound });
  assert.equal(r.outcome, 'skip');
  assert.match(r.lines[0], /does not serve ask-a-person-with-sess yet/);
  assert.match(r.lines[0], /index answered 404/);
});

test('an index without the skill and a 404 file skip', async () => {
  const r = await run({ [INDEX_URL]: [200, index()], [SKILL_URL]: notFound });
  assert.equal(r.outcome, 'skip');
  assert.match(r.lines[0], /does not list it/);
});

test('the same bytes, served and listed, match', async () => {
  const r = await run({ [INDEX_URL]: [200, index(entry(local))], [SKILL_URL]: [200, local] });
  assert.equal(r.outcome, 'match');
});

test('served bytes that differ fail, listed or not', async () => {
  for (const idx of [notFound, [200, index()], [200, index(entry(other))]]) {
    const r = await run({ [INDEX_URL]: idx, [SKILL_URL]: [200, other] });
    assert.equal(r.outcome, 'fail');
  }
});

test('an index digest that differs fails, even when the file matches', async () => {
  const r = await run({ [INDEX_URL]: [200, index(entry(other))], [SKILL_URL]: [200, local] });
  assert.equal(r.outcome, 'fail');
  assert.match(r.lines.join('\n'), /digest is sha256:/);
});

test('an index that lists the skill with no file fails', async () => {
  const r = await run({ [INDEX_URL]: [200, index(entry(local))], [SKILL_URL]: notFound });
  assert.equal(r.outcome, 'fail');
});

test('a wrong url, type or digest shape in the index fails', async () => {
  for (const over of [{ url: 'https://example.test/SKILL.md' }, { type: 'archive' }, { digest: 'md5:00' }]) {
    const r = await run({ [INDEX_URL]: [200, index(entry(local, over))], [SKILL_URL]: [200, local] });
    assert.equal(r.outcome, 'fail', JSON.stringify(over));
  }
});

test('an unreadable index or another status fails, never skips', async () => {
  for (const routes of [
    { [INDEX_URL]: [200, 'not json'], [SKILL_URL]: notFound },
    { [INDEX_URL]: [200, '{}'], [SKILL_URL]: notFound },
    { [INDEX_URL]: [500, 'oops'], [SKILL_URL]: notFound },
    { [INDEX_URL]: notFound, [SKILL_URL]: [503, 'later'] },
    { [INDEX_URL]: [301, ''], [SKILL_URL]: notFound },
    { [INDEX_URL]: notFound, [SKILL_URL]: [302, ''] },
  ]) {
    const r = await run(routes);
    assert.equal(r.outcome, 'fail', JSON.stringify(Object.values(routes).map((x) => x[0])));
  }
});

test('a network error is thrown, not passed', async () => {
  await assert.rejects(run({ [INDEX_URL]: new TypeError('fetch failed'), [SKILL_URL]: notFound }));
});
