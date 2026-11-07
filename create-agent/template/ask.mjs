// The class check: one question for three people through one link. Each person answers on their
// own page, and their answers print here as they come in, each verified by its signed receipt.
// Needs SESS_API_KEY in the environment. Run: node ask.mjs
import { setTimeout as wait } from 'node:timers/promises';
import { Sess } from '@sess.si/sdk';

if (!process.env.SESS_API_KEY) stop('Set SESS_API_KEY in your environment first.');
const sess = new Sess({ apiKey: process.env.SESS_API_KEY });

try {
  const ask = await sess.ask({
    question: 'End of class check',
    fields: [{ type: 'rating', name: 'clarity', label: 'How clear was today’s lesson?', max: 5 }],
    respondents: { max: 3 },
  });
  console.log(`Share this link with three people. Each gets their own page:\n  ${ask.link}`);

  const seen = new Set();
  for (;;) {
    const read = await ask.read(); // each answer here is already checked against its receipt
    for (const r of read.respondents) {
      if (!r.answer || seen.has(r.sessionId)) continue;
      seen.add(r.sessionId);
      console.log(`Answer ${seen.size}: ${r.answer.clarity} stars, verified ✓`);
    }
    if (seen.size === ask.max || (read.status === 'closed' && read.closedBy !== 'max')) break;
    await wait(3000);
  }
  console.log(`${seen.size} answered. This Ask is closed.`);
} catch (error) {
  const unknown = error?.outcome === 'unknown' ? ' The outcome is unknown: check the Ask first.' : '';
  stop(`Stopped: ${error instanceof Error ? error.message : 'unknown error'}${unknown}`);
}

function stop(message) {
  console.error(message);
  process.exit(1);
}
