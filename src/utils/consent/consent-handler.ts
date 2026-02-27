import type { Frame, Locator, Page } from 'playwright';

export type ConsentHandlingResult = {
  readonly handled: boolean;
  readonly strategy: 'cmp-selector' | 'role-text' | 'iframe' | 'none';
  readonly detail?: string;
  readonly elapsedMs: number;
};

export type ConsentOptions = {
  readonly enabled?: boolean;
  readonly timeoutMs?: number;
  readonly log?: (msg: string) => void;
};

type SearchContext = Page | Frame;

type MatchResult = {
  readonly strategy: 'cmp-selector' | 'role-text';
  readonly detail: string;
};

const DEFAULT_TIMEOUT_MS = 1500;
const CMP_SELECTORS: readonly string[] = [
  '#onetrust-accept-btn-handler',
  '#CybotCookiebotDialogBodyLevelButtonLevelOptinAllowAll',
  'button[aria-label*="accept all cookies" i]',
  'button[aria-label*="accept all" i]',
  '[id*="cookie" i] button[aria-label*="accept" i]',
];
const ROLE_LABELS: readonly string[] = ['Accept all', 'Accept all cookies', 'Allow all', 'Agree'];
const BANNER_CONTAINERS: readonly string[] = ['[id*="cookie" i]', '[class*="cookie" i]', '[id*="consent" i]', '[class*="consent" i]', '[aria-label*="cookie" i]'];

const nowMs = (): number => Number(process.hrtime.bigint() / BigInt(1_000_000));

const withTimeout = (timeoutMs: number, steps: number): number => {
  return Math.max(150, Math.floor(timeoutMs / Math.max(steps, 1)));
};

const canClick = async (locator: Locator, timeoutMs: number): Promise<boolean> => {
  try {
    await locator.waitFor({ state: 'visible', timeout: timeoutMs });
    const visible = await locator.isVisible();
    if (!visible) {
      return false;
    }
    const enabled = await locator.isEnabled();
    return enabled;
  } catch {
    return false;
  }
};

const clickFirstVisible = async (
  context: SearchContext,
  locatorFactory: () => Locator,
  timeoutMs: number,
): Promise<boolean> => {
  const locator = locatorFactory();
  const count = await locator.count();
  const matches = count > 1 ? locator.first() : locator;

  if (!(await canClick(matches, timeoutMs))) {
    return false;
  }

  await matches.click({ timeout: timeoutMs });

  const page = 'page' in context ? context.page() : context;
  await page.waitForLoadState('domcontentloaded', { timeout: timeoutMs }).catch(() => undefined);

  return true;
};

const tryCmpSelectors = async (context: SearchContext, timeoutMs: number): Promise<MatchResult | null> => {
  const perStepTimeout = withTimeout(timeoutMs, CMP_SELECTORS.length + 2);
  for (const selector of CMP_SELECTORS) {
    try {
      const clicked = await clickFirstVisible(context, () => context.locator(selector), perStepTimeout);
      if (clicked) {
        return { strategy: 'cmp-selector', detail: selector };
      }
    } catch {
      // Continue searching with other selectors.
    }
  }

  return null;
};

const tryRoleSelectors = async (context: SearchContext, timeoutMs: number): Promise<MatchResult | null> => {
  const perStepTimeout = withTimeout(timeoutMs, ROLE_LABELS.length + BANNER_CONTAINERS.length + 4);
  for (const label of ROLE_LABELS) {
    try {
      const clicked = await clickFirstVisible(context, () => context.getByRole('button', { name: label, exact: true }), perStepTimeout);
      if (clicked) {
        return { strategy: 'role-text', detail: label };
      }
    } catch {
      // Continue to next role label.
    }
  }

  for (const containerSelector of BANNER_CONTAINERS) {
    try {
      const clicked = await clickFirstVisible(
        context,
        () => context.locator(containerSelector).getByRole('button', { name: /accept( all| all cookies)?/i }),
        perStepTimeout,
      );
      if (clicked) {
        return { strategy: 'role-text', detail: `${containerSelector} /accept( all| all cookies)?/i` };
      }
    } catch {
      // Continue to next container.
    }
  }

  return null;
};

const tryContext = async (context: SearchContext, timeoutMs: number): Promise<MatchResult | null> => {
  const cmp = await tryCmpSelectors(context, timeoutMs);
  if (cmp) {
    return cmp;
  }

  return tryRoleSelectors(context, timeoutMs);
};

const formatAndLog = (
  log: (msg: string) => void,
  handled: boolean,
  strategy: ConsentHandlingResult['strategy'],
  detail: string | undefined,
  elapsedMs: number,
): void => {
  const detailPart = detail ? ` detail=${detail}` : '';
  log(`[consent] handled=${String(handled)} strategy=${strategy}${detailPart} elapsedMs=${elapsedMs}`);
};

export const handleConsent = async (page: Page, options: ConsentOptions = {}): Promise<ConsentHandlingResult> => {
  const startedAt = nowMs();
  const enabled = options.enabled ?? true;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const log = options.log ?? console.log;

  if (!enabled) {
    const elapsedMs = nowMs() - startedAt;
    formatAndLog(log, false, 'none', 'disabled', elapsedMs);
    return { handled: false, strategy: 'none', elapsedMs };
  }

  try {
    const mainResult = await tryContext(page, timeoutMs);
    if (mainResult) {
      const elapsedMs = nowMs() - startedAt;
      formatAndLog(log, true, mainResult.strategy, mainResult.detail, elapsedMs);
      return { handled: true, strategy: mainResult.strategy, detail: mainResult.detail, elapsedMs };
    }

    for (const frame of page.frames()) {
      if (frame === page.mainFrame()) {
        continue;
      }
      const frameResult = await tryContext(frame, timeoutMs);
      if (frameResult) {
        const elapsedMs = nowMs() - startedAt;
        const detail = `frame:${frame.url() || '<inline>'} ${frameResult.detail}`;
        formatAndLog(log, true, 'iframe', detail, elapsedMs);
        return { handled: true, strategy: 'iframe', detail, elapsedMs };
      }
    }
  } catch {
    // Never fail tests when consent is absent or page state changes.
  }

  const elapsedMs = nowMs() - startedAt;
  formatAndLog(log, false, 'none', undefined, elapsedMs);
  return { handled: false, strategy: 'none', elapsedMs };
};
