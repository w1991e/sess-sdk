import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  git,
  prepareConfig,
  scan,
  stageTrackedSource,
  verifiedScanner,
  withScanWorkspace,
} from './source-scan-lib.mjs';

const binary = await verifiedScanner();
const fastCheck = fileURLToPath(new URL('./check-secrets.mjs', import.meta.url));
const contract = JSON.parse(await readFile(new URL('../contract/openapi.json', import.meta.url), 'utf8'));
// These bytes are generated solely for controls, never issued by npm or SESS.
const marker = ['npm', '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ'].join('_');
function initialize(root) {
  git(root, ['init', '--quiet']);
  git(root, ['config', 'user.name', 'Synthetic Scan Control']);
  git(root, ['config', 'user.email', 'scan-control@example.invalid']);
}
async function file(root, path, content) {
  await mkdir(dirname(join(root, path)), { recursive: true });
  await writeFile(join(root, path), content);
}
function commit(root, message) {
  git(root, ['add', '--all']);
  git(root, ['commit', '--quiet', '-m', message]);
}
function boundary(root) {
  return spawnSync(process.execPath, [fastCheck], { cwd: root, encoding: 'utf8', timeout: 10000 });
}

test('every omitted tracked location and default upstream path exclusion detects the synthetic marker', async () => {
  await withScanWorkspace(async (workspace) => {
    const config = await prepareConfig(workspace);
    for (const path of [
      'src/probe.ts',
      'README.md',
      'tests/probe.ts',
      '.env',
      '.npmrc',
      'LICENSE',
      '.github/probe',
      'package-lock.json',
      '.github/gitleaks.toml',
    ]) {
      const root = join(workspace, 'case');
      await mkdir(root);
      initialize(root);
      await file(root, path, `fixture_marker = "${marker}"\n`);
      git(root, ['add', '--all']);
      const fast = boundary(root);
      assert.equal(fast.signal, null);
      assert.equal(fast.status, 1, `Fast boundary failed its control at ${path}.`);
      assert.ok(!`${fast.stdout}${fast.stderr}`.includes(marker), 'Fast boundary exposed marker bytes.');
      const staged = join(workspace, 'staged');
      assert.equal(await stageTrackedSource(root, staged), 1);
      const result = await scan(binary, config.path, workspace, 'dir', staged);
      assert.equal(result.status, 'FAIL', `Maintained scanner failed its control at ${path}.`);
      assert.ok(result.findings.some((finding) => finding.rule === 'npm-access-token'));
      assert.ok(!JSON.stringify(result).includes(marker), 'Safe report exposed marker bytes.');
      await rm(root, { recursive: true });
      await rm(staged, { recursive: true });
    }
  });
});

test('ignored local credentials and a tracked symlink to them never enter scan content', async () => {
  await withScanWorkspace(async (workspace) => {
    const config = await prepareConfig(workspace);
    const root = join(workspace, 'repo');
    await mkdir(root);
    initialize(root);
    await file(root, '.gitignore', '.env\n');
    await file(root, 'NOTICE', 'Synthetic safe repository.\n');
    await file(root, '.env', `fixture_marker = "${marker}"\n`);
    await symlink('.env', join(root, 'credential-link'));
    commit(root, 'Synthetic safe source');
    const staged = join(workspace, 'staged');
    assert.equal(await stageTrackedSource(root, staged), 3);
    assert.equal(boundary(root).status, 0);
    const result = await scan(binary, config.path, workspace, 'dir', staged);
    assert.equal(result.status, 'PASS');
    await assert.rejects(readFile(join(staged, '.env')));
    assert.equal(await readFile(join(staged, 'credential-link'), 'utf8'), '.env');
  });
});

test('inline allow comments and a tracked fingerprint ignore file cannot hide a marker', async () => {
  await withScanWorkspace(async (workspace) => {
    const config = await prepareConfig(workspace);
    const source = join(workspace, 'tracked');
    await file(source, '.npmrc', `fixture_marker = "${marker}" # gitleaks:allow\n`);
    const result = await scan(binary, config.path, workspace, 'dir', source);
    assert.equal(result.status, 'FAIL');
    initialize(source);
    await file(source, '.gitleaksignore', 'synthetic-ignore-fingerprint\n');
    git(source, ['add', '--all']);
    await assert.rejects(stageTrackedSource(source, join(workspace, 'staged')), /Fingerprint ignore/);
  });
});

test('one exact OpenAPI example is benign, and neighboring content/path/value mutations fail', async () => {
  // The public example's schema location is not used as an exemption; extract it by
  // its exact property, then demonstrate a whole-line/path-constrained scanner match.
  const text = JSON.stringify(contract);
  const exampleValue = text.match(/"management_credential":"(sess_mg_[A-Za-z0-9_-]+)"/)?.[1];
  assert.equal(typeof exampleValue, 'string');
  assert.equal(exampleValue, ['sess', 'mg', 'SYNTHETICxEXAMPLExNOTxAxCREDENTIALxxxxxxxxx'].join('_'));
  await withScanWorkspace(async (workspace) => {
    const config = await prepareConfig(workspace);
    const source = join(workspace, 'source');
    const path = 'contract/openapi.json';
    const benign = `    "management_credential": "${exampleValue}",\n`;
    await file(source, path, benign);
    assert.equal((await scan(binary, config.path, workspace, 'dir', source)).status, 'PASS');
    initialize(source);
    git(source, ['add', '--all']);
    assert.equal(boundary(source).status, 0);
    // A different byte is not the public example; additional content is not that whole line.
    for (const content of [
      benign.replace(/x",\n$/, 'y",\n'),
      benign.trimEnd() + ' extra\n',
      benign + marker,
    ]) {
      await file(source, path, content);
      assert.equal((await scan(binary, config.path, workspace, 'dir', source)).status, 'FAIL');
    }
    await rm(join(source, path));
    await file(source, 'tests/openapi.json', benign);
    assert.equal((await scan(binary, config.path, workspace, 'dir', source)).status, 'FAIL');
  });
});

test('the exact public replay-identity fixture is benign while nearby/path/value changes remain detected', async () => {
  await withScanWorkspace(async (workspace) => {
    const config = await prepareConfig(workspace);
    const source = join(workspace, 'source');
    const path = 'tests/unit/checkpoint-corrections.test.ts';
    const parts = ['Original', 'Key', 'with', 'Bytes', '128'];
    const identity = `${parts[0]}.${parts[1]}:${parts[2]}_${parts[3]}-${parts[4]}`;
    const benign = `    const idempotencyKey = '${identity}';\n`;
    await file(source, path, benign);
    assert.equal((await scan(binary, config.path, workspace, 'dir', source)).status, 'PASS');
    for (const content of [
      benign.replace('128', '129'),
      benign.trimEnd() + ' extra\n',
      benign + `const apiKey = "${marker}";\n`,
    ]) {
      await file(source, path, content);
      assert.equal((await scan(binary, config.path, workspace, 'dir', source)).status, 'FAIL');
    }
    await rm(join(source, path));
    await file(source, 'tests/other.test.ts', benign);
    assert.equal((await scan(binary, config.path, workspace, 'dir', source)).status, 'FAIL');
  });
});

test('the exact S-07 QR parity token line is benign only at its path and exact line; its value elsewhere, another value there, another file and a one-character mutation stay detected', async () => {
  await withScanWorkspace(async (workspace) => {
    const config = await prepareConfig(workspace);
    const source = join(workspace, 'source');
    const path = 'tests/unit/qr.test.ts';
    // The synthetic token of the Sess renderer's QR vectors, assembled so this file never holds it.
    const token = ['AbCdEfGhIjKlMnOpQrStUvWxYz', '0123456789', '_-abcde'].join('');
    const benign = `const TOKEN = '${token}';\n`;
    await file(source, path, `import { x } from './x.js';\n\n${benign}const LINKS = [];\n`);
    assert.equal((await scan(binary, config.path, workspace, 'dir', source)).status, 'PASS');
    const reversed = [...token].reverse().join('');
    for (const [label, content] of [
      ['the same value on another line', `${benign}const SECRET_TOKEN = '${token}';\n`],
      ['another value on that line', benign.replace(token, reversed)],
      ['a one-character mutation', benign.replace('abcde', 'abcdf')],
      ['the exact line indented', `  ${benign}`],
      ['the exact line with more after it', `${benign.trimEnd()} const apiKey = '${reversed}';\n`],
      ['a real-looking marker beside it', `${benign}const apiKey = "${marker}";\n`],
    ]) {
      await file(source, path, content);
      assert.equal(
        (await scan(binary, config.path, workspace, 'dir', source)).status,
        'FAIL',
        `${label} must stay detected`,
      );
    }
    await rm(join(source, path));
    for (const other of ['tests/unit/other.test.ts', 'tests/unit/qr.test.mjs', 'src/qr/index.ts']) {
      await file(source, other, benign);
      assert.equal(
        (await scan(binary, config.path, workspace, 'dir', source)).status,
        'FAIL',
        `the same line in ${other} must stay detected`,
      );
      await rm(join(source, other));
    }
  });
});

test('the SHA-verified upstream provider-domain detection regex is benign only on its original whole line/path', async () => {
  await withScanWorkspace(async (workspace) => {
    const config = await prepareConfig(workspace);
    const source = join(workspace, 'source');
    const path = '.github/gitleaks-upstream-v8.30.1.toml';
    const upstream = await readFile(
      new URL('../.github/gitleaks-upstream-v8.30.1.toml', import.meta.url),
      'utf8',
    );
    const benign = upstream.split('\n').find((line) => line.startsWith("regex = '''bedrock-api-key-"));
    assert.ok(benign);
    await file(source, path, upstream);
    assert.equal((await scan(binary, config.path, workspace, 'dir', source)).status, 'PASS');
    await file(source, path, `${benign}\n`);
    assert.equal((await scan(binary, config.path, workspace, 'dir', source)).status, 'PASS');
    for (const content of [`${benign} extra\n`, `${benign}\n${marker}\n`]) {
      await file(source, path, content);
      assert.equal((await scan(binary, config.path, workspace, 'dir', source)).status, 'FAIL');
    }
    await rm(join(source, path));
    await file(source, 'tests/provider.txt', `${benign}\n`);
    const result = await scan(binary, config.path, workspace, 'dir', source);
    assert.equal(result.status, 'FAIL');
    assert.ok(result.findings.some((finding) => finding.rule === 'aws-amazon-bedrock-api-key-short-lived'));
  });
});

test('the two retained checkpoint scanner definitions are benign only at their exact original paths/lines', async () => {
  await withScanWorkspace(async (workspace) => {
    const config = await prepareConfig(workspace);
    const source = join(workspace, 'source');
    const parts = ['Original', 'Key', 'with', 'Bytes', '128'];
    const identity = `${parts[0]}.${parts[1]}:${parts[2]}_${parts[3]}-${parts[4]}`;
    const definitions = [
      {
        path: 'scripts/test-source-scan.mjs',
        line: "const identity = ['Original', '" + identity.split('.')[1] + "'].join('.');\n",
      },
      {
        path: '.github/gitleaks.toml',
        line: "regexes = ['''^\\s*const idempotencyKey = '" + identity.replace('.', '\\.') + "';\\s*$''']\n",
      },
    ];
    for (const definition of definitions) {
      await file(source, definition.path, definition.line);
      assert.equal((await scan(binary, config.path, workspace, 'dir', source)).status, 'PASS');
      for (const content of [
        definition.line.replace('128', '129'),
        definition.line.trimEnd() + ' extra\n',
        definition.line + marker,
      ]) {
        await file(source, definition.path, content);
        assert.equal((await scan(binary, config.path, workspace, 'dir', source)).status, 'FAIL');
      }
      await rm(join(source, definition.path));
      await file(source, 'tests/historical-control.txt', definition.line);
      assert.equal((await scan(binary, config.path, workspace, 'dir', source)).status, 'FAIL');
      await rm(join(source, 'tests/historical-control.txt'));
    }
    initialize(source);
    for (const definition of definitions) await file(source, definition.path, definition.line);
    commit(source, 'Synthetic exact historical scanner definitions');
    assert.equal(
      (await scan(binary, config.path, workspace, 'git', source, '--full-history --all -m')).status,
      'PASS',
    );
  });
});

test('all-ref history detects a removed marker and a marker on a retained source branch', async () => {
  await withScanWorkspace(async (workspace) => {
    const config = await prepareConfig(workspace);
    const root = join(workspace, 'repo');
    await mkdir(root);
    initialize(root);
    await file(root, 'NOTICE', 'Synthetic safe initial tree.\n');
    commit(root, 'Synthetic initial source');
    await file(root, '.npmrc', `fixture_marker = "${marker}"\n`);
    commit(root, 'Synthetic marker addition');
    const markerCommit = git(root, ['rev-parse', 'HEAD']).trim();
    await rm(join(root, '.npmrc'));
    commit(root, 'Synthetic marker removal');
    const primary = git(root, ['symbolic-ref', '--short', 'HEAD']).trim();
    git(root, ['switch', '--quiet', '-c', 'retained-synthetic-source']);
    await file(root, 'retained-marker', `fixture_marker = "${marker}"\n`);
    commit(root, 'Synthetic retained-branch marker');
    const branchCommit = git(root, ['rev-parse', 'HEAD']).trim();
    git(root, ['switch', '--quiet', primary]);
    const staged = join(workspace, 'staged');
    await stageTrackedSource(root, staged);
    assert.equal((await scan(binary, config.path, workspace, 'dir', staged)).status, 'PASS');
    const history = join(workspace, 'history.git');
    git(workspace, ['clone', '--mirror', '--no-local', '--quiet', root, history]);
    const result = await scan(binary, config.path, workspace, 'git', history, '--full-history --all -m');
    assert.equal(result.status, 'FAIL');
    assert.ok(
      result.findings.some((finding) => finding.commit === markerCommit && finding.path === '.npmrc'),
    );
    assert.ok(
      result.findings.some(
        (finding) => finding.commit === branchCommit && finding.path === 'retained-marker',
      ),
    );
    assert.ok(!JSON.stringify(result).includes(marker));
  });
});
