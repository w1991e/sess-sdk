// CANDIDATE-ONLY dependency resolution for the unpublished @sess.si/sdk 0.1.0-rc.3.
//
// Release hold: the adapter declares the real registry dependency "@sess.si/sdk": "0.1.0-rc.3".
// Until that exact version is published, this script serves ONLY that one integrity-pinned
// candidate tarball from a loopback HTTP server for the @sess.si scope, then runs the given npm
// command with `--@sess.si:registry=<loopback>`. Every other package still resolves from the
// public registry. The lockfile omits registry URLs (see .npmrc), so it contains only the
// candidate's real sha512 integrity and needs no edit once the identical bytes are published.
//
// Usage: node scripts/candidate-sdk.mjs <candidate.tgz> -- npm ci --ignore-scripts
//        node scripts/candidate-sdk.mjs <candidate.tgz> --print-env   (serve until killed)
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { gunzipSync } from 'node:zlib';

export const CANDIDATE = Object.freeze({
  name: '@sess.si/sdk',
  version: '0.1.0-rc.3',
  sha256: 'b4d29d8ff01fe8f21d2c7d72e1a8c7ed08ec7cf903efd98715a55a308daa0502',
});

export async function loadCandidate(path) {
  const bytes = await readFile(path);
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  if (sha256 !== CANDIDATE.sha256)
    throw new Error(`Candidate SDK tarball sha256 ${sha256} does not match the pinned ${CANDIDATE.sha256}.`);
  const integrity = `sha512-${createHash('sha512').update(bytes).digest('base64')}`;
  const shasum = createHash('sha1').update(bytes).digest('hex');
  const manifest = JSON.parse(readTarEntry(gunzipSync(bytes), 'package/package.json'));
  if (manifest.name !== CANDIDATE.name || manifest.version !== CANDIDATE.version)
    throw new Error('Candidate SDK tarball identity does not match the pinned name/version.');
  return { bytes, integrity, shasum, manifest };
}

/** Reads one regular file from an uncompressed ustar archive (npm pack output). */
function readTarEntry(tar, wanted) {
  for (let offset = 0; offset + 512 <= tar.length;) {
    const header = tar.subarray(offset, offset + 512);
    if (header.every((b) => b === 0)) break;
    const field = (start, length) =>
      header
        .subarray(start, start + length)
        .toString('utf8')
        .replace(/\0.*$/s, '');
    const name = (field(345, 155) ? `${field(345, 155)}/` : '') + field(0, 100);
    const size = Number.parseInt(field(124, 12).trim() || '0', 8);
    const body = offset + 512;
    if (name === wanted && (field(156, 1) === '0' || field(156, 1) === ''))
      return tar.subarray(body, body + size).toString('utf8');
    offset = body + Math.ceil(size / 512) * 512;
  }
  throw new Error(`Candidate tarball has no ${wanted}.`);
}

export async function serveCandidate(path) {
  const candidate = await loadCandidate(path);
  const tarballPath = '/@sess.si/sdk/-/sdk-0.1.0-rc.3.tgz';
  const server = createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://127.0.0.1');
    let pathname;
    try {
      pathname = decodeURIComponent(url.pathname);
    } catch {
      res.writeHead(400, { 'content-type': 'application/json' });
      res.end('{"error":"malformed path"}');
      return;
    }
    if (req.method === 'GET' && (pathname === '/@sess.si/sdk' || pathname === '/@sess.si%2fsdk')) {
      const { port } = server.address();
      const packument = {
        name: CANDIDATE.name,
        'dist-tags': { next: CANDIDATE.version },
        versions: {
          [CANDIDATE.version]: {
            name: candidate.manifest.name,
            version: candidate.manifest.version,
            license: candidate.manifest.license,
            engines: candidate.manifest.engines,
            dependencies: candidate.manifest.dependencies ?? {},
            dist: {
              integrity: candidate.integrity,
              shasum: candidate.shasum,
              tarball: `http://127.0.0.1:${port}${tarballPath}`,
            },
          },
        },
      };
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify(packument));
      return;
    }
    if (req.method === 'GET' && pathname === tarballPath) {
      res.writeHead(200, { 'content-type': 'application/octet-stream' });
      res.end(candidate.bytes);
      return;
    }
    res.writeHead(404, { 'content-type': 'application/json' });
    res.end('{"error":"candidate registry serves only @sess.si/sdk@0.1.0-rc.3"}');
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const { port } = server.address();
  return { server, registry: `http://127.0.0.1:${port}/`, integrity: candidate.integrity };
}

async function main() {
  const [tarball, separator, ...command] = process.argv.slice(2);
  if (!tarball) throw new Error('Usage: candidate-sdk.mjs <candidate.tgz> -- <command...> | --print-env');
  const served = await serveCandidate(tarball);
  if (separator === '--print-env') {
    console.log(JSON.stringify({ registry: served.registry, integrity: served.integrity }));
    return;
  }
  if (separator !== '--' || command.length === 0) {
    served.server.close();
    throw new Error('Supply a command after --.');
  }
  const [cmd, ...args] = command;
  const child = spawn(cmd, [...args, `--@sess.si:registry=${served.registry}`], { stdio: 'inherit' });
  const code = await new Promise((resolve) => child.on('exit', (c) => resolve(c ?? 1)));
  served.server.close();
  process.exitCode = code;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
