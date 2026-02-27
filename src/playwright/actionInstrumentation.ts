import type { APIRequestContext, Locator, Page, Response, Request } from 'playwright/test';
import { emitLog, isTraceEnabled, measureOperation, type LogContext } from './runtimeLogger.js';
import { handleConsent } from '../utils/consent/consent-handler.js';
import { getConsentOptionsFromEnv } from './consentRuntime.js';

const LOCATOR_METHODS = new Set(['click', 'fill', 'type', 'press', 'check', 'uncheck', 'selectOption', 'waitFor']);
const PAGE_METHODS = new Set(['goto', 'waitForSelector', 'waitForLoadState', 'waitForResponse', 'waitForRequest', 'screenshot']);

const startsWithHttp = (value: unknown): boolean => typeof value === 'string' && /^https?:\/\//.test(value);

const summarizeArgs = (args: readonly unknown[]): Record<string, unknown> => {
  const summarized = args.slice(0, 3).map((arg) => {
    if (typeof arg === 'string' || typeof arg === 'number' || typeof arg === 'boolean') {
      return arg;
    }

    if (arg instanceof RegExp) {
      return arg.toString();
    }

    if (typeof arg === 'object' && arg !== null) {
      return '[object]';
    }

    return typeof arg;
  });

  return { args: summarized };
};

const instrumentLocator = (locator: Locator, context: Omit<LogContext, 'durationMs'>): Locator => {
  return new Proxy(locator, {
    get(target, property, receiver) {
      if (property === 'locator') {
        return (...args: unknown[]) => {
          if (isTraceEnabled()) {
            emitLog('DEBUG', 'action', `locator.resolve ${String(args[0] ?? '')}`, {
              ...context,
              metadata: summarizeArgs(args),
            });
          }
          const nested = target.locator(args[0] as string, args[1] as never);
          return instrumentLocator(nested, context);
        };
      }

      const value = Reflect.get(target, property, receiver);
      if (typeof value !== 'function' || !LOCATOR_METHODS.has(String(property))) {
        return value;
      }

      return async (...args: unknown[]) => {
        const actionName = `locator.${String(property)}`;
        return measureOperation('action', actionName, async () => {
          const result = await Reflect.apply(value, target, args);
          return result as unknown;
        }, {
          ...context,
          metadata: summarizeArgs(args),
        });
      };
    },
  });
};

export const instrumentPage = (page: Page, context: Omit<LogContext, 'durationMs'>): Page => {
  return new Proxy(page, {
    get(target, property, receiver) {
      if (property === 'locator') {
        return (...args: unknown[]) => {
          if (isTraceEnabled()) {
            emitLog('DEBUG', 'action', `locator.resolve ${String(args[0] ?? '')}`, {
              ...context,
              metadata: summarizeArgs(args),
            });
          }

          const locator = target.locator(args[0] as string, args[1] as never);
          return instrumentLocator(locator, context);
        };
      }

      const value = Reflect.get(target, property, receiver);
      if (typeof value !== 'function' || !PAGE_METHODS.has(String(property))) {
        return value;
      }

      return async (...args: unknown[]) => {
        const actionName = `page.${String(property)}`;
        return measureOperation('action', actionName, async () => {
          const result = await Reflect.apply(value, target, args);
          if (property === 'goto') {
            await handleConsent(target, getConsentOptionsFromEnv());
          }
          return result as unknown;
        }, {
          ...context,
          metadata: summarizeArgs(args),
        });
      };
    },
  });
};

export const instrumentRequestContext = (requestContext: APIRequestContext, context: Omit<LogContext, 'durationMs'>): APIRequestContext => {
  return new Proxy(requestContext, {
    get(target, property, receiver) {
      const value = Reflect.get(target, property, receiver);
      if (typeof value !== 'function') {
        return value;
      }

      if (!['fetch', 'get', 'post', 'put', 'patch', 'delete', 'head'].includes(String(property))) {
        return value;
      }

      return async (...args: unknown[]) => {
        const actionName = `api.${String(property)}`;
        return measureOperation('action', actionName, async () => {
          const response = await Reflect.apply(value, target, args);
          return response as unknown;
        }, {
          ...context,
          metadata: summarizeArgs(args),
        });
      };
    },
  });
};

export const wireNetworkLogging = (page: Page, context: Omit<LogContext, 'durationMs'>): void => {
  if (!isTraceEnabled()) {
    return;
  }

  const requestStarts = new WeakMap<Request, bigint>();

  page.on('request', (request) => {
    requestStarts.set(request, process.hrtime.bigint());
    emitLog('DEBUG', 'network', `request START ${request.method()} ${request.url()}`, context);
  });

  page.on('requestfinished', (request) => {
    const startNs = requestStarts.get(request);
    const durationMs = startNs ? Number(process.hrtime.bigint() - startNs) / 1_000_000 : undefined;
    emitLog('DEBUG', 'network', `request END ${request.method()} ${request.url()}`, {
      ...context,
      durationMs,
      metadata: { status: 'completed' },
    });
  });

  page.on('requestfailed', (request) => {
    const startNs = requestStarts.get(request);
    const durationMs = startNs ? Number(process.hrtime.bigint() - startNs) / 1_000_000 : undefined;
    emitLog('WARN', 'network', `request FAIL ${request.method()} ${request.url()}`, {
      ...context,
      durationMs,
      metadata: { failureText: request.failure()?.errorText ?? 'unknown' },
    });
  });

  page.on('response', (response: Response) => {
    if (!startsWithHttp(response.url())) {
      return;
    }

    emitLog('DEBUG', 'network', `response ${response.status()} ${response.url()}`, context);
  });
};
