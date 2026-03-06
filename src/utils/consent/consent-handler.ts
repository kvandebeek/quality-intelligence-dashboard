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
  '#AcceptReload',
  '#accept-cookies',
  '#cookie-accept',
  'button[aria-label*="accept all cookies" i]',
  'button[aria-label*="accept all" i]',
  'a[aria-label*="accept" i]',
  '[id*="cookie" i] a[id*="accept" i]',
  '[id*="cookie" i] button[aria-label*="accept" i]',
];
const ROLE_LABELS: readonly string[] = ['Accept all', 'Accept all cookies', 'Allow all', 'Agree'];
const BANNER_CONTAINERS: readonly string[] = ['[id*="cookie" i]', '[class*="cookie" i]', '[id*="consent" i]', '[class*="consent" i]', '[aria-label*="cookie" i]'];
const GENERIC_CLICKABLE_SELECTOR = 'button,a,[role="button" i],input[type="button" i],input[type="submit" i]';

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
  if (count === 0) {
    return false;
  }
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

const tryGenericClickableScan = async (context: SearchContext, timeoutMs: number): Promise<MatchResult | null> => {
  const perIterationWaitMs = 100;
  const deadline = nowMs() + timeoutMs;

  while (nowMs() < deadline) {
    const detail = await context.evaluate(
      ({ containerSelectors, clickableSelector }) => {
        const positivePattern = /(accept|allow|agree|consent|ok(?:ay)?|got it|continue|toestaan|aanvaard|accepter|akzept|acept|alles accepteren)/i;
        const negativePattern = /(reject|decline|deny|disagree|settings|preferences|manage|customi[sz]e|necessary|only required|alles weigeren|weiger|ablehnen|refus)/i;

        const toText = (element: Element): string => {
          const htmlElement = element as HTMLElement;
          const value = element instanceof HTMLInputElement ? element.value : '';
          return [
            element.getAttribute('aria-label') ?? '',
            element.getAttribute('title') ?? '',
            value,
            htmlElement.innerText ?? '',
            htmlElement.textContent ?? '',
          ]
            .join(' ')
            .replace(/\s+/g, ' ')
            .trim();
        };

        const isVisible = (element: Element): boolean => {
          const node = element as HTMLElement;
          if (!node.isConnected) return false;
          const style = window.getComputedStyle(node);
          if (style.visibility === 'hidden' || style.display === 'none' || Number(style.opacity) === 0) return false;
          const rect = node.getBoundingClientRect();
          return rect.width > 0 && rect.height > 0;
        };

        const scoreContainer = (element: Element): number => {
          for (const selector of containerSelectors) {
            const container = element.closest(selector);
            if (container) return 4;
          }
          return 0;
        };

        let bestCandidate: { element: HTMLElement; score: number; text: string } | null = null;
        const candidates = Array.from(document.querySelectorAll(clickableSelector));

        for (const candidate of candidates) {
          if (!isVisible(candidate)) continue;
          const text = toText(candidate);
          if (!text || !positivePattern.test(text) || negativePattern.test(text)) continue;

          let score = 10 + scoreContainer(candidate);
          if (/accept all|allow all|all cookies|all tracking/i.test(text)) score += 6;
          if ((candidate.getAttribute('id') ?? '').toLowerCase().includes('accept')) score += 2;
          if ((candidate.getAttribute('class') ?? '').toLowerCase().includes('accept')) score += 1;

          if (!bestCandidate || score > bestCandidate.score) {
            bestCandidate = { element: candidate as HTMLElement, score, text };
          }
        }

        if (!bestCandidate) {
          return null;
        }

        bestCandidate.element.click();
        const id = bestCandidate.element.id ? `#${bestCandidate.element.id}` : '';
        return `dom-scan:${bestCandidate.element.tagName.toLowerCase()}${id} text=${JSON.stringify(bestCandidate.text.slice(0, 80))}`;
      },
      { containerSelectors: BANNER_CONTAINERS, clickableSelector: GENERIC_CLICKABLE_SELECTOR },
    );

    if (detail) {
      const page = 'page' in context ? context.page() : context;
      await page.waitForLoadState('domcontentloaded', { timeout: Math.min(500, timeoutMs) }).catch(() => undefined);
      return { strategy: 'role-text', detail };
    }

    await context.waitForTimeout(perIterationWaitMs);
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

  const generic = await tryGenericClickableScan(context, withTimeout(timeoutMs, 2));
  if (generic) {
    return generic;
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
  const log = options.log ?? (() => undefined);

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
