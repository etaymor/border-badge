/**
 * Hooks for photo import place suggestions.
 *
 * Chunking, cluster claiming, abort, progress accounting, and failure
 * attribution all live in the `suggestionDispatch` controller
 * (`@services/photoImport/suggestionDispatch`). This module is the React seam:
 * `useSuggestionDispatch` subscribes a component to the controller's snapshot,
 * and the constants/types/errors are re-exported here because four modules and
 * their test suites import them from this path.
 */

import { useSyncExternalStore } from 'react';
import { useMutation } from '@tanstack/react-query';
import { AxiosError } from 'axios';

import { api } from '@services/api';
import {
  suggestionDispatch,
  QuotaExhaustedError,
  RateLimitError,
  SUGGEST_PLACES_TIMEOUT_MS,
} from '@services/photoImport/suggestionDispatch';
import type { PlaceSuggestionRequest, PlaceSuggestionResponse } from '@services/photoImport';

export {
  suggestionDispatch,
  planSuggestionBatches,
  CHUNK_SIZE,
  FIRST_CHUNK_SIZE,
  SUGGEST_PLACES_TIMEOUT_MS,
  RateLimitError,
  QuotaExhaustedError,
} from '@services/photoImport/suggestionDispatch';

export type {
  PlaceSuggestionProgress,
  PlaceSuggestionCluster,
  FailedClusterInfo,
  FailedClusterIds,
  ChunkedPlaceSuggestionResult,
  ChunkedPlaceSuggestionRequest,
  SuggestionBatchOutcome,
  SuggestionDispatchState,
} from '@services/photoImport/suggestionDispatch';

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
        const response = await api.post('/photos/suggest-places', data, {
          timeout: SUGGEST_PLACES_TIMEOUT_MS,
        });
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

/**
 * Subscribe to the `suggestionDispatch` controller (KTD21).
 *
 * Returns the controller's live snapshot. The controller is a module-level
 * singleton, so its state — enqueued clusters, in-flight claims, progress,
 * failure attribution — survives navigating away from the photo import screen
 * and back, and every subscriber sees the same dispatch.
 *
 * Actions are NOT returned here: they are stable methods on the singleton, so
 * callers import `suggestionDispatch` directly rather than threading callbacks
 * whose identity churns on every progress update.
 */
export function useSuggestionDispatch() {
  return useSyncExternalStore(suggestionDispatch.subscribe, suggestionDispatch.getState);
}
