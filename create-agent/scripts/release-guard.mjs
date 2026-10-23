// Release guards for @sess.si/create-agent, used by .github/workflows/create-agent-release.yml and
// exercised locally by create-agent/scripts/test-release-guard.mjs. Node built-ins only; nothing
// here publishes. Not packed (only index.mjs, template/, README.md and LICENSE are).
//
//   node create-agent/scripts/release-guard.mjs prepare   tag/version/identity, the template's SDK
//                                                         pin is published, master ancestry, clean
//                                                         tree; writes version and dist-tag outputs
//   node create-agent/scripts/release-guard.mjs pack      packs once into create-agent/.artifacts,
//                                                         checks packed hygiene and records the
//                                                         tested bytes
//   node create-agent/scripts/release-guard.mjs exercised the clean-install check passed on exactly
//                                                         the packed candidate's bytes
//   node create-agent/scripts/release-guard.mjs artifact  the downloaded artifact is the tested one
//   node create-agent/scripts/release-guard.mjs readback  registry metadata equals the tested artifact
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { appendFileSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { checkTarball, formatFinding } from '../../scripts/check-packed-hygiene.mjs';

export const REPOSITORY = 'w1991e/sess-sdk';
export const PACKAGE = '@sess.si/create-agent';
export const DIRECTORY = 'create-agent';
export const REPOSITORY_URL = 'git+https://github.com/w1991e/sess-sdk.git';
export const RELEASE_NODE = 'v24.21.0';
export const PACKED_FILES = [
  'LICENSE',
  'README.md',
  'index.mjs',
  'package.json',
  'template/LICENSE',
  'template/README.md',
  'template/_env.example',
  'template/_gitignore',
  'template/agent.mjs',
  'template/package.json',
  'template/weather.mjs',
];
const VERSION = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-rc\.(0|[1-9]\d*))?$/;

export class GuardError extends Error {}
const refuse = (message) => {
  throw new GuardError(message);
};

/** Release identity: the tag names exactly this package version at this path. */
export function checkIdentity({ manifest, ref, repository }) {
  if (repository !== REPOSITORY) refuse(`repository must be ${REPOSITORY}`);
  if (manifest.name !== PACKAGE) refuse(`package name must be ${PACKAGE}`);
  if (manifest.repository?.directory !== DIRECTORY) refuse(`repository.directory must be ${DIRECTORY}`);
  if (manifest.repository?.url !== REPOSITORY_URL) refuse('repository.url drift');
  if (manifest.private === true || manifest.publishConfig?.access !== 'public')
    refuse('package must be public and not private');
  if (manifest.scripts !== undefined) refuse('the initializer must declare no scripts');
  for (const field of ['dependencies', 'optionalDependencies', 'peerDependencies', 'bundleDependencies'])
    if (manifest[field] !== undefined && Object.keys(manifest[field]).length > 0)
      refuse(`the initializer must declare no ${field}`);
  if (!VERSION.test(manifest.version)) refuse(`unsupported version ${manifest.version}`);
  if (ref !== `refs/tags/create-agent-v${manifest.version}`)
    refuse(`tag ${ref} does not equal refs/tags/create-agent-v${manifest.version}`);
  // Release candidates never take the default dist-tag.
  return { version: manifest.version, distTag: manifest.version.includes('-rc.') ? 'next' : 'latest' };
}

/**
 * The template the initializer copies depends exactly on the pinned SDK, and that version is
 * published with the pinned integrity: the initializer never points people at unpublished bytes.
 */
export function checkTemplateSdk({ template, pin, publishedIntegrity }) {
  if (pin?.name !== '@sess.si/sdk' || !VERSION.test(pin?.version ?? '')) refuse('SDK pin drift');
  const deps = template.dependencies ?? {};
  if (Object.keys(deps).length !== 1 || deps['@sess.si/sdk'] !== pin.version)
    refuse(`the template must depend exactly on @sess.si/sdk ${pin.version}`);
  if (template.devDependencies !== undefined) refuse('the template must declare no devDependencies');
  if (publishedIntegrity !== pin.integrity)
    refuse(`@sess.si/sdk@${pin.version} is not published with the pinned integrity`);
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

/** npm pack's single entry is exactly this package, version, file name and file allowlist. */
export function checkPackEntry({ entry, version }) {
  if (entry?.name !== PACKAGE || entry.version !== version) refuse('packed identity drift');
  if (entry.filename !== `sess.si-create-agent-${version}.tgz`) refuse('packed filename drift');
  const files = (entry.files ?? []).map((f) => f.path).sort();
  if (JSON.stringify(files) !== JSON.stringify(PACKED_FILES)) refuse('packed file list drift');
}

/** The clean-install record names exactly the packed candidate's bytes, and it passed. */
export function checkExercised({ result, exercised }) {
  if (exercised?.check !== 'create-agent-clean-install' || exercised.passed !== true)
    refuse('no passing clean-install record for the candidate');
  if (!/^[a-f0-9]{64}$/.test(exercised.sha256 ?? '') || exercised.sha256 !== result?.sha256)
    refuse('the clean-install check exercised different bytes than the packed candidate');
}

/**
 * Validates the recorded filename and path before anything is read: exactly npm's pack name for
 * this package and version, directly inside .artifacts/. Returns the relative tarball path.
 */
export function checkArtifactPath({ result, version }) {
  const expected = `sess.si-create-agent-${version}.tgz`;
  if (
    typeof result?.filename !== 'string' ||
    result.filename !== expected ||
    !/^[A-Za-z0-9][A-Za-z0-9._-]*\.tgz$/.test(result.filename) ||
    result.tarball !== `.artifacts/${expected}`
  )
    refuse('artifact filename/path drift');
  return result.tarball;
}

/** The downloaded artifact is byte-identical to the tested one, from this commit. */
export function checkArtifact({ result, bytes, expectedSha256, version, distTag, sha }) {
  if (result.name !== PACKAGE || result.version !== version)
    refuse('artifact identity differs from the release');
  checkArtifactPath({ result, version });
  if (result.node !== RELEASE_NODE) refuse(`artifact was not tested on ${RELEASE_NODE}`);
  if (result.sourceCommit !== sha || result.sourceTreeDirty !== false)
    refuse('artifact source commit/tree drift');
  if (JSON.stringify(result.files) !== JSON.stringify(PACKED_FILES)) refuse('artifact file list drift');
  if ((version.includes('-rc.') ? 'next' : 'latest') !== distTag) refuse('dist-tag drift');
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  const integrity = `sha512-${createHash('sha512').update(bytes).digest('base64')}`;
  if (sha256 !== result.sha256 || sha256 !== expectedSha256 || integrity !== result.integrity)
    refuse('tested bytes changed');
  return { sha256, integrity };
}

/** Registry readback: exact version, integrity, dist-tag, no dependencies and provenance. */
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
    (published.dependencies !== undefined && Object.keys(published.dependencies).length > 0)
  )
    refuse('published metadata does not match the tested artifact');
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
  const pkg = resolve(dirname(fileURLToPath(import.meta.url)), '..');
  const root = resolve(pkg, '..');
  const manifest = readJson(join(pkg, 'package.json'));
  const command = process.argv[2];
  if (command === 'prepare') {
    const identity = checkIdentity({
      manifest,
      ref: process.env.GITHUB_REF,
      repository: process.env.GITHUB_REPOSITORY,
    });
    const pin = readJson(join(root, 'release', 'sdk-candidate.json'));
    const publishedIntegrity = execFileSync(
      'npm',
      ['view', `@sess.si/sdk@${pin.version}`, 'dist.integrity', '--prefer-online'],
      { encoding: 'utf8' },
    ).trim();
    checkTemplateSdk({ template: readJson(join(pkg, 'template', 'package.json')), pin, publishedIntegrity });
    const sha = checkGit({ cwd: pkg });
    output({ version: identity.version, 'dist-tag': identity.distTag });
    console.log(
      `release-guard: ${PACKAGE}@${identity.version} (${identity.distTag}) at ${sha} passes the guards`,
    );
  } else if (command === 'pack') {
    const dir = join(pkg, '.artifacts');
    if (existsSync(dir) && readdirSync(dir).length > 0) refuse('.artifacts is not empty');
    mkdirSync(dir, { recursive: true });
    const sha = checkGit({ cwd: pkg, master: 'HEAD' });
    const [entry, ...rest] = JSON.parse(
      execFileSync('npm', ['pack', '--json', '--ignore-scripts', '--pack-destination', dir], {
        cwd: pkg,
        encoding: 'utf8',
      }),
    );
    if (rest.length) refuse('npm pack produced more than one package');
    checkPackEntry({ entry, version: manifest.version });
    // No maps, fixtures, non-public hosts, credential-shaped strings or internal references.
    const { findings } = checkTarball(join(dir, entry.filename));
    if (findings.length) refuse(`packed hygiene:\n  ${findings.map(formatFinding).join('\n  ')}`);
    const bytes = readFileSync(join(dir, entry.filename));
    const sha256 = createHash('sha256').update(bytes).digest('hex');
    const integrity = `sha512-${createHash('sha512').update(bytes).digest('base64')}`;
    if (integrity !== entry.integrity) refuse('npm pack integrity differs from the bytes');
    const result = {
      name: entry.name,
      version: entry.version,
      filename: entry.filename,
      tarball: `.artifacts/${entry.filename}`,
      files: (entry.files ?? []).map((f) => f.path).sort(),
      node: process.version,
      sourceCommit: sha,
      sourceTreeDirty: false,
      sha256,
      integrity,
    };
    writeFileSync(join(dir, 'package-result.json'), `${JSON.stringify(result, null, 2)}\n`);
    output({ sha256 });
    console.log(`release-guard: packed ${entry.filename} sha256=${sha256}`);
  } else if (command === 'exercised') {
    const dir = join(pkg, '.artifacts');
    const result = readJson(join(dir, 'package-result.json'));
    checkArtifactPath({ result, version: manifest.version });
    // Re-hash the candidate on disk: the bytes uploaded next are the bytes that were exercised.
    const onDisk = createHash('sha256')
      .update(readFileSync(join(pkg, result.tarball)))
      .digest('hex');
    if (onDisk !== result.sha256) refuse('the packed candidate changed on disk');
    checkExercised({ result, exercised: readJson(join(dir, 'exercised.json')) });
    console.log(`release-guard: the clean-install check exercised ${result.filename} sha256=${onDisk}`);
  } else if (command === 'artifact') {
    const result = readJson(join(pkg, '.artifacts', 'package-result.json'));
    // Path validation precedes any read of the recorded tarball path.
    const tarball = checkArtifactPath({ result, version: process.env.RELEASE_VERSION });
    const digests = checkArtifact({
      result,
      bytes: readFileSync(join(pkg, tarball)),
      expectedSha256: process.env.EXPECTED_TARBALL_SHA256,
      version: process.env.RELEASE_VERSION,
      distTag: process.env.RELEASE_DIST_TAG,
      sha: process.env.GITHUB_SHA,
    });
    if (manifest.version !== process.env.RELEASE_VERSION)
      refuse('checked-out version differs from the release');
    output({ tarball: join(pkg, result.tarball) });
    console.log(`release-guard: artifact ${result.filename} sha256=${digests.sha256} is the tested one`);
  } else if (command === 'readback') {
    const result = readJson(join(pkg, '.artifacts', 'package-result.json'));
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
    refuse(
      'usage: node create-agent/scripts/release-guard.mjs prepare | pack | exercised | artifact | readback',
    );
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch((error) => {
    console.error(`release-guard: REFUSED: ${error.message}`);
    process.exit(1);
  });
}
