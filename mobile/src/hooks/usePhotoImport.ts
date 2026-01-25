/**
 * React Query hooks for photo import place suggestions.
 */

import { useCallback, useRef, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { AxiosError } from 'axios';

import { api } from '@services/api';
import type {
  PlaceSuggestionRequest,
  PlaceSuggestionResponse,
  ClusterSuggestion,
} from '@services/photoImport';

/** Progress state for chunked place suggestion requests */
export interface PlaceSuggestionProgress {
  clustersTotal: number;
  clustersCompleted: number;
  percentage: number;
  /** Number of chunks that failed (non-fatal errors) */
  failedChunks: number;
  /** Number of individual clusters that timed out or failed within successful chunks */
  failedClusters: number;
}

/** Chunk size for batched place suggestion requests */
const CHUNK_SIZE = 15;

/** Extended response with client-side timing data */
export interface ChunkedPlaceSuggestionResult extends PlaceSuggestionResponse {
  /** Per-chunk API response times in milliseconds (client-side only) */
  chunkResponseTimes: number[];
}

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

/**
 * Split an array into chunks of specified size.
 */
function chunkArray<T>(array: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < array.length; i += size) {
    chunks.push(array.slice(i, i + size));
  }
  return chunks;
}

/**
 * Hook for chunked place suggestions with progress tracking.
 *
 * Sends clusters in batches to show incremental progress and results.
 * Returns partial results as each batch completes for immediate display.
 */
export function useSuggestPlacesChunked() {
  const [progress, setProgress] = useState<PlaceSuggestionProgress | null>(null);
  const [partialResults, setPartialResults] = useState<ClusterSuggestion[]>([]);
  const abortRef = useRef(false);

  const reset = useCallback(() => {
    setProgress(null);
    setPartialResults([]);
    abortRef.current = false;
  }, []);

  const mutation = useMutation({
    mutationFn: async (data: PlaceSuggestionRequest): Promise<ChunkedPlaceSuggestionResult> => {
      const clusters = data.clusters;
      const totalClusters = clusters.length;
      const chunks = chunkArray(clusters, CHUNK_SIZE);
      const allSuggestions: ClusterSuggestion[] = [];
      let failedChunkCount = 0;
      let failedClusterCount = 0;
      const chunkResponseTimes: number[] = [];

      // Reset state for new request
      abortRef.current = false;
      setPartialResults([]);
      setProgress({
        clustersTotal: totalClusters,
        clustersCompleted: 0,
        percentage: 0,
        failedChunks: 0,
        failedClusters: 0,
      });

      for (let i = 0; i < chunks.length; i++) {
        // Check for abort between chunks
        if (abortRef.current) {
          break;
        }

        const chunk = chunks[i];
        const clustersProcessed = i * CHUNK_SIZE;

        setProgress({
          clustersTotal: totalClusters,
          clustersCompleted: clustersProcessed,
          percentage: Math.round((clustersProcessed / totalClusters) * 100),
          failedChunks: failedChunkCount,
          failedClusters: failedClusterCount,
        });

        const chunkStartTime = Date.now();
        try {
          const response = await api.post('/photos/suggest-places', { clusters: chunk });
          const chunkDurationMs = Date.now() - chunkStartTime;
          chunkResponseTimes.push(chunkDurationMs);
          const responseData = response.data as PlaceSuggestionResponse;
          const suggestions = responseData.suggestions;
          const chunkFailedClusters = responseData.failed_cluster_count ?? 0;
          failedClusterCount += chunkFailedClusters;
          if (__DEV__) {
            console.log(
              `[PhotoImport] Chunk ${i + 1}/${chunks.length}: received ${suggestions.length} suggestions in ${chunkDurationMs}ms` +
                (chunkFailedClusters > 0 ? `, ${chunkFailedClusters} clusters timed out` : ''),
              suggestions.map((s) => ({
                clusterId: s.cluster_id,
                placeCount: s.places?.length ?? 0,
                topPlace: s.places?.[0]?.name ?? 'none',
              }))
            );
          }
          allSuggestions.push(...suggestions);
          // Update partial results for immediate display
          setPartialResults([...allSuggestions]);
        } catch (error) {
          const chunkDurationMs = Date.now() - chunkStartTime;
          chunkResponseTimes.push(chunkDurationMs);
          // Re-throw fatal errors (quota exhausted, rate limited)
          if (error instanceof AxiosError) {
            if (error.response?.status === 503) {
              throw new QuotaExhaustedError();
            }
            if (error.response?.status === 429) {
              const retryAfter = error.response.headers['retry-after'];
              const retrySeconds = retryAfter ? parseInt(retryAfter, 10) : 60;
              throw new RateLimitError(isNaN(retrySeconds) ? 60 : retrySeconds);
            }
          }
          // Track non-fatal errors and continue with remaining chunks
          failedChunkCount++;
          if (__DEV__) {
            console.warn(`[PhotoImport] Chunk ${i + 1} failed, continuing...`, error);
          }
        }
      }

      // Mark complete with final failure count (skip if aborted)
      if (!abortRef.current) {
        setProgress({
          clustersTotal: totalClusters,
          clustersCompleted: totalClusters,
          percentage: 100,
          failedChunks: failedChunkCount,
          failedClusters: failedClusterCount,
        });
      }

      return {
        suggestions: allSuggestions,
        failed_cluster_count: failedClusterCount,
        chunkResponseTimes,
      };
    },
    onError: () => {
      // Reset progress on error
      setProgress(null);
    },
  });

  // Wrap reset to also abort in-flight requests
  const fullReset = useCallback(() => {
    abortRef.current = true;
    mutation.reset();
    reset();
  }, [mutation, reset]);

  return {
    ...mutation,
    progress,
    partialResults,
    reset: fullReset,
  };
}
