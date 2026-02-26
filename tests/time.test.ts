import { describe, expect, it } from 'vitest';
import { stableRunId } from '../src/utils/time.js';

describe('stableRunId', () => {
  it('keeps existing naming when no run name is provided', () => {
    expect(stableRunId('20260226T113003Z', 'chromium', 1)).toBe('20260226T113003Z-chromium-it1');
  });

  it('prefixes run name when provided', () => {
    expect(stableRunId('20260226T113003Z', 'chromium', 1, 'RESILLION')).toBe(
      'RESILLION-20260226T113003Z-chromium-it1'
    );
  });
});
