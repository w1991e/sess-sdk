// Refusal paths of scripts/rc3-candidate.mjs leave no temporary directory and no tarball behind.
// The digest case performs a real git archive + npm ci + build + pack (network for npm ci).
//   node --test scripts/test-rc3-candidate.mjs
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { RC3, Refusal, reproduce } from './rc3-candidate.mjs';

function run(expected, pattern) {
  const base = mkdtempSync(join(tmpdir(), 'sess-rc3-refusal-'));
  const tmpRoot = mkdtempSync(join(base, 'tmp-'));
  const out = join(base, 'out');
  try {
    assert.throws(
      () => reproduce({ out, expected, tmpRoot }),
      (e) => e instanceof Refusal && pattern.test(e.message),
    );
    assert.deepEqual(readdirSync(tmpRoot), [], 'temporary work directory was removed');
    assert.equal(existsSync(join(out, expected.filename)), false, 'no tarball was accepted');
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
}

test('wrong reviewed tree: refused before any temporary directory exists', () => {
  run({ ...RC3, tree: '0'.repeat(40) }, /reviewed tree/);
});

test('source identity mismatch: refused after archive extraction; work directory removed', () => {
  run({ ...RC3, version: '9.9.9', filename: 'sess.si-sdk-9.9.9.tgz' }, /pinned source is/);
});

test('digest mismatch after a real build and pack: refused; work directory removed', () => {
  run({ ...RC3, sha256: '0'.repeat(64) }, /differ from the approved candidate/);
});
