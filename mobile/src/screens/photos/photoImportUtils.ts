/**
 * Utility functions for the photo import workflow.
 */

/**
 * Type guard for AbortError.
 * Uses name-based check for React Native compatibility (no DOMException).
 */
export function isAbortError(error: unknown): error is Error {
  return (
    error !== null &&
    typeof error === 'object' &&
    'name' in error &&
    (error as Error).name === 'AbortError'
  );
}

/**
 * Create an AbortError compatible with React Native.
 * Standard Error with name set to 'AbortError' for isAbortError detection.
 */
export function createAbortError(message: string): Error {
  const error = new Error(message);
  error.name = 'AbortError';
  return error;
}

/**
 * Truncate coordinate to 5 decimal places (~1.1m precision) for PII protection.
 * Matches backend cache precision in place_matcher/cache.py.
 */
export const truncateCoordinate = (value: number): number => Math.round(value * 100000) / 100000;
