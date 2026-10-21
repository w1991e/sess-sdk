// A weekend planner on real weather. It asks you where and when (question 1), reads the live
// MET Norway forecast, offers three plans you can pick or correct (question 2), then prints your
// plan with a verified receipt. Needs SESS_API_KEY and SESS_DEMO_CONTACT in the environment.
// The weather, the plan rule and their attribution are in weather.mjs.
import { randomUUID } from 'node:crypto';
import { Sess } from '@sess.si/sdk';
import * as w from './weather.mjs';

const CONTACT = process.env.SESS_DEMO_CONTACT?.trim() ?? '';
if (!process.env.SESS_API_KEY) stop('Set SESS_API_KEY in your environment first.');
if (!w.isContact(CONTACT))
  stop('Set SESS_DEMO_CONTACT to a project URL or team email. The weather services ask for one.');
const sess = new Sess({ apiKey: process.env.SESS_API_KEY });

console.log('Agent running. Asking where and when.');
try {
  const created = await sess.sessions.create({ interaction: whereAndWhen() });
  const id = created.data.id;
  console.log(
    `Open this private link on your phone. Anyone with it can answer:\n  ${created.data.human_url}`,
  );

  const first = await answer(id, created.data.revision);
  const trip = w.readTrip(first.data);
  const weather = await w.weatherFor(trip, CONTACT);
  const options = w.propose(weather.slots);
  const next = { interaction: pickAPlan(trip, weather, options) };
  const published = await sess.sessions.publish(id, next, {
    ifMatch: first.etag,
    idempotencyKey: randomUUID(),
  });
  console.log('Question 2 is on the same link.');

  const second = await answer(id, published.data.revision);
  const plan = w.readPlan(second.data, options, weather.slots, trip);
  const done = await sess.sessions.complete(id, { ifMatch: second.etag, idempotencyKey: randomUUID() });

  console.log(`\nYour plan: ${plan.text} in ${trip.name} (${plan.weather}).`);
  console.log(weather.forecast ? `${w.ATTRIBUTION}\n${w.RULE}` : 'No forecast was available for this plan.');
  if (weather.alerts === null) console.log(w.NWS_DOWN);
  const at = new Date(second.at).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
  console.log(`\nYou approved "${plan.text}" at ${at} · verified ✓`);
  console.log(`Verify this yourself at https://sess.si/verify\nSession ${id} is ${done.data.status}.`);
} catch (error) {
  const unknown = error?.outcome === 'unknown' ? ' The outcome is unknown: check the Session first.' : '';
  stop(`Stopped: ${error instanceof Error ? error.message : 'unknown error'}${unknown}`);
}

/** Waits for the person's answer to `revision` and verifies its signed receipt. */
async function answer(id, revision) {
  const reply = await sess.sessions.waitForResponse(id, { revision });
  const { response } = await sess.receipts.verifyResponse({ sessionId: id, response: reply.response });
  return { data: response.data, at: response.accepted_at, etag: reply.meta.etag };
}

/** Question 1: where and when. */
function whereAndWhen() {
  const places = Object.fromEntries(Object.entries(w.CITIES).map(([id, city]) => [id, city[0]]));
  return form('Plan your weekend', 'Question 1 of 2', { id: 'next', label: 'Next', intent: 'continue' }, [
    { type: 'text', text: 'Tell me where and when. I will suggest three plans that fit the forecast.' },
    field('place', 'Where', places),
    field('day', 'Which day', { saturday: 'Saturday', sunday: 'Sunday' }),
  ]);
}

/** Question 2: three plans from a fixed rule; pick one or change its time. */
function pickAPlan(trip, weather, options) {
  // Option labels stay under 60 characters; the forecast above shows each slot's weather.
  const plans = options.map((o) => [o.id, `${o.idea} — ${o.slot.name}`]);
  const times = [['keep', 'Keep the suggested time'], ...w.SLOTS.map((s) => [s[0], s[1]])];
  const action = { id: 'approve', label: 'Make my plan', intent: 'approve' };
  return form('Pick your plan', 'Question 2 of 2', action, [
    ...w.weatherShown(trip, weather),
    field('choice', 'Pick a plan', Object.fromEntries(plans), w.RULE),
    field('time', 'Time', Object.fromEntries(times)),
  ]);
}

/** @returns {import('@sess.si/sdk').InteractiveInteraction} */
function form(title, description, action, components) {
  return {
    mode: 'interactive',
    title,
    description,
    source: { kind: 'sess_surface', components },
    actions: [action],
  };
}
function field(name, label, choices, description) {
  const values = Object.keys(choices);
  const schema = { type: 'string', enum: values };
  return {
    type: 'field',
    name,
    label,
    description,
    required: true,
    schema,
    option_labels: choices,
    value: values[0],
  };
}
function stop(message) {
  console.error(message);
  process.exit(1);
}
