/**
 * usePhotoImportWorkflow - Custom hook managing the photo import workflow state and logic.
 *
 * Composes smaller hooks for scanning, suggestions, entry creation, navigation, and analytics.
 */

import { useCallback, useEffect, useRef, useState } from 'react';

import { useOnboardingStore, selectHomeCountry } from '@stores/onboardingStore';
import { useSubscriptionStore } from '@stores/subscriptionStore';
import {
  abortBackgroundSync,
  getLastImportTime,
  getProcessedClusterIds,
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
import { usePhotoScan, ScanResult } from './usePhotoScan';
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

  // Track current candidate ID to prevent race conditions during rapid switching
  const currentCandidateIdRef = useRef<string | null>(null);

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
  const {
    suggestPlacesMutation,
    cachedSuggestions,
    fetchSuggestions,
    clearFetchedCache,
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
    lastImportTime,
    isIncremental,
    isSaving: createEntry.isPending,
    dismissedClusterIdsInternal,
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
    handleAddEntryForCluster,
    handleManualSelect,
    handleCreateTrip,
    backToCandidates,
    backToTripSelection,
    switchCandidate,
    closeManualSearch,
    cancelUpload,
  };
}
