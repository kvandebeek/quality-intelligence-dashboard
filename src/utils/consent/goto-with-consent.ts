import type { Page } from 'playwright';
import { handleConsent, type ConsentHandlingResult, type ConsentOptions } from './consent-handler.js';

type GotoArg = Parameters<Page['goto']>[0];
type GotoOptions = NonNullable<Parameters<Page['goto']>[1]>;

type GotoWithConsentOptions = {
  readonly gotoOptions?: GotoOptions;
  readonly consent?: ConsentOptions;
};

export type GotoWithConsentResult = {
  readonly response: Awaited<ReturnType<Page['goto']>>;
  readonly consent: ConsentHandlingResult;
};

export const gotoWithConsent = async (
  page: Page,
  url: GotoArg,
  options: GotoWithConsentOptions = {},
): Promise<GotoWithConsentResult> => {
  const response = await page.goto(url, {
    waitUntil: 'domcontentloaded',
    ...(options.gotoOptions ?? {}),
  });

  const consent = await handleConsent(page, options.consent);
  return { response, consent };
};
