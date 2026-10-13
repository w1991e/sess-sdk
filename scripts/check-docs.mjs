import { execFileSync } from 'node:child_process';
import { access, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';

const files = [
  'README.md',
  'CONTRIBUTING.md',
  'SECURITY.md',
  ...(await readdir('docs'))
    .filter((f) => f.endsWith('.md'))
    .sort()
    .map((f) => `docs/${f}`),
];
const temporary = '.artifacts/docs';
await mkdir(temporary, { recursive: true });
const snippets = [];
try {
  for (const file of files) {
    const text = await readFile(file, 'utf8');
    for (const match of text.matchAll(/\[[^\]]*\]\(([^)]+)\)/g)) {
      const link = match[1].split('#')[0];
      if (!link || /^(https?:|mailto:)/.test(link)) continue;
      await access(resolve(dirname(file), link));
    }
    for (const match of text.matchAll(/```(?:ts|typescript)\r?\n([\s\S]*?)```/g)) {
      const output = join(temporary, `${file.replace(/[^A-Za-z0-9.-]/g, '-')}-${snippets.length}.mts`);
      await writeFile(output, match[1]);
      snippets.push(output);
    }
  }
  if (!snippets.length) throw new Error('No documented TypeScript example was checked.');
  execFileSync(
    process.execPath,
    [
      'node_modules/typescript/bin/tsc',
      '--noEmit',
      '--strict',
      '--target',
      'ES2022',
      '--module',
      'NodeNext',
      '--moduleResolution',
      'NodeNext',
      '--lib',
      'ES2024,DOM,DOM.Iterable',
      '--types',
      'node',
      ...snippets,
    ],
    { stdio: 'inherit' },
  );
  console.log(
    `Documentation verified: ${files.length} documents, local links and ${snippets.length} TypeScript code fences. Examples also execute in tests.`,
  );
} finally {
  await rm(temporary, { recursive: true, force: true });
}
