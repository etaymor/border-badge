/**
 * usePhotoImportWorkflow - Custom hook managing the photo import workflow state and logic.
 *
 * Composes smaller hooks for scanning, suggestions, entry creation, navigation, and analytics.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { useOnboardingStore, selectHomeCountry } from '@stores/onboardingStore';
import { isAlertScanFailure, usePhotoScanStore } from '@stores/photoScanStore';
import { useSubscriptionStore } from '@stores/subscriptionStore';
import {
  createSubCluster,
  getLastImportTime,
  getProcessedClusterIds,
  saveClusterSplit,
  toLocationClusterDisplay,
  type ScanProgress,
  type TripCandidateDisplay,
  type LocationCluster,
  type LocationClusterDisplay,
  type PhotoWithLocation,
} from '@services/photoImport';

import type {
  ImportPhase,
  PhotoImportWorkflowResult,
  UsePhotoImportWorkflowOptions,
} from './photoImportTypes';
import { usePhotoScan, type ScanResult, type ScanFailureReason } from './usePhotoScan';
import { usePlaceSuggestions } from './usePlaceSuggestions';
import { useEntryCreation } from './useEntryCreation';
import { useWorkflowAnalytics } from './useWorkflowAnalytics';
import { useWorkflowNavigation } from './useWorkflowNavigation';
import { useAutoStartWorkflow } from './useAutoStartWorkflow';

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
  const subscriptionStatus = useSubscriptionStore((s) => s.status);

  // ==========================================================================
  // Core State
  // ==========================================================================
  // Initialize to 'loading' when we'll skip directly to suggestions (avoids
  // flash of idle state). When the singleton scan service is mid-run from a
  // prior screen mount or auto-resume, initialize to 'scanning' so we don't
  // briefly render IdlePhase before the subscription kicks in (R3).
  // When the service surfaced a recoverable failure that the user came back
  // to retry (banner-driven), also initialize to 'scanning' so ScanningPhase's
  // failed-state branch renders the Retry button on first paint.
  const [phase, setPhase] = useState<ImportPhase>(() => {
    if (skipToSuggestions && tripId) return 'loading';
    const serviceState = usePhotoScanStore.getState();
    const servicePhase = serviceState.phase;
    if (servicePhase === 'scanning') return 'scanning';
    // If the service already has a completed result waiting (because this
    // screen mounted via banner-tap after the scan finished while elsewhere),
    // initialize to 'loading'. usePhotoScan's mount-time recovery effect will
    // consume the result and onScanComplete will then set phase to 'candidates';
    // 'loading' renders the spinner so we don't briefly flash IdlePhase.
    if (servicePhase === 'completed' && serviceState.hasResult) return 'loading';
    if (
      servicePhase === 'failed' &&
      serviceState.scanFailure &&
      !isAlertScanFailure(serviceState.scanFailure.reason)
    ) {
      return 'scanning';
    }
    return 'idle';
  });

  // Seed local scanFailure state from the service when the screen mounts
  // mid-failure (e.g. via banner "tap to retry" deep-link). Computed once on
  // mount; `useMemo` with an empty dep array communicates intent better than
  // `useState(...)[0]`.
  const initialServiceFailure = useMemo(() => {
    const state = usePhotoScanStore.getState();
    return state.phase === 'failed' ? state.scanFailure : null;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const [scanProgress, setScanProgress] = useState<ScanProgress | null>(null);
  const [tripCandidates, setTripCandidates] = useState<TripCandidateDisplay[]>([]);
  const [selectedCandidate, setSelectedCandidate] = useState<TripCandidateDisplay | null>(null);
  const [selectedTripId, setSelectedTripId] = useState<string | null>(tripId ?? null);
  const [lastImportTime, setLastImportTimeState] = useState<number | null>(null);
  const [isIncremental, setIsIncremental] = useState<boolean>(false);

  // Scan failure state: set when scan completes with no usable results, cleared after alert shown
  const [scanFailure, setScanFailure] = useState<{
    reason: ScanFailureReason;
    title: string;
    message: string;
  } | null>(initialServiceFailure);

  const clearScanFailure = useCallback(() => {
    setScanFailure(null);
  }, []);

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

  // Track current candidate ID to prevent race conditions during rapid switching
  const currentCandidateIdRef = useRef<string | null>(null);

  // Track unmount state so async operations don't re-populate cleared refs
  const unmountedRef = useRef(false);

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
  // The scan service runs independently of this screen now (see U1/U3); we no
  // longer abort it on unmount. Only release Map memory held by this hook.
  useEffect(() => {
    return () => {
      unmountedRef.current = true;

      // Clear Maps directly via refs (setState is a no-op after unmount)
      // This releases 5-10MB for large photo libraries.
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
  const mergeAutoDismissedClusterIds = useCallback((ids: Set<string>) => {
    if (ids.size === 0) return;
    setDismissedClusterIdsInternal((prev) => {
      const next = new Set(prev);
      for (const id of ids) next.add(id);
      return next;
    });
  }, []);

  const onScanComplete = useCallback(
    (result: ScanResult) => {
      if (unmountedRef.current) return;
      setClusterLookup(result.clusterLookup);
      setClusterDisplays(result.clusterDisplays);
      photoLookupRef.current = result.photoLookup;
      clusterLookupRef.current = result.clusterLookup;
      clusterDisplaysRef.current = result.clusterDisplays;
      setTripCandidates(result.candidates);
      setLastImportTimeState(result.importTime);
      setIsIncremental(result.isIncremental);
      if (result.autoDismissedClusterIds) {
        mergeAutoDismissedClusterIds(result.autoDismissedClusterIds);
      }
      setPhase('candidates');
    },
    [mergeAutoDismissedClusterIds]
  );

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
      setScanFailure(null);
      setPhase('scanning');
      const outcome = await startScanInternal(forceRefresh);
      if (!outcome.success) {
        setPhase('idle');
        // If there's a specific failure reason, surface it so the screen can
        // show the alert and navigate back on dismiss.
        if (outcome.reason) {
          setScanFailure({
            reason: outcome.reason,
            title: outcome.title,
            message: outcome.message,
          });
        }
      }
    },
    [startScanInternal]
  );

  // Mirror service-side scan failures into the screen's local scanFailure state.
  // Legacy reasons (no-photos, no-trips, home-country, scan-error) drop the
  // screen back to idle so the alert flow runs. Service-level reasons (stuck,
  // stale, no-permission, subscription-expired) keep the screen in 'scanning'
  // so ScanningPhase's failed-state branch renders the inline Retry button.
  useEffect(() => {
    return usePhotoScanStore.subscribe((state, prev) => {
      if (state.phase === prev.phase) return;
      if (state.phase === 'failed' && state.scanFailure) {
        const reason = state.scanFailure.reason;
        setScanFailure({
          reason,
          title: state.scanFailure.title,
          message: state.scanFailure.message,
        });
        if (isAlertScanFailure(reason)) {
          setPhase('idle');
        } else {
          setPhase('scanning');
        }
      } else if (state.phase === 'scanning' && prev.phase !== 'scanning') {
        // Service spun up a scan from outside this screen (auto-resume,
        // banner-driven retry). Reflect in the screen's phase.
        setScanFailure(null);
        setPhase('scanning');
      }
    });
  }, []);

  const cancelScan = useCallback(() => {
    cancelScanInternal();
    clearLargeDataStructures();
    setPhase('idle');
  }, [cancelScanInternal, clearLargeDataStructures]);

  // ==========================================================================
  // Place Suggestions Hook
  // ==========================================================================
  const {
    suggestPlacesMutation,
    cachedSuggestions,
    fetchSuggestions,
    fetchForClusters,
    retryFailedClusters,
    retryingClusterIds,
    clearFetchedCache,
    isFetchingSuggestions,
    beginFetchOwner,
    endFetchOwner,
    isPremium,
    canImportPhotos,
  } = usePlaceSuggestions({
    clusterLookupRef,
    currentCandidateIdRef,
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
    handleHideMultipleClusters: handleHideMultipleClustersInternal,
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
  // Workflow Analytics Hook
  // ==========================================================================
  const apiSuggestionsData = suggestPlacesMutation.data?.suggestions;

  const { incrementConfirmed, incrementRejected, incrementHidden } = useWorkflowAnalytics({
    phase,
    selectedCandidate,
    dismissedClusterIdsInternal,
    apiSuggestionsData,
    cachedSuggestions,
  });

  // ==========================================================================
  // Workflow Analytics Wrappers
  // ==========================================================================
  const handleConfirmPlace = useCallback(
    async (...args: Parameters<typeof handleConfirmPlaceInternal>) => {
      await handleConfirmPlaceInternal(...args);
      incrementConfirmed();
    },
    [handleConfirmPlaceInternal, incrementConfirmed]
  );

  const handleRejectPlace = useCallback(
    (...args: Parameters<typeof handleRejectPlaceInternal>) => {
      handleRejectPlaceInternal(...args);
      incrementRejected();
    },
    [handleRejectPlaceInternal, incrementRejected]
  );

  const handleHideCluster = useCallback(
    async (...args: Parameters<typeof handleHideClusterInternal>) => {
      await handleHideClusterInternal(...args);
      incrementHidden();
    },
    [handleHideClusterInternal, incrementHidden]
  );

  const handleHideMultipleClusters = useCallback(
    async (clusterIds: string[]) => {
      await handleHideMultipleClustersInternal(clusterIds);
      incrementHidden(clusterIds.length);
    },
    [handleHideMultipleClustersInternal, incrementHidden]
  );

  // ==========================================================================
  // Cluster Split
  // ==========================================================================
  const handleSplitCluster = useCallback(
    async (clusterId: string, groupAPhotoIds: string[], groupBPhotoIds: string[]) => {
      const parent = clusterLookup.get(clusterId);
      if (!parent) {
        if (__DEV__) console.warn('[PhotoImport] Cannot split: cluster not found:', clusterId);
        return;
      }

      // Don't split if either group is empty — leaves the parent intact.
      if (groupAPhotoIds.length === 0 || groupBPhotoIds.length === 0) {
        if (__DEV__) console.warn('[PhotoImport] Cannot split: empty group');
        return;
      }

      let subA: LocationCluster;
      let subB: LocationCluster;
      try {
        subA = createSubCluster(parent, new Set(groupAPhotoIds), 'a');
        subB = createSubCluster(parent, new Set(groupBPhotoIds), 'b');
      } catch (err) {
        if (__DEV__) console.warn('[PhotoImport] Split failed:', err);
        return;
      }
      const displayA = toLocationClusterDisplay(subA);
      const displayB = toLocationClusterDisplay(subB);

      // Register in lookups (state + refs)
      setClusterLookup((prev) => {
        const next = new Map(prev);
        next.set(subA.id, subA);
        next.set(subB.id, subB);
        return next;
      });
      setClusterDisplays((prev) => {
        const next = new Map(prev);
        next.set(subA.id, displayA);
        next.set(subB.id, displayB);
        return next;
      });
      clusterLookupRef.current.set(subA.id, subA);
      clusterLookupRef.current.set(subB.id, subB);
      clusterDisplaysRef.current.set(subA.id, displayA);
      clusterDisplaysRef.current.set(subB.id, displayB);

      // Replace parent in selectedCandidate's cluster IDs
      setSelectedCandidate((prev) => {
        if (!prev) return prev;
        const idx = prev.locationClusterIds.indexOf(clusterId);
        if (idx === -1) return prev;
        const newIds = [...prev.locationClusterIds];
        newIds.splice(idx, 1, subA.id, subB.id);
        return { ...prev, locationClusterIds: newIds };
      });

      // Dismiss parent cluster in-memory; persistence is handled below via the
      // cluster_splits table so we rebuild sub-clusters on next entry.
      setDismissedClusterIdsInternal((prev) => new Set(prev).add(clusterId));

      // Persist the split so re-segmentation on the next session can rebuild
      // these sub-clusters. Failure is logged but not surfaced — the in-memory
      // split still works for this session; only return-visit fidelity is lost.
      saveClusterSplit(
        clusterId,
        { id: subA.id, photoIds: subA.photos.map((p) => p.id) },
        { id: subB.id, photoIds: subB.photos.map((p) => p.id) }
      ).catch((err) => {
        if (__DEV__) console.warn('[PhotoImport] Failed to persist split:', err);
      });

      // Fetch suggestions for the two new sub-clusters
      await fetchForClusters([subA, subB]);
    },
    [clusterLookup, fetchForClusters]
  );

  // ==========================================================================
  // Workflow Navigation Hook
  // ==========================================================================
  const {
    handlePremiumGate,
    selectCandidate,
    selectTrip,
    backToCandidates,
    backToTripSelection,
    switchCandidate,
  } = useWorkflowNavigation({
    selectedCandidate,
    selectedTripId,
    isPremium,
    canImportPhotos,
    currentCandidateIdRef,
    setSelectedCandidate,
    setSelectedTripId,
    setPhase,
    beginFetchOwner,
    endFetchOwner,
    fetchSuggestions,
    resetSuggestPlacesMutation: suggestPlacesMutation.reset,
    clearFetchedCache,
  });

  // ==========================================================================
  // Auto-start Effect Hook
  // ==========================================================================
  useAutoStartWorkflow({
    autoStart,
    filterCountryCode,
    tripId,
    skipToSuggestions,
    homeCountry,
    subscriptionStatus,
    isPremium,
    canImportPhotos,
    currentCandidateIdRef,
    startScan,
    handlePremiumGate,
    fetchSuggestions,
    beginFetchOwner,
    endFetchOwner,
    setClusterLookup,
    setClusterDisplays,
    photoLookupRef,
    clusterLookupRef,
    clusterDisplaysRef,
    setTripCandidates,
    setLastImportTimeState,
    setIsIncremental,
    setSelectedCandidate,
    setSelectedTripId,
    setPhase,
    unmountedRef,
    mergeAutoDismissedClusterIds,
  });

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
    // R1/KTD13: the single honest in-progress signal — the OR of every dispatch
    // owner (auto-start, selectTrip, switchCandidate, the fetch itself, manual
    // split). The screen no longer keeps a second boolean of its own: one owner
    // finishing must never make an overlapping owner look settled.
    fetchingSuggestions: isFetchingSuggestions,
    retryingClusterIds,
    lastImportTime,
    isIncremental,
    isSaving: createEntry.isPending,
    dismissedClusterIdsInternal,
    scanFailure,
    clearScanFailure,
    uploadStates,
    getUploadState,
    uploadingClusterIds,
    // Premium gating
    isPremium,
    canImportPhotos,

    // Actions
    startScan,
    cancelScan,
    selectCandidate,
    selectTrip,
    handleConfirmPlace,
    handleRejectPlace,
    handleHideCluster,
    handleHideMultipleClusters,
    handleSplitCluster,
    handleAddEntryForCluster,
    retryFailedClusters,
    handleManualSelect,
    handleCreateTrip,
    backToCandidates,
    backToTripSelection,
    switchCandidate,
    closeManualSearch,
    cancelUpload,
  };
}
