import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { consumerDrift, evidenceDrift, readPin } from '../../scripts/sdk-pin.mjs';

const openclawRecord = () =>
  JSON.parse(readFileSync(new URL('../../adapters/openclaw/compatibility.json', import.meta.url), 'utf8'));

describe('the single SDK pin (scripts/sdk-pin.mjs)', () => {
  it('every consumer, the provider recipes included, and the OpenClaw SDK evidence agree with the pin', () => {
    expect(consumerDrift(readPin())).toEqual([]);
    expect(evidenceDrift(readPin())).toEqual([]);
  });

  it('a pin the provider recipes do not install is drift', () => {
    const pin = { ...readPin(), version: '0.1.0-rc.999' };
    expect(consumerDrift(pin)).toContainEqual(
      `examples/recipes package.json dependency: ${JSON.stringify(readPin().version)} != "0.1.0-rc.999"`,
    );
  });

  it('OpenClaw evidence for another version, or other bytes, is drift', () => {
    const pin = readPin();
    const record = openclawRecord();
    // The evidence the record carried before the rc.8 transition.
    const stale = {
      sdk: {
        ...record.sdk,
        evidence:
          'REGISTRY: @sess.si/sdk@0.1.0-rc.4 published on npm under dist-tag next (sha256 ccdc0121...41fb2c, integrity equal to release/sdk-candidate.json)',
      },
    };
    const drift = evidenceDrift(pin, stale);
    expect(drift.some((d: string) => d.includes(`begin with "REGISTRY: ${pin.name}@${pin.version} "`))).toBe(
      true,
    );
    expect(drift.some((d: string) => d.includes(`sha256 ${pin.sha256}`))).toBe(true);
    expect(drift.some((d: string) => d.includes(`integrity ${pin.integrity}`))).toBe(true);
    expect(drift.some((d: string) => d.includes('@sess.si/sdk@0.1.0-rc.4'))).toBe(true);

    // The current evidence with an earlier version mentioned alongside it.
    const mixed = { sdk: { ...record.sdk, evidence: `${record.sdk.evidence}; was @sess.si/sdk@0.1.0-rc.7` } };
    expect(evidenceDrift(pin, mixed)).toEqual([
      `adapters/openclaw compatibility sdk.evidence names @sess.si/sdk@0.1.0-rc.7; earlier versions belong in sdk.history`,
    ]);

    // Other bytes under the same version.
    const otherBytes = { ...pin, sha256: '0'.repeat(64) };
    expect(evidenceDrift(otherBytes, record)).toEqual([
      `adapters/openclaw compatibility sdk.evidence does not name sha256 ${'0'.repeat(64)}`,
    ]);

    expect(evidenceDrift(pin, { sdk: {} })).toEqual([
      'adapters/openclaw compatibility sdk.evidence: missing',
    ]);
  });
});
