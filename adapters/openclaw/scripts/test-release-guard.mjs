// Self-test for the release guard: node --test scripts/test-release-guard.mjs
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { checkCompatibilityStatus, checkRelease } from './release-guard.mjs';

const manifest = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
const compatibility = JSON.parse(readFileSync(new URL('../compatibility.json', import.meta.url), 'utf8'));

test('compatibility.json never calls the unpublished package version published', () => {
  // The committed record passes as it stands.
  checkCompatibilityStatus({ manifest, compatibility });
  const recorded = compatibility.publication.version;
  const candidate = { ...structuredClone(manifest), version: '9.9.9-rc.1' };
  const record = (status, publication = recorded) => ({
    ...structuredClone(compatibility),
    version: candidate.version,
    status,
    publication: { ...compatibility.publication, version: publication },
  });
  const prepared = `${candidate.version} prepared, unpublished; ${recorded} published on npm dist-tag next`;
  checkCompatibilityStatus({ manifest: candidate, compatibility: record(prepared) });
  for (const status of [
    'published (next)',
    `${recorded} published on npm dist-tag next`,
    `published (next); ${candidate.version} prepared, unpublished`,
    undefined,
  ])
    assert.throws(
      () => checkCompatibilityStatus({ manifest: candidate, compatibility: record(status) }),
      /compatibility status/,
    );
  assert.throws(
    () => checkCompatibilityStatus({ manifest: candidate, compatibility }),
    /compatibility version/,
  );
  // Once publication is recorded for this version, calling it prepared is refused.
  assert.throws(
    () =>
      checkCompatibilityStatus({ manifest: candidate, compatibility: record(prepared, candidate.version) }),
    /published version called prepared/,
  );
  checkCompatibilityStatus({
    manifest: candidate,
    compatibility: record('published on npm dist-tag next', candidate.version),
  });
});
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

test('accepts the exact tag on reviewed master with the registry SDK; rc maps to next', () => {
  assert.deepEqual(checkRelease(good()), {
    version: manifest.version,
    distTag: manifest.version.includes('-rc.') ? 'next' : 'latest',
  });
});

test('a release candidate goes to next', () => {
  const facts = good();
  facts.manifest.version = '0.1.0-rc.6';
  facts.ref = 'refs/tags/openclaw-v0.1.0-rc.6';
  assert.deepEqual(checkRelease(facts), { version: '0.1.0-rc.6', distTag: 'next' });
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

test('a stable version goes to latest (owner decision 2026-10-31: the same rule as the other three packages)', () => {
  const facts = good();
  facts.manifest.version = '0.1.0';
  facts.ref = 'refs/tags/openclaw-v0.1.0';
  assert.deepEqual(checkRelease(facts), { version: '0.1.0', distTag: 'latest' });
});

test('refuses other version shapes and a missing or other license', () => {
  for (const version of ['0.1', '0.1.0-beta.1', '0.1.0-rc', '01.0.0', '0.1.0+build']) {
    refuses((f) => {
      f.manifest.version = version;
      f.ref = `refs/tags/openclaw-v${version}`;
    }, 'version');
  }
  refuses((f) => delete f.manifest.license, 'license');
  refuses((f) => (f.manifest.license = 'MIT'), 'license');
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
  // A peer is a list of exact versions joined by " || "; any range or malformed member is refused.
  for (const peer of [
    '>=2026.10.3',
    '2026.10.3 || >=2026.10.7',
    '^2026.10.3',
    '2026.10.3 ||',
    '2026.10.3||2026.10.7',
    '*',
  ])
    refuses((f) => (f.manifest.peerDependencies.openclaw = peer), 'registry dependency specs');
  refuses((f) => (f.manifest.dependencies.extra = '1.0.0 || 2.0.0'), 'registry dependency specs');
});
