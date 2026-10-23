import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import openapiTS, { astToString } from 'openapi-typescript';
import prettier from 'prettier';

// Local reviewed snapshot only. No import/install/build-time remote schema discovery.
const bytes = await readFile('contract/openapi.json');
const lock = JSON.parse(await readFile('contract/contract-lock.json', 'utf8'));
const digest = createHash('sha256').update(bytes).digest('hex');
const gitBlob = createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex');
if (digest !== lock.snapshot_sha256 || gitBlob !== lock.source_git_blob_sha1)
  throw new Error('Contract bytes differ from reviewed lock; inspect and explicitly update provenance.');
const version = JSON.parse(await readFile('node_modules/openapi-typescript/package.json', 'utf8')).version;
if (version !== lock.generator_version) throw new Error('Contract generator version drift.');
const config = await prettier.resolveConfig('src/generated/openapi.ts');
// The snapshot's descriptions cite the runtime repository's internal document paths
// (DOCS/spec/<name>.md). The generated JSDoc ships in the package's .d.ts, so it names the
// specification instead (scripts/check-packed-hygiene.mjs refuses internal paths). Types are unchanged.
const publicDescriptions = (text) =>
  text.replace(/DOCS\/spec\/([a-z0-9-]+)\.md/g, 'the Sess $1 specification');
const generated = await prettier.format(publicDescriptions(astToString(await openapiTS(JSON.parse(bytes)))), {
  ...config,
  parser: 'typescript',
});
if (process.argv.includes('--write')) await writeFile('src/generated/openapi.ts', generated);
else if (generated !== (await readFile('src/generated/openapi.ts', 'utf8')))
  throw new Error('Generated wire types drift; run npm run generate after reviewing the contract.');
console.log(`Contract verified: sha256:${digest}; openapi-typescript ${version}.`);
