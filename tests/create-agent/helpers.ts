import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = fileURLToPath(new URL('../../', import.meta.url));
export const INITIALIZER = join(ROOT, 'create-agent', 'index.mjs');
export const FAKE_WORLD = join(ROOT, 'create-agent', 'test', 'fake-world.mjs');
export const GENERATED = [
  '.env.example',
  '.gitignore',
  'LICENSE',
  'README.md',
  'agent.mjs',
  'package.json',
  'weather.mjs',
];

export function scratch(prefix: string): string {
  return realpathSync(mkdtempSync(join(realpathSync(tmpdir()), prefix)));
}

/** Runs the initializer CLI as `npm create` would, with no stdin. */
export function initialize(cwd: string, ...args: string[]) {
  const result = spawnSync(process.execPath, [INITIALIZER, ...args], {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { PATH: process.env.PATH ?? '' },
  });
  return { status: result.status, stdout: result.stdout, stderr: result.stderr };
}

export function npm(args: string[], cwd: string): string {
  const cli = process.env.npm_execpath;
  const [file, argv] = cli ? [process.execPath, [cli, ...args]] : ['npm', args];
  return execFileSync(file, argv, {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    shell: !cli && process.platform === 'win32',
  });
}

export interface WorldRecord {
  sess: string[];
  /** The User-Agent header of each Sess API request, in the order of `sess`. */
  userAgents: (string | null)[];
  unauthorized: number;
  creates: number;
  publishes: { ifMatch: string | null; key: string | null; current: string }[];
  completes: number;
  completeChecked: boolean;
  interactions: { title: string; source: { components: Record<string, unknown>[] } }[];
  pollsBeforeAnswer: number[];
  weather: {
    url: string;
    userAgent: string | null;
    accept: string | null;
    ifModifiedSince: string | null;
    redirect: string;
  }[];
  refused: string[];
  status: string | null;
}

export interface WorldOptions {
  answers: Record<string, string>[];
  met?: 'ok' | 'busy' | 'outage' | 'revalidate';
  nws?: 'ok' | 'outage';
  tamper?: number;
  /** Serve link timing with every unanswered read lapsed (Decision 0009 Amendment 10). */
  lapsed?: boolean;
  /** The renderer identity the receipts name, and an extra identity on the signed list. */
  renderer?: string;
  listed?: string;
  env?: Record<string, string | undefined>;
}

export const API_KEY = 'test-only-starter-key';
export const CONTACT = 'https://example.com/sess-starter-tests';

/** Runs the generated agent.mjs in `app` inside the fake world; resolves with its output and record. */
export function runAgent(app: string, record: string, options: WorldOptions) {
  const world = {
    apiKey: API_KEY,
    answers: options.answers,
    met: options.met ?? 'ok',
    nws: options.nws ?? 'ok',
    tamper: options.tamper,
    lapsed: options.lapsed,
    renderer: options.renderer,
    listed: options.listed,
    record,
  };
  const env: Record<string, string> = {
    PATH: process.env.PATH ?? '',
    SESS_API_KEY: API_KEY,
    SESS_DEMO_CONTACT: CONTACT,
    SESS_FAKE_WORLD: JSON.stringify(world),
  };
  for (const [name, value] of Object.entries(options.env ?? {}))
    if (value === undefined) delete env[name];
    else env[name] = value;
  const child = spawn(process.execPath, ['--import', FAKE_WORLD, 'agent.mjs'], {
    cwd: app,
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let stdout = '';
  let stderr = '';
  child.stdout.setEncoding('utf8').on('data', (chunk: string) => (stdout += chunk));
  child.stderr.setEncoding('utf8').on('data', (chunk: string) => (stderr += chunk));
  const timer = setTimeout(() => child.kill('SIGKILL'), 45_000);
  return new Promise<{ code: number | null; stdout: string; stderr: string }>((done) =>
    child.on('exit', (code) => {
      clearTimeout(timer);
      done({ code, stdout, stderr });
    }),
  );
}
