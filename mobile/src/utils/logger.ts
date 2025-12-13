/**
 * Development-only logger utility.
 * All log methods are no-ops in production builds.
 */

type LogArgs = Parameters<typeof console.log>;

export const logger = {
  log: (...args: LogArgs): void => {
    if (__DEV__) {
      console.log(...args);
    }
  },
  warn: (...args: LogArgs): void => {
    if (__DEV__) {
      console.warn(...args);
    }
  },
  error: (...args: LogArgs): void => {
    if (__DEV__) {
      console.error(...args);
    }
  },
};
