import { describe, expect, it } from 'vitest';
import { mkdirSync, readFileSync, readdirSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { GENERATED, INITIALIZER, ROOT, initialize, npm, scratch } from './helpers.js';

const LIFECYCLE = [
  'preinstall',
  'install',
  'postinstall',
  'prepare',
  'prepack',
  'postpack',
  'prepublish',
  'prepublishOnly',
  'publish',
  'postpublish',
  'preuninstall',
  'uninstall',
  'postuninstall',
];
/** The parity script, as CI runs it (optionally against a generated or public starter directory). */
function parity(...args: string[]) {
  const script = join(ROOT, 'create-agent', 'scripts', 'check-parity.mjs');
  const run = spawnSync(process.execPath, [script, ...args], { encoding: 'utf8' });
  return { status: run.status, output: `${run.stdout}${run.stderr}` };
}
const json = (path: string) => JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>;

describe('@sess.si/create-agent initializer', { timeout: 30_000 }, () => {
  it('writes exactly the template file set into a new directory and prints next steps', () => {
    const cwd = scratch('sess-create-new-');
    const run = initialize(cwd, 'My Weekend Agent');
    expect(run.status).toBe(0);
    expect(run.stderr).toBe('');
    const app = join(cwd, 'My Weekend Agent');
    expect(readdirSync(app).sort()).toEqual(GENERATED);
    expect(parity(app)).toEqual({ status: 0, output: expect.stringContaining('agree with the SDK pin') });
    expect(json(join(app, 'package.json')).name).toBe('my-weekend-agent');
    // Next steps, in order: cd, install without scripts, the key from the person's own environment, start.
    const steps = [
      "cd 'My Weekend Agent'",
      'npm install --ignore-scripts',
      'SESS_API_KEY',
      'export SESS_DEMO_CONTACT=https://example.com/your-project ',
      'npm start',
    ];
    const at = steps.map((step) => run.stdout.indexOf(step));
    expect(at.every((index) => index >= 0)).toBe(true);
    expect([...at].sort((a, b) => a - b)).toEqual(at);
    // Every command line is safe to paste: no <placeholder> that a shell reads as a redirection.
    expect(run.stdout).not.toMatch(/^ {2}\S.*<[^>]*>/m);
    // The hidden read stands alone, so pasting the block never feeds the next line into it
    // (founder 2026-10-27 04:05Z item 4); the generated README shows it the same way.
    expect(run.stdout).toContain(
      '\n\n  read -rs SESS_API_KEY && export SESS_API_KEY     # run this line by itself, then paste your key\n\n',
    );
    expect(readFileSync(join(app, 'README.md'), 'utf8')).toContain(
      '\nread -rs SESS_API_KEY && export SESS_API_KEY   # run this line by itself, then paste your key\n\n',
    );
  });

  it('accepts a nested new path and an empty current directory', () => {
    const cwd = scratch('sess-create-nested-');
    expect(initialize(cwd, 'apps/weekend').status).toBe(0);
    expect(readdirSync(join(cwd, 'apps', 'weekend')).sort()).toEqual(GENERATED);
    const empty = scratch('sess-create-here-');
    const here = initialize(empty, '.');
    expect(here.status).toBe(0);
    expect(here.stdout).not.toContain('cd ');
    expect(readdirSync(empty).sort()).toEqual(GENERATED);
  });

  it('refuses a non-empty directory, a file, or the non-empty current directory, and writes nothing', () => {
    const cwd = scratch('sess-create-nonempty-');
    mkdirSync(join(cwd, 'taken'));
    writeFileSync(join(cwd, 'taken', 'notes.txt'), 'keep me');
    writeFileSync(join(cwd, 'file'), 'keep me');
    for (const [target, message] of [
      ['taken', 'is not empty'],
      ['file', 'is not a directory'],
      ['file/sub', 'is not a directory'],
      ['.', 'is not empty'],
    ] as const) {
      const run = initialize(cwd, target);
      expect(run.status).toBe(1);
      expect(run.stderr).toContain(message);
      expect(run.stderr).toContain('Nothing was written.');
    }
    expect(readdirSync(cwd).sort()).toEqual(['file', 'taken']);
    expect(readdirSync(join(cwd, 'taken'))).toEqual(['notes.txt']);
    expect(readFileSync(join(cwd, 'file'), 'utf8')).toBe('keep me');
  });

  it('refuses symlinks anywhere on the path and paths escaping the current directory', () => {
    const outside = scratch('sess-create-outside-');
    const cwd = scratch('sess-create-links-');
    symlinkSync(outside, join(cwd, 'link'), 'junction');
    for (const [target, message] of [
      ['link', 'is a symlink'],
      ['link/agent', 'is a symlink'],
      ['../escape', 'outside the current directory'],
      [join(outside, 'agent'), 'outside the current directory'],
      ['nested/../../escape', 'outside the current directory'],
    ] as const) {
      const run = initialize(cwd, target);
      expect(run.status).toBe(1);
      expect(run.stderr).toContain(message);
    }
    expect(readdirSync(outside)).toEqual([]);
    expect(readdirSync(cwd)).toEqual(['link']);
  });

  it('rejects options and extra arguments instead of guessing', () => {
    const cwd = scratch('sess-create-args-');
    expect(initialize(cwd, '--force', 'x').status).toBe(1);
    expect(initialize(cwd, 'a', 'b').status).toBe(1);
    expect(readdirSync(cwd)).toEqual([]);
    expect(initialize(cwd, '--help').stdout).toContain('npm create @sess.si/agent@next <directory>');
  });

  it('writes only the template and has no lifecycle scripts in either package', () => {
    // Since rc.5 the initializer asks for the key and runs the agent (one-command.test.ts proves the
    // key reaches only the agent's environment). Its one file write is the template copy.
    const source = readFileSync(INITIALIZER, 'utf8');
    expect(
      source.match(/\b(?:writeFileSync|writeFile|appendFileSync|appendFile|createWriteStream)\(/g),
    ).toEqual(['writeFileSync(']);
    const initializer = json(join(ROOT, 'create-agent', 'package.json'));
    const template = json(join(ROOT, 'create-agent', 'template', 'package.json'));
    expect(initializer.scripts).toBeUndefined();
    expect(template.scripts).toEqual({ start: 'node agent.mjs' });
    for (const manifest of [initializer, template])
      for (const hook of LIFECYCLE) expect(Object.keys(manifest.scripts ?? {})).not.toContain(hook);
    expect(template.private).toBe(true);
    expect(parity().status).toBe(0);
  });

  it('parity fails for a starter directory that drifted from the template', () => {
    const cwd = scratch('sess-create-drift-');
    expect(initialize(cwd, 'starter').status).toBe(0);
    const app = join(cwd, 'starter');
    writeFileSync(join(app, 'agent.mjs'), `${readFileSync(join(app, 'agent.mjs'), 'utf8')}// edited\n`);
    writeFileSync(join(app, 'extra.js'), '');
    const run = parity(app);
    expect(run.status).toBe(1);
    expect(run.output).toContain('agent.mjs differs from create-agent/template/agent.mjs');
    expect(run.output).toContain('extra.js is not part of the template');
  });

  it('pins the template to the exact published SDK version in release/sdk-candidate.json', () => {
    const pin = json(join(ROOT, 'release', 'sdk-candidate.json'));
    const template = json(join(ROOT, 'create-agent', 'template', 'package.json'));
    expect(template.dependencies).toEqual({ [String(pin.name)]: pin.version });
  });

  it('packs only the initializer, its README and licence, and the template', () => {
    const [packed] = JSON.parse(
      npm(['pack', '--dry-run', '--json', '--ignore-scripts'], join(ROOT, 'create-agent')),
    ) as { name: string; files: { path: string }[] }[];
    expect(packed?.name).toBe('@sess.si/create-agent');
    expect(packed?.files.map((file) => file.path).sort()).toEqual([
      'LICENSE',
      'README.md',
      'index.mjs',
      'package.json',
      'template/LICENSE',
      'template/README.md',
      'template/_env.example',
      'template/_gitignore',
      'template/agent.mjs',
      'template/package.json',
      'template/weather.mjs',
    ]);
  });
});
