// Clean copied-directory install/run check for the Node quickstart.
//
//   node examples/quickstart-node/scripts/clean-install-check.mjs [--tarball <path>] [--keep]
//
// 1. Copies this example to a fresh temporary directory outside the SDK repository, with no
//    node_modules in any ancestor directory, so nothing resolves from the repository by accident.
// 2. Obtains the SDK candidate tarball (--tarball, SESS_SDK_CANDIDATE_TGZ, or `npm pack` of the SDK
//    repository root, whose dist must already be built) and accepts it only if its SHA-256 equals the
//    pinned reviewed candidate digest below.
// 3. Installs it with lifecycle scripts disabled, exactly as the example README documents.
// 4. Runs `node index.mjs` against a deterministic fake SESS API on loopback that serves create,
//    retrieve, wait, Surface, complete and a genuinely Ed25519-signed receipt plus key set. The child
//    environment holds only PATH, SESS_API_KEY, the loopback SESS_API_URL and the loopback opt-in:
//    no workspace override. The workspace comes from the authenticated Sess-Workspace-Id header.
//
// It proves: the human URL is printed before waiting (the fake person answers only after seeing it
// and after at least one unanswered poll), the response is verified, and the Session completes.
// The SESS API traffic is loopback only; `npm install` resolves the SDK's own pinned public
// dependencies from the configured npm registry or cache. Output never contains the API key or
// the human URL.
import { execFileSync, spawn } from 'node:child_process';
import { createHash, generateKeyPairSync, randomBytes, sign } from 'node:crypto';
import { createServer } from 'node:http';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const PINNED = Object.freeze({
  name: '@sess.si/sdk',
  version: '0.1.0-rc.3',
  sha256: 'b4d29d8ff01fe8f21d2c7d72e1a8c7ed08ec7cf903efd98715a55a308daa0502',
});
const RUN_TIMEOUT_MS = 90_000;

const example = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const sdkRoot = resolve(example, '..', '..');
const args = process.argv.slice(2);
const keep = args.includes('--keep');
const tarballArg = args.includes('--tarball') ? args[args.indexOf('--tarball') + 1] : undefined;
if (args.includes('--tarball') && !tarballArg) {
  console.error('clean-install-check: --tarball requires a path.');
  process.exit(2);
}

function fail(message) {
  throw new Error(`FAIL: ${message}`);
}
function sha256(path) {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}
function npm(argv, cwd) {
  const options = { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] };
  if (process.env.npm_execpath)
    return execFileSync(process.execPath, [process.env.npm_execpath, ...argv], options);
  return execFileSync('npm', argv, { ...options, shell: process.platform === 'win32' });
}
function isInside(child, parent) {
  const rel = relative(parent, child);
  return rel === '' || (!rel.startsWith('..') && !rel.startsWith(sep) && rel !== '..');
}

// --- Fresh directory outside the repository, with no ancestor node_modules. ---
const work = realpathSync(mkdtempSync(join(realpathSync(tmpdir()), 'sess-quickstart-clean-')));
const app = join(work, 'quickstart-node');
const candidateDir = join(work, 'candidate');

let server;
let exitCode = 1;
try {
  if (isInside(work, realpathSync(sdkRoot))) fail('temporary directory is inside the SDK repository.');
  for (let dir = dirname(work); ; dir = dirname(dir)) {
    if (existsSync(join(dir, 'node_modules'))) fail(`an ancestor directory has node_modules: ${dir}`);
    if (dirname(dir) === dir) break;
  }
  mkdirSync(candidateDir);
  // --- Candidate tarball, accepted only by digest. ---
  const supplied = tarballArg ?? process.env.SESS_SDK_CANDIDATE_TGZ;
  let tarball;
  if (supplied) {
    tarball = join(candidateDir, basename(supplied));
    cpSync(resolve(supplied), tarball);
  } else {
    const manifest = JSON.parse(readFileSync(join(sdkRoot, 'package.json'), 'utf8'));
    if (manifest.name !== PINNED.name || manifest.version !== PINNED.version)
      fail(`SDK root is ${manifest.name}@${manifest.version}, not ${PINNED.name}@${PINNED.version}.`);
    if (!existsSync(join(sdkRoot, 'dist', 'index.js')))
      fail('build the SDK root first (npm ci --ignore-scripts && npm run build at the repository root).');
    const packed = JSON.parse(
      npm(['pack', '--json', '--ignore-scripts', '--pack-destination', candidateDir], sdkRoot),
    )[0];
    tarball = join(candidateDir, packed.filename);
  }
  const digest = sha256(tarball);
  if (digest !== PINNED.sha256)
    fail(`candidate sha256 ${digest} is not the pinned ${PINNED.sha256}. Refusing it.`);
  console.log(`accepted CANDIDATE ${PINNED.name}@${PINNED.version} sha256=${digest}`);

  // --- Copy the example as a user would: no node_modules, no lockfile. ---
  cpSync(example, app, {
    recursive: true,
    filter: (source) => !/(?:^|[\\/])(?:node_modules|package-lock\.json)$/.test(source),
  });
  const appManifest = JSON.parse(readFileSync(join(app, 'package.json'), 'utf8'));
  if (appManifest.dependencies?.[PINNED.name] !== PINNED.version)
    fail(`example package.json must declare "${PINNED.name}": "${PINNED.version}" exactly.`);
  npm(['install', '--ignore-scripts', '--no-audit', '--no-fund', tarball], app);
  const installed = JSON.parse(
    readFileSync(join(app, 'node_modules', '@sess.si', 'sdk', 'package.json'), 'utf8'),
  );
  if (installed.name !== PINNED.name || installed.version !== PINNED.version)
    fail('installed @sess.si/sdk identity differs from the pinned candidate.');
  console.log(`installed into a clean copy with --ignore-scripts (node ${process.version})`);

  // --- Deterministic fake SESS API on loopback. ---
  const fake = createFakeSess();
  server = createServer(fake.handle);
  await new Promise((done) => server.listen(0, '127.0.0.1', done));
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  fake.setBaseUrl(baseUrl);

  const result = await runExample(app, baseUrl, fake);
  const state = fake.state();
  const secrets = [fake.apiKey, ...(result.humanUrl ? [result.humanUrl] : [])];
  const redact = (text) => {
    let out = text;
    for (const secret of secrets) out = out.split(secret).join('[redacted]');
    return out.replace(/\/s\/[^\s"'<>]*/g, '/s/[redacted]');
  };
  console.log(`--- index.mjs exit ${result.code} (redacted transcript) ---`);
  process.stdout.write(redact(result.stdout));
  if (result.stderr) process.stdout.write(`[stderr]\n${redact(result.stderr)}`);
  console.log('--- end transcript ---');

  const lines = result.stdout.split('\n');
  const urlLine = lines.findIndex((line) => line.startsWith('Human URL: '));
  const waitLine = lines.findIndex((line) => line.startsWith('Waiting up to '));
  const failures = [];
  const expect = (condition, message) => condition || failures.push(message);
  expect(result.code === 0, 'index.mjs exits 0');
  expect(result.stderr === '', 'index.mjs writes nothing to stderr');
  expect(urlLine >= 0 && waitLine > urlLine, 'the human URL is printed before waiting starts');
  expect(state.humanUrlSeenBeforeSubmit, 'the person answered only after the URL was printed');
  expect(state.unansweredPollsBeforeSubmit >= 1, 'the program was waiting before the answer existed');
  expect(state.creates === 1, 'exactly one Session is created');
  expect(state.unauthorized === 0, 'every API request carried the API key');
  expect(state.keySetReads >= 1, 'the receipt key set was fetched from the API origin');
  expect(state.surfaceReads >= 1, 'the immutable Surface revision was read for verification');
  expect(state.completeChecks === true, 'complete carried the current If-Match and an Idempotency-Key');
  expect(state.status === 'completed', 'the fake runtime recorded completion');
  expect(
    new RegExp(`^Verified response ${fake.eventId}: amount = 95$`, 'm').test(result.stdout),
    'the verified, validated amount is printed',
  );
  expect(/status: completed\n$/.test(result.stdout), 'the program ends with the completed status');
  expect(!`${result.stdout}${result.stderr}`.includes(fake.apiKey), 'the API key is never printed');
  if (failures.length) {
    for (const message of failures) console.log(`FAIL: ${message}`);
    console.log('CLEAN INSTALL CHECK FAILED');
  } else {
    console.log(
      'CLEAN INSTALL CHECK PASSED: digest-verified candidate, clean copy, only SESS_API_KEY ' +
        '(workspace from authenticated header), URL before waiting, verified response, completed.',
    );
    exitCode = 0;
  }
} catch (error) {
  console.error(`clean-install-check: ${error instanceof Error ? error.message : String(error)}`);
} finally {
  server?.close();
  if (keep) console.log(`kept ${work}`);
  else rmSync(work, { recursive: true, force: true });
}
process.exit(exitCode);

function runExample(cwd, baseUrl, fake) {
  // Minimal environment: nothing else from this process (no workspace override) reaches the program.
  const env = {
    PATH: process.env.PATH ?? '',
    SESS_API_KEY: fake.apiKey,
    SESS_API_URL: baseUrl,
    SESS_ALLOW_INSECURE_LOCALHOST: '1',
  };
  const child = spawn(process.execPath, ['index.mjs'], { cwd, env, stdio: ['ignore', 'pipe', 'pipe'] });
  let stdout = '';
  let stderr = '';
  let pending = '';
  let humanUrl;
  const timer = setTimeout(() => child.kill('SIGKILL'), RUN_TIMEOUT_MS);
  child.stdout.setEncoding('utf8');
  child.stderr.setEncoding('utf8');
  child.stdout.on('data', (chunk) => {
    stdout += chunk;
    pending += chunk;
    let index;
    while ((index = pending.indexOf('\n')) >= 0) {
      const line = pending.slice(0, index);
      pending = pending.slice(index + 1);
      const match = /^Human URL: (\S+)$/.exec(line);
      if (match && !humanUrl) {
        humanUrl = match[1];
        fake.personReceivedUrl(humanUrl);
      }
    }
  });
  child.stderr.on('data', (chunk) => (stderr += chunk));
  return new Promise((done) =>
    child.on('exit', (code, signal) => {
      clearTimeout(timer);
      done({ code: code ?? signal, stdout, stderr, humanUrl });
    }),
  );
}

// JCS for the plain JSON used here (strings, integers, objects, arrays).
function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value !== null && typeof value === 'object')
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`)
      .join(',')}}`;
  return JSON.stringify(value);
}
function contentDigest(value) {
  return `sha256:${createHash('sha256').update(canonical(value)).digest('hex')}`;
}

function createFakeSess() {
  // Synthetic, per-run values. The key pair is ephemeral and never leaves this process.
  const apiKey = `sess_fake_${randomBytes(24).toString('base64url')}`;
  const capability = randomBytes(24).toString('base64url');
  const workspace = 'wks_quickstart_fake';
  const sessionId = `ses_${'0'.repeat(25)}Q`;
  const eventId = `evt_${'0'.repeat(25)}1`;
  const kid = 'quickstart-fake-1';
  const { privateKey, publicKey } = generateKeyPairSync('ed25519');
  const keySet = {
    keys: [
      {
        kty: 'OKP',
        crv: 'Ed25519',
        x: publicKey.export({ format: 'jwk' }).x,
        kid,
        alg: 'EdDSA',
        use: 'sig',
        key_ops: ['verify'],
      },
    ],
  };
  let baseUrl;
  let session;
  let humanUrlSeen = false;
  const state = {
    creates: 0,
    unauthorized: 0,
    keySetReads: 0,
    surfaceReads: 0,
    unansweredPollsAfterUrl: 0,
    unansweredPollsBeforeSubmit: 0,
    humanUrlSeenBeforeSubmit: false,
    completeChecks: false,
    submitted: false,
  };
  const etag = () => `"${session.revision}-${session.status}"`;

  function send(res, status, body, headers = {}) {
    res.writeHead(status, {
      'content-type': 'application/json',
      'cache-control': 'no-store',
      ...headers,
    });
    res.end(body === undefined ? '' : JSON.stringify(body));
  }
  function authed(res, status, body, headers = {}) {
    send(res, status, body, { 'sess-workspace-id': workspace, ...headers });
  }
  function apiError(res, status, code) {
    send(res, status, { error: { code, request_id: 'fake-request', message: code } });
  }
  async function bodyOf(req) {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const text = Buffer.concat(chunks).toString('utf8');
    return text ? JSON.parse(text) : undefined;
  }
  function sessionView() {
    return structuredClone(session);
  }

  // The fake person: answers through the human link once it has seen the printed URL and the
  // program has polled the still-unanswered Session at least once.
  function personReceivedUrl(url) {
    humanUrlSeen = true;
    const attempt = () => {
      if (state.unansweredPollsAfterUrl < 1) return void setTimeout(attempt, 50);
      fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action_id: 'submit', data: { amount: 95 } }),
      }).catch(() => {});
    };
    attempt();
  }

  function accept(actionId, data) {
    const acceptedMillis = Date.now();
    const acceptedAt = new Date(acceptedMillis).toISOString();
    const claims = {
      sess_receipt: 1,
      iss: baseUrl,
      aud: workspace,
      jti: eventId,
      iat: Math.floor(acceptedMillis / 1000),
      exp: Math.floor(acceptedMillis / 1000) + 3600,
      accepted_at: acceptedAt,
      workspace_id: workspace,
      session_id: sessionId,
      step_id: 'rev_1',
      event_id: eventId,
      surface: {
        revision: 1,
        hash: contentDigest(session.interaction),
        renderer_version: 'sess-html-form-1',
      },
      action: { id: actionId, label: 'Submit amount', summary: 'submit' },
      input_hash: contentDigest(data),
      actor: { assurance: 'link_holder', subject: `${workspace}:human_link:${sessionId}` },
      return_binding: { recipient: workspace, return_channel_id: null },
    };
    const header = Buffer.from(JSON.stringify({ alg: 'EdDSA', kid, typ: 'sess-receipt+jwt' })).toString(
      'base64url',
    );
    const signingInput = `${header}.${Buffer.from(canonical(claims)).toString('base64url')}`;
    const receipt = `${signingInput}.${sign(null, Buffer.from(signingInput), privateKey).toString('base64url')}`;
    session.responses.push({
      event_id: eventId,
      sequence: 1,
      revision: 1,
      action_id: actionId,
      data,
      actor: { assurance: 'link_holder' },
      accepted_at: acceptedAt,
      receipt,
    });
    session.status = 'responded';
  }

  async function handle(req, res) {
    try {
      const url = new URL(req.url, baseUrl);
      const path = url.pathname;
      if (req.method === 'GET' && path === '/.well-known/sess-receipt-keys.json') {
        state.keySetReads++;
        return send(res, 200, keySet);
      }
      if (path === `/s/${capability}`) {
        if (req.method !== 'POST' || !session || session.status !== 'active')
          return apiError(res, 409, 'NOT_ACCEPTING');
        const body = await bodyOf(req);
        state.humanUrlSeenBeforeSubmit = humanUrlSeen;
        state.unansweredPollsBeforeSubmit = state.unansweredPollsAfterUrl;
        state.submitted = true;
        accept(body.action_id, body.data);
        return send(res, 200, { accepted: true });
      }
      if (!path.startsWith('/v1/')) return apiError(res, 404, 'NOT_FOUND');
      if (req.headers.authorization !== `Bearer ${apiKey}`) {
        state.unauthorized++;
        return apiError(res, 401, 'UNAUTHENTICATED');
      }
      if (req.method === 'POST' && path === '/v1/sessions') {
        state.creates++;
        if (session) return apiError(res, 409, 'UNEXPECTED_SECOND_CREATE');
        const body = await bodyOf(req);
        const interaction = { ...body.interaction, response_policy: 'first' };
        session = {
          id: sessionId,
          revision: 1,
          status: 'active',
          interaction,
          response_schema: {
            type: 'object',
            properties: { amount: { type: 'number', minimum: 0, maximum: 1000000 } },
            required: ['amount'],
            additionalProperties: false,
          },
          responses: [],
        };
        return authed(
          res,
          201,
          { id: sessionId, revision: 1, human_url: `${baseUrl}/s/${capability}` },
          {
            etag: etag(),
          },
        );
      }
      if (!session || !path.startsWith(`/v1/sessions/${sessionId}`)) return apiError(res, 404, 'NOT_FOUND');
      const rest = path.slice(`/v1/sessions/${sessionId}`.length);
      if (req.method === 'GET' && rest === '') {
        if (session.status === 'active' && humanUrlSeen && !state.submitted) state.unansweredPollsAfterUrl++;
        return authed(res, 200, sessionView(), { etag: etag() });
      }
      if (req.method === 'GET' && rest === '/surfaces/1') {
        state.surfaceReads++;
        return authed(res, 200, {
          id: sessionId,
          revision: 1,
          interaction: structuredClone(session.interaction),
          response_schema: structuredClone(session.response_schema),
        });
      }
      if (req.method === 'POST' && rest === '/complete') {
        const ifMatch = req.headers['if-match'];
        const key = req.headers['idempotency-key'];
        if (ifMatch !== etag()) return apiError(res, 412, 'PRECONDITION_FAILED');
        if (typeof key !== 'string' || key.length < 8) return apiError(res, 400, 'IDEMPOTENCY_KEY_REQUIRED');
        if (session.status !== 'responded') return apiError(res, 409, 'NOT_RESPONDED');
        state.completeChecks = true;
        session.status = 'completed';
        return authed(res, 200, sessionView(), { etag: etag() });
      }
      return apiError(res, 404, 'NOT_FOUND');
    } catch {
      return apiError(res, 500, 'FAKE_FAILURE');
    }
  }

  return {
    apiKey,
    eventId,
    handle,
    personReceivedUrl,
    setBaseUrl: (value) => (baseUrl = value),
    state: () => ({ ...state, status: session?.status }),
  };
}
