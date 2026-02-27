import { defineConfig } from 'playwright/test';
import { emitLog } from './src/playwright/runtimeLogger.js';

const configLoadStartNs = process.hrtime.bigint();
if (!process.env.PW_RUN_START_NS) {
  process.env.PW_RUN_START_NS = `${configLoadStartNs}`;
}

const playwrightConfig = defineConfig({
  testMatch: ['**/*.spec.ts', '**/*.e2e.ts'],
  reporter: [['list'], ['./src/playwright/testTimingReporter.cts']],
});

const configLoadedNs = process.hrtime.bigint();
process.env.PW_CONFIG_LOADED_NS = `${configLoadedNs}`;
emitLog('INFO', 'runner', 'playwright config loaded', {
  durationMs: Number(configLoadedNs - configLoadStartNs) / 1_000_000,
  metadata: {
    testMatch: playwrightConfig.testMatch,
    projects: playwrightConfig.projects?.map((project) => project.name) ?? ['default'],
  },
});

export { playwrightConfig };
export default playwrightConfig;
