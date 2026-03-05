import { describe, expect, it } from 'vitest';
import { buildStabilityRows } from '../src/dashboard/app/stability.js';

describe('stability threshold row classification', () => {
  it('uses only absolute threshold when fewer than 3 valid samples exist', () => {
    const rows = buildStabilityRows([800, 999, NaN], ['t1', 't2', 't3'], 1000, 1.2);

    expect(rows.map((row: any) => row.rowClass)).toEqual(['fast', 'fast', '']);

    const withSlow = buildStabilityRows([800, 1000, NaN], ['t1', 't2', 't3'], 1000, 1.2);
    expect(withSlow.map((row: any) => row.rowClass)).toEqual(['fast', 'slow', '']);
  });

  it('uses absolute or relative thresholds when at least 3 valid samples exist', () => {
    const rows = buildStabilityRows([700, 760, 980], ['t1', 't2', 't3'], 1000, 1.2);
    expect(rows.map((row: any) => row.rowClass)).toEqual(['fast', 'fast', 'slow']);

    const withAbsoluteHit = buildStabilityRows([700, 760, 1000], ['t1', 't2', 't3'], 1000, 1.2);
    expect(withAbsoluteHit.map((row: any) => row.rowClass)).toEqual(['fast', 'fast', 'slow']);
  });

  it('excludes non-finite and zero values from valid sample set', () => {
    const rows = buildStabilityRows([0, undefined, 900, 1300], ['t1', 't2', 't3', 't4'], 1000, 1.2);
    expect(rows.map((row: any) => row.rowClass)).toEqual(['', '', 'fast', 'slow']);
  });
});
