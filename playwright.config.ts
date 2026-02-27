import { defineConfig } from 'playwright/test';

const playwrightConfig = defineConfig({
  testMatch: ['**/*.spec.ts'],
  reporter: [['list'], ['./src/playwright/testTimingReporter.cts']],
});

export { playwrightConfig };
export default playwrightConfig;
