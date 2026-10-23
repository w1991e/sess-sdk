// Packed-tarball hygiene guard for every published @sess.si package. Plain Node, no dependencies:
// it reads the exact .tgz bytes npm pack produced (gzip + ustar/pax, parsed here) and refuses
// anything a public package must not carry. Called by each package's packed check (root
// scripts/check-package.mjs, adapters/mcp and adapters/openclaw scripts/check-package.mjs,
// create-agent/scripts/release-guard.mjs pack), so every release workflow enforces it.
//
//   node scripts/check-packed-hygiene.mjs <package.tgz> [...]
//
// Findings name file:line, the rule and its reason. A credential-shaped match is never echoed.
// Self-test: node --test scripts/test-packed-hygiene.mjs
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { gunzipSync } from 'node:zlib';

/** Paths no published package ships. Matched against the path inside the package. */
export const PATH_RULES = [
  {
    id: 'source-map',
    pattern: /\.map$/i,
    reason: 'source maps expose build layout and are not needed at runtime',
  },
  {
    // No package ships a spec/ documentation directory today, so there is no exception.
    id: 'test-or-fixture',
    pattern: /(?:^|\/)(?:tests?|__tests__|fixtures?|specs?)\/|\.(?:test|spec)\.[^/]+$/i,
    reason: 'tests and fixtures are development material, not package content',
  },
];

/** Hosts a packed file may name in a URL. Everything else is refused. */
export const PUBLIC_HOSTS = new Set([
  'sess.si',
  'api.sess.si',
  'app.sess.si',
  'mcp.sess.si',
  'docs.sess.si',
  'github.com',
  'registry.npmjs.org',
  'www.npmjs.com',
  'slsa.dev',
  'www.apache.org',
  'modelcontextprotocol.io',
  'static.modelcontextprotocol.io',
  'www.w3.org',
  'www.nayuki.io',
  'creativecommons.org',
  'api.met.no',
  'www.weather.gov',
  'api.weather.gov',
  'example.com',
]);
/** Loopback literals: documented local test flags only ever point at the caller's own machine. */
export const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);
/**
 * Not hosts: documentation placeholders (`scheme://host[:port]`) and runtime-built URLs whose
 * authority is a template interpolation (`http://${host}`) or absent (`https://` in prose).
 */
export const PLACEHOLDER_HOSTS = new Set(['', 'host']);
const isTemplateHost = (host) => host.startsWith('$');
/** Refused with a specific reason (they are also absent from PUBLIC_HOSTS). */
export const DENIED_HOSTS = [
  { pattern: /(?:^|\.)preview\.sess\.si$/, reason: 'preview environment host' },
  { pattern: /(?:^|\.)ondigitalocean\.app$/, reason: 'hosting provider default host (non-public)' },
  { pattern: /(?:^|\.)sigstage\.dev$/, reason: 'staging host' },
  { pattern: /(?:^|[.-])staging(?:[.-]|$)/, reason: 'staging host' },
  { pattern: /\.(?:internal|local)$/, reason: 'private network host' },
];

/** Text rules applied line by line to every packed text file. */
export const CONTENT_RULES = [
  {
    id: 'source-map-comment',
    pattern: /[#@]\s*sourceMappingURL\s*=/,
    reason: 'source map references point at files that are not shipped',
  },
  {
    // Catches these hosts even without a scheme, or after a template interpolation.
    id: 'non-public-host-name',
    pattern: /(?:\bpreview\.sess\.si|\.ondigitalocean\.app|\bsigstage\.dev)\b/i,
    reason: 'preview, staging or hosting-provider host name',
  },
  // Credential-shaped strings. secret: true means the matched text is never printed.
  {
    id: 'sess-credential',
    pattern: /sess_(?:sk|mg|tk|mk)_[A-Za-z0-9_-]{16,}/,
    reason: 'Sess owner/management/token credential shape',
    secret: true,
  },
  {
    id: 'human-link-token',
    pattern: /\/s\/[A-Za-z0-9_-]{43}(?![A-Za-z0-9_-])/,
    reason: 'human link capability token shape (/s/<43 chars>)',
    secret: true,
  },
  {
    id: 'stripe-key',
    pattern: /\b(?:sk|rk)_live_[A-Za-z0-9]{8,}|\bsk_test_[A-Za-z0-9]{8,}/,
    reason: 'payment provider secret key shape',
    secret: true,
  },
  {
    id: 'github-token',
    pattern: /\bghp_[A-Za-z0-9]{20,}|\bgithub_pat_[A-Za-z0-9_]{20,}/,
    reason: 'GitHub token shape',
    secret: true,
  },
  { id: 'npm-token', pattern: /\bnpm_[A-Za-z0-9]{36}\b/, reason: 'npm token shape', secret: true },
  { id: 'aws-key', pattern: /\bAKIA[0-9A-Z]{16}\b/, reason: 'AWS access key ID shape', secret: true },
  {
    id: 'private-key',
    pattern: /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
    reason: 'private key PEM header',
    secret: true,
  },
  {
    id: 'jwt',
    pattern: /\beyJ[A-Za-z0-9_-]{8,}\.eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/,
    reason: 'JWT-shaped string',
    secret: true,
  },
  // Model-provider keys: the adapters and recipes are run with these, so they must never ship.
  // \b before sk keeps words such as task- or desk- out; each body is long and key-alphabet only.
  {
    id: 'anthropic-key',
    pattern: /\bsk-ant-[A-Za-z0-9_-]{20,}/,
    reason: 'Anthropic API/admin key shape (sk-ant-api03-, sk-ant-admin01-)',
    secret: true,
  },
  {
    id: 'openai-key',
    pattern: /\bsk-(?:proj|svcacct|admin)-[A-Za-z0-9_-]{20,}/,
    reason: 'OpenAI project, service-account or admin key shape',
    secret: true,
  },
  {
    // Legacy OpenAI keys: sk- then 32+ letters and digits with at least one digit (not prose).
    id: 'openai-legacy-key',
    pattern: /\bsk-(?=[A-Za-z]*\d)[A-Za-z0-9]{32,}(?![\w-])/,
    reason: 'OpenAI legacy secret key shape',
    secret: true,
  },
  {
    id: 'openrouter-key',
    pattern: /\bsk-or-v1-[A-Za-z0-9]{32,}/,
    reason: 'OpenRouter API key shape',
    secret: true,
  },
  {
    id: 'google-api-key',
    pattern: /\bAIza[0-9A-Za-z_-]{35}(?![\w-])/,
    reason: 'Google API key shape',
    secret: true,
  },
  // No Cursor API key format is publicly documented, so there is no Cursor-specific rule.
  // Internal references: private repositories, internal documents and process, local machines.
  { id: 'internal-docs', pattern: /\bDOCS\//, reason: 'internal monorepo document path' },
  { id: 'internal-execution', pattern: /\bEXECUTION\//, reason: 'internal execution record path' },
  { id: 'internal-review', pattern: /\bASTRA\b/, reason: 'internal review process name' },
  { id: 'internal-founder', pattern: /\bfounder\b/i, reason: 'internal decision-maker reference' },
  { id: 'internal-orchestrator', pattern: /\borchestrator\b/i, reason: 'internal agent process reference' },
  { id: 'internal-worktree', pattern: /\bworktrees?\b/i, reason: 'internal development checkout reference' },
  { id: 'local-path', pattern: /\/Users\/|\/home\//, reason: 'local machine path' },
  { id: 'local-keychain', pattern: /\bKeychain\b/i, reason: 'local credential store reference' },
  { id: 'agent-config', pattern: /\.claude\//, reason: 'internal agent configuration path' },
  {
    id: 'private-pr',
    // sess #12, sess-sdk #27, Sess PR #444, sess-sdk PR #10, w1991e/sess master, PR #431.
    pattern: /(?<![\w@/.-])(?:w1991e\/)?sess(?:-sdk)?(?:\s+master,)?\s+(?:PR\s+)?#\d+/i,
    reason: 'private repository pull request reference',
  },
  {
    id: 'private-commit',
    pattern: /(?<![\w@/.-])sess\s+(?:commit\s+|at\s+)?[0-9a-f]{40}\b/i,
    reason: 'private repository commit reference',
  },
];

/** A URL with userinfo (user[:password]@host) is a secret finding: the match is never printed. */
export const URL_USERINFO_REASON = 'URL carries userinfo (user[:password]@), a credential position';
const URL_USERINFO_PATTERN = /\b[a-z][a-z0-9+.-]*:\/\/[^\s/'"`<>]*@/gi;
const URL_PATTERN = /\b[a-z][a-z0-9+.-]*:\/\/([^\s/?#'"`<>()[\]{}\\,;|]*)/gi;

/** The host a URL authority names, lower-cased, without userinfo or port. */
export function hostOf(authority) {
  const hostPort = authority.slice(authority.lastIndexOf('@') + 1).toLowerCase();
  if (hostPort.startsWith('[')) return hostPort.slice(0, hostPort.indexOf(']') + 1);
  return hostPort.replace(/:\d*$/, '').replace(/\.$/, '');
}

/** Why a URL host is refused, or null when it is public or loopback. */
export function hostFinding(host) {
  if (PUBLIC_HOSTS.has(host) || LOOPBACK_HOSTS.has(host)) return null;
  if (PLACEHOLDER_HOSTS.has(host) || isTemplateHost(host)) return null;
  const denied = DENIED_HOSTS.find((d) => d.pattern.test(host));
  return denied ? denied.reason : 'host is not on the public allowlist';
}

const excerpt = (text) => (text.length > 80 ? `${text.slice(0, 77)}...` : text);

/**
 * Scans packed entries ({ path, bytes }) and returns findings { file, line, rule, reason, match? }.
 * match is omitted for credential rules.
 */
export function scanEntries(entries) {
  const findings = [];
  for (const { path, bytes } of entries) {
    for (const rule of PATH_RULES)
      if (rule.pattern.test(path)) findings.push({ file: path, line: 0, rule: rule.id, reason: rule.reason });
    // Binary files (a NUL byte) are covered by the path rules only.
    if (bytes.subarray(0, 8192).includes(0)) continue;
    const lines = bytes.toString('utf8').split(/\r?\n/);
    lines.forEach((text, index) => {
      const line = index + 1;
      for (const rule of CONTENT_RULES) {
        const match = text.match(rule.pattern);
        if (match)
          findings.push({
            file: path,
            line,
            rule: rule.id,
            reason: rule.reason,
            ...(rule.secret ? {} : { match: excerpt(match[0]) }),
          });
      }
      // Any userinfo is refused before a host is judged, and never echoed: it is where a URL
      // carries a password or token, whatever the host. Fail closed: an @ anywhere before the
      // path (even after a stray ? or #) counts.
      for (const _ of text.matchAll(URL_USERINFO_PATTERN))
        findings.push({ file: path, line, rule: 'url-userinfo', reason: URL_USERINFO_REASON });
      for (const [, authority] of text.matchAll(URL_PATTERN)) {
        const host = hostOf(authority);
        const reason = hostFinding(host);
        if (reason)
          findings.push({ file: path, line, rule: 'non-public-host', reason, match: excerpt(host) });
      }
    });
  }
  return findings;
}

/** Regular-file entries of a gzip'd tar archive, with npm's leading package/ removed. */
export function readTarball(bytes) {
  const tar = gunzipSync(bytes);
  const entries = [];
  let offset = 0;
  let pax = {};
  let longName = null;
  const field = (block, start, length) => {
    const raw = block.subarray(start, start + length);
    const end = raw.indexOf(0);
    return raw.subarray(0, end === -1 ? length : end).toString('utf8');
  };
  while (offset + 512 <= tar.length) {
    const header = tar.subarray(offset, offset + 512);
    if (header.every((b) => b === 0)) break;
    const size = parseInt(field(header, 124, 12).trim() || '0', 8);
    if (!Number.isFinite(size) || size < 0) throw new Error('Malformed tar header size.');
    const type = String.fromCharCode(header[156] || 48);
    const body = tar.subarray(offset + 512, offset + 512 + size);
    if (body.length !== size) throw new Error('Truncated tar archive.');
    offset += 512 + Math.ceil(size / 512) * 512;
    if (type === 'x') {
      pax = {};
      for (const record of body.toString('utf8').split('\n')) {
        const m = /^\d+ ([^=]+)=(.*)$/.exec(record);
        if (m) pax[m[1]] = m[2];
      }
      continue;
    }
    if (type === 'L') {
      longName = body.toString('utf8').replace(/\0+$/, '');
      continue;
    }
    if (type === 'g') continue;
    let path = field(header, 0, 100);
    const prefix = field(header, 257, 6).startsWith('ustar') ? field(header, 345, 155) : '';
    if (prefix) path = `${prefix}/${path}`;
    path = pax.path ?? longName ?? path;
    pax = {};
    longName = null;
    if (type !== '0' && type !== '\0' && type !== '7') {
      // Directories carry no content; links and devices have no place in a package.
      if (type !== '5') entries.push({ path: path.replace(/^package\//, ''), bytes: Buffer.alloc(0), type });
      continue;
    }
    entries.push({ path: path.replace(/^package\//, ''), bytes: Buffer.from(body) });
  }
  return entries;
}

/** Scans one packed .tgz. Returns { files, findings }. */
export function checkTarball(tgzPath) {
  const entries = readTarball(readFileSync(tgzPath));
  const findings = scanEntries(entries.filter((e) => !e.type));
  for (const e of entries.filter((x) => x.type))
    findings.push({ file: e.path, line: 0, rule: 'non-file-entry', reason: `tar entry type ${e.type}` });
  return { files: entries.length, findings };
}

export function formatFinding(f) {
  return `${f.file}:${f.line} ${f.rule}: ${f.reason}${f.match ? ` [${f.match}]` : ''}`;
}

/** Throws with every finding listed when the tarball is not clean; returns the file count. */
export function assertPackedHygiene(tgzPath) {
  const { files, findings } = checkTarball(tgzPath);
  if (findings.length)
    throw new Error(
      `packed-hygiene: ${findings.length} finding(s) in ${tgzPath}:\n  ${findings.map(formatFinding).join('\n  ')}`,
    );
  return files;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const paths = process.argv.slice(2);
  if (!paths.length) {
    console.error('usage: node scripts/check-packed-hygiene.mjs <package.tgz> [...]');
    process.exit(2);
  }
  let failed = false;
  for (const path of paths) {
    const { files, findings } = checkTarball(path);
    if (findings.length) {
      failed = true;
      console.error(`packed-hygiene: FAIL ${path} (${files} files, ${findings.length} findings)`);
      for (const f of findings) console.error(`  ${formatFinding(f)}`);
    } else console.log(`packed-hygiene: PASS ${path} (${files} files)`);
  }
  process.exit(failed ? 1 : 0);
}
