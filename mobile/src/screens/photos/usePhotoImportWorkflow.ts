/**
 * usePhotoImportWorkflow - Custom hook managing the photo import workflow state and logic.
 *
 * Composes smaller hooks for scanning, suggestions, and entry creation.
 */

import { useCallback, useEffect, useRef, useState } from 'react';

import { useOnboardingStore, selectHomeCountry } from '@stores/onboardingStore';
import {
  abortBackgroundSync,
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
  // Initialize to 'loading' when we'll skip directly to suggestions (avoids flash of idle state)
  const [phase, setPhase] = useState<ImportPhase>(skipToSuggestions && tripId ? 'loading' : 'idle');
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

  // Upload state for UI - track multiple concurrent uploads
  const [uploadingClusterIds, setUploadingClusterIds] = useState<Set<string>>(new Set());

  const addUploadingClusterId = useCallback((id: string) => {
    setUploadingClusterIds((prev) => new Set(prev).add(id));
  }, []);

  const removeUploadingClusterId = useCallback((id: string) => {
    setUploadingClusterIds((prev) => {
      const next = new Set(prev);
      next.delete(id);
      return next;
    });
  }, []);

  // ==========================================================================
  // Data Lookups (can be large: ~5-10MB for 10k photos)
  // Stored in state for React updates, with refs for cleanup after unmount
  // ==========================================================================
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
  // Workflow Analytics Tracking
  // ==========================================================================
  // Track workflow timing and completion for analytics
  const workflowStartTimeRef = useRef<number | null>(null);
  const workflowConfirmedCountRef = useRef(0);
  const workflowRejectedCountRef = useRef(0);
  const workflowHiddenCountRef = useRef(0);
  const workflowTotalClustersRef = useRef(0);
  const workflowClustersWithSuggestionsRef = useRef(0);
  const workflowCompletedRef = useRef(false);

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
      // Abort any in-progress background sync to prevent closures from holding
      // references to large data structures after unmount
      abortBackgroundSync();

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
    uploadStates,
    getUploadState,
    cancelUpload,
    handleConfirmPlace: handleConfirmPlaceInternal,
    handleRejectPlace: handleRejectPlaceInternal,
    handleHideCluster: handleHideClusterInternal,
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
    addUploadingClusterId,
    removeUploadingClusterId,
  });

  // ==========================================================================
  // Workflow Analytics Wrappers
  // ==========================================================================
  // Wrap handlers to track workflow progress for analytics

  const handleConfirmPlace = useCallback(
    async (...args: Parameters<typeof handleConfirmPlaceInternal>) => {
      await handleConfirmPlaceInternal(...args);
      workflowConfirmedCountRef.current += 1;
    },
    [handleConfirmPlaceInternal]
  );

  const handleRejectPlace = useCallback(
    (...args: Parameters<typeof handleRejectPlaceInternal>) => {
      handleRejectPlaceInternal(...args);
      workflowRejectedCountRef.current += 1;
    },
    [handleRejectPlaceInternal]
  );

  const handleHideCluster = useCallback(
    async (...args: Parameters<typeof handleHideClusterInternal>) => {
      await handleHideClusterInternal(...args);
      workflowHiddenCountRef.current += 1;
    },
    [handleHideClusterInternal]
  );

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

          // Set state from cache (photoLookup only stored in ref - not needed for UI updates)
          setClusterLookup(optimizedData.clusterLookup);
          setClusterDisplays(optimizedData.clusterDisplays);
          photoLookupRef.current = optimizedData.photoLookup;
          clusterLookupRef.current = optimizedData.clusterLookup;
          clusterDisplaysRef.current = optimizedData.clusterDisplays;
          setTripCandidates(candidates);
          setLastImportTimeState(lastImport);
          setIsIncremental(true);

          // If tripId is provided with skipToSuggestions, go directly to suggestions phase
          if (tripId) {
            // Use first candidate (we're already filtered to the country)
            const candidate = candidates[0];
            setSelectedCandidate(candidate);
            setSelectedTripId(tripId);
            setPhase('suggestions');
            fetchSuggestions(candidate);

            Analytics.photoImportCandidateSelected({
              countryCode: candidate.countryCode,
              clusterCount: candidate.locationClusterIds.length,
            });
          } else {
            // No tripId - show candidates for user to select
            setPhase('candidates');

            // Auto-select if single candidate (common case when filtering by country)
            if (candidates.length === 1) {
              setSelectedCandidate(candidates[0]);
              Analytics.photoImportCandidateSelected({
                countryCode: candidates[0].countryCode,
                clusterCount: candidates[0].locationClusterIds.length,
              });
            }
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
  // Workflow Analytics: Start timing when entering suggestions phase
  // ==========================================================================
  useEffect(() => {
    if (phase === 'suggestions' && selectedCandidate && !workflowStartTimeRef.current) {
      workflowStartTimeRef.current = Date.now();
      workflowTotalClustersRef.current = selectedCandidate.locationClusterIds.length;
      workflowConfirmedCountRef.current = 0;
      workflowRejectedCountRef.current = 0;
      workflowHiddenCountRef.current = 0;
      workflowCompletedRef.current = false;
    }
    // Reset tracking when leaving suggestions phase
    if (phase !== 'suggestions') {
      workflowStartTimeRef.current = null;
    }
  }, [phase, selectedCandidate]);

  // ==========================================================================
  // Workflow Analytics: Track clusters with suggestions for success rate
  // ==========================================================================
  // Extract stable data reference to avoid recalculating on mutation object changes
  const apiSuggestionsData = suggestPlacesMutation.data?.suggestions;

  useEffect(() => {
    // Count clusters that have at least one suggestion (from API or cache)
    // Use a Set to deduplicate by cluster_id (cached suggestions take precedence)
    const seenClusterIds = new Set<string>();
    let clustersWithSuggestions = 0;

    // Count from cached suggestions first
    for (const s of cachedSuggestions) {
      if (!seenClusterIds.has(s.cluster_id)) {
        seenClusterIds.add(s.cluster_id);
        if (s.places.length > 0) clustersWithSuggestions++;
      }
    }

    // Count from API suggestions (skip duplicates)
    if (apiSuggestionsData) {
      for (const s of apiSuggestionsData) {
        if (!seenClusterIds.has(s.cluster_id)) {
          seenClusterIds.add(s.cluster_id);
          if (s.places.length > 0) clustersWithSuggestions++;
        }
      }
    }

    workflowClustersWithSuggestionsRef.current = clustersWithSuggestions;
  }, [apiSuggestionsData, cachedSuggestions]);

  // ==========================================================================
  // Workflow Analytics: Track completion
  // ==========================================================================
  useEffect(() => {
    if (!selectedCandidate || !workflowStartTimeRef.current || workflowCompletedRef.current) {
      return;
    }

    const totalClusters = workflowTotalClustersRef.current;
    const processedClusters =
      workflowConfirmedCountRef.current +
      workflowRejectedCountRef.current +
      workflowHiddenCountRef.current;

    if (processedClusters >= totalClusters && totalClusters > 0) {
      workflowCompletedRef.current = true;

      const successRate =
        totalClusters > 0
          ? Math.round((workflowClustersWithSuggestionsRef.current / totalClusters) * 100)
          : 0;
      const acceptanceRate =
        totalClusters > 0
          ? Math.round((workflowConfirmedCountRef.current / totalClusters) * 100)
          : 0;

      Analytics.photoImportWorkflowCompleted({
        totalClusters,
        confirmedCount: workflowConfirmedCountRef.current,
        rejectedCount: workflowRejectedCountRef.current,
        hiddenCount: workflowHiddenCountRef.current,
        workflowDurationMs: Date.now() - workflowStartTimeRef.current,
        successRate,
        acceptanceRate,
      });
    }
  }, [selectedCandidate, dismissedClusterIdsInternal]);

  // ==========================================================================
  // Cleanup on unmount - clear fetched cache and track workflow exit
  // ==========================================================================
  useEffect(() => {
    return () => {
      // Track workflow exit if we had started but didn't complete
      if (
        workflowStartTimeRef.current &&
        !workflowCompletedRef.current &&
        workflowTotalClustersRef.current > 0
      ) {
        const totalClusters = workflowTotalClustersRef.current;
        const processedClusters =
          workflowConfirmedCountRef.current +
          workflowRejectedCountRef.current +
          workflowHiddenCountRef.current;
        const remainingClusters = totalClusters - processedClusters;

        if (remainingClusters > 0) {
          Analytics.photoImportWorkflowExited({
            totalClusters,
            processedClusters,
            remainingClusters,
            workflowDurationMs: Date.now() - workflowStartTimeRef.current,
          });
        }
      }

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
    uploadStates,
    getUploadState,
    uploadingClusterIds,

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
