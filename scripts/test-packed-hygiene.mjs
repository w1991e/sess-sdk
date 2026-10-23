// Self-test for scripts/check-packed-hygiene.mjs: node --test scripts/test-packed-hygiene.mjs
// Every tarball is built at runtime in a temporary directory. Credential-shaped values are
// assembled from fragments here so no key-shaped literal is ever committed.
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { after, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';
import {
  CONTENT_RULES,
  PATH_RULES,
  checkTarball,
  formatFinding,
  readTarball,
} from './check-packed-hygiene.mjs';

const guard = join(dirname(fileURLToPath(import.meta.url)), 'check-packed-hygiene.mjs');
const work = mkdtempSync(join(tmpdir(), 'sess-packed-hygiene-'));
after(() => rmSync(work, { recursive: true, force: true }));

/** A minimal ustar .tgz the way npm lays it out (package/<path>). */
function tgz(files) {
  const blocks = [];
  for (const [path, content] of Object.entries(files)) {
    const body = Buffer.from(content);
    const header = Buffer.alloc(512);
    header.write(`package/${path}`, 0, 100);
    header.write('0000644\0', 100);
    header.write('0000000\0', 108);
    header.write('0000000\0', 116);
    header.write(`${body.length.toString(8).padStart(11, '0')}\0`, 124);
    header.write('00000000000\0', 136);
    header.write('        ', 148);
    header.write('0', 156);
    header.write('ustar\0', 257);
    header.write('00', 263);
    let sum = 0;
    for (const b of header) sum += b;
    header.write(`${sum.toString(8).padStart(6, '0')}\0 `, 148);
    blocks.push(header, body, Buffer.alloc((512 - (body.length % 512)) % 512));
  }
  blocks.push(Buffer.alloc(1024));
  return gzipSync(Buffer.concat(blocks));
}
let count = 0;
function write(files) {
  const path = join(work, `fixture-${++count}.tgz`);
  writeFileSync(path, tgz(files));
  return path;
}

const CLEAN = {
  'package.json': JSON.stringify({ name: '@sess.si/example', version: '1.0.0' }),
  'README.md': [
    '# Example',
    'Docs: https://docs.sess.si/start and https://github.com/w1991e/sess-sdk#readme.',
    'Registry: https://registry.npmjs.org/@sess.si/sdk and https://www.npmjs.com/package/@sess.si/sdk.',
    'Local test flag: --api-url http://localhost:8080 or http://127.0.0.1:3000 or http://[::1]:3000.',
    'Origins are exact (scheme://host[:port]); an absolute https:// URL on port 443.',
    'MCP registry name io.github.w1991e/sess. Packed from sess-sdk 3dbd7fd239a9a91c9e7b97b55d99dd1e413e8d2b.',
    'The Sess link /s/short is a placeholder.',
  ].join('\n'),
  'dist/index.js': [
    "export const base = 'https://api.sess.si';",
    'export const url = (host) => new URL("/", `http://${host}`).href;',
    "const svg = 'http://www.w3.org/2000/svg';",
  ].join('\n'),
  'dist/index.d.ts': 'export declare const base: string;\n',
  'dist/docs/specification.js': '// receipt-v1 §10, docs/spec/receipt-v1.md in this repository\n',
};

test('a clean synthetic package passes', () => {
  const result = checkTarball(write(CLEAN));
  assert.deepEqual(result.findings, []);
  assert.equal(result.files, Object.keys(CLEAN).length);
});

// Credential-shaped values, assembled at runtime.
const r = (n, alphabet = 'Ab3') =>
  Array.from({ length: n }, (_, i) => alphabet[i % alphabet.length]).join('');
const b64 = (value) => Buffer.from(JSON.stringify(value)).toString('base64url');
const SECRETS = {
  'sess-credential': ['sess', 'sk', r(40)].join('_'),
  'human-link-token': `https://sess.si/s/${r(43)}`,
  'stripe-key': ['sk', 'live', r(24)].join('_'),
  'github-token': ['gh', 'p_', r(36)].join(''),
  'npm-token': ['np', 'm_', r(36)].join(''),
  'aws-key': ['AK', 'IA', r(16, 'QZ7')].join(''),
  'private-key': ['-----BEGIN', 'PRIVATE KEY-----'].join(' '),
  jwt: [b64({ alg: 'HS256' }), b64({ sub: 'synthetic-subject' }), r(43)].join('.'),
  'anthropic-key': ['sk', 'ant', 'api03', `${r(93)}AA`].join('-'),
  'openai-key': ['sk', 'proj', r(48)].join('-'),
  'openai-legacy-key': ['sk', r(48)].join('-'),
  'openrouter-key': ['sk', 'or', 'v1', r(64, 'a1f')].join('-'),
  'google-api-key': ['AI', 'za', r(35, 'Sy9_-')].join(''),
};
const MORE_SECRETS = [
  ['anthropic-key', ['sk', 'ant', 'admin01', `${r(93)}AA`].join('-')],
  ['openai-key', ['sk', 'svcacct', r(48)].join('-')],
  ['openai-key', ['sk', 'admin', r(48)].join('-')],
  ['openai-legacy-key', ['sk', `${r(20, 'Ab')}T3Blbk${'FJ'}${r(20, 'x7')}`].join('-')],
  ['stripe-key', ['rk', 'live', r(24)].join('_')],
  ['stripe-key', ['sk', 'test', r(24)].join('_')],
  ['github-token', ['github', 'pat', r(40)].join('_')],
  ['sess-credential', ['sess', 'mg', r(40)].join('_')],
  ['private-key', ['-----BEGIN', 'RSA PRIVATE KEY-----'].join(' ')],
];

const INTERNAL = {
  'internal-docs': 'See DOCS/spec/receipt-v1.md.',
  'internal-execution': 'Recorded in EXECUTION/NOW.md.',
  'internal-review': 'Approved in ASTRA review.',
  'internal-founder': 'Waits on the Founder.',
  'internal-orchestrator': 'The orchestrator merges it.',
  'internal-worktree': 'Built in a registered worktree.',
  'local-path': 'Built in /Users/someone/dev.',
  'agent-config': 'Policy in .claude/settings.json.',
  'local-keychain': 'Key from the macOS Keychain.',
  'private-pr': 'Fixed by sess-sdk #27.',
  'private-commit': `Runtime from sess ${'e63d0074'.repeat(5)}.`,
  'source-map-comment': '//# sourceMappingURL=index.js.map',
  'non-public-host-name': 'Deployed to sess-api-abc12.ondigitalocean.app.',
};
const MORE_INTERNAL = [
  ['local-path', 'Home is /home/runner/work.'],
  ['private-pr', 'Sess PR #444 merged.'],
  ['private-pr', 'sess #12 merged.'],
  ['private-pr', 'Snapshot (w1991e/sess master, PR #431).'],
  ['non-public-host-name', 'Preview at preview.sess.si.'],
  ['non-public-host-name', 'Staging at app.sigstage.dev.'],
];

test('every content rule has a failing fixture', () => {
  const covered = new Set([...Object.keys(SECRETS), ...Object.keys(INTERNAL)]);
  for (const rule of CONTENT_RULES) assert.ok(covered.has(rule.id), `no fixture for ${rule.id}`);
});

for (const [rule, value] of [...Object.entries(SECRETS), ...MORE_SECRETS]) {
  test(`credential shape ${rule} fails without echoing the value`, () => {
    const { findings } = checkTarball(write({ ...CLEAN, 'dist/config.js': `\nconst v = '${value}';\n` }));
    assert.deepEqual(
      findings.filter((f) => f.rule !== 'non-public-host').map((f) => [f.file, f.line, f.rule]),
      [['dist/config.js', 2, rule]],
    );
    const printed = findings.map(formatFinding).join('\n');
    assert.ok(!printed.includes(value) && !printed.includes(value.slice(-16)), printed);
  });
}

for (const [rule, text] of [...Object.entries(INTERNAL), ...MORE_INTERNAL]) {
  test(`internal reference ${rule} fails: ${text}`, () => {
    const { findings } = checkTarball(write({ ...CLEAN, 'README.md': `# Example\n\n${text}\n` }));
    assert.deepEqual(
      findings.map((f) => [f.file, f.line, f.rule]),
      [['README.md', 3, rule]],
    );
  });
}

for (const path of [
  'dist/index.js.map',
  'dist/index.d.ts.map',
  'test/unit.js',
  'tests/fixtures/a.json',
  'dist/__tests__/x.js',
  'fixture/body.json',
  'spec/receipt.md',
  'dist/client.test.js',
  'dist/client.spec.mjs',
]) {
  test(`path ${path} fails`, () => {
    const { findings } = checkTarball(write({ ...CLEAN, [path]: 'export {};\n' }));
    assert.ok(findings.length > 0);
    assert.ok(findings.every((f) => f.file === path && f.line === 0));
    assert.ok(findings.some((f) => PATH_RULES.some((rule) => rule.id === f.rule)));
  });
}

for (const [url, host] of [
  ['https://sess-preview.preview.sess.si/v1', 'sess-preview.preview.sess.si'],
  ['https://sess-api-abc12.ondigitalocean.app', 'sess-api-abc12.ondigitalocean.app'],
  ['https://api.sigstage.dev/', 'api.sigstage.dev'],
  ['https://staging.example.org/', 'staging.example.org'],
  ['http://db.internal:5432', 'db.internal'],
  ['http://build-mac.local/', 'build-mac.local'],
  ['https://user:pass@unlisted.example.net:8443/x', 'unlisted.example.net'],
  ['https://API.EXAMPLE.NET/', 'api.example.net'],
]) {
  test(`URL host ${host} fails`, () => {
    const { findings } = checkTarball(write({ ...CLEAN, 'dist/hosts.js': `fetch('${url}');\n` }));
    const hosts = findings.filter((f) => f.rule === 'non-public-host');
    assert.equal(hosts.length, 1, findings.map(formatFinding).join('\n'));
    assert.equal(hosts[0].match, host);
    assert.equal(hosts[0].file, 'dist/hosts.js');
    assert.equal(hosts[0].line, 1);
  });
}

// URL userinfo is refused whatever the host, and never echoed.
const USERINFO = [
  ['https', 'synthetic-user', `pw${r(20)}`, 'api.sess.si/v1/sessions'],
  ['https', 'x-access-token', ['gh', 's_', r(36)].join(''), 'github.com/w1991e/sess-sdk.git'],
  ['git+https', 'token', `t${r(30)}`, 'github.com/w1991e/sess-sdk.git'],
  ['http', 'admin', `p${r(12)}#frag`, 'localhost:8080/'],
  ['https', `only${r(16)}`, '', 'registry.npmjs.org/'],
].map(([scheme, user, pass, rest]) => {
  const userinfo = pass ? `${user}:${pass}` : user;
  return { url: `${scheme}://${userinfo}@${rest}`, secret: pass || user };
});
for (const { url, secret } of USERINFO) {
  test(`URL userinfo fails without echoing it (${url.slice(0, url.indexOf('://'))})`, () => {
    const { findings } = checkTarball(write({ ...CLEAN, 'dist/remote.js': `\nfetch('${url}');\n` }));
    assert.deepEqual(
      findings.filter((f) => f.rule === 'url-userinfo').map((f) => [f.file, f.line]),
      [['dist/remote.js', 2]],
    );
    const printed = findings.map(formatFinding).join('\n');
    assert.ok(!printed.includes(secret) && !printed.includes(secret.slice(-12)), printed);
  });
}

test('words and prose near the key prefixes pass', () => {
  const prose = [
    'Each task-runner, desk-check and risk-free mask-based flow is ordinary text.',
    'Keys start with sk- or sk-ant- or sk-proj-; never paste one here.',
    'Set ANTHROPIC_API_KEY=sk-ant-... and OPENAI_API_KEY=sk-... in your shell.',
    'The OpenRouter label sk-or-v1-abc...xyz is a placeholder; AIza is a Google prefix.',
    `A scikit-learn sk-learn-compatible name, sk-${'abcdefghijklmnopqrstuvwxyzabcdefgh'} (letters only).`,
    'Contact: someone@example.com; npm i @sess.si/sdk; see https://github.com/w1991e/sess-sdk?ref=main.',
  ].join('\n');
  const { findings } = checkTarball(write({ ...CLEAN, 'README.md': prose }));
  assert.deepEqual(findings, [], findings.map(formatFinding).join('\n'));
});

test('the CLI exits 1 for every model-provider key shape and URL userinfo, printing none', () => {
  const rules = ['anthropic-key', 'openai-key', 'openai-legacy-key', 'openrouter-key', 'google-api-key'];
  const values = rules.map((rule) => SECRETS[rule]);
  const lines = [...values.map((v) => `const k = '${v}';`), `fetch('${USERINFO[0].url}');`];
  const path = write({ ...CLEAN, 'dist/leak.js': lines.join('\n') });
  const out = spawnSync(process.execPath, [guard, path], { encoding: 'utf8' });
  assert.equal(out.status, 1);
  for (const [i, rule] of [...rules, 'url-userinfo'].entries())
    assert.match(out.stderr, new RegExp(`dist/leak\\.js:${i + 1} ${rule}:`));
  for (const secret of [...values, USERINFO[0].secret])
    assert.ok(
      !out.stderr.includes(secret.slice(-12)) && !out.stdout.includes(secret.slice(-12)),
      'a credential value was printed',
    );
});

test('the CLI exits 1 listing file:line and never the credential', () => {
  const secret = SECRETS['sess-credential'];
  const path = write({ ...CLEAN, 'dist/leak.js': `const k = '${secret}';\nconst d = 'DOCS/x';\n` });
  const out = spawnSync(process.execPath, [guard, path], { encoding: 'utf8' });
  assert.equal(out.status, 1);
  assert.match(out.stderr, /dist\/leak\.js:1 sess-credential/);
  assert.match(out.stderr, /dist\/leak\.js:2 internal-docs/);
  assert.ok(!out.stderr.includes(secret) && !out.stdout.includes(secret));
  const clean = spawnSync(process.execPath, [guard, write(CLEAN)], { encoding: 'utf8' });
  assert.equal(clean.status, 0, clean.stderr);
  assert.match(clean.stdout, /PASS/);
});

test('reads npm pack output, including long paths', () => {
  const pkg = join(work, 'npm-package');
  const deep = `dist/${'nested-directory-name/'.repeat(6)}module-with-a-long-file-name.js`;
  mkdirSync(join(pkg, dirname(deep)), { recursive: true });
  writeFileSync(
    join(pkg, 'package.json'),
    JSON.stringify({ name: 'packed-hygiene-fixture', version: '1.0.0', files: ['dist/'] }),
  );
  writeFileSync(join(pkg, deep), 'export const x = 1;\n//# sourceMappingURL=x.js.map\n');
  const npm = process.env.npm_execpath
    ? [process.execPath, [process.env.npm_execpath]]
    : [process.platform === 'win32' ? 'npm.cmd' : 'npm', []];
  const [packed] = JSON.parse(
    execFileSync(npm[0], [...npm[1], 'pack', '--json', '--ignore-scripts', '--pack-destination', pkg], {
      cwd: pkg,
      encoding: 'utf8',
    }),
  );
  const tarball = join(pkg, packed.filename);
  const paths = readTarball(readFileSync(tarball)).map((e) => e.path);
  assert.ok(paths.includes(deep), paths.join(', '));
  const { findings } = checkTarball(tarball);
  assert.deepEqual(
    findings.map((f) => [f.file, f.line, f.rule]),
    [[deep, 2, 'source-map-comment']],
  );
});
