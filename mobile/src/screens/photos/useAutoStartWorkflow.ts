/**
 * useAutoStartWorkflow - Hook for auto-starting the photo import workflow.
 *
 * Handles the auto-start logic when the workflow should skip directly to suggestions
 * or start scanning based on cached data availability.
 */

import { useEffect, useRef } from 'react';

import { Analytics } from '@services/analytics';
import {
  getAllCachedPhotos,
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
    candidate: TripCandidateDisplay
  ) => Promise<{ gatedByPremium: true } | undefined>;
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
      autoStart &&
      filterCountryCode &&
      !autoStartAttemptedRef.current &&
      (homeCountry || skipToSuggestions);

    if (canAutoStart) {
      autoStartAttemptedRef.current = true;

      (async () => {
        if (__DEV__) {
          console.log('[PhotoImport][AutoStart] Starting sequence');
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
          setLastImportTimeState(lastImport ?? null);
          setIsIncremental(true);

          // If tripId is provided with skipToSuggestions, go directly to suggestions phase
          if (tripId && candidates.length > 0) {
            // Skip auto-start if subscription status is still loading
            // This prevents premium gate checks from happening before RevenueCat initializes
            if (subscriptionStatus === 'loading') {
              if (__DEV__) {
                console.log('[PhotoImport] Delaying auto-start - waiting for subscription status');
              }
              autoStartAttemptedRef.current = false;
              return;
            }
            if (__DEV__) {
              console.log('[PhotoImport][AutoStart] candidates ready', {
                candidateCount: candidates.length,
                tripId,
              });
            }
            // Check premium gating upfront before any phase transition
            // Note: isPremium and canImportPhotos are from hook state, which is current
            // since we already waited for subscriptionStatus !== 'loading'
            if (!isPremium && !canImportPhotos) {
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
            const fetchResult = await fetchSuggestions(candidate);
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
          startScan(false);
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
