/**
 * React Query hooks for photo import place suggestions.
 */

import { useMutation } from '@tanstack/react-query';

import { api } from '@services/api';
import type { PlaceSuggestionRequest, PlaceSuggestionResponse } from '@services/photoImport';

/**
 * Hook to fetch place suggestions for photo clusters.
 *
 * Sends clusters with centroids and photos to the backend,
 * receives ranked place suggestions.
 */
export function useSuggestPlaces() {
  return useMutation({
    mutationFn: async (data: PlaceSuggestionRequest): Promise<PlaceSuggestionResponse> => {
      const response = await api.post('/photos/suggest-places', data);
      return response.data;
    },
  });
}
