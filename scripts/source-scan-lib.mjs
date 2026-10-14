import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { lstat, mkdir, mkdtemp, readFile, readlink, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const provenance = {
  scanner: 'gitleaks',
  version: '8.30.1',
  archive_url:
    'https://github.com/gitleaks/gitleaks/releases/download/v8.30.1/gitleaks_8.30.1_linux_x64.tar.gz',
  archive_sha256: '551f6fc83ea457d62a0d98237cbad105af8d557003051f41f3e7ca7b3f2470eb',
  binary_sha256: '88f91962aa2f93ac6ab281d553b9e125f5197bbbce38f9f2437f7299c32e5509',
  upstream_config_url: 'https://github.com/gitleaks/gitleaks/blob/v8.30.1/config/gitleaks.toml',
  upstream_config_git_blob: '256f64790ea6d954f0041024be2938089ae1e7a7',
  upstream_config_sha256: 'e163e53b9e7e8a8511e77271e2b323ed057759542a6d988258afe3a1fa329caf',
};
const packageRoot = fileURLToPath(new URL('..', import.meta.url));

export function git(cwd, args) {
  const result = spawnSync('git', args, {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    timeout: 120000,
    maxBuffer: 64 * 1024 * 1024,
  });
  if (result.error || result.signal || result.status !== 0)
    throw new Error('Git source/history acquisition failed; scan cannot report a pass.');
  return result.stdout;
}

export async function verifiedScanner() {
  const path = process.env.GITLEAKS_BIN;
  if (!path) throw new Error('Set GITLEAKS_BIN to the integrity-verified Linux x86_64 scanner binary.');
  const bytes = await readFile(path);
  if (createHash('sha256').update(bytes).digest('hex') !== provenance.binary_sha256)
    throw new Error('Scanner binary SHA-256 differs from the pinned release.');
  const result = spawnSync(path, ['version'], { encoding: 'utf8', timeout: 10000 });
  if (result.error || result.status !== 0 || result.stdout.trim() !== provenance.version)
    throw new Error('Scanner version differs from the pinned release.');
  return resolve(path);
}

export async function withScanWorkspace(callback) {
  const workspace = await mkdtemp(join(tmpdir(), 'sess-source-scan-'));
  try {
    return await callback(workspace);
  } finally {
    // Raw scanner JSON, tracked-content copies and synthetic repositories never become artifacts.
    await rm(workspace, { recursive: true, force: true });
  }
}

export async function prepareConfig(workspace) {
  const bytes = await readFile(join(packageRoot, '.github/gitleaks-upstream-v8.30.1.toml'));
  if (createHash('sha256').update(bytes).digest('hex') !== provenance.upstream_config_sha256)
    throw new Error('Vendored upstream scanner config failed its SHA-256 check.');
  const upstream = bytes.toString('utf8');
  const globalAt = upstream.indexOf('\n[allowlist]\n');
  const rulesAt = upstream.indexOf('\n[[rules]]\n');
  if (globalAt < 0 || rulesAt <= globalAt)
    throw new Error('Pinned upstream config layout changed; review config derivation.');
  // Keep every maintained rule and its rule-level semantics. Remove only the upstream
  // global suppression block, which otherwise skips lockfiles, dotfiles/config and extensions.
  const defaults = `${upstream.slice(0, globalAt)}\n${upstream.slice(rulesAt)}`;
  const defaultsPath = join(workspace, 'upstream-rules.toml');
  await writeFile(defaultsPath, defaults, { mode: 0o600 });
  const policy = await readFile(join(packageRoot, '.github/gitleaks.toml'), 'utf8');
  const effective =
    `title = "SESS SDK complete tracked-source/history scan"\n` +
    `[extend]\npath = ${JSON.stringify(defaultsPath)}\n\n${policy}`;
  const configPath = join(workspace, 'effective.toml');
  await writeFile(configPath, effective, { mode: 0o600 });
  return { path: configPath, policy_sha256: createHash('sha256').update(policy).digest('hex') };
}

export async function stageTrackedSource(root, target) {
  const records = git(root, ['ls-files', '--cached', '--stage', '-z']).split('\0').filter(Boolean);
  if (!records.length) throw new Error('Cannot report a source pass for an empty tracked tree.');
  for (const record of records) {
    const tab = record.indexOf('\t');
    const [mode, , stage] = record.slice(0, tab).split(' ');
    const path = record.slice(tab + 1);
    if (path === '.gitleaksignore')
      throw new Error('Fingerprint ignore files cannot replace reviewed scanner policy.');
    if (tab < 0 || stage !== '0' || !['100644', '100755', '120000'].includes(mode))
      throw new Error('Unmerged/submodule/unsupported tracked source requires separate coverage.');
    const absolute = resolve(root, path);
    if (absolute !== join(root, path) || path.split('/').includes('..'))
      throw new Error('Unexpected tracked path.');
    const info = await lstat(absolute);
    if (!info.isFile() && !info.isSymbolicLink()) throw new Error('Unsupported tracked source.');
    const bytes = info.isSymbolicLink() ? await readlink(absolute) : await readFile(absolute);
    const staged = join(target, path);
    await mkdir(dirname(staged), { recursive: true, mode: 0o700 });
    // Symlink target text is staged as a regular file: no dereferencing ignored/private targets.
    await writeFile(staged, bytes, { mode: 0o600 });
  }
  return records.length;
}

export async function scan(binary, config, workspace, mode, source, logOptions) {
  const report = join(workspace, `raw-${mode}.json`);
  const args = [
    mode,
    '--config',
    config,
    '--redact=100',
    '--no-banner',
    '--no-color',
    '--log-level=error',
    '--ignore-gitleaks-allow',
    '--gitleaks-ignore-path',
    join(workspace, 'no-ignore-file'),
    '--max-target-megabytes=0',
    '--max-decode-depth=5',
    '--max-archive-depth=3',
    '--timeout=600',
    '--report-format=json',
    '--report-path',
    report,
    '--exit-code=7',
  ];
  if (logOptions) args.push('--log-opts', logOptions);
  args.push(source);
  const done = spawnSync(binary, args, {
    cwd: workspace,
    encoding: 'utf8',
    timeout: 630000,
    maxBuffer: 64 * 1024 * 1024,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  if (done.error || done.signal || ![0, 7].includes(done.status))
    throw new Error('Maintained scanner could not complete; raw diagnostic output is withheld.');
  const raw = JSON.parse(await readFile(report, 'utf8'));
  if (!Array.isArray(raw) || (done.status === 0 && raw.length) || (done.status === 7 && !raw.length))
    throw new Error('Scanner exit/report mismatch.');
  return {
    status: done.status === 0 ? 'PASS' : 'FAIL',
    findings: raw.map((finding) => ({
      rule: finding.RuleID,
      path: finding.File?.startsWith(`${source}/`) ? finding.File.slice(source.length + 1) : finding.File,
      line: finding.StartLine,
      commit: finding.Commit || null,
    })),
  };
}
