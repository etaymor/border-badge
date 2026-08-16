/**
 * useWorkflowAnalytics - Hook for tracking photo import workflow analytics.
 *
 * Tracks workflow timing, completion rates, and user actions for analytics.
 */

import { useCallback, useEffect, useRef } from 'react';

import { AdEvents } from '@services/adEvents';
import { Analytics } from '@services/analytics';
import { suggestionDispatch } from '@services/photoImport/suggestionDispatch';
import type { ClusterSuggestion } from '@services/photoImport';

import type { ImportPhase } from './photoImportTypes';
import type { TripCandidateDisplay } from '@services/photoImport';

/**
 * The settled-versus-enqueued split at exit (U11/R18).
 *
 * Read from the dispatch controller rather than from the rendered rows: rows
 * are the union of cached, dispatched and dismissed clusters, whereas the
 * question here is specifically "of what dispatch ACCEPTED, how much had
 * finished when the user walked away".
 *
 * Counts only. No cluster id leaves this function (R27).
 */
function readDispatchSplit(): {
  enqueuedClusters: number;
  settledClusters: number;
  unsettledClusters: number;
} {
  const state = suggestionDispatch.getState();
  const enqueuedClusters = state.enqueuedClusterIds.size;
  let settledClusters = 0;
  for (const id of state.enqueuedClusterIds) {
    if (state.dispatchedAndResolvedClusterIds.has(id) || state.failedClusterIds.has(id)) {
      settledClusters += 1;
    }
  }
  return {
    enqueuedClusters,
    settledClusters,
    unsettledClusters: Math.max(0, enqueuedClusters - settledClusters),
  };
}

export interface WorkflowAnalyticsRefs {
  workflowStartTimeRef: React.MutableRefObject<number | null>;
  workflowConfirmedCountRef: React.MutableRefObject<number>;
  workflowRejectedCountRef: React.MutableRefObject<number>;
  workflowHiddenCountRef: React.MutableRefObject<number>;
  workflowTotalClustersRef: React.MutableRefObject<number>;
  workflowClustersWithSuggestionsRef: React.MutableRefObject<number>;
  workflowCompletedRef: React.MutableRefObject<boolean>;
}

export interface UseWorkflowAnalyticsOptions {
  phase: ImportPhase;
  selectedCandidate: TripCandidateDisplay | null;
  dismissedClusterIdsInternal: Set<string>;
  apiSuggestionsData: ClusterSuggestion[] | undefined;
  cachedSuggestions: ClusterSuggestion[];
}

export interface UseWorkflowAnalyticsResult {
  refs: WorkflowAnalyticsRefs;
  incrementConfirmed: () => void;
  incrementRejected: () => void;
  incrementHidden: (count?: number) => void;
  /**
   * Record that these cluster rows have been scrolled into view (U11).
   *
   * Stable identity: it only touches refs, so it can be handed to the list's
   * viewability callback without re-subscribing it on every render. The ids are
   * counted and discarded — only the COUNT is ever emitted (R27).
   */
  markClustersViewed: (clusterIds: string[]) => void;
  /**
   * The user is leaving the import (U11). Fires the once-per-lifetime photo-import
   * ad conversion when at least one place has been confirmed.
   */
  trackDeparture: () => void;
}

export function useWorkflowAnalytics({
  phase,
  selectedCandidate,
  dismissedClusterIdsInternal,
  apiSuggestionsData,
  cachedSuggestions,
}: UseWorkflowAnalyticsOptions): UseWorkflowAnalyticsResult {
  // ==========================================================================
  // Workflow Analytics Tracking Refs
  // ==========================================================================
  const workflowStartTimeRef = useRef<number | null>(null);
  const workflowConfirmedCountRef = useRef(0);
  const workflowRejectedCountRef = useRef(0);
  const workflowHiddenCountRef = useRef(0);
  const workflowTotalClustersRef = useRef(0);
  const workflowClustersWithSuggestionsRef = useRef(0);
  const workflowCompletedRef = useRef(false);

  // U11. Cluster ids ever scrolled into view. A SET because viewability fires
  // repeatedly for the same rows as the user scrolls back and forth, and the
  // question is "ever seen", not "seen how often". Never emitted — only
  // `.size` is (R27).
  const viewedClusterIdsRef = useRef<Set<string>>(new Set());

  // U11. Guards the ad conversion against firing twice within one mount (back
  // navigation, then unmount). The LIFETIME dedupe is AdEvents' own AsyncStorage
  // flag; this only avoids the redundant round trip.
  const adConversionFiredRef = useRef(false);

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
      // U11: viewability is per candidate. Carrying the previous candidate's
      // seen rows over would make the second import look fully browsed.
      viewedClusterIdsRef.current = new Set();
    }
    // Reset tracking when leaving suggestions phase
    if (phase !== 'suggestions') {
      workflowStartTimeRef.current = null;
    }
  }, [phase, selectedCandidate]);

  // ==========================================================================
  // Workflow Analytics: Track clusters with suggestions for success rate
  // ==========================================================================
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

      const viewedClusters = viewedClusterIdsRef.current.size;

      Analytics.photoImportWorkflowCompleted({
        totalClusters,
        confirmedCount: workflowConfirmedCountRef.current,
        rejectedCount: workflowRejectedCountRef.current,
        hiddenCount: workflowHiddenCountRef.current,
        workflowDurationMs: Date.now() - workflowStartTimeRef.current,
        successRate,
        acceptanceRate,
        viewedClusters,
        viewedClusterRate: Math.round((viewedClusters / totalClusters) * 100),
      });

      // U11: the ad conversion is NO LONGER fired from here. Its trigger used to
      // be this effect's condition — every cluster confirmed, rejected or hidden
      // — which progressive interaction makes markedly rarer: a user now
      // confirms the places they care about among rows that are still resolving
      // and leaves. `trackDeparture` fires it on first-confirmation-plus-
      // departure instead, mirroring the review-prompt trigger this screen
      // already uses, and a completed workflow reaches that same departure path.
    }
  }, [selectedCandidate, dismissedClusterIdsInternal]);

  // ==========================================================================
  // U11: viewability + departure
  // ==========================================================================

  const markClustersViewed = useCallback((clusterIds: string[]) => {
    if (clusterIds.length === 0) return;
    for (const id of clusterIds) viewedClusterIdsRef.current.add(id);
  }, []);

  /**
   * Fire the once-per-lifetime photo-import ad conversion (U11).
   *
   * Anchored on FIRST CONFIRMATION PLUS DEPARTURE — the exact signal the review
   * prompt on this screen uses (`hasConfirmedPlaceRef` + back navigation) — so
   * the acquisition event and the satisfaction prompt agree on what "the user
   * got value out of this import" means.
   *
   * Idempotent: `AdEvents.firstPhotoImportDone` holds the lifetime dedupe in
   * AsyncStorage, so a user who returns to the same trip and leaves again does
   * not fire a second conversion; the local ref only saves the round trip.
   */
  const trackDeparture = useCallback(() => {
    if (adConversionFiredRef.current) return;
    if (workflowConfirmedCountRef.current < 1) return;
    adConversionFiredRef.current = true;
    // Fire-and-forget: an ad-network failure must never block navigation.
    AdEvents.firstPhotoImportDone(workflowTotalClustersRef.current).catch(() => {});
  }, []);

  // ==========================================================================
  // Cleanup on unmount - track workflow exit
  // ==========================================================================
  useEffect(() => {
    return () => {
      // U11: unmounting IS a departure, and it is the one path a swipe-back
      // gesture (which never reaches the screen's back handler) takes. Safe to
      // call twice — `trackDeparture` is idempotent within the mount and
      // AdEvents holds the lifetime dedupe.
      trackDeparture();

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
          const viewedClusters = viewedClusterIdsRef.current.size;
          // U11/R18: the concurrency-specific numbers, read at the moment of
          // departure — leaving mid-flight is the normal case under progressive
          // interaction, so this is where the abandoned tail is measurable.
          const split = readDispatchSplit();
          const telemetry = suggestionDispatch.getTelemetry();

          Analytics.photoImportWorkflowExited({
            totalClusters,
            processedClusters,
            remainingClusters,
            workflowDurationMs: Date.now() - workflowStartTimeRef.current,
            viewedClusters,
            viewedClusterRate: Math.round((viewedClusters / totalClusters) * 100),
            enqueuedClusters: split.enqueuedClusters,
            settledClusters: split.settledClusters,
            unsettledClusters: split.unsettledClusters,
            retryAttempts: telemetry.retryAttempts,
            retryGenerations: telemetry.retryGenerations,
            maxRetryAttemptsPerGeneration: telemetry.maxRetryAttemptsPerGeneration,
          });
        }
      }
    };
    // `trackDeparture` has a permanently stable identity (refs only), so the
    // cleanup still runs exactly once, on unmount.
  }, [trackDeparture]);

  // ==========================================================================
  // Increment helpers for parent hook wrappers
  // ==========================================================================
  const incrementConfirmed = () => {
    workflowConfirmedCountRef.current += 1;
  };

  const incrementRejected = () => {
    workflowRejectedCountRef.current += 1;
  };

  const incrementHidden = (count = 1) => {
    workflowHiddenCountRef.current += count;
  };

  return {
    refs: {
      workflowStartTimeRef,
      workflowConfirmedCountRef,
      workflowRejectedCountRef,
      workflowHiddenCountRef,
      workflowTotalClustersRef,
      workflowClustersWithSuggestionsRef,
      workflowCompletedRef,
    },
    incrementConfirmed,
    incrementRejected,
    incrementHidden,
    markClustersViewed,
    trackDeparture,
  };
}
