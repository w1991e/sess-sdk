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
/** @type {{ file: string, line: string }[]} */
const shellCommands = [];

/** The first SDK version whose package carries the `sess` command. */
const FIRST_CLI = [0, 1, 0, 5];
/** `0.1.0-rc.N` → [0, 1, 0, N]; anything else → null. */
const rcVersion = (v) => {
  const m = /^(\d+)\.(\d+)\.(\d+)(?:-rc\.(\d+))?$/.exec(v);
  return m ? [Number(m[1]), Number(m[2]), Number(m[3]), m[4] === undefined ? Infinity : Number(m[4])] : null;
};
const atLeast = (a, b) => {
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return a[i] > b[i];
  return true;
};

/**
 * Every documented shell command that fetches `@sess.si/sdk` names what it fetches: a bare name
 * resolves through `latest`, the deprecated placeholder. A command that runs the `sess`
 * executable names an exact version that ships it (a dist-tag may still point at an earlier one).
 */
function checkShellInstalls(commands) {
  const problems = [];
  for (const { file, line } of commands) {
    for (const m of line.matchAll(/@sess\.si\/sdk(?:@([^\s'"]+))?/g)) {
      const spec = m[1];
      if (spec === undefined) {
        problems.push(`${file}: \`${line.trim()}\` installs @sess.si/sdk without a version or tag`);
        continue;
      }
      if (/\bnpx\b/.test(line) && /\bsess\s/.test(line)) {
        const v = rcVersion(spec);
        if (!v || !atLeast(v, FIRST_CLI))
          problems.push(
            `${file}: \`${line.trim()}\` runs the sess command from ${spec}; name an exact version >= 0.1.0-rc.5`,
          );
      }
    }
  }
  if (problems.length) throw new Error(`Documented shell commands:\n${problems.join('\n')}`);
}
try {
  for (const file of files) {
    const text = await readFile(file, 'utf8');
    for (const match of text.matchAll(/\[[^\]]*\]\(([^)]+)\)/g)) {
      const link = match[1].split('#')[0];
      if (!link || /^(https?:|mailto:)/.test(link)) continue;
      await access(resolve(dirname(file), link));
    }
    for (const match of text.matchAll(/```(?:sh|bash|shell|console)\r?\n([\s\S]*?)```/g)) {
      for (const line of match[1].split(/\r?\n/)) shellCommands.push({ file, line });
    }
    for (const match of text.matchAll(/```(?:ts|typescript)\r?\n([\s\S]*?)```/g)) {
      const output = join(temporary, `${file.replace(/[^A-Za-z0-9.-]/g, '-')}-${snippets.length}.mts`);
      await writeFile(output, match[1]);
      snippets.push(output);
    }
  }
  if (!snippets.length) throw new Error('No documented TypeScript example was checked.');
  checkShellInstalls(shellCommands);
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
