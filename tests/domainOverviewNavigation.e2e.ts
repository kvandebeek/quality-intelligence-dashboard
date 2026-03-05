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
  test('navigates to accessibility from accessibility severity card', async ({ page }) => {
    await page.goto(`${server.url}/#/domain-overview`);
    await page.getByTestId('domain-overview-accessibility-severity').click();
    await expect(page).toHaveURL(/#\/accessibility$/);
  });

  test('does not render cwv info icon affordance', async ({ page }) => {
    await page.goto(`${server.url}/#/domain-overview`);
    await expect(page.getByLabel('Based on Google Core Web Vitals thresholds; aggregated across pages.')).toHaveCount(0);
    await expect(page.getByTestId('domain-overview-cwv-info')).toHaveCount(0);
  });

  test('navigates to performance from fcp card', async ({ page }) => {
    await page.goto(`${server.url}/#/domain-overview`);
    const fcp = page.getByTestId('domain-overview-fcp');
    await fcp.focus();
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(/#\/performance$/);
  });

  test('navigates to seo score from seo score card', async ({ page }) => {
    await page.goto(`${server.url}/#/domain-overview`);
    await page.getByTestId('domain-overview-seo-score').click();
    await expect(page).toHaveURL(/#\/seo-score$/);
  });

  test('navigates to core web vitals from cwv status by metric card', async ({ page }) => {
    await page.goto(`${server.url}/#/domain-overview`);
    const cwv = page.getByTestId('domain-overview-cwv-status-by-metric');
    await cwv.focus();
    await page.keyboard.press(' ');
    await expect(page).toHaveURL(/#\/core-web-vitals$/);
  });
});
