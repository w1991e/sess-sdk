import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { lstat, readFile, readlink } from 'node:fs/promises';
import { join } from 'node:path';

const forbidden = [
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/,
  /sess_(?:sk|mg|tk|mk)_[A-Za-z0-9_-]{30,}/,
  /whsec_[A-Za-z0-9+/]{43}=/,
  /(?:github_pat_|gh[pousr]_|npm_)[A-Za-z0-9_]{30,}/,
  /https?:\/\/[^\s"'<>]+\/s\/[A-Za-z0-9_-]{43}(?:[\s"'<>]|$)/,
  // Short human links: /n/ then exactly 22 base64url characters (128 bits).
  /https?:\/\/[^\s"'<>]+\/n\/[A-Za-z0-9_-]{22}(?:[^A-Za-z0-9_-]|$)/,
  /(?:from\s*|import\s*(?:\(\s*)?|require\s*\(\s*)['"]@sess\/(?:core|db|renderer|security)(?:\/[^'"]*)?['"]/,
];
// Only the exact pinned public-contract example may match the SESS rule.
const publicContractExample = 'e965759b8e4ca58c60d152b31ab2fd27985c053ef7c818c7459e7dc260dd812d';
const root = process.cwd();
let files;
try {
  files = execFileSync('git', ['ls-files', '--cached', '-z'], {
    cwd: root,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  })
    .split('\0')
    .filter(Boolean);
} catch {
  throw new Error('Tracked-source boundary check needs an actual Git checkout.');
}
if (!files.length) throw new Error('Tracked-source boundary check cannot accept an empty source tree.');
for (const file of files) {
  const absolute = join(root, file);
  const stat = await lstat(absolute);
  // Scan a tracked symlink's literal target; never follow it into ignored local credentials.
  if (!stat.isFile() && !stat.isSymbolicLink())
    throw new Error(`Unsupported tracked content needs separate review: ${file}`);
  const text = stat.isSymbolicLink() ? await readlink(absolute) : await readFile(absolute, 'utf8');
  for (const pattern of forbidden) {
    for (const [match] of text.matchAll(new RegExp(pattern.source, 'g'))) {
      const reviewedExample =
        file === 'contract/openapi.json' &&
        createHash('sha256').update(match).digest('hex') === publicContractExample;
      if (!reviewedExample) throw new Error(`Potential secret/private dependency requires review: ${file}`);
    }
  }
}
console.log(
  `Fast credential/private-import boundary checked in ${files.length} tracked files; maintained source/history scanning runs in its separate CI job.`,
);
