// Opt-in local smoke for the installed quickstart. Not run by public CI.
// Requires an isolated loopback SESS runtime with synthetic credentials:
//   SESS_QUICKSTART_SMOKE=1 SESS_API_URL=http://localhost:18083 SESS_API_KEY=... node scripts/smoke.mjs
// It runs index.mjs twice: (A) answer while waiting, then complete; (B) time out, answer, resume the
// same Session with SESS_SESSION_ID and complete. The human side is driven by plain form POSTs.
// Output is redacted: no API key, human URL or capability path is printed.
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

if (process.env.SESS_QUICKSTART_SMOKE !== '1') {
  console.log('Skipped: set SESS_QUICKSTART_SMOKE=1 to run against a local runtime.');
  process.exit(0);
}
const apiKey = process.env.SESS_API_KEY;
const apiUrl = process.env.SESS_API_URL;
if (!apiKey || !apiUrl) throw new Error('SESS_API_KEY and SESS_API_URL are required.');
const { protocol, hostname } = new URL(apiUrl);
if (protocol !== 'http:' || !['localhost', '127.0.0.1', '[::1]'].includes(hostname))
  throw new Error('This smoke only targets an isolated loopback runtime.');

const directory = fileURLToPath(new URL('..', import.meta.url));
const secrets = new Set([apiKey]);
function redact(text) {
  let out = text;
  for (const secret of [...secrets].sort((a, b) => b.length - a.length))
    out = out.split(secret).join('[redacted]');
  return out.replace(/\/s\/[^\s"'<>]*/g, '/s/[redacted]');
}

function runExample(extraEnv, onHumanUrl) {
  const child = spawn(process.execPath, ['index.mjs'], {
    cwd: directory,
    env: { ...process.env, SESS_ALLOW_INSECURE_LOCALHOST: '1', ...extraEnv },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let stdout = '';
  let stderr = '';
  let pending = '';
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
      if (match) {
        secrets.add(match[1]);
        onHumanUrl?.(match[1]);
      }
    }
  });
  child.stderr.on('data', (chunk) => (stderr += chunk));
  return new Promise((resolve) =>
    child.on('exit', (code) => resolve({ code, stdout: redact(stdout), stderr: redact(stderr) })),
  );
}

async function respond(humanUrl, amount) {
  const page = await fetch(humanUrl, { redirect: 'manual', signal: AbortSignal.timeout(15_000) });
  const html = await page.text();
  const clientEventId = /name="client_event_id" value="([A-Za-z0-9_-]+)"/.exec(html)?.[1];
  const revision = /name="surface_revision" value="([0-9]+)"/.exec(html)?.[1];
  if (page.status !== 200 || !clientEventId || !revision)
    throw new Error(`Human page did not render a form (HTTP ${page.status}).`);
  const posted = await fetch(humanUrl, {
    method: 'POST',
    redirect: 'manual',
    headers: {
      'content-type': 'application/x-www-form-urlencoded',
      'sec-fetch-site': 'same-origin',
      origin: 'null',
    },
    body: new URLSearchParams([
      ['client_event_id', clientEventId],
      ['surface_revision', revision],
      ['action_id', 'submit'],
      ['data.amount', String(amount)],
    ]).toString(),
    signal: AbortSignal.timeout(15_000),
  });
  await posted.arrayBuffer();
  if (posted.status !== 303 && posted.status !== 200)
    throw new Error(`Human submission returned HTTP ${posted.status}.`);
  return posted.status;
}

function report(label, result) {
  console.log(`--- ${label}: exit ${result.code} ---`);
  process.stdout.write(result.stdout);
  if (result.stderr) process.stdout.write(`[stderr]\n${result.stderr}`);
}

let failed = false;
function expect(condition, message) {
  if (!condition) {
    failed = true;
    console.log(`FAIL: ${message}`);
  }
}

// A: respond while the example waits.
let submitA;
const a = await runExample({ SESS_WAIT_SECONDS: '60' }, (url) => {
  submitA = respond(url, 95).catch((error) => error);
});
report('A answer while waiting', a);
const statusA = await submitA;
console.log(`human submission ${statusA instanceof Error ? redact(statusA.message) : `HTTP ${statusA}`}`);
expect(statusA === 303 || statusA === 200, 'A human submission should be accepted');
expect(a.code === 0, 'A should exit 0');
expect(/Verified response evt_\S+: amount = 95\n/.test(a.stdout), 'A should verify amount 95');
expect(/status: completed\n$/.test(a.stdout), 'A should end completed');

// B: time out honestly, respond later, resume the same Session.
let urlB;
const b1 = await runExample({ SESS_WAIT_SECONDS: '5' }, (url) => (urlB = url));
report('B1 timeout', b1);
expect(b1.code === 3 && /Still waiting/.test(b1.stdout), 'B1 should report still waiting with exit 3');
const sessionB = /SESS_SESSION_ID=(ses_\w+)/.exec(b1.stdout)?.[1];
expect(Boolean(urlB && sessionB), 'B1 should print a human URL and a resume Session ID');
if (urlB && sessionB) {
  console.log(`human submission HTTP ${await respond(urlB, 42.5)}`);
  const b2 = await runExample({ SESS_WAIT_SECONDS: '30', SESS_SESSION_ID: sessionB });
  report('B2 resume', b2);
  expect(b2.code === 0, 'B2 should exit 0');
  expect(!/Human URL:/.test(b2.stdout), 'B2 should not create another Session');
  expect(/amount = 42\.5\n/.test(b2.stdout) && /status: completed\n$/.test(b2.stdout), 'B2 completes');
}
console.log(failed ? 'SMOKE FAILED' : 'SMOKE PASSED');
process.exit(failed ? 1 : 0);
