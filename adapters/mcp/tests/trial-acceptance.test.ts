// Acceptance: the whole trial-mode journey over the MCP protocol against a stubbed Sess HTTP server
// on loopback (real HTTP, the adapter's own fetch; no live calls, no credential configured):
// ask → link → person answers → verified result → restart (a new server instance on the same state
// directory) → resume reading the same Session, and the trial is reused rather than started again.
// Every tool result and every diagnostic line of the journey is scanned for the trial credential.
import { readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { stderrDiagnostics } from '../src/errors.js';
import { createSessMcpServer } from '../src/server.js';
import { tempDir } from './helpers.js';
import { TrialStub } from './trial-stub.js';

let dir: ReturnType<typeof tempDir>;
let stub: TrialStub;
beforeEach(async () => {
  dir = tempDir();
  stub = new TrialStub();
  await stub.listen();
});
afterEach(async () => {
  await stub.close();
  dir.cleanup();
});

/** One stdio-equivalent server process: environment only, no test seams, stderr diagnostics. */
async function start(transcript: string[], stderr: string[]) {
  let secrets: () => readonly string[] = () => [];
  const created = createSessMcpServer({
    env: {
      SESS_API_ORIGIN: stub.origin,
      SESS_MCP_TEST_ALLOW_INSECURE_LOCALHOST: '1',
      SESS_MCP_STATE_DIR: dir.path,
    },
    diagnostics: stderrDiagnostics(
      (line) => stderr.push(line),
      () => secrets(),
    ),
  });
  secrets = () => created.adapter.secrets();
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await created.connect(serverTransport);
  const client = new Client({ name: 'acceptance-client', version: '0.0.0' });
  await client.connect(clientTransport);
  const call = async (name: string, args: Record<string, unknown>) => {
    const result = await client.callTool({ name, arguments: args });
    transcript.push(JSON.stringify(result));
    return result as { isError?: boolean; structuredContent?: any; content: { text: string }[] };
  };
  return { client, call };
}

describe('trial mode acceptance (no Sess signup or API key)', () => {
  it('ask → link → answer → verified result → restart → resume; the credential never leaves protected state', async () => {
    const transcript: string[] = [];
    const stderr: string[] = [];

    // 1. Connect and list tools: no request reaches Sess.
    const first = await start(transcript, stderr);
    transcript.push(JSON.stringify(await first.client.listTools()));
    expect(stub.calls).toHaveLength(0);

    // 2. Ask: the first real ask starts the trial and returns the Sess link at once.
    const asked = await first.call('sess_ask', {
      question: 'Which time works for the call?',
      fields: [
        { name: 'time', label: 'Time', type: 'choice', options: ['Tuesday 10:00', 'Wednesday 14:00'] },
      ],
    });
    expect(asked.isError).toBeFalsy();
    const { handle, humanUrl, state, expiresAt } = asked.structuredContent.interaction;
    expect(state).toBe('waiting');
    const [sessionId, session] = [...stub.sessions.entries()][0]!;
    expect(humanUrl).toBe(session.humanUrl);
    expect(typeof expiresAt).toBe('string');
    expect(stub.anonymousCreates()).toHaveLength(1);
    const credential = stub.credentials()[0]!;

    // 3. Before the person answers, the read says so.
    const early = await first.call('sess_response', { handle, revision: 1, wait_ms: 0 });
    expect(early.structuredContent.interaction.state).toBe('waiting');

    // 4. The person answers on the Sess link; the agent receives the verified, typed result.
    const eventId = stub.answer(sessionId, { time: 'Wednesday 14:00' });
    const answered = await first.call('sess_response', { handle, revision: 1, wait_ms: 0 });
    expect(answered.isError).toBeFalsy();
    expect(answered.structuredContent.interaction).toEqual({
      handle,
      revision: 1,
      state: 'answered',
      response: {
        eventId,
        actionId: 'submit',
        data: { time: 'Wednesday 14:00' },
        verified: true,
        actorAssurance: 'link_holder',
      },
    });
    // The receipt was verified against the published keys, fetched without any credential.
    const keyReads = stub.calls.filter((c) => c.path === '/.well-known/sess-receipt-keys.json');
    expect(keyReads.length).toBeGreaterThan(0);
    for (const c of keyReads) expect(c.authorization).toBeNull();
    await first.client.close();

    // 5. Restart: a new server instance on the same state directory resumes the same Session.
    const second = await start(transcript, stderr);
    const resumed = await second.call('sess_response', { handle, revision: 1, wait_ms: 0 });
    expect(resumed.isError).toBeFalsy();
    expect(resumed.structuredContent.interaction.response).toMatchObject({ eventId, verified: true });
    const reads = stub.calls.filter(
      (c) => c.method === 'GET' && c.path === `/v1/trial/sessions/${sessionId}`,
    );
    expect(reads.at(-1)!.authorization).toBe(`Bearer ${credential}`);

    // 6. Repeat use after the restart reuses the trial; no second trial is started.
    const again = await second.call('sess_ask', {
      question: 'And the place?',
      fields: [{ name: 'place', label: 'Place', type: 'text' }],
    });
    expect(again.isError).toBeFalsy();
    expect(stub.anonymousCreates()).toHaveLength(1);
    expect(stub.trials.size).toBe(1);

    // 7. Trial mode says plainly what it cannot do.
    const complete = await second.call('sess_complete', {
      handle,
      expected_revision: 1,
      response_event_id: eventId,
    });
    expect(complete.isError).toBe(true);
    expect(JSON.parse(complete.content[0]!.text).error.code).toBe('TRIAL_UNSUPPORTED');
    await second.client.close();

    // The credential appears in no tool result, transcript line, diagnostic line or request URL,
    // and Sess links never reach diagnostics.
    const everything = [...transcript, ...stderr].join('\n');
    expect(everything).not.toContain(credential);
    expect(everything).not.toContain(credential.slice('sess_mg_'.length));
    for (const call of stub.calls) expect(call.path).not.toContain(credential.slice('sess_mg_'.length));
    expect(stderr.join('')).not.toContain(humanUrl);
    expect(stderr.join('')).toContain('sess-mcp: trial_started');

    // It lives only in the owner-private state file.
    const trials = join(dir.path, 'profiles', 'default', 'trials');
    const files = readdirSync(trials);
    expect(files).toHaveLength(1);
    if (process.platform !== 'win32') expect(statSync(join(trials, files[0]!)).mode & 0o777).toBe(0o600);
  });
});
