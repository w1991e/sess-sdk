// Self-test for the release guard: node --test scripts/test-release-guard.mjs
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { checkRelease } from './release-guard.mjs';

const manifest = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
const good = () => ({
  manifest: structuredClone(manifest),
  ref: `refs/tags/openclaw-v${manifest.version}`,
  repository: 'w1991e/sess-sdk',
  onMaster: true,
  cleanTree: true,
  lockedSdkIntegrity: 'sha512-same',
  registrySdkIntegrity: 'sha512-same',
});
const refuses = (mutate, reason) => {
  const facts = good();
  mutate(facts);
  assert.throws(() => checkRelease(facts), new RegExp(reason));
};

test('accepts the exact prerelease tag on reviewed master with the registry SDK', () => {
  assert.deepEqual(checkRelease(good()), { version: manifest.version, distTag: 'next' });
});

test('refuses tags for other packages or versions', () => {
  refuses((f) => (f.ref = `refs/tags/v${manifest.version}`), 'tag');
  refuses((f) => (f.ref = `refs/tags/mcp-v${manifest.version}`), 'tag');
  refuses((f) => (f.ref = 'refs/tags/openclaw-v9.9.9-rc.1'), 'tag');
  refuses((f) => (f.ref = `refs/heads/openclaw-v${manifest.version}`), 'tag');
});

test('refuses wrong identity, path, repository or visibility', () => {
  refuses((f) => (f.manifest.name = '@sess.si/sdk'), 'package name');
  refuses((f) => (f.manifest.repository.directory = 'adapters/mcp'), 'package directory');
  refuses((f) => (f.repository = 'someone/fork'), 'repository');
  refuses((f) => (f.manifest.publishConfig.access = 'restricted'), 'visibility');
  refuses((f) => (f.manifest.private = true), 'visibility');
});

test('refuses stable versions (latest promotion is an owner decision)', () => {
  refuses((f) => {
    f.manifest.version = '0.1.0';
    f.ref = 'refs/tags/openclaw-v0.1.0';
  }, 'version');
});

test('refuses unreviewed history and dirty trees', () => {
  refuses((f) => (f.onMaster = false), 'master reachability');
  refuses((f) => (f.cleanTree = false), 'clean tree');
});

test('refuses candidate mode and non-registry dependency specs', () => {
  refuses((f) => (f.registrySdkIntegrity = undefined), 'registry SDK integrity'); // unpublished SDK
  refuses((f) => (f.registrySdkIntegrity = 'sha512-other'), 'registry SDK integrity');
  refuses((f) => (f.manifest.dependencies['@sess.si/sdk'] = 'file:../../sdk.tgz'), 'exact SDK dependency');
  refuses(
    (f) => (f.manifest.dependencies['@sess.si/sdk'] = `^${f.manifest.dependencies['@sess.si/sdk']}`),
    'exact SDK dependency',
  );
  refuses(
    (f) => (f.manifest.peerDependencies.openclaw = 'git+https://example.invalid/x.git'),
    'registry dependency specs',
  );
});
