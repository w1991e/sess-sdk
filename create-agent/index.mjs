#!/usr/bin/env node
// `npm create @sess.si/agent@next <dir>`: writes the starter agent into a new or empty directory inside
// the current one. It never overwrites a file, follows a symlink, asks for a secret or runs npm.
import { lstatSync, mkdirSync, readdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const TEMPLATE = join(dirname(fileURLToPath(import.meta.url)), 'template');
// Every template file is written. Dotfiles are stored as `_name` so that npm packs them.
const FILES = readdirSync(TEMPLATE)
  .sort()
  .map((name) => [name, name.startsWith('_') ? `.${name.slice(1)}` : name]);
const USAGE = 'Usage: npm create @sess.si/agent@next <directory>';

function refuse(message) {
  console.error(`${message}\nNothing was written.`);
  process.exit(1);
}

const args = process.argv.slice(2);
if (args.includes('--help') || args.includes('-h')) {
  console.log(USAGE);
  process.exit(0);
}
if (args.length > 1 || args.some((a) => a.startsWith('-'))) refuse(USAGE);
const target = args[0] ?? 'sess-agent';
if (!target || /[\u0000-\u001f\u007f]/.test(target)) refuse('Choose a plain directory name.');

const cwd = realpathSync(process.cwd());
const dir = resolve(cwd, target);
const rel = relative(cwd, dir);
if (isAbsolute(rel) || rel === '..' || rel.startsWith(`..${sep}`))
  refuse(`${target} is outside the current directory. Choose a directory inside it.`);

// Every existing part of the path must be a real directory: no symlinks, no files.
let current = cwd;
for (const part of rel.split(sep).filter(Boolean)) {
  current = join(current, part);
  let stat;
  try {
    stat = lstatSync(current);
  } catch {
    break; // the rest is created below
  }
  if (stat.isSymbolicLink()) refuse(`${relative(cwd, current)} is a symlink. Choose another directory.`);
  if (!stat.isDirectory()) refuse(`${relative(cwd, current)} is not a directory. Choose another one.`);
}
let existing = [];
try {
  existing = readdirSync(dir);
} catch {
  // A new directory.
}
if (existing.length) refuse(`${rel || '.'} is not empty. Choose a new or empty directory.`);

mkdirSync(dir, { recursive: true });
if (realpathSync(dir) !== dir) refuse(`${rel || '.'} changed while it was being created.`);
const name =
  basename(dir)
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^[._-]+/, '')
    .slice(0, 100) || 'sess-agent';
for (const [from, to] of FILES) {
  let text = readFileSync(join(TEMPLATE, from), 'utf8');
  if (from === 'package.json') text = text.replace('"name": "sess-agent"', `"name": ${JSON.stringify(name)}`);
  try {
    // 'wx' creates the file and fails if anything, including a symlink, is already there.
    writeFileSync(join(dir, to), text, { flag: 'wx', mode: 0o644 });
  } catch {
    console.error(`Stopped: ${join(rel, to)} appeared while the agent was being written.`);
    process.exit(1);
  }
}

const cd = /^[\w./-]+$/.test(rel) ? rel : `'${rel.replace(/'/g, `'\\''`)}'`;
console.log(`Created ${rel || 'the agent here'}: a weekend planner on real weather.

Next:
${rel ? `  cd ${cd}\n` : ''}  npm install --ignore-scripts
  read -rs SESS_API_KEY && export SESS_API_KEY     # paste your key from https://app.sess.si
  export SESS_DEMO_CONTACT=https://example.com/your-project   # your project URL or team email
  npm start

Your key stays in your environment. This tool never asks for it or stores it.`);
