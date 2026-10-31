import assert from 'node:assert/strict';
import { test } from 'node:test';
import { PACKAGES, latestProblems } from './check-latest-release.mjs';

const ok = {
  name: '@sess.si/openclaw',
  expected: '0.1.0',
  tags: { latest: '0.1.0', next: '0.1.0-rc.5' },
  license: 'Apache-2.0',
  files: ['LICENSE', 'package.json'],
};

test('all four packages are checked', () => {
  assert.deepEqual(PACKAGES, ['@sess.si/sdk', '@sess.si/mcp', '@sess.si/openclaw', '@sess.si/create-agent']);
});

test('a stable latest with the license field and file passes', () => {
  assert.deepEqual(latestProblems(ok), []);
});

test('the 0.0.0-stage placeholder or a candidate on latest fails', () => {
  assert.equal(latestProblems({ ...ok, tags: { latest: '0.0.0-stage' } }).length, 1);
  assert.equal(latestProblems({ ...ok, tags: {} }).length, 1);
  assert.equal(latestProblems({ ...ok, expected: '0.1.0-rc.6', tags: { latest: '0.1.0-rc.6' } }).length, 1);
});

test('a missing or other license, or no LICENSE file, fails', () => {
  assert.equal(latestProblems({ ...ok, license: undefined }).length, 1);
  assert.equal(latestProblems({ ...ok, license: 'MIT' }).length, 1);
  assert.equal(latestProblems({ ...ok, files: ['package.json'] }).length, 1);
});
