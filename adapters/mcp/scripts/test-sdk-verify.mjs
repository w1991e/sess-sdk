// Self-test for `sdk-candidate.mjs verify --require-registry`: the installed SDK must be proven by
// npm's install record (node_modules/.package-lock.json). A missing hidden lock, missing packages
// object or missing SDK entry, a candidate record and a wrong-integrity record must all refuse
// before any registry re-download and without printing a successful verification; the real
// installed tree passes. Runs locally; publishes nothing.
//   node --test scripts/test-sdk-verify.mjs
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const adapter = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const pinned = JSON.parse(readFileSync(join(adapter, 'compatibility.json'), 'utf8')).sessSdk;
const KEY = 'node_modules/@sess.si/sdk';
const REGISTRY = `https://registry.npmjs.org/${pinned.name}/-/sdk-${pinned.version}.tgz`;
const RECORD_REFUSAL = /was not installed from the registry tarball with the pinned integrity/;

function verify(cwd) {
  const env = { ...process.env };
  delete env.npm_execpath; // the disposable copy must not reach npm before the record check
  return spawnSync(
    process.execPath,
    [join(cwd, 'scripts', 'sdk-candidate.mjs'), 'verify', '--require-registry'],
    {
      cwd,
      encoding: 'utf8',
      env: { ...env, npm_config_registry: 'http://127.0.0.1:9/' },
    },
  );
}

/** A disposable adapter with the committed manifest/lock/compatibility and an installed SDK identity. */
function disposable(hiddenLock) {
  const dir = mkdtempSync(join(tmpdir(), 'sess-mcp-sdk-verify-'));
  mkdirSync(join(dir, 'scripts'));
  copyFileSync(join(adapter, 'scripts', 'sdk-candidate.mjs'), join(dir, 'scripts', 'sdk-candidate.mjs'));
  for (const name of ['package.json', 'package-lock.json', 'compatibility.json'])
    copyFileSync(join(adapter, name), join(dir, name));
  mkdirSync(join(dir, KEY), { recursive: true });
  writeFileSync(
    join(dir, KEY, 'package.json'),
    JSON.stringify({ name: pinned.name, version: pinned.version }),
  );
  if (hiddenLock !== undefined)
    writeFileSync(join(dir, 'node_modules', '.package-lock.json'), JSON.stringify(hiddenLock));
  return dir;
}

const registryRecord = { version: pinned.version, resolved: REGISTRY, integrity: pinned.integrity };
const refusing = {
  'missing hidden install lock': undefined,
  'hidden lock without packages': { lockfileVersion: 3 },
  'hidden lock without the SDK entry': { lockfileVersion: 3, packages: {} },
  'candidate-mode install record': {
    lockfileVersion: 3,
    packages: { [KEY]: { ...registryRecord, resolved: `file:${pinned.candidatePath}` } },
  },
  'wrong-integrity install record': {
    lockfileVersion: 3,
    packages: { [KEY]: { ...registryRecord, integrity: 'sha512-AAAA' } },
  },
};

for (const [name, hiddenLock] of Object.entries(refusing)) {
  test(`verify --require-registry refuses: ${name}`, () => {
    const dir = disposable(hiddenLock);
    try {
      const result = verify(dir);
      assert.equal(result.status, 1, result.stdout + result.stderr);
      assert.match(result.stderr, RECORD_REFUSAL);
      assert.doesNotMatch(result.stdout, /verified/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
}

test(
  'verify --require-registry accepts the real npm-installed registry tree',
  { skip: !existsSync(join(adapter, KEY)) && 'SDK not installed; run npm run setup' },
  () => {
    const result = spawnSync(
      process.execPath,
      [join(adapter, 'scripts', 'sdk-candidate.mjs'), 'verify', '--require-registry'],
      {
        cwd: adapter,
        encoding: 'utf8',
      },
    );
    assert.equal(result.status, 0, result.stdout + result.stderr);
    assert.match(result.stdout, /verified REGISTRY/);
  },
);
