// Release identity guards for @sess.si/openclaw (openclaw-release.yml). Pure checks plus a CLI that
// gathers the facts in CI. Self-test: node --test scripts/test-release-guard.mjs
import { execFileSync } from 'node:child_process';
import { appendFileSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export const PACKAGE_NAME = '@sess.si/openclaw';
export const PACKAGE_DIRECTORY = 'adapters/openclaw';
export const REPOSITORY = 'w1991e/sess-sdk';
export const SDK_NAME = '@sess.si/sdk';
const VERSION = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(-rc\.(0|[1-9]\d*))?$/;

/**
 * @param {{ manifest: any, ref: string, repository: string, onMaster: boolean, cleanTree: boolean,
 *   lockedSdkIntegrity: string | undefined, registrySdkIntegrity: string | undefined }} facts
 * @returns {{ version: string, distTag: 'next' | 'latest' }}
 */
export function checkRelease(facts) {
  const { manifest, ref, repository, onMaster, cleanTree, lockedSdkIntegrity, registrySdkIntegrity } = facts;
  const failures = [];
  if (repository !== REPOSITORY) failures.push('repository');
  if (manifest?.name !== PACKAGE_NAME) failures.push('package name');
  if (manifest?.repository?.directory !== PACKAGE_DIRECTORY) failures.push('package directory');
  if (manifest?.private === true || manifest?.publishConfig?.access !== 'public') failures.push('visibility');
  // A release candidate (x.y.z-rc.n) or a stable version (x.y.z); nothing else.
  if (typeof manifest?.version !== 'string' || !VERSION.test(manifest.version)) failures.push('version');
  if (manifest?.license !== 'Apache-2.0') failures.push('license');
  if (ref !== `refs/tags/openclaw-v${manifest?.version}`) failures.push('tag');
  if (!onMaster) failures.push('master reachability');
  if (!cleanTree) failures.push('clean tree');
  const sdkSpec = manifest?.dependencies?.[SDK_NAME];
  if (typeof sdkSpec !== 'string' || !/^\d+\.\d+\.\d+(-rc\.\d+)?$/.test(sdkSpec))
    failures.push('exact SDK dependency');
  // Exact registry versions only (no ranges, tags, file:, git, URLs or workspace specs). A peer may
  // list several exact host versions joined by " || " (each one declared, none a range).
  const EXACT = /^\d+\.\d+\.\d+(-[0-9A-Za-z.]+)?$/;
  for (const spec of Object.values({ ...manifest?.dependencies }))
    if (typeof spec !== 'string' || !EXACT.test(spec)) failures.push('registry dependency specs');
  for (const spec of Object.values({ ...manifest?.peerDependencies }))
    if (typeof spec !== 'string' || !spec.split(' || ').every((version) => EXACT.test(version)))
      failures.push('registry dependency specs');
  // Refuse candidate mode: the locked SDK bytes must be the ones the public registry serves.
  if (!lockedSdkIntegrity || !registrySdkIntegrity || lockedSdkIntegrity !== registrySdkIntegrity)
    failures.push('registry SDK integrity');
  if (failures.length) throw new Error(`Release guard failed: ${[...new Set(failures)].join(', ')}.`);
  // Release candidates never take the default dist-tag; a stable version is published to latest,
  // the same rule as the SDK, MCP adapter and create-agent releases (owner decision 2026-10-31).
  return { version: manifest.version, distTag: manifest.version.includes('-rc.') ? 'next' : 'latest' };
}

/**
 * compatibility.json describes this package version truthfully: a version that is not the
 * recorded publication (`publication`) has a status saying "<version> prepared ... unpublished"
 * that does not open with a publication claim; the recorded publication is never called prepared.
 * @param {{ manifest: any, compatibility: any }} input
 */
export function checkCompatibilityStatus({ manifest, compatibility }) {
  const version = manifest?.version;
  const status = compatibility?.status;
  const failures = [];
  if (compatibility?.version !== version) failures.push('compatibility version');
  if (typeof status !== 'string') failures.push('compatibility status');
  else if (compatibility?.publication?.version === version) {
    if (status.includes(`${version} prepared`))
      failures.push('compatibility status (published version called prepared)');
  } else if (
    !status.includes(`${version} prepared`) ||
    !status.includes('unpublished') ||
    /^published\b/.test(status)
  )
    failures.push(`compatibility status (${version} must be prepared and unpublished)`);
  if (failures.length) throw new Error(`Release guard failed: ${failures.join(', ')}.`);
}

function gatherFacts(cwd) {
  const manifest = JSON.parse(readFileSync(`${cwd}/package.json`, 'utf8'));
  const lock = JSON.parse(readFileSync(`${cwd}/package-lock.json`, 'utf8'));
  const sdkSpec = manifest.dependencies?.[SDK_NAME];
  const git = (args) => execFileSync('git', args, { cwd, encoding: 'utf8' });
  let onMaster = true;
  try {
    git(['merge-base', '--is-ancestor', 'HEAD', 'refs/remotes/origin/master']);
  } catch {
    onMaster = false;
  }
  let registrySdkIntegrity;
  try {
    registrySdkIntegrity = JSON.parse(
      execFileSync('npm', ['view', `${SDK_NAME}@${sdkSpec}`, 'dist.integrity', '--json', '--prefer-online'], {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
      }),
    );
  } catch {
    registrySdkIntegrity = undefined;
  }
  return {
    manifest,
    ref: process.env.GITHUB_REF ?? '',
    repository: process.env.GITHUB_REPOSITORY ?? '',
    onMaster,
    cleanTree: git(['status', '--porcelain']).trim() === '',
    lockedSdkIntegrity: lock.packages?.[`node_modules/${SDK_NAME}`]?.integrity,
    registrySdkIntegrity,
  };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const facts = gatherFacts(process.cwd());
  const { version, distTag } = checkRelease(facts);
  checkCompatibilityStatus({
    manifest: facts.manifest,
    compatibility: JSON.parse(readFileSync(`${process.cwd()}/compatibility.json`, 'utf8')),
  });
  if (process.env.GITHUB_OUTPUT)
    appendFileSync(process.env.GITHUB_OUTPUT, `version=${version}\ndist-tag=${distTag}\n`);
  console.log(`Release guard passed: ${PACKAGE_NAME}@${version} -> ${distTag}`);
}
