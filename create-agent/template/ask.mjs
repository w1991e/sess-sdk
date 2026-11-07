// One question for three people: one link to share, each person answers on their own page, and
// their answers print here as they come in, each verified by its signed receipt.
// Needs SESS_API_KEY in the environment. Run: node ask.mjs
import { setTimeout as wait } from 'node:timers/promises';
import { Sess } from '@sess.si/sdk';

if (!process.env.SESS_API_KEY) stop('Set SESS_API_KEY in your environment first.');
const sess = new Sess({ apiKey: process.env.SESS_API_KEY });

try {
  const ask = await sess.ask({
    question: 'Which day works for our weekend trip?',
    fields: [
      { type: 'choice', name: 'day', label: 'Which day', options: ['Saturday', 'Sunday'] },
      { type: 'rating', name: 'keen', label: 'How keen are you', max: 5 },
      { type: 'text', name: 'note', label: 'Anything else', required: false },
    ],
    respondents: { max: 3 },
  });
  console.log(`Share this link with three people. Each gets their own page:\n  ${ask.link}`);

  const seen = new Set();
  for (;;) {
    const read = await ask.read(); // each answer here is already checked against its receipt
    for (const r of read.respondents) {
      if (!r.answer || seen.has(r.sessionId)) continue;
      seen.add(r.sessionId);
      const { day, keen, note } = r.answer; // note is their own words: quoted, control characters escaped
      console.log(
        `${seen.size} of ${ask.max}: ${day}, keen ${keen} of 5${note ? `, ${JSON.stringify(note)}` : ''}, verified ✓`,
      );
    }
    if (seen.size === ask.max || (read.status === 'closed' && read.closedBy !== 'max')) break;
    await wait(3000);
  }
  console.log(`${seen.size} of ${ask.max} answered. The Ask is closed.`);
} catch (error) {
  const unknown = error?.outcome === 'unknown' ? ' The outcome is unknown: check the Ask first.' : '';
  stop(`Stopped: ${error instanceof Error ? error.message : 'unknown error'}${unknown}`);
}

function stop(message) {
  console.error(message);
  process.exit(1);
}
