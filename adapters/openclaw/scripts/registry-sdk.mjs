// The adapter's only production dependency is the published @sess.si/sdk at the exact version pinned
// in the repository's release/sdk-candidate.json (name, version, sha256, sha512 integrity; kept
// consistent by the root `npm run pin:update` and verified by the root `npm run check`). It installs
// from the public npm registry (`next` dist-tag; never `latest`). This check refuses any drift
// between the pin, package.json, package-lock.json and the installed SDK.
//
// Usage: node scripts/registry-sdk.mjs              (after npm ci: manifest, lock, installed tree)
//        node scripts/registry-sdk.mjs --registry   (additionally reads the registry's dist.integrity)
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const pin = JSON.parse(readFileSync(new URL('../../../release/sdk-candidate.json', import.meta.url), 'utf8'));
export const SDK_PIN = Object.freeze({
  name: pin.name,
  version: pin.version,
  sha256: pin.sha256,
  integrity: pin.integrity,
});

const readJson = (path) => JSON.parse(readFileSync(path, 'utf8'));

/** Returns the drift between the pin and this package's manifest, lockfile and installed tree. */
export function sdkDrift(root, { installed = true } = {}) {
  const drift = [];
  const expect = (label, actual, wanted) => {
    if (actual !== wanted) drift.push(`${label}: ${JSON.stringify(actual)} != ${JSON.stringify(wanted)}`);
  };
  const key = `node_modules/${SDK_PIN.name}`;
  expect(
    'package.json dependency',
    readJson(join(root, 'package.json')).dependencies?.[SDK_PIN.name],
    SDK_PIN.version,
  );
  const locked = readJson(join(root, 'package-lock.json')).packages?.[key] ?? {};
  expect('package-lock.json version', locked.version, SDK_PIN.version);
  expect('package-lock.json integrity', locked.integrity, SDK_PIN.integrity);
  // .npmrc omits registry URLs from the lock; any resolved URL present must be the public registry.
  if (locked.resolved !== undefined && !String(locked.resolved).startsWith('https://registry.npmjs.org/'))
    drift.push(`package-lock.json resolved: ${JSON.stringify(locked.resolved)} is not the public registry`);
  if (installed) {
    const manifestPath = join(root, key, 'package.json');
    if (!existsSync(manifestPath)) drift.push(`${key} is not installed (run npm ci)`);
    else {
      const manifest = readJson(manifestPath);
      expect('installed name', manifest.name, SDK_PIN.name);
      expect('installed version', manifest.version, SDK_PIN.version);
    }
    // npm ci records the integrity it verified while extracting the downloaded tarball.
    const hidden = join(root, 'node_modules/.package-lock.json');
    expect(
      'installed integrity',
      existsSync(hidden) ? readJson(hidden).packages?.[key]?.integrity : undefined,
      SDK_PIN.integrity,
    );
  }
  return drift;
}

/** The public registry's dist.integrity for the pinned version (undefined when unavailable). */
export function registryIntegrity() {
  try {
    return JSON.parse(
      execFileSync(
        'npm',
        ['view', `${SDK_PIN.name}@${SDK_PIN.version}`, 'dist.integrity', '--json', '--prefer-online'],
        { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] },
      ),
    );
  } catch {
    return undefined;
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
  const drift = sdkDrift(root);
  if (process.argv.includes('--registry')) {
    const served = registryIntegrity();
    if (served !== SDK_PIN.integrity)
      drift.push(
        `registry dist.integrity: ${JSON.stringify(served)} != ${JSON.stringify(SDK_PIN.integrity)}`,
      );
  }
  if (drift.length) {
    console.error(
      `registry-sdk: ${SDK_PIN.name} does not match release/sdk-candidate.json:\n  ${drift.join('\n  ')}`,
    );
    process.exitCode = 1;
  } else {
    console.log(
      `registry-sdk: ${SDK_PIN.name}@${SDK_PIN.version} ${SDK_PIN.integrity} (pin, lock, installed tree${process.argv.includes('--registry') ? ', registry' : ''})`,
    );
  }
}
