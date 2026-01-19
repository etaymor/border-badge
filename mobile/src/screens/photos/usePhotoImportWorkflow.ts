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
import {
  extractPhotosWithLocation,
  clusterByLocation,
  geocodeClusterCentroids,
  segmentTripsOptimized,
  getFullCluster,
  HomeCountryNotSetError,
  type GeocodeRetryInfo,
  type ScanProgress,
  type TripCandidateDisplay,
  type LocationCluster,
  type LocationClusterDisplay,
  type ClusterSuggestion,
  type PlaceSuggestion,
  type PhotoWithLocation,
} from '@services/photoImport';
import { Analytics } from '@services/analytics';
import type { EntryType } from '@navigation/types';

export type ImportPhase = 'idle' | 'scanning' | 'candidates' | 'suggestions';

/**
 * Truncate coordinate to 4 decimal places (~11m precision) for PII protection.
 */
const truncateCoordinate = (value: number): number => Math.round(value * 10000) / 10000;

export interface PhotoImportWorkflowResult {
  // State
  phase: ImportPhase;
  scanProgress: ScanProgress | null;
  tripCandidates: TripCandidateDisplay[];
  selectedCandidate: TripCandidateDisplay | null;
  clusterDisplays: Map<string, LocationClusterDisplay>;
  manualSearchCluster: LocationCluster | null;
  suggestPlacesMutation: ReturnType<typeof useSuggestPlacesChunked>;

  // Actions
  startScan: () => Promise<void>;
  cancelScan: () => void;
  selectCandidate: (candidate: TripCandidateDisplay) => Promise<void>;
  handleConfirmPlace: (suggestion: ClusterSuggestion, place: PlaceSuggestion) => void;
  handleRejectPlace: (suggestion: ClusterSuggestion) => void;
  handleManualSelect: (place: SelectedPlace, category: EntryType) => void;
  backToCandidates: () => void;
  closeManualSearch: () => void;
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
  const abortControllerRef = useRef<AbortController | null>(null);

  // Cleanup AbortController on unmount to prevent memory leaks
  useEffect(() => {
    return () => {
      abortControllerRef.current?.abort();
    };
  }, []);

  // Lookup maps for full data when needed
  const [_photoLookup, setPhotoLookup] = useState<Map<string, PhotoWithLocation>>(new Map());
  const [clusterLookup, setClusterLookup] = useState<Map<string, LocationCluster>>(new Map());
  const [clusterDisplays, setClusterDisplays] = useState<Map<string, LocationClusterDisplay>>(
    new Map()
  );

  // Manual search state
  const [manualSearchCluster, setManualSearchCluster] = useState<LocationCluster | null>(null);

  const suggestPlacesMutation = useSuggestPlacesChunked();

  const startScan = useCallback(async () => {
    if (!homeCountry) {
      Alert.alert(
        'Set Home Country',
        'Please set your home country in settings first. This helps us filter out local photos.',
        [{ text: 'OK' }]
      );
      return;
    }

    const controller = new AbortController();
    abortControllerRef.current = controller;
    setPhase('scanning');
    Analytics.photoImportScanStarted();

    try {
      const photos = await extractPhotosWithLocation(
        (progress) => setScanProgress(progress),
        controller.signal
      );

      if (photos.length === 0) {
        Alert.alert(
          'No Photos Found',
          'No photos with location data were found in your library. Make sure location services were enabled when you took the photos.',
          [{ text: 'OK' }]
        );
        setPhase('idle');
        return;
      }

      const clusters = clusterByLocation(photos);

      // Track current progress for retry updates
      let currentDone = 0;
      let currentTotal = 0;

      await geocodeClusterCentroids(
        clusters,
        (done, total) => {
          currentDone = done;
          currentTotal = total;
          setScanProgress({
            phase: 'geocoding',
            current: done,
            total,
            percentage: Math.round((done / total) * 100),
          });
        },
        (retryInfo: GeocodeRetryInfo | null) => {
          // Update progress with retry info (or clear it)
          setScanProgress((prev) =>
            prev
              ? {
                  ...prev,
                  retry: retryInfo ?? undefined,
                }
              : {
                  phase: 'geocoding',
                  current: currentDone,
                  total: currentTotal,
                  percentage: currentTotal > 0 ? Math.round((currentDone / currentTotal) * 100) : 0,
                  retry: retryInfo ?? undefined,
                }
          );
        }
      );

      const optimizedData = segmentTripsOptimized(clusters, homeCountry);
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
    } catch (error) {
      if ((error as Error).name === 'AbortError') {
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
  }, [homeCountry, filterCountryCode]);

  const cancelScan = useCallback(() => {
    abortControllerRef.current?.abort();
    abortControllerRef.current = null;
    setPhase('idle');
    Analytics.photoImportScanCancelled();
  }, []);

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

  const handleManualSelect = useCallback(
    (place: SelectedPlace, category: EntryType) => {
      const clusterPhotos = manualSearchCluster?.photos ?? [];
      setManualSearchCluster(null);
      if (selectedCandidate) {
        onNavigateToTripForm({
          countryId: selectedCandidate.countryCode,
          prefillPlace: {
            placeId: place.google_place_id,
            name: place.name,
            address: place.address ?? '',
            category: category,
          },
          prefillPhotos: clusterPhotos.map((p) => p.uri),
        });
      }
    },
    [selectedCandidate, manualSearchCluster, onNavigateToTripForm]
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

    // Actions
    startScan,
    cancelScan,
    selectCandidate,
    handleConfirmPlace,
    handleRejectPlace,
    handleManualSelect,
    backToCandidates,
    closeManualSearch,
  };
}
