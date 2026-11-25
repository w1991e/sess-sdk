// Release guards for @sess.si/mcp, used by .github/workflows/mcp-release.yml and exercised
// locally by scripts/test-release-guard.mjs. Node built-ins only; nothing here publishes.
//
//   node scripts/release-guard.mjs prepare    tag/version/identity, the SDK this version ships on,
//                                             registry SDK, master ancestry, clean tree; writes
//                                             version and dist-tag outputs
//   node scripts/release-guard.mjs artifact   the downloaded artifact is the tested one
//   node scripts/release-guard.mjs readback   registry metadata equals the tested artifact
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { appendFileSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { isDeepStrictEqual } from 'node:util';

export const REPOSITORY = 'w1991e/sess-sdk';
export const PACKAGE = '@sess.si/mcp';
export const DIRECTORY = 'adapters/mcp';
export const REPOSITORY_URL = 'git+https://github.com/w1991e/sess-sdk.git';
export const RELEASE_NODE = 'v24.21.0';
const VERSION = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-rc\.(0|[1-9]\d*))?$/;
const SDK_REGISTRY = (version) => `https://registry.npmjs.org/@sess.si/sdk/-/sdk-${version}.tgz`;

export class GuardError extends Error {}
const refuse = (message) => {
  throw new GuardError(message);
};

/**
 * The SDK this package version ships on (ASTRA-SDK-81-1). compatibility.json's release entry for
 * the package version (release.prepared, or release.published once publication is recorded)
 * names it as `sessSdkVersion`, an exact version. The manifest dependency, the pinned
 * compatibility.json sessSdk and, when given, the lock must all be exactly that version;
 * otherwise this package version cannot be released. A version prepared ahead of its SDK's
 * registry transition (@sess.si/mcp 0.6.0 ships only on @sess.si/sdk 0.6.0 while the records
 * still pin 0.5.0) is therefore held until the transition moves every record to it.
 */
export function checkSdkRequirement({ manifest, compatibility, lock }) {
  const version = manifest?.version;
  const entry = [compatibility?.release?.prepared, compatibility?.release?.published].find(
    (candidate) => candidate?.version === version,
  );
  if (!entry) refuse(`compatibility.json has no release.prepared or release.published entry for ${version}`);
  const required = entry.sessSdkVersion;
  if (typeof required !== 'string' || !VERSION.test(required))
    refuse(
      `compatibility.json's release entry for ${version} must name sessSdkVersion, an exact @sess.si/sdk version`,
    );
  const resolved = {
    'package.json dependency': manifest.dependencies?.['@sess.si/sdk'],
    'compatibility.json sessSdk.version': compatibility.sessSdk?.version,
  };
  if (lock !== undefined)
    resolved['package-lock.json @sess.si/sdk'] = lock?.packages?.['node_modules/@sess.si/sdk']?.version;
  for (const [record, value] of Object.entries(resolved))
    if (value !== required)
      refuse(
        `${PACKAGE}@${version} ships only on @sess.si/sdk ${required}, but the ${record} is ${value}; it is held until the SDK's registry transition moves every record to ${required}`,
      );
  return required;
}

/**
 * Release identity: the tag names exactly this package version at this path, and the version is
 * not held for the SDK it ships on (checkSdkRequirement).
 */
export function checkIdentity({ manifest, server, ref, repository, compatibility }) {
  if (repository !== REPOSITORY) refuse(`repository must be ${REPOSITORY}`);
  if (manifest.name !== PACKAGE) refuse(`package name must be ${PACKAGE}`);
  if (manifest.repository?.directory !== DIRECTORY) refuse(`repository.directory must be ${DIRECTORY}`);
  if (manifest.repository?.url !== REPOSITORY_URL) refuse('repository.url drift');
  if (manifest.private === true || manifest.publishConfig?.access !== 'public')
    refuse('package must be public and not private');
  if (!VERSION.test(manifest.version)) refuse(`unsupported version ${manifest.version}`);
  if (ref !== `refs/tags/mcp-v${manifest.version}`)
    refuse(`tag ${ref} does not equal refs/tags/mcp-v${manifest.version}`);
  if (!server) refuse('server.json is missing');
  // server.json, the MCP Registry entry, stays in step with the package on every release
  // candidate (2026-10-20): the server (and its npm package, when listed) name exactly this
  // version. Submitting the entry to the registry remains a separate owner action.
  if (server.version !== manifest.version) refuse('server.json version must equal the package version');
  const packages = server.packages ?? [];
  if (packages.length === 0) {
    // A remote-only entry (the npm package deferred) lists no package, so the registry checks no
    // published mcpName against it; it must still declare its remote.
    if (!Array.isArray(server.remotes) || server.remotes.length === 0)
      refuse('server.json must list the npm package or a remote');
  } else {
    if (manifest.mcpName !== server.name) refuse('package.json mcpName must equal server.json name');
    const npmPackage = packages.find((p) => p.registryType === 'npm');
    if (
      packages.length !== 1 ||
      npmPackage?.identifier !== PACKAGE ||
      npmPackage.version !== manifest.version
    )
      refuse('server.json npm package identifier/version drift');
  }
  if (!compatibility) refuse('compatibility.json is missing');
  checkSdkRequirement({ manifest, compatibility });
  // Release candidates never take the default dist-tag.
  return { version: manifest.version, distTag: manifest.version.includes('-rc.') ? 'next' : 'latest' };
}

const escapeRegExp = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
/**
 * compatibility.json is packed and stays in the tarball after publication, so the status of a
 * version not yet published is a dated snapshot that remains true afterwards (ASTRA-75-R2): it
 * opens "At this artifact's preparation (YYYY-MM-DD), <version> was prepared" and says the
 * version was "not yet published".
 */
export const preparedSnapshot = (version) =>
  new RegExp(
    `^At this artifact's preparation \\(\\d{4}-\\d{2}-\\d{2}\\), ${escapeRegExp(version)} was prepared\\b`,
  );

/**
 * compatibility.json describes this package version truthfully: a version that is not the
 * recorded publication (release.published) has the dated preparation snapshot (preparedSnapshot,
 * "not yet published") in both the top-level and the release status, so neither opens with a
 * publication claim; the recorded publication is never called prepared.
 */
export function checkCompatibilityStatus({ manifest, compatibility }) {
  const version = manifest.version;
  if (compatibility.package?.version !== version)
    refuse('compatibility.json package.version must equal the package version');
  checkSdkRequirement({ manifest, compatibility });
  const statuses = { status: compatibility.status, 'release.status': compatibility.release?.status };
  const published = compatibility.release?.published?.version === version;
  for (const [field, status] of Object.entries(statuses)) {
    if (typeof status !== 'string') refuse(`compatibility.json ${field} is missing`);
    if (published) {
      if (status.includes(`${version} prepared`) || status.includes(`${version} was prepared`))
        refuse(`compatibility.json ${field} calls the published ${version} prepared`);
    } else if (!preparedSnapshot(version).test(status) || !status.includes('not yet published'))
      refuse(
        `compatibility.json ${field} must open "At this artifact's preparation (YYYY-MM-DD), ${version} was prepared" and say it was not yet published (release.published records ${compatibility.release?.published?.version})`,
      );
  }
}

/** A release requires the genuine registry SDK, never the local candidate tarball. */
export function checkRegistrySdk({ manifest, lock, compatibility }) {
  checkSdkRequirement({ manifest, compatibility, lock });
  const pinned = compatibility.sessSdk;
  const entry = lock.packages?.['node_modules/@sess.si/sdk'];
  if (manifest.dependencies?.['@sess.si/sdk'] !== pinned.version)
    refuse('exact @sess.si/sdk dependency drift');
  if (!entry || entry.resolved !== SDK_REGISTRY(pinned.version) || entry.integrity !== pinned.integrity)
    refuse(
      'the lock must resolve @sess.si/sdk to the genuine registry tarball with the pinned integrity (candidate mode cannot be released)',
    );
}

/** The tagged commit is on reviewed master history and the working tree is clean. */
export function checkGit({ cwd, master = 'refs/remotes/origin/master' }) {
  try {
    execFileSync('git', ['merge-base', '--is-ancestor', 'HEAD', master], { cwd, stdio: 'ignore' });
  } catch {
    refuse(`the tagged commit is not reachable from ${master}`);
  }
  const status = execFileSync('git', ['status', '--porcelain', '--untracked-files=all'], {
    cwd,
    encoding: 'utf8',
  });
  if (status.trim()) refuse('the working tree is not clean');
  return execFileSync('git', ['rev-parse', 'HEAD'], { cwd, encoding: 'utf8' }).trim();
}

/** The downloaded artifact is byte-identical to the tested one, from this commit. */
/**
 * Validates the recorded filename and path before anything is read: exactly npm's pack name for
 * this package and version, directly inside .artifacts/. Returns the relative tarball path.
 */
export function checkArtifactPath({ result, version }) {
  const expected = `sess.si-mcp-${version}.tgz`;
  if (
    typeof result?.filename !== 'string' ||
    result.filename !== expected ||
    !/^[A-Za-z0-9][A-Za-z0-9._-]*\.tgz$/.test(result.filename) ||
    result.tarball !== `.artifacts/${expected}`
  )
    refuse('artifact filename/path drift');
  return result.tarball;
}

export function checkArtifact({ result, bytes, expectedSha256, version, distTag, sha }) {
  if (result.name !== PACKAGE || result.version !== version)
    refuse('artifact identity differs from the release');
  checkArtifactPath({ result, version });
  if (result.node !== RELEASE_NODE) refuse(`artifact was not tested on ${RELEASE_NODE}`);
  if (result.sdkMode !== 'registry') refuse('artifact was tested against the candidate SDK');
  if (result.releasable !== true)
    refuse(`artifact is not releasable: ${result.releaseHold ?? 'no release status was recorded'}`);
  if (result.sourceCommit !== sha || result.sourceTreeDirty !== false)
    refuse('artifact source commit/tree drift');
  if ((version.includes('-rc.') ? 'next' : 'latest') !== distTag) refuse('dist-tag drift');
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  const integrity = `sha512-${createHash('sha512').update(bytes).digest('base64')}`;
  if (sha256 !== result.sha256 || sha256 !== expectedSha256 || integrity !== result.integrity)
    refuse('tested bytes changed');
  return { sha256, integrity };
}

/** Registry readback: exact version, integrity, dist-tag, dependencies and provenance. */
export function checkPublished({ manifest, result, published, tags, distTag }) {
  if (
    published.name !== manifest.name ||
    published.version !== manifest.version ||
    published.repository?.url !== manifest.repository.url ||
    published.repository?.directory !== DIRECTORY ||
    published.dist?.integrity !== result.integrity ||
    tags?.[distTag] !== manifest.version ||
    (manifest.version.includes('-rc.') && tags?.latest === manifest.version) ||
    !published.dist?.attestations?.url ||
    !published.dist?.attestations?.provenance ||
    !isDeepStrictEqual(published.dependencies, manifest.dependencies)
  )
    refuse('published metadata does not match the tested artifact');
}

/**
 * The prepare job's record checks, before Git: identity and the SDK this version ships on, the
 * registry SDK and the compatibility status. Returns the release identity.
 */
export function checkPrepare({ manifest, server, lock, compatibility, ref, repository }) {
  const identity = checkIdentity({ manifest, server, ref, repository, compatibility });
  checkRegistrySdk({ manifest, lock, compatibility });
  checkCompatibilityStatus({ manifest, compatibility });
  return identity;
}

/**
 * The release status recorded with a packed artifact by check-package.mjs: releasable only when
 * every record resolves the SDK this version ships on and the SDK came from the registry. A held
 * artifact records why; the artifact guard refuses it.
 */
export function releaseStatus({ manifest, lock, compatibility, sdkMode }) {
  try {
    checkSdkRequirement({ manifest, compatibility, lock });
    if (sdkMode !== 'registry') refuse('it was tested against the candidate SDK');
    return { releasable: true };
  } catch (error) {
    if (!(error instanceof GuardError)) throw error;
    return { releasable: false, releaseHold: error.message };
  }
}

const readJson = (path) => JSON.parse(readFileSync(path, 'utf8'));
function output(values) {
  if (!process.env.GITHUB_OUTPUT) return;
  appendFileSync(
    process.env.GITHUB_OUTPUT,
    Object.entries(values)
      .map(([k, v]) => `${k}=${v}\n`)
      .join(''),
  );
}

async function main() {
  const adapter = resolve(dirname(fileURLToPath(import.meta.url)), '..');
  const manifest = readJson(join(adapter, 'package.json'));
  const command = process.argv[2];
  if (command === 'prepare') {
    const identity = checkPrepare({
      manifest,
      server: readJson(join(adapter, 'server.json')),
      lock: readJson(join(adapter, 'package-lock.json')),
      compatibility: readJson(join(adapter, 'compatibility.json')),
      ref: process.env.GITHUB_REF,
      repository: process.env.GITHUB_REPOSITORY,
    });
    const sha = checkGit({ cwd: adapter });
    output({ version: identity.version, 'dist-tag': identity.distTag });
    console.log(
      `release-guard: ${PACKAGE}@${identity.version} (${identity.distTag}) at ${sha} passes the guards`,
    );
  } else if (command === 'artifact') {
    const dir = join(adapter, '.artifacts');
    const result = readJson(join(dir, 'package-result.json'));
    // Path validation precedes any read of the recorded tarball path.
    const tarball = checkArtifactPath({ result, version: process.env.RELEASE_VERSION });
    const digests = checkArtifact({
      result,
      bytes: readFileSync(join(adapter, tarball)),
      expectedSha256: process.env.EXPECTED_TARBALL_SHA256,
      version: process.env.RELEASE_VERSION,
      distTag: process.env.RELEASE_DIST_TAG,
      sha: process.env.GITHUB_SHA,
    });
    if (manifest.version !== process.env.RELEASE_VERSION)
      refuse('checked-out version differs from the release');
    output({ tarball: join(adapter, result.tarball) });
    console.log(`release-guard: artifact ${result.filename} sha256=${digests.sha256} is the tested one`);
  } else if (command === 'readback') {
    const result = readJson(join(adapter, '.artifacts', 'package-result.json'));
    const view = (args) =>
      JSON.parse(execFileSync('npm', ['view', ...args, '--json', '--prefer-online'], { encoding: 'utf8' }));
    for (let attempt = 0; ; attempt++) {
      try {
        checkPublished({
          manifest,
          result,
          published: view([`${manifest.name}@${manifest.version}`]),
          tags: view([manifest.name, 'dist-tags']),
          distTag: process.env.RELEASE_DIST_TAG,
        });
        break;
      } catch (error) {
        if (attempt === 5) throw error;
        await sleep(10_000);
      }
    }
    console.log(
      `release-guard: verified ${manifest.name}@${manifest.version} on ${process.env.RELEASE_DIST_TAG}, integrity and provenance`,
    );
  } else {
    refuse('usage: node scripts/release-guard.mjs prepare | artifact | readback');
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch((error) => {
    console.error(`release-guard: REFUSED: ${error.message}`);
    process.exit(1);
  });
}
