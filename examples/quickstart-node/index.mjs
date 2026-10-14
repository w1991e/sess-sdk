// Installed-package quickstart for @sess.si/sdk: create one interactive Session, give the private
// human link to the local developer, wait a bounded time, verify the receipt, validate the business
// data, then complete the Session. Plain Node ESM; no build step.
import { randomUUID } from 'node:crypto';
import { Sess, SessError } from '@sess.si/sdk';

// A tiny synthetic interaction. Ordinary data; SESS owns the hosted renderer.
const interaction = {
  mode: 'interactive',
  title: 'Confirm a synthetic amount',
  description: 'Quickstart example with fictional data. Nothing is paid or sent.',
  source: {
    kind: 'sess_surface',
    components: [
      { type: 'text', text: 'Correct the proposed amount if needed, then submit.' },
      {
        type: 'field',
        name: 'amount',
        label: 'Amount (USD)',
        required: true,
        schema: { type: 'number', minimum: 0, maximum: 1000000 },
        value: 120,
      },
    ],
  },
  actions: [{ id: 'submit', label: 'Submit amount', intent: 'submit' }],
};
// This example publishes exactly one revision; resuming waits on the same one.
const REVISION = 1;
const SESSION_ID = /^ses_[0-9A-HJKMNP-TV-Z]{26}$/;

function fail(message, code = 1) {
  console.error(message);
  process.exit(code);
}

function waitSeconds() {
  const raw = process.env.SESS_WAIT_SECONDS;
  if (raw === undefined || raw === '') return 180;
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < 5 || value > 900)
    fail('SESS_WAIT_SECONDS must be an integer from 5 to 900.', 2);
  return value;
}

function resumeHint(sessionId) {
  return `Resume without creating another Session:\n  SESS_SESSION_ID=${sessionId} npm start`;
}

/** Business validation of verified data. Verification proves what SESS accepted, not that it is valid here. */
function acceptedAmount(response) {
  const data = response.data;
  if (response.action_id !== 'submit') throw new Error('Unexpected action in the accepted response.');
  if (!data || typeof data !== 'object' || Object.keys(data).join() !== 'amount')
    throw new Error('Accepted data does not have the expected shape.');
  const amount = data.amount;
  if (typeof amount !== 'number' || !Number.isFinite(amount) || amount < 0 || amount > 1_000_000)
    throw new Error('Accepted amount is outside the range this application accepts.');
  return amount;
}

const apiKey = process.env.SESS_API_KEY;
if (!apiKey) fail('Set SESS_API_KEY in the environment (never as an argument).', 2);
const resumeId = process.env.SESS_SESSION_ID || undefined;
if (resumeId !== undefined && !SESSION_ID.test(resumeId))
  fail('SESS_SESSION_ID must be a Session ID such as ses_...', 2);
const expectedWorkspaceId = process.env.SESS_EXPECTED_WORKSPACE_ID || undefined;

let sess;
try {
  sess = new Sess({
    apiKey,
    ...(process.env.SESS_API_URL ? { baseUrl: process.env.SESS_API_URL } : {}),
    // Plain HTTP is accepted only for loopback, and only when explicitly enabled for local tests.
    allowInsecureLocalhost: process.env.SESS_ALLOW_INSECURE_LOCALHOST === '1',
  });
} catch (error) {
  fail(error instanceof SessError ? error.message : 'Invalid SESS client configuration.', 2);
}

let sessionId = resumeId;
if (sessionId === undefined) {
  let created;
  try {
    // Creation is never retried: a lost reply may still mean the Session exists.
    created = await sess.sessions.create({ interaction });
  } catch (error) {
    if (error instanceof SessError && error.outcome === 'unknown')
      fail('Creation outcome is unknown. A Session may exist; do not re-run blindly.');
    fail(`Could not create the Session: ${error instanceof Error ? error.message : 'unknown error'}`);
  }
  sessionId = created.data.id;
  console.log(`Created Session ${sessionId} (revision ${created.data.revision}).`);
  console.log('Open this private link to respond. It is a bearer link: anyone holding it can respond.');
  console.log(`Human URL: ${created.data.human_url}`);
} else {
  console.log(`Resuming Session ${sessionId}. Use the human link printed when it was created.`);
}

const seconds = waitSeconds();
const controller = new AbortController();
process.once('SIGINT', () => controller.abort());
console.log(`Waiting up to ${seconds} s for the response (Ctrl+C stops waiting; the Session stays open)...`);

let answer;
try {
  answer = await sess.sessions.waitForResponse(sessionId, {
    revision: REVISION,
    timeoutMs: seconds * 1000,
    signal: controller.signal,
  });
} catch (error) {
  if (error instanceof SessError && error.kind === 'aborted') {
    console.log('Stopped waiting before a response was seen. The Session remains open.');
    console.log(resumeHint(sessionId));
    process.exit(130);
  }
  if (error instanceof SessError && error.kind === 'wait_ended' && error.code === 'WAIT_TIMEOUT') {
    console.log('Still waiting: no response yet. The Session remains open.');
    console.log(resumeHint(sessionId));
    process.exit(3);
  }
  fail(`Waiting ended: ${error instanceof Error ? error.message : 'unknown error'}`);
}

let amount;
try {
  const verified = await sess.receipts.verifyResponse({
    sessionId,
    response: answer.response,
    ...(expectedWorkspaceId ? { expectedWorkspaceId } : {}),
  });
  amount = acceptedAmount(verified.response);
} catch (error) {
  fail(`Response rejected: ${error instanceof Error ? error.message : 'verification failed'}`);
}
console.log(`Verified response ${answer.response.event_id}: amount = ${amount}`);

let status = answer.session.status;
if (status === 'responded' && answer.session.revision === REVISION) {
  try {
    const completed = await sess.sessions.complete(sessionId, {
      ifMatch: answer.meta.etag,
      idempotencyKey: randomUUID(),
    });
    status = completed.data.status;
  } catch (error) {
    if (error instanceof SessError && error.outcome === 'unknown')
      fail(`Completion outcome is unknown; it is not reported as done.\n${resumeHint(sessionId)}`);
    fail(`Could not complete the Session: ${error instanceof Error ? error.message : 'unknown error'}`);
  }
}
if (status !== 'completed') fail(`Session is ${status}, not completed. Reconcile before continuing.`);
console.log(`Session ${sessionId} status: ${status}`);
