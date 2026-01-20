/**
 * usePhotoImportWorkflow - Custom hook managing the photo import workflow state and logic.
 *
 * Extracts all scan, geocode, and candidate selection logic from the screen component
 * to keep the screen focused on rendering.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { Alert } from 'react-native';

import type { SelectedPlace } from '@components/places';
import { useOnboardingStore, selectHomeCountry } from '@stores/onboardingStore';
import {
  useSuggestPlacesChunked,
  RateLimitError,
  QuotaExhaustedError,
} from '@hooks/usePhotoImport';
import { useCreateEntry, PlaceInput, CreateEntryInput } from '@hooks/useEntries';
import { useCreateTrip } from '@hooks/useTrips';
import {
  extractPhotosWithLocation,
  segmentTripsFromCache,
  photoToCachedPhoto,
  getFullCluster,
  HomeCountryNotSetError,
  getLastImportTime,
  setLastImportTime,
  getAllCachedPhotos,
  cachePhotos,
  clearPhotoCache,
  type ScanProgress,
  type TripCandidateDisplay,
  type LocationCluster,
  type LocationClusterDisplay,
  type ClusterSuggestion,
  type PlaceSuggestion,
  type PhotoWithLocation,
  type CachedPhoto,
} from '@services/photoImport';
import { Analytics } from '@services/analytics';
import type { EntryType } from '@navigation/types';

export type ImportPhase = 'idle' | 'scanning' | 'candidates' | 'suggestions';

/**
 * Type guard for AbortError.
 * Uses name-based check for React Native compatibility (no DOMException).
 */
function isAbortError(error: unknown): error is Error {
  return (
    error !== null &&
    typeof error === 'object' &&
    'name' in error &&
    (error as Error).name === 'AbortError'
  );
}

/**
 * Create an AbortError compatible with React Native.
 * Standard Error with name set to 'AbortError' for isAbortError detection.
 */
function createAbortError(message: string): Error {
  const error = new Error(message);
  error.name = 'AbortError';
  return error;
}

/**
 * Truncate coordinate to 5 decimal places (~1.1m precision) for PII protection.
 * Matches backend cache precision in place_matcher/cache.py.
 */
const truncateCoordinate = (value: number): number => Math.round(value * 100000) / 100000;

export interface PhotoImportWorkflowResult {
  // State
  phase: ImportPhase;
  scanProgress: ScanProgress | null;
  tripCandidates: TripCandidateDisplay[];
  selectedCandidate: TripCandidateDisplay | null;
  clusterDisplays: Map<string, LocationClusterDisplay>;
  manualSearchCluster: LocationCluster | null;
  suggestPlacesMutation: ReturnType<typeof useSuggestPlacesChunked>;
  /** Timestamp of last successful import, null if never imported */
  lastImportTime: number | null;
  /** Whether we're doing an incremental scan (has cache) or full scan */
  isIncremental: boolean;

  // Actions
  startScan: (forceRefresh?: boolean) => Promise<void>;
  cancelScan: () => void;
  selectCandidate: (candidate: TripCandidateDisplay) => Promise<void>;
  handleConfirmPlace: (suggestion: ClusterSuggestion, place: PlaceSuggestion) => void;
  handleRejectPlace: (suggestion: ClusterSuggestion) => void;
  handleAddEntryForCluster: (clusterId: string) => void;
  handleManualSelect: (
    place: SelectedPlace,
    category: EntryType,
    tripId: string,
    notes?: string
  ) => Promise<string | undefined>;
  handleCreateTrip: (name: string, countryCode: string) => Promise<string>;
  backToCandidates: () => void;
  closeManualSearch: () => void;
  isSaving: boolean;
}

interface UsePhotoImportWorkflowOptions {
  filterCountryCode?: string;
  onNavigateToTripForm: (params: {
    countryId: string;
    prefillPlace: {
      placeId: string;
      name: string;
      address: string;
      category: EntryType;
    };
    prefillPhotos: string[];
  }) => void;
}

export function usePhotoImportWorkflow({
  filterCountryCode,
  onNavigateToTripForm,
}: UsePhotoImportWorkflowOptions): PhotoImportWorkflowResult {
  const homeCountry = useOnboardingStore(selectHomeCountry);

  // Workflow state
  const [phase, setPhase] = useState<ImportPhase>('idle');
  const [scanProgress, setScanProgress] = useState<ScanProgress | null>(null);
  const [tripCandidates, setTripCandidates] = useState<TripCandidateDisplay[]>([]);
  const [selectedCandidate, setSelectedCandidate] = useState<TripCandidateDisplay | null>(null);
  const [lastImportTime, setLastImportTimeState] = useState<number | null>(null);
  const [isIncremental, setIsIncremental] = useState<boolean>(false);
  const abortControllerRef = useRef<AbortController | null>(null);

  // Load last import time on mount
  useEffect(() => {
    getLastImportTime().then(setLastImportTimeState);
  }, []);

  // Lookup maps for full data when needed (can be large: ~5-10MB for 10k photos)
  const [_photoLookup, setPhotoLookup] = useState<Map<string, PhotoWithLocation>>(new Map());
  const [clusterLookup, setClusterLookup] = useState<Map<string, LocationCluster>>(new Map());
  const [clusterDisplays, setClusterDisplays] = useState<Map<string, LocationClusterDisplay>>(
    new Map()
  );

  // Manual search state
  const [manualSearchCluster, setManualSearchCluster] = useState<LocationCluster | null>(null);

  /**
   * Clear large in-memory data structures to prevent memory leaks.
   * Called when returning to idle phase or on unmount.
   */
  const clearLargeDataStructures = useCallback(() => {
    setPhotoLookup(new Map());
    setClusterLookup(new Map());
    setClusterDisplays(new Map());
    setTripCandidates([]);
    setSelectedCandidate(null);
    setManualSearchCluster(null);
    setScanProgress(null);
  }, []);

  // Cleanup large data structures on unmount to prevent memory leaks
  useEffect(() => {
    return () => {
      // Note: We can't call clearLargeDataStructures here because setState
      // after unmount is a no-op, but we clear the ref which helps GC
      abortControllerRef.current?.abort();
    };
  }, []);

  const suggestPlacesMutation = useSuggestPlacesChunked();
  const createEntry = useCreateEntry();
  const createTrip = useCreateTrip();

  const startScan = useCallback(
    async (forceRefresh = false) => {
      if (!homeCountry) {
        Alert.alert(
          'Set Home Country',
          'Please set your home country in settings first. This helps us filter out local photos.',
          [{ text: 'OK' }]
        );
        return;
      }

      // Abort any previous scan before starting a new one
      abortControllerRef.current?.abort();

      const controller = new AbortController();
      abortControllerRef.current = controller;
      setPhase('scanning');
      Analytics.photoImportScanStarted();

      try {
        // Check if we have cached data and should do incremental import
        const cachedImportTime = forceRefresh ? null : await getLastImportTime();
        const doIncremental = cachedImportTime !== null;
        setIsIncremental(doIncremental);

        if (forceRefresh) {
          // Clear cache for full refresh
          await clearPhotoCache();
        }

        let allCachedPhotos: CachedPhoto[] = [];
        let newPhotos: PhotoWithLocation[] = [];

        if (doIncremental) {
          // Incremental import: load cached photos and scan only new ones
          if (__DEV__) {
            console.log(
              '[PhotoImport] Incremental scan since:',
              new Date(cachedImportTime).toISOString()
            );
          }

          // Load cached photos first (fast)
          allCachedPhotos = await getAllCachedPhotos();

          // Scan only photos created after last import
          newPhotos = await extractPhotosWithLocation(
            (progress) => {
              if (controller.signal.aborted) return;
              setScanProgress(progress);
            },
            controller.signal,
            new Date(cachedImportTime)
          );

          if (__DEV__) {
            console.log(
              `[PhotoImport] Loaded ${allCachedPhotos.length} cached, found ${newPhotos.length} new`
            );
          }
        } else {
          // Full scan: no cache, scan all photos
          newPhotos = await extractPhotosWithLocation((progress) => {
            if (controller.signal.aborted) return;
            setScanProgress(progress);
          }, controller.signal);
        }

        // Check for abort after photo extraction
        if (controller.signal.aborted) {
          throw createAbortError('Scan aborted');
        }

        // Cache new photos if we found any
        if (newPhotos.length > 0) {
          const newCachedPhotos = newPhotos.map(photoToCachedPhoto);
          await cachePhotos(newCachedPhotos);
          allCachedPhotos = [...allCachedPhotos, ...newCachedPhotos];
        }

        // Update last import time
        const importTime = Date.now();
        await setLastImportTime(importTime);
        setLastImportTimeState(importTime);

        // Check if we have any photos at all
        if (allCachedPhotos.length === 0 && newPhotos.length === 0) {
          Alert.alert(
            'No Photos Found',
            'No photos with location data were found in your library. Make sure location services were enabled when you took the photos.',
            [{ text: 'OK' }]
          );
          setPhase('idle');
          abortControllerRef.current = null;
          return;
        }

        // Segment trips from cached data (fast: no geocoding needed)
        const optimizedData = segmentTripsFromCache(allCachedPhotos, homeCountry);
        let candidates = optimizedData.candidates;
        if (filterCountryCode) {
          candidates = candidates.filter((c) => c.countryCode === filterCountryCode);
        }

        if (candidates.length === 0) {
          Alert.alert(
            'No Trips Found',
            filterCountryCode
              ? `No travel photos found for this country. Photos taken in your home country (${homeCountry}) are filtered out.`
              : `No travel photos found. Photos taken in your home country (${homeCountry}) are filtered out.`,
            [{ text: 'OK' }]
          );
          setPhase('idle');
          abortControllerRef.current = null;
          return;
        }

        const totalPhotoCount = candidates.reduce((sum, c) => sum + c.photoCount, 0);
        Analytics.photoImportScanCompleted({
          photoCount: totalPhotoCount,
          tripCandidateCount: candidates.length,
        });

        setPhotoLookup(optimizedData.photoLookup);
        setClusterLookup(optimizedData.clusterLookup);
        setClusterDisplays(optimizedData.clusterDisplays);
        setTripCandidates(candidates);
        setPhase('candidates');
        abortControllerRef.current = null;
      } catch (error) {
        abortControllerRef.current = null;
        // Clear data structures on any error to free memory
        clearLargeDataStructures();
        if (isAbortError(error)) {
          setPhase('idle');
        } else if (error instanceof HomeCountryNotSetError) {
          Alert.alert('Set Home Country', 'Please set your home country in settings first.');
          Analytics.photoImportScanFailed({ error: 'home_country_not_set' });
          setPhase('idle');
        } else {
          if (__DEV__) console.error('[PhotoImport] Scan error:', error);
          Alert.alert('Scan Failed', 'Failed to scan photos. Please try again.');
          Analytics.photoImportScanFailed({
            error: error instanceof Error ? error.message.slice(0, 100) : 'unknown',
          });
          setPhase('idle');
        }
      }
    },
    [homeCountry, filterCountryCode, clearLargeDataStructures]
  );

  const cancelScan = useCallback(() => {
    abortControllerRef.current?.abort();
    abortControllerRef.current = null;
    clearLargeDataStructures();
    setPhase('idle');
    Analytics.photoImportScanCancelled();
  }, [clearLargeDataStructures]);

  const selectCandidate = useCallback(
    async (candidate: TripCandidateDisplay) => {
      setSelectedCandidate(candidate);
      setPhase('suggestions');
      Analytics.photoImportCandidateSelected({
        countryCode: candidate.countryCode,
        clusterCount: candidate.locationClusterIds.length,
      });

      const clustersForApi = candidate.locationClusterIds
        .map((id) => getFullCluster(id, clusterLookup))
        .filter((c): c is LocationCluster => c !== undefined);

      if (__DEV__) {
        console.log('[PhotoImport] Sending clusters to API:', {
          candidateId: candidate.id,
          clusterIds: clustersForApi.map((c) => c.id),
          clusterCount: clustersForApi.length,
        });
        for (const c of clustersForApi) {
          console.log(
            `[PhotoImport]   Cluster ${c.id}: centroid=(${c.centroid.latitude.toFixed(5)}, ${c.centroid.longitude.toFixed(5)}), photos=${c.photos.length}`
          );
        }
      }

      try {
        const result = await suggestPlacesMutation.mutateAsync({
          clusters: clustersForApi.map((c) => ({
            id: c.id,
            centroid: {
              latitude: truncateCoordinate(c.centroid.latitude),
              longitude: truncateCoordinate(c.centroid.longitude),
            },
            photos: c.photos.map((p) => ({
              asset_id: p.id,
              latitude: truncateCoordinate(p.location.latitude),
              longitude: truncateCoordinate(p.location.longitude),
              timestamp: p.creationTime.toISOString(),
            })),
            start_time: c.timeRange.start.toISOString(),
            end_time: c.timeRange.end.toISOString(),
          })),
        });

        if (__DEV__) {
          console.log('[PhotoImport] API result:', {
            suggestionCount: result.suggestions.length,
            suggestionClusterIds: result.suggestions.map((s) => s.cluster_id),
          });
        }

        // Track completion with failure count from progress
        const failedChunks = suggestPlacesMutation.progress?.failedChunks ?? 0;
        Analytics.photoImportSuggestionsCompleted({
          suggestionCount: result.suggestions.length,
          failedChunks,
        });
      } catch (error) {
        if (__DEV__) console.error('[PhotoImport] Suggestion error:', error);

        if (error instanceof QuotaExhaustedError) {
          Analytics.photoImportApiError({ errorType: 'quota_exhausted' });
          Alert.alert(
            'Service Temporarily Unavailable',
            'The place suggestion service has reached its daily limit. Please try again tomorrow.'
          );
        } else if (error instanceof RateLimitError) {
          Analytics.photoImportApiError({ errorType: 'rate_limited' });
          Alert.alert(
            'Too Many Requests',
            `Please wait ${error.retryAfterSeconds} seconds before trying again.`
          );
        } else {
          Analytics.photoImportApiError({ errorType: 'unknown' });
          Alert.alert(
            'Failed to Get Suggestions',
            'Unable to find place suggestions. Please try again.'
          );
        }
      }
    },
    [suggestPlacesMutation, clusterLookup]
  );

  const handleConfirmPlace = useCallback(
    (suggestion: ClusterSuggestion, place: PlaceSuggestion) => {
      Analytics.photoImportPlaceConfirmed({ category: place.category });
      if (selectedCandidate) {
        const cluster = getFullCluster(suggestion.cluster_id, clusterLookup);
        onNavigateToTripForm({
          countryId: selectedCandidate.countryCode,
          prefillPlace: {
            placeId: place.place_id,
            name: place.name,
            address: place.address,
            category: place.category,
          },
          prefillPhotos: cluster?.photos.map((p) => p.uri) ?? [],
        });
      }
    },
    [selectedCandidate, clusterLookup, onNavigateToTripForm]
  );

  const handleRejectPlace = useCallback(
    (suggestion: ClusterSuggestion) => {
      Analytics.photoImportPlaceRejected();
      const cluster = getFullCluster(suggestion.cluster_id, clusterLookup);
      if (cluster) {
        setManualSearchCluster(cluster);
        Analytics.photoImportManualSearchOpened();
      }
    },
    [clusterLookup]
  );

  const handleAddEntryForCluster = useCallback(
    (clusterId: string) => {
      const cluster = getFullCluster(clusterId, clusterLookup);
      if (cluster) {
        setManualSearchCluster(cluster);
        Analytics.photoImportManualSearchOpened();
      }
    },
    [clusterLookup]
  );

  const handleCreateTrip = useCallback(
    async (name: string, countryCode: string): Promise<string> => {
      try {
        const trip = await createTrip.mutateAsync({ name, country_code: countryCode });
        return trip.id;
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Failed to create trip';
        Alert.alert('Error', message);
        throw err;
      }
    },
    [createTrip]
  );

  const handleManualSelect = useCallback(
    async (place: SelectedPlace, category: EntryType, tripId: string, notes?: string) => {
      const cluster = manualSearchCluster;
      const clusterId = cluster?.id;
      setManualSearchCluster(null);

      // Build place input for entry creation
      const placeInput: PlaceInput = {
        google_place_id: place.google_place_id,
        name: place.name,
        address: place.address,
        latitude: place.latitude,
        longitude: place.longitude,
        google_photo_url: place.google_photo_url,
      };

      // Create entry data
      const entryData: CreateEntryInput = {
        trip_id: tripId,
        entry_type: category,
        title: place.name,
        notes: notes || undefined,
        place: placeInput,
        // Get entry date from cluster's earliest photo timestamp
        entry_date: cluster?.timeRange.start.toISOString().split('T')[0],
      };

      try {
        await createEntry.mutateAsync(entryData);
        Analytics.photoImportPlaceConfirmed({ category });

        // Entry saved successfully - modal will close and user returns to suggestions list
        // Return the cluster ID so the screen can mark it as processed/dismissed
        return clusterId;
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Failed to save entry';
        Alert.alert('Save Failed', message);
        // Re-open manual search so user can try again
        if (cluster) {
          setManualSearchCluster(cluster);
        }
        throw err; // Re-throw so caller knows it failed
      }
    },
    [manualSearchCluster, createEntry]
  );

  const backToCandidates = useCallback(() => {
    setSelectedCandidate(null);
    setPhase('candidates');
    suggestPlacesMutation.reset();
  }, [suggestPlacesMutation]);

  const closeManualSearch = useCallback(() => {
    setManualSearchCluster(null);
  }, []);

  return {
    // State
    phase,
    scanProgress,
    tripCandidates,
    selectedCandidate,
    clusterDisplays,
    manualSearchCluster,
    suggestPlacesMutation,
    lastImportTime,
    isIncremental,
    isSaving: createEntry.isPending,

    // Actions
    startScan,
    cancelScan,
    selectCandidate,
    handleConfirmPlace,
    handleRejectPlace,
    handleAddEntryForCluster,
    handleManualSelect,
    handleCreateTrip,
    backToCandidates,
    closeManualSearch,
  };
}
