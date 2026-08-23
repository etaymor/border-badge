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

const mockCreateEntryMutateAsync = jest.fn();
const mockUploadPhotos = jest.fn();
const mockGetUploadState = jest.fn();
const mockCancelUpload = jest.fn();
const mockResetUpload = jest.fn();

// Mock dependencies
jest.mock('../../../stores/onboardingStore', () => ({
  useOnboardingStore: jest.fn(),
  selectHomeCountry: jest.fn(),
}));

jest.mock('../../../services/photoImport/visionPhoto', () => ({
  getVisionImagesForCluster: jest.fn().mockResolvedValue([]),
  selectRepresentativePhotos: jest.fn().mockReturnValue([]),
  selectRepresentativePhoto: jest.fn().mockReturnValue(null),
  prepareVisionImage: jest.fn().mockResolvedValue(null),
  getVisionImageForCluster: jest.fn().mockResolvedValue(null),
}));

// Drives the photoScanService mock — tests push results/failures here, then the
// mocked startScan call updates the trip-scan slice of libraryJobStore to
// simulate the runtime.
const mockScanResultRef: {
  current: import('../../../screens/photos/usePhotoScan').ScanResult | null;
} = {
  current: null,
};
const mockServiceFailureRef: {
  current: import('../../../services/photoImport/photoScanTypes').PhotoScanFailure | null;
} = { current: null };

jest.mock('../../../services/photoImport', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { patchJobSlice } = require('../../../stores/libraryJobStore');
  return {
    extractPhotosWithLocation: jest.fn(),
    segmentTripsFromCache: jest.fn(),
    photoToCachedPhoto: jest.fn(
      (photo: { creationTime: Date; location: { latitude: number; longitude: number } }) => ({
        ...photo,
        creationTime: photo.creationTime.getTime(),
        latitude: photo.location.latitude,
        longitude: photo.location.longitude,
        geohash: 'testgeohash',
        countryCode: 'JP',
      })
    ),
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
    saveTripSegments: jest.fn().mockResolvedValue(undefined),
    abortBackgroundSync: jest.fn(),
    markClusterProcessed: jest.fn(),
    markPhotosSaved: jest.fn().mockResolvedValue(undefined),
    saveClusterSplit: jest.fn().mockResolvedValue(undefined),
    getClusterSplitsForParents: jest.fn().mockResolvedValue(new Map()),
    getAllSavedPhotoIds: jest.fn().mockResolvedValue(new Set<string>()),
    applyPersistedSplits: jest.fn((data) => data),
    applySavedPhotoFilter: jest.fn((data) => ({ data, autoDismissed: new Set<string>() })),
    createSubCluster: jest.fn(
      (
        parent: { id: string; geohash: string; centroid: unknown; countryCode: string },
        photoIds: Set<string>,
        suffix: string
      ) => ({
        id: `${parent.id}__split_${suffix}`,
        geohash: parent.geohash,
        centroid: parent.centroid,
        photos: [...photoIds].map((id) => ({
          id,
          uri: `file://${id}.jpg`,
          filename: `${id}.jpg`,
          creationTime: new Date('2024-06-01T10:00:00Z'),
          location: { latitude: 35.6762, longitude: 139.6503 },
          countryCode: 'JP',
        })),
        timeRange: {
          start: new Date('2024-06-01T10:00:00Z'),
          end: new Date('2024-06-01T11:00:00Z'),
        },
        countryCode: parent.countryCode,
      })
    ),
    toLocationClusterDisplay: jest.fn((cluster: { id: string; photos: { id: string }[] }) => ({
      id: cluster.id,
      geohash: cluster.id,
      centroid: { latitude: 0, longitude: 0 },
      photoIds: cluster.photos.map((p) => p.id),
      photoCount: cluster.photos.length,
      previewUris: [],
      previewAssetIds: [],
      timeRange: { start: new Date(), end: new Date() },
      countryCode: 'JP',
    })),
    getProcessedClusterIds: jest.fn().mockResolvedValue(new Set<string>()),
    getCachedSuggestions: jest.fn().mockResolvedValue(new Map()),
    cacheSuggestions: jest.fn().mockResolvedValue(undefined),
    clusterLocationKey: jest.fn().mockReturnValue('geohash-test-key'),
    getLastSelectedCandidateId: jest.fn().mockResolvedValue(null),
    setLastSelectedCandidateId: jest.fn().mockResolvedValue(undefined),
    computeTimeHint: jest.fn().mockReturnValue(null),
    getVisionImagesForCluster: jest.fn().mockResolvedValue([]),

    // photoScanService surface mocked here so the workflow's adapter can drive
    // the real libraryJobStore from test setups via mockScanResultRef.
    startScan: jest.fn(async (opts: { homeCountry: string | null }) => {
      if (!opts.homeCountry) {
        return { status: 'rejected', reason: 'no-home-country' };
      }
      // Push the prepared result/failure into the real store so the adapter's
      // subscription forwards it to the workflow callbacks.
      if (mockServiceFailureRef.current) {
        patchJobSlice('trip-scan', {
          phase: 'failed',
          progress: null,
          failure: mockServiceFailureRef.current,
          hasResult: false,
        });
      } else if (mockScanResultRef.current) {
        patchJobSlice('trip-scan', {
          phase: 'completed',
          progress: null,
          hasResult: true,
        });
      } else {
        patchJobSlice('trip-scan', { phase: 'running' });
      }
      return { status: 'started' };
    }),
    cancelScan: jest.fn(() => {
      mockScanResultRef.current = null;
      mockServiceFailureRef.current = null;
      patchJobSlice('trip-scan', { phase: 'idle', progress: null, hasResult: false });
    }),
    consumeResult: jest.fn(() => {
      const result = mockScanResultRef.current;
      mockScanResultRef.current = null;
      patchJobSlice('trip-scan', { hasResult: false });
      return result;
    }),
    hasResult: jest.fn(() => mockScanResultRef.current !== null),
    isScanRunning: jest.fn(() => false),
    getLastProgressAt: jest.fn(() => 0),
    markFailed: jest.fn(),
  };
});

// Import actual error classes to use in tests - these are the same classes used by the real code
const actualPhotoImportHooks = jest.requireActual('../../../hooks/usePhotoImport');

// The dispatch controller is a module-level singleton (U14/KTD21), so it is
// stubbed here the way the chunked mutation used to be: the workflow tests only
// care that a dispatch was requested, not how it batches.
jest.mock('../../../services/photoImport/suggestionDispatch', () => {
  const actual = jest.requireActual('../../../services/photoImport/suggestionDispatch');
  return {
    ...actual,
    suggestionDispatch: {
      dispatch: jest.fn(),
      dispatchBatch: jest.fn(),
      claim: jest.fn((ids: string[]) => ids),
      releaseClaim: jest.fn(),
      clearFailedClusterIds: jest.fn(),
      addFailedClusterIds: jest.fn(),
      beginOwner: jest.fn(),
      endOwner: jest.fn(),
      reset: jest.fn(),
      // U11: the exit event reads the settled-versus-enqueued split and the
      // concurrency telemetry off the singleton, so the stub carries both.
      getState: jest.fn(() => ({
        progress: null,
        failedClusterIds: new Map(),
        enqueuedClusterIds: new Set<string>(),
        dispatchedAndResolvedClusterIds: new Set<string>(),
      })),
      getTelemetry: jest.fn(() => ({
        peakInFlightBatches: 0,
        meanInFlightBatches: 0,
        wireBusyMs: 0,
        wireSpanMs: 0,
        retryAttempts: 0,
        retryGenerations: 0,
        maxRetryAttemptsPerGeneration: 0,
      })),
      getInFlightBatchCount: jest.fn(() => 0),
      recordRetryAttempt: jest.fn(),
      subscribe: jest.fn(() => () => undefined),
    },
  };
});

const mockSuggestionDispatchController = jest.requireMock(
  '../../../services/photoImport/suggestionDispatch'
).suggestionDispatch as {
  dispatch: jest.Mock;
  reset: jest.Mock;
};

jest.mock('../../../hooks/usePhotoImport', () => {
  const actual = jest.requireActual('../../../hooks/usePhotoImport');
  return {
    useSuggestionDispatch: jest.fn(),
    RateLimitError: actual.RateLimitError,
    QuotaExhaustedError: actual.QuotaExhaustedError,
  };
});

jest.mock('../../../hooks/useEntries', () => ({
  useCreateEntry: jest.fn(() => ({
    mutateAsync: mockCreateEntryMutateAsync,
    isPending: false,
  })),
}));

jest.mock('../../../hooks/useMultiClusterUpload', () => ({
  useMultiClusterUpload: jest.fn(() => ({
    uploads: new Map(),
    getUploadState: mockGetUploadState,
    uploadPhotos: mockUploadPhotos,
    cancel: mockCancelUpload,
    reset: mockResetUpload,
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
    photoImportClusterHidden: jest.fn(),
    photoImportWorkflowCompleted: jest.fn(),
    photoImportWorkflowExited: jest.fn(),
  },
  calculateApiPercentiles: jest.fn(() => ({ p50: 100, p95: 200, p99: 300 })),
}));

// Mock subscription store to allow photo imports (bypass premium gating)
jest.mock('../../../stores/subscriptionStore', () => ({
  useSubscriptionStore: jest.fn(() => jest.fn()),
  useIsPremium: jest.fn(() => true), // Simulate premium user
  useCanImportPhotos: jest.fn(() => true), // Allow photo imports
}));

// Mock react-navigation
jest.mock('@react-navigation/native', () => ({
  useNavigation: jest.fn(() => ({
    navigate: jest.fn(),
    goBack: jest.fn(),
  })),
  useIsFocused: () => true,
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
    previewAssetIds: ['photo-1', 'photo-2'],
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
  const mockSuggestionDispatchState = {
    isDispatching: false,
    progress: null,
    partialResults: [],
    data: null,
    failedClusterIds: new Map(),
    enqueuedClusterIds: new Set<string>(),
    inFlightClusterIds: new Set<string>(),
    dispatchedAndResolvedClusterIds: new Set<string>(),
    ownerCount: 0,
  };

  beforeEach(() => {
    queryClient = createTestQueryClient();
    jest.clearAllMocks();
    mockCreateEntryMutateAsync.mockResolvedValue({ id: 'entry-1' });
    mockUploadPhotos.mockResolvedValue({ mediaIds: [], failedCount: 0 });
    mockGetUploadState.mockReturnValue(null);
    mockScanResultRef.current = null;
    mockServiceFailureRef.current = null;
    // Reset the real libraryJobStore so tests start from a known state.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { resetLibraryJobStore } = require('../../../stores/libraryJobStore');
    resetLibraryJobStore();

    // Default mocks
    mockedOnboardingStore.useOnboardingStore.mockReturnValue('US');
    mockedPhotoImportHooks.useSuggestionDispatch.mockReturnValue(
      mockSuggestionDispatchState as unknown as ReturnType<
        typeof photoImportHooks.useSuggestionDispatch
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
    it('surfaces home-country failure when home country is not set', async () => {
      mockedOnboardingStore.useOnboardingStore.mockReturnValue(null);

      const { result } = renderHook(() => usePhotoImportWorkflow({}), {
        wrapper: createWrapper(queryClient),
      });

      await act(async () => {
        await result.current.startScan();
      });

      expect(result.current.phase).toBe('idle');
      expect(result.current.scanFailure).toEqual(
        expect.objectContaining({
          reason: 'home-country',
          title: 'Set Home Country',
        })
      );
    });

    it('delegates to photoScanService.startScan with the right options', async () => {
      mockScanResultRef.current = {
        candidates: [createMockTripCandidate('trip-1')],
        photoLookup: new Map(),
        clusterLookup: new Map(),
        clusterDisplays: new Map(),
        importTime: Date.now(),
        isIncremental: false,
      };

      const { result } = renderHook(() => usePhotoImportWorkflow({}), {
        wrapper: createWrapper(queryClient),
      });

      await act(async () => {
        await result.current.startScan();
      });

      expect(mockedPhotoImport.startScan).toHaveBeenCalledWith({
        homeCountry: 'US',
        filterCountryCode: undefined,
        forceRefresh: false,
      });
    });

    it('passes forceRefresh through to the service', async () => {
      mockScanResultRef.current = {
        candidates: [createMockTripCandidate('trip-1')],
        photoLookup: new Map(),
        clusterLookup: new Map(),
        clusterDisplays: new Map(),
        importTime: Date.now(),
        isIncremental: false,
      };

      const { result } = renderHook(() => usePhotoImportWorkflow({}), {
        wrapper: createWrapper(queryClient),
      });

      await act(async () => {
        await result.current.startScan(true);
      });

      expect(mockedPhotoImport.startScan).toHaveBeenCalledWith(
        expect.objectContaining({ forceRefresh: true })
      );
    });

    it('reflects service-side no-photos failure into scanFailure', async () => {
      mockServiceFailureRef.current = {
        reason: 'no-photos',
        title: 'No Photos Found',
        message: 'No photos with location data were found in your library.',
      };

      const { result } = renderHook(() => usePhotoImportWorkflow({}), {
        wrapper: createWrapper(queryClient),
      });

      await act(async () => {
        await result.current.startScan();
      });

      expect(result.current.scanFailure).toEqual(
        expect.objectContaining({ reason: 'no-photos', title: 'No Photos Found' })
      );
      expect(result.current.phase).toBe('idle');
    });

    it('reflects service-side no-trips failure into scanFailure', async () => {
      mockServiceFailureRef.current = {
        reason: 'no-trips',
        title: 'No Trips Found',
        message: 'No travel photos found.',
      };

      const { result } = renderHook(() => usePhotoImportWorkflow({}), {
        wrapper: createWrapper(queryClient),
      });

      await act(async () => {
        await result.current.startScan();
      });

      expect(result.current.scanFailure).toEqual(expect.objectContaining({ reason: 'no-trips' }));
      expect(result.current.phase).toBe('idle');
    });

    it('transitions to candidates phase when service publishes a result', async () => {
      const mockCandidates = [createMockTripCandidate('trip-1')];
      mockScanResultRef.current = {
        candidates: mockCandidates,
        photoLookup: new Map(),
        clusterLookup: new Map(),
        clusterDisplays: new Map(),
        importTime: Date.now(),
        isIncremental: false,
      };

      const { result } = renderHook(() => usePhotoImportWorkflow({}), {
        wrapper: createWrapper(queryClient),
      });

      await act(async () => {
        await result.current.startScan();
      });

      expect(result.current.phase).toBe('candidates');
      expect(result.current.tripCandidates).toEqual(mockCandidates);
    });
  });

  describe('cancelScan', () => {
    it('cancels the service and returns the screen to idle', async () => {
      const { result } = renderHook(() => usePhotoImportWorkflow({}), {
        wrapper: createWrapper(queryClient),
      });

      act(() => {
        result.current.cancelScan();
      });

      expect(result.current.phase).toBe('idle');
      expect(mockedPhotoImport.cancelScan).toHaveBeenCalled();
    });
  });

  describe('lazy initial state from libraryJobStore', () => {
    it('initializes phase=scanning on mount when the service is mid-scan', () => {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { patchJobSlice } = require('../../../stores/libraryJobStore');
      patchJobSlice('trip-scan', { phase: 'running' });

      const { result } = renderHook(() => usePhotoImportWorkflow({}), {
        wrapper: createWrapper(queryClient),
      });

      // First render should render scanning, never IdlePhase, satisfying R3.
      expect(result.current.phase).toBe('scanning');
    });

    it('initializes phase=idle for pre-existing alert-style failures', () => {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { patchJobSlice } = require('../../../stores/libraryJobStore');
      patchJobSlice('trip-scan', {
        phase: 'failed',
        failure: {
          reason: 'no-trips',
          title: 'No Trips Found',
          message: 'No travel photos found.',
        },
      });

      const { result } = renderHook(() => usePhotoImportWorkflow({}), {
        wrapper: createWrapper(queryClient),
      });

      expect(result.current.phase).toBe('idle');
      expect(result.current.scanFailure).toEqual(expect.objectContaining({ reason: 'no-trips' }));
    });

    it('initializes phase=scanning for pre-existing inline retry failures', () => {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { patchJobSlice } = require('../../../stores/libraryJobStore');
      patchJobSlice('trip-scan', {
        phase: 'failed',
        failure: {
          reason: 'stuck',
          title: 'Scan Stopped',
          message: 'The scan stopped making progress. Tap to retry.',
        },
      });

      const { result } = renderHook(() => usePhotoImportWorkflow({}), {
        wrapper: createWrapper(queryClient),
      });

      expect(result.current.phase).toBe('scanning');
      expect(result.current.scanFailure).toEqual(expect.objectContaining({ reason: 'stuck' }));
    });

    it('consumes a pre-existing completed result on mount', async () => {
      const mockCandidates = [createMockTripCandidate('trip-1')];
      mockScanResultRef.current = {
        candidates: mockCandidates,
        photoLookup: new Map(),
        clusterLookup: new Map(),
        clusterDisplays: new Map(),
        importTime: Date.now(),
        isIncremental: false,
      };
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { patchJobSlice } = require('../../../stores/libraryJobStore');
      patchJobSlice('trip-scan', { phase: 'completed', hasResult: true });

      const { result } = renderHook(() => usePhotoImportWorkflow({}), {
        wrapper: createWrapper(queryClient),
      });

      await waitFor(() => {
        expect(result.current.phase).toBe('candidates');
      });
      expect(result.current.tripCandidates).toEqual(mockCandidates);
      expect(mockedPhotoImport.consumeResult).toHaveBeenCalled();
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
      mockSuggestionDispatchController.dispatch.mockResolvedValue({
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
      expect(mockSuggestionDispatchController.dispatch).toHaveBeenCalled();
    });

    it('handles quota exhausted error', async () => {
      const mockCandidate = createMockTripCandidate('trip-1');
      mockedPhotoImport.getFullCluster.mockReturnValue(createMockCluster('cluster-1'));
      mockSuggestionDispatchController.dispatch.mockRejectedValue(
        new actualPhotoImportHooks.QuotaExhaustedError()
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
      // M1 (U10): no Alert on the fetch error path. The chunked mutation records
      // the un-responded clusters into `failedClusterIds` (retryDisabled for
      // 429/503), so useClusterItems surfaces each as a `lookup-failed` card with
      // the time-gated message — an Alert on top would double-surface.
      expect(global.__mockAlert.alert).not.toHaveBeenCalled();
    });

    it('handles rate limit error', async () => {
      const mockCandidate = createMockTripCandidate('trip-1');
      mockedPhotoImport.getFullCluster.mockReturnValue(createMockCluster('cluster-1'));
      mockSuggestionDispatchController.dispatch.mockRejectedValue(
        new actualPhotoImportHooks.RateLimitError(30)
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
      // M1 (U10): no Alert on the fetch error path — the lookup-failed card (with
      // the time-gated message for 429/503) already surfaces it.
      expect(global.__mockAlert.alert).not.toHaveBeenCalled();
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
      mockSuggestionDispatchController.dispatch.mockResolvedValue({ suggestions: [] });

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
        await result.current.handleConfirmPlace(mockSuggestion, mockPlace, {
          suggested_rank: 1,
          alternatives_count: 1,
          alternatives_viewed: 1,
        });
      });

      expect(Analytics.photoImportPlaceConfirmed).toHaveBeenCalledWith(
        expect.objectContaining({ category: 'place' })
      );
      // Cluster should be dismissed after confirmation
      expect(result.current.dismissedClusterIdsInternal.has('cluster-1')).toBe(true);
    });

    it('uploads photos from additional merged clusters when confirming', async () => {
      const mockCandidate = createMockTripCandidate('trip-1');
      mockCandidate.locationClusterIds = ['cluster-1', 'cluster-2'];

      const clusterOnePhoto = createMockPhoto('photo-1');
      const clusterTwoPhoto = createMockPhoto('photo-2');
      const clusterOne = { ...createMockCluster('cluster-1'), photos: [clusterOnePhoto] };
      const clusterTwo = { ...createMockCluster('cluster-2'), photos: [clusterTwoPhoto] };

      const mockSuggestion = {
        cluster_id: 'cluster-1',
        photo_ids: ['photo-1', 'photo-2'],
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

      mockedPhotoImport.getFullCluster.mockImplementation((clusterId: string) => {
        if (clusterId === 'cluster-1') return clusterOne;
        if (clusterId === 'cluster-2') return clusterTwo;
        return undefined;
      });
      mockSuggestionDispatchController.dispatch.mockResolvedValue({ suggestions: [] });
      mockUploadPhotos.mockResolvedValue({
        mediaIds: ['media-1', 'media-2'],
        failedCount: 0,
      });

      const { result } = renderHook(() => usePhotoImportWorkflow({}), {
        wrapper: createWrapper(queryClient),
      });

      act(() => {
        result.current.selectCandidate(mockCandidate);
      });

      await act(async () => {
        await result.current.selectTrip('trip-123');
      });

      await act(async () => {
        await result.current.handleConfirmPlace(
          mockSuggestion,
          mockPlace,
          { suggested_rank: 1, alternatives_count: 1, alternatives_viewed: 1 },
          false,
          ['cluster-2']
        );
      });

      expect(mockUploadPhotos).toHaveBeenCalledWith(
        'cluster-1',
        expect.arrayContaining([clusterOnePhoto, clusterTwoPhoto]),
        'trip-123'
      );
      const uploadedPhotos = mockUploadPhotos.mock.calls[0][1] as Array<{ id: string }>;
      expect(uploadedPhotos).toHaveLength(2);
      expect(result.current.dismissedClusterIdsInternal.has('cluster-1')).toBe(true);
      expect(result.current.dismissedClusterIdsInternal.has('cluster-2')).toBe(true);
      expect(mockedPhotoImport.markClusterProcessed).toHaveBeenCalledWith('cluster-1', 'confirmed');
      expect(mockedPhotoImport.markClusterProcessed).toHaveBeenCalledWith('cluster-2', 'confirmed');
      expect(mockCreateEntryMutateAsync).toHaveBeenCalledWith(
        expect.objectContaining({
          pending_media_ids: ['media-1', 'media-2'],
        })
      );
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
        await result.current.handleConfirmPlace(mockSuggestion, mockPlace, {
          suggested_rank: 1,
          alternatives_count: 1,
          alternatives_viewed: 1,
        });
      });

      expect(global.__mockAlert.alert).toHaveBeenCalledWith('Error', 'Please select a trip first.');
    });

    it('forwards photo_import provenance and flags overrides for evals', async () => {
      const mockCandidate = createMockTripCandidate('trip-1');
      const mockCluster = createMockCluster('cluster-1');

      const topPlace = {
        place_id: 'ChIJ_top',
        name: 'Top Suggestion',
        address: 'Top Address',
        location: { latitude: 35.6762, longitude: 139.6503 },
        category: 'place' as const,
        distance_m: 30,
        types: ['tourist_attraction'],
      };
      const altPlace = {
        place_id: 'ChIJ_alt',
        name: 'User Pick',
        address: 'Alt Address',
        location: { latitude: 35.6763, longitude: 139.6504 },
        category: 'food' as const,
        distance_m: 80,
        types: ['restaurant'],
      };
      const mockSuggestion = {
        cluster_id: 'cluster-1',
        photo_ids: ['photo-1'],
        places: [topPlace, altPlace],
      };

      mockedPhotoImport.getFullCluster.mockReturnValue(mockCluster);
      mockSuggestionDispatchController.dispatch.mockResolvedValue({ suggestions: [] });
      mockUploadPhotos.mockResolvedValue({ mediaIds: ['media-1'], failedCount: 0 });

      const { result } = renderHook(() => usePhotoImportWorkflow({}), {
        wrapper: createWrapper(queryClient),
      });

      act(() => {
        result.current.selectCandidate(mockCandidate);
      });
      await act(async () => {
        await result.current.selectTrip('trip-123');
      });

      // User cycled to the second alternative before confirming.
      await act(async () => {
        await result.current.handleConfirmPlace(mockSuggestion, altPlace, {
          suggested_rank: 2,
          alternatives_count: 2,
          alternatives_viewed: 2,
        });
      });

      expect(mockCreateEntryMutateAsync).toHaveBeenCalledWith(
        expect.objectContaining({
          photo_import: {
            cluster_id: 'cluster-1',
            suggested_place_id: 'ChIJ_top',
            suggested_rank: 2,
            alternatives_count: 2,
            alternatives_viewed: 2,
            was_override: true,
            was_from_cache: false,
          },
        })
      );
      expect(Analytics.photoImportPlaceConfirmed).toHaveBeenCalledWith(
        expect.objectContaining({
          suggestionRank: 2,
          originalSuggestionPlaceId: 'ChIJ_top',
          wasOverride: true,
          alternativesViewed: 2,
        })
      );
    });

    it('marks confirmation of the top suggestion as not an override', async () => {
      const mockCandidate = createMockTripCandidate('trip-1');
      const mockCluster = createMockCluster('cluster-1');

      const topPlace = {
        place_id: 'ChIJ_top',
        name: 'Top Suggestion',
        address: 'Top Address',
        location: { latitude: 35.6762, longitude: 139.6503 },
        category: 'place' as const,
        distance_m: 30,
        types: ['tourist_attraction'],
      };
      const mockSuggestion = {
        cluster_id: 'cluster-1',
        photo_ids: ['photo-1'],
        places: [topPlace],
      };

      mockedPhotoImport.getFullCluster.mockReturnValue(mockCluster);
      mockSuggestionDispatchController.dispatch.mockResolvedValue({ suggestions: [] });
      mockUploadPhotos.mockResolvedValue({ mediaIds: [], failedCount: 0 });

      const { result } = renderHook(() => usePhotoImportWorkflow({}), {
        wrapper: createWrapper(queryClient),
      });

      act(() => {
        result.current.selectCandidate(mockCandidate);
      });
      await act(async () => {
        await result.current.selectTrip('trip-123');
      });

      await act(async () => {
        await result.current.handleConfirmPlace(mockSuggestion, topPlace, {
          suggested_rank: 1,
          alternatives_count: 1,
          alternatives_viewed: 1,
        });
      });

      expect(mockCreateEntryMutateAsync).toHaveBeenCalledWith(
        expect.objectContaining({
          photo_import: expect.objectContaining({
            suggested_rank: 1,
            was_override: false,
            suggested_place_id: 'ChIJ_top',
          }),
        })
      );
    });
  });

  describe('persistence — markPhotosSaved', () => {
    it('persists post-excludedPhotos IDs after a confirmed entry', async () => {
      const mockCandidate = createMockTripCandidate('trip-1');
      const mockCluster = {
        ...createMockCluster('cluster-1'),
        photos: [createMockPhoto('p1'), createMockPhoto('p2'), createMockPhoto('p3')],
      };
      const mockSuggestion = {
        cluster_id: 'cluster-1',
        photo_ids: ['p1', 'p2', 'p3'],
        places: [],
      };
      const mockPlace = {
        place_id: 'ChIJ_x',
        name: 'X',
        address: 'a',
        location: { latitude: 35.6762, longitude: 139.6503 },
        category: 'place' as const,
        distance_m: 10,
        types: ['tourist_attraction'],
      };

      mockedPhotoImport.getFullCluster.mockReturnValue(mockCluster);
      mockSuggestionDispatchController.dispatch.mockResolvedValue({ suggestions: [] });
      mockUploadPhotos.mockResolvedValue({ mediaIds: [], failedCount: 0 });

      const { result } = renderHook(() => usePhotoImportWorkflow({}), {
        wrapper: createWrapper(queryClient),
      });
      act(() => {
        result.current.selectCandidate(mockCandidate);
      });
      await act(async () => {
        await result.current.selectTrip('trip-123');
      });

      await act(async () => {
        await result.current.handleConfirmPlace(
          mockSuggestion,
          mockPlace,
          { suggested_rank: 1, alternatives_count: 1, alternatives_viewed: 1 },
          false,
          [],
          new Set(['p2'])
        );
      });

      expect(mockedPhotoImport.markPhotosSaved).toHaveBeenCalledWith('cluster-1', ['p1', 'p3']);
    });

    it('persists post-excludedPhotos IDs from the manual override path', async () => {
      const mockCandidate = createMockTripCandidate('trip-1');
      const mockCluster = {
        ...createMockCluster('cluster-1'),
        photos: [createMockPhoto('p1'), createMockPhoto('p2'), createMockPhoto('p3')],
      };
      const manualPlace = {
        google_place_id: 'ChIJ_y',
        name: 'Y',
        address: 'a',
        latitude: 35.7,
        longitude: 139.7,
        google_photo_url: null,
        website_url: null,
      };

      mockedPhotoImport.getFullCluster.mockReturnValue(mockCluster);
      mockSuggestionDispatchController.dispatch.mockResolvedValue({ suggestions: [] });
      mockUploadPhotos.mockResolvedValue({ mediaIds: [], failedCount: 0 });

      const { result } = renderHook(() => usePhotoImportWorkflow({}), {
        wrapper: createWrapper(queryClient),
      });
      act(() => {
        result.current.selectCandidate(mockCandidate);
      });
      await act(async () => {
        await result.current.selectTrip('trip-123');
      });
      act(() => {
        result.current.handleAddEntryForCluster('cluster-1');
      });

      await act(async () => {
        await result.current.handleManualSelect(
          manualPlace,
          'place',
          'trip-123',
          undefined,
          new Set(['p2'])
        );
      });

      expect(mockedPhotoImport.markPhotosSaved).toHaveBeenCalledWith('cluster-1', ['p1', 'p3']);
    });
  });

  describe('handleSplitCluster', () => {
    it('persists the split via saveClusterSplit so it survives across sessions', async () => {
      const mockCandidate = createMockTripCandidate('trip-1');
      const mockCluster = {
        ...createMockCluster('cluster-1'),
        photos: [
          createMockPhoto('p1'),
          createMockPhoto('p2'),
          createMockPhoto('p3'),
          createMockPhoto('p4'),
        ],
      };
      mockedPhotoImport.getFullCluster.mockReturnValue(mockCluster);
      mockSuggestionDispatchController.dispatch.mockResolvedValue({ suggestions: [] });

      const { result } = renderHook(() => usePhotoImportWorkflow({}), {
        wrapper: createWrapper(queryClient),
      });
      act(() => {
        result.current.selectCandidate(mockCandidate);
      });
      await act(async () => {
        await result.current.selectTrip('trip-123');
      });

      // Seed clusterLookup so handleSplitCluster can find the parent.
      // The mock workflow's selectCandidate populates state from the scan
      // result, but for this test we directly drive the split via the
      // existing test harness (which uses the mocked photoImport surface).
      await act(async () => {
        // Push the cluster into the workflow's lookup so the split can find it.
        mockScanResultRef.current = {
          candidates: [mockCandidate],
          photoLookup: new Map(),
          clusterLookup: new Map([['cluster-1', mockCluster]]),
          clusterDisplays: new Map(),
          importTime: Date.now(),
          isIncremental: false,
          autoDismissedClusterIds: new Set<string>(),
        };
        await result.current.startScan(false);
      });

      await act(async () => {
        await result.current.handleSplitCluster('cluster-1', ['p1', 'p2'], ['p3', 'p4']);
      });

      expect(mockedPhotoImport.saveClusterSplit).toHaveBeenCalledWith(
        'cluster-1',
        { id: 'cluster-1__split_a', photoIds: ['p1', 'p2'] },
        { id: 'cluster-1__split_b', photoIds: ['p3', 'p4'] }
      );
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
        result.current.handleRejectPlace(mockSuggestion, {
          suggested_rank: 1,
          alternatives_count: 1,
          alternatives_viewed: 1,
        });
      });

      expect(Analytics.photoImportPlaceRejected).toHaveBeenCalled();
      expect(Analytics.photoImportManualSearchOpened).toHaveBeenCalled();
      expect(result.current.manualSearchCluster).toEqual(mockCluster);
    });
  });

  describe('handleManualSelect (override path)', () => {
    it('attaches photo_import provenance when reaching manual search via reject', async () => {
      const mockCandidate = createMockTripCandidate('trip-1');
      const mockCluster = createMockCluster('cluster-1');
      const topPlace = {
        place_id: 'ChIJ_top',
        name: 'Top Suggestion',
        address: 'Top Address',
        location: { latitude: 35.6762, longitude: 139.6503 },
        category: 'place' as const,
        distance_m: 30,
        types: ['tourist_attraction'],
      };
      const mockSuggestion = {
        cluster_id: 'cluster-1',
        photo_ids: ['photo-1'],
        places: [topPlace],
      };
      const manualPlace = {
        google_place_id: 'ChIJ_manual',
        name: 'Manually Picked',
        address: 'Manual Address',
        latitude: 35.7,
        longitude: 139.7,
        google_photo_url: null,
        website_url: null,
      };

      mockedPhotoImport.getFullCluster.mockReturnValue(mockCluster);
      mockSuggestionDispatchController.dispatch.mockResolvedValue({ suggestions: [] });
      mockUploadPhotos.mockResolvedValue({ mediaIds: [], failedCount: 0 });

      const { result } = renderHook(() => usePhotoImportWorkflow({}), {
        wrapper: createWrapper(queryClient),
      });

      act(() => {
        result.current.selectCandidate(mockCandidate);
      });
      await act(async () => {
        await result.current.selectTrip('trip-123');
      });

      // User taps the pencil after looking at the lone suggestion.
      act(() => {
        result.current.handleRejectPlace(mockSuggestion, {
          suggested_rank: 1,
          alternatives_count: 1,
          alternatives_viewed: 1,
        });
      });

      await act(async () => {
        await result.current.handleManualSelect(manualPlace, 'food', 'trip-123');
      });

      expect(mockCreateEntryMutateAsync).toHaveBeenCalledWith(
        expect.objectContaining({
          photo_import: {
            cluster_id: 'cluster-1',
            suggested_place_id: 'ChIJ_top',
            suggested_rank: 0,
            alternatives_count: 1,
            alternatives_viewed: 1,
            was_override: true,
            was_from_cache: false,
          },
        })
      );
    });

    it('excludes deselected photos when uploading via the override path', async () => {
      const mockCandidate = createMockTripCandidate('trip-1');
      const mockCluster = {
        ...createMockCluster('cluster-1'),
        photos: [
          createMockPhoto('photo-1'),
          createMockPhoto('photo-2'),
          createMockPhoto('photo-3'),
        ],
      };
      const manualPlace = {
        google_place_id: 'ChIJ_manual',
        name: 'Manually Picked',
        address: 'Manual Address',
        latitude: 35.7,
        longitude: 139.7,
        google_photo_url: null,
        website_url: null,
      };

      mockedPhotoImport.getFullCluster.mockReturnValue(mockCluster);
      mockSuggestionDispatchController.dispatch.mockResolvedValue({ suggestions: [] });
      mockUploadPhotos.mockResolvedValue({ mediaIds: [], failedCount: 0 });

      const { result } = renderHook(() => usePhotoImportWorkflow({}), {
        wrapper: createWrapper(queryClient),
      });

      act(() => {
        result.current.selectCandidate(mockCandidate);
      });
      await act(async () => {
        await result.current.selectTrip('trip-123');
      });

      act(() => {
        result.current.handleAddEntryForCluster('cluster-1');
      });

      await act(async () => {
        await result.current.handleManualSelect(
          manualPlace,
          'place',
          'trip-123',
          undefined,
          new Set(['photo-2'])
        );
      });

      const uploadedPhotos = mockUploadPhotos.mock.calls[0][1] as Array<{ id: string }>;
      expect(uploadedPhotos.map((p) => p.id)).toEqual(['photo-1', 'photo-3']);
    });

    it('omits photo_import when manual search is opened directly (no suggestion shown)', async () => {
      const mockCandidate = createMockTripCandidate('trip-1');
      const mockCluster = createMockCluster('cluster-1');
      const manualPlace = {
        google_place_id: 'ChIJ_manual',
        name: 'Manually Picked',
        address: 'Manual Address',
        latitude: 35.7,
        longitude: 139.7,
        google_photo_url: null,
        website_url: null,
      };

      mockedPhotoImport.getFullCluster.mockReturnValue(mockCluster);
      mockSuggestionDispatchController.dispatch.mockResolvedValue({ suggestions: [] });
      mockUploadPhotos.mockResolvedValue({ mediaIds: [], failedCount: 0 });

      const { result } = renderHook(() => usePhotoImportWorkflow({}), {
        wrapper: createWrapper(queryClient),
      });

      act(() => {
        result.current.selectCandidate(mockCandidate);
      });
      await act(async () => {
        await result.current.selectTrip('trip-123');
      });

      act(() => {
        result.current.handleAddEntryForCluster('cluster-1');
      });

      await act(async () => {
        await result.current.handleManualSelect(manualPlace, 'place', 'trip-123');
      });

      const lastCall =
        mockCreateEntryMutateAsync.mock.calls[mockCreateEntryMutateAsync.mock.calls.length - 1];
      expect(lastCall[0].photo_import).toBeUndefined();
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
      mockSuggestionDispatchController.dispatch.mockResolvedValue({ suggestions: [] });

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
      expect(mockSuggestionDispatchController.reset).toHaveBeenCalled();
    });
  });

  describe('backToTripSelection', () => {
    it('returns to trip-selection phase and resets suggestions', async () => {
      const mockCandidate = createMockTripCandidate('trip-1');
      mockedPhotoImport.getFullCluster.mockReturnValue(createMockCluster('cluster-1'));
      mockSuggestionDispatchController.dispatch.mockResolvedValue({ suggestions: [] });

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
      expect(mockSuggestionDispatchController.reset).toHaveBeenCalled();
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

      mockScanResultRef.current = {
        candidates: [mockCandidate],
        photoLookup: new Map(),
        clusterLookup: new Map(),
        clusterDisplays: new Map(),
        importTime: Date.now(),
        isIncremental: false,
      };
      mockedPhotoImport.getFullCluster.mockReturnValue(createMockCluster('cluster-1'));
      mockSuggestionDispatchController.dispatch.mockResolvedValue({ suggestions: [] });

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

    it('survives unmount/remount cycle without re-running extraction', async () => {
      const mockCandidate = createMockTripCandidate('trip-1');

      // First scan completes with a result
      mockScanResultRef.current = {
        candidates: [mockCandidate],
        photoLookup: new Map(),
        clusterLookup: new Map(),
        clusterDisplays: new Map(),
        importTime: Date.now(),
        isIncremental: false,
      };

      const { result, unmount } = renderHook(() => usePhotoImportWorkflow({}), {
        wrapper: createWrapper(queryClient),
      });

      await act(async () => {
        await result.current.startScan();
      });
      expect(result.current.phase).toBe('candidates');
      expect(mockedPhotoImport.startScan).toHaveBeenCalledTimes(1);

      unmount();

      // Re-mount: should not call startScan a second time. Phase resets to
      // idle because the prior result was already consumed.
      const { result: result2 } = renderHook(() => usePhotoImportWorkflow({}), {
        wrapper: createWrapper(queryClient),
      });

      expect(mockedPhotoImport.startScan).toHaveBeenCalledTimes(1);
      expect(result2.current.phase).toBe('idle');
    });
  });
});
