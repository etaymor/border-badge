/**
 * useWorkflowNavigation - Hook for navigation actions within the photo import workflow.
 *
 * Handles candidate selection, trip selection, back navigation, and candidate switching.
 */

import { useCallback } from 'react';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';

import { Analytics } from '@services/analytics';
import { setLastSelectedCandidateId, type TripCandidateDisplay } from '@services/photoImport';
import type { RootStackParamList } from '@navigation/types';

import type { ImportPhase } from './photoImportTypes';

export interface UseWorkflowNavigationOptions {
  /** Current selected candidate */
  selectedCandidate: TripCandidateDisplay | null;
  /** Current selected trip ID */
  selectedTripId: string | null;
  /** Whether user has premium access */
  isPremium: boolean;
  /** Whether user can import photos (premium or has remaining free imports) */
  canImportPhotos: boolean;
  /** Ref tracking current candidate ID for race condition detection */
  currentCandidateIdRef: React.MutableRefObject<string | null>;
  /** Set selected candidate state */
  setSelectedCandidate: (candidate: TripCandidateDisplay | null) => void;
  /** Set selected trip ID state */
  setSelectedTripId: (tripId: string | null) => void;
  /** Set phase state */
  setPhase: (phase: ImportPhase) => void;
  /** Fetch suggestions for a candidate */
  fetchSuggestions: (
    candidate: TripCandidateDisplay
  ) => Promise<{ gatedByPremium: true } | undefined>;
  /** Reset the suggest places mutation */
  resetSuggestPlacesMutation: () => void;
  /** Clear the fetched cache */
  clearFetchedCache: () => void;
}

export interface UseWorkflowNavigationResult {
  /** Handle premium gating - shows paywall modal */
  handlePremiumGate: (
    context: string,
    options?: { nextPhase?: ImportPhase; candidate?: TripCandidateDisplay }
  ) => void;
  /** Select a candidate and go to trip selection phase */
  selectCandidate: (candidate: TripCandidateDisplay) => void;
  /** Select a trip and proceed to suggestions phase */
  selectTrip: (tripId: string, candidate?: TripCandidateDisplay) => Promise<void>;
  /** Go back to candidates phase */
  backToCandidates: () => void;
  /** Go back to trip selection phase */
  backToTripSelection: () => void;
  /** Switch to a different photo trip candidate (for same country) */
  switchCandidate: (newCandidate: TripCandidateDisplay) => Promise<void>;
}

export function useWorkflowNavigation({
  selectedCandidate,
  selectedTripId,
  isPremium,
  canImportPhotos,
  currentCandidateIdRef,
  setSelectedCandidate,
  setSelectedTripId,
  setPhase,
  fetchSuggestions,
  resetSuggestPlacesMutation,
  clearFetchedCache,
}: UseWorkflowNavigationOptions): UseWorkflowNavigationResult {
  const rootNavigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();

  // ==========================================================================
  // Premium Gate Handler
  // ==========================================================================
  const handlePremiumGate = useCallback(
    (context: string, options?: { nextPhase?: ImportPhase; candidate?: TripCandidateDisplay }) => {
      if (__DEV__) {
        console.log(`[PhotoImport] Premium gate triggered (${context})`);
      }
      if (options?.candidate) {
        setSelectedCandidate(options.candidate);
      }
      if (options?.nextPhase) {
        setPhase(options.nextPhase);
      }
      rootNavigation.navigate('PaywallModal', { feature: 'photoImport' });
    },
    [rootNavigation, setSelectedCandidate, setPhase]
  );

  // ==========================================================================
  // Select Candidate
  // ==========================================================================
  const selectCandidate = useCallback(
    (candidate: TripCandidateDisplay) => {
      setSelectedCandidate(candidate);
      setPhase('trip-selection');
      Analytics.photoImportCandidateSelected({
        countryCode: candidate.countryCode,
        clusterCount: candidate.locationClusterIds.length,
      });
    },
    [setSelectedCandidate, setPhase]
  );

  // ==========================================================================
  // Select Trip
  // ==========================================================================
  /**
   * Select a trip and proceed to suggestions phase.
   * Accepts optional candidate parameter to use when called in the same
   * render cycle as selectCandidate (avoids stale closure).
   * Persists the candidate selection so it's remembered next time.
   *
   * Premium gating is checked upfront - if user is gated, shows paywall
   * immediately without transitioning to suggestions phase.
   */
  const selectTrip = useCallback(
    async (tripIdToSelect: string, candidate?: TripCandidateDisplay) => {
      const candidateToUse = candidate ?? selectedCandidate;
      if (!candidateToUse) {
        if (__DEV__) console.warn('[PhotoImport] selectTrip called without candidate');
        return;
      }

      // Check premium gating upfront before any phase transition
      // This prevents UI flash where user briefly sees suggestions phase
      if (!isPremium && !canImportPhotos) {
        handlePremiumGate('selectTrip', { nextPhase: 'trip-selection' });
        return;
      }

      // Track current candidate for race condition detection
      currentCandidateIdRef.current = candidateToUse.id;

      setSelectedTripId(tripIdToSelect);
      setPhase('suggestions');

      // Persist the candidate selection for this destination trip
      setLastSelectedCandidateId(tripIdToSelect, candidateToUse.id).catch(() => {
        // Swallow persistence errors - not critical
      });

      const fetchResult = await fetchSuggestions(candidateToUse);
      if (fetchResult?.gatedByPremium) {
        handlePremiumGate('selectTrip-fetch', {
          nextPhase: 'suggestions',
          candidate: candidateToUse,
        });
      }
    },
    [
      fetchSuggestions,
      selectedCandidate,
      isPremium,
      canImportPhotos,
      handlePremiumGate,
      currentCandidateIdRef,
      setSelectedTripId,
      setPhase,
    ]
  );

  // ==========================================================================
  // Back Navigation
  // ==========================================================================
  const backToCandidates = useCallback(() => {
    setSelectedCandidate(null);
    setSelectedTripId(null);
    setPhase('candidates');
    resetSuggestPlacesMutation();
  }, [setSelectedCandidate, setSelectedTripId, setPhase, resetSuggestPlacesMutation]);

  const backToTripSelection = useCallback(() => {
    setSelectedTripId(null);
    setPhase('trip-selection');
    resetSuggestPlacesMutation();
  }, [setSelectedTripId, setPhase, resetSuggestPlacesMutation]);

  // ==========================================================================
  // Switch Candidate
  // ==========================================================================
  /**
   * Switch to a different photo trip candidate (for same country).
   * Keeps the destination trip the same, just refetches suggestions for new candidate.
   * Persists the selection so it's remembered next time.
   *
   * Uses a ref to track the current candidate ID to prevent race conditions
   * when the user rapidly switches between candidates.
   *
   * Premium gating is checked upfront - if user is gated, shows paywall
   * immediately without switching candidates.
   */
  const switchCandidate = useCallback(
    async (newCandidate: TripCandidateDisplay) => {
      if (!selectedTripId) return;

      // Check premium gating upfront before any state changes
      if (!isPremium && !canImportPhotos) {
        handlePremiumGate('switchCandidate');
        return;
      }

      // Track current candidate to detect if user switched during async operations
      currentCandidateIdRef.current = newCandidate.id;

      // Reset existing suggestions (both API mutation and cached)
      resetSuggestPlacesMutation();
      clearFetchedCache();

      // Update selected candidate
      setSelectedCandidate(newCandidate);

      // Persist the selection for this destination trip
      setLastSelectedCandidateId(selectedTripId, newCandidate.id).catch(() => {
        // Swallow persistence errors - not critical
      });

      // Fetch suggestions for new candidate
      const fetchResult = await fetchSuggestions(newCandidate);
      if (fetchResult?.gatedByPremium) {
        handlePremiumGate('switchCandidate-fetch', {
          nextPhase: 'suggestions',
          candidate: newCandidate,
        });
      }

      // Note: fetchSuggestions handles its own state updates via React Query mutation.
      // If user switched candidates during the fetch, the mutation.reset() call in the
      // new switchCandidate invocation will have already cleared the stale results.
    },
    [
      selectedTripId,
      resetSuggestPlacesMutation,
      clearFetchedCache,
      fetchSuggestions,
      isPremium,
      canImportPhotos,
      handlePremiumGate,
      currentCandidateIdRef,
      setSelectedCandidate,
    ]
  );

  return {
    handlePremiumGate,
    selectCandidate,
    selectTrip,
    backToCandidates,
    backToTripSelection,
    switchCandidate,
  };
}
