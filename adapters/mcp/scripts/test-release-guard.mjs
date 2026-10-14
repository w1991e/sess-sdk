// Self-test for the release guards: wrong tag, version, name, path, candidate SDK, history,
// dirty tree, changed bytes and bad readback must all refuse. Runs locally; publishes nothing.
//   node --test scripts/test-release-guard.mjs
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
  checkArtifact,
  checkGit,
  checkIdentity,
  checkPublished,
  checkRegistrySdk,
} from './release-guard.mjs';

const adapter = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const read = (name) => JSON.parse(readFileSync(join(adapter, name), 'utf8'));
const manifest = read('package.json');
const server = read('server.json');
const compatibility = read('compatibility.json');
const version = manifest.version;
const good = { manifest, server, ref: `refs/tags/mcp-v${version}`, repository: 'w1991e/sess-sdk' };
const refuses = (fn, pattern) => assert.throws(fn, (e) => e instanceof GuardError && pattern.test(e.message));
const clone = (value) => structuredClone(value);

test('identity: the exact tag for this package version passes; rc maps to next', () => {
  assert.deepEqual(checkIdentity(good), { version, distTag: version.includes('-rc.') ? 'next' : 'latest' });
});

test('identity: wrong tag, version, prefix or repository refuses', () => {
  refuses(() => checkIdentity({ ...good, ref: `refs/tags/v${version}` }), /does not equal/);
  refuses(() => checkIdentity({ ...good, ref: 'refs/tags/mcp-v9.9.9' }), /does not equal/);
  refuses(() => checkIdentity({ ...good, ref: `refs/heads/mcp-v${version}` }), /does not equal/);
  refuses(() => checkIdentity({ ...good, repository: 'someone/fork' }), /repository must be/);
  const bad = clone(manifest);
  bad.version = '0.1.0-beta.1';
  refuses(
    () => checkIdentity({ ...good, manifest: bad, ref: 'refs/tags/mcp-v0.1.0-beta.1' }),
    /unsupported version/,
  );
});

test('identity: wrong package name, path, visibility or registry metadata refuses', () => {
  for (const [mutate, pattern] of [
    [(m) => (m.name = '@sess.si/sdk'), /package name/],
    [(m) => (m.repository.directory = 'adapters/openclaw'), /repository.directory/],
    [(m) => (m.repository.url = 'git+https://github.com/someone/fork.git'), /repository.url/],
    [(m) => (m.private = true), /public/],
    [(m) => (m.mcpName = 'io.github.someone/other'), /mcpName/],
  ]) {
    const bad = clone(manifest);
    mutate(bad);
    refuses(() => checkIdentity({ ...good, manifest: bad }), pattern);
  }
  const badServer = clone(server);
  badServer.version = '0.0.1';
  refuses(() => checkIdentity({ ...good, server: badServer }), /server.json version/);
  const badPackage = clone(server);
  badPackage.packages[0].identifier = '@sess.si/other';
  refuses(() => checkIdentity({ ...good, server: badPackage }), /identifier\/version/);
});

test('registry SDK: candidate mode cannot be released; the genuine registry lock passes', () => {
  const lock = read('package-lock.json');
  const entry = lock.packages['node_modules/@sess.si/sdk'];
  if (entry.resolved.startsWith('file:')) {
    refuses(() => checkRegistrySdk({ manifest, lock, compatibility }), /candidate mode cannot be released/);
  }
  const registry = clone(lock);
  registry.packages['node_modules/@sess.si/sdk'] = {
    ...entry,
    resolved: `https://registry.npmjs.org/@sess.si/sdk/-/sdk-${compatibility.sessSdk.version}.tgz`,
  };
  checkRegistrySdk({ manifest, lock: registry, compatibility });
  const tampered = clone(registry);
  tampered.packages['node_modules/@sess.si/sdk'].integrity = 'sha512-AAAA';
  refuses(() => checkRegistrySdk({ manifest, lock: tampered, compatibility }), /pinned integrity/);
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
    const repo = mkdtempSync(join(tmpdir(), 'sess-mcp-release-git-'));
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

test('artifact: only the tested bytes from this commit, tested with the registry SDK, pass', () => {
  const bytes = Buffer.from('synthetic tarball bytes');
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  const sha = 'a'.repeat(40);
  const result = {
    name: '@sess.si/mcp',
    version,
    filename: `sess.si-mcp-${version}.tgz`,
    tarball: `.artifacts/sess.si-mcp-${version}.tgz`,
    node: 'v24.21.0',
    sdkMode: 'registry',
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
  refuses(() => checkArtifact({ ...args, result: { ...result, sdkMode: 'candidate' } }), /candidate SDK/);
  refuses(() => checkArtifact({ ...args, result: { ...result, node: 'v22.14.0' } }), /not tested on/);
  refuses(() => checkArtifact({ ...args, version: '9.9.9' }), /identity/);
  if (version.includes('-rc.')) refuses(() => checkArtifact({ ...args, distTag: 'latest' }), /dist-tag/);
});

test('readback: exact integrity, rc on next and never latest, dependencies and provenance', () => {
  const result = { integrity: 'sha512-tested' };
  const published = {
    name: manifest.name,
    version,
    repository: manifest.repository,
    dependencies: manifest.dependencies,
    dist: {
      integrity: 'sha512-tested',
      attestations: { url: 'https://example.invalid', provenance: { predicateType: 'x' } },
    },
  };
  const tags = { next: version };
  checkPublished({ manifest, result, published, tags, distTag: 'next' });
  refuses(
    () =>
      checkPublished({
        manifest,
        result,
        published: { ...published, dist: { ...published.dist, integrity: 'sha512-other' } },
        tags,
        distTag: 'next',
      }),
    /does not match/,
  );
  refuses(
    () =>
      checkPublished({
        manifest,
        result,
        published: { ...published, dist: { integrity: 'sha512-tested' } },
        tags,
        distTag: 'next',
      }),
    /does not match/,
  );
  refuses(
    () => checkPublished({ manifest, result, published, tags: { next: '0.0.0' }, distTag: 'next' }),
    /does not match/,
  );
  if (version.includes('-rc.'))
    refuses(
      () =>
        checkPublished({
          manifest,
          result,
          published,
          tags: { next: version, latest: version },
          distTag: 'next',
        }),
      /does not match/,
    );
  refuses(
    () =>
      checkPublished({
        manifest,
        result,
        published: { ...published, dependencies: {} },
        tags,
        distTag: 'next',
      }),
    /does not match/,
  );
});
