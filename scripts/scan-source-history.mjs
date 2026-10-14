import { mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import {
  git,
  prepareConfig,
  provenance,
  scan,
  stageTrackedSource,
  verifiedScanner,
  withScanWorkspace,
} from './source-scan-lib.mjs';

const root = resolve(process.cwd());
const binary = await verifiedScanner();
if (git(root, ['rev-parse', '--is-shallow-repository']).trim() !== 'false')
  throw new Error('Full exposed history is required; shallow-checkout scanning cannot report a pass.');
const sourceCommit = git(root, ['rev-parse', 'HEAD']).trim();
const refs = git(root, ['for-each-ref', '--format=%(refname) %(objectname)'])
  .trim()
  .split('\n')
  .filter(Boolean)
  .map((line) => {
    const [ref, sha] = line.split(' ');
    return { ref, sha };
  });
const result = await withScanWorkspace(async (workspace) => {
  const config = await prepareConfig(workspace);
  const source = join(workspace, 'tracked-source');
  const fileCount = await stageTrackedSource(root, source);
  // The clean disposable bare mirror contains tracked Git objects/refs only. Neither
  // ignored working-tree credentials nor a local .gitleaksignore can suppress history.
  const history = join(workspace, 'history.git');
  git(workspace, ['clone', '--mirror', '--no-local', '--quiet', root, history]);
  git(history, ['update-ref', 'refs/scan/candidate', sourceCommit]);
  const commits = Number(git(history, ['rev-list', '--count', '--all']).trim());
  const sourceResult = await scan(binary, config.path, workspace, 'dir', source);
  // Include merge additions as parent diffs; the initial commit and removed markers
  // remain in scope. All retained branches/tags and the exact candidate are scanned.
  const historyResult = await scan(binary, config.path, workspace, 'git', history, '--full-history --all -m');
  return {
    source_commit: sourceCommit,
    source_tree_dirty: !!git(root, ['status', '--porcelain', '--untracked-files=no']).trim(),
    scanner: provenance,
    policy_sha256: config.policy_sha256,
    coverage: {
      tracked_files: fileCount,
      reachable_commits: commits,
      refs,
      history_options: '--full-history --all -m',
      ignored_worktree_files_included: false,
      baseline_suppressions: false,
      inline_allow_comments: false,
      project_wide_path_exclusions: false,
    },
    source: sourceResult,
    history: historyResult,
  };
});
await mkdir('.artifacts', { recursive: true });
await writeFile('.artifacts/source-history-scan.json', `${JSON.stringify(result, null, 2)}\n`);
console.log(
  `Tracked source: ${result.source.status} (${result.coverage.tracked_files} files, ${result.source.findings.length} findings). ` +
    `Exposed history: ${result.history.status} (${result.coverage.reachable_commits} commits, ${result.history.findings.length} findings).`,
);
if (result.source.status !== 'PASS' || result.history.status !== 'PASS') process.exitCode = 1;
