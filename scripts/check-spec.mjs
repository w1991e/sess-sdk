// The receipt-v1 and bundle-v1 specifications and the bundle-v1 conformance corpus are verbatim
// copies of the Sess repository's files. This check fails if any copy differs from the SHA-256 of
// the Sess copy recorded in docs/spec/source.json, or if the record itself is incomplete.
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';

const record = JSON.parse(await readFile('docs/spec/source.json', 'utf8'));
const required = [
  'docs/spec/receipt-v1.md',
  'docs/spec/bundle-v1.md',
  'tests/fixtures/bundle/bundle-v1-corpus.json',
];
if (record.repository !== 'https://github.com/w1991e/sess' || !/^[0-9a-f]{40}$/.test(record.commit ?? ''))
  throw new Error('docs/spec/source.json must record the Sess repository and a full source commit.');
const paths = (record.files ?? []).map((f) => f.path);
if (JSON.stringify([...paths].sort()) !== JSON.stringify([...required].sort()))
  throw new Error(`docs/spec/source.json must record exactly: ${required.join(', ')}`);
for (const file of record.files) {
  if (typeof file.source !== 'string' || !/^[0-9a-f]{64}$/.test(file.sha256 ?? ''))
    throw new Error(`docs/spec/source.json: incomplete record for ${file.path}`);
  const actual = createHash('sha256')
    .update(await readFile(file.path))
    .digest('hex');
  if (actual !== file.sha256)
    throw new Error(
      `${file.path} differs from the Sess copy ${file.source} at ${record.commit} (sha256 ${actual}, recorded ${file.sha256}). ` +
        'Copy the file again verbatim from that commit, or record a newer commit and digest.',
    );
}
console.log(
  `Specification copies verified: ${record.files.length} files equal the Sess copies at ${record.commit.slice(0, 12)}.`,
);
