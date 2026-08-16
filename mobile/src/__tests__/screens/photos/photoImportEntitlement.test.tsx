/**
 * U10 — client entitlement counting, exemption, and disclosure.
 *
 * Covers R16 (the free import is counted durably, once, on the first successful
 * batch) and R17 (a trip that already consumed it stays completable at EVERY
 * gate, on any device).
 */

import React from 'react';
import { render, renderHook, act } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Alert } from 'react-native';
import { AxiosError } from 'axios';

import { usePlaceSuggestions } from '../../../screens/photos/usePlaceSuggestions';
import { useWorkflowNavigation } from '../../../screens/photos/useWorkflowNavigation';
import { SuggestionsPhase } from '../../../screens/photos/components/SuggestionsPhase';
import {
  claimPhotoImportForTrip,
  isPhotoImportExempt,
  noteServerRefusedPhotoImport,
  resetPhotoImportEntitlementForTests,
} from '@services/photoImport/photoImportEntitlement';
import {
  addConsumedPhotoImportTripId,
  getConsumedPhotoImportTripIds,
  getPhotoImportHistoryTripIds,
  hasRunPhotoImportGrandfatherPass,
  markPhotoImportGrandfatherPassRun,
} from '@services/photoImport/photoCacheDbSuggestions';
import { CHUNK_SIZE, FIRST_CHUNK_SIZE, suggestionDispatch } from '@hooks/usePhotoImport';
import { useAuthStore } from '@stores/authStore';
import { useIsPremium, useCanImportPhotos } from '@stores/subscriptionStore';
import { api } from '@services/api';
import {
  getCachedSuggestions,
  getFullCluster,
  type LocationCluster,
  type TripCandidateDisplay,
} from '@services/photoImport';

// ---- Mocks -----------------------------------------------------------------

jest.mock('@services/photoImport', () => ({
  getFullCluster: jest.fn(),
  getCachedSuggestions: jest.fn(),
  cacheSuggestions: jest.fn().mockResolvedValue(undefined),
  clusterLocationKey: jest.fn(
    (centroid: { latitude: number; longitude: number }) =>
      `loc:${centroid.latitude},${centroid.longitude}`
  ),
  setLastSelectedCandidateId: jest.fn().mockResolvedValue(undefined),
  computeTimeHint: jest.fn(() => 'attraction'),
}));

jest.mock('@services/photoImport/visionPhoto', () => ({
  getVisionImagesForCluster: jest.fn().mockResolvedValue([]),
}));

jest.mock('@services/analytics', () => ({
  Analytics: {
    photoImportSuggestionsCompleted: jest.fn(),
    photoImportApiError: jest.fn(),
    photoImportCandidateSelected: jest.fn(),
  },
  calculateApiPercentiles: jest.fn(() => ({ p50: 100, p95: 200, p99: 300 })),
}));

// The device markers live in the photo cache DB. Backed by in-memory maps here
// so a test can destroy the local cache outright and prove the SERVER record is
// what keeps an exempt trip completable.
jest.mock('@services/photoImport/photoCacheDbSuggestions', () => {
  const consumed = new Map<string, string[]>();
  const grandfathered = new Set<string>();
  let history: string[] = [];
  return {
    __esModule: true,
    getConsumedPhotoImportTripIds: jest.fn(async (userId: string) => consumed.get(userId) ?? []),
    addConsumedPhotoImportTripId: jest.fn(async (userId: string, tripId: string) => {
      consumed.set(userId, [...(consumed.get(userId) ?? []), tripId]);
    }),
    getPhotoImportHistoryTripIds: jest.fn(async () => history),
    hasRunPhotoImportGrandfatherPass: jest.fn(async (userId: string) => grandfathered.has(userId)),
    markPhotoImportGrandfatherPassRun: jest.fn(async (userId: string) => {
      grandfathered.add(userId);
    }),
    __reset: () => {
      consumed.clear();
      grandfathered.clear();
      history = [];
    },
    __setHistory: (ids: string[]) => {
      history = ids;
    },
  };
});

const markerStore = jest.requireMock('@services/photoImport/photoCacheDbSuggestions') as {
  __reset: () => void;
  __setHistory: (ids: string[]) => void;
};

const subscriptionState = {
  shareExtensionUsage: 0,
  shareExtensionPeriodStart: null as string | null,
  photoImportUsage: 0,
  setUsageLimits: jest.fn(),
  incrementPhotoImportUsage: jest.fn(),
};

jest.mock('@stores/subscriptionStore', () => {
  const useSubscriptionStore = jest.fn(() => jest.fn());
  return {
    __esModule: true,
    useSubscriptionStore,
    useIsPremium: jest.fn(() => false),
    useCanImportPhotos: jest.fn(() => true),
    FREE_LIMITS: { shareExtension: 5, photoImport: 1, entriesPerTrip: 10 },
  };
});

// eslint-disable-next-line @typescript-eslint/no-var-requires
const subscriptionModule = jest.requireMock('@stores/subscriptionStore') as {
  useSubscriptionStore: jest.Mock & { getState?: () => typeof subscriptionState };
};
subscriptionModule.useSubscriptionStore.getState = () => subscriptionState;

const mockNavigate = jest.fn();
jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({ navigate: mockNavigate }),
}));

const mockedApi = api as jest.Mocked<typeof api>;
const mockedGetCachedSuggestions = getCachedSuggestions as jest.MockedFunction<
  typeof getCachedSuggestions
>;
const mockedGetFullCluster = getFullCluster as jest.MockedFunction<typeof getFullCluster>;
const mockedIsPremium = useIsPremium as jest.MockedFunction<typeof useIsPremium>;
const mockedCanImport = useCanImportPhotos as jest.MockedFunction<typeof useCanImportPhotos>;

// ---- Helpers ---------------------------------------------------------------

const TRIP_ID = 'trip-consumed';
const OTHER_TRIP_ID = 'trip-never-imported';
const USER_A = 'user-a';
const USER_B = 'user-b';

function signIn(userId: string) {
  useAuthStore.setState({
    session: { user: { id: userId } },
  } as unknown as Parameters<typeof useAuthStore.setState>[0]);
}

function makeCluster(id: string, lat = 35, lng = 139): LocationCluster {
  return {
    id,
    geohash: 'gh',
    centroid: { latitude: lat, longitude: lng },
    photos: [
      {
        id: `photo-${id}`,
        uri: `file://${id}.jpg`,
        filename: `${id}.jpg`,
        creationTime: new Date('2024-01-01T00:00:00Z'),
        location: { latitude: lat, longitude: lng },
      },
    ],
    timeRange: { start: new Date('2024-01-01T00:00:00Z'), end: new Date('2024-01-01T01:00:00Z') },
    countryCode: 'JP',
  };
}

function buildCandidate(clusterIds: string[], id = 'cand-1'): TripCandidateDisplay {
  return {
    id,
    countryCode: 'JP',
    dateRange: { start: new Date(), end: new Date() },
    photoIds: [],
    photoCount: clusterIds.length,
    previewUris: [],
    previewAssetIds: [],
    locationClusterIds: clusterIds,
  };
}

/** Every URL the client hit, in order, so ordering claims can be checked. */
let callLog: string[] = [];

/** Usage the fake server reports. Mutated by the increment endpoint. */
let serverUsage: { photo_import_count: number; photo_import_trip_id: string | null };

function installServer(options?: { suggestFails?: 'all' | 'first'; usageGetFails?: boolean }) {
  let suggestCall = 0;
  mockedApi.get.mockImplementation((async (url: string) => {
    callLog.push(`GET ${url}`);
    if (url === '/subscriptions/usage') {
      if (options?.usageGetFails) throw new Error('network down');
      return { data: { share_extension_count: 0, ...serverUsage } };
    }
    return { data: {} };
  }) as unknown as typeof api.get);

  mockedApi.post.mockImplementation((async (url: string, body: unknown) => {
    callLog.push(`POST ${url}`);
    if (url === '/subscriptions/usage/increment') {
      const tripId = (body as { trip_id?: string }).trip_id ?? null;
      if (serverUsage.photo_import_trip_id === null) {
        serverUsage.photo_import_trip_id = tripId;
        serverUsage.photo_import_count += 1;
      } else if (serverUsage.photo_import_trip_id !== tripId) {
        serverUsage.photo_import_count += 1;
      }
      return { data: { status: 'incremented', new_count: serverUsage.photo_import_count } };
    }
    suggestCall += 1;
    if (
      options?.suggestFails === 'all' ||
      (options?.suggestFails === 'first' && suggestCall === 1)
    ) {
      const err = new AxiosError('rate limited');
      err.response = {
        status: 429,
        headers: { 'retry-after': '1' },
        data: {},
        statusText: '',
        config: {} as never,
      };
      throw err;
    }
    const clusters = (body as { clusters: { id: string }[] }).clusters;
    return {
      data: {
        suggestions: clusters.map((c) => ({ cluster_id: c.id, photo_ids: [], places: [] })),
        failed_cluster_count: 0,
      },
    };
  }) as unknown as typeof api.post);
}

const createTestQueryClient = () =>
  new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { retry: false } },
  });

function setup(clusters: LocationCluster[], selectedTripId: string | null = TRIP_ID) {
  const lookup = new Map<string, LocationCluster>();
  for (const c of clusters) lookup.set(c.id, c);
  mockedGetFullCluster.mockImplementation((id: string) => lookup.get(id));
  const clusterLookupRef = { current: lookup } as React.RefObject<Map<string, LocationCluster>>;
  const queryClient = createTestQueryClient();
  queryClient.setQueryData(['trips', TRIP_ID], { id: TRIP_ID, name: 'Japan 2024' });
  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  return renderHook(() => usePlaceSuggestions({ clusterLookupRef, selectedTripId }), { wrapper });
}

let alertSpy: jest.SpyInstance;

/** Auto-answer the free-import confirmation. */
function answerConfirmation(choice: 'Continue' | 'Not Now') {
  alertSpy.mockImplementation(((
    _title: string,
    _message?: string,
    buttons?: { text?: string; onPress?: () => void }[]
  ) => {
    const button = buttons?.find((b) => b.text === choice);
    button?.onPress?.();
  }) as unknown as typeof Alert.alert);
}

beforeEach(() => {
  jest.clearAllMocks();
  suggestionDispatch.resetForTests();
  resetPhotoImportEntitlementForTests();
  markerStore.__reset();
  callLog = [];
  serverUsage = { photo_import_count: 0, photo_import_trip_id: null };
  subscriptionState.photoImportUsage = 0;
  signIn(USER_A);
  mockedIsPremium.mockReturnValue(false);
  mockedCanImport.mockReturnValue(true);
  mockedGetCachedSuggestions.mockResolvedValue(new Map());
  alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
  answerConfirmation('Continue');
  installServer();
});

afterEach(() => {
  alertSpy.mockRestore();
});

// ===========================================================================
// Disclosure (KTD18)
// ===========================================================================

describe('U10 disclosure', () => {
  it('names the trip in a confirmation before the first dispatch', async () => {
    const { result } = setup([makeCluster('c1')]);

    await act(async () => {
      await result.current.fetchSuggestions(buildCandidate(['c1']), TRIP_ID);
    });

    expect(alertSpy).toHaveBeenCalledTimes(1);
    const [, message] = alertSpy.mock.calls[0];
    expect(message).toContain('Japan 2024');
    // The confirmation came BEFORE anything was dispatched.
    expect(callLog.filter((c) => c.includes('suggest-places'))).toHaveLength(1);
  });

  it('dispatches nothing and charges nothing when the user declines', async () => {
    answerConfirmation('Not Now');
    const { result } = setup([makeCluster('c1')]);

    await act(async () => {
      await result.current.fetchSuggestions(buildCandidate(['c1']), TRIP_ID);
    });

    expect(callLog.filter((c) => c.includes('suggest-places'))).toHaveLength(0);
    expect(callLog.filter((c) => c.includes('usage/increment'))).toHaveLength(0);
    expect(serverUsage.photo_import_count).toBe(0);
  });

  it('does not ask a premium user', async () => {
    mockedIsPremium.mockReturnValue(true);
    const { result } = setup([makeCluster('c1')]);

    await act(async () => {
      await result.current.fetchSuggestions(buildCandidate(['c1']), TRIP_ID);
    });

    expect(alertSpy).not.toHaveBeenCalled();
    expect(callLog.filter((c) => c.includes('usage/increment'))).toHaveLength(0);
  });
});

// ===========================================================================
// Counting (R16 / KTD11)
// ===========================================================================

describe('U10 counting', () => {
  it('charges on the FIRST successful batch, not after the whole fetch', async () => {
    const clusters = Array.from({ length: FIRST_CHUNK_SIZE + CHUNK_SIZE }, (_, i) =>
      makeCluster(`c${i}`, 35 + i * 0.01)
    );
    const { result } = setup(clusters);

    await act(async () => {
      await result.current.fetchSuggestions(buildCandidate(clusters.map((c) => c.id)), TRIP_ID);
    });

    const suggestIdx = callLog.indexOf('POST /photos/suggest-places');
    const incrementIdx = callLog.indexOf('POST /subscriptions/usage/increment');
    const lastSuggestIdx = callLog.lastIndexOf('POST /photos/suggest-places');
    expect(suggestIdx).toBeGreaterThanOrEqual(0);
    expect(incrementIdx).toBeGreaterThan(suggestIdx);
    // The charge landed before the LAST batch went out — i.e. it is not an
    // end-of-fetch charge.
    expect(incrementIdx).toBeLessThan(lastSuggestIdx);
    expect(callLog.filter((c) => c.includes('usage/increment'))).toHaveLength(1);
  });

  it('sends trip_id in every suggest-places body', async () => {
    const clusters = Array.from({ length: FIRST_CHUNK_SIZE + CHUNK_SIZE }, (_, i) =>
      makeCluster(`t${i}`, 35 + i * 0.01)
    );
    const { result } = setup(clusters);

    await act(async () => {
      await result.current.fetchSuggestions(buildCandidate(clusters.map((c) => c.id)), TRIP_ID);
    });

    const suggestBodies = mockedApi.post.mock.calls
      .filter((call) => call[0] === '/photos/suggest-places')
      .map((call) => call[1] as { trip_id?: string });
    expect(suggestBodies.length).toBeGreaterThan(1);
    for (const body of suggestBodies) expect(body.trip_id).toBe(TRIP_ID);
  });

  it('does not consume the import when the fetch fails on its first batch', async () => {
    installServer({ suggestFails: 'all' });
    const clusters = Array.from({ length: FIRST_CHUNK_SIZE + CHUNK_SIZE }, (_, i) =>
      makeCluster(`f${i}`, 35 + i * 0.01)
    );
    const { result } = setup(clusters);

    await act(async () => {
      await result.current.fetchSuggestions(buildCandidate(clusters.map((c) => c.id)), TRIP_ID);
    });

    expect(callLog.filter((c) => c.includes('usage/increment'))).toHaveLength(0);
    expect(serverUsage.photo_import_count).toBe(0);
  });

  it('charges once when a later batch is rate-limited but the first succeeded', async () => {
    // Replaces the pre-U10 rule that a rate-limited import was free. Under
    // progressive results a partial import is the normal case, so a run that
    // delivered real suggestions is charged — once.
    let suggestCall = 0;
    mockedApi.post.mockImplementation((async (url: string, body: unknown) => {
      callLog.push(`POST ${url}`);
      if (url === '/subscriptions/usage/increment') {
        serverUsage.photo_import_count += 1;
        return { data: { status: 'incremented', new_count: serverUsage.photo_import_count } };
      }
      suggestCall += 1;
      if (suggestCall > 1) {
        const err = new AxiosError('rate limited');
        err.response = {
          status: 429,
          headers: { 'retry-after': '1' },
          data: {},
          statusText: '',
          config: {} as never,
        };
        throw err;
      }
      const clusters = (body as { clusters: { id: string }[] }).clusters;
      return {
        data: {
          suggestions: clusters.map((c) => ({ cluster_id: c.id, photo_ids: [], places: [] })),
          failed_cluster_count: 0,
        },
      };
    }) as unknown as typeof api.post);

    const clusters = Array.from({ length: FIRST_CHUNK_SIZE + CHUNK_SIZE }, (_, i) =>
      makeCluster(`r${i}`, 35 + i * 0.01)
    );
    const { result } = setup(clusters);

    await act(async () => {
      await result.current.fetchSuggestions(buildCandidate(clusters.map((c) => c.id)), TRIP_ID);
    });

    expect(callLog.filter((c) => c.includes('usage/increment'))).toHaveLength(1);
  });

  it.each([1, 3])(
    'increments once when batches resolve together at concurrency %i',
    async (concurrency) => {
      // The dispatch pool is the double-count hazard: several batches can land
      // in the same tick, and each one calls the claim.
      const clusters = Array.from({ length: FIRST_CHUNK_SIZE + CHUNK_SIZE * 3 }, (_, i) => ({
        id: `k${i}`,
        centroid: { latitude: 35 + i * 0.01, longitude: 139 },
        photo_coordinates: [],
      }));

      await act(async () => {
        await suggestionDispatch.dispatch({
          clusters: clusters as never,
          concurrency,
          tripId: TRIP_ID,
          onBatchSuccess: () => claimPhotoImportForTrip(TRIP_ID),
        });
      });
      // Let the fire-and-forget charge settle.
      await act(async () => {
        await Promise.resolve();
      });

      expect(callLog.filter((c) => c.includes('usage/increment'))).toHaveLength(1);
      expect(serverUsage.photo_import_count).toBe(1);
    }
  );

  // The claim is taken SYNCHRONOUSLY and released again when the charge throws,
  // on the rationale that a run whose charge never landed has not been paid for.
  // Both directions are money-relevant and neither was exercised.
  const flushCharge = () => act(async () => new Promise((resolve) => setTimeout(resolve, 0)));

  it('releases the claim when the charge fails, so a later batch charges it', async () => {
    let incrementCalls = 0;
    mockedApi.post.mockImplementation((async (url: string, body: unknown) => {
      callLog.push(`POST ${url}`);
      if (url === '/subscriptions/usage/increment') {
        incrementCalls += 1;
        if (incrementCalls === 1) throw new Error('network down');
        const tripId = (body as { trip_id?: string }).trip_id ?? null;
        if (serverUsage.photo_import_trip_id === null) {
          serverUsage.photo_import_trip_id = tripId;
          serverUsage.photo_import_count += 1;
        }
        return { data: { status: 'incremented', new_count: serverUsage.photo_import_count } };
      }
      return { data: { suggestions: [], failed_cluster_count: 0 } };
    }) as unknown as typeof api.post);

    // First successful batch: claims, charges, the charge fails, claim released.
    claimPhotoImportForTrip(TRIP_ID);
    await flushCharge();
    // Second successful batch of the same run: the released claim is retaken.
    claimPhotoImportForTrip(TRIP_ID);
    await flushCharge();

    expect(incrementCalls).toBe(2);
    expect(serverUsage.photo_import_count).toBe(1);
  });

  it('does not re-charge after a charge that landed, however many batches succeed', async () => {
    claimPhotoImportForTrip(TRIP_ID);
    await flushCharge();
    claimPhotoImportForTrip(TRIP_ID);
    claimPhotoImportForTrip(TRIP_ID);
    await flushCharge();

    expect(callLog.filter((c) => c.includes('usage/increment'))).toHaveLength(1);
    expect(serverUsage.photo_import_count).toBe(1);
  });

  it('keeps the count across a usage refetch', async () => {
    const { result } = setup([makeCluster('u1')]);

    await act(async () => {
      await result.current.fetchSuggestions(buildCandidate(['u1']), TRIP_ID);
    });

    // A refetch now reads the DURABLE value rather than the never-incremented
    // zero the client counter used to be overwritten with.
    const usage = await mockedApi.get('/subscriptions/usage');
    expect((usage.data as { photo_import_count: number }).photo_import_count).toBe(1);
    expect((usage.data as { photo_import_trip_id: string }).photo_import_trip_id).toBe(TRIP_ID);
  });
});

// ===========================================================================
// Exemption (R17)
// ===========================================================================

describe('U10 exemption', () => {
  beforeEach(() => {
    // An exhausted free user.
    mockedCanImport.mockReturnValue(false);
    serverUsage = { photo_import_count: 1, photo_import_trip_id: TRIP_ID };
  });

  it('lets an exempt trip through the fetch gate and fetches uncached clusters', async () => {
    const { result } = setup([makeCluster('e1')]);

    let outcome: { gatedByPremium: true } | undefined;
    await act(async () => {
      outcome = await result.current.fetchSuggestions(buildCandidate(['e1']), TRIP_ID);
    });

    expect(outcome).toBeUndefined();
    expect(callLog.filter((c) => c.includes('suggest-places'))).toHaveLength(1);
  });

  it('re-fetches on a same-session re-entry, without unmounting', async () => {
    const { result } = setup([makeCluster('s1'), makeCluster('s2', 36)]);

    await act(async () => {
      await result.current.fetchSuggestions(buildCandidate(['s1'], 'cand-a'), TRIP_ID);
    });
    const firstRoundSuggests = callLog.filter((c) => c.includes('suggest-places')).length;

    // Same hook instance, no unmount — a per-hook "already fetched" marker would
    // pass a fresh-mount test and fail exactly here.
    await act(async () => {
      await result.current.fetchSuggestions(buildCandidate(['s2'], 'cand-b'), TRIP_ID);
    });

    expect(callLog.filter((c) => c.includes('suggest-places')).length).toBeGreaterThan(
      firstRoundSuggests
    );
  });

  it('still succeeds after the local cache is destroyed entirely', async () => {
    // No device marker at all: the SERVER record is the authority.
    expect(await getConsumedPhotoImportTripIds(USER_A)).toEqual([]);

    const { result } = setup([makeCluster('d1')]);
    let outcome: { gatedByPremium: true } | undefined;
    await act(async () => {
      outcome = await result.current.fetchSuggestions(buildCandidate(['d1']), TRIP_ID);
    });

    expect(outcome).toBeUndefined();
    expect(callLog).toContain('GET /subscriptions/usage');
  });

  it('still gates a different, never-imported trip', async () => {
    const { result } = setup([makeCluster('g1')], OTHER_TRIP_ID);

    let outcome: { gatedByPremium: true } | undefined;
    await act(async () => {
      outcome = await result.current.fetchSuggestions(buildCandidate(['g1']), OTHER_TRIP_ID);
    });

    expect(outcome).toEqual({ gatedByPremium: true });
    expect(callLog.filter((c) => c.includes('suggest-places'))).toHaveLength(0);
  });

  it('does not let a second free account inherit the first account’s exemption', async () => {
    await addConsumedPhotoImportTripId(USER_A, TRIP_ID);
    expect(await isPhotoImportExempt(TRIP_ID)).toBe(true);

    // Same device, different account. Candidate and cluster ids are
    // deterministic per device, so an un-namespaced marker would carry over.
    resetPhotoImportEntitlementForTests();
    signIn(USER_B);
    serverUsage = { photo_import_count: 1, photo_import_trip_id: null };

    expect(await getConsumedPhotoImportTripIds(USER_B)).toEqual([]);
    expect(await isPhotoImportExempt(TRIP_ID)).toBe(false);
  });

  it('fails OPEN when the exemption read errors', async () => {
    installServer({ usageGetFails: true });
    expect(await isPhotoImportExempt(TRIP_ID)).toBe(true);
  });

  it('does not claim an exemption for a trip the server never recorded', async () => {
    // A stray device marker (the shape the grandfather pass used to produce in
    // bulk) must not out-vote the server. Claiming it means no paywall, a
    // screenful of pending rows, and every batch rejected — the worst available
    // outcome, and invisible until the user is already in the list.
    await addConsumedPhotoImportTripId(USER_A, OTHER_TRIP_ID);
    resetPhotoImportEntitlementForTests();

    expect(await isPhotoImportExempt(OTHER_TRIP_ID)).toBe(false);
    // The server record (TRIP_ID) is still honoured.
    expect(await isPhotoImportExempt(TRIP_ID)).toBe(true);
  });

  it('a successful increment for a second trip does not mark that trip exempt', async () => {
    // The server keeps the FIRST trip, so a 200 from the increment endpoint is
    // not proof it recorded the trip we sent.
    expect(await isPhotoImportExempt(TRIP_ID)).toBe(true); // warms the server read
    claimPhotoImportForTrip(OTHER_TRIP_ID);
    await act(async () => {
      await Promise.resolve();
    });

    expect(await getConsumedPhotoImportTripIds(USER_A)).not.toContain(OTHER_TRIP_ID);
    expect(await isPhotoImportExempt(OTHER_TRIP_ID)).toBe(false);
  });
});

// ===========================================================================
// A bounded exemption that runs out (the 402 the client must not loop on)
// ===========================================================================

describe('U10 exemption revocation on a server refusal', () => {
  beforeEach(() => {
    mockedCanImport.mockReturnValue(false);
    serverUsage = { photo_import_count: 1, photo_import_trip_id: TRIP_ID };
  });

  it('stops claiming the exemption once the server has refused the trip', async () => {
    expect(await isPhotoImportExempt(TRIP_ID)).toBe(true);

    noteServerRefusedPhotoImport(TRIP_ID);

    // The R17 exemption is bounded by a cluster allowance, so it can legitimately
    // run out. Without this the client keeps answering "exempt" at every gate and
    // keeps dispatching into the same 402 — the paywall never appears.
    expect(await isPhotoImportExempt(TRIP_ID)).toBe(false);
  });

  it('a refusal outranks fail-open, so a flaky read cannot resurrect it', async () => {
    noteServerRefusedPhotoImport(TRIP_ID);
    installServer({ usageGetFails: true });

    expect(await isPhotoImportExempt(TRIP_ID)).toBe(false);
  });

  it('records the refusal when a dispatch is stopped by the 402', async () => {
    // The server answers the entitlement stop with the FastAPI envelope.
    mockedApi.post.mockImplementation((async (url: string) => {
      callLog.push(`POST ${url}`);
      const err = new AxiosError('entitlement');
      err.response = {
        status: 402,
        headers: {},
        data: { detail: { code: 'PHOTO_IMPORT_LIMIT_REACHED' } },
        statusText: '',
        config: {} as never,
      };
      throw err;
    }) as unknown as typeof api.post);

    const { result } = setup([makeCluster('rv1')]);

    await act(async () => {
      await result.current.fetchSuggestions(buildCandidate(['rv1']), TRIP_ID);
    });

    expect(await isPhotoImportExempt(TRIP_ID)).toBe(false);
  });
});

// ===========================================================================
// The grandfather pass (KTD18)
// ===========================================================================

describe('U10 grandfather pass', () => {
  it('seeds the counter from real history and exempts the trip it charged', async () => {
    markerStore.__setHistory([TRIP_ID, 'trip-older']);
    serverUsage = { photo_import_count: 0, photo_import_trip_id: null };
    mockedCanImport.mockReturnValue(false);

    expect(await isPhotoImportExempt(TRIP_ID)).toBe(true);
    // Seeded from real history rather than from whichever trip is opened next.
    expect(serverUsage.photo_import_trip_id).toBe(TRIP_ID);
    expect(callLog.filter((c) => c.includes('usage/increment'))).toHaveLength(1);
    expect(markPhotoImportGrandfatherPassRun).toHaveBeenCalledWith(USER_A);
  });

  it('does NOT exempt the other history trips the server cannot honour', async () => {
    // The server records exactly ONE consuming trip (COALESCE — first trip
    // wins). Device-marking every trip in the history read as generous and was
    // the opposite: the client stopped showing the paywall for all of them while
    // the server would honour one, so trips two and three opened with no
    // paywall, a screenful of pending rows, and every batch rejected.
    markerStore.__setHistory([TRIP_ID, 'trip-older']);
    serverUsage = { photo_import_count: 0, photo_import_trip_id: null };
    mockedCanImport.mockReturnValue(false);

    expect(await isPhotoImportExempt(TRIP_ID)).toBe(true);
    expect(await isPhotoImportExempt('trip-older')).toBe(false);
    // And the device marker set never claims more than the server recorded.
    expect(await getConsumedPhotoImportTripIds(USER_A)).toEqual([TRIP_ID]);
  });

  it('marks only the already-recorded trip when the server has one', async () => {
    markerStore.__setHistory([TRIP_ID, 'trip-older']);
    serverUsage = { photo_import_count: 1, photo_import_trip_id: TRIP_ID };
    mockedCanImport.mockReturnValue(false);

    expect(await isPhotoImportExempt('trip-older')).toBe(false);
    expect(await getConsumedPhotoImportTripIds(USER_A)).toEqual([TRIP_ID]);
    // Nothing charged: the counter was already seeded.
    expect(callLog.filter((c) => c.includes('usage/increment'))).toHaveLength(0);
  });

  it('runs at most once per user', async () => {
    markerStore.__setHistory([TRIP_ID]);
    await isPhotoImportExempt(TRIP_ID);
    resetPhotoImportEntitlementForTests();
    (getPhotoImportHistoryTripIds as jest.Mock).mockClear();
    (hasRunPhotoImportGrandfatherPass as jest.Mock).mockClear();

    await isPhotoImportExempt(TRIP_ID);

    expect(hasRunPhotoImportGrandfatherPass).toHaveBeenCalled();
    expect(getPhotoImportHistoryTripIds).not.toHaveBeenCalled();
  });
});

// ===========================================================================
// The upstream gates
// ===========================================================================

describe('U10 upstream gates', () => {
  function navSetup(canRun: (tripId: string | null) => Promise<boolean>) {
    const fetchSuggestions = jest.fn().mockResolvedValue(undefined);
    const setPhase = jest.fn();
    const { result } = renderHook(() =>
      useWorkflowNavigation({
        selectedCandidate: buildCandidate(['n1']),
        selectedTripId: TRIP_ID,
        isPremium: false,
        canImportPhotos: false,
        canRunImportForTrip: canRun,
        currentCandidateIdRef: { current: null },
        setSelectedCandidate: jest.fn(),
        setSelectedTripId: jest.fn(),
        setPhase,
        beginFetchOwner: jest.fn(),
        endFetchOwner: jest.fn(),
        fetchSuggestions,
        resetSuggestPlacesMutation: jest.fn(),
        clearFetchedCache: jest.fn(),
      })
    );
    return { result, fetchSuggestions, setPhase };
  }

  it('selectTrip lets an exempt trip through instead of showing the paywall', async () => {
    const { result, fetchSuggestions } = navSetup(async (tripId) => tripId === TRIP_ID);

    await act(async () => {
      await result.current.selectTrip(TRIP_ID);
    });

    expect(mockNavigate).not.toHaveBeenCalled();
    expect(fetchSuggestions).toHaveBeenCalledWith(expect.anything(), TRIP_ID);
  });

  it('selectTrip still gates a trip that is not exempt', async () => {
    const { result, fetchSuggestions } = navSetup(async (tripId) => tripId === TRIP_ID);

    await act(async () => {
      await result.current.selectTrip(OTHER_TRIP_ID);
    });

    expect(mockNavigate).toHaveBeenCalledWith('PaywallModal', { feature: 'photoImport' });
    expect(fetchSuggestions).not.toHaveBeenCalled();
  });

  it('switchCandidate lets an exempt trip through', async () => {
    const { result, fetchSuggestions } = navSetup(async (tripId) => tripId === TRIP_ID);

    await act(async () => {
      await result.current.switchCandidate(buildCandidate(['n2'], 'cand-2'));
    });

    expect(mockNavigate).not.toHaveBeenCalled();
    expect(fetchSuggestions).toHaveBeenCalledWith(expect.anything(), TRIP_ID);
  });
});

// ===========================================================================
// The banner
// ===========================================================================

describe('U10 free-limit banner', () => {
  const bannerProps = {
    selectedCandidate: buildCandidate(['b1']),
    selectedTripName: 'Japan 2024',
    selectedCountryName: 'Japan',
    isPremium: false,
    canImportPhotos: false,
    fetchingSuggestions: false,
    clusterItems: [],
    renderClusterItem: () => null,
    onUpgrade: jest.fn(),
  };

  it('is suppressed on an exempt trip', () => {
    const { queryByText } = render(<SuggestionsPhase {...bannerProps} isExemptTrip />);
    expect(queryByText('Free Limit Reached')).toBeNull();
  });

  it('still shows for an exhausted free user on a never-imported trip', () => {
    const { queryByText } = render(<SuggestionsPhase {...bannerProps} isExemptTrip={false} />);
    expect(queryByText('Free Limit Reached')).not.toBeNull();
  });
});
