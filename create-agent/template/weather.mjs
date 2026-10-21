// The weather side of the weekend planner: the city list, the live MET Norway forecast (plus NWS
// alerts in the US), the fixed rule that turns it into three plans, and the attribution the
// providers ask for. agent.mjs asks the questions; this file reads and summarizes the weather.
import { readFile, writeFile } from 'node:fs/promises';

/** Weather request defaults. The contact is added to the User-Agent, as both services ask. */
export const DEFAULTS = {
  userAgent: 'sess-agent-starter/1.0',
  cacheFile: '.weather-cache.json',
  timeoutMs: 8000,
  tries: 3,
  longestWaitMs: 5000,
};

export const ATTRIBUTION =
  'Weather data from MET Norway (https://api.met.no), licensed CC BY 4.0 ' +
  '(https://creativecommons.org/licenses/by/4.0/). Summarized into time slots by this agent.';

export const NWS_DOWN = 'US weather alerts (NWS) could not be reached right now.';
export const RULE = 'Picked by a fixed rule from the forecast. No AI model is used.';

/** A project URL or team email: what MET Norway and NWS ask to find in the User-Agent. */
export function isContact(contact) {
  return /^[\x21-\x7e]+$/.test(contact) && /^(https:\/\/.+\..+|[^@]+@[^@]+\.[^@]+)$/.test(contact);
}

// --- Question 1: where and when. A small city list, so no geocoder is needed. ---
/** @type {Record<string, [name: string, country: string, lat: number, lon: number, zone: string]>} */
export const CITIES = {
  amsterdam: ['Amsterdam', 'NL', 52.3676, 4.9041, 'Europe/Amsterdam'],
  austin: ['Austin', 'US', 30.2672, -97.7431, 'America/Chicago'],
  berlin: ['Berlin', 'DE', 52.52, 13.405, 'Europe/Berlin'],
  chicago: ['Chicago', 'US', 41.8781, -87.6298, 'America/Chicago'],
  ljubljana: ['Ljubljana', 'SI', 46.0569, 14.5058, 'Europe/Ljubljana'],
  london: ['London', 'GB', 51.5072, -0.1276, 'Europe/London'],
  new_york: ['New York', 'US', 40.7128, -74.006, 'America/New_York'],
  oslo: ['Oslo', 'NO', 59.9139, 10.7522, 'Europe/Oslo'],
  paris: ['Paris', 'FR', 48.8566, 2.3522, 'Europe/Paris'],
  san_francisco: ['San Francisco', 'US', 37.7749, -122.4194, 'America/Los_Angeles'],
  sydney: ['Sydney', 'AU', -33.8688, 151.2093, 'Australia/Sydney'],
  tokyo: ['Tokyo', 'JP', 35.6762, 139.6503, 'Asia/Tokyo'],
  toronto: ['Toronto', 'CA', 43.6532, -79.3832, 'America/Toronto'],
};

/** The trip from question 1's verified answer. */
export function readTrip(data) {
  const city = CITIES[String(data.place)];
  if (!city || (data.day !== 'saturday' && data.day !== 'sunday')) throw new Error('Unexpected answer.');
  const [name, country, lat, lon, zone] = city;
  return { name, country, lat, lon, zone, date: weekendDate(data.day, zone) };
}

// --- The weather: MET Norway everywhere, plus NWS alerts in the US. ---
export async function weatherFor({ lat, lon, country, date, zone }, contact) {
  const point = `lat=${deg(lat)}&lon=${deg(lon)}`;
  const forecast = await getJson(
    `https://api.met.no/weatherapi/locationforecast/2.0/compact?${point}`,
    contact,
  );
  const nws = country === 'US' ? `https://api.weather.gov/alerts/active?point=${deg(lat)},${deg(lon)}` : null;
  const found = nws ? await getJson(nws, contact, 'application/geo+json') : { features: [] };
  // null: NWS could not be reached (said so on the page); [] : no active alerts.
  // Sess shows a record value of up to 200 characters and never cuts one: a longer headline gives
  // way to the alert's short event name.
  const fits = (text) => (typeof text === 'string' && [...text].length <= 200 ? text : undefined);
  const alerts = Array.isArray(found?.features)
    ? found.features
        .slice(0, 3)
        .map((a) => fits(a?.properties?.headline) ?? fits(a?.properties?.event) ?? '')
        .filter(Boolean)
    : null;
  return { forecast, slots: summarize(forecast, date, zone), alerts };
}

/** A coordinate truncated (not rounded) to 4 decimals, as MET Norway asks. */
function deg(value) {
  return (Math.trunc(value * 1e4) / 1e4).toFixed(4).replace(/\.?0+$/, '');
}

/** GETs JSON: cached until Expires, then revalidated; up to 3 tries with 429 backoff. */
async function getJson(url, contact, accept = 'application/json') {
  const cache = await readFile(DEFAULTS.cacheFile, 'utf8').then(JSON.parse, () => ({}));
  const hit = cache[url];
  if (hit && Date.now() < hit.expires) return hit.body;
  const headers = { 'user-agent': `${DEFAULTS.userAgent} ${contact}`, accept };
  if (hit?.modified) headers['if-modified-since'] = hit.modified;
  for (let attempt = 1; attempt <= DEFAULTS.tries; attempt++) {
    const signal = AbortSignal.timeout(DEFAULTS.timeoutMs);
    const res = await fetch(url, { headers, redirect: 'error', signal }).catch(() => null);
    if (res && (res.ok || (res.status === 304 && hit))) {
      const body = res.status === 304 ? hit.body : await res.json().catch(() => null);
      if (!body) return null;
      const expires = Date.parse(res.headers.get('expires') ?? '') || Date.now();
      cache[url] = { body, expires, modified: res.headers.get('last-modified') ?? hit?.modified };
      await writeFile(DEFAULTS.cacheFile, JSON.stringify(cache)).catch(() => {});
      return body;
    }
    if (res && res.status < 500 && res.status !== 429) return null; // a refusal: not retried
    const retryAfter = res?.headers.get('retry-after');
    const wait = retryAfter ? Number(retryAfter) * 1000 : 1000 * attempt;
    if (!(wait <= DEFAULTS.longestWaitMs)) return null; // asked to wait longer than a person would
    if (attempt < DEFAULTS.tries) await new Promise((done) => setTimeout(done, wait));
  }
  return null; // an outage: the agent says so and never guesses the weather
}

/** @type {[id: string, name: string, from: number, to: number][]} */
export const SLOTS = [
  ['morning', 'Morning, 09:00–12:00', 9, 12],
  ['afternoon', 'Afternoon, 12:00–17:00', 12, 17],
  ['evening', 'Evening, 17:00–21:00', 17, 21],
];

/** Temperature, rain and wind for each slot of the day (local time), from MET's time series. */
function summarize(forecast, date, zone) {
  return SLOTS.map(([id, name, from, to]) => {
    const temps = [];
    let rain = 0;
    let wind = 0;
    for (const step of forecast?.properties?.timeseries ?? []) {
      const next = step.data?.next_1_hours ?? step.data?.next_6_hours;
      const hours = step.data?.next_1_hours ? 1 : 6;
      const local = localTime(new Date(step.time), zone);
      const overlap = Math.min(local.hour + hours, to) - Math.max(local.hour, from);
      const now = step.data?.instant?.details ?? {};
      if (local.date !== date || overlap <= 0 || typeof now.air_temperature !== 'number') continue;
      temps.push(now.air_temperature);
      wind = Math.max(wind, now.wind_speed ?? 0);
      rain += (next?.details?.precipitation_amount ?? 0) * (overlap / hours);
    }
    if (!temps.length) return { id, name, covered: false, line: 'No forecast' };
    const [lo, hi] = [Math.round(Math.min(...temps)), Math.round(Math.max(...temps))];
    const temp = temps.reduce((a, b) => a + b, 0) / temps.length;
    const wet = rain < 0.2 ? 'dry' : `rain ${rain.toFixed(1)} mm`;
    const line = `${lo === hi ? lo : `${lo}–${hi}`} °C · ${wet} · wind ${Math.round(wind)} m/s`;
    return { id, name, covered: true, temp, rain, wind, line };
  });
}

// --- Question 2: three plans from a fixed rule; pick one or change its time. ---
/** @type {[idea: string, suits: ((slot: any) => boolean) | null][]} */
const IDEAS = [
  // Each idea goes in a slot whose weather suits it, a free slot first. null: any weather.
  ['A walk or hike outdoors', (w) => w.rain < 0.2 && w.temp >= 6 && w.temp <= 26 && w.wind < 10],
  ['A picnic in the park', (w) => w.rain < 0.2 && w.temp >= 16 && w.wind < 6],
  ['A bike ride', (w) => w.rain < 0.2 && w.temp >= 8 && w.wind < 7],
  ['A market or a stroll in town', (w) => w.rain < 1 && w.temp >= 3],
  ['A museum or gallery', null],
  ['A café and a good book', null],
  ['A film at the cinema', null],
];

export function propose(slots) {
  const options = [];
  const free = (s) => !options.some((o) => o.slot === s);
  for (const [idea, suits] of IDEAS) {
    const fits = slots.filter((s) => (suits ? s.covered && suits(s) : true));
    const slot = fits.find(free) ?? fits[0];
    if (slot && options.length < 3) options.push({ id: `option_${options.length + 1}`, idea, slot });
  }
  return options;
}

/** What question 2 shows about the weather: the forecast and its attribution, or why it is missing. */
export function weatherShown(trip, weather) {
  const shown = weather.forecast
    ? [
        record(
          `Forecast for ${trip.name}, ${dayLabel(trip.date)}`,
          weather.slots.map((s) => [s.name, s.line]),
        ),
        { type: 'text', text: ATTRIBUTION },
      ]
    : [{ type: 'text', text: 'The weather service could not be reached. These plans skip the forecast.' }];
  if (weather.alerts === null) shown.push({ type: 'text', text: NWS_DOWN });
  else if (weather.alerts.length)
    shown.push(
      record(
        'US weather alerts (NWS)',
        weather.alerts.map((a, i) => [`Alert ${i + 1}`, a]),
      ),
    );
  return shown;
}

/** The plan from question 2's verified answer. */
export function readPlan(data, options, slots, trip) {
  const picked = options.find((o) => o.id === data.choice);
  const slot = data.time === 'keep' ? picked?.slot : slots.find((s) => s.id === data.time);
  if (!picked || !slot) throw new Error('Unexpected answer.');
  return { text: `${picked.idea}, ${dayLabel(trip.date)}, ${slot.name}`, weather: slot.line };
}

// --- Small helpers. ---
function record(label, rows) {
  return { type: 'record', label, fields: Object.fromEntries(rows) };
}
function localTime(at, timeZone) {
  /** @type {Intl.DateTimeFormatOptions} */
  const numbers = { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hourCycle: 'h23' };
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone, ...numbers }).formatToParts(at);
  const get = (type) => parts.find((p) => p.type === type)?.value ?? '';
  return { date: `${get('year')}-${get('month')}-${get('day')}`, hour: Number(get('hour')) };
}
/** The coming Saturday or Sunday in the city's time zone (today, if it is that day). */
function weekendDate(day, zone) {
  const at = new Date(`${localTime(new Date(), zone).date}T12:00:00Z`);
  at.setUTCDate(at.getUTCDate() + (((day === 'saturday' ? 6 : 0) - at.getUTCDay() + 7) % 7));
  return at.toISOString().slice(0, 10);
}
function dayLabel(date) {
  /** @type {Intl.DateTimeFormatOptions} */
  const style = { timeZone: 'UTC', weekday: 'long', day: 'numeric', month: 'long' };
  return new Date(`${date}T12:00:00Z`).toLocaleDateString('en-GB', style);
}
