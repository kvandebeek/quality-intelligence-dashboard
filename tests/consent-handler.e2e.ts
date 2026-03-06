import { test, expect } from 'playwright/test';
import { handleConsent } from '../src/utils/consent/consent-handler.js';
import { gotoWithConsent } from '../src/utils/consent/goto-with-consent.js';
import { instrumentPage } from '../src/playwright/actionInstrumentation.js';

const toDataUrl = (html: string): string => `data:text/html,${encodeURIComponent(html)}`;

test.describe('consent handler', () => {
  test('clicks known CMP selector on main page', async ({ page }) => {
    await page.setContent(`
      <div id="cookie-banner">
        <button id="onetrust-accept-btn-handler" onclick="window.__consentClicked='onetrust'">Accept all</button>
      </div>
    `);

    const result = await handleConsent(page, { timeoutMs: 800 });

    await expect(page.locator('#onetrust-accept-btn-handler')).toBeVisible();
    const accepted = await page.evaluate(() => (window as Window & { __consentClicked?: string }).__consentClicked ?? null);
    expect(accepted).toBe('onetrust');
    expect(result.handled).toBe(true);
    expect(result.strategy).toBe('cmp-selector');
    expect(result.detail).toBe('#onetrust-accept-btn-handler');
  });

  test('clicks role-based Accept all cookies button', async ({ page }) => {
    await page.setContent(`
      <section id="cookie-consent-banner">
        <button onclick="window.__accepted='role'">Accept all cookies</button>
      </section>
    `);

    const result = await handleConsent(page, { timeoutMs: 800 });

    const accepted = await page.evaluate(() => (window as Window & { __accepted?: string }).__accepted ?? null);
    expect(accepted).toBe('role');
    expect(result.handled).toBe(true);
    expect(result.strategy).toBe('role-text');
    expect(result.detail).toBe('Accept all cookies');
  });

  test('clicks Accept all cookies link element', async ({ page }) => {
    await page.setContent(`
      <div id="cookie-consent">
        <a href="javascript:void(0)" onclick="window.__accepted='link'" class="c-button" id="AcceptReload">Accept all cookies</a>
      </div>
    `);

    const result = await handleConsent(page, { timeoutMs: 800 });

    const accepted = await page.evaluate(() => (window as Window & { __accepted?: string }).__accepted ?? null);
    expect(accepted).toBe('link');
    expect(result.handled).toBe(true);
    expect(result.strategy).toBe('cmp-selector');
    expect(result.detail).toBe('#AcceptReload');
  });

  test('handles consent banner inside iframe', async ({ page }) => {
    await page.setContent(`
      <iframe id="consent-frame" srcdoc="
        <html>
          <body>
            <div id='cookie-banner'>
              <button id='CybotCookiebotDialogBodyLevelButtonLevelOptinAllowAll' onclick=\"window.__frameAccepted='cookiebot'\">Allow all</button>
            </div>
          </body>
        </html>
      "></iframe>
    `);

    const result = await handleConsent(page, { timeoutMs: 1000 });
    const frame = page.frames().find((candidate) => candidate !== page.mainFrame());

    expect(frame).toBeTruthy();
    const accepted = await frame!.evaluate(() => (window as Window & { __frameAccepted?: string }).__frameAccepted ?? null);
    expect(accepted).toBe('cookiebot');
    expect(result.handled).toBe(true);
    expect(result.strategy).toBe('iframe');
    expect(result.detail).toContain('#CybotCookiebotDialogBodyLevelButtonLevelOptinAllowAll');
  });

  test('returns handled=false when banner is absent', async ({ page }) => {
    await page.setContent('<main><h1>No consent prompt</h1></main>');

    const result = await handleConsent(page, { timeoutMs: 700 });

    expect(result.handled).toBe(false);
    expect(result.strategy).toBe('none');
    expect(result.elapsedMs).toBeGreaterThanOrEqual(0);
  });

  test('gotoWithConsent and instrumented page goto handle consent automatically', async ({ page }, testInfo) => {
    const logs: string[] = [];
    const html = `
      <div id="cookie-consent">
        <button id="onetrust-accept-btn-handler" onclick="window.__autoAccepted='yes'">Accept all</button>
      </div>
    `;

    const { consent } = await gotoWithConsent(page, toDataUrl(html), {
      consent: { timeoutMs: 1000, log: (message) => logs.push(message) },
    });

    expect(consent.handled).toBe(true);
    const firstAccepted = await page.evaluate(() => (window as Window & { __autoAccepted?: string }).__autoAccepted ?? null);
    expect(firstAccepted).toBe('yes');

    process.env.CONSENT_ENABLED = 'true';
    process.env.CONSENT_TIMEOUT_MS = '1000';
    const instrumented = instrumentPage(page, { workerIndex: testInfo.workerIndex, testId: 'consent-auto' });
    await instrumented.goto(toDataUrl(html), { waitUntil: 'domcontentloaded' });
    const secondAccepted = await page.evaluate(() => (window as Window & { __autoAccepted?: string }).__autoAccepted ?? null);
    expect(secondAccepted).toBe('yes');
    expect(logs.some((line) => line.includes('[consent] handled=true'))).toBe(true);
  });
});
