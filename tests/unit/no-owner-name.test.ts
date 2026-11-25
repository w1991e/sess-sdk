// No public package or listing names UppaGo (founder 2026-11-07 05:15Z: the legal entity is
// "Sess Labs Inc."). "Ships publicly" is what `npm pack --dry-run` lists for each published package,
// computed the way the package checks compute it, plus every directory listing (adapters/mcp/listings/**
// and each listing.json, server.json and plugin.json in the repository).
import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';
import { ROOT, npm } from '../create-agent/helpers.js';

const NAME = /uppago/i;

/** The root package (@sess.si/sdk) is scanned only by the exact-exception assertion below. */
const ROOT_PACKAGE = '.';
const PUBLIC_PACKAGES = ['adapters/mcp', 'adapters/openclaw', 'create-agent'];

interface Hit {
  file: string;
  line: number;
  text: string;
}

function walk(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    if (entry.name === 'node_modules' || entry.name === '.git') return [];
    const path = join(dir, entry.name);
    return entry.isDirectory() ? walk(path) : entry.isFile() ? [path] : [];
  });
}

/**
 * The files a package publishes, as repository-relative paths. dist/ is gitignored and only exists
 * once built; where a package publishes dist/ but it is not built here, its src/ (what dist/ is
 * compiled from) stands in, so an unbuilt checkout never scans less than ships.
 */
function packedFiles(pkg: string): string[] {
  const cwd = join(ROOT, pkg);
  const [packed] = JSON.parse(npm(['pack', '--dry-run', '--json', '--ignore-scripts'], cwd)) as {
    files: { path: string }[];
  }[];
  const files = packed!.files.map((file) => join(cwd, file.path));
  const manifest = JSON.parse(readFileSync(join(cwd, 'package.json'), 'utf8')) as { files?: string[] };
  const shipsDist = manifest.files?.some((entry) => /^\.?\/?dist\/?$/.test(entry));
  if (shipsDist && !packed!.files.some((file) => file.path.startsWith('dist/'))) {
    expect(existsSync(join(cwd, 'src')), `${pkg} publishes dist/ but has neither dist/ nor src/`).toBe(true);
    files.push(...walk(join(cwd, 'src')));
  }
  return files.map((file) => relative(ROOT, file));
}

function listingFiles(): string[] {
  const listings = walk(join(ROOT, 'adapters', 'mcp', 'listings'));
  const named = walk(ROOT).filter((file) => /(?:^|[/.])(?:listing|server|plugin)\.json$/.test(file));
  return [...new Set([...listings, ...named])].map((file) => relative(ROOT, file)).sort();
}

function hits(files: string[]): Hit[] {
  return files.flatMap((file) =>
    readFileSync(join(ROOT, file), 'utf8')
      .split(/\r?\n/)
      .flatMap((text, index) => (NAME.test(text) ? [{ file, line: index + 1, text }] : [])),
  );
}

describe('no public package or listing names UppaGo', { timeout: 60_000 }, () => {
  it('the packed files of @sess.si/mcp, @sess.si/openclaw and @sess.si/create-agent (template included)', () => {
    const files = PUBLIC_PACKAGES.flatMap(packedFiles);
    // The scan reaches what each package actually publishes.
    expect(files).toContain('adapters/mcp/NOTICE');
    expect(files).toContain('adapters/openclaw/NOTICE');
    expect(files).toContain('adapters/openclaw/openclaw.plugin.json');
    expect(files).toContain('create-agent/index.mjs');
    expect(files).toContain('create-agent/template/agent.mjs');
    expect(files).toContain('create-agent/template/LICENSE');
    expect(hits(files)).toEqual([]);
  });

  it('the listings: adapters/mcp/listings/**, listing.json, server.json and plugin.json', () => {
    const files = listingFiles();
    expect(files).toContain('adapters/mcp/listing.json');
    expect(files).toContain('adapters/mcp/server.json');
    expect(files).toContain('adapters/mcp/listings/plugin/plugin.json');
    expect(files).toContain('adapters/mcp/listings/plugin/.cursor-plugin/plugin.json');
    expect(hits(files)).toEqual([]);
  });

  // The root package is excluded from the scans above, and only here: its NOTICE still reads
  // "Copyright 2026 UppaGo (Sess)". Changing it changes the packed bytes of the published
  // @sess.si/sdk 0.2.0, so the change waits for the SDK's next version, which the founder chooses
  // (founder 2026-11-07 05:15Z). That line is the one known exception; any other occurrence, in any
  // package or listing, root included, fails here.
  it('the root NOTICE line is the only occurrence among every packed file and listing', () => {
    const files = [
      ...new Set([ROOT_PACKAGE, ...PUBLIC_PACKAGES].flatMap(packedFiles).concat(listingFiles())),
    ];
    expect(files).toContain('NOTICE');
    expect(hits(files)).toEqual([{ file: 'NOTICE', line: 2, text: 'Copyright 2026 UppaGo (Sess)' }]);
  });
});
