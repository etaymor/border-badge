/**
 * useWorkflowAnalytics - Hook for tracking photo import workflow analytics.
 *
 * Tracks workflow timing, completion rates, and user actions for analytics.
 */

import { useEffect, useRef } from 'react';

import { Analytics } from '@services/analytics';
import type { ClusterSuggestion } from '@services/photoImport';

import type { ImportPhase } from './photoImportTypes';
import type { TripCandidateDisplay } from '@services/photoImport';

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
  // Cleanup on unmount - track workflow exit
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
    };
  }, []);

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
  };
}
