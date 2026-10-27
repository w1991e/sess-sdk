#!/usr/bin/env node
// `npm create @sess.si/agent@next <dir>`: writes the starter agent into a new or empty directory inside
// the current one, then installs it and runs it once. It never overwrites a file or follows a symlink.
//
// The API key comes from SESS_API_KEY or, in a terminal, from a hidden prompt. It is never taken from
// the command line, never written anywhere, and only the agent's own process receives it. Without a
// terminal and without the values, or with --no-run, it prints the next steps instead.
import { spawn } from 'node:child_process';
import { lstatSync, mkdirSync, readdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { constants } from 'node:os';
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isContact } from './template/weather.mjs';

const TEMPLATE = join(dirname(fileURLToPath(import.meta.url)), 'template');
// Every template file is written. Dotfiles are stored as `_name` so that npm packs them.
const FILES = readdirSync(TEMPLATE)
  .sort()
  .map((name) => [name, name.startsWith('_') ? `.${name.slice(1)}` : name]);
const USAGE = 'Usage: npm create @sess.si/agent@next <directory> [-- --no-run]';

function refuse(message) {
  console.error(`${message}\nNothing was written.`);
  process.exit(1);
}

const args = process.argv.slice(2);
if (args.includes('--help') || args.includes('-h')) {
  console.log(USAGE);
  process.exit(0);
}
const noRun = args.includes('--no-run');
const positional = args.filter((a) => a !== '--no-run');
if (positional.length > 1 || positional.some((a) => a.startsWith('-'))) refuse(USAGE);
const target = positional[0] ?? 'sess-agent';
if (!target || /[\u0000-\u001f\u007f]/.test(target)) refuse('Choose a plain directory name.');
// An API key is never an argument, not even as the directory name: refuse it before anything is
// written or echoed, without repeating it.
if (/sess_(sk|mg)_[A-Za-z0-9_-]{43}/.test(target))
  refuse('That looks like an API key. Never pass it on the command line; choose a directory name.');

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
const NEXT = `Next:
${rel ? `  cd ${cd}\n` : ''}  npm install --ignore-scripts

  read -rs SESS_API_KEY && export SESS_API_KEY     # run this line by itself, then paste your key from https://app.sess.si

  export SESS_DEMO_CONTACT=https://example.com/your-project   # your project URL or team email
  npm start

Your key stays in your environment. This tool never stores it.`;
console.log(`Created ${rel || 'the agent here'}: a weekend planner on real weather.`);

let key = process.env.SESS_API_KEY ?? '';
let contact = process.env.SESS_DEMO_CONTACT?.trim() ?? '';
if (noRun || ((key === '' || !isContact(contact)) && !process.stdin.isTTY)) {
  console.log(`\n${NEXT}`);
  process.exit(0);
}

const stopped = () => {
  console.log(`Stopped. Your agent is in ${rel || 'this directory'}.\n\n${NEXT}`);
  process.exit(130);
};
while (key === '')
  key = (await ask('Paste your Sess API key from https://app.sess.si (hidden): ', true))?.trim() ?? stopped();
if (!isContact(contact)) {
  console.log('The weather services ask for a project URL or team email to contact.');
  for (;;) {
    contact = (await ask('Your project URL or team email: ', false))?.trim() ?? stopped();
    if (isContact(contact)) break;
    console.log('Use a URL starting with https:// or an email address.');
  }
}

console.log('Installing the agent…');
// The install never receives the key or the contact, even when they came from the environment.
const installEnv = { ...process.env };
delete installEnv.SESS_API_KEY;
delete installEnv.SESS_DEMO_CONTACT;
const install = await run(['install', '--ignore-scripts', '--no-audit', '--no-fund'], installEnv, 'pipe');
if (install.code !== 0) {
  process.stderr.write(install.output);
  console.error(`The install did not finish. The output above says why.\n\n${NEXT}`);
  process.exit(install.code);
}
// Only the agent's process receives the key, through its environment.
const agent = await run(['start', '--silent'], {
  ...process.env,
  SESS_API_KEY: key,
  SESS_DEMO_CONTACT: contact,
});
process.exit(agent.code);

/**
 * Asks one question on the terminal and resolves with the line, or null on Ctrl-C, Ctrl-D or a closed
 * input. Raw mode turns the terminal's echo off; a hidden answer is never echoed.
 */
function ask(question, hidden) {
  const input = process.stdin;
  return new Promise((done) => {
    let value = '';
    const finish = (result) => {
      input.off('data', onData).off('end', onEnd);
      input.setRawMode(false);
      input.pause();
      process.stdout.write('\n');
      done(result);
    };
    const onEnd = () => finish(null);
    const onData = (chunk) => {
      // Terminal escape sequences (arrow keys and the like) are ignored, not typed.
      for (const ch of chunk.replace(/\x1b\[[0-9;?]*[ -/]*[@-~]|\x1b./g, '')) {
        if (ch === '\r' || ch === '\n') return finish(value);
        if (ch === '\u0003' || ch === '\u0004') return finish(null);
        if (ch === '\u007f' || ch === '\b') {
          if (value === '') continue;
          value = [...value].slice(0, -1).join('');
          if (!hidden) process.stdout.write('\b \b');
        } else if (ch >= ' ') {
          value += ch;
          if (!hidden) process.stdout.write(ch);
        }
      }
    };
    input.setRawMode(true);
    input.setEncoding('utf8');
    input.on('data', onData).on('end', onEnd);
    process.stdout.write(question);
    input.resume();
  });
}

/** Runs npm in the new directory; resolves with its exit code (128 + n for signal n). */
function run(argv, env, stdout = 'inherit') {
  // The npm that ran `npm create`, when it is npm itself; otherwise npm from PATH.
  const cli = process.env.npm_execpath;
  const [file, list, shell] = /(?:^|[\\/])npm-cli\.[cm]?js$/.test(cli ?? '')
    ? [process.execPath, [cli, ...argv], false]
    : ['npm', argv, process.platform === 'win32'];
  const child = spawn(file, list, { cwd: dir, env, shell, stdio: ['ignore', stdout, stdout] });
  let output = '';
  if (stdout === 'pipe')
    for (const stream of [child.stdout, child.stderr])
      stream.setEncoding('utf8').on('data', (chunk) => (output += chunk));
  // Ctrl-C reaches the child too: wait for it and report its outcome.
  const ignore = () => {};
  const forward = () => child.kill('SIGTERM');
  process.on('SIGINT', ignore).on('SIGTERM', forward);
  return new Promise((done) => {
    let settled = false;
    const settle = (code, signal) => {
      if (settled) return;
      settled = true;
      process.off('SIGINT', ignore).off('SIGTERM', forward);
      done({ code: code ?? 128 + (constants.signals[signal] ?? 0), output });
    };
    child.on('error', (error) => {
      output += `${error.message}\n`;
      settle(1);
    });
    child.on('exit', settle);
  });
}
