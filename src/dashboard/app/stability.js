const isFiniteNonZero = (value) => typeof value === 'number' && Number.isFinite(value) && value !== 0;

export function buildStabilityRows(loadEventSamples = [], timestamps = [], absoluteMs = 1000, relativeMultiplier = 1.2) {
  const rows = loadEventSamples.map((value, index) => ({
    index: index + 1,
    sample: Math.round(value),
    rawSample: value,
    timestamp: timestamps?.[index] ?? 'n/a'
  }));

  const validRows = rows.filter((row) => isFiniteNonZero(row.rawSample));
  const validCount = validRows.length;
  const mean = validCount === 0 ? 0 : validRows.reduce((sum, row) => sum + row.sample, 0) / validCount;

  return rows.map((row) => {
    const valid = isFiniteNonZero(row.rawSample);
    if (!valid) return { index: row.index, sample: row.sample, timestamp: row.timestamp, rowClass: '' };

    const isSlow = validCount < 3
      ? row.sample >= absoluteMs
      : row.sample >= absoluteMs || row.sample >= mean * relativeMultiplier;

    return {
      index: row.index,
      sample: row.sample,
      timestamp: row.timestamp,
      rowClass: isSlow ? 'slow' : 'fast'
    };
  });
}
