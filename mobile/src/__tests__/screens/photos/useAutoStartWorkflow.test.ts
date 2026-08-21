/**
 * Tests for the auto-start dispatch-owner bracket (U2 / R1 / KTD13).
 *
 * Auto-start is the path that opens an already-imported trip. It previously
 * reported NOTHING while it read the photo cache, re-segmented trips, and then
 * awaited the suggestion fetch — so `useClusterItems` treated the whole window
 * as "settled" and reconciled every still-in-flight cluster to `lookup-failed`.
 *
 * It now claims one owner slot around its ENTIRE async body. The slot must be
 * released on every branch, including the ones that never fetch at all: no
 * country filter, empty photo cache, no candidates for the country, the
 * subscription-still-loading bail, and the unmounted bail. A stranded owner
 * would withhold every terminal row for the rest of the session.
 */

import { renderHook } from '@testing-library/react-native';

import { useAutoStartWorkflow } from '../../../screens/photos/useAutoStartWorkflow';
import {
  getAllCachedPhotos,
  getLastImportTime,
  segmentTripsFromCache,
  type TripCandidateDisplay,
} from '@services/photoImport';

jest.mock('@services/photoImport', () => ({
  applyPersistedSplits: jest.fn((segmented: unknown) => segmented),
  applySavedPhotoFilter: jest.fn((data: unknown) => ({ data, autoDismissed: new Set() })),
  getAllCachedPhotos: jest.fn(),
  getAllSavedPhotoIds: jest.fn(async () => new Set<string>()),
  getClusterSplitsForParents: jest.fn(async () => new Map()),
  getLastImportTime: jest.fn(async () => 1234),
  getLastSelectedCandidateId: jest.fn(async () => null),
  segmentTripsFromCache: jest.fn(),
}));

jest.mock('@services/analytics', () => ({
  Analytics: { photoImportCandidateSelected: jest.fn() },
}));

const mockedGetAllCachedPhotos = getAllCachedPhotos as jest.MockedFunction<
  typeof getAllCachedPhotos
>;
const mockedSegmentTripsFromCache = segmentTripsFromCache as jest.MockedFunction<
  typeof segmentTripsFromCache
>;
const mockedGetLastImportTime = getLastImportTime as jest.MockedFunction<typeof getLastImportTime>;

const candidate: TripCandidateDisplay = {
  id: 'cand-1',
  countryCode: 'JP',
  dateRange: { start: new Date('2026-01-01'), end: new Date('2026-01-02') },
  photoIds: [],
  photoCount: 2,
  previewUris: [],
  previewAssetIds: [],
  locationClusterIds: ['c-1'],
};

/** Render the hook with every collaborator stubbed; returns the owner counters. */
function setup(overrides: Record<string, unknown> = {}) {
  const beginFetchOwner = jest.fn();
  const endFetchOwner = jest.fn();
  const fetchSuggestions = jest.fn(async () => undefined);
  const startScan = jest.fn(async () => undefined);
  const handlePremiumGate = jest.fn();

  const options = {
    autoStart: true,
    filterCountryCode: 'JP',
    tripId: 'trip-1',
    skipToSuggestions: true,
    homeCountry: 'US',
    subscriptionStatus: 'active',
    isPremium: true,
    canImportPhotos: true,
    currentCandidateIdRef: { current: null as string | null },
    startScan,
    handlePremiumGate,
    fetchSuggestions,
    beginFetchOwner,
    endFetchOwner,
    setClusterLookup: jest.fn(),
    setClusterDisplays: jest.fn(),
    photoLookupRef: { current: new Map() },
    clusterLookupRef: { current: new Map() },
    clusterDisplaysRef: { current: new Map() },
    setTripCandidates: jest.fn(),
    setLastImportTimeState: jest.fn(),
    setIsIncremental: jest.fn(),
    setSelectedCandidate: jest.fn(),
    setSelectedTripId: jest.fn(),
    setPhase: jest.fn(),
    unmountedRef: { current: false },
    mergeAutoDismissedClusterIds: jest.fn(),
    ...overrides,
  } as unknown as Parameters<typeof useAutoStartWorkflow>[0];

  const rendered = renderHook(() => useAutoStartWorkflow(options));
  return { rendered, beginFetchOwner, endFetchOwner, fetchSuggestions, startScan };
}

/** Let the auto-start IIFE's microtask chain drain. */
const flush = async () => {
  for (let i = 0; i < 12; i++) await Promise.resolve();
};

beforeEach(() => {
  jest.clearAllMocks();
  mockedGetLastImportTime.mockResolvedValue(1234);
  mockedGetAllCachedPhotos.mockResolvedValue([{ id: 'p-1' }] as never);
  mockedSegmentTripsFromCache.mockReturnValue({
    candidates: [candidate],
    clusterLookup: new Map(),
    clusterDisplays: new Map(),
    photoLookup: new Map(),
  } as never);
});

describe('useAutoStartWorkflow dispatch owner bracket (R1/KTD13)', () => {
  it('releases the owner on the no-country-filter scan fallback', async () => {
    const { beginFetchOwner, endFetchOwner, startScan } = setup({ filterCountryCode: undefined });
    await flush();

    expect(startScan).toHaveBeenCalled();
    expect(beginFetchOwner).toHaveBeenCalledTimes(1);
    expect(endFetchOwner).toHaveBeenCalledTimes(1);
  });

  it('releases the owner on the empty-photo-cache scan fallback', async () => {
    mockedGetAllCachedPhotos.mockResolvedValue([]);
    const { beginFetchOwner, endFetchOwner, startScan } = setup();
    await flush();

    expect(startScan).toHaveBeenCalled();
    expect(beginFetchOwner).toHaveBeenCalledTimes(1);
    expect(endFetchOwner).toHaveBeenCalledTimes(1);
  });

  it('releases the owner when no candidate matches the country filter', async () => {
    const { beginFetchOwner, endFetchOwner, startScan } = setup({ filterCountryCode: 'FR' });
    await flush();

    expect(startScan).toHaveBeenCalled();
    expect(beginFetchOwner).toHaveBeenCalledTimes(1);
    expect(endFetchOwner).toHaveBeenCalledTimes(1);
  });

  it('releases the owner on the subscription-still-loading bail', async () => {
    const { beginFetchOwner, endFetchOwner, fetchSuggestions } = setup({
      subscriptionStatus: 'loading',
    });
    await flush();

    expect(fetchSuggestions).not.toHaveBeenCalled();
    expect(beginFetchOwner).toHaveBeenCalledTimes(1);
    expect(endFetchOwner).toHaveBeenCalledTimes(1);
  });

  it('releases the owner on the unmounted bail', async () => {
    const { beginFetchOwner, endFetchOwner, fetchSuggestions } = setup({
      unmountedRef: { current: true },
    });
    await flush();

    expect(fetchSuggestions).not.toHaveBeenCalled();
    expect(beginFetchOwner).toHaveBeenCalledTimes(1);
    expect(endFetchOwner).toHaveBeenCalledTimes(1);
  });

  it('releases the owner on the premium gate BEFORE the fetch', async () => {
    const { beginFetchOwner, endFetchOwner, fetchSuggestions } = setup({
      isPremium: false,
      canImportPhotos: false,
    });
    await flush();

    expect(fetchSuggestions).not.toHaveBeenCalled();
    expect(beginFetchOwner).toHaveBeenCalledTimes(1);
    expect(endFetchOwner).toHaveBeenCalledTimes(1);
  });

  it('releases the owner on the premium gate AFTER the fetch', async () => {
    const fetchSuggestions = jest.fn(async () => ({ gatedByPremium: true }) as const);
    const { beginFetchOwner, endFetchOwner } = setup({ fetchSuggestions });
    await flush();

    expect(fetchSuggestions).toHaveBeenCalled();
    expect(beginFetchOwner).toHaveBeenCalledTimes(1);
    expect(endFetchOwner).toHaveBeenCalledTimes(1);
  });

  it('holds the owner across the fetch and releases it once on the happy path', async () => {
    let resolveFetch!: () => void;
    const fetchSuggestions = jest.fn(
      () =>
        new Promise<undefined>((resolve) => {
          resolveFetch = () => resolve(undefined);
        })
    );
    const { beginFetchOwner, endFetchOwner } = setup({ fetchSuggestions });
    await flush();

    // Still in flight: claimed, not yet released.
    expect(beginFetchOwner).toHaveBeenCalledTimes(1);
    expect(endFetchOwner).not.toHaveBeenCalled();

    resolveFetch();
    await flush();

    expect(endFetchOwner).toHaveBeenCalledTimes(1);
  });
});
