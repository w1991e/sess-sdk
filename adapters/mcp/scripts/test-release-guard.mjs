// Self-test for the release guards: wrong tag, version, name, path, candidate SDK, a package
// version on an SDK other than the one it ships on, history, dirty tree, changed bytes and bad
// readback must all refuse. Runs locally on fixtures; touches no registry and publishes nothing.
//   node --test scripts/test-release-guard.mjs
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  GuardError,
  checkArtifact,
  checkArtifactPath,
  checkCompatibilityStatus,
  checkGit,
  checkIdentity,
  checkPrepare,
  checkPublished,
  checkRegistrySdk,
  checkSdkRequirement,
  releaseStatus,
} from './release-guard.mjs';

const adapter = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const read = (name) => JSON.parse(readFileSync(join(adapter, name), 'utf8'));
const clone = (value) => structuredClone(value);
const SDK_KEY = 'node_modules/@sess.si/sdk';
const sdkTarball = (v) => `https://registry.npmjs.org/@sess.si/sdk/-/sdk-${v}.tgz`;
const syntheticIntegrity = (v) =>
  `sha512-${createHash('sha512').update(`synthetic @sess.si/sdk ${v}`).digest('base64')}`;

// The committed records, exactly as they stand. While the package version is prepared ahead of its
// SDK's registry transition they disagree with the SDK it ships on, and the guard holds them.
const committed = {
  manifest: read('package.json'),
  lock: read('package-lock.json'),
  compatibility: read('compatibility.json'),
  server: read('server.json'),
};

/**
 * Records in the consistent state for `version` on `sdk`: the manifest dependency, the lock (the
 * genuine registry tarball) and compatibility.json's sessSdk all resolve `sdk`, and the release
 * entry for `version` names it as sessSdkVersion. A synthetic integrity stands in for an SDK whose
 * pinned record is not the committed one; nothing reads the registry.
 */
function consistentRecords(version, sdk) {
  const manifest = clone(committed.manifest);
  manifest.version = version;
  manifest.dependencies['@sess.si/sdk'] = sdk;
  const compatibility = clone(committed.compatibility);
  compatibility.package.version = version;
  const integrity =
    compatibility.sessSdk.version === sdk ? compatibility.sessSdk.integrity : syntheticIntegrity(sdk);
  compatibility.sessSdk = { ...compatibility.sessSdk, version: sdk, integrity, source: sdkTarball(sdk) };
  if (compatibility.release.published?.version !== version) {
    compatibility.release.prepared = { ...compatibility.release.prepared, version, sessSdkVersion: sdk };
    const prepared = `At this artifact's preparation (2026-11-22), ${version} was prepared, not yet published`;
    compatibility.status = prepared;
    compatibility.release.status = prepared;
  } else compatibility.release.published.sessSdkVersion = sdk;
  const lock = clone(committed.lock);
  lock.packages[''].version = version;
  lock.packages[SDK_KEY] = { ...lock.packages[SDK_KEY], version: sdk, resolved: sdkTarball(sdk), integrity };
  return { manifest, lock, compatibility };
}

/** The SDK the committed package version ships on, per its compatibility.json release entry. */
const committedEntry = [
  committed.compatibility.release.prepared,
  committed.compatibility.release.published,
].find((entry) => entry?.version === committed.manifest.version);
assert.ok(committedEntry?.sessSdkVersion, 'compatibility.json names the SDK the package version ships on');
// The guard tests below run on the consistent state of the committed package version.
const fixture = consistentRecords(committed.manifest.version, committedEntry.sessSdkVersion);
const manifest = fixture.manifest;
// The committed entry lists the npm package under the package's mcpName, as 0.1.1 does. The identity
// tests also exercise the remote-only form, under a name the guard must not cross-check.
const remoteOnly = { ...read('server.json'), name: 'si.sess/remote-only' };
delete remoteOnly.packages;
const server = {
  ...remoteOnly,
  name: manifest.mcpName,
  packages: [
    {
      registryType: 'npm',
      registryBaseUrl: 'https://registry.npmjs.org',
      identifier: manifest.name,
      version: manifest.version,
      transport: { type: 'stdio' },
    },
  ],
};
const compatibility = fixture.compatibility;
const version = manifest.version;
const releaseTag = version.includes('-rc.') ? 'next' : 'latest';
const good = {
  manifest,
  server,
  ref: `refs/tags/mcp-v${version}`,
  repository: 'w1991e/sess-sdk',
  compatibility,
};
const refuses = (fn, pattern) => assert.throws(fn, (e) => e instanceof GuardError && pattern.test(e.message));
// GitHub runners and the release workflow have git; minimal containers may not. Skip visibly there.
const hasGit = (() => {
  try {
    execFileSync('git', ['--version'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
})();
/** compatibility.json for another package version, prepared on the same SDK. */
const compatibilityFor = (other) => consistentRecords(other, compatibility.sessSdk.version).compatibility;
/** server.json listing the npm package at `other`. */
const serverFor = (other) => {
  const s = clone(server);
  s.version = other;
  s.packages[0].version = other;
  return s;
};

test('sdk requirement: mcp 0.6.0 is refused on sdk 0.5.0 in the manifest, the lock or compatibility (ASTRA-SDK-81-1)', () => {
  const ref = 'refs/tags/mcp-v0.6.0';
  const repository = 'w1991e/sess-sdk';
  const ready = consistentRecords('0.6.0', '0.6.0');
  assert.equal(ready.compatibility.release.prepared.sessSdkVersion, '0.6.0');
  // The consistent future state: 0.6.0 on the published SDK 0.6.0 in every record passes.
  const all = (records) => ({ ...records, server: serverFor('0.6.0'), ref, repository });
  assert.deepEqual(checkPrepare(all(ready)), { version: '0.6.0', distTag: 'latest' });
  assert.equal(checkSdkRequirement(ready), '0.6.0');
  assert.deepEqual(releaseStatus({ ...ready, sdkMode: 'registry' }), { releasable: true });
  const held =
    /@sess\.si\/mcp@0\.6\.0 ships only on @sess\.si\/sdk 0\.6\.0, but the .* is 0\.5\.0; it is held/;
  const onOld = (records, which) => {
    const r = clone(records);
    if (which.includes('manifest')) r.manifest.dependencies['@sess.si/sdk'] = '0.5.0';
    if (which.includes('lock')) {
      r.lock.packages[SDK_KEY].version = '0.5.0';
      r.lock.packages[SDK_KEY].resolved = sdkTarball('0.5.0');
    }
    if (which.includes('compatibility')) r.compatibility.sessSdk.version = '0.5.0';
    return r;
  };
  // ASTRA's reproduction: every record still on 0.5.0. All three checks and prepare refuse, and
  // the packed artifact's record says it is not releasable.
  const astra = onOld(ready, ['manifest', 'lock', 'compatibility']);
  refuses(
    () =>
      checkIdentity({
        manifest: astra.manifest,
        server: serverFor('0.6.0'),
        ref,
        repository,
        compatibility: astra.compatibility,
      }),
    held,
  );
  refuses(() => checkCompatibilityStatus(astra), held);
  refuses(() => checkRegistrySdk(astra), held);
  refuses(() => checkPrepare(all(astra)), held);
  const status = releaseStatus({ ...astra, sdkMode: 'registry' });
  assert.equal(status.releasable, false);
  assert.match(status.releaseHold, held);
  // Any one record on 0.5.0 is refused by prepare and every check that reads it.
  for (const which of ['manifest', 'compatibility']) {
    const r = onOld(ready, [which]);
    refuses(
      () =>
        checkIdentity({
          manifest: r.manifest,
          server: serverFor('0.6.0'),
          ref,
          repository,
          compatibility: r.compatibility,
        }),
      held,
    );
    refuses(() => checkCompatibilityStatus(r), held);
    refuses(() => checkRegistrySdk(r), held);
    refuses(() => checkPrepare(all(r)), held);
    assert.equal(releaseStatus({ ...r, sdkMode: 'registry' }).releasable, false);
  }
  const lockOnly = onOld(ready, ['lock']);
  refuses(() => checkRegistrySdk(lockOnly), held);
  refuses(() => checkPrepare(all(lockOnly)), held);
  assert.equal(releaseStatus({ ...lockOnly, sdkMode: 'registry' }).releasable, false);
  // A release entry without its SDK, or no entry for the package version, is refused too.
  const unnamed = clone(ready);
  delete unnamed.compatibility.release.prepared.sessSdkVersion;
  refuses(() => checkPrepare(all(unnamed)), /must name sessSdkVersion/);
  const ranged = clone(ready);
  ranged.compatibility.release.prepared.sessSdkVersion = '^0.6.0';
  refuses(() => checkPrepare(all(ranged)), /must name sessSdkVersion/);
  const missing = clone(ready);
  missing.compatibility.release.prepared.version = '0.5.9';
  refuses(() => checkPrepare(all(missing)), /no release.prepared or release.published entry for 0.6.0/);
  refuses(() => checkIdentity({ ...all(ready), compatibility: undefined }), /compatibility.json is missing/);
  // The candidate SDK is never releasable, even when the versions agree.
  assert.equal(releaseStatus({ ...ready, sdkMode: 'candidate' }).releasable, false);
});

test('sdk requirement: the committed records are held exactly when they disagree with the SDK they ship on', () => {
  const { manifest: m, lock: l, compatibility: c, server: s } = committed;
  const required = committedEntry.sessSdkVersion;
  const agree =
    m.dependencies['@sess.si/sdk'] === required &&
    c.sessSdk.version === required &&
    l.packages[SDK_KEY]?.version === required;
  const args = {
    manifest: m,
    lock: l,
    compatibility: c,
    server: s,
    ref: `refs/tags/mcp-v${m.version}`,
    repository: 'w1991e/sess-sdk',
  };
  const status = releaseStatus({ manifest: m, lock: l, compatibility: c, sdkMode: 'registry' });
  if (agree) {
    checkPrepare(args);
    assert.deepEqual(status, { releasable: true });
  } else {
    refuses(() => checkPrepare(args), /ships only on @sess\.si\/sdk .* it is held/);
    assert.equal(status.releasable, false);
  }
});

// The prepare command end to end, as the workflow runs it, from a copy of the guard beside fixture
// records. Held records refuse before Git is consulted; the consistent state passes on a clean
// commit of a master history.
test('prepare: the command refuses mcp 0.6.0 on sdk 0.5.0 and passes it on sdk 0.6.0', () => {
  const runPrepare = (records, { git = false } = {}) => {
    // The real path: the guard runs its command only when invoked as itself (macOS's tmpdir is a
    // symlink, which would make the command a silent no-op).
    const dir = realpathSync(mkdtempSync(join(tmpdir(), 'sess-mcp-release-prepare-')));
    try {
      mkdirSync(join(dir, 'scripts'));
      copyFileSync(join(adapter, 'scripts', 'release-guard.mjs'), join(dir, 'scripts', 'release-guard.mjs'));
      for (const [name, value] of [
        ['package.json', records.manifest],
        ['package-lock.json', records.lock],
        ['compatibility.json', records.compatibility],
        ['server.json', serverFor(records.manifest.version)],
      ])
        writeFileSync(join(dir, name), `${JSON.stringify(value, null, 2)}\n`);
      if (git) {
        const g = (...args) => execFileSync('git', args, { cwd: dir, stdio: 'ignore' });
        g('init', '-q', '-b', 'master');
        g('config', 'user.email', 'test@example.invalid');
        g('config', 'user.name', 'Release guard test');
        g('add', '.');
        g('commit', '-q', '-m', 'records');
        g('update-ref', 'refs/remotes/origin/master', 'HEAD');
      }
      const env = {
        ...process.env,
        GITHUB_REF: 'refs/tags/mcp-v0.6.0',
        GITHUB_REPOSITORY: 'w1991e/sess-sdk',
      };
      delete env.GITHUB_OUTPUT;
      return spawnSync(process.execPath, [join(dir, 'scripts', 'release-guard.mjs'), 'prepare'], {
        env,
        encoding: 'utf8',
      });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  };
  const ready = consistentRecords('0.6.0', '0.6.0');
  const stale = clone(ready);
  stale.manifest.dependencies['@sess.si/sdk'] = '0.5.0';
  stale.compatibility.sessSdk.version = '0.5.0';
  stale.lock.packages[SDK_KEY].version = '0.5.0';
  stale.lock.packages[SDK_KEY].resolved = sdkTarball('0.5.0');
  const refused = runPrepare(stale, { git: hasGit });
  assert.equal(refused.status, 1);
  assert.match(
    refused.stderr,
    /release-guard: REFUSED: @sess\.si\/mcp@0\.6\.0 ships only on @sess\.si\/sdk 0\.6\.0, but the package\.json dependency is 0\.5\.0/,
  );
  if (!hasGit) return;
  const passed = runPrepare(ready, { git: true });
  assert.equal(passed.status, 0, passed.stderr);
  assert.match(
    passed.stdout,
    /release-guard: @sess\.si\/mcp@0\.6\.0 \(latest\) at [0-9a-f]{40} passes the guards/,
  );
});

test('compatibility.json never calls the unpublished package version published', () => {
  // The committed status texts pass, on records that resolve the SDK this version ships on.
  checkCompatibilityStatus({
    manifest,
    compatibility: {
      ...compatibility,
      status: committed.compatibility.status,
      release: { ...compatibility.release, status: committed.compatibility.release.status },
    },
  });
  const recorded = compatibility.release.published.version;
  // A candidate whose top-level or release status claims publication is refused.
  const candidate = clone(manifest);
  candidate.version = '9.9.9-rc.1';
  const record = (status, releaseStatus) => {
    const c = compatibilityFor(candidate.version);
    c.status = status;
    c.release.status = releaseStatus;
    return c;
  };
  const prepared = `At this artifact's preparation (2026-11-18), ${candidate.version} was prepared, not yet published; ${recorded} was then on next`;
  checkCompatibilityStatus({ manifest: candidate, compatibility: record(prepared, prepared) });
  // The present-tense form, which the packed tarball would carry as false after publication, is
  // refused, as are an undated snapshot, another version's snapshot and a missing status.
  const presentTense = `${candidate.version} prepared, unpublished; latest is ${recorded} until ${candidate.version} is published`;
  for (const [status, releaseStatus] of [
    ['published (next)', prepared],
    [prepared, `@sess.si/mcp@${recorded} published on npm dist-tag next`],
    [`published (next); ${candidate.version} prepared, unpublished`, prepared],
    [presentTense, prepared],
    [prepared, presentTense],
    [`At this artifact's preparation, ${candidate.version} was prepared, not yet published`, prepared],
    [`At this artifact's preparation (2026-11-18), 9.9.9 was prepared, not yet published`, prepared],
    [
      `At this artifact's preparation (2026-11-18), ${candidate.version} was prepared and published`,
      prepared,
    ],
    [
      `Published. At this artifact's preparation (2026-11-18), ${candidate.version} was prepared, not yet published`,
      prepared,
    ],
    [undefined, prepared],
    [prepared, undefined],
  ])
    refuses(
      () => checkCompatibilityStatus({ manifest: candidate, compatibility: record(status, releaseStatus) }),
      /compatibility.json (status|release.status)/,
    );
  // The record's version must be the package's.
  refuses(
    () => checkCompatibilityStatus({ manifest: candidate, compatibility }),
    /package.version must equal/,
  );
  // Once publication is recorded for this version, calling it prepared is refused.
  const done = record(prepared, prepared);
  done.release.published.version = candidate.version;
  refuses(
    () => checkCompatibilityStatus({ manifest: candidate, compatibility: done }),
    /calls the published/,
  );
  checkCompatibilityStatus({
    manifest: candidate,
    compatibility: { ...done, status: 'published (next)', release: { ...done.release, status: 'published' } },
  });
});

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

test('identity: a remote-only entry checks no mcpName but needs its remote and version', () => {
  assert.deepEqual(remoteOnly.packages, undefined);
  assert.notEqual(remoteOnly.name, manifest.mcpName);
  assert.deepEqual(checkIdentity({ ...good, server: remoteOnly }), {
    version,
    distTag: version.includes('-rc.') ? 'next' : 'latest',
  });
  const noRemote = clone(remoteOnly);
  delete noRemote.remotes;
  refuses(() => checkIdentity({ ...good, server: noRemote }), /npm package or a remote/);
  const stale = clone(remoteOnly);
  stale.version = '0.0.1';
  refuses(() => checkIdentity({ ...good, server: stale }), /server.json version/);
  // Listing a package brings the mcpName and package checks back.
  const listed = clone(remoteOnly);
  listed.packages = clone(server.packages);
  refuses(() => checkIdentity({ ...good, server: listed }), /mcpName/);
  const two = clone(server);
  two.packages.push(clone(server.packages[0]));
  refuses(() => checkIdentity({ ...good, server: two }), /identifier\/version/);
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
  // The registry entry is in step with the package on every candidate: exactly its version.
  const candidateServer = clone(server);
  candidateServer.version = '0.1.0-rc.1';
  candidateServer.packages[0].version = '0.1.0-rc.1';
  const candidate = clone(manifest);
  candidate.version = '0.1.0-rc.1';
  assert.deepEqual(
    checkIdentity({
      ...good,
      manifest: candidate,
      server: candidateServer,
      ref: 'refs/tags/mcp-v0.1.0-rc.1',
      compatibility: compatibilityFor('0.1.0-rc.1'),
    }),
    { version: '0.1.0-rc.1', distTag: 'next' },
  );
  const stableServer = clone(server);
  stableServer.version = '0.1.0';
  stableServer.packages[0].version = '0.1.0';
  // A candidate whose entry names the stable release (or another candidate) is refused.
  refuses(
    () =>
      checkIdentity({ ...good, manifest: candidate, server: stableServer, ref: 'refs/tags/mcp-v0.1.0-rc.1' }),
    /server.json version/,
  );
  const otherCandidate = clone(candidateServer);
  otherCandidate.packages[0].version = '0.1.0-rc.2';
  refuses(
    () =>
      checkIdentity({
        ...good,
        manifest: candidate,
        server: otherCandidate,
        ref: 'refs/tags/mcp-v0.1.0-rc.1',
      }),
    /identifier\/version/,
  );
  const stable = clone(manifest);
  stable.version = '0.1.0';
  assert.deepEqual(
    checkIdentity({
      ...good,
      manifest: stable,
      server: stableServer,
      ref: 'refs/tags/mcp-v0.1.0',
      compatibility: compatibilityFor('0.1.0'),
    }),
    { version: '0.1.0', distTag: 'latest' },
  );
  const stalePackage = clone(stableServer);
  stalePackage.packages[0].version = '0.1.0-rc.1';
  refuses(
    () => checkIdentity({ ...good, manifest: stable, server: stalePackage, ref: 'refs/tags/mcp-v0.1.0' }),
    /identifier\/version/,
  );
  const badPackage = clone(server);
  badPackage.packages[0].identifier = '@sess.si/other';
  refuses(() => checkIdentity({ ...good, server: badPackage }), /identifier\/version/);
});

test('registry SDK: candidate mode cannot be released; the genuine registry lock passes', () => {
  const registry = fixture.lock;
  const entry = registry.packages[SDK_KEY];
  checkRegistrySdk({ manifest, lock: registry, compatibility });
  const candidateLock = clone(registry);
  candidateLock.packages[SDK_KEY] = {
    ...entry,
    resolved: `file:${compatibility.sessSdk.candidatePath}`,
  };
  refuses(
    () => checkRegistrySdk({ manifest, lock: candidateLock, compatibility }),
    /candidate mode cannot be released/,
  );
  const tampered = clone(registry);
  tampered.packages[SDK_KEY].integrity = 'sha512-AAAA';
  refuses(() => checkRegistrySdk({ manifest, lock: tampered, compatibility }), /pinned integrity/);
});

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
    releasable: true,
    sourceCommit: sha,
    sourceTreeDirty: false,
    sha256,
    integrity: `sha512-${createHash('sha512').update(bytes).digest('base64')}`,
  };
  // The dist-tag the prepare job derives for this version: next for a release candidate, else latest.
  const args = { result, bytes, expectedSha256: sha256, version, distTag: releaseTag, sha };
  assert.equal(checkArtifact(args).sha256, sha256);
  refuses(() => checkArtifact({ ...args, bytes: Buffer.from('changed') }), /bytes changed/);
  refuses(() => checkArtifact({ ...args, expectedSha256: '0'.repeat(64) }), /bytes changed/);
  refuses(() => checkArtifact({ ...args, sha: 'b'.repeat(40) }), /source commit/);
  refuses(() => checkArtifact({ ...args, result: { ...result, sourceTreeDirty: true } }), /source commit/);
  refuses(() => checkArtifact({ ...args, result: { ...result, sdkMode: 'candidate' } }), /candidate SDK/);
  // An artifact recorded as held (the package version on an SDK other than the one it ships on),
  // or with no release status at all, is never staged.
  const hold =
    '@sess.si/mcp@0.6.0 ships only on @sess.si/sdk 0.6.0, but the package.json dependency is 0.5.0';
  refuses(
    () => checkArtifact({ ...args, result: { ...result, releasable: false, releaseHold: hold } }),
    /not releasable: @sess\.si\/mcp@0\.6\.0 ships only on @sess\.si\/sdk 0\.6\.0/,
  );
  const { releasable: _, ...unrecorded } = result;
  refuses(() => checkArtifact({ ...args, result: unrecorded }), /not releasable: no release status/);
  refuses(() => checkArtifact({ ...args, result: { ...result, node: 'v22.14.0' } }), /not tested on/);
  refuses(() => checkArtifact({ ...args, version: '9.9.9' }), /identity/);
  for (const [filename, tarball] of [
    ['../../etc/passwd.tgz', '.artifacts/../../etc/passwd.tgz'],
    [`sess.si-mcp-${version}.tgz`, `.artifacts/../sess.si-mcp-${version}.tgz`],
    [`sess.si-mcp-${version}.tgz`, `/tmp/sess.si-mcp-${version}.tgz`],
    ['sess.si-sdk-0.1.0-rc.3.tgz', '.artifacts/sess.si-sdk-0.1.0-rc.3.tgz'],
    [`sess.si-mcp-${version}.tar`, `.artifacts/sess.si-mcp-${version}.tar`],
    [undefined, undefined],
  ]) {
    const bad = { ...result, filename, tarball };
    refuses(() => checkArtifactPath({ result: bad, version }), /filename\/path/);
    refuses(() => checkArtifact({ ...args, result: bad }), /filename\/path/);
  }
  assert.equal(checkArtifactPath({ result, version }), `.artifacts/sess.si-mcp-${version}.tgz`);
  refuses(() => checkArtifact({ ...args, distTag: releaseTag === 'next' ? 'latest' : 'next' }), /dist-tag/);
  // Both directions, whatever the package version: an rc is never latest, a stable one never next.
  const rc = { ...result, version: '0.1.0-rc.9', filename: 'sess.si-mcp-0.1.0-rc.9.tgz' };
  rc.tarball = `.artifacts/${rc.filename}`;
  const rcArgs = { ...args, result: rc, version: rc.version };
  assert.equal(checkArtifact({ ...rcArgs, distTag: 'next' }).sha256, sha256);
  refuses(() => checkArtifact({ ...rcArgs, distTag: 'latest' }), /dist-tag/);
  const stable = { ...result, version: '9.9.0', filename: 'sess.si-mcp-9.9.0.tgz' };
  stable.tarball = `.artifacts/${stable.filename}`;
  const stableArgs = { ...args, result: stable, version: stable.version };
  assert.equal(checkArtifact({ ...stableArgs, distTag: 'latest' }).sha256, sha256);
  refuses(() => checkArtifact({ ...stableArgs, distTag: 'next' }), /dist-tag/);
});

test('readback: exact integrity, rc on next and never latest, stable on latest, dependencies and provenance', () => {
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
  const tags = { [releaseTag]: version };
  checkPublished({ manifest, result, published, tags, distTag: releaseTag });
  refuses(
    () =>
      checkPublished({
        manifest,
        result,
        published: { ...published, dist: { ...published.dist, integrity: 'sha512-other' } },
        tags,
        distTag: releaseTag,
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
        distTag: releaseTag,
      }),
    /does not match/,
  );
  refuses(
    () =>
      checkPublished({ manifest, result, published, tags: { [releaseTag]: '0.0.0' }, distTag: releaseTag }),
    /does not match/,
  );
  // A release candidate on latest is refused, whatever this package's version is.
  const rcManifest = { ...manifest, version: '0.1.0-rc.9' };
  const rcPublished = { ...published, version: rcManifest.version };
  checkPublished({
    manifest: rcManifest,
    result,
    published: rcPublished,
    tags: { next: rcManifest.version },
    distTag: 'next',
  });
  refuses(
    () =>
      checkPublished({
        manifest: rcManifest,
        result,
        published: rcPublished,
        tags: { next: rcManifest.version, latest: rcManifest.version },
        distTag: 'next',
      }),
    /does not match/,
  );
  // A stable version passes only once latest serves it.
  const stableManifest = { ...manifest, version: '9.9.0' };
  const stablePublished = { ...published, version: stableManifest.version };
  checkPublished({
    manifest: stableManifest,
    result,
    published: stablePublished,
    tags: { latest: stableManifest.version, next: '9.9.0-rc.1' },
    distTag: 'latest',
  });
  refuses(
    () =>
      checkPublished({
        manifest: stableManifest,
        result,
        published: stablePublished,
        tags: { latest: '0.0.0-stage', next: stableManifest.version },
        distTag: 'latest',
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
        distTag: releaseTag,
      }),
    /does not match/,
  );
  for (const repository of [
    { ...manifest.repository, directory: 'adapters/openclaw' },
    { ...manifest.repository, directory: undefined },
    { ...manifest.repository, url: 'git+https://github.com/someone/fork.git' },
  ])
    refuses(
      () =>
        checkPublished({
          manifest,
          result,
          published: { ...published, repository },
          tags,
          distTag: releaseTag,
        }),
      /does not match/,
    );
});
