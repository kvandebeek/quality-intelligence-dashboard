import { describe, expect, it, vi } from 'vitest';
import { classifyMixedContent, parseCspDirectives, parseHstsDirectives, parseSetCookieRedacted, probeRedirectChain } from '../src/collectors/securityScan.js';

describe('securityScan helpers', () => {
  it('parses HSTS directives', () => {
    const parsed = parseHstsDirectives('max-age=31536000; includeSubDomains; preload');
    expect(parsed['max-age']).toBe('31536000');
    expect(parsed.includesubdomains).toBe(true);
    expect(parsed.preload).toBe(true);
  });

  it('parses CSP directives', () => {
    const parsed = parseCspDirectives("default-src 'self'; script-src 'self' 'unsafe-inline'");
    expect(parsed['default-src']).toEqual(["'self'"]);
    expect(parsed['script-src']).toContain("'unsafe-inline'");
  });

  it('redacts cookie values', () => {
    const cookie = parseSetCookieRedacted('sid=supersecret; Path=/; Secure; HttpOnly; SameSite=None');
    expect(cookie.name).toBe('sid');
    expect(cookie.raw).not.toContain('supersecret');
    expect(cookie.sameSite).toBe('None');
  });

  it('classifies mixed content type', () => {
    expect(classifyMixedContent('script')).toBe('active');
    expect(classifyMixedContent('image')).toBe('passive');
  });

  it('extracts redirect chain', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ status: 301, headers: new Headers({ location: 'https://example.com' }) })
      .mockResolvedValueOnce({ status: 200, headers: new Headers() });
    vi.stubGlobal('fetch', fetchMock);
    const chain = await probeRedirectChain('https://example.com/path');
    expect(chain.chain).toHaveLength(2);
    expect(chain.chain[0]?.status).toBe(301);
    expect(chain.finalUrl).toBe('https://example.com/');
    vi.unstubAllGlobals();
  });
});
