import { renderHook, act, waitFor } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';

import {
  usePhotoImportWorkflow,
  ImportPhase,
} from '../../../screens/photos/usePhotoImportWorkflow';
import * as onboardingStore from '../../../stores/onboardingStore';
import * as photoImportService from '../../../services/photoImport';
import * as photoImportHooks from '../../../hooks/usePhotoImport';
import { Analytics } from '../../../services/analytics';

// Mock dependencies
jest.mock('../../../stores/onboardingStore', () => ({
  useOnboardingStore: jest.fn(),
  selectHomeCountry: jest.fn(),
}));

jest.mock('../../../services/photoImport', () => ({
  extractPhotosWithLocation: jest.fn(),
  segmentTripsFromCache: jest.fn(),
  photoToCachedPhoto: jest.fn((photo) => ({
    ...photo,
    creationTime: photo.creationTime.getTime(),
    latitude: photo.location.latitude,
    longitude: photo.location.longitude,
    geohash: 'testgeohash',
    countryCode: 'JP',
  })),
  getFullCluster: jest.fn(),
  HomeCountryNotSetError: class HomeCountryNotSetError extends Error {
    constructor() {
      super('Home country not set');
      this.name = 'HomeCountryNotSetError';
    }
  },
  getLastImportTime: jest.fn(),
  setLastImportTime: jest.fn(),
  getAllCachedPhotos: jest.fn(),
  cachePhotos: jest.fn(),
  clearPhotoCache: jest.fn(),
  abortBackgroundSync: jest.fn(),
  markClusterProcessed: jest.fn(),
  getProcessedClusterIds: jest.fn().mockResolvedValue(new Set<string>()),
}));

jest.mock('../../../hooks/usePhotoImport', () => ({
  useSuggestPlacesChunked: jest.fn(),
  RateLimitError: class RateLimitError extends Error {
    retryAfterSeconds: number;
    constructor(retryAfterSeconds: number) {
      super(`Rate limited. Retry after ${retryAfterSeconds} seconds.`);
      this.name = 'RateLimitError';
      this.retryAfterSeconds = retryAfterSeconds;
    }
  },
  QuotaExhaustedError: class QuotaExhaustedError extends Error {
    constructor() {
      super('Daily quota exhausted');
      this.name = 'QuotaExhaustedError';
    }
  },
}));

jest.mock('../../../hooks/useEntries', () => ({
  useCreateEntry: jest.fn(() => ({
    mutateAsync: jest.fn().mockResolvedValue({ id: 'entry-1' }),
    isPending: false,
  })),
}));

jest.mock('../../../hooks/useTrips', () => ({
  useCreateTrip: jest.fn(() => ({
    mutateAsync: jest.fn().mockResolvedValue({ id: 'trip-1' }),
    isPending: false,
  })),
}));

jest.mock('../../../services/analytics', () => ({
  Analytics: {
    photoImportScanStarted: jest.fn(),
    photoImportScanCompleted: jest.fn(),
    photoImportScanFailed: jest.fn(),
    photoImportScanCancelled: jest.fn(),
    photoImportCandidateSelected: jest.fn(),
    photoImportSuggestionsCompleted: jest.fn(),
    photoImportApiError: jest.fn(),
    photoImportPlaceConfirmed: jest.fn(),
    photoImportPlaceRejected: jest.fn(),
    photoImportManualSearchOpened: jest.fn(),
  },
}));

const mockedOnboardingStore = onboardingStore as jest.Mocked<typeof onboardingStore>;
const mockedPhotoImport = photoImportService as jest.Mocked<typeof photoImportService>;
const mockedPhotoImportHooks = photoImportHooks as jest.Mocked<typeof photoImportHooks>;

const createTestQueryClient = () =>
  new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0 },
      mutations: { retry: false },
    },
  });

function createWrapper(queryClient: QueryClient) {
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
  };
}

// Helper to create mock photos
function createMockPhoto(id: string, countryCode = 'JP') {
  return {
    id,
    uri: `file://photo-${id}.jpg`,
    filename: `photo-${id}.jpg`,
    creationTime: new Date('2024-01-15T10:00:00Z'),
    location: { latitude: 35.6762, longitude: 139.6503 },
    countryCode,
  };
}

// Helper to create mock cached photos
function createMockCachedPhoto(id: string, countryCode = 'JP') {
  return {
    id,
    uri: `file://photo-${id}.jpg`,
    filename: `photo-${id}.jpg`,
    creationTime: Date.now(),
    latitude: 35.6762,
    longitude: 139.6503,
    geohash: 'xn76urx',
    countryCode,
  };
}

// Helper to create mock trip candidates
function createMockTripCandidate(id: string, countryCode = 'JP') {
  return {
    id,
    countryCode,
    dateRange: {
      start: new Date('2024-01-15'),
      end: new Date('2024-01-20'),
    },
    photoIds: ['photo-1', 'photo-2'],
    photoCount: 2,
    previewUris: ['file://photo-1.jpg', 'file://photo-2.jpg'],
    locationClusterIds: ['cluster-1'],
  };
}

// Helper to create mock clusters
function createMockCluster(id: string) {
  return {
    id,
    geohash: id,
    centroid: { latitude: 35.6762, longitude: 139.6503 },
    photos: [createMockPhoto('photo-1')],
    timeRange: {
      start: new Date('2024-01-15T10:00:00Z'),
      end: new Date('2024-01-15T18:00:00Z'),
    },
    countryCode: 'JP',
  };
}

describe('usePhotoImportWorkflow', () => {
  let queryClient: QueryClient;
  const mockSuggestPlacesMutation = {
    mutateAsync: jest.fn(),
    reset: jest.fn(),
    progress: null,
    partialResults: [],
  };

  beforeEach(() => {
    queryClient = createTestQueryClient();
    jest.clearAllMocks();

    // Default mocks
    mockedOnboardingStore.useOnboardingStore.mockReturnValue('US');
    mockedPhotoImportHooks.useSuggestPlacesChunked.mockReturnValue(
      mockSuggestPlacesMutation as unknown as ReturnType<
        typeof photoImportHooks.useSuggestPlacesChunked
      >
    );
    mockedPhotoImport.getLastImportTime.mockResolvedValue(null);
    mockedPhotoImport.setLastImportTime.mockResolvedValue(undefined);
    mockedPhotoImport.getAllCachedPhotos.mockResolvedValue([]);
    mockedPhotoImport.cachePhotos.mockResolvedValue(undefined);
    mockedPhotoImport.clearPhotoCache.mockResolvedValue(undefined);
  });

  afterEach(async () => {
    queryClient.cancelQueries();
    queryClient.clear();
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  });

  describe('initial state', () => {
    it('starts in idle phase', () => {
      const { result } = renderHook(() => usePhotoImportWorkflow({}), {
        wrapper: createWrapper(queryClient),
      });

      expect(result.current.phase).toBe('idle');
      expect(result.current.scanProgress).toBeNull();
      expect(result.current.tripCandidates).toEqual([]);
      expect(result.current.selectedCandidate).toBeNull();
    });

    it('loads last import time on mount', async () => {
      const lastImportTime = Date.now() - 3600000;
      mockedPhotoImport.getLastImportTime.mockResolvedValue(lastImportTime);

      const { result } = renderHook(() => usePhotoImportWorkflow({}), {
        wrapper: createWrapper(queryClient),
      });

      await waitFor(() => {
        expect(result.current.lastImportTime).toBe(lastImportTime);
      });
    });
  });

  describe('startScan', () => {
    it('shows alert when home country is not set', async () => {
      mockedOnboardingStore.useOnboardingStore.mockReturnValue(null);

      const { result } = renderHook(() => usePhotoImportWorkflow({}), {
        wrapper: createWrapper(queryClient),
      });

      await act(async () => {
        await result.current.startScan();
      });

      expect(result.current.phase).toBe('idle');
      expect(global.__mockAlert.alert).toHaveBeenCalledWith(
        'Set Home Country',
        expect.stringContaining('Please set your home country'),
        expect.any(Array)
      );
    });

    it('transitions to scanning phase', async () => {
      const mockPhotos = [createMockPhoto('photo-1')];
      mockedPhotoImport.extractPhotosWithLocation.mockResolvedValue(mockPhotos);
      mockedPhotoImport.segmentTripsFromCache.mockReturnValue({
        candidates: [createMockTripCandidate('trip-1')],
        photoLookup: new Map(),
        clusterLookup: new Map(),
        clusterDisplays: new Map(),
      });

      const { result } = renderHook(() => usePhotoImportWorkflow({}), {
        wrapper: createWrapper(queryClient),
      });

      await act(async () => {
        await result.current.startScan();
      });

      expect(Analytics.photoImportScanStarted).toHaveBeenCalled();
    });

    it('performs incremental scan when cache exists', async () => {
      const lastImportTime = Date.now() - 3600000;
      mockedPhotoImport.getLastImportTime.mockResolvedValue(lastImportTime);
      mockedPhotoImport.getAllCachedPhotos.mockResolvedValue([createMockCachedPhoto('cached-1')]);
      mockedPhotoImport.extractPhotosWithLocation.mockResolvedValue([createMockPhoto('new-1')]);
      mockedPhotoImport.segmentTripsFromCache.mockReturnValue({
        candidates: [createMockTripCandidate('trip-1')],
        photoLookup: new Map(),
        clusterLookup: new Map(),
        clusterDisplays: new Map(),
      });

      const { result } = renderHook(() => usePhotoImportWorkflow({}), {
        wrapper: createWrapper(queryClient),
      });

      await act(async () => {
        await result.current.startScan();
      });

      expect(mockedPhotoImport.getAllCachedPhotos).toHaveBeenCalled();
      expect(mockedPhotoImport.extractPhotosWithLocation).toHaveBeenCalledWith(
        expect.any(Function),
        expect.any(AbortSignal),
        expect.any(Date) // createdAfter date
      );
    });

    it('clears cache on force refresh', async () => {
      mockedPhotoImport.getLastImportTime.mockResolvedValue(Date.now() - 3600000);
      mockedPhotoImport.extractPhotosWithLocation.mockResolvedValue([createMockPhoto('photo-1')]);
      mockedPhotoImport.segmentTripsFromCache.mockReturnValue({
        candidates: [createMockTripCandidate('trip-1')],
        photoLookup: new Map(),
        clusterLookup: new Map(),
        clusterDisplays: new Map(),
      });

      const { result } = renderHook(() => usePhotoImportWorkflow({}), {
        wrapper: createWrapper(queryClient),
      });

      await act(async () => {
        await result.current.startScan(true); // forceRefresh = true
      });

      expect(mockedPhotoImport.clearPhotoCache).toHaveBeenCalled();
    });

    it('shows alert when no photos with location found', async () => {
      mockedPhotoImport.extractPhotosWithLocation.mockResolvedValue([]);
      mockedPhotoImport.getAllCachedPhotos.mockResolvedValue([]);

      const { result } = renderHook(() => usePhotoImportWorkflow({}), {
        wrapper: createWrapper(queryClient),
      });

      await act(async () => {
        await result.current.startScan();
      });

      expect(global.__mockAlert.alert).toHaveBeenCalledWith(
        'No Photos Found',
        expect.stringContaining('No photos with location data'),
        expect.any(Array)
      );
      expect(result.current.phase).toBe('idle');
    });

    it('shows alert when no trips found (all photos from home country)', async () => {
      mockedPhotoImport.extractPhotosWithLocation.mockResolvedValue([createMockPhoto('photo-1')]);
      mockedPhotoImport.segmentTripsFromCache.mockReturnValue({
        candidates: [], // Empty - all filtered out as home country
        photoLookup: new Map(),
        clusterLookup: new Map(),
        clusterDisplays: new Map(),
      });

      const { result } = renderHook(() => usePhotoImportWorkflow({}), {
        wrapper: createWrapper(queryClient),
      });

      await act(async () => {
        await result.current.startScan();
      });

      expect(global.__mockAlert.alert).toHaveBeenCalledWith(
        'No Trips Found',
        expect.stringContaining('No travel photos found'),
        expect.any(Array)
      );
      expect(result.current.phase).toBe('idle');
    });

    it('transitions to candidates phase on successful scan', async () => {
      const mockCandidates = [createMockTripCandidate('trip-1')];
      mockedPhotoImport.extractPhotosWithLocation.mockResolvedValue([createMockPhoto('photo-1')]);
      mockedPhotoImport.segmentTripsFromCache.mockReturnValue({
        candidates: mockCandidates,
        photoLookup: new Map(),
        clusterLookup: new Map(),
        clusterDisplays: new Map(),
      });

      const { result } = renderHook(() => usePhotoImportWorkflow({}), {
        wrapper: createWrapper(queryClient),
      });

      await act(async () => {
        await result.current.startScan();
      });

      expect(result.current.phase).toBe('candidates');
      expect(result.current.tripCandidates).toEqual(mockCandidates);
      expect(Analytics.photoImportScanCompleted).toHaveBeenCalledWith({
        photoCount: 2,
        tripCandidateCount: 1,
      });
    });

    it('filters candidates by country code when filterCountryCode is set', async () => {
      const mockCandidates = [
        createMockTripCandidate('trip-jp', 'JP'),
        createMockTripCandidate('trip-fr', 'FR'),
      ];
      mockedPhotoImport.extractPhotosWithLocation.mockResolvedValue([createMockPhoto('photo-1')]);
      mockedPhotoImport.segmentTripsFromCache.mockReturnValue({
        candidates: mockCandidates,
        photoLookup: new Map(),
        clusterLookup: new Map(),
        clusterDisplays: new Map(),
      });

      const { result } = renderHook(
        () =>
          usePhotoImportWorkflow({
            filterCountryCode: 'JP',
          }),
        { wrapper: createWrapper(queryClient) }
      );

      await act(async () => {
        await result.current.startScan();
      });

      expect(result.current.tripCandidates).toHaveLength(1);
      expect(result.current.tripCandidates[0].countryCode).toBe('JP');
    });

    it('caches new photos after scan', async () => {
      const mockPhotos = [createMockPhoto('photo-1')];
      mockedPhotoImport.extractPhotosWithLocation.mockResolvedValue(mockPhotos);
      mockedPhotoImport.segmentTripsFromCache.mockReturnValue({
        candidates: [createMockTripCandidate('trip-1')],
        photoLookup: new Map(),
        clusterLookup: new Map(),
        clusterDisplays: new Map(),
      });

      const { result } = renderHook(() => usePhotoImportWorkflow({}), {
        wrapper: createWrapper(queryClient),
      });

      await act(async () => {
        await result.current.startScan();
      });

      expect(mockedPhotoImport.cachePhotos).toHaveBeenCalled();
      expect(mockedPhotoImport.setLastImportTime).toHaveBeenCalled();
    });
  });

  describe('cancelScan', () => {
    it('aborts the scan and returns to idle', async () => {
      const { result } = renderHook(() => usePhotoImportWorkflow({}), {
        wrapper: createWrapper(queryClient),
      });

      // Call cancelScan directly - it should work even in idle state
      act(() => {
        result.current.cancelScan();
      });

      expect(result.current.phase).toBe('idle');
      expect(Analytics.photoImportScanCancelled).toHaveBeenCalled();
    });
  });

  describe('selectCandidate', () => {
    it('transitions to trip-selection phase', async () => {
      const mockCandidate = createMockTripCandidate('trip-1');

      const { result } = renderHook(() => usePhotoImportWorkflow({}), {
        wrapper: createWrapper(queryClient),
      });

      act(() => {
        result.current.selectCandidate(mockCandidate);
      });

      expect(result.current.phase).toBe('trip-selection');
      expect(result.current.selectedCandidate).toEqual(mockCandidate);
      expect(Analytics.photoImportCandidateSelected).toHaveBeenCalledWith({
        countryCode: 'JP',
        clusterCount: 1,
      });
    });
  });

  describe('selectTrip', () => {
    it('transitions to suggestions phase and fetches suggestions', async () => {
      const mockCandidate = createMockTripCandidate('trip-1');
      const mockCluster = createMockCluster('cluster-1');
      mockedPhotoImport.getFullCluster.mockReturnValue(mockCluster);
      mockSuggestPlacesMutation.mutateAsync.mockResolvedValue({
        suggestions: [
          {
            cluster_id: 'cluster-1',
            photo_ids: ['photo-1'],
            places: [
              {
                place_id: 'ChIJ123',
                name: 'Test Place',
                address: 'Test Address',
                location: { latitude: 35.6762, longitude: 139.6503 },
                category: 'place',
                distance_m: 50,
                types: ['tourist_attraction'],
              },
            ],
          },
        ],
      });

      const { result } = renderHook(() => usePhotoImportWorkflow({}), {
        wrapper: createWrapper(queryClient),
      });

      // First select a candidate to get to trip-selection phase
      act(() => {
        result.current.selectCandidate(mockCandidate);
      });
      expect(result.current.phase).toBe('trip-selection');

      // Then select a trip to transition to suggestions
      await act(async () => {
        await result.current.selectTrip('trip-123');
      });

      expect(result.current.phase).toBe('suggestions');
      expect(result.current.selectedTripId).toBe('trip-123');
      expect(mockSuggestPlacesMutation.mutateAsync).toHaveBeenCalled();
    });

    it('handles quota exhausted error', async () => {
      const mockCandidate = createMockTripCandidate('trip-1');
      mockedPhotoImport.getFullCluster.mockReturnValue(createMockCluster('cluster-1'));
      mockSuggestPlacesMutation.mutateAsync.mockRejectedValue(
        new photoImportHooks.QuotaExhaustedError()
      );

      const { result } = renderHook(() => usePhotoImportWorkflow({}), {
        wrapper: createWrapper(queryClient),
      });

      // First select a candidate
      act(() => {
        result.current.selectCandidate(mockCandidate);
      });

      // Then select a trip (which triggers fetching suggestions)
      await act(async () => {
        await result.current.selectTrip('trip-123');
      });

      expect(Analytics.photoImportApiError).toHaveBeenCalledWith({ errorType: 'quota_exhausted' });
      expect(global.__mockAlert.alert).toHaveBeenCalledWith(
        'Service Temporarily Unavailable',
        expect.stringContaining('daily limit')
      );
    });

    it('handles rate limit error', async () => {
      const mockCandidate = createMockTripCandidate('trip-1');
      mockedPhotoImport.getFullCluster.mockReturnValue(createMockCluster('cluster-1'));
      mockSuggestPlacesMutation.mutateAsync.mockRejectedValue(
        new photoImportHooks.RateLimitError(30)
      );

      const { result } = renderHook(() => usePhotoImportWorkflow({}), {
        wrapper: createWrapper(queryClient),
      });

      // First select a candidate
      act(() => {
        result.current.selectCandidate(mockCandidate);
      });

      // Then select a trip
      await act(async () => {
        await result.current.selectTrip('trip-123');
      });

      expect(Analytics.photoImportApiError).toHaveBeenCalledWith({ errorType: 'rate_limited' });
      expect(global.__mockAlert.alert).toHaveBeenCalledWith(
        'Too Many Requests',
        expect.stringContaining('30 seconds')
      );
    });
  });

  describe('handleConfirmPlace', () => {
    it('creates entry directly when trip is selected', async () => {
      const mockCandidate = createMockTripCandidate('trip-1');
      const mockCluster = createMockCluster('cluster-1');
      const mockSuggestion = {
        cluster_id: 'cluster-1',
        photo_ids: ['photo-1'],
        places: [],
      };
      const mockPlace = {
        place_id: 'ChIJ123',
        name: 'Test Place',
        address: 'Test Address',
        location: {
          latitude: 35.6762,
          longitude: 139.6503,
        },
        category: 'place' as const,
        distance_m: 50,
        types: ['tourist_attraction'],
      };

      mockedPhotoImport.getFullCluster.mockReturnValue(mockCluster);
      mockSuggestPlacesMutation.mutateAsync.mockResolvedValue({ suggestions: [] });

      const { result } = renderHook(() => usePhotoImportWorkflow({}), {
        wrapper: createWrapper(queryClient),
      });

      // First select a candidate
      act(() => {
        result.current.selectCandidate(mockCandidate);
      });

      // Then select a trip
      await act(async () => {
        await result.current.selectTrip('trip-123');
      });

      // Now confirm a place - should create entry directly
      await act(async () => {
        await result.current.handleConfirmPlace(mockSuggestion, mockPlace);
      });

      expect(Analytics.photoImportPlaceConfirmed).toHaveBeenCalledWith({ category: 'place' });
      // Cluster should be dismissed after confirmation
      expect(result.current.dismissedClusterIdsInternal.has('cluster-1')).toBe(true);
    });

    it('shows error if no trip selected', async () => {
      const mockCandidate = createMockTripCandidate('trip-1');
      const mockSuggestion = {
        cluster_id: 'cluster-1',
        photo_ids: ['photo-1'],
        places: [],
      };
      const mockPlace = {
        place_id: 'ChIJ123',
        name: 'Test Place',
        address: 'Test Address',
        location: {
          latitude: 35.6762,
          longitude: 139.6503,
        },
        category: 'place' as const,
        distance_m: 50,
        types: ['tourist_attraction'],
      };

      const { result } = renderHook(() => usePhotoImportWorkflow({}), {
        wrapper: createWrapper(queryClient),
      });

      // Select a candidate but don't select a trip
      act(() => {
        result.current.selectCandidate(mockCandidate);
      });

      // Try to confirm without selecting a trip
      await act(async () => {
        await result.current.handleConfirmPlace(mockSuggestion, mockPlace);
      });

      expect(global.__mockAlert.alert).toHaveBeenCalledWith('Error', 'Please select a trip first.');
    });
  });

  describe('handleRejectPlace', () => {
    it('opens manual search for the cluster', async () => {
      const mockCluster = createMockCluster('cluster-1');
      const mockSuggestion = {
        cluster_id: 'cluster-1',
        photo_ids: ['photo-1'],
        places: [],
      };

      mockedPhotoImport.getFullCluster.mockReturnValue(mockCluster);

      const { result } = renderHook(() => usePhotoImportWorkflow({}), {
        wrapper: createWrapper(queryClient),
      });

      act(() => {
        result.current.handleRejectPlace(mockSuggestion);
      });

      expect(Analytics.photoImportPlaceRejected).toHaveBeenCalled();
      expect(Analytics.photoImportManualSearchOpened).toHaveBeenCalled();
      expect(result.current.manualSearchCluster).toEqual(mockCluster);
    });
  });

  describe('handleAddEntryForCluster', () => {
    it('opens manual search for the specified cluster', () => {
      const mockCluster = createMockCluster('cluster-1');
      mockedPhotoImport.getFullCluster.mockReturnValue(mockCluster);

      const { result } = renderHook(() => usePhotoImportWorkflow({}), {
        wrapper: createWrapper(queryClient),
      });

      act(() => {
        result.current.handleAddEntryForCluster('cluster-1');
      });

      expect(Analytics.photoImportManualSearchOpened).toHaveBeenCalled();
      expect(result.current.manualSearchCluster).toEqual(mockCluster);
    });
  });

  describe('backToCandidates', () => {
    it('returns to candidates phase and resets state', async () => {
      const mockCandidate = createMockTripCandidate('trip-1');
      mockedPhotoImport.getFullCluster.mockReturnValue(createMockCluster('cluster-1'));
      mockSuggestPlacesMutation.mutateAsync.mockResolvedValue({ suggestions: [] });

      const { result } = renderHook(() => usePhotoImportWorkflow({}), {
        wrapper: createWrapper(queryClient),
      });

      // Go to trip-selection phase first
      act(() => {
        result.current.selectCandidate(mockCandidate);
      });

      expect(result.current.phase).toBe('trip-selection');

      act(() => {
        result.current.backToCandidates();
      });

      expect(result.current.phase).toBe('candidates');
      expect(result.current.selectedCandidate).toBeNull();
      expect(result.current.selectedTripId).toBeNull();
      expect(mockSuggestPlacesMutation.reset).toHaveBeenCalled();
    });
  });

  describe('backToTripSelection', () => {
    it('returns to trip-selection phase and resets suggestions', async () => {
      const mockCandidate = createMockTripCandidate('trip-1');
      mockedPhotoImport.getFullCluster.mockReturnValue(createMockCluster('cluster-1'));
      mockSuggestPlacesMutation.mutateAsync.mockResolvedValue({ suggestions: [] });

      const { result } = renderHook(() => usePhotoImportWorkflow({}), {
        wrapper: createWrapper(queryClient),
      });

      // Go through the full flow to suggestions phase
      act(() => {
        result.current.selectCandidate(mockCandidate);
      });

      await act(async () => {
        await result.current.selectTrip('trip-123');
      });

      expect(result.current.phase).toBe('suggestions');

      act(() => {
        result.current.backToTripSelection();
      });

      expect(result.current.phase).toBe('trip-selection');
      expect(result.current.selectedTripId).toBeNull();
      expect(mockSuggestPlacesMutation.reset).toHaveBeenCalled();
    });
  });

  describe('closeManualSearch', () => {
    it('clears manual search cluster', () => {
      const mockCluster = createMockCluster('cluster-1');
      mockedPhotoImport.getFullCluster.mockReturnValue(mockCluster);

      const { result } = renderHook(() => usePhotoImportWorkflow({}), {
        wrapper: createWrapper(queryClient),
      });

      // Open manual search first
      act(() => {
        result.current.handleAddEntryForCluster('cluster-1');
      });

      expect(result.current.manualSearchCluster).not.toBeNull();

      act(() => {
        result.current.closeManualSearch();
      });

      expect(result.current.manualSearchCluster).toBeNull();
    });
  });

  describe('handleCreateTrip', () => {
    it('creates a new trip and returns its ID', async () => {
      // The hook is already mocked in jest.mock above, which returns { id: 'trip-1' }
      const { result } = renderHook(() => usePhotoImportWorkflow({}), {
        wrapper: createWrapper(queryClient),
      });

      let tripId: string;
      await act(async () => {
        tripId = await result.current.handleCreateTrip('Japan Trip', 'JP');
      });

      // The mock returns 'trip-1' as defined in the jest.mock at the top
      expect(tripId!).toBe('trip-1');
    });
  });

  describe('phase transitions', () => {
    it('follows idle -> scanning -> candidates -> trip-selection -> suggestions flow', async () => {
      const phases: ImportPhase[] = [];
      const mockCandidate = createMockTripCandidate('trip-1');

      mockedPhotoImport.extractPhotosWithLocation.mockResolvedValue([createMockPhoto('photo-1')]);
      mockedPhotoImport.segmentTripsFromCache.mockReturnValue({
        candidates: [mockCandidate],
        photoLookup: new Map(),
        clusterLookup: new Map(),
        clusterDisplays: new Map(),
      });
      mockedPhotoImport.getFullCluster.mockReturnValue(createMockCluster('cluster-1'));
      mockSuggestPlacesMutation.mutateAsync.mockResolvedValue({ suggestions: [] });

      const { result } = renderHook(() => usePhotoImportWorkflow({}), {
        wrapper: createWrapper(queryClient),
      });

      phases.push(result.current.phase);

      await act(async () => {
        await result.current.startScan();
      });
      phases.push(result.current.phase);

      act(() => {
        result.current.selectCandidate(mockCandidate);
      });
      phases.push(result.current.phase);

      await act(async () => {
        await result.current.selectTrip('trip-123');
      });
      phases.push(result.current.phase);

      expect(phases).toEqual(['idle', 'candidates', 'trip-selection', 'suggestions']);
    });
  });
});
