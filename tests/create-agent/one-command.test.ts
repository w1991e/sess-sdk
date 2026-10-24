// The one command: `npm create @sess.si/agent@next <dir>` scaffolds, installs, asks for what is missing
// (the API key hidden), runs the agent once and exits with the agent's exit code. npm is faked
// (create-agent/test/fake-npm/npm-cli.mjs, reached through npm_execpath) and the terminal is faked
// (create-agent/test/fake-tty.mjs) or, where python3 is available, a real pseudo-terminal.
import { describe, expect, it } from 'vitest';
import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { GENERATED, INITIALIZER, ROOT, scratch } from './helpers.js';

const FAKE_NPM = join(ROOT, 'create-agent', 'test', 'fake-npm', 'npm-cli.mjs');
const FAKE_TTY = join(ROOT, 'create-agent', 'test', 'fake-tty.mjs');
// Synthetic values only; the key is distinctive so any leak is found by a plain search.
const KEY = 'qx7-test-only-one-command-key';
const CONTACT = 'https://example.com/sess-one-command-tests';
const KEY_PROMPT = 'Paste your Sess API key from https://app.sess.si (hidden): ';
const CONTACT_PROMPT = 'Your project URL or team email: ';
const sha256 = (text: string) => createHash('sha256').update(text).digest('hex');

interface NpmCall {
  argv: string[];
  cwd: string;
  keySha256: string | null;
  contact: string | null;
}
interface Options {
  args?: string[];
  env?: Record<string, string>;
  /** Make stdin a (fake) terminal. */
  tty?: boolean;
  /** Each [text to wait for on stdout, keys to type]. */
  typing?: [string, string][];
  install?: number;
  start?: number | 'SIGTERM';
}

/** Runs the initializer in a fresh directory with fake npm; resolves with its output and npm calls. */
function oneCommand(options: Options = {}) {
  const cwd = scratch('sess-one-command-');
  const records = scratch('sess-one-command-records-');
  const npmRecord = join(records, 'npm.jsonl');
  const ttyRecord = join(records, 'tty.json');
  const env: Record<string, string> = {
    PATH: process.env.PATH ?? '',
    npm_execpath: FAKE_NPM,
    FAKE_NPM: JSON.stringify({ record: npmRecord, install: options.install, start: options.start }),
    FAKE_TTY_RECORD: ttyRecord,
    ...options.env,
  };
  const preload = options.tty ? ['--import', FAKE_TTY] : [];
  const child = spawn(process.execPath, [...preload, INITIALIZER, ...(options.args ?? ['my-agent'])], {
    cwd,
    env,
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  let stdout = '';
  let stderr = '';
  let from = 0;
  const typing = [...(options.typing ?? [])];
  child.stdout.setEncoding('utf8').on('data', (chunk: string) => {
    stdout += chunk;
    // Type each answer only once its prompt is on screen.
    while (typing.length) {
      const at = stdout.indexOf(typing[0]![0], from);
      if (at === -1) break;
      from = at + typing[0]![0].length;
      child.stdin.write(typing.shift()![1]);
    }
  });
  child.stderr.setEncoding('utf8').on('data', (chunk: string) => (stderr += chunk));
  if (!options.tty) child.stdin.end();
  const timer = setTimeout(() => child.kill('SIGKILL'), 20_000);
  return new Promise<{
    code: number | null;
    stdout: string;
    stderr: string;
    cwd: string;
    calls: NpmCall[];
    tty: string[];
  }>((done) =>
    child.on('exit', (code) => {
      clearTimeout(timer);
      const calls = existsSync(npmRecord)
        ? readFileSync(npmRecord, 'utf8')
            .trim()
            .split('\n')
            .map((line) => JSON.parse(line) as NpmCall)
        : [];
      const tty = existsSync(ttyRecord) ? (JSON.parse(readFileSync(ttyRecord, 'utf8')) as string[]) : [];
      done({ code, stdout, stderr, cwd, calls, tty });
    }),
  );
}

/** Every file under `dir`, recursively. */
function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? files(path) : [path];
  });
}
const NEXT_STEPS = ['cd my-agent', 'npm install --ignore-scripts', 'read -rs SESS_API_KEY', 'npm start'];

describe('@sess.si/create-agent: the one command', { timeout: 30_000 }, () => {
  it('with both values in the environment: scaffolds, installs, runs once, no prompts', async () => {
    const run = await oneCommand({ env: { SESS_API_KEY: KEY, SESS_DEMO_CONTACT: CONTACT } });
    expect(run.code).toBe(0);
    expect(run.stderr).toBe('');
    const app = join(run.cwd, 'my-agent');
    expect(readdirSync(app).sort()).toEqual(GENERATED);
    expect(run.calls.map((call) => call.argv)).toEqual([
      ['install', '--ignore-scripts', '--no-audit', '--no-fund'],
      ['start', '--silent'],
    ]);
    expect(run.calls.every((call) => call.cwd === app)).toBe(true);
    expect(run.calls[1]).toMatchObject({ keySha256: sha256(KEY), contact: CONTACT });
    // ASTRA-SDK-86-01: the install never receives the key or the contact from the environment.
    expect(run.calls[0]).toMatchObject({ keySha256: null, contact: null });
    expect(run.stdout).not.toContain('Paste your Sess API key');
    expect(run.stdout).not.toContain('Next:');
    // One progress line before the install, then the agent's own output with the link.
    const lines = run.stdout.split('\n');
    expect(lines.slice(0, 2)).toEqual([
      'Created my-agent: a weekend planner on real weather.',
      'Installing the agent…',
    ]);
    expect(run.stdout).toContain('Anyone with it can answer:\n  https://sess.si/s/fake');
    expect(run.stdout).not.toContain('added 4 packages'); // install output is shown only on failure
    expect(`${run.stdout}${run.stderr}`).not.toContain(KEY);
  });

  it('ASTRA-SDK-86-02: an API key as the only argument is refused before anything is written or echoed', async () => {
    const canonical = `sess_sk_${'Q7x-'.repeat(11).slice(0, 43)}`;
    const run = await oneCommand({ args: [canonical], env: { SESS_DEMO_CONTACT: CONTACT } });
    expect(run.code).toBe(1);
    expect(readdirSync(run.cwd)).toEqual([]);
    expect(run.calls).toEqual([]);
    expect(`${run.stdout}${run.stderr}`).not.toContain(canonical);
    expect(run.stderr).toContain('That looks like an API key.');
  });

  it('asks for the key with hidden input and passes it only to the agent, through its environment', async () => {
    // A backspace is honoured: the key typed is KEY.
    const run = await oneCommand({
      tty: true,
      typing: [
        [KEY_PROMPT, `${KEY}x\u007f\r`],
        [CONTACT_PROMPT, `${CONTACT}\r`],
      ],
    });
    expect(run.code).toBe(0);
    expect(run.stderr).toBe('');
    // Raw mode (no echo) was on whenever anything was typed, and was switched off again.
    expect(run.tty.filter((entry) => entry.startsWith('typed:'))).toEqual(
      expect.arrayContaining(['typed:raw=true']),
    );
    expect(run.tty).not.toContain('typed:raw=false');
    expect(run.tty.at(-1)).toBe('raw:false');
    // The key never appears in output, arguments or any file; the install never receives it.
    expect(run.stdout).toContain(KEY_PROMPT);
    expect(run.stdout).toContain('The weather services ask for a project URL or team email to contact.');
    expect(run.stdout).toContain(CONTACT); // the contact is visible input
    expect(`${run.stdout}${run.stderr}`).not.toContain(KEY);
    expect(`${run.stdout}${run.stderr}`).not.toContain(`${KEY.slice(0, 12)}`);
    const [install, start] = run.calls;
    expect(install).toMatchObject({ keySha256: null, contact: null });
    expect(start).toMatchObject({ keySha256: sha256(KEY), contact: CONTACT });
    expect(run.calls.flatMap((call) => call.argv).join(' ')).not.toContain(KEY);
    const written = files(run.cwd);
    expect(written.map((path) => path.slice(run.cwd.length + 1)).sort()).toEqual(
      GENERATED.map((name) => `my-agent/${name}`),
    );
    for (const path of written) expect(readFileSync(path, 'utf8')).not.toContain(KEY);
  });

  it('asks only for what is missing, and asks again for a contact that is not a URL or email', async () => {
    const run = await oneCommand({
      tty: true,
      env: { SESS_API_KEY: KEY },
      typing: [
        [CONTACT_PROMPT, 'me\r'],
        [CONTACT_PROMPT, `${CONTACT}\r`],
      ],
    });
    expect(run.code).toBe(0);
    expect(run.stdout).not.toContain(KEY_PROMPT);
    expect(run.stdout).toContain('Use a URL starting with https:// or an email address.');
    expect(run.calls[1]).toMatchObject({ keySha256: sha256(KEY), contact: CONTACT });
  });

  it('without a terminal and without the values: scaffolds, prints the next steps and exits 0', async () => {
    const run = await oneCommand({ env: { SESS_API_KEY: KEY } });
    expect(run.code).toBe(0);
    expect(run.stderr).toBe('');
    expect(run.calls).toEqual([]);
    expect(readdirSync(join(run.cwd, 'my-agent')).sort()).toEqual(GENERATED);
    for (const step of NEXT_STEPS) expect(run.stdout).toContain(step);
    expect(run.stdout).not.toContain('Paste');
  });

  it('--no-run keeps scaffold-and-next-steps, even with the values and a terminal', async () => {
    for (const tty of [false, true]) {
      const run = await oneCommand({
        tty,
        args: ['my-agent', '--no-run'],
        env: { SESS_API_KEY: KEY, SESS_DEMO_CONTACT: CONTACT },
      });
      expect(run.code).toBe(0);
      expect(run.calls).toEqual([]);
      expect(run.tty).toEqual([]);
      for (const step of NEXT_STEPS) expect(run.stdout).toContain(step);
    }
  });

  it("exits with the agent's exit code, including a signal", async () => {
    const env = { SESS_API_KEY: KEY, SESS_DEMO_CONTACT: CONTACT };
    expect((await oneCommand({ env, start: 3 })).code).toBe(3);
    expect((await oneCommand({ env, start: 'SIGTERM' })).code).toBe(143);
  });

  it('a failed install shows its output and the next steps, runs nothing and exits with its code', async () => {
    const run = await oneCommand({ env: { SESS_API_KEY: KEY, SESS_DEMO_CONTACT: CONTACT }, install: 7 });
    expect(run.code).toBe(7);
    expect(run.calls.map((call) => call.argv[0])).toEqual(['install']);
    expect(run.stderr).toContain('npm error code E404 (fake)');
    expect(run.stderr).toContain('The install did not finish. The output above says why.');
    for (const step of NEXT_STEPS) expect(run.stderr).toContain(step);
    expect(readdirSync(join(run.cwd, 'my-agent')).sort()).toEqual(GENERATED);
  });

  it('Ctrl-C or Ctrl-D at a prompt stops cleanly and leaves the scaffold in place', async () => {
    for (const [typing, label] of [
      [[[KEY_PROMPT, `${KEY.slice(0, 5)}\u0003`]], 'Ctrl-C at the key'],
      [
        [
          [KEY_PROMPT, `${KEY}\r`],
          [CONTACT_PROMPT, 'https://exa\u0003'],
        ],
        'Ctrl-C at the contact',
      ],
      [[[KEY_PROMPT, '\u0004']], 'Ctrl-D at the key'],
    ] as [[string, string][], string][]) {
      const run = await oneCommand({ tty: true, typing });
      expect(run.code, label).toBe(130);
      expect(run.calls, label).toEqual([]);
      expect(run.stdout, label).toContain('Stopped. Your agent is in my-agent.');
      for (const step of NEXT_STEPS) expect(run.stdout, label).toContain(step);
      expect(run.tty.at(-1), label).toBe('raw:false');
      expect(readdirSync(join(run.cwd, 'my-agent')).sort(), label).toEqual(GENERATED);
      expect(`${run.stdout}${run.stderr}`, label).not.toContain(KEY.slice(0, 5));
    }
  });

  it('never takes the key from the command line', async () => {
    for (const args of [
      ['my-agent', '--api-key', KEY],
      ['my-agent', `--key=${KEY}`],
      ['my-agent', KEY],
    ]) {
      const run = await oneCommand({ args });
      expect(run.code).toBe(1);
      expect(run.stderr).toContain('Usage: npm create @sess.si/agent@next <directory>');
      expect(run.calls).toEqual([]);
      expect(readdirSync(run.cwd)).toEqual([]);
    }
  });

  // A real pseudo-terminal: the terminal's own echo is off while the key is typed, so the key
  // never reaches the screen.
  const python = spawnSync('python3', ['-c', 'import pty'], { stdio: 'ignore' }).status === 0;
  it.skipIf(!python || process.platform === 'win32')(
    'in a real terminal the key is not echoed and the agent runs',
    () => {
      const cwd = scratch('sess-one-command-pty-');
      const records = scratch('sess-one-command-pty-records-');
      const npmRecord = join(records, 'npm.jsonl');
      const driver = `
import json, os, pty, sys
argv, steps = json.loads(sys.argv[1]), json.loads(sys.argv[2])
pid, fd = pty.fork()
if pid == 0:
    os.execv(argv[0], argv)
out, pos = b'', 0
def more():
    global out
    try:
        chunk = os.read(fd, 4096)
    except OSError:
        return False
    out += chunk
    return bool(chunk)
for wait, send in steps:
    while out.find(wait.encode(), pos) == -1:
        if not more():
            break
    pos = out.find(wait.encode(), pos) + len(wait)
    os.write(fd, send.encode())
while more():
    pass
_, status = os.waitpid(pid, 0)
print(json.dumps({'code': os.waitstatus_to_exitcode(status), 'output': out.decode('utf8', 'replace')}))
`;
      const result = spawnSync(
        'python3',
        [
          '-c',
          driver,
          JSON.stringify([process.execPath, INITIALIZER, 'my-agent']),
          JSON.stringify([
            [KEY_PROMPT, `${KEY}\r`],
            [CONTACT_PROMPT, `${CONTACT}\r`],
          ]),
        ],
        {
          cwd,
          encoding: 'utf8',
          timeout: 20_000,
          env: {
            PATH: process.env.PATH ?? '',
            npm_execpath: FAKE_NPM,
            FAKE_NPM: JSON.stringify({ record: npmRecord }),
          },
        },
      );
      const { code, output } = JSON.parse(result.stdout) as { code: number; output: string };
      expect(code).toBe(0);
      expect(output).toContain(KEY_PROMPT);
      expect(output).toContain(CONTACT); // visible input is echoed
      expect(output).not.toContain(KEY);
      expect(output).toContain('https://sess.si/s/fake');
      const calls = readFileSync(npmRecord, 'utf8')
        .trim()
        .split('\n')
        .map((line) => JSON.parse(line) as NpmCall);
      expect(calls[1]).toMatchObject({ keySha256: sha256(KEY), contact: CONTACT });
    },
  );
});
