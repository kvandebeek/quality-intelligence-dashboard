import type { ConsentOptions } from '../utils/consent/consent-handler.js';

const parseBoolean = (value: string | undefined, fallback: boolean): boolean => {
  if (value === undefined) {
    return fallback;
  }

  const normalized = value.trim().toLowerCase();
  if (['1', 'true', 'yes', 'on'].includes(normalized)) {
    return true;
  }
  if (['0', 'false', 'no', 'off'].includes(normalized)) {
    return false;
  }

  return fallback;
};

const parsePositiveInt = (value: string | undefined, fallback: number): number => {
  if (value === undefined) {
    return fallback;
  }

  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }

  return parsed;
};

export const getConsentOptionsFromEnv = (): ConsentOptions => {
  return {
    enabled: parseBoolean(process.env.CONSENT_ENABLED, true),
    timeoutMs: parsePositiveInt(process.env.CONSENT_TIMEOUT_MS, 1500),
  };
};
