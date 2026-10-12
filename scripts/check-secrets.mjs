import { createHash } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { join, sep } from 'node:path';

const forbidden = [
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/,
  /sess_(?:sk|mg|tk|mk)_[A-Za-z0-9_-]{30,}/,
  /whsec_[A-Za-z0-9+/]{43}=/,
  /(?:github_pat_|gh[pousr]_|npm_)[A-Za-z0-9_]{30,}/,
  /https?:\/\/[^\s"'<>]+\/s\/[A-Za-z0-9_-]{43}(?:[\s"'<>]|$)/,
  /(?:from\s*|import\s*(?:\(\s*)?|require\s*\(\s*)['"]@sess\/(?:core|db|renderer|security)(?:\/[^'"]*)?['"]/,
];
// The pinned public OpenAPI includes one credential-shaped EXAMPLE value.
// Match only those exact reviewed bytes in that file; no prefix-wide exemption.
const publicContractExample = 'e965759b8e4ca58c60d152b31ab2fd27985c053ef7c818c7459e7dc260dd812d';
let checked = 0;
async function scan(path) {
  for (const entry of await readdir(path, { withFileTypes: true })) {
    if (['node_modules', '.git', '.artifacts', 'tests'].includes(entry.name)) continue;
    const file = join(path, entry.name);
    if (entry.isDirectory()) {
      await scan(file);
      continue;
    }
    if (!/\.(?:ts|js|mjs|cjs|md|json|yml|yaml)$/.test(file)) continue;
    const text = await readFile(file, 'utf8');
    checked++;
    for (const pattern of forbidden) {
      for (const [match] of text.matchAll(new RegExp(pattern.source, 'g'))) {
        const reviewedExample =
          file.split(sep).join('/') === 'contract/openapi.json' &&
          createHash('sha256').update(match).digest('hex') === publicContractExample;
        if (!reviewedExample) throw new Error(`Potential secret/private dependency requires review: ${file}`);
      }
    }
  }
}
await scan('.');
console.log(
  `Secret/private-import boundary checked in ${checked} source, artifact and documentation files. Test keys are public synthetic vectors and excluded from the tarball.`,
);
