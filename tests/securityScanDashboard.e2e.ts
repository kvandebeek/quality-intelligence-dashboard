import path from 'node:path';
import { expect, test } from 'playwright/test';
import { startDashboardServer, type StartedDashboardServer } from '../src/dashboard/server.js';

let server: StartedDashboardServer;

test.beforeAll(async () => {
  server = await startDashboardServer({ runPath: path.resolve('tests/fixtures/dashboard-run'), port: 0 });
});

test.afterAll(async () => {
  await server.close();
});

test('security scan renders schema v1 and v2 and supports filtering', async ({ page }) => {
  await page.goto(`${server.url}/#/security-scan`);
  await expect(page.getByText('Missing/weak headers')).toBeVisible();
  await page.getByText('example-com-about', { exact: false }).first().click();
  await page.selectOption('[data-security-filter-severity]', 'high');
  await expect(page.locator('.sec-finding:visible')).toHaveCount(1);
  await page.fill('[data-security-search]', 'mixed content');
  await expect(page.locator('.sec-finding:visible')).toContainText('Active mixed content detected');
});
