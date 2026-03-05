import path from 'node:path';
import { test, expect } from 'playwright/test';
import { startDashboardServer, type StartedDashboardServer } from '../src/dashboard/server.js';

let server: StartedDashboardServer;

test.beforeAll(async () => {
  server = await startDashboardServer({
    runPath: path.resolve('tests/fixtures/dashboard-run'),
    port: 0,
  });
});

test.afterAll(async () => {
  await server.close();
});

test.describe('domain overview navigation', () => {
  test('domain overview tiles support repeated navigation and browser back', async ({ page }) => {
    await page.goto(`${server.url}/#/domain-overview`);

    const targets = [
      { testId: 'domain-overview-accessibility-severity', url: /#\/accessibility$/ },
      { testId: 'domain-overview-fcp', url: /#\/performance$/ },
      { testId: 'domain-overview-seo-score', url: /#\/seo-score$/ },
      { testId: 'domain-overview-cwv-status-by-metric', url: /#\/core-web-vitals$/ }
    ];

    for (const target of targets) {
      await page.getByTestId(target.testId).click();
      await expect(page).toHaveURL(target.url);
      await page.goBack();
      await expect(page).toHaveURL(/#\/domain-overview$/);
      await page.getByTestId(target.testId).click();
      await expect(page).toHaveURL(target.url);
      await page.goBack();
      await expect(page).toHaveURL(/#\/domain-overview$/);
    }
  });

  test('domain overview hides cross-browser card and trims cwv copy', async ({ page }) => {
    await page.goto(`${server.url}/#/domain-overview`);
    await expect(page.getByText('Cross-browser performance', { exact: false })).toHaveCount(0);
    await expect(page.getByText('Needs improvement')).toHaveCount(0);
    await expect(page.getByText('LCP:', { exact: false })).toHaveCount(0);
    await expect(page.getByText('Based on 1/2 URLs')).toBeVisible();
  });

  test('domain header shows data path and keeps external domain link', async ({ page, context }) => {
    await page.goto(`${server.url}/#/domain-overview`);
    await expect(page.getByText('Data path:', { exact: false })).toContainText('./tests/fixtures/dashboard-run');

    const [newPage] = await Promise.all([
      context.waitForEvent('page'),
      page.getByRole('link', { name: 'example.com' }).click()
    ]);
    await expect(newPage).toHaveURL(/example.com/);
    await newPage.close();
  });

  test('a11y legend hover/focus highlights matching donut segment', async ({ page }) => {
    await page.goto(`${server.url}/#/domain-overview`);
    const donut = page.locator('[data-tile="accessibility-severity"] .donut-interactive');
    await page.locator('[data-severity="critical"]').hover();
    await expect(donut).toHaveAttribute('data-active-segment', 'critical');
    await page.locator('[data-severity="critical"]').focus();
    await expect(donut).toHaveAttribute('data-active-segment', 'critical');
    await page.locator('[data-severity="critical"]').blur();
    await expect(donut).not.toHaveAttribute('data-active-segment', 'critical');
  });
});
