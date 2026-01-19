/**
 * React Query hooks for photo import place suggestions.
 */

import { useMutation } from '@tanstack/react-query';
import { AxiosError } from 'axios';

import { api } from '@services/api';
import type { PlaceSuggestionRequest, PlaceSuggestionResponse } from '@services/photoImport';

/** Error thrown when rate limited, includes retry delay */
export class RateLimitError extends Error {
  retryAfterSeconds: number;

  constructor(retryAfterSeconds: number) {
    super(`Rate limited. Retry after ${retryAfterSeconds} seconds.`);
    this.name = 'RateLimitError';
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

/** Error thrown when daily quota is exhausted */
export class QuotaExhaustedError extends Error {
  constructor() {
    super('Daily quota exhausted. Please try again tomorrow.');
    this.name = 'QuotaExhaustedError';
  }
}

/**
 * Hook to fetch place suggestions for photo clusters.
 *
 * Sends clusters with centroids and photos to the backend,
 * receives ranked place suggestions.
 *
 * On 429 responses, parses Retry-After header and throws RateLimitError
 * with the retry delay for UI to display.
 */
export function useSuggestPlaces() {
  return useMutation({
    mutationFn: async (data: PlaceSuggestionRequest): Promise<PlaceSuggestionResponse> => {
      try {
        const response = await api.post('/photos/suggest-places', data);
        return response.data;
      } catch (error) {
        if (error instanceof AxiosError) {
          if (error.response?.status === 503) {
            // Daily quota exhausted
            throw new QuotaExhaustedError();
          }
          if (error.response?.status === 429) {
            // Parse Retry-After header (default to 60 seconds if not provided)
            const retryAfter = error.response.headers['retry-after'];
            const retrySeconds = retryAfter ? parseInt(retryAfter, 10) : 60;
            throw new RateLimitError(isNaN(retrySeconds) ? 60 : retrySeconds);
          }
        }
        throw error;
      }
    },
  });
}
