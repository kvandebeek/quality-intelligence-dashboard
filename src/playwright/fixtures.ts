import path from 'node:path';
import { test as base, type Page, type APIRequestContext } from 'playwright/test';
import { instrumentPage, instrumentRequestContext, wireNetworkLogging } from './actionInstrumentation.js';
import { emitLog, formatTestId, measureOperation } from './runtimeLogger.js';

const testIdFor = (testInfo: { file: string; title: string; retry: number }): string => {
  return formatTestId(path.normalize(testInfo.file), testInfo.title, testInfo.retry);
};

type InstrumentedFixtures = {
  page: Page;
  request: APIRequestContext;
};

type WorkerAutoFixtures = {
  _workerLifecycle: void;
};

export const test = base.extend<InstrumentedFixtures, WorkerAutoFixtures>({
  _workerLifecycle: [
    async ({}, use, workerInfo) => {
      await measureOperation('hook', 'beforeAll', async () => {
        await Promise.resolve();
      }, { workerIndex: workerInfo.workerIndex, testId: 'worker-lifecycle' });

      await use();

      await measureOperation('hook', 'afterAll', async () => {
        await Promise.resolve();
      }, { workerIndex: workerInfo.workerIndex, testId: 'worker-lifecycle' });
    },
    { scope: 'worker', auto: true },
  ],

  context: async ({ browser, contextOptions }, use, testInfo) => {
    const testId = testIdFor(testInfo);
    const workerIndex = testInfo.workerIndex;

    const context = await measureOperation('action', 'browser.newContext', async () => browser.newContext(contextOptions), {
      workerIndex,
      testId,
    });

    try {
      await use(context);
    } finally {
      await measureOperation('action', 'context.close', async () => context.close(), {
        workerIndex,
        testId,
      });
    }
  },

  page: async ({ context }, use, testInfo) => {
    const testId = testIdFor(testInfo);
    const workerIndex = testInfo.workerIndex;

    const rawPage = await measureOperation('action', 'context.newPage', async () => context.newPage(), {
      workerIndex,
      testId,
    });

    wireNetworkLogging(rawPage, { workerIndex, testId });
    const page = instrumentPage(rawPage, { workerIndex, testId });

    try {
      await measureOperation('hook', 'beforeEach', async () => {
        emitLog('INFO', 'test', 'test fixture ready', { workerIndex, testId, metadata: { file: testInfo.file } });
      }, { workerIndex, testId });
      await use(page);
    } finally {
      await measureOperation('hook', 'afterEach', async () => Promise.resolve(), { workerIndex, testId });
      await measureOperation('action', 'page.close', async () => rawPage.close(), {
        workerIndex,
        testId,
      });
    }
  },

  request: async ({ request }, use, testInfo) => {
    const testId = testIdFor(testInfo);
    const workerIndex = testInfo.workerIndex;
    const instrumented = instrumentRequestContext(request, { workerIndex, testId });
    await use(instrumented);
  },
});

export { expect } from 'playwright/test';
