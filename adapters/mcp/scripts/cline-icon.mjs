#!/usr/bin/env node
// Regenerates Cline's 400x400 listing icon (listing.json providers.cline.icon) from the Sess mark's
// vector master, with the Sess logos script itself: w1991e/sess packages/design-tokens/scripts/logos.ts
// rasterizes the filled mark (DOCS/SESS_LOGOS/SESS_CORE_TRACED.svg) on the solid tile with IEEE
// arithmetic and a fixed zlib level, so the same master gives the same bytes. icon-400 is the same
// tile, mark scale and padding as icon-512 and icon-192 (src/icons.ts ICON_RASTERS); nothing is
// resized or drawn by hand.
//
//   node scripts/cline-icon.mjs write <w1991e/sess checkout>   write the PNG
//   node scripts/cline-icon.mjs check <w1991e/sess checkout>   exit 1 unless the committed PNG
//                                                              equals a fresh generation
//
// It needs a Node that runs TypeScript files directly (22.18 or later). npm run check:listing
// checks the committed PNG's IHDR size and SHA-256 without a Sess checkout.
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { pngSize } from './listing.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const ICON_DIR = 'packages/design-tokens/icons';
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');

async function main(mode, sessRoot) {
  if ((mode !== 'write' && mode !== 'check') || !sessRoot)
    throw new Error('usage: node scripts/cline-icon.mjs write|check <w1991e/sess checkout>');
  const sess = resolve(sessRoot);
  const listing = JSON.parse(readFileSync(join(root, 'listing.json'), 'utf8'));
  const icon = listing.providers.cline.icon;
  const generator = join(sess, icon.source.generator);
  if (!existsSync(generator)) throw new Error(`${generator} is missing: name a w1991e/sess checkout`);
  const { generateLogoFiles } = await import(pathToFileURL(generator).href);
  const fresh = generateLogoFiles(sess);
  const problems = [];
  const bytes = fresh.get(`${ICON_DIR}/${icon.source.file}`);
  if (!bytes) throw new Error(`${icon.source.generator} generates no ${icon.source.file}`);
  // The Sess checkout's committed copy must be what its generator draws (logos.ts --check for this file).
  if (!readFileSync(join(sess, ICON_DIR, icon.source.file)).equals(bytes))
    problems.push(`${ICON_DIR}/${icon.source.file} in ${sess} is not a fresh generation`);
  // The same pipeline as the committed 512 and 192: their fresh bytes equal this repository's copies.
  for (const file of listing.icons.files) {
    const name = file.path.split('/').pop();
    const committed = readFileSync(join(root, file.path));
    if (!fresh.get(`${ICON_DIR}/${name}`)?.equals(committed))
      problems.push(`${name}: ${sess} no longer generates the committed ${file.path}`);
  }
  const size = pngSize(bytes);
  if (size?.width !== icon.size || size?.height !== icon.size)
    problems.push(
      `generated ${icon.source.file} is ${size?.width}x${size?.height}, not ${icon.size}x${icon.size}`,
    );
  if (sha256(bytes) !== icon.sha256)
    problems.push(`generated ${icon.source.file} does not match providers.cline.icon.sha256`);
  const target = join(root, icon.path);
  if (mode === 'write' && problems.length === 0) {
    writeFileSync(target, bytes);
    console.log(`wrote ${icon.path} (${size.width}x${size.height}, sha256 ${sha256(bytes)})`);
  } else if (mode === 'check' && !(existsSync(target) && readFileSync(target).equals(bytes)))
    problems.push(`${icon.path} is not a fresh generation; run node scripts/cline-icon.mjs write <sess>`);
  if (problems.length) {
    console.error(`cline icon:\n${problems.map((p) => `- ${p}`).join('\n')}`);
    process.exitCode = 1;
  } else if (mode === 'check') console.log(`${icon.path} equals a fresh generation from ${sess}`);
}

main(process.argv[2], process.argv[3]).catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
