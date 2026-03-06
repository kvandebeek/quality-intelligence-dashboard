import { describe, expect, it } from 'vitest';
import { PageProgressLogger } from '../src/core/pageProgressLogger.js';

class MockStream {
  public isTTY: boolean;

  public chunks: string[] = [];

  public constructor(isTTY: boolean) {
    this.isTTY = isTTY;
  }

  public write(value: string): boolean {
    this.chunks.push(value);
    return true;
  }
}

describe('PageProgressLogger', () => {
  it('prints stable snapshot lines in non-interactive mode', () => {
    let nowMs = 0;
    const stream = new MockStream(false) as unknown as NodeJS.WriteStream;
    const logger = new PageProgressLogger({
      pageLabel: 'Homepage',
      pageUrl: 'https://example.com',
      pageIndex: 1,
      totalPages: 2,
      phases: [
        { id: 'navigation', label: 'navigation', weight: 50, expectedDurationMs: 1000 },
        { id: 'seo', label: 'seo', weight: 50, expectedDurationMs: 1000 },
      ],
      now: () => nowMs,
      stream,
    });

    logger.start();
    logger.startPhase('navigation');
    nowMs = 1200;
    logger.completePhase('navigation');
    logger.startPhase('seo');
    nowMs = 2500;
    logger.completePhase('seo');
    logger.complete();

    const output = (stream as unknown as MockStream).chunks.join('');
    expect(output).toContain('Homepage 1/2 | https://example.com');
    expect(output).toContain('Phase: navigation');
    expect(output).toContain('PASS |');
  });

  it('uses carriage-return updates in interactive mode', () => {
    const stream = new MockStream(true) as unknown as NodeJS.WriteStream;
    const logger = new PageProgressLogger({
      pageLabel: 'Contact',
      pageIndex: 2,
      totalPages: 2,
      phases: [{ id: 'navigation', label: 'navigation', weight: 100, expectedDurationMs: 1000 }],
      stream,
    });

    logger.start();
    logger.startPhase('navigation');
    logger.completePhase('navigation');
    logger.complete();

    const output = (stream as unknown as MockStream).chunks.join('');
    expect(output).toContain('\r\x1b[2K');
    expect(output).toContain('Contact 2/2 | Contact');
  });
});
