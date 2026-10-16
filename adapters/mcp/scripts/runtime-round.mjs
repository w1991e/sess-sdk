// Isolated-runtime rounds (OPT-IN; not part of public CI because they need a running SESS runtime).
//
// Drives the PACKED, INSTALLED adapter over stdio with the official MCP client against an already
// running, isolated SESS runtime that uses synthetic credentials only:
//   request (round-1 fixture) -> URL + handle returned immediately
//   response wait_ms=0 -> waiting; response wait_ms=1500 -> needs_resume
//   person submits answer-1 through the human HTTP form (client_event_id and surface_revision
//   are taken from the rendered form; the fixture supplies only action_id and data)
//   response (bounded wait, full receipt verification) -> answered
//   publish (round-2 fixture) -> waiting at revision 2; identical replay -> same result, no write;
//   replay with a different body -> PENDING_MUTATION_DIFFERS
//   person answers round 2 ({confirmed: true}, supplied by this harness) -> answered (verified)
//   complete -> completed, confirmed by an owner read (revision 2, two responses)
//
// Required environment:
//   SESS_MCP_RUNTIME_ROUND=1
//   SESS_RUNTIME_ORIGIN       e.g. http://localhost:18081 (loopback only)
//   SESS_RUNTIME_OWNER_KEY_FILE (or SESS_RUNTIME_OWNER_KEY) synthetic owner key of that runtime
// Never point this at a deployed environment. Output redacts the human link and the key.
import { readFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { adapterDir, installPacked } from './lib/install-packed.mjs';
import { connectStdio } from './lib/mcp-client.mjs';

if (process.env.SESS_MCP_RUNTIME_ROUND !== '1') {
  console.log('runtime-round: skipped (set SESS_MCP_RUNTIME_ROUND=1 with a local isolated runtime).');
  process.exit(0);
}
const origin = process.env.SESS_RUNTIME_ORIGIN ?? '';
const ownerKey = process.env.SESS_RUNTIME_OWNER_KEY_FILE
  ? (await readFile(process.env.SESS_RUNTIME_OWNER_KEY_FILE, 'utf8')).trim()
  : (process.env.SESS_RUNTIME_OWNER_KEY ?? '');
const url = new URL(origin);
if (!['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) || !ownerKey)
  throw new Error(
    'runtime-round: SESS_RUNTIME_ORIGIN must be a loopback runtime and SESS_RUNTIME_OWNER_KEY set.',
  );

const secrets = [ownerKey];
const redact = (text) => {
  let out = String(text);
  for (const s of secrets) if (s) out = out.split(s).join('[redacted]');
  return out.replace(/\/s\/[^\s"'<>?#]*/g, '/s/[capability]');
};
const log = (step, value) =>
  console.log(`${step}: ${redact(typeof value === 'string' ? value : JSON.stringify(value))}`);
function check(condition, message) {
  if (!condition) throw new Error(`runtime-round: ${message}`);
}

const fixtures = join(adapterDir, '..', 'fixtures', 'plan-afternoon');
const round1 = JSON.parse(await readFile(join(fixtures, 'round-1.json'), 'utf8'));
const answer1 = JSON.parse(await readFile(join(fixtures, 'answer-1.json'), 'utf8'));
const round2 = JSON.parse(await readFile(join(fixtures, 'round-2.json'), 'utf8'));
// The shared fixtures have no round-2 answer; this harness supplies one.
const answer2 = { action_id: 'confirm', data: { confirmed: true } };

const install = await installPacked();
const state = await mkdtemp(join(tmpdir(), 'sess-mcp-round-state-'));
const started = Date.now();
let session;
try {
  log(
    'installed',
    `${install.packed.id} (${install.packed.files.length} files, ${install.packed.size} bytes) + @sess.si/sdk@${JSON.parse(await readFile(join(adapterDir, 'compatibility.json'), 'utf8')).sessSdk.version} ${install.sdkMode.toUpperCase()}`,
  );
  session = await connectStdio({
    binPath: install.binPath,
    cwd: install.consumer,
    env: {
      PATH: process.env.PATH ?? '',
      SESS_API_KEY: ownerKey,
      SESS_API_ORIGIN: url.origin,
      SESS_MCP_TEST_ALLOW_INSECURE_LOCALHOST: '1',
      SESS_MCP_STATE_DIR: state,
    },
  });
  const { client } = session;
  log('server', client.getServerVersion());
  const call = async (name, args, options) => {
    const t = Date.now();
    const result = await client.callTool({ name, arguments: args }, undefined, options);
    check(!result.isError, `${name} failed: ${redact(result.content?.[0]?.text)}`);
    return { ...result.structuredContent, ms: Date.now() - t };
  };

  const requested = await call('sess_request', { interaction: round1 });
  const { handle, humanUrl } = requested.interaction;
  secrets.push(humanUrl, humanUrl.split('/').pop());
  check(requested.interaction.state === 'waiting' && requested.interaction.revision === 1, 'request state');
  check(humanUrl.startsWith(`${url.origin}/s/`), 'human URL origin');
  log('sess_request', {
    state: requested.interaction.state,
    revision: 1,
    humanUrl: '[returned, redacted]',
    ms: requested.ms,
  });

  const first = await call('sess_response', { handle, revision: 1, wait_ms: 0 });
  check(first.interaction.state === 'waiting', 'single read before an answer must be waiting');
  log('sess_response wait_ms=0', { state: first.interaction.state, ms: first.ms });

  const resumed = await call('sess_response', { handle, revision: 1, wait_ms: 1500 });
  check(resumed.interaction.state === 'needs_resume', 'bounded wait without an answer must be needs_resume');
  log('sess_response wait_ms=1500', { state: resumed.interaction.state, ms: resumed.ms });

  // The person answers through the human HTTP form. client_event_id and surface_revision come
  // from the rendered form; the fixture/harness supplies only action_id and data.
  async function humanSubmit(expectedRevision, answer) {
    const page = await fetch(humanUrl, { redirect: 'manual' });
    const html = await page.text();
    const clientEventId = /name="client_event_id" value="([A-Za-z0-9_-]+)"/.exec(html)?.[1];
    const surfaceRevision = /name="surface_revision" value="([0-9]+)"/.exec(html)?.[1];
    check(
      page.status === 200 && clientEventId && surfaceRevision === String(expectedRevision),
      `human form for revision ${expectedRevision} not rendered`,
    );
    const form = new URLSearchParams([
      ['client_event_id', clientEventId],
      ['surface_revision', surfaceRevision],
      ['action_id', answer.action_id],
      ...Object.entries(answer.data).map(([k, v]) => [`data.${k}`, String(v)]),
    ]);
    const submitted = await fetch(humanUrl, {
      method: 'POST',
      redirect: 'manual',
      headers: {
        'content-type': 'application/x-www-form-urlencoded',
        'sec-fetch-site': 'same-origin',
        origin: 'null',
      },
      body: form.toString(),
    });
    await submitted.text();
    log(`human submit revision ${expectedRevision}`, { status: submitted.status });
    check(submitted.status < 400, 'human submission rejected');
  }
  function checkAnswered(result, revision, answer) {
    const response = result.interaction.response;
    check(
      result.interaction.state === 'answered' && result.interaction.revision === revision,
      'expected answered',
    );
    check(
      response.verified === true && response.actorAssurance === 'link_holder',
      'verified link_holder answer',
    );
    check(JSON.stringify(response.data) === JSON.stringify(answer.data), 'answer data differs');
    check(response.actionId === answer.action_id, 'action differs');
    log(`sess_response revision ${revision} wait_ms=45000`, {
      state: result.interaction.state,
      revision: result.interaction.revision,
      eventId: response.eventId,
      actionId: response.actionId,
      data: response.data,
      verified: response.verified,
      actorAssurance: response.actorAssurance,
      ms: result.ms,
    });
    return response;
  }

  // Round 1: start the bounded wait, then the person answers.
  const waiting1 = call('sess_response', { handle, revision: 1, wait_ms: 45000 });
  await humanSubmit(1, answer1);
  const response1 = checkAnswered(await waiting1, 1, answer1);

  // Publish round 2 from the verified answer; an identical replay is recognized without a write.
  const publishArgs = {
    handle,
    expected_revision: 1,
    response_event_id: response1.eventId,
    interaction: round2,
  };
  const published = await call('sess_publish', publishArgs);
  check(
    published.interaction.state === 'waiting' && published.interaction.revision === 2,
    'expected revision 2',
  );
  log('sess_publish', {
    state: published.interaction.state,
    revision: published.interaction.revision,
    ms: published.ms,
  });
  const replay = await call('sess_publish', publishArgs);
  check(replay.interaction.revision === 2, 'identical publish replay');
  const different = await client.callTool({
    name: 'sess_publish',
    arguments: { ...publishArgs, interaction: { ...round2, title: 'A different step' } },
  });
  check(
    different.isError && different.content[0].text.includes('PENDING_MUTATION_DIFFERS'),
    'differing replay',
  );
  log('sess_publish replay', { identical: 'waiting r2', differentBody: 'PENDING_MUTATION_DIFFERS' });

  // Round 2: answer is supplied by this harness (no answer-2 fixture exists).
  const waiting2 = call('sess_response', { handle, revision: 2, wait_ms: 45000 });
  await humanSubmit(2, answer2);
  const response2 = checkAnswered(await waiting2, 2, answer2);

  const completed = await call('sess_complete', {
    handle,
    expected_revision: 2,
    response_event_id: response2.eventId,
  });
  check(completed.interaction.state === 'completed', 'expected completed');
  log('sess_complete', {
    state: completed.interaction.state,
    revision: completed.interaction.revision,
    ms: completed.ms,
  });

  // Independent owner read of the terminal state (not through the adapter).
  const records = await readFile(join(state, 'profiles', 'default', 'handles', `${handle}.json`), 'utf8');
  const sessionId = JSON.parse(records).sessionId;
  const owner = await fetch(`${url.origin}/v1/sessions/${sessionId}`, {
    headers: { authorization: `Bearer ${ownerKey}` },
  });
  const remote = await owner.json();
  check(
    remote.status === 'completed' && remote.revision === 2 && remote.responses.length === 2,
    'remote state is not completed at revision 2 with two responses',
  );
  log('owner read', { status: remote.status, revision: remote.revision, responses: remote.responses.length });
  check(!records.includes(ownerKey), 'local record contains the owner key');
  check(!records.includes(humanUrl), 'completed record still holds the human link');
  check(
    !redact(session.stderr()).includes(humanUrl) && !session.stderr().includes(humanUrl),
    'stderr leaked link',
  );
  check(!session.stderr().includes(ownerKey), 'stderr leaked key');
  log('stderr lines', session.stderr().trim().split('\n').length);
  log('result', `PASS in ${Date.now() - started} ms`);
} finally {
  await session?.close().catch(() => undefined);
  await install.cleanup();
  await rm(state, { recursive: true, force: true });
}
