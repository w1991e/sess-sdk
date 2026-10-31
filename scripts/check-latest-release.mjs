// Readback for a stable release of all four packages (owner decision 2026-10-31): after the owner
// approves each staged release, `latest` on @sess.si/sdk, /mcp, /openclaw and /create-agent shows
// the expected version, that version carries the Apache-2.0 license field, and its tarball holds a
// LICENSE file. Read-only: npm view and npm pack --dry-run, no publish, no token.
// Usage: node scripts/check-latest-release.mjs 0.1.0   Self-test: node --test scripts/test-check-latest-release.mjs
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

export const PACKAGES = ['@sess.si/sdk', '@sess.si/mcp', '@sess.si/openclaw', '@sess.si/create-agent'];
const STABLE = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;

/**
 * Pure check of one package's registry facts.
 * @param {{ name: string, expected: string, tags: Record<string, string> | undefined,
 *   license: string | undefined, files: string[] }} facts
 * @returns {string[]} problems (empty when the package is released as expected)
 */
export function latestProblems({ name, expected, tags, license, files }) {
  const problems = [];
  if (!STABLE.test(expected)) problems.push(`${name}: ${expected} is not a stable version`);
  if (tags?.latest !== expected)
    problems.push(`${name}: latest is ${tags?.latest ?? 'missing'}, expected ${expected}`);
  if (license !== 'Apache-2.0') problems.push(`${name}@${expected}: license is ${license ?? 'missing'}`);
  if (!files.includes('LICENSE')) problems.push(`${name}@${expected}: no LICENSE file in the tarball`);
  return problems;
}

function gather(name, expected) {
  const npm = (args) => execFileSync('npm', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  const tags = JSON.parse(npm(['view', name, 'dist-tags', '--json', '--prefer-online']));
  let license;
  let files = [];
  try {
    license =
      JSON.parse(npm(['view', `${name}@${expected}`, 'license', '--json', '--prefer-online']) || 'null') ??
      undefined;
    files = JSON.parse(
      npm(['pack', `${name}@${expected}`, '--dry-run', '--json', '--ignore-scripts']),
    )[0].files.map((f) => f.path);
  } catch {
    // The version is not published: latestProblems reports it through the latest tag.
  }
  return { name, expected, tags, license, files };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const expected = process.argv[2];
  // Refuse anything but X.Y.Z before any npm call: a git or URL spec would make npm fetch it.
  if (!expected || !STABLE.test(expected)) {
    console.error('usage: node scripts/check-latest-release.mjs <X.Y.Z>');
    process.exit(2);
  }
  const problems = PACKAGES.flatMap((name) => latestProblems(gather(name, expected)));
  if (problems.length) {
    for (const p of problems) console.error(p);
    process.exit(1);
  }
  console.log(`latest is ${expected} on ${PACKAGES.join(', ')}, each Apache-2.0 with its LICENSE file.`);
}
