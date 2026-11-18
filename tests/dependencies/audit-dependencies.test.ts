// The dependency audit's rules (scripts/audit-dependencies.mjs), on synthetic `npm audit --json`
// reports shaped like npm 11's auditReportVersion 2 (founder 2026-11-17 22:05Z item 1).
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { EXCEPTIONS_PATH, NPM_ARGS, evaluate, parseExceptions } from '../../scripts/audit-dependencies.mjs';

const PICOMATCH = 'GHSA-fc5q-39xc-vjpf';
const REASON =
  'development and test toolchain only; the globs it parses come from our own configuration. ' +
  "The one allowed path, openclaw > npm > node-gyp > tinyglobby > picomatch, is OpenClaw's own tree: " +
  "the user's OpenClaw brings it with or without our plugin, and our code never loads it. " +
  "No published package's own dependencies or optionalDependencies reach picomatch.";
const UNTIL = '2026-11-24T17:18:00Z';
const BEFORE = new Date('2026-11-17T22:05:00Z');

const exceptionsText = (
  entries: unknown[] = [{ id: PICOMATCH, package: 'picomatch', reason: REASON, until: UNTIL }],
) => JSON.stringify({ exceptions: entries });

type Entry = { name: string; severity: string; via: unknown[] };
const advisory = (id: string, name: string, severity: string, title = `${name} advisory`) => ({
  source: 1,
  name,
  dependency: name,
  title,
  url: `https://github.com/advisories/${id}`,
  severity,
  cwe: [],
  range: '*',
});
const entry = (name: string, severity: string, via: unknown[]): Entry => ({ name, severity, via });

// Today's real report, reduced: picomatch's advisory and the four packages it reaches.
const PICOMATCH_ENTRIES: Entry[] = [
  entry('picomatch', 'high', [advisory(PICOMATCH, 'picomatch', 'high')]),
  entry('fdir', 'high', ['picomatch']),
  entry('tinyglobby', 'high', ['fdir', 'picomatch']),
  entry('vite', 'high', ['picomatch', 'tinyglobby']),
  entry('vitest', 'high', ['picomatch', 'tinyglobby', 'vite']),
];

const report = (entries: Entry[]) => {
  const counts: Record<string, number> = { info: 0, low: 0, moderate: 0, high: 0, critical: 0 };
  for (const e of entries) counts[e.severity] = (counts[e.severity] ?? 0) + 1;
  return JSON.stringify({
    auditReportVersion: 2,
    vulnerabilities: Object.fromEntries(
      entries.map((e) => [e.name, { ...e, isDirect: false, effects: [], nodes: [] }]),
    ),
    metadata: { vulnerabilities: { ...counts, total: entries.length }, dependencies: {} },
  });
};
const failing = (entries: Entry[]) =>
  entries.some((e) => ['moderate', 'high', 'critical'].includes(e.severity));
const run = (entries: Entry[], { now = BEFORE, exceptions = exceptionsText() } = {}) =>
  evaluate({
    npm: { status: failing(entries) ? 1 : 0, signal: null, stdout: report(entries) },
    exceptions: parseExceptions(exceptions),
    now,
  });

describe('the dependency audit with dated advisory exceptions', () => {
  it('runs npm audit over every dependency at moderate: no --omit and no other level', () => {
    expect(NPM_ARGS).toEqual(['audit', '--json', '--audit-level=moderate']);
  });

  it('the exceptions file holds exactly the picomatch advisory, its reason verbatim and its date', () => {
    const parsed = parseExceptions(readFileSync(EXCEPTIONS_PATH, 'utf8'));
    expect(parsed.errors).toEqual([]);
    expect(parsed.exceptions.map(({ untilMs: _, ...e }) => e)).toEqual([
      { id: PICOMATCH, package: 'picomatch', reason: REASON, until: UNTIL },
    ]);
  });

  it('passes on the picomatch advisory alone, before its date', () => {
    const result = run(PICOMATCH_ENTRIES);
    expect(result.failures).toEqual([]);
    expect(result.ok).toBe(true);
    expect(result.excepted.map((e) => e.id)).toEqual([PICOMATCH]);
  });

  it('fails on picomatch plus another moderate advisory, naming it', () => {
    const other = 'GHSA-2222-3333-4444';
    const result = run([
      ...PICOMATCH_ENTRIES,
      entry('other', 'moderate', [advisory(other, 'other', 'moderate', 'Other is bad')]),
    ]);
    expect(result.ok).toBe(false);
    expect(result.failures).toEqual([`advisory ${other} (other, moderate: Other is bad)`]);
  });

  it('fails on picomatch once its until has passed, and at the exact instant', () => {
    for (const now of [new Date(UNTIL), new Date('2026-11-25T00:00:00Z')]) {
      const result = run(PICOMATCH_ENTRIES, { now });
      expect(result.ok).toBe(false);
      expect(result.failures).toEqual([
        `advisory ${PICOMATCH} (picomatch, high: picomatch advisory): exception expired at ${UNTIL}`,
      ]);
    }
    expect(run(PICOMATCH_ENTRIES, { now: new Date(Date.parse(UNTIL) - 1) }).ok).toBe(true);
  });

  it('fails on picomatch with no exception', () => {
    const result = run(PICOMATCH_ENTRIES, { exceptions: exceptionsText([]) });
    expect(result.failures).toEqual([`advisory ${PICOMATCH} (picomatch, high: picomatch advisory)`]);
  });

  it('fails when the excepted advisory is no longer reported, so the entry is deleted', () => {
    for (const entries of [[], [entry('other', 'low', [advisory('GHSA-2222-3333-4444', 'other', 'low')])]]) {
      const result = run(entries);
      expect(result.ok).toBe(false);
      expect(result.failures).toEqual([
        `exception ${PICOMATCH} (picomatch) names an advisory npm audit no longer reports: delete it`,
      ]);
    }
  });

  it('an exception covers only its own package', () => {
    const result = run([entry('other', 'high', [advisory(PICOMATCH, 'other', 'high')])]);
    expect(result.failures).toEqual([
      `advisory ${PICOMATCH} (other, high: other advisory)`,
      `exception ${PICOMATCH} (picomatch) names an advisory npm audit no longer reports: delete it`,
    ]);
  });

  it('passes an advisory below moderate without an exception, as --audit-level=moderate does', () => {
    const low = entry('other', 'low', [advisory('GHSA-2222-3333-4444', 'other', 'low')]);
    expect(run([...PICOMATCH_ENTRIES, low]).failures).toEqual([]);
  });

  it('fails on malformed output, an npm error or an unknown shape', () => {
    const exceptions = parseExceptions(exceptionsText());
    const cases: [
      { status: number | null; signal?: string | null; error?: Error; stdout: string },
      RegExp,
    ][] = [
      [{ status: 1, stdout: '{"auditReportVersion": 2, "vulnerabilities": {' }, /not JSON/],
      [{ status: 1, stdout: '' }, /not JSON/],
      [{ status: 1, stdout: '[]' }, /not a JSON object/],
      [
        { status: 1, stdout: JSON.stringify({ error: { code: 'ENOLOCK', summary: 'no lockfile' } }) },
        /reported an error/,
      ],
      [
        {
          status: 1,
          stdout: JSON.stringify({ ...JSON.parse(report(PICOMATCH_ENTRIES)), auditReportVersion: 1 }),
        },
        /auditReportVersion 2/,
      ],
      [
        { status: 1, stdout: JSON.stringify({ auditReportVersion: 2, advisories: {}, metadata: {} }) },
        /no vulnerabilities object/,
      ],
      [{ status: 1, stdout: JSON.stringify({ auditReportVersion: 2, vulnerabilities: {} }) }, /no metadata/],
      [{ status: 2, stdout: report(PICOMATCH_ENTRIES) }, /exited 2/],
      [{ status: null, signal: 'SIGTERM', stdout: '' }, /killed by SIGTERM/],
      [{ status: null, error: new Error('spawn npm ENOENT'), stdout: '' }, /did not run/],
      // npm says nothing failed, yet reports a failing entry; and the reverse.
      [{ status: 0, stdout: report(PICOMATCH_ENTRIES) }, /exited 0 with 5 entries/],
      [{ status: 1, stdout: report([]) }, /exited 1 with 0 entries/],
    ];
    for (const [npm, message] of cases) {
      const result = evaluate({ npm, exceptions, now: BEFORE });
      expect(result.ok, String(message)).toBe(false);
      expect(result.failures.join('\n')).toMatch(message);
    }
  });

  it('fails on an entry it cannot read: unknown severity, dangling via, advisory without a GHSA URL, wrong counts', () => {
    const exceptions = parseExceptions(exceptionsText());
    const withMeta = (entries: Entry[], meta?: Record<string, number>) => {
      const r = JSON.parse(report(entries));
      if (meta) r.metadata.vulnerabilities = { ...r.metadata.vulnerabilities, ...meta };
      return JSON.stringify(r);
    };
    const cases: [string, RegExp][] = [
      [withMeta([...PICOMATCH_ENTRIES, entry('x', 'severe', ['picomatch'])]), /unknown severity/],
      [
        withMeta([...PICOMATCH_ENTRIES, entry('x', 'high', ['nowhere'])]),
        /via nowhere, which is not an entry/,
      ],
      [withMeta([...PICOMATCH_ENTRIES, entry('x', 'high', [])]), /via is not a non-empty list/],
      [
        withMeta([
          ...PICOMATCH_ENTRIES,
          entry('x', 'high', [{ ...advisory(PICOMATCH, 'x', 'high'), url: 'https://example.test/1' }]),
        ]),
        /without a GHSA URL/,
      ],
      [withMeta(PICOMATCH_ENTRIES, { high: 4 }), /metadata high is 4, entries give 5/],
      [withMeta(PICOMATCH_ENTRIES, { total: 6 }), /metadata total is 6/],
    ];
    for (const [stdout, message] of cases) {
      const result = evaluate({ npm: { status: 1, signal: null, stdout }, exceptions, now: BEFORE });
      expect(result.ok, String(message)).toBe(false);
      expect(result.failures.join('\n')).toMatch(message);
    }
  });

  it('fails on an entry at moderate or above that reaches no advisory at moderate or above', () => {
    const result = run([
      ...PICOMATCH_ENTRIES,
      entry('low', 'low', [advisory('GHSA-2222-3333-4444', 'low', 'low')]),
      entry('lifted', 'high', ['low']),
    ]);
    expect(result.failures).toEqual(['audit entry lifted (high) reaches no advisory at moderate or above']);
  });

  it('fails on an exceptions file it cannot read', () => {
    const good = { id: PICOMATCH, package: 'picomatch', reason: REASON, until: UNTIL };
    const cases: [string, RegExp][] = [
      ['not json', /not JSON/],
      [JSON.stringify([good]), /not exactly \{"exceptions"/],
      [JSON.stringify({ exceptions: [good], extra: 1 }), /not exactly \{"exceptions"/],
      [exceptionsText([{ ...good, note: 'x' }]), /not exactly \{id, package, reason, until\}/],
      [exceptionsText([{ ...good, id: 'CVE-2026-0001' }]), /not a GHSA identifier/],
      [exceptionsText([good, good]), /listed twice/],
      [exceptionsText([{ ...good, reason: ' ' }]), /reason is empty/],
      [exceptionsText([{ ...good, package: '' }]), /package is empty/],
      [exceptionsText([{ ...good, until: '2026-11-24' }]), /until is not a UTC timestamp/],
      [exceptionsText([{ ...good, until: '2026-11-24T17:18:00+01:00' }]), /until is not a UTC timestamp/],
      [exceptionsText([{ ...good, until: '2026-02-30T17:18:00Z' }]), /until is not a UTC timestamp/],
    ];
    for (const [text, message] of cases) {
      const parsed = parseExceptions(text);
      expect(parsed.exceptions).toEqual([]);
      const result = evaluate({
        npm: { status: 1, signal: null, stdout: report(PICOMATCH_ENTRIES) },
        exceptions: parsed,
        now: BEFORE,
      });
      expect(result.ok, String(message)).toBe(false);
      expect(result.failures.join('\n')).toMatch(message);
    }
  });
});
