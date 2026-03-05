import { describe, expect, it } from 'vitest';
import { aggregateContrastSimulationScore } from '../src/core/runEngine.js';

describe('contrast simulation score determinism', () => {
  it('returns different scores for controlled high and low contrast samples', () => {
    const highContrast = aggregateContrastSimulationScore([100, 92, 88]);
    const lowContrast = aggregateContrastSimulationScore([22, 30, 28]);

    expect(highContrast).not.toBeNull();
    expect(lowContrast).not.toBeNull();
    expect(highContrast).not.toEqual(lowContrast);
    expect((highContrast ?? 0) > (lowContrast ?? 0)).toBe(true);
  });

  it('is stable for the same sample set', () => {
    const samples = [72, 63, 51];
    expect(aggregateContrastSimulationScore(samples)).toEqual(aggregateContrastSimulationScore(samples));
  });
});
