/**
 * usePhotoImportWorkflow - Custom hook managing the photo import workflow state and logic.
 *
 * Composes smaller hooks for scanning, suggestions, and entry creation.
 */

import { useCallback, useEffect, useRef, useState } from 'react';

import { useOnboardingStore, selectHomeCountry } from '@stores/onboardingStore';
import {
  getAllCachedPhotos,
  getLastImportTime,
  getProcessedClusterIds,
  segmentTripsFromCache,
  type ScanProgress,
  type TripCandidateDisplay,
  type LocationCluster,
  type LocationClusterDisplay,
  type PhotoWithLocation,
} from '@services/photoImport';
import { Analytics } from '@services/analytics';

import type {
  ImportPhase,
  PhotoImportWorkflowResult,
  UsePhotoImportWorkflowOptions,
} from './photoImportTypes';
import { usePhotoScan, ScanResult } from './usePhotoScan';
import { usePlaceSuggestions } from './usePlaceSuggestions';
import { useEntryCreation } from './useEntryCreation';

// Re-export types for convenience
export type {
  ImportPhase,
  PhotoImportWorkflowResult,
  UsePhotoImportWorkflowOptions,
} from './photoImportTypes';

export function usePhotoImportWorkflow({
  filterCountryCode,
  tripId,
  autoStart,
  skipToSuggestions,
}: UsePhotoImportWorkflowOptions): PhotoImportWorkflowResult {
  const homeCountry = useOnboardingStore(selectHomeCountry);

  // ==========================================================================
  // Core State
  // ==========================================================================
  const [phase, setPhase] = useState<ImportPhase>('idle');
  const [scanProgress, setScanProgress] = useState<ScanProgress | null>(null);
  const [tripCandidates, setTripCandidates] = useState<TripCandidateDisplay[]>([]);
  const [selectedCandidate, setSelectedCandidate] = useState<TripCandidateDisplay | null>(null);
  const [selectedTripId, setSelectedTripId] = useState<string | null>(tripId ?? null);
  const [lastImportTime, setLastImportTimeState] = useState<number | null>(null);
  const [isIncremental, setIsIncremental] = useState<boolean>(false);

  // Track dismissed clusters to mark as processed after confirm
  const [dismissedClusterIdsInternal, setDismissedClusterIdsInternal] = useState<Set<string>>(
    new Set()
  );

  // Manual search state
  const [manualSearchCluster, setManualSearchCluster] = useState<LocationCluster | null>(null);

  // Upload state for UI
  const [uploadingClusterId, setUploadingClusterId] = useState<string | null>(null);

  // ==========================================================================
  // Data Lookups (can be large: ~5-10MB for 10k photos)
  // ==========================================================================
  const [_photoLookup, setPhotoLookup] = useState<Map<string, PhotoWithLocation>>(new Map());
  const [clusterLookup, setClusterLookup] = useState<Map<string, LocationCluster>>(new Map());
  const [clusterDisplays, setClusterDisplays] = useState<Map<string, LocationClusterDisplay>>(
    new Map()
  );

  // Refs for cleanup after unmount (setState is a no-op after unmount)
  const photoLookupRef = useRef<Map<string, PhotoWithLocation>>(new Map());
  const clusterLookupRef = useRef<Map<string, LocationCluster>>(new Map());
  const clusterDisplaysRef = useRef<Map<string, LocationClusterDisplay>>(new Map());

  // Track whether auto-start has been attempted
  const autoStartAttemptedRef = useRef(false);

  // ==========================================================================
  // Load persisted state on mount
  // ==========================================================================
  useEffect(() => {
    getLastImportTime().then(setLastImportTimeState);
    getProcessedClusterIds().then(setDismissedClusterIdsInternal);
  }, []);

  // ==========================================================================
  // Cleanup on unmount
  // ==========================================================================
  useEffect(() => {
    return () => {
      // Clear Maps directly via refs (setState is a no-op after unmount)
      // This releases 5-10MB for large photo libraries
      photoLookupRef.current.clear();
      clusterLookupRef.current.clear();
      clusterDisplaysRef.current.clear();
    };
  }, []);

  // ==========================================================================
  // Clear large data structures (for navigation/error cleanup)
  // ==========================================================================
  const clearLargeDataStructures = useCallback(() => {
    setPhotoLookup(new Map());
    setClusterLookup(new Map());
    setClusterDisplays(new Map());
    setTripCandidates([]);
    setSelectedCandidate(null);
    setManualSearchCluster(null);
    setScanProgress(null);
    photoLookupRef.current.clear();
    clusterLookupRef.current.clear();
    clusterDisplaysRef.current.clear();
  }, []);

  // ==========================================================================
  // Photo Scan Hook
  // ==========================================================================
  const onScanComplete = useCallback((result: ScanResult) => {
    setPhotoLookup(result.photoLookup);
    setClusterLookup(result.clusterLookup);
    setClusterDisplays(result.clusterDisplays);
    photoLookupRef.current = result.photoLookup;
    clusterLookupRef.current = result.clusterLookup;
    clusterDisplaysRef.current = result.clusterDisplays;
    setTripCandidates(result.candidates);
    setLastImportTimeState(result.importTime);
    setIsIncremental(result.isIncremental);
    setPhase('candidates');
  }, []);

  const onScanError = useCallback(() => {
    clearLargeDataStructures();
    setPhase('idle');
  }, [clearLargeDataStructures]);

  const { startScan: startScanInternal, cancelScan: cancelScanInternal } = usePhotoScan({
    homeCountry,
    filterCountryCode,
    onScanProgress: setScanProgress,
    onScanComplete,
    onScanError,
  });

  const startScan = useCallback(
    async (forceRefresh = false) => {
      setPhase('scanning');
      const success = await startScanInternal(forceRefresh);
      if (!success) {
        setPhase('idle');
      }
    },
    [startScanInternal]
  );

  const cancelScan = useCallback(() => {
    cancelScanInternal();
    clearLargeDataStructures();
    setPhase('idle');
  }, [cancelScanInternal, clearLargeDataStructures]);

  // ==========================================================================
  // Place Suggestions Hook
  // ==========================================================================
  const { suggestPlacesMutation, cachedSuggestions, fetchSuggestions, clearFetchedCache } =
    usePlaceSuggestions({
      clusterLookupRef,
    });

  // ==========================================================================
  // Entry Creation Hook
  // ==========================================================================
  const {
    createEntry,
    uploadState,
    cancelUpload,
    handleConfirmPlace,
    handleRejectPlace,
    handleHideCluster,
    handleAddEntryForCluster,
    handleManualSelect,
    handleCreateTrip,
    closeManualSearch,
  } = useEntryCreation({
    clusterLookup,
    selectedTripId,
    manualSearchCluster,
    setManualSearchCluster,
    setDismissedClusterIds: setDismissedClusterIdsInternal,
    setUploadingClusterId,
  });

  // ==========================================================================
  // Navigation Actions
  // ==========================================================================

  /**
   * Select a candidate and go to trip selection phase.
   */
  const selectCandidate = useCallback((candidate: TripCandidateDisplay) => {
    setSelectedCandidate(candidate);
    setPhase('trip-selection');
    Analytics.photoImportCandidateSelected({
      countryCode: candidate.countryCode,
      clusterCount: candidate.locationClusterIds.length,
    });
  }, []);

  /**
   * Select a trip and proceed to suggestions phase.
   * Accepts optional candidate parameter to use when called in the same
   * render cycle as selectCandidate (avoids stale closure).
   */
  const selectTrip = useCallback(
    async (tripIdToSelect: string, candidate?: TripCandidateDisplay) => {
      const candidateToUse = candidate ?? selectedCandidate;
      if (!candidateToUse) {
        if (__DEV__) console.warn('[PhotoImport] selectTrip called without candidate');
        return;
      }
      setSelectedTripId(tripIdToSelect);
      setPhase('suggestions');
      await fetchSuggestions(candidateToUse);
    },
    [fetchSuggestions, selectedCandidate]
  );

  const backToCandidates = useCallback(() => {
    setSelectedCandidate(null);
    setSelectedTripId(null);
    setPhase('candidates');
    suggestPlacesMutation.reset();
  }, [suggestPlacesMutation]);

  const backToTripSelection = useCallback(() => {
    setSelectedTripId(null);
    setPhase('trip-selection');
    suggestPlacesMutation.reset();
  }, [suggestPlacesMutation]);

  // ==========================================================================
  // Auto-start effect
  // ==========================================================================
  useEffect(() => {
    if (autoStart && filterCountryCode && !autoStartAttemptedRef.current && homeCountry) {
      autoStartAttemptedRef.current = true;

      (async () => {
        const lastImport = await getLastImportTime();
        if (!lastImport) {
          // No previous import - can't auto-start
          return;
        }

        // If skipToSuggestions is enabled, load from cache directly
        if (skipToSuggestions) {
          const allCachedPhotos = await getAllCachedPhotos();
          if (allCachedPhotos.length === 0) {
            // Cache empty, fallback to normal scan
            startScan(false);
            return;
          }

          // Build candidates from cache (fast - no device scanning)
          const optimizedData = segmentTripsFromCache(allCachedPhotos, homeCountry);
          let candidates = optimizedData.candidates;

          // Filter to the requested country
          candidates = candidates.filter((c) => c.countryCode === filterCountryCode);

          if (candidates.length === 0) {
            // No candidates for this country - shouldn't happen if UI showed button
            // but fallback to scan just in case
            startScan(false);
            return;
          }

          // Set state and jump directly to candidates phase
          setPhotoLookup(optimizedData.photoLookup);
          setClusterLookup(optimizedData.clusterLookup);
          setClusterDisplays(optimizedData.clusterDisplays);
          photoLookupRef.current = optimizedData.photoLookup;
          clusterLookupRef.current = optimizedData.clusterLookup;
          clusterDisplaysRef.current = optimizedData.clusterDisplays;
          setTripCandidates(candidates);
          setLastImportTimeState(lastImport);
          setIsIncremental(true);
          setPhase('candidates');

          // Auto-select if single candidate (common case when filtering by country)
          if (candidates.length === 1) {
            const candidate = candidates[0];
            setSelectedCandidate(candidate);

            if (tripId) {
              // We have a tripId - go directly to suggestions phase
              setSelectedTripId(tripId);
              setPhase('suggestions');
              fetchSuggestions(candidate);
            } else {
              // No tripId - stay on candidates phase so TripCandidateCard shows
              setPhase('candidates');
            }

            Analytics.photoImportCandidateSelected({
              countryCode: candidate.countryCode,
              clusterCount: candidate.locationClusterIds.length,
            });
          }
        } else {
          // Normal incremental scan
          startScan(false);
        }
      })();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoStart, filterCountryCode, homeCountry, skipToSuggestions]);

  // ==========================================================================
  // Cleanup on unmount - clear fetched cache
  // ==========================================================================
  useEffect(() => {
    return () => {
      clearFetchedCache();
    };
  }, [clearFetchedCache]);

  // ==========================================================================
  // Return
  // ==========================================================================
  return {
    // State
    phase,
    scanProgress,
    tripCandidates,
    selectedCandidate,
    selectedTripId,
    clusterDisplays,
    manualSearchCluster,
    suggestPlacesMutation,
    cachedSuggestions,
    lastImportTime,
    isIncremental,
    isSaving: createEntry.isPending,
    dismissedClusterIdsInternal,
    uploadState,
    uploadingClusterId,

    // Actions
    startScan,
    cancelScan,
    selectCandidate,
    selectTrip,
    handleConfirmPlace,
    handleRejectPlace,
    handleHideCluster,
    handleAddEntryForCluster,
    handleManualSelect,
    handleCreateTrip,
    backToCandidates,
    backToTripSelection,
    closeManualSearch,
    cancelUpload,
  };
}
