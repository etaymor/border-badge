/**
 * useAutoStartWorkflow - Hook for auto-starting the photo import workflow.
 *
 * Handles the auto-start logic when the workflow should skip directly to suggestions
 * or start scanning based on cached data availability.
 */

import { useEffect, useRef } from 'react';

import { Analytics } from '@services/analytics';
import {
  applyPersistedSplits,
  applySavedPhotoFilter,
  getAllCachedPhotos,
  getAllSavedPhotoIds,
  getClusterSplitsForParents,
  getLastImportTime,
  getLastSelectedCandidateId,
  segmentTripsFromCache,
  type TripCandidateDisplay,
  type LocationCluster,
  type LocationClusterDisplay,
  type PhotoWithLocation,
} from '@services/photoImport';

import type { ImportPhase } from './photoImportTypes';

export interface UseAutoStartWorkflowOptions {
  /** Whether to auto-start the workflow */
  autoStart?: boolean;
  /** Country code filter */
  filterCountryCode?: string;
  /** Pre-associated trip ID */
  tripId?: string;
  /** Skip scanning and go directly to candidates when cache exists */
  skipToSuggestions?: boolean;
  /** User's home country */
  homeCountry: string | null;
  /** Subscription status from store */
  subscriptionStatus: string;
  /** Whether user has premium access */
  isPremium: boolean;
  /** Whether user can import photos */
  canImportPhotos: boolean;
  /**
   * The R17-aware entitlement gate (U10). Auto-start is THE path that reopens an
   * already-imported trip, so this is the gate the exemption exists for: without
   * it a free user who half-matched a trip can never get back into it, on this
   * device or any other. Optional; falls back to the raw store read.
   */
  canRunImportForTrip?: (tripId: string | null) => Promise<boolean>;
  /** Ref tracking current candidate ID */
  currentCandidateIdRef: React.MutableRefObject<string | null>;
  /** Start scan function */
  startScan: (forceRefresh?: boolean) => Promise<void>;
  /** Handle premium gating */
  handlePremiumGate: (
    context: string,
    options?: { nextPhase?: ImportPhase; candidate?: TripCandidateDisplay }
  ) => void;
  /** Fetch suggestions for a candidate */
  fetchSuggestions: (
    candidate: TripCandidateDisplay,
    tripId?: string | null
  ) => Promise<{ gatedByPremium: true } | undefined>;
  /**
   * Claim a dispatch owner slot (R1/KTD13). Auto-start is the path that opens an
   * already-imported trip, and it previously reported NOTHING for its whole
   * duration — so every cluster still on the wire was reconciled to
   * `lookup-failed`. It owns a slot across its entire async body, cache read and
   * segmentation included, not just around `fetchSuggestions`.
   */
  beginFetchOwner: () => void;
  /** Release auto-start's dispatch owner slot. Always paired in a `finally`. */
  endFetchOwner: () => void;
  /** Set cluster lookup state */
  setClusterLookup: (lookup: Map<string, LocationCluster>) => void;
  /** Set cluster displays state */
  setClusterDisplays: (displays: Map<string, LocationClusterDisplay>) => void;
  /** Photo lookup ref */
  photoLookupRef: React.MutableRefObject<Map<string, PhotoWithLocation>>;
  /** Cluster lookup ref */
  clusterLookupRef: React.MutableRefObject<Map<string, LocationCluster>>;
  /** Cluster displays ref */
  clusterDisplaysRef: React.MutableRefObject<Map<string, LocationClusterDisplay>>;
  /** Set trip candidates state */
  setTripCandidates: (candidates: TripCandidateDisplay[]) => void;
  /** Set last import time state */
  setLastImportTimeState: (time: number | null) => void;
  /** Set is incremental state */
  setIsIncremental: (isIncremental: boolean) => void;
  /** Set selected candidate state */
  setSelectedCandidate: (candidate: TripCandidateDisplay | null) => void;
  /** Set selected trip ID state */
  setSelectedTripId: (tripId: string | null) => void;
  /** Set phase state */
  setPhase: (phase: ImportPhase) => void;
  /** Ref tracking whether the parent component has unmounted */
  unmountedRef: React.MutableRefObject<boolean>;
  /** Merge auto-dismissed cluster IDs into the workflow's dismissed set */
  mergeAutoDismissedClusterIds: (ids: Set<string>) => void;
}

export function useAutoStartWorkflow({
  autoStart,
  filterCountryCode,
  tripId,
  skipToSuggestions,
  homeCountry,
  subscriptionStatus,
  isPremium,
  canImportPhotos,
  canRunImportForTrip,
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
}: UseAutoStartWorkflowOptions): void {
  // Track whether auto-start has been attempted
  const autoStartAttemptedRef = useRef(false);

  useEffect(() => {
    if (__DEV__) {
      console.log('[PhotoImport][AutoStart] Effect fired', {
        autoStart,
        filterCountryCode,
        tripId,
        skipToSuggestions,
        homeCountry,
        subscriptionStatus,
        isPremium,
        canImportPhotos,
      });
    }
    const canAutoStart =
      autoStart && !autoStartAttemptedRef.current && (homeCountry || skipToSuggestions);

    if (canAutoStart) {
      autoStartAttemptedRef.current = true;

      const runAutoStart = async () => {
        if (__DEV__) {
          console.log('[PhotoImport][AutoStart] Starting sequence');
        }

        // If no country filter, just start a scan (e.g., first-time from PhotoTripsScreen)
        if (!filterCountryCode) {
          startScan(false).catch(() => {
            /* error handled by scan hook */
          });
          return;
        }

        const lastImport = await getLastImportTime();
        if (__DEV__) {
          console.log('[PhotoImport][AutoStart] lastImport', lastImport);
        }

        // If skipToSuggestions is enabled, load from cache directly
        if (skipToSuggestions) {
          const allCachedPhotos = await getAllCachedPhotos();
          if (__DEV__) {
            console.log('[PhotoImport][AutoStart] cachedPhotos', allCachedPhotos.length);
          }
          if (allCachedPhotos.length === 0) {
            // Cache empty, fallback to normal scan
            if (__DEV__) {
              console.log('[PhotoImport][AutoStart] cache empty -> startScan');
            }
            startScan(false).catch(() => {
              /* error handled by scan hook */
            });
            return;
          }

          // Build candidates from cache (fast - no device scanning)
          const segmented = segmentTripsFromCache(allCachedPhotos, homeCountry);

          // Re-apply persisted manual splits and filter out photos already
          // saved to entries; otherwise the user sees the original parent
          // cluster (and any half they already saved) reappear on every entry.
          const allClusterIds = Array.from(segmented.clusterLookup.keys());
          const [splitsByParent, savedPhotoIds] = await Promise.all([
            getClusterSplitsForParents(allClusterIds).catch(() => new Map()),
            getAllSavedPhotoIds().catch(() => new Set<string>()),
          ]);
          const splitApplied = applyPersistedSplits(segmented, splitsByParent);
          const { data: optimizedData, autoDismissed } = applySavedPhotoFilter(
            splitApplied,
            savedPhotoIds
          );
          if (autoDismissed.size > 0) {
            mergeAutoDismissedClusterIds(autoDismissed);
          }

          let candidates = optimizedData.candidates;

          // Filter to the requested country
          candidates = candidates.filter((c) => c.countryCode === filterCountryCode);

          if (candidates.length === 0) {
            // No candidates for this country - shouldn't happen if UI showed button
            // but fallback to scan just in case
            startScan(false).catch(() => {
              /* error handled by scan hook */
            });
            return;
          }

          // When skipping to suggestions with a tripId, wait for subscription status
          // BEFORE setting any React state. Otherwise state gets set, then overwritten
          // when the effect re-fires after subscription resolves — losing split state.
          if (tripId && subscriptionStatus === 'loading') {
            if (__DEV__) {
              console.log('[PhotoImport] Delaying auto-start - waiting for subscription status');
            }
            autoStartAttemptedRef.current = false;
            return;
          }

          // Bail out if component unmounted during async work
          if (unmountedRef.current) return;

          // Set state from cache (photoLookup only stored in ref - not needed for UI updates)
          setClusterLookup(optimizedData.clusterLookup);
          setClusterDisplays(optimizedData.clusterDisplays);
          photoLookupRef.current = optimizedData.photoLookup;
          clusterLookupRef.current = optimizedData.clusterLookup;
          clusterDisplaysRef.current = optimizedData.clusterDisplays;
          setTripCandidates(candidates);
          setLastImportTimeState(lastImport ?? null);
          setIsIncremental(true);

          // If tripId is provided with skipToSuggestions, go directly to suggestions phase
          if (tripId && candidates.length > 0) {
            if (__DEV__) {
              console.log('[PhotoImport][AutoStart] candidates ready', {
                candidateCount: candidates.length,
                tripId,
              });
            }
            // Check premium gating upfront before any phase transition
            // Note: isPremium and canImportPhotos are from hook state, which is current
            // since we already waited for subscriptionStatus !== 'loading'
            //
            // U10/R17: gate site 3 of 3 upstream of the fetch, and the one that
            // matters most — this is the path a user takes to RETURN to a trip
            // they already spent their import on.
            const importAllowed = canRunImportForTrip
              ? await canRunImportForTrip(tripId)
              : isPremium || canImportPhotos;
            if (!importAllowed) {
              setTripCandidates(candidates);
              handlePremiumGate('autoStart', { nextPhase: 'candidates' });
              return;
            }

            // Check for a previously selected candidate for this destination trip
            const lastCandidateId = await getLastSelectedCandidateId(tripId);
            let candidate = candidates[0]; // Default to first

            if (lastCandidateId) {
              const rememberedCandidate = candidates.find((c) => c.id === lastCandidateId);
              if (rememberedCandidate) {
                candidate = rememberedCandidate;
              }
            }

            // Track current candidate for race condition detection
            currentCandidateIdRef.current = candidate.id;

            setSelectedCandidate(candidate);
            setSelectedTripId(tripId);
            setPhase('suggestions');

            if (__DEV__) {
              console.log('[PhotoImport][AutoStart] fetchSuggestions start', candidate.id);
            }
            const fetchResult = await fetchSuggestions(candidate, tripId);
            if (__DEV__) {
              console.log('[PhotoImport][AutoStart] fetchSuggestions done', fetchResult ?? 'ok');
            }
            if (fetchResult?.gatedByPremium) {
              handlePremiumGate('autoStart-fetch', {
                nextPhase: 'suggestions',
                candidate,
              });
              return;
            }

            Analytics.photoImportCandidateSelected({
              countryCode: candidate.countryCode,
              clusterCount: candidate.locationClusterIds.length,
            });
          } else {
            // No tripId - show candidates for user to select
            if (__DEV__) {
              console.log('[PhotoImport][AutoStart] no tripId -> candidates');
            }
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
          startScan(false).catch(() => {
            /* error handled by scan hook */
          });
        }
      };

      // R1/KTD13: claim the dispatch owner slot around the ENTIRE sequence and
      // release it exactly once. Every branch above returns early — unmounted,
      // premium gate before the fetch, premium gate after the fetch, the
      // subscription-still-loading bail, and all three scan fallbacks — and a
      // stranded owner would withhold every terminal row for the rest of the
      // session, so the release must not live at any single return site.
      (async () => {
        beginFetchOwner();
        try {
          await runAutoStart();
        } finally {
          endFetchOwner();
        }
      })();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    autoStart,
    filterCountryCode,
    homeCountry,
    skipToSuggestions,
    subscriptionStatus,
    isPremium,
    canImportPhotos,
    handlePremiumGate,
  ]);
}
