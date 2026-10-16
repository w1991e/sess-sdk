// Self-test for the create-agent release guards: wrong tag, version, name, path, scripts or
// dependencies, an unpinned or unpublished template SDK, history, dirty tree, file-list drift,
// changed bytes and bad readback must all refuse. Runs locally; publishes nothing. Not packed.
//   node --test create-agent/scripts/test-release-guard.mjs
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  GuardError,
  PACKED_FILES,
  checkArtifact,
  checkArtifactPath,
  checkGit,
  checkIdentity,
  checkPackEntry,
  checkPublished,
  checkTemplateSdk,
} from './release-guard.mjs';

const pkg = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const root = resolve(pkg, '..');
const read = (path) => JSON.parse(readFileSync(path, 'utf8'));
const manifest = read(join(pkg, 'package.json'));
const template = read(join(pkg, 'template', 'package.json'));
const pin = read(join(root, 'release', 'sdk-candidate.json'));
const version = manifest.version;
const good = { manifest, ref: `refs/tags/create-agent-v${version}`, repository: 'w1991e/sess-sdk' };
const refuses = (fn, pattern) => assert.throws(fn, (e) => e instanceof GuardError && pattern.test(e.message));
const clone = (value) => structuredClone(value);

test('identity: the exact tag for this package version passes; rc maps to next', () => {
  assert.deepEqual(checkIdentity(good), { version, distTag: version.includes('-rc.') ? 'next' : 'latest' });
});

test('identity: wrong tag, version, prefix or repository refuses', () => {
  refuses(() => checkIdentity({ ...good, ref: `refs/tags/v${version}` }), /does not equal/);
  refuses(() => checkIdentity({ ...good, ref: `refs/tags/mcp-v${version}` }), /does not equal/);
  refuses(() => checkIdentity({ ...good, ref: 'refs/tags/create-agent-v9.9.9' }), /does not equal/);
  refuses(() => checkIdentity({ ...good, ref: `refs/heads/create-agent-v${version}` }), /does not equal/);
  refuses(() => checkIdentity({ ...good, repository: 'someone/fork' }), /repository must be/);
  const bad = clone(manifest);
  bad.version = '0.1.0-beta.1';
  refuses(
    () => checkIdentity({ ...good, manifest: bad, ref: 'refs/tags/create-agent-v0.1.0-beta.1' }),
    /unsupported version/,
  );
});

test('identity: wrong name, path, visibility, scripts or dependencies refuse', () => {
  for (const [mutate, pattern] of [
    [(m) => (m.name = '@sess.si/sdk'), /package name/],
    [(m) => (m.repository.directory = 'adapters/mcp'), /repository.directory/],
    [(m) => (m.repository.url = 'git+https://github.com/someone/fork.git'), /repository.url/],
    [(m) => (m.private = true), /public/],
    [(m) => delete m.publishConfig, /public/],
    [(m) => (m.scripts = { postinstall: 'node x.js' }), /no scripts/],
    [(m) => (m.dependencies = { 'left-pad': '1.3.0' }), /no dependencies/],
    [(m) => (m.optionalDependencies = { x: '1.0.0' }), /no optionalDependencies/],
  ]) {
    const bad = clone(manifest);
    mutate(bad);
    refuses(() => checkIdentity({ ...good, manifest: bad }), pattern);
  }
});

test('template SDK: exact published pin passes; ranged, extra, unpinned or unpublished refuses', () => {
  checkTemplateSdk({ template, pin, publishedIntegrity: pin.integrity });
  refuses(() => checkTemplateSdk({ template, pin, publishedIntegrity: '' }), /not published/);
  refuses(() => checkTemplateSdk({ template, pin, publishedIntegrity: 'sha512-AAAA' }), /not published/);
  for (const deps of [
    { '@sess.si/sdk': `^${pin.version}` },
    { '@sess.si/sdk': 'next' },
    { '@sess.si/sdk': pin.version, 'left-pad': '1.3.0' },
    {},
  ])
    refuses(
      () =>
        checkTemplateSdk({
          template: { ...template, dependencies: deps },
          pin,
          publishedIntegrity: pin.integrity,
        }),
      /depend exactly/,
    );
  refuses(
    () =>
      checkTemplateSdk({
        template: { ...template, devDependencies: { vitest: '1.0.0' } },
        pin,
        publishedIntegrity: pin.integrity,
      }),
    /devDependencies/,
  );
  refuses(
    () =>
      checkTemplateSdk({ template, pin: { ...pin, name: '@sess/sdk' }, publishedIntegrity: pin.integrity }),
    /pin drift/,
  );
});

test('pack entry: exact identity, file name and the allowlisted 11 files only', () => {
  const entry = {
    name: manifest.name,
    version,
    filename: `sess.si-create-agent-${version}.tgz`,
    files: PACKED_FILES.map((path) => ({ path })),
  };
  checkPackEntry({ entry, version });
  refuses(() => checkPackEntry({ entry: { ...entry, name: '@sess.si/sdk' }, version }), /identity/);
  refuses(() => checkPackEntry({ entry: { ...entry, filename: 'x.tgz' }, version }), /filename/);
  refuses(
    () =>
      checkPackEntry({
        entry: { ...entry, files: [...entry.files, { path: 'test/fake-world.mjs' }] },
        version,
      }),
    /file list/,
  );
  refuses(() => checkPackEntry({ entry: { ...entry, files: entry.files.slice(1) }, version }), /file list/);
});

// GitHub runners and the release workflow have git; minimal containers may not. Skip visibly there.
const hasGit = (() => {
  try {
    execFileSync('git', ['--version'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
})();

test(
  'git: a commit off master history or a dirty tree refuses',
  { skip: !hasGit && 'git is not installed' },
  () => {
    const repo = mkdtempSync(join(tmpdir(), 'sess-create-agent-release-git-'));
    const git = (...args) =>
      execFileSync('git', args, { cwd: repo, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
    try {
      git('init', '-q', '-b', 'master');
      git('config', 'user.email', 'test@example.invalid');
      git('config', 'user.name', 'Release guard test');
      writeFileSync(join(repo, 'a.txt'), 'a');
      git('add', 'a.txt');
      git('commit', '-q', '-m', 'a');
      git('update-ref', 'refs/remotes/origin/master', 'HEAD');
      assert.match(checkGit({ cwd: repo }), /^[0-9a-f]{40}$/);
      writeFileSync(join(repo, 'untracked.txt'), 'x');
      refuses(() => checkGit({ cwd: repo }), /not clean/);
      rmSync(join(repo, 'untracked.txt'));
      git('checkout', '-q', '-b', 'side');
      writeFileSync(join(repo, 'b.txt'), 'b');
      git('add', 'b.txt');
      git('commit', '-q', '-m', 'b');
      refuses(() => checkGit({ cwd: repo }), /not reachable/);
    } finally {
      rmSync(repo, { recursive: true, force: true });
    }
  },
);

test('artifact: only the tested bytes and file list from this commit pass', () => {
  const bytes = Buffer.from('synthetic tarball bytes');
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  const sha = 'a'.repeat(40);
  const result = {
    name: '@sess.si/create-agent',
    version,
    filename: `sess.si-create-agent-${version}.tgz`,
    tarball: `.artifacts/sess.si-create-agent-${version}.tgz`,
    files: PACKED_FILES,
    node: 'v24.21.0',
    sourceCommit: sha,
    sourceTreeDirty: false,
    sha256,
    integrity: `sha512-${createHash('sha512').update(bytes).digest('base64')}`,
  };
  const args = { result, bytes, expectedSha256: sha256, version, distTag: 'next', sha };
  if (version.includes('-rc.')) assert.equal(checkArtifact(args).sha256, sha256);
  refuses(() => checkArtifact({ ...args, bytes: Buffer.from('changed') }), /bytes changed/);
  refuses(() => checkArtifact({ ...args, expectedSha256: '0'.repeat(64) }), /bytes changed/);
  refuses(() => checkArtifact({ ...args, sha: 'b'.repeat(40) }), /source commit/);
  refuses(() => checkArtifact({ ...args, result: { ...result, sourceTreeDirty: true } }), /source commit/);
  refuses(() => checkArtifact({ ...args, result: { ...result, node: 'v22.14.0' } }), /not tested on/);
  refuses(() => checkArtifact({ ...args, result: { ...result, files: PACKED_FILES.slice(1) } }), /file list/);
  refuses(() => checkArtifact({ ...args, version: '9.9.9' }), /identity/);
  for (const [filename, tarball] of [
    ['../../etc/passwd.tgz', '.artifacts/../../etc/passwd.tgz'],
    [`sess.si-create-agent-${version}.tgz`, `.artifacts/../sess.si-create-agent-${version}.tgz`],
    [`sess.si-create-agent-${version}.tgz`, `/tmp/sess.si-create-agent-${version}.tgz`],
    ['sess.si-mcp-0.1.0-rc.1.tgz', '.artifacts/sess.si-mcp-0.1.0-rc.1.tgz'],
    [`sess.si-create-agent-${version}.tar`, `.artifacts/sess.si-create-agent-${version}.tar`],
    [undefined, undefined],
  ]) {
    const bad = { ...result, filename, tarball };
    refuses(() => checkArtifactPath({ result: bad, version }), /filename\/path/);
    refuses(() => checkArtifact({ ...args, result: bad }), /filename\/path/);
  }
  assert.equal(checkArtifactPath({ result, version }), `.artifacts/sess.si-create-agent-${version}.tgz`);
  if (version.includes('-rc.')) refuses(() => checkArtifact({ ...args, distTag: 'latest' }), /dist-tag/);
});

test('readback: exact integrity, rc on next and never latest, no dependencies and provenance', () => {
  const result = { integrity: 'sha512-tested' };
  const published = {
    name: manifest.name,
    version,
    repository: manifest.repository,
    dist: {
      integrity: 'sha512-tested',
      attestations: { url: 'https://example.invalid', provenance: { predicateType: 'x' } },
    },
  };
  const tags = { next: version };
  checkPublished({ manifest, result, published, tags, distTag: 'next' });
  const bad = (overrides, t = tags) =>
    refuses(
      () =>
        checkPublished({
          manifest,
          result,
          published: { ...published, ...overrides },
          tags: t,
          distTag: 'next',
        }),
      /does not match/,
    );
  bad({ dist: { ...published.dist, integrity: 'sha512-other' } });
  bad({ dist: { integrity: 'sha512-tested' } });
  bad({}, { next: '0.0.0' });
  if (version.includes('-rc.')) bad({}, { next: version, latest: version });
  bad({ dependencies: { 'left-pad': '1.3.0' } });
  bad({ repository: { ...manifest.repository, directory: 'adapters/mcp' } });
  bad({ repository: { ...manifest.repository, url: 'git+https://github.com/someone/fork.git' } });
});
