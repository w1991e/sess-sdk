// OPT-IN runtime-round evidence: one deterministic round through a REAL OpenClaw Gateway that has the
// INSTALLED packed plugin, against an ISOLATED local SESS runtime with synthetic credentials.
// Not run in public CI (it needs the private runtime). No LLM: tools are invoked through the
// Gateway's documented POST /tools/invoke endpoint, and sessions are created/reset through the
// documented sessions.create / sessions.reset Gateway methods. Human URLs are never printed.
//
// Required environment (all synthetic / local):
//   RUNTIME_ROUND_OPENCLAW_BIN     command that runs `openclaw` in the disposable profile
//   RUNTIME_ROUND_GATEWAY_URL      e.g. http://127.0.0.1:18799 (loopback only)
//   RUNTIME_ROUND_GATEWAY_TOKEN    disposable gateway token
//   RUNTIME_ROUND_SESS_ORIGIN      SESS_PUBLIC_BASE_URL of the isolated runtime, e.g. http://localhost:18082
//   RUNTIME_ROUND_FIXTURES         path to adapters/fixtures/plan-afternoon
import { execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const need = (name) => {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
};
const bin = need('RUNTIME_ROUND_OPENCLAW_BIN');
const gateway = need('RUNTIME_ROUND_GATEWAY_URL');
const token = need('RUNTIME_ROUND_GATEWAY_TOKEN');
const sessOrigin = need('RUNTIME_ROUND_SESS_ORIGIN');
const fixtures = need('RUNTIME_ROUND_FIXTURES');
for (const url of [gateway, sessOrigin])
  if (!['127.0.0.1', 'localhost', '[::1]'].includes(new URL(url).hostname))
    throw new Error(
      'Runtime-round evidence runs against loopback services only; never a deployed environment.',
    );

const fixture = (name) => JSON.parse(readFileSync(join(fixtures, name), 'utf8'));
const secrets = new Set([token]);
const redact = (value) => {
  let text = typeof value === 'string' ? value : JSON.stringify(value);
  for (const secret of secrets) text = text.split(secret).join('[redacted]');
  return text.replace(/\/s\/[A-Za-z0-9_-]+/g, '/s/[redacted]');
};
const log = (step, data) => console.log(`${step}: ${redact(data)}`);
const port = new URL(gateway).port;

function gatewayCall(method, params) {
  const out = execFileSync(
    bin,
    [
      'gateway',
      'call',
      method,
      '--port',
      port,
      '--token',
      token,
      '--json',
      '--params',
      JSON.stringify(params),
    ],
    { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
  );
  return JSON.parse(out.slice(out.indexOf('{')));
}

async function invoke(tool, sessionKey, args) {
  const started = performance.now();
  const response = await fetch(`${gateway}/tools/invoke`, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify({ tool, sessionKey, args }),
  });
  const body = await response.json();
  const ms = Math.round(performance.now() - started);
  const details = body?.result?.details;
  if (details?.interaction?.humanUrl) secrets.add(details.interaction.humanUrl);
  return { status: response.status, ok: body.ok === true, details, error: body.error, ms };
}

async function submitHuman(humanUrl, revision, answer) {
  const form = new URLSearchParams({
    client_event_id: randomBytes(16).toString('base64url'),
    surface_revision: String(revision),
    action_id: answer.action_id,
  });
  for (const [key, value] of Object.entries(answer.data))
    for (const item of Array.isArray(value) ? value : [value]) form.append(`data.${key}`, String(item));
  const response = await fetch(humanUrl, {
    method: 'POST',
    redirect: 'manual',
    headers: {
      'content-type': 'application/x-www-form-urlencoded',
      origin: sessOrigin,
      'sec-fetch-site': 'same-origin',
    },
    body: form.toString(),
  });
  await response.arrayBuffer();
  return response.status;
}

const check = (condition, message) => {
  if (!condition) throw new Error(`Runtime round check failed: ${message}`);
  console.log(`PASS ${message}`);
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  console.log('Deterministic host invocation (no LLM) through the installed packed plugin.');
  const a = gatewayCall('sessions.create', { agentId: 'main', label: `round-a-${Date.now()}` });
  const b = gatewayCall('sessions.create', { agentId: 'main', label: `round-b-${Date.now()}` });

  // 1. request -> private link + handle, returned before any wait.
  const request = await invoke('sess_request', a.key, { interaction: fixture('round-1.json') });
  log('sess_request', { status: request.status, ms: request.ms, details: request.details });
  const first = request.details?.interaction;
  check(
    request.ok && first?.state === 'waiting' && first.revision === 1,
    'request returns waiting revision 1',
  );
  check(
    typeof first.humanUrl === 'string' && first.humanUrl.startsWith(`${sessOrigin}/s/`),
    'human link returned before any wait (return-link-first)',
  );

  // 2. timeout/pending is normal and creates nothing (wait_ms 0 = one read).
  const pending = await invoke('sess_response', a.key, { handle: first.handle, revision: 1, wait_ms: 0 });
  log('sess_response(pending)', { ms: pending.ms, details: pending.details });
  check(
    pending.ok && pending.details?.interaction?.state === 'waiting',
    'unanswered read-once (wait_ms 0) returns waiting (contract "Response outcomes")',
  );

  // 3. another conversation cannot use the handle.
  const foreign = await invoke('sess_response', b.key, { handle: first.handle, revision: 1, wait_ms: 0 });
  check(!foreign.ok, 'same handle from another conversation is refused');

  // 4. live wait; the person submits during it; the verified answer returns to the same call.
  const waiting = invoke('sess_response', a.key, { handle: first.handle, revision: 1, wait_ms: 45000 });
  await sleep(2000);
  const submitted = performance.now();
  const answer1 = fixture('answer-1.json');
  const status1 = await submitHuman(first.humanUrl, 1, answer1);
  log('human submit (revision 1)', { status: status1 });
  const answered = await waiting;
  const latency = Math.round(performance.now() - submitted);
  log('sess_response(live wait)', { ms: answered.ms, submitToResultMs: latency, details: answered.details });
  const r1 = answered.details?.interaction;
  check(
    answered.ok && r1?.state === 'answered' && r1.response?.verified === true,
    'verified answer returned through the live invocation',
  );
  check(
    r1.response.actorAssurance === 'link_holder' && r1.response.actionId === answer1.action_id,
    'actor assurance is link_holder and action matches',
  );
  check(
    JSON.stringify(r1.response.data) === JSON.stringify(answer1.data),
    'verified data equals the submitted answer',
  );

  // 5. next revision on the same link, answered, then completed.
  const publish = await invoke('sess_publish', a.key, {
    handle: first.handle,
    expected_revision: 1,
    response_event_id: r1.response.eventId,
    interaction: fixture('round-2.json'),
  });
  log('sess_publish', { ms: publish.ms, details: publish.details });
  check(
    publish.ok &&
      publish.details?.interaction?.revision === 2 &&
      publish.details.interaction.humanUrl === undefined,
    'revision 2 published (same Session; link released only by request)',
  );
  const waiting2 = invoke('sess_response', a.key, { handle: first.handle, revision: 2, wait_ms: 45000 });
  await sleep(1500);
  const status2 = await submitHuman(first.humanUrl, 2, { action_id: 'confirm', data: { confirmed: true } });
  log('human submit (revision 2)', { status: status2 });
  const answered2 = await waiting2;
  log('sess_response(revision 2)', { ms: answered2.ms, details: answered2.details });
  const r2 = answered2.details?.interaction;
  check(
    answered2.ok && r2?.state === 'answered' && r2.response?.data?.confirmed === true,
    'revision 2 verified answer returned',
  );

  const complete = await invoke('sess_complete', a.key, {
    handle: first.handle,
    expected_revision: 2,
    response_event_id: r2.response.eventId,
  });
  log('sess_complete', { ms: complete.ms, details: complete.details });
  check(complete.ok && complete.details?.interaction?.state === 'completed', 'completion confirmed by SESS');
  const again = await invoke('sess_complete', a.key, {
    handle: first.handle,
    expected_revision: 2,
    response_event_id: r2.response.eventId,
  });
  check(
    again.ok && again.details?.interaction?.state === 'completed',
    'repeated complete is idempotent (no second mutation)',
  );

  // 6. Observation only (not a pass condition): does a reset give this key a new incarnation?
  // The adapter binds the host's documented sessionId ("regenerated on /new and /reset"). On
  // OpenClaw 2026.10.3, sessions.reset of a transcript-less session preserved sessionId (only
  // lifecycleRevision, which tool contexts do not expose, changed), so rejection after reset is
  // reported here as an observation, never as a pass.
  const before = gatewayCall('sessions.describe', { key: a.key });
  gatewayCall('sessions.reset', { key: a.key });
  const after = gatewayCall('sessions.describe', { key: a.key });
  const rotated =
    JSON.stringify(before).match(/"sessionId":"([^"]+)"/)?.[1] !==
    JSON.stringify(after).match(/"sessionId":"([^"]+)"/)?.[1];
  const afterReset = await invoke('sess_response', a.key, { handle: first.handle, revision: 2, wait_ms: 0 });
  console.log(
    `OBSERVED reset: sessionId ${rotated ? 'rotated' : 'preserved'}; old handle ${afterReset.ok ? 'still readable' : 'refused'} (${rotated === !afterReset.ok ? 'consistent with binding' : 'UNEXPECTED'})`,
  );
  if (rotated && afterReset.ok)
    throw new Error('Runtime round check failed: a rotated incarnation could read the old handle');
  console.log('Runtime round: ALL CHECKS PASSED');
}

main().catch((error) => {
  console.error(redact(error instanceof Error ? error.message : String(error)));
  process.exitCode = 1;
});
